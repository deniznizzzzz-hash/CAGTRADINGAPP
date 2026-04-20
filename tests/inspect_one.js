const fs = require('fs');
const pdfParse = require('pdf-parse');
const { parsePdf } = require('../src/pdf-parser');

const file = process.argv[2];
(async () => {
  const buf = fs.readFileSync(file);
  console.log('===== RAW pdf-parse default =====');
  const d = await pdfParse(buf);
  console.log(d.text);
  console.log('\n===== parsePdf result =====');
  const r = await parsePdf(buf, file);
  console.log('pnr:', r.pnr);
  console.log('purchaseDate:', r.purchaseDate);
  console.log('passengers:', r.passengers);
  console.log('legs:', r.legs);
  console.log('total:', r.totalAmount, r.currency);
})();
