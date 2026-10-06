/* ===================== Bank Loans & Finance =====================
   A "Bank Loans & Finance" tab in the Banking group: term loans, vehicle loans,
   asset finance, overdrafts / short-term loans — each with its amortisation
   schedule, EMI payments, interest accrual and current / non-current split.

   Record (b.records.loans[]):
     { id, uuid, lender, ref, type, principal, date (disbursement),
       disbursedTo:'bank'|'account'|'opening', bankAccount, disbAccount, disbSub, openingDate,
       method:'reducing'|'flat'|'interestOnly', flatSplit:'rule78'|'straight', dayCount:'period'|'act365',
       rate (annual %), n (instalments), freq:'monthly'|'quarterly'|'semiannual'|'annual', firstDate, emi (optional fixed instalment),
       onChange:'emi'|'tenure', accrue (bool), fee, feeFrom (bank name | '__deduct__'), feeTreatment:'expense'|'amortise',
       accounts:{ nc, cur, interest, accrued, fee, prepaid }, payFrom, bankBalance, bankBalanceDate, notes,
       overrides:{ <no>: { date, shift, emi, interest, principal, rate, remaining } } }

   Schedule maths (schedule()):
     reducing:  EMI = P·r / (1 − (1 + r)^−n),  r = annual rate × months per instalment / 12;
                interest = opening balance × r  (or × days / 365 with "Actual days / 365");
                principal = EMI − interest; the last row clears the balance.
     flat:      total interest = P × rate × months / 12; EMI = (P + total interest) / n;
                interest per row by Rule of 78 (row k of n gets (n − k + 1) / (n(n + 1)/2)) or straight-line.
     interest only: interest every row, principal on the last row.
     A changed row (EMI / interest / principal / rate / remaining instalments) or an extra
     payment re-plans the rows after it: keep the tenure (new EMI over the remaining rows) or,
     for reducing loans set to "keep EMI", keep the instalment and finish earlier. A short payment
     leaves arrears that are added to the next row. Paid rows always show what the linked
     Payment posted, so the schedule and the ledger never disagree.

   Accounting (all through the general ledger, js/ledger-engine.js — GL.registerSource('loans')):
     disbursement   Dr bank (or the supplier / asset account) / Cr loan current + non-current
                    (an existing loan: Dr Starting balance equity, undated, for the balance at the opening date)
     processing fee Dr fee expense (or Prepaid loan fees, amortised straight-line at month ends) / Cr bank
                    (or deducted from the proceeds)
     EMI            a real Payment: Dr loan (principal), Dr interest expense / Cr bank — linked both ways
     month ends     Dr non-current / Cr current for the movement in the current portion (due within 12 months);
                    Dr interest expense / Cr accrued interest for interest earned but not yet paid,
                    reversed the next day (the EMI then posts the full interest)
   so the Trial Balance stays Dr = Cr and the Balance Sheet shows the loan split current / non-current.
   ================================================================== */
