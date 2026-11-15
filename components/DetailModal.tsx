"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Application, EmailRow, TimelineEvent } from "@/lib/types";
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

export function DetailModal({
  applicationId,
  onClose,
  onChanged,
  onEdit,
  notify,
}: {
  applicationId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (application: Application) => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [application, setApplication] = useState<Application | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [rawText, setRawText] = useState("");
  const [subject, setSubject] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [emailPanel, setEmailPanel] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const [app, timeline] = await Promise.all([
        api<Application>(`/api/applications/${applicationId}`),
        api<{ events: TimelineEvent[]; emails: EmailRow[] }>(`/api/applications/${applicationId}/timeline`),
      ]);
      setApplication(app);
      setEvents(timeline.events || []);
      setEmails(timeline.emails || []);
    } catch (loadError) {
      notify(loadError instanceof Error ? loadError.message : "Could not load application.", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [applicationId, notify, onClose]);

  useEffect(() => {
    if (!applicationId) {
      setApplication(null);
      setEvents([]);
      setEmails([]);
      return;
    }
    setEmailPanel(false);
    setRawText("");
    void load();
  }, [applicationId, load]);

  if (!applicationId) return null;
  const meta = application ? stageMeta(application.stage) : null;

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

  async function addEmail(applyEmail: boolean) {
    if (!application || !rawText.trim()) {
      setError("Paste the email text first.");
      return;
    }
    setBusy(applyEmail ? "email-apply" : "email");
    setError("");
    try {
      await api(`/api/applications/${application.id}/emails`, {
        method: "POST",
        body: {
          raw_text: rawText,
          subject,
          from_email: fromEmail,
          apply: applyEmail,
        },
      });
      notify(applyEmail ? "Email logged and applied" : "Email logged", "success");
      setRawText("");
      setSubject("");
      setFromEmail("");
      setEmailPanel(false);
      await load();
      onChanged();
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Could not log the email.");
    } finally {
      setBusy("");
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
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Next action</p>
                  <p className="mt-1 text-xs font-medium text-text-primary">{application?.next_action || "None"}</p>
                  <p className={`mt-1 text-[11px] ${application?.action_state === "action_required" ? "text-signal-warning" : "text-text-tertiary"}`}>
                    {application?.next_action_at ? `${fmtDate(application.next_action_at)} · ${relative(application.next_action_at)}` : "No date"}
                  </p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Check back</p>
                  <p className={`mt-1 text-xs font-medium ${meta?.text || ""}`}>
                    {application?.check_back_at ? `${fmtDate(application.check_back_at)} · ${relative(application.check_back_at)}` : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-text-tertiary">{application?.check_back_source || "none"}</p>
                </div>
                <div className="rounded-xl border border-surface-border bg-surface-container-low p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Applied</p>
                  <p className="mt-1 text-xs font-medium text-text-primary">{fmtDate(application?.applied_at)}</p>
                  <p className="mt-1 text-[11px] text-text-tertiary">{application?.follow_up_count || 0} follow-ups</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={application?.stage}
                  onChange={(event) => changeStage(event.target.value)}
                  disabled={Boolean(busy)}
                  className="rounded-lg border border-surface-border bg-surface-container-lowest px-2.5 py-1.5 text-xs text-text-primary outline-none"
                >
                  {["applied", "assessment", "interview", "offer", "rejected", "withdrawn"].map((stage) => (
                    <option key={stage} value={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => application && onEdit(application)}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high"
                >
                  <Icon name="edit" className="text-[15px]" /> Edit
                </button>
                <div className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-text-secondary">
                  <Icon name="snooze" className="text-[15px]" />
                  {[1, 3, 7].map((days) => (
                    <button key={days} type="button" onClick={() => snooze(days)} disabled={Boolean(busy)} className="rounded px-1.5 py-0.5 hover:bg-surface-container-high disabled:opacity-50">
                      {busy === `snooze-${days}` ? "…" : `+${days}d`}
                    </button>
                  ))}
                </div>
                <a
                  href={`/api/applications/${application?.id}/calendar.ics`}
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high"
                >
                  <Icon name="calendar_month" className="text-[15px]" /> ICS
                </a>
                {application?.job_url && (
                  <a href={application.job_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-container-high">
                    <Icon name="open_in_new" className="text-[15px]" /> Job post
                  </a>
                )}
              </div>

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Log an outcome</p>
                <div className="flex flex-wrap gap-1.5">
                  {OUTCOME_BUTTONS.map((button) => (
                    <button
                      key={button.value}
                      type="button"
                      onClick={() => logOutcome(button.value)}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-1 rounded-lg border border-surface-border bg-surface-container-low px-2.5 py-1.5 text-[11px] text-text-secondary transition hover:border-primary/40 hover:text-text-primary disabled:opacity-50"
                    >
                      <Icon name={button.icon} className="text-[14px]" />
                      {busy === button.value ? "…" : button.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-surface-border bg-surface-container-low">
                <button type="button" onClick={() => setEmailPanel((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                  <Icon name="mail" className="text-[18px] text-primary" />
                  <span className="flex-1 text-xs font-semibold text-text-primary">Paste a new email</span>
                  <Icon name={emailPanel ? "expand_less" : "expand_more"} className="text-[18px] text-text-tertiary" />
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
                        {busy === "email-apply" ? <SpinnerLabel label="Applying" /> : "Log & apply"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {application?.notes && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Notes</p>
                  <pre className="whitespace-pre-wrap rounded-xl border border-surface-border bg-surface-container-low p-3 font-sans text-xs leading-relaxed text-text-secondary">
                    {application.notes}
                  </pre>
                </div>
              )}

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
                  Timeline · {events.length} events · {emails.length} emails
                </p>
                <div className="space-y-1">
                  {events.length === 0 && emails.length === 0 && <EmptyState message="No activity yet." icon="history" />}
                  {events.map((event) => (
                    <div key={event.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
                      <EventIcon type={event.type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-medium capitalize text-text-primary">{event.type}</p>
                          <span className="shrink-0 text-[10px] text-text-tertiary">{fmtDateTime(event.created_at)}</span>
                        </div>
                        <p className="truncate text-[11px] text-text-tertiary">
                          {Object.entries(event.data || {})
                            .filter(([, value]) => value !== null && value !== "")
                            .slice(0, 4)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  ))}
                  {emails.map((email) => (
                    <div key={email.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-container-low">
                      <EventIcon type="email" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-xs font-medium text-text-primary">{email.subject || "(no subject)"}</p>
                          <span className="shrink-0 text-[10px] text-text-tertiary">{fmtDate(email.received_at)}</span>
                        </div>
                        <p className="truncate text-[11px] text-text-tertiary">
                          {email.from_email || "unknown sender"} · {Math.round(email.confidence * 100)}% · {email.parser_version}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="rounded-lg bg-error-container/30 px-3 py-2 text-xs text-error">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
