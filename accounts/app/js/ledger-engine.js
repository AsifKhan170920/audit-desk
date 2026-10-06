/* ===================== General ledger engine (double entry) =====================
   ONE general ledger for the whole business. Every document is turned into a
   balanced set of postings  { acct, sub, debit, credit, date, ref, src, id, type }
   and every balance in the app is read back from those postings:

     Summary / Balance Sheet / P&L / Trial Balance  -> GL.balance(b, acctId, {from,to})
     account ledgers (General Ledger Transactions)   -> GL.entries(b, acctId)
     bank, customer, supplier, employee ... balances -> GL.subBalance(b, acctId, name)

   so they can never disagree again. Rules (as in Manager.io):

   - each document posts Dr = Cr. If its own figures do not balance (an unbalanced
     journal, a receipt whose lines do not add up to the amount, a line without an
     account, a control account without a sub-account) the difference goes to
     Suspense — never silently dropped, never a plug on the balance sheet.
   - starting balances (bank, customer, supplier, employee, capital, inventory,
     fixed / intangible assets, investments, special accounts, chart-of-accounts
     opening amounts) post against "Starting balance equity", which therefore only
     ever shows real starting balances.
   - postings with no date are starting balances: they belong to every "as at"
     balance and to no period's profit and loss.

   System accounts the postings need (Input VAT, Suspense, Accounts payable, ...)
   are added to the chart of accounts on first use with fixed ids ("sys_..."), so
   adding them is lossless and idempotent.
   ================================================================================ */
