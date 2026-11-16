"use client";

import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Application, NotificationItem, ParsedDraft, Stage } from "@/lib/types";
import { STAGES, STAGE_LABELS } from "@/lib/types";
import {
  CompanyAvatar,
  EmptyState,
  Icon,
  Modal,
  SpinnerLabel,
  StageBadge,
  dateInputValue,
  daysAgo,
  fmtDate,
  relative,
} from "@/components/ui";
import {
  columnMeta,
  dateKey,
  isOverdue,
  type AgendaItem,
} from "@/components/pipeline-utils";

export function SummaryDot({
  stage,
  label,
  value,
  suffix,
}: {
  stage: Stage;
  label: string;
  value: number;
  suffix: string;
}) {
  const meta = columnMeta(stage);
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${meta.dot} ${meta.glow}`} />
      <span>
        {label}: <strong className={`font-semibold ${meta.text}`}>{value} {suffix}</strong>
      </span>
    </div>
  );
}

export function TodayAgenda({
  buckets,
  onOpen,
  onSnooze,
  onFollowedUp,
}: {
  buckets: { overdue: AgendaItem[]; today: AgendaItem[]; week: AgendaItem[] };
  onOpen: (id: string) => void;
  onSnooze: (app: Application, days: number) => void;
  onFollowedUp: (app: Application) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = [
    { key: "overdue", label: "Overdue", dot: "bg-stage-rejected", text: "text-stage-rejected", items: buckets.overdue },
    { key: "today", label: "Due today", dot: "bg-stage-assessment", text: "text-stage-assessment", items: buckets.today },
    { key: "week", label: "This week", dot: "bg-cyan", text: "text-cyan", items: buckets.week },
  ];
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (total === 0) return null;

  return (
    <section
      aria-labelledby="today-agenda-heading"
      className="mb-6 overflow-hidden rounded-2xl border border-border/80 bg-surface/60 backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
            <Icon name="today" className="text-[15px]" />
          </span>
          <h2 id="today-agenda-heading" className="font-display text-sm font-semibold tracking-tight text-cream">
            Today
          </h2>
          <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[10px] font-semibold text-cream-muted">
            {total}
          </span>
        </div>
        {total > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[10px] font-semibold text-cyan hover:text-cyan/80"
          >
            {expanded ? "Show less" : "Show all"}
          </button>
        )}
      </div>

      <div className="divide-y divide-border/30">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => {
            const items = expanded ? group.items : group.items.slice(0, 5);
            return (
              <div key={group.key} className="px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${group.dot}`} />
                  <h3 className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${group.text}`}>
                    {group.label}
                  </h3>
                  <span className="text-[10px] text-cream-muted/60">{group.items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((item) => {
                    const name = item.app.company || item.app.role || "Application";
                    return (
                      <div
                        key={`${item.app.id}-${item.kind}`}
                        className="flex flex-col gap-2 rounded-xl border border-border/40 bg-base/30 px-3 py-2.5 sm:flex-row sm:items-center"
                      >
                        <button
                          type="button"
                          onClick={() => onOpen(item.app.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <CompanyAvatar company={item.app.company} stage={item.app.stage} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-cream">
                              {name}
                              {item.app.role ? (
                                <span className="font-normal text-cream-muted"> · {item.app.role}</span>
                              ) : null}
                            </p>
                            <p className="truncate text-[10px] text-cream-muted">
                              {item.kind === "check_back" ? "Check back" : "Next action"}
                              {item.app.next_action && item.kind === "next_action"
                                ? `: ${item.app.next_action}`
                                : ""}
                              {" · "}
                              {fmtDate(item.dueAt)} · {relative(item.dueAt)}
                            </p>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onFollowedUp(item.app)}
                            aria-label={`Mark ${name} as followed up`}
                            className="rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1 text-[10px] font-semibold text-cyan transition hover:bg-cyan/20"
                          >
                            Followed up
                          </button>
                          {[1, 3, 7].map((days) => (
                            <button
                              key={days}
                              type="button"
                              onClick={() => onSnooze(item.app, days)}
                              aria-label={`Snooze ${name} ${days} day${days === 1 ? "" : "s"}`}
                              className="rounded-lg border border-border bg-surface px-2 py-1 text-[10px] font-medium text-cream-muted transition hover:border-steel hover:text-cream"
                            >
                              +{days}d
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => onOpen(item.app.id)}
                            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-cream-muted transition hover:text-cream"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}

export function BoardCard({
  app,
  meta,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onKeyDown,
}: {
  app: Application;
  meta: ReturnType<typeof columnMeta>;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const now = Date.now();
  const checkDue = Boolean(app.check_back_at && app.check_back_at <= now);
  const actionDue = Boolean(app.next_action_at && app.next_action_at <= now);
  const urgent = checkDue || actionDue;

  return (
    <button
      onClick={onOpen}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      title="Drag to another stage, or press Alt+Left/Right"
      className={`group flex w-full cursor-grab flex-col gap-2.5 rounded-xl border bg-surface p-4 text-left shadow-sm transition-all hover:bg-surface-raised/60 active:cursor-grabbing ${
        dragging ? "opacity-45" : ""
      } ${
        urgent ? "border-[#EF4444]/45 hover:border-[#EF4444]" : `${meta.border} ${meta.hover}`
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate font-display text-sm font-semibold text-cream transition-colors group-hover:text-cyan">
            {app.company || "Untitled"}
          </h4>
          <p className="mt-0.5 truncate text-xs text-cream-muted">{app.role || "—"}</p>
        </div>
        <CompanyAvatar company={app.company} stage={app.stage} />
      </div>

      {app.stage !== "applied" && app.next_action && (
        <div
          className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs ${meta.border}`}
          style={{ background: "linear-gradient(135deg, rgba(118,192,236,0.08) 0%, rgba(27,36,59,0.9) 100%)" }}
        >
          <span className={`font-medium ${meta.text}`}>{app.next_action}</span>
          <span className="text-cream-muted">
            {app.next_action_at ? fmtDate(app.next_action_at) : "No deadline"} · {app.location || "—"}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs">
        {actionDue ? (
          <span className="flex items-center gap-1.5 rounded-md border border-[#EF4444]/40 bg-[#EF4444]/15 px-2 py-0.5 text-[10px] font-semibold text-[#FF95A5]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444] shadow-[0_0_6px_#EF4444]" />
            Due {relative(app.next_action_at)}
          </span>
        ) : app.apply_by ? (
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
              app.apply_by <= now
                ? "border-[#EF4444]/40 bg-[#EF4444]/15 text-[#FF95A5]"
                : "border-stage-saved/30 bg-stage-saved/15 text-stage-saved"
            }`}
          >
            <Icon name="event" className="text-[12px]" />
            {app.apply_by <= now ? "Apply deadline passed" : `Apply by ${relative(app.apply_by)}`}
          </span>
        ) : app.check_back_at ? (
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
              checkDue
                ? "border-[#EF4444]/40 bg-[#EF4444]/15 text-[#FF95A5]"
                : "border-[#F59E0B]/30 bg-[#F59E0B]/15 text-[#FCD34D]"
            }`}
          >
            <Icon name="schedule" className="text-[12px]" />
            {checkDue ? "Check back due" : `${relative(app.check_back_at)} check-back`}
          </span>
        ) : (
          <span className="text-cream-muted/70">No cadence</span>
        )}
        <span className="shrink-0 text-cream-muted">
          {app.stage === "saved" && app.apply_by
            ? `Apply by ${fmtDate(app.apply_by)}`
            : app.stage === "applied"
              ? `Applied ${daysAgo(app.applied_at)}`
              : app.source || "—"}
        </span>
      </div>
    </button>
  );
}

export function ListView({
  applications,
  onOpen,
  onAdd,
  onShowBoard,
}: {
  applications: Application[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onShowBoard: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-surface/60">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-cream">
          All applications <span className="ml-1 text-xs font-normal text-cream-muted">({applications.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={onAdd} className="rounded-lg border border-border px-3 py-1.5 text-[10px] font-semibold text-cream-muted hover:border-cyan/50 hover:text-cream">
            Add
          </button>
          <button onClick={onShowBoard} className="rounded-lg border border-border px-3 py-1.5 text-[10px] font-semibold text-cream-muted hover:border-cyan/50 hover:text-cream">
            Board view
          </button>
        </div>
      </div>
      <div className="hidden grid-cols-[minmax(0,1.5fr)_120px_120px_140px_32px] gap-3 border-b border-border/40 px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-cream-muted/70 md:grid">
        <span>Company / role</span>
        <span>Stage</span>
        <span>Check back</span>
        <span>Next action</span>
        <span />
      </div>
      {applications.length === 0 ? (
        <EmptyState message="No applications match your search." icon="search_off" />
      ) : (
        applications.map((app) => {
          const overdue = isOverdue(app);
          return (
            <button
              key={app.id}
              onClick={() => onOpen(app.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/30 px-4 py-3 text-left transition last:border-0 hover:bg-surface-raised/50 md:grid-cols-[minmax(0,1.5fr)_120px_120px_140px_32px]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <CompanyAvatar company={app.company} stage={app.stage} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-cream">{app.company || "Untitled"}</p>
                  <p className="truncate text-[10px] text-cream-muted">
                    {app.role || "—"}
                    {app.location ? ` · ${app.location}` : ""}
                  </p>
                </div>
              </div>
              <StageBadge stage={app.stage} />
              <span className={`hidden text-[10px] md:block ${overdue ? "font-semibold text-signal-warning" : "text-cream-muted"}`}>
                {app.check_back_at ? fmtDate(app.check_back_at) : "—"}
              </span>
              <span className="hidden truncate text-[10px] text-cream-muted md:block">
                {app.next_action || "—"}
              </span>
              <Icon name="chevron_right" className="hidden text-[15px] text-cream-muted md:block" />
            </button>
          );
        })
      )}
    </section>
  );
}

export function ParserInputModal({
  open,
  value,
  onChange,
  parsing,
  error,
  aiReady,
  mode,
  onModeChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  parsing: boolean;
  error: string;
  aiReady: boolean;
  mode: string;
  onModeChange: (mode: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const modes = [
    { value: "auto", label: "Auto" },
    { value: "llm", label: "AI" },
    { value: "rules", label: "Rules" },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-2xl overflow-hidden rounded-2xl border border-border bg-[#0c101b] shadow-2xl"
    >
      <div className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between border-b border-border/60 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="auto_awesome" className="text-[16px] text-cyan" />
              <h2 className="font-display text-lg font-bold tracking-tight text-cream">
                Paste recruiter email
              </h2>
            </div>
            <p className="mt-1 text-xs text-cream-muted">
              {aiReady
                ? "Paste one email or a forwarded thread. Auto uses AI when rules are unsure."
                : "Paste one email or a forwarded thread. Rules parsing works without an API key."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-lg p-1 text-cream-muted transition hover:bg-white/5 hover:text-cream"
          >
            <Icon name="close" className="text-[17px]" />
          </button>
        </div>

        <div className="px-6 py-4">
          <textarea
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Paste the entire recruiter email here, including the greeting and signature…"
            className="min-h-[42vh] w-full resize-y rounded-xl border border-border bg-[#070b13] px-4 py-3 font-mono text-[11.5px] leading-relaxed text-cream/90 placeholder:text-cream-muted/40 focus:border-cyan focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[10px] text-cream-muted">Parser engine</span>
            <div className="flex rounded-lg border border-border/70 bg-[#070b13] p-0.5">
              {modes.map((item) => (
                <button
                  key={item.value}
                  onClick={() => onModeChange(item.value)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${
                    mode === item.value
                      ? "bg-cyan/15 text-cyan"
                      : "text-cream-muted hover:text-cream"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(error || (!aiReady && mode !== "rules")) && (
          <div className="mx-6 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            {error ||
              (mode === "llm"
                ? "No AI provider connected — falling back to rules parsing. Add a key in Settings for AI."
                : "No AI provider connected — Auto will use rules. Add a key in Settings for AI fallback.")}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border/60 bg-[#090d16] px-6 py-4">
          <span className="text-[10px] text-cream-muted">
            {value.trim().length.toLocaleString()} characters
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-1 text-xs font-medium text-cream-muted transition hover:text-cream"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={parsing || !value.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-xs font-semibold text-[#07131b] shadow-sm transition-all hover:bg-cyan/90 disabled:opacity-60"
            >
              {parsing ? (
                <SpinnerLabel label="Parsing" />
              ) : (
                <>
                  <Icon name="bolt" className="text-[13px]" />
                  <span>Parse &amp; Draft</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ParserPreview({
  open,
  draft,
  raw,
  saving,
  position,
  total,
  onClose,
  onEdit,
  onChange,
  onConfirm,
}: {
  open: boolean;
  draft: ParsedDraft | null;
  raw: string;
  saving: boolean;
  position: number;
  total: number;
  onClose: () => void;
  onEdit: () => void;
  onChange: (patch: Partial<ParsedDraft>) => void;
  onConfirm: (mode: "update" | "create") => void;
}) {
  const [matchMode, setMatchMode] = useState<"update" | "create">("create");
  useEffect(() => {
    setMatchMode(draft?.matched_application ? "update" : "create");
  }, [draft]);
  if (!open || !draft) return null;
  const meta = columnMeta(draft.stage);
  const excerpt = raw.trim().replace(/\s+/g, " ").slice(0, 150);
  const match = draft.matched_application;
  const confidence = draft.field_confidence || {};
  const editing = match ? matchMode : "create";

  function setDay(field: "apply_by" | "check_back_at" | "next_action_at", value: string) {
    const ms = value ? Date.parse(`${value}T09:00:00`) : null;
    onChange({ [field]: ms && !Number.isNaN(ms) ? ms : null });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="animate-rise-in max-w-lg rounded-2xl border border-border/80 bg-surface p-5 text-left shadow-2xl"
    >
      <div className="flex max-h-[92vh] flex-col gap-3.5 overflow-y-auto pr-0.5">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Icon name="auto_awesome" className="text-[16px] text-cyan" />
            <h3 className="font-display text-sm font-semibold tracking-wide text-cream">Smart Parser Draft</h3>
            <span className="rounded-full border border-cyan/30 bg-cyan/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan">
              {total > 1 ? `${position + 1} of ${total}` : "Preview ready"}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-cream-muted/60 transition-colors hover:bg-surface-raised hover:text-cream">
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>

        {match && (
          <div className="rounded-xl border border-cyan/25 bg-cyan/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan">
              <Icon name="link" className="text-[13px]" />
              Matches {match.company} · {match.role}
            </div>
            <div className="mt-1 text-[10px] text-cream-muted">
              Currently in {STAGE_LABELS[match.stage]}. Choose what this email should do.
            </div>
            <div className="mt-2 flex rounded-lg border border-border/70 bg-[#070b13] p-0.5">
              <button
                onClick={() => setMatchMode("update")}
                className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                  matchMode === "update" ? "bg-cyan/15 text-cyan" : "text-cream-muted hover:text-cream"
                }`}
              >
                Update existing
              </button>
              <button
                onClick={() => setMatchMode("create")}
                className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                  matchMode === "create" ? "bg-cyan/15 text-cyan" : "text-cream-muted hover:text-cream"
                }`}
              >
                Create new
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-cyan/10 bg-surface-container-lowest p-2.5 text-[11px] italic leading-relaxed text-cream/60">
          “{excerpt}{raw.trim().length > 150 ? "…" : ""}”
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <DraftField label="Company" value={draft.company} confidence={confidence.company} onChange={(value) => onChange({ company: value })} />
          <DraftField label="Role" value={draft.role} confidence={confidence.role} onChange={(value) => onChange({ role: value })} />
          <DraftField label="Location" value={draft.location || ""} confidence={confidence.location} onChange={(value) => onChange({ location: value })} />
          <div className="rounded-lg border border-border/50 bg-surface-raised p-2">
            <span className="mb-0.5 block text-[9px] font-medium text-cream-muted/60">Target stage</span>
            <select
              value={draft.stage}
              onChange={(event) => onChange({ stage: event.target.value as Stage })}
              className={`w-full bg-transparent text-[11.5px] font-semibold ${meta.text} focus:outline-none`}
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage} className="bg-surface text-cream">
                  {STAGE_LABELS[stage]}
                </option>
              ))}
            </select>
          </div>
          <DraftDate label="Apply by" value={draft.apply_by} confidence={confidence.dates} onChange={(value) => setDay("apply_by", value)} />
          <DraftDate label="Check back" value={draft.check_back_at} confidence={confidence.dates} onChange={(value) => setDay("check_back_at", value)} />
          <div className="col-span-2">
            <DraftField label="Next action" value={draft.next_action || ""} confidence={confidence.next_action} onChange={(value) => onChange({ next_action: value })} />
          </div>
          <DraftDate label="Next action at" value={draft.next_action_at} confidence={confidence.dates} onChange={(value) => setDay("next_action_at", value)} />
          <DraftField label="From" value={draft.from_email} onChange={(value) => onChange({ from_email: value })} />
        </div>

        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[9px] text-cream-muted/70">
          <span className="capitalize">{draft.parser} parser · {Math.round(draft.confidence * 100)}% confidence</span>
          {draft.evidence.length > 0 && <span className="max-w-[55%] truncate pl-3">{draft.evidence[0]}</span>}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border/40 pt-2">
          <button onClick={onEdit} className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-cream-muted transition-colors hover:bg-surface-raised hover:text-cream">
            Edit in form
          </button>
          <button
            onClick={() => onConfirm(editing)}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-1.5 text-xs font-semibold text-on-primary-container shadow-md transition-all hover:bg-cyan/90 disabled:opacity-60"
          >
            {saving ? (
              <SpinnerLabel label="Saving" />
            ) : (
              <>
                <Icon name="check_circle" className="text-[12.5px]" />
                {editing === "update" ? "Update & attach" : total > position + 1 ? "Add & next" : "Confirm & Add"}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DraftField({
  label,
  value,
  confidence,
  onChange,
}: {
  label: string;
  value: string;
  confidence?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-lg border border-border/50 bg-surface-raised p-2">
      <span className="mb-0.5 flex items-center justify-between gap-1 text-[9px] font-medium text-cream-muted/60">
        {label}
        {confidence !== undefined && (
          <span className={confidence >= 0.65 ? "text-cyan/70" : "text-amber-300/80"}>
            {Math.round(confidence * 100)}%
          </span>
        )}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-[11.5px] font-semibold text-cream focus:outline-none"
      />
    </label>
  );
}

function DraftDate({
  label,
  value,
  confidence,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  confidence?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-lg border border-border/50 bg-surface-raised p-2">
      <span className="mb-0.5 flex items-center justify-between gap-1 text-[9px] font-medium text-cream-muted/60">
        {label}
        {Boolean(value) && confidence !== undefined && (
          <span className={confidence >= 0.65 ? "text-cyan/70" : "text-amber-300/80"}>
            {Math.round(confidence * 100)}%
          </span>
        )}
      </span>
      <input
        type="date"
        value={dateInputValue(value ?? null)}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-[11.5px] font-semibold text-cream focus:outline-none [color-scheme:dark]"
      />
    </label>
  );
}

function FieldBox({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-raised p-2.5">
      <span className="mb-0.5 block text-[9px] font-medium text-cream-muted/60">{label}</span>
      <span className={`block truncate font-semibold ${accent ? "text-cyan" : "text-cream"}`}>{value}</span>
    </div>
  );
}

export function CadenceDrawer({
  open,
  items,
  due,
  permission,
  onEnable,
  onClose,
  onOpen,
}: {
  open: boolean;
  items: NotificationItem[];
  due: NotificationItem[];
  permission: string;
  onEnable: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - mondayOffset);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
  const eventDays = new Set(items.map((item) => dateKey(item.due_at)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      position="right"
      className="sm:w-[420px]"
    >
      <div className="animate-slide-in-right flex h-full w-full flex-col gap-5 overflow-y-auto border-l border-border/80 bg-surface p-6 shadow-2xl sm:rounded-l-2xl">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-steel/50 bg-steel/30 text-cyan">
              <Icon name="event_upcoming" className="text-[16px]" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-cream">Upcoming Cadence</h3>
              <p className="text-xs text-cream-muted">
                {items.length} deadline{items.length === 1 ? "" : "s"} &amp; events
              </p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised text-cream-muted transition-colors hover:border hover:border-steel hover:text-cream">
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>

        <div className="rounded-xl border border-border/50 bg-surface-raised/60 p-2 text-center text-xs">
          <div className="grid grid-cols-7 gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
              <div key={`${day}-${index}`} className="p-1 text-[9px] text-cream-muted/70">{day}</div>
            ))}
            {week.map((date) => {
              const isToday = date.toDateString() === now.toDateString();
              const hasEvent = eventDays.has(dateKey(date.getTime()));
              return (
                <div
                  key={date.toISOString()}
                  className={`rounded-lg py-1.5 ${
                    isToday
                      ? "border border-cyan/50 bg-cyan/15 font-bold text-cyan"
                      : hasEvent
                        ? "border border-signal-warning/40 bg-signal-warning/15 font-bold text-[#FCD34D]"
                        : "text-cream-muted"
                  }`}
                >
                  {date.getDate()}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          {items.length === 0 ? (
            <EmptyState message="Nothing due in the next 48 hours." icon="event_available" />
          ) : (
            items.map((item) => {
              const isDue = due.some(
                (entry) =>
                  entry.application_id === item.application_id &&
                  entry.due_at === item.due_at &&
                  entry.kind === item.kind,
              );
              const meta = columnMeta(item.stage);
              const border = isDue ? "border-[#EF4444]/35 hover:border-[#EF4444]" : `${meta.border} ${meta.hover}`;
              const chip = isDue
                ? "text-[#FF95A5] bg-[#EF4444]/20 border-[#EF4444]/40"
                : "text-[#FCD34D] bg-[#F59E0B]/16 border-[#F59E0B]/35";
              return (
                <button
                  key={`${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`}
                  onClick={() => onOpen(item.application_id)}
                  className={`group flex items-center justify-between gap-3 rounded-xl border bg-surface-raised/80 p-3.5 text-left shadow-sm transition-all ${border}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isDue ? "bg-[#EF4444] shadow-[0_0_8px_rgba(239,68,68,0.7)]" : `${meta.dot} ${meta.glow}`}`} />
                    <div>
                      <p className="text-xs font-semibold text-cream transition-colors group-hover:text-cyan">
                        {item.company}
                      </p>
                      <p className="mt-0.5 text-[10px] text-cream-muted">
                        {fmtDate(item.due_at)} · {item.title || item.role}
                      </p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2.5 py-1 text-[10px] font-semibold ${chip}`}>
                    {relative(item.due_at)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          <button
            onClick={onEnable}
            disabled={permission === "granted"}
            className="w-full rounded-xl border border-border bg-surface-raised py-2.5 text-xs font-medium text-cream transition-all hover:border-cyan/50 disabled:opacity-50"
          >
            {permission === "granted" ? "Browser notifications enabled" : "Enable browser notifications"}
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-border bg-surface-raised py-2.5 text-xs font-medium text-cream transition-all hover:border-steel"
          >
            Close drawer
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function Toast({
  message,
  tone,
  action,
}: {
  message: string;
  tone: "success" | "error";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
      <div
        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium shadow-2xl backdrop-blur-xl ${
          tone === "success"
            ? "border-cyan/30 bg-surface/95 text-cream"
            : "border-error/30 bg-error-container/80 text-white"
        }`}
      >
        <Icon name={tone === "success" ? "check_circle" : "error"} className={`text-[14px] ${tone === "success" ? "text-cyan" : "text-white"}`} />
        {message}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="pointer-events-auto ml-1 rounded-md border border-cyan/40 px-2 py-0.5 text-[10px] font-semibold text-cyan transition hover:bg-cyan/10"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
