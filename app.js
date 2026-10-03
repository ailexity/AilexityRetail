const form = document.querySelector("#loginForm");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const rememberInput = document.querySelector("#remember");
const passwordToggle = document.querySelector("#passwordToggle");
const formMessage = document.querySelector("#formMessage");
const emailError = document.querySelector("#emailError");
const passwordError = document.querySelector("#passwordError");
const signupCard = document.querySelector("#signupCard");
const signupForm = document.querySelector("#signupForm");
const signupMessage = document.querySelector("#signupMessage");
const adminShell = document.querySelector("#adminShell");
const userShell = document.querySelector("#userShell");
const loginCard = document.querySelector("#loginCard");
const authScreen = document.querySelector("#authScreen"); // sign in + create your store
const landingScreen = document.querySelector("#landingScreen");
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
let authToken = localStorage.getItem("ailexityAuthToken") || sessionStorage.getItem("ailexityAuthToken");
let selectedUserId = null;

// ---- Small shared helpers ----
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const setText = (selector, text) => { document.querySelector(selector).textContent = text; };
const setStatus = (selector, text, isError = false) => { const el = document.querySelector(selector); el.textContent = text; el.classList.toggle("error", isError); };
let toastTimer = null;
function showToast(text) {
  document.querySelector(".toast")?.remove(); clearTimeout(toastTimer);
  const toast = document.createElement("div"); toast.className = "toast"; toast.setAttribute("role", "status"); toast.textContent = text; document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 2800);
}
// Wires a row of .chip[data-filter] buttons: clicking one marks it active and calls onChange(filter).
function setupChips(container, onChange) {
  container.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-filter]"); if (!chip) return;
    container.querySelectorAll(".chip").forEach((other) => { const active = other === chip; other.classList.toggle("active", active); other.setAttribute("aria-selected", String(active)); });
    onChange(chip.dataset.filter);
  });
}
// Keeps the count badge on each chip ("Pending 3") in sync with the data.
function setChipCounts(container, counts) {
  container.querySelectorAll(".chip[data-filter]").forEach((chip) => { const count = counts[chip.dataset.filter]; chip.querySelector("b")?.remove(); if (count !== undefined) { const badge = document.createElement("b"); badge.textContent = count; chip.append(badge); } });
}

// Browser chrome / status bar tint: dark on the photo screens, white inside the app so there is no band above the header.
const setThemeColor = (color) => { document.querySelector('meta[name="theme-color"]').content = color; };
const setMessage = (message, type = "") => {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`;
};
const ROLE_LABELS = { admin: "Superadmin", store: "Store owner" };

// Role verification happened on the server; open the workspace that matches the verified role.
// `welcome` ("login" or "signup") puts the welcome page over it: only right after the form, never when a saved session reopens the app.
function openWorkspace(result, { welcome = null } = {}) {
  landingScreen.hidden = true;
  authScreen.hidden = true;
  loginCard.hidden = true;
  signupCard.hidden = true;
  document.documentElement.classList.remove("restoring");
  document.body.classList.add("app-active"); document.body.classList.remove("signin-active"); setThemeColor("#ffffff");
  applyPlatform(result.platform);
  if (welcome) showWelcome(result, welcome);
  if (result.role === "store") {
    userShell.hidden = false; activateStoreTab("home");
    storeState.profile = result; applyStoreProfile();
    if (result.passwordResetRequired) afterWelcome(() => showToast("You're signed in with a temporary password — set your own under Profile → Security"));
    startStore();
  } else {
    adminShell.hidden = false; activateAdminTab("dashboard");
    loadUsers(); loadAdminSettings(); loadSentMessages(); loadInbox();
    startDashboard();
  }
}
// Header, profile card and greeting all reflect the retailer's profile (also re-run after they edit it in settings).
function applyStoreProfile() {
  const profile = storeState.profile; if (!profile) return;
  document.querySelector("#profileAvatar").textContent = userInitial(profile.storeName || profile.name);
  document.querySelector("#profileName").textContent = profile.name;
  document.querySelector("#profileEmail").textContent = profile.email;
  document.querySelector("#profileStore").textContent = profile.storeName || "";
  document.querySelector("#userGreeting").innerHTML = `<strong>${greetingFor(new Date())}</strong>${profile.storeName ? `<span>${escapeHtml(profile.storeName)}</span>` : ""}`;
  fillStoreSettings();
}

const validate = () => {
  let valid = true;
  emailError.textContent = "";
  passwordError.textContent = "";
  emailInput.closest(".field-group").classList.remove("valid");

  if (!emailInput.value.trim()) {
    emailError.textContent = "Enter your email to continue.";
    valid = false;
  } else if (!emailInput.validity.valid) {
    emailError.textContent = "Enter a valid email address.";
    valid = false;
  } else {
    emailInput.closest(".field-group").classList.add("valid");
  }

  if (!passwordInput.value) {
    passwordError.textContent = "Enter your password to continue.";
    valid = false;
  }

  return valid;
};

passwordToggle.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  passwordToggle.textContent = showing ? "Show" : "Hide";
  passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
});

emailInput.addEventListener("input", () => {
  if (emailInput.value.trim() && emailInput.validity.valid) {
    emailInput.closest(".field-group").classList.add("valid");
    emailError.textContent = "";
  }
});

// Login → authentication → role verification → dashboard. One form for every role.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  if (!validate()) return;
  const submitButton = form.querySelector(".submit-button");
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Authenticating…";
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to sign in");
    authToken = result.token;
    (rememberInput.checked ? localStorage : sessionStorage).setItem("ailexityAuthToken", authToken);
    const role = ROLE_LABELS[result.role] || "User";
    setMessage(`Verified as ${role}. Opening ${result.role === "admin" ? "the platform" : "your store"} dashboard…`, "success");
    submitButton.querySelector("span").textContent = `${role} verified ✓`;
    setTimeout(() => openWorkspace(result, { welcome: "login" }), 650);
  } catch (error) { setMessage(error.message, "error"); submitButton.disabled = false; submitButton.querySelector("span").textContent = "Sign in"; }
});

// Forgotten password: the store mails itself a temporary one. No superadmin in the loop.
document.querySelector("#forgotButton").addEventListener("click", async () => {
  const email = emailInput.value.trim();
  if (!email || !emailInput.validity.valid) { emailError.textContent = "Enter your email first, then tap Forgot?"; emailInput.focus(); return; }
  setMessage("Sending a temporary password…");
  try {
    const response = await fetch(`${API_BASE}/api/auth/forgot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send it");
    setMessage(result.message, "success");
  } catch (error) { setMessage(error.message, "error"); }
});

function resetLoginForm() {
  form.reset(); signupForm.reset();
  passwordInput.placeholder = "Enter your password";
  emailInput.closest(".field-group").classList.remove("valid");
  const submitButton = form.querySelector(".submit-button");
  submitButton.disabled = false;
  submitButton.querySelector("span").textContent = "Sign in";
  setMessage("");
}

// Wires a shell's bottom tab bar to its pages: each .tab-item[data-page] shows the
// matching [data-page] section, marks itself active/aria-current, and pushes its
// label into the header title. Pages without a tab (the store's Notes page) can still
// be activated by name; their title comes from the page's own h1.
function setupTabBar(shell, { pageSelector, activeClass, titleSelector }) {
  const tabs = [...shell.querySelectorAll(".tab-item")];
  const pages = [...shell.querySelectorAll(pageSelector)];
  const title = shell.querySelector(titleSelector);
  const activate = (target) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.page === target;
      tab.classList.toggle("active", isActive);
      if (isActive) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
    pages.forEach((page) => page.classList.toggle(activeClass, page.dataset.page === target));
    const label = tabs.find((tab) => tab.dataset.page === target)?.querySelector(".tab-label") || pages.find((page) => page.dataset.page === target)?.querySelector("h1");
    if (title && label) title.textContent = label.textContent;
    const scroller = shell.querySelector(".workspace-pages, .user-pages"); if (scroller) scroller.scrollTop = 0;
    shell.dispatchEvent(new CustomEvent("page:change", { detail: target }));
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.page)));
  return activate;
}

const activateAdminTab = setupTabBar(adminShell, { pageSelector: ".workspace-page", activeClass: "active-page", titleSelector: "#pageTitle" });
const activateStoreTab = setupTabBar(userShell, { pageSelector: ".user-page", activeClass: "active-user-page", titleSelector: "#userPageTitle" });

// ---- Dates & times (all computed on the device's clock, local time) ----
const startOfDay = (date) => { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; };
const startOfWeek = (date) => { const day = startOfDay(date); day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); return day; }; // Monday-based
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addDays = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate() + days); return copy; };
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const weekDays = (date) => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date), index));
const greetingFor = (date) => { const hour = date.getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; };
const formatLongDate = (date) => date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const formatShortDate = (date) => date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const formatTime = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
function relativeTime(iso, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatShortDate(new Date(iso));
}

// ---- Money ----
// Platform-wide settings (currency, WhatsApp country code, support contact) arrive with every login / session response.
const platform = { platformName: "Ailexity Retail", supportEmail: "", supportPhone: "", currency: "INR", whatsappCountryCode: "91" };
const applyPlatform = (next) => { if (next) Object.assign(platform, next); };
const formatMoney = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: platform.currency }).format(value || 0);
// Short form for stat tiles ("₹1.2L" / "₹12K") where a full amount would not fit.
const formatMoneyCompact = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: platform.currency, notation: "compact", maximumFractionDigits: 1 }).format(value || 0);

// ---- Superadmin dashboard: live clock + platform stats polled from /api/admin/dashboard ----
const DASHBOARD_POLL_MS = 30000;
const dashboard = { data: null, selectedDay: startOfDay(new Date()), clockTimer: null, pollTimer: null };
const EVENT_META = {
  created: { label: "Registered", icon: "+", className: "user-icon" },
  verified: { label: "Verified", icon: "✓", className: "" },
  activated: { label: "Activated", icon: "↗", className: "" },
  updated: { label: "Updated", icon: "✎", className: "neutral-icon" },
  password_reset: { label: "Password reset", icon: "↻", className: "alert-icon" },
};
const USER_STATUS_LABELS = { active: "Active", suspended: "Suspended", archived: "Closed" };
const userStatusBadge = (status) => `<span class="badge badge-${escapeHtml(status)}">${USER_STATUS_LABELS[status] || status}</span>`;

function tickClock() {
  const now = new Date();
  document.querySelector("#dashboardGreeting").textContent = greetingFor(now);
  document.querySelector("#dashboardDate").textContent = formatLongDate(now);
  const time = document.querySelector("#dashboardTime"); time.textContent = formatTime(now); time.dateTime = now.toISOString();
  // Past midnight: the strip's "today" marker (and possibly the whole week) has moved.
  const todayMarker = document.querySelector("#dateStrip .is-today");
  if (!todayMarker || !sameDay(new Date(todayMarker.dataset.day), now)) { dashboard.selectedDay = startOfDay(now); renderDateStrip(); renderDashboardStats(); }
}

