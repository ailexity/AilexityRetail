// Sales performance report for a store over a date range: the numbers (reportStats) and the PDF layout (salesReportPdf).
import { PdfDocument, PAGE } from "./pdf.js";

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PAYMENT_LABELS = { cash: "Cash", card: "Card", upi: "UPI", credit: "Pay later" };
const STATUS_LABELS = { completed: "Completed", pending: "Pending", cancelled: "Cancelled", refunded: "Refunded" };
const money2 = (value) => Math.round(value * 100) / 100;

// The store's local clock: `tz` is the browser's getTimezoneOffset() (minutes, positive west of UTC).
const localDate = (isoOrMs, tz) => new Date((typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs)) - tz * 60000);
export const dayKey = (isoOrMs, tz) => localDate(isoOrMs, tz).toISOString().slice(0, 10);
export const formatDay = (isoOrMs, tz, { weekday = true } = {}) => { const d = localDate(isoOrMs, tz); return `${weekday ? `${WEEKDAYS[d.getUTCDay()]}, ` : ""}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const formatTime = (iso, tz) => { const d = localDate(iso, tz); const h = d.getUTCHours(); return `${String(h % 12 || 12).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

// Currency symbols the built-in PDF fonts can show; everything else is written as a code ("INR 1,23,456.00" → "Rs. …").
const PDF_SYMBOLS = { USD: "$", CAD: "$", AUD: "$", SGD: "$", EUR: "€", GBP: "£", JPY: "¥", INR: "Rs. " };
export function pdfMoney(value, currency = "INR") {
  const formatted = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", { style: "currency", currency, currencyDisplay: "code" }).format(value || 0);
  const symbol = PDF_SYMBOLS[currency];
  return symbol ? formatted.replace(`${currency} `, symbol) : formatted.replace(/ /g, " ");
}

// Everything the report shows, computed once from the bills that fall inside [from, to).
export function reportStats(bills, from, to, tz) {
  const inRange = bills.filter((bill) => { const at = Date.parse(bill.createdAt); return at >= from && at < to; }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const live = inRange.filter((bill) => bill.status !== "cancelled" && bill.status !== "refunded");
  const sum = (list, pick = (bill) => bill.total) => money2(list.reduce((total, bill) => total + (pick(bill) || 0), 0));
  const pending = live.filter((bill) => bill.status === "pending");
  const refunded = inRange.filter((bill) => bill.status === "refunded");
  const cancelled = inRange.filter((bill) => bill.status === "cancelled");
  const byMethod = {};
  for (const bill of live) { const entry = byMethod[bill.paymentMethod] || (byMethod[bill.paymentMethod] = { method: bill.paymentMethod, orders: 0, amount: 0 }); entry.orders++; entry.amount = money2(entry.amount + bill.total); }
  const byDay = new Map();
  for (let at = from; at < to; at += DAY_MS) byDay.set(dayKey(at, tz), { key: dayKey(at, tz), at, orders: 0, items: 0, sales: 0, pending: 0 });
  for (const bill of live) { const day = byDay.get(dayKey(bill.createdAt, tz)); if (!day) continue; day.orders++; day.items += bill.itemCount; day.sales = money2(day.sales + bill.total); if (bill.status === "pending") day.pending = money2(day.pending + bill.total); }
  const items = new Map();
  for (const bill of live) for (const line of bill.lines) { const entry = items.get(line.name) || { name: line.name, quantity: 0, amount: 0 }; entry.quantity += line.quantity; entry.amount = money2(entry.amount + line.total); items.set(line.name, entry); }
  const days = [...byDay.values()];
  const bestDay = days.reduce((best, day) => (day.sales > (best?.sales || 0) ? day : best), null);
  return {
    from, to, tz, dayCount: Math.round((to - from) / DAY_MS),
    orders: live.length, sales: sum(live), items: live.reduce((total, bill) => total + bill.itemCount, 0),
    averageOrder: live.length ? money2(sum(live) / live.length) : 0,
    tax: sum(live, (bill) => bill.tax), discount: sum(live, (bill) => bill.discount),
    pendingCount: pending.length, pendingAmount: sum(pending),
    cancelledCount: cancelled.length, refundedCount: refunded.length, refundedAmount: sum(refunded),
    byMethod: Object.values(byMethod).sort((a, b) => b.amount - a.amount),
    days, bestDay: bestDay && bestDay.sales > 0 ? bestDay : null,
    topItems: [...items.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount).slice(0, 10),
    bills: inRange,
  };
}

// ---- Layout ----
const MARGIN = 40; const TOP = PAGE.height - MARGIN; const BOTTOM = 56; const WIDTH = PAGE.width - MARGIN * 2;
const GRAY = "#777777"; const DARK = "#171717"; const RULE = "#e3e2de"; const FILL = "#f5f4f1";

class Flow {
  constructor(doc) { this.doc = doc; this.y = TOP; }
  ensure(height) { if (this.y - height < BOTTOM) { this.doc.newPage(); this.y = TOP; return true; } return false; }
  heading(text) { this.ensure(70); this.y -= 18; this.doc.text(MARGIN, this.y, text, { size: 11, bold: true }); this.y -= 6; this.doc.line(MARGIN, this.y, MARGIN + WIDTH, this.y, { color: DARK, width: 0.8 }); this.y -= 8; }
  note(text) { for (const line of PdfDocument.wrap(text, 8.5, false, WIDTH)) { this.ensure(12); this.y -= 11; this.doc.text(MARGIN, this.y, line, { size: 8.5, color: GRAY }); } }
  // columns: [{ label, width, align }] — widths in points; rows: arrays of cell strings; sub: optional wrapped line under a row.
  // Headings and table headers reserve room for at least one row so they never sit alone at the foot of a page.
  table(columns, rows, { rowHeight = 15, sub } = {}) {
    const xs = []; let x = MARGIN; for (const column of columns) { xs.push(x); x += column.width; }
    const cell = (column, index, text, y, bold, color) => this.doc.text(column.align === "right" ? xs[index] + column.width - 4 : xs[index] + 4, y, text, { size: 8.5, bold, color, align: column.align || "left", maxWidth: column.width - 8 });
    const header = () => { this.ensure(rowHeight * 2 + 8); this.y -= rowHeight; this.doc.rect(MARGIN, this.y - 4, WIDTH, rowHeight, { fill: FILL }); columns.forEach((column, index) => cell(column, index, column.label, this.y, true, GRAY)); this.y -= 4; };
    header();
    if (!rows.length) { this.y -= rowHeight; this.doc.text(MARGIN + 4, this.y, "Nothing in this period.", { size: 8.5, color: GRAY }); this.y -= 4; return; }
    rows.forEach((row, rowIndex) => {
      const extra = sub ? PdfDocument.wrap(sub(rowIndex), 7.5, false, WIDTH - 8) : [];
      if (this.ensure(rowHeight + extra.length * 10 + 4)) header();
      this.y -= rowHeight;
      columns.forEach((column, index) => cell(column, index, row[index], this.y, row.bold, row.color));
      for (const line of extra) { this.y -= 10; this.doc.text(MARGIN + 4, this.y, line, { size: 7.5, color: GRAY }); }
      this.y -= 4; this.doc.line(MARGIN, this.y, MARGIN + WIDTH, this.y, { color: RULE, width: 0.5 });
    });
  }
  tiles(entries, perRow = 3) {
    const gap = 8; const width = (WIDTH - gap * (perRow - 1)) / perRow; const height = 44;
    for (let start = 0; start < entries.length; start += perRow) {
      this.ensure(height + gap); this.y -= height;
      entries.slice(start, start + perRow).forEach(([label, value], index) => {
        const x = MARGIN + index * (width + gap);
        this.doc.rect(x, this.y, width, height, { fill: FILL });
        this.doc.text(x + 10, this.y + height - 15, label.toUpperCase(), { size: 7, color: GRAY });
        this.doc.text(x + 10, this.y + 11, value, { size: 13, bold: true, maxWidth: width - 20 });
      });
      this.y -= gap;
    }
  }
}

export function salesReportPdf({ store, platform, stats, label, includeOrders, generatedAt = Date.now() }) {
  const { tz } = stats; const currency = platform.currency; const money = (value) => pdfMoney(value, currency);
  const doc = new PdfDocument(); const flow = new Flow(doc);
  const period = stats.dayCount === 1 ? formatDay(stats.from, tz) : `${formatDay(stats.from, tz, { weekday: false })} – ${formatDay(stats.to - 1, tz, { weekday: false })}`;

  // Header: store on the left, report title and period on the right.
  doc.text(MARGIN, TOP - 14, store.storeName || store.name, { size: 16, bold: true, maxWidth: WIDTH * 0.6 });
  const contact = [store.address, store.phone && `Phone: ${store.phone}`, store.email].filter(Boolean).join("  ·  ");
  if (contact) doc.text(MARGIN, TOP - 28, contact, { size: 8.5, color: GRAY, maxWidth: WIDTH * 0.6 });
  doc.text(MARGIN + WIDTH, TOP - 14, "Sales performance report", { size: 11, bold: true, align: "right" });
  doc.text(MARGIN + WIDTH, TOP - 28, label ? `${label} · ${period}` : period, { size: 9, align: "right" });
  doc.text(MARGIN + WIDTH, TOP - 40, `Generated ${formatDay(generatedAt, tz)} ${formatTime(new Date(generatedAt).toISOString(), tz)}`, { size: 7.5, color: GRAY, align: "right" });
  flow.y = TOP - 50; doc.line(MARGIN, flow.y, MARGIN + WIDTH, flow.y, { color: DARK, width: 0.8 }); flow.y -= 4;

  flow.tiles([
    ["Sales", money(stats.sales)], ["Orders", String(stats.orders)], ["Avg. order value", money(stats.averageOrder)],
    ["Items sold", String(stats.items)], [`Tax collected`, money(stats.tax)], ["Discounts given", money(stats.discount)],
    ["Pending payments", `${money(stats.pendingAmount)} (${stats.pendingCount})`], ["Cancelled orders", String(stats.cancelledCount)], ["Refunded", `${money(stats.refundedAmount)} (${stats.refundedCount})`],
  ]);
  flow.note(stats.bestDay ? `Best day: ${formatDay(stats.bestDay.at, tz)} with ${money(stats.bestDay.sales)} from ${stats.bestDay.orders} order${stats.bestDay.orders === 1 ? "" : "s"}. Sales exclude cancelled and refunded orders; pending (pay-later) orders are counted as sales until they are cancelled.` : "No sales in this period. Sales exclude cancelled and refunded orders.");

  flow.heading("Payment methods");
  flow.table([{ label: "Method", width: 255 }, { label: "Orders", width: 100, align: "right" }, { label: "Amount", width: 160, align: "right" }],
    stats.byMethod.map((entry) => [PAYMENT_LABELS[entry.method] || entry.method, String(entry.orders), money(entry.amount)]));

  flow.heading("Day by day");
  const skipEmpty = stats.dayCount > 31; const dayRows = stats.days.filter((day) => !skipEmpty || day.orders);
  flow.table([{ label: "Date", width: 175 }, { label: "Orders", width: 70, align: "right" }, { label: "Items", width: 70, align: "right" }, { label: "Pending", width: 100, align: "right" }, { label: "Sales", width: 100, align: "right" }],
    dayRows.map((day) => Object.assign([formatDay(day.at, tz), String(day.orders), String(day.items), day.pending ? money(day.pending) : "–", day.orders ? money(day.sales) : "–"], { bold: stats.bestDay?.key === day.key })));
  if (skipEmpty) flow.note("Days without orders are left out for periods longer than a month.");

  flow.heading("Top items");
  flow.table([{ label: "Item", width: 295 }, { label: "Quantity", width: 100, align: "right" }, { label: "Sales", width: 120, align: "right" }],
    stats.topItems.map((item) => [item.name, String(item.quantity), money(item.amount)]));

  if (includeOrders) {
    flow.heading(`All orders (${stats.bills.length})`);
    flow.table([{ label: "Order", width: 70 }, { label: "Date & time", width: 120 }, { label: "Customer", width: 95 }, { label: "Items", width: 45, align: "right" }, { label: "Payment", width: 60 }, { label: "Status", width: 60 }, { label: "Total", width: 65, align: "right" }],
      stats.bills.map((bill) => Object.assign([bill.invoiceNumber || `#${String(bill.number).padStart(4, "0")}`, `${formatDay(bill.createdAt, tz, { weekday: false })} ${formatTime(bill.createdAt, tz)}`, bill.customerName || bill.customerPhone || "Walk-in", String(bill.itemCount), PAYMENT_LABELS[bill.paymentMethod] || bill.paymentMethod, STATUS_LABELS[bill.status] || bill.status, money(bill.total)], { color: bill.status === "cancelled" || bill.status === "refunded" ? GRAY : DARK })),
      { sub: (index) => { const bill = stats.bills[index]; const parts = bill.lines.map((line) => `${line.quantity} × ${line.name}`); if (bill.discount) parts.push(`discount ${money(bill.discount)}`); if (bill.tax) parts.push(`${bill.taxLabel || "tax"} ${money(bill.tax)}`); return parts.join(", "); } });
  }

  doc.eachPage((page, total) => {
    doc.line(MARGIN, BOTTOM - 14, MARGIN + WIDTH, BOTTOM - 14, { color: RULE, width: 0.5 });
    doc.text(MARGIN, BOTTOM - 26, `${platform.platformName || "Ailexity Retail"} · ${store.storeName || store.name}`, { size: 7.5, color: GRAY });
    doc.text(MARGIN + WIDTH, BOTTOM - 26, `Page ${page} of ${total}`, { size: 7.5, color: GRAY, align: "right" });
  });
  return doc.render();
}
