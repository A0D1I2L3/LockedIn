# LockedIn

Track every internship application that lands in your Gmail, on one clean
dashboard. Application, recruiter ping, interview, offer, rejection — each
email is auto-classified into a pipeline you can read at a glance, and every
user signs in with their own Google account so their inbox stays private.

```
┌────────────────────────────────────────────────────────────┐
│  Applied  100   Interviewing  12   Offers  3   Rejected 40 │
├────────────────────────────┬───────────────────────────────┤
│  Follow-ups                 │  Companies / pipeline          │
│  ⚠ Jane Street — pick a time│  ┌──────────────┬──────────┐   │
│  ⚠ Stripe — no answer in 5d │  │ Company      │ Status   │   │
│                             │  │ Jane Street  │ Interview│   │
├────────────────────────────┴───────────────────────────────┤
│  Emails — searchable, filterable, click to read + recategorize │
└────────────────────────────────────────────────────────────┘
```

## What this is

- **Multi-user** — people sign in with **"Continue with Google"**. Each user's
  Gmail is tracked separately and their data is kept private.
- **Auto-classification** — subject + snippet are scored to label each email
  `applied`, `interviewing`, `offer`, `rejection`, or `other`.
- **Company & role extraction** — derived from the sender
  (`careers.janestreet.com` → *Jane Street*); easy to tune.
- **Follow-up radar** — surfaces emails that need a reply ("pick a time…",
  "please confirm…") and silent threads that have gone cold.
- **Manual override** — correct a misclassification or add a note from the UI.
- **Stats & pipeline** — per-company status, per-stage counts, last-contact.
- **Scheduled syncs** — a headless `bin/refresh.py` you can run from cron.

## Stack

| Layer     | Choice                                           |
|-----------|--------------------------------------------------|
| Backend   | Python 3.10+, FastAPI, Uvicorn                   |
| Auth      | Google OAuth (Sign in with Google, web client)   |
| Gmail     | Gmail API v1 via `google-api-python-client`      |
| Storage   | SQLite (stdlib `sqlite3`)                        |
| Frontend  | Vanilla HTML/CSS/JS — no build step              |

Gmail messages are *mirrored* into a SQLite database, so the dashboard stays
fast and keeps working offline.

---

## Run it locally

### 1. Clone & install

```bash
git clone https://github.com/A0D1I2L3/LockedIn.git
cd LockedIn

python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env    # optional tweaks
```

### 2. Create a Google Cloud project (one time)

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** → **External** → add yourself as
   a test user. Scopes: `gmail.readonly`, `gmail.modify`.
4. **Credentials → Create credentials → OAuth client ID** → application type
   **Web application**.
5. Set **Authorized redirect URIs** to:
   - locally: `http://127.0.0.1:8000/oauth/callback`
   - on Render: `https://YOUR-APP.onrender.com/oauth/callback`
6. Copy the **Client ID** and **Client secret**.

### 3. Start the server

```bash
python bin/serve.py     # → http://127.0.0.1:8000
```

Open `http://127.0.0.1:8000` → click **Settings** → paste the **Client ID** and
**Client secret** → save. Then click **Connect Gmail** and approve.

Click **⟳ Sync now** for a first pass (scans the last ~180 days). Future runs
are incremental.

### 4. Keep it fresh (optional)

```bash
crontab -e
# every morning at 08:00 — sync user A
0 8 * * * cd /path/to/LockedIn && .venv/bin/python bin/refresh.py --email you@gmail.com
```

See [`bin/refresh.py --help`](bin/refresh.py) for `--full` and `--max` options.

---

## Deploy to Render

Render walks you through this; here are the exact settings that match this
repo. You can do most of step 2 in parallel once the web service is up.

### A. Create the web service

