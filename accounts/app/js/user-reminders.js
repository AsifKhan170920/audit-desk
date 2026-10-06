/* ===================== Set reminder (FIX_SPEC_5 Part B) =====================
   Personal reminders a user sets by hand: the "Reminder" button beside the bell
   (shortcut R), the New / Edit reminder dialog, and the Upcoming / Overdue / Done
   tabs on the Reminders page.

   Built on the shared reminder core (js/reminders.js): user reminders are one
   more source ('user') there, so a reminder that becomes due lands in the same
   bell dropdown, bumps the same badge and plays the same chime. The source hands
   the core its own buttons (Open / Done / Snooze 1 hour / Tomorrow 9:00) through
   the item's `acts`, and its own date + time text through `when`.

   Storage — in the business, so it travels with backups and cloud sync
   (never a separate localStorage key):
     b.userReminders = [{ id, business_id, user_id, title, note,
       due_at          'YYYY-MM-DDTHH:mm:00+04:00' (business time, Asia/Dubai)
       repeat          'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
       repeat_day      day of month the series started on (month-end safe roll-forward)
       remind_before   minutes: 0 | 15 | 60 | 1440 | 10080
       linked_type     a register key ('customers', 'salesInv', …) or 'payroll'
       linked_id, linked_label
       priority        'normal' | 'high'
       status          'open' | 'snoozed' | 'done'
       snooze_until    ISO, while snoozed
       created_at, updated_at, done_at }]
   Each user sees only their own (user_id = App.currentUser().id; 'local' when
   nobody is signed in).

   Due: status open and due_at − remind_before ≤ now, or snoozed and
   snooze_until ≤ now. Checked when a business opens (core) and every 60 s here;
   the core is only asked to repaint when the set of due reminders changed, so an
   open Reminders page is not re-rendered under the user's hands every minute. */
