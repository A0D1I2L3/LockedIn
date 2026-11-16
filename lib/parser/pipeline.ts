import {
  PARSER_VERSION,
  type ActionState,
  type ParsedDraft,
  type Stage,
} from "@/lib/types";
import { nowMs } from "@/lib/time";
import * as rules from "@/lib/parser/rules";
import {
  extractEventDate,
  extractResponseWindow,
  parseDate,
  resolveCheckBack,
  type ResponseWindow,
} from "@/lib/parser/dates";
import {
  isLLMConfigured,
  parseWithLLM,
  type LLMConfig,
  type LLMParsedEmail,
} from "@/lib/parser/llm";

const TERMINAL = new Set<Stage>(["rejected", "withdrawn"]);

export function extractLocation(text: string): string {
  const match = (text || "").match(
    /(?:location|based in|office in|work location)\s*[:\-]?\s*([A-Z][A-Za-z .'-]{1,60}(?:,\s*[A-Z]{2})?)/,
  );
  if (match) return match[1].replace(/^[\s.,-]+|[\s.,-]+$/g, "").slice(0, 80);
  if (/\bremote\b/i.test(text || "")) return "Remote";
  return "";
}

export interface ParseEmailOptions {
  subject?: string;
  fromEmail?: string;
  receivedAt?: number;
  timezone?: string;
  defaultFollowUpDays?: number;
  llmConfig?: LLMConfig | null;
  parserMode?: "auto" | "rules" | "llm";
  companyHint?: string;
  roleHint?: string;
  stageHint?: string;
}

export async function parseEmail(raw: string, options: ParseEmailOptions = {}): Promise<ParsedDraft> {
  const body = raw || "";
  const anchorMs = options.receivedAt || nowMs();
  const timezone = options.timezone || "UTC";
  const defaultFollowUpDays = options.defaultFollowUpDays ?? 7;
  const headers = rules.extractHeaders(body);
  const subject = (options.subject || headers.subject || "").trim();
  const fromEmail = (options.fromEmail || headers.from_email || "").trim();

  const stageResult = rules.classifyStage(body, subject);
  let stage = options.stageHint ? rules.normalizeStage(options.stageHint) : stageResult.stage;
  let confidence = stageResult.confidence;
  const evidence = stageResult.evidence ? [stageResult.evidence] : [];
  let parser: ParsedDraft["parser"] = "rules";

  let company = rules.extractCompany(body, { fromEmail, subject });
  let role = rules.extractRole(body, { subject });
  let location = extractLocation(body);
  let nextAction: { next_action: string; action_state: ActionState } =
    rules.extractNextAction(stage, body);

  let llmData: LLMParsedEmail | null = null;
  const mode = options.parserMode || "llm";
  const shouldTryLLM =
    Boolean(options.llmConfig) &&
    isLLMConfigured(options.llmConfig) &&
    (mode === "llm" || mode === "auto") &&
    (mode === "llm" || confidence < 0.65);
  if (shouldTryLLM) {
    llmData = await parseWithLLM(body, {
      subject,
      fromEmail,
      receivedAt: anchorMs,
      timezone,
      defaultFollowUpDays,
      config: options.llmConfig!,
      strict: mode === "llm",
    });
  }

  const llmDate = (value: string | null | undefined) =>
    value ? parseDate(value, anchorMs, timezone) : null;
  const llmStage = llmData?.stage ?? llmData?.status ?? null;
  const llmNextActionAt = llmDate(llmData?.next_action_date);
  const llmCheckBackAt = llmDate(llmData?.check_back_date);
  const llmDeadlineAt = llmDate(llmData?.deadline);
  const llmAppliedAt = llmDate(llmData?.applied_date);

  if (llmData) {
    let usedLLM = false;
    if (llmData.company && !options.companyHint) {
      company = llmData.company;
      usedLLM = true;
    }
    if (llmData.role && !options.roleHint) {
      role = llmData.role;
      usedLLM = true;
    }
    if (llmData.location) {
      location = llmData.location;
      usedLLM = true;
    }
    if (llmStage && !options.stageHint) {
      stage = llmStage;
      usedLLM = true;
    }
    if (llmData.next_action) {
      nextAction = { next_action: llmData.next_action, action_state: "action_required" };
      usedLLM = true;
    }
    confidence = Math.max(confidence, llmData.confidence || 0);
    if (llmData.evidence.length) evidence.push(...llmData.evidence.map(String));
    if (usedLLM || mode === "llm") parser = "llm";
  }

  company = (options.companyHint || "").trim() || company;
  role = (options.roleHint || "").trim() || role;
  if (options.stageHint) {
    stage = rules.normalizeStage(options.stageHint);
    nextAction = rules.extractNextAction(stage, body);
  }

  let window: ResponseWindow = extractResponseWindow(body, anchorMs, timezone);
  if (llmData?.response_window_days) {
    window = {
      kind: "window",
      raw: "llm",
      days: llmData.response_window_days,
      business_days: Boolean(llmData.response_window_business_days),
      explicit_date: null,
      source: "stated_window",
      ambiguous: false,
    };
  }
  const resolved = resolveCheckBack(window, anchorMs, defaultFollowUpDays, timezone);

  const eventDate = extractEventDate(body, {
    anchorMs,
    timezone,
    keywords: ["interview", "assessment", "deadline", "due", "complete by", "submit by", "respond by"],
  });
  const explicitDeadline = llmDeadlineAt || llmNextActionAt || eventDate;
  let nextActionAt: number | null = null;
  let checkBackAt: number | null = llmCheckBackAt ?? resolved.check_back_at;
  let checkBackSource = llmCheckBackAt ? "llm" : resolved.check_back_source;

  if (TERMINAL.has(stage)) {
    checkBackAt = null;
    checkBackSource = "none";
    nextActionAt = null;
    nextAction = { next_action: "No action needed", action_state: "waiting" };
  } else if (stage === "assessment" || stage === "interview") {
    nextActionAt = llmNextActionAt || explicitDeadline;
    if (!llmCheckBackAt) {
      checkBackAt = explicitDeadline || anchorMs + 2 * 86_400_000;
      checkBackSource = explicitDeadline ? "deadline" : "stage_default";
    }
    if (!nextAction.next_action) nextAction = rules.extractNextAction(stage, body);
  } else if (stage === "offer") {
    nextActionAt = llmNextActionAt || llmDeadlineAt || anchorMs + 3 * 86_400_000;
    if (!llmCheckBackAt) {
      checkBackAt = null;
      checkBackSource = "none";
    }
  } else if (!llmCheckBackAt && llmDeadlineAt && window.kind === "default") {
    checkBackAt = llmDeadlineAt;
    checkBackSource = "explicit_date";
  }

  if (!nextAction.next_action) {
    nextAction = { next_action: "Wait for a response", action_state: "waiting" };
  }

  return {
    company: company.trim().slice(0, 120),
    role: role.trim().slice(0, 120),
    location: location.trim().slice(0, 120),
    stage,
    confidence: Math.round(confidence * 100) / 100,
    evidence: Array.from(new Set(evidence.filter(Boolean))).slice(0, 8),
    parser,
    parser_version: PARSER_VERSION,
    next_action: nextAction.next_action,
    action_state: nextAction.action_state,
    check_back_at: checkBackAt ? Math.trunc(checkBackAt) : null,
    check_back_source: checkBackSource,
    next_action_at: nextActionAt ? Math.trunc(nextActionAt) : null,
    apply_by: null,
    applied_at: llmAppliedAt ? Math.trunc(llmAppliedAt) : null,
    received_at: anchorMs,
    subject: subject.slice(0, 300),
    from_email: fromEmail.slice(0, 200),
    response_window: window as unknown as Record<string, unknown>,
    field_confidence: {
      company: company ? confidence : 0,
      role: role ? confidence : 0,
      stage: stageResult.confidence,
      location: location ? Math.min(confidence, 0.7) : 0,
      next_action: nextAction.next_action ? Math.min(confidence, 0.8) : 0,
      dates:
        checkBackAt || nextActionAt || llmAppliedAt
          ? Math.min(confidence, 0.75)
          : 0,
    },
  };
}
