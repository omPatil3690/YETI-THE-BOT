# YouTube Video Bot

This project contains a FastAPI backend and a Chrome extension that lets you chat with a YouTube video's transcript, generate a timestamped summary, and jump through auto-generated sections.

## What it does

- Answers questions about the current YouTube video using transcript-grounded retrieval.
- Generates a summary with clickable timestamps.
- Builds timestamped video sections automatically so users can jump to key parts.
- Lets each user save their own Groq API key locally in encrypted form, so the assistant uses the user's key instead of a project-owned token.
- Works inside YouTube as a floating Chrome extension widget.

## Project layout

- `backend.py`: FastAPI app exposing chat, summary, sections, and credential endpoints.
- `secret_store.py`: Local encrypted credential storage using Windows DPAPI.
- `youtube_rag.py`: Transcript fetching, chunking, retrieval, summary, and section generation.
- `chrome_extension/`: Chrome extension files to load as an unpacked extension.
- `chat-widget/`: Older CRA sandbox kept in the repo, but `chrome_extension/` is the active extension surface.

## Setup

1. Create or activate a Python environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start the backend:

```bash
uvicorn backend:app --reload
```

4. Open Chrome and load `chrome_extension/` as an unpacked extension.
5. Open the widget inside YouTube, click `API Key`, and save your own Groq API key.

## Backend endpoints

- `POST /ask`: Ask a question about a video.
- `POST /summary`: Get a timestamped summary.
- `POST /sections`: Get auto-generated timestamped sections.
- `POST /analyze`: Get summary and sections together.
- `GET /credentials/status`: Check whether a Groq API key is already saved.
- `POST /credentials/groq`: Save a Groq API key in local encrypted storage.
- `DELETE /credentials/groq`: Remove the saved Groq API key.
- `POST /process`: Legacy alias for `/ask`.

## Notes

- The first run may download the embedding model used for semantic retrieval.
- Transcript availability depends on whether YouTube exposes captions for the video.
- The extension expects the backend at `http://127.0.0.1:8000`.
- On Windows, the saved Groq key is encrypted locally with DPAPI and is not stored in the repo.
