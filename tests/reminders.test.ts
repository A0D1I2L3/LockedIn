import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/lib/db";
import { dueItems, syncApplicationReminders } from "@/lib/reminders";
import { MS_PER_DAY, nowMs } from "@/lib/time";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-reminders-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("apply-by reminders", () => {
  it("creates the deadline and 3-day/1-day nudges for a saved role", () => {
    const userId = db.getOrCreateUser("u1", "a@example.com");
    const applyBy = nowMs() + 10 * MS_PER_DAY;
    const app = db.createApplication(userId, {
      company: "Wishlist Co",
      role: "Intern",
      stage: "saved",
      apply_by: applyBy,
      applied_at: null,
    });

    syncApplicationReminders(db, userId, app);
    const reminders = db.listReminders(userId, { pendingOnly: true });
    const applyReminders = reminders.filter((reminder) =>
      String(reminder.payload.offset || "").startsWith("apply_by"),
    );

    expect(applyReminders.map((reminder) => reminder.payload.offset).sort()).toEqual([
      "apply_by",
      "apply_by_1",
      "apply_by_3",
    ]);
    expect(applyReminders.every((reminder) => reminder.kind === "deadline")).toBe(true);
  });

  it("surfaces a passed apply-by date in the due feed", () => {
    const userId = db.getOrCreateUser("u1", "a@example.com");
    const app = db.createApplication(userId, {
      company: "Late Co",
      role: "Intern",
      stage: "saved",
      apply_by: nowMs() - MS_PER_DAY,
      applied_at: null,
    });

    const due = dueItems(db, userId);
    expect(due.some((item) => item.application_id === app.id && item.kind === "apply_by")).toBe(
      true,
    );
  });
});
