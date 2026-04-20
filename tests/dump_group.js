const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../src/pdf-parser');

const files = [
  'PEGASUSDENEE.pdf',
  'PEGASUSDENEEE.pdf',
  'PEGASUSDENEEEE.pdf',
  'PEGASUSDENEEEEEE.pdf',
  'THYDENE.pdf',
  'THYDENEE.pdf',
  'THYDENEEEEE.pdf'
];
const DIR = 'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/';
(async () => {
  for (const f of files) {
    const p = DIR + f;
    if (!fs.existsSync(p)) { console.log('MISSING', p); continue; }
    const buf = fs.readFileSync(p);
    try {
      const r = await parsePdf(buf, p);
      console.log('==== ' + f);
      console.log('  pnr:', r.pnr);
      console.log('  purchaseDate:', r.purchaseDate);
      console.log('  passengers:', r.passengers);
      console.log('  legs:');
      for (const l of r.legs) console.log('    ', l);
      console.log('  total:', r.totalAmount, r.currency);
    } catch (e) {
      console.log('ERROR', f, e.message);
    }
  }
})();
