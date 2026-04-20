const state = {
  outputFolder: null,
  existingExcelPath: null,
  pdfs: []  // [{ path, parsed, status }]
};

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
};

// ---- Month/Year selectors
const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];
function initMonthYear() {
  const sel = $('monthSelect');
  const now = new Date();
  MONTHS_TR.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = m;
    if (i === now.getMonth()) opt.selected = true;
    sel.appendChild(opt);
  });
  $('yearInput').value = now.getFullYear();
}

// ---- Manual rates (persisted in localStorage)
function initRates() {
  const savedTRY = localStorage.getItem('rateTRY') || '';
  const savedGBP = localStorage.getItem('rateGBP') || '';
  $('rateTRY').value = savedTRY;
  $('rateGBP').value = savedGBP;
  $('rateTRY').addEventListener('input', () => {
    localStorage.setItem('rateTRY', $('rateTRY').value);
  });
  $('rateGBP').addEventListener('input', () => {
    localStorage.setItem('rateGBP', $('rateGBP').value);
  });
}
function parseRateInput(s) {
  if (!s) return NaN;
  return parseFloat(String(s).trim().replace(',', '.'));
}
function getManualRates() {
  const tryN = parseRateInput($('rateTRY').value);
  const gbpN = parseRateInput($('rateGBP').value);
  const rates = {};
  if (tryN > 0) rates.TRY = tryN;
  if (gbpN > 0) rates.GBP = gbpN;
  return {
    base: 'EUR',
    rates,
    date: new Date().toISOString().slice(0, 10),
    source: 'manual'
  };
}

// ---- Output folder
$('pickFolderBtn').onclick = async () => {
  const p = await window.api.selectOutputFolder();
  if (p) {
    state.outputFolder = p;
    $('folderPath').textContent = p;
    $('folderPath').classList.remove('muted');
  }
};

// ---- Existing Excel
$('pickExcelBtn').onclick = async () => {
  const p = await window.api.selectExistingExcel();
  if (p) {
    state.existingExcelPath = p;
    $('excelPath').textContent = p;
    $('excelPath').classList.remove('muted');
    // auto-switch mode to append
    document.querySelector('input[value="append"]').checked = true;
  }
};

// ---- PDF selection & drag-drop
$('pickPdfsBtn').onclick = async () => {
  const paths = await window.api.selectPdfs();
  addPdfs(paths);
};

function addPdfs(paths) {
  for (const p of paths) {
    if (state.pdfs.find(x => x.path === p)) continue;
    state.pdfs.push({ path: p, parsed: null, status: 'pending' });
  }
  renderPdfList();
}
function renderPdfList() {
  const ul = $('pdfList');
  ul.innerHTML = '';
  state.pdfs.forEach((f, idx) => {
    const li = document.createElement('li');
    const name = f.path.split(/[\\/]/).pop();
    li.innerHTML = `
      <span>${escapeHtml(name)} <span class="muted">[${f.status}]</span></span>
      <button class="rm" data-i="${idx}">Sil</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.rm').forEach(b => {
    b.onclick = () => {
      state.pdfs.splice(+b.dataset.i, 1);
      renderPdfList();
    };
  });
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const dz = $('dropzone');
['dragenter', 'dragover'].forEach(ev =>
  dz.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add('hover');
  })
);
['dragleave', 'drop'].forEach(ev =>
  dz.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('hover');
  })
);
dz.addEventListener('drop', e => {
  const paths = [];
  for (const f of e.dataTransfer.files) {
    if (f.path && f.path.toLowerCase().endsWith('.pdf')) paths.push(f.path);
  }
  addPdfs(paths);
});

// ---- Process
$('processBtn').onclick = async () => {
  try {
    const rates = getManualRates();
    if (!rates.rates.TRY || !rates.rates.GBP) {
      alert('Lütfen TRY ve GBP kurlarını elle girin.');
      return;
    }
    if (!state.outputFolder) {
      alert('Lütfen çıktı klasörü seçin.');
      return;
    }
    if (!state.pdfs.length) {
      alert('Lütfen en az bir PDF ekleyin.');
      return;
    }
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === 'append' && !state.existingExcelPath) {
      alert('Lütfen mevcut bir Excel dosyası seçin.');
      return;
    }
    $('processBtn').disabled = true;
    $('log').textContent = '';
    $('statusText').textContent = 'İşleniyor...';

    // 1) Parse all PDFs
    log(`${state.pdfs.length} PDF parse ediliyor...`);
    for (const f of state.pdfs) {
      if (!f.parsed) {
        try {
          f.parsed = await window.api.parsePdf(f.path);
          const fname = f.path.split(/[\\/]/).pop();
          log(`  ✓ ${fname} — ${f.parsed.passengers.length} yolcu, ${f.parsed.legs.length} uçuş, toplam ${f.parsed.totalAmount ?? '?'} ${f.parsed.currency ?? ''}`);
          f.status = 'parsed';
        } catch (e) {
          f.status = 'error';
          log(`  ✗ ${f.path}: ${e.message}`);
        }
      }
    }
    renderPdfList();

    const ok = state.pdfs.filter(x => x.parsed && !x.parsed.__error);
    if (!ok.length) {
      log('Başarılı parse edilen PDF yok.');
      return;
    }

    // 2) Process batch
    log('Excel yazılıyor...');
    const payload = {
      outputFolder: state.outputFolder,
      mode,
      rates,
      parsed: ok.map(x => x.parsed)
    };
    if (mode === 'append') {
      payload.existingExcelPath = state.existingExcelPath;
    } else {
      payload.newExcelMonth = {
        year: +$('yearInput').value,
        monthIndex: +$('monthSelect').value
      };
    }
    const res = await window.api.processBatch(payload);
    log(`✓ Excel güncellendi: ${res.excelPath}`);
    log(`✓ ${res.rowsAdded} satır eklendi`);
    for (const r of res.renamedPdfs) {
      log(`  PDF → ${r.to.split(/[\\/]/).pop()}`);
    }
    if (res.warnings?.length) {
      log('Uyarılar:');
      res.warnings.forEach(w => log('  ⚠ ' + w));
    }
    $('statusText').innerHTML =
      `Tamam. <a href="#" id="openOut">Klasörü aç</a>`;
    $('openOut').onclick = (e) => {
      e.preventDefault();
      window.api.showItem(res.excelPath);
    };
  } catch (e) {
    log('HATA: ' + e.message);
    $('statusText').textContent = 'Hata.';
  } finally {
    $('processBtn').disabled = false;
  }
};

initMonthYear();
initRates();
