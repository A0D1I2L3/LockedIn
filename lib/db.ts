import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getConfig } from "@/lib/config";
import { nowMs } from "@/lib/time";
import {
  PARSER_VERSION,
  STAGES,
  type Application,
  type Contact,
  type EmailRow,
  type Interview,
  type PrepItem,
  type PushSubscriptionRecord,
  type Reminder,
  type Stats,
  type TimelineEvent,
  type User,
} from "@/lib/types";

type Row = Record<string, unknown>;
type DbRow = Record<string, unknown>;

const APPLICATION_COLUMNS = `
    id                TEXT PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company           TEXT NOT NULL DEFAULT '',
    role              TEXT NOT NULL DEFAULT '',
    location          TEXT NOT NULL DEFAULT '',
    job_url           TEXT NOT NULL DEFAULT '',
    source            TEXT NOT NULL DEFAULT '',
    stage             TEXT NOT NULL DEFAULT 'saved'
                      CHECK (stage IN ('saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    action_state      TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (action_state IN ('waiting', 'action_required', 'follow_up_due', 'done')),
    next_action       TEXT NOT NULL DEFAULT '',
    next_action_at    INTEGER,
    check_back_at     INTEGER,
    check_back_source TEXT NOT NULL DEFAULT 'default',
    apply_by          INTEGER,
    applied_at        INTEGER,
    last_contact_at   INTEGER,
    follow_up_count   INTEGER NOT NULL DEFAULT 0 CHECK (follow_up_count >= 0),
    notes             TEXT NOT NULL DEFAULT '',
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    closed_at         INTEGER
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    google_user_id TEXT UNIQUE NOT NULL,
    email          TEXT,
    created_at     INTEGER
);

CREATE TABLE IF NOT EXISTS applications (${APPLICATION_COLUMNS});

CREATE TABLE IF NOT EXISTS emails (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    subject        TEXT NOT NULL DEFAULT '',
    from_email     TEXT NOT NULL DEFAULT '',
    received_at    INTEGER,
    raw_text       TEXT NOT NULL DEFAULT '',
    raw_hash       TEXT NOT NULL DEFAULT '',
    parsed_json    TEXT NOT NULL DEFAULT '{}',
    confidence     REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
    parser_version TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,
    due_at         INTEGER NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'done', 'dismissed', 'cancelled')),
    channel        TEXT NOT NULL DEFAULT 'auto',
    payload_json   TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL,
    completed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    data_json      TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS trash (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('application', 'email')),
    data_json  TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id   TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    type             TEXT NOT NULL DEFAULT 'interview',
    scheduled_at     INTEGER,
    duration_minutes INTEGER NOT NULL DEFAULT 45,
    link             TEXT NOT NULL DEFAULT '',
    interviewer      TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    prep_json        TEXT NOT NULL DEFAULT '[]',
    questions_json   TEXT NOT NULL DEFAULT '[]',
    created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    name           TEXT NOT NULL DEFAULT '',
    email          TEXT NOT NULL DEFAULT '',
    role           TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_tokens (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS delivery_log (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dedupe_key TEXT NOT NULL UNIQUE,
    channel    TEXT NOT NULL,
    sent_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_check_back ON applications(check_back_at);
CREATE INDEX IF NOT EXISTS idx_applications_user_status_check
  ON applications(user_id, status, check_back_at);
CREATE INDEX IF NOT EXISTS idx_applications_user_stage ON applications(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_emails_application ON emails(application_id);
CREATE INDEX IF NOT EXISTS idx_emails_user_application_created
  ON emails(user_id, application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_application ON reminders(application_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_user_status_due ON reminders(user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_events_application ON events(application_id);
CREATE INDEX IF NOT EXISTS idx_events_user_application_created
  ON events(user_id, application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trash_user_created ON trash(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_user_sent ON delivery_log(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_calendar_tokens_user ON calendar_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_application ON interviews(application_id);
CREATE INDEX IF NOT EXISTS idx_interviews_user_scheduled ON interviews(user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_contacts_application ON contacts(application_id);
`;

