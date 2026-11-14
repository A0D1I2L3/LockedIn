const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STAGE_META = {
  applied: { label: "Applied", pill: "bg-stage-applied/20 text-stage-applied", dot: "bg-stage-applied", text: "text-stage-applied" },
  assessment: { label: "Assessment", pill: "bg-stage-assessment/20 text-stage-assessment", dot: "bg-stage-assessment", text: "text-stage-assessment" },
  interview: { label: "Interviewing", pill: "bg-stage-interview/20 text-stage-interview", dot: "bg-stage-interview", text: "text-stage-interview" },
  offer: { label: "Offer", pill: "bg-stage-offer/20 text-stage-offer", dot: "bg-stage-offer", text: "text-stage-offer" },
  rejected: { label: "Rejected", pill: "bg-stage-rejected/20 text-stage-rejected", dot: "bg-stage-rejected", text: "text-stage-rejected" },
  withdrawn: { label: "Withdrawn", pill: "bg-stage-withdrawn/20 text-stage-withdrawn", dot: "bg-stage-withdrawn", text: "text-stage-withdrawn" },
};

const LLM_PROVIDER_DEFAULTS = {
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  grok: { base: "https://api.x.ai/v1", model: "grok-3-mini" },
  claude: { base: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
};

const state = {
  me: null,
  status: null,
  settings: null,
  stats: null,
  applications: [],
  due: [],
  upcoming: [],
  filter: { stage: "all", status: "all", q: "" },
  view: "today",
  editingId: null,
  detail: null,
  detailData: null,
  pollTimer: null,
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && typeof opts.body !== "string") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(path, opts).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `${res.status} ${res.statusText}`);
    }
    if (res.status === 204) return {};
    return res.json();
  });
}

function fmtDate(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function dateInputValue(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(ms - offset).toISOString().slice(0, 10);
}

function relative(ms) {
  if (!ms) return "";
  const diff = Number(ms) - Date.now();
  const days = Math.round(diff / 86400000);
  if (days < -1) return `${Math.abs(days)}d overdue`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return fmtDate(ms);
}

function stageMeta(stage) {
  return STAGE_META[stage] || STAGE_META.applied;
}

function stageBadge(stage) {
  const meta = stageMeta(stage);
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.pill} font-label-sm text-label-sm font-semibold"><span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${esc(meta.label)}</span>`;
}

function companyAvatar(company, stage) {
  const meta = stageMeta(stage);
  const initial = esc((company || "?").trim().charAt(0).toUpperCase() || "?");
  return `<span class="w-8 h-8 rounded-lg ${meta.pill} font-label-md text-label-md flex items-center justify-center font-bold shrink-0">${initial}</span>`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.add("hidden"), 3200);
}

function showBanner(message) {
  const el = $("#banner");
  $(".banner-text", el).textContent = message || "";
  el.classList.toggle("hidden", !message);
}

function openModal(id) {
  $(id).classList.remove("hidden");
}

function closeModal(id) {
  $(id).classList.add("hidden");
}

function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.original || button.textContent;
    button.disabled = false;
  }
}

function eventLabel(event) {
  const labels = {
    created: "Application added",
    updated: "Details updated",
    email: "Email attached",
    outcome: "Outcome recorded",
    snoozed: "Check-back snoozed",
    reminders_synced: "Reminders refreshed",
  };
  return labels[event.type] || event.type;
}

