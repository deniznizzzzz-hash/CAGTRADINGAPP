// Offline end-to-end test: parse the two sample PDFs, then run processBatch
// with mocked rates, then read back the produced Excel and print summary.

const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../src/pdf-parser');
const { processBatch } = require('../src/excel-writer');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLES = path.join(ROOT, 'SAMPLES');
const OUT = path.join(ROOT, 'tmp', 'test_output');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const rates = {
  base: 'EUR',
  // 1 EUR = rates[X] of currency X
  rates: { TRY: 45.0, GBP: 0.859, USD: 1.09 },
  date: '2026-04-17',
  source: 'mock'
};

(async () => {
  const pdfFiles = [
    path.join(SAMPLES, 'Flight #1 (Mar 26).pdf'),
    path.join(SAMPLES, 'AJet - 12p.pdf')
  ];

  const parsed = [];
  for (const p of pdfFiles) {
    const buf = fs.readFileSync(p);
    const res = await parsePdf(buf, p);
    console.log('=== PARSED:', path.basename(p));
    console.log('  PNR:', res.pnr);
    console.log('  Purchase:', res.purchaseDate?.toISOString().slice(0, 10));
    console.log('  Passengers:', res.passengers);
    console.log('  Legs:');
    res.legs.forEach(l => {
      console.log('   ', l.flightNumber, l.airline,
        l.departureDate?.toISOString().slice(0, 10),
        l.departureTime,
        l.departureAirport, '→', l.arrivalAirport);
    });
    console.log('  Total:', res.totalAmount, res.currency);
    console.log('  Per pax:', res.perPassengerAmount);
    parsed.push(res);
  }

  // New-file mode (April 2026)
  const res = await processBatch({
    outputFolder: OUT,
    mode: 'new',
    newExcelMonth: { year: 2026, monthIndex: 3 },
    rates,
    parsed
  });
  console.log('\n=== processBatch result:', res);

  // Read back produced Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(res.excelPath);
  const ws = wb.getWorksheet('Flights');
  console.log('\n=== PRODUCED EXCEL (Flights) ===');
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      let v = cell.value;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (v && typeof v === 'object' && v.formula)
        v = `=${v.formula}(=${v.result})`;
      vals.push(`c${cn}=${JSON.stringify(v)}`);
    });
    console.log(`r${rn}:`, vals.join(' | '));
  });

  // Now test APPEND mode to the just-written file
  const res2 = await processBatch({
    outputFolder: OUT,
    mode: 'append',
    existingExcelPath: res.excelPath,
    rates,
    parsed: [parsed[0]] // re-add the first PDF to simulate append
  });
  console.log('\n=== APPEND mode result:', res2);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(res2.excelPath);
  const ws2 = wb2.getWorksheet('Flights');
  console.log('\n=== AFTER APPEND (Flights) last rows ===');
  for (let r = ws2.rowCount - 5; r <= ws2.rowCount; r++) {
    if (r < 1) continue;
    const row = ws2.getRow(r);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      let v = cell.value;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (v && typeof v === 'object' && v.formula)
        v = `=${v.formula}(=${v.result})`;
      vals.push(`c${cn}=${JSON.stringify(v)}`);
    });
    console.log(`r${r}:`, vals.join(' | '));
  }
})().catch(e => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
