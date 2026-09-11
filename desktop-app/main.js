/* ============================================================
   FAIR TAX for Windows
   A window around the Fair Tax Portal website, plus what a website alone
   cannot do: stay in the system tray, start with Windows, pop up reminders
   with the loud Fair Tax sound even when the window is closed, and speech
   recognition for the AI assistant (Windows speech, via speech\FairTaxSpeech.exe).
   ============================================================ */
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, session, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SITE = 'https://asifkhan170920.github.io/audit-desk/';
const ORIGIN = 'https://asifkhan170920.github.io';
const APP_ID = 'com.fairtax.portal';
const ICON = path.join(__dirname, 'assets', 'icon.png');
const START_HIDDEN = process.argv.includes('--hidden');
// Google sign-in pages the admin login needs (popup)
const AUTH_HOSTS = ['fair-tax-audit-desk.firebaseapp.com', 'accounts.google.com', 'apis.google.com', 'www.google.com', 'accounts.youtube.com', 'myaccount.google.com'];

let win = null, tray = null, soundWin = null, quitting = false;
let settings = { autoStartSet: false, trayTipShown: false };
let reminders = { items: [], fired: {}, updatedAt: null };

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(init);
}

/* ---------------- storage ---------------- */
function file(name) { return path.join(app.getPath('userData'), name); }
function readJson(name, fallback) { try { return Object.assign(fallback, JSON.parse(fs.readFileSync(file(name), 'utf8'))); } catch (e) { return fallback; } }
function writeJson(name, data) { try { fs.writeFileSync(file(name), JSON.stringify(data)); } catch (e) { /* ignore */ } }

/* ---------------- start ---------------- */
function init() {
  settings = readJson('settings.json', settings);
  reminders = readJson('reminders.json', reminders);
  if (!settings.autoStartSet) {               // start with Windows (in the tray) – can be switched off in the tray menu
    setAutoStart(true);
    settings.autoStartSet = true; writeJson('settings.json', settings);
  }
  Menu.setApplicationMenu(null);
  secureSession();
  createSoundWindow();
  createWindow();
  createTray();
  setInterval(checkReminders, 20 * 1000);
  powerMonitor.on('resume', () => setTimeout(checkReminders, 3000));
  setTimeout(checkReminders, 5000);
}

function secureSession() {
  const ses = session.defaultSession;
  // a normal Chrome identity so Google sign-in accepts this window
  ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*fair-tax-portal\/\S+/i, '').replace(/\s*Fair Tax\/\S+/i, ''));
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()) || '';
    callback(allowed.has(permission) && (url.startsWith(ORIGIN) || url.startsWith('file:')));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && (!origin || origin.startsWith(ORIGIN) || origin.startsWith('file:')));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 380, minHeight: 500,
    title: 'Fair Tax', icon: ICON, backgroundColor: '#f3f5f9', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, spellcheck: true }
  });
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
  win.loadURL(SITE);

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* ignore */ }
    if (AUTH_HOSTS.includes(host) || url === 'about:blank') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, parent: win, autoHideMenuBar: true, icon: ICON, webPreferences: { contextIsolation: true, nodeIntegration: false } } };
    }
    if (url.startsWith(SITE)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, autoHideMenuBar: true, icon: ICON, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } } };
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    let host = '';
    try { host = new URL(url).hostname; } catch (err) { /* ignore */ }
    if (url.startsWith(ORIGIN) || url.startsWith('file:') || AUTH_HOSTS.includes(host)) return;
    e.preventDefault();
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url && url.startsWith(ORIGIN)) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key;
    if (k === 'F5' || (input.control && k.toLowerCase() === 'r')) { e.preventDefault(); if (wc.getURL().startsWith('file:')) win.loadURL(SITE); else wc.reload(); }
    else if (input.control && input.shift && k.toLowerCase() === 'i') { e.preventDefault(); wc.toggleDevTools(); }
    else if (input.alt && k === 'ArrowLeft') { e.preventDefault(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
    else if (input.control && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(4, wc.getZoomLevel() + 0.5)); }
    else if (input.control && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); }
    else if (input.control && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
  });
  win.on('session-end', () => { quitting = true; });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!settings.trayTipShown) {
      settings.trayTipShown = true; writeJson('settings.json', settings);
      toast('Fair Tax is still running', 'Reminders keep popping up. Open Fair Tax again from the tray icon near the clock.', null);
    }
  });
}

function showWindow(url) {
  if (!win) return;
  if (url) win.loadURL(url);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createSoundWindow() {
  soundWin = new BrowserWindow({ show: false, width: 10, height: 10, skipTaskbar: true, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
  soundWin.loadFile(path.join(__dirname, 'sound.html'));
}
function playSound(name) { try { if (soundWin && !soundWin.isDestroyed()) soundWin.webContents.send('play', name); } catch (e) { /* ignore */ } }

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (!img.isEmpty()) img = img.resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip('Fair Tax – reminders on');
  tray.on('click', () => showWindow());
  refreshTrayMenu();
}
function refreshTrayMenu() {
  if (!tray) return;
  const auto = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Fair Tax', click: () => showWindow() },
    { label: 'My reminders', click: () => showWindow(SITE + 'crm/#/reminders') },
    { label: 'Send a test reminder', click: () => testReminder() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: auto, click: (item) => { setAutoStart(item.checked); refreshTrayMenu(); } },
    { type: 'separator' },
    { label: 'Quit Fair Tax (reminders stop)', click: () => { quitting = true; stopSpeech(true); app.quit(); } }
  ]));
}
function setAutoStart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--hidden'] }); } catch (e) { /* ignore */ }
}

