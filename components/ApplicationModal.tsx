"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { STAGES, STAGE_LABELS, TERMINAL_STAGES, type Application, type ParsedDraft, type Stage } from "@/lib/types";
import { Icon, Modal, SpinnerLabel, dateInputValue, fmtDate } from "@/components/ui";

const inputClass =
  "w-full rounded-lg border border-surface-border bg-surface-container-lowest px-3 py-2 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary";
const labelClass = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary";

interface FormState {
  company: string;
  role: string;
  location: string;
  job_url: string;
  source: string;
  stage: Stage;
  applied_at: string;
  check_back_at: string;
  next_action: string;
  next_action_at: string;
  notes: string;
}

function initialForm(application: Application | null, draft?: ParsedDraft | null, initialStage?: Stage): FormState {
  if (application) {
    return {
      company: application.company,
      role: application.role,
      location: application.location,
      job_url: application.job_url,
      source: application.source,
      stage: application.stage,
      applied_at: dateInputValue(application.applied_at),
      check_back_at: dateInputValue(application.check_back_at),
      next_action: application.next_action,
      next_action_at: dateInputValue(application.next_action_at),
      notes: application.notes,
    };
  }
  const today = Date.now();
  if (draft) {
    return {
      company: draft.company,
      role: draft.role,
      location: draft.location,
      job_url: "",
      source: "Parsed email",
      stage: draft.stage,
      applied_at: dateInputValue(today),
      check_back_at: dateInputValue(draft.check_back_at),
      next_action: draft.next_action,
      next_action_at: dateInputValue(draft.next_action_at),
      notes: draft.evidence.length ? `Parsed evidence: ${draft.evidence.join(" · ")}` : "",
    };
  }
  return {
    company: "",
    role: "",
    location: "",
    job_url: "",
    source: "",
    stage: initialStage || "applied",
    applied_at: dateInputValue(today),
    check_back_at: dateInputValue(today + 7 * 86_400_000),
    next_action: "Wait for a response",
    next_action_at: "",
    notes: "",
  };
}

