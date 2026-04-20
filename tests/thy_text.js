const fs = require('fs');
const { parsePdf } = require('../src/pdf-parser');

(async () => {
  const buf = fs.readFileSync('C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/THYDENEE.pdf');
  const r = await parsePdf(buf, 'thy');
  console.log(r.rawTextPreview);
})();
