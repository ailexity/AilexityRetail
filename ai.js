// Store AI assistant: a plain-text snapshot of the store's performance (aiContext) and the call to a free LLM (askAi).
//
// Services (set any of them in .env; every one that is configured is tried, in AI_PROVIDERS order, until one answers):
//   GEMINI_API_KEY      Google Gemini — free key at https://aistudio.google.com/apikey
//   GROQ_API_KEY        Groq — free key at https://console.groq.com/keys
//   OPENROUTER_API_KEY  OpenRouter — free key at https://openrouter.ai/keys; its ":free" models and the openrouter/free router cost nothing
//   OLLAMA_URL          Ollama on your own PC or server (https://ollama.com) — no key, no quota, and the store's data never leaves the building
// Each service takes a comma-separated model list (GEMINI_MODEL, GROQ_MODEL, OPENROUTER_MODEL, OLLAMA_MODEL), tried in order.
// A model that is overloaded, rate-limited or gone is skipped for a while (COOLDOWN) so the next question does not wait on it again.
import { reportStats, dayKey, formatDay } from "./report.js";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PAYMENT_LABELS = { cash: "Cash", card: "Card", upi: "UPI", credit: "Pay later" };
const HISTORY_LIMIT = 20; // earlier turns of the conversation sent with each question
const REQUEST_TIMEOUT_MS = 30000; // one attempt
const DEADLINE_MS = 70000; // every attempt for one question, all services together
const COOLDOWN = { busy: 60000, gone: 10 * 60000, auth: 10 * 60000 };
const PROVIDER_ORDER = ["gemini", "groq", "openrouter", "ollama"];
// Gemini: the lite model answers in a couple of seconds and is rarely overloaded; the full model thinks for 15-20s but goes
// deeper, so it is the fallback. The "-latest" aliases follow the newest release and never go stale.
const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.5-flash, gemini-flash-latest",
  groq: "llama-3.3-70b-versatile, openai/gpt-oss-120b, llama-3.1-8b-instant",
  openrouter: "openrouter/free, google/gemma-4-31b-it:free, nvidia/nemotron-3-super-120b-a12b:free",
  ollama: "", // blank = whichever models are installed, in the order `ollama list` shows them
};
export const AI_NOT_SET_UP = "The AI assistant is not set up yet. Add a free GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY — or point OLLAMA_URL at an Ollama on this machine — in the server's .env file and restart.";

const configured = (name) => (name === "ollama" ? Boolean(process.env.OLLAMA_URL) : Boolean(process.env[`${name.toUpperCase()}_API_KEY`]));
// The services that have a key (or an address), in the order they will be asked: AI_PROVIDERS first, then the rest.
export function aiProviders() {
  const preferred = (process.env.AI_PROVIDERS || "").split(",").map((name) => name.trim().toLowerCase()).filter((name) => PROVIDER_ORDER.includes(name));
  return [...new Set([...preferred, ...PROVIDER_ORDER])].filter(configured);
}
export const aiProvider = () => aiProviders()[0] || null;
const modelList = (name) => (process.env[`${name.toUpperCase()}_MODEL`] || DEFAULT_MODELS[name]).split(",").map((model) => model.trim()).filter(Boolean);

// Local midnight (as a UTC timestamp) of the day `at` falls on, in the store's timezone (`tz` = getTimezoneOffset() minutes).
const localMidnight = (at, tz) => Math.floor((at - tz * 60000) / DAY_MS) * DAY_MS + tz * 60000;
const localMonthStart = (at, tz, monthsBack = 0) => { const d = new Date(at - tz * 60000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1) + tz * 60000; };

function periodLine(label, stats, money) {
  const parts = [`${stats.orders} orders`, `sales ${money(stats.sales)}`, `items sold ${stats.items}`, `avg order ${money(stats.averageOrder)}`];
  if (stats.discount) parts.push(`discounts ${money(stats.discount)}`);
  if (stats.tax) parts.push(`tax ${money(stats.tax)}`);
  if (stats.pendingCount) parts.push(`${stats.pendingCount} unpaid (${money(stats.pendingAmount)})`);
  if (stats.cancelledCount) parts.push(`${stats.cancelledCount} cancelled`);
  if (stats.refundedCount) parts.push(`${stats.refundedCount} refunded (${money(stats.refundedAmount)})`);
  return `- ${label}: ${parts.join(", ")}`;
}

