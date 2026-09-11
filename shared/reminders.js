/* ============================================================
   FAIR TAX REMINDER ENGINE
   Reads the CRM data and works out every reminder for the next days.
   No page needed – used by the CRM (reminders page), the dashboard and
   the Android app (phone notifications).
   ============================================================ */
(function (root) {
  'use strict';

  var DEFAULT_POLICY = {
    workDays: [1, 2, 3, 4, 5],          // Mon–Fri (0 = Sunday)
    dayStart: 9, dayEnd: 18,            // working hours
    leadEveryHours: 2,                  // "contact this lead" nudges
    healthDays: 7,                      // client check-in call / message / feedback
    missingDays: 7,                     // remind about missing client details
    fsMonths: 3, auditMonths: 4, ctMonths: 9,
    bookkeeping: 'auto',                // auto | Weekly | Fortnightly | Monthly
    vatBefore: [14, 7, 3, 1, 0],
    ctBefore: [60, 30, 14, 7, 3, 1, 0],
    fsBefore: [30, 14, 7, 3, 0],
    auditBefore: [30, 14, 7, 3, 0],
    contractBefore: [30, 7, 1, 0],
    pdcBefore: [3, 1, 0],
    times: {agenda: '08:45', pdc: '09:15', compliance: '09:30', health: '10:00', contract: '10:30', missing: '11:00', invoices: '12:00', meetingEve: '18:00', meetingDay: '08:30', assign: '09:05', task: '09:00'},
    autoAssign: true
  };
  var DAY = 864e5;

  /* ---------- small helpers ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null; var p = s.slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function monthEnd(y, m) { return new Date(y, m, 0); }                       // m = 1..12
  function addMonthsEnd(d, n) { return new Date(d.getFullYear(), d.getMonth() + n + 1, 0); }
  function at(day, hhmm) { var t = String(hhmm || '09:00').split(':'); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), +t[0] || 0, +t[1] || 0); }
  function days(a, b) { return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / DAY); }
  function lc(s) { return String(s == null ? '' : s).toLowerCase().trim(); }
  function fmt(d) { var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return d.getDate() + ' ' + m[d.getMonth()]; }
  function money(n) { return Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 0}); }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (Math.abs(h) % 2000000000) + 1; }
  function blank(v) { var s = lc(v); return !s || s === '-' || s === '—' || s === 'n/a' || s === 'na' || s === 'none' || s === 'none@none.com' || s === '0'; }
  function inWords(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'; }

  function policyOf(db) {
    var p = JSON.parse(JSON.stringify(DEFAULT_POLICY)), own = (db && db.policy) || {};
    Object.keys(own).forEach(function (k) { if (own[k] !== undefined && own[k] !== null && own[k] !== '') p[k] = (k === 'times') ? Object.assign(p.times, own.times) : own[k]; });
    return p;
  }
  function isWorkday(d, P) { return P.workDays.indexOf(d.getDay()) >= 0; }
  // "x days before" reminders that land on a weekend move to the working day before
  function beforeDay(due, n, P) { var d = addDays(due, -n); if (n === 0) return d; for (var i = 0; i < 7 && !isWorkday(d, P); i++) d = addDays(d, -1); return d; }

  /* ---------- a client's services ---------- */
  function has(c, what) {
    var list = (c.services || []).map(lc);
    var alias = {vat: ['vat', 'vat return filing', 'vat returns'], ct: ['corporate tax', 'ct', 'corporate tax return filing'], fs: ['financial statements', 'preparation of financial statements', 'fs'],
      audit: ['audit', 'financial audit'], bk: ['bookkeeping', 'book keeping', 'accounting']};
    return (alias[what] || [what]).some(function (a) { return list.indexOf(a) >= 0; });
  }

  /* ---------- the schedule each client follows (automatic unless set on the client) ---------- */
  function planOf(c, P) {
    var own = c.plan || {}, why = {};
    var bk = own.bookkeeping && own.bookkeeping !== 'auto' ? own.bookkeeping : null;
    if (!bk) {
      var cyc = lc(c.vatCycle);
      if (has(c, 'vat') && cyc.indexOf('month') >= 0) { bk = 'Weekly'; why.bookkeeping = 'monthly VAT filer'; }
      else if (has(c, 'vat')) { bk = 'Fortnightly'; why.bookkeeping = 'quarterly VAT filer'; }
      else { bk = P.bookkeeping !== 'auto' ? P.bookkeeping : 'Monthly'; why.bookkeeping = 'no VAT'; }
    } else why.bookkeeping = 'set on client';
    var plan = {
      bookkeeping: bk,
      healthDays: +own.healthDays || +P.healthDays || 7,
      missingDays: +own.missingDays || +P.missingDays || 7,
      fsMonths: +own.fsMonths || +P.fsMonths || 3,
      auditMonths: +own.auditMonths || +P.auditMonths || 4,
      ctMonths: +P.ctMonths || 9,
      why: why, custom: !!(c.plan && Object.keys(c.plan).some(function (k) { return c.plan[k] && c.plan[k] !== 'auto'; }))
    };
    return plan;
  }

  /* ---------- statutory / engagement deadlines for a client ---------- */
  var VAT_MONTHS = {'1': [1, 4, 7, 10], '2': [2, 5, 8, 11], '3': [3, 6, 9, 12]};
  function vatMonths(cycle) { cycle = lc(cycle); if (cycle.indexOf('month') >= 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; for (var k in VAT_MONTHS) if (cycle.indexOf(k) >= 0) return VAT_MONTHS[k]; return VAT_MONTHS['3']; }
  // 28th of the month after the period; on a Saturday / Sunday it moves to Monday
  function vatDue(pe) { var due = new Date(pe.getFullYear(), pe.getMonth() + 1, 28); var w = due.getDay(); if (w === 6) due = addDays(due, 2); if (w === 0) due = addDays(due, 1); return due; }
  var CHECK = {
    vat: ['Pull period transactions / confirm books closed', 'Prepare VAT return working (output vs input)', 'Share summary with client for approval', 'File on FTA portal + record payment'],
    corporate_tax: ['Confirm financial statements finalised', 'Prepare CT computation (9% > AED 375k / SBR if eligible)', 'Client review & sign-off', 'Submit on EmaraTax + record payment'],
    financial_statements: ['Request/collect closing trial balance & schedules', 'Review — reconcile ledgers, fixed assets, borrowings', 'Engage client on open items', 'Call client for pending confirmations'],
    audit: ['Prepare audit file & lead schedules', 'Review — clear audit queries', 'Engage client for supporting documents', 'Call client to close pending items'],
    bookkeeping: ['Review entries posted since the last review', 'Engage client for missing invoices / statements', 'Call client on any pending items']
  };
  function deadlines(c, today, horizonDays, P) {
    P = P || DEFAULT_POLICY;
    var out = [], horizon = addDays(today, horizonDays == null ? 400 : horizonDays), name = c.name, plan = planOf(c, P);
    if (has(c, 'vat')) {
      var months = vatMonths(c.vatCycle), monthly = lc(c.vatCycle).indexOf('month') >= 0;
      for (var yr = today.getFullYear() - 1; yr <= today.getFullYear() + 1; yr++) months.forEach(function (m) {
        var pe = monthEnd(yr, m), due = vatDue(pe);
        if (due < addDays(today, -60) || due > horizon) return;
        var label = monthly ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][pe.getMonth()] : 'Q' + Math.ceil(m / 3);   // same wording as the CRM's own engine
        out.push({code: 'VAT|' + name + '|' + pe.getFullYear() + '-' + (pe.getMonth() + 1), kind: 'vat', title: 'VAT Return Due — ' + name + ' (' + label + ')', due: ymd(due), periodEnd: ymd(pe),
          createOn: ymd(new Date(pe.getFullYear(), pe.getMonth() + 1, 1)), recurrence: monthly ? 'Monthly' : 'Quarterly', priority: 'High', checklist: CHECK.vat});
      });
    }
    var ye = parse(c.taxYearEnd);
    if (ye) {
      for (var i = -1; i <= 1; i++) {
        var end = new Date(ye.getFullYear() + i, ye.getMonth(), ye.getDate()), start = addDays(end, 1), fy = end.getFullYear();
        if (has(c, 'ct')) { var ctDue = addMonthsEnd(end, plan.ctMonths); if (ctDue >= addDays(today, -60) && ctDue <= horizon)
          out.push({code: 'CT|' + name + '|' + fy, kind: 'corporate_tax', title: 'Corporate Tax Filing Due — ' + name + ' (FY ' + fy + ')', due: ymd(ctDue), createOn: ymd(addDays(ctDue, -60)), recurrence: 'Annual', priority: 'High', checklist: CHECK.corporate_tax}); }
        if (has(c, 'fs') || has(c, 'audit') || has(c, 'ct')) { var fsDue = addMonthsEnd(end, plan.fsMonths); if (fsDue >= addDays(today, -60) && start <= horizon)
          out.push({code: 'FS|' + name + '|' + fy, kind: 'financial_statements', title: 'Financial Statements — ' + name + ' (FY ' + fy + ')', due: ymd(fsDue), createOn: ymd(start), recurrence: 'Weekly', priority: 'Medium', checklist: CHECK.financial_statements}); }
        if (has(c, 'audit')) { var auDue = addMonthsEnd(end, plan.auditMonths); if (auDue >= addDays(today, -60) && start <= horizon)
          out.push({code: 'AUD|' + name + '|' + fy, kind: 'audit', title: 'Audit — ' + name + ' (FY ' + fy + ')', due: ymd(auDue), createOn: ymd(start), recurrence: 'Weekly', priority: 'Medium', checklist: CHECK.audit}); }
      }
    }
    if (has(c, 'bk')) {
      var anchor = parse(c.bookkeepingStart) || parse(c.createdAt) || today, next, step = {Weekly: 7, Fortnightly: 14}[plan.bookkeeping];
      if (step) {
        var diff = days(anchor, today);
        next = diff <= 0 ? anchor : addDays(anchor, Math.ceil(diff / step) * step);
        for (var n = 0; n < 3 && next <= horizon; n++, next = addDays(next, step))
          out.push({code: 'BK|' + name + '|' + ymd(next), kind: 'bookkeeping', title: 'Bookkeeping Review — ' + name, due: ymd(next), createOn: ymd(next), recurrence: plan.bookkeeping === 'Weekly' ? 'Weekly' : 'None', priority: 'Medium', checklist: CHECK.bookkeeping});
      } else {    // monthly: review the previous month by the 10th
        next = new Date(today.getFullYear(), today.getMonth(), 10); if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, 10);
        for (var k2 = 0; k2 < 2 && next <= horizon; k2++, next = new Date(next.getFullYear(), next.getMonth() + 1, 10))
          out.push({code: 'BK|' + name + '|' + ymd(next), kind: 'bookkeeping', title: 'Bookkeeping Review — ' + name, due: ymd(next), createOn: ymd(addDays(next, -9)), recurrence: 'Monthly', priority: 'Medium', checklist: CHECK.bookkeeping});
      }
    }
    out.sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    return out;
  }

  /* ---------- missing client details ---------- */
  function missing(c) {
    var m = [];
    if (blank(c.phone)) m.push('phone');
    if (blank(c.email) || !/@/.test(c.email || '')) m.push('email');
    if (blank(c.tradeLicence)) m.push('trade licence no');
    if (blank(c.address)) m.push('address');
    if ((has(c, 'ct') || has(c, 'fs') || has(c, 'audit')) && blank(c.taxYearEnd)) m.push('tax year end');
    if (has(c, 'vat') && blank(c.trn)) m.push('TRN');
    if (has(c, 'vat') && blank(c.vatCycle)) m.push('VAT cycle');
    if ((has(c, 'vat') || has(c, 'ct')) && blank(c.portalId)) m.push('FTA portal ID');
    if (blank(c.contractExpiry)) m.push('contract expiry');
    if (!(c.staff || []).length) m.push('assigned staff');
    return m;
  }

  /* ---------- who a reminder is for ---------- */
  function nameMatch(name, me) {
    var n = lc(name); if (!n || !me) return false;
    var full = lc(me.name), first = full.split(/\s+/)[0], id = lc(me.id).split('@')[0];
    return n === full || n === id || n === first || n.split(/\s+/)[0] === first;
  }
  function forMe(names, me) {
    if (!me || me.admin) return true;
    return (names || []).some(function (n) { return nameMatch(n, me); });
  }

  /* ---------- automatic assignment (expertise, then workload) ---------- */
  var EXPERTISE = ['VAT', 'Corporate Tax', 'Bookkeeping', 'Audit', 'Financial Statements', 'AML'];
  function needs(c) {
    var n = [];
    if (has(c, 'vat')) n.push('VAT'); if (has(c, 'ct')) n.push('Corporate Tax'); if (has(c, 'bk')) n.push('Bookkeeping');
    if (has(c, 'audit')) n.push('Audit'); if (has(c, 'fs')) n.push('Financial Statements');
    if ((c.services || []).some(function (s) { return /aml|money laundering/i.test(s); })) n.push('AML');
    return n;
  }
  function suggestAssignee(c, db, team) {
    var people = (team || []).filter(function (u) { return u && u.active !== false && u.crm !== false && (u.expertise || []).length; });
    if (!people.length) return null;
    var want = needs(c);
    var load = function (u) { return (db.clients || []).filter(function (x) { return x.status === 'Active' && (x.staff || []).some(function (s) { return nameMatch(s, u); }); }).length; };
    var scored = people.map(function (u) {
      var ex = (u.expertise || []).map(lc), match = want.filter(function (w) { return ex.indexOf(lc(w)) >= 0; }).length;
      return {u: u, match: match, load: load(u)};
    });
    var best = Math.max.apply(null, scored.map(function (s) { return s.match; }));
    if (want.length && best === 0) return null;
    var pool = scored.filter(function (s) { return s.match === best; }).sort(function (a, b) { return a.load - b.load || String(a.u.name).localeCompare(String(b.u.name)); });
    var pick = pool[0];
    return {name: pick.u.name, reason: (want.length ? 'covers ' + pick.match + ' of ' + want.length + ' services (' + want.join(', ') + ')' : 'no services listed') + ', ' + pick.load + ' active clients'};
  }

  /* ---------- everything due in the coming days ---------- */
  var KIND = {
    lead: {icon: '📞', label: 'leads to contact', page: '#/leads'}, health: {icon: '🤝', label: 'client check-ins due', page: '#/reminders'},
    meeting: {icon: '📅', label: 'meetings', page: '#/tasks'}, vat: {icon: '🧾', label: 'VAT returns', page: '#/reminders'}, corporate_tax: {icon: '🏛', label: 'Corporate Tax filings', page: '#/reminders'},
    financial_statements: {icon: '📊', label: 'financial statements due', page: '#/reminders'}, audit: {icon: '🔍', label: 'audits due', page: '#/reminders'}, bookkeeping: {icon: '📒', label: 'bookkeeping reviews', page: '#/reminders'},
    contract: {icon: '📄', label: 'contracts expiring', page: '#/clients'}, pdc: {icon: '💳', label: 'cheques to deposit', page: '#/receipts'}, missing: {icon: '🧩', label: 'clients with missing details', page: '#/reminders'},
    invoice: {icon: '💰', label: 'overdue invoices', page: '#/invoices'}, agenda: {icon: '☀️', label: 'agenda', page: '#/dashboard'}, task: {icon: '✔', label: 'tasks due', page: '#/tasks'},
    assign: {icon: '👥', label: 'unassigned clients', page: '#/clients'}
  };

  // progress of a task's checklist: "Step 2 of 4 – next: Share summary with client"
  function stageOf(t) {
    var list = (t && t.checklist) || [], done = (t && t.checklistDone) || [];
    var total = list.length, count = list.filter(function (x, i) { return done.indexOf(i) >= 0; }).length;
    var nextIdx = -1; for (var i = 0; i < total; i++) if (done.indexOf(i) < 0) { nextIdx = i; break; }
    return {total: total, done: count, next: nextIdx >= 0 ? list[nextIdx] : '', nextIndex: nextIdx, pct: total ? Math.round(count * 100 / total) : (t && t.status === 'Completed' ? 100 : 0)};
  }
  function statusLine(t) {
    if (!t) return 'Not started';
    var s = stageOf(t), txt = t.status || 'Not Started';
    if (s.total) txt += s.done >= s.total ? ' · all ' + s.total + ' steps done' : ' · step ' + (s.done + 1) + ' of ' + s.total;
    return txt;
  }
  function longDate(d) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + fmt(d) + ' ' + d.getFullYear(); }
  function who(names) { return (names || []).filter(Boolean).join(', ') || 'Nobody assigned'; }

  function compute(db, opts) {
    opts = opts || {};
    db = db || {};
    var P = policyOf(db), now = opts.now ? new Date(opts.now) : new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var horizon = +opts.days || 7, me = opts.me || null, list = [];
    var clients = (db.clients || []).filter(function (c) { return c.status !== 'Inactive'; });
    var clientById = {}; (db.clients || []).forEach(function (c) { clientById[c.id] = c; });
    var tasks = db.tasks || [];
    var dayList = []; for (var d = 0; d <= horizon; d++) dayList.push(addDays(today, d));
    var seen = {};
    function push(r) {
      if (r.at < now || r.at > addDays(today, horizon + 1) || !forMe(r.who, me)) return;
      var once = r.kind + '|' + r.ref + '|' + r.at.getTime();          // never twice for the same thing at the same moment
      if (seen[once]) return; seen[once] = true;
      r.key = r.key || (r.kind + '|' + r.ref + '|' + ymd(r.at) + ' ' + r.at.getHours() + ':' + r.at.getMinutes());
      r.details = (r.details || []).filter(Boolean);
      list.push(r);
    }
    var staffOf = function (c) { return (c && c.staff) || []; };
    var taskInfo = function (t) { if (!t) return {}; var s = stageOf(t); return {taskId: t.id, status: t.status, stage: s, statusText: statusLine(t)}; };

    // 1. leads – every N hours in working hours, oldest contact first
    var openLeads = (db.leads || []).filter(function (l) { return l.stage !== 'Closed'; });
    // never contacted → counts as waiting from the day before it was added, so new leads are nudged the same day
    var touched = function (l) { return parse(l.lastActivity) || addDays(parse(l.date) || today, -1); };
    var queues = {};
    openLeads.forEach(function (l) {
      var owners = me && me.admin ? ['*'] : [l.assignedTo || ''];
      owners.forEach(function (o) { (queues[o] = queues[o] || []).push(l); });
    });
    Object.keys(queues).forEach(function (owner) {
      var q = queues[owner].sort(function (a, b) { return touched(a) - touched(b); }), slot = 0;
      dayList.forEach(function (day) {
        if (!isWorkday(day, P)) return;
        for (var h = P.dayStart; h < P.dayEnd; h += (+P.leadEveryHours || 2)) {
          var when = at(day, pad(h) + ':00');
          var waiting = q.filter(function (l) { return ymd(touched(l)) < ymd(day); });
          if (!waiting.length) continue;
          var l = waiting[slot % waiting.length]; slot++;
          var ago = days(touched(l), day), phone = l.phone && !blank(l.phone) ? l.phone : '';
          push({kind: 'lead', at: when, ref: l.id, leadId: l.id, route: '#/lead/' + l.id, who: owner === '*' ? [] : [owner], name: l.name,
            key: 'lead|' + owner + '|' + ymd(day) + '|' + h, status: l.stage,
            title: '📞 Contact lead: ' + l.name,
            body: [phone, l.stage, (l.lastActivity ? 'last contact ' + ago + ' day' + (ago === 1 ? '' : 's') + ' ago' : 'not contacted yet')].filter(Boolean).join(' · '),
            details: [phone ? 'Phone: ' + phone : 'Phone: not saved', 'Stage: ' + l.stage + (l.source ? ' (' + l.source + ')' : ''), 'Last contact: ' + (l.lastActivity ? fmt(parse(l.lastActivity)) + ' – ' + ago + ' days ago' : 'not contacted yet'),
              (l.services || []).length ? 'Interested in: ' + l.services.join(', ') : '', 'Assigned: ' + (l.assignedTo || '—'), waiting.length > 1 ? (waiting.length - 1) + ' more leads waiting' : '']});
        }
      });
    });

    // 2. client check-ins (call, message or feedback)
    clients.forEach(function (c) {
      if (c.status !== 'Active') return;
      var plan = planOf(c, P), last = parse(c.lastContact), due = last ? addDays(last, plan.healthDays) : today;
      var next = parse(c.nextContact); if (next && next > due) due = next;
      dayList.forEach(function (day) {
        if (day < due || !isWorkday(day, P)) return;
        var ago = last ? days(last, day) : null, phone = c.phone && !blank(c.phone) ? c.phone : '';
        push({kind: 'health', at: at(day, P.times.health), ref: c.id, clientId: c.id, route: '#/client/' + c.id, who: staffOf(c), name: c.name,
          title: '🤝 Check in with ' + c.name, body: 'Call, message or ask for feedback · ' + (ago === null ? 'no contact logged yet' : 'last contact ' + ago + ' days ago'),
          details: ['Last contact: ' + (ago === null ? 'not logged yet' : fmt(last) + ' – ' + ago + ' days ago'), 'Check-in every ' + plan.healthDays + ' days', phone ? 'Phone: ' + phone : '', 'Services: ' + ((c.services || []).join(', ') || '—'), 'Assigned: ' + who(staffOf(c))]});
      });
    });

    // 3. meetings – day before and on the day (and 1 hour before when a time is set)
    tasks.forEach(function (t) {
      if (t.type !== 'Meeting' || t.status === 'Completed') return;
      var day = parse(t.dueDate); if (!day) return;
      var c = clientById[t.clientId], timeTxt = t.time ? ' at ' + t.time : '', whoM = t.assignees || [], label = t.title + (c ? ' — ' + c.name : '');
      var det = ['When: ' + longDate(day) + (t.time ? ', ' + t.time : ''), t.location ? 'Place: ' + t.location : '', c ? 'Client: ' + c.name : '', 'Status: ' + statusLine(t), 'With: ' + who(whoM)];
      var base = Object.assign({kind: 'meeting', ref: t.id, clientId: t.clientId, route: '#/task/' + t.id, who: whoM, name: t.title, details: det}, taskInfo(t));
      push(Object.assign({}, base, {at: at(addDays(day, -1), P.times.meetingEve), title: '📅 Tomorrow' + timeTxt + ': ' + label, body: 'Meeting on ' + fmt(day) + timeTxt + (t.location ? ' · ' + t.location : '')}));
      var morning = at(day, P.times.meetingDay);
      if (t.time) { var mt = at(day, t.time); if (mt <= morning) morning = new Date(mt.getTime() - 90 * 60000); push(Object.assign({}, base, {at: new Date(mt.getTime() - 60 * 60000), key: 'meeting|' + t.id + '|1h', title: '📅 In 1 hour: ' + label, body: 'Starts at ' + t.time + (t.location ? ' · ' + t.location : '')})); }
      push(Object.assign({}, base, {at: morning, key: 'meeting|' + t.id + '|day', title: '📅 Today' + timeTxt + ': ' + label, body: 'Meeting today' + (t.location ? ' · ' + t.location : '')}));
    });

    // 4. VAT, Corporate Tax, financial statements, audit, bookkeeping
    var doneCode = {}, openCode = {};
    tasks.forEach(function (t) {
      [t.code, t.title + '|' + String(t.dueDate || '').slice(0, 7)].forEach(function (k) { if (!k) return; if (t.status === 'Completed') doneCode[k] = true; else openCode[k] = t; });
    });
    var BEFORE = {vat: P.vatBefore, corporate_tax: P.ctBefore, financial_statements: P.fsBefore, audit: P.auditBefore, bookkeeping: [0]};
    var WORD = {vat: 'VAT return', corporate_tax: 'Corporate Tax return', financial_statements: 'Financial statements', audit: 'Audit', bookkeeping: 'Bookkeeping review'};
    clients.forEach(function (c) {
      if (c.status !== 'Active') return;
      deadlines(c, today, horizon + 61, P).forEach(function (dl) {
        var byTitle = dl.title + '|' + dl.due.slice(0, 7);
        if (doneCode[dl.code] || doneCode[byTitle]) return;
        var due = parse(dl.due), task = openCode[dl.code] || openCode[byTitle];
        var route = task ? '#/task/' + task.id : '#/client/' + c.id, whoC = task && (task.assignees || []).length ? task.assignees : staffOf(c);
        var period = (dl.title.match(/\(([^)]+)\)\s*$/) || [])[1] || (dl.kind === 'bookkeeping' ? planOf(c, P).bookkeeping + ' review' : '');
        var st = task ? stageOf(task) : null;
        var short = task ? statusLine(task) : 'not started';
        var basis = dl.kind === 'vat' ? 'VAT cycle: ' + (c.vatCycle || '—') + (dl.periodEnd ? ' · period ends ' + fmt(parse(dl.periodEnd)) : '') : (dl.kind === 'bookkeeping' ? 'Review: ' + planOf(c, P).bookkeeping : 'Year end: ' + (c.taxYearEnd ? fmt(parse(c.taxYearEnd)) + ' ' + c.taxYearEnd.slice(0, 4) : '—'));
        var det = function (n) { return ['Client: ' + c.name, 'Deadline: ' + longDate(due) + (n > 0 ? ' (in ' + n + ' day' + (n > 1 ? 's' : '') + ')' : n === 0 ? ' (today)' : ' (' + (-n) + ' days late)'), period ? 'Period: ' + period : '', basis,
          'Status: ' + (task ? statusLine(task) : 'Not started – no task yet'), st && st.next ? 'Next step: ' + st.next : '', 'Assigned: ' + who(whoC)]; };
        (BEFORE[dl.kind] || [0]).forEach(function (n) {
          var day = beforeDay(due, n, P);
          push(Object.assign({kind: dl.kind, at: at(day, P.times.compliance), ref: c.id + '|' + dl.code, clientId: c.id, route: route, who: whoC, name: c.name, code: dl.code,
            key: dl.kind + '|' + dl.code + '|' + n,
            title: KIND[dl.kind].icon + ' ' + WORD[dl.kind] + ' ' + (n === 0 ? 'due today' : 'due ' + inWords(n)) + ' — ' + c.name, body: [period, 'due ' + fmt(due), short].filter(Boolean).join(' · '), details: det(n)}, taskInfo(task)));
        });
        if (due < today && task && days(due, today) <= 60) dayList.forEach(function (day) {
          if (!isWorkday(day, P)) return;
          push(Object.assign({kind: dl.kind, at: at(day, P.times.compliance), ref: c.id + '|' + dl.code, clientId: c.id, route: route, who: whoC, name: c.name, code: dl.code, key: dl.kind + '|' + dl.code + '|late|' + ymd(day),
            title: '⚠️ Overdue: ' + WORD[dl.kind] + ' — ' + c.name, body: [period, days(due, day) + ' days late', short].filter(Boolean).join(' · '), details: det(-days(due, day))}, taskInfo(task)));
        });
      });
      // 5. contract expiry
      var exp = parse(c.contractExpiry);
      if (exp) P.contractBefore.forEach(function (n) {
        var day = beforeDay(exp, n, P);
        push({kind: 'contract', at: at(day, P.times.contract), ref: c.id, clientId: c.id, route: '#/client/' + c.id, who: staffOf(c), name: c.name, key: 'contract|' + c.id + '|' + n,
          title: '📄 Contract ' + (n === 0 ? 'expires today' : 'expires ' + inWords(n)) + ' — ' + c.name, body: 'Expiry ' + fmt(exp) + ' · prepare renewal / new agreement',
          details: ['Client: ' + c.name, 'Contract expiry: ' + longDate(exp), 'Services: ' + ((c.services || []).join(', ') || '—'), 'Assigned: ' + who(staffOf(c)), 'Action: send renewal quotation / agreement']});
      });
    });

    // 6. post-dated cheques (receipts and agreement payment schedules)
    (db.receipts || []).forEach(function (rc) {
      if (!(rc.isPDC || rc.method === 'PDC') || !rc.chequeDate) return;
      var t = rc.taskId && tasks.filter(function (x) { return x.id === rc.taskId; })[0];
      if (t && t.status === 'Completed') return; if (rc.deposited) return;
      var cd = parse(rc.chequeDate), c = clientById[rc.clientId];
      P.pdcBefore.forEach(function (n) {
        var day = beforeDay(cd, n, P);
        push(Object.assign({kind: 'pdc', at: at(day, P.times.pdc), ref: rc.id, receiptId: rc.id, clientId: rc.clientId, route: t ? '#/task/' + t.id : '#/receipt/' + rc.id, who: staffOf(c), name: rc.clientName, key: 'pdc|' + rc.id + '|' + n,
          title: '💳 PDC ' + (n === 0 ? 'due today' : 'due ' + inWords(n)) + ' — ' + (rc.clientName || ''), body: 'AED ' + money(rc.amount) + (rc.chequeNo ? ' · cheque ' + rc.chequeNo : '') + ' · deposit on ' + fmt(cd),
          details: ['Client: ' + (rc.clientName || '—'), 'Amount: AED ' + money(rc.amount), rc.chequeNo ? 'Cheque no: ' + rc.chequeNo : '', rc.bank ? 'Bank: ' + rc.bank : '', 'Cheque date: ' + longDate(cd), 'Status: ' + (t ? statusLine(t) : 'Not deposited')]}, taskInfo(t)));
      });
    });
    (db.agreements || []).forEach(function (a) {
      (a.schedule || []).forEach(function (r) {
        if (r.status === 'Received' || !(r.method === 'PDC' || r.method === 'CDC') || !r.dueDate) return;
        var cd = parse(r.dueDate), c = clientById[a.clientId];
        P.pdcBefore.forEach(function (n) {
          var day = beforeDay(cd, n, P);
          push({kind: 'pdc', at: at(day, P.times.pdc), ref: a.id + '|' + r.id, agreementId: a.id, rowId: r.id, clientId: a.clientId, route: '#/agreement/' + a.id, who: staffOf(c), name: a.clientName, key: 'sched|' + a.id + '|' + r.id + '|' + n,
            title: '💳 Cheque ' + (n === 0 ? 'due today' : 'due ' + inWords(n)) + ' — ' + (a.clientName || ''), body: 'AED ' + money(r.amount) + ' · ' + (r.label || 'payment') + (r.chequeNo ? ' · cheque ' + r.chequeNo : ''),
            details: ['Client: ' + (a.clientName || '—'), 'Amount: AED ' + money(r.amount), 'For: ' + (r.label || 'payment') + (a.reference ? ' (' + a.reference + ')' : ''), r.chequeNo ? 'Cheque no: ' + r.chequeNo : '', 'Due: ' + longDate(cd), 'Status: ' + (r.status || 'Pending')]});
        });
      });
    });

    // 7. missing client details – every N days
    var mondayRef = Date.UTC(2024, 0, 1) / DAY;   // a Monday
    clients.forEach(function (c) {
      if (c.status !== 'Active') return;
      var gaps = missing(c); if (!gaps.length) return;
      var plan = planOf(c, P);
      dayList.forEach(function (day) {
        var ed = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / DAY;
        if (!isWorkday(day, P) || ((ed - mondayRef) % plan.missingDays + plan.missingDays) % plan.missingDays !== 0) return;
        push({kind: 'missing', at: at(day, P.times.missing), ref: c.id, clientId: c.id, route: '#/client/' + c.id, who: staffOf(c).length ? staffOf(c) : [], name: c.name,
          title: '🧩 Missing details — ' + c.name, body: 'Please add: ' + gaps.join(', '), missingFields: gaps,
          details: ['Client: ' + c.name, 'Missing (' + gaps.length + '): ' + gaps.join(', '), 'Assigned: ' + who(staffOf(c)), 'Tip: tap “Update details” to fill them in']});
      });
    });

    // 8. overdue invoices – weekly on Tuesdays
    var todayStr = ymd(today);
    var late = (db.invoices || []).filter(function (v) { return v.status !== 'Paid' && v.dueDate && v.dueDate < todayStr; });
    if (late.length) dayList.forEach(function (day) {
      if (day.getDay() !== 2) return;
      late.forEach(function (v) {
        var c = clientById[v.clientId], total = (v.items || []).reduce(function (s, i) { var amt = i.amount != null ? +i.amount : (+i.qty || 0) * (+i.unit || 0); return s + amt * (i.vat && i.vat !== 'standard' ? 1 : 1 + (+v.vatRate || 0) / 100); }, 0);
        push({kind: 'invoice', at: at(day, P.times.invoices), ref: v.id, invoiceId: v.id, clientId: v.clientId, route: '#/invoice/' + v.id, who: staffOf(c), name: v.clientName, status: v.status,
          title: '💰 Overdue invoice ' + (v.invoiceNo || '') + ' — ' + (v.clientName || ''), body: 'AED ' + money(total) + ' · due ' + fmt(parse(v.dueDate)) + ' · ' + (v.status || 'Unpaid'),
          details: ['Client: ' + (v.clientName || '—'), 'Invoice: ' + (v.invoiceNo || '—'), 'Amount: AED ' + money(total), 'Was due: ' + longDate(parse(v.dueDate)) + ' (' + days(parse(v.dueDate), day) + ' days late)', 'Status: ' + (v.status || 'Unpaid')]});
      });
    });

    // 9. important tasks due (high priority, not meetings / engine reminders already covered)
    tasks.forEach(function (t) {
      if (t.status === 'Completed' || t.type === 'Meeting' || t.source === 'auto_reminder' || t.source === 'pdc' || t.priority !== 'High') return;
      var day = parse(t.dueDate); if (!day) return;
      var c = clientById[t.clientId], s = stageOf(t);
      push(Object.assign({kind: 'task', at: at(day, P.times.task), ref: t.id, clientId: t.clientId, route: '#/task/' + t.id, who: t.assignees || [], name: t.title, title: '✔ Due today: ' + t.title,
        body: [c ? c.name : '', statusLine(t)].filter(Boolean).join(' · '),
        details: [c ? 'Client: ' + c.name : '', 'Due: ' + longDate(day) + (t.time ? ', ' + t.time : ''), 'Status: ' + statusLine(t), s.next ? 'Next step: ' + s.next : '', 'Assigned: ' + who(t.assignees)]}, taskInfo(t)));
    });

    // 10. unassigned clients (admin)
    if (!me || me.admin) {
      var unassigned = clients.filter(function (c) { return c.status === 'Active' && !(c.staff || []).length; });
      if (unassigned.length) dayList.forEach(function (day) {
        if (!isWorkday(day, P)) return;
        push({kind: 'assign', at: at(day, P.times.assign), ref: 'unassigned', route: '#/clients', who: [], key: 'assign|' + ymd(day),
          title: '👥 ' + unassigned.length + ' client' + (unassigned.length > 1 ? 's have' : ' has') + ' no assigned staff', body: unassigned.slice(0, 6).map(function (c) { return c.name; }).join(', ') + (unassigned.length > 6 ? '…' : ''),
          details: unassigned.slice(0, 8).map(function (c) { return '• ' + c.name + ' (' + ((c.services || []).join(', ') || 'no services') + ')'; }).concat(['Tip: add staff expertise in Users & access, then “Auto-assign”'])});
      });
    }

    // 11. morning agenda (tap to open – also refreshes the phone reminders)
    dayList.forEach(function (day) {
      if (!isWorkday(day, P)) return;
      var ds = ymd(day), mine = function (t) { return forMe(t.assignees, me); };
      var dueT = tasks.filter(function (t) { return t.status !== 'Completed' && t.dueDate === ds && mine(t); });
      var over = tasks.filter(function (t) { return t.status !== 'Completed' && t.dueDate && t.dueDate < ds && mine(t); }).length;
      var meets = dueT.filter(function (t) { return t.type === 'Meeting'; }).length;
      var leads = openLeads.filter(function (l) { return forMe([l.assignedTo], me); }).length;
      var parts = [];
      if (dueT.length) parts.push(dueT.length + ' task' + (dueT.length > 1 ? 's' : '') + ' due'); if (over) parts.push(over + ' overdue'); if (meets) parts.push(meets + ' meeting' + (meets > 1 ? 's' : '')); if (leads) parts.push(leads + ' open lead' + (leads > 1 ? 's' : ''));
      push({kind: 'agenda', at: at(day, P.times.agenda), ref: 'agenda', route: '#/reminders', who: [], key: 'agenda|' + ds, always: true,
        title: '☀️ ' + (day.getDay() === 1 ? 'Week start' : 'Today') + (me && me.name ? ', ' + String(me.name).split(/\s+/)[0] : '') + ' – ' + (parts.length ? parts.join(' · ') : 'nothing urgent'),
        body: 'Tap to open your reminders (this also refreshes them)',
        details: dueT.slice(0, 6).map(function (t) { return '• ' + (t.time ? t.time + ' ' : '') + t.title + ' – ' + statusLine(t); }).concat(over ? ['⚠️ ' + over + ' overdue task' + (over > 1 ? 's' : '')] : [])});
    });

    // group many reminders of the same kind at the same moment into one
    list.sort(function (a, b) { return a.at - b.at; });
    var groups = {}, out = [];
    list.forEach(function (r) { var g = r.kind + '@' + r.at.getTime(); (groups[g] = groups[g] || []).push(r); });
    Object.keys(groups).forEach(function (g) {
      var rs = groups[g];
      if (rs.length <= 3 || rs[0].kind === 'lead' || rs[0].kind === 'agenda') { rs.forEach(function (r) { out.push(r); }); return; }
      var k = KIND[rs[0].kind] || {icon: '🔔', label: 'reminders', page: '#/reminders'};
      var names = rs.map(function (r) { return r.name || r.title; });
      out.push({kind: rs[0].kind, at: rs[0].at, grouped: rs.length, items: rs, route: k.page === '#/clients' || k.page === '#/tasks' ? k.page : '#/reminders', key: 'group|' + g, who: [],
        title: k.icon + ' ' + rs.length + ' ' + k.label, body: names.slice(0, 8).join(', ') + (names.length > 8 ? ' +' + (names.length - 8) + ' more' : ''),
        details: rs.slice(0, 8).map(function (r) { return '• ' + (r.name || r.title) + (r.statusText ? ' – ' + r.statusText : ''); })});
    });
    out.sort(function (a, b) { return a.at - b.at; });
    out.forEach(function (r) { r.id = hash(r.key); });
    return out.slice(0, +opts.max || 400);
  }

  root.FTReminders = {version: 2, DEFAULT_POLICY: DEFAULT_POLICY, EXPERTISE: EXPERTISE, KIND: KIND, policyOf: policyOf, planOf: planOf, deadlines: deadlines, missing: missing,
    needs: needs, suggestAssignee: suggestAssignee, compute: compute, nameMatch: nameMatch, forMe: forMe, ymd: ymd, parse: parse, stageOf: stageOf, statusLine: statusLine};
})(typeof window !== 'undefined' ? window : globalThis);