function bindEvents() {
  $("#connect-btn").addEventListener("click", () => { window.location.href = "/oauth/login"; });
  $("#signedout-settings").addEventListener("click", openSettings);
  $("#settings-login").addEventListener("click", () => { window.location.href = "/oauth/login"; });
  $("#nav-today").addEventListener("click", (e) => { e.preventDefault(); setView("today"); });
  $("#nav-apps").addEventListener("click", (e) => { e.preventDefault(); setView("apps"); });
  $("#nav-calendar").addEventListener("click", (e) => { e.preventDefault(); setView("calendar"); });
  $("#notif-btn").addEventListener("click", () => setView("today"));
  $("#add-app-btn").addEventListener("click", () => openAppForm());
  $("#app-modal-close").addEventListener("click", () => closeModal("#app-modal"));
  $("#app-cancel-btn").addEventListener("click", () => closeModal("#app-modal"));
  $("#app-form").addEventListener("submit", saveApplication);
  $("#app-delete-btn").addEventListener("click", deleteApplication);
  $("#add-parse-btn").addEventListener("click", parseIntoAddForm);

  $("#detail-close").addEventListener("click", () => closeModal("#detail-modal"));
  $("#detail-edit").addEventListener("click", () => {
    if (state.detail) {
      closeModal("#detail-modal");
      openAppForm(state.detail);
    }
  });
  $("#detail-snooze").addEventListener("click", snoozeDetail);
  $("#detail-modal").addEventListener("click", (e) => {
    if (e.target === $("#detail-modal")) closeModal("#detail-modal");
  });
  $("#detail-modal").addEventListener("click", (e) => {
    const button = e.target.closest(".outcome-btn");
    if (!button) return;
    recordOutcome(button.dataset.outcome, button);
  });
  $("#email-preview").addEventListener("click", previewEmail);
  $("#email-apply").addEventListener("click", applyEmail);

  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", () => closeModal("#settings-modal"));
  $("#settings-cancel").addEventListener("click", () => closeModal("#settings-modal"));
  $("#settings-save").addEventListener("click", saveSettings);
  $("#p-llm-provider").addEventListener("change", (e) => applyLlmProvider(e.target.value, true));
  $("#logout-btn").addEventListener("click", logout);
  $("#browser-notify-btn").addEventListener("click", requestNotifications);
  $("#notify-enable").addEventListener("click", requestNotifications);

  $("#search").addEventListener("input", (e) => {
    state.filter.q = e.target.value.trim().toLowerCase();
    renderApplications();
  });
  $("#stage-filter").addEventListener("change", (e) => {
    state.filter.stage = e.target.value;
    renderApplications();
  });
  $("#status-filter").addEventListener("change", (e) => {
    state.filter.status = e.target.value;
    renderApplications();
  });

  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-app]");
    if (open) openDetail(open.dataset.openApp);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ["#app-modal", "#detail-modal", "#settings-modal", "#email-preview-box"].forEach((id) => {
      const el = $(id);
      if (el && !el.classList.contains("hidden")) {
        if (id === "#email-preview-box") el.classList.add("hidden");
        else closeModal(id);
      }
    });
  });
}

async function boot() {
  bindEvents();
  ensureServiceWorker();
  try {
    state.status = await api("/api/status");
    state.settings = await api("/api/settings").catch(() => null);
    state.me = await api("/api/me");
  } catch (err) {
    showBanner(`Could not reach the server: ${err.message}`);
    return;
  }
  renderAuth();
  if (!state.status.authenticated) return;
  await loadAll();
  startPolling();
  updateNotifyUI();
  const requested = new URLSearchParams(window.location.search).get("application");
  if (requested) openDetail(requested);
}

function renderAuth() {
  const authed = !!state.status?.authenticated;
  $("#signed-out").classList.toggle("hidden", authed);
  $("#app-shell").classList.toggle("hidden", !authed);
  $("#account-email").textContent = state.me?.email || state.status?.email || "Signed in";
  if (authed) {
    $("#settings-login").classList.add("hidden");
  } else {
    $("#settings-login").classList.remove("hidden");
  }
}

async function loadAll() {
  const [stats, apps, feed] = await Promise.all([
    api("/api/stats"),
    api("/api/applications?status=all&limit=1000"),
    api("/api/notifications"),
  ]);
  state.stats = stats;
  state.applications = apps.applications || [];
  state.due = feed.due || [];
  state.upcoming = feed.upcoming || [];
  renderAll();
}

function renderAll() {
  renderStats();
  renderDue();
  renderUpcoming();
  renderApplications();
  renderCalendarList();
  renderCounters();
  setView(state.view || "today");
}

function renderCounters() {
  const dueCount = state.due.length;
  const nav = $("#nav-due-count");
  nav.textContent = String(dueCount);
  nav.classList.toggle("hidden", dueCount === 0);
  const bell = $("#notif-count");
  bell.textContent = String(dueCount);
  bell.classList.toggle("hidden", dueCount === 0);
}

