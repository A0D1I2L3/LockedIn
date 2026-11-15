"use client";

import { useEffect, type ReactNode } from "react";
import { STAGE_LABELS, type Stage } from "@/lib/types";

const STAGE_META: Record<
  Stage,
  { label: string; pill: string; dot: string; text: string; avatar: string }
> = {
  applied: {
    label: "Applied",
    pill: "bg-stage-applied/20 text-stage-applied",
    dot: "bg-stage-applied",
    text: "text-stage-applied",
    avatar: "bg-stage-applied/20 text-stage-applied",
  },
  assessment: {
    label: "Assessment",
    pill: "bg-stage-assessment/20 text-stage-assessment",
    dot: "bg-stage-assessment",
    text: "text-stage-assessment",
    avatar: "bg-stage-assessment/20 text-stage-assessment",
  },
  interview: {
    label: "Interviewing",
    pill: "bg-stage-interview/20 text-stage-interview",
    dot: "bg-stage-interview",
    text: "text-stage-interview",
    avatar: "bg-stage-interview/20 text-stage-interview",
  },
  offer: {
    label: "Offer",
    pill: "bg-stage-offer/20 text-stage-offer",
    dot: "bg-stage-offer",
    text: "text-stage-offer",
    avatar: "bg-stage-offer/20 text-stage-offer",
  },
  rejected: {
    label: "Rejected",
    pill: "bg-stage-rejected/20 text-stage-rejected",
    dot: "bg-stage-rejected",
    text: "text-stage-rejected",
    avatar: "bg-stage-rejected/20 text-stage-rejected",
  },
  withdrawn: {
    label: "Withdrawn",
    pill: "bg-stage-withdrawn/20 text-stage-withdrawn",
    dot: "bg-stage-withdrawn",
    text: "text-stage-withdrawn",
    avatar: "bg-stage-withdrawn/20 text-stage-withdrawn",
  },
};

export function stageMeta(stage: Stage) {
  return STAGE_META[stage] || STAGE_META.applied;
}

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  const meta = stageMeta(stage);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {STAGE_LABELS[stage] || "Applied"}
    </span>
  );
}

export function CompanyAvatar({ company, stage }: { company: string; stage: Stage }) {
  const meta = stageMeta(stage);
  const initial = (company || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${meta.avatar}`}
    >
      {initial}
    </span>
  );
}

export function EmptyState({ message, icon = "inbox" }: { message: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon name={icon} className="text-[28px] text-text-tertiary" />
      <p className="text-xs text-text-tertiary">{message}</p>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/80 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`max-h-[92vh] w-full overflow-y-auto ${className}`}>{children}</div>
    </div>
  );
}

export function SpinnerLabel({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      {label}
    </span>
  );
}

export function fmtDate(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDateTime(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateInputValue(ms: number | null | undefined) {
  if (!ms) return "";
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(ms - offset).toISOString().slice(0, 10);
}

export function relative(ms: number | null | undefined) {
  if (!ms) return "";
  const days = Math.round((Number(ms) - Date.now()) / 86_400_000);
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return fmtDate(ms);
}

export function EventIcon({ type }: { type: string }) {
  const name = type === "email" ? "mail" : type === "outcome" ? "flag" : "history";
  return <Icon name={name} className="mt-0.5 text-[18px] text-text-tertiary" />;
}
