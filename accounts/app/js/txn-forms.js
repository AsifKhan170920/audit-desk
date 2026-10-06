/* ===================== Native Receipt / Payment / Sales Invoice forms =====================
   One voucher engine for the three everyday documents, ported from the
   Bookkeeping Desk design: a header of input groups, a line grid whose columns
   follow the option checkboxes, live totals that update in place (focus is never
   lost while typing), searchable combo boxes with "+ Add new", and Tally-style
   keyboard entry.

   It is the DEFAULT engine for receipts, payments and salesInv. A business can
   switch any of the three back to Wasif's Form Designer path with
   b.formEngine[key] = 'designed' (link in the form footer); that path is left
   completely untouched.

   What it saves is exactly the record shape the rest of the app already reads
   (accounting.js accountMovements / customerBalance / settlementIndex, the
   allocation panel, the party balance badge, the voucher print view):

     receipts  { date, reference, receivedIn, paidBy, paidByType, description,
                 amount, subtotal, tax, total, lines[], allocations[] }
     payments  { date, reference, paidFrom, payee, payeeType, description, ...same }
     salesInv  { issueDate, date, dueType, dueDays, dueDateManual, dueDate,
                 reference, customer, billingAddress, description,
                 subtotal, tax, total, balanceDue, taxInclusive, ...options, lines[] }
     line      { item, account:<coa id>, accountName, sub, desc, description, qty,
                 price, discount, net, amount:<line total incl. tax>, taxAmt,
                 tax:<tax code name>, taxCode, taxRate, division }

   Enter handling: the whole form host carries data-enter-nav="off", so the
   document-wide EnterNav (js/enter-nav.js) stands aside and this module owns
   Enter / arrow navigation inside the form (it needs to know about combo boxes,
   the line grid and "Enter on the last cell adds a line", which EnterNav does not).
   ========================================================================================= */
