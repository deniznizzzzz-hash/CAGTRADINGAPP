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
    console.log('\n==================================================');
    console.log('FILE:', f);
    console.log('==================================================');
    const buf = fs.readFileSync(path.join(DIR, f));
    const r = await parsePdf(buf, 'auto');
    console.log('--- RAW TEXT PREVIEW ---');
    console.log(r.rawTextPreview);
    console.log('--- PARSED ---');
    console.log(JSON.stringify(r, (k, v) => k === 'rawTextPreview' ? undefined : v, 2));
  }
})().catch(e => { console.error(e); process.exit(1); });
