"""FastAPI app: serves the dashboard UI and a small JSON REST API."""

from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

from .config import settings
from .db import Database
from .gmail_client import GmailClient
from .pipeline import sync

STATIC_DIR = Path(__file__).parent / "static"

_sync_lock = threading.Lock()
_sync_state: dict = {
    "running": False,
    "last_result": None,
    "started_at": None,
    "finished_at": None,
}


def get_db() -> Database:
    settings.ensure_dirs()
    return Database(settings.db_path)


def get_client() -> GmailClient:
    return GmailClient()


def create_app() -> FastAPI:
    app = FastAPI(title="Internship Dashboard", version="0.1.0")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    # -------------------------------------------------------------- helpers

    def _sync_job(full: bool) -> None:
        with _sync_lock:
            if _sync_state["running"]:
                return
            _sync_state.update(running=True, started_at=_now(), last_result=None)
        try:
            result = sync(get_client(), get_db(), full=full)
            _sync_state["last_result"] = result.to_dict()
        except Exception as exc:  # surface failures to /api/status
            _sync_state["last_error"] = str(exc)
        finally:
            _sync_state["running"] = False
            _sync_state["finished_at"] = _now()

    def _run_in_background(full: bool) -> bool:
        if _sync_state["running"]:
            return False
        t = threading.Thread(target=_sync_job, args=(full,), daemon=True)
        t.start()
        return True

    # ------------------------------------------------------------------ meta

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": "0.1.0"}

    @app.get("/api/status")
    def status():
        db = get_db()
        return {
            "auth": get_client().has_token(),
            "sync": {
                **_sync_state,
                "last_error": _sync_state.get("last_error"),
            },
            "last_completed_sync": db.get_meta("last_sync"),
            "message_count": db.stage_counts()["total"],
            "email": None,
        }

    # ----------------------------------------------------------------- sync

    @app.post("/api/refresh")
    def refresh(full: bool = False):
        started = _run_in_background(full)
        if not started:
            return {"status": "already_running"}
        return {"status": "started", "full": full}

    # ----------------------------------------------------------------- reads

    @app.get("/api/stats")
    def stats():
        db = get_db()
        counts = db.stage_counts()
        return {
            "by_stage": counts,
            "total": counts["total"],
            "needs_action": len(db.followups(older_than_days=0, limit=500)),
            "last_sync": db.get_meta("last_sync"),
        }

    @app.get("/api/companies")
    def companies():
        return {"companies": get_db().company_summary()}

    @app.get("/api/followups")
    def followups(limit: int = 100):
        db = get_db()
        fups = []
        for row in db.followups(older_than_days=0, limit=limit):
            from datetime import datetime, timezone

            age_days = 0
            if row.get("date_ts"):
                age_days = max(
                    0,
                    int(
                        (datetime.now(tz=timezone.utc).timestamp() * 1000 - row["date_ts"])
                        / 86_400_000
                    ),
                )
            row["days_old"] = age_days
            fups.append(row)
        return {"followups": fups}

    @app.get("/api/messages")
    def messages(
        stage: str = Query("all"),
        company: str = Query("all"),
        q: str = Query(""),
        needs_action: Optional[bool] = Query(None),
        limit: int = Query(200, le=1000),
        offset: int = Query(0),
    ):
        db = get_db()
        rows = db.get_messages(
            stage=stage,
            company=company,
            search=q,
            needs_action=needs_action,
            limit=limit,
            offset=offset,
        )
        for row in rows:
            row["stage"] = db.effective_stage(row)
        return {"messages": rows, "count": len(rows)}

    @app.get("/api/messages/{message_id}/body")
    def message_body(message_id: str):
        client = get_client()
        if not client.has_token():
            raise HTTPException(status_code=401, detail="Not authenticated with Gmail")
        return {"id": message_id, "body": client.fetch_body(message_id)}

    # ----------------------------------------------------------------- edits

    class MessageUpdate(BaseModel):
        stage: Optional[str] = None
        note: Optional[str] = None
        action: Optional[str] = None  # "dismiss" | "rearm"

    @app.patch("/api/messages/{message_id}")
    def update_message(message_id: str, update: MessageUpdate):
        db = get_db()
        if not db.get_message(message_id):
            raise HTTPException(status_code=404, detail="Message not found")
        if update.stage is not None:
            db.set_stage_override(message_id, update.stage)
        if update.note is not None:
            db.set_note(message_id, update.note)
        if update.action == "dismiss":
            db.clear_action(message_id)
        elif update.action == "rearm":
            db.rearm_action(message_id)
        return {"ok": True, "id": message_id}

    return app


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


app = create_app()