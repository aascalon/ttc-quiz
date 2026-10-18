// Helpers for turning GTFS routes.txt into the quiz's route list.

/** Parse CSV text (RFC 4180-ish: quoted fields, escaped quotes) into row objects. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((f) => f !== ""));
  const keys = header.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** Clean a route long name: collapse whitespace and drop a leading copy of the route number. */
export function normalizeName(longName, shortName) {
  let name = longName.replace(/\s+/g, " ").trim();
  if (shortName && name.startsWith(shortName + " ")) name = name.slice(shortName.length + 1);
  return name;
}

const MODES = { 0: "streetcar", 3: "bus" };

/** Convert routes.txt rows into sorted, de-duplicated quiz routes (bus + streetcar only). */
export function toQuizRoutes(rows) {
  const byNumber = new Map();
  for (const r of rows) {
    const mode = MODES[r.route_type];
    if (!mode) continue;
    const number = r.route_short_name;
    const name = normalizeName(r.route_long_name, number);
    // Rapid-transit lines (e.g. "Line 5 Eglinton") are tagged as light rail; skip them.
    if (!number || !name || /^Line \d/i.test(name)) continue;
    if (byNumber.has(number)) continue;
    byNumber.set(number, { number, name, mode, color: r.route_color ? `#${r.route_color}` : "#ED1C24" });
  }
  return [...byNumber.values()].sort(
    (a, b) => parseInt(a.number, 10) - parseInt(b.number, 10) || a.number.localeCompare(b.number),
  );
}
