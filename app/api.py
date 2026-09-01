"""FastAPI app: serves the dashboard UI and a small JSON REST API.

Multi-user: every authenticated request is tied to a signed session cookie
(see app/auth.py) pointing at a per-user database record. Each user's Gmail
tokens are stored (encrypted) and their sync + dashboard data are scoped to
their own rows.
"""

import secrets
import threading
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, oauth
from .auth import SESSION_COOKIE
from .config import settings
from .db import Database
from .gmail_client import GmailClient
from .pipeline import sync

STATIC_DIR = Path(__file__).parent / "static"

# Per-user sync lock + state so concurrent logins don't block each other.
_sync_locks: dict = {}
_sync_state: dict = {}


def get_db() -> Database:
    settings.ensure_dirs()
    return Database(settings.db_path)


def _user_id_from(request: Request) -> Optional[int]:
    """Resolve the current user id from the session cookie, or None."""
    token = request.cookies.get(SESSION_COOKIE)
    return auth.validate_session(token)


def _require_user(db: Database, request: Request) -> int:
    user_id = _user_id_from(request)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    if db.get_user(user_id) is None:
        raise HTTPException(status_code=401, detail="Session is no longer valid")
    return user_id


def _get_synced_lock(user_id: int) -> tuple:
    with threading.Lock():
        if user_id not in _sync_locks:
            _sync_locks[user_id] = threading.Lock()
            _sync_state[user_id] = {}
    return _sync_locks[user_id], _sync_state[user_id]


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def create_app() -> FastAPI:
    app = FastAPI(title="Internship Dashboard", version="0.1.0")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    # -------------------------------------------------------------- meta

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": "0.1.0"}

    @app.get("/api/me")
    def me(request: Request):
        db = get_db()
        user_id = _user_id_from(request)
        if user_id is None:
            return {"authenticated": False}
        user = db.get_user(user_id)
        if not user:
            return {"authenticated": False}
        return {
            "authenticated": True,
            "id": user["id"],
            "email": user["email"],
            "google_user_id": user["google_user_id"],
        }

    # ------------------------------------------------------------- oauth

    @app.get("/oauth/login")
    def oauth_login():
        if not oauth.is_configured():
            return RedirectResponse("/#settings")
        state = secrets.token_urlsafe(16)
        # Keep the last state for a lightweight CSRF check. (For a single
        # instance this is fine; for horizontal scale store state server-side.)
        app.state._last_oauth_state = state
        return RedirectResponse(oauth.authorization_url(state))

    @app.get("/oauth/callback")
    def oauth_callback(request: Request, code: Optional[str] = Query(None), error: Optional[str] = Query(None)):
        if error:
            raise HTTPException(status_code=400, detail=f"Authorization failed: {error}")
        if not code:
            raise HTTPException(status_code=400, detail="Missing authorization code")

        db = get_db()
        try:
            state = request.query_params.get("state") or getattr(app.state, "_last_oauth_state", None)
            result = oauth.exchange_code(code, state)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not complete sign-in: {exc}")

        if not result["google_user_id"]:
            raise HTTPException(
                status_code=400,
                detail="Could not determine your Google account. Please try again.",
            )

        user_id = db.get_or_create_user(result["google_user_id"], result["email"])
        auth.store_tokens(
            db,
            user_id,
            result["access_token"],
            result["refresh_token"],
            result["expires_at"],
        )

        session = auth.create_session(user_id)
        resp = RedirectResponse("/#connected")
        resp.set_cookie(
            SESSION_COOKIE,
            session,
            httponly=True,
            samesite="lax",
            secure=settings.base_url.startswith("https://"),
            max_age=60 * 60 * 24 * 30,
        )
        return resp

    @app.post("/api/logout")
    def logout():
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(SESSION_COOKIE)
        return resp

    @app.post("/api/disconnect")
    def disconnect(request: Request):
        db = get_db()
        user_id = _user_id_from(request)
        if user_id is not None:
            auth.delete_tokens(db, user_id)
        return {"ok": True}

    # ------------------------------------------------------------- settings

    class OAuthConfig(BaseModel):
        client_id: str = ""
        client_secret: str = ""
        base_url: Optional[str] = None

    @app.get("/api/settings")
    def get_settings():
        from .secret_store import secret_store

        client_id = settings.google_client_id or secret_store.get("google_client_id")
        secret_set = bool(
            settings.google_client_secret or secret_store.get("google_client_secret")
        )
        return {
            "configured": oauth.is_configured(),
            "client_id": client_id or "",
            "client_secret_set": secret_set,
            "base_url": settings.base_url,
            "redirect_uri": settings.redirect_uri,
            "oauth_redirect_uri": f"{settings.base_url}/oauth/callback",
        }

    @app.post("/api/settings")
    def save_settings(cfg: OAuthConfig):
        from .secret_store import secret_store

        to_store = {}
        if cfg.client_id:
            to_store["google_client_id"] = cfg.client_id.strip()
        if cfg.client_secret:
            to_store["google_client_secret"] = cfg.client_secret.strip()
        if to_store:
            secret_store.set_many(to_store)
        return {"ok": True, "configured": oauth.is_configured()}

    # -------------------------------------------------------------- status

    @app.get("/api/status")
    def status(request: Request):
        db = get_db()
        user_id = _user_id_from(request)
        sync = _sync_state.get(user_id, {})
        message_count = 0
        email = None
        if user_id is not None:
            user = db.get_user(user_id)
            email = user["email"] if user else None
            try:
                message_count = db.stage_counts(user_id)["total"]
            except Exception:
                message_count = 0
        return {
            "authenticated": user_id is not None,
            "oauth_configured": oauth.is_configured(),
            "client_id": oauth.gis_client_id(),
            "redirect_uri": settings.redirect_uri,
            "base_url": settings.base_url,
            "email": email,
            "auth": user_id is not None,
            "sync": {
                **sync,
                "last_error": sync.get("last_error"),
            },
            "last_completed_sync": db.get_meta(f"last_sync_{user_id}") if user_id else None,
            "message_count": message_count,
        }

    # --------------------------------------------------------------- sync

    def _sync_job(user_id: int, full: bool) -> None:
        lock, state = _get_synced_lock(user_id)
        with lock:
            if state.get("running"):
                return
            state.update(running=True, started_at=_now(), last_result=None, last_error=None)
        try:
            db = get_db()
            token = auth.load_token_dict(db, user_id)
            if not token:
                raise HTTPException(status_code=401, detail="Not connected to Gmail")

            from .secret_store import secret_store

            client_id = settings.google_client_id or secret_store.get("google_client_id")
            client_secret = settings.google_client_secret or secret_store.get("google_client_secret")

            client = GmailClient(
                token["access_token"],
                token["refresh_token"],
                client_id,
                client_secret,
                expires_at=token.get("expires_at"),
            )
            result = sync(client, db, user_id, full=full)
            state["last_result"] = result.to_dict()
        except Exception as exc:
            state["last_error"] = str(exc)
        finally:
            with lock:
                state["running"] = False
                state["finished_at"] = _now()

    def _start_sync(user_id: int, full: bool) -> bool:
        lock, state = _get_synced_lock(user_id)
        with lock:
            if state.get("running"):
                return False
            state.setdefault("running", False)
        t = threading.Thread(target=_sync_job, args=(user_id, full), daemon=True)
        t.start()
        return True

    @app.post("/api/refresh")
    def refresh(request: Request, full: bool = False):
        user_id = _require_user(get_db(), request)
        started = _start_sync(user_id, full)
        return {"status": "started" if started else "already_running", "full": full}

    # ------------------------------------------------------------ reads

    @app.get("/api/stats")
    def stats(request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        counts = db.stage_counts(user_id)
        return {
            "by_stage": counts,
            "total": counts["total"],
            "needs_action": len(db.followups(user_id, older_than_days=0, limit=500)),
            "last_sync": db.get_meta(f"last_sync_{user_id}"),
        }

    @app.get("/api/companies")
    def companies(request: Request):
        user_id = _require_user(get_db(), request)
        return {"companies": get_db().company_summary(user_id)}

    @app.get("/api/followups")
    def followups(request: Request, limit: int = 100):
        db = get_db()
        user_id = _require_user(db, request)
        fups = []
        for row in db.followups(user_id, older_than_days=0, limit=limit):
            if row.get("date_ts"):
                from datetime import datetime, timezone

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
        request: Request,
        stage: str = Query("all"),
        company: str = Query("all"),
        q: str = Query(""),
        needs_action: Optional[bool] = Query(None),
        limit: int = Query(200, le=1000),
        offset: int = Query(0),
    ):
        db = get_db()
        user_id = _require_user(db, request)
        rows = db.get_messages(
            user_id,
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
    def message_body(message_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_message(user_id, message_id):
            raise HTTPException(status_code=404, detail="Message not found")
        from .secret_store import secret_store

        token = auth.load_token_dict(db, user_id)
        if not token:
            raise HTTPException(status_code=401, detail="Not connected to Gmail")
        client = GmailClient(
            token["access_token"],
            token["refresh_token"],
            settings.google_client_id or secret_store.get("google_client_id"),
            settings.google_client_secret or secret_store.get("google_client_secret"),
            expires_at=token.get("expires_at"),
        )
        return {"id": message_id, "body": client.fetch_body(message_id)}

    # -------------------------------------------------------------- edits

    class MessageUpdate(BaseModel):
        stage: Optional[str] = None
        note: Optional[str] = None
        action: Optional[str] = None  # "dismiss" | "rearm"

    @app.patch("/api/messages/{message_id}")
    def update_message(message_id: str, request: Request, update: MessageUpdate = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_message(user_id, message_id):
            raise HTTPException(status_code=404, detail="Message not found")
        if update.stage is not None:
            db.set_stage_override(user_id, message_id, update.stage)
        if update.note is not None:
            db.set_note(user_id, message_id, update.note)
        if update.action == "dismiss":
            db.clear_action(user_id, message_id)
        elif update.action == "rearm":
            db.rearm_action(user_id, message_id)
        return {"ok": True, "id": message_id}

    return app


app = create_app()