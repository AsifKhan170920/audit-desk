/* Tells kazabooks.com it is running inside the Kazabooks app for Windows / Mac (the site then shows the
   app's own sign-in title and no "download the Windows app" link). */
const { contextBridge } = require('electron');
if (/^https:\/\/(test\.)?kazabooks\.com$/.test(location.origin) || location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('kazabooks', { desktop: true, platform: process.platform === 'darwin' ? 'mac' : 'windows' });
}
