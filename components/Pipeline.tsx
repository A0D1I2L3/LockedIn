"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type {
  Application,
  NotificationItem,
  ParsedDraft,
  Stage,
  Stats,
  UserPreferences,
} from "@/lib/types";
import { STAGE_LABELS } from "@/lib/types";
import { ApplicationModal } from "@/components/ApplicationModal";
import { DetailModal } from "@/components/DetailModal";
import { SettingsModal } from "@/components/SettingsModal";
import {
  CompanyAvatar,
  EmptyState,
  Icon,
  Modal,
  SpinnerLabel,
  StageBadge,
  fmtDate,
  relative,
} from "@/components/ui";

interface StatusPayload {
  authenticated: boolean;
  oauth_configured: boolean;
  base_url: string;
  email: string | null;
  stats: Stats;
}

interface SettingsPayload {
  configured: boolean;
  preferences?: UserPreferences;
}

interface Feed {
  now: number;
  due: NotificationItem[];
  upcoming: NotificationItem[];
}

const EMPTY_STATS: Stats = {
  by_stage: { applied: 0, assessment: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 },
  total: 0,
  active: 0,
  due: 0,
  upcoming: 0,
};

const BOARD_STAGES: Stage[] = ["applied", "assessment", "interview", "offer"];

const COLUMN_META: Record<
  Stage,
  { dot: string; glow: string; pill: string; border: string; hover: string; text: string }
> = {
  applied: {
    dot: "bg-[#60A5FA]",
    glow: "shadow-[0_0_8px_rgba(96,165,250,0.4)]",
    pill: "text-[#93C5FD] bg-[#60A5FA]/15 border-[#60A5FA]/30",
    border: "border-[#60A5FA]/30",
    hover: "hover:border-[#60A5FA]",
    text: "text-[#93C5FD]",
  },
  assessment: {
    dot: "bg-[#F59E0B]",
    glow: "shadow-[0_0_8px_rgba(245,158,11,0.45)]",
    pill: "text-[#FCD34D] bg-[#F59E0B]/15 border-[#F59E0B]/35",
    border: "border-[#F59E0B]/30",
    hover: "hover:border-[#F59E0B]",
    text: "text-[#FCD34D]",
  },
  interview: {
    dot: "bg-[#A855F7]",
    glow: "shadow-[0_0_8px_rgba(168,85,247,0.45)]",
    pill: "text-[#D8B4FE] bg-[#A855F7]/15 border-[#A855F7]/35",
    border: "border-[#A855F7]/30",
    hover: "hover:border-[#A855F7]",
    text: "text-[#C084FC]",
  },
  offer: {
    dot: "bg-[#10B981]",
    glow: "shadow-[0_0_8px_rgba(16,185,129,0.5)]",
    pill: "text-[#34D399] bg-[#10B981]/15 border-[#10B981]/35",
    border: "border-[#10B981]/30",
    hover: "hover:border-[#10B981]",
    text: "text-[#34D399]",
  },
  rejected: {
    dot: "bg-[#EF4444]",
    glow: "shadow-[0_0_8px_rgba(239,68,68,0.4)]",
    pill: "text-[#FF95A5] bg-[#EF4444]/15 border-[#EF4444]/30",
    border: "border-[#EF4444]/30",
    hover: "hover:border-[#EF4444]",
    text: "text-[#FF95A5]",
  },
  withdrawn: {
    dot: "bg-[#94A3B8]",
    glow: "",
    pill: "text-[#CBD5E1] bg-[#94A3B8]/15 border-[#94A3B8]/30",
    border: "border-[#94A3B8]/30",
    hover: "hover:border-[#94A3B8]",
    text: "text-[#CBD5E1]",
  },
};

