"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  STAGES,
  STAGE_LABELS,
  type Application,
  type Contact,
  type EmailRow,
  type Interview,
  type ParsedDraft,
  type TimelineEvent,
} from "@/lib/types";
import {
  CompanyAvatar,
  EmptyState,
  EventIcon,
  Icon,
  Modal,
  SpinnerLabel,
  StageBadge,
  fmtDate,
  fmtDateTime,
  relative,
  safeHttpUrl,
  stageMeta,
} from "@/components/ui";

const inputClass =
  "w-full rounded-lg border border-surface-border bg-surface-container-lowest px-3 py-2 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary";

const OUTCOME_BUTTONS = [
  { value: "follow_up", label: "Followed up", icon: "forward_to_inbox" },
  { value: "no_response", label: "No response", icon: "hourglass_empty" },
  { value: "assessment", label: "Assessment", icon: "assignment" },
  { value: "interview", label: "Interview", icon: "video_call" },
  { value: "offer", label: "Offer", icon: "workspace_premium" },
  { value: "rejected", label: "Rejected", icon: "block" },
  { value: "withdrawn", label: "Withdrawn", icon: "undo" },
  { value: "other", label: "Other", icon: "more_horiz" },
];

function googleCalendarHref(app: Application) {
  const start = app.next_action_at || app.check_back_at || app.apply_by;
  if (!start) return "";
  const stamp = (ms: number) =>
    new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const title = `${app.next_action || (app.apply_by && !app.applied_at ? "Apply" : "Follow up")}: ${
    app.company || "Application"
  }${app.role ? ` — ${app.role}` : ""}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stamp(start)}/${stamp(start + 3_600_000)}`,
    details: `Stage: ${app.stage}${app.next_action ? `\n${app.next_action}` : ""}`,
    location: app.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function DetailModal({
  applicationId,
  onClose,
  onChanged,
  onEdit,
  onEmailDeleted,
  notify,
  refreshToken = 0,
}: {
  applicationId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (application: Application) => void;
  onEmailDeleted?: (email: EmailRow, trashId: string) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  refreshToken?: number;
}) {
  const [application, setApplication] = useState<Application | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpVariant, setFollowUpVariant] = useState("follow_up");
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUp, setFollowUp] = useState<{ subject: string; body: string; generator: string } | null>(
    null,
  );
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [interviewType, setInterviewType] = useState("technical");
  const [interviewWhen, setInterviewWhen] = useState("");
  const [interviewLink, setInterviewLink] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [interviewPrep, setInterviewPrep] = useState("");
  const [interviewQuestions, setInterviewQuestions] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [prepInputs, setPrepInputs] = useState<Record<string, string>>({});
  const [questionInputs, setQuestionInputs] = useState<Record<string, string>>({});
  const [peopleBusy, setPeopleBusy] = useState("");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [rawText, setRawText] = useState("");
  const [subject, setSubject] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [emailPanel, setEmailPanel] = useState(false);
  const [pendingApply, setPendingApply] = useState<ParsedDraft | null>(null);
  const [error, setError] = useState("");
  const notifyRef = useRef(notify);
  const onCloseRef = useRef(onClose);
  const applicationIdRef = useRef(applicationId);
  notifyRef.current = notify;
  onCloseRef.current = onClose;
  applicationIdRef.current = applicationId;

  const load = useCallback(async () => {
    const id = applicationId;
    if (!id) return;
    setLoading(true);
    try {
      const [app, timeline, people] = await Promise.all([
        api<Application>(`/api/applications/${id}`),
        api<{ events: TimelineEvent[]; emails: EmailRow[] }>(`/api/applications/${id}/timeline`),
        api<{ interviews: Interview[]; contacts: Contact[] }>(
          `/api/applications/${id}/people`,
        ),
      ]);
      if (applicationIdRef.current !== id) return;
      setApplication(app);
      setEvents(timeline.events || []);
      setEmails(timeline.emails || []);
      setInterviews(people.interviews || []);
      setContacts(people.contacts || []);
    } catch (loadError) {
      notifyRef.current(
        loadError instanceof Error ? loadError.message : "Could not load application.",
        "error",
      );
      onCloseRef.current();
    } finally {
      if (applicationIdRef.current === id) setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) {
      setApplication(null);
      setEvents([]);
      setEmails([]);
      setInterviews([]);
      setContacts([]);
      return;
    }
    setEmailPanel(false);
    setPendingApply(null);
    setRawText("");
    setSubject("");
    setFromEmail("");
    setError("");
    void load();
  }, [applicationId, load]);

  const refreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (refreshTokenRef.current === refreshToken) return;
    refreshTokenRef.current = refreshToken;
    if (applicationId) void load();
  }, [applicationId, refreshToken, load]);

  if (!applicationId) return null;
  const meta = application ? stageMeta(application.stage) : null;
  const jobUrl = safeHttpUrl(application?.job_url);
  const previewChanges =
    application && pendingApply
      ? [
          {
            label: "Stage",
            from: stageMeta(application.stage).label,
            to: stageMeta(pendingApply.stage).label,
          },
          {
            label: "Next action",
            from: application.next_action || "—",
            to: pendingApply.next_action || "—",
          },
          {
            label: "Next action due",
            from: fmtDate(application.next_action_at),
            to: fmtDate(pendingApply.next_action_at),
          },
          {
            label: "Check back",
            from: fmtDate(application.check_back_at),
            to: fmtDate(pendingApply.check_back_at),
          },
          {
            label: "Location",
            from: application.location || "—",
            to: pendingApply.location || application.location || "—",
          },
        ].filter((change) => change.from !== change.to)
      : [];
  const timeline = [
    ...events.map((event) => ({ kind: "event" as const, id: `e-${event.id}`, at: event.created_at, event })),
    ...emails.map((email) => ({ kind: "email" as const, id: `m-${email.id}`, at: email.created_at, email })),
  ].sort((a, b) => b.at - a.at);

  async function changeStage(stage: string) {
    if (!application) return;
    setBusy(stage);
    setError("");
    try {
      const updated = await api<Application>(`/api/applications/${application.id}`, {
        method: "PATCH",
        body: { stage },
      });
      setApplication(updated);
      notify("Stage updated", "success");
      await load();
      onChanged();
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "Could not update stage.");
    } finally {
      setBusy("");
    }
  }

  async function logOutcome(outcome: string) {
    if (!application) return;
    setBusy(outcome);
    setError("");
    try {
      const updated = await api<Application>(`/api/applications/${application.id}/outcome`, {
        method: "POST",
        body: { outcome },
      });
      setApplication(updated);
      notify(`Logged outcome: ${outcome.replace("_", " ")}`, "success");
      await load();
      onChanged();
    } catch (outcomeError) {
      setError(outcomeError instanceof Error ? outcomeError.message : "Could not log outcome.");
    } finally {
      setBusy("");
    }
  }

  async function snooze(days: number) {
    if (!application) return;
    setBusy(`snooze-${days}`);
    try {
      const updated = await api<Application>(`/api/applications/${application.id}/snooze`, {
        method: "POST",
        body: { days },
      });
      setApplication(updated);
      notify(`Snoozed ${days} day${days === 1 ? "" : "s"}`, "success");
      await load();
      onChanged();
    } catch (snoozeError) {
      setError(snoozeError instanceof Error ? snoozeError.message : "Could not snooze.");
    } finally {
      setBusy("");
    }
  }

  async function addEmail(previewApply: boolean) {
    if (!application || !rawText.trim()) {
      setError("Paste the email text first.");
      return;
    }
    setBusy(previewApply ? "email-apply" : "email");
    setError("");
    try {
      const result = await api<{ draft?: ParsedDraft; duplicate?: boolean }>(
        `/api/applications/${application.id}/emails`,
        {
          method: "POST",
          body: {
            raw_text: rawText,
            subject,
            from_email: fromEmail,
            apply: false,
          },
        },
      );
      setRawText("");
      setSubject("");
      setFromEmail("");
      setEmailPanel(false);
      if (result.duplicate) {
        notify("This email is already logged.", "error");
      } else if (previewApply && result.draft) {
        setPendingApply(result.draft);
        notify("Review the proposed changes before applying.", "success");
      } else {
        notify("Email logged", "success");
      }
      await load();
      onChanged();
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Could not log the email.");
    } finally {
      setBusy("");
    }
  }

  async function deleteEmail(email: EmailRow) {
    if (!application) return;
    if (!window.confirm("Delete this logged email? You can undo right after.")) return;
    setBusy(`email-delete-${email.id}`);
    setError("");
    try {
      const result = await api<{ trash_id?: string }>(
        `/api/applications/${application.id}/emails/${email.id}`,
        { method: "DELETE" },
      );
      if (result.trash_id && onEmailDeleted) {
        onEmailDeleted(email, result.trash_id);
      } else {
        notify("Email deleted", "success");
      }
      await load();
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the email.");
    } finally {
      setBusy("");
    }
  }

  async function applyPending() {
    if (!application || !pendingApply) return;
    setBusy("apply");
    setError("");
    try {
      const updated = await api<Application>(`/api/applications/${application.id}`, {
        method: "PATCH",
        body: {
          company: pendingApply.company || application.company,
          role: pendingApply.role || application.role,
          location: pendingApply.location || application.location,
          stage: pendingApply.stage,
          action_state: pendingApply.action_state,
          next_action: pendingApply.next_action,
          check_back_at: pendingApply.check_back_at,
          check_back_source: pendingApply.check_back_source,
          next_action_at: pendingApply.next_action_at,
        },
      });
      setApplication(updated);
      setPendingApply(null);
      notify("Email applied to the application", "success");
      await load();
      onChanged();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Could not apply the changes.");
    } finally {
      setBusy("");
    }
  }

  async function generateFollowUp(variant = followUpVariant) {
    if (!application) return;
    setFollowUpBusy(true);
    setFollowUpVariant(variant);
    try {
      const draft = await api<{ subject: string; body: string; generator: string }>(
        `/api/applications/${application.id}/draft-followup`,
        { method: "POST", body: { variant } },
      );
      setFollowUp(draft);
      setFollowUpOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not draft a follow-up.", "error");
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function copyFollowUp() {
    if (!followUp) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${followUp.subject}\n\n${followUp.body}`);
      notify("Draft copied", "success");
    } catch {
      notify("Could not copy the draft.", "error");
    }
  }

  function mailFollowUp() {
    if (!followUp) return;
    const params = new URLSearchParams({ subject: followUp.subject, body: followUp.body });
    window.location.href = `mailto:?${params.toString()}`;
  }

  function splitLines(value: string) {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function saveInterview() {
    if (!application) return;
    setPeopleBusy("interview");
    try {
      await api(`/api/applications/${application.id}/interviews`, {
        method: "POST",
        body: {
          type: interviewType,
          scheduled_at: interviewWhen ? new Date(interviewWhen).getTime() : null,
          link: interviewLink,
          interviewer,
          notes: interviewNotes,
          prep: splitLines(interviewPrep).map((label) => ({
            id: crypto.randomUUID().replaceAll("-", ""),
            label,
            done: false,
          })),
          questions: splitLines(interviewQuestions),
        },
      });
      setInterviewOpen(false);
      setInterviewWhen("");
      setInterviewLink("");
      setInterviewer("");
      setInterviewNotes("");
      setInterviewPrep("");
      setInterviewQuestions("");
      await load();
      notify("Interview added", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add the interview.", "error");
    } finally {
      setPeopleBusy("");
    }
  }

  async function updateInterview(interview: Interview, patch: Record<string, unknown>) {
    if (!application) return;
    setPeopleBusy(interview.id);
    try {
      await api(`/api/applications/${application.id}/interviews/${interview.id}`, {
        method: "PATCH",
        body: patch,
      });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update the interview.", "error");
    } finally {
      setPeopleBusy("");
    }
  }

  async function addPrepItem(interview: Interview) {
    const label = (prepInputs[interview.id] || "").trim();
    if (!label) return;
    await updateInterview(interview, {
      prep: [
        ...interview.prep,
        { id: crypto.randomUUID().replaceAll("-", ""), label, done: false },
      ],
    });
    setPrepInputs((values) => ({ ...values, [interview.id]: "" }));
  }

  async function addQuestion(interview: Interview) {
    const question = (questionInputs[interview.id] || "").trim();
    if (!question) return;
    await updateInterview(interview, { questions: [...interview.questions, question] });
    setQuestionInputs((values) => ({ ...values, [interview.id]: "" }));
  }

  async function saveContact() {
    if (!application || !contactName.trim()) return;
    setPeopleBusy("contact");
    try {
      await api(`/api/applications/${application.id}/contacts`, {
        method: "POST",
        body: { name: contactName, email: contactEmail, role: contactRole },
      });
      setContactOpen(false);
      setContactName("");
      setContactEmail("");
      setContactRole("");
      await load();
      notify("Contact added", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add the contact.", "error");
    } finally {
      setPeopleBusy("");
    }
  }

  async function removePerson(kind: "interviews" | "contacts", personId: string) {
    if (!application) return;
    setPeopleBusy(personId);
    try {
      await api(`/api/applications/${application.id}/${kind}/${personId}`, {
        method: "DELETE",
      });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not remove it.", "error");
    } finally {
      setPeopleBusy("");
    }
  }

  return (
    <Modal open={Boolean(applicationId)} onClose={onClose} className="max-w-3xl rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
      <div className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between border-b border-surface-border px-5 py-4">
          <div className="flex items-center gap-3">
            {application && <CompanyAvatar company={application.company} stage={application.stage} />}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-text-primary">
                  {application?.company || "Application"}
                </h2>
                {application && <StageBadge stage={application.stage} />}
              </div>
              <p className="text-xs text-text-secondary">{application?.role || (loading ? "Loading…" : "")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-tertiary hover:bg-surface-container-high hover:text-text-primary">
            <Icon name="close" />
          </button>
        </div>

        <div className="overflow-y-auto">
          {loading && !application ? (
            <div className="p-10 text-center text-sm text-text-secondary">Loading…</div>
          ) : (
            <div className="space-y-5 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Apply by</p>
                  <p className="mt-1 text-xs font-medium text-stage-saved">
                    {application?.apply_by ? `${fmtDate(application.apply_by)} · ${relative(application.apply_by)}` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] text-text-tertiary">Deadline reminder</p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Next action</p>
                  <p className="mt-1 text-xs font-medium text-text-primary">{application?.next_action || "None"}</p>
                  <p className={`mt-1 text-[10px] ${application?.action_state === "action_required" ? "text-signal-warning" : "text-text-tertiary"}`}>
                    {application?.next_action_at ? `${fmtDate(application.next_action_at)} · ${relative(application.next_action_at)}` : "No date"}
                  </p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Check back</p>
                  <p className={`mt-1 text-xs font-medium ${meta?.text || ""}`}>
                    {application?.check_back_at ? `${fmtDate(application.check_back_at)} · ${relative(application.check_back_at)}` : "—"}
                  </p>
                  <p className="mt-1 text-[10px] text-text-tertiary">{application?.check_back_source || "none"}</p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Applied</p>
                  <p className="mt-1 text-xs font-medium text-text-primary">{fmtDate(application?.applied_at)}</p>
                  <p className="mt-1 text-[10px] text-text-tertiary">{application?.follow_up_count || 0} follow-ups</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={application?.stage || "applied"}
                  onChange={(event) => changeStage(event.target.value)}
                  disabled={Boolean(busy) || !application}
                  className="rounded-lg border border-surface-border bg-surface-container-lowest px-2.5 py-1.5 text-xs text-text-primary outline-none"
                >
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => application && onEdit(application)}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high"
                >
                  <Icon name="edit" className="text-[13px]" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => void generateFollowUp()}
                  disabled={followUpBusy || !application}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan/40 bg-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-cyan hover:bg-cyan/20 disabled:opacity-50"
                >
                  <Icon name="edit_note" className="text-[13px]" />
                  {followUpBusy ? "Drafting…" : "Draft follow-up"}
                </button>
                <div className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-text-secondary">
                  <Icon name="snooze" className="text-[13px]" />
                  {[1, 3, 7].map((days) => (
                    <button key={days} type="button" onClick={() => snooze(days)} disabled={Boolean(busy)} className="rounded px-1.5 py-0.5 hover:bg-surface-container-high disabled:opacity-50">
                      {busy === `snooze-${days}` ? "…" : `+${days}d`}
                    </button>
                  ))}
                </div>
                {application && (
                  <a
                    href={`/api/applications/${application.id}/calendar.ics`}
                    className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high"
                  >
                    <Icon name="calendar_month" className="text-[13px]" /> ICS
                  </a>
                )}
                {application && googleCalendarHref(application) && (
                  <a
                    href={googleCalendarHref(application)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high"
                  >
                    <Icon name="event" className="text-[13px]" /> Google
                  </a>
                )}
                {jobUrl && (
                  <a href={jobUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high">
                    <Icon name="open_in_new" className="text-[13px]" /> Job post
                  </a>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-surface-border bg-surface-container-low p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                      Interviews ({interviews.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => setInterviewOpen((value) => !value)}
                      className="text-[10.5px] font-semibold text-cyan hover:brightness-110"
                    >
                      {interviewOpen ? "Cancel" : "+ Add interview"}
                    </button>
                  </div>
                  {interviewOpen && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-container-lowest p-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={interviewType}
                          onChange={(event) => setInterviewType(event.target.value)}
                          aria-label="Interview type"
                          className={inputClass}
                        >
                          <option value="phone">Phone screen</option>
                          <option value="technical">Technical</option>
                          <option value="behavioral">Behavioral</option>
                          <option value="final">Final round</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          type="datetime-local"
                          value={interviewWhen}
                          onChange={(event) => setInterviewWhen(event.target.value)}
                          aria-label="Interview date and time"
                          className={inputClass}
                        />
                      </div>
                      <input
                        value={interviewer}
                        onChange={(event) => setInterviewer(event.target.value)}
                        placeholder="Interviewer"
                        className={inputClass}
                      />
                      <input
                        value={interviewLink}
                        onChange={(event) => setInterviewLink(event.target.value)}
                        placeholder="Meeting link (https://…)"
                        className={inputClass}
                      />
                      <textarea
                        value={interviewPrep}
                        onChange={(event) => setInterviewPrep(event.target.value)}
                        placeholder="Prep checklist — one item per line"
                        className={`${inputClass} min-h-[54px]`}
                      />
                      <textarea
                        value={interviewQuestions}
                        onChange={(event) => setInterviewQuestions(event.target.value)}
                        placeholder="Questions asked — one per line"
                        className={`${inputClass} min-h-[48px]`}
                      />
                      <button
                        type="button"
                        onClick={() => void saveInterview()}
                        disabled={peopleBusy === "interview"}
                        className="rounded-lg bg-cyan px-3 py-1.5 text-[11.5px] font-semibold text-on-primary-container disabled:opacity-50"
                      >
                        {peopleBusy === "interview" ? "Saving…" : "Save interview"}
                      </button>
                    </div>
                  )}
                  <div className="mt-2 flex flex-col gap-2">
                    {interviews.map((interview) => (
                      <div key={interview.id} className="rounded-lg border border-surface-border/70 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11.5px] font-semibold capitalize text-text-primary">
                              {interview.type} · {interview.duration_minutes}m
                            </p>
                            <p className="text-[10px] text-text-tertiary">
                              {interview.scheduled_at ? fmtDateTime(interview.scheduled_at) : "No time yet"}
                              {interview.interviewer ? ` · ${interview.interviewer}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removePerson("interviews", interview.id)}
                            disabled={peopleBusy === interview.id}
                            className="text-[10px] text-text-tertiary hover:text-error disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                        {interview.link && safeHttpUrl(interview.link) && (
                          <a
                            href={safeHttpUrl(interview.link)!}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[10px] font-medium text-cyan hover:underline"
                          >
                            Join meeting
                          </a>
                        )}
                        {interview.notes && (
                          <p className="mt-1 whitespace-pre-wrap text-[10px] text-text-secondary">
                            {interview.notes}
                          </p>
                        )}
                        {interview.prep.length > 0 && (
                          <div className="mt-2 flex flex-col gap-1">
                            {interview.prep.map((item) => (
                              <label key={item.id} className="flex items-center gap-1.5 text-[10px] text-text-secondary">
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  onChange={() =>
                                    void updateInterview(interview, {
                                      prep: interview.prep.map((entry) =>
                                        entry.id === item.id ? { ...entry, done: !entry.done } : entry,
                                      ),
                                    })
                                  }
                                  className="h-3 w-3 accent-[#5a8bb8]"
                                />
                                <span className={item.done ? "line-through opacity-60" : ""}>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                        <div className="mt-1.5 flex gap-1.5">
                          <input
                            value={prepInputs[interview.id] || ""}
                            onChange={(event) =>
                              setPrepInputs((values) => ({ ...values, [interview.id]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void addPrepItem(interview);
                              }
                            }}
                            placeholder="Add prep item"
                            className="min-w-0 flex-1 rounded border border-surface-border bg-surface-container-lowest px-2 py-1 text-[10px] text-text-primary outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void addPrepItem(interview)}
                            className="rounded border border-surface-border px-1.5 text-[10px] text-text-secondary hover:text-text-primary"
                          >
                            +
                          </button>
                        </div>
                        {interview.questions.length > 0 && (
                          <ul className="mt-2 list-disc pl-4 text-[10px] text-text-secondary">
                            {interview.questions.map((question) => (
                              <li key={question}>{question}</li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-1.5 flex gap-1.5">
                          <input
                            value={questionInputs[interview.id] || ""}
                            onChange={(event) =>
                              setQuestionInputs((values) => ({ ...values, [interview.id]: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void addQuestion(interview);
                              }
                            }}
                            placeholder="Question I was asked"
                            className="min-w-0 flex-1 rounded border border-surface-border bg-surface-container-lowest px-2 py-1 text-[10px] text-text-primary outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void addQuestion(interview)}
                            className="rounded border border-surface-border px-1.5 text-[10px] text-text-secondary hover:text-text-primary"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-surface-border bg-surface-container-low p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                      Contacts ({contacts.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => setContactOpen((value) => !value)}
                      className="text-[10.5px] font-semibold text-cyan hover:brightness-110"
                    >
                      {contactOpen ? "Cancel" : "+ Add contact"}
                    </button>
                  </div>
                  {contactOpen && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-container-lowest p-2.5">
                      <input
                        value={contactName}
                        onChange={(event) => setContactName(event.target.value)}
                        placeholder="Name"
                        className={inputClass}
                      />
                      <input
                        value={contactEmail}
                        onChange={(event) => setContactEmail(event.target.value)}
                        placeholder="Email"
                        type="email"
                        className={inputClass}
                      />
                      <input
                        value={contactRole}
                        onChange={(event) => setContactRole(event.target.value)}
                        placeholder="Role or team"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => void saveContact()}
                        disabled={peopleBusy === "contact" || !contactName.trim()}
                        className="rounded-lg bg-cyan px-3 py-1.5 text-[11.5px] font-semibold text-on-primary-container disabled:opacity-50"
                      >
                        {peopleBusy === "contact" ? "Saving…" : "Save contact"}
                      </button>
                    </div>
                  )}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {contacts.map((contact) => (
                      <div key={contact.id} className="flex items-start justify-between gap-2 rounded-lg border border-surface-border/70 px-2.5 py-2">
                        <div>
                          <p className="text-[11.5px] font-semibold text-text-primary">{contact.name}</p>
                          <p className="text-[10px] text-text-tertiary">
                            {[contact.role, contact.email].filter(Boolean).join(" · ") || "No details"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {contact.email && (
                            <a
                              href={`mailto:${contact.email}`}
                              className="text-[10px] text-cyan hover:underline"
                            >
                              Email
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => void removePerson("contacts", contact.id)}
                            disabled={peopleBusy === contact.id}
                            className="text-[10px] text-text-tertiary hover:text-error disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div>
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Log an outcome</p>
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOME_BUTTONS.map((button) => (
                    <button
                      key={button.value}
                      type="button"
                      onClick={() => logOutcome(button.value)}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-container-low px-2.5 py-1.5 text-[10px] text-text-secondary transition hover:border-primary/40 hover:text-text-primary disabled:opacity-50"
                    >
                      <Icon name={button.icon} className="text-[12.5px]" />
                      {busy === button.value ? "…" : button.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-surface-border bg-surface-container-low">
                <button type="button" onClick={() => setEmailPanel((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                  <Icon name="mail" className="text-[16px] text-primary" />
                  <span className="flex-1 text-xs font-semibold text-text-primary">Paste a new email</span>
                  <Icon name={emailPanel ? "expand_less" : "expand_more"} className="text-[16px] text-text-tertiary" />
                </button>
                {emailPanel && (
                  <div className="space-y-2 border-t border-surface-border px-3 py-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject (optional)" className={inputClass} />
                      <input value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} placeholder="From email (optional)" className={inputClass} />
                    </div>
                    <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} rows={5} placeholder="Paste the email text…" className={`${inputClass} font-mono text-xs`} />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => addEmail(false)} disabled={Boolean(busy)} className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high disabled:opacity-50">
                        {busy === "email" ? "Saving…" : "Log only"}
                      </button>
                      <button type="button" onClick={() => addEmail(true)} disabled={Boolean(busy)} className="rounded-lg bg-primary-container px-3 py-1.5 text-xs font-semibold text-on-primary-container disabled:opacity-50">
                        {busy === "email-apply" ? <SpinnerLabel label="Parsing" /> : "Log & review"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {pendingApply && application && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-primary">
                      Review changes from this email
                    </p>
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
                      Not applied yet
                    </span>
                  </div>
                  {previewChanges.length === 0 ? (
                    <p className="mt-2 text-xs text-text-secondary">
                      No field changes detected. The email was logged to the timeline.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {previewChanges.map((change) => (
                        <div key={change.label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-xs">
                          <span className="text-text-tertiary">{change.label}</span>
                          <span className="min-w-0 text-text-secondary">
                            <span className="line-through decoration-text-tertiary/60">{change.from}</span>
                            <span className="px-1.5 text-text-tertiary">→</span>
                            <span className="font-semibold text-text-primary">{change.to}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingApply(null)}
                      disabled={Boolean(busy)}
                      className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={applyPending}
                      disabled={Boolean(busy) || previewChanges.length === 0}
                      className="rounded-lg bg-primary-container px-3 py-1.5 text-xs font-semibold text-on-primary-container disabled:opacity-50"
                    >
                      {busy === "apply" ? <SpinnerLabel label="Applying" /> : "Apply changes"}
                    </button>
                  </div>
                </div>
              )}

              {application?.notes && (
                <div>
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Notes</p>
                  <pre className="whitespace-pre-wrap rounded-xl border border-surface-border bg-surface-container-low p-3 font-sans text-xs leading-relaxed text-text-secondary">
                    {application.notes}
                  </pre>
                </div>
              )}

              <div>
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Timeline · {events.length} events · {emails.length} emails
                </p>
                <div className="space-y-1">
                  {timeline.length === 0 && <EmptyState message="No activity yet." icon="history" />}
                  {timeline.map((item) =>
                    item.kind === "event" ? (
                      <div key={item.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
                        <EventIcon type={item.event.type} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs font-medium capitalize text-text-primary">{item.event.type}</p>
                            <span className="shrink-0 text-[9px] text-text-tertiary">{fmtDateTime(item.event.created_at)}</span>
                          </div>
                          <p className="truncate text-[10px] text-text-tertiary">
                            {Object.entries(item.event.data || {})
                              .filter(([, value]) => value !== null && value !== "")
                              .slice(0, 4)
                              .map(([key, value]) => `${key}: ${String(value)}`)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div key={item.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
                        <EventIcon type="email" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-xs font-medium text-text-primary">{item.email.subject || "(no subject)"}</p>
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="text-[9px] text-text-tertiary">{fmtDate(item.email.received_at)}</span>
                              <button
                                type="button"
                                onClick={() => deleteEmail(item.email)}
                                disabled={Boolean(busy)}
                                aria-label="Delete logged email"
                                title="Delete logged email"
                                className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-error-container/20 hover:text-error disabled:opacity-50"
                              >
                                <Icon
                                  name={busy === `email-delete-${item.email.id}` ? "progress_activity" : "delete"}
                                  className={`text-[13px] ${busy === `email-delete-${item.email.id}` ? "animate-spin" : ""}`}
                                />
                              </button>
                            </div>
                          </div>
                          <p className="truncate text-[10px] text-text-tertiary">
                            {item.email.from_email || "unknown sender"} · {Math.round(item.email.confidence * 100)}% · {item.email.parser_version}
                          </p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>

              {error && <p className="rounded-lg bg-error-container/30 px-3 py-2 text-xs text-error">{error}</p>}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        className="max-w-xl rounded-2xl border border-surface-border bg-surface-elevated p-5 shadow-2xl"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-text-primary">Follow-up draft</h3>
              <p className="text-[10.5px] text-text-tertiary">
                {followUp?.generator === "llm" ? "Generated with your AI provider" : "Safe template (no AI key needed)"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFollowUpOpen(false)}
              className="rounded-lg p-1 text-text-tertiary hover:bg-surface-container-high hover:text-text-primary"
              aria-label="Close draft"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["follow_up", "Follow up"],
              ["thank_you", "Thank you"],
              ["offer_nudge", "Offer nudge"],
              ["decline", "Decline"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => void generateFollowUp(value)}
                disabled={followUpBusy}
                className={`rounded-lg border px-2.5 py-1 text-[10.5px] font-medium transition disabled:opacity-50 ${
                  followUpVariant === value
                    ? "border-cyan/50 bg-cyan/15 text-cyan"
                    : "border-surface-border text-text-secondary hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {followUp && (
            <>
              <input
                value={followUp.subject}
                onChange={(event) => setFollowUp({ ...followUp, subject: event.target.value })}
                className={inputClass}
                aria-label="Follow-up subject"
              />
              <textarea
                value={followUp.body}
                onChange={(event) => setFollowUp({ ...followUp, body: event.target.value })}
                className={`${inputClass} min-h-[240px] resize-y font-mono text-[11.5px] leading-relaxed`}
                aria-label="Follow-up body"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={copyFollowUp}
                  className="rounded-lg border border-surface-border px-3 py-1.5 text-[11.5px] font-medium text-text-secondary hover:bg-surface-container-high"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={mailFollowUp}
                  className="rounded-lg bg-cyan px-3.5 py-1.5 text-[11.5px] font-semibold text-on-primary-container shadow-sm hover:bg-cyan/90"
                >
                  Open in mail app
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </Modal>
  );
}
