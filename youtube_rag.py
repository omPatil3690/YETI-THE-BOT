import os
import inspect
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from sentence_transformers import SentenceTransformer, util
from dotenv import load_dotenv
import re
load_dotenv(override=True)

# API Key
groq_api_key = os.getenv("GROQ_API_KEY")
# print("Groq Key:", os.getenv("GROQ_API_KEY"))  # debug

import re

def extract_timestamp(question: str):
    # matches patterns like 2:35, 12:05, 0:45
    match = re.search(r'(\d+):(\d+)', question)
    if match:
        minutes, seconds = map(int, match.groups())
        return minutes * 60 + seconds
    return None


def get_context_for_question(question, retriever, all_docs):
    ts = extract_timestamp(question)
    if ts is not None:
        # direct lookup by timestamp
        for doc in all_docs:
            if doc.metadata.get("start") <= ts < doc.metadata.get("end"):
                return [doc]
    # fallback → semantic retriever
    return retriever.invoke(question)

def extract_video_id(video_url: str) -> str:
    if "v=" in video_url:
        return video_url.split("v=")[-1].split("&")[0]
    elif "youtu.be/" in video_url:
        return video_url.split("youtu.be/")[-1].split("?")[0]
    else:
        raise ValueError("Invalid YouTube URL format")

def fetch_transcript(video_id: str) -> str:
    try:
        ytt_api = YouTubeTranscriptApi()
        transcript = ytt_api.fetch(video_id, languages=['en'])
        transcript_text = " ".join(t.text for t in transcript)
        print(transcript_text[:500])  # Print first 500 characters for preview
        # print("Transcript fetched successfully. Preview:")
        # print(transcript_text[:500])
    except TranscriptsDisabled:
        print("Transcripts are disabled for this video.")
    except NoTranscriptFound:
        print("No transcripts found for this video.")
    except Exception as e:
        print(f"Error fetching transcript: {e}")

    if not transcript_text.strip():
        raise ValueError("No transcript found. Exiting.")

    return transcript_text

# def fetch_transcript_with_chapters(video_id: str):
#     ytt_api = YouTubeTranscriptApi()
#     transcript = ytt_api.fetch(video_id, languages=['en'])

#     documents = []

   

#      #Case 2: No chapters → semantic drift segmentation
#     model = SentenceTransformer("all-MiniLM-L6-v2")

#         # embed each transcript snippet
#     embeddings = model.encode([t.text for t in transcript], convert_to_tensor=True)

#     current_text, current_start = [], transcript[0].start

#     for i in range(1, len(transcript)):
#         sim = util.cos_sim(embeddings[i-1], embeddings[i]).item()
#         current_text.append(transcript[i-1].text)

#             # if semantic drift is high OR too long → start new segment
#         if sim < 0.6 or len(" ".join(current_text)) > 1000:
#             documents.append(
#                 Document(
#                     page_content=" ".join(current_text),
#                     metadata={
#                         # "video_id": video_id,
#                         "chapter": f"Segment {len(documents)+1}",
#                         "start": current_start,
#                         "end": transcript[i-1].start,
#                         "source": f"https://www.youtube.com/watch?v={video_id}&t={int(current_start)}s"
#                     }
#                 )
#             )
#         current_text, current_start = [], transcript[i].start

#         # add last segment
#         if current_text:
#             documents.append(
#                 Document(
#                     page_content=" ".join(current_text),
#                     metadata={
#                         # "video_id": video_id,
#                         "chapter": f"Segment {len(documents)+1}",
#                         "start": current_start,
#                         "end": transcript[-1].start + transcript[-1].duration,
#                         "source": f"https://www.youtube.com/watch?v={video_id}&t={int(current_start)}s"
#                     }
#                 )
#             )

#     return documents


def fetch_transcript_time_chunks(video_id: str, window_size: int = 45):
    ytt_api=YouTubeTranscriptApi()
    transcript = ytt_api.fetch(video_id, languages=['en'])
    
    documents = []
    current_text, current_start = [], transcript[0].start


    for entry in transcript:
        current_text.append(entry.text)
        # check if window size exceeded
        if entry.start - current_start >= window_size:
            documents.append(
                Document(
                    page_content=" ".join(current_text),
                    metadata={
                        "start": current_start,
                        "end": entry.start,
                        "source": f"https://www.youtube.com/watch?v={video_id}&t={int(current_start)}s"
                    }
                )
            )
            current_text, current_start = [], entry.start

    # add leftover
    if current_text:
        documents.append(
            Document(
                page_content=" ".join(current_text),
                metadata={
                    "start": current_start,
                    "end": transcript[-1].start + transcript[-1].duration,
                    "source": f"https://www.youtube.com/watch?v={video_id}&t={int(current_start)}s"
                }
            )
        )

    return documents


