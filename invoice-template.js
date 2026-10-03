// The invoice receipt, in one place: the store's own "View invoice" sheet and the public page a
// customer opens from WhatsApp both render this. Plain script, no module system, no build step —
// it hangs one function off `window`, exactly like the rest of the front end.
//
// Input shape (the public API returns it verbatim):
//   { store: { name, owner, phone, address, businessType, legalName, gstin, placeOfSupply, fssai },
//     invoiceNote, terms, currency, platformName,
//     bill: { invoiceNumber, number, status, lines[{ name, sku, price, quantity, total }],
//             itemCount, subtotal, discount, taxRate, taxLabel, tax, total, paymentMethod,
//             customerName, createdAt, paidAt, cancelledAt, refundedAt } }
//
// Everything in `store` beyond the name is optional: a store that has not filled in its GSTIN or
// place of supply gets a receipt without those rows rather than an empty label.

(function (global) {
  "use strict";

  const PAYMENT_LABELS = { cash: "CASH", card: "CARD", upi: "UPI", credit: "PAY LATER" };
  const STATUS_WORD = { completed: "PAID", pending: "UNPAID", cancelled: "CANCELLED", refunded: "REFUNDED" };
  const DEFAULT_TERMS = [
    "Goods once sold are taken back or exchanged only as per store policy, within the stated period and with this invoice.",
    "Please check the goods and this invoice before leaving the counter; claims afterwards may not be accepted.",
    "This invoice must be produced for any exchange, warranty claim or return.",
    "All disputes are subject to the jurisdiction of the courts where this store is situated.",
  ];
  const STATUS_NOTE = {
    pending: "PAYMENT PENDING — this bill is not paid yet",
    cancelled: "CANCELLED — this bill was voided",
    refunded: "REFUNDED — this sale was returned",
  };

  const escapeHtml = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function money(value, currency) {
    const amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "INR", minimumFractionDigits: 2 }).format(amount);
    } catch {
      return amount.toFixed(2);
    }
  }
  // Bare numbers for the table columns — the currency symbol sits in the totals only, as on a real till slip.
  const plain = (value) => (Number(value) || 0).toFixed(2);

  // Indian-format amount in words — standard on a tax invoice, and the one thing a customer
  // can check a printed figure against.
  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function underHundred(n) {
    if (n < 20) return ONES[n];
    return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
  }
  function indianWords(n) {
    if (n === 0) return "Zero";
    const parts = [];
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    const hundred = Math.floor(n / 100); n %= 100;
    if (crore) parts.push(`${indianWords(crore)} Crore`);
    if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
    if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
    if (hundred) parts.push(`${ONES[hundred]} Hundred`);
    if (n) parts.push(underHundred(n));
    return parts.join(" ");
  }
  function amountInWords(value, currency) {
    const total = Math.round((Number(value) || 0) * 100);
    const major = Math.floor(total / 100);
    const minor = total % 100;
    const names = { INR: ["Rupees", "Paise"], USD: ["Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds", "Pence"] };
    const [big, small] = names[currency] || [currency || "", ""];
    const head = `${big} ${indianWords(major)}`.trim();
    const tail = minor ? ` and ${small} ${underHundred(minor)}`.trimEnd() : "";
    return `${head}${tail} Only`;
  }

  function stamp(date) {
    const at = new Date(date);
    if (isNaN(at)) return "";
    const d = String(at.getDate()).padStart(2, "0");
    const m = String(at.getMonth() + 1).padStart(2, "0");
    const y = at.getFullYear();
    const hh = String(at.getHours()).padStart(2, "0");
    const mm = String(at.getMinutes()).padStart(2, "0");
    return `${d}/${m}/${y} ${hh}:${mm}`;
  }

  /* ---------------- Code 128-B barcode, drawn as SVG ----------------
     Real encoding, so the invoice number actually scans. Code set B covers
     the ASCII range invoice numbers use (digits, letters, the hyphen). */
  const CODE128_PATTERNS = [
    "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100",
    "10001100100", "11001001000", "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100",
    "10011101100", "10011100110", "11001110010", "11001011100", "11001001110", "11011100100", "11001110100", "11101101110",
    "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010", "11011011000", "11011000110",
    "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
    "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110",
    "11101110110", "11010001110", "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110",
    "11100010110", "11101101000", "11101100010", "11100011010", "11101111010", "11001000010", "11110001010", "10100110000",
    "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000", "10110000100", "10011010000",
    "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
    "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100",
    "11110010010", "11011011110", "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000",
    "10111100010", "11110101000", "11110100010", "10111011110", "10111101110", "11101011110", "11110101110", "11010000100",
    "11010010000", "11010011100", "1100011101011",
  ];

  function barcodeSvg(text, options) {
    const value = String(text || "").replace(/[^\x20-\x7e]/g, "");
    if (!value) return "";
    const height = (options && options.height) || 44;
    const unit = (options && options.unit) || 1.6;

    const codes = [104]; // START B
    for (const char of value) {
      const code = char.charCodeAt(0) - 32;
      if (code < 0 || code > 94) return "";
      codes.push(code);
    }
    let checksum = codes[0];
    for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
    codes.push(checksum % 103, 106); // checksum, then STOP

    const bits = codes.map((code) => CODE128_PATTERNS[code]).join("");
    const width = bits.length * unit;
    // Collapse each run of 1-bits into a single <rect> rather than one per module.
    let bars = "";
    let runStart = -1;
    for (let i = 0; i <= bits.length; i += 1) {
      if (bits[i] === "1") { if (runStart < 0) runStart = i; continue; }
      if (runStart >= 0) {
        bars += `<rect x="${(runStart * unit).toFixed(2)}" y="0" width="${((i - runStart) * unit).toFixed(2)}" height="${height}"/>`;
        runStart = -1;
      }
    }

    return `<svg class="inv-barcode-svg" viewBox="0 0 ${width.toFixed(2)} ${height}" width="${width.toFixed(2)}" height="${height}" role="img" aria-label="Barcode ${escapeHtml(value)}" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
  }

  /* ---------------- tax split ----------------
     The store keeps one rate and one label. On an Indian GST bill that rate is
     collected half as CGST and half as SGST, which is how the split below is
     derived. Any other label is shown as the single line the store configured. */
  // Every line's share of the bill-level discount, and the taxable value and tax that follow from
  // it. The store discounts the whole bill, so the share is proportional to the line's value —
  // the last line absorbs the rounding so the parts always add back up to the whole.
  function lineBreakdown(bill) {
    const lines = Array.isArray(bill.lines) ? bill.lines : [];
    const subtotal = Number(bill.subtotal) || 0;
    const discount = Number(bill.discount) || 0;
    const tax = Number(bill.tax) || 0;
    let discountLeft = Math.round(discount * 100);
    let taxLeft = Math.round(tax * 100);
    const taxableTotal = Math.round((subtotal - discount) * 100);

    return lines.map((line, index) => {
      const gross = Math.round((Number(line.total) || 0) * 100);
      const last = index === lines.length - 1;
      const share = last || !subtotal ? discountLeft : Math.round((gross / Math.round(subtotal * 100)) * Math.round(discount * 100));
      const lineDiscount = Math.min(discountLeft, Math.max(0, share));
      discountLeft -= lineDiscount;
      const taxable = gross - lineDiscount;
      const lineTax = last || !taxableTotal ? taxLeft : Math.round((taxable / taxableTotal) * Math.round(tax * 100));
      const appliedTax = Math.min(taxLeft, Math.max(0, lineTax));
      taxLeft -= appliedTax;
      return { ...line, grossValue: gross / 100, discountShare: lineDiscount / 100, taxableValue: taxable / 100, taxValue: appliedTax / 100 };
    });
  }

  function taxComponents(bill) {
    const rate = Number(bill.taxRate) || 0;
    const label = String(bill.taxLabel || "Tax");
    if (/gst/i.test(label)) {
      return [
        { label: `CGST @ ${(rate / 2).toFixed(2)}%`, short: "CGST" },
        { label: `SGST @ ${(rate / 2).toFixed(2)}%`, short: "SGST" },
      ];
    }
    return [{ label: `${label} @ ${rate}%`, short: label }];
  }

  // Split an amount into n parts that add back up exactly: the last part takes the remainder.
  function splitEvenly(amount, parts) {
    const cents = Math.round((Number(amount) || 0) * 100);
    const each = Math.round(cents / parts);
    const out = [];
    let left = cents;
    for (let i = 0; i < parts; i += 1) {
      const value = i === parts - 1 ? left : Math.min(left, each);
      out.push(value / 100);
      left -= value;
    }
    return out;
  }

  // The whole tax picture, built once: HSN/SAC-wise rows, and the per-component totals taken from
  // those same rows. Deriving the totals from the rows (rather than halving the bill's tax) is what
  // keeps the summary, the HSN table and its footer showing the same figures.
  function taxSummary(bill) {
    const components = taxComponents(bill);
    const detailed = lineBreakdown(bill);
    if (!Number(bill.tax)) return { components: [], groups: [], totals: [], tax: 0 };

    const byCode = new Map();
    for (const line of detailed) {
      const code = line.sku || "\u2014";
      const current = byCode.get(code) || { code, taxable: 0, tax: 0 };
      current.taxable = Math.round((current.taxable + line.taxableValue) * 100) / 100;
      current.tax = Math.round((current.tax + line.taxValue) * 100) / 100;
      byCode.set(code, current);
    }

    const groups = [...byCode.values()].map((group) => ({ ...group, parts: splitEvenly(group.tax, components.length) }));
    const totals = components.map((_, index) =>
      Math.round(groups.reduce((sum, group) => sum + group.parts[index], 0) * 100) / 100);

    return {
      components: components.map((component, index) => ({ ...component, amount: totals[index] })),
      groups,
      totals,
      tax: Math.round(groups.reduce((sum, group) => sum + group.tax, 0) * 100) / 100,
    };
  }

  // Kept for callers that only want the summary lines (the WhatsApp message uses this).
  function taxRows(bill) { return taxSummary(bill).components; }

  function renderInvoice(data) {
    const bill = data.bill || {};
    const store = data.store || {};
    const currency = data.currency || "INR";
    const label = bill.invoiceNumber || (bill.number ? `BILL-${String(bill.number).padStart(4, "0")}` : "BILL");
    const lines = Array.isArray(bill.lines) ? bill.lines : [];
    const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    const taxable = Math.round(((Number(bill.subtotal) || 0) - (Number(bill.discount) || 0)) * 100) / 100;
    const summary = taxSummary(bill);
    const taxes = summary.components;
    const paid = bill.status === "completed" || bill.status === "refunded";
    const note = STATUS_NOTE[bill.status];
    const detailed = lineBreakdown(bill);
    const anyDiscount = Number(bill.discount) > 0;

    const contact = [store.address, store.phone ? `Phone: ${store.phone}` : ""].filter(Boolean);
    const idRows = [
      store.gstin ? ["GSTIN:", store.gstin] : null,
      store.fssai ? ["FSSAI:", store.fssai] : null,
    ].filter(Boolean);

    // The rounding the till applied, if the parts do not add up to the charged total.
    const roundOff = Math.round((Number(bill.total) - (taxable + (Number(bill.tax) || 0))) * 100) / 100;

    const hsnGroups = summary.groups;

    const terms = (String(data.terms || "").split("\n").map((line) => line.trim()).filter(Boolean).length
      ? String(data.terms).split("\n").map((line) => line.trim()).filter(Boolean)
      : DEFAULT_TERMS);

    return `<article class="inv" aria-label="Tax invoice ${escapeHtml(label)}">
  <header class="inv-head">
    <h1>${escapeHtml(store.legalName || store.name || "Store")}</h1>
    ${store.legalName && store.name && store.legalName !== store.name ? `<p class="inv-sub inv-trading">Trading as ${escapeHtml(store.name)}</p>` : ""}
    ${store.businessType ? `<p class="inv-sub">${escapeHtml(store.businessType)}</p>` : ""}
    ${contact.length ? `<p class="inv-sub">${contact.map(escapeHtml).join("<br>")}</p>` : ""}
    ${idRows.length ? `<p class="inv-sub inv-ids">${idRows.map((row) => `<span><b>${escapeHtml(row[0])}</b> ${escapeHtml(row[1])}</span>`).join("")}</p>` : ""}
  </header>

  <div class="inv-title">${store.gstin ? "TAX INVOICE" : "INVOICE"}</div>

  <dl class="inv-meta">
    <div><dt>Invoice No.</dt><dd>${escapeHtml(label)}</dd></div>
    <div><dt>Date &amp; time</dt><dd>${escapeHtml(stamp(bill.createdAt))}</dd></div>
    <div><dt>Payment mode</dt><dd>${escapeHtml(PAYMENT_LABELS[bill.paymentMethod] || String(bill.paymentMethod || "").toUpperCase())}</dd></div>
    <div><dt>Status</dt><dd>${escapeHtml(STATUS_WORD[bill.status] || String(bill.status || "").toUpperCase())}</dd></div>
    ${store.placeOfSupply ? `<div><dt>Place of supply</dt><dd>${escapeHtml(store.placeOfSupply)}</dd></div>` : ""}
    <div><dt>Served by</dt><dd>${escapeHtml(store.owner || store.name || "")}</dd></div>
    ${bill.customerName ? `<div><dt>Customer</dt><dd>${escapeHtml(bill.customerName)}</dd></div>` : ""}
    ${bill.invoiceGeneratedAt && bill.invoiceGeneratedAt !== bill.createdAt ? `<div><dt>Invoice raised</dt><dd>${escapeHtml(stamp(bill.invoiceGeneratedAt))}</dd></div>` : ""}
  </dl>

  ${note ? `<p class="inv-flag">${escapeHtml(note)}</p>` : ""}

  <table class="inv-items">
    <thead>
      <tr>
        <th scope="col" class="col-sn">#</th>
        <th scope="col">Description</th>
        <th scope="col" class="num col-qty">Qty</th>
        <th scope="col" class="num">Rate</th>
        ${anyDiscount ? '<th scope="col" class="num">Disc.</th>' : ""}
        <th scope="col" class="num">${taxes.length ? "Taxable" : "Amount"}</th>
      </tr>
    </thead>
    <tbody>
      ${detailed.map((line, index) => `<tr>
        <td class="col-sn">${index + 1}</td>
        <td>
          <span class="inv-item-name">${escapeHtml(line.name)}</span>
          <span class="inv-item-sku">${line.sku ? `HSN/SAC ${escapeHtml(line.sku)}` : "HSN/SAC —"}${taxes.length ? ` &middot; GST ${Number(bill.taxRate).toFixed(2)}%` : ""}</span>
        </td>
        <td class="num col-qty">${escapeHtml(String(line.quantity))}<span class="inv-unit">PC</span></td>
        <td class="num">${plain(line.price)}</td>
        ${anyDiscount ? `<td class="num">${line.discountShare ? `&minus;${plain(line.discountShare)}` : "&mdash;"}</td>` : ""}
        <td class="num">${plain(taxes.length ? line.taxableValue : line.grossValue)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <dl class="inv-totals">
    <div><dt>Gross amount</dt><dd>${plain(bill.subtotal)}</dd></div>
    ${anyDiscount ? `<div><dt>Total discount</dt><dd>&minus;${plain(bill.discount)}</dd></div>` : ""}
    ${taxes.length ? `<div><dt>Taxable value</dt><dd>${plain(taxable)}</dd></div>` : ""}
    ${taxes.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${plain(row.amount)}</dd></div>`).join("")}
    ${roundOff ? `<div><dt>Round off</dt><dd>${roundOff > 0 ? "+" : "&minus;"}${plain(Math.abs(roundOff))}</dd></div>` : ""}
    <div class="inv-grand"><dt>Total invoice amount</dt><dd>${money(bill.total, currency)}</dd></div>
  </dl>

  <p class="inv-words"><span>Amount in words</span>${escapeHtml(amountInWords(bill.total, currency))}</p>
  ${anyDiscount ? `<p class="inv-saved">You saved ${money(bill.discount, currency)} on this bill</p>` : ""}

  ${taxes.length ? `<section class="inv-block">
    <h2>Tax details</h2>
    <table class="inv-tax">
      <thead><tr><th scope="col">HSN/SAC</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Taxable</th>${taxes.map((row) => `<th scope="col" class="num">${escapeHtml(row.short)}</th>`).join("")}<th scope="col" class="num">Total</th></tr></thead>
      <tbody>
        ${hsnGroups.map((group) => `<tr>
          <td>${escapeHtml(group.code)}</td>
          <td class="num">${Number(bill.taxRate).toFixed(2)}%</td>
          <td class="num">${plain(group.taxable)}</td>
          ${group.parts.map((part) => `<td class="num">${plain(part)}</td>`).join("")}
          <td class="num">${plain(group.tax)}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td class="num"></td><td class="num">${plain(taxable)}</td>${taxes.map((row) => `<td class="num">${plain(row.amount)}</td>`).join("")}<td class="num">${plain(summary.tax)}</td></tr></tfoot>
    </table>
  </section>` : ""}

  <section class="inv-block">
    <h2>Tender detail</h2>
    <dl class="inv-totals inv-tender">
      <div><dt>${escapeHtml(PAYMENT_LABELS[bill.paymentMethod] || "Payment")}</dt><dd>${paid ? money(bill.total, currency) : money(0, currency)}</dd></div>
      <div><dt>Total received</dt><dd>${paid ? money(bill.total, currency) : money(0, currency)}</dd></div>
      <div><dt>Balance due</dt><dd>${paid ? money(0, currency) : money(bill.total, currency)}</dd></div>
      <div><dt>Change given</dt><dd>${money(0, currency)}</dd></div>
    </dl>
  </section>

  <p class="inv-count">NO. OF ITEMS: ${detailed.length} &nbsp;&nbsp;|&nbsp;&nbsp; TOTAL QTY: ${totalQty}</p>

  ${data.invoiceNote ? `<p class="inv-note">${escapeHtml(data.invoiceNote)}</p>` : ""}

  <section class="inv-block inv-terms-block">
    <h2>Terms &amp; conditions</h2>
    <ul class="inv-terms">
      ${terms.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
    </ul>
  </section>

  <div class="inv-barcode">
    ${barcodeSvg(label)}
    <span>${escapeHtml(label)}</span>
  </div>

  <p class="inv-foot">This is a computer-generated invoice and needs no signature.<br>Billed with ${escapeHtml(data.platformName || "Ailexity Retail")}</p>
</article>`;
  }

  global.AilexityInvoice = { render: renderInvoice, barcodeSvg, money, taxRows, taxSummary, lineBreakdown, amountInWords, PAYMENT_LABELS };
})(window);
