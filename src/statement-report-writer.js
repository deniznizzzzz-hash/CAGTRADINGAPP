// Builds an Excel workbook that summarises how well the ticket PDFs match
// the statement PDFs. Four sheets:
//
//   1. "Summary"             — overview / counts
//   2. "Matches"             — ticket + statement line, scores all 3 checks
//   3. "Unmatched Tickets"   — tickets that had no 2-of-3 statement line
//   4. "Unmatched Charges"   — statement debits that no ticket claimed
//

const path = require('path');
const ExcelJS = require('exceljs');

function thinBorder() {
  const side = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  return { top: side, left: side, bottom: side, right: side };
}

function headerCell(cell, text) {
  cell.value = text;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  cell.border = thinBorder();
}

function dataCell(cell, value, opts = {}) {
  cell.value = value;
  cell.style = {
    font: { size: 11, color: { argb: 'FF000000' } },
    alignment: { horizontal: opts.horizontal || 'left', vertical: 'middle', wrapText: true },
    border: thinBorder(),
    numFmt: opts.numFmt || 'General',
    fill: opts.fill || undefined
  };
}

const PASS_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFF5D0' } }; // green
const FAIL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAD4D4' } }; // red
const WARN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFECB3' } }; // amber

function formatDate(d) {
  if (!d) return null;
  const dd = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(+dd)) return null;
  const day = String(dd.getUTCDate()).padStart(2, '0');
  const mon = String(dd.getUTCMonth() + 1).padStart(2, '0');
  const yr = String(dd.getUTCFullYear()).slice(-2);
  return `${day}/${mon}/${yr}`;
}

function ticketAirlines(ticket) {
  const set = new Set();
  for (const leg of ticket.legs || []) {
    if (leg.airline) set.add(leg.airline);
  }
  return Array.from(set).join(' / ');
}

function ticketPassengers(ticket) {
  return (ticket.passengers || []).join(', ');
}