// Everything the assistant knows about the store, computed fresh for every question.
export function aiContext({ store, settings, platform, bills, items, tz, now = Date.now() }) {
  const currency = platform.currency || "INR";
  const money = (value) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency }).format(value || 0);
  const today = localMidnight(now, tz); const tomorrow = today + DAY_MS;
  const weekStart = today - ((new Date(today - tz * 60000).getUTCDay() + 6) % 7) * DAY_MS; // Monday
  const monthStart = localMonthStart(now, tz); const lastMonthStart = localMonthStart(now, tz, 1);
  const stats = (from, to) => reportStats(bills, from, to, tz);
  const lines = [];

  lines.push(`STORE: ${store.storeName || store.name}${store.businessType ? ` (${store.businessType})` : ""}${store.address ? `, ${store.address}` : ""}. Owner: ${store.name}. Currency: ${currency}.`);
  lines.push(`Now: ${formatDay(now, tz)} (${WEEKDAYS[new Date(now - tz * 60000).getUTCDay()]}), local time ${new Date(now - tz * 60000).toISOString().slice(11, 16)}. Store has used the app since ${store.createdAt ? formatDay(store.createdAt, tz) : "unknown"}.`);
  lines.push(`Tax setting: ${settings.taxRate}% ${settings.taxLabel}. Bills counted in sales exclude cancelled and refunded orders; "unpaid" = pay-later bills not yet paid.`);

  lines.push("", "SALES SUMMARY");
  lines.push(periodLine("Today", stats(today, tomorrow), money));
  lines.push(periodLine("Yesterday", stats(today - DAY_MS, today), money));
  lines.push(periodLine("This week (Mon–today)", stats(weekStart, tomorrow), money));
  lines.push(periodLine("Last week", stats(weekStart - 7 * DAY_MS, weekStart), money));
  lines.push(periodLine("This month so far", stats(monthStart, tomorrow), money));
  lines.push(periodLine("Same days of last month", stats(lastMonthStart, Math.min(lastMonthStart + (tomorrow - monthStart), monthStart)), money));
  lines.push(periodLine("Last month (full)", stats(lastMonthStart, monthStart), money));
  const last30 = stats(today - 29 * DAY_MS, tomorrow);
  lines.push(periodLine("Last 30 days", last30, money));
  const firstBill = bills.reduce((min, bill) => Math.min(min, Date.parse(bill.createdAt)), now);
  const allTime = stats(localMidnight(firstBill, tz), tomorrow);
  lines.push(periodLine("All time", allTime, money));

  // Day-by-day table for the last 60 days (only days with sales, to keep the prompt short).
  const last60 = stats(today - 59 * DAY_MS, tomorrow);
  lines.push("", "DAILY SALES, LAST 60 DAYS (date | weekday | orders | items | sales | unpaid). Days not listed had no sales.");
  for (const day of last60.days.filter((entry) => entry.orders)) lines.push(`${day.key} | ${WEEKDAYS[new Date(day.at - tz * 60000).getUTCDay()].slice(0, 3)} | ${day.orders} | ${day.items} | ${money(day.sales)} | ${day.pending ? money(day.pending) : "-"}`);
  if (last60.bestDay) lines.push(`Best day in this window: ${last60.bestDay.key} with ${money(last60.bestDay.sales)}.`);

  // Monthly totals for the last 12 months.
  lines.push("", "MONTHLY SALES, LAST 12 MONTHS (month | orders | sales | avg order)");
  for (let back = 11; back >= 0; back--) {
    const from = localMonthStart(now, tz, back); const to = back ? localMonthStart(now, tz, back - 1) : tomorrow; const month = stats(from, to);
    lines.push(`${dayKey(from, tz).slice(0, 7)}${back ? "" : " (so far)"} | ${month.orders} | ${money(month.sales)} | ${money(month.averageOrder)}`);
  }

  // Weekday and hour-of-day patterns over the last 90 days.
  const recent = bills.filter((bill) => { const at = Date.parse(bill.createdAt); return at >= today - 89 * DAY_MS && bill.status !== "cancelled" && bill.status !== "refunded"; });
  const byWeekday = WEEKDAYS.map((name) => ({ name, orders: 0, sales: 0 })); const byHour = Array.from({ length: 24 }, () => ({ orders: 0, sales: 0 }));
  for (const bill of recent) { const local = new Date(Date.parse(bill.createdAt) - tz * 60000); const w = byWeekday[local.getUTCDay()]; const h = byHour[local.getUTCHours()]; w.orders++; w.sales += bill.total; h.orders++; h.sales += bill.total; }
  lines.push("", "PATTERNS, LAST 90 DAYS");
  lines.push(`By weekday: ${byWeekday.map((w) => `${w.name.slice(0, 3)} ${w.orders} orders / ${money(w.sales)}`).join("; ")}`);
  lines.push(`By hour: ${byHour.map((h, hour) => (h.orders ? `${String(hour).padStart(2, "0")}:00 ${h.orders} orders / ${money(h.sales)}` : null)).filter(Boolean).join("; ") || "no sales"}`);

  const methodLine = (s) => s.byMethod.map((m) => `${PAYMENT_LABELS[m.method] || m.method} ${m.orders} orders / ${money(m.amount)}`).join("; ") || "none";
  lines.push(`Payment methods, last 30 days: ${methodLine(last30)}`);
  lines.push(`Payment methods, all time: ${methodLine(allTime)}`);

  // Best sellers: today, last 30 days and all time (by quantity), plus the slowest movers in stock.
  const sold = new Map();
  for (const bill of bills) if (bill.status !== "cancelled" && bill.status !== "refunded") for (const line of bill.lines || []) { const entry = sold.get(line.name) || { quantity: 0, amount: 0, last: 0 }; entry.quantity += line.quantity; entry.amount += line.total; entry.last = Math.max(entry.last, Date.parse(bill.createdAt)); sold.set(line.name, entry); }
  const itemLine = (list) => list.map((item) => `${item.name} ×${item.quantity} (${money(item.amount)})`).join("; ") || "none";
  lines.push("", "PRODUCTS");
  lines.push(`Top sellers today: ${itemLine(stats(today, tomorrow).topItems)}`);
  lines.push(`Top sellers this week: ${itemLine(stats(weekStart, tomorrow).topItems)}`);
  lines.push(`Top sellers last 30 days: ${itemLine(last30.topItems)}`);
  lines.push(`Top sellers all time: ${itemLine(allTime.topItems)}`);
  const unsold30 = items.filter((item) => { const entry = sold.get(item.name); return !entry || entry.last < today - 29 * DAY_MS; });
  lines.push(`In catalog but not sold in the last 30 days: ${unsold30.map((item) => `${item.name} (stock ${item.quantity})`).join("; ") || "none"}`);

  // Inventory.
  const out = items.filter((item) => item.quantity <= 0); const low = items.filter((item) => item.quantity > 0 && item.quantity <= (item.lowStockThreshold ?? settings.lowStockDefault));
  const stockValue = items.reduce((total, item) => total + item.price * Math.max(0, item.quantity), 0);
  lines.push("", `INVENTORY: ${items.length} items in catalog, ${out.length} out of stock, ${low.length} low on stock, stock value at selling price ${money(stockValue)}.`);
  lines.push("Catalog (name | category | price | in stock | low-stock level | sold last 30 days):");
  const sold30 = new Map();
  for (const bill of last30.bills) if (bill.status !== "cancelled" && bill.status !== "refunded") for (const line of bill.lines || []) sold30.set(line.name, (sold30.get(line.name) || 0) + line.quantity);
  for (const item of items.slice(0, 300)) lines.push(`${item.name} | ${item.category || "-"} | ${money(item.price)} | ${item.quantity} | ${item.lowStockThreshold ?? settings.lowStockDefault} | ${sold30.get(item.name) || 0}`);
  if (items.length > 300) lines.push(`…and ${items.length - 300} more items not listed.`);

  // Money still owed.
  const unpaid = bills.filter((bill) => bill.status === "pending").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  lines.push("", `UNPAID BILLS (pay later): ${unpaid.length}, total ${money(unpaid.reduce((total, bill) => total + bill.total, 0))}`);
  for (const bill of unpaid.slice(0, 30)) lines.push(`- Bill #${bill.number} on ${dayKey(bill.createdAt, tz)}: ${money(bill.total)}${bill.customerName ? `, customer ${bill.customerName}` : ""}${bill.customerPhone ? ` (${bill.customerPhone})` : ""}`);

  // Customers.
  const customers = new Map();
  for (const bill of bills) if (bill.customerName && bill.status !== "cancelled" && bill.status !== "refunded") { const key = bill.customerPhone || bill.customerName; const entry = customers.get(key) || { name: bill.customerName, orders: 0, amount: 0 }; entry.orders++; entry.amount += bill.total; customers.set(key, entry); }
  const topCustomers = [...customers.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
  lines.push("", `TOP CUSTOMERS (named on bills): ${topCustomers.map((c) => `${c.name} ${c.orders} orders / ${money(c.amount)}`).join("; ") || "no customer names recorded"}`);

  // The latest orders, for "what was my last sale" style questions.
  const latest = [...bills].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 15);
  lines.push("", "LATEST 15 ORDERS (bill | local date time | status | payment | total | items)");
  for (const bill of latest) lines.push(`#${bill.number} | ${new Date(Date.parse(bill.createdAt) - tz * 60000).toISOString().slice(0, 16).replace("T", " ")} | ${bill.status} | ${PAYMENT_LABELS[bill.paymentMethod] || bill.paymentMethod} | ${money(bill.total)} | ${(bill.lines || []).map((line) => `${line.name}×${line.quantity}`).join(", ")}`);

  return lines.join("\n");
}

