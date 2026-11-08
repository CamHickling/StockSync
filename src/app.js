// StockSync page: load exports, scan a section, show the live report. Logic lives in reconcile.js.
(function () {
  "use strict";
  const S = window.StockSync;
  const SAMPLE = window.STOCKSYNC_SAMPLE;
  const STORE_KEY = "stocksync:v1";
  const THEME_KEY = "stocksync:theme";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ICONS = {
    good: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 6v8M12 18.5v.01"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    info: '<svg viewBox="0 0 24 24"><path d="M12 11v6M12 7v.01"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
    auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  };

  // ---------- State ----------
  // Everything needed to pick up where the employee left off, saved in this browser only.
  let state = {
    files: { shopify: null, lightspeed: null }, // { name, text }
    sample: false,
    section: "",
    scans: {},      // section -> { key: count }
    confirmed: {},  // section -> [key]
    history: {},    // section -> [{ key, code, delta, kind }]
  };
  let data = null;      // { shopify, lightspeed, catalog, lookup, sections }
  let pending = { shopify: null, lightspeed: null };
  let filter = "all";
  let query = "";
  let showOk = false;
  let flashKey = null;
  let demoTimer = null;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private window or full: keep working */ }
  }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); if (s && s.files) state = Object.assign(state, s); } catch (e) { /* ignore */ }
  }

  const sec = (obj, init) => (obj[state.section] = obj[state.section] || init);
  const scans = () => sec(state.scans, {});
  const history = () => sec(state.history, []);
  const confirmed = () => new Set(sec(state.confirmed, []));
  const reportFor = (section) => S.reconcile({ catalog: data.catalog, section, scans: state.scans[section] || {}, confirmed: new Set(state.confirmed[section] || []) });

  // ---------- Theme ----------

  function currentTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; } }
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    const label = { auto: "Theme: match the system", light: "Theme: light", dark: "Theme: dark" }[t];
    $("theme").innerHTML = ICONS[{ auto: "auto", light: "sun", dark: "moon" }[t]];
    $("theme").title = label;
    $("theme").setAttribute("aria-label", label + ". Click to change.");
  }
  $("theme").addEventListener("click", () => {
    const next = { auto: "light", light: "dark", dark: "auto" }[currentTheme()];
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    applyTheme(next);
  });
  applyTheme(currentTheme());

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Loading exports ----------

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function acceptFile(slot, file) {
    showSetupError("");
    let text;
    try { text = await readFile(file); } catch (e) { return showSetupError(`Couldn't read ${file.name}.`); }
    let parsed;
    try { parsed = S.readExport(text); } catch (e) { return showSetupError(`${file.name}: ${e.message}`); }
    // A file dropped on the wrong box goes where it belongs.
    const target = parsed.system || slot;
    pending[target] = { name: file.name, text };
    const moved = parsed.system && parsed.system !== slot;
    setDropStatus(target, `${file.name} · ${parsed.items.size} items${moved ? " (moved here: it's this kind of export)" : ""}`, parsed.problems);
    $("useFiles").disabled = !(pending.shopify || pending.lightspeed);
  }

  function setDropStatus(system, text, problems) {
    const box = document.querySelector(`.drop[data-system="${system}"]`);
    box.classList.add("loaded");
    box.querySelector("[data-status]").textContent = "✓ " + text + (problems && problems.length ? ` · ${problems.length} rows skipped` : "");
    if (problems && problems.length) box.title = problems.slice(0, 10).join("\n");
  }

  function showSetupError(msg) {
    const el = $("setupError");
    el.textContent = msg;
    el.hidden = !msg;
  }

  function buildData() {
    const read = (f) => (f ? S.readExport(f.text) : null);
    const shopify = read(state.files.shopify);
    const lightspeed = read(state.files.lightspeed);
    const { catalog, lookup } = S.buildCatalog(shopify, lightspeed);
    data = { shopify, lightspeed, catalog, lookup, sections: S.sections(catalog) };
    if (!data.sections.some((s) => s.name === state.section)) state.section = data.sections.length ? data.sections[0].name : "";
  }

  function startWith(files, sample) {
    state.files = files;
    state.sample = sample;
    try { buildData(); } catch (e) { return showSetupError(e.message); }
    if (!data.sections.length) return showSetupError("Neither file has a bin or section column, so StockSync can't tell which items belong on a shelf. Add a Bin column, or set bins in Shopify.");
    save();
    showWork();
  }

  // ---------- Views ----------

  function showSetup() {
    stopDemo();
    // Keep the files already in use, so replacing one doesn't drop the other.
    if (!state.sample) {
      for (const sys of ["shopify", "lightspeed"]) {
        const f = state.files[sys];
        if (f && !pending[sys]) { pending[sys] = f; try { setDropStatus(sys, `${f.name} · ${S.readExport(f.text).items.size} items`); } catch (e) { /* ignore */ } }
      }
    }
    $("useFiles").disabled = !(pending.shopify || pending.lightspeed);
    $("setup").hidden = false;
    $("work").hidden = true;
    $("dataBar").hidden = true;
  }

  function showWork() {
    $("setup").hidden = true;
    $("work").hidden = false;
    renderDataBar();
    renderSections();
    $("demo").hidden = !(state.sample && SAMPLE);
    setFeedback("info", "Ready to scan", `Scan the items on shelf ${state.section}. A scanner works like a keyboard: just point and scan.`);
    render();
    focusScan();
  }

  function renderDataBar() {
    const bar = $("dataBar");
    const part = (label, src) => `<span class="pill"><span class="dot ${src ? "" : "off"}"></span>${label}${src ? ` · ${src.items.size}` : ": no file"}</span>`;
    bar.innerHTML = (state.sample ? `<span class="pill">${esc(SAMPLE.shop)} · sample</span>` : "") +
      part("Shopify", data.shopify) + part("Lightspeed", data.lightspeed) +
      `<button class="link-btn" id="changeFiles" type="button">Change files</button>`;
    bar.hidden = false;
    $("changeFiles").onclick = showSetup;
  }

  function renderSections() {
    $("section").innerHTML = data.sections.map((s) => {
      const counted = Object.values(state.scans[s.name] || {}).reduce((a, b) => a + b, 0);
      let status = "not counted yet";
      if (counted) {
        const sum = reportFor(s.name).summary;
        const issues = sum.missing + sum.unlisted + sum.count_off;
        status = issues ? `${issues} to check` : "all match";
      }
      return `<option value="${esc(s.name)}" ${s.name === state.section ? "selected" : ""}>${esc(s.name)} · ${s.items} items · ${status}</option>`;
    }).join("");
  }

  const TILES = [
    ["all", "All items", null],
    ["missing", "Missing", "missing"],
    ["unlisted", "Unlisted", "unlisted"],
    ["count_off", "Count off", "count_off"],
    ["channels", "Channels disagree", "channels_disagree"],
    ["ok", "Match", "ok"],
  ];

  function render() {
    const report = S.reconcile({ catalog: data.catalog, section: state.section, scans: scans(), confirmed: confirmed() });
    const sum = report.summary;
    $("reportSection").textContent = state.section;

    // Progress: how many of the items listed here have been found, and how many items match.
    const listed = report.rows.filter((r) => r.status !== "unlisted" && Math.max(r.shopify ?? 0, r.lightspeed ?? 0) > 0);
    const found = listed.filter((r) => r.scanned > 0).length;
    const pct = listed.length ? Math.round((found / listed.length) * 100) : 0;
    $("progressBar").style.width = pct + "%";
    document.querySelector(".progress").setAttribute("aria-valuenow", pct);
    $("progressText").textContent = sum.scanned
      ? `Found ${found} of ${listed.length} listed items · ${sum.scanned} scanned`
      : `${listed.length} items listed in stock here · nothing scanned yet`;
    const matching = report.rows.filter((r) => r.status === "ok" && !r.channels_disagree).length;
    $("accuracy").textContent = sum.scanned && report.rows.length ? Math.round((matching / report.rows.length) * 100) + "%" : "—";

    $("tiles").innerHTML = TILES.map(([id, label, key]) => {
      const n = key ? sum[key] : report.rows.length;
      return `<button class="tile ${id} ${n === 0 && id !== "all" ? "zero" : ""}" role="tab" aria-selected="${filter === id}" data-filter="${id}"><span class="n">${n}</span><span class="l">${label}</span></button>`;
    }).join("");

    const q = query.trim().toLowerCase();
    let rows = report.rows.filter((r) => filter === "all" || (filter === "channels" ? r.channels_disagree : r.status === filter));
    if (q) rows = rows.filter((r) => [r.title, r.sku, r.barcode].some((v) => String(v).toLowerCase().includes(q)));

    // In the full list, matching items fold away so the problems stand out.
    let html;
    if (filter === "all" && !q) {
      const issues = rows.filter((r) => r.status !== "ok" || r.channels_disagree);
      const ok = rows.filter((r) => r.status === "ok" && !r.channels_disagree);
      html = issues.map(rowHTML).join("");
      if (ok.length) {
        html += `<tr class="ok-toggle"><td colspan="6"><button type="button" id="okToggle" aria-expanded="${showOk}">${showOk ? "▾ Hide" : "▸ Show"} ${ok.length} matching item${ok.length === 1 ? "" : "s"}</button></td></tr>`;
        if (showOk || ok.some((r) => r.key === flashKey)) html += ok.filter((r) => showOk || r.key === flashKey).map(rowHTML).join("");
      }
    } else html = rows.map(rowHTML).join("");
    $("rows").innerHTML = html;

    const empty = $("empty");
    empty.hidden = rows.length > 0;
    empty.innerHTML = q ? `<b>No matches</b>Nothing in this view matches "${esc(query)}".`
      : report.rows.length ? `<b>Nothing here</b>No items in this group.`
      : `<b>Start scanning</b>The report fills in as you scan.`;
    renderRecent();
    flashKey = null;
  }

  function rowHTML(r) {
    const badge = `<span class="badge ${r.status}">${S.STATUS[r.status] === "OK" ? "Match" : S.STATUS[r.status]}</span>` + (r.channels_disagree ? `<span class="badge channels">Channels disagree</span>` : "");
    const details = [r.note, r.channel_note].filter(Boolean).map((d) => `<div>${esc(d)}</div>`).join("");
    const qty = (v) => (v == null ? `<span class="muted">—</span>` : v);
    const mark = r.status === "missing"
      ? `<br><button class="btn mark-btn" data-mark="${esc(r.key)}" aria-pressed="${r.confirmed_missing}">${r.confirmed_missing ? "✓ Marked missing" : "Mark missing"}</button>` : "";
    const stepper = r.key.startsWith("?") ? `<b>${r.scanned}</b>`
      : `<span class="stepper"><button data-step="-1" data-key="${esc(r.key)}" aria-label="One fewer ${esc(r.title)}">−</button><b>${r.scanned}</b><button data-step="1" data-key="${esc(r.key)}" aria-label="One more ${esc(r.title)}">+</button></span>`;
    return `<tr class="${r.key === flashKey ? "flash" : ""}">
      <td>${badge}${mark}</td>
      <td><div class="item-title">${esc(r.title)}</div><div class="item-sku">${esc(r.sku || r.barcode)}${r.sku && r.barcode ? " · " + esc(r.barcode) : ""}</div><div class="details-inline"><div>Shopify ${r.shopify ?? "—"} · Lightspeed ${r.lightspeed ?? "—"}</div>${details}</div></td>
      <td class="num">${stepper}</td>
      <td class="num">${qty(r.shopify)}</td>
      <td class="num">${qty(r.lightspeed)}</td>
      <td class="details">${details}</td>
    </tr>`;
  }

  function renderRecent() {
    const h = history().slice(-15).reverse();
    $("recent").innerHTML = h.length ? h.map((e) => {
      const c = data.catalog.get(e.key);
      const name = c ? c.title : "Unknown code";
      return `<li><span><span class="rdot ${e.kind || "info"}"></span>${e.delta < 0 ? "− " : ""}${esc(name)}</span><code>${esc(e.code)}</code></li>`;
    }).join("") : `<li class="muted">No scans yet</li>`;
  }

  let flashTimer = null;
  function setFeedback(kind, title, detail) {
    $("feedback").innerHTML = `<div class="fb ${kind}"><span class="fb-icon">${ICONS[kind]}</span><div><strong>${esc(title)}</strong><span>${esc(detail || "")}</span></div></div>`;
    if (kind === "info") return;
    const card = $("scanCard");
    card.classList.remove("good", "warn", "bad");
    void card.offsetWidth;
    card.classList.add(kind);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => card.classList.remove(kind), 650);
  }

  // ---------- Scanning ----------

  let audio = null;
  function beep(kind) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = { good: 1046, warn: 523, bad: 262 }[kind] || 880;
      g.gain.setValueAtTime(0.08, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.12);
    } catch (e) { /* no audio: fine */ }
  }

  function addScan(code) {
    code = code.trim();
    if (!code) return;
    const key = S.lookupCode(data.lookup, code) || "?" + S.normCode(code);
    const c = data.catalog.get(key);
    const kind = !c ? "bad" : c.section !== state.section ? "warn" : "good";
    adjust(key, 1, code, kind);
    const n = scans()[key];
    if (kind === "bad") {
      setFeedback("bad", "Unknown code", `${code} isn't in Shopify or Lightspeed. It's on the report as Unlisted.`);
    } else if (kind === "warn") {
      setFeedback("warn", `${c.title} · ${n} counted`, c.section ? `Not listed for this shelf: it belongs in section ${c.section}.` : "Not listed for this shelf: it has no section.");
    } else {
      const listed = [c.shopify && `Shopify ${c.shopify.qty}`, c.lightspeed && `Lightspeed ${c.lightspeed.qty}`].filter(Boolean).join(" · ");
      const max = Math.max(c.shopify ? c.shopify.qty : 0, c.lightspeed ? c.lightspeed.qty : 0);
      setFeedback("good", `${c.title} · ${n} counted`, `Listed: ${listed}${n > max ? " · more than listed" : ""}`);
    }
    beep(kind);
  }

  function adjust(key, delta, code, kind) {
    const s = scans();
    const next = Math.max(0, (s[key] || 0) + delta);
    if (next === (s[key] || 0)) return;
    if (next) s[key] = next; else delete s[key];
    history().push({ key, code: code || (delta > 0 ? "+1 by hand" : "−1 by hand"), delta, kind: kind || "info" });
    flashKey = key;
    save();
    render();
    renderSections();
  }

  function undo() {
    const e = history().pop();
    if (!e) return toast("Nothing to undo");
    const s = scans();
    const next = Math.max(0, (s[e.key] || 0) - e.delta);
    if (next) s[e.key] = next; else delete s[e.key];
    const c = data.catalog.get(e.key);
    toast(`Undone: ${c ? c.title : e.code}, now ${next} counted`);
    flashKey = e.key;
    save(); render(); renderSections();
  }

  function resetSection(ask) {
    if (ask && !window.confirm(`Clear every scan for section ${state.section}? This can't be undone.`)) return false;
    state.scans[state.section] = {};
    state.history[state.section] = [];
    state.confirmed[state.section] = [];
    showOk = false;
    save(); render(); renderSections();
    setFeedback("info", "Section cleared", `Ready to count ${state.section} again.`);
    return true;
  }

  function toggleMissing(key) {
    const list = sec(state.confirmed, []);
    const i = list.indexOf(key);
    const c = data.catalog.get(key);
    if (i >= 0) { list.splice(i, 1); toast(`${c ? c.title : key}: no longer marked missing`); }
    else { list.push(key); toast(`${c ? c.title : key}: marked missing`); }
    save(); render();
  }

  function exportCSV() {
    const report = S.reconcile({ catalog: data.catalog, section: state.section, scans: scans(), confirmed: confirmed() });
    const blob = new Blob(["﻿" + S.reportCSV(report, state.section)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stocksync-${state.section}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported the report for section ${state.section}`);
  }

  // Plays the sample's demo scans as if from a scanner: for trying it out and for the demo clip.
  function playDemo() {
    if (demoTimer) return stopDemo();
    state.section = SAMPLE.demoSection;
    filter = "all"; query = ""; $("search").value = "";
    if (Object.keys(scans()).length && !resetSection(true)) return;
    if (!Object.keys(scans()).length) resetSection(false);
    renderSections();
    const codes = SAMPLE.demoScans.slice();
    const input = $("scan");
    $("demo").textContent = "■ Stop demo";
    const next = () => {
      if (!codes.length) { stopDemo(); setFeedback("info", "Demo done", "The bike that wasn't found is at the top of the report: mark it missing, then export the report."); return; }
      const code = codes.shift();
      let i = 0;
      const type = () => {
        input.value = code.slice(0, ++i);
        if (i < code.length) demoTimer = setTimeout(type, 12);
        else demoTimer = setTimeout(() => { input.value = ""; addScan(code); demoTimer = setTimeout(next, 380); }, 60);
      };
      type();
    };
    next();
  }
  function stopDemo() {
    clearTimeout(demoTimer);
    demoTimer = null;
    const b = $("demo");
    if (b) b.textContent = "▶ Play demo scans";
  }

  function focusScan() {
    const el = $("scan");
    if (el && !$("work").hidden) el.focus();
  }

  // ---------- Events ----------

  document.querySelectorAll("[data-file]").forEach((input) => {
    input.addEventListener("change", () => input.files[0] && acceptFile(input.dataset.file, input.files[0]));
  });
  document.querySelectorAll(".drop").forEach((box) => {
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault(); box.classList.remove("over");
      [...e.dataTransfer.files].slice(0, 2).forEach((f, i) => acceptFile(i === 0 ? box.dataset.system : (box.dataset.system === "shopify" ? "lightspeed" : "shopify"), f));
    });
  });
  // Counts are kept per section and matched by SKU and barcode, so they carry over to new files.
  $("useFiles").addEventListener("click", () => startWith({ shopify: pending.shopify, lightspeed: pending.lightspeed }, false));
  $("useSample").addEventListener("click", () => {
    if (!SAMPLE) return showSetupError("The sample data is missing (sample/sample-data.js).");
    startWith({ shopify: { name: "shopify_inventory.csv", text: SAMPLE.shopify }, lightspeed: { name: "lightspeed_items.csv", text: SAMPLE.lightspeed } }, true);
  });

  $("section").addEventListener("change", (e) => {
    stopDemo();
    state.section = e.target.value;
    filter = "all"; query = ""; $("search").value = ""; showOk = false;
    save(); render();
    setFeedback("info", `Section ${state.section}`, "Ready to scan.");
    focusScan();
  });
  $("scanForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("scan");
    addScan(input.value);
    input.value = "";
  });
  $("undo").addEventListener("click", () => { undo(); focusScan(); });
  $("reset").addEventListener("click", () => { resetSection(true); focusScan(); });
  $("demo").addEventListener("click", () => { playDemo(); focusScan(); });
  $("export").addEventListener("click", () => { exportCSV(); focusScan(); });
  $("search").addEventListener("input", (e) => { query = e.target.value; render(); });
  $("tiles").addEventListener("click", (e) => {
    const t = e.target.closest("[data-filter]");
    if (t) { filter = t.dataset.filter; render(); focusScan(); }
  });
  $("rows").addEventListener("click", (e) => {
    if (e.target.closest("#okToggle")) { showOk = !showOk; render(); focusScan(); return; }
    const step = e.target.closest("[data-step]");
    if (step) { adjust(step.dataset.key, Number(step.dataset.step)); focusScan(); return; }
    const mark = e.target.closest("[data-mark]");
    if (mark) { toggleMissing(mark.dataset.mark); focusScan(); }
  });
  document.addEventListener("keydown", (e) => {
    if ($("work").hidden) return;
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    // Ctrl+Z undoes the last scan, unless you're editing text in a box.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      if (!typing || (t.id === "scan" && !t.value)) { e.preventDefault(); undo(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing) return;
    // A scanner types into whatever has focus. If focus wandered, send the keystrokes to the scan box.
    if (e.key.length === 1) focusScan();
  });

  // ---------- Start ----------
  load();
  if (state.files.shopify || state.files.lightspeed) {
    try { buildData(); showWork(); } catch (e) { showSetup(); }
  } else showSetup();
})();
