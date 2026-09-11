/* Bridge between the Fair Tax website and Windows (reminders, speech, start with Windows).
   Only the Fair Tax site (and the offline page) can use it. */
const { contextBridge, ipcRenderer } = require('electron');

const TRUSTED = location.origin === 'https://asifkhan170920.github.io' || location.protocol === 'file:';
if (TRUSTED) {
  let speechHandler = null;
  ipcRenderer.on('ft:speech', (_e, ev) => { if (speechHandler) { try { speechHandler(ev); } catch (err) { /* ignore */ } } });
  ipcRenderer.on('ft:navigate', (_e, url) => { try { if (typeof url === 'string' && url.startsWith('https://asifkhan170920.github.io/')) location.href = url; } catch (err) { /* ignore */ } });

  contextBridge.exposeInMainWorld('ftDesktop', {
    platform: 'windows',
    version: () => ipcRenderer.invoke('ft:version'),
    notify: {
      schedule: (list) => ipcRenderer.invoke('ft:schedule', list),
      test: () => ipcRenderer.invoke('ft:test'),
      status: () => ipcRenderer.invoke('ft:status'),
      setAutoStart: (on) => ipcRenderer.invoke('ft:autostart', !!on)
    },
    speech: {
      start: (opts, onEvent) => { speechHandler = typeof onEvent === 'function' ? onEvent : null; return ipcRenderer.invoke('ft:speech-start', { lang: opts && opts.lang ? String(opts.lang) : '' }); },
      stop: () => ipcRenderer.invoke('ft:speech-stop'),
      abort: () => { speechHandler = null; return ipcRenderer.invoke('ft:speech-abort'); }
    },
    retry: () => ipcRenderer.invoke('ft:retry')
  });
}