const GUARDS = `
CREATE TRIGGER IF NOT EXISTS guard_applications_insert
BEFORE INSERT ON applications
WHEN NEW.stage NOT IN ('saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')
  OR NEW.status NOT IN ('active', 'closed')
  OR NEW.action_state NOT IN ('waiting', 'action_required', 'follow_up_due', 'done')
BEGIN
  SELECT RAISE(ABORT, 'invalid application stage, status, or action_state');
END;

CREATE TRIGGER IF NOT EXISTS guard_applications_update
BEFORE UPDATE ON applications
WHEN NEW.stage NOT IN ('saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')
  OR NEW.status NOT IN ('active', 'closed')
  OR NEW.action_state NOT IN ('waiting', 'action_required', 'follow_up_due', 'done')
BEGIN
  SELECT RAISE(ABORT, 'invalid application stage, status, or action_state');
END;

CREATE TRIGGER IF NOT EXISTS guard_emails_insert
BEFORE INSERT ON emails
WHEN NEW.confidence < 0 OR NEW.confidence > 1
BEGIN
  SELECT RAISE(ABORT, 'email confidence must be between 0 and 1');
END;

CREATE TRIGGER IF NOT EXISTS guard_emails_update
BEFORE UPDATE ON emails
WHEN NEW.confidence < 0 OR NEW.confidence > 1
BEGIN
  SELECT RAISE(ABORT, 'email confidence must be between 0 and 1');
END;

CREATE TRIGGER IF NOT EXISTS guard_reminders_insert
BEFORE INSERT ON reminders
WHEN NEW.status NOT IN ('pending', 'done', 'dismissed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid reminder status');
END;

CREATE TRIGGER IF NOT EXISTS guard_reminders_update
BEFORE UPDATE ON reminders
WHEN NEW.status NOT IN ('pending', 'done', 'dismissed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid reminder status');
END;
`;

