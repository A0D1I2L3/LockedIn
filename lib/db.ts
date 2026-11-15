import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "@/lib/config";
import { isoNow, nowMs } from "@/lib/time";
import {
  PARSER_VERSION,
  STAGES,
  type Application,
  type EmailRow,
  type Reminder,
  type Stats,
  type TimelineEvent,
  type User,
} from "@/lib/types";

type Row = Record<string, unknown>;
type DbRow = Record<string, unknown>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    google_user_id TEXT UNIQUE NOT NULL,
    email          TEXT,
    created_at     TEXT
);

CREATE TABLE IF NOT EXISTS applications (
    id                TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    company           TEXT NOT NULL DEFAULT '',
    role              TEXT NOT NULL DEFAULT '',
    location          TEXT NOT NULL DEFAULT '',
    job_url           TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL DEFAULT '',
    stage             TEXT NOT NULL DEFAULT 'applied',
    status            TEXT NOT NULL DEFAULT 'active',
    action_state      TEXT NOT NULL DEFAULT 'waiting',
    next_action       TEXT NOT NULL DEFAULT '',
    next_action_at    INTEGER,
    check_back_at     INTEGER,
    check_back_source TEXT NOT NULL DEFAULT 'default',
    applied_at        INTEGER,
    last_contact_at   INTEGER,
    follow_up_count   INTEGER NOT NULL DEFAULT 0,
    notes             TEXT NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    closed_at         INTEGER
);