function renderDateStrip() {
  const today = new Date();
  document.querySelector("#dateStrip").innerHTML = weekDays(today).map((day) => {
    const classes = [sameDay(day, dashboard.selectedDay) && "selected-day", sameDay(day, today) && "is-today"].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-day="${day.toISOString()}" aria-pressed="${sameDay(day, dashboard.selectedDay)}"><small>${day.toLocaleDateString([], { weekday: "narrow" })}</small><strong>${day.getDate()}</strong></button>`;
  }).join("");
  document.querySelectorAll("#dateStrip button").forEach((button) => button.addEventListener("click", () => { dashboard.selectedDay = startOfDay(new Date(button.dataset.day)); renderDateStrip(); renderDashboardStats(); }));
}

function renderDashboardStats() {
  const data = dashboard.data; if (!data) return;
  const now = Date.now(); const today = new Date();
  const perDay = weekDays(today).map((day) => data.events.filter((event) => sameDay(new Date(event.at), day)).length);
  const weekTotal = perDay.reduce((sum, count) => sum + count, 0);
  const dayCount = data.events.filter((event) => sameDay(new Date(event.at), dashboard.selectedDay)).length;
  document.querySelector("#dayEventCount").textContent = dayCount;
  document.querySelector("#dayEventUnit").textContent = dayCount === 1 ? "event" : "events";
  document.querySelector("#dayEventLabel").innerHTML = `${sameDay(dashboard.selectedDay, today) ? "Today" : formatShortDate(dashboard.selectedDay)} · <b>${weekTotal} this week</b>`;
  const peak = Math.max(1, ...perDay);
  document.querySelectorAll("#weekBars i").forEach((bar, index) => { bar.style.height = `${8 + Math.round((perDay[index] / peak) * 48)}px`; bar.classList.toggle("selected", sameDay(weekDays(today)[index], dashboard.selectedDay)); });

  const { users, sessions, orders = {}, revenue = {}, inventory = {}, recentRegistrations = [] } = data;
  document.querySelector("#activeAccounts").textContent = users.active;
  const accountNotes = [users.suspended && `${users.suspended} suspended`, users.archived && `${users.archived} closed`].filter(Boolean);
  document.querySelector("#activeAccountsNote").textContent = accountNotes.length ? accountNotes.join(" · ") : `of ${plural(users.total, "retailer")}`;
  document.querySelector("#signedInNow").textContent = sessions.store;
  document.querySelector("#signedInNote").textContent = `of ${plural(users.active, "active retailer")}`;

  // Retailer statistics. Stores sign themselves up, so there is no waiting state to count.
  setText("#statRetailersTotal", users.total); setText("#statRetailersActive", users.active);
  setText("#statRetailersSuspended", users.suspended); setText("#statRetailersArchived", users.archived || 0);
  // Order & revenue statistics across every store.
  setText("#statOrdersToday", orders.today ?? 0); setText("#statOrdersMonth", orders.month ?? 0); setText("#statOrdersPending", orders.pending ?? 0); setText("#statOrdersCancelled", orders.cancelled ?? 0);
  setText("#statRevenueToday", formatMoneyCompact(revenue.today)); setText("#statRevenueMonth", formatMoneyCompact(revenue.month)); setText("#statRevenuePending", formatMoneyCompact(revenue.pending)); setText("#statRevenueTotal", formatMoneyCompact(revenue.total));

  // Alerts: anything that needs the superadmin's attention, each linking to the relevant retailer filter. Settings → Alerts chooses which types show.
  const enabled = adminSettings.data?.alerts || {}; const on = (key) => enabled[key] !== false;
  const alerts = [
    on("suspended") && users.suspended && { level: "danger", filter: "suspended", text: `${plural(users.suspended, "account")} suspended` },
    on("pendingPayments") && orders.pending && { level: "info", text: `${plural(orders.pending, "order")} awaiting payment · ${formatMoney(revenue.pending)}` },
    on("outOfStock") && inventory.outOfStock && { level: "danger", text: `${plural(inventory.outOfStock, "item")} out of stock across stores` },
    on("lowStock") && inventory.lowStock && { level: "warn", text: `${plural(inventory.lowStock, "item")} running low across stores` },
    data.feedback?.new && { level: "info", page: "inbox", text: `${plural(data.feedback.new, "new message")} from stores in your inbox` },
  ].filter(Boolean);
  const inboxCount = document.querySelector("#inboxTabCount"); inboxCount.hidden = !data.feedback?.new; inboxCount.textContent = data.feedback?.new || "";
  const alertList = document.querySelector("#alertList");
  alertList.innerHTML = alerts.length
    ? alerts.map((alert) => alert.filter || alert.page ? `<button type="button" class="alert-row ${alert.level}" ${alert.page ? `data-page="${alert.page}"` : `data-filter="${alert.filter}"`}><i></i><span>${alert.text}</span><b>›</b></button>` : `<div class="alert-row ${alert.level}"><i></i><span>${alert.text}</span></div>`).join("")
    : `<div class="empty-activity">${Object.keys(enabled).length && !Object.values(enabled).some(Boolean) ? "All alert types are turned off in Settings." : "All clear. Nothing needs your attention right now."}</div>`;

  const registrations = document.querySelector("#registrationList");
  registrations.innerHTML = recentRegistrations.length
    ? recentRegistrations.map((user) => `<button type="button" class="activity-row registration-row" data-user-id="${user.id}"><span class="activity-icon user-icon">${escapeHtml(userInitial(user.storeName || user.name))}</span><div><strong>${escapeHtml(user.storeName || user.name)}</strong><small>${escapeHtml(user.storeName ? user.name : "")}${user.storeName ? " · " : ""}${relativeTime(user.createdAt, now)}</small></div>${userStatusBadge(user.status)}</button>`).join("")
    : '<div class="empty-activity">No retailers registered yet.</div>';

  const list = document.querySelector("#activityList");
  if (!data.events.length) { list.innerHTML = '<div class="empty-activity">No activity yet. Add a retailer to get started.</div>'; return; }
  list.innerHTML = data.events.slice(0, 5).map((event) => { const meta = EVENT_META[event.type] || { label: event.type, icon: "•", className: "neutral-icon" }; return `<div class="activity-row"><span class="activity-icon ${meta.className}">${meta.icon}</span><div><strong>${escapeHtml(event.name)}</strong><small>${relativeTime(event.at, now)} · ${formatShortDate(new Date(event.at))}</small></div><b>${meta.label}</b></div>`; }).join("");
}

async function loadDashboard() {
  try { dashboard.data = await apiRequest("/api/admin/dashboard"); renderDashboardStats(); }
  catch (error) { document.querySelector("#activityList").innerHTML = `<div class="empty-activity">${escapeHtml(error.message)}</div>`; }
}
function startDashboard() {
  stopDashboard();
  dashboard.selectedDay = startOfDay(new Date());
  renderDateStrip(); tickClock();
  dashboard.clockTimer = setInterval(tickClock, 1000);
  dashboard.pollTimer = setInterval(loadDashboard, DASHBOARD_POLL_MS);
  loadDashboard();
}
function stopDashboard() { clearInterval(dashboard.clockTimer); clearInterval(dashboard.pollTimer); dashboard.clockTimer = dashboard.pollTimer = null; }
document.addEventListener("visibilitychange", () => { if (!document.hidden && dashboard.pollTimer) loadDashboard(); });

// ---- Settings accordion (shared by the superadmin Settings page and the retailer Profile page) ----
function setupSettingsGroups(container) {
  container.addEventListener("click", (event) => {
    const row = event.target.closest(".settings-row"); if (!row) return;
    const group = row.closest(".settings-group"); if (!group.querySelector(".settings-form")) return; // e.g. Sign out
    const open = !group.classList.contains("open");
    container.querySelectorAll(".settings-group").forEach((other) => { const isOpen = other === group && open; other.classList.toggle("open", isOpen); const body = other.querySelector(".settings-form"); if (body) body.hidden = !isOpen; other.querySelector(".settings-row").setAttribute("aria-expanded", String(isOpen)); });
  });
}
function settingsMessage(form, text, isError = false) { const message = form.querySelector(".settings-message"); message.textContent = text; message.classList.toggle("error", isError); }
const checkPasswords = (form, next, confirm) => { if (next !== confirm) { settingsMessage(form, "New passwords do not match.", true); return false; } return true; };
setupSettingsGroups(document.querySelector("#adminSettings"));
setupSettingsGroups(document.querySelector("#storeSettings"));

// ---- Superadmin settings: platform profile, retailer defaults, alerts, security ----
const adminSettings = { data: null };
function fillAdminSettings() {
  const s = adminSettings.data; if (!s) return;
  document.querySelector("#platformName").value = s.platformName; document.querySelector("#supportEmail").value = s.supportEmail || ""; document.querySelector("#supportPhone").value = s.supportPhone || "";
  document.querySelector("#platformCurrency").value = s.currency; document.querySelector("#whatsappCode").value = s.whatsappCountryCode;
  document.querySelector("#platformAppUrl").value = s.appUrl || "";
  document.querySelector("#sessionHours").value = s.sessionHours;
  const boxes = [...document.querySelectorAll("#alertsForm [data-alert]")]; boxes.forEach((box) => { box.checked = s.alerts[box.dataset.alert] !== false; });
  setText("#platformProfileSummary", [s.platformName, s.currency, s.supportEmail || s.supportPhone].filter(Boolean).join(" · "));
  setText("#retailerDefaultsSummary", `${plural(s.sessionHours, "hour")} sessions`);
  const onCount = boxes.filter((box) => box.checked).length;
  setText("#alertsSummary", onCount === boxes.length ? "All alert types shown on the dashboard" : onCount ? `${onCount} of ${boxes.length} alert types shown on the dashboard` : "All alerts turned off");
  setText("#adminSecuritySummary", s.adminPasswordChangedAt ? `Password changed ${relativeTime(s.adminPasswordChangedAt)}` : "Using the password from the server configuration");
}
async function loadAdminSettings() {
  try { adminSettings.data = (await apiRequest("/api/admin/settings")).settings; fillAdminSettings(); renderDashboardStats(); }
  catch (error) { showToast(error.message); }
}
async function saveAdminSettings(form, payload, successText) {
  settingsMessage(form, "Saving…");
  try {
    const result = await apiRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(payload) });
    adminSettings.data = result.settings; applyPlatform(result.platform); fillAdminSettings(); renderDashboardStats(); loadDashboard();
    settingsMessage(form, successText); showToast(successText);
  } catch (error) { settingsMessage(form, error.message, true); }
}
document.querySelector("#platformProfileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveAdminSettings(event.target, { platformName: document.querySelector("#platformName").value, supportEmail: document.querySelector("#supportEmail").value, supportPhone: document.querySelector("#supportPhone").value, currency: document.querySelector("#platformCurrency").value, whatsappCountryCode: document.querySelector("#whatsappCode").value, appUrl: document.querySelector("#platformAppUrl").value }, "Platform profile saved");
});
document.querySelector("#retailerDefaultsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveAdminSettings(event.target, { sessionHours: document.querySelector("#sessionHours").value }, "Retailer defaults saved");
});
document.querySelector("#alertsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveAdminSettings(event.target, { alerts: Object.fromEntries([...event.target.querySelectorAll("[data-alert]")].map((box) => [box.dataset.alert, box.checked])) }, "Alert preferences saved");
});
document.querySelector("#adminPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.target;
  const next = document.querySelector("#adminNewPassword").value; if (!checkPasswords(form, next, document.querySelector("#adminConfirmPassword").value)) return;
  settingsMessage(form, "Updating…");
  try {
    const result = await apiRequest("/api/admin/password", { method: "POST", body: JSON.stringify({ currentPassword: document.querySelector("#adminCurrentPassword").value, newPassword: next }) });
    adminSettings.data = result.settings; form.reset(); fillAdminSettings(); settingsMessage(form, "Password updated."); showToast("Superadmin password updated");
  } catch (error) { settingsMessage(form, error.message, true); }
});
// Jump from the dashboard into the retailer list, optionally pre-filtered.
function openRetailers(filter = "all") {
  const chip = document.querySelector(`#userFilters .chip[data-filter="${filter}"]`) || document.querySelector('#userFilters .chip[data-filter="all"]');
  chip.click(); activateAdminTab("users");
}
document.querySelector("#viewAllActivity").addEventListener("click", () => openRetailers("all"));
document.querySelector("#viewAllRetailers").addEventListener("click", () => openRetailers("all"));
document.querySelector("#viewAlertsRetailers").addEventListener("click", () => openRetailers("all"));
document.querySelector("#alertList").addEventListener("click", (event) => { const row = event.target.closest("[data-filter], [data-page]"); if (!row) return; if (row.dataset.page) activateAdminTab(row.dataset.page); else openRetailers(row.dataset.filter); });
document.querySelector("#registrationList").addEventListener("click", (event) => { const row = event.target.closest("[data-user-id]"); if (row) { openRetailers("all"); openUserDetails(row.dataset.userId); } });

// Store user home: same real week, read-only.
// Store dashboard week strip: tapping a day makes the tiles, chart and order analytics show that day.
function renderUserDateStrip() {
  const today = new Date(); const selected = storeState.selectedDay || startOfDay(today);
  document.querySelector("#userDateStrip").innerHTML = weekDays(today).map((day) => `<button type="button" class="${[sameDay(day, selected) && "selected-user-day", sameDay(day, today) && "is-today"].filter(Boolean).join(" ")}" data-day="${day.toISOString()}" aria-pressed="${sameDay(day, selected)}">${day.toLocaleDateString([], { weekday: "short" }).toUpperCase()}<br /><b>${day.getDate()}</b></button>`).join("");
}
document.querySelector("#userDateStrip").addEventListener("click", (event) => {
  const button = event.target.closest("[data-day]"); if (!button) return;
  storeState.selectedDay = startOfDay(new Date(button.dataset.day)); renderUserDateStrip(); renderHomeStats();
});

// ---- Store workspace: items catalog, cart billing, order history ----
const LOW_STOCK_DEFAULT = 5;
const billNumber = (bill) => `#${String(bill.number).padStart(4, "0")}`;
const PAYMENT_LABELS = { cash: "Cash", card: "Card", upi: "UPI", credit: "Pay later" };
const BILL_STATUS_LABELS = { completed: "Completed", pending: "Pending", cancelled: "Cancelled", refunded: "Refunded" };
const PAYMENT_STATUS_LABELS = { completed: "Paid", pending: "Payment pending", cancelled: "Not paid", refunded: "Refunded" };
const TIMELINE_LABELS = { order_created: "Order created", bill_generated: "Bill generated", payment_confirmed: "Payment confirmed", invoice_generated: "Invoice generated", whatsapp_sent: "WhatsApp sent", cancelled: "Order cancelled", refunded: "Order refunded" };
const ORDER_FILTERS = { all: () => true, today: (bill) => sameDay(new Date(bill.createdAt), new Date()), pending: (bill) => bill.status === "pending", completed: (bill) => bill.status === "completed", cancelled: (bill) => bill.status === "cancelled", refunded: (bill) => bill.status === "refunded" };
const ORDER_DOTS = { completed: ["sale-dot", "↗"], pending: ["pending-dot", "…"], cancelled: ["stock-dot", "×"], refunded: ["refund-dot", "↩"] };
const formatClock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const invoiceLabel = (bill) => bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : `Bill ${billNumber(bill)}`;
const THUMB_CLASSES = ["coral-thumb", "green-thumb", "gray-thumb"];
const storeState = { profile: null, items: [], bills: [], cart: new Map(), search: "", itemFilter: "all", category: "", orderFilter: "all", salesRange: "daily", expandedBill: null, lastBillId: null, cartOpen: false, pickCategory: "", messages: [], snoozed: new Set(), messageTimer: null, notes: [], remindedIds: new Set(), reminderTimer: null, notesDay: 0, overdueCount: 0 };
const findItem = (id) => storeState.items.find((item) => item.id === id);
const findBill = (id) => storeState.bills.find((bill) => bill.id === id);
const itemThumb = (item) => `<span class="item-thumb ${THUMB_CLASSES[storeState.items.indexOf(item) % THUMB_CLASSES.length]}">${escapeHtml(userInitial(item.name))}</span>`;
// Item lifecycle: available → low stock (at or below its alert level) → out of stock.
const itemStatus = (item) => item.quantity === 0 ? "out" : item.quantity <= (item.lowStockThreshold ?? LOW_STOCK_DEFAULT) ? "low" : "ok";
const ITEM_STATUS_LABELS = { ok: "Available", low: "Low stock", out: "Out of stock" };
const itemBadge = (item) => { const status = itemStatus(item); return status === "ok" ? "" : `<span class="badge badge-${status}">${ITEM_STATUS_LABELS[status]}</span>`; };
const billBadge = (bill) => `<span class="badge badge-${bill.status}">${BILL_STATUS_LABELS[bill.status] || bill.status}</span>`;
// Orders that count as sales: cancelled and refunded ones are excluded from revenue.
const liveBills = () => storeState.bills.filter((bill) => bill.status !== "cancelled" && bill.status !== "refunded");

async function loadItems() { storeState.items = (await apiRequest("/api/store/items")).items; }
async function loadBills() { storeState.bills = (await apiRequest("/api/store/bills")).bills; }
function renderStorePages() {
  // Drop cart lines whose item vanished and cap the rest to what is actually in stock.
  for (const [id, quantity] of storeState.cart) { const item = findItem(id); if (!item || item.quantity < 1) storeState.cart.delete(id); else if (quantity > item.quantity) storeState.cart.set(id, item.quantity); }
  renderItems(); renderPickList(); renderCart(); renderLastBill(); renderHistory(); renderHomeStats(); renderReport();
}
async function startStore() {
  storeState.cart.clear(); storeState.search = ""; storeState.pickCategory = ""; storeState.expandedBill = null; storeState.lastBillId = null; storeState.selectedDay = startOfDay(new Date()); document.querySelector("#pickSearch").value = "";
  document.querySelector("#cartDiscount").value = "";
  document.querySelector("#cartTaxRate").value = storeState.profile?.settings?.taxRate || "";
  const today = new Date(); document.querySelector("#reportFrom").value = dateInputValue(startOfMonth(today)); document.querySelector("#reportTo").value = dateInputValue(today);
  renderUserDateStrip();
  try { await Promise.all([loadItems(), loadBills()]); renderStorePages(); }
  catch (error) { showToast(error.message); }
  startStoreMessages(); loadFeedbackHistory(); startNotes();
}

// Items page: catalog with stock filters (all / low / out) and category chips
function renderItems() {
  const { items } = storeState; const list = document.querySelector("#itemList");
  const counts = { all: items.length, low: items.filter((item) => itemStatus(item) === "low").length, out: items.filter((item) => itemStatus(item) === "out").length };
  setChipCounts(document.querySelector("#itemFilters"), counts);
  const stock = items.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector("#itemCount").textContent = items.length ? [`${plural(items.length, "item")} · ${stock} in stock`, counts.low && `${counts.low} low`, counts.out && `${counts.out} out`].filter(Boolean).join(" · ") : "No items yet";

  // Category chips come from the catalog itself; the datalist offers the same names when adding items.
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!categories.includes(storeState.category)) storeState.category = "";
  const categoryRow = document.querySelector("#categoryFilters");
  categoryRow.hidden = !categories.length;
  categoryRow.innerHTML = ['<button type="button" class="chip" data-filter="">All categories</button>', ...categories.map((category) => `<button type="button" class="chip" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`)].join("");
  categoryRow.querySelectorAll(".chip").forEach((chip) => { const active = chip.dataset.filter === storeState.category; chip.classList.toggle("active", active); chip.setAttribute("aria-selected", String(active)); });
  document.querySelector("#categoryOptions").innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");

  if (!items.length) { list.innerHTML = '<div class="empty-list">No items yet. Add your first product to start billing.</div>'; return; }
  const visible = items.filter((item) => (storeState.itemFilter === "all" || itemStatus(item) === storeState.itemFilter) && (!storeState.category || item.category === storeState.category));
  if (!visible.length) { list.innerHTML = `<div class="empty-list">${storeState.itemFilter === "low" ? "No items are running low." : storeState.itemFilter === "out" ? "Nothing is out of stock." : "No items in this category."}</div>`; return; }
  list.innerHTML = visible.map((item) => `<div class="item-row" data-item-id="${item.id}">${itemThumb(item)}<button type="button" class="item-main" data-edit><strong>${escapeHtml(item.name)}</strong><small>${itemBadge(item)}${formatMoney(item.price)}${item.category ? ` · ${escapeHtml(item.category)}` : ""}${item.sku ? ` · SKU ${escapeHtml(item.sku)}` : ""}</small></button><div class="qty-stepper"><button type="button" data-adjust="-1" aria-label="Decrease stock" ${item.quantity === 0 ? "disabled" : ""}>−</button><b>${item.quantity}</b><button type="button" data-adjust="1" aria-label="Increase stock">+</button></div></div>`).join("");
}
function openItemForm(item = null) {
  const form = document.querySelector("#itemForm"); form.reset(); form.hidden = false; setStatus("#itemFormMessage", "");
  document.querySelector("#itemFormId").value = item?.id || "";
  document.querySelector("#itemName").value = item?.name || "";
  document.querySelector("#itemPrice").value = item ? item.price : "";
  document.querySelector("#itemQuantity").value = item ? item.quantity : "";
  document.querySelector("#itemCategory").value = item?.category || (storeState.category || "");
  document.querySelector("#itemLowStock").value = item ? (item.lowStockThreshold ?? LOW_STOCK_DEFAULT) : "";
  document.querySelector("#itemSku").value = item?.sku || "";
  document.querySelector("#itemFormSubmit").textContent = item ? "Save changes" : "Add item";
  document.querySelector("#itemDeleteButton").hidden = !item;
  document.querySelector("#itemName").focus();
}
const closeItemForm = () => { document.querySelector("#itemForm").hidden = true; };
async function adjustItem(id, delta) {
  try {
    const result = await apiRequest(`/api/store/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ adjustQuantity: delta }) });
    const before = itemStatus(findItem(id)); Object.assign(findItem(id), result.item); renderStorePages();
    const after = itemStatus(result.item); if (after !== before && after !== "ok" && storeState.profile?.settings?.stockToasts !== false) showToast(`${result.item.name}: ${ITEM_STATUS_LABELS[after].toLowerCase()}`);
  } catch (error) { showToast(error.message); }
}
setupChips(document.querySelector("#itemFilters"), (filter) => { storeState.itemFilter = filter; renderItems(); });
setupChips(document.querySelector("#categoryFilters"), (category) => { storeState.category = category; renderItems(); });
document.querySelector("#addItemButton").addEventListener("click", () => openItemForm());
document.querySelector("#itemFormCancel").addEventListener("click", closeItemForm);
document.querySelector("#itemList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-item-id]"); if (!row) return;
  const stepper = event.target.closest("[data-adjust]");
  if (stepper) adjustItem(row.dataset.itemId, Number(stepper.dataset.adjust));
  else if (event.target.closest("[data-edit]")) openItemForm(findItem(row.dataset.itemId));
});
document.querySelector("#itemForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setStatus("#itemFormMessage", "Saving…");
  const id = document.querySelector("#itemFormId").value;
  const lowStock = document.querySelector("#itemLowStock").value;
  const payload = { name: document.querySelector("#itemName").value, price: document.querySelector("#itemPrice").value, quantity: document.querySelector("#itemQuantity").value, category: document.querySelector("#itemCategory").value, lowStockThreshold: lowStock === "" ? LOW_STOCK_DEFAULT : lowStock, sku: document.querySelector("#itemSku").value };
  try {
    await apiRequest(id ? `/api/store/items/${encodeURIComponent(id)}` : "/api/store/items", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    await loadItems(); renderStorePages(); closeItemForm(); showToast(id ? "Item updated" : `${payload.name.trim()} added`);
  } catch (error) { setStatus("#itemFormMessage", error.message, true); }
});
document.querySelector("#itemDeleteButton").addEventListener("click", async () => {
  const id = document.querySelector("#itemFormId").value; if (!id || !window.confirm("Delete this item from your catalog?")) return;
  try { await apiRequest(`/api/store/items/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadItems(); renderStorePages(); closeItemForm(); showToast("Item deleted"); }
  catch (error) { setStatus("#itemFormMessage", error.message, true); }
});

// Billing page: pick items into the cart, then complete the bill (optionally as "pay later" → pending)
function renderPickList() {
  const query = storeState.search.trim().toLowerCase(); const list = document.querySelector("#pickList");
  // Category chips (with item counts) come from the catalog; a chip narrows the grid, the search box narrows it further.
  const categories = [...new Set(storeState.items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!categories.includes(storeState.pickCategory)) storeState.pickCategory = "";
  const row = document.querySelector("#pickCategories"); row.hidden = !categories.length;
  row.innerHTML = [["", "All", storeState.items.length], ...categories.map((category) => [category, category, storeState.items.filter((item) => item.category === category).length])]
    .map(([value, label, count]) => `<button type="button" class="chip ${value === storeState.pickCategory ? "active" : ""}" data-filter="${escapeHtml(value)}" role="tab" aria-selected="${value === storeState.pickCategory}">${escapeHtml(label)}<b>${count}</b></button>`).join("");
  const inCategory = storeState.items.filter((item) => !storeState.pickCategory || item.category === storeState.pickCategory);
  const matches = inCategory.filter((item) => !query || item.name.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query) || (item.category || "").toLowerCase().includes(query));
  document.querySelector("#pickCount").textContent = storeState.items.length ? `${plural(matches.length, "item")}${storeState.pickCategory ? ` in ${storeState.pickCategory}` : ""} · tap to add` : "No items to sell yet";
  if (!storeState.items.length) { list.innerHTML = '<div class="empty-list">Your catalog is empty. Add items on the Items page first.</div>'; return; }
  if (!matches.length) { list.innerHTML = `<div class="empty-list">${query ? "No items match your search" : "No items in this category"}${storeState.pickCategory && query ? ` in ${escapeHtml(storeState.pickCategory)}` : ""}.</div>`; return; }
  // Square cards, 3 per row: tap the card to add one; once in the cart the card shows a − / + stepper and a count badge.
  list.innerHTML = matches.map((item) => {
    const inCart = storeState.cart.get(item.id) || 0; const left = item.quantity - inCart; const out = item.quantity === 0;
    const stock = out ? "Out of stock" : left > 0 ? `${left} available` : "All in cart";
    return `<div class="pick-card ${inCart ? "in-cart" : ""} ${out ? "is-out" : ""}" role="button" tabindex="0" data-pick="${item.id}" aria-disabled="${out || left <= 0}" aria-label="Add ${escapeHtml(item.name)}">${itemThumb(item)}${inCart ? `<span class="pick-badge">${inCart}</span>` : ""}<strong>${escapeHtml(item.name)}</strong><small>${stock}${item.category ? ` · ${escapeHtml(item.category)}` : ""}</small><div class="pick-action"><b class="pick-price">${formatMoney(item.price)}</b>${inCart ? `<span class="pick-stepper"><button type="button" data-pick-adjust="-1" aria-label="Remove one">−</button><button type="button" data-pick-adjust="1" aria-label="Add one" ${left <= 0 ? "disabled" : ""}>+</button></span>` : `<span class="pick-add" aria-hidden="true">+</span>`}</div></div>`;
  }).join("");
}
function cartLines() { return [...storeState.cart].map(([id, quantity]) => ({ item: findItem(id), quantity })).filter((line) => line.item); }
// Subtotal − discount (an amount, capped at the subtotal) + tax (a % of the discounted subtotal). The server recomputes the same figures.
function cartTotals() {
  const lines = cartLines(); const subtotal = lines.reduce((sum, { item, quantity }) => sum + item.price * quantity, 0);
  const discount = Math.min(Math.max(Number(document.querySelector("#cartDiscount").value) || 0, 0), subtotal);
  const taxRate = Math.min(Math.max(Number(document.querySelector("#cartTaxRate").value) || 0, 0), 100);
  const tax = Math.round((subtotal - discount) * taxRate) / 100;
  return { lines, subtotal, discount, taxRate, tax, total: Math.round((subtotal - discount + tax) * 100) / 100 };
}
function renderCart() {
  const { lines, subtotal, discount, taxRate, tax, total } = cartTotals();
  document.querySelector("#cartLines").innerHTML = lines.length
    ? lines.map(({ item, quantity }) => `<div class="cart-line" data-cart-id="${item.id}"><div><strong>${escapeHtml(item.name)}</strong><small>${formatMoney(item.price)} each</small></div><div class="qty-stepper"><button type="button" data-cart-adjust="-1" aria-label="Remove one">−</button><b>${quantity}</b><button type="button" data-cart-adjust="1" aria-label="Add one" ${quantity >= item.quantity ? "disabled" : ""}>+</button></div><b class="line-total">${formatMoney(item.price * quantity)}</b></div>`).join("")
    : '<div class="empty-list">Cart is empty. Tap an item to add it.</div>';
  document.querySelector("#cartItemCount").textContent = lines.reduce((sum, line) => sum + line.quantity, 0);
  document.querySelector("#cartSubtotal").textContent = formatMoney(subtotal);
  document.querySelector("#cartTaxLabel").textContent = storeState.profile?.settings?.taxLabel || "Tax";
  document.querySelector("#cartTax").textContent = `${formatMoney(tax)}${taxRate ? ` (${taxRate}%)` : ""}`;
  document.querySelector("#cartDiscountRow").hidden = !discount; document.querySelector("#cartDiscountAmount").textContent = `−${formatMoney(discount)}`;
  document.querySelector("#cartTotal").textContent = formatMoney(total);
  document.querySelector("#completeBillButton").disabled = !lines.length;
  document.querySelector("#completeBillButton").textContent = document.querySelector("#paymentMethod").value === "credit" ? "Save bill as pending" : "Complete bill";
  document.querySelector("#cartBarTitle").textContent = `${plural(lines.reduce((sum, line) => sum + line.quantity, 0), "item")} · ${plural(lines.length, "product")}`;
  document.querySelector("#cartBarMeta").textContent = storeState.cartOpen ? "Tap to hide the cart" : "Tap to review and complete the bill";
  document.querySelector("#cartBarTotal").textContent = formatMoney(total);
  renderCartBar();
}
// The floating cart lives above the tab bar on the billing page: the bar while the cart has items (expanding into the
// sheet on tap), or the last completed bill's WhatsApp panel once the cart is empty again. Elsewhere it is hidden.
function renderCartBar() {
  const onBilling = document.querySelector('.user-page[data-page="billing"]').classList.contains("active-user-page") && !userShell.hidden;
  const hasLines = cartLines().length > 0; const lastBill = storeState.lastBillId && findBill(storeState.lastBillId);
  if (!hasLines) storeState.cartOpen = false;
  const float = document.querySelector("#cartFloat"); float.hidden = !onBilling || !(hasLines || lastBill); float.classList.toggle("open", storeState.cartOpen);
  document.querySelector("#cartBar").hidden = !hasLines; document.querySelector("#cartBar").setAttribute("aria-expanded", String(storeState.cartOpen));
  document.querySelector("#cartSheet").hidden = !hasLines || !storeState.cartOpen;
  document.querySelector("#lastBill").hidden = hasLines || !lastBill;
  document.querySelector("#cartBackdrop").hidden = float.hidden || !storeState.cartOpen;
  document.querySelector(".user-pages").classList.toggle("with-cart-bar", !float.hidden);
  document.body.classList.toggle("cart-bar-visible", !float.hidden);
}
function toggleCartSheet(open = !storeState.cartOpen) { storeState.cartOpen = open; renderCart(); if (open) document.querySelector("#cartSheet").scrollTop = 0; }
document.querySelector("#cartBar").addEventListener("click", () => toggleCartSheet());
document.querySelector("#cartBackdrop").addEventListener("click", () => toggleCartSheet(false));
document.querySelector("#lastBillClose").addEventListener("click", () => { storeState.lastBillId = null; renderLastBill(); });
userShell.addEventListener("page:change", (event) => {
  storeState.cartOpen = false; renderCart(); if (event.detail === "home") maybeShowMessagePopup();
  document.querySelector("#notesButton").classList.toggle("active", event.detail === "notes" || event.detail === "note"); if (event.detail === "notes") renderNotes();
});

// ---- Messages from the superadmin: popup on the dashboard for unread ones, a card listing active ones, a dot on the tab ----
const MESSAGE_LEVEL_LABELS = { info: "Information", important: "Important", urgent: "Urgent" };

// ---- Messages to the superadmin (store → platform, one way): compose on the Profile page, keep a history with status ----
const FEEDBACK_CATEGORIES = { feedback: ["Feedback", "badge-info"], issue: ["Problem", "badge-urgent"], request: ["Request", "badge-important"], other: ["Other", "badge-archived"] };
const FEEDBACK_STATUS = { new: ["Sent", "badge-important"], seen: ["Seen", "badge-archived"], resolved: ["Resolved", "badge-completed"] };
const feedbackState = { items: [] };
function renderFeedbackHistory() {
  const name = platform.platformName || "Ailexity Retail"; const { items } = feedbackState;
  setText("#feedbackTitle", `Message ${name}`);
  setText("#feedbackSummary", items.length ? `${plural(items.length, "message")} sent · ${items.filter((item) => item.status === "new").length} not seen yet` : "Feedback, problems or requests for the superadmin");
  document.querySelector("#feedbackHistory").innerHTML = items.length
    ? items.map((item) => { const [category, categoryClass] = FEEDBACK_CATEGORIES[item.category] || [item.category, "badge-archived"]; const [status, statusClass] = FEEDBACK_STATUS[item.status]; return `<div class="sent-message"><div class="message-head"><span class="badge ${categoryClass}">${category}</span><span class="badge ${statusClass}">${status === "Seen" ? `Seen by ${escapeHtml(name)}` : status}</span><small>${relativeTime(item.createdAt)}</small></div><strong>${escapeHtml(item.subject)}</strong><p>${escapeHtml(item.message)}</p></div>`; }).join("")
    : '<div class="empty-activity">Nothing sent yet.</div>';
}
async function loadFeedbackHistory() { try { feedbackState.items = (await apiRequest("/api/store/feedback")).feedback; renderFeedbackHistory(); } catch { /* history is best-effort */ } }
document.querySelector("#feedbackForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.target; settingsMessage(form, "Sending…");
  try {
    await apiRequest("/api/store/feedback", { method: "POST", body: JSON.stringify({ category: document.querySelector("#feedbackCategory").value, subject: document.querySelector("#feedbackSubject").value, message: document.querySelector("#feedbackText").value }) });
    form.reset(); settingsMessage(form, `Sent to ${platform.platformName || "Ailexity Retail"}.`); showToast("Message sent"); loadFeedbackHistory();
  } catch (error) { settingsMessage(form, error.message, true); }
});
const MESSAGE_POLL_MS = 60000;
const messageTimeLeft = (message) => { const hours = Math.max(0, Math.ceil((Date.parse(message.expiresAt) - Date.now()) / 3600000)); return hours < 1 ? "expiring now" : hours < 48 ? `${plural(hours, "hour")} left` : `${plural(Math.ceil(hours / 24), "day")} left`; };
async function loadStoreMessages() {
  try { storeState.messages = (await apiRequest("/api/store/messages")).messages; renderStoreMessages(); maybeShowMessagePopup(); }
  catch { /* the dashboard still works without messages */ }
}
function startStoreMessages() { stopStoreMessages(); storeState.snoozed = new Set(); loadStoreMessages(); storeState.messageTimer = setInterval(loadStoreMessages, MESSAGE_POLL_MS); }
function stopStoreMessages() { clearInterval(storeState.messageTimer); storeState.messageTimer = null; storeState.messages = []; document.querySelector("#messagePopup").hidden = true; }
document.addEventListener("visibilitychange", () => { if (!document.hidden && storeState.messageTimer) loadStoreMessages(); });
function renderStoreMessages() {
  const { messages } = storeState; const unread = messages.filter((message) => !message.read).length; const card = document.querySelector("#storeMessages");
  card.hidden = !messages.length; document.querySelector("#homeTabDot").hidden = !unread;
  setText("#storeMessagesTitle", `Messages from ${platform.platformName || "Ailexity Retail"}`);
  const badge = document.querySelector("#storeMessagesUnread"); badge.hidden = !unread; badge.textContent = `${unread} new`;
  document.querySelector("#storeMessagesList").innerHTML = messages.map((message) => `<div class="message-row ${message.read ? "" : "unread"} level-${message.level}" data-message-id="${message.id}"><div class="message-head"><span class="badge badge-${message.level}">${MESSAGE_LEVEL_LABELS[message.level] || message.level}</span><small>${relativeTime(message.createdAt)} · ${messageTimeLeft(message)}</small></div><strong>${escapeHtml(message.title)}</strong><p>${escapeHtml(message.message)}</p>${message.read ? "" : '<button type="button" class="text-button" data-message-read>Mark as read</button>'}</div>`).join("");
}
async function markMessageRead(id) {
  const message = storeState.messages.find((entry) => entry.id === id); if (!message || message.read) return;
  message.read = true; renderStoreMessages();
  try { await apiRequest(`/api/store/messages/${encodeURIComponent(id)}/read`, { method: "POST" }); } catch { /* re-fetched on the next poll */ }
}
document.querySelector("#storeMessagesList").addEventListener("click", (event) => { const button = event.target.closest("[data-message-read]"); if (button) markMessageRead(button.closest("[data-message-id]").dataset.messageId); });
// Only interrupts on the dashboard; "Later" keeps the message unread but quiet until the next sign-in.
function maybeShowMessagePopup() {
  const onHome = document.querySelector('.user-page[data-page="home"]').classList.contains("active-user-page") && !userShell.hidden;
  const pending = storeState.messages.filter((message) => !message.read && !storeState.snoozed.has(message.id));
  const popup = document.querySelector("#messagePopup");
  if (!onHome || !pending.length) { popup.hidden = true; maybeShowReminderPopup(); return; } // a reminder waits behind platform messages
  const message = pending[0]; popup.dataset.messageId = message.id;
  const level = document.querySelector("#messagePopupLevel"); level.className = `badge badge-${message.level}`; level.textContent = MESSAGE_LEVEL_LABELS[message.level] || message.level;
  setText("#messagePopupTitle", message.title); setText("#messagePopupText", message.message);
  setText("#messagePopupMeta", `From ${platform.platformName || "Ailexity Retail"} · ${relativeTime(message.createdAt)} · ${messageTimeLeft(message)}`);
  setText("#messagePopupCount", pending.length > 1 ? `${pending.length - 1} more message${pending.length > 2 ? "s" : ""} after this` : "");
  popup.hidden = false;
}
document.querySelector("#messagePopupOk").addEventListener("click", async () => { await markMessageRead(document.querySelector("#messagePopup").dataset.messageId); maybeShowMessagePopup(); });
document.querySelector("#messagePopupLater").addEventListener("click", () => { for (const message of storeState.messages) if (!message.read) storeState.snoozed.add(message.id); maybeShowMessagePopup(); });