function daysAgo(ms: number | null | undefined) {
  if (!ms) return "—";
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function dateKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function Pipeline() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [applications, setApplications] = useState<Application[]>([]);
  const [feed, setFeed] = useState<Feed>({ now: Date.now(), due: [], upcoming: [] });
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"board" | "list">("board");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [parserText, setParserText] = useState("");
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<ParsedDraft | null>(null);
  const [parserOpen, setParserOpen] = useState(false);
  const [parserInputOpen, setParserInputOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<"ai" | null>(null);
  const [aiPrompt, setAiPrompt] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [initialStage, setInitialStage] = useState<Stage | undefined>(undefined);
  const [initialDraft, setInitialDraft] = useState<ParsedDraft | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState("default");

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!aiPrompt) return;
    const timer = setTimeout(() => setAiPrompt(false), 6000);
    return () => clearTimeout(timer);
  }, [aiPrompt]);

  const settingsRef = useRef<SettingsPayload | null>(null);
  settingsRef.current = settings;

  const maybeNotify = useCallback((items: NotificationItem[]) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (
      settingsRef.current?.preferences &&
      settingsRef.current.preferences.notifications_enabled === false
    ) {
      return;
    }
    for (const item of items) {
      const key = `lockedin-notified:${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`;
      try {
        if (window.localStorage.getItem(key)) continue;
        window.localStorage.setItem(key, "1");
      } catch {
        // ignore storage failures
      }
      const options = { body: item.body || item.role, tag: key, icon: "/icon.svg" };
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.ready
          .then((registration) => registration.showNotification(item.title, options))
          .catch(() => new Notification(item.title, options));
      } else {
        new Notification(item.title, options);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const [appsResponse, statsResponse, feedResponse] = await Promise.all([
      api<{ applications: Application[] }>("/api/applications"),
      api<Stats>("/api/stats"),
      api<Feed>("/api/notifications"),
    ]);
    setApplications(appsResponse.applications || []);
    setStats(statsResponse);
    setFeed(feedResponse);
    maybeNotify(feedResponse.due || []);
  }, [maybeNotify]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const statusPayload = await api<StatusPayload>("/api/status");
        const settingsPayload = await api<SettingsPayload>("/api/settings").catch(() => null);
        if (cancelled) return;
        setStatus(statusPayload);
        setSettings(settingsPayload);
        if (!statusPayload.authenticated) {
          router.replace("/");
          return;
        }
        await refresh();
        if (cancelled) return;
        const params = new URLSearchParams(window.location.search);
        const appId = params.get("application");
        if (appId) setDetailId(appId);
        if (params.get("settings") === "1") setSettingsOpen(true);
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not reach the server.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, refresh, router]);

  useEffect(() => {
    if (!status?.authenticated) return;
    const timer = setInterval(() => {
      api<Feed>("/api/notifications")
        .then((payload) => {
          setFeed(payload);
          maybeNotify(payload.due || []);
        })
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(timer);
  }, [status?.authenticated, maybeNotify]);

  useEffect(() => {
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  async function handleSaved() {
    try {
      await refresh();
    } catch {
      // best-effort
    }
    try {
      setStatus(await api<StatusPayload>("/api/status"));
      setSettings(await api<SettingsPayload>("/api/settings"));
    } catch {
      // best-effort
    }
  }

  function openAdd(stage?: Stage) {
    setEditing(null);
    setInitialStage(stage);
    setInitialDraft(null);
    setAppModalOpen(true);
  }

  function requestAiSetup() {
    setAiPrompt(true);
    setSettingsFocus("ai");
    setSettingsOpen(true);
  }

  function openPasteDraft() {
    setSettingsFocus(null);
    setParseError("");
    setParserInputOpen(true);
  }

  async function runParse() {
    if (!parserText.trim()) {
      notify("Paste a recruiter email first.", "error");
      return;
    }
    setParsing(true);
    setParseError("");
    try {
      const result = await api<ParsedDraft>("/api/parse-email", {
        method: "POST",
        body: { raw_text: parserText, parser_mode: "llm" },
      });
      setParserInputOpen(false);
      setDraft(result);
      setParserOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse the email.";
      setParseError(message);
      notify(message, "error");
      if (/ai provider/i.test(message)) {
        setParserInputOpen(false);
        requestAiSetup();
      }
    } finally {
      setParsing(false);
    }
  }

  async function confirmDraft() {
    if (!draft) return;
    setSavingDraft(true);
    try {
      const created = await api<Application>("/api/applications", {
        method: "POST",
        body: {
          company: draft.company,
          role: draft.role,
          location: draft.location,
          source: "Parsed email",
          stage: draft.stage,
          applied_at: draft.applied_at ?? draft.received_at,
          check_back_at: draft.check_back_at,
          check_back_source: draft.check_back_source,
          next_action: draft.next_action,
          next_action_at: draft.next_action_at,
        },
      });
      await api(`/api/applications/${created.id}/emails`, {
        method: "POST",
        body: {
          raw_text: parserText,
          subject: draft.subject,
          from_email: draft.from_email,
          apply: false,
        },
      }).catch(() => undefined);
      setParserOpen(false);
      setParserText("");
      setDraft(null);
      notify("Parsed email added to the pipeline", "success");
      await handleSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add the draft.", "error");
    } finally {
      setSavingDraft(false);
    }
  }

  function editDraft() {
    if (!draft) return;
    setParserOpen(false);
    setEditing(null);
    setInitialStage(draft.stage);
    setInitialDraft(draft);
    setAppModalOpen(true);
  }

  async function enableNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      notify("This browser does not support notifications.", "error");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      notify("Browser notifications enabled", "success");
      maybeNotify(feed.due || []);
    } else {
      notify("Notifications were not enabled.", "error");
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      applications.filter((app) => {
        if (!query) return true;
        return `${app.company} ${app.role} ${app.location} ${app.next_action}`
          .toLowerCase()
          .includes(query);
      }),
    [applications, query],
  );

  const byStage = useMemo(() => {
    const grouped: Record<string, Application[]> = {};
    for (const stage of BOARD_STAGES) grouped[stage] = [];
    for (const app of filtered) {
      if (grouped[app.stage]) grouped[app.stage].push(app);
    }
    return grouped;
  }, [filtered]);

  const closed = useMemo(() => applications.filter((app) => app.status === "closed"), [applications]);
  const cadenceItems = useMemo(() => {
    const map = new Map<string, NotificationItem>();
    for (const item of [...feed.due, ...feed.upcoming]) {
      map.set(`${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`, item);
    }
    return Array.from(map.values()).sort((a, b) => a.due_at - b.due_at);
  }, [feed]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <div className="flex flex-col items-center gap-3 text-cream-muted">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-cyan/30 border-t-cyan" />
          <p className="text-xs tracking-wide">Loading your pipeline…</p>
        </div>
      </div>
    );
  }

  if (!status?.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <p className="text-sm text-cream-muted">Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base text-cream">
      {aiPrompt && (
        <div className="fixed left-1/2 top-4 z-[80] w-[min(94vw,460px)] -translate-x-1/2 animate-rise-in">
          <div className="flex items-center gap-3 rounded-xl border border-cyan/40 bg-[#0c101b]/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
              <Icon name="key" className="text-[16px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-cream">Connect an AI provider first</p>
              <p className="text-[10px] text-cream-muted">
                Paste &amp; Draft needs an API key to read emails.
              </p>
            </div>
            <button
              onClick={() => {
                setSettingsFocus("ai");
                setSettingsOpen(true);
                setAiPrompt(false);
              }}
              className="shrink-0 rounded-lg bg-cyan px-3 py-1.5 text-[10px] font-semibold text-[#07131b] transition hover:bg-cyan/90"
            >
              Open settings
            </button>
            <button
              onClick={() => setAiPrompt(false)}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1 text-cream-muted transition hover:bg-white/5 hover:text-cream"
            >
              <Icon name="close" className="text-[14px]" />
            </button>
          </div>
        </div>
      )}

      <header className="fixed top-0 z-50 w-full border-b border-border/50 bg-base/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-[1920px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-8 xl:gap-12">
            <a className="group flex items-center gap-3" href="/app">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-steel/50 bg-steel/30 text-cyan shadow-sm transition-colors group-hover:border-cyan">
                <Icon name="terminal" className="text-[17px]" />
              </div>
              <span className="font-display text-xl font-bold tracking-tight text-cream">LockedIn</span>
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <a
              href="/api/calendar.ics"
              className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-cream-muted transition-all hover:border-steel hover:text-cream sm:flex"
            >
              <Icon name="calendar_today" className="text-[16px] text-cyan" />
              <span className="hidden lg:inline">Sync ICS</span>
            </a>
            <button
              onClick={() => openAdd()}
              className="flex items-center gap-2 rounded-lg border border-cyan/40 bg-gradient-to-r from-steel to-steel-dim px-3 py-2 text-sm font-medium text-cream shadow-md transition-all hover:border-cyan sm:px-4"
            >
              <Icon name="add" className="text-[16px] text-cyan" />
              <span className="hidden sm:inline">Add Application</span>
            </button>
            <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-raised text-cyan transition-colors hover:border-cyan"
              title="Settings"
            >
              <Icon name="settings" className="text-[16.5px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-screen w-full max-w-[1920px] px-4 pb-10 pt-24 sm:px-6 lg:px-12">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="relative w-full sm:w-80">
              <Icon
                name="search"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] text-cream-muted/60"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-xl border border-border bg-surface/90 py-2 pl-10 pr-4 text-sm text-cream placeholder:text-cream-muted/50 focus:border-cyan focus:outline-none"
                placeholder="Search roles, companies..."
                type="text"
              />
            </div>
            <div className="flex items-center rounded-xl border border-border bg-surface p-1">
              <button
                onClick={() => setMode("board")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                  mode === "board"
                    ? "border border-border/80 bg-surface-raised text-cyan"
                    : "text-cream-muted hover:text-cream"
                }`}
              >
                <Icon name="view_kanban" className="text-[14px]" />
                <span>Board</span>
              </button>
              <button
                onClick={() => setMode("list")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                  mode === "list"
                    ? "border border-border/80 bg-surface-raised text-cyan"
                    : "text-cream-muted hover:text-cream"
                }`}
              >
                <Icon name="table_rows" className="text-[14px]" />
                <span>List</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-cream-muted">
            <SummaryDot stage="applied" label="Applied" value={stats.by_stage?.applied || 0} suffix="roles" />
            <SummaryDot stage="assessment" label="Assessment" value={stats.by_stage?.assessment || 0} suffix="pending" />
            <SummaryDot stage="interview" label="Interviews" value={stats.by_stage?.interview || 0} suffix="active" />
            <SummaryDot stage="offer" label="Offers" value={stats.by_stage?.offer || 0} suffix="active" />
          </div>
        </div>

        <div
          id="parser-banner"
          className="relative mb-6 overflow-hidden rounded-2xl border border-border/80 bg-surface/70 p-4 backdrop-blur-md lg:p-5"
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-steel/10 blur-3xl" />
          <div className="relative z-10 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-steel/40 bg-steel/20 text-cyan">
                <Icon name="auto_awesome" className="text-[17px]" />
              </div>
              <div>
                <div className="mb-0.5 flex items-center gap-3">
                  <h2 className="font-display text-sm font-semibold tracking-tight text-cream">
                    Smart Recruiter Parser
                  </h2>
                  <span className="rounded-md border border-cyan/30 bg-cyan/15 px-2 py-0.5 text-[9px] font-semibold text-cyan">
                    Auto Extract
                  </span>
                </div>
                <p className="max-w-2xl text-xs leading-relaxed text-cream-muted">
                  Paste recruiter email text, screening links, or assessment invitations to
                  automatically structure stage, deadlines, and cadence follow-ups.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={openPasteDraft}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-cyan px-4 py-2.5 text-xs font-semibold text-on-primary-container shadow-sm transition-all hover:bg-cyan/90"
              >
                <Icon name="content_paste" className="text-[13px]" />
                <span>Paste &amp; Draft</span>
              </button>
            </div>
          </div>
        </div>

        {mode === "board" ? (
          <>
            <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {BOARD_STAGES.map((stage) => {
                const meta = COLUMN_META[stage];
                const items = byStage[stage] || [];
                const isExpanded = Boolean(expanded[stage]);
                const visible = isExpanded ? items : items.slice(0, 3);
                return (
                  <section
                    key={stage}
                    className="flex flex-col gap-3.5 rounded-2xl border border-border/40 bg-surface/30 p-4"
                  >
                    <div className="flex items-center justify-between border-b border-border/40 px-1 pb-2">
                      <div className="flex items-center gap-2.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} ${meta.glow}`} />
                        <h3 className="font-display text-sm font-semibold tracking-wide text-cream">
                          {STAGE_LABELS[stage]}
                        </h3>
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.pill}`}>
                          {items.length}
                        </span>
                      </div>
                      <button
                        onClick={() => openAdd(stage)}
                        className="text-cream-muted transition-colors hover:text-cyan"
                        title={`Add to ${STAGE_LABELS[stage]}`}
                      >
                        <Icon name="add" className="text-[16px]" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-3">
                      {items.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border/50 bg-surface/20 px-3 py-7 text-center">
                          <p className="text-[10px] text-cream-muted/60">No applications here yet.</p>
                          <button
                            onClick={() => openAdd(stage)}
                            className="mt-1.5 text-[10px] font-semibold text-cyan/80 hover:text-cyan"
                          >
                            Add one
                          </button>
                        </div>
                      ) : (
                        visible.map((app) => (
                          <BoardCard
                            key={app.id}
                            app={app}
                            meta={meta}
                            onOpen={() => setDetailId(app.id)}
                          />
                        ))
                      )}
                    </div>

                    {items.length > 3 && (
                      <button
                        onClick={() => setExpanded((current) => ({ ...current, [stage]: !isExpanded }))}
                        className="cursor-pointer py-1.5 text-center text-xs text-cream-muted/70 transition-colors hover:text-cream-muted"
                      >
                        {isExpanded ? "Show less" : `+${items.length - 3} more in ${STAGE_LABELS[stage].toLowerCase()}`}
                      </button>
                    )}
                  </section>
                );
              })}
            </div>

            {closed.length > 0 && (
              <button
                onClick={() => {
                  setMode("list");
                  setSearch("");
                }}
                className="mt-4 flex w-full items-center justify-between rounded-xl border border-border/50 bg-surface/30 px-4 py-3 text-left transition hover:border-steel"
              >
                <span className="flex items-center gap-2 text-xs text-cream-muted">
                  <Icon name="archive" className="text-[15px] text-cream-muted/70" />
                  Closed applications
                  <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[9px] font-semibold text-cream-muted">
                    {closed.length}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-cyan">
                  View in list <Icon name="arrow_forward" className="text-[12.5px]" />
                </span>
              </button>
            )}
          </>
        ) : (
          <ListView
            applications={filtered}
            onOpen={setDetailId}
            onAdd={() => openAdd()}
            onShowBoard={() => setMode("board")}
          />
        )}
      </main>

      <button
        onClick={() => setCadenceOpen(true)}
        className="group fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-cyan/50 bg-gradient-to-r from-steel to-steel-dim text-cyan shadow-xl transition-all hover:scale-105 hover:border-cyan"
        title="Upcoming cadence"
      >
        <Icon name="calendar_today" className="text-[22px] text-cyan transition-all group-hover:brightness-110" />
        {cadenceItems.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 animate-pulse items-center justify-center rounded-full border-2 border-base bg-rose text-[10px] font-bold text-base">
            {cadenceItems.length}
          </span>
        )}
      </button>

      <CadenceDrawer
        open={cadenceOpen}
        items={cadenceItems}
        due={feed.due}
        permission={notificationPermission}
        onEnable={enableNotifications}
        onClose={() => setCadenceOpen(false)}
        onOpen={(id) => {
          setCadenceOpen(false);
          setDetailId(id);
        }}
      />

      <ParserInputModal
        open={parserInputOpen}
        value={parserText}
        onChange={(value) => {
          setParserText(value);
          if (parseError) setParseError("");
        }}
        parsing={parsing}
        error={parseError}
        aiReady={Boolean(settings?.preferences?.llm_api_key_set)}
        onClose={() => {
          setParserInputOpen(false);
          setParseError("");
        }}
        onSubmit={runParse}
      />

      <ParserPreview
        open={parserOpen}
        draft={draft}
        raw={parserText}
        saving={savingDraft}
        onClose={() => setParserOpen(false)}
        onEdit={editDraft}
        onConfirm={confirmDraft}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocus(null);
        }}
        authenticated
        focusSection={settingsFocus}
        onSaved={async () => {
          await handleSaved();
          setSettingsFocus(null);
        }}
        notify={notify}
      />
      <ApplicationModal
        open={appModalOpen}
        application={editing}
        initialStage={initialStage}
        initialDraft={initialDraft}
        onClose={() => {
          setAppModalOpen(false);
          setEditing(null);
          setInitialStage(undefined);
          setInitialDraft(null);
        }}
        onSaved={handleSaved}
        notify={notify}
      />
      <DetailModal
        applicationId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={handleSaved}
        onEdit={(app) => {
          setDetailId(null);
          setEditing(app);
          setInitialStage(undefined);
          setInitialDraft(null);
          setAppModalOpen(true);
        }}
        notify={notify}
      />
      {toast && <Toast {...toast} />}
    </div>
  );
}

function SummaryDot({
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
  const meta = COLUMN_META[stage];
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${meta.dot} ${meta.glow}`} />
      <span>
        {label}: <strong className={`font-semibold ${meta.text}`}>{value} {suffix}</strong>
      </span>
    </div>
  );
}

function BoardCard({
  app,
  meta,
  onOpen,
}: {
  app: Application;
  meta: (typeof COLUMN_META)[Stage];
  onOpen: () => void;
}) {
  const now = Date.now();
  const checkDue = Boolean(app.check_back_at && app.check_back_at <= now);
  const actionDue = Boolean(app.next_action_at && app.next_action_at <= now);
  const urgent = checkDue || actionDue;

  return (
    <button
      onClick={onOpen}
      className={`group flex w-full cursor-pointer flex-col gap-2.5 rounded-xl border bg-surface p-4 text-left shadow-sm transition-all hover:bg-surface-raised/60 ${
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
          {app.stage === "applied" ? `Applied ${daysAgo(app.applied_at)}` : app.source || "—"}
        </span>
      </div>
    </button>
  );
}

function ListView({
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
          const overdue = Boolean(app.check_back_at && app.check_back_at <= Date.now() && app.status === "active");
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

function ParserInputModal({
  open,
  value,
  onChange,
  parsing,
  error,
  aiReady,
  onClose,
  onSubmit,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  parsing: boolean;
  error: string;
  aiReady: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
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
              Paste the full email body. The AI provider extracts the role, stage, and deadlines.
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
            className="min-h-[46vh] w-full resize-y rounded-xl border border-border bg-[#070b13] px-4 py-3 font-mono text-[11.5px] leading-relaxed text-cream/90 placeholder:text-cream-muted/40 focus:border-cyan focus:outline-none"
          />
        </div>

        {(error || !aiReady) && (
          <div className="mx-6 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            {error || "No AI provider connected yet. Add an API key in Settings before parsing."}
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

function ParserPreview({
  open,
  draft,
  raw,
  saving,
  onClose,
  onEdit,
  onConfirm,
}: {
  open: boolean;
  draft: ParsedDraft | null;
  raw: string;
  saving: boolean;
  onClose: () => void;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  if (!open || !draft) return null;
  const meta = COLUMN_META[draft.stage];
  const excerpt = raw.trim().replace(/\s+/g, " ").slice(0, 180);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="animate-rise-in flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border/80 bg-surface p-6 text-left shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <Icon name="auto_awesome" className="text-[16px] text-cyan" />
            <h3 className="font-display text-sm font-semibold tracking-wide text-cream">Smart Parser Draft</h3>
            <span className="rounded-full border border-cyan/30 bg-cyan/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan">
              Preview ready
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-cream-muted/60 transition-colors hover:bg-surface-raised hover:text-cream">
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>

        <div className="rounded-xl border border-cyan/10 bg-surface-container-lowest p-3 text-xs italic leading-relaxed text-cream/70">
          “{excerpt}{raw.trim().length > 180 ? "…" : ""}”
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <FieldBox label="Company" value={draft.company || "—"} />
          <FieldBox label="Role" value={draft.role || "—"} />
          <div className="rounded-lg border border-border/50 bg-surface-raised p-2.5">
            <span className="mb-0.5 block text-[9px] font-medium text-cream-muted/60">Target stage</span>
            <span className={`flex items-center gap-1 font-semibold ${meta.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {STAGE_LABELS[draft.stage]}
            </span>
          </div>
          <FieldBox
            label="Auto cadence"
            value={draft.check_back_at ? `${fmtDate(draft.check_back_at)} · ${relative(draft.check_back_at)}` : "No check-back"}
            accent
          />
        </div>

        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[9px] text-cream-muted/70">
          <span className="capitalize">{draft.parser} parser · {Math.round(draft.confidence * 100)}% confidence</span>
          {draft.evidence.length > 0 && <span className="truncate pl-3">{draft.evidence[0]}</span>}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border/40 pt-2">
          <button onClick={onEdit} className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-cream-muted transition-colors hover:bg-surface-raised hover:text-cream">
            Edit details
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-1.5 text-xs font-semibold text-on-primary-container shadow-md transition-all hover:bg-cyan/90 disabled:opacity-60"
          >
            {saving ? <SpinnerLabel label="Adding" /> : <><Icon name="check_circle" className="text-[12.5px]" /> Confirm &amp; Add</>}
          </button>
        </div>
      </div>
    </div>
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

function CadenceDrawer({
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
  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-base/70 backdrop-blur-sm sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="animate-slide-in-right flex h-full max-h-[92vh] w-full flex-col gap-5 overflow-y-auto border-l border-border/80 bg-surface p-6 shadow-2xl sm:max-h-screen sm:w-[420px] sm:rounded-l-2xl">
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
              const meta = COLUMN_META[item.stage];
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
    </div>
  );
}

function Toast({ message, tone }: { message: string; tone: "success" | "error" }) {
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
      </div>
    </div>
  );
}
