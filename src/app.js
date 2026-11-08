// StockSync page: load exports, scan a section, show the live report. Logic lives in reconcile.js.
(function () {
  "use strict";
  const S = window.StockSync;
  const SAMPLE = window.STOCKSYNC_SAMPLE;
  const STORE_KEY = "stocksync:v1";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- State ----------
  // Everything needed to pick up where the employee left off, saved in this browser only.
  let state = {
    files: { shopify: null, lightspeed: null }, // { name, text }
    sample: false,
    section: "",
    scans: {},      // section -> { key: count }
    confirmed: {},  // section -> [key]
    history: {},    // section -> [{ key, code, delta }]
  };
  let data = null;      // { shopify, lightspeed, catalog, lookup, sections }
  let pending = { shopify: null, lightspeed: null };
  let filter = "all";
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
    setDropStatus(target, `${file.name} · ${parsed.items.size} items${moved ? " (looks like this export)" : ""}`, parsed.problems);
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
    setFeedback("info", "Ready", `Scan the items on shelf ${state.section}. A scanner works like a keyboard: point and scan.`);
    render();
    focusScan();
  }

  function renderDataBar() {
    const bar = $("dataBar");
    const part = (label, src) => src ? `<span class="pill">${label} · ${src.items.size} items</span>` : `<span class="pill muted">No ${label} file</span>`;
    bar.innerHTML = (state.sample ? `<span class="pill">${esc(SAMPLE.shop)} (sample)</span>` : "") +
      part("Shopify", data.shopify) + part("Lightspeed", data.lightspeed) +
      `<button class="link-btn" id="changeFiles" type="button">Change files</button>`;
    bar.hidden = false;
    $("changeFiles").onclick = showSetup;
  }

  function renderSections() {
    $("section").innerHTML = data.sections.map((s) => {
      const n = Object.values(state.scans[s.name] || {}).reduce((a, b) => a + b, 0);
      return `<option value="${esc(s.name)}" ${s.name === state.section ? "selected" : ""}>${esc(s.name)} · ${s.items} items${n ? ` · ${n} counted` : ""}</option>`;
    }).join("");
  }

  const TILES = [
    ["all", "All", null],
    ["missing", "Missing", "missing"],
    ["unlisted", "Unlisted", "unlisted"],
    ["count_off", "Count off", "count_off"],
    ["channels", "Channels disagree", "channels_disagree"],
    ["ok", "OK", "ok"],
  ];

  function render() {
    const report = S.reconcile({ catalog: data.catalog, section: state.section, scans: scans(), confirmed: confirmed() });
    $("reportSection").textContent = `· section ${state.section}`;
    $("tiles").innerHTML = TILES.map(([id, label, key]) => {
      const n = key ? report.summary[key] : report.rows.length;
      return `<button class="tile ${id}" role="tab" aria-selected="${filter === id}" data-filter="${id}"><span class="n">${n}</span><span class="l">${label}</span></button>`;
    }).join("");

    const rows = report.rows.filter((r) => filter === "all" || (filter === "channels" ? r.channels_disagree : r.status === filter));
    $("rows").innerHTML = rows.map(rowHTML).join("");
    $("empty").hidden = rows.length > 0;
    $("empty").textContent = report.rows.length ? "Nothing in this group." : "Nothing here yet. Start scanning the shelf.";
    renderRecent();
    flashKey = null;
  }

  function rowHTML(r) {
    const badge = `<span class="badge ${r.status}">${S.STATUS[r.status]}</span>` + (r.channels_disagree ? `<span class="badge channels">Channels disagree</span>` : "");
    const details = [r.note, r.channel_note].filter(Boolean).map((d) => `<div>${esc(d)}</div>`).join("");
    const qty = (v) => (v == null ? `<span class="muted">—</span>` : v);
    const mark = r.status === "missing"
      ? `<br><button class="btn mark-btn" data-mark="${esc(r.key)}" aria-pressed="${r.confirmed_missing}">${r.confirmed_missing ? "Marked missing" : "Mark missing"}</button>` : "";
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
    const h = history().slice(-12).reverse();
    $("recent").innerHTML = h.length ? h.map((e) => {
      const c = data.catalog.get(e.key);
      const name = c ? c.title : "Unknown code";
      return `<li><span>${e.delta < 0 ? "− " : ""}${esc(name)}</span><code>${esc(e.code)}</code></li>`;
    }).join("") : `<li class="muted">No scans yet</li>`;
  }

  function setFeedback(kind, title, detail) {
    $("feedback").innerHTML = `<div class="fb ${kind}"><strong>${esc(title)}</strong><span>${esc(detail || "")}</span></div>`;
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
    adjust(key, 1, code);
    const c = data.catalog.get(key);
    const n = scans()[key];
    if (!c) {
      setFeedback("bad", "Unknown code", `${code} isn't in Shopify or Lightspeed. It's on the report as Unlisted.`);
      beep("bad");
    } else if (c.section !== state.section) {
      setFeedback("warn", `${c.title} · ${n} counted`, c.section ? `Not on this shelf's list: it's listed in section ${c.section}.` : "Not on this shelf's list: it has no section.");
      beep("warn");
    } else {
      const listed = [c.shopify && `Shopify ${c.shopify.qty}`, c.lightspeed && `Lightspeed ${c.lightspeed.qty}`].filter(Boolean).join(" · ");
      setFeedback("good", `${c.title} · ${n} counted`, `Listed: ${listed}`);
      beep("good");
    }
  }

  function adjust(key, delta, code) {
    const s = scans();
    const next = Math.max(0, (s[key] || 0) + delta);
    if (next === (s[key] || 0)) return;
    if (next) s[key] = next; else delete s[key];
    history().push({ key, code: code || (delta > 0 ? "+1 by hand" : "−1 by hand"), delta });
    flashKey = key;
    save();
    render();
    renderSections();
  }

  function undo() {
    const e = history().pop();
    if (!e) return setFeedback("info", "Nothing to undo", "");
    const s = scans();
    const next = Math.max(0, (s[e.key] || 0) - e.delta);
    if (next) s[e.key] = next; else delete s[e.key];
    const c = data.catalog.get(e.key);
    setFeedback("info", "Undone", `${c ? c.title : e.code}: now ${next} counted`);
    save(); render(); renderSections();
  }

  function resetSection(ask) {
    if (ask && !window.confirm(`Clear every scan for section ${state.section}? This can't be undone.`)) return;
    state.scans[state.section] = {};
    state.history[state.section] = [];
    state.confirmed[state.section] = [];
    save(); render(); renderSections();
    setFeedback("info", "Section cleared", `Ready to count ${state.section} again.`);
  }

  function toggleMissing(key) {
    const list = sec(state.confirmed, []);
    const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1); else list.push(key);
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
  }

  // Plays the sample's demo scans as if from a scanner: for trying it out and for the demo clip.
  function playDemo() {
    if (demoTimer) return stopDemo();
    state.section = SAMPLE.demoSection;
    resetSection(Object.keys(scans()).length > 0);
    if (Object.keys(scans()).length) return;
    renderSections();
    filter = "all";
    const codes = SAMPLE.demoScans.slice();
    const input = $("scan");
    $("demo").textContent = "Stop demo";
    const next = () => {
      if (!codes.length) { stopDemo(); setFeedback("info", "Demo done", "The bike that wasn't scanned is at the top: mark it missing, then export the report."); return; }
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
    if (b) b.textContent = "Play demo scans";
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
    filter = "all";
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
  $("tiles").addEventListener("click", (e) => {
    const t = e.target.closest("[data-filter]");
    if (t) { filter = t.dataset.filter; render(); focusScan(); }
  });
  $("rows").addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) { adjust(step.dataset.key, Number(step.dataset.step)); focusScan(); return; }
    const mark = e.target.closest("[data-mark]");
    if (mark) { toggleMissing(mark.dataset.mark); focusScan(); }
  });
  // A scanner types into whatever has focus. If focus wandered, send the keystrokes to the scan box.
  document.addEventListener("keydown", (e) => {
    if ($("work").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.key.length === 1) focusScan();
  });

  // ---------- Start ----------
  load();
  if (state.files.shopify || state.files.lightspeed) {
    try { buildData(); showWork(); } catch (e) { showSetup(); }
  } else showSetup();
})();
