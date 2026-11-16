import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@/lib/db";
import { inQuietHours, runNotificationSweep } from "@/lib/notify";
import { syncApplicationReminders } from "@/lib/reminders";
import { partsInTimezone } from "@/lib/time";
import type { UserPreferences } from "@/lib/types";

let dir: string;
let db: Database;

const basePrefs: Partial<UserPreferences> = {
  timezone: "UTC",
  notifications_enabled: true,
  push_enabled: false,
  digest_enabled: false,
  quiet_hours_start: "",
  quiet_hours_end: "",
  reminder_channel: "auto",
  telegram_chat_id: "",
};

function prefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    parser_mode: "auto",
    default_follow_up_days: 7,
    timezone: "UTC",
    notifications_enabled: true,
    push_enabled: false,
    digest_enabled: false,
    digest_time: "08:00",
    quiet_hours_start: "",
    quiet_hours_end: "",
    reminder_channel: "auto",
    telegram_chat_id: "",
    llm_provider: "openai",
    llm_base_url: "",
    llm_model: "",
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-notify-"));
  db = createDatabase(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("notification delivery", () => {
  it("detects quiet hours across midnight", () => {
    const settings = prefs({ quiet_hours_start: "22:00", quiet_hours_end: "07:00" });
    expect(inQuietHours(settings, Date.UTC(2026, 10, 2, 23, 0))).toBe(true);
    expect(inQuietHours(settings, Date.UTC(2026, 10, 2, 6, 30))).toBe(true);
    expect(inQuietHours(settings, Date.UTC(2026, 10, 2, 12, 0))).toBe(false);
    expect(inQuietHours(prefs(), Date.UTC(2026, 10, 2, 23, 0))).toBe(false);
  });

  it("stores a channel on synced reminders", () => {
    const userId = db.getOrCreateUser("notify-1", "notify@example.com");
    db.setUserSettings(userId, { ...basePrefs, reminder_channel: "telegram" });
    const app = db.createApplication(userId, {
      company: "Channel Co",
      role: "Intern",
      stage: "applied",
      check_back_at: Date.now() + 86_400_000,
    });
    const reminders = syncApplicationReminders(db, userId, app);
    expect(reminders.some((reminder) => reminder.channel === "telegram")).toBe(true);
  });

  it("marks a quiet-hours sweep as skipped and digests once per day", async () => {
    const userId = db.getOrCreateUser("notify-2", "digest@example.com");
    const now = Date.UTC(2026, 10, 2, 23, 0);
    db.setUserSettings(userId, {
      ...basePrefs,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
    });
    const skipped = await runNotificationSweep(db, { now, userId });
    expect(skipped.skippedQuiet).toBe(1);

    db.setUserSettings(userId, {
      ...basePrefs,
      quiet_hours_start: "",
      quiet_hours_end: "",
      digest_enabled: true,
      digest_time: "08:00",
    });
    const first = await runNotificationSweep(db, { now, userId });
    expect(first.digests).toBe(0);
    const parts = partsInTimezone(now, "UTC");
    const key = `digest:${userId}:${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
      parts.day,
    ).padStart(2, "0")}`;
    expect(db.wasDelivered(key)).toBe(true);
    const second = await runNotificationSweep(db, { now, userId });
    expect(second.digests).toBe(0);
  });

  it("does nothing when notifications are disabled", async () => {
    const userId = db.getOrCreateUser("notify-3", "off@example.com");
    db.setUserSettings(userId, { ...basePrefs, notifications_enabled: false });
    const result = await runNotificationSweep(db, { now: Date.now(), userId });
    expect(result.reminders).toBe(0);
    expect(result.digests).toBe(0);
  });
});
