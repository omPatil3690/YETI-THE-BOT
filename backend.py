from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from secret_store import (
    delete_groq_api_key,
    get_groq_api_key_status,
    load_groq_api_key,
    store_groq_api_key,
)
from youtube_rag import chat_with_video, get_video_sections, summarize_video


class VideoRequest(BaseModel):
    video_url: str = Field(..., min_length=1)


class QuestionRequest(VideoRequest):
    question: str = Field(..., min_length=1)


class GroqCredentialRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


app = FastAPI(
    title="YouTube Video Bot API",
    description="Backend service for chat, summary, and timestamped sections for YouTube videos.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _raise_api_error(exc: Exception) -> None:
    if isinstance(exc, HTTPException):
        raise exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


def _require_saved_api_key() -> str:
    try:
        return load_groq_api_key()
    except Exception as exc:
        _raise_api_error(exc)
    raise HTTPException(status_code=500, detail="The API key could not be loaded.")


@app.get("/")
def read_root() -> dict[str, object]:
    return {
        "message": "YouTube Video Bot backend is running.",
        "endpoints": [
            "/ask",
            "/summary",
            "/sections",
            "/analyze",
            "/credentials/status",
            "/credentials/groq",
        ],
    }


@app.post("/ask")
def ask_video_question(payload: QuestionRequest) -> dict[str, str]:
    try:
        answer = chat_with_video(
            payload.video_url,
            payload.question,
            api_key=_require_saved_api_key(),
        )
    except Exception as exc:
        _raise_api_error(exc)
    return {"answer": answer}


@app.post("/summary")
def summarize_video_endpoint(payload: VideoRequest) -> dict[str, str]:
    try:
        summary = summarize_video(payload.video_url, api_key=_require_saved_api_key())
    except Exception as exc:
        _raise_api_error(exc)
    return {"summary": summary}


@app.post("/sections")
def get_video_sections_endpoint(payload: VideoRequest) -> dict[str, list[dict[str, object]]]:
    try:
        sections = get_video_sections(payload.video_url, api_key=_require_saved_api_key())
    except Exception as exc:
        _raise_api_error(exc)
    return {"sections": sections}


@app.post("/analyze")
def analyze_video(payload: VideoRequest) -> dict[str, object]:
    try:
        api_key = _require_saved_api_key()
        sections = get_video_sections(payload.video_url, api_key=api_key)
        summary = summarize_video(payload.video_url, api_key=api_key)
    except Exception as exc:
        _raise_api_error(exc)
    return {"summary": summary, "sections": sections}


@app.get("/credentials/status")
def credentials_status() -> dict[str, object]:
    try:
        return get_groq_api_key_status()
    except Exception as exc:
        _raise_api_error(exc)
    raise HTTPException(status_code=500, detail="Credential status could not be loaded.")


@app.post("/credentials/groq")
def save_groq_credential(payload: GroqCredentialRequest) -> dict[str, str]:
    try:
        store_groq_api_key(payload.api_key)
    except Exception as exc:
        _raise_api_error(exc)
    return {"message": "Your Groq API key was saved locally in encrypted form."}


@app.delete("/credentials/groq")
def delete_groq_credential() -> dict[str, str]:
    try:
        delete_groq_api_key()
    except Exception as exc:
        _raise_api_error(exc)
    return {"message": "The saved Groq API key was removed from local encrypted storage."}


@app.post("/process")
def process_legacy_endpoint(payload: QuestionRequest) -> dict[str, str]:
    return ask_video_question(payload)
