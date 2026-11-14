# LockedIn

A private internship-application tracker. Add each application, paste the
company emails you already have, and the app extracts the stage, next action,
and check-back date. When that date arrives it nudges you in the dashboard, in
your browser, and through an ICS calendar feed.

No Gmail access, no inbox mirroring, and no background mailbox sync.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Applied 12   Assessment 3   Interviewing 2   Offers 1   Rejected 4  │
├───────────────────────────────────┬──────────────────────────────────┤
│ Needs attention                   │ Coming up                        │
│ ⚠ Stripe — reply with availability │ • Acme — check back tomorrow     │
│ ⚠ Figma — assessment due today     │ • Ramp — offer response in 2d    │
├───────────────────────────────────┴──────────────────────────────────┤
│ Applications: company, stage, next action, check-back, outcome       │
└──────────────────────────────────────────────────────────────────────┘
```

## What it does

- **Manual pipeline** — add a company/role once, then record outcomes
  (`rejected`, `offer`, `assessment`, `interview`, `followed up`,
  `no response`, `withdrawn`) as they happen.
- **Paste an email, get a draft** — a rules parser extracts company, role,
  stage, next action, and response window. Dates like "within 2 weeks",
  "7–10 business days", and "by January 20" become a concrete check-back.
- **Optional LLM fallback** — OpenAI, xAI Grok, or Anthropic Claude can fill
  gaps when the rules are unsure. It is opt-in and the API key is encrypted at
  rest.
- **Reminders** — due check-backs and action deadlines appear in the dashboard,
  can trigger browser notifications, and export to `.ics`.
- **Multi-user** — Google sign-in is identity only; every query is scoped to
  the signed-in `user_id`.

## Stack

| Layer    | Choice                                           |
|----------|--------------------------------------------------|
| Backend  | Python 3.10+, FastAPI, Uvicorn                   |
| Auth     | Google OAuth (openid/email/profile only)         |
| Storage  | SQLite via stdlib `sqlite3`                      |
| Parser   | Deterministic rules + optional OpenAI/Grok/Claude |
| Frontend | Vanilla HTML/CSS/JS, Tailwind CDN, no build step |

## Run it locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

python bin/serve.py     # http://127.0.0.1:8000
```

### Google sign-in setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen (External is fine for testing).
3. Create an OAuth **Web application** client.
4. Add the redirect URI `http://127.0.0.1:8000/oauth/callback`.
5. Open the app → **Settings** → paste the client ID/secret. No Gmail API or
   Gmail scopes are needed.

If you only want to try the tracker locally, the app still works after sign-in
is configured; there is no mailbox connection step.

### Optional LLM parsing

In **Settings**, choose a provider (**OpenAI**, **xAI Grok**, or **Anthropic
Claude**), then add the API key. Base URL and model are pre-filled with that
provider's defaults and remain editable for proxies or newer models. Parser
mode defaults to `auto`: rules run first, and the LLM is only called when
confidence is below 65%. Failures fall back to the rules result. Use `rules`
for a fully local app.

Environment equivalents are `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`,
`LLM_API_KEY`, and `LLM_TIMEOUT_SECONDS`.

## Everyday flow

1. **Add application** — company, role, optional URL/source/notes.
2. Paste the confirmation email into **Autofill from email** and press
   **Parse email**. Review the fields, then save.
3. The app schedules a check-back. On the **Today** view, due items can be
   opened, snoozed, or marked done.
4. When a reply arrives, open the application, paste the email, and press
   **Attach & update**. The stage and next action change; rejected/withdrawn
   applications close automatically.
5. Record the final outcome with the outcome buttons.

## Calendar & browser reminders

- `GET /api/calendar.ics` exports every active check-back and action.
- Each application has its own `.ics` download in the detail view.
- Browser notifications are opt-in from the sidebar or Calendar view. The page
  checks for due items every minute while open; a service worker renders the
  notification and focuses the app when clicked.

## Commands

| Command | What it does |
|---|---|
| `python bin/serve.py` | Start the server |
| `pytest` | Run the test suite |

## API

| Endpoint | Description |
|---|---|
| `GET /api/me` | Current signed-in user |
| `GET /api/status` | Auth state + pipeline counts |
| `GET /api/applications?stage=&status=&q=` | List applications |
| `POST /api/applications` | Create an application |
| `GET /api/applications/{id}` | Application detail |
| `PATCH /api/applications/{id}` | Edit fields or stage |
| `DELETE /api/applications/{id}` | Delete application + related rows |
| `POST /api/applications/{id}/outcome` | Record an outcome |
| `POST /api/applications/{id}/snooze` | Push the check-back out |
| `POST /api/parse-email` | Preview a parse without saving |
| `POST /api/applications/{id}/emails` | Attach a pasted email; `apply` updates the app |
| `GET /api/applications/{id}/timeline` | Events + pasted emails |
| `GET /api/due`, `GET /api/notifications` | Reminder feed |
| `GET /api/calendar.ics` | Full ICS export |
| `GET/POST /api/settings` | OAuth client, parser, timezone, notifications |
| `GET /oauth/login`, `GET /oauth/callback` | Google identity flow |

## Parsing rules

`app/parser/` is split into:

- `dates.py` — explicit dates, relative windows, business days, event dates.
- `rules.py` — stage classification, company/role extraction, next action.
- `llm.py` — optional JSON-mode LLM parser validated with Pydantic.
- `pipeline.py` — merges rules + LLM, resolves the check-back timestamp, and
  returns an editable draft.

Rules are intentionally conservative: unrecognised text becomes `applied` with
low confidence rather than a confident wrong stage. A default check-back
(`DEFAULT_FOLLOW_UP_DAYS`, 7 days) is used when no timeline is stated.

## Deploy to Render

1. Create a **Web Service** from this repo.
2. Build command: `pip install -r requirements.txt`
3. Start command: `python bin/serve.py`
4. Environment:
   - `BASE_URL=https://your-app.onrender.com`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `SECRET_KEY` (stable random string)
   - `DATA_DIR=/data`
5. Attach a persistent disk mounted at `/data`.
6. Add `https://your-app.onrender.com/oauth/callback` as an authorized redirect
   URI in Google Cloud Console.

## Security notes

- `data/` (SQLite, Fernet key, encrypted secrets) is git-ignored.
- Google client secrets and LLM keys are encrypted with Fernet.
- Sessions are HMAC-signed cookies. Set `SECRET_KEY` to keep them stable across
  deploys.
- The app requests no Gmail scopes and stores no Google access/refresh tokens.

## Project layout

```
app/
  api.py           FastAPI routes
  auth.py          signed session cookies
  config.py        env/.env settings
  db.py            SQLite schema + queries
  models.py        stages, outcomes, reminders, serializers
  notifications.py ICS export + notification feed
  oauth.py         Google identity flow
  parser/          rules, dates, LLM, pipeline
  reminders.py     schedule/snooze/due feed
  secret_store.py  encrypted secret storage
  timeutil.py      epoch-ms helpers
  static/          dashboard, service worker, icon
bin/serve.py       Uvicorn entrypoint
tests/             pytest suite
```
