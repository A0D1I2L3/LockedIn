import { z } from "zod";
import { isKnownTimezone } from "@/lib/time";
import { OUTCOMES, STAGES } from "@/lib/types";

const stage = z.enum(STAGES);
const nullableDate = z.union([z.string(), z.number(), z.null()]).optional();
const jobUrl = z
  .string()
  .trim()
  .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), {
    message: "Use a full http(s) URL.",
  });

export const applicationInputSchema = z.object({
  company: z.string().default(""),
  role: z.string().default(""),
  location: z.string().default(""),
  job_url: jobUrl.default(""),
  source: z.string().default(""),
  stage: stage.default("applied"),
  apply_by: nullableDate,
  applied_at: nullableDate,
  check_back_at: nullableDate,
  check_back_source: z.string().default("manual"),
  next_action: z.string().default(""),
  next_action_at: nullableDate,
  notes: z.string().default(""),
});

export const applicationPatchSchema = z.object({
  company: z.string().optional(),
  role: z.string().optional(),
  location: z.string().optional(),
  job_url: jobUrl.optional(),
  source: z.string().optional(),
  stage: stage.optional(),
  status: z.enum(["active", "closed"]).optional(),
  action_state: z.enum(["waiting", "action_required", "follow_up_due", "done"]).optional(),
  next_action: z.string().optional(),
  next_action_at: nullableDate,
  check_back_at: nullableDate,
  check_back_source: z.string().optional(),
  apply_by: nullableDate,
  applied_at: nullableDate,
  notes: z.string().optional(),
});

export const outcomeInputSchema = z.object({
  outcome: z.enum(OUTCOMES),
  note: z.string().default(""),
  stage: stage.optional(),
});

export const snoozeInputSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(3),
});

export const emailInputSchema = z.object({
  raw_text: z.string().max(100_000, "Email text is too large (100,000 characters max).").default(""),
  parser_mode: z.enum(["auto", "rules", "llm"]).optional(),
  subject: z.string().default(""),
  from_email: z.string().default(""),
  received_at: nullableDate,
  company_hint: z.string().default(""),
  role_hint: z.string().default(""),
  stage_hint: z.string().default(""),
  apply: z.boolean().default(false),
});

export const preferencesInputSchema = z.object({
  parser_mode: z.enum(["auto", "rules", "llm"]).optional(),
  default_follow_up_days: z.coerce.number().int().min(1).max(90).optional(),
  timezone: z
    .string()
    .trim()
    .refine((value) => isKnownTimezone(value), { message: "Use a valid IANA timezone." })
    .optional(),
  notifications_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
  digest_enabled: z.boolean().optional(),
  digest_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional(),
  quiet_hours_start: z
    .string()
    .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM or leave blank")
    .optional(),
  quiet_hours_end: z
    .string()
    .regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM or leave blank")
    .optional(),
  reminder_channel: z.enum(["auto", "push", "telegram", "none"]).optional(),
  telegram_chat_id: z.string().trim().max(64).optional(),
  llm_provider: z.string().optional(),
  llm_base_url: z.string().optional(),
  llm_model: z.string().optional(),
  llm_api_key: z.string().optional(),
  llm_api_key_clear: z.boolean().optional(),
});

export const llmTestInputSchema = z.object({
  provider: z.string().optional(),
  base_url: z.string().optional(),
  model: z.string().optional(),
  api_key: z.string().optional(),
});


export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(16).max(512),
    auth: z.string().min(8).max(256),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export const reminderUpdateSchema = z.object({
  channel: z.enum(["auto", "push", "telegram", "none"]).optional(),
});


const prepItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
  done: z.boolean().default(false),
});

export const interviewInputSchema = z.object({
  type: z.string().trim().max(60).default("interview"),
  scheduled_at: nullableDate,
  duration_minutes: z.coerce.number().int().min(5).max(600).default(45),
  link: z.string().trim().max(1000).default(""),
  interviewer: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(4000).default(""),
  prep: z.array(prepItemSchema).max(50).default([]),
  questions: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});

export const interviewPatchSchema = interviewInputSchema.partial();

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).default(""),
  role: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(2000).default(""),
});

export const contactPatchSchema = contactInputSchema.partial();
