import { z } from "zod";
import { STAGES, type Stage } from "@/lib/types";

export type LLMProvider = "openai" | "grok" | "claude";

export const PROVIDER_DEFAULTS: Record<LLMProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
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
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || ["null", "none", "unknown", "n/a"].includes(text.toLowerCase())) return null;
  return text.slice(0, 160);
}

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => cleanText(value));

const LLMParsedEmailSchema = z.object({
  company: nullableText,
  role: nullableText,
  stage: z
    .string()
    .nullable()
    .optional()
    .transform((value) => {
      const normalized = (value || "").trim().toLowerCase();
      return STAGES.includes(normalized as Stage) ? (normalized as Stage) : null;
    }),
  location: nullableText,
  next_action: nullableText,
  deadline: nullableText,
  response_window_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  response_window_business_days: z.boolean().default(false),
  confidence: z.coerce.number().min(0).max(1).default(0),
  evidence: z.array(z.string()).default([]),
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

const SYSTEM_PROMPT = `You extract structured data from recruiting emails.
Return ONLY a JSON object with this schema:
{
  "company": string|null,
  "role": string|null,
  "stage": "applied"|"assessment"|"interview"|"offer"|"rejected"|"withdrawn"|null,
  "location": string|null,
  "next_action": short string|null,
  "deadline": "YYYY-MM-DD"|null,
  "response_window_days": integer|null,
  "response_window_business_days": boolean,
  "confidence": 0.0-1.0,
  "evidence": [short quotes from the email]
}
Rules:
- Use null when the email does not state something. Never guess a company or role.
- deadline is only for an explicit date in the email.
- response_window_days is only for an explicit relative window ("within 2 weeks" = 14).
- stage "rejected" means the candidate was rejected. "offer" means a job offer.
- evidence must be short verbatim snippets supporting the fields.`;

function extractJson(raw: string): unknown {
  let text = (raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("LLM returned invalid JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function requestParts(config: LLMConfig, userContent: string) {
  if (config.provider === "claude") {
    return {
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      } as Record<string, string>,
      payload: {
        model: config.model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    },
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
  options: { subject?: string; config: LLMConfig },
): Promise<LLMParsedEmail | null> {
  const { config } = options;
  if (!isLLMConfigured(config)) return null;
  const userContent = `Subject: ${options.subject || "(none)"}\n\nBody:\n${(text || "").slice(0, 12000)}`;
  const { headers, payload } = requestParts(config, userContent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(llmEndpoint(config), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    const data = (await response.json()) as Record<string, unknown>;
    return LLMParsedEmailSchema.parse(extractJson(responseText(config, data)));
  } catch (error) {
    console.warn(`LLM parse failed (${config.provider}):`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
