import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { reportStats, salesReportPdf, dayKey } from "./report.js";
import { welcomeMail, forgotPasswordMail, resetMail } from "./mail.js";
import { aiContext, askAi, aiProviders, AI_NOT_SET_UP } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch {}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "ailexity.info@gmail.com").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Ariesfab@15";
const APP_URL = process.env.APP_URL || ""; // public address of the site (e.g. https://ailexity.in)
// E-mails carry a button to the sign-in page (the site root is the public landing page).
const LOGIN_URL = APP_URL ? new URL("login", APP_URL.endsWith("/") ? APP_URL : `${APP_URL}/`).href : "";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000;
const DATA_FILE = path.join(__dirname, "data", "store-users.json");
const ITEMS_FILE = path.join(__dirname, "data", "items.json");
const BILLS_FILE = path.join(__dirname, "data", "bills.json");
const PAYMENT_METHODS = ["cash", "card", "upi", "credit"]; // credit = pay later: the bill stays pending until it is marked paid
const USER_STATUSES = ["active", "suspended", "archived"]; // stores sign themselves up, so there is no waiting state
const BILL_STATUSES = ["completed", "pending", "cancelled", "refunded"];
const DEFAULT_LOW_STOCK = 5;
const sessions = new Map();
const signupAttempts = new Map(); // crude per-IP throttle so the JSON store cannot be flooded with accounts

const json = (status, body, extraHeaders = {}) => ({ status, body, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } });
const send = (response, result) => { response.writeHead(result.status, result.headers); response.end(Buffer.isBuffer(result.body) ? result.body : JSON.stringify(result.body)); };
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
const sanitizeEmail = (value) => String(value || "").trim().toLowerCase();
const matchesHash = (value, expectedHash) => {
  if (!expectedHash) return false;
  const actual = Buffer.from(hash(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

// Each collection is one JSON file written atomically (temp file + rename).
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, file);
}
const readStore = () => readJson(DATA_FILE, { users: [] });
const writeStore = (store) => writeJson(DATA_FILE, store);
const readItems = () => readJson(ITEMS_FILE, { items: [] });
const readBills = () => readJson(BILLS_FILE, { bills: [] });
const SETTINGS_FILE = path.join(__dirname, "data", "settings.json");
// Messages the superadmin broadcasts to stores (data/messages.json): shown as a popup on the store dashboard until they expire or are ended.
const MESSAGES_FILE = path.join(__dirname, "data", "messages.json");
// Messages stores send to the superadmin (data/feedback.json). One way: a store writes, the superadmin reads and marks it seen / resolved.
const FEEDBACK_FILE = path.join(__dirname, "data", "feedback.json");
const FEEDBACK_CATEGORIES = ["feedback", "issue", "request", "other"];
const readFeedback = () => readJson(FEEDBACK_FILE, { feedback: [] });
// A store's own notes (data/notes.json): free text written in the app's editor, optionally with a reminder date and time.
// Private to the store; the superadmin never sees them.
const NOTES_FILE = path.join(__dirname, "data", "notes.json");
const MAX_NOTES_PER_STORE = 500;
const MAX_NOTE_HTML = 20000;
const readNotes = () => readJson(NOTES_FILE, { notes: [] });
// A store's conversations with the AI assistant (data/ai-chats.json). Private to the store, like notes.
const AI_CHATS_FILE = path.join(__dirname, "data", "ai-chats.json");
const MAX_AI_CHATS_PER_STORE = 100;
const MAX_AI_MESSAGES_PER_CHAT = 200;
const MAX_AI_QUESTION = 2000;
const AI_HOURLY_LIMIT = 60; // questions per store per hour, so one store cannot use up the free-tier quota
const aiAttempts = new Map();
const readAiChats = () => readJson(AI_CHATS_FILE, { chats: [] });
const aiChatSummary = ({ id, title, messages, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt, messageCount: messages.length, preview: (messages.at(-1)?.text || "").replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) });
const feedbackStatus = (item) => (item.resolvedAt ? "resolved" : item.seenAt ? "seen" : "new");
const feedbackView = (item) => ({ ...item, status: feedbackStatus(item) });
const MESSAGE_LEVELS = ["info", "important", "urgent"];
const readMessages = () => readJson(MESSAGES_FILE, { messages: [] });
const messageActive = (message, now = Date.now()) => !message.endedAt && Date.parse(message.expiresAt) > now;
const messageTargets = (message, storeId) => message.recipients === "all" || (Array.isArray(message.recipients) && message.recipients.includes(storeId));
// Platform-wide settings managed by the superadmin (data/settings.json); keys missing from the file fall back to these.
const PLATFORM_DEFAULTS = { platformName: "Ailexity Retail", supportEmail: "", supportPhone: "", currency: "INR", whatsappCountryCode: "91", appUrl: "", sessionHours: Number(process.env.SESSION_TTL_HOURS || 12), alerts: { suspended: true, pendingPayments: true, lowStock: true, outOfStock: true }, adminPasswordHash: null, adminPasswordChangedAt: null };
// Per-store preferences, kept on the retailer's user record under `settings`.
// legalName / gstin / placeOfSupply / fssai / terms only ever appear on the invoice: a store that
// leaves them blank simply gets a receipt without those rows.
const STORE_SETTINGS_DEFAULTS = { taxRate: 0, taxLabel: "Tax", invoiceNote: "Thank you for shopping with us!", showContactOnInvoice: true, lowStockDefault: DEFAULT_LOW_STOCK, stockToasts: true, legalName: "", gstin: "", placeOfSupply: "", fssai: "", terms: "" };
async function readSettings() { const stored = await readJson(SETTINGS_FILE, {}); return { ...PLATFORM_DEFAULTS, ...stored, alerts: { ...PLATFORM_DEFAULTS.alerts, ...(stored.alerts || {}) } }; }
const writeSettings = (settings) => writeJson(SETTINGS_FILE, settings);
// The part of the platform settings every signed-in user gets (money formatting, WhatsApp links, support contact).
// Settings win over the environment, so the address can be corrected from inside the app.
const publicPlatform = ({ platformName, supportEmail, supportPhone, currency, whatsappCountryCode, appUrl }) => ({ platformName, supportEmail, supportPhone, currency, whatsappCountryCode, appUrl: appUrl || APP_URL || "" });
const adminSettingsView = ({ adminPasswordHash, ...settings }) => ({ ...settings, passwordSource: adminPasswordHash ? "settings" : "env" });
const storeSettings = (user) => ({ ...STORE_SETTINGS_DEFAULTS, ...(user.settings || {}) });
// A password set in Settings → Security (hashed in settings.json) replaces the one from the environment.
const adminPasswordOk = (password, settings) => settings.adminPasswordHash ? matchesHash(String(password || ""), settings.adminPasswordHash) : String(password || "") === ADMIN_PASSWORD;
function validCurrency(code) { try { new Intl.NumberFormat("en", { style: "currency", currency: code }); return /^[A-Z]{3}$/.test(code); } catch { return false; } }
const bearerToken = (request) => request.headers.authorization?.replace(/^Bearer\s+/i, "");
async function body(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON"); }
}
function auth(request, requiredRole = "admin") {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now() || session.role !== requiredRole) return null;
  return session;
}
function anyAuth(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}
function createSession(email, role, userId = null, ttlMs = SESSION_TTL_MS) {
  const token = randomToken();
  sessions.set(token, { email, role, userId, expiresAt: Date.now() + ttlMs });
  return token;
}
function mailer() {
  const smtpPassword = String(process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !smtpPassword || smtpPassword === "your-app-password") return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== "false", auth: { user: process.env.SMTP_USER, pass: smtpPassword } });
}
// Every message goes out as branded HTML + plain text (see mail.js). Without SMTP the secret is printed for local development only.
async function deliver(user, message, label, secret) {
  const transport = mailer();
  if (!transport) { console.warn(`[SMTP not configured] ${label} for ${user.email}: ${secret}`); return false; }
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: message.subject, text: message.text, html: message.html });
  return true;
}
const sendWelcomeEmail = (user, platform) => deliver(user, welcomeMail({ user, platform, appUrl: LOGIN_URL }), "Welcome", user.email);
const sendForgotPasswordEmail = (user, temporaryPassword, platform) => deliver(user, forgotPasswordMail({ user, temporaryPassword, platform, appUrl: LOGIN_URL }), "Temporary password", temporaryPassword);
const sendResetPasswordEmail = (user, temporaryPassword, platform) => deliver(user, resetMail({ user, temporaryPassword, platform, appUrl: LOGIN_URL }), "Temporary password", temporaryPassword);
const temporaryPasswordValue = () => `Ailex-${crypto.randomBytes(5).toString("base64url")}`;