(function (root) {
  'use strict';
  if (root.UserReminders && root.UserReminders.__v) return;

  function getApp() { try { return typeof App !== 'undefined' ? App : (root.App || null); } catch (e) { return root.App || null; } }
  function R() { return root.Reminders || null; }
  function doc() { return typeof document !== 'undefined' ? document : null; }
  function hasDom() { var d = doc(); return !!(d && typeof d.createElement === 'function' && typeof d.addEventListener === 'function' && d.body && typeof d.body.appendChild === 'function'); }
  function byId(id) { var d = doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function js(v) { return JSON.stringify(v == null ? '' : v); }              // a JS literal for an onclick (esc() it for the attribute)
  function ico(n, sz) { try { return root.ICO ? root.ICO.get(n, sz || 16) : ''; } catch (e) { return ''; } }
  function toast(m) { try { if (root.UIModal && root.UIModal.toast) root.UIModal.toast(m); } catch (e) {} }
  function reg() { try { return typeof REG !== 'undefined' ? REG : (root.REG || {}); } catch (e) { return root.REG || {}; } }
  function l2k() { try { return typeof LABEL2KEY !== 'undefined' ? LABEL2KEY : (root.LABEL2KEY || {}); } catch (e) { return root.LABEL2KEY || {}; } }

  /* ---------- business time: Asia/Dubai, UTC+4 all year (no daylight saving) ---------- */
  var TZ = '+04:00', OFF = 4 * 60 * 60000, HOUR = 60 * 60000, DAYMS = 24 * HOUR;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowMs() { var c = R(); return c && c._now != null ? +c._now : Date.now(); }
  /* {date:'YYYY-MM-DD', time:'HH:MM', y, m (1-12), d, hh, mi} of an instant, in Dubai */
  function parts(ms) {
    var x = new Date(ms + OFF);
    var p = { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), hh: x.getUTCHours(), mi: x.getUTCMinutes() };
    p.date = p.y + '-' + pad(p.m) + '-' + pad(p.d); p.time = pad(p.hh) + ':' + pad(p.mi);
    return p;
  }
  function iso(date, time) { return date + 'T' + (time || '00:00') + ':00' + TZ; }
  function isoOf(ms) { var p = parts(ms); return iso(p.date, p.time); }
  function msOf(s) { if (!s) return NaN; var t = Date.parse(s); return t; }
  function validDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return false; var x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return x.getUTCMonth() === +m[2] - 1 && x.getUTCDate() === +m[3]; }
  function validTime(s) { var m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return !!m && +m[1] < 24 && +m[2] < 60; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }          // m 1-12
  /* the default for a new reminder: today, next full hour (23:xx rolls to tomorrow 00:00) */
  function nextFullHour(now) { var local = (now == null ? nowMs() : now) + OFF; return parts(Math.floor(local / HOUR) * HOUR + HOUR - OFF); }
  function tomorrowAt9(now) { var p = parts(now == null ? nowMs() : now); return msOf(iso(p.date, '09:00')) + DAYMS; }
  function fmtDate(d) { var A = getApp(); try { return A && A.fmtDate ? A.fmtDate(d) : d; } catch (e) { return d; } }
  function fmtWhen(s) { var t = msOf(s); if (isNaN(t)) return ''; var p = parts(t); return fmtDate(p.date) + ' ' + p.time; }
  function relText(ms, now) {
    var diff = ms - now, a = Math.abs(diff), n, u;
    if (a < 60000) return 'now';
    if (a < HOUR) { n = Math.round(a / 60000); u = 'min'; }
    else if (a < DAYMS) { n = Math.round(a / HOUR); u = n === 1 ? 'hour' : 'hours'; }
    else { n = Math.round(a / DAYMS); u = n === 1 ? 'day' : 'days'; }
    return diff > 0 ? 'in ' + n + ' ' + u : n + ' ' + u + ' overdue';
  }

  /* ---------- choices ---------- */
  var REPEATS = [['none', 'None'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
  var BEFORE = [[0, 'At time'], [15, '15 min before'], [60, '1 hour before'], [1440, '1 day before'], [10080, '1 week before']];
  var PRIOS = [['normal', 'Normal'], ['high', 'High']];
  function labelOf(list, v) { var h = list.filter(function (x) { return String(x[0]) === String(v); })[0]; return h ? h[1] : ''; }
  /* record types offered by "Link to"; any other register is added when it is the open one */
  var LINK_TYPES = ['customers', 'suppliers', 'employees', 'salesInv', 'purchInv', 'payroll', 'bankCash'];

  /* ---------- repeat roll-forward ---------- */
  /* next occurrence of an ISO due: daily / weekly add days; monthly / yearly keep
     the series' day of month (repeat_day), clamped to the month's last day —
     Jan 31 → Feb 28 (29) → Mar 31; Feb 29 yearly → Feb 28 in other years */
  function nextDue(dueIso, repeat, anchorDay) {
    var t = msOf(dueIso); if (isNaN(t)) return null;
    var p = parts(t), y = p.y, m = p.m, d = p.d;
    if (repeat === 'daily') return isoOf(t + DAYMS);
    if (repeat === 'weekly') return isoOf(t + 7 * DAYMS);
    var day = anchorDay || d;
    if (repeat === 'monthly') { m += 1; if (m > 12) { m = 1; y += 1; } }
    else if (repeat === 'yearly') y += 1;
    else return null;
    d = Math.min(day, daysIn(y, m));
    return iso(y + '-' + pad(m) + '-' + pad(d), p.time);
  }

  /* ---------- store ---------- */
  function uid() {
    var A = getApp(), u = null;
    try { u = A && A.currentUser ? A.currentUser() : null; } catch (e) { u = null; }
    return u && u.id != null && u.id !== '' ? String(u.id) : 'local';
  }
  function curBiz() { var A = getApp(); try { return A && A.openBiz != null && A.curBiz ? A.curBiz() : null; } catch (e) { return null; } }
  function all(b) { return b && Array.isArray(b.userReminders) ? b.userReminders : []; }
  function mine(b) { var me = uid(); return all(b).filter(function (r) { return r && String(r.user_id) === me; }); }
  function byRid(b, id) { return mine(b).filter(function (r) { return String(r.id) === String(id); })[0] || null; }
  function newId() { return 'ur' + nowMs().toString(36) + Math.random().toString(36).slice(2, 7); }
  function save(b) { var A = getApp(); if (A && A.saveBiz) A.saveBiz(b); }
  function triggerMs(r) { return msOf(r.due_at) - (Number(r.remind_before) || 0) * 60000; }
  function isDue(r, now) {
    if (!r || r.status === 'done') return false;
    now = now == null ? nowMs() : now;
    if (r.status === 'snoozed' && r.snooze_until) return msOf(r.snooze_until) <= now;
    return triggerMs(r) <= now;
  }
  function isOverdue(r, now) { return !!r && r.status !== 'done' && msOf(r.due_at) < (now == null ? nowMs() : now); }
  function dueList(b, now) { now = now == null ? nowMs() : now; return mine(b).filter(function (r) { return isDue(r, now); }); }

  /* the fields a reminder may be created / edited with; returns {ok, errors[], reminder} */
  function validate(f, existing) {
    f = f || {}; var errs = [];
    var title = String(f.title == null ? '' : f.title).trim();
    if (!title) errs.push('Enter a title.');
    var repeat = labelOf(REPEATS, f.repeat) ? String(f.repeat) : 'none';
    var date = String(f.date || ''), time = String(f.time || '');
    if (!validDate(date)) errs.push('Choose a date.');
    if (!validTime(time)) errs.push('Choose a time.');
    var due = !errs.length || (validDate(date) && validTime(time)) ? iso(date, time) : null;
    /* past refused unless it repeats; an edit that keeps the same due may stay in the past */
    if (due && repeat === 'none' && msOf(due) < nowMs() && !(existing && existing.due_at === due)) errs.push('The date and time are in the past. Choose a later time, or set Repeat.');
    return { ok: !errs.length, errors: errs, due: due, title: title, repeat: repeat };
  }
  function create(f) {
    var b = curBiz(); if (!b) return { ok: false, errors: ['Open a business first.'] };
    var v = validate(f); if (!v.ok) return v;
    var t = nowMs(), dp = parts(msOf(v.due));
    var r = { id: newId(), business_id: b.id, user_id: uid(), title: v.title, note: String(f.note || ''),
      due_at: v.due, repeat: v.repeat, repeat_day: dp.d, remind_before: BEFORE.some(function (x) { return x[0] === +f.remind_before; }) ? +f.remind_before : 0,
      linked_type: f.linked_type || '', linked_id: f.linked_type && f.linked_id != null && f.linked_id !== '' ? f.linked_id : null,
      linked_label: f.linked_type ? String(f.linked_label || linkLabel(b, f.linked_type, f.linked_id) || '') : '',
      priority: f.priority === 'high' ? 'high' : 'normal', status: 'open', snooze_until: null, created_at: isoOf(t), updated_at: isoOf(t) };
    if (!r.linked_id) { r.linked_type = ''; r.linked_label = ''; }
    if (!Array.isArray(b.userReminders)) b.userReminders = [];
    b.userReminders.push(r); save(b); changed();
    return { ok: true, errors: [], reminder: r };
  }
  function update(id, f) {
    var b = curBiz(), r = b && byRid(b, id); if (!r) return { ok: false, errors: ['Reminder not found.'] };
    var v = validate(f, r); if (!v.ok) return v;
    var moved = r.due_at !== v.due;
    r.title = v.title; r.note = String(f.note || ''); r.repeat = v.repeat;
    r.remind_before = BEFORE.some(function (x) { return x[0] === +f.remind_before; }) ? +f.remind_before : 0;
    r.priority = f.priority === 'high' ? 'high' : 'normal';
    r.linked_type = f.linked_type && f.linked_id != null && f.linked_id !== '' ? f.linked_type : '';
    r.linked_id = r.linked_type ? f.linked_id : null;
    r.linked_label = r.linked_type ? String(f.linked_label || linkLabel(b, r.linked_type, r.linked_id) || r.linked_label || '') : '';
    if (moved) { r.due_at = v.due; r.repeat_day = parts(msOf(v.due)).d; if (r.status !== 'done') { r.status = 'open'; r.snooze_until = null; } }
    r.updated_at = isoOf(nowMs());
    save(b); changed();
    return { ok: true, errors: [], reminder: r };
  }
  function remove(id) {
    var b = curBiz(), r = b && byRid(b, id); if (!r) return false;
    b.userReminders = all(b).filter(function (x) { return x !== r; });
    save(b); changed(); return true;
  }
  /* Done; a repeating reminder gets its next occurrence (the first one after now) */
  function done(id) {
    var b = curBiz(), r = b && byRid(b, id); if (!r || r.status === 'done') return null;
    var t = nowMs(), next = null;
    r.status = 'done'; r.done_at = isoOf(t); r.snooze_until = null; r.updated_at = r.done_at;
    if (r.repeat && r.repeat !== 'none') {
      var due = r.due_at, guard = 0;
      do { due = nextDue(due, r.repeat, r.repeat_day); guard++; } while (due && msOf(due) <= t && guard < 5000);
      if (due) {
        next = Object.assign({}, r, { id: newId(), due_at: due, status: 'open', snooze_until: null, done_at: null, created_at: isoOf(t), updated_at: isoOf(t), prev_id: r.id });
        b.userReminders.push(next);
      }
    }
    save(b); changed();
    toast(next ? 'Done. Next: ' + fmtWhen(next.due_at) : 'Reminder done');
    return next || r;
  }
  function snooze(id, how) {
    var b = curBiz(), r = b && byRid(b, id); if (!r || r.status === 'done') return null;
    var t = nowMs(), until = how === 'tomorrow' ? tomorrowAt9(t) : t + HOUR;
    r.status = 'snoozed'; r.snooze_until = isoOf(until); r.updated_at = isoOf(t);
    save(b); changed();
    toast('Snoozed until ' + fmtWhen(r.snooze_until));
    return r;
  }
  function reopen(id) {
    var b = curBiz(), r = b && byRid(b, id); if (!r) return null;
    r.status = 'open'; r.done_at = null; r.snooze_until = null; r.updated_at = isoOf(nowMs());
    save(b); changed(); return r;
  }

  /* ---------- linked records ---------- */
  function recLabel(key, r) {
    if (!r) return '';
    if (key === 'payroll') { var P = root.Payroll; return 'Payroll ' + (P && P.monthLabel ? P.monthLabel(r.month) : (r.month || '')); }
    var c = reg()[key] || {}, sing = c.singular || c.label || key;
    var name = r.name || r.accountName || r.title || '';
    var ref = r.reference || r.number || r.code || '';
    var party = r.customer || r.supplier || r.employee || r.payee || r.payer || '';
    if (name) return sing + ': ' + name + (ref ? ' (' + ref + ')' : '');
    return (sing + (ref ? ' ' + ref : '') + (party ? ' — ' + party : (name ? ' — ' + name : ''))).trim() || (sing + ' #' + r.id);
  }
  function recs(b, key) { return ((b && b.records) || {})[key] || []; }
  function linkLabel(b, key, id) {
    if (!key || id == null) return '';
    var r = recs(b, key).filter(function (x) { return x && String(x.id) === String(id); })[0];
    return r ? recLabel(key, r) : '';
  }
  function typeLabel(key) {
    if (key === 'payroll') return 'Payroll';
    var c = reg()[key]; return c ? (c.singular || c.label || key) : key;
  }
  /* the record open on the current page, if any: {type, id, label} */
  function contextLink() {
    var A = getApp(), b = curBiz(); if (!A || !b) return null;
    var sec = A.wsSection, key = sec ? l2k()[sec] : null;
    if (sec === 'Payroll' || key === 'payroll') {
      var P = root.Payroll, ui = P && P.ui, route = (ui && ui.route) || {};
      var rid = route.id != null ? route.id : (ui && ui.draft && ui.draft.id != null ? ui.draft.id : null);
      var run = rid != null && P && P.runById ? P.runById(b, rid) : null;
      if (run) return { type: 'payroll', id: run.id, label: recLabel('payroll', run) };
      return null;
    }
    if (!key || A.editingId == null || A.editingId === '') return null;
    var r = recs(b, key).filter(function (x) { return x && String(x.id) === String(A.editingId); })[0];
    return r ? { type: key, id: r.id, label: recLabel(key, r) } : null;
  }
  function openLinked(r) {
    var A = getApp(); if (!A || !r) return false;
    if (!r.linked_type || r.linked_id == null) { openEdit(r.id); return true; }
    if (r.linked_type === 'payroll') {
      A.selectSection('Payroll');
      try { if (root.Payroll && root.Payroll.ui && root.Payroll.ui.open) root.Payroll.ui.open(r.linked_id); } catch (e) {}
      return true;
    }
    if (typeof A.gotoRecord === 'function') { A.gotoRecord(r.linked_type, r.linked_id); return true; }
    return false;
  }
  function open(id) {
    var b = curBiz(), r = b && byRid(b, id); if (!r) return false;
    try { var c = R(); if (c && c.close) c.close(); } catch (e) {}
    return openLinked(r);
  }

  /* ---------- the source fed to the shared core ---------- */
  function source(b) {
    if (!b) return [];
    var now = nowMs();
    return dueList(b, now).map(function (r) {
      var dueMs = msOf(r.due_at), stamp = r.status === 'snoozed' && r.snooze_until ? r.snooze_until : r.due_at, id = r.id;
      var detail = [r.linked_label, String(r.note || '').split('\n')[0]].filter(Boolean).join(' · ');
      var call = function (fn, arg) { return 'UserReminders.' + fn + '(' + js(id) + (arg ? ',' + js(arg) : '') + ')'; };
      return {
        id: id + '@' + stamp, kind: 'user', title: r.title, detail: detail, due: parts(dueMs).date,
        severity: dueMs < now ? 'overdue' : 'due', priority: r.priority,
        when: fmtWhen(r.due_at) + ' · ' + relText(dueMs, now),
        link: { open: function () { openLinked(byRid(curBiz(), id) || r); } },
        acts: [
          { label: 'Open', title: r.linked_label ? 'Open ' + r.linked_label : 'Open the reminder', call: call('open') },
          { label: 'Done', title: r.repeat !== 'none' ? 'Done — the next ' + labelOf(REPEATS, r.repeat).toLowerCase() + ' reminder is set' : 'Mark as done', call: call('done') },
          { label: 'Snooze 1 h', title: 'Snooze for 1 hour', call: call('snooze', 'hour') },
          { label: 'Tomorrow 9:00', title: 'Snooze until tomorrow 09:00', call: call('snooze', 'tomorrow') }
        ]
      };
    });
  }
  /* repaint the bell (and a live Reminders page) now */
  var lastSig = null;
  function sig(b) { var now = nowMs(); return b ? b.id + '|' + dueList(b, now).map(function (r) { return r.id + (msOf(r.due_at) < now ? 'o' : 'd') + (r.snooze_until || ''); }).join(',') : ''; }
  function changed() {
    var c = R(), A = getApp(); lastSig = sig(curBiz());
    try { if (c && c.refresh) c.refresh(); } catch (e) {}
    try { if (A && A.wsMode === 'reminders' && c && !c._pageLive) A.renderMain(A.curBiz()); } catch (e) {}
  }
  /* the 60-second check: only repaint when something became due / overdue / un-snoozed */
  function tick() {
    var b = curBiz(); if (!b) { lastSig = null; return false; }
    var s = sig(b); if (s === lastSig) return false;
    lastSig = s; var c = R(); try { if (c && c.refresh) c.refresh(); } catch (e) {}
    return true;
  }

  /* ---------- the dialog ---------- */
  var dlg = null;          // {id|null, link:{type,id,label}|null}
  function opt(list, v) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function typeOptions(cur) {
    var keys = LINK_TYPES.filter(function (k) { return k === 'payroll' || reg()[k]; });
    if (cur && keys.indexOf(cur) < 0) keys.push(cur);
    return [['', 'Nothing']].concat(keys.map(function (k) { return [k, typeLabel(k)]; }));
  }
  function recOptions(b, key, curId) {
    if (!key) return '';
    /* the type is already chosen in "Link to": list the records without the type prefix */
    var pre = typeLabel(key), short = function (s) { s = String(s || ''); return s.indexOf(pre) === 0 && s.length > pre.length ? s.slice(pre.length).replace(/^[:\s]+/, '') : s; };
    var list = recs(b, key).filter(Boolean).map(function (r) { return [r.id, short(recLabel(key, r))]; });
    if (key === 'payroll') list.reverse();                      // newest month first
    else list.sort(function (a, c) { return String(a[1]).localeCompare(String(c[1])); });
    if (curId != null && !list.some(function (x) { return String(x[0]) === String(curId); })) list.unshift([curId, short((dlg && dlg.link && dlg.link.label) || ('#' + curId))]);
    return '<option value="">Choose…</option>' + opt(list, curId);
  }
  function dialogHtml(b, r, link) {
    var editing = !!r, d0 = nextFullHour();
    var date = r ? parts(msOf(r.due_at)).date : d0.date, time = r ? parts(msOf(r.due_at)).time : d0.time;
    var lt = link ? link.type : '', li = link ? link.id : null;
    var fld = function (id, label, inner, cls) { return '<div class="ur-f' + (cls ? ' ' + cls : '') + '"><label class="fld" for="' + id + '">' + label + '</label>' + inner + '</div>'; };
    return '<div class="app-modal-h">' + (editing ? 'Edit reminder' : 'New reminder') + '</div>' +
      '<div class="app-modal-b ur-dlg" data-enter-nav="off">' +
        '<div class="ur-err hide" id="urErr" role="alert"></div>' +
        fld('urTitle', 'Title <span class="ur-req">*</span>', '<input type="text" id="urTitle" maxlength="200" autocomplete="off" value="' + esc(r ? r.title : '') + '" placeholder="e.g. Follow up the VAT return">', 'ur-wide') +
        fld('urNote', 'Note', '<textarea id="urNote" rows="3" placeholder="Optional">' + esc(r ? r.note : '') + '</textarea>', 'ur-wide') +
        '<div class="ur-row">' +
          fld('urDate', 'Date <span class="ur-req">*</span>', '<input type="date" id="urDate" value="' + esc(date) + '" required>') +
          fld('urTime', 'Time', '<input type="time" id="urTime" value="' + esc(time) + '" step="60">') +
        '</div>' +
        '<div class="ur-tz">Business time: Asia/Dubai (GST, UTC+4)</div>' +
        '<div class="ur-row">' +
          fld('urRepeat', 'Repeat', '<select id="urRepeat">' + opt(REPEATS, r ? r.repeat : 'none') + '</select>') +
          fld('urBefore', 'Remind', '<select id="urBefore">' + opt(BEFORE, r ? r.remind_before : 0) + '</select>') +
        '</div>' +
        '<div class="ur-row">' +
          fld('urLinkType', 'Link to', '<select id="urLinkType" onchange="UserReminders._fillRecs()">' + opt(typeOptions(lt), lt) + '</select>') +
          fld('urLinkId', 'Record', '<select id="urLinkId"' + (lt ? '' : ' disabled') + '>' + recOptions(b, lt, li) + '</select>') +
        '</div>' +
        fld('urPriority', 'Priority', '<select id="urPriority">' + opt(PRIOS, r ? r.priority : 'normal') + '</select>', 'ur-half') +
      '</div>' +
      '<div class="app-modal-f"><span style="flex:1"></span>' +
        '<button type="button" class="btn" onclick="UserReminders.closeDialog()">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="urSave" onclick="UserReminders.saveDialog()">Save</button></div>';
  }
  function fillRecs() {
    var b = curBiz(), t = byId('urLinkType'), s = byId('urLinkId'); if (!b || !t || !s) return;
    s.innerHTML = recOptions(b, t.value, null); s.disabled = !t.value;
  }
  function openDialog(r) {
    var A = getApp(), b = curBiz(); if (!A || !b) { toast('Open a business first'); return false; }
    try { var c = R(); if (c && c.close) c.close(); } catch (e) {}
    try { if (root.Topbar) root.Topbar.close(); } catch (e) {}
    var link = r ? (r.linked_type ? { type: r.linked_type, id: r.linked_id, label: r.linked_label } : null) : contextLink();
    dlg = { id: r ? r.id : null, link: link };
    A._openOverlay(dialogHtml(b, r, link));
    var ov = byId('appOverlay');
    if (ov) {
      if (ov.classList) ov.classList.add('ur-ov');
      if (ov.setAttribute) { ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', r ? 'Edit reminder' : 'New reminder'); }
    }
    setTimeout(function () { try { var t = byId('urTitle'); if (t && t.focus) t.focus(); } catch (e) {} }, 0);
    return true;
  }
  function openNew() { return openDialog(null); }
  function openEdit(id) { var b = curBiz(), r = b && byRid(b, id); if (!r) return false; return openDialog(r); }
  function closeDialog() { var A = getApp(); dlg = null; if (A && A._closeOverlay) A._closeOverlay(); }
  function dialogOpen() { return !!(dlg && byId('appOverlay') && byId('urTitle')); }
  function readDialog() {
    var v = function (id) { var el = byId(id); return el ? el.value : ''; };
    var lt = v('urLinkType'), li = v('urLinkId');
    var sel = byId('urLinkId'), label = '';
    if (lt && li !== '') {
      label = linkLabel(curBiz(), lt, li);
      if (!label && dlg && dlg.link && String(dlg.link.id) === String(li)) label = dlg.link.label;
      /* keep numeric record ids numeric */
      var hit = recs(curBiz(), lt).filter(function (x) { return x && String(x.id) === String(li); })[0];
      if (hit) li = hit.id;
    }
    return { title: v('urTitle'), note: v('urNote'), date: v('urDate'), time: v('urTime') || '09:00', repeat: v('urRepeat') || 'none',
      remind_before: +v('urBefore') || 0, linked_type: lt && li !== '' ? lt : '', linked_id: lt && li !== '' ? li : null, linked_label: label,
      priority: v('urPriority') || 'normal' };
  }
  function saveDialog() {
    var f = readDialog(), res = dlg && dlg.id ? update(dlg.id, f) : create(f);
    var box = byId('urErr');
    if (!res.ok) {
      if (box) { box.innerHTML = res.errors.map(esc).join('<br>'); if (box.classList) box.classList.remove('hide'); }
      var first = !String(f.title || '').trim() ? 'urTitle' : 'urDate', el = byId(first); try { if (el && el.focus) el.focus(); } catch (e) {}
      return res;
    }
    var wasEdit = !!(dlg && dlg.id);
    closeDialog();
    toast(wasEdit ? 'Reminder updated' : 'Reminder set for ' + fmtWhen(res.reminder.due_at));
    return res;
  }

  /* ---------- the Reminders page: Upcoming / Overdue / Done (+ the automatic ones) ---------- */
  var TABS = [['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['done', 'Done'], ['auto', 'Automatic']];
  function tabRows(b, tab) {
    var now = nowMs(), L = mine(b);
    if (tab === 'done') return L.filter(function (r) { return r.status === 'done'; }).sort(function (a, c) { return String(c.done_at || c.due_at).localeCompare(String(a.done_at || a.due_at)); });
    L = L.filter(function (r) { return r.status !== 'done' && (tab === 'overdue' ? msOf(r.due_at) < now : msOf(r.due_at) >= now); });
    return L.sort(function (a, c) { return msOf(a.due_at) - msOf(c.due_at); });
  }
  function counts(b) { var o = {}; ['upcoming', 'overdue', 'done'].forEach(function (t) { o[t] = tabRows(b, t).length; }); return o; }
  function statusText(r, now) {
    if (r.status === 'done') return '<span class="rm-badge rm-b-read">Done</span>';
    if (r.status === 'snoozed' && r.snooze_until && msOf(r.snooze_until) > now) return '<span class="rm-badge rm-b-soon">Snoozed</span><div class="rm-when">until ' + esc(fmtWhen(r.snooze_until)) + '</div>';
    if (msOf(r.due_at) < now) return '<span class="rm-badge rm-b-overdue">Overdue</span>';
    return isDue(r, now) ? '<span class="rm-badge rm-b-due">Due</span>' : '<span class="rm-badge rm-b-later">Open</span>';
  }
  function tabsHtml(b, tab) {
    var n = counts(b);
    return '<div class="ur-tabs" role="tablist" aria-label="Reminders">' + TABS.map(function (t) {
      var on = t[0] === tab, c = n[t[0]];
      return '<button type="button" role="tab" class="ur-tab' + (on ? ' on' : '') + (t[0] === 'overdue' && c ? ' ur-tab-od' : '') + '" aria-selected="' + (on ? 'true' : 'false') + '" onclick="UserReminders.setTab(' + esc(js(t[0])) + ')">' +
        esc(t[1]) + (c != null ? ' <span class="ur-tab-n">' + c + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function userPageHtml(b, tab) {
    var A = getApp(), now = nowMs(), rows = tabRows(b, tab);
    var head = '<div class="reg-panel-head rm-page-head"><span class="reg-panel-title">Reminders</span>' +
      '<button class="btn btn-xs btn-primary" onclick="UserReminders.openNew()">' + ico('plus', 14) + ' New reminder</button></div>';
    var body = rows.length ? rows.map(function (r) {
      var od = r.status !== 'done' && msOf(r.due_at) < now, id = esc(js(r.id));
      return '<tr class="' + (od ? 'ur-od' : '') + (r.status === 'done' ? ' rm-dim' : '') + '">' +
        '<td class="rm-rem"><span class="rm-t">' + esc(r.title) + '</span>' + (r.note ? '<div class="rm-d">' + esc(r.note) + '</div>' : '') + '</td>' +
        '<td class="nowrap ur-due">' + esc(fmtWhen(r.due_at)) + (r.status !== 'done' ? '<div class="rm-when">' + esc(relText(msOf(r.due_at), now)) + '</div>' : '') +
          (r.remind_before ? '<div class="rm-when">' + esc(labelOf(BEFORE, r.remind_before)) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + esc(labelOf(REPEATS, r.repeat || 'none')) + '</td>' +
        '<td class="ur-link">' + (r.linked_type && r.linked_id != null ? '<a class="led-link" onclick="UserReminders.open(' + id + ')">' + esc(r.linked_label || typeLabel(r.linked_type)) + '</a>' : '<span class="ur-muted">—</span>') + '</td>' +
        '<td class="nowrap">' + (r.priority === 'high' ? '<span class="rm-badge rm-b-high">High</span>' : 'Normal') + '</td>' +
        '<td class="nowrap">' + statusText(r, now) + '</td>' +
        '<td class="nowrap"><div class="rm-rowacts">' +
          (r.status === 'done' ? '<button class="btn btn-xs" onclick="UserReminders.reopen(' + id + ')">Reopen</button>'
            : '<button class="btn btn-xs" onclick="UserReminders.done(' + id + ')">Done</button>') +
          '<button class="btn btn-xs" onclick="UserReminders.openEdit(' + id + ')">Edit</button>' +
          '<button class="btn btn-xs ur-del" onclick="UserReminders.confirmDelete(' + id + ')">Delete</button>' +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="reg-empty">' + ({ upcoming: 'No upcoming reminders. Use New reminder (or press R) to set one.', overdue: 'Nothing overdue.', done: 'No finished reminders yet.' }[tab]) + '</div></td></tr>';
    return (A && A.crumb ? A.crumb('Reminders') : '') + head + tabsHtml(b, tab) +
      '<div class="tbl-scroll"><table class="reg-tbl rm-tbl ur-tbl"><thead><tr><th>Title</th><th>Due</th><th>Repeat</th><th>Linked to</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="reg-foot"><span class="cnt">' + rows.length + ' ' + (rows.length === 1 ? 'reminder' : 'reminders') + '</span></div>';
  }
  function pageHtml(b, core) {
    var c = R(), tab = API._tab;
    if (c) c._pageLive = true;
    if (tab === 'auto') {
      var inner = core ? core(b) : '';
      /* the core page brings its own crumb + head: put the tabs right under its head */
      var at = inner.indexOf('<div class="tbl-scroll">');
      return at >= 0 ? inner.slice(0, at) + tabsHtml(b, 'auto') + inner.slice(at) : tabsHtml(b, 'auto') + inner;
    }
    return userPageHtml(b, tab);
  }
  function setTab(t) {
    API._tab = TABS.some(function (x) { return x[0] === t; }) ? t : 'upcoming';
    var A = getApp(); if (A && A.wsMode === 'reminders') A.renderMain(A.curBiz());
  }
  function confirmDelete(id) {
    var b = curBiz(), r = b && byRid(b, id); if (!r) return Promise.resolve(false);
    var go = function (ok) { if (ok) { remove(id); toast('Reminder deleted'); } return !!ok; };
    var M = root.UIModal;
    if (M && M.confirm) return M.confirm('Delete the reminder "' + r.title + '"?', { title: 'Delete reminder', okText: 'Delete', danger: true }).then(go);
    return Promise.resolve(go(typeof root.confirm === 'function' ? root.confirm('Delete the reminder "' + r.title + '"?') : true));
  }

  /* ---------- keyboard: R opens the dialog; Esc / Enter inside it ---------- */
  function editable(el) {
    if (!el) return false;
    var tag = String(el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable || (el.getAttribute && el.getAttribute('contenteditable') === 'true');
  }
  function modalOpen() {
    var d = doc(); if (!d || !d.querySelector) return false;
    return !!d.querySelector('#appOverlay, .uim-ov, .modal-ov, .dz-overlay:not(.hide), [aria-modal="true"]');
  }
  function onKey(e) {
    if (dialogOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDialog(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        var t = e.target, tag = t && String(t.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA') return;                                   // new line in the Note
        if (tag === 'BUTTON' && t.id !== 'urSave') return;                 // Enter on Cancel = Cancel
        e.preventDefault(); e.stopPropagation(); saveDialog();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key !== 'r' && e.key !== 'R') return;
    var d = doc(), A = getApp();
    if (editable(e.target) || editable(d && d.activeElement)) return;
    if (modalOpen()) return;
    if (!A || A.view !== 'workspace' || !curBiz()) return;
    e.preventDefault();
    openNew();
  }

  /* ---------- wiring ---------- */
  function paintButton() {
    var i = doc() && doc().querySelector ? doc().querySelector('#hdRemind .hd-remind-i') : null;
    if (i) { i.innerHTML = ico('alarm', 18); if (i.dataset) i.dataset.painted = '1'; }
  }
  function install() {
    var c = R(); if (!c || API.__installed) return;
    API.__installed = 1;
    if (c.defineKind) c.defineKind('user', { label: 'My reminders', lead: 0, icon: 'alarm' });
    c.register('user', source);
    /* the Reminders page gets the tabs; "View all reminders" opens on Overdue when any, else Upcoming;
       a filter from the dropdown's "+N more" (automatic groups) opens the Automatic tab */
    var corePage = c.pageHtml;
    c.pageHtml = function (b) { return pageHtml(b, corePage); };
    var coreOpen = c.openPage;
    c.openPage = function (filter) {
      var b = curBiz();
      API._tab = filter ? 'auto' : (b && tabRows(b, 'overdue').length ? 'overdue' : 'upcoming');
      return coreOpen.apply(this, arguments);
    };
  }
  function installDom() {
    if (!hasDom() || API.__dom) return;
    API.__dom = 1;
    var d = document;
    d.addEventListener('keydown', onKey, true);
    paintButton();
    if (typeof setInterval === 'function') setInterval(function () { try { tick(); } catch (e) {} }, 60 * 1000);
  }

  var API = {
    __v: 1,
    openNew: openNew, openEdit: openEdit, closeDialog: closeDialog, saveDialog: saveDialog, readDialog: readDialog,
    create: create, update: update, remove: remove, done: done, snooze: snooze, reopen: reopen, open: open,
    confirmDelete: confirmDelete, setTab: setTab,
    list: function (b) { return mine(b || curBiz()); }, due: function (b) { return dueList(b || curBiz()); },
    isDue: isDue, isOverdue: isOverdue, nextDue: nextDue, contextLink: contextLink, linkLabel: linkLabel, validate: validate,
    tick: tick, source: source, pageHtml: function (b, tab) { return userPageHtml(b || curBiz(), tab || API._tab); },
    uid: uid, parts: parts, iso: iso, nextFullHour: nextFullHour, tomorrowAt9: tomorrowAt9,
    REPEATS: REPEATS, BEFORE: BEFORE,
    _tab: 'upcoming', _fillRecs: fillRecs, _onKey: onKey, _dialog: function () { return dlg; }
  };
  root.UserReminders = API;
  if (typeof globalThis !== 'undefined') globalThis.UserReminders = API;

  install();
  var d0 = doc();
  if (d0 && d0.readyState === 'loading' && d0.addEventListener) d0.addEventListener('DOMContentLoaded', installDom);
  else installDom();
})(typeof window !== 'undefined' ? window : globalThis);
