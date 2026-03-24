from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from math import ceil
from typing import Any, Sequence
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled, YouTubeTranscriptApi

load_dotenv(override=True)

DEFAULT_CHUNK_WINDOW_SECONDS = 90
MAX_CHAT_CONTEXT_CHUNKS = 5
MIN_SECTION_COUNT = 4
MAX_SECTION_COUNT = 8
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CHAT_MODEL_NAME = "llama-3.3-70b-versatile"

CHAT_PROMPT = PromptTemplate.from_template(
    """You are a helpful assistant answering questions about a YouTube video.

Answer only from the transcript context below.
If the context is insufficient, reply with: "I don't know from this video."
Stay in the same language as the user's question.
When you make a factual claim, cite at least one transcript timestamp in this format:
[MM:SS - MM:SS](full_youtube_link)
If the user asks for a summary, answer with short bullet points.
If the question is unrelated to the video, politely explain that you can only help with this video.

Transcript context:
{context}

Question:
{question}
"""
)

SECTION_PROMPT = PromptTemplate.from_template(
    """You are organizing a YouTube transcript into timestamped sections.

You will receive chronologically ordered transcript chunks. Return JSON only with this schema:
{{
  "sections": [
    {{
      "title": "short title",
      "summary": "one-sentence summary",
      "start": 0,
      "end": 90
    }}
  ]
}}

Rules:
- Create between {min_sections} and {max_sections} sections unless the transcript is shorter.
- Keep sections in chronological order.
- Use only start and end values that already appear in the chunks.
- Each title must be 2 to 6 words.
- Each summary must be one sentence under 24 words.
- Cover the main progression of the video.
- Do not include commentary outside the JSON object.

Chunks:
{outline}
"""
)


@dataclass(frozen=True, slots=True)
class TranscriptLine:
    text: str
    start: float
    duration: float


@dataclass(frozen=True, slots=True)
class VideoSection:
    title: str
    summary: str
    start: int
    end: int
    url: str


@dataclass(slots=True)
class VideoKnowledgeBase:
    video_id: str
    transcript_lines: tuple[TranscriptLine, ...]
    chunks: tuple[Document, ...]
    vector_store: FAISS

    def get_retriever(self):
        return self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": MAX_CHAT_CONTEXT_CHUNKS},
        )


def extract_video_id(video_url: str) -> str:
    candidate = video_url.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        return candidate

    parsed = urlparse(candidate)
    host = parsed.netloc.lower()
    path_parts = [part for part in parsed.path.split("/") if part]

    if host in {"youtu.be", "www.youtu.be"} and path_parts:
        video_id = path_parts[0]
    elif host.endswith("youtube.com"):
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        elif len(path_parts) >= 2 and path_parts[0] in {"embed", "shorts", "live"}:
            video_id = path_parts[1]
        else:
            video_id = ""
    else:
        video_id = ""

    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("Please provide a valid YouTube video URL.")

    return video_id


def extract_timestamp_seconds(text: str) -> int | None:
    match = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", text)
    if not match:
        return None

    first = int(match.group(1))
    second = int(match.group(2))
    third = match.group(3)

    if third is None:
        return first * 60 + second

    return first * 3600 + second * 60 + int(third)


def format_timestamp(seconds: int) -> str:
    hours, remainder = divmod(max(seconds, 0), 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def build_timestamp_url(video_id: str, start_seconds: int) -> str:
    return f"https://www.youtube.com/watch?v={video_id}&t={max(start_seconds, 0)}s"


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _response_text(response: Any) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts).strip()

    return str(content).strip()


def _extract_json_block(text: str) -> str:
    fenced = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1)

    start_object = text.find("{")
    end_object = text.rfind("}")
    if start_object != -1 and end_object != -1 and end_object > start_object:
        return text[start_object : end_object + 1]

    start_list = text.find("[")
    end_list = text.rfind("]")
    if start_list != -1 and end_list != -1 and end_list > start_list:
        return text[start_list : end_list + 1]

    raise ValueError("The model did not return valid JSON.")


def _safe_excerpt(text: str, max_length: int = 180) -> str:
    clean = _normalize_whitespace(text)
    if len(clean) <= max_length:
        return clean
    return clean[: max_length - 3].rstrip() + "..."


def _guess_section_title(text: str, index: int) -> str:
    match = re.search(r"[A-Za-z0-9][^.?!:]{8,80}", text)
    if not match:
        return f"Section {index}"

    title = match.group(0).strip(" -,:;")
    words = title.split()
    if len(words) > 6:
        title = " ".join(words[:6])
    return title or f"Section {index}"