function renderStats() {
  const stats = state.stats || { by_stage: {}, total: 0, active: 0, due: 0, upcoming: 0 };
  const cards = [
    { key: "applied", label: "Applied", icon: "send", tone: "stage-applied", suffix: "active" },
    { key: "assessment", label: "Assessment", icon: "quiz", tone: "stage-assessment", suffix: "tasks" },
    { key: "interview", label: "Interviewing", icon: "forum", tone: "stage-interview", suffix: "active" },
    { key: "offer", label: "Offers", icon: "verified", tone: "stage-offer", suffix: "offers" },
    { key: "rejected", label: "Rejected", icon: "cancel", tone: "stage-rejected", suffix: "closed" },
    { key: "total", label: "Total tracked", icon: "inventory_2", tone: "text-primary", suffix: "apps" },
  ];
  $("#stats").innerHTML = cards.map((card) => {
    const value = card.key === "total" ? stats.total : (stats.by_stage?.[card.key] || 0);
    const active = state.filter.stage === card.key ? "active" : "";
    return `
      <button type="button" class="stat-card ${active} group relative p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container transition-all shadow-sm flex flex-col justify-between text-left" data-stat="${card.key}">
        <div class="flex items-center justify-between">
          <span class="font-label-sm text-label-sm uppercase tracking-wider text-text-tertiary">${card.label}</span>
          <span class="material-symbols-outlined ${card.tone} text-[18px] opacity-70 group-hover:opacity-100">${card.icon}</span>
        </div>
        <div class="flex items-baseline gap-space-xs mt-space-sm">
          <span class="stat-num font-headline-lg text-headline-lg ${card.tone} font-bold">${value}</span>
          <span class="font-body-sm text-body-sm text-text-tertiary">${card.suffix}</span>
        </div>
      </button>`;
  }).join("");
  $$("#stats [data-stat]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.stat;
      state.filter.stage = key === "total" ? "all" : key;
      $("#stage-filter").value = state.filter.stage;
      setView("apps");
      renderStats();
      renderApplications();
    });
  });
  const active = stats.active ?? 0;
  const due = stats.due ?? 0;
  $("#stats-updated").textContent = `${active} active · ${due} due now`;
}

function dueCard(item, compact = false) {
  const meta = stageMeta(item.stage);
  return `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-base hover:bg-surface-container transition-colors border border-surface-border-subtle">
      <div class="flex items-start gap-space-sm min-w-0">
        ${companyAvatar(item.company, item.stage)}
        <div class="min-w-0">
          <div class="flex items-center gap-space-sm flex-wrap">
            <button type="button" class="font-label-lg text-label-lg text-text-primary hover:underline truncate" data-open-app="${esc(item.application_id)}">${esc(item.company || "Application")}</button>
            ${stageBadge(item.stage)}
          </div>
          <div class="font-body-sm text-body-sm text-text-secondary truncate">${esc(item.role || "—")}</div>
          <div class="font-body-sm text-body-sm ${meta.text} truncate">${esc(item.title || "")}</div>
        </div>
      </div>
      <div class="flex items-center gap-space-xs shrink-0 self-end sm:self-auto">
        <span class="font-body-sm text-body-sm text-text-tertiary whitespace-nowrap">${relative(item.due_at)}</span>
        ${compact ? "" : `
          <button type="button" class="px-2 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-text-primary font-label-md text-label-md" data-snooze-app="${esc(item.application_id)}">Snooze</button>
          <button type="button" class="px-2 py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-text-secondary font-label-md text-label-md" data-dismiss-reminder="${esc(item.reminder_id || "")}" data-dismiss-app="${esc(item.application_id)}">Done</button>
        `}
      </div>
    </div>`;
}

function emptyState(message, icon = "inbox") {
  return `<div class="flex flex-col items-center justify-center gap-space-sm p-space-lg text-center">
    <span class="material-symbols-outlined text-[28px] text-text-tertiary">${icon}</span>
    <p class="font-body-sm text-body-sm text-text-tertiary">${esc(message)}</p>
  </div>`;
}

