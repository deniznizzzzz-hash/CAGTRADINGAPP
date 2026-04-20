# C.A.G. Trading — Flight PDF → Excel Converter

Windows Electron desktop app. Parses airline-confirmation/invoice PDFs, collects passenger+leg+price data, appends rows to a monthly "Flight Table" Excel workbook, and copies the source PDFs to the output folder renamed as `Flight #N (Month YY).pdf`.

- Stack: Electron 31 + exceljs 4 + pdf-parse 1. Build: `electron-builder` NSIS Windows installer (see `package.json` `build` field).
- Entry: `main.js` (main process), `preload.js` (contextBridge), `src/renderer.js` (UI), `src/index.html`.
- Core modules: `src/pdf-parser.js`, `src/excel-writer.js`, `src/airports.js`, `src/fx.js`.
- Run: `npm run start`. Build installer: `npm run dist` → `dist/C.A.G. Trading Setup X.Y.Z.exe`.
- Current version: see `package.json` (v1.0.23 at time of this doc).

## Pipeline

1. User enters **TRY** and **GBP** rates manually (1 EUR = N TRY/GBP), picks output folder, mode ("new" workbook or "append" to existing), adds PDFs.
2. `renderer.js` → IPC `parse-pdf` per PDF → `parsePdf(buf)` in `pdf-parser.js`.
3. `parsePdf` runs pdf-parse, detects which airline/format the PDF is, dispatches to the right `extract*` function, returns a normalized shape:
   ```
   { pnr, purchaseDate, passengers: [names], legs: [...], totalAmount, currency, perPassengerAmount }
   ```
4. `excel-writer.processBatch` sorts bookings by `purchaseDate` ASC, writes rows (one row per passenger × leg), assigns `Flight #N` sequentially, computes `amount` in EUR, rewrites `TOTAL` SUM row at the bottom. Copies source PDFs into output folder with new names.

## Supported airline extractors (in `src/pdf-parser.js`)

Dispatch order (first match wins) at the bottom of `parsePdf`:

- `isAJet` → `extractAJet` — AJet (SunExpress/AnadoluJet) booking confirmation. Handles multi-leg + connections.
- `isPegasusSales` → `extractPegasusSales` — Pegasus Airlines sales invoice.
- `isBrusselsAirlinesETicket` → `extractBrusselsAirlinesETicket` — Brussels Airlines e-ticket.
- `isBrusselsAirlines` → `extractBrusselsAirlines` — Brussels Airlines invoice.
- `isTHYeTicket` → `extractTHYeTicket` — Turkish Airlines e-ticket.
- `isEurowings` → `extractEurowings` — Eurowings.
- `isKLMInvoice` → `extractKLMInvoice` — KLM / Air France invoice.
- `isEasyJetPayment`, `isEasyJetBooking` → EasyJet (two format variants).
- `isFinnair` → `extractFinnair` — Finnair.
- `isWizzAirInvoice` → `extractWizzAirInvoice` — Wizz Air Malta tax invoice. **Single-leg only** — route `Flight ticket (CRL-IAS)`. Round-trip handling was attempted and reverted per user request (v1.0.22).
- `isRyanairItinerary`, `isRyanairInvoice` → Ryanair (website PDF vs tax invoice).
- `isSunExpress` → `extractSunExpress` — SunExpress direct booking, multi-leg round-trip supported.
- `isKiwiTicket` → `extractKiwiTicket` — Kiwi.com Turkish e-ticket. Aggregator, airline varies (SunExpress, etc.).

Text from pdf-parse often has stray mid-word spaces (font kerning). Each extractor de-artifacts locally — e.g. `REZER VASYON` → `REZERVASYON`, `Charler oi` → `Charleroi`, `E skişehir` → `Eskişehir`.

IATA → city mapping in `src/airports.js`. When adding a new airport, ensure the 3-letter code is present — missing codes cause the "first-N-IATAs" fallback in AJet/SunExpress extractors to pick the wrong airport (notable past bug: COV missing → Çukurova misread as Sabiha Gökçen).

## Excel writer (`src/excel-writer.js`) — important conventions