var GL = (function(){
  'use strict';

  function num(v){ if(v==null||v==='') return 0; if(typeof v==='number') return isFinite(v)?v:0;
    var n=parseFloat(String(v).replace(/,/g,'').replace(/\s/g,'')); return isNaN(n)?0:n; }
  function blank(v){ return v==null || String(v).trim()===''; }
  function r2(v){ return Math.round(((Number(v)||0)+(v>=0?1e-9:-1e-9))*100)/100; }
  function today(){ var d=new Date(); var p=function(n){ return (n<10?'0':'')+n; }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function day(v){ return String(v||'').slice(0,10); }
  function lc(s){ return String(s||'').trim().toLowerCase(); }
  /** numeric tag of a reverse-charge tax code (stored rcTag, else a hash of its name) */
  function rcTagOf(t){ if(!t) return ''; if(!blank(t.rcTag)) return String(t.rcTag); var h=5381, s=String(t.name||''); for(var i=0;i<s.length;i++){ h=((h*33)^s.charCodeAt(i))>>>0; } return String(h%1000000000); }

  /* ------------------------------------------------------------ chart helpers */
  function accounts(b){ return ((b&&b.coa)||[]).filter(function(n){ return n && n.type==='account'; }); }
  function byId(b,id){ if(id==null||id==='') return null; var c=(b&&b.coa)||[]; for(var i=0;i<c.length;i++){ if(c[i]&&c[i].id===id&&c[i].type==='account') return c[i]; } return null; }
  function byName(b,name){ var t=lc(name); if(!t) return null; var c=accounts(b); for(var i=0;i<c.length;i++){ if(lc(c[i].name)===t) return c[i]; } return null; }

  /* Where a system account is created when the business does not have it yet. */
  var SYS = {
    'starting balance equity':      { id:'sys_sbe',        name:'Starting balance equity',      parent:'equity',      flags:{ control:1, sbeControl:1 } },
    'suspense':                     { id:'sys_suspense',   name:'Suspense',                     parent:'equity',      flags:{ suspenseControl:1 } },
    'accounts receivable':          { id:'sys_ar',         name:'Accounts receivable',          parent:'assets',      flags:{ control:1, arControl:1 } },
    'accounts payable':             { id:'sys_ap',         name:'Accounts payable',             parent:'liabilities', flags:{ control:1, apControl:1 } },
    'cash & cash equivalents':      { id:'sys_cash',       name:'Cash & cash equivalents',      parent:'assets',      flags:{ control:1, cashControl:1 } },
    'output vat':                   { id:'sys_output_vat', name:'Output VAT',                   parent:'liabilities', flags:{ control:1 }, near:'input vat' },
    'input vat':                    { id:'sys_input_vat',  name:'Input VAT',                    parent:'liabilities', flags:{ control:1 }, near:'output vat' },
    'employee clearing account':    { id:'sys_emp',        name:'Employee clearing account',    parent:'liabilities', flags:{ control:1 } },
    'capital accounts':             { id:'sys_capital',    name:'Capital accounts',             parent:'equity',      flags:{ control:1, capControl:1 } },
    'inventory on hand':            { id:'sys_inv',        name:'Inventory on hand',            parent:'assets',      flags:{ control:1 } },
    'inventory - cost':             { id:'sys_inv_cost',   name:'Inventory - cost',             parent:'@expense' },
    'inventory - sales':            { id:'sys_inv_sales',  name:'Inventory - sales',            parent:'@income' },
    'expense claims':               { id:'sys_claims',     name:'Expense claims',               parent:'liabilities', flags:{ control:1 } },
    'fixed assets, at cost':        { id:'sys_fa_cost',    name:'Fixed assets, at cost',        parent:'assets',      flags:{ control:1 } },
    'fixed assets, accumulated depreciation': { id:'sys_fa_dep', name:'Fixed assets, accumulated depreciation', parent:'assets', flags:{ control:1 } },
    'depreciation':                 { id:'sys_depr',       name:'Depreciation',                 parent:'@expense' },
    'intangible assets, at cost':   { id:'sys_ia_cost',    name:'Intangible assets, at cost',   parent:'assets',      flags:{ control:1 } },
    'intangible assets, accumulated amortization': { id:'sys_ia_amort', name:'Intangible assets, accumulated amortization', parent:'assets', flags:{ control:1 } },
    'amortization':                 { id:'sys_amort',      name:'Amortization',                 parent:'@expense' },
    'investments':                  { id:'sys_invest',     name:'Investments',                  parent:'assets',      flags:{ control:1 } },
    'investment gains (losses)':    { id:'sys_invest_gain',name:'Investment gains (losses)',    parent:'@income' },
    'withholding tax receivable':   { id:'sys_wht',        name:'Withholding tax receivable',   parent:'assets' },
    'withholding tax payable':      { id:'sys_wht_pay',    name:'Withholding tax payable',      parent:'liabilities' },
    'billable time':                { id:'sys_bt',         name:'Billable time',                parent:'assets',      flags:{ control:1 } },
    'billable time - movement':     { id:'sys_bt_move',    name:'Billable time - movement',     parent:'@income' },
    'billable time - write-offs':   { id:'sys_bt_wo',      name:'Billable time - write-offs',   parent:'@expense' },
    'inventory write-offs':         { id:'sys_inv_wo',     name:'Inventory write-offs',         parent:'@expense' },
    'production in progress':       { id:'sys_prod',      name:'Production in progress',       parent:'@expense' },
    'salaries':                     { id:'sys_salaries',   name:'Salaries',                     parent:'@expense' },
    'special accounts':             { id:'sys_special',    name:'Special accounts',             parent:'assets',      flags:{ control:1 } }
  };
  /* the P&L group a new income / expense account goes in (created if missing) */
  function plGroup(b,kind){
    var c=b.coa||(b.coa=[]);
    var id=null;
    for(var i=0;i<c.length;i++){ if(c[i]&&c[i].type==='group'&&c[i].parent==='pl'&&c[i].plkind===kind){ id=c[i].id; break; } }
    if(!id){ id='sys_g_'+kind; if(!c.some(function(n){ return n&&n.id===id; })) c.push({id:id,type:'group',name:kind==='income'?'Income':'Expenses',code:'',parent:'pl',plkind:kind}); }
    /* always listed in the P&L order, also a group made earlier that was dropped from the list */
    b.coaTop=b.coaTop||{bs:['assets','liabilities','equity'],pl:[]}; b.coaTop.pl=b.coaTop.pl||[];
    if(b.coaTop.pl.indexOf(id)<0){ var ti=b.coaTop.pl.findIndex(function(x){ var n=c.find(function(y){ return y.id===x; }); return n&&n.type==='total'; });
      if(ti<0) b.coaTop.pl.push(id); else b.coaTop.pl.splice(ti,0,id); }
    return id;
  }
  /** Find a system account by name; create it (fixed id) when `create` is set. */
  function sysAcct(b,key,create){
    var k=lc(key), def=SYS[k]; var n=byName(b, def?def.name:key);
    if(!n && k==='salaries'){ n=accounts(b).filter(function(a){ return /^salar/i.test(a.name||'') && acctRootSafe(b,a)==='expense'; })[0]||null; }
    if(!n && k==='depreciation'){ n=byName(b,'Depreciation expense'); }
    if(!n && k==='amortization'){ n=byName(b,'Amortization expense'); }
    if(n){ if(def&&def.flags) Object.keys(def.flags).forEach(function(f){ if(!n[f]) n[f]=def.flags[f]; }); return n; }
    if(!create || !def) return null; if(!b.coa) b.coa=[];
    var parent=def.parent;
    if(parent==='@expense') parent=plGroup(b,'expense'); else if(parent==='@income') parent=plGroup(b,'income');
    else if(def.near){ var sib=byName(b,SYS[def.near].name); if(sib) parent=sib.parent; }
    var ex=(b.coa||[]).filter(function(x){ return x&&x.id===def.id; })[0];
    if(ex){ return ex; }
    n={id:def.id,type:'account',name:def.name,code:'',parent:parent,balance:0,sys:1};
    if(def.flags) Object.keys(def.flags).forEach(function(f){ n[f]=def.flags[f]; });
    b.coa.push(n); return n;
  }
  function acctRootSafe(b,n){ try{ return acctRoot(b,n); }catch(e){ return 'assets'; } }
  /* FIX_SPEC_5 A3: the balance-sheet accounts of "Recovery" payslip deduction items (Employee loans,
     Salary advances ...) are tracked per employee: their postings keep the employee as sub-account.
     A deduction item without a type is a recovery when its account is an asset. {acctId: 1} */
  function recoveryAccts(b){ var o={}; ((b&&b.payslipItems&&b.payslipItems.deductions)||[]).forEach(function(it){
      if(!it||blank(it.account)) return; var n=byId(b,it.account); if(!n||n.control) return;
      var t=it.type==='recovery'||it.type==='salary'?it.type:(acctRootSafe(b,n)==='assets'?'recovery':'salary');
      if(t==='recovery') o[n.id]=1; }); return o; }
  function empSubAcct(b,id){ return !!recoveryAccts(b)[id]; }
  function natureD(b,n){ var r=acctRootSafe(b,n); return r==='assets'||r==='expense'; }

  /* which register a control account's sub-accounts come from */
  function subKind(b,n){ if(!n) return null; var nm=lc(n.name);
    if(n.cashControl || nm==='cash & cash equivalents') return 'bankCash';
    if(n.arControl || nm==='accounts receivable') return 'customers';
    if(n.apControl || nm==='accounts payable') return 'suppliers';
    if(nm==='capital accounts') return 'capital';
    if(nm==='employee clearing account') return 'employees';
    if(nm==='inventory on hand') return 'inventory';
    if(nm==='fixed assets, at cost' || nm==='fixed assets, accumulated depreciation') return 'fixedAssets';
    if(nm==='intangible assets, at cost' || nm==='intangible assets, accumulated amortization') return 'intangibles';
    if(nm==='investments') return 'investments';
    if(nm==='expense claims') return 'claimPayer';
    if(nm==='special accounts') return 'special';
    return null; }

  function bankOf(b,ref){ if(blank(ref)) return null; var L=((b.records||{}).bankCash)||[];
    for(var i=0;i<L.length;i++){ if(L[i] && L[i].name===ref) return L[i]; }
    var head=String(ref).split(' - ')[0].trim(); for(var j=0;j<L.length;j++){ if(L[j] && L[j].name===head) return L[j]; }
    var t=lc(ref); for(var k=0;k<L.length;k++){ if(L[k] && lc(L[k].name)===t) return L[k]; }
    return null; }

  function itemRec(b,name){ if(blank(name)) return null; var R=b.records||{};
    var i=(R.inventory||[]).filter(function(x){ return x&&x.name===name; })[0]; if(i) return {inv:1,rec:i};
    var n=(R.nonInvItems||[]).filter(function(x){ return x&&x.name===name; })[0]; if(n) return {inv:0,rec:n};
    return null; }

  /** Resolve a stored line's account (id, or a name kept by older forms). */
  function lineAcct(b,ln){ if(!ln) return null;
    var n=byId(b,ln.account); if(n) return n;
    var nm=!blank(ln.accountName)?ln.accountName:(!blank(ln.accounts)?ln.accounts:(typeof ln.account==='string'?ln.account:''));
    return byName(b,nm); }
  function lineSub(ln){ return !blank(ln&&ln.sub) ? String(ln.sub) : (!blank(ln&&ln.subAccount) ? String(ln.subAccount) : ''); }
  /* net (before tax), tax and gross of an invoice-style or cash line */
  function lineNums(ln){
    var tax=num(ln.taxAmt!=null&&ln.taxAmt!==''?ln.taxAmt:ln.taxAmount);
    var gross, net;
    var hasNet=ln.net!=null&&ln.net!=='', hasANT=ln.amountNoTax!=null&&ln.amountNoTax!=='';
    var hasAmt=ln.amount!=null&&ln.amount!=='', hasTWT=ln.totalWithTax!=null&&ln.totalWithTax!=='';
    if(hasNet) net=num(ln.net); else if(hasANT) net=num(ln.amountNoTax);
    if(hasAmt) gross=num(ln.amount); else if(hasTWT) gross=num(ln.totalWithTax);
    if(net==null && gross==null){ var q=blank(ln.qty)?1:num(ln.qty); net=q*num(ln.price); gross=net+tax; }
    else if(net==null) net=gross-tax; else if(gross==null) gross=net+tax;
    /* a designed journal / claim line keeps amount but no tax: trust amount */
    if(Math.abs(gross-net-tax)>0.005){ if(!tax) net=gross; else gross=net+tax; }
    return { net:net, tax:tax, gross:gross };
  }

  /* ------------------------------------------------------------- the build */
  function build(b){
    if(!b) return { lines:[], txs:[], issues:[] };
    try{ if(typeof normalizeLineSubs==='function') normalizeLineSubs(b); }catch(e){}
    var R=b.records||{}, lines=[], txs=[], issues=[];
    var SBE='@sbe', SUSP='@susp';            // placeholders, mapped to real accounts at the end
    var placeholders={};
    var EMPSUB=recoveryAccts(b);             // FIX_SPEC_5 A3: loan / advance accounts keep the employee as sub-account
    function need(key){ var n=sysAcct(b,key,false); if(n) return n.id; var ph='@'+lc(key); placeholders[ph]=key; return ph; }
    function nameOfId(id){ if(id===SBE) return 'Starting balance equity'; if(id===SUSP) return 'Suspense'; if(placeholders[id]) return SYS[lc(placeholders[id])]?SYS[lc(placeholders[id])].name:placeholders[id]; var n=byId(b,id); return n?n.name:id; }

    /** Post one balanced transaction. ents: [{a:acctId, s:sub, v:+debit/-credit, t?:type, why?:issue}] */
    function post(meta, ents){
      var sum=0, tx={ src:meta.src||'', id:meta.id, ref:meta.ref||'', date:day(meta.date), type:meta.type||'', lines:[], imbalance:0, problems:[] };
      ents.forEach(function(e){ var v=r2(e.v); if(!v) return; var a=e.a;
        if(!a){ a=SUSP; tx.problems.push(e.why||'line without an account'); }
        sum=r2(sum+v);
        var L={ acct:a, sub:e.s||'', debit:v>0?v:0, credit:v<0?-v:0, date:tx.date, ref:tx.ref, src:tx.src, id:tx.id,
                type:e.t||meta.type||'', party:meta.party||'', desc:e.d||meta.desc||'' };
        tx.lines.push(L); });
      if(Math.abs(sum)>0.005){ tx.imbalance=sum; tx.problems.push('debits and credits differ by '+Math.abs(sum).toFixed(2));
        tx.lines.push({ acct:SUSP, sub:'', debit:sum<0?-sum:0, credit:sum>0?sum:0, date:tx.date, ref:tx.ref, src:tx.src, id:tx.id,
                        type:(meta.type||'')+' — out of balance', party:meta.party||'', desc:'' }); }
      tx.lines.forEach(function(L){ lines.push(L); });
      txs.push(tx);
      if(tx.problems.length) issues.push({ src:tx.src, id:tx.id, ref:tx.ref, date:tx.date, type:meta.type||'', problems:tx.problems.slice(), suspense:r2(tx.lines.filter(function(L){ return L.acct===SUSP; }).reduce(function(s,L){ return s+L.debit-L.credit; },0)) });
      return tx;
    }
    /** an entry for a line account: control accounts need a sub-account, else Suspense */
    function acctEnt(n, sub, v, extra){ extra=extra||{};
      if(!n) return { a:null, v:v, t:extra.t, d:extra.d, why:'line without an account' };
      var kind=subKind(b,n);
      if(kind){
        if(blank(sub)){ return { a:null, v:v, t:extra.t, d:extra.d, why:'"'+n.name+'" needs a '+(kind==='bankCash'?'bank or cash account':'sub-account') }; }
        if(kind==='bankCash'){ var bk=bankOf(b,sub); if(!bk) return { a:null, v:v, t:extra.t, why:'unknown bank account "'+sub+'"' }; sub=bk.name; }
      }
      return { a:n.id, s:kind?sub:(EMPSUB[n.id]&&!blank(sub)?String(sub):''), v:v, t:extra.t, d:extra.d };
    }
    function bankEnt(ref, v, t){ var bk=bankOf(b,ref);
      if(!bk) return { a:null, v:v, t:t, why:blank(ref)?'no bank or cash account selected':'unknown bank account "'+ref+'"' };
      return { a:need('cash & cash equivalents'), s:bk.name, v:v, t:t }; }
    function itemAcct(itemName, purchase){ var it=itemRec(b,itemName); if(!it) return null;
      if(it.inv) return byId(b,need(purchase?'inventory on hand':'inventory - sales'))||{ id:need(purchase?'inventory on hand':'inventory - sales'), name:purchase?'Inventory on hand':'Inventory - sales' };
      var id=purchase?it.rec.purchaseAccount:it.rec.salesAccount; return byId(b,id)||byName(b,id); }
    /* resolve a document line: account, sub (an inventory item is the sub of Inventory on hand) */
    function docLineEnt(ln, purchase, sign, typ){
      var n=lineAcct(b,ln), sub=lineSub(ln), it=itemRec(b,ln.item||ln.items);
      if(it && it.inv && purchase){ n={ id:need('inventory on hand'), name:'Inventory on hand' }; sub=it.rec.name; }
      if(!n && !blank(ln.item||ln.items)) n=itemAcct(ln.item||ln.items, purchase);
      if(n && /^inventory on hand$/i.test(n.name||'') && blank(sub) && it && it.inv) sub=it.rec.name;
      var x=lineNums(ln);
      if(n && placeholders[n.id]) return { a:n.id, s:sub, v:sign*x.net, t:typ };
      return acctEnt(n && (byId(b,n.id)||n), sub, sign*x.net, { t:typ });
    }
    var OUT=function(){ return need('output vat'); }, INP=function(){ return need('input vat'); };
    /* the tax code a line refers to: by name, or (designed forms, whose tax value must stay numeric) a
       reverse-charge code by its tag "0e<tag>" — a value that still reads as 0 % */
    function lineTaxCode(ln){ if(!ln) return null; var codes=b.taxCodes||[];
      var cands=[ln.taxCode, ln.tax, ln.taxRate].filter(function(v){ return !blank(v); }).map(String);
      for(var i=0;i<cands.length;i++){ var m=/^0e(\d+)$/.exec(cands[i]);
        for(var j=0;j<codes.length;j++){ var c=codes[j]; if(!c) continue; if(c.name===cands[i] || (m && c.reverse && rcTagOf(c)===m[1])) return c; } }
      return null; }
    /* tax goes to the tax code's own account when it has one, else to Output / Input VAT */
    function taxAcct(ln, dflt){ var tc=lineTaxCode(ln); var n=tc&&!blank(tc.account)?byId(b,tc.account):null; return n?n.id:dflt(); }
    /* reverse charge (UAE imports / RCM): the buyer accounts for the VAT itself, so the same amount is
       posted to Input VAT (Dr) and Output VAT (Cr) — net zero, nothing added to the document total */
    function rcPush(ents, ln, signedNet, typ){ var tc=lineTaxCode(ln); if(!tc||!tc.reverse) return;
      var rate=num(tc.rcRate!=null&&tc.rcRate!==''?tc.rcRate:tc.rate); var v=r2(signedNet*rate/100); if(!v) return;
      ents.push({ a:INP(), v:v, t:typ+' — reverse charge' }, { a:OUT(), v:-v, t:typ+' — reverse charge' }); }

    /* ---------- starting balances ---------- */
    accounts(b).forEach(function(n){ var v=num(n.balance); if(!v||subKind(b,n)==='bankCash') return;   /* bank accounts carry the cash control account's opening */
      var dv=natureD(b,n)?v:-v;
      post({ src:'coa', id:n.id, date:'', type:'Starting balance — '+(n.name||'') }, [ { a:n.id, s:'', v:dv }, { a:SBE, v:-dv } ]); });
    (R.bankCash||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'bankCash', id:r.id, date:'', type:'Starting balance — '+r.name }, [ { a:need('cash & cash equivalents'), s:r.name, v:v }, { a:SBE, v:-v } ]); });
    (R.customers||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'customers', id:r.id, date:'', type:'Starting balance — '+r.name, party:r.name }, [ { a:need('accounts receivable'), s:r.name, v:v }, { a:SBE, v:-v } ]); });
    (R.suppliers||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'suppliers', id:r.id, date:'', type:'Starting balance — '+r.name, party:r.name }, [ { a:need('accounts payable'), s:r.name, v:-v }, { a:SBE, v:v } ]); });
    (R.employees||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'employees', id:r.id, date:'', type:'Starting balance — '+r.name, party:r.name }, [ { a:need('employee clearing account'), s:r.name, v:-v }, { a:SBE, v:v } ]); });
    (R.capital||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'capital', id:r.id, date:'', type:'Starting balance — '+r.name, party:r.name }, [ { a:need('capital accounts'), s:r.name, v:-v }, { a:SBE, v:v } ]); });
    (R.special||[]).forEach(function(r){ var v=num(r.balance); if(!v||!r.name) return;
      post({ src:'special', id:r.id, date:'', type:'Starting balance — '+r.name, party:r.name }, [ { a:need('special accounts'), s:r.name, v:v }, { a:SBE, v:-v } ]); });
    (R.fixedAssets||[]).forEach(function(r){ var c=num(r.cost), d=num(r.accumDep); if(!r.name||(!c&&!d)) return;
      post({ src:'fixedAssets', id:r.id, date:'', type:'Starting balance — '+r.name }, [ { a:need('fixed assets, at cost'), s:r.name, v:c }, { a:need('fixed assets, accumulated depreciation'), s:r.name, v:-d }, { a:SBE, v:-(c-d) } ]); });
    (R.intangibles||[]).forEach(function(r){ var c=num(r.cost), d=num(r.accumAmort); if(!r.name||(!c&&!d)) return;
      post({ src:'intangibles', id:r.id, date:'', type:'Starting balance — '+r.name }, [ { a:need('intangible assets, at cost'), s:r.name, v:c }, { a:need('intangible assets, accumulated amortization'), s:r.name, v:-d }, { a:SBE, v:-(c-d) } ]); });
    (R.investments||[]).forEach(function(r){ var c=num(r.cost); if(!r.name||!c) return;
      post({ src:'investments', id:r.id, date:'', type:'Starting balance — '+r.name }, [ { a:need('investments'), s:r.name, v:c }, { a:SBE, v:-c } ]); });

    /* ---------- inventory: opening value + cost movements ---------- */
    var invMoves={};
    (R.inventory||[]).forEach(function(it){ if(!it||!it.name) return; var m;
      try{ m=invItemMovements(b,it); }catch(e){ m=null; } if(!m) return; invMoves[it.name]=m;
      var open=m.rows[0]?num(m.rows[0].cin):0;
      if(open) post({ src:'inventory', id:it.id, date:'', type:'Starting balance — '+it.name }, [ { a:need('inventory on hand'), s:it.name, v:open }, { a:SBE, v:-open } ]); });

    /* ---------- receipts & payments ---------- */
    function cashDoc(r, key){
      var rec=key==='receipts', dir=rec?1:-1;
      var lns=(r.lines&&r.lines.length)?r.lines.filter(function(l){ return l; }):[{ account:r.account, sub:r.sub, amount:r.amount }];
      var party=rec?(r.paidBy||''):(r.payee||'');
      var typ=(rec?'Receipt':'Payment')+(party?' — '+party:'');
      var ents=[], gross=0;
      lns.forEach(function(ln){ var x=lineNums(ln); if(!x.gross&&!x.net) return; gross+=x.gross;
        var n=lineAcct(b,ln), sub=lineSub(ln);
        if(n && /^inventory on hand$/i.test(n.name||'') && blank(sub) && !blank(ln.item)) sub=ln.item;
        var e=acctEnt(n, sub, -dir*x.net, { t:typ, d:ln.desc||ln.description||'' }); ents.push(e);
        if(x.tax) ents.push({ a:taxAcct(ln, rec?OUT:INP), v:-dir*x.tax, t:typ });
        if(!rec) rcPush(ents, ln, -dir*x.net, typ); });
      var amt=(r.amount!=null&&r.amount!=='')?num(r.amount):(r.total!=null&&r.total!==''?num(r.total):gross);
      ents.push(bankEnt(rec?r.receivedIn:r.paidFrom, dir*amt, typ));
      post({ src:key, id:r.id, date:r.date, ref:r.reference, type:typ, party:party, desc:r.description }, ents);
    }
    (R.receipts||[]).forEach(function(r){ if(r) cashDoc(r,'receipts'); });
    (R.payments||[]).forEach(function(r){ if(r) cashDoc(r,'payments'); });
    (R.iat||[]).forEach(function(t){ if(!t) return; var v=num(t.amount); if(!v) return;
      post({ src:'iat', id:t.id, date:t.date, ref:t.reference, type:'Inter account transfer', desc:t.description },
        [ bankEnt(t.receivedIn, v, 'Transfer in'+(t.paidFrom?' — from '+t.paidFrom:'')), bankEnt(t.paidFrom, -v, 'Transfer out'+(t.receivedIn?' — to '+t.receivedIn:'')) ]); });

    /* ---------- journal entries ---------- */
    (R.journal||[]).forEach(function(j){ if(!j) return; var ents=[], typ='Journal entry'+(j.narration?' — '+j.narration:'');
      (j.lines||[]).forEach(function(ln){ if(!ln) return; var d=num(ln.debit), c=num(ln.credit); if(!d&&!c) return;
        var n=lineAcct(b,ln), sub=lineSub(ln);
        if(n && /^inventory on hand$/i.test(n.name||'') && blank(sub) && !blank(ln.item)) sub=ln.item;
        ents.push(acctEnt(n, sub, d-c, { t:typ, d:ln.desc||ln.description||'' })); });
      post({ src:'journal', id:j.id, date:j.date||j.issueDate, ref:j.reference, type:typ, desc:j.narration||j.description }, ents); });

    /* ---------- sales / purchase documents ---------- */
    function invoiceDoc(inv, key, partyField, ctrlKey, purchase, sign, label){
      var party=inv[partyField]||inv.custName||inv.supName||'';
      var typ=label+(party?' — '+party:''); var ents=[], lns=(inv.lines||[]).filter(function(l){ return l; }), taxSum=0;
      var anyAcct=lns.some(function(l){ return lineAcct(b,l) || !blank(l.item||l.items); });
      var dfltTax=purchase?INP:OUT, taxBy={}, taxOrder=[];
      var addTax=function(a,v){ if(!(a in taxBy)){ taxBy[a]=0; taxOrder.push(a); } taxBy[a]+=v; };
      if(lns.length && anyAcct){ lns.forEach(function(ln){ var x=lineNums(ln); if(!x.net&&!x.tax) return;
          ents.push(docLineEnt(ln, purchase, -sign, typ)); taxSum+=x.tax; if(x.tax) addTax(taxAcct(ln,dfltTax), x.tax);
          if(purchase) rcPush(ents, ln, -sign*x.net, typ); }); }
      else { var n=byId(b,inv.account)||byName(b,inv.account); var sub=num(inv.subtotal!=null&&inv.subtotal!==''?inv.subtotal:(num(inv.total)-num(inv.tax)));
        ents.push(acctEnt(n,'',-sign*sub,{t:typ})); taxSum=num(inv.tax); if(taxSum) addTax(dfltTax(), taxSum); }
      if(Math.abs(taxSum)>0.0049) taxOrder.forEach(function(a){ if(Math.abs(taxBy[a])>0.0049) ents.push({ a:a, v:-sign*taxBy[a], t:typ }); });
      var tot=(inv.total!=null&&inv.total!=='')?num(inv.total):-sign*ents.reduce(function(s,e){ return s+(Number(e.v)||0); },0);
      ents.push(blank(party) ? { a:null, v:sign*tot, t:typ, why:'no '+(purchase?'supplier':'customer')+' selected' } : { a:need(ctrlKey), s:party, v:sign*tot, t:typ });
      /* withholding tax deducted on the invoice itself: receivable from the authority, not the customer */
      if(!purchase && key==='salesInv' && inv.withholding && num(inv.withholdingAmt||inv.whtAmount) && !blank(party)){
        var w=num(inv.withholdingAmt||inv.whtAmount); ents.push({ a:need('withholding tax receivable'), v:w, t:'Withholding tax — '+party }, { a:need('accounts receivable'), s:party, v:-w, t:'Withholding tax — '+party }); }
      /* purchase side: the withheld part is owed to the tax authority, not the supplier */
      if(purchase && key==='purchInv' && inv.withholding && num(inv.withholdingAmt||inv.whtAmount) && !blank(party)){
        var wp=num(inv.withholdingAmt||inv.whtAmount); ents.push({ a:need('accounts payable'), s:party, v:wp, t:'Withholding tax — '+party }, { a:need('withholding tax payable'), v:-wp, t:'Withholding tax — '+party }); }
      post({ src:key, id:inv.id, date:inv.issueDate||inv.date, ref:inv.reference, type:typ, party:party, desc:inv.description }, ents);
    }
    (R.salesInv||[]).forEach(function(i){ if(i) invoiceDoc(i,'salesInv','customer','accounts receivable',false,1,'Sales invoice'); });
    (R.creditNotes||[]).forEach(function(i){ if(i) invoiceDoc(i,'creditNotes','customer','accounts receivable',false,-1,'Credit note'); });
    (R.purchInv||[]).forEach(function(i){ if(i) invoiceDoc(i,'purchInv','supplier','accounts payable',true,-1,'Purchase invoice'); });
    (R.debitNotes||[]).forEach(function(i){ if(i) invoiceDoc(i,'debitNotes','supplier','accounts payable',true,1,'Debit note'); });

    /* ---------- withholding tax receipts ---------- */
    (R.whtReceipts||[]).forEach(function(w){ if(!w) return; var v=num(w.amount); if(!v) return; var c=w.customer||w.custName||'';
      var typ='Withholding tax receipt'+(c?' — '+c:'');
      post({ src:'whtReceipts', id:w.id, date:w.date, ref:w.reference, type:typ, party:c, desc:w.description },
        [ { a:need('withholding tax receivable'), v:v, t:typ }, blank(c)?{ a:null, v:-v, why:'no customer selected' }:{ a:need('accounts receivable'), s:c, v:-v, t:typ } ]); });

    /* ---------- late payment fees ---------- */
    try{ var lf=b.lateFees||{}; var lfa=lf.enabled&&lf.account?byId(b,lf.account):null;
      if(lfa) (R.salesInv||[]).forEach(function(i){ var f=lateFeeFor(b,i); if(!f||blank(i.customer)) return;
        post({ src:'salesInv', id:i.id, date:today(), ref:i.reference, type:'Late payment fee — '+i.customer, party:i.customer },
          [ { a:need('accounts receivable'), s:i.customer, v:f }, { a:lfa.id, v:-f } ]); }); }catch(e){}

    /* ---------- payslips: earnings to salaries, net pay owed to the employee ---------- */
    /* FIX_SPEC_4 #3: the payslips of a posted payroll run post as ONE journal entry per run (js/payroll.js registers
       the 'payroll' source below), so they are skipped here; a payslip on its own posts as before */
    var payRunSrc=SOURCES.some(function(S){ return S.id==='payroll'; }), postedRun={};
    if(payRunSrc) (R.payroll||[]).forEach(function(r){ if(r&&r.state==='posted'&&r.id!=null) postedRun[String(r.id)]=1; });
    (R.payslips||[]).forEach(function(p){ if(!p) return; var rid=(p.payrollRunId!=null&&p.payrollRunId!=='')?p.payrollRunId:p.payrollRun; if(payRunSrc && rid!=null && rid!=='' && postedRun[String(rid)]) return;
      var emp=p.employee||p.empName||''; var typ='Payslip'+(emp?' — '+emp:'');
      var ents=[], netPay=0, lns=(p.lines||[]).filter(function(l){ return l; });
      if(lns.length){ lns.forEach(function(ln){ var a=num(ln.amount!=null&&ln.amount!==''?ln.amount:(ln.net!=null&&ln.net!==''?ln.net:ln.amountNoTax)); if(!a) return;
          var n=lineAcct(b,ln), pt=lc(ln.ptype||ln.type);
          if(pt==='contribution'){ /* employer contribution: expense and a separate liability, not net pay */
            if(n) ents.push(acctEnt(n,lineSub(ln),Math.abs(a),{t:typ})); var la=byId(b,ln.liabilityAccount)||byName(b,ln.liabilityAccount); ents.push(acctEnt(la,'',-Math.abs(a),{t:typ})); return; }
          var deduction = pt==='deduction' || a<0; var v=Math.abs(a);
          if(deduction){ netPay-=v; var dsub=lineSub(ln)||(n&&EMPSUB[n.id]?emp:''); ents.push(n?acctEnt(n,dsub,-v,{t:typ+(n&&EMPSUB[n.id]?' — recovery':' — deduction')}):{ a:need('salaries'), v:-v, t:typ+' — deduction' }); }
          else { netPay+=v; ents.push(n?acctEnt(n,lineSub(ln),v,{t:typ+' — earning'}):{ a:need('salaries'), v:v, t:typ+' — earning' }); } }); }
      else { netPay=num(p.netPay!=null&&p.netPay!==''?p.netPay:p.total); if(netPay) ents.push({ a:need('salaries'), v:netPay, t:typ }); }
      if(netPay) ents.push(blank(emp)?{ a:null, v:-netPay, why:'no employee selected' }:{ a:need('employee clearing account'), s:emp, v:-netPay, t:'Net pay'+(emp?' — '+emp:'') });
      post({ src:'payslips', id:p.id, date:p.date||p.issueDate, ref:p.reference, type:typ, party:emp, desc:p.description||p.narration }, ents); });

    /* ---------- expense claims: costs in, owed to the payer ---------- */
    (R.expenseClaims||[]).forEach(function(c){ if(!c) return; var payer=c.payer||''; var typ='Expense claim'+(payer?' — '+payer:'');
      var ents=[], tot=0, lns=(c.lines&&c.lines.length)?c.lines.filter(function(l){ return l; }):[{ account:c.account, amount:c.amount }];
      lns.forEach(function(ln){ var x=lineNums(ln); if(!x.gross&&!x.net) return; tot+=x.gross;
        ents.push(acctEnt(lineAcct(b,ln), lineSub(ln), x.net, { t:typ, d:ln.desc||ln.description||'' }));
        if(x.tax) ents.push({ a:taxAcct(ln, INP), v:x.tax, t:typ });
        rcPush(ents, ln, x.net, typ); });
      if(tot) ents.push(blank(payer)?{ a:null, v:-tot, why:'no payer selected' }:{ a:need('expense claims'), s:payer, v:-tot, t:typ });
      post({ src:'expenseClaims', id:c.id, date:c.date, ref:c.reference, type:typ, party:payer, desc:c.description }, ents); });

    /* ---------- depreciation & amortization ---------- */
    function deprDoc(d, key, costKey, accKey, expKey, label){
      var ents=[], lns=(d.lines||[]).filter(function(l){ return l; });
      if(lns.length){ lns.forEach(function(ln){ var v=num((ln.amount!=null&&ln.amount!=='')?ln.amount:(key==='amortization'?(ln.amortExpense!=null?ln.amortExpense:ln.depExpense):ln.depExpense)); if(!v) return;
          var exp=lineAcct(b,ln); if(exp && subKind(b,exp)) exp=null;
          ents.push({ a:exp?exp.id:need(expKey), v:v, t:label+(ln.asset?' — '+ln.asset:'') });
          ents.push(blank(ln.asset)?{ a:null, v:-v, why:'no asset selected' }:{ a:need(accKey), s:ln.asset, v:-v, t:label+' — '+ln.asset }); }); }
      else { var v=num(d.amount); if(v) ents.push({ a:need(expKey), v:v, t:label }, { a:null, v:-v, why:'no asset selected' }); }
      post({ src:key, id:d.id, date:d.date||d.issueDate, ref:d.reference, type:label, desc:d.description||d.narration }, ents); }
    (R.depreciation||[]).forEach(function(d){ if(d) deprDoc(d,'depreciation','fixed assets, at cost','fixed assets, accumulated depreciation','depreciation','Depreciation'); });
    (R.amortization||[]).forEach(function(d){ if(d) deprDoc(d,'amortization','intangible assets, at cost','intangible assets, accumulated amortization','amortization','Amortization'); });

    /* ---------- investments revalued to market ---------- */
    (R.investments||[]).forEach(function(x){ if(!x||!x.name) return; var g=0; try{ g=investGain(b,x); }catch(e){} if(!g) return;
      post({ src:'investments', id:x.id, date:today(), type:'Market value adjustment — '+x.name }, [ { a:need('investments'), s:x.name, v:g }, { a:need('investment gains (losses)'), v:-g } ]); });

    /* ---------- billable time ---------- */
    (R.billableTime||[]).forEach(function(t){ if(!t) return; var a=0; try{ a=billableAmount(t); }catch(e){} if(!a) return; var st=t.status||'Uninvoiced';
      var typ='Billable time'+(t.customer?' — '+t.customer:'');
      if(st==='Uninvoiced') post({ src:'billableTime', id:t.id, date:t.date, ref:t.reference, type:typ }, [ { a:need('billable time'), s:t.customer||'(none)', v:a }, { a:need('billable time - movement'), v:-a } ]);
      else if(st==='Written off') post({ src:'billableTime', id:t.id, date:t.date, ref:t.reference, type:typ+' — written off' }, [ { a:need('billable time - write-offs'), v:a }, { a:need('billable time - movement'), v:-a } ]); });

    /* ---------- inventory cost flows (from the weighted-average movements) ---------- */
    var byDoc={};
    Object.keys(invMoves).forEach(function(nm){ invMoves[nm].rows.forEach(function(r){ if(!r.src||r.id==null) return;
      /* sold before it was bought: the purchase that clears the sale carries the short qty's cost of sales */
      if(r.clr){ if(r.cout>0.0000001) (byDoc['pendClear|'+r.id+'|'+(r.date||'')]=byDoc['pendClear|'+r.id+'|'+(r.date||'')]||[]).push({ item:nm, v:-r.cout, r:r }); return; }
      if(r.src==='salesInv' && r.cout>0.0000001){ (byDoc['salesInv|'+r.id]=byDoc['salesInv|'+r.id]||[]).push({ item:nm, v:-r.cout, r:r }); }
      else if(r.src==='creditNotes' && r.cin>0.0000001){ (byDoc['creditNotes|'+r.id]=byDoc['creditNotes|'+r.id]||[]).push({ item:nm, v:r.cin, r:r }); }
      else if(r.src==='invWriteOffs' && r.cout>0.0000001){ (byDoc['invWriteOffs|'+r.id]=byDoc['invWriteOffs|'+r.id]||[]).push({ item:nm, v:-r.cout, r:r }); }
      else if(r.src==='production'){ var v=(r.cin||0)-(r.cout||0); if(Math.abs(v)>0.0000001) (byDoc['production|'+r.id]=byDoc['production|'+r.id]||[]).push({ item:nm, v:v, r:r }); } }); });
    Object.keys(byDoc).forEach(function(k){ var parts=k.split('|'), src=parts[0], L=byDoc[k], r0=L[0].r; var ents=[], tot=0;
      if(src==='pendClear'){ L.forEach(function(x){ var xv=r2(x.v); tot=r2(tot+xv); ents.push({ a:need('inventory on hand'), s:x.item, v:xv, t:'Cost of sales (pending purchase cleared) — '+x.item }); });
        ents.push({ a:need('inventory - cost'), v:-tot, t:'Cost of sales — pending purchase cleared' });
        post({ src:'purchInv', id:r0.id, date:r0.date, ref:r0.ref, type:'Cost of sales — pending purchase cleared' }, ents); return; }
      L.forEach(function(x){ var xv=r2(x.v); tot=r2(tot+xv); ents.push({ a:need('inventory on hand'), s:x.item, v:xv, t:(src==='salesInv'?'Cost of sales':src==='creditNotes'?'Returned to stock':src==='invWriteOffs'?'Inventory write-off':'Production')+' — '+x.item }); });
      var other;
      if(src==='salesInv'||src==='creditNotes') other=need('inventory - cost');
      else if(src==='invWriteOffs'){ var w=(R.invWriteOffs||[]).filter(function(x){ return x&&String(x.id)===String(parts[1]); })[0]; var wa=w&&(byId(b,w.account)||byName(b,w.account)); other=wa?wa.id:need('inventory write-offs'); }
      else other=need('production in progress');
      ents.push({ a:other, v:-tot, t:src==='salesInv'?'Cost of sales':src==='creditNotes'?'Cost of sales reversed':src==='invWriteOffs'?'Inventory write-off':'Production — materials & finished goods' });
      post({ src:src, id:r0.id, date:r0.date, ref:r0.ref, type:(src==='salesInv'?'Cost of sales':src==='creditNotes'?'Credit note — stock returned':src==='invWriteOffs'?'Inventory write-off':'Production order') }, ents); });
    (R.production||[]).forEach(function(pr){ if(!pr) return; var extra=num(pr.extraCost); if(!extra) return;
      var ea=byId(b,pr.extraAccount)||byName(b,pr.extraAccount);
      post({ src:'production', id:pr.id, date:pr.date, ref:pr.reference, type:'Production order — additional cost' },
        [ { a:need('production in progress'), v:extra }, ea?{ a:ea.id, v:-extra }:{ a:null, v:-extra, why:'no account for the additional cost' } ]); });

    /* ---------- registered posting sources (modules such as js/loans.js) ----------
       Each source returns derived transactions [{meta:{src,id,date,ref,type,party,desc}, ents:[...]}]
       built with the same helpers as the documents above, so they post Dr = Cr (or to Suspense). */
    SOURCES.forEach(function(S){ var out=[];
      try{ out=S.fn(b, { need:need, bankEnt:bankEnt, SBE:SBE, num:num, r2:r2, today:today,
        acctEnt:function(ref, sub, v, extra){ var n=byId(b,ref)||byName(b,ref); return acctEnt(n, sub, v, extra); } })||[]; }
      catch(e){ issues.push({ src:S.id, id:null, ref:'', date:'', type:'Posting source "'+S.id+'"', problems:['could not post: '+((e&&e.message)||e)], suspense:0 }); out=[]; }
      (Array.isArray(out)?out:[]).forEach(function(t){ if(t && t.meta && Array.isArray(t.ents) && t.ents.length) post(t.meta, t.ents); }); });

    /* ---------- placeholders -> real accounts (created on first use) ---------- */
    var sbeNet=0; lines.forEach(function(L){ if(L.acct===SBE) sbeNet+=L.debit-L.credit; });
    var map={};
    var usedSusp=lines.some(function(L){ return L.acct===SUSP && (L.debit||L.credit); });
    var sbeHave=sysAcct(b,'starting balance equity',false);
    if(Math.abs(sbeNet)>0.005 || sbeHave){ var sb=sbeHave||sysAcct(b,'starting balance equity',true); if(sb) map[SBE]=sb.id; }
    if(usedSusp){ var su=sysAcct(b,'suspense',true); if(su) su.suspenseControl=1; map[SUSP]=su?su.id:SUSP; }
    Object.keys(placeholders).forEach(function(ph){ var n=sysAcct(b,placeholders[ph],true); map[ph]=n?n.id:ph; });
    var out=lines.filter(function(L){ if(L.acct===SBE && !map[SBE]) return false; return true; });
    out.forEach(function(L){ if(map[L.acct]) L.acct=map[L.acct]; });
    txs.forEach(function(t){ t.lines.forEach(function(L){ if(map[L.acct]) L.acct=map[L.acct]; }); });
    return { lines:out, txs:txs, issues:issues };
  }

  /* ------------------------------------------------- registered posting sources
     GL.registerSource(id, fn): fn(b, api) -> [{meta, ents}] where ents are
     {a:acctId, s:sub, v:+debit/-credit, t:type} or built with api.bankEnt(bankName, v, t) /
     api.acctEnt(acctIdOrName, sub, v, {t}) / api.need(systemAccountKey); api.SBE is Starting
     balance equity. A source reads only b (its records, chart and today()), so the cache
     fingerprint below still covers it. */
  var SOURCES=[];
  function registerSource(id, fn){ if(!id||typeof fn!=='function') return false; id=String(id);
    var i=-1; SOURCES.forEach(function(s,j){ if(s.id===id) i=j; });
    if(i>=0) SOURCES[i].fn=fn; else SOURCES.push({ id:id, fn:fn }); CACHE=[]; return true; }

  /* --------------------------------------------------------------- caching */
  var CACHE=[];
  function fingerprint(b){ try{ return JSON.stringify([b.id,b.records,b.coa,b.lateFees,b.inventoryKits,b.taxCodes,b.payslipItems,today()]); }catch(e){ return null; } }
  function get(b){ if(!b) return { lines:[], txs:[], issues:[], byAcct:{} };
    var fp=fingerprint(b);
    for(var i=0;i<CACHE.length;i++){ if(CACHE[i].fp===fp && fp!=null){
      /* the chart may have been read fresh from storage: re-add any system account the cached build created */
      applyCreated(b,CACHE[i].created);
      return CACHE[i].gl; } }
    var before=((b.coa||[]).map(function(n){ return n&&n.id; }));
    var gl=build(b); var byAcct={};
    gl.lines.forEach(function(L){ (byAcct[L.acct]=byAcct[L.acct]||[]).push(L); });
    gl.byAcct=byAcct;
    var created=(b.coa||[]).filter(function(n){ return n && before.indexOf(n.id)<0; }).map(function(n){ return JSON.parse(JSON.stringify(n)); });
    var fp2=fingerprint(b);
    CACHE.unshift({ fp:fp2, gl:gl, created:created }); if(fp!==fp2) CACHE.unshift({ fp:fp, gl:gl, created:created });
    if(CACHE.length>6) CACHE.length=6;
    return gl; }
  function invalidate(){ CACHE=[]; }
  function applyCreated(b,created){ (created||[]).forEach(function(n){ if((b.coa||[]).some(function(x){ return x&&x.id===n.id; })) return;
    (b.coa=b.coa||[]).push(JSON.parse(JSON.stringify(n)));
    if(n.type==='group' && n.parent==='pl'){ b.coaTop=b.coaTop||{bs:['assets','liabilities','equity'],pl:[]}; b.coaTop.pl=b.coaTop.pl||[];
      if(b.coaTop.pl.indexOf(n.id)<0){ var ti=b.coaTop.pl.findIndex(function(x){ var m=b.coa.find(function(y){ return y.id===x; }); return m&&m.type==='total'; });
        if(ti<0) b.coaTop.pl.push(n.id); else b.coaTop.pl.splice(ti,0,n.id); } } }); }

  function inRange(d,from,to){ d=day(d); if(!d) return !from; if(from&&d<from) return false; if(to&&d>to) return false; return true; }
  function asOf(d,to){ d=day(d); if(!d||!to) return true; return d<=to; }

  /** nature-signed balance of an account (debit-natured accounts: Dr - Cr). opts {from,to,sub} */
  function balance(b,acctId,opts){ opts=opts||{}; var g=get(b), n=byId(b,acctId); if(!n) return 0; var d=natureD(b,n), s=0;
    (g.byAcct[acctId]||[]).forEach(function(L){ if(opts.sub!=null && L.sub!==opts.sub) return;
      if(opts.from!=null||opts.period){ if(!inRange(L.date,opts.from,opts.to)) return; } else if(!asOf(L.date,opts.to)) return;
      s+= d?(L.debit-L.credit):(L.credit-L.debit); });
    return r2(s); }
  /** sum of Dr - Cr for an account's lines (sign-neutral) */
  function net(b,acctId,opts){ opts=opts||{}; var g=get(b), s=0;
    (g.byAcct[acctId]||[]).forEach(function(L){ if(opts.sub!=null && L.sub!==opts.sub) return; if(!asOf(L.date,opts.to)) return; s+=L.debit-L.credit; }); return r2(s); }
  /** ledger rows for an account: {acct, name, opening (undated postings, nature-signed), rows:[{date,ref,type,debit,credit,src,id,sub}]} */
  function entries(b,acctId,opts){ opts=opts||{}; var g=get(b), n=byId(b,acctId); if(!n) return { acct:null, name:'', opening:0, rows:[] };
    var d=natureD(b,n), opening=0, rows=[];
    (g.byAcct[acctId]||[]).forEach(function(L){ if(opts.sub!=null && L.sub!==opts.sub) return;
      if(!L.date){ opening+= d?(L.debit-L.credit):(L.credit-L.debit); if(!opts.withOpenings) return; }
      rows.push({ date:L.date, ref:L.ref, type:L.type+(L.sub&&opts.sub==null&&L.type.indexOf(L.sub)<0?' — '+L.sub:''), debit:r2(L.debit), credit:r2(L.credit), src:L.src, id:L.id, sub:L.sub, opening:!L.date }); });
    rows.sort(function(x,y){ return String(x.date||'').localeCompare(String(y.date||'')) || String(x.ref||'').localeCompare(String(y.ref||''), undefined, {numeric:true}); });
    return { acct:n, name:n.name||'', opening:r2(opening), rows:rows }; }
  /** a control account's balance for one sub-account (customer, supplier, bank, ...) */
  function subBalance(b,acctKey,sub,opts){ var n=byId(b,acctKey)||sysAcct(b,acctKey,false); if(!n) return 0; return balance(b,n.id,Object.assign({},opts||{},{sub:sub})); }
  /** every sub-account balance of a control account: {name: balance} */
  function subBalances(b,acctKey,opts){ opts=opts||{}; var n=byId(b,acctKey)||sysAcct(b,acctKey,false); var out={}; if(!n) return out; var d=natureD(b,n);
    (get(b).byAcct[n.id]||[]).forEach(function(L){ if(!asOf(L.date,opts.to)) return; out[L.sub]=r2((out[L.sub]||0)+(d?(L.debit-L.credit):(L.credit-L.debit))); }); return out; }
  /** postings of one document, for the Transaction Journal */
  function docLines(b,src,id){ return get(b).lines.filter(function(L){ return L.src===src && String(L.id)===String(id); }); }

  /** Trial balance as at `to`: rows per account with debit / credit, and totals. */
  function trial(b,opts){ opts=opts||{}; var g=get(b), rows=[], dr=0, cr=0;
    accounts(b).forEach(function(n){ var s=0; (g.byAcct[n.id]||[]).forEach(function(L){ if(opts.from!=null&&opts.pl&&!inRange(L.date,opts.from,opts.to)) return; if(!asOf(L.date,opts.to)) return; s+=L.debit-L.credit; });
      s=r2(s); if(Math.abs(s)<0.005) return; var d=s>0?s:0, c=s<0?-s:0; dr+=d; cr+=c;
      rows.push({ id:n.id, name:n.name, code:n.code||'', root:acctRootSafe(b,n), debit:d, credit:c }); });
    return { rows:rows, debit:r2(dr), credit:r2(cr) }; }

  /** A register record's ledger (customer / supplier / employee / capital account / bank / special account):
      dated postings on its control account, oldest first. Starting balances are left to the caller (rec.balance). */
  var PARTY_CTRL={ customers:'accounts receivable', suppliers:'accounts payable', employees:'employee clearing account',
                   capital:'capital accounts', bankCash:'cash & cash equivalents', special:'special accounts' };
  function partyEntries(b,key,rec){ var k=PARTY_CTRL[key]; if(!k||!rec||blank(rec.name)) return null; get(b);
    var n=sysAcct(b,k,false); if(!n) return [];
    var nm=rec.name, rows=[];
    (get(b).byAcct[n.id]||[]).forEach(function(L){ if(L.sub!==nm || !L.date) return;
      var t=L.type||''; if(key!=='bankCash' && t.indexOf(' — '+nm)>=0) t=t.replace(' — '+nm,'');
      rows.push({ date:L.date, ref:L.ref, type:t, debit:r2(L.debit), credit:r2(L.credit), src:L.src, id:L.id }); });
    rows.sort(function(x,y){ return String(x.date||'').localeCompare(String(y.date||'')) || String(x.ref||'').localeCompare(String(y.ref||''), undefined, {numeric:true}); });
    return rows; }

  /** Problems found while posting: unbalanced documents and lines that went to Suspense. */
  function issues(b){ return get(b).issues.slice(); }

  return { build:build, get:get, invalidate:invalidate, balance:balance, net:net, entries:entries, subBalance:subBalance,
           subBalances:subBalances, docLines:docLines, partyEntries:partyEntries, trial:trial, issues:issues, sysAcct:sysAcct, lineNums:lineNums,
           lineAcct:lineAcct, subKind:subKind, bankOf:bankOf, num:num, r2:r2, today:today, rcTagOf:rcTagOf, registerSource:registerSource,
           recoveryAccts:recoveryAccts, empSubAcct:empSubAcct };
})();
if(typeof window!=='undefined') window.GL=GL;

