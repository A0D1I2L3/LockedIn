import type { ActionState, Stage } from "@/lib/types";

const ATS_DOMAINS = new Set([
  "greenhouse.io", "lever.co", "workday.com", "myworkdayjobs.com", "icims.com",
  "smartrecruiters.com", "linkedin.com", "indeed.com", "hackerrank.com",
  "hackerrankforwork.com", "codesignal.com", "codility.com", "unstop.com",
  "handshake.com", "joinhandshake.com", "wellfound.com", "angel.co", "glassdoor.com",
]);

const REJECTION = [
  "unfortunately", "not moving forward", "will not be moving forward", "not selected",
  "regret to inform", "will not be proceeding", "decided not to move forward",
  "not successful", "position has been filled", "no longer under consideration",
  "not proceed with your application", "wish you the best in your future",
  "wish you all the best in your future", "best of luck in your future endeavors",
  "move forward with other candidates", "decided to move forward with other",
];
const WITHDRAWN = ["withdraw", "withdrawn", "withdrawing your application"];
const OFFER = [
  "offer letter", "pleased to offer", "excited to offer", "happy to offer",
  "verbal offer", "formal offer", "offer of employment", "we would like to offer",
  "accepted for the position",
];
const ASSESSMENT = [
  "coding test", "online assessment", "take-home", "take home",
  "technical assessment", "technical test", "assessment",
  "challenge link", "coding challenge", "online test", "oa link",
];

const ASSESSMENT_DEFERRED = [
  "if shortlisted", "if you are shortlisted", "if selected", "will receive",
  "will be sent", "will send", "we will send", "next step", "may receive",
  "might receive", "could receive", "no action", "not required",
];

const ASSESSMENT_ACTIONABLE = [
  "complete", "start", "take the", "finish", "submit", "begin", "link",
  "invited", "due", "deadline", "please", "access",
];
const INTERVIEW = [
  "interview", "phone screen", "recruiter screen", "schedule a call", "schedule a time",
  "schedule your", "availability", "calendly", "hiring manager", "zoom", "google meet",
  "teams meeting", "next round",
];
const APPLIED = [
  "thank you for applying", "thanks for applying", "application received",
  "application has been received", "application was received", "application has been submitted",
  "we received your application", "received your application", "successfully applied",
  "your application was submitted", "application confirmation", "we have your application",
  "we have received your application", "your application for",
];

function find(text: string, phrases: string[]): string | null {
  for (const phrase of phrases) if (text.includes(phrase)) return phrase;
  return null;
}

function findAssessment(text: string): string | null {
  const phrase = find(text, ASSESSMENT);
  if (!phrase) return null;
  const index = text.indexOf(phrase);
  const context = text.slice(Math.max(0, index - 140), index + phrase.length + 80);
  const deferred = ASSESSMENT_DEFERRED.some((marker) => context.includes(marker));
  const actionable = ASSESSMENT_ACTIONABLE.some((marker) => context.includes(marker));
  if (deferred && !actionable) return null;
  return phrase;
}

export function classifyStage(text: string, subject = "") {
  const haystack = `${subject.toLowerCase()}\n${(text || "").toLowerCase()}`;
  const rejection = find(haystack, REJECTION);
  if (rejection) return { stage: "rejected" as Stage, confidence: 0.98, evidence: rejection };
  const withdrawn = find(haystack, WITHDRAWN);
  if (withdrawn) return { stage: "withdrawn" as Stage, confidence: 0.95, evidence: withdrawn };
  const offer = find(haystack, OFFER);
  if (offer) return { stage: "offer" as Stage, confidence: 0.97, evidence: offer };
  const assessment = findAssessment(haystack);
  if (assessment) return { stage: "assessment" as Stage, confidence: 0.92, evidence: assessment };
  const interview = find(haystack, INTERVIEW);
  if (interview) return { stage: "interview" as Stage, confidence: 0.88, evidence: interview };
  const applied = find(haystack, APPLIED);
  if (applied) return { stage: "applied" as Stage, confidence: 0.92, evidence: applied };
  return { stage: "applied" as Stage, confidence: 0.3, evidence: "" };
}

export function extractHeaders(raw: string): { subject: string; from_email: string } {
  let subject = "";
  let from_email = "";
  const subjectMatch = (raw || "").match(/^\s*Subject:\s*(.+)$/im);
  if (subjectMatch) subject = subjectMatch[1].trim();
  const fromMatch = (raw || "").match(/^\s*From:\s*(.+)$/im);
  if (fromMatch) {
    const emailMatch = fromMatch[1].match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) from_email = emailMatch[0].toLowerCase();
  }
  return { subject, from_email };
}

