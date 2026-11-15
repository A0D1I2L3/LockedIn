import type { Database } from "@/lib/db";
import { MS_PER_DAY, nowMs, reminderOffsets } from "@/lib/time";
import type { Application, NotificationItem, Reminder, Stage } from "@/lib/types";

const TERMINAL = new Set<Stage>(["rejected", "withdrawn"]);

function title(app: Application, label: string): string {
  return `${label}: ${app.company || "Application"}${app.role ? ` — ${app.role}` : ""}`;
}

export function syncApplicationReminders(
  db: Database,
  userId: number,
  app: Application,
): Reminder[] {
  db.cancelReminders(userId, app.id);
  if (app.status !== "active" || TERMINAL.has(app.stage)) return [];

  const now = nowMs();
  const created: Reminder[] = [];

  if (app.check_back_at) {
    created.push(
      db.addReminder(userId, app.id, {
        kind: "check_back",
        due_at: app.check_back_at,
        title: title(app, "Check in"),
        body: "Time to check back. Update the stage or snooze if you are still waiting.",
        payload: { offset: "main", stage: app.stage },
      }),
    );
  }

  if (app.next_action_at) {
    let kind: "deadline" | "interview" | "follow_up" = "deadline";
    let label = "Action due";
    if (app.stage === "assessment") label = "Assessment due";
    else if (app.stage === "interview") {
      kind = "interview";
      label = "Interview";
    } else if (app.stage === "offer") {
      kind = "follow_up";
      label = "Respond to offer";
    }

    created.push(
      db.addReminder(userId, app.id, {
        kind,
        due_at: app.next_action_at,
        title: title(app, label),
        body: app.next_action || "Open the application for details.",
        payload: { offset: "main", stage: app.stage },
      }),
    );
    for (const [offsetLabel, dueAt] of reminderOffsets(app.next_action_at)) {
      if (dueAt <= now || dueAt >= app.next_action_at) continue;
      created.push(
        db.addReminder(userId, app.id, {
          kind,
          due_at: dueAt,
          title: title(app, `${label} (${offsetLabel})`),
          body: app.next_action || "",
          payload: { offset: offsetLabel.split(" ")[0], stage: app.stage },
        }),
      );
    }
  }

  db.addEvent(userId, app.id, "reminders_synced", {
    count: created.length,
    check_back_at: app.check_back_at,
    next_action_at: app.next_action_at,
  });
  return created;
}

export function dueItems(db: Database, userId: number, now = nowMs()): NotificationItem[] {
  const applications = new Map(
    db.listApplications(userId, { status: "active", limit: 1000 }).map((app) => [app.id, app]),
  );
  const items: NotificationItem[] = [];
  const covered = new Set<string>();

  for (const app of applications.values()) {
    if (app.check_back_at && app.check_back_at <= now) {
      covered.add(`${app.id}:check_back`);
      items.push({
        kind: "check_back",
        application_id: app.id,
        company: app.company,
        role: app.role,
        stage: app.stage,
        due_at: app.check_back_at,
        title: title(app, "Check in"),
        body: app.next_action || "Time to check back.",
        reminder_id: null,
      });
    }
    if (app.next_action_at && app.next_action_at <= now) {
      for (const kind of ["deadline", "interview", "follow_up"]) covered.add(`${app.id}:${kind}`);
      items.push({
        kind: "action",
        application_id: app.id,
        company: app.company,
        role: app.role,
        stage: app.stage,
        due_at: app.next_action_at,
        title: title(app, app.next_action || "Action due"),
        body: app.next_action || "",
        reminder_id: null,
      });
    }
  }

  for (const reminder of db.listReminders(userId, { pendingOnly: true, dueBefore: now, limit: 1000 })) {
    const app = applications.get(reminder.application_id);
    if (!app) continue;
    const offset = String(reminder.payload.offset || "");
    if (offset === "main" && covered.has(`${reminder.application_id}:${reminder.kind}`)) continue;
    items.push({
      kind: reminder.kind,
      application_id: reminder.application_id,
      company: app.company,
      role: app.role,
      stage: app.stage,
      due_at: reminder.due_at,
      title: reminder.title,
      body: reminder.body,
      reminder_id: reminder.id,
    });
  }

  return items.sort((a, b) => a.due_at - b.due_at);
}

export function upcomingItems(
  db: Database,
  userId: number,
  options: { hours?: number; now?: number } = {},
): NotificationItem[] {
  const now = options.now ?? nowMs();
  const horizon = now + (options.hours ?? 72) * 3_600_000;
  const items: NotificationItem[] = [];
  const seen = new Set<string>();
  for (const app of db.listApplications(userId, { status: "active", limit: 1000 })) {
    const entries: Array<[number | null, string, string]> = [
      [app.check_back_at, "check_back", "Check in"],
      [app.next_action_at, "action", "Action"],
    ];
    for (const [dueAt, kind, label] of entries) {
      if (!dueAt) continue;
      const key = `${app.id}:${dueAt}`;
      if (seen.has(key)) continue;
      if (now < dueAt && dueAt <= horizon) {
        seen.add(key);
        items.push({
          kind,
          application_id: app.id,
          company: app.company,
          role: app.role,
          stage: app.stage,
          due_at: dueAt,
          title: title(app, label),
          body: app.next_action || "",
          reminder_id: null,
        });
      }
    }
  }
  return items.sort((a, b) => a.due_at - b.due_at);
}

export function snoozeApplication(db: Database, userId: number, app: Application, days = 3): Application {
  const safeDays = Math.max(1, Math.min(Math.trunc(days), 90));
  const now = nowMs();
  const base = Math.max(app.check_back_at || now, now);
  const checkBackAt = base + safeDays * MS_PER_DAY;
  const fields: Record<string, unknown> = {
    check_back_at: checkBackAt,
    check_back_source: "snoozed",
  };
  if (app.next_action_at) {
    fields.next_action_at = Math.max(app.next_action_at, now) + safeDays * MS_PER_DAY;
  }
  const updated = db.updateApplication(userId, app.id, fields);
  if (updated) {
    db.addEvent(userId, app.id, "snoozed", { days: safeDays, check_back_at: checkBackAt });
    syncApplicationReminders(db, userId, updated);
  }
  return updated || app;
}

export function markActionDone(db: Database, userId: number, app: Application): Application {
  const updated = db.updateApplication(userId, app.id, {
    action_state: "action_required",
    next_action_at: null,
    next_action: "",
  });
  if (updated) syncApplicationReminders(db, userId, updated);
  return updated || app;
}
