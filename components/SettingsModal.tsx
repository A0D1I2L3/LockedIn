"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { Icon, Modal, SpinnerLabel } from "@/components/ui";

const inputClass =
  "h-[42px] w-full rounded-lg border border-[#1e2739] bg-[#070b13] px-3.5 py-2 text-[12.5px] text-cream outline-none transition-colors placeholder:text-text-tertiary focus:border-cyan";
const labelClass =
  "mb-1.5 block text-[9.5px] font-bold uppercase tracking-wider text-text-secondary";
const sectionTitleClass =
  "text-[10px] font-bold uppercase tracking-widest text-text-secondary";

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
  const [parserMode, setParserMode] = useState("llm");
  const [followUpDays, setFollowUpDays] = useState(7);
  const [timezone, setTimezone] = useState("UTC");
  const [notifications, setNotifications] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aiSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api<SettingsPayload>("/api/settings")
      .then((payload) => {
        setSettings(payload);
        const prefs = payload.preferences;
        if (prefs) {
          setProvider(prefs.llm_provider || "openai");
          setBaseUrl(prefs.llm_base_url || PROVIDER_DEFAULTS[prefs.llm_provider]?.baseUrl || "");
          setModel(prefs.llm_model || PROVIDER_DEFAULTS[prefs.llm_provider]?.model || "");
          setParserMode(prefs.parser_mode || "llm");
          setFollowUpDays(prefs.default_follow_up_days || 7);
          setTimezone(prefs.timezone || "UTC");
          setNotifications(Boolean(prefs.notifications_enabled));
        }
        setApiKey("");
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load settings."),
      )
      .finally(() => setLoading(false));
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
      await api("/api/settings", {
        method: "POST",
        body: {
          parser_mode: parserMode,
          default_follow_up_days: followUpDays,
          timezone,
          notifications_enabled: notifications,
          llm_provider: provider,
          llm_base_url: baseUrl,
          llm_model: model,
          llm_api_key: apiKey || undefined,
        },
      });
      notify("Settings saved", "success");
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
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
                      <option value="llm">LLM API (default)</option>
                      <option value="auto">Auto (LLM, then rules)</option>
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
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        settings?.preferences?.llm_api_key_set
                          ? "Saved — leave blank to keep"
                          : "sk-…"
                      }
                      className={`${inputClass} font-mono text-[12px]`}
                    />
                  </div>
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
                    <input
                      id="timezone-input"
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      className={inputClass}
                      placeholder="America/New_York"
                    />
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
              </section>

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
