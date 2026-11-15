import type { Database } from "@/lib/db";
import { dueItems, upcomingItems } from "@/lib/reminders";
import { nowMs } from "@/lib/time";
import type { Application } from "@/lib/types";

function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value: string): string {
  return (value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let remaining = line.slice(75);
  while (remaining) {
    chunks.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join("\r\n");
}

function event(options: {
  uid: string;
  startMs: number;
  summary: string;
  description?: string;
  url?: string;
  alarmMinutes?: number | null;
}): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${options.uid}`,
    `DTSTAMP:${utcStamp(nowMs())}`,
    `DTSTART:${utcStamp(options.startMs)}`,
    `DTEND:${utcStamp(options.startMs + 30 * 60_000)}`,
    `SUMMARY:${escapeIcs(options.summary)}`,
  ];
  if (options.description) lines.push(`DESCRIPTION:${escapeIcs(options.description)}`);
  if (options.url) lines.push(`URL:${escapeIcs(options.url)}`);
  if (options.alarmMinutes !== null && options.alarmMinutes !== undefined) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(options.summary)}`,
      `TRIGGER:-PT${Math.trunc(options.alarmMinutes)}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function applicationEvents(app: Application, baseUrl = ""): string[][] {
  const label = `${app.company || "Application"}${app.role ? ` — ${app.role}` : ""}`;
  const link = baseUrl ? new URL(`?application=${encodeURIComponent(app.id)}`, `${baseUrl}/`).toString() : "";
  const events: string[][] = [];
  if (app.check_back_at) {
    events.push(
      event({
        uid: `checkin-${app.id}@internship-dashboard`,
        startMs: app.check_back_at,
        summary: `Check in: ${label}`,
        description: app.next_action || "Open the tracker and update this application.",
        url: link,
        alarmMinutes: 0,
      }),
    );
  }
  if (app.next_action_at) {
    events.push(
      event({
        uid: `action-${app.id}@internship-dashboard`,
        startMs: app.next_action_at,
        summary: `${app.next_action || "Action due"}: ${label}`,
        description: `Stage: ${app.stage}`,
        url: link,
        alarmMinutes: 60,
      }),
    );
  }
  return events;
}

export function buildCalendar(name: string, eventBlocks: string[][]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Internship Dashboard//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcs(name)}`,
  ];
  for (const block of eventBlocks) lines.push(...block);
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function applicationCalendar(app: Application, baseUrl = ""): string {
  return buildCalendar(`Internship — ${app.company || "Application"}`, applicationEvents(app, baseUrl));
}

export function userCalendar(db: Database, userId: number, baseUrl = ""): string {
  const blocks: string[][] = [];
  for (const app of db.listApplications(userId, { status: "active", limit: 1000 })) {
    blocks.push(...applicationEvents(app, baseUrl));
  }
  return buildCalendar("Internship Dashboard", blocks);
}

export function notificationFeed(db: Database, userId: number, now = nowMs()) {
  return {
    now,
    due: dueItems(db, userId, now),
    upcoming: upcomingItems(db, userId, { hours: 48, now }),
  };
}
