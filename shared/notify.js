/* ============================================================
   PHONE / COMPUTER NOTIFICATIONS (Android app and Windows app)
   Turns the reminder list into notifications scheduled on the device.
   They fire even when the app is closed; opening the app (or any change
   in the CRM) refreshes them. In a normal browser this file does nothing.
   ============================================================ */
(function () {
  'use strict';
  if (window.FTNotify) return;
  var ROOT = (function () { try { return new URL('../', document.currentScript.src).href; } catch (e) { return location.origin + '/audit-desk/'; } })();
  var IDS_KEY = 'ft-notify-ids', LAST_KEY = 'ft-notify-last', PENDING_KEY = 'ft-pending-action', MAX = 400;
  // v3 channels: soft Fair Tax chimes (need app build SOFT_BUILD+); older builds use the phone's own notification sound
  var SOFT_BUILD = 4;
  var CH = {
    meeting: {id: 'fts-meetings', name: 'Meetings', description: 'Meeting reminders', importance: 5, sound: 'fairtax_urgent.wav'},
    deadline: {id: 'fts-deadlines', name: 'Deadlines', description: 'VAT, Corporate Tax, financial statements, audit, bookkeeping, cheques, invoices', importance: 5, sound: 'fairtax_urgent.wav'},
    lead: {id: 'fts-leads', name: 'Leads to contact', description: 'Nudges to call or message leads', importance: 4, sound: 'fairtax_alert.wav'},
    client: {id: 'fts-clients', name: 'Client care', description: 'Check-ins, missing details, contracts, assignments', importance: 4, sound: 'fairtax_alert.wav'},
    agenda: {id: 'fts-agenda', name: 'Daily agenda', description: 'Morning summary', importance: 4, sound: 'fairtax_alert.wav'}
  };
  var OLD_CHANNELS = ['ft-meetings', 'ft-leads', 'ft-clients', 'ft-compliance', 'ft-agenda', 'fta-meetings', 'fta-deadlines', 'fta-leads', 'fta-clients', 'fta-agenda'];
  var GROUP_OF = {meeting: 'meeting', lead: 'lead', health: 'client', missing: 'client', contract: 'client', assign: 'client', agenda: 'agenda'};
  var LABEL = {meeting: 'Meeting', lead: 'Lead follow-up', health: 'Client check-in', missing: 'Missing details', contract: 'Contract', assign: 'Assignment', agenda: 'Daily agenda',
    vat: 'VAT', corporate_tax: 'Corporate Tax', financial_statements: 'Financial statements', audit: 'Audit', bookkeeping: 'Bookkeeping', pdc: 'Cheque', invoice: 'Invoice', task: 'Task'};

  function cap() { return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor : null; }
  function plugin() { var c = cap(); return c && c.Plugins && c.Plugins.LocalNotifications; }
  function sys() { var c = cap(); return c && c.Plugins && c.Plugins.FTSystem; }
  // Windows app (Fair Tax for Windows): reminders are kept by the app itself, in the tray
  function desk() { try { return window.ftDesktop && window.ftDesktop.notify ? window.ftDesktop.notify : null; } catch (e) { return null; } }
  function plain(r) { return {id: r.id, at: new Date(r.at).toISOString(), kind: r.kind, title: r.title, body: r.body, details: (r.details || []).slice(0, 4), route: r.route || '#/reminders'}; }
  function me() {
    var m = (window.FT && FT.me) || {};
    return {name: m.name || m.id || '', id: m.id || '', admin: m.role === 'admin'};
  }
  var state = {permission: 'unknown', exact: 'unknown', count: 0, at: null, error: '', build: 0, battery: null};
  try { var last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); if (last) { state.count = last.count; state.at = last.at; } } catch (e) {}

  async function appBuild() {
    if (state.build) return state.build;
    try { var info = await cap().Plugins.App.getInfo(); state.build = parseInt(info.build, 10) || 1; } catch (e) { state.build = 1; }
    return state.build;
  }
  async function permission(ask) {
    var LN = plugin(); if (!LN) return 'unsupported';
    var p = await LN.checkPermissions();
    if (p.display !== 'granted' && ask) p = await LN.requestPermissions();
    state.permission = p.display;
    try { var ex = await LN.checkExactNotificationSetting(); state.exact = ex.exact_alarm; } catch (e) { state.exact = 'granted'; }
    try { if (sys()) { var b = await sys().status(); state.battery = !!b.batteryUnrestricted; } } catch (e) {}
    return p.display;
  }
  var prepared = false;
  async function prepare() {
    if (prepared) return; var LN = plugin(); if (!LN) return;
    var loud = (await appBuild()) >= SOFT_BUILD;
    try { for (var i = 0; i < OLD_CHANNELS.length; i++) await LN.deleteChannel({id: OLD_CHANNELS[i]}); } catch (e) {}
    for (var k in CH) {
      var c = Object.assign({visibility: 1, vibration: true, lights: true, lightColor: '#0F9D6B'}, CH[k]);
      if (!loud) { delete c.sound; c.id = c.id.replace('fts-', 'ftd-'); }
      try { await LN.createChannel(c); } catch (e) {}
    }
    try {
      await LN.registerActionTypes({types: [
        {id: 'ft-task', actions: [{id: 'done', title: '✓ Mark done'}, {id: 'next', title: 'Next step done'}, {id: 'snooze', title: 'Snooze 1 hour'}]},
        {id: 'ft-lead', actions: [{id: 'called', title: '📞 Called'}, {id: 'snooze', title: 'Snooze 1 hour'}]},
        {id: 'ft-client', actions: [{id: 'checkin', title: '✓ Checked in'}, {id: 'edit', title: '✎ Update details'}, {id: 'snooze', title: 'Snooze 1 hour'}]},
        {id: 'ft-edit', actions: [{id: 'edit', title: '✎ Update details'}, {id: 'snooze', title: 'Snooze 1 hour'}]},
        {id: 'ft-open', actions: [{id: 'open', title: 'Open'}, {id: 'snooze', title: 'Snooze 1 hour'}]}
      ]});
    } catch (e) {}
    prepared = true;
  }
  function channelFor(kind, loud) {
    var g = GROUP_OF[kind] || 'deadline';
    return loud ? CH[g].id : CH[g].id.replace('fts-', 'ftd-');
  }
  function actionTypeFor(r) {
    if (r.grouped) return 'ft-open';
    if (r.taskId && ['meeting', 'agenda'].indexOf(r.kind) < 0) return 'ft-task';
    if (r.kind === 'lead') return 'ft-lead';
    if (r.kind === 'health') return 'ft-client';
    if (r.kind === 'missing' || r.kind === 'contract' || (r.clientId && !r.taskId && ['vat', 'corporate_tax', 'financial_statements', 'audit', 'bookkeeping'].indexOf(r.kind) >= 0)) return 'ft-edit';
    return 'ft-open';
  }
  function toNotification(r, loud) {
    var details = (r.details || []).slice(0, 8);
    return {
      id: r.id, title: r.title, body: r.body,
      largeBody: details.length ? details.join('\n') : r.body,
      summaryText: LABEL[r.kind] || 'Reminder',
      schedule: {at: r.at, allowWhileIdle: true},
      channelId: channelFor(r.kind, loud),
      sound: loud ? (GROUP_OF[r.kind] === 'meeting' || !GROUP_OF[r.kind] ? 'fairtax_urgent.wav' : 'fairtax_alert.wav') : undefined,
      smallIcon: 'ic_stat_notify', iconColor: '#0F9D6B',
      actionTypeId: actionTypeFor(r),
      autoCancel: true,
      extra: {route: r.route || '#/reminders', kind: r.kind, taskId: r.taskId || '', leadId: r.leadId || '', clientId: r.clientId || '', title: r.title, body: r.body, largeBody: details.join('\n')}
    };
  }

  // schedule everything for the signed-in person for the next 7 days
  async function schedule(db) {
    if (desk() && db && window.FTReminders) {
      try {
        var dl = FTReminders.compute(db, {days: 7, me: me(), max: MAX});
        var res = await desk().schedule(dl.map(plain));
        state.permission = 'granted'; state.count = (res && res.count) || dl.length; state.at = new Date().toISOString(); state.error = '';
        return {scheduled: state.count};
      } catch (e) { state.error = e.message || String(e); return {error: state.error}; }
    }
    var LN = plugin(); if (!LN || !db || !window.FTReminders) return {skipped: true};
    try {
      if ((await permission(false)) !== 'granted') { state.error = 'Notifications are off'; return {skipped: true}; }
      await prepare();
      var loud = (await appBuild()) >= SOFT_BUILD;
      var list = FTReminders.compute(db, {days: 7, me: me(), max: MAX});
      var old = []; try { old = JSON.parse(localStorage.getItem(IDS_KEY) || '[]'); } catch (e) {}
      try { var pend = await LN.getPending(); (pend.notifications || []).forEach(function (n) { if (old.indexOf(n.id) < 0 && !(n.extra && n.extra.snoozed)) old.push(n.id); }); } catch (e) {}
      var newIds = list.map(function (r) { return r.id; });
      var drop = old.filter(function (id) { return newIds.indexOf(id) < 0; });
      if (drop.length) await LN.cancel({notifications: drop.map(function (id) { return {id: id}; })});
      if (list.length) await LN.schedule({notifications: list.map(function (r) { return toNotification(r, loud); })});
      localStorage.setItem(IDS_KEY, JSON.stringify(newIds));
      state.count = list.length; state.at = new Date().toISOString(); state.error = '';
      localStorage.setItem(LAST_KEY, JSON.stringify({count: state.count, at: state.at}));
      return {scheduled: list.length, cancelled: drop.length};
    } catch (e) { state.error = e.message || String(e); console.warn('FTNotify', e); return {error: state.error}; }
  }

  // the dashboard has no CRM data loaded – fetch the shared copy first
  async function scheduleFromCloud() {
    if (!(plugin() || desk()) || !window.FT || !FT.me || !FT.canOpen(FT.me, 'crm')) return {skipped: true};
    var key = FT.APPS.crm.key;
    try { await FT.pull('crm', key); } catch (e) {}
    var raw = localStorage.getItem(key); if (!raw) return {skipped: true};
    try { return await schedule(JSON.parse(raw)); } catch (e) { return {error: e.message}; }
  }

  async function enable() {
    if (desk()) { if (typeof load === 'function') await schedule(load()); else await scheduleFromCloud(); return true; }
    var LN = plugin(); if (!LN) return false;
    var p = await permission(true);
    if (p === 'granted' && state.exact && state.exact !== 'granted') { try { await LN.changeExactNotificationSetting(); } catch (e) {} }
    if (p === 'granted') { if (typeof load === 'function') await schedule(load()); else await scheduleFromCloud(); }
    return p === 'granted';
  }

  // a sample reminder in 8 seconds – close the app to check sound and pop-up
  async function test() {
    if (desk()) { try { await desk().test(); return true; } catch (e) { return false; } }
    var LN = plugin(); if (!LN) return false;
    if ((await permission(true)) !== 'granted') return false;
    await prepare();
    var loud = (await appBuild()) >= SOFT_BUILD;
    var at = new Date(Date.now() + 8000);
    await LN.schedule({notifications: [toNotification({id: 1999000001, kind: 'vat', at: at, route: '#/reminders', title: '🔔 Test reminder – Fair Tax',
      body: 'If you hear the Fair Tax sound with the app closed, reminders are working.',
      details: ['This is how reminders look.', 'Status and next step appear here.', 'Buttons below let you act without opening the page.']}, loud)]});
    return true;
  }
  async function allowBackground() { try { if (sys()) { await sys().allowBackground(); return true; } } catch (e) {} return false; }
  async function openNotificationSettings() { try { if (sys()) { await sys().openNotificationSettings(); return true; } } catch (e) {} return false; }

  function status() {
    if (desk()) {
      var w = state.at ? new Date(state.at).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';
      return {ok: true, desktop: true, loud: true, text: state.at ? state.count + ' reminders set on this computer for the next 7 days (updated ' + w + ') – they pop up even when the window is closed.' + (state.error ? ' · ' + state.error : '') : 'Reminders on this computer are being prepared…'};
    }
    if (!plugin()) return null;
    if (state.permission === 'denied') return {ok: false, text: 'Phone notifications are blocked. Allow them in Android Settings → Apps → Fair Tax → Notifications.'};
    if (state.permission !== 'granted') return {ok: false, text: 'Phone notifications are not turned on yet.'};
    var when = state.at ? new Date(state.at).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
    return {ok: true, text: state.count + ' reminders scheduled on this phone for the next 7 days (updated ' + when + ')' + (state.error ? ' · ' + state.error : ''),
      battery: state.battery, loud: state.build >= SOFT_BUILD, build: state.build, hasSystem: !!sys()};
  }

  // tapping a notification or one of its buttons
  function goCrm(route) {
    if (/\/crm\/(index\.html)?$/.test(location.pathname) && typeof route === 'string' && route.charAt(0) === '#') { location.hash = route; return; }
    location.href = ROOT + 'crm/' + route;
  }
  async function snooze(n) {
    var LN = plugin(); if (!LN) return;
    var loud = (await appBuild()) >= SOFT_BUILD, ex = n.extra || {};
    await LN.schedule({notifications: [{id: (n.id % 1000000000) + 1000000000 + Math.floor(Math.random() * 1000), title: '⏰ ' + (ex.title || n.title || 'Reminder'), body: ex.body || n.body || '',
      largeBody: ex.largeBody || ex.body || '', schedule: {at: new Date(Date.now() + 60 * 60 * 1000), allowWhileIdle: true}, channelId: channelFor(ex.kind, loud),
      smallIcon: 'ic_stat_notify', iconColor: '#0F9D6B', actionTypeId: n.actionTypeId || 'ft-open', extra: Object.assign({}, ex, {snoozed: true})}]});
  }
  function listen() {
    var LN = plugin(); if (!LN) return;
    LN.addListener('localNotificationActionPerformed', function (ev) {
      var n = (ev && ev.notification) || {}, ex = n.extra || {}, act = ev && ev.actionId;
      if (act === 'snooze') { snooze(n); return; }
      if (act && act !== 'tap' && act !== 'open') {
        // do the quick action inside the CRM page (it has the data)
        try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({act: act, taskId: ex.taskId, leadId: ex.leadId, clientId: ex.clientId, kind: ex.kind, at: Date.now()})); } catch (e) {}
        if (window.CRMPLUS && CRMPLUS.runPending) { CRMPLUS.runPending(); return; }
      }
      goCrm(ex.route || '#/reminders');
    });
    var App = cap().Plugins.App;
    if (App && App.addListener) App.addListener('resume', function () {
      if (typeof load === 'function') schedule(load()); else if (window.FT && FT.me) scheduleFromCloud();
    });
  }

  window.FTNotify = {native: function () { return !!(plugin() || desk()); }, desktop: function () { return !!desk(); }, schedule: schedule, scheduleFromCloud: scheduleFromCloud, enable: enable, status: status, permission: permission,
    test: test, allowBackground: allowBackground, openNotificationSettings: openNotificationSettings, PENDING_KEY: PENDING_KEY, _state: state};
  if (plugin()) { listen(); permission(false).catch(function () {}); appBuild(); }
})();
