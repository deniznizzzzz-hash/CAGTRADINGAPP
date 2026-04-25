const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { parsePdf } = require('./src/pdf-parser');
const { processBatch } = require('./src/excel-writer');
const { fetchRates } = require('./src/fx');
const { parseStatementPdf } = require('./src/statement-parser');
const { matchTicketsToStatement } = require('./src/statement-matcher');
const { writeStatementReport } = require('./src/statement-report-writer');

const GITHUB_OWNER = 'deniznizzzzz-hash';
const GITHUB_REPO = 'CAGTRADINGAPP';

let mainWindow;

function createWindow() {
  const { version } = require('./package.json');
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    title: `C.A.G. Trading v${version}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // Prevent the HTML <title> from overriding the versioned window title.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-output-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('select-existing-excel', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select existing Excel file',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('select-pdfs', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF files',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('fetch-rates', async () => {
  return await fetchRates();
});

ipcMain.handle('parse-pdf', async (_evt, filePath) => {
  const buf = fs.readFileSync(filePath);
  return await parsePdf(buf, filePath);
});

ipcMain.handle('process-batch', async (_evt, payload) => {
  return await processBatch(payload);
});

ipcMain.handle('open-path', async (_evt, p) => {
  shell.openPath(p);
});

ipcMain.handle('show-item', async (_evt, p) => {
  shell.showItemInFolder(p);
});

// ---- Statement control ----

ipcMain.handle('parse-statement-pdf', async (_evt, filePath) => {
  const buf = fs.readFileSync(filePath);
  return await parseStatementPdf(buf, filePath);
});

ipcMain.handle('run-statement-check', async (_evt, payload) => {
  // payload: { statementPdfs, ticketPdfs, outputFolder, outputName? }
  // No FX conversion — matcher only compares same-currency amounts (ticket vs
  // txn.amount, or ticket vs txn.foreignAmount when the bank already converted).
  const { statementPdfs, ticketPdfs, outputFolder, outputName } = payload;
  if (!outputFolder) throw new Error('outputFolder is required');

  // Parse all statements, merge their transactions
  const banks = new Set();
  const allTxns = [];
  let periodFrom = null, periodTo = null;
  for (const p of statementPdfs) {
    const buf = fs.readFileSync(p);
    const s = await parseStatementPdf(buf, p);
    if (s.bank === 'unknown') {
      return { ok: false, error: `Unrecognised statement format: ${path.basename(p)}` };
    }
    banks.add(s.bank);
    for (const t of s.transactions) allTxns.push(t);
    if (s.statementPeriod) {
      if (s.statementPeriod.from && (!periodFrom || s.statementPeriod.from < periodFrom)) periodFrom = s.statementPeriod.from;
      if (s.statementPeriod.to && (!periodTo || s.statementPeriod.to > periodTo)) periodTo = s.statementPeriod.to;
    }
  }

  // Parse all tickets
  const tickets = [];
  const parseWarnings = [];
  let skippedTryCount = 0;
  for (const p of ticketPdfs) {
    try {
      const buf = fs.readFileSync(p);
      const parsed = await parsePdf(buf, p);
      if (parsed && (parsed.legs?.length || parsed.passengers?.length)) {
        // TRY tickets are paid via a different channel and never appear on the
        // EUR/GBP statements — silently skip them (don't show as unmatched).
        if (parsed.currency === 'TRY') {
          skippedTryCount++;
          continue;
        }
        tickets.push(parsed);
      } else {
        parseWarnings.push(`${path.basename(p)}: ticket could not be parsed.`);
      }
    } catch (e) {
      parseWarnings.push(`${path.basename(p)}: ${e.message}`);
    }
  }

  const results = matchTicketsToStatement(tickets, allTxns);

  const fmt = (d) => d ? `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}` : '';
  const periodLabel = (periodFrom || periodTo)
    ? `${fmt(periodFrom)} → ${fmt(periodTo)}`
    : '';

  const excelPath = await writeStatementReport({
    outputFolder,
    outputName,
    results,
    statementMeta: {
      banks: Array.from(banks),
      periodLabel,
      statementCount: statementPdfs.length,
      ticketCount: ticketPdfs.length
    }
  });

  return {
    ok: true,
    excelPath,
    summary: {
      matched: results.matches.length,
      unmatchedTickets: results.unmatchedTickets.length,
      unmatchedTxns: results.unmatchedTxns.length,
      skippedTry: skippedTryCount,
      banks: Array.from(banks),
      periodLabel
    },
    warnings: parseWarnings
  };
});

// ---- Updater ----

function httpsRequestFollow(url, opts) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsRequestFollow(res.headers.location, opts).then(resolve, reject);
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const res = await httpsRequestFollow(url, {
    headers: {
      'User-Agent': 'CAGTradingApp-Updater',
      'Accept': 'application/vnd.github+json'
    }
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GitHub ${res.statusCode}`);
  }
  return await new Promise((resolve, reject) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => body += c);
    res.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    res.on('error', reject);
  });
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await httpsRequestFollow(url, {
    headers: { 'User-Agent': 'CAGTradingApp-Updater', 'Accept': 'application/octet-stream' }
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Download ${res.statusCode}`);
  }
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let downloaded = 0;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    res.on('data', chunk => {
      downloaded += chunk.length;
      if (onProgress) onProgress(downloaded, total);
    });
    res.pipe(file);
    file.on('finish', () => file.close(err => err ? reject(err) : resolve()));
    file.on('error', reject);
    res.on('error', reject);
  });
  return destPath;
}

// "1.0.25" vs "1.0.26" → returns <0, 0, or >0.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    );
    const latestVersion = (release.tag_name || '').replace(/^v/i, '');
    const currentVersion = app.getVersion();
    const hasUpdate = latestVersion && compareVersions(latestVersion, currentVersion) > 0;
    const asset = (release.assets || []).find(a => /\.exe$/i.test(a.name));
    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: !!hasUpdate,
      downloadUrl: asset ? asset.browser_download_url : null,
      assetName: asset ? asset.name : null
    };
  } catch (err) {
    return { ok: false, error: err.message, currentVersion: app.getVersion() };
  }
});

ipcMain.handle('install-update', async (_evt, { downloadUrl, assetName }) => {
  try {
    if (!downloadUrl) throw new Error('No download URL.');
    const safeName = (assetName || 'CAGTrading-update.exe').replace(/[^\w.\- ()]/g, '_');
    const destPath = path.join(os.tmpdir(), safeName);
    await downloadToFile(downloadUrl, destPath, (d, t) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', { downloaded: d, total: t });
      }
    });
    // Launch installer, then quit so it can replace the running exe.
    shell.openPath(destPath);
    setTimeout(() => app.quit(), 600);
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
