"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { STAGE_LABELS, type Stage } from "@/lib/types";

const STAGE_META: Record<
  Stage,
  {
    label: string;
    pill: string;
    dot: string;
    text: string;
    avatar: string;
    border: string;
    hover: string;
    glow: string;
  }
> = {
  saved: {
    label: "Saved",
    pill: "bg-stage-saved/20 text-stage-saved",
    dot: "bg-stage-saved",
    text: "text-stage-saved",
    avatar: "bg-stage-saved/20 text-stage-saved",
    border: "border-stage-saved/30",
    hover: "hover:border-stage-saved",
    glow: "shadow-[0_0_8px_rgba(34,211,238,0.45)]",
  },
  applied: {
    label: "Applied",
    pill: "bg-stage-applied/20 text-stage-applied",
    dot: "bg-stage-applied",
    text: "text-stage-applied",
    avatar: "bg-stage-applied/20 text-stage-applied",
    border: "border-stage-applied/30",
    hover: "hover:border-stage-applied",
    glow: "shadow-[0_0_8px_rgba(96,165,250,0.4)]",
  },
  assessment: {
    label: "Assessment",
    pill: "bg-stage-assessment/20 text-stage-assessment",
    dot: "bg-stage-assessment",
    text: "text-stage-assessment",
    avatar: "bg-stage-assessment/20 text-stage-assessment",
    border: "border-stage-assessment/30",
    hover: "hover:border-stage-assessment",
    glow: "shadow-[0_0_8px_rgba(245,158,11,0.45)]",
  },
  interview: {
    label: "Interviewing",
    pill: "bg-stage-interview/20 text-stage-interview",
    dot: "bg-stage-interview",
    text: "text-stage-interview",
    avatar: "bg-stage-interview/20 text-stage-interview",
    border: "border-stage-interview/30",
    hover: "hover:border-stage-interview",
    glow: "shadow-[0_0_8px_rgba(168,85,247,0.45)]",
  },
  offer: {
    label: "Offer",
    pill: "bg-stage-offer/20 text-stage-offer",
    dot: "bg-stage-offer",
    text: "text-stage-offer",
    avatar: "bg-stage-offer/20 text-stage-offer",
    border: "border-stage-offer/30",
    hover: "hover:border-stage-offer",
    glow: "shadow-[0_0_8px_rgba(16,185,129,0.5)]",
  },
  rejected: {
    label: "Rejected",
    pill: "bg-stage-rejected/20 text-stage-rejected",
    dot: "bg-stage-rejected",
    text: "text-stage-rejected",
    avatar: "bg-stage-rejected/20 text-stage-rejected",
    border: "border-stage-rejected/30",
    hover: "hover:border-stage-rejected",
    glow: "shadow-[0_0_8px_rgba(239,68,68,0.4)]",
  },
  withdrawn: {
    label: "Withdrawn",
    pill: "bg-stage-withdrawn/20 text-stage-withdrawn",
    dot: "bg-stage-withdrawn",
    text: "text-stage-withdrawn",
    avatar: "bg-stage-withdrawn/20 text-stage-withdrawn",
    border: "border-stage-withdrawn/30",
    hover: "hover:border-stage-withdrawn",
    glow: "",
  },
};

export function stageMeta(stage: Stage) {
  return STAGE_META[stage] || STAGE_META.applied;
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  const meta = stageMeta(stage);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide ${meta.pill}`}
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
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${meta.avatar}`}
    >
      {initial}
    </span>
  );
}

export function EmptyState({ message, icon = "inbox" }: { message: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon name={icon} className="text-[24px] text-text-tertiary" />
      <p className="text-xs text-text-tertiary">{message}</p>
    </div>
  );
}

let bodyLockCount = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) previousBodyOverflow = document.body.style.overflow;
  bodyLockCount += 1;
  document.body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

const FOCUSABLE_SELECTOR =
  "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

export function Modal({
  open,
  onClose,
  children,
  className = "",
  position = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  position?: "center" | "right";
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = focusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    lockBodyScroll();
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      (focusableElements(panel)[0] || panel).focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      unlockBodyScroll();
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 z-50 flex bg-surface-base/80 backdrop-blur-md ${
        position === "right" ? "items-stretch justify-end" : "items-center justify-center p-4"
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`w-full outline-none ${
          position === "right" ? "h-full" : "max-h-[92vh] overflow-y-auto"
        } ${className}`}
      >
        {children}
      </div>
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
  const date = new Date(ms);
  const withYear = date.getFullYear() !== new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
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

function localDayNumber(ms: number) {
  const date = new Date(ms);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function relative(ms: number | null | undefined) {
  if (!ms) return "";
  const days = localDayNumber(Number(ms)) - localDayNumber(Date.now());
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return fmtDate(ms);
}

export function daysAgo(ms: number | null | undefined) {
  if (!ms) return "—";
  const days = localDayNumber(Date.now()) - localDayNumber(Number(ms));
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function EventIcon({ type }: { type: string }) {
  const name = type === "email" ? "mail" : type === "outcome" ? "flag" : "history";
  return <Icon name={name} className="mt-0.5 text-[16px] text-text-tertiary" />;
}
