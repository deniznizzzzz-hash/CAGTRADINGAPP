const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../src/pdf-parser');

const DIR = 'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek';
const files = [
  'BRUSSELSDENE.pdf',
  'easyjet.pdf',
  'Eurowings.pdf',
  'FINNAIR.pdf',
  'Flight #25 to 32 (Feb 26).pdf',
  'Flight #33 to 40 (Feb 26).pdf',
  'Flight #71 to 88 (Feb 26).pdf'
];

(async () => {
  for (const f of files) {
    console.log('\n== ' + f + ' ==');
    const buf = fs.readFileSync(path.join(DIR, f));
    const r = await parsePdf(buf, 'auto');
    const summary = {
      pnr: r.pnr,
      purchaseDate: r.purchaseDate && r.purchaseDate.toISOString().slice(0, 10),
      passengers: r.passengers,
      legs: (r.legs || []).map(l => ({
        fn: l.flightNumber,
        al: l.airline,
        dd: l.departureDate && l.departureDate.toISOString().slice(0, 10),
        dt: l.departureTime,
        from: l.departureAirport,
        to: l.arrivalAirport
      })),
      total: r.totalAmount,
      currency: r.currency
    };
    console.log(JSON.stringify(summary, null, 2));
  }
})().catch(e => { console.error(e); process.exit(1); });
