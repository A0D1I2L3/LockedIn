"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { Icon, Modal, SpinnerLabel } from "@/components/ui";
import { normalizeTimezone } from "@/lib/time";

const TIMEZONE_FALLBACK = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function endpointKey(provider: string, baseUrl: string) {
  return `${provider.trim().toLowerCase()}|${baseUrl.trim().replace(/\/+$/, "").toLowerCase()}`;
}

const inputClass =
  "h-[42px] w-full rounded-lg border border-[#1e2739] bg-[#070b13] px-3.5 py-2 text-[12.5px] text-cream outline-none transition-colors placeholder:text-text-tertiary focus:border-cyan";
const labelClass =
  "mb-1.5 block text-[9.5px] font-bold uppercase tracking-wider text-text-secondary";
const sectionTitleClass =
  "text-[10px] font-bold uppercase tracking-widest text-text-secondary";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  grok: { baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  claude: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
};

interface SettingsPayload {
  preferences?: {
    parser_mode: string;
    default_follow_up_days: number;
    timezone: string;
    notifications_enabled: boolean;
    push_enabled: boolean;
    digest_enabled: boolean;
    digest_time: string;
    quiet_hours_start: string;
    quiet_hours_end: string;
    reminder_channel: "auto" | "push" | "telegram" | "none";
    telegram_chat_id: string;
    llm_provider: string;
    llm_base_url: string;
    llm_model: string;
    llm_api_key_set?: boolean;
  };
}

