/* ===================== Form-HTML-Editor bridge (additive) ===================== */
(function(){
  var KEY='mgr_form_templates';
  function read(){ try{ return JSON.parse(localStorage.getItem(KEY)||'null'); }catch(e){ return null; } }
  function write(b){ try{ localStorage.setItem(KEY, JSON.stringify(b)); }catch(e){} }
  var MF = window.MgrForms = {
    bundle: read(),
    has:function(k){ return !!(this.bundle && this.bundle.templates && this.bundle.templates[k]); },
    tpl:function(k){ return (this.bundle && this.bundle.templates && this.bundle.templates[k]) || null; },
    list:function(){ return this.bundle && this.bundle.templates ? Object.keys(this.bundle.templates) : []; },
    /* open a designed form in a print-ready window, optionally bound to a data record */
    open:function(key,data){
      var t=this.tpl(key); if(!t){ alert('No design published for this document yet.\nDesign it in Settings → Custom Themes, then click Publish to app.'); return; }
      data=data||{};
      var w=window.open('','_blank'); if(!w){ alert('Allow pop-ups to open the form.'); return; }
      var bar='<div class="mf-bar" style="position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;background:#0f1115;border-bottom:1px solid #2a2f3a">'
        +'<button onclick="window.print()" style="padding:7px 16px;border:0;border-radius:9px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Print</button>'
        +'<button onclick="window.close()" style="padding:7px 14px;border:1px solid #3a4150;border-radius:7px;background:#1b1f27;color:#cfd6e2;cursor:pointer">Close</button></div>';
      var fill='<scr'+'ipt>(function(){'
        +'var DATA='+JSON.stringify(data)+';'
        +'function set(el,v){ if(!el) return; if(el.type==="checkbox"){ el.checked=(v===true||v==="1"||v===1||v==="true"); } else { el.value=(v==null?"":v); } }'
        +'var form=document.querySelector(".app-form"); if(!form) return;'
        +'Object.keys(DATA).forEach(function(k){ if(k==="lines") return; form.querySelectorAll("[data-field-var=\\""+k+"\\"]").forEach(function(el){ set(el,DATA[k]); }); });'
        +'var tbl=document.querySelector("[data-line-items]");'
        +'if(tbl && tbl.tBodies[0] && Array.isArray(DATA.lines)){ var tb=tbl.tBodies[0]; var proto=tb.rows[0]; if(proto){ tb.innerHTML=""; DATA.lines.forEach(function(ln){ var r=proto.cloneNode(true); Object.keys(ln).forEach(function(k){ r.querySelectorAll("[data-var=\\""+k+"\\"]").forEach(function(el){ set(el,ln[k]); }); }); tb.appendChild(r); }); } }'
        +'form.querySelectorAll("input,select,textarea").forEach(function(el){ el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); });'
        +'})();</scr'+'ipt>';
      var printCss='<style>@media print{.mf-bar{display:none!important}}</style>';
      w.document.open();
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+(t.label||key)+'</title>'+printCss+'</head><body style="margin:0;background:#eef0f3">'+bar+'<div style="padding:18px">'+t.html+'</div>'+fill+'</body></html>');
      w.document.close();
    }
  };
  MF.refresh=function(){ try{ if(App && App.openBiz!=null && typeof App.renderWorkspace==='function'){ App.renderWorkspace(); } }catch(e){} };
  MF.applyBundle=function(bundle){ this.bundle=bundle; write(bundle); this.refresh(); var n=bundle&&bundle.templates?Object.keys(bundle.templates).length:0; try{ App.toast&&App.toast('Published '+n+' form design'+(n===1?'':'s')+' to the app'); }catch(e){} };
  App.fmtCatOf=function(key){ var map={ voucher:['receipts','payments'], form:['salesInv','purchInv','salesQuotes','purchQuotes','salesOrders','purchOrders','creditNotes','debitNotes','deliveryNotes','goodsRec'], records:['customers','suppliers','bankCash','inventory','fixedAssets','employees'], ledger:['journal','payslips','depreciation'] }; for(var c in map){ if(map[c].indexOf(key)>=0) return c; } return 'form'; };
  App.advDesignerHtml=function(b,key){ var name=(this.fmtFormName?this.fmtFormName(key):key); var cat=this.fmtCat||this.fmtCatOf(key); var tpl=document.getElementById('fedTpl'); var host=tpl?tpl.innerHTML:'<div class="card">Designer unavailable.</div>'; return this.crumbThemes(name)+'<div class="info-bar">Design the printed <b>'+this.esc(name)+'</b> layout. Add fields &amp; columns, set cell types, then click <b>Publish to app</b> to apply.</div>'+host+'<div class="form-actions" style="margin-top:10px"><button class="btn" onclick="App.openFmtCat(\''+cat+'\')">◀ Back</button></div>'; };
  App._mountInlineDesigner=function(key){ if(!document.getElementById('fedHost')) return; if(!window.FED){ return; } window.__fedExit=function(){ try{ App._restoreNav(App._fedReturn); }catch(e){ try{ App.openFmtCat(App.fmtCat||App.fmtCatOf(App.fmtForm)); }catch(_){} } }; App.pushAppLists(); try{ FED.init(); FED.openDocByKey(key); }catch(e){ if(window.console) console.warn('designer mount',e); } };
  /* map a saved accounting record onto the designer's field tokens (data-field-var / line data-var) */
  App.acctIdByName=function(b,name){ if(name==null||name==='') return ''; b=b||this.curBiz()||{}; var t=String(name).trim().toLowerCase(); var hit=(b.coa||[]).find(function(n){ return String(n.name||'').trim().toLowerCase()===t; }); return hit?hit.id:''; };
  App.mapRecordToTokens=function(key,rec){ rec=rec||{}; var d={};
    if(rec.issueDate!=null) d.date=rec.issueDate; if(d.date==null&&rec.date!=null) d.date=rec.date; if(rec.dueDate!=null) d.dueDate=rec.dueDate;
    if(rec.reference!=null){ var rv=rec.reference; ['reference','saleInvoiceNo','purchaseInvoiceNo','saleQuoteNo','purchaseOrderNo','deliveryNoteNo','creditNoteNo','debitNoteNo','receiptNo','paymentNo','journalNo'].forEach(function(t){ d[t]=rv; }); }
    if(rec.customer!=null) d.custName=rec.customer; if(rec.supplier!=null) d.supName=rec.supplier; if(rec.employee!=null) d.empName=rec.employee; if(rec.description!=null) d.description=rec.description;
    if(key==='payments'&&rec.paidFrom!=null) d.bankName=rec.paidFrom;
    if(key==='receipts'&&rec.receivedIn!=null) d.bankName=rec.receivedIn;
    if(key==='fixedAssets'){ if(rec.name!=null)d.faName=rec.name; if(rec.acqDate!=null)d.faDate=rec.acqDate; if(rec.cost!=null)d.faCost=rec.cost; if(rec.accumDep!=null)d.faAccDep=rec.accumDep; if(rec.code!=null)d.faCode=rec.code; if(rec.depRate!=null)d.faDepRate=rec.depRate; }
    if(key==='capital'){ if(rec.name!=null)d.capName=rec.name; if(rec.balance!=null)d.capBalance=rec.balance; if(rec.code!=null)d.capCode=rec.code; if(rec.description!=null)d.capDesc=rec.description; }
    if(key==='depreciation'){ if(rec.method!=null)d.depMethod=rec.method; }
    try{ var b=App.curBiz(); if(b&&b.records){ if(rec.customer){ var cu=(b.records.customers||[]).filter(function(x){return (x.name||x.customer)===rec.customer;})[0]; if(cu){ d.custTRN=cu.trn||cu.taxNumber||cu.vat||''; d.custAddress=cu.address||cu.billingAddress||''; d.custEmail=cu.email||''; d.custMobile=cu.phone||cu.mobile||''; d.custCode=cu.code||''; } }
      if(rec.supplier){ var su=(b.records.suppliers||[]).filter(function(x){return (x.name||x.supplier)===rec.supplier;})[0]; if(su){ d.supTRN=su.trn||su.taxNumber||''; d.supAddress=su.address||''; d.supEmail=su.email||''; d.supMobile=su.phone||su.mobile||''; d.supCode=su.code||''; } } } }catch(e){}
    var _srcLines=(App._linesForEdit?App._linesForEdit(key,rec):rec.lines); if(Array.isArray(_srcLines)){ d.lines=_srcLines.map(function(ln){ var o={}; Object.keys(ln).forEach(function(k){ o[k]=ln[k]; }); if(o.items==null) o.items=(ln.item||ln.desc||''); if(o.description==null) o.description=(ln.desc||''); if(o.qty==null) o.qty=(ln.qty!=null?ln.qty:''); if(o.price==null) o.price=(ln.price!=null?ln.price:''); if(o.amountNoTax==null) o.amountNoTax=(ln.net!=null?ln.net:(ln.amount!=null?ln.amount:'')); if(o.totalWithTax==null) o.totalWithTax=(ln.amount!=null?ln.amount:''); if(o.taxRate==null||o.taxRate===''){ var rt=ln.taxRate; if(rt==null||rt===''){ try{ rt=App.taxRate?App.taxRate(ln.tax):''; }catch(e){ rt=''; } } o.taxRate=(rt==null?'':rt); } var an=(ln.accountName!=null&&ln.accountName!=='')?ln.accountName:''; if(!an&&ln.account){ try{ var nn=((b&&b.coa)||[]).find(function(x){return x.id===ln.account;}); if(nn) an=nn.name; }catch(e){} } if(!an&&ln.accounts!=null&&ln.accounts!=='') an=ln.accounts; if(!an&&typeof ln.account==='string') an=ln.account; if(an){ o.account=an; o.accounts=an; } o.amount=(ln.amount!=null?ln.amount:(o.totalWithTax!=null?o.totalWithTax:'')); o.debit=(ln.debit!=null?ln.debit:''); o.credit=(ln.credit!=null?ln.credit:''); if(key==='journal'){ o.amountNoTax=(ln.debit!=null&&ln.debit!=='')?ln.debit:''; o.totalWithTax=(ln.credit!=null&&ln.credit!=='')?ln.credit:''; } else { if((o.amountNoTax==null||o.amountNoTax==='')&&ln.debit!=null&&ln.debit!=='') o.amountNoTax=ln.debit; if((o.totalWithTax==null||o.totalWithTax==='')&&ln.credit!=null&&ln.credit!=='') o.totalWithTax=ln.credit; } if((o.subAccount==null||o.subAccount==='')&&ln.sub!=null&&ln.sub!=='') o.subAccount=ln.sub; return o; }); }
    Object.keys(rec).forEach(function(k){ if(d[k]==null && rec[k]!=null && typeof rec[k]!=='object') d[k]=rec[k]; });
    /* header account fields are stored as account ids but the dropdowns list names */
    try{ var _af=App._ACCT_FIELDS&&App._ACCT_FIELDS[key]; var _bz=App.curBiz(); if(_af&&_bz) _af.forEach(function(f){ var v=rec[f]; if(!v) return; var n=(_bz.coa||[]).filter(function(x){ return x&&x.id===v; })[0]; if(n) d[f]=n.name; }); }catch(e){}
    return d; };
  App._ensureDefaultTemplate=function(key){
    try{
      if(!key) return false;
      if(window.MgrForms && MgrForms.has && MgrForms.has(key)) return true;
      if(!window.FED || typeof FED.starter!=='function' || typeof FED.genHTML!=='function') return false;
      if(!FED.shared) FED.shared={items:[],accounts:[],taxes:[]};
      if(!FED.appLists){ try{ FED.appLists=JSON.parse(localStorage.getItem('mgr_app_lists')||'null'); }catch(e){} }
      try{ this.pushAppLists&&this.pushAppLists(); }catch(e){}
      var st; try{ st=FED.starter(key); }catch(e){ return false; }
      if(!st) return false;
      var prevS=FED.state, prevT=FED.docType;
      FED.state=st; FED.docType=key;
      try{ FED.migrateBlocks&&FED.migrateBlocks(st); }catch(e){}
      try{ FED.normalizeRows&&FED.normalizeRows(st); }catch(e){}
      var html='';
      try{ html=FED.genHTML(); }catch(e){ FED.state=prevS; FED.docType=prevT; return false; }
      FED.state=prevS; FED.docType=prevT;
      if(!html) return false;
      var c={}; try{ c=REG[key]||{}; }catch(e){ c={}; }
      var label=c.label||c.singular||key;
      var tpl={ key:key, label:label, title:(st.title||label), html:html, state:Object.assign({}, st, {data:undefined}), _auto:true };
      var bundle=(window.MgrForms&&MgrForms.bundle&&MgrForms.bundle.templates)?MgrForms.bundle:{app:'form-html-editor',version:2,templates:{}};
      if(!bundle.templates) bundle.templates={};
      bundle.app='form-html-editor'; bundle.version=2; bundle.templates[key]=tpl;
      try{ localStorage.setItem('mgr_form_templates', JSON.stringify(bundle)); }catch(e){}
      if(window.MgrForms){ MgrForms.bundle=bundle; }
      return !!(window.MgrForms&&MgrForms.has&&MgrForms.has(key));
    }catch(e){ return false; }
  };
  App._ensureSubAccountColumn=function(key, st){
    if(['journal','receipts','payments'].indexOf(key)<0) return false;
    if(!st||!Array.isArray(st.blocks)) return false;
    var changed=false;
    st.blocks.forEach(function(bl){
      if(bl.type!=='lines'||!Array.isArray(bl.columns)) return;
      if(bl.columns.some(function(c){ return c&&c.dropSource==='subaccount'; })) return;
      var ai=-1; for(var i=0;i<bl.columns.length;i++){ if(bl.columns[i]&&bl.columns[i].dropSource==='account'){ ai=i; break; } }
      if(ai<0) return;
      bl.columns.splice(ai+1,0,{ id:'sub_'+Math.random().toString(36).slice(2,8), key:'custom', label:'Sub-account', num:false, var:'subAccount', cellMode:'dropdown', dropSource:'subaccount', itemAttr:'', formula:'', concat:'', options:[], defaultValue:'', placeholder:'', w:170, wUnit:'px', h:0, fs:0, bold:false, italic:false, align:'' });
      changed=true;
    });
    return changed;
  };
  App._ensureJournalDrCr=function(key, st){
    if(key!=='journal'||!st||!Array.isArray(st.blocks)) return false;
    var changed=false;
    st.blocks.forEach(function(bl){
      if(bl.type!=='lines'||!Array.isArray(bl.columns)) return;
      bl.columns.forEach(function(c){
        if(!c) return;
        if(c.var==='amountNoTax'||c.var==='totalWithTax'||c.key==='amountNoTax'||c.key==='totalWithTax'){
          if(c.cellMode!=='input'||(c.formula!==''&&c.formula!=null)){ c.cellMode='input'; c.formula=''; c.num=true; changed=true; }
        }
      });
    });
    return changed;
  };
  App._ensureNarration=function(key, st){
    var TXN={salesInv:1,purchInv:1,salesQuotes:1,purchQuotes:1,salesOrders:1,purchOrders:1,deliveryNotes:1,creditNotes:1,debitNotes:1,receipts:1,payments:1,iat:1,journal:1,goodsRec:1,payslips:1,depreciation:1};
    if(!TXN[key]||!st||!Array.isArray(st.blocks)) return false;
    function linesIdx(){ for(var i=0;i<st.blocks.length;i++){ if(st.blocks[i]&&st.blocks[i].type==='lines') return i; } return -1; }
    function wordsIdx(){ for(var i=0;i<st.blocks.length;i++){ if(st.blocks[i]&&st.blocks[i].inputMode==='amountwords') return i; } return -1; }
    var nIdx=-1; for(var i=0;i<st.blocks.length;i++){ if(st.blocks[i]&&st.blocks[i].field==='custom'&&st.blocks[i].var==='narration'){ nIdx=i; break; } }
    var li=linesIdx();
    if(nIdx>=0){ // already present — only move it up if it sits below the line items
      if(li>=0 && nIdx>li){ var moved=st.blocks.splice(nIdx,1)[0]; st.blocks.splice(linesIdx(),0,moved); return true; }
      return false; }
    var nb; try{ nb=window.FED.newField('general','custom','Narration','text'); }catch(e){ nb=null; }
    if(!nb) return false;
    nb.custom=true; nb.var='narration'; nb.inputType='textarea'; nb.height=64; nb.widthMode='full';
    var tgt = (li>=0) ? li : (wordsIdx()>=0?wordsIdx():st.blocks.length);
    st.blocks.splice(tgt,0,nb);
    return true;
  };
  App._ensureInventoryOpeningCost=function(key, st){
    if(key!=='inventory'||!st||!Array.isArray(st.blocks)) return false;
    if(st.blocks.some(function(b){ return b&&b.field==='itemOpeningCost'; })) return false;
    var nb; try{ nb=window.FED.newField('item','itemOpeningCost','Starting cost (total available)','money'); }catch(e){ nb=null; }
    if(!nb) return false;
    var idx=-1; for(var i=0;i<st.blocks.length;i++){ var v=st.blocks[i]&&st.blocks[i].field; if(v==='itemQty'){ idx=i+1; break; } if(v==='itemPurchPrice'||v==='itemSellPrice'){ if(idx<0) idx=i; } }
    if(idx<0) st.blocks.push(nb); else st.blocks.splice(idx,0,nb);
    return true;
  };
  App._refreshTemplateFromState=function(key){
    try{
      if(!key||!window.MgrForms||!window.FED||typeof FED.genHTML!=='function') return false;
      var t=MgrForms.tpl(key); if(!t||!t.state||!Array.isArray(t.state.blocks)) return false;
      if(!FED.shared) FED.shared={items:[],accounts:[],taxes:[]};
      if(!FED.appLists){ try{ FED.appLists=JSON.parse(localStorage.getItem('mgr_app_lists')||'null'); }catch(e){} }
      try{ this.pushAppLists&&this.pushAppLists(); }catch(e){}
      var st; try{ st=JSON.parse(JSON.stringify(t.state)); }catch(e){ return false; }
      try{ this._ensureSubAccountColumn(key, st); }catch(e){}
      try{ this._ensureJournalDrCr(key, st); }catch(e){}
      try{ this._ensureNarration(key, st); }catch(e){}
      try{ this._ensureInventoryOpeningCost(key, st); }catch(e){}
      st.data=FED.shared;
      var prevS=FED.state, prevT=FED.docType;
      FED.state=st; FED.docType=key;
      try{ FED.migrateBlocks&&FED.migrateBlocks(st); }catch(e){}
      try{ FED.normalizeRows&&FED.normalizeRows(st); }catch(e){}
      var html=''; try{ html=FED.genHTML(); }catch(e){ FED.state=prevS; FED.docType=prevT; return false; }
      FED.state=prevS; FED.docType=prevT;
      if(!html||html===t.html) return true;
      var bundle=MgrForms.bundle; if(!bundle||!bundle.templates) return false;
      bundle.templates[key]=Object.assign({}, t, {html:html, state:Object.assign({}, st, {data:undefined})});
      try{ localStorage.setItem('mgr_form_templates', JSON.stringify(bundle)); }catch(e){}
      MgrForms.bundle=bundle;
      return true;
    }catch(e){ return false; }
  };
  App.printDesigned=function(key){ key=key||(window.LABEL2KEY?LABEL2KEY[this.wsSection]:null); if(!key){ return; } if(!(window.MgrForms&&MgrForms.has(key))){ alert('No published design for this document yet.\nOpen Settings → Custom Themes, design it, then click Publish to app.'); return; } var rec=(this.editingId!=null)?(this.records(this.curBiz())||[]).filter(function(r){return r.id===App.editingId;})[0]:null; var data=this.mapRecordToTokens(key, rec||{}); MgrForms.open(key, data); };
  App.hasDesign=function(){ try{ var k=LABEL2KEY[this.wsSection]; return !!(window.MgrForms&&MgrForms.has(k)); }catch(e){ return false; } };
  App.openDesignerFor=function(key){ this.wsMode='settings'; this.setView='themes'; this.fmtCat=this.fmtCatOf(key); this.openFmtForm(key); };
  App.appListsForEditor=function(b){ b=b||this.curBiz()||{}; var R=(b.records||{}); var nm=function(arr){ return (arr||[]).map(function(r){ return (r&&r.name!=null)?r.name:''; }).filter(function(x){ return String(x).trim()!==''; }); };
    var accounts=((b.coa||[]).filter(function(x){ return x.type==='account'; }).map(function(a){ return a.name; })).filter(Boolean);
    var items=(R.inventory||[]).map(function(it){ return { name: it.name||'', code: it.code||'', unit: it.unit||'', sell: (it.salesPrice!=null?it.salesPrice:''), purch: (it.purchasePrice!=null?it.purchasePrice:''), qty: (function(){ try{ return invItemStats(b,it).qtyOnHand; }catch(e){ return (it.qty!=null?it.qty:''); } })(), cost: (it.purchasePrice!=null?it.purchasePrice:'') }; }).filter(function(x){ return x.name; });
    var taxes=((b.taxCodes||[]).map(function(t){ return { name:t.name, rate:t.rate }; }));
    return { accounts:accounts, items:items, customers:nm(R.customers), suppliers:nm(R.suppliers), banks:nm(R.bankCash), employees:nm(R.employees), fixedAssets:nm(R.fixedAssets), capital:nm(R.capital), taxes:taxes }; };
  App.pushAppLists=function(){ try{ var b=this.curBiz(); if(!b) return; var lists=this.appListsForEditor(b); try{ localStorage.setItem('mgr_app_lists', JSON.stringify(lists)); }catch(e){} if(window.FED){ FED.appLists=lists; if(FED.state && FED.renderRail){ try{ FED.renderRail(); FED.renderStage(); FED.renderProps(); }catch(e){} } } }catch(e){} };
  /* render the published design inline as the data-entry form, prefilled when editing */
  App._liveOptionsFor=function(b,src){ var esc=function(x){ return App.esc(x==null?'':x); }; var L=App.appListsForEditor(b);
    if(src==='item'){ var kits=((b.kitOptions)||(b.inventoryKits)||[]).filter(function(k){ return k&&k.name&&k.items&&k.items.length; })
        .map(function(k){ var c=0; try{ c=kitCostOf(b,k.name); }catch(e){}
          return '<option value="'+esc(k.name)+'" data-name="'+esc(k.name)+'" data-code="KIT" data-unit="" data-sell="'+esc(k.salesPrice||'')+
            '" data-purch="'+esc(c)+'" data-qty="" data-cost="'+esc(c)+'">'+esc(k.name)+'  —  kit</option>'; });
      return kits.concat((L.items||[]).map(function(it){ return '<option value="'+esc(it.name)+'" data-name="'+esc(it.name)+'" data-code="'+esc(it.code||'')+'" data-unit="'+esc(it.unit||'')+'" data-sell="'+esc(it.sell||'')+'" data-purch="'+esc(it.purch||'')+'" data-qty="'+esc(it.qty||'')+'" data-cost="'+esc(it.cost||'')+'">'+esc(it.name)+((it.qty!==''&&it.qty!=null)?('  \u2014  Qty: '+esc(it.qty)):'')+'</option>'; })); }
    if(src==='account'){ var _lk=(window.LABEL2KEY&&App.wsSection)?LABEL2KEY[App.wsSection]:null; return (L.accounts||[]).filter(function(o){ if(!App.lineAccountHidden) return true; var n=(b.coa||[]).find(function(x){ return x.type==='account'&&x.name===o; }); return !(n&&App.lineAccountHidden(b,n.id,_lk)); }).map(function(o){ return '<option>'+esc(o)+'</option>'; }); }
    if(src==='tax') return (L.taxes||[]).map(function(t){ var r=(t.rate==null||t.rate==='')?'':t.rate; return '<option value="'+esc(r)+'" data-rate="'+esc(r)+'">'+esc((t.name?t.name+' ':'')+(r!==''?('('+r+'%)'):''))+'</option>'; });
    if(src==='customer'||src==='supplier'||src==='bank'||src==='employee'){ return App._entityList(b,src).map(function(o){ var d=' data-name="'+esc(o.name)+'" data-code="'+esc(o.code||'')+'"'; if(src==='bank'){ d+=' data-iban="'+esc(o.iban||'')+'" data-acctno="'+esc(o.acctno||'')+'"'; } else { d+=' data-trn="'+esc(o.trn||'')+'" data-address="'+esc(o.address||'')+'" data-email="'+esc(o.email||'')+'" data-mobile="'+esc(o.mobile||'')+'" data-balance="'+esc(o.balance||'')+'"'; } return '<option value="'+esc(o.name)+'"'+d+'>'+esc(o.name)+'</option>'; }); }
    if(src==='fixedAsset'){ var fas=(b.records&&b.records.fixedAssets)?b.records.fixedAssets:[]; return fas.filter(function(a){return a&&a.name;}).map(function(a){ var _c,_ad; try{ _c=faCost(b,a); }catch(e){ _c=(a.cost!=null?a.cost:''); } try{ _ad=faAccumDep(b,a); }catch(e){ _ad=(a.accumDep!=null?a.accumDep:''); } return '<option value="'+esc(a.name)+'" data-facost="'+esc(_c)+'" data-faaccdep="'+esc(_ad)+'" data-fadeprate="'+esc(a.depRate!=null?a.depRate:'')+'" data-fadate="'+esc(a.acqDate||'')+'">'+esc(a.name)+'</option>'; }); }
    if(src==='intangible'){ var ias=(b.records&&b.records.intangibles)?b.records.intangibles:[]; return ias.filter(function(a){return a&&a.name;}).map(function(a){ var _c,_aa; try{ _c=iaCost(b,a); }catch(e){ _c=(a.cost!=null?a.cost:''); } try{ _aa=iaAccumAmort(b,a); }catch(e){ _aa=(a.accumAmort!=null?a.accumAmort:''); } return '<option value="'+esc(a.name)+'" data-facost="'+esc(_c)+'" data-faaccdep="'+esc(_aa)+'" data-fadeprate="'+esc(a.amortRate!=null?a.amortRate:'')+'" data-fadate="'+esc(a.acqDate||'')+'">'+esc(a.name)+'</option>'; }); }
    if(src==='division') return (b.divisions||[]).filter(function(d){ return d&&d.name; }).map(function(d){ return '<option value="'+esc(d.id)+'">'+esc(d.name)+(d.code?(' ('+esc(d.code)+')'):'')+'</option>'; });
    if(src==='project') return (b.projects||[]).filter(function(p){ return p&&p.name&&p.status!=='Complete'; }).map(function(p){ return '<option value="'+esc(p.id)+'">'+esc(p.name)+(p.code?(' ('+esc(p.code)+')'):'')+'</option>'; });
    if(src==='location'){ var locs=['Main location'].concat((b.locations||[]).filter(function(o){ var nm=(o&&o.name)?o.name:o; return nm && !/^main location$/i.test(nm); })); return locs.map(function(o){ var nm=(o&&o.name)?o.name:o; return '<option>'+esc(nm)+'</option>'; }); }
    if(src==='nonInvItem'){ var nis=(b.records&&b.records.nonInvItems)?b.records.nonInvItems:[]; return nis.filter(function(i){return i&&i.name;}).map(function(i){ return '<option value="'+esc(i.name)+'" data-name="'+esc(i.name)+'" data-code="'+esc(i.code||'')+'" data-unit="'+esc(i.unit||'')+'" data-sell="'+esc(i.salesPrice||'')+'" data-purch="'+esc(i.purchasePrice||'')+'">'+esc(i.name)+'</option>'; }); }
    if(src==='claimPayer'){ var ps=(b.claimPayers&&b.claimPayers.length)?b.claimPayers:[]; var extra=((b.records&&b.records.employees)||[]).map(function(e){return e.name;}).concat(((b.records&&b.records.capital)||[]).map(function(c){return c.name;})); var all=ps.concat(extra).filter(function(x,i,a){ return x&&a.indexOf(x)===i; }); return all.map(function(o){ return '<option>'+esc(o)+'</option>'; }); }
    if(src==='investment'){ var ivs=(b.records&&b.records.investments)?b.records.investments:[]; return ivs.filter(function(i){return i&&i.name;}).map(function(i){ return '<option>'+esc(i.name)+'</option>'; }); }
    var map={customer:'customers',supplier:'suppliers',bank:'banks',employee:'employees',fixedAsset:'fixedAssets',capital:'capital'}; var arr=L[map[src]]||[]; return arr.map(function(o){ return '<option>'+esc(o)+'</option>'; }); };
  App._entityFieldAttr={ customer:{custName:'name',custCode:'code',custTRN:'trn',custEmail:'email',custMobile:'mobile',custAddress:'address',custBalance:'balance'}, supplier:{supName:'name',supCode:'code',supTRN:'trn',supEmail:'email',supMobile:'mobile',supAddress:'address',supBalance:'balance'}, bank:{bankName:'name',bankCode:'code',bankIBAN:'iban',bankAcctNo:'acctno'}, employee:{empName:'name',empCode:'code',empAddress:'address',empBalance:'balance'} };
  App._entityList=function(b,src){ b=b||this.curBiz()||{}; var R=b.records||{};
    if(src==='customer') return (R.customers||[]).map(function(c){ return {name:c.name||c.customer||'', code:c.code||'', trn:(c.trn||c.taxNumber||c.vat||''), address:(c.address||c.billingAddress||''), email:(c.email||''), mobile:(c.phone||c.mobile||''), balance:(c.balance!=null?c.balance:'')}; }).filter(function(x){return x.name;});
    if(src==='supplier') return (R.suppliers||[]).map(function(c){ return {name:c.name||c.supplier||'', code:c.code||'', trn:(c.trn||c.taxNumber||''), address:(c.address||''), email:(c.email||''), mobile:(c.phone||c.mobile||''), balance:(c.balance!=null?c.balance:'')}; }).filter(function(x){return x.name;});
    if(src==='bank') return (R.bankCash||[]).map(function(c){ return {name:c.name||'', code:c.code||'', iban:(c.iban||c.bankIBAN||''), acctno:(c.acctNo||c.accountNo||c.bankAcctNo||'')}; }).filter(function(x){return x.name;});
    if(src==='employee') return (R.employees||[]).map(function(c){ return {name:c.name||'', code:c.code||'', address:(c.address||''), balance:(c.balance!=null?c.balance:'')}; }).filter(function(x){return x.name;});
    return []; };
  App._subSourceForAccount=function(name){ name=String(name||'').trim(); if(/^accounts receivable$/i.test(name)) return 'customer'; if(/^accounts payable$/i.test(name)) return 'supplier'; if(/^capital accounts$/i.test(name)) return 'capital'; if(/^employee clearing account$/i.test(name)) return 'employee'; if(/^inventory on hand$/i.test(name)) return 'item'; if(/^fixed assets(, at cost)?$/i.test(name)) return 'fixedAsset'; if(/^cash & cash equivalents$/i.test(name)) return 'bank'; if(/^intangible assets, at cost$/i.test(name)) return 'intangible'; if(/^investments$/i.test(name)) return 'investment'; if(/^expense claims$/i.test(name)) return 'claimPayer'; return null; };
  App._mountDesignedForm=function(key){ var host=document.getElementById('deHost'); if(!host) return; if(!(window.MgrForms&&MgrForms.has(key))) return; var t=MgrForms.tpl(key); if(!t||!t.html) return; var b=this.curBiz();
    var scriptCode=''; var html=t.html.replace(/<script>([\s\S]*?)<\/script>/, function(m,code){ scriptCode=code; return ''; });
    host.innerHTML=html;
    try{ var _afk=host.querySelector('.app-form'); if(_afk) _afk.setAttribute('data-doc-kind', (['purchInv','purchQuotes','purchOrders','debitNotes','goodsRec'].indexOf(key)>=0)?'purchase':'sales'); }catch(e){}
    host.querySelectorAll('button[type="submit"]').forEach(function(x){ x.remove(); });
    if(scriptCode){ var sc=document.createElement('script'); sc.textContent=scriptCode; host.appendChild(sc); }
    try{ var srcMap={}; var st=t.state||{}; (st.blocks||[]).forEach(function(bl){ if(bl.type==='field'){ if(bl.inputMode==='dropdown'&&bl.listSource) srcMap['f:'+(bl.var||'')]=bl.listSource; } else if(bl.type==='lines'){ (bl.columns||[]).forEach(function(col){ if(col.cellMode==='dropdown'&&col.dropSource&&col.dropSource!=='custom') srcMap['c:'+(col.var||'')]=col.dropSource; }); } });
      var ph=function(src){ return src==='item'?'\u2014 select item \u2014':src==='account'?'\u2014 select account \u2014':src==='tax'?'\u2014 select tax \u2014':'\u2014 select \u2014'; };
      host.querySelectorAll('select[data-field-var]').forEach(function(sel){ var src=srcMap['f:'+sel.getAttribute('data-field-var')]; if(!src) return; var keep=sel.value; sel.innerHTML='<option value="">'+ph(src)+'</option>'+App._liveOptionsFor(b,src).join(''); if(src==='customer'||src==='supplier'||src==='bank'||src==='employee') sel.setAttribute('data-entity',src); sel.setAttribute('data-qc-source',src); if(keep) sel.value=keep; });
      var tbl=host.querySelector('[data-line-items]'); if(tbl){ tbl.querySelectorAll('select[data-var]').forEach(function(sel){ var src=srcMap['c:'+sel.getAttribute('data-var')]; if(!src) return; var keep=sel.value; sel.innerHTML='<option value="">'+ph(src)+'</option>'+App._liveOptionsFor(b,src).join(''); if(src==='item'&&!sel.hasAttribute('data-item-select')) sel.setAttribute('data-item-select',''); if(src==='customer'||src==='supplier'||src==='bank'||src==='employee') sel.setAttribute('data-entity',src); sel.setAttribute('data-qc-source',src); if(keep) sel.value=keep; }); }
      host.querySelectorAll('[data-party] [data-party-kind]').forEach(function(sel){ if(!sel||sel.tagName!=='SELECT') return; var kind=sel.getAttribute('data-party-kind'); if(['customer','supplier','bank','employee'].indexOf(kind)<0) return; var keep=sel.value; sel.innerHTML='<option value="">\u2014 select \u2014</option>'+App._liveOptionsFor(b,kind).join(''); sel.setAttribute('data-qc-source',kind); if(keep) sel.value=keep; });
      host.querySelectorAll('select[data-field-var]').forEach(function(sel){ var s2=srcMap['f:'+sel.getAttribute('data-field-var')]; if(s2!=='fixedAsset'&&s2!=='intangible') return; var fillFa=function(){ var o=sel.options[sel.selectedIndex]; if(!o) return; [['data-facost','cost'],['data-faaccdep','accDep'],['data-fadeprate','depRate']].forEach(function(pr){ var tgt=host.querySelector('[data-field-var="'+pr[1]+'"]'); var v=o.getAttribute(pr[0]); if(tgt&&tgt.type!=='checkbox'&&v!=null&&v!==''){ tgt.value=v; try{ tgt.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){} } }); }; sel.addEventListener('change', fillFa); });
      var _subTbl=host.querySelector('[data-line-items]');
      if(_subTbl){ var subWire=function(accSel){ var tr=accSel.closest('tr'); if(!tr) return; var subSel=tr.querySelector('select[data-subaccount-col]'); if(!subSel) return; var sub=App._subSourceForAccount(accSel.value); var keepSub=subSel.value; if(sub){ subSel.innerHTML='<option value="">— select —</option>'+App._liveOptionsFor(b,sub).join(''); subSel.disabled=false; subSel.setAttribute('data-qc-source',sub); try{ QuickCreate.decorate(subSel); }catch(e){} if(keepSub) subSel.value=keepSub; } else { subSel.innerHTML='<option value="">—</option>'; subSel.value=''; subSel.disabled=true; subSel.removeAttribute('data-qc-source'); } try{ subSel.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} };
        _subTbl.addEventListener('change', function(e){ var s=e.target; if(s&&s.tagName==='SELECT'&&s.hasAttribute('data-account-col')) subWire(s); });
        _subTbl.querySelectorAll('select[data-account-col]').forEach(subWire); }
      var _balEl=host.querySelector('[data-journal-balance]');
      if(_balEl){ var updJBal=function(){ var dk=_balEl.getAttribute('data-bal-debit')||'amountNoTax'; var ck=_balEl.getAttribute('data-bal-credit')||'totalWithTax'; var dr=0,cr=0; host.querySelectorAll('[data-var="'+dk+'"]').forEach(function(i){ var n=parseFloat(i.value); if(!isNaN(n)) dr+=n; }); host.querySelectorAll('[data-var="'+ck+'"]').forEach(function(i){ var n=parseFloat(i.value); if(!isNaN(n)) cr+=n; }); var R2=function(x){ return Math.round(x*100)/100; }; var diff=R2(dr-cr); if(diff===0 && dr>0){ _balEl.value='Balanced \u2713  (Dr '+R2(dr)+' = Cr '+R2(cr)+')'; _balEl.style.color='#0b6b49'; _balEl.style.background='#eef6f1'; } else { var side=diff>0?'Debit':'Credit'; _balEl.value=(diff===0)?'Enter the debit and credit amounts':('Out of balance \u2717  '+side+' by '+R2(Math.abs(diff))+'  (Dr '+R2(dr)+' / Cr '+R2(cr)+')'); _balEl.style.color='#b42318'; _balEl.style.background='#fef3f2'; } _balEl.style.fontWeight='600'; }; host.addEventListener('input', updJBal); host.addEventListener('change', updJBal); setTimeout(updJBal,0); }
    }catch(e){}
    try{ var st2=t.state||{}; var linkMap={}; (st2.blocks||[]).forEach(function(bl){ if(bl.type==='field'&&bl.inputMode==='linked'){ var ent=bl.group; var m=App._entityFieldAttr[ent]; if(m){ var attr=m[bl.field]; if(attr&&bl.var){ (linkMap[ent]=linkMap[ent]||[]).push({v:bl.var,a:attr}); } } } });
      host.addEventListener('change', function(e){ var sel=e.target; if(!sel||sel.tagName!=='SELECT') return; var ent=sel.getAttribute('data-entity'); if(!ent||!linkMap[ent]) return; var opt=sel.options[sel.selectedIndex]; if(!opt) return; linkMap[ent].forEach(function(L){ var tgt=host.querySelector('[data-field-var="'+L.v+'"]'); if(tgt&&tgt.type!=='checkbox'){ var v=opt.getAttribute('data-'+L.a); if(v!=null) tgt.value=v; } }); });
    }catch(e){}
    try{ var foot=host.querySelector('[data-line-items] tfoot'); if(foot && foot.querySelector('[data-total="taxAmount"]')){ foot.querySelectorAll('[data-total-tax]').forEach(function(td){ td.removeAttribute('data-total-tax'); td.textContent=''; }); } }catch(e){}
    if(this.editingId==null){ try{ var refEl=host.querySelector('input[data-auto]'); if(refEl){ var recs=(this.records(b)||[]); var width=(String(refEl.value||'').replace(/[^0-9]/g,'').length)||4; var maxN=0; recs.forEach(function(r){ var s=String(r.reference||''); var m=s.match(/([0-9]+)\s*$/); if(m){ var n=parseInt(m[1],10); if(!isNaN(n)&&n>maxN) maxN=n; if(m[1].length>width) width=m[1].length; } }); var nx=String(maxN+1); while(nx.length<width) nx='0'+nx; refEl.value=nx; try{ refEl.dispatchEvent(new Event('input',{bubbles:true})); }catch(_){ } } }catch(e){} }
    var _isPrefill=(this.editingId==null && this._prefill); var rec=(this.editingId!=null)?((this.records(b)||[]).filter(function(r){return r.id===App.editingId;})[0]):(this._prefill||null);
    if(rec){ var data=this.mapRecordToTokens(key,rec); var setVal=function(el,v){ if(!el) return; if(_isPrefill && (v==null||v==='')) return; if(el.type==='checkbox'){ el.checked=(v===true||v==='1'||v===1); } else { el.value=(v==null?'':v); } };
      Object.keys(data).forEach(function(k){ if(k==='lines') return; host.querySelectorAll('[data-field-var="'+k+'"]').forEach(function(el){ setVal(el,data[k]); }); });
      var tbl2=host.querySelector('[data-line-items]'); if(tbl2&&tbl2.tBodies[0]&&Array.isArray(data.lines)&&data.lines.length){ var tb=tbl2.tBodies[0]; var proto=tb.rows[0]; if(proto){ tb.innerHTML=''; data.lines.forEach(function(ln){ var rr=proto.cloneNode(true); Object.keys(ln).forEach(function(k){ rr.querySelectorAll('[data-var="'+k+'"]').forEach(function(el){ setVal(el,ln[k]); }); }); tb.appendChild(rr); }); } }
      host.querySelectorAll('input,select,textarea').forEach(function(el){ try{ el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }catch(_){ } });
      try{ var _st=host.querySelector('[data-line-items]'); if(_st&&_st.tBodies[0]&&Array.isArray(data.lines)){ var _rows=_st.tBodies[0].rows; for(var _ri=0; _ri<_rows.length&&_ri<data.lines.length; _ri++){ var _sv=data.lines[_ri].subAccount; if(_sv==null||_sv==='') _sv=data.lines[_ri].sub; if(_sv!=null&&_sv!==''){ var _ss=_rows[_ri].querySelector('select[data-subaccount-col]'); if(_ss){ _ss.disabled=false; _ss.value=_sv; if(_ss.value!==_sv){ var _op=document.createElement('option'); _op.value=_sv; _op.textContent=_sv; _ss.appendChild(_op); _ss.value=_sv; } try{ _ss.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} } } } } }catch(e){}
      try{ App._reapplyLineValues(host,data); }catch(e){}
    }
    try{ App._linesLoadGuard(host,key,(this.editingId!=null)?rec:null); }catch(e){}
    if(this.editingId==null) this._prefill=null;
    /* Give every entity dropdown its "+ Add New" row. */
    try{ QuickCreate.scan(host); }catch(e){}
    /* Receipts and payments get the invoice / bill allocation panel. */
    try{ Allocations.mount(host,key,{ allocations:(_isPrefill && rec && rec._keepAlloc) ? rec.allocations : null }); }catch(e){}
    /* ...and the party's current balance beside the Paid by / Paid to field. */
    try{ PartyBalance.mount(host,key); }catch(e){}
  };
  App.saveDesignedRecord=function(key){ var host=document.getElementById('deHost'); if(!host){ alert('The form is still loading \u2014 try again in a moment.'); return; } var b=this.curBiz(); if(!b) return;
    if(this.guardWrite && !this.guardWrite(b)) return;
    var _beforeSnap=(this.editingId!=null)?((this.records(b)||[]).find(function(x){return x.id===App.editingId;})||null):null; if(_beforeSnap) _beforeSnap=JSON.parse(JSON.stringify(_beforeSnap));
    var rec={}; var fes=host.querySelectorAll('[data-field-var]'); for(var i=0;i<fes.length;i++){ var el=fes[i]; var k=el.getAttribute('data-field-var'); rec[k]=(el.type==='checkbox')?(el.checked?'1':''):el.value; }
    var tbl=host.querySelector('[data-line-items]'); if(tbl){ var bd=tbl.tBodies[0]; var lines=[]; if(bd){ for(var r=0;r<bd.rows.length;r++){ var row=bd.rows[r]; var ln={}; var any=false; var cels=row.querySelectorAll('[data-var]'); for(var j=0;j<cels.length;j++){ var ce=cels[j]; var ck=ce.getAttribute('data-var'); var v=(ce.type==='checkbox')?(ce.checked?'1':''):ce.value; ln[ck]=v; if(String(v).trim()!=='') any=true; } if(any) lines.push(ln); } } rec.lines=lines; if(key==='journal'){ rec.lines.forEach(function(l){ l._dr=l.amountNoTax; l._cr=l.totalWithTax; }); } }
    var _num=function(v){ var n=parseFloat(v); return isNaN(n)?0:n; };
    rec.lines=(rec.lines||[]).map(function(ln){ var qty=_num(ln.qty), price=_num(ln.price); var hasNet=(ln.amountNoTax!=null&&ln.amountNoTax!==''); var net=hasNet?_num(ln.amountNoTax):(qty*price); var rate=(ln.taxRate!=null&&ln.taxRate!=='')?_num(ln.taxRate):0; var twt=(ln.totalWithTax!=null&&ln.totalWithTax!=='')?_num(ln.totalWithTax):(net+(rate?net*rate/100:0)); var taxAmt=Math.round((twt-net)*100)/100; var acctName=(ln.accounts!=null&&ln.accounts!=='')?ln.accounts:(ln.account||''); var acctId=App.acctIdByName(b,acctName)||acctName; var out={ item:(ln.items!=null?ln.items:(ln.item||'')), desc:(ln.description!=null?ln.description:(ln.desc||'')), account:acctId, accountName:acctName, qty:((ln.qty!=null&&ln.qty!=='')?qty:''), price:((ln.price!=null&&ln.price!=='')?price:''), net:net, amount:twt, taxAmt:taxAmt, tax:(ln.taxRate!=null?ln.taxRate:(ln.tax||'')) }; Object.keys(ln).forEach(function(k){ if(out[k]===undefined) out[k]=ln[k]; }); out.items=out.item; out.description=out.desc; out.amountNoTax=(hasNet?ln.amountNoTax:net); out.totalWithTax=((ln.totalWithTax!=null&&ln.totalWithTax!=='')?ln.totalWithTax:twt); out.taxRate=(ln.taxRate!=null?ln.taxRate:rate); out.accounts=acctName; return out; });
    rec.id=(this.editingId!=null)?this.editingId:Date.now(); rec.uuid=rec.uuid||this.uuid();
    { var _dv=document.getElementById('f_division'); if(_dv) rec.division=_dv.value||'';
      var _pj=document.getElementById('f_project'); if(_pj) rec.project=_pj.value||''; }
    { var _lk=b.lockDate||''; if(_lk){ var _nd=String(rec.issueDate||rec.date||'').slice(0,10); var _od=_beforeSnap?String(_beforeSnap.issueDate||_beforeSnap.date||'').slice(0,10):''; if((_nd&&_nd<=_lk)||(_od&&_od<=_lk)){ alert('The accounting period is locked up to '+_lk+'.\n\nThis transaction is dated on or before the lock date and can\u2019t be created or changed. Change the date, or update Settings \u2192 Lock Date to proceed.'); return; } } }
    try{ var _bankSel=host.querySelector('select[data-entity="bank"]'); var _bankVal=_bankSel?(_bankSel.value||''):''; var _pm=host.querySelector('[data-party-master]'); var _party=_pm?(_pm.value||''):''; var _pt=host.querySelector('.party-type'); var _ptype=_pt?(_pt.value||''):'';
      if(key==='payments'){ if(_bankVal) rec.paidFrom=_bankVal; if(_party) rec.payee=_party; if(_ptype) rec.payeeType=_ptype; }
      else if(key==='receipts'){ if(_bankVal) rec.receivedIn=_bankVal; if(_party) rec.paidBy=_party; if(_ptype) rec.paidByType=_ptype; }
      else if(key==='iat'){ if(_bankVal&&!rec.paidFrom) rec.paidFrom=_bankVal; if(rec.amount!=null&&rec.amount!=='') rec.amount=parseFloat(String(rec.amount).replace(/[^0-9.\-]/g,''))||0; }
    }catch(e){}
    if(key==='receipts'||key==='payments'){
      var _al=null; try{ _al=Allocations; }catch(_e){ _al=null; }
      if(_al){ var _bad=_al.validate(); if(_bad){ alert(_bad); return; } rec.allocations=_al.collect(); }
    }
    this._applyDesignedToNative(key, rec);
    { var _why=App._designedSaveProblem(b,key,rec,_beforeSnap); if(_why){ alert(_why); return; } }
    var arr=(this.records(b)||[]).slice(); if(this.editingId!=null){ var idx=arr.findIndex(function(x){return x.id===App.editingId;}); if(idx>=0) arr[idx]=rec; else arr.push(rec); } else arr.push(rec);
    try{ if(b.coa){ if(key==='fixedAssets'||key==='depreciation') ensureFixedAssetAccounts(b); if(key==='inventory'||key==='salesInv'||key==='purchInv') ensureInventoryAccounts(b); if(key==='capital') ensureCapitalControl(b); if(key==='receipts'||key==='payments'||key==='iat'||key==='bankCash') ensureCashControl(b); ensureAllControls(b); } }catch(e){}
    var _act=(this.editingId!=null)?'update':'create'; this.setRecords(b,arr); try{ refreshSummary(b); }catch(e){} try{ this._logActivity(b,_act,key,rec,_beforeSnap); }catch(e){} this.saveBiz(b); this.editingId=null; if(!this.backFromRecord()) this.backToList();
  };
  App._ACCT_FIELDS={invWriteOffs:['account'],production:['extraAccount'],nonInvItems:['salesAccount','purchaseAccount']};
  App._applyDesignedToNative=function(key,rec){ try{ var af=App._ACCT_FIELDS[key]; if(af){ var _b=App.curBiz(); af.forEach(function(f){ var v=rec[f]; if(v && typeof v==='string'){ var id=App.acctIdByName(_b,v); if(id) rec[f]=id; } }); } }catch(e){}
    if(Array.isArray(rec.lines)) rec.lines.forEach(function(ln){ if((ln.sub==null||ln.sub==='')&&ln.subAccount!=null&&ln.subAccount!==''){ ln.sub=ln.subAccount; } }); if(rec.date&&!rec.issueDate) rec.issueDate=rec.date; var refv=rec.reference||rec.saleInvoiceNo||rec.purchaseInvoiceNo||rec.receiptNo||rec.paymentNo||rec.saleQuoteNo||rec.purchaseOrderNo||rec.deliveryNoteNo||rec.creditNoteNo||rec.debitNoteNo||rec.journalNo; if(refv&&!rec.reference) rec.reference=refv;
    if(rec.custName&&!rec.customer) rec.customer=rec.custName; if(rec.supName&&!rec.supplier) rec.supplier=rec.supName; if(rec.empName&&!rec.employee) rec.employee=rec.empName;
    var set=function(n,v){ if((rec[n]==null||rec[n]==='')&&v!=null&&v!=='') rec[n]=v; };
    if(key==='customers'){ set('name',rec.custName); set('code',rec.custCode); set('email',rec.custEmail); set('phone',rec.custMobile); set('address',rec.custAddress); set('trn',rec.custTRN); set('balance',rec.custBalance); }
    else if(key==='suppliers'){ set('name',rec.supName); set('code',rec.supCode); set('email',rec.supEmail); set('phone',rec.supMobile); set('address',rec.supAddress); set('trn',rec.supTRN); set('balance',rec.supBalance); }
    else if(key==='employees'){ set('name',rec.empName); set('code',rec.empCode); set('address',rec.empAddress); set('balance',rec.empBalance); }
    else if(key==='inventory'){ set('name',rec.itemName); set('code',rec.itemCode); set('unit',rec.itemUnit); set('salesPrice',rec.itemSellPrice); set('purchasePrice',rec.itemPurchPrice); set('qty',rec.itemQty); set('openingCost',rec.itemOpeningCost); }
    else if(key==='bankCash'){ set('name',rec.bankName); set('code',rec.bankCode); }
    else if(key==='fixedAssets'){ set('name',rec.faName); set('acqDate',rec.faDate); set('cost',rec.faCost); set('accumDep',rec.faAccDep); set('code',rec.faCode); set('depRate',rec.faDepRate); }
    else if(key==='capital'){ set('name',rec.capName); set('balance',rec.capBalance); set('code',rec.capCode); set('description',rec.capDesc); }
    else if(key==='depreciation'){ var _de=0,_first=''; (rec.lines||[]).forEach(function(ln){ var ex=parseFloat(ln.depExpense)||0; ln.amount=ex; _de+=ex; if(!_first&&ln.asset) _first=ln.asset; }); if(_de) rec.amount=_de; set('method',rec.depMethod); if(rec.description==null||rec.description===''){ rec.description=(rec.narration&&String(rec.narration).trim())?rec.narration:('Depreciation'+(_first?(' - '+_first):'')); } }
    else if(key==='amortization'){ var _ae=0,_af=''; (rec.lines||[]).forEach(function(ln){ var ex=parseFloat(ln.depExpense)||0; ln.amount=ex; ln.amortExpense=ex; _ae+=ex; if(!_af&&ln.asset) _af=ln.asset; }); if(_ae) rec.amount=_ae; set('method',rec.depMethod); if(rec.description==null||rec.description===''){ rec.description=(rec.narration&&String(rec.narration).trim())?rec.narration:('Amortization'+(_af?(' - '+_af):'')); } }
    else if(key==='intangibles'){ set('name',rec.name); set('acqDate',rec.acqDate); set('cost',rec.cost); set('accumAmort',rec.accumAmort); }
    else if(key==='nonInvItems'){ set('name',rec.itemName); set('code',rec.itemCode); set('unit',rec.itemUnit); set('salesPrice',rec.itemSellPrice); set('purchasePrice',rec.itemPurchPrice); }
    else if(key==='expenseClaims'){ var _ct=0; (rec.lines||[]).forEach(function(ln){ _ct+=parseFloat(ln.amountNoTax!=null&&ln.amountNoTax!==''?ln.amountNoTax:ln.amount)||0; }); rec.amount=_ct; }
    else if(key==='billableTime'){ if(rec.customer==null||rec.customer==='') rec.customer=rec.custName||''; if(rec.employee==null||rec.employee==='') rec.employee=rec.empName||''; rec.amount=(parseFloat(rec.hours)||0)*(parseFloat(rec.rate)||0); if(!rec.status) rec.status='Uninvoiced'; }
    else if(key==='whtReceipts'){ if(rec.customer==null||rec.customer==='') rec.customer=rec.custName||''; }
    else if(key==='bankRec'){ set('account',rec.bankName); if(!rec.status) rec.status='Pending'; }
    else if(key==='journal'){ var _jdr=0,_jcr=0; (rec.lines||[]).forEach(function(ln){ var hasD=(ln._dr!=null&&ln._dr!==''); var hasC=(ln._cr!=null&&ln._cr!==''); var dr=hasD?(parseFloat(ln._dr)||0):0; var cr=hasC?(parseFloat(ln._cr)||0):0; ln.debit=hasD?dr:''; ln.credit=hasC?cr:''; ln.amountNoTax=ln.debit; ln.totalWithTax=ln.credit; if(ln.sub==null||ln.sub==='') ln.sub=(ln.subAccount||''); delete ln._dr; delete ln._cr; _jdr+=dr; _jcr+=cr; }); rec.debit=_jdr; rec.credit=_jcr; if((rec.narration==null||rec.narration==='')&&rec.description) rec.narration=rec.description; }
    if((rec.description==null||rec.description==='')&&rec.narration!=null&&rec.narration!=='') rec.description=rec.narration;
    if((rec.description==null||rec.description==='')&&rec.itemName) rec.description=rec.itemName;
    if(Array.isArray(rec.lines)&&rec.lines.length){ var sub=0,tax=0,tot=0; rec.lines.forEach(function(ln){ var qty=parseFloat(ln.qty)||0,price=parseFloat(ln.price)||0; var net=(ln.amountNoTax!==''&&ln.amountNoTax!=null)?(parseFloat(ln.amountNoTax)||0):(qty*price); var twt=(ln.totalWithTax!==''&&ln.totalWithTax!=null)?(parseFloat(ln.totalWithTax)||0):net; sub+=net; tot+=twt; tax+=(twt-net); }); rec.subtotal=sub; rec.tax=tax; rec.total=tot; rec.balanceDue=tot; if(rec.amount==null||rec.amount==='') rec.amount=tot; } };
  /* receive a published bundle from the embedded editor */
  window.addEventListener('message', function(e){ var d=e&&e.data; if(!d) return;
    if(d.type==='mgr-editor-ready'){ App._fedReady=true; App.pushAppLists(); var fr=document.getElementById('mfEditorFrame'); if(fr && fr.contentWindow && App._fedPending){ try{ fr.contentWindow.postMessage({type:'mgr-open-doc', key:App._fedPending}, '*'); }catch(_){ } App._fedPending=null; } return; }
    if(d.type==='mgr-form-bundle'&&d.bundle){ MF.bundle=d.bundle; write(d.bundle); var n=d.bundle.templates?Object.keys(d.bundle.templates).length:0; try{ App.toast&&App.toast('Published '+n+' form design'+(n===1?'':'s')); }catch(_){ } } });
})();