// ---- Notes (header button → Notes page): free-text notes opened in an editor, optionally with a reminder (date + time) ----
// A note is the editor's HTML (the server reduces it to plain formatting, bullets and checklists) and its first line is the title.
// Notes save themselves while you type. A note with a date and time is a reminder: it pops up when its time comes while the app
// is open, is listed first until it is ticked, and reminder dates and times stay as the phone typed them (device clock throughout).
const REMINDER_TICK_MS = 30000;
const NOTE_SAVE_DELAY_MS = 800;
const noteEditor = document.querySelector("#noteEditor");
const findNote = (id) => storeState.notes.find((note) => note.id === id);
const isReminder = (note) => Boolean(note.dueDate && note.dueTime);
const noteDone = (note) => Boolean(note.doneAt);
const noteStamp = (note) => note.updatedAt || note.createdAt;
const noteBody = (note) => note.text.split("\n").slice(1).join("\n");
const dueMoment = (dueDate, dueTime) => { const [year, month, date] = dueDate.split("-").map(Number); const [hours, minutes] = dueTime.split(":").map(Number); return new Date(year, month - 1, date, hours, minutes, 0, 0); };
const noteDueAt = (note) => isReminder(note) ? dueMoment(note.dueDate, note.dueTime) : null;
const noteOverdue = (note, now = new Date()) => { const due = noteDueAt(note); return Boolean(due) && !noteDone(note) && due < now; };
const noteDueToday = (note, now = new Date()) => { const due = noteDueAt(note); return Boolean(due) && !noteDone(note) && due < addDays(startOfDay(now), 1); };
function whenLabel(due) {
  const dayGap = Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);
  const day = dayGap === 0 ? "Today" : dayGap === 1 ? "Tomorrow" : dayGap === -1 ? "Yesterday" : formatShortDate(due);
  return `${day} at ${formatClock(due)}`;
}
const noteWhenLabel = (note) => { const due = noteDueAt(note); return due ? whenLabel(due) : ""; };
async function loadNotes() { storeState.notes = (await apiRequest("/api/store/notes")).notes; }
function startNotes() {
  stopNotes(); storeState.notesDay = startOfDay(new Date()).getTime();
  loadNotes().then(() => { renderNotes(); checkReminders(); }).catch((error) => { showToast(error.message); renderNotes(); });
  storeState.reminderTimer = setInterval(checkReminders, REMINDER_TICK_MS);
}
function stopNotes() {
  clearInterval(storeState.reminderTimer); storeState.reminderTimer = null; storeState.notes = []; storeState.remindedIds = new Set();
  clearTimeout(editorState.timer); Object.assign(editorState, { id: null, open: false, dirty: false, saving: null }); noteEditor.innerHTML = "";
  document.querySelector("#reminderPopup").hidden = true; document.querySelector("#notesCount").hidden = true;
}
const openReminders = (notes) => notes.filter((note) => isReminder(note) && !noteDone(note)).sort((a, b) => noteDueAt(a) - noteDueAt(b));
const otherNotes = (notes) => notes.filter((note) => !isReminder(note) || noteDone(note)).sort((a, b) => Date.parse(noteStamp(b)) - Date.parse(noteStamp(a)));
// Checklist items inside a note, in document order, so a tick in a list can be written back to the same <li> in the HTML.
const noteItems = (note) => [...new DOMParser().parseFromString(note.html || "", "text/html").querySelectorAll("ul.todo > li")].map((item, index) => ({ index, text: item.textContent.trim(), checked: item.dataset.checked === "true" })).filter((item) => item.text);
const previewLines = (note) => noteBody(note).split("\n").filter((line) => line && !/^[☐☑] /.test(line));
// One row for every list (Notes page and dashboard card): title, a short preview, the reminder time or date, and tickable checklist items.
function noteRowHtml(note, itemLimit = Infinity) {
  const reminder = isReminder(note) && !noteDone(note); const overdue = noteOverdue(note); const items = noteItems(note);
  const lines = previewLines(note).slice(0, items.length ? 2 : 3); const ticked = items.filter((item) => item.checked).length;
  const meta = reminder
    ? `${overdue ? '<span class="badge badge-urgent">Overdue</span> · ' : ""}<span class="note-when">${escapeHtml(noteWhenLabel(note))}</span>${items.length ? ` · ${ticked} of ${items.length} done` : ""}`
    : `${formatShortDate(new Date(noteStamp(note)))}${noteDone(note) ? ` · <span class="badge badge-completed">Reminded</span> ${escapeHtml(noteWhenLabel(note))}` : ""}${items.length ? ` · ${ticked} of ${items.length} done` : ""}`;
  const shown = items.slice(0, itemLimit); const more = items.length - shown.length;
  const checklist = items.length ? `<div class="note-items">${shown.map((item) => `<label class="note-item ${item.checked ? "done" : ""}"><input type="checkbox" data-item-index="${item.index}" ${item.checked ? "checked" : ""} /><span>${escapeHtml(item.text)}</span></label>`).join("")}${more > 0 ? `<button type="button" class="note-more" data-open>+${more} more</button>` : ""}</div>` : "";
  const preview = lines.length ? `<span class="note-snippet">${escapeHtml(lines.join("\n"))}</span>` : "";
  return `<div class="note-row ${reminder ? "reminder" : "plain"} ${overdue ? "overdue" : ""}" data-note-id="${note.id}">${reminder ? '<button type="button" class="note-check" data-toggle aria-label="Mark as done">✓</button>' : ""}<button type="button" class="item-main" data-open><strong>${escapeHtml(note.title)}</strong>${reminder ? `<small>${meta}</small>${preview}` : `${preview}<small>${meta}</small>`}</button>${checklist}</div>`;
}
function renderNotes() {
  const { notes } = storeState; const reminders = openReminders(notes); const plain = otherNotes(notes);
  const today = reminders.filter((note) => noteDueToday(note)).length; const overdue = reminders.filter((note) => noteOverdue(note)).length;
  storeState.overdueCount = overdue;
  document.querySelector("#noteCount").textContent = notes.length ? [plural(plain.length, "note"), reminders.length && plural(reminders.length, "reminder"), overdue && `${overdue} overdue`].filter(Boolean).join(" · ") : "No notes yet";
  // Header badge: reminders due today or overdue and not yet done.
  const badge = document.querySelector("#notesCount"); badge.hidden = !today; badge.textContent = today;
  document.querySelector("#reminderSection").hidden = !reminders.length; document.querySelector("#noteListLabel").hidden = !reminders.length;
  document.querySelector("#reminderList").innerHTML = reminders.map((note) => noteRowHtml(note)).join("");
  const list = document.querySelector("#noteList");
  list.innerHTML = plain.length ? plain.map((note) => noteRowHtml(note)).join("") : `<div class="empty-list">${notes.length ? "Every note here is a reminder — they are listed above." : "Nothing here yet. Tap + Note to start writing, or Reminder to set one."}</div>`;
  renderHomeNotes();
}
// Dashboard card: the next three reminders and the three latest notes, with a few checklist items each.
function renderHomeNotes() {
  const { notes } = storeState; const reminders = openReminders(notes).slice(0, 3); const plain = otherNotes(notes).slice(0, 3);
  document.querySelector("#homeNotesList").innerHTML = notes.length
    ? [reminders.length && `<p class="section-label">Reminders</p><div class="note-list-inline">${reminders.map((note) => noteRowHtml(note, 4)).join("")}</div>`, plain.length && `<p class="section-label">Notes</p><div class="note-list-inline">${plain.map((note) => noteRowHtml(note, 4)).join("")}</div>`].filter(Boolean).join("")
    : '<div class="empty-activity">No notes yet — tap See all to write one or set a reminder.</div>';
}
document.querySelector("#homeNotesSeeAll").addEventListener("click", () => activateStoreTab("notes"));
document.querySelector("#notesButton").addEventListener("click", () => {
  const page = document.querySelector(".user-page.active-user-page")?.dataset.page;
  if (page === "note") closeNoteEditor(); else activateStoreTab(page === "notes" ? "home" : "notes");
});
// ---- Editor ----
const editorState = { id: null, open: false, dirty: false, timer: null, saving: null, returnTo: "notes" };
const editorEmpty = () => !noteEditor.innerText.replace(/​/g, "").trim();
const updateEditorEmpty = () => noteEditor.classList.toggle("is-empty", editorEmpty());
const setNoteStatus = (text, isError = false) => setStatus("#noteStatus", text, isError);
async function openNoteEditor(note = null, { remind = false } = {}) {
  if (editorState.open) await finishEditor();
  const from = document.querySelector(".user-page.active-user-page")?.dataset.page; const returnTo = from === "home" ? "home" : "notes";
  clearTimeout(editorState.timer); Object.assign(editorState, { id: note?.id || null, open: true, dirty: false, returnTo });
  document.querySelector("#noteBackLabel").textContent = returnTo === "home" ? "Dashboard" : "Notes";
  noteEditor.innerHTML = note?.html || ""; // already reduced to safe tags by the server
  noteEditor.dataset.placeholder = remind ? "What should I remind you about?" : "Start writing…";
  document.querySelector("#noteDate").value = note?.dueDate || (remind ? dateInputValue(new Date()) : "");
  document.querySelector("#noteTime").value = note?.dueTime || "";
  setReminderRow(remind || Boolean(note?.dueDate));
  document.querySelector("#noteDeleteButton").hidden = !note;
  setNoteStatus(""); updateEditorEmpty(); updateToolbar();
  activateStoreTab("note");
  if (!note) noteEditor.focus();
  try { document.execCommand("styleWithCSS", false, false); } catch { /* old engines */ }
}
function setReminderRow(show) {
  document.querySelector("#noteRemind").hidden = !show;
  const button = document.querySelector("#noteRemindButton"); button.classList.toggle("active", show); button.setAttribute("aria-pressed", String(show));
  renderRemindHint();
}
// The reminder counts only once both a date and a time are picked; until then the note saves without one.
const reminderFields = () => { const row = document.querySelector("#noteRemind"); const dueDate = row.hidden ? "" : document.querySelector("#noteDate").value; const dueTime = row.hidden ? "" : document.querySelector("#noteTime").value; return dueDate && dueTime ? { dueDate, dueTime } : { dueDate: "", dueTime: "" }; };
function renderRemindHint() {
  const dueDate = document.querySelector("#noteDate").value; const dueTime = document.querySelector("#noteTime").value; const note = editorState.id && findNote(editorState.id);
  const hint = document.querySelector("#noteRemindHint"); hint.classList.remove("error");
  if (!dueDate && !dueTime) hint.textContent = "Pick a date and a time";
  else if (!dueDate || !dueTime) { hint.textContent = dueDate ? "Now pick a time" : "Now pick a date"; hint.classList.add("error"); }
  else hint.textContent = `${note && noteDone(note) && note.dueDate === dueDate && note.dueTime === dueTime ? "Done · was due" : dueMoment(dueDate, dueTime) < new Date() ? "This time has already passed · due" : "Reminder set for"} ${whenLabel(dueMoment(dueDate, dueTime))}`;
}
function scheduleNoteSave() { editorState.dirty = true; setNoteStatus("Saving…"); clearTimeout(editorState.timer); editorState.timer = setTimeout(saveNote, NOTE_SAVE_DELAY_MS); }
// One request at a time; a change made while a save is in flight is saved right after it.
async function saveNote(options = {}) {
  clearTimeout(editorState.timer);
  if (editorState.saving) { await editorState.saving; }
  if (!editorState.dirty || !editorState.open || editorEmpty()) { if (!editorState.dirty) setNoteStatus(editorState.id ? "Saved" : ""); return; }
  const id = editorState.id; const payload = { html: noteEditor.innerHTML, ...reminderFields() };
  editorState.dirty = false;
  const run = (async () => {
    try {
      const result = await apiRequest(id ? `/api/store/notes/${encodeURIComponent(id)}` : "/api/store/notes", { method: id ? "PATCH" : "POST", body: JSON.stringify(payload), keepalive: Boolean(options.keepalive) });
      const existing = findNote(result.note.id);
      if (existing) Object.assign(existing, result.note); else storeState.notes.unshift(result.note);
      if (!id) { editorState.id = result.note.id; document.querySelector("#noteDeleteButton").hidden = false; }
      if (!editorState.dirty) setNoteStatus("Saved");
      renderNotes(); renderRemindHint(); checkReminders();
    } catch (error) { editorState.dirty = true; setNoteStatus(error.message, true); }
  })();
  editorState.saving = run; await run; if (editorState.saving === run) editorState.saving = null;
  if (editorState.dirty && editorState.open) return saveNote(options);
}
// Leaving the editor: an emptied note is deleted (a new empty one is simply dropped), anything else is saved.
async function finishEditor() {
  if (!editorState.open) return; clearTimeout(editorState.timer);
  if (editorState.saving) await editorState.saving;
  if (editorEmpty()) {
    if (editorState.id) { try { await apiRequest(`/api/store/notes/${encodeURIComponent(editorState.id)}`, { method: "DELETE" }); } catch { /* it will still be there next time */ } storeState.notes = storeState.notes.filter((note) => note.id !== editorState.id); }
  } else if (editorState.dirty) await saveNote();
  Object.assign(editorState, { id: null, open: false, dirty: false }); renderNotes();
}
async function closeNoteEditor() { const { returnTo } = editorState; await finishEditor(); activateStoreTab(returnTo); }
document.querySelector("#addNoteButton").addEventListener("click", () => openNoteEditor());
document.querySelector("#addReminderButton").addEventListener("click", () => openNoteEditor(null, { remind: true }));
document.querySelector("#noteBack").addEventListener("click", closeNoteEditor);
document.querySelector("#noteDeleteButton").addEventListener("click", async () => {
  const id = editorState.id; if (!id || !window.confirm("Delete this note?")) return;
  clearTimeout(editorState.timer); if (editorState.saving) await editorState.saving;
  try { await apiRequest(`/api/store/notes/${encodeURIComponent(id)}`, { method: "DELETE" }); storeState.notes = storeState.notes.filter((note) => note.id !== id); const { returnTo } = editorState; Object.assign(editorState, { id: null, open: false, dirty: false }); renderNotes(); activateStoreTab(returnTo); showToast("Note deleted"); }
  catch (error) { setNoteStatus(error.message, true); }
});
document.querySelector("#noteRemindButton").addEventListener("click", () => {
  const show = document.querySelector("#noteRemind").hidden;
  if (show && !document.querySelector("#noteDate").value) document.querySelector("#noteDate").value = dateInputValue(new Date());
  setReminderRow(show); if (show) document.querySelector("#noteTime").focus(); scheduleNoteSave();
});
document.querySelector("#noteRemindClear").addEventListener("click", () => { document.querySelector("#noteDate").value = ""; document.querySelector("#noteTime").value = ""; setReminderRow(false); scheduleNoteSave(); });
document.querySelector("#noteDate").addEventListener("change", () => { renderRemindHint(); scheduleNoteSave(); });
document.querySelector("#noteTime").addEventListener("change", () => { renderRemindHint(); scheduleNoteSave(); });
noteEditor.addEventListener("input", () => { updateEditorEmpty(); scheduleNoteSave(); });
// Pasted content comes in as plain text so the note keeps only the editor's own formatting.
noteEditor.addEventListener("paste", (event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); });
// Formatting toolbar: mousedown is cancelled so the editor keeps its selection while the button is tapped.
const selectionAncestor = (name) => { let node = window.getSelection()?.anchorNode; if (!node || !noteEditor.contains(node)) return null; while (node && node !== noteEditor) { if (node.nodeName === name) return node; node = node.parentNode; } return null; };
function updateToolbar() {
  const list = selectionAncestor("UL");
  document.querySelectorAll("#noteToolbar [data-cmd]").forEach((button) => { let active = false; try { active = document.queryCommandState(button.dataset.cmd); } catch { /* unsupported */ } button.classList.toggle("active", active); });
  document.querySelector('#noteToolbar [data-list="bullet"]').classList.toggle("active", Boolean(list) && !list.classList.contains("todo"));
  document.querySelector('#noteToolbar [data-list="todo"]').classList.toggle("active", Boolean(list?.classList.contains("todo")));
}
// Bullets and checklists are both <ul>; a checklist is the one with class "todo". Choosing the kind already in use turns the list off.
function toggleList(kind) {
  noteEditor.focus(); const current = selectionAncestor("UL");
  if (current && current.classList.contains("todo") === (kind === "todo")) document.execCommand("insertUnorderedList");
  else { if (!current) document.execCommand("insertUnorderedList"); const list = selectionAncestor("UL"); if (list) list.classList.toggle("todo", kind === "todo"); }
  updateEditorEmpty(); scheduleNoteSave(); updateToolbar();
}
document.querySelector("#noteToolbar").addEventListener("mousedown", (event) => event.preventDefault());
document.querySelector("#noteToolbar").addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.dataset.list) toggleList(button.dataset.list);
  else { noteEditor.focus(); document.execCommand(button.dataset.cmd); scheduleNoteSave(); updateToolbar(); }
});
document.addEventListener("selectionchange", () => { if (editorState.open) updateToolbar(); });
// Checklist items: tapping the box at the left of a line ticks it; a new line after a ticked item starts unticked.
noteEditor.addEventListener("click", (event) => {
  const item = event.target.closest("ul.todo > li"); if (!item || !noteEditor.contains(item)) return;
  if (event.clientX - item.getBoundingClientRect().left > 28) return;
  event.preventDefault(); if (item.dataset.checked === "true") delete item.dataset.checked; else item.dataset.checked = "true"; scheduleNoteSave();
});
noteEditor.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !selectionAncestor("UL")?.classList.contains("todo")) return;
  setTimeout(() => { const item = selectionAncestor("LI"); if (item && !item.textContent.trim()) delete item.dataset.checked; }, 0);
});
// Leaving the page (tab bar, another app, closing the browser) still saves what was typed.
userShell.addEventListener("page:change", (event) => { if (editorState.open && event.detail !== "note") finishEditor(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && editorState.open && editorState.dirty) saveNote({ keepalive: true }); });
window.addEventListener("pagehide", () => { if (editorState.open && editorState.dirty) saveNote({ keepalive: true }); });
// ---- Lists: tick a reminder or a checklist item from the Notes page or the dashboard card; tap anything else to open the note ----
// The screen updates first and the note is saved behind it; on failure it is re-fetched so the screen matches the server.
async function patchNote(note, payload) {
  try { Object.assign(note, (await apiRequest(`/api/store/notes/${encodeURIComponent(note.id)}`, { method: "PATCH", body: JSON.stringify(payload) })).note); }
  catch (error) { showToast(error.message); try { Object.assign(note, (await apiRequest(`/api/store/notes/${encodeURIComponent(note.id)}`)).note); } catch { /* keep what we have */ } }
  renderNotes();
}
function toggleReminder(note) { const done = !noteDone(note); note.doneAt = done ? new Date().toISOString() : null; renderNotes(); return patchNote(note, { done }); }
// A tick in a list is written into the note's own HTML (the same <li> the editor shows), so both stay in step.
function setNoteItem(note, index, checked) {
  const doc = new DOMParser().parseFromString(note.html || "", "text/html"); const item = doc.querySelectorAll("ul.todo > li")[index]; if (!item) return;
  if (checked) item.setAttribute("data-checked", "true"); else item.removeAttribute("data-checked");
  note.html = doc.body.innerHTML; renderNotes(); patchNote(note, { html: note.html });
}
function bindNoteList(container) {
  container.addEventListener("click", (event) => {
    const row = event.target.closest("[data-note-id]"); if (!row) return; const note = findNote(row.dataset.noteId); if (!note) return;
    if (event.target.closest("[data-toggle]")) toggleReminder(note);
    else if (event.target.closest("[data-open]")) openNoteEditor(note);
  });
  container.addEventListener("change", (event) => {
    const box = event.target.closest("input[data-item-index]"); if (!box) return;
    const note = findNote(box.closest("[data-note-id]").dataset.noteId); if (note) setNoteItem(note, Number(box.dataset.itemIndex), box.checked);
  });
}
bindNoteList(document.querySelector(".user-page[data-page=notes]")); bindNoteList(document.querySelector("#homeNotes"));
// ---- Reminder popup: when a reminder's time comes today while the app is open ----
// "Mark done" ticks it, "Later" keeps it quiet until the next sign-in. Older overdue reminders just show in the list with an Overdue badge.
const dueReminders = (now = new Date()) => storeState.notes.filter((note) => isReminder(note) && !noteDone(note) && !storeState.remindedIds.has(note.id) && noteDueAt(note) <= now && sameDay(noteDueAt(note), now)).sort((a, b) => noteDueAt(a) - noteDueAt(b));
function checkReminders() {
  if (userShell.hidden) return;
  const day = startOfDay(new Date()).getTime();
  if (storeState.notesDay !== day) { storeState.notesDay = day; renderNotes(); } // past midnight: "Today" / "Tomorrow" labels move
  else if (storeState.notes.filter((note) => noteOverdue(note)).length !== storeState.overdueCount) renderNotes(); // an "Overdue" badge just became due
  maybeShowReminderPopup();
}
function maybeShowReminderPopup() {
  const popup = document.querySelector("#reminderPopup"); const pending = dueReminders();
  if (!pending.length || !document.querySelector("#messagePopup").hidden) { popup.hidden = true; return; }
  const note = pending[0]; popup.dataset.noteId = note.id;
  setText("#reminderPopupTitle", note.title); setText("#reminderPopupText", noteBody(note).slice(0, 300)); setText("#reminderPopupMeta", noteWhenLabel(note));
  setText("#reminderPopupCount", pending.length > 1 ? `${pending.length - 1} more reminder${pending.length > 2 ? "s" : ""} after this` : "");
  popup.hidden = false;
}
document.querySelector("#reminderPopupDone").addEventListener("click", () => { const note = findNote(document.querySelector("#reminderPopup").dataset.noteId); if (note) { storeState.remindedIds.add(note.id); toggleReminder(note); } maybeShowReminderPopup(); });
document.querySelector("#reminderPopupLater").addEventListener("click", () => { const note = findNote(document.querySelector("#reminderPopup").dataset.noteId); if (note) storeState.remindedIds.add(note.id); maybeShowReminderPopup(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && storeState.reminderTimer) checkReminders(); });
function changeCart(id, delta) {
  const item = findItem(id); if (!item) return;
  const next = (storeState.cart.get(id) || 0) + delta;
  if (next <= 0) storeState.cart.delete(id); else if (next > item.quantity) { showToast(`Only ${item.quantity} × ${item.name} in stock`); return; } else storeState.cart.set(id, next);
  renderPickList(); renderCart(); setStatus("#billingMessage", "");
}
document.querySelector("#pickSearch").addEventListener("input", (event) => { storeState.search = event.target.value; renderPickList(); });
setupChips(document.querySelector("#pickCategories"), (category) => { storeState.pickCategory = category; renderPickList(); });
function pickCardAction(event) {
  const card = event.target.closest("[data-pick]"); if (!card) return;
  const stepper = event.target.closest("[data-pick-adjust]");
  if (stepper) { if (!stepper.disabled) changeCart(card.dataset.pick, Number(stepper.dataset.pickAdjust)); return; }
  if (card.getAttribute("aria-disabled") !== "true") changeCart(card.dataset.pick, 1);
}
document.querySelector("#pickList").addEventListener("click", pickCardAction);
document.querySelector("#pickList").addEventListener("keydown", (event) => { if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-pick]")) { event.preventDefault(); pickCardAction(event); } });
document.querySelector("#cartLines").addEventListener("click", (event) => { const button = event.target.closest("[data-cart-adjust]"); if (button) changeCart(button.closest("[data-cart-id]").dataset.cartId, Number(button.dataset.cartAdjust)); });
document.querySelector("#clearCartButton").addEventListener("click", () => { storeState.cart.clear(); renderPickList(); renderCart(); setStatus("#billingMessage", ""); });
document.querySelector("#paymentMethod").addEventListener("change", renderCart);
document.querySelector("#cartDiscount").addEventListener("input", renderCart);
document.querySelector("#cartTaxRate").addEventListener("input", renderCart);
document.querySelector("#completeBillButton").addEventListener("click", async () => {
  const button = document.querySelector("#completeBillButton"); button.disabled = true; setStatus("#billingMessage", "Saving bill…");
  try {
    const { discount, taxRate } = cartTotals();
    const payload = { paymentMethod: document.querySelector("#paymentMethod").value, customerName: document.querySelector("#customerName").value, customerPhone: document.querySelector("#customerPhone").value, discount, taxRate, lines: [...storeState.cart].map(([itemId, quantity]) => ({ itemId, quantity })) };
    const result = await apiRequest("/api/store/bills", { method: "POST", body: JSON.stringify(payload) });
    const bill = result.bill; const pending = bill.status === "pending";
    storeState.cart.clear(); storeState.cartOpen = false; storeState.bills.unshift(bill); storeState.lastBillId = bill.id;
    document.querySelector("#customerName").value = ""; document.querySelector("#customerPhone").value = ""; document.querySelector("#cartDiscount").value = "";
    await loadItems(); renderStorePages();
    setStatus("#billingMessage", pending ? `Bill ${billNumber(bill)} saved as pending · collect payment later · ${formatMoney(bill.total)}` : `Order completed · ${invoiceLabel(bill)} generated · ${formatMoney(bill.total)}`);
    showToast(pending ? `Bill ${billNumber(bill)} saved as pending` : `${invoiceLabel(bill)} generated`);
  } catch (error) {
    setStatus("#billingMessage", error.message, true);
    try { await loadItems(); renderStorePages(); } catch {} // stock may have changed underneath us
  }
});
// The bill just completed stays on the billing page so the invoice can be sent straight away.
function renderLastBill() {
  const bill = storeState.lastBillId && findBill(storeState.lastBillId);
  renderCartBar(); if (!bill) return;
  document.querySelector("#lastBillTitle").textContent = `${invoiceLabel(bill)} · ${formatMoney(bill.total)}`;
  document.querySelector("#lastBillMeta").textContent = [plural(bill.itemCount, "item"), PAYMENT_LABELS[bill.paymentMethod], bill.customerName, bill.whatsappSentAt ? `WhatsApp sent ${relativeTime(bill.whatsappSentAt)}` : "Not sent on WhatsApp yet"].filter(Boolean).join(" · ");
  document.querySelector("#lastBillWhatsApp").textContent = bill.whatsappSentAt ? "Resend on WhatsApp" : "Send invoice on WhatsApp";
}
document.querySelector("#lastBillWhatsApp").addEventListener("click", () => { const bill = findBill(storeState.lastBillId); if (bill) sendInvoiceOnWhatsApp(bill); });

// ---- RET.ai, the store's AI assistant (header button → AI page): chat about sales, revenue, stock and customers ----
// The server builds a fresh snapshot of the store's numbers for every question, so answers always reflect the latest bills.
// Every conversation is kept (data/ai-chats.json) and listed under "Chat history" on the same page.
const AI_SAMPLE_QUESTIONS = [
  "How were my sales today compared to yesterday?",
  "Give me a summary of this week's revenue",
  "Which products are selling the most this month?",
  "Which items are low on stock and need reordering?",
  "What are my busiest days and hours?",
  "How much money is still unpaid by customers?",
  "Compare this month with last month",
  "Suggest 3 ways to increase my sales",
];
const aiState = { chats: [], current: null, loaded: false, enabled: true, pending: null, historyOpen: false };
const aiThread = document.querySelector("#aiThread"); const aiInput = document.querySelector("#aiInput");

// Answers come back as simple Markdown: headings, bullet / numbered lists, **bold**, *italic*, `code`. Escaped first, so nothing else gets through.
function aiMarkdown(text) {
  const inline = (line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const html = []; let list = null; let paragraph = [];
  const flush = () => { if (paragraph.length) { html.push(`<p>${paragraph.join("<br />")}</p>`); paragraph = []; } if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim(); let match;
    if (!line) { flush(); continue; }
    if ((match = line.match(/^#{1,6}\s+(.*)$/))) { flush(); html.push(`<h4>${inline(match[1])}</h4>`); continue; }
    if ((match = line.match(/^(?:[-*•])\s+(.*)$/)) || (match = line.match(/^\d+[.)]\s+(.*)$/))) {
      const type = /^\d/.test(line) ? "ol" : "ul";
      if (paragraph.length) { html.push(`<p>${paragraph.join("<br />")}</p>`); paragraph = []; }
      if (list !== type) { if (list) html.push(`</${list}>`); html.push(`<${type}>`); list = type; }
      html.push(`<li>${inline(match[1])}</li>`); continue;
    }
    if (list) { html.push(`</${list}>`); list = null; }
    paragraph.push(inline(line));
  }
  flush(); return html.join("");
}
const aiScroller = () => document.querySelector("#userShell .user-pages");
const aiScrollToEnd = () => requestAnimationFrame(() => { const scroller = aiScroller(); scroller.scrollTop = scroller.scrollHeight; });
const aiMessageHtml = (message) => message.role === "user"
  ? `<div class="ai-message ai-user"><div class="ai-bubble">${escapeHtml(message.text).replace(/\n/g, "<br />")}</div></div>`
  : `<div class="ai-message ai-bot"><span class="ai-avatar" aria-hidden="true"><i class="ret-mark"></i></span><div class="ai-bubble">${aiMarkdown(message.text)}<small>${formatClock(new Date(message.at))} · RET.ai</small></div></div>`;
const aiChatRowHtml = (chat) => `<div class="ai-chat-row${aiState.current?.id === chat.id ? " current" : ""}" data-chat-id="${escapeHtml(chat.id)}"><button type="button" class="ai-chat-open"><strong>${escapeHtml(chat.title)}</strong><small>${relativeTime(chat.updatedAt)} · ${plural(Math.ceil(chat.messageCount / 2), "question")}${chat.preview ? ` · ${escapeHtml(chat.preview)}` : ""}</small></button><button type="button" class="ai-chat-delete" aria-label="Delete chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14" /><path d="M9.5 7V4.5h5V7" /><path d="M7 7l.8 12.5h8.4L17 7" /></svg></button></div>`;

function renderAiHistory() {
  const panel = document.querySelector("#aiHistory"); const toggle = document.querySelector("#aiHistoryToggle"); const { chats } = aiState;
  document.querySelector("#aiHistoryLabel").textContent = chats.length ? `Chat history (${chats.length})` : "Chat history";
  panel.hidden = !aiState.historyOpen; toggle.setAttribute("aria-expanded", String(aiState.historyOpen)); toggle.classList.toggle("open", aiState.historyOpen);
  panel.innerHTML = chats.length ? chats.map(aiChatRowHtml).join("") : '<div class="empty-list">No chats yet — ask a question below to start one.</div>';
}
function renderAiThread() {
  const { current, pending } = aiState;
  const messages = [...(current?.messages || [])];
  const waiting = pending && pending.chatId === (current?.id || null);
  if (waiting) messages.push({ role: "user", text: pending.question });
  document.querySelector("#aiSetup").hidden = aiState.enabled;
  if (!messages.length) {
    // New chat: a greeting, sample questions to tap, and the latest few chats to pick up again.
    const name = storeState.profile?.name?.split(" ")[0];
    aiThread.innerHTML = `<div class="ai-welcome"><span class="ai-welcome-icon" aria-hidden="true"><i class="ret-mark"></i></span><strong>${greetingFor(new Date())}${name ? `, ${escapeHtml(name)}` : ""}!</strong><p>I'm RET.ai, Ailexity's retail AI. I know your store's sales, orders, stock and customers — ask me anything about how the business is doing.</p></div>`
      + `<p class="section-label">Try asking</p><div class="ai-samples">${AI_SAMPLE_QUESTIONS.map((question) => `<button type="button" class="ai-sample" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}</div>`
      + (aiState.chats.length && !aiState.historyOpen ? `<div class="section-row ai-recent-head"><p class="section-label">Recent chats</p>${aiState.chats.length > 3 ? '<button type="button" class="ai-see-all" id="aiSeeAll">See all</button>' : ""}</div><article class="item-list ai-recent">${aiState.chats.slice(0, 3).map(aiChatRowHtml).join("")}</article>` : "");
    return;
  }
  aiThread.innerHTML = messages.map(aiMessageHtml).join("") + (waiting ? '<div class="ai-message ai-bot"><span class="ai-avatar" aria-hidden="true"><i class="ret-mark"></i></span><div class="ai-bubble ai-typing" aria-label="RET.ai is thinking"><i></i><i></i><i></i></div></div>' : "");
}
function renderAi() { renderAiHistory(); renderAiThread(); document.querySelector("#aiSend").disabled = Boolean(aiState.pending); }

async function loadAiChats() {
  try { const result = await apiRequest("/api/store/ai/chats"); aiState.chats = result.chats; aiState.enabled = result.enabled; aiState.loaded = true; }
  catch (error) { showToast(error.message); }
  renderAi();
}
async function openAiChat(id) {
  aiState.historyOpen = false;
  try { aiState.current = (await apiRequest(`/api/store/ai/chats/${encodeURIComponent(id)}`)).chat; }
  catch (error) { showToast(error.message); return loadAiChats(); }
  renderAi(); aiScrollToEnd();
}
function newAiChat() { aiState.current = null; aiState.historyOpen = false; renderAi(); aiScroller().scrollTop = 0; aiInput.focus(); }
async function deleteAiChat(id) {
  const chat = aiState.chats.find((entry) => entry.id === id); if (!chat || !confirm(`Delete the chat "${chat.title}"?`)) return;
  try {
    await apiRequest(`/api/store/ai/chats/${encodeURIComponent(id)}`, { method: "DELETE" });
    aiState.chats = aiState.chats.filter((entry) => entry.id !== id); if (aiState.current?.id === id) aiState.current = null;
    renderAi(); showToast("Chat deleted");
  } catch (error) { showToast(error.message); }
}
async function askAiQuestion(question) {
  question = question.trim(); if (!question || aiState.pending) return;
  const chatId = aiState.current?.id || null;
  aiState.pending = { chatId, question }; aiInput.value = ""; resizeAiInput(); renderAi(); aiScrollToEnd();
  try {
    const { chat } = await apiRequest("/api/store/ai/chats", { method: "POST", body: JSON.stringify({ message: question, chatId, tz: new Date().getTimezoneOffset() }) });
    const stillHere = (aiState.current?.id || null) === chatId; aiState.pending = null;
    if (stillHere) aiState.current = chat;
    const summary = { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length, preview: chat.messages.at(-1).text.replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) };
    aiState.chats = [summary, ...aiState.chats.filter((entry) => entry.id !== chat.id)];
    renderAi(); if (stillHere) aiScrollToEnd();
  } catch (error) {
    aiState.pending = null; renderAi(); showToast(error.message);
    if ((aiState.current?.id || null) === chatId && !aiInput.value) { aiInput.value = question; resizeAiInput(); } // give the question back so it can be sent again
  }
}
function resizeAiInput() { aiInput.style.height = "auto"; aiInput.style.height = `${Math.min(aiInput.scrollHeight, 140)}px`; }
function stopAi() { Object.assign(aiState, { chats: [], current: null, loaded: false, enabled: true, pending: null, historyOpen: false }); aiThread.innerHTML = ""; aiInput.value = ""; }

document.querySelector("#aiButton").addEventListener("click", () => {
  const page = document.querySelector(".user-page.active-user-page")?.dataset.page;
  activateStoreTab(page === "ai" ? "home" : "ai"); // an open note saves itself on the way out
});
document.querySelector("#aiNewChat").addEventListener("click", newAiChat);
document.querySelector("#aiHistoryToggle").addEventListener("click", () => { aiState.historyOpen = !aiState.historyOpen; renderAi(); });
document.querySelector("#aiComposer").addEventListener("submit", (event) => { event.preventDefault(); askAiQuestion(aiInput.value); });
aiInput.addEventListener("input", resizeAiInput);
aiInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); askAiQuestion(aiInput.value); } });
document.querySelector(".user-page[data-page=ai]").addEventListener("click", (event) => {
  const sample = event.target.closest(".ai-sample"); if (sample) return askAiQuestion(sample.dataset.question);
  if (event.target.closest("#aiSeeAll")) { aiState.historyOpen = true; renderAi(); aiScroller().scrollTop = 0; return; }
  const row = event.target.closest(".ai-chat-row"); if (!row) return;
  if (event.target.closest(".ai-chat-delete")) deleteAiChat(row.dataset.chatId); else openAiChat(row.dataset.chatId);
});
userShell.addEventListener("page:change", (event) => {
  document.querySelector("#aiButton").classList.toggle("active", event.detail === "ai");
  if (event.detail !== "ai") return;
  renderAi(); if (aiState.current) aiScrollToEnd();
  loadAiChats();
});

// ---- Sharing an invoice: a link the customer can open, and the WhatsApp message around it ----

// New bills carry their share token from the server, so the customer link can be built inside the
// tap that opens WhatsApp — no await in the way, nothing for a popup blocker to catch. Bills made
// before this existed get a token from /share the first time they are opened.
const mintedTokens = new Map();
function invoiceUrl(bill) {
  const token = bill.shareToken || mintedTokens.get(bill.id);
  if (!token) return null;
  const base = String(platform.appUrl || "").replace(/\/+$/, "") || location.origin;
  return `${base}/invoice/${token}`;
}
// The link always goes into the message. If the store is running on a local address the customer
// will not be able to open it once they leave the shop, so the store is told to set a public
// address — once per session, not on every bill — but the link is never silently dropped.
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)|\.local$/i;
function linkReachesCustomers(url) {
  try { return !PRIVATE_HOST.test(new URL(url).hostname); } catch { return false; }
}
let warnedAboutLocalLink = false;
function customerInvoiceUrl(bill) {
  const url = invoiceUrl(bill);
  if (!url) return null;
  if (!linkReachesCustomers(url) && !warnedAboutLocalLink) {
    warnedAboutLocalLink = true;
    showToast("This invoice link points at a local address. Set the public app address under Settings → Platform profile so customers can open it.");
  }
  return url;
}
async function ensureInvoiceUrl(bill) {
  const existing = invoiceUrl(bill);
  if (existing) return existing;
  try {
    const result = await apiRequest(`/api/store/bills/${encodeURIComponent(bill.id)}/share`, { method: "POST" });
    mintedTokens.set(bill.id, result.token);
    return invoiceUrl(bill);
  } catch { return null; }
}

// The message a customer receives: who sold it, what it came to, and a link. The itemised bill,
// the tax split and every other particular are on the invoice the link opens — repeating them in a
// chat only buries the one number the customer is looking for. WhatsApp renders *bold*; the rest is
// plain text so it survives forwarding.
function invoiceText(bill, link) {
  const profile = storeState.profile || {};
  const settings = profile.settings || {};
  const name = profile.storeName || profile.name || "Our store";
  const at = new Date(bill.createdAt);
  const paid = bill.status === "completed" || bill.status === "refunded";
  // No invoice number until the bill is paid, so an unpaid one is headed as the bill it still is.
  const reference = bill.invoiceNumber
    ? `${settings.gstin ? "Tax Invoice" : "Invoice"} ${bill.invoiceNumber}`
    : `Bill ${billNumber(bill)}`;
  const method = PAYMENT_LABELS[bill.paymentMethod] || bill.paymentMethod;
  const statusNote = { cancelled: "CANCELLED", refunded: "REFUNDED" }[bill.status];

  const out = [
    `*${name}*`,
    `${reference} · ${formatShortDate(at)}, ${formatClock(at)}`,
    "",
    `*${paid ? "Amount paid" : "Amount due"} ${formatMoney(bill.total)}* · ${method} · ${plural(bill.itemCount, "item")}`,
  ];
  if (statusNote) out.push(statusNote);
  if (link) out.push("", `Invoice: ${link}`);
  if (settings.invoiceNote) out.push("", settings.invoiceNote);

  const footer = [name, settings.showContactOnInvoice !== false ? profile.phone : ""].filter(Boolean).join(" · ");
  if (footer) out.push(settings.invoiceNote ? footer : `\n${footer}`);

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const whatsappDigits = (phone) => { let digits = String(phone || "").replace(/\D/g, ""); if (digits.length === 10) digits = platform.whatsappCountryCode + digits; return digits; };
function whatsappLink(message, phone) { return `https://wa.me/${whatsappDigits(phone)}?text=${encodeURIComponent(message)}`; }
// Hands the invoice to WhatsApp without leaving this page. On phones a new browser window would stay behind as a blank
// page once WhatsApp took over, so the app is opened directly through its URL scheme; desktops get WhatsApp Web in a new tab.
// If nothing takes over the screen within a moment — WhatsApp is not installed, or a desktop browser is pretending to be a
// phone (DevTools device mode sends an Android user agent, and desktop Chrome has no handler for intent:// links) — the same
// conversation opens in WhatsApp Web instead, so the button never silently does nothing.
function openWhatsApp(message, phone) {
  const digits = whatsappDigits(phone); const text = encodeURIComponent(message); const ua = navigator.userAgent;
  const web = whatsappLink(message, phone);
  const openWeb = () => { const tab = window.open(web, "_blank"); if (tab) tab.opener = null; else location.href = web; }; // a blocked pop-up still gets there
  const android = /Android/i.test(ua) || navigator.userAgentData?.platform === "Android";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!android && !ios) { openWeb(); return; }
  const fallback = setTimeout(() => { if (!document.hidden) openWeb(); }, 1500);
  const settle = () => clearTimeout(fallback); // the app took over (page hidden) or the fallback URL is loading in this tab
  document.addEventListener("visibilitychange", () => { if (document.hidden) settle(); }, { once: true });
  window.addEventListener("pagehide", settle, { once: true });
  // Android: an intent URL opens the app when installed and otherwise loads wa.me in this tab. iOS: the app's own URL scheme.
  location.href = android
    ? `intent://send?phone=${digits}&text=${text}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${encodeURIComponent(web)};end`
    : `whatsapp://send?phone=${digits}&text=${text}`;
}
// Customer mobile number → open WhatsApp with the invoice → mark the order "WhatsApp sent".
async function sendInvoiceOnWhatsApp(bill, phoneOverride) {
  const phone = phoneOverride !== undefined && phoneOverride.trim() ? phoneOverride.trim() : bill.customerPhone;
  // Nearly always already there (minted with the bill, or pre-warmed when the row was opened).
  if (!invoiceUrl(bill)) await ensureInvoiceUrl(bill);
  openWhatsApp(invoiceText(bill, customerInvoiceUrl(bill)), phone); // inside the tap, so browsers treat it as a user action
  try {
    await updateBill(bill.id, { whatsappSent: true, ...(phone !== bill.customerPhone ? { customerPhone: phone } : {}) });
    renderStorePages(); showToast(`${invoiceLabel(bill)} marked as sent on WhatsApp`);
  } catch (error) { showToast(error.message); }
}

// ---- View invoice: the customer's receipt, rendered from the shared template ----
const invoicePopup = document.querySelector("#invoicePopup");
let invoiceOnScreen = null;
function invoiceViewData(bill) {
  const profile = storeState.profile || {};
  const settings = profile.settings || {};
  const showContact = settings.showContactOnInvoice !== false;
  return {
    store: {
      name: profile.storeName || profile.name || "Store", owner: profile.name || "",
      phone: showContact ? profile.phone || "" : "", address: showContact ? profile.address || "" : "",
      businessType: profile.businessType || "",
      legalName: settings.legalName || "", gstin: settings.gstin || "",
      placeOfSupply: settings.placeOfSupply || "", fssai: settings.fssai || "",
    },
    invoiceNote: settings.invoiceNote || "", terms: settings.terms || "",
    currency: platform.currency || "INR",
    platformName: platform.platformName || "Ailexity Retail",
    bill,
  };
}
function openInvoiceView(bill) {
  invoiceOnScreen = bill;
  document.querySelector("#invoicePopupTitle").textContent = invoiceLabel(bill);
  document.querySelector("#invoiceBody").innerHTML = window.AilexityInvoice.render(invoiceViewData(bill));
  invoicePopup.hidden = false;
  document.querySelector("#invoiceClose").focus();
  ensureInvoiceUrl(bill); // so "Copy invoice link" is ready by the time it is tapped
}
function closeInvoiceView() { invoicePopup.hidden = true; invoiceOnScreen = null; }
document.querySelector("#invoiceClose").addEventListener("click", closeInvoiceView);
invoicePopup.addEventListener("click", (event) => { if (event.target === invoicePopup) closeInvoiceView(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !invoicePopup.hidden) closeInvoiceView(); });
document.querySelector("#invoiceShareLink").addEventListener("click", async () => {
  if (!invoiceOnScreen) return;
  const url = invoiceUrl(invoiceOnScreen) || await ensureInvoiceUrl(invoiceOnScreen);
  if (!url) return showToast("Could not create a link for this invoice");
  try { await navigator.clipboard.writeText(url); showToast("Invoice link copied"); }
  catch { showToast("Copy needs HTTPS. Send it on WhatsApp instead."); }
});
document.querySelector("#invoicePrint").addEventListener("click", () => {
  if (!invoiceOnScreen) return;
  const url = invoiceUrl(invoiceOnScreen);
  if (url) window.open(url, "_blank", "noopener");
  else showToast("Preparing the invoice link — try again in a moment");
});

// Orders page: bills newest first, filtered by status / today, expandable to the full order detail and lifecycle actions
function orderDetail(bill, now) {
  const at = new Date(bill.createdAt);
  const field = (label, value) => `<div class="order-field"><span>${label}</span><b>${value}</b></div>`;
  const when = (iso) => `<small>${relativeTime(iso, now)}</small>`;
  return `<div class="order-detail">
    ${field("Date &amp; time", `${formatShortDate(at)} · ${formatClock(at)}`)}
    ${field("Customer", bill.customerName || bill.customerPhone ? `${escapeHtml(bill.customerName || "Customer")}${bill.customerPhone ? ` · ${escapeHtml(bill.customerPhone)}` : ""}` : "Walk-in")}
    <div class="order-items">${bill.lines.map((line) => `<div><span>${line.quantity} × ${escapeHtml(line.name)}</span><b>${formatMoney(line.total)}</b></div>`).join("")}</div>
    ${field("Subtotal", formatMoney(bill.subtotal))}
    ${bill.discount ? field("Discount", `− ${formatMoney(bill.discount)}`) : ""}
    ${bill.tax ? field(`${escapeHtml(bill.taxLabel || "Tax")} (${bill.taxRate}%)`, formatMoney(bill.tax)) : ""}
    <div class="order-field order-total"><span>Total</span><b>${formatMoney(bill.total)}</b></div>
    ${field("Payment method", PAYMENT_LABELS[bill.paymentMethod] || bill.paymentMethod)}
    ${field("Payment status", `<span class="badge badge-${bill.status}">${PAYMENT_STATUS_LABELS[bill.status] || bill.status}</span>${bill.status === "completed" || bill.status === "refunded" ? when(bill.status === "refunded" ? bill.refundedAt : bill.paidAt) : ""}`)}
    ${field("Invoice", bill.invoiceNumber ? `${bill.invoiceNumber}${when(bill.invoiceGeneratedAt)}` : bill.status === "cancelled" ? "Not generated" : "Generated once payment is confirmed")}
    ${field("WhatsApp", bill.whatsappSentAt ? `<span class="badge badge-completed">Sent</span>${when(bill.whatsappSentAt)}` : `<span class="badge badge-archived">Not sent</span>`)}
    <div class="order-timeline"><span>Order timeline</span><ol>${bill.timeline.map((event) => `<li><b>${TIMELINE_LABELS[event.type] || event.type}</b><small>${formatShortDate(new Date(event.at))} · ${formatClock(new Date(event.at))}</small></li>`).join("")}</ol></div>
  </div>`;
}
function renderHistory() {
  const { bills } = storeState; const list = document.querySelector("#historyList");
  const counts = Object.fromEntries(Object.entries(ORDER_FILTERS).map(([key, match]) => [key, bills.filter(match).length]));
  setChipCounts(document.querySelector("#orderFilters"), counts);
  const live = liveBills();
  document.querySelector("#historyCount").textContent = bills.length ? [`${plural(live.length, "order")} · ${formatMoney(live.reduce((sum, bill) => sum + bill.total, 0))}`, counts.pending && `${counts.pending} pending`].filter(Boolean).join(" · ") : "No orders yet";
  if (!bills.length) { list.innerHTML = '<div class="empty-list">Completed bills will appear here.</div>'; return; }
  const visible = bills.filter(ORDER_FILTERS[storeState.orderFilter]);
  if (!visible.length) { list.innerHTML = `<div class="empty-list">${storeState.orderFilter === "today" ? "No orders yet today." : `No ${storeState.orderFilter} orders.`}</div>`; return; }
  const now = Date.now();
  list.innerHTML = visible.map((bill) => {
    const open = storeState.expandedBill === bill.id; const [dotClass, dotIcon] = ORDER_DOTS[bill.status] || ORDER_DOTS.completed;
    const actions = [
      bill.status === "pending" ? `<select data-paid-method aria-label="Paid by"><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select><button type="button" data-bill-action="completed">Mark paid</button>` : "",
      `<button type="button" class="ghost-button" data-bill-action="view">View invoice</button>`,
      bill.status === "cancelled" ? "" : `${bill.customerPhone ? "" : `<input data-wa-phone type="tel" inputmode="tel" maxlength="20" placeholder="Customer mobile" aria-label="Customer mobile number" />`}<button type="button" class="whatsapp-button" data-bill-action="whatsapp">${bill.whatsappSentAt ? "Resend on WhatsApp" : "Send invoice on WhatsApp"}</button><button type="button" class="ghost-button" data-bill-action="copy">Copy invoice</button>`,
      bill.status === "pending" ? `<button type="button" class="danger-button" data-bill-action="cancelled">Cancel bill</button>` : bill.status === "completed" ? `<button type="button" class="danger-button" data-bill-action="refunded">Refund</button>` : "",
    ].join("");
    return `<div class="history-row bill-row ${bill.status === "cancelled" || bill.status === "refunded" ? "bill-cancelled" : ""}" data-bill-id="${bill.id}"><button type="button" class="bill-summary" aria-expanded="${open}"><span class="history-dot ${dotClass}">${dotIcon}</span><span class="item-main"><strong>${bill.invoiceNumber || `Bill ${billNumber(bill)}`}${bill.customerName ? ` · ${escapeHtml(bill.customerName)}` : ""}</strong><small>${plural(bill.itemCount, "item")} · ${PAYMENT_LABELS[bill.paymentMethod] || bill.paymentMethod} · ${relativeTime(bill.createdAt, now)}${bill.whatsappSentAt ? " · WhatsApp ✓" : ""}</small></span>${billBadge(bill)}<b>${formatMoney(bill.total)}</b></button><div class="bill-lines" ${open ? "" : "hidden"}>${open ? orderDetail(bill, now) : ""}<div class="bill-actions">${actions}</div></div></div>`;
  }).join("");
}
async function updateBill(id, payload) {
  const result = await apiRequest(`/api/store/bills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
  Object.assign(findBill(id), result.bill);
}
setupChips(document.querySelector("#orderFilters"), (filter) => { storeState.orderFilter = filter; renderHistory(); });

// ---- Performance report: a date preset or custom range, the numbers for it, and a PDF download (server-rendered) ----
const reportState = { preset: "week" };
const pad2 = (value) => String(value).padStart(2, "0");
const dateInputValue = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const parseDateInput = (value) => { const [year, month, day] = String(value || "").split("-").map(Number); return year && month && day ? new Date(year, month - 1, day) : null; }; // local midnight
// Each preset resolves to [from, to) on the device's local clock; `to` is the exclusive end (midnight after the last day).
const REPORT_PRESETS = {
  today: { label: "Today", range: (now) => [startOfDay(now), addDays(startOfDay(now), 1)] },
  yesterday: { label: "Yesterday", range: (now) => [addDays(startOfDay(now), -1), startOfDay(now)] },
  week: { label: "This week", range: (now) => [startOfWeek(now), addDays(startOfDay(now), 1)] },
  last7: { label: "Last 7 days", range: (now) => [addDays(startOfDay(now), -6), addDays(startOfDay(now), 1)] },
  month: { label: "This month", range: (now) => [startOfMonth(now), addDays(startOfDay(now), 1)] },
  lastMonth: { label: "Last month", range: (now) => [new Date(now.getFullYear(), now.getMonth() - 1, 1), startOfMonth(now)] },
  custom: { label: "Custom dates", range: () => { const from = parseDateInput(document.querySelector("#reportFrom").value); const to = parseDateInput(document.querySelector("#reportTo").value); return [from, to && addDays(to, 1)]; } },
};
function reportRange() {
  const preset = REPORT_PRESETS[reportState.preset]; const [from, to] = preset.range(new Date());
  const valid = from instanceof Date && to instanceof Date && to > from && to - from <= 366 * 86400000;
  const label = reportState.preset === "custom" ? "Custom period" : preset.label;
  const span = valid ? (to - from <= 86400000 ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(addDays(to, -1))}`) : "";
  return { from, to, valid, label, span };
}
// The same figures the PDF shows, computed from the bills already loaded in the app.
function reportSummary(from, to) {
  const inRange = storeState.bills.filter((bill) => { const at = new Date(bill.createdAt); return at >= from && at < to; });
  const live = inRange.filter((bill) => bill.status !== "cancelled" && bill.status !== "refunded");
  const sum = (list) => list.reduce((total, bill) => total + bill.total, 0);
  const pending = live.filter((bill) => bill.status === "pending");
  const byMethod = new Map(); for (const bill of live) { const entry = byMethod.get(bill.paymentMethod) || { orders: 0, amount: 0 }; entry.orders++; entry.amount += bill.total; byMethod.set(bill.paymentMethod, entry); }
  const byDay = new Map(); for (const bill of live) { const key = startOfDay(new Date(bill.createdAt)).getTime(); const entry = byDay.get(key) || { at: key, orders: 0, sales: 0 }; entry.orders++; entry.sales += bill.total; byDay.set(key, entry); }
  const bestDay = [...byDay.values()].sort((a, b) => b.sales - a.sales)[0] || null;
  const items = new Map(); for (const bill of live) for (const line of bill.lines) { const entry = items.get(line.name) || { name: line.name, quantity: 0 }; entry.quantity += line.quantity; items.set(line.name, entry); }
  return { orders: live.length, sales: sum(live), items: live.reduce((total, bill) => total + bill.itemCount, 0), tax: live.reduce((total, bill) => total + (bill.tax || 0), 0), discount: live.reduce((total, bill) => total + (bill.discount || 0), 0), pendingCount: pending.length, pendingAmount: sum(pending), voided: inRange.length - live.length, byMethod, bestDay, activeDays: byDay.size, topItems: [...items.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 3) };
}
function renderReport() {
  const { from, to, valid, label, span } = reportRange();
  document.querySelector("#reportDates").hidden = reportState.preset !== "custom";
  document.querySelector("#reportDownload").disabled = !valid;
  if (!valid) { setText("#reportRangeLabel", "Choose a valid From and To date (up to one year apart)."); setText("#reportSummaryLine", "Choose a valid period"); document.querySelector("#reportBreakdown").innerHTML = ""; return; }
  const s = reportSummary(from, to); const days = Math.round((to - from) / 86400000);
  setText("#reportRangeLabel", `${label} · ${span}${days > 1 ? ` · ${plural(days, "day")}` : ""}`);
  setText("#reportSales", formatMoneyCompact(s.sales)); setText("#reportOrders", s.orders); setText("#reportAvg", formatMoneyCompact(s.orders ? s.sales / s.orders : 0));
  setText("#reportItems", s.items); setText("#reportPending", `${formatMoneyCompact(s.pendingAmount)}${s.pendingCount ? ` (${s.pendingCount})` : ""}`); setText("#reportVoided", s.voided);
  const lines = [
    s.bestDay && days > 1 ? [`Best day · ${formatShortDate(new Date(s.bestDay.at))}`, `${formatMoney(s.bestDay.sales)} · ${plural(s.bestDay.orders, "order")}`] : null,
    days > 1 ? ["Days with sales", `${s.activeDays} of ${days}`] : null,
    ...[...s.byMethod].map(([method, entry]) => [`${PAYMENT_LABELS[method] || method} · ${plural(entry.orders, "order")}`, formatMoney(entry.amount)]),
    (s.tax || s.discount) ? ["Tax collected · discounts given", `${formatMoney(s.tax)} · ${formatMoney(s.discount)}`] : null,
    s.topItems.length ? ["Top items", s.topItems.map((item) => `${escapeHtml(item.name)} ×${item.quantity}`).join(", ")] : null,
  ].filter(Boolean);
  document.querySelector("#reportBreakdown").innerHTML = lines.length ? lines.map(([key, value]) => `<div><span>${key}</span><b>${value}</b></div>`).join("") : '<div><span>No orders in this period.</span></div>';
  setText("#reportSummaryLine", `${label} · ${formatMoney(s.sales)} · ${plural(s.orders, "order")}`);
}
setupSettingsGroups(document.querySelector("#reportPanel"));
setupChips(document.querySelector("#reportPresets"), (preset) => { reportState.preset = preset; renderReport(); if (preset === "custom") document.querySelector("#reportFrom").focus(); });
document.querySelector("#reportFrom").addEventListener("change", renderReport);
document.querySelector("#reportTo").addEventListener("change", renderReport);
// The PDF comes from the server (it holds every bill); the token travels in a header, so fetch it and hand the blob to a download link.
document.querySelector("#reportDownload").addEventListener("click", async () => {
  const { from, to, valid, label } = reportRange(); if (!valid) return;
  const body = document.querySelector("#reportPanel .report-body"); const button = document.querySelector("#reportDownload");
  button.disabled = true; settingsMessage(body, "Preparing your PDF…");
  try {
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz: String(new Date().getTimezoneOffset()), label, orders: document.querySelector("#reportIncludeOrders").checked ? "1" : "0" });
    const response = await fetch(`${API_BASE}/api/store/reports/sales.pdf?${params}`, { headers: { authorization: `Bearer ${authToken}` } });
    if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "Could not create the report"); }
    const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || "sales-report.pdf";
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: filename }); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    settingsMessage(body, `${filename} is ready.`); showToast("PDF report downloaded");
  } catch (error) { settingsMessage(body, error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector("#historyList").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-bill-id]"); if (!row) return;
  const bill = findBill(row.dataset.billId); if (!bill) return;
  const action = event.target.closest("[data-bill-action]")?.dataset.billAction;
  if (!action) { if (event.target.closest(".bill-summary")) { storeState.expandedBill = storeState.expandedBill === bill.id ? null : bill.id; renderHistory(); if (storeState.expandedBill === bill.id) ensureInvoiceUrl(bill); } return; }
  if (action === "whatsapp") return sendInvoiceOnWhatsApp(bill, row.querySelector("[data-wa-phone]")?.value);
  if (action === "copy") { if (!invoiceUrl(bill)) await ensureInvoiceUrl(bill); try { await navigator.clipboard.writeText(invoiceText(bill, customerInvoiceUrl(bill))); showToast(`${invoiceLabel(bill)} copied`); } catch { showToast("Copy failed. Use Send on WhatsApp instead."); } return; }
  if (action === "view") return openInvoiceView(bill);
  try {
    if (action === "completed") { await updateBill(bill.id, { status: "completed", paymentMethod: row.querySelector("[data-paid-method]").value }); showToast(`Payment confirmed · ${invoiceLabel(findBill(bill.id))} generated`); }
    if (action === "cancelled") { if (!window.confirm(`Cancel bill ${billNumber(bill)}? Its items go back into stock.`)) return; await updateBill(bill.id, { status: "cancelled" }); await loadItems(); showToast(`Bill ${billNumber(bill)} cancelled`); }
    if (action === "refunded") { if (!window.confirm(`Refund ${invoiceLabel(bill)}? Its items go back into stock and the sale leaves your revenue.`)) return; await updateBill(bill.id, { status: "refunded" }); await loadItems(); showToast(`${invoiceLabel(bill)} refunded`); }
    renderStorePages();
  } catch (error) { showToast(error.message); }
});

