/* ===================== Data safety & data check tools =====================
   - Old records open in Edit with every value: a record saved before line items
     existed (e.g. an imported receipt with only a header amount) gets one line
     carrying that amount, so it is never shown as 0.00.
   - Data-safety guard: when a record has a total but its lines did not load,
     Update is disabled — saving would silently set the amount to 0.
   - Journal entries can only be saved when Dr = Cr and both are > 0.
   - "Match payers": old receipts whose customer is only written in the
     Description are matched against Customers, shown as a preview, and changed
     only after the user confirms (never automatically).
   - "Data check": every record whose header total differs from its lines, and
     every document the general ledger had to send (partly) to Suspense.
   ========================================================================== */
(function(){
  'use strict';
  if(typeof App==='undefined') return;
  function num(v){ return (typeof GL!=='undefined')?GL.num(v):(parseFloat(v)||0); }
  function r2(v){ return Math.round((Number(v)||0)*100)/100; }
  function blank(v){ return v==null || String(v).trim()===''; }
  function esc(s){ return App.esc(s==null?'':s); }

  var CASH_KEYS={ receipts:1, payments:1, expenseClaims:1 };
  var INV_KEYS={ salesInv:1, creditNotes:1, purchInv:1, debitNotes:1, salesQuotes:1, salesOrders:1, purchQuotes:1, purchOrders:1 };

  /** The amount a record's header shows. */
  function headerTotal(key,rec){ if(!rec) return 0;
    if(key==='journal') return num(rec.debit!=null&&rec.debit!==''?rec.debit:0);
    if(key==='depreciation'||key==='amortization') return num(rec.amount);
    if(CASH_KEYS[key]) return num(rec.amount!=null&&rec.amount!==''?rec.amount:rec.total);
    return num(rec.total!=null&&rec.total!==''?rec.total:rec.amount); }
  /** What the record's lines add up to (same measure as the header). */
  function linesTotal(key,rec){ var L=(rec&&rec.lines)||[];
    if(key==='journal') return L.reduce(function(s,l){ return s+num(l&&l.debit); },0);
    if(key==='depreciation'||key==='amortization') return L.reduce(function(s,l){ return s+num(l&&((l.amount!=null&&l.amount!=='')?l.amount:(l.amortExpense!=null?l.amortExpense:l.depExpense))); },0);
    return L.reduce(function(s,l){ if(!l) return s; var x=GL.lineNums(l); return s+x.gross; },0); }
  App.recordHeaderTotal=headerTotal; App.recordLinesTotal=linesTotal;

  /** Lines to show in an Edit form. A legacy record with a total but no lines gets one line with that total. */
  App._linesForEdit=function(key,rec){ if(!rec) return [];
    var L=(rec.lines||[]).filter(function(l){ return l; }); if(L.length) return rec.lines;
    var amt=headerTotal(key,rec); if(!amt) return rec.lines||[];
    if(CASH_KEYS[key]) return [{ item:'', account:rec.account||'', sub:rec.sub||'', desc:'', description:'', qty:'', price:amt, net:amt, amount:amt, taxAmt:0, tax:'', taxCode:'' }];
    if(INV_KEYS[key]){ var sub=num(rec.subtotal!=null&&rec.subtotal!==''?rec.subtotal:amt-num(rec.tax));
      return [{ item:'', account:rec.account||'', desc:rec.description||'', description:rec.description||'', qty:1, price:sub, net:sub, amount:amt, taxAmt:num(rec.tax), tax:'' }]; }
    return rec.lines||[]; };

  /* ---------------- designed forms: put back line values the template's item handler cleared ---------------- */
  App._reapplyLineValues=function(host,data){ var tbl=host&&host.querySelector&&host.querySelector('[data-line-items]'); if(!tbl||!tbl.tBodies[0]||!data||!Array.isArray(data.lines)) return;
    var rows=tbl.tBodies[0].rows;
    for(var i=0;i<rows.length&&i<data.lines.length;i++){ var ln=data.lines[i], tr=rows[i], changed=[];
      Object.keys(ln).forEach(function(k){ if(k==='item'||k==='items') return; var v=ln[k]; if(v==null||v==='') return; if(typeof v==='object') return;
        tr.querySelectorAll('[data-var="'+k+'"]').forEach(function(el){ if(el.type==='checkbox') return; if(String(el.value)===String(v)) return;
          if(el.tagName==='SELECT'){ var found=false; for(var j=0;j<el.options.length;j++){ if(el.options[j].value===String(v)||el.options[j].text===String(v)){ el.selectedIndex=j; found=true; break; } }
            if(!found){ var o=document.createElement('option'); o.value=String(v); o.text=String(v); el.appendChild(o); el.value=String(v); } }
          else el.value=String(v);
          changed.push(el); }); });
      changed.forEach(function(el){ try{ el.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} });
      if(changed.length){ var any=tr.querySelector('input'); if(any){ try{ any.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){} } } } };

  /* ---------------- data-safety guard ---------------- */
  var GUARD_MSG='Line items did not load — saving would set the amount to 0.';
  App._linesLostOnLoad=function(key,rec,loadedLineCount,loadedTotal){ var c=(App.cfg&&REG[key])||REG[key]; if(!rec||!c||!c.lines) return false;
    var tot=headerTotal(key,rec); if(!(Math.abs(tot)>0.005)) return false;
    return !loadedLineCount || Math.abs(num(loadedTotal))<0.005; };
  App._linesLoadGuard=function(host,key,rec){ if(!rec||!host) return; var tbl=host.querySelector('[data-line-items]'); if(!tbl||!tbl.tBodies[0]) return;
    var n=0, tot=0; Array.prototype.forEach.call(tbl.tBodies[0].rows,function(tr){ var any=false; tr.querySelectorAll('[data-var]').forEach(function(el){ if(el.type!=='checkbox'&&String(el.value||'').trim()!=='') any=true;
      var k=el.getAttribute('data-var'); if(k==='amount'||k==='totalWithTax'||k==='amountNoTax'||k==='depExpense'||k==='price') tot+=Math.abs(num(el.value)); }); if(any) n++; });
    if(!App._linesLostOnLoad(key,rec,n,tot)) return;
    App._blockUpdate(host,GUARD_MSG); };
  App._blockUpdate=function(host,msg){ var bar=document.createElement('div'); bar.className='info-bar data-guard'; bar.setAttribute('role','alert');
    bar.style.cssText='color:var(--danger,#b42318);border-color:var(--danger,#b42318);font-weight:600'; bar.textContent=msg;
    try{ host.parentNode.insertBefore(bar,host); }catch(e){}
    document.querySelectorAll('.form-actions .btn-primary').forEach(function(btn){ btn.disabled=true; btn.title=msg; }); App._saveBlocked=msg; };

  /** Why a designed-form record must not be saved (null when it is fine). */
  App._designedSaveProblem=function(b,key,rec,before){
    if(before && App._saveBlocked) return App._saveBlocked;
    if(key==='journal'){ var dr=0,cr=0; (rec.lines||[]).forEach(function(l){ dr+=num(l.debit); cr+=num(l.credit); }); dr=r2(dr); cr=r2(cr);
      if(!(dr>0)||!(cr>0)) return 'Enter the debit and credit amounts. A journal entry needs both.';
      if(Math.abs(dr-cr)>0.005) return 'The journal entry is out of balance: debits '+App.money(dr)+', credits '+App.money(cr)+' (difference '+App.money(Math.abs(dr-cr))+'). Debits must equal credits.';
      var bad=(rec.lines||[]).filter(function(l){ if(!(num(l.debit)||num(l.credit))) return false; var n=GL.lineAcct(b,l); var k=n&&GL.subKind(b,n); return k && blank(l.sub!=null&&l.sub!==''?l.sub:l.subAccount); })[0];
      if(bad){ var n2=GL.lineAcct(b,bad); return 'Select a '+(GL.subKind(b,n2)==='bankCash'?'bank or cash account':'sub-account')+' for “'+n2.name+'”.'; } }
    if(before){ var c=REG[key]; if(c&&c.lines && Math.abs(headerTotal(key,before))>0.005 && Math.abs(linesTotal(key,rec))<0.005 && !(rec.lines||[]).length) return GUARD_MSG; }
    return null; };

  /** Control / system accounts kept out of line account dropdowns (#68). Journal entries may use any account;
      Cash & cash equivalents is a journal-only line account (banks are picked as its sub-account). */
  App.lineAccountHidden=function(b,id,key){ var n=(b&&b.coa||[]).find(function(x){ return x&&x.id===id; }); if(!n) return false; if(key==='journal') return false;
    if(n.cashControl || /^cash & cash equivalents$/i.test(n.name||'')) return true;
    if(/^retained earnings$/i.test(n.name||'') || n.sbeControl || /^starting balance equity$/i.test(n.name||'') || n.suspenseControl || /^suspense$/i.test(n.name||'')) return true;
    return false; };

  /* ---------------- designed forms: small behaviours the templates lack ---------------- */
  function fv(host,k){ return host.querySelector('[data-field-var="'+k+'"]'); }
  function warnBox(host,id){ var w=host.querySelector('#'+id); if(!w){ w=document.createElement('div'); w.id=id; w.className='info-bar qty-warn'; w.style.display='none'; host.appendChild(w); } return w; }
  App._enhanceDesigned=function(host,key){ var b=App.curBiz(); if(!b||!host) return; var R=b.records||{};
    /* #62 payslip: the employee code follows the employee */
    if(key==='payslips'){ var es=fv(host,'empName'), ec=fv(host,'empCode'); if(es&&ec){ var setc=function(force){ var e=(R.employees||[]).find(function(x){ return x&&x.name===es.value; }); if(e && e.code && (force||!ec.value)) ec.value=e.code; }; es.addEventListener('change',function(){ setc(true); }); setc(false); } }
    /* #67 depreciation / amortization: picking the asset fills its rate */
    if(key==='depreciation'||key==='amortization'){ var tb=host.querySelector('[data-line-items]'); if(tb) tb.addEventListener('change',function(e){ var s=e.target; if(!s||s.tagName!=='SELECT'||s.getAttribute('data-var')!=='asset') return;
        var o=s.options[s.selectedIndex]; var tr=s.closest('tr'); var rate=o&&o.getAttribute('data-fadeprate'); var ri=tr&&tr.querySelector('[data-var="depRate"]');
        if(ri && rate!=null && rate!==''){ ri.value=rate; try{ ri.dispatchEvent(new Event('input',{bubbles:true})); }catch(_){} } }); }
    /* #70 bank reconciliation: book balance at the date and the difference to the statement */
    if(key==='bankRec'){ var bs=fv(host,'bankName'), dt=fv(host,'date'), sb=fv(host,'statementBalance'); var box=warnBox(host,'brBook'); box.className='info-bar';
      var upd=function(){ var bk=(R.bankCash||[]).find(function(x){ return x&&bs&&x.name===bs.value; }); if(!bk){ box.style.display='none'; return; }
        var book=App.bankBookBalance(b,bk.name,dt?dt.value:''); var diff=Math.round((num(sb&&sb.value)-book)*100)/100; box.style.display='';
        box.innerHTML='Book balance '+(dt&&dt.value?'at '+esc(App.fmtDate(dt.value)):'')+': <b>'+App.money(book)+'</b> · Statement: <b>'+App.money(num(sb&&sb.value))+'</b> · Difference: <b'+(Math.abs(diff)>0.005?' style="color:var(--danger,#b42318)"':'')+'>'+App.money(diff)+'</b> — '+(Math.abs(diff)<0.005?'Reconciled':'Not reconciled'); };
      [bs,dt,sb].forEach(function(el){ if(el){ el.addEventListener('change',upd); el.addEventListener('input',upd); } }); upd(); }
    /* #65 stock warnings: transfer / write-off quantity above what the location holds */
    if(key==='invTransfers'||key==='invWriteOffs'||key==='production'){ var box2=warnBox(host,'qtyWarn'); var tb2=host.querySelector('[data-line-items]');
      var chk=function(){ var loc=key==='invTransfers'&&fv(host,'fromLocation')?fv(host,'fromLocation').value:'Main location'; var msgs=[]; var need={};
        if(tb2&&tb2.tBodies[0]) [].forEach.call(tb2.tBodies[0].rows,function(tr){ var it=tr.querySelector('[data-var="items"]'), q=tr.querySelector('[data-var="qty"]'); if(it&&it.value&&q) need[it.value]=(need[it.value]||0)+num(q.value); });
        var self=App.editingId!=null?(R[key]||[]).find(function(x){ return x.id===App.editingId; }):null;
        Object.keys(need).forEach(function(nm){ var have=invQtyAtLocation(b,nm,loc); if(self) (self.lines||[]).forEach(function(l){ if((l.item||l.items)===nm) have+= (key==='invTransfers'? num(l.qty) : num(l.qty)); });
          if(need[nm]>have+1e-9) msgs.push(esc(nm)+': '+need[nm]+' requested, '+Math.round(have*1e6)/1e6+' at '+esc(loc||'Main location')); });
        box2.style.display=msgs.length?'':'none'; box2.innerHTML=msgs.length?'Not enough stock — '+msgs.join('; '):''; };
      host.addEventListener('change',chk); host.addEventListener('input',chk); chk(); }
  };
  App.bankBookBalance=function(b,bankName,to){ var n=GL.sysAcct(b,'cash & cash equivalents',false); if(!n) return 0; return GL.balance(b,n.id,{sub:bankName,to:to||null}); };
  var _mount=App._mountDesignedForm; App._mountDesignedForm=function(key){ var r=_mount.apply(this,arguments); try{ App._enhanceDesigned(document.getElementById('deHost'),key); }catch(e){} return r; };

  /* reset the guard whenever a form is drawn */
  var _render=App.renderMain; App.renderMain=function(){ App._saveBlocked=null; return _render.apply(this,arguments); };

  /* ---------------- Match payers (#48): preview, then confirm ---------------- */
  function normName(s){ return String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim(); }
  /** Receipts with no customer whose description names one. Nothing is changed. */
  App.payerMatches=function(b){ var R=(b&&b.records)||{}; var custs=(R.customers||[]).filter(function(c){ return c&&c.name; }); var out=[];
    (R.receipts||[]).forEach(function(r){ if(!r) return; var type=String(r.paidByType||'').toLowerCase(); if(!blank(r.paidBy)&&type==='customer') return;
      var lines=(r.lines||[]).filter(function(l){ return l; }); var onAR=lines.some(function(l){ var n=GL.lineAcct(b,l); return n&&GL.subKind(b,n)==='customers'&&!blank(l.sub); }); if(onAR) return;
      var d=normName(r.description); if(!d) return; var hit=null;
      custs.forEach(function(c){ var n=normName(c.name); if(!n) return; if(d===n || (n.length>=4 && (d.indexOf(n)>=0))) { if(!hit||n.length>normName(hit.name).length) hit=c; } });
      if(!hit && !blank(r.paidBy)) custs.forEach(function(c){ if(normName(c.name)===normName(r.paidBy)) hit=c; });
      if(hit) out.push({ id:r.id, reference:r.reference||'', date:r.date||'', description:r.description||'', customer:hit.name, amount:headerTotal('receipts',r), lines:lines.length }); });
    return out; };
  /** Apply the matches the user confirmed: Paid by = customer, line account = Accounts receivable. */
  App.applyPayerMatches=function(b,ids){ var R=(b&&b.records)||{}; var want={}; (ids||[]).forEach(function(i){ want[String(i)]=1; });
    var ar=GL.sysAcct(b,'accounts receivable',true); var done=0;
    App.payerMatches(b).forEach(function(m){ if(!want[String(m.id)]) return; var r=(R.receipts||[]).filter(function(x){ return x&&x.id===m.id; })[0]; if(!r) return;
      var amt=headerTotal('receipts',r); var lines=(r.lines||[]).filter(function(l){ return l; });
      if(lines.length>1) return;                          // several lines: leave it to the user
      r.paidBy=m.customer; r.paidByType='customer';
      var base=lines[0]||{ item:'', desc:'', description:'', qty:'', discount:'' };
      r.lines=[Object.assign({},base,{ account:ar.id, accountName:ar.name, sub:m.customer, price:amt, net:amt, amount:amt, taxAmt:0, tax:'', taxCode:'', taxRate:'' })];
      if(r.subtotal==null||r.subtotal==='') r.subtotal=amt; if(r.total==null||r.total==='') r.total=amt; if(r.tax==null||r.tax==='') r.tax=0;
      done++; });
    return done; };
  App.matchPayersHtml=function(b){ var M=App.payerMatches(b); var self=App;
    var rows=M.map(function(m){ return '<tr><td><input type="checkbox" class="pm-chk" value="'+esc(m.id)+'" checked'+(m.lines>1?' disabled title="Several lines — edit this receipt by hand"':'')+'></td><td>'+esc(m.reference)+'</td><td>'+esc(self.fmtDate?self.fmtDate(m.date):m.date)+'</td><td>'+esc(m.description)+'</td><td><b>'+esc(m.customer)+'</b></td><td class="r m">'+self.money(m.amount)+'</td></tr>'; }).join('');
    return App.crumb('Receipts','Match payers')+App._toolBack()+
      '<div class="card"><div class="card-head"><h2 style="margin:0">Match receipts to customers</h2></div>'+
      '<p class="sub" style="margin:8px 2px">These receipts have no customer, but their Description names one. Nothing has been changed yet. Tick the receipts to update and click <b>Confirm</b>: each one gets <b>Paid by = customer</b> and its line goes to <b>Accounts receivable</b> for that customer.</p>'+
      (M.length?('<div class="li-scroll"><table class="reg-tbl"><thead><tr><th style="width:1%"><input type="checkbox" checked onclick="document.querySelectorAll(\'.pm-chk:not(:disabled)\').forEach(function(c){c.checked=event.target.checked;})"></th><th>Receipt #</th><th>Date</th><th>Description</th><th>Matched customer</th><th class="r">Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
        '<div class="form-actions"><button class="btn btn-primary" onclick="App.confirmPayerMatches()">Confirm</button><button class="btn" onclick="App.backToSummary()">Cancel</button></div>')
       :'<div class="info-bar">No receipts to match: every receipt either has a customer or its description does not name one.</div>')+'</div>'; };
  App.confirmPayerMatches=function(){ var b=App.curBiz(); if(!b) return; if(App.guardWrite && !App.guardWrite(b)) return;
    var ids=[]; document.querySelectorAll('.pm-chk').forEach(function(c){ if(c.checked&&!c.disabled) ids.push(isNaN(+c.value)?c.value:+c.value); });
    if(!ids.length) return; var n=App.applyPayerMatches(b,ids); try{ refreshSummary(b); }catch(e){} App.saveBiz(b);
    try{ App._logActivity&&App._logActivity(b,'update','receipts',{reference:n+' receipts matched to customers'},null); }catch(e){}
    App.toolView='matchPayers'; App.renderMain(App.curBiz()); };

  /* ---------------- Data check (#49) ---------------- */
  var CHECK_KEYS=['receipts','payments','salesInv','creditNotes','purchInv','debitNotes','salesQuotes','salesOrders','purchQuotes','purchOrders','expenseClaims','journal','depreciation','amortization','payslips'];
  /** Records whose header total differs from the sum of their lines, plus ledger postings that went to Suspense. */
  App.dataCheck=function(b){ var R=(b&&b.records)||{}; var mism=[];
    CHECK_KEYS.forEach(function(k){ (R[k]||[]).forEach(function(r){ if(!r) return; var h=headerTotal(k,r), l=linesTotal(k,r);
      if(k==='payslips') return;
      if(Math.abs(r2(h)-r2(l))>0.005) mism.push({ key:k, label:(REG[k]&&REG[k].singular)||k, id:r.id, reference:r.reference||'', date:r.issueDate||r.date||'', header:r2(h), lines:r2(l), noLines:!((r.lines||[]).filter(function(x){ return x; }).length) }); }); });
    var gl=GL.issues(b).map(function(x){ return Object.assign({},x,{ label:(REG[x.src]&&REG[x.src].singular)||x.src }); });
    var tb=GL.trial(b); return { mismatches:mism, ledger:gl, trial:{debit:tb.debit,credit:tb.credit} }; };
  App.dataCheckHtml=function(b){ var d=App.dataCheck(b), self=App;
    var m=d.mismatches.map(function(x){ return '<tr><td>'+esc(x.label)+'</td><td><a class="led-link" onclick="App.ledgerOpen(\''+x.key+'\','+JSON.stringify(x.id)+',\'view\')">'+esc(x.reference||'(no reference)')+'</a></td><td>'+esc(self.fmtDate(x.date))+'</td><td class="r m">'+self.money(x.header)+'</td><td class="r m">'+self.money(x.lines)+'</td><td>'+(x.noLines?'No line items stored':'Lines differ')+'</td></tr>'; }).join('');
    var g=d.ledger.map(function(x){ return '<tr><td>'+esc(x.label)+'</td><td>'+(x.id!=null&&REG[x.src]?'<a class="led-link" onclick="App.ledgerOpen(\''+x.src+'\','+JSON.stringify(x.id)+',\'view\')">'+esc(x.ref||'(no reference)')+'</a>':esc(x.ref||''))+'</td><td>'+esc(self.fmtDate(x.date))+'</td><td>'+esc(x.problems.join('; '))+'</td><td class="r m">'+self.money(x.suspense)+'</td></tr>'; }).join('');
    var ok=Math.abs(d.trial.debit-d.trial.credit)<0.005;
    return App.crumb('Data check')+App._toolBack()+
      '<div class="card"><div class="card-head"><h2 style="margin:0">Data check</h2></div>'+
      '<div class="info-bar"'+(ok?'':' style="color:var(--danger,#b42318)"')+'>Trial balance: debits '+self.money(d.trial.debit)+', credits '+self.money(d.trial.credit)+(ok?' — in balance.':' — OUT OF BALANCE.')+'</div>'+
      '<h3 style="margin:14px 2px 6px">Header total differs from the line items ('+d.mismatches.length+')</h3>'+
      (m?'<div class="li-scroll"><table class="reg-tbl"><thead><tr><th>Type</th><th>Reference</th><th>Date</th><th class="r">Header total</th><th class="r">Sum of lines</th><th>Problem</th></tr></thead><tbody>'+m+'</tbody></table></div>':'<div class="info-bar">None.</div>')+
      '<h3 style="margin:14px 2px 6px">Postings sent to Suspense ('+d.ledger.length+')</h3>'+
      (g?'<div class="li-scroll"><table class="reg-tbl"><thead><tr><th>Type</th><th>Reference</th><th>Date</th><th>Problem</th><th class="r">To Suspense (Dr − Cr)</th></tr></thead><tbody>'+g+'</tbody></table></div>':'<div class="info-bar">None.</div>')+
      (App.payerMatches(b).length?'<div class="form-actions"><button class="btn" onclick="App.openTool(\'matchPayers\')">Match receipts to customers…</button></div>':'')+
      '</div>'; };

  /* customer / supplier view: what is outstanding or overpaid, from the same ledger as the list */
  var _led=App.ledgerHtml; App.ledgerHtml=function(b){ var h=_led.apply(this,arguments); try{ var key=LABEL2KEY[this.wsSection]; if(key!=='customers'&&key!=='suppliers') return h;
      var rec=(this.records(b)||[]).find(function(r){ return r.id===App.ledgerId; }); if(!rec) return h;
      var bal=key==='customers'?customerBalance(b,rec.name):supplierBalance(b,rec.name); var st=partyStatus(bal);
      var lbl=st==='Overpaid'?'Overpaid':(st==='Unpaid'?'Outstanding':'Paid'); var cls=st==='Overpaid'?'st-overpaid':(st==='Unpaid'?'st-unpaid':'st-paid');
      var c=partyDocCounts(b,key==='customers'?'cust':'sup',rec.name);
      var strip='<div class="party-bal" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line)">'+
        '<span><span style="color:var(--muted)">'+(key==='customers'?'Accounts receivable':'Accounts payable')+'</span> <b class="num">'+App.money(bal)+'</b></span>'+
        '<span class="st-badge '+cls+'">'+lbl+(st==='Paid'?'':' '+App.money(Math.abs(bal)))+'</span>'+
        '<span style="color:var(--muted)">'+(key==='customers'?'Sales invoices':'Purchase invoices')+': '+c.inv+' · '+(key==='customers'?'Receipts':'Payments')+': '+c.cash+'</span></div>';
      var at=h.indexOf('<div id="ledgerBody">'); if(at>=0) h=h.slice(0,at)+strip+h.slice(at); }catch(e){} return h; };
  var _tools=App.toolsHtml; App.toolsHtml=function(b){ if(this.toolView==='dataCheck') return this.dataCheckHtml(b); if(this.toolView==='matchPayers') return this.matchPayersHtml(b); return _tools.apply(this,arguments); };

  /* entry points: a notice on Summary when the ledger needed Suspense, and on Receipts when payers can be matched */
  var _sum=App.summaryHtml; App.summaryHtml=function(b){ var h=_sum.apply(this,arguments); try{ var n=GL.issues(b).length+App.dataCheck(b).mismatches.length;
      if(n) h+='<div class="info-bar" style="margin-top:12px">'+n+' record'+(n===1?' needs':'s need')+' attention (unbalanced, missing accounts or totals that differ from their lines). <a class="led-link" onclick="App.openTool(\'dataCheck\')">Open data check</a></div>'; }catch(e){} return h; };
  var _list=App.listHtml; App.listHtml=function(b){ var h=_list.apply(this,arguments); try{ if(LABEL2KEY[this.wsSection]==='receipts'){ var n=App.payerMatches(b).length;
      if(n) h='<div class="info-bar">'+n+' receipt'+(n===1?' has':'s have')+' a customer named only in the Description. <a class="led-link" onclick="App.openTool(\'matchPayers\')">Review and match</a></div>'+h; } }catch(e){} return h; };
})();
