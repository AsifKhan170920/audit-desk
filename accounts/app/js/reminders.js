/* ===================== Reminders & notifications =====================
   The shared reminder core (FEATURES_SPEC "Shared contract: Reminders").
   Loaded right after js/ui-modal.js so every later module can register a
   source while it loads.

     Reminders.register(sourceId, fn)   fn(b) -> [{id, title, detail, due:'YYYY-MM-DD',
                                          kind, severity?, link?:{section, id}}]
     Reminders.list(b)                  -> merged, sorted reminders for business b
     Reminders.refresh()                -> re-evaluates the open business, repaints the
                                          bell badge, plays the chime for NEW overdue / due
                                          items (once per item per day) and shows a toast

   Severity: a source may set it ('overdue' | 'due' | 'soon'); when it does not,
   it is worked out here from `due` and the lead days of the item's kind
   (Settings -> Notifications): past -> overdue, today -> due, within the lead
   days -> soon. Items further out than the lead days are left out of list()
   (they appear on the Reminders page under "All dates" only).

   Links: {section:'Sales Invoices', id:5} opens that register and views the
   record; {section:'Settings', setting:'business'} (or id:'business') opens a
   Settings page; {section:'X'} alone opens the tab; link.open (a function) is
   called as is.

   Per-device state (localStorage 'mgr_reminders_state', per business):
     read[key]    = the severity the item had when it was marked read. It stays
                    hidden until its severity changes (soon -> due -> overdue).
     snooze[key]  = 'YYYY-MM-DD' — hidden until that day.
     sounded[key] = 'YYYY-MM-DD' — chimed / toasted that day already.
   key = sourceId + ':' + item id.

   Preferences per business (b.notifications), edited in Settings -> Notifications:
     {sound:true, volume:60, mute:false, lead:{kind:days}, off:{kind:true}}

   Refresh runs when a business opens, ~250 ms after any App.saveBiz (every
   record save goes through it), and every 10 minutes. */
