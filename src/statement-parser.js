// Parses bank/credit-card statements into a normalized transaction list.
//
// Returns: { bank, statementPeriod: {from, to}, currency, transactions: [...] }
// Each transaction:
//   {
//     date: Date (UTC midnight),
//     description: string (merchant / raw description text),
//     amount: number (positive = debit / spending),
//     currency: string ('GBP' | 'EUR' | ...),
//     // if the purchase was originally in a different currency than
//     // the statement and an FX conversion is shown, these are populated:
//     foreignAmount: number | null,
//     foreignCurrency: string | null,
//     // 'debit' for spending, 'credit' for payments/refunds received.
//     direction: 'debit' | 'credit',
//     // internal: lets the matcher show raw context if needed.
//     raw: string
//   }

const pdfParse = require('pdf-parse');

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

function monthIndex(s) {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  return MONTH_ABBR[k] != null ? MONTH_ABBR[k] : null;
}

function parseMoney(raw) {
  if (raw == null) return NaN;
  let s = String(raw).replace(/\s/g, '').replace(/[\u00a0\u202f]/g, '');
  // Allow "1,810.64" or "1.810,64" or "1810.64"
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // last separator is decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // only comma: if exactly 2 digits after last comma treat as decimal,
    // else treat as thousands separator
    const tail = s.split(',').pop();
    s = tail.length === 2 ? s.replace(/,/g, m => m === s.slice(-3, -2) ? '.' : '') : s.replace(/,/g, '');
    // simpler robust fallback for single-comma decimals:
    if (!/^\d+\.\d+$/.test(s)) {
      const parts = String(raw).replace(/\s/g, '').split(',');
      if (parts.length === 2 && parts[1].length === 2) {
        s = parts[0].replace(/\./g, '') + '.' + parts[1];
      } else {
        s = String(raw).replace(/\s/g, '').replace(/,/g, '');
      }
    }
  }
  return parseFloat(s);
}

// ---------- AMERICAN EXPRESS (UK) ----------
//
// Header has a period like "From 16February to15March2026" and a card
// footer line like "CAVIT CAN CAGxxxx-xxxxxx-6100115/03/26".
//
// Transaction lines look like:   "Feb19Feb19SUNEXPRESSIBS           Antalya"
// ("TransactionDate" + "ProcessDate" glued, then merchant description).
//
// Amounts appear later on the same page(s) as a column of numbers in the
// same order as the transactions. The *previous closing balance* (a credit)
// is the first amount; we drop it via the leading "CR" marker above the
// PAYMENT RECEIVED line.

function isAmex(text) {
  return /American\s+Express/i.test(text) && /americanexpress\.co\.uk/i.test(text);
}