/**
 * Postings of one voucher as the general ledger records them — used by the
 * Transaction Journal. Rows: {acctId, accountName, debit, credit, sub, bankId}.
 * A record that is not saved yet is posted on a copy of the business.
 */
function postingsForRecord(b,key,rec){
  if(!b||!rec) return [];
  var lines=(rec.id!=null)?GL.docLines(b,key,rec.id):[];
  var src=b;
  if(!lines.length){ src=JSON.parse(JSON.stringify(b)); src.records=src.records||{}; var arr=(src.records[key]||[]).filter(function(x){ return !(rec.id!=null&&x.id===rec.id); });
    var tmp=JSON.parse(JSON.stringify(rec)); if(tmp.id==null) tmp.id='__preview__';
    /* a payslip of a payroll run posts inside the run's one journal entry: show its own share here */
    if(key==='payslips'){ delete tmp.payrollRunId; delete tmp.payrollRun; }
    arr.push(tmp); src.records[key]=arr;
    lines=GL.build(src).lines.filter(function(L){ return L.src===key && String(L.id)===String(tmp.id); }); }
  var banks=((src.records||{}).bankCash)||[];
  return lines.map(function(L){ var n=(src.coa||[]).filter(function(x){ return x&&x.id===L.acct; })[0];
    var bk=(n&&n.cashControl&&L.sub)?banks.filter(function(x){ return x&&x.name===L.sub; })[0]:null;
    return { acctId:L.acct, accountName:n?n.name:String(L.acct), debit:L.debit, credit:L.credit, sub:L.sub||'', bankId:bk?bk.id:null, type:L.type }; });
}
if(typeof window!=='undefined') window.postingsForRecord=postingsForRecord;
