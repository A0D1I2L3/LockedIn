import {
  MS_PER_DAY,
  addBusinessDays,
  addLocalDays,
  nowMs,
  parseDateText,
  partsInTimezone,
  zonedTimeToMs,
} from "@/lib/time";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const DATE_TEXT = `(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}`;
const DATE_RE = new RegExp(DATE_TEXT, "i");

export interface ResponseWindow {
  kind: "explicit_date" | "window" | "default";
  raw: string;
  days: number | null;
  business_days: boolean;
  explicit_date: number | null;
  source: "explicit_date" | "stated_window" | "default";
  ambiguous: boolean;
}

function numberValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  return WORD_NUMBERS[value] ?? null;
}

export function extractResponseWindow(
  text: string,
  anchorMs = nowMs(),
  timezone = "UTC",
): ResponseWindow {
  const compact = (text || "").replace(/\s+/g, " ");
  const lower = compact.toLowerCase();

  const explicitPatterns = [
    new RegExp(`(?:by|no later than|on or before)\\s+(${DATE_TEXT})`, "i"),
    new RegExp(`(?:deadline|due date|due|respond by|apply by|complete by)\\s*[:\\-]?\\s*(${DATE_TEXT})`, "i"),
  ];
  for (const pattern of explicitPatterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const raw = match[1];
    const dateMs = parseDateText(raw, anchorMs, timezone);
    if (dateMs) {
      return {
        kind: "explicit_date",
        raw: match[0],
        days: null,
        business_days: false,
        explicit_date: dateMs,
        source: "explicit_date",
        ambiguous: !/\b\d{4}\b/.test(raw),
      };
    }
  }

  const numberPattern = `(\\d+|${Object.keys(WORD_NUMBERS).join("|")})`;
  const windowPatterns = [
    new RegExp(`(?:within|in|after)\\s+${numberPattern}\\s*(?:-|to)?\\s*${numberPattern}?\\s*(business\\s+)?(days?|weeks?|months?)`, "i"),
    new RegExp(`(?:review|process|take|takes|taking|typically|usually)[^.\\n]{0,40}?${numberPattern}\\s*(?:-|to)?\\s*${numberPattern}?\\s*(business\\s+)?(days?|weeks?|months?)`, "i"),
    new RegExp(`(?:check back|follow up|reach out|contact you|hear from us)[^.\\n]{0,50}?(?:within|in|after)\\s+${numberPattern}\\s*(?:-|to)?\\s*${numberPattern}?\\s*(business\\s+)?(days?|weeks?|months?)`, "i"),
  ];
  for (const pattern of windowPatterns) {
    const match = lower.match(pattern);
    if (!match) continue;
    const first = numberValue(match[1]);
    const second = numberValue(match[2]);
    const count = second || first;
    if (!count) continue;
    const unit = match[4].toLowerCase();
    const business = Boolean(match[3]) || match[0].includes("business");
    const days = unit.startsWith("week")
      ? count * 7
      : unit.startsWith("month")
        ? count * 30
        : count;
    return {
      kind: "window",
      raw: compact.slice(match.index, (match.index || 0) + match[0].length),
      days,
      business_days: business,
      explicit_date: null,
      source: "stated_window",
      ambiguous: false,
    };
  }

  return {
    kind: "default",
    raw: "",
    days: null,
    business_days: false,
    explicit_date: null,
    source: "default",
    ambiguous: true,
  };
}

export function resolveCheckBack(
  window: ResponseWindow,
  anchorMs = nowMs(),
  defaultDays = 7,
  timezone = "UTC",
): { check_back_at: number; check_back_source: string } {
  if (window.explicit_date) {
    return { check_back_at: window.explicit_date, check_back_source: "explicit_date" };
  }
  if (window.days) {
    const target = window.business_days
      ? addBusinessDays(anchorMs, window.days, timezone)
      : addLocalDays(anchorMs, window.days, timezone);
    return { check_back_at: target, check_back_source: "stated_window" };
  }
  return {
    check_back_at: addLocalDays(anchorMs, Math.max(1, defaultDays), timezone),
    check_back_source: "default",
  };
}

export function extractDateCandidates(text: string): string[] {
  return Array.from((text || "").matchAll(new RegExp(DATE_TEXT, "gi"))).map((match) => match[0]);
}

export function parseDate(raw: string, anchorMs = nowMs(), timezone = "UTC"): number | null {
  return parseDateText(raw, anchorMs, timezone);
}

export function extractEventDate(
  text: string,
  options: {
    anchorMs?: number;
    timezone?: string;
    keywords?: string[];
  } = {},
): number | null {
  const anchorMs = options.anchorMs ?? nowMs();
  const timezone = options.timezone || "UTC";
  const keywords = options.keywords ?? ["interview", "assessment", "deadline", "due"];
  for (const sentence of (text || "").split(/(?<=[.!?])\s+|\n+/)) {
    const lower = sentence.toLowerCase();
    if (!keywords.some((word) => lower.includes(word))) continue;
    const match = sentence.match(DATE_RE);
    if (!match) continue;
    const parsed = parseDateText(match[0], anchorMs, timezone);
    if (parsed) return parsed;
  }
  return null;
}

export function daysBetween(startMs: number | null, endMs: number | null): number {
  if (!startMs || !endMs) return 0;
  return Math.trunc((endMs - startMs) / MS_PER_DAY);
}

export function localIsoDate(ms: number, timezone = "UTC"): string {
  const p = partsInTimezone(ms, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localDateToMs(
  year: number,
  month: number,
  day: number,
  timezone = "UTC",
): number {
  return zonedTimeToMs(year, month, day, 9, 0, timezone);
}
