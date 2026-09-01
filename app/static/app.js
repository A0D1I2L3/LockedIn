/* Internship Dashboard — vanilla JS SPA. Talks to /api/*. */

const $ = (sel) => document.querySelector(sel);

const STAGE_NAMES = {
  application: "Applied",
  interview: "Interviewing",
  offer: "Offer",
  rejection: "Rejected",
  other: "Other",
};

let currentSort = { key: "date_ts", dir: -1 };

/* ---------------------------------------------------------------- utils */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stageTag(stage) {
  return `<span class="stage-tag stage-${esc(stage)}">${esc(STAGE_NAMES[stage] || stage)}</span>`;
}

function actionPill(msg) {
  if (!msg.needs_action) return "";
  return `<span class="action-pill">⚠ ${esc(msg.action_reason || "needs action")}</span>`;
}

/* ---------------------------------------------------------------- api */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* ---------------------------------------------------------------- state */

let state = {
  stats: null,
  companies: [],
  followups: [],
  messages: [],
  status: null,
};

function renderAll() {
  renderStats();
  renderFollowups();
  renderCompanies();
  renderMessages();
  renderBadge();
}

/* ---------------------------------------------------------------- topbar */

async function loadStatus() {
  const st = await api("/api/status");
  state.status = st;
  const auth = $("#auth-banner");
  auth.classList.toggle("hidden", st.auth);
  return st;
}

function renderBadge() {
  const badge = $("#sync-badge");
  const sync = state.status?.sync;
  if (!sync) return badge.classList.add("hidden");
  if (sync.running) {
    badge.textContent = "syncing…";
    badge.classList.remove("hidden", "spinning");
    badge.classList.add("spinning");
  } else if (state.status.last_completed_sync) {
    badge.textContent = `updated ${state.status.last_completed_sync}`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function refresh() {
  const btn = $("#refresh-btn");
  btn.disabled = true;
  btn.textContent = "Syncing…";
  $("#sync-error").classList.add("hidden");
  try {
    await api("/api/refresh", { method: "POST" });
    await pollWhileSyncing();
    await Promise.all([loadStatus(), loadStats(), loadCompanies(), loadFollowups(), loadMessages()]);
    renderAll();
  } catch (err) {
    const el = $("#sync-error");
    el.textContent = `Sync failed: ${err.message}`;
    el.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "⟳ Sync now";
  }
}

async function pollWhileSyncing() {
  for (let i = 0; i < 120; i++) {
    await sleep(1500);
    const st = await api("/api/status");
    state.status = st;
    renderBadge();
    if (!st.sync.running) return;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- stats */

async function loadStats() {
  state.stats = await api("/api/stats");
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  const set = (key, val) => {
    const el = $(`#stat-${key}`);
    if (el) el.textContent = val;
  };
  set("application", s.by_stage.application);
  set("interview", s.by_stage.interview);
  set("offer", s.by_stage.offer);
  set("rejection", s.by_stage.rejection);
  set("action", s.needs_action);
  set("total", s.total);
}

/* ---------------------------------------------------------------- companies */

async function loadCompanies() {
  state.companies = (await api("/api/companies")).companies;
}

function renderCompanies() {
  const wrap = $("#companies");
  if (!state.companies.length) {
    wrap.innerHTML = '<p class="empty">' + (state.status && !state.status.auth
      ? "Connect Gmail, then sync to populate the pipeline."
      : "No companies tracked yet.") + "</p>";
    return;
  }
  const rows = state.companies
    .map((c) => {
      const roles = c.roles?.filter(Boolean).join(", ") || "";
      return `<tr>
        <td class="company-name">${esc(c.company)}</td>
        <td>${stageTag(c.latest_stage)}</td>
        <td class="count">${c.message_count}</td>
        <td class="role-list">${roles ? esc(roles) : "—"}</td>
        <td class="last">${fmtDate(c.last_contact_ts)}</td>
      </tr>`;
    })
    .join("");
  wrap.innerHTML = `
    <table class="pipeline">
      <thead><tr>
        <th>Company</th><th>Status</th><th class="count">Emails</th><th>Roles</th><th>Last contact</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---------------------------------------------------------------- followups */

async function loadFollowups() {
  state.followups = (await api("/api/followups")).followups;
  $("#followup-count").textContent = state.followups.length;
}

function renderFollowups() {
  const el = $("#followups");
  if (!state.followups.length) {
    el.innerHTML = '<p class="empty">No follow-ups right now.</p>';
    return;
  }
  el.innerHTML = state.followups
    .map((m) => `
      <div class="email-row" onclick="openModal('${m.id}')">
        <div class="email-top">
          <span class="email-subject">${esc(m.company || m.from_name)} — ${esc(m.subject)}</span>
          <span class="email-date">${fmtDate(m.date_ts)} · ${m.days_old}d</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <span class="action-pill">⚠ ${esc(m.action_reason || "")}</span>
          <button class="btn btn-ghost" style="padding:2px 8px" onclick="event.stopPropagation();dismiss('${m.id}');return false">✓ done</button>
        </div>
      </div>`)
    .join("");
}

async function dismiss(id) {
  await api(`/api/messages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "dismiss" }),
  });
  await loadFollowups();
  renderFollowups();
}