export function SettingsModal({
  open,
  onClose,
  authenticated,
  onSaved,
  notify,
  focusSection = null,
}: {
  open: boolean;
  onClose: () => void;
  authenticated: boolean;
  onSaved: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
  focusSection?: "ai" | null;
}) {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_DEFAULTS.openai.baseUrl);
  const [model, setModel] = useState(PROVIDER_DEFAULTS.openai.model);
  const [apiKey, setApiKey] = useState("");
  const [parserMode, setParserMode] = useState("auto");
  const [followUpDays, setFollowUpDays] = useState(7);
  const [timezone, setTimezone] = useState("UTC");
  const [notifications, setNotifications] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [digestTime, setDigestTime] = useState("08:00");
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [reminderChannel, setReminderChannel] = useState<"auto" | "push" | "telegram" | "none">("auto");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarTokens, setCalendarTokens] = useState(0);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedEndpoint, setSavedEndpoint] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [permission, setPermission] = useState("default");
  const aiSectionRef = useRef<HTMLElement | null>(null);
  const endpointChanged =
    Boolean(savedEndpoint) && endpointKey(provider, baseUrl) !== savedEndpoint;
  const apiKeySet = Boolean(settings?.preferences?.llm_api_key_set);
  const timezoneOptions = useMemo(() => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    const values = intl.supportedValuesOf?.("timeZone") || TIMEZONE_FALLBACK;
    return Array.from(new Set([normalizeTimezone(timezone), ...values]));
  }, [timezone]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setTestResult(null);
    if ("Notification" in window) setPermission(Notification.permission);
    api<SettingsPayload>("/api/settings")
      .then((payload) => {
        setSettings(payload);
        const prefs = payload.preferences;
        if (prefs) {
          const nextProvider = prefs.llm_provider || "openai";
          const nextBaseUrl =
            prefs.llm_base_url || PROVIDER_DEFAULTS[nextProvider]?.baseUrl || "";
          setProvider(nextProvider);
          setBaseUrl(nextBaseUrl);
          setSavedEndpoint(endpointKey(nextProvider, nextBaseUrl));
          setModel(prefs.llm_model || PROVIDER_DEFAULTS[nextProvider]?.model || "");
          setParserMode(prefs.parser_mode || "auto");
          setFollowUpDays(prefs.default_follow_up_days || 7);
          setTimezone(normalizeTimezone(prefs.timezone || "UTC"));
          setNotifications(Boolean(prefs.notifications_enabled));
          setPushEnabled(prefs.push_enabled !== false);
          setDigestEnabled(prefs.digest_enabled !== false);
          setDigestTime(prefs.digest_time || "08:00");
          setQuietStart(prefs.quiet_hours_start ?? "22:00");
          setQuietEnd(prefs.quiet_hours_end ?? "07:00");
          setReminderChannel(prefs.reminder_channel || "auto");
          setTelegramChatId(prefs.telegram_chat_id || "");
        }
        setApiKey("");
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load settings."),
      )
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void checkPushSubscription();
    api<{ tokens: unknown[] }>("/api/calendar/token")
      .then((payload) => setCalendarTokens(payload.tokens?.length || 0))
      .catch(() => setCalendarTokens(0));
  }, [open]);

  useEffect(() => {
    if (!open || loading || focusSection !== "ai") return;
    aiSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open, loading, focusSection]);

  function changeProvider(value: string) {
    setProvider(value);
    const defaults = PROVIDER_DEFAULTS[value];
    if (defaults) {
      setBaseUrl(defaults.baseUrl);
      setModel(defaults.model);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ llm_api_key_cleared?: boolean }>("/api/settings", {
        method: "POST",
        body: {
          parser_mode: parserMode,
          default_follow_up_days: followUpDays,
          timezone,
          notifications_enabled: notifications,
          push_enabled: pushEnabled,
          digest_enabled: digestEnabled,
          digest_time: digestTime,
          quiet_hours_start: quietStart,
          quiet_hours_end: quietEnd,
          reminder_channel: reminderChannel,
          telegram_chat_id: telegramChatId,
          llm_provider: provider,
          llm_base_url: baseUrl,
          llm_model: model,
          llm_api_key: apiKey || undefined,
        },
      });
      if (result.llm_api_key_cleared && !apiKey) {
        notify("Settings saved. Re-enter your API key for the new endpoint.", "success");
      } else {
        notify("Settings saved", "success");
      }
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function removeApiKey() {
    setBusy(true);
    setError("");
    try {
      await api("/api/settings", { method: "POST", body: { llm_api_key_clear: true } });
      setSettings((current) =>
        current?.preferences
          ? { ...current, preferences: { ...current.preferences, llm_api_key_set: false } }
          : current,
      );
      setApiKey("");
      notify("Saved API key removed", "success");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the API key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/settings/test", {
        method: "POST",
        body: { provider, base_url: baseUrl, model, api_key: apiKey || undefined },
      });
      setTestResult({ ok: true, message: result.message });
    } catch (testError) {
      setTestResult({
        ok: false,
        message: testError instanceof Error ? testError.message : "Could not reach the provider.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      setError("This browser does not support notifications.");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      setNotifications(true);
      notify("Browser notifications enabled", "success");
    }
  }

  async function checkPushSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      setPushSubscribed(Boolean(subscription));
    } catch {
      setPushSubscribed(false);
    }
  }

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      notify("This browser does not support Web Push.", "error");
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);
      if (permission !== "granted") {
        notify("Notifications were not enabled.", "error");
        return;
      }
      const keyResponse = await api<{ public_key: string }>("/api/push");
      const registration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyResponse.public_key),
        }));
      await api("/api/push", { method: "POST", body: subscription.toJSON() });
      setPushSubscribed(true);
      setPushEnabled(true);
      notify("Web Push enabled on this device", "success");
    } catch (pushError) {
      notify(
        pushError instanceof Error ? pushError.message : "Could not enable Web Push.",
        "error",
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTestPush() {
    setPushBusy(true);
    try {
      const result = await api<{ ok: boolean; sent: number }>("/api/push/test", {
        method: "POST",
      });
      notify(
        result.sent > 0 ? "Test push sent." : "No push subscription on this device yet.",
        result.sent > 0 ? "success" : "error",
      );
    } catch (testError) {
      notify(testError instanceof Error ? testError.message : "Push test failed.", "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function createCalendarFeed() {
    setCalendarBusy(true);
    try {
      const result = await api<{ url: string }>("/api/calendar/token", { method: "POST" });
      setCalendarUrl(result.url);
      setCalendarTokens((count) => count + 1);
      notify("Calendar subscription URL created", "success");
    } catch (feedError) {
      notify(feedError instanceof Error ? feedError.message : "Could not create a feed.", "error");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function revokeCalendarFeeds() {
    setCalendarBusy(true);
    try {
      await api("/api/calendar/token", { method: "DELETE" });
      setCalendarUrl("");
      setCalendarTokens(0);
      notify("Calendar subscription URLs revoked", "success");
    } catch (feedError) {
      notify(feedError instanceof Error ? feedError.message : "Could not revoke feeds.", "error");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function copyCalendarUrl() {
    if (!calendarUrl) return;
    try {
      await navigator.clipboard.writeText(calendarUrl.replace(/^https?:\/\//, "webcal://"));
      notify("webcal URL copied", "success");
    } catch {
      notify("Could not copy the URL.", "error");
    }
  }

  async function handleLogout() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  async function handleDeleteAll() {
    const confirmed = window.confirm(
      "Delete all applications, emails, reminders, settings, and your account? This cannot be undone.",
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/me", { method: "DELETE" });
      window.location.href = "/";
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete your data.");
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-[620px] overflow-hidden rounded-2xl border border-[#1E293B] bg-[#0c101b] shadow-2xl"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between px-7 pb-5 pt-6">
          <div>
            <h2 className="font-display text-[18px] font-bold tracking-tight text-cream">Settings</h2>
            <p className="mt-1 text-[12px] font-normal text-text-secondary">
              Parsing model, reminders, and notifications. Emails stay manual.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="-mr-1 mt-0.5 rounded-lg p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-cream"
          >
            <Icon name="close" className="block text-[17px]" />
          </button>
        </div>

        <div className="flex flex-col gap-6 overflow-y-auto px-7 pb-6">
          {loading ? (
            <p className="py-8 text-center text-sm text-text-secondary">Loading…</p>
          ) : (
            <>
              {focusSection === "ai" && (
                <div className="rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-[11.5px] leading-relaxed text-cream">
                  Connect an AI provider first. Paste &amp; Draft uses your provider API to read
                  recruiting emails.
                </div>
              )}

              <section ref={aiSectionRef} id="settings-ai" className="flex scroll-mt-4 flex-col gap-3.5">
                <div className="flex items-center gap-2 text-cyan">
                  <Icon name="auto_awesome" className="text-[16px]" />
                  <h3 className={sectionTitleClass}>Email parser &amp; LLM</h3>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="parser-mode">
                      Parser mode
                    </label>
                    <select
                      id="parser-mode"
                      value={parserMode}
                      onChange={(event) => setParserMode(event.target.value)}
                      className={inputClass}
                    >
                      <option value="auto">Auto (LLM when needed, rules fallback)</option>
                      <option value="llm">AI only (falls back to rules without a key)</option>
                      <option value="rules">Rules only (offline, private)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="checkback-days">
                      Default check-back (days)
                    </label>
                    <input
                      id="checkback-days"
                      type="number"
                      min={1}
                      max={60}
                      value={followUpDays}
                      onChange={(event) => setFollowUpDays(Number(event.target.value))}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="provider-select">
                      Provider
                    </label>
                    <select
                      id="provider-select"
                      value={provider}
                      onChange={(event) => changeProvider(event.target.value)}
                      className={inputClass}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="groq">Groq (groq.com)</option>
                      <option value="grok">Grok (xAI)</option>
                      <option value="claude">Claude (Anthropic)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="model-input">
                      Model
                    </label>
                    <input
                      id="model-input"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      className={`${inputClass} font-mono text-[12px]`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="base-url-input">
                      Base URL
                    </label>
                    <input
                      id="base-url-input"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      className={`${inputClass} font-mono text-[12px]`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="api-key-input">
                      API key
                    </label>
                    <input
                      id="api-key-input"
                      name="llm-api-key"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        apiKeySet
                          ? "Saved — leave blank to keep"
                          : "sk-…"
                      }
                      className={`${inputClass} font-mono text-[12px]`}
                    />
                    {apiKeySet && (
                      <button
                        type="button"
                        onClick={removeApiKey}
                        disabled={busy}
                        className="mt-1 self-start text-[10.5px] font-medium text-rose transition-colors hover:brightness-110 disabled:opacity-50"
                      >
                        Remove saved key
                      </button>
                    )}
                  </div>
                </div>

                {apiKeySet && endpointChanged && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10.5px] leading-relaxed text-amber-200">
                    The saved API key belongs to the previous endpoint. It will be removed when
                    you save unless you enter a new key.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testing || busy || loading}
                    className="rounded-lg border border-[#1e2739] bg-[#070b13] px-3 py-1.5 text-[11.5px] font-medium text-cream transition-colors hover:border-cyan/50 disabled:opacity-50"
                  >
                    {testing ? <SpinnerLabel label="Testing" /> : "Test connection"}
                  </button>
                  {testResult && (
                    <p
                      className={`text-[10.5px] leading-relaxed ${
                        testResult.ok ? "text-emerald-300" : "text-error"
                      }`}
                    >
                      {testResult.message}
                    </p>
                  )}
                </div>

                <p className="pt-0.5 text-[10.5px] font-normal leading-relaxed text-text-secondary">
                  Parsing uses your provider API. Without a key, Paste &amp; Draft asks you to
                  connect an AI provider first.
                </p>
              </section>

              <hr className="border-t border-border/60" />

              <section className="flex flex-col gap-3.5">
                <div className="flex items-center gap-2 text-cyan">
                  <Icon name="notifications" className="text-[16px]" />
                  <h3 className={sectionTitleClass}>Reminders</h3>
                </div>
                <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="timezone-input">
                      Timezone
                    </label>
                    <select
                      id="timezone-input"
                      value={normalizeTimezone(timezone)}
                      onChange={(event) => setTimezone(event.target.value)}
                      className={inputClass}
                    >
                      {timezoneOptions.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex cursor-pointer select-none items-center gap-2.5 text-[12.5px] font-normal text-cream sm:pt-5">
                    <input
                      type="checkbox"
                      checked={notifications}
                      onChange={(event) => setNotifications(event.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border bg-[#070b13] accent-[#5a8bb8] focus:outline-none"
                    />
                    Browser notifications
                  </label>
                </div>
                <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="digest-time">
                      Daily digest time
                    </label>
                    <input
                      id="digest-time"
                      type="time"
                      value={digestTime}
                      onChange={(event) => setDigestTime(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <label className="flex cursor-pointer select-none items-center gap-2.5 pb-2 text-[12.5px] font-normal text-cream">
                    <input
                      type="checkbox"
                      checked={digestEnabled}
                      onChange={(event) => setDigestEnabled(event.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border bg-[#070b13] accent-[#5a8bb8] focus:outline-none"
                    />
                    Daily "3 things today" digest
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="quiet-start">
                      Quiet hours start
                    </label>
                    <input
                      id="quiet-start"
                      type="time"
                      value={quietStart}
                      onChange={(event) => setQuietStart(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="quiet-end">
                      Quiet hours end
                    </label>
                    <input
                      id="quiet-end"
                      type="time"
                      value={quietEnd}
                      onChange={(event) => setQuietEnd(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="reminder-channel">
                      Reminder channel
                    </label>
                    <select
                      id="reminder-channel"
                      value={reminderChannel}
                      onChange={(event) =>
                        setReminderChannel(event.target.value as typeof reminderChannel)
                      }
                      className={inputClass}
                    >
                      <option value="auto">Auto (push, then Telegram)</option>
                      <option value="push">Web Push</option>
                      <option value="telegram">Telegram</option>
                      <option value="none">In-app only</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={labelClass} htmlFor="telegram-chat">
                      Telegram chat ID (optional)
                    </label>
                    <input
                      id="telegram-chat"
                      value={telegramChatId}
                      onChange={(event) => setTelegramChatId(event.target.value)}
                      placeholder="e.g. 123456789"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-text-secondary">
                  <span>
                    Browser permission: <span className="font-semibold text-cream">{permission}</span>
                  </span>
                  {permission !== "granted" && (
                    <button
                      type="button"
                      onClick={requestNotificationPermission}
                      className="font-medium text-cyan transition-colors hover:brightness-110"
                    >
                      Request permission
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={enablePush}
                    disabled={pushBusy || !pushEnabled}
                    className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-[11px] font-semibold text-cyan transition hover:bg-cyan/20 disabled:opacity-50"
                  >
                    {pushSubscribed ? "Web Push subscribed" : "Enable Web Push"}
                  </button>
                  <button
                    type="button"
                    onClick={sendTestPush}
                    disabled={pushBusy}
                    className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-cream-muted transition hover:border-steel hover:text-cream disabled:opacity-50"
                  >
                    Send test push
                  </button>
                  <label className="ml-auto flex cursor-pointer select-none items-center gap-2 text-[10.5px] text-cream-muted">
                    <input
                      type="checkbox"
                      checked={pushEnabled}
                      onChange={(event) => setPushEnabled(event.target.checked)}
                      className="h-3.5 w-3.5 accent-[#5a8bb8]"
                    />
                    Push delivery enabled
                  </label>
                </div>
              </section>

              {authenticated && (
                <section className="flex flex-col gap-3 border-t border-border/60 pt-4">
                  <div className="flex items-center gap-2 text-cyan">
                    <Icon name="event" className="text-[16px]" />
                    <h3 className={sectionTitleClass}>Calendar subscription</h3>
                  </div>
                  <p className="text-[10.5px] leading-relaxed text-text-secondary">
                    Create a revocable secret URL for Google Calendar, Apple Calendar, or any
                    webcal client. Your feed updates automatically and includes 1-day and
                    1-hour alarms.
                  </p>
                  {calendarUrl && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        readOnly
                        value={calendarUrl}
                        aria-label="Calendar subscription URL"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={copyCalendarUrl}
                        className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-[11px] font-semibold text-cyan transition hover:bg-cyan/20"
                      >
                        Copy webcal
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={createCalendarFeed}
                      disabled={calendarBusy}
                      className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-[11px] font-semibold text-cyan transition hover:bg-cyan/20 disabled:opacity-50"
                    >
                      Create subscription URL
                    </button>
                    <button
                      type="button"
                      onClick={revokeCalendarFeeds}
                      disabled={calendarBusy || calendarTokens === 0}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-cream-muted transition hover:border-error/40 hover:text-error disabled:opacity-50"
                    >
                      Revoke all ({calendarTokens})
                    </button>
                  </div>
                </section>
              )}

              {authenticated && (
                <section className="rounded-xl border border-error/30 bg-error-container/10 p-4">
                  <h3 className="text-[12.5px] font-semibold text-error">Danger zone</h3>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-text-secondary">
                    Permanently delete every application, logged email, reminder, setting, and
                    your account. This cannot be undone.
                  </p>
                  <button
                    type="button"
                    onClick={handleDeleteAll}
                    disabled={busy}
                    className="mt-3 rounded-lg border border-error/40 px-3 py-1.5 text-[11.5px] font-semibold text-error transition-colors hover:bg-error-container/20 disabled:opacity-50"
                  >
                    Delete all my data
                  </button>
                </section>
              )}

              {error && (
                <p className="rounded-lg bg-error-container/30 px-3 py-2 text-xs text-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/60 bg-[#090d16] px-7 py-4">
          <div>
            {authenticated && (
              <button
                type="button"
                onClick={handleLogout}
                className="text-[12.5px] font-medium text-rose transition-colors hover:brightness-110"
              >
                Sign out
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onClose}
              className="px-1 text-[12.5px] font-medium text-text-secondary transition-colors hover:text-cream"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={busy || loading}
              className="rounded-lg bg-cyan px-5 py-2 text-[12.5px] font-semibold text-[#07131b] shadow-sm transition-all hover:bg-cyan/90 active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? <SpinnerLabel label="Saving" /> : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
