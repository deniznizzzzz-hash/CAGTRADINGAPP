// Matches parsed flight/train tickets against parsed bank-statement
// transactions using a "date-mandatory + amount-or-merchant" rule:
//
//   1. Date     - ticket.purchaseDate within +/-1 calendar day of txn.date
//                 (REQUIRED - date is the most reliable signal)
//   2. Amount   - amounts equal exactly, same currency
//                 (or ticket vs txn.foreignAmount when the txn was charged in
//                  ticket's currency - no FX conversion is performed)
//   3. Merchant - an airline keyword for the ticket's airline(s) appears in
//                 txn.description (case-insensitive)
//
// Matched iff hitDate AND (hitAmount OR hitMerchant). A ticket whose date
// doesn't fall in the +/-1-day window is never matched, even if amount and
// merchant both line up.
//
// Currency handling: we never apply an FX rate. Either the statement
// transaction is in the same currency as the ticket (compare directly), or
// the statement carries a foreignAmount/foreignCurrency slot in the ticket's
// currency (compare against that - the bank's actual purchase-day rate).
// Cross-currency rows without a matching foreign-amount slot simply won't hit
// on amount, but can still match on date+merchant.
//
// Only debit transactions are considered on the statement side (credits and
// payment-received lines can't be ticket charges).

// Airline keyword table - lowercase merchant substrings we expect to see on a
// statement line for each airline. Multiple aliases per airline allow us to
// catch abbreviations the bank prints (e.g. "Snbru Air" for Brussels Airlines,
// "Thy" for Turkish Airlines).
const AIRLINE_KEYWORDS = {
  AJet: ['ajet', 'anadolujet'],
  AnadoluJet: ['ajet', 'anadolujet'],
  SunExpress: ['sunexpress'],
  'Turkish Airlines': ['turkish airlines', 'thy', 'turkishairlines'],
  Pegasus: ['pegasus'],
  'Brussels Airlines': ['brussels airlines', 'snbru'],
  Eurowings: ['eurowings'],
  KLM: ['klm', 'air france', 'airfrance'],
  'Air France': ['air france', 'airfrance', 'klm'],
  easyJet: ['easyjet'],
  Finnair: ['finnair'],
  Ryanair: ['ryanair'],
  'Wizz Air': ['wizz', 'wizzair'],
  'Kiwi.com': ['kiwi', 'kiwi.com'],
  Eurostar: ['eurostar']
};

// Case-insensitive contains.
function contains(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// Within N calendar days? Both inputs may be Date or ISO string.
function withinDays(a, b, days = 1) {
  if (!a || !b) return false;
  const ad = typeof a === 'string' ? new Date(a) : a;
  const bd = typeof b === 'string' ? new Date(b) : b;
  if (isNaN(+ad) || isNaN(+bd)) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.abs(ad - bd) <= days * dayMs;
}
// Back-compat alias: kept so existing tests / external callers don't break.
function sameDay(a, b) { return withinDays(a, b, 0); }

// Amounts equal - exact match (small epsilon for floating-point safety only).
function amountsEqual(a, b) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) < 0.005;
}

// Gather a set of airline keywords to look for given a parsed ticket.
// `ticket.legs[i].airline` is the canonical airline name from the extractor.
function airlineKeywordsForTicket(ticket) {
  const kws = new Set();
  const addFor = (airlineName) => {
    if (!airlineName) return;
    const keys = AIRLINE_KEYWORDS[airlineName];
    if (keys) keys.forEach(k => kws.add(k));
    kws.add(String(airlineName).split(/\s+/)[0].toLowerCase());
  };
  for (const leg of ticket.legs || []) addFor(leg.airline);
  return Array.from(kws);
}

// Compare amounts with no FX conversion applied.
//   a) Same currency: ticket.totalAmount vs txn.amount.
//   b) Statement carries foreignAmount in ticket's currency -> compare those
//      directly (the bank already converted using its own purchase-day rate).
function tryAmountMatch(ticket, txn) {
  const tTotal = Number(ticket.totalAmount);
  const tCur = ticket.currency;
  if (!isFinite(tTotal)) return false;

  // (a) Same currency direct
  if (tCur === txn.currency && amountsEqual(tTotal, txn.amount)) return true;

  // (b) Statement's foreign-amount slot is in ticket currency - bank's own rate
  if (txn.foreignCurrency && tCur === txn.foreignCurrency &&
      txn.foreignAmount != null && amountsEqual(tTotal, txn.foreignAmount)) return true;

  return false;
}

function scoreMatch(ticket, txn) {
  let score = 0;
  const hitDate = withinDays(ticket.purchaseDate, txn.date, 1);
  const hitAmount = tryAmountMatch(ticket, txn);
  const kws = airlineKeywordsForTicket(ticket);
  const hitMerchant = kws.some(k => contains(txn.description, k));
  if (hitDate) score++;
  if (hitAmount) score++;
  if (hitMerchant) score++;
  return { score, hitDate, hitAmount, hitMerchant };
}

/**
 * Match tickets against statement transactions
 * (date mandatory + at least one of amount/merchant).
 *
 * @param {Array} tickets - parsed ticket objects from pdf-parser.parsePdf
 *                          (each with purchaseDate, totalAmount, currency, legs)
 * @param {Array} transactions - debit transactions from statement-parser
 *
 * @returns {{
 *   matches:           [{ ticket, txn, score, hitDate, hitAmount, hitMerchant }],
 *   unmatchedTickets:  [ticket, ...],
 *   unmatchedTxns:     [txn, ...]
 * }}
 */
function matchTicketsToStatement(tickets, transactions) {
  const debits = transactions.filter(t => t.direction === 'debit');
  const usedTxnIdx = new Set();
  const matches = [];
  const unmatchedTickets = [];

  for (const ticket of tickets) {
    // Date is mandatory - skip txns whose date is outside the +/-1 day window.
    // Among the remainder, require at least one more hit (amount or merchant)
    // to qualify (effectively score >= 2 AND hitDate=true).
    let best = null;
    let bestIdx = -1;
    for (let i = 0; i < debits.length; i++) {
      if (usedTxnIdx.has(i)) continue;
      const s = scoreMatch(ticket, debits[i]);
      if (!s.hitDate) continue;
      if (s.score < 2) continue;
      if (!best || s.score > best.score) {
        best = s;
        bestIdx = i;
      }
    }
    if (best) {
      matches.push({ ticket, txn: debits[bestIdx], ...best });
      usedTxnIdx.add(bestIdx);
    } else {
      unmatchedTickets.push(ticket);
    }
  }

  const unmatchedTxns = debits.filter((_, i) => !usedTxnIdx.has(i));

  return { matches, unmatchedTickets, unmatchedTxns };
}

module.exports = {
  matchTicketsToStatement,
  // exposed for tests
  scoreMatch,
  sameDay,
  withinDays,
  amountsEqual,
  airlineKeywordsForTicket,
  AIRLINE_KEYWORDS
};
