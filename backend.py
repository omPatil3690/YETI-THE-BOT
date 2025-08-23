from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from youtube_rag import chat_with_video

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Backend is working!"}

@app.post("/process")
async def process_data(request: Request):
    data = await request.json()
    video_url = data.get("video_url")
    question = data.get("question")

    answer = chat_with_video(video_url, question)
    return {"answer": answer}