CREATE TABLE IF NOT EXISTS emails (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    subject        TEXT NOT NULL DEFAULT '',
    from_email     TEXT NOT NULL DEFAULT '',
    received_at    INTEGER,
    raw_text       TEXT NOT NULL DEFAULT '',
    parsed_json    TEXT NOT NULL DEFAULT '{}',
    confidence     REAL NOT NULL DEFAULT 0,
    parser_version TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    kind           TEXT NOT NULL,
    due_at         INTEGER NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending',
    payload_json   TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    completed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    application_id TEXT NOT NULL REFERENCES applications(id),
    type           TEXT NOT NULL,
    data_json      TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    data    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_check_back ON applications(check_back_at);
CREATE INDEX IF NOT EXISTS idx_emails_application ON emails(application_id);
CREATE INDEX IF NOT EXISTS idx_reminders_application ON reminders(application_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_events_application ON events(application_id);
`;

const APPLICATION_FIELDS = new Set([
  "company", "role", "location", "job_url", "source", "stage", "status",
  "action_state", "next_action", "next_action_at", "check_back_at",
  "check_back_source", "applied_at", "last_contact_at", "follow_up_count",
  "notes", "closed_at",
]);

function plain<T>(row: DbRow | undefined | null): T | null {
  return row ? ({ ...row } as T) : null;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeEmail(row: Row): EmailRow {
  const data = { ...row } as Row;
  const parsed = parseJson(data.parsed_json, {});
  delete data.parsed_json;
  return { ...data, parsed } as unknown as EmailRow;
}

function serializeReminder(row: Row): Reminder {
  const data = { ...row } as Row;
  const payload = parseJson(data.payload_json, {});
  delete data.payload_json;
  return { ...data, payload } as unknown as Reminder;
}

function serializeEvent(row: Row): TimelineEvent {
  const data = { ...row } as Row;
  const eventData = parseJson(data.data_json, {});
  delete data.data_json;
  return { ...data, data: eventData } as unknown as TimelineEvent;
}

let cached: { path: string; db: DatabaseSync } | null = null;

export function getDb(): Database {
  const { dbPath } = getConfig();
  if (!cached || cached.path !== dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    cached = { path: dbPath, db: new DatabaseSync(dbPath) };
  }
  return new Database(cached.db);
}

export function createDatabase(dbPath: string): Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new Database(new DatabaseSync(dbPath));
}

export class Database {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  private all<T>(sql: string, ...params: unknown[]): T[] {
    return (this.db.prepare(sql).all(...(params as never[])) as unknown as DbRow[]).map(
      (row) => ({ ...row }) as T,
    );
  }

  private one<T>(sql: string, ...params: unknown[]): T | null {
    const row = this.db.prepare(sql).get(...(params as never[])) as DbRow | undefined;
    return row ? ({ ...row } as T) : null;
  }

  private run(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  getOrCreateUser(googleUserId: string, email: string): number {
    const existing = this.one<{ id: number }>(
      "SELECT id FROM users WHERE google_user_id = ?",
      googleUserId,
    );
    if (existing) {
      if (email) this.run("UPDATE users SET email = ? WHERE id = ?", email, existing.id);
      return existing.id;
    }
    const result = this.run(
      "INSERT INTO users(google_user_id, email, created_at) VALUES (?, ?, ?)",
      googleUserId,
      email,
      isoNow(),
    );
    return Number(result.lastInsertRowid);
  }

  getUser(userId: number): User | null {
    return plain<User>(this.one<DbRow>("SELECT * FROM users WHERE id = ?", userId));
  }

  allUserIds(): number[] {
    return this.all<{ id: number }>("SELECT id FROM users").map((row) => row.id);
  }

  deleteUser(userId: number) {
    for (const table of ["events", "reminders", "emails", "applications", "user_settings"]) {
      this.run(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    }
    this.run("DELETE FROM users WHERE id = ?", userId);
  }

  getUserSettings(userId: number): Record<string, unknown> {
    const row = this.one<{ data: string }>("SELECT data FROM user_settings WHERE user_id = ?", userId);
    return row ? (parseJson(row.data, {}) as Record<string, unknown>) : {};
  }

  setUserSettings(userId: number, values: Record<string, unknown>) {
    const merged = { ...this.getUserSettings(userId), ...values };
    this.run(
      "INSERT INTO user_settings(user_id, data) VALUES (?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data",
      userId,
      JSON.stringify(merged),
    );
    return merged;
  }

  createApplication(userId: number, data: Record<string, unknown>): Application {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    const ts = nowMs();
    const appliedAt = Number(data.applied_at || ts);
    const values = [
      id,
      userId,
      String(data.company || "").trim(),
      String(data.role || "").trim(),
      String(data.location || "").trim(),
      String(data.job_url || "").trim(),
      String(data.source || "").trim(),
      String(data.stage || "applied"),
      String(data.status || "active"),
      String(data.action_state || "waiting"),
      String(data.next_action || "").trim(),
      data.next_action_at ?? null,
      data.check_back_at ?? null,
      String(data.check_back_source || "default"),
      appliedAt,
      data.last_contact_at ?? appliedAt,
      Number(data.follow_up_count || 0),
      String(data.notes || ""),
      ts,
      ts,
      data.closed_at ?? null,
    ];
    this.run(
      `INSERT INTO applications (
        id, user_id, company, role, location, job_url, source, stage, status,
        action_state, next_action, next_action_at, check_back_at,
        check_back_source, applied_at, last_contact_at, follow_up_count, notes,
        created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...values,
    );
    return this.getApplication(userId, id)!;
  }

  getApplication(userId: number, appId: string): Application | null {
    return plain<Application>(
      this.one<DbRow>("SELECT * FROM applications WHERE user_id = ? AND id = ?", userId, appId),
    );
  }

  listApplications(
    userId: number,
    options: {
      stage?: string;
      status?: string;
      q?: string;
      dueBefore?: number;
      limit?: number;
      offset?: number;
    } = {},
  ): Application[] {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (options.stage && options.stage !== "all") {
      clauses.push("stage = ?");
      params.push(options.stage);
    }
    if (options.status && options.status !== "all") {
      clauses.push("status = ?");
      params.push(options.status);
    }
    if (options.dueBefore !== undefined) {
      clauses.push("status = 'active' AND check_back_at IS NOT NULL AND check_back_at <= ?");
      params.push(options.dueBefore);
    }
    if (options.q) {
      const like = `%${options.q}%`;
      clauses.push("(company LIKE ? OR role LIKE ? OR notes LIKE ? OR next_action LIKE ?)");
      params.push(like, like, like, like);
    }
    params.push(options.limit ?? 500, options.offset ?? 0);
    return this.all<Application>(
      `SELECT * FROM applications WHERE ${clauses.join(" AND ")} ` +
        "ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      ...params,
    );
  }

  updateApplication(
    userId: number,
    appId: string,
    fields: Record<string, unknown>,
  ): Application | null {
    const allowed = Object.fromEntries(
      Object.entries(fields).filter(([key]) => APPLICATION_FIELDS.has(key)),
    );
    if (Object.keys(allowed).length === 0) return this.getApplication(userId, appId);
    allowed.updated_at = nowMs();
    const assignments = Object.keys(allowed).map((key) => `${key} = ?`).join(", ");
    this.run(
      `UPDATE applications SET ${assignments} WHERE user_id = ? AND id = ?`,
      ...Object.values(allowed),
      userId,
      appId,
    );
    return this.getApplication(userId, appId);
  }

  deleteApplication(userId: number, appId: string) {
    for (const table of ["events", "reminders", "emails"]) {
      this.run(`DELETE FROM ${table} WHERE user_id = ? AND application_id = ?`, userId, appId);
    }
    this.run("DELETE FROM applications WHERE user_id = ? AND id = ?", userId, appId);
  }

  stats(userId: number, now = nowMs()): Stats {
    const rows = this.all<{ stage: string; n: number }>(
      "SELECT stage, COUNT(*) AS n FROM applications WHERE user_id = ? GROUP BY stage",
      userId,
    );
    const active = this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active'",
      userId,
    );
    const due = this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active' " +
        "AND check_back_at IS NOT NULL AND check_back_at <= ?",
      userId,
      now,
    );
    const upcoming = this.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM applications WHERE user_id = ? AND status = 'active' " +
        "AND check_back_at IS NOT NULL AND check_back_at > ?",
      userId,
      now,
    );
    const counts = Object.fromEntries(rows.map((row) => [row.stage, row.n]));
    const byStage = Object.fromEntries(STAGES.map((stage) => [stage, counts[stage] || 0])) as Stats["by_stage"];
    return {
      by_stage: byStage,
      total: rows.reduce((sum, row) => sum + Number(row.n), 0),
      active: Number(active?.n || 0),
      due: Number(due?.n || 0),
      upcoming: Number(upcoming?.n || 0),
    };
  }

  addEmail(userId: number, appId: string, data: Record<string, unknown>): EmailRow {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    this.run(
      `INSERT INTO emails (
        id, user_id, application_id, subject, from_email, received_at,
        raw_text, parsed_json, confidence, parser_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.subject || ""),
      String(data.from_email || ""),
      data.received_at ?? null,
      String(data.raw_text || ""),
      JSON.stringify(data.parsed || {}),
      Number(data.confidence || 0),
      String(data.parser_version || PARSER_VERSION),
      nowMs(),
    );
    return this.getEmail(userId, id)!;
  }

  getEmail(userId: number, emailId: string): EmailRow | null {
    const row = this.one<DbRow>("SELECT * FROM emails WHERE user_id = ? AND id = ?", userId, emailId);
    return row ? serializeEmail(row) : null;
  }

  listEmails(userId: number, appId: string): EmailRow[] {
    return this.all<DbRow>(
      "SELECT * FROM emails WHERE user_id = ? AND application_id = ? ORDER BY created_at DESC",
      userId,
      appId,
    ).map(serializeEmail);
  }

  addReminder(userId: number, appId: string, data: Record<string, unknown>): Reminder {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    this.run(
      `INSERT INTO reminders (
        id, user_id, application_id, kind, due_at, title, body, status,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.kind),
      Number(data.due_at),
      String(data.title || ""),
      String(data.body || ""),
      String(data.status || "pending"),
      JSON.stringify(data.payload || {}),
      nowMs(),
    );
    return this.getReminder(userId, id)!;
  }

  getReminder(userId: number, reminderId: string): Reminder | null {
    const row = this.one<DbRow>(
      "SELECT * FROM reminders WHERE user_id = ? AND id = ?",
      userId,
      reminderId,
    );
    return row ? serializeReminder(row) : null;
  }

  listReminders(
    userId: number,
    options: {
      appId?: string;
      pendingOnly?: boolean;
      dueBefore?: number;
      limit?: number;
    } = {},
  ): Reminder[] {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (options.appId) {
      clauses.push("application_id = ?");
      params.push(options.appId);
    }
    if (options.pendingOnly !== false) clauses.push("status = 'pending'");
    if (options.dueBefore !== undefined) {
      clauses.push("due_at <= ?");
      params.push(options.dueBefore);
    }
    params.push(options.limit ?? 500);
    return this.all<DbRow>(
      `SELECT * FROM reminders WHERE ${clauses.join(" AND ")} ORDER BY due_at ASC LIMIT ?`,
      ...params,
    ).map(serializeReminder);
  }

  completeReminder(userId: number, reminderId: string, status = "done") {
    this.run(
      "UPDATE reminders SET status = ?, completed_at = ? WHERE user_id = ? AND id = ?",
      status,
      nowMs(),
      userId,
      reminderId,
    );
  }

  cancelReminders(userId: number, appId: string, kind?: string): number {
    const clauses = ["user_id = ?", "application_id = ?", "status = 'pending'"];
    const params: unknown[] = [userId, appId];
    if (kind) {
      clauses.push("kind = ?");
      params.push(kind);
    }
    const result = this.run(
      `UPDATE reminders SET status = 'cancelled', completed_at = ? WHERE ${clauses.join(" AND ")}`,
      nowMs(),
      ...params,
    );
    return Number(result.changes);
  }

  addEvent(
    userId: number,
    appId: string,
    eventType: string,
    data: Record<string, unknown> = {},
  ): TimelineEvent {
    const eventId = crypto.randomUUID().replaceAll("-", "");
    const createdAt = nowMs();
    this.run(
      "INSERT INTO events (id, user_id, application_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      eventId,
      userId,
      appId,
      eventType,
      JSON.stringify(data),
      createdAt,
    );
    return {
      id: eventId,
      user_id: userId,
      application_id: appId,
      type: eventType,
      data,
      created_at: createdAt,
    };
  }

  listEvents(userId: number, appId: string, limit = 100): TimelineEvent[] {
    return this.all<DbRow>(
      "SELECT * FROM events WHERE user_id = ? AND application_id = ? " +
        "ORDER BY created_at DESC LIMIT ?",
      userId,
      appId,
      limit,
    ).map(serializeEvent);
  }
}