const safeUser = ({ passwordHash, ...user }) => user;
// What a signed-in retailer sees about their own account (login + session responses).
const storeProfile = (user) => ({ role: "store", email: user.email, name: user.name, storeName: user.storeName || "", phone: user.phone, businessType: user.businessType || "", address: user.address || "", createdAt: user.createdAt || null, passwordResetRequired: Boolean(user.passwordResetRequired), passwordChangedAt: user.passwordChangedAt || null, settings: storeSettings(user) });
const optionalText = (value, max) => String(value ?? "").trim().slice(0, max);
const dropSessions = (userId) => { for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token); };
const invoiceNumber = (bill) => `INV-${String(bill.number).padStart(4, "0")}`;
// Order timeline (order created → bill generated → payment confirmed → invoice generated → WhatsApp sent / cancelled / refunded), derived from the bill's timestamps.
const timelineOf = (bill) => [["order_created", bill.createdAt], ["bill_generated", bill.createdAt], ["payment_confirmed", bill.paidAt], ["invoice_generated", bill.invoiceGeneratedAt], ["whatsapp_sent", bill.whatsappSentAt], ["cancelled", bill.cancelledAt], ["refunded", bill.refundedAt]]
  .filter(([, at]) => at).map(([type, at]) => ({ type, at })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
// Bills written before order statuses / invoices existed are completed, paid, untaxed bills.
// A bill becomes shareable through an unguessable token. It is minted the first time
// the invoice is shared, so old bills pick one up without a migration.
const shareToken = () => crypto.randomBytes(12).toString("base64url");
function normalizeBill(bill) {
  const full = { status: "completed", customerName: "", customerPhone: "", subtotal: bill.total, discount: 0, taxRate: 0, taxLabel: "Tax", tax: 0, paidAt: bill.createdAt, invoiceNumber: null, invoiceGeneratedAt: null, whatsappSentAt: null, cancelledAt: null, refundedAt: null, ...bill };
  if ((full.status === "completed" || full.status === "refunded") && !full.invoiceNumber) { full.invoiceNumber = invoiceNumber(full); full.invoiceGeneratedAt = full.invoiceGeneratedAt || full.paidAt; }
  return { ...full, timeline: timelineOf(full) };
}
function validUserInput(input) {
  return input.name?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizeEmail(input.email)) && /^\+?[0-9 ()-]{7,20}$/.test(String(input.phone || "").trim());
}
// At most SIGNUP_LIMIT new accounts per address per hour. In-memory, like the sessions: a restart clears it.
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
function throttleSignup(request) {
  const from = String(request.socket.remoteAddress || "unknown");
  const now = Date.now();
  const recent = (signupAttempts.get(from) || []).filter((at) => now - at < SIGNUP_WINDOW_MS);
  if (recent.length >= SIGNUP_LIMIT) { signupAttempts.set(from, recent); return false; }
  recent.push(now); signupAttempts.set(from, recent);
  return true;
}

