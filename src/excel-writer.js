const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { convertToEUR } = require('./fx');

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_SHORT_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const EUR_FORMAT =
  '_-[$€-2] * #,##0.##_-;-[$€-2] * #,##0.##_-;_-[$€-2] * "-"??_-;_-@_-';
const DATE_FORMAT = 'dd/mm/yy';
const TIME_FORMAT = '@'; // text — we write "HH:MM" strings

function decimalToHhmm(d) {
  if (d == null) return null;
  const s = Number(d).toFixed(2);
  const [hStr, mStr] = s.split('.');
  return `${hStr.padStart(2, '0')}:${mStr}`;
}

// Always round UP to 2 decimals (e.g. 12.666 → 12.67, 28.43296 → 28.44).
// Values already with ≤ 2 decimals are unchanged (12.5 → 12.5, 12.66 → 12.66).
// Epsilon guards against float artifacts like 29.3 * 100 = 2930.0000000000005.
function ceilTo1Decimal(x) {
  if (x == null) return null;
  return Math.ceil(x * 100 - 1e-6) / 100;
}

// Build a fresh "Flight Table" workbook matching the sample layout.
function buildNewWorkbook(year, monthIndex) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'C.A.G. Trading';
  wb.created = new Date();

  const ws = wb.addWorksheet('Flights');
  // columns
  ws.columns = [
    { key: 'booking', width: 10.7 },
    { key: 'purchase', width: 21.2 },
    { key: 'name', width: 31.9 },
    { key: 'flightNo', width: 14.9 },
    { key: 'airline', width: 14.1 },
    { key: 'depDate', width: 16.7 },
    { key: 'depTime', width: 14.7 },
    { key: 'depAirport', width: 18.4 },
    { key: 'arrAirport', width: 16.1 },
    { key: 'amount', width: 11.5 }
  ];

  // Row 1 — month header across A1:J1, e.g. "Apr-26".
  // Written as a plain string (not a Date+numFmt) so the English month name
  // renders regardless of Excel's UI locale (Turkish Excel otherwise shows "Nis-26").
  const monthLabel = `${MONTH_SHORT_EN[monthIndex]}-${String(year).slice(-2)}`;
  const r1 = ws.getRow(1);
  for (let c = 1; c <= 10; c++) {
    const cell = r1.getCell(c);
    cell.value = monthLabel;
    cell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' }
    };
    cell.border = thinBorder();
  }
  ws.mergeCells('A1:J1');
  r1.height = 24;

  // Row 2 — column headers
  const headers = [
    'BOOKING', 'TICKET PURCHASE DATE', 'NAME', 'FLIGHT NUMBER', 'AIRLINE',
    'DEPARTURE DATE', 'DEPARTURE TIME', 'DEPARTURE AIRPORT', 'ARRIVAL AIRPORT',
    'AMOUNT'
  ];
  const r2 = ws.getRow(2);
  headers.forEach((h, i) => {
    const cell = r2.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2E75B6' }
    };
    cell.border = thinBorder();
  });
  r2.getCell(7).numFmt = TIME_FORMAT;
  r2.getCell(10).numFmt = EUR_FORMAT;
  r2.height = 32;

  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // --- Hotels sheet ---
  const hs = wb.addWorksheet('Hotels');
  hs.columns = [
    { key: 'booking', width: 10.7 },
    { key: 'purchase', width: 16 },
    { key: 'name', width: 31.9 },
    { key: 'hotel', width: 28 },
    { key: 'loc', width: 18 },
    { key: 'checkin', width: 16 },
    { key: 'checkout', width: 16 },
    { key: 'amount', width: 11.5 }
  ];
  writeMonthAndHeader(hs, monthLabel,
    ['BOOKING', 'BOOKING DATE', 'NAME', 'HOTEL NAME', 'LOCATION',
      'CHECK-IN DATE', 'CHECK-OUT DATE', 'AMOUNT'], 8);

  // --- Car sheet ---
  const cs = wb.addWorksheet('Car');
  cs.columns = [
    { key: 'booking', width: 10.7 },
    { key: 'purchase', width: 16 },
    { key: 'name', width: 31.9 },
    { key: 'company', width: 20 },
    { key: 'loc', width: 20 },
    { key: 'pickup', width: 16 },
    { key: 'return', width: 16 },
    { key: 'amount', width: 11.5 }
  ];
  writeMonthAndHeader(cs, monthLabel,
    ['BOOKING', 'BOOKING DATE', 'NAME', 'CAR COMPANY', 'LOCATION',
      'PICK UP DATE', 'RETURN DATE', 'AMOUNT'], 8);

  return wb;
}