function extractAmex(text) {
  // Statement year: "15/03/26" → 2026; "15March2026" → 2026; also "April2026".
  let year = null;
  const yearMatch =
    text.match(/\d{1,2}\/\d{1,2}\/(\d{2})/) ||
    text.match(/(\d{4})/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    year = y < 100 ? 2000 + y : y;
  }

  // Statement period: "From 16February to15March2026"
  let periodFrom = null, periodTo = null;
  const pm = text.match(/From\s+(\d{1,2})([A-Za-z]+)\s*to\s*(\d{1,2})([A-Za-z]+)\s*(\d{4})/);
  if (pm) {
    const fromMi = monthIndex(pm[2]);
    const toMi = monthIndex(pm[4]);
    const toY = parseInt(pm[5], 10);
    // "From 16 February to 15 March 2026" — the "from" year may be the prior
    // year if the period wraps across a year boundary; assume same year here
    // since wrapping is rare for a month-long statement.
    if (fromMi != null) periodFrom = new Date(Date.UTC(toY, fromMi, +pm[1]));
    if (toMi != null) periodTo = new Date(Date.UTC(toY, toMi, +pm[3]));
  }

  // Walk the raw text line-by-line.
  const lines = text.split('\n').map(l => l.trim());

  const monthAbbr = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const txnRe = new RegExp(`^${monthAbbr}(\\d{1,2})${monthAbbr}(\\d{1,2})(.+)$`);

  // Pass 1: collect transaction lines in document order.
  const txns = [];
  let creditFlag = false;
  const txnLineIdx = []; // index in `lines` where each transaction was found

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^CR$/.test(line)) { creditFlag = true; continue; }

    const m = line.match(txnRe);
    if (m) {
      const mi = monthIndex(m[1]);
      const day = +m[2];
      if (mi != null && year != null) {
        txns.push({
          description: m[5].trim(),
          txnDate: new Date(Date.UTC(year, mi, day)),
          isCredit: creditFlag || /PAYMENT RECEIVED/i.test(m[5])
        });
        txnLineIdx.push(i);
        creditFlag = false;
      }
    }
  }

  // Pass 2: amounts list. Amounts appear AFTER the last transaction line
  // (on the same page). Page-1 balance/minimum-payment numbers appear before
  // any transaction and must be skipped. We collect pure numeric lines that
  // come after the last txn line index.
  const amounts = [];
  const startIdx = txnLineIdx.length ? txnLineIdx[txnLineIdx.length - 1] + 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const am = line.match(/^(-?[\d,]+\.\d{2})(CR)?$/);
    if (am) amounts.push({ value: parseMoney(am[1]), isCredit: !!am[2] });
  }

  // Pair transactions with amounts in order.
  // Amex puts the previous-balance credit as the *first* amount in the list
  // (e.g. £1,810.64 payment). Transactions and amounts are ordered same.
  const transactions = [];
  const n = Math.min(txns.length, amounts.length);
  for (let i = 0; i < n; i++) {
    const t = txns[i];
    const a = amounts[i];
    transactions.push({
      date: t.txnDate,
      description: t.description,
      amount: Math.abs(a.value),
      currency: 'GBP',
      foreignAmount: null,
      foreignCurrency: null,
      direction: (t.isCredit || a.isCredit) ? 'credit' : 'debit',
      raw: `${t.description}  £${a.value}`
    });
  }

  return {
    bank: 'Amex',
    currency: 'GBP',
    statementPeriod: { from: periodFrom, to: periodTo },
    transactions
  };
}

// ---------- REVOLUT ----------
//
// "Transactions from1 March 2026to31 March 2026"
// Each CAR (card) payment line:
//   "31 Mar 2026CARSunexpress.com 3003268€929.94€4.76"
// The first € amount after the description is the charge, second is balance.
//
// Some CAR lines carry FX info (purchase in GBP, billed in EUR):
//   "12 Mar 2026CARTravelodg Travelodge G"
//   "FX Rate EUR 1 = GBP 0.862944, Fee: €4.57"
//   "€764.68"
//   "£655.93"
//   "€20 502.54"
//
// We only keep CAR (card) lines — EXI/EXO/MOS/MOA/MOR/ATM/FEE aren't card purchases.

function isRevolut(text) {
  return /Revolut\s+Ltd/i.test(text) || /revolut\.com/i.test(text);
}

