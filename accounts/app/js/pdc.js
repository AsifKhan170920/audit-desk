/* ===================== PDC — post-dated cheques =====================
   A "PDC" tab in the Banking group for cheques received from customers and
   cheques issued to suppliers, dated in the future.

   Accounting rule: a PDC NEVER posts to the general ledger. While it is
   Pending or Deposited it shows in the party's ledger and statement as an
   informational row (no debit, no credit, balance unchanged). Clearing it
   creates a real Receipt (received cheque) or Payment (issued cheque) on the
   clearing date in the chosen bank account — that document is what posts, so
   the trial balance stays Dr = Cr by construction.

   Record (b.records.pdc[]):
     { id, uuid, type:'Received'|'Issued', party, chequeNo, drawerBank,
       chequeDate (due, YYYY-MM-DD), amount, bankAccount (our bank / cash name),
       date (received / issued date), description,
       status:'Pending'|'Deposited'|'Cleared'|'Bounced'|'Cancelled',
       depositDate, clearingDate, clearedKey:'receipts'|'payments', clearedId, clearedRef,
       bounceDate, bounceNote, chargeKey, chargeId }

   If the linked receipt / payment is deleted, the cheque reads as Pending
   again (statusOf), so nothing is ever stranded.

   Everything is layered over js/app.js with wrappers (no edits there): a REG
   entry so lists, sorting, Edit columns and bulk select work as for any tab;
   own form / view pages; ledger info rows; and a Reminders source
   (window.Reminders.register('pdc', fn), see FEATURES_SPEC.md).
   ==================================================================== */