/* ---------------------------------------------------------------- messages */

async function loadMessages() {
  const stage = $("#stage-filter").value;
  const q = $("#search").value.trim();
  const params = new URLSearchParams({ stage });
  if (q) params.set("q", q);
  const data = await api(`/api/messages?${params}`);
  state.messages = data.messages;
}

function renderMessages() {
  const el = $("#messages");
  if (!state.messages.length) {
    el.innerHTML = '<p class="empty">No emails match.</p>';
    return;
  }
  el.innerHTML = state.messages
    .map(
      (m) => `
      <div class="email-row" onclick="openModal('${m.id}')">
        <div class="email-top">
          <span class="email-subject">${esc(m.subject)}</span>
          ${stageTag(m.stage)}
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px">
          <span class="email-company">${esc(m.company || m.from_name)}</span>
          <span class="email-date">${fmtDate(m.date_ts)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <span class="email-snippet">${esc(m.snippet)}</span>
          ${actionPill(m)}
        </div>
      </div>`
    )
    .join("");
}

$("#stage-filter").addEventListener("change", async () => {
  await loadMessages();
  renderMessages();
});
$("#search").addEventListener("input", debounce(async () => {
  await loadMessages();
  renderMessages();
}, 350));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------------------------------------------------------------- modal */

const modalState = { id: null };

async function openModal(id) {
  modalState.id = id;
  const msg = state.messages.find((m) => m.id === id)
    || state.followups.find((m) => m.id === id);
  if (!msg) return;
  $("#modal-subject").textContent = msg.subject;
  $("#modal-meta").textContent =
    `${msg.company || msg.from_name} · ${msg.from_email} · ${new Date(msg.date_ts).toLocaleString()}`;
  $("#modal-stage").value = msg.stage;
  $("#modal-note").value = msg.note || "";
  $("#modal-body").textContent = "Loading body…";
  $("#modal").classList.remove("hidden");
  try {
    const { body } = await api(`/api/messages/${id}/body`);
    $("#modal-body").textContent = body;
  } catch (err) {
    $("#modal-body").textContent = `Couldn't load message: ${err.message}`;
  }
}

function closeModal() {
  $("#modal").classList.add("hidden");
}

async function saveModal() {
  const id = modalState.id;
  if (!id) return;
  await api(`/api/messages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      stage: $("#modal-stage").value,
      note: $("#modal-note").value,
    }),
  });
  closeModal();
  await Promise.all([loadStats(), loadCompanies(), loadFollowups(), loadMessages()]);
  renderAll();
}

$("#modal-close").addEventListener("click", closeModal);
$("#modal-save").addEventListener("click", saveModal);
$("#modal").addEventListener("click", (e) => { if (e.target === $("#modal")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#refresh-btn").addEventListener("click", refresh);

/* ---------------------------------------------------------------- boot */

(async function boot() {
  try {
    await loadStatus();
    if (state.status.auth) {
      $("#sync-error").classList.toggle("hidden", !state.status.sync.last_error);
      if (state.status.sync.last_error) {
        $("#sync-error").textContent = `Last sync failed: ${state.status.sync.last_error}`;
      }
      await Promise.all([loadStats(), loadCompanies(), loadFollowups(), loadMessages()]);
      if (state.status.sync.running) await pollWhileSyncing();
    }
  } catch (err) {
    const el = $("#sync-error");
    el.textContent = `Couldn't reach the backend: ${err.message}`;
    el.classList.remove("hidden");
  }
  renderAll();
})();