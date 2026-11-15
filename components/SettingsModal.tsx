"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/client";
import { Icon, Modal, SpinnerLabel } from "@/components/ui";

const inputClass =
  "w-full rounded-lg border border-surface-border bg-surface-container-lowest px-3 py-2 text-sm text-text-primary outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20 placeholder:text-text-tertiary";
const labelClass = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary";

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  grok: { baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  claude: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
};

interface SettingsPayload {
  configured: boolean;
  client_id: string;
  client_secret_set: boolean;
  base_url: string;
  redirect_uri: string;
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
}: {
  open: boolean;
  onClose: () => void;
  authenticated: boolean;
  onSaved: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_DEFAULTS.openai.baseUrl);
  const [model, setModel] = useState(PROVIDER_DEFAULTS.openai.model);
  const [apiKey, setApiKey] = useState("");
  const [parserMode, setParserMode] = useState("auto");
  const [followUpDays, setFollowUpDays] = useState(7);
  const [timezone, setTimezone] = useState("UTC");
  const [notifications, setNotifications] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    api<SettingsPayload>("/api/settings")
      .then((payload) => {
        setSettings(payload);
        setClientId(payload.client_id || "");
        setClientSecret("");
        const prefs = payload.preferences;
        if (prefs) {
          setProvider(prefs.llm_provider || "openai");
          setBaseUrl(prefs.llm_base_url || PROVIDER_DEFAULTS[prefs.llm_provider]?.baseUrl || "");
          setModel(prefs.llm_model || PROVIDER_DEFAULTS[prefs.llm_provider]?.model || "");
          setParserMode(prefs.parser_mode || "auto");
          setFollowUpDays(prefs.default_follow_up_days || 7);
          setTimezone(prefs.timezone || "UTC");
          setNotifications(Boolean(prefs.notifications_enabled));
        }
        setApiKey("");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load settings."))
      .finally(() => setLoading(false));
  }, [open]);

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
          client_id: clientId,
          client_secret: clientSecret || undefined,
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
    <Modal open={open} onClose={onClose} className="max-w-2xl rounded-2xl border border-surface-border bg-surface-elevated shadow-2xl">
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
        <div className="flex items-start justify-between border-b border-surface-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">Settings</h2>
            <p className="mt-0.5 text-xs text-text-secondary">Google sign-in and optional parsing model. Emails stay manual.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-text-tertiary hover:bg-surface-container-high hover:text-text-primary">
            <Icon name="close" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-text-secondary">Loading…</p>
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Icon name="shield_person" className="text-[18px] text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">Google OAuth</h3>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${settings?.configured ? "bg-stage-offer/20 text-stage-offer" : "bg-signal-warning/15 text-signal-warning"}`}>
                    {settings?.configured ? "Configured" : "Needs credentials"}
                  </span>
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-text-tertiary">
                  Sign-in only. The app never reads your inbox. Create a Web application OAuth client and add the redirect URI below.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Client ID</label>
                    <input value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClass} placeholder="…apps.googleusercontent.com" />
                  </div>
                  <div>
                    <label className={labelClass}>Client secret</label>
                    <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} className={inputClass} placeholder={settings?.client_secret_set ? "Saved — leave blank to keep" : "GOCSPX-…"} />
                  </div>
                  <div>
                    <label className={labelClass}>Redirect URI</label>
                    <input readOnly value={settings?.redirect_uri || ""} className={`${inputClass} font-mono text-xs text-text-secondary`} />
                  </div>
                </div>
              </section>

              {authenticated && settings?.preferences && (
                <>
                  <section className="border-t border-surface-border pt-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon name="auto_awesome" className="text-[18px] text-primary" />
                      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">Email parser & LLM</h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Parser mode</label>
                        <select value={parserMode} onChange={(event) => setParserMode(event.target.value)} className={inputClass}>
                          <option value="auto">Auto (rules, then LLM)</option>
                          <option value="rules">Rules only</option>
                          <option value="llm">Prefer LLM</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Default check-back (days)</label>
                        <input type="number" min={1} max={90} value={followUpDays} onChange={(event) => setFollowUpDays(Number(event.target.value))} className={inputClass} />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Provider</label>
                        <select value={provider} onChange={(event) => changeProvider(event.target.value)} className={inputClass}>
                          <option value="openai">OpenAI</option>
                          <option value="grok">Grok (xAI)</option>
                          <option value="claude">Claude (Anthropic)</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Model</label>
                        <input value={model} onChange={(event) => setModel(event.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Base URL</label>
                        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className={`${inputClass} font-mono text-xs`} />
                      </div>
                      <div>
                        <label className={labelClass}>API key</label>
                        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.preferences.llm_api_key_set ? "Saved — leave blank to keep" : "sk-… (optional)"} className={inputClass} />
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-text-tertiary">
                      Without a key the app stays rules-only. Emails are sent to the provider only when auto mode needs help.
                    </p>
                  </section>

                  <section className="border-t border-surface-border pt-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon name="notifications_active" className="text-[18px] text-primary" />
                      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">Reminders</h3>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Timezone</label>
                        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} className={inputClass} placeholder="America/New_York" />
                      </div>
                      <label className="flex items-end gap-2 pb-2 text-xs text-text-secondary">
                        <input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} className="h-4 w-4 accent-[#8083ff]" />
                        Browser notifications
                      </label>
                    </div>
                  </section>
                </>
              )}

              {error && <p className="rounded-lg bg-error-container/30 px-3 py-2 text-xs text-error">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-surface-border px-5 py-3">
          <div>
            {authenticated && (
              <button type="button" onClick={handleLogout} className="rounded-lg px-3 py-2 text-xs font-semibold text-error hover:bg-error-container/20">
                Sign out
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-container-high">
              Close
            </button>
            <button type="submit" disabled={busy || loading} className="rounded-lg bg-primary-container px-4 py-2 text-xs font-bold text-on-primary-container disabled:opacity-60">
              {busy ? <SpinnerLabel label="Saving" /> : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