(function(global){
  'use strict';
  var A = global.App || (typeof App !== 'undefined' ? App : null);
  if(!A || A.__pdc) return;
  A.__pdc = 1;

  var KEY = 'pdc', LABEL = 'PDC';
  var STATUSES = ['Pending', 'Deposited', 'Cleared', 'Bounced', 'Cancelled'];
  var OPEN = { Pending:1, Deposited:1 };
  var ST_CLASS = { Pending:'st-unpaid', Deposited:'st-partial', Cleared:'st-paid', Bounced:'st-overdue', Cancelled:'st-draft' };

  var hasDoc = typeof document !== 'undefined' && document && typeof document.getElementById === 'function';
  function byId(id){ try{ return hasDoc ? document.getElementById(id) : null; }catch(e){ return null; } }
  function esc(s){ return A.esc(s == null ? '' : s); }
  function num(v){ if(v == null || v === '') return 0; if(typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function r2(n){ return Math.round((Number(n) || 0) * 100) / 100; }
  function blank(v){ return v == null || String(v).trim() === ''; }
  function clone(o){ return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function p2(n){ return (n < 10 ? '0' : '') + n; }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function iso(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[0] : ''; }
  function dayNum(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; }
  /** whole days from a to b (b - a) */
  function daysBetween(a, b){ var x = dayNum(a), y = dayNum(b); return (x == null || y == null) ? null : Math.round(y - x); }
  function money(n){ try{ return A.money(n); }catch(e){ return r2(n).toFixed(2); } }
  function fmtD(s){ try{ return A.fmtDate ? A.fmtDate(s) : A.fmtDateUS(s); }catch(e){ return String(s || ''); } }
  function M(){ return (global.UIModal) || null; }
  function say(t){ var m = M(); if(m) return m.alert(t); try{ alert(t); }catch(e){} return Promise.resolve(); }
  function ask(t, o){ var m = M(); if(m) return m.confirm(t, o); return Promise.resolve(true); }
  function toast(t){ var m = M(); if(m && m.toast) m.toast(t); }
  function G(n){ return (typeof global[n] === 'function') ? global[n] : null; }
  function wrap(name, fn){ var orig = A[name]; if(typeof orig !== 'function') return; A[name] = function(){ return fn.call(this, orig, arguments); }; }
  function curKey(){ return (typeof LABEL2KEY !== 'undefined') ? LABEL2KEY[A.wsSection] : null; }
  function cur(){ try{ return A.curBiz(); }catch(e){ return null; } }

  /* ------------------------------------------------------------------ model */
  function recs(b){ return (b && b.records && b.records[KEY]) || []; }
  function find(b, id){ return recs(b).find(function(r){ return String(r.id) === String(id); }) || null; }
  function typeOf(r){ return /^iss/i.test(String((r && r.type) || '')) ? 'Issued' : 'Received'; }
  function isReceived(r){ return typeOf(r) === 'Received'; }
  function docKeyFor(r){ return isReceived(r) ? 'receipts' : 'payments'; }
  function docOf(b, key, id){ if(!key || id == null) return null; return (((b && b.records) || {})[key] || []).find(function(d){ return String(d.id) === String(id); }) || null; }
  /** Status as it really is: a "Cleared" cheque whose receipt / payment was deleted is Pending again. */
  function statusOf(b, r){
    var s = String((r && r.status) || '').trim(); s = s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Pending';
    if(STATUSES.indexOf(s) < 0) s = 'Pending';
    if(s === 'Cleared' && r.clearedId != null && b && !docOf(b, r.clearedKey || docKeyFor(r), r.clearedId)) return 'Pending';
    return s;
  }
  function isOpen(b, r){ return !!OPEN[statusOf(b, r)]; }
  function dueIn(r, t){ return r && r.chequeDate ? daysBetween(t || today(), r.chequeDate) : null; }
  function remindDays(b){ var v = b && b.pdcSettings && b.pdcSettings.remindDays; v = parseInt(v, 10); return isNaN(v) || v < 0 ? 3 : Math.min(v, 365); }
  function dueText(d){ if(d == null) return ''; if(d === 0) return 'Due today'; if(d < 0) return 'Overdue ' + (-d) + (d === -1 ? ' day' : ' days'); return 'In ' + d + (d === 1 ? ' day' : ' days'); }
  function chequeLabel(r){ return 'PDC' + (blank(r.chequeNo) ? '' : ' #' + r.chequeNo); }
  /** The informational ledger text: "PDC #123 due 08/10/2026 — pending (1,500.00)". */
  function infoText(b, r){ return chequeLabel(r) + (r.chequeDate ? ' due ' + fmtD(r.chequeDate) : '') + ' — ' + statusOf(b, r).toLowerCase() + ' (' + money(num(r.amount)) + ')'; }

  var lastId = 0;
  function newId(b){ var t = Date.now(); var max = 0; recs(b).forEach(function(r){ if(Number(r.id) > max) max = Number(r.id); });
    lastId = Math.max(t, lastId + 1, max + 1); return lastId; }
  function newDocId(b, key){ var t = Date.now(); var max = 0; (((b.records || {})[key]) || []).forEach(function(r){ if(Number(r.id) > max) max = Number(r.id); });
    lastId = Math.max(t, lastId + 1, max + 1); return lastId; }
  function uuid(){ try{ return A.uuid(); }catch(e){ return 'pdc-' + Date.now().toString(36) + Math.random().toString(36).slice(2); } }
  function log(b, action, key, rec, before, label){ try{ A._logActivity(b, action, key, rec, before, label ? { label:label } : null); }catch(e){} }
  function lockMsg(b, d){ var lk = (b && b.lockDate) || ''; if(lk && d && d <= lk) return 'The date ' + fmtD(d) + ' is on or before the lock date (' + fmtD(lk) + '). Choose a later date or update Settings → Lock Date.'; return ''; }
  function refreshReminders(){ try{ if(global.Reminders && typeof global.Reminders.refresh === 'function') global.Reminders.refresh(); }catch(e){} }
  function afterChange(b){ try{ var rs = G('refreshSummary'); if(rs) rs(b); }catch(e){} }

  function banks(b){ return (((b && b.records) || {}).bankCash || []).filter(function(x){ return x && x.name && !x.inactive; }).map(function(x){ return x.name; }); }
  function parties(b, type){ var k = type === 'Issued' ? 'suppliers' : 'customers'; return (((b && b.records) || {})[k] || []).map(function(x){ return x && x.name; }).filter(Boolean); }

  /** Normalise + validate the editable fields. Returns {ok, data} or {ok:false, error}. */
  function clean(b, v){
    var d = {
      type: typeOf(v), party: String(v.party || '').trim(), chequeNo: String(v.chequeNo || '').trim(),
      drawerBank: String(v.drawerBank || '').trim(), chequeDate: iso(v.chequeDate), amount: r2(num(v.amount)),
      bankAccount: String(v.bankAccount || '').trim(), date: iso(v.date), description: String(v.description || '').trim()
    };
    if(!d.party) return { ok:false, error:'Choose the ' + (d.type === 'Issued' ? 'supplier' : 'customer') + '.' };
    if(!d.chequeDate) return { ok:false, error:'Enter the cheque date (the date it falls due).' };
    if(!(d.amount > 0)) return { ok:false, error:'Enter the cheque amount.' };
    if(v.status != null && v.status !== ''){ var s = String(v.status); s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); if(STATUSES.indexOf(s) >= 0) d.status = s; }
    return { ok:true, data:d };
  }

  /** Create (id == null) or update a PDC. Status Cleared / Bounced is reached only through clear() / bounce(). */
  function upsert(b, v, id){
    var c = clean(b, v); if(!c.ok) return c; var d = c.data;
    b.records = b.records || {}; var arr = b.records[KEY] = b.records[KEY] || [];
    var dup = arr.find(function(r){ return String(r.id) !== String(id) && !blank(d.chequeNo) && typeOf(r) === d.type && r.party === d.party &&
      String(r.chequeNo || '').trim() === d.chequeNo && statusOf(b, r) !== 'Cancelled'; });
    if(dup) return { ok:false, error:'Cheque #' + d.chequeNo + ' for ' + d.party + ' is already recorded.' };
    if(id != null){
      var r = find(b, id); if(!r) return { ok:false, error:'This cheque no longer exists.' };
      var before = clone(r), st = statusOf(b, r);
      if(st === 'Cleared'){ r.description = d.description; }        // the posted receipt / payment carries the figures
      else {
        ['type', 'party', 'chequeNo', 'drawerBank', 'chequeDate', 'amount', 'bankAccount', 'date', 'description'].forEach(function(k){ r[k] = d[k]; });
        if(d.status && (OPEN[d.status] || d.status === 'Cancelled') && st !== 'Bounced') r.status = d.status;
        if(r.status === 'Deposited' && !r.depositDate) r.depositDate = today();
      }
      log(b, 'update', KEY, r, before, chequeLabel(r) + ' — ' + r.party);
      return { ok:true, record:r };
    }
    var rec = Object.assign({ id:newId(b), uuid:uuid() }, d);
    if(!rec.date) rec.date = today();
    rec.status = (d.status && (OPEN[d.status] || d.status === 'Cancelled')) ? d.status : 'Pending';
    if(rec.status === 'Deposited') rec.depositDate = today();
    arr.push(rec);
    log(b, 'create', KEY, rec, null, chequeLabel(rec) + ' — ' + rec.party);
    return { ok:true, record:rec };
  }

  function controlAcct(b, received){
    var ec = G('ensureControl'); var name = received ? 'Accounts receivable' : 'Accounts payable';
    var n = ec ? ec(b, name, received ? 'assets' : 'liabilities') : null;
    if(!n && typeof GL !== 'undefined') n = GL.sysAcct(b, received ? 'accounts receivable' : 'accounts payable', true);
    return n;
  }

  /**
   * Clear a Pending / Deposited cheque: creates the Receipt (received) or Payment
   * (issued) on opts.date in opts.bankAccount, linked both ways, status Cleared.
   * opts.allocations: [{uid, amount}] against the party's open invoices (optional).
   * opts.noSave: leave saving to the caller (bulk clear saves once).
   */
  function clear(b, id, opts){
    opts = opts || {};
    var r = find(b, id); if(!r) return { ok:false, error:'This cheque no longer exists.' };
    var st = statusOf(b, r); if(!OPEN[st]) return { ok:false, error:chequeLabel(r) + ' is ' + st.toLowerCase() + ' — only pending or deposited cheques can be cleared.' };
    var date = iso(opts.date) || today();
    var bank = String(opts.bankAccount || r.bankAccount || '').trim();
    if(!bank) return { ok:false, error:'Choose the bank account the cheque ' + (isReceived(r) ? 'was deposited to.' : 'was drawn on.') };
    if(banks(b).indexOf(bank) < 0 && !((b.records.bankCash || []).some(function(x){ return x.name === bank; }))) return { ok:false, error:'Bank account "' + bank + '" was not found.' };
    var lm = lockMsg(b, date); if(lm) return { ok:false, error:lm };
    var amt = r2(num(r.amount)); if(!(amt > 0)) return { ok:false, error:chequeLabel(r) + ' has no amount.' };
    var received = isReceived(r), key = received ? 'receipts' : 'payments', invKey = received ? 'salesInv' : 'purchInv';
    var allocs = (opts.allocations || []).map(function(x){ return { key:invKey, uid:x.uid, party:r.party, amount:r2(num(x.amount)) }; }).filter(function(x){ return x.uid && x.amount > 0; });
    var aSum = r2(allocs.reduce(function(s, x){ return s + x.amount; }, 0));
    if(aSum > amt + 0.004) return { ok:false, error:'Allocations (' + money(aSum) + ') are more than the cheque amount (' + money(amt) + ').' };

    var ctl = controlAcct(b, received); if(!ctl) return { ok:false, error:'The chart of accounts has no ' + (received ? 'Accounts receivable' : 'Accounts payable') + ' account.' };
    b.records = b.records || {}; var arr = b.records[key] = b.records[key] || [];
    var line = { item:'', account:ctl.id, accountName:ctl.name, sub:r.party, desc:'', description:'', qty:'', price:amt, discount:'',
                 net:amt, amount:amt, taxAmt:0, tax:'', taxCode:'', taxRate:'' };
    var ref = ''; try{ ref = A.nextRef(b, key); }catch(e){ ref = String(arr.length + 1); }
    var desc = 'PDC cheque' + (blank(r.chequeNo) ? '' : ' #' + r.chequeNo) + (blank(r.drawerBank) ? '' : ' (' + r.drawerBank + ')') + (blank(r.description) ? '' : ' — ' + r.description);
    var doc = { reference:ref, date:date, description:desc, subtotal:amt, tax:0, total:amt, lines:[line],
                colLineNum:false, colItem:true, showDescCol:false, colQty:false, colDiscount:false, colDivision:false, taxExclusive:false, showTaxCol:false,
                amount:amt, allocations:allocs, pdcId:r.id, pdcUuid:r.uuid || null };
    if(received){ doc.receivedIn = bank; doc.paidBy = r.party; doc.paidByType = 'customer'; }
    else { doc.paidFrom = bank; doc.payee = r.party; doc.payeeType = 'supplier'; }
    doc.id = newDocId(b, key); doc.uuid = uuid();
    arr.push(doc);
    var before = clone(r);
    r.status = 'Cleared'; r.clearingDate = date; r.clearedKey = key; r.clearedId = doc.id; r.clearedRef = doc.reference; r.bankAccount = bank;
    try{ var ecc = G('ensureCashControl'); if(ecc) ecc(b); var eac = G('ensureAllControls'); if(eac) eac(b); }catch(e){}
    afterChange(b);
    log(b, 'create', key, doc, null);
    log(b, 'update', KEY, r, before, chequeLabel(r) + ' cleared — ' + r.party);
    if(!opts.noSave) A.saveBiz(b);
    return { ok:true, doc:doc, record:r };
  }

  /** Undo a clear: deletes the receipt / payment the clear created and sets the cheque back to Pending (or Deposited). */
  function unclear(b, id, opts){
    var r = find(b, id); if(!r) return { ok:false, error:'This cheque no longer exists.' };
    if(statusOf(b, r) !== 'Cleared') return { ok:false, error:chequeLabel(r) + ' is not cleared.' };
    var key = r.clearedKey || docKeyFor(r), d = docOf(b, key, r.clearedId);
    if(d){ var lm = lockMsg(b, iso(d.date)); if(lm) return { ok:false, error:lm };
      var before = clone(d); b.records[key] = b.records[key].filter(function(x){ return x !== d; }); log(b, 'delete', key, null, before); }
    var rb = clone(r);
    r.status = r.depositDate ? 'Deposited' : 'Pending'; delete r.clearingDate; delete r.clearedId; delete r.clearedRef; delete r.clearedKey;
    afterChange(b); log(b, 'update', KEY, r, rb, chequeLabel(r) + ' clearing undone — ' + r.party);
    if(!(opts && opts.noSave)) A.saveBiz(b);
    return { ok:true, record:r };
  }

  /** Bounce: status Bounced; an optional bank charge becomes a Payment from the bank account to opts.chargeAccount. */
  function bounce(b, id, opts){
    opts = opts || {};
    var r = find(b, id); if(!r) return { ok:false, error:'This cheque no longer exists.' };
    var st = statusOf(b, r); if(!OPEN[st]) return { ok:false, error:chequeLabel(r) + ' is ' + st.toLowerCase() + ' — only pending or deposited cheques can bounce.' + (st === 'Cleared' ? ' Undo the clearing first.' : '') };
    var date = iso(opts.date) || today(), charge = r2(num(opts.charge));
    var before = clone(r), doc = null;
    if(charge > 0){
      var bank = String(opts.bankAccount || r.bankAccount || '').trim();
      if(!bank) return { ok:false, error:'Choose the bank account that charged the fee.' };
      var acct = ((b.coa || []).find(function(n){ return n && n.type === 'account' && String(n.id) === String(opts.chargeAccount); }));
      if(!acct) return { ok:false, error:'Choose the expense account for the bank charge.' };
      var lm = lockMsg(b, date); if(lm) return { ok:false, error:lm };
      var arr = b.records.payments = b.records.payments || [];
      var ref = ''; try{ ref = A.nextRef(b, 'payments'); }catch(e){ ref = String(arr.length + 1); }
      doc = { reference:ref, date:date, description:'Bank charge — bounced ' + chequeLabel(r) + ' (' + r.party + ')', subtotal:charge, tax:0, total:charge,
              lines:[{ item:'', account:acct.id, accountName:acct.name, sub:'', desc:'', description:'', qty:'', price:charge, discount:'', net:charge, amount:charge, taxAmt:0, tax:'', taxCode:'', taxRate:'' }],
              colLineNum:false, colItem:true, showDescCol:false, colQty:false, colDiscount:false, colDivision:false, taxExclusive:false, showTaxCol:false,
              amount:charge, paidFrom:bank, payee:'', payeeType:'other', pdcId:r.id, pdcUuid:r.uuid || null };
      doc.id = newDocId(b, 'payments'); doc.uuid = uuid(); arr.push(doc);
      r.chargeKey = 'payments'; r.chargeId = doc.id; r.bounceCharge = charge;
      try{ var ecc = G('ensureCashControl'); if(ecc) ecc(b); }catch(e){}
      log(b, 'create', 'payments', doc, null);
    }
    r.status = 'Bounced'; r.bounceDate = date; if(!blank(opts.note)) r.bounceNote = String(opts.note).trim();
    afterChange(b); log(b, 'update', KEY, r, before, chequeLabel(r) + ' bounced — ' + r.party);
    if(!opts.noSave) A.saveBiz(b);
    return { ok:true, record:r, doc:doc };
  }

  /** Simple status moves: deposit (Pending -> Deposited), cancel (open -> Cancelled), reopen (Bounced / Cancelled -> Pending). */
  function setStatus(b, id, to, opts){
    var r = find(b, id); if(!r) return { ok:false, error:'This cheque no longer exists.' };
    var st = statusOf(b, r), before = clone(r);
    if(to === 'Deposited'){ if(st !== 'Pending') return { ok:false, error:'Only a pending cheque can be marked deposited.' }; r.status = 'Deposited'; r.depositDate = iso(opts && opts.date) || today(); }
    else if(to === 'Cancelled'){ if(!OPEN[st]) return { ok:false, error:'Only a pending or deposited cheque can be cancelled.' }; r.status = 'Cancelled'; r.cancelDate = today(); }
    else if(to === 'Pending'){ if(st !== 'Bounced' && st !== 'Cancelled' && st !== 'Deposited') return { ok:false, error:'This cheque is already ' + st.toLowerCase() + '.' }; r.status = 'Pending'; delete r.depositDate; }
    else return { ok:false, error:'Unknown status.' };
    log(b, 'update', KEY, r, before, chequeLabel(r) + ' — ' + to.toLowerCase());
    if(!(opts && opts.noSave)) A.saveBiz(b);
    return { ok:true, record:r };
  }

  /* ------------------------------------------------------------------ reminders */
  /** Reminders source: open cheques overdue, due today, or due within the business's "remind N days before" (default 3). */
  function reminders(b){
    var t = today(), n = remindDays(b), out = [];
    recs(b).forEach(function(r){
      if(!isOpen(b, r) || !r.chequeDate) return;
      var d = dueIn(r, t); if(d == null || d > n) return;
      var rcv = isReceived(r);
      out.push({ id:'pdc:' + r.id, kind:'pdc', due:iso(r.chequeDate),
        severity: d < 0 ? 'overdue' : (d === 0 ? 'due' : 'soon'),
        title: (rcv ? 'PDC from ' : 'PDC to ') + (r.party || '—') + ' — ' + money(num(r.amount)),
        detail: chequeLabel(r) + ' · ' + (rcv ? 'received' : 'issued') + ' · ' + dueText(d).toLowerCase() + ' (' + fmtD(r.chequeDate) + ')' + (statusOf(b, r) === 'Deposited' ? ' · deposited' : ''),
        link:{ section:LABEL, key:KEY, id:r.id } });
    });
    out.sort(function(x, y){ return String(x.due).localeCompare(String(y.due)); });
    return out;
  }
  var registered = false;
  function registerReminders(){
    if(registered) return true;
    var R = global.Reminders;
    if(R && typeof R.register === 'function'){ try{ R.register('pdc', reminders); registered = true; }catch(e){} }
    return registered;
  }

  /* ------------------------------------------------------------------ register (sidebar + REG) */
  function install(){
    if(typeof REG === 'undefined' || typeof SIDEBAR === 'undefined') return;
    if(!REG[KEY]){
      var C = function(r){ return cur(); };
      REG[KEY] = { label:'PDC', singular:'Post-dated cheque', newLabel:'New PDC',
        columns:[
          { key:'chequeDate', label:'Cheque date', kind:'date' },
          { key:'type', label:'Type', kind:'text', calc:function(r){ return typeOf(r); } },
          { key:'chequeNo', label:'Cheque no.', kind:'text' },
          { key:'party', label:'Party', kind:'text' },
          { key:'drawerBank', label:'Bank', kind:'text' },
          { key:'bankAccount', label:'Deposit / issue account', kind:'text' },
          { key:'date', label:'Received / issued date', kind:'date' },
          { key:'description', label:'Description', kind:'text' },
          { key:'dueIn', label:'Due', kind:'num', r:1, calc:function(r){ return isOpen(C(), r) ? dueIn(r) : ''; } },
          { key:'status', label:'Status', kind:'text', calc:function(r){ return statusOf(C(), r); } },
          { key:'clearingDate', label:'Clearing date', kind:'date' },
          { key:'clearedRef', label:'Receipt / payment', kind:'text', calc:function(r){ return statusOf(C(), r) === 'Cleared' ? (r.clearedRef || '') : ''; } },
          { key:'amount', label:'Amount', kind:'money', r:1, bold:1 },
          { key:'__pdcAct', label:'Action', kind:'ledger' }
        ],
        defaultCols:['chequeDate', 'type', 'chequeNo', 'party', 'bankAccount', 'dueIn', 'status', 'amount', '__pdcAct'],
        form:[
          { key:'type', label:'Type', type:'select', options:['Received', 'Issued'], req:1 },
          { key:'party', label:'Party', type:'text', req:1 },
          { key:'chequeNo', label:'Cheque no.', type:'text' },
          { key:'drawerBank', label:'Bank', type:'text' },
          { key:'chequeDate', label:'Cheque date', type:'date', req:1 },
          { key:'amount', label:'Amount', type:'money', req:1 },
          { key:'bankAccount', label:'Deposit / issue account', type:'ref', from:'bankCash' },
          { key:'date', label:'Received / issued date', type:'date' },
          { key:'description', label:'Description', type:'text' },
          { key:'status', label:'Status', type:'select', options:STATUSES.slice() },
          { key:'clearingDate', label:'Clearing date', type:'date' }
        ],
        totalCol:'amount' };
    }
    if(!SIDEBAR.some(function(r){ return r[1] === LABEL; })){
      var at = SIDEBAR.findIndex(function(r){ return r[1] === 'Bank Reconciliations'; });
      SIDEBAR.splice(at >= 0 ? at + 1 : SIDEBAR.length, 0, ['🧾', LABEL, KEY]);
    }
    if(typeof SIDEBAR_GROUPS !== 'undefined'){
      var g = SIDEBAR_GROUPS.find(function(x){ return x[0] === 'Banking'; });
      if(g && g[1].indexOf(LABEL) < 0) g[1].push(LABEL);
    }
    if(typeof LABEL2KEY !== 'undefined') LABEL2KEY[LABEL] = KEY;
    if(typeof KEY2LABEL !== 'undefined' && !KEY2LABEL[KEY]) KEY2LABEL[KEY] = LABEL;
    /* sidebar icon: a cheque */
    var ICO = global.ICO;
    if(ICO && typeof ICO.forSection === 'function' && !ICO.__pdc){
      ICO.__pdc = 1; var fs = ICO.forSection;
      ICO.forSection = function(label, size, cls){
        if(label !== LABEL) return fs.apply(this, arguments);
        var s = size || 18;
        return '<svg class="ico' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h6M6 14h3M14 14.5c1-.9 1.6-.9 2.2 0s1.2.9 2-.2"/><path d="M15 9.5h3"/></svg>';
      };
    }
  }
  install();

  /* ------------------------------------------------------------------ ledger + statement info rows */
  wrap('ledgerEntries', function(orig, a){
    var e = orig.apply(this, a), b = a[0], key = a[1], rec = a[2];
    if((key !== 'customers' && key !== 'suppliers') || !rec || blank(rec.name) || !b) return e;
    var want = key === 'customers' ? 'Received' : 'Issued';
    var hits = recs(b).filter(function(r){ return typeOf(r) === want && r.party === rec.name && isOpen(b, r); });
    if(!hits.length) return e;
    var out = (e || []).slice();
    hits.forEach(function(r){ out.push({ date:iso(r.date) || iso(r.chequeDate), ref:blank(r.chequeNo) ? 'PDC' : 'PDC ' + r.chequeNo, type:infoText(b, r),
      debit:0, credit:0, src:KEY, id:r.id, pdcInfo:1 }); });
    out.sort(function(x, y){ return String(x.date || '').localeCompare(String(y.date || '')) || String(x.ref || '').localeCompare(String(y.ref || ''), undefined, { numeric:true }); });
    return out;
  });
  wrap('ledgerRowHtml', function(orig, a){
    var h = orig.apply(this, a), r = a[0];
    if(!r || !r.pdcInfo) return h;
    return String(h).replace(/^<tr([^>]*)>/, function(m, attrs){ return '<tr' + attrs + ' class="pdc-info-row" title="Post-dated cheque — information only, not posted until cleared">'; });
  });
  /* statements: the same rows, marked so print / screen show them muted */
  wrap('statementHtml', function(orig, a){
    var h = String(orig.apply(this, a) || '');
    return h.replace(/<tr>(<td>[^<]*<\/td><td>PDC[^<]*<\/td><td>PDC[^<]*?— (?:pending|deposited) \()/g, '<tr class="pdc-info-row">$1');
  });

  /* ------------------------------------------------------------------ list page */
  function filterRows(b, rows, f, ty){
    var t = today();
    if(ty === 'Received' || ty === 'Issued') rows = rows.filter(function(r){ return typeOf(r) === ty; });
    switch(f){
      case 'pending': return rows.filter(function(r){ return isOpen(b, r); });
      case 'week': return rows.filter(function(r){ var d = dueIn(r, t); return isOpen(b, r) && d != null && d >= 0 && d <= 6; });
      case 'overdue': return rows.filter(function(r){ var d = dueIn(r, t); return isOpen(b, r) && d != null && d < 0; });
      case 'cleared': return rows.filter(function(r){ return statusOf(b, r) === 'Cleared'; });
      case 'bounced': return rows.filter(function(r){ var s = statusOf(b, r); return s === 'Bounced' || s === 'Cancelled'; });
      default: return rows;
    }
  }
  /** Count + amount per status, split received / issued. */
  function totals(b, rows){
    var out = {}; STATUSES.forEach(function(s){ out[s] = { n:0, rcv:0, iss:0 }; });
    (rows || recs(b)).forEach(function(r){ var s = statusOf(b, r), o = out[s]; o.n++; if(isReceived(r)) o.rcv = r2(o.rcv + num(r.amount)); else o.iss = r2(o.iss + num(r.amount)); });
    return out;
  }

  wrap('sortedRecords', function(orig, a){
    var rows = orig.apply(this, a);
    if(curKey() !== KEY) return rows;
    var b = a[0] || cur(), f = this._pdcFilter || 'all';
    rows = filterRows(b, rows, f, this._pdcType || 'all');
    /* open-cheque views read soonest first */
    if(f === 'pending' || f === 'week' || f === 'overdue') rows = rows.slice().sort(function(x, y){ return String(x.chequeDate || '').localeCompare(String(y.chequeDate || '')) || (x.id - y.id); });
    return rows;
  });

  function toolbarHtml(b){
    var self = A, f = A._pdcFilter || 'all', ty = A._pdcType || 'all', all = recs(b), t = today();
    var typed = filterRows(b, all, 'all', ty);
    var cnt = function(k){ return filterRows(b, typed, k, 'all').length; };
    var tabs = [['all', 'All'], ['pending', 'Pending'], ['week', 'Due this week'], ['overdue', 'Overdue'], ['cleared', 'Cleared'], ['bounced', 'Bounced / cancelled']];
    var tabHtml = tabs.map(function(x){ var n = cnt(x[0]);
      return '<button type="button" role="tab" aria-selected="' + (f === x[0]) + '" class="pdc-tab' + (f === x[0] ? ' on' : '') + (x[0] === 'overdue' && n ? ' warn' : '') + '" onclick="PDC.filter(\'' + x[0] + '\')">' +
        esc(x[1]) + '<span class="pdc-n">' + n + '</span></button>'; }).join('');
    var tys = [['all', 'All'], ['Received', 'Received'], ['Issued', 'Issued']].map(function(x){
      return '<button type="button" class="pdc-seg' + (ty === x[0] ? ' on' : '') + '" aria-pressed="' + (ty === x[0]) + '" onclick="PDC.typeFilter(\'' + x[0] + '\')">' + esc(x[1]) + '</button>'; }).join('');
    var T = totals(b, typed);
    var chips = STATUSES.map(function(s){ var o = T[s]; if(!o.n && s !== 'Pending') return '';
      var parts = []; if(o.rcv || ty !== 'Issued') parts.push('<span class="pdc-in" title="Received">▼ ' + money(o.rcv) + '</span>'); if(o.iss || ty === 'Issued') parts.push('<span class="pdc-out" title="Issued">▲ ' + money(o.iss) + '</span>');
      if(ty === 'Received') parts = ['<span class="pdc-in">' + money(o.rcv) + '</span>']; if(ty === 'Issued') parts = ['<span class="pdc-out">' + money(o.iss) + '</span>'];
      return '<div class="pdc-chip"><span class="st-badge ' + ST_CLASS[s] + '">' + s + '</span><span class="pdc-chip-n">' + o.n + '</span>' + parts.join('') + '</div>'; }).join('');
    var ro = (typeof A.isReadOnly === 'function') ? A.isReadOnly(b) : false;
    return '<div class="pdc-bar">' +
        '<div class="pdc-tabs" role="tablist" aria-label="Filter cheques">' + tabHtml + '</div>' +
        '<div class="pdc-segs" role="group" aria-label="Cheque type">' + tys + '</div>' +
      '</div>' +
      '<div class="pdc-sum">' + chips +
        '<span class="pdc-spacer"></span>' +
        '<label class="pdc-remind">Remind <input type="number" min="0" max="365" value="' + remindDays(b) + '" aria-label="Reminder days before due" onchange="PDC.setRemindDays(this.value)"> days before due</label>' +
        (ro ? '' : '<button type="button" class="btn btn-xs" onclick="PDC.bulkStart()" title="Tick several cheques and clear them together">Clear in bulk</button>') +
      '</div>';
  }

  wrap('listHtml', function(orig, a){
    var h = String(orig.apply(this, a) || '');
    if(curKey() !== KEY) return h;
    var b = a[0] || cur(); var bar = toolbarHtml(b);
    var at = h.indexOf('<div id="regBody">');
    return at >= 0 ? h.slice(0, at) + bar + h.slice(at) : h;
  });
  wrap('tableHtml', function(orig, a){
    var h = String(orig.apply(this, a) || '');
    if(curKey() !== KEY || !this.batchMode || !this._pdcBulk) return h;
    var n = Object.keys(this.batchSel || {}).length;
    var bar = '<div class="batch-bar pdc-bulk-bar" role="region" aria-label="Bulk clear"><span><b id="batchCount">' + n + '</b> selected</span><span class="bb-sep">—</span>' +
      '<button class="btn btn-sm btn-primary" id="batchDelBtn" onclick="PDC.bulkClearOpen()"' + (n ? '' : ' disabled') + '>Clear cheques</button><span class="bb-sep">|</span>' +
      '<button class="btn btn-sm" onclick="App.batchCancel()">Cancel</button></div>';
    return h.replace(/^<div class="batch-bar"[\s\S]*?<\/div>/, function(){ return bar; });
  });
  wrap('batchCancel', function(orig, a){ this._pdcBulk = false; return orig.apply(this, a); });
  wrap('batchDelete', function(orig, a){ this._pdcBulk = false; return orig.apply(this, a); });
  wrap('selectSection', function(orig, a){ this._pdcBulk = false; return orig.apply(this, a); });

  wrap('_cellHtml', function(orig, a){
    var b = a[0], key = a[1], col = a[2], r = a[3];
    if(key !== KEY || !col) return orig.apply(this, a);
    if(col.key === '__pdcAct'){
      var st = statusOf(b, r), ro = (typeof A.isReadOnly === 'function') ? A.isReadOnly(b) : false;
      if(OPEN[st] && !ro) return '<td class="nw"><button class="btn btn-xs pdc-clear-btn" onclick="PDC.clearOpen(' + JSON.stringify(r.id) + ')">Clear</button></td>';
      if(st === 'Cleared' && r.clearedId != null) return '<td class="nw"><a class="led-link" onclick="PDC.openDoc(\'' + esc(r.clearedKey || docKeyFor(r)) + '\',' + JSON.stringify(r.clearedId) + ')">' + (isReceived(r) ? 'Receipt' : 'Payment') + ' ' + esc(r.clearedRef || '') + ' ↗</a></td>';
      return '<td></td>';
    }
    if(col.key === 'status'){ var s = statusOf(b, r); return '<td><span class="st-badge ' + ST_CLASS[s] + '">' + esc(s) + '</span></td>'; }
    if(col.key === 'dueIn'){
      if(!isOpen(b, r)) return '<td class="r"></td>';
      var d = dueIn(r); var cls = d == null ? '' : (d < 0 ? 'pdc-due-over' : (d <= remindDays(b) ? 'pdc-due-soon' : 'pdc-due-later'));
      return '<td class="r nw"><span class="pdc-due ' + cls + '">' + esc(dueText(d)) + '</span></td>';
    }
    if(col.key === 'type'){ var t = typeOf(r); return '<td class="nw"><span class="pdc-type pdc-type-' + t.toLowerCase() + '">' + (t === 'Received' ? '▼ ' : '▲ ') + t + '</span></td>'; }
    return orig.apply(this, a);
  });

  /* ------------------------------------------------------------------ form page */
  function opts(list, curV, placeholder){
    var seen = {}, h = placeholder != null ? '<option value="">' + esc(placeholder) + '</option>' : '';
    list.forEach(function(v){ if(seen[v]) return; seen[v] = 1; h += '<option value="' + esc(v) + '"' + (v === curV ? ' selected' : '') + '>' + esc(v) + '</option>'; });
    if(curV && !seen[curV]) h += '<option value="' + esc(curV) + '" selected>' + esc(curV) + '</option>';
    return h;
  }
  function formHtml(b){
    var editing = A.editingId != null, r = editing ? find(b, A.editingId) : null;
    if(editing && !r) return A.recCrumb(LABEL, 'Not found') + '<div class="card"><div class="reg-empty">This cheque no longer exists.</div><div class="form-actions pdc-actions"><button class="btn" onclick="App.backToList()">Back</button></div></div>';
    var pf = A._pdcPrefill || {}; A._pdcPrefill = null;
    var v = r ? clone(r) : { type:pf.type || (A._pdcType === 'Issued' ? 'Issued' : 'Received'), party:pf.party || '', chequeNo:'', drawerBank:'', chequeDate:'', amount:'',
      bankAccount:pf.bankAccount || (banks(b)[0] || ''), date:pf.date || today(), description:'', status:'Pending' };
    var type = typeOf(v), st = r ? statusOf(b, r) : 'Pending', locked = st === 'Cleared' || st === 'Bounced';
    var dis = locked ? ' disabled' : '';
    var title = r ? (chequeLabel(r) + ' — ' + (r.party || '')) : 'New PDC';
    var stSel = (st === 'Cleared' || st === 'Bounced') ? '<span class="st-badge ' + ST_CLASS[st] + '">' + st + '</span>' :
      '<select id="pdc_status">' + ['Pending', 'Deposited', 'Cancelled'].map(function(s){ return '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>';
    var field = function(lbl, ctl, cls){ return '<div class="pdc-f' + (cls ? ' ' + cls : '') + '"><label class="fld">' + lbl + '</label>' + ctl + '</div>'; };
    return A.recCrumb(LABEL, title) +
      '<div class="card pdc-form" data-enter-nav="on">' +
        '<div class="card-head"><h2 style="margin:0">' + esc(title) + '</h2></div>' +
        (locked ? '<div class="info-bar">This cheque is ' + st.toLowerCase() + '. Only the description can be changed' + (st === 'Cleared' ? ' — the ' + (isReceived(r) ? 'receipt' : 'payment') + ' it created carries the figures.' : '.') + '</div>' : '') +
        '<div class="pdc-typesw" role="radiogroup" aria-label="Cheque type">' +
          '<label class="pdc-tsw' + (type === 'Received' ? ' on' : '') + '"><input type="radio" name="pdc_type" value="Received"' + (type === 'Received' ? ' checked' : '') + dis + ' onchange="PDC.typeChange(this.value)"><b>Received</b><small>from a customer</small></label>' +
          '<label class="pdc-tsw' + (type === 'Issued' ? ' on' : '') + '"><input type="radio" name="pdc_type" value="Issued"' + (type === 'Issued' ? ' checked' : '') + dis + ' onchange="PDC.typeChange(this.value)"><b>Issued</b><small>to a supplier</small></label>' +
        '</div>' +
        '<div class="pdc-grid">' +
          field('<span id="pdc_partyLbl">' + (type === 'Issued' ? 'Supplier' : 'Customer') + '</span>', '<select id="pdc_party"' + dis + '>' + opts(parties(b, type), v.party, '— Select —') + '</select>', 'wide') +
          field('Cheque no.', '<input type="text" id="pdc_chequeNo" value="' + esc(v.chequeNo) + '"' + dis + ' autocomplete="off">') +
          field('Bank <small class="pdc-hint">(drawn on)</small>', '<input type="text" id="pdc_drawerBank" value="' + esc(v.drawerBank) + '"' + dis + ' placeholder="e.g. Emirates NBD">') +
          field('Cheque date <small class="pdc-hint">(due)</small>', '<input type="date" id="pdc_chequeDate" value="' + esc(iso(v.chequeDate)) + '"' + dis + '>') +
          field('Amount', '<input type="text" inputmode="decimal" class="r" id="pdc_amount" value="' + esc(v.amount === '' ? '' : r2(num(v.amount)).toFixed(2)) + '"' + dis + ' placeholder="0.00">') +
          field('<span id="pdc_bankLbl">' + (type === 'Issued' ? 'Issued from' : 'Deposit to') + '</span>', '<select id="pdc_bankAccount"' + dis + '>' + opts(banks(b), v.bankAccount, '— Select —') + '</select>') +
          field('<span id="pdc_dateLbl">' + (type === 'Issued' ? 'Issued date' : 'Received date') + '</span>', '<input type="date" id="pdc_date" value="' + esc(iso(v.date)) + '"' + dis + '>') +
          field('Description', '<input type="text" id="pdc_description" value="' + esc(v.description) + '">', 'wide') +
          field('Status', stSel) +
          (r && r.clearingDate && st === 'Cleared' ? field('Clearing date', '<input type="date" value="' + esc(r.clearingDate) + '" disabled>') : '') +
        '</div>' +
        '<div class="form-actions pdc-actions">' +
          '<button class="btn btn-primary" onclick="PDC.saveForm()">' + (editing ? 'Update' : 'Create') + '</button>' +
          (editing ? '' : '<button class="btn" onclick="PDC.saveForm(\'another\')">Create &amp; add another</button>') +
          '<button class="btn" onclick="App.backFromRecord()||App.backToList()">Cancel</button>' +
          (editing ? '<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="App.deleteRecord(' + JSON.stringify(A.editingId) + ')">Delete</button>' : '') +
        '</div>' +
      '</div>';
  }
  function readForm(){
    var g = function(id){ var el = byId(id); return el ? el.value : ''; };
    var t = 'Received'; try{ var c = document.querySelector('input[name="pdc_type"]:checked'); if(c) t = c.value; }catch(e){}
    return { type:t, party:g('pdc_party'), chequeNo:g('pdc_chequeNo'), drawerBank:g('pdc_drawerBank'), chequeDate:g('pdc_chequeDate'),
      amount:g('pdc_amount'), bankAccount:g('pdc_bankAccount'), date:g('pdc_date'), description:g('pdc_description'), status:g('pdc_status') };
  }

  wrap('formHtml', function(orig, a){ if(curKey() !== KEY) return orig.apply(this, a); return formHtml(a[0] || cur()); });
  /* the designed-form mount has nothing to do on this page */
  wrap('_mountDesignedForm', function(orig, a){ if(a[0] === KEY) return; return orig.apply(this, a); });

  /* ------------------------------------------------------------------ view page */
  function viewHtml(b){
    var r = find(b, A.editingId);
    if(!r) return A.recCrumb(LABEL, 'Not found') + '<div class="card"><div class="reg-empty">This cheque no longer exists.</div><div class="form-actions pdc-actions"><button class="btn" onclick="App.backFromRecord()||App.backToList()">Close</button></div></div>';
    var st = statusOf(b, r), rcv = isReceived(r), d = dueIn(r), id = JSON.stringify(r.id);
    var ro = (typeof A.isReadOnly === 'function') ? A.isReadOnly(b) : false;
    var btn = function(lbl, fn, cls){ return '<button class="btn btn-sm' + (cls ? ' ' + cls : '') + '" onclick="' + fn + '">' + lbl + '</button>'; };
    var acts = '';
    if(!ro){
      acts += btn('Edit', 'App.editRecord(' + id + ')');
      if(OPEN[st]) acts += btn('Clear…', 'PDC.clearOpen(' + id + ')', 'btn-primary');
      if(st === 'Pending') acts += btn('Mark deposited', 'PDC.deposit(' + id + ')');
      if(OPEN[st]) acts += btn('Bounce…', 'PDC.bounceOpen(' + id + ')');
      if(OPEN[st]) acts += btn('Cancel cheque', 'PDC.cancel(' + id + ')');
      if(st === 'Cleared') acts += btn('Undo clearing', 'PDC.unclearAsk(' + id + ')');
      if(st === 'Bounced' || st === 'Cancelled') acts += btn('Reopen', 'PDC.reopen(' + id + ')');
    }
    var row = function(k, v){ return v === '' || v == null ? '' : '<div class="pdc-kv"><span>' + k + '</span><b>' + v + '</b></div>'; };
    var link = '';
    if(st === 'Cleared' && r.clearedId != null) link = '<a class="led-link" onclick="PDC.openDoc(\'' + esc(r.clearedKey || docKeyFor(r)) + '\',' + JSON.stringify(r.clearedId) + ')">' + (rcv ? 'Receipt' : 'Payment') + ' ' + esc(r.clearedRef || '') + ' ↗</a>';
    var charge = (r.chargeId != null && docOf(b, r.chargeKey || 'payments', r.chargeId)) ? '<a class="led-link" onclick="PDC.openDoc(\'payments\',' + JSON.stringify(r.chargeId) + ')">' + money(r.bounceCharge) + ' (payment ' + esc(docOf(b, 'payments', r.chargeId).reference || '') + ') ↗</a>' : '';
    return A.recCrumb(LABEL, chequeLabel(r)) +
      '<div class="card pdc-view" style="max-width:920px">' +
        '<div class="view-bar"><span class="view-doc">Post-dated cheque</span>' + acts + '</div>' +
        '<div class="pdc-hero">' +
          '<div><div class="pdc-hero-t">' + (rcv ? 'Cheque received from' : 'Cheque issued to') + '</div><div class="pdc-hero-p">' + esc(r.party || '—') + '</div>' +
            '<div class="pdc-hero-s"><span class="st-badge ' + ST_CLASS[st] + '">' + st + '</span>' + (OPEN[st] && d != null ? '<span class="pdc-due ' + (d < 0 ? 'pdc-due-over' : d <= remindDays(b) ? 'pdc-due-soon' : 'pdc-due-later') + '">' + esc(dueText(d)) + '</span>' : '') + '</div></div>' +
          '<div class="pdc-hero-a"><small>Amount</small><b>' + money(num(r.amount)) + '</b></div>' +
        '</div>' +
        '<div class="pdc-kvs">' +
          row('Type', rcv ? 'Received' : 'Issued') + row('Cheque no.', esc(r.chequeNo || '')) + row('Bank (drawn on)', esc(r.drawerBank || '')) +
          row('Cheque date', esc(fmtD(r.chequeDate))) + row(rcv ? 'Deposit to' : 'Issued from', esc(A.dispAcct ? A.dispAcct(r.bankAccount || '') : (r.bankAccount || ''))) +
          row(rcv ? 'Received date' : 'Issued date', esc(fmtD(r.date))) + row('Deposited on', r.depositDate && st !== 'Pending' ? esc(fmtD(r.depositDate)) : '') +
          row('Clearing date', st === 'Cleared' ? esc(fmtD(r.clearingDate)) : '') + row(rcv ? 'Receipt' : 'Payment', link) +
          row('Bounced on', st === 'Bounced' ? esc(fmtD(r.bounceDate)) : '') + row('Bank charge', st === 'Bounced' ? charge : '') + row('Bounce note', st === 'Bounced' ? esc(r.bounceNote || '') : '') +
          row('Description', esc(r.description || '')) +
        '</div>' +
        (OPEN[st] ? '<div class="pdc-note">Information only: this cheque appears in ' + esc(r.party || 'the party') + '’s ledger and statement without changing the balance. Clearing it creates the ' + (rcv ? 'receipt' : 'payment') + ' that posts.</div>' : '') +
        '<div class="form-actions pdc-actions">' +
          (ro ? '' : '<button class="btn btn-primary" onclick="App.editRecord(' + id + ')">Edit</button>') +
          '<button class="btn" onclick="App.backFromRecord()||App.backToList()">Close</button>' +
          (ro ? '' : '<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="App.deleteRecord(' + id + ')">Delete</button>') +
        '</div>' +
      '</div>';
  }
  wrap('viewHtml', function(orig, a){ if(curKey() !== KEY) return orig.apply(this, a); return viewHtml(a[0] || cur()); });

  /* ------------------------------------------------------------------ dialogs */
  function overlay(html){ A._openOverlay(html); setTimeout(function(){ var el = byId('pdcDlgFirst'); if(el && el.focus) try{ el.focus(); }catch(e){} }, 30); }
  function dlgErr(msg){ var el = byId('pdcDlgErr'); if(el){ el.textContent = msg; el.hidden = !msg; } else say(msg); }
  function rerender(){ try{ A.renderWorkspace(); }catch(e){} }

  var PDC = {
    KEY:KEY, LABEL:LABEL, STATUSES:STATUSES,
    statusOf:statusOf, typeOf:typeOf, dueIn:dueIn, remindDays:remindDays, infoText:infoText, totals:totals, filterRows:filterRows,
    upsert:upsert, clear:clear, unclear:unclear, bounce:bounce, setStatus:setStatus, reminders:reminders, registerReminders:registerReminders,
    today:today,

    filter: function(f){ A._pdcFilter = f; A.pageNum = 1; rerender(); },
    typeFilter: function(t){ A._pdcType = t; A.pageNum = 1; rerender(); },
    setRemindDays: function(v){ var b = cur(); if(!b) return; var n = parseInt(v, 10); if(isNaN(n) || n < 0) n = 3; b.pdcSettings = Object.assign({}, b.pdcSettings || {}, { remindDays:Math.min(n, 365) });
      A.saveBiz(b); refreshReminders(); rerender(); },
    typeChange: function(t){
      var b = cur(); var sel = byId('pdc_party'); var curV = sel ? sel.value : '';
      if(sel) sel.innerHTML = opts(parties(b, t), parties(b, t).indexOf(curV) >= 0 ? curV : '', '— Select —');
      var set = function(id, txt){ var el = byId(id); if(el) el.textContent = txt; };
      set('pdc_partyLbl', t === 'Issued' ? 'Supplier' : 'Customer'); set('pdc_bankLbl', t === 'Issued' ? 'Issued from' : 'Deposit to'); set('pdc_dateLbl', t === 'Issued' ? 'Issued date' : 'Received date');
      try{ document.querySelectorAll('.pdc-tsw').forEach(function(l){ var i = l.querySelector('input'); l.classList.toggle('on', !!(i && i.checked)); }); }catch(e){}
    },
    saveForm: function(mode){
      if(typeof A.guardWrite === 'function' && !A.guardWrite()) return;
      var b = cur(); if(!b) return; var v = readForm();
      var res = upsert(b, v, A.editingId);
      if(!res.ok){ say(res.error); return; }
      A.saveBiz(b); refreshReminders();
      toast(A.editingId != null ? 'Updated' : 'Created');
      if(mode === 'another'){ A.editingId = null; A._pdcPrefill = { type:typeOf(res.record), bankAccount:res.record.bankAccount, date:res.record.date }; A.wsMode = 'form'; A.renderMain(cur()); return; }
      A.editingId = null; if(!(A.backFromRecord && A.backFromRecord())) A.backToList();
    },
    openDoc: function(key, id){
      var label = (typeof KEY2LABEL !== 'undefined' && KEY2LABEL[key]) || null; if(!label) return;
      try{ A.recReturn = A._snapNav(); }catch(e){ A.recReturn = null; }
      A.wsSection = label; A.editingId = id; A.wsMode = 'view'; A.listQuery = ''; A.renderWorkspace();
    },
    deposit: function(id){ var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var r = setStatus(b, id, 'Deposited'); if(!r.ok) return say(r.error); refreshReminders(); toast('Marked deposited'); rerender(); },
    reopen: function(id){ var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var r = setStatus(b, id, 'Pending'); if(!r.ok) return say(r.error); refreshReminders(); toast('Reopened'); rerender(); },
    cancel: function(id){ var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var x = find(b, id); if(!x) return;
      return ask('Cancel ' + chequeLabel(x) + ' (' + money(num(x.amount)) + ', ' + (x.party || '') + ')? It stays in the list as Cancelled.', { title:'Cancel cheque', okText:'Cancel cheque', cancelText:'Keep', danger:true }).then(function(ok){
        if(!ok) return; var r = setStatus(cur(), id, 'Cancelled'); if(!r.ok) return say(r.error); refreshReminders(); toast('Cheque cancelled'); rerender(); }); },
    unclearAsk: function(id){ var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var x = find(b, id); if(!x) return;
      var noun = isReceived(x) ? 'receipt' : 'payment';
      return ask('Undo clearing ' + chequeLabel(x) + '? The ' + noun + ' ' + (x.clearedRef || '') + ' it created is deleted and the cheque goes back to ' + (x.depositDate ? 'Deposited' : 'Pending') + '.', { title:'Undo clearing', okText:'Undo clearing', danger:true }).then(function(ok){
        if(!ok) return; var r = unclear(cur(), id); if(!r.ok) return say(r.error); refreshReminders(); toast('Clearing undone'); rerender(); }); },

    /* ---- Clear (one cheque) ---- */
    clearOpen: function(id){
      var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var r = find(b, id); if(!r) return;
      if(!isOpen(b, r)) return say(chequeLabel(r) + ' is ' + statusOf(b, r).toLowerCase() + '.');
      var rcv = isReceived(r), side = rcv ? 'cust' : 'sup', inv = [];
      try{ var oi = G('openInvoicesFor'); inv = oi ? oi(b, side, r.party) : []; }catch(e){ inv = []; }
      var uidOf = function(x){ try{ return G('invUid')(x); }catch(e){ return x.uuid || ('id:' + x.id); } };
      var rows = inv.map(function(x, i){ var i0 = x.invoice || {};
        return '<tr><td class="nw">' + esc(fmtD(i0.issueDate || i0.date)) + '</td><td class="nw">' + esc(i0.reference || '') + '</td><td class="r m">' + money(x.outstanding) + '</td>' +
          '<td class="r"><input type="text" inputmode="decimal" class="r pdc-alloc" data-uid="' + esc(uidOf(i0)) + '" data-max="' + r2(x.outstanding) + '" placeholder="0.00" aria-label="Allocate to ' + esc(i0.reference || 'invoice') + '" oninput="PDC._allocSum()"></td></tr>'; }).join('');
      var allocHtml = inv.length ? ('<div class="pdc-dlg-sub"><span>Allocate to ' + (rcv ? 'invoices' : 'bills') + ' <small>(optional)</small></span><button type="button" class="btn btn-xs" onclick="PDC._allocAuto(' + r2(num(r.amount)) + ')">Auto-allocate oldest first</button></div>' +
        '<div class="tbl-scroll"><table class="reg-tbl pdc-alloc-tbl"><thead><tr><th>Date</th><th>Reference</th><th class="r">Outstanding</th><th class="r">Allocate</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="pdc-alloc-sum" id="pdcAllocSum"></div>') : '<div class="pdc-dlg-muted">No open ' + (rcv ? 'invoices' : 'bills') + ' for ' + esc(r.party) + ' — the ' + (rcv ? 'receipt' : 'payment') + ' is left unallocated.</div>';
      overlay('<div class="app-modal-h">Clear ' + esc(chequeLabel(r)) + '</div>' +
        '<div class="app-modal-b pdc-dlg">' +
          '<div class="pdc-dlg-head"><span>' + (rcv ? 'From ' : 'To ') + '<b>' + esc(r.party) + '</b> · due ' + esc(fmtD(r.chequeDate)) + '</span><b class="pdc-dlg-amt">' + money(num(r.amount)) + '</b></div>' +
          '<div class="pdc-dlg-grid">' +
            '<div><label class="fld">Clearing date</label><input type="date" id="pdcDlgFirst" value="' + today() + '"></div>' +
            '<div><label class="fld">' + (rcv ? 'Received in' : 'Paid from') + '</label><select id="pdcDlgBank">' + opts(banks(b), r.bankAccount, '— Select —') + '</select></div>' +
          '</div>' +
          '<p class="pdc-dlg-muted">Creates a ' + (rcv ? 'receipt' : 'payment') + ' on this date in the chosen account, linked to the cheque.</p>' +
          allocHtml +
          '<div class="pdc-dlg-err" id="pdcDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="PDC._clearRun(' + JSON.stringify(r.id) + ')">Clear cheque</button></div>');
      PDC._allocAmt = r2(num(r.amount));
      PDC._allocSum();
    },
    _allocAuto: function(total){
      var left = r2(total);
      try{ document.querySelectorAll('.pdc-alloc').forEach(function(el){ var mx = num(el.getAttribute('data-max')); var v = Math.min(mx, left); left = r2(left - v); el.value = v > 0 ? r2(v).toFixed(2) : ''; }); }catch(e){}
      PDC._allocSum();
    },
    _allocSum: function(){
      var el = byId('pdcAllocSum'); if(!el) return; var s = 0;
      try{ document.querySelectorAll('.pdc-alloc').forEach(function(i){ s += num(i.value); }); }catch(e){}
      /* the same split the receipt / payment form shows: applied to invoices, the rest on account */
      var amt = PDC._allocAmt, left = amt != null ? r2(amt - s) : null;
      el.textContent = s ? 'Applied ' + money(r2(s)) + (left != null ? ' · On account / Advance ' + money(left) : '') : (amt != null ? 'On account / Advance ' + money(amt) : '');
      if(el.classList) el.classList.toggle('neg', left != null && left < -0.004);
    },
    _clearRun: function(id){
      var b = cur(); var allocs = [];
      try{ document.querySelectorAll('.pdc-alloc').forEach(function(i){ var v = num(i.value); if(v > 0) allocs.push({ uid:i.getAttribute('data-uid'), amount:v }); }); }catch(e){}
      var over = false; try{ document.querySelectorAll('.pdc-alloc').forEach(function(i){ if(num(i.value) > num(i.getAttribute('data-max')) + 0.004) over = true; }); }catch(e){}
      if(over) return dlgErr('An allocation is more than the invoice’s outstanding balance.');
      var res = clear(b, id, { date:(byId('pdcDlgFirst') || {}).value, bankAccount:(byId('pdcDlgBank') || {}).value, allocations:allocs });
      if(!res.ok) return dlgErr(res.error);
      A._closeOverlay(); refreshReminders();
      toast('Cleared — ' + (res.doc.receivedIn != null ? 'Receipt ' : 'Payment ') + res.doc.reference + ' created');
      rerender();
    },

    /* ---- Bounce ---- */
    bounceOpen: function(id){
      var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return; var r = find(b, id); if(!r) return;
      if(!isOpen(b, r)) return say(chequeLabel(r) + ' is ' + statusOf(b, r).toLowerCase() + '.' + (statusOf(b, r) === 'Cleared' ? ' Undo the clearing first.' : ''));
      var accts = []; try{ accts = A.accountOptions(b); }catch(e){}
      var def = (b.coa || []).find(function(n){ return n && n.type === 'account' && /bank\s*charge|bank\s*fee/i.test(n.name || ''); });
      var aOpts = '<option value="">— Select —</option>' + accts.map(function(o){ return '<option value="' + esc(o.id) + '"' + (def && def.id === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
      overlay('<div class="app-modal-h">Bounce ' + esc(chequeLabel(r)) + '</div>' +
        '<div class="app-modal-b pdc-dlg">' +
          '<div class="pdc-dlg-head"><span>' + (isReceived(r) ? 'From ' : 'To ') + '<b>' + esc(r.party) + '</b> · due ' + esc(fmtD(r.chequeDate)) + '</span><b class="pdc-dlg-amt">' + money(num(r.amount)) + '</b></div>' +
          '<div class="pdc-dlg-grid">' +
            '<div><label class="fld">Bounce date</label><input type="date" id="pdcDlgFirst" value="' + today() + '"></div>' +
            '<div><label class="fld">Bank charge <small class="pdc-hint">(optional)</small></label><input type="text" inputmode="decimal" class="r" id="pdcDlgCharge" placeholder="0.00"></div>' +
            '<div><label class="fld">Charged by</label><select id="pdcDlgBank">' + opts(banks(b), r.bankAccount, '— Select —') + '</select></div>' +
            '<div><label class="fld">Charge account</label><select id="pdcDlgAcct">' + aOpts + '</select></div>' +
          '</div>' +
          '<label class="fld">Note</label><input type="text" id="pdcDlgNote" placeholder="e.g. insufficient funds" style="max-width:none;width:100%">' +
          '<p class="pdc-dlg-muted">Nothing posts for the cheque itself. A bank charge, if entered, is recorded as a payment from the bank account.</p>' +
          '<div class="pdc-dlg-err" id="pdcDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button>' +
          '<button class="btn btn-danger" onclick="PDC._bounceRun(' + JSON.stringify(r.id) + ')">Mark bounced</button></div>');
    },
    _bounceRun: function(id){
      var g = function(i){ return (byId(i) || {}).value; };
      var res = bounce(cur(), id, { date:g('pdcDlgFirst'), charge:g('pdcDlgCharge'), bankAccount:g('pdcDlgBank'), chargeAccount:g('pdcDlgAcct'), note:g('pdcDlgNote') });
      if(!res.ok) return dlgErr(res.error);
      A._closeOverlay(); refreshReminders(); toast('Marked bounced' + (res.doc ? ' — bank charge payment ' + res.doc.reference : '')); rerender();
    },

    /* ---- Bulk clear ---- */
    bulkStart: function(){ var b = cur(); if(typeof A.guardWrite === 'function' && !A.guardWrite(b, 3)) return;
      A.batchMode = true; A.batchSel = {}; A._pdcBulk = true; if(!A._pdcFilter || A._pdcFilter === 'all' || A._pdcFilter === 'cleared' || A._pdcFilter === 'bounced') A._pdcFilter = 'pending'; rerender(); },
    bulkIds: function(){ return Object.keys(A.batchSel || {}).map(function(x){ return isNaN(Number(x)) ? x : Number(x); }); },
    bulkClearOpen: function(){
      var b = cur(), ids = PDC.bulkIds(); if(!ids.length) return say('Tick the cheques to clear first.');
      var list = ids.map(function(i){ return find(b, i); }).filter(Boolean), open = list.filter(function(r){ return isOpen(b, r); });
      if(!open.length) return say('None of the selected cheques is pending or deposited.');
      var rcv = r2(open.filter(isReceived).reduce(function(s, r){ return s + num(r.amount); }, 0)), iss = r2(open.filter(function(r){ return !isReceived(r); }).reduce(function(s, r){ return s + num(r.amount); }, 0));
      overlay('<div class="app-modal-h">Clear ' + open.length + ' cheque' + (open.length === 1 ? '' : 's') + '</div>' +
        '<div class="app-modal-b pdc-dlg">' +
          '<div class="pdc-dlg-head"><span>' + (rcv ? 'Received <b>' + money(rcv) + '</b>' : '') + (rcv && iss ? ' · ' : '') + (iss ? 'Issued <b>' + money(iss) + '</b>' : '') + '</span></div>' +
          (list.length > open.length ? '<p class="pdc-dlg-muted">' + (list.length - open.length) + ' selected cheque(s) are not pending or deposited and will be skipped.</p>' : '') +
          '<div class="pdc-dlg-grid">' +
            '<div><label class="fld">Clearing date</label><input type="date" id="pdcDlgFirst" value="' + today() + '"></div>' +
            '<div><label class="fld">Bank account</label><select id="pdcDlgBank">' + opts(banks(b), '', 'Each cheque’s own account') + '</select></div>' +
          '</div>' +
          '<p class="pdc-dlg-muted">One receipt (received cheques) or payment (issued cheques) is created per cheque, unallocated — open it afterwards to allocate it to invoices.</p>' +
          '<div class="pdc-dlg-err" id="pdcDlgErr" role="alert" hidden></div>' +
        '</div>' +
        '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="PDC._bulkRun()">Clear ' + open.length + '</button></div>');
    },
    /** Clear several cheques at once; one save. Returns {done:[doc], failed:[{id, error}]} */
    bulkClear: function(b, ids, o){
      o = o || {}; var done = [], failed = [];
      ids.forEach(function(id){ var r = find(b, id); if(!r || !isOpen(b, r)) return;
        var res = clear(b, id, { date:o.date, bankAccount:o.bankAccount || r.bankAccount, noSave:true });
        if(res.ok) done.push(res.doc); else failed.push({ id:id, error:res.error }); });
      if(done.length) A.saveBiz(b);
      return { done:done, failed:failed };
    },
    _bulkRun: function(){
      var b = cur(); var res = PDC.bulkClear(b, PDC.bulkIds(), { date:(byId('pdcDlgFirst') || {}).value, bankAccount:(byId('pdcDlgBank') || {}).value });
      if(!res.done.length && res.failed.length) return dlgErr(res.failed[0].error);
      A._closeOverlay(); A.batchMode = false; A.batchSel = {}; A._pdcBulk = false; refreshReminders();
      toast('Cleared ' + res.done.length + ' cheque' + (res.done.length === 1 ? '' : 's') + (res.failed.length ? ' — ' + res.failed.length + ' skipped' : ''));
      if(res.failed.length) say(res.failed.map(function(f){ return f.error; }).join('\n'));
      rerender();
    }
  };

  global.PDC = PDC;
  registerReminders();
  if(hasDoc && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', registerReminders);
  try{ setTimeout(registerReminders, 0); }catch(e){}
})(typeof window !== 'undefined' ? window : this);
