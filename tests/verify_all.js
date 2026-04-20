const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../src/pdf-parser');

const SAMPLES = 'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek';

const files = [
  'AJet - 12p.pdf',
  'Ajet.pdf',
  'SunExpress - 4p.pdf',
  'THY.pdf',
  'KLM.pdf',
  'PEGASUS.pdf',
  'Brussels.pdf',
  'Eurowings.pdf',
  'PEGASUSDENE.pdf',
  'PEGASUSDENEE.pdf',
  'PEGASUSDENEEE.pdf',
  'PEGASUSDENEEEE.pdf',
  'PEGASUSDENEEEEEE.pdf',
  'THYDENE.pdf',
  'THYDENEE.pdf',
  'THYDENEEEEE.pdf',
  'BRUSSELSDENE.pdf',
  'easyjet.pdf',
  'FINNAIR.pdf',
  'Flight #25 to 32 (Feb 26).pdf',
  'Flight #33 to 40 (Feb 26).pdf',
  'Flight #71 to 88 (Feb 26).pdf',
  'TEST/Ryanair 8p.pdf'
].map(f => path.join(SAMPLES, f));

(async () => {
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log('\n==== MISSING:', f);
      continue;
    }
    const buf = fs.readFileSync(f);
    try {
      const r = await parsePdf(buf, f);
      console.log('\n==== ' + path.basename(f));
      console.log('  pnr:', r.pnr);
      console.log('  purchaseDate:', r.purchaseDate);
      console.log('  passengers:', r.passengers);
      console.log('  legs.length:', r.legs && r.legs.length);
      if (r.legs) for (const l of r.legs) console.log('    ', l);
      console.log('  total:', r.totalAmount, r.currency);
    } catch (e) {
      console.log('\n==== ERROR on', f);
      console.log(e.stack);
    }
  }
})();