- Sheet layout: row 1 merged month label (`Apr-26`), row 2 headers, row 3+ data, last row = `TOTAL` with `SUM(J3:J{last})` formula.
- **Amount format**: `#,##0.0` (1 decimal). Amounts **always round UP** via `ceilTo1Decimal(x)` — e.g. 29.01 → 29.1, 12.66 → 12.7. Epsilon guard (`x * 10 - 1e-6`) avoids float artifacts.
- **Departure Time**: stored as text string `"HH:MM"` (cell numFmt `'@'`). `decimalToHhmm(12.25)` → `"12:25"`.
- **Date**: `dd/mm/yy`.
- **Sorting**: incoming bookings sorted by `purchaseDate` ASC before writing; bookings without date sink to bottom. `Flight #N` numbering follows sort order (oldest = lowest N).
- **Per-row amount**: `totalAmount / (paxCount × legCount)` → convert to EUR via `convertToEUR(perRow, currency, rates)` → `ceilTo1Decimal`. Empty passenger list (invoice-only PDFs) counts as 1 so full amount still shows; name cell left blank for manual fill-in.
- **Hotels / Car sheets**: created alongside Flights on new workbooks but not written by the converter — placeholder tabs for manual entry.

## FX rates

Manual input only. TRY/GBP entered in UI as `1 EUR = N TRY` / `1 EUR = N GBP`. Persisted in `localStorage`. `fx.js` `convertToEUR(amount, currency, rates)` divides by the rate. Previous auto-fetch from an external API was removed per user request (v1.0.20).

## UI (`src/index.html` + `src/renderer.js`)

- Dark theme, 5 cards: Rates → Excel Mode → Output Folder → PDFs → Process.
- Rate inputs are `<input type="text" inputmode="decimal">` — **not** `type="number"` (number-spinner behavior blocked typing on some Windows setups, fixed in v1.0.21).
- Rate inputs use `<div class="rate-field"><label for="id">...</label><input>...</div>` structure — **not** `<label>` wrapping `<input>`. Label-click interception can swallow focus in packaged Electron (fixed in v1.0.22).

## Build / release

```
npm run dist
```

Outputs to `dist/C.A.G. Trading Setup <version>.exe`. Bump `package.json` `version` before building. Close the running app before rebuilding (electron-builder will fail with "Access is denied" if the exe is locked).

## Testing

`tests/` contains one-off inspection scripts (`inspect_<sample>.js`) that read a PDF, call `parsePdf`, and dump the raw text preview + parsed JSON. Pattern:
```js
const buf = fs.readFileSync('C:/.../SAMPLES/xxx.pdf');
const r = await parsePdf(buf, 'auto');
console.log(r.rawTextPreview);
console.log(JSON.stringify(r, null, 2));
```
Sample PDFs live in `../SAMPLES/` and `../DENEME/` (NOT in the repo — customer data).

When diagnosing a parsing bug: write a new inspect script, look at raw text, identify the de-artifact patterns or regex that needs to match, adjust the relevant extractor.

## Notable past decisions (don't re-litigate)

- **Wizz Air round-trip / online lookup**: user decided NOT to handle. Wizz invoice has only PNR — no free API, scraping against ToS. Single-leg extraction only.
- **Connection-merging** (`collapseConnections`): when two consecutive legs share airport (A→B, B→C) on same day → collapses into one row A→C with flight numbers joined by `/`. Round-trip guard (A→B, B→A) was added then reverted per user request (v1.0.22) — bookings with same-day A→B→A now get merged into A→A, which user accepted.
- **Departure time format**: text `"HH:MM"` not decimal `12,25` — applied globally (v1.0.20).
- **Amount rounding**: always UP to 1 decimal (v1.0.23).
- **Row order**: by ticket purchase date ASC (v1.0.23).

## What's NOT in this repo

- `node_modules/` (install with `npm install`)
- `dist/` (build output)
- `SAMPLES/`, `DENEME/` (customer PDFs — private, kept only on Deniz's PC)
- Prior Claude conversation transcripts (local to the PC where they were recorded)
