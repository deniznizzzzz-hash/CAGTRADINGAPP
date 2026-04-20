const fs = require('fs');
const pp = require('../src/pdf-parser');

// Patch collapseConnections to log pre-merge legs
const origParse = pp.parsePdf;

(async () => {
  const buf = fs.readFileSync('C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/DENEME/13U KONTROL ET/Flight #1 (April 26).pdf');

  // Intercept: rewrite module to log
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  const text = data.text;
  const txt = text.replace(/[\uE000-\uF8FF]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // Find all "AJet,VF..." tokens and neighbors
  const flightRe = /(AJet|Anadolujet|SunExpress|Pegasus|THY|Turkish Airlines|KLM|Eurowings|Wizzair|Wizz Air|Brussels Airlines|Ryanair|Lufthansa)[\s,\-]+([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/gi;
  let fm;
  console.log('--- flight matches ---');
  while ((fm = flightRe.exec(txt)) !== null) {
    console.log('idx', fm.index, 'airline', fm[1], 'code', fm[2], 'num', fm[3]);
  }

  console.log('\n--- iatas (known airports) ---');
  const { AIRPORTS } = require('../src/airports');
  const iataRe = /\b([A-Z]{3})\b/g;
  let m;
  while ((m = iataRe.exec(txt)) !== null) {
    if (!AIRPORTS[m[1]]) continue;
    console.log('idx', m.index, m[1], 'ctx:', JSON.stringify(txt.slice(Math.max(0, m.index - 20), m.index + 10)));
  }

  console.log('\n--- times ---');
  const tRe = /\b(\d{1,2}:\d{2})/g;
  while ((m = tRe.exec(txt)) !== null) {
    console.log('idx', m.index, m[1], 'ctx:', JSON.stringify(txt.slice(Math.max(0, m.index - 20), m.index + 10)));
  }
})();
