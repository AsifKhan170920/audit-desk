/* ===================== Payroll (FEATURES_SPEC 1) =====================
   A monthly payroll run on top of the existing payslips.

   - Payroll tab (sidebar, Payroll group): the runs — Month, Employees, Gross, Deductions,
     Net, Paid, Status (Draft / Accrued / Paid / Partly paid).
   - Run payroll for <month>: every active employee pre-filled from the pay setup on the
     employee record (Payslip Items: earnings, deductions, contributions) -> review grid ->
     Create, which adds one ordinary Payslip per employee dated the last day of the month
     (payslip.payrollRun = run id). Draft runs can be saved and finished later.
   - Accrual basis: the payslips post through js/ledger-engine.js on the payroll date —
     Dr salary / allowance expense, Cr Employee clearing account (net pay, per employee) and
     the deduction / contribution liabilities. Nothing is posted by the run itself.
   - Pay salaries: bank / cash account + payment date, per-employee amounts (default the
     outstanding net, partial and selected employees allowed, WPS list) -> Payment(s) with
     the employee as payee and a line on Employee clearing account / <employee>, so the
     liability clears. payment.payrollRun links it to the run; the run status follows.
   - Run next month copies the last run. Reminders: "Payroll for <month> not run yet" and
     "Salaries for <month> not fully paid" (window.Reminders, guarded; also shown on the tab).
   - Payroll summary report by month and by employee.

   Records: b.records.payroll = [{ id, uuid, month:'YYYY-MM', date, description,
     state:'draft'|'posted', cols:[{key,sec,itemId,item}], rows:[{employee, code, include,
     note, amt:{colKey:amount}, payslipId}] }]. Run figures are always read back from the
   payslips and payments, so editing or deleting one of them keeps the run honest.
   ================================================================================ */
