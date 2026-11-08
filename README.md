# StockSync

**Count a shelf with a barcode scanner. See what's missing, what's misplaced, and where Shopify and
Lightspeed disagree.**

**[Try it in your browser →](https://camhickling.github.io/StockSync/)** It comes with a sample shop, so
there's nothing to set up.

## Why it exists

At Bici, a bike store and online retailer in Vancouver, we sold through Lightspeed in store and Shopify
online. Every so often the systems didn't match the shelves: a product the system said we had couldn't
be found, or we went to restock the floor and the numbers were wrong.

I first built a smart spreadsheet for these recounts, then turned it into a proper tool. I used it for
several recounts of more than 200 products. **The counts were always off, often by up to 5%.**
StockSync is that tool rebuilt as open source, so any small shop selling in store and online can use it.
It uses no Bici data: the sample shop, Lantern Cycles, is made up.

## What it does

1. **Load your exports:** Shopify's inventory export and Lightspeed's item export (CSV). Both are read
   in your browser and never uploaded.
2. **Pick a section,** such as one shelf or bin.
3. **Scan everything on it.** Barcode scanners type like a keyboard, so any USB or Bluetooth scanner
   works, and you can also type a barcode or SKU.
4. **Read the report as you go,** then export it as a CSV.

| Status | Means | What to do |
|---|---|---|
| **Missing** | Listed in this section, but not scanned | Look again, then **Mark missing** |
| **Unlisted** | Scanned, but not listed in this section (or in either system) | Move it to its real section, or fix its bin |
| **Count off** | Scanned a different number than a system lists | Correct the count in that system |
| **Channels disagree** | Shopify and Lightspeed list different stock for the same item, or only one lists it | Fix the system that's wrong, before it oversells online |

The counts are saved in your browser as you go, so a closed tab or a refresh doesn't lose a
half-counted shelf.

## Decisions

| Decision | Why |
|---|---|
| Runs in the browser from the stores' own exports, with no login or API keys | Anyone on the floor can use it today, and store data stays on their computer |
| Compares the shelf with **both** systems at once | The costly problem is the two channels drifting apart, not just a miscount |
| Matches by SKU across systems, and by barcode or SKU when scanning | Shopify's inventory export has no barcodes; Lightspeed's has UPCs, so between them every scan resolves |
| Scans that don't match are kept and reported, never ignored | An unknown barcode on the shelf is itself a finding |
| "Missing" needs a person to confirm it | An item not scanned yet isn't the same as an item that's gone |
| One section at a time | Matches how recounts actually happen: one shelf, one person, a few minutes |

## Using it with your store's files

- **Shopify:** Products › Inventory › Export. StockSync uses `SKU`, `On hand (current)` (or
  `Available`) and `Bin name` for the section.
- **Lightspeed:** export your items as CSV. StockSync uses `Custom SKU`, `UPC` and `Qty.`, and `Bin` if
  there is one.

Columns are found by name, and StockSync also accepts `SKU`, `Barcode`, `Quantity`, `Section` and
similar. If a file can't be used, it says which column is missing. **The column names are based on the
two systems' export formats and are tested with the sample files.** If your export looks different,
please [open an issue](https://github.com/CamHickling/StockSync/issues) with its header row.

## How I built it

I built StockSync with an AI coding agent, Claude Code, working as its product manager:

- **I wrote the brief:** the problem from Bici, the four statuses, and what a store employee needs on
  the floor.
- **I made the product decisions** in the table above.
- **The agent wrote the code, the tests and the sample data.** I reviewed the results in the browser
  on desktop, phone and dark mode.

The core logic is covered by tests, including a scripted recount of the sample shop that checks every
planted problem is found. The first version took one working session.

## Roadmap

- **Live inventory from a Shopify development store** through the Admin API, via a small local script
  so the access token never reaches the browser
- Count history over time: which sections drift, and how fast
- Multiple counters on one section

## Development

No build step and no dependencies: open `index.html`, or serve the folder.

```bash
npm test                              # tests (Node 18+)
node scripts/make-sample-data.js      # regenerate the sample shop
```

- `src/reconcile.js` holds the logic (CSV reading, matching, the report) and is shared by the page and
  the tests.
- `src/app.js` is the page.
- `sample/PLANTED.md` lists the mismatches planted in the sample data.

Licensed under the [Apache License 2.0](LICENSE). Not affiliated with Shopify, Lightspeed or Bici.