@lru_cache(maxsize=1)
def _get_embeddings() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)


@lru_cache(maxsize=1)
def _get_llm() -> ChatGroq:
    if not os.getenv("GROQ_API_KEY"):
        raise RuntimeError("Missing GROQ_API_KEY. Add it to your .env file before starting the backend.")

    return ChatGroq(
        model=CHAT_MODEL_NAME,
        temperature=0.2,
        max_tokens=900,
    )


def _fetch_transcript_lines(video_id: str) -> tuple[TranscriptLine, ...]:
    try:
        transcript = YouTubeTranscriptApi().fetch(
            video_id,
            languages=["en", "en-US", "en-GB", "en-IN"],
        )
    except (TranscriptsDisabled, NoTranscriptFound) as exc:
        raise ValueError("This video does not have an English transcript available.") from exc
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch the transcript for video '{video_id}'.") from exc

    lines: list[TranscriptLine] = []
    for item in transcript:
        text = _normalize_whitespace(item.text)
        if not text:
            continue
        lines.append(
            TranscriptLine(
                text=text,
                start=float(item.start),
                duration=float(item.duration),
            )
        )

    if not lines:
        raise ValueError("The transcript was empty, so the video cannot be processed.")

    return tuple(lines)


def _build_transcript_chunks(
    video_id: str,
    transcript_lines: Sequence[TranscriptLine],
    window_size: int = DEFAULT_CHUNK_WINDOW_SECONDS,
) -> tuple[Document, ...]:
    documents: list[Document] = []
    current_text: list[str] = []
    current_start = int(transcript_lines[0].start)
    current_end = current_start

    for entry in transcript_lines:
        entry_start = int(entry.start)
        entry_end = int(entry.start + entry.duration)
        if current_text and entry_start - current_start >= window_size:
            documents.append(
                Document(
                    page_content=" ".join(current_text),
                    metadata={
                        "start": current_start,
                        "end": current_end,
                        "source": build_timestamp_url(video_id, current_start),
                    },
                )
            )
            current_text = []
            current_start = entry_start

        current_text.append(entry.text)
        current_end = max(current_end, entry_end)

    if current_text:
        documents.append(
            Document(
                page_content=" ".join(current_text),
                metadata={
                    "start": current_start,
                    "end": current_end,
                    "source": build_timestamp_url(video_id, current_start),
                },
            )
        )

    return tuple(documents)


@lru_cache(maxsize=12)
def _load_video_knowledge_base(video_id: str) -> VideoKnowledgeBase:
    transcript_lines = _fetch_transcript_lines(video_id)
    chunks = _build_transcript_chunks(video_id, transcript_lines)
    vector_store = FAISS.from_documents(list(chunks), _get_embeddings())
    return VideoKnowledgeBase(
        video_id=video_id,
        transcript_lines=transcript_lines,
        chunks=chunks,
        vector_store=vector_store,
    )


def _get_docs_for_question(question: str, knowledge_base: VideoKnowledgeBase) -> list[Document]:
    requested_timestamp = extract_timestamp_seconds(question)
    if requested_timestamp is not None:
        for index, doc in enumerate(knowledge_base.chunks):
            start = int(doc.metadata["start"])
            end = int(doc.metadata["end"])
            if start <= requested_timestamp <= end:
                start_index = max(index - 1, 0)
                end_index = min(index + 2, len(knowledge_base.chunks))
                return list(knowledge_base.chunks[start_index:end_index])

    retriever = knowledge_base.get_retriever()
    retrieved_docs = retriever.invoke(question)
    return sorted(retrieved_docs, key=lambda doc: int(doc.metadata["start"]))


def _format_chat_context(docs: Sequence[Document]) -> str:
    blocks: list[str] = []
    for doc in docs:
        start = int(doc.metadata["start"])
        end = int(doc.metadata["end"])
        url = doc.metadata["source"]
        timestamp = f"[{format_timestamp(start)} - {format_timestamp(end)}]({url})"
        blocks.append(f"{timestamp}\n{doc.page_content}")
    return "\n\n".join(blocks)


def chat_with_video(video_url: str, question: str) -> str:
    if not question or not question.strip():
        raise ValueError("Please provide a question for the video.")

    video_id = extract_video_id(video_url)
    knowledge_base = _load_video_knowledge_base(video_id)
    context_docs = _get_docs_for_question(question, knowledge_base)
    prompt = CHAT_PROMPT.format(
        context=_format_chat_context(context_docs),
        question=question.strip(),
    )
    response = _get_llm().invoke(prompt)
    return _response_text(response)


