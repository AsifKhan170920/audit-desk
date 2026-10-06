/* Ledger navigation: the origin chain, ledger -> voucher Next/Prev, the
   Transaction Journal section and the sidebar's active tab / counts.

   Loaded after js/app.js and js/users.js; it only wraps App methods, so the
   register, ledger and form code underneath stays as it is.

   ORIGIN CHAIN
   App.originStack is a stack of "return points" (snapshots made by
   App._snapNav, which this file extends to carry the stack itself, the
   breadcrumb trail, the list/ledger search and paging). Whenever a voucher
   View or Form opens from a list, a ledger, a GL ledger or another View, the
   page it came from is pushed. Save / Cancel / Close / Delete all end in
   App.backFromRecord(), which pops one level, so:
     ADCB ledger -> View -> Edit -> Update   returns to the View
     View -> Clone / Copy to -> Create       returns to that View
     View -> Delete                          returns to the ledger
   and the breadcrumb, the sidebar tab and Next/Prev follow the bottom entry
   (the origin) the whole way. The state is mirrored in location.hash
   (#b=<biz>&s=<section>&m=<mode>&id=<record>&from=ledger:bankCash:<id>) so a
   refresh lands on the same page with the same origin.

   POSTINGS
   App.postingsFor(b, key, rec) returns the double entry of one document as
   [{account, acctId, sub, debit, credit, link}]. If the accounting engine
   publishes a global postingsForRecord(b, key, rec) it is used instead, so
   the Transaction Journal switches to the engine's own numbers as soon as
   one exists. */
