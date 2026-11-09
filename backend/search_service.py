"""Stateless public metadata service for the GitHub Pages frontend.

Audio jobs stay on the authenticated, persistent Docker backend.
"""
import collections
import os
import time
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.app.youtube import YouTube, parse_url

app = FastAPI(title="MusicPleasure Search", docs_url=None, redoc_url=None)
youtube = YouTube(os.getenv("YOUTUBE_API_KEY", ""), int(os.getenv("YOUTUBE_DAILY_BUDGET", "8000")))
requests = collections.defaultdict(collections.deque)
app.add_middleware(CORSMiddleware,
    allow_origins=["https://totoro0419.github.io", "https://musicpleasure-ibuki.ibukioike2009.chatgpt.site", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"], allow_headers=["Content-Type", "Authorization"])

@app.middleware("http")
async def limit(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/api/health":
        return await call_next(request)
    if request.method != "GET":
        return JSONResponse({"detail": "音声の取得・保存には、設定からフルバックエンドを接続してください"}, status_code=503)
    client = request.headers.get("x-vercel-forwarded-for") if os.getenv("VERCEL") else None
    client = client or (request.client.host if request.client else "unknown")
    now = time.monotonic()
    bucket = requests[client]
    while bucket and bucket[0] < now - 60: bucket.popleft()
    if len(bucket) >= 30:
        return JSONResponse({"detail": "検索回数の上限です。1分後にもう一度お試しください"}, status_code=429)
    bucket.append(now)
    if len(requests) > 10000: requests.clear()
    return await call_next(request)

@app.get("/api/health")
async def health():
    return {"status": "ok", "youtubeApi": bool(youtube.key), "ai": False,
            "ffmpeg": False, "downloader": False, "authentication": False,
            "capabilities": {"search": True, "downloads": False, "ai": False}}

@app.get("/api/search")
async def search(q: str = Query(min_length=1, max_length=300),
                 page: str = Query("", max_length=500),
                 kind: str = Query("all", pattern="^(all|audio|mv|live|cover|remix|unknown)$")):
    return await youtube.search(q, page, kind)

@app.get("/api/playlists/{ident}")
async def playlist(ident: str, page: str = Query("", max_length=500)):
    return await youtube.playlist(ident, page)

@app.get("/api/parse-url")
async def url(url: str = Query(max_length=2048)):
    try: return parse_url(url)
    except ValueError as e: raise HTTPException(400, str(e))
