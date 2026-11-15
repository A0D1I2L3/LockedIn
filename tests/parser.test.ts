import { describe, expect, it } from "vitest";
import { extractResponseWindow, resolveCheckBack } from "@/lib/parser/dates";
import { parseEmail } from "@/lib/parser/pipeline";

const ANCHOR = Date.UTC(2026, 10, 1, 12, 0, 0);

describe("parser pipeline", () => {
  it("defaults application confirmations to applied with the stated window", async () => {
    const draft = await parseEmail(
      "Thank you for applying to the Software Engineer Intern position at PayPal. " +
        "We will review your application within 2 weeks.",
      { subject: "Application received", receivedAt: ANCHOR },
    );
    expect(draft.stage).toBe("applied");
    expect(draft.company).toBe("PayPal");
    expect(draft.role).toBe("Software Engineer Intern");
    expect(draft.check_back_source).toBe("stated_window");
    expect(draft.check_back_at).not.toBeNull();
  });

  it("rejection wins and clears check-backs", async () => {
    const draft = await parseEmail(
      "We regret to inform you that we will not be moving forward with your " +
        "application for Data Intern at Figma.",
      { receivedAt: ANCHOR },
    );
    expect(draft.stage).toBe("rejected");
    expect(draft.company).toBe("Figma");
    expect(draft.role).toBe("Data Intern");
    expect(draft.check_back_at).toBeNull();
    expect(draft.next_action_at).toBeNull();
    expect(draft.action_state).toBe("waiting");
  });

  it("turns an assessment deadline into the next action", async () => {
    const draft = await parseEmail("Please complete the online assessment by November 20.", {
      receivedAt: ANCHOR,
    });
    expect(draft.stage).toBe("assessment");
    expect(draft.check_back_source).toBe("deadline");
    expect(draft.next_action_at).not.toBeNull();
    expect(draft.next_action.toLowerCase()).toContain("assessment");
  });

  it("reads an explicit offer deadline", async () => {
    const draft = await parseEmail(
      "We are pleased to offer you the Software Intern position at Ramp. " +
        "Please respond by December 1.",
      { receivedAt: ANCHOR },
    );
    expect(draft.stage).toBe("offer");
    expect(draft.company).toBe("Ramp");
    expect(draft.next_action_at).not.toBeNull();
    expect(draft.check_back_at).toBeNull();
  });

  it("returns low confidence for an unknown email", async () => {
    const draft = await parseEmail("Hello, sharing a quick update.", { receivedAt: ANCHOR });
    expect(draft.stage).toBe("applied");
    expect(draft.confidence).toBeLessThan(0.5);
  });

  it("uses the configured default check-back", () => {
    const window = extractResponseWindow("No timeline mentioned.", ANCHOR);
    const resolved = resolveCheckBack(window, ANCHOR, 5);
    expect(resolved.check_back_source).toBe("default");
    const days = (resolved.check_back_at - ANCHOR) / 86_400_000;
    expect(days).toBeGreaterThan(4);
    expect(days).toBeLessThan(6);
  });

  it("takes a company from the sender domain but not from an ATS", async () => {
    const direct = await parseEmail("Your application has been received.", {
      fromEmail: "careers@paypal.com",
      receivedAt: ANCHOR,
    });
    expect(direct.company).toBe("Paypal");
    const ats = await parseEmail("Your application has been received.", {
      fromEmail: "no-reply@greenhouse.io",
      receivedAt: ANCHOR,
    });
    expect(ats.company).toBe("");
  });
});
