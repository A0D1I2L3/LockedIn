import { llmConfigFor } from "@/lib/api";
import type { Database } from "@/lib/db";
import { generateText, isLLMConfigured } from "@/lib/parser/llm";
import { MS_PER_DAY, nowMs } from "@/lib/time";
import type { Application } from "@/lib/types";

export const FOLLOW_UP_VARIANTS = [
  "follow_up",
  "thank_you",
  "offer_nudge",
  "decline",
] as const;

export type FollowUpVariant = (typeof FOLLOW_UP_VARIANTS)[number];

export interface FollowUpDraft {
  subject: string;
  body: string;
  variant: FollowUpVariant;
  generator: "template" | "llm";
}

export function defaultVariant(app: Application): FollowUpVariant {
  if (app.stage === "offer") return "offer_nudge";
  if (app.stage === "interview") return "thank_you";
  return "follow_up";
}

function daysSince(ms: number | null | undefined, now: number) {
  if (!ms) return 0;
  return Math.max(0, Math.floor((now - ms) / MS_PER_DAY));
}

export function templateFollowUp(
  app: Application,
  variant: FollowUpVariant,
  now = nowMs(),
): FollowUpDraft {
  const company = app.company || "the team";
  const role = app.role || "the role";
  const elapsed = daysSince(app.applied_at || app.last_contact_at, now);
  const deadline = app.apply_by || app.next_action_at;
  const when = deadline
    ? new Date(deadline).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

  if (variant === "thank_you") {
    return {
      variant,
      generator: "template",
      subject: `Thank you — ${role} interview`,
      body: `Hi ${company} team,\n\nThank you for taking the time to speak with me about the ${role} role. I enjoyed learning more about the team and the work. I remain very interested in the opportunity and would be glad to provide anything else you need.\n\nBest regards,\n`,
    };
  }
  if (variant === "offer_nudge") {
    return {
      variant,
      generator: "template",
      subject: `Following up on the ${role} offer`,
      body: `Hi ${company} team,\n\nThank you again for the offer for the ${role} role. I am excited about the opportunity and wanted to check in${when ? ` ahead of the ${when} response deadline` : ""}. Please let me know if you need anything else from me.\n\nBest regards,\n`,
    };
  }
  if (variant === "decline") {
    return {
      variant,
      generator: "template",
      subject: `Regarding the ${role} opportunity`,
      body: `Hi ${company} team,\n\nThank you for the opportunity to be considered for the ${role} role. After careful consideration, I have decided to pursue another opportunity at this time. I appreciate your time and hope our paths cross again.\n\nBest regards,\n`,
    };
  }
  return {
    variant,
    generator: "template",
    subject: `Following up — ${role} application`,
    body: `Hi ${company} team,\n\nI hope you are doing well. I am following up on my application for the ${role} role${
      elapsed ? `, which I submitted about ${elapsed} day${elapsed === 1 ? "" : "s"} ago` : ""
    }. I remain very interested in the position and would appreciate any update on the timeline.\n\nThank you,\n`,
  };
}

const SYSTEM = `You write short, polite follow-up emails for a job applicant.
Return plain text with the first line exactly "Subject: <subject>" and then a blank line and the email body.
Keep it under 130 words. Do not invent facts, deadlines, salaries, or interviewer names.
Use the company and role supplied. End with a simple sign-off and leave the name blank.`;

export async function draftFollowUp(
  db: Database,
  userId: number,
  app: Application,
  variant?: FollowUpVariant,
): Promise<FollowUpDraft> {
  const chosen = variant || defaultVariant(app);
  const fallback = templateFollowUp(app, chosen);
  const config = llmConfigFor(db, userId);
  if (!isLLMConfigured(config)) return fallback;
  try {
    const context = [
      `Variant: ${chosen}`,
      `Company: ${app.company}`,
      `Role: ${app.role}`,
      `Stage: ${app.stage}`,
      `Location: ${app.location || "unspecified"}`,
      `Days since applied: ${daysSince(app.applied_at, nowMs())}`,
      `Days since last contact: ${daysSince(app.last_contact_at, nowMs())}`,
      `Next action: ${app.next_action || "none"}`,
      app.notes ? `Notes (do not quote verbatim): ${app.notes.slice(0, 400)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const raw = await generateText(config, SYSTEM, context);
    if (!raw) return fallback;
    const subjectMatch = raw.match(/^\s*subject:\s*(.+)$/im);
    const body = raw
      .replace(/^\s*subject:\s*.+$/im, "")
      .replace(/^\s*\n/, "")
      .trim();
    if (!body) return fallback;
    return {
      variant: chosen,
      generator: "llm",
      subject: (subjectMatch?.[1] || fallback.subject).slice(0, 160),
      body: body.slice(0, 6000),
    };
  } catch (error) {
    console.warn("[followup] LLM draft failed, using template", error);
    return fallback;
  }
}
