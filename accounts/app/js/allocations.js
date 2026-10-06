/* ===================== Payment / invoice allocation panel (additive) =========
   On a Receipt or Payment, once a line posts to Accounts receivable / Accounts
   payable with a party chosen, this panel appears under the line items and lets
   the user link the money to several of that party's invoices, one line each:

     Invoice (selector) | Date | Invoice total | Balance due | Amount applied | x

   - Receipts list the customer's Sales Invoices, payments the supplier's
     Purchase Invoices (settlementIndex in accounting.js is the one source).
   - Fully settled invoices are hidden; partly paid ones show what is left.
   - An invoice chosen on one line is not offered on another line.
   - Editing: this document's own allocations count as available again
     (settlementIndex skipDoc), so its invoices show their balance before it.
   - Amount applied <= the invoice's balance due; total applied <= the money on
     the AR/AP line; what is left is shown as "On account / Advance".
   - Changing the party (or removing its line) clears that party's invoice lines
     after a UIModal confirm; Cancel puts the form back.

   What it produces is `rec.allocations` - the payment_allocations join rows
   [{key, uid, party, amount}] - which settlementIndex() turns into invoice
   balances. It adds no posting of its own: the double entry is still the AR/AP
   line. Works in the native TxnForms receipt / payment and the Form Designer
   path (both call mount()).

   The invoice View also gets its payment status (Paid / Partly paid / Unpaid)
   and the list of linked receipts / payments (invoicePaymentsHtml).
   ============================================================================ */
