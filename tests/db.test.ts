import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/lib/db";
import { findMatch } from "@/lib/parse-service";
import { parseEmail } from "@/lib/parser/pipeline";

let dir: string;
let db: Database;

function user(googleId = "u1", email = "a@example.com") {
  return db.getOrCreateUser(googleId, email);
}

function makeApp(userId: number, company = "Acme", fields: Record<string, unknown> = {}) {
  return db.createApplication(userId, {
    company,
    role: "Software Intern",
    stage: "applied",
    check_back_at: 1_800_000_000_000,
    next_action: "Wait for a response",
    ...fields,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("database", () => {
  it("round-trips users and isolates applications", () => {
    const userId = user();
    expect(db.getUser(userId)?.email).toBe("a@example.com");
    expect(user("u1", "new@example.com")).toBe(userId);
    expect(db.getUser(userId)?.email).toBe("new@example.com");

    const other = user("u2", "b@example.com");
    makeApp(userId);
    expect(db.listApplications(userId)).toHaveLength(1);
    expect(db.listApplications(other)).toHaveLength(0);
  });

  it("supports application CRUD and filters", () => {
    const userId = user();
    const first = makeApp(userId, "Acme", { stage: "interview" });
    const second = makeApp(userId, "Beta", { stage: "offer" });

    expect(db.listApplications(userId, { stage: "interview" }).map((row) => row.id)).toEqual([first.id]);
    expect(db.listApplications(userId, { q: "beta" }).map((row) => row.id)).toEqual([second.id]);

    const updated = db.updateApplication(userId, first.id, { company: "Acme Corp", notes: "hello" });
    expect(updated?.company).toBe("Acme Corp");
    expect(updated?.notes).toBe("hello");

    const counts = db.stats(userId).by_stage;
    expect(counts.interview).toBe(1);
    expect(counts.offer).toBe(1);

    db.deleteApplication(userId, first.id);
    expect(db.getApplication(userId, first.id)).toBeNull();
  });

  it("stores saved applications with an apply-by deadline", () => {
    const userId = user();
    const app = makeApp(userId, "Wishlist Co", {
      stage: "saved",
      apply_by: 1_900_000_000_000,
      applied_at: null,
    });

    expect(app.stage).toBe("saved");
    expect(app.apply_by).toBe(1_900_000_000_000);
    expect(app.applied_at).toBeNull();
    expect(db.stats(userId).by_stage.saved).toBe(1);
    expect(db.updateApplication(userId, app.id, { stage: "applied" })?.stage).toBe("applied");
  });

  it("computes totals, due, and upcoming", () => {
    const userId = user();
    makeApp(userId, "Due", { check_back_at: 100 });
    makeApp(userId, "Later", { check_back_at: 9_999_999_999_999 });
    const stats = db.stats(userId, 1_000);
    expect(stats.total).toBe(2);
    expect(stats.active).toBe(2);
    expect(stats.due).toBe(1);
    expect(stats.upcoming).toBe(1);
  });

  it("stores reminders and events", () => {
    const userId = user();
    const app = makeApp(userId);
    const reminder = db.addReminder(userId, app.id, { kind: "check_back", due_at: 123, title: "Check in" });
    expect(reminder.payload).toEqual({});
    expect(db.listReminders(userId)).toHaveLength(1);

    db.completeReminder(userId, reminder.id);
    expect(db.listReminders(userId)).toHaveLength(0);
    expect(db.getReminder(userId, reminder.id)?.status).toBe("done");

    const event = db.addEvent(userId, app.id, "created", { stage: "applied" });
    expect(event.data.stage).toBe("applied");
    expect(db.listEvents(userId, app.id)[0].type).toBe("created");

    db.deleteApplication(userId, app.id);
    expect(db.listEvents(userId, app.id)).toHaveLength(0);
  });

  it("merges user settings", () => {
    const userId = user();
    expect(db.getUserSettings(userId)).toEqual({});
    let merged = db.setUserSettings(userId, { parser_mode: "rules" });
    expect(merged.parser_mode).toBe("rules");
    merged = db.setUserSettings(userId, { default_follow_up_days: 10 });
    expect(merged.parser_mode).toBe("rules");
    expect(merged.default_follow_up_days).toBe(10);
  });

  it("scopes emails to an application", () => {
    const userId = user();
    const app = makeApp(userId);
    const email = db.addEmail(userId, app.id, {
      subject: "Update",
      raw_text: "hello",
      parsed: { stage: "applied" },
      confidence: 0.8,
    });
    expect((email.parsed as Record<string, unknown>).stage).toBe("applied");
    expect(db.listEmails(userId, app.id)).toHaveLength(1);
  });

  it("detects duplicate emails and deletes their audit event", () => {
    const userId = user();
    const app = makeApp(userId);
    const email = db.addEmail(userId, app.id, {
      subject: "Update",
      raw_text: "the same body",
      confidence: 0.8,
    });
    expect(db.findDuplicateEmail(userId, app.id, "the same body")?.id).toBe(email.id);
    expect(db.findDuplicateEmail(userId, app.id, "different body")).toBeNull();

    db.addEvent(userId, app.id, "email", { email_id: email.id, stage: "applied" });
    expect(db.deleteEmail(userId, app.id, email.id)).toBe(true);
    expect(db.getEmail(userId, email.id)).toBeNull();
    expect(db.listEvents(userId, app.id).some((event) => event.type === "email")).toBe(false);
    expect(db.deleteEmail(userId, app.id, email.id)).toBe(false);
  });

  it("restores a trashed application with its emails and events", () => {
    const userId = user();
    const app = makeApp(userId, "Restore Me");
    const email = db.addEmail(userId, app.id, {
      subject: "Update",
      raw_text: "keep this around",
      confidence: 0.8,
    });
    const event = db.addEvent(userId, app.id, "email", { email_id: email.id, stage: "applied" });

    const trashId = db.trashApplication(userId, app.id);
    expect(trashId).toBeTruthy();
    expect(db.getApplication(userId, app.id)).toBeNull();
    expect(db.getEmail(userId, email.id)).toBeNull();
    expect(db.listEvents(userId, app.id).some((row) => row.id === event.id)).toBe(false);

    const restored = db.restoreTrash(userId, trashId!);
    expect(restored?.kind).toBe("application");
    if (restored?.kind !== "application") throw new Error("expected application");
    expect(restored.application.id).toBe(app.id);
    expect(restored.application.company).toBe("Restore Me");
    expect(db.getEmail(userId, email.id)?.id).toBe(email.id);
    expect(db.listEvents(userId, app.id).some((row) => row.id === event.id)).toBe(true);
    expect(db.restoreTrash(userId, trashId!)).toBeNull();
  });

  it("restores a trashed email without touching its application", () => {
    const userId = user();
    const app = makeApp(userId);
    const email = db.addEmail(userId, app.id, {
      subject: "One-off",
      raw_text: "delete me",
      confidence: 0.8,
    });
    const event = db.addEvent(userId, app.id, "email", { email_id: email.id, stage: "applied" });

    const trashId = db.trashEmail(userId, app.id, email.id);
    expect(trashId).toBeTruthy();
    expect(db.getEmail(userId, email.id)).toBeNull();
    expect(db.getApplication(userId, app.id)?.id).toBe(app.id);

    const restored = db.restoreTrash(userId, trashId!);
    expect(restored?.kind).toBe("email");
    if (restored?.kind !== "email") throw new Error("expected email");
    expect(restored.email.id).toBe(email.id);
    expect(db.listEvents(userId, app.id).some((row) => row.id === event.id)).toBe(true);
  });

  it("does not let other users trash or restore an application", () => {
    const owner = user();
    const outsider = user("u2", "b@example.com");
    const app = makeApp(owner);

    expect(db.trashApplication(outsider, app.id)).toBeNull();
    const trashId = db.trashApplication(owner, app.id);
    expect(trashId).toBeTruthy();
    expect(db.restoreTrash(outsider, trashId!)).toBeNull();
    expect(db.getApplication(owner, app.id)).toBeNull();
    expect(db.restoreTrash(owner, trashId!)?.kind).toBe("application");
  });

  it("rejects invalid stages at the database boundary", () => {
    const userId = user();
    const app = makeApp(userId);
    expect(() => db.updateApplication(userId, app.id, { stage: "bogus" })).toThrow(/invalid application/);
  });

  it("migrates legacy user timestamps and email hashes", () => {
    const file = path.join(dir, "legacy.db");
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_user_id TEXT UNIQUE NOT NULL,
        email TEXT,
        created_at TEXT
      );
      CREATE TABLE applications (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        stage TEXT,
        status TEXT,
        action_state TEXT,
        follow_up_count INTEGER,
        check_back_at INTEGER
      );
      CREATE TABLE emails (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        application_id TEXT,
        subject TEXT,
        from_email TEXT,
        received_at INTEGER,
        raw_text TEXT,
        parsed_json TEXT,
        confidence REAL,
        parser_version TEXT,
        created_at INTEGER
      );
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        application_id TEXT,
        status TEXT,
        due_at INTEGER
      );
    `);
    raw
      .prepare("INSERT INTO users (id, google_user_id, email, created_at) VALUES (1, 'g1', 'a@b.c', ?)")
      .run("2024-01-02T03:04:05.000Z");
    raw
      .prepare("INSERT INTO applications (id, user_id, stage, status, action_state, follow_up_count, check_back_at) VALUES ('app1', 1, 'applied', 'active', 'waiting', 0, 1)")
      .run();
    raw
      .prepare(
        "INSERT INTO emails (id, user_id, application_id, subject, from_email, received_at, raw_text, parsed_json, confidence, parser_version, created_at) " +
          "VALUES ('mail1', 1, 'app1', 'Update', '', 1, 'legacy body', '{}', 0.5, 'rules-v1', 1)",
      )
      .run();
    raw.close();

    const migrated = createDatabase(file);
    expect(migrated.getUser(1)?.created_at).toBe(Date.parse("2024-01-02T03:04:05.000Z"));
    expect(migrated.findDuplicateEmail(1, "app1", "legacy body")?.id).toBe("mail1");
  });

  it("matches parsed drafts to existing applications", async () => {
    const userId = user();
    const app = makeApp(userId, "Acme", {
      role: "Software Engineer Intern",
      job_url: "https://acme.com/jobs/1",
    });
    const draft = await parseEmail(
      "We would like to schedule an interview for the Software Engineer Intern role at Acme.",
      { fromEmail: "recruiter@acme.com", receivedAt: 1_800_000_000_000 },
    );
    expect(findMatch(db, userId, draft)?.id).toBe(app.id);
    expect(findMatch(db, userId, { ...draft, company: "Globex", role: "Data Intern", from_email: "hr@globex.com" })).toBeNull();
  });
});