function renderDue() {
  $("#due-count").textContent = String(state.due.length);
  const list = $("#due-list");
  if (!state.due.length) {
    list.innerHTML = emptyState("You're all caught up. Add an application or enjoy the quiet.", "task_alt");
    return;
  }
  list.innerHTML = state.due.map((item) => dueCard(item)).join("");
  $$("#due-list [data-snooze-app]").forEach((button) => {
    button.addEventListener("click", () => snoozeApp(button.dataset.snoozeApp, 3, button));
  });
  $$("#due-list [data-dismiss-reminder]").forEach((button) => {
    button.addEventListener("click", () => dismissReminder(button.dataset.dismissReminder, button.dataset.dismissApp, button));
  });
}

function renderUpcoming() {
  const list = $("#upcoming-list");
  if (!state.upcoming.length) {
    list.innerHTML = emptyState("Nothing due in the next 48 hours.", "event_available");
    return;
  }
  list.innerHTML = state.upcoming.map((item) => dueCard(item, true)).join("");
}

function renderCalendarList() {
  const list = $("#upcoming-calendar");
  if (!list) return;
  if (!state.upcoming.length) {
    list.innerHTML = emptyState("No upcoming check-backs or actions.", "calendar_today");
    return;
  }
  list.innerHTML = `<span class="font-label-sm text-label-sm uppercase text-text-tertiary">Next up</span>` +
    state.upcoming.map((item) => dueCard(item, true)).join("");
}

