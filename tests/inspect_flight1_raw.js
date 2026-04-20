const fs = require('fs');
const pdfParse = require('pdf-parse');

(async () => {
  const buf = fs.readFileSync('C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/DENEME/13U KONTROL ET/Flight #1 (April 26).pdf');
  const data = await pdfParse(buf);
  const text = data.text;
  const lines = text.split(/\r?\n/);
  lines.forEach((l, i) => console.log(String(i).padStart(3, ' ') + ': ' + JSON.stringify(l)));
})();
