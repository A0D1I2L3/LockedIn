import { getConfig } from "@/lib/config";
import type { Database } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { dueItems, upcomingItems } from "@/lib/reminders";
import { MS_PER_DAY, nowMs, partsInTimezone } from "@/lib/time";
import type { NotificationItem, Reminder, UserPreferences } from "@/lib/types";

export function inQuietHours(prefs: UserPreferences, now = nowMs()): boolean {
  const start = prefs.quiet_hours_start;
  const end = prefs.quiet_hours_end;
  if (!start || !end || start === end) return false;
  const parts = partsInTimezone(now, prefs.timezone || "UTC");
  const current = parts.hour * 60 + parts.minute;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const from = startHour * 60 + startMinute;
  const to = endHour * 60 + endMinute;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

function resolveChannel(
  prefs: UserPreferences,
  reminder: Reminder,
  hasPush: boolean,
): "push" | "telegram" | "none" {
  const channel = reminder.channel !== "auto" ? reminder.channel : prefs.reminder_channel;
  if (channel === "none") return "none";
  if (channel === "push") return hasPush ? "push" : prefs.telegram_chat_id ? "telegram" : "none";
  if (channel === "telegram") return prefs.telegram_chat_id ? "telegram" : hasPush ? "push" : "none";
  return hasPush ? "push" : prefs.telegram_chat_id ? "telegram" : "none";
}

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = getConfig().telegramBotToken;
  if (!token || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendDigestEmail(to: string, subject: string, text: string): Promise<boolean> {
  const config = getConfig();
  if (!config.resendApiKey || !to) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.digestFrom,
        to: [to],
        subject,
        text,
        html: `<div style="font-family:system-ui,sans-serif;line-height:1.6;white-space:pre-wrap">${text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</div>`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function digestText(items: NotificationItem[]) {
  const lines = items.slice(0, 10).map((item) => {
    const company = item.company || "Application";
    return `• ${company}${item.role ? ` — ${item.role}` : ""}: ${item.title}`;
  });
  return lines.join("\n");
}

export interface SweepResult {
  reminders: number;
  digests: number;
  skippedQuiet: number;
}

export async function runNotificationSweep(
  db: Database,
  options: { now?: number; ignoreQuiet?: boolean; userId?: number } = {},
): Promise<SweepResult> {
  const now = options.now ?? nowMs();
  const result: SweepResult = { reminders: 0, digests: 0, skippedQuiet: 0 };
  const userIds = options.userId ? [options.userId] : db.listUserIds();

  for (const userId of userIds) {
    const prefs = db.getUserSettings(userId) as Partial<UserPreferences>;
    if (prefs.notifications_enabled === false) continue;
    const settings: UserPreferences = {
      parser_mode: "auto",
      default_follow_up_days: 7,
      timezone: "UTC",
      notifications_enabled: true,
      push_enabled: true,
      digest_enabled: true,
      digest_time: "08:00",
      quiet_hours_start: "",
      quiet_hours_end: "",
      reminder_channel: "auto",
      telegram_chat_id: "",
      llm_provider: "openai",
      llm_base_url: "",
      llm_model: "",
      ...prefs,
    };
    const quiet = !options.ignoreQuiet && inQuietHours(settings, now);
    const subscriptions =
      settings.push_enabled === false ? [] : db.listPushSubscriptions(userId);
    const hasPush = subscriptions.length > 0;

    if (!quiet) {
      const reminders = db.listReminders(userId, {
        pendingOnly: true,
        dueBefore: now,
        limit: 100,
      });
      for (const reminder of reminders) {
        if (reminder.due_at < now - 12 * 3_600_000) continue;
        const key = `reminder:${reminder.id}`;
        if (db.wasDelivered(key)) continue;
        const channel = resolveChannel(settings, reminder, hasPush);
        if (channel === "none") continue;
        let sent = false;
        if (channel === "push") {
          sent = (await sendPushToUser(db, userId, {
            title: reminder.title,
            body: reminder.body,
            url: "/app",
            tag: reminder.id,
          })) > 0;
        } else if (channel === "telegram") {
          sent = await sendTelegram(
            settings.telegram_chat_id,
            `${reminder.title}\n${reminder.body}`,
          );
        }
        if (sent) {
          db.markDelivered(userId, key, channel);
          result.reminders += 1;
        }
      }

      if (settings.digest_enabled) {
        const parts = partsInTimezone(now, settings.timezone || "UTC");
        const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
          parts.day,
        ).padStart(2, "0")}`;
        const digestKey = `digest:${userId}:${dateKey}`;
        const [digestHour, digestMinute] = (settings.digest_time || "08:00")
          .split(":")
          .map(Number);
        const currentMinutes = parts.hour * 60 + parts.minute;
        if (currentMinutes >= digestHour * 60 + digestMinute && !db.wasDelivered(digestKey)) {
          const due = dueItems(db, userId, now);
          const soon = upcomingItems(db, userId, { now, hours: 24 });
          const items = [...due, ...soon];
          if (items.length === 0) {
            db.markDelivered(userId, digestKey, "none");
          } else {
            const user = db.getUser(userId);
            const subject = `${items.length} thing${items.length === 1 ? "" : "s"} today`;
            const text = `Your LockedIn digest\n\n${digestText(items)}\n\nOpen the dashboard: ${
              getConfig().baseUrl
            }/app`;
            let channel = "none";
            if (settings.digest_enabled && user?.email && (await sendDigestEmail(user.email, subject, text))) {
              channel = "email";
            } else if (hasPush) {
              const sent = await sendPushToUser(db, userId, {
                title: subject,
                body: items
                  .slice(0, 2)
                  .map((item) => item.company || item.title)
                  .join(" · "),
                url: "/app",
                tag: digestKey,
              });
              if (sent > 0) channel = "push";
            } else if (settings.telegram_chat_id) {
              if (await sendTelegram(settings.telegram_chat_id, text)) channel = "telegram";
            }
            if (channel !== "none") {
              db.markDelivered(userId, digestKey, channel);
              result.digests += 1;
            }
          }
        }
      }
    } else {
      result.skippedQuiet += 1;
    }
  }
  return result;
}

let lastSweep = 0;

export async function maybeSweep(db: Database, now = nowMs()) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  try {
    await runNotificationSweep(db, { now });
  } catch (error) {
    console.error("[notify] sweep failed", error);
  }
}

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_WEEK = 7 * MS_PER_DAY;
