import { afterEach, describe, expect, it, vi } from "vitest";
import { extractResponseWindow, parseDate, resolveCheckBack } from "@/lib/parser/dates";
import { makeLLMConfig } from "@/lib/parser/llm";
import { parseEmail } from "@/lib/parser/pipeline";

const ANCHOR = Date.UTC(2026, 10, 1, 12, 0, 0);

afterEach(() => vi.unstubAllGlobals());

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

  it("keeps an application-received email at applied when an assessment is only future work", async () => {
    const draft = await parseEmail(
      "Hi Adil,\n\nWe greatly appreciate your interest in Software Development Engineer " +
        "Intern role at HackerRank. Your application has been received, and we're excited " +
        "to move forward with our selection process.\n\nOur team will carefully review your " +
        "application within 1 week. If you are shortlisted, you will receive a take-home " +
        "assignment as the next step in the process.\n\nIf you do not hear from us within " +
        "this timeframe, it means we are unable to proceed with your application at this " +
        "time. However, we will keep your resume on file and reach out should a future " +
        "opportunity arise that aligns with your skills and interests.\n\nWe invite you to " +
        "stay connected with us on LinkedIn and HackerRank Instagram. Want more insights " +
        'into life at HackerRank? Follow our LifeatHackerRank Instagram page!\n\nAlso, don’t ' +
        'miss "What’s new on HackerRank!"\n\nThank you again for considering HackerRank, and ' +
        "we wish you the best of luck in your application process.\n\nThank you,\n" +
        "HackerRank Talent Team",
      {
        subject: "Your application to HackerRank",
        fromEmail: "no-reply@hackerrank.com",
        receivedAt: ANCHOR,
      },
    );
    expect(draft.stage).toBe("applied");
    expect(draft.company).toBe("HackerRank");
    expect(draft.role).toBe("Software Development Engineer Intern");
    expect(draft.check_back_source).toBe("stated_window");
    const days = (draft.check_back_at! - ANCHOR) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
    expect(draft.action_state).toBe("waiting");
  });

  it("parses a high-volume application confirmation with the default check-back", async () => {
    const draft = await parseEmail(
      "Hello Adil,\n\nThank you for your application for the Software Engineer role and " +
        "for your interest in joining our team.\n\nWe are currently reviewing applications " +
        "and appreciate the time and effort you have taken to apply. Due to the high volume " +
        "of applications, we will be progressing with candidates whose experience and skills " +
        "most closely match the requirements of the role. If your application is shortlisted, " +
        "a member of our team will be in touch.\n\nBest Regards,\nPayPal Global Talent " +
        "Acquisition Team",
      {
        subject: "Thank you for your application",
        fromEmail: "jobs@paypal.com",
        receivedAt: ANCHOR,
      },
    );
    expect(draft.stage).toBe("applied");
    expect(draft.company).toBe("Paypal");
    expect(draft.role).toBe("Software Engineer");
    expect(draft.check_back_source).toBe("default");
    expect(draft.next_action).toBe("Wait for a response");
  });

  it("uses the LLM JSON for every field including the check-back date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  company: "Stripe",
                  role: "Backend Intern",
                  location: "Remote",
                  stage: "interview",
                  next_action: "Schedule the technical interview",
                  next_action_date: "2026-11-18",
                  check_back_date: "2026-11-20",
                  deadline: null,
                  applied_date: "2026-10-30",
                  response_window_days: null,
                  response_window_business_days: false,
                  confidence: 0.9,
                  evidence: ["technical interview"],
                }),
              },
            },
          ],
        }),
      }),
    );

    const draft = await parseEmail(
      "Thanks for applying to PayPal. We would like to invite you to a technical interview.",
      {
        subject: "Interview invitation",
        receivedAt: ANCHOR,
        llmConfig: makeLLMConfig({ provider: "openai", apiKey: "test" }),
        parserMode: "llm",
      },
    );

    expect(draft.parser).toBe("llm");
    expect(draft.company).toBe("Stripe");
    expect(draft.role).toBe("Backend Intern");
    expect(draft.location).toBe("Remote");
    expect(draft.stage).toBe("interview");
    expect(draft.next_action).toBe("Schedule the technical interview");
    expect(draft.check_back_source).toBe("llm");
    expect(draft.check_back_at).toBe(parseDate("2026-11-20", ANCHOR, "UTC"));
    expect(draft.next_action_at).toBe(parseDate("2026-11-18", ANCHOR, "UTC"));
    expect(draft.applied_at).toBe(parseDate("2026-10-30", ANCHOR, "UTC"));
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
