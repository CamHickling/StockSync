// node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const S = require("../src/reconcile.js");

const sample = (f) => fs.readFileSync(path.join(__dirname, "..", "sample", f), "utf8");

test("parseCSV handles quotes, commas, CRLF and a BOM", () => {
  const { headers, rows } = S.parseCSV('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,4');
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "x, y", b: 'say "hi"' }, { a: "3", b: "4" }]);
});

test("toCSV round-trips through parseCSV", () => {
  const rows = [{ a: 'q"uote', b: "1,2" }, { a: "line\nbreak", b: "" }];
  assert.deepEqual(S.parseCSV(S.toCSV(["a", "b"], rows)).rows, rows);
});

test("detectSystem tells the exports apart", () => {
  assert.equal(S.detectSystem(["Handle", "Title", "SKU"]), "shopify");
  assert.equal(S.detectSystem(["System ID", "UPC", "Custom SKU"]), "lightspeed");
  assert.equal(S.detectSystem(["sku", "qty"]), null);
});

test("readExport reads the Shopify sample: titles with sizes, bins, on-hand counts", () => {
  const shop = S.readExport(sample("shopify_inventory.csv"));
  assert.equal(shop.system, "shopify");
  assert.ok(shop.items.size > 180);
  const bike = shop.items.get("BK001XS");
  assert.equal(bike.title, "Halden Aero 2 · XS");
  assert.equal(bike.section, "A1");
  assert.equal(shop.hasBarcode, false); // Shopify's inventory export has no barcodes
});

test("readExport sums a SKU listed at several locations and reports bad rows", () => {
  const csv = "SKU,On hand,Bin\nA-1,2,X\nA-1,3,X\n,1,X\nB-2,lots,X\n";
  const r = S.readExport(csv);
  assert.equal(r.items.get("A1").qty, 5);
  assert.equal(r.problems.length, 2);
});

test("readExport explains a file it can't use", () => {
  assert.throws(() => S.readExport("Name,Price\nx,1\n"), /No SKU column/);
  assert.throws(() => S.readExport("SKU,Price\nx,1\n"), /No quantity column/);
});

test("codes match without case, spaces or dashes; barcodes come from Lightspeed", () => {
  const { lookup } = S.buildCatalog(S.readExport(sample("shopify_inventory.csv")), S.readExport(sample("lightspeed_items.csv")));
  assert.equal(S.lookupCode(lookup, "bk-001-xs"), "BK001XS");
  assert.equal(S.lookupCode(lookup, "200000400002"), "BK001XS");
  assert.equal(S.lookupCode(lookup, "999"), null);
});

test("every label code scans: UPC, EAN and Lightspeed's System ID", () => {
  const { lookup } = S.buildCatalog(S.readExport(sample("shopify_inventory.csv")), S.readExport(sample("lightspeed_items.csv")));
  assert.equal(S.lookupCode(lookup, "210001"), "BK001XS"); // System ID, printed on Lightspeed labels
  const ls = S.readExport("System ID,UPC,EAN,Custom SKU,Qty.\n1,,4006381333931,A-1,2\n");
  assert.equal(S.lookupCode(S.buildCatalog(null, ls).lookup, "4006381333931"), "A1");
});

test("a label code on several items isn't guessed, and a SKU always finds its own item", () => {
  const ls = S.readExport("System ID,Manufact. SKU,Custom SKU,Qty.\n1,HX-200,HX-200-S,1\n2,HX-200,HX-200-M,1\n3,B-1,C-1,1\n4,,B-1,1\n");
  const { lookup, ambiguous } = S.buildCatalog(null, ls);
  assert.equal(S.lookupCode(lookup, "HX-200"), null);
  assert.deepEqual(ambiguous.get("HX200"), ["HX200S", "HX200M"]);
  assert.equal(S.lookupCode(lookup, "B-1"), "B1"); // B-1 is item 4's SKU, though item 3's manufacturer SKU too
});

test("readExport can read one location of a Shopify export, and lists the locations", () => {
  const csv = "Handle,SKU,Location,Bin name,On hand (current)\nh,A-1,Main St,A1,2\nh,A-1,Warehouse,W9,7\n";
  const all = S.readExport(csv);
  assert.deepEqual(all.locations, ["Main St", "Warehouse"]);
  assert.equal(all.items.get("A1").qty, 9);
  const main = S.readExport(csv, null, { location: "Main St" });
  assert.equal(main.location, "Main St");
  assert.equal(main.items.get("A1").qty, 2);
  assert.equal(main.items.get("A1").section, "A1");
  assert.equal(S.readExport(csv, null, { location: "Gone" }).items.get("A1").qty, 9); // unknown location: all of them
});

function scan(lookup, codes) {
  const scans = {};
  for (const c of codes) {
    const k = S.lookupCode(lookup, c) || "?" + c;
    scans[k] = (scans[k] || 0) + 1;
  }
  return scans;
}

test("the demo scans of A1 find the planted missing bike, extra bike, stray helmet and channel mismatch", () => {
  const { catalog, lookup } = S.buildCatalog(S.readExport(sample("shopify_inventory.csv")), S.readExport(sample("lightspeed_items.csv")));
  const codes = sample("demo_scans.txt").trim().split("\n");
  const report = S.reconcile({ catalog, section: "A1", scans: scan(lookup, codes) });
  const by = (st) => report.rows.filter((r) => r.status === st).map((r) => r.sku);
  assert.deepEqual(by("missing"), ["BK-002-S"]);
  assert.deepEqual(by("unlisted"), ["HM-099-S"]);
  assert.ok(by("count_off").includes("BK-006-XS"));
  assert.ok(report.rows.find((r) => r.sku === "BK-005-XL").channels_disagree);
  assert.equal(report.rows.find((r) => r.sku === "HM-099-S").note, "Listed in section C1");
});

test("a count matching one system but not the other is Count off, with both numbers", () => {
  const catalog = new Map([["A", { key: "A", sku: "A", barcode: "", title: "A", section: "X", shopify: { qty: 2 }, lightspeed: { qty: 3 } }]]);
  const r = S.reconcile({ catalog, section: "X", scans: { A: 2 } }).rows[0];
  assert.equal(r.status, "count_off");
  assert.equal(r.note, "Counted 2, listed 2 / 3");
  assert.equal(r.channel_note, "Shopify 2, Lightspeed 3");
});

test("items listed at zero and not found are OK, not Missing", () => {
  const catalog = new Map([["A", { key: "A", sku: "A", barcode: "", title: "A", section: "X", shopify: { qty: 0 }, lightspeed: { qty: 0 } }]]);
  assert.equal(S.reconcile({ catalog, section: "X", scans: {} }).rows[0].status, "ok");
});

test("unknown codes are Unlisted, and marked-missing items say so in the export", () => {
  const catalog = new Map([["A", { key: "A", sku: "A", barcode: "", title: "A", section: "X", shopify: { qty: 1 }, lightspeed: null }]]);
  const report = S.reconcile({ catalog, section: "X", scans: { "?123": 2 }, confirmed: new Set(["A"]) });
  assert.equal(report.summary.unlisted, 1);
  assert.equal(report.summary.missing, 1);
  const csv = S.parseCSV(S.reportCSV(report, "X")).rows;
  assert.equal(csv.find((r) => r.sku === "A").confirmed_missing, "yes");
  assert.equal(csv.find((r) => r.sku === "A").channel_note, "Only in Shopify");
  assert.equal(csv.find((r) => r.barcode === "123").note, "Not in either system");
});