def _build_section_outline(chunks: Sequence[Document]) -> str:
    lines: list[str] = []
    for doc in chunks:
        start = int(doc.metadata["start"])
        end = int(doc.metadata["end"])
        excerpt = _safe_excerpt(doc.page_content, max_length=160)
        lines.append(
            f"- start={start}, end={end}, excerpt=\"{excerpt}\""
        )
    return "\n".join(lines)


def _fallback_sections(video_id: str, chunks: Sequence[Document]) -> tuple[VideoSection, ...]:
    if not chunks:
        return tuple()

    section_count = min(
        MAX_SECTION_COUNT,
        max(MIN_SECTION_COUNT, round(len(chunks) / 2)),
        len(chunks),
    )
    group_size = ceil(len(chunks) / section_count)

    sections: list[VideoSection] = []
    for index, start_index in enumerate(range(0, len(chunks), group_size), start=1):
        group = chunks[start_index : start_index + group_size]
        start = int(group[0].metadata["start"])
        end = int(group[-1].metadata["end"])
        combined_text = " ".join(doc.page_content for doc in group)
        sections.append(
            VideoSection(
                title=_guess_section_title(group[0].page_content, index),
                summary=_safe_excerpt(combined_text, max_length=180),
                start=start,
                end=end,
                url=build_timestamp_url(video_id, start),
            )
        )

    return tuple(sections)


def _parse_sections_payload(video_id: str, chunks: Sequence[Document], raw_payload: str) -> tuple[VideoSection, ...]:
    payload = json.loads(_extract_json_block(raw_payload))
    records = payload.get("sections", payload) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("Sections payload was not a list.")

    valid_starts = {int(doc.metadata["start"]) for doc in chunks}
    valid_ends = {int(doc.metadata["end"]) for doc in chunks}

    sections: list[VideoSection] = []
    for record in records:
        if not isinstance(record, dict):
            continue

        title = _normalize_whitespace(str(record.get("title", "")))
        summary = _normalize_whitespace(str(record.get("summary", "")))
        try:
            start = int(record.get("start"))
            end = int(record.get("end"))
        except (TypeError, ValueError):
            continue

        if not title or not summary or start >= end:
            continue
        if start not in valid_starts or end not in valid_ends:
            continue

        sections.append(
            VideoSection(
                title=title,
                summary=summary,
                start=start,
                end=end,
                url=build_timestamp_url(video_id, start),
            )
        )

    if not sections:
        raise ValueError("No valid sections were returned by the model.")

    sections.sort(key=lambda section: section.start)
    return tuple(sections)


def _generate_sections_with_llm(video_id: str, chunks: Sequence[Document]) -> tuple[VideoSection, ...]:
    prompt = SECTION_PROMPT.format(
        min_sections=min(MIN_SECTION_COUNT, len(chunks)),
        max_sections=min(MAX_SECTION_COUNT, len(chunks)),
        outline=_build_section_outline(chunks),
    )
    response = _get_llm().invoke(prompt)
    return _parse_sections_payload(video_id, chunks, _response_text(response))


@lru_cache(maxsize=12)
def _get_video_sections(video_id: str) -> tuple[VideoSection, ...]:
    knowledge_base = _load_video_knowledge_base(video_id)
    try:
        return _generate_sections_with_llm(video_id, knowledge_base.chunks)
    except Exception:
        return _fallback_sections(video_id, knowledge_base.chunks)


def get_video_sections(video_url: str) -> list[dict[str, Any]]:
    video_id = extract_video_id(video_url)
    sections = _get_video_sections(video_id)
    return [
        {
            "title": section.title,
            "summary": section.summary,
            "start": section.start,
            "end": section.end,
            "start_label": format_timestamp(section.start),
            "end_label": format_timestamp(section.end),
            "url": section.url,
        }
        for section in sections
    ]


def summarize_video(video_url: str) -> str:
    sections = get_video_sections(video_url)
    if not sections:
        raise ValueError("No sections could be generated for this video.")

    lines = ["Summary of this video:"]
    for section in sections:
        timestamp = f"[{section['start_label']} - {section['end_label']}]({section['url']})"
        lines.append(f"- {timestamp} {section['title']}: {section['summary']}")
    return "\n".join(lines)