export function humanizeDomain(domain: string): string {
  const root = domain.toLowerCase().split(".")[0].replace(/[-_]/g, " ");
  return root.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function cleanCompany(value: string): string {
  const first = value.split(
    /\s+(?:has|have|was|is|for|to|regarding|about|team|careers|and|with|position|role|opening|internship)\b|[.,!;\n]/i,
  )[0];
  return first.replace(/\s+/g, " ").replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, "").slice(0, 80);
}

export function extractCompany(text: string, options: { fromEmail?: string; subject?: string } = {}): string {
  const haystack = `${options.subject || ""}\n${text || ""}`;
  const patterns = [
    /(?:thank you|thanks) for applying (?:to|for) (?:the\s+)?[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})/,
    /application (?:to|at)\s+([A-Z][^.\n,]{1,70})/,
    /application (?:for|as)\s+[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})/,
    /applied (?:to|at)\s+([A-Z][^.\n,]{1,70})/,
    /applied (?:for|as)\s+[^.\n,]{1,80}?\s+(?:at|with)\s+([A-Z][^.\n,]{1,70})/,
    /(?:position|role|opening|opportunity) (?:at|with)\s+([A-Z][^.\n,]{1,70})/,
    /(?:joining|join) (?:the\s+)?([A-Z][^.\n,]{1,70}?)\s+(?:team|as)\b/,
    /from\s+([A-Z][^.\n,]{1,70}?)\s+(?:team|recruiting|talent)\b/,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) {
      const company = cleanCompany(match[1]);
      if (company) return company;
    }
  }
  if (options.fromEmail?.includes("@")) {
    const domain = options.fromEmail.split("@").pop() || "";
    if (domain && !ATS_DOMAINS.has(domain)) {
      const company = humanizeDomain(domain);
      if (company) return company;
    }
  }
  return "";
}

function cleanRole(value: string): string {
  const first = value.split(/\s+(?:at|with|position|role|has|was|is|and|for)|[,.\n]/i)[0];
  return first
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .slice(0, 100);
}

export function extractRole(text: string, options: { subject?: string } = {}): string {
  const haystack = `${options.subject || ""}\n${text || ""}`;
  const patterns = [
    /(?:interest in|applying for|applied for|application for)\s+(?:the\s+)?([A-Z][^.\n,]{2,90}?)\s+(?:role|position|internship|opening|opportunity)\b/,
    /(?:application|applied|candidacy)\s+(?:for|to|as)\s+(?:the\s+)?([A-Z][^.\n,]{2,90}?)(?=\s+(?:at|with|position|role|has|was|is|and|,|\.|\n)|$)/,
    /(?:the|a|an)\s+([A-Z][\w /&+.\-]{2,70}?)\s+(?:position|role|internship|opening)\b/,
    /(?:position|role|opening)\s+(?:of|for)\s+([A-Z][^.\n,]{2,80})/,
    /(?:subject|role)\s*[:\-]\s*([^\n]{2,80})/,
  ];
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) {
      const role = cleanRole(match[1]);
      if (role) return role;
    }
  }
  return "";
}

export function extractNextAction(
  stage: Stage,
  text: string,
): { next_action: string; action_state: ActionState } {
  const body = (text || "").toLowerCase();
  if (stage === "rejected" || stage === "withdrawn") {
    return { next_action: "No action needed", action_state: "waiting" };
  }
  if (stage === "offer") return { next_action: "Review the offer", action_state: "action_required" };
  if (stage === "assessment") return { next_action: "Complete the assessment", action_state: "action_required" };
  if (stage === "interview") {
    if (body.includes("availability") || body.includes("schedule") || body.includes("calendly")) {
      return { next_action: "Reply with availability", action_state: "action_required" };
    }
    return { next_action: "Prepare for the interview", action_state: "action_required" };
  }
  if (["complete", "submit", "schedule", "reply", "availability", "confirm", "send"].some((word) => body.includes(word))) {
    return { next_action: "Follow the instructions in the email", action_state: "action_required" };
  }
  return { next_action: "Wait for a response", action_state: "waiting" };
}

export function normalizeStage(value: string): Stage {
  const aliases: Record<string, Stage> = {
    application: "applied", applied: "applied", submitted: "applied",
    oa: "assessment", coding_test: "assessment", test: "assessment",
    interviewing: "interview", accepted: "offer", offer: "offer",
    rejection: "rejected", rejected: "rejected", other: "applied",
  };
  const normalized = (value || "").trim().toLowerCase();
  if (["saved", "applied", "assessment", "interview", "offer", "rejected", "withdrawn"].includes(normalized)) {
    return normalized as Stage;
  }
  return aliases[normalized] || "applied";
}
