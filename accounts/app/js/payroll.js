/* ===================== Payroll (FEATURES_SPEC 1) =====================
   A monthly payroll run on top of the existing payslips.

   - Payroll tab (sidebar, Payroll group): the runs — Month, Employees, Gross, Deductions,
     Net, Paid, Status (Draft / Accrued / Paid / Partly paid).
   - Run payroll for <month>: every active employee pre-filled from the pay setup on the
     employee record (Payslip Items: earnings, deductions, contributions) -> review grid ->
     Create, which adds one ordinary Payslip per employee dated the last day of the month
     (payslip.payrollRun = run id). Draft runs can be saved and finished later.
   - Accrual basis (FIX_SPEC_4 #3): a posted run posts ONE journal entry on the payroll date from
     its payslips (GL source 'payroll') — Dr salary / allowance expense (current Payslip Items
     accounts), Cr Employee clearing account (net pay, per employee) and the deduction /
     contribution liabilities. A payslip outside a run posts on its own (js/ledger-engine.js).
   - Run payroll dialog (any month), Edit on the run, payslip edits synced back, reconciliation
     badge + Rebuild, History on run and payslip, one-time data update: see "FIX_SPEC_4 #3" below.
   - Pay salaries: bank / cash account + payment date, per-employee amounts (default the
     outstanding net, partial and selected employees allowed, WPS list) -> Payment(s) with
     the employee as payee and a line on Employee clearing account / <employee>, so the
     liability clears. payment.payrollRun links it to the run; the run status follows.
   - Run next month copies the last run. Reminders: "Payroll for <month> not run yet" and
     "Salaries for <month> not fully paid" (window.Reminders, guarded; also shown on the tab).
   - Payroll summary report by month and by employee.
   - FIX_SPEC_5 A: deduction items are Salary deductions (lower the salary cost) or Recoveries (loan / advance: credit an
     asset account per employee, lower net pay only). Grid groups Days | Earnings | Salary deductions | Salary cost |
     Recoveries | Net pay | Employee balance (before / after, from Employee clearing account); recovery > outstanding
     is refused; Settings → Payroll: fixed 30 days and the Absent deduction basis; payslip print sections A–E.

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
    /* FIX_SPEC_5 A3: fixed 30 days; absent deduction basis = Basic only, or Basic + chosen allowances */
    var chosen = s.absentBasis === 'chosen';
    return { basis: working ? 'working' : (s.daysBasis === 'fixed30' ? 'fixed30' : 'calendar'), weekend: w[0], weekendLabel: w[1], wdays: w[2],
      holidays: working && truthy(s.excludeHolidays) ? (s.holidays || []).map(function (h) { return isoDate(h && h.date); }).filter(Boolean) : [],
      absentBasis: chosen ? 'chosen' : 'basic', absentItems: chosen ? (s.absentItems || []).map(lc).filter(Boolean) : [] };
  }
  /** total days in the pay period of a month, from Settings → Payroll */
  function periodDays(b, ym) {
    if (!validYm(ym)) return 0; var s = paySettings(b), p = ym.split('-'), y = +p[0], m = +p[1], n = new Date(y, m, 0).getDate();
    if (s.basis === 'fixed30') return 30;
    if (s.basis !== 'working') return n;
    var c = 0; for (var d = 1; d <= n; d++) { if (s.wdays.indexOf(new Date(y, m - 1, d).getDay()) >= 0 || s.holidays.indexOf(ym + '-' + pad(d)) >= 0) continue; c++; }
    return c;
  }
  function basisLabel(b) { var s = paySettings(b); return s.basis === 'working' ? 'Working days — weekend ' + s.weekendLabel.toLowerCase() + (s.holidays.length ? ', public holidays excluded' : '') : (s.basis === 'fixed30' ? 'Fixed 30 days' : 'Calendar days'); }
  function truthy(v) { return v === true || v === 1 || /^(true|yes|on|1)$/i.test(String(v == null ? '' : v)); }
  function isBasicName(nm) { return /\bbasic\b/i.test(String(nm || '')); }
  /** an earnings item in the absent deduction basis (Basic, plus the allowances chosen in Settings → Payroll) */
  function inAbsentBasis(b, nm) { if (isBasicName(nm)) return true; var s = paySettings(b); return s.absentBasis === 'chosen' && s.absentItems.indexOf(lc(nm)) >= 0; }
  /** 'basic' (in the absent deduction basis) | 'prorata' | '' for a payslip item */
  function proKind(b, sec, itemId, name) {
    if (sec !== 'earnings') return ''; var it = findItem(b, sec, itemId, name), nm = it ? it.name : (name || '');
    if (inAbsentBasis(b, nm)) return 'basic'; return it && truthy(it.proRata) ? 'prorata' : '';
  }
  /* FIX_SPEC_5 A3 — two kinds of deduction items: 'salary' (absent, late, fines: reduces the salary cost) and
     'recovery' (loan / advance repayment: credits a balance-sheet account per employee, lowers net pay only).
     An item saved before the Type existed is a recovery when its account is an asset. */
  function rootOfAcct(b, n) { try { return G('acctRoot')(b, n); } catch (e) { return ''; } }
  function dedType(b, it) { if (!it) return 'salary'; if (it.type === 'recovery' || it.type === 'salary') return it.type;
    var n = acct(b, it.account); return n && !n.control && rootOfAcct(b, n) === 'assets' ? 'recovery' : 'salary'; }
  function isRecoveryAcct(b, n) { return !!n && !n.control && rootOfAcct(b, n) === 'assets'; }
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
    var o = { total: t > 0 ? r2(t) : 0, absent: on ? r2(a) : 0, worked: t > 0 ? r2(on ? t - a : t) : 0, on: on, rows: [], basic: 0, basicEarned: 0, absentDed: 0, absentAcct: '', basicName: '' }, names = [];
    (entries || []).forEach(function (e) {
      var k = e.kind != null ? e.kind : proKind(b, e.sec || 'earnings', e.itemId, e.item), full = r2(num(e.amount)), earned = full;
      if (on && k === 'prorata') earned = r2(full * o.worked / t);
      if (k === 'basic' && full) { o.basic += full; var it = b ? findItem(b, 'earnings', e.itemId, e.item) : null, nm = it ? it.name : (e.item || 'Basic salary');
        if (!names.length) o.absentAcct = it && !blank(it.account) ? String(it.account) : ''; if (names.indexOf(nm) < 0) names.push(nm); }
      o.rows.push({ kind: k, full: full, earned: earned });
    });
    /* FIX_SPEC_5 A3: Absent deduction = (sum of the basis items) ÷ total days × days absent */
    o.basicName = names.length > 1 ? '(' + names.join(' + ') + ')' : (names[0] || '');
    o.basic = r2(o.basic); o.absentDed = on ? r2(o.basic * o.absent / t) : 0; o.basicEarned = r2(o.basic - o.absentDed);
    return o;
  }
  /** the "Absent deduction" payslip line (a salary deduction: credits the basic salary expense account) */
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
  /* FIX_SPEC_4 #3: a payslip is linked to its run by payrollRunId (payrollRun is kept, older data and code read it) */
  function runIdOf(p) { if (!p) return null; if (p.payrollRunId != null && p.payrollRunId !== '') return p.payrollRunId; return p.payrollRun != null && p.payrollRun !== '' ? p.payrollRun : null; }
  function linkTo(p, run) { p.payrollRunId = run.id; p.payrollRun = run.id; }
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
    if (!d.cols.some(function (c) { return c.key === k; })) { var col = { key: k, sec: sec, itemId: id, item: nm, pro: proKind(b, sec, id, nm) }; if (sec === 'deductions') col.rec = dedType(b, it) === 'recovery'; d.cols.push(col); }
    return k;
  }
  function colKind(c) { return c.pro != null ? c.pro : (c.sec === 'earnings' && isBasicName(c.item) ? 'basic' : ''); }
  /** a Recovery (loan / advance) deduction column */
  function isRec(c) { return !!c && c.sec === 'deductions' && c.rec === true; }
  /** fill in what older drafts lack: total days of the month and each column's pro-rata kind */
  function ensureDays(b, d) {
    if (!d) return d;
    if (d.daysTotal == null || d.daysTotal === '') { d.daysTotal = periodDays(b, d.month); d.daysAuto = true; }
    (d.cols || []).forEach(function (c) { c.pro = proKind(b, c.sec, c.itemId, c.item); if (c.sec === 'deductions') c.rec = dedType(b, findItem(b, c.sec, c.itemId, c.item)) === 'recovery'; });
    return d;
  }

  /** a draft copied from a run: posted runs read the payslips (they may have been edited) */
  function draftFromRun(b, run) {
    if (!run) return null;
    if (run.state === 'draft') return { cols: clone(run.cols || []), rows: clone(run.rows || []) };
    var d = { cols: [], rows: [] };
    runPayslips(b, run).forEach(function (p) { d.rows.push(rowFromPayslip(b, d, p)); });
    sortCols(b, d);
    return d;
  }
  /** a grid row from a payslip (columns added to d as needed) */
  function rowFromPayslip(b, d, p) {
    var e = empByName(b, p.employee || p.empName || '');
    var row = { employee: p.employee || p.empName || '', code: (e && e.code) || p.empCode || '', include: true, amt: {}, daysAbsent: num(p.daysAbsent), payslipId: p.id };
    /* monthly amounts: a pro-rated line gives back its full amount; the Absent deduction is derived, not an item */
    (p.lines || []).filter(Boolean).forEach(function (l) { if (l.absent) return; var a = l.proRata && l.fullAmount != null && l.fullAmount !== '' ? Math.abs(num(l.fullAmount)) : lineAmt(l); if (!a) return;
      var k = addCol(b, d, lineSec(l), l.itemId, l.item || l.desc || l.description); row.amt[k] = r2((row.amt[k] || 0) + a); });
    return row;
  }
  function otherPayslip(b, name, ym, runId) {
    return recs(b, 'payslips').filter(function (p) { var rid = runIdOf(p); return p && (p.employee || p.empName) === name && ymOf(p.date || p.issueDate) === ym && String(rid == null ? '' : rid) !== String(runId || 'x') && !(rid != null && runById(b, rid)); })[0] || null;
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
      if (!Object.keys(row.amt).length) row.include = false;   /* FIX_SPEC_5 A2: no message — the row starts unticked */
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
    var t = { earnings: 0, deductions: 0, contributions: 0, salDed: 0, recov: 0, col: {} }, x = rowCalc(d, row), i = 0;
    (d.cols || []).forEach(function (c) { var v = num(row.amt && row.amt[c.key]); if (c.sec === 'earnings') v = x.rows[i++].earned; t.col[c.key] = v; t[c.sec] += v;
      if (c.sec === 'deductions') { if (isRec(c)) t.recov += v; else t.salDed += v; } });
    t.deductions += x.absentDed; t.salDed += x.absentDed;
    t.earnings = r2(t.earnings); t.deductions = r2(t.deductions); t.contributions = r2(t.contributions); t.net = r2(t.earnings - t.deductions);
    /* FIX_SPEC_5 A3: Salary cost = gross − salary deductions (the expense); Net pay = salary cost − recoveries */
    t.salDed = r2(t.salDed); t.recov = r2(t.recov); t.cost = r2(t.earnings - t.salDed);
    t.absentDed = x.absentDed; t.total = x.total; t.absent = x.absent; t.worked = x.worked; return t;
  }
  var SUMK = ['earnings', 'deductions', 'contributions', 'net', 'absentDed', 'salDed', 'recov', 'cost', 'absent', 'worked'];
  function draftTotals(d) {
    var t = { employees: 0 }; SUMK.forEach(function (k) { t[k] = 0; });
    (d.rows || []).forEach(function (row) { if (!row.include) return; var x = rowTotals(d, row); t.employees++;
      ['earnings', 'deductions', 'contributions', 'net', 'absentDed', 'salDed', 'recov', 'cost', 'absent'].forEach(function (k) { t[k] += x[k]; });
      if (!daysError(d.daysTotal, row.daysAbsent)) t.worked += x.total ? x.worked : 0; });
    SUMK.forEach(function (k) { t[k] = r2(t[k]); }); return t;
  }

  /* ---------------------------- FIX_SPEC_5 A4/A5 — loan outstanding and employee balance
     Read from the general ledger, leaving out this run's own journal entry (or this payslip's
     posting), so Create, Edit and the payslip print all see the balance BEFORE this payroll. */
  function excl(L, o) { return (o.runId != null && L.src === 'payroll' && String(L.id) === String(o.runId)) || (o.psId != null && L.src === 'payslips' && String(L.id) === String(o.psId)); }
  /** Dr − Cr of an account for one sub-account: undated (starting balances) plus dated lines up to o.to (o.before: strictly before) */
  function glSub(b, acctId, sub, o) { var g = glOf(b), s = 0; if (!g || blank(acctId)) return 0;
    g.lines.forEach(function (L) { if (L.acct !== acctId || L.sub !== sub || excl(L, o)) return;
      if (L.date && o.before && L.date >= o.before) return; if (L.date && o.to && L.date > o.to) return; s += L.debit - L.credit; });
    return r2(s); }
  /** the employee's loan / advance outstanding on a recovery account up to the payroll date, before this run (debit balance) */
  function loanOs(b, acctId, emp, date, o) { return glSub(b, acctId, emp, Object.assign({ to: date }, o || {})); }
  /** Employee clearing account for the employee up to the day before the payroll date: + payable / − overpaid */
  function empBefore(b, emp, date, o) { var id = empAcctId(b); return id ? -glSub(b, id, emp, Object.assign({ before: date }, o || {})) : 0; }
  function balTxt(v) { return v > 0.004 ? 'Payable ' + money(v) : (v < -0.004 ? 'Overpaid ' + money(-v) : 'Settled'); }
  function balCls(v) { return v > 0.004 ? 'pr-bal-pay' : (v < -0.004 ? 'pr-bal-over' : 'pr-bal-zero'); }
  /** the account of a recovery column (its Payslip Item's account) */
  function recAcct(b, c) { var it = findItem(b, c.sec, c.itemId, c.item); return it ? acct(b, it.account) : null; }
  /** a row's recoveries per account: [{acct, name, amount, os, over}] */
  function rowRecov(b, d, row) {
    var by = {}, out = [];
    (d.cols || []).forEach(function (c) { if (!isRec(c)) return; var a = num(row.amt && row.amt[c.key]); var n = recAcct(b, c); var k = n ? n.id : '';
      if (!by[k]) { by[k] = { acct: n, name: n ? n.name : '', amount: 0, cols: [] }; out.push(by[k]); } by[k].amount = r2(by[k].amount + a); by[k].cols.push(c.key); });
    out.forEach(function (x) { x.os = x.acct ? loanOs(b, x.acct.id, row.employee, d.date, { runId: d.id }) : 0; x.over = x.amount > 0.004 && x.amount - x.os > 0.005; });
    return out;
  }

  function validate(b, d) { return withGl(b, function () { return validate0(b, d); }); }
  function validate0(b, d) {
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
      if (c.sec === 'contributions' && (!acct(b, it.liability) || !acct(b, it.expense))) E.push('Contribution item "' + it.name + '" needs an expense and a liability account (Settings → Payslip Items).');
      if (c.sec === 'deductions' && it.type === 'recovery' && !isRecoveryAcct(b, acct(b, it.account))) E.push('Recovery item "' + it.name + '" must be mapped to an asset or receivable account, such as Employee loans or Salary advances (Settings → Payslip Items).'); });
    /* FIX_SPEC_5 A4: a recovery may not be more than the employee's outstanding loan / advance */
    inc.forEach(function (r) { rowRecov(b, d, r).forEach(function (x) { if (x.over) E.push(r.employee + ': recovery of ' + money(x.amount) + ' is more than the ' + money(x.os) + ' outstanding on ' + (x.name || 'the loan / advance account') + '.'); }); });
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
      if (c.sec === 'deductions' && dedType(b, it) === 'recovery') o.recovery = true;
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
        payrollRun: run.id, payrollRunId: run.id };
      if (t.total > 0) { rec.daysTotal = t.total; rec.daysAbsent = t.absent; rec.daysWorked = t.worked; rec.daysBasis = d.daysAuto === false ? 'manual' : paySettings(b).basis; }
      rec.id = newId(b); rec.uuid = uuid(); ps.push(rec); row.payslipId = rec.id; made.push(rec);
    });
    Object.assign(run, snapshot(d), { state: 'posted', posted: today() }); d.id = run.id;
    run.history = run.history || []; hist(run, 'Run', 'Payroll run created', '', made.length + ' payslip' + (made.length === 1 ? '' : 's'));
    afterChange(b);
    P._busy++; try { made.forEach(function (rec) { logAct(b, 'create', 'payslips', rec, null); }); } finally { P._busy--; }
    logAct(b, before ? 'update' : 'create', 'payroll', run, before);
    return { run: run, payslips: made };
  }

  /* ------------------------------------------------------------ run figures */
  function empAcctId(b) { try { var n = GL.sysAcct(b, 'employee clearing account', false); return n ? n.id : null; } catch (e) { return null; } }
  function isEmpLine(b, l, empId) { if (!l || blank(l.sub)) return false; if (empId && String(l.account) === String(empId)) return true; return /^employee clearing account$/i.test(String(l.accountName || l.accounts || '')); }
  function runPayments(b, run) { return recs(b, 'payments').filter(function (p) { return p && String(p.payrollRun) === String(run.id); }); }
  function runPayslips(b, run) { return recs(b, 'payslips').filter(function (p) { var rid = runIdOf(p); return p && rid != null && String(rid) === String(run.id); }); }
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
    b.records.payslips = recs(b, 'payslips').filter(function (p) { var rid = runIdOf(p); return !(p && rid != null && String(rid) === String(run.id)); });
    b.records.payroll = runs(b).filter(function (r) { return String(r.id) !== String(run.id); });
    afterChange(b);
    if (gone.length) logAct(b, 'delete', 'payslips', null, null, { bulkDeleted: gone, label: 'Payroll ' + monthLabel(run.month) + ' — ' + gone.length + ' payslips deleted' });
    logAct(b, 'delete', 'payroll', run, clone(run));
    return { deleted: gone.length };
  }

  /* =====================================================================================
     FIX_SPEC_4 #3 — edit from the run OR the payslip, everything in sync.
     - Payslips are the source of truth, linked by payrollRunId. Run figures are read from them.
     - One journal entry per run (GL source 'payroll', below): Dr each expense account, Cr each
       deduction / contribution liability, Cr Employee clearing account per employee (net pay).
       js/ledger-engine.js skips the payslips of a posted run, so nothing posts twice, and the
       entry reads the CURRENT Payslip Items accounts, so a mapping change re-posts every run.
     - saveRunEdit: the run's Edit (month, date, description, employee grid, add / remove) is
       built on a copy of the records, validated, then saved in one go.
     - onPayslipSaved / onPayslipDeleted: a payslip edited on its own updates its run (moved to
       the run of its new month, created when missing), history on both.
     - reconcile / rebuild: the ✓ / ⚠ badge and its Rebuild; migrate: the one-time data fix.
     ===================================================================================== */
  P._busy = 0; P._now = null;
  function nowIso() { return P._now || new Date().toISOString(); }
  function who() { var A = app();
    try { var u = A && typeof A.currentUser === 'function' ? A.currentUser() : null; if (u && (u.name || u.username)) return String(u.name || u.username); } catch (e) {}
    try { var n = A._userName(); if (n) return String(n); } catch (e) {} return ''; }
  /** a History entry on a run or payslip: old -> new, where (Run / Payslip), user, time */
  function hist(rec, where, what, from, to) { if (!rec) return; rec.history = rec.history || [];
    rec.history.push({ at: nowIso(), user: who(), where: where, what: what, from: from == null ? '' : String(from), to: to == null ? '' : String(to) });
    if (rec.history.length > 500) rec.history.splice(0, rec.history.length - 500); }
  function empOf(p) { return p ? (p.employee || p.empName || '') : ''; }
  function psById(b, id) { return recs(b, 'payslips').filter(function (p) { return p && String(p.id) === String(id); })[0] || null; }
  function psRef(p) { return 'Payslip ' + (p.reference || '') + (empOf(p) ? ' (' + empOf(p) + ')' : ''); }
  function fmtV(t, v) { if (v === '' || v == null) return ''; if (t === 'money') return money(v); if (t === 'date') return fmtD(v); return String(v); }
  /** what a payslip says, for the History: header fields and the monthly amount of each item */
  function psFacts(p) {
    var o = { 'Date': ['date', String(p.date || p.issueDate || '').slice(0, 10)], 'Employee': ['text', empOf(p)], 'Description': ['text', p.description || p.narration || ''],
      'Total days': ['days', p.daysTotal == null || p.daysTotal === '' ? '' : r2(num(p.daysTotal))], 'Days absent': ['days', r2(num(p.daysAbsent))] };
    (p.lines || []).filter(Boolean).forEach(function (l) { var nm = l.absent ? 'Absent deduction' : (l.item || l.desc || l.description || 'Line');
      var a = l.proRata && l.fullAmount != null && l.fullAmount !== '' ? Math.abs(num(l.fullAmount)) : lineAmt(l); o[nm] = ['money', r2((o[nm] ? o[nm][1] : 0) + a)]; });
    o['Net pay'] = ['money', r2(netOf(p))];
    return o;
  }
  function runFacts(run) { return { 'Month': ['text', monthLabel(run.month)], 'Payroll date': ['date', run.date || ''], 'Description': ['text', run.description || ''] }; }
  function diff(a, c) { var out = [], keys = Object.keys(a); Object.keys(c).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    keys.forEach(function (k) { var x = a[k], y = c[k], t = (x || y)[0], z = t === 'money' ? 0 : '', xv = x ? x[1] : z, yv = y ? y[1] : z;
      var ch = (t === 'money' || t === 'days') ? ((xv === '') !== (yv === '') || Math.abs(num(xv) - num(yv)) > 0.004) : String(xv) !== String(yv);
      if (ch) out.push({ what: k, from: fmtV(t, xv), to: fmtV(t, yv) }); });
    return out; }
  /** what each employee was paid by the run's salary payments {employee: amount} */
  function paidBy(b, run) { var empId = empAcctId(b), o = {};
    runPayments(b, run).forEach(function (p) { (p.lines || []).filter(Boolean).forEach(function (l) { if (!isEmpLine(b, l, empId)) return; o[l.sub] = r2((o[l.sub] || 0) + num(l.amount != null && l.amount !== '' ? l.amount : l.net)); }); });
    return o; }
  /** total days of a run's period: Settings → Payroll for the actual month, unless entered by hand */
  function runDays(b, run) { return run.daysAuto === false && run.daysTotal != null && run.daysTotal !== '' ? r2(num(run.daysTotal)) : periodDays(b, run.month); }
  /** keep the run record's grid copy in step with its payslips (figures never read it for a posted run) */
  function snapRun(b, run) { if (!run || run.state !== 'posted') return; var d = draftFromRun(b, run);
    run.cols = d.cols; run.rows = d.rows.map(function (r) { return { employee: r.employee, code: r.code || '', include: true, note: '', amt: r.amt, daysAbsent: r2(num(r.daysAbsent)), payslipId: r.payslipId }; });
    if (run.daysAuto !== false) run.daysTotal = periodDays(b, run.month); }
  /** lines, totals and days of a payslip from a grid row */
  function setLines(b, d, row, p) {
    var lines = payslipLines(b, d, row), t = rowTotals(d, row);
    p.lines = lines; p.earnings = t.earnings; p.deductions = t.deductions; p.contributions = t.contributions; p.netPay = p.total = p.subtotal = p.amount = p.balanceDue = t.net; p.tax = 0;
    if (t.total > 0) { p.daysTotal = t.total; p.daysAbsent = t.absent; p.daysWorked = t.worked; p.daysBasis = d.daysAuto === false ? 'manual' : paySettings(b).basis; }
    else { delete p.daysTotal; delete p.daysAbsent; delete p.daysWorked; delete p.daysBasis; }
  }
  /** write a payslip from a grid row; keeps its id, reference and custom fields. oldDesc: the run's old description
      (a payslip whose description was changed by hand keeps it) */
  function writePayslip(b, d, row, p, run, oldDesc) {
    var e = empByName(b, row.employee) || {}, desc = d.description || ('Payroll ' + monthLabel(d.month));
    p.date = p.issueDate = d.date; p.employee = p.empName = row.employee; p.empCode = e.code || p.empCode || '';
    var cur = p.description || p.narration || ''; if (blank(cur) || cur === oldDesc || /^Payroll [A-Z][a-z]{2} \d{4}$/.test(cur)) p.description = p.narration = desc;
    setLines(b, d, row, p); if (run) linkTo(p, run); return p;
  }
  /** a payslip's total days changed (month moved, Settings → Payroll): days absent are re-applied to its lines */
  function fixDays(b, p, total) {
    if (p.daysTotal == null || p.daysTotal === '' || p.daysBasis === 'manual' || Math.abs(num(p.daysTotal) - total) < 0.005) return false;
    if (num(p.daysAbsent) > 0) { var d = { cols: [], rows: [], daysTotal: total, daysAuto: true, month: ymOf(p.date), date: p.date }; var row = rowFromPayslip(b, d, p); d.rows.push(row); setLines(b, d, row, p); }
    else { p.daysTotal = total; p.daysWorked = total; p.daysAbsent = 0; p.daysBasis = paySettings(b).basis; }
    return true;
  }
  function relinkPayment(pm, fromYm, toYm) { if (!pm) return; var a = monthLabel(fromYm), z = monthLabel(toYm); pm.payrollMonth = toYm;
    var sw = function (s) { return typeof s === 'string' && a && s.indexOf(a) >= 0 ? s.split(a).join(z) : s; };
    pm.description = sw(pm.description); pm.payee = sw(pm.payee); (pm.lines || []).forEach(function (l) { if (l) { l.desc = sw(l.desc); l.description = sw(l.description); } }); }
  /** salary payments that paid only this employee follow its payslip to another run (when no payslip of the employee is left behind) */
  function movePayments(b, from, to, emp) {
    if (runPayslips(b, from).some(function (p) { return empOf(p) === emp; })) return 0; var empId = empAcctId(b), n = 0;
    runPayments(b, from).forEach(function (pm) { var L = (pm.lines || []).filter(function (l) { return isEmpLine(b, l, empId); });
      if (!L.length || L.some(function (l) { return l.sub !== emp; })) return;
      pm.payrollRun = to.id; relinkPayment(pm, from.month, to.month); n++;
      hist(from, 'Payslip', 'Salary payment ' + (pm.reference || '') + ' re-linked', monthLabel(from.month), monthLabel(to.month)); hist(to, 'Payslip', 'Salary payment ' + (pm.reference || '') + ' re-linked', monthLabel(from.month), monthLabel(to.month)); });
    return n; }
  function newRunFor(b, ym, date) {
    var run = { id: newId(b), uuid: uuid(), created: today(), month: ym, date: date && ymOf(date) === ym ? date : monthEnd(ym), description: 'Payroll ' + monthLabel(ym),
      daysTotal: periodDays(b, ym), daysAuto: true, cols: [], rows: [], state: 'posted', posted: today(), history: [] };
    b.records = b.records || {}; b.records.payroll = (b.records.payroll || []).concat([run]);
    hist(run, 'Payslip', 'Payroll run created', '', 'for a payslip dated in ' + monthLabel(ym));
    return run; }
  function postedRunFor(b, ym) { return runs(b).filter(function (r) { return r.month === ym && r.state === 'posted'; })[0] || null; }

  /** the run's Edit: d = editDraft(...) changed on the page. Returns {run, added, removed, changed} or {errors} */
  function editDraft(b, run) {
    var src = draftFromRun(b, run);
    var d = { id: run.id, editing: true, month: run.month, date: run.date, description: run.description || '', cols: src.cols, rows: src.rows, daysAuto: run.daysAuto !== false };
    d.daysTotal = runDays(b, run);
    d.rows.forEach(function (r) { r._touched = true; });
    d.orig = clone(snapshot(d)); return d;
  }
  function rowSig(r) { var o = {}; Object.keys(r.amt || {}).sort().forEach(function (k) { var v = r2(num(r.amt[k])); if (v) o[k] = v; }); return JSON.stringify([o, r2(num(r.daysAbsent)), r.employee]); }
  function saveRunEdit(b, d) {
    var run0 = runById(b, d.id); if (!run0 || run0.state !== 'posted') return { errors: ['Payroll run not found.'] };
    if (!validYm(d.month)) return { errors: ['Choose the payroll month.'] };
    if (d.daysAuto !== false) d.daysTotal = periodDays(b, d.month);
    var E = validate(b, d);
    var lk = (b && b.lockDate) || ''; if (lk && run0.date && run0.date <= lk) E.push('This run is dated on or before the lock date (' + fmtD(lk) + ') and cannot be changed while the period is locked.');
    var paid = paidBy(b, run0), keep = {};
    d.rows.forEach(function (r) { if (r.include && r.payslipId != null) keep[String(r.payslipId)] = 1; });
    runPayslips(b, run0).forEach(function (p) { if (keep[String(p.id)]) return; var e = empOf(p);
      if ((paid[e] || 0) > 0.004 && !d.rows.some(function (r) { return r.include && r.employee === e; }))
        E.push(e + ' was already paid ' + money(paid[e]) + ' for ' + monthLabel(run0.month) + '. Delete that salary payment first (Payments), or keep the employee in the run.'); });
    if (E.length) return { errors: E };
    var before = clone(run0), res = { added: 0, removed: 0, changed: 0, relinked: 0 };
    P._busy++;
    try {
      /* everything is built on a copy of the records and saved at the end in one go */
      var w = clone(b.records), wb = Object.assign({}, b, { records: w }), run = runById(wb, d.id), ob = {};
      ((d.orig && d.orig.rows) || []).forEach(function (r) { if (r.payslipId != null) ob[String(r.payslipId)] = r; });
      var rf0 = runFacts(run), oldMonth = run.month, oldDesc = run.description || '', oldDays = runDays(wb, run);
      var hdrChanged = oldMonth !== d.month || run.date !== d.date || oldDesc !== (d.description || ''), daysChanged = Math.abs(num(d.daysTotal) - num(oldDays)) > 0.004;
      var gone = runPayslips(wb, run).filter(function (p) { return !keep[String(p.id)]; });
      if (gone.length) { var gid = {}; gone.forEach(function (p) { gid[String(p.id)] = 1; hist(run, 'Run', 'Employee removed', empOf(p) + ' — ' + psRef(p) + ', net ' + money(netOf(p)), ''); });
        w.payslips = (w.payslips || []).filter(function (p) { return !(p && gid[String(p.id)]); }); res.removed = gone.length; }
      Object.assign(run, { month: d.month, date: d.date, description: d.description || '', daysTotal: r2(num(d.daysTotal)), daysAuto: d.daysAuto !== false });
      w.payslips = w.payslips || [];
      d.rows.forEach(function (row) { if (!row.include) return;
        var p = row.payslipId != null ? psById(wb, row.payslipId) : null;
        if (p && String(runIdOf(p)) !== String(run.id)) p = null;
        if (!p) { p = { reference: nextRef(wb, 'payslips') }; p.id = newId(wb); p.uuid = uuid(); w.payslips.push(p); writePayslip(wb, d, row, p, run, oldDesc); row.payslipId = p.id; res.added++;
          hist(run, 'Run', 'Employee added', '', row.employee + ' — ' + psRef(p) + ', net ' + money(netOf(p))); hist(p, 'Run', 'Payslip created from the payroll run', '', monthLabel(d.month)); return; }
        var o = ob[String(p.id)], same = !!o && rowSig(o) === rowSig(row);
        if (same && !hdrChanged && !daysChanged) return;
        var f0 = psFacts(p);
        if (same && !daysChanged) { p.date = p.issueDate = d.date; var cd = p.description || p.narration || ''; if (blank(cd) || cd === oldDesc || /^Payroll [A-Z][a-z]{2} \d{4}$/.test(cd)) p.description = p.narration = d.description || ('Payroll ' + monthLabel(d.month)); }
        else writePayslip(wb, d, row, p, run, oldDesc);
        var ch = diff(f0, psFacts(p)); if (!ch.length) return; res.changed++;
        ch.forEach(function (c) { hist(p, 'Run', c.what, c.from, c.to); hist(run, 'Run', empOf(p) + ' — ' + c.what, c.from, c.to); }); });
      diff(rf0, runFacts(run)).forEach(function (c) { hist(run, 'Run', c.what, c.from, c.to); });
      if (oldMonth !== d.month) runPayments(wb, run).forEach(function (pm) { relinkPayment(pm, oldMonth, d.month); res.relinked++; hist(run, 'Run', 'Salary payment ' + (pm.reference || '') + ' re-linked', monthLabel(oldMonth), monthLabel(d.month)); });
      snapRun(wb, run); run.updated = today();
      b.records.payroll = w.payroll; b.records.payslips = w.payslips; b.records.payments = w.payments;
    } finally { P._busy--; }
    afterChange(b);
    var nr = runById(b, d.id); logAct(b, 'update', 'payroll', nr, before);
    res.run = nr; res.figures = figures(b, nr); return res;
  }

  /** a payslip saved on its own (form, Form Designer, import): link it to the run of its month, history on both */
  function onPayslipSaved(b, id, before) {
    var p = psById(b, id); if (!p) return null;
    var dt = String(p.date || p.issueDate || '').slice(0, 10), ym = ymOf(dt); if (!validYm(ym)) return null;
    var rid = runIdOf(p), old = rid != null ? runById(b, rid) : null; if (old && old.state !== 'posted') old = null;
    var target = old && old.month === ym ? old : postedRunFor(b, ym), created = false;
    if (!target && old) { target = newRunFor(b, ym, dt); created = true; }
    if (!target) return null;                       /* a payslip on its own, in a month without a payroll run */
    P._busy++;
    try {
      linkTo(p, target);
      if (dt !== target.date) { hist(p, 'Payslip', 'Date set to the payroll date', fmtD(dt), fmtD(target.date)); p.date = p.issueDate = target.date; }
      fixDays(b, p, runDays(b, target));
      var emp = empOf(p);
      if (!before) { hist(p, 'Payslip', 'Payslip created', '', monthLabel(ym)); hist(target, 'Payslip', 'Employee added', '', emp + ' — ' + psRef(p) + ', net ' + money(netOf(p))); }
      else diff(psFacts(before), psFacts(p)).forEach(function (c) { hist(p, 'Payslip', c.what, c.from, c.to); hist(target, 'Payslip', emp + ' — ' + c.what, c.from, c.to); });
      if (old && old !== target) { hist(p, 'Payslip', 'Payroll run', monthLabel(old.month), monthLabel(target.month));
        hist(old, 'Payslip', psRef(p) + ' moved to ' + monthLabel(target.month), emp, ''); hist(target, 'Payslip', psRef(p) + ' moved from ' + monthLabel(old.month), '', emp);
        movePayments(b, old, target, emp); snapRun(b, old); }
      snapRun(b, target);
    } finally { P._busy--; }
    afterChange(b);
    return { run: target, created: created, moved: !!(old && old !== target) };
  }
  function onPayslipDeleted(b, before) {
    var rid = runIdOf(before), run = rid != null ? runById(b, rid) : null; if (!run || run.state !== 'posted') return;
    hist(run, 'Payslip', 'Employee removed', empOf(before) + ' — ' + psRef(before) + ', net ' + money(netOf(before)), ''); snapRun(b, run); afterChange(b);
  }
  /** '' or why a payslip may not be deleted: its salary was paid and no other payslip of the employee is left in the run */
  function payslipDeleteBlock(b, p) {
    var rid = runIdOf(p), run = rid != null ? runById(b, rid) : null; if (!run || run.state !== 'posted') return '';
    var emp = empOf(p), paid = paidBy(b, run)[emp] || 0; if (paid <= 0.004) return '';
    if (runPayslips(b, run).some(function (x) { return x.id !== p.id && empOf(x) === emp; })) return '';
    return 'Salary of ' + money(paid) + ' was already paid to ' + emp + ' for ' + monthLabel(run.month) + '. Delete that salary payment first (Payments) — a payment must not point at a deleted payslip.';
  }

  /* ---------------------------------------------------------- run posting */
  function acctNamed(b, name) { var t = lc(name); return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && lc(n.name) === t; })[0] || null; }
  /** the accounts a payslip line posts to, from the CURRENT Payslip Items (the line's own account as the fallback) */
  function lineAccts(b, p, l, sec) {
    var it = findItem(b, sec, l.itemId, l.item);
    if (l.absent) { var bl = (p.lines || []).filter(function (x) { return x && !x.absent && lineSec(x) === 'earnings' && proKind(b, 'earnings', x.itemId, x.item || x.desc) === 'basic'; })[0]; it = bl ? findItem(b, 'earnings', bl.itemId, bl.item) : null; }
    var n = acct(b, it ? (sec === 'contributions' ? it.expense : it.account) : '') || acct(b, l.account) || (blank(l.accountName) ? null : acctNamed(b, l.accountName));
    var o = { a: n ? n.id : '' };
    if (sec === 'contributions') { var la = acct(b, it && it.liability) || acct(b, l.liabilityAccount) || (blank(l.liabilityAccountName) ? null : acctNamed(b, l.liabilityAccountName)); o.l = la ? la.id : ''; }
    return o;
  }
  /** GL source: one journal entry per posted run, on the payroll date */
  function runPosting(b, api) {
    var out = [], recSet = {}; try { recSet = G('GL').recoveryAccts(b) || {}; } catch (e) { recSet = {}; }
    runs(b).forEach(function (run) {
      if (run.state !== 'posted') return; var ps = runPayslips(b, run); if (!ps.length) return;
      var typ = 'Payroll — ' + monthLabel(run.month), agg = {}, order = [], loose = [];
      var add = function (e) { if (!e || !e.v) return; if (!e.a) { loose.push(e); return; } var k = e.a + '|' + (e.s || '') + '|' + (e.v > 0 ? 'd' : 'c') + '|' + (e.t || '');
        if (!agg[k]) { agg[k] = { a: e.a, s: e.s || '', v: 0, t: e.t }; order.push(k); } agg[k].v = r2(agg[k].v + e.v); };
      var sal = function (v, t) { return { a: api.need('salaries'), v: v, t: t }; };
      ps.forEach(function (p) { var emp = empOf(p), net = 0, lns = (p.lines || []).filter(Boolean);
        if (!lns.length) { net = num(p.netPay != null && p.netPay !== '' ? p.netPay : p.total); add(sal(net, typ + ' — earnings')); }
        lns.forEach(function (l) { var a = num(l.amount != null && l.amount !== '' ? l.amount : (l.net != null && l.net !== '' ? l.net : l.amountNoTax)); if (!a) return;
          var sec = lineSec(l), x = lineAccts(b, p, l, sec), v = Math.abs(a), sub = blank(l.sub) ? '' : String(l.sub);
          if (sec === 'contributions') { add(x.a ? api.acctEnt(x.a, sub, v, { t: typ + ' — employer contributions' }) : sal(v, typ + ' — employer contributions'));
            add(x.l ? api.acctEnt(x.l, '', -v, { t: typ + ' — contributions payable' }) : { a: null, v: -v, why: 'contribution "' + (l.item || '') + '" has no liability account' }); return; }
          if (sec === 'deductions') { net -= v;
            /* FIX_SPEC_5 A6: a recovery credits the loan / advance account for the employee (never the P&L) */
            var rec = !!x.a && recSet[x.a]; if (rec && !sub) sub = emp;
            add(x.a ? api.acctEnt(x.a, sub, -v, { t: typ + (rec ? ' — recoveries' : ' — deductions') }) : sal(-v, typ + ' — deductions')); }
          else { net += v; add(x.a ? api.acctEnt(x.a, sub, v, { t: typ + ' — earnings' }) : sal(v, typ + ' — earnings')); } });
        net = r2(net);
        if (net) add(blank(emp) ? { a: null, v: -net, why: 'payslip ' + (p.reference || '') + ' has no employee' } : { a: api.need('employee clearing account'), s: emp, v: -net, t: 'Net pay — ' + emp }); });
      out.push({ meta: { src: 'payroll', id: run.id, date: run.date, ref: 'Payroll ' + monthLabel(run.month), type: typ, desc: run.description || typ },
        ents: order.map(function (k) { return agg[k]; }).concat(loose) });
    });
    return out;
  }
  function registerPosting() { var GLx = G('GL'); try { if (GLx && typeof GLx.registerSource === 'function') GLx.registerSource('payroll', runPosting); } catch (e) {} }

  /* ------------------------------------------------- reconciliation & rebuild */
  var GLM = null;   /* the ledger, read once while a grid is drawn / checked (FIX_SPEC_5: balances per row) */
  function glOf(b) { if (GLM && GLM.b === b) return GLM.g; var GLx = G('GL'); try { return GLx ? GLx.get(b) : null; } catch (e) { return null; } }
  function withGl(b, fn) { if (GLM && GLM.b === b) return fn(); var prev = GLM; GLM = { b: b, g: null }; GLM.g = (function () { var GLx = G('GL'); try { return GLx ? GLx.get(b) : null; } catch (e) { return null; } })(); try { return fn(); } finally { GLM = prev; } }
  /** {ok, reasons[]}: payslips = run, run = journal, net − payments = outstanding, Employee clearing = outstanding */
  function reconcile(b, run) {
    var R = { ok: true, reasons: [] }; if (!run || run.state !== 'posted') return R;
    var add = function (m) { R.reasons.push(m); }, f = figures(b, run), ps = runPayslips(b, run), days = runDays(b, run), ids = {};
    ps.forEach(function (p) { ids[String(p.id)] = 1; var n = netOf(p), lbl = psRef(p), dt = String(p.date || p.issueDate || '').slice(0, 10);
      if (p.netPay != null && p.netPay !== '' && Math.abs(num(p.netPay) - n) > 0.005) add(lbl + ': saved net pay ' + money(p.netPay) + ' differs from its lines (' + money(n) + ').');
      if (ymOf(dt) !== run.month) add(lbl + ' is dated ' + fmtD(dt) + ', outside ' + monthLabel(run.month) + '.');
      else if (dt !== run.date) add(lbl + ' is dated ' + fmtD(dt) + ', not on the payroll date ' + fmtD(run.date) + '.');
      if (p.daysTotal != null && p.daysTotal !== '' && p.daysBasis !== 'manual' && Math.abs(num(p.daysTotal) - days) > 0.004) add(lbl + ' counts ' + r2(num(p.daysTotal)) + ' days in the period; ' + monthLabel(run.month) + ' has ' + days + ' (Settings → Payroll).'); });
    (run.rows || []).forEach(function (r) { if (r && r.include !== false && r.payslipId != null && !ids[String(r.payslipId)]) add(r.employee + ': the payslip of this run is missing (deleted or unlinked).'); });
    var gl = glOf(b), empId = empAcctId(b);
    if (gl && ps.length && Math.abs(f.net) > 0.004) {
      var tx = gl.txs.filter(function (t) { return t.src === 'payroll' && String(t.id) === String(run.id); })[0];
      if (!tx) add('No journal entry is posted for this run.');
      else { var jn = r2(tx.lines.filter(function (L) { return empId && L.acct === empId; }).reduce(function (s, L) { return s + L.credit - L.debit; }, 0));
        if (Math.abs(jn - f.net) > 0.005) add('The journal credits ' + money(jn) + ' to Employee clearing account; the run’s net pay is ' + money(f.net) + '.');
        if (tx.date !== run.date) add('The journal is dated ' + fmtD(tx.date) + ', not on the payroll date ' + fmtD(run.date) + '.');
        if (tx.problems && tx.problems.length) add('Journal: ' + tx.problems.join('; ') + '.'); } }
    var pd = paidBy(b, run), tot = 0; Object.keys(pd).forEach(function (k) { tot += pd[k]; }); tot = r2(tot);
    if (Math.abs(tot - f.paid) > 0.005) add('Salary payments of ' + money(tot) + ' are linked to this run, but only ' + money(f.paid) + ' is for employees with a payslip in it.');
    if (Math.abs(r2(f.net - f.paid) - f.outstanding) > 0.005) add('Net pay − payments (' + money(r2(f.net - f.paid)) + ') ≠ Outstanding (' + money(f.outstanding) + ').');
    if (gl && empId) { var pids = {}, cl = 0; f.payments.forEach(function (p) { pids[String(p.id)] = 1; });
      gl.lines.forEach(function (L) { if (L.acct !== empId) return; if ((L.src === 'payroll' && String(L.id) === String(run.id)) || (L.src === 'payments' && pids[String(L.id)])) cl += L.credit - L.debit; });
      cl = r2(cl); var exp = r2(f.net - tot);
      if (Math.abs(cl - exp) > 0.005) add('Employee clearing account shows ' + money(cl) + ' owed for this run; Outstanding is ' + money(exp) + '.'); }
    R.ok = !R.reasons.length; return R;
  }
  /** the whole Employee clearing account against the outstanding of every run (payslips / payments outside runs explain any difference) */
  function clearingCheck(b) {
    var empId = empAcctId(b), bal = 0, out = 0, gl = glOf(b);
    if (gl && empId) gl.lines.forEach(function (L) { if (L.acct === empId) bal += L.credit - L.debit; });
    runs(b).forEach(function (r) { if (r.state === 'posted') out += figures(b, r).outstanding; });
    bal = r2(bal); out = r2(out); return { balance: bal, outstanding: out, diff: r2(bal - out) };
  }
  /** put a run right: links, dates, days, saved net pay, payment months; the journal is re-posted from the records */
  function rebuild(b, runId, opts) {
    opts = opts || {}; var run = runById(b, runId); if (!run || run.state !== 'posted') return { errors: ['Payroll run not found.'] };
    var fixes = [], where = 'Run'; P._busy++;
    try {
      run.history = run.history || [];
      (run.rows || []).forEach(function (r) { if (r.payslipId == null) return; var p = psById(b, r.payslipId); if (p && runIdOf(p) == null) { linkTo(p, run); fixes.push(psRef(p) + ' linked to the run'); } });
      var days = runDays(b, run); if (run.daysAuto !== false) run.daysTotal = days;
      runPayslips(b, run).slice().forEach(function (p) {
        var dt = String(p.date || p.issueDate || '').slice(0, 10), ym = ymOf(dt), emp = empOf(p);
        if (validYm(ym) && ym !== run.month) {
          var t = postedRunFor(b, ym) || newRunFor(b, ym, dt); linkTo(p, t); if (dt !== t.date) p.date = p.issueDate = t.date; fixDays(b, p, runDays(b, t));
          hist(run, where, psRef(p) + ' moved to ' + monthLabel(ym), emp, ''); hist(t, where, psRef(p) + ' moved from ' + monthLabel(run.month), '', emp); hist(p, where, 'Payroll run', monthLabel(run.month), monthLabel(ym));
          movePayments(b, run, t, emp); snapRun(b, t); fixes.push(psRef(p) + ' moved to ' + monthLabel(ym)); return; }
        if (dt !== run.date) { hist(p, where, 'Date', fmtD(dt), fmtD(run.date)); fixes.push(psRef(p) + ': date ' + fmtD(dt) + ' → ' + fmtD(run.date)); p.date = p.issueDate = run.date; }
        var f0 = psFacts(p), d0 = p.daysTotal;
        if (fixDays(b, p, days)) { diff(f0, psFacts(p)).forEach(function (c) { hist(p, where, c.what, c.from, c.to); }); fixes.push(psRef(p) + ': total days ' + d0 + ' → ' + days); }
        var n = netOf(p); if (p.netPay != null && p.netPay !== '' && Math.abs(num(p.netPay) - n) > 0.005) { hist(p, where, 'Net pay (saved)', money(p.netPay), money(n)); fixes.push(psRef(p) + ': net pay ' + money(p.netPay) + ' → ' + money(n)); }
        if (p.netPay == null || p.netPay === '' || Math.abs(num(p.netPay) - n) > 0.005) { p.netPay = p.total = p.subtotal = p.amount = p.balanceDue = n; } });
      runPayments(b, run).forEach(function (pm) { if (pm.payrollMonth !== run.month) { var fm = pm.payrollMonth; relinkPayment(pm, fm || run.month, run.month); if (fm) fixes.push('Payment ' + (pm.reference || '') + ' re-linked to ' + monthLabel(run.month)); } });
      snapRun(b, run);
      if (fixes.length) hist(run, where, opts.label || 'Rebuild', '', fixes.join('; ')); else if (!opts.quiet) hist(run, where, opts.label || 'Rebuild', '', 'Nothing to fix — journal re-posted from the payslips');
    } finally { P._busy--; }
    afterChange(b);
    return { fixes: fixes, run: run };
  }
  /** one-time, idempotent data fix on opening a business (FIX_SPEC_4 #3.8) */
  var MIG = 1;
  function migrate(b) {
    if (!b || !b.records || num(b.payrollSync) >= MIG) return false;
    var rs = runs(b).filter(function (r) { return r.state === 'posted'; });
    if (rs.length) {
      P._busy++;
      try {
        rs.forEach(function (run) { recs(b, 'payslips').forEach(function (p) { if (p && (p.payrollRunId == null || p.payrollRunId === '') && p.payrollRun != null && String(p.payrollRun) === String(run.id)) p.payrollRunId = run.id; }); });
        rs.forEach(function (run) { rebuild(b, run.id, { quiet: true, label: 'Data update (FIX 4)' }); });
      } finally { P._busy--; }
    }
    b.payrollSync = MIG; return true;
  }
  /** earnings items without an expense account (they post to Salaries) */
  function itemsNoAccount(b) { return items(b, 'earnings').filter(function (it) { return !acct(b, it.account); }); }

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

  /* ---- FIX_SPEC_4 #3: reconciliation badge, Payslip Items warning, History, Run payroll dialog ---- */
  function recBadge(rc, short) {
    if (rc.ok) return '<span class="pr-rec pr-rec-ok" title="Payslips = run totals = journal; net pay − payments = Outstanding = Employee clearing account">✓ Reconciled</span>';
    return '<span class="pr-rec pr-rec-bad" title="' + esc(rc.reasons.join('\n')) + '">⚠ Mismatch' + (short ? ' (' + rc.reasons.length + ')' : '') + '</span>';
  }
  function itemsWarn(b) {
    var L = itemsNoAccount(b); if (!L.length) return '';
    return '<div class="info-bar pr-warnbar" role="status"><b>Payslip Items without an expense account:</b> ' + L.map(function (x) { return esc(x.name); }).join(', ') +
      '. Their amounts post to <i>Salaries</i> until you choose an account. <a class="led-link" onclick="Payroll.ui.items(\'earnings\')">Settings → Payslip Items</a></div>';
  }
  function clearingNote(b) {
    if (!runs(b).some(function (r) { return r.state === 'posted'; })) return ''; var c = clearingCheck(b); if (Math.abs(c.diff) <= 0.005) return '';
    return '<div class="info-bar pr-hint">Employee clearing account balance ' + money(c.balance) + ' · outstanding of all payroll runs ' + money(c.outstanding) + ' — the difference of ' + money(c.diff) + ' comes from payslips, payments or starting balances outside the payroll runs.</div>';
  }
  function histTable(H) {
    H = (H || []).slice().reverse();
    if (!H.length) return '<div class="reg-empty">No changes recorded yet.</div>';
    return '<div class="tbl-scroll"><table class="reg-tbl pr-tbl pr-hist"><thead><tr><th>Date / time</th><th>User</th><th>Edited in</th><th>Change</th><th>Old value</th><th>New value</th></tr></thead><tbody>' +
      H.map(function (h) { var t = String(h.at || ''); var when = t ? fmtD(t.slice(0, 10)) + ' ' + t.slice(11, 16) : '';
        return '<tr><td class="nw">' + esc(when) + '</td><td>' + esc(h.user || '') + '</td><td>' + esc(h.where || '') + '</td><td>' + esc(h.what || '') + '</td><td class="m">' + esc(h.from || '') + '</td><td class="m">' + esc(h.to || '') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function outLabel(v) { return v < -0.004 ? 'Recoverable (advance)' : 'Outstanding'; }
  function outMoney(v) { return v < -0.004 ? money(-v) : money(v); }
  /** the Run payroll dialog: month (any), payroll date (month end), description; a month that has a run is refused with a link */
  function startHtml(b) {
    var s = UI.startState || (UI.startState = startInit(b)), ex = validYm(s.month) ? runForMonth(b, s.month) : null;
    var dup = ex ? '<div class="tf-errbox pr-err" role="alert">A payroll run for ' + esc(monthLabel(s.month)) + ' already exists' + (ex.state === 'draft' ? ' (draft)' : '') + '. <a class="led-link" onclick="Payroll.ui.open(' + esc(JSON.stringify(ex.id)) + ')">Open Payroll ' + esc(monthLabel(s.month)) + '</a></div>' : '';
    return crumb([['Payroll', 'Payroll.ui.list()'], ['Run payroll']]) +
      '<div class="pr-dlg-wrap"><div class="card pr-card pr-dlg" id="prStart" role="dialog" aria-label="Run payroll"><div class="pr-card-h"><h2>Run payroll</h2></div>' + errBox() + dup +
      '<div class="pr-fields pr-dlg-f"><label class="pr-f"><span>Month / year</span><input class="pr-in" type="month" id="prStMonth" value="' + esc(s.month) + '" onchange="Payroll.ui.startHdr(\'month\',this.value)"></label>' +
      '<label class="pr-f"><span>Payroll date</span><input class="pr-in" type="date" id="prStDate" value="' + esc(s.date) + '" onchange="Payroll.ui.startHdr(\'date\',this.value)"></label>' +
      '<label class="pr-f pr-f-w"><span>Description</span><input class="pr-in pr-in-w" type="text" id="prStDesc" value="' + esc(s.description) + '" oninput="Payroll.ui.startHdr(\'description\',this.value)"></label></div>' +
      '<div class="pr-sub">' + esc(monthLabel(s.month)) + ': ' + periodDays(b, s.month) + ' days in the period (' + esc(basisLabel(b)) + '). Every active employee is filled in from the pay setup on the next screen.</div>' +
      '<div class="form-actions"><button class="btn btn-primary" onclick="Payroll.ui.startGo()"' + (ex ? ' disabled' : '') + '>Continue</button><button class="btn" onclick="Payroll.ui.list()">Cancel</button></div></div></div>';
  }
  /** under the payslip View: its payroll run and the History tab */
  function payslipExtraHtml(b, p) {
    var rid = runIdOf(p), run = rid != null ? runById(b, rid) : null, h = '<div class="pr-psx">';
    if (run) { var f = figures(b, run), row = f.rows.filter(function (r) { return r.payslip && String(r.payslip.id) === String(p.id); })[0];
      h += '<div class="info-bar pr-hint">Part of <a class="led-link" onclick="Payroll.ui.goRun(' + esc(JSON.stringify(run.id)) + ')">Payroll ' + esc(monthLabel(run.month)) + '</a> (' + esc(fmtD(run.date)) + '). ' +
        'Changes here update the run, its journal entry, WPS and the employee balance.' + (row && row.paid > 0.004 ? ' Paid ' + money(row.paid) + ' · ' + outLabel(row.outstanding).toLowerCase() + ' ' + outMoney(row.outstanding) + '.' : '') + '</div>'; }
    h += '<details class="pr-pshist"' + ((p.history || []).length ? '' : '') + '><summary>History' + ((p.history || []).length ? ' (' + p.history.length + ')' : '') + '</summary>' + histTable(p.history) + '</details></div>';
    return h;
  }
  /** the payslip form warns when the salary was already paid */
  function wrapPayslipForm() {
    var F = G('SettingsFixesA'); F = F && F.ps; if (!F || F._payroll || typeof F.html !== 'function') return; F._payroll = 1;
    var oh = F.html; F.html = function (b) { var h = oh.apply(this, arguments);
      try { var t = F.state(), p = t && t.id != null ? psById(b, t.id) : null, rid = runIdOf(p), run = rid != null ? runById(b, rid) : null;
        if (run && run.state === 'posted') { var paid = paidBy(b, run)[empOf(p)] || 0;
          var note = '<div class="info-bar ' + (paid > 0.004 ? 'pr-warnbar' : 'pr-hint') + '" role="status">' + (paid > 0.004 ? '<b>Salary already paid.</b> Changing it will create an outstanding difference (' + money(paid) + ' paid). ' : '') +
            'This payslip is part of Payroll ' + esc(monthLabel(run.month)) + ' — saving updates the run, its journal entry and WPS. A date in another month moves it to that month’s run.</div>';
          h = h.replace('<div id="psErr"></div>', note + '<div id="psErr"></div>'); } } catch (e) {}
      return h; };
  }
  function startInit(b) { var ym = nextMonth(b); return { month: ym, date: monthEnd(ym), description: 'Payroll ' + monthLabel(ym) }; }

  /* ---- list ---- */
  function listHtml(b) {
    var rs = runs(b).slice().sort(function (x, y) { return String(y.month).localeCompare(String(x.month)); });
    var nm = nextMonth(b), last = lastRun(b);
    var actions = '';
    if (can('canCreate', 'Payroll')) {
      actions = '<button class="btn btn-primary btn-xs" onclick="Payroll.ui.start()" title="Choose the month (next unprocessed: ' + esc(monthLabel(nm)) + '), payroll date and description">Run payroll</button>' +
        (last && last.state === 'posted' && !runForMonth(b, addMonths(last.month, 1)) ? '<button class="btn btn-xs" onclick="Payroll.ui.runNext()" title="Copy ' + esc(monthLabel(last.month)) + ' into ' + esc(monthLabel(addMonths(last.month, 1))) + '">Run next month</button>' : '');
    }
    var body = rs.map(function (r) { var f = figures(b, r);
      return '<tr class="pr-click" onclick="Payroll.ui.open(' + JSON.stringify(r.id) + ')"><td class="nw"><a class="led-link">' + esc(monthLabel(r.month)) + '</a></td><td class="nw">' + esc(fmtD(r.date)) + '</td><td class="r">' + f.employees + '</td>' +
        '<td class="m r">' + money(f.gross) + '</td><td class="m r">' + money(f.deductions) + '</td><td class="m r bold">' + money(f.net) + '</td><td class="m r">' + (r.state === 'draft' ? '' : money(f.paid)) + '</td><td>' + stBadge(f.status) + '</td>' +
        '<td>' + (r.state === 'draft' ? '' : recBadge(reconcile(b, r), true)) + '</td></tr>'; }).join('');
    var emps = employees(b).filter(empActive), noSetup = emps.filter(function (e) { return !hasSetup(e); });
    var hint = !emps.length ? '<div class="info-bar">Add your employees first (Payroll → Employees), with their pay setup, then run payroll here.</div>'
      : (noSetup.length ? '<div class="info-bar pr-hint">' + noSetup.length + ' of ' + emps.length + ' active employee' + (emps.length === 1 ? '' : 's') + ' ' + (noSetup.length === 1 ? 'has' : 'have') + ' no pay setup yet (' + noSetup.slice(0, 4).map(function (e) { return esc(e.name); }).join(', ') + (noSetup.length > 4 ? ', …' : '') + '). Open the employee → <b>Pay setup</b> so payroll can fill in their salary.</div>' : '');
    return crumb([['Payroll']]) +
      '<div class="reg-panel-head lt-head pr-head"><div class="lt-head-l"><span class="reg-panel-title">Payroll</span>' + actions + '</div>' +
      '<div class="pr-head-r"><button class="btn btn-xs" onclick="Payroll.ui.report()">Payroll summary</button></div></div>' +
      remStrip(reminders(b)) + hint + itemsWarn(b) + clearingNote(b) +
      '<div class="tbl-scroll"><table class="reg-tbl lt-tbl pr-tbl"><thead><tr><th>Month</th><th>Date</th><th class="r">Employees</th><th class="r">Gross</th><th class="r">Deductions</th><th class="r">Net pay</th><th class="r">Paid</th><th>Status</th><th>Reconciliation</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="9"><div class="reg-empty">No payroll runs yet. Click <b>Run payroll</b>, choose the month, and every employee’s payslip is created in one go.</div></td></tr>') + '</tbody></table></div>' +
      '<div class="reg-foot"><span class="cnt">' + rs.length + ' ' + (rs.length === 1 ? 'run' : 'runs') + '</span></div>';
  }

  /* ---- review grid ----
     FIX_SPEC_3 #2: every item column is at least 110px (FIX_SPEC_5) and grows with its content; the grid
     scrolls sideways inside its own box (never the page); the tick + Employee columns stick
     to the left and Net pay to the right; long item names wrap to two lines and keep the full
     name as a tooltip. The table's min-width comes from the column count and is redrawn on
     every add / remove. #1: the "Add item column" control is always there — disabled with
     "All items added" once every payslip item is a column, enabled again when one is removed. */
  var COL_MIN = 110;
  function cellIn(ri, key, v, bad) { return '<input type="text" inputmode="decimal" class="pr-num' + (bad ? ' pr-bad' : '') + '"' + (bad ? ' aria-invalid="true" title="' + esc(bad) + '"' : '') + ' data-pr-cell="' + ri + '|' + esc(key) + '" value="' + (num(v) ? esc(String(v)) : '') + '" oninput="Payroll.ui.cell(' + ri + ',' + esc(JSON.stringify(key)) + ',this.value)">'; }
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
  /* FIX_SPEC_5 A1/A2/A4/A5 — the grid:
       [✓] | Employee | Days (Total, Absent, Worked) | Earnings (items…, Gross) | Salary deductions (Absent ded., items…, Total)
       | Salary cost | Recoveries – loan / advance (items…, Total) | Employer contributions | Net pay | Employee balance (Before, After)
     Every th / td stays display:table-cell (a flex cell makes the browser drop rowspan and shifts the second header
     row one column left); centring is done by an inner <div>. Calculated values are plain read-only numbers. */
  function recLbl(c) { return /advance/i.test(c.item || '') ? 'Advance o/s' : 'Loan o/s'; }
  function balLink(b, emp, v, key) { return '<a class="led-link pr-bal-l ' + balCls(v) + '"' + (key ? ' data-pr-bal="' + key + '"' : '') + ' title="Open the ledger of ' + esc(emp) + '" onclick="Payroll.ui.empLedger(' + esc(JSON.stringify(emp)) + ')">' + esc(balTxt(v)) + '</a>'; }
  /** the employee balance before this payroll for every row: [number] (also kept for refreshTotals) */
  function rowsBefore(b, d) { var o = []; d.rows.forEach(function (r, i) { o[i] = empBefore(b, r.employee, d.date, { runId: d.id }); }); d._before = o; return o; }
  function reviewHtml(b) { return withGl(b, function () { return reviewHtml0(b); }); }
  function reviewHtml0(b) {
    var d = UI.draft; if (!d) return listHtml(b); ensureDays(b, d);
    var T = draftTotals(d), S = colSums(d), ctl = addColCtl(b, d), n = d.cols.length, BF = rowsBefore(b, d);
    var E = d.cols.filter(function (c) { return c.sec === 'earnings'; }), SD = d.cols.filter(function (c) { return c.sec === 'deductions' && !isRec(c); }),
      RC = d.cols.filter(isRec), C = d.cols.filter(function (c) { return c.sec === 'contributions'; });
    var nE = E.length + 1, nD = SD.length + 2, nR = RC.length ? RC.length + 1 : 0;
    var ncols = 2 + 3 + nE + nD + 1 + nR + C.length + 1 + 2;
    var grp = function (c) { return isRec(c) ? 'recov' : c.sec; };
    var colHead = function (c, first) { var pk = colKind(c), tip = c.item + (pk === 'prorata' ? ' — pro-rata: (monthly ÷ total days) × days worked' : (pk === 'basic' ? ' — in the absent deduction basis' : '')) + (isRec(c) ? ' — recovery: lowers net pay, not the salary cost' : '');
      return '<th class="r pr-col pr-gx-' + grp(c) + (first ? ' pr-gs' : '') + '" title="' + esc(tip) + '"><div class="pr-th"><span class="pr-th-t">' + esc(c.item) + '</span>' +
        '<button type="button" class="pr-x" title="Remove this column" aria-label="Remove ' + esc(c.item) + '" onclick="Payroll.ui.dropCol(' + esc(JSON.stringify(c.key)) + ')">×</button></div>' + (pk === 'prorata' ? '<em class="pr-pro">pro-rata</em>' : '') + '</th>'; };
    var allOn = d.rows.length && d.rows.every(function (r) { return r.include; });
    var g1 = '<th class="pr-chk pr-stk pr-stk-l0" rowspan="2"><div class="pr-cc"><input type="checkbox" aria-label="Tick all" title="Tick all" onchange="Payroll.ui.incAll(this.checked)"' + (allOn ? ' checked' : '') + '></div></th>' +
      '<th class="pr-emp pr-stk pr-stk-l1" rowspan="2">Employee</th>' +
      '<th class="pr-grp pr-gx-days pr-gs" colspan="3">Days</th>' +
      '<th class="pr-grp pr-gx-earnings pr-gs" colspan="' + nE + '">Earnings</th>' +
      '<th class="pr-grp pr-gx-deductions pr-gs" colspan="' + nD + '" title="Absent, late, fines: reduce the salary cost">Salary deductions</th>' +
      '<th class="r pr-cost pr-gx-cost pr-gs" rowspan="2" title="Gross earnings − salary deductions: the salary expense">Salary cost</th>' +
      (nR ? '<th class="pr-grp pr-gx-recov pr-gs" colspan="' + nR + '" title="Loan / advance repayments: credit the employee’s loan or advance account, lower net pay only">Recoveries – loan / advance</th>' : '') +
      (C.length ? '<th class="pr-grp pr-gx-contributions pr-gs" colspan="' + C.length + '">Employer contributions</th>' : '') +
      '<th class="r pr-net pr-stk pr-stk-r pr-gs" rowspan="2">Net pay</th>' +
      '<th class="pr-grp pr-gx-bal pr-gs pr-stk pr-stk-rg" colspan="2" title="Employee clearing account: before = up to the day before the payroll date; after = before + net pay">Employee balance</th>';
    var g2 = '<th class="r pr-day pr-gx-days pr-gs" title="Total days in the period">Total</th><th class="r pr-day pr-gx-days" title="Days absent (enter)">Absent</th><th class="r pr-day pr-gx-days" title="Days worked = total − absent">Worked</th>' +
      E.map(function (c, i) { return colHead(c, i === 0); }).join('') + '<th class="r pr-gx-earnings pr-sum">Gross</th>' +
      '<th class="r pr-gx-deductions pr-gs" title="(Absent deduction basis ÷ total days) × days absent">Absent ded.</th>' + SD.map(function (c) { return colHead(c, false); }).join('') + '<th class="r pr-gx-deductions pr-sum">Total</th>' +
      (nR ? RC.map(function (c, i) { return colHead(c, i === 0); }).join('') + '<th class="r pr-gx-recov pr-sum">Total</th>' : '') +
      C.map(function (c, i) { return colHead(c, i === 0); }).join('') +
      '<th class="r pr-gx-bal pr-bal pr-stk pr-stk-b1 pr-gs" title="Up to the day before the payroll date">Before payroll</th><th class="r pr-gx-bal pr-bal pr-stk pr-stk-b2" title="Before + net pay of this run">After payroll</th>';
    var amt = function (i, r, t, c, first) { return '<td class="r pr-col pr-gx-' + grp(c) + (first ? ' pr-gs' : '') + '">' + cellIn(i, c.key, r.amt[c.key]) + (colKind(c) === 'prorata' ? '<div class="pr-earned" data-pr-e="' + i + '|' + esc(c.key) + '">' + proHint(d, t, c) + '</div>' : '') + '</td>'; };
    var rows = d.rows.map(function (r, i) { var t = rowTotals(d, r), bad = daysError(d.daysTotal, r.daysAbsent), rv = rowRecov(b, d, r), after = r2(BF[i] + (r.include ? t.net : 0));
      var osOf = function (c) { return rv.filter(function (x) { return x.cols.indexOf(c.key) >= 0; })[0] || { os: 0, over: false }; };
      var amtR = function (c, first) { var x = osOf(c); return '<td class="r pr-col pr-gx-recov' + (first ? ' pr-gs' : '') + '">' + cellIn(i, c.key, r.amt[c.key], x.over ? 'Recovery is more than the ' + money(x.os) + ' outstanding' : '') +
        '<div class="pr-os' + (x.over ? ' pr-os-bad' : '') + '" data-pr-os="' + i + '|' + esc(c.key) + '">' + esc(recLbl(c)) + ': ' + money(x.os) + '</div></td>'; };
      return '<tr class="' + (r.include ? '' : 'pr-off') + (after < -0.004 ? ' pr-overpaid' : '') + '" data-pr-row="' + i + '">' +
        '<td class="pr-chk pr-stk pr-stk-l0"><div class="pr-cc"><input type="checkbox" aria-label="Include ' + esc(r.employee) + '"' + (r.include ? ' checked' : '') + ' onchange="Payroll.ui.inc(' + i + ',this.checked)"></div></td>' +
        '<td class="pr-emp pr-stk pr-stk-l1"' + (r.note ? ' title="' + esc(r.employee + ' — ' + r.note) + '"' : ' title="' + esc(r.employee) + '"') + '><div class="pr-emp-i"><b>' + esc(r.employee) + '</b>' + (r.code ? '<span class="pr-code">' + esc(r.code) + '</span>' : '') +
          (d.editing ? '<button type="button" class="pr-x pr-rm" title="Remove this employee from the run" aria-label="Remove ' + esc(r.employee) + '" onclick="Payroll.ui.rmEmp(' + i + ')">×</button>' + (r.payslipId == null ? '<span class="pr-new">new</span>' : '') : '') + '</div></td>' +
        '<td class="m r pr-day pr-ro pr-gx-days pr-gs" data-pr-t="' + i + ':total">' + esc(String(t.total || num(d.daysTotal) || '')) + '</td>' +
        '<td class="r pr-day pr-gx-days"><input type="text" inputmode="decimal" class="pr-num pr-days' + (bad ? ' pr-bad' : '') + '" data-pr-abs="' + i + '" aria-label="Days absent — ' + esc(r.employee) + '"' + (bad ? ' aria-invalid="true" title="' + esc(bad) + '"' : '') +
          ' value="' + (num(r.daysAbsent) ? esc(String(r.daysAbsent)) : '') + '" placeholder="0" oninput="Payroll.ui.days(' + i + ',this.value)"></td>' +
        '<td class="m r pr-day pr-ro pr-gx-days" data-pr-t="' + i + ':worked">' + esc(bad ? '—' : String(t.total ? t.worked : '')) + '</td>' +
        E.map(function (c, k) { return amt(i, r, t, c, k === 0); }).join('') + '<td class="m r pr-ro pr-gx-earnings pr-sum" data-pr-t="' + i + ':earnings">' + money(t.earnings) + '</td>' +
        '<td class="m r pr-ro pr-gx-deductions pr-gs" data-pr-t="' + i + ':absentDed">' + money(t.absentDed) + '</td>' + SD.map(function (c) { return amt(i, r, t, c, false); }).join('') +
        '<td class="m r pr-ro pr-gx-deductions pr-sum" data-pr-t="' + i + ':salDed">' + money(t.salDed) + '</td>' +
        '<td class="m r bold pr-ro pr-cost pr-gx-cost pr-gs" data-pr-t="' + i + ':cost">' + money(t.cost) + '</td>' +
        (nR ? RC.map(function (c, k) { return amtR(c, k === 0); }).join('') + '<td class="m r pr-ro pr-gx-recov pr-sum" data-pr-t="' + i + ':recov">' + money(t.recov) + '</td>' : '') +
        C.map(function (c, k) { return amt(i, r, t, c, k === 0); }).join('') +
        '<td class="m r bold pr-net pr-stk pr-stk-r pr-gs" data-pr-t="' + i + ':net">' + money(t.net) + '</td>' +
        '<td class="m r pr-gx-bal pr-bal pr-stk pr-stk-b1 pr-gs">' + balLink(b, r.employee, BF[i]) + '</td>' +
        '<td class="m r pr-gx-bal pr-bal pr-stk pr-stk-b2">' + balLink(b, r.employee, after, String(i)) + (after < -0.004 ? '<span class="pr-ovw" data-pr-ovw="' + i + '" title="Still overpaid after this payroll">⚠</span>' : '<span class="pr-ovw" data-pr-ovw="' + i + '" hidden title="Still overpaid after this payroll">⚠</span>') + '</td></tr>'; }).join('');
    var sumC = function (c, first) { return '<td class="m r pr-gx-' + grp(c) + (first ? ' pr-gs' : '') + '" data-pr-col="' + esc(c.key) + '">' + money(S[c.key] || 0) + '</td>'; };
    var bfT = 0, afT = 0; d.rows.forEach(function (r, i) { if (!r.include) return; bfT += BF[i]; afT += BF[i] + rowTotals(d, r).net; }); bfT = r2(bfT); afT = r2(afT);
    var foot = '<tr class="tot-row"><td class="pr-chk pr-stk pr-stk-l0"></td><td class="tot-lbl pr-stk pr-stk-l1">Total (<span data-pr-sum="employees">' + T.employees + '</span> ticked)</td>' +
      '<td class="pr-gx-days pr-gs"></td><td class="m r pr-gx-days" data-pr-sum="absent">' + esc(String(T.absent || 0)) + '</td><td class="m r pr-gx-days" data-pr-sum="worked">' + esc(String(T.worked || 0)) + '</td>' +
      E.map(function (c, i) { return sumC(c, i === 0); }).join('') + '<td class="m r pr-gx-earnings pr-sum" data-pr-sum="earnings">' + money(T.earnings) + '</td>' +
      '<td class="m r pr-gx-deductions pr-gs" data-pr-sum="absentDed">' + money(T.absentDed) + '</td>' + SD.map(function (c) { return sumC(c, false); }).join('') +
      '<td class="m r pr-gx-deductions pr-sum" data-pr-sum="salDed">' + money(T.salDed) + '</td>' +
      '<td class="m r bold pr-cost pr-gx-cost pr-gs" data-pr-sum="cost">' + money(T.cost) + '</td>' +
      (nR ? RC.map(function (c, i) { return sumC(c, i === 0); }).join('') + '<td class="m r pr-gx-recov pr-sum" data-pr-sum="recov">' + money(T.recov) + '</td>' : '') +
      C.map(function (c, i) { return sumC(c, i === 0); }).join('') +
      '<td class="m r bold pr-net pr-stk pr-stk-r pr-gs" data-pr-sum="net">' + money(T.net) + '</td>' +
      '<td class="m r pr-gx-bal pr-bal pr-stk pr-stk-b1 pr-gs" data-pr-sum="before">' + esc(balTxt(bfT)) + '</td><td class="m r pr-gx-bal pr-bal pr-stk pr-stk-b2" data-pr-sum="after">' + esc(balTxt(afT)) + '</td></tr>';
    var title = d.editing ? 'Edit payroll — ' + monthLabel(d.month) : (d.id ? 'Payroll ' + monthLabel(d.month) + ' (draft)' : 'Run payroll — ' + monthLabel(d.month));
    var run0 = d.editing ? runById(b, d.id) : null, paid0 = run0 ? figures(b, run0).paid : 0;
    var cr = d.editing && run0 ? [['Payroll', 'Payroll.ui.list()'], [monthLabel(run0.month), 'Payroll.ui.open(' + JSON.stringify(run0.id) + ')'], ['Edit']] : [['Payroll', 'Payroll.ui.list()'], [title]];
    return crumb(cr) +
      '<div class="card pr-card pr-run" id="prReview"><div class="pr-card-h"><h2>' + esc(title) + '</h2></div>' + errBox() +
      (paid0 > 0.004 ? '<div class="info-bar pr-warnbar" role="alert"><b>Salary already paid.</b> Changing it will create an outstanding difference (' + money(paid0) + ' paid so far).</div>' : '') + itemsWarn(b) +
      '<div class="pr-secs"><section class="pr-sec"><h3 class="pr-sec-h">Period</h3><div class="pr-fields">' +
        '<label class="pr-f"><span>Month</span><input class="pr-in" type="month" value="' + esc(d.month) + '" onchange="Payroll.ui.hdr(\'month\',this.value)"></label>' +
        '<label class="pr-f"><span>Payroll date</span><input class="pr-in" type="date" value="' + esc(d.date) + '" onchange="Payroll.ui.hdr(\'date\',this.value)"></label>' +
        '<div class="pr-f pr-f-days"><label for="prDaysTotal">Total days in period</label><input class="pr-in" type="text" inputmode="decimal" id="prDaysTotal" value="' + esc(String(d.daysTotal == null ? '' : d.daysTotal)) + '" oninput="Payroll.ui.hdr(\'daysTotal\',this.value)">' +
          '<small class="pr-f-h">' + esc(d.daysAuto === false ? 'Entered by hand' : basisLabel(b)) + ' · <a class="led-link" onclick="Payroll.ui.settings()">Settings → Payroll</a></small></div></div></section>' +
      '<section class="pr-sec pr-sec-w"><h3 class="pr-sec-h">Description</h3><input class="pr-in pr-in-w" type="text" aria-label="Description" value="' + esc(d.description || '') + '" oninput="Payroll.ui.hdr(\'description\',this.value)"></section></div>' +
      '<details class="pr-how"><summary>How this works</summary><div>One payslip per ticked employee, dated ' + esc(fmtD(d.date)) + '. Accrual basis: <b>Salary cost</b> (gross earnings − salary deductions) is the salary expense on that date and the <b>Net pay</b> is owed to each employee until you use <b>Pay salaries</b>. ' +
        'Days absent: an <b>Absent deduction</b> (absent deduction basis ÷ total days × days absent) is a salary deduction; allowances ticked <i>Pro-rata</i> in Payslip Items are paid for the days worked; other items are fixed. ' +
        '<b>Recoveries</b> (loan / advance repayments) credit the employee’s loan or advance account and lower net pay only — they never touch the salary expense. <b>Employee balance</b> is the Employee clearing account before this payroll and after its net pay.</div></details>' +
      '<section class="pr-sec pr-sec-emp"><h3 class="pr-sec-h">Employees</h3>' +
      '<div class="tbl-scroll pr-grid-wrap" id="prGridWrap"><table class="reg-tbl pr-grid" data-cols="' + n + '" data-ncols="' + ncols + '"><thead><tr class="pr-grp-row">' + g1 + '</tr><tr class="pr-col-row">' + g2 + '</tr></thead><tbody>' +
        (rows || '<tr><td colspan="' + ncols + '"><div class="reg-empty">No active employees.</div></td></tr>') + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      ctl.html + (d.editing ? addEmpCtl(b, d) : '') + '</section>' +
      (d.editing ? '<div class="form-actions"><button class="btn btn-primary" onclick="Payroll.ui.saveEdit()">Save</button><button class="btn" onclick="Payroll.ui.cancel()">Cancel</button>' +
        '<span class="pr-sub" style="margin-left:auto">Saving updates every payslip, the journal entry, WPS and the employee balances together.</span></div></div>' :
      '<div class="form-actions"><button class="btn btn-primary" onclick="Payroll.ui.create()">Create <span data-pr-sum="employees2">' + T.employees + '</span> payslips</button>' +
        '<button class="btn" onclick="Payroll.ui.saveDraft()">Save draft</button><button class="btn" onclick="Payroll.ui.cancel()">Cancel</button>' +
        (d.id && can('canDelete', 'Payroll') ? '<button class="btn btn-danger" style="margin-left:auto" onclick="Payroll.ui.del(' + JSON.stringify(d.id) + ')">Delete draft</button>' : '') + '</div></div>');
  }
  /** + Add employee (the run's Edit): active employees not on the grid yet */
  function addEmpCtl(b, d) {
    var on = {}; d.rows.forEach(function (r) { on[r.employee] = 1; });
    var L = employees(b).filter(function (e) { return !on[e.name]; });
    return '<div class="pr-addcol pr-addemp"><select id="prAddEmp" aria-label="Add an employee to the run"' + (L.length ? '' : ' disabled title="Every employee is in the run"') + ' onchange="Payroll.ui.addEmp(this.value)"><option value="">' + (L.length ? '+ Add employee…' : 'All employees added') + '</option>' +
      L.map(function (e) { return '<option value="' + esc(e.name) + '">' + esc((e.code ? e.code + ' - ' : '') + e.name) + (empActive(e) ? '' : ' (inactive)') + '</option>'; }).join('') + '</select></div>';
  }
  /** column totals of the ticked rows, after pro-rata */
  function colSums(d) { var s = {}; d.rows.forEach(function (r) { if (!r.include) return; var t = rowTotals(d, r); d.cols.forEach(function (c) { s[c.key] = r2((s[c.key] || 0) + (t.col[c.key] || 0)); }); }); return s; }
  function refreshTotals() { var b = curB(); if (!b) return refreshTotals0(); return withGl(b, refreshTotals0); }
  function refreshTotals0() {
    var d = UI.draft, h = byId('prReview'); if (!d || !h) return; var T = draftTotals(d), S = colSums(d), b = curB(), BF = d._before || [];
    var q = function (sel) { return h.querySelector(sel); }, qk = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); };
    var bfT = 0, afT = 0;
    d.rows.forEach(function (r, i) { var t = rowTotals(d, r), bad = daysError(d.daysTotal, r.daysAbsent), bf = num(BF[i]), after = r2(bf + (r.include ? t.net : 0));
      if (r.include) { bfT += bf; afT += bf + t.net; }
      ['earnings', 'salDed', 'cost', 'recov', 'net', 'absentDed'].forEach(function (k) { var c = q('[data-pr-t="' + i + ':' + k + '"]'); if (c) c.textContent = money(t[k]); });
      var ct = q('[data-pr-t="' + i + ':total"]'); if (ct) ct.textContent = String(t.total || num(d.daysTotal) || '');
      var cw = q('[data-pr-t="' + i + ':worked"]'); if (cw) cw.textContent = bad ? '—' : String(t.total ? t.worked : '');
      var ab = q('[data-pr-abs="' + i + '"]'); if (ab) { ab.classList.toggle('pr-bad', !!bad); if (bad) { ab.setAttribute('aria-invalid', 'true'); ab.setAttribute('title', bad); } else { ab.removeAttribute('aria-invalid'); ab.removeAttribute('title'); } }
      d.cols.forEach(function (c) { if (colKind(c) !== 'prorata') return; var e = q('[data-pr-e="' + i + '|' + qk(c.key) + '"]'); if (e) e.textContent = proHint(d, t, c); });
      /* recoveries against the outstanding loan / advance */
      if (b && d.cols.some(isRec)) rowRecov(b, d, r).forEach(function (x) { x.cols.forEach(function (k) {
        var os = q('[data-pr-os="' + i + '|' + qk(k) + '"]'); if (os) os.classList.toggle('pr-os-bad', x.over);
        var inp = q('[data-pr-cell="' + i + '|' + qk(k) + '"]'); if (inp) { inp.classList.toggle('pr-bad', x.over); if (x.over) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('title', 'Recovery is more than the ' + money(x.os) + ' outstanding'); } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('title'); } } }); });
      var bl = q('[data-pr-bal="' + i + '"]'); if (bl) { bl.textContent = balTxt(after); ['pr-bal-pay', 'pr-bal-over', 'pr-bal-zero'].forEach(function (c) { bl.classList.toggle(c, c === balCls(after)); }); }
      var tr = q('[data-pr-row="' + i + '"]'); if (tr) tr.classList.toggle('pr-overpaid', after < -0.004);
      var w = q('[data-pr-ovw="' + i + '"]'); if (w) { if (after < -0.004) w.removeAttribute('hidden'); else w.setAttribute('hidden', ''); } });
    d.cols.forEach(function (c) { var el = q('[data-pr-col="' + qk(c.key) + '"]'); if (el) el.textContent = money(S[c.key] || 0); });
    SUMK.concat(['employees']).forEach(function (k) { var el = q('[data-pr-sum="' + k + '"]'); if (el) el.textContent = k === 'employees' ? T.employees : ((k === 'absent' || k === 'worked') ? String(T[k] || 0) : money(T[k])); });
    var sb = q('[data-pr-sum="before"]'); if (sb) sb.textContent = balTxt(r2(bfT)); var sa = q('[data-pr-sum="after"]'); if (sa) sa.textContent = balTxt(r2(afT));
    var e2 = q('[data-pr-sum="employees2"]'); if (e2) e2.textContent = T.employees;
  }

  /* ---- run view ---- */
  function runHtml(b, run) {
    var f = figures(b, run), A = app();
    var tiles = [['Employees', f.employees, 0], ['Gross', money(f.gross), 1], ['Deductions', money(f.deductions), 1], ['Net pay', money(f.net), 1], ['Paid', money(f.paid), 1], [outLabel(f.outstanding), outMoney(f.outstanding), 1]];
    if (f.contributions) tiles.splice(3, 0, ['Employer contributions', money(f.contributions), 1]);
    var hasDays = f.rows.some(function (r) { return r.daysTotal != null; });
    var dayTds = function (r) { return hasDays ? '<td class="m r">' + (r.daysTotal == null ? '' : esc(String(r.daysTotal))) + '</td><td class="m r">' + (r.daysTotal == null ? '' : esc(String(r.daysAbsent || 0))) + '</td><td class="m r">' + (r.daysWorked == null ? '' : esc(String(r.daysWorked))) + '</td>' : ''; };
    var rows = f.rows.map(function (r) {
      return '<tr><td class="c-name"><b>' + esc(r.employee) + '</b>' + (r.code ? '<span class="pr-code">' + esc(r.code) + '</span>' : '') + '</td>' +
        '<td class="nw">' + (r.payslip ? '<a class="led-link" onclick="Payroll.ui.payslip(' + JSON.stringify(r.payslip.id) + ')">Payslip ' + esc(r.payslip.reference || '') + '</a>' : '') + '</td>' + dayTds(r) +
        '<td class="m r">' + money(r.gross) + '</td><td class="m r">' + money(r.deductions) + '</td><td class="m r bold">' + money(r.net) + '</td><td class="m r">' + money(r.paid) + '</td><td class="m r' + (r.outstanding > 0.004 ? ' pr-owe' : '') + '">' + money(r.outstanding) + '</td>' +
        '<td>' + stBadge(r.outstanding < -0.004 ? 'Recoverable' : (r.outstanding <= 0.004 ? 'Paid' : (r.paid > 0.004 ? 'Partly paid' : 'Accrued'))) + '</td></tr>'; }).join('');
    var pays = f.payments.map(function (p) { return '<tr><td class="nw">' + esc(fmtD(p.date)) + '</td><td class="nw"><a class="led-link" onclick="Payroll.ui.payment(' + JSON.stringify(p.id) + ')">Payment ' + esc(p.reference || '') + '</a></td><td>' + esc(p.paidFrom || '') + '</td><td>' + esc(p.payee || '') + '</td><td class="m r">' + money(num(p.amount != null && p.amount !== '' ? p.amount : p.total)) + '</td></tr>'; }).join('');
    var nextYm = addMonths(run.month, 1);
    var acts = (f.outstanding > 0.004 && can('canCreate', 'Payments') ? '<button class="btn btn-primary" onclick="Payroll.ui.pay(' + JSON.stringify(run.id) + ')">Pay salaries</button>' : '') +
      (!runForMonth(b, nextYm) && can('canCreate', 'Payroll') ? '<button class="btn" onclick="Payroll.ui.runNext(' + JSON.stringify(run.id) + ')">Run next month (' + esc(monthLabel(nextYm)) + ')</button>' : '') +
      '<button class="btn" onclick="Payroll.ui.wpsCopy(' + JSON.stringify(run.id) + ')">Copy WPS list</button>' +
      '<button class="btn" onclick="window.print()">Print</button>' +
      '<button class="btn" onclick="Payroll.ui.list()">Back</button>' +
      (can('canDelete', 'Payroll') ? '<button class="btn btn-danger" style="margin-left:auto" onclick="Payroll.ui.del(' + JSON.stringify(run.id) + ')">Delete</button>' : '');
    /* FIX_SPEC_4 #3: Edit next to Pay salaries / Delete, the reconciliation badge, Details | History tabs */
    if (can('canEdit', 'Payroll')) acts = '<button class="btn" onclick="Payroll.ui.edit(' + JSON.stringify(run.id) + ')">Edit</button>' + acts;
    var rc = reconcile(b, run), tab = UI.route && UI.route.tab === 'history' ? 'history' : 'details';
    var recBox = rc.ok ? '' : '<div class="info-bar pr-warnbar pr-recbox" role="alert"><b>⚠ Mismatch</b><ul>' + rc.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      (can('canEdit', 'Payroll') ? '<button class="btn btn-sm" onclick="Payroll.ui.rebuild(' + JSON.stringify(run.id) + ')">Rebuild</button>' : '') + '</div>';
    var tabs = '<div class="pr-tabs" role="tablist"><button type="button" role="tab" class="pr-tab' + (tab === 'details' ? ' on' : '') + '" aria-selected="' + (tab === 'details') + '" onclick="Payroll.ui.tab(\'details\')">Details</button>' +
      '<button type="button" role="tab" class="pr-tab' + (tab === 'history' ? ' on' : '') + '" aria-selected="' + (tab === 'history') + '" onclick="Payroll.ui.tab(\'history\')">History' + ((run.history || []).length ? ' <span class="pr-cnt">' + run.history.length + '</span>' : '') + '</button></div>';
    var head = crumb([['Payroll', 'Payroll.ui.list()'], [monthLabel(run.month)]]) +
      '<div class="card pr-card"><div class="pr-card-h"><h2>Payroll — ' + esc(monthLabel(run.month)) + '</h2>' + stBadge(f.status) + recBadge(rc) + '</div>' + errBox() +
      '<div class="pr-meta">Payroll date ' + esc(fmtD(run.date)) + (run.description ? ' · ' + esc(run.description) : '') + ' · ' + runDays(b, run) + ' days in the period</div>' + recBox + tabs;
    if (tab === 'history') return head + histTable(run.history) + '<div class="form-actions pr-acts">' + acts + '</div></div>';
    return head +
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
    if (r.page === 'start') return startHtml(b);
    if (r.page === 'edit') { if (!UI.draft || !UI.draft.editing || !runById(b, UI.draft.id)) { UI.route = { page: 'list' }; return listHtml(b); } return reviewHtml(b); }
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

  UI.list = function () { UI.draft = null; UI.payState = null; UI.startState = null; go({ page: 'list' }); };
  UI.open = function (id) { var b = curB(), run = runById(b, id); if (!run) return UI.list(); UI.payState = null; UI.startState = null;
    if (run.state === 'draft') { UI.draft = Object.assign({ id: run.id }, clone(snapshot(run))); return go({ page: 'review' }); }
    UI.draft = null; go({ page: 'run', id: run.id }); };
  /* FIX_SPEC_4 #3.1 — Run payroll opens the dialog (month / payroll date / description) */
  UI.start = function () { var b = curB(); if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.'); UI.startState = startInit(b); UI.draft = null; go({ page: 'start' }); };
  UI.startHdr = function (k, v) { var s = UI.startState; if (!s) return;
    if (k === 'month') { if (!validYm(v)) return; var autoDate = s.date === monthEnd(s.month), autoDesc = s.description === 'Payroll ' + monthLabel(s.month); s.month = v; if (autoDate) s.date = monthEnd(v); if (autoDesc) s.description = 'Payroll ' + monthLabel(v); UI.errors = []; render(); return; }
    s[k] = v; };
  UI.startGo = function () { var b = curB(), s = UI.startState; if (!s) return; var E = [];
    if (!validYm(s.month)) E.push('Choose the payroll month.'); if (!isoDate(s.date)) E.push('Enter the payroll date.');
    var ex = validYm(s.month) ? runForMonth(b, s.month) : null; if (ex) E.push('A payroll run for ' + monthLabel(s.month) + ' already exists.');
    if (E.length) { UI.errors = E; return render(); }
    var d = prefill(b, s.month); d.date = isoDate(s.date); d.description = s.description || d.description; UI.startState = null; UI.draft = d; go({ page: 'review' }); };
  UI.newRun = function (ym) { var b = curB(); if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.');
    if (!validYm(ym)) return UI.start(); var ex = runForMonth(b, ym); if (ex) return UI.open(ex.id);
    UI.draft = prefill(b, ym); go({ page: 'review' }); };
  /* FIX_SPEC_4 #3.2 — Edit a posted run */
  UI.edit = function (id) { var b = curB(), run = runById(b, id); if (!run || run.state !== 'posted') return; if (!can('canEdit', 'Payroll')) return say('Your permissions do not allow changing payroll runs.');
    var open = function () { UI.draft = editDraft(curB(), runById(curB(), id)); UI.dirty = false; go({ page: 'edit', id: id }); };
    if (figures(b, run).paid > 0.004) return ask('Salary already paid. Changing it will create an outstanding difference.', { title: 'Edit payroll ' + monthLabel(run.month), okText: 'Edit anyway' }).then(function (ok) { if (ok) open(); });
    open(); };
  UI.saveEdit = function () { var A = app(), b = curB(), d = UI.draft; if (!b || !d || !d.editing) return;
    var run = runById(b, d.id); if (!run) return UI.list();
    var go2 = function () { var bb = curB(), r = saveRunEdit(bb, d); if (r.errors) { UI.errors = r.errors; render(); try { byId('wsMain').scrollTop = 0; } catch (e) {} return; }
      A.saveBiz(bb); var o = r.figures.outstanding;
      toast('Payroll ' + monthLabel(r.run.month) + ' saved' + (r.figures.paid > 0.004 ? ' — ' + (o < -0.004 ? 'recoverable / advance ' + money(-o) : 'outstanding ' + money(o)) : ''));
      UI.dirty = false; UI.draft = null; go({ page: 'run', id: r.run.id }); };
    var pays = runPayments(b, run).length;
    if (pays && (run.month !== d.month || run.date !== d.date)) return ask('This run has ' + pays + ' salary payment' + (pays === 1 ? '' : 's') + '. Moving it to ' + monthLabel(d.month) + ' (' + fmtD(d.date) + ') re-links ' + (pays === 1 ? 'it' : 'them') + ' to the changed run. Continue?', { title: 'Re-link salary payments', okText: 'Save and re-link' }).then(function (ok) { if (ok) go2(); });
    go2(); };
  UI.addEmp = function (name) { var d = UI.draft, b = curB(); if (!d || !name) return; var e = empByName(b, name); if (!e || d.rows.some(function (r) { return r.employee === name; })) return;
    var row = { employee: e.name, code: e.code || '', include: true, _touched: true, note: '', amt: {}, daysAbsent: 0, payslipId: null }, s = paySetup(e);
    SECS.forEach(function (x) { s[x[0]].forEach(function (l) { if (!l.amount) return; var k = addCol(b, d, x[0], l.itemId, l.item); row.amt[k] = r2((row.amt[k] || 0) + l.amount); }); });
    d.rows.push(row); sortCols(b, d); UI.dirty = true; regrid(null); };
  UI.rmEmp = function (i) { var d = UI.draft; if (!d || !d.rows[i]) return; d.rows.splice(i, 1); UI.dirty = true; render(); };
  UI.tab = function (t) { if (!UI.route || UI.route.page !== 'run') return; UI.route.tab = t === 'history' ? 'history' : 'details'; render(); };
  UI.rebuild = function (id) { var A = app(), b = curB(); if (!can('canEdit', 'Payroll')) return say('Your permissions do not allow changing payroll runs.');
    var r = rebuild(b, id); if (r.errors) return say(r.errors.join('\n')); A.saveBiz(b); toast(r.fixes.length ? 'Rebuilt — ' + r.fixes.length + ' fix' + (r.fixes.length === 1 ? '' : 'es') : 'Rebuilt — journal re-posted'); render(); };
  UI.runNext = function (fromId) { var b = curB(); if (!can('canCreate', 'Payroll')) return say('Your permissions do not allow running payroll.');
    var src = fromId != null ? runById(b, fromId) : lastRun(b); if (!src) return UI.newRun();
    var ym = addMonths(src.month, 1), ex = runForMonth(b, ym); if (ex) return UI.open(ex.id);
    UI.draft = prefill(b, ym, { copyFrom: src }); go({ page: 'review' }); };
  UI.report = function (y) { go({ page: 'report', year: y || null }); };
  UI.items = function (sec) { var A = app(); if (global.SettingsFixesA && SettingsFixesA.openPayslipItems) return SettingsFixesA.openPayslipItems(sec || ''); try { A.selectSection('Settings'); } catch (e) {} };
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
  /* FIX_SPEC_5 A5: the employee balance opens that employee's ledger (Employee clearing account) */
  UI.empLedger = function (name) { var A = app(), b = curB(), e = empByName(b, name); if (!A || !e) return;
    var lbl = 'Employees'; try { var K = KEY2LABEL; if (K && K.employees) lbl = K.employees; } catch (x) {}
    try { A.selectSection(lbl); A.openLedger(e.id); } catch (x) {} };
  UI.payslip = function (id) { var A = app(); try { A.gotoRecord('payslips', id); } catch (e) {} };
  UI.payment = function (id) { var A = app(); try { A.gotoRecord('payments', id); } catch (e) {} };
  UI.goRun = function (id) { var A = app(); try { A.gotoRecord('payroll', id); } catch (e) {} };

  /* unsaved changes on the Run payroll page (js/unsaved-guard.js asks before the sidebar opens another page) */
  ['hdr', 'days', 'cell', 'inc', 'incAll', 'addCol', 'dropCol'].forEach(function (k) { var o = UI[k]; UI[k] = function () { UI.dirty = true; return o.apply(this, arguments); }; });
  ['list', 'newRun', 'runNext', 'open', 'start'].forEach(function (k) { var o = UI[k]; UI[k] = function () { UI.dirty = false; return o.apply(this, arguments); }; });
  P.unsaved = function () { if (!(UI.dirty && UI.draft && UI.route)) return ''; if (UI.route.page === 'edit') return 'Your changes to payroll ' + monthLabel(UI.draft.month) + ' are not saved. Leave without saving?';
    return UI.route.page === 'review' ? 'The payroll run for ' + monthLabel(UI.draft.month) + ' has changes that are not saved. Leave without saving? (Use Save draft to keep them.)' : ''; };
  UI.cancel = function () {
    var d = UI.draft, back = d && d.editing ? function () { UI.open(d.id); } : UI.list;
    var m = P.unsaved(); if (!m) return back();
    ask(m, { title: 'Unsaved changes', okText: 'Leave without saving', danger: true }).then(function (ok) { if (ok) back(); });
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
      if (isPayroll(this) && (this.wsMode === 'form' || this.wsMode === 'view')) {
        /* a ledger row of the run's journal entry (src 'payroll') opens the run */
        if (this.wsMode === 'view' && this.editingId != null) { var rv = runById(this.curBiz(), this.editingId); if (rv && rv.state === 'posted') { UI.route = { page: 'run', id: rv.id }; UI.draft = null; } this.editingId = null; }
        this.wsMode = 'list'; }
      return orig.apply(this, args); });
    /* FIX_SPEC_4 #3: one-time data update when a business is opened (or the page reloads on it) */
    wrap(A, 'renderWorkspace', function (orig, args) { try { var b = this.curBiz && this.curBiz(); if (b && migrate(b)) this.saveBiz(b); } catch (e) { if (global.console) console.warn('payroll migrate', e); } return orig.apply(this, args); });
    /* a payslip saved / deleted anywhere (its own form, Form Designer, import) keeps its run in step */
    wrap(A, '_logActivity', function (orig, args) { var r = orig.apply(this, args);
      try { if (!P._busy && args[2] === 'payslips') { var b = args[0], act = args[1];
        if ((act === 'create' || act === 'update') && args[3] && args[3].id != null) onPayslipSaved(b, args[3].id, args[4] || null);
        else if (act === 'delete' && !args[3] && args[4]) onPayslipDeleted(b, args[4]); } } catch (e) { if (global.console) console.warn('payroll sync', e); }
      return r; });
    wrap(A, 'deleteRecord', function (orig, args) {
      if (l2k()[this.wsSection] === 'payslips') { var b = this.curBiz(), p = b ? psById(b, args[0]) : null, m = p ? payslipDeleteBlock(b, p) : ''; if (m) { say(m); return; } }
      return orig.apply(this, args); });
    /* the payslip View: which run it belongs to, and its History */
    wrap(A, 'viewHtml', function (orig, args) { var h = orig.apply(this, args);
      try { if (l2k()[this.wsSection] === 'payslips' && this.editingId != null) { var b = args[0] || this.curBiz(), p = psById(b, this.editingId); if (p) h += payslipExtraHtml(b, p); } } catch (e) {}
      return h; });
    wrapPayslipForm();
    registerPosting();
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
  /** Settings → Payroll: the allowances added to Basic for the Absent deduction (the business's earnings items, read when drawn) */
  function absentItemsField() {
    var f = { k: 'absentItems', l: 'Allowances in the absent deduction basis', t: 'checks', def: [], show: function (v) { return v.absentBasis === 'chosen'; },
      hint: 'Basic salary is always included. Items ticked here are not also pro-rated.' };
    try { Object.defineProperty(f, 'items', { enumerable: true, configurable: true, get: function () { var b = null; try { b = app().curBiz(); } catch (e) {}
      return items(b, 'earnings').map(function (x) { return x.name; }).filter(function (nm) { return !isBasicName(nm); }); } }); } catch (e) { f.items = []; }
    return f;
  }
  function dmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); }
  var SETTINGS_PAGE = { title: 'Payroll', kind: 'form', store: 'payrollSettings',
    intro: 'How payroll counts the days of a pay period. Days worked = total days − days absent. An Absent deduction line = (Basic, or Basic + the chosen allowances) ÷ total days × days absent; allowances ticked "Pro-rata" in Payslip Items are paid for the days worked; other items are fixed.',
    fields: [
      { k: 'daysBasis', l: 'Total days in a pay period', t: 'select', def: 'calendar', opts: [['calendar', 'Calendar days (every day of the month)'], ['fixed30', 'Fixed 30 days (every month)'], ['working', 'Working days (leave out weekends)']] },
      /* FIX_SPEC_5 A3: what the Absent deduction is worked out on */
      { k: 'absentBasis', l: 'Absent deduction basis', t: 'select', def: 'basic', opts: [['basic', 'Basic salary only'], ['chosen', 'Basic salary + chosen allowances']],
        hint: 'Absent deduction = (sum of the basis items) ÷ total days × days absent. It is a salary deduction: it lowers the salary cost.' },
      absentItemsField(),
      { k: 'weekend', l: 'Weekend', t: 'select', def: 'sat-sun', opts: WEEKENDS.map(function (w) { return [w[0], w[1]]; }), show: function (v) { return v.daysBasis === 'working'; },
        hint: 'UAE: Saturday and Sunday (federal), Friday and Saturday, or Sunday only for a six-day week.' },
      { k: 'excludeHolidays', l: 'Leave out public holidays', t: 'checkbox', show: function (v) { return v.daysBasis === 'working'; } },
      { k: 'holidays', l: 'Public holidays', t: 'lines', cols: [{ k: 'date', l: 'Date (DD/MM/YYYY)' }, { k: 'name', l: 'Holiday' }], show: function (v) { return v.daysBasis === 'working' && !!v.excludeHolidays; },
        hint: 'A holiday that falls on a weekend day is not counted twice.' }],
    load: function (r) { r.holidays = (r.holidays || []).map(function (h) { return { date: h && isoDate(h.date) ? dmy(isoDate(h.date)) : (h && h.date) || '', name: (h && h.name) || '' }; }); return r; },
    validate: function (v) { var bad = (v.holidays || []).filter(function (h) { return h && !blank(h.date) && !isoDate(h.date); })[0]; if (bad) return 'Public holiday date "' + bad.date + '" is not a date — use DD/MM/YYYY.'; },
    beforeSave: function (r) { if (r.daysBasis !== 'working' && r.daysBasis !== 'fixed30') r.daysBasis = 'calendar'; if (r.absentBasis !== 'chosen') r.absentBasis = 'basic';
      r.absentItems = (Array.isArray(r.absentItems) ? r.absentItems : []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return x && !isBasicName(x); });
      if (!WEEKENDS.some(function (w) { return w[0] === r.weekend; })) r.weekend = 'sat-sun';
      r.excludeHolidays = !!r.excludeHolidays; r.holidays = (r.holidays || []).filter(function (h) { return h && isoDate(h.date); }).map(function (h) { return { date: isoDate(h.date), name: String(h.name || '') }; }).sort(function (x, y) { return x.date.localeCompare(y.date); }); } };
  function installSettings(A) {
    var SP = G('SettingsPages'); if (!SP || !SP.PAGES || SP._payroll) return; SP._payroll = true; var PG = SP.PAGES;
    PG.payrollSettings = SETTINGS_PAGE;
    A.set_payrollSettings = function (b) { return SP.page(b, 'payrollSettings'); };
    wrap(A, 'setTiles', function (orig, args) { var t = orig.apply(this, args) || []; if (t.some(function (x) { return x[2] === 'payrollSettings'; })) return t;
      var i = t.findIndex(function (x) { return x[2] === 'payslipItems'; }), tile = ['briefcase', 'Payroll', 'payrollSettings', 'Days in a pay period (calendar, fixed 30 or working days), absent deduction basis', 1, 1];
      t = t.slice(); t.splice(i < 0 ? t.length : i, 0, tile); return t; });
    var I = G('ICO'); if (I && typeof I.forSetting === 'function' && !I._payrollSet) { var fs = I.forSetting; I._payrollSet = 1; I.forSetting = function (key, size, cls) { return key === 'payrollSettings' ? this.get('briefcase', size, cls) : fs.apply(this, arguments); }; }
    try { var E = PG.payslipItems.items.earnings;
      if (!(E.fields || []).some(function (f) { return f && f.k === 'proRata'; })) {
        E.fields.splice(2, 0, { k: 'proRata', l: 'Pro-rata', t: 'checkbox', hint: 'Pay this allowance for the days worked: (monthly ÷ total days) × days worked. Basic salary is always reduced for days absent, as a separate Absent deduction line; items left unticked are fixed.' });
        E.cols.push({ k: 'proRata', l: 'Pro-rata', fmt: function (v, r) { return isBasicName(r && r.name) ? 'Basic (absent deduction)' : (truthy(v) ? 'Yes' : ''); } }); }
      earningsAccountRequired(E);
    } catch (e) {}
    try { deductionTypes(PG.payslipItems.items.deductions); contributionAccounts(PG.payslipItems.items.contributions); } catch (e) {}
  }
  /* FIX_SPEC_5 A3 — Payslip deduction items get a Type: Salary deduction (absent, late, fines — credits an expense, liability
     or income account) or Recovery (loan / advance repayment — credits an asset / receivable account, per employee).
     Every item needs an account. */
  var DED_TYPES = [['salary', 'Salary deduction — absent, late, fines (lowers the salary cost)'], ['recovery', 'Recovery — loan / advance repayment (balance sheet, lowers net pay only)']];
  function deductionTypes(D) {
    if (!D || D._types) return; D._types = 1;
    if (!(D.fields || []).some(function (f) { return f && f.k === 'type'; }))
      D.fields.splice(1, 0, { k: 'type', l: 'Type', t: 'select', opts: DED_TYPES, hint: 'A recovery maps to an asset or receivable account (Employee loans, Salary advances); its balance is kept per employee and shown under the recovery in Run payroll.' });
    var af = (D.fields || []).filter(function (f) { return f && f.k === 'account'; })[0]; if (af) { af.req = 1; af.hint = 'Required. Salary deduction: the expense account it reduces (or e.g. Other income for fines). Recovery: the employee loan / advance asset account.'; }
    var ol = D.load; D.load = function (r, b) { r = ol ? (ol(r, b) || r) : r; if (r.type !== 'salary' && r.type !== 'recovery') r.type = dedType(b, r); return r; };
    var ov = D.validate;
    D.validate = function (v, b, id) { var m = ov ? ov.apply(this, arguments) : null; if (m) return m;
      var n = acct(b, v && v.account); if (!n) return 'Choose the account of this deduction item.';
      var root = rootOfAcct(b, n), t = v.type === 'recovery' ? 'recovery' : 'salary';
      if (t === 'recovery' && !isRecoveryAcct(b, n)) return 'A recovery item may only map to an asset or receivable account (e.g. Employee loans, Salary advances) — "' + n.name + '" is not one.';
      if (t === 'salary' && root === 'assets') return '"' + n.name + '" is an asset account — choose Type "Recovery" for a loan / advance repayment, or an expense account for a salary deduction.';
      return null; };
    var obs = D.beforeSave; D.beforeSave = function (r, b) { if (obs) obs(r, b); if (r.type !== 'recovery') r.type = 'salary'; };
    if (!(D.cols || []).some(function (c) { return c && c.k === 'type'; })) D.cols.splice(1, 0, { k: 'type', l: 'Type', fmt: function (v, r, b) { return dedType(b, Object.assign({}, r, { type: v })) === 'recovery' ? 'Recovery (loan / advance)' : 'Salary deduction'; } });
  }
  function contributionAccounts(Cn) {
    if (!Cn || Cn._acctReq) return; Cn._acctReq = 1;
    (Cn.fields || []).forEach(function (f) { if (f && (f.k === 'expense' || f.k === 'liability')) f.req = 1; });
    var ov = Cn.validate;
    Cn.validate = function (v, b) { var m = ov ? ov.apply(this, arguments) : null; if (m) return m;
      if (!acct(b, v && v.expense)) return 'Choose the expense account of this contribution item.';
      if (!acct(b, v && v.liability)) return 'Choose the liability account of this contribution item.'; return null; };
  }
  /* FIX_SPEC_4 #3.7 — every Earnings item needs an expense account; existing items without one are flagged */
  function earningsAccountRequired(E) {
    if (!E || E._acctReq) return; E._acctReq = 1;
    var f = (E.fields || []).filter(function (x) { return x && x.k === 'account'; })[0];
    if (f) { f.req = 1; f.hint = 'Required. Salaries and allowances of this item are expensed to this account (the payroll journal reads it every time, so a change re-posts every run).'; }
    var ov = E.validate;
    E.validate = function (v, b, id) { var m = ov ? ov.apply(this, arguments) : null; if (m) return m;
      var n = acct(b, v && v.account); if (!n) return 'Choose the expense account of this earnings item.';
      var root = ''; try { root = G('acctRoot')(b, n); } catch (e) { root = ''; }
      if (root && root !== 'expense') return '"' + n.name + '" is not an expense account — choose an account under Expenses (Profit and Loss).';
      return null; };
    var c = (E.cols || []).filter(function (x) { return x && x.k === 'account'; })[0];
    if (c) { var of = c.fmt; c.fmt = function (v, r, b) { if (!acct(b, v)) return '⚠ No expense account — required'; return of ? of.apply(this, arguments) : v; }; }
    var intro0 = E.intro || '';
    try { Object.defineProperty(E, 'intro', { configurable: true, enumerable: true, get: function () { var A = app(), b = null; try { b = A.curBiz(); } catch (e) {}
      var L = b ? itemsNoAccount(b) : []; return (intro0 ? intro0 + ' ' : '') + (L.length ? '⚠ No expense account yet: ' + L.map(function (x) { return x.name; }).join(', ') + ' — their amounts post to Salaries until you choose one. Every earnings item needs an expense account.' : ''); } }); } catch (e) {}
  }

  /* ------------------------------------------------- FIX_SPEC_5 A7 — the payslip print sections
     {header, earnings, salDed, recov, contributions: [{name, desc, amount}], gross, salTotal, cost, recTotal, net,
      account:{opening, net, paid, closing}, loans:[{name, opening, recovered, closing}]} */
  function lineIsRecovery(b, l) { if (!l || l.absent) return false; if (l.recovery) return true;
    var it = findItem(b, 'deductions', l.itemId, l.item); if (it) return dedType(b, it) === 'recovery';
    var n = acct(b, l.account) || (blank(l.accountName) ? null : acctNamed(b, l.accountName)); return !!n && (function () { try { return !!G('GL').empSubAcct(b, n.id); } catch (e) { return false; } })(); }
  function recLineAcct(b, l) { var it = findItem(b, 'deductions', l.itemId, l.item); return (it && acct(b, it.account)) || acct(b, l.account) || (blank(l.accountName) ? null : acctNamed(b, l.accountName)); }
  function payslipSections(b, p) {
    var o = { earnings: [], salDed: [], recov: [], contributions: [], gross: 0, salTotal: 0, cost: 0, recTotal: 0, contrib: 0, net: 0, loans: [] };
    if (!p) return o;
    var emp = empOf(p), e = empByName(b, emp), dt = String(p.date || p.issueDate || '').slice(0, 10), rid = runIdOf(p), run = rid != null ? runById(b, rid) : null;
    var ex = run && run.state === 'posted' ? { runId: run.id } : { psId: p.id };
    o.header = { employee: emp, code: (e && e.code) || p.empCode || '', period: monthLabel(ymOf(dt)), date: dt, days: psDays(p) };
    var byLoan = {};
    (p.lines || []).filter(Boolean).forEach(function (l) { var s = lineSec(l), a = lineAmt(l); if (!a) return;
      var row = { name: l.absent ? 'Absent deduction' : (l.item || l.desc || l.description || ''), desc: l.desc || l.description || '', amount: r2(a) };
      if (row.desc === row.name) row.desc = '';
      if (s === 'earnings') { o.earnings.push(row); o.gross += a; }
      else if (s === 'contributions') { o.contributions.push(row); o.contrib += a; }
      else if (lineIsRecovery(b, l)) { o.recov.push(row); o.recTotal += a; var n = recLineAcct(b, l), k = n ? n.id : '';
        if (n) { if (!byLoan[k]) { byLoan[k] = { acct: n.id, name: n.name, recovered: 0 }; o.loans.push(byLoan[k]); } byLoan[k].recovered += a; } }
      else { o.salDed.push(row); o.salTotal += a; } });
    ['gross', 'salTotal', 'recTotal', 'contrib'].forEach(function (k) { o[k] = r2(o[k]); });
    o.cost = r2(o.gross - o.salTotal); o.net = r2(o.cost - o.recTotal);
    if (!(p.lines || []).filter(Boolean).length) { o.net = r2(num(p.netPay != null && p.netPay !== '' ? p.netPay : p.total)); o.gross = o.cost = o.net; }
    var opening = empBefore(b, emp, dt, ex), paid = run && run.state === 'posted' ? r2(num(paidBy(b, run)[emp])) : 0;
    o.account = { opening: opening, net: o.net, paid: paid, closing: r2(opening + o.net - paid) };
    o.loans.forEach(function (x) { x.recovered = r2(x.recovered); x.opening = loanOs(b, x.acct, emp, dt, ex); x.closing = r2(x.opening - x.recovered); });
    return o;
  }

  P.SECS = SECS; P.items = items; P.findItem = findItem; P.paySetup = paySetup; P.setupTotals = setupTotals; P.hasSetup = hasSetup; P.empActive = empActive;
  P.monthEnd = monthEnd; P.addMonths = addMonths; P.monthLabel = monthLabel;
  P.runs = runs; P.runById = runById; P.lastRun = lastRun; P.nextMonth = nextMonth;
  P.prefill = prefill; P.rowTotals = rowTotals; P.draftTotals = draftTotals; P.validate = validate; P.saveDraft = saveDraft; P.create = create;
  P.figures = figures; P.status = status; P.pay = pay; P.deleteRun = deleteRun; P.summary = summary; P.reminders = reminders; P.wpsTable = wpsTable;
  P.periodDays = periodDays; P.paySettings = paySettings; P.daysCalc = daysCalc; P.daysError = daysError; P.proKind = proKind; P.absentLine = absentLine; P.proDesc = proDesc; P.isoDate = isoDate;
  P.basisLabel = basisLabel; P.psDays = psDays; P.addColCtl = addColCtl; P.WEEKENDS = WEEKENDS;
  P.runIdOf = runIdOf; P.editDraft = editDraft; P.saveRunEdit = saveRunEdit; P.onPayslipSaved = onPayslipSaved; P.onPayslipDeleted = onPayslipDeleted; P.payslipDeleteBlock = payslipDeleteBlock;
  P.reconcile = reconcile; P.rebuild = rebuild; P.migrate = migrate; P.runPosting = runPosting; P.clearingCheck = clearingCheck; P.itemsNoAccount = itemsNoAccount; P.runDays = runDays; P.paidBy = paidBy;
  P.dedType = dedType; P.loanOs = loanOs; P.empBefore = empBefore; P.rowRecov = rowRecov; P.balTxt = balTxt; P.payslipSections = payslipSections; P.isRec = isRec;
  P.registerReminders = registerReminders; P.install = install; P.pageHtml = pageHtml; P.ui = UI;
  global.Payroll = P;
  registerPosting();
  install();
  try { if (doc() && doc().addEventListener) doc().addEventListener('DOMContentLoaded', function () { install(); registerReminders(); }); } catch (e) {}
  try { if (global.addEventListener) global.addEventListener('load', registerReminders); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
