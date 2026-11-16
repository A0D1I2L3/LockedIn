import { llmConfigFor, parseWhenFor, userSettings } from "@/lib/api";
import { getConfig } from "@/lib/config";
import type { Database } from "@/lib/db";
import { isLLMConfigured } from "@/lib/parser/llm";
import { parseEmail } from "@/lib/parser/pipeline";
import type { Application, ParsedDraft } from "@/lib/types";
import type { z } from "zod";
import type { emailInputSchema } from "@/lib/schemas";

function normalize(value: string) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(email: string) {
  const at = (email || "").lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase().trim();
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function scoreMatch(draft: ParsedDraft, app: Application) {
  const company = normalize(draft.company);
  const role = normalize(draft.role);
  const appCompany = normalize(app.company);
  const appRole = normalize(app.role);
  let score = 0;
  if (company && appCompany) {
    if (company === appCompany) score += 4;
    else if (company.includes(appCompany) || appCompany.includes(company)) score += 2;
  }
  if (role && appRole) {
    if (role === appRole) score += 3;
    else {
      const words = new Set(role.split(" ").filter((word) => word.length > 2));
      const overlap = appRole.split(" ").filter((word) => words.has(word)).length;
      if (overlap >= 2) score += 1;
    }
  }
  const domain = domainOf(draft.from_email);
  const host = hostOf(app.job_url);
  if (domain && host && (host === domain || host.endsWith(`.${domain}`))) score += 3;
  return score;
}

export function findMatch(db: Database, userId: number, draft: ParsedDraft) {
  const apps = db.listApplications(userId, { status: "active", limit: 500 });
  let best: { app: Application; score: number } | null = null;
  for (const app of apps) {
    const score = scoreMatch(draft, app);
    if (score >= 3 && (!best || score > best.score)) best = { app, score };
  }
  if (!best) return null;
  return {
    id: best.app.id,
    company: best.app.company,
    role: best.app.role,
    stage: best.app.stage,
  };
}

export async function parseForUser(
  db: Database,
  userId: number,
  body: z.infer<typeof emailInputSchema>,
) {
  const prefs = userSettings(db, userId);
  const timezone = prefs.timezone || "UTC";
  const receivedAt = parseWhenFor(body.received_at, timezone) || Date.now();
  const llmConfig = llmConfigFor(db, userId);
  const requestedMode = body.parser_mode || prefs.parser_mode || "auto";
  const parserMode =
    !isLLMConfigured(llmConfig) && requestedMode !== "rules" ? "rules" : requestedMode;
  const started = Date.now();
  try {
    const draft = await parseEmail(body.raw_text, {
      subject: body.subject,
      fromEmail: body.from_email,
      receivedAt,
      timezone,
      defaultFollowUpDays: Number(prefs.default_follow_up_days || 7),
      llmConfig,
      parserMode,
      companyHint: body.company_hint,
      roleHint: body.role_hint,
      stageHint: body.stage_hint,
    });
    draft.matched_application = findMatch(db, userId, draft);
    console.info(
      `[parse] ok user=${userId} mode=${parserMode} parser=${draft.parser} ` +
        `provider=${llmConfig.provider} stage=${draft.stage} ` +
        `confidence=${draft.confidence.toFixed(2)} match=${draft.matched_application?.id || "none"} ` +
        `ms=${Date.now() - started}`,
    );
    return draft;
  } catch (error) {
    console.warn(
      `[parse] failed user=${userId} mode=${parserMode} ` +
        `provider=${llmConfig.provider} ms=${Date.now() - started} ` +
        `error=${error instanceof Error ? error.message : "unknown"}`,
    );
    throw error;
  }
}

export function appBaseUrl(): string {
  return getConfig().baseUrl;
}