/* ---------------- reminders ---------------- */
const URGENT = ['meeting', 'vat', 'corporate_tax', 'financial_statements', 'audit', 'bookkeeping', 'pdc', 'invoice', 'task'];
function toast(title, body, route, kind) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title || 'Fair Tax'), body: String(body || ''), icon: ICON, silent: true, timeoutType: 'never' });
  n.on('click', () => showWindow(route ? SITE + 'crm/' + route : undefined));
  n.show();
  if (kind) playSound(URGENT.includes(kind) ? 'urgent' : 'alert');
  return n;
}
function fire(r) {
  const details = Array.isArray(r.details) ? r.details.filter(Boolean).slice(0, 3) : [];
  toast(r.title, [r.body].concat(details).filter(Boolean).join('\n'), r.route || '#/reminders', r.kind || 'task');
}
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const r of reminders.items) {
    const at = new Date(r.at).getTime();
    const key = r.id + '@' + r.at;
    if (!isFinite(at) || reminders.fired[key]) continue;
    if (at <= now && at > now - 6 * 3600 * 1000) { fire(r); reminders.fired[key] = now; changed = true; }
  }
  // forget old "fired" marks
  for (const k of Object.keys(reminders.fired)) if (reminders.fired[k] < now - 9 * 86400 * 1000) { delete reminders.fired[k]; changed = true; }
  if (changed) writeJson('reminders.json', reminders);
}
function testReminder() {
  setTimeout(() => toast('🔔 Test reminder – Fair Tax', 'If you see this and hear the Fair Tax sound, reminders on this computer are working.', '#/reminders', 'vat'), 5000);
  return true;
}

ipcMain.handle('ft:schedule', (_e, list) => {
  if (!Array.isArray(list)) return { ok: false };
  reminders.items = list.slice(0, 600).map((r) => ({
    id: String(r.id), at: new Date(r.at).toISOString(), kind: String(r.kind || ''), title: String(r.title || '').slice(0, 200),
    body: String(r.body || '').slice(0, 400), details: Array.isArray(r.details) ? r.details.slice(0, 4).map((d) => String(d).slice(0, 200)) : [], route: String(r.route || '#/reminders')
  })).filter((r) => r.at !== 'Invalid Date');
  reminders.updatedAt = new Date().toISOString();
  writeJson('reminders.json', reminders);
  checkReminders();
  return { ok: true, count: reminders.items.length };
});
ipcMain.handle('ft:test', () => testReminder());
ipcMain.handle('ft:status', () => {
  const now = Date.now();
  return { ok: true, count: reminders.items.filter((r) => new Date(r.at).getTime() > now).length, updatedAt: reminders.updatedAt, autoStart: app.getLoginItemSettings().openAtLogin, version: app.getVersion() };
});
ipcMain.handle('ft:autostart', (_e, on) => { setAutoStart(on); refreshTrayMenu(); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle('ft:version', () => app.getVersion());
ipcMain.handle('ft:retry', () => { if (win) win.loadURL(SITE); return true; });

/* ---------------- speech (Windows speech recognition) ---------------- */
let speechProc = null, speechFrame = null;
function speechExe() {
  const packaged = path.join(process.resourcesPath || '', 'speech', 'FairTaxSpeech.exe');
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, 'speech-bin', 'FairTaxSpeech.exe');
}
function sendSpeech(frame, ev) { try { if (frame) frame.send('ft:speech', ev); } catch (e) { /* frame gone */ } }
function stopSpeech(abort) {
  const p = speechProc; speechProc = null;
  if (!p) return;
  try { p.stdin.write(abort ? 'abort\n' : 'stop\n'); } catch (e) { /* ignore */ }
  setTimeout(() => { try { p.kill(); } catch (e) { /* ignore */ } }, abort ? 800 : 4000);
}
ipcMain.handle('ft:speech-start', (e, opts) => {
  stopSpeech(true);
  const exe = speechExe();
  if (process.platform !== 'win32' || !fs.existsSync(exe)) return { ok: false, error: 'missing' };
  const frame = e.senderFrame;
  speechFrame = frame;
  let p;
  try { p = spawn(exe, [String((opts && opts.lang) || '')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { return { ok: false, error: 'other|' + err.message }; }
  speechProc = p;
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    if (speechProc !== p) return;
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { const ev = JSON.parse(line); if (ev.type !== 'end') sendSpeech(frame, ev); } catch (err) { /* ignore */ }
    }
  });
  p.stderr.on('data', () => {});
  p.stdin.on('error', () => {});
  p.on('error', (err) => { if (speechProc === p) sendSpeech(frame, { type: 'error', message: 'other|' + err.message }); });
  // only report an end the page did not ask for (helper stopped by itself)
  p.on('exit', () => { if (speechProc === p) { speechProc = null; sendSpeech(frame, { type: 'end' }); } });
  return { ok: true };
});
ipcMain.handle('ft:speech-stop', () => { stopSpeech(false); return true; });
ipcMain.handle('ft:speech-abort', () => { stopSpeech(true); return true; });

app.on('before-quit', () => { quitting = true; stopSpeech(true); });
app.on('window-all-closed', (e) => { /* keep running in the tray */ });
