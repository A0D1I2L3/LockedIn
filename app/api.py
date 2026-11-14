"""FastAPI app: dashboard UI plus a small JSON API for the tracker.

Every authenticated request is scoped to the signed session cookie pointing at
a row in `users`. Google is used for sign-in only; pasted emails are parsed
locally and never fetched from a mailbox.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, oauth, reminders
from .auth import SESSION_COOKIE
from .config import settings
from .db import Database
from .models import (
    ACTION_FOLLOW_UP,
    ACTION_REQUIRED,
    ACTION_WAITING,
    OUTCOME_ASSESSMENT,
    OUTCOME_FOLLOW_UP,
    OUTCOME_INTERVIEW,
    OUTCOME_NO_RESPONSE,
    OUTCOME_OFFER,
    OUTCOME_OTHER,
    OUTCOME_REJECTED,
    OUTCOME_WITHDRAWN,
    REMINDER_DISMISSED,
    REMINDER_DONE,
    STAGE_APPLIED,
    STAGE_ASSESSMENT,
    STAGE_INTERVIEW,
    STAGE_OFFER,
    STAGE_REJECTED,
    STAGE_WITHDRAWN,
    STAGES,
    STATUS_ACTIVE,
    STATUS_CLOSED,
)
from .notifications import application_calendar, notification_feed, user_calendar
from .parser.llm import PROVIDERS, LLMConfig, provider_defaults
from .parser.pipeline import parse_email
from .timeutil import MS_PER_DAY, now_ms

logger = logging.getLogger("lockedin.api")

STATIC_DIR = Path(__file__).parent / "static"

USER_DEFAULT_SETTINGS = {
    "parser_mode": "auto",
    "default_follow_up_days": settings.default_follow_up_days,
    "timezone": settings.app_timezone,
    "notifications_enabled": True,
    "llm_provider": settings.llm_provider or "openai",
    "llm_base_url": "",
    "llm_model": "",
}

OUTCOME_STAGE = {
    OUTCOME_REJECTED: STAGE_REJECTED,
    OUTCOME_WITHDRAWN: STAGE_WITHDRAWN,
    OUTCOME_OFFER: STAGE_OFFER,
    OUTCOME_ASSESSMENT: STAGE_ASSESSMENT,
    OUTCOME_INTERVIEW: STAGE_INTERVIEW,
}

TERMINAL = {STAGE_REJECTED, STAGE_WITHDRAWN}


def get_db() -> Database:
    settings.ensure_dirs()
    return Database(settings.db_path)


def _user_id_from(request: Request) -> Optional[int]:
    return auth.validate_session(request.cookies.get(SESSION_COOKIE))


def _require_user(db: Database, request: Request) -> int:
    user_id = _user_id_from(request)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    if db.get_user(user_id) is None:
        raise HTTPException(status_code=401, detail="Session is no longer valid")
    return user_id


def _user_settings(db: Database, user_id: int) -> dict:
    return {**USER_DEFAULT_SETTINGS, **db.get_user_settings(user_id)}


def _llm_config(db: Database, user_id: int) -> LLMConfig:
    from .secret_store import secret_store

    prefs = _user_settings(db, user_id)
    provider = (prefs.get("llm_provider") or settings.llm_provider or "openai").lower()
    defaults = provider_defaults(provider)
    env_matches = settings.llm_provider == provider
    api_key = secret_store.get(f"llm_api_key_{user_id}") or settings.llm_api_key
    return LLMConfig(
        provider=provider,
        base_url=prefs.get("llm_base_url")
        or (settings.llm_base_url if env_matches else "")
        or defaults["base_url"],
        api_key=api_key or "",
        model=prefs.get("llm_model")
        or (settings.llm_model if env_matches else "")
        or defaults["model"],
        timeout=settings.llm_timeout_seconds,
    )


def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _parse_when(value, timezone_name: str = "UTC") -> Optional[int]:
    """Accept epoch ms, numeric strings, ISO dates, or ISO datetimes."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value)
    raw = str(value).strip()
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    tz = _zone(timezone_name)
    if parsed.tzinfo is None:
        if parsed.time() == dt_time(0, 0) and "T" not in raw:
            parsed = datetime.combine(parsed.date(), dt_time(9, 0), tzinfo=tz)
        else:
            parsed = parsed.replace(tzinfo=tz)
    return int(parsed.timestamp() * 1000)