function extractRevolut(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''));

  // Period
  let periodFrom = null, periodTo = null;
  const pm = text.match(/from(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})to(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (pm) {
    const fromMi = monthIndex(pm[2]);
    const toMi = monthIndex(pm[5]);
    if (fromMi != null) periodFrom = new Date(Date.UTC(+pm[3], fromMi, +pm[1]));
    if (toMi != null) periodTo = new Date(Date.UTC(+pm[6], toMi, +pm[4]));
  }

  // Common money regex inside text: currency symbol + number with space/comma thousand
  // €, £, $ — number: digits (with space or comma every 3) dot and 2 decimals
  const moneyRe = /([€£$])\s*(-?[\d][\d\s,]*\.\d{2})/g;
  const dateRe = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(CAR|EXI|EXO|MOS|MOA|MOR|ATM|FEE)(.*)$/;

  // Parse line-by-line; when a CAR starts we may need to look ahead.
  const txns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(dateRe);
    if (!m) continue;
    const [, d, monStr, yStr, code, rest] = m;
    const mi = monthIndex(monStr);
    if (mi == null) continue;
    if (code !== 'CAR') continue; // only keep card purchases

    const date = new Date(Date.UTC(+yStr, mi, +d));

    // Case A — all amounts on same line:
    // "...Sunexpress.com 3003268€929.94€4.76"
    const matches = [...rest.matchAll(moneyRe)];
    let amount = null;
    let currency = 'EUR';
    let foreignAmount = null, foreignCurrency = null;
    let description = rest;

    if (matches.length >= 1) {
      // amount = first money in the "rest" portion
      const first = matches[0];
      amount = parseMoney(first[2]);
      currency = first[1] === '€' ? 'EUR' : first[1] === '£' ? 'GBP' : 'USD';
      description = rest.slice(0, first.index).trim();
    }

    // Case B — next lines carry amounts + maybe FX
    // Gather continuation until the next dated line.
    const contLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (dateRe.test(lines[j])) break;
      if (!lines[j]) continue;
      // Stop if we hit the footer/transaction-types block
      if (/^Transaction types/i.test(lines[j])) break;
      if (/^(Card payments|Money sent|Money received|Money added|ATM Withdrawals|Exchange Out|Exchange In|Revolut Fees)/i.test(lines[j])) break;
      contLines.push(lines[j]);
    }

    // Detect FX context (charge in a different currency than EUR).
    // Revolut writes: "...description\nFX Rate EUR 1 = GBP X, Fee: €Y\n€charge\n£original\n€balance"
    // The amount on the *same line* as the date is the fee (€Y) in that layout,
    // so if we see an FX Rate cont-line we must prefer the standalone €charge line.
    const hasFxRateLine = contLines.some(cl => /FX\s*Rate/i.test(cl));
    if (hasFxRateLine) {
      // Collect pure-amount lines after the FX rate line.
      let seenFx = false;
      const amts = [];
      for (const cl of contLines) {
        if (/FX\s*Rate/i.test(cl)) { seenFx = true; continue; }
        if (!seenFx) continue;
        const mm = cl.match(/^([€£$])\s*(-?[\d][\d\s,]*\.\d{2})$/);
        if (mm) amts.push({ cur: mm[1] === '€' ? 'EUR' : mm[1] === '£' ? 'GBP' : 'USD', value: parseMoney(mm[2]) });
      }
      // Layout: [EUR charge, foreign original, EUR balance]
      if (amts.length >= 1 && amts[0].cur === 'EUR') {
        amount = amts[0].value;
        currency = 'EUR';
      }
      const foreign = amts.find(a => a.cur !== 'EUR');
      if (foreign) {
        foreignAmount = foreign.value;
        foreignCurrency = foreign.cur;
      }
    } else if (matches.length === 0 && contLines.length) {
      // No amounts on the header line; no FX either — single amount in a cont line.
      for (const cl of contLines) {
        const mm = cl.match(/^([€£$])\s*(-?[\d][\d\s,]*\.\d{2})$/);
        if (mm) {
          amount = parseMoney(mm[2]);
          currency = mm[1] === '€' ? 'EUR' : mm[1] === '£' ? 'GBP' : 'USD';
          break;
        }
      }
    }

    // Description cleanup: drop trailing redundant spaces and FX rate lines
    description = description.replace(/\s+/g, ' ').trim();
    if (!description) description = rest.trim();

    if (amount == null || !isFinite(amount)) continue;

    txns.push({
      date,
      description,
      amount: Math.abs(amount),
      currency,
      foreignAmount,
      foreignCurrency,
      direction: 'debit',
      raw: `${date.toISOString().slice(0,10)} ${code} ${description}`
    });
  }

  return {
    bank: 'Revolut',
    currency: 'EUR',
    statementPeriod: { from: periodFrom, to: periodTo },
    transactions: txns
  };
}

