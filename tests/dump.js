const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

(async () => {
  for (const f of ['Flight #1 (Mar 26).pdf', 'AJet - 12p.pdf']) {
    console.log('================', f, '================');
    const buf = fs.readFileSync(path.join(__dirname, '..', '..', 'SAMPLES', f));
    const d = await pdfParse(buf);
    console.log(d.text);
  }
})();
