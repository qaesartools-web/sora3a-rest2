// سرعة — برنامج الكاشير للويندوز
// يفتح نفس الكاشير من الإنترنت (أي تحديث يوصل فوراً) + طباعة مدمجة لكل قسم بدون QZ Tray
'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { createPrinter, makeRenderer, makeVirtualRenderer } = require('./printer');

const START_URL = process.env.SORA_URL || 'https://qaesartools-web.github.io/sora3a-rest2/';
const ALLOWED = new Set(['https://qaesartools-web.github.io', 'https://sora3a.com', 'https://pos.sora3a.com', new URL(START_URL).origin]);
const originOk = (u) => { try { return ALLOWED.has(new URL(u).origin); } catch (e) { return false; } };
const fromApp = (e) => originOk(e.senderFrame && e.senderFrame.url);

// رنة المكالمات والطلبات تشتغل بدون ما أحد يلمس الشاشة
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null, quitting = false, printer = null, simWin = null;

// إعدادات البرنامج على هالحاسبة (وضع تجربة الطابعات)
const cfgFile = () => path.join(app.getPath('userData'), 'sora3a-desktop.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } };
const writeCfg = (c) => { try { fs.writeFileSync(cfgFile(), JSON.stringify(c)); } catch (e) {} };
let testMode = false;

// ── محاكي الطابعات: يعرض الورق اللي كان راح ينطبع ──
const papers = [];
const testDir = () => path.join(app.getPath('documents'), 'Sora3a Test Prints');
function onPaper(p) {
  papers.push(p); if (papers.length > 120) papers.shift();
  openSimulator(false);
  if (simWin && !simWin.isDestroyed() && !simWin.webContents.isLoading()) simWin.webContents.send('sim:paper', p);
}
function openSimulator(focus) {
  if (simWin && !simWin.isDestroyed()) { if (focus) { simWin.show(); simWin.focus(); } return; }
  simWin = new BrowserWindow({
    width: 760, height: 820, title: 'محاكي الطابعات — سرعة', autoHideMenuBar: true, backgroundColor: '#111827',
    icon: path.join(__dirname, 'build', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'simulator-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (focus) simWin.show(); else simWin.showInactive();
  simWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  simWin.webContents.on('will-navigate', (e) => e.preventDefault());
  simWin.loadFile(path.join(__dirname, 'simulator.html'));
  simWin.webContents.on('did-finish-load', () => { papers.forEach((p) => simWin.webContents.send('sim:paper', p)); });
  simWin.on('closed', () => { simWin = null; });
}
const fromSim = (e) => simWin && !simWin.isDestroyed() && e.sender === simWin.webContents;

function openOutside(url) {
  if (/^(https?:|tel:|mailto:|whatsapp:)/i.test(url)) shell.openExternal(url).catch(() => {});
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 800, show: false, backgroundColor: '#0B1220', autoHideMenuBar: true,
    title: 'سرعة — الكاشير', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      additionalArguments: ['--sora-origins=' + [...ALLOWED].join(','), '--sora-version=' + app.getVersion()],
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!originOk(url)) { e.preventDefault(); openOutside(url); } });
  // أول تشغيل بدون نت (قبل ما ينحفظ الكاشير بالجهاز): صفحة تعيد المحاولة وحدها
  wc.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3 && originOk(url)) win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: START_URL } });
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (k === 'f5' || (input.control && k === 'r')) { e.preventDefault(); wc.reload(); }
    else if (k === 'f11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (input.control && input.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }
  });
  // ما يتسكّر بالغلط (إذا تسكّر ما تنطبع الطلبات)
  win.on('close', (e) => {
    if (quitting) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['إغلاق الكاشير', 'إلغاء'], defaultId: 1, cancelId: 1, title: 'سرعة',
      message: 'تريد تسكّر برنامج الكاشير؟', detail: 'إذا تسكّره ما تنطبع الطلبات على هذي الحاسبة.',
    });
    if (r === 0) quitting = true; else e.preventDefault();
  });
  win.on('closed', () => { win = null; app.quit(); });
  win.loadURL(START_URL);
}

function setupIpc() {
  ipcMain.handle('sora:printers', (e) => (fromApp(e) ? printer.printers() : []));
  ipcMain.handle('sora:print', (e, html, opts) => {
    if (!fromApp(e) || typeof html !== 'string' || !html || html.length > 3e6) return { ok: false, error: 'طلب مرفوض' };
    return printer.print(html, opts);
  });
  ipcMain.handle('sora:jobs', (e) => (fromApp(e) ? printer.jobs() : []));
  ipcMain.handle('sora:reprint', (e, id) => (fromApp(e) ? printer.reprint(id) : { ok: false, error: 'طلب مرفوض' }));
  ipcMain.handle('sora:testmode:get', (e) => fromApp(e) && testMode);
  ipcMain.handle('sora:testmode:set', (e, on) => {
    if (!fromApp(e)) return false;
    testMode = !!on; writeCfg({ ...readCfg(), testMode });
    if (testMode) openSimulator(true);
    return testMode;
  });
  ipcMain.handle('sora:simulator:open', (e) => { if (fromApp(e)) openSimulator(true); return true; });
  ipcMain.handle('sim:clear', (e) => { if (fromSim(e)) papers.length = 0; return true; });
  ipcMain.handle('sim:folder', (e) => { if (fromSim(e)) { fs.mkdirSync(testDir(), { recursive: true }); shell.openPath(testDir()); } return true; });
  ipcMain.handle('sim:pdf', (e, f) => { if (fromSim(e) && typeof f === 'string' && f.startsWith(testDir()) && f.endsWith('.pdf')) shell.openPath(f); return true; });
  ipcMain.handle('sora:autostart:get', (e) => fromApp(e) && app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('sora:autostart:set', (e, on) => {
    if (!fromApp(e)) return false;
    app.setLoginItemSettings({ openAtLogin: !!on });
    return !!on;
  });
}

// تحديث البرنامج نفسه تلقائياً (ينزل بالخلفية ويتثبت عند الإغلاق)
function setupUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', () => {});
    autoUpdater.on('update-downloaded', (info) => { if (win && !win.isDestroyed()) win.webContents.send('sora:update', info.version); });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 6 * 3600e3);
  } catch (e) { /* بدون تحديث تلقائي */ }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (simWin && !simWin.isDestroyed()) simWin.destroy(); });

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => {
    cb(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(perm) && originOk(details.requestingUrl || ''));
  });
  testMode = !!readCfg().testMode;
  printer = createPrinter({
    getPrinters: () => (win && !win.isDestroyed() ? win.webContents.getPrintersAsync() : Promise.resolve([])),
    render: makeRenderer(BrowserWindow, app.getPath('temp')),
    virtual: { enabled: () => testMode, render: makeVirtualRenderer(BrowserWindow, app.getPath('temp'), testDir(), onPaper) },
  });
  setupIpc();
  createWindow();
  setupUpdates();
});
