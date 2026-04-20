const fs = require('fs');
const pdfParse = require('pdf-parse');

(async () => {
  const buf = fs.readFileSync('C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/THYDENEE.pdf');
  await pdfParse(buf, {
    pagerender: async (pageData) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      for (const it of tc.items) {
        if (/ANKARA|ISTANBUL|DUSSELDORF|ESB|DUS|IST|TK\d|ERGUL|MUSTAFA/.test(it.str)) {
          console.log(`t=[${it.transform.map(n => Number(n.toFixed(2))).join(',')}] w=${it.width.toFixed(2)} s=${JSON.stringify(it.str)}`);
        }
      }
      return '';
    }
  });
})();