const systemPrompt = (context, platformName) => `You are RET.ai, Ailexity's retail AI — the business assistant built into ${platformName}, a point-of-sale app used by a small retail store. You talk with the store owner about their daily sales, revenue, products, stock and customers. If asked who you are, you are RET.ai by Ailexity.

Rules:
- Base every number on the STORE DATA below. Never invent figures; if the data cannot answer the question, say so and suggest what the owner could track.
- Do the arithmetic yourself (growth %, differences, averages, projections) and show key numbers in the store's currency.
- Be concise and practical: lead with the answer, then a few bullet points of supporting numbers, then 1–3 concrete suggestions when useful.
- Use simple Markdown only: **bold**, bullet lists ("- "), numbered lists, and short "### " headings. No tables, no code blocks.
- Reply in the language the owner writes in.
- If asked about something unrelated to running the store, answer briefly and steer back to the business.

STORE DATA (computed just now):
${context}`;

// ---- Calling the services ----
// Every failure is an AiError with a `kind` that decides what happens next:
//   busy    overloaded, rate-limited, timed out, unreachable or an empty answer → this model rests for a minute, try the next one
//   gone    the model name is unknown or retired → rests for ten minutes
//   auth    the key was rejected → the whole service rests for ten minutes
//   bad     the request itself was refused (wrong parameters, prompt too long) → skip the rest of this service
//   blocked a safety filter refused the question → try the next model; if nobody answers, tell the owner so
class AiError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }
const describe = (detail) => (typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 200);
function classify(status, detail) {
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(detail))) return "auth"; // Gemini says 400 to a bad key
  if (status === 404) return "gone";
  if (status === 400 && /model|decommission|not found|not supported|does not exist|unknown/i.test(detail)) return "gone";
  if (status === 400 || status === 413 || status === 422) return "bad";
  return "busy"; // 429 and every 5xx, including Gemini's "experiencing high demand"
}
async function postJson(url, headers, payload, timeoutMs) {
  let response;
  try { response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new AiError("busy", error.name === "TimeoutError" ? `no answer within ${Math.round(timeoutMs / 1000)}s` : `unreachable (${error.cause?.code || error.message})`); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = describe(result.error?.message || result.error || response.statusText || `HTTP ${response.status}`);
    throw new AiError(classify(response.status, detail), `HTTP ${response.status}: ${detail}`);
  }
  return result;
}
const toOpenAiMessages = (system, turns) => [{ role: "system", content: system }, ...turns.map((turn) => ({ role: turn.role === "assistant" ? "assistant" : "user", content: turn.text }))];
// Some open models think out loud inside <think> tags before answering; the owner only wants the answer.
const stripThinking = (text) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

