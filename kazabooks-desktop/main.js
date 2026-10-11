/* ============================================================
   KAZABOOKS for Windows and Mac
   One window around kazabooks.com with every app of the business: Accounting, Kaza Limousine,
   CRM and Audit Desk. The data stays on the Kazabooks server, so the website and this app
   always show the same; a change to the website reaches the app at once (no app update needed).
     Kazabooks.exe                 opens the businesses (or the one business) of the user
     Kazabooks.exe --open=crm      opens that app straight away (also from the taskbar / Start menu)
     Kazabooks.exe --test          uses test.kazabooks.com (for trying a change first)
   ============================================================ */
const { app, BrowserWindow, Menu, shell, session, dialog } = require('electron');
const path = require('path'), fs = require('fs');

const TEST = process.argv.includes('--test');
const ORIGIN = TEST ? 'https://test.kazabooks.com' : 'https://kazabooks.com';
const APPS = { accounts: 'Accounting', limousine: 'Kaza Limousine', crm: 'CRM', audit: 'Audit Desk' };
const ICON = path.join(__dirname, 'assets', 'icon.png');
const GOOGLE = /^https:\/\/(accounts\.google\.com|[a-z0-9-]+\.googleusercontent\.com|www\.googleapis\.com|content\.googleapis\.com)\//i;
const CHROME_UA = () => session.defaultSession.getUserAgent().replace(/\s(Electron|kazabooks[^\s]*)\/\S+/gi, '');
let win = null;

function startUrl(argv) {
  const m = (argv || []).map(a => /^--open=(\w+)$/.exec(a)).find(Boolean);
  return ORIGIN + '/' + (m && APPS[m[1]] ? '?next=' + m[1] : '');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore(); win.show(); win.focus();
    if (argv.some(a => a.startsWith('--open='))) win.loadURL(startUrl(argv));
  });
  app.setAppUserModelId('com.kazabooks.desktop');
  app.whenReady().then(() => {
    // Windows: no menu bar. Mac: the usual menus – without the Edit menu Cmd+C / Cmd+V do not work
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' }]) : null);
    secureSession();
    // right-click the taskbar / Start menu icon: open one app straight away
    if (process.platform === 'win32') app.setUserTasks(Object.keys(APPS).map(k => ({
      program: process.execPath, arguments: '--open=' + k + (TEST ? ' --test' : ''), iconPath: process.execPath, iconIndex: 0, title: APPS[k], description: 'Open ' + APPS[k]
    })));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });   // Mac: click on the Dock icon
}

function secureSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()) || '';
    callback(allowed.has(permission) && url.startsWith(ORIGIN));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && (!origin || origin.startsWith(ORIGIN)));
  ses.setUserAgent(CHROME_UA() + ' Kazabooks/' + app.getVersion());   // the site sees a normal Chrome (Google's sign-in refuses "Electron")
}

/* the window remembers its size and place */
const STATE = path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return { width: 1360, height: 880 }; } }
function saveState() { try { if (!win || win.isMinimized()) return; fs.writeFileSync(STATE, JSON.stringify(Object.assign(win.getNormalBounds(), { max: win.isMaximized() }))); } catch (e) {} }

function childOptions(extra) {
  return Object.assign({ width: 1100, height: 800, autoHideMenuBar: true, icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }, extra || {});
}
function external(url) { if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url); }

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1360, height: st.height || 880, minWidth: 380, minHeight: 500,
    title: 'Kazabooks', icon: ICON, backgroundColor: '#f3f5f9', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => win.show());
  ['resize', 'move', 'close'].forEach(ev => win.on(ev, saveState));
  win.loadURL(startUrl(process.argv));
  const wc = win.webContents;

  /* new windows: printing, PDFs and the apps' own pop-ups open inside; Google Drive sign-in (Audit Desk) too;
     anything else goes to the browser */
  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith(ORIGIN + '/') || url.startsWith('blob:' + ORIGIN)) return { action: 'allow', overrideBrowserWindowOptions: childOptions() };
    if (GOOGLE.test(url)) return { action: 'allow', overrideBrowserWindowOptions: childOptions({ width: 520, height: 680 }) };
    external(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/') || url === ORIGIN || /^(file|blob|data):/.test(url)) return;
    e.preventDefault(); external(url);
  });
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && url && url.startsWith(ORIGIN)) win.loadFile(path.join(__dirname, 'offline.html'), { query: { to: url } });
  });
  wc.on('page-title-updated', (e, title) => { e.preventDefault(); win.setTitle(/kazabooks/i.test(title) ? title : title + ' – Kazabooks'); });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key, ctl = input.control || input.meta;
    if (k === 'F5' || (ctl && k.toLowerCase() === 'r')) { e.preventDefault(); if (wc.getURL().startsWith('file:')) win.loadURL(startUrl([])); else wc.reload(); }
    else if (ctl && input.shift && k.toLowerCase() === 'i') { e.preventDefault(); wc.toggleDevTools(); }
    else if (ctl && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(4, wc.getZoomLevel() + 0.5)); }
    else if (ctl && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); }
    else if (ctl && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
    else if (input.alt && k === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { e.preventDefault(); wc.navigationHistory.goBack(); }
    else if (input.alt && k === 'ArrowRight' && wc.navigationHistory.canGoForward()) { e.preventDefault(); wc.navigationHistory.goForward(); }
  });
  /* right-click: copy / paste in fields (no browser menu otherwise) */
  wc.on('context-menu', (e, p) => {
    const items = [];
    if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (p.linkURL && !p.linkURL.startsWith('javascript:')) items.push({ label: 'Open link in the browser', click: () => external(p.linkURL) });
    if (p.misspelledWord && p.dictionarySuggestions.length) items.unshift(...p.dictionarySuggestions.slice(0, 4).map(s => ({ label: s, click: () => wc.replaceMisspelling(s) })), { type: 'separator' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  /* a change the server has not taken yet: ask instead of silently ignoring the close */
  wc.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Kazabooks', message: 'Some changes are not saved to Kazabooks yet.',
      detail: 'Wait a moment and try again, or close now and lose those changes.',
      buttons: ['Stay', 'Close anyway'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (choice === 1) e.preventDefault();
  });
}
