// Makes the sample data for Lantern Cycles, a fictional bike shop: a Shopify-style inventory
// export, a Lightspeed-style item export, and a list of demo scans. Seeded, so every run gives
// the same files. Brands, products, barcodes and the shop are all made up.
//
//   node scripts/make-sample-data.js
//
// Writes sample/shopify_inventory.csv, sample/lightspeed_items.csv, sample/demo_scans.txt and
// sample/sample-data.js (the same data, so the page can load it when opened from disk).

const fs = require("fs");
const path = require("path");
const { toCSV } = require("../src/reconcile.js");

let seed = 20261107;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// UPC-A with a valid check digit, in the 2xxxxx range that stores use for their own codes.
let upcSerial = 40000;
function upc() {
  const d = ("2" + String(upcSerial++).padStart(10, "0")).split("").map(Number);
  const sum = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return d.join("") + ((10 - (sum % 10)) % 10);
}

const BIKE = ["XS", "S", "M", "L", "XL"];
const SECTIONS = {
  A1: { cat: "BK", brands: ["Halden", "Vantis"], models: ["Aero 2", "Strada", "Gravelline", "Loam GX"], sizes: BIKE, qty: [0, 2] },
  A2: { cat: "MT", brands: ["Torvik", "Pellora"], models: ["Ridge 29", "Switchback", "Cairn", "Cairn Pro"], sizes: BIKE, qty: [0, 2] },
  A3: { cat: "CT", brands: ["Ostro", "Fennick"], models: ["Commuter 7", "Volt City", "Volt Cargo", "Volt Step-through"], sizes: ["S", "M", "L"], qty: [0, 2] },
  A4: { cat: "KD", brands: ["Pellora"], models: ["Sprout 16", "Sprout 20", "Scout 24", "Balance 12"], sizes: ["Red", "Blue"], qty: [0, 3] },
  B1: { cat: "TR", brands: ["Gripwell", "Torvik"], models: ["Road 700x25", "Road 700x28", "Road 700x32", "Gravel 700x38", "Gravel 700x45", "Trail 29x2.4", "Trail 29x2.6", "Trail 27.5x2.4", "City 700x35", "City 700x40", "Kids 20x1.75", "Kids 16x1.95"], sizes: [""], qty: [2, 12] },
  B2: { cat: "TB", brands: ["Gripwell"], models: ["700x23-28 Presta", "700x28-35 Presta", "700x35-45 Schrader", "29x2.1-2.5 Presta", "27.5x2.1-2.5 Presta", "26x1.9-2.3 Schrader", "20x1.75 Schrader", "16x1.95 Schrader"], sizes: [""], qty: [4, 25] },
  B3: { cat: "BR", brands: ["Stopwell", "Halden"], models: ["Disc pads resin", "Disc pads metal", "Rotor 160", "Rotor 180", "Rotor 203", "Rim pads"], sizes: [""], qty: [2, 14] },
  B4: { cat: "DR", brands: ["Stopwell"], models: ["Chain 11-speed", "Chain 12-speed", "Chain 9-speed", "Cassette 11-34", "Cassette 10-51", "Cassette 11-42", "Chainring 32T", "Chainring 34T", "Quick link 11", "Quick link 12", "Derailleur hanger A", "Derailleur hanger B"], sizes: [""], qty: [1, 10] },
  C1: { cat: "HM", brands: ["Ostro", "Vantis"], models: ["Urban", "Road Air", "Trail MIPS", "Kids Mini"], sizes: ["S", "M", "L"], qty: [0, 5] },
  C2: { cat: "LT", brands: ["Beamline"], models: ["Front 400", "Front 800", "Front 1200", "Rear 50", "Rear 150", "Rear radar", "Set 400/50", "Helmet light", "Spoke lights"], sizes: [""], qty: [1, 9] },
  C3: { cat: "LK", brands: ["Holdfast"], models: ["U-lock mini", "U-lock standard", "U-lock + cable", "Folding lock", "Chain 90", "Chain 120", "Cable 180"], sizes: [""], qty: [1, 8] },
  D1: { cat: "BT", brands: ["Fennick"], models: ["Bottle 620 ml", "Bottle 750 ml", "Insulated 600", "Kids bottle 400", "Cage alloy", "Cage carbon", "Cage side-load", "Cage mount adapter"], sizes: [""], qty: [3, 20] },
  D2: { cat: "TL", brands: ["Stopwell", "Beamline"], models: ["Multitool 12", "Multitool 18", "Mini pump", "Floor pump", "CO2 inflator", "Chain lube dry", "Chain lube wet", "Degreaser", "Tire levers", "Patch kit", "Torque wrench", "Chain checker"], sizes: [""], qty: [2, 15] },
  D3: { cat: "GL", brands: ["Vantis"], models: ["Summer short", "Winter full", "Trail full"], sizes: ["S", "M", "L", "XL"], qty: [0, 6] },
  E1: { cat: "SD", brands: ["Halden"], models: ["Saddle road 143", "Saddle road 155", "Saddle comfort", "Saddle trail", "Seatpost 27.2", "Seatpost 30.9", "Dropper 31.6", "Seat clamp"], sizes: [""], qty: [1, 6] },
  E2: { cat: "PD", brands: ["Torvik"], models: ["Flat pedals alloy", "Flat pedals nylon", "Clip pedals road", "Clip pedals trail", "Cleats road", "Cleats trail"], sizes: [""], qty: [1, 8] },
  E3: { cat: "BG", brands: ["Ostro", "Fennick"], models: ["Saddle bag S", "Saddle bag M", "Frame bag", "Top tube bag", "Handlebar bag", "Pannier 20 L", "Pannier pair", "Phone mount", "Rack rear", "Basket front"], sizes: [""], qty: [1, 7] },
  E4: { cat: "JR", brands: ["Vantis"], models: ["Jersey classic", "Jersey trail", "Rain jacket"], sizes: ["S", "M", "L", "XL"], qty: [0, 5] },
};

