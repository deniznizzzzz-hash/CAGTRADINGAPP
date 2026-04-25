const state = {
  outputFolder: null,
  existingExcelPath: null,
  pdfs: []  // [{ path, parsed, status }]
};

// Statement-check feature has its own state bucket.
const stmtState = {
  outputFolder: null,
  statements: [], // [{ path }]
  tickets: []     // [{ path }]
};

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
};
const stmtLog = (msg) => {
  const el = $('stmtLog');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
};

// ---- Tabs
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panes = document.querySelectorAll('.tab-content');
  tabs.forEach(t => {
    t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      panes.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const pane = document.getElementById('tab-' + t.dataset.tab);
      if (pane) pane.classList.add('active');
    };
  });
}

// ---- Month/Year selectors
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
function initMonthYear() {
  const sel = $('monthSelect');
  const now = new Date();
  MONTHS_EN.forEach((m, i) => {
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
  const bind = (id, key) => {
    $(id).value = localStorage.getItem(key) || '';
    $(id).addEventListener('input', () => localStorage.setItem(key, $(id).value));
  };
  bind('rateTRY', 'rateTRY');
  bind('rateGBP', 'rateGBP');
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
      <button class="rm" data-i="${idx}">Remove</button>`;
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

// Drop-zone helper — wires drag events + drop handler for a zone that pushes
// into a callback.
function wireDropzone(zoneEl, onPaths) {
  ['dragenter', 'dragover'].forEach(ev =>
    zoneEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.add('hover');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    zoneEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove('hover');
    })
  );
  zoneEl.addEventListener('drop', e => {
    const paths = [];
    for (const f of e.dataTransfer.files) {
      if (f.path && f.path.toLowerCase().endsWith('.pdf')) paths.push(f.path);
    }
    onPaths(paths);
  });
}

wireDropzone($('dropzone'), addPdfs);

// ---- Process
$('processBtn').onclick = async () => {
  try {
    const rates = getManualRates();
    if (!rates.rates.TRY || !rates.rates.GBP) {
      alert('Please enter both TRY and GBP rates.');
      return;
    }
    if (!state.outputFolder) {
      alert('Please select an output folder.');
      return;
    }
    if (!state.pdfs.length) {
      alert('Please add at least one PDF.');
      return;
    }
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === 'append' && !state.existingExcelPath) {
      alert('Please select an existing Excel file.');
      return;
    }
    $('processBtn').disabled = true;
    $('log').textContent = '';
    $('statusText').textContent = 'Processing...';

    // 1) Parse all PDFs
    log(`Parsing ${state.pdfs.length} PDF(s)...`);
    for (const f of state.pdfs) {
      if (!f.parsed) {
        try {
          f.parsed = await window.api.parsePdf(f.path);
          const fname = f.path.split(/[\\/]/).pop();
          log(`  ✓ ${fname} — ${f.parsed.passengers.length} passenger(s), ${f.parsed.legs.length} flight(s), total ${f.parsed.totalAmount ?? '?'} ${f.parsed.currency ?? ''}`);
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
      log('No PDFs parsed successfully.');
      return;
    }

    // 2) Process batch
    log('Writing Excel...');
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
    log(`✓ Excel updated: ${res.excelPath}`);
    log(`✓ ${res.rowsAdded} row(s) added`);
    for (const r of res.renamedPdfs) {
      log(`  PDF → ${r.to.split(/[\\/]/).pop()}`);
    }
    if (res.warnings?.length) {
      log('Warnings:');
      res.warnings.forEach(w => log('  ⚠ ' + w));
    }
    $('statusText').innerHTML =
      `Done. <a href="#" id="openOut">Open folder</a>`;
    $('openOut').onclick = (e) => {
      e.preventDefault();
      window.api.showItem(res.excelPath);
    };
  } catch (e) {
    log('ERROR: ' + e.message);
    $('statusText').textContent = 'Error.';
  } finally {
    $('processBtn').disabled = false;
  }
};

// ==================== STATEMENT CHECK TAB ====================

function renderStmtList(ul, arr, onRemove) {
  ul.innerHTML = '';
  arr.forEach((f, idx) => {
    const li = document.createElement('li');
    const name = f.path.split(/[\\/]/).pop();
    li.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button class="rm" data-i="${idx}">Remove</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.rm').forEach(b => {
    b.onclick = () => {
      onRemove(+b.dataset.i);
    };
  });
}

function refreshStmtList() {
  renderStmtList($('stmtList'), stmtState.statements, i => {
    stmtState.statements.splice(i, 1);
    refreshStmtList();
  });
}
function refreshTicketList() {
  renderStmtList($('ticketList'), stmtState.tickets, i => {
    stmtState.tickets.splice(i, 1);
    refreshTicketList();
  });
}

function addStatements(paths) {
  for (const p of paths) {
    if (stmtState.statements.find(x => x.path === p)) continue;
    stmtState.statements.push({ path: p });
  }
  refreshStmtList();
}

function addStmtTickets(paths) {
  for (const p of paths) {
    if (stmtState.tickets.find(x => x.path === p)) continue;
    stmtState.tickets.push({ path: p });
  }
  refreshTicketList();
}

$('stmtPickBtn').onclick = async () => {
  const paths = await window.api.selectPdfs();
  addStatements(paths);
};
$('ticketPickBtn').onclick = async () => {
  const paths = await window.api.selectPdfs();
  addStmtTickets(paths);
};
$('stmtPickFolderBtn').onclick = async () => {
  const p = await window.api.selectOutputFolder();
  if (p) {
    stmtState.outputFolder = p;
    $('stmtFolderPath').textContent = p;
    $('stmtFolderPath').classList.remove('muted');
  }
};
wireDropzone($('stmtDropzone'), addStatements);
wireDropzone($('ticketDropzone'), addStmtTickets);

$('stmtRunBtn').onclick = async () => {
  try {
    if (!stmtState.statements.length) { alert('Add at least 1 statement PDF.'); return; }
    if (!stmtState.tickets.length)    { alert('Add at least 1 ticket PDF.'); return; }
    if (!stmtState.outputFolder)       { alert('Select an output folder.'); return; }

    $('stmtRunBtn').disabled = true;
    $('stmtLog').textContent = '';
    $('stmtStatusText').textContent = 'Checking...';

    stmtLog(`Checking ${stmtState.statements.length} statement(s), ${stmtState.tickets.length} ticket(s)...`);
    const res = await window.api.runStatementCheck({
      statementPdfs: stmtState.statements.map(s => s.path),
      ticketPdfs: stmtState.tickets.map(t => t.path),
      outputFolder: stmtState.outputFolder
    });

    if (!res.ok) {
      stmtLog('ERROR: ' + res.error);
      $('stmtStatusText').textContent = 'Error.';
      return;
    }

    if (res.warnings?.length) {
      stmtLog('Warnings:');
      res.warnings.forEach(w => stmtLog('  ⚠ ' + w));
    }
    stmtLog(`Banks: ${res.summary.banks.join(', ')}`);
    if (res.summary.periodLabel) stmtLog(`Period: ${res.summary.periodLabel}`);
    stmtLog(`✓ Matched tickets: ${res.summary.matched}`);
    stmtLog(`⚠ Unmatched tickets: ${res.summary.unmatchedTickets}`);
    stmtLog(`  Unmatched card charges: ${res.summary.unmatchedTxns}`);
    if (res.summary.skippedTry) stmtLog(`  (${res.summary.skippedTry} TRY ticket(s) skipped)`);
    stmtLog(`Report: ${res.excelPath}`);
    $('stmtStatusText').innerHTML = `Done. <a href="#" id="stmtOpenOut">Open report</a>`;
    $('stmtOpenOut').onclick = (e) => {
      e.preventDefault();
      window.api.showItem(res.excelPath);
    };
  } catch (e) {
    stmtLog('ERROR: ' + e.message);
    $('stmtStatusText').textContent = 'Error.';
  } finally {
    $('stmtRunBtn').disabled = false;
  }
};

initTabs();
initMonthYear();
initRates();

// ---- Updater
(function initUpdater() {
  const btn = $('checkUpdateBtn');
  const status = $('updateStatus');
  if (!btn || !status) return;

  let pendingUpdate = null; // { downloadUrl, assetName, latestVersion }

  btn.onclick = async () => {
    if (pendingUpdate) {
      // Second click → install
      btn.disabled = true;
      status.textContent = 'Downloading… 0%';
      window.api.onUpdateProgress(({ downloaded, total }) => {
        const pct = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
        status.textContent = `Downloading… ${pct}%`;
      });
      const res = await window.api.installUpdate(pendingUpdate);
      if (!res.ok) {
        status.textContent = 'Error: ' + res.error;
        btn.disabled = false;
      } else {
        status.textContent = 'Installer launched, closing app…';
      }
      return;
    }

    btn.disabled = true;
    status.textContent = 'Checking…';
    const res = await window.api.checkForUpdates();
    btn.disabled = false;
    if (!res.ok) {
      status.textContent = 'Check failed: ' + res.error;
      return;
    }
    if (!res.hasUpdate) {
      status.textContent = `Up to date (v${res.currentVersion}).`;
      return;
    }
    if (!res.downloadUrl) {
      status.textContent = `v${res.latestVersion} available but no download asset.`;
      return;
    }
    pendingUpdate = {
      downloadUrl: res.downloadUrl,
      assetName: res.assetName,
      latestVersion: res.latestVersion
    };
    status.textContent = `v${res.latestVersion} available. Click again to install.`;
    btn.textContent = 'Install Update';
    btn.classList.add('primary');
    btn.classList.remove('secondary');
  };
})();