// Dashboard page: sales, order and inventory analytics computed from the bills and catalog
// Chart buckets: "current" is the bucket holding the selected day (the highlighted bar and the note under the total).
const SALES_RANGES = {
  daily: { label: "This week", buckets: (today, selected) => weekDays(today).map((day) => ({ start: day, end: addDays(day, 1), current: sameDay(day, selected), label: formatShortDate(day), currentLabel: sameDay(day, today) ? "Today" : formatShortDate(day) })) },
  weekly: { label: "Last 6 weeks", buckets: (today, selected) => Array.from({ length: 6 }, (_, index) => { const start = addDays(startOfWeek(today), (index - 5) * 7); return { start, end: addDays(start, 7), current: selected >= start && selected < addDays(start, 7), label: `Week of ${formatShortDate(start)}`, currentLabel: index === 5 ? "This week" : `Week of ${formatShortDate(start)}` }; }) },
  monthly: { label: "Last 6 months", buckets: (today, selected) => Array.from({ length: 6 }, (_, index) => { const start = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1); const end = new Date(start.getFullYear(), start.getMonth() + 1, 1); return { start, end, current: selected >= start && selected < end, label: start.toLocaleDateString([], { month: "long", year: "numeric" }), currentLabel: index === 5 ? "This month" : start.toLocaleDateString([], { month: "long" }) }; }) },
};
// Everything dated follows the day picked in the week strip; stock and pending payments are balances, so they don't.
function renderHomeStats() {
  const today = new Date(); const bills = liveBills(); const day = storeState.selectedDay || startOfDay(today); const isToday = sameDay(day, today);
  const inRange = (bill, start, end) => { const at = new Date(bill.createdAt); return at >= start && at < end; };
  const sum = (list) => list.reduce((total, bill) => total + bill.total, 0);
  const dayLabel = isToday ? "today" : day.toLocaleDateString([], { weekday: "short", day: "numeric" });
  const dayBills = bills.filter((bill) => sameDay(new Date(bill.createdAt), day));
  const monthBills = bills.filter((bill) => inRange(bill, startOfMonth(day), new Date(day.getFullYear(), day.getMonth() + 1, 1)));
  const monthName = day.toLocaleDateString([], { month: "long" });
  const pendingBills = storeState.bills.filter((bill) => bill.status === "pending");
  setText("#homeSalesLabel", `Sales ${dayLabel}`); setText("#homeOrdersLabel", `Orders ${dayLabel}`); setText("#homeMonthLabel", `Sales · ${monthName}`); setText("#homeAvgLabel", `Avg. order · ${monthName}`);
  setText("#homeSalesToday", formatMoneyCompact(sum(dayBills))); setText("#homeOrdersToday", dayBills.length); setText("#homeTotalItems", storeState.items.length);
  setText("#homeSalesMonth", formatMoneyCompact(sum(monthBills))); setText("#homeAvgOrder", formatMoneyCompact(monthBills.length ? sum(monthBills) / monthBills.length : 0)); setText("#homePendingPayments", formatMoneyCompact(sum(pendingBills)));
  const onDay = storeState.bills.filter((bill) => sameDay(new Date(bill.createdAt), day)); const byStatus = (status) => onDay.filter((bill) => bill.status === status).length;
  setText("#homeOrdersSection", `Order analytics · ${dayLabel}`);
  setText("#homeOrdersCompleted", byStatus("completed")); setText("#homeOrdersPending", byStatus("pending")); setText("#homeOrdersCancelled", byStatus("cancelled")); setText("#homeOrdersRefunded", byStatus("refunded"));
  const stock = { ok: 0, low: 0, out: 0 }; for (const item of storeState.items) stock[itemStatus(item)]++;
  setText("#homeItemsAvailable", stock.ok); setText("#homeItemsLow", stock.low); setText("#homeItemsOut", stock.out);

  const range = SALES_RANGES[storeState.salesRange];
  const buckets = range.buckets(today, day).map((bucket) => { const inBucket = bills.filter((bill) => inRange(bill, bucket.start, bucket.end)); return { ...bucket, total: sum(inBucket), count: inBucket.length }; });
  const current = buckets.find((bucket) => bucket.current) || buckets[buckets.length - 1];
  setText("#homeRangeLabel", `SALES · ${range.label.toUpperCase()}`);
  setText("#homeRangeTotal", formatMoney(buckets.reduce((total, bucket) => total + bucket.total, 0)));
  document.querySelector("#homeSalesNote").innerHTML = `${current.currentLabel} · <b>${formatMoney(current.total)}</b> · ${plural(current.count, "bill")}`;
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  document.querySelector("#homeChart").innerHTML = buckets.map((bucket) => `<i class="${bucket.current ? "chart-today" : ""}" style="height:${8 + Math.round((bucket.total / peak) * 47)}px" title="${escapeHtml(bucket.label)}: ${formatMoney(bucket.total)}"></i>`).join("");
}
document.querySelector("#salesRange").addEventListener("click", (event) => {
  const button = event.target.closest("[data-range]"); if (!button) return;
  storeState.salesRange = button.dataset.range;
  document.querySelectorAll("#salesRange button").forEach((other) => { const active = other === button; other.classList.toggle("active", active); other.setAttribute("aria-selected", String(active)); });
  renderHomeStats();
});

