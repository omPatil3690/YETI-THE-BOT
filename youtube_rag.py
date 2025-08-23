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
from dotenv import load_dotenv

load_dotenv()

# API Key
groq_api_key = os.getenv("GROQ_API_KEY")


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



def chat_with_video(video_url, question):
    # 1. Extract video ID
    video_id = extract_video_id(video_url)

    # 2. Fetch transcript (safe for all versions)
    transcript_text = fetch_transcript(video_id)
    print(f"Transcript length: {len(transcript_text)} characters")
    if not transcript_text.strip():
        raise ValueError("Transcript is empty.")

    # 3. Convert to documents
    docs = [Document(page_content=transcript_text)]

    # 4. Split text
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunked_docs = [doc for doc in splitter.split_documents(docs) if doc.page_content.strip()]

    # 5. Create embeddings & vector store
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    vector_store = FAISS.from_documents(chunked_docs, embeddings)

    # 6. Retriever
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 4})

    # 7. Prompt
    prompt = PromptTemplate(
        template="""
        You are a helpful assistant.
        Answer ONLY from the provided transcript context.
        If the context is insufficient, just say you don't know.
        And you must answer in the language of the question.
        And if there are any casual questions like greeting or queries u must answer them in friendly tone
        
        {context}
        Question: {question}
        """,
        input_variables=['context', 'question']
    )

    # 8. LLM
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.7,
        max_tokens=300
    )

    # 9. RAG chain
    def format_docs(retrieved_docs):
        return "\n\n".join(doc.page_content for doc in retrieved_docs)

    parallel_chain = RunnableParallel({
        'context': retriever | RunnableLambda(format_docs),
        'question': RunnablePassthrough()
    })

    parser = StrOutputParser()
    main_chain = parallel_chain | prompt | llm | parser

    # 10. Get answer
    return main_chain.invoke(question)
# chat_with_video("https://www.youtube.com/watch?v=iv-5mZ_9CPY&t=5s", "What is the main topic of the video?")
