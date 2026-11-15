import { z } from "zod";
import { localIsoDate } from "@/lib/parser/dates";
import { STAGES, type Stage } from "@/lib/types";

export type LLMProvider = "openai" | "groq" | "grok" | "claude";

export const PROVIDER_DEFAULTS: Record<LLMProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  grok: { baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  claude: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
};

export const PROVIDERS = Object.keys(PROVIDER_DEFAULTS) as LLMProvider[];

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || ["null", "none", "unknown", "n/a"].includes(text.toLowerCase())) return null;
  return text.slice(0, 160);
}

const STAGE_SYNONYMS: Record<string, Stage> = {
  application: "applied",
  submitted: "applied",
  received: "applied",
  "in review": "applied",
  screening: "applied",
  oa: "assessment",
  "online assessment": "assessment",
  "take home": "assessment",
  "take-home": "assessment",
  challenge: "assessment",
  hackerrank: "assessment",
  codility: "assessment",
  codesignal: "assessment",
  interviewing: "interview",
  "phone screen": "interview",
  "technical interview": "interview",
  "final round": "interview",
  offered: "offer",
  "job offer": "offer",
  accepted: "offer",
  rejection: "rejected",
  declined: "rejected",
  "not selected": "rejected",
  withdrew: "withdrawn",
  cancelled: "withdrawn",
  canceled: "withdrawn",
};

export function normalizeStage(value: unknown): Stage | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  if (STAGES.includes(key as Stage)) return key as Stage;
  return STAGE_SYNONYMS[key] ?? null;
}

const nullableText = z
  .preprocess((value) => (typeof value === "number" ? String(value) : value), z.string().nullable().optional())
  .transform((value) => cleanText(value))
  .catch(null);

const nullableStage = z
  .string()
  .nullable()
  .optional()
  .transform((value) => normalizeStage(value))
  .catch(null);

const nullableDate = z
  .preprocess((value) => (typeof value === "number" ? String(value) : value), z.string().nullable().optional())
  .transform((value) => {
    const text = cleanText(value);
    if (!text) return null;
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
    return iso ? iso[0] : text.slice(0, 40);
  })
  .catch(null);

const nullableDays = z
  .preprocess(
    (value) => (value === null || value === undefined || value === "" ? null : Number(value)),
    z.number().int().min(0).max(365).nullable().optional(),
  )
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
  .catch(null);

const flexibleBoolean = z
  .preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return /^(true|yes|1)$/i.test(value.trim());
    return false;
  }, z.boolean())
  .default(false)
  .catch(false);

const possibleEvidence = z
  .preprocess(
    (value) => (Array.isArray(value) ? value : value ? [value] : []),
    z.array(z.union([z.string(), z.number()]).transform((item) => String(item)).catch("")),
  )
  .default([])
  .catch([]);

const LLMParsedEmailSchema = z.object({
  company: nullableText,
  role: nullableText,
  location: nullableText,
  stage: nullableStage,
  status: nullableStage,
  next_action: nullableText,
  next_action_date: nullableDate,
  check_back_date: nullableDate,
  deadline: nullableDate,
  applied_date: nullableDate,
  response_window_days: nullableDays,
  response_window_business_days: flexibleBoolean,
  confidence: z
    .preprocess(
      (value) => (value === null || value === undefined || value === "" ? 0 : Number(value)),
      z.number().min(0).max(1).catch(0),
    )
    .default(0),
  evidence: possibleEvidence,
});

export type LLMParsedEmail = z.infer<typeof LLMParsedEmailSchema>;

export function providerDefaults(provider: string | null | undefined) {
  return PROVIDER_DEFAULTS[(provider || "openai").toLowerCase() as LLMProvider] ?? PROVIDER_DEFAULTS.openai;
}

export function makeLLMConfig(options: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): LLMConfig {
  const rawProvider = (options.provider || "openai").toLowerCase();
  const provider = (PROVIDERS.includes(rawProvider as LLMProvider) ? rawProvider : "openai") as LLMProvider;
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: (options.baseUrl || defaults.baseUrl).replace(/\/$/, ""),
    apiKey: options.apiKey || "",
    model: options.model || defaults.model,
    timeoutMs: options.timeoutMs ?? 20_000,
  };
}

export function isLLMConfigured(config: LLMConfig | null | undefined): boolean {
  return Boolean(config?.apiKey && config.baseUrl && config.model);
}

export function llmEndpoint(config: LLMConfig): string {
  if (config.provider === "claude") {
    return config.baseUrl.endsWith("/v1")
      ? `${config.baseUrl}/messages`
      : `${config.baseUrl}/v1/messages`;
  }
  return `${config.baseUrl}/chat/completions`;
}

const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "role",
    "location",
    "stage",
    "next_action",
    "next_action_date",
    "check_back_date",
    "deadline",
    "applied_date",
    "response_window_days",
    "response_window_business_days",
    "confidence",
    "evidence",
  ],
  properties: {
    company: {
      type: ["string", "null"],
      description: "Employer name. Use the sender domain when the body does not name it. Never a job board.",
    },
    role: {
      type: ["string", "null"],
      description: "Exact job or internship title from the email.",
    },
    location: {
      type: ["string", "null"],
      description: "Office location or Remote when stated.",
    },
    stage: {
      type: ["string", "null"],
      enum: [...STAGES, null],
      description: "Current candidate category/stage in the application process.",
    },
    next_action: {
      type: ["string", "null"],
      description: "Concise imperative next step for the candidate.",
    },
    next_action_date: {
      type: ["string", "null"],
      description: "Date for the next action or assessment/interview, YYYY-MM-DD.",
    },
    check_back_date: {
      type: ["string", "null"],
      description: "Date to follow up. Explicit date, or Received + response window, or Received + default follow-up days. YYYY-MM-DD.",
    },
    deadline: {
      type: ["string", "null"],
      description: "Explicit deadline stated in the email, YYYY-MM-DD.",
    },
    applied_date: {
      type: ["string", "null"],
      description: "Date the application was submitted or received, YYYY-MM-DD.",
    },
    response_window_days: {
      type: ["integer", "null"],
      description: "Explicit response window converted to calendar days.",
    },
    response_window_business_days: {
      type: "boolean",
      description: "True when the response window is in business days.",
    },
    confidence: {
      type: "number",
      description: "Confidence from 0 to 1 in the extracted fields.",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Short verbatim snippets supporting the extraction.",
    },
  },
} as const;

