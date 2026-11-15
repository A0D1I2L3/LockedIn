import { ApiError, llmConfigFor, parseWhenFor, userSettings } from "@/lib/api";
import { getConfig } from "@/lib/config";
import type { Database } from "@/lib/db";
import { isLLMConfigured } from "@/lib/parser/llm";
import { parseEmail } from "@/lib/parser/pipeline";
import type { z } from "zod";
import type { emailInputSchema } from "@/lib/schemas";

export async function parseForUser(
  db: Database,
  userId: number,
  body: z.infer<typeof emailInputSchema>,
) {
  const prefs = userSettings(db, userId);
  const timezone = prefs.timezone || "UTC";
  const receivedAt = parseWhenFor(body.received_at, timezone) || Date.now();
  const llmConfig = llmConfigFor(db, userId);
  const parserMode = body.parser_mode || prefs.parser_mode || "llm";
  if (parserMode === "llm" && !isLLMConfigured(llmConfig)) {
    throw new ApiError(400, "Connect an AI provider first.");
  }
  return parseEmail(body.raw_text, {
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
}

export function appBaseUrl(): string {
  return getConfig().baseUrl;
}
