"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, api } from "@/lib/client";
import type {
  Application,
  NotificationItem,
  ParsedDraft,
  Stage,
  Stats,
  UserPreferences,
} from "@/lib/types";
import { STAGE_LABELS, TERMINAL_STAGES } from "@/lib/types";
import { ApplicationModal } from "@/components/ApplicationModal";
import { DetailModal } from "@/components/DetailModal";
import { SettingsModal } from "@/components/SettingsModal";
import {
  BoardCard,
  CadenceDrawer,
  ListView,
  ParserInputModal,
  ParserPreview,
  SummaryDot,
  Toast,
  TodayAgenda,
} from "@/components/PipelineViews";
import {
  agendaBuckets,
  columnMeta,
  compareUrgency,
  isOverdue,
  splitEmailThread,
} from "@/components/pipeline-utils";
import { Icon } from "@/components/ui";

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
  by_stage: { saved: 0, applied: 0, assessment: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 },
  total: 0,
  active: 0,
  due: 0,
  upcoming: 0,
};

const BOARD_STAGES: Stage[] = ["saved", "applied", "assessment", "interview", "offer"];

export function Pipeline() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [connectionError, setConnectionError] = useState("");
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
  const [draftRaw, setDraftRaw] = useState("");
  const [draftQueue, setDraftQueue] = useState<Array<{ draft: ParsedDraft; raw: string }>>([]);
  const [draftIndex, setDraftIndex] = useState(0);
  const [parseMode, setParseMode] = useState("auto");
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
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error";
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [notificationPermission, setNotificationPermission] = useState("default");

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  }, []);

  const notifyUndo = useCallback((message: string, onClick: () => void) => {
    setToast({ message, tone: "success", action: { label: "Undo", onClick } });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 7000 : 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!aiPrompt) return;
    const timer = setTimeout(() => setAiPrompt(false), 6000);
    return () => clearTimeout(timer);
  }, [aiPrompt]);

  useEffect(() => {
    const saved = settings?.preferences?.parser_mode;
    if (saved) setParseMode(saved);
  }, [settings?.preferences?.parser_mode]);

  const settingsRef = useRef<SettingsPayload | null>(null);
  settingsRef.current = settings;
  const firstFeedRef = useRef(true);
  const notifyInFlightRef = useRef(false);

  const maybeNotify = useCallback(async (items: NotificationItem[], batch = false) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (
      settingsRef.current?.preferences &&
      settingsRef.current.preferences.notifications_enabled === false
    ) {
      return;
    }
    if (notifyInFlightRef.current) return;
    notifyInFlightRef.current = true;
    try {
      const cutoff = Date.now() - 14 * 86_400_000;
      const prefix = "lockedin-notified:";
      try {
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (!key?.startsWith(prefix)) continue;
          const dueAt = Number(key.split(":").pop());
          if (!Number.isFinite(dueAt) || dueAt < cutoff) window.localStorage.removeItem(key);
        }
      } catch {
        // ignore storage failures
      }

      const pending = items.filter((item) => {
        const key = `${prefix}${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`;
        try {
          return !window.localStorage.getItem(key);
        } catch {
          return true;
        }
      });
      if (pending.length === 0) return;

      const show = async (title: string, options: NotificationOptions): Promise<boolean> => {
        try {
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(title, options);
          } else {
            new Notification(title, options);
          }
          return true;
        } catch {
          return false;
        }
      };

      if (batch && pending.length > 1) {
        const names = pending
          .slice(0, 3)
          .map((item) => item.company || item.role)
          .join(", ");
        const shown = await show(`${pending.length} deadlines need attention`, {
          body: `${names}${pending.length > 3 ? ` and ${pending.length - 3} more` : ""}`,
          tag: "lockedin-batch",
          icon: "/icon.svg",
        });
        if (!shown) return;
      } else {
        for (const item of pending) {
          const key = `${prefix}${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`;
          const shown = await show(item.title, {
            body: item.body || item.role,
            tag: key,
            icon: "/icon.svg",
          });
          if (!shown) return;
        }
      }

      try {
        for (const item of pending) {
          const key = `${prefix}${item.application_id}:${item.reminder_id || item.kind}:${item.due_at}`;
          window.localStorage.setItem(key, "1");
        }
      } catch {
        // ignore storage failures
      }
    } finally {
      notifyInFlightRef.current = false;
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
    setConnectionError("");
    const batch = firstFeedRef.current;
    firstFeedRef.current = false;
    void maybeNotify(feedResponse.due || [], batch);
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
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not reach the server.");
        }
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
    const poll = () => {
      if (document.hidden) return;
      api<Feed>("/api/notifications")
        .then((payload) => {
          setFeed(payload);
          setConnectionError("");
          void maybeNotify(payload.due || []);
        })
        .catch((error) => {
          setConnectionError(
            error instanceof Error ? error.message : "Could not reach the server. Retrying…",
          );
        });
    };
    const timer = setInterval(poll, 60_000);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status?.authenticated, maybeNotify]);

  useEffect(() => {
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  async function handleSaved() {
    const [, statusPayload, settingsPayload] = await Promise.all([
      refresh().catch(() => null),
      api<StatusPayload>("/api/status").catch(() => null),
      api<SettingsPayload>("/api/settings").catch(() => null),
    ]);
    if (statusPayload) setStatus(statusPayload);
    if (settingsPayload) setSettings(settingsPayload);
  }

  async function restoreApplication(before: Application) {
    setApplications((current) =>
      current.map((app) => (app.id === before.id ? before : app)),
    );
    try {
      const updated = await api<Application>(`/api/applications/${before.id}`, {
        method: "PATCH",
        body: {
          stage: before.stage,
          status: before.status,
          action_state: before.action_state,
          next_action: before.next_action,
          next_action_at: before.next_action_at,
          check_back_at: before.check_back_at,
          check_back_source: before.check_back_source,
          applied_at: before.applied_at,
        },
      });
      setApplications((current) =>
        current.map((app) => (app.id === before.id ? updated : app)),
      );
      notify("Move undone");
      void handleSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not undo the move.", "error");
      void handleSaved();
    }
  }

  async function restoreTrash(trashId: string) {
    try {
      const result = await api<{ kind: "application" | "email" }>(
        `/api/trash/${trashId}/restore`,
        { method: "POST" },
      );
      notify(result.kind === "application" ? "Application restored" : "Email restored", "success");
      setDetailRefresh((version) => version + 1);
      await handleSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not restore the item.", "error");
    }
  }

  function handleDeleted(application: Application, trashId: string) {
    notifyUndo(`${application.company || "Application"} deleted`, () => {
      void restoreTrash(trashId);
    });
  }

  function handleEmailDeleted(_email: unknown, trashId: string) {
    notifyUndo("Email deleted", () => {
      void restoreTrash(trashId);
    });
  }

  async function snoozeApplication(app: Application, days: number) {
    try {
      const updated = await api<Application>(`/api/applications/${app.id}/snooze`, {
        method: "POST",
        body: { days },
      });
      setApplications((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      notify(`Snoozed ${app.company || "application"} ${days} day${days === 1 ? "" : "s"}`);
      void handleSaved();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not snooze the application.", "error");
    }
  }

  async function markFollowedUp(app: Application) {
    try {
      const updated = await api<Application>(`/api/applications/${app.id}/outcome`, {
        method: "POST",
        body: { outcome: "follow_up" },
      });
      setApplications((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      notify(`Follow-up logged for ${app.company || "application"}`);
      void handleSaved();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not log the follow-up.",
        "error",
      );
    }
  }

  async function moveApplication(appId: string, stage: Stage) {
    const current = applications.find((app) => app.id === appId);
    if (!current || current.stage === stage) return;
    const before = { ...current };
    const terminal = TERMINAL_STAGES.has(stage);
    setApplications((apps) =>
      apps.map((app) =>
        app.id === appId
          ? {
              ...app,
              stage,
              status: terminal ? "closed" : app.status,
              check_back_at: terminal ? null : app.check_back_at,
              next_action_at: terminal ? null : app.next_action_at,
            }
          : app,
      ),
    );
    setDragId(null);
    setDragOverStage(null);
    try {
      const updated = await api<Application>(`/api/applications/${appId}`, {
        method: "PATCH",
        body: { stage },
      });
      setApplications((apps) => apps.map((app) => (app.id === appId ? updated : app)));
      notifyUndo(`Moved to ${STAGE_LABELS[stage]}`, () => {
        void restoreApplication(before);
      });
      void handleSaved();
    } catch (error) {
      setApplications((apps) => apps.map((app) => (app.id === appId ? before : app)));
      notify(error instanceof Error ? error.message : "Could not move the application.", "error");
    }
  }

  function moveByKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    app: Application,
  ) {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const index = BOARD_STAGES.indexOf(app.stage);
    if (index === -1) return;
    const next = BOARD_STAGES[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    void moveApplication(app.id, next);
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
      const segments = splitEmailThread(parserText);
      const parsed: Array<{ draft: ParsedDraft; raw: string }> = [];
      for (const segment of segments) {
        const result = await api<ParsedDraft>("/api/parse-email", {
          method: "POST",
          body: { raw_text: segment, parser_mode: parseMode },
        });
        parsed.push({ draft: result, raw: segment });
      }
      const first = parsed[0];
      setParserInputOpen(false);
      setDraft(first.draft);
      setDraftRaw(first.raw);
      setDraftQueue(parsed.slice(1));
      setDraftIndex(0);
      setParserOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse the email.";
      setParseError(message);
      notify(message, "error");
      if (error instanceof ApiClientError && error.code === "LLM_NOT_CONFIGURED") {
        setParserInputOpen(false);
        requestAiSetup();
      }
    } finally {
      setParsing(false);
    }
  }

  async function confirmDraft(mode: "update" | "create") {
    if (!draft) return;
    setSavingDraft(true);
    const raw = draftRaw || parserText;
    const updateId =
      mode === "update" ? draft.matched_application?.id || null : null;
    try {
      const payload = {
        company: draft.company,
        role: draft.role,
        location: draft.location,
        stage: draft.stage,
        applied_at: draft.stage === "saved" ? null : draft.applied_at ?? draft.received_at,
        apply_by: draft.apply_by,
        check_back_at: draft.check_back_at,
        check_back_source: draft.check_back_source,
        next_action: draft.next_action,
        next_action_at: draft.next_action_at,
        notes: draft.evidence.length ? `Parsed evidence: ${draft.evidence.join(" · ")}` : "",
      };
      const target = updateId
        ? await api<Application>(`/api/applications/${updateId}`, {
            method: "PATCH",
            body: {
              company: payload.company,
              role: payload.role,
              location: payload.location,
              stage: payload.stage,
              apply_by: payload.apply_by,
              check_back_at: payload.check_back_at,
              check_back_source: payload.check_back_source,
              next_action: payload.next_action,
              next_action_at: payload.next_action_at,
            },
          })
        : await api<Application>("/api/applications", {
            method: "POST",
            body: { ...payload, source: "Parsed email" },
          });
      let emailAttached = true;
      try {
        await api(`/api/applications/${target.id}/emails`, {
          method: "POST",
          body: {
            raw_text: raw,
            subject: draft.subject,
            from_email: draft.from_email,
            apply: false,
          },
        });
      } catch {
        emailAttached = false;
      }
      const remaining = draftQueue;
      if (remaining.length > 0) {
        const next = remaining[0];
        setDraft(next.draft);
        setDraftRaw(next.raw);
        setDraftQueue(remaining.slice(1));
        setDraftIndex((index) => index + 1);
        notify(
          emailAttached
            ? `${updateId ? "Updated" : "Added"} ${draft.company} · ${remaining.length} left`
            : "Added, but the email could not be attached to the timeline.",
          emailAttached ? "success" : "error",
        );
        await handleSaved();
        return;
      }
      setParserOpen(false);
      setParserText("");
      setDraft(null);
      setDraftRaw("");
      setDraftIndex(0);
      notify(
        !emailAttached
          ? "Draft added, but the email could not be attached to the timeline."
          : updateId
            ? `Updated ${target.company} from the parsed email`
            : "Parsed email added to the pipeline",
        emailAttached ? "success" : "error",
      );
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
        return [
          app.company,
          app.role,
          app.location,
          app.source,
          app.next_action,
          app.notes,
          app.job_url,
          STAGE_LABELS[app.stage],
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      }),
    [applications, query],
  );

  const byStage = useMemo(() => {
    const grouped: Record<string, Application[]> = {};
    for (const stage of BOARD_STAGES) grouped[stage] = [];
    for (const app of filtered) {
      const stage = grouped[app.stage] ? app.stage : "applied";
      grouped[stage].push(app);
    }
    for (const stage of BOARD_STAGES) grouped[stage].sort(compareUrgency);
    return grouped;
  }, [filtered]);

  const agenda = useMemo(
    () => agendaBuckets(applications, feed.now || Date.now()),
    [applications, feed.now],
  );
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

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="font-display text-lg font-bold text-cream">Could not load your pipeline</p>
          <p className="mt-2 text-xs leading-relaxed text-cream-muted">
            {loadError || "The server did not respond."}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-cyan/40 bg-cyan/10 px-4 py-2 text-xs font-semibold text-cyan hover:bg-cyan/20"
            >
              Retry
            </button>
            <a href="/" className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-cream-muted hover:text-cream">
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!status.authenticated) {
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
        {connectionError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>{connectionError}</span>
            <button
              type="button"
              onClick={() => void refresh().catch(() => undefined)}
              className="shrink-0 font-semibold text-amber-100 hover:text-white"
            >
              Retry now
            </button>
          </div>
        )}
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
            <SummaryDot stage="saved" label="Saved" value={stats.by_stage?.saved || 0} suffix="roles" />
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
            <TodayAgenda
              buckets={agenda}
              onOpen={setDetailId}
              onSnooze={(app, days) => void snoozeApplication(app, days)}
              onFollowedUp={(app) => void markFollowedUp(app)}
            />
            <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-5">
              {BOARD_STAGES.map((stage) => {
                const meta = columnMeta(stage);
                const items = byStage[stage] || [];
                const isExpanded = Boolean(expanded[stage]);
                const urgentCount = items.filter(isOverdue).length;
                const visible = isExpanded
                  ? items
                  : items.slice(0, Math.max(3, urgentCount));
                return (
                  <section
                    key={stage}
                    data-stage={stage}
                    onDragOver={(event) => {
                      if (!dragId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverStage(stage);
                    }}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && event.currentTarget.contains(next)) return;
                      setDragOverStage((current) => (current === stage ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData("text/plain") || dragId;
                      setDragId(null);
                      setDragOverStage(null);
                      if (id) void moveApplication(id, stage);
                    }}
                    className={`flex flex-col gap-3.5 rounded-2xl border bg-surface/30 p-4 transition-colors ${
                      dragOverStage === stage
                        ? "border-cyan/60 bg-cyan/5"
                        : "border-border/40"
                    }`}
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
                            dragging={dragId === app.id}
                            onOpen={() => setDetailId(app.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", app.id);
                              event.dataTransfer.effectAllowed = "move";
                              setDragId(app.id);
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setDragOverStage(null);
                            }}
                            onKeyDown={(event) => moveByKeyboard(event, app)}
                          />
                        ))
                      )}
                    </div>

                    {(items.length > visible.length || (isExpanded && items.length > 3)) && (
                      <button
                        onClick={() => setExpanded((current) => ({ ...current, [stage]: !isExpanded }))}
                        className="cursor-pointer py-1.5 text-center text-xs text-cream-muted/70 transition-colors hover:text-cream-muted"
                      >
                        {isExpanded ? "Show less" : `+${items.length - visible.length} more in ${STAGE_LABELS[stage].toLowerCase()}`}
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
        className="group fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-cyan/50 bg-gradient-to-r from-steel to-steel-dim text-cyan shadow-xl transition-all hover:scale-105 hover:border-cyan sm:bottom-8 sm:right-8"
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
        mode={parseMode}
        onModeChange={(value) => setParseMode(value)}
        onClose={() => {
          setParserInputOpen(false);
          setParseError("");
        }}
        onSubmit={runParse}
      />

      <ParserPreview
        open={parserOpen}
        draft={draft}
        raw={draftRaw || parserText}
        saving={savingDraft}
        position={draftIndex}
        total={draftIndex + draftQueue.length + 1}
        onClose={() => {
          setParserOpen(false);
          setDraftQueue([]);
          setDraftRaw("");
          setDraftIndex(0);
        }}
        onEdit={editDraft}
        onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
        onConfirm={(mode) => void confirmDraft(mode)}
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
        defaultFollowUpDays={settings?.preferences?.default_follow_up_days || 7}
        onClose={() => {
          setAppModalOpen(false);
          setEditing(null);
          setInitialStage(undefined);
          setInitialDraft(null);
        }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        notify={notify}
      />
      <DetailModal
        applicationId={detailId}
        refreshToken={detailRefresh}
        onClose={() => setDetailId(null)}
        onChanged={handleSaved}
        onEmailDeleted={handleEmailDeleted}
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
