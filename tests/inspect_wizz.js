const fs = require('fs');
const { parsePdf } = require('../src/pdf-parser');

(async () => {
  const buf = fs.readFileSync('C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/test edilmemiş/wizz.pdf');
  const r = await parsePdf(buf, 'auto');
  console.log(r.rawTextPreview);
  console.log('------ PARSED ------');
  console.log(JSON.stringify(r, (k, v) => k === 'rawTextPreview' ? undefined : v, 2));
})();
