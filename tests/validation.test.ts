import { describe, expect, it } from "vitest";
import { isKnownTimezone, normalizeTimezone } from "@/lib/time";
import { validateLlmBaseUrl } from "@/lib/network";
import { applicationInputSchema, preferencesInputSchema } from "@/lib/schemas";

describe("timezone validation", () => {
  it("normalizes aliases and rejects unknown zones", () => {
    expect(normalizeTimezone("IST")).toBe("Asia/Kolkata");
    expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimezone("Mars/Olympus")).toBe("UTC");
    expect(isKnownTimezone("IST")).toBe(true);
    expect(isKnownTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("job url validation", () => {
  it("allows empty and http(s) urls only", () => {
    expect(applicationInputSchema.safeParse({ job_url: "" }).success).toBe(true);
    expect(applicationInputSchema.safeParse({ job_url: "https://example.com/job" }).success).toBe(true);
    expect(applicationInputSchema.safeParse({ job_url: "javascript:alert(1)" }).success).toBe(false);
    expect(applicationInputSchema.safeParse({ job_url: "example.com/job" }).success).toBe(false);
  });
});

describe("settings validation", () => {
  it("accepts aliases but rejects invalid timezones", () => {
    expect(preferencesInputSchema.safeParse({ timezone: "IST" }).success).toBe(true);
    expect(preferencesInputSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("llm base url safety", () => {
  it("rejects non-http schemes and metadata hosts", async () => {
    await expect(validateLlmBaseUrl("javascript:alert(1)")).rejects.toThrow();
    await expect(validateLlmBaseUrl("https://metadata.google.internal/v1")).rejects.toThrow();
    await expect(validateLlmBaseUrl("https://user:pass@example.com/v1")).rejects.toThrow();
    await expect(validateLlmBaseUrl("https://8.8.8.8/v1")).resolves.toBe("https://8.8.8.8/v1");
  });
});
