const fs = require('fs');
const pdfParse = require('pdf-parse');
(async () => {
  const buf = fs.readFileSync('../SAMPLES/Flight #1 (Mar 26).pdf');
  const d = await pdfParse(buf);
  const t = d.text;
  // Print only the area around "AJet" standalone
  const i = t.indexOf('\nAJet\n');
  console.log('index of \\nAJet\\n:', i);
  console.log('context:', JSON.stringify(t.slice(Math.max(0, i - 20), i + 60)));

  const re = /(AJet|Anadolujet|SunExpress|Pegasus|THY|Turkish Airlines|KLM|Eurowings|Wizzair|Wizz Air|Brussels Airlines|Ryanair|Lufthansa)[,\s]+([A-Z]{2}|[A-Z]\d)\s?(\d{1,4})\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    console.log('MATCH @', m.index, JSON.stringify(m[0]));
  }

  // Try with looser regex — separator allows anything short
  const re2 = /(AJet|SunExpress|Pegasus|THY|KLM|Eurowings|Wizzair|Brussels Airlines|Ryanair|Lufthansa)[\s\S]{0,4}?\b([A-Z]{2}|[A-Z]\d)(\d{1,4})\b/gi;
  let m2;
  while ((m2 = re2.exec(t)) !== null) {
    console.log('LOOSE @', m2.index, JSON.stringify(m2[0]));
  }
})();
