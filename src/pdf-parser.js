const pdfParse = require('pdf-parse');
const { airportFromIATA } = require('./airports');

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  ocak: 0, subat: 1, şubat: 1, mart: 2, nisan: 3, mayis: 4, mayıs: 4, haziran: 5,
  temmuz: 6, agustos: 7, ağustos: 7, eylul: 8, eylül: 8, ekim: 9, kasim: 10, kasım: 10, aralik: 11, aralık: 11,
  // Turkish 3-letter abbreviations (Kiwi.com tickets).
  oca: 0, şub: 1, sub: 1, nis: 3, haz: 5, tem: 6, ağu: 7, agu: 7, eyl: 8, eki: 9, kas: 10, ara: 11
};

// AJet header e.g. "31/03/2026, 22:44"
function parseHeaderPurchaseDate(text) {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
}

// "07 April 2026" or "09 March 2026, Monday"
function parseLongDate(text) {
  const re = /(\d{1,2})\s+([A-Za-zÇĞİIÖŞÜçğıöşü]+)\s+(\d{4})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (mon != null) {
      return new Date(Date.UTC(+m[3], mon, +m[1]));
    }
  }
  return null;
}

// Turns "KASPARS STEINS" → "Kaspars Steins"
function titleCase(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// TR-style "61.997,76" → 61997.76; plain "82.30" → 82.30
function parseMoney(raw) {
  if (!raw) return NaN;
  let s = raw.trim().replace(/\s/g, '');
  // if both . and , present — the last one is the decimal sep
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // comma only — treat as decimal sep if 1–2 digits after, else thousand sep
    const after = s.split(',').pop();
    if (after.length <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  return parseFloat(s);
}

function detectCurrency(raw) {
  if (!raw) return null;
  const r = raw.toUpperCase();
  if (r.includes('TRY') || r.includes('TL') || raw.includes('₺')) return 'TRY';
  if (r.includes('GBP') || raw.includes('£')) return 'GBP';
  if (r.includes('EUR') || raw.includes('€')) return 'EUR';
  if (r.includes('USD') || raw.includes('$')) return 'USD';
  return null;
}

// Normalize flight number to a single joined token (e.g. "VF 66" → "VF66")
function normalizeFlightNumber(fn) {
  if (!fn) return '';
  return fn.replace(/\s+/g, '').toUpperCase();
}

function decimalTime(hhmm) {
  // "12:15" → 12.15 (as the Excel column uses decimal HH.MM)
  if (!hhmm) return null;
  const m = hhmm.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = +m[1];
  const mm = +m[2];
  // Build as number with 2 decimal digits — avoid FP by string build
  return parseFloat(`${h}.${mm.toString().padStart(2, '0')}`);
}

function normalizeAirline(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase();
  if (r.includes('ajet') || r.includes('anadolujet')) return 'Ajet';
  if (r.includes('sunexpress')) return 'SunExpress';
  if (r.includes('pegasus')) return 'Pegasus';
  if (r.includes('turkish') || r.startsWith('thy')) return 'THY';
  if (r.includes('klm')) return 'KLM';
  if (r.includes('eurowings')) return 'Eurowings';
  if (r.includes('wizz')) return 'Wizzair';
  if (r.includes('brussels airlines')) return 'Brussels Airlines';
  if (r.includes('ryanair')) return 'Ryanair';
  if (r.includes('lufthansa')) return 'Lufthansa';
  if (r.includes('easyjet')) return 'easyJet';
  if (r.includes('finnair')) return 'Finnair';
  return raw.trim();
}

// Map 2-letter IATA airline code → canonical name
function airlineFromCode(code) {
  const m = {
    VF: 'Ajet',
    TK: 'THY',
    PC: 'Pegasus',
    XQ: 'SunExpress',
    KL: 'KLM',
    EW: 'Eurowings',
    W4: 'Wizzair',
    W6: 'Wizzair',
    SN: 'Brussels Airlines',
    FR: 'Ryanair',
    LH: 'Lufthansa',
    AY: 'Finnair',
    U2: 'easyJet',
    EJU: 'easyJet'
  };
  return m[code.toUpperCase()] || '';
}

/**
 * Extract one or more flight-leg bookings from an AJet/generic PDF text.
 * Returns:
 * {
 *   pnr, purchaseDate: Date,
 *   passengers: ["Kaspars Steins", ...],
 *   legs: [
 *     { flightNumber:"VF 66", airline:"Ajet", departureDate:Date,
 *       departureTime:12.15, departureAirport:"Brussels", arrivalAirport:"Sabiha Gokcen" }
 *   ],
 *   totalAmount: 61997.76, currency: "TRY"
 * }
 */
function extractAJet(text, visibleText) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // Flight numbers must appear in the VISIBLE part of the PDF — AJet tickets
  // embed hidden "AJet/VFxx" text inside the header banner that's not rendered
  // to the user. We keep a set of visible flight codes and clear flightNumber
  // on any extracted leg whose code isn't in it.
  const visibleFlightCodes = new Set();
  if (visibleText) {
    const vSrc = visibleText;
    const re = /(AJet|Anadolujet|SunExpress|Pegasus|THY|Turkish Airlines|KLM|Eurowings|Wizzair|Wizz Air|Brussels Airlines|Ryanair|Lufthansa)[\s,\-]+([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/gi;
    let m;
    while ((m = re.exec(vSrc)) !== null) {
      visibleFlightCodes.add(`${m[2].toUpperCase()}${m[3]}`);
    }
    if (visibleFlightCodes.size === 0) {
      const re2 = /\b([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/g;
      let m2;
      while ((m2 = re2.exec(vSrc)) !== null) {
        const code = m2[1].toUpperCase();
        if (airlineFromCode(code)) visibleFlightCodes.add(`${code}${m2[2]}`);
      }
    }
  }

  out.purchaseDate = parseHeaderPurchaseDate(text);
  // THY: "Transaction date: 17 March 2026, 13:58 (GMT +03) ..."
  if (!out.purchaseDate) {
    const m = text.match(/Transaction date[:\s]+(\d{1,2})\s+([A-Za-zÇĞİIÖŞÜçğıöşü]+)\s+(\d{4})/i);
    if (m) {
      const mon = MONTH_MAP[m[2].toLowerCase()];
      if (mon != null) out.purchaseDate = new Date(Date.UTC(+m[3], mon, +m[1]));
    }
  }

  const pnrM = text.match(/Reservation Code\s*\(PNR\)\s*([A-Z0-9]{5,8})/i)
    || text.match(/Booking number[:\s]*([A-Z0-9]{5,8})/i)
    || text.match(/Reservation code\s*[\r\n]+\s*([A-Z0-9]{5,8})/i)
    || text.match(/\bPNR\b\s*[:\-]?\s*([A-Z0-9]{5,8})/i);
  if (pnrM) out.pnr = pnrM[1];

  // THY-style "Passenger nameTicket numbers" block — names are listed one per
  // passenger, each followed by a 13-digit ticket number (sometimes split across
  // lines, sometimes glued to the digits). Capture here before falling back to
  // the generic uppercase-line scan.
  {
    const blockM = text.match(
      /Passenger name\s*Ticket numbers[\s\S]*?(?=Contact passenger information|Fare details|Payment details|Attention|$)/i
    );
    if (blockM) {
      const re = /([A-ZÇĞİIÖŞÜ][A-ZÇĞİIÖŞÜ\s]*?)\s*(\d{13})/g;
      const thyNames = [];
      let m;
      while ((m = re.exec(blockM[0])) !== null) {
        const raw = m[1].trim().replace(/\s+/g, ' ');
        const words = raw.split(/\s+/).filter(Boolean);
        // Keep trailing run of all-uppercase word tokens (drops any preceding
        // boilerplate like "MILES SMILES" etc. that isn't contiguous with the name).
        const nameWords = [];
        for (let i = words.length - 1; i >= 0; i--) {
          const w = words[i];
          if (/^[A-ZÇĞİIÖŞÜ]{2,}$/.test(w)) nameWords.unshift(w);
          else break;
        }
        if (nameWords.length >= 2) thyNames.push(nameWords.join(' '));
      }
      if (thyNames.length > 0) {
        out.passengers = thyNames.map(titleCase);
      }
    }
  }

  // Passengers list — collect all-uppercase multi-word lines from the WHOLE text.
  // (AJet PDFs put some passenger names after the Price section, so we cannot split there.)
  // After collecting, cap at the number in "N passenger(s)".
  const rawLines = text.split(/\r?\n/).map(l => l.trim());
  const names = [];
  const seenNames = new Set();
  const blacklist = new Set([
    'THANK YOU', 'EN LOGIN', 'MANAGE FLIGHTS', 'SEND E MAIL',
    'PASSENGER TRAVEL DETAIL', 'DISCOVER ADDITIONAL SERVICES',
    'UPGRADE YOUR FLIGHT', 'WITH ADDITIONAL SERVICES', 'BOARDING PASS',
    'ECOJET', 'FLEXJET', 'ADDITIONAL SERVICES', 'BUSINESS CLASS',
    'ECONOMY CLASS', 'ADULT', 'ADULTS', 'CHILD', 'CHILDREN',
    'TOTAL PRICE', 'TICKET PRICE', 'TAX PRICE', 'SURCHARGE PRICE',
    'EMBARKATION TAX', 'FUEL FEE', 'AIRBUS', 'BOEING'
  ]);
  for (const line of rawLines) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (!/^[A-ZÇĞİIÖŞÜ ]+$/.test(cleaned)) continue;
    const words = cleaned.split(' ');
    if (words.length < 2 || words.length > 6) continue;
    // Each word: at least 1 letter, allow single-letter middle initials
    // BUT require the first and last word to be ≥ 2 letters.
    if (words[0].length < 2) continue;
    if (words[words.length - 1].length < 2) continue;
    if (blacklist.has(cleaned)) continue;
    // Skip lines that are only 3-letter tokens (airport codes like "BRU SAW")
    if (words.every(w => w.length === 3)) continue;
    // Skip things that look like amounts/labels (contain "KG", "PRICE", "TAX")
    if (/\b(KG|PRICE|TAX|FEE|CLASS|PNR|PDF)\b/.test(cleaned)) continue;
    // Total length sanity
    if (cleaned.length < 5 || cleaned.length > 80) continue;
    if (seenNames.has(cleaned)) continue;
    seenNames.add(cleaned);
    names.push(cleaned);
  }

  // Cap at "N passenger(s)" if present — this keeps duplicates (e.g. round-trip) out.
  const paxCountM = text.match(/(\d+)\s*passenger\(s\)\s*total price/i);
  let expected = paxCountM ? +paxCountM[1] : null;
  let finalNames = names;
  if (expected != null && names.length > expected) {
    finalNames = names.slice(0, expected);
  }
  // Don't overwrite passengers already captured by the THY-specific block above.
  if (out.passengers.length === 0) {
    out.passengers = finalNames.map(titleCase);
  }

  // Legs — find occurrences of "<IATA> <HH:MM>" near "Airline, Flight#"
  // Strategy: scan the text sequentially collecting route blocks.
  //
  // Pattern variants in AJet PDFs:
  //   "Brussels (BRU)  İstanbul (SAW)"  — route line
  //   "07 April 2026, Tue"              — date
  //   "AJet, VF66"                      — airline + flight number
  //   "BRU" / "12:15" / "Brussels"      — departure block
  //   "SAW" / "16:40" / "Istanbul"      — arrival block
  //
  // Second PDF shape (single flight):
  //   "09 March 2026, Monday"
  //   "AJet"  " VF66"  " 3hr 25min"
  //   "Departure  13:50  Brussels (BRU)"
  //   "Arrival    19:15  İstanbul (SAW)"
  //
  // We'll extract every "<airline>, <flightNumber>" or "<airline>\s+<flightNumber>"
  // token, then pair it with the nearest preceding long-date and following
  // "<IATA> <HH:MM>" (departure) / "<IATA> <HH:MM>" (arrival).

  // Find flight number tokens — pairs of airline and a 2-letter IATA code + number.
  // IATA airline codes are 2 letters OR 1 letter + 1 digit (e.g., W4, W6).
  const flightMatches = [];
  const flightRe = /(AJet|Anadolujet|SunExpress|Pegasus|THY|Turkish Airlines|KLM|Eurowings|Wizzair|Wizz Air|Brussels Airlines|Ryanair|Lufthansa)[\s,\-]+([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/gi;
  let fm;
  while ((fm = flightRe.exec(text)) !== null) {
    flightMatches.push({
      index: fm.index,
      airline: normalizeAirline(fm[1]),
      flightNumber: `${fm[2].toUpperCase()}${fm[3]}`
    });
  }
  // Fallback: also pick up standalone "VF66" / "XQ 1456" tokens if no airline
  // keyword is near them — e.g. boarding passes without airline text.
  if (flightMatches.length === 0) {
    const re2 = /\b([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/g;
    let m2;
    while ((m2 = re2.exec(text)) !== null) {
      const code = m2[1].toUpperCase();
      if (!airlineFromCode(code)) continue;
      flightMatches.push({
        index: m2.index,
        airline: airlineFromCode(code),
        flightNumber: `${code}${m2[2]}`
      });
    }
  }

  // Date candidates and their indexes — match "07 April 2026" and also
  // "20April2026" (SunExpress PDFs join words without whitespace).
  const dateCands = [];
  {
    const re = /(\d{1,2})\s*([A-Za-zÇĞİIÖŞÜçğıöşü]+)\s*(\d{4})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const mon = MONTH_MAP[m[2].toLowerCase()];
      if (mon != null) {
        dateCands.push({
          index: m.index,
          date: new Date(Date.UTC(+m[3], mon, +m[1]))
        });
      }
    }
  }

  // Collect all IATA codes and all HH:MM times separately, then pair by proximity.
  // This handles both AJet layouts:
  //   layout A (compact):  BRU \n 12:15 \n Brussels
  //   layout B (verbose):  Departure \n 13:50 \n Brussels (BRU)
  const { AIRPORTS } = require('./airports');
  const iatas = [];
  {
    // Standalone uppercase 3-letter tokens AND "(XXX)" parenthesized codes
    const re = /\b([A-Z]{3})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const code = m[1];
      // Known airport only — keeps this robust against THY/KLM/PNR/etc.
      if (!AIRPORTS[code]) continue;
      iatas.push({ index: m.index, iata: code });
    }
  }
  const times = [];
  {
    // No trailing \b — SunExpress PDFs join departure+arrival like "13:5516:40".
    const re = /\b(\d{1,2}:\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      times.push({ index: m.index, time: m[1] });
    }
  }

  // Route hints: "City (AAA) - City (BBB)" style lines (THY uses these).
  // When present near a flight match, they are preferred over the generic
  // "first 2 IATAs after flight token" rule — which gets confused on THY PDFs
  // where a departure airport appears in the text before the flight number.
  const routeHints = [];
  {
    const re = /\(([A-Z]{3})\)\s*[-–—]\s*[A-Za-zÇĞİIÖŞÜçğıöşü .]+\(([A-Z]{3})\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (AIRPORTS[m[1]] && AIRPORTS[m[2]]) {
        routeHints.push({ index: m.index, dep: m[1], arr: m[2] });
      }
    }
  }

  function nearestAfter(arr, idx, maxDist = 400) {
    for (const item of arr) {
      if (item.index > idx && item.index - idx <= maxDist) return item;
    }
    return null;
  }
  function nextAfter(arr, idx) {
    for (const item of arr) if (item.index > idx) return item;
    return null;
  }

  for (const fl of flightMatches) {
    // Closest date before this flight match
    let date = null;
    for (let i = dateCands.length - 1; i >= 0; i--) {
      if (dateCands[i].index < fl.index) { date = dateCands[i].date; break; }
    }

    // Prefer a route hint near this flight match. THY PDFs have lots of
    // repeated IATA mentions before the flight token, so "first 2 after" is
    // unreliable there.
    let depIATA = null, arrIATA = null, depIdx = null;
    let bestRoute = null, bestRouteDist = Infinity;
    for (const r of routeHints) {
      const d = Math.abs(r.index - fl.index);
      if (d < bestRouteDist && d <= 3000) {
        bestRoute = r;
        bestRouteDist = d;
      }
    }
    if (bestRoute) {
      depIATA = bestRoute.dep;
      arrIATA = bestRoute.arr;
      // For time-pairing, use the position of depIATA closest to the flight.
      let best = Infinity;
      for (const t of iatas) {
        if (t.iata === depIATA) {
          const d = Math.abs(t.index - fl.index);
          if (d < best) { best = d; depIdx = t.index; }
        }
      }
    } else {
      // Fall back to the first two IATA codes after the flight token.
      const iatasAfter = iatas.filter(t => t.index > fl.index).slice(0, 2);
      if (iatasAfter.length < 2) continue;
      depIATA = iatasAfter[0].iata;
      arrIATA = iatasAfter[1].iata;
      depIdx = iatasAfter[0].index;
    }
    if (!depIATA || !arrIATA) continue;

    // Pair the departure IATA with the nearest time (wide window to tolerate
    // different visual groupings like SunExpress' concatenated itinerary).
    function timeNear(idx) {
      let best = null;
      let bestDist = Infinity;
      for (const t of times) {
        const d = Math.abs(t.index - idx);
        if (d < bestDist && d <= 500) {
          best = t;
          bestDist = d;
        }
      }
      return best;
    }
    const depT = timeNear(depIdx != null ? depIdx : fl.index);
    out.legs.push({
      flightNumber: fl.flightNumber,
      airline: fl.airline || airlineFromCode(fl.flightNumber.slice(0, 2)),
      departureDate: date,
      departureTime: depT ? decimalTime(depT.time) : null,
      departureAirport: airportFromIATA(depIATA),
      arrivalAirport: airportFromIATA(arrIATA)
    });
  }

  // Clear flightNumber on legs whose code isn't in the visible PDF region
  // (e.g. hidden banner text). Only applies when visibleText was provided.
  if (visibleText) {
    out.legs = out.legs.map(l => {
      if (!l.flightNumber) return l;
      const code = l.flightNumber.replace(/\s+/g, '').toUpperCase();
      if (visibleFlightCodes.has(code)) return l;
      return { ...l, flightNumber: null };
    });
  }

  // Dedupe legs (same flightNumber + date + times)
  const seen = new Set();
  out.legs = out.legs.filter(l => {
    const k = `${l.flightNumber}|${l.departureDate?.toISOString()}|${l.departureTime}|${l.departureAirport}|${l.arrivalAirport}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Total — "N passenger(s) total price 61.997,76₺" / "82.30 GBP".
  // AJet PDFs sometimes put the currency on its own line either BEFORE or AFTER
  // the amount:
  //   "8 passenger(s) total price61.997,76\n₺"            — after
  //   "1 passenger(s) total price\n€\n326.42"             — before
  const totalM = text.match(
    /(\d+)\s*passenger\(s\)\s*total price\s*([₺£€$]|TRY|GBP|EUR|USD|TL)?\s*([0-9.,]+)\s*([₺£€$]|TRY|GBP|EUR|USD|TL)?/i
  );
  if (totalM) {
    out.totalAmount = parseMoney(totalM[3]);
    out.currency = detectCurrency(totalM[2] || '') || detectCurrency(totalM[4] || '');
    if (!out.currency) {
      // Look 80 chars ahead for the currency symbol/code
      const tail = text.slice(totalM.index + totalM[0].length, totalM.index + totalM[0].length + 80);
      out.currency = detectCurrency(tail);
    }
    if (!out.currency) {
      // As a last resort, scan the whole Price block
      const priceIdx = text.search(/\bPrice\b/i);
      if (priceIdx >= 0) out.currency = detectCurrency(text.slice(priceIdx, priceIdx + 400));
    }
  }

  // SunExpress fallback: "Total amount₺59,143 .88" (no "passenger(s)" phrase).
  if (out.totalAmount == null) {
    const t2 = text.match(
      /Total amount[:\s]*([₺£€$]|TRY|GBP|EUR|USD|TL)?\s*([0-9][0-9.,\s]*[0-9])\s*([₺£€$]|TRY|GBP|EUR|USD|TL)?/i
    );
    if (t2) {
      out.totalAmount = parseMoney(t2[2]);
      out.currency = detectCurrency(t2[1] || '') || detectCurrency(t2[3] || '');
      if (!out.currency) {
        const tail = text.slice(t2.index, t2.index + 200);
        out.currency = detectCurrency(tail);
      }
    }
  }

  // THY fallback: "Total : EUR 385,41" (currency precedes the amount).
  if (out.totalAmount == null) {
    const t3 = text.match(
      /\bTotal\s*:\s*(TRY|GBP|EUR|USD|TL|[₺£€$])\s*([0-9][0-9.,]*)/i
    );
    if (t3) {
      out.totalAmount = parseMoney(t3[2]);
      out.currency = detectCurrency(t3[1]);
    }
  }

  return out;
}

// KLM "DUPLICATE INVOICE" PDFs are structured as a VAT invoice — not a ticket —
// so they don't match any of the ticket patterns in extractAJet. Separate parser.
//   Format cues:
//     "DUPLICATE INVOICE KLGB0032689794 dated 2026-03-04"
//     "PASSENGER NAME" column → "MPHEKWANE MAKUBUJANE MS" (LASTNAME FIRSTNAMES TITLE)
//     "TRAVEL DATE" column   → "2026-03-22"
//     "International Air TicketJOHANNESBURG / AMSTERDAM / BRUSSELS" (endpoints only)
//     "Total Paid Amount\n825.50" (+ currency tag "GBP")
function extractKLMInvoice(text) {
  const { AIRPORTS } = require('./airports');
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // Invoice number (we use it as the PNR-equivalent reference)
  {
    const m = text.match(/\b([A-Z]{3,4}\d{8,14})\b/);
    if (m) out.pnr = m[1];
  }

  // Purchase date — "dated YYYY-MM-DD" at the top of the invoice
  {
    const m = text.match(/dated\s+(\d{4})-(\d{2})-(\d{2})/i);
    if (m) out.purchaseDate = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  // Passengers — each row starts with the issuing date + 13-digit doc number
  // glued together (e.g. "2026-03-040742135663728MPHEKWANE MAKUBU"), and the
  // passenger name may wrap to the next line ("JANE MS"). Capture everything
  // between the doc number and the next ISO date (travel date). Format is
  // "LASTNAME FIRSTNAMES TITLE" (TITLE ∈ MS/MR/MRS/MISS/DR); we strip the
  // title, then rotate the first word to the end so the result is
  // "Firstname(s) Lastname" to match other ticket types.
  {
    const re = /\d{4}-\d{2}-\d{2}\d{13}([\s\S]*?)(?=\d{4}-\d{2}-\d{2})/g;
    const names = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      let chunk = m[1].replace(/\s+/g, ' ').trim();
      if (!chunk) continue;
      chunk = chunk.replace(/\b(MS|MR|MRS|MISS|DR)\b\.?$/i, '').trim();
      if (!/^[A-ZÇĞİIÖŞÜ][A-ZÇĞİIÖŞÜ \-]+$/.test(chunk)) continue;
      const parts = chunk.split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const last = parts.shift();
      parts.push(last);
      names.push(titleCase(parts.join(' ')));
    }
    if (names.length) out.passengers = names;
  }

  // Travel date (departure) — first YYYY-MM-DD in the document that isn't the
  // purchase/issuing date.
  let travelDate = null;
  {
    const re = /(\d{4})-(\d{2})-(\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!out.purchaseDate || d.getTime() !== out.purchaseDate.getTime()) {
        travelDate = d;
        break;
      }
    }
  }

  // Route — "International Air Ticket<CITY> / <CITY> / <CITY>..."
  // Use first and last city as departure/arrival (connection in between is
  // not tracked in our single-leg row).
  let depAirport = null, arrAirport = null;
  {
    const routeM = text.match(
      /International Air Ticket\s*([A-ZÇĞİIÖŞÜ ]+(?:\s*\/\s*[A-ZÇĞİIÖŞÜ ]+)+)/i
    );
    if (routeM) {
      const cities = routeM[1].split('/').map(c => c.trim()).filter(Boolean);
      const cityToIATA = name => {
        const u = name.toUpperCase();
        for (const [code, n] of Object.entries(AIRPORTS)) {
          if (n.toUpperCase() === u) return code;
        }
        return null;
      };
      if (cities.length >= 2) {
        const dep = cityToIATA(cities[0]);
        const arr = cityToIATA(cities[cities.length - 1]);
        depAirport = dep ? airportFromIATA(dep) : titleCase(cities[0]);
        arrAirport = arr ? airportFromIATA(arr) : titleCase(cities[cities.length - 1]);
      }
    }
  }

  out.legs.push({
    flightNumber: null,
    airline: 'KLM',
    departureDate: travelDate,
    departureTime: null,
    departureAirport: depAirport,
    arrivalAirport: arrAirport
  });

  // Total — "Total Paid Amount825.50" or "Total Paid Amount\n825.50"
  {
    const m = text.match(/Total Paid Amount\s*([0-9][0-9.,]*)/i);
    if (m) out.totalAmount = parseMoney(m[1]);
    const curM = text.match(/(GBP|EUR|USD|TRY)/);
    if (curM) out.currency = curM[1];
  }

  return out;
}

// Pegasus "SALES/SATIŞ" tax-invoice PDFs — English or Turkish labels, one
// block per ticket, each with:
//   "Passenger Name :"   | "Yolcu Adı :"        → passenger
//   "Date:"              | "Tarih:"             → purchase date
//   "<From (XXX)><To (YYY)>PC<num><dd/mm/yyyy><HH:MM>"  (repeats per leg)
//   "Total Amount:"      | "Toplam:"            → block total + currency
// A single PDF may hold several blocks (per passenger × per fare component:
// flight + ancillary baggage). Round-trip tickets list multiple legs in one
// block. We collect every block, keep unique legs, and sum all block totals
// — the Excel writer divides by passengers × legs so each row gets its share.
function extractPegasusSales(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };
  const blocks = text.split(/(?:Passenger Name|Yolcu Adı)\s*:/i).slice(1);
  if (!blocks.length) return out;

  const passengerOrder = [];
  const seenPax = new Set();
  const flightKey = new Map(); // flightNumber → leg object
  let currency = null;
  let purchaseDate = null;
  let grandTotal = 0;
  let totalSeen = false;

  const legRe =
    /([A-Za-zÇĞİIÖŞÜçğıöşü .\-]+?)\s*\(([A-Z]{3})\)\s*([A-Za-zÇĞİIÖŞÜçğıöşü .\-]+?)\s*\(([A-Z]{3})\)\s*(PC)\s*(\d{1,4})\s*(\d{2})\/(\d{2})\/(\d{4})\s*(\d{1,2}):(\d{2})/gi;

  for (const block of blocks) {
    // Passenger name — first uppercase line of the block
    const nameM = block.match(/^\s*\n?\s*([A-ZÇĞİIÖŞÜ][A-ZÇĞİIÖŞÜ \-]+)/);
    const name = nameM ? titleCase(nameM[1].trim()) : null;
    if (name && !seenPax.has(name)) {
      seenPax.add(name);
      passengerOrder.push(name);
    }

    // Purchase date (English "Date:" or Turkish "Tarih:")
    const dateM = block.match(/(?:Date|Tarih)\s*:\s*\n?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (dateM && !purchaseDate) {
      purchaseDate = new Date(Date.UTC(+dateM[3], +dateM[2] - 1, +dateM[1]));
    }

    // All flight-leg rows in the block
    legRe.lastIndex = 0;
    let lm;
    while ((lm = legRe.exec(block)) !== null) {
      const depIATA = lm[2].toUpperCase();
      const arrIATA = lm[4].toUpperCase();
      const fnum = `${lm[5].toUpperCase()}${lm[6]}`;
      const depDate = new Date(Date.UTC(+lm[9], +lm[8] - 1, +lm[7]));
      const depTime = decimalTime(`${lm[10]}:${lm[11]}`);
      if (!flightKey.has(fnum)) {
        flightKey.set(fnum, {
          flightNumber: fnum,
          airline: 'Pegasus',
          departureDate: depDate,
          departureTime: depTime,
          departureAirport: airportFromIATA(depIATA) || titleCase(lm[1].trim()),
          arrivalAirport: airportFromIATA(arrIATA) || titleCase(lm[3].trim())
        });
      }
    }

    // Block total (English "Total Amount:" or Turkish "Toplam:").
    // Only the outermost "Toplam" counts — "Ara Toplam" (sub-total) has the
    // same value in these PDFs, but matching both would double-count. Use a
    // negative lookbehind to skip "Ara Toplam".
    const totM = block.match(
      /(?:Total Amount|(?<!Ara\s)Toplam)\s*:\s*\n?\s*([0-9][0-9.,]*)\s*([A-Z]{3})/i
    );
    if (totM) {
      grandTotal += parseMoney(totM[1]);
      totalSeen = true;
      currency = currency || totM[2].toUpperCase();
    }
  }

  out.passengers = passengerOrder;
  out.legs = Array.from(flightKey.values());
  out.purchaseDate = purchaseDate;
  out.currency = currency;
  if (totalSeen) out.totalAmount = grandTotal;
  return out;
}

// Brussels Airlines booking confirmation PDFs:
//   "Your booking reference is\n<PNR>"
//   "<Origin City> to <Dest City>\n<Weekday>, <D> <Month> <Year>" header
//   "<HH:MM>\n<IATA1>\n<HH:MM>\n<IATA2>" for departure/arrival times+airports
//   "SN <num>operated by ..." for the flight number
//   "Mr./Mrs./Ms. <Firstname> <Lastname>" for each passenger (dedup)
//   "Total price flights:EUR<amount>" for the booking total
function extractBrusselsAirlines(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR
  const pnrM = text.match(/Your booking reference is\s*\n\s*([A-Z0-9]{5,})/i);
  if (pnrM) out.pnr = pnrM[1];

  // Purchase date — "dd/mm/yyyy, HH:MMConfirmation" header on each page
  const pdM = text.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*\d{1,2}:\d{2}\s*Confirmation/);
  if (pdM) out.purchaseDate = new Date(Date.UTC(+pdM[3], +pdM[2] - 1, +pdM[1]));

  // Passengers — "Mr./Mrs./Ms./Miss/Dr. <Firstname(s)> <Lastname>"
  {
    const seen = new Set();
    const names = [];
    const re = /\b(?:Mr|Mrs|Ms|Miss|Dr)\.? +([A-Z][A-Za-z'\-]+(?: +[A-Z][A-Za-z'\-]+)+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    out.passengers = names;
  }

  // Flight legs — "<City> to <City>" header, then "<HH:MM>\n<IATA>\n<HH:MM>\n<IATA>"
  // within ~800 chars, plus "SN <num>operated" somewhere in that window.
  {
    const legs = [];
    const re = /([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+)*)\s+to\s+([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+)*)\s*\n[A-Za-z]+,\s+(\d{1,2})\s+([A-Za-zÇĞİIÖŞÜçğıöşü]+)\s+(\d{4})[\s\S]{0,400}?(\d{1,2}):(\d{2})\s*\n([A-Z]{3})\s*\n(\d{1,2}):(\d{2})\s*\n([A-Z]{3})[\s\S]{0,400}?\b([A-Z]{2})\s*(\d{2,5})\s*operated/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const mon = MONTH_MAP[m[4].toLowerCase()];
      if (mon == null) continue;
      legs.push({
        flightNumber: `${m[12].toUpperCase()}${m[13]}`,
        airline: 'Brussels Airlines',
        departureDate: new Date(Date.UTC(+m[5], mon, +m[3])),
        departureTime: decimalTime(`${m[6]}:${m[7]}`),
        departureAirport: airportFromIATA(m[8]) || m[8],
        arrivalAirport: airportFromIATA(m[11]) || m[11]
      });
    }
    out.legs = legs;
  }

  // Total — "Total price flights:EUR2,195.37"
  {
    const m = text.match(/Total price(?:\s+flights)?\s*:\s*([A-Z]{3})\s*([\d.,]+)/i);
    if (m) {
      out.currency = m[1].toUpperCase();
      out.totalAmount = parseMoney(m[2]);
    }
  }

  return out;
}

// Eurowings booking confirmation PDFs:
//   "Booking\nnumber\n<PNR>"
//   "<dd/mm/yyyy>, <HH:MM>Itinerary" page header → purchase date
//   Per leg: "<City> (<IATA>) - <City> (<IATA>)\n<Weekday>, <dd/mm/yyyy> | <HH:MM> - <HH:MM>"
//           then "<flightNumber> | <Aircraft>"
//   Passengers: "Passengers\nAdult\n<Last>, <First(s)>" per line
//   "Total price of the booking€<amount>"
function extractEurowings(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR — "Booking\nnumber\n<PNR>"
  const pnrM = text.match(/Booking\s*\n\s*number\s*\n\s*([A-Z0-9]{5,})/i);
  if (pnrM) out.pnr = pnrM[1];

  // Purchase date — "<dd>/<mm>/<yyyy>, <HH:MM>Itinerary"
  const pdM = text.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*\d{1,2}:\d{2}\s*Itinerary/);
  if (pdM) out.purchaseDate = new Date(Date.UTC(+pdM[3], +pdM[2] - 1, +pdM[1]));

  // Flight legs
  {
    const re = /([A-Za-zÇĞİIÖŞÜçğıöşü.\- ]+?)\s*\(([A-Z]{3})\)\s*-\s*([A-Za-zÇĞİIÖŞÜçğıöşü.\- ]+?)\s*\(([A-Z]{3})\)\s*\n[A-Za-z]+,\s*(\d{2})\/(\d{2})\/(\d{4})\s*\|\s*(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}[\s\S]{0,200}?\b([A-Z]{2})\s?(\d{2,5})\s*\|/g;
    const legs = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      legs.push({
        flightNumber: `${m[10].toUpperCase()}${m[11]}`,
        airline: 'Eurowings',
        departureDate: new Date(Date.UTC(+m[7], +m[6] - 1, +m[5])),
        departureTime: decimalTime(`${m[8]}:${m[9]}`),
        departureAirport: airportFromIATA(m[2]) || titleCase(m[1].trim()),
        arrivalAirport: airportFromIATA(m[4]) || titleCase(m[3].trim())
      });
    }
    out.legs = legs;
  }

  // Passengers — "Passengers\nAdult\n<Last>, <First(s)>\n..." until "Invoice address"
  {
    const blockM = text.match(/Passengers\s*\n\s*Adult\s*\n([\s\S]*?)(?=Invoice address|Payment)/i);
    const names = [];
    if (blockM) {
      for (const line of blockM[1].split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const nm = t.match(/^([A-Z][A-Za-zÇĞİIÖŞÜçğıöşü'\-]+),\s+([A-Z][A-Za-zÇĞİIÖŞÜçğıöşü'\- ]+)$/);
        if (nm) names.push(titleCase(`${nm[2].trim()} ${nm[1]}`));
      }
    }
    out.passengers = names;
  }

  // Total — "Total price of the booking€1,279.92"
  {
    const m = text.match(/Total price of the booking\s*([€$£]|EUR|GBP|USD|TRY)?\s*([\d.,]+)/i);
    if (m) {
      out.totalAmount = parseMoney(m[2]);
      out.currency = detectCurrency(m[1] || '') || null;
    }
  }

  return out;
}

// THY "Elektronik Bilet" (Turkish tax e-ticket) PDFs — no 6-letter PNR, data
// is a block of unlabeled values at the bottom of the page. Unique markers:
// "Elektronik Bilet" header, "TCKN:" (Turkish tax ID) and "SEYAHAT/TRAVEL".
// Layout of the data block (values only, labels at top):
//   <13-digit ticket number>
//   LAST/FIRSTNAMES MR ( TCKN:... )
//   <blank>
//   LAST/FIRSTNAMES MR
//   <13-digit ticket number>
//   DD-MM-YYYY                   (issue date = purchase date)
//   SEYAHAT/TRAVEL
//   SATIŞ/SALE
//   DD-MM-YYYY                   (payment date)
//   KREDİ KARTI/CREDIT CARD
//   0,00 EUR                     (VAT)
//   769,63 EUR                   (total amount)
//   <IATA>/<CITY> <IATA>/<CITY> TK<num> DD/MM/YYYY HH:MM   (per leg)
function extractTHYeTicket(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // Ticket number (used as PNR proxy; these PDFs don't carry a short PNR)
  const ticketM = text.match(/(?:^|\n)(\d{13})(?:\n|$)/);
  if (ticketM) out.pnr = ticketM[1];

  // Passenger — "LAST/FIRSTNAMES TITLE" (title ∈ MR/MRS/MS/MISS/DR)
  const nameM = text.match(
    /([A-ZÇĞİIÖŞÜ]+)\/([A-ZÇĞİIÖŞÜ ]+?)\s+(MR|MRS|MS|MISS|DR)\b/
  );
  if (nameM) {
    const last = nameM[1];
    const first = nameM[2].trim();
    out.passengers = [titleCase(`${first} ${last}`)];
  }

  // Purchase date — "DD-MM-YYYY" followed by "SEYAHAT/TRAVEL"
  const pdM = text.match(/(\d{2})-(\d{2})-(\d{4})\s*\n\s*SEYAHAT\/TRAVEL/i);
  if (pdM) out.purchaseDate = new Date(Date.UTC(+pdM[3], +pdM[2] - 1, +pdM[1]));

  // Total amount — second of the two "X,XX EUR" lines (first is VAT, second
  // is the total). Accept EUR / GBP / USD / TRY / TL.
  const totM = text.match(
    /[\d.,]+\s*(EUR|GBP|USD|TRY|TL)\s*\n\s*([\d.,]+)\s*(EUR|GBP|USD|TRY|TL)/i
  );
  if (totM) {
    out.totalAmount = parseMoney(totM[2]);
    const cur = totM[3].toUpperCase();
    out.currency = cur === 'TL' ? 'TRY' : cur;
  }

  // Flight legs — "<IATA1>/<CITY1> <IATA2>/<CITY2> <CC><num> DD/MM/YYYY HH:MM"
  {
    const legs = [];
    const re = /([A-Z]{3})\/([A-ZÇĞİIÖŞÜ]+)\s+([A-Z]{3})\/([A-ZÇĞİIÖŞÜ]+)\s+([A-Z]{2})\s?(\d{1,5})\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      legs.push({
        flightNumber: `${m[5]}${m[6]}`,
        airline: 'THY',
        departureDate: new Date(Date.UTC(+m[9], +m[8] - 1, +m[7])),
        departureTime: decimalTime(`${m[10]}:${m[11]}`),
        departureAirport: airportFromIATA(m[1]) || titleCase(m[2]),
        arrivalAirport: airportFromIATA(m[3]) || titleCase(m[4])
      });
    }
    out.legs = legs;
  }

  return out;
}

// Brussels Airlines passenger-facing e-ticket (distinct from the short booking
// confirmation handled by extractBrusselsAirlines). One passenger per PDF,
// multi-leg, flight blocks laid out as labeled key/value pairs on separate
// lines.
function extractBrusselsAirlinesETicket(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // Passenger — first non-blank line before "Contact Page"
  {
    const m = text.match(/\n\s*([A-ZÇĞİIÖŞÜ][A-ZÇĞİIÖŞÜ '\-]{2,})\s*\n\s*Contact Page/);
    if (m) out.passengers = [titleCase(m[1].trim())];
  }

  // PNR — "Booking reference\n<PNR>"
  {
    const m = text.match(/Booking reference\s*\n\s*([A-Z0-9]{5,})/i);
    if (m) out.pnr = m[1];
  }

  // Purchase date — "Issued DD/MM/YYYY"
  {
    const m = text.match(/Issued\s+(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) out.purchaseDate = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }

  // Flight legs — blocks of:
  //   Flight\n<SN####>\nFrom\n<City> (IATA)\n<Airport>\nto\n<City> (IATA)\n
  //   <Airport>\nDeparture date\n<DD Month YYYY>\nDeparture time\n<HH:MM>
  {
    const re = /Flight\s*\n\s*([A-Z]{2})\s*(\d{2,5})\s*\nFrom\s*\n\s*([^\n(]+?)\s*\(([A-Z]{3})\)[\s\S]*?to\s*\n\s*([^\n(]+?)\s*\(([A-Z]{3})\)[\s\S]*?Departure date\s*\n\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\nDeparture time\s*\n\s*(\d{1,2}):(\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const mon = MONTH_MAP[m[8].toLowerCase()];
      if (mon == null) continue;
      out.legs.push({
        flightNumber: `${m[1]}${m[2]}`,
        airline: airlineFromCode(m[1]) || 'Brussels Airlines',
        departureDate: new Date(Date.UTC(+m[9], mon, +m[7])),
        departureTime: decimalTime(`${m[10]}:${m[11]}`),
        departureAirport: airportFromIATA(m[4]) || titleCase(m[3]),
        arrivalAirport: airportFromIATA(m[6]) || titleCase(m[5])
      });
    }
  }

  // Total — currency header ("EUR") then later "Grand total\n<amount>"
  {
    const cur = (text.match(/\n(EUR|USD|GBP|TRY)\s*\nFare/i) || [])[1];
    const m = text.match(/Grand total\s*\n\s*([\d.,]+)/i);
    if (m) {
      out.totalAmount = parseMoney(m[1]);
      out.currency = cur ? cur.toUpperCase() : 'EUR';
    }
  }

  return out;
}

// easyJet payment confirmation — multi-pax via Qty column, no passenger names
// visible in the PDF. Two-line route format:
//   <BookingDate>  <From> to
//   <To>           <FlightRef> <FlightDate> Flight (Smart+) <Qty> Segment <Amount> <Currency>
function extractEasyJetPayment(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR + Issue Date (fallback only — actual purchase date comes from the
  // "Booking Date" column on the flight row, which we capture below).
  // Header columns are concatenated without spaces in the PDF
  // ("Booking ReferenceKBVSBMKIssue Date20/01/2026"), so use \s* between
  // labels and values.
  {
    const m = text.match(/Booking Reference\s*([A-Z0-9]+)\s*Issue Date\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) {
      out.pnr = m[1];
      out.purchaseDate = new Date(Date.UTC(+m[4], +m[3] - 1, +m[2]));
    }
  }

  // Passengers — not named in PDF. Use Qty from first flight row as count of
  // anonymous passengers so the per-row amount divides correctly.
  let paxCount = 1;

  // Flights — first DD/MM/YYYY on each row is the BOOKING date (when the
  // ticket was purchased), the second is the FLIGHT date.
  let firstBookingDate = null;
  {
    const re = /(\d{2})\/(\d{2})\/(\d{4})\s+([A-Za-z][^\n]*?)\s+to\s*\n?\s*([A-Za-z][^\n]*?)\s+([A-Z]{2,3})(\d{2,5})\s+(\d{2})\/(\d{2})\/(\d{4})[\s\S]{0,80}?(\d{1,2})\s+Segment/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const code = m[6].toUpperCase();
      out.legs.push({
        flightNumber: `${code}${m[7]}`,
        airline: airlineFromCode(code) || 'easyJet',
        departureDate: new Date(Date.UTC(+m[10], +m[9] - 1, +m[8])),
        departureTime: null,
        departureAirport: cleanAirport(m[4]),
        arrivalAirport: cleanAirport(m[5])
      });
      if (!firstBookingDate) {
        firstBookingDate = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
      }
      paxCount = Math.max(paxCount, +m[11]);
    }
  }
  // Booking Date wins over Issue Date — that's the day the ticket was paid.
  if (firstBookingDate) out.purchaseDate = firstBookingDate;
  // Anonymous passenger slots — empty strings so user can fill names later.
  out.passengers = Array.from({ length: paxCount }, () => '');

  // Total
  {
    const m = text.match(/Grand Total\s+([\d.,]+)\s+([A-Z]{3})/i);
    if (m) {
      out.totalAmount = parseMoney(m[1]);
      out.currency = m[2];
    }
  }

  return out;
}

function cleanAirport(s) {
  return titleCase(
    s.replace(/\bIntl\b\.?/i, 'International')
     .replace(/\s+/g, ' ')
     .trim()
  );
}

// easyJet booking confirmation — only destination city, date range, total,
// and PNR. Emit one leg (to the destination on the first date) so the row
// gets written; user fills in the rest manually.
function extractEasyJetBooking(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // De-artifact: easyJet rendering splits drop-cap letters into separate
  // glyph runs, so day/month labels come through as "F eb", "F ri", etc.
  // Re-join those before running pattern matches.
  const t = text.replace(
    /\b([JFMASOND])\s+(an|eb|ar|pr|ay|un|ul|ug|ep|ct|ov|ec|ri|on|ue|hu|at)\b/gi,
    '$1$2'
  );

  const pnrM = t.match(/Booking ref:\s*\n?\s*([A-Z0-9]{5,})/i);
  if (pnrM) out.pnr = pnrM[1];

  // Purchase date from the confirmation URL header "DD/MM/YYYY, HH:MM"
  const pdM = t.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*\d{1,2}:\d{2}\s*\n?\s*Confirmation/);
  if (pdM) out.purchaseDate = new Date(Date.UTC(+pdM[3], +pdM[2] - 1, +pdM[1]));

  // Destination city + IATA + date range
  //   Milan Linate (LIN)\nMon 23 Feb 2026 - Fri 27 Feb 2026
  const dest = t.match(
    /\n([A-Za-zÇĞİIÖŞÜ ]+?)\s*\(([A-Z]{3})\)\s*\n\s*[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*[A-Za-z]+\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/
  );
  if (dest) {
    const mon1 = MONTH_MAP[fullMonth(dest[4])] ?? MONTH_MAP[dest[4].toLowerCase()];
    if (mon1 != null) {
      out.legs.push({
        flightNumber: null,
        airline: 'easyJet',
        departureDate: new Date(Date.UTC(+dest[5], mon1, +dest[3])),
        departureTime: null,
        departureAirport: '',
        arrivalAirport: airportFromIATA(dest[2]) || titleCase(dest[1])
      });
    }
  }

  // Total — "€2,968.47" after "Total Price:"
  const totM = text.match(/Total Price:\s*\n?\s*([€$£])?\s*([\d.,]+)/i);
  if (totM) {
    out.totalAmount = parseMoney(totM[2]);
    out.currency = detectCurrency(totM[1] || '') || 'EUR';
  }

  // Anonymous single passenger — no names in PDF.
  out.passengers = [''];

  return out;
}

// Finnair e-ticket — stacked city/airport blocks followed by a flight row.
// Layout per leg:
//   <City>\n<City>\n<Airport>\n<City>\n<City>\n<Airport>\n
//   <AY####> <Class> <DDmmm> <HH:MM> <HH:MM> Ok ...
// Year comes from the issue date ("FINNAIR DDmmmYY") at the bottom.
function extractFinnair(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR
  {
    const m = text.match(/Booking Reference\s*:?\s*([A-Z0-9]{5,})/i);
    if (m) out.pnr = m[1];
  }

  // Issue date — "FINNAIR DDMMMYY" (e.g. "FINNAIR 02Dec25")
  let issueYear = null;
  {
    const m = text.match(/FINNAIR\s+(\d{2})([A-Za-z]{3})(\d{2})\b/);
    if (m) {
      const mon = MONTH_MAP[fullMonth(m[2])];
      if (mon != null) {
        const yyyy = 2000 + +m[3];
        issueYear = yyyy;
        out.purchaseDate = new Date(Date.UTC(yyyy, mon, +m[1]));
      }
    }
  }

  // Passenger — "<Last> <First> <Title> (ADT)"
  {
    const m = text.match(
      /\n([A-Z][A-Za-zÇĞİIÖŞÜçğıöşü'\-]+)\s+([A-Z][A-Za-zÇĞİIÖŞÜçğıöşü'\-]+(?:\s+[A-Z][A-Za-zÇĞİIÖŞÜçğıöşü'\-]+)*)\s+(Mr|Mrs|Ms|Miss|Dr)\s*\(ADT\)/
    );
    if (m) out.passengers = [titleCase(`${m[2]} ${m[1]}`)];
  }

  // Flight legs
  {
    const re = /\n([A-Z][A-Z ]+)\n([A-Z][A-Z ]+)\n([A-Z][A-Z ]+)\n([A-Z][A-Z ]+)\n([A-Z][A-Z ]+)\n([A-Z][A-Z ]+)\n([A-Z]{2})(\d{2,5})\s+[A-Z]\s+(\d{2})([A-Za-z]{3})\s+(\d{2}):(\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const mon = MONTH_MAP[fullMonth(m[10])];
      if (mon == null) continue;
      // Year: use issue year; if flight month precedes issue month, bump to next year.
      let y = issueYear || new Date().getUTCFullYear();
      if (out.purchaseDate && mon < out.purchaseDate.getUTCMonth()) y += 1;
      const depCity = m[1].trim();
      const arrCity = m[4].trim();
      out.legs.push({
        flightNumber: `${m[7]}${m[8]}`,
        airline: airlineFromCode(m[7]) || 'Finnair',
        departureDate: new Date(Date.UTC(y, mon, +m[9])),
        departureTime: decimalTime(`${m[11]}:${m[12]}`),
        departureAirport: titleCase(depCity),
        arrivalAirport: titleCase(arrCity)
      });
    }
  }

  // Grand Total
  {
    const m = text.match(/Grand Total\s*[:\s]*\s*([A-Z]{3})\s+([\d.,]+)/i);
    if (m) {
      out.currency = m[1];
      out.totalAmount = parseMoney(m[2]);
    }
  }

  return out;
}

function fullMonth(mmm) {
  const m = (mmm || '').toLowerCase();
  const map = {
    jan: 'january', feb: 'february', mar: 'march', apr: 'april',
    may: 'may', jun: 'june', jul: 'july', aug: 'august',
    sep: 'september', oct: 'october', nov: 'november', dec: 'december'
  };
  return map[m] || m;
}

// Wizz Air tax invoice — one ticket per PDF; passenger name not present.
// Route shown as "Flight ticket (CRL-IAS)". Date of performance = departure.
function extractWizzAirInvoice(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [''],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR — from the first line after the "INVOICE NUMBER INVOICE DATE PNR" header
  {
    const m = text.match(
      /INVOICE NUMBER\s+INVOICE DATE\s+PNR\s*\n\s*\S+\s+(\d{4})\.(\d{2})\.(\d{2})\s+([A-Z0-9]{5,})/i
    );
    if (m) {
      out.pnr = m[4];
      out.purchaseDate = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    }
  }

  // Date of performance = departure date
  let depDate = null;
  {
    const m = text.match(
      /DATE OF PERFORMANCE[\s\S]*?\n\s*(\d{4})\.(\d{2})\.(\d{2})/i
    );
    if (m) depDate = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  // Route — "Flight ticket (CRL-IAS)"
  {
    const m = text.match(/Flight ticket\s*\(([A-Z]{3})-([A-Z]{3})\)/i);
    if (m) {
      out.legs.push({
        flightNumber: null,
        airline: 'Wizzair',
        departureDate: depDate,
        departureTime: null,
        departureAirport: airportFromIATA(m[1]) || m[1],
        arrivalAirport: airportFromIATA(m[2]) || m[2]
      });
    }
  }

  // Total — last "TOTAL <amount>" line with currency column
  {
    const m = text.match(/\bTOTAL\s+[\d.,]+\s+[\d.,]+\s+[\d.,]+\s+([\d.,]+)\s+([A-Z]{3})/i);
    if (m) {
      out.totalAmount = parseMoney(m[1]);
      out.currency = m[2];
    } else {
      // Fallback: "TOTAL <amount> <amount> <amount> <currency>"
      const m2 = text.match(/TOTAL\s+([\d.,]+)[\s\S]*?([A-Z]{3})\s*$/im);
      if (m2) {
        out.totalAmount = parseMoney(m2[1]);
        out.currency = m2[2];
      }
    }
  }

  return out;
}

// Ryanair itinerary (passenger-facing, as opposed to the tax invoice) —
// contains PNR, single leg, passenger list, and total. PDF text has stray
// mid-word spaces ("Charler oi", "Andr eas", "y ears", "F are"); each
// section parses those out locally.
function extractRyanairItinerary(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // De-artifact common fragments (appear verbatim in the PDF due to font
  // kerning quirks). Conservative — only merges tokens that are unambiguous.
  const t = text
    .replace(/Charler\s+oi/g, 'Charleroi')
    .replace(/Andr\s+eas/g, 'Andreas')
    .replace(/Erso\s+yak/g, 'Ersoyak')
    .replace(/\by\s+ears\b/g, 'years')
    .replace(/\bF\s+are\b/g, 'Fare')
    .replace(/\bF\s+ebruary\b/gi, 'February')
    .replace(/\bFEBRU\s+ARY\b/gi, 'FEBRUARY');

  // PNR
  {
    const m = t.match(/RESERVATION NUMBER:\s*([A-Z0-9]{5,})/i);
    if (m) out.pnr = m[1];
  }

  // Purchase date — "LAST UPDATE: DD Mon YYYY" or fallback to the "DD/MM/YYYY" in the footer
  {
    const m = t.match(/LAST UPDATE:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
    if (m) {
      const mon = MONTH_MAP[fullMonth(m[2])] ?? MONTH_MAP[m[2].toLowerCase()];
      if (mon != null) out.purchaseDate = new Date(Date.UTC(+m[3], mon, +m[1]));
    }
    if (!out.purchaseDate) {
      const m2 = t.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*\d{1,2}:\d{2}\s+Ryanair/);
      if (m2) out.purchaseDate = new Date(Date.UTC(+m2[3], +m2[2] - 1, +m2[1]));
    }
  }

  // Leg — "<From> to <To>\n<SubCity>\n<DD Month, YYYY> HH:MM - HH:MM <FR####> RYANAIR"
  {
    const re = /([A-Za-z][A-Za-z ]*?)\s+to\s+([A-Za-z][A-Za-z ]*?)\n([A-Za-z][A-Za-z ]*?)\n(\d{1,2})\s+([A-Za-z]+),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*-\s*\d{1,2}:\d{2}\s+(FR)(\d{2,5})\s+RYANAIR/i;
    const m = t.match(re);
    if (m) {
      const mon = MONTH_MAP[fullMonth(m[5])] ?? MONTH_MAP[m[5].toLowerCase()];
      if (mon != null) {
        // For multi-airport cities (e.g. Brussels has BRU + CRL), Ryanair
        // puts the specific airport on its own line — prefer that over the
        // parent city so the Excel mapping matches the IATA convention.
        out.legs.push({
          flightNumber: `${m[9]}${m[10]}`,
          airline: 'Ryanair',
          departureDate: new Date(Date.UTC(+m[6], mon, +m[4])),
          departureTime: decimalTime(`${m[7]}:${m[8]}`),
          departureAirport: titleCase(m[1].trim()),
          arrivalAirport: titleCase((m[3] || m[2]).trim())
        });
      }
    }
  }

  // Passengers — name on the line before "Adult (16+ years)"
  {
    const re = /\n([A-Za-zÇĞİIÖŞÜçğıöşü'\- ]+?)\nAdult\s*\(16\+\s*years\)/g;
    const names = [];
    let m;
    while ((m = re.exec(t)) !== null) {
      const nm = m[1].trim();
      if (nm && !names.includes(nm)) names.push(titleCase(nm));
    }
    out.passengers = names;
  }

  // Total — "Total paid €438.10"
  {
    const m = t.match(/Total paid\s*([€$£])?\s*([\d.,]+)/i);
    if (m) {
      out.totalAmount = parseMoney(m[2]);
      out.currency = detectCurrency(m[1] || '') || 'EUR';
    }
  }

  return out;
}

// Ryanair tax invoice — only a booking reference and amount; no flight
// details or passenger names present in the PDF. Emits a stub leg so the
// row is written.
function extractRyanairInvoice(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [''],
    legs: [],
    totalAmount: null,
    currency: null
  };

  {
    const m = text.match(/Booking\s+R?\s*eference:?\s*([A-Z0-9]{5,})/i);
    if (m) out.pnr = m[1];
  }

  {
    const m = text.match(/Date of payment:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) out.purchaseDate = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }

  {
    const m = text.match(/TOTAL\s+([\d.,]+)\s+[\d.,]+\s+[\d.,]+/i);
    const curM = text.match(/NET\s*\(([A-Z]{3})\)/i);
    if (m) {
      out.totalAmount = parseMoney(m[1]);
      out.currency = curM ? curM[1] : 'EUR';
    }
  }

  // Stub leg so writer emits a row.
  out.legs.push({
    flightNumber: null,
    airline: 'Ryanair',
    departureDate: null,
    departureTime: null,
    departureAirport: '',
    arrivalAirport: ''
  });

  return out;
}

// Merge consecutive same-day chained legs into a single "connecting" leg.
// Criterion (per user spec): leg[i].arrivalAirport === leg[i+1].departureAirport
// AND both legs depart on the same calendar day. Different dates are treated
// as a round trip (e.g. outbound + return) and left alone.
function extractKiwiTicket(raw) {
  // pdf-parse inserts stray spaces inside words ("REZER VASYON", "E skişehir").
  const text = raw
    .replace(/REZER\s+VASYON/gi, 'REZERVASYON')
    .replace(/\bE\s+skişehir\b/g, 'Eskişehir')
    .replace(/Eskişehir\s+,/g, 'Eskişehir,');

  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  const pnrM = text.match(/rezervasyon numarası\s*\(PNR\)\s+([A-Z0-9]{5,8})\b/i);
  if (pnrM) out.pnr = pnrM[1];
  else {
    const km = text.match(/REZERVASYON NUMARASI\s+([\d\s]+?)\n/i);
    if (km) out.pnr = km[1].replace(/\s/g, '');
  }

  // Passengers — "Mr./Mrs./Ms./Dr. <Name>" followed on next line by "<DD> <MonAbbr> <YYYY>"
  {
    const re = /\b(?:Mr|Mrs|Ms|Dr)\.?\s+([A-ZÇĞŞÜİ][A-Za-zÇĞŞÜİçğşüıöİ' -]+?)\s*\n\s*\d{1,2}\s+[A-Za-zÇĞŞÜİçğşüıöİ]{3,}\s+\d{4}/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (seen.has(name)) continue;
      seen.add(name);
      out.passengers.push(name);
    }
  }

  // Legs — for each "Uçuş no: <code>" backtrack to find route / time / date.
  const { AIRPORTS } = require('./airports');
  const flightRe = /Uçuş no:\s*([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})/g;
  let fm;
  while ((fm = flightRe.exec(text)) !== null) {
    const flightCode = fm[1].toUpperCase();
    const flightNum = fm[2];
    const back = text.slice(Math.max(0, fm.index - 700), fm.index);

    // Route header: "<anything> IATA1 → <anything> IATA2" (last one before Uçuş no:)
    let depIata = null, arrIata = null;
    {
      const re = /\b([A-Z]{3})\b\s*→\s*[^\n]*?\b([A-Z]{3})\b/g;
      let m, last = null;
      while ((m = re.exec(back)) !== null) {
        if (AIRPORTS[m[1]] && AIRPORTS[m[2]]) last = m;
      }
      if (last) { depIata = last[1]; arrIata = last[2]; }
    }
    if (!depIata || !arrIata) continue;

    // Departure time — a "HH:MM" line right after the route header
    let depTime = null;
    {
      const m = back.match(/→\s*[^\n]*\n\s*(\d{1,2}:\d{2})\b/);
      if (m) depTime = m[1];
    }

    // Date — the flight date is preceded by a weekday abbreviation:
    //   "Cum, 24 Nis 2026" (Kiwi Turkish). Passenger birth dates look like
    //   "1 Oca 1962" (no weekday prefix) — those are excluded.
    let date = null;
    {
      const re = /\b(Pzt|Sal|Çar|Per|Cum|Cmt|Paz|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[A-Za-zçğüöşı]*\.?,?\s*(\d{1,2})\s+([A-Za-zÇĞŞÜİçğşüıöİ]{3,})\s+(\d{4})/g;
      let m, last = null;
      while ((m = re.exec(back)) !== null) last = m;
      if (last) {
        const mon = MONTH_MAP[last[3].toLowerCase()];
        if (mon != null) date = new Date(Date.UTC(+last[4], mon, +last[2]));
      }
    }

    // Airline — "Taşıyıcı: <name>" closest before Uçuş no:
    let airline = '';
    {
      const m = back.match(/Taşıyıcı:\s*([^\n]+?)\s*\n/);
      if (m) airline = normalizeAirline(m[1].trim());
    }
    if (!airline) airline = airlineFromCode(flightCode);

    out.legs.push({
      flightNumber: `${flightCode}${flightNum}`,
      airline,
      departureDate: date,
      departureTime: decimalTime(depTime),
      departureAirport: airportFromIATA(depIata),
      arrivalAirport: airportFromIATA(arrIata)
    });
  }

  // Merged Kiwi invoice — when the user concatenates the e-ticket with the
  // English Kiwi.com tax invoice, the invoice block carries price + purchase
  // date that the ticket alone doesn't have.
  if (/\bINVOICE\b/.test(text) && /Kiwi\.com\s+s\.r\.o\./i.test(text)) {
    // "Issue Date2026-04-09" → purchase date
    const dateM = text.match(/Issue\s*Date\s*(\d{4})-(\d{2})-(\d{2})/i);
    if (dateM) {
      out.purchaseDate = new Date(Date.UTC(+dateM[1], +dateM[2] - 1, +dateM[3]));
    }

    // Final "Total" line — e.g. "TotalTRY 28843.96". Picks the LAST Total in
    // the document (after Subtotal/Tax) to avoid the per-item price above.
    const totalRe = /\bTotal\s*(TRY|TL|GBP|EUR|USD|[₺£€$])\s*([\d.,]+)/gi;
    let tm, lastTotal = null;
    while ((tm = totalRe.exec(text)) !== null) lastTotal = tm;
    if (lastTotal) {
      out.totalAmount = parseMoney(lastTotal[2]);
      out.currency = detectCurrency(lastTotal[1]);
    }
  }

  return out;
}

function extractSunExpress(text) {
  const out = {
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  const pnrM = text.match(/Booking number[:\s]+([A-Z0-9]{5,8})/i);
  if (pnrM) out.pnr = pnrM[1];

  {
    const m = text.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*\d{1,2}:\d{2}/);
    if (m) out.purchaseDate = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }

  {
    const m = text.match(
      /Passenger details\s*\n([\s\S]*?)(?=Contact information|How was your|©|$)/i
    );
    if (m) {
      const lines = m[1].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        if (/^[A-ZÇĞİIÖŞÜ][A-ZÇĞİIÖŞÜ\s]+$/.test(l) && l.split(/\s+/).length >= 2) {
          out.passengers.push(titleCase(l));
        }
      }
    }
  }

  const legHeaders = [];
  {
    const re = /(?:^|\n)\s*([A-Za-zÇĞİIÖŞÜçğıöşü.\-' ]+?)\s+to\s+([A-Za-zÇĞİIÖŞÜçğıöşü.\-' ]+?)\s*\n\s*(?:Flight number\s*:\s*)?([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      legHeaders.push({
        index: m.index,
        dep: m[1].trim(),
        arr: m[2].trim(),
        flightNumber: `${m[3].toUpperCase()}${m[4]}`
      });
    }
  }

  const dateMatches = [];
  {
    const re = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const mon = MONTH_MAP[m[2].toLowerCase()];
      if (mon != null) {
        dateMatches.push({
          index: m.index,
          date: new Date(Date.UTC(+m[3], mon, +m[1]))
        });
      }
    }
  }

  // Flight times in document order, excluding footer timestamps of the form
  // "DD/MM/YYYY, HH:MM".
  const times = [];
  {
    const re = /(\d{1,2}):(\d{2})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const prev = text.slice(Math.max(0, m.index - 14), m.index);
      if (/\d{2}\/\d{2}\/\d{4},\s*$/.test(prev)) continue;
      times.push({ index: m.index, time: `${m[1]}:${m[2]}` });
    }
  }

  for (let i = 0; i < legHeaders.length; i++) {
    const lh = legHeaders[i];
    let date = null;
    for (let j = dateMatches.length - 1; j >= 0; j--) {
      if (dateMatches[j].index < lh.index) {
        date = dateMatches[j].date;
        break;
      }
    }
    const t = times[i * 2];
    out.legs.push({
      flightNumber: lh.flightNumber,
      airline: 'SunExpress',
      departureDate: date,
      departureTime: t ? decimalTime(t.time) : null,
      departureAirport: lh.dep,
      arrivalAirport: lh.arr
    });
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^Total amount\b/i.test(lines[i].trim())) {
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        const m = lines[j].match(/([₺£€$]|TRY|TL|GBP|EUR|USD)\s*([\d][\d.,\s]*\d)/i);
        if (m) {
          out.totalAmount = parseMoney(m[2]);
          out.currency = detectCurrency(m[1]);
          break;
        }
      }
      break;
    }
  }

  return out;
}

// Eurostar train booking/ticket PDF. The file is usually a "merged" PDF from
// the user combining: outbound ticket page + inbound ticket page + the final
// booking confirmation (with PNR + total). A single-leg booking has only one
// ticket page. Each "Your Eurostar ticket" block becomes one leg.
function extractEurostar(text) {
  const out = {
    type: 'train',
    pnr: null,
    purchaseDate: null,
    passengers: [],
    legs: [],
    totalAmount: null,
    currency: null
  };

  // PNR: "BOOKING REFERENCE / PNR\nQHVPDV" on ticket pages, or
  // "Booking reference QHVPDV" on the confirmation page.
  const pnrM =
    text.match(/BOOKING\s+REFERENCE\s*\/\s*PNR\s*[\r\n]+\s*([A-Z0-9]{5,8})/i) ||
    text.match(/Booking\s+reference\s+([A-Z0-9]{5,8})\b/i);
  if (pnrM) out.pnr = pnrM[1];

  // Purchase date — "Ticket issued on 15/04/26 - 19:44" (ticket page).
  const issueM = text.match(/Ticket\s+issued\s+on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (issueM) {
    const yy = +issueM[3];
    const year = yy < 100 ? 2000 + yy : yy;
    out.purchaseDate = new Date(Date.UTC(year, +issueM[2] - 1, +issueM[1]));
  }

  // Total — confirmation page has "Total€538.00" after the payment line.
  // Fall back to "Card ending NNNN€538.00".
  {
    const re = /\bTotal\s*([€£$₺]|EUR|GBP|USD|TRY)\s*([\d.,]+)/gi;
    let m, last = null;
    while ((m = re.exec(text)) !== null) last = m;
    if (last) {
      out.totalAmount = parseMoney(last[2]);
      out.currency = detectCurrency(last[1]);
    } else {
      const pay = text.match(/Card\s+ending\s+\d+\s*([€£$₺]|EUR|GBP|USD|TRY)\s*([\d.,]+)/i);
      if (pay) {
        out.totalAmount = parseMoney(pay[2]);
        out.currency = detectCurrency(pay[1]);
      }
    }
  }

  // Split into ticket blocks. Each ticket page starts with "Your Eurostar
  // ticket" (sometimes preceded by "\n"). The confirmation page uses
  // "Booking confirmation" as its header.
  const ticketRe = /Your\s+Eurostar\s+ticket[\s\S]*?(?=Your\s+Eurostar\s+ticket|Booking\s+confirmation|$)/gi;
  const seenPax = new Set();
  let tm;
  while ((tm = ticketRe.exec(text)) !== null) {
    const block = tm[0];

    const paxM = block.match(/PASSENGER\s*[\r\n]+\s*([^\r\n]+?)\s*[\r\n]/);
    if (paxM) {
      const name = paxM[1].trim();
      if (name && !seenPax.has(name)) {
        seenPax.add(name);
        out.passengers.push(name);
      }
    }

    // "Monday, 27 Apr 2026"
    let date = null;
    const dateM = block.match(/TRAVEL\s+DATE\s*[\r\n]+\s*[A-Za-z]+,\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (dateM) {
      const mon = MONTH_MAP[dateM[2].toLowerCase()];
      if (mon != null) date = new Date(Date.UTC(+dateM[3], mon, +dateM[1]));
    }

    const fromM = block.match(/\bFROM\s*[\r\n]+\s*([^\r\n]+)/);
    const toM = block.match(/\bTO\s*[\r\n]+\s*([^\r\n]+)/);
    const dep = fromM ? cleanEurostarStation(fromM[1]) : null;
    const arr = toM ? cleanEurostarStation(toM[1]) : null;

    let depTime = null;
    const depTimeM = block.match(/DEPARTING\s*[\r\n]+\s*(\d{1,2}:\d{2})/);
    if (depTimeM) depTime = depTimeM[1];

    let trainNum = '';
    const trainM = block.match(/TRAIN\s+NUMBER\s*[\r\n]+\s*(\d+)/);
    if (trainM) trainNum = trainM[1];

    if (dep && arr) {
      out.legs.push({
        flightNumber: trainNum || null,
        airline: 'Eurostar',
        departureDate: date,
        departureTime: decimalTime(depTime),
        departureAirport: dep,
        arrivalAirport: arr
      });
    }
  }

  return out;
}

// "Brussels Midi / Zuid" → "Brussels Midi"; "London St Pancras Int'l" → "London St Pancras"
function cleanEurostarStation(s) {
  return s
    .replace(/\s*\/.*$/, '')
    .replace(/\s+Int'?l\.?$/i, '')
    .replace(/\s+International$/i, '')
    .trim();
}

function collapseConnections(legs) {
  if (!Array.isArray(legs) || legs.length < 2) return legs;
  const merged = [];
  for (const leg of legs) {
    const prev = merged[merged.length - 1];
    const sameDay =
      prev && prev.departureDate && leg.departureDate
      && +prev.departureDate === +leg.departureDate;
    const chained =
      prev && prev.arrivalAirport
      && leg.departureAirport
      && prev.arrivalAirport === leg.departureAirport;
    if (sameDay && chained) {
      // Extend previous leg to the new destination; keep the first leg's
      // dep time/flight number as primary and append the connecting flight.
      prev.arrivalAirport = leg.arrivalAirport;
      if (leg.flightNumber && leg.flightNumber !== prev.flightNumber) {
        prev.flightNumber = prev.flightNumber
          ? `${prev.flightNumber} / ${leg.flightNumber}`
          : leg.flightNumber;
      }
    } else {
      merged.push({ ...leg });
    }
  }
  return merged;
}

// PDFs often embed icon glyphs in the Private Use Area (U+E000–U+F8FF).
// Strip them so they don't break whitespace-based regex matches.
function cleanPdfText(text) {
  return text
    .replace(/[\uE000-\uF8FF]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function parsePdf(buffer, filePath) {
  // Collect positioned text items per page so we can drop hidden top-banner
  // text (AJet PDFs embed invisible flight info there).
  const positionedPages = [];
  const data = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const pageH = (pageData.view && pageData.view[3] - pageData.view[1]) || 842;
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      // Compute a "line key" per item. For normal (non-rotated) text the
      // key is transform[5] (baseline y). For rotated text (transform[0]===0,
      // matrix like [0,s,-s,0,tx,ty]) the baseline runs vertically, so two
      // items with the same y are actually on different visual lines — use
      // transform[4] (x) as the line key instead. KLM invoices encode the
      // passenger block with 90° rotation; without this, "MPHEKWANE MAKUBU"
      // and "JANE MS" get treated as one line and glued.
      const lineKey = (it) => {
        const t = it.transform;
        const rotated = t[0] === 0 && t[3] === 0 && (t[1] !== 0 || t[2] !== 0);
        return rotated ? `x${t[4]}` : `y${t[5]}`;
      };
      positionedPages.push({
        pageH,
        items: tc.items.map(i => ({
          s: i.str,
          y: +i.transform[5],
          line: lineKey(i),
          rotated: i.transform[0] === 0 && i.transform[3] === 0
        }))
      });
      // Join text items — newline on line-change, and a space between two
      // items on the same line only when there's a real horizontal gap (so
      // AJet's one-glyph-per-run layout doesn't get spaces between every
      // letter).
      let lastLine = null;
      let lastEndX = 0;
      let lastStr = '';
      let lastAvgCharW = 0;
      let out = '';
      for (const it of tc.items) {
        const line = lineKey(it);
        const x = +it.transform[4];
        const w = +it.width || 0;
        if (lastLine === null) {
          out += it.str;
        } else if (lastLine === line) {
          const gap = x - lastEndX;
          const endsWs = /\s$/.test(lastStr);
          const startsWs = /^\s/.test(it.str);
          const threshold = Math.max(0.5, (lastAvgCharW || 0) * 0.5);
          // Two multi-char runs on the same line often represent distinct
          // columns or tokens — PDFs sometimes place them with a tiny
          // x-overlap, so we can't rely on gap alone. But some fonts render
          // a single word across multiple runs (e.g. "Benny Andr" + "eas P
          // Cools"), where both runs have lowercase boundary letters. Only
          // force a space when at least one boundary letter is uppercase.
          const lastCh = lastStr.slice(-1);
          const firstCh = it.str[0] || '';
          const lowerCont = /[a-z]/.test(lastCh) && /[a-z]/.test(firstCh);
          const bothMulti =
            lastStr.length > 1 && it.str.length > 1 && !lowerCont;
          const needSpace =
            !endsWs && !startsWs
            && lastStr.length > 0 && it.str.length > 0
            && (gap > threshold || bothMulti);
          out += (needSpace ? ' ' : '') + it.str;
        } else {
          out += '\n' + it.str;
        }
        lastLine = line;
        lastEndX = x + w;
        lastStr = it.str;
        lastAvgCharW = it.str.length > 0 ? w / it.str.length : lastAvgCharW;
      }
      return out;
    }
  });
  const text = cleanPdfText(data.text || '');

  // Build visibleText excluding items in the top header-banner band
  // (typically contains hidden white-on-banner text that users can't see).
  const HEADER_BAND = 95;
  const vParts = [];
  for (const { pageH, items } of positionedPages) {
    let lastY = null;
    for (const it of items) {
      if (it.y >= pageH - HEADER_BAND) continue;
      if (lastY === null || lastY === it.y) vParts.push(it.s);
      else vParts.push('\n' + it.s);
      lastY = it.y;
    }
    vParts.push('\n');
  }
  const visibleText = cleanPdfText(vParts.join(''));

  // KLM VAT invoice PDFs use a totally different layout (no flight number,
  // tabular columns) — route them to the dedicated extractor.
  const isKLMInvoice =
    /KLM\s+(Royal Dutch Airlines|ROYAL DUTCH AIRLINES)/i.test(text)
    && /\bINVOICE\b/i.test(text)
    && /International Air Ticket/i.test(text);
  // Pegasus "SALES/SATIŞ" tax-invoice PDFs — one ticket block per passenger
  // per fare component; the generic parser picks up only a single total.
  // Matches both English and Turkish variants.
  const isPegasusSales =
    /PEGASUS\s+HAVA/i.test(text)
    && /(Passenger Name|Yolcu Adı)\s*:/i.test(text)
    && /(Total Amount|Toplam)\s*:/i.test(text);
  // Brussels Airlines booking confirmations — multi-pax, multi-leg, with the
  // flight number buried inside a "SN <num>operated by" string that the
  // generic regex doesn't recognize.
  const isBrusselsAirlines =
    /Brussels Airlines/i.test(text)
    && /Your booking reference is/i.test(text);
  // Eurowings itinerary PDFs — "Booking\nnumber\n<PNR>" and "Carrier: Eurowings"
  const isEurowings =
    /\bEurowings\b/i.test(text)
    && /Total price of the booking/i.test(text);
  // THY "Elektronik Bilet" tax e-ticket — Turkish-government invoice format,
  // no short PNR, data block at the bottom without per-value labels.
  const isTHYeTicket =
    /Elektr\s*onik\s+Bilet/i.test(text)
    && /SEYAHAT\/TRAVEL/i.test(text)
    && /TCKN\s*:/i.test(text);
  // Brussels Airlines passenger e-ticket (distinct from booking confirmation:
  // different layout, single pax with vertical key/value blocks).
  const isBrusselsAirlinesETicket =
    /brusselsairlines\.com\/contact-us/i.test(text)
    && /Booking reference/i.test(text)
    && /Ticket number/i.test(text);
  // easyJet payment confirmation — has "PAYMENT CONFIRMATION" header and full
  // flight table.
  const isEasyJetPayment =
    /PAYMENT CONFIRMATION/i.test(text)
    && /easyJet/i.test(text)
    && /Booking Reference/i.test(text);
  // easyJet booking confirmation — website-generated "Confirmation | <PNR> |
  // easyJet.com" footer; minimal flight data.
  const isEasyJetBooking =
    /Confirmation\s*\|\s*[A-Z0-9]+\s*\|\s*easyJet\.com/i.test(text)
    && /Booking ref:/i.test(text);
  // Finnair Electronic Ticket Receipt.
  const isFinnair =
    /Electronic Ticket Receipt/i.test(text)
    && /FINNAIR/i.test(text)
    && /Booking Reference/i.test(text);
  // Wizz Air Malta tax invoice.
  const isWizzAirInvoice =
    /Wizz\s*Air/i.test(text)
    && /Flight ticket\s*\([A-Z]{3}-[A-Z]{3}\)/i.test(text);
  // Ryanair tax invoice (no flight details).
  const isRyanairInvoice =
    /Ryanair/i.test(text)
    && /Invoice for international passenger transport/i.test(text);
  // Ryanair itinerary (passenger-facing website PDF).
  const isRyanairItinerary =
    /RESERVATION NUMBER:/i.test(text)
    && /ryanair\.com/i.test(text)
    && /Flight Information/i.test(text);
  // SunExpress booking confirmation (sunexpress.com/.../itinerary footer).
  const isSunExpress =
    /SunExpress/i.test(text)
    && /Booking number/i.test(text)
    && /sunexpress\.com/i.test(text);
  // Kiwi.com e-ticket (Turkish language, any airline).
  const isKiwiTicket =
    /kiwi\.com/i.test(text)
    && /Uçuş no:/i.test(text);
  // Eurostar train ticket (single or merged Outbound+Inbound+confirmation).
  const isEurostar =
    /\bEurostar\b/i.test(text)
    && /TRAIN\s+NUMBER/i.test(text);

  let parsed;
  if (isEurostar) parsed = extractEurostar(text);
  else if (isKLMInvoice) parsed = extractKLMInvoice(text);
  else if (isPegasusSales) parsed = extractPegasusSales(text);
  else if (isBrusselsAirlinesETicket) parsed = extractBrusselsAirlinesETicket(text);
  else if (isBrusselsAirlines) parsed = extractBrusselsAirlines(text);
  else if (isEurowings) parsed = extractEurowings(text);
  else if (isTHYeTicket) parsed = extractTHYeTicket(text);
  else if (isEasyJetPayment) parsed = extractEasyJetPayment(text);
  else if (isEasyJetBooking) parsed = extractEasyJetBooking(text);
  else if (isFinnair) parsed = extractFinnair(text);
  else if (isWizzAirInvoice) parsed = extractWizzAirInvoice(text);
  else if (isRyanairItinerary) parsed = extractRyanairItinerary(text);
  else if (isRyanairInvoice) parsed = extractRyanairInvoice(text);
  else if (isSunExpress) parsed = extractSunExpress(text);
  else if (isKiwiTicket) parsed = extractKiwiTicket(text);
  else parsed = extractAJet(text, visibleText);
  if (!parsed.type) parsed.type = 'flight';
  // Collapse same-day chained legs (transfers) into single logical flights.
  parsed.legs = collapseConnections(parsed.legs);
  return {
    filePath,
    rawTextPreview: text.slice(0, 4000),
    ...parsed,
    // convenience: total/passenger
    perPassengerAmount:
      parsed.totalAmount != null && parsed.passengers.length
        ? +(parsed.totalAmount / parsed.passengers.length).toFixed(2)
        : null
  };
}

module.exports = {
  parsePdf,
  // exposed for testing
  extractAJet,
  titleCase,
  parseMoney,
  decimalTime,
  normalizeFlightNumber
};
