/* ============================================================
   CRM PLUS – reminders, policies and automation for the Fair Tax CRM
   • Reminders page (+ bell), and phone notifications through FTNotify
   • Client check-ins (call / message / feedback) with a span per client
   • Automatic schedules for new clients (bookkeeping, FS, audit, CT, VAT)
   • Auto-assignment of clients to staff by expertise, then workload
   • VAT / CT / FS / audit / bookkeeping tasks roll forward when completed
   • Meeting time & place, lead "last contact" tracking, mobile navigation
   Loaded into the CRM page after it opens (needs shared/reminders.js).
   ============================================================ */
(function () {
  'use strict';
  if (window.CRMPLUS || typeof load !== 'function' || !window.FTReminders) return;
  var R = window.FTReminders;
  var TODAY = function () { return ymd(new Date()); };
  var LEAD_TOUCH_ACTS = ['post-lead-note', 'save-edit-lead', 'convert-lead'];

  /* ---------------- who is signed in ---------------- */
  function me() {
    var m = (window.FT && FT.me) || null;
    if (!m) return {name: '', id: '', admin: true};
    return {name: m.name || m.id, id: m.id, admin: m.role === 'admin', uid: m.uid};
  }
  function team() { return window.FT_TEAM || []; }
  function myTeamName() {
    var db = load(), m = me();
    return (db.team || []).filter(function (n) { return R.nameMatch(n, m); })[0] || m.name || '';
  }
  function esc2(s) { return esc(s); }
  function daysAgo(d) { var p = R.parse(d); if (!p) return null; return Math.round((new Date(TODAY() + 'T00:00:00') - p) / 864e5); }
  function addDaysY(d, n) { var x = R.parse(d) || new Date(); x.setDate(x.getDate() + n); return ymd(x); }

  /* ---------------- policy (stored with the CRM data) ---------------- */
  function policy() { return R.policyOf(load()); }

  /* ---------------- team list stays in step with portal users ---------------- */
  function syncTeam(db) {
    var changed = false;
    db.team = db.team || [];
    team().forEach(function (u) {
      if (u.active === false || u.crm === false) return;
      if (!db.team.some(function (n) { return R.nameMatch(n, u); })) { db.team.push(u.name); changed = true; }
    });
    return changed;
  }

  /* ---------------- deadlines use the shared engine (correct weekend rule, per-client schedule) ---------------- */
  window.clientDeadlines = clientDeadlines = function (c, today, horizonDays) {
    return R.deadlines(c, today, horizonDays == null ? 400 : horizonDays, policy());
  };
  function makeDeadlineTask(db, c, d) {
    var staff = (c.staff || []).slice();
    var t = {id: uid('t'), title: d.title, type: 'Reminder', status: 'Not Started', dueDate: d.due, recurrence: d.recurrence, priority: d.priority, clientId: c.id, assignees: staff,
      source: 'auto_reminder', code: d.code, kind: d.kind, checklist: d.checklist, comments: [], createdBy: 'System', createdAt: TODAY()};
    db.tasks.unshift(t); db.genLog.push(d.code);
    return t;
  }
  window.runEngine = runEngine = function () {
    var db = load(), today = new Date(TODAY() + 'T00:00:00'), created = 0;
    db.genLog = db.genLog || [];
    // the very first automatic run only creates tasks for deadlines still ahead (past periods may already be filed)
    var cutoff = db.engineRunOn ? ymd(new Date(Date.now() - 45 * 864e5)) : TODAY();
    db.clients.filter(function (c) { return c.status === 'Active'; }).forEach(function (c) {
      clientDeadlines(c, today).forEach(function (d) {
        if (db.genLog.indexOf(d.code) >= 0) return;
        if (d.due < cutoff) { if (!db.engineRunOn) db.genLog.push(d.code); return; }   // older periods: never create later either
        if (d.createOn > TODAY()) return;
        if (db.tasks.some(function (t) { return t.code === d.code || (t.title === d.title && String(t.dueDate).slice(0, 7) === d.due.slice(0, 7)); })) { db.genLog.push(d.code); return; }
        makeDeadlineTask(db, c, d); created++;
      });
    });
    save(); return created;
  };

  /* ---------------- completing a deadline task sets up the next period ---------------- */
  var origNextRecurring = nextRecurring;
  window.nextRecurring = nextRecurring = function (db, task) {
    var kindOf = function (t) {
      if (t.kind) return t.kind;
      if (/^VAT Return Due/.test(t.title)) return 'vat'; if (/^Corporate Tax Filing Due/.test(t.title)) return 'corporate_tax';
      if (/^Financial Statements/.test(t.title)) return 'financial_statements'; if (/^Audit —/.test(t.title)) return 'audit'; if (/^Bookkeeping Review/.test(t.title)) return 'bookkeeping';
      return null;
    };
    var kind = kindOf(task), c = task.clientId && db.clients.find(function (x) { return x.id === task.clientId; });
    if (!(task.source === 'auto_reminder' && kind && c)) return origNextRecurring(db, task);
    var from = new Date((task.dueDate || TODAY()) + 'T00:00:00');
    var next = clientDeadlines(c, new Date(from.getTime() + 864e5), 420).filter(function (d) {
      return d.kind === kind && d.due > task.dueDate && !db.tasks.some(function (t) { return t.code === d.code || (t.title === d.title && String(t.dueDate).slice(0, 7) === d.due.slice(0, 7)); });
    })[0];
    if (!next) { toast('Completed – no further ' + kind.replace('_', ' ') + ' deadline found for this client'); return; }
    db.genLog = db.genLog || [];
    var t = makeDeadlineTask(db, c, next);
    if (!t.assignees.length) t.assignees = (task.assignees || []).slice();
    toast('Next one set: ' + next.title.replace(/ — .*\(/, ' (') + ' due ' + fmtDate(next.due));
  };

  /* ---------------- automatic assignment ---------------- */
  function autoAssign(db, c, force) {
    var P = policy();
    if (!force && (!P.autoAssign || (c.staff || []).length)) return null;
    var pick = R.suggestAssignee(c, db, team());
    if (!pick) return null;
    var name = (db.team || []).filter(function (n) { return R.nameMatch(n, {name: pick.name}); })[0] || pick.name;
    c.staff = [name]; c.assignedBy = 'auto'; c.assignedNote = pick.reason; c.assignedOn = TODAY();
    // open tasks for this client follow the new owner when they had nobody
    db.tasks.forEach(function (t) { if (t.clientId === c.id && t.status !== 'Completed' && !(t.assignees || []).length) t.assignees = [name]; });
    return name;
  }

  /* ---------------- new clients, daily engine, sweeps after every save ---------------- */
  var sweeping = false, sweepTimer = null;
  function sweep(quiet) {
    if (sweeping) return; sweeping = true;
    try {
      var db = load(), dirty = syncTeam(db), newOnes = [];
      db.clients.forEach(function (c) {
        if (!c.createdAt) { c.createdAt = TODAY(); dirty = true; }
        if (!c.plannedAt) { c.plannedAt = TODAY(); c.plan = c.plan || {}; dirty = true; newOnes.push(c); }
        if (c.status === 'Active' && !(c.staff || []).length && autoAssign(db, c)) { dirty = true; if (!quiet) toast('Auto-assigned ' + c.name + ' to ' + c.staff[0]); }
      });
      var runToday = db.engineRunOn !== TODAY();
      if (dirty) save();
      if (runToday || newOnes.length) { var n = runEngine(); db = load(); db.engineRunOn = TODAY(); save(); if (n && !quiet) toast(n + ' deadline task' + (n > 1 ? 's' : '') + ' created'); }
    } catch (e) { console.warn('CRM plus sweep', e); }
    sweeping = false;
  }
  var origSave = save;
  window.save = save = function () {
    origSave();
    if (sweeping) return;
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(function () { sweep(false); refreshPhone(); updateBell(); }, 600);
  };

  /* ---------------- lead activity + names of the signed-in person ---------------- */
  var origHandleAct = handleAct;
  window.handleAct = handleAct = function (act, el) {
    var id = el && el.getAttribute && el.getAttribute('data-id');
    var before = load(), countTasks = before.tasks.length, countLeads = before.leads.length;
    var clientBefore = null;
    if (act === 'save-edit-client' && id) { var cb = before.clients.find(function (x) { return x.id === id; }); if (cb) clientBefore = JSON.parse(JSON.stringify({vatCycle: cb.vatCycle, taxYearEnd: cb.taxYearEnd, services: cb.services})); }
    var meeting = act === 'save-task-modal' ? {time: ($('#m_time') || {}).value || '', location: ($('#m_loc') || {}).value || '', assignee: ($('#m_assignee') || {}).value || ''} : null;
    var result = origHandleAct(act, el);
    var db = load(), who = myTeamName() || me().name, changed = false;
    if (who) {
      if (act === 'post-lead-note' || act === 'post-client-note' || act === 'post-comment') {
        var coll = act === 'post-lead-note' ? db.leads : act === 'post-client-note' ? db.clients : db.tasks;
        var rec = coll.find(function (x) { return x.id === id; }), arr = rec && (act === 'post-comment' ? rec.comments : rec.notes);
        if (arr && arr[0] && arr[0].by === 'Waseem' && who !== 'Waseem') { arr[0].by = who; changed = true; }
      }
      if (act === 'save-lead' && db.leads.length > countLeads && db.leads[0].assignedTo === 'Waseem' && who !== 'Waseem') { db.leads[0].assignedTo = who; changed = true; }
      if (act === 'save-task-modal' && db.tasks.length > countTasks) {
        var t = db.tasks[0];
        if (t.createdBy === 'Waseem') t.createdBy = me().name || who;
        t.assignees = meeting.assignee ? [meeting.assignee] : (t.assignees && t.assignees[0] === 'Waseem' && who !== 'Waseem' ? [who] : t.assignees);
        if (meeting.time) t.time = meeting.time;
        if (meeting.location) t.location = meeting.location;
        changed = true;
      }
    }
    if (clientBefore) {
      var ca = db.clients.find(function (x) { return x.id === id; });
      if (ca) { var ch = Object.keys(clientBefore).filter(function (k) { return JSON.stringify(clientBefore[k] || '') !== JSON.stringify(ca[k] || ''); });
        if (ch.length && typeof replanClient === 'function') { var pl = replanClient(db, ca, ch); if (pl) { changed = true; setTimeout(function () { toast('Reminders re-planned' + (pl.next ? ' – next: ' + pl.next.title.replace(' — ' + ca.name, '') + ' ' + fmtDate(pl.next.due) : '')); }, 400); } } }
    }
    if (LEAD_TOUCH_ACTS.indexOf(act) >= 0 && id) { var l = db.leads.find(function (x) { return x.id === id; }); if (l) { l.lastActivity = TODAY(); changed = true; } }
    if (changed) { save(); if (act === 'save-task-modal' || act === 'post-lead-note' || act === 'post-client-note' || act === 'post-comment') route(); }
    return result;
  };
  // dragging a lead to another stage counts as contact
  var dragLead = null;
  document.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('[data-drag="lead"]'); dragLead = c ? c.getAttribute('data-id') : null; }, true);
  document.addEventListener('drop', function () { var id = dragLead; dragLead = null; if (!id) return; setTimeout(function () { var db = load(), l = db.leads.find(function (x) { return x.id === id; }); if (l) { l.lastActivity = TODAY(); save(); } }, 0); });

  /* ---------------- contact log ---------------- */
  var CONTACT = {call: '📞 Call', message: '💬 Message', feedback: '⭐ Feedback', meeting: '🤝 Meeting', note: '📝 Note'};
  function logContact(db, c, type, note, silentNote) {
    c.contacts = c.contacts || [];
    c.contacts.unshift({date: TODAY(), type: type, note: note || '', by: myTeamName() || me().name || ''});
    c.contacts = c.contacts.slice(0, 100);
    c.lastContact = TODAY();
    if (!silentNote && (note || type)) { c.notes = c.notes || []; c.notes.unshift({by: myTeamName() || me().name || 'Team', text: CONTACT[type].replace(/^\S+\s/, '') + (note ? ': ' + note : '')}); }
  }
  window.CRMPLUS_logContact = function (clientId, type, note) { var db = load(), c = db.clients.find(function (x) { return x.id === clientId; }); if (!c) return false; logContact(db, c, type || 'call', note); save(); return true; };

  function contactModal(clientId, type) {
    var db = load(), c = db.clients.find(function (x) { return x.id === clientId; }); if (!c) return;
    modal('<div class="modal"><div class="modal-head"><h3>' + CONTACT[type] + ' — ' + esc2(c.name) + '</h3><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Type</label><select id="cp_type">' + ['call', 'message', 'feedback', 'meeting'].map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + CONTACT[k] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>What happened (optional)</label><textarea id="cp_note" placeholder="e.g. Happy with service, sending bank statements this week"></textarea></div>' +
      '<div class="field"><label>Next check-in</label><select id="cp_next"><option value="">Normal schedule (every ' + R.planOf(c, policy()).healthDays + ' days)</option><option value="1">Tomorrow</option><option value="3">In 3 days</option><option value="14">In 2 weeks</option><option value="30">In a month</option></select></div>' +
      '<button class="btn btn-primary" style="width:100%" data-cp="save-contact" data-id="' + c.id + '">Save</button></div>');
  }

  /* ---------------- client page: Contact & schedule card ---------------- */
  var origClientDetail = renderClientDetail;
  window.renderClientDetail = renderClientDetail = function (id) {
    origClientDetail(id);
    var db = load(), c = db.clients.find(function (x) { return x.id === id; }); if (!c) return;
    var P = policy(), plan = R.planOf(c, P), own = c.plan || {}, gaps = R.missing(c);
    var ago = daysAgo(c.lastContact), nextDue = c.lastContact ? addDaysY(c.lastContact, plan.healthDays) : TODAY();
    if (c.nextContact && c.nextContact > TODAY()) nextDue = c.nextContact;
    var overdue = nextDue <= TODAY();
    var suggestion = R.suggestAssignee(c, db, team());
    var dls = R.deadlines(c, new Date(TODAY() + 'T00:00:00'), 120, P).filter(function (d) { return d.due >= TODAY(); }).slice(0, 6);
    var status = function (d) { var t = db.tasks.find(function (x) { return x.code === d.code || (x.title === d.title && String(x.dueDate).slice(0, 7) === d.due.slice(0, 7)); }); return t ? t.status : 'Scheduled'; };
    var sel = function (key, opts, val) { return '<select data-plan="' + key + '" data-id="' + c.id + '" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    var html = '<div class="card card-p cp-card" style="margin-bottom:18px"><div class="sec-title">🤝 Contact &amp; schedule</div>' +
      '<div class="kv"><span class="k">Last contact</span><span class="v">' + (c.lastContact ? fmtDate(c.lastContact) + ' (' + (ago === 0 ? 'today' : ago + ' days ago') + ')' : 'Not logged yet') + '</span></div>' +
      '<div class="kv"><span class="k">Next check-in</span><span class="v" style="' + (overdue ? 'color:var(--red);font-weight:700' : '') + '">' + (overdue ? 'Due now' : fmtDate(nextDue)) + '</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px">' + ['call', 'message', 'feedback', 'meeting'].map(function (k) { return '<button class="btn btn-sm" data-cp="contact" data-type="' + k + '" data-id="' + c.id + '">' + CONTACT[k] + '</button>'; }).join('') + '</div>' +
      ((c.contacts || []).length ? '<div style="font-size:12px;color:var(--muted);margin-top:6px">' + c.contacts.slice(0, 3).map(function (x) { return fmtDate(x.date) + ' · ' + CONTACT[x.type] + (x.note ? ' – ' + esc2(x.note) : '') + (x.by ? ' (' + esc2(x.by) + ')' : ''); }).join('<br>') + '</div>' : '') +
      '<div class="sec-title" style="margin-top:16px">👥 Assigned staff</div>' +
      '<div class="chip-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' + ((c.staff || []).map(function (s) { return '<span class="pill active">' + esc2(s) + ' <span data-cp="unassign" data-id="' + c.id + '" data-name="' + esc2(s) + '" style="cursor:pointer;margin-left:4px">✕</span></span>'; }).join('') || '<span style="color:var(--red);font-size:13px">Nobody assigned</span>') +
      '<select data-cp-assign="' + c.id + '" style="padding:5px 8px;border:1px solid var(--line);border-radius:8px"><option value="">＋ Add…</option>' + (db.team || []).filter(function (n) { return (c.staff || []).indexOf(n) < 0; }).map(function (n) { return '<option>' + esc2(n) + '</option>'; }).join('') + '</select></div>' +
      (c.assignedBy === 'auto' && c.assignedNote ? '<div style="font-size:12px;color:var(--muted);margin-top:4px">Auto-assigned: ' + esc2(c.assignedNote) + '</div>' : '') +
      (suggestion && !(c.staff || []).some(function (n) { return R.nameMatch(n, {name: suggestion.name}); }) ? '<div style="font-size:12px;margin-top:6px">Best match: <b>' + esc2(suggestion.name) + '</b> – ' + esc2(suggestion.reason) + ' <span class="link" data-cp="auto-assign" data-id="' + c.id + '">assign</span></div>' : (team().some(function (u) { return (u.expertise || []).length; }) ? '' : '<div style="font-size:12px;color:var(--muted);margin-top:6px">Add staff expertise in the portal (Users &amp; access) to auto-assign clients.</div>')) +
      '<div class="sec-title" style="margin-top:16px">🗓 Schedule <span style="font-weight:500;color:var(--muted);font-size:12px">(automatic unless changed)</span></div>' +
      '<div class="kv"><span class="k">Check-in every</span><span class="v">' + sel('healthDays', [['', 'Auto (' + (+P.healthDays || 7) + ' days)'], [3, '3 days'], [7, '7 days'], [14, '14 days'], [30, '30 days']], own.healthDays || '') + '</span></div>' +
      (R.deadlines(c, new Date(), 60, P).some(function (d) { return d.kind === 'bookkeeping'; }) || (c.services || []).some(function (s) { return /book/i.test(s); }) ? '<div class="kv"><span class="k">Bookkeeping review</span><span class="v">' + sel('bookkeeping', [['auto', 'Auto – ' + plan.bookkeeping + (plan.why.bookkeeping && plan.why.bookkeeping !== 'set on client' ? ' (' + plan.why.bookkeeping + ')' : '')], ['Weekly', 'Weekly'], ['Fortnightly', 'Every 2 weeks'], ['Monthly', 'Monthly (by the 10th)']], own.bookkeeping || 'auto') + '</span></div>' : '') +
      ((c.services || []).some(function (s) { return /financial statement|audit|corporate/i.test(s); }) ? '<div class="kv"><span class="k">Financial statements</span><span class="v">' + sel('fsMonths', [['', 'Auto (' + P.fsMonths + ' months after year end)'], [2, '2 months'], [3, '3 months'], [4, '4 months'], [6, '6 months']], own.fsMonths || '') + '</span></div>' : '') +
      ((c.services || []).some(function (s) { return /audit/i.test(s); }) ? '<div class="kv"><span class="k">Audit</span><span class="v">' + sel('auditMonths', [['', 'Auto (' + P.auditMonths + ' months after year end)'], [3, '3 months'], [4, '4 months'], [5, '5 months'], [6, '6 months']], own.auditMonths || '') + '</span></div>' : '') +
      '<div class="kv"><span class="k">Missing-details reminder</span><span class="v">' + sel('missingDays', [['', 'Auto (every ' + P.missingDays + ' days)'], [3, 'Every 3 days'], [7, 'Every 7 days'], [14, 'Every 14 days']], own.missingDays || '') + '</span></div>' +
      (gaps.length ? '<div style="margin-top:12px;background:var(--amber-soft);border-radius:10px;padding:10px 12px;font-size:13px"><b>🧩 Missing:</b> ' + esc2(gaps.join(', ')) + ' <span class="link" data-act="edit-client" data-id="' + c.id + '">Edit client</span></div>' : '<div style="margin-top:12px;font-size:13px;color:var(--brand-d)">✓ All key details present</div>') +
      (dls.length ? '<div class="sec-title" style="margin-top:16px">⏰ Coming deadlines</div>' + dls.map(function (d) { return '<div class="kv"><span class="k">' + esc2(d.title.replace(' — ' + c.name, '')) + '</span><span class="v">' + fmtDate(d.due) + ' · ' + status(d) + '</span></div>'; }).join('') : '') +
      '</div>';
    var col = document.querySelector('#app .detail-grid > div:nth-child(2)');
    if (col) col.insertAdjacentHTML('afterbegin', html);
  };

  /* ---------------- lead page: quick contact buttons ---------------- */
  var origLeadDetail = renderLeadDetail;
  window.renderLeadDetail = renderLeadDetail = function (id) {
    origLeadDetail(id);
    var db = load(), l = db.leads.find(function (x) { return x.id === id; }); if (!l) return;
    var ago = daysAgo(l.lastActivity);
    var html = '<div class="card card-p" style="margin-bottom:18px"><div class="sec-title">📞 Follow-up</div>' +
      '<div class="kv"><span class="k">Last contact</span><span class="v">' + (l.lastActivity ? fmtDate(l.lastActivity) + ' (' + (ago === 0 ? 'today' : ago + ' days ago') + ')' : 'Not contacted yet') + '</span></div>' +
      '<div class="kv"><span class="k">Assigned to</span><span class="v">' + esc2(l.assignedTo || '—') + '</span></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' +
      [['Called – interested', '📞 Interested'], ['Called – no answer', '📵 No answer'], ['WhatsApp message sent', '💬 WhatsApp'], ['Meeting held', '🤝 Meeting'], ['Quotation followed up', '🧾 Quote follow-up']]
        .map(function (b) { return '<button class="btn btn-sm" data-cp="lead-touch" data-id="' + l.id + '" data-note="' + esc2(b[0]) + '">' + b[1] + '</button>'; }).join('') +
      (l.phone && !/^-?$/.test(l.phone) ? '<a class="btn btn-sm" href="tel:' + esc2(String(l.phone).replace(/[^+\d]/g, '')) + '">☎ Call now</a><a class="btn btn-sm" target="_blank" href="https://wa.me/' + esc2(String(l.phone).replace(/[^\d]/g, '').replace(/^0/, '971')) + '">WhatsApp</a>' : '') +
      '</div><div style="font-size:12px;color:var(--muted);margin-top:8px">Logging contact stops today’s reminders for this lead.</div></div>';
    var col = document.querySelector('#app .detail-grid > div:nth-child(2)');
    if (col) col.insertAdjacentHTML('afterbegin', html);
  };

  /* ---------------- tasks: meeting time, place, assignee ---------------- */
  var origNewTask = openNewTask;
  window.openNewTask = openNewTask = function (pre) {
    origNewTask(pre);
    var due = $('#m_due'); if (!due) return;
    var db = load(), mine = myTeamName();
    var box = due.closest('.two-col');
    box.insertAdjacentHTML('afterend', '<div class="two-col"><div class="field"><label>Time (for meetings)</label><input type="time" id="m_time"></div><div class="field"><label>Place / link</label><input id="m_loc" placeholder="Office, client site, Zoom…"></div></div>' +
      '<div class="field"><label>Assign to</label><select id="m_assignee">' + (db.team || []).map(function (n) { return '<option' + (n === mine ? ' selected' : '') + '>' + esc2(n) + '</option>'; }).join('') + '</select></div>');
    if (pre && pre.lead) { /* lead tasks keep the lead name in the title */ }
  };
  var origTaskDetail = renderTaskDetail;
  window.renderTaskDetail = renderTaskDetail = function (id) {
    origTaskDetail(id);
    var db = load(), t = db.tasks.find(function (x) { return x.id === id; }); if (!t) return;
    var dueInput = document.querySelector('#app [data-edit="dueDate"]'); if (!dueInput) return;
    dueInput.closest('.two-col').insertAdjacentHTML('afterend', '<div class="two-col"><div class="field"><label>Time' + (t.type === 'Meeting' ? '' : ' (optional)') + '</label><input type="time" value="' + esc2(t.time || '') + '" data-edit="time" data-id="' + t.id + '"></div>' +
      '<div class="field"><label>Place / link</label><input value="' + esc2(t.location || '') + '" data-edit="location" data-id="' + t.id + '" placeholder="Office, client site, Zoom…"></div></div>' +
      '<div class="field"><label>Assigned to</label><select data-cp-task-assign="' + t.id + '">' + (db.team || []).map(function (n) { return '<option' + ((t.assignees || [])[0] === n ? ' selected' : '') + '>' + esc2(n) + '</option>'; }).join('') + (!(t.assignees || []).length ? '<option selected value="">— nobody —</option>' : '') + '</select></div>');
  };

  /* ---------------- reminders page + bell ---------------- */
  var remScope = null, remKind = 'all';
  function reminderList(scopeAll, days) {
    var m = me();
    return R.compute(load(), {days: days || 14, me: scopeAll ? {name: m.name, id: m.id, admin: true} : {name: myTeamName() || m.name, id: m.id, admin: false}, max: 1000});
  }
  function renderReminders() {
    var m = me(); if (remScope === null) remScope = m.admin ? 'all' : 'mine';
    var list = reminderList(remScope === 'all', 14);
    var kinds = {}; list.forEach(function (r) { kinds[r.kind] = (kinds[r.kind] || 0) + (r.grouped || 1); });
    var shown = list.filter(function (r) { return remKind === 'all' || r.kind === remKind; });
    var byDay = {}; shown.forEach(function (r) { var d = ymd(r.at); (byDay[d] = byDay[d] || []).push(r); });
    var phone = window.FTNotify && FTNotify.status ? FTNotify.status() : null;
    var db = load(), P = policy();
    var unassigned = db.clients.filter(function (c) { return c.status === 'Active' && !(c.staff || []).length; });
    var gaps = db.clients.filter(function (c) { return c.status === 'Active' && R.missing(c).length; });
    app.innerHTML = '<div class="page-head"><div><h1>Reminders</h1><p class="sub">Everything the system will remind ' + (remScope === 'all' ? 'the team' : 'you') + ' about in the next 14 days</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (m.admin ? '<button class="btn btn-sm ' + (remScope === 'mine' ? 'btn-primary' : '') + '" data-cp="rem-scope" data-v="mine">Mine</button><button class="btn btn-sm ' + (remScope === 'all' ? 'btn-primary' : '') + '" data-cp="rem-scope" data-v="all">Everyone</button>' : '') +
      '<a class="btn btn-sm" href="#/settings">⚙ Policies</a></div></div>' +
      (phone ? '<div class="card card-p" style="margin-bottom:14px;border-left:4px solid ' + (phone.ok ? 'var(--brand)' : 'var(--amber)') + '">' + (phone.desktop ? '💻' : '📱') + ' <span id="cp-phone-text">' + esc2(phone.text) + '</span>' + (phone.ok ? '' : ' <span class="link" data-cp="phone-enable">Turn on</span>') +
        '<div class="rc-act"><button class="btn" data-cp="phone-test">🔔 Send a test notification</button>' +
        (phone.hasSystem ? '<button class="btn" data-cp="phone-sound">🔊 Sound & pop-up settings</button>' + (phone.battery === false ? '<button class="btn btn-primary" data-cp="phone-battery">🔋 Allow reminders in background</button>' : '') : '') + '</div>' +
        (phone.battery === false ? '<div class="q-hint">Samsung: also open Settings → Apps → Fair Tax → Battery → <b>Unrestricted</b>, otherwise reminders may stop when the app is closed.</div>' : '') +
        (phone.ok && !phone.loud ? '<div class="q-hint">Install the latest app version for the louder Fair Tax reminder sound.</div>' : '') + '</div>' : '') +
      '<div style="display:flex;justify-content:flex-end;margin:-4px 0 10px"><button class="btn btn-primary btn-sm" data-cp="quick-add">＋ Quick add</button></div>' +
      '<div class="stats" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
      statCard('bg-blue', '📞', 'Open leads', db.leads.filter(function (l) { return l.stage !== 'Closed'; }).length, 'nudged every ' + P.leadEveryHours + 'h') +
      statCard('bg-green', '🤝', 'Check-ins due', db.clients.filter(function (c) { if (c.status !== 'Active') return false; var pl = R.planOf(c, P); return !c.lastContact || addDaysY(c.lastContact, pl.healthDays) <= TODAY(); }).length, 'call · message · feedback') +
      statCard('bg-red', '👥', 'Unassigned clients', unassigned.length, unassigned.length ? '<span class="link" data-cp="assign-all">Auto-assign now</span>' : 'all assigned') +
      statCard('bg-green', '🧩', 'Missing details', gaps.length, 'clients to complete') + '</div>' +
      '<div class="toolbar" style="flex-wrap:wrap">' + [['all', 'All']].concat(Object.keys(kinds).map(function (k) { return [k, (R.KIND[k] || {}).icon + ' ' + k.replace('_', ' ')]; })).map(function (k) {
        return '<button class="btn btn-sm ' + (remKind === k[0] ? 'btn-primary' : '') + '" data-cp="rem-kind" data-v="' + k[0] + '">' + k[1] + (k[0] !== 'all' ? ' <span style="opacity:.7">' + kinds[k[0]] + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      (Object.keys(byDay).length ? Object.keys(byDay).sort().map(function (d) {
        var dt = new Date(d + 'T00:00:00');
        return '<div class="card card-p" style="margin-bottom:12px"><div class="sec-title">' + (d === TODAY() ? 'Today' : dt.toLocaleDateString('en-GB', {weekday: 'long', day: 'numeric', month: 'short'})) + '</div>' +
          byDay[d].map(function (r) { return reminderCard(r, false); }).join('') + '</div>';
      }).join('') : '<div class="empty">No reminders in the next 14 days.</div>');
  }
  function countToday() {
    var now = new Date(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
    try { return reminderList(false, 1).filter(function (r) { return r.at <= end && r.kind !== 'agenda'; }).length; } catch (e) { return 0; }
  }
  function updateBell() { var b = document.getElementById('cp-bell-n'); if (b) { var n = countToday(); b.textContent = n; b.style.display = n ? '' : 'none'; } }
  var origNav = renderNav;
  window.renderNav = renderNav = function (active) {
    origNav(active);
    var links = $('#navLinks'); if (!links) return;
    var page = (location.hash || '#/dashboard').slice(2).split('/')[0];
    links.insertAdjacentHTML('beforeend', '<a href="#/reminders" class="' + (page === 'reminders' ? 'active' : '') + '">🔔 Reminders <span id="cp-bell-n" style="background:var(--red);color:#fff;border-radius:999px;font-size:11px;padding:1px 6px;display:none"></span></a><a data-cp="quick-add" class="qa-btn">＋ Quick add</a>');
    updateBell(); mobileNav(page);
  };

  /* ---------------- settings: reminder & assignment policies ---------------- */
  var origSettings = renderSettings;
  window.renderSettings = renderSettings = function () {
    origSettings();
    var P = policy(), days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var num = function (k, v, min, max, unit) { return '<input type="number" min="' + min + '" max="' + max + '" value="' + v + '" data-pol="' + k + '" style="width:80px"> ' + (unit || ''); };
    var html = '<div class="card card-p" style="margin-top:18px"><div class="sec-title">🔔 Reminders &amp; policies</div>' +
      '<p style="color:var(--muted);font-size:13px;margin-top:0">Apply to the whole team. Each client can override its own schedule on the client page.</p>' +
      '<div class="two-col"><div class="field"><label>Working days</label><div style="display:flex;gap:8px;flex-wrap:wrap">' + days.map(function (d, i) { return '<label style="display:flex;gap:4px;align-items:center;font-weight:500"><input type="checkbox" data-pol-day="' + i + '"' + (P.workDays.indexOf(i) >= 0 ? ' checked' : '') + '>' + d + '</label>'; }).join('') + '</div></div>' +
      '<div class="field"><label>Working hours</label>' + num('dayStart', P.dayStart, 0, 23, 'to') + ' ' + num('dayEnd', P.dayEnd, 1, 24, 'h') + '</div></div>' +
      '<div class="two-col"><div class="field"><label>Lead contact reminder every</label>' + num('leadEveryHours', P.leadEveryHours, 1, 8, 'hours') + '</div>' +
      '<div class="field"><label>Client check-in (call / message / feedback) every</label>' + num('healthDays', P.healthDays, 1, 90, 'days') + '</div></div>' +
      '<div class="two-col"><div class="field"><label>Missing client details reminder every</label>' + num('missingDays', P.missingDays, 1, 60, 'days') + '</div>' +
      '<div class="field"><label>Default bookkeeping review</label><select data-pol="bookkeeping">' + [['auto', 'Automatic (weekly for monthly VAT, every 2 weeks for quarterly VAT, monthly otherwise)'], ['Weekly', 'Weekly'], ['Fortnightly', 'Every 2 weeks'], ['Monthly', 'Monthly']].map(function (o) { return '<option value="' + o[0] + '"' + (P.bookkeeping === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="two-col"><div class="field"><label>Financial statements due after year end</label>' + num('fsMonths', P.fsMonths, 1, 9, 'months') + '</div>' +
      '<div class="field"><label>Audit due after year end</label>' + num('auditMonths', P.auditMonths, 1, 9, 'months') + '</div></div>' +
      '<div class="field"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pol="autoAssign"' + (P.autoAssign ? ' checked' : '') + '> Auto-assign new clients: the staff member whose expertise matches the client’s services, then the one with the fewest active clients</label></div>' +
      '<p style="color:var(--faint);font-size:12px;margin:0">Fixed by law: VAT return by the 28th after each period (weekend → Monday); Corporate Tax return within 9 months after year end. Reminders: VAT 14/7/3/1/0 days before, CT 60/30/14/7/3/1/0, contracts 30/7/1/0, PDC 3/1/0, meetings the evening before, the morning of and 1 hour before.</p></div>';
    var grid = document.querySelector('#app .detail-grid'); if (grid) grid.insertAdjacentHTML('afterend', html);
  };

  /* ---------------- clicks & changes for the new parts ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-cp]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var act = b.getAttribute('data-cp'), id = b.getAttribute('data-id'), db = load();
    var c = id && db.clients.find(function (x) { return x.id === id; });
    switch (act) {
      case 'contact': contactModal(id, b.getAttribute('data-type')); break;
      case 'save-contact': {
        if (!c) break;
        logContact(db, c, $('#cp_type').value, $('#cp_note').value.trim());
        var nx = $('#cp_next').value; c.nextContact = nx ? addDaysY(TODAY(), +nx) : '';
        if (nx) { c.plan = c.plan || {}; }
        save(); closeModal(); toast('Contact logged – next check-in ' + fmtDate(nx ? c.nextContact : addDaysY(TODAY(), R.planOf(c, policy()).healthDays))); route(); break;
      }
      case 'unassign': if (c) { c.staff = (c.staff || []).filter(function (s) { return s !== b.getAttribute('data-name'); }); c.assignedBy = 'manual'; save(); route(); } break;
      case 'auto-assign': if (c) { var n = autoAssign(db, c, true); save(); toast(n ? 'Assigned to ' + n : 'No matching staff'); route(); } break;
      case 'assign-all': { var k = 0; db.clients.forEach(function (x) { if (x.status === 'Active' && !(x.staff || []).length && autoAssign(db, x, true)) k++; }); save(); toast(k ? k + ' client(s) assigned' : 'No staff with matching expertise – add expertise in Users & access'); renderReminders(); break; }
      case 'lead-touch': { var l = db.leads.find(function (x) { return x.id === id; }); if (l) { l.lastActivity = TODAY(); l.notes = l.notes || []; l.notes.unshift({by: myTeamName() || me().name, at: new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}), text: b.getAttribute('data-note')}); if (l.stage === 'New') l.stage = 'Contacted'; save(); toast('Logged – reminders for this lead paused today'); route(); } break; }
      case 'rem-scope': remScope = b.getAttribute('data-v'); renderReminders(); break;
      case 'rem-kind': remKind = b.getAttribute('data-v'); if ((location.hash || '').indexOf('#/reminders') !== 0) location.hash = '#/reminders'; else renderReminders(); break;
      case 'q': quickDo(b.getAttribute('data-do'), {task: b.getAttribute('data-task'), client: b.getAttribute('data-client'), lead: b.getAttribute('data-lead'), invoice: b.getAttribute('data-invoice'), code: b.getAttribute('data-code')}); break;
      case 'tick': { var tt = taskById(db, b.getAttribute('data-task')); if (tt) { tickStep(db, tt, +b.getAttribute('data-i')); save(); var ss = R.stageOf(tt); if (ss.total && ss.done >= ss.total && tt.status !== 'Completed') toast('All steps done – tap ✓ Mark done to finish'); route(); } break; }
      case 'step-add': { var ta = taskById(db, b.getAttribute('data-task')), val = ($('#ck_new') || {}).value; if (ta && val && val.trim()) { ta.checklist = (ta.checklist || []).concat([val.trim()]); save(); route(); } break; }
      case 'qe-save': saveQuickEdit(id); break;
      case 'quick-add': quickAdd(); break;
      case 'qa': {
        var v = b.getAttribute('data-v'); closeModal();
        if (v === 'task') openNewTask();
        if (v === 'meeting') { openNewTask(); var mt = $('#m_type'); if (mt) mt.value = 'Meeting'; var mti = $('#m_title'); if (mti) mti.placeholder = 'e.g. Meeting with Gill Transport'; }
        if (v === 'lead') openAddLead();
        if (v === 'client') quickClient();
        if (v === 'log') pickClientModal('🤝 Log call / message', 'qp-log', '<div class="field"><label>Type</label><select id="qp_type">' + ['call', 'message', 'feedback', 'meeting'].map(function (k) { return '<option value="' + k + '">' + CONTACT[k] + '</option>'; }).join('') + '</select></div><div class="field"><label>What happened</label><textarea id="qp_note"></textarea></div>');
        if (v === 'note') pickClientModal('📝 Note on client', 'qp-note', '<div class="field"><label>Note</label><textarea id="qp_note"></textarea></div>');
        if (v === 'fix') pickClientModal('⚡ Update client details', 'qp-fix', '<p class="q-hint">Fix a wrong VAT period, year end, services, TRN, contract expiry and more – reminders are re-planned automatically.</p>');
        if (v === 'ai' && window.CRMAI) CRMAI.open();
        break;
      }
      case 'qp-log': { var cl1 = db.clients.find(function (x) { return x.id === $('#qp_client').value; }); if (cl1) { logContact(db, cl1, $('#qp_type').value, $('#qp_note').value.trim()); save(); closeModal(); toast('Logged for ' + cl1.name); route(); onRoute(); } break; }
      case 'qp-note': { var cl2 = db.clients.find(function (x) { return x.id === $('#qp_client').value; }), nt = $('#qp_note').value.trim(); if (cl2 && nt) { cl2.notes = cl2.notes || []; cl2.notes.unshift({by: myTeamName() || me().name, text: nt}); save(); closeModal(); toast('Note added to ' + cl2.name); route(); } break; }
      case 'qp-fix': { var cid = $('#qp_client').value; closeModal(); quickEdit(cid); break; }
      case 'qn-save': { var tn = taskById(db, b.getAttribute('data-task')), txt = $('#qn_text').value.trim(); if (tn && txt) { tn.comments = tn.comments || []; tn.comments.unshift({by: myTeamName() || me().name, at: new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}), text: txt}); if (tn.status === 'Not Started') tn.status = 'In Progress'; save(); closeModal(); toast('Note added'); route(); onRoute(); } break; }
      case 'qc-save': {
        var nm = $('#qc_name').value.trim(); if (!nm) { toast('Enter the company name'); break; }
        if (db.clients.some(function (x) { return x.name.toLowerCase() === nm.toLowerCase(); })) { toast('A client with this name already exists'); break; }
        var nc = {id: uid('c'), name: nm, status: 'Active', partnerId: 'p_un', email: $('#qc_email').value.trim(), phone: $('#qc_phone').value.trim() || '-', services: [].slice.call(document.querySelectorAll('.qc-svc')).filter(function (x) { return x.checked; }).map(function (x) { return x.value; }),
          vatCycle: $('#qc_vat').value, taxYearEnd: $('#qc_ye').value, trn: '-', tradeLicence: '', portalId: '', portalPassword: '', contractExpiry: '', address: '-', staff: [], invoiced: 0, received: 0, ledger: [], notes: [], createdAt: TODAY()};
        db.clients.unshift(nc); save(); closeModal(); toast('Client created – assigning staff and planning reminders…');
        setTimeout(function () { location.hash = '#/client/' + nc.id; }, 900); break;
      }
      case 'phone-test': if (window.FTNotify) FTNotify.test().then(function (ok) { toast(ok ? (FTNotify.desktop && FTNotify.desktop() ? 'Test reminder in 5 seconds – you can close the window to check it' : 'Test notification in 8 seconds – close the app now to check the sound') : 'Turn on notifications first'); }); break;
      case 'phone-battery': if (window.FTNotify) FTNotify.allowBackground(); break;
      case 'phone-sound': if (window.FTNotify) FTNotify.openNotificationSettings(); break;
      case 'phone-enable': if (window.FTNotify) FTNotify.enable().then(function () { renderReminders(); }); break;
      case 'more': document.getElementById('cp-more').classList.toggle('open'); break;
    }
  }, true);
  document.addEventListener('change', function (e) {
    var t = e.target, db = load();
    if (t.hasAttribute('data-plan')) {
      var c = db.clients.find(function (x) { return x.id === t.getAttribute('data-id'); }); if (!c) return;
      c.plan = c.plan || {}; var k = t.getAttribute('data-plan');
      if (t.value === '' || t.value === 'auto') delete c.plan[k]; else c.plan[k] = k === 'bookkeeping' ? t.value : +t.value;
      if (k === 'bookkeeping' || k === 'fsMonths' || k === 'auditMonths') {
        // future engine tasks follow the new schedule
        db.tasks = db.tasks.filter(function (x) { return !(x.clientId === c.id && x.source === 'auto_reminder' && x.status === 'Not Started' && x.dueDate > TODAY() && ((k === 'bookkeeping' && /^Bookkeeping/.test(x.title)) || (k === 'fsMonths' && /^Financial Statements/.test(x.title)) || (k === 'auditMonths' && /^Audit —/.test(x.title)))); });
        db.genLog = (db.genLog || []).filter(function (g) { return !(g.indexOf('|' + c.name + '|') > 0 && ((k === 'bookkeeping' && g.indexOf('BK|') === 0) || (k === 'fsMonths' && g.indexOf('FS|') === 0) || (k === 'auditMonths' && g.indexOf('AUD|') === 0))); });
        db.engineRunOn = '';
      }
      save(); toast('Schedule updated'); route(); return;
    }
    if (t.hasAttribute('data-cp-assign')) {
      var cl = db.clients.find(function (x) { return x.id === t.getAttribute('data-cp-assign'); }); if (!cl || !t.value) return;
      cl.staff = (cl.staff || []).concat([t.value]); cl.assignedBy = 'manual';
      db.tasks.forEach(function (x) { if (x.clientId === cl.id && x.status !== 'Completed' && !(x.assignees || []).length) x.assignees = [t.value]; });
      save(); toast('Assigned ' + t.value); route(); return;
    }
    if (t.hasAttribute('data-cp-status')) {
      var ts = taskById(db, t.getAttribute('data-cp-status')); if (!ts) return;
      if (t.value === 'Completed') completeTask(db, ts); else ts.status = t.value;
      save(); toast('Status: ' + t.value); route(); onRoute(); return;
    }
    if (t.hasAttribute('data-cp-task-assign')) {
      var tk = db.tasks.find(function (x) { return x.id === t.getAttribute('data-cp-task-assign'); }); if (!tk) return;
      tk.assignees = t.value ? [t.value] : []; save(); toast('Task assigned'); return;
    }
    if (t.hasAttribute('data-pol') || t.hasAttribute('data-pol-day')) {
      db.policy = db.policy || {};
      if (t.hasAttribute('data-pol-day')) { db.policy.workDays = [].slice.call(document.querySelectorAll('[data-pol-day]')).filter(function (x) { return x.checked; }).map(function (x) { return +x.getAttribute('data-pol-day'); }); }
      else { var key = t.getAttribute('data-pol'); db.policy[key] = t.type === 'checkbox' ? t.checked : (t.type === 'number' ? +t.value : t.value); }
      if (['fsMonths', 'auditMonths', 'bookkeeping'].indexOf(t.getAttribute('data-pol')) >= 0) db.engineRunOn = '';
      save(); toast('Policy saved'); return;
    }
  }, true);

  /* ---------------- phone navigation (the CRM hides its menu on small screens) ---------------- */
  var MCSS = '#cp-mnav{display:none}@media(max-width:900px){#cp-mnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:99980;background:#fff;border-top:1px solid var(--line);padding:4px 4px calc(4px + env(safe-area-inset-bottom))}' +
    '#cp-mnav a,#cp-mnav button{all:unset;flex:1;text-align:center;font-size:11px;font-weight:600;color:#6b7280;padding:6px 0;border-radius:10px;cursor:pointer;position:relative}#cp-mnav .i{display:block;font-size:19px;line-height:1.2}#cp-mnav .on{color:var(--brand)}' +
    '#cp-mnav .n{position:absolute;top:2px;left:55%;background:var(--red);color:#fff;border-radius:999px;font-size:10px;padding:0 5px}' +
    'body{padding-bottom:74px}.ft-bar{left:auto!important;right:8px!important;top:12px!important;bottom:auto!important;font-size:12px!important;padding:3px 4px!important;gap:2px!important}.ft-bar>span{display:none!important}.nav-right{display:none!important}' +
    '#cai-fab{bottom:84px!important;padding:10px 14px!important}#cai{bottom:72px!important;height:calc(100vh - 84px)!important}.wrap{padding-left:12px!important;padding-right:12px!important}' +
    '#cp-more{display:none;position:fixed;right:8px;bottom:70px;z-index:99981;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:6px;min-width:190px}#cp-more.open{display:block}' +
    '#cp-more a{display:block;padding:10px 12px;border-radius:9px;color:#111827;font-weight:600}#cp-more a:hover{background:#f3f4f6}.stats{grid-template-columns:1fr 1fr!important}.board{overflow-x:auto}}';
  function mobileNav(page) {
    if (!document.getElementById('cp-mcss')) { var st = document.createElement('style'); st.id = 'cp-mcss'; st.textContent = MCSS; document.head.appendChild(st); }
    var nav = document.getElementById('cp-mnav');
    if (!nav) {
      nav = document.createElement('nav'); nav.id = 'cp-mnav'; document.body.appendChild(nav);
      var more = document.createElement('div'); more.id = 'cp-more';
      more.innerHTML = [['#/quotations', '📝 Quotations'], ['#/agreements', '📄 Agreements'], ['#/invoices', '🧾 Invoices'], ['#/receipts', '💵 Receipts'], ['#/payments', '💳 Payments'], ['#/retention', '🗄 Retention'], ['#/settings', '⚙ Settings & policies'], ['../', '◀ Portal dashboard']]
        .map(function (x) { return '<a href="' + x[0] + '">' + x[1] + '</a>'; }).join('');
      more.addEventListener('click', function () { more.classList.remove('open'); });
      document.body.appendChild(more);
    }
    var n = countToday();
    nav.innerHTML = [['dashboard', '🏠', 'Home'], ['leads', '📞', 'Leads'], ['clients', '🏢', 'Clients'], ['+'], ['tasks', '✔', 'Tasks'], ['reminders', '🔔', 'Alerts']].map(function (x) {
      if (x[0] === '+') return '<button data-cp="quick-add" class="qa" aria-label="Quick add">＋</button>';
      var on = page === x[0] || (x[0] === 'leads' && page === 'lead') || (x[0] === 'clients' && page === 'client') || (x[0] === 'tasks' && page === 'task');
      return '<a href="#/' + x[0] + '" class="' + (on ? 'on' : '') + '"><span class="i">' + x[1] + '</span>' + x[2] + (x[0] === 'reminders' && n ? '<span class="n">' + n + '</span>' : '') + '</a>';
    }).join('') + '<button data-cp="more"><span class="i">☰</span>More</button>';
  }

  /* ---------------- dashboard greeting uses the signed-in name ---------------- */
  var origDash = renderDashboard;
  window.renderDashboard = renderDashboard = function () {
    origDash();
    var h = document.querySelector('#app .page-head h1'), first = String(me().name || '').split(/\s+/)[0];
    if (h && first) { var hr = new Date().getHours(); h.textContent = (hr < 12 ? 'Good morning, ' : hr < 17 ? 'Good afternoon, ' : 'Good evening, ') + first; }
    var list = reminderList(me().admin, 1).filter(function (r) { return ymd(r.at) === TODAY() && r.kind !== 'agenda'; });
    var head = document.querySelector('#app .page-head');
    if (head) head.insertAdjacentHTML('afterend', '<div class="card card-p" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center"><b>🔔 Today’s reminders (' + list.length + ')</b><a class="link" href="#/reminders">All reminders →</a></div>' +
      (list.length ? list.slice(0, 6).map(function (r) { return reminderCard(r, true); }).join('') : '<div style="color:var(--muted);font-size:13px;margin-top:6px">Nothing else for today.</div>') + '</div>');
    if (head) head.insertAdjacentHTML('beforeend', '<button class="btn btn-primary" data-cp="quick-add">＋ Quick add</button>');
  };

  /* ================= QUICK ACTIONS: stages, status, quick edit, quick add ================= */
  var QCSS = '.rc{display:flex;gap:12px;padding:12px 4px;border-top:1px solid var(--line)}.rc:first-of-type{border-top:0}.rc-time{min-width:46px;font-weight:800;font-size:12px;color:#374151;padding-top:2px}' +
    '.rc-main{flex:1;min-width:0}.rc-title{font-weight:700;font-size:13.5px;cursor:pointer}.rc-title:hover{color:var(--brand-d)}.rc-body{color:var(--muted);font-size:12.5px;margin-top:2px}' +
    '.rc-det{font-size:12px;color:#4b5563;margin-top:6px;line-height:1.5}.rc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}' +
    '.rc-bar{flex:0 0 120px;height:6px;background:#e5e7eb;border-radius:9px;overflow:hidden}.rc-bar i{display:block;height:100%;background:var(--brand)}' +
    '.rc-act{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.rc-act .btn{padding:5px 10px;font-size:12px;border-radius:8px}.rc-act select{padding:5px 8px;font-size:12px;border:1px solid var(--line);border-radius:8px;background:#fff}' +
    '.q-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.q-grid button{all:unset;cursor:pointer;border:1px solid var(--line);border-radius:12px;padding:14px;font-weight:700;font-size:14px;display:flex;gap:10px;align-items:center}.q-grid button:hover{border-color:var(--brand);background:var(--brand-soft)}' +
    '.q-grid button span{font-size:22px}.q-hint{font-size:12px;color:var(--muted);margin-top:4px}.q-focus input,.q-focus select{border-color:#f59e0b!important;background:#fffbeb!important}' +
    '.qe-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}@media(max-width:600px){.qe-grid{grid-template-columns:1fr}.q-grid{grid-template-columns:1fr}.rc-bar{flex-basis:80px}}' +
    '.ck{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px dashed var(--line);cursor:pointer}.ck b{font-weight:500}.ck.done b{text-decoration:line-through;color:var(--faint)}.ck .box{width:20px;height:20px;border:2px solid #cbd5e1;border-radius:6px;display:grid;place-items:center;flex:none;font-size:13px;color:#fff}.ck.done .box{background:var(--brand);border-color:var(--brand)}' +
    '.qa-btn{background:var(--brand);color:#fff!important;border-radius:9px;padding:6px 12px!important;height:auto!important}.qa-btn:hover{background:var(--brand-d)!important}' +
    '#cp-mnav .qa{flex:none;width:52px;height:52px;margin-top:-18px;border-radius:50%;background:linear-gradient(135deg,#0f9d6b,#0b5c9c);color:#fff;font-size:28px;line-height:52px;box-shadow:0 6px 16px rgba(11,92,156,.35)}';
  (function () { var st = document.createElement('style'); st.textContent = QCSS; document.head.appendChild(st); })();

  var STATUSES = ['Not Started', 'In Progress', 'Pending to Client', 'Completed'];
  function taskById(db, id) { return db.tasks.find(function (x) { return x.id === id; }); }
  function stageBar(t) {
    var s = R.stageOf(t), pill = statusPill(t.status);
    return '<div class="rc-meta"><span class="pill ' + pill + '">' + esc2(t.status) + '</span>' +
      (s.total ? '<span class="rc-bar" title="' + s.done + ' of ' + s.total + ' steps"><i style="width:' + s.pct + '%"></i></span><span style="font-size:12px;color:var(--muted)">' + (s.done >= s.total ? 'All ' + s.total + ' steps done' : 'Step ' + (s.done + 1) + ' of ' + s.total + (s.next ? ': ' + esc2(s.next) : '')) + '</span>' : '') + '</div>';
  }
  function completeTask(db, t) {
    var old = t.status; t.status = 'Completed'; t.completedAt = TODAY();
    if (old !== 'Completed' && ((t.recurrence && t.recurrence !== 'None') || t.source === 'auto_reminder')) nextRecurring(db, t);
    if (t.source === 'pdc') { var rc = (db.receipts || []).find(function (r) { return r.taskId === t.id; }); if (rc) rc.deposited = true; }
  }
  function tickStep(db, t, i) {
    t.checklistDone = t.checklistDone || [];
    var at = t.checklistDone.indexOf(i);
    if (at >= 0) t.checklistDone.splice(at, 1); else t.checklistDone.push(i);
    if (t.checklistDone.length && t.status === 'Not Started') t.status = 'In Progress';
  }
  function reminderButtons(r) {
    var b = [], d = function (x) { return 'data-cp="q" data-do="' + x + '"' + (r.taskId ? ' data-task="' + r.taskId + '"' : '') + (r.clientId ? ' data-client="' + r.clientId + '"' : '') + (r.leadId ? ' data-lead="' + r.leadId + '"' : '') + (r.invoiceId ? ' data-invoice="' + r.invoiceId + '"' : '') + (r.code ? ' data-code="' + esc2(r.code) + '"' : ''); };
    var db = load(), t = r.taskId && taskById(db, r.taskId);
    if (r.grouped) return '<div class="rc-act"><button class="btn" data-cp="rem-kind" data-v="' + r.kind + '">Show all ' + r.grouped + '</button></div>';
    if (t && t.status !== 'Completed') {
      b.push('<button class="btn btn-primary" ' + d('done') + '>✓ Done</button>');
      var s = R.stageOf(t); if (s.total && s.next) b.push('<button class="btn" ' + d('next') + '>➜ Step done</button>');
      b.push('<select data-cp-status="' + t.id + '">' + STATUSES.map(function (x) { return '<option' + (x === t.status ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>');
      b.push('<button class="btn" ' + d('note') + '>＋ Note</button>');
    }
    if (r.kind === 'lead') { var l = db.leads.find(function (x) { return x.id === r.leadId; }) || {};
      b.push('<button class="btn btn-primary" ' + d('called') + '>📞 Called</button>');
      if (l.phone && !/^-?$/.test(l.phone)) b.push('<a class="btn" href="tel:' + esc2(String(l.phone).replace(/[^+\d]/g, '')) + '">☎ Call</a><a class="btn" target="_blank" href="https://wa.me/' + esc2(String(l.phone).replace(/[^\d]/g, '').replace(/^0/, '971')) + '">WhatsApp</a>');
      b.push('<button class="btn" data-act="edit-lead" data-id="' + r.leadId + '">✎ Edit</button>'); }
    if (r.kind === 'health') b.push('<button class="btn btn-primary" data-cp="contact" data-type="call" data-id="' + r.clientId + '">📞 Called</button><button class="btn" data-cp="contact" data-type="message" data-id="' + r.clientId + '">💬 Messaged</button><button class="btn" data-cp="contact" data-type="feedback" data-id="' + r.clientId + '">⭐ Feedback</button>');
    if (r.kind === 'missing') b.push('<button class="btn btn-primary" ' + d('edit') + '>⚡ Fill in now</button>');
    if (r.kind === 'contract') b.push('<button class="btn btn-primary" ' + d('edit') + '>⚡ Update expiry</button><button class="btn" data-act="agr-for-client" data-id="' + r.clientId + '">📄 New agreement</button>');
    if (['vat', 'corporate_tax', 'financial_statements', 'audit', 'bookkeeping'].indexOf(r.kind) >= 0) {
      if (!t) b.push('<button class="btn btn-primary" ' + d('create-task') + '>＋ Start task</button>');
      b.push('<button class="btn" ' + d('edit') + ' title="Wrong VAT period, year end or services?">⚡ Correct client details</button>');
    }
    if (r.kind === 'health' || r.kind === 'meeting') b.push('<button class="btn" ' + d('edit') + '>⚡ Update client</button>');
    if (r.kind === 'invoice') b.push('<button class="btn btn-primary" ' + d('paid') + '>✓ Mark paid</button>');
    if (r.kind === 'assign') b.push('<button class="btn btn-primary" data-cp="assign-all">👥 Auto-assign now</button>');
    return b.length ? '<div class="rc-act">' + b.filter(function (x, i, a) { return !(x.indexOf('⚡ Update client') >= 0 && !r.clientId) && a.indexOf(x) === i; }).join('') + '</div>' : '';
  }
  function reminderCard(r, compact) {
    var db = load(), t = r.taskId && taskById(db, r.taskId);
    var det = (r.details || []).filter(function (x) { return !/^(Status|Next step|Client): /.test(x) || !t; });
    return '<div class="rc"><div class="rc-time">' + r.at.toTimeString().slice(0, 5) + '</div><div class="rc-main">' +
      '<div class="rc-title" data-goto="' + esc2(r.route) + '">' + esc2(r.title) + '</div><div class="rc-body">' + esc2(r.body) + '</div>' +
      (t ? stageBar(t) : '') +
      (!compact && det.length ? '<div class="rc-det">' + det.slice(0, 5).map(esc2).join('<br>') + '</div>' : '') +
      reminderButtons(r) + '</div></div>';
  }

  /* ----- quick edit of a client (fix a wrong VAT period, year end, services …) ----- */
  var SERVICE_LIST = ['VAT', 'Corporate Tax', 'Bookkeeping', 'Audit', 'Financial Statements', 'AML'];
  var VAT_CYCLES = [['Monthly', 'Monthly – every month'], ['Stagger 1', 'Stagger 1 – quarters end Jan, Apr, Jul, Oct'], ['Stagger 2', 'Stagger 2 – quarters end Feb, May, Aug, Nov'], ['Stagger 3', 'Stagger 3 – quarters end Mar, Jun, Sep, Dec']];
  var REPLAN_KEYS = {vatCycle: ['vat'], services: ['vat', 'corporate_tax', 'financial_statements', 'audit', 'bookkeeping'], taxYearEnd: ['corporate_tax', 'financial_statements', 'audit'], bookkeepingStart: ['bookkeeping']};
  var CODE_PREFIX = {vat: 'VAT|', corporate_tax: 'CT|', financial_statements: 'FS|', audit: 'AUD|', bookkeeping: 'BK|'};
  function kindOfTask(t) {
    return t.kind || (/^VAT Return Due/.test(t.title) ? 'vat' : /^Corporate Tax Filing Due/.test(t.title) ? 'corporate_tax' : /^Financial Statements/.test(t.title) ? 'financial_statements' : /^Audit —/.test(t.title) ? 'audit' : /^Bookkeeping Review/.test(t.title) ? 'bookkeeping' : null);
  }
  // after a change to VAT cycle / year end / services: future, untouched deadline tasks are rebuilt on the new schedule
  function replanClient(db, c, changed) {
    var kinds = [];
    (changed || []).forEach(function (k) { (REPLAN_KEYS[k] || []).forEach(function (x) { if (kinds.indexOf(x) < 0) kinds.push(x); }); });
    if (!kinds.length) return null;
    var today = TODAY(), removed = 0;
    db.tasks = db.tasks.filter(function (t) {
      var drop = t.clientId === c.id && t.source === 'auto_reminder' && t.status === 'Not Started' && !(t.checklistDone || []).length && !(t.comments || []).length && t.dueDate >= today && kinds.indexOf(kindOfTask(t)) >= 0;
      if (drop) removed++;
      return !drop;
    });
    db.genLog = (db.genLog || []).filter(function (g) { return !(g.indexOf('|' + c.name + '|') > 0 && kinds.some(function (k) { return g.indexOf(CODE_PREFIX[k]) === 0; })); });
    db.tasks.forEach(function (t) { if (t.clientId === c.id && t.code && db.genLog.indexOf(t.code) < 0) db.genLog.push(t.code); });
    clientDeadlines(c, new Date(today + 'T00:00:00')).forEach(function (d) { if (kinds.indexOf(d.kind) >= 0 && d.due < today && db.genLog.indexOf(d.code) < 0) db.genLog.push(d.code); });
    var created = runEngine();
    var next = clientDeadlines(c, new Date(today + 'T00:00:00'), 200).filter(function (d) { return kinds.indexOf(d.kind) >= 0 && d.due >= today; })[0];
    return {removed: removed, created: created, next: next};
  }
  function quickEdit(clientId, focus) {
    var db = load(), c = db.clients.find(function (x) { return x.id === clientId; }); if (!c) { toast('Client not found'); return; }
    var gaps = R.missing(c), want = (focus && focus.length ? focus : gaps).join('|');
    var f = function (name) { return want.indexOf(name) >= 0 ? ' q-focus' : ''; };
    var inp = function (id, label, val, type, cls) { return '<div class="field' + cls + '"><label>' + label + '</label><input id="qe_' + id + '" type="' + (type || 'text') + '" value="' + esc2(val || '') + '"></div>'; };
    var svc = (c.services || []).map(function (s) { return String(s).toLowerCase(); });
    modal('<div class="modal wide"><div class="modal-head"><h3>⚡ Update ' + esc2(c.name) + '</h3><button class="x" data-act="close">×</button></div>' +
      (gaps.length ? '<div style="background:var(--amber-soft);border-radius:10px;padding:8px 12px;font-size:13px;margin-bottom:10px">Missing: <b>' + esc2(gaps.join(', ')) + '</b> (highlighted)</div>' : '') +
      '<div class="field"><label>Services</label><div style="display:flex;gap:10px;flex-wrap:wrap">' + SERVICE_LIST.map(function (s) { return '<label style="display:flex;gap:5px;align-items:center;font-weight:500"><input type="checkbox" class="qe-svc" value="' + s + '"' + (svc.indexOf(s.toLowerCase()) >= 0 ? ' checked' : '') + '>' + s + '</label>'; }).join('') + '</div></div>' +
      '<div class="qe-grid">' +
      '<div class="field' + f('VAT cycle') + '"><label>VAT period (cycle)</label><select id="qe_vatCycle">' + '<option value="">— not set —</option>' + VAT_CYCLES.map(function (v) { return '<option value="' + v[0] + '"' + (c.vatCycle === v[0] ? ' selected' : '') + '>' + v[1] + '</option>'; }).join('') + '</select></div>' +
      inp('taxYearEnd', 'Financial year end', c.taxYearEnd, 'date', f('tax year end')) +
      inp('trn', 'TRN', c.trn === '-' ? '' : c.trn, 'text', f('TRN')) +
      inp('portalId', 'FTA portal ID', c.portalId, 'text', f('FTA portal ID')) +
      inp('tradeLicence', 'Trade licence no', c.tradeLicence, 'text', f('trade licence')) +
      inp('contractExpiry', 'Contract expiry', c.contractExpiry, 'date', f('contract expiry')) +
      inp('phone', 'Phone', c.phone === '-' ? '' : c.phone, 'tel', f('phone')) +
      inp('email', 'Email', /none@none/.test(c.email || '') ? '' : c.email, 'email', f('email')) +
      inp('address', 'Address', c.address === '-' ? '' : c.address, 'text', f('address')) +
      '<div class="field' + f('assigned staff') + '"><label>Assigned staff</label><select id="qe_staff"><option value="">— nobody —</option>' + (db.team || []).map(function (n) { return '<option' + ((c.staff || [])[0] === n ? ' selected' : '') + '>' + esc2(n) + '</option>'; }).join('') + '</select></div>' +
      '</div><div id="qe_preview" class="q-hint" style="margin:4px 0 12px"></div>' +
      '<button class="btn btn-primary" style="width:100%" data-cp="qe-save" data-id="' + c.id + '">Save & re-plan reminders</button></div>');
    var preview = function () {
      var tmp = Object.assign({}, c, readQuickEdit(c));
      var next = clientDeadlines(tmp, new Date(TODAY() + 'T00:00:00'), 400).filter(function (d) { return d.due >= TODAY() && d.kind !== 'bookkeeping'; }).slice(0, 3);
      var el = $('#qe_preview'); if (el) el.innerHTML = next.length ? '📅 Next deadlines with these details: ' + next.map(function (d) { return '<b>' + esc2(d.title.replace(' — ' + c.name, '')) + '</b> ' + fmtDate(d.due); }).join(' · ') : 'No statutory deadlines for these services.';
    };
    $('#modalRoot').addEventListener('change', preview); preview();
    var first = document.querySelector('#modalRoot .q-focus input, #modalRoot .q-focus select'); if (first) first.focus();
  }
  function readQuickEdit(c) {
    var v = function (id) { var el = $('#qe_' + id); return el ? el.value.trim() : undefined; };
    var keep = (c.services || []).filter(function (s) { return SERVICE_LIST.map(function (x) { return x.toLowerCase(); }).indexOf(String(s).toLowerCase()) < 0; });
    var out = {services: keep.concat([].slice.call(document.querySelectorAll('.qe-svc')).filter(function (x) { return x.checked; }).map(function (x) { return x.value; })),
      vatCycle: v('vatCycle'), taxYearEnd: v('taxYearEnd'), trn: v('trn') || '-', portalId: v('portalId'), tradeLicence: v('tradeLicence'), contractExpiry: v('contractExpiry'),
      phone: v('phone') || '-', email: v('email'), address: v('address') || '-'};
    var st = v('staff'); out.staff = st ? [st].concat((c.staff || []).filter(function (n) { return n !== st; }).slice(0, 2)) : [];
    return out;
  }
  function saveQuickEdit(id) {
    var db = load(), c = db.clients.find(function (x) { return x.id === id; }); if (!c) return;
    var next = readQuickEdit(c), changed = [];
    var norm = function (k, v) { v = v == null ? '' : v; return k === 'services' ? JSON.stringify((v || []).map(function (x) { return String(x).toLowerCase(); }).sort()) : JSON.stringify(v); };
    Object.keys(next).forEach(function (k) { if (norm(k, c[k]) !== norm(k, next[k])) { changed.push(k); c[k] = next[k]; } });
    if (changed.indexOf('staff') >= 0) { c.assignedBy = 'manual'; db.tasks.forEach(function (t) { if (t.clientId === c.id && t.status !== 'Completed' && (!(t.assignees || []).length)) t.assignees = c.staff.slice(0, 1); }); }
    var plan = replanClient(db, c, changed);
    save(); closeModal();
    toast(!changed.length ? 'No changes' : 'Saved' + (plan ? ' · reminders re-planned' + (plan.next ? ' – next: ' + plan.next.title.replace(' — ' + c.name, '') + ' ' + fmtDate(plan.next.due) : '') : ''));
    route(); onRoute();
  }

  /* ----- quick add ----- */
  function clientOptions(db) { return db.clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (c) { return '<option value="' + c.id + '">' + esc2(c.name) + '</option>'; }).join(''); }
  function quickAdd() {
    modal('<div class="modal"><div class="modal-head"><h3>＋ Quick add</h3><button class="x" data-act="close">×</button></div><div class="q-grid">' +
      [['task', '✔', 'Task'], ['meeting', '📅', 'Meeting'], ['lead', '📞', 'Lead'], ['client', '🏢', 'Client'], ['log', '🤝', 'Log call / message'], ['note', '📝', 'Note on client'], ['fix', '⚡', 'Update client details'], ['ai', '✦', 'Ask AI assistant']]
        .map(function (x) { return '<button data-cp="qa" data-v="' + x[0] + '"><span>' + x[1] + '</span>' + x[2] + '</button>'; }).join('') + '</div></div>');
  }
  function pickClientModal(title, button, extra) {
    var db = load();
    modal('<div class="modal"><div class="modal-head"><h3>' + title + '</h3><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Client</label><select id="qp_client">' + clientOptions(db) + '</select></div>' + (extra || '') +
      '<button class="btn btn-primary" style="width:100%" data-cp="' + button + '">Continue</button></div>');
  }
  function quickClient() {
    modal('<div class="modal"><div class="modal-head"><h3>🏢 New client</h3><button class="x" data-act="close">×</button></div>' +
      '<div class="field"><label>Company name</label><input id="qc_name" placeholder="e.g. Rio General Trading LLC"></div>' +
      '<div class="two-col"><div class="field"><label>Phone</label><input id="qc_phone" type="tel"></div><div class="field"><label>Email</label><input id="qc_email" type="email"></div></div>' +
      '<div class="field"><label>Services</label><div style="display:flex;gap:10px;flex-wrap:wrap">' + SERVICE_LIST.map(function (s) { return '<label style="display:flex;gap:5px;align-items:center;font-weight:500"><input type="checkbox" class="qc-svc" value="' + s + '">' + s + '</label>'; }).join('') + '</div></div>' +
      '<div class="two-col"><div class="field"><label>VAT period (cycle)</label><select id="qc_vat"><option value="">— not registered —</option>' + VAT_CYCLES.map(function (v) { return '<option value="' + v[0] + '">' + v[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Financial year end</label><input id="qc_ye" type="date" value="' + new Date().getFullYear() + '-12-31"></div></div>' +
      '<p class="q-hint">Staff are assigned automatically by expertise, and reminders (VAT, CT, FS, audit, bookkeeping, check-ins) are planned automatically.</p>' +
      '<button class="btn btn-primary" style="width:100%" data-cp="qc-save">＋ Create client</button></div>');
    setTimeout(function () { var el = $('#qc_name'); if (el) el.focus(); }, 30);
  }

  /* ----- actions from buttons and phone notifications ----- */
  function quickDo(what, ids) {
    var db = load(), t = ids.task && taskById(db, ids.task), msg = '';
    switch (what) {
      case 'done': if (!t) return; completeTask(db, t); msg = '✓ Completed: ' + t.title; break;
      case 'next': {
        if (!t) return; var s = R.stageOf(t);
        if (s.total && s.nextIndex >= 0) { tickStep(db, t, s.nextIndex); var s2 = R.stageOf(t); msg = s2.done >= s2.total ? 'All steps done – tap ✓ Done to finish' : '✓ Step done – next: ' + s2.next; }
        else if (t.status === 'Not Started') { t.status = 'In Progress'; msg = 'Marked In Progress'; }
        break;
      }
      case 'called': {
        var l = db.leads.find(function (x) { return x.id === ids.lead; }); if (!l) return;
        l.lastActivity = TODAY(); l.notes = l.notes || []; l.notes.unshift({by: myTeamName() || me().name, at: new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}), text: 'Called (from reminder)'});
        if (l.stage === 'New') l.stage = 'Contacted'; msg = 'Logged call with ' + l.name; break;
      }
      case 'checkin': { var c = db.clients.find(function (x) { return x.id === ids.client; }); if (!c) return; logContact(db, c, 'call', 'Checked in (from reminder)'); msg = 'Check-in logged for ' + c.name; break; }
      case 'paid': { var v = (db.invoices || []).find(function (x) { return x.id === ids.invoice; }); if (!v) return; v.status = 'Paid'; msg = 'Invoice ' + (v.invoiceNo || '') + ' marked paid'; break; }
      case 'edit': quickEdit(ids.client); return;
      case 'create-task': {
        var cl = db.clients.find(function (x) { return x.id === ids.client; }); if (!cl) return;
        var d = clientDeadlines(cl, new Date(Date.now() - 60 * 864e5), 460).filter(function (x) { return x.code === ids.code; })[0];
        if (!d) return; db.genLog = db.genLog || [];
        var nt = makeDeadlineTask(db, cl, d); nt.status = 'In Progress'; msg = 'Task started: ' + nt.title; break;
      }
      case 'note': {
        modal('<div class="modal"><div class="modal-head"><h3>＋ Note</h3><button class="x" data-act="close">×</button></div><div class="field"><label>' + esc2(t ? t.title : '') + '</label><textarea id="qn_text" placeholder="e.g. Client sent sales invoices, waiting for bank statement"></textarea></div>' +
          '<button class="btn btn-primary" style="width:100%" data-cp="qn-save" data-task="' + (t ? t.id : '') + '">Save note</button></div>');
        setTimeout(function () { var el = $('#qn_text'); if (el) el.focus(); }, 30); return;
      }
    }
    save(); if (msg) toast(msg); route(); onRoute();
  }
  function runPending() {
    var raw = null; try { raw = JSON.parse(sessionStorage.getItem(FTNotify_PENDING()) || 'null'); sessionStorage.removeItem(FTNotify_PENDING()); } catch (e) {}
    if (!raw || Date.now() - raw.at > 10 * 60 * 1000) return;
    var map = {done: 'done', next: 'next', called: 'called', checkin: 'checkin', edit: 'edit'};
    if (map[raw.act]) setTimeout(function () { quickDo(map[raw.act], {task: raw.taskId, lead: raw.leadId, client: raw.clientId}); }, 300);
  }
  function FTNotify_PENDING() { return (window.FTNotify && FTNotify.PENDING_KEY) || 'ft-pending-action'; }

  /* ----- task board shows progress; task page gets tickable steps ----- */
  var origTaskCard = taskCard;
  window.taskCard = taskCard = function (t, db) {
    var html = origTaskCard(t, db), s = R.stageOf(t);
    if (!s.total) return html;
    return html.replace(/<div class="foot">/, '<div class="meta" style="display:flex;align-items:center;gap:6px"><span class="rc-bar" style="flex:1"><i style="width:' + s.pct + '%"></i></span>' + s.done + '/' + s.total + '</div><div class="foot">');
  };
  var baseTaskDetail = renderTaskDetail;
  window.renderTaskDetail = renderTaskDetail = function (id) {
    baseTaskDetail(id);
    var db = load(), t = taskById(db, id); if (!t) return;
    var s = R.stageOf(t), head = document.querySelector('#app .page-head h1');
    if (head) head.insertAdjacentHTML('afterend', stageBar(t) + '<div class="rc-act">' + (t.status !== 'Completed' ? '<button class="btn btn-primary" data-cp="q" data-do="done" data-task="' + t.id + '">✓ Mark done</button>' + (s.next ? '<button class="btn" data-cp="q" data-do="next" data-task="' + t.id + '">➜ Step done</button>' : '') : '') +
      (t.clientId ? '<button class="btn" data-cp="q" data-do="edit" data-client="' + t.clientId + '">⚡ Correct client details</button>' : '') + '</div>');
    var labels = [].slice.call(document.querySelectorAll('#app .field > label')).filter(function (l) { return l.textContent.trim() === 'Checklist'; });
    var box = labels[0] && labels[0].parentNode;
    var html = '<label>Steps</label>' + (t.checklist || []).map(function (step, i) { var done = (t.checklistDone || []).indexOf(i) >= 0; return '<div class="ck' + (done ? ' done' : '') + '" data-cp="tick" data-task="' + t.id + '" data-i="' + i + '"><span class="box">' + (done ? '✓' : '') + '</span><b>' + esc2(step) + '</b></div>'; }).join('') +
      '<div style="display:flex;gap:8px;margin-top:8px"><input id="ck_new" placeholder="Add a step…" style="flex:1"><button class="btn btn-sm" data-cp="step-add" data-task="' + t.id + '">＋ Add step</button></div>';
    if (box) box.innerHTML = html;
    else { var card = document.querySelector('#app .card.card-p'); if (card) { var div = document.createElement('div'); div.className = 'field'; div.innerHTML = html; var foot = card.lastElementChild; card.insertBefore(div, foot); } }
  };

  /* ---------------- routing for the new page ---------------- */
  function onRoute() {
    var page = (location.hash || '#/dashboard').slice(2).split('/')[0];
    if (page === 'reminders') { renderNav('reminders'); renderReminders(); window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', onRoute);

  /* ---------------- phone notifications ---------------- */
  var phoneTimer = null;
  function refreshPhone() {
    if (!window.FTNotify) return;
    clearTimeout(phoneTimer);
    phoneTimer = setTimeout(function () {
      try { FTNotify.schedule(load()).then(function () { var el = document.getElementById('cp-phone-text'), st = FTNotify.status(); if (el && st) el.textContent = st.text; }); } catch (e) { console.warn(e); }
    }, 1500);
  }

  /* ---------------- start ---------------- */
  window.CRMPLUS = {sweep: sweep, autoAssign: autoAssign, reminders: reminderList, logContact: logContact, renderReminders: renderReminders, refreshPhone: refreshPhone,
    runPending: runPending, replanClient: replanClient, quickEdit: quickEdit, quickAdd: quickAdd, quickDo: quickDo};
  sweep(true);
  route();
  onRoute();
  runPending();
  refreshPhone();
  // re-check once a day while the page stays open
  setInterval(function () { if (load().engineRunOn !== TODAY()) { sweep(false); route(); onRoute(); } updateBell(); }, 30 * 60 * 1000);
})();
