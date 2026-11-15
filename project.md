# LockedIn — Project Brief for AI Coding Agents

> Read this before touching code. It explains the current design, the parser
> contract, where state lives, and what is intentionally unfinished.

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
- The frontend is React + Tailwind inside the Next.js app; API routes are
  colocated under `app/api/`.

## 2. Stack & commands

| Layer    | Choice |
|----------|--------|
| Runtime  | Node.js 22.5+ (built-in `node:sqlite`) |
| App      | Next.js App Router, React 19, TypeScript |
| Styling  | Tailwind CSS v4 (`@tailwindcss/postcss`) |
| Auth     | Google OAuth 2.0 identity scopes, signed cookie session |
| Storage  | SQLite via `node:sqlite` `DatabaseSync` |
| Parser   | Rules + optional OpenAI / xAI Grok / Anthropic Claude |
| Secrets  | AES-256-GCM JSON store under `data/` |
| Tests    | Vitest |

```bash
npm install
npm run dev       # http://localhost:3000
npm run typecheck
npm test          # 17 tests
npm run build
```

Config is environment-first (Next loads `.env`). User preferences (parser mode,
timezone, default follow-up days, LLM provider/base/model, notifications) live
in `user_settings`. Secrets are global OAuth credentials plus per-user LLM keys
in the encrypted store.

## 3. Data flow

```
Browser (React components)
  │ fetch /api/*
  ▼
Next.js route handlers (app/api/**)
  │ signed cookie -> user_id (lib/auth.ts)
  ├── app/oauth/* -> identity only (lib/oauth.ts)
  ├── /api/applications -> CRUD + outcome + snooze
  ├── /api/parse-email -> parser.pipeline.parseEmail (no save)
  ├── /api/applications/{id}/emails -> save + optionally update app
  ├── /api/due|notifications -> reminders.dueItems()
  └── /api/calendar.ics -> calendar.userCalendar()
        │
        ▼
   SQLite (lib/db.ts)
     users, applications, emails, reminders, events, user_settings
```

On create/update/outcome/snooze, `reminders.syncApplicationReminders()` cancels
pending reminders for that application and recreates:
- a `check_back` reminder at `check_back_at`;
- an action reminder at `next_action_at` (`deadline`, `interview`, or
  `follow_up` depending on stage);
- 24h and 1h offset nudges for `next_action_at` when in the future.

`dueItems()` uses applications as the source of truth and skips duplicate
"main" reminders, while still surfacing offset nudges.

## 4. Module map

| File | Responsibility |
|------|----------------|
| `lib/config.ts` | Config defaults, data paths, identity scopes |
| `lib/types.ts` | Stage/action/outcome/reminder/event types |
| `lib/db.ts` | Schema and all queries; no ORM, no migration framework |
| `lib/auth.ts` | HMAC-signed session cookie (`lockedin_session`) |
| `lib/oauth.ts` | Google authorization URL, code exchange, userinfo |
| `lib/secrets.ts` | AES-256-GCM store for Google secret and per-user LLM keys |
| `lib/parser/dates.ts` | Relative windows, explicit dates, business days, event dates |
| `lib/parser/rules.ts` | Stage keywords, company/role regexes, next action |
| `lib/parser/llm.ts` | Optional JSON-mode LLM call, Zod validation |
| `lib/parser/pipeline.ts` | Merge rules + LLM, resolve check-back, return draft |
| `lib/reminders.ts` | Reminder sync, due/upcoming feeds, snooze |
| `lib/calendar.ts` | ICS generation, browser notification payload |
| `lib/api.ts` | Route helpers, session enforcement, serializers |
| `lib/schemas.ts` | Zod request schemas |
| `app/api/**/route.ts` | HTTP endpoints |
| `app/oauth/**/route.ts` | Google identity flow |
| `components/` | Dashboard, detail/application/settings modals, shared UI |
| `public/sw.js` | Service worker for notifications |
| `tests/` | Vitest suite |

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

**Parser output contract** (`parseEmail`):
```
company, role, location, stage, confidence, evidence[],
parser ("rules"|"llm"|"hybrid"), parser_version,
next_action, action_state,
check_back_at, check_back_source ("explicit_date"|"stated_window"|
  "stage_default"|"default"|"none"|"manual"|"snoozed"|"outcome"),
next_action_at, received_at, subject, from_email, response_window
```

`check_back_at` is when to follow up. `next_action_at` is the concrete
deadline/event for assessments, interviews, and offers. For `applied`, only
`check_back_at` is set, so the Today view does not show duplicate items.

## 6. Parser behaviour

`dates.extractResponseWindow` looks for, in order:
1. explicit deadlines: `by`, `no later than`, `on or before`, `due`, `respond by`;
2. relative windows: `within 2 weeks`, `7-10 business days`, `in two months`;
3. default: `default_follow_up_days`.

Business-day windows skip weekends. Yearless dates more than 30 days in the
past roll forward one year. Date-only values land at 09:00 in the user's
timezone. `extractEventDate` finds a date in a sentence mentioning
interview/assessment/deadline/respond by and is used as `next_action_at`.

`rules.classifyStage` priorities: rejection → withdrawn → offer →
assessment → interview → applied. Company extraction uses explicit patterns
first, then the sender domain unless it is a known ATS/job-board domain.
There is no fuzzy company matching.

`llm.parseWithLLM` supports three providers. OpenAI and Grok call
`{base}/chat/completions` with a bearer token, `temperature=0`, and
`response_format=json_object`. Claude calls `{base}/messages` with `x-api-key`
and `anthropic-version`, a top-level `system` prompt, and no response format.
Responses (including fenced JSON) are validated with Zod. Any
network/validation failure returns `null`; rules win.

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

There is no formal migration framework. `SCHEMA` uses `CREATE TABLE IF NOT
EXISTS`. The fresh database lives at `data/lockedin.db`; the old Python/Gmail
database was intentionally not migrated.

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
| `GET /api/stats` | pipeline totals |

All `/api/*` routes except status/me/settings/oauth require a valid session
cookie.

## 9. Current state

The app was rewritten from Python/FastAPI + vanilla JS to Next.js + React +
Tailwind + TypeScript on npm, with a **fresh database** and no data migration.

- Removed: the Python package, pytest suite, `bin/serve.py`, `requirements.txt`,
  `.venv`, and the old Gmail-era database.
- Added: `lib/` data/auth/parser modules, `app/api` route handlers, OAuth
  routes, React dashboard and modals, service worker, ICS export, Vitest suite.
- `npm test`: 17 passing (`parser`, `llm`, `db`).
- `npm run typecheck` and `npm run build` should stay clean.

Known limitations:
- Browser notifications require the tab to be open for polling. There is no
  Web Push backend.
- ICS is a downloadable feed, not a hosted subscription URL with auth tokens.
- SQLite remains single-writer; reminder scheduling is synchronous in the
  request path.
