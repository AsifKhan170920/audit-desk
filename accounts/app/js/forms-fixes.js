/* ===================== Forms fixes (FIX_SPEC sections G and M) =====================
   Additive module: it wraps a few App methods instead of rewriting them, so the
   other fix branches (lists, ledger, data) merge cleanly.

   - Bank & Cash account: Manager's form (Name | Code, IBAN / pending / credit
     limit reveal boxes, custom fields, Create / Create & add another / Update /
     Delete), a lossless migration of the old designer keys (bankIBAN, ibanNo,
     bankAcctNo -> iban + "Account number" custom field), Manager's column set.
   - Designer (Form Designer) forms: Sales-Invoice-like line grid (min widths,
     horizontal scroll, up / down / duplicate / remove per line), item picker
     with inventory + non-inventory items that fills description, price,
     account and tax, Purchase Invoice due date, today's date on new documents,
     print options saved with the record, clean labels, no closing-balance
     fields on customers / suppliers / employees, Email on employees,
     calculated Available quantity on inventory items.
   - Global search across every module, grouped by type.
   - Overlays opened for a page (Copy to…) close when the page changes.
   =================================================================================== */
(function(global){
  'use strict';
  function app(){ try{ return App; }catch(e){ return global.App || null; } }
  function reg(){ try{ return REG; }catch(e){ return global.REG || {}; } }
  function l2k(){ try{ return LABEL2KEY; }catch(e){ return global.LABEL2KEY || {}; } }
  function k2l(){ try{ return KEY2LABEL; }catch(e){ return global.KEY2LABEL || {}; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function blank(v){ return v==null || String(v).trim()===''; }
  function num(v){ var n=parseFloat(String(v==null?'':v).replace(/,/g,'')); return isNaN(n)?0:n; }
  function today(){ var d=new Date(), p=function(n){ return (n<10?'0':'')+n; }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function doc(){ return global.document; }
  function fire(el,type){ try{ el.dispatchEvent(new Event(type,{bubbles:true})); }catch(e){} }
  function truthy(v){ return v===true || v===1 || v==='1' || v==='true'; }
  var PURCHASE_KEYS={ purchInv:1, purchQuotes:1, purchOrders:1, debitNotes:1, goodsRec:1 };

  /* ================================================================ Bank & Cash */
  var ACCT_NO_KEY='accountNumber';
  /** Lossless, idempotent: old keys are kept, the canonical ones are filled in. */
  function migrateBanks(b){
    if(!b || !b.records || !Array.isArray(b.records.bankCash)) return false;
    var changed=false, needAcctNo=false;
    b.records.bankCash.forEach(function(r){ if(!r) return;
      /* `iban` was a checkbox in the old REG form, the number lived in ibanNo; the designer used bankIBAN */
      if(typeof r.iban==='boolean' || r.iban===1 || r.iban==='1' || r.iban==='true'){ var on=truthy(r.iban); r.iban=String(r.ibanNo||r.bankIBAN||'').trim(); if(on||r.iban){ r.hasIban=true; } changed=true; }
      if(blank(r.iban)){ var v=String(r.ibanNo||r.bankIBAN||'').trim(); if(v){ r.iban=v; changed=true; } }
      if(!blank(r.iban) && r.hasIban!==true){ r.hasIban=true; changed=true; }
      if(blank(r.name) && !blank(r.bankName)){ r.name=r.bankName; changed=true; }
      if(blank(r.code) && !blank(r.bankCode)){ r.code=r.bankCode; changed=true; }
      var acct=String(r.bankAcctNo||r.acctNo||r.accountNo||'').trim();
      if(acct){ needAcctNo=true; r.custom=r.custom||{}; if(blank(r.custom[ACCT_NO_KEY])){ r.custom[ACCT_NO_KEY]=acct; changed=true; } }
      if(r.custom && !blank(r.custom[ACCT_NO_KEY])) needAcctNo=true;
    });
    if(ensureAcctNoField(b, needAcctNo)) changed=true;
    if(migrateBankCols(b, needAcctNo)) changed=true;
    return changed;
  }
  /** "Account number" is an ordinary custom field of the bank form (Settings > Custom Fields lists it). */
  function ensureAcctNoField(b, force){
    b.formConfig=b.formConfig||{}; var c=b.formConfig.bankCash; var list=(c&&c.custom)||[];
    if(list.some(function(x){ return x && (x.key===ACCT_NO_KEY || String(x.label||'').trim().toLowerCase()==='account number'); })) return false;
    if(!force) return false;
    if(!c){ c=b.formConfig.bankCash={show:{},custom:[]}; } if(!c.custom) c.custom=[];
    c.custom.push({ key:ACCT_NO_KEY, label:'Account number', type:'field', dataType:'text' });
    return true;
  }
  /* saved column choices from before the fix: ibanNo is now iban, the settings checkboxes are not columns,
     Credit limit amount became Available credit, and Account number joins IBAN (once) */
  function migrateBankCols(b, acctNo){
    var d=b.details, lc=d&&d.listCols&&d.listCols.bankCash; if(!Array.isArray(lc) || (d._ffBankCols||0)>=1) return false;
    var out=[]; lc.forEach(function(k){ if(k==='ibanNo') k='iban'; if(k==='creditLimit') k='availableCredit'; if(k==='pending'||k==='creditLimitOn'||k==='inactive'||k==='hasIban') return; if(out.indexOf(k)<0) out.push(k); });
    if(acctNo && out.indexOf('cf_'+ACCT_NO_KEY)<0){ var at=out.indexOf('iban'); if(at<0) out.push('cf_'+ACCT_NO_KEY); else out.splice(at+1,0,'cf_'+ACCT_NO_KEY); }
    d.listCols.bankCash=out; d._ffBankCols=1; return true;
  }
  function bankCustomFields(b){ var c=(b&&b.formConfig&&b.formConfig.bankCash)||{}; return (c.custom||[]).filter(function(x){ return x && (x.type||'field')==='field'; }); }

  function fieldInput(f,v){
    var id='bf_'+f.key;
    if(f.type==='check') return '<label class="ff-chk"><input type="checkbox" id="'+id+'"'+(truthy(v)?' checked':'')+' onchange="BankForm.reveal()"> '+esc(f.label)+'</label>';
    var im=(f.type==='money'||f.type==='number')?' inputmode="decimal"':'';
    return '<input type="text" id="'+id+'"'+im+' value="'+esc(v==null?'':v)+'"'+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+(f.w?' style="width:'+f.w+'"':'')+'>';
  }
  /** Form body shared by the full page and the "+ Add new" dialog (prefix keeps their ids apart). */
  function bankFieldsHtml(b,rec){
    var F=(reg().bankCash||{}).form||[], h='', i=0;
    while(i<F.length){ var f=F[i];
      if(f.row){ var grp=[]; while(i<F.length && F[i].row===f.row){ grp.push(F[i]); i++; }
        h+='<div class="ff-row">'+grp.map(function(g){ return '<div class="ff-f'+(g.w?' ff-small':'')+'"><label class="fld">'+esc(g.label)+(g.req?' *':'')+'</label>'+fieldInput(g,rec[g.key])+'</div>'; }).join('')+'</div>';
        continue; }
      if(f.showIf){ h+='<div class="ff-reveal" data-showif="'+esc(f.showIf)+'"'+(truthy(rec[f.showIf])?'':' hidden')+'>'+fieldInput(f,rec[f.key])+'</div>'; }
      else if(f.type==='check') h+='<div class="ff-f">'+fieldInput(f,rec[f.key])+'</div>';
      else h+='<div class="ff-f"><label class="fld">'+esc(f.label)+'</label>'+fieldInput(f,rec[f.key])+'</div>';
      i++; }
    var A=app(), cf=bankCustomFields(b);
    if(cf.length){ h+='<div class="ff-cf">'+cf.map(function(x){ var v=(rec.custom&&rec.custom[x.key]!=null)?rec.custom[x.key]:(x.value||'');
      var inp; try{ inp=A.cfEntryInput(x,'bf_cf_'+x.key,v,''); }catch(e){ inp='<input type="text" id="bf_cf_'+esc(x.key)+'" value="'+esc(v)+'">'; }
      return '<div class="ff-f"><label class="fld">'+esc(x.label||'Custom field')+'</label>'+inp+'</div>'; }).join('')+'</div>'; }
    return h;
  }
  function readBankForm(b){
    var d=doc(), out={}, F=(reg().bankCash||{}).form||[];
    F.forEach(function(f){ var el=d.getElementById('bf_'+f.key); if(!el) return; out[f.key]=(f.type==='check')?!!el.checked:String(el.value||'').trim(); });
    var cf=bankCustomFields(b); if(cf.length){ out.custom={}; cf.forEach(function(x){ var el=d.getElementById('bf_cf_'+x.key); if(el) out.custom[x.key]=String(el.value||'').trim(); }); }
    return out;
  }
  /** Validate + apply form values onto `rec` (a copy of the stored record, or {}). */
  function applyBankValues(b,rec,v,selfId){
    var A=app();
    var name=String(v.name||'').trim(); if(!name) return { error:'Name is required.', field:'name' };
    var dup=((b.records&&b.records.bankCash)||[]).some(function(r){ return r && r.id!==selfId && String(r.name||'').trim().toLowerCase()===name.toLowerCase(); });
    if(dup) return { error:'A bank or cash account named “'+name+'” already exists.', field:'name' };
    rec.name=name; rec.code=String(v.code||'').trim();
    rec.hasIban=!!v.hasIban; rec.iban=rec.hasIban?String(v.iban||'').replace(/\s+/g,' ').trim():'';
    rec.pending=!!v.pending;
    rec.creditLimitOn=!!v.creditLimitOn; rec.creditLimit=rec.creditLimitOn?(blank(v.creditLimit)?'':(A&&A.parseNum?A.parseNum(v.creditLimit):num(v.creditLimit))):'';
    rec.inactive=!!v.inactive;
    if(v.custom){ rec.custom=Object.assign({}, rec.custom||{}, v.custom); }
    /* keep the old designer keys in step so printed designs that still use them stay right */
    if('bankName' in rec) rec.bankName=rec.name; if('bankCode' in rec) rec.bankCode=rec.code;
    if('bankIBAN' in rec) rec.bankIBAN=rec.iban; if('ibanNo' in rec) rec.ibanNo=rec.iban;
    if('bankAcctNo' in rec && rec.custom && rec.custom[ACCT_NO_KEY]!=null) rec.bankAcctNo=rec.custom[ACCT_NO_KEY];
    return { ok:true, rec:rec };
  }
  /** A renamed account keeps its transactions: documents refer to banks by name. */
  function cascadeRename(b,oldName,newName){
    if(!oldName || !newName || oldName===newName) return;
    var R=b.records||{}, fix=function(list,fields){ (R[list]||[]).forEach(function(d){ fields.forEach(function(f){ if(d && d[f]===oldName) d[f]=newName; }); }); };
    fix('receipts',['receivedIn']); fix('payments',['paidFrom']); fix('iat',['paidFrom','receivedIn']); fix('bankRec',['account','bankName']);
  }

  var BankForm = {
    migrate: migrateBanks,
    fieldsHtml: bankFieldsHtml,
    html:function(b){
      var A=app(), c=reg().bankCash||{}; migrateBanks(b);
      var editing=A.editingId!=null, rec=editing?(((b.records||{}).bankCash||[]).filter(function(r){ return r.id===A.editingId; })[0]||{}):(A._prefill||{});
      var title=editing?(rec.name||'Edit '+c.singular):(c.newLabel||'New Bank or Cash Account');
      var lbl=c.label||'Bank and Cash Accounts', can=function(fn){ return typeof A[fn]==='function' ? !!A[fn](b,lbl) : true; };
      var btns=editing
        ? (can('canEdit')?'<button class="btn btn-primary" onclick="BankForm.save(\'update\')">Update</button>':'')+
          (can('canDelete')?'<button class="btn btn-danger" onclick="BankForm.del()">Delete</button>':'')
        : '<button class="btn btn-primary" onclick="BankForm.save(\'create\')">Create</button><button class="btn" onclick="BankForm.save(\'another\')">Create &amp; add another</button>';
      return A.recCrumb(lbl,title)+
        '<div class="card ff-bank" id="bankForm"><div class="card-head"><h2 style="margin:0">'+esc(c.singular||'Bank or Cash Account')+'</h2></div>'+
        '<div id="bfErr" class="errbox hide"></div>'+bankFieldsHtml(b,rec)+
        '<div class="form-actions">'+btns+'<button class="btn" onclick="App.backFromRecord()||App.backToList()">Cancel</button></div></div>';
    },
    reveal:function(scope){ var d=doc(); var root=scope||d;
      root.querySelectorAll('[data-showif]').forEach(function(el){ var k=el.getAttribute('data-showif'); var cb=d.getElementById((el.closest('#appOverlay')?'qc_':'bf_')+k);
        if(cb) el.hidden=!cb.checked; }); },
    save:function(mode){
      var A=app(), b=A.curBiz(); if(!b) return; if(A.guardWrite && !A.guardWrite(b)) return;
      migrateBanks(b);
      var list=((b.records=b.records||{}).bankCash=(b.records.bankCash||[]).slice());
      var editing=A.editingId!=null, idx=editing?list.findIndex(function(r){ return r.id===A.editingId; }):-1;
      var before=idx>=0?JSON.parse(JSON.stringify(list[idx])):null;
      var rec=before?JSON.parse(JSON.stringify(before)):{};
      var res=applyBankValues(b,rec,readBankForm(b),before?before.id:null);
      if(!res.ok){ var e=doc().getElementById('bfErr'); if(e){ e.textContent=res.error; e.classList.remove('hide'); } var f=doc().getElementById('bf_'+(res.field||'name')); if(f) try{ f.focus(); }catch(_){} return; }
      if(before){ list[idx]=rec; cascadeRename(b,before.name,rec.name); }
      else { rec.id=Date.now(); rec.uuid=A.uuid?A.uuid():String(rec.id); rec.lines=[]; list.push(rec); }
      b.records.bankCash=list;
      try{ if(b.coa){ ensureCashControl(b); if(typeof ensureAllControls==='function') ensureAllControls(b); } }catch(e){}
      try{ refreshSummary(b); }catch(e){}
      try{ A._logActivity(b,before?'update':'create','bankCash',rec,before); }catch(e){}
      A.saveBiz(b);
      if(mode==='another'){ A.editingId=null; A._prefill=null; A.wsMode='form'; A.renderMain(A.curBiz()); return rec; }
      A.editingId=null; if(!(A.backFromRecord && A.backFromRecord())) A.backToList();
      return rec;
    },
    del:function(){ var A=app(); if(A.editingId!=null) A.deleteRecord(A.editingId); },
    applyValues: applyBankValues
  };
  global.BankForm = BankForm;

  /* ============================================== designer template migrations */
  var LABEL_FIX = {
    'Bank name':'Name', 'Bank code':'Code', 'Bank IBAN number':'IBAN', 'Bank Account no.':'Account number',
    'Amount without Tax':'Amount', 'Total with Tax':'Total', 'code':'Code', 'address':'Address',
    'ledger closing balance':'Closing balance', 'Customer code':'Code', 'Supplier code':'Code'
  };
  var NO_BALANCE = { customers:'custBalance', suppliers:'supBalance', employees:'empBalance' };
  /** Mutates a template state; returns true when something changed. */
  function migrateState(key, st){
    if(!st || !Array.isArray(st.blocks)) return false; var ch=false, FED=global.FED;
    /* 37: closing balances are calculated, starting balances live in Settings > Starting Balances */
    if(NO_BALANCE[key]){ var n0=st.blocks.length; st.blocks=st.blocks.filter(function(bl){ return !(bl && bl.field===NO_BALANCE[key]); }); if(st.blocks.length!==n0) ch=true; }
    st.blocks.forEach(function(bl){ if(!bl) return;
      if(bl.type==='field'){
        if(bl.group==='bank' && LABEL_FIX[bl.label]){ bl.label=LABEL_FIX[bl.label]; ch=true; }
        if(key==='employees' && (bl.label==='code'||bl.label==='address')){ bl.label=LABEL_FIX[bl.label]; ch=true; }
        if(bl.field==='itemQty' && bl.label==='Available quantity'){ bl.label='Starting quantity'; ch=true; }
      }
      if(bl.type==='lines' && Array.isArray(bl.columns)) bl.columns.forEach(function(c){ if(!c) return;
        if((c.var==='amountNoTax'||c.key==='amountNoTax') && c.label==='Amount without Tax'){ c.label='Amount'; ch=true; }
        if((c.var==='totalWithTax'||c.key==='totalWithTax') && c.label==='Total with Tax'){ c.label='Total'; ch=true; }
        if((c.var==='items'||c.key==='items') && c.label==='Items'){ c.label='Item'; ch=true; }
        if((c.var==='accounts'||c.key==='accounts') && c.label==='Accounts'){ c.label='Account'; ch=true; }
        if((c.var==='taxRate'||c.key==='taxRate') && c.label==='Tax Rate'){ c.label='Tax code'; ch=true; }
      });
    });
    /* 94: employees get an Email field (the list has an Email column) */
    if(key==='employees' && !st.blocks.some(function(bl){ return bl && (bl.field==='empEmail' || bl.var==='empEmail'); }) && FED && FED.newField){
      try{ var nb=FED.newField('employee','empEmail','Email','email'); if(nb){ nb.var='empEmail'; var at=st.blocks.findIndex(function(bl){ return bl && bl.field==='empAddress'; }); if(at<0) st.blocks.push(nb); else st.blocks.splice(at,0,nb); ch=true; } }catch(e){}
    }
    /* 84: purchase invoices have a due date like sales invoices */
    if((key==='purchInv') && !st.blocks.some(function(bl){ return bl && bl.field==='dueDate'; }) && FED && FED.newField){
      try{ var db=FED.newField('general','dueDate','Due date','date'); if(db){ db.var='dueDate'; db.widthMode='custom'; db.widthVal=16; db.widthUnit='%';
        var ri=st.blocks.findIndex(function(bl){ return bl && bl.field==='reference'; }); var di=st.blocks.findIndex(function(bl){ return bl && bl.field==='date'; });
        var ref=st.blocks[ri>=0?ri:di]; if(ref && ref.row!=null) db.row=ref.row; st.blocks.splice((ri>=0?ri:(di>=0?di:0))+1,0,db); ch=true; } }catch(e){}
    }
    return ch;
  }
  function migrateTemplate(key){
    var MF=global.MgrForms; if(!MF || !MF.tpl) return false; var t=MF.tpl(key); if(!t || !t.state) return false;
    var st; try{ st=JSON.parse(JSON.stringify(t.state)); }catch(e){ return false; }
    if(!migrateState(key, st)) return false;
    var bundle=MF.bundle; if(!bundle || !bundle.templates) return false;
    bundle.templates[key]=Object.assign({}, t, { state:st });
    try{ global.localStorage.setItem('mgr_form_templates', JSON.stringify(bundle)); }catch(e){}
    return true;
  }

  /* ============================================== designer form: live behaviour */
  function itemByName(b,name){ var R=(b&&b.records)||{}; if(blank(name)) return null;
    var i=(R.inventory||[]).filter(function(r){ return r && r.name===name; })[0]; if(i) return { kind:'inv', rec:i };
    var n=(R.nonInvItems||[]).filter(function(r){ return r && r.name===name; })[0]; return n ? { kind:'non', rec:n } : null; }
  function acctLabel(b,idOrName){ if(blank(idOrName)) return ''; var n=((b&&b.coa)||[]).filter(function(x){ return x.id===idOrName; })[0]; return n ? n.name : String(idOrName); }
  function selectByText(sel,val){ if(!sel || blank(val)) return false; var v=String(val);
    for(var i=0;i<sel.options.length;i++){ var o=sel.options[i]; if(o.value===v || o.text===v || o.getAttribute('data-rate')===v){ sel.selectedIndex=i; return true; } }
    var o2=doc().createElement('option'); o2.value=v; o2.text=v; sel.appendChild(o2); sel.value=v; return true; }
  function syncCombo(sel){ if(!sel || !sel.parentNode) return; var box=sel.parentNode.querySelector('[data-combo-val]'); if(!box) return;
    var o=sel.options[sel.selectedIndex], txt=o?String(o.textContent||'').replace(/\s+/g,' ').trim():'', ph=sel.getAttribute('data-ph')||'';
    if(sel.value===''||txt===''){ box.textContent=ph; box.className='li-combo-val placeholder'+(sel.disabled?' locked':''); }
    else { box.textContent=txt; box.className='li-combo-val'+(sel.disabled?' locked':''); } box.title=box.textContent; }
  function taxRateOfCode(b,code){ if(blank(code)) return ''; var t=((b&&b.taxCodes)||[]).filter(function(x){ return x && (x.name===code || String(x.rate)===String(code)); })[0]; return t ? String(t.rate) : String(code); }

  /** User picked an item in a designer line: description, price, account and tax follow the item. */
  function onItemPicked(b,key,sel){
    var tr=sel.closest('tr'); if(!tr) return; var it=itemByName(b,sel.value); if(!it) return;
    var buy=!!PURCHASE_KEYS[key], r=it.rec;
    var desc=tr.querySelector('[data-var="description"]');
    if(desc && (blank(desc.value) || desc.getAttribute('data-auto')===desc.value)){ var dv=r.description&&r.description!==r.name ? r.description : (r.name||''); desc.value=dv; desc.setAttribute('data-auto',dv); fire(desc,'input'); }
    var price=tr.querySelector('[data-var="price"]'); var pv=buy?(r.purchasePrice!=null?r.purchasePrice:r.itemPurchPrice):(r.salesPrice!=null?r.salesPrice:r.itemSellPrice);
    if(price && !blank(pv)){ price.value=String(num(pv)); }
    var acc=tr.querySelector('[data-account-col]');
    if(acc && it.kind==='non'){ var an=acctLabel(b, buy?r.purchaseAccount:r.salesAccount); if(an){ acc.disabled=false; selectByText(acc,an); syncCombo(acc); fire(acc,'change'); } }
    var tax=tr.querySelector('[data-var="taxRate"]'); var tc=r.taxCode!=null?r.taxCode:r.tax;
    if(tax && !blank(tc)){ selectByText(tax, taxRateOfCode(b,tc)); syncCombo(tax); }
    if(price) fire(price,'input');
  }

  /** ↑ ↓ ⧉ × on every designer line; works for rows added later (they clone row 1). */
  var BTN='<button type="button" class="li-btn" data-ff-act="up" title="Move up" tabindex="-1">↑</button>'+
          '<button type="button" class="li-btn" data-ff-act="down" title="Move down" tabindex="-1">↓</button>'+
          '<button type="button" class="li-btn" data-ff-act="dup" title="Duplicate line" tabindex="-1">⧉</button>'+
          '<button type="button" class="li-del" data-ff-act="del" title="Remove line" aria-label="Remove line" tabindex="-1">×</button>';
  function copyRowValues(src,dst){
    var a=src.querySelectorAll('input,select,textarea'), z=dst.querySelectorAll('input,select,textarea');
    for(var i=0;i<a.length && i<z.length;i++){ if(a[i].type==='checkbox') z[i].checked=a[i].checked; else z[i].value=a[i].value; z[i].disabled=a[i].disabled; }
    var bx=src.querySelectorAll('[data-combo-val]'), bz=dst.querySelectorAll('[data-combo-val]');
    for(var j=0;j<bx.length && j<bz.length;j++){ bz[j].textContent=bx[j].textContent; bz[j].className=bx[j].className; }
  }
  function enhanceLines(host,key,b){
    var tbl=host.querySelector('[data-line-items]'); if(!tbl || tbl.getAttribute('data-ff')) return; tbl.setAttribute('data-ff','1');
    tbl.classList.add('ff-lines'); var wrap=tbl.closest('.li-wrap'); if(wrap) wrap.classList.add('ff-scroll');
    var th=tbl.tHead && tbl.tHead.querySelector('th.li-actc'); if(th){ th.classList.add('ff-actc'); }
    Array.prototype.forEach.call(tbl.tBodies[0]?tbl.tBodies[0].rows:[], function(tr){ var c=tr.querySelector('td.li-actc'); if(c){ c.innerHTML=BTN; c.classList.add('ff-actc'); } });
    tbl.querySelectorAll('[data-combo-val]').forEach(function(bx){ bx.title=bx.textContent; });
    /* a column total of unit prices means nothing */
    tbl.querySelectorAll('tfoot [data-total="price"]').forEach(function(td){ td.removeAttribute('data-total'); td.textContent=''; });
    tbl.addEventListener('click',function(e){ var btn=e.target.closest && e.target.closest('[data-ff-act]'); if(!btn) return; e.preventDefault();
      var tr=btn.closest('tr'), tb=tr&&tr.parentNode; if(!tb) return; var act=btn.getAttribute('data-ff-act'), moved=null;
      if(act==='up' && tr.previousElementSibling){ tb.insertBefore(tr,tr.previousElementSibling); moved=tr; }
      else if(act==='down' && tr.nextElementSibling){ tb.insertBefore(tr.nextElementSibling,tr); moved=tr; }
      else if(act==='dup'){ var cp=tr.cloneNode(true); copyRowValues(tr,cp); tb.insertBefore(cp,tr.nextSibling); moved=cp; }
      else if(act==='del'){ if(typeof global.delLineRow==='function') global.delLineRow(btn); else if(tb.rows.length>1) tb.removeChild(tr); moved=tb.rows[0]; }
      if(moved){ var f=moved.querySelector('[data-var]'); if(f) fire(f,'input'); } });
    /* item picks by the user (not the values restored when an existing record opens); a pick from the
       searchable list (js/quick-create.js) is a script event marked userPick */
    tbl.addEventListener('change',function(e){ var s=e.target; if(!(e.isTrusted || e.userPick) || !s || !s.matches || !s.matches('[data-item-select]')) return; onItemPicked(b,key,s); });
  }
  /** Inventory items: the stored qty is the STARTING quantity; available quantity is calculated. */
  function enhanceInventory(host,b,rec){
    var q=host.querySelector('[data-field-var="itemQty"]'); if(!q || host.querySelector('[data-ff-avail]')) return;
    var fld=q.closest('.field'); var lbl=fld&&fld.querySelector('label'); if(lbl && /available/i.test(lbl.textContent)) lbl.textContent='Starting quantity';
    var avail=function(){ var start=num(q.value); if(!rec || !rec.id) return start; try{ var s=invItemStats(b,rec); return Math.round(((s.qtyOnHand||0)-(num(rec.qty))+start)*1e6)/1e6; }catch(e){ return start; } };
    var box=doc().createElement('div'); box.className='field'; box.setAttribute('data-ff-avail','1'); box.setAttribute('data-noprint','');
    if(fld && fld.getAttribute('style')) box.setAttribute('style',fld.getAttribute('style'));
    box.innerHTML='<label>Available quantity</label><input type="text" readonly tabindex="-1" title="Calculated: starting quantity + purchases − sales" value="'+esc(avail())+'">';
    if(fld && fld.parentNode) fld.parentNode.insertBefore(box,fld.nextSibling);
    q.addEventListener('input',function(){ box.querySelector('input').value=avail(); });
  }
  /** Print options are saved with the record as the field / column vars that are switched off. */
  function printKeyVar(form,pk){
    var el=form.querySelector('[data-print-key="'+pk+'"]'); if(!el) return null;
    var f=el.querySelector('[data-field-var]'); if(f) return 'f:'+f.getAttribute('data-field-var');
    var cells=form.querySelectorAll('td[data-print-key="'+pk+'"]');
    for(var i=0;i<cells.length;i++){ var v=cells[i].querySelector('[data-var]'); if(v) return 'c:'+v.getAttribute('data-var'); }
    return 'k:'+pk;
  }
  function readPrintOff(host){ var form=host.querySelector('.app-form'); if(!form) return null; var off=[], any=false;
    form.querySelectorAll('[data-print-target]').forEach(function(cb){ any=true; if(!cb.checked){ var v=printKeyVar(form,cb.getAttribute('data-print-target')); if(v) off.push(v); } });
    return any ? off : null; }
  function applyPrintOff(host,off){ var form=host.querySelector('.app-form'); if(!form || !Array.isArray(off)) return;
    var set={}; off.forEach(function(v){ set[v]=1; });
    form.querySelectorAll('[data-print-target]').forEach(function(cb){ var v=printKeyVar(form,cb.getAttribute('data-print-target')); var want=!set[v]; if(cb.checked!==want){ cb.checked=want; fire(cb,'change'); } }); }

  /** Column — Qty on designed forms: off hides the column and every line counts as 1 (saved as colQty:false). */
  function qtyToggle(host,src){
    var tbl=host.querySelector('[data-line-items]'); if(!tbl || host.querySelector('[data-ff-qty]')) return;
    var q=tbl.querySelector('tbody [data-var="qty"]'); if(!q) return; var cell=q.closest('td'); var pk=cell&&cell.getAttribute('data-print-key'); if(!pk) return;
    if(!tbl.querySelector('[data-var="price"]')) return;
    var wrap=tbl.closest('.li-wrap')||tbl; var box=doc().createElement('div'); box.className='ff-opts'; box.setAttribute('data-noprint','');
    box.innerHTML='<label class="ff-chk"><input type="checkbox" data-ff-qty checked> Column — Qty</label>';
    wrap.parentNode.insertBefore(box,wrap.nextSibling);
    var cb=box.querySelector('input'), st=doc().createElement('style'); host.appendChild(st);
    var fill=function(row){ var i=row&&row.querySelector('[data-var="qty"]'); if(i && blank(i.value)){ i.value='1'; } };
    var apply=function(){ var off=!cb.checked; st.textContent=off?('#deHost [data-print-key="'+pk+'"]{display:none !important}'):'';
      if(off) Array.prototype.forEach.call(tbl.tBodies[0].rows,function(r){ fill(r); var p=r.querySelector('[data-var]'); if(p) fire(p,'input'); }); };
    tbl.addEventListener('input',function(e){ if(!cb.checked){ fill(e.target.closest && e.target.closest('tr')); } },true);
    /* switching it off by hand folds each line's qty into its price, so the amounts stay the same */
    cb.addEventListener('change',function(){ if(!cb.checked) Array.prototype.forEach.call(tbl.tBodies[0].rows,function(r){ var qi=r.querySelector('[data-var="qty"]'), pi=r.querySelector('[data-var="price"]'); if(!qi||!pi||blank(qi.value)||blank(pi.value)) return; var qv=num(qi.value); if(qv===1) return; pi.value=String(Math.round(qv*num(pi.value)*100)/100); qi.value='1'; }); apply(); });
    if(src && src.colQty===false){ cb.checked=false; apply(); }
  }
  function afterMount(key,prefill){
    var A=app(), b=A.curBiz(), host=doc().getElementById('deHost'); if(!host || !b) return;
    var form=host.querySelector('.app-form'); if(form) form.classList.add('ff-form');
    var rec=(A.editingId!=null)?((A.records(b)||[]).filter(function(r){ return r.id===A.editingId; })[0]||null):null;
    /* new documents open on today's date (Inter Account Transfer and every other designed form) */
    if(A.editingId==null){ host.querySelectorAll('input[type="date"][data-field-var="date"]').forEach(function(d){ if(blank(d.value)){ d.value=today(); fire(d,'input'); fire(d,'change'); } }); }
    enhanceLines(host,key,b);
    qtyToggle(host, rec || prefill || null);
    if(key==='inventory') enhanceInventory(host,b,rec);
    var src=rec || prefill || null;
    if(src && Array.isArray(src.printOff)) applyPrintOff(host,src.printOff);
  }

  /* ========================================================== global search */
  var SEARCH_SKIP={ lines:1, uuid:1, id:1, allocations:1, custom:1 };
  function recTitle(key,r){ return String(r.reference||r.name||r.code||r.description||'').trim(); }
  function recText(r){ var parts=[]; Object.keys(r||{}).forEach(function(k){ if(SEARCH_SKIP[k]) return; var v=r[k]; if(v==null||typeof v==='object') return; parts.push(String(v)); });
    if(r && r.custom) Object.keys(r.custom).forEach(function(k){ parts.push(String(r.custom[k]==null?'':r.custom[k])); });
    (r&&r.lines||[]).forEach(function(ln){ if(ln) parts.push(String(ln.item||''),String(ln.desc||ln.description||''),String(ln.accountName||'')); });
    return parts.join(' \u0001 ').toLowerCase(); }
  function searchAll(b,q){
    var t=String(q||'').trim().toLowerCase(); if(!t) return []; var R=(b&&b.records)||{}, L=k2l(), out=[];
    var nav=[]; try{ SIDEBAR.forEach(function(s){ if(s && s[1] && String(s[1]).toLowerCase().indexOf(t)>=0) nav.push({ label:s[1] }); }); }catch(e){}
    if(nav.length) out.push({ group:'Go to', key:'', items:nav.slice(0,6).map(function(n){ return { title:n.label, sub:'', nav:n.label }; }) });
    Object.keys(reg()).forEach(function(key){ if(!L[key]) return; var hits=[];
      (R[key]||[]).forEach(function(r){ if(!r) return; if(recText(r).indexOf(t)>=0) hits.push(r); });
      if(!hits.length) return; var c=reg()[key];
      out.push({ group:c.label||L[key], key:key, total:hits.length, items:hits.slice(0,6).map(function(r){
        var party=r.customer||r.supplier||r.paidBy||r.payee||r.employee||'', amt=(r.total!=null&&r.total!=='')?r.total:r.amount, dt=r.issueDate||r.date||'';
        var ttl=(!r.name&&!blank(r.reference))?(c.singular+' '+r.reference):(recTitle(key,r)||c.singular); if(party===ttl) party='';
        return { id:r.id, title:ttl, sub:[dt?fmtD(dt):'', party, (r.description&&r.description!==ttl)?r.description:'', (amt!=null&&amt!==''&&Number(amt))?money(amt):''].filter(Boolean).join(' · ') }; }) }); });
    return out;
  }
  function fmtD(v){ var A=app(); try{ return A.fmtDate ? A.fmtDate(v) : v; }catch(e){ return v; } }
  function money(v){ var A=app(); try{ return A.money(v); }catch(e){ return String(v); } }
  var SR=null;
  function closeSearch(){ if(SR && SR.el && SR.el.parentNode) SR.el.parentNode.removeChild(SR.el); SR=null; }
  function renderSearch(input,q){
    var A=app(), b=A.curBiz(); if(!b){ closeSearch(); return; }
    var groups=searchAll(b,q); if(!String(q||'').trim()){ closeSearch(); return; }
    if(!SR){ var el=doc().createElement('div'); el.className='gs-pop'; el.setAttribute('role','listbox'); doc().body.appendChild(el); SR={ el:el, input:input, flat:[], hi:0 };
      el.addEventListener('mousedown',function(e){ var it=e.target.closest && e.target.closest('[data-gs]'); if(!it) return; e.preventDefault(); pick(+it.getAttribute('data-gs')); }); }
    SR.input=input; SR.flat=[]; var h='';
    if(!groups.length) h='<div class="gs-none">No matches for “'+esc(q)+'”</div>';
    groups.forEach(function(g){ h+='<div class="gs-g">'+esc(g.group)+(g.total>g.items.length?' <span>'+g.items.length+' of '+g.total+'</span>':'')+'</div>';
      g.items.forEach(function(it){ var i=SR.flat.length; SR.flat.push({ key:g.key, id:it.id, nav:it.nav });
        h+='<div class="gs-i'+(i===SR.hi?' hi':'')+'" data-gs="'+i+'"><div class="gs-t">'+esc(it.title)+'</div>'+(it.sub?'<div class="gs-s">'+esc(it.sub)+'</div>':'')+'</div>'; }); });
    SR.el.innerHTML=h;
    var r=input.getBoundingClientRect(), w=Math.max(r.width,380), vw=global.innerWidth||1024;
    SR.el.style.width=w+'px'; SR.el.style.left=Math.max(8,Math.min(r.left, vw-w-8))+'px'; SR.el.style.top=(r.bottom+4)+'px';
  }
  function pick(i){ var A=app(), it=SR && SR.flat[i]; closeSearch(); if(!it) return;
    try{ var inp=doc().getElementById('wsSearch'); if(inp) inp.value=''; }catch(e){}
    if(it.nav){ A.selectSection(it.nav); return; }
    var ENT={ customers:1, suppliers:1, employees:1, bankCash:1, inventory:1, fixedAssets:1, capital:1 };
    var label=k2l()[it.key]; if(!label) return;
    if(ENT[it.key] && A.openLedger){ A.selectSection(label); A.openLedger(it.id); return; }
    A.gotoRecord(it.key,it.id);
  }
  function searchKeys(e){ if(!SR) return; var n=SR.flat.length;
    if(e.key==='ArrowDown'){ e.preventDefault(); SR.hi=Math.min(n-1,SR.hi+1); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); SR.hi=Math.max(0,SR.hi-1); }
    else if(e.key==='Enter'){ e.preventDefault(); pick(SR.hi); return; }
    else if(e.key==='Escape'){ closeSearch(); return; } else return;
    SR.el.querySelectorAll('.gs-i').forEach(function(x){ x.classList.toggle('hi', +x.getAttribute('data-gs')===SR.hi); });
    var h=SR.el.querySelector('.gs-i.hi'); if(h && h.scrollIntoView) try{ h.scrollIntoView({block:'nearest'}); }catch(_){} }

  /* ======================================================== column helpers */
  function customCols(b,key){ var c=(b&&b.formConfig&&b.formConfig[key])||{}; return (c.custom||[]).filter(function(x){ return x && (x.type||'field')==='field' && x.key; })
    .map(function(x){ return { key:'cf_'+x.key, label:x.label||'Custom field', kind:(x.dataType==='number'?'money':'text'), custom:1, calc:function(r){ var v=r&&r.custom?r.custom[x.key]:''; return v==null?'':v; } }; }); }

  /* =============================================================== install */
  function install(){
    var A=app(); if(!A || A._formsFixes) return; A._formsFixes=true;
    var wrap=function(name,fn){ var orig=A[name]; if(typeof orig!=='function') return; A[name]=function(){ return fn.call(this,orig,arguments); }; };

    /* overlays that belong to a page close when the page changes */
    var closeNav=function(all){ var d=doc(); if(!d||!d.getElementById) return; var o=d.getElementById('appOverlay'); if(o && (all || o.getAttribute('data-nav-close'))) o.remove(); closeSearch(); };
    ['selectSection','go','openTool','openSetting','gotoRecord','openLedger'].forEach(function(n){ wrap(n,function(orig,args){ closeNav(n!=='openLedger'); return orig.apply(this,args); }); });
    wrap('renderWorkspace',function(orig,args){ closeNav(false); try{ var b=this.curBiz&&this.curBiz(); if(b && migrateBanks(b)) this.saveBiz(b); }catch(e){} return orig.apply(this,args); });

    /* Bank & Cash: Manager's own form instead of the designer */
    /* routed through the native-form hook so the permission wrapper around formHtml (users.js) still applies */
    wrap('_nativeTxnForm',function(orig,args){ if(args[1]==='bankCash') return true; return orig.apply(this,args); });
    var TF=global.TxnForms; if(TF){ var tfHtml=TF.formHtml, tfMount=TF.mount;
      TF.formHtml=function(b,key){ return key==='bankCash' ? BankForm.html(b) : tfHtml.apply(this,arguments); };
      TF.mount=function(key){ if(key==='bankCash'){ try{ var f=doc().getElementById('bf_name'); if(f) f.focus(); }catch(e){} return; } return tfMount.apply(this,arguments); }; }

    /* list columns: Manager's default selection, settings fields are not columns, custom fields are */
    wrap('_colPool',function(orig,args){ var c=args[0]; var pool=orig.apply(this,args)||[];
      pool=pool.filter(function(col){ var f=((c&&c.form)||[]).filter(function(x){ return x.key===col.key; })[0]; return !(f && f.noCol && !(c.columns||[]).some(function(x){ return x.key===col.key; })); });
      var key=null; try{ key=Object.keys(reg()).filter(function(k){ return reg()[k]===c; })[0]; }catch(e){}
      if(key){ var seen={}; pool.forEach(function(p){ seen[String(p.label||'').toLowerCase()]=1; seen[p.key]=1; });
        var extra=customCols(this.curBiz(),key).filter(function(x){ return !seen[x.key] && !seen[String(x.label).toLowerCase()]; });
        var li=pool.findIndex(function(p){ return p.key==='__ledger'; }); if(li<0) pool=pool.concat(extra); else pool.splice.apply(pool,[li,0].concat(extra)); }
      return pool; });
    wrap('_cols',function(orig,args){ var c=args[0]; var out=orig.apply(this,args); if(!c || !c.defaultCols || out!==c.columns) return out;
      var want={}; c.defaultCols.forEach(function(k){ want[k]=1; }); return c.columns.filter(function(x){ return want[x.key]; }); });

    /* designer templates: migrate the stored state before it is turned into HTML */
    wrap('_refreshTemplateFromState',function(orig,args){ try{ migrateTemplate(args[0]); }catch(e){} return orig.apply(this,args); });
    /* item lists: inventory AND non-inventory items; qty shown is what is available now */
    wrap('appListsForEditor',function(orig,args){ var L=orig.apply(this,args); try{ var b=args[0]||this.curBiz(); (L.items||[]).forEach(function(it){ var r=((b.records||{}).inventory||[]).filter(function(x){ return x.name===it.name; })[0]; if(r){ try{ it.qty=invItemStats(b,r).qtyOnHand; }catch(e){} } }); }catch(e){} return L; });
    wrap('_liveOptionsFor',function(orig,args){ var out=orig.apply(this,args); var b=args[0], src=args[1]; if(src!=='item') return out;
      var nis=((b&&b.records&&b.records.nonInvItems)||[]).filter(function(i){ return i && i.name; }); if(!nis.length) return out;
      return ['<optgroup label="Inventory items">'].concat(out,['</optgroup><optgroup label="Non-inventory items">'],
        nis.map(function(i){ return '<option value="'+esc(i.name)+'" data-name="'+esc(i.name)+'" data-code="'+esc(i.code||'')+'" data-unit="'+esc(i.unit||'')+'" data-sell="'+esc(i.salesPrice||'')+'" data-purch="'+esc(i.purchasePrice||'')+'" data-kind="non">'+esc(i.name)+'</option>'; }),['</optgroup>']); });
    wrap('_mountDesignedForm',function(orig,args){ var pf=this._prefill; var r=orig.apply(this,args); try{ afterMount(args[0],pf); }catch(e){ if(global.console) console.warn('forms-fixes mount',e); } return r; });
    wrap('mapRecordToTokens',function(orig,args){ var key=args[0], rec=args[1]||{}; var d=orig.apply(this,args);
      if(key==='employees'){ if(d.empEmail==null && rec.email!=null) d.empEmail=rec.email; if(d.empName==null && rec.name!=null) d.empName=rec.name; if(d.empCode==null && rec.code!=null) d.empCode=rec.code; if(d.empAddress==null && rec.address!=null) d.empAddress=rec.address; }
      if(key==='customers'||key==='suppliers'){ var p=key==='customers'?'cust':'sup'; [['Name','name'],['Code','code'],['Email','email'],['Mobile','phone'],['Address','address'],['TRN','trn']].forEach(function(m){ if(d[p+m[0]]==null && rec[m[1]]!=null) d[p+m[0]]=rec[m[1]]; }); }
      if(key==='inventory'){ [['itemName','name'],['itemCode','code'],['itemUnit','unit'],['itemSellPrice','salesPrice'],['itemPurchPrice','purchasePrice'],['itemQty','qty'],['itemOpeningCost','openingCost']].forEach(function(m){ if(d[m[0]]==null && rec[m[1]]!=null) d[m[0]]=rec[m[1]]; }); }
      if(rec.dueDate!=null && d.dueDate==null) d.dueDate=rec.dueDate;
      return d; });
    /* save: print options travel with the record; nothing the form does not show is lost on Update */
    wrap('saveDesignedRecord',function(orig,args){ var key=args[0], host=doc().getElementById('deHost');
      this._ffSave={ key:key, before:(this.editingId!=null)?JSON.parse(JSON.stringify(((this.records(this.curBiz())||[]).filter(function(r){ return r.id===App.editingId; })[0])||null)):null, printOff:host?readPrintOff(host):null, qtyOff:!!(host && host.querySelector('[data-ff-qty]') && !host.querySelector('[data-ff-qty]').checked), hasQty:!!(host && host.querySelector('[data-ff-qty]')) };
      try{ return orig.apply(this,args); } finally { this._ffSave=null; } });
    wrap('_applyDesignedToNative',function(orig,args){ var key=args[0], rec=args[1]; var r=orig.apply(this,args); var S=this._ffSave;
      if(key==='employees'){ if(blank(rec.email) && !blank(rec.empEmail)) rec.email=rec.empEmail; }
      if(rec && S && S.key===key){
        if(S.printOff) rec.printOff=S.printOff;
        if(S.hasQty) rec.colQty=!S.qtyOff;
        var before=S.before; if(before){ Object.keys(before).forEach(function(k){ if(!(k in rec)) rec[k]=before[k]; });
          /* the document keeps its identity: allocations and history point at its uuid */
          if(before.uuid) rec.uuid=before.uuid; }
      }
      return r; });
    /* the + Add new bank dialog shows the same custom fields (Account number) as the full form */
    wrap('_openOverlay',function(orig,args){ var r=orig.apply(this,args); if(doc().getElementById('qc_hasIban') && !doc().querySelector('#appOverlay .ff-cf')){ try{ var b=A.curBiz(), cf=bankCustomFields(b), body=doc().querySelector('#appOverlay .app-modal-b'); if(body && cf.length){ var h='<div class="ff-cf">'+cf.map(function(x){ var inp; try{ inp=A.cfEntryInput(x,'qc_cf_'+x.key,'',''); }catch(e){ inp='<input type="text" id="qc_cf_'+esc(x.key)+'">'; } return '<label class="fld">'+esc(x.label||'Custom field')+'</label>'+inp; }).join('')+'</div>'; body.insertAdjacentHTML('beforeend',h); } }catch(e){} } return r; });
    wrap('createEntityRecord',function(orig,args){ var key=args[0]; var cfv=null; if(key==='bankCash'){ try{ var b0=this.curBiz(); bankCustomFields(b0).forEach(function(x){ var el=doc().getElementById('qc_cf_'+x.key); if(el && !blank(el.value)){ cfv=cfv||{}; cfv[x.key]=String(el.value).trim(); } }); }catch(e){} }
      var r=orig.apply(this,args); if(r && r.ok && key==='bankCash'){ var b=this.curBiz(), rec=((b.records||{}).bankCash||[]).filter(function(x){ return x.id===r.record.id; })[0]; if(rec){ if(!rec.hasIban) rec.iban=''; if(!rec.creditLimitOn) rec.creditLimit=''; if(cfv) rec.custom=Object.assign({},rec.custom||{},cfv); this.saveBiz(b); r.record=rec; } } return r; });
    /* global search: every module, grouped by type */
    A.globalSearch=function(q){ var d=doc(); var inp=(d.activeElement && d.activeElement.tagName==='INPUT') ? d.activeElement : d.getElementById('wsSearch'); if(!inp) return; renderSearch(inp,q);
      if(!inp._ffKeys){ inp._ffKeys=true; inp.addEventListener('keydown',searchKeys); inp.addEventListener('blur',function(){ setTimeout(closeSearch,150); }); } };
    A.searchAll=function(b,q){ return searchAll(b,q); };
  }

  var FormsFixes={ install:install, migrateBanks:migrateBanks, migrateState:migrateState, searchAll:searchAll, onItemPicked:onItemPicked, readPrintOff:readPrintOff, applyPrintOff:applyPrintOff, customCols:customCols };
  global.FormsFixes=FormsFixes;
  install();
})(typeof window!=='undefined' ? window : this);