(function(global){
  'use strict';

  var AR = /^accounts receivable$/i, AP = /^accounts payable$/i;
  var SIDE_LABEL = { cust:{ party:'customer', doc:'invoice', Doc:'Invoice', head:'Invoices paid', invKey:'salesInv' },
                     sup: { party:'supplier', doc:'bill',    Doc:'Bill',    head:'Bills paid',    invKey:'purchInv' } };

  function app(){ try{ return App; }catch(e){ return global.App || null; } }
  function esc(s){ var A=app(); return A ? A.esc(s==null?'':s) : String(s==null?'':s); }
  function num(v){ var n=parseFloat(String(v==null?'':v).replace(/,/g,'')); return isNaN(n)?0:n; }
  function r2(n){ return Math.round(((Number(n)||0)+Number.EPSILON)*100)/100; }
  function money(n){ var A=app(); try{ return A.money(n); }catch(e){ return r2(n).toFixed(2); } }
  function fmtD(s){ var A=app(); s=String(s||'').slice(0,10); if(!s) return ''; try{ return A.fmtDate ? A.fmtDate(s) : s; }catch(e){ return s; } }
  function uidOf(rec){ try{ return invUid(rec); }catch(e){ return (rec && (rec.uuid || 'id:'+rec.id)) || ''; } }
  function aliases(rec){ var o=[]; if(rec){ if(rec.uuid) o.push(rec.uuid); if(rec.id!=null) o.push('id:'+rec.id); } return o; }
  function modal(){ try{ return UIModal; }catch(e){ return global.UIModal || null; } }
  function cssEsc(v){ return String(v==null?'':v).replace(/["\\]/g,'\\$&'); }

  /* state.lines[gk] = [{uid, amt, orig}]  (gk = side + ' ' + party; orig = the stored amount when editing)
     state.pend      = {uid: amount} seeds waiting for their party's section (prefill / Receive payment)
     state.prev      = {gk: true} the sections drawn last time (to notice a party change)  */
  var state = fresh(null, null);
  function fresh(host, key){ return { host:host, key:key, lines:{}, pend:{}, prev:{}, asking:false, revert:null, snap:null, entered:{} }; }

  /* ------------------------------------------------------------ form reading */

  function rowAmount(row){
    var el = row.querySelector('[data-var="totalWithTax"]');
    if(el && String(el.value||'').trim() !== '') return el.value;
    el = row.querySelector('[data-var="amountNoTax"]');
    if(el && String(el.value||'').trim() !== '') return el.value;
    el = row.querySelector('[data-var="amount"]');
    return el ? el.value : 0;
  }

  /** The AR / AP money on the form right now, grouped by party. */
  function scanParties(host, key){
    var tbl = host && host.querySelector('[data-line-items]');
    if(!tbl || !tbl.tBodies[0]) return [];
    var byParty = {}, order = [];
    var rows = tbl.tBodies[0].rows;
    for(var i=0;i<rows.length;i++){
      var row = rows[i];
      var accEl = row.querySelector('[data-account-col]') || row.querySelector('select[data-qc-source="account"]');
      var subEl = row.querySelector('[data-subaccount-col]');
      if(!accEl || !subEl) continue;
      var acct = String(accEl.value||'').trim();
      var isAR = AR.test(acct), isAP = AP.test(acct);
      if(!isAR && !isAP) continue;
      var party = String(subEl.value||'').trim();
      if(!party) continue;
      /* A receipt against Accounts receivable, or a payment against Accounts
         payable, settles what the party owes. The other way round is a refund,
         which re-opens a balance rather than closing an invoice. */
      var side = isAR ? 'cust' : 'sup';
      var settles = (key === 'receipts' && isAR) || (key === 'payments' && isAP);
      var k = side + ' ' + party;
      if(!byParty[k]){ byParty[k] = { side:side, party:party, settles:settles, amount:0, gk:k }; order.push(k); }
      byParty[k].amount += num(rowAmount(row));
    }
    return order.map(function(k){ var g=byParty[k]; g.amount=r2(g.amount); return g; });
  }

  /** The document being edited, so its own allocations count as available. */
  function currentDoc(){
    var A = app(); if(!A || A.editingId == null) return null;
    try{ return (A.records(A.curBiz())||[]).filter(function(r){ return r.id === A.editingId; })[0] || null; }
    catch(e){ return null; }
  }

  /** {open:[row], all:[row], byUid:{uid:row}} for one party, as it stands without this document. */
  function invoicesFor(side, party){
    var A = app(), b = A && A.curBiz(), none = { open:[], all:[], byUid:{} };
    if(!b) return none;
    var doc = currentDoc(), ix;
    try{ ix = settlementIndex(b, side, doc ? { skipDoc: uidOf(doc) } : {}); }
    catch(e){ return none; }
    var row = ix.byParty[party];
    if(!row) return none;
    var by = {}; row.invoices.forEach(function(r){ aliases(r.invoice).forEach(function(u){ by[u] = r; }); by[r.uid] = r; });
    return { open: row.invoices.filter(function(r){ return r.outstanding > 0.005; }), all: row.invoices, byUid: by };
  }

  /* ------------------------------------------------------------ line state */

  /** First sight of a section: its lines come from the stored document, then from pending seeds. */
  function seed(g, inv){
    var L = [], doc = currentDoc(), invKey = SIDE_LABEL[g.side].invKey;
    if(doc) ((doc.allocations)||[]).forEach(function(a){
      if(!a || a.key !== invKey || (a.party||'') !== g.party || !(num(a.amount) > 0)) return;
      var row = inv.byUid[a.uid]; var uid = row ? row.uid : a.uid;
      if(L.some(function(x){ return x.uid === uid; })) return;
      L.push({ uid:uid, amt:String(r2(num(a.amount))), orig:r2(num(a.amount)) });
    });
    takePending(L, inv);
    if(!L.length && inv.open.length) L.push({ uid:'', amt:'', orig:null });
    return L;
  }
  /** Seeds (prefill allocations, the legacy `entered` map) whose invoice belongs to this section. */
  function takePending(L, inv){
    Object.keys(state.entered||{}).forEach(function(u){ state.pend[u] = state.entered[u]; delete state.entered[u]; });
    Object.keys(state.pend).forEach(function(u){
      var row = inv.byUid[u]; if(!row) return;
      var v = state.pend[u]; delete state.pend[u];
      var hit = L.filter(function(x){ return x.uid === row.uid; })[0];
      if(hit){ hit.amt = String(v); return; }
      var ln = { uid:row.uid, amt:String(v), orig:null };
      var blankAt = -1; L.forEach(function(x, j){ if(blankAt < 0 && !x.uid && !String(x.amt).trim()) blankAt = j; });
      if(blankAt >= 0) L.splice(blankAt, 1, ln); else L.push(ln);
    });
  }

  function linesOf(gk){ return state.lines[gk] || (state.lines[gk] = []); }
  function picked(L){ return (L||[]).filter(function(x){ return x.uid; }); }

  /* --------------------------------------------------------------- rendering */

  function optLabel(r){
    var inv = r.invoice || {};
    return (inv.reference || '(no reference)') + ' \u00b7 ' + fmtD(inv.issueDate || inv.date) +
      ' \u00b7 due ' + money(r.outstanding) + (r.paid > 0.005 ? ' of ' + money(r.total) : '');
  }

  function lineRow(g, inv, L, i){
    var ln = L[i], L0 = SIDE_LABEL[g.side];
    var taken = {}; L.forEach(function(x, j){ if(j !== i && x.uid) taken[x.uid] = 1; });
    var row = ln.uid ? inv.byUid[ln.uid] : null;
    var opts = inv.open.filter(function(r){ return !taken[r.uid]; });
    if(row && opts.indexOf(row) < 0) opts.unshift(row);          // its own invoice, even if nothing is left on it
    var sel = '<select class="alloc-inv" data-li="' + i + '" aria-label="' + esc(L0.Doc) + ' for line ' + (i+1) + '">' +
      '<option value="">\u2014 Select ' + esc(L0.doc) + ' \u2014</option>' +
      opts.map(function(r){ return '<option value="' + esc(r.uid) + '"' + (r.uid === ln.uid ? ' selected' : '') + '>' + esc(optLabel(r)) + '</option>'; }).join('') +
      (ln.uid && !row ? '<option value="' + esc(ln.uid) + '" selected>(' + esc(L0.doc) + ' no longer exists)</option>' : '') +
      '</select>';
    var max = row ? row.outstanding : 0;
    if(row && ln.orig != null && ln.orig > max) max = ln.orig;      // an unchanged stored line is never blocked
    var inv0 = row ? row.invoice : null;
    return '<tr data-li="' + i + '">' +
      '<td class="alloc-c-inv" data-l="' + esc(L0.Doc) + '">' + sel + '</td>' +
      '<td class="alloc-c-date" data-l="Date">' + esc(inv0 ? fmtD(inv0.issueDate || inv0.date) : '') + '</td>' +
      '<td class="r m" data-l="' + esc(L0.Doc) + ' total">' + (row ? money(row.total) : '') + '</td>' +
      '<td class="r m" data-l="Balance due">' + (row ? money(row.outstanding) : '') + '</td>' +
      '<td class="r alloc-c-amt" data-l="Amount applied"><input class="alloc-in" type="text" inputmode="decimal" data-li="' + i + '"' +
        ' aria-label="Amount applied to ' + esc(inv0 ? (inv0.reference || L0.doc) : 'line ' + (i+1)) + '"' +
        ' data-alloc-uid="' + esc(ln.uid) + '" data-alloc-max="' + (row ? r2(max) : '') + '"' +
        ' data-alloc-ref="' + esc(inv0 ? (inv0.reference || '') : '') + '" value="' + esc(ln.amt) + '"></td>' +
      '<td class="alloc-c-rm"><button type="button" class="alloc-rm" data-li="' + i + '" title="Remove line" aria-label="Remove line ' + (i+1) + '">\u00d7</button></td>' +
    '</tr>';
  }

  function sectionHtml(g){
    var L0 = SIDE_LABEL[g.side];
    var inv = invoicesFor(g.side, g.party);
    var head = '<div class="alloc-h"><span>' + esc(L0.head) + ' \u2014 ' + esc(g.party) + '</span>' +
               '<span class="alloc-amt">' + (state.key === 'payments' ? 'Payment' : 'Receipt') + ' amount <b>' + money(g.amount) + '</b></span></div>';

    if(!g.settles){
      var owed = inv.open.reduce(function(a, r){ return a + r.outstanding; }, 0);
      return '<div class="alloc-sec" data-alloc-side="' + esc(g.side) + '" data-alloc-party="' + esc(g.party) + '" data-alloc-info>' +
        head + '<div class="alloc-note">This line refunds ' + esc(g.party) + ', so it re-opens a balance rather than settling ' +
        (g.side === 'cust' ? 'an invoice' : 'a bill') + '. ' +
        (owed > 0.005
          ? esc(g.party) + ' currently owes ' + money(owed) + ' across ' + inv.open.length + ' open ' + L0.doc + (inv.open.length === 1 ? '' : 's') + '.'
          : 'Nothing is outstanding for ' + esc(g.party) + '.') +
        '</div></div>';
    }

    if(!state.lines[g.gk]) state.lines[g.gk] = seed(g, inv); else takePending(state.lines[g.gk], inv);
    var L = linesOf(g.gk);
    var attrs = ' data-alloc-side="' + esc(g.side) + '" data-alloc-party="' + esc(g.party) + '" data-alloc-amount="' + g.amount + '" data-gk="' + esc(g.gk) + '"';

    if(!L.length && !inv.open.length){
      return '<div class="alloc-sec"' + attrs + '>' + head +
        '<div class="alloc-note">No outstanding ' + esc(L0.doc) + 's for this ' + esc(L0.party) + '. ' +
        'The whole amount stays <b>On account / Advance</b> and can be applied later.</div>' +
        '<div class="alloc-foot"><span class="alloc-sp"></span><span>Total applied <b data-alloc-total>0.00</b></span>' +
        '<span>On account / Advance <b data-alloc-left>' + money(g.amount) + '</b></span></div>' +
        '<div class="alloc-err hide" data-alloc-err></div></div>';
    }

    var free = inv.open.filter(function(r){ return !L.some(function(x){ return x.uid === r.uid; }); }).length;
    var hasBlank = L.some(function(x){ return !x.uid; });
    var canAdd = free > 0 && !hasBlank;
    var body = L.map(function(_, i){ return lineRow(g, inv, L, i); }).join('');
    return '<div class="alloc-sec"' + attrs + '>' + head +
      '<div class="alloc-scroll"><table class="alloc-tbl"><thead><tr>' +
        '<th>' + esc(L0.Doc) + '</th><th>Date</th><th class="r">' + esc(L0.Doc) + ' total</th><th class="r">Balance due</th>' +
        '<th class="r">Amount applied</th><th class="alloc-c-rm"><span class="sr-only">Remove</span></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="alloc-foot">' +
        '<button type="button" class="btn btn-sm alloc-add"' + (canAdd ? '' : ' disabled title="' + (free ? 'Choose the ' + esc(L0.doc) + ' on the empty line first' : 'Every open ' + esc(L0.doc) + ' is already on a line') + '"') + '>+ Add ' + esc(L0.doc) + '</button>' +
        '<button type="button" class="btn btn-sm alloc-auto"' + (inv.open.length ? '' : ' disabled') + '>Apply oldest first</button>' +
        '<button type="button" class="btn btn-sm alloc-clear">Clear</button>' +
        '<span class="alloc-sp"></span>' +
        '<span>Total applied <b data-alloc-total>0.00</b></span>' +
        '<span>On account / Advance <b data-alloc-left>0.00</b></span>' +
      '</div>' +
      '<div class="alloc-err hide" data-alloc-err></div></div>';
  }

  /** Rebuild the whole panel from the current state of the form. */
  function refresh(){
    var host = state.host; if(!host || state.asking) return;
    var panel = host.querySelector('#allocPanel'); if(!panel) return;
    var groups = scanParties(host, state.key);
    var now = {}; groups.forEach(function(g){ if(g.settles) now[g.gk] = true; });
    /* a section that had invoice lines is gone: the party changed (or its line went) */
    var lost = Object.keys(state.prev).filter(function(gk){ return !now[gk] && picked(state.lines[gk]).length; });
    if(lost.length){ askPartyChange(lost); return; }
    /* sections that went without lines are dropped; parked ones (a cancelled change the form
       could not undo) stay and come back with their party */
    Object.keys(state.lines).forEach(function(gk){ if(!now[gk] && !picked(state.lines[gk]).length) delete state.lines[gk]; });
    draw(panel, groups);
    state.prev = now;
    snapshot();
  }
  function draw(panel, groups){
    groups = groups || scanParties(state.host, state.key);
    panel.innerHTML = groups.length ? groups.map(sectionHtml).join('') : '';
    if(panel.classList) panel.classList.toggle('hide', !groups.length);
    recompute();
  }
  function redrawPanel(focusSel){
    var host = state.host; if(!host) return; var panel = host.querySelector('#allocPanel'); if(!panel) return;
    draw(panel);
    if(focusSel){ var el = host.querySelector(focusSel); if(el && el.focus) try{ el.focus(); }catch(e){} }
  }

  /* ----------------------------------------------------- party change confirm */

  function askPartyChange(lost){
    var n = 0, names = [];
    lost.forEach(function(gk){ n += picked(state.lines[gk]).length; names.push(gk.slice(gk.indexOf(' ') + 1)); });
    var sup = lost[0].indexOf('sup ') === 0, who = sup ? 'supplier' : 'customer', doc = sup ? 'bill' : 'invoice';
    var text = 'Changing the ' + who + ' clears the ' + n + ' ' + doc + ' line' + (n === 1 ? '' : 's') + ' linked to ' + names.join(', ') + '. Continue?';
    var M = modal();
    var go = function(ok){
      state.asking = false;
      if(ok){ lost.forEach(function(gk){ delete state.lines[gk]; delete state.prev[gk]; }); refresh(); return; }
      if(!revert()) lost.forEach(function(gk){ delete state.prev[gk]; });   // could not undo: keep the lines parked
      refresh();
    };
    state.asking = true;
    if(M && M.confirm) M.confirm(text, { title:'Change ' + who + '?', okText:'Clear ' + doc + ' lines', cancelText:'Keep ' + who, danger:true }).then(go, function(){ go(false); });
    else go(true);
  }

  /** The native form registers its own undo; the designed form is put back from a DOM snapshot. */
  function revert(){
    if(typeof state.revert === 'function'){ try{ return state.revert() !== false; }catch(e){ return false; } }
    var s = state.snap; if(!s || !s.length) return false; var ok = true;
    s.forEach(function(x){
      if(!x.row || x.row.isConnected === false){ ok = false; return; }
      [[x.acc, x.accV], [x.sub, x.subV]].forEach(function(p){ var el = p[0]; if(!el || el.value === p[1]) return;
        el.value = p[1]; try{ el.dispatchEvent(new Event('change', { bubbles:true })); }catch(e){} });
    });
    return ok;
  }
  function snapshot(){
    if(typeof state.revert === 'function') return;
    var tbl = state.host && state.host.querySelector('[data-line-items]'); if(!tbl || !tbl.tBodies[0]){ state.snap = null; return; }
    state.snap = Array.prototype.map.call(tbl.tBodies[0].rows, function(row){
      var acc = row.querySelector('[data-account-col]') || row.querySelector('select[data-qc-source="account"]'), sub = row.querySelector('[data-subaccount-col]');
      return { row:row, acc:acc, sub:sub, accV:acc ? acc.value : null, subV:sub ? sub.value : null };
    });
  }

  /* --------------------------------------------------------------- totalling */

  function sections(){
    var host = state.host; if(!host) return [];
    return Array.prototype.slice.call(host.querySelectorAll('.alloc-sec[data-alloc-amount]'));
  }

  /** Live totals + validation for one section. Returns its error, or ''. */
  function tally(sec){
    var amount = num(sec.getAttribute('data-alloc-amount'));
    var ins = sec.querySelectorAll('.alloc-in');
    var total = 0, err = '';
    for(var i=0;i<ins.length;i++){
      var el = ins[i], raw = String(el.value||'').trim();
      var v = raw === '' ? 0 : num(raw);
      var uid = el.getAttribute('data-alloc-uid') || '';
      var maxA = el.getAttribute('data-alloc-max'), max = (maxA == null || maxA === '') ? null : num(maxA);
      var bad = '';
      if(raw !== '' && isNaN(parseFloat(raw.replace(/,/g,'')))) bad = 'Enter a number.';
      else if(v < 0) bad = 'A negative amount cannot be applied.';
      else if(!uid && v > 0.005) bad = 'Choose the ' + (sec.getAttribute('data-alloc-side') === 'sup' ? 'bill' : 'invoice') + ' for the amount on line ' + (i+1) + '.';
      else if(uid && max != null && v > max + 0.005) bad = 'Cannot apply more than the ' + r2(max).toFixed(2) +
        ' balance due on ' + (el.getAttribute('data-alloc-ref') || 'this invoice') + '.';
      if(el.classList) el.classList.toggle('bad', !!bad);
      if(bad && !err) err = bad;
      total += v;
    }
    total = r2(total);
    var left = r2(amount - total);
    if(!err && total > amount + 0.005) err = 'Total applied (' + money(total) + ') is more than the ' + (state.key === 'payments' ? 'payment' : 'receipt') + ' amount (' + money(amount) + ').';
    var t = sec.querySelector('[data-alloc-total]'), l = sec.querySelector('[data-alloc-left]');
    if(t) t.textContent = money(total);
    if(l){ l.textContent = money(left); if(l.classList) l.classList.toggle('neg', left < -0.005); }
    var e = sec.querySelector('[data-alloc-err]');
    if(e){ e.textContent = err; if(e.classList) e.classList.toggle('hide', !err); }
    return err;
  }

  function recompute(){ sections().forEach(tally); }

  /** The first validation problem across the panel, or null when it is clean. */
  function validate(){
    var bad = null;
    sections().forEach(function(sec){ var e = tally(sec); if(e && !bad) bad = e; });
    return bad;
  }

  /** The payment_allocations rows for this document. */
  function collect(){
    var out = [];
    sections().forEach(function(sec){
      var side = sec.getAttribute('data-alloc-side');
      var party = sec.getAttribute('data-alloc-party');
      var invKey = side === 'sup' ? 'purchInv' : 'salesInv';
      sec.querySelectorAll('.alloc-in').forEach(function(el){
        var v = r2(num(el.value)), uid = el.getAttribute('data-alloc-uid');
        if(uid && v > 0.005) out.push({ key:invKey, uid:uid, party:party, amount:v });
      });
    });
    return out;
  }

  /* ----------------------------------------------------------------- wiring */

  var pending = 0;
  function scheduleRefresh(){
    if(pending) return;
    pending = setTimeout(function(){ pending = 0; refresh(); }, 0);
  }
  function secOf(el){ return el.closest ? el.closest('.alloc-sec[data-gk]') : null; }

  /** Picking an invoice on a line: Amount applied defaults to what the invoice and the receipt can both take. */
  function pickInvoice(sec, i, uid){
    var gk = sec.getAttribute('data-gk'), L = linesOf(gk), ln = L[i]; if(!ln) return gk;
    ln.uid = uid || ''; ln.orig = null; ln.amt = '';
    if(ln.uid){
      var row = invoicesFor(sec.getAttribute('data-alloc-side'), sec.getAttribute('data-alloc-party')).byUid[ln.uid];
      var others = 0; L.forEach(function(x, j){ if(j !== i) others += num(x.amt); });
      var room = Math.max(0, num(sec.getAttribute('data-alloc-amount')) - others);
      var use = row ? Math.min(row.outstanding, room) : 0;
      if(use > 0.005) ln.amt = r2(use).toFixed(2);
    }
    return gk;
  }

  function onInput(e){
    var el = e.target;
    if(!el) return;
    if(el.classList && el.classList.contains('alloc-in')){
      var sec = secOf(el); if(!sec) return;
      var ln = linesOf(sec.getAttribute('data-gk'))[+el.getAttribute('data-li')];
      if(ln) ln.amt = el.value;
      tally(sec);
      return;
    }
    if(el.classList && el.classList.contains('alloc-inv')){
      if(e.type !== 'change') return;
      var s2 = secOf(el); if(!s2) return;
      var i = +el.getAttribute('data-li'), gk = pickInvoice(s2, i, el.value);
      redrawPanel('.alloc-sec[data-gk="' + cssEsc(gk) + '"] .alloc-in[data-li="' + i + '"]');
      return;
    }
    /* an account, party or amount changed - the whole panel may be different */
    if(el.closest && el.closest('[data-line-items]')) scheduleRefresh();
  }

  function onClick(e){
    var el = e.target;
    if(!el || !el.closest) return;
    var btn = el.closest('.alloc-add, .alloc-auto, .alloc-clear, .alloc-rm'); if(!btn || btn.disabled) return;
    var sec = secOf(btn); if(!sec) return;
    var gk = sec.getAttribute('data-gk'), L = linesOf(gk), focus = null;
    if(btn.classList.contains('alloc-rm')){
      L.splice(+btn.getAttribute('data-li'), 1);
      if(!L.length) L.push({ uid:'', amt:'', orig:null });
    } else if(btn.classList.contains('alloc-add')){
      L.push({ uid:'', amt:'', orig:null });
      focus = '.alloc-sec[data-gk="' + cssEsc(gk) + '"] .alloc-inv[data-li="' + (L.length - 1) + '"]';
    } else if(btn.classList.contains('alloc-auto')){
      var inv = invoicesFor(sec.getAttribute('data-alloc-side'), sec.getAttribute('data-alloc-party'));
      var left = num(sec.getAttribute('data-alloc-amount')), out = [];
      inv.open.forEach(function(r){ var use = Math.max(0, Math.min(left, r.outstanding)); if(use <= 0.005) return; left = r2(left - use);
        var was = L.filter(function(x){ return x.uid === r.uid; })[0];
        out.push({ uid:r.uid, amt:r2(use).toFixed(2), orig:was ? was.orig : null }); });
      state.lines[gk] = out.length ? out : [{ uid:'', amt:'', orig:null }];
    } else if(btn.classList.contains('alloc-clear')){
      state.lines[gk] = [{ uid:'', amt:'', orig:null }];
    }
    redrawPanel(focus);
  }

  /**
   * Called once the Receipt / Payment form is in the DOM.
   * opts.allocations  seed lines for a new document (Receive payment, Copy to)
   * opts.revert       fn() that puts the form back when a party change is cancelled
   */
  function mount(host, key, opts){
    if(!host || (key !== 'receipts' && key !== 'payments')) return;
    opts = opts || {};
    state = fresh(host, key);
    state.revert = typeof opts.revert === 'function' ? opts.revert : null;
    (opts.allocations || []).forEach(function(a){ if(a && a.uid && num(a.amount) > 0) state.pend[a.uid] = String(r2(num(a.amount))); });
    var form = host.querySelector('.app-form') || host;
    var old = host.querySelector('#allocPanel'); if(old && old.parentNode) old.parentNode.removeChild(old);
    var tbl = host.querySelector('[data-line-items]');
    var anchor = tbl ? (tbl.closest('.li-wrap') || tbl) : null;
    var panel = global.document.createElement('div');
    panel.id = 'allocPanel';
    panel.className = 'alloc-panel hide';
    if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    else form.appendChild(panel);
    if(!host._allocWired){
      host._allocWired = true;
      host.addEventListener('input', onInput);
      host.addEventListener('change', onInput);
      host.addEventListener('click', onClick);
    }
    refresh();
  }

  /* ------------------------------------------------------ invoice View panel */

  /** Section for a Sales / Purchase Invoice View: payment status + linked receipts / payments. */
  function invoicePaymentsHtml(b, key, rec){
    if(!b || !rec || (key !== 'salesInv' && key !== 'purchInv')) return '';
    var P; try{ P = invoicePayments(b, rec, key); }catch(e){ return ''; }
    var row = P.settlement, sales = key === 'salesInv';
    var cls = P.status === 'Paid' ? 'paid' : (P.status === 'Partly paid' ? 'partial' : 'unpaid');
    var label = function(r){ return (r.key === 'receipts' ? 'Receipt' : 'Payment') + (r.reference ? ' ' + r.reference : ''); };
    var rows = P.rows.map(function(r){
      var refund = (sales && r.key === 'payments') || (!sales && r.key === 'receipts');
      return '<tr><td>' + esc(fmtD(r.date)) + '</td><td><a class="led-link" onclick="Allocations.openDoc(\'' + r.key + '\',' + esc(JSON.stringify(r.id)) + ')">' + esc(label(r)) + '</a>' +
        (refund ? ' <span class="inv-pay-tag">refund</span>' : '') + '</td><td class="r m">' + money(r.amount) + '</td></tr>';
    }).join('');
    if(row && row.implicit > 0.005) rows += '<tr class="inv-pay-auto"><td></td><td>Unallocated ' + (sales ? 'receipts' : 'payments') + ' / credits, applied oldest first</td><td class="r m">' + money(row.implicit) + '</td></tr>';
    var total = row ? row.total : (Number(rec.total) || 0), paid = row ? row.paid : 0, due = row ? row.outstanding : total;
    return '<div class="inv-pay" id="invPayments">' +
      '<div class="inv-pay-h"><span>' + (sales ? 'Receipts' : 'Payments') + ' against this ' + (sales ? 'invoice' : 'bill') + '</span>' +
        '<span class="inv-pay-st inv-pay-' + cls + '">' + esc(P.status) + '</span></div>' +
      (rows ? '<div class="tbl-scroll"><table class="reg-tbl inv-pay-tbl"><thead><tr><th>Date</th><th>' + (sales ? 'Receipt' : 'Payment') + '</th><th class="r">Amount applied</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="inv-pay-none">No ' + (sales ? 'receipts' : 'payments') + ' are linked to this ' + (sales ? 'invoice' : 'bill') + ' yet.</div>') +
      '<div class="inv-pay-sum"><span>Total <b>' + money(total) + '</b></span><span>Paid <b>' + money(paid) + '</b></span><span>Balance due <b>' + money(due) + '</b></span></div>' +
    '</div>';
  }

  /** Open a linked receipt / payment from the invoice View; Close comes back to the invoice. */
  function openDoc(key, id){
    var A = app(); if(!A) return;
    try{ if(A.wsMode === 'view' && typeof A._snapNav === 'function'){ var s = A._snapNav(); A.originStack = (A.originStack || []).concat([{ snap:s, scroll:0 }]); } }catch(e){}
    A.ledgerOpen(key, id, 'view');
  }

  (function wireView(){
    var A = app(); if(!A || typeof A.viewHtml !== 'function') return;
    var orig = A.viewHtml;
    A.viewHtml = function(b){
      var html = String(orig.apply(this, arguments) || '');
      try{
        var key = (typeof LABEL2KEY !== 'undefined') ? LABEL2KEY[this.wsSection] : null;
        if(key !== 'salesInv' && key !== 'purchInv') return html;
        if(html.indexOf('id="invPayments"') >= 0) return html;
        var bb = b || this.curBiz(), self = this;
        var rec = ((bb.records && bb.records[key]) || []).filter(function(r){ return String(r.id) === String(self.editingId); })[0];
        var sec = invoicePaymentsHtml(bb, key, rec); if(!sec) return html;
        var at = html.indexOf('<div class="doc-foot">'); if(at < 0) at = html.indexOf('<div class="form-actions">');
        return at >= 0 ? html.slice(0, at) + sec + html.slice(at) : html + sec;
      }catch(e){ return html; }
    };
  })();

  global.Allocations = {
    mount:mount, refresh:refresh, recompute:recompute, validate:validate, collect:collect,
    scanParties:scanParties, invoicesFor:invoicesFor, invoicePaymentsHtml:invoicePaymentsHtml, openDoc:openDoc,
    /** lines with an invoice chosen, per party section (gk = side + ' ' + party) */
    lines:function(){ var o = {}; Object.keys(state.lines).forEach(function(gk){ o[gk] = picked(state.lines[gk]).map(function(x){ return { uid:x.uid, amt:x.amt }; }); }); return o; },
    isAsking:function(){ return !!state.asking; },
    _pick:function(gk, i, uid){ var host = state.host; var sec = host && host.querySelector('.alloc-sec[data-gk="' + cssEsc(gk) + '"]'); if(sec){ pickInvoice(sec, i, uid); redrawPanel(); } },
    _sectionHtml:sectionHtml, _setLines:function(gk, L){ state.lines[gk] = L; }, _reset:function(key){ state = fresh(null, key || null); },
    _state:function(){ return state; }
  };
})(typeof window !== 'undefined' ? window : this);
