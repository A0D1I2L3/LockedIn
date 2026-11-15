export const MS_PER_DAY = 86_400_000;

export function nowMs(): number {
  return Date.now();
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    }
    formatterCache.set(timezone, formatter);
  }
  return formatter;
}

export function partsInTimezone(ms: number, timezone = "UTC") {
  const parts = formatterFor(timezone).formatToParts(new Date(ms));
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function zonedTimeToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone = "UTC",
): number {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = partsInTimezone(guess, timezone);
    const rendered = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = rendered - guess;
    const next = target - offset;
    if (Math.abs(next - guess) < 1000) return next;
    guess = next;
  }
  return guess;
}

export function startOfLocalDay(ms: number, timezone = "UTC"): number {
  const p = partsInTimezone(ms, timezone);
  return zonedTimeToMs(p.year, p.month, p.day, 9, 0, timezone);
}

export function addLocalDays(ms: number, days: number, timezone = "UTC"): number {
  const p = partsInTimezone(ms, timezone);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedTimeToMs(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    9,
    0,
    timezone,
  );
}

export function addBusinessDays(ms: number, days: number, timezone = "UTC"): number {
  let cursor = ms;
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    cursor = addLocalDays(cursor, 1, timezone);
    const weekday = new Date(cursor).getUTCDay();
    const p = partsInTimezone(cursor, timezone);
    const localWeekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    void weekday;
    if (localWeekday !== 0 && localWeekday !== 6) remaining -= 1;
  }
  return cursor;
}

const HAS_TIME_RE = /\b\d{1,2}:\d{2}\b|\b(?:am|pm|noon|midnight)\b/i;

export function parseDateText(
  raw: string,
  anchorMs = nowMs(),
  timezone = "UTC",
): number | null {
  let text = raw.trim().replace(/^[.,;:]+|[.,;:]+$/g, "");
  if (!text) return null;

  const anchorParts = partsInTimezone(anchorMs, timezone);
  const hasYear = /\b\d{4}\b/.test(text);
  let year = anchorParts.year;
  let month: number | null = null;
  let day: number | null = null;
  let hour = 9;
  let minute = 0;
  let explicitTime = false;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  }

  if (month === null) {
    const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (numeric) {
      month = Number(numeric[1]);
      day = Number(numeric[2]);
      year = Number(numeric[3]);
      if (year < 100) year += 2000;
    }
  }

  if (month === null) {
    const months: Record<string, number> = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
      april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
      august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10,
      oct: 10, november: 11, nov: 11, december: 12, dec: 12,
    };
    const named = text.match(
      /^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
    );
    if (named) {
      const key = named[1].toLowerCase();
      if (!months[key]) return null;
      month = months[key];
      day = Number(named[2]);
      if (named[3]) year = Number(named[3]);
      if (named[4]) {
        explicitTime = true;
        hour = Number(named[4]);
        minute = Number(named[5] || 0);
        const suffix = (named[6] || "").toLowerCase();
        if (suffix === "pm" && hour < 12) hour += 12;
        if (suffix === "am" && hour === 12) hour = 0;
      }
    }
  }

  if (month === null && /\b\d{1,2}:\d{2}\b/.test(text)) {
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return parsed;
  }

  if (month === null || day === null) return null;
  if (!explicitTime && HAS_TIME_RE.test(text)) explicitTime = true;

  let result = zonedTimeToMs(year, month, day, hour, minute, timezone);
  if (!hasYear && result < anchorMs - 30 * MS_PER_DAY) {
    result = zonedTimeToMs(year + 1, month, day, hour, minute, timezone);
  }
  return result;
}

export function dateInputValue(ms: number | null | undefined, timezone = "UTC"): string {
  if (!ms) return "";
  const p = partsInTimezone(ms, timezone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function parseWhen(value: unknown, timezone = "UTC"): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return zonedTimeToMs(year, month, day, 9, 0, timezone);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? parseDateText(raw, nowMs(), timezone) : parsed;
}

export function defaultCheckBack(days: number, timezone = "UTC"): number {
  return addLocalDays(nowMs(), Math.max(1, days), timezone);
}

export function reminderOffsets(dueMs: number): Array<[string, number]> {
  return [
    ["24h before", dueMs - MS_PER_DAY],
    ["1h before", dueMs - 3_600_000],
  ];
}