export function ApplicationModal({
  open,
  application,
  initialDraft = null,
  initialStage,
  onClose,
  onSaved,
  notify,
}: {
  open: boolean;
  application: Application | null;
  initialDraft?: ParsedDraft | null;
  initialStage?: Stage;
  onClose: () => void;
  onSaved: (application: Application) => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    initialForm(application, initialDraft, initialStage),
  );
  const [parseOpen, setParseOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(application, initialDraft, initialStage));
    setParseOpen(false);
    setRawText("");
    setDraft(null);
    setError("");
  }, [open, application, initialDraft, initialStage]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function handleParse() {
    if (!rawText.trim()) {
      setError("Paste the email text first.");
      return;
    }
    setParsing(true);
    setError("");
    try {
      const result = await api<ParsedDraft>("/api/parse-email", {
        method: "POST",
        body: { raw_text: rawText },
      });
      setDraft(result);
      setForm((current) => ({
        ...current,
        company: result.company || current.company,
        role: result.role || current.role,
        location: result.location || current.location,
        stage: result.stage || current.stage,
        next_action: result.next_action || current.next_action,
        next_action_at: dateInputValue(result.next_action_at),
        check_back_at: dateInputValue(result.check_back_at),
      }));
      notify(`Parsed with ${result.parser} (${Math.round(result.confidence * 100)}% confidence)`);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not parse the email.");
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.company.trim() && !form.role.trim()) {
      setError("Add at least a company or a role.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      ...form,
      applied_at: form.applied_at || null,
      check_back_at: form.check_back_at || null,
      next_action_at: form.next_action_at || null,
    };
    try {
      const saved = application
        ? await api<Application>(`/api/applications/${application.id}`, { method: "PATCH", body: payload })
        : await api<Application>("/api/applications", { method: "POST", body: payload });
      notify(application ? "Application updated" : "Application added", "success");
      onSaved(saved);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the application.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!application) return;
    if (!window.confirm(`Delete ${application.company || "this application"}? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/applications/${application.id}`, { method: "DELETE" });
      notify("Application deleted", "success");
      onSaved(application);
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete.");
      setBusy(false);
    }
  }

  const terminal = TERMINAL_STAGES.has(form.stage);

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between border-b border-surface-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">
              {application ? "Edit application" : "Add application"}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {application ? "Update stage, dates, or notes." : "Log an application manually or paste an email to autofill."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-tertiary hover:bg-surface-container-high hover:text-text-primary">
            <Icon name="close" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {!application && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <button
                type="button"
                onClick={() => setParseOpen((value) => !value)}
                className="flex w-full items-center gap-2 text-left"
              >
                <Icon name="auto_awesome" className="text-[18px] text-primary" />
                <span className="flex-1 text-xs font-semibold text-primary">Autofill from an email</span>
                <Icon name={parseOpen ? "expand_less" : "expand_more"} className="text-[18px] text-primary" />
              </button>
              {parseOpen && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    rows={5}
                    placeholder="Paste the full email text. No inbox access is used."
                    className={`${inputClass} font-mono text-xs`}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-text-tertiary">Rules run first; the LLM only fills gaps.</span>
                    <button
                      type="button"
                      onClick={handleParse}
                      disabled={parsing}
                      className="rounded-lg bg-primary-container px-3 py-1.5 text-xs font-semibold text-on-primary-container disabled:opacity-60"
                    >
                      {parsing ? <SpinnerLabel label="Parsing" /> : "Parse & autofill"}
                    </button>
                  </div>
                  {draft && (
                    <div className="rounded-lg bg-surface-container-lowest p-2 text-[11px] text-text-secondary">
                      <div className="flex items-center justify-between">
                        <span>
                          <span className="font-semibold capitalize text-text-primary">{draft.parser}</span> ·{" "}
                          {Math.round(draft.confidence * 100)}% confidence
                        </span>
                        <span className="text-text-tertiary">check back {fmtDate(draft.check_back_at)}</span>
                      </div>
                      {draft.evidence.length > 0 && (
                        <p className="mt-1 line-clamp-2 text-text-tertiary">{draft.evidence.join(" · ")}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Company</label>
              <input value={form.company} onChange={(event) => set("company", event.target.value)} className={inputClass} placeholder="Acme" />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <input value={form.role} onChange={(event) => set("role", event.target.value)} className={inputClass} placeholder="Software Engineering Intern" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Stage</label>
              <select value={form.stage} onChange={(event) => set("stage", event.target.value as Stage)} className={inputClass}>
                {STAGES.map((stage) => (
                  <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <input value={form.location} onChange={(event) => set("location", event.target.value)} className={inputClass} placeholder="Remote / NYC" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Applied</label>
              <input type="date" value={form.applied_at} onChange={(event) => set("applied_at", event.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Check back</label>
              <input type="date" value={form.check_back_at} onChange={(event) => set("check_back_at", event.target.value)} className={inputClass} disabled={terminal} />
            </div>
            <div>
              <label className={labelClass}>Next action due</label>
              <input type="date" value={form.next_action_at} onChange={(event) => set("next_action_at", event.target.value)} className={inputClass} disabled={terminal} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Next action</label>
              <input value={form.next_action} onChange={(event) => set("next_action", event.target.value)} className={inputClass} placeholder="Follow up with recruiter" />
            </div>
            <div>
              <label className={labelClass}>Source</label>
              <input value={form.source} onChange={(event) => set("source", event.target.value)} className={inputClass} placeholder="LinkedIn, referral…" />
            </div>
          </div>

          <div>
            <label className={labelClass}>Job URL</label>
            <input value={form.job_url} onChange={(event) => set("job_url", event.target.value)} className={inputClass} placeholder="https://" />
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} rows={3} className={inputClass} placeholder="Recruiter name, referral, anything to remember…" />
          </div>

          {terminal && (
            <p className="rounded-lg bg-stage-rejected/10 px-3 py-2 text-[11px] text-stage-rejected">
              This stage closes the application and clears active reminders.
            </p>
          )}
          {error && <p className="rounded-lg bg-error-container/30 px-3 py-2 text-xs text-error">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-surface-border px-5 py-3">
          {application ? (
            <button type="button" onClick={handleDelete} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-semibold text-error hover:bg-error-container/20 disabled:opacity-50">
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-container-high">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-primary-container px-4 py-2 text-xs font-bold text-on-primary-container shadow-[0_0_20px_rgba(118,192,236,0.28)] disabled:opacity-60">
              {busy ? <SpinnerLabel label="Saving" /> : application ? "Save changes" : "Add application"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