const APPLICATION_FIELDS = new Set([
  "company", "role", "location", "job_url", "source", "stage", "status",
  "action_state", "next_action", "next_action_at", "check_back_at",
  "check_back_source", "apply_by", "applied_at", "last_contact_at", "follow_up_count",
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

function serializeInterview(row: Row): Interview {
  const data = { ...row } as Row;
  const prep = parseJson(data.prep_json, []) as PrepItem[];
  const questions = parseJson(data.questions_json, []) as string[];
  delete data.prep_json;
  delete data.questions_json;
  return { ...data, prep, questions } as unknown as Interview;
}

function serializeContact(row: Row): Contact {
  return { ...row } as unknown as Contact;
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

function hashEmailText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export class Database {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrateLegacy();
  }

  private migrateLegacy() {
    this.migrateUserTimestamps();
    this.ensureEmailHashColumn();
    this.ensureReminderChannel();
    this.migrateApplicationSchema();
    this.run(
      "UPDATE applications SET stage = 'applied' WHERE stage NOT IN " +
        "('saved', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')",
    );
    this.run(
      "UPDATE applications SET status = 'active' WHERE status NOT IN ('active', 'closed')",
    );
    this.run(
      "UPDATE applications SET action_state = 'waiting' WHERE action_state NOT IN " +
        "('waiting', 'action_required', 'follow_up_due', 'done')",
    );
    this.run("UPDATE applications SET follow_up_count = 0 WHERE follow_up_count < 0");
    this.run("UPDATE emails SET confidence = 0 WHERE confidence < 0");
    this.run("UPDATE emails SET confidence = 1 WHERE confidence > 1");
    this.run(
      "UPDATE reminders SET status = 'pending' WHERE status NOT IN " +
        "('pending', 'done', 'dismissed', 'cancelled')",
    );
    this.db.exec(GUARDS);
    this.run(
      "DELETE FROM trash WHERE created_at < ?",
      nowMs() - 7 * 24 * 60 * 60 * 1000,
    );
    this.pruneDeliveryLog();
  }

  private ensureReminderChannel() {
    const columns = this.all<{ name: string }>("PRAGMA table_info(reminders)");
    if (!columns.some((column) => column.name === "channel")) {
      this.run("ALTER TABLE reminders ADD COLUMN channel TEXT NOT NULL DEFAULT 'auto'");
    }
  }

  private migrateUserTimestamps() {
    const columns = this.all<{ name: string; type: string }>("PRAGMA table_info(users)");
    const createdAt = columns.find((column) => column.name === "created_at");
    if (!createdAt || createdAt.type.toUpperCase() === "INTEGER") return;
    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.exec(`
        BEGIN;
        CREATE TABLE users_ms (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          google_user_id TEXT UNIQUE NOT NULL,
          email          TEXT,
          created_at     INTEGER
        );
        INSERT INTO users_ms (id, google_user_id, email, created_at)
        SELECT id, google_user_id, email,
          CASE
            WHEN created_at IS NULL THEN NULL
            WHEN typeof(created_at) = 'text' THEN CAST(strftime('%s', created_at) AS INTEGER) * 1000
            ELSE CAST(created_at AS INTEGER)
          END
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_ms RENAME TO users;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no active transaction
      }
      throw error;
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
    }
  }

  private migrateApplicationSchema() {
    const table = this.one<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'applications'",
    );
    const columns = this.all<{ name: string }>("PRAGMA table_info(applications)");
    const hasApplyBy = columns.some((column) => column.name === "apply_by");
    const hasSaved = Boolean(table?.sql.includes("'saved'"));
    if (hasApplyBy && hasSaved) return;

    if (hasSaved && !hasApplyBy) {
      this.run("ALTER TABLE applications ADD COLUMN apply_by INTEGER");
      return;
    }

    this.db.exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.exec("BEGIN");
      this.db.exec(`CREATE TABLE applications_new (${APPLICATION_COLUMNS})`);
      const target = [
        "id", "user_id", "company", "role", "location", "job_url", "source", "stage",
        "status", "action_state", "next_action", "next_action_at", "check_back_at",
        "check_back_source", "apply_by", "applied_at", "last_contact_at",
        "follow_up_count", "notes", "created_at", "updated_at", "closed_at",
      ];
      const existing = new Set(columns.map((column) => column.name));
      const defaults: Record<string, string> = {
        company: "''",
        role: "''",
        location: "''",
        job_url: "''",
        source: "''",
        stage: "'applied'",
        status: "'active'",
        action_state: "'waiting'",
        next_action: "''",
        check_back_source: "'default'",
        follow_up_count: "0",
        notes: "''",
        created_at: "0",
        updated_at: "0",
      };
      const select = target
        .map((name) => (existing.has(name) ? name : defaults[name] ?? "NULL"))
        .join(", ");
      this.run(
        `INSERT INTO applications_new (${target.join(", ")}) SELECT ${select} FROM applications`,
      );
      this.run("DROP TABLE applications");
      this.run("ALTER TABLE applications_new RENAME TO applications");
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no active transaction
      }
      throw error;
    } finally {
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec(SCHEMA);
      this.db.exec(GUARDS);
    }
  }

  private ensureEmailHashColumn() {
    const columns = this.all<{ name: string }>("PRAGMA table_info(emails)");
    if (!columns.some((column) => column.name === "raw_hash")) {
      this.run("ALTER TABLE emails ADD COLUMN raw_hash TEXT NOT NULL DEFAULT ''");
    }
    const rows = this.all<{ id: string; raw_text: string }>(
      "SELECT id, raw_text FROM emails WHERE raw_hash = ''",
    );
    for (const row of rows) {
      this.run(
        "UPDATE emails SET raw_hash = ? WHERE id = ?",
        hashEmailText(row.raw_text || ""),
        row.id,
      );
    }
    this.run(
      "CREATE INDEX IF NOT EXISTS idx_emails_hash " +
        "ON emails(user_id, application_id, raw_hash)",
    );
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

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no active transaction
      }
      throw error;
    }
  }

  private insertRow(table: string, columns: string[], row: DbRow) {
    this.run(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      ...columns.map((column) => row[column] ?? null),
    );
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
      nowMs(),
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
    for (const table of ["trash", "events", "reminders", "emails", "applications", "user_settings"]) {
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
    const appliedAt =
      data.applied_at === null
        ? null
        : data.applied_at === undefined
          ? String(data.stage || "applied") === "saved"
            ? null
            : ts
          : Number(data.applied_at);
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
      data.apply_by ?? null,
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
        check_back_source, apply_by, applied_at, last_contact_at, follow_up_count, notes,
        created_at, updated_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        raw_text, raw_hash, parsed_json, confidence, parser_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.subject || ""),
      String(data.from_email || ""),
      data.received_at ?? null,
      String(data.raw_text || ""),
      hashEmailText(String(data.raw_text || "")),
      JSON.stringify(data.parsed || {}),
      Number(data.confidence || 0),
      String(data.parser_version || PARSER_VERSION),
      nowMs(),
    );
    return this.getEmail(userId, id)!;
  }

  findDuplicateEmail(userId: number, appId: string, rawText: string): EmailRow | null {
    const row = this.one<DbRow>(
      "SELECT * FROM emails WHERE user_id = ? AND application_id = ? AND raw_hash = ? " +
        "ORDER BY created_at DESC LIMIT 1",
      userId,
      appId,
      hashEmailText(rawText),
    );
    return row ? serializeEmail(row) : null;
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

  deleteEmail(userId: number, appId: string, emailId: string): boolean {
    const email = this.one<DbRow>(
      "SELECT id FROM emails WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      emailId,
    );
    if (!email) return false;
    this.run(
      "DELETE FROM events WHERE user_id = ? AND application_id = ? AND type = 'email' " +
        "AND json_extract(data_json, '$.email_id') = ?",
      userId,
      appId,
      emailId,
    );
    this.run(
      "DELETE FROM emails WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      emailId,
    );
    return true;
  }

  trashApplication(userId: number, appId: string): string | null {
    return this.transaction(() => {
      const application = this.one<DbRow>(
        "SELECT * FROM applications WHERE user_id = ? AND id = ?",
        userId,
        appId,
      );
      if (!application) return null;
      const data = {
        application,
        emails: this.all<DbRow>(
          "SELECT * FROM emails WHERE user_id = ? AND application_id = ?",
          userId,
          appId,
        ),
        reminders: this.all<DbRow>(
          "SELECT * FROM reminders WHERE user_id = ? AND application_id = ?",
          userId,
          appId,
        ),
        events: this.all<DbRow>(
          "SELECT * FROM events WHERE user_id = ? AND application_id = ?",
          userId,
          appId,
        ),
        interviews: this.all<DbRow>(
          "SELECT * FROM interviews WHERE user_id = ? AND application_id = ?",
          userId,
          appId,
        ),
        contacts: this.all<DbRow>(
          "SELECT * FROM contacts WHERE user_id = ? AND application_id = ?",
          userId,
          appId,
        ),
      };
      const id = crypto.randomUUID().replaceAll("-", "");
      this.run(
        "INSERT INTO trash(id, user_id, kind, data_json, created_at) VALUES (?, ?, 'application', ?, ?)",
        id,
        userId,
        JSON.stringify(data),
        nowMs(),
      );
      this.deleteApplication(userId, appId);
      return id;
    });
  }

  trashEmail(userId: number, appId: string, emailId: string): string | null {
    return this.transaction(() => {
      const email = this.one<DbRow>(
        "SELECT * FROM emails WHERE user_id = ? AND application_id = ? AND id = ?",
        userId,
        appId,
        emailId,
      );
      if (!email) return null;
      const data = {
        email,
        events: this.all<DbRow>(
          "SELECT * FROM events WHERE user_id = ? AND application_id = ? AND type = 'email' " +
            "AND json_extract(data_json, '$.email_id') = ?",
          userId,
          appId,
          emailId,
        ),
      };
      const id = crypto.randomUUID().replaceAll("-", "");
      this.run(
        "INSERT INTO trash(id, user_id, kind, data_json, created_at) VALUES (?, ?, 'email', ?, ?)",
        id,
        userId,
        JSON.stringify(data),
        nowMs(),
      );
      this.deleteEmail(userId, appId, emailId);
      return id;
    });
  }

  restoreTrash(
    userId: number,
    trashId: string,
  ):
    | { kind: "application"; application: Application }
    | { kind: "email"; email: EmailRow }
    | null {
    const entry = this.one<{ kind: string; data_json: string }>(
      "SELECT kind, data_json FROM trash WHERE user_id = ? AND id = ?",
      userId,
      trashId,
    );
    if (!entry) return null;
    const data = parseJson(entry.data_json, {}) as Record<string, DbRow | DbRow[]>;
    return this.transaction(() => {
      if (entry.kind === "application") {
        const application = data.application as DbRow;
        if (Number(application.user_id) !== userId) throw new Error("Trash entry mismatch");
        this.insertRow(
          "applications",
          [
            "id", "user_id", "company", "role", "location", "job_url", "source",
            "stage", "status", "action_state", "next_action", "next_action_at",
            "check_back_at", "check_back_source", "apply_by", "applied_at",
            "last_contact_at", "follow_up_count", "notes", "created_at", "updated_at",
            "closed_at",
          ],
          application,
        );
        const columns: Record<string, string[]> = {
          emails: [
            "id", "user_id", "application_id", "subject", "from_email", "received_at",
            "raw_text", "raw_hash", "parsed_json", "confidence", "parser_version",
            "created_at",
          ],
          reminders: [
            "id", "user_id", "application_id", "kind", "due_at", "title", "body",
            "status", "channel", "payload_json", "created_at", "completed_at",
          ],
          events: ["id", "user_id", "application_id", "type", "data_json", "created_at"],
          interviews: [
            "id", "user_id", "application_id", "type", "scheduled_at",
            "duration_minutes", "link", "interviewer", "notes", "prep_json",
            "questions_json", "created_at",
          ],
          contacts: [
            "id", "user_id", "application_id", "name", "email", "role", "notes",
            "created_at",
          ],
        };
        for (const [table, tableColumns] of Object.entries(columns)) {
          for (const row of data[table] as DbRow[]) {
            this.insertRow(table, tableColumns, row);
          }
        }
        this.run("DELETE FROM trash WHERE user_id = ? AND id = ?", userId, trashId);
        return { kind: "application", application: this.getApplication(userId, String(application.id))! };
      }
      if (entry.kind === "email") {
        const email = data.email as DbRow;
        if (Number(email.user_id) !== userId) throw new Error("Trash entry mismatch");
        this.insertRow(
          "emails",
          [
            "id", "user_id", "application_id", "subject", "from_email", "received_at",
            "raw_text", "raw_hash", "parsed_json", "confidence", "parser_version",
            "created_at",
          ],
          email,
        );
        for (const row of data.events as DbRow[]) {
          this.insertRow(
            "events",
            ["id", "user_id", "application_id", "type", "data_json", "created_at"],
            row,
          );
        }
        this.run("DELETE FROM trash WHERE user_id = ? AND id = ?", userId, trashId);
        return { kind: "email", email: this.getEmail(userId, String(email.id))! };
      }
      throw new Error("Unsupported trash entry");
    });
  }

  addReminder(userId: number, appId: string, data: Record<string, unknown>): Reminder {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    this.run(
      `INSERT INTO reminders (
        id, user_id, application_id, kind, due_at, title, body, status, channel,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.kind),
      Number(data.due_at),
      String(data.title || ""),
      String(data.body || ""),
      String(data.status || "pending"),
      String(data.channel || "auto"),
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

  setReminderChannel(userId: number, reminderId: string, channel: string) {
    this.run(
      "UPDATE reminders SET channel = ? WHERE user_id = ? AND id = ? AND status = 'pending'",
      channel,
      userId,
      reminderId,
    );
  }

  listPushSubscriptions(userId: number): PushSubscriptionRecord[] {
    return this.all<DbRow>(
      "SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC",
      userId,
    ) as unknown as PushSubscriptionRecord[];
  }

  savePushSubscription(
    userId: number,
    data: { endpoint: string; p256dh: string; auth: string },
  ): PushSubscriptionRecord {
    const id = crypto.randomUUID().replaceAll("-", "");
    this.run(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
      id,
      userId,
      data.endpoint,
      data.p256dh,
      data.auth,
      nowMs(),
    );
    return this.one<DbRow>(
      "SELECT * FROM push_subscriptions WHERE endpoint = ?",
      data.endpoint,
    ) as unknown as PushSubscriptionRecord;
  }

  deletePushSubscription(userId: number, endpoint: string) {
    this.run(
      "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
      userId,
      endpoint,
    );
  }

  createCalendarToken(userId: number, tokenHash: string) {
    const id = crypto.randomUUID().replaceAll("-", "");
    this.run(
      "INSERT INTO calendar_tokens (id, user_id, token_hash, created_at) VALUES (?, ?, ?, ?)",
      id,
      userId,
      tokenHash,
      nowMs(),
    );
    return this.one<DbRow>("SELECT * FROM calendar_tokens WHERE id = ?", id);
  }

  listCalendarTokens(userId: number) {
    return this.all<DbRow>(
      "SELECT id, created_at, last_used_at FROM calendar_tokens WHERE user_id = ? ORDER BY created_at DESC",
      userId,
    );
  }

  revokeCalendarToken(userId: number, id?: string) {
    if (id) {
      this.run("DELETE FROM calendar_tokens WHERE user_id = ? AND id = ?", userId, id);
    } else {
      this.run("DELETE FROM calendar_tokens WHERE user_id = ?", userId);
    }
  }

  userForCalendarToken(tokenHash: string): number | null {
    const row = this.one<{ user_id: number; id: string }>(
      "SELECT user_id, id FROM calendar_tokens WHERE token_hash = ?",
      tokenHash,
    );
    if (!row) return null;
    this.run("UPDATE calendar_tokens SET last_used_at = ? WHERE id = ?", nowMs(), row.id);
    return row.user_id;
  }

  listInterviews(userId: number, appId: string): Interview[] {
    return this.all<DbRow>(
      "SELECT * FROM interviews WHERE user_id = ? AND application_id = ? ORDER BY scheduled_at ASC, created_at ASC",
      userId,
      appId,
    ).map(serializeInterview);
  }

  getInterview(userId: number, appId: string, id: string): Interview | null {
    const row = this.one<DbRow>(
      "SELECT * FROM interviews WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      id,
    );
    return row ? serializeInterview(row) : null;
  }

  addInterview(userId: number, appId: string, data: Record<string, unknown>): Interview {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    this.run(
      `INSERT INTO interviews (
        id, user_id, application_id, type, scheduled_at, duration_minutes, link,
        interviewer, notes, prep_json, questions_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.type || "interview"),
      data.scheduled_at ?? null,
      Number(data.duration_minutes || 45),
      String(data.link || ""),
      String(data.interviewer || ""),
      String(data.notes || ""),
      JSON.stringify(data.prep || []),
      JSON.stringify(data.questions || []),
      nowMs(),
    );
    return this.getInterview(userId, appId, id)!;
  }

  updateInterview(
    userId: number,
    appId: string,
    id: string,
    fields: Record<string, unknown>,
  ): Interview | null {
    const allowed = [
      "type",
      "scheduled_at",
      "duration_minutes",
      "link",
      "interviewer",
      "notes",
      "prep",
      "questions",
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of allowed) {
      if (!(key in fields)) continue;
      if (key === "prep" || key === "questions") {
        sets.push(`${key}_json = ?`);
        params.push(JSON.stringify(fields[key] || []));
      } else {
        sets.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.getInterview(userId, appId, id);
    params.push(userId, appId, id);
    this.run(
      `UPDATE interviews SET ${sets.join(", ")} WHERE user_id = ? AND application_id = ? AND id = ?`,
      ...params,
    );
    return this.getInterview(userId, appId, id);
  }

  deleteInterview(userId: number, appId: string, id: string) {
    this.run(
      "DELETE FROM interviews WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      id,
    );
  }

  listContacts(userId: number, appId: string): Contact[] {
    return this.all<DbRow>(
      "SELECT * FROM contacts WHERE user_id = ? AND application_id = ? ORDER BY created_at ASC",
      userId,
      appId,
    ).map(serializeContact);
  }

  getContact(userId: number, appId: string, id: string): Contact | null {
    const row = this.one<DbRow>(
      "SELECT * FROM contacts WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      id,
    );
    return row ? serializeContact(row) : null;
  }

  addContact(userId: number, appId: string, data: Record<string, unknown>): Contact {
    const id = String(data.id || crypto.randomUUID().replaceAll("-", ""));
    this.run(
      `INSERT INTO contacts (id, user_id, application_id, name, email, role, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      appId,
      String(data.name || ""),
      String(data.email || ""),
      String(data.role || ""),
      String(data.notes || ""),
      nowMs(),
    );
    return this.getContact(userId, appId, id)!;
  }

  updateContact(
    userId: number,
    appId: string,
    id: string,
    fields: Record<string, unknown>,
  ): Contact | null {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of ["name", "email", "role", "notes"]) {
      if (!(key in fields)) continue;
      sets.push(`${key} = ?`);
      params.push(String(fields[key] || ""));
    }
    if (!sets.length) return this.getContact(userId, appId, id);
    params.push(userId, appId, id);
    this.run(
      `UPDATE contacts SET ${sets.join(", ")} WHERE user_id = ? AND application_id = ? AND id = ?`,
      ...params,
    );
    return this.getContact(userId, appId, id);
  }

  deleteContact(userId: number, appId: string, id: string) {
    this.run(
      "DELETE FROM contacts WHERE user_id = ? AND application_id = ? AND id = ?",
      userId,
      appId,
      id,
    );
  }

  listUserIds(): number[] {
    return this.all<{ id: number }>("SELECT id FROM users ORDER BY id").map((row) => row.id);
  }

  wasDelivered(dedupeKey: string): boolean {
    return Boolean(
      this.one("SELECT id FROM delivery_log WHERE dedupe_key = ?", dedupeKey),
    );
  }

  markDelivered(userId: number, dedupeKey: string, channel: string) {
    this.run(
      `INSERT OR IGNORE INTO delivery_log (id, user_id, dedupe_key, channel, sent_at)
       VALUES (?, ?, ?, ?, ?)`,
      crypto.randomUUID().replaceAll("-", ""),
      userId,
      dedupeKey,
      channel,
      nowMs(),
    );
  }

  pruneDeliveryLog(days = 45) {
    this.run("DELETE FROM delivery_log WHERE sent_at < ?", nowMs() - days * 86_400_000);
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
