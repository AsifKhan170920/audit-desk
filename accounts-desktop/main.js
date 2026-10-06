/* ============================================================
   FAIR TAX ACCOUNTING for Windows
   A window around Accounts on the Fair Tax Portal website, for clients.
   The books live in the Fair Tax cloud (shared/acct-cloud.js), so the same
   data is on the website and in this app.
   The admin account is not allowed here: the Google sign-in pages are never
   opened by this window, and the portal refuses the admin when it sees
   window.ftAccounting (preload.js). The admin works on the website.
   ============================================================ */
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path');

const ORIGIN = 'https://asifkhan170920.github.io';
const SITE = ORIGIN + '/audit-desk/';
const START = SITE + 'accounts/';
const ICON = path.join(__dirname, 'assets', 'icon.png');
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.setAppUserModelId('com.fairtax.accounting');
  app.whenReady().then(() => { Menu.setApplicationMenu(null); secureSession(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}

function secureSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()) || '';
    callback(allowed.has(permission) && url.startsWith(ORIGIN));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && (!origin || origin.startsWith(ORIGIN)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 380, minHeight: 500,
    title: 'Fair Tax Accounting', icon: ICON, backgroundColor: '#f3f5f9', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(START);
  const wc = win.webContents;
  /* new windows: printing / PDFs of the app open inside; anything else (and every Google sign-in page) goes to the browser or is refused */
  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(SITE)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, autoHideMenuBar: true, icon: ICON, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } } };
    if (/^(https?|mailto|tel):/i.test(url) && !/accounts\.google\.com|firebaseapp\.com/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN) || url.startsWith('file:') || url.startsWith('blob:') || url.startsWith('data:')) return;
    e.preventDefault();
    if (/^(https?|mailto|tel):/i.test(url) && !/accounts\.google\.com|firebaseapp\.com/i.test(url)) shell.openExternal(url);
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url && url.startsWith(ORIGIN)) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key;
    if (k === 'F5' || (input.control && k.toLowerCase() === 'r')) { e.preventDefault(); if (wc.getURL().startsWith('file:')) win.loadURL(START); else wc.reload(); }
    else if (input.control && input.shift && k.toLowerCase() === 'i') { e.preventDefault(); wc.toggleDevTools(); }
    else if (input.control && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(4, wc.getZoomLevel() + 0.5)); }
    else if (input.control && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); }
    else if (input.control && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
  });
  /* a change the cloud has not taken yet: ask instead of silently ignoring the close */
  wc.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Fair Tax Accounting', message: 'Some changes are not saved to the cloud yet.',
      detail: 'Wait a moment and try again, or close now and lose those changes.',
      buttons: ['Stay', 'Close anyway'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (choice === 1) e.preventDefault();
  });
}
