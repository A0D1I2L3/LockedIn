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
- **Drag between stages** — drag a card onto another kanban column. Keyboard
  users can press Alt+Left/Right on a focused card, and every move has an Undo
  action.
- **Today agenda** — overdue, due today, and this week sit above the board with
  one-tap Followed up, +1d/+3d/+7d snooze, and open actions.
- **Undoable deletes** — deleting an application or a logged email moves it to
  a seven-day trash; the toast offers Undo to restore it instantly.
- **Paste an email, get a draft** — paste one email or a forwarded thread.
  Rules extraction works with no API key; adding OpenAI, Groq, xAI Grok, or
  Anthropic Claude improves ambiguous emails. Dates like "within 2 weeks",
  "7–10 business days", and "by January 20" become a concrete check-back.
- **Smarter drafts** — every preview field is editable inline with per-field
  confidence. A fuzzy company/role/sender match offers "Update existing" so a
  stage-change email does not create a duplicate card.
- **Reminders that reach you** — due check-backs and deadlines appear in the
  dashboard, trigger browser notifications, and can be delivered by Web Push
  (VAPID) or Telegram. A daily digest runs at your chosen time, quiet hours are
  respected, and each reminder stores its channel.
- **Multi-user** — Google sign-in is identity only; every query is scoped to
  the signed-in `user_id`.

## Stack

| Layer    | Choice |
|----------|--------|
| Runtime  | Node.js 22.5+ (uses the built-in `node:sqlite` module) |
| App      | Next.js App Router, React 19, TypeScript |
| Styling  | Tailwind CSS v4 |
| Auth     | Google OAuth (`openid`/`email`/`profile` only) |
| Storage  | SQLite via `node:sqlite` `DatabaseSync` |
| Parser   | OpenAI/Grok/Claude (rules fallback available) |
| Tests    | Vitest + Playwright |

## Run it locally

```bash
npm install
cp .env.example .env

npm run dev     # http://localhost:3000
```

The database is created on first request at `data/lockedin.db`. To start from a
clean slate, stop the server and delete the `data/` directory. You can also wipe
only your own account and data from **Settings → Danger zone**.

SQLite runs in WAL mode, so a safe backup must include `lockedin.db`,
`lockedin.db-wal`, and `lockedin.db-shm` while the app is stopped (or use
`sqlite3 lockedin.db ".backup backup.db"` for an online copy). Copying only the
main `.db` file can miss recent writes.

### Google sign-in setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen (External is fine for testing).
3. Create an OAuth **Web application** client.
4. Add the redirect URI `http://localhost:3000/oauth/callback`.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your environment (or
   `.env`). No Gmail API or Gmail scopes are needed.

If you only want to try the tracker locally, the app still works after sign-in
is configured; there is no mailbox connection step.

### AI parsing (optional)

Paste & Draft works immediately with deterministic rules. To improve ambiguous
emails, open **Settings → Email parser & LLM**, choose a provider (**OpenAI**,
**Groq**, **xAI Grok**, or **Anthropic Claude**), and add an API key. Base URL
and model are pre-filled with that provider's defaults and remain editable for
proxies or newer models. Parser mode defaults to `auto`, which calls the
provider only when rules confidence is low and otherwise stays offline. `llm`
forces AI when available, and `rules` never sends text anywhere. Without a key,
every mode safely falls back to rules. LLM requests ask for one structured JSON
object containing the company, role, stage/category, location, next action,
check-back date, and deadline.

Environment equivalents are `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`,
`LLM_API_KEY`, and `LLM_TIMEOUT_SECONDS`.

### Reminder delivery (optional)

Web Push works out of the box: VAPID keys are generated and encrypted on first
use. To pin them, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
`VAPID_SUBJECT`. Set `RESEND_API_KEY` and `DIGEST_FROM` to email the daily
digest through Resend; set `TELEGRAM_BOT_TOKEN` for Telegram delivery. The
server sweeps due reminders every minute, deduplicates deliveries, skips quiet
hours, and only pushes reminders due in the last 12 hours.

## Everyday flow

1. **Add application** — company, role, optional URL/source/notes.
2. Paste the confirmation email into **Autofill from an email** and press
   **Parse & autofill**. Review the fields, then save.
3. The app schedules a check-back. On the **Today** view, due items can be
   opened, snoozed, or marked done.
4. When a reply arrives, open the application, paste the email, and press
   **Log & apply**. The stage and next action change; rejected/withdrawn
   applications close automatically.
5. Record the final outcome with the outcome buttons.

## Calendar & browser reminders

- `GET /api/calendar.ics` exports every active check-back and action.
- Each application has its own `.ics` download in the detail view.
- Browser notifications are opt-in from the Calendar view. The page checks for
  due items every minute while open; a service worker renders the notification
  and focuses the app when clicked.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run typecheck` | Run TypeScript without emitting |
| `npm test` | Run the Vitest suite |
| `npm run test:e2e` | Build and run the Playwright flows |

Playwright needs a Chromium binary. Install it once with
`npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at
a system Chromium. E2E uses a throwaway `.e2e-data/` database and starts the
production build on port 3100.

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness |
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
| `GET /api/stats` | Pipeline totals |
| `GET /api/reminders`, `PATCH /api/reminders/{id}?action=done\|dismiss` | List/complete reminders |
| `GET /api/calendar.ics` | Full ICS export |
| `GET/POST /api/settings` | Parser, timezone, LLM, notifications |
| `GET /oauth/login`, `GET /oauth/callback` | Google identity flow |
| `POST /api/logout` | Clear the session cookie |

All `/api/*` routes except status/me/settings/oauth require a valid session
cookie.

## Parsing rules

`lib/parser/` is split into:

- `dates.ts` — explicit dates, relative windows, business days, event dates.
- `rules.ts` — stage classification, company/role extraction, next action.
- `llm.ts` — optional JSON-mode LLM parser validated with Zod.
- `pipeline.ts` — merges rules + LLM, resolves the check-back timestamp, and
  returns an editable draft.

Rules are intentionally conservative: unrecognised text becomes `applied` with
low confidence rather than a confident wrong stage. A default check-back
(`DEFAULT_FOLLOW_UP_DAYS`, 7 days) is used when no timeline is stated.

## Deploy to Render

1. Create a **Web Service** from this repo.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Environment:
   - `BASE_URL=https://your-app.onrender.com`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `SECRET_KEY` (stable random string)
   - `DATA_DIR=/data`
5. Attach a persistent disk mounted at `/data`.
6. Add `https://your-app.onrender.com/oauth/callback` as an authorized redirect
   URI in Google Cloud Console.

## Security notes

- `data/` (SQLite, AES key, encrypted secrets) is git-ignored.
- Google client secrets and LLM keys are encrypted with AES-256-GCM.
- Sessions are HMAC-signed cookies. Set `SECRET_KEY` to keep them stable across
  deploys.
- The app requests no Gmail scopes and stores no Google access/refresh tokens.

## Project layout

```
app/
  layout.tsx, page.tsx, globals.css
  api/                 Route handlers (applications, stats, reminders, ICS…)
  oauth/               Google identity flow
components/            React dashboard, modals, shared UI
lib/
  db.ts                SQLite schema + queries
  auth.ts, oauth.ts    Signed sessions and Google identity
  secrets.ts           AES-256-GCM secret store
  parser/              rules, dates, LLM, pipeline
  reminders.ts         schedule/snooze/due feed
  calendar.ts          ICS export + notification feed
  api.ts, schemas.ts   Route helpers and Zod validation
public/                Service worker and icon
tests/                 Vitest suite + Playwright flows
```