async function writeStatementReport({ outputFolder, outputName, results, statementMeta }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'C.A.G. Trading';
  wb.created = new Date();

  const { matches, unmatchedTickets, unmatchedTxns } = results;

  // ---- Sheet 1: Matches
  const ws1 = wb.addWorksheet('Matches');
  ws1.columns = [
    { width: 16 }, { width: 14 }, { width: 28 }, { width: 18 },
    { width: 14 }, { width: 8 }, { width: 14 }, { width: 14 },
    { width: 8 }, { width: 14 }, { width: 8 },
    { width: 38 }, { width: 10 }, { width: 10 }, { width: 10 }
  ];
  const h1 = ws1.getRow(1);
  [
    'TICKET FILE', 'PURCHASE DATE', 'PASSENGERS', 'AIRLINE',
    'TICKET AMOUNT', 'CCY', 'STATEMENT DATE', 'STATEMENT AMOUNT', 'CCY',
    'FOREIGN AMOUNT', 'CCY',
    'STATEMENT DESCRIPTION', 'DATE', 'AMOUNT', 'MERCHANT'
  ].forEach((h, i) => headerCell(h1.getCell(i + 1), h));
  h1.height = 32;
  ws1.views = [{ state: 'frozen', ySplit: 1 }];

  matches.forEach((m, i) => {
    const r = ws1.getRow(i + 2);
    const t = m.ticket;
    const x = m.txn;
    dataCell(r.getCell(1), path.basename(t.filePath || ''));
    dataCell(r.getCell(2), formatDate(t.purchaseDate), { horizontal: 'center' });
    dataCell(r.getCell(3), ticketPassengers(t));
    dataCell(r.getCell(4), ticketAirlines(t));
    dataCell(r.getCell(5), t.totalAmount ?? null, { horizontal: 'right', numFmt: '#,##0.##' });
    dataCell(r.getCell(6), t.currency || '', { horizontal: 'center' });
    dataCell(r.getCell(7), formatDate(x.date), { horizontal: 'center' });
    dataCell(r.getCell(8), x.amount, { horizontal: 'right', numFmt: '#,##0.##' });
    dataCell(r.getCell(9), x.currency || '', { horizontal: 'center' });
    dataCell(r.getCell(10), x.foreignAmount ?? null, { horizontal: 'right', numFmt: '#,##0.##' });
    dataCell(r.getCell(11), x.foreignCurrency || '', { horizontal: 'center' });
    dataCell(r.getCell(12), x.description);
    dataCell(r.getCell(13), m.hitDate ? '✓' : '✗', { horizontal: 'center', fill: m.hitDate ? PASS_FILL : FAIL_FILL });
    dataCell(r.getCell(14), m.hitAmount ? '✓' : '✗', { horizontal: 'center', fill: m.hitAmount ? PASS_FILL : FAIL_FILL });
    dataCell(r.getCell(15), m.hitMerchant ? '✓' : '✗', { horizontal: 'center', fill: m.hitMerchant ? PASS_FILL : FAIL_FILL });
  });

  // ---- Sheet 2: Unmatched tickets (POTENTIAL MONEY LOSS — show prominently)
  const ws2 = wb.addWorksheet('Unmatched Tickets');
  ws2.columns = [
    { width: 18 }, { width: 14 }, { width: 28 }, { width: 18 },
    { width: 14 }, { width: 8 }, { width: 60 }
  ];
  const h2 = ws2.getRow(1);
  [
    'TICKET FILE', 'PURCHASE DATE', 'PASSENGERS', 'AIRLINE',
    'AMOUNT', 'CCY', 'NOTE'
  ].forEach((h, i) => headerCell(h2.getCell(i + 1), h));
  h2.height = 32;
  ws2.views = [{ state: 'frozen', ySplit: 1 }];

  unmatchedTickets.forEach((t, i) => {
    const r = ws2.getRow(i + 2);
    dataCell(r.getCell(1), path.basename(t.filePath || ''), { fill: WARN_FILL });
    dataCell(r.getCell(2), formatDate(t.purchaseDate), { horizontal: 'center', fill: WARN_FILL });
    dataCell(r.getCell(3), ticketPassengers(t), { fill: WARN_FILL });
    dataCell(r.getCell(4), ticketAirlines(t), { fill: WARN_FILL });
    dataCell(r.getCell(5), t.totalAmount ?? null, { horizontal: 'right', numFmt: '#,##0.##', fill: WARN_FILL });
    dataCell(r.getCell(6), t.currency || '', { horizontal: 'center', fill: WARN_FILL });
    dataCell(r.getCell(7), 'No matching card charge found on the statement — verify manually.', { fill: WARN_FILL });
  });

  // ---- Sheet 3: Unmatched statement debits (txns no ticket claimed)
  const ws3 = wb.addWorksheet('Unmatched Charges');
  ws3.columns = [
    { width: 14 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 60 }
  ];
  const h3 = ws3.getRow(1);
  [
    'DATE', 'AMOUNT', 'CCY', 'FOREIGN AMOUNT', 'FOREIGN CCY', 'DESCRIPTION'
  ].forEach((h, i) => headerCell(h3.getCell(i + 1), h));
  h3.height = 32;
  ws3.views = [{ state: 'frozen', ySplit: 1 }];

  unmatchedTxns.forEach((x, i) => {
    const r = ws3.getRow(i + 2);
    dataCell(r.getCell(1), formatDate(x.date), { horizontal: 'center' });
    dataCell(r.getCell(2), x.amount, { horizontal: 'right', numFmt: '#,##0.##' });
    dataCell(r.getCell(3), x.currency || '', { horizontal: 'center' });
    dataCell(r.getCell(4), x.foreignAmount ?? null, { horizontal: 'right', numFmt: '#,##0.##' });
    dataCell(r.getCell(5), x.foreignCurrency || '', { horizontal: 'center' });
    dataCell(r.getCell(6), x.description);
  });

  // ---- Sheet 4: Summary (first tab so user sees it on open)
  const ws0 = wb.addWorksheet('Summary', { state: 'visible' });
  // Reorder so Summary is first.
  wb.worksheets = [ws0, ws1, ws2, ws3];

  ws0.columns = [{ width: 36 }, { width: 26 }];
  let row = 1;
  const addRow = (label, value) => {
    const r = ws0.getRow(row++);
    const c1 = r.getCell(1);
    c1.value = label;
    c1.font = { bold: true };
    r.getCell(2).value = value;
  };
  addRow('C.A.G. Trading — Statement Check', '');
  row++;
  if (statementMeta) {
    addRow('Bank', statementMeta.banks?.join(', ') || '');
    addRow('Statement period', statementMeta.periodLabel || '');
    addRow('Statement files', statementMeta.statementCount ?? '');
    addRow('Ticket files', statementMeta.ticketCount ?? '');
    row++;
  }
  addRow('Matched tickets', matches.length);
  addRow('Unmatched tickets', unmatchedTickets.length);
  addRow('Unmatched card charges', unmatchedTxns.length);

  // Write file
  const finalName = outputName || `Statement Report ${new Date().toISOString().slice(0, 10)}.xlsx`;
  const excelPath = path.join(outputFolder, finalName);
  await wb.xlsx.writeFile(excelPath);
  return excelPath;
}

module.exports = { writeStatementReport };
