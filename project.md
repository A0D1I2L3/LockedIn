# LockedIn — Project Brief for AI Coding Agents

> Read this before touching code. It explains the current design, the parser
> contract, where state lives, and what is still intentionally unfinished.

## 1. What this is

LockedIn is a **multi-user internship-application tracker**. The user adds each
application manually, then pastes company emails they already have. A parser
extracts the stage, company, role, next action, and check-back date. The app
reminds the user when it is time to check in, and records outcomes
(rejected/offer/assessment/interview/follow-up/etc.).

It is **not** an email client and does **not** read Gmail. Google sign-in is
used for identity only (`openid`, `email`, `profile`). There is no mailbox
sync, no Gmail API dependency, and no stored Google tokens.

Core product decisions:
- The pipeline is **manual first, parsed second**. Every parsed field is
  editable before or after saving.
- Classification prefers precision over recall: unknown text becomes
  `applied` with low confidence, never a confident wrong stage.
- Rules are always available; the LLM is optional and only used when
  confidence is low (`parser_mode=auto`).
- Per-user isolation is enforced in every SQL query via `user_id`.
- Frontend stays vanilla HTML/CSS/JS with Tailwind CDN, no build step.

## 2. Stack & commands

| Layer    | Choice |
|----------|--------|
| Backend  | Python 3.10+, FastAPI, Uvicorn |
| Auth     | Google OAuth 2.0 identity scopes, signed cookie session |
| Storage  | SQLite via stdlib `sqlite3` |
| Parser   | Rules + optional OpenAI / xAI Grok / Anthropic Claude |
| Secrets  | Fernet-encrypted JSON store under `data/` |
| Frontend | Vanilla JS, Tailwind CDN, service worker |

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python bin/serve.py     # http://127.0.0.1:8000
pytest                  # 26 tests
```

Config is environment-first, then `.env` (`app/config.py`). User preferences
(parser mode, timezone, default follow-up days, LLM provider/base/model, notifications)
live in `user_settings`. Secrets are global OAuth credentials plus per-user LLM
keys in the encrypted store.

## 3. Data flow

```
Browser (app/static)
  │ fetch /api/*
  ▼
FastAPI (app/api.py)
  │ signed cookie -> user_id (app/auth.py)
  ├── /oauth/* -> identity only (app/oauth.py)
  ├── /api/applications -> CRUD + outcome + snooze
  ├── /api/parse-email -> parser.pipeline.parse_email (no save)
  ├── /api/applications/{id}/emails -> save + optionally update app
  ├── /api/due|notifications -> reminders.due_items()
  └── /api/calendar.ics -> notifications.user_calendar()
        │
        ▼
   SQLite (app/db.py)
     users, applications, emails, reminders, events, user_settings
```

On create/update/outcome/snooze, `reminders.sync_application_reminders()` cancels
pending reminders for that application and recreates:
- a `check_back` reminder at `check_back_at`;
- an action reminder at `next_action_at` (`deadline`, `interview`, or
  `follow_up` depending on stage);
- 24h and 1h offset nudges for `next_action_at` when in the future.

`due_items()` uses applications as the source of truth and skips duplicate
"main" reminders, while still surfacing offset nudges.

## 4. Module map

| File | Responsibility |
|------|----------------|
| `app/config.py` | `Settings`, env loading, identity scopes, LLM defaults |
| `app/models.py` | Stage/action/outcome/reminder/event constants + serializers |
| `app/db.py` | Schema and all queries; no ORM, no migration framework |
| `app/auth.py` | HMAC-signed session cookie (`lockedin_session`) |
| `app/oauth.py` | Google authorization URL, code exchange, userinfo |
| `app/secret_store.py` | Fernet store for Google secret and per-user LLM keys |
| `app/parser/dates.py` | Relative windows, explicit dates, business days, event dates |
| `app/parser/rules.py` | Stage keywords, company/role regexes, next action |
| `app/parser/llm.py` | Optional JSON-mode LLM call, Pydantic validation |
| `app/parser/pipeline.py` | Merge rules + LLM, resolve check-back, return draft |
| `app/reminders.py` | Reminder sync, due/upcoming feeds, snooze |
| `app/notifications.py` | ICS generation, browser notification payload |
| `app/api.py` | FastAPI app and all routes |
| `app/static/` | Dashboard (`index.html`, `app.js`, `style.css`, `sw.js`) |
| `bin/serve.py` | Uvicorn entrypoint |
| `tests/` | `test_db.py`, `test_parser.py`, `test_api.py`, `test_ui_behavior.py` |

## 5. Domain model

**Stages:** `applied`, `assessment`, `interview`, `offer`, `rejected`,
`withdrawn`. `rejected` and `withdrawn` are terminal: status becomes `closed`,
`check_back_at`/`next_action_at` are cleared, and reminders are removed.

**Action states:** `waiting`, `action_required`, `follow_up_due`, `done`.

**Outcomes:** `rejected`, `offer`, `assessment`, `interview`, `follow_up`,
`no_response`, `withdrawn`, `other`. Mapping to stages:

| Outcome | Stage | Side effect |
|---|---|---|
| `rejected` | `rejected` | close, clear dates |
| `withdrawn` | `withdrawn` | close, clear dates |
| `offer` | `offer` | action required, check-back cleared, response deadline ~3d |
| `assessment` | `assessment` | action required |
| `interview` | `interview` | action required |
| `follow_up` | unchanged | follow-up count +1, check-back/action in 3d |
| `no_response` | unchanged | check-back in 7d, waiting |
| `other` | unchanged | action required, note only |

**Parser output contract** (`parse_email`):
```
company, role, location, stage, confidence, evidence[],
parser ("rules"|"llm"|"hybrid"), parser_version,
next_action, action_state,
check_back_at, check_back_source ("explicit_date"|"stated_window"|
  "stage_default"|"default"|"none"),
next_action_at, received_at, subject, from_email, response_window
```

`check_back_at` is when to follow up. `next_action_at` is the concrete
deadline/event for assessments, interviews, and offers. For `applied`, only
`check_back_at` is set, so the Today view does not show duplicate items.

## 6. Parser behaviour

`dates.extract_response_window` looks for, in order:
1. explicit deadlines: `by`, `no later than`, `on or before`, `due`, `respond by`;
2. relative windows: `within 2 weeks`, `7-10 business days`, `in two months`;
3. default: `default_follow_up_days`.

Business-day windows skip weekends. Yearless dates more than 30 days in the
past roll forward one year. Date-only values land at 09:00 in the user's
timezone. `extract_event_date` finds a date in a sentence mentioning
interview/assessment/deadline/respond by and is used as `next_action_at`.

`rules.classify_stage` priorities: rejection → withdrawn → offer →
assessment → interview → applied. Company extraction uses explicit patterns
first, then the sender domain unless it is a known ATS/job-board domain.
There is no fuzzy company matching.

`llm.parse_with_llm` supports three providers. OpenAI and Grok call
`{base}/chat/completions` with a bearer token, `temperature=0`, and
`response_format=json_object`. Claude calls `{base}/messages` with `x-api-key`
and `anthropic-version`, a top-level `system` prompt, and no response format.
Responses (including fenced JSON) are validated with a Pydantic model. Any
network/validation failure returns `None`; rules win.

## 7. Database schema

- `users(id, google_user_id UNIQUE, email, created_at)`
- `applications(id TEXT PK, user_id, company, role, location, job_url, source,
  stage, status, action_state, next_action, next_action_at, check_back_at,
  check_back_source, applied_at, last_contact_at, follow_up_count, notes,
  created_at, updated_at, closed_at)`
- `emails(id TEXT PK, user_id, application_id, subject, from_email,
  received_at, raw_text, parsed_json, confidence, parser_version, created_at)`
- `reminders(id TEXT PK, user_id, application_id, kind, due_at, title, body,
  status, payload_json, created_at, completed_at)`
- `events(id TEXT PK, user_id, application_id, type, data_json, created_at)`
- `user_settings(user_id PK, data JSON)`

There is no formal migration framework. `_SCHEMA` uses `CREATE TABLE IF NOT
EXISTS`; an old `data/dashboard.db` from the Gmail era is left untouched as a
backup. Point `DB_PATH` at a new file if reusing an old data directory.

## 8. API surface

| Endpoint | Notes |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/me`, `GET /api/status` | session + counts |
| `GET/POST /api/settings` | OAuth client, user prefs, LLM config |
| `GET /oauth/login`, `GET /oauth/callback` | identity flow |
| `POST /api/logout` | clear cookie |
| `GET/POST /api/applications` | list/filter/create |
| `GET/PATCH/DELETE /api/applications/{id}` | detail/edit/delete |
| `POST /api/applications/{id}/outcome` | record outcome |
| `POST /api/applications/{id}/snooze` | push dates out |
| `POST /api/parse-email` | preview draft |
| `GET/POST /api/applications/{id}/emails` | list/attach parsed email |
| `GET /api/applications/{id}/timeline` | events + emails |
| `GET /api/applications/{id}/calendar.ics` | per-app ICS |
| `GET /api/due`, `/api/notifications` | reminder feeds |
| `GET /api/reminders`, `PATCH /api/reminders/{id}` | list/complete/dismiss |
| `GET /api/calendar.ics` | full ICS |

All `/api/*` routes except status/me/settings/oauth require a valid session
cookie.

## 9. Current state

The Gmail-based design has been **fully replaced**:

- Removed: `app/gmail_client.py`, `app/classify.py`, `app/pipeline.py`,
  `bin/refresh.py`, Gmail tests, Google API client requirement.
- Added: parser package, reminders, notifications, new schema, new API, new UI,
  service worker, ICS export, browser notification polling.
- `pytest`: 26 passing.
- Old `data/dashboard.db` and its tables are not migrated or deleted.

Known limitations:
- Browser notifications require the tab to be open for polling. There is no
  Web Push backend.
- ICS is a downloadable feed, not a hosted subscription URL with auth tokens.
- SQLite remains single-writer; reminder scheduling is synchronous in the
  request path.
- OAuth CSRF state is still a single in-process `app.state` value, so
  concurrent logins can overwrite it.
- Sessions are not server-side revocable; logout clears the cookie only.
- There is no rate limiting or CSRF token on mutating routes beyond the
  same-site session cookie.
- The LLM key is per-user in one encrypted file; multi-worker deployments must
  share `SECRET_KEY` and the data directory.
- Email attachments/HTML are stored as pasted plain text only.

## 10. Next work

1. **Durable reminders/notifications** — a scheduler or Web Push worker so
   alerts fire with the tab closed.
2. **Safer auth** — server-side OAuth state, CSRF tokens, rate limiting,
   session revoke list.
3. **Parser quality** — more company/role patterns, optional fuzzy company
   normalization, per-user corrections stored as examples.
4. **Scale** — pagination for applications/emails, FTS search, formal
   migrations, and backup guidance for SQLite.
5. **Calendar** — tokenized read-only ICS subscription URL.