const SYSTEM_PROMPT = `You are an application-email parser for a job and internship tracker.
Return exactly ONE JSON object and nothing else. No markdown, no code fences, no prose.
Every key must be present. Use null when the email does not state a value.

JSON schema:
{
  "company": string|null,
  "role": string|null,
  "location": string|null,
  "stage": "applied"|"assessment"|"interview"|"offer"|"rejected"|"withdrawn"|null,
  "next_action": string|null,
  "next_action_date": "YYYY-MM-DD"|null,
  "check_back_date": "YYYY-MM-DD"|null,
  "deadline": "YYYY-MM-DD"|null,
  "applied_date": "YYYY-MM-DD"|null,
  "response_window_days": integer|null,
  "response_window_business_days": boolean,
  "confidence": number,
  "evidence": string[]
}

Field rules:
- company: employer named in the email, or the company in the sender domain. Never a job board.
- role: exact job/internship title. Do not include the company name.
- stage: the candidate's current category. Use "applied" for application received/under review, "assessment" for online assessments or take-homes, "interview" for any interview stage, "offer" for a job offer, "rejected" for rejection, "withdrawn" if the candidate withdrew.
- next_action: short imperative step, e.g. "Complete the coding assessment".
- next_action_date: the explicit date for that action, if stated.
- deadline: only an explicit deadline stated in the email.
- applied_date: when the application was submitted or received, if stated.
- response_window_days: convert explicit relative windows ("within 2 weeks" = 14, "5 business days" = 5).
- response_window_business_days: true only when the window is stated in business days.
- check_back_date: the date to follow up if there is no response. Use an explicit follow-up date when given. Otherwise compute from the Received date using the response window, or the default follow-up days when no window is stated.
- All dates must be calendar dates in YYYY-MM-DD in the supplied timezone.
- confidence: 0 to 1. Lower it when key fields are inferred.
- evidence: short verbatim quotes from the email that support the extracted fields.
- Never invent a company, role, date, or outcome. If it is not in the email, use null.`;

function extractJson(raw: string): unknown {
  let text = (raw || "").replace(/^\uFEFF/, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("LLM returned invalid JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function requestParts(config: LLMConfig, userContent: string, useSchema: boolean) {
  if (config.provider === "claude") {
    return {
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      } as Record<string, string>,
      payload: {
        model: config.model,
        max_tokens: 1200,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        ...(useSchema
          ? { output_config: { format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA } } }
          : {}),
      } as Record<string, unknown>,
    };
  }
  return {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
    payload: {
      model: config.model,
      temperature: 0,
      max_tokens: 1200,
      response_format: useSchema
        ? {
            type: "json_schema",
            json_schema: { name: "recruiting_email", strict: true, schema: OUTPUT_JSON_SCHEMA },
          }
        : { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    } as Record<string, unknown>,
  };
}

function responseText(config: LLMConfig, data: Record<string, unknown>): string {
  if (config.provider === "claude") {
    const content = (data.content || []) as Array<{ type?: string; text?: string }>;
    return content.filter((block) => block.type === "text").map((block) => block.text || "").join("");
  }
  const choices = (data.choices || []) as Array<{ message?: { content?: string } }>;
  return choices[0]?.message?.content || "";
}

export async function parseWithLLM(
  text: string,
  options: {
    subject?: string;
    fromEmail?: string;
    receivedAt?: number;
    timezone?: string;
    defaultFollowUpDays?: number;
    config: LLMConfig;
    strict?: boolean;
  },
): Promise<LLMParsedEmail | null> {
  const { config } = options;
  if (!isLLMConfigured(config)) return null;
  const timezone = options.timezone || "UTC";
  const receivedIso = localIsoDate(options.receivedAt ?? Date.now(), timezone);
  const userContent = [
    `Received: ${receivedIso}`,
    `Timezone: ${timezone}`,
    `Default follow-up days: ${options.defaultFollowUpDays ?? 7}`,
    `Subject: ${options.subject || "(none)"}`,
    options.fromEmail ? `From: ${options.fromEmail}` : "",
    "",
    "Body:",
    (text || "").slice(0, 12000),
  ]
    .filter((line) => line !== "")
    .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const post = (useSchema: boolean) => {
    const { headers, payload } = requestParts(config, userContent, useSchema);
    return fetch(llmEndpoint(config), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  };

  try {
    let response = await post(true);
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const detail = await response.text().catch(() => "");
      if (!detail || /schema|response_format|output_config|format|unsupported|unknown/i.test(detail)) {
        response = await post(false);
      } else {
        throw new Error(`provider returned ${response.status}: ${detail.slice(0, 300)}`);
      }
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `provider returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    const raw = responseText(config, data);
    if (!raw.trim()) throw new Error("provider returned an empty response");
    const parsed = LLMParsedEmailSchema.safeParse(extractJson(raw));
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "json"}: ${issue.message}`)
        .join("; ");
      throw new Error(`JSON did not match the expected format (${issues})`);
    }
    return parsed.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`LLM parse failed (${config.provider}):`, message);
    if (options.strict) throw new Error(`AI provider request failed: ${message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
