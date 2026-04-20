const fs = require('fs');
const { parsePdf } = require('../src/pdf-parser');

const files = [
  'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/TEST/SunExpress 3p FARKLI.pdf',
  'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/TEST/SunExpress Bugra Unutulmazsoy FARKLI.pdf'
];

(async () => {
  for (const f of files) {
    console.log('\n========================================');
    console.log('FILE:', f);
    console.log('========================================');
    const buf = fs.readFileSync(f);
    const r = await parsePdf(buf, 'auto');
    console.log(r.rawTextPreview);
    console.log('------ PARSED ------');
    console.log(JSON.stringify(r, (k, v) => k === 'rawTextPreview' ? undefined : v, 2));
  }
})();