// ---- Store settings: profile, billing & invoices, inventory, subscription, security ----
function fillStoreSettings() {
  const profile = storeState.profile; if (!profile) return; const s = profile.settings || {};
  document.querySelector("#settingsStoreName").value = profile.storeName || ""; document.querySelector("#settingsOwnerName").value = profile.name || ""; document.querySelector("#settingsPhone").value = profile.phone || "";
  document.querySelector("#settingsBusinessType").value = profile.businessType || ""; document.querySelector("#settingsAddress").value = profile.address || "";
  document.querySelector("#settingsTaxRate").value = s.taxRate || ""; document.querySelector("#settingsTaxLabel").value = s.taxLabel || "Tax"; document.querySelector("#settingsInvoiceNote").value = s.invoiceNote || ""; document.querySelector("#settingsShowContact").checked = s.showContactOnInvoice !== false;
  document.querySelector("#settingsLegalName").value = s.legalName || ""; document.querySelector("#settingsGstin").value = s.gstin || "";
  document.querySelector("#settingsPlaceOfSupply").value = s.placeOfSupply || ""; document.querySelector("#settingsFssai").value = s.fssai || "";
  document.querySelector("#settingsTerms").value = s.terms || "";
  document.querySelector("#settingsLowStock").value = s.lowStockDefault ?? LOW_STOCK_DEFAULT; document.querySelector("#settingsStockToasts").checked = s.stockToasts !== false;
  setText("#profileStoreDetails", [profile.storeName, profile.businessType, profile.address, profile.phone].filter(Boolean).join(" · ") || "Business profile and contact");
  setText("#billingSettingsSummary", [`${s.taxLabel || "Tax"} ${s.taxRate || 0}% by default`, s.gstin ? `GSTIN ${s.gstin}` : "no GSTIN yet", s.showContactOnInvoice === false ? "contact hidden" : null].filter(Boolean).join(" · "));
  setText("#inventorySettingsSummary", `Low-stock alert at ${s.lowStockDefault ?? LOW_STOCK_DEFAULT} · stock warnings ${s.stockToasts === false ? "off" : "on"}`);
  setText("#profilePlan", profile.createdAt ? `Your store since ${new Date(profile.createdAt).toLocaleDateString()}` : "Your account and how to reach us");
  setText("#subscriptionDetails", `${profile.storeName || profile.name} is yours to run — there is no plan to renew and nothing expires.${profile.createdAt ? ` You opened it on ${new Date(profile.createdAt).toLocaleDateString()}.` : ""}`);
  setText("#supportDetails", `Something wrong? Write to us from Message ${platform.platformName} below${platform.supportEmail || platform.supportPhone ? `, or reach us at ${[platform.supportEmail, platform.supportPhone].filter(Boolean).join(" · ")}` : ""}.`);
  const security = document.querySelector("#storeSecuritySummary"); security.classList.toggle("attention", Boolean(profile.passwordResetRequired));
  security.textContent = profile.passwordResetRequired ? "Action needed: you're using a temporary password — set your own" : profile.passwordChangedAt ? `Password changed ${relativeTime(profile.passwordChangedAt)}` : "Change your password";
}
async function saveStoreSettings(form, payload, successText) {
  settingsMessage(form, "Saving…");
  try {
    const result = await apiRequest("/api/store/settings", { method: "PATCH", body: JSON.stringify(payload) });
    storeState.profile = result; applyPlatform(result.platform); applyStoreProfile(); renderStorePages();
    settingsMessage(form, successText); showToast(successText);
  } catch (error) { settingsMessage(form, error.message, true); }
}
document.querySelector("#storeProfileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveStoreSettings(event.target, { storeName: document.querySelector("#settingsStoreName").value, name: document.querySelector("#settingsOwnerName").value, phone: document.querySelector("#settingsPhone").value, businessType: document.querySelector("#settingsBusinessType").value, address: document.querySelector("#settingsAddress").value }, "Store profile saved");
});
document.querySelector("#storeBillingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveStoreSettings(event.target, {
    taxRate: document.querySelector("#settingsTaxRate").value, taxLabel: document.querySelector("#settingsTaxLabel").value,
    invoiceNote: document.querySelector("#settingsInvoiceNote").value, showContactOnInvoice: document.querySelector("#settingsShowContact").checked,
    legalName: document.querySelector("#settingsLegalName").value, gstin: document.querySelector("#settingsGstin").value,
    placeOfSupply: document.querySelector("#settingsPlaceOfSupply").value, fssai: document.querySelector("#settingsFssai").value,
    terms: document.querySelector("#settingsTerms").value,
  }, "Billing settings saved");
  // A new default tax rate applies to the bill being built right now as well.
  document.querySelector("#cartTaxRate").value = storeState.profile?.settings?.taxRate || ""; renderCart();
});
document.querySelector("#storeInventoryForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveStoreSettings(event.target, { lowStockDefault: document.querySelector("#settingsLowStock").value, stockToasts: document.querySelector("#settingsStockToasts").checked }, "Inventory settings saved");
});
document.querySelector("#storePasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.target;
  const next = document.querySelector("#storeNewPassword").value; if (!checkPasswords(form, next, document.querySelector("#storeConfirmPassword").value)) return;
  settingsMessage(form, "Updating…");
  try {
    const { message, ...profile } = await apiRequest("/api/store/password", { method: "POST", body: JSON.stringify({ currentPassword: document.querySelector("#storeCurrentPassword").value, newPassword: next }) });
    storeState.profile = profile; form.reset(); applyStoreProfile(); settingsMessage(form, "Password updated."); showToast("Password updated");
  } catch (error) { settingsMessage(form, error.message, true); }
});

