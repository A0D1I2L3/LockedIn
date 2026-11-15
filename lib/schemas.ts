import { z } from "zod";
import { OUTCOMES, STAGES } from "@/lib/types";

const stage = z.enum(STAGES);
const nullableDate = z.union([z.string(), z.number(), z.null()]).optional();

export const applicationInputSchema = z.object({
  company: z.string().default(""),
  role: z.string().default(""),
  location: z.string().default(""),
  job_url: z.string().default(""),
  source: z.string().default(""),
  stage: stage.default("applied"),
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
  job_url: z.string().optional(),
  source: z.string().optional(),
  stage: stage.optional(),
  status: z.enum(["active", "closed"]).optional(),
  action_state: z.enum(["waiting", "action_required", "follow_up_due", "done"]).optional(),
  next_action: z.string().optional(),
  next_action_at: nullableDate,
  check_back_at: nullableDate,
  check_back_source: z.string().optional(),
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
  raw_text: z.string().default(""),
  subject: z.string().default(""),
  from_email: z.string().default(""),
  received_at: nullableDate,
  company_hint: z.string().default(""),
  role_hint: z.string().default(""),
  stage_hint: z.string().default(""),
  apply: z.boolean().default(false),
});

export const preferencesInputSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  parser_mode: z.enum(["auto", "rules", "llm"]).optional(),
  default_follow_up_days: z.coerce.number().int().min(1).max(90).optional(),
  timezone: z.string().optional(),
  notifications_enabled: z.boolean().optional(),
  llm_provider: z.string().optional(),
  llm_base_url: z.string().optional(),
  llm_model: z.string().optional(),
  llm_api_key: z.string().optional(),
});
