from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.schemas import RouteRequest
from backend.app.services.travel_engine import best_overview, build_route, network_snapshot


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "frontend"

app = FastAPI(
    title="WayWise",
    description="Smart multi-modal travel planning and disruption management platform for Mumbai.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "WayWise"}


@app.get("/api/client-config")
def client_config() -> dict:
    browser_key = os.getenv("GOOGLE_MAPS_BROWSER_API_KEY") or os.getenv("GOOGLE_MAPS_API_KEY") or ""
    return {
        "google_maps_browser_key": browser_key,
        "has_google_maps": bool(browser_key),
        "city_scope": "Mumbai",
    }


@app.get("/api/network")
def get_network() -> dict:
    return network_snapshot()


@app.post("/api/options")
def get_options(request: RouteRequest) -> dict:
    try:
        options = build_route(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"options": [option.model_dump() for option in options]}


@app.post("/api/overview")
def get_overview(request: RouteRequest) -> dict:
    try:
        overview = best_overview(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return overview


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")