function signOut() {
  stopDashboard(); stopStoreMessages(); stopNotes(); stopAi(); adminSettings.data = null; landing.lastDay = null;
  localStorage.removeItem("ailexityAuthToken");
  sessionStorage.removeItem("ailexityAuthToken");
  authToken = null; storeState.profile = null;
  closeUserDetails(); closeItemForm(); document.querySelector(".toast")?.remove();
  document.querySelectorAll(".settings-group.open").forEach((group) => { group.classList.remove("open"); group.querySelector(".settings-form").hidden = true; group.querySelector(".settings-row").setAttribute("aria-expanded", "false"); }); // collapse any open panels for the next person
  hideWelcome();
  adminShell.hidden = true;
  userShell.hidden = true;
  document.body.classList.remove("app-active");
  showSignIn({ focus: false });
  resetLoginForm();
}
document.querySelector("#signOutButton").addEventListener("click", signOut);
document.querySelector("#userSignOutButton").addEventListener("click", signOut);

// ---- Sign in / create account: the first screen, two cards over the same background ----
function showSignIn({ focus = true } = {}) {
  landingScreen.hidden = true; document.body.classList.add("signin-active"); setThemeColor("#f6f7f8");
  authScreen.hidden = false;
  loginCard.hidden = false;
  signupCard.hidden = true;
  if (focus) emailInput.focus(); // not on sign-out: the keyboard would cover the screen before anyone asked for it
}
function showSignUp() {
  landingScreen.hidden = true; document.body.classList.add("signin-active");
  authScreen.hidden = false;
  loginCard.hidden = true;
  signupCard.hidden = false;
  setSignupMessage("");
  document.querySelector("#signupStoreName").focus();
}
document.querySelector("#showSignupButton").addEventListener("click", showSignUp);
document.querySelector("#showLoginButton").addEventListener("click", () => showSignIn());