function filteredApplications() {
  const { stage, status, q } = state.filter;
  return state.applications.filter((app) => {
    if (stage !== "all" && app.stage !== stage) return false;
    if (status !== "all" && app.status !== status) return false;
    if (q) {
      const haystack = `${app.company} ${app.role} ${app.location} ${app.notes} ${app.next_action}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function renderApplications() {
  const apps = filteredApplications();
  $("#apps-subtitle").textContent = `${apps.length} of ${state.applications.length} applications`;
  const container = $("#apps-table");
  if (!apps.length) {
    container.innerHTML = emptyState(
      state.applications.length ? "No applications match these filters." : "No applications yet. Add the first one.",
      "table_rows"
    );
    return;
  }
  container.innerHTML = `
    <table class="w-full text-left border-separate border-spacing-y-1 min-w-[760px]">
      <thead>
        <tr class="font-label-sm text-label-sm uppercase tracking-wider text-text-tertiary">
          <th class="px-3 py-2 font-semibold">Company / role</th>
          <th class="px-3 py-2 font-semibold">Stage</th>
          <th class="px-3 py-2 font-semibold">Next action</th>
          <th class="px-3 py-2 font-semibold">Check back</th>
          <th class="px-3 py-2 font-semibold">Applied</th>
          <th class="px-3 py-2 font-semibold text-right">Open</th>
        </tr>
      </thead>
      <tbody>
        ${apps.map((app) => {
          const meta = stageMeta(app.stage);
          const overdue = app.check_back_at && app.check_back_at <= Date.now() && app.status === "active";
          return `
            <tr class="bg-surface-base hover:bg-surface-container transition-colors group">
              <td class="px-3 py-2.5 rounded-l-lg">
                <div class="flex items-center gap-space-sm min-w-0">
                  ${companyAvatar(app.company, app.stage)}
                  <div class="min-w-0">
                    <div class="font-label-lg text-label-lg text-text-primary truncate">${esc(app.company || "Untitled")}</div>
                    <div class="font-body-sm text-body-sm text-text-secondary truncate">${esc(app.role || "—")}${app.location ? ` · ${esc(app.location)}` : ""}</div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5">${stageBadge(app.stage)}</td>
              <td class="px-3 py-2.5">
                <div class="font-body-sm text-body-sm text-text-secondary truncate max-w-[220px]">${esc(app.next_action || "—")}</div>
                <div class="font-label-sm text-label-sm ${meta.text}">${app.action_state === "action_required" ? "Action required" : app.action_state === "follow_up_due" ? "Follow up due" : ""}</div>
              </td>
              <td class="px-3 py-2.5">
                <span class="font-body-sm text-body-sm ${overdue ? "text-signal-warning" : "text-text-secondary"} whitespace-nowrap">${relative(app.check_back_at) || "—"}</span>
              </td>
              <td class="px-3 py-2.5 font-body-sm text-body-sm text-text-tertiary whitespace-nowrap">${fmtDate(app.applied_at)}</td>
              <td class="px-3 py-2.5 rounded-r-lg text-right">
                <button type="button" class="px-2.5 py-1 rounded-md bg-surface-container group-hover:bg-surface-container-high text-text-primary font-label-md text-label-md" data-open-app="${esc(app.id)}">Open</button>
              </td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function setView(view) {
  state.view = view;
  $("#view-today").classList.toggle("hidden", view !== "today");
  $("#view-apps").classList.toggle("hidden", view !== "apps");
  $("#view-calendar").classList.toggle("hidden", view !== "calendar");
  $("#view-today").classList.toggle("flex", view === "today");
  $("#view-apps").classList.toggle("flex", view === "apps");
  $("#view-calendar").classList.toggle("flex", view === "calendar");
  $$(".nav-link").forEach((link) => link.classList.remove("nav-active"));
  const active = view === "today" ? "#nav-today" : view === "apps" ? "#nav-apps" : "#nav-calendar";
  $(active).classList.add("nav-active");
}

function openAppForm(app = null) {
  state.editingId = app?.id || null;
  $("#app-modal-title").textContent = app ? "Edit application" : "Add application";
  $("#app-delete-btn").classList.toggle("hidden", !app);
  $("#f-company").value = app?.company || "";
  $("#f-role").value = app?.role || "";
  $("#f-location").value = app?.location || "";
  $("#f-job-url").value = app?.job_url || "";
  $("#f-source").value = app?.source || "";
  $("#f-stage").value = app?.stage || "applied";
  $("#f-applied-at").value = dateInputValue(app?.applied_at || Date.now());
  $("#f-check-back").value = dateInputValue(app?.check_back_at || (Date.now() + 7 * 86400000));
  $("#f-next-action").value = app?.next_action || "";
  $("#f-notes").value = app?.notes || "";
  $("#add-email-text").value = "";
  $("#add-parse-note").textContent = "";
  openModal("#app-modal");
  setTimeout(() => $("#f-company").focus(), 30);
}

async function parseIntoAddForm() {
  const raw = $("#add-email-text").value.trim();
  if (!raw) return toast("Paste an email first.");
  const button = $("#add-parse-btn");
  setBusy(button, true, "Parsing…");
  try {
    const draft = await api("/api/parse-email", { method: "POST", body: { raw_text: raw } });
    if (draft.company) $("#f-company").value = draft.company;
    if (draft.role) $("#f-role").value = draft.role;
    if (draft.location) $("#f-location").value = draft.location;
    if (draft.stage) $("#f-stage").value = draft.stage;
    if (draft.next_action) $("#f-next-action").value = draft.next_action;
    if (draft.check_back_at) $("#f-check-back").value = dateInputValue(draft.check_back_at);
    $("#add-parse-note").textContent = `${Math.round((draft.confidence || 0) * 100)}% confident · ${draft.parser}`;
    toast("Email parsed. Review the fields before saving.");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

function formPayload() {
  return {
    company: $("#f-company").value.trim(),
    role: $("#f-role").value.trim(),
    location: $("#f-location").value.trim(),
    job_url: $("#f-job-url").value.trim(),
    source: $("#f-source").value.trim(),
    stage: $("#f-stage").value,
    applied_at: $("#f-applied-at").value || null,
    check_back_at: $("#f-check-back").value || null,
    next_action: $("#f-next-action").value.trim(),
    notes: $("#f-notes").value,
  };
}

async function saveApplication(event) {
  event.preventDefault();
  const payload = formPayload();
  if (!payload.company || !payload.role) return toast("Company and role are required.");
  const submit = $("#app-form button[type=submit]");
  setBusy(submit, true, "Saving…");
  try {
    let app;
    if (state.editingId) {
      app = await api(`/api/applications/${state.editingId}`, { method: "PATCH", body: payload });
    } else {
      app = await api("/api/applications", { method: "POST", body: payload });
    }
    closeModal("#app-modal");
    toast(state.editingId ? "Application updated." : "Application added.");
    state.editingId = null;
    await loadAll();
    await openDetail(app.id);
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(submit, false);
  }
}

async function deleteApplication() {
  if (!state.editingId) return;
  if (!window.confirm("Delete this application and its emails/reminders?")) return;
  try {
    await api(`/api/applications/${state.editingId}`, { method: "DELETE" });
    closeModal("#app-modal");
    state.editingId = null;
    toast("Application deleted.");
    await loadAll();
  } catch (err) {
    toast(err.message);
  }
}

async function openDetail(appId) {
  try {
    const [app, timeline] = await Promise.all([
      api(`/api/applications/${appId}`),
      api(`/api/applications/${appId}/timeline`),
    ]);
    state.detail = app;
    state.detailData = timeline;
    renderDetail(app, timeline);
    openModal("#detail-modal");
  } catch (err) {
    toast(err.message);
  }
}

function renderDetail(app, timeline) {
  const meta = stageMeta(app.stage);
  $("#detail-stage").className = `px-2 py-0.5 rounded-full ${meta.pill} font-label-sm text-label-sm font-bold`;
  $("#detail-stage").textContent = meta.label;
  $("#detail-company").textContent = app.company || "Untitled";
  $("#detail-status").textContent = app.status === "closed" ? "Closed" : "Active";
  $("#detail-role").textContent = app.role || "—";
  $("#detail-location").textContent = app.location || "";
  $("#detail-applied").textContent = `Applied ${fmtDate(app.applied_at)}`;
  $("#detail-checkback").textContent = app.check_back_at ? `Check back ${relative(app.check_back_at)}` : "";
  $("#detail-next-action").textContent = app.next_action || "No next action";
  $("#detail-due").textContent = app.next_action_at ? fmtDateTime(app.next_action_at) : "";
  $("#detail-notes").textContent = app.notes ? app.notes.split("\n").slice(-1)[0] : "";
  $("#detail-ics").href = `/api/applications/${app.id}/calendar.ics`;
  $("#email-text").value = "";
  $("#email-subject").value = "";
  $("#email-from").value = "";
  $("#email-preview-box").classList.add("hidden");

  const items = [
    ...(timeline.events || []).map((event) => ({
      at: event.created_at,
      title: eventLabel(event),
      body: event.type === "outcome" ? (event.data?.outcome || "") : "",
      icon: event.type === "email" ? "mail" : event.type === "outcome" ? "flag" : "history",
      tone: "text-text-tertiary",
    })),
    ...(timeline.emails || []).map((email) => ({
      at: email.received_at || email.created_at,
      title: email.subject || "Pasted email",
      body: `${Math.round((email.confidence || 0) * 100)}% · ${email.parser_version || "rules"}`,
      icon: "mail",
      tone: "text-stage-applied",
    })),
  ].filter((item) => item.at).sort((a, b) => b.at - a.at);

  $("#detail-timeline").innerHTML = items.length ? items.map((item) => `
    <div class="flex items-start gap-space-sm p-2 rounded-lg bg-surface-base">
      <span class="material-symbols-outlined text-[18px] ${item.tone} mt-0.5">${item.icon}</span>
      <div class="min-w-0 flex-1">
        <div class="font-body-sm text-body-sm text-text-primary truncate">${esc(item.title)}</div>
        <div class="font-label-sm text-label-sm text-text-tertiary">${esc(item.body || "")}${item.body ? " · " : ""}${fmtDateTime(item.at)}</div>
      </div>
    </div>`).join("") : emptyState("No activity yet.", "history");
}

async function recordOutcome(outcome, button) {
  if (!state.detail) return;
  setBusy(button, true, "Saving…");
  try {
    const updated = await api(`/api/applications/${state.detail.id}/outcome`, {
      method: "POST",
      body: { outcome },
    });
    state.detail = updated;
    toast(`Recorded: ${outcome.replace("_", " ")}.`);
    await loadAll();
    await openDetail(updated.id);
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

async function snoozeDetail() {
  if (!state.detail) return;
  const days = Number($("#detail-snooze-days").value || 3);
  await snoozeApp(state.detail.id, days, $("#detail-snooze"));
  await openDetail(state.detail.id);
}

async function snoozeApp(appId, days, button) {
  setBusy(button, true, "Snoozing…");
  try {
    await api(`/api/applications/${appId}/snooze`, { method: "POST", body: { days } });
    toast(`Snoozed ${days} day${days === 1 ? "" : "s"}.`);
    await loadAll();
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

async function dismissReminder(reminderId, appId, button) {
  if (!reminderId) return snoozeApp(appId, 3, button);
  setBusy(button, true, "Done");
  try {
    await api(`/api/reminders/${reminderId}?action=dismiss`, { method: "PATCH" });
    await loadAll();
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

async function previewEmail() {
  const raw = $("#email-text").value.trim();
  if (!raw) return toast("Paste an email first.");
  const button = $("#email-preview");
  setBusy(button, true, "Parsing…");
  try {
    const draft = await api("/api/parse-email", {
      method: "POST",
      body: {
        raw_text: raw,
        subject: $("#email-subject").value.trim(),
        from_email: $("#email-from").value.trim(),
      },
    });
    const box = $("#email-preview-box");
    box.innerHTML = `
      <div class="flex flex-wrap items-center gap-2 mb-2">
        ${stageBadge(draft.stage)}
        <span class="font-label-md text-label-md text-text-primary">${esc(draft.company || "Company unknown")}</span>
        <span class="font-body-sm text-body-sm text-text-tertiary">${esc(draft.role || "")}</span>
        <span class="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-text-secondary">${Math.round((draft.confidence || 0) * 100)}%</span>
        <span class="px-1.5 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-text-tertiary">${esc(draft.parser)}</span>
      </div>
      <div><strong class="text-text-primary">Next:</strong> ${esc(draft.next_action || "—")}</div>
      <div><strong class="text-text-primary">Check back:</strong> ${draft.check_back_at ? fmtDateTime(draft.check_back_at) : "—"}</div>
      <div><strong class="text-text-primary">Source:</strong> ${esc(draft.check_back_source || "")}</div>
      ${draft.evidence?.length ? `<div class="mt-2 text-text-tertiary">${draft.evidence.map((item) => `“${esc(item)}”`).join(" · ")}</div>` : ""}`;
    box.classList.remove("hidden");
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

async function applyEmail() {
  if (!state.detail) return;
  const raw = $("#email-text").value.trim();
  if (!raw) return toast("Paste an email first.");
  const button = $("#email-apply");
  setBusy(button, true, "Updating…");
  try {
    await api(`/api/applications/${state.detail.id}/emails`, {
      method: "POST",
      body: {
        raw_text: raw,
        subject: $("#email-subject").value.trim(),
        from_email: $("#email-from").value.trim(),
        apply: true,
      },
    });
    toast("Email attached and application updated.");
    await loadAll();
    await openDetail(state.detail.id);
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

function applyLlmProvider(provider, fillDefaults = false) {
  const defaults = LLM_PROVIDER_DEFAULTS[provider] || LLM_PROVIDER_DEFAULTS.openai;
  const base = $("#p-llm-base");
  const model = $("#p-llm-model");
  if (fillDefaults || !base.value.trim()) base.value = defaults.base;
  if (fillDefaults || !model.value.trim()) model.value = defaults.model;
  base.placeholder = defaults.base;
  model.placeholder = defaults.model;
}

async function openSettings() {
  try {
    state.settings = await api("/api/settings");
  } catch (err) {
    return toast(err.message);
  }
  const settings = state.settings;
  const prefs = settings.preferences || {};
  const configured = !!settings.configured;
  $("#settings-status-dot").className = `w-2.5 h-2.5 rounded-full ${configured ? "bg-secondary" : "bg-signal-warning"}`;
  $("#settings-status").textContent = configured ? "Google sign-in is configured" : "Google sign-in needs setup";
  $("#settings-login").classList.toggle("hidden", !configured || state.status?.authenticated);
  $("#creds-redirect").textContent = settings.redirect_uri || "";
  $("#cfg-client-id").value = settings.client_id || "";
  $("#cfg-client-secret").value = "";
  $("#p-parser-mode").value = prefs.parser_mode || "auto";
  $("#p-followup-days").value = prefs.default_follow_up_days || 7;
  $("#p-timezone").value = prefs.timezone || "UTC";
  $("#p-notifications").checked = prefs.notifications_enabled !== false;
  $("#p-llm-provider").value = prefs.llm_provider || "openai";
  $("#p-llm-base").value = prefs.llm_base_url || "";
  $("#p-llm-model").value = prefs.llm_model || "";
  $("#p-llm-key").value = "";
  $("#p-llm-key").placeholder = prefs.llm_api_key_set ? "•••••• set — leave blank to keep" : "sk-…";
  $("#logout-btn").classList.toggle("hidden", !state.status?.authenticated);
  updateNotifyUI();
  openModal("#settings-modal");
}

async function saveSettings() {
  const button = $("#settings-save");
  setBusy(button, true, "Saving…");
  try {
    await api("/api/settings", {
      method: "POST",
      body: {
        client_id: $("#cfg-client-id").value.trim(),
        client_secret: $("#cfg-client-secret").value.trim(),
        parser_mode: $("#p-parser-mode").value,
        default_follow_up_days: Number($("#p-followup-days").value || 7),
        timezone: $("#p-timezone").value.trim() || "UTC",
        notifications_enabled: $("#p-notifications").checked,
        llm_provider: $("#p-llm-provider").value,
        llm_base_url: $("#p-llm-base").value.trim(),
        llm_model: $("#p-llm-model").value.trim(),
        llm_api_key: $("#p-llm-key").value.trim(),
      },
    });
    toast("Settings saved.");
    closeModal("#settings-modal");
    state.settings = await api("/api/settings");
    state.status = await api("/api/status");
    renderAuth();
  } catch (err) {
    toast(err.message);
  } finally {
    setBusy(button, false);
  }
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/";
}

function ensureServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/static/sw.js").catch(() => {});
  }
}

function updateNotifyUI() {
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "denied";
  const enabled = permission === "granted";
  const label = $(".notify-label");
  if (label) label.textContent = enabled ? "Browser alerts on" : supported ? "Enable browser alerts" : "Browser alerts unavailable";
  const status = $("#notify-status");
  if (status) {
    status.textContent = enabled
      ? "Browser alerts are on. A desktop nudge will appear when a check-back is due."
      : supported
        ? "Allow notifications to get a desktop nudge when a check-back is due."
        : "This browser does not support notifications.";
  }
  const button = $("#notify-enable");
  if (button) button.textContent = enabled ? "Browser notifications enabled" : "Enable browser notifications";
}

async function requestNotifications() {
  if (!("Notification" in window)) return toast("This browser does not support notifications.");
  const permission = await Notification.requestPermission();
  updateNotifyUI();
  if (permission === "granted") {
    toast("Browser notifications enabled.");
    showNotification({ title: "Browser alerts are on", body: "You will be nudged when a check-back is due.", application_id: null });
  } else {
    toast("Notifications were not enabled.");
  }
}

function seenKey(item) {
  return `${item.kind}:${item.application_id}:${item.due_at}`;
}

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem("lockedin_seen") || "[]"));
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  localStorage.setItem("lockedin_seen", JSON.stringify(Array.from(seen).slice(-250)));
}

function showNotification(item) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = [item.company, item.role, item.title].filter(Boolean).join(" · ");
  const options = {
    body,
    tag: item.application_id ? seenKey(item) : "lockedin-test",
    icon: "/static/icon.svg",
    data: { url: item.application_id ? `/?application=${item.application_id}` : "/" },
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then((registration) => registration.showNotification("Internship check-in", options));
  } else {
    const notification = new Notification("Internship check-in", options);
    notification.onclick = () => {
      window.focus();
      if (item.application_id) openDetail(item.application_id);
    };
  }
}

function maybeNotify() {
  const prefs = state.settings?.preferences || {};
  if (prefs.notifications_enabled === false) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const seen = loadSeen();
  const now = Date.now();
  let shown = 0;
  for (const item of state.due) {
    if (shown >= 3) break;
    if (seen.has(seenKey(item))) continue;
    if (Number(item.due_at) < now - 3 * 86400000) {
      seen.add(seenKey(item));
      continue;
    }
    seen.add(seenKey(item));
    showNotification(item);
    shown += 1;
  }
  saveSeen(seen);
}

async function poll() {
  if (!state.status?.authenticated) return;
  try {
    const feed = await api("/api/notifications");
    state.due = feed.due || [];
    state.upcoming = feed.upcoming || [];
    renderCounters();
    if (state.view === "today") {
      renderDue();
      renderUpcoming();
    }
    renderCalendarList();
    maybeNotify();
  } catch (err) {
    showBanner(err.message);
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(poll, 60000);
  maybeNotify();
}

document.addEventListener("DOMContentLoaded", boot);