1. **Dashboard → New → Web Service** → connect your GitHub repo (LockedIn).
2. Name: `lockedin`, **Region**: a free-plan region, **Branch**: `master`.
3. **Runtime**: Python 3.
4. **Build command**: `pip install -r requirements.txt`
5. **Start command**: `python bin/serve.py`
6. Save and let it build (first deploy will be shown as "deploy failed" until
   the env vars below are set — that's expected).

### B. Add env vars

In the service → **Environment** → add:

| Variable                | Value                                        |
|-------------------------|----------------------------------------------|
| `PORT`                  | `10000`                                      |
| `HOST`                  | `0.0.0.0`                                    |
| `BASE_URL`              | `https://lockedin.onrender.com` (your URL)   |
| `GOOGLE_CLIENT_ID`      | from Google Console                          |
| `GOOGLE_CLIENT_SECRET`  | from Google Console                          |
| `SECRET_KEY`            | a long random string (see below)             |
| `DATA_DIR`              | `/data` (the mounted disk)                   |
| `DB_PATH`               | `/data/dashboard.db` (optional)              |

Generate a random SECRET_KEY:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### C. Attach a persistent disk

Data must survive redeploys:

1. Service → **Disks → Attach a disk** → name `data`, **Mount path**: `/data`.
2. Now `DATA_DIR`/`DB_PATH` point at the disk, so users, tokens, and messages
   persist.

### D. Finish Google OAuth

- Add the **Authorized redirect URI** `https://lockedin.onrender.com/oauth/callback`
  and your domain as an authorized JS origin.
- Set OAuth consent screen to **External** and **Publish** it (otherwise only
  test users can sign in).
- Publish a **new deploy** in Render after adding the env vars / disk.

Open your app — click **Settings**, confirm the Client ID/Secret are filled,
then **Connect Gmail**.

---

## Commands

| Command | What it does |
|---|---|
| `python bin/serve.py` | Start the dashboard server |
| `python bin/refresh.py --email you@gmail.com [--full] [--max N]` | Headless sync |
| `pytest` | Run the test suite |

## API

| Endpoint | Description |
|---|---|
| `GET  /api/me` | Current signed-in user |
| `GET  /api/status` | Auth + sync state |
| `POST /api/refresh` | Trigger sync (`?full=true` for full re-scan) |
| `GET  /api/stats` | Counts per stage |
| `GET  /api/companies` | Per-company pipeline summary |
| `GET  /api/messages` | Emails, filterable: `stage`, `company`, `q`, `needs_action` |
| `GET  /api/messages/{id}/body` | Plain-text email body |
| `PATCH /api/messages/{id}` | Override stage, add note, dismiss/rearm action |

## How classification works

`app/classify.py` scores each email by keyword and picks the highest-scoring
stage above a threshold. Company comes from the sender domain with an override
map; role is a best-effort extraction from the subject. You'll likely want to
tune:

```python
# app/classify.py
COMPANY_OVERRIDES = {...}   # domain → pretty company name
_STAGE_KEYWORDS    = {...}   # add phrases you see in your own inbox
```

And `FOLLOWUP_AFTER_DAYS` (default 2, in `.env`) controls when a silent
application thread shows up under *Follow-ups*.

## Security notes

- `data/` (db, tokens, secret store) is git-ignored — never commit these.
- Passwords and OAuth secrets are stored **encrypted** (Fernet). `SECRET_KEY`
  guards the session cookie and the secret store; keep it stable between
  deploys.
- The OAuth token has read + modify access to a user's Gmail. The app only
  reads and stores metadata + snippets; it does not delete anything.
- Locally the server binds to `127.0.0.1`; on Render it binds `0.0.0.0`
  behind Render's TLS. Don't disable that.

## Project layout

```
app/
  config.py        settings + .env/env loading
  models.py        dataclasses
  auth.py          session cookies + encrypted token storage
  secret_store.py  encrypted store for OAuth client id/secret
  db.py            SQLite layer (multi-user)
  oauth.py         Google OAuth exchange + userinfo
  classify.py      stage/company/role logic
  gmail_client.py  Gmail API wrapper
  pipeline.py      fetch → classify → store
  api.py           FastAPI app + endpoints
  static/          dashboard UI
bin/               serve / refresh (OAuth setup now happens in-app)
tests/             pytest suite
```

## Roadmap

- [ ] Label the real email thread from the dashboard (e.g. add a "Offer" label)
- [ ] Thread-level view instead of per-message
- [ ] Export pipeline to CSV
- [ ] Gmail push notifications for live updates