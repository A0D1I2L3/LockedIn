import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  addLocalDays,
  dateInputValue,
  parseDateText,
  parseWhen,
  partsInTimezone,
  zonedTimeToMs,
} from "@/lib/time";

describe("timezone conversion", () => {
  it("converts wall-clock times across DST boundaries", () => {
    const winter = zonedTimeToMs(2026, 1, 15, 9, 0, "America/New_York");
    const summer = zonedTimeToMs(2026, 7, 15, 9, 0, "America/New_York");
    expect(new Date(winter).toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(new Date(summer).toISOString()).toBe("2026-07-15T13:00:00.000Z");
    expect(partsInTimezone(winter, "America/New_York")).toMatchObject({ hour: 9, minute: 0 });
  });

  it("keeps 9am local time when adding days", () => {
    const start = zonedTimeToMs(2026, 3, 7, 9, 0, "America/New_York");
    const next = addLocalDays(start, 2, "America/New_York");
    expect(partsInTimezone(next, "America/New_York")).toMatchObject({
      year: 2026,
      month: 3,
      day: 9,
      hour: 9,
    });
  });

  it("skips weekends when adding business days", () => {
    const friday = zonedTimeToMs(2026, 3, 6, 9, 0, "UTC");
    const monday = addBusinessDays(friday, 1, "UTC");
    expect(dateInputValue(monday, "UTC")).toBe("2026-03-09");
  });
});

describe("date parsing", () => {
  const anchor = zonedTimeToMs(2026, 3, 1, 12, 0, "UTC");

  it("parses named dates with times", () => {
    const parsed = parseDateText("March 3 at 3pm", anchor, "UTC");
    expect(parsed).not.toBeNull();
    expect(partsInTimezone(parsed!, "UTC")).toMatchObject({
      year: 2026,
      month: 3,
      day: 3,
      hour: 15,
      minute: 0,
    });
  });

  it("rolls year-less dates forward when they are far in the past", () => {
    const parsed = parseDateText("January 5", anchor, "UTC");
    expect(partsInTimezone(parsed!, "UTC")).toMatchObject({ year: 2027, month: 1, day: 5 });
  });

  it("accepts ISO dates and epoch values", () => {
    const parsed = parseWhen("2026-04-02", "UTC");
    expect(dateInputValue(parsed, "UTC")).toBe("2026-04-02");
    expect(parseWhen(1_777_777_777_777, "UTC")).toBe(1_777_777_777_777);
  });
});
