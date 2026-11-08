// StockSync core: read store exports, look up scans, compare a shelf section with both systems.
// No DOM here, so the same file runs in the page and in the tests (node --test).
(function (root) {
  "use strict";

  // ---------- CSV ----------

  /** Parse CSV text into an array of objects keyed by the header row. Handles quotes, CRLF and a BOM. */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
    if (!nonEmpty.length) return { headers: [], rows: [] };
    const headers = nonEmpty[0].map((h) => h.trim());
    const out = nonEmpty.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, j) => { o[h] = (r[j] ?? "").trim(); });
      return o;
    });
    return { headers, rows: out };
  }

  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    return [headers.map(csvCell).join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";
  }

  // ---------- Reading exports ----------

  // Column names StockSync recognises, matched without regard to case or spacing.
  const COLUMNS = {
    sku: ["sku", "variant sku", "custom sku"],
    barcode: ["barcode", "variant barcode", "upc", "ean"],
    title: ["title", "description", "item", "name", "product"],
    qty: ["on hand (current)", "on hand", "available (not editable)", "available", "variant inventory qty", "qty.", "qty", "quantity"],
    section: ["bin name", "bin", "section", "shelf"],
  };
  const OPTION_VALUES = ["option1 value", "option2 value", "option3 value"];

  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  /** Codes are compared without case, spaces or dashes, so "bk-rd-01" scans the same as "BK RD 01". */
  const normCode = (s) => String(s || "").toUpperCase().replace(/[\s-]+/g, "");

  function findColumn(headers, aliases) {
    const byNorm = new Map(headers.map((h) => [norm(h), h]));
    for (const a of aliases) if (byNorm.has(a)) return byNorm.get(a);
    return null;
  }

  /**
   * Guess which system an export came from: Shopify's exports have a Handle column,
   * Lightspeed's have System ID or Custom SKU.
   */
  function detectSystem(headers) {
    const h = new Set(headers.map(norm));
    if (h.has("handle")) return "shopify";
    if (h.has("system id") || h.has("custom sku") || h.has("manufact. sku")) return "lightspeed";
    return null;
  }

  /**
   * Turn an export into StockSync items. Throws an Error naming what's missing if the file
   * can't be used. Rows that repeat a SKU (a product at several locations) are summed.
   */
  function readExport(text, system) {
    const { headers, rows } = parseCSV(text);
    if (!headers.length) throw new Error("The file is empty.");
    system = system || detectSystem(headers);
    const col = {};
    for (const k of Object.keys(COLUMNS)) col[k] = findColumn(headers, COLUMNS[k]);
    if (!col.sku) throw new Error("No SKU column found. Expected one of: SKU, Variant SKU, Custom SKU.");
    if (!col.qty) throw new Error("No quantity column found. Expected one of: On hand (current), On hand, Available, Qty.");
    const optCols = OPTION_VALUES.map((a) => findColumn(headers, [a])).filter(Boolean);

    const items = new Map();
    const problems = [];
    rows.forEach((r, i) => {
      const sku = r[col.sku];
      if (!sku) { problems.push(`Row ${i + 2}: no SKU, skipped.`); return; }
      const qtyText = r[col.qty];
      const qty = qtyText === "" ? 0 : Number(qtyText);
      if (!Number.isFinite(qty)) { problems.push(`Row ${i + 2} (${sku}): quantity "${qtyText}" isn't a number, skipped.`); return; }
      const options = optCols.map((c) => r[c]).filter((v) => v && v !== "Default Title");
      const title = [col.title ? r[col.title] : "", ...options].filter(Boolean).join(" · ");
      const key = normCode(sku);
      const prev = items.get(key);
      if (prev) { prev.qty += qty; return; }
      items.set(key, {
        key,
        sku,
        barcode: col.barcode ? r[col.barcode] : "",
        title: title || sku,
        qty,
        section: col.section ? r[col.section] : "",
      });
    });
    return { system, items, problems, hasSection: !!col.section, hasBarcode: !!col.barcode };
  }

  // ---------- Combining the two systems ----------

  /**
   * Build one catalogue from both systems' items, keyed by normalised SKU,
   * plus a lookup from every barcode and SKU to that key.
   */
  function buildCatalog(shopify, lightspeed) {
    const catalog = new Map();
    const add = (src, name) => {
      if (!src) return;
      for (const it of src.items.values()) {
        const c = catalog.get(it.key) || { key: it.key, sku: it.sku, barcode: "", title: it.title, section: "", shopify: null, lightspeed: null };
        c[name] = { qty: it.qty, section: it.section };
        if (!c.barcode && it.barcode) c.barcode = it.barcode;
        if (name === "shopify" || !c.title) c.title = it.title;
        catalog.set(it.key, c);
      }
    };
    add(shopify, "shopify");
    add(lightspeed, "lightspeed");
    const lookup = new Map();
    for (const c of catalog.values()) {
      lookup.set(c.key, c.key);
      if (c.barcode) lookup.set(normCode(c.barcode), c.key);
    }
    // An item's section: Shopify's bin if it has one, else Lightspeed's.
    for (const c of catalog.values()) c.section = (c.shopify && c.shopify.section) || (c.lightspeed && c.lightspeed.section) || "";
    return { catalog, lookup };
  }

  function sections(catalog) {
    const counts = new Map();
    for (const c of catalog.values()) if (c.section) counts.set(c.section, (counts.get(c.section) || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([name, items]) => ({ name, items }));
  }

  /** Find a scanned or typed code. Returns the item's key, or null for a code neither system knows. */
  function lookupCode(lookup, code) {
    return lookup.get(normCode(code)) || null;
  }

  // ---------- The report ----------

  const STATUS = {
    missing: "Missing",
    unlisted: "Unlisted",
    count_off: "Count off",
    ok: "OK",
  };

  /**
   * Compare a section's shelf count with both systems.
   *
   * scans: { [itemKey or "?CODE" for unknown codes]: count }
   * confirmed: Set of item keys the employee has marked missing.
   *
   * Every row has one status (missing, unlisted, count_off, ok) and, separately,
   * channels_disagree when Shopify and Lightspeed list different stock for the item.
   */
  function reconcile({ catalog, section, scans, confirmed }) {
    confirmed = confirmed || new Set();
    const rows = [];
    const seen = new Set();

    const listedQtys = (c) => [c.shopify, c.lightspeed].filter(Boolean).map((s) => s.qty);

    const channelNote = (c) => {
      if (c.shopify && !c.lightspeed) return "Only in Shopify";
      if (!c.shopify && c.lightspeed) return "Only in Lightspeed";
      if (c.shopify.qty !== c.lightspeed.qty) return `Shopify ${c.shopify.qty}, Lightspeed ${c.lightspeed.qty}`;
      return "";
    };

    for (const c of catalog.values()) {
      const inSection = c.section === section;
      const scanned = scans[c.key] || 0;
      if (!inSection && !scanned) continue;
      seen.add(c.key);
      const qtys = listedQtys(c);
      const expected = Math.max(0, ...qtys);
      let status, note = "";
      if (!inSection) {
        status = "unlisted";
        note = c.section ? `Listed in section ${c.section}` : "Listed with no section";
      } else if (scanned === 0 && expected > 0) {
        status = "missing";
        note = confirmed.has(c.key) ? "Marked missing" : "";
      } else if (qtys.some((q) => q !== scanned)) {
        status = "count_off";
        note = `Counted ${scanned}, listed ${[...new Set(qtys)].join(" / ")}`;
      } else status = "ok";
      const channels = channelNote(c);
      rows.push({
        key: c.key,
        sku: c.sku,
        barcode: c.barcode,
        title: c.title,
        section: c.section,
        scanned,
        shopify: c.shopify ? c.shopify.qty : null,
        lightspeed: c.lightspeed ? c.lightspeed.qty : null,
        status,
        note,
        channels_disagree: channels !== "",
        channel_note: channels,
        confirmed_missing: status === "missing" && confirmed.has(c.key),
      });
    }

    // Codes neither system knows.
    for (const [k, n] of Object.entries(scans)) {
      if (!k.startsWith("?") || !n) continue;
      const code = k.slice(1);
      rows.push({
        key: k, sku: "", barcode: code, title: "Unknown code", section: "", scanned: n,
        shopify: null, lightspeed: null, status: "unlisted", note: "Not in either system",
        channels_disagree: false, channel_note: "", confirmed_missing: false,
      });
    }

    const order = { missing: 0, unlisted: 1, count_off: 2, ok: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || (b.channels_disagree - a.channels_disagree) || a.title.localeCompare(b.title));

    const summary = { missing: 0, unlisted: 0, count_off: 0, ok: 0, channels_disagree: 0, scanned: 0 };
    for (const r of rows) {
      summary[r.status]++;
      if (r.channels_disagree) summary.channels_disagree++;
      summary.scanned += r.scanned;
    }
    return { rows, summary };
  }

  const REPORT_COLUMNS = ["section", "status", "title", "sku", "barcode", "scanned", "shopify", "lightspeed", "note", "channels_disagree", "channel_note", "confirmed_missing"];

  function reportCSV(report, section) {
    return toCSV(REPORT_COLUMNS, report.rows.map((r) => ({
      ...r,
      section,
      status: STATUS[r.status],
      shopify: r.shopify == null ? "" : r.shopify,
      lightspeed: r.lightspeed == null ? "" : r.lightspeed,
      channels_disagree: r.channels_disagree ? "yes" : "no",
      confirmed_missing: r.confirmed_missing ? "yes" : "no",
    })));
  }

  const api = { parseCSV, toCSV, detectSystem, readExport, buildCatalog, sections, lookupCode, normCode, reconcile, reportCSV, STATUS, COLUMNS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StockSync = api;
})(typeof self !== "undefined" ? self : this);
