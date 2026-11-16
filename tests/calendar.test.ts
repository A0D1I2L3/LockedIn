import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userCalendar } from "@/lib/calendar";
import { createDatabase, type Database } from "@/lib/db";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-calendar-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("calendar feed", () => {
  it("includes apply-by deadlines with day and hour alarms", () => {
    const userId = db.getOrCreateUser("cal-1", "cal@example.com");
    const now = Date.now();
    db.createApplication(userId, {
      company: "Calendar Co",
      role: "Intern",
      stage: "saved",
      apply_by: now + 3 * 86_400_000,
      check_back_at: now + 86_400_000,
      next_action: "Send follow-up",
      next_action_at: now + 2 * 86_400_000,
    });
    const ics = userCalendar(db, userId, "https://example.test");
    expect(ics).toContain("Apply by: Calendar Co — Intern");
    expect(ics).toContain("Check in: Calendar Co — Intern");
    expect(ics).toContain("Send follow-up: Calendar Co — Intern");
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT60M");
  });

  it("resolves revocable calendar tokens to a user", () => {
    const userId = db.getOrCreateUser("cal-2", "token@example.com");
    const token = "secret-token-value";
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const created = db.createCalendarToken(userId, hash);
    expect(created?.id).toBeTruthy();
    expect(db.userForCalendarToken(hash)).toBe(userId);
    expect(db.userForCalendarToken("other")).toBeNull();
    expect(db.listCalendarTokens(userId)).toHaveLength(1);
    db.revokeCalendarToken(userId);
    expect(db.userForCalendarToken(hash)).toBeNull();
  });
});
