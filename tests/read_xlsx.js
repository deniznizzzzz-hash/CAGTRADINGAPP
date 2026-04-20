const ExcelJS = require('exceljs');
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2]);
  wb.worksheets.forEach(ws => {
    console.log('===== Sheet:', ws.name);
    ws.eachRow((r, n) => {
      const vals = [];
      r.eachCell({ includeEmpty: true }, (c) => {
        let v = c.value;
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        vals.push(v == null ? '' : String(v));
      });
      console.log(`${n}: ` + vals.join(' | '));
    });
  });
})();
