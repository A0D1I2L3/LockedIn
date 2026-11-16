import type { Application, Stage } from "@/lib/types";
import { stageMeta } from "@/components/ui";

export function columnMeta(stage: string) {
  return stageMeta(stage as Stage);
}

export function isOverdue(app: Application) {
  const now = Date.now();
  return (
    app.status === "active" &&
    ((app.check_back_at !== null && app.check_back_at <= now) ||
      (app.next_action_at !== null && app.next_action_at <= now))
  );
}

export function urgencyTime(app: Application) {
  return Math.min(app.next_action_at ?? Infinity, app.check_back_at ?? Infinity);
}

export function compareUrgency(a: Application, b: Application) {
  return (
    Number(isOverdue(b)) - Number(isOverdue(a)) ||
    urgencyTime(a) - urgencyTime(b) ||
    b.updated_at - a.updated_at
  );
}

export function dateKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export interface AgendaItem {
  app: Application;
  dueAt: number;
  kind: "check_back" | "next_action";
}

const DAY_MS = 86_400_000;

export function agendaBuckets(applications: Application[], now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const dayEnd = startMs + DAY_MS;
  const weekEnd = startMs + 7 * DAY_MS;
  const overdue: AgendaItem[] = [];
  const today: AgendaItem[] = [];
  const week: AgendaItem[] = [];

  for (const app of applications) {
    if (app.status !== "active") continue;
    const candidates: AgendaItem[] = [];
    if (app.check_back_at !== null) {
      candidates.push({ app, dueAt: app.check_back_at, kind: "check_back" });
    }
    if (app.next_action_at !== null) {
      candidates.push({ app, dueAt: app.next_action_at, kind: "next_action" });
    }
    if (candidates.length === 0) continue;
    const item = candidates.reduce((earliest, candidate) =>
      candidate.dueAt < earliest.dueAt ? candidate : earliest,
    );
    if (item.dueAt < startMs) overdue.push(item);
    else if (item.dueAt < dayEnd) today.push(item);
    else if (item.dueAt < weekEnd) week.push(item);
  }

  for (const bucket of [overdue, today, week]) bucket.sort((a, b) => a.dueAt - b.dueAt);
  return { overdue, today, week };
}


export function splitEmailThread(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const marker =
    /\n(?=(?:-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}|From:\s[^\n]{1,200}\n(?:Sent|Date|To|Subject):|On .{10,160}\bwrote:))/gi;
  const parts = text
    .split(marker)
    .map((part) =>
      part
        .replace(/^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\n?/i, "")
        .trim(),
    )
    .filter((part) => part.replace(/\s/g, "").length >= 24);
  return parts.length > 1 ? parts : [text];
}