(function(global){
  'use strict';
  var A = global.App || (typeof App !== 'undefined' ? App : null);
  if(!A || A.__loans) return;
  A.__loans = 1;

  var KEY = 'loans', LABEL = 'Bank Loans & Finance';
  var TYPES = ['Term loan', 'Vehicle loan', 'Equipment / asset finance', 'Overdraft / short-term loan', 'Other'];
  var METHODS = { reducing:'Reducing balance (EMI)', flat:'Flat rate', interestOnly:'Interest only (principal at maturity)' };
  var FREQS = { monthly:['Monthly', 1], quarterly:['Quarterly', 3], semiannual:['Half-yearly', 6], annual:['Yearly', 12] };
  var BANKS = ['ADCB', 'Ajman Bank', 'Abu Dhabi Islamic Bank', 'Commercial Bank of Dubai', 'Dubai Islamic Bank', 'Emirates Islamic', 'Emirates NBD',
    'First Abu Dhabi Bank', 'Mashreq', 'National Bank of Fujairah', 'National Bank of Ras Al Khaimah (RAKBANK)', 'Sharjah Islamic Bank', 'United Arab Bank', 'HSBC', 'Standard Chartered'];
  var ST_CLASS = { Paid:'st-paid', Overdue:'st-overdue', Due:'st-partial', Scheduled:'st-draft', 'Before books':'st-draft', Active:'st-unpaid', Closed:'st-paid' };

  var hasDoc = typeof document !== 'undefined' && document && typeof document.getElementById === 'function';
  function byId(id){ try{ return hasDoc ? document.getElementById(id) : null; }catch(e){ return null; } }
  function esc(s){ return A.esc(s == null ? '' : s); }
  function num(v){ if(v == null || v === '') return 0; if(typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v).replace(/,/g, '').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
  function r2(v){ return Math.round(((Number(v) || 0) + ((Number(v) || 0) >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function blank(v){ return v == null || String(v).trim() === ''; }
  function has(v){ return !blank(v); }
  function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function money(n){ try{ return A.money(n); }catch(e){ return r2(n).toFixed(2); } }
  function m2(n){ return r2(n).toFixed(2); }
  function fmtD(s){ try{ return A.fmtDate ? A.fmtDate(s) : A.fmtDateUS(s); }catch(e){ return String(s || ''); } }
  function pct(v){ var n = num(v); return (Math.round(n * 10000) / 10000) + '%'; }
  function M(){ return global.UIModal || null; }
  function say(t){ var m = M(); if(m) return m.alert(t); try{ alert(t); }catch(e){} return Promise.resolve(); }
  function ask(t, o){ var m = M(); if(m) return m.confirm(t, o); return Promise.resolve(true); }
  function toast(t){ var m = M(); if(m && m.toast) m.toast(t); }
  function G(n){ return (typeof global[n] === 'function') ? global[n] : null; }
  function wrap(name, fn){ var orig = A[name]; if(typeof orig !== 'function') return; A[name] = function(){ return fn.call(this, orig, arguments); }; }
  function curKey(){ return (typeof LABEL2KEY !== 'undefined') ? LABEL2KEY[A.wsSection] : null; }
  function cur(){ try{ return A.curBiz(); }catch(e){ return null; } }
  function ro(b){ try{ return typeof A.isReadOnly === 'function' ? A.isReadOnly(b) : false; }catch(e){ return false; } }
  function guard(b){ return !(typeof A.guardWrite === 'function') || A.guardWrite(b, 3); }

  /* ------------------------------------------------------------------ dates (calendar days, never UTC shifts) */
  function p2(n){ return (n < 10 ? '0' : '') + n; }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function iso(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[0] : ''; }
  function dayNum(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; }
  function fromDay(n){ var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  function addDays(s, n){ var x = dayNum(s); return x == null ? '' : fromDay(x + n); }
  function daysBetween(a, b){ var x = dayNum(a), y = dayNum(b); return (x == null || y == null) ? null : Math.round(y - x); }
  function dim(y, m){ return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /** s + k months, on day `dom` (clamped to the month's last day) */
  function addMonths(s, k, dom){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if(!m) return '';
    var y = +m[1], mo = +m[2] - 1 + k; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
    return y + '-' + p2(mo + 1) + '-' + p2(Math.min(dom || +m[3], dim(y, mo + 1))); }
  function eom(s){ var m = /^(\d{4})-(\d{2})/.exec(String(s || '')); return m ? m[1] + '-' + m[2] + '-' + p2(dim(+m[1], +m[2])) : ''; }
  function nextEom(s){ var e = eom(s); return e > s ? e : eom(addDays(s, 1)); }

  /* ------------------------------------------------------------------ maths */
  /** level instalment that repays P over n periods at period rate r */
  function annuity(P, r, n){ n = Math.max(1, n | 0); if(!(Math.abs(r) > 1e-12)) return r2(P / n); return r2(P * r / (1 - Math.pow(1 + r, -n))); }
  /** split a flat-rate total interest over m rows: Rule of 78 (sum of digits) or straight-line; the last row takes the rounding */
  function splitFlat(total, m, how){ m = Math.max(1, m | 0); var out = [], s = 0, sod = m * (m + 1) / 2;
    for(var j = 0; j < m; j++){ var v = j === m - 1 ? r2(total - s) : r2(how === 'straight' ? total / m : total * (m - j) / sod); out.push(v); s = r2(s + v); }
    return out; }
  function perMonths(L){ var f = FREQS[L && L.freq]; return f ? f[1] : 1; }
  function methodOf(L){ return METHODS[L && L.method] ? L.method : 'reducing'; }

  /* ------------------------------------------------------------------ model */
  function recs(b){ return (b && b.records && b.records[KEY]) || []; }
  function find(b, id){ return recs(b).find(function(r){ return String(r.id) === String(id); }) || null; }
  function label(L){ return (L.lender || 'Loan') + (blank(L.ref) ? '' : ' ' + L.ref); }
  function remindDays(b){ var v = parseInt(b && b.loanSettings && b.loanSettings.remindDays, 10); return isNaN(v) || v < 0 ? 5 : Math.min(v, 365); }
  var lastId = 0;
  function newId(b, key){ var t = Date.now(), max = 0; (((b.records || {})[key]) || []).forEach(function(r){ if(Number(r.id) > max) max = Number(r.id); });
    lastId = Math.max(t, lastId + 1, max + 1); return lastId; }
  function uuid(){ try{ return A.uuid(); }catch(e){ return 'loan-' + Date.now().toString(36) + Math.random().toString(36).slice(2); } }
  function log(b, action, key, rec, before, lbl){ try{ A._logActivity(b, action, key, rec, before, lbl ? { label:lbl } : null); }catch(e){} }
  function lockMsg(b, d){ var lk = (b && b.lockDate) || ''; if(lk && d && d <= lk) return 'The date ' + fmtD(d) + ' is on or before the lock date (' + fmtD(lk) + '). Choose a later date or update Settings → Lock Date.'; return ''; }
  function refreshReminders(){ try{ if(global.Reminders && typeof global.Reminders.refresh === 'function') global.Reminders.refresh(); }catch(e){} }
  function afterChange(b){ try{ var rs = G('refreshSummary'); if(rs) rs(b); }catch(e){} }
  function banks(b){ return (((b && b.records) || {}).bankCash || []).filter(function(x){ return x && x.name && !x.inactive; }).map(function(x){ return x.name; }); }
  function bankExists(b, n){ return !blank(n) && (((b.records || {}).bankCash) || []).some(function(x){ return x && x.name === n; }); }
  function acct(b, id){ return ((b && b.coa) || []).find(function(n){ return n && n.type === 'account' && String(n.id) === String(id); }) || null; }
  function acctNm(b, id){ var n = acct(b, id); return n ? n.name : ''; }

  /* ---- accounts: created on first use with fixed ids (lossless, idempotent); an existing account of the same name is reused */
  var ACC = {
    nc:      { id:'sys_loan_nc',      name:'Bank loans - non-current',    re:/^(bank )?(loans?|borrowings?)\s*[-–—(]\s*non[- ]?current\)?$/i, parent:'@loans' },
    cur:     { id:'sys_loan_cur',     name:'Bank loans - current portion', re:/^(bank )?(loans?|borrowings?)\s*[-–—(]\s*current( portion)?\)?$/i, parent:'@loans' },
    interest:{ id:'sys_loan_int',     name:'Interest expense',            re:/^(interest expense|interest on (bank )?loans?|finance costs?)$/i, parent:'@expense' },
    accrued: { id:'sys_loan_accr',    name:'Accrued interest',            re:/^accrued interest( payable)?$/i, parent:'liabilities' },
    fee:     { id:'sys_loan_fee',     name:'Loan processing fees',        re:/^loan (processing|arrangement) fees?$/i, parent:'@expense' },
    prepaid: { id:'sys_loan_prepaid', name:'Prepaid loan fees',           re:/^(prepaid|unamorti[sz]ed) loan fees?$/i, parent:'assets' }
  };
  function expenseGroup(b){
    var c = b.coa || (b.coa = []);
    var g = c.find(function(n){ return n && n.type === 'group' && n.parent === 'pl' && n.plkind === 'expense'; });
    if(g) return g.id;
    c.push({ id:'sys_g_expense', type:'group', name:'Expenses', code:'', parent:'pl', plkind:'expense' });
    b.coaTop = b.coaTop || { bs:['assets', 'liabilities', 'equity'], pl:[] }; b.coaTop.pl = b.coaTop.pl || [];
    var ti = b.coaTop.pl.findIndex(function(x){ var n = c.find(function(y){ return y.id === x; }); return n && n.type === 'total'; });
    if(ti < 0) b.coaTop.pl.push('sys_g_expense'); else b.coaTop.pl.splice(ti, 0, 'sys_g_expense');
    return 'sys_g_expense';
  }
  function loansGroup(b){
    var c = b.coa || (b.coa = []);
    if(!c.some(function(n){ return n && n.id === 'sys_g_loans'; })) c.push({ id:'sys_g_loans', type:'group', name:'Bank loans', code:'', parent:'liabilities' });
    return 'sys_g_loans';
  }
  /** id of the account for `role`, creating it if `create` (returns '' when absent and not created) */
  function roleAcct(b, role, create){
    var d = ACC[role], c = b.coa || (b.coa = []);
    var n = c.find(function(x){ return x && x.type === 'account' && x.id === d.id; }) || c.find(function(x){ return x && x.type === 'account' && d.re.test(String(x.name || '').trim()); });
    if(n) return n.id; if(!create) return '';
    var parent = d.parent === '@loans' ? loansGroup(b) : d.parent === '@expense' ? expenseGroup(b) : d.parent;
    c.push({ id:d.id, type:'account', name:d.name, code:'', parent:parent, balance:0, sys:1 });
    return d.id;
  }
  /** fill the loan's account roles (defaults created when missing) */
  function ensureAccounts(b, L){
    var a = L.accounts = Object.assign({}, L.accounts || {});
    ['nc', 'interest', 'accrued'].forEach(function(k){ if(blank(a[k]) || !acct(b, a[k])) a[k] = roleAcct(b, k, true); });
    if(a.cur === undefined || (!blank(a.cur) && !acct(b, a.cur))) a.cur = roleAcct(b, 'cur', true);
    if(a.cur === a.nc) a.cur = '';
    if(num(L.fee) > 0){ if(blank(a.fee) || !acct(b, a.fee)) a.fee = roleAcct(b, 'fee', true);
      if(L.feeTreatment === 'amortise' && (blank(a.prepaid) || !acct(b, a.prepaid))) a.prepaid = roleAcct(b, 'prepaid', true); }
    return a;
  }

  /* ---- the Payments linked to a loan, split into principal / interest / other */
  function loanDocs(b, L){ return (((b && b.records) || {}).payments || []).filter(function(p){ return p && p.loanId != null && String(p.loanId) === String(L.id); }); }
  function docParts(L, p){
    var ac = L.accounts || {}, out = { principal:0, interest:0, cur:0, other:0, amount:0 };
    var lns = (p.lines && p.lines.length) ? p.lines : [{ account:p.account, amount:p.amount }], sum = 0;
    lns.forEach(function(ln){ if(!ln) return; var a = num(ln.amount != null && ln.amount !== '' ? ln.amount : ln.net); sum += a;
      if(ln.account === ac.nc || (ac.cur && ln.account === ac.cur)){ out.principal += a; if(ac.cur && ln.account === ac.cur) out.cur += a; }
      else if(ln.loanPart === 'interest' || ln.account === ac.interest) out.interest += a;
      else out.other += a; });
    out.amount = (p.amount != null && p.amount !== '') ? num(p.amount) : sum;
    ['principal', 'interest', 'cur', 'other', 'amount'].forEach(function(k){ out[k] = r2(out[k]); });
    return out;
  }

  /* ------------------------------------------------------------------ the schedule */
  /**
   * The amortisation schedule of loan L, with the payments made against it.
   * Rows: { no, date, start, opening, emi (due incl. arrears), arrears, interest, principal, closing,
   *         status:'Paid'|'Overdue'|'Due'|'Scheduled'|'Before books', paid, paidDate, paidAmount, difference,
   *         schedInterest, schedPrincipal, manual:[changed fields], docs:[{id, ref, date, amount}] }
   */
  function schedule(b, L, o){
    o = o || {}; var t = iso(o.today) || today();
    var P = r2(num(L.principal)), n = Math.max(1, Math.min(600, parseInt(L.n, 10) || 1)), per = perMonths(L);
    var method = methodOf(L), basis = (method !== 'flat' && L.dayCount === 'act365') ? 'act365' : 'period';
    var mode = (method === 'reducing' && L.onChange === 'tenure') ? 'tenure' : 'emi';
    var ov = L.overrides || {}, rd = remindDays(b);
    var start0 = iso(L.date) || iso(L.openingDate) || t;
    var first = iso(L.firstDate) || addMonths(start0, per);
    var openD = L.disbursedTo === 'opening' ? (iso(L.openingDate) || '') : '';
    /* payments per row */
    var byRow = {}, maxNo = 0, loose = [];
    if(L.id != null) loanDocs(b, L).forEach(function(p){ var x = docParts(L, p), no = parseInt(p.loanRow, 10);
      var d = { id:p.id, ref:p.reference || '', date:iso(p.date), amount:x.amount, principal:x.principal, interest:x.interest, cur:x.cur };
      if(!(no >= 1)){ loose.push(d); return; }
      var g = byRow[no] || (byRow[no] = { amount:0, interest:0, principal:0, cur:0, date:'', docs:[] });
      g.amount = r2(g.amount + x.amount); g.interest = r2(g.interest + x.interest); g.principal = r2(g.principal + x.principal); g.cur = r2(g.cur + x.cur);
      if(d.date > g.date) g.date = d.date; g.docs.push(d); if(no > maxNo) maxNo = no; });

    var rate = num(L.rate), bal = P, N = n, rows = [], emi = 0, flat = {}, arrP = 0, arrI = 0, replan = true;
    var anchor = first, anchorK = 1, dom = +first.slice(8, 10), prevDue = start0;
    var pr = function(){ return rate / 100 * per / 12; };
    function plan(k){ var m = Math.max(1, N - k + 1), base = r2(bal - arrP);
      if(method === 'flat'){ var tot = r2(base * rate / 100 * m * per / 12), sp = splitFlat(tot, m, L.flatSplit === 'straight' ? 'straight' : 'rule78');
        flat = {}; for(var j = 0; j < m; j++) flat[k + j] = sp[j]; emi = r2((base + tot) / m); }
      else if(method === 'interestOnly') emi = 0;
      else emi = (k === 1 && num(L.emi) > 0) ? r2(num(L.emi)) : annuity(base, pr(), m);
    }
    for(var k = 1, guardN = 0; guardN < 1200; guardN++, k++){
      if(k > 1 && bal <= 0.005 && !(k <= maxNo)) break;
      var ox = ov[k] || {}, manual = [];
      if(has(ox.rate)){ rate = num(ox.rate); manual.push('rate'); if(mode === 'emi') replan = true; }
      if(parseInt(ox.remaining, 10) > 0){ N = k - 1 + parseInt(ox.remaining, 10); replan = true; manual.push('remaining'); }
      if(k > N){ N = k; if(mode === 'emi') replan = true; }
      if(replan){ plan(k); replan = false; }
      var due;
      if(has(ox.date) && iso(ox.date)){ due = iso(ox.date); manual.push('date'); if(ox.shift !== false){ anchor = due; anchorK = k; dom = +due.slice(8, 10); } }
      else due = addMonths(anchor, (k - anchorK) * per, dom);
      var opening = r2(bal), startD = prevDue;
      var intCalc = method === 'flat' ? r2(flat[k] || 0) : (basis === 'act365' ? r2(opening * rate / 100 * Math.max(0, daysBetween(startD, due) || 0) / 365) : r2(opening * pr()));
      var schedInt = intCalc, prinBase;
      if(has(ox.interest)){ schedInt = r2(num(ox.interest)); manual.push('interest'); }
      if(has(ox.emi)){ manual.push('emi');
        if(has(ox.principal) && !has(ox.interest)){ prinBase = r2(num(ox.principal)); schedInt = r2(num(ox.emi) - prinBase); manual.push('principal'); }
        else prinBase = r2(num(ox.emi) - schedInt); }
      else if(has(ox.principal)){ manual.push('principal'); prinBase = r2(num(ox.principal)); }
      else if(method === 'interestOnly') prinBase = 0;
      else prinBase = r2(emi - schedInt);
      if(schedInt < 0) schedInt = 0; if(prinBase < 0) prinBase = 0;
      var prin = r2(prinBase + arrP), intDue = r2(schedInt + arrI), last = false;
      if(mode === 'emi' && k >= N){ prin = opening; last = true; }
      if(prin >= opening - 0.005){ prin = Math.max(0, opening); last = true; }
      var dueAmt = r2(prin + intDue);
      var row = { no:k, date:due, start:startD, opening:opening, emi:dueAmt, arrears:r2(arrP + arrI), interest:intDue, principal:prin,
        schedInterest:intDue, schedPrincipal:prin, manual:manual, paid:false, paidDate:'', paidAmount:0, difference:0, docs:[] };
      var pay = byRow[k];
      if(pay){
        row.paid = true; row.status = 'Paid'; row.paidDate = pay.date; row.paidAmount = pay.amount; row.interest = pay.interest; row.principal = pay.principal;
        row.paidCur = pay.cur; row.difference = r2(pay.amount - dueAmt); row.docs = pay.docs; row.closing = r2(opening - pay.principal);
        var shortI = r2(intDue - pay.interest), shortP = r2(prin - pay.principal);
        arrI = shortI > 0.005 ? shortI : 0; arrP = shortP > 0.005 ? shortP : 0;
        if(shortP < -0.005 && mode === 'emi') replan = true;          /* extra principal paid: re-plan the rest */
      } else if(openD && due < openD){
        row.before = true; row.status = 'Before books'; row.paidDate = due; row.closing = r2(opening - prin); arrI = 0; arrP = 0;
      } else {
        row.closing = r2(opening - prin); arrI = 0; arrP = 0;
        var dd = daysBetween(t, due); row.dueIn = dd; row.status = dd < 0 ? 'Overdue' : (dd <= rd ? 'Due' : 'Scheduled');
      }
      if(mode === 'emi' && manual.some(function(f){ return f === 'emi' || f === 'principal' || f === 'interest' || (f === 'date' && basis === 'act365'); })) replan = true;
      rows.push(row); bal = row.closing; prevDue = due;
      if(last && bal > 0.005){ N = k + 1; replan = true; }      /* last row paid short: one more row for the rest */
    }
    var T = { emi:0, interest:0, principal:0, paid:0, difference:0 };
    rows.forEach(function(r){ T.emi += r.emi; T.interest += r.interest; T.principal += r.principal; T.paid += r.paidAmount; T.difference += r.paid ? r.difference : 0; });
    Object.keys(T).forEach(function(x){ T[x] = r2(T[x]); });
    var paidPrin = 0; rows.forEach(function(r){ if((r.paid || r.before) && r.paidDate <= t) paidPrin += r.principal; });
    var next = rows.find(function(r){ return !r.paid && !r.before; }) || null;
    return { rows:rows, totals:T, start:start0, openingDate:openD, first:first, endDate:rows.length ? rows[rows.length - 1].date : first,
      instalment:(rows.find(function(r){ return !r.before; }) || rows[0] || { emi:0 }).emi,
      principal:P, method:method, basis:basis, mode:mode, perMonths:per, loose:loose,
      outstanding:r2(P - paidPrin), next:next, overdue:rows.filter(function(r){ return r.status === 'Overdue'; }), today:t };
  }

  /* memo: the list renders many columns per loan */
  var MEMO = {};
  function sched(b, L){
    var fp; try{ fp = JSON.stringify([L, loanDocs(b, L), today(), remindDays(b), b.lockDate || '']); }catch(e){ return schedule(b, L); }
    var k = String(b.id) + ':' + L.id, m = MEMO[k];
    if(m && m.fp === fp) return m.s;
    var s = schedule(b, L); MEMO[k] = { fp:fp, s:s }; return s;
  }

  /* ------------------------------------------------------------------ classification & accrual */
  /** outstanding principal at d, its current part (due within 12 months, incl. overdue) and the rest */
  function classifyAt(S, d){
    if(!d || (d < S.start && !S.openingDate)) return { outstanding:0, current:0, noncurrent:0 };
    var out = S.principal, curr = 0, horizon = addMonths(d, 12);
    S.rows.forEach(function(r){
      var paidBy = (r.paid || r.before) && r.paidDate && r.paidDate <= d;
      if(paidBy) out -= r.principal;
      else if(r.date <= horizon) curr += r.principal; });
    out = r2(out); curr = r2(Math.max(0, Math.min(curr, out)));
    return { outstanding:out, current:curr, noncurrent:r2(out - curr) };
  }
  /** interest earned up to d on instalments not yet paid at d (pro-rata by days within the instalment period) */
  function accruedAt(S, d){
    var s = 0;
    S.rows.forEach(function(r){
      if(r.before) return;
      if(r.paid && r.paidDate && r.paidDate <= d) return;
      if(!(r.start < d)) return;
      if(r.date <= d) s += r.interest;
      else { var all = daysBetween(r.start, r.date) || 0, part = daysBetween(r.start, d) || 0; if(all > 0) s += r.interest * part / all; } });
    return r2(s);
  }
  function classify(b, L, d){ var S = sched(b, L); var c = classifyAt(S, d); c.accrued = L.accrue === false ? 0 : accruedAt(S, d); c.schedule = S; return c; }
  function statusOf(b, L){ var S = sched(b, L); if(S.outstanding <= 0.005 && !S.next) return 'Closed'; if(S.overdue.length) return 'Overdue'; return 'Active'; }

  /* ------------------------------------------------------------------ general ledger postings (registered source) */
  function postings(b, api){
    var out = [], t = api && api.today ? api.today() : today();
    recs(b).forEach(function(L){ try{ loanPostings(b, L, api, t, out); }catch(e){ try{ console.warn('Loan postings failed', e); }catch(x){} } });
    return out;
  }
  function loanPostings(b, L, api, t, out){
    var P = r2(num(L.principal)); if(!(P > 0)) return;
    var opening = L.disbursedTo === 'opening', D = opening ? iso(L.openingDate) : iso(L.date); if(!D) return;
    var ac = L.accounts || {}, nc = ac.nc, cu = (ac.cur && ac.cur !== ac.nc) ? ac.cur : '';
    var S = schedule(b, L, { today:t }), nm = label(L);
    var meta = function(date, type){ return { src:KEY, id:L.id, date:date, ref:L.ref || '', type:type + ' — ' + nm, party:L.lender || '', desc:L.notes || '' }; };
    var E = function(a, v, typ){ return api.acctEnt(a, '', v, { t:typ }); };
    var c0 = classifyAt(S, opening ? addDays(D, -1) : D);
    var curAmt = cu ? c0.current : 0, ncAmt = r2(c0.outstanding - curAmt);
    var ents = [], fee = r2(num(L.fee)), deduct = fee > 0 && L.feeFrom === '__deduct__', amort = fee > 0 && L.feeTreatment === 'amortise';
    var feeAcct = amort ? ac.prepaid : ac.fee, typD = opening ? 'Loan opening balance' : 'Loan disbursement';
    if(opening) ents.push({ a:api.SBE, v:c0.outstanding, t:typD });
    else {
      var recv = r2(P - (deduct ? fee : 0));
      ents.push(L.disbursedTo === 'account' ? api.acctEnt(L.disbAccount, L.disbSub || '', recv, { t:typD }) : api.bankEnt(L.bankAccount, recv, typD));
      if(deduct) ents.push(E(feeAcct, fee, 'Processing fee deducted'));
    }
    if(curAmt) ents.push(E(cu, -curAmt, typD + ' (current portion)'));
    if(ncAmt) ents.push(E(nc, -ncAmt, typD + (cu ? ' (non-current)' : '')));
    out.push({ meta:meta(opening ? '' : D, typD), ents:ents });
    if(!opening && fee > 0 && !deduct) out.push({ meta:meta(D, 'Loan processing fee'), ents:[ E(feeAcct, fee, 'Loan processing fee'), api.bankEnt(L.feeFrom || L.bankAccount, -fee, 'Loan processing fee') ] });

    /* month ends up to today: current-portion movement, interest accrual (reversed next day), fee amortisation */
    var pays = []; S.rows.forEach(function(r){ (r.docs || []).forEach(function(d){ pays.push(d); }); }); (S.loose || []).forEach(function(d){ pays.push(d); });
    var endD = S.endDate, glCur = curAmt, prev = opening ? addDays(D, -1) : D, cum = 0, feeDays = daysBetween(D, endD) || 0;
    var points = [], e = nextEom(prev), guardN = 0;
    while(e && e <= t && guardN++ < 2400){ points.push({ d:e, eom:true }); e = eom(addDays(e, 1)); }
    if(amort && !opening && endD <= t && !points.some(function(p){ return p.d === endD; })) points.push({ d:endD });
    points.sort(function(x, y){ return x.d < y.d ? -1 : x.d > y.d ? 1 : 0; });
    points.forEach(function(p){
      if(p.eom && cu){
        pays.forEach(function(d){ if(d.date > prev && d.date <= p.d) glCur = r2(glCur - d.cur); });
        var target = classifyAt(S, p.d).current, dv = r2(target - glCur);
        if(Math.abs(dv) > 0.005) out.push({ meta:meta(p.d, 'Current portion of loan'), ents:[ E(nc, dv, 'Current portion reclassified'), E(cu, -dv, 'Current portion reclassified') ] });
        glCur = target; prev = p.d;
      }
      if(p.eom && L.accrue !== false){
        var acc = accruedAt(S, p.d);
        if(acc > 0.005){
          out.push({ meta:meta(p.d, 'Interest accrued'), ents:[ E(ac.interest, acc, 'Interest accrued'), E(ac.accrued, -acc, 'Interest accrued') ] });
          out.push({ meta:meta(addDays(p.d, 1), 'Interest accrual reversed'), ents:[ E(ac.accrued, acc, 'Interest accrual reversed'), E(ac.interest, -acc, 'Interest accrual reversed') ] });
        }
      }
      if(amort && !opening){
        var target2 = feeDays > 0 ? r2(fee * Math.min(1, Math.max(0, daysBetween(D, p.d)) / feeDays)) : fee;
        if(p.d >= endD) target2 = fee;
        var fv = r2(target2 - cum);
        if(fv > 0.005){ out.push({ meta:meta(p.d, 'Loan fee amortised'), ents:[ E(ac.fee, fv, 'Loan fee amortised'), E(ac.prepaid, -fv, 'Loan fee amortised') ] }); cum = target2; }
      }
    });
  }
  if(typeof GL !== 'undefined' && GL && typeof GL.registerSource === 'function') GL.registerSource(KEY, postings);

  /* ------------------------------------------------------------------ create / update / delete */
  function clean(b, v){
    var d = {
      lender:String(v.lender || '').trim(), ref:String(v.ref || '').trim(), type:TYPES.indexOf(v.type) >= 0 ? v.type : 'Term loan',
      principal:r2(num(v.principal)), date:iso(v.date), disbursedTo:(v.disbursedTo === 'account' || v.disbursedTo === 'opening') ? v.disbursedTo : 'bank',
      bankAccount:String(v.bankAccount || '').trim(), disbAccount:String(v.disbAccount || '').trim(), disbSub:String(v.disbSub || '').trim(), openingDate:iso(v.openingDate),
      method:METHODS[v.method] ? v.method : 'reducing', flatSplit:v.flatSplit === 'straight' ? 'straight' : 'rule78', dayCount:v.dayCount === 'act365' ? 'act365' : 'period',
      rate:num(v.rate), n:parseInt(v.n, 10) || 0, freq:FREQS[v.freq] ? v.freq : 'monthly', firstDate:iso(v.firstDate), emi:blank(v.emi) ? '' : r2(num(v.emi)),
      onChange:v.onChange === 'tenure' ? 'tenure' : 'emi', accrue:!(v.accrue === false || v.accrue === 'false' || v.accrue === 0),
      fee:r2(num(v.fee)), feeFrom:String(v.feeFrom || '').trim(), feeTreatment:v.feeTreatment === 'amortise' ? 'amortise' : 'expense',
      payFrom:String(v.payFrom || '').trim(), bankBalance:blank(v.bankBalance) ? '' : r2(num(v.bankBalance)), bankBalanceDate:iso(v.bankBalanceDate),
      notes:String(v.notes || '').trim(), accounts:Object.assign({}, v.accounts || {})
    };
    if(!d.lender) return { ok:false, error:'Enter the lender (bank or finance company).' };
    if(!(d.principal > 0)) return { ok:false, error:'Enter the loan amount (principal).' };
    if(!d.date) return { ok:false, error:'Enter the disbursement date.' };
    if(d.disbursedTo === 'bank' && !bankExists(b, d.bankAccount)) return { ok:false, error:'Choose the bank account the loan was paid into.' };
    if(d.disbursedTo === 'account' && !acct(b, d.disbAccount)) return { ok:false, error:'Choose the account the loan was paid to (supplier / asset).' };
    if(d.disbursedTo === 'account'){ try{ var n0 = acct(b, d.disbAccount), sk = (typeof GL !== 'undefined') ? GL.subKind(b, n0) : null;
      if(sk && blank(d.disbSub)) return { ok:false, error:'"' + n0.name + '" needs a ' + (sk === 'suppliers' ? 'supplier' : sk === 'fixedAssets' ? 'fixed asset' : 'sub-account') + ' — enter it next to the account.' }; }catch(e){} }
    if(d.disbursedTo === 'opening' && !d.openingDate) return { ok:false, error:'Enter the opening balance date (the day your books start for this loan).' };
    if(d.disbursedTo === 'opening' && d.openingDate < d.date) {} // fine: an older loan
    if(d.rate < 0 || d.rate > 100) return { ok:false, error:'The annual rate must be between 0 and 100 %.' };
    if(!(d.n >= 1 && d.n <= 600)) return { ok:false, error:'Enter the number of instalments (1 – 600).' };
    if(d.firstDate && d.firstDate < d.date) return { ok:false, error:'The first instalment date cannot be before the disbursement date.' };
    if(d.fee < 0) return { ok:false, error:'The processing fee cannot be negative.' };
    if(d.fee > 0 && d.disbursedTo !== 'opening' && d.feeFrom !== '__deduct__' && !bankExists(b, d.feeFrom || d.bankAccount)) return { ok:false, error:'Choose the bank account the processing fee was paid from (or "Deducted from the loan").' };
    if(d.fee > 0 && d.feeFrom === '__deduct__' && d.fee >= d.principal) return { ok:false, error:'The fee is more than the loan.' };
    if(d.fee > 0 && d.disbursedTo === 'opening') return { ok:false, error:'An existing loan brought in as an opening balance has no processing fee here — record any unamortised fee as its own opening balance.' };
    if(d.payFrom && !bankExists(b, d.payFrom)) d.payFrom = '';
    if(!d.firstDate) d.firstDate = addMonths(d.date, (FREQS[d.freq] || [0, 1])[1]);
    return { ok:true, data:d };
  }
  var FIELDS = ['lender', 'ref', 'type', 'principal', 'date', 'disbursedTo', 'bankAccount', 'disbAccount', 'disbSub', 'openingDate', 'method', 'flatSplit', 'dayCount', 'rate', 'n', 'freq',
    'firstDate', 'emi', 'onChange', 'accrue', 'fee', 'feeFrom', 'feeTreatment', 'payFrom', 'bankBalance', 'bankBalanceDate', 'notes'];
  /** Create (id == null) or update a loan. Returns {ok, record} or {ok:false, error}. */
  function upsert(b, v, id, opts){
    var c = clean(b, v); if(!c.ok) return c; var d = c.data;
    b.records = b.records || {}; var arr = b.records[KEY] = b.records[KEY] || [];
    var dup = arr.find(function(r){ return String(r.id) !== String(id) && !blank(d.ref) && String(r.ref || '').trim().toLowerCase() === d.ref.toLowerCase() && String(r.lender || '').trim().toLowerCase() === d.lender.toLowerCase(); });
    if(dup) return { ok:false, error:'Loan ' + d.ref + ' with ' + d.lender + ' is already recorded.' };
    var postDate = d.disbursedTo === 'opening' ? '' : d.date;
    if(id != null){
      var r = find(b, id); if(!r) return { ok:false, error:'This loan no longer exists.' };
      var before = clone(r);
      var moneyChanged = ['principal', 'date', 'disbursedTo', 'bankAccount', 'disbAccount', 'fee', 'feeFrom'].some(function(k){ return String(before[k] == null ? '' : before[k]) !== String(d[k] == null ? '' : d[k]); });
      if(moneyChanged){ var lm = lockMsg(b, before.disbursedTo === 'opening' ? '' : before.date) || lockMsg(b, postDate); if(lm) return { ok:false, error:lm }; }
      FIELDS.forEach(function(k){ r[k] = d[k]; });
      r.accounts = Object.assign({}, r.accounts || {}, d.accounts || {});
      ensureAccounts(b, r);
      log(b, 'update', KEY, r, before, 'Loan ' + label(r));
      if(!(opts && opts.noSave)) A.saveBiz(b);
      return { ok:true, record:r };
    }
    var lm2 = lockMsg(b, postDate); if(lm2) return { ok:false, error:lm2 };
    var rec = Object.assign({ id:newId(b, KEY), uuid:uuid(), created:today(), overrides:{} }, d);
    ensureAccounts(b, rec);
    arr.push(rec);
    log(b, 'create', KEY, rec, null, 'Loan ' + label(rec));
    if(!(opts && opts.noSave)) A.saveBiz(b);
    return { ok:true, record:rec };
  }
  function remove(b, id){
    var r = find(b, id); if(!r) return { ok:false, error:'This loan no longer exists.' };
    var n = loanDocs(b, r).length;
    if(n) return { ok:false, error:'This loan has ' + n + ' EMI payment' + (n === 1 ? '' : 's') + '. Undo them first (or delete the payments) — the loan is kept so nothing is lost.' };
    var lm = lockMsg(b, r.disbursedTo === 'opening' ? '' : r.date); if(lm) return { ok:false, error:lm };
    var before = clone(r);
    b.records[KEY] = recs(b).filter(function(x){ return x !== r; });
    log(b, 'delete', KEY, null, before, 'Loan ' + label(before));
    A.saveBiz(b);
    return { ok:true };
  }

  /* ---- row changes: date (shift following), EMI, interest, principal, rate from this row, remaining instalments */
  var OV_KEYS = ['date', 'shift', 'emi', 'interest', 'principal', 'rate', 'remaining'];
  function setRow(b, id, no, v, opts){
    var L = find(b, id); if(!L) return { ok:false, error:'This loan no longer exists.' };
    var S = schedule(b, L), row = S.rows.find(function(r){ return r.no === no; }) || (no === S.rows.length + 1 ? { no:no } : null);
    if(!row) return { ok:false, error:'Instalment ' + no + ' is not on the schedule.' };
    var o = {};
    if(has(v.date)){ if(!iso(v.date)) return { ok:false, error:'Enter a valid due date.' }; o.date = iso(v.date); if(v.shift === false || v.shift === 'false') o.shift = false; }
    ['emi', 'interest', 'principal', 'rate'].forEach(function(k){ if(has(v[k])) o[k] = k === 'rate' ? num(v[k]) : r2(num(v[k])); });
    if(has(v.remaining)){ var m = parseInt(v.remaining, 10); if(!(m >= 1 && m <= 600)) return { ok:false, error:'Remaining instalments must be 1 – 600.' }; o.remaining = m; }
    if(row.paid && (has(o.emi) || has(o.interest) || has(o.principal))) return { ok:false, error:'Instalment ' + no + ' is paid — its figures come from the payment. Undo the payment to change them.' };
    if(o.rate != null && (o.rate < 0 || o.rate > 100)) return { ok:false, error:'The rate must be between 0 and 100 %.' };
    if(o.emi != null && o.emi < 0 || o.interest != null && o.interest < 0 || o.principal != null && o.principal < 0) return { ok:false, error:'Amounts cannot be negative.' };
    var before = clone(L);
    L.overrides = L.overrides || {};
    if(Object.keys(o).length) L.overrides[no] = o; else delete L.overrides[no];
    log(b, 'update', KEY, L, before, 'Loan ' + label(L) + ' — instalment ' + no + ' changed');
    if(!(opts && opts.noSave)) A.saveBiz(b);
    return { ok:true, record:L };
  }
  function regenerate(b, id){
    var L = find(b, id); if(!L) return { ok:false, error:'This loan no longer exists.' };
    var before = clone(L); L.overrides = {};
    log(b, 'update', KEY, L, before, 'Loan ' + label(L) + ' — schedule regenerated');
    A.saveBiz(b); return { ok:true, record:L };
  }

  /* ------------------------------------------------------------------ pay EMIs */
  /**
   * Pay instalment `no`: creates a Payment (Dr loan principal, Dr interest expense / Cr bank) linked
   * to the row (payment.loanId / loanRow). opts: {date (default the due date), bankAccount, amount
   * (default the amount due), interest (default the row's interest), reference, noSave}
   */
  function payRow(b, id, no, opts){
    opts = opts || {};
    var L = find(b, id); if(!L) return { ok:false, error:'This loan no longer exists.' };
    var S = schedule(b, L), row = S.rows.find(function(r){ return r.no === no; });
    if(!row) return { ok:false, error:'Instalment ' + no + ' is not on the schedule.' };
    if(row.paid) return { ok:false, error:'Instalment ' + no + ' is already paid.' };
    if(row.before) return { ok:false, error:'Instalment ' + no + ' fell before the opening balance date.' };
    var date = iso(opts.date) || row.date;
    var bank = String(opts.bankAccount || L.payFrom || L.bankAccount || '').trim();
    if(!bankExists(b, bank)) return { ok:false, error:'Choose the bank account the instalment is paid from.' };
    var lm = lockMsg(b, date); if(lm) return { ok:false, error:lm };
    var amount = (opts.amount != null && opts.amount !== '') ? r2(num(opts.amount)) : row.emi;
    if(!(amount > 0)) return { ok:false, error:'Enter the amount paid.' };
    var interest = (opts.interest != null && opts.interest !== '') ? r2(num(opts.interest)) : Math.min(row.interest, amount);
    if(interest < 0) return { ok:false, error:'Interest cannot be negative.' };
    if(interest > amount + 0.004) return { ok:false, error:'Interest (' + money(interest) + ') is more than the amount paid (' + money(amount) + ').' };
    var principal = r2(amount - interest);
    if(principal > row.opening + 0.005) return { ok:false, error:'The principal part (' + money(principal) + ') is more than the outstanding balance (' + money(row.opening) + ').' };
    var ac = ensureAccounts(b, L), pAcct = ac.cur || ac.nc;
    var mk = function(acctId, amt, part, desc){ var n = acct(b, acctId) || { name:'' };
      return { item:'', account:acctId, accountName:n.name, sub:'', desc:desc, description:desc, qty:'', price:amt, discount:'', net:amt, amount:amt, taxAmt:0, tax:'', taxCode:'', taxRate:'', loanPart:part }; };
    var lines = [];
    if(principal > 0) lines.push(mk(pAcct, principal, 'principal', 'Principal — instalment ' + no));
    if(interest > 0) lines.push(mk(ac.interest, interest, 'interest', 'Interest — instalment ' + no));
    var arr = b.records.payments = b.records.payments || [];
    var ref = blank(opts.reference) ? '' : String(opts.reference).trim(); if(!ref){ try{ ref = A.nextRef(b, 'payments'); }catch(e){ ref = String(arr.length + 1); } }
    var isSup = (((b.records || {}).suppliers) || []).some(function(s){ return s && s.name === L.lender; });
    var doc = { reference:ref, date:date, description:'Loan instalment ' + no + ' of ' + S.rows.length + ' — ' + label(L), subtotal:amount, tax:0, total:amount, lines:lines,
      colLineNum:false, colItem:true, showDescCol:true, colQty:false, colDiscount:false, colDivision:false, taxExclusive:false, showTaxCol:false,
      amount:amount, allocations:[], paidFrom:bank, payee:L.lender || '', payeeType:isSup ? 'supplier' : 'other', loanId:L.id, loanUuid:L.uuid || null, loanRow:no };
    doc.id = newId(b, 'payments'); doc.uuid = uuid();
    arr.push(doc);
    try{ var ecc = G('ensureCashControl'); if(ecc) ecc(b); }catch(e){}
    if(!(opts && opts.noSave)) afterChange(b);
    log(b, 'create', 'payments', doc, null);
    if(!opts.noSave) A.saveBiz(b);
    return { ok:true, doc:doc, record:L };
  }
  /** Undo a paid instalment: deletes its payment(s). */
  function unpayRow(b, id, no, opts){
    var L = find(b, id); if(!L) return { ok:false, error:'This loan no longer exists.' };
    var docs = loanDocs(b, L).filter(function(p){ return parseInt(p.loanRow, 10) === no; });
    if(!docs.length) return { ok:false, error:'Instalment ' + no + ' is not paid.' };
    for(var i = 0; i < docs.length; i++){ var lm = lockMsg(b, iso(docs[i].date)); if(lm) return { ok:false, error:lm }; }
    var later = loanDocs(b, L).filter(function(p){ return parseInt(p.loanRow, 10) > no; });
    if(later.length && !(opts && opts.force)) return { ok:false, error:'Later instalments are paid. Undo those first, newest first.' };
    docs.forEach(function(d){ var before = clone(d); b.records.payments = b.records.payments.filter(function(x){ return x !== d; }); log(b, 'delete', 'payments', null, before); });
    afterChange(b);
    if(!(opts && opts.noSave)) A.saveBiz(b);
    return { ok:true, removed:docs.length };
  }
  /** Unpaid instalments due on or before `asOf` (default today) for one loan or every open loan. */
  function dueRows(b, asOf, loanId){
    var d = iso(asOf) || today(), out = [];
    recs(b).forEach(function(L){ if(loanId != null && String(L.id) !== String(loanId)) return;
      var S = sched(b, L); S.rows.forEach(function(r){ if(!r.paid && !r.before && r.date <= d) out.push({ loan:L, row:r }); }); });
    out.sort(function(x, y){ return x.row.date < y.row.date ? -1 : x.row.date > y.row.date ? 1 : (x.row.no - y.row.no); });
    return out;
  }
  /** Pay several instalments; one save. items [{loanId, no}], o {date:'due'|YYYY-MM-DD, bankAccount} */
  function bulkPay(b, items, o){
    o = o || {}; var done = [], failed = [];
    var list = items.slice().sort(function(x, y){ return String(x.loanId).localeCompare(String(y.loanId)) || (x.no - y.no); });
    list.forEach(function(it){ var res = payRow(b, it.loanId, it.no, { date:o.date === 'due' || !o.date ? '' : o.date, bankAccount:o.bankAccount || '', noSave:true });
      if(res.ok) done.push(res.doc); else failed.push({ loanId:it.loanId, no:it.no, error:res.error }); });
    if(done.length){ afterChange(b); A.saveBiz(b); }
    return { done:done, failed:failed };
  }

  /* ------------------------------------------------------------------ reports */
  /** Instalments due in [from, to] (all loans or one), with paid / overdue status and totals. */
  function emiReport(b, o){
    o = o || {}; var from = iso(o.from) || '', to = iso(o.to) || '9999-12-31', t = today(), rows = [];
    var T = { due:{ n:0, emi:0, interest:0, principal:0 }, paid:{ n:0, amount:0, interest:0, principal:0, difference:0 }, overdue:{ n:0, amount:0 }, upcoming:{ n:0, amount:0 }, paidInPeriod:{ n:0, amount:0, interest:0, principal:0 } };
    recs(b).forEach(function(L){ if(o.loanId != null && o.loanId !== '' && String(L.id) !== String(o.loanId)) return;
      var S = sched(b, L);
      S.rows.forEach(function(r){
        if(r.paid && r.paidDate >= from && r.paidDate <= to){ var pp = T.paidInPeriod; pp.n++; pp.amount += r.paidAmount; pp.interest += r.interest; pp.principal += r.principal; }
        if(r.before || r.date < from || r.date > to) return;
        var st = r.status;
        if(o.status && o.status !== 'all' && !(o.status === 'paid' ? r.paid : o.status === 'overdue' ? st === 'Overdue' : o.status === 'unpaid' ? !r.paid : true)) return;
        rows.push({ loan:L, row:r });
        T.due.n++; T.due.emi += r.emi; T.due.interest += r.interest; T.due.principal += r.principal;
        if(r.paid){ T.paid.n++; T.paid.amount += r.paidAmount; T.paid.interest += r.interest; T.paid.principal += r.principal; T.paid.difference += r.difference; }
        else if(st === 'Overdue'){ T.overdue.n++; T.overdue.amount += r.emi; }
        else { T.upcoming.n++; T.upcoming.amount += r.emi; } }); });
    Object.keys(T).forEach(function(k){ Object.keys(T[k]).forEach(function(x){ if(x !== 'n') T[k][x] = r2(T[k][x]); }); });
    rows.sort(function(x, y){ return x.row.date < y.row.date ? -1 : x.row.date > y.row.date ? 1 : label(x.loan).localeCompare(label(y.loan)); });
    return { rows:rows, totals:T, from:from, to:to === '9999-12-31' ? '' : to, today:t };
  }
  /**
   * Classification as at `d` (period from `from`, default 1 January of d's year), per loan:
   * opening, drawn, principal repaid, closing, current (due within 12 months), non-current,
   * interest in instalments due in the period, accrued interest at d, interest expense for the period,
   * the general-ledger balance of the loan accounts and the bank's balance (if entered).
   */
  function classification(b, d, from){
    d = iso(d) || today(); from = iso(from) || (d.slice(0, 4) + '-01-01'); var pb = addDays(from, -1), rows = [];
    var T = { principal:0, opening:0, drawn:0, repaid:0, closing:0, current:0, noncurrent:0, intInst:0, accrued:0, accruedOpen:0, intExp:0, bank:0 };
    recs(b).forEach(function(L){
      var S = sched(b, L), c = classifyAt(S, d), c0 = classifyAt(S, pb);
      var drawn = (L.disbursedTo !== 'opening' && S.start >= from && S.start <= d) ? S.principal : 0;
      var repaid = 0, intInst = 0;
      S.rows.forEach(function(r){ var pd = (r.paid || r.before) ? r.paidDate : ''; if(pd && pd >= from && pd <= d) repaid += r.principal; if(!r.before && r.date >= from && r.date <= d) intInst += r.interest; });
      if(L.disbursedTo === 'opening' && S.openingDate >= from && S.openingDate <= d){ /* brought in during the period: treat as opening */ c0 = classifyAt(S, addDays(S.openingDate, -1)); }
      var acc = L.accrue === false ? 0 : accruedAt(S, d), acc0 = L.accrue === false ? 0 : accruedAt(S, pb);
      if(c.outstanding <= 0.005 && c0.outstanding <= 0.005 && !drawn && !repaid && !intInst) return;
      var row = { loan:L, principal:S.principal, opening:c0.outstanding, drawn:r2(drawn), repaid:r2(repaid), closing:c.outstanding, current:c.current, noncurrent:c.noncurrent,
        intInst:r2(intInst), accrued:acc, accruedOpen:acc0, intExp:r2(intInst + acc - acc0), bank:L.bankBalance === '' || L.bankBalance == null ? null : r2(num(L.bankBalance)) };
      row.diff = row.bank == null ? null : r2(row.closing - row.bank);
      rows.push(row);
      ['principal', 'opening', 'drawn', 'repaid', 'closing', 'current', 'noncurrent', 'intInst', 'accrued', 'accruedOpen', 'intExp'].forEach(function(k){ T[k] = r2(T[k] + row[k]); });
      if(row.bank != null) T.bank = r2(T.bank + row.bank);
    });
    /* the ledger's view, for the tie-out */
    var gl = { current:0, noncurrent:0, accrued:0 };
    try{ var seen = {}; recs(b).forEach(function(L){ var a = L.accounts || {};
        if(a.cur && !seen['c' + a.cur]){ seen['c' + a.cur] = 1; gl.current = r2(gl.current + GL.balance(b, a.cur, { to:d })); }
        if(a.nc && !seen['n' + a.nc]){ seen['n' + a.nc] = 1; gl.noncurrent = r2(gl.noncurrent + GL.balance(b, a.nc, { to:d })); }
        if(a.accrued && !seen['a' + a.accrued]){ seen['a' + a.accrued] = 1; gl.accrued = r2(gl.accrued + GL.balance(b, a.accrued, { to:d })); } }); }catch(e){}
    return { rows:rows, totals:T, date:d, from:from, gl:gl };
  }
  /** Loan statement: disbursement, payments (interest / principal) and the running balance. */
  function statement(b, L, o){
    o = o || {}; var S = sched(b, L), from = iso(o.from) || '', to = iso(o.to) || '9999-12-31', lines = [];
    var pre = 0;
    if(L.disbursedTo === 'opening'){ var c0 = classifyAt(S, addDays(S.openingDate, -1)); lines.push({ date:S.openingDate, kind:'open', desc:'Opening balance (existing loan)', ref:'', drawn:c0.outstanding, paid:0, interest:0, principal:0 }); }
    else lines.push({ date:S.start, kind:'disb', desc:'Loan disbursed' + (L.disbursedTo === 'bank' ? ' to ' + (L.bankAccount || '') : ''), ref:L.ref || '', drawn:S.principal, paid:0, interest:0, principal:0 });
    S.rows.forEach(function(r){ (r.docs || []).forEach(function(d){ lines.push({ date:d.date, kind:'pay', desc:'Instalment ' + r.no + (r.docs.length > 1 ? ' (part)' : ''), ref:d.ref, id:d.id, drawn:0, paid:d.amount, interest:d.interest, principal:d.principal, no:r.no }); }); });
    (S.loose || []).forEach(function(d){ lines.push({ date:d.date, kind:'pay', desc:'Payment', ref:d.ref, id:d.id, drawn:0, paid:d.amount, interest:d.interest, principal:d.principal }); });
    lines.sort(function(x, y){ return x.date < y.date ? -1 : x.date > y.date ? 1 : (x.kind === 'pay' ? 1 : -1); });
    var bal = 0, out = [], opening = 0;
    lines.forEach(function(l){ bal = r2(bal + l.drawn - l.principal); l.balance = bal; if(l.date < from){ opening = bal; return; } if(l.date > to) return; out.push(l); });
    var T = { drawn:0, paid:0, interest:0, principal:0 }; out.forEach(function(l){ T.drawn += l.drawn; T.paid += l.paid; T.interest += l.interest; T.principal += l.principal; });
    Object.keys(T).forEach(function(k){ T[k] = r2(T[k]); });
    return { lines:out, opening:opening, closing:out.length ? out[out.length - 1].balance : opening, totals:T, from:from, to:to === '9999-12-31' ? '' : to };
  }

  /* ------------------------------------------------------------------ reminders */
  function reminders(b){
    var t = today(), n = remindDays(b), out = [];
    recs(b).forEach(function(L){
      var S = sched(b, L), over = S.rows.filter(function(r){ return !r.paid && !r.before && r.date < t; });
      /* overdue instalments of one loan: one reminder (its id changes when another one falls overdue) */
      if(over.length){ var amt = r2(over.reduce(function(s, r){ return s + r.emi; }, 0)), d0 = daysBetween(t, over[0].date);
        out.push({ id:'loan:' + L.id + ':overdue:' + over.length, kind:'loans', due:over[0].date, severity:'overdue',
          title:(over.length === 1 ? 'Loan EMI overdue — ' : over.length + ' loan EMIs overdue — ') + label(L) + ' — ' + money(amt),
          detail:(over.length === 1 ? 'Instalment ' + over[0].no : 'Instalments ' + over[0].no + '–' + over[over.length - 1].no) + ' of ' + S.rows.length + ' · ' + (-d0) + (d0 === -1 ? ' day' : ' days') + ' overdue (since ' + fmtD(over[0].date) + ')',
          link:{ section:LABEL, key:KEY, id:L.id } }); }
      S.rows.forEach(function(r){
        if(r.paid || r.before) return; var d = daysBetween(t, r.date); if(d == null || d > n || d < 0) return;
        out.push({ id:'loan:' + L.id + ':' + r.no, kind:'loans', due:r.date, severity:d < 0 ? 'overdue' : d === 0 ? 'due' : 'soon',
          title:'Loan EMI — ' + label(L) + ' — ' + money(r.emi),
          detail:'Instalment ' + r.no + ' of ' + S.rows.length + ' · ' + (d < 0 ? (-d) + (d === -1 ? ' day' : ' days') + ' overdue' : d === 0 ? 'due today' : 'due in ' + d + (d === 1 ? ' day' : ' days')) + ' (' + fmtD(r.date) + ')',
          link:{ section:LABEL, key:KEY, id:L.id } });
      });
    });
    out.sort(function(x, y){ return x.due < y.due ? -1 : x.due > y.due ? 1 : 0; });
    return out;
  }
  var registered = false;
  function registerReminders(){
    if(registered) return true;
    var R = global.Reminders;
    if(R && typeof R.register === 'function'){ try{ if(typeof R.defineKind === 'function') R.defineKind('loans', { label:'Bank loan EMIs', lead:5, icon:'wallet' }); R.register('loans', reminders); registered = true; }catch(e){} }
    return registered;
  }

  /* ------------------------------------------------------------------ register (sidebar + REG) */
  function C(){ return cur(); }
  function nextOf(r){ var b = C(); return b ? sched(b, r).next : null; }
  function clsNow(r){ var b = C(); return b ? classify(b, r, today()) : { outstanding:0, current:0, noncurrent:0, accrued:0 }; }
  function install(){
    if(typeof REG === 'undefined' || typeof SIDEBAR === 'undefined') return;
    if(!REG[KEY]){
      REG[KEY] = { label:LABEL, singular:'Loan', newLabel:'New Loan',
        columns:[
          { key:'lender', label:'Lender', kind:'text' },
          { key:'ref', label:'Loan no. / reference', kind:'text' },
          { key:'type', label:'Type', kind:'text' },
          { key:'date', label:'Disbursed', kind:'date' },
          { key:'principal', label:'Principal', kind:'money', r:1 },
          { key:'rate', label:'Rate', kind:'num', r:1, calc:function(r){ return pct(r.rate); } },
          { key:'method', label:'Method', kind:'text', calc:function(r){ var m = methodOf(r); return m === 'flat' ? 'Flat (' + (r.flatSplit === 'straight' ? 'straight-line' : 'Rule of 78') + ')' : m === 'interestOnly' ? 'Interest only' : 'Reducing'; } },
          { key:'n', label:'Instalments', kind:'num', r:1 },
          { key:'outstanding', label:'Outstanding', kind:'money', r:1, bold:1, calc:function(r){ return clsNow(r).outstanding; } },
          { key:'nextDate', label:'Next EMI date', kind:'date', calc:function(r){ var x = nextOf(r); return x ? x.date : ''; } },
          { key:'nextAmt', label:'Next EMI amount', kind:'money', r:1, calc:function(r){ var x = nextOf(r); return x ? x.emi : 0; } },
          { key:'current', label:'Current', kind:'money', r:1, calc:function(r){ return clsNow(r).current; } },
          { key:'noncurrent', label:'Non-current', kind:'money', r:1, calc:function(r){ return clsNow(r).noncurrent; } },
          { key:'accrued', label:'Accrued interest', kind:'money', r:1, calc:function(r){ return clsNow(r).accrued; } },
          { key:'endDate', label:'Last EMI', kind:'date', calc:function(r){ var b = C(); return b ? sched(b, r).endDate : ''; } },
          { key:'loanStatus', label:'Status', kind:'text', calc:function(r){ var b = C(); return b ? statusOf(b, r) : ''; } }
        ],
        defaultCols:['lender', 'ref', 'type', 'principal', 'rate', 'outstanding', 'nextDate', 'nextAmt', 'current', 'noncurrent', 'loanStatus'],
        form:[
          { key:'lender', label:'Lender', type:'text', req:1 },
          { key:'ref', label:'Loan no. / reference', type:'text' },
          { key:'type', label:'Type', type:'select', options:TYPES.slice() },
          { key:'principal', label:'Principal', type:'money', req:1 },
          { key:'date', label:'Disbursement date', type:'date', req:1 },
          { key:'rate', label:'Annual rate %', type:'number' },
          { key:'n', label:'Instalments', type:'number' },
          { key:'firstDate', label:'First EMI date', type:'date' },
          { key:'notes', label:'Notes', type:'text' }
        ],
        totalCol:'principal' };
    }
    if(!SIDEBAR.some(function(r){ return r[1] === LABEL; })){
      var at = SIDEBAR.findIndex(function(r){ return r[1] === 'PDC'; }); if(at < 0) at = SIDEBAR.findIndex(function(r){ return r[1] === 'Bank Reconciliations'; });
      SIDEBAR.splice(at >= 0 ? at + 1 : SIDEBAR.length, 0, ['🏦', LABEL, KEY]);
    }
    if(typeof SIDEBAR_GROUPS !== 'undefined'){
      var g = SIDEBAR_GROUPS.find(function(x){ return x[0] === 'Banking'; });
      if(g && g[1].indexOf(LABEL) < 0){ var pi = g[1].indexOf('PDC'); if(pi >= 0) g[1].splice(pi + 1, 0, LABEL); else g[1].push(LABEL); }
    }
    if(typeof LABEL2KEY !== 'undefined') LABEL2KEY[LABEL] = KEY;
    if(typeof KEY2LABEL !== 'undefined' && !KEY2LABEL[KEY]) KEY2LABEL[KEY] = LABEL;
    var ICO = global.ICO;
    if(ICO && typeof ICO.forSection === 'function' && !ICO.__loans){
      ICO.__loans = 1; var fs = ICO.forSection;
      ICO.forSection = function(lbl, size, cls){
        if(lbl !== LABEL) return fs.apply(this, arguments);
        var s = size || 18;
        return '<svg class="ico' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/></svg>';
      };
    }
  }
  install();

  /* ================================================================== UI */
  var UI = {};
  function rerender(){ try{ A.renderWorkspace(); }catch(e){} }
  function overlay(html){ A._openOverlay(html); setTimeout(function(){ var el = byId('lnDlgFirst'); if(el && el.focus) try{ el.focus(); }catch(e){} }, 30); }
  function dlgErr(msg){ var el = byId('lnDlgErr'); if(el){ el.textContent = msg; el.hidden = !msg; } else say(msg); }
  function opt(list, curV, placeholder){
    var seen = {}, h = placeholder != null ? '<option value="">' + esc(placeholder) + '</option>' : '';
    list.forEach(function(x){ var v = Array.isArray(x) ? x[0] : x, t = Array.isArray(x) ? x[1] : x; if(seen[v]) return; seen[v] = 1;
      h += '<option value="' + esc(v) + '"' + (String(v) === String(curV) ? ' selected' : '') + '>' + esc(t) + '</option>'; });
    if(has(curV) && !seen[curV]) h += '<option value="' + esc(curV) + '" selected>' + esc(curV) + '</option>';
    return h;
  }
  function badge(s){ return '<span class="st-badge ' + (ST_CLASS[s] || 'st-unpaid') + '">' + esc(s) + '</span>'; }
  function mcell(v, cls){ var n = r2(v); return '<td class="r m' + (cls ? ' ' + cls : '') + (n < -0.004 ? ' neg' : '') + '">' + money(n) + '</td>'; }
  function freqLbl(L){ var f = FREQS[L.freq] || FREQS.monthly; return f[0]; }
  function methodLbl(L){ var m = methodOf(L); return m === 'flat' ? 'Flat rate — ' + (L.flatSplit === 'straight' ? 'straight-line interest' : 'Rule of 78') : m === 'interestOnly' ? 'Interest only' : 'Reducing balance (EMI)' + (L.dayCount === 'act365' ? ' — actual days / 365' : ''); }
  function jsArg(v){ return esc(JSON.stringify(v)); }

  /* ---------------------------------------------------------------- list page */
  function filterRows(b, rows, f){
    if(!f || f === 'all') return rows;
    return rows.filter(function(r){ var s = statusOf(b, r); return f === 'active' ? s !== 'Closed' : f === 'overdue' ? s === 'Overdue' : f === 'closed' ? s === 'Closed' : true; });
  }
  function portfolio(b){
    var t = today(), T = { outstanding:0, current:0, noncurrent:0, accrued:0, dueSoon:0, dueSoonN:0, overdue:0, overdueN:0 }, n = remindDays(b);
    recs(b).forEach(function(L){ var c = classify(b, L, t); T.outstanding += c.outstanding; T.current += c.current; T.noncurrent += c.noncurrent; T.accrued += c.accrued;
      c.schedule.rows.forEach(function(r){ if(r.paid || r.before) return; var d = daysBetween(t, r.date); if(d < 0){ T.overdue += r.emi; T.overdueN++; } else if(d <= n){ T.dueSoon += r.emi; T.dueSoonN++; } }); });
    Object.keys(T).forEach(function(k){ if(!/N$/.test(k)) T[k] = r2(T[k]); });
    return T;
  }
  function toolbarHtml(b){
    var f = A._loanFilter || 'all', all = recs(b);
    var tabs = [['all', 'All'], ['active', 'Active'], ['overdue', 'Overdue'], ['closed', 'Closed']].map(function(x){ var n = filterRows(b, all, x[0]).length;
      return '<button type="button" role="tab" aria-selected="' + (f === x[0]) + '" class="ln-tab' + (f === x[0] ? ' on' : '') + (x[0] === 'overdue' && n ? ' warn' : '') + '" onclick="Loans.ui.filter(\'' + x[0] + '\')">' + esc(x[1]) + '<span class="ln-n">' + n + '</span></button>'; }).join('');
    var P = portfolio(b), w = !ro(b);
    var kpi = function(lbl, v, sub, cls){ return '<div class="ln-kpi' + (cls ? ' ' + cls : '') + '"><span>' + lbl + '</span><b>' + money(v) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    return '<div class="ln-bar"><div class="ln-tabs" role="tablist" aria-label="Filter loans">' + tabs + '</div>' +
        '<div class="ln-acts"><label class="ln-remind">Remind <input type="number" min="0" max="365" value="' + remindDays(b) + '" aria-label="Reminder days before an EMI is due" onchange="Loans.ui.setRemindDays(this.value)"> days before</label>' + (w ? '<button type="button" class="btn btn-xs btn-primary" onclick="Loans.ui.bulkOpen()">Pay due EMIs</button>' : '') +
        '<button type="button" class="btn btn-xs" onclick="Loans.ui.report(\'emi\')">EMI report</button>' +
        '<button type="button" class="btn btn-xs" onclick="Loans.ui.report(\'class\')">Classification</button></div></div>' +
      '<div class="ln-kpis">' + kpi('Outstanding', P.outstanding, 'as at ' + fmtD(today())) + kpi('Current', P.current, 'due within 12 months') + kpi('Non-current', P.noncurrent, 'after 12 months') +
        kpi('Accrued interest', P.accrued, 'earned, not yet paid') + kpi('Overdue EMIs', P.overdue, P.overdueN + ' instalment' + (P.overdueN === 1 ? '' : 's'), P.overdueN ? 'warn' : '') +
        kpi('Due in ' + remindDays(b) + ' days', P.dueSoon, P.dueSoonN + ' instalment' + (P.dueSoonN === 1 ? '' : 's')) +
        '</div>';
  }
  wrap('listHtml', function(orig, a){
    if(curKey() !== KEY) return orig.apply(this, a);
    var b = a[0] || cur();
    if(this._loanPage) return reportPage(b, this._loanPage);
    var h = String(orig.apply(this, a) || ''), at = h.indexOf('<div id="regBody">');
    return at >= 0 ? h.slice(0, at) + toolbarHtml(b) + h.slice(at) : h;
  });
  wrap('sortedRecords', function(orig, a){
    var rows = orig.apply(this, a); if(curKey() !== KEY) return rows;
    return filterRows(a[0] || cur(), rows, this._loanFilter || 'all');
  });
  wrap('selectSection', function(orig, a){ this._loanPage = null; this._loanTab = null; return orig.apply(this, a); });
  wrap('_cellHtml', function(orig, a){
    var b = a[0], key = a[1], col = a[2], r = a[3];
    if(key !== KEY || !col) return orig.apply(this, a);
    if(col.key === 'loanStatus') return '<td>' + badge(statusOf(b, r)) + '</td>';
    if(col.key === 'nextDate'){ var x = sched(b, r).next; if(!x) return '<td></td>'; var cls = x.status === 'Overdue' ? 'ln-over' : x.status === 'Due' ? 'ln-soon' : '';
      return '<td class="nw"><span class="' + cls + '">' + esc(fmtD(x.date)) + '</span></td>'; }
    return orig.apply(this, a);
  });
  wrap('deleteRecord', function(orig, a){
    if(curKey() !== KEY) return orig.apply(this, a);
    var b = cur(), L = find(b, a[0]); if(!L) return;
    if(typeof A.guardWrite === 'function' && !A.guardWrite()) return;
    var n = loanDocs(b, L).length;
    if(n) return say('This loan has ' + n + ' EMI payment' + (n === 1 ? '' : 's') + '. Undo them first (schedule → Undo, or delete the payments) — the loan is kept so nothing is lost.');
    return ask('Delete loan ' + label(L) + '? Its disbursement and accrual postings are removed from the ledger.', { title:'Delete loan', okText:'Delete', danger:true }).then(function(ok){
      if(!ok) return; var res = remove(cur(), L.id); if(!res.ok) return say(res.error); refreshReminders(); toast('Loan deleted'); A.editingId = null; if(!(A.backFromRecord && A.backFromRecord())) A.backToList(); });
  });
  /* bulk delete: loans with EMI payments stay (their payments would lose the loan they reduce) */
  wrap('batchDeleteRun', function(orig, a){
    if(curKey() !== KEY) return orig.apply(this, a);
    var b = cur(), sel = this.batchSel || {}, kept = [];
    Object.keys(sel).forEach(function(id){ var L = find(b, id); if(L && loanDocs(b, L).length){ kept.push(label(L)); delete sel[id]; } });
    if(kept.length){ var self = this, args = a;
      return say(kept.length + ' selected loan' + (kept.length === 1 ? ' has' : 's have') + ' EMI payments and ' + (kept.length === 1 ? 'is' : 'are') + ' kept: ' + kept.join(', ') + '. Undo their payments first.').then(function(){
        if(Object.keys(sel).length) return orig.apply(self, args); rerender(); }); }
    return orig.apply(this, a);
  });

  /* payments made from a schedule carry a link back to the loan */
  wrap('viewHtml', function(orig, a){
    var key = curKey();
    if(key === KEY) return viewHtml(a[0] || cur());
    var h = String(orig.apply(this, a) || '');
    if(key !== 'payments') return h;
    var b = a[0] || cur(), p = ((b.records || {}).payments || []).find(function(x){ return String(x.id) === String(A.editingId); });
    if(!p || p.loanId == null) return h;
    var L = find(b, p.loanId);
    var bar = '<div class="info-bar ln-paybar">' + (L ? 'Loan instalment ' + esc(p.loanRow) + ' — <a class="led-link" onclick="Loans.ui.openLoan(' + jsArg(L.id) + ')">' + esc(label(L)) + ' ↗</a>. Deleting this payment marks the instalment unpaid again.' : 'This payment was made for a loan that no longer exists.') + '</div>';
    var m = /<div class="ws-crumb">[\s\S]*?<\/div><\/div>/.exec(h);   /* after the crumb */
    if(m) return h.slice(0, m.index + m[0].length) + bar + h.slice(m.index + m[0].length);
    return bar + h;
  });

  /* ---------------------------------------------------------------- form page */
  function acctChoices(b, roots){
    var out = []; try{ A.accountOptions(b).forEach(function(o){ var n = acct(b, o.id); if(!n) return; var r = (typeof acctRoot === 'function') ? acctRoot(b, n) : '';
      if(!roots || roots.indexOf(r) >= 0) out.push([o.id, o.label]); }); }catch(e){}
    return out;
  }
  function acctSelect(b, id, role, curV, roots, extra){
    var d = ACC[role], ex = roleAcct(b, role, false);
    var first = '<option value="">' + esc(ex ? acctNm(b, ex) + ' (default)' : d.name + ' (created)') + '</option>';
    var list = acctChoices(b, roots).filter(function(x){ return x[0] !== ex; });
    var sel = (curV === ex) ? '' : curV;
    return '<select id="' + id + '">' + first + (extra || '') + list.map(function(x){ return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(sel) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>';
  }
  function formHtml(b){
    var editing = A.editingId != null, L = editing ? find(b, A.editingId) : null;
    if(editing && !L) return A.recCrumb(LABEL, 'Not found') + '<div class="card"><div class="reg-empty">This loan no longer exists.</div><div class="form-actions"><button class="btn" onclick="App.backToList()">Back</button></div></div>';
    var bk = banks(b);
    var v = L ? clone(L) : { lender:'', ref:'', type:'Term loan', principal:'', date:today(), disbursedTo:'bank', bankAccount:bk[0] || '', method:'reducing', flatSplit:'rule78', dayCount:'period',
      rate:'', n:12, freq:'monthly', firstDate:'', emi:'', onChange:'emi', accrue:true, fee:'', feeFrom:'', feeTreatment:'expense', payFrom:'', accounts:{}, notes:'' };
    var ac = v.accounts || {}, title = L ? 'Loan ' + label(L) : 'New loan', paid = L ? loanDocs(b, L).length : 0;
    var lenders = BANKS.concat((((b.records || {}).suppliers) || []).map(function(s){ return s && s.name; }).filter(Boolean));
    var F = function(lbl, ctl, cls, hint){ return '<div class="ln-f' + (cls ? ' ' + cls : '') + '"><label class="fld">' + lbl + '</label>' + ctl + (hint ? '<small class="ln-hint">' + hint + '</small>' : '') + '</div>'; };
    var inp = function(id, val, extra){ return '<input type="text" id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>'; };
    var amt = function(id, val, ph){ return '<input type="text" inputmode="decimal" class="r" id="' + id + '" value="' + esc(val === '' || val == null ? '' : m2(num(val))) + '" placeholder="' + (ph || '0.00') + '" oninput="Loans.ui.preview()">'; };
    var dt = function(id, val){ return '<input type="date" id="' + id + '" value="' + esc(iso(val)) + '" onchange="Loans.ui.preview()">'; };
    var sel = function(id, list, val, ex){ return '<select id="' + id + '" onchange="Loans.ui.formSync()"' + (ex || '') + '>' + opt(list, val) + '</select>'; };
    var dt0 = v.disbursedTo || 'bank';
    var radio = function(val, t, s){ return '<label class="ln-rad' + (dt0 === val ? ' on' : '') + '"><input type="radio" name="ln_disb" value="' + val + '"' + (dt0 === val ? ' checked' : '') + ' onchange="Loans.ui.formSync()"><b>' + t + '</b><small>' + s + '</small></label>'; };
    var subList = (((b.records || {}).suppliers) || []).concat(((b.records || {}).fixedAssets) || []).map(function(x){ return x && x.name; }).filter(Boolean);
    return A.recCrumb(LABEL, title) +
      '<div class="card ln-form" data-enter-nav="on">' +
        '<div class="card-head"><h2 style="margin:0">' + esc(title) + '</h2></div>' +
        (paid ? '<div class="info-bar">' + paid + ' instalment' + (paid === 1 ? ' is' : 's are') + ' paid. Paid rows keep the figures their payments posted; changing the terms re-plans the unpaid rows.</div>' : '') +
        '<datalist id="ln_lenders">' + lenders.map(function(x){ return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
        '<datalist id="ln_subs">' + subList.map(function(x){ return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
        '<h3 class="ln-sec">Lender &amp; facility</h3><div class="ln-grid">' +
          F('Lender', '<input type="text" id="ln_lender" list="ln_lenders" value="' + esc(v.lender) + '" placeholder="Bank or finance company" autocomplete="off">', 'wide') +
          F('Loan no. / reference', inp('ln_ref', v.ref, ' autocomplete="off"')) +
          F('Type', sel('ln_type', TYPES, v.type)) +
        '</div>' +
        '<h3 class="ln-sec">Disbursement</h3>' +
        '<div class="ln-rads" role="radiogroup" aria-label="Loan paid into">' + radio('bank', 'Into a bank account', 'the bank credits your account') + radio('account', 'Paid directly to supplier / asset', 'e.g. the car dealer') + radio('opening', 'Existing loan', 'opening balance at a date') + '</div>' +
        '<div class="ln-grid">' +
          F('Principal (loan amount)', amt('ln_principal', v.principal)) +
          F('Disbursement date', dt('ln_date', v.date)) +
          F('Paid into', '<select id="ln_bankAccount">' + opt(bk, v.bankAccount, '— Select —') + '</select>', 'ln-only-bank') +
          F('Paid to account', '<select id="ln_disbAccount" onchange="Loans.ui.formSync()">' + opt(acctChoices(b), v.disbAccount, '— Select —') + '</select>', 'ln-only-account') +
          F('Supplier / asset <small class="ln-hint">(sub-account)</small>', '<input type="text" id="ln_disbSub" list="ln_subs" value="' + esc(v.disbSub || '') + '" autocomplete="off">', 'ln-only-account') +
          F('Opening balance date', dt('ln_openingDate', v.openingDate), 'ln-only-opening', 'Instalments due before this date count as paid before your books started.') +
        '</div>' +
        '<h3 class="ln-sec">Terms</h3><div class="ln-grid">' +
          F('Interest method', sel('ln_method', Object.keys(METHODS).map(function(k){ return [k, METHODS[k]]; }), v.method)) +
          F('Flat interest split', sel('ln_flatSplit', [['rule78', 'Rule of 78 (sum of digits)'], ['straight', 'Straight-line (equal)']], v.flatSplit), 'ln-only-flat') +
          F('Interest basis', sel('ln_dayCount', [['period', 'Per instalment (rate ÷ 12)'], ['act365', 'Actual days / 365']], v.dayCount), 'ln-not-flat') +
          F('Annual rate %', '<input type="text" inputmode="decimal" class="r" id="ln_rate" value="' + esc(v.rate === '' ? '' : v.rate) + '" placeholder="e.g. 5" oninput="Loans.ui.preview()">') +
          F('Number of instalments', '<input type="number" min="1" max="600" class="r" id="ln_n" value="' + esc(v.n) + '" oninput="Loans.ui.preview()">') +
          F('Frequency', sel('ln_freq', Object.keys(FREQS).map(function(k){ return [k, FREQS[k][0]]; }), v.freq)) +
          F('First EMI date', dt('ln_firstDate', v.firstDate), '', 'Blank: one period after disbursement.') +
          F('Instalment (EMI) <small class="ln-hint">(optional)</small>', amt('ln_emi', v.emi, 'calculated'), 'ln-only-reducing', 'The bank’s fixed instalment, if it differs from the calculated one.') +
          F('When an instalment changes', sel('ln_onChange', [['emi', 'Keep the tenure — recalculate the EMI'], ['tenure', 'Keep the EMI — finish earlier / later']], v.onChange), 'ln-only-reducing') +
          F('Interest accrual', '<label class="ln-chk"><input type="checkbox" id="ln_accrue"' + (v.accrue === false ? '' : ' checked') + '> Accrue interest at each month end (accrual basis)</label>', 'wide') +
        '</div>' +
        '<div class="ln-preview" id="ln_preview" aria-live="polite"></div>' +
        '<h3 class="ln-sec">Processing fee <small class="ln-hint">(optional)</small></h3><div class="ln-grid ln-not-opening">' +
          F('Fee', amt('ln_fee', v.fee)) +
          F('Paid', '<select id="ln_feeFrom">' + opt([['__deduct__', 'Deducted from the loan proceeds']].concat(bk.map(function(x){ return [x, 'From ' + x]; })), v.feeFrom, 'From the disbursement account') + '</select>') +
          F('Accounting', sel('ln_feeTreatment', [['expense', 'Expense now'], ['amortise', 'Amortise over the loan term (monthly)']], v.feeTreatment)) +
        '</div>' +
        '<h3 class="ln-sec">Accounts &amp; payments</h3><div class="ln-grid">' +
          F('Loan account (non-current)', acctSelect(b, 'ln_acc_nc', 'nc', ac.nc, ['liabilities'])) +
          F('Current portion account', acctSelect(b, 'ln_acc_cur', 'cur', ac.cur === '' && L ? '__none__' : ac.cur, ['liabilities'], '<option value="__none__"' + (L && ac.cur === '' ? ' selected' : '') + '>No split — one account</option>')) +
          F('Interest expense', acctSelect(b, 'ln_acc_interest', 'interest', ac.interest, ['expense'])) +
          F('Accrued interest', acctSelect(b, 'ln_acc_accrued', 'accrued', ac.accrued, ['liabilities'])) +
          F('Pay EMIs from', '<select id="ln_payFrom">' + opt(bk, v.payFrom, 'The disbursement bank') + '</select>') +
          F('Balance per bank <small class="ln-hint">(optional)</small>', amt('ln_bankBalance', v.bankBalance, 'per statement / credit report')) +
          F('Bank balance date', dt('ln_bankBalanceDate', v.bankBalanceDate)) +
          F('Notes', '<input type="text" id="ln_notes" value="' + esc(v.notes || '') + '">', 'wide') +
        '</div>' +
        '<div class="form-actions">' +
          '<button class="btn btn-primary" onclick="Loans.ui.saveForm()">' + (editing ? 'Update' : 'Create') + '</button>' +
          '<button class="btn" onclick="App.backFromRecord()||App.backToList()">Cancel</button>' +
          (editing ? '<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="App.deleteRecord(' + jsArg(L.id) + ')">Delete</button>' : '') +
        '</div>' +
      '</div>';
  }
  function readForm(){
    var g = function(id){ var el = byId(id); return el ? el.value : ''; };
    var dto = 'bank'; try{ var c = document.querySelector('input[name="ln_disb"]:checked'); if(c) dto = c.value; }catch(e){}
    var accts = {}; ['nc', 'cur', 'interest', 'accrued'].forEach(function(k){ var v = g('ln_acc_' + k); if(k === 'cur') accts.cur = v === '__none__' ? '' : (v || undefined); else accts[k] = v || ''; });
    var acc = byId('ln_accrue');
    return { lender:g('ln_lender'), ref:g('ln_ref'), type:g('ln_type'), principal:g('ln_principal'), date:g('ln_date'), disbursedTo:dto, bankAccount:g('ln_bankAccount'),
      disbAccount:g('ln_disbAccount'), disbSub:g('ln_disbSub'), openingDate:g('ln_openingDate'), method:g('ln_method'), flatSplit:g('ln_flatSplit'), dayCount:g('ln_dayCount'),
      rate:g('ln_rate'), n:g('ln_n'), freq:g('ln_freq'), firstDate:g('ln_firstDate'), emi:g('ln_emi'), onChange:g('ln_onChange'), accrue:acc ? !!acc.checked : true,
      fee:g('ln_fee'), feeFrom:g('ln_feeFrom'), feeTreatment:g('ln_feeTreatment'), payFrom:g('ln_payFrom'), bankBalance:g('ln_bankBalance'), bankBalanceDate:g('ln_bankBalanceDate'),
      notes:g('ln_notes'), accounts:accts };
  }
  wrap('formHtml', function(orig, a){ if(curKey() !== KEY) return orig.apply(this, a); var h = formHtml(a[0] || cur()); setTimeout(function(){ UI.formSync(); }, 0); return h; });
  wrap('_mountDesignedForm', function(orig, a){ if(a[0] === KEY) return; return orig.apply(this, a); });

  /* ---------------------------------------------------------------- view page */
  function scheduleTable(b, L, S, opts){
    opts = opts || {}; var w = !ro(b) && !opts.print, anyArr = S.rows.some(function(r){ return r.arrears > 0.004; });
    var nextNo = S.next ? S.next.no : null, lastPaid = 0; S.rows.forEach(function(r){ if(r.paid) lastPaid = r.no; });
    var head = '<tr><th class="r">No.</th><th>Due date</th><th class="r">Opening</th><th class="r">EMI</th>' + (anyArr ? '<th class="r">Arrears b/f</th>' : '') +
      '<th class="r">Interest</th><th class="r">Principal</th><th class="r">Closing</th><th>Status</th><th>Paid date</th><th class="r">Paid amount</th><th class="r">Difference</th>' + (w ? '<th class="act"></th>' : '') + '</tr>';
    var body = S.rows.map(function(r){
      var man = r.manual && r.manual.length, cls = (r.no === nextNo ? 'ln-next ' : '') + (man ? 'ln-man ' : '') + (r.status === 'Overdue' ? 'ln-row-over ' : '') + (r.paid ? 'ln-row-paid' : '');
      var acts = '';
      if(w){
        if(r.paid) acts = (r.docs || []).map(function(d){ return '<a class="led-link" onclick="Loans.ui.openPayment(' + jsArg(d.id) + ')" title="Open payment">' + esc(d.ref || 'Payment') + ' ↗</a>'; }).join(' ') +
          (r.no === lastPaid ? ' <button class="btn btn-xs" onclick="Loans.ui.unpayAsk(' + jsArg(L.id) + ',' + r.no + ')" title="Delete the payment">Undo</button>' : '');
        else if(!r.before) acts = '<button class="btn btn-xs ln-pay-btn" onclick="Loans.ui.payOpen(' + jsArg(L.id) + ',' + r.no + ')">Pay</button>';
        if(!r.before) acts += ' <button class="btn btn-xs ln-edit-btn" onclick="Loans.ui.rowOpen(' + jsArg(L.id) + ',' + r.no + ')" title="Change this instalment" aria-label="Change instalment ' + r.no + '">✎</button>';
      }
      var flag = man ? ' <span class="ln-flag" title="Changed by hand: ' + esc(r.manual.join(', ')) + '">edited</span>' : '';
      var diff = r.paid ? (Math.abs(r.difference) < 0.005 ? '<td class="r m ln-muted">0.00</td>' : '<td class="r m ' + (r.difference < 0 ? 'ln-short' : 'ln-extra') + '" title="' + (r.difference < 0 ? 'Short paid — carried to the next instalment as arrears' : 'Paid more — the extra reduced the principal') + '">' + money(r.difference) + '</td>') : '<td></td>';
      return '<tr class="' + cls.trim() + '"><td class="r">' + r.no + flag + '</td><td class="nw">' + esc(fmtD(r.date)) + '</td>' + mcell(r.opening) + mcell(r.emi, 'b') + (anyArr ? (r.arrears > 0.004 ? mcell(r.arrears, 'ln-short') : '<td></td>') : '') +
        mcell(r.interest) + mcell(r.principal) + mcell(r.closing) + '<td>' + badge(r.status) + '</td><td class="nw">' + esc(r.paid ? fmtD(r.paidDate) : '') + '</td>' +
        (r.paid ? mcell(r.paidAmount) : '<td></td>') + diff + (w ? '<td class="nw ln-acts-c">' + acts + '</td>' : '') + '</tr>';
    }).join('');
    var T = S.totals;
    var foot = '<tr class="tot-row"><td colspan="3" class="tot-lbl">Total</td>' + mcell(T.emi) + (anyArr ? '<td></td>' : '') + mcell(T.interest) + mcell(T.principal) + '<td></td><td></td><td></td>' + mcell(T.paid) + mcell(T.difference) + (w ? '<td></td>' : '') + '</tr>';
    return '<div class="tbl-scroll"><table class="reg-tbl ln-sched"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }
  function statementTable(b, L){
    var st = statement(b, L, {});
    var rows = st.lines.map(function(l){ return '<tr><td class="nw">' + esc(fmtD(l.date)) + '</td><td>' + (l.id != null ? '<a class="led-link" onclick="Loans.ui.openPayment(' + jsArg(l.id) + ')">' + esc(l.desc) + '</a>' : esc(l.desc)) + '</td><td class="nw">' + esc(l.ref || '') + '</td>' +
      (l.drawn ? mcell(l.drawn) : '<td></td>') + (l.paid ? mcell(l.paid) : '<td></td>') + (l.paid ? mcell(l.interest) : '<td></td>') + (l.paid ? mcell(l.principal) : '<td></td>') + mcell(l.balance, 'b') + '</tr>'; }).join('');
    return '<div class="tbl-scroll"><table class="reg-tbl ln-stmt"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="r">Drawn</th><th class="r">Paid</th><th class="r">Interest</th><th class="r">Principal</th><th class="r">Balance</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8"><div class="reg-empty">Nothing yet.</div></td></tr>') + '</tbody><tfoot><tr class="tot-row"><td colspan="3" class="tot-lbl">Total</td>' + mcell(st.totals.drawn) + mcell(st.totals.paid) + mcell(st.totals.interest) + mcell(st.totals.principal) + mcell(st.closing) + '</tr></tfoot></table></div>';
  }
  function postingsTable(b, L){
    var lines = []; try{ lines = GL.docLines(b, KEY, L.id).slice(); }catch(e){}
    loanDocs(b, L).forEach(function(p){ try{ lines = lines.concat(GL.docLines(b, 'payments', p.id)); }catch(e){} });
    lines.sort(function(x, y){ return String(x.date || '').localeCompare(String(y.date || '')); });
    var dr = 0, crr = 0;
    var rows = lines.map(function(l){ dr += l.debit; crr += l.credit; var n = acct(b, l.acct);
      return '<tr><td class="nw">' + esc(l.date ? fmtD(l.date) : 'Opening') + '</td><td>' + esc(String(l.type || '').replace(' — ' + label(L), '')) + '</td><td>' + esc(n ? n.name : l.acct) + (l.sub ? ' <small class="ln-muted">' + esc(l.sub) + '</small>' : '') + '</td>' +
        (l.debit ? mcell(l.debit) : '<td></td>') + (l.credit ? mcell(l.credit) : '<td></td>') + '</tr>'; }).join('');
    return '<p class="ln-muted ln-small">Every posting this loan makes in the general ledger: the disbursement, fees, month-end current-portion and interest accruals (each reversed the next day), and the EMI payments.</p>' +
      '<div class="tbl-scroll"><table class="reg-tbl ln-post"><thead><tr><th>Date</th><th>Transaction</th><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5"><div class="reg-empty">No postings.</div></td></tr>') + '</tbody><tfoot><tr class="tot-row"><td colspan="3" class="tot-lbl">Total</td>' + mcell(dr) + mcell(crr) + '</tr></tfoot></table></div>';
  }
  function viewHtml(b){
    var L = find(b, A.editingId);
    if(!L) return A.recCrumb(LABEL, 'Not found') + '<div class="card"><div class="reg-empty">This loan no longer exists.</div><div class="form-actions"><button class="btn" onclick="App.backFromRecord()||App.backToList()">Close</button></div></div>';
    var S = sched(b, L), t = today(), c = classify(b, L, t), st = statusOf(b, L), id = jsArg(L.id), w = !ro(b), tab = A._loanTab || 'schedule';
    var due = S.rows.filter(function(r){ return !r.paid && !r.before && r.date <= t; });
    var btn = function(lbl, fn, cls){ return '<button class="btn btn-sm' + (cls ? ' ' + cls : '') + '" onclick="' + fn + '">' + lbl + '</button>'; };
    var acts = (w ? btn('Edit', 'App.editRecord(' + id + ')') + (due.length ? btn('Pay due EMIs (' + due.length + ')', 'Loans.ui.bulkOpen(' + id + ')', 'btn-primary') : (S.next ? btn('Pay next EMI', 'Loans.ui.payOpen(' + id + ',' + S.next.no + ')', 'btn-primary') : '')) : '') +
      btn('Print schedule', 'Loans.ui.printSchedule(' + id + ')') + btn('Statement', 'Loans.ui.tab(\'statement\')') +
      (w && Object.keys(L.overrides || {}).length ? btn('Regenerate', 'Loans.ui.regenerateAsk(' + id + ')') : '');
    var kv = function(k, v){ return v === '' || v == null ? '' : '<div class="ln-kv"><span>' + k + '</span><b>' + v + '</b></div>'; };
    var kpi = function(lbl, v, sub, cls){ return '<div class="ln-kpi' + (cls ? ' ' + cls : '') + '"><span>' + lbl + '</span><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var tabs = [['schedule', 'Amortisation schedule'], ['statement', 'Statement'], ['postings', 'Postings']].map(function(x){
      return '<button type="button" role="tab" aria-selected="' + (tab === x[0]) + '" class="ln-tab' + (tab === x[0] ? ' on' : '') + '" onclick="Loans.ui.tab(\'' + x[0] + '\')">' + x[1] + '</button>'; }).join('');
    var disb = L.disbursedTo === 'opening' ? 'Existing loan — opening balance at ' + fmtD(L.openingDate) : L.disbursedTo === 'account' ? esc(acctNm(b, L.disbAccount)) + (L.disbSub ? ' — ' + esc(L.disbSub) : '') : esc(L.bankAccount || '');
    var bankCheck = (L.bankBalance !== '' && L.bankBalance != null) ? (function(){ var d = L.bankBalanceDate || t, cc = classifyAt(S, d), df = r2(cc.outstanding - num(L.bankBalance));
      return money(num(L.bankBalance)) + ' at ' + esc(fmtD(d)) + ' — schedule ' + money(cc.outstanding) + (Math.abs(df) > 0.005 ? ' <span class="ln-short">(difference ' + money(df) + ')</span>' : ' ✓'); })() : '';
    return A.recCrumb(LABEL, label(L)) +
      '<div class="card ln-view">' +
        '<div class="view-bar"><span class="view-doc">Loan</span>' + acts + '</div>' +
        '<div class="ln-hero"><div><div class="ln-hero-t">' + esc(L.type || 'Loan') + (L.ref ? ' · ' + esc(L.ref) : '') + '</div><div class="ln-hero-p">' + esc(L.lender || '') + '</div>' +
          '<div class="ln-hero-s">' + badge(st) + '<span class="ln-muted">' + esc(methodLbl(L)) + ' · ' + pct(L.rate) + ' p.a. · ' + S.rows.length + ' × ' + esc(freqLbl(L).toLowerCase()) + '</span></div></div>' +
          '<div class="ln-hero-a"><small>Outstanding</small><b>' + money(c.outstanding) + '</b></div></div>' +
        '<div class="ln-kpis">' + kpi('Current', money(c.current), 'due within 12 months') + kpi('Non-current', money(c.noncurrent), 'after 12 months') + kpi('Accrued interest', money(c.accrued), 'as at ' + fmtD(t)) +
          kpi('Next EMI', S.next ? money(S.next.emi) : '—', S.next ? fmtD(S.next.date) + ' · no. ' + S.next.no : 'fully repaid', S.next && S.next.status === 'Overdue' ? 'warn' : '') +
          kpi('Overdue', money(S.overdue.reduce(function(s, r){ return s + r.emi; }, 0)), S.overdue.length + ' instalment' + (S.overdue.length === 1 ? '' : 's'), S.overdue.length ? 'warn' : '') +
          kpi('Total interest', money(S.totals.interest), 'over the loan') + '</div>' +
        '<div class="ln-kvs">' + kv('Principal', money(S.principal)) + kv('Disbursed', esc(fmtD(L.date))) + kv('Paid into', disb) + kv('Instalment', money(S.instalment)) +
          kv('First / last EMI', esc(fmtD(S.first)) + ' – ' + esc(fmtD(S.endDate))) + kv('Processing fee', num(L.fee) ? money(num(L.fee)) + ' — ' + (L.feeTreatment === 'amortise' ? 'amortised' : 'expensed') : '') +
          kv('Loan account', esc(acctNm(b, (L.accounts || {}).nc)) + ((L.accounts || {}).cur ? ' / ' + esc(acctNm(b, L.accounts.cur)) : '')) + kv('Interest', esc(acctNm(b, (L.accounts || {}).interest)) + (L.accrue === false ? ' (no accrual)' : ' · accrued monthly')) +
          kv('Balance per bank', bankCheck) + kv('Notes', esc(L.notes || '')) + '</div>' +
        '<div class="ln-tabs ln-vtabs" role="tablist" aria-label="Loan details">' + tabs + '</div>' +
        (tab === 'schedule' ? (Object.keys(L.overrides || {}).length ? '<p class="ln-muted ln-small">Rows marked <span class="ln-flag">edited</span> were changed by hand; the rows after them are re-planned. <b>Regenerate</b> clears every change (payments stay).</p>' : '') + scheduleTable(b, L, S) :
          tab === 'statement' ? statementTable(b, L) : postingsTable(b, L)) +
        '<div class="form-actions">' + (w ? '<button class="btn btn-primary" onclick="App.editRecord(' + id + ')">Edit</button>' : '') +
          '<button class="btn" onclick="App.backFromRecord()||App.backToList()">Close</button>' +
          (w ? '<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="App.deleteRecord(' + id + ')">Delete</button>' : '') + '</div>' +
      '</div>';
  }
  wrap('renderMain', function(orig, a){ if(curKey() === KEY && this.wsMode !== 'view') this._loanTab = null; return orig.apply(this, a); });

  /* ---------------------------------------------------------------- reports page */
  function reportPage(b, p){
    var head = function(title, filters, acts){ return A.recCrumb(LABEL, title) + '<div class="card ln-rep"><div class="ln-rep-head"><h2>' + esc(title) + '</h2><div class="ln-rep-acts">' + acts + '<button class="btn btn-sm" onclick="Loans.ui.report(null)">Back</button></div></div><div class="ln-filters">' + filters + '</div>'; };
    var dIn = function(lbl, k, v){ return '<label class="ln-fl"><span>' + lbl + '</span><input type="date" value="' + esc(v || '') + '" onchange="Loans.ui.repSet(\'' + k + '\',this.value)"></label>'; };
    var loanSel = '<label class="ln-fl"><span>Loan</span><select onchange="Loans.ui.repSet(\'loanId\',this.value)">' + opt(recs(b).map(function(L){ return [String(L.id), label(L)]; }), p.loanId == null ? '' : String(p.loanId), 'All loans') + '</select></label>';
    var acts = '<button class="btn btn-sm" onclick="Loans.ui.printReport()">Print</button><button class="btn btn-sm" onclick="Loans.ui.copyReport()">Copy</button>';
    if(p.page === 'emi'){
      var R = emiReport(b, p), T = R.totals;
      var stSel = '<label class="ln-fl"><span>Status</span><select onchange="Loans.ui.repSet(\'status\',this.value)">' + opt([['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue']], p.status || 'all') + '</select></label>';
      var kpi = function(lbl, v, sub, cls){ return '<div class="ln-kpi' + (cls ? ' ' + cls : '') + '"><span>' + lbl + '</span><b>' + money(v) + '</b><small>' + sub + '</small></div>'; };
      var rows = R.rows.map(function(x){ var r = x.row;
        return '<tr><td class="nw">' + esc(fmtD(r.date)) + '</td><td><a class="led-link" onclick="Loans.ui.openLoan(' + jsArg(x.loan.id) + ')">' + esc(label(x.loan)) + '</a></td><td class="r">' + r.no + '</td>' + mcell(r.emi) + mcell(r.interest) + mcell(r.principal) +
          '<td>' + badge(r.status) + '</td><td class="nw">' + esc(r.paid ? fmtD(r.paidDate) : '') + '</td>' + (r.paid ? mcell(r.paidAmount) : '<td></td>') + (r.paid ? mcell(r.difference) : '<td></td>') + '</tr>'; }).join('');
      return head('EMI report', dIn('From', 'from', p.from) + dIn('To', 'to', p.to) + loanSel + stSel, acts) +
        '<div id="lnRepDoc"><div class="ln-print-only ln-ph"><b>EMI report</b> — ' + esc(b.name || '') + ' · ' + esc(fmtD(R.from)) + ' – ' + esc(fmtD(R.to)) + '</div>' +
        '<div class="ln-kpis">' + kpi('Instalments due', T.due.emi, T.due.n + ' due in the period') + kpi('Interest', T.due.interest, 'in those instalments') + kpi('Principal', T.due.principal, 'in those instalments') +
          kpi('Paid', T.paid.amount, T.paid.n + ' paid · difference ' + money(T.paid.difference)) + kpi('Overdue', T.overdue.amount, T.overdue.n + ' unpaid past due', T.overdue.n ? 'warn' : '') + kpi('Upcoming', T.upcoming.amount, T.upcoming.n + ' not yet due') + '</div>' +
        '<p class="ln-muted ln-small">Payments dated in the period: ' + T.paidInPeriod.n + ' — ' + money(T.paidInPeriod.amount) + ' (interest ' + money(T.paidInPeriod.interest) + ', principal ' + money(T.paidInPeriod.principal) + ').</p>' +
        '<div class="tbl-scroll"><table class="reg-tbl ln-rep-tbl"><thead><tr><th>Due date</th><th>Loan</th><th class="r">No.</th><th class="r">EMI</th><th class="r">Interest</th><th class="r">Principal</th><th>Status</th><th>Paid date</th><th class="r">Paid</th><th class="r">Difference</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="10"><div class="reg-empty">No instalments in this period.</div></td></tr>') + '</tbody><tfoot><tr class="tot-row"><td colspan="3" class="tot-lbl">Total</td>' + mcell(T.due.emi) + mcell(T.due.interest) + mcell(T.due.principal) + '<td></td><td></td>' + mcell(T.paid.amount) + mcell(T.paid.difference) + '</tr></tfoot></table></div></div></div>';
    }
    var K = classification(b, p.date, p.from), KT = K.totals, anyBank = K.rows.some(function(x){ return x.bank != null; });
    var rows2 = K.rows.map(function(x){ var L = x.loan;
      return '<tr><td><a class="led-link" onclick="Loans.ui.openLoan(' + jsArg(L.id) + ')">' + esc(L.lender || '') + '</a></td><td>' + esc(L.type || '') + '</td><td class="nw">' + esc(L.ref || '') + '</td><td class="r">' + esc(pct(L.rate)) + '</td>' +
        mcell(x.principal) + mcell(x.opening) + mcell(x.drawn) + mcell(x.repaid) + mcell(x.closing, 'b') + mcell(x.current) + mcell(x.noncurrent) + mcell(x.intInst) + mcell(x.accrued) + mcell(x.intExp) +
        (anyBank ? (x.bank == null ? '<td></td><td></td>' : mcell(x.bank) + mcell(x.diff, Math.abs(x.diff) > 0.005 ? 'ln-short' : '')) : '') + '</tr>'; }).join('');
    var glTot = r2(K.gl.current + K.gl.noncurrent), glDiff = r2(glTot - KT.closing);
    return head('Loan classification', dIn('As at', 'date', K.date) + dIn('Period from', 'from', K.from), acts) +
      '<div id="lnRepDoc"><div class="ln-print-only ln-ph"><b>Loans — current / non-current classification</b> — ' + esc(b.name || '') + ' · as at ' + esc(fmtD(K.date)) + '</div>' +
      '<div class="tbl-scroll"><table class="reg-tbl ln-rep-tbl ln-class"><thead><tr><th>Lender</th><th>Facility</th><th>Reference</th><th class="r">Rate</th><th class="r">Finance amount</th><th class="r">Opening ' + esc(fmtD(addDays(K.from, -1))) + '</th><th class="r">Drawn</th><th class="r">Principal repaid</th>' +
        '<th class="r">Closing ' + esc(fmtD(K.date)) + '</th><th class="r">Current</th><th class="r">Non-current</th><th class="r">Interest in instalments</th><th class="r">Accrued interest</th><th class="r">Interest expense</th>' + (anyBank ? '<th class="r">Per bank</th><th class="r">Difference</th>' : '') + '</tr></thead><tbody>' +
        (rows2 || '<tr><td colspan="16"><div class="reg-empty">No loans outstanding in this period.</div></td></tr>') + '</tbody><tfoot><tr class="tot-row"><td colspan="4" class="tot-lbl">Total</td>' +
        mcell(KT.principal) + mcell(KT.opening) + mcell(KT.drawn) + mcell(KT.repaid) + mcell(KT.closing) + mcell(KT.current) + mcell(KT.noncurrent) + mcell(KT.intInst) + mcell(KT.accrued) + mcell(KT.intExp) + (anyBank ? mcell(KT.bank) + '<td></td>' : '') + '</tr></tfoot></table></div>' +
      '<div class="ln-tie"><div><span>Balance sheet — current portion</span><b>' + money(K.gl.current) + '</b></div><div><span>Balance sheet — non-current</span><b>' + money(K.gl.noncurrent) + '</b></div>' +
        '<div><span>Accrued interest (ledger, last month end)</span><b>' + money(K.gl.accrued) + '</b></div><div><span>Ledger vs schedule</span><b class="' + (Math.abs(glDiff) > 0.005 ? 'ln-short' : '') + '">' + (Math.abs(glDiff) > 0.005 ? money(glDiff) : 'Agrees ✓') + '</b></div></div>' +
      '<p class="ln-muted ln-small">Current = principal of instalments due within 12 months after ' + esc(fmtD(K.date)) + ' (including overdue ones); non-current = the rest. Interest expense = interest in instalments due in the period + accrued at the end − accrued at the start. The ledger posts the split and the accrual at each month end, so on a month-end date the Balance Sheet agrees with this report.</p></div></div>';
  }

  /* ---------------------------------------------------------------- print */
  function printRegion(html, title){
    if(!hasDoc) return html;
    var pr = byId('printRegion'); if(!pr){ pr = document.createElement('div'); pr.id = 'printRegion'; document.body.appendChild(pr); }
    pr.innerHTML = '<div class="card">' + html + '</div>';
    var oldt = document.title; if(title) document.title = title;
    var clean = function(){ try{ pr.innerHTML = ''; }catch(e){} document.title = oldt; try{ global.removeEventListener('afterprint', clean); }catch(e){} };
    try{ global.addEventListener('afterprint', clean); }catch(e){}
    setTimeout(function(){ try{ global.print(); }catch(e){} setTimeout(clean, 1500); }, 80);
    return html;
  }
  function letterhead(b, title){
    var d = b.details || {}, co = esc(d.legalName || b.name || '');
    var lines = (d.address || '').split('\n').filter(Boolean).map(esc).join('<br>') + (d.taxNumber ? '<br>TRN: ' + esc(d.taxNumber) : '');
    var logo = d.logo ? '<img class="vch-logo" src="' + esc(d.logo) + '" alt="">' : '';
    try{ return A._ivHeader(title, logo, co, lines ? '<br>' + lines : ''); }catch(e){ return '<h1>' + esc(title) + '</h1>'; }
  }
  /** The amortisation schedule as an A4 document (letterhead, loan facts, rows with yearly subtotals, summary). */
  function scheduleDoc(b, L){
    var S = sched(b, L), t = today(), c = classifyAt(S, t), yr = t.slice(0, 4);
    var facts = [['Lender', esc(L.lender || '')], ['Facility', esc(L.type || '')], ['Reference', esc(L.ref || '')], ['Finance amount', money(S.principal)], ['Instalment', money(S.instalment)],
      ['Number of instalments', S.rows.length + ' × ' + esc(freqLbl(L).toLowerCase())], ['First / last instalment', esc(fmtD(S.first)) + ' – ' + esc(fmtD(S.endDate))], ['Rate', esc(pct(L.rate)) + ' p.a. — ' + esc(methodLbl(L))]];
    var rows = '', y = null, sub = null;
    var subRow = function(){ return '<tr class="iv-coltot ln-ysub"><td></td><td>Total ' + y + '</td><td></td><td class="r">' + money(sub.emi) + '</td><td class="r">' + money(sub.interest) + '</td><td class="r">' + money(sub.principal) + '</td><td></td><td></td></tr>'; };
    S.rows.forEach(function(r){ var ry = r.date.slice(0, 4);
      if(ry !== y){ if(y) rows += subRow(); y = ry; sub = { emi:0, interest:0, principal:0 }; }
      sub.emi += r.emi; sub.interest += r.interest; sub.principal += r.principal;
      rows += '<tr class="iv-row' + (r.paid ? ' ln-p-paid' : '') + '"><td class="r">' + r.no + (r.manual.length ? '*' : '') + '</td><td>' + esc(fmtD(r.date)) + '</td><td class="r">' + money(r.opening) + '</td><td class="r">' + money(r.emi) + '</td><td class="r">' + money(r.interest) + '</td><td class="r">' + money(r.principal) + '</td><td class="r">' + money(r.closing) + '</td><td>' + esc(r.paid ? 'Paid ' + fmtD(r.paidDate) : r.status) + '</td></tr>'; });
    if(y) rows += subRow();
    var yRows = S.rows.filter(function(r){ return r.date.slice(0, 4) === yr; });
    var sum = [['Principal repaid in ' + yr + ' instalments', yRows.reduce(function(s, r){ return s + r.principal; }, 0)], ['Interest in ' + yr + ' instalments', yRows.reduce(function(s, r){ return s + r.interest; }, 0)],
      ['Outstanding at ' + fmtD(t), c.outstanding], ['Current portion (due within 12 months)', c.current], ['Non-current portion', c.noncurrent], ['Interest accrued at ' + fmtD(t), L.accrue === false ? 0 : accruedAt(S, t)]];
    return '<div class="iv-card ln-print">' + letterhead(b, 'Amortisation Schedule') +
      '<div class="ln-pfacts">' + facts.map(function(f){ return '<div><span>' + f[0] + '</span><b>' + f[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="iv-twrap"><table class="iv-table ln-ptbl"><thead><tr class="iv-thr"><th style="text-align:right">No.</th><th>Due date</th><th style="text-align:right">Opening</th><th style="text-align:right">Instalment</th><th style="text-align:right">Interest</th><th style="text-align:right">Principal</th><th style="text-align:right">Balance after</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="iv-coltot"><td></td><td>Total</td><td></td><td class="r">' + money(S.totals.emi) + '</td><td class="r">' + money(S.totals.interest) + '</td><td class="r">' + money(S.totals.principal) + '</td><td></td><td></td></tr></tfoot></table></div>' +
      '<div class="ln-psum">' + sum.map(function(s){ return '<div><span>' + esc(s[0]) + '</span><b>' + money(r2(s[1])) + '</b></div>'; }).join('') + '</div>' +
      (S.rows.some(function(r){ return r.manual.length; }) ? '<p class="ln-pnote">* instalment changed by hand.</p>' : '') +
      '<p class="ln-pnote">Printed ' + esc(fmtD(t)) + ' — computer-generated schedule.</p></div>';
  }

  /* ---------------------------------------------------------------- actions */
  Object.assign(UI, {
    filter: function(f){ A._loanFilter = f; A.pageNum = 1; rerender(); },
    tab: function(t){ A._loanTab = t; try{ A.renderMain(cur()); }catch(e){} },
    setRemindDays: function(v){ var b = cur(); if(!b) return; var n = parseInt(v, 10); if(isNaN(n) || n < 0) n = 5; b.loanSettings = Object.assign({}, b.loanSettings || {}, { remindDays:Math.min(n, 365) }); A.saveBiz(b); refreshReminders(); rerender(); },
    openLoan: function(id){ try{ A.recReturn = A._snapNav ? A._snapNav() : null; }catch(e){ A.recReturn = null; } A._loanPage = null; A._loanTab = null; A.wsSection = LABEL; A.editingId = id; A.wsMode = 'view'; A.listQuery = ''; A.renderWorkspace(); },
    openPayment: function(id){ try{ A.recReturn = A._snapNav ? A._snapNav() : null; }catch(e){ A.recReturn = null; } var lbl = (typeof KEY2LABEL !== 'undefined' && KEY2LABEL.payments) || 'Payments';
      A.wsSection = lbl; A.editingId = id; A.wsMode = 'view'; A.listQuery = ''; A.renderWorkspace(); },
    report: function(kind){ var t = today();
      A._loanPage = kind === 'emi' ? { page:'emi', from:t.slice(0, 4) + '-01-01', to:t.slice(0, 4) + '-12-31', status:'all', loanId:'' } : kind === 'class' ? { page:'class', date:t, from:t.slice(0, 4) + '-01-01' } : null;
      A.wsMode = 'list'; A.editingId = null; rerender(); },
    repSet: function(k, v){ if(!A._loanPage) return; A._loanPage[k] = v; rerender(); },
    printReport: function(){ var el = byId('lnRepDoc'); if(!el) return; printRegion('<div class="rep-print ln-rep-print">' + el.innerHTML + '</div>', 'Loans'); },
    copyReport: function(){ var el = byId('lnRepDoc'); if(!el) return; var tsv = [];
      try{ el.querySelectorAll('table tr').forEach(function(tr){ var cells = []; tr.querySelectorAll('th,td').forEach(function(td){ cells.push(String(td.textContent || '').replace(/\s+/g, ' ').trim()); }); tsv.push(cells.join('\t')); }); }catch(e){}
      var s = tsv.join('\n'); try{ navigator.clipboard.writeText(s).then(function(){ toast('Copied ' + tsv.length + ' rows'); }, function(){ say(s); }); }catch(e){ say(s); } },
    printSchedule: function(id){ var b = cur(), L = find(b, id); if(!L) return; return printRegion(scheduleDoc(b, L), 'Amortisation schedule — ' + label(L)); },
    scheduleDoc: function(id){ var b = cur(), L = find(b, id); return L ? scheduleDoc(b, L) : ''; },

    /* form */
    formSync: function(){
      var dto = 'bank'; try{ var c = document.querySelector('input[name="ln_disb"]:checked'); if(c) dto = c.value; document.querySelectorAll('.ln-rad').forEach(function(l){ var i = l.querySelector('input'); l.classList.toggle('on', !!(i && i.checked)); }); }catch(e){}
      var m = (byId('ln_method') || {}).value || 'reducing';
      var show = function(sel, on){ try{ document.querySelectorAll(sel).forEach(function(el){ el.hidden = !on; }); }catch(e){} };
      show('.ln-only-bank', dto === 'bank'); show('.ln-only-account', dto === 'account'); show('.ln-only-opening', dto === 'opening'); show('.ln-not-opening', dto !== 'opening');
      show('.ln-only-flat', m === 'flat'); show('.ln-not-flat', m !== 'flat'); show('.ln-only-reducing', m === 'reducing');
      UI.preview();
    },
    preview: function(){
      var el = byId('ln_preview'); if(!el) return; var b = cur(); if(!b) return;
      var v = readForm(); var P = num(v.principal), n = parseInt(v.n, 10);
      if(!(P > 0) || !(n >= 1) || !iso(v.date)){ el.innerHTML = '<span class="ln-muted">Enter the principal, date and number of instalments to see the EMI.</span>'; return; }
      var L = Object.assign({}, v, { id:null, principal:P, rate:num(v.rate), n:Math.min(n, 600), firstDate:iso(v.firstDate) || addMonths(iso(v.date), (FREQS[v.freq] || FREQS.monthly)[1]), overrides:{} });
      if(A.editingId != null){ var ex = find(b, A.editingId); if(ex){ L.id = ex.id; L.overrides = ex.overrides || {}; L.accounts = ex.accounts; } }
      var S = schedule(b, L);
      el.innerHTML = '<div><span>Instalment</span><b>' + money(S.instalment) + '</b></div><div><span>Total interest</span><b>' + money(S.totals.interest) + '</b></div>' +
        '<div><span>Total repayable</span><b>' + money(S.totals.emi) + '</b></div><div><span>Last instalment</span><b>' + esc(fmtD(S.endDate)) + '</b></div>';
    },
    saveForm: function(){
      if(typeof A.guardWrite === 'function' && !A.guardWrite()) return;
      var b = cur(); if(!b) return; var v = readForm();
      var res = upsert(b, v, A.editingId);
      if(!res.ok){ say(res.error); return; }
      afterChange(b); A.saveBiz(b); refreshReminders();
      toast(A.editingId != null ? 'Loan updated' : 'Loan created');
      A.editingId = res.record.id; A.wsMode = 'view'; A._loanTab = 'schedule'; A.renderMain(cur());
    },

    /* pay one */
    payOpen: function(id, no){
      var b = cur(); if(!guard(b)) return; var L = find(b, id); if(!L) return;
      var S = sched(b, L), r = S.rows.find(function(x){ return x.no === no; }); if(!r) return;
      if(r.paid) return say('Instalment ' + no + ' is already paid.');
      var earlier = S.rows.filter(function(x){ return x.no < no && !x.paid && !x.before; }).length;
      var bank = L.payFrom || L.bankAccount || banks(b)[0] || '';
      overlay('<div class="app-modal-h">Pay instalment ' + no + ' — ' + esc(label(L)) + '</div>' +
        '<div class="app-modal-b ln-dlg">' +
          '<div class="ln-dlg-head"><span>Due ' + esc(fmtD(r.date)) + ' · interest ' + money(r.interest) + ' · principal ' + money(r.principal) + (r.arrears > 0.004 ? ' · incl. arrears ' + money(r.arrears) : '') + '</span><b class="ln-dlg-amt">' + money(r.emi) + '</b></div>' +
          (earlier ? '<p class="ln-dlg-warn">' + earlier + ' earlier instalment' + (earlier === 1 ? ' is' : 's are') + ' still unpaid.</p>' : '') +
          '<div class="ln-dlg-grid">' +
            '<div><label class="fld">Payment date</label><input type="date" id="lnDlgFirst" value="' + esc(r.date) + '"></div>' +
            '<div><label class="fld">Paid from</label><select id="lnDlgBank">' + opt(banks(b), bank, '— Select —') + '</select></div>' +
            '<div><label class="fld">Amount paid</label><input type="text" inputmode="decimal" class="r" id="lnDlgAmt" value="' + m2(r.emi) + '" oninput="Loans.ui._paySplit(' + r2(r.interest) + ')"></div>' +
            '<div><label class="fld">Of which interest</label><input type="text" inputmode="decimal" class="r" id="lnDlgInt" value="' + m2(r.interest) + '" oninput="Loans.ui._paySplit()"></div>' +
            '<div><label class="fld">Reference <small class="ln-hint">(optional)</small></label><input type="text" id="lnDlgRef" placeholder="next payment no."></div>' +
            '<div><label class="fld">Settle the loan</label><button type="button" class="btn btn-sm" onclick="Loans.ui._settle(' + r2(r.opening + r.interest) + ',' + r2(r.interest) + ')">Pay off ' + money(r2(r.opening + r.interest)) + '</button></div>' +
          '</div>' +
          '<div class="ln-split" id="lnDlgSplit"></div>' +
          '<p class="ln-dlg-muted">Creates a payment: Dr loan (principal) and Dr interest expense, Cr the bank. Pay more to reduce the principal (the rows after are re-planned); pay less and the shortfall is carried to the next instalment as arrears.</p>' +
          '<div class="ln-dlg-err" id="lnDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="Loans.ui._payRun(' + jsArg(L.id) + ',' + no + ')">Create payment</button></div>');
      UI._paySplit();
    },
    _paySplit: function(defInt){
      var a = byId('lnDlgAmt'), i = byId('lnDlgInt'), el = byId('lnDlgSplit'); if(!a || !i || !el) return;
      if(defInt != null && num(i.value) > num(a.value)) i.value = m2(Math.min(defInt, num(a.value)));
      var p = r2(num(a.value) - num(i.value));
      el.innerHTML = 'Principal <b>' + money(p) + '</b> · Interest <b>' + money(num(i.value)) + '</b>'; if(el.classList) el.classList.toggle('neg', p < 0);
    },
    _settle: function(total, intr){ var a = byId('lnDlgAmt'), i = byId('lnDlgInt'); if(a) a.value = m2(total); if(i) i.value = m2(intr); UI._paySplit(); },
    _payRun: function(id, no){
      var g = function(x){ return (byId(x) || {}).value; };
      var res = payRow(cur(), id, no, { date:g('lnDlgFirst'), bankAccount:g('lnDlgBank'), amount:g('lnDlgAmt'), interest:g('lnDlgInt'), reference:g('lnDlgRef') });
      if(!res.ok) return dlgErr(res.error);
      A._closeOverlay(); refreshReminders(); toast('Payment ' + res.doc.reference + ' created'); rerender();
    },
    unpayAsk: function(id, no){
      var b = cur(); if(!guard(b)) return; var L = find(b, id); if(!L) return;
      var d = loanDocs(b, L).filter(function(p){ return parseInt(p.loanRow, 10) === no; });
      return ask('Undo instalment ' + no + '? Payment ' + d.map(function(x){ return x.reference; }).join(', ') + ' is deleted and the instalment is unpaid again.', { title:'Undo payment', okText:'Undo payment', danger:true }).then(function(ok){
        if(!ok) return; var r = unpayRow(cur(), id, no); if(!r.ok) return say(r.error); refreshReminders(); toast('Payment deleted'); rerender(); });
    },
    regenerateAsk: function(id){
      var b = cur(); if(!guard(b)) return; var L = find(b, id); if(!L) return; var n = Object.keys(L.overrides || {}).length;
      return ask('Regenerate the schedule of ' + label(L) + '? ' + n + ' changed row' + (n === 1 ? '' : 's') + ' go back to the calculated figures. Paid instalments keep their payments.', { title:'Regenerate schedule', okText:'Regenerate', danger:true }).then(function(ok){
        if(!ok) return; var r = regenerate(cur(), id); if(!r.ok) return say(r.error); toast('Schedule regenerated'); rerender(); });
    },

    /* change a row */
    rowOpen: function(id, no){
      var b = cur(); if(!guard(b)) return; var L = find(b, id); if(!L) return;
      var S = sched(b, L), r = S.rows.find(function(x){ return x.no === no; }); if(!r) return; var o = (L.overrides || {})[no] || {};
      var val = function(k, d){ return has(o[k]) ? o[k] : d; };
      var lock = r.paid ? ' disabled' : '';
      var remaining = S.rows.length - no + 1;
      overlay('<div class="app-modal-h">Instalment ' + no + ' — ' + esc(label(L)) + '</div>' +
        '<div class="app-modal-b ln-dlg">' +
          (r.paid ? '<p class="ln-dlg-muted">This instalment is paid: only its date can change. Undo the payment to change the figures.</p>' : '') +
          '<div class="ln-dlg-grid">' +
            '<div><label class="fld">Due date</label><input type="date" id="lnDlgFirst" value="' + esc(val('date', r.date)) + '"></div>' +
            '<div><label class="fld">Following dates</label><label class="ln-chk"><input type="checkbox" id="lnDlgShift"' + (o.shift === false ? '' : ' checked') + '> Move the following dates too</label></div>' +
            '<div><label class="fld">EMI amount</label><input type="text" inputmode="decimal" class="r" id="lnDlgEmi" value="' + esc(has(o.emi) ? m2(o.emi) : '') + '" placeholder="' + m2(r.emi - r.arrears) + '"' + lock + '></div>' +
            '<div><label class="fld">Interest</label><input type="text" inputmode="decimal" class="r" id="lnDlgInt" value="' + esc(has(o.interest) ? m2(o.interest) : '') + '" placeholder="' + m2(r.schedInterest) + '"' + lock + '></div>' +
            '<div><label class="fld">Principal</label><input type="text" inputmode="decimal" class="r" id="lnDlgPrin" value="' + esc(has(o.principal) ? m2(o.principal) : '') + '" placeholder="' + m2(r.schedPrincipal) + '"' + lock + '></div>' +
            '<div><label class="fld">New annual rate % <small class="ln-hint">(from this row)</small></label><input type="text" inputmode="decimal" class="r" id="lnDlgRate" value="' + esc(has(o.rate) ? o.rate : '') + '" placeholder="' + esc(String(num(L.rate))) + '"></div>' +
            '<div><label class="fld">Remaining instalments <small class="ln-hint">(reschedule)</small></label><input type="number" min="1" max="600" class="r" id="lnDlgRem" value="' + esc(has(o.remaining) ? o.remaining : '') + '" placeholder="' + remaining + '"></div>' +
          '</div>' +
          '<p class="ln-dlg-muted">Leave a field blank to keep the calculated figure. The rows after this one are recalculated' + (L.onChange === 'tenure' && methodOf(L) === 'reducing' ? ' with the same EMI (the loan finishes earlier or later).' : ' so the loan still finishes on time (new EMI).') + '</p>' +
          '<div class="ln-dlg-err" id="lnDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f">' + (Object.keys(o).length ? '<button class="btn" onclick="Loans.ui._rowRun(' + jsArg(L.id) + ',' + no + ',true)">Reset this row</button>' : '') + '<span style="flex:1"></span>' +
          '<button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="Loans.ui._rowRun(' + jsArg(L.id) + ',' + no + ')">Apply</button></div>');
    },
    _rowRun: function(id, no, reset){
      var b = cur(), L = find(b, id); if(!L) return;
      var g = function(x){ return (byId(x) || {}).value; };
      var S = sched(b, L), r = S.rows.find(function(x){ return x.no === no; }) || {};
      var v = reset ? {} : { emi:g('lnDlgEmi'), interest:g('lnDlgInt'), principal:g('lnDlgPrin'), rate:g('lnDlgRate'), remaining:g('lnDlgRem') };
      if(!reset){ var d = g('lnDlgFirst'), sh = byId('lnDlgShift'); var o0 = (L.overrides || {})[no] || {};
        if(d && (d !== r.date || has(o0.date))){ v.date = d; v.shift = sh ? !!sh.checked : true; } }
      var res = setRow(b, id, no, v);
      if(!res.ok) return dlgErr(res.error);
      A._closeOverlay(); toast(reset ? 'Row reset' : 'Instalment ' + no + ' changed — following rows recalculated'); rerender();
    },

    /* bulk */
    bulkOpen: function(loanId){
      var b = cur(); if(!guard(b)) return; var asOf = today();
      var list = dueRows(b, asOf, loanId);
      if(!list.length){ var nx = []; recs(b).forEach(function(L){ if(loanId != null && String(L.id) !== String(loanId)) return; var x = sched(b, L).next; if(x) nx.push(fmtD(x.date) + ' — ' + label(L)); });
        return say('No EMIs are due today or overdue.' + (nx.length ? '\nNext: ' + nx.slice(0, 3).join('; ') : '')); }
      var rows = list.map(function(x, i){ return '<tr><td class="act chk"><input type="checkbox" class="ln-bk" data-loan="' + esc(x.loan.id) + '" data-no="' + x.row.no + '" checked aria-label="Pay instalment ' + x.row.no + ' of ' + esc(label(x.loan)) + '" onchange="Loans.ui._bulkSum()"></td>' +
        '<td class="nw">' + esc(fmtD(x.row.date)) + '</td><td>' + esc(label(x.loan)) + '</td><td class="r">' + x.row.no + '</td><td class="r m" data-amt="' + x.row.emi + '">' + money(x.row.emi) + '</td><td>' + badge(x.row.status) + '</td></tr>'; }).join('');
      overlay('<div class="app-modal-h">Pay due EMIs</div>' +
        '<div class="app-modal-b ln-dlg">' +
          '<div class="tbl-scroll"><table class="reg-tbl ln-bulk"><thead><tr><th class="act"></th><th>Due</th><th>Loan</th><th class="r">No.</th><th class="r">EMI</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<div class="ln-split" id="lnBulkSum"></div>' +
          '<div class="ln-dlg-grid">' +
            '<div><label class="fld">Payment date</label><select id="lnDlgWhen" onchange="var d=document.getElementById(\'lnDlgFirst\');if(d)d.hidden=this.value!==\'date\'"><option value="due">Each on its due date</option><option value="date">One date for all</option></select><input type="date" id="lnDlgFirst" value="' + asOf + '" hidden></div>' +
            '<div><label class="fld">Paid from</label><select id="lnDlgBank">' + opt(banks(b), '', 'Each loan’s own account') + '</select></div>' +
          '</div>' +
          '<p class="ln-dlg-muted">One payment per instalment for the amount due, split into principal and interest.</p>' +
          '<div class="ln-dlg-err" id="lnDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="Loans.ui._bulkRun()">Create payments</button></div>');
      UI._bulkSum();
    },
    _bulkSum: function(){ var el = byId('lnBulkSum'); if(!el) return; var n = 0, s = 0;
      try{ document.querySelectorAll('.ln-bk').forEach(function(c){ if(!c.checked) return; n++; var td = c.closest('tr').querySelector('[data-amt]'); s += num(td && td.getAttribute('data-amt')); }); }catch(e){}
      el.innerHTML = n + ' selected · <b>' + money(r2(s)) + '</b>'; },
    _bulkRun: function(){
      var items = []; try{ document.querySelectorAll('.ln-bk').forEach(function(c){ if(c.checked){ var id = c.getAttribute('data-loan'); items.push({ loanId:isNaN(Number(id)) ? id : Number(id), no:parseInt(c.getAttribute('data-no'), 10) }); } }); }catch(e){}
      if(!items.length) return dlgErr('Tick the instalments to pay.');
      var when = (byId('lnDlgWhen') || {}).value || 'due';
      var res = bulkPay(cur(), items, { date:when === 'date' ? (byId('lnDlgFirst') || {}).value : 'due', bankAccount:(byId('lnDlgBank') || {}).value });
      if(!res.done.length) return dlgErr(res.failed.length ? res.failed[0].error : 'Nothing was paid.');
      A._closeOverlay(); refreshReminders(); toast('Created ' + res.done.length + ' payment' + (res.done.length === 1 ? '' : 's') + (res.failed.length ? ' — ' + res.failed.length + ' skipped' : ''));
      if(res.failed.length) say(res.failed.map(function(f){ return 'Instalment ' + f.no + ': ' + f.error; }).join('\n'));
      rerender();
    }
  });
  var Loans = {
    KEY:KEY, LABEL:LABEL, TYPES:TYPES, METHODS:METHODS, ACC:ACC,
    annuity:annuity, splitFlat:splitFlat, addMonths:addMonths, eom:eom,
    schedule:schedule, sched:sched, classifyAt:classifyAt, accruedAt:accruedAt, classify:classify, statusOf:statusOf,
    postings:postings, ensureAccounts:ensureAccounts, roleAcct:roleAcct, loanDocs:loanDocs,
    upsert:upsert, remove:remove, setRow:setRow, regenerate:regenerate, payRow:payRow, unpayRow:unpayRow, dueRows:dueRows, bulkPay:bulkPay,
    emiReport:emiReport, classification:classification, statement:statement, reminders:reminders, registerReminders:registerReminders,
    remindDays:remindDays, find:find, label:label, today:today, ui:UI,
    _h:{ esc:esc, num:num, r2:r2, m2:m2, money:money, fmtD:fmtD, pct:pct, iso:iso, addDays:addDays, daysBetween:daysBetween, blank:blank, has:has, clone:clone,
      say:say, ask:ask, toast:toast, byId:byId, wrap:wrap, curKey:curKey, cur:cur, ro:ro, guard:guard, banks:banks, acct:acct, acctNm:acctNm, refreshReminders:refreshReminders,
      perMonths:perMonths, methodOf:methodOf, FREQS:FREQS, BANKS:BANKS, ST_CLASS:ST_CLASS, lockMsg:lockMsg }
  };
  global.Loans = Loans;
  registerReminders();
  /* the app restores the open page while the scripts are still loading (js/designer.js runs App.init):
     draw it again once everything is in, so the sidebar entry and the loan postings show on a reload */
  /* the page was reloaded on this tab (#b=..&s=loans&m=..&id=..): js/ledger-nav.js ran before this file
     registered the tab, so open it here (the hash as loaded is kept by the navigation entry) */
  function bootRoute(){
    var h = ''; try{ var nv = global.performance && global.performance.getEntriesByType && global.performance.getEntriesByType('navigation')[0]; h = String((nv && nv.name) || '').split('#')[1] || ''; }catch(e){}
    var o = {}; h.split('&').forEach(function(p){ var i = p.indexOf('='); if(i > 0){ try{ o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); }catch(e){} } });
    if(o.s !== KEY || String(o.b) !== String(A.openBiz) || A.wsSection === LABEL) return false;
    var b = A.curBiz(), L = o.id != null ? find(b, o.id) : null;
    if(L && (o.m === 'view' || o.m === 'form')){ A.wsSection = LABEL; A.editingId = L.id; A.wsMode = o.m; A.listQuery = ''; A.renderWorkspace(); return true; }
    A.selectSection(LABEL); return true;
  }
  function redrawIfOpen(){ try{ if(hasDoc && A.view === 'workspace' && A.openBiz != null && A.curBiz()){ if(!bootRoute()) A.renderWorkspace(); } }catch(e){} }
  if(hasDoc && typeof document.addEventListener === 'function'){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(redrawIfOpen, 0); });
    else setTimeout(redrawIfOpen, 0); }
  if(hasDoc && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', registerReminders);
  try{ setTimeout(registerReminders, 0); }catch(e){}
})(typeof window !== 'undefined' ? window : this);
