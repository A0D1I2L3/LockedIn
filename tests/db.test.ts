import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/lib/db";

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
});