(function(global){
  'use strict';
  var A = global.App || (typeof App !== 'undefined' ? App : null);
  if(!A) return;

  var R2 = function(n){ return Math.round((Number(n)||0)*100)/100; };
  var num = function(v){ return (v==null||v==='') ? 0 : (Number(v)||0); };
  var has = function(v){ return v!=null && v!==''; };
  var L2K = function(l){ return (typeof LABEL2KEY!=='undefined') ? LABEL2KEY[l] : undefined; };
  var K2L = function(k){ return (typeof KEY2LABEL!=='undefined') ? KEY2LABEL[k] : undefined; };
  var REGc = function(k){ return (typeof REG!=='undefined' && REG[k]) || null; };
  /* accounting.js helpers are plain function declarations, i.e. globals */
  var G = function(n){ return (typeof global[n]==='function') ? global[n] : null; };
  var byId = function(id){ try{ return document.getElementById(id); }catch(e){ return null; } };
  var sameId = function(a,b){ return a!=null && b!=null && String(a)===String(b); };
  var wrap = function(name, fn){ var orig = A[name]; if(typeof orig!=='function') return; A[name] = function(){ return fn.call(this, orig, arguments); }; };

  var SRC_MODES = { list:1, ledger:1, glledger:1, view:1 };     // pages a voucher can be opened from
  var REC_MODES = { view:1, form:1 };                            // voucher pages
  var NO_SIDE   = { tools:1, settings:1, customize:1 };          // History / Backup / Emails / Settings
  var PARTY_LEDGER = { customers:1, suppliers:1, employees:1, capital:1, bankCash:1, inventory:1, fixedAssets:1 };

  A.originStack = A.originStack || [];
  A._tjOpen = false;

  /* ------------------------------------------------------------------ snapshots */
  wrap('_snapNav', function(orig, a){
    var s = orig.apply(this, a) || {};
    s.navTrail = (this.navTrail||[]).slice();
    s.originStack = (this.originStack||[]).slice();
    s.listQuery = this.listQuery; s.pageNum = this.pageNum; s.lPageNum = this.lPageNum;
    s.ledgerQuery = this.ledgerQuery; s.ledgerFrom = this.ledgerFrom; s.ledgerTo = this.ledgerTo;
    s._tjOpen = !!this._tjOpen;
    return s;
  });
  /* Every restore is a step back, never a new hop: it must not push. */
  wrap('_restoreNav', function(orig, a){
    var s = a[0], self = this; this._lnRestoring = (this._lnRestoring||0) + 1;
    try{ if(s && !('originStack' in s)) this.originStack = []; return orig.apply(this, a); }
    finally{ this._lnRestoring--; if(s && s._scroll!=null) setTimeout(function(){ var m = byId('wsMain'); if(m) try{ m.scrollTop = s._scroll; }catch(e){} }, 0); }
  });

  var pageId = function(s){ return [s.wsMode, s.wsSection, s.editingId, s.ledgerId, s.glAcctId, s.setView, s.repView, s.toolView].join('|'); };

  A._lnRec = function(b, s){ var k = L2K(s.wsSection); if(!b || !k) return null;
    return ((b.records&&b.records[k])||[]).find(function(r){ return sameId(r.id, s.editingId); }) || null; };
  /** "Receipt 1", "Sales Invoice INV-001", "Customer ABC" */
  A._lnRecTitle = function(key, rec){ var c = REGc(key)||{}; var sg = c.singular || K2L(key) || '';
    if(!rec) return sg; var ref = rec.reference || rec.name || rec.code || rec.number || '';
    return (sg + (ref!=='' ? ' ' + ref : '')).trim(); };
  /** Label of a snapshot as shown in a breadcrumb. */
  A._lnLabel = function(s){ var b = this.curBiz(); if(!s) return '';
    if(s.wsMode==='ledger'){ var k = L2K(s.wsSection); var r = b && ((b.records&&b.records[k])||[]).find(function(x){ return sameId(x.id, s.ledgerId); });
      return r ? (r.name || s.wsSection) : (s.wsSection || 'Ledger'); }
    if(s.wsMode==='glledger'){ var ac = b && (b.coa||[]).find(function(n){ return sameId(n.id, s.glAcctId); }); return ac ? (ac.name || 'Account') : 'Account'; }
    if(s.wsMode==='view'){ return this._lnRecTitle(L2K(s.wsSection), this._lnRec(b, s)); }
    if(s.wsMode==='form'){ var c = REGc(L2K(s.wsSection))||{}; if(s.editingId==null) return c.newLabel || ('New ' + (c.singular||'')); return 'Edit ' + this._lnRecTitle(L2K(s.wsSection), this._lnRec(b, s)); }
    if(s.wsMode==='statement') return 'Statement';
    if(s.wsMode==='summary') return 'Summary';
    return s.wsSection || ''; };
  /* the ledger trail and "◀ Back" name a voucher, not its register */
  wrap('_navLabel', function(orig, a){ if(REC_MODES[this.wsMode]) return this._lnLabel(this._snapNav()); return orig.apply(this, a); });

  /* ------------------------------------------------------------------ the stack */
  A._lnClear = function(){ this.originStack = []; this._tjOpen = false; };
  ['selectSection', 'openBusiness', 'closeBusiness', 'backToSummary', 'openTool', 'openCustomize'].forEach(function(n){
    wrap(n, function(orig, a){ this._lnClear(); return orig.apply(this, a); });
  });
  wrap('backToList', function(orig, a){ this.originStack = []; return orig.apply(this, a); });

  /** A voucher page still exists? (a deleted record's View/Edit is skipped when going back) */
  A._lnAlive = function(b, s){ if(!s || !REC_MODES[s.wsMode] || s.editingId==null) return true; return !!this._lnRec(b, s); };

  wrap('backFromRecord', function(orig, a){
    var b = this.curBiz(), st = (this.originStack||[]).slice();
    while(st.length && !this._lnAlive(b, st[st.length-1].snap)) st.pop();
    if(!st.length){ this.originStack = []; return orig.apply(this, a); }
    var e = st[st.length-1]; this.recReturn = null; this.ledgerReturn = null; this.editingId = null;
    var s = Object.assign({}, e.snap, { _scroll: e.scroll });
    this._restoreNav(s);
    return true;
  });
  /** Breadcrumb: jump to stack entry i (its page, with the stack below it). */
  A.lnPopTo = function(i){ var st = this.originStack||[]; var e = st[i]; if(!e) return; this._restoreNav(Object.assign({}, e.snap, { _scroll: e.scroll })); };
  /** Breadcrumb: jump to entry i of the origin's own trail (e.g. "Bank and Cash Accounts"). */
  A.lnTrailGo = function(i){ var st = this.originStack||[]; var e0 = st[0]; if(!e0) return; var t = e0.snap.navTrail||[]; var e = t[i]; if(!e) return;
    var s = Object.assign({}, e.snap); if(!('navTrail' in s)) s.navTrail = t.slice(0, i); if(!('originStack' in s)) s.originStack = [];
    this._restoreNav(s); };

  /* The hop rule, applied on every render: opening a View/Form from a
     list, ledger or View pushes the page it came from. */
  wrap('renderMain', function(orig, a){
    var prev = this._lnPrev, curMode = this.wsMode;
    if(!this._lnRestoring && prev && prev.view==='workspace' && REC_MODES[curMode] && SRC_MODES[prev.wsMode]
       && !(prev.wsMode==='view' && curMode==='view') && pageId(prev)!==pageId(this)){
      var m = byId('wsMain'); var sc = 0; try{ sc = (m && m.scrollTop) || 0; }catch(e){}
      this.originStack = (this.originStack||[]).concat([{ snap: prev, scroll: sc }]);
    }
    /* never list the page we are on as a step back */
    if(REC_MODES[curMode]){ var me = pageId(this); var st = (this.originStack||[]);
      while(st.length && pageId(st[st.length-1].snap)===me) st = st.slice(0, -1);
      this.originStack = st; }
    else if(curMode==='list' && (this.originStack||[]).length){ var top = this.originStack[this.originStack.length-1].snap;
      if(top.wsMode==='list' && top.wsSection===this.wsSection) this.originStack = this.originStack.slice(0, -1); }
    var changed = !prev || pageId(prev)!==pageId(this);
    var r = orig.apply(this, a);
    this._lnPrev = this._snapNav(); this._lnPrev.view = this.view;
    if(changed && !this._lnRestoring){ var mm = byId('wsMain'); try{ if(mm) mm.scrollTop = 0; }catch(e){} }
    try{ this._lnSyncSide(); }catch(e){}
    try{ this._lnWriteHash(); }catch(e){}
    return r;
  });

  /* ------------------------------------------------------------------ sidebar */
  /** The sidebar tab to highlight: the origin's tab while inside a voucher
      chain, none on History / Backup / Emails / Settings / Customize. */
  A.sideActive = function(){
    if(NO_SIDE[this.wsMode]) return null;
    var st = this.originStack||[];
    if(st.length){ var s = st[0].snap; if(s && s.wsMode==='summary') return 'Summary'; if(s && s.wsSection) return s.wsSection; }
    return this.wsSection;
  };
  A._lnSyncSide = function(){
    var sb = byId('sidebar'); if(!sb || !sb.querySelectorAll) return;
    var act = this.sideActive();
    sb.querySelectorAll('.side-item[data-side]').forEach(function(el){
      var on = el.getAttribute('data-side')===act; if(el.classList) el.classList.toggle('active', on); });
    this._lnRefreshCounts();
  };
  A._lnRefreshCounts = function(){
    var sb = byId('sidebar'); if(!sb || !sb.querySelectorAll) return; var b = this.curBiz(); if(!b) return; var R = b.records||{};
    sb.querySelectorAll('[data-side-count]').forEach(function(el){
      var n = (R[el.getAttribute('data-side-count')]||[]).length; var t = n.toLocaleString('en-US');
      if(el.textContent!==t) el.textContent = t; if(el.classList) el.classList.toggle('zero', n===0); });
  };
  /* counts follow every save (quick-create modals save without navigating) */
  wrap('saveBiz', function(orig, a){ var r = orig.apply(this, a), self = this;
    if(!this._lnCountT){ this._lnCountT = setTimeout(function(){ self._lnCountT = 0; try{ if(self.view==='workspace') self._lnRefreshCounts(); }catch(e){} }, 0); }
    return r; });
  /* a sidebar click starts the page at the top */
  wrap('selectSection', function(orig, a){ var r = orig.apply(this, a); var m = byId('wsMain'); try{ if(m) m.scrollTop = 0; }catch(e){}
    try{ if(typeof global.scrollTo==='function') global.scrollTo(0, 0); }catch(e){} return r; });

  /* ------------------------------------------------------------------ breadcrumb */
  wrap('recCrumb', function(orig, a){
    var st = this.originStack||[]; if(!st.length) return orig.apply(this, a);
    var self = this, esc = function(s){ return self.esc(s); }, parts = [];
    var trail = (st[0].snap.navTrail||[]);
    trail.forEach(function(e, i){ parts.push('<a class="led-link" onclick="App.lnTrailGo('+i+')">'+esc(e.label)+'</a>'); });
    st.forEach(function(e, i){ parts.push('<a class="led-link" onclick="App.lnPopTo('+i+')">'+esc(self._lnLabel(e.snap))+'</a>'); });
    var cur = this.wsMode==='view' ? this._lnLabel(this._snapNav()) : (this.editingId!=null ? 'Edit' : (a[1] || ''));
    parts.push('<span class="ln-crumb-cur">'+esc(cur)+'</span>');
    return '<div class="ws-crumb ln-crumb"><div class="left">'+this._crumbIco()+' ▸ '+parts.join(' <span class="ln-crumb-sep">▸</span> ')+'</div></div>';
  });

  /* ------------------------------------------------------------------ ledgers */
  var isCashCtl = function(b, acct){ return !!(acct && (acct.cashControl || /^cash & cash equivalents$/i.test(acct.name||''))); };
  var lineBank = function(ln){ return ln && (ln.bank || ln.bankAccount || ln.sub || ln.subAccount || ''); };
  /* the bank ledger also carries journal lines posted to "Cash & cash
     equivalents" with this bank as the sub-account */
  wrap('ledgerEntries', function(orig, a){
    var e = orig.apply(this, a), b = a[0], key = a[1], rec = a[2];
    if(key!=='bankCash' || !rec || !b) return e;
    var bm = G('bankMatch'), byAcct = G('acctById'); if(!bm || !byAcct) return e;
    var seen = {}; e.forEach(function(x){ if(x.src==='journal') seen[x.id] = 1; });
    var added = false;
    (((b.records||{}).journal)||[]).forEach(function(j){ if(seen[j.id]) return; var d = 0, c = 0, hit = false;
      (j.lines||[]).forEach(function(ln){ var ac = byAcct(b, ln.account); var direct = sameId(ln.account, rec.id) || sameId(ln.account, rec.uuid);
        if(direct || (isCashCtl(b, ac) && bm(lineBank(ln), rec))){ d += num(ln.debit); c += num(ln.credit); hit = true; } });
      if(hit && (d || c)){ e.push({ date:j.date, ref:j.reference, type:'Journal entry'+(j.narration?' — '+j.narration:''), debit:d, credit:c, src:'journal', id:j.id }); added = true; } });
    if(added) e.sort(function(x, y){ return String(x.date||'').localeCompare(String(y.date||'')) || String(x.ref||'').localeCompare(String(y.ref||'')); });
    return e;
  });

  /* Ledgers read oldest -> newest (opening row first, then the running
     balance down the page); a zero opening row is left out, and the footer
     count is the number of rows shown. The *Data functions keep their
     newest-first order because statements and copy-to-clipboard rely on it. */
  var chrono = function(rows, isMoney, keepOrder){
    var open = [], rest = [];
    (rows||[]).forEach(function(r){ if(r.opening) open.push(r); else rest.push(r); });
    if(isMoney) open = open.filter(function(r){ return num(r.bal) || num(r.debit) || num(r.credit); });
    return open.concat(keepOrder ? rest : rest.reverse());
  };
  A._lnChrono = chrono;
  /* a column sort picked by the user (js/list-tools.js) already ordered the rows: keep that order (opening row still first) */
  var userSorted = function(app){ try{ var c = app._sortCtx && app._sortCtx(); return !!(c && app.sortState && app.sortState(c)); }catch(e){ return false; } };
  [['ledgerBodyHtml', 'ledgerData', true], ['glLedgerBodyHtml', 'glLedgerData', true], ['invLedgerBodyHtml', 'invLedgerData', false], ['faLedgerBodyHtml', 'faLedgerData', false]].forEach(function(t){
    wrap(t[0], function(orig, a){
      var self = this, dataFn = this[t[1]]; if(typeof dataFn!=='function') return orig.apply(this, a);
      this[t[1]] = function(){ var d = dataFn.apply(self, arguments); if(d && d.rows){ d.rows = chrono(d.rows, t[2], userSorted(self)); d.count = d.rows.length; } return d; };
      try{ return orig.apply(this, a); } finally{ this[t[1]] = dataFn; }
    });
  });
  /* the Reference column is plain text: View / Edit are the buttons beside it */
  var plainRef = function(html){ return String(html).replace(/<a class="led-link" onclick="App\.ledgerOpen\([^"]*\)">([\s\S]*?)<\/a>/g, '$1'); };
  ['ledgerRowHtml', 'invLedgerRowHtml', 'faLedgerRowHtml'].forEach(function(n){ wrap(n, function(orig, a){ return plainRef(orig.apply(this, a)); }); });

  /* ------------------------------------------------------------------ Next / Prev along the origin ledger */
  /** The ledger a snapshot shows, as [{src, id}] oldest -> newest (respecting its search and period). */
  A._lnLedgerSeq = function(b, s){
    if(!s || !(s.wsMode==='ledger' || s.wsMode==='glledger')) return null;
    var keep = this._snapNav(), self = this, rows = null;
    var F = ['wsMode', 'wsSection', 'ledgerId', 'glAcctId', 'ledgerQuery', 'ledgerFrom', 'ledgerTo'];
    F.forEach(function(k){ self[k] = s[k]; });
    try{
      var k = L2K(s.wsSection);
      var d = s.wsMode==='glledger' ? this.glLedgerData(b) : (k==='inventory' ? this.invLedgerData(b) : (k==='fixedAssets' ? this.faLedgerData(b) : this.ledgerData(b)));
      rows = chrono(d.rows || [], false);
    }catch(e){ rows = []; }
    finally{ F.forEach(function(k){ self[k] = keep[k]; }); }
    var seen = {}, out = [];
    rows.forEach(function(r){ if(!r.src || r.id==null || !K2L(r.src)) return; var id = r.src+'#'+r.id; if(seen[id]) return; seen[id] = 1; out.push({ src:r.src, id:r.id }); });
    return out;
  };
  /** The ledger entry under the voucher being viewed, or null when it was not opened from a ledger. */
  A._lnLedgerCtx = function(b){
    var st = this.originStack||[]; if(!st.length) return null;
    var top = st[st.length-1].snap; if(!(top.wsMode==='ledger' || top.wsMode==='glledger')) return null;
    var seq = this._lnLedgerSeq(b, top) || []; var key = L2K(this.wsSection), id = this.editingId;
    var idx = seq.findIndex(function(x){ return x.src===key && sameId(x.id, id); });
    return { seq:seq, idx:idx, label:this._lnLabel(top) };
  };
  A.lnNav = function(where){
    var b = this.curBiz(); var ctx = this._lnLedgerCtx(b); if(!ctx || !ctx.seq.length) return;
    var n = where==='first' ? 0 : (where==='last' ? ctx.seq.length-1 : ctx.idx + (Number(where)||0));
    if(n<0 || n>=ctx.seq.length || n===ctx.idx) return;
    var t = ctx.seq[n]; this.wsSection = K2L(t.src); this.editingId = t.id; this.wsMode = 'view'; this.listQuery = '';
    this.renderMain(b);
  };
  A._lnPagerHtml = function(ctx){
    var i = ctx.idx, n = ctx.seq.length, dis = function(c){ return c ? ' disabled' : ''; }, esc = this.esc.bind(this);
    var pos = i>=0 ? (i+1) + ' / ' + n : '– / ' + n;
    return '<div class="view-pager ln-pager">'+
      '<button class="pgb" title="First"'+dis(i<=0)+' onclick="App.lnNav(\'first\')">«</button>'+
      '<button class="pgb" title="Previous"'+dis(i<=0)+' onclick="App.lnNav(-1)">‹</button>'+
      '<span class="ln-pos">'+pos+' in '+esc(ctx.label)+'</span>'+
      '<button class="pgb" title="Next"'+dis(i<0 || i>=n-1)+' onclick="App.lnNav(1)">›</button>'+
      '<button class="pgb" title="Last"'+dis(i<0 || i>=n-1)+' onclick="App.lnNav(\'last\')">»</button></div>';
  };

  /* ------------------------------------------------------------------ postings + Transaction Journal */
  var acctOf = function(b, id){ var f = G('acctById'); return f ? f(b, id) : null; };
  var findA = function(b, name){ var f = G('findAcct'); return f ? f(b, name) : null; };
  var bankRecOf = function(b, ref){ var bm = G('bankMatch'); if(!ref || !bm) return null; return (((b.records||{}).bankCash)||[]).find(function(x){ return bm(ref, x); }) || null; };
  var partyKeyOf = function(acct){ var n = (acct && acct.name) || '';
    if(/^accounts receivable$/i.test(n)) return 'customers'; if(/^accounts payable$/i.test(n)) return 'suppliers';
    if(/^employee clearing account$/i.test(n)) return 'employees'; if(/^capital accounts$/i.test(n)) return 'capital'; return null; };

  /** Builds rows; merges repeats of the same account + sub-account. */
  var Book = function(b){ this.b = b; this.rows = []; };
  Book.prototype.post = function(acct, name, sub, dr, cr){
    dr = R2(dr); cr = R2(cr); if(!dr && !cr) return;
    if(dr<0){ cr -= dr; dr = 0; } if(cr<0){ dr -= cr; cr = 0; }
    var b = this.b, link = null, label = (acct && acct.name) || name || '(no account)', subOut = sub || '';
    if(acct && isCashCtl(b, acct) && sub){ var bk = bankRecOf(b, sub); if(bk){ label = bk.name; subOut = ''; link = { t:'ledger', key:'bankCash', id:bk.id }; } }
    if(!link && acct){ var pk = partyKeyOf(acct); var pr = pk && sub ? (((b.records||{})[pk])||[]).find(function(x){ return x.name===sub; }) : null;
      link = pr ? { t:'ledger', key:pk, id:pr.id } : { t:'gl', id:acct.id }; }
    var k = label + '|' + subOut; var hit = this.rows.find(function(r){ return r._k===k; });
    if(hit){ hit.debit = R2(hit.debit + dr); hit.credit = R2(hit.credit + cr); return; }
    this.rows.push({ _k:k, account:label, acctId:acct ? acct.id : null, sub:subOut, debit:dr, credit:cr, link:link });
  };
  Book.prototype.bank = function(ref, dr, cr){ var b = this.b, bk = bankRecOf(b, ref);
    dr = R2(dr); cr = R2(cr); if(!dr && !cr) return;
    if(bk){ var k = bk.name + '|'; var hit = this.rows.find(function(r){ return r._k===k; });
      if(hit){ hit.debit = R2(hit.debit + dr); hit.credit = R2(hit.credit + cr); return; }
      this.rows.push({ _k:k, account:bk.name, acctId:null, sub:'', debit:dr, credit:cr, link:{ t:'ledger', key:'bankCash', id:bk.id } }); return; }
    var cash = (b.coa||[]).find(function(n){ return n.type==='account' && isCashCtl(b, n); });
    this.post(cash, ref || 'Cash & cash equivalents', '', dr, cr);
  };
  var lineNet = function(ln){ return has(ln.net) ? num(ln.net) : num(ln.amount); };
  var lineTax = function(ln){ return has(ln.taxAmt) ? num(ln.taxAmt) : 0; };
  var lineAcct = function(b, ln, fallback){ return acctOf(b, ln.account) || findA(b, ln.accountName || '') || fallback || null; };

  A._lnDefaultPostings = function(b, key, rec){
    var bk = new Book(b), lines = rec.lines || [];
    if(key==='receipts' || key==='payments'){
      var inn = key==='receipts', vat = findA(b, inn ? 'Output VAT' : 'Input VAT'), sum = 0;
      var lns = lines.length ? lines : [{ account:rec.account, sub:rec.sub, amount:rec.amount }];
      lns.forEach(function(ln){ var n = lineNet(ln), t = lineTax(ln); if(!n && !t) return; sum += n + t;
        var ac = lineAcct(b, ln), sub = ln.sub || ln.subAccount || '';
        if(inn) bk.post(ac, ln.accountName, sub, 0, n); else bk.post(ac, ln.accountName, sub, n, 0);
        if(t){ if(inn) bk.post(vat, inn ? 'Output VAT' : 'Input VAT', '', 0, t); else bk.post(vat, 'Input VAT', '', t, 0); } });
      var tot = has(rec.amount) ? num(rec.amount) : sum; var ref = inn ? rec.receivedIn : rec.paidFrom;
      if(inn) bk.bank(ref, tot, 0); else bk.bank(ref, 0, tot);
    } else if(key==='iat'){
      bk.bank(rec.receivedIn, num(rec.amount), 0); bk.bank(rec.paidFrom, 0, num(rec.amount));
    } else if(key==='journal'){
      lines.forEach(function(ln){ var ac = lineAcct(b, ln); var sub = isCashCtl(b, ac) ? lineBank(ln) : (ln.sub || ln.subAccount || '');
        bk.post(ac, ln.accountName, sub, num(ln.debit), num(ln.credit)); });
    } else if(key==='salesInv' || key==='creditNotes' || key==='purchInv' || key==='debitNotes'){
      var sales = (key==='salesInv' || key==='creditNotes'), rev = (key==='creditNotes' || key==='debitNotes');
      var party = sales ? rec.customer : rec.supplier, ctl = findA(b, sales ? 'Accounts receivable' : 'Accounts payable');
      var vat2 = findA(b, sales ? 'Output VAT' : 'Input VAT'), net = 0, tax = 0, any = lines.some(function(ln){ return ln.account || ln.accountName; });
      /* income/expense side: Cr for a sale or debit note, Dr for a purchase or credit note */
      var cr = (sales && !rev) || (!sales && rev);
      if(any){ lines.forEach(function(ln){ var n = lineNet(ln); net += n; tax += lineTax(ln); var ac = lineAcct(b, ln, acctOf(b, rec.account));
          if(cr) bk.post(ac, ln.accountName, '', 0, n); else bk.post(ac, ln.accountName, '', n, 0); }); }
      else { net = has(rec.subtotal) ? num(rec.subtotal) : lines.reduce(function(s, ln){ return s + lineNet(ln); }, 0); tax = lines.reduce(function(s, ln){ return s + lineTax(ln); }, 0);
        var ac0 = acctOf(b, rec.account); if(cr) bk.post(ac0, ac0 ? '' : 'Income', '', 0, net); else bk.post(ac0, ac0 ? '' : 'Expense', '', net, 0); }
      if(has(rec.tax) && !isNaN(Number(rec.tax))) tax = num(rec.tax);
      if(tax){ if(cr) bk.post(vat2, sales ? 'Output VAT' : 'Input VAT', '', 0, tax); else bk.post(vat2, sales ? 'Output VAT' : 'Input VAT', '', tax, 0); }
      var total = has(rec.total) ? num(rec.total) : net + tax;
      if(cr) bk.post(ctl, sales ? 'Accounts receivable' : 'Accounts payable', party || '', total, 0); else bk.post(ctl, sales ? 'Accounts receivable' : 'Accounts payable', party || '', 0, total);
      if(key==='salesInv'){ ['Inventory on hand', 'Inventory - cost'].forEach(function(nm){ var a2 = findA(b, nm); if(!a2) return; scanAcct(b, a2, key, rec).forEach(function(r){ bk.post(a2, nm, '', r.debit, r.credit); }); }); }
    } else {
      /* everything else: whatever the general ledger shows for this document */
      (b.coa||[]).forEach(function(n){ if(n.type!=='account') return; scanAcct(b, n, key, rec).forEach(function(r){ bk.post(n, n.name, '', r.debit, r.credit); }); });
    }
    return bk.rows.map(function(r){ delete r._k; return r; });
  };
  var scanAcct = function(b, acct, key, rec){ var ge = G('glEntries'); if(!ge) return []; var g; try{ g = ge(b, acct.id); }catch(e){ return []; }
    return ((g && g.rows)||[]).filter(function(r){ return r.src===key && sameId(r.id, rec.id); }); };

  /** The double entry of one document. Swappable: a global postingsForRecord(b,key,rec) wins. */
  A.postingsFor = function(b, key, rec){
    if(!b || !rec) return [];
    var eng = G('postingsForRecord');
    if(typeof eng==='function'){ try{ var out = eng(b, key, rec);
      if(Array.isArray(out)) return out.map(function(r){ var ac = r.acctId!=null ? acctOf(b, r.acctId) : (r.account && typeof r.account==='object' ? r.account : null);
        return { account:r.accountName || (ac && ac.name) || String(r.account||''), acctId:ac ? ac.id : (r.acctId||null), sub:r.sub||'', debit:R2(r.debit), credit:R2(r.credit),
          link:r.link || (r.bankId!=null ? { t:'ledger', key:'bankCash', id:r.bankId } : (ac ? { t:'gl', id:ac.id } : null)) }; })
        /* debits first, then credits, each in posting order */
        .map(function(r, i){ return [r, i]; }).sort(function(x, y){ return ((y[0].debit>0) - (x[0].debit>0)) || (x[1] - y[1]); }).map(function(x){ return x[0]; }); }catch(e){} }
    return this._lnDefaultPostings(b, key, rec);
  };

  A._lnTJHtml = function(b, key, rec){
    var self = this, esc = function(s){ return self.esc(s); }, rows = this.postingsFor(b, key, rec), dr = 0, cr = 0;
    rows.forEach(function(r){ dr += r.debit; cr += r.credit; }); dr = R2(dr); cr = R2(cr);
    var link = function(r){ var t = esc(r.account) + (r.sub ? ' <span class="ln-tj-sub">— '+esc(r.sub)+'</span>' : '');
      if(!r.link) return t;
      if(r.link.t==='ledger') return '<a class="led-link" onclick="App.lnOpenLedger(\''+r.link.key+'\','+JSON.stringify(r.link.id).replace(/"/g, '&quot;')+')">'+t+'</a>';
      if(r.link.t==='gl') return '<a class="led-link" onclick="App.lnOpenGL('+JSON.stringify(r.link.id).replace(/"/g, '&quot;')+')">'+t+'</a>';
      return t; };
    var body = rows.length ? rows.map(function(r){ return '<tr><td>'+link(r)+'</td><td class="r m">'+(r.debit ? self.money(r.debit) : '')+'</td><td class="r m">'+(r.credit ? self.money(r.credit) : '')+'</td></tr>'; }).join('')
      : '<tr><td colspan="3" class="ln-tj-empty">This document does not post to the general ledger.</td></tr>';
    /* the ledger engine sends an unbalanced difference to Suspense, so the totals agree: the
       document is still out of balance, by what went to Suspense */
    var isSusp = function(r){ if(r.acctId==='sys_suspense') return true; var n = r.acctId!=null ? acctOf(b, r.acctId) : null; return !!(n && n.suspenseControl); };
    var susp = 0; rows.forEach(function(r){ if(isSusp(r)) susp += r.credit - r.debit; }); susp = R2(susp);
    var bad = rows.length && (Math.abs(dr - cr) >= 0.005 || Math.abs(susp) >= 0.005);
    var wdr = R2(dr - (susp < 0 ? -susp : 0)), wcr = R2(cr - (susp > 0 ? susp : 0));
    return '<div class="ln-tj" id="lnTJ"><div class="ln-tj-h">Transaction Journal</div>'+
      (bad ? '<div class="ln-tj-warn" role="alert">Debits ('+this.money(wdr)+') do not equal credits ('+this.money(wcr)+') — out of balance by '+this.money(Math.abs(wdr - wcr))+'.'+(Math.abs(susp) >= 0.005 ? ' The difference is posted to Suspense.' : '')+'</div>' : '')+
      '<table class="reg-tbl ln-tj-tbl"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>'+body+'</tbody>'+
      (rows.length ? '<tfoot><tr class="ln-tj-tot'+(bad ? ' bad' : '')+'"><td>Total</td><td class="r m">'+this.money(dr)+'</td><td class="r m">'+this.money(cr)+'</td></tr></tfoot>' : '')+
      '</table></div>';
  };
  /* the footer button opens / closes the section in place (it used to open a modal) */
  A.txnJournal = function(){ this._tjOpen = !this._tjOpen; this.renderMain(this.curBiz());
    if(this._tjOpen) setTimeout(function(){ var el = byId('lnTJ'); try{ el && el.scrollIntoView && el.scrollIntoView({ block:'nearest', behavior:'smooth' }); }catch(e){} }, 0); };
  /** Account link inside the journal: open its ledger; ◀ Back returns to the voucher. */
  A.lnOpenLedger = function(key, id){ var label = K2L(key); if(!label) return; this._pushTrail();
    this.recReturn = null; this.histReturn = false; this.wsSection = label; this.ledgerId = id; this.ledgerReturn = null;
    this.ledgerQuery = ''; this.ledgerFrom = ''; this.ledgerTo = ''; this.lPageNum = 1; this.wsMode = 'ledger'; this.renderMain(this.curBiz()); };
  A.lnOpenGL = function(acctId){ this._pushTrail(); this.recReturn = null; this.histReturn = false; this.glAcctId = acctId; this.glTab = 'tx';
    this.ledgerQuery = ''; this.ledgerFrom = ''; this.ledgerTo = ''; this.lPageNum = 1; this.ledgerReturn = null; this.wsMode = 'glledger'; this.renderMain(this.curBiz()); };

  /* View page: origin pager + Transaction Journal section */
  wrap('viewHtml', function(orig, a){
    var html = String(orig.apply(this, a) || ''), b = a[0] || this.curBiz(), key = L2K(this.wsSection);
    var ctx = null; try{ ctx = this._lnLedgerCtx(b); }catch(e){}
    if(ctx && ctx.seq.length){
      var pg = this._lnPagerHtml(ctx);
      if(/<div class="view-pager">[\s\S]*?<\/div>/.test(html)) html = html.replace(/<div class="view-pager">[\s\S]*?<\/div>/, function(){ return pg; });
      else html = html.replace(/(<div class="view-bar">[\s\S]*?)(<\/div>)/, function(m, x, y){ return x + pg + y; });
    }
    if(key && REGc(key) && !PARTY_LEDGER[key]){
      if(html.indexOf('App.txnJournal()')<0) html = html.replace('<div class="form-actions">', function(){ return '<div class="doc-foot"><span style="display:flex;gap:8px"><button class="ftbtn" onclick="App.txnJournal()">Transaction Journal</button></span></div><div class="form-actions">'; });
      if(this._tjOpen){ var rec = (this.records(b)||[]).find(function(r){ return sameId(r.id, A.editingId); });
        if(rec){ var tj = this._lnTJHtml(b, key, rec); var at = html.indexOf('<div class="form-actions">');
          html = at>=0 ? html.slice(0, at) + tj + html.slice(at) : html + tj; } }
      html = html.replace('onclick="App.txnJournal()">Transaction Journal<', function(){ return 'onclick="App.txnJournal()" aria-expanded="'+(A._tjOpen ? 'true' : 'false')+'">'+(A._tjOpen ? 'Hide Transaction Journal' : 'Transaction Journal')+'<'; });
    }
    return html;
  });

  /* ------------------------------------------------------------------ URL state (#b=..&s=..&m=..&id=..&from=..) */
  var MINE = ['b', 's', 'm', 'id', 'led', 'gl', 'from'];
  var readHash = function(){ var h = ''; try{ h = String((global.location && global.location.hash) || ''); }catch(e){} h = h.replace(/^#\/?/, '');
    var o = {}; if(!h) return o; h.split('&').forEach(function(p){ if(!p) return; var i = p.indexOf('='); var k = i<0 ? p : p.slice(0, i), v = i<0 ? '' : p.slice(i+1);
      try{ o[decodeURIComponent(k)] = decodeURIComponent(v); }catch(e){ o[k] = v; } }); return o; };
  A._lnReadHash = readHash;
  var secTok = function(s){ return L2K(s.wsSection) || s.wsSection || ''; };
  A._lnToken = function(s){ var k = L2K(s.wsSection);
    if(s.wsMode==='list' && k) return 'list:'+k;
    if(s.wsMode==='ledger' && k) return 'ledger:'+k+':'+s.ledgerId;
    if(s.wsMode==='glledger') return 'gl:'+s.glAcctId;
    if(s.wsMode==='view' && k) return 'view:'+k+':'+s.editingId;
    if(s.wsMode==='form' && k && s.editingId!=null) return 'edit:'+k+':'+s.editingId;
    return ''; };
  A._lnHashParams = function(){
    if(this.view!=='workspace' || !this.openBiz) return {};
    var o = { b:String(this.openBiz), s:secTok(this), m:this.wsMode };
    if(this.editingId!=null && REC_MODES[this.wsMode]) o.id = String(this.editingId);
    if(this.wsMode==='ledger' && this.ledgerId!=null) o.led = String(this.ledgerId);
    if(this.wsMode==='glledger' && this.glAcctId!=null) o.gl = String(this.glAcctId);
    var self = this; var ch = (this.originStack||[]).map(function(e){ return self._lnToken(e.snap); }).filter(Boolean);
    if(ch.length) o.from = ch.join(',');
    return o; };
  A._lnWriteHash = function(){
    if(!global.history || typeof global.history.replaceState!=='function' || !global.location) return;
    var cur = readHash(), mine = this._lnHashParams(), out = [];
    Object.keys(cur).forEach(function(k){ if(MINE.indexOf(k)<0) out.push(encodeURIComponent(k)+'='+encodeURIComponent(cur[k])); });
    MINE.forEach(function(k){ if(mine[k]!=null && mine[k]!=='') out.push(k+'='+encodeURIComponent(mine[k]).replace(/%3A/g, ':').replace(/%2C/g, ',')); });
    var h = out.length ? '#'+out.join('&') : '';
    var now = String(global.location.hash||''); if(now===h || (!h && (now==='' || now==='#'))) return;
    try{ global.history.replaceState(global.history.state, '', String(global.location.pathname||'') + String(global.location.search||'') + (h || '')); }catch(e){}
  };
  wrap('go', function(orig, a){ var r = orig.apply(this, a); try{ if(this.view!=='workspace') this._lnWriteHash(); }catch(e){} return r; });

  /** Snapshot for a hash token. */
  A._lnSnapFor = function(b, tok, below){
    var p = String(tok||'').split(':'), kind = p[0], key = p[1], idS = p[2];
    var base = { view:'workspace', wsSub:null, setView:null, fmtCat:null, fmtForm:null, repView:null, editingId:null, ledgerId:null, glAcctId:null, glTab:'tx',
      statementReturn:null, ledgerReturn:null, glReturn:null, navTrail:[], originStack:(below||[]).slice(), listQuery:'', pageNum:1, lPageNum:1,
      ledgerQuery:'', ledgerFrom:'', ledgerTo:'', _tjOpen:false };
    var findRec = function(k, id){ return (((b.records||{})[k])||[]).find(function(r){ return sameId(r.id, id); }); };
    if(kind==='gl'){ var ac = (b.coa||[]).find(function(n){ return sameId(n.id, key); }); if(!ac) return null;
      return Object.assign(base, { wsMode:'glledger', wsSection:'Summary', glAcctId:ac.id }); }
    var label = K2L(key); if(!label) return null;
    if(kind==='list') return Object.assign(base, { wsMode:'list', wsSection:label });
    var rec = findRec(key, idS); if(!rec) return null;
    if(kind==='ledger'){ var listSnap = Object.assign({}, base, { wsMode:'list', wsSection:label, originStack:[] });
      return Object.assign(base, { wsMode:'ledger', wsSection:label, ledgerId:rec.id, navTrail:[{ label:label, snap:listSnap }] }); }
    if(kind==='view') return Object.assign(base, { wsMode:'view', wsSection:label, editingId:rec.id });
    if(kind==='edit') return Object.assign(base, { wsMode:'form', wsSection:label, editingId:rec.id });
    return null;
  };
  /** Re-open the page in location.hash (after login / refresh). Returns true when it did. */
  A.lnRestoreFromHash = function(){
    /* the hash as the page was loaded: going to the Businesses page during login rewrites it */
    var h = this._lnBootHash || readHash(); this._lnBootHash = null; if(!h.b) return false;
    var all = (typeof DB!=='undefined') ? (DB.get(DB.k.biz, [])||[]) : [];
    var biz = all.find(function(x){ return sameId(x.id, h.b); }); if(!biz) return false;
    this.openBusiness(biz.id); if(!sameId(this.openBiz, biz.id) || this.view!=='workspace') return false;
    var b = this.curBiz(), self = this, stack = [];
    String(h.from||'').split(',').filter(Boolean).forEach(function(t){ var s = self._lnSnapFor(b, t, stack); if(s) stack = stack.concat([{ snap:s, scroll:0 }]); });
    var cur = null, s = h.s || '', m = h.m || '';
    if(m==='ledger') cur = this._lnSnapFor(b, 'ledger:'+s+':'+h.led, stack);
    else if(m==='glledger') cur = this._lnSnapFor(b, 'gl:'+h.gl, stack);
    else if(m==='view') cur = this._lnSnapFor(b, 'view:'+s+':'+h.id, stack);
    else if(m==='form' && h.id) cur = this._lnSnapFor(b, 'edit:'+s+':'+h.id, stack);
    if(cur){ if(REC_MODES[cur.wsMode]){ var led = stack.filter(function(e){ return e.snap.wsMode==='ledger'; })[0]; cur.navTrail = led ? led.snap.navTrail.slice().concat([]) : []; }
      this._restoreNav(cur); this.renderSidebar(b); return true; }
    var label = K2L(s) || (['Summary', 'Dashboard', 'Reports', 'Settings'].indexOf(s)>=0 ? s : null);
    if(label && label!=='Summary'){ this.selectSection(label); return true; }
    return false;
  };
  var boot = readHash(); A._lnBootHash = boot.b ? boot : null;
  wrap('enterApp', function(orig, a){ var r = orig.apply(this, a); try{ this.lnRestoreFromHash(); }catch(e){} return r; });
  /* login may already have finished before this file loaded */
  try{ var appEl = byId('app'); if(A._lnBootHash && A.view==='businesses' && appEl && appEl.classList && !appEl.classList.contains('hide')) A.lnRestoreFromHash(); }catch(e){}
})(typeof window !== 'undefined' ? window : this);
