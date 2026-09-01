# Internship Dashboard

Track your internship applications directly from your Gmail inbox, as a local
web dashboard. Every application, recruiter ping, interview, offer and
rejection is auto-classified into a pipeline you can see at a glance.

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

## Features

- **Auto-classification** — scores subject + snippet to label emails as
  `applied`, `interviewing`, `offer`, `rejection`, or `other`
  (`app/classify.py` — keyword tables are easy to tune).
- **Company & role extraction** — derived from the sender domain
  (`careers.janestreet.com` → *Jane Street*); extensible override map.
- **Follow-up radar** — surfaces emails that need a reply ("pick a time…",
  "please confirm…") plus silent threads that have gone cold.
- **Manual override** — correct a misclassified email (or add a note) from the
  UI; overrides survive re-syncs.
- **Stats & pipeline** — per-company current status, per-stage totals, counts,
  last-contact dates.
- **Scheduled syncs** — a headless `bin/refresh.py` you can run from cron.

## Stack

| Layer     | Choice                                   |
|-----------|------------------------------------------|
| Backend   | Python 3.10+, FastAPI, Uvicorn           |
| Gmail     | Gmail API v1 via `google-api-python-client` (OAuth) |
| Storage   | SQLite (stdlib `sqlite3`)                |
| Frontend  | Vanilla HTML/CSS/JS — no build step      |

Gmail messages are *mirrored* into a local SQLite database, so the dashboard
is fast and keeps working offline.

## Quick start

### 1. Google Cloud setup (one time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. Enable the **Gmail API** (APIs & Services → Library).
3. APIs & Services → **OAuth consent screen** → External → add yourself as a
   test user. Scopes: `gmail.readonly`, `gmail.modify`.
4. **Credentials** → Create credentials → **OAuth client ID** → application
   type **Desktop app** → Download JSON.
5. Save it as `data/client_secret.json` in this repo.

### 2. Install & authorize

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python bin/setup_oauth.py   # opens browser → approve → token saved
cp .env.example .env        # tune if you like
```

This stores `data/token.json`, which is git-ignored.

### 3. Run

```bash
python bin/serve.py         # → http://127.0.0.1:8000
```

Click **⟳ Sync now** for a first pass (it scans the last ~180 days). Future
runs are incremental.

### 4. Keep it fresh (optional)

```bash
crontab -e
# every morning at 08:00
0 8 * * * cd /path/to/internship-dashboard && .venv/bin/python bin/refresh.py
```

## Commands

| Command | What it does |
|---|---|
| `python bin/setup_oauth.py` | One-time Gmail authorization |
| `python bin/serve.py` | Start the dashboard server |
| `python bin/refresh.py [--full] [--max N]` | Headless sync (cron-friendly) |
| `pytest` | Run the test suite |

## API

| Endpoint | Description |
|---|---|
| `GET  /api/status` | Auth + sync state |
| `POST /api/refresh` | Trigger sync (`?full=true` for full re-scan) |
| `GET  /api/stats` | Counts per stage |
| `GET  /api/companies` | Per-company pipeline summary |
| `GET  /api/messages` | Emails, filterable: `stage`, `company`, `q`, `needs_action` |
| `GET  /api/messages/{id}/body` | Plain-text email body |
| `PATCH /api/messages/{id}` | Override stage, add note, dismiss/rearm action |

## How classification works

`app/classify.py` builds a keyword→score table per stage and picks the highest
scoring stage above a threshold. Company comes from the sender domain with an
override map; role is a best-effort extraction from the subject line
(`"Your application for Software Engineering Intern"` → *Software Engineering
Intern*).

Two things you'll likely want to customise:

```python
# app/classify.py
COMPANY_OVERRIDES = {...}   # domain → pretty company name
_STAGE_KEYWORDS    = {...}   # add phrases you see in your own inbox
```

There's also a `FOLLOWUP_AFTER_DAYS` setting (default 2) controlling when a
silent application thread starts showing up under *Follow-ups*.

## Security notes

- `data/` (tokens, db) is git-ignored — never commit these.
- The token has read + modify access to your Gmail. The app only reads and
  stores metadata + snippets; it does not delete anything.
- The dashboard binds to `127.0.0.1` by default. Keep it that way; tests and
  everything else assume a local-only server.

## Project layout

```
app/
  config.py        settings + .env loading
  models.py        dataclasses
  db.py            SQLite layer
  classify.py      stage/company/role logic
  gmail_client.py  Gmail API wrapper
  pipeline.py      fetch → classify → store
  api.py           FastAPI app + endpoints
  static/          dashboard UI
bin/               setup_oauth / serve / refresh
tests/             pytest suite
```

## Roadmap

- [ ] Label the real email thread from the dashboard (e.g. add a "Offer" label)
- [ ] Thread-level view instead of per-message
- [ ] Export pipeline to CSV
- [ ] Gmail push notifications for live updates