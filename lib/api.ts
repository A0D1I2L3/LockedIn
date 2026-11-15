import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { SESSION_COOKIE, validateSession } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb, type Database } from "@/lib/db";
import { makeLLMConfig, providerDefaults, PROVIDERS, type LLMConfig } from "@/lib/parser/llm";
import { secretStore } from "@/lib/secrets";
import { defaultCheckBack, nowMs, parseWhen } from "@/lib/time";
import {
  STAGES,
  TERMINAL_STAGES,
  type Application,
  type Stage,
  type UserPreferences,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}

export function requireUser(req: NextRequest): { db: Database; userId: number } {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const userId = validateSession(token);
  if (userId === null) throw new ApiError(401, "Not signed in");
  const db = getDb();
  if (!db.getUser(userId)) throw new ApiError(401, "Session is no longer valid");
  return { db, userId };
}

export function optionalUserId(req: NextRequest): number | null {
  return validateSession(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function readBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request body");
  }
  return parsed.data;
}

export function userSettings(db: Database, userId: number): UserPreferences {
  const config = getConfig();
  return {
    parser_mode: "llm",
    default_follow_up_days: config.defaultFollowUpDays,
    timezone: config.appTimezone,
    notifications_enabled: true,
    llm_provider: (config.llmProvider as UserPreferences["llm_provider"]) || "openai",
    llm_base_url: "",
    llm_model: "",
    ...(db.getUserSettings(userId) as Partial<UserPreferences>),
  };
}

export function llmConfigFor(db: Database, userId: number): LLMConfig {
  const config = getConfig();
  const prefs = userSettings(db, userId);
  const provider = (prefs.llm_provider || config.llmProvider || "openai").toLowerCase();
  const defaults = providerDefaults(provider);
  const envMatches = config.llmProvider === provider;
  const apiKey = secretStore.get(`llm_api_key_${userId}`) || config.llmApiKey;
  return makeLLMConfig({
    provider,
    baseUrl:
      prefs.llm_base_url ||
      (envMatches ? config.llmBaseUrl : "") ||
      defaults.baseUrl,
    apiKey,
    model:
      prefs.llm_model ||
      (envMatches ? config.llmModel : "") ||
      defaults.model,
    timeoutMs: config.llmTimeoutSeconds * 1000,
  });
}

export function validateStage(stage: string | null | undefined): Stage | null {
  if (!stage) return null;
  if (!STAGES.includes(stage as Stage)) throw new ApiError(400, `Unknown stage: ${stage}`);
  return stage as Stage;
}

export function applyStageSideEffects(
  fields: Record<string, unknown>,
  current: Application,
): Record<string, unknown> {
  const stage = fields.stage as Stage | undefined;
  if (stage && TERMINAL_STAGES.has(stage)) {
    fields.status ??= "closed";
    fields.closed_at ??= nowMs();
    fields.check_back_at ??= null;
    fields.next_action_at ??= null;
    fields.action_state = "waiting";
    if (!fields.next_action) fields.next_action = "No action needed";
  } else if (stage && current.status === "closed") {
    fields.status ??= "active";
    fields.closed_at ??= null;
  }
  return fields;
}

export function serializeApplication(app: Application) {
  return { ...app, is_terminal: TERMINAL_STAGES.has(app.stage) };
}

export function appendNote(existing: string | null | undefined, note: string): string {
  const clean = (note || "").trim();
  if (!clean) return existing || "";
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp}] ${clean}`;
  return existing ? `${existing}\n${line}` : line;
}

export function defaultCheckBackFor(days: number, timezone: string): number {
  return defaultCheckBack(days, timezone);
}

export function parseWhenFor(value: unknown, timezone: string): number | null {
  return parseWhen(value, timezone);
}

export function isProvider(value: string): boolean {
  return PROVIDERS.includes(value as (typeof PROVIDERS)[number]);
}

export const llmProviderDefaults = providerDefaults;