function writeMonthAndHeader(ws, monthLabel, headers, cols) {
  const r1 = ws.getRow(1);
  for (let c = 1; c <= cols; c++) {
    const cell = r1.getCell(c);
    cell.value = monthLabel;
    cell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.border = thinBorder();
  }
  ws.mergeCells(`A1:${String.fromCharCode(64 + cols)}1`);
  r1.height = 24;

  const r2 = ws.getRow(2);
  headers.forEach((h, i) => {
    const cell = r2.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
    cell.border = thinBorder();
  });
  r2.getCell(cols).numFmt = EUR_FORMAT;
  r2.height = 32;
  ws.views = [{ state: 'frozen', ySplit: 2 }];
}

function thinBorder() {
  const side = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  return { top: side, left: side, bottom: side, right: side };
}

// Read the "state" of a Flights sheet: next flight/train numbers, next write
// row, and existing TOTAL row (if any — so we can overwrite the SUM in place).
function readFlightsState(ws) {
  let maxFlightNum = 0;
  let maxTrainNum = 0;
  let lastDataRow = 2; // header row
  let totalRow = null;
  for (let r = 3; r <= ws.rowCount; r++) {
    const bookingVal = ws.getRow(r).getCell(1).value;
    const nameVal = ws.getRow(r).getCell(3).value;
    if (typeof bookingVal === 'string') {
      const fm = bookingVal.match(/Flight\s*#(\d+)/i);
      if (fm) {
        maxFlightNum = Math.max(maxFlightNum, +fm[1]);
        lastDataRow = r;
      }
      const tm = bookingVal.match(/Train\s*#(\d+)/i);
      if (tm) {
        maxTrainNum = Math.max(maxTrainNum, +tm[1]);
        lastDataRow = r;
      }
    }
    // TOTAL row convention: I column = "TOTAL", J has SUM formula
    if (typeof bookingVal !== 'string' && typeof nameVal !== 'string') {
      const iVal = ws.getRow(r).getCell(9).value;
      if (iVal === 'TOTAL') totalRow = r;
    }
  }
  return { maxFlightNum, maxTrainNum, lastDataRow, totalRow };
}

// Style a data cell like the sample. Always writes an explicit numFmt
// (defaulting to 'General') so we never inherit stale formats from a cell
// that we are overwriting (e.g. the previous TOTAL row in append mode).
function styleDataCell(cell, opts = {}) {
  // Assign the style as a single object to avoid the stale-style-id issue
  // in exceljs when overwriting a cell that had a previous style (notably
  // the old TOTAL row in append mode).
  cell.style = {
    font: { size: 11, color: { argb: 'FF000000' }, bold: opts.bold || false },
    alignment: { horizontal: opts.horizontal || 'center', vertical: 'middle' },
    border: thinBorder(),
    numFmt: opts.numFmt || 'General'
  };
}

/**
 * Write/append flight rows.
 *
 * payload:
 *   {
 *     outputFolder,       // where to write xlsx and copy pdfs
 *     mode: 'new' | 'append',
 *     existingExcelPath?, // for 'append'
 *     newExcelMonth?: { year, monthIndex }, // for 'new'
 *     newExcelName?: string,  // for 'new' — e.g. "Flight Table April 2026.xlsx"
 *     rates,              // from fx.fetchRates()
 *     parsed: [ { filePath, pnr, purchaseDate, passengers, legs,
 *                 totalAmount, currency, perPassengerAmount } ]
 *   }
 *
 * Returns: { excelPath, renamedPdfs: [{from,to}], rowsAdded: N }
 */
async function processBatch(payload) {
  const { outputFolder, mode, rates, parsed } = payload;
  if (!outputFolder) throw new Error('outputFolder is required');
  if (!rates || !rates.rates) throw new Error('rates object is required');

  const wb = new ExcelJS.Workbook();
  let excelPath;
  if (mode === 'append') {
    if (!payload.existingExcelPath) throw new Error('existingExcelPath required');
    excelPath = payload.existingExcelPath;
    // If the existing file is outside the output folder, copy it in first.
    const existingDir = path.dirname(excelPath);
    if (path.resolve(existingDir) !== path.resolve(outputFolder)) {
      const copied = path.join(outputFolder, path.basename(excelPath));
      fs.copyFileSync(excelPath, copied);
      excelPath = copied;
    }
    await wb.xlsx.readFile(excelPath);
  } else {
    const { year, monthIndex } = payload.newExcelMonth;
    const name =
      payload.newExcelName ||
      `Flight Table ${MONTH_NAMES_EN[monthIndex]} ${year}.xlsx`;
    excelPath = path.join(outputFolder, name);
    const fresh = buildNewWorkbook(year, monthIndex);
    // transfer into wb via buffer (keeps style config)
    const buf = await fresh.xlsx.writeBuffer();
    await wb.xlsx.load(buf);
  }

  const ws = wb.getWorksheet('Flights') || wb.worksheets[0];
  const state = readFlightsState(ws);

  // Derive "(MonthName Year)" label for PDF file names from the sheet A1 header.
  // A1 is now a string like "Apr-26" (was previously a Date). Fall back to
  // payload.newExcelMonth for fresh workbooks, or filename parsing for append.
  let labelMonthIndex, labelYear;
  {
    const a1 = ws.getRow(1).getCell(1).value;
    let d = null;
    if (a1 instanceof Date) {
      d = a1;
    } else if (typeof a1 === 'string') {
      const m = a1.match(/^([A-Za-z]{3,})[-\s](\d{2}|\d{4})$/);
      if (m) {
        const mi = MONTH_SHORT_EN.findIndex(s => s.toLowerCase() === m[1].slice(0, 3).toLowerCase());
        if (mi >= 0) {
          const y = m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
          d = new Date(Date.UTC(y, mi, 1));
        }
      }
    }
    if (!d && payload.newExcelMonth) {
      d = new Date(Date.UTC(payload.newExcelMonth.year, payload.newExcelMonth.monthIndex, 1));
    }
    if (!d) d = new Date();
    labelMonthIndex = d.getUTCMonth();
    labelYear = d.getUTCFullYear();
  }
  const monthLabel = `${MONTH_NAMES_EN[labelMonthIndex]} ${String(labelYear).slice(-2)}`;

  // Write rows
  let writeRow = state.lastDataRow + 1;
  // If there's an existing TOTAL row, we'll rewrite it at the end.
  if (state.totalRow && state.totalRow >= writeRow) {
    writeRow = state.totalRow; // overwrite TOTAL row position; we'll move it later
  }

  const counters = {
    flight: state.maxFlightNum + 1,
    train: state.maxTrainNum + 1
  };
  const labels = { flight: 'Flight', train: 'Train' };
  const renamedPdfs = [];
  let rowsAdded = 0;
  const warnings = [];

  // Sort incoming bookings oldest → newest by ticket purchase date so rows
  // go top-to-bottom in chronological order. Flights and trains interleave
  // by date; each kind keeps its own #N counter (Flight #1,#2... and
  // Train #1,#2... independent of position).
  const byPurchaseDate = (a, b) => {
    const ad = a.purchaseDate ? +new Date(a.purchaseDate) : null;
    const bd = b.purchaseDate ? +new Date(b.purchaseDate) : null;
    if (ad == null && bd == null) return 0;
    if (ad == null) return 1;
    if (bd == null) return -1;
    return ad - bd;
  };
  const orderedParsed = [...parsed].sort(byPurchaseDate);

  for (const booking of orderedParsed) {
    // Skip booking entirely if we have neither passengers nor legs.
    if (!booking.passengers.length && !booking.legs.length) {
      warnings.push(
        `${path.basename(booking.filePath)}: could not be parsed (no passengers/flights), skipped.`
      );
      continue;
    }
    const kind = booking.type === 'train' ? 'train' : 'flight';
    const label = labels[kind];
    const firstNum = counters[kind];
    for (const leg of booking.legs.length ? booking.legs : [null]) {
      for (const pax of booking.passengers.length ? booking.passengers : ['']) {
        const row = ws.getRow(writeRow);
        row.getCell(1).value = `${label} #${counters[kind]}`;
        styleDataCell(row.getCell(1));
        // purchase date
        row.getCell(2).value = booking.purchaseDate || null;
        styleDataCell(row.getCell(2), { numFmt: DATE_FORMAT });
        row.getCell(3).value = pax;
        styleDataCell(row.getCell(3), { horizontal: 'left' });
        if (leg) {
          row.getCell(4).value = leg.flightNumber || null;
          row.getCell(5).value = leg.airline || null;
          row.getCell(6).value = leg.departureDate || null;
          row.getCell(7).value = decimalToHhmm(leg.departureTime);
          row.getCell(8).value = leg.departureAirport || null;
          row.getCell(9).value = leg.arrivalAirport || null;
        } else {
          for (const i of [4, 5, 6, 7, 8, 9]) row.getCell(i).value = null;
        }
        styleDataCell(row.getCell(4));
        styleDataCell(row.getCell(5));
        styleDataCell(row.getCell(6), { numFmt: DATE_FORMAT });
        styleDataCell(row.getCell(7), { numFmt: TIME_FORMAT });
        styleDataCell(row.getCell(8));
        styleDataCell(row.getCell(9));

        // Amount in EUR — split evenly across passengers × legs so each row
        // shows its share (a 2-pax × 2-leg booking gets ¼ of the total per row).
        // Empty passenger list (invoice-only PDFs) is treated as 1 so the full
        // amount still shows; the row gets a blank name cell for manual fill-in.
        let eur = null;
        if (booking.totalAmount != null) {
          const paxCount = booking.passengers.length || 1;
          const legCount = booking.legs.length || 1;
          const perRow = booking.totalAmount / (paxCount * legCount);
          try {
            eur = ceilTo1Decimal(convertToEUR(perRow, booking.currency || 'EUR', rates));
          } catch (e) {
            warnings.push(`${path.basename(booking.filePath)}: ${e.message}`);
          }
        }
        row.getCell(10).value = eur;
        styleDataCell(row.getCell(10), { horizontal: 'right', numFmt: EUR_FORMAT });
        row.commit?.();

        writeRow++;
        counters[kind]++;
        rowsAdded++;
      }
    }
    const lastNum = counters[kind] - 1;

    // Rename/copy the source PDF into the output folder
    const srcPdf = booking.filePath;
    const base =
      firstNum === lastNum
        ? `${label} #${firstNum} (${monthLabel}).pdf`
        : `${label} #${firstNum}-${lastNum} (${monthLabel}).pdf`;
    const destPdf = uniquePath(path.join(outputFolder, base));
    try {
      fs.copyFileSync(srcPdf, destPdf);
      renamedPdfs.push({ from: srcPdf, to: destPdf });
    } catch (e) {
      warnings.push(`Failed to copy ${path.basename(srcPdf)}: ${e.message}`);
    }
  }

  // Write TOTAL row
  const totalRowNum = writeRow;
  const totalRow = ws.getRow(totalRowNum);
  // blank cells A..H
  for (let c = 1; c <= 8; c++) {
    totalRow.getCell(c).value = null;
    styleDataCell(totalRow.getCell(c));
  }
  totalRow.getCell(9).value = 'TOTAL';
  styleDataCell(totalRow.getCell(9), { bold: true });
  totalRow.getCell(10).value = { formula: `SUM(J3:J${totalRowNum - 1})` };
  styleDataCell(totalRow.getCell(10), { horizontal: 'right', numFmt: EUR_FORMAT, bold: true });

  await wb.xlsx.writeFile(excelPath);

  return { excelPath, renamedPdfs, rowsAdded, warnings };
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

module.exports = {
  processBatch,
  buildNewWorkbook,
  MONTH_NAMES_EN,
  MONTH_SHORT_EN
};