const setSignupMessage = (text, type = "") => { signupMessage.textContent = text; signupMessage.className = `form-message ${type}`; };
const signupPasswordToggle = document.querySelector("#signupPasswordToggle");
signupPasswordToggle.addEventListener("click", () => {
  const field = document.querySelector("#signupPassword");
  const showing = field.type === "text";
  field.type = showing ? "password" : "text";
  signupPasswordToggle.textContent = showing ? "Show" : "Hide";
});

// Creating the account signs the owner straight in: no activation key, no approval, no plan.
signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = { storeName: "#signupStoreName", name: "#signupName", email: "#signupEmail", phone: "#signupPhone", password: "#signupPassword" };
  const value = (key) => document.querySelector(fields[key]).value.trim();
  document.querySelectorAll("#signupForm .field-error").forEach((node) => { node.textContent = ""; });
  setSignupMessage("");

  const problems = [
    !value("storeName") && ["#signupStoreNameError", "What is your shop called?"],
    !value("name") && ["#signupNameError", "Enter your name."],
    !document.querySelector("#signupEmail").validity.valid || !value("email") ? ["#signupEmailError", "Enter a valid email address."] : null,
    !/^\+?[0-9 ()-]{7,20}$/.test(value("phone")) && ["#signupPhoneError", "Enter a valid mobile number."],
    document.querySelector("#signupPassword").value.length < 8 && ["#signupPasswordError", "Use at least 8 characters."],
  ].filter(Boolean);
  if (problems.length) { problems.forEach(([selector, text]) => { document.querySelector(selector).textContent = text; }); return; }

  const submitButton = signupForm.querySelector(".submit-button");
  submitButton.disabled = true; submitButton.querySelector("span").textContent = "Creating your store…";
  try {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ storeName: value("storeName"), name: value("name"), email: value("email"), phone: value("phone"), password: document.querySelector("#signupPassword").value }),
    });
    const result = await response.json();
    if (!response.ok) {
      // The server names the field it rejected, so the error lands under that input.
      const target = result.field && document.querySelector(`#signup${result.field[0].toUpperCase()}${result.field.slice(1)}Error`);
      if (target) target.textContent = result.error;
      throw new Error(result.error || "Could not create the account");
    }
    authToken = result.token;
    localStorage.setItem("ailexityAuthToken", authToken);
    setSignupMessage("Store created. Opening your dashboard…", "success");
    submitButton.querySelector("span").textContent = "Ready ✓";
    setTimeout(() => { signupCard.hidden = true; openWorkspace(result, { welcome: "signup" }); }, 650);
  } catch (error) {
    setSignupMessage(error.message, "error");
    submitButton.disabled = false; submitButton.querySelector("span").textContent = "Create store & start";
  }
});
// No pinch or double-tap zoom anywhere: the viewport meta covers Android; iOS Safari needs the gesture events blocked as well.
document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
document.addEventListener("touchmove", (event) => { if (event.scale !== undefined && event.scale !== 1) event.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (event) => { const now = Date.now(); if (now - lastTouchEnd < 300 && !event.target.closest("input, textarea, select, button, a, label")) event.preventDefault(); lastTouchEnd = now; }, { passive: false });

// ---- Landing content: live clock, month progress, thought of the day (all computed on the device, nothing fetched) ----
const THOUGHTS = [
  ["Make a customer, not a sale.", "Katherine Barchetti"],
  ["Do what you do so well that they will want to see it again and bring their friends.", "Walt Disney"],
  ["Your most unhappy customers are your greatest source of learning.", "Bill Gates"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["Beware of little expenses; a small leak will sink a great ship.", "Benjamin Franklin"],
  ["Whether you think you can, or you think you can't — you're right.", "Henry Ford"],
  ["A satisfied customer is the best business strategy of all.", "Michael LeBoeuf"],
  ["Success is the sum of small efforts, repeated day in and day out.", "Robert Collier"],
  ["The way to get started is to quit talking and begin doing.", "Walt Disney"],
  ["Don't find customers for your products, find products for your customers.", "Seth Godin"],
  ["Your brand is what other people say about you when you're not in the room.", "Jeff Bezos"],
  ["Price is what you pay. Value is what you get.", "Warren Buffett"],
  ["It takes 20 years to build a reputation and five minutes to ruin it.", "Warren Buffett"],
  ["If you are not taking care of your customer, your competitor will.", "Bob Hooey"],
  ["Chase the vision, not the money; the money will end up following you.", "Tony Hsieh"],
  ["Setting goals is the first step in turning the invisible into the visible.", "Tony Robbins"],
  ["Quality is remembered long after the price is forgotten.", "Aldo Gucci"],
  ["Opportunities don't happen. You create them.", "Chris Grosser"],
  ["Restock your fastest sellers before they hit zero — an empty shelf is a missed sale.", "Store tip"],
  ["Send every invoice on WhatsApp; a receipt in hand brings customers back.", "Store tip"],
  ["Collect pending payments the same week — small dues are easiest to settle early.", "Store tip"],
  ["Check today's numbers before you close: what sold, what's low, who still owes.", "Store tip"],
  ["Greet regulars by name. Loyalty starts with being remembered.", "Store tip"],
];
// Sun / setting sun / moon for the top-right badge, in the app's stroke-icon style.
const DAYLIGHT_ICONS = {
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>',
  evening: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16a7 7 0 0 1 14 0" /><path d="M3 20h18M12 4v2M4.5 8.5 6 10M19.5 8.5 18 10" /></svg>',
  night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>',
};
const dayOfYear = (date) => Math.floor((startOfDay(date) - new Date(date.getFullYear(), 0, 1)) / 86400000) + 1;
const isoWeek = (date) => { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7); };
const landing = { thought: dayOfYear(new Date()) % THOUGHTS.length, lastDay: null };
function renderThought() {
  const [text, by] = THOUGHTS[landing.thought % THOUGHTS.length];
  setText("#landingQuote", `\u201C${text}\u201D`); setText("#landingQuoteBy", by === "Store tip" ? "Store tip" : `— ${by}`);
}
function tickLanding() {
  if (landingScreen.hidden) return;
  const now = new Date();
  setText("#landingTime", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const dayKey = now.toDateString(); if (landing.lastDay === dayKey) return; landing.lastDay = dayKey; // the rest only changes once a day
  setText("#landingGreeting", greetingFor(now)); setText("#landingDate", now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }));
  const hour = now.getHours(); document.querySelector("#landingDaylight").innerHTML = DAYLIGHT_ICONS[hour < 6 || hour >= 20 ? "night" : hour < 17 ? "day" : "evening"];
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const day = now.getDate(); const left = daysInMonth - day;
  const month = now.toLocaleDateString([], { month: "long" });
  setText("#landingMonthPercent", `${Math.round((day / daysInMonth) * 100)}%`);
  setText("#landingMonthNote", left === 0 ? `Last day of ${month} — finish strong` : `Day ${day} of ${daysInMonth} · ${plural(left, "day")} left in ${month}`);
  document.querySelector("#landingMonthBar").style.width = `${(day / daysInMonth) * 100}%`;
  setText("#landingWeek", `Week ${isoWeek(now)} · Q${Math.floor(now.getMonth() / 3) + 1}`);
  landing.thought = dayOfYear(now) % THOUGHTS.length; renderThought();
}
setInterval(tickLanding, 1000);