async function callGemini(model, system, turns, timeoutMs) {
  const result = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": process.env.GEMINI_API_KEY }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.text }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }, // thinking models count their reasoning against this limit
  }, timeoutMs);
  const candidate = result.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join("").trim();
  if (text) return text;
  if (result.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY" || candidate?.finishReason === "PROHIBITED_CONTENT") throw new AiError("blocked", `blocked (${result.promptFeedback?.blockReason || candidate?.finishReason})`);
  throw new AiError("busy", `empty answer (${candidate?.finishReason || "no candidate"})`);
}
async function callOpenAiCompatible(url, key, extraHeaders, model, system, turns, timeoutMs) {
  const result = await postJson(url, { authorization: `Bearer ${key}`, ...extraHeaders }, { model, temperature: 0.4, max_tokens: 2048, messages: toOpenAiMessages(system, turns) }, timeoutMs);
  const choice = result.choices?.[0]; const text = stripThinking(choice?.message?.content || "");
  if (text) return text;
  if (choice?.finish_reason === "content_filter") throw new AiError("blocked", "blocked (content filter)");
  throw new AiError("busy", `empty answer (${choice?.finish_reason || "no choice"})`);
}
const callGroq = (model, system, turns, timeoutMs) => callOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, {}, model, system, turns, timeoutMs);
const callOpenRouter = (model, system, turns, timeoutMs) => callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, { "x-title": "Ailexity Retail" }, model, system, turns, timeoutMs);

