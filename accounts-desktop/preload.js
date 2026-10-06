/* Tells the Fair Tax Portal it is running inside the Windows app Fair Tax Accounting
   (clients only: the portal hides the admin Google sign-in and refuses the admin). */
const { contextBridge } = require('electron');
if (location.origin === 'https://asifkhan170920.github.io' || location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('ftAccounting', { desktop: true, platform: 'windows' });
}