def _default_check_back(days: int, timezone_name: str) -> int:
    tz = _zone(timezone_name)
    now_local = datetime.now(tz=tz)
    target = (now_local + timedelta(days=max(1, days))).date()
    return int(datetime.combine(target, dt_time(9, 0), tzinfo=tz).timestamp() * 1000)


def _append_note(existing: str, note: str) -> str:
    note = (note or "").strip()
    if not note:
        return existing or ""
    stamp = datetime.now().strftime("%Y-%m-%d")
    line = f"[{stamp}] {note}"
    return f"{existing}\n{line}".strip() if existing else line


class ApplicationIn(BaseModel):
    company: str = ""
    role: str = ""
    location: str = ""
    job_url: str = ""
    source: str = ""
    stage: str = STAGE_APPLIED
    applied_at: Optional[str] = None
    check_back_at: Optional[str] = None
    check_back_source: str = "manual"
    next_action: str = ""
    next_action_at: Optional[str] = None
    notes: str = ""


class ApplicationPatch(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None
    job_url: Optional[str] = None
    source: Optional[str] = None
    stage: Optional[str] = None
    status: Optional[str] = None
    action_state: Optional[str] = None
    next_action: Optional[str] = None
    next_action_at: Optional[str] = None
    check_back_at: Optional[str] = None
    check_back_source: Optional[str] = None
    applied_at: Optional[str] = None
    notes: Optional[str] = None


class OutcomeIn(BaseModel):
    outcome: str
    note: str = ""
    stage: Optional[str] = None


class SnoozeIn(BaseModel):
    days: int = Field(default=3, ge=1, le=90)


class EmailIn(BaseModel):
    raw_text: str
    subject: str = ""
    from_email: str = ""
    received_at: Optional[str] = None
    company_hint: str = ""
    role_hint: str = ""
    stage_hint: str = ""
    apply: bool = False


class PreferencesIn(BaseModel):
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    parser_mode: Optional[str] = None
    default_follow_up_days: Optional[int] = Field(default=None, ge=1, le=90)
    timezone: Optional[str] = None
    notifications_enabled: Optional[bool] = None
    llm_provider: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None


def _serialize_app(app: dict) -> dict:
    data = dict(app)
    data["is_terminal"] = data.get("stage") in TERMINAL
    return data


def _validate_stage(stage: Optional[str]) -> Optional[str]:
    if stage is None:
        return None
    if stage not in STAGES:
        raise HTTPException(status_code=400, detail=f"Unknown stage: {stage}")
    return stage


def _apply_stage_side_effects(fields: dict, current: dict) -> dict:
    stage = fields.get("stage")
    if stage in TERMINAL:
        fields.setdefault("status", STATUS_CLOSED)
        fields.setdefault("closed_at", now_ms())
        fields.setdefault("check_back_at", None)
        fields.setdefault("next_action_at", None)
        fields["action_state"] = ACTION_WAITING
        if not fields.get("next_action"):
            fields["next_action"] = "No action needed"
    elif stage and current.get("status") == STATUS_CLOSED:
        fields.setdefault("status", STATUS_ACTIVE)
        fields.setdefault("closed_at", None)
    return fields


def create_app() -> FastAPI:
    app = FastAPI(title="Internship Dashboard", version="0.2.0")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    # ------------------------------------------------------------------ meta

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": "0.2.0"}

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

    @app.get("/api/status")
    def status(request: Request):
        db = get_db()
        user_id = _user_id_from(request)
        payload = {
            "authenticated": user_id is not None,
            "oauth_configured": oauth.is_configured(),
            "client_id": oauth.gis_client_id(),
            "redirect_uri": settings.redirect_uri,
            "base_url": settings.base_url,
            "email": None,
            "stats": {"by_stage": {}, "total": 0, "active": 0, "due": 0, "upcoming": 0},
        }
        if user_id is not None:
            user = db.get_user(user_id)
            payload["email"] = user["email"] if user else None
            payload["stats"] = db.stats(user_id)
        return payload

    # ----------------------------------------------------------------- oauth

    @app.get("/oauth/login")
    def oauth_login():
        if not oauth.is_configured():
            return RedirectResponse("/?settings=1")
        state = secrets.token_urlsafe(16)
        app.state._last_oauth_state = state
        return RedirectResponse(oauth.authorization_url(state))

    @app.get("/oauth/callback")
    def oauth_callback(
        request: Request,
        code: Optional[str] = Query(None),
        error: Optional[str] = Query(None),
    ):
        if error:
            raise HTTPException(status_code=400, detail=f"Authorization failed: {error}")
        if not code:
            raise HTTPException(status_code=400, detail="Missing authorization code")
        db = get_db()
        try:
            state = request.query_params.get("state") or getattr(
                app.state, "_last_oauth_state", None
            )
            result = oauth.exchange_code(code, state)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not complete sign-in: {exc}")
        if not result["google_user_id"]:
            raise HTTPException(
                status_code=400,
                detail="Could not determine your Google account. Please try again.",
            )
        user_id = db.get_or_create_user(result["google_user_id"], result["email"])
        session = auth.create_session(user_id)
        resp = RedirectResponse("/#today")
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

    # -------------------------------------------------------------- settings

    @app.get("/api/settings")
    def get_settings(request: Request):
        from .secret_store import secret_store

        db = get_db()
        user_id = _user_id_from(request)
        client_id = settings.google_client_id or secret_store.get("google_client_id")
        secret_set = bool(
            settings.google_client_secret or secret_store.get("google_client_secret")
        )
        payload = {
            "configured": oauth.is_configured(),
            "client_id": client_id or "",
            "client_secret_set": secret_set,
            "base_url": settings.base_url,
            "redirect_uri": settings.redirect_uri,
            "oauth_redirect_uri": settings.redirect_uri,
        }
        if user_id is not None:
            prefs = _user_settings(db, user_id)
            llm = _llm_config(db, user_id)
            payload["preferences"] = {
                **prefs,
                "llm_provider": llm.provider,
                "llm_base_url": llm.base_url,
                "llm_model": llm.model,
                "llm_api_key_set": bool(
                    secret_store.get(f"llm_api_key_{user_id}") or settings.llm_api_key
                ),
            }
        return payload

    @app.post("/api/settings")
    def save_settings(request: Request, cfg: PreferencesIn = Body(...)):
        from .secret_store import secret_store

        db = get_db()
        user_id = _user_id_from(request)
        to_store = {}
        if cfg.client_id:
            to_store["google_client_id"] = cfg.client_id.strip()
        if cfg.client_secret:
            to_store["google_client_secret"] = cfg.client_secret.strip()
        if to_store:
            secret_store.set_many(to_store)

        if user_id is not None:
            values = {}
            if cfg.parser_mode in {"rules", "llm", "auto"}:
                values["parser_mode"] = cfg.parser_mode
            if cfg.default_follow_up_days is not None:
                values["default_follow_up_days"] = cfg.default_follow_up_days
            if cfg.timezone:
                values["timezone"] = cfg.timezone
            if cfg.notifications_enabled is not None:
                values["notifications_enabled"] = cfg.notifications_enabled
            current = db.get_user_settings(user_id)
            provider = (cfg.llm_provider or "").strip().lower()
            if provider in PROVIDERS:
                values["llm_provider"] = provider
                if provider != current.get("llm_provider"):
                    values.setdefault("llm_base_url", "")
                    values.setdefault("llm_model", "")
            if cfg.llm_base_url is not None:
                values["llm_base_url"] = cfg.llm_base_url.strip()
            if cfg.llm_model is not None:
                values["llm_model"] = cfg.llm_model.strip()
            if cfg.llm_api_key:
                secret_store.set(f"llm_api_key_{user_id}", cfg.llm_api_key.strip())
            if values:
                db.set_user_settings(user_id, values)
        return {"ok": True, "configured": oauth.is_configured()}

    # ---------------------------------------------------------- applications

    @app.get("/api/applications")
    def list_applications(
        request: Request,
        stage: str = Query("all"),
        status: str = Query("all"),
        q: str = Query(""),
        limit: int = Query(500, le=1000),
        offset: int = Query(0),
    ):
        db = get_db()
        user_id = _require_user(db, request)
        rows = db.list_applications(
            user_id, stage=stage, status=status, q=q, limit=limit, offset=offset
        )
        return {"applications": [_serialize_app(row) for row in rows], "count": len(rows)}

    @app.post("/api/applications")
    def create_application(request: Request, body: ApplicationIn = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        prefs = _user_settings(db, user_id)
        tzname = prefs.get("timezone", "UTC")
        stage = _validate_stage(body.stage) or STAGE_APPLIED
        data = {
            "company": body.company,
            "role": body.role,
            "location": body.location,
            "job_url": body.job_url,
            "source": body.source,
            "stage": stage,
            "status": STATUS_ACTIVE,
            "next_action": body.next_action,
            "notes": body.notes,
            "applied_at": _parse_when(body.applied_at, tzname) or now_ms(),
        }
        check_back_at = _parse_when(body.check_back_at, tzname)
        data["check_back_at"] = check_back_at or _default_check_back(
            int(prefs.get("default_follow_up_days", 7)), tzname
        )
        data["check_back_source"] = body.check_back_source or (
            "manual" if check_back_at else "default"
        )
        data["next_action_at"] = _parse_when(body.next_action_at, tzname)
        if stage in TERMINAL:
            data["status"] = STATUS_CLOSED
            data["closed_at"] = now_ms()
            data["check_back_at"] = None
        if not data["next_action"]:
            data["next_action"] = "Wait for a response" if stage == STAGE_APPLIED else ""
        created = db.create_application(user_id, data)
        db.add_event(user_id, created["id"], "created", {"stage": stage})
        reminders.sync_application_reminders(db, user_id, created)
        return _serialize_app(created)

    @app.get("/api/applications/{app_id}")
    def get_application(app_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        app_row = db.get_application(user_id, app_id)
        if not app_row:
            raise HTTPException(status_code=404, detail="Application not found")
        return _serialize_app(app_row)

    @app.patch("/api/applications/{app_id}")
    def update_application(app_id: str, request: Request, body: ApplicationPatch = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        current = db.get_application(user_id, app_id)
        if not current:
            raise HTTPException(status_code=404, detail="Application not found")
        prefs = _user_settings(db, user_id)
        tzname = prefs.get("timezone", "UTC")
        fields = body.model_dump(exclude_unset=True)
        if "stage" in fields:
            fields["stage"] = _validate_stage(fields["stage"]) or current["stage"]
        for key in ("applied_at", "check_back_at", "next_action_at"):
            if key in fields:
                fields[key] = _parse_when(fields[key], tzname)
        fields = _apply_stage_side_effects(fields, current)
        if (
            fields.get("stage")
            and fields["stage"] not in TERMINAL
            and current.get("status") == STATUS_CLOSED
            and not fields.get("check_back_at")
        ):
            fields["check_back_at"] = _default_check_back(
                int(prefs.get("default_follow_up_days", 7)), tzname
            )
            fields["check_back_source"] = "default"
        updated = db.update_application(user_id, app_id, fields)
        if not updated:
            raise HTTPException(status_code=404, detail="Application not found")
        db.add_event(user_id, app_id, "updated", {"fields": list(fields)})
        reminders.sync_application_reminders(db, user_id, updated)
        return _serialize_app(updated)

    @app.delete("/api/applications/{app_id}")
    def delete_application(app_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_application(user_id, app_id):
            raise HTTPException(status_code=404, detail="Application not found")
        db.delete_application(user_id, app_id)
        return {"ok": True, "id": app_id}

    @app.post("/api/applications/{app_id}/outcome")
    def record_outcome(app_id: str, request: Request, body: OutcomeIn = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        current = db.get_application(user_id, app_id)
        if not current:
            raise HTTPException(status_code=404, detail="Application not found")
        outcome = (body.outcome or "").lower()
        if outcome not in {
            OUTCOME_REJECTED,
            OUTCOME_OFFER,
            OUTCOME_ASSESSMENT,
            OUTCOME_INTERVIEW,
            OUTCOME_FOLLOW_UP,
            OUTCOME_NO_RESPONSE,
            OUTCOME_WITHDRAWN,
            OUTCOME_OTHER,
        }:
            raise HTTPException(status_code=400, detail=f"Unknown outcome: {outcome}")

        fields: dict = {}
        stage = OUTCOME_STAGE.get(outcome) or _validate_stage(body.stage)
        if stage:
            fields["stage"] = stage
        if outcome == OUTCOME_FOLLOW_UP:
            fields["follow_up_count"] = int(current.get("follow_up_count") or 0) + 1
            fields["action_state"] = ACTION_FOLLOW_UP
            fields["next_action"] = "Follow up with the company"
            fields["check_back_at"] = now_ms() + 3 * MS_PER_DAY
            fields["check_back_source"] = "outcome"
            fields["next_action_at"] = now_ms() + 3 * MS_PER_DAY
        elif outcome == OUTCOME_NO_RESPONSE:
            fields["action_state"] = ACTION_WAITING
            fields["next_action"] = "Wait or close as no response"
            fields["check_back_at"] = now_ms() + 7 * MS_PER_DAY
            fields["check_back_source"] = "outcome"
            fields["next_action_at"] = now_ms() + 7 * MS_PER_DAY
        elif outcome == OUTCOME_OTHER:
            fields["action_state"] = ACTION_REQUIRED
        elif outcome in {OUTCOME_ASSESSMENT, OUTCOME_INTERVIEW}:
            fields["action_state"] = ACTION_REQUIRED
        elif outcome == OUTCOME_OFFER:
            fields["action_state"] = ACTION_REQUIRED
            fields["next_action"] = "Review the offer"
            fields["check_back_at"] = None
            fields["check_back_source"] = "none"
            fields["next_action_at"] = current.get("next_action_at") or now_ms() + 3 * MS_PER_DAY
        if body.note:
            fields["notes"] = _append_note(current.get("notes", ""), body.note)
        if stage:
            fields = _apply_stage_side_effects(fields, current)
        updated = db.update_application(user_id, app_id, fields)
        db.add_event(
            user_id,
            app_id,
            "outcome",
            {"outcome": outcome, "stage": fields.get("stage", current.get("stage")), "note": body.note},
        )
        if updated:
            reminders.sync_application_reminders(db, user_id, updated)
        return _serialize_app(updated or current)

    @app.post("/api/applications/{app_id}/snooze")
    def snooze_application(app_id: str, request: Request, body: SnoozeIn = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        current = db.get_application(user_id, app_id)
        if not current:
            raise HTTPException(status_code=404, detail="Application not found")
        return _serialize_app(reminders.snooze(db, user_id, current, body.days))

    # ---------------------------------------------------------------- emails

    def _parse_for_user(raw: str, body: EmailIn, db: Database, user_id: int) -> dict:
        prefs = _user_settings(db, user_id)
        tzname = prefs.get("timezone", "UTC")
        received_at = _parse_when(body.received_at, tzname) or now_ms()
        return parse_email(
            raw,
            subject=body.subject,
            from_email=body.from_email,
            received_at=received_at,
            timezone_name=tzname,
            default_follow_up_days=int(prefs.get("default_follow_up_days", 7)),
            llm_config=_llm_config(db, user_id),
            parser_mode=prefs.get("parser_mode", "auto"),
            company_hint=body.company_hint,
            role_hint=body.role_hint,
            stage_hint=body.stage_hint,
        )

    @app.post("/api/parse-email")
    def parse_email_preview(request: Request, body: EmailIn = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        if not body.raw_text.strip():
            raise HTTPException(status_code=400, detail="Paste the email text first")
        return _parse_for_user(body.raw_text, body, db, user_id)

    @app.get("/api/applications/{app_id}/emails")
    def list_emails(app_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_application(user_id, app_id):
            raise HTTPException(status_code=404, detail="Application not found")
        return {"emails": db.list_emails(user_id, app_id)}

    @app.post("/api/applications/{app_id}/emails")
    def add_email(app_id: str, request: Request, body: EmailIn = Body(...)):
        db = get_db()
        user_id = _require_user(db, request)
        current = db.get_application(user_id, app_id)
        if not current:
            raise HTTPException(status_code=404, detail="Application not found")
        if not body.raw_text.strip():
            raise HTTPException(status_code=400, detail="Paste the email text first")

        draft = _parse_for_user(body.raw_text, body, db, user_id)
        draft["company"] = draft.get("company") or current.get("company", "")
        draft["role"] = draft.get("role") or current.get("role", "")
        email = db.add_email(
            user_id,
            app_id,
            {
                "subject": draft["subject"],
                "from_email": draft["from_email"],
                "received_at": draft["received_at"],
                "raw_text": body.raw_text,
                "parsed": draft,
                "confidence": draft["confidence"],
                "parser_version": draft["parser_version"],
            },
        )
        db.add_event(user_id, app_id, "email", {"email_id": email["id"], "stage": draft["stage"]})

        if body.apply:
            fields = {
                "company": draft["company"],
                "role": draft["role"],
                "location": draft["location"] or current.get("location", ""),
                "stage": draft["stage"],
                "action_state": draft["action_state"],
                "next_action": draft["next_action"],
                "check_back_at": draft["check_back_at"],
                "check_back_source": draft["check_back_source"],
                "next_action_at": draft["next_action_at"],
                "last_contact_at": draft["received_at"],
            }
            fields = _apply_stage_side_effects(fields, current)
            updated = db.update_application(user_id, app_id, fields)
            reminders.sync_application_reminders(db, user_id, updated)
            return {"email": email, "draft": draft, "application": _serialize_app(updated)}

        return {"email": email, "draft": draft, "application": _serialize_app(current)}

    @app.get("/api/applications/{app_id}/timeline")
    def timeline(app_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_application(user_id, app_id):
            raise HTTPException(status_code=404, detail="Application not found")
        return {
            "events": db.list_events(user_id, app_id),
            "emails": db.list_emails(user_id, app_id),
        }

    @app.get("/api/applications/{app_id}/calendar.ics")
    def application_ics(app_id: str, request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        row = db.get_application(user_id, app_id)
        if not row:
            raise HTTPException(status_code=404, detail="Application not found")
        content = application_calendar(row, base_url=settings.base_url)
        return Response(
            content,
            media_type="text/calendar",
            headers={
                "Content-Disposition": f'attachment; filename="application-{app_id}.ics"'
            },
        )

    # ------------------------------------------------------------- dashboard

    @app.get("/api/stats")
    def stats(request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        return db.stats(user_id)

    @app.get("/api/due")
    def due(request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        items = reminders.due_items(db, user_id)
        return {"items": items, "count": len(items), "now": now_ms()}

    @app.get("/api/notifications")
    def notifications(request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        return notification_feed(db, user_id)

    @app.get("/api/reminders")
    def list_reminders(
        request: Request,
        pending_only: bool = Query(True),
        app_id: Optional[str] = Query(None),
    ):
        db = get_db()
        user_id = _require_user(db, request)
        return {
            "reminders": db.list_reminders(
                user_id, pending_only=pending_only, app_id=app_id
            )
        }

    @app.patch("/api/reminders/{reminder_id}")
    def update_reminder(reminder_id: str, request: Request, action: str = Query("done")):
        db = get_db()
        user_id = _require_user(db, request)
        if not db.get_reminder(user_id, reminder_id):
            raise HTTPException(status_code=404, detail="Reminder not found")
        status = REMINDER_DISMISSED if action == "dismiss" else REMINDER_DONE
        db.complete_reminder(user_id, reminder_id, status=status)
        return {"ok": True, "id": reminder_id, "status": status}

    @app.get("/api/calendar.ics")
    def calendar_ics(request: Request):
        db = get_db()
        user_id = _require_user(db, request)
        content = user_calendar(db, user_id, base_url=settings.base_url)
        return Response(
            content,
            media_type="text/calendar",
            headers={"Content-Disposition": 'attachment; filename="internships.ics"'},
        )

    return app


app = create_app()