const ollamaBase = () => String(process.env.OLLAMA_URL || "").replace(/\/+$/, "");
let ollamaInstalled = null; // { list, until } — what `ollama list` shows, re-read every minute
async function ollamaModels() {
  const chosen = modelList("ollama"); if (chosen.length) return chosen;
  if (ollamaInstalled && ollamaInstalled.until > Date.now()) return ollamaInstalled.list;
  let response;
  try { response = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(5000) }); }
  catch (error) { throw new AiError("busy", `Ollama unreachable at ${ollamaBase()} (${error.cause?.code || error.message})`); }
  const list = ((await response.json().catch(() => ({}))).models || []).map((entry) => entry.name).filter((name) => !/embed/i.test(name));
  if (!list.length) throw new AiError("gone", `no models installed in Ollama — run \`ollama pull <model>\` first`);
  ollamaInstalled = { list, until: Date.now() + 60000 };
  return list;
}
async function callOllama(model, system, turns, timeoutMs) {
  // num_ctx: Ollama's default context is small enough to silently cut the store data off; this fits the whole snapshot.
  const result = await postJson(`${ollamaBase()}/api/chat`, {}, { model, stream: false, options: { temperature: 0.4, num_ctx: 16384 }, messages: toOpenAiMessages(system, turns) }, timeoutMs);
  const text = stripThinking(result.message?.content || "");
  if (text) return text;
  throw new AiError("busy", `empty answer (${result.done_reason || "no message"})`);
}
const CALLS = { gemini: callGemini, groq: callGroq, openrouter: callOpenRouter, ollama: callOllama };
const modelsFor = (provider) => (provider === "ollama" ? ollamaModels() : Promise.resolve(modelList(provider)));

// Models (and services) resting after a failure, keyed "service" or "service/model" → when they may be tried again.
const resting = new Map();
const isResting = (key) => (resting.get(key) || 0) > Date.now();
const rest = (key, ms) => resting.set(key, Date.now() + ms);

// `history` is the conversation so far ([{ role: "user" | "assistant", text }]), ending with the new question.
// Resolves to { text, via } where `via` names the service and model that answered ("gemini/gemini-3.5-flash").
export async function askAi({ context, history, platformName }) {
  const providers = aiProviders();
  if (!providers.length) throw Object.assign(new Error(AI_NOT_SET_UP), { status: 503 });
  const system = systemPrompt(context, platformName); const turns = history.slice(-HISTORY_LIMIT);
  const started = Date.now(); const failures = []; const kinds = new Set();
  providers: for (const provider of providers) {
    if (isResting(provider)) { failures.push(`${provider}: resting after a rejected key`); continue; }
    let models;
    try { models = await modelsFor(provider); }
    catch (error) { failures.push(`${provider}: ${error.message}`); kinds.add(error.kind || "busy"); continue; }
    for (const model of models) {
      const key = `${provider}/${model}`;
      if (isResting(key)) { failures.push(`${key}: resting`); continue; }
      const remaining = DEADLINE_MS - (Date.now() - started);
      if (remaining < 3000) { failures.push("out of time"); break providers; }
      try { return { text: await CALLS[provider](model, system, turns, Math.min(REQUEST_TIMEOUT_MS, remaining)), via: key }; }
      catch (error) {
        const kind = error instanceof AiError ? error.kind : "busy";
        failures.push(`${key}: ${error.message}`); kinds.add(kind);
        if (kind === "auth") { rest(provider, COOLDOWN.auth); continue providers; }
        if (kind === "bad") continue providers;
        if (kind !== "blocked") rest(key, kind === "gone" ? COOLDOWN.gone : COOLDOWN.busy);
      }
    }
  }
  const message = kinds.has("busy") || kinds.has("gone") ? "Every AI service is busy right now — please try again in a minute."
    : kinds.has("blocked") ? "The AI declined to answer that question."
    : kinds.has("auth") ? "The AI service rejected the server's API key — check the key in the server's .env file."
    : `The AI could not answer: ${failures.at(-1) || "unknown error"}`;
  throw Object.assign(new Error(message), { status: kinds.has("blocked") && kinds.size === 1 ? 422 : 503, detail: failures.join(" | ") });
}