(function (root) {
  'use strict';
  if (root.Reminders && root.Reminders.__v) return;

  function getApp() { try { return typeof App !== 'undefined' ? App : (root.App || null); } catch (e) { return root.App || null; } }
  function doc() { return typeof document !== 'undefined' ? document : null; }
  function hasDom() { var d = doc(); return !!(d && typeof d.createElement === 'function' && typeof d.addEventListener === 'function' && d.body && typeof d.body.appendChild === 'function'); }
  function byId(id) { var d = doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jsq(s) { return esc(JSON.stringify(String(s))); }
  function ico(n, sz) { try { return root.ICO ? root.ICO.get(n, sz || 16) : ''; } catch (e) { return ''; } }
  function fmtDate(iso) { var A = getApp(); try { return A && A.fmtDate ? A.fmtDate(iso) : iso; } catch (e) { return iso; } }

  /* ---------- kinds and defaults ---------- */
  var KINDS = {
    license: { label: 'Trade license & company documents', lead: 60 },
    expiry: { label: 'Employee documents', lead: 30 },
    payroll: { label: 'Payroll', lead: 5 },
    pdc: { label: 'Post-dated cheques', lead: 3 },
    invoice: { label: 'Invoices & bills due', lead: 3 }
  };
  var DEFAULT_LEAD = 7;
  var SEV = { overdue: 0, due: 1, soon: 2, later: 3 };
  var SEV_LABEL = { overdue: 'Overdue', due: 'Due today', soon: 'Upcoming', later: 'Later' };
  var KIND_ICON = { license: 'building', expiry: 'users', payroll: 'wallet', pdc: 'card', invoice: 'invoice' };

  /* ---------- dates (local calendar days, never UTC) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = API._now != null ? new Date(API._now) : new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; }
  function daysUntil(due, from) { var a = dayNum(from || today()), b = dayNum(due); return a == null || b == null ? null : Math.round(b - a); }
  function addDays(s, n) { var x = dayNum(s); if (x == null) return s; var d = new Date((x + n) * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function whenText(days) {
    if (days == null) return '';
    if (days < 0) return (-days) + (days === -1 ? ' day' : ' days') + ' overdue';
    if (days === 0) return 'today';
    return 'in ' + days + (days === 1 ? ' day' : ' days');
  }

  /* ---------- preferences (per business) ---------- */
  function prefs(b) {
    var p = (b && b.notifications) || {};
    return {
      sound: p.sound !== false, volume: p.volume == null || isNaN(+p.volume) ? 60 : Math.max(0, Math.min(100, +p.volume)),
      mute: !!p.mute, lead: Object.assign({}, p.lead || {}), off: Object.assign({}, p.off || {})
    };
  }
  function leadFor(p, kind) {
    var v = p.lead[kind];
    if (v !== undefined && v !== '' && !isNaN(+v)) return Math.max(0, Math.round(+v));
    return KINDS[kind] ? KINDS[kind].lead : DEFAULT_LEAD;
  }

  /* ---------- per-device state ---------- */
  var STATE_KEY = 'mgr_reminders_state';
  function readAll() { try { var s = root.localStorage && root.localStorage.getItem(STATE_KEY); return s ? (JSON.parse(s) || {}) : {}; } catch (e) { return {}; } }
  function writeAll(o) { try { if (root.localStorage) root.localStorage.setItem(STATE_KEY, JSON.stringify(o)); } catch (e) {} }
  function stateOf(bizId) { var all = readAll(), s = all[bizId] || {}; return { read: s.read || {}, snooze: s.snooze || {}, sounded: s.sounded || {} }; }
  function saveState(bizId, s) { var all = readAll(); all[bizId] = s; writeAll(all); }

  /* ---------- sources ---------- */
  var SOURCES = [];
  function register(sourceId, fn) {
    if (!sourceId || typeof fn !== 'function') return false;
    sourceId = String(sourceId);
    var i = SOURCES.findIndex(function (s) { return s.id === sourceId; });
    if (i >= 0) SOURCES[i].fn = fn; else SOURCES.push({ id: sourceId, fn: fn });
    scheduleRefresh();
    return true;
  }
  function unregister(sourceId) { SOURCES = SOURCES.filter(function (s) { return s.id !== String(sourceId); }); scheduleRefresh(); }
  function defineKind(kind, o) { if (!kind) return; KINDS[kind] = Object.assign({ label: kind, lead: DEFAULT_LEAD }, KINDS[kind] || {}, o || {}); if (o && o.icon) KIND_ICON[kind] = o.icon; }

  function normalize(raw, sourceId, p, now) {
    if (!raw || raw.title == null || raw.id == null) return null;
    var due = raw.due ? String(raw.due).slice(0, 10) : '';
    var kind = raw.kind || sourceId;
    var days = due ? daysUntil(due, now) : null;
    var sev = SEV[raw.severity] != null && raw.severity !== 'later' ? raw.severity : null;
    if (!sev) {
      if (days == null) sev = 'soon';
      else if (days < 0) sev = 'overdue';
      else if (days === 0) sev = 'due';
      else sev = days <= leadFor(p, kind) ? 'soon' : 'later';
    }
    return { id: raw.id, key: sourceId + ':' + raw.id, source: sourceId, title: String(raw.title), detail: raw.detail == null ? '' : String(raw.detail),
      due: due, kind: kind, severity: sev, days: days, link: raw.link || null };
  }
  function sortItems(a, b) {
    if (SEV[a.severity] !== SEV[b.severity]) return SEV[a.severity] - SEV[b.severity];
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  }
  /* every item of every source; opts.all keeps 'later' items and switched-off kinds */
  function evaluate(b, opts) {
    opts = opts || {};
    if (!b) return [];
    var p = prefs(b), now = today(), st = stateOf(b.id), out = [], seen = {};
    SOURCES.forEach(function (s) {
      var got = [];
      try { got = s.fn(b) || []; } catch (e) { try { console.warn('Reminders source "' + s.id + '" failed', e); } catch (x) {} got = []; }
      if (!Array.isArray(got)) return;
      got.forEach(function (raw) {
        var it = normalize(raw, s.id, p, now); if (!it || seen[it.key]) return; seen[it.key] = 1;
        if (!opts.all && (it.severity === 'later' || p.off[it.kind])) return;
        it.read = st.read[it.key] === it.severity;
        it.snoozed = !!(st.snooze[it.key] && st.snooze[it.key] > now);
        it.off = !!p.off[it.kind];
        out.push(it);
      });
    });
    return out.sort(sortItems);
  }
  function list(b) { var A = getApp(); if (b === undefined && A && A.curBiz) b = A.curBiz(); return evaluate(b); }
  function attention(items) { return items.filter(function (it) { return !it.read && !it.snoozed; }); }
  function count(b) { return attention(list(b)).length; }

  /* the once-per-item-per-day rule, pure so it can be unit-tested */
  function pickNew(items, sounded, day) {
    sounded = sounded || {}; day = day || today();
    return items.filter(function (it) { return (it.severity === 'overdue' || it.severity === 'due') && !it.read && !it.snoozed && sounded[it.key] !== day; });
  }

  /* ---------- sound (WebAudio, generated — no files) ---------- */
  var AC = null, unlocked = false, pending = 0;
  function audioCtx() {
    if (AC) return AC;
    var C = root.AudioContext || root.webkitAudioContext; if (!C) return null;
    try { AC = new C(); } catch (e) { AC = null; }
    return AC;
  }
  /* a soft two-note chime: A5 then E6, each with a quick attack and a gentle tail */
  function chime(volume) {
    var c = audioCtx(); if (!c) return false;
    var v = Math.max(0, Math.min(100, volume == null ? 60 : +volume)) / 100 * 0.28; if (v <= 0) return false;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      var t0 = c.currentTime + 0.03;
      [[880, 0, 0.55], [1318.5, 0.13, 0.75]].forEach(function (n) {
        var o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), t = t0 + n[1];
        o.type = 'sine'; o.frequency.setValueAtTime(n[0], t);
        o2.type = 'sine'; o2.frequency.setValueAtTime(n[0] * 2, t);      // faint octave for a bell-like colour
        var g2 = c.createGain(); g2.gain.value = 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[2]);
        o.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination);
        o.start(t); o2.start(t); o.stop(t + n[2] + 0.05); o2.stop(t + n[2] + 0.05);
      });
      return true;
    } catch (e) { return false; }
  }
  function unlock() {
    if (unlocked) return;
    var c = audioCtx(); if (!c) return;
    try {
      if (c.resume) c.resume();
      var buf = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination); s.start(0);
    } catch (e) {}
    unlocked = true;
    if (pending) { var vol = pending; pending = 0; setTimeout(function () { API._chime(vol); }, 150); }
  }
  function play(volume) {
    if (API._isUnlocked()) return API._chime(volume);
    pending = volume || 60;            // played on the first click / key press
    return false;
  }

  /* ---------- refresh ---------- */
  var lastItems = [], timer = 0, lastBiz = null;
  function scheduleRefresh(ms) {
    if (typeof setTimeout !== 'function') return;
    clearTimeout(timer);
    timer = setTimeout(function () { timer = 0; try { refresh(); } catch (e) {} }, ms == null ? 250 : ms);
    if (timer && timer.unref) timer.unref();
  }
  function toast(msg) { try { if (root.UIModal && root.UIModal.toast) root.UIModal.toast(msg); } catch (e) {} }
  function refresh() {
    var A = getApp(), b = A && A.openBiz != null && A.curBiz ? A.curBiz() : null;
    if (!b) { lastItems = []; paintBadge(0, null); closeDrop(); return []; }
    var items = evaluate(b), p = prefs(b), now = today();
    lastItems = items;
    var att = attention(items);
    paintBadge(att.length, att.length ? att[0].severity : null);

    var st = stateOf(b.id), changed = false;
    /* keep the state small: today's chimes, live snoozes, read marks of items that still exist */
    var all = {}; evaluate(b, { all: true }).forEach(function (it) { all[it.key] = 1; });
    Object.keys(st.sounded).forEach(function (k) { if (st.sounded[k] !== now) { delete st.sounded[k]; changed = true; } });
    Object.keys(st.snooze).forEach(function (k) { if (!(st.snooze[k] > now)) { delete st.snooze[k]; changed = true; } });
    Object.keys(st.read).forEach(function (k) { if (!all[k]) { delete st.read[k]; changed = true; } });

    var fresh = pickNew(items, st.sounded, now);
    if (fresh.length) {
      fresh.forEach(function (it) { st.sounded[it.key] = now; }); changed = true;
      if (!p.mute) {
        if (p.sound && p.volume > 0) play(p.volume);
        toast(fresh.length === 1 ? fresh[0].title + (fresh[0].severity === 'overdue' ? ' (overdue)' : ' (due today)')
          : fresh.length + ' reminders need attention');
      }
      API.lastFresh = fresh;
    }
    if (changed) saveState(b.id, st);
    if (dropOpen()) drawDrop();
    if (A.wsMode === 'reminders' && API._pageLive) { try { A.renderMain(b); } catch (e) {} }
    return items;
  }

  /* ---------- bell badge ---------- */
  function paintBadge(n, worst) {
    var dot = byId('hdDot'), btn = byId('hdNotify');
    if (btn && btn.setAttribute) btn.setAttribute('aria-label', n ? 'Notifications (' + n + ')' : 'Notifications');
    if (btn) btn.title = n ? n + (n === 1 ? ' reminder' : ' reminders') : 'Notifications';
    if (!dot) return;
    dot.textContent = n > 99 ? '99+' : (n ? String(n) : '');
    dot.hidden = !n;
    if (dot.classList) { dot.classList.add('rm-count'); dot.classList.toggle('rm-soon', !!n && worst === 'soon'); }
  }

  /* ---------- the dropdown under the bell ---------- */
  function drop() { return byId('rmDrop'); }
  function dropOpen() { var d = drop(); return !!(d && d.classList && !d.classList.contains('hide')); }
  function itemRow(it) {
    var when = it.due ? fmtDate(it.due) + (it.days != null ? ' · ' + whenText(it.days) : '') : '';
    return '<div class="rm-item rm-' + it.severity + '" data-key="' + esc(it.key) + '">' +
      '<button type="button" class="rm-main" onclick="Reminders.open(' + jsq(it.key) + ')">' +
        '<span class="rm-ico">' + ico(KIND_ICON[it.kind] || 'bell', 16) + '</span>' +
        '<span class="rm-txt"><span class="rm-t">' + esc(it.title) + '</span>' +
        (it.detail ? '<span class="rm-d">' + esc(it.detail) + '</span>' : '') +
        (when ? '<span class="rm-w">' + esc(when) + '</span>' : '') + '</span></button>' +
      '<span class="rm-acts">' +
        '<button type="button" class="rm-act" title="Mark as read" aria-label="Mark as read" onclick="Reminders.markRead(' + jsq(it.key) + ')">' + ico('check', 15) + '</button>' +
        '<button type="button" class="rm-act" title="Snooze 1 day" aria-label="Snooze 1 day" onclick="Reminders.snooze(' + jsq(it.key) + ')">' + ico('clock', 15) + '</button>' +
      '</span></div>';
  }
  function dropHtml(items) {
    var att = attention(items);
    var groups = [['overdue', 'Overdue'], ['due', 'Due today'], ['soon', 'Upcoming']];
    var body = '';
    groups.forEach(function (g) {
      var rows = att.filter(function (it) { return it.severity === g[0]; }); if (!rows.length) return;
      body += '<div class="rm-g rm-g-' + g[0] + '"><span>' + g[1] + '</span><span class="rm-gn">' + rows.length + '</span></div>' +
        rows.slice(0, 6).map(function (it) { return itemRow(it); }).join('') +
        (rows.length > 6 ? '<button type="button" class="rm-more" onclick="Reminders.openPage(\'' + g[0] + '\')">+' + (rows.length - 6) + ' more</button>' : '');
    });
    if (!body) body = '<div class="rm-empty">' + ico('check', 22) + '<div>You are all caught up.</div>' +
      (items.length ? '<div class="rm-empty-s">' + items.length + ' read or snoozed</div>' : '') + '</div>';
    return '<div class="rm-h"><span class="rm-ht">Notifications</span>' + (att.length ? '<span class="rm-hn">' + att.length + '</span>' : '') +
      '<span class="rm-grow"></span><button type="button" class="rm-hbtn" title="Notification settings" aria-label="Notification settings" onclick="Reminders.openSettings()">' + ico('settings', 16) + '</button></div>' +
      '<div class="rm-body">' + body + '</div>' +
      '<div class="rm-f"><button type="button" class="rm-all" onclick="Reminders.openPage()">View all reminders</button></div>';
  }
  function ensureDrop() {
    var d = drop(); if (d || !hasDom()) return d;
    d = document.createElement('div'); d.id = 'rmDrop'; d.className = 'rm-drop hide';
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(d);
    return d;
  }
  function placeDrop() {
    var d = drop(), btn = byId('hdNotify'); if (!d || !btn || !btn.getBoundingClientRect) return;
    var r = btn.getBoundingClientRect(), vw = root.innerWidth || 1024;
    d.style.top = Math.round(r.bottom + 8) + 'px';
    if (vw <= 600) { d.style.left = '8px'; d.style.right = '8px'; return; }
    var w = Math.min(380, vw - 16), left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    d.style.left = Math.round(left) + 'px'; d.style.right = 'auto';
  }
  function drawDrop() { var d = ensureDrop(); if (!d) return; d.innerHTML = dropHtml(lastItems); }
  function openDrop() {
    var d = ensureDrop(); if (!d) return;
    try { if (root.Topbar) root.Topbar.close(); } catch (e) {}
    refresh();
    drawDrop(); d.classList.remove('hide'); placeDrop();
    var btn = byId('hdNotify'); if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function closeDrop() {
    var d = drop(); if (!d || !d.classList) return; d.classList.add('hide');
    var btn = byId('hdNotify'); if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleDrop(ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); if (dropOpen()) closeDrop(); else openDrop(); }

  /* ---------- actions ---------- */
  function find(key) {
    var A = getApp(), b = A && A.curBiz ? A.curBiz() : null;
    var hit = lastItems.find(function (x) { return x.key === key; });
    if (!hit && b) hit = evaluate(b, { all: true }).find(function (x) { return x.key === key; });
    return { b: b, it: hit };
  }
  function afterChange() {
    var A = getApp(); refresh();
    if (A && A.wsMode === 'reminders') { try { A.renderMain(A.curBiz()); } catch (e) {} }
  }
  function markRead(key) { var f = find(key); if (!f.b || !f.it) return; var st = stateOf(f.b.id); st.read[key] = f.it.severity; saveState(f.b.id, st); afterChange(); }
  function markUnread(key) { var f = find(key); if (!f.b) return; var st = stateOf(f.b.id); delete st.read[key]; saveState(f.b.id, st); afterChange(); }
  function snooze(key, days) { var f = find(key); if (!f.b) return; var st = stateOf(f.b.id); st.snooze[key] = addDays(today(), days || 1); saveState(f.b.id, st); afterChange(); }
  function unsnooze(key) { var f = find(key); if (!f.b) return; var st = stateOf(f.b.id); delete st.snooze[key]; saveState(f.b.id, st); afterChange(); }
  function markAllRead() { var A = getApp(), b = A && A.curBiz(); if (!b) return; var st = stateOf(b.id);
    attention(evaluate(b)).forEach(function (it) { st.read[it.key] = it.severity; }); saveState(b.id, st); afterChange(); }

  function openLink(link) {
    var A = getApp(); if (!A || !link) return false;
    if (typeof link.open === 'function') { link.open(); return true; }
    var sec = link.section;
    if (sec === 'Settings' || link.setting) {
      A.selectSection('Settings');
      var key = link.setting || link.id; if (key) A.openSetting(key);
      return true;
    }
    if (!sec) return false;
    A.selectSection(sec);
    var L2K = (typeof LABEL2KEY !== 'undefined') ? LABEL2KEY : null;
    if (link.id != null && (!L2K || L2K[sec]) && typeof A.viewRecord === 'function') {
      var R = A.curBiz() && A.curBiz().records && L2K ? (A.curBiz().records[L2K[sec]] || []) : null;
      var rec = R ? R.find(function (r) { return String(r.id) === String(link.id); }) : null;
      A.viewRecord(rec ? rec.id : link.id);
    }
    return true;
  }
  function open(key) {
    var f = find(key); closeDrop();
    if (!f.it) return;
    if (!openLink(f.it.link)) openPage();
  }
  function openPage(filter) {
    var A = getApp(); if (!A || !A.curBiz || !A.curBiz()) return;
    closeDrop();
    if (filter) API._f.status = filter;
    if (A.closeNav) A.closeNav();
    A.navTrail = []; A.editingId = null; A.setView = null; A.wsSection = null; A.wsMode = 'reminders';
    if (A.view !== 'workspace' && A.go) { A.go('workspace'); A.wsMode = 'reminders'; }
    A.renderWorkspace();
    try { var m = byId('wsMain'); if (m) m.scrollTop = 0; if (root.scrollTo) root.scrollTo(0, 0); } catch (e) {}
  }
  function openSettings() { var A = getApp(); closeDrop(); if (!A) return; A.selectSection('Settings'); A.openSetting('notifications'); }

  /* ---------- the Reminders page ---------- */
  var FILTERS = [['attention', 'Needs attention'], ['overdue', 'Overdue'], ['due', 'Due today'], ['soon', 'Upcoming'],
    ['read', 'Read'], ['snoozed', 'Snoozed'], ['active', 'All active'], ['all', 'All dates']];
  function kindLabel(k) { return KINDS[k] ? KINDS[k].label : (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Other'); }
  function pageRows(b) {
    var f = API._f, all = f.status === 'all';
    var items = evaluate(b, { all: all });
    items = items.filter(function (it) {
      switch (f.status) {
        case 'attention': return !it.read && !it.snoozed;
        case 'overdue': case 'due': case 'soon': return it.severity === f.status && !it.read && !it.snoozed;
        case 'read': return it.read;
        case 'snoozed': return it.snoozed;
        default: return true;
      }
    });
    if (f.kind) items = items.filter(function (it) { return it.kind === f.kind; });
    if (f.q) { var q = f.q.toLowerCase(); items = items.filter(function (it) { return (it.title + ' ' + it.detail + ' ' + kindLabel(it.kind)).toLowerCase().indexOf(q) >= 0; }); }
    return items;
  }
  function pageHtml(b) {
    var A = getApp(), f = API._f;
    API._pageLive = true;
    var kinds = {}; evaluate(b, { all: true }).forEach(function (it) { kinds[it.kind] = 1; });
    Object.keys(KINDS).forEach(function (k) { kinds[k] = 1; });
    var rows = pageRows(b);
    var sel = function (id, opts, v, fn) { return '<select id="' + id + '" onchange="' + fn + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    var head = '<div class="reg-panel-head rm-page-head"><span class="reg-panel-title">Reminders</span>' +
      '<button class="btn btn-xs" onclick="Reminders.markAllRead()">Mark all as read</button>' +
      '<button class="btn btn-xs" onclick="Reminders.openSettings()">' + ico('settings', 14) + ' Settings</button>' +
      '<div class="reg-search rm-filters">' +
        sel('rmFStatus', FILTERS, f.status, 'Reminders._setF(\'status\',this.value)') +
        sel('rmFKind', [['', 'All kinds']].concat(Object.keys(kinds).sort().map(function (k) { return [k, kindLabel(k)]; })), f.kind, 'Reminders._setF(\'kind\',this.value)') +
        '<input type="text" id="rmFQ" placeholder="Search" value="' + esc(f.q) + '" onkeydown="if(event.key===\'Enter\'){Reminders._setF(\'q\',this.value)}">' +
        '<button class="btn btn-xs" onclick="Reminders._setF(\'q\',document.getElementById(\'rmFQ\').value)">Search</button></div></div>';
    var body = rows.length ? rows.map(function (it) {
      var st = it.severity, badge = '<span class="rm-badge rm-b-' + st + '">' + esc(SEV_LABEL[st]) + '</span>' +
        (it.read ? ' <span class="rm-badge rm-b-read">Read</span>' : '') + (it.snoozed ? ' <span class="rm-badge rm-b-read">Snoozed</span>' : '');
      var k = jsq(it.key);
      return '<tr class="' + (it.read || it.snoozed ? 'rm-dim' : '') + '">' +
        '<td class="act"><button class="btn btn-xs" onclick="Reminders.open(' + k + ')">Open</button></td>' +
        '<td class="nowrap">' + (it.due ? esc(fmtDate(it.due)) : '') + (it.days != null ? '<div class="rm-when">' + esc(whenText(it.days)) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + badge + '</td>' +
        '<td class="rm-rem"><span class="rm-t">' + esc(it.title) + '</span>' + (it.detail ? '<div class="rm-d">' + esc(it.detail) + '</div>' : '') + '</td>' +
        '<td class="rm-kind">' + esc(kindLabel(it.kind)) + '</td>' +
        '<td class="nowrap"><div class="rm-rowacts">' +
          (it.read ? '<button class="btn btn-xs" onclick="Reminders.markUnread(' + k + ')">Mark unread</button>' : '<button class="btn btn-xs" onclick="Reminders.markRead(' + k + ')">Mark as read</button>') +
          (it.snoozed ? '<button class="btn btn-xs" onclick="Reminders.unsnooze(' + k + ')">Unsnooze</button>' : '<button class="btn btn-xs" onclick="Reminders.snooze(' + k + ')">Snooze 1 day</button>') +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="6"><div class="reg-empty">' + (f.status === 'attention' && !f.kind && !f.q ? 'Nothing needs attention. You are all caught up.' : 'No reminders match these filters.') + '</div></td></tr>';
    return (A ? A.crumb('Reminders') : '') + head +
      '<div class="tbl-scroll"><table class="reg-tbl rm-tbl"><thead><tr><th class="act"></th><th>Due</th><th>Status</th><th>Reminder</th><th>Kind</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="reg-foot"><span class="cnt">' + rows.length + ' ' + (rows.length === 1 ? 'reminder' : 'reminders') + '</span></div>';
  }
  function setF(k, v) { API._f[k] = v || ''; var A = getApp(); if (A && A.wsMode === 'reminders') A.renderMain(A.curBiz()); }

  /* ---------- Settings -> Notifications ---------- */
  function settingsHtml(b) {
    var A = getApp(), p = prefs(b);
    var kinds = {}; Object.keys(KINDS).forEach(function (k) { kinds[k] = 1; }); evaluate(b, { all: true }).forEach(function (it) { kinds[it.kind] = 1; });
    var rows = Object.keys(kinds).map(function (k) {
      return '<tr><td>' + esc(kindLabel(k)) + '</td>' +
        '<td class="c"><input type="checkbox" data-rm-show="' + esc(k) + '"' + (p.off[k] ? '' : ' checked') + ' aria-label="Show ' + esc(kindLabel(k)) + '"></td>' +
        '<td class="r"><input type="number" min="0" max="365" step="1" class="rm-lead" data-rm-lead="' + esc(k) + '" value="' + leadFor(p, k) + '" aria-label="Lead days for ' + esc(kindLabel(k)) + '"></td></tr>';
    }).join('');
    var inner = '<div class="rm-set" id="rmSet">' +
      '<label class="sp-chk rm-chk"><input type="checkbox" id="rmMute"' + (p.mute ? ' checked' : '') + '><span><b>Mute all notifications</b> — no sound and no pop-up notice; the bell still counts reminders.</span></label>' +
      '<label class="sp-chk rm-chk"><input type="checkbox" id="rmSound"' + (p.sound ? ' checked' : '') + '><span>Play a short sound when a reminder becomes due or overdue (once per reminder per day)</span></label>' +
      '<div class="rm-vol"><label for="rmVol">Volume</label><input type="range" id="rmVol" min="0" max="100" step="5" value="' + p.volume + '" oninput="document.getElementById(\'rmVolV\').textContent=this.value+\'%\'">' +
        '<span id="rmVolV" class="rm-volv">' + p.volume + '%</span>' +
        '<button type="button" class="btn btn-xs" onclick="Reminders.testSound()">' + ico('bell', 14) + ' Test sound</button></div>' +
      '<h3 class="rm-set-h">Reminder lead time</h3>' +
      '<div class="rm-set-s">How many days before the due date a reminder appears as Upcoming. Overdue and due-today reminders always show.</div>' +
      '<div class="tbl-scroll"><table class="reg-tbl rm-kinds"><thead><tr><th>Kind</th><th class="c">Show</th><th class="r">Days before</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>';
    return A.setCard('Notifications', inner, 'Reminders.saveSettings()');
  }
  function collectSettings() {
    var d = doc(), g = function (id) { return d && d.getElementById ? d.getElementById(id) : null; };
    var out = { sound: !!(g('rmSound') && g('rmSound').checked), mute: !!(g('rmMute') && g('rmMute').checked),
      volume: g('rmVol') ? Math.max(0, Math.min(100, +g('rmVol').value || 0)) : 60, lead: {}, off: {} };
    var box = g('rmSet');
    if (box && box.querySelectorAll) {
      Array.prototype.forEach.call(box.querySelectorAll('[data-rm-lead]'), function (el) { var v = parseInt(el.value, 10); if (!isNaN(v)) out.lead[el.getAttribute('data-rm-lead')] = Math.max(0, Math.min(365, v)); });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rm-show]'), function (el) { if (!el.checked) out.off[el.getAttribute('data-rm-show')] = true; });
    }
    return out;
  }
  function saveSettings(values) {
    var A = getApp(), b = A && A.curBiz(); if (!b) return false;
    var v = values || collectSettings();
    b.notifications = Object.assign({}, b.notifications || {}, v);
    A.saveBiz(b);
    toast('Updated');
    if (!values && A.settingsBack) A.settingsBack();
    refresh();
    return true;
  }
  function testSound() { var v = doc() && byId('rmVol') ? +byId('rmVol').value : 60; unlock(); API._chime(v); }

  /* ---------- built-in source: invoices and bills falling due ---------- */
  function invoiceSource(b) {
    var A = getApp(); if (!A || !A.invStatus) return [];
    var R = (b && b.records) || {}, out = [];
    [['salesInv', 'Sales Invoices', 'Sales invoice', 'customer'], ['purchInv', 'Purchase Invoices', 'Purchase invoice', 'supplier']].forEach(function (s) {
      (R[s[0]] || []).forEach(function (r) {
        if (!r || !r.dueDate) return;
        var st = A.invStatus(r); if (st === 'Paid' || st === 'Overpaid' || st === 'Draft' || st === 'Cancelled') return;
        var bal = Number(r.balanceDue != null ? r.balanceDue : r.total) || 0;
        out.push({ id: s[0] + ':' + r.id + ':' + r.dueDate, kind: 'invoice', due: String(r.dueDate).slice(0, 10),
          severity: st === 'Overdue' ? 'overdue' : undefined,
          title: s[2] + (r.reference ? ' ' + r.reference : '') + (r[s[3]] ? ' — ' + r[s[3]] : ''),
          detail: 'Balance due ' + (A.money ? A.money(bal) : bal), link: { section: s[1], id: r.id } });
      });
    });
    return out;
  }

  /* ---------- wiring into the app ---------- */
  function install() {
    var A = getApp(); if (!A || A.__reminders) return;
    A.__reminders = 1;
    /* the bell: dropdown instead of the old overlay, count from the sources */
    A.openNotifications = function () { toggleDrop(); };
    A.notificationCount = function (b) { try { return count(b || this.curBiz()); } catch (e) { return 0; } };
    /* refresh after every save */
    if (typeof A.saveBiz === 'function') {
      var origSave = A.saveBiz;
      A.saveBiz = function () { var r = origSave.apply(this, arguments); scheduleRefresh(); return r; };
    }
    /* refresh when a (different) business opens */
    if (typeof A.renderWorkspace === 'function') {
      var origRW = A.renderWorkspace;
      A.renderWorkspace = function () {
        var r = origRW.apply(this, arguments);
        if (this.openBiz !== lastBiz) { lastBiz = this.openBiz; scheduleRefresh(60); }
        else paintBadge(attention(lastItems).length, (attention(lastItems)[0] || {}).severity);
        return r;
      };
    }
    if (typeof A.closeBusiness === 'function') {
      var origClose = A.closeBusiness;
      A.closeBusiness = function () { closeDrop(); lastBiz = null; lastItems = []; var r = origClose.apply(this, arguments); paintBadge(0, null); return r; };
    }
    /* the Reminders page */
    if (typeof A.renderMain === 'function') {
      var origRM = A.renderMain;
      A.renderMain = function (b) {
        if (this.wsMode === 'reminders') { var m = byId('wsMain'); if (m) m.innerHTML = pageHtml(b || this.curBiz()); return; }
        API._pageLive = false;
        return origRM.apply(this, arguments);
      };
    }
    /* Settings -> Notifications tile + page */
    if (typeof A.setTiles === 'function') {
      var origTiles = A.setTiles;
      A.setTiles = function () {
        var t = origTiles.apply(this, arguments);
        if (!t.some(function (x) { return x[2] === 'notifications'; })) {
          var row = ['bell', 'Notifications', 'notifications', 'Reminders, sound and lead days', 1, 1];
          var at = t.findIndex(function (x) { return x[4] === 1 && String(x[1]).toLowerCase() > 'notifications'; });
          if (at < 0) at = t.filter(function (x) { return x[4] === 1; }).length;
          t.splice(at, 0, row);
        }
        return t;
      };
    }
    A.set_notifications = function (b) { return settingsHtml(b); };
    if (root.ICO && root.ICO.forSetting && !root.ICO.forSetting.__rm) {
      var origFS = root.ICO.forSetting;
      root.ICO.forSetting = function (key, size, cls) { return key === 'notifications' ? this.get('bell', size, cls) : origFS.apply(this, arguments); };
      root.ICO.forSetting.__rm = 1;
    }
  }
  function installDom() {
    if (!hasDom() || API.__dom) return;
    API.__dom = 1;
    var d = document;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { d.addEventListener(ev, unlock, { capture: true, passive: true }); });
    d.addEventListener('mousedown', function (e) {
      if (!dropOpen()) return;
      var dd = drop(), btn = byId('hdNotify');
      if ((dd && dd.contains(e.target)) || (btn && btn.contains(e.target))) return;
      closeDrop();
    }, true);
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dropOpen()) { closeDrop(); var b = byId('hdNotify'); if (b && b.focus) b.focus(); } }, true);
    if (root.addEventListener) root.addEventListener('resize', function () { if (dropOpen()) placeDrop(); });
    if (typeof setInterval === 'function') setInterval(function () { try { refresh(); } catch (e) {} }, 10 * 60 * 1000);
    var btn = byId('hdNotify'); if (btn && btn.setAttribute) { btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); }
  }

  var API = {
    __v: 1,
    register: register, unregister: unregister, list: list, refresh: refresh, count: count, defineKind: defineKind,
    listAll: function (b) { return evaluate(b, { all: true }); },
    open: open, openPage: openPage, openSettings: openSettings, openLink: openLink,
    toggle: toggleDrop, close: closeDrop,
    markRead: markRead, markUnread: markUnread, snooze: snooze, unsnooze: unsnooze, markAllRead: markAllRead,
    saveSettings: saveSettings, testSound: testSound, prefs: prefs, leadFor: leadFor,
    today: today, daysUntil: daysUntil, addDays: addDays, whenText: whenText,
    pageHtml: pageHtml, settingsHtml: settingsHtml, dropHtml: function () { return dropHtml(lastItems); },
    KINDS: KINDS,
    /* internals, exposed for tests */
    _pickNew: pickNew, _state: stateOf, _saveState: saveState, _normalize: normalize, _sources: function () { return SOURCES.map(function (s) { return s.id; }); },
    _chime: chime, _isUnlocked: function () { return unlocked; }, _unlock: unlock, _pending: function () { return pending; },
    _now: null, _f: { status: 'attention', kind: '', q: '' }, _setF: setF, _pageLive: false, lastFresh: []
  };
  root.Reminders = API;
  if (typeof globalThis !== 'undefined') globalThis.Reminders = API;

  register('invoices', invoiceSource);
  install();
  var d0 = doc();
  if (d0 && d0.readyState === 'loading' && d0.addEventListener) d0.addEventListener('DOMContentLoaded', installDom);
  else installDom();
})(typeof window !== 'undefined' ? window : globalThis);
