const fs = require('fs');
const pdfParse = require('pdf-parse');

const file = process.argv[2] || 'C:/Users/deniz/OneDrive/Desktop/C.A.G. TRADING APP/SAMPLES/düzeltilecek/FINNAIR.pdf';

(async () => {
  const buf = fs.readFileSync(file);
  await pdfParse(buf, {
    pagerender: async (pageData) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      for (const it of tc.items) {
        console.log(`y=${Number(it.transform[5]).toFixed(2)} x=${Number(it.transform[4]).toFixed(2)} w=${it.width.toFixed(2)} s=${JSON.stringify(it.str)}`);
      }
      console.log('--- PAGE BREAK ---');
      return '';
    }
  });
})();
