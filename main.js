const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { parsePdf } = require('./src/pdf-parser');
const { processBatch } = require('./src/excel-writer');
const { fetchRates } = require('./src/fx');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
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
