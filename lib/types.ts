export const STAGES = [
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const TERMINAL_STAGES = new Set<Stage>(["rejected", "withdrawn"]);

export type ApplicationStatus = "active" | "closed";
export type ActionState = "waiting" | "action_required" | "follow_up_due" | "done";

export const OUTCOMES = [
  "rejected",
  "offer",
  "assessment",
  "interview",
  "follow_up",
  "no_response",
  "withdrawn",
  "other",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type ReminderKind = "check_back" | "deadline" | "interview" | "follow_up";
export type ReminderStatus = "pending" | "done" | "dismissed" | "cancelled";

export const PARSER_VERSION = "rules-v1";

export interface User {
  id: number;
  google_user_id: string;
  email: string | null;
  created_at: string | null;
}

export interface Application {
  id: string;
  user_id: number;
  company: string;
  role: string;
  location: string;
  job_url: string;
  source: string;
  stage: Stage;
  status: ApplicationStatus;
  action_state: ActionState;
  next_action: string;
  next_action_at: number | null;
  check_back_at: number | null;
  check_back_source: string;
  applied_at: number | null;
  last_contact_at: number | null;
  follow_up_count: number;
  notes: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  is_terminal?: boolean;
}

export interface EmailRow {
  id: string;
  user_id: number;
  application_id: string;
  subject: string;
  from_email: string;
  received_at: number | null;
  raw_text: string;
  parsed: Record<string, unknown>;
  confidence: number;
  parser_version: string;
  created_at: number;
}

export interface Reminder {
  id: string;
  user_id: number;
  application_id: string;
  kind: ReminderKind;
  due_at: number;
  title: string;
  body: string;
  status: ReminderStatus;
  payload: Record<string, unknown>;
  created_at: number;
  completed_at: number | null;
}

export interface TimelineEvent {
  id: string;
  user_id: number;
  application_id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: number;
}

export interface UserPreferences {
  parser_mode: "auto" | "rules" | "llm";
  default_follow_up_days: number;
  timezone: string;
  notifications_enabled: boolean;
  llm_provider: LLMProvider;
  llm_base_url: string;
  llm_model: string;
  llm_api_key_set?: boolean;
}

export type LLMProvider = "openai" | "groq" | "grok" | "claude";

export interface NotificationItem {
  kind: string;
  application_id: string;
  company: string;
  role: string;
  stage: Stage;
  due_at: number;
  title: string;
  body: string;
  reminder_id: string | null;
}

export interface Stats {
  by_stage: Record<Stage, number>;
  total: number;
  active: number;
  due: number;
  upcoming: number;
}

export interface ParsedDraft {
  company: string;
  role: string;
  location: string;
  stage: Stage;
  confidence: number;
  evidence: string[];
  parser: "rules" | "llm" | "hybrid";
  parser_version: string;
  next_action: string;
  action_state: ActionState;
  check_back_at: number | null;
  check_back_source: string;
  next_action_at: number | null;
  applied_at: number | null;
  received_at: number;
  subject: string;
  from_email: string;
  response_window: Record<string, unknown>;
}