// A store session is usable unless the account was suspended or archived for abuse. Nothing expires.
async function storeAuth(request) {
  const session = auth(request, "store"); if (!session) return null;
  const store = await readStore(); const user = store.users.find((item) => item.id === session.userId);
  if (!user || user.status !== "active") return null;
  return user;
}
const toMoney = (value) => Math.round(Number(value) * 100) / 100;
// Item schema: name (1-80 chars), optional sku (<=40 chars, unique per store), optional category (<=40 chars), price (>= 0, 2dp),
// quantity (whole number >= 0), lowStockThreshold (whole number >= 0; the item counts as "low stock" at or below it).
// Fields missing from `input` fall back to `existing`, so the same validator serves create (existing = {}) and update.
function itemInput(input, existing = {}, defaultLow = DEFAULT_LOW_STOCK) {
  const name = String(input.name ?? existing.name ?? "").trim();
  const sku = String(input.sku ?? existing.sku ?? "").trim();
  const category = String(input.category ?? existing.category ?? "").trim();
  const price = input.price === undefined ? existing.price : Number(input.price);
  const quantity = input.quantity === undefined ? existing.quantity : Number(input.quantity);
  const rawLow = input.lowStockThreshold;
  const lowStockThreshold = rawLow === undefined || rawLow === null || rawLow === "" ? (existing.lowStockThreshold ?? defaultLow) : Number(rawLow);
  if (!name || name.length > 80) return { error: "Item name is required (max 80 characters)" };
  if (sku.length > 40) return { error: "SKU must be 40 characters or fewer" };
  if (category.length > 40) return { error: "Category must be 40 characters or fewer" };
  if (!Number.isFinite(price) || price < 0) return { error: "Price must be 0 or more" };
  if (!Number.isInteger(quantity) || quantity < 0) return { error: "Quantity must be a whole number, 0 or more" };
  if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) return { error: "Low-stock alert must be a whole number, 0 or more" };
  return { name, sku, category, price: toMoney(price), quantity, lowStockThreshold };
}
// Note content is the editor's HTML reduced to a fixed whitelist: text formatting, line breaks, bullet lists and checklists
// (<ul class="todo"> with <li data-checked="true">). Every other tag and every attribute is dropped, so the stored HTML is
// safe to put straight back into the page.
const NOTE_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "br", "div", "p", "ul", "ol", "li"]);
function cleanNoteHtml(html) {
  return String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/(<[^>]*>)/).map((part) => {
    if (!part.startsWith("<")) return part.replace(/[<>]/g, "");
    const match = part.match(/^<(\/?)([a-z0-9]+)([^>]*)>$/i); if (!match) return "";
    const tag = match[2].toLowerCase(); if (!NOTE_TAGS.has(tag)) return "";
    if (tag === "br") return match[1] ? "" : "<br>";
    if (match[1]) return `</${tag}>`;
    if (tag === "ul" && /\bclass="todo"/.test(match[3])) return '<ul class="todo">';
    if (tag === "li" && /\bdata-checked="true"/.test(match[3])) return '<li data-checked="true">';
    return `<${tag}>`;
  }).join("");
}
// Plain-text version of a note for previews, the reminder popup and the title: one line per block, checklist items marked ☐ / ☑.
function noteText(html) {
  let todo = false;
  const text = html.replace(/<[^>]*>/g, (tag) => {
    if (tag === '<ul class="todo">') { todo = true; return "\n"; }
    if (tag === "</ul>") { todo = false; return "\n"; }
    if (tag === '<li data-checked="true">') return "\n☑ ";
    if (tag === "<li>") return todo ? "\n☐ " : "\n• ";
    return /^<(br|\/div|\/p|\/li|div|p)>$/.test(tag) ? "\n" : "";
  });
  return text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
// The title is the first line, without a checklist / bullet marker when the note starts with a list.
const noteTitle = (text) => (text.split("\n")[0] || "").replace(/^[☐☑•] /, "").slice(0, 80);
// Note schema: `html` (the editor content, cleaned as above, <= 20000 chars) from which `text` and `title` (the first line, <= 80 chars)
// are derived; an optional reminder as `dueDate` ("YYYY-MM-DD") + `dueTime` ("HH:MM"), kept exactly as typed on the phone (local
// time, never converted). Like itemInput, fields missing from `input` fall back to `existing`.
function noteInput(input, existing = {}) {
  const html = input.html === undefined ? (existing.html || "") : cleanNoteHtml(input.html);
  const dueDate = String(input.dueDate ?? existing.dueDate ?? "").trim();
  const dueTime = String(input.dueTime ?? existing.dueTime ?? "").trim();
  if (html.length > MAX_NOTE_HTML) return { error: "This note is too long" };
  const text = noteText(html); const title = noteTitle(text);
  if (!text) return { error: "Write something first" };
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { error: "Invalid date" };
  if (dueTime && !/^\d{2}:\d{2}$/.test(dueTime)) return { error: "Invalid time" };
  if (Boolean(dueDate) !== Boolean(dueTime)) return { error: dueDate ? "Pick a time for the reminder" : "Pick a date for the reminder" };
  return { html, text, title, dueDate, dueTime };
}
// Notes written by the first version of the editor (title / text / items fields, no html) are shown as the same content.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function normalizeNote(note) {
  if (note.html !== undefined) return note;
  const lines = [note.title, ...String(note.text || "").split("\n")].map((line) => String(line || "").trim()).filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`);
  const items = Array.isArray(note.items) && note.items.length ? `<ul class="todo">${note.items.map((item) => `<li${item.done || item.doneOn ? ' data-checked="true"' : ""}>${escapeHtml(item.text || "")}</li>`).join("")}</ul>` : "";
  const html = lines.join("") + items; const text = noteText(html);
  const { type, items: _items, repeat, pinned, doneOn, ...rest } = note;
  return { ...rest, html, text, title: noteTitle(text), dueDate: type === "reminder" ? note.dueDate || "" : "", dueTime: type === "reminder" ? note.dueTime || "" : "", doneAt: note.doneAt || null };
}
async function route(request, url) {
  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const session = anyAuth(request);
    if (!session) return json(401, { error: "Session expired" });
    const platform = publicPlatform(await readSettings());
    if (session.role === "admin") return json(200, { role: "admin", email: session.email, platform });
    const store = await readStore(); const user = store.users.find((item) => item.id === session.userId);
    if (!user || user.status !== "active") return json(401, { error: "Account unavailable" });
    return json(200, { ...storeProfile(user), platform });
  }
  // Anyone can open an account: no invitation, no activation key, no plan. The account works the moment it is created
  // and the caller is signed straight in, so nothing waits on the platform team.
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const input = await body(request);
    const settings = await readSettings(); const ttl = settings.sessionHours * 3600000; const platform = publicPlatform(settings);
    const email = sanitizeEmail(input.email);
    if (!throttleSignup(request)) return json(429, { error: "Too many accounts created from here. Try again in an hour." });
    const name = String(input.name || "").trim();
    const storeName = String(input.storeName || "").trim();
    const password = String(input.password || "");
    if (!storeName) return json(400, { error: "Store name is required", field: "storeName" });
    if (!name) return json(400, { error: "Your name is required", field: "name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Enter a valid email address", field: "email" });
    if (!/^\+?[0-9 ()-]{7,20}$/.test(String(input.phone || "").trim())) return json(400, { error: "Enter a valid mobile number", field: "phone" });
    if (password.length < 8) return json(400, { error: "Password must be at least 8 characters", field: "password" });
    if (email === ADMIN_EMAIL) return json(409, { error: "That email cannot be used for a store account", field: "email" });
    const store = await readStore();
    if (store.users.some((item) => item.email === email)) return json(409, { error: "An account already exists for this email. Sign in instead.", field: "email" });
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(), name, storeName, businessType: optionalText(input.businessType, 40), address: optionalText(input.address, 160),
      email, phone: String(input.phone).trim(), status: "active", passwordHash: hash(password),
      createdAt: now, createdBy: "self", activatedAt: now,
    };
    store.users.push(user); await writeStore(store);
    // The welcome email goes out after the reply: a slow or broken SMTP server must never hold up a sign-up.
    sendWelcomeEmail(user, platform).catch((error) => console.error("Welcome email:", error.message));
    return json(201, { token: createSession(email, "store", user.id, ttl), ...storeProfile(user), platform, firstLogin: true });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const input = await body(request); const email = sanitizeEmail(input.email);
    const settings = await readSettings(); const ttl = settings.sessionHours * 3600000; const platform = publicPlatform(settings);
    if (email === ADMIN_EMAIL && adminPasswordOk(input.password, settings)) return json(200, { token: createSession(email, "admin", null, ttl), role: "admin", email, platform });
    const store = await readStore(); const user = store.users.find((item) => item.email === email);
    if (!user) return json(401, { error: "Invalid email or password" });
    // Password first, then the account state, so a wrong password never reveals why an account is blocked.
    if (!matchesHash(input.password || "", user.passwordHash)) return json(401, { error: "Invalid email or password" });
    if (user.status === "suspended") return json(403, { error: "This account is suspended. Contact support." });
    if (user.status === "archived") return json(403, { error: "This account has been closed. Contact support." });
    if (user.status !== "active") return json(401, { error: "Invalid email or password" });
    return json(200, { token: createSession(email, "store", user.id, ttl), ...storeProfile(user), platform });
  }
  // Forgotten password: the store mails itself a temporary one. The reply never says whether the address exists.
  if (request.method === "POST" && url.pathname === "/api/auth/forgot") {
    const input = await body(request); const email = sanitizeEmail(input.email);
    const done = json(200, { message: "If that email has an account, a temporary password is on its way. Check spam too." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: "Enter a valid email address" });
    const store = await readStore(); const user = store.users.find((item) => item.email === email);
    if (!user || user.status !== "active") return done;
    const temporaryPassword = temporaryPasswordValue();
    user.passwordHash = hash(temporaryPassword); user.passwordResetRequired = true; user.passwordResetAt = new Date().toISOString();
    await writeStore(store);
    await sendForgotPasswordEmail(user, temporaryPassword, publicPlatform(await readSettings())).catch((error) => console.error("Forgot password email:", error.message));
    return done;
  }
  // Sales performance report for a date range as a PDF. `from`/`to` are ISO timestamps of local midnights (to is exclusive),
  // `tz` the browser's timezone offset in minutes so dates in the PDF read in the store's local time, `orders=1` appends every order.
  if (request.method === "GET" && url.pathname === "/api/store/reports/sales.pdf") {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const from = Date.parse(url.searchParams.get("from") || ""); const to = Date.parse(url.searchParams.get("to") || ""); const tz = Number(url.searchParams.get("tz") || 0);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return json(400, { error: "Choose a valid date range" });
    if (to - from > 366 * 86400000) return json(400, { error: "Reports cover at most one year at a time" });
    if (!Number.isInteger(tz) || Math.abs(tz) > 840) return json(400, { error: "Invalid timezone offset" });
    const bills = (await readBills()).bills.filter((bill) => bill.storeId === storeUser.id).map(normalizeBill);
    const stats = reportStats(bills, from, to, tz);
    const pdf = salesReportPdf({ store: storeUser, platform: publicPlatform(await readSettings()), stats, label: optionalText(url.searchParams.get("label"), 40), includeOrders: url.searchParams.get("orders") === "1" });
    const filename = `sales-report-${dayKey(from, tz)}-to-${dayKey(to - 1, tz)}.pdf`;
    return { status: 200, body: pdf, headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}"`, "content-length": pdf.length, "cache-control": "no-store" } };
  }
  // AI assistant: GET lists the store's chats (or one chat with :id), POST asks a question (new chat unless chatId is given), DELETE removes a chat.
  const aiRoute = url.pathname.match(/^\/api\/store\/ai\/chats(?:\/([^/]+))?$/);
  if (aiRoute) {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const id = aiRoute[1] && decodeURIComponent(aiRoute[1]); const data = await readAiChats(); const mine = (chat) => chat.storeId === storeUser.id;
    if (request.method === "GET" && !id) return json(200, { enabled: aiProviders().length > 0, chats: data.chats.filter(mine).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map(aiChatSummary) });
    if (request.method === "POST" && !id) {
      const input = await body(request); const question = optionalText(input.message, MAX_AI_QUESTION); const tz = Number(input.tz || 0);
      if (!question) return json(400, { error: "Type a question first" });
      if (!aiProviders().length) return json(503, { error: AI_NOT_SET_UP });
      if (!Number.isInteger(tz) || Math.abs(tz) > 840) return json(400, { error: "Invalid timezone offset" });
      let chat = input.chatId ? data.chats.find((entry) => entry.id === input.chatId && mine(entry)) : null;
      if (input.chatId && !chat) return json(404, { error: "Chat not found" });
      if (!chat && data.chats.filter(mine).length >= MAX_AI_CHATS_PER_STORE) return json(409, { error: `You can keep up to ${MAX_AI_CHATS_PER_STORE} chats — delete some old ones first` });
      if (chat && chat.messages.length >= MAX_AI_MESSAGES_PER_CHAT) return json(409, { error: "This chat is full — start a new chat" });
      const now = Date.now(); const recent = (aiAttempts.get(storeUser.id) || []).filter((at) => now - at < 3600000);
      if (recent.length >= AI_HOURLY_LIMIT) return json(429, { error: "You have asked a lot of questions this hour — please try again a little later" });
      recent.push(now); aiAttempts.set(storeUser.id, recent);
      const [bills, items, platform] = [(await readBills()).bills.filter((bill) => bill.storeId === storeUser.id).map(normalizeBill), (await readItems()).items.filter((item) => item.storeId === storeUser.id), publicPlatform(await readSettings())];
      const asked = { role: "user", text: question, at: new Date().toISOString() };
      let answer;
      try { answer = await askAi({ context: aiContext({ store: storeUser, settings: storeSettings(storeUser), platform, bills, items, tz }), history: [...(chat?.messages || []), asked], platformName: platform.platformName }); }
      catch (error) { console.error("AI assistant:", error.message, error.detail ? `(${error.detail})` : ""); return json(error.status || 502, { error: error.message }); }
      // Re-read before writing: another device may have changed the file while the AI was answering.
      const fresh = await readAiChats(); const replied = { role: "assistant", text: answer.text, via: answer.via, at: new Date().toISOString() };
      chat = chat && fresh.chats.find((entry) => entry.id === chat.id);
      if (chat) { chat.messages.push(asked, replied); chat.updatedAt = replied.at; }
      else { chat = { id: crypto.randomUUID(), storeId: storeUser.id, title: question.replace(/\s+/g, " ").slice(0, 80), messages: [asked, replied], createdAt: asked.at, updatedAt: replied.at }; fresh.chats.push(chat); }
      await writeJson(AI_CHATS_FILE, fresh);
      const { storeId, ...view } = chat; return json(chat.messages.length === 2 ? 201 : 200, { chat: view });
    }
    const chat = id && data.chats.find((entry) => entry.id === id && mine(entry));
    if (!chat) return json(404, { error: "Chat not found" });
    if (request.method === "GET") { const { storeId, ...view } = chat; return json(200, { chat: view }); }
    if (request.method === "DELETE") { data.chats.splice(data.chats.indexOf(chat), 1); await writeJson(AI_CHATS_FILE, data); return json(200, { message: "Chat deleted" }); }
    return json(405, { error: "Method not allowed" });
  }
  const storeRoute = url.pathname.match(/^\/api\/store\/(items|bills|notes)(?:\/([^/]+))?$/);
  if (url.pathname === "/api/store/feedback") {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const data = await readFeedback();
    if (request.method === "GET") return json(200, { feedback: data.feedback.filter((item) => item.storeId === storeUser.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(feedbackView) });
    if (request.method === "POST") {
      const input = await body(request); const subject = optionalText(input.subject, 100); const text = optionalText(input.message, 1000);
      if (!FEEDBACK_CATEGORIES.includes(input.category)) return json(400, { error: "Choose what the message is about" });
      if (!subject) return json(400, { error: "Give the message a subject" });
      if (!text) return json(400, { error: "Write the message" });
      const recent = data.feedback.filter((item) => item.storeId === storeUser.id && Date.now() - Date.parse(item.createdAt) < 86400000).length;
      if (recent >= 20) return json(429, { error: "You have sent a lot of messages today — please try again tomorrow" });
      const item = { id: crypto.randomUUID(), storeId: storeUser.id, storeName: storeUser.storeName || "", ownerName: storeUser.name, email: storeUser.email, category: input.category, subject, message: text, createdAt: new Date().toISOString(), seenAt: null, resolvedAt: null };
      data.feedback.push(item); await writeJson(FEEDBACK_FILE, data); return json(201, { item: feedbackView(item) });
    }
    return json(405, { error: "Method not allowed" });
  }
  const messageRoute = url.pathname.match(/^\/api\/store\/messages(?:\/([^/]+)\/read)?$/);
  if (messageRoute) {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const data = await readMessages(); const now = Date.now();
    if (request.method === "GET" && !messageRoute[1]) {
      const messages = data.messages.filter((message) => messageActive(message, now) && messageTargets(message, storeUser.id)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(({ id, title, message, level, createdAt, expiresAt, readBy }) => ({ id, title, message, level, createdAt, expiresAt, read: Boolean(readBy?.[storeUser.id]) }));
      return json(200, { messages, unread: messages.filter((message) => !message.read).length });
    }
    if (request.method === "POST" && messageRoute[1]) {
      const message = data.messages.find((entry) => entry.id === decodeURIComponent(messageRoute[1]) && messageTargets(entry, storeUser.id));
      if (!message) return json(404, { error: "Message not found" });
      message.readBy = { ...(message.readBy || {}), [storeUser.id]: new Date().toISOString() }; await writeJson(MESSAGES_FILE, data);
      return json(200, { id: message.id, read: true });
    }
    return json(405, { error: "Method not allowed" });
  }
  if (url.pathname === "/api/store/settings" || url.pathname === "/api/store/password") {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const store = await readStore(); const user = store.users.find((item) => item.id === storeUser.id); const platform = publicPlatform(await readSettings());
    if (request.method === "GET" && url.pathname === "/api/store/settings") return json(200, { ...storeProfile(user), platform });
    if (request.method === "PATCH" && url.pathname === "/api/store/settings") {
      const input = await body(request);
      // Profile fields the owner may edit themselves (the sign-in email stays under superadmin control).
      if (input.storeName !== undefined) { if (!optionalText(input.storeName, 80)) return json(400, { error: "Store name is required" }); user.storeName = optionalText(input.storeName, 80); }
      if (input.name !== undefined || input.phone !== undefined) {
        const name = String(input.name ?? user.name), phone = String(input.phone ?? user.phone);
        if (!validUserInput({ name, email: user.email, phone })) return json(400, { error: "Owner name and a valid phone number are required" });
        user.name = name.trim(); user.phone = phone.trim();
      }
      if (input.businessType !== undefined) user.businessType = optionalText(input.businessType, 40);
      if (input.address !== undefined) user.address = optionalText(input.address, 160);
      // Billing and inventory preferences.
      const settings = storeSettings(user);
      if (input.taxRate !== undefined) { const rate = input.taxRate === "" ? 0 : Number(input.taxRate); if (!Number.isFinite(rate) || rate < 0 || rate > 100) return json(400, { error: "Tax rate must be between 0 and 100%" }); settings.taxRate = Math.round(rate * 100) / 100; }
      if (input.taxLabel !== undefined) settings.taxLabel = optionalText(input.taxLabel, 20) || "Tax";
      if (input.invoiceNote !== undefined) settings.invoiceNote = optionalText(input.invoiceNote, 200);
      if (input.legalName !== undefined) settings.legalName = optionalText(input.legalName, 120);
      if (input.gstin !== undefined) {
        const gstin = String(input.gstin || "").trim().toUpperCase();
        // 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum. Blank is fine.
        if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gstin)) return json(400, { error: "GSTIN must be 15 characters, e.g. 23ABCDE1234F1Z5" });
        settings.gstin = gstin;
      }
      if (input.placeOfSupply !== undefined) settings.placeOfSupply = optionalText(input.placeOfSupply, 60);
      if (input.fssai !== undefined) {
        const fssai = String(input.fssai || "").trim();
        if (fssai && !/^[0-9]{14}$/.test(fssai)) return json(400, { error: "FSSAI licence number must be 14 digits" });
        settings.fssai = fssai;
      }
      if (input.terms !== undefined) settings.terms = optionalText(input.terms, 600);
      if (input.showContactOnInvoice !== undefined) settings.showContactOnInvoice = Boolean(input.showContactOnInvoice);
      if (input.lowStockDefault !== undefined) { const level = Number(input.lowStockDefault); if (!Number.isInteger(level) || level < 0) return json(400, { error: "Low-stock level must be a whole number, 0 or more" }); settings.lowStockDefault = level; }
      if (input.stockToasts !== undefined) settings.stockToasts = Boolean(input.stockToasts);
      user.settings = settings; user.updatedAt = new Date().toISOString(); await writeStore(store);
      return json(200, { ...storeProfile(user), platform });
    }
    if (request.method === "POST" && url.pathname === "/api/store/password") {
      const input = await body(request);
      if (!matchesHash(String(input.currentPassword || ""), user.passwordHash)) return json(401, { error: "Current password is incorrect" });
      if (!input.newPassword || String(input.newPassword).length < 8) return json(400, { error: "New password must be at least 8 characters" });
      user.passwordHash = hash(String(input.newPassword)); user.passwordChangedAt = new Date().toISOString(); delete user.passwordResetRequired; await writeStore(store);
      // Other devices are signed out; this session stays valid.
      const token = bearerToken(request); for (const [key, session] of sessions) if (session.userId === user.id && key !== token) sessions.delete(key);
      return json(200, { message: "Password updated", ...storeProfile(user), platform });
    }
    return json(405, { error: "Method not allowed" });
  }
  if (storeRoute) {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Store sign-in required" });
    const [, collection, rawId] = storeRoute; const id = rawId && decodeURIComponent(rawId); const mine = (record) => record.storeId === storeUser.id;
    if (collection === "items") {
      const data = await readItems();
      if (request.method === "GET" && !id) return json(200, { items: data.items.filter(mine).sort((a, b) => a.name.localeCompare(b.name)) });
      if (request.method === "POST" && !id) {
        const input = itemInput(await body(request), {}, storeSettings(storeUser).lowStockDefault); if (input.error) return json(400, { error: input.error });
        if (input.sku && data.items.some((item) => mine(item) && item.sku === input.sku)) return json(409, { error: "An item with this SKU already exists" });
        const item = { id: crypto.randomUUID(), storeId: storeUser.id, ...input, createdAt: new Date().toISOString(), updatedAt: null };
        data.items.push(item); await writeJson(ITEMS_FILE, data); return json(201, { item });
      }
      const item = id && data.items.find((entry) => entry.id === id && mine(entry));
      if (!item) return json(404, { error: "Item not found" });
      if (request.method === "GET") return json(200, { item });
      if (request.method === "PATCH") {
        const raw = await body(request);
        if (raw.adjustQuantity !== undefined) raw.quantity = item.quantity + Number(raw.adjustQuantity);
        const input = itemInput(raw, item); if (input.error) return json(400, { error: input.error });
        if (input.sku && data.items.some((entry) => entry.id !== item.id && mine(entry) && entry.sku === input.sku)) return json(409, { error: "An item with this SKU already exists" });
        Object.assign(item, input, { updatedAt: new Date().toISOString() }); await writeJson(ITEMS_FILE, data); return json(200, { item });
      }
      if (request.method === "DELETE") { data.items.splice(data.items.indexOf(item), 1); await writeJson(ITEMS_FILE, data); return json(200, { message: "Item deleted" }); }
    }
    if (collection === "notes") {
      const data = await readNotes(); data.notes = data.notes.map(normalizeNote);
      if (request.method === "GET" && !id) return json(200, { notes: data.notes.filter(mine).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)) });
      if (request.method === "POST" && !id) {
        if (data.notes.filter(mine).length >= MAX_NOTES_PER_STORE) return json(409, { error: `You can keep up to ${MAX_NOTES_PER_STORE} notes — delete some old ones first` });
        const input = noteInput(await body(request)); if (input.error) return json(400, { error: input.error });
        const note = { id: crypto.randomUUID(), storeId: storeUser.id, ...input, doneAt: null, createdAt: new Date().toISOString(), updatedAt: null };
        data.notes.push(note); await writeJson(NOTES_FILE, data); return json(201, { note });
      }
      const note = id && data.notes.find((entry) => entry.id === id && mine(entry));
      if (!note) return json(404, { error: "Note not found" });
      if (request.method === "GET") return json(200, { note });
      if (request.method === "PATCH") {
        // Edits the fields sent. Changing or removing the reminder reopens it; `done` ticks or unticks it.
        const raw = await body(request); const now = new Date().toISOString();
        const input = noteInput(raw, note); if (input.error) return json(400, { error: input.error });
        if (input.dueDate !== note.dueDate || input.dueTime !== note.dueTime) note.doneAt = null;
        Object.assign(note, input);
        if (raw.done !== undefined) note.doneAt = raw.done && note.dueDate ? now : null;
        note.updatedAt = now; await writeJson(NOTES_FILE, data); return json(200, { note });
      }
      if (request.method === "DELETE") { data.notes.splice(data.notes.indexOf(note), 1); await writeJson(NOTES_FILE, data); return json(200, { message: "Note deleted" }); }
    }
    if (collection === "bills") {
      const data = await readBills();
      if (request.method === "GET" && !id) return json(200, { bills: data.bills.filter(mine).map(normalizeBill).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) });
      if (request.method === "POST" && !id) {
        const input = await body(request);
        const paymentMethod = PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : "cash";
        // Merge duplicate item lines so the stock check sees the combined quantity.
        const requested = new Map();
        for (const line of Array.isArray(input.lines) ? input.lines : []) requested.set(line?.itemId, (requested.get(line?.itemId) || 0) + Number(line?.quantity));
        if (!requested.size) return json(400, { error: "Add at least one item to the bill" });
        const catalog = await readItems(); const lines = [];
        for (const [itemId, quantity] of requested) {
          const item = catalog.items.find((entry) => entry.id === itemId && mine(entry));
          if (!item) return json(400, { error: "One of the items in the cart no longer exists" });
          if (!Number.isInteger(quantity) || quantity < 1) return json(400, { error: `Invalid quantity for ${item.name}` });
          if (quantity > item.quantity) return json(409, { error: `Only ${item.quantity} × ${item.name} left in stock` });
          lines.push({ itemId: item.id, name: item.name, sku: item.sku, price: item.price, quantity, total: toMoney(item.price * quantity) });
        }
        // Totals: subtotal − discount (an amount, at most the subtotal) + tax (a percentage of the discounted subtotal).
        const subtotal = toMoney(lines.reduce((sum, line) => sum + line.total, 0));
        const discount = input.discount === undefined || input.discount === "" ? 0 : toMoney(Number(input.discount));
        const preferences = storeSettings(storeUser);
        const taxRate = input.taxRate === undefined || input.taxRate === "" ? preferences.taxRate : Math.round(Number(input.taxRate) * 100) / 100;
        if (!Number.isFinite(discount) || discount < 0 || discount > subtotal) return json(400, { error: "Discount must be between 0 and the subtotal" });
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return json(400, { error: "Tax rate must be between 0 and 100%" });
        const tax = toMoney((subtotal - discount) * taxRate / 100); const total = toMoney(subtotal - discount + tax);
        const now = new Date().toISOString();
        for (const line of lines) { const item = catalog.items.find((entry) => entry.id === line.itemId); item.quantity -= line.quantity; item.updatedAt = now; }
        const number = data.bills.filter(mine).reduce((max, bill) => Math.max(max, bill.number), 0) + 1;
        // "Pay later" bills start pending; every other payment method confirms payment and generates the invoice immediately.
        const status = paymentMethod === "credit" ? "pending" : "completed";
        const bill = { id: crypto.randomUUID(), storeId: storeUser.id, shareToken: shareToken(), number, lines, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal, discount, taxRate, taxLabel: preferences.taxLabel, tax, total, paymentMethod, status, customerName: optionalText(input.customerName, 80), customerPhone: optionalText(input.customerPhone, 20), paidAt: status === "completed" ? now : null, invoiceNumber: status === "completed" ? invoiceNumber({ number }) : null, invoiceGeneratedAt: status === "completed" ? now : null, whatsappSentAt: null, cancelledAt: null, refundedAt: null, createdAt: now, createdBy: storeUser.email };
        data.bills.push(bill); await writeJson(ITEMS_FILE, catalog); await writeJson(BILLS_FILE, data); return json(201, { bill: normalizeBill(bill) });
      }
      const bill = id && data.bills.find((entry) => entry.id === id && mine(entry));
      if (!bill) return json(404, { error: "Bill not found" });
      if (request.method === "GET") return json(200, { bill: normalizeBill(bill) });
      if (request.method === "PATCH") {
        // Order lifecycle: pending → completed (payment confirmed + invoice generated) or cancelled; completed → refunded.
        // Cancelling or refunding returns the items to stock. The same call can also record the customer's number and a WhatsApp send.
        const input = await body(request); const current = bill.status || "completed"; const now = new Date().toISOString(); let changed = false;
        if (input.customerName !== undefined) { bill.customerName = optionalText(input.customerName, 80); changed = true; }
        if (input.customerPhone !== undefined) { bill.customerPhone = optionalText(input.customerPhone, 20); changed = true; }
        if (input.status !== undefined) {
          const allowed = { pending: ["completed", "cancelled"], completed: ["refunded"] }[current] || [];
          if (!BILL_STATUSES.includes(input.status)) return json(400, { error: "Invalid status" });
          if (!allowed.includes(input.status)) return json(409, { error: `A ${current} bill cannot be marked ${input.status}` });
          if (input.status === "completed") {
            bill.paidAt = now; bill.invoiceNumber = invoiceNumber(bill); bill.invoiceGeneratedAt = now;
            if (PAYMENT_METHODS.includes(input.paymentMethod) && input.paymentMethod !== "credit") bill.paymentMethod = input.paymentMethod;
          } else {
            const catalog = await readItems();
            for (const line of bill.lines) { const item = catalog.items.find((entry) => entry.id === line.itemId && mine(entry)); if (item) { item.quantity += line.quantity; item.updatedAt = now; } }
            await writeJson(ITEMS_FILE, catalog); bill[input.status === "cancelled" ? "cancelledAt" : "refundedAt"] = now;
          }
          bill.status = input.status; changed = true;
        }
        if (input.whatsappSent === true) {
          if ((bill.status || "completed") === "cancelled") return json(409, { error: "Cancelled bills have no invoice to send" });
          bill.whatsappSentAt = now; changed = true;
        }
        if (!changed) return json(400, { error: "Nothing to update" });
        bill.updatedAt = now; await writeJson(BILLS_FILE, data); return json(200, { bill: normalizeBill(bill) });
      }
    }
    return json(405, { error: "Method not allowed" });
  }
  const admin = auth(request);
  if (!admin && url.pathname.startsWith("/api/admin/")) return json(401, { error: "Admin authentication required" });
  if (url.pathname === "/api/admin/settings" && request.method === "GET") return json(200, { settings: adminSettingsView(await readSettings()) });
  if (url.pathname === "/api/admin/settings" && request.method === "PATCH") {
    const input = await body(request); const settings = await readSettings();
    if (input.platformName !== undefined) { if (!optionalText(input.platformName, 60)) return json(400, { error: "Platform name is required" }); settings.platformName = optionalText(input.platformName, 60); }
    if (input.supportEmail !== undefined) { const value = sanitizeEmail(input.supportEmail); if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return json(400, { error: "Enter a valid support email" }); settings.supportEmail = value; }
    if (input.supportPhone !== undefined) { const value = optionalText(input.supportPhone, 20); if (value && !/^\+?[0-9 ()-]{7,20}$/.test(value)) return json(400, { error: "Enter a valid support phone number" }); settings.supportPhone = value; }
    if (input.currency !== undefined) { const code = String(input.currency || "").trim().toUpperCase(); if (!validCurrency(code)) return json(400, { error: "Currency must be a valid 3-letter ISO code (e.g. INR)" }); settings.currency = code; }
    if (input.appUrl !== undefined) {
      const raw = String(input.appUrl || "").trim().replace(/\/+$/, "");
      if (raw) {
        let parsed; try { parsed = new URL(raw); } catch { return json(400, { error: "Enter a full address, e.g. https://pos.example.com" }); }
        if (!/^https?:$/.test(parsed.protocol)) return json(400, { error: "The address must start with http:// or https://" });
      }
      settings.appUrl = raw;
    }
    if (input.whatsappCountryCode !== undefined) { const code = String(input.whatsappCountryCode || "").replace(/\D/g, ""); if (!code || code.length > 4) return json(400, { error: "WhatsApp country code must be 1–4 digits" }); settings.whatsappCountryCode = code; }
    if (input.sessionHours !== undefined) { const hours = Number(input.sessionHours); if (!Number.isInteger(hours) || hours < 1 || hours > 720) return json(400, { error: "Session length must be 1–720 hours" }); settings.sessionHours = hours; }
    if (input.alerts && typeof input.alerts === "object") for (const key of Object.keys(PLATFORM_DEFAULTS.alerts)) if (input.alerts[key] !== undefined) settings.alerts[key] = Boolean(input.alerts[key]);
    settings.updatedAt = new Date().toISOString(); await writeSettings(settings);
    return json(200, { settings: adminSettingsView(settings), platform: publicPlatform(settings) });
  }
  const feedbackRoute = url.pathname.match(/^\/api\/admin\/feedback(?:\/([^/]+))?$/);
  if (feedbackRoute) {
    const data = await readFeedback();
    if (request.method === "GET" && !feedbackRoute[1]) return json(200, { feedback: data.feedback.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(feedbackView) });
    const item = feedbackRoute[1] && data.feedback.find((entry) => entry.id === decodeURIComponent(feedbackRoute[1]));
    if (!item) return json(404, { error: "Message not found" });
    if (request.method === "PATCH") {
      const input = await body(request); const now = new Date().toISOString();
      if (input.status === "seen") { item.seenAt = item.seenAt || now; item.resolvedAt = null; }
      else if (input.status === "resolved") { item.seenAt = item.seenAt || now; item.resolvedAt = now; }
      else if (input.status === "new") { item.seenAt = null; item.resolvedAt = null; }
      else return json(400, { error: "Unknown status" });
      await writeJson(FEEDBACK_FILE, data); return json(200, { item: feedbackView(item) });
    }
    if (request.method === "DELETE") { data.feedback.splice(data.feedback.indexOf(item), 1); await writeJson(FEEDBACK_FILE, data); return json(200, { message: "Message deleted" }); }
    return json(405, { error: "Method not allowed" });
  }
  const adminMessageRoute = url.pathname.match(/^\/api\/admin\/messages(?:\/([^/]+))?$/);
  if (adminMessageRoute) {
    const data = await readMessages(); const now = Date.now(); const store = await readStore();
    const canSee = (user) => user.status === "active"; // only signed-in-capable stores count as recipients
    const view = (message) => {
      const targets = store.users.filter((user) => canSee(user) && messageTargets(message, user.id));
      return { ...message, automatic: message.system === "plan-expiry", status: message.endedAt ? "ended" : Date.parse(message.expiresAt) <= now ? "expired" : "active", recipientCount: targets.length, recipientNames: message.recipients === "all" ? [] : store.users.filter((user) => message.recipients.includes(user.id)).map((user) => user.storeName || user.name), readCount: targets.filter((user) => message.readBy?.[user.id]).length };
    };
    if (request.method === "GET" && !adminMessageRoute[1]) return json(200, { messages: data.messages.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(view) });
    if (request.method === "POST" && !adminMessageRoute[1]) {
      const input = await body(request);
      const title = optionalText(input.title, 80); const text = optionalText(input.message, 500); const hours = Number(input.durationHours);
      if (!title) return json(400, { error: "Give the message a title" });
      if (!text) return json(400, { error: "Write the message" });
      if (!MESSAGE_LEVELS.includes(input.level)) return json(400, { error: "Unknown message type" });
      if (!Number.isFinite(hours) || hours < 1 || hours > 90 * 24) return json(400, { error: "Show the message for between 1 hour and 90 days" });
      let recipients = "all";
      if (input.recipients !== "all") {
        const ids = Array.isArray(input.recipients) ? [...new Set(input.recipients.map(String))].filter((id) => store.users.some((user) => user.id === id)) : [];
        if (!ids.length) return json(400, { error: "Pick at least one store, or send to all stores" });
        recipients = ids;
      }
      const message = { id: crypto.randomUUID(), title, message: text, level: input.level, recipients, createdAt: new Date(now).toISOString(), createdBy: admin.email, expiresAt: new Date(now + hours * 3600000).toISOString(), endedAt: null, readBy: {} };
      data.messages.push(message); await writeJson(MESSAGES_FILE, data); return json(201, { message: view(message) });
    }
    const message = adminMessageRoute[1] && data.messages.find((entry) => entry.id === decodeURIComponent(adminMessageRoute[1]));
    if (!message) return json(404, { error: "Message not found" });
    if (request.method === "PATCH") { const input = await body(request); if (input.end !== true) return json(400, { error: "Nothing to update" }); if (!message.endedAt) message.endedAt = new Date(now).toISOString(); await writeJson(MESSAGES_FILE, data); return json(200, { message: view(message) }); }
    if (request.method === "DELETE") { data.messages.splice(data.messages.indexOf(message), 1); await writeJson(MESSAGES_FILE, data); return json(200, { message: "Message deleted" }); }
    return json(405, { error: "Method not allowed" });
  }
  if (url.pathname === "/api/admin/password" && request.method === "POST") {
    const input = await body(request); const settings = await readSettings();
    if (!adminPasswordOk(input.currentPassword, settings)) return json(401, { error: "Current password is incorrect" });
    if (!input.newPassword || String(input.newPassword).length < 8) return json(400, { error: "New password must be at least 8 characters" });
    settings.adminPasswordHash = hash(String(input.newPassword)); settings.adminPasswordChangedAt = new Date().toISOString(); await writeSettings(settings);
    const token = bearerToken(request); for (const [key, session] of sessions) if (session.role === "admin" && key !== token) sessions.delete(key);
    return json(200, { message: "Password updated", settings: adminSettingsView(settings) });
  }
  const userRoute = url.pathname.match(/^\/api\/admin\/stores\/([^/]+)(?:\/reset-password)?$/);
  if (admin && userRoute && request.method === "GET") {
    const store = await readStore(); const user = store.users.find((item) => item.id === decodeURIComponent(userRoute[1]));
    return user ? json(200, { user: safeUser(user) }) : json(404, { error: "User not found" });
  }
  if (admin && userRoute && request.method === "PATCH") {
    const input = await body(request); const store = await readStore(); const user = store.users.find((item) => item.id === decodeURIComponent(userRoute[1]));
    if (!user) return json(404, { error: "User not found" });
    const email = sanitizeEmail(input.email || user.email);
    if (!validUserInput({ name: input.name || user.name, email, phone: input.phone || user.phone })) return json(400, { error: "Name, valid email, and phone number are required" });
    if (store.users.some((item) => item.id !== user.id && item.email === email)) return json(409, { error: "A user with this email already exists" });
    user.name = String(input.name || user.name).trim(); user.email = email; user.phone = String(input.phone || user.phone).trim();
    if (input.storeName !== undefined) user.storeName = optionalText(input.storeName, 80);
    if (input.businessType !== undefined) user.businessType = optionalText(input.businessType, 40);
    if (input.address !== undefined) user.address = optionalText(input.address, 160);
    if (USER_STATUSES.includes(input.status) && input.status !== user.status) { user.status = input.status; if (input.status === "archived") user.archivedAt = new Date().toISOString(); }
    // Suspended or archived retailers are signed out everywhere straight away.
    if (user.status === "suspended" || user.status === "archived") dropSessions(user.id);
    user.updatedAt = new Date().toISOString(); await writeStore(store);
    return json(200, { user: safeUser(user) });
  }
  if (admin && userRoute && request.method === "POST" && url.pathname.endsWith("/reset-password")) {
    const store = await readStore(); const user = store.users.find((item) => item.id === decodeURIComponent(userRoute[1]));
    if (!user) return json(404, { error: "User not found" });
    const temporaryPassword = temporaryPasswordValue(); user.passwordHash = hash(temporaryPassword); user.passwordResetRequired = true; user.passwordResetAt = new Date().toISOString(); await writeStore(store); const emailed = await sendResetPasswordEmail(user, temporaryPassword, publicPlatform(await readSettings()));
    return json(200, { message: emailed ? "Temporary password sent by email" : "SMTP is not configured; temporary password returned for local development", temporaryPassword: emailed ? undefined : temporaryPassword });
  }
  if (admin && userRoute && request.method === "DELETE") {
    const store = await readStore(); const userId = decodeURIComponent(userRoute[1]); const index = store.users.findIndex((item) => item.id === userId);
    if (index === -1) return json(404, { error: "User not found" });
    store.users.splice(index, 1); await writeStore(store); dropSessions(userId); return json(200, { message: "User deleted" });
  }
  if (request.method === "GET" && url.pathname === "/api/admin/stores") {
    if (!admin) return json(401, { error: "Admin authentication required" }); const store = await readStore();
    return json(200, { users: store.users.map(safeUser) });
  }
  if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
    if (!admin) return json(401, { error: "Admin authentication required" });
    const store = await readStore(); const now = Date.now();
    const users = { total: store.users.length, active: 0, suspended: 0, archived: 0 };
    for (const user of store.users) {
      if (user.status === "archived") users.archived++;
      else if (user.status === "suspended") users.suspended++;
      else if (user.status === "active") users.active++;
    }
    const signedIn = new Set(); let adminSessions = 0;
    for (const session of sessions.values()) { if (session.expiresAt < now) continue; if (session.role === "store") signedIn.add(session.userId); else adminSessions++; }
    // Every timestamp on a user record is an event the admin can see in the activity feed.
    const eventFields = { createdAt: "signed_up", updatedAt: "updated", passwordResetAt: "password_reset" };
    const events = store.users.flatMap((user) => Object.entries(eventFields).filter(([field]) => user[field]).map(([field, type]) => ({ type, at: user[field], userId: user.id, name: user.name })));
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    // Platform-wide order, revenue and stock figures ("today" / "this month" use the server's local clock).
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0); const monthStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
    const bills = (await readBills()).bills.map(normalizeBill); const items = (await readItems()).items;
    const orders = { total: 0, today: 0, month: 0, pending: 0, cancelled: 0, refunded: 0 }; const revenue = { total: 0, today: 0, month: 0, pending: 0 };
    for (const bill of bills) {
      if (bill.status === "cancelled" || bill.status === "refunded") { orders[bill.status]++; continue; }
      const at = Date.parse(bill.createdAt); orders.total++; revenue.total += bill.total;
      if (at >= dayStart) { orders.today++; revenue.today += bill.total; }
      if (at >= monthStart) { orders.month++; revenue.month += bill.total; }
      if (bill.status === "pending") { orders.pending++; revenue.pending += bill.total; }
    }
    for (const key of Object.keys(revenue)) revenue[key] = toMoney(revenue[key]);
    const inventory = { items: items.length, lowStock: 0, outOfStock: 0 };
    for (const item of items) { if (item.quantity === 0) inventory.outOfStock++; else if (item.quantity <= (item.lowStockThreshold ?? DEFAULT_LOW_STOCK)) inventory.lowStock++; }
    const recentRegistrations = store.users.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5).map(({ id, name, storeName, status, createdAt }) => ({ id, name, storeName: storeName || "", status, createdAt }));
    const feedbackItems = (await readFeedback()).feedback; const feedback = { total: feedbackItems.length, new: feedbackItems.filter((item) => feedbackStatus(item) === "new").length };
    return json(200, { now: new Date(now).toISOString(), feedback, users, sessions: { store: signedIn.size, admin: adminSessions }, orders, revenue, inventory, recentRegistrations, events: events.slice(0, 100) });
  }
  // ---- Public invoice: what the customer opens from the WhatsApp link ----
  // The store mints a share link for one of its own bills...
  const shareRoute = url.pathname.match(/^\/api\/store\/bills\/([^/]+)\/share$/);
  if (shareRoute && request.method === "POST") {
    const storeUser = await storeAuth(request); if (!storeUser) return json(401, { error: "Sign in to continue" });
    const data = await readBills();
    const bill = data.bills.find((item) => item.id === shareRoute[1] && item.storeId === storeUser.id);
    if (!bill) return json(404, { error: "Bill not found" });
    if (!bill.shareToken) { bill.shareToken = shareToken(); await writeJson(BILLS_FILE, data); }
    return json(200, { token: bill.shareToken, path: `/invoice/${bill.shareToken}` });
  }
  // ...and anyone holding that token can read it, without signing in. Only what belongs on
  // a receipt is returned: never the customer's phone number, never anything about the account.
  const publicInvoice = url.pathname.match(/^\/api\/invoice\/([A-Za-z0-9_-]{8,64})$/);
  if (publicInvoice && request.method === "GET") {
    const data = await readBills();
    const found = data.bills.find((item) => item.shareToken === publicInvoice[1]);
    if (!found) return json(404, { error: "This invoice link is not valid any more." });
    const bill = normalizeBill(found);
    const store = (await readStore()).users.find((user) => user.id === bill.storeId);
    if (!store || store.status !== "active") return json(404, { error: "This invoice link is not valid any more." });
    const settings = storeSettings(store);
    const showContact = settings.showContactOnInvoice !== false;
    const platform = publicPlatform(await readSettings());
    return json(200, {
      store: {
        name: store.storeName || store.name, owner: store.name,
        phone: showContact ? store.phone : "", address: showContact ? store.address || "" : "",
        businessType: store.businessType || "",
        legalName: settings.legalName || "", gstin: settings.gstin || "",
        placeOfSupply: settings.placeOfSupply || "", fssai: settings.fssai || "",
      },
      invoiceNote: settings.invoiceNote || "", terms: settings.terms || "",
      currency: platform.currency, platformName: platform.platformName,
      bill: {
        id: bill.id, number: bill.number, invoiceNumber: bill.invoiceNumber, status: bill.status,
        lines: bill.lines, itemCount: bill.itemCount, subtotal: bill.subtotal, discount: bill.discount,
        taxRate: bill.taxRate, taxLabel: bill.taxLabel, tax: bill.tax, total: bill.total,
        paymentMethod: bill.paymentMethod, customerName: bill.customerName,
        createdAt: bill.createdAt, paidAt: bill.paidAt, invoiceGeneratedAt: bill.invoiceGeneratedAt,
        cancelledAt: bill.cancelledAt, refundedAt: bill.refundedAt,
      },
    }, { "cache-control": "no-store" });
  }
  if (request.method === "GET" && url.pathname === "/api/apk") return json(200, await apkInfo());
  if (request.method === "GET" && url.pathname === APK_URL) return downloadApk();
  return null;
}
// The Android package is dropped into downloads/ by whoever builds it; the
// landing page asks /api/apk first so it never offers a download that 404s.
const APK_DIRS = [path.join(__dirname, "downloads"), path.join(__dirname, "apk")];
const APK_URL = "/download/ailexity-retail.apk";
// The newest .apk in either folder wins, so a new build can simply be dropped in
// next to the old one. Its version comes from apk.json beside it, or from the
// file name (Ailexity-1.0.1.apk -> 1.0.1).
async function findApk() {
  for (const dir of APK_DIRS) {
    let names;
    try { names = await fs.readdir(dir); } catch { continue; }
    const found = [];
    for (const name of names.filter((n) => n.toLowerCase().endsWith(".apk"))) {
      const file = path.join(dir, name);
      try { found.push({ dir, name, file, stat: await fs.stat(file) }); } catch {}
    }
    if (!found.length) continue;
    found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return found[0];
  }
  return null;
}
async function apkInfo() {
  const apk = await findApk();
  if (!apk) return { available: false, url: APK_URL };
  const meta = { ...await readJson(path.join(APK_DIRS[0], "apk.json"), {}), ...await readJson(path.join(apk.dir, "apk.json"), {}) };
  const fromName = (apk.name.match(/(\d+(?:\.\d+)+)/) || [])[1] || null;
  return { available: true, url: APK_URL, file: apk.name, size: apk.stat.size, updated: apk.stat.mtime.toISOString(), version: meta.version || fromName, minAndroid: meta.minAndroid || null, notes: meta.notes || null };
}
async function downloadApk() {
  const apk = await findApk();
  if (!apk) return json(404, { error: "The Android package has not been published on this server yet." });
  let content;
  try { content = await fs.readFile(apk.file); }
  catch { return json(404, { error: "The Android package has not been published on this server yet." }); }
  return { status: 200, body: content, headers: { "content-type": "application/vnd.android.package-archive", "content-disposition": `attachment; filename="${apk.name.replace(/[^\w.-]/g, "_")}"`, "content-length": String(content.length), "cache-control": "no-cache" } };
}
// "/" is the public landing page; the app (sign-in, then the store or platform workspace) lives at /login.
const STATIC_ALIASES = { "/": "/index.html", "/landing": "/index.html", "/download": "/index.html", "/login": "/login.html" };
// The Android app (com.ailexity.app 1.0.1) is a WebView that opens the site root, so after the landing page took "/" it would
// open the landing page. It hides the usual WebView markers ("; wv", "Version/x.y") to look like Chrome, but still names the
// device build ("Build/..."), which Chrome itself stopped sending years ago: that combination is sent on to the app. Remove
// this once the Android app is rebuilt to open /login.
const isOldAndroidApp = (ua = "") => /Android/.test(ua) && /\bBuild\//.test(ua) && !/; ?wv\b|Version\/\d|SamsungBrowser|MiuiBrowser|UCBrowser|OPR\/|EdgA\/|Firefox\/|FBAN|FBAV|Instagram|Line\//.test(ua);
// The app's folder also holds server code, .env, data/ and .git, so only the files named here
// (plus /assets/, which holds nothing but public images) may be fetched by URL. Everything else
// returns the same 404 as a missing file. A new client-side file must be added to this list.
const PUBLIC_FILES = new Set(["/index.html", "/login.html", "/invoice.html", "/styles.css", "/landing.css", "/invoice.css", "/app.js", "/landing.js", "/invoice-template.js", "/icon-192.png", "/icon-512.png", "/background1.jpeg", "/manifest.webmanifest"]);
const isPublicPath = (p) => PUBLIC_FILES.has(p) || (p.startsWith("/assets/") && /^[A-Za-z0-9/_.-]+$/.test(p) && !p.includes(".."));
async function serveStatic(request, response, url) {
  if ((url.pathname === "/" || url.pathname === "/index.html") && isOldAndroidApp(request.headers["user-agent"])) {
    response.writeHead(302, { location: `/login${url.search}`, "cache-control": "no-store", vary: "User-Agent" }); return response.end();
  }
  // /invoice/<token> is the customer-facing receipt; the page reads the token back out of the path.
  const requested = /^\/invoice\/[A-Za-z0-9_-]{8,64}$/.test(url.pathname) ? "/invoice.html" : STATIC_ALIASES[url.pathname] || url.pathname;
  if (!isPublicPath(requested)) return send(response, json(404, { error: "Not found" }));
  const filePath = path.resolve(__dirname, `.${requested}`);
  if (!filePath.startsWith(__dirname)) return send(response, json(404, { error: "Not found" }));
  try { const content = await fs.readFile(filePath); const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".apk": "application/vnd.android.package-archive" }; response.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" }); response.end(content); } catch { send(response, json(404, { error: "Not found" })); }
}
const server = http.createServer(async (request, response) => { try { const url = new URL(request.url, `http://${request.headers.host || "localhost"}`); const result = await route(request, url); if (result) return send(response, result); if (url.pathname.startsWith("/api/")) return send(response, json(404, { error: "API route not found" })); return serveStatic(request, response, url); } catch (error) { console.error(error); send(response, json(500, { error: error.message || "Internal server error" })); } });
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the existing Node server or run with PORT=3001 npm start.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
server.listen(PORT, HOST, () => { console.log(`Ailexity Retail running at http://localhost:${PORT} and http://<your-ip>:${PORT}`); });