def chat_with_video(video_url, question):
    # 1. Extract video ID
    video_id = extract_video_id(video_url)

    # 2. Fetch transcript (safe for all versions)
    
    # print(f"Transcript length: {len(transcript_text)} characters")
    # if not transcript_text.strip():
    #     raise ValueError("Transcript is empty.")

    # 3. Convert to documents
    # docs = [Document(page_content=transcript_text)]

    # 4. Split text
    # splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    # chunked_docs = [doc for doc in splitter.split_documents(docs) if doc.page_content.strip()]

    ## chunking based on chapters using semantic drift along with the metadata
    chunked_docs = fetch_transcript_time_chunks(video_id)
    # print(chunked_docs[0])
    

    # 5. Create embeddings & vector store
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vector_store = FAISS.from_documents(chunked_docs, embeddings)


    # 6. Retriever
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 5})

    # 7. Prompt
    # prompt = PromptTemplate(
    #     template="""
    #     You are a helpful assistant.
    #     Answer ONLY from the provided transcript context.
    #     If the context is insufficient, just say you don't know.
    #     And you must answer in the language of the question.
    #     And if there are any casual questions like greeting or queries u must answer them in friendly tone
    #     Also if the question is not related to the video, politely inform them that you can only answer questions related to the video content.
    #     If the question mentions a specific time, use the relevant part of the transcript to answer.

    #     Also if the question is requests to provide al the chapters in the video, you must provide the chapters with their timestamps and a short description of each chapter.  


    #     Context:
        
    #     {context}
    #     Question: {question}
    #     """,
    #     input_variables=['context', 'question']
    # )\
    

    prompt= PromptTemplate(
        template="""
        You are a helpful assistant specialized in answering questions about a YouTube video transcript.

        Rules:
        - Answer ONLY from the provided transcript context.
        - If the context is insufficient, say: "I don't know from this video."
        - Always answer in the same language as the user's question.
        - If the user greets or asks a casual/non-video question, reply in a friendly conversational tone.
        - If the question is unrelated to the video, politely say you can only answer questions about the video.
        - If the user asks about a specific time (e.g., "at 2:35"), use the transcript metadata to answer with reference to that time.
        - If answering a direct query, include the exact timestamp (with clickable YouTube link).
        - When summarizing, provide bullet points and **keep clickable timestamps for each key moment**.
        - Clickable timestamp format:
            [mm:ss → mm:ss]
        - Do not invent timestamps that are not in the transcript metadata.
        - If the user asks about a specific time (e.g., 2:30), retrieve the nearest segment.
        - Always include the timestamp range (from metadata) in your answers.

         Context (from transcript):
        {context}

        Question: {question}
    
        """,
        input_variables=['context', 'question']
    )


    # 8. LLM
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.7,
        max_tokens=500
    )

    # 9. RAG chain
    # def format_docs(retrieved_docs):
    #     formatted = []
    #     for doc in retrieved_docs:
    #         meta = doc.metadata
    #         ts = f"[{int(meta['start'])}s → {int(meta.get('end', meta['start'] + 10))}s]" if "start" in meta else ""
    #         chapter = f"({meta['chapter']})" if "chapter" in meta else ""
    #         formatted.append(f"{ts} {chapter}\n{doc.page_content}")
    #     return "\n\n".join(formatted)
    # def format_docs(retrieved_docs):
    #     formatted = []
    #     for doc in retrieved_docs:
    #         meta = doc.metadata
    #         start = int(meta["start"])
    #         end = int(meta.get("end", start + 10))
    #         chapter = f" ({meta['chapter']})" if "chapter" in meta else ""

    #     # Clickable YouTube link
    #         yt_link = meta.get("source", f"https://www.youtube.com/watch?v=VIDEO_ID&t={start}s")
    #         ts = f"[{start}s → {end}s]({yt_link})"

    #         formatted.append(f"{ts}{chapter}\n{doc.page_content}")
    #     return "\n\n".join(formatted)
    def format_docs(retrieved_docs):
        def format_time(seconds: int) -> str:
            minutes = seconds // 60
            sec = seconds % 60
            return f"{minutes:02d}:{sec:02d}"

        formatted = []
        for doc in retrieved_docs:
            meta = doc.metadata
            start = int(meta["start"])
            end = int(meta.get("end", start + 10))
            chapter = f" ({meta['chapter']})" if "chapter" in meta else ""

        # Clickable YouTube link
            yt_link = meta.get("source", f"https://www.youtube.com/watch?v=VIDEO_ID&t={start}s")
            ts = f"[{format_time(start)} → {format_time(end)}]({yt_link})"

            formatted.append(f"{ts}{chapter}\n{doc.page_content}")

        return "\n\n".join(formatted)




    # parallel_chain = RunnableParallel({
    #     'context': retriever | RunnableLambda(format_docs),
    #     'question': RunnablePassthrough()
    # })

    parallel_chain = RunnableParallel({
    'context': RunnableLambda(lambda q: format_docs(get_context_for_question(q, retriever, chunked_docs))),
    'question': RunnablePassthrough()
    })
    print("hello")


    parser = StrOutputParser()
    main_chain = parallel_chain | prompt | llm | parser

    # 10. Get answer
    print(main_chain.invoke(question))
chat_with_video("https://www.youtube.com/watch?v=HEfHFsfGXjs", "Why is the mass 100 times")