(function(global){
  'use strict';

  var KEYS = { receipts:1, payments:1, salesInv:1 };
  var SPEC = {
    receipts: { kind:'money', dir:1,  singular:'Receipt', partyLabel:'Paid by', bankLabel:'Received in',
                bankField:'receivedIn', partyField:'paidBy', typeField:'paidByType', buy:false,
                head:['date','ref','contact','bank','desc'] },
    payments: { kind:'money', dir:-1, singular:'Payment', partyLabel:'Payee',   bankLabel:'Paid from',
                bankField:'paidFrom',  partyField:'payee',  typeField:'payeeType',  buy:true,
                head:['date','ref','bank','contact','desc'] },
    salesInv: { kind:'inv', singular:'Sales Invoice', partyLabel:'Customer', addrLabel:'Billing address',
                dateLabel:'Issue date', buy:false, head:['date','due','ref','party','address','desc'] }
  };
  /* option checkboxes, in the order the source shows them */
  var OPTS = {
    money: [['colLineNum','Column — Line number'],['colItem','Column — Item'],['showDescCol','Column — Description'],
            ['colQty','Column — Qty'],['colDiscount','Column — Discount'],['colDivision','Column — Division'],
            ['taxExclusive','Amounts are tax inclusive'],['showTaxCol','Show tax amount column'],['fixedTotal','Fixed total']],
    inv:   [['colLineNum','Column — Line number'],['colItem','Column — Item'],['showDescCol','Column — Description'],
            ['colQty','Column — Qty'],['colDiscount','Column — Discount'],['colDivision','Column — Division'],['taxInclusive','Amounts are tax inclusive'],
            ['rounding','Rounding'],['withholding','Withholding tax'],['showTaxCol','Show tax amount column'],['fixedTotal','Fixed total'],
            ['customTitleOn','Custom title'],['hideDueDate','Hide — Due date'],['hideBalanceDue','Hide — Balance due'],
            ['amountInWords','Amount in words']]
  };
  var OPT_KEYS = ['colLineNum','colItem','showDescCol','colQty','colDiscount','discType','colDivision','taxExclusive','taxInclusive',
    'rounding','roundMode','withholding','whtType','whtRate','whtAmount','showTaxCol','fixedTotal','fixedTotalValue','customTitleOn','customTitle',
    'hideDueDate','hideBalanceDue','amountInWords'];
  var NAV_DEF = { enter:true, arrows:true, lastToSave:false, autoLine:true, newLine:true };

  /* ------------------------------------------------------------------ helpers */
  function app(){ try{ return App; }catch(e){ return global.App || null; } }
  function biz(){ var A=app(); return A && A.curBiz ? A.curBiz() : null; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function num(v){ if(v==null||v==='') return 0; var n=parseFloat(String(v).replace(/,/g,'').replace(/\s/g,'')); return isNaN(n)?0:n; }
  function r2(v){ return Math.round(((Number(v)||0)+Number.EPSILON)*100)/100; }
  function money(n){ var A=app(); try{ return A.money(n); }catch(e){ return r2(n).toFixed(2); } }
  function blank(v){ return v==null || String(v).trim()===''; }
  function today(){ var d=new Date(); var p=function(n){ return (n<10?'0':'')+n; }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function addDays(iso,n){ if(!iso) return ''; var d=new Date(iso+'T00:00:00Z'); if(isNaN(d)) return ''; d.setUTCDate(d.getUTCDate()+(Number(n)||0)); return d.toISOString().slice(0,10); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function doc(){ return global.document; }
  function byId(id){ var d=doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function label2key(){ try{ return LABEL2KEY; }catch(e){ return global.LABEL2KEY || {}; } }
  function key2label(){ try{ return KEY2LABEL; }catch(e){ return global.KEY2LABEL || {}; } }
  function regOf(key){ try{ return REG[key]; }catch(e){ return (global.REG||{})[key]; } }

  /* accounting.js globals, reached by name (they are plain function declarations) */
  function G(name){ return global[name]; }
  function acctById(b,id){ return ((b&&b.coa)||[]).filter(function(n){ return n.id===id; })[0] || null; }
  function acctByName(b,name){ if(blank(name)) return null; var t=String(name).trim().toLowerCase();
    return ((b&&b.coa)||[]).filter(function(n){ return n.type==='account' && String(n.name||'').trim().toLowerCase()===t; })[0] || null; }
  function acctRootOf(b,n){ try{ return G('acctRoot')(b,n); }catch(e){ return 'assets'; } }
  function resolveAcct(b,ln){
    if(!ln) return '';
    if(ln.account && acctById(b,ln.account)) return ln.account;
    var nm=ln.accountName || ln.accounts || (typeof ln.account==='string' ? ln.account : '');
    var a=acctByName(b,nm); return a ? a.id : '';
  }

  /* which sub-ledger list a control account needs (AR -> customers, ...) */
  var SUBS = {
    customers:  { label:'Customer',          list:'customers',   qc:'customer' },
    suppliers:  { label:'Supplier',          list:'suppliers',   qc:'supplier' },
    capital:    { label:'Capital account',   list:'capital',     qc:'capital' },
    employees:  { label:'Employee',          list:'employees',   qc:'employee' },
    inventory:  { label:'Inventory item',    list:'inventory',   qc:'item' },
    fixedAssets:{ label:'Fixed asset',       list:'fixedAssets', qc:'fixedAsset' },
    intangibles:{ label:'Intangible asset',  list:'intangibles', qc:'intangible' },
    investments:{ label:'Investment',        list:'investments', qc:'investment' },
    claimPayer: { label:'Payer',             list:null,          qc:'claimPayer' }
  };
  function subClassOf(b,acctId){
    var n=acctById(b,acctId); if(!n) return null; var nm=String(n.name||'');
    if(/^accounts receivable$/i.test(nm)) return 'customers';
    if(/^accounts payable$/i.test(nm)) return 'suppliers';
    if(/^capital accounts$/i.test(nm)) return 'capital';
    if(/^employee clearing account$/i.test(nm)) return 'employees';
    if(/^inventory on hand$/i.test(nm)) return 'inventory';
    if(/^fixed assets, at cost$/i.test(nm)) return 'fixedAssets';
    if(/^intangible assets, at cost$/i.test(nm)) return 'intangibles';
    if(/^investments$/i.test(nm)) return 'investments';
    if(/^expense claims$/i.test(nm)) return 'claimPayer';
    return null;
  }
  function namesOf(b,list){ return (((b&&b.records)||{})[list]||[]).map(function(r){ return r && (r.name||r.customer||r.supplier); }).filter(Boolean); }
  function subOptions(b,cls){
    if(cls==='claimPayer'){ var ps=(b.claimPayers||[]).map(function(x){ return (x&&x.name)||x; });
      var all=ps.concat(namesOf(b,'employees'),namesOf(b,'capital')); return uniq(all).map(function(n){ return {v:n,l:n}; }); }
    var S=SUBS[cls]; return S && S.list ? (((b.records||{})[S.list])||[]).filter(function(r){ return r&&r.name; })
      .map(function(r){ return { v:r.name, l:(App.codeName?App.codeName(r.code,r.name):((r.code?r.code+' - ':'')+r.name)) }; }) : [];
  }
  function uniq(a){ var s={}, o=[]; a.forEach(function(x){ if(x && !s[x]){ s[x]=1; o.push(x); } }); return o; }
  /* extension points other modules register on TxnForms.ext (no-ops when nothing is registered):
     ext.cols      [{id, th, show(b,t), cell(b,t,l,i), load(stateLine, storedLine), save(stateLine, outLine)}]
     ext.onAccount [fn(b,t,line,i)] after a line's account changes;  ext.onDraw [fn(b,t)] after a redraw */
  function extList(){ var x=(typeof TxnForms!=='undefined' && TxnForms.ext) || null; return (x && Array.isArray(x.cols)) ? x.cols : []; }
  function hooks(n){ var x=(typeof TxnForms!=='undefined' && TxnForms.ext) || null; return (x && Array.isArray(x[n])) ? x[n] : []; }

  /* ---------------------------------------------------------------- tax codes */
  function taxCodes(b){ return (b&&b.taxCodes)||[]; }
  /** rate (sum of components when the code has several), reverse charge, parts */
  function taxInfo(b,code){
    if(blank(code)) return { rate:0, components:null };
    var t=taxCodes(b).filter(function(x){ return x && x.name===code; })[0];
    if(!t) return { rate:0, components:null };
    var comps=(Array.isArray(t.components)&&t.components.length) ? t.components : null;
    var rate=comps ? comps.reduce(function(s,c){ return s+num(c.rate); },0) : num(t.rate);
    return { rate:rate, reverse:!!t.reverse, components:comps, name:t.name };
  }
  /** tax code a stored line refers to: by name, else by its rate (designed-form lines store the rate) */
  function codeOfLine(b,ln){
    if(!ln) return '';
    var codes=taxCodes(b), has=function(n){ return codes.some(function(c){ return c && c.name===n; }); };
    if(!blank(ln.taxCode) && has(ln.taxCode)) return ln.taxCode;
    if(!blank(ln.tax) && has(String(ln.tax))) return String(ln.tax);
    var rt=!blank(ln.taxRate) ? num(ln.taxRate) : (!blank(ln.tax) && !isNaN(parseFloat(ln.tax)) ? num(ln.tax) : null);
    if(rt){ var hit=codes.filter(function(c){ return c && Math.abs(taxInfo(b,c.name).rate-rt)<1e-9; })[0]; if(hit) return hit.name; }
    return '';
  }

  /* --------------------------------------------------------------- state (TX) */
  var TX = null;                       // the document being edited
  var CB = {}, cbSeq = 0;              // combo registry, rebuilt on every draw

  function spec(key){ return SPEC[key || (TX && TX.key)]; }
  function isInv(t){ return SPEC[(t||TX).key].kind==='inv'; }
  function blankLine(t){ return { item:'', account:'', sub:'', desc:'', qty:'', price:'', discount:'', taxCode:(t&&t.defaultTaxCode)||'', division:'' }; }

  function navCfg(b){ var s=(b&&b.keyboardNav)||{}; var o={}; Object.keys(NAV_DEF).forEach(function(k){ o[k]=(s[k]==null)?NAV_DEF[k]:s[k]!==false; }); return o; }
  function engineOf(b,key){ return (((b&&b.formEngine)||{})[key]==='designed') ? 'designed' : 'native'; }
  function handles(b,key){ return !!KEYS[key] && engineOf(b,key)!=='designed'; }

  function partyTypeOf(b,rec,typeField,partyField){
    var t=String(rec[typeField]||'').toLowerCase();
    if(t==='others') t='other';
    if(t==='customer'||t==='supplier'||t==='other') return t;
    var nm=rec[partyField] || rec.customer || rec.supplier || '';
    if(rec.customer && !rec[partyField]) return 'customer';
    if(rec.supplier && !rec[partyField]) return 'supplier';
    if(nm && namesOf(b,'customers').indexOf(nm)>=0) return 'customer';
    if(nm && namesOf(b,'suppliers').indexOf(nm)>=0) return 'supplier';
    return 'other';
  }

  /**
   * Build the editor state for `key` from a stored record (editing), a prefill
   * (clone / copy-to / form defaults) or nothing (new). Accepts records written
   * by this engine, by the Form Designer bridge and by the legacy saveRecord.
   */
  function start(b,key,rec,mode){
    var S=SPEC[key], inv=S.kind==='inv'; rec=rec||{}; mode=mode||'new';
    var t={ key:key, mode:mode, id:(mode==='edit'?rec.id:null), uuid:(mode==='edit'?rec.uuid:null),
            date:String(rec.issueDate||rec.date||'').slice(0,10) || today(), description:rec.description||'',
            division:rec.division||'', project:rec.project||'', defaultTaxCode:rec.defaultTaxCode||'' };
    var A=app();
    t.autoRef = mode==='edit' ? false : blank(rec.reference);
    t.reference = mode==='edit' ? (rec.reference||'') : (blank(rec.reference) ? nextRef(b,key) : rec.reference);
    if(inv){
      t.customer=rec.customer||rec.custName||''; t.billingAddress=rec.billingAddress!=null?rec.billingAddress:(rec.custAddress||'');
      t.dueType=rec.dueType || (!blank(rec.dueDateManual)?'By':(blank(rec.dueDays)&&!blank(rec.dueDate)?'By':'Net'));
      t.dueDays=!blank(rec.dueDays)?rec.dueDays:''; t.dueDateManual=rec.dueDateManual || (t.dueType==='By'?(rec.dueDate||''):'');
      if(t.dueType==='Net' && blank(t.dueDays) && mode==='new'){ var c=partyRec(b,'customers',t.customer); if(c && !blank(c.dueDays)) t.dueDays=c.dueDays; }
    } else {
      t.bank=rec[S.bankField]||'';
      t.partyType=partyTypeOf(b,rec,S.typeField,S.partyField);
      t.party=rec[S.partyField] || (t.partyType==='customer'?rec.customer:t.partyType==='supplier'?rec.supplier:'') || '';
    }
    /* options: stored on the record; new documents take Settings > Form Defaults, then the source's defaults */
    var fd=((b&&b.formDefaults)||{})[key]||{}; var fo=fd.options||{};
    OPT_KEYS.forEach(function(k){ if(rec[k]!=null) t[k]=rec[k]; else if(fo[k]!=null) t[k]=fo[k]; });
    /* a legacy record with a header amount but no stored lines opens with one line carrying that amount */
    var lines=(((A&&A._linesForEdit)?A._linesForEdit(key,rec):rec.lines)||[]).filter(function(ln){ return ln && !ln.rounding; });
    var designed=lines.some(function(ln){ return ln.amountNoTax!=null && blank(ln.taxCode); });
    if(mode==='new' && rec.colLineNum==null && fo.colLineNum==null) t.colLineNum=inv;
    if(t.colItem==null) t.colItem=true;
    if(t.showDescCol==null) t.showDescCol = inv || lines.some(function(ln){ return !blank(ln.desc!=null?ln.desc:ln.description); });
    if(t.showTaxCol==null) t.showTaxCol = inv;
    if(!inv && t.colQty==null) t.colQty = lines.some(function(ln){ return !blank(ln.qty) && num(ln.qty)!==1; });
    if(inv && t.colQty==null) t.colQty = true;
    if(!inv && t.taxExclusive==null) t.taxExclusive = designed && lines.some(function(ln){ return num(ln.taxAmt) || num(ln.taxRate); });
    if(inv && t.taxInclusive==null) t.taxInclusive=false;
    if(inv && t.amountInWords==null) t.amountInWords=true;
    if(inv && mode==='new' && t.customTitleOn==null && key==='salesInv'){ t.customTitleOn=true; if(blank(t.customTitle)) t.customTitle='TAX INVOICE'; }
    if(t.colDiscount==null) t.colDiscount = lines.some(function(ln){ return num(ln.discount); });
    if(t.colDivision==null) t.colDivision = lines.some(function(ln){ return !blank(ln.division); });
    if(t.rounding && !t.roundMode) t.roundMode='Round to nearest';
    t.lines=lines.map(function(ln){
      var code=codeOfLine(b,ln);
      var price;
      if(!blank(ln.price)) price=ln.price;
      else if(inv) price=!blank(ln.amountNoTax)?ln.amountNoTax:(ln.net!=null?ln.net:ln.amount);
      else price=(t.taxExclusive && ln.net!=null && ln.net!=='') ? ln.net : (ln.amount!=null?ln.amount:'');
      price=blank(price) ? '' : String(num(price));
      return { item:ln.item||ln.items||'', account:resolveAcct(b,ln), sub:(!blank(ln.sub)?ln.sub:(ln.subAccount||'')),
               desc:(ln.desc!=null&&ln.desc!=='')?ln.desc:(ln.description||''), qty:(ln.qty==null?'':String(ln.qty)),
               price:price==null?'':price, discount:ln.discount==null?'':String(ln.discount), taxCode:code, division:ln.division||'' };
    });
    /* extension columns (js/settings-fixes-a.js: billable to customer, line custom fields) read their stored value */
    extList().forEach(function(ex){ if(ex.load) t.lines.forEach(function(tl,i){ try{ ex.load(tl, lines[i]||{}, b, t); }catch(e){} }); });
    if(!t.lines.length) t.lines=[blankLine(t)];
    /* data safety: the record has a total but its lines did not load — saving would set it to 0 */
    if(mode==='edit' && A && A.recordHeaderTotal){ var ht=A.recordHeaderTotal(key,rec); if(Math.abs(ht)>0.005 && Math.abs(totals(b,t).total)<0.005) t.loadBlocked='Line items did not load \u2014 saving would set the amount to 0.'; }
    /* a clone must not re-apply the original's allocations; Receive payment's prefill asks to keep them */
    t.allocations=(mode==='edit' || rec._keepAlloc) ? (rec.allocations||[]).slice() : [];
    return t;
  }
  function partyRec(b,list,name){ return ((((b&&b.records)||{})[list])||[]).filter(function(r){ return r && r.name===name; })[0] || null; }
  function nextRef(b,key){ var A=app(); try{ return A.nextRef(b,key); }catch(e){
    var mx=0; (((b&&b.records)||{})[key]||[]).forEach(function(r){ var m=String(r.reference||'').match(/(\d+)\s*$/); if(m) mx=Math.max(mx,parseInt(m[1],10)); }); return String(mx+1); } }

  /* -------------------------------------------------------------- calculation */
  /** tax code is hidden (value remembered) for control accounts, and on money lines without an account */
  function taxHidden(b,t,l){ var n=acctById(b,l.account); if(!n) return !isInv(t); var cls=subClassOf(b,l.account); return !!(cls || n.cashControl || n.arControl || n.apControl); }

  /** qty x price, % or exact discount, inclusive / exclusive tax — the source's lineCalc */
  function lineCalc(b,t,l){
    var inv=isInv(t), qtyOn=qtyCol(t);
    var qty=qtyOn ? (blank(l.qty) ? 1 : num(l.qty)) : 1;
    var gross=qtyOn ? qty*num(l.price) : num(l.price);
    var disc=0; if(t.colDiscount && num(l.discount)) disc = t.discType==='Exact amount' ? num(l.discount) : gross*num(l.discount)/100;
    gross=r2(gross-disc);
    var ti=taxHidden(b,t,l) ? { rate:0 } : taxInfo(b,l.taxCode);
    var rate=ti.reverse ? 0 : (ti.rate||0)/100, excl=inv ? !t.taxInclusive : !!t.taxExclusive;
    var net, tax;
    if(excl){ net=gross; tax=r2(net*rate); } else { tax=r2(gross*rate/(1+rate)); net=r2(gross-tax); }
    return { qty:qty, disc:r2(disc), gross:gross, net:net, tax:tax, total:r2(net+tax), rate:ti.rate||0 };
  }
  /** the Qty column: optional on every form (on by default for invoices) */
  function qtyCol(t){ return isInv(t) ? t.colQty!==false : !!t.colQty; }
  /** withholding tax: a rate on the net amount, or an exact amount */
  function whtOf(t,net){ if(!t.withholding) return 0; return r2(t.whtType==='Rate' ? net*num(t.whtRate)/100 : num(t.whtAmount)); }
  function totals(b,t){
    var lines=(t.lines||[]).map(function(l){ return { l:l, c:lineCalc(b,t,l) }; });
    var taxes={}, order=[];
    lines.forEach(function(x){ var k=x.l.taxCode; if(!blank(k) && !taxHidden(b,t,x.l)){ if(!(k in taxes)){ taxes[k]=0; order.push(k); } taxes[k]=r2(taxes[k]+x.c.tax); } });
    var net=r2(lines.reduce(function(s,x){ return s+x.c.net; },0)), tax=r2(lines.reduce(function(s,x){ return s+x.c.tax; },0));
    var total=r2(net+tax), rnd=0;
    if(isInv(t) && t.rounding){ var m=t.roundMode||'Round to nearest';
      if(m==='Round to nearest') rnd=r2(Math.round(total)-total); else if(m==='Round down') rnd=r2(Math.floor(total)-total); }
    total=r2(total+rnd);
    var wht=whtOf(t,net);
    return { lines:lines, taxes:taxes, taxOrder:order, net:net, tax:tax, rnd:rnd, wht:wht, total:total,
             balance:r2(total-wht), diff:t.fixedTotal ? r2(num(t.fixedTotalValue)-total) : 0 };
  }
  function usedLines(t){ return (t.lines||[]).filter(function(l){ return num(l.price) || !blank(l.account) || !blank(l.item) || !blank(l.desc) || num(l.qty) || !blank(l.sub); }); }

  /* --------------------------------------------------------------- validation */
  function validate(b,t){
    var E=[], S=SPEC[t.key], inv=S.kind==='inv', A=app();
    if(!t.date) E.push((inv?'Issue date':'Date')+' is required.');
    if(!t.autoRef && !blank(t.reference)){
      var dup=(((b.records||{})[t.key])||[]).some(function(x){ return String(x.reference||'')===String(t.reference) && x.id!==t.id; });
      if(dup) E.push('Reference '+t.reference+' is already used by another '+S.singular.toLowerCase()+'.');
    }
    if(!inv){
      if(blank(t.bank)) E.push(S.bankLabel+' account is required.');
      if((t.partyType==='customer'||t.partyType==='supplier') && blank(t.party)) E.push('Select a '+t.partyType+' for '+S.partyLabel+'.');
    } else if(blank(t.customer)) E.push('Select a customer.');
    if(inv && t.dueType==='By' && blank(t.dueDateManual)) E.push('Due date is required when the due date type is “By”.');
    var used=usedLines(t);
    if(!used.length) E.push('Add at least one line.');
    used.forEach(function(l){
      var n=t.lines.indexOf(l)+1, node=acctById(b,l.account), cls=node?subClassOf(b,l.account):null;
      if(!num(l.price)) E.push('Line '+n+': '+(inv?'unit price':'amount')+' is required.');
      if(!node) E.push('Line '+n+': select an account'+(l.item?' (set the item’s account in its settings)':'')+'.');
      else if(cls && blank(l.sub)) E.push('Line '+n+': select a '+SUBS[cls].label.toLowerCase()+' for “'+node.name+'”.');
    });
    var T=totals(b,t);
    if(t.fixedTotal && T.diff!==0) E.push('Fixed total does not match the calculated total.');
    var lk=b.lockDate||'';
    if(lk){ var nd=String(t.date||'').slice(0,10), od='';
      if(t.id!=null){ var old=(((b.records||{})[t.key])||[]).filter(function(x){ return x.id===t.id; })[0]; if(old) od=String(old.issueDate||old.date||'').slice(0,10); }
      if((nd && nd<=lk) || (od && od<=lk)) E.push('Date falls on or before the lock date ('+lk+'). Change the date, or update Settings → Lock Date.'); }
    return E;
  }

  /* ----------------------------------------------------------------- record */
  /** The stored record for this state, in the shape accounting.js reads. */
  function buildRecord(b,t){
    var S=SPEC[t.key], inv=S.kind==='inv', T=totals(b,t);
    var used=usedLines(t);
    var lines=used.map(function(l){
      var c=lineCalc(b,t,l), node=acctById(b,l.account), hid=taxHidden(b,t,l), code=hid?'':(l.taxCode||'');
      var o={ item:l.item||'', account:l.account||'', accountName:node?node.name:'', sub:subClassOf(b,l.account)?(l.sub||''):'',
              desc:l.desc||'', description:l.desc||'', qty:qtyCol(t)?(blank(l.qty)?(inv?1:''):num(l.qty)):'',
              price:num(l.price), discount:t.colDiscount?(blank(l.discount)?'':num(l.discount)):'',
              net:c.net, amount:c.total, taxAmt:c.tax, tax:code, taxCode:code, taxRate:code?c.rate:'' };
      if(!blank(l.division)) o.division=l.division;
      if(l.item){ var it=itemRec(b,l.item); if(it && it.rec.unit) o.unit=it.rec.unit; }
      extList().forEach(function(ex){ if(ex.save) try{ ex.save(l, o, b, t); }catch(e){} });
      return o;
    });
    if(inv && T.rnd){ var ra=acctByName(b,'Rounding'); var acct=ra?ra.id:(lines[0]?lines[0].account:'');
      lines.push({ item:'', account:acct, accountName:ra?ra.name:(lines[0]?lines[0].accountName:''), sub:'', desc:'Rounding', description:'Rounding',
                   qty:'', price:T.rnd, discount:'', net:T.rnd, amount:T.rnd, taxAmt:0, tax:'', taxCode:'', taxRate:'', rounding:true }); }
    var rec={ reference:t.reference, description:t.description||'', subtotal:T.net, tax:T.tax, total:T.total, lines:lines };
    if(t.division) rec.division=t.division; if(t.project) rec.project=t.project;
    OPT_KEYS.forEach(function(k){ if(t[k]!=null) rec[k]=t[k]; });
    if(inv){
      rec.issueDate=t.date; rec.date=t.date; rec.customer=t.customer; rec.billingAddress=t.billingAddress||'';
      rec.dueType=t.dueType||'Net'; rec.dueDays=t.dueType==='By'?'':(blank(t.dueDays)?'':num(t.dueDays)); rec.dueDateManual=t.dueType==='By'?(t.dueDateManual||''):'';
      rec.dueDate=t.dueType==='By' ? (t.dueDateManual||'') : (blank(t.dueDays)?'':addDays(t.date,num(t.dueDays)));
      rec.taxInclusive=!!t.taxInclusive; rec.balanceDue=T.total; rec.roundingAmt=T.rnd||0;
      if(t.withholding){ rec.withholdingAmt=T.wht; rec.balanceDue=T.balance; }
    } else {
      rec.date=t.date; rec[S.bankField]=t.bank; rec[S.partyField]=t.party||''; rec[S.typeField]=t.partyType||'other';
      rec.amount=T.total; rec.taxExclusive=!!t.taxExclusive;
      rec.allocations=(t.allocations||[]).slice();
    }
    return rec;
  }

  /* ----------------------------------------------------------- option lists */
  function acctOpts(b){ var A=app(); var L=[]; try{ L=A.accountOptions(b); }catch(e){}
    var used={}; ((TX&&TX.lines)||[]).forEach(function(l){ if(l&&l.account) used[l.account]=1; });
    return L.filter(function(o){ var n=acctById(b,o.id); if(n && n.cashControl) return false; if(used[o.id]) return true; return !(A.lineAccountHidden && A.lineAccountHidden(b,o.id,TX&&TX.key)); }).map(function(o){ return { v:o.id, l:o.label }; }); }
  function bankOpts(b,cur){ return (((b.records||{}).bankCash)||[]).filter(function(r){ return r && r.name && (!r.inactive || r.name===cur); })
    .map(function(r){ return { v:r.name, l:(App.codeName?App.codeName(r.code,r.name):((r.code?r.code+' - ':'')+r.name)) }; }); }
  function partyOpts(b,list){ return (((b.records||{})[list])||[]).filter(function(r){ return r && r.name; }).map(function(r){ return { v:r.name, l:(App.codeName?App.codeName(r.code,r.name):((r.code?r.code+' - ':'')+r.name)) }; }); }
  function itemOpts(b){ var R=b.records||{};
    var qoh=function(r){ try{ return G('invItemStats')(b,r).qtyOnHand; }catch(e){ return null; } };
    var cn=function(r){ return App.codeName?App.codeName(r.code,r.name):((r.code?r.code+' - ':'')+r.name); };
    return ((R.inventory||[]).filter(function(r){ return r&&r.name; }).map(function(r){ var q=qoh(r); return { v:r.name, s:cn(r), l:cn(r)+(q!=null?'  —  Qty: '+q:''), g:'Inventory item' }; }))
      .concat((R.nonInvItems||[]).filter(function(r){ return r&&r.name; }).map(function(r){ return { v:r.name, l:cn(r), g:'Non-inventory item' }; })); }
  function itemRec(b,name){ var R=b.records||{}; var i=(R.inventory||[]).filter(function(r){ return r&&r.name===name; })[0]; if(i) return { typ:'inv', rec:i };
    var n=(R.nonInvItems||[]).filter(function(r){ return r&&r.name===name; })[0]; return n ? { typ:'non', rec:n } : null; }

  /* ---------------------------------------------------------- combo boxes */
  function combo(value, opts, onPick, ph, cls, qc, extra){
    var id='cb'+(++cbSeq); CB[id]={ opts:opts, pick:onPick, qc:qc||'' };
    var o=opts.filter(function(x){ return String(x.v)===String(value); })[0];
    var shown=o ? (o.s||o.l) : (!blank(value) ? value : (ph||''));
    return '<div class="cb '+(cls||'')+'"'+(extra||'')+'><button type="button" class="cb-btn" data-cb="'+id+'" onclick="TxnForms._cbOpen(\''+id+'\',this)">'+
      '<span class="'+(o||!blank(value)?'':'ph')+'">'+esc(shown)+'</span>'+
      ((o||!blank(value)) ? '<i class="cb-x" title="Clear" onclick="TxnForms._cbPick(event,\''+id+'\',\'\')">×</i>' : '')+
      '<i class="cb-car">▾</i></button></div>';
  }
  var cbPanel=null;
  function cbClose(){ if(cbPanel){ if(cbPanel.parentNode) cbPanel.parentNode.removeChild(cbPanel); cbPanel=null; } }
  /** a stand-in <select> so QuickCreate's dialog hands the new value back to a combo */
  function qcProxy(cb){ return { value:'', isConnected:true, options:{ length:0 }, setAttribute:function(){}, getAttribute:function(){ return null; },
    insertBefore:function(){}, focus:function(){}, dispatchEvent:function(e){ if(e && e.type==='change') cb(this.value); return true; } }; }
  function cbOpen(id, btn, seed){
    cbClose(); var c=CB[id]; if(!c) return; var d=doc(); if(!d || !btn.getBoundingClientRect) return;
    var rc=btn.getBoundingClientRect();
    var p=d.createElement('div'); p.className='cb-panel'; p.setAttribute('data-enter-nav','off');
    var sx=global.scrollX||global.pageXOffset||0, sy=global.scrollY||global.pageYOffset||0, vw=global.innerWidth||1024;
    var w=Math.max(rc.width,260); p.style.minWidth=w+'px';
    p.style.left=Math.max(8,Math.min(rc.left+sx, sx+vw-w-8))+'px'; p.style.top=(rc.bottom+sy+2)+'px';
    var canAdd=!!(c.qc && global.QuickCreate && QuickCreate.known && QuickCreate.known(c.qc));
    p.innerHTML='<input type="text" class="cb-q" aria-label="Search" autocomplete="off"><div class="cb-list" role="listbox"></div>';
    d.body.appendChild(p); cbPanel=p;
    var q=p.querySelector('.cb-q'), L=p.querySelector('.cb-list'), hi=0, cur=[];
    var after=navAfterPick(btn);
    var pick=function(v){ cbClose(); c.pick(v); after(); };
    var addNew=function(){ var text=q.value.trim(); cbClose();
      QuickCreate.open(c.qc, qcProxy(function(v){ c.pick(v, true); after(); }), text); };
    var draw=function(){ var s=q.value.toLowerCase();
      cur=c.opts.filter(function(o){ return (o.l+' '+(o.g||'')).toLowerCase().indexOf(s)>=0; }).slice(0,300);
      var max=cur.length-(canAdd?0:1); hi=Math.min(hi,Math.max(0,max));
      L.innerHTML=(cur.length ? cur.map(function(o,i){ return '<div class="cb-o'+(i===hi?' hi':'')+'" data-i="'+i+'"><span>'+esc(o.l)+'</span><small>'+esc(o.g||'')+'</small></div>'; }).join('')
          : '<div class="cb-none">No matches found</div>')+
        (canAdd ? '<div class="cb-o cb-add'+(hi===cur.length?' hi':'')+'" data-add="1"><span>+ Add new'+(q.value.trim()?' “'+esc(q.value.trim())+'”':'')+'</span><small>'+esc(QuickCreate.labelOf(c.qc))+'</small></div>' : '');
      var h=L.querySelector('.hi'); if(h && h.scrollIntoView) try{ h.scrollIntoView({ block:'nearest' }); }catch(e){} };
    if(seed) q.value=seed;
    draw(); try{ q.focus({ preventScroll:true }); }catch(e){}
    /* flip: near the bottom of the viewport the list opens upward */
    var vh=global.innerHeight||768, ph=p.offsetHeight||0;
    if(ph && rc.bottom+ph+4>vh && rc.top-ph-4>=0){ p.style.top=(rc.top+sy-ph-2)+'px'; p.classList.add('cb-up'); }
    q.oninput=function(){ hi=0; draw(); };
    q.onkeydown=function(e){ var max=cur.length-(canAdd?0:1);
      if(e.key==='ArrowDown'){ hi=Math.min(max,hi+1); draw(); e.preventDefault(); }
      else if(e.key==='ArrowUp'){ hi=Math.max(0,hi-1); draw(); e.preventDefault(); }
      else if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); if(canAdd && hi===cur.length) addNew(); else if(cur[hi]) pick(cur[hi].v); }
      else if(e.key==='Escape'){ e.preventDefault(); cbClose(); try{ btn.focus(); }catch(_){} }
      else if(e.key==='Tab'){ cbClose(); } };
    L.onmousedown=function(e){ var el=e.target.closest && e.target.closest('.cb-o'); if(!el) return; e.preventDefault();
      if(el.getAttribute('data-add')) addNew(); else pick(cur[+el.getAttribute('data-i')].v); };
  }

  /* ------------------------------------------------------------- rendering */
  function FL(label, inner, style, cls){ return '<div class="tf-f'+(cls?' '+cls:'')+'"'+(style?' style="'+style+'"':'')+'><label class="tf-l">'+label+'</label>'+inner+'</div>'; }
  function IN(k, v, o){ o=o||{}; var numf=o.num;
    return '<input type="text"'+(numf?' inputmode="decimal" class="numf'+(o.cls?' '+o.cls:'')+'"':(o.cls?' class="'+o.cls+'"':''))+' data-k="'+k+'" placeholder="'+esc(o.ph||'')+'" value="'+esc(v==null?'':v)+'"'+
      (o.ro?' readonly':'')+(o.w?' style="width:'+o.w+'"':'')+(o.redraw?' onchange="TxnForms._ch(this)"':' oninput="TxnForms._in(this)"')+'>'; }
  function SEL(k, v, opts, o){ o=o||{};
    return '<select data-k="'+k+'"'+(o.w?' style="width:'+o.w+'"':'')+' onchange="TxnForms._ch(this)">'+opts.map(function(x){ var val=Array.isArray(x)?x[0]:x, lab=Array.isArray(x)?x[1]:x;
      return '<option value="'+esc(val)+'"'+(String(val)===String(v==null?'':v)?' selected':'')+'>'+esc(lab)+'</option>'; }).join('')+'</select>'; }

  function headHtml(b,t){
    var S=SPEC[t.key], H=[], row=[];
    var flush=function(){ if(row.length){ H.push('<div class="tf-row2">'+row.join('')+'</div>'); row=[]; } };
    S.head.forEach(function(h){
      if(h==='date') row.push(FL(S.dateLabel||'Date','<input type="date" data-k="date" value="'+esc(t.date)+'" onchange="TxnForms._ch(this)" style="width:170px">'));
      else if(h==='due') row.push(FL('Due date','<div class="tf-ig">'+SEL('dueType',t.dueType||'Net',['Net','By'],{w:'80px'})+
          ((t.dueType||'Net')==='Net' ? IN('dueDays',t.dueDays,{num:1,w:'80px',ph:'0'})+'<span class="suf">days</span>'
            : '<input type="date" data-k="dueDateManual" value="'+esc(t.dueDateManual||'')+'" oninput="TxnForms._in(this)">')+'</div>'));
      else if(h==='ref') row.push(FL('Reference','<div class="tf-ig"><span><input type="checkbox" title="Automatic" aria-label="Automatic reference"'+(t.autoRef?' checked':'')+' onchange="TxnForms._refAuto(this.checked)"></span>'+
          '<input type="text" data-k="reference" placeholder="Automatic" value="'+esc(t.reference||'')+'"'+(t.autoRef?' readonly tabindex="-1"':'')+' oninput="TxnForms._in(this)" style="width:120px"></div>'));
      else {
        flush();
        if(h==='contact'){
          var kind=t.partyType||'other';
          var ctl = kind==='other'
            ? '<input type="text" data-k="party" placeholder="Optional" value="'+esc(t.party)+'" oninput="TxnForms._in(this)" style="width:300px">'
            : combo(t.party, partyOpts(b, kind==='customer'?'customers':'suppliers'), function(v){ setParty(v); }, '', 'grow'+(blank(t.party)?' need':''), kind);
          H.push(FL(S.partyLabel,'<div class="tf-ig wide" data-party><span>Contact</span>'+
            '<select class="party-type" aria-label="Contact type" onchange="TxnForms._partyType(this.value)">'+
              [['other','Other'],['customer','Customer'],['supplier','Supplier']].map(function(o){ return '<option value="'+o[0]+'"'+(o[0]===kind?' selected':'')+'>'+o[1]+'</option>'; }).join('')+'</select>'+
            ctl+'<input type="hidden" data-party-kind="'+esc(kind)+'" value="'+esc(t.party||'')+'"><span class="party-bal hide" data-party-bal></span></div>'));
        }
        else if(h==='bank'){ var bo=bankOpts(b,t.bank);
          H.push(FL(S.bankLabel,'<div class="tf-ig wide"><span>Account</span>'+combo(t.bank,bo,function(v){ TX.bank=v; draw(); },'',blank(t.bank)?'need':'','bank')+'</div>'+
            (!bo.length?'<div class="tf-hint">No bank or cash accounts yet — use “+ Add new” in the list.</div>':''))); }
        else if(h==='desc') H.push(FL('Description',IN('description',t.description,{ph:'Optional',w:'100%'}),'max-width:600px'));
        else if(h==='party'){
          var bal=custBadge(b,t.customer);
          H.push(FL('Customer','<div class="tf-ig wide">'+combo(t.customer,partyOpts(b,'customers'),function(v){ pickCustomer(v); },'','grow'+(blank(t.customer)?' need':''),'customer')+
            (bal?'<span class="party-bal'+(bal.amount< -0.005?' pb-neg':'')+'"><span class="pb-l">'+esc(bal.label)+'</span><span class="pb-v">'+money(bal.amount)+'</span></span>':'')+'</div>')); }
        else if(h==='address') H.push(FL(S.addrLabel,'<textarea data-k="billingAddress" rows="3" oninput="TxnForms._in(this)" style="max-width:420px;min-height:70px">'+esc(t.billingAddress||'')+'</textarea>'));
      }
    });
    flush();
    return H.join('')+divisionBar(b,t);
  }
  function custBadge(b,name){ if(blank(name)) return null; try{ return global.PartyBalance ? PartyBalance.balanceOf('customer',name) : null; }catch(e){ return null; } }
  function divisionBar(b,t){
    var divs=b.divisions||[], ps=(b.projects||[]).filter(function(p){ return p && p.name && p.status!=='Complete'; });
    if(!divs.length && !ps.length) return '';
    var h='<div class="tf-row2">';
    if(divs.length) h+=FL('Division','<select data-k="division" onchange="TxnForms._ch(this)"><option value="">— No division —</option>'+
      divs.map(function(d){ return '<option value="'+esc(d.id)+'"'+(t.division===d.id?' selected':'')+'>'+esc(d.name||'')+(d.code?' ('+esc(d.code)+')':'')+'</option>'; }).join('')+'</select>');
    if(ps.length) h+=FL('Project','<select data-k="project" onchange="TxnForms._ch(this)"><option value="">— No project —</option>'+
      ps.map(function(p){ return '<option value="'+esc(p.id)+'"'+(t.project===p.id?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('')+'</select>');
    return h+'</div>';
  }

  /** the column layout for the current options — same set and order as the source */
  function columns(b,t){
    var inv=isInv(t), C=[];
    var anyTax=taxCodes(b).length && (inv || t.lines.some(function(l){ return !taxHidden(b,t,l); }));
    var divs=!!t.colDivision;
    if(t.colLineNum) C.push({k:'lno',th:'#'});
    if(t.colItem) C.push({k:'item',th:'Item'});
    C.push({k:'account',th:'Account'});
    if(t.showDescCol) C.push({k:'desc',th:'Description'});
    if(qtyCol(t)) C.push({k:'qty',th:'Qty',num:1});
    C.push({k:'price',th:qtyCol(t)?'Unit price':'Amount',num:1});
    if(t.colDiscount) C.push({k:'discount',th:'Discount'+(t.discType==='Exact amount'?'':' %'),num:1});
    if(inv) C.push({k:'sub',th:'Amount',num:1});
    if(divs) C.push({k:'division',th:'Division'});
    extList().forEach(function(ex){ var on=false; try{ on=!!(ex.show && ex.show(b,t)); }catch(e){} if(on) C.push({k:'ext',th:ex.th,ex:ex}); });
    if(anyTax) C.push({k:'tax',th:'Tax Code'});
    if(t.showTaxCol && anyTax) C.push({k:'taxAmt',th:'Tax amount',num:1});
    C.push({k:'total',th:'Total',num:1});
    return C;
  }
  function hdrNum(k,v){ return '<input type="text" inputmode="decimal" class="numf n amt" data-k="'+k+'" value="'+esc(v==null?'':v)+'" oninput="TxnForms._in(this)">'; }
  function numIn(i,f,v,cls){ return '<input type="text" inputmode="decimal" class="numf n '+(cls||'')+'" data-l="'+i+'" data-f="'+f+'" value="'+esc(v==null?'':v)+'" oninput="TxnForms._in(this)">'; }
  function accCell(b,t,l,i){
    var node=acctById(b,l.account), it=!blank(l.item)?itemRec(b,l.item):null;
    if(it && node) return '<span class="acc-lock" title="Set by the item">'+esc(node.name)+'</span>';
    var cls=node?subClassOf(b,l.account):null, out=combo(l.account,acctOpts(b),function(v){ switchAccount(i,v); },'Select account',blank(l.account)?'acc need':'acc','account');
    if(cls){ var S=SUBS[cls];
      out+='<span class="ctl-l">'+esc(S.label)+'</span>'+combo(l.sub,subOptions(b,cls),function(v){ TX.lines[i].sub=v; draw(); },'', 'ctl'+(blank(l.sub)?' need':''), S.qc); }
    return out;
  }
  function linesHtml(b,t){
    var C=columns(b,t), T=totals(b,t), inv=isInv(t);
    var head='<tr>'+C.map(function(c){ return '<th'+(c.num?' class="num"':'')+'>'+esc(c.th)+'</th>'; }).join('')+'<th></th></tr>';
    var codes=taxCodes(b), divs=b.divisions||[];
    var rows=t.lines.map(function(l,i){ var lc=T.lines[i].c, node=acctById(b,l.account);
      var hidden='<input type="hidden" data-account-col value="'+esc(node?node.name:'')+'"><input type="hidden" data-subaccount-col value="'+esc(l.sub||'')+'">'+
                 '<input type="hidden" data-var="totalWithTax" data-hid-tot="'+i+'" value="'+lc.total+'">';
      return '<tr>'+C.map(function(c,ci){ var pre=ci===0?hidden:'';
        switch(c.k){
          case 'lno': return '<td class="lno">'+pre+(i+1)+'</td>';
          case 'item': return '<td class="itm">'+pre+combo(l.item,itemOpts(b),function(v){ pickItem(i,v); },'','', 'item')+'</td>';
          case 'account': return '<td>'+pre+'<div class="acc-cell">'+accCell(b,t,l,i)+'</div></td>';
          case 'desc': return '<td>'+pre+'<textarea rows="1" class="ld" data-l="'+i+'" data-f="desc" oninput="TxnForms._in(this)">'+esc(l.desc)+'</textarea></td>';
          case 'qty': return '<td>'+pre+numIn(i,'qty',l.qty,'sm')+'</td>';
          case 'price': return '<td class="amtc">'+pre+numIn(i,'price',l.price,'amt')+'</td>';
          case 'discount': return '<td>'+pre+numIn(i,'discount',l.discount,'sm')+'</td>';
          case 'sub': return '<td class="num tot" data-sub="'+i+'">'+pre+money(lc.gross)+'</td>';
          case 'division': return '<td>'+pre+'<select data-l="'+i+'" data-f="division" onchange="TxnForms._ch(this)"><option value=""></option>'+
              divs.map(function(d){ return '<option value="'+esc(d.id)+'"'+(l.division===d.id?' selected':'')+'>'+esc(d.name||'')+'</option>'; }).join('')+'</select></td>';
          case 'tax': return '<td>'+pre+(taxHidden(b,t,l)?'':'<select data-l="'+i+'" data-f="taxCode" onchange="TxnForms._ch(this)"><option value="">No tax</option>'+
              codes.map(function(x){ return '<option value="'+esc(x.name)+'"'+(x.name===l.taxCode?' selected':'')+'>'+esc(x.name)+'</option>'; }).join('')+'</select>')+'</td>';
          case 'taxAmt': return '<td class="num tot" data-tax="'+i+'">'+pre+money(lc.tax)+'</td>';
          case 'total': return '<td class="num tot" data-tot="'+i+'">'+pre+money(lc.total)+'</td>';
          case 'ext': var xh=''; try{ xh=c.ex.cell(b,t,l,i)||''; }catch(e){} return '<td class="tf-ext">'+pre+xh+'</td>';
        } return '<td>'+pre+'</td>'; }).join('')+
        '<td class="act"><button type="button" tabindex="-1" title="Move up" onclick="TxnForms._mv('+i+',-1)">↑</button><button type="button" tabindex="-1" title="Move down" onclick="TxnForms._mv('+i+',1)">↓</button><button type="button" tabindex="-1" title="Duplicate line" onclick="TxnForms._dup('+i+')">⧉</button><button type="button" tabindex="-1" title="Remove line" onclick="TxnForms._rm('+i+')">×</button></td></tr>'; }).join('');
    var incl=inv ? !!t.taxInclusive : !t.taxExclusive;
    var fr=function(lbl,val,id,cls){ return '<div class="tf-tr'+(cls?' '+cls:'')+'"><span class="tf-tl">'+lbl+'</span><span class="tf-tv num"'+(id?' id="'+id+'"':'')+'>'+val+'</span></div>'; };
    var foot='';
    if(!incl || T.taxOrder.length) foot+=fr('Subtotal',money(T.net),'txSub');
    T.taxOrder.forEach(function(k){ foot+='<div class="tf-tr taxr" data-taxr="'+esc(k)+'"><span class="tf-tl">'+esc(k)+(incl?' (included)':'')+'</span><span class="tf-tv num">'+money(T.taxes[k])+'</span></div>'; });
    if(inv && t.rounding) foot+=fr('Rounding',money(T.rnd),'txRnd');
    foot+=fr('Total',money(T.total),'txTotal','grand');
    if(inv && t.withholding){ var wt=t.whtType==='Rate'?'Rate':'Amount';
      foot+=fr('Withholding tax '+SEL('whtType',wt,[['Amount','Exact amount'],['Rate','Rate %']],{w:'130px'})+(wt==='Rate'?hdrNum('whtRate',t.whtRate):hdrNum('whtAmount',t.whtAmount)),'-'+money(T.wht),'txWht','wht');
      if(!t.hideBalanceDue) foot+=fr('Balance due',money(T.balance),'txBal','grand'); }
    if(t.fixedTotal){ foot+=fr('Fixed total',hdrNum('fixedTotalValue',t.fixedTotalValue),'');
      foot+=fr('Difference','<span class="'+(T.diff?'tf-neg':'')+'">'+money(T.diff)+'</span>','txDiff'); }
    return '<div class="lines-wrap"><table class="tx-ln" data-line-items><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div>'+
      '<div class="tf-under"><button type="button" class="btn btn-sm tf-add" onclick="TxnForms._addLine()">▸ Add line</button><div class="tf-totals">'+foot+'</div></div>';
  }
  function optsHtml(b,t){
    var list=OPTS[isInv(t)?'inv':'money'];
    var reveal={
      colDiscount:function(){ return SEL('discType',t.discType||'Percentage',['Percentage','Exact amount']); },
      rounding:function(){ return SEL('roundMode',t.roundMode||'Round to nearest',['Round to nearest','Round down']); },
      customTitleOn:function(){ return IN('customTitle',t.customTitle,{ph:SPEC[t.key].singular}); },
      colDivision:function(){ return (b.divisions||[]).length?'':'<span class="tf-hint">No divisions yet — add them in <a class="led-link" onclick="App.openSetting(\'divisions\')">Settings → Divisions</a>.</span>'; }
    };
    return '<div class="tf-opts">'+list.map(function(o){ var k=o[0];
      if(k==='taxExclusive') return '<label class="tf-chk"><input type="checkbox" data-opt="taxInclusive"'+(!t.taxExclusive?' checked':'')+' onchange="TxnForms._opt(\'taxExclusive\',!this.checked)">'+esc(o[1])+'</label>';
      var on=(k==='colQty'&&isInv(t))?t.colQty!==false:!!t[k];
      return '<label class="tf-chk"><input type="checkbox" data-opt="'+k+'"'+(on?' checked':'')+' onchange="TxnForms._opt(\''+k+'\',this.checked)">'+esc(o[1])+'</label>'+
        (t[k] && reveal[k] ? '<div class="tf-reveal">'+reveal[k]()+'</div>' : ''); }).join('')+'</div>';
  }
  function actionsHtml(b,t){
    var A=app(), lbl=key2label()[t.key], can=function(fn){ return A && typeof A[fn]==='function' ? !!A[fn](b,lbl) : true; };
    var h=(t.loadBlocked?'<div class="tf-errbox data-guard" role="alert">'+esc(t.loadBlocked)+'</div>':'')+'<div class="form-actions tx-actions">';
    if(t.mode!=='edit'){
      h+='<button type="button" class="btn btn-primary tx-save" onclick="TxnForms.save(\'create\')">Create</button>'+
         '<button type="button" class="btn tx-save2" onclick="TxnForms.save(\'another\')">Create &amp; add another</button>';
    } else {
      if(can('canEdit')) h+=(t.loadBlocked?'<button type="button" class="btn btn-primary tx-save" disabled title="'+esc(t.loadBlocked)+'">Update</button>':'<button type="button" class="btn btn-primary tx-save" onclick="TxnForms.save(\'update\')">Update</button>');
      if(can('canCreate')) h+='<button type="button" class="btn" onclick="TxnForms.cloneDoc()">Clone</button>';
      if(t.key==='salesInv' && KEY2('receipts') && can2('canCreate','receipts')) h+='<button type="button" class="btn" onclick="TxnForms.receivePayment()">Receive payment</button>';
      if(can('canDelete')) h+='<button type="button" class="btn btn-danger" onclick="TxnForms.del()">Delete</button>';
    }
    h+='<button type="button" class="btn" onclick="TxnForms.cancel()">Cancel</button>'+
       '<a class="tf-engine" role="button" tabindex="-1" onclick="TxnForms.setEngine(\''+t.key+'\',\'designed\')" title="Switch this document type to the Form Designer layout">Use Form Designer for this form</a></div>';
    return h;
    function KEY2(k){ return !!key2label()[k]; }
    function can2(fn,k){ return A && typeof A[fn]==='function' ? !!A[fn](b,key2label()[k]) : true; }
  }
  /** the full page: crumb + card. Drawn parts are refilled by draw(). */
  function pageHtml(b,t){
    var A=app(), S=SPEC[t.key], R=regOf(t.key)||{};
    var title=t.mode==='edit' ? (t.reference ? S.singular+' '+t.reference : 'Edit '+S.singular) : (R.newLabel||'New '+S.singular);
    cbSeq=0; CB={};
    var crumb=''; try{ crumb=A.recCrumb(R.label||key2label()[t.key], title); }catch(e){}
    return crumb+'<div class="card tf-card" id="txHost" data-enter-nav="off" data-tx-key="'+t.key+'">'+
      '<div class="tf-card-h"><h2>'+esc(S.singular)+'</h2></div>'+
      '<div id="txErr"></div><div id="txHead">'+headHtml(b,t)+'</div>'+
      '<div id="txLines" class="li-wrap tf-lines">'+linesHtml(b,t)+'</div>'+
      '<div id="txOpts">'+optsHtml(b,t)+'</div>'+
      actionsHtml(b,t)+'</div>';
  }

  /* ------------------------------------------------------- state mutation */
  function cur(){ return biz(); }
  function draw(){
    if(!TX) return; var b=cur(); if(!b) return;
    cbSeq=0; CB={};
    var h=byId('txHead'), l=byId('txLines'), o=byId('txOpts');
    if(h) h.innerHTML=headHtml(b,TX); if(l) l.innerHTML=linesHtml(b,TX); if(o) o.innerHTML=optsHtml(b,TX);
    afterChange(true);
    hooks('onDraw').forEach(function(fn){ try{ fn(b,TX); }catch(e){} });
  }
  var allocTimer=0;
  function afterChange(now){
    var run=function(){ allocTimer=0; try{ if(global.Allocations && isMounted()){ Allocations.refresh(); if(!(Allocations.isAsking && Allocations.isAsking())) goodSnap=snapOf(TX); } }catch(e){} try{ if(global.PartyBalance && isMounted()) PartyBalance.update(); }catch(e){} };
    if(now){ if(allocTimer){ clearTimeout(allocTimer); allocTimer=0; } run(); }
    else if(!allocTimer) allocTimer=setTimeout(run,120);
  }
  /* the form as it was when the allocation panel last agreed with it: a cancelled
     "Changing the customer clears the invoice lines" puts this back */
  var goodSnap=null;
  function snapOf(t){ return t ? clone({ party:t.party, partyType:t.partyType, lines:t.lines }) : null; }
  function revertToSnap(){ if(!TX || !goodSnap) return false; var s=clone(goodSnap); TX.party=s.party; TX.partyType=s.partyType; TX.lines=s.lines; draw(); return true; }
  function isMounted(){ var h=byId('txHost'); return !!(h && h.querySelector && h.querySelector('#allocPanel') && !isInv(TX)); }
  function setVal(el){
    var v=el.type==='checkbox' ? !!el.checked : el.value;
    var li=el.getAttribute('data-l'), f=el.getAttribute('data-f'), k=el.getAttribute('data-k');
    if(li!=null && li!=='' && f){ var l=TX.lines[+li]; if(l) l[f]=v; return; }
    if(k) TX[k]=v;
  }
  function updTotals(){
    var b=cur(); if(!b||!TX) return; var T=totals(b,TX), d=doc(); if(!d||!d.querySelector) return;
    var host=byId('txHost'); if(!host || !host.querySelector) return;
    var set=function(sel,v){ var e=host.querySelector(sel); if(e) e.textContent=v; };
    T.lines.forEach(function(x,i){ set('[data-tot="'+i+'"]',money(x.c.total)); set('[data-tax="'+i+'"]',money(x.c.tax)); set('[data-sub="'+i+'"]',money(x.c.gross));
      var hv=host.querySelector('[data-hid-tot="'+i+'"]'); if(hv) hv.value=x.c.total; });
    set('#txSub',money(T.net)); set('#txRnd',money(T.rnd)); set('#txTotal',money(T.total));
    set('#txWht','-'+money(T.wht)); set('#txBal',money(T.balance));
    host.querySelectorAll('.taxr').forEach(function(tr){ var k=tr.getAttribute('data-taxr'); var c=tr.children[1]; if(c) c.textContent=money(T.taxes[k]||0); });
    var df=host.querySelector('#txDiff'); if(df){ df.innerHTML='<span class="'+(T.diff?'tf-neg':'')+'">'+money(T.diff)+'</span>'; }
  }
  function setParty(v){ TX.party=v||''; var b=cur(); defaultCtrlLine(b);
    TX.lines.forEach(function(l){ var cls=subClassOf(b,l.account); if(blank(l.sub) && ((cls==='customers'&&TX.partyType==='customer')||(cls==='suppliers'&&TX.partyType==='supplier'))) l.sub=TX.party; });
    draw(); }
  /** Receipt from a customer / payment to a supplier: an empty line defaults to Accounts receivable / payable for that party. */
  function defaultCtrlLine(b){ if(!TX || isInv(TX) || !b) return; var pt=TX.partyType; if(pt!=='customer'&&pt!=='supplier') return;
    var ctl=null; try{ ctl=G('GL').sysAcct(b, pt==='customer'?'accounts receivable':'accounts payable', true); }catch(e){} if(!ctl) return;
    var used=TX.lines.filter(function(l){ return !blank(l.account); });
    if(used.length && used.some(function(l){ return l.account!==ctl.id; })) return;   // the user already chose other accounts
    var l=TX.lines.filter(function(x){ return blank(x.account) || x.account===ctl.id; })[0]; if(!l) return;
    l.account=ctl.id; l.sub=TX.party||''; l.taxCode=''; }
  function pickCustomer(v){ TX.customer=v||''; var b=cur(), c=partyRec(b,'customers',v);
    if(c){ var addr=String(c.address||'').trim(), trn=String(c.trn||'').trim(); var comp=addr+(trn?(addr?'\n\n':'')+'TRN: '+trn:'');
      if(comp) TX.billingAddress=comp;
      if(!blank(c.dueDays) && blank(TX.dueDays) && (TX.dueType||'Net')==='Net') TX.dueDays=c.dueDays; }
    draw(); }
  /* switching account: park the sub-ledger choice, restore the one for the new control type (source switchAccount) */
  function switchAccount(i,v){ var b=cur(), l=TX.lines[i]; l.memo=l.memo||{};
    if(!blank(v) && !acctById(b,v)){ var byName=acctByName(b,v); v=byName?byName.id:''; }   // "+ Add new" hands back the new account's name
    var oc=subClassOf(b,l.account); if(oc && l.sub) l.memo[oc]=l.sub;
    l.account=v||''; l.sub='';
    var nc=subClassOf(b,l.account);
    if(nc){ l.sub=l.memo[nc]||'';
      var pt=isInv(TX)?'customer':TX.partyType, party=isInv(TX)?TX.customer:TX.party;
      if(!l.sub && nc==='customers' && pt==='customer') l.sub=party||'';
      if(!l.sub && nc==='suppliers' && pt==='supplier') l.sub=party||''; }
    hooks('onAccount').forEach(function(fn){ try{ fn(b,TX,l,i); }catch(e){} });
    draw(); }
  function pickItem(i,v){ var b=cur(), l=TX.lines[i], A=app(); l.item=v||'';
    var f=v?itemRec(b,v):null, buy=SPEC[TX.key].buy;
    if(f){ var it=f.rec, inv=isInv(TX);
      if(!inv && TX.colQty && blank(l.qty)) l.qty='1';
      var pr=buy?it.purchasePrice:it.salesPrice; if(!blank(pr)) l.price=String(pr);
      if(!blank(it.taxCode) && taxCodes(b).some(function(c){ return c.name===it.taxCode; })) l.taxCode=it.taxCode;
      if(!blank(it.description) && blank(l.desc)){ l.desc=it.description; TX.showDescCol=true; }
      var acct=null;
      if(f.typ==='inv'){
        if(buy){ acct=acctByName(b,'Inventory on hand'); if(acct) l.sub=it.name; }
        else { acct=acctByName(b,'Inventory - sales');
          if(!acct){ try{ var bb=A.curBiz(); G('ensureInventoryAccounts')(bb); A.saveBiz(bb); b=bb; acct=acctByName(bb,'Inventory - sales'); }catch(e){} }
          if(!acct){ acct=(b.coa||[]).filter(function(n){ return n.type==='account' && acctRootOf(b,n)==='income'; })[0]||null; } }
      } else { var ref=buy?it.purchaseAccount:it.salesAccount; acct=acctById(b,ref)||acctByName(b,ref); }
      if(acct) l.account=acct.id;
    }
    draw(); }

  /* ---------------------------------------------------- keyboard navigation */
  var NAV_SEL='input:not([type=hidden]):not([type=file]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]), .cb-btn';
  function visible(x){ return x.offsetParent!==null || (x.getClientRects && x.getClientRects().length>0); }
  function navFields(root){ return Array.prototype.slice.call(root.querySelectorAll(NAV_SEL)).filter(function(x){ return visible(x) && !(x.closest && x.closest('.cb-x')); }); }
  function focusEl(x){ if(!x) return false; try{ x.focus(); }catch(e){ return false; }
    if(x.select && x.tagName==='INPUT' && /^(text|search)$/.test(x.type)){ try{ x.select(); }catch(e){} } return true; }
  function host(){ return byId('txHost'); }
  function navNext(el){ var h=host(); if(!h) return false; var L=navFields(h), i=L.indexOf(el), cfg=navCfg(cur());
    if(i>-1 && i<L.length-1) return focusEl(L[i+1]);
    if(cfg.lastToSave){ var s=h.querySelector('.tx-save'); if(s) return focusEl(s); }
    return false; }
  function navPrev(el){ var h=host(); if(!h) return false; var L=navFields(h), i=L.indexOf(el); return i>0 ? focusEl(L[i-1]) : false; }
  /** after a pick the form redraws — keep the cursor moving forward from where the combo was */
  function navAfterPick(btn){ var h=host(); var i=h?navFields(h).indexOf(btn):-1;
    return function(){ setTimeout(function(){ var hh=host(); if(!hh) return; var L=navFields(hh); if(i>-1 && L[i+1]) focusEl(L[i+1]); else if(i>-1 && L[i]) focusEl(L[i]); },0); }; }
  var ARM={ el:null, dir:'' };
  function onKey(e){
    var el=e.target, b=cur(), cfg=navCfg(b);
    if(!el || !el.closest || e.altKey || e.ctrlKey || e.metaKey) return;
    if(el.closest('.cb-panel') || el.closest('.alloc-sec') && el.classList.contains('alloc-pick')) return;
    if(!el.matches || !el.matches(NAV_SEL)) return;
    var isText=(el.tagName==='INPUT' && /^(text|search)$/.test(el.type)) || el.tagName==='TEXTAREA';
    if(el.classList.contains('cb-btn') && e.key && e.key.length===1 && /\S/.test(e.key)){
      e.preventDefault(); var id=el.getAttribute('data-cb'); cbOpen(id, el, e.key); return; }
    if(e.key==='Enter' && cfg.enter){
      if(el.classList.contains('cb-btn')) return;                       // Enter opens the list
      if(el.tagName==='TEXTAREA' && e.shiftKey && cfg.newLine) return;  // Shift+Enter = new line
      e.preventDefault();
      var tr=el.closest('table.tx-ln tbody tr');
      if(cfg.autoLine && tr && !tr.nextElementSibling){
        var rowF=navFields(tr);
        var filled=Array.prototype.some.call(tr.querySelectorAll('input:not([type=hidden]),textarea'),function(x){ return !blank(x.value); }) ||
                   Array.prototype.some.call(tr.querySelectorAll('.cb-btn span:not(.ph)'),function(s){ return !blank(s.textContent); });
        if(rowF[rowF.length-1]===el && filled){ addLine(); setTimeout(function(){ var h=host(); if(!h) return; var rows=h.querySelectorAll('table.tx-ln tbody tr'); var last=rows[rows.length-1]; if(last) focusEl(navFields(last)[0]); },0); return; }
      }
      navNext(el); return;
    }
    if(!cfg.arrows || (e.key!=='ArrowRight' && e.key!=='ArrowLeft') || e.shiftKey){ ARM={ el:null, dir:'' }; return; }
    if(el.tagName==='SELECT' || (el.tagName==='INPUT' && el.type==='date')) return;
    var dir=e.key==='ArrowRight'?'r':'l', atEdge=true;
    if(isText){ var s=el.selectionStart, en=el.selectionEnd, n=String(el.value||'').length; atEdge=(s===en) && (dir==='r' ? en===n : s===0); }
    if(!atEdge){ ARM={ el:null, dir:'' }; return; }
    if(ARM.el===el && ARM.dir===dir){ e.preventDefault(); ARM={ el:null, dir:'' }; if(dir==='r') navNext(el); else navPrev(el); return; }
    ARM={ el:el, dir:dir };
  }
  function onBeforeInput(e){ var t=e.target; if(t && t.classList && t.classList.contains('numf') && e.data && !/^[0-9.,\-]+$/.test(e.data)) e.preventDefault(); }
  var docWired=false;
  function wireDocument(){ if(docWired) return; var d=doc(); if(!d || !d.addEventListener) return; docWired=true;
    d.addEventListener('mousedown',function(e){ if(cbPanel && !cbPanel.contains(e.target) && !(e.target.closest && e.target.closest('.cb'))) cbClose(); ARM={ el:null, dir:'' }; },true);
    /* the workspace scrolls inside #wsMain, not the page: a floating list would drift, so close it */
    d.addEventListener('scroll',function(e){ if(cbPanel && !(e.target && e.target.nodeType===1 && cbPanel.contains(e.target))) cbClose(); },true);
    global.addEventListener && global.addEventListener('resize',function(){ cbClose(); }); }

  /* ------------------------------------------------------------ line ops */
  function addLine(){ TX.lines.push(blankLine(TX)); draw(); }

  /* -------------------------------------------------------- public API */
  var TxnForms = {
    KEYS:KEYS, SPEC:SPEC, OPTS:OPTS, ext:{ cols:[], onAccount:[], onDraw:[] },
    redraw:function(){ draw(); },
    handles:handles, engineOf:engineOf, navCfg:navCfg,
    start:start, lineCalc:function(b,t,l){ return lineCalc(b,t,l); }, totals:totals, validate:validate, buildRecord:buildRecord,
    taxInfo:taxInfo, codeOfLine:codeOfLine, usedLines:usedLines, subClassOf:subClassOf,
    headHtml:headHtml, linesHtml:linesHtml, optsHtml:optsHtml, columns:columns,
    state:function(){ return TX; }, setState:function(t){ TX=t; },

    /** Called by App.formHtml when this engine owns the form: build state + markup. */
    formHtml:function(b,key){
      var A=app(); var rec=null, mode='new';
      if(A.editingId!=null){ rec=(((b.records||{})[key])||[]).filter(function(r){ return r.id===A.editingId; })[0]||null; if(rec) mode='edit'; }
      if(!rec && A._prefill){ rec=clone(A._prefill); mode='new'; }
      TX=start(b,key,rec,mode);
      if(mode==='new') A._prefill=null;
      return pageHtml(b,TX);
    },
    /** Called once the markup is in the DOM: wire listeners, allocation panel, party badge, focus. */
    mount:function(key){
      var h=host(); if(!h || !TX) return; wireDocument();
      if(!h._txWired){ h._txWired=true; h.addEventListener('keydown',onKey,true); h.addEventListener('beforeinput',onBeforeInput,true); }
      if(!isInv(TX)){
        /* the multi-invoice panel: a new receipt from "Receive payment" / Copy to arrives with its lines */
        try{ if(global.Allocations){ goodSnap=snapOf(TX);
          Allocations.mount(h,key,{ allocations:(TX.mode!=='edit' ? TX.allocations : null), revert:revertToSnap });
          goodSnap=snapOf(TX); } }catch(e){}
        try{ if(global.PartyBalance) PartyBalance.mount(h,key); }catch(e){}
      }
      try{ if(global.QuickCreate) QuickCreate.scan(h); }catch(e){}
      var first=navFields(h)[0]; if(first && TX.mode!=='edit') focusEl(first);
    },

    /* inline handlers */
    _in:function(el){ if(!TX) return; setVal(el); updTotals(); afterChange(false); },
    _ch:function(el){ if(!TX) return; setVal(el);
      /* redraw, then put the cursor back on the same control */
      var k=el.getAttribute('data-k'), f=el.getAttribute('data-f'), li=el.getAttribute('data-l');
      var sel=k ? '[data-k="'+k+'"]' : (f ? '[data-l="'+li+'"][data-f="'+f+'"]' : '');
      draw();
      var h=host(); if(sel && h && h.querySelector){ var n=h.querySelector(sel); if(n) try{ n.focus(); }catch(e){} } },
    _opt:function(k,on){ if(!TX) return; TX[k]=!!on; if(k==='rounding' && on && !TX.roundMode) TX.roundMode='Round to nearest'; draw();
      var h=host(), n=h && h.querySelector && h.querySelector('[data-opt="'+k+'"]'); if(n) try{ n.focus(); }catch(e){} },
    _refAuto:function(on){ var b=cur(); TX.autoRef=!!on; if(on) TX.reference=nextRef(b,TX.key); draw(); var r=host()&&host().querySelector('[data-k="reference"]'); if(r && !on) focusEl(r); },
    _partyType:function(v){ TX.partyType=v; TX.party=''; defaultCtrlLine(cur()); draw(); },
    _cbOpen:function(id,btn){ cbOpen(id,btn,''); },
    _cbPick:function(e,id,v){ if(e){ e.stopPropagation(); e.preventDefault && e.preventDefault(); } cbClose(); var c=CB[id]; if(c) c.pick(v); },
    _addLine:function(){ addLine(); },
    _dup:function(i){ if(!TX||!TX.lines[i]) return; TX.lines.splice(i+1,0,clone(TX.lines[i])); draw(); },
    _rm:function(i){ TX.lines.splice(i,1); if(!TX.lines.length) TX.lines.push(blankLine(TX)); draw(); },
    _mv:function(i,d){ var A=TX.lines, j=i+d; if(j<0||j>=A.length) return; var x=A[i]; A[i]=A[j]; A[j]=x; draw(); },
    _pickItem:function(i,v){ pickItem(i,v); }, _switchAccount:function(i,v){ switchAccount(i,v); },
    _setParty:function(v){ setParty(v); }, _pickCustomer:function(v){ pickCustomer(v); },

    /**
     * Validate and store. act: 'create' | 'another' | 'update'. Returns the
     * saved record, or null (errors are shown in the form's error box).
     * opts.noNav skips the navigation afterwards (tests).
     */
    save:function(act,opts){
      opts=opts||{}; var A=app(), b=A.curBiz(); if(!b || !TX) return null;
      var key=TX.key, lbl=key2label()[key], editing=TX.mode==='edit' && TX.id!=null;
      var perm=editing ? 'canEdit' : 'canCreate';
      if(typeof A[perm]==='function'){ if(!A[perm](b,lbl)){ alert('Your permissions do not allow '+(editing?'changing':'creating')+' '+SPEC[key].singular.toLowerCase()+'s.'); return null; } }
      else if(A.guardWrite && !A.guardWrite(b)) return null;
      var E=validate(b,TX); if(editing && TX.loadBlocked) E.unshift(TX.loadBlocked);
      if(!isInv(TX) && isMounted()){ try{ var bad=Allocations.validate(); if(bad) E.push(bad); else TX.allocations=Allocations.collect(); }catch(e){} }
      var box=byId('txErr');
      if(E.length){ if(box){ box.innerHTML='<div class="tf-errbox" role="alert">'+E.map(esc).join('<br>')+'</div>'; try{ box.scrollIntoView({block:'center'}); }catch(e){} } return { errors:E }; }
      if(box) box.innerHTML='';
      var rec=buildRecord(b,TX);
      var arr=((b.records=b.records||{})[key]||[]).slice(), before=null;
      if(editing){
        var idx=arr.findIndex(function(x){ return x.id===TX.id; });
        before=idx>=0 ? clone(arr[idx]) : null;
        var merged=Object.assign({}, idx>=0?arr[idx]:{}, rec); merged.id=TX.id; if(!merged.uuid) merged.uuid=A.uuid();
        if(idx>=0) arr[idx]=merged; else arr.push(merged); rec=merged;
      } else {
        if(TX.autoRef || blank(rec.reference)) rec.reference=nextRef(b,key);
        rec.id=Date.now()+Math.floor(Math.random()*1000); rec.uuid=A.uuid(); arr.push(rec);
      }
      b.records[key]=arr;
      try{ if(b.coa){
        A.ensureControlsFor(b,key,rec);
        if(!isInv(TX)) G('ensureCashControl')(b);
        rec.lines.forEach(function(ln){ var c=subClassOf(b,ln.account); if(c==='capital') G('ensureCapitalControl')(b); });
        G('ensureAllControls')(b); } }catch(e){}
      try{ G('refreshSummary')(b); }catch(e){}
      try{ A._logActivity(b, editing?'update':'create', key, rec, before); }catch(e){}
      A.saveBiz(b);
      try{ A.toast && A.toast(editing?'Updated':'Created'); }catch(e){}
      if(opts.noNav) return rec;
      if(act==='another'){ A.editingId=null; A._prefill=null; A.recReturn=null; A.wsMode='form'; A.renderMain(A.curBiz()); return rec; }
      A.editingId=null; if(!(A.backFromRecord && A.backFromRecord())) A.backToList();
      return rec;
    },
    cancel:function(){ var A=app(); cbClose(); TX=null; if(!(A.backFromRecord && A.backFromRecord())) A.backToList(); },
    cloneDoc:function(){ var A=app(); cbClose(); A.cloneRecord(); },
    del:function(){ var A=app(); if(TX && TX.id!=null) A.deleteRecord(TX.id); },
    /** "Receive payment": a new receipt for this invoice's customer and balance due, allocated to it */
    receivePayment:function(){ var A=app(), b=A.curBiz(); if(!TX||TX.id==null) return;
      var inv=(((b.records||{}).salesInv)||[]).filter(function(r){ return r.id===TX.id; })[0]; if(!inv) return;
      var pf=TxnForms.receiptPrefill(b,inv); A._prefill=pf; A.recReturn=null; A.histReturn=false; A.editingId=null;
      A.wsSection=key2label().receipts; A.wsMode='form'; A.renderWorkspace(); },
    /** Prefill for a receipt that settles `inv` (used by Receive payment and Copy to > Receipt). */
    receiptPrefill:function(b,inv){
      var due=null; try{ var row=G('settlementIndex')(b,'cust').byUid[G('invUid')(inv)]; if(row) due=row.outstanding; }catch(e){}
      if(due==null) due=inv.balanceDue!=null ? Number(inv.balanceDue) : Number(inv.total)||0;
      due=r2(due);
      var ar=acctByName(b,'Accounts receivable');
      var uid=''; try{ uid=G('invUid')(inv); }catch(e){ uid=inv.uuid||('id:'+inv.id); }
      return { date:today(), paidByType:'customer', paidBy:inv.customer||'', customer:inv.customer||'',
        description:'Payment for sales invoice '+(inv.reference||''),
        lines:[{ account:ar?ar.id:'', accountName:'Accounts receivable', sub:inv.customer||'', amount:due, price:due }],
        _keepAlloc:true, allocations: due>0 && uid ? [{ key:'salesInv', uid:uid, party:inv.customer||'', amount:due }] : [] };
    },
    /** Per-business switch between this engine and the Form Designer path. */
    setEngine:function(key,engine){ var A=app(), b=A.curBiz(); if(!b) return; b.formEngine=b.formEngine||{};
      if(engine==='designed') b.formEngine[key]='designed'; else delete b.formEngine[key];
      A.saveBiz(b); cbClose(); A.renderMain(A.curBiz()); }
  };
  global.TxnForms = TxnForms;
})(typeof window !== 'undefined' ? window : this);
