/* ============================================================
   PHONE NOTIFICATIONS (Android app)
   Turns the reminder list into notifications scheduled on the phone.
   They fire even when the app is closed; opening the app (or any change
   in the CRM) refreshes them. In a normal browser this file does nothing.
   ============================================================ */
(function () {
  'use strict';
  if (window.FTNotify) return;
  var ROOT = (function () { try { return new URL('../', document.currentScript.src).href; } catch (e) { return location.origin + '/audit-desk/'; } })();
  var IDS_KEY = 'ft-notify-ids', LAST_KEY = 'ft-notify-last', MAX = 400;
  var CHANNELS = [
    {id: 'ft-meetings', name: 'Meetings', description: 'Meeting reminders', importance: 5},
    {id: 'ft-leads', name: 'Leads to contact', description: 'Nudges to call or message leads', importance: 4},
    {id: 'ft-clients', name: 'Client care', description: 'Check-ins, missing details, contracts, assignments', importance: 4},
    {id: 'ft-compliance', name: 'Deadlines', description: 'VAT, Corporate Tax, financial statements, audit, bookkeeping, cheques, invoices', importance: 5},
    {id: 'ft-agenda', name: 'Daily agenda', description: 'Morning summary', importance: 3}
  ];
  var CHANNEL_OF = {meeting: 'ft-meetings', lead: 'ft-leads', health: 'ft-clients', missing: 'ft-clients', contract: 'ft-clients', assign: 'ft-clients', agenda: 'ft-agenda'};

  function cap() { return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor : null; }
  function plugin() { var c = cap(); return c && c.Plugins && c.Plugins.LocalNotifications; }
  function me() {
    var m = (window.FT && FT.me) || {};
    return {name: m.name || m.id || '', id: m.id || '', admin: m.role === 'admin'};
  }
  var state = {permission: 'unknown', exact: 'unknown', count: 0, at: null, error: ''};
  try { var last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); if (last) { state.count = last.count; state.at = last.at; } } catch (e) {}

  async function permission(ask) {
    var LN = plugin(); if (!LN) return 'unsupported';
    var p = await LN.checkPermissions();
    if (p.display !== 'granted' && ask) p = await LN.requestPermissions();
    state.permission = p.display;
    try { var ex = await LN.checkExactNotificationSetting(); state.exact = ex.exact_alarm; } catch (e) { state.exact = 'granted'; }
    return p.display;
  }
  var channelsMade = false;
  async function channels() {
    if (channelsMade) return; var LN = plugin(); if (!LN || !LN.createChannel) return;
    for (var i = 0; i < CHANNELS.length; i++) { try { await LN.createChannel(Object.assign({visibility: 1, vibration: true, lights: true}, CHANNELS[i])); } catch (e) {} }
    channelsMade = true;
  }

  // schedule everything for the signed-in person for the next 7 days
  async function schedule(db) {
    var LN = plugin(); if (!LN || !db || !window.FTReminders) return {skipped: true};
    try {
      if ((await permission(false)) !== 'granted') { state.error = 'Notifications are off'; return {skipped: true}; }
      await channels();
      var list = FTReminders.compute(db, {days: 7, me: me(), max: MAX});
      var old = []; try { old = JSON.parse(localStorage.getItem(IDS_KEY) || '[]'); } catch (e) {}
      try { var pend = await LN.getPending(); (pend.notifications || []).forEach(function (n) { if (old.indexOf(n.id) < 0) old.push(n.id); }); } catch (e) {}
      var newIds = list.map(function (r) { return r.id; });
      var drop = old.filter(function (id) { return newIds.indexOf(id) < 0; });
      if (drop.length) await LN.cancel({notifications: drop.map(function (id) { return {id: id}; })});
      if (list.length) await LN.schedule({notifications: list.map(function (r) {
        return {id: r.id, title: r.title, body: r.body, largeBody: r.body, schedule: {at: r.at, allowWhileIdle: true}, channelId: CHANNEL_OF[r.kind] || 'ft-compliance',
          smallIcon: 'ic_stat_notify', iconColor: '#0F9D6B', group: r.kind, extra: {route: r.route || '#/reminders', kind: r.kind}};
      })});
      localStorage.setItem(IDS_KEY, JSON.stringify(newIds));
      state.count = list.length; state.at = new Date().toISOString(); state.error = '';
      localStorage.setItem(LAST_KEY, JSON.stringify({count: state.count, at: state.at}));
      return {scheduled: list.length, cancelled: drop.length};
    } catch (e) { state.error = e.message || String(e); console.warn('FTNotify', e); return {error: state.error}; }
  }

  // the dashboard has no CRM data loaded – fetch the shared copy first
  async function scheduleFromCloud() {
    if (!plugin() || !window.FT || !FT.me || !FT.canOpen(FT.me, 'crm')) return {skipped: true};
    var key = FT.APPS.crm.key;
    try { await FT.pull('crm', key); } catch (e) {}
    var raw = localStorage.getItem(key); if (!raw) return {skipped: true};
    try { return await schedule(JSON.parse(raw)); } catch (e) { return {error: e.message}; }
  }

  async function enable() {
    var LN = plugin(); if (!LN) return false;
    var p = await permission(true);
    if (p === 'granted' && state.exact && state.exact !== 'granted') { try { await LN.changeExactNotificationSetting(); } catch (e) {} }
    if (p === 'granted') { if (typeof load === 'function') await schedule(load()); else await scheduleFromCloud(); }
    return p === 'granted';
  }

  function status() {
    if (!plugin()) return null;
    if (state.permission === 'denied') return {ok: false, text: 'Phone notifications are blocked. Allow them in Android Settings → Apps → Fair Tax Portal → Notifications.'};
    if (state.permission !== 'granted') return {ok: false, text: 'Phone notifications are not turned on yet.'};
    var when = state.at ? new Date(state.at).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
    return {ok: true, text: state.count + ' reminders scheduled on this phone for the next 7 days (updated ' + when + ')' + (state.exact && state.exact !== 'granted' ? ' · allow “Alarms & reminders” for exact times' : '') + (state.error ? ' · ' + state.error : '')};
  }

  // tapping a notification opens the right page
  function listen() {
    var LN = plugin(); if (!LN) return;
    LN.addListener('localNotificationActionPerformed', function (ev) {
      var route = (ev && ev.notification && ev.notification.extra && ev.notification.extra.route) || '#/reminders';
      if (/\/crm\/(index\.html)?$/.test(location.pathname) && typeof route === 'string' && route.charAt(0) === '#') { location.hash = route; return; }
      location.href = ROOT + 'crm/' + route;
    });
    var App = cap().Plugins.App;
    if (App && App.addListener) App.addListener('resume', function () {
      if (typeof load === 'function') schedule(load()); else if (window.FT && FT.me) scheduleFromCloud();
    });
  }

  window.FTNotify = {native: function () { return !!plugin(); }, schedule: schedule, scheduleFromCloud: scheduleFromCloud, enable: enable, status: status, permission: permission, _state: state};
  if (plugin()) { listen(); permission(false).catch(function () {}); }
})();