// ---- Welcome page: once, right after signing in or creating the store — never when a saved session reopens the app ----
// It covers the workspace, which is already loading underneath, and has nothing to tap: swipe it up. A mouse can drag it,
// a scroll wheel or trackpad pushes it away, and Enter / Space / Esc / Up / Page Down do the same from the keyboard.
const welcome = { active: false, dragging: false, pointerId: null, startY: 0, lastY: 0, lastTime: 0, velocity: 0, queue: [] };
const setShellsInert = (inert) => { adminShell.inert = inert; userShell.inert = inert; };
function showWelcome(result, kind) {
  const firstName = String(result.name || "").trim().split(/\s+/)[0];
  setText("#landingWelcome", `${kind === "signup" ? "Welcome" : "Welcome back"}${firstName ? `, ${firstName}` : ""}`);
  setText("#landingSwipeLabel", result.role === "store" ? "Swipe up to open your store" : "Swipe up to open the platform");
  Object.assign(welcome, { active: true, dragging: false, queue: [] });
  landingScreen.classList.remove("is-dragging", "is-leaving"); landingScreen.style.transform = "";
  landingScreen.hidden = false; landing.lastDay = null; tickLanding(); // fresh clock, date, thought and month
  setShellsInert(true); setThemeColor("#f6f7f8");
  landingScreen.focus({ preventScroll: true });
}
// Runs `task` once the welcome page is out of the way (straight away if it is not showing).
const afterWelcome = (task) => { if (welcome.active) welcome.queue.push(task); else task(); };
function dismissWelcome() {
  if (!welcome.active) return;
  welcome.active = false; welcome.dragging = false;
  landingScreen.classList.remove("is-dragging"); landingScreen.classList.add("is-leaving");
  landingScreen.style.transform = "translateY(-104%)";
  setShellsInert(false); setThemeColor("#ffffff"); landingScreen.blur();
  const finish = () => { if (welcome.active || landingScreen.hidden) return; landingScreen.hidden = true; landingScreen.classList.remove("is-leaving"); landingScreen.style.transform = ""; };
  landingScreen.addEventListener("transitionend", finish, { once: true }); setTimeout(finish, 700);
  welcome.queue.splice(0).forEach((task) => task());
}
// Signing out while it shows: no animation, nothing left queued for the next person.
function hideWelcome() {
  Object.assign(welcome, { active: false, dragging: false, queue: [] });
  setShellsInert(false); landingScreen.hidden = true;
  landingScreen.classList.remove("is-dragging", "is-leaving"); landingScreen.style.transform = "";
}
landingScreen.addEventListener("pointerdown", (event) => {
  if (!welcome.active || (event.pointerType === "mouse" && event.button !== 0)) return;
  Object.assign(welcome, { dragging: true, pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 });
  landingScreen.classList.add("is-dragging");
  try { landingScreen.setPointerCapture(event.pointerId); } catch { /* the pointer already left; moves still arrive while it is over the page */ }
});
landingScreen.addEventListener("pointermove", (event) => {
  if (!welcome.dragging || event.pointerId !== welcome.pointerId) return;
  const elapsed = event.timeStamp - welcome.lastTime;
  if (elapsed > 0) welcome.velocity = (event.clientY - welcome.lastY) / elapsed; // px per ms; negative is upwards
  welcome.lastY = event.clientY; welcome.lastTime = event.timeStamp;
  const pulled = event.clientY - welcome.startY;
  landingScreen.style.transform = `translateY(${pulled < 0 ? pulled : pulled * 0.15}px)`; // downwards it only gives a little
});
function endWelcomeDrag(event) {
  if (!welcome.dragging || event.pointerId !== welcome.pointerId) return;
  welcome.dragging = false; landingScreen.classList.remove("is-dragging");
  const pulled = welcome.lastY - welcome.startY; const flick = event.timeStamp - welcome.lastTime < 120 && welcome.velocity < -0.45;
  if (-pulled > landingScreen.clientHeight * 0.2 || (flick && pulled < -24)) dismissWelcome();
  else landingScreen.style.transform = ""; // not far enough: it springs back
}
landingScreen.addEventListener("pointerup", endWelcomeDrag);
landingScreen.addEventListener("pointercancel", endWelcomeDrag);
landingScreen.addEventListener("wheel", (event) => { if (welcome.active && event.deltaY > 8) dismissWelcome(); }, { passive: true });
document.addEventListener("keydown", (event) => {
  if (!welcome.active || !["Enter", " ", "Escape", "ArrowUp", "PageDown"].includes(event.key)) return;
  event.preventDefault(); dismissWelcome();
});

async function apiRequest(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${authToken}`, ...(options.headers || {}) } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Request failed"); return result;
}

// ---- Superadmin: retailer management (all / pending / active / suspended / archived) ----
// ---- Inbox (superadmin): every message stores have sent, with Seen / Resolved handling ----
const inboxState = { items: [], filter: "open" };
const INBOX_FILTERS = { open: (item) => item.status !== "resolved", new: (item) => item.status === "new", seen: (item) => item.status === "seen", resolved: (item) => item.status === "resolved", all: () => true };
function renderInbox() {
  const list = document.querySelector("#inboxList"); const { items } = inboxState;
  setChipCounts(document.querySelector("#inboxFilters"), Object.fromEntries(Object.entries(INBOX_FILTERS).map(([key, match]) => [key, items.filter(match).length])));
  const fresh = items.filter((item) => item.status === "new").length;
  setText("#inboxCount", items.length ? `${plural(items.length, "message")}${fresh ? ` · ${fresh} new` : ""}` : "No messages from stores yet");
  const visible = items.filter(INBOX_FILTERS[inboxState.filter]);
  if (!visible.length) { list.innerHTML = `<div class="empty-users">${items.length ? `No ${inboxState.filter === "open" ? "open" : inboxState.filter} messages.` : "When a store writes to you from its Profile page, it shows up here."}</div>`; return; }
  const STATUS = { new: ["New", "badge-important"], seen: ["Seen", "badge-archived"], resolved: ["Resolved", "badge-completed"] };
  list.innerHTML = visible.map((item) => { const [category, categoryClass] = FEEDBACK_CATEGORIES[item.category] || [item.category, "badge-archived"]; const [status, statusClass] = STATUS[item.status]; return `<div class="inbox-item ${item.status}" data-feedback-id="${item.id}"><div class="message-head"><span class="badge ${categoryClass}">${category}</span><span class="badge ${statusClass}">${status}</span><small>${relativeTime(item.createdAt)} · ${formatShortDate(new Date(item.createdAt))}</small></div><strong>${escapeHtml(item.subject)}</strong><small class="inbox-from">${escapeHtml(item.storeName || item.ownerName)}${item.storeName ? ` · ${escapeHtml(item.ownerName)}` : ""} · ${escapeHtml(item.email)}</small><p>${escapeHtml(item.message)}</p><div class="bill-actions">${item.status === "new" ? '<button type="button" class="ghost-button" data-feedback-status="seen">Mark seen</button>' : ""}${item.status !== "resolved" ? '<button type="button" data-feedback-status="resolved">Resolve</button>' : '<button type="button" class="ghost-button" data-feedback-status="new">Reopen</button>'}<button type="button" class="danger-button" data-feedback-delete>Delete</button></div></div>`; }).join("");
}
async function loadInbox() { try { inboxState.items = (await apiRequest("/api/admin/feedback")).feedback; renderInbox(); } catch (error) { document.querySelector("#inboxList").innerHTML = `<div class="empty-users">${escapeHtml(error.message)}</div>`; } }
setupChips(document.querySelector("#inboxFilters"), (filter) => { inboxState.filter = filter; renderInbox(); });
document.querySelector("#inboxRefresh").addEventListener("click", loadInbox);
adminShell.addEventListener("page:change", (event) => { if (event.detail === "inbox") loadInbox(); });
document.querySelector("#inboxList").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-feedback-id]"); if (!row) return; const id = row.dataset.feedbackId;
  const status = event.target.closest("[data-feedback-status]")?.dataset.feedbackStatus;
  try {
    if (status) await apiRequest(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
    else if (event.target.closest("[data-feedback-delete]")) { if (!window.confirm("Delete this message?")) return; await apiRequest(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    else return;
    await loadInbox(); loadDashboard();
  } catch (error) { showToast(error.message); }
});
const adminState = { users: [], filter: "all" };
// "All" hides archived retailers; they have their own tab so the working list stays clean.
const USER_FILTERS = { all: (user) => user.status !== "archived", active: (user) => user.status === "active", suspended: (user) => user.status === "suspended", archived: (user) => user.status === "archived" };
function userInitial(name) { return String(name || "?").trim().charAt(0).toUpperCase(); }
function renderUsers() {
  const list = document.querySelector("#userList");
  const counts = Object.fromEntries(Object.entries(USER_FILTERS).map(([key, match]) => [key, adminState.users.filter(match).length]));
  setChipCounts(document.querySelector("#userFilters"), counts);
  const users = adminState.users.filter(USER_FILTERS[adminState.filter]);
  document.querySelector("#userCount").textContent = `${plural(counts.all, "retailer")}${counts.archived ? ` · ${counts.archived} archived` : ""}`;
  if (!users.length) { list.innerHTML = `<div class="empty-users">${adminState.filter === "all" ? "No stores yet. They appear here as soon as someone signs up." : `No ${adminState.filter} retailers.`}</div>`; return; }
  list.innerHTML = users.map((user) => `<button class="user-row user-row-button ${user.status === "archived" ? "user-archived" : ""}" type="button" data-user-id="${user.id}"><span class="user-avatar">${escapeHtml(userInitial(user.storeName || user.name))}</span><span><strong>${escapeHtml(user.storeName || user.name)}</strong><small>${escapeHtml(user.storeName ? `${user.name} · ` : "")}${escapeHtml(user.email)}</small></span>${userStatusBadge(user.status)}<b>›</b></button>`).join("");
  list.querySelectorAll("[data-user-id]").forEach((row) => row.addEventListener("click", () => openUserDetails(row.dataset.userId)));
  renderMessageRecipients();
}
// ---- Messages to stores (superadmin): compose with type, duration and recipients; list what was sent with read counts ----
const messagesState = { sent: [] };
function renderMessageRecipients() {
  const list = document.querySelector("#messageRecipients"); const chosen = new Set([...list.querySelectorAll("input:checked")].map((box) => box.value));
  const stores = adminState.users.filter((user) => user.status === "active").sort((a, b) => (a.storeName || a.name).localeCompare(b.storeName || b.name));
  list.innerHTML = stores.length ? stores.map((user) => `<label class="check-row"><input type="checkbox" value="${user.id}" ${chosen.has(user.id) ? "checked" : ""} /><span>${escapeHtml(user.storeName || user.name)}<small> · ${escapeHtml(user.name)}</small></span></label>`).join("") : '<div class="empty-activity">No active stores yet.</div>';
}
function renderSentMessages() {
  const list = document.querySelector("#sentMessages"); const active = messagesState.sent.filter((message) => message.status === "active");
  setText("#messagePanelSummary", active.length ? `${plural(active.length, "active message")} · ${active.reduce((sum, message) => sum + message.readCount, 0)} of ${active.reduce((sum, message) => sum + message.recipientCount, 0)} reads` : "Send a notice that pops up on store dashboards");
  if (!messagesState.sent.length) { list.innerHTML = '<div class="empty-activity">No messages sent yet.</div>'; return; }
  const STATUS = { active: ["badge-completed", "Active"], ended: ["badge-archived", "Ended"], expired: ["badge-archived", "Expired"] };
  list.innerHTML = messagesState.sent.map((message) => { const [statusClass, statusLabel] = STATUS[message.status]; return `<div class="sent-message ${message.status}" data-message-id="${message.id}"><div class="message-head"><span class="badge badge-${message.level}">${MESSAGE_LEVEL_LABELS[message.level] || message.level}</span><span class="badge ${statusClass}">${statusLabel}</span>${message.automatic ? '<span class="badge badge-archived">Automatic</span>' : ""}<small>${relativeTime(message.createdAt)}</small></div><strong>${escapeHtml(message.title)}</strong><p>${escapeHtml(message.message)}</p><small>To ${message.recipients === "all" ? `all stores (${message.recipientCount})` : escapeHtml(message.recipientNames.join(", ") || "selected stores")} · read by ${message.readCount} of ${message.recipientCount}${message.status === "active" ? ` · ${messageTimeLeft(message)}` : ""}</small><div class="bill-actions">${message.status === "active" ? '<button type="button" class="ghost-button" data-message-end>End now</button>' : ""}<button type="button" class="danger-button" data-message-delete>Delete</button></div></div>`; }).join("");
}
async function loadSentMessages() { try { messagesState.sent = (await apiRequest("/api/admin/messages")).messages; renderSentMessages(); } catch (error) { document.querySelector("#sentMessages").innerHTML = `<div class="empty-activity">${escapeHtml(error.message)}</div>`; } }
setupSettingsGroups(document.querySelector("#messagePanel"));
document.querySelector("#messageAll").addEventListener("change", (event) => { document.querySelector("#messageRecipients").hidden = event.target.checked; });
document.querySelector("#messageDuration").addEventListener("change", (event) => { document.querySelector("#messageCustomDays").hidden = event.target.value !== "custom"; });
document.querySelector("#messageForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.target; settingsMessage(form, "Sending…");
  const duration = document.querySelector("#messageDuration").value; const durationHours = duration === "custom" ? Number(document.querySelector("#messageDays").value) * 24 : Number(duration);
  const recipients = document.querySelector("#messageAll").checked ? "all" : [...document.querySelectorAll("#messageRecipients input:checked")].map((box) => box.value);
  try {
    const result = await apiRequest("/api/admin/messages", { method: "POST", body: JSON.stringify({ title: document.querySelector("#messageTitle").value, message: document.querySelector("#messageText").value, level: document.querySelector("#messageLevel").value, durationHours, recipients }) });
    form.reset(); document.querySelector("#messageRecipients").hidden = true; document.querySelector("#messageCustomDays").hidden = true; renderMessageRecipients();
    settingsMessage(form, `Sent to ${result.message.recipients === "all" ? "all stores" : plural(result.message.recipientCount, "store")}.`); showToast("Message sent"); loadSentMessages();
  } catch (error) { settingsMessage(form, error.message, true); }
});
document.querySelector("#sentMessages").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-message-id]"); if (!row) return; const id = row.dataset.messageId;
  try {
    if (event.target.closest("[data-message-end]")) { await apiRequest(`/api/admin/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ end: true }) }); showToast("Message ended"); }
    if (event.target.closest("[data-message-delete]")) { if (!window.confirm("Delete this message? Stores will no longer see it.")) return; await apiRequest(`/api/admin/messages/${encodeURIComponent(id)}`, { method: "DELETE" }); showToast("Message deleted"); }
    loadSentMessages();
  } catch (error) { showToast(error.message); }
});
async function loadUsers() { try { adminState.users = (await apiRequest("/api/admin/stores")).users; renderUsers(); } catch (error) { document.querySelector("#userList").innerHTML = `<div class="empty-users">${escapeHtml(error.message)}</div>`; } }
setupChips(document.querySelector("#userFilters"), (filter) => { adminState.filter = filter; renderUsers(); });
// After any retailer mutation both the list and the dashboard stats are stale.
const refreshAdmin = () => Promise.all([loadUsers(), loadDashboard()]);
async function openUserDetails(userId) {
  try {
    const { user } = await apiRequest(`/api/admin/stores/${encodeURIComponent(userId)}`); selectedUserId = user.id;
    document.querySelector("#detailsTitle").textContent = user.storeName || user.name;
    document.querySelector("#editStoreName").value = user.storeName || ""; document.querySelector("#editUserName").value = user.name; document.querySelector("#editUserEmail").value = user.email; document.querySelector("#editUserPhone").value = user.phone;
    document.querySelector("#editBusinessType").value = user.businessType || ""; document.querySelector("#editAddress").value = user.address || "";
    document.querySelector("#editUserStatus").value = user.status;
    document.querySelector("#editUserMessage").textContent = `${USER_STATUS_LABELS[user.status] || user.status} · Signed up ${new Date(user.createdAt).toLocaleDateString()}`;
    document.querySelector("#archiveUserButton").hidden = user.status === "archived";
    document.querySelector("#deleteUserButton").hidden = user.status !== "archived";
    document.querySelector("#userDetails").hidden = false;
  } catch (error) { window.alert(error.message); }
}
const closeUserDetails = () => { document.querySelector("#userDetails").hidden = true; selectedUserId = null; };
document.querySelector("#closeDetailsButton").addEventListener("click", closeUserDetails);
document.querySelector("#userEditForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const message = document.querySelector("#editUserMessage");
  try {
    await apiRequest(`/api/admin/stores/${encodeURIComponent(selectedUserId)}`, { method: "PATCH", body: JSON.stringify({ storeName: document.querySelector("#editStoreName").value, name: document.querySelector("#editUserName").value, email: document.querySelector("#editUserEmail").value, phone: document.querySelector("#editUserPhone").value, businessType: document.querySelector("#editBusinessType").value, address: document.querySelector("#editAddress").value, status: document.querySelector("#editUserStatus").value }) });
    message.textContent = "Changes saved."; await refreshAdmin(); openUserDetails(selectedUserId);
  } catch (error) { message.textContent = error.message; }
});
document.querySelector("#resetPasswordButton").addEventListener("click", async () => { const message = document.querySelector("#editUserMessage"); try { const result = await apiRequest(`/api/admin/stores/${encodeURIComponent(selectedUserId)}/reset-password`, { method: "POST" }); message.textContent = result.temporaryPassword ? `${result.message}: ${result.temporaryPassword}` : result.message; loadDashboard(); } catch (error) { message.textContent = error.message; } });
document.querySelector("#archiveUserButton").addEventListener("click", async () => {
  if (!selectedUserId || !window.confirm("Archive this retailer? They will be signed out and can no longer sign in until restored.")) return;
  try { await apiRequest(`/api/admin/stores/${encodeURIComponent(selectedUserId)}`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) }); closeUserDetails(); await refreshAdmin(); showToast("Retailer archived"); }
  catch (error) { document.querySelector("#editUserMessage").textContent = error.message; }
});
document.querySelector("#deleteUserButton").addEventListener("click", async () => {
  if (!selectedUserId || !window.confirm("Delete this retailer permanently? This cannot be undone.")) return;
  try { await apiRequest(`/api/admin/stores/${encodeURIComponent(selectedUserId)}`, { method: "DELETE" }); closeUserDetails(); await refreshAdmin(); showToast("Retailer deleted"); }
  catch (error) { document.querySelector("#editUserMessage").textContent = error.message; }
});

// A saved session opens the app directly — no welcome page. Without one, the sign-in screen is already showing.
if (authToken) {
  fetch(`${API_BASE}/api/auth/session`, { headers: { authorization: `Bearer ${authToken}` } })
    .then(async (response) => { if (!response.ok) throw new Error("Session expired"); return response.json(); })
    .then((result) => openWorkspace(result))
    .catch(() => { localStorage.removeItem("ailexityAuthToken"); sessionStorage.removeItem("ailexityAuthToken"); authToken = null; document.documentElement.classList.remove("restoring"); });
} else document.documentElement.classList.remove("restoring");