// ---------- LLOYDS BANK (UK) ----------
//
// Card statement. Header e.g. "02 February 2026" and transaction lines:
//   "169906 JANUARY07 JANUARYSUNEXPRESS. 0601266193FRANKFURT AMDE      347.15"
// Card-end + txnDay + MONTH + postedDay + MONTH + description + amount [CR]
//
// For foreign-currency purchases, the next line carries:
//   "776.82  EUR @ 1.1503"
// — original amount + currency + implicit GBP-per-foreign rate.

function isLloyds(text) {
  return /Lloyds\s+Bank/i.test(text) || /lloydsbank\.com/i.test(text);
}

function extractLloyds(text) {
  // Statement date — use full "Your credit card statement / 02 February 2026"
  // or any "DD Month YYYY" near the header.
  let stmtYear = null;
  const sm = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (sm) stmtYear = parseInt(sm[3], 10);
  // The transaction dates often lack a year; we use the statement year.

  const lines = text.split('\n').map(l => l.trim());

  // Full line: <4 digit card-end><1-2 digit day><space><MONTH><1-2 digit day><space><MONTH><description><space+amount>[CR]
  // Month name is spelled out in FULL CAPS; constrain it so the description
  // (which often also starts with capitals like "SUNEXPRESS") isn't swallowed.
  const MONTH_FULL = 'JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER';
  const txnRe = new RegExp(
    `^(\\d{4})(\\d{1,2})\\s+(${MONTH_FULL})(\\d{1,2})\\s+(${MONTH_FULL})(.+?)\\s+([\\d,]+\\.\\d{2})(CR)?$`
  );
  // Foreign-currency context line on next row: "776.82  EUR @ 1.1503"
  const fxRe = /^([\d,]+\.\d{2})\s+([A-Z]{3})\s*@\s*([\d.]+)$/;

  const txns = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(txnRe);
    if (!m) continue;
    const [, cardEnd, txnDay, txnMon, postedDay, postedMon, desc, amtStr, crTag] = m;
    const mi = monthIndex(txnMon);
    if (mi == null || stmtYear == null) continue;

    const date = new Date(Date.UTC(stmtYear, mi, +txnDay));
    const amount = parseMoney(amtStr);

    // Peek next line for an FX context
    let foreignAmount = null, foreignCurrency = null;
    if (i + 1 < lines.length) {
      const fx = lines[i + 1].match(fxRe);
      if (fx) {
        foreignAmount = parseMoney(fx[1]);
        foreignCurrency = fx[2];
      }
    }

    txns.push({
      date,
      description: desc.trim(),
      amount: Math.abs(amount),
      currency: 'GBP',
      foreignAmount,
      foreignCurrency,
      direction: crTag ? 'credit' : (/PAYMENT RECEIVED/i.test(desc) ? 'credit' : 'debit'),
      raw: line
    });
  }

  return {
    bank: 'Lloyds',
    currency: 'GBP',
    statementPeriod: { from: null, to: null },
    transactions: txns
  };
}

// ---------- DISPATCH ----------

async function parseStatementPdf(buffer, filePath) {
  const { text } = await pdfParse(buffer);
  let parsed;
  if (isAmex(text)) parsed = extractAmex(text);
  else if (isRevolut(text)) parsed = extractRevolut(text);
  else if (isLloyds(text)) parsed = extractLloyds(text);
  else {
    return {
      bank: 'unknown',
      currency: null,
      statementPeriod: { from: null, to: null },
      transactions: [],
      error: 'Unrecognised statement format (not Amex / Revolut / Lloyds).'
    };
  }
  return { ...parsed, filePath };
}

module.exports = {
  parseStatementPdf,
  // exposed for unit testing
  extractAmex,
  extractRevolut,
  extractLloyds,
  parseMoney
};