const items = [];
let n = 0;
for (const [bin, s] of Object.entries(SECTIONS)) {
  for (const model of s.models) {
    const brand = pick(s.brands);
    const handle = `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
    for (const size of s.sizes) {
      n++;
      items.push({
        handle,
        title: `${brand} ${model}`,
        size,
        sku: `${s.cat}-${String(n).padStart(3, "0")}${size ? "-" + size : ""}`,
        upc: upc(),
        bin,
        qty: int(s.qty[0], s.qty[1]),
        systemId: 210000 + n,
      });
    }
  }
}

// Planted problems between the two systems.
const shopifyQty = new Map(items.map((it) => [it.sku, it.qty]));
const lightspeedQty = new Map(items.map((it) => [it.sku, it.qty]));
const onlyLightspeed = new Set();
const onlyShopify = new Set();
const planted = [];

// The demo section: A1 gets one item where the channels disagree.
const a1 = items.filter((it) => it.bin === "A1");
const a1Disagree = a1[4];
lightspeedQty.set(a1Disagree.sku, a1Disagree.qty + 1);
planted.push(`${a1Disagree.sku}: Lightspeed lists one more than Shopify`);

// Elsewhere: quantity differences, and items listed in only one system.
const others = items.filter((it) => it.bin !== "A1");
for (let i = 0; i < 9; i++) {
  const it = others[(i * 17 + 3) % others.length];
  const delta = pick([-2, -1, 1, 2]);
  lightspeedQty.set(it.sku, Math.max(0, it.qty + delta));
  if (lightspeedQty.get(it.sku) !== shopifyQty.get(it.sku)) planted.push(`${it.sku}: Shopify ${shopifyQty.get(it.sku)}, Lightspeed ${lightspeedQty.get(it.sku)}`);
}
// Each planted problem uses its own item.
const used = new Set(items.filter((it) => lightspeedQty.get(it.sku) !== shopifyQty.get(it.sku)).map((it) => it.sku));
const fresh = (i) => { let j = i % others.length; while (used.has(others[j].sku)) j = (j + 1) % others.length; used.add(others[j].sku); return others[j]; };
for (const i of [31, 88]) { const it = fresh(i); onlyLightspeed.add(it.sku); planted.push(`${it.sku}: only in Lightspeed`); }
{ const it = fresh(140); onlyShopify.add(it.sku); planted.push(`${it.sku}: only in Shopify`); }

const shopifyRows = items.filter((it) => !onlyLightspeed.has(it.sku)).map((it) => ({
  "Handle": it.handle,
  "Title": it.title,
  "Option1 Name": it.size ? "Size" : "Title",
  "Option1 Value": it.size || "Default Title",
  "Option2 Name": "", "Option2 Value": "", "Option3 Name": "", "Option3 Value": "",
  "SKU": it.sku,
  "HS Code": "", "COO": "",
  "Location": "Lantern Cycles",
  "Bin name": it.bin,
  "Incoming (not editable)": 0,
  "Unavailable (not editable)": 0,
  "Committed (not editable)": 0,
  "Available (not editable)": shopifyQty.get(it.sku),
  "On hand (current)": shopifyQty.get(it.sku),
  "On hand (new)": shopifyQty.get(it.sku),
}));
const shopifyHeaders = Object.keys(shopifyRows[0]);

const lightspeedRows = items.filter((it) => !onlyShopify.has(it.sku)).map((it) => ({
  "System ID": it.systemId,
  "UPC": it.upc,
  "EAN": "",
  "Custom SKU": it.sku,
  "Manufact. SKU": "",
  "Description": it.title + (it.size ? " " + it.size : ""),
  "Qty.": lightspeedQty.get(it.sku),
  "Bin": it.bin,
}));
const lightspeedHeaders = Object.keys(lightspeedRows[0]);

// Demo scans for section A1: every bike on the shelf, except
//  - one listed bike that isn't there (Missing),
//  - one bike counted once more than listed (Count off),
//  - a helmet left on the bike shelf (Unlisted).
const inStock = a1.filter((it) => it.qty > 0 && it !== a1Disagree);
const missingBike = inStock[1];
const extraBike = inStock[3];
const helmet = items.find((it) => it.bin === "C1" && it.qty > 0);
const scans = [];
for (const it of a1) {
  if (it === missingBike) continue;
  const count = it === extraBike ? it.qty + 1 : it === a1Disagree ? a1Disagree.qty : it.qty;
  for (let i = 0; i < count; i++) scans.push(it.upc);
}
scans.splice(3, 0, helmet.upc);
planted.push(`Demo scans of A1: ${missingBike.sku} missing, ${extraBike.sku} one extra, ${helmet.sku} (a helmet) on the wrong shelf`);

const out = path.join(__dirname, "..", "sample");
fs.mkdirSync(out, { recursive: true });
const shopifyCSV = toCSV(shopifyHeaders, shopifyRows);
const lightspeedCSV = toCSV(lightspeedHeaders, lightspeedRows);
fs.writeFileSync(path.join(out, "shopify_inventory.csv"), shopifyCSV);
fs.writeFileSync(path.join(out, "lightspeed_items.csv"), lightspeedCSV);
fs.writeFileSync(path.join(out, "demo_scans.txt"), scans.join("\n") + "\n");
fs.writeFileSync(path.join(out, "PLANTED.md"),
  "# What's planted in the sample data\n\nLantern Cycles is fictional. Generated by `scripts/make-sample-data.js`.\n\n" +
  planted.map((p) => "- " + p).join("\n") + "\n");
fs.writeFileSync(path.join(out, "sample-data.js"),
  "// Generated by scripts/make-sample-data.js. The sample CSVs, so the page can load them from disk.\n" +
  "window.STOCKSYNC_SAMPLE = " + JSON.stringify({ shop: "Lantern Cycles", shopify: shopifyCSV, lightspeed: lightspeedCSV, demoSection: "A1", demoScans: scans }) + ";\n");
console.log(`${items.length} items; Shopify ${shopifyRows.length} rows, Lightspeed ${lightspeedRows.length} rows; ${scans.length} demo scans`);
planted.forEach((p) => console.log("  " + p));