(function (global) {
  'use strict';
  function app() { try { return App; } catch (e) { return global.App || null; } }
  function reg() { try { return REG; } catch (e) { return global.REG || {}; } }
  function l2k() { try { return LABEL2KEY; } catch (e) { return global.LABEL2KEY || {}; } }
  function G(n) { try { return global[n]; } catch (e) { return undefined; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v).replace(/,/g, '').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
  function r2(v) { return Math.round(((Number(v) || 0) + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function doc() { return global.document; }
  function byId(id) { var d = doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function money(v) { var A = app(); try { return A.money(v); } catch (e) { return r2(v).toFixed(2); } }
  function fmtD(v) { var A = app(); try { return A.fmtDate ? A.fmtDate(v) : v; } catch (e) { return v; } }
  function recs(b, key) { return ((b && b.records) || {})[key] || []; }
  function toast(m) { var A = app(); try { if (A && A.toast) A.toast(m); else if (global.UIModal && UIModal.toast) UIModal.toast(m); } catch (e) {} }
  function say(m) { try { if (global.UIModal && UIModal.alert) return UIModal.alert(m); } catch (e) {} try { global.alert(m); } catch (e) {} }
  function ask(m, o) { try { if (global.UIModal && UIModal.confirm) return Promise.resolve(UIModal.confirm(m, o || {})); } catch (e) {} return Promise.resolve(true); }

  var P = {};
  P._today = null;
  function today() { if (P._today) return P._today; var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ------------------------------------------------------------------ months */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function validYm(ym) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || '')); }
  function monthEnd(ym) { var p = String(ym).split('-'), y = +p[0], m = +p[1]; return y + '-' + pad(m) + '-' + pad(new Date(y, m, 0).getDate()); }
  function addMonths(ym, n) { var p = String(ym).split('-'), y = +p[0], m = +p[1] - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function monthLabel(ym) { var p = String(ym || '').split('-'); if (p.length < 2 || !MON[+p[1] - 1]) return String(ym || ''); return MON[+p[1] - 1] + ' ' + p[0]; }
  function ymOf(d) { return String(d || '').slice(0, 7); }
  function addDays(iso, n) { var p = String(iso).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* --------------------------------------------------------- payslip items */
  var SECS = [['earnings', 'Earnings', 'Earning'], ['deductions', 'Deductions', 'Deduction'], ['contributions', 'Contributions', 'Contribution']];
  function secDef(sec) { return SECS.filter(function (s) { return s[0] === sec; })[0] || SECS[0]; }
  function items(b, sec) {
    var L = b && b.payslipItems && b.payslipItems[sec];
    if (!L && sec === 'earnings') { try { L = G('SettingsPages').rows('payslipItems/earnings', b); } catch (e) { L = null; } }
    return (L || []).filter(function (x) { return x && !blank(x.name); });
  }
  function findItem(b, sec, id, name) {
    var L = items(b, sec);
    return L.filter(function (x) { return !blank(id) && String(x.id) === String(id); })[0] ||
      L.filter(function (x) { return !blank(name) && lc(x.name) === lc(name); })[0] || null;
  }
  function acct(b, id) { if (blank(id)) return null; return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && String(n.id) === String(id); })[0] || null; }

  /* ------------------------------------- days in period / absent (FIX_SPEC_3 #3)
     Total days = calendar days of the pay month (default) or working days (Settings → Payroll:
     weekend choice, public holidays optional). Days worked = total − absent (read-only).
     One presentation everywhere (payroll grid, payslip form, payslip view, general ledger):
       - Basic salary (earning items named "Basic …") stays at the full monthly amount and a
         separate deduction line "Absent deduction" = Basic − round2(Basic ÷ total × worked)
         is added. It credits the Basic salary expense account, so the expense is the earned
         basic, and Basic − Absent deduction = the pro-rata basic to the cent.
       - Earning items ticked "Pro-rata" (Settings → Payslip Items) are reduced inside their
         own line: round2(monthly ÷ total × worked); the line keeps fullAmount.
       - Every other item is fixed. Days absent = 0 (or a payslip without the fields) changes
         nothing, so older payslips and runs behave exactly as before. */
  var WEEKENDS = [['sat-sun', 'Saturday and Sunday', [6, 0]], ['fri-sat', 'Friday and Saturday', [5, 6]], ['sun', 'Sunday only', [0]], ['fri', 'Friday only', [5]], ['none', 'No weekend', []]];
  function validDate(y, m, d) { var dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? y + '-' + pad(m) + '-' + pad(d) : ''; }
  /** YYYY-MM-DD or DD/MM/YYYY (also DD-MM-YYYY, DD.MM.YYYY) -> YYYY-MM-DD, else '' */
  function isoDate(v) { var s = String(v == null ? '' : v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return validDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))) return validDate(+m[3], +m[2], +m[1]);
    return ''; }
  function paySettings(b) {
    var s = (b && b.payrollSettings) || {}, w = WEEKENDS.filter(function (x) { return x[0] === s.weekend; })[0] || WEEKENDS[0], working = s.daysBasis === 'working';
    return { basis: working ? 'working' : 'calendar', weekend: w[0], weekendLabel: w[1], wdays: w[2],
      holidays: working && truthy(s.excludeHolidays) ? (s.holidays || []).map(function (h) { return isoDate(h && h.date); }).filter(Boolean) : [] };
  }
  /** total days in the pay period of a month, from Settings → Payroll */
  function periodDays(b, ym) {
    if (!validYm(ym)) return 0; var s = paySettings(b), p = ym.split('-'), y = +p[0], m = +p[1], n = new Date(y, m, 0).getDate();
    if (s.basis !== 'working') return n;
    var c = 0; for (var d = 1; d <= n; d++) { if (s.wdays.indexOf(new Date(y, m - 1, d).getDay()) >= 0 || s.holidays.indexOf(ym + '-' + pad(d)) >= 0) continue; c++; }
    return c;
  }
  function basisLabel(b) { var s = paySettings(b); return s.basis === 'working' ? 'Working days — weekend ' + s.weekendLabel.toLowerCase() + (s.holidays.length ? ', public holidays excluded' : '') : 'Calendar days'; }
  function truthy(v) { return v === true || v === 1 || /^(true|yes|on|1)$/i.test(String(v == null ? '' : v)); }
  function isBasicName(nm) { return /\bbasic\b/i.test(String(nm || '')); }
  /** 'basic' | 'prorata' | '' for a payslip item */
  function proKind(b, sec, itemId, name) {
    if (sec !== 'earnings') return ''; var it = findItem(b, sec, itemId, name), nm = it ? it.name : (name || '');
    if (isBasicName(nm)) return 'basic'; return it && truthy(it.proRata) ? 'prorata' : '';
  }
  function dayTxt(n) { n = r2(n); return n + ' day' + (n === 1 ? '' : 's'); }
  /** '' when 0 <= absent <= total, else the problem */
  function daysError(total, absent) {
    var t = num(total), a = num(absent);
    if (a < 0) return 'days absent cannot be negative.';
    if (t < 0) return 'total days in the period cannot be negative.';
    if (a > 0 && !(t > 0)) return 'enter the total days in the period.';
    if (a > t) return 'days absent (' + r2(a) + ') cannot be more than the ' + r2(t) + ' days in the period.';
    return '';
  }
  /** the days maths on monthly amounts. entries [{sec, itemId, item, amount, kind?}] ->
      {total, absent, worked, on, rows:[{kind, full, earned}], basic, basicEarned, absentDed, absentAcct, basicName} */
  function daysCalc(b, entries, total, absent) {
    var t = num(total), a = num(absent), on = t > 0 && a > 0 && a <= t;
    var o = { total: t > 0 ? r2(t) : 0, absent: on ? r2(a) : 0, worked: t > 0 ? r2(on ? t - a : t) : 0, on: on, rows: [], basic: 0, basicEarned: 0, absentDed: 0, absentAcct: '', basicName: '' };
    (entries || []).forEach(function (e) {
      var k = e.kind != null ? e.kind : proKind(b, e.sec || 'earnings', e.itemId, e.item), full = r2(num(e.amount)), earned = full;
      if (on && k === 'prorata') earned = r2(full * o.worked / t);
      if (k === 'basic' && full) { o.basic += full; if (!o.basicName) { var it = b ? findItem(b, 'earnings', e.itemId, e.item) : null; o.absentAcct = it && !blank(it.account) ? String(it.account) : ''; o.basicName = it ? it.name : (e.item || 'Basic salary'); } }
      o.rows.push({ kind: k, full: full, earned: earned });
    });
    o.basic = r2(o.basic); o.basicEarned = on ? r2(o.basic * o.worked / t) : o.basic; o.absentDed = r2(o.basic - o.basicEarned);
    return o;
  }
  /** the "Absent deduction" payslip line (credits the basic salary expense account) */
  function absentLine(b, c) {
    var n = acct(b, c.absentAcct), a = c.absentDed;
    var o = { ptype: 'Deduction', item: 'Absent deduction', itemId: '', absent: true, desc: dayTxt(c.absent) + ' absent × ' + (c.basicName || 'Basic salary') + ' ' + money(c.basic) + ' ÷ ' + r2(c.total) + ' days',
      account: n ? n.id : '', accountName: n ? n.name : '', amount: a, net: a, amountNoTax: a, totalWithTax: a, taxAmt: 0, qty: '', price: '' };
    o.description = o.desc; return o;
  }
  function proDesc(name, c, full) { return name + ' — ' + dayTxt(c.worked) + ' of ' + r2(c.total) + ' × ' + money(full); }

  /* --------------------------------------------------------------- employees */
  function employees(b) { return recs(b, 'employees').filter(function (e) { return e && !blank(e.name); }); }
  function empActive(e) { var s = lc(e && e.status); return !(s === 'resigned' || s === 'terminated' || s === 'inactive' || s === 'left'); }
  function empByName(b, name) { return employees(b).filter(function (e) { return e.name === name; })[0] || null; }
  /** the employee's pay setup: {earnings:[{itemId,item,amount}], deductions:[...], contributions:[...]} */
  function paySetup(e) {
    var p = (e && e.pay) || {}, o = {};
    SECS.forEach(function (s) { o[s[0]] = (p[s[0]] || []).filter(function (x) { return x && (!blank(x.itemId) || !blank(x.item)); })
      .map(function (x) { return { itemId: blank(x.itemId) ? '' : String(x.itemId), item: x.item || '', amount: num(x.amount) }; }); });
    return o;
  }
  function setupTotals(e) { var s = paySetup(e), t = { earnings: 0, deductions: 0, contributions: 0 };
    SECS.forEach(function (x) { t[x[0]] = r2(s[x[0]].reduce(function (a, l) { return a + l.amount; }, 0)); }); t.net = r2(t.earnings - t.deductions); return t; }
  function hasSetup(e) { var s = paySetup(e); return SECS.some(function (x) { return s[x[0]].some(function (l) { return l.amount; }); }); }

  /* -------------------------------------------------------------------- runs */
  function runs(b) { return recs(b, 'payroll').filter(Boolean); }
  function runById(b, id) { return runs(b).filter(function (r) { return String(r.id) === String(id); })[0] || null; }
  function runForMonth(b, ym, exceptId) { return runs(b).filter(function (r) { return r.month === ym && String(r.id) !== String(exceptId); })[0] || null; }
  function lastRun(b) { return runs(b).slice().sort(function (x, y) { return String(y.month).localeCompare(String(x.month)) || (num(y.id) - num(x.id)); })[0] || null; }
  function colKey(sec, itemId, item) { return sec + ':' + (blank(itemId) ? 'n:' + lc(item) : String(itemId)); }
  function newId(b) { var used = {}; Object.keys((b && b.records) || {}).forEach(function (k) { (b.records[k] || []).forEach(function (r) { if (r && r.id != null) used[r.id] = 1; }); });
    var id = Date.now() + Math.floor(Math.random() * 1000); while (used[id]) id++; return id; }
  function uuid() { var A = app(); try { return A.uuid(); } catch (e) { return 'pr-' + Math.random().toString(36).slice(2); } }

  /* columns from a payslip line */
  function lineSec(l) { var pt = lc(l.ptype || l.type), a = num(l.amount != null && l.amount !== '' ? l.amount : l.net); return pt === 'contribution' ? 'contributions' : ((pt === 'deduction' || a < 0) ? 'deductions' : 'earnings'); }
  function lineAmt(l) { return Math.abs(num(l.amount != null && l.amount !== '' ? l.amount : (l.net != null && l.net !== '' ? l.net : l.amountNoTax))); }

  /** sort columns: earnings, deductions, contributions, each in Payslip Items order */
  function sortCols(b, d) {
    var rank = function (c) { var L = items(b, c.sec), i = L.findIndex(function (x) { return String(x.id) === String(c.itemId); }); return (SECS.findIndex(function (s) { return s[0] === c.sec; }) * 1000) + (i < 0 ? 999 : i); };
    d.cols.sort(function (x, y) { return rank(x) - rank(y); });
  }
  function addCol(b, d, sec, itemId, item) {
    var it = findItem(b, sec, itemId, item), id = it ? String(it.id) : (blank(itemId) ? '' : String(itemId)), nm = it ? it.name : (item || '');
    var k = colKey(sec, id, nm);
    if (!d.cols.some(function (c) { return c.key === k; })) d.cols.push({ key: k, sec: sec, itemId: id, item: nm, pro: proKind(b, sec, id, nm) });
    return k;
  }
  function colKind(c) { return c.pro != null ? c.pro : (c.sec === 'earnings' && isBasicName(c.item) ? 'basic' : ''); }
  /** fill in what older drafts lack: total days of the month and each column's pro-rata kind */
  function ensureDays(b, d) {
    if (!d) return d;
    if (d.daysTotal == null || d.daysTotal === '') { d.daysTotal = periodDays(b, d.month); d.daysAuto = true; }
    (d.cols || []).forEach(function (c) { c.pro = proKind(b, c.sec, c.itemId, c.item); });
    return d;
  }

  /** a draft copied from a run: posted runs read the payslips (they may have been edited) */
  function draftFromRun(b, run) {
    if (!run) return null;
    if (run.state === 'draft') return { cols: clone(run.cols || []), rows: clone(run.rows || []) };
    var d = { cols: [], rows: [] };
    recs(b, 'payslips').filter(function (p) { return p && String(p.payrollRun) === String(run.id); }).forEach(function (p) {
      var row = { employee: p.employee || p.empName || '', include: true, amt: {}, daysAbsent: num(p.daysAbsent) };
      /* monthly amounts: a pro-rated line gives back its full amount; the Absent deduction is derived, not an item */
      (p.lines || []).filter(Boolean).forEach(function (l) { if (l.absent) return; var a = l.proRata && l.fullAmount != null && l.fullAmount !== '' ? Math.abs(num(l.fullAmount)) : lineAmt(l); if (!a) return;
        var k = addCol(b, d, lineSec(l), l.itemId, l.item || l.desc || l.description); row.amt[k] = r2((row.amt[k] || 0) + a); });
      d.rows.push(row); });
    return d;
  }
  function otherPayslip(b, name, ym, runId) {
    return recs(b, 'payslips').filter(function (p) { return p && (p.employee || p.empName) === name && ymOf(p.date || p.issueDate) === ym && String(p.payrollRun || '') !== String(runId || 'x') && !(p.payrollRun && runById(b, p.payrollRun)); })[0] || null;
  }

  /** a new draft for a month: every active employee from the pay setup, or copied from a run (opts.copyFrom) */
  function prefill(b, ym, opts) {
    opts = opts || {};
    var d = { id: null, month: ym, date: monthEnd(ym), description: 'Payroll ' + monthLabel(ym), daysTotal: periodDays(b, ym), daysAuto: true, cols: [], rows: [] };
    var src = opts.copyFrom ? draftFromRun(b, opts.copyFrom) : null;
    employees(b).filter(empActive).forEach(function (e) {
      var row = { employee: e.name, code: e.code || '', include: true, note: '', amt: {}, daysAbsent: 0 };
      var copied = src && src.rows.filter(function (r) { return r.employee === e.name; })[0];
      if (copied) { src.cols.forEach(function (c) { var v = num(copied.amt && copied.amt[c.key]); if (v) row.amt[addCol(b, d, c.sec, c.itemId, c.item)] = v; }); if (copied.include === false) row.include = false; }
      else { var s = paySetup(e); SECS.forEach(function (x) { s[x[0]].forEach(function (l) { if (!l.amount) return; var k = addCol(b, d, x[0], l.itemId, l.item); row.amt[k] = r2((row.amt[k] || 0) + l.amount); }); }); }
      if (!Object.keys(row.amt).length) { row.include = false; row.note = 'No pay setup — enter amounts here, or add a pay setup on the employee.'; }
      d.rows.push(row);
    });
    if (!d.cols.length) { var bs = findItem(b, 'earnings', null, 'Basic salary') || items(b, 'earnings')[0]; if (bs) addCol(b, d, 'earnings', bs.id, bs.name); }
    sortCols(b, d); notes(b, d);
    return d;
  }
  /** flag employees that already have a payslip for the month outside payroll */
  function notes(b, d) {
    d.rows.forEach(function (row) {
      if (row._dupNote) { row.note = ''; row._dupNote = false; }
      var dup = otherPayslip(b, row.employee, d.month, d.id);
      if (dup && !row.note) { row.note = 'Already has payslip ' + (dup.reference || '') + ' dated ' + fmtD(String(dup.date || dup.issueDate || '').slice(0, 10)) + '.'; row._dupNote = true; if (!row._touched) row.include = false; }
    });
  }
  /** a row's days maths (earning columns pro-rated / Absent deduction) */
  function rowCalc(d, row, b) {
    var ents = (d.cols || []).filter(function (c) { return c.sec === 'earnings'; }).map(function (c) { return { kind: colKind(c), sec: c.sec, itemId: c.itemId, item: c.item, amount: num(row.amt && row.amt[c.key]) }; });
    return daysCalc(b || null, ents, d.daysTotal, row.daysAbsent);
  }
  /** {earnings, deductions, contributions, net, absentDed, total, absent, worked, col:{key: amount after pro-rata}} */
  function rowTotals(d, row) {
    var t = { earnings: 0, deductions: 0, contributions: 0, col: {} }, x = rowCalc(d, row), i = 0;
    (d.cols || []).forEach(function (c) { var v = num(row.amt && row.amt[c.key]); if (c.sec === 'earnings') v = x.rows[i++].earned; t.col[c.key] = v; t[c.sec] += v; });
    t.deductions += x.absentDed;
    t.earnings = r2(t.earnings); t.deductions = r2(t.deductions); t.contributions = r2(t.contributions); t.net = r2(t.earnings - t.deductions);
    t.absentDed = x.absentDed; t.total = x.total; t.absent = x.absent; t.worked = x.worked; return t;
  }
  function draftTotals(d) {
    var t = { employees: 0, earnings: 0, deductions: 0, contributions: 0, net: 0, absentDed: 0, absent: 0, worked: 0 };
    (d.rows || []).forEach(function (row) { if (!row.include) return; var x = rowTotals(d, row); t.employees++; t.earnings += x.earnings; t.deductions += x.deductions; t.contributions += x.contributions; t.net += x.net; t.absentDed += x.absentDed; t.absent += x.absent;
      if (!daysError(d.daysTotal, row.daysAbsent)) t.worked += x.total ? x.worked : 0; });
    ['earnings', 'deductions', 'contributions', 'net', 'absentDed', 'absent', 'worked'].forEach(function (k) { t[k] = r2(t[k]); }); return t;
  }

  function validate(b, d) {
    var E = []; ensureDays(b, d);
    if (!validYm(d.month)) E.push('Choose the payroll month.');
    if (!d.date) E.push('Enter the payroll date.');
    var other = validYm(d.month) ? runForMonth(b, d.month, d.id) : null;
    if (other) E.push('A payroll run for ' + monthLabel(d.month) + ' already exists' + (other.state === 'draft' ? ' (draft)' : '') + '. Open it from the Payroll list instead.');
    var lk = (b && b.lockDate) || ''; if (lk && d.date && d.date <= lk) E.push('The payroll date is on or before the lock date (' + fmtD(lk) + '). Change the date, or update Settings → Lock Date.');
    var inc = (d.rows || []).filter(function (r) { return r.include; });
    if (!inc.length) E.push('Tick at least one employee.');
    if (num(d.daysTotal) < 0) E.push('Total days in the period cannot be negative.');
    inc.forEach(function (r) { var de = daysError(d.daysTotal, r.daysAbsent); if (de) E.push(r.employee + ': ' + de); });
    inc.forEach(function (r) { var t = rowTotals(d, r); if (!t.earnings && !t.deductions && !t.contributions) E.push(r.employee + ': enter at least one amount.'); else if (t.net < 0) E.push(r.employee + ': deductions are more than earnings (net pay ' + money(t.net) + ').');
      if (!empByName(b, r.employee)) E.push(r.employee + ' is no longer an employee.'); });
    var used = {}; inc.forEach(function (r) { d.cols.forEach(function (c) { if (num(r.amt && r.amt[c.key])) used[c.key] = c; }); });
    Object.keys(used).forEach(function (k) { var c = used[k], it = findItem(b, c.sec, c.itemId, c.item);
      if (!it) { E.push('"' + c.item + '" is not a ' + secDef(c.sec)[2].toLowerCase() + ' item any more — add it in Settings → Payslip Items or clear the column.'); return; }
      if (c.sec === 'contributions' && (!acct(b, it.liability) || !acct(b, it.expense))) E.push('Contribution item "' + it.name + '" needs an expense and a liability account (Settings → Payslip Items).'); });
    return E;
  }

  /** payslip lines in the format of the payslip form (js/settings-fixes-a.js psBuild), with the days maths applied */
  function payslipLines(b, d, row) {
    var out = [], x = rowCalc(d, row, b), ei = 0;
    d.cols.forEach(function (c) {
      var cr = c.sec === 'earnings' ? x.rows[ei++] : null;
      var full = Math.abs(num(row.amt && row.amt[c.key])); if (!full) return;
      var it = findItem(b, c.sec, c.itemId, c.item), sd = secDef(c.sec), nm = it ? it.name : c.item;
      var pro = !!(cr && cr.kind === 'prorata' && x.on), a = pro ? Math.abs(cr.earned) : full;
      var n = acct(b, it ? (c.sec === 'contributions' ? it.expense : it.account) : '');
      var o = { ptype: sd[2], item: nm, itemId: it ? String(it.id) : '', desc: pro ? proDesc(nm, x, full) : nm,
        account: n ? n.id : '', accountName: n ? n.name : '', amount: a, net: a, amountNoTax: a, totalWithTax: a, taxAmt: 0, qty: '', price: '' };
      o.description = o.desc;
      if (pro) { o.proRata = true; o.fullAmount = full; }
      if (c.sec === 'contributions') { var la = acct(b, it && it.liability); o.liabilityAccount = la ? la.id : ''; o.liabilityAccountName = la ? la.name : ''; }
      out.push(o); });
    if (x.absentDed > 0) out.push(absentLine(b, x));
    return out;
  }
  function nextRef(b, key) { var A = app(); try { return A.nextRef(b, key); } catch (e) { return String(recs(b, key).length + 1); } }
  function logAct(b, act, key, rec, before, extra) { var A = app(); try { A._logActivity(b, act, key, rec, before, extra); } catch (e) {} }
  function afterChange(b) { try { G('ensureAllControls')(b); } catch (e) {} try { G('refreshSummary')(b); } catch (e) {} try { if (global.GL && GL.invalidate) GL.invalidate(); } catch (e) {} }
  function snapshot(d) { return { month: d.month, date: d.date, description: d.description || '', daysTotal: d.daysTotal == null || d.daysTotal === '' ? null : r2(num(d.daysTotal)), daysAuto: d.daysAuto !== false, cols: clone(d.cols || []),
    rows: (d.rows || []).map(function (r) { return { employee: r.employee, code: r.code || '', include: !!r.include, note: r.note || '', amt: clone(r.amt || {}), daysAbsent: r2(num(r.daysAbsent)), payslipId: r.payslipId || null }; }) }; }

  /** keep a run as a draft (nothing posts) */
  function saveDraft(b, d) {
    if (!validYm(d.month)) return { errors: ['Choose the payroll month.'] };
    var other = runForMonth(b, d.month, d.id); if (other) return { errors: ['A payroll run for ' + monthLabel(d.month) + ' already exists.'] };
    ensureDays(b, d); var bad = (d.rows || []).filter(function (r) { return daysError(d.daysTotal, r.daysAbsent); })[0];
    if (bad) return { errors: [bad.employee + ': ' + daysError(d.daysTotal, bad.daysAbsent)] };
    b.records = b.records || {}; var arr = (b.records.payroll || []).slice(), run = d.id != null ? arr.filter(function (r) { return String(r.id) === String(d.id); })[0] : null, before = run ? clone(run) : null;
    if (!run) { run = { id: newId(b), uuid: uuid(), created: today() }; arr.push(run); }
    Object.assign(run, snapshot(d), { state: 'draft' }); b.records.payroll = arr; d.id = run.id;
    logAct(b, before ? 'update' : 'create', 'payroll', run, before);
    return { run: run };
  }
  /** create the payslips (one per ticked employee) and mark the run posted. Returns {run, payslips} or {errors} */
  function create(b, d) {
    var E = validate(b, d); if (E.length) return { errors: E };
    b.records = b.records || {};
    var arr = (b.records.payroll || []).slice(), run = d.id != null ? arr.filter(function (r) { return String(r.id) === String(d.id); })[0] : null, before = run ? clone(run) : null;
    if (!run) { run = { id: newId(b), uuid: uuid(), created: today() }; arr.push(run); }
    b.records.payroll = arr;
    var ps = (b.records.payslips || []).slice(); b.records.payslips = ps; var made = [];
    d.rows.forEach(function (row) {
      row.payslipId = null; if (!row.include) return;
      var e = empByName(b, row.employee) || {}, lines = payslipLines(b, d, row), t = rowTotals(d, row);
      var rec = { date: d.date, issueDate: d.date, reference: nextRef(b, 'payslips'), employee: row.employee, empName: row.employee, empCode: e.code || '',
        description: d.description || ('Payroll ' + monthLabel(d.month)), narration: d.description || ('Payroll ' + monthLabel(d.month)),
        lines: lines, earnings: t.earnings, deductions: t.deductions, contributions: t.contributions, netPay: t.net, total: t.net, subtotal: t.net, amount: t.net, tax: 0, balanceDue: t.net,
        payrollRun: run.id };
      if (t.total > 0) { rec.daysTotal = t.total; rec.daysAbsent = t.absent; rec.daysWorked = t.worked; rec.daysBasis = paySettings(b).basis; }
      rec.id = newId(b); rec.uuid = uuid(); ps.push(rec); row.payslipId = rec.id; made.push(rec);
    });
    Object.assign(run, snapshot(d), { state: 'posted', posted: today() }); d.id = run.id;
    afterChange(b);
    made.forEach(function (rec) { logAct(b, 'create', 'payslips', rec, null); });
    logAct(b, before ? 'update' : 'create', 'payroll', run, before);
    return { run: run, payslips: made };
  }

  /* ------------------------------------------------------------ run figures */
  function empAcctId(b) { try { var n = GL.sysAcct(b, 'employee clearing account', false); return n ? n.id : null; } catch (e) { return null; } }
  function isEmpLine(b, l, empId) { if (!l || blank(l.sub)) return false; if (empId && String(l.account) === String(empId)) return true; return /^employee clearing account$/i.test(String(l.accountName || l.accounts || '')); }
  function runPayments(b, run) { return recs(b, 'payments').filter(function (p) { return p && String(p.payrollRun) === String(run.id); }); }
  function runPayslips(b, run) { return recs(b, 'payslips').filter(function (p) { return p && String(p.payrollRun) === String(run.id); }); }
  /** a payslip's days: {daysTotal, daysAbsent, daysWorked} (nulls on a payslip saved before the fields existed; absent 0) */
  function psDays(p) { var t = p && p.daysTotal != null && p.daysTotal !== '' ? num(p.daysTotal) : null, a = num(p && p.daysAbsent);
    return { daysTotal: t, daysAbsent: a, daysWorked: t == null ? null : (p.daysWorked != null && p.daysWorked !== '' ? num(p.daysWorked) : r2(t - a)) }; }
  function netOf(p) { try { return G('payslipNetPay')(p); } catch (e) { var n = 0; (p.lines || []).forEach(function (l) { var s = lineSec(l); if (s === 'earnings') n += lineAmt(l); else if (s === 'deductions') n -= lineAmt(l); }); return r2(n); } }
  /** {employees, gross, deductions, contributions, net, paid, outstanding, status, rows:[{employee, code, payslip, gross, deductions, contributions, net, paid, outstanding}]} */
  function figures(b, run) {
    var f = { employees: 0, gross: 0, deductions: 0, contributions: 0, net: 0, paid: 0, outstanding: 0, status: 'Draft', rows: [], payments: [] };
    if (!run) return f;
    if (run.state === 'draft') { var t = draftTotals(run); f.employees = t.employees; f.gross = t.earnings; f.deductions = t.deductions; f.contributions = t.contributions; f.net = t.net; f.outstanding = 0;
      f.rows = (run.rows || []).filter(function (r) { return r.include; }).map(function (r) { var x = rowTotals(run, r); return { employee: r.employee, code: r.code, payslip: null, gross: x.earnings, deductions: x.deductions, contributions: x.contributions, net: x.net, paid: 0, outstanding: 0,
        daysTotal: x.total || null, daysAbsent: x.absent, daysWorked: x.total ? x.worked : null }; });
      return f; }
    var empId = empAcctId(b), paid = {};
    f.payments = runPayments(b, run);
    f.payments.forEach(function (p) { var lns = (p.lines || []).filter(Boolean);
      lns.forEach(function (l) { if (!isEmpLine(b, l, empId)) return; paid[l.sub] = r2((paid[l.sub] || 0) + num(l.amount != null && l.amount !== '' ? l.amount : l.net)); }); });
    runPayslips(b, run).forEach(function (p) {
      var g = 0, dd = 0, cc = 0; (p.lines || []).filter(Boolean).forEach(function (l) { var s = lineSec(l), a = lineAmt(l); if (s === 'earnings') g += a; else if (s === 'deductions') dd += a; else cc += a; });
      var emp = p.employee || p.empName || '', e = empByName(b, emp), net = netOf(p);
      var row = { employee: emp, code: (e && e.code) || p.empCode || '', payslip: p, gross: r2(g), deductions: r2(dd), contributions: r2(cc), net: r2(net), paid: 0, outstanding: 0 };
      Object.assign(row, psDays(p));
      f.rows.push(row); });
    /* payments split over the employee's payslips in this run, in order */
    f.rows.forEach(function (row) { var avail = paid[row.employee] || 0, take = Math.min(avail, Math.max(row.net, 0)); row.paid = r2(take); paid[row.employee] = r2(avail - take); row.outstanding = r2(row.net - row.paid); });
    Object.keys(paid).forEach(function (k) { if (paid[k] > 0.004) { var hit = f.rows.filter(function (r) { return r.employee === k; })[0]; if (hit) { hit.paid = r2(hit.paid + paid[k]); hit.outstanding = r2(hit.net - hit.paid); } } });
    f.rows.forEach(function (r) { f.employees++; f.gross += r.gross; f.deductions += r.deductions; f.contributions += r.contributions; f.net += r.net; f.paid += r.paid; });
    ['gross', 'deductions', 'contributions', 'net', 'paid'].forEach(function (k) { f[k] = r2(f[k]); });
    f.outstanding = r2(f.net - f.paid);
    f.status = !f.rows.length ? 'Accrued' : (f.paid <= 0.004 ? 'Accrued' : (f.outstanding <= 0.004 ? 'Paid' : 'Partly paid'));
    return f;
  }
  function status(b, run) { return run && run.state === 'draft' ? 'Draft' : figures(b, run).status; }

  /* -------------------------------------------------------------- payments */
  function bankByName(b, name) { return recs(b, 'bankCash').filter(function (x) { return x && x.name === name; })[0] || null; }
  /** o = {bank, date, mode:'each'|'batch', rows:[{employee, amount}]}. Returns {payments} or {errors} */
  function pay(b, runId, o) {
    o = o || {}; var run = runById(b, runId), E = [];
    if (!run || run.state !== 'posted') return { errors: ['Create the payslips of this run first.'] };
    if (!bankByName(b, o.bank)) E.push('Choose the bank or cash account the salaries are paid from.');
    if (!o.date) E.push('Enter the payment date.');
    var lk = (b && b.lockDate) || ''; if (lk && o.date && o.date <= lk) E.push('The payment date is on or before the lock date (' + fmtD(lk) + ').');
    var f = figures(b, run), out = {}; f.rows.forEach(function (r) { out[r.employee] = r2((out[r.employee] || 0) + r.outstanding); });
    var rows = (o.rows || []).filter(function (r) { return r && num(r.amount); });
    if (!rows.length) E.push('Tick at least one employee and enter an amount.');
    rows.forEach(function (r) { var a = r2(num(r.amount));
      if (!(r.employee in out)) E.push(r.employee + ' has no payslip in this run.');
      else if (a < 0) E.push(r.employee + ': the amount cannot be negative.');
      else if (a - out[r.employee] > 0.005) E.push(r.employee + ': ' + money(a) + ' is more than the ' + money(out[r.employee]) + ' still owed for ' + monthLabel(run.month) + '.'); });
    if (E.length) return { errors: E };
    var ea = null; try { ea = GL.sysAcct(b, 'employee clearing account', true); } catch (e) { ea = null; }
    var line = function (emp, a) { return { item: '', account: ea ? ea.id : '', accountName: ea ? ea.name : 'Employee clearing account', sub: emp, desc: 'Salary ' + monthLabel(run.month), description: 'Salary ' + monthLabel(run.month),
      qty: '', price: a, discount: '', net: a, amount: a, taxAmt: 0, tax: '', taxCode: '', taxRate: '' }; };
    b.records = b.records || {}; var arr = (b.records.payments || []).slice(); b.records.payments = arr; var made = [];
    var mk = function (payee, desc, lines) { var tot = r2(lines.reduce(function (s, l) { return s + l.amount; }, 0));
      var rec = { reference: nextRef(b, 'payments'), date: o.date, paidFrom: o.bank, payee: payee, payeeType: 'other', description: desc, lines: lines,
        subtotal: tot, tax: 0, total: tot, amount: tot, allocations: [], colItem: false, showDescCol: true, payrollRun: run.id, payrollMonth: run.month };
      rec.id = newId(b); rec.uuid = uuid(); arr.push(rec); made.push(rec); };
    if (o.mode === 'batch') mk('Salaries — ' + monthLabel(run.month), 'Salaries ' + monthLabel(run.month) + ' (' + rows.length + ' employee' + (rows.length === 1 ? '' : 's') + ')', rows.map(function (r) { return line(r.employee, r2(num(r.amount))); }));
    else rows.forEach(function (r) { mk(r.employee, 'Salary ' + monthLabel(run.month) + ' — ' + r.employee, [line(r.employee, r2(num(r.amount)))]); });
    afterChange(b);
    made.forEach(function (rec) { logAct(b, 'create', 'payments', rec, null); });
    return { payments: made };
  }

  /** delete a run and its payslips; refused while salary payments are linked */
  function deleteRun(b, id) {
    var run = runById(b, id); if (!run) return { errors: ['Payroll run not found.'] };
    var pays = runPayments(b, run); if (pays.length) return { errors: ['This run has ' + pays.length + ' salary payment' + (pays.length === 1 ? '' : 's') + '. Delete ' + (pays.length === 1 ? 'it' : 'them') + ' from Payments first.'] };
    var lk = (b && b.lockDate) || ''; if (lk && run.state === 'posted' && run.date && run.date <= lk) return { errors: ['This run is dated on or before the lock date (' + fmtD(lk) + ').'] };
    var gone = runPayslips(b, run).map(clone);
    b.records.payslips = recs(b, 'payslips').filter(function (p) { return !(p && String(p.payrollRun) === String(run.id)); });
    b.records.payroll = runs(b).filter(function (r) { return String(r.id) !== String(run.id); });
    afterChange(b);
    if (gone.length) logAct(b, 'delete', 'payslips', null, null, { bulkDeleted: gone, label: 'Payroll ' + monthLabel(run.month) + ' — ' + gone.length + ' payslips deleted' });
    logAct(b, 'delete', 'payroll', run, clone(run));
    return { deleted: gone.length };
  }

  /** the month the next run is for: the month after the last run, else the current month */
  function nextMonth(b) { var l = lastRun(b); return l ? (l.state === 'draft' ? l.month : addMonths(l.month, 1)) : ymOf(today()); }

  /* ---------------------------------------------------------------- report */
  /** payroll summary for a year from every payslip: {months:[...], employees:[...], total} */
  function summary(b, year) {
    year = String(year || today().slice(0, 4));
    var byM = {}, byE = {}, tot = { gross: 0, deductions: 0, contributions: 0, net: 0, payslips: 0, daysAbsent: 0, absentDed: 0 };
    recs(b, 'payslips').forEach(function (p) {
      if (!p) return; var d = String(p.date || p.issueDate || ''); if (d.slice(0, 4) !== year) return;
      var g = 0, dd = 0, cc = 0; (p.lines || []).filter(Boolean).forEach(function (l) { var s = lineSec(l), a = lineAmt(l); if (s === 'earnings') g += a; else if (s === 'deductions') dd += a; else cc += a; });
      if (!(p.lines || []).length) g = num(p.netPay != null && p.netPay !== '' ? p.netPay : p.total);
      var net = netOf(p), ym = d.slice(0, 7), emp = p.employee || p.empName || '(no employee)';
      var m = byM[ym] || (byM[ym] = { month: ym, employees: {}, gross: 0, deductions: 0, contributions: 0, net: 0, payslips: 0, daysAbsent: 0, absentDed: 0 });
      var e = byE[emp] || (byE[emp] = { employee: emp, months: {}, gross: 0, deductions: 0, contributions: 0, net: 0, payslips: 0, daysAbsent: 0, absentDed: 0 });
      var ab = num(p.daysAbsent), ad = (p.lines || []).filter(function (l) { return l && l.absent; }).reduce(function (s, l) { return s + lineAmt(l); }, 0);
      [m, e, tot].forEach(function (x) { x.gross += g; x.deductions += dd; x.contributions += cc; x.net += net; x.payslips++; x.daysAbsent += ab; x.absentDed += ad; });
      m.employees[emp] = 1; e.months[ym] = 1; });
    var fin = function (x) { ['gross', 'deductions', 'contributions', 'net', 'daysAbsent', 'absentDed'].forEach(function (k) { x[k] = r2(x[k]); }); return x; };
    var months = Object.keys(byM).sort().map(function (k) { var m = fin(byM[k]); m.employeeCount = Object.keys(m.employees).length; delete m.employees; return m; });
    var emps = Object.keys(byE).sort(function (x, y) { return x.localeCompare(y); }).map(function (k) { var e = fin(byE[k]); e.monthCount = Object.keys(e.months).length; delete e.months;
      var er = empByName(b, k); e.code = er ? (er.code || '') : ''; try { e.owing = r2(G('employeeBalance')(b, k)); } catch (x) { e.owing = 0; } return e; });
    return { year: year, months: months, employees: emps, total: fin(tot) };
  }
  function years(b) { var y = {}; y[today().slice(0, 4)] = 1; recs(b, 'payslips').forEach(function (p) { var d = String((p && (p.date || p.issueDate)) || ''); if (/^\d{4}/.test(d)) y[d.slice(0, 4)] = 1; }); return Object.keys(y).sort().reverse(); }

  /* ------------------------------------------------------------- reminders */
  /** reminders in the shared contract shape (FEATURES_SPEC "Reminders") */
  function reminders(b, now) {
    now = now || today(); var out = [];
    if (!b) return out;
    var emps = employees(b).filter(empActive), rs = runs(b);
    if (!emps.length || (!rs.length && !emps.some(hasSetup))) return out;
    var cur = ymOf(now), first = rs.length ? rs.map(function (r) { return r.month; }).sort()[0] : addMonths(cur, -1);
    for (var i = 3; i >= 0; i--) {
      var ym = addMonths(cur, -i); if (ym < first) continue;
      var run = runs(b).filter(function (r) { return r.month === ym; })[0];
      if (run && run.state === 'posted') continue;
      /* a month every active employee already has a payslip for (entered by hand) counts as run */
      if (!run && emps.every(function (e) { return recs(b, 'payslips').some(function (p) { return p && (p.employee || p.empName) === e.name && ymOf(p.date || p.issueDate) === ym; }); })) continue;
      var due = monthEnd(ym), sev = now > due ? 'overdue' : (now === due ? 'due' : (addDays(now, 5) >= due ? 'soon' : null));
      if (!sev) continue;
      out.push({ id: 'payroll-run-' + ym, title: 'Payroll for ' + monthLabel(ym) + ' not run yet', detail: run ? 'A draft run is waiting — review it and create the payslips.' : emps.length + ' active employee' + (emps.length === 1 ? '' : 's') + '. Run payroll to create the payslips.',
        due: due, kind: 'payroll', severity: sev, link: { section: 'Payroll', id: run ? run.id : null } });
    }
    rs.forEach(function (run) {
      if (run.state !== 'posted' || !run.date || run.date > now) return;
      var f = figures(b, run); if (f.outstanding <= 0.004) return;
      var due = addDays(run.date, 15);
      out.push({ id: 'payroll-pay-' + run.month, title: 'Salaries for ' + monthLabel(run.month) + ' not fully paid', detail: money(f.outstanding) + ' still owed to employees (' + f.status.toLowerCase() + '). Use Pay salaries on the run.',
        due: due, kind: 'payroll', severity: now > due ? 'overdue' : (now === due ? 'due' : 'soon'), link: { section: 'Payroll', id: run.id } });
    });
    return out;
  }
  var registeredWith = null;
  function registerReminders() {
    var R = G('Reminders'); if (!R || typeof R.register !== 'function' || registeredWith === R) return;
    try { R.register('payroll', function (b) { return reminders(b); }); registeredWith = R; } catch (e) {}
  }

  /* =================================================================== UI */
  var UI = { route: { page: 'list' }, draft: null, payState: null, errors: [] };
  function curB() { var A = app(); return A && A.curBiz ? A.curBiz() : null; }
  function render() { var A = app(); try { A.renderMain(A.curBiz()); } catch (e) {} }
  function go(route) { UI.route = route || { page: 'list' }; UI.errors = []; render(); try { var m = byId('wsMain'); if (m) m.scrollTop = 0; } catch (e) {} }
  function can(fn, label) { var A = app(), b = curB(); try { return typeof A[fn] === 'function' ? !!A[fn](b, label) : true; } catch (e) { return true; } }
  function stBadge(s) { var cls = s === 'Paid' ? 'st-paid' : (s === 'Draft' ? 'st-draft' : (s === 'Partly paid' ? 'st-partial' : 'st-unpaid')); return '<span class="st-badge ' + cls + '">' + esc(s) + '</span>'; }
  function crumb(parts) { var A = app(), ico = ''; try { ico = A._crumbIco(); } catch (e) {}
    return '<div class="ws-crumb"><div class="left">' + ico + ' ▸ ' + parts.map(function (p, i) { return (i < parts.length - 1 && p[1]) ? '<a class="led-link" onclick="' + p[1] + '">' + esc(p[0]) + '</a>' : esc(p[0]); }).join(' ▸ ') + '</div></div>'; }
  function errBox() { return UI.errors.length ? '<div class="tf-errbox pr-err" role="alert">' + UI.errors.map(esc).join('<br>') + '</div>' : ''; }
  function remStrip(list) {
    if (!list.length) return '';
    return '<div class="pr-rem" role="status">' + list.map(function (r) { return '<div class="pr-rem-i sev-' + esc(r.severity) + '"><span class="pr-dot"></span><b>' + esc(r.title) + '</b><span class="pr-rem-d">' + esc(r.detail || '') + '</span>' +
      (r.link && r.link.id ? '<a class="led-link" onclick="Payroll.ui.open(' + JSON.stringify(r.link.id) + ')">Open</a>' : (/not run yet/.test(r.title) ? '<a class="led-link" onclick="Payroll.ui.newRun(' + esc(JSON.stringify(r.id.replace('payroll-run-', ''))) + ')">Run now</a>' : '')) + '</div>'; }).join('') + '</div>';
  }

  /* ---- list ---- */
  function listHtml(b) {
    var rs = runs(b).slice().sort(function (x, y) { return String(y.month).localeCompare(String(x.month)); });
    var nm = nextMonth(b), last = lastRun(b);
    var actions = '';
    if (can('canCreate', 'Payroll')) {
      actions = '<button class="btn btn-primary btn-xs" onclick="Payroll.ui.newRun()">Run payroll for ' + esc(monthLabel(nm)) + '</button>' +
        (last && last.state === 'posted' && !runForMonth(b, addMonths(last.month, 1)) ? '<button class="btn btn-xs" onclick="Payroll.ui.runNext()" title="Copy ' + esc(monthLabel(last.month)) + ' into ' + esc(monthLabel(addMonths(last.month, 1))) + '">Run next month</button>' : '');
    }
    var body = rs.map(function (r) { var f = figures(b, r);
      return '<tr class="pr-click" onclick="Payroll.ui.open(' + JSON.stringify(r.id) + ')"><td class="nw"><a class="led-link">' + esc(monthLabel(r.month)) + '</a></td><td class="nw">' + esc(fmtD(r.date)) + '</td><td class="r">' + f.employees + '</td>' +
        '<td class="m r">' + money(f.gross) + '</td><td class="m r">' + money(f.deductions) + '</td><td class="m r bold">' + money(f.net) + '</td><td class="m r">' + (r.state === 'draft' ? '' : money(f.paid)) + '</td><td>' + stBadge(f.status) + '</td></tr>'; }).join('');
    var emps = employees(b).filter(empActive), noSetup = emps.filter(function (e) { return !hasSetup(e); });
    var hint = !emps.length ? '<div class="info-bar">Add your employees first (Payroll → Employees), with their pay setup, then run payroll here.</div>'
      : (noSetup.length ? '<div class="info-bar pr-hint">' + noSetup.length + ' of ' + emps.length + ' active employee' + (emps.length === 1 ? '' : 's') + ' ' + (noSetup.length === 1 ? 'has' : 'have') + ' no pay setup yet (' + noSetup.slice(0, 4).map(function (e) { return esc(e.name); }).join(', ') + (noSetup.length > 4 ? ', …' : '') + '). Open the employee → <b>Pay setup</b> so payroll can fill in their salary.</div>' : '');
    return crumb([['Payroll']]) +
      '<div class="reg-panel-head lt-head pr-head"><div class="lt-head-l"><span class="reg-panel-title">Payroll</span>' + actions + '</div>' +
      '<div class="pr-head-r"><button class="btn btn-xs" onclick="Payroll.ui.report()">Payroll summary</button></div></div>' +
      remStrip(reminders(b)) + hint +
      '<div class="tbl-scroll"><table class="reg-tbl lt-tbl pr-tbl"><thead><tr><th>Month</th><th>Date</th><th class="r">Employees</th><th class="r">Gross</th><th class="r">Deductions</th><th class="r">Net pay</th><th class="r">Paid</th><th>Status</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="8"><div class="reg-empty">No payroll runs yet. Click <b>Run payroll for ' + esc(monthLabel(nm)) + '</b> to create this month’s payslips in one go.</div></td></tr>') + '</tbody></table></div>' +
      '<div class="reg-foot"><span class="cnt">' + rs.length + ' ' + (rs.length === 1 ? 'run' : 'runs') + '</span></div>';
  }

  /* ---- review grid ----
     FIX_SPEC_3 #2: every item column is at least 120px and grows with its content; the grid
     scrolls sideways inside its own box (never the page); the tick + Employee columns stick
     to the left and Net pay to the right; long item names wrap to two lines and keep the full
     name as a tooltip. The table's min-width comes from the column count and is redrawn on
     every add / remove. #1: the "Add item column" control is always there — disabled with
     "All items added" once every payslip item is a column, enabled again when one is removed. */
  var COL_MIN = 120;
  function cellIn(ri, key, v) { return '<input type="text" inputmode="decimal" class="pr-num" data-pr-cell="' + ri + '|' + esc(key) + '" value="' + (num(v) ? esc(String(v)) : '') + '" oninput="Payroll.ui.cell(' + ri + ',' + esc(JSON.stringify(key)) + ',this.value)">'; }
  function proHint(d, t, c) { return colKind(c) === 'prorata' && t.absent > 0 && t.total > 0 ? '= ' + money(t.col[c.key]) : ''; }
  /** the add-column control: options for the items not on the grid yet; {html, disabled, tip} */
  function addColCtl(b, d) {
    var used = {}; d.cols.forEach(function (c) { used[c.key] = 1; });
    var any = SECS.some(function (s) { return items(b, s[0]).length; });
    var opts = SECS.map(function (s) { var L = items(b, s[0]).filter(function (it) { return !used[colKey(s[0], String(it.id), it.name)]; });
      return L.length ? '<optgroup label="' + s[1] + '">' + L.map(function (it) { return '<option value="' + esc(s[0] + '|' + it.id) + '">' + esc(it.name) + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    var dis = !opts, tip = any ? 'All items added' : 'No payslip items yet — add them in Settings → Payslip Items';
    return { disabled: dis, tip: dis ? tip : '', html: '<div class="pr-addcol"><span class="pr-add-w"' + (dis ? ' title="' + esc(tip) + '"' : '') + '><select id="prAddCol" aria-label="Add a payslip item column"' +
      (dis ? ' disabled aria-disabled="true" title="' + esc(tip) + '"' : ' title="Add a payslip item as a column"') + ' onchange="Payroll.ui.addCol(this.value)"><option value="">' + (dis ? esc(any ? 'All items added' : 'No payslip items yet') : '+ Add item column…') + '</option>' + opts + '</select></span>' +
      '<a class="led-link" onclick="Payroll.ui.items()">' + (any ? 'Payslip Items' : 'Settings → Payslip Items') + '</a></div>' };
  }
  function reviewHtml(b) {
    var d = UI.draft; if (!d) return listHtml(b); ensureDays(b, d);
    var T = draftTotals(d), S = colSums(d), ctl = addColCtl(b, d), n = d.cols.length;
    var E = d.cols.filter(function (c) { return c.sec === 'earnings'; }), D = d.cols.filter(function (c) { return c.sec === 'deductions'; }), C = d.cols.filter(function (c) { return c.sec === 'contributions'; });
    var showGross = E.length > 1, showDed = D.length > 0;
    var nE = E.length + (showGross ? 1 : 0), nD = 1 + D.length + (showDed ? 1 : 0);
    /* group start cells (pr-gs) carry the 2px divider between Days | Earnings | Deductions | Contributions | Net pay */
    var colHead = function (c, first) { var pk = colKind(c), tip = c.item + (pk === 'prorata' ? ' — pro-rata: (monthly ÷ total days) × days worked' : (pk === 'basic' ? ' — days absent are shown as the Absent deduction' : ''));
      return '<th class="r pr-col pr-gx-' + c.sec + (first ? ' pr-gs' : '') + '" title="' + esc(tip) + '"><div class="pr-th"><span class="pr-th-t">' + esc(c.item) + '</span>' +
        '<button type="button" class="pr-x" title="Remove this column" aria-label="Remove ' + esc(c.item) + '" onclick="Payroll.ui.dropCol(' + esc(JSON.stringify(c.key)) + ')">×</button></div>' + (pk === 'prorata' ? '<em class="pr-pro">pro-rata</em>' : '') + '</th>'; };
    var g1 = '<th class="act chk pr-stk pr-stk-l0" rowspan="2"><input type="checkbox" aria-label="Tick all" title="Tick all" onchange="Payroll.ui.incAll(this.checked)"' + (d.rows.length && d.rows.every(function (r) { return r.include; }) ? ' checked' : '') + '></th>' +
      '<th class="pr-emp pr-stk pr-stk-l1" rowspan="2">Employee</th>' +
      '<th class="pr-grp pr-gx-days pr-gs" colspan="3">Days</th>' +
      (nE ? '<th class="pr-grp pr-gx-earnings pr-gs" colspan="' + nE + '">Earnings</th>' : '') +
      '<th class="pr-grp pr-gx-deductions pr-gs" colspan="' + nD + '">Deductions</th>' +
      (C.length ? '<th class="pr-grp pr-gx-contributions pr-gs" colspan="' + C.length + '">Employer contributions</th>' : '') +
      '<th class="r pr-net pr-stk pr-stk-r pr-gs" rowspan="2">Net pay</th>';
    var g2 = '<th class="r pr-day pr-gx-days pr-gs" title="Total days in the period">Total</th><th class="r pr-day pr-gx-days" title="Days absent (enter)">Absent</th><th class="r pr-day pr-gx-days" title="Days worked = total − absent">Worked</th>' +
      E.map(function (c, i) { return colHead(c, i === 0); }).join('') + (showGross ? '<th class="r pr-gx-earnings">Gross</th>' : '') +
      '<th class="r pr-gx-deductions pr-gs" title="(Basic ÷ total days) × days absent">Absent ded.</th>' + D.map(function (c) { return colHead(c, false); }).join('') + (showDed ? '<th class="r pr-gx-deductions">Total ded.</th>' : '') +
      C.map(function (c, i) { return colHead(c, i === 0); }).join('');
    var amt = function (i, r, t, c, first) { return '<td class="r pr-col pr-gx-' + c.sec + (first ? ' pr-gs' : '') + '">' + cellIn(i, c.key, r.amt[c.key]) + (colKind(c) === 'prorata' ? '<div class="pr-earned" data-pr-e="' + i + '|' + esc(c.key) + '">' + proHint(d, t, c) + '</div>' : '') + '</td>'; };
    var rows = d.rows.map(function (r, i) { var t = rowTotals(d, r), bad = daysError(d.daysTotal, r.daysAbsent);
      return '<tr class="' + (r.include ? '' : 'pr-off') + '" data-pr-row="' + i + '"><td class="act chk pr-stk pr-stk-l0"><input type="checkbox" aria-label="Include ' + esc(r.employee) + '"' + (r.include ? ' checked' : '') + ' onchange="Payroll.ui.inc(' + i + ',this.checked)"></td>' +
        '<td class="pr-emp pr-stk pr-stk-l1" title="' + esc(r.employee) + '"><b>' + esc(r.employee) + '</b>' + (r.code ? '<span class="pr-code">' + esc(r.code) + '</span>' : '') + (r.note ? '<div class="pr-note">' + esc(r.note) + '</div>' : '') + '</td>' +
        '<td class="m r pr-day pr-ro pr-gx-days pr-gs" data-pr-t="' + i + ':total">' + esc(String(t.total || num(d.daysTotal) || '')) + '</td>' +
        '<td class="r pr-day pr-gx-days"><input type="text" inputmode="decimal" class="pr-num pr-days' + (bad ? ' pr-bad' : '') + '" data-pr-abs="' + i + '" aria-label="Days absent — ' + esc(r.employee) + '"' + (bad ? ' aria-invalid="true" title="' + esc(bad) + '"' : '') +
          ' value="' + (num(r.daysAbsent) ? esc(String(r.daysAbsent)) : '') + '" placeholder="0" oninput="Payroll.ui.days(' + i + ',this.value)"></td>' +
        '<td class="m r pr-day pr-ro pr-gx-days" data-pr-t="' + i + ':worked">' + esc(bad ? '—' : String(t.total ? t.worked : '')) + '</td>' +
        E.map(function (c, k) { return amt(i, r, t, c, k === 0); }).join('') + (showGross ? '<td class="m r pr-ro pr-gx-earnings" data-pr-t="' + i + ':earnings">' + money(t.earnings) + '</td>' : '') +
        '<td class="m r pr-ro pr-gx-deductions pr-gs" data-pr-t="' + i + ':absentDed">' + money(t.absentDed) + '</td>' + D.map(function (c) { return amt(i, r, t, c, false); }).join('') +
        (showDed ? '<td class="m r pr-ro pr-gx-deductions" data-pr-t="' + i + ':deductions">' + money(t.deductions) + '</td>' : '') +
        C.map(function (c, k) { return amt(i, r, t, c, k === 0); }).join('') +
        '<td class="m r bold pr-net pr-stk pr-stk-r pr-gs" data-pr-t="' + i + ':net">' + money(t.net) + '</td></tr>'; }).join('');
    var sumC = function (c, first) { return '<td class="m r pr-gx-' + c.sec + (first ? ' pr-gs' : '') + '" data-pr-col="' + esc(c.key) + '">' + money(S[c.key] || 0) + '</td>'; };
    var foot = '<tr class="tot-row"><td class="pr-stk pr-stk-l0"></td><td class="tot-lbl pr-stk pr-stk-l1">Total (<span data-pr-sum="employees">' + T.employees + '</span> ticked)</td>' +
      '<td class="pr-gx-days pr-gs"></td><td class="m r pr-gx-days" data-pr-sum="absent">' + esc(String(T.absent || 0)) + '</td><td class="m r pr-gx-days" data-pr-sum="worked">' + esc(String(T.worked || 0)) + '</td>' +
      E.map(function (c, i) { return sumC(c, i === 0); }).join('') + (showGross ? '<td class="m r pr-gx-earnings" data-pr-sum="earnings">' + money(T.earnings) + '</td>' : '') +
      '<td class="m r pr-gx-deductions pr-gs" data-pr-sum="absentDed">' + money(T.absentDed) + '</td>' + D.map(function (c) { return sumC(c, false); }).join('') +
      (showDed ? '<td class="m r pr-gx-deductions" data-pr-sum="deductions">' + money(T.deductions) + '</td>' : '') +
      C.map(function (c, i) { return sumC(c, i === 0); }).join('') +
      '<td class="m r bold pr-net pr-stk pr-stk-r pr-gs" data-pr-sum="net">' + money(T.net) + '</td></tr>';
    var title = (d.id ? 'Payroll ' + monthLabel(d.month) + ' (draft)' : 'Run payroll — ' + monthLabel(d.month));
    var ncols = 3 + nE + nD + C.length + 3;
    return crumb([['Payroll', 'Payroll.ui.list()'], [title]]) +
      '<div class="card pr-card pr-run" id="prReview"><div class="pr-card-h"><h2>' + esc(title) + '</h2></div>' + errBox() +
      '<div class="pr-secs"><section class="pr-sec"><h3 class="pr-sec-h">Period</h3><div class="pr-fields">' +
        '<label class="pr-f"><span>Month</span><input class="pr-in" type="month" value="' + esc(d.month) + '" onchange="Payroll.ui.hdr(\'month\',this.value)"></label>' +
        '<label class="pr-f"><span>Payroll date</span><input class="pr-in" type="date" value="' + esc(d.date) + '" onchange="Payroll.ui.hdr(\'date\',this.value)"></label>' +
        '<div class="pr-f pr-f-days"><label for="prDaysTotal">Total days in period</label><input class="pr-in" type="text" inputmode="decimal" id="prDaysTotal" value="' + esc(String(d.daysTotal == null ? '' : d.daysTotal)) + '" oninput="Payroll.ui.hdr(\'daysTotal\',this.value)">' +
          '<small class="pr-f-h">' + esc(d.daysAuto === false ? 'Entered by hand' : basisLabel(b)) + ' · <a class="led-link" onclick="Payroll.ui.settings()">Settings → Payroll</a></small></div></div></section>' +
      '<section class="pr-sec pr-sec-w"><h3 class="pr-sec-h">Description</h3><input class="pr-in pr-in-w" type="text" aria-label="Description" value="' + esc(d.description || '') + '" oninput="Payroll.ui.hdr(\'description\',this.value)"></section></div>' +
      '<details class="pr-how"><summary>How this works</summary><div>One payslip per ticked employee, dated ' + esc(fmtD(d.date)) + '. Accrual basis: salaries and allowances are expensed on that date and the net pay is owed to each employee until you use <b>Pay salaries</b>. ' +
        'Days absent: Basic salary is reduced by an <b>Absent deduction</b> line (Basic ÷ total days × days absent); allowances ticked <i>Pro-rata</i> in Payslip Items are paid for the days worked; other items are fixed.</div></details>' +
      '<section class="pr-sec pr-sec-emp"><h3 class="pr-sec-h">Employees</h3>' +
      '<div class="tbl-scroll pr-grid-wrap" id="prGridWrap"><table class="reg-tbl pr-grid" data-cols="' + n + '"><thead><tr class="pr-grp-row">' + g1 + '</tr><tr class="pr-col-row">' + g2 + '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="' + ncols + '"><div class="reg-empty">No active employees.</div></td></tr>') + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      ctl.html + '</section>' +
      '<div class="form-actions"><button class="btn btn-primary" onclick="Payroll.ui.create()">Create <span data-pr-sum="employees2">' + T.employees + '</span> payslips</button>' +
        '<button class="btn" onclick="Payroll.ui.saveDraft()">Save draft</button><button class="btn" onclick="Payroll.ui.cancel()">Cancel</button>' +
        (d.id && can('canDelete', 'Payroll') ? '<button class="btn btn-danger" style="margin-left:auto" onclick="Payroll.ui.del(' + JSON.stringify(d.id) + ')">Delete draft</button>' : '') + '</div></div>';
  }
  /** column totals of the ticked rows, after pro-rata */
  function colSums(d) { var s = {}; d.rows.forEach(function (r) { if (!r.include) return; var t = rowTotals(d, r); d.cols.forEach(function (c) { s[c.key] = r2((s[c.key] || 0) + (t.col[c.key] || 0)); }); }); return s; }
  function refreshTotals() {
    var d = UI.draft, h = byId('prReview'); if (!d || !h) return; var T = draftTotals(d), S = colSums(d);
    var q = function (sel) { return h.querySelector(sel); }, qk = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); };
    d.rows.forEach(function (r, i) { var t = rowTotals(d, r), bad = daysError(d.daysTotal, r.daysAbsent);
      ['earnings', 'deductions', 'net', 'absentDed'].forEach(function (k) { var c = q('[data-pr-t="' + i + ':' + k + '"]'); if (c) c.textContent = money(t[k]); });
      var ct = q('[data-pr-t="' + i + ':total"]'); if (ct) ct.textContent = String(t.total || num(d.daysTotal) || '');
      var cw = q('[data-pr-t="' + i + ':worked"]'); if (cw) cw.textContent = bad ? '—' : String(t.total ? t.worked : '');
      var ab = q('[data-pr-abs="' + i + '"]'); if (ab) { ab.classList.toggle('pr-bad', !!bad); if (bad) { ab.setAttribute('aria-invalid', 'true'); ab.setAttribute('title', bad); } else { ab.removeAttribute('aria-invalid'); ab.removeAttribute('title'); } }
      d.cols.forEach(function (c) { if (colKind(c) !== 'prorata') return; var e = q('[data-pr-e="' + i + '|' + qk(c.key) + '"]'); if (e) e.textContent = proHint(d, t, c); }); });
    d.cols.forEach(function (c) { var el = q('[data-pr-col="' + qk(c.key) + '"]'); if (el) el.textContent = money(S[c.key] || 0); });
    ['earnings', 'deductions', 'net', 'absentDed', 'employees', 'absent', 'worked'].forEach(function (k) { var el = q('[data-pr-sum="' + k + '"]'); if (el) el.textContent = k === 'employees' ? T.employees : ((k === 'absent' || k === 'worked') ? String(T[k] || 0) : money(T[k])); });
    var e2 = q('[data-pr-sum="employees2"]'); if (e2) e2.textContent = T.employees;
  }

  /* ---- run view ---- */
  function runHtml(b, run) {
    var f = figures(b, run), A = app();
    var tiles = [['Employees', f.employees, 0], ['Gross', money(f.gross), 1], ['Deductions', money(f.deductions), 1], ['Net pay', money(f.net), 1], ['Paid', money(f.paid), 1], ['Outstanding', money(f.outstanding), 1]];
    if (f.contributions) tiles.splice(3, 0, ['Employer contributions', money(f.contributions), 1]);
    var hasDays = f.rows.some(function (r) { return r.daysTotal != null; });
    var dayTds = function (r) { return hasDays ? '<td class="m r">' + (r.daysTotal == null ? '' : esc(String(r.daysTotal))) + '</td><td class="m r">' + (r.daysTotal == null ? '' : esc(String(r.daysAbsent || 0))) + '</td><td class="m r">' + (r.daysWorked == null ? '' : esc(String(r.daysWorked))) + '</td>' : ''; };
    var rows = f.rows.map(function (r) {
      return '<tr><td class="c-name"><b>' + esc(r.employee) + '</b>' + (r.code ? '<span class="pr-code">' + esc(r.code) + '</span>' : '') + '</td>' +
        '<td class="nw">' + (r.payslip ? '<a class="led-link" onclick="Payroll.ui.payslip(' + JSON.stringify(r.payslip.id) + ')">Payslip ' + esc(r.payslip.reference || '') + '</a>' : '') + '</td>' + dayTds(r) +
        '<td class="m r">' + money(r.gross) + '</td><td class="m r">' + money(r.deductions) + '</td><td class="m r bold">' + money(r.net) + '</td><td class="m r">' + money(r.paid) + '</td><td class="m r' + (r.outstanding > 0.004 ? ' pr-owe' : '') + '">' + money(r.outstanding) + '</td>' +
        '<td>' + stBadge(r.outstanding <= 0.004 ? 'Paid' : (r.paid > 0.004 ? 'Partly paid' : 'Accrued')) + '</td></tr>'; }).join('');
    var pays = f.payments.map(function (p) { return '<tr><td class="nw">' + esc(fmtD(p.date)) + '</td><td class="nw"><a class="led-link" onclick="Payroll.ui.payment(' + JSON.stringify(p.id) + ')">Payment ' + esc(p.reference || '') + '</a></td><td>' + esc(p.paidFrom || '') + '</td><td>' + esc(p.payee || '') + '</td><td class="m r">' + money(num(p.amount != null && p.amount !== '' ? p.amount : p.total)) + '</td></tr>'; }).join('');
    var nextYm = addMonths(run.month, 1);
    var acts = (f.outstanding > 0.004 && can('canCreate', 'Payments') ? '<button class="btn btn-primary" onclick="Payroll.ui.pay(' + JSON.stringify(run.id) + ')">Pay salaries</button>' : '') +
      (!runForMonth(b, nextYm) && can('canCreate', 'Payroll') ? '<button class="btn" onclick="Payroll.ui.runNext(' + JSON.stringify(run.id) + ')">Run next month (' + esc(monthLabel(nextYm)) + ')</button>' : '') +
      '<button class="btn" onclick="Payroll.ui.wpsCopy(' + JSON.stringify(run.id) + ')">Copy WPS list</button>' +
      '<button class="btn" onclick="window.print()">Print</button>' +
      '<button class="btn" onclick="Payroll.ui.list()">Back</button>' +
      (can('canDelete', 'Payroll') ? '<button class="btn btn-danger" style="margin-left:auto" onclick="Payroll.ui.del(' + JSON.stringify(run.id) + ')">Delete</button>' : '');
    return crumb([['Payroll', 'Payroll.ui.list()'], [monthLabel(run.month)]]) +
      '<div class="card pr-card"><div class="pr-card-h"><h2>Payroll — ' + esc(monthLabel(run.month)) + '</h2>' + stBadge(f.status) + '</div>' + errBox() +
      '<div class="pr-meta">Payroll date ' + esc(fmtD(run.date)) + (run.description ? ' · ' + esc(run.description) : '') + '</div>' +
      '<div class="pr-tiles">' + tiles.map(function (t) { return '<div class="pr-tile"><span>' + esc(t[0]) + '</span><b class="' + (t[2] ? 'm' : '') + '">' + esc(String(t[1])) + '</b></div>'; }).join('') + '</div>' +
      '<div class="tbl-scroll"><table class="reg-tbl pr-tbl"><thead><tr><th>Employee</th><th>Payslip</th>' + (hasDays ? '<th class="r" title="Total days in the period">Days</th><th class="r">Absent</th><th class="r">Worked</th>' : '') + '<th class="r">Gross</th><th class="r">Deductions</th><th class="r">Net pay</th><th class="r">Paid</th><th class="r">Outstanding</th><th>Status</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="' + (hasDays ? 11 : 8) + '"><div class="reg-empty">The payslips of this run were deleted.</div></td></tr>') + '</tbody>' +
        (f.rows.length ? '<tfoot><tr class="tot-row"><td colspan="2" class="tot-lbl">Total</td>' + (hasDays ? '<td></td><td class="m r">' + esc(String(r2(f.rows.reduce(function (a, r) { return a + num(r.daysAbsent); }, 0)))) + '</td><td></td>' : '') + '<td class="m r">' + money(f.gross) + '</td><td class="m r">' + money(f.deductions) + '</td><td class="m r bold">' + money(f.net) + '</td><td class="m r">' + money(f.paid) + '</td><td class="m r">' + money(f.outstanding) + '</td><td></td></tr></tfoot>' : '') + '</table></div>' +
      (pays ? '<h3 class="pr-h3">Salary payments</h3><div class="tbl-scroll"><table class="reg-tbl pr-tbl"><thead><tr><th>Date</th><th>Payment</th><th>Paid from</th><th>Payee</th><th class="r">Amount</th></tr></thead><tbody>' + pays + '</tbody></table></div>' : '') +
      '<div class="form-actions pr-acts">' + acts + '</div></div>';
  }

  /* ---- pay salaries ---- */
  function wpsRows(b, run, only) {
    var f = figures(b, run);
    return f.rows.filter(function (r) { return !only || only[r.employee] != null; }).map(function (r) { var e = empByName(b, r.employee) || {};
      return { employee: r.employee, code: r.code || '', bank: e.bankName || '', iban: e.iban || '', routing: e.wpsRouting || '', method: e.payMethod || '', eid: e.eidNo || '', labour: e.labourNo || '',
        net: r.net, outstanding: r.outstanding, amount: only ? num(only[r.employee]) : r.outstanding }; });
  }
  function payHtml(b, run) {
    var st = UI.payState; if (!st || String(st.runId) !== String(run.id)) st = UI.payState = payInit(b, run);
    var banks = recs(b, 'bankCash').filter(function (x) { return x && x.name; });
    var tot = r2(st.rows.reduce(function (s, r) { return s + (r.sel ? num(r.amount) : 0); }, 0));
    var rows = st.rows.map(function (r, i) {
      return '<tr class="' + (r.sel ? '' : 'pr-off') + '"><td class="act chk"><input type="checkbox" aria-label="Pay ' + esc(r.employee) + '"' + (r.sel ? ' checked' : '') + (r.outstanding <= 0.004 ? ' disabled' : '') + ' onchange="Payroll.ui.paySel(' + i + ',this.checked)"></td>' +
        '<td class="c-name"><b>' + esc(r.employee) + '</b>' + (r.code ? '<span class="pr-code">' + esc(r.code) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.method || '') + '</td><td>' + esc(r.bank || '') + '</td><td class="nw pr-iban">' + esc(r.iban || '') + (r.method && /wps|bank/i.test(r.method) && !r.iban ? '<span class="pr-warn" title="No IBAN on the employee record">IBAN missing</span>' : '') + '</td>' +
        '<td class="m r">' + money(r.outstanding) + '</td><td class="r"><input type="text" inputmode="decimal" class="pr-num" value="' + esc(r.amount === '' ? '' : String(r.amount)) + '"' + (r.outstanding <= 0.004 ? ' disabled' : '') + ' oninput="Payroll.ui.payAmt(' + i + ',this.value)"></td></tr>'; }).join('');
    return crumb([['Payroll', 'Payroll.ui.list()'], [monthLabel(run.month), 'Payroll.ui.open(' + JSON.stringify(run.id) + ')'], ['Pay salaries']]) +
      '<div class="card pr-card" id="prPay"><div class="pr-card-h"><h2>Pay salaries — ' + esc(monthLabel(run.month)) + '</h2></div>' + errBox() +
      '<div class="pr-fields"><label class="pr-f"><span>Paid from</span><select onchange="Payroll.ui.payHdr(\'bank\',this.value)"><option value="">— bank or cash account —</option>' +
        banks.map(function (x) { return '<option' + (x.name === st.bank ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="pr-f"><span>Payment date</span><input type="date" value="' + esc(st.date) + '" onchange="Payroll.ui.payHdr(\'date\',this.value)"></label>' +
      '<label class="pr-f"><span>Create</span><select onchange="Payroll.ui.payHdr(\'mode\',this.value)"><option value="each"' + (st.mode !== 'batch' ? ' selected' : '') + '>One payment per employee</option><option value="batch"' + (st.mode === 'batch' ? ' selected' : '') + '>One combined payment (WPS batch)</option></select></label></div>' +
      '<div class="pr-sub">Each payment debits <b>Employee clearing account</b> for the employee (the net pay owed) and credits the bank, so the salary liability clears. Change an amount for a partial payment.</div>' +
      '<div class="tbl-scroll"><table class="reg-tbl pr-tbl pr-paytbl"><thead><tr><th class="act chk"><input type="checkbox" aria-label="Tick all" onchange="Payroll.ui.payAll(this.checked)"' + (st.rows.every(function (r) { return r.sel || r.outstanding <= 0.004; }) ? ' checked' : '') + '></th><th>Employee</th><th>Method</th><th>Bank</th><th>IBAN</th><th class="r">Outstanding</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="tot-row"><td></td><td colspan="5" class="tot-lbl">Total to pay</td><td class="m r bold" id="prPayTot">' + money(tot) + '</td></tr></tfoot></table></div>' +
      '<div class="form-actions"><button class="btn btn-primary" onclick="Payroll.ui.payGo()">Create payment' + (st.mode === 'batch' ? '' : 's') + '</button>' +
        '<button class="btn" onclick="Payroll.ui.wpsCopy(' + JSON.stringify(run.id) + ',true)">Copy WPS list</button><button class="btn" onclick="Payroll.ui.wpsCsv(' + JSON.stringify(run.id) + ')">Download CSV</button>' +
        '<button class="btn" onclick="Payroll.ui.open(' + JSON.stringify(run.id) + ')">Cancel</button></div></div>';
  }
  function payInit(b, run) {
    var banks = recs(b, 'bankCash').filter(function (x) { return x && x.name; });
    var prev = runs(b).map(function (r) { return runPayments(b, r)[0]; }).filter(Boolean).sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })[0];
    return { runId: run.id, bank: prev && bankByName(b, prev.paidFrom) ? prev.paidFrom : (banks.length === 1 ? banks[0].name : ''), date: today(), mode: 'each',
      rows: wpsRows(b, run).map(function (r) { r.sel = r.outstanding > 0.004; r.amount = r.outstanding > 0.004 ? r.outstanding : ''; return r; }) };
  }

  /* ---- report ---- */
  function reportHtml(b) {
    var y = UI.route.year || today().slice(0, 4), s = summary(b, y);
    var mRows = s.months.map(function (m) { return '<tr><td class="nw">' + esc(monthLabel(m.month)) + '</td><td class="r">' + m.employeeCount + '</td><td class="r">' + m.payslips + '</td><td class="m r">' + esc(String(m.daysAbsent || 0)) + '</td><td class="m r">' + money(m.gross) + '</td><td class="m r">' + money(m.deductions) + '</td><td class="m r">' + money(m.contributions) + '</td><td class="m r bold">' + money(m.net) + '</td></tr>'; }).join('');
    var eRows = s.employees.map(function (e) { return '<tr><td class="c-name">' + esc(e.employee) + '</td><td class="nw">' + esc(e.code) + '</td><td class="r">' + e.monthCount + '</td><td class="m r">' + esc(String(e.daysAbsent || 0)) + '</td><td class="m r">' + money(e.absentDed) + '</td><td class="m r">' + money(e.gross) + '</td><td class="m r">' + money(e.deductions) + '</td><td class="m r">' + money(e.contributions) + '</td><td class="m r bold">' + money(e.net) + '</td><td class="m r">' + money(e.owing) + '</td></tr>'; }).join('');
    var t = s.total;
    return crumb([['Payroll', 'Payroll.ui.list()'], ['Payroll summary']]) +
      '<div class="card pr-card"><div class="pr-card-h"><h2>Payroll summary</h2><label class="pr-f pr-f-in"><span>Year</span><select onchange="Payroll.ui.report(this.value)">' + years(b).map(function (x) { return '<option' + (x === y ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="pr-sub">All payslips dated in ' + esc(y) + ' (payroll runs and single payslips), on the accrual basis. Gross shows Basic salary in full; days absent are in Deductions as the Absent deduction.</div>' +
      '<h3 class="pr-h3">By month</h3><div class="tbl-scroll"><table class="reg-tbl pr-tbl"><thead><tr><th>Month</th><th class="r">Employees</th><th class="r">Payslips</th><th class="r">Days absent</th><th class="r">Gross</th><th class="r">Deductions</th><th class="r">Contributions</th><th class="r">Net pay</th></tr></thead><tbody>' +
        (mRows || '<tr><td colspan="8"><div class="reg-empty">No payslips in ' + esc(y) + '.</div></td></tr>') + '</tbody>' +
        (mRows ? '<tfoot><tr class="tot-row"><td class="tot-lbl">Total</td><td></td><td class="r">' + t.payslips + '</td><td class="m r">' + esc(String(t.daysAbsent || 0)) + '</td><td class="m r">' + money(t.gross) + '</td><td class="m r">' + money(t.deductions) + '</td><td class="m r">' + money(t.contributions) + '</td><td class="m r bold">' + money(t.net) + '</td></tr></tfoot>' : '') + '</table></div>' +
      '<h3 class="pr-h3">By employee</h3><div class="tbl-scroll"><table class="reg-tbl pr-tbl"><thead><tr><th>Employee</th><th>Code</th><th class="r">Months</th><th class="r">Days absent</th><th class="r" title="Total of the Absent deduction lines">Absent deduction</th><th class="r">Gross</th><th class="r">Deductions</th><th class="r">Contributions</th><th class="r">Net pay</th><th class="r">Owing today</th></tr></thead><tbody>' +
        (eRows || '<tr><td colspan="10"><div class="reg-empty">No payslips in ' + esc(y) + '.</div></td></tr>') + '</tbody></table></div>' +
      '<div class="form-actions"><button class="btn" onclick="window.print()">Print</button><button class="btn" onclick="Payroll.ui.reportCsv()">Download CSV</button><button class="btn" onclick="Payroll.ui.list()">Back</button></div></div>';
  }

  function pageHtml(b) {
    var r = UI.route || { page: 'list' };
    if (r.page === 'review') return reviewHtml(b);
    if (r.page === 'report') return reportHtml(b);
    if (r.page === 'run' || r.page === 'pay') { var run = runById(b, r.id); if (!run) { UI.route = { page: 'list' }; return listHtml(b); }
      if (run.state === 'draft') { if (!UI.draft || String(UI.draft.id) !== String(run.id)) UI.draft = Object.assign({ id: run.id }, clone(snapshot(run))); UI.route = { page: 'review' }; return reviewHtml(b); }
      return r.page === 'pay' ? payHtml(b, run) : runHtml(b, run); }
    return listHtml(b);
  }

  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function download(name, text) { var A = app(); try { if (A && A._download) return A._download(name, text); } catch (e) {} }
  function clip(text, msg) { try { global.navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { say(text); }); } catch (e) { say(text); } }
  function wpsTable(b, run, only) {
    var head = ['Employee code', 'Employee name', 'Emirates ID', 'Labour card no.', 'Bank', 'IBAN', 'Routing / agent code', 'Amount', 'Month'];
    return [head].concat(wpsRows(b, run, only).filter(function (r) { return num(r.amount) > 0; }).map(function (r) { return [r.code, r.employee, r.eid, r.labour, r.bank, r.iban, r.routing, r2(num(r.amount)).toFixed(2), monthLabel(run.month)]; }));
  }
  function payOnly() { var st = UI.payState; if (!st) return null; var o = {}; st.rows.forEach(function (r) { if (r.sel && num(r.amount)) o[r.employee] = num(r.amount); }); return o; }

  UI.list = function () { UI.draft = null; UI.payState = null; go({ page: 'list' }); };
  UI.open = function (id) { var b = curB(), run = runById(b, id); if (!run) return UI.list(); UI.payState = null;
    if (run.state === 'draft') { UI.draft = Object.assign({ id: run.id }, clone(snapshot(run))); return go({ page: 'review' }); }
    go({ page: 'run', id: run.id }); };
  UI.newRun = function (ym) { var b = curB(); if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.');
    ym = validYm(ym) ? ym : nextMonth(b); var ex = runForMonth(b, ym); if (ex) return UI.open(ex.id);
    UI.draft = prefill(b, ym); go({ page: 'review' }); };
  UI.runNext = function (fromId) { var b = curB(); if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.');
    var src = fromId != null ? runById(b, fromId) : lastRun(b); if (!src) return UI.newRun();
    var ym = addMonths(src.month, 1), ex = runForMonth(b, ym); if (ex) return UI.open(ex.id);
    UI.draft = prefill(b, ym, { copyFrom: src }); go({ page: 'review' }); };
  UI.report = function (y) { go({ page: 'report', year: y || null }); };
  UI.items = function () { var A = app(); if (global.SettingsFixesA && SettingsFixesA.openPayslipItems) return SettingsFixesA.openPayslipItems(''); try { A.selectSection('Settings'); } catch (e) {} };
  UI.hdr = function (k, v) { var d = UI.draft; if (!d) return; var b = curB();
    if (k === 'month') { if (!validYm(v)) return; var keepDate = d.date !== monthEnd(d.month), keepDesc = d.description !== 'Payroll ' + monthLabel(d.month);
      d.month = v; if (!keepDate) d.date = monthEnd(v); if (!keepDesc) d.description = 'Payroll ' + monthLabel(v); if (d.daysAuto !== false) d.daysTotal = periodDays(b, v); notes(b, d); render(); return; }
    if (k === 'daysTotal') { d.daysTotal = v; d.daysAuto = false; refreshTotals(); return; }
    d[k] = v; if (k === 'date') render(); };
  UI.days = function (i, v) { var d = UI.draft; if (!d || !d.rows[i]) return; d.rows[i].daysAbsent = v; refreshTotals(); };
  UI.settings = function () { var A = app(); try { A.wsMode = 'settings'; if (global.SettingsPages) return SettingsPages.go('payrollSettings', ''); A.openSetting('payrollSettings'); } catch (e) {} };
  UI.cell = function (i, key, v) { var d = UI.draft; if (!d || !d.rows[i]) return; d.rows[i].amt[key] = v; if (num(v) && !d.rows[i].include && !d.rows[i]._touched) { d.rows[i].include = true; var tr = byId('prReview') && byId('prReview').querySelector('[data-pr-row="' + i + '"]'); if (tr) { tr.classList.remove('pr-off'); var cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = true; } } refreshTotals(); };
  UI.inc = function (i, on) { var d = UI.draft; if (!d || !d.rows[i]) return; d.rows[i].include = !!on; d.rows[i]._touched = true; var tr = byId('prReview') && byId('prReview').querySelector('[data-pr-row="' + i + '"]'); if (tr) tr.classList.toggle('pr-off', !on); refreshTotals(); };
  UI.incAll = function (on) { var d = UI.draft; if (!d) return; d.rows.forEach(function (r) { r.include = !!on; r._touched = true; }); render(); };
  /* redraw the grid after a column change, keeping its horizontal scroll (and showing a new column) */
  function regrid(showKey) {
    var w = byId('prGridWrap'), x = w ? w.scrollLeft : 0; render();
    var w2 = byId('prGridWrap'); if (!w2) return; w2.scrollLeft = x;
    if (showKey == null) return;
    try { var d = UI.draft, i = d.cols.findIndex(function (c) { return c.key === showKey; }), tr = w2.querySelector('thead tr:last-child'), th = tr && tr.querySelectorAll('th.pr-col')[i];
      if (th) { var l = th.offsetLeft, r = l + th.offsetWidth, stL = 0, stR = 0; Array.prototype.forEach.call(tr.children, function (c) { if (c.classList.contains('pr-stk-l1')) stL = c.offsetLeft + c.offsetWidth; if (c.classList.contains('pr-stk-r') && getComputedStyle(c).position === 'sticky') stR = c.offsetWidth; });
        if (l - stL < w2.scrollLeft) w2.scrollLeft = Math.max(0, l - stL); else if (r + stR > w2.scrollLeft + w2.clientWidth) w2.scrollLeft = r + stR - w2.clientWidth; } } catch (e) {}
  }
  UI.addCol = function (v) { var d = UI.draft; if (!d || !v) return; var b = curB(), p = String(v).split('|'), it = findItem(b, p[0], p.slice(1).join('|'), null); if (!it) return; var k = addCol(b, d, p[0], it.id, it.name); sortCols(b, d); regrid(k); };
  UI.dropCol = function (key) { var d = UI.draft; if (!d) return; d.cols = d.cols.filter(function (c) { return c.key !== key; }); d.rows.forEach(function (r) { delete r.amt[key]; }); regrid(null); };
  UI.saveDraft = function () { var A = app(), b = curB(), d = UI.draft; if (!b || !d) return; if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.');
    var r = saveDraft(b, d); if (r.errors) { UI.errors = r.errors; return render(); } A.saveBiz(b); toast('Draft saved'); UI.list(); };
  UI.create = function () { var A = app(), b = curB(), d = UI.draft; if (!b || !d) return;
    if (!can('canCreate', 'Payroll') || !can('canCreate', 'Payslips')) return say('Your permissions do not allow creating payslips.');
    var r = create(b, d); if (r.errors) { UI.errors = r.errors; render(); try { byId('wsMain').scrollTop = 0; } catch (e) {} return; }
    A.saveBiz(b); toast('Created ' + r.payslips.length + ' payslip' + (r.payslips.length === 1 ? '' : 's')); UI.draft = null; go({ page: 'run', id: r.run.id }); };
  UI.del = function (id) { var b = curB(), run = runById(b, id); if (!run) return; if (!can('canDelete', 'Payroll')) return say('Your permissions do not allow deleting payroll runs.');
    var n = runPayslips(b, run).length, pays = runPayments(b, run).length;
    if (pays) return say('This run has ' + pays + ' salary payment' + (pays === 1 ? '' : 's') + '. Delete ' + (pays === 1 ? 'it' : 'them') + ' from Payments first.');
    ask(run.state === 'draft' ? 'Delete the draft payroll for ' + monthLabel(run.month) + '?' : 'Delete payroll ' + monthLabel(run.month) + ' and its ' + n + ' payslip' + (n === 1 ? '' : 's') + '? This cannot be undone.', { danger: true, okText: 'Delete', title: 'Delete payroll run' }).then(function (ok) {
      if (!ok) return; var A = app(), bb = curB(), r = deleteRun(bb, id); if (r.errors) return say(r.errors.join('\n')); A.saveBiz(bb); toast('Deleted'); UI.list(); }); };
  UI.pay = function (id) { if (!can('canCreate', 'Payments')) return say('Your permissions do not allow creating payments.'); UI.payState = null; go({ page: 'pay', id: id }); };
  UI.payHdr = function (k, v) { if (!UI.payState) return; UI.payState[k] = v; if (k === 'mode') render(); };
  UI.paySel = function (i, on) { var st = UI.payState; if (!st || !st.rows[i]) return; st.rows[i].sel = !!on; if (on && !num(st.rows[i].amount)) st.rows[i].amount = st.rows[i].outstanding; render(); };
  UI.payAll = function (on) { var st = UI.payState; if (!st) return; st.rows.forEach(function (r) { if (r.outstanding > 0.004) { r.sel = !!on; if (on && !num(r.amount)) r.amount = r.outstanding; } }); render(); };
  UI.payAmt = function (i, v) { var st = UI.payState; if (!st || !st.rows[i]) return; st.rows[i].amount = v; var t = byId('prPayTot'); if (t) t.textContent = money(st.rows.reduce(function (s, r) { return s + (r.sel ? num(r.amount) : 0); }, 0)); };
  UI.payGo = function () { var A = app(), b = curB(), st = UI.payState; if (!b || !st) return; if (!can('canCreate', 'Payments')) return say('Your permissions do not allow creating payments.');
    var r = pay(b, st.runId, { bank: st.bank, date: st.date, mode: st.mode, rows: st.rows.filter(function (x) { return x.sel; }).map(function (x) { return { employee: x.employee, amount: x.amount }; }) });
    if (r.errors) { UI.errors = r.errors; return render(); }
    A.saveBiz(b); toast('Created ' + r.payments.length + ' payment' + (r.payments.length === 1 ? '' : 's')); var id = st.runId; UI.payState = null; go({ page: 'run', id: id }); };
  UI.wpsCopy = function (id, fromPay) { var b = curB(), run = runById(b, id); if (!run) return; var t = wpsTable(b, run, fromPay ? payOnly() : null);
    if (t.length < 2) return say('Nothing outstanding to pay for ' + monthLabel(run.month) + '.');
    clip(t.map(function (r) { return r.join('\t'); }).join('\n'), 'WPS list copied — paste it into Excel or your bank’s WPS upload'); };
  UI.wpsCsv = function (id) { var b = curB(), run = runById(b, id); if (!run) return; var t = wpsTable(b, run, payOnly());
    download('wps-salaries-' + run.month + '.csv', t.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n'); };
  UI.reportCsv = function () { var b = curB(), s = summary(b, UI.route.year || today().slice(0, 4));
    var L = [['Month', 'Employees', 'Payslips', 'Days absent', 'Gross', 'Deductions', 'Contributions', 'Net pay']].concat(s.months.map(function (m) { return [monthLabel(m.month), m.employeeCount, m.payslips, m.daysAbsent, m.gross, m.deductions, m.contributions, m.net]; }));
    L.push([]); L.push(['Employee', 'Code', 'Months', 'Days absent', 'Absent deduction', 'Gross', 'Deductions', 'Contributions', 'Net pay', 'Owing today']);
    s.employees.forEach(function (e) { L.push([e.employee, e.code, e.monthCount, e.daysAbsent, e.absentDed, e.gross, e.deductions, e.contributions, e.net, e.owing]); });
    download('payroll-summary-' + s.year + '.csv', L.map(function (r) { return r.map(csvCell).join(','); }).join('\n') + '\n'); };
  UI.payslip = function (id) { var A = app(); try { A.gotoRecord('payslips', id); } catch (e) {} };
  UI.payment = function (id) { var A = app(); try { A.gotoRecord('payments', id); } catch (e) {} };

  /* unsaved changes on the Run payroll page (js/unsaved-guard.js asks before the sidebar opens another page) */
  ['hdr', 'days', 'cell', 'inc', 'incAll', 'addCol', 'dropCol'].forEach(function (k) { var o = UI[k]; UI[k] = function () { UI.dirty = true; return o.apply(this, arguments); }; });
  ['list', 'newRun', 'runNext', 'open'].forEach(function (k) { var o = UI[k]; UI[k] = function () { UI.dirty = false; return o.apply(this, arguments); }; });
  P.unsaved = function () { return UI.dirty && UI.draft && UI.route && UI.route.page === 'review' ? 'The payroll run for ' + monthLabel(UI.draft.month) + ' has changes that are not saved. Leave without saving? (Use Save draft to keep them.)' : ''; };
  UI.cancel = function () {
    var m = P.unsaved(); if (!m) return UI.list();
    ask(m, { title: 'Unsaved changes', okText: 'Leave without saving', danger: true }).then(function (ok) { if (ok) UI.list(); });
  };

  /* ------------------------------------------------------------- install */
  function wrap(obj, name, fn) { if (!obj || typeof obj[name] !== 'function') return; var orig = obj[name]; obj[name] = function () { return fn.call(this, orig, Array.prototype.slice.call(arguments)); }; }
  function isPayroll(A) { return l2k()[A.wsSection] === 'payroll'; }
  function install() {
    var A = app(); if (!A || A._payrollInstalled) return; A._payrollInstalled = true;
    var R = reg();
    if (!R.payroll) R.payroll = { label: 'Payroll', singular: 'Payroll run', newLabel: 'Run payroll', ownPage: 1, columns: [{ key: 'month', label: 'Month', kind: 'text' }, { key: 'date', label: 'Date', kind: 'date' }, { key: 'description', label: 'Description', kind: 'text' }], form: [] };
    /* the Payroll tab draws its own pages (list / review grid / run / pay / report) */
    wrap(A, 'listHtml', function (orig, args) { if (!isPayroll(this)) return orig.apply(this, args); var b = args[0] || this.curBiz();
      try { if (typeof this.permLevel === 'function' && this.permLevel(b, 'Payroll') < 1) return orig.apply(this, args); } catch (e) {}
      return pageHtml(b); });
    wrap(A, 'renderMain', function (orig, args) {
      if (isPayroll(this) && (this.wsMode === 'form' || this.wsMode === 'view')) { this.wsMode = 'list'; }
      return orig.apply(this, args); });
    wrap(A, 'selectSection', function (orig, args) { if (args[0] === 'Payroll') { UI.route = { page: 'list' }; UI.draft = null; UI.payState = null; UI.errors = []; } return orig.apply(this, args); });
    wrap(A, 'newRecord', function (orig, args) { if (isPayroll(this)) return UI.newRun(); return orig.apply(this, args); });
    ['viewRecord', 'editRecord'].forEach(function (n) { wrap(A, n, function (orig, args) { if (isPayroll(this)) return UI.open(args[0]); return orig.apply(this, args); }); });
    wrap(A, 'gotoRecord', function (orig, args) { if (args[0] === 'payroll') { this.wsSection = 'Payroll'; this.wsMode = 'list'; this.editingId = null; var run = runById(this.curBiz(), args[1]); UI.route = run ? { page: 'run', id: run.id } : { page: 'list' }; if (run && run.state === 'draft') { UI.draft = Object.assign({ id: run.id }, clone(snapshot(run))); UI.route = { page: 'review' }; } return this.renderWorkspace(); } return orig.apply(this, args); });
    /* the sidebar icon */
    var I = G('ICO'); if (I && typeof I.forSection === 'function' && !I._payroll) { var fs = I.forSection; I._payroll = 1; I.forSection = function (label, size, cls) { return label === 'Payroll' ? this.get('briefcase', size, cls) : fs.apply(this, arguments); }; }
    installSettings(A);
    registerReminders();
    try { if (A.view === 'workspace' && A.curBiz && A.curBiz()) A.renderWorkspace(); } catch (e) {}
  }

  /* ------------------------------------------- Settings → Payroll, Payslip Items "Pro-rata" */
  function dmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); }
  var SETTINGS_PAGE = { title: 'Payroll', kind: 'form', store: 'payrollSettings',
    intro: 'How payroll counts the days of a pay period. Days worked = total days − days absent. Basic salary is reduced by an Absent deduction line; allowances ticked "Pro-rata" in Payslip Items are paid for the days worked; other items are fixed.',
    fields: [
      { k: 'daysBasis', l: 'Total days in a pay period', t: 'select', def: 'calendar', opts: [['calendar', 'Calendar days (every day of the month)'], ['working', 'Working days (leave out weekends)']] },
      { k: 'weekend', l: 'Weekend', t: 'select', def: 'sat-sun', opts: WEEKENDS.map(function (w) { return [w[0], w[1]]; }), show: function (v) { return v.daysBasis === 'working'; },
        hint: 'UAE: Saturday and Sunday (federal), Friday and Saturday, or Sunday only for a six-day week.' },
      { k: 'excludeHolidays', l: 'Leave out public holidays', t: 'checkbox', show: function (v) { return v.daysBasis === 'working'; } },
      { k: 'holidays', l: 'Public holidays', t: 'lines', cols: [{ k: 'date', l: 'Date (DD/MM/YYYY)' }, { k: 'name', l: 'Holiday' }], show: function (v) { return v.daysBasis === 'working' && !!v.excludeHolidays; },
        hint: 'A holiday that falls on a weekend day is not counted twice.' }],
    load: function (r) { r.holidays = (r.holidays || []).map(function (h) { return { date: h && isoDate(h.date) ? dmy(isoDate(h.date)) : (h && h.date) || '', name: (h && h.name) || '' }; }); return r; },
    validate: function (v) { var bad = (v.holidays || []).filter(function (h) { return h && !blank(h.date) && !isoDate(h.date); })[0]; if (bad) return 'Public holiday date "' + bad.date + '" is not a date — use DD/MM/YYYY.'; },
    beforeSave: function (r) { if (r.daysBasis !== 'working') r.daysBasis = 'calendar'; if (!WEEKENDS.some(function (w) { return w[0] === r.weekend; })) r.weekend = 'sat-sun';
      r.excludeHolidays = !!r.excludeHolidays; r.holidays = (r.holidays || []).filter(function (h) { return h && isoDate(h.date); }).map(function (h) { return { date: isoDate(h.date), name: String(h.name || '') }; }).sort(function (x, y) { return x.date.localeCompare(y.date); }); } };
  function installSettings(A) {
    var SP = G('SettingsPages'); if (!SP || !SP.PAGES || SP._payroll) return; SP._payroll = true; var PG = SP.PAGES;
    PG.payrollSettings = SETTINGS_PAGE;
    A.set_payrollSettings = function (b) { return SP.page(b, 'payrollSettings'); };
    wrap(A, 'setTiles', function (orig, args) { var t = orig.apply(this, args) || []; if (t.some(function (x) { return x[2] === 'payrollSettings'; })) return t;
      var i = t.findIndex(function (x) { return x[2] === 'payslipItems'; }), tile = ['briefcase', 'Payroll', 'payrollSettings', 'Days in a pay period: calendar or working days, weekends, public holidays', 1, 1];
      t = t.slice(); t.splice(i < 0 ? t.length : i, 0, tile); return t; });
    var I = G('ICO'); if (I && typeof I.forSetting === 'function' && !I._payrollSet) { var fs = I.forSetting; I._payrollSet = 1; I.forSetting = function (key, size, cls) { return key === 'payrollSettings' ? this.get('briefcase', size, cls) : fs.apply(this, arguments); }; }
    try { var E = PG.payslipItems.items.earnings;
      if (!(E.fields || []).some(function (f) { return f && f.k === 'proRata'; })) {
        E.fields.splice(2, 0, { k: 'proRata', l: 'Pro-rata', t: 'checkbox', hint: 'Pay this allowance for the days worked: (monthly ÷ total days) × days worked. Basic salary is always reduced for days absent, as a separate Absent deduction line; items left unticked are fixed.' });
        E.cols.push({ k: 'proRata', l: 'Pro-rata', fmt: function (v, r) { return isBasicName(r && r.name) ? 'Basic (absent deduction)' : (truthy(v) ? 'Yes' : ''); } }); }
    } catch (e) {}
  }

  P.SECS = SECS; P.items = items; P.findItem = findItem; P.paySetup = paySetup; P.setupTotals = setupTotals; P.hasSetup = hasSetup; P.empActive = empActive;
  P.monthEnd = monthEnd; P.addMonths = addMonths; P.monthLabel = monthLabel;
  P.runs = runs; P.runById = runById; P.lastRun = lastRun; P.nextMonth = nextMonth;
  P.prefill = prefill; P.rowTotals = rowTotals; P.draftTotals = draftTotals; P.validate = validate; P.saveDraft = saveDraft; P.create = create;
  P.figures = figures; P.status = status; P.pay = pay; P.deleteRun = deleteRun; P.summary = summary; P.reminders = reminders; P.wpsTable = wpsTable;
  P.periodDays = periodDays; P.paySettings = paySettings; P.daysCalc = daysCalc; P.daysError = daysError; P.proKind = proKind; P.absentLine = absentLine; P.proDesc = proDesc; P.isoDate = isoDate;
  P.basisLabel = basisLabel; P.psDays = psDays; P.addColCtl = addColCtl; P.WEEKENDS = WEEKENDS;
  P.registerReminders = registerReminders; P.install = install; P.pageHtml = pageHtml; P.ui = UI;
  global.Payroll = P;
  install();
  try { if (doc() && doc().addEventListener) doc().addEventListener('DOMContentLoaded', function () { install(); registerReminders(); }); } catch (e) {}
  try { if (global.addEventListener) global.addEventListener('load', registerReminders); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
