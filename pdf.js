// Minimal PDF writer: A4 pages, the built-in Helvetica / Helvetica-Bold fonts (WinAnsi encoding),
// text, lines and filled rectangles. Enough for text reports — no images, no embedded fonts, no compression.

export const PAGE = { width: 595.28, height: 841.89 }; // A4 in points

// Glyph widths (per 1000 em) for characters 32–126, from the standard Helvetica AFM files.
const WIDTHS = {
  regular: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  bold: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
};
// Characters outside Latin-1 that WinAnsi does have, and readable stand-ins for a few that it lacks.
const WINANSI = { "€": "\x80", "…": "\x85", "‘": "\x91", "’": "\x92", "“": "\x93", "”": "\x94", "•": "\x95", "–": "\x96", "—": "\x97", "™": "\x99" };
const FALLBACK = { "₹": "Rs", "✓": "v", "→": "->", " ": " " };

export function toWinAnsi(text) {
  let out = "";
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code < 256) out += ch;
    else if (WINANSI[ch]) out += WINANSI[ch];
    else if (FALLBACK[ch]) out += FALLBACK[ch];
    else out += "?";
  }
  return out;
}
const escapeText = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);
const num = (value) => (Math.round(value * 100) / 100).toString();
function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => num(parseInt(value.slice(index, index + 2), 16) / 255)).join(" ");
}

export class PdfDocument {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); return this.pages.length; }
  get pageCount() { return this.pages.length; }
  // Runs fn once per page with that page as the drawing target (used for footers once the page count is known).
  eachPage(fn) { const current = this.ops; this.pages.forEach((ops, index) => { this.ops = ops; fn(index + 1, this.pages.length); }); this.ops = current; }

  static width(text, size, bold = false) {
    const table = bold ? WIDTHS.bold : WIDTHS.regular; let total = 0;
    for (const ch of toWinAnsi(text)) { const code = ch.charCodeAt(0); total += code >= 32 && code <= 126 ? table[code - 32] : 556; }
    return (total * size) / 1000;
  }
  static truncate(text, size, bold, maxWidth) {
    let str = String(text); if (PdfDocument.width(str, size, bold) <= maxWidth) return str;
    while (str.length && PdfDocument.width(`${str}…`, size, bold) > maxWidth) str = str.slice(0, -1);
    return `${str.trimEnd()}…`;
  }
  static wrap(text, size, bold, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (PdfDocument.width(candidate, size, bold) <= maxWidth || !line) line = candidate; else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(x, y, text, { size = 10, bold = false, color = "#171717", align = "left", maxWidth } = {}) {
    let str = String(text); if (maxWidth) str = PdfDocument.truncate(str, size, bold, maxWidth);
    str = toWinAnsi(str); const width = PdfDocument.width(str, size, bold);
    const tx = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    this.ops.push(`BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(tx)} ${num(y)} Td (${escapeText(str)}) Tj ET`);
    return width;
  }
  line(x1, y1, x2, y2, { color = "#dddddd", width = 0.6 } = {}) { this.ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); }
  rect(x, y, width, height, { fill = "#f5f4f1" } = {}) { this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`); }

  render() {
    const objects = []; const add = (body) => objects.push(body); // returns the 1-based object number
    const catalog = add(null); const pagesObject = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds = this.pages.map((ops) => {
      const stream = Buffer.from(ops.join("\n"), "latin1");
      const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
      return add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
    objects[pagesObject - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")]; let offset = parts[0].length; const offsets = [];
    objects.forEach((body, index) => {
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
      offsets.push(offset); parts.push(chunk); offset += chunk.length;
    });
    const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f ", ...offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n `)].join("\n");
    parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
    return Buffer.concat(parts);
  }
}
