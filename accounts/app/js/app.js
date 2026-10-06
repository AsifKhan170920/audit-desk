const App = {
  authMode:'signin', current:null, view:'businesses',
  openBiz:null, wsSection:'Summary', wsMode:'summary', editingId:null, listQuery:'', setView:null, coaCtx:null, ledgerId:null, ledgerQuery:'', ledgerReturn:null, recReturn:null, glAcctId:null, glTab:'tx', ledgerFrom:'', ledgerTo:'', pageSize:50, pageNum:1, lPageSize:50, lPageNum:1, batchMode:false, batchSel:null, advFilters:null, advMatch:'all', histReturn:false, histEntry:null, repView:null, repMode:'list', repInst:null, fmtCat:null, fmtForm:null, fmtDraft:null, fmtSel:null, fmtColMenu:false, _drag:null,

  /* ---------- bootstrap ---------- */
  init(){
    try{ if(localStorage.getItem('mgr_theme')==='dark') document.body.classList.add('theme-dark'); }catch(e){}
    /* the nav re-fits itself when the window height changes */
    try{ let t=0; window.addEventListener('resize',()=>{ clearTimeout(t); t=setTimeout(()=>App._fitSidebar(),120); }); }catch(e){}
    /* users, sessions and login live in js/users.js (authBoot below) */
    let biz=DB.get(DB.k.biz,null);
    if(!biz){ biz=[demoBusiness()]; }
    else{
      if(!biz.some(b=>b.id===1001)) biz.unshift(demoBusiness());
      biz.forEach(b=>{
        if(!b.period) b.period=defaultPeriod();
        if(!b.balanceSheet||!b.profitLoss){ const es=emptySummary(); b.balanceSheet=b.balanceSheet||es.balanceSheet; b.profitLoss=b.profitLoss||es.profitLoss; }
        if(!b.records) b.records={};
        if(b.id===1001 && (!b.records.bankCash)) b.records=seedDemoRecords();
      });
    }
    biz.forEach(b=>{ ensureSettings(b); if(b.id===1001 && !b.coa){ const fresh=demoBusiness(); b.balanceSheet=fresh.balanceSheet; b.profitLoss=fresh.profitLoss; } ensureCoa(b);
      if(b.id===1001 && b.coaSeedV!==3){ const rm=new Set(); const collect=p=>{ b.coa.filter(n=>n.parent===p).forEach(n=>{ rm.add(n.id); collect(n.id); }); }; collect('pl');
        b.coa=b.coa.filter(n=>!rm.has(n.id)); if(b.coaTop&&b.coaTop.pl) b.coaTop.pl=b.coaTop.pl.filter(id=>b.coa.some(n=>n.id===id)); b.coaSeedV=3; }
      if(b.records&&b.records.bankCash&&b.records.bankCash.length) ensureCashControl(b);
      flagControls(b); ensureSubledgerControls(b); ensureInventoryAccounts(b); ensureFixedAssetAccounts(b); ensureCapitalControl(b); ensureSuspense(b);
      if(b.id===1001 && !b.bankReconciled && b.records&&b.records.bankCash){ // keep demo's shown bank balances stable now that receipts post
        b.records.bankCash.forEach(rec=>{ const seeded=Number(rec.balance)||0; rec.balance=0; const move=bankActual(b,rec); rec.balance=seeded-move; }); b.bankReconciled=true; }
      try{ this.coaFixSaleIncome(b); }catch(e){}   /* one-time: "Sale" under Expenses -> Income (FIX_SPEC_4 #1.6) */
      refreshSummary(b); });
    DB.set(DB.k.biz,biz);
    try{ this.paintStaticIcons(); }catch(e){}
    /* migrates old accounts, then restores the session or shows login / first-run setup */
    if(this.authBoot) this.authBoot();
  },

  /* ---------- auth ----------
     Login, first-run setup, MFA, logout: js/users.js. */
  toggleTheme(){ var on=document.body.classList.toggle('theme-dark'); try{ localStorage.setItem('mgr_theme', on?'dark':'light'); }catch(e){} },
  enterApp(){
    document.getElementById('auth').classList.add('hide'); document.getElementById('app').classList.remove('hide');
    const s=this.current||DB.get(DB.k.session,{name:'User'});
    { const el=document.getElementById('userName'); if(el) el.textContent=s.name; }
    this.go('businesses');
  },

  /* ---------- top-level nav ---------- */
  go(view){
    this.view=view;
    ['Businesses','Create','Users','NewUser','Support','Workspace'].forEach(p=>document.getElementById('page'+p).classList.add('hide'));
    document.getElementById('tabBiz').classList.toggle('active', view==='businesses'||view==='create'||view==='workspace');
    document.getElementById('tabUsers').classList.toggle('active', view==='users'||view==='newUser');
    document.getElementById('tabSupport').classList.toggle('active', view==='support');
    document.getElementById('appFoot').classList.toggle('hide', view==='workspace');
    if(view==='businesses'){ document.getElementById('pageBusinesses').classList.remove('hide'); this.renderBusinesses(); }
    else if(view==='create'){ document.getElementById('pageCreate').classList.remove('hide'); document.getElementById('newBizName').value=''; document.getElementById('newBizName').focus(); }
    else if(view==='users'){ document.getElementById('pageUsers').classList.remove('hide'); this.renderUsers(); }
    else if(view==='newUser'){ document.getElementById('pageNewUser').classList.remove('hide'); }
    else if(view==='support'){ document.getElementById('pageSupport').classList.remove('hide'); this.renderSupport(); }
    else if(view==='workspace'){ document.getElementById('pageWorkspace').classList.remove('hide'); this.renderWorkspace(); }
    document.getElementById('addMenu').classList.add('hide');
    /* the workspace half of the single toolbar only applies inside a business */
    document.querySelectorAll('.tb-ws').forEach(el=>el.classList.toggle('hide', view!=='workspace'));
    this._paintChrome(view==='workspace'?this.curBiz():null);
  },

  /* ---------- support ---------- */
  _kb(n){ if(!isFinite(n)) return '—'; if(n<1024) return n+' B';
    if(n<1024*1024) return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(2)+' MB'; },
  /* Bytes localStorage is holding. Strings are UTF-16 in the browser's quota
     accounting, hence the ×2 — an estimate, not an exact figure.
     `mine` counts only this app's keys; other apps can share the same origin. */
  APP_KEY_RE:/^mgr_/,
  storageBytes(){ let total=0, mine=0; const per={};
    try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
      const v=localStorage.getItem(k)||''; const n=(k.length+v.length)*2;
      per[k]=n; total+=n; if(this.APP_KEY_RE.test(k)) mine+=n; } }catch(e){}
    return {total,mine,per}; },
  supportDiag(){
    const biz=DB.get(DB.k.biz,[])||[]; const users=DB.get(DB.k.users,[])||[];
    const st=this.storageBytes();
    const recCount=biz.reduce((a,b)=>a+Object.keys(b.records||{}).reduce((x,k)=>x+((b.records[k]||[]).length),0),0);
    let designs=0; try{ const d=JSON.parse(localStorage.getItem('mgr_invoice_designs')||'{}');
      Object.keys(d).forEach(bid=>{ designs+=Object.keys(d[bid]||{}).length; }); }catch(e){}
    const M=window.InvoiceDesignerModule;
    return {
      businesses:biz.length, users:users.length, records:recCount, designs:designs,
      storage:st.mine, storageOrigin:st.total, storagePer:st.per,
      designerLoaded:!!(M&&(M.mountInvoiceDesigner||(M.InvoiceDesignerAPI&&M.InvoiceDesignerAPI.mount))),
      protocol:location.protocol, origin:location.origin||'—',
      ua:navigator.userAgent,
      localStorageOk:(function(){ try{ localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }catch(e){ return false; } })(),
    }; },
  renderSupport(){ const el=document.getElementById('supportBody'); if(el) el.innerHTML=this.supportHtml(); },
  supportHtml(){
    const d=this.supportDiag(); const self=this;
    const ok=v=>v?'<span class="sup-ok">✓ yes</span>':'<span class="sup-bad">✗ no</span>';
    /* labels here are author-controlled markup, values are pre-escaped by callers */
    const row=(k,v)=>'<tr><th>'+k+'</th><td>'+v+'</td></tr>';
    const faq=(q,a)=>'<details class="sup-faq"><summary>'+self.esc(q)+'</summary><div>'+a+'</div></details>';
    const h3=(ico,txt)=>'<h3><span class="sup-ico">'+ico+'</span>'+txt+'</h3>';

    const top=this.storageBytes();
    const perRows=Object.keys(top.per).filter(k=>self.APP_KEY_RE.test(k))
      .sort((a,b)=>top.per[b]-top.per[a]).slice(0,6)
      .map(k=>'<tr><th><code>'+self.esc(k)+'</code></th><td>'+self._kb(top.per[k])+'</td></tr>').join('');
    const otherBytes=top.total-top.mine;

    return ''+
    '<div class="sup-grid">'+

      '<div class="sup-card">'+
        h3('🚀','Getting started')+
        '<ol class="sup-steps">'+
          '<li><b>Create a business</b> — Businesses tab → <i>Add Business</i> → Create New Business.</li>'+
          '<li><b>Set it up</b> — open the business, then Settings → Business Details, Chart of Accounts, Tax Codes and Currencies.</li>'+
          '<li><b>Enter transactions</b> — pick a section in the sidebar (Receipts, Sales Invoices, …) and click the blue <i>New …</i> button.</li>'+
          '<li><b>Design your documents</b> — Settings → Custom Themes → Themes → create an HTML theme and choose it on the document View.</li>'+
          '<li><b>Report &amp; print</b> — Reports in the sidebar, or the Print / Save as PDF buttons on any document.</li>'+
        '</ol>'+
        '<p class="sub">Only the sections you use need to stay visible — hide the rest with <b>Customize</b> at the bottom of the sidebar.</p>'+
      '</div>'+

      '<div class="sup-card">'+
        h3('💾','Where your data lives')+
        '<p class="sub">This app has no server. Everything is stored in this browser\'s <b>localStorage</b>, on this device, under this origin only.</p>'+
        '<table class="sup-tbl">'+
          row('Businesses &amp; records','<code>mgr_businesses</code>')+
          row('User accounts','<code>mgr_users</code>')+
          row('Signed-in session','<code>mgr_session</code>')+
          row('Invoice designs','<code>mgr_invoice_designs</code>')+
        '</table>'+
        '<div class="sup-warn">Clearing site data, using private / incognito mode, or switching browser or device will lose everything that has not been backed up. '+
        'Take a backup from the <b>Backup</b> button in the business header.</div>'+
      '</div>'+

      '<div class="sup-card">'+
        h3('🩺','Diagnostics')+
        '<table class="sup-tbl sup-diag">'+
          row('Businesses', d.businesses)+
          row('User accounts', d.users)+
          row('Records stored', d.records.toLocaleString('en-US'))+
          row('Saved invoice designs', d.designs)+
          row('Storage used by this app', this._kb(d.storage))+
          (otherBytes>0?row('Other apps on this origin', this._kb(otherBytes)):'')+
          row('localStorage writable', ok(d.localStorageOk))+
          row('Invoice Designer module', ok(d.designerLoaded))+
          row('Served over', '<code>'+self.esc(d.protocol)+'</code> '+(d.protocol==='file:'?'<span class="sup-bad">— serve over http instead</span>':'<span class="sup-ok">✓</span>'))+
          row('Origin', '<code>'+self.esc(d.origin)+'</code>')+
        '</table>'+
        (perRows?'<h4 class="sup-h4">This app\'s largest keys</h4><table class="sup-tbl">'+perRows+'</table>':'')+
        '<div class="form-actions">'+
          '<button class="btn btn-xs" onclick="App.renderSupport()">Refresh</button> '+
          '<button class="btn btn-xs" onclick="App.copyDiagnostics()">Copy diagnostics</button>'+
        '</div>'+
      '</div>'+

      '<div class="sup-card">'+
        h3('❓','Troubleshooting')+
        faq('The page is blank or the styling is missing',
          'The app loads <code>css/</code> and <code>js/</code> as separate files, so it must be served over HTTP — opening <code>index.html</code> directly via <code>file://</code> is blocked by most browsers. Run <code>python3 -m http.server 8080</code> in the project folder and open <code>http://localhost:8080/</code>.')+
        faq('"Invoice Designer module not loaded"',
          'The React / Fabric.js bundle in <code>dist/invoice-designer/</code> is missing or stale. Rebuild it with <code>cd invoice-designer &amp;&amp; npm install &amp;&amp; npm run build</code>, then hard-refresh the page.')+
        faq('My design changes do not show on the printed document',
          'Click <b>Save design</b> in the designer before closing it. Designs are stored per business and per document type, so a design saved for Sales Invoice does not apply to Purchase Invoice.')+
        faq('I cannot edit or delete a transaction',
          'Check Settings → <b>Lock Date</b>. Entries dated on or before the lock date are read-only. Clear or move the lock date to edit them.')+
        faq('My numbers look wrong on the Summary',
          'The Summary covers a fixed period. Click <b>Edit</b> above the balance sheet to change the date range. Balances are computed from the transactions themselves, not stored, so they always reflect current data.')+
        faq('How do I move my data to another computer?',
          'Open the business, click <b>Backup</b> in the header to download a JSON file, then on the other machine use Businesses → <i>Add Business</i> → <b>Import Business</b> and select that file.')+
        faq('How do I email an invoice or report?',
          'Open the document and click <b>Email</b> (reports have the same button). Pick a delivery method first in Settings → Email Settings: '+
          '<b>Mail client</b> opens your own mail app with the message filled in — save the PDF and attach it yourself, because a web page cannot attach files to a <code>mailto:</code> link. '+
          '<b>HTTP relay</b> POSTs the message to an endpoint you run, which does the SMTP delivery. Every send is recorded under <b>Emails</b>.')+
      '</div>'+

    '</div>'; },
  copyDiagnostics(){ const d=this.supportDiag();
    const txt=['Accounting Client — diagnostics',
      'businesses: '+d.businesses, 'users: '+d.users, 'records: '+d.records,
      'invoice designs: '+d.designs, 'storage: '+this._kb(d.storage),
      'localStorage writable: '+d.localStorageOk, 'designer module loaded: '+d.designerLoaded,
      'protocol: '+d.protocol, 'origin: '+d.origin, 'userAgent: '+d.ua].join('\n');
    const done=()=>{ try{ this.toast?this.toast('Diagnostics copied'):alert('Diagnostics copied to clipboard.'); }catch(e){ alert('Diagnostics copied to clipboard.'); } };
    try{ navigator.clipboard.writeText(txt).then(done,()=>this._copyFallback(txt,done)); }
    catch(e){ this._copyFallback(txt,done); } },
  _copyFallback(txt,done){ try{ const ta=document.createElement('textarea'); ta.value=txt;
    ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); done(); }catch(e){ alert(txt); } },

  /* ---------- businesses ---------- */
  toggleAdd(e){ e.stopPropagation(); document.getElementById('addMenu').classList.toggle('hide'); },
  showCreate(){ this.go('create'); },
  /* Same JSON format the Backup button writes, so a backup round-trips. */
  importBusiness(){ document.getElementById('addMenu').classList.add('hide'); this.backupImport(); },
  createBusiness(){
    this.addBusiness(document.getElementById('newBizName').value, document.getElementById('newBizCountry').value);
    this.go('businesses');
  },
  /* Builds, seeds (settings, chart of accounts, summary) and saves a new business; returns it.
     Used by Create New Business and by Sign up (js/users.js). */
  addBusiness(name,country){
    name=String(name==null?'':name).trim()||'Unnamed'; country=country||'Automatic';
    const biz=DB.get(DB.k.biz,[]); const es=emptySummary();
    let id=Date.now(); while(biz.some(b=>b.id===id)) id++;
    const nb={id,name,country,created:new Date().toISOString(),
      period:defaultPeriod(),
      records:{}, balanceSheet:es.balanceSheet, profitLoss:es.profitLoss};
    ensureSettings(nb); ensureCoa(nb); refreshSummary(nb); biz.push(nb);
    DB.set(DB.k.biz,biz); return nb;
  },
  removeSelected(){
    const ids=[...document.querySelectorAll('.biz-chk:checked')].map(c=>+c.value);
    if(!ids.length) return;
    if(!this._ask('Remove '+ids.length+' business'+(ids.length>1?'es':'')+'? This cannot be undone.',()=>this.removeSelected())) return;
    DB.set(DB.k.biz, DB.get(DB.k.biz,[]).filter(b=>!ids.includes(b.id))); this.renderBusinesses();
  },
  onChkChange(){ document.getElementById('removeBtn').disabled=document.querySelectorAll('.biz-chk:checked').length===0; },
  renderBusinesses(){
    const q=(document.getElementById('bizSearch').value||'').toLowerCase();
    let list=this.visibleBusinesses?this.visibleBusinesses():DB.get(DB.k.biz,[]); const total=list.length;
    if(q) list=list.filter(b=>b.name.toLowerCase().includes(q)||(b.country||'').toLowerCase().includes(q));
    const wrap=document.getElementById('bizListWrap'); document.getElementById('removeBtn').disabled=true;
    if(!total){ wrap.innerHTML='<div class="empty"><div class="big">No businesses yet</div>Click <b>Add Business → Create New Business</b> to get started.</div>'; document.getElementById('bizCount').textContent=''; return; }
    if(!list.length){ wrap.innerHTML='<div class="empty"><div class="big">No matches</div>No businesses match “'+this.esc(q)+'”.</div>'; document.getElementById('bizCount').textContent=''; return; }
    const rows=list.map(b=>'<tr><td class="col-chk"><input type="checkbox" class="biz-chk" value="'+b.id+'" onchange="App.onChkChange()"></td>'+
      '<td><a class="biz-link" onclick="App.openBusiness('+b.id+')">'+this.esc(b.name)+'</a></td>'+
      '<td>'+this.esc(b.country||'Automatic')+'</td><td>'+this.fmtDateUS(new Date(b.created||0).toISOString().slice(0,10))+'</td></tr>').join('');
    wrap.innerHTML='<table class="tbl"><thead><tr><th class="col-chk"></th><th>Business Name</th><th>Country</th><th>Created</th></tr></thead><tbody>'+rows+'</tbody></table>';
    document.getElementById('bizCount').textContent=list.length+' of '+total+' business'+(total>1?'es':'');
  },

  /* ---------- workspace ---------- */
  openBusiness(id){ this.navTrail=[]; this.recReturn=null; this.openBiz=id;
    /* a business that arrived after start-up (cloud sync, restore, import) still gets its one-time chart fix */
    try{ const ob=this.curBiz(); if(ob && this.coaFixSaleIncome(ob)) this.saveBiz(ob); }catch(e){}
    this.wsSection='Summary'; this.wsMode='summary'; this.listQuery=''; this.go('workspace'); },
  closeBusiness(){ this.openBiz=null; this.go('businesses'); },
  curBiz(){ return DB.get(DB.k.biz,[]).find(b=>b.id===this.openBiz); },
  saveBiz(b){ const all=DB.get(DB.k.biz,[]); const i=all.findIndex(x=>x.id===b.id); if(i>=0){ all[i]=b; DB.set(DB.k.biz,all); } },
  renameBusiness(){ const b=this.curBiz(); if(!b) return; const n=this._askText('Rename business',b.name,()=>this.renameBusiness()); if(n===null) return; b.name=n.trim()||b.name; this.saveBiz(b); this.renderWorkspace(); },

  selectSection(label){ this.closeNav(); this.navTrail=[]; this.pageNum=1; this.batchMode=false; this.batchSel=null; this.advFilters=null; this.histReturn=false; this.wsSection=label; this.listQuery=''; this.editingId=null; this.setView=null; this.repView=null; this.ledgerId=null;
    this.wsMode = label==='Summary' ? 'summary' : (label==='Dashboard' ? 'dashboard' :
      (LABEL2KEY[label] ? 'list' : (label==='Settings' ? 'settings' : (label==='Reports' ? 'reports' : 'section')))); this.renderWorkspace(); },

  renderWorkspace(){
    const b=this.curBiz(); if(!b){ this.go('businesses'); return; }
    document.getElementById('wsBizName').textContent=b.name;
    this.renderSidebar(b); this.renderMain(b);
  },
  /* ---------- sidebar + Customize ---------- */
  /* Hidden sections are stored per business as an array of SIDEBAR labels.
     'Summary' is never hideable — it is the workspace home. */
  hiddenSections(b){ return (b&&b.sidebarHidden)||[]; },
  /* isHidden / myPermissions / isReadOnly / guardWrite: js/users.js (per-tab View/Create/Update/Delete levels) */
  renderSidebar(b){
    const rec=b.records||{};
    const I=(n,sz)=>(window.ICO?ICO.get(n,sz||18):'');
    const SI=(l)=>(window.ICO?ICO.forSection(l,18):'');
    const esc=s=>this.esc(s);

    /* one nav row — same click target and badge as before, new chrome */
    const item=(label,icoHtml,active,extra)=>{
      const n=extra&&extra.key ? (rec[extra.key]||[]).length : null;
      const badge = n===null ? '' : '<span class="side-badge'+(n===0?' zero':'')+'" data-side-count="'+esc(extra.key)+'">'+n.toLocaleString('en-US')+'</span>';
      return '<div class="side-item'+(active?' active':'')+'" role="button" tabindex="0" title="'+esc(label)+'" data-side="'+esc(label)+'"'+
        ' onclick="App.selectSection(\''+label.replace(/'/g,"\\'")+'\')"'+
        ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click()}">'+
        icoHtml+'<span class="side-label">'+esc(label)+'</span>'+badge+'</div>';
    };

    /* The rail is nav only: the business name moved to the toolbar and Create New
       is gone, so the list starts at the very top of the sidebar. */
    /* the highlighted tab follows the page's origin (js/ledger-nav.js), not just wsSection */
    const act=(typeof this.sideActive==='function')?this.sideActive():this.wsSection;
    let html='<div class="side-scroll">';

    /* grouped sections; anything a group forgot still shows, under "More" */
    const groups=(typeof SIDEBAR_GROUPS!=='undefined')?SIDEBAR_GROUPS:[['',SIDEBAR.map(x=>x[1])]];
    const byLabel={}; SIDEBAR.forEach(r=>{ byLabel[r[1]]=r; });
    const placed={};
    groups.forEach(g=>{
      const rows=g[1].filter(l=>byLabel[l] && !this.isHidden(b,l));
      g[1].forEach(l=>{ placed[l]=1; });
      if(!rows.length) return;
      html+='<div class="side-group">'+esc(g[0])+'</div>';
      rows.forEach(l=>{ const r=byLabel[l];
        html+=item(l,SI(l),act===l,{key:r[2]}); });
    });
    const leftovers=SIDEBAR.filter(r=>!placed[r[1]] && !this.isHidden(b,r[1]));
    if(leftovers.length){ html+='<div class="side-group">More</div>';
      leftovers.forEach(r=>{ html+=item(r[1],SI(r[1]),act===r[1],{key:r[2]}); }); }

    /* reports + settings */
    html+='<div class="side-sep"></div>';
    SIDEBAR_FOOT.forEach(([ico,label])=>{ if(this.isHidden(b,label)) return; html+=item(label,SI(label),act===label,null); });

    const nHid=this.hiddenSections(b).length;
    html+='<div class="side-customize'+(this.wsMode==='customize'?' on':'')+'" role="button" tabindex="0"'+
      ' onclick="App.openCustomize()" onkeydown="if(event.key===\'Enter\'){this.click()}">Customize'+
      (nHid?'<span class="side-cust-n">'+nHid+' hidden</span>':'')+'</div>';
    html+='</div>';

    /* Pinned footer. Neither Settings nor the profile card is repeated here:
       SIDEBAR_FOOT renders Settings just above, and the toolbar already carries
       the signed-in user and Logout. */
    html+='<div class="side-foot">'+
      '<div class="side-item" role="button" tabindex="0" onclick="App.go(\'support\')"'+
        ' onkeydown="if(event.key===\'Enter\'){this.click()}">'+I('lifebuoy',18)+'<span class="side-label">Help &amp; Support</span></div>'+
      '</div>';

    document.getElementById('sidebar').innerHTML=html;
    this._paintChrome(b);
    this._fitSidebar();
  },
  /* Size the nav to the space it has instead of scrolling it. --sf runs from 1
     (roomy) down to 0 (tightest readable); we binary-search the largest value
     whose content still fits, so a tall window stays airy and a short one closes
     up. Nothing is ever hidden: if even 0 overflows the rail scrolls again. */
  _fitSidebar(){
    const sb=document.getElementById('sidebar'); if(!sb) return;
    const box=sb.querySelector('.side-scroll'); if(!box) return;
    const fits=v=>{ sb.style.setProperty('--sf',v); return box.scrollHeight<=box.clientHeight+1; };
    sb.classList.remove('side-overflow');
    if(fits(1)) return;
    let lo=0, hi=1, best=null;
    for(let i=0;i<8;i++){ const mid=(lo+hi)/2; if(fits(mid)){ best=mid; lo=mid; } else hi=mid; }
    if(best!=null){ sb.style.setProperty('--sf',best); return; }
    sb.style.setProperty('--sf',0);
    sb.classList.add('side-overflow');           // shorter than the nav can go
  },
  /* Header chrome that lives outside #sidebar but changes with it. */
  _paintChrome(b){
    const I=(n,sz)=>((typeof window!=='undefined'&&window.ICO)?ICO.get(n,sz||18):'');
    /* Runs against the real DOM and against the test harness's stub nodes,
       which have no dataset — hence the guard rather than a bare read. */
    const once=(el,html)=>{ if(!el) return; const d=el.dataset; if(d&&d.painted) return;
      el.innerHTML=html; if(d) d.painted='1'; };
    once(document.getElementById('navToggle'),I('menu',19));
    once(document.getElementById('hdNotify'),I('bell',18)+'<span class="dot" id="hdDot" hidden></span>');
    once(document.getElementById('hdTheme'),I('moon',18));
    once(document.querySelector?document.querySelector('.ws-close'):null,I('close',18));
    const s=this.current||DB.get(DB.k.session,{name:'User'});
    const uname=(s&&(s.name||s.user))||'User';
    const av=document.getElementById('hdAvatar'); if(av) av.textContent=uname.trim().slice(0,1).toUpperCase();
    const un=document.getElementById('hdUserName'); if(un) un.textContent=uname;
    const ur=document.getElementById('hdUserRole'); if(ur) ur.textContent=(s&&s.role)||'Administrator';
    try{ const dot=document.getElementById('hdDot'); if(dot){ const n=this.notificationCount(b); dot.hidden=!n; } }catch(e){}
  },
  /* ---- create-new menu ---- */
  _createTargets(){ return [
    ['Sales Invoices','Create Invoice','invoice'],
    ['Customers','Add Customer','user'],
    ['Expense Claims','Add Expense','bag'],
    ['Purchase Invoices','Create Bill','receipt'],
    ['Receipts','Add Payment','coins'],
    ['Journal Entries','Create Journal Entry','book'],
  ]; },
  _createMenuHtml(b){ const I=(n)=>(window.ICO?ICO.get(n,16):'');
    const rows=this._createTargets().filter(t=>REG[LABEL2KEY[t[0]]]).map(t=>
      '<button onclick="App.createFrom(\''+t[0].replace(/'/g,"\\'")+'\')">'+I(t[2])+this.esc(t[1])+'</button>').join('');
    return '<div class="side-create-menu" role="menu">'+rows+'</div>'; },
  toggleCreateMenu(ev){ if(ev){ ev.stopPropagation(); } this._createOpen=!this._createOpen;
    this.renderSidebar(this.curBiz());
    if(this._createOpen){ const off=()=>{ this._createOpen=false; document.removeEventListener('click',off); try{ this.renderSidebar(this.curBiz()); }catch(e){} };
      setTimeout(()=>document.addEventListener('click',off),0); } },
  /* Routes to the section, then opens its New form — the same path the tab uses. */
  createFrom(label){ this._createOpen=false; this.closeNav(); this.selectSection(label);
    setTimeout(()=>{ try{ this.newRecord(); }catch(e){} },0); },

  /* ---- header search ----
     Filters the register you are looking at (the same listQuery the in-page
     search box drives). Outside a register it jumps to the first section whose
     name matches, so it doubles as a section finder. */
  globalSearch(q){
    q=String(q||'');
    if(this.wsMode==='list'){ this.filterList(q); return; }
    if(!q.trim()) return;
    const t=q.trim().toLowerCase();
    const hit=SIDEBAR.concat(SIDEBAR_FOOT.map(f=>[f[0],f[1],null]))
      .find(r=>String(r[1]).toLowerCase().indexOf(t)>=0);
    if(hit) this.selectSection(hit[1]);
  },

  /* ---- notifications ----
     Real figures only: overdue invoices and bills drawn from the same status
     helper the registers use, so the badge can never disagree with a list. */
  _overdue(b,key,partyKey){ const R=(b&&b.records)||{}; const self=this;
    return (R[key]||[]).filter(function(r){ return self.invStatus(r)==='Overdue'; })
      .map(function(r){ return {ref:r.reference||'', party:r[partyKey]||'', due:r.dueDate||'',
        amt:Number(r.balanceDue!=null?r.balanceDue:r.total)||0}; }); },
  notificationCount(b){ b=b||this.curBiz(); if(!b) return 0;
    return this._overdue(b,'salesInv','customer').length+this._overdue(b,'purchInv','supplier').length; },
  openNotifications(){ const b=this.curBiz(); if(!b) return;
    const ar=this._overdue(b,'salesInv','customer'), ap=this._overdue(b,'purchInv','supplier');
    const self=this;
    const rows=function(list,kind){ if(!list.length) return '';
      return '<div style="font-weight:700;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin:14px 0 6px">'+kind+'</div>'+
        list.slice(0,8).map(function(x){ return '<div class="dlist-row"><span class="dlist-txt">'+
          '<span class="dlist-t">'+self.esc(x.party||'(no name)')+'</span>'+
          '<span class="dlist-s">'+self.esc(x.ref)+(x.due?(' · due '+self.fmtDateUS(x.due)):'')+'</span></span>'+
          '<span class="dlist-amt">'+self.money(x.amt)+'</span></div>'; }).join(''); };
    const body=(ar.length||ap.length)
      ? rows(ar,'Overdue sales invoices')+rows(ap,'Overdue purchase invoices')
      : '<div class="dlist-empty">Nothing overdue. Everything is on schedule.</div>';
    this._openOverlay('<div class="app-modal-h">Notifications</div>'+
      '<div class="app-modal-b"><div class="dlist">'+body+'</div></div>'+
      '<div class="app-modal-f"><span style="flex:1"></span>'+
      '<button class="btn" onclick="App._closeOverlay()">Close</button></div>'); },

  /* ---- mobile drawer ---- */
  _body(){ return (typeof document!=='undefined'&&document.body&&document.body.classList)?document.body:null; },
  toggleNav(){ const b=this._body(); if(!b) return; b.classList.toggle('nav-open');
    const t=document.getElementById('navToggle'); if(t) t.setAttribute('aria-expanded',b.classList.contains('nav-open')?'true':'false'); },
  closeNav(){ const b=this._body(); if(b) b.classList.remove('nav-open');
    const t=document.getElementById('navToggle'); if(t) t.setAttribute('aria-expanded','false'); },

  openCustomize(){ this.wsMode='customize'; this.wsSection=null; this.navTrail=[]; this.editingId=null;
    this._custDraft=this.hiddenSections(this.curBiz()).slice(); this.renderWorkspace(); },
  customizeHtml(b){
    const rec=b.records||{}; const draft=this._custDraft||[];
    const rows=SIDEBAR.map(([ico,label,key])=>{
      const fixed=label==='Summary';
      const on=fixed||draft.indexOf(label)<0;
      const n=key?(rec[key]||[]).length:0;
      const cnt=key?('<span class="cust-count'+(n===0?' zero':'')+'">'+n.toLocaleString('en-US')+'</span>'):'<span class="cust-count zero">—</span>';
      return '<label class="cust-row'+(fixed?' fixed':'')+'">'+
        '<input type="checkbox" '+(on?'checked':'')+(fixed?' disabled':'')+
          ' onchange="App.custToggle(\''+label.replace(/'/g,"\\'")+'\',this.checked)">'+
        '<span class="cust-ico">'+ico+'</span>'+
        '<span class="cust-name">'+this.esc(label)+(fixed?' <span class="cust-fixed">always shown</span>':'')+'</span>'+
        cnt+'</label>';
    }).join('');
    const nHid=draft.filter(l=>l!=='Summary').length;
    return this.crumb('Customize')+
      '<div class="info-bar">Choose which sections appear in the sidebar for <b>'+this.esc(b.name||'this business')+'</b>. '+
        'Hiding a section only removes it from the sidebar — its records and totals are untouched, and it still appears in reports.</div>'+
      '<div class="card cust-card"><h2>Sidebar sections</h2>'+
      '<div class="cust-actions">'+
        '<button class="btn btn-xs" onclick="App.custAll(true)">Show all</button> '+
        '<button class="btn btn-xs" onclick="App.custAll(false)">Hide all</button> '+
        '<button class="btn btn-xs" onclick="App.custHideEmpty()">Hide empty sections</button>'+
        '<span class="cust-summary">'+(nHid?nHid+' hidden':'nothing hidden')+'</span>'+
      '</div>'+
      '<div class="cust-list">'+rows+'</div>'+
      '<div class="form-actions">'+
        '<button class="btn btn-primary" onclick="App.saveCustomize()">Update</button>'+
        '<button class="btn" onclick="App.customizeCancel()">Cancel</button>'+
      '</div></div>'; },
  custToggle(label,on){ var d=this._custDraft||[]; var i=d.indexOf(label);
    if(on){ if(i>=0) d.splice(i,1); } else if(i<0 && label!=='Summary'){ d.push(label); }
    this._custDraft=d; this.renderMain(this.curBiz()); },
  custAll(on){ this._custDraft = on ? [] : SIDEBAR.map(s=>s[1]).filter(l=>l!=='Summary');
    this.renderMain(this.curBiz()); },
  custHideEmpty(){ const b=this.curBiz(); const rec=b.records||{};
    this._custDraft=SIDEBAR.filter(([i,label,key])=>label!=='Summary'&&key&&(rec[key]||[]).length===0).map(s=>s[1]);
    this.renderMain(b); },
  saveCustomize(){ const b=this.curBiz(); b.sidebarHidden=(this._custDraft||[]).filter(l=>l!=='Summary');
    this.saveBiz(b); this._custDraft=null;
    try{ this.toast && this.toast('Sidebar updated'); }catch(e){}
    this.wsMode='summary'; this.wsSection='Summary'; this.renderWorkspace(); },
  customizeCancel(){ this._custDraft=null; this.wsMode='summary'; this.wsSection='Summary'; this.renderWorkspace(); },
  renderMain(b){
    const m=document.getElementById('wsMain');
    if(this.wsMode==='dashboard'){ m.innerHTML=this.dashboardPageHtml(b); return; }
    if(this.wsMode==='summary'){ m.innerHTML=this.summaryHtml(b); return; }
    if(this.wsMode==='summaryEdit'){ m.innerHTML=this.periodFormHtml(b); return; }
    /* Safety net: every SIDEBAR entry maps to a register, so this only renders
       if a section is added without one. */
    if(this.wsMode==='section'){ m.innerHTML=this.crumb(this.wsSection)+
      '<div class="empty" style="margin-top:30px"><div class="big">'+this.esc(this.wsSection)+'</div>'+
      'This section has no register configured. Add an entry for it to <code>REG</code> in <code>js/data.js</code>.</div>'; return; }
    if(this.wsMode==='list'){ m.innerHTML=this.listHtml(b); return; }
    if(this.wsMode==='form'){ const _k=LABEL2KEY[this.wsSection]; m.innerHTML=this.formHtml(b); var _self=this; setTimeout(function(){ if(_self._nativeTxnForm(_self.curBiz(),_k)) TxnForms.mount(_k); else _self._mountDesignedForm(_k); try{ QuickCreate.scan(m); }catch(e){} },0); return; }
    if(this.wsMode==='view'){ m.innerHTML=this.viewHtml(b); return; }
    if(this.wsMode==='ledger'){ m.innerHTML=this.ledgerHtml(b); return; }
    if(this.wsMode==='glledger'){ m.innerHTML=this.glLedgerHtml(b); return; }
    if(this.wsMode==='statement'){ m.innerHTML=this.statementHtml(b); return; }
    if(this.wsMode==='settings'){ m.innerHTML=this.settingsHtml(b); return; }
    if(this.wsMode==='reports'){ m.innerHTML=this.reportsHtml(b); return; }
    if(this.wsMode==='customize'){ m.innerHTML=this.customizeHtml(b); return; }
    if(this.wsMode==='tools'){ m.innerHTML=this.toolsHtml(b); return; }
  },
  /* Fills the [data-ico] placeholders in index.html's static markup. */
  paintStaticIcons(){ if(typeof document==='undefined'||!document.querySelectorAll) return;
    if(typeof window==='undefined'||!window.ICO) return;
    document.querySelectorAll('[data-ico]').forEach(function(el){
      if(el.dataset&&el.dataset.painted) return;
      el.innerHTML=ICO.get(el.getAttribute('data-ico'),15);
      if(el.dataset) el.dataset.painted='1'; }); },
  _crumbIco(n){ return (typeof window!=='undefined'&&window.ICO)?ICO.get(n||'dashboard',14,'crumb-ico'):''; },
  crumb(title,extra){ var t=this.esc(title); if(title==='Settings') t='<a class="led-link" onclick="App.settingsBack()">Settings</a>';
    var ex=''; if(extra){ var exTxt=this.esc(extra); if(title==='Settings'){ var hit=(this.setTiles()||[]).find(function(x){ return x[1]===extra; }); if(hit) exTxt='<a class="led-link" onclick="App.openSetting(\''+hit[2]+'\')">'+exTxt+'</a>'; } ex=' ▸ '+exTxt; }
    return '<div class="ws-crumb"><div class="left">'+App._crumbIco()+' ▸ '+t+ex+'</div></div>'; },
  recCrumb(sectionLabel, current){ return '<div class="ws-crumb"><div class="left">'+App._crumbIco()+' ▸ <a class="led-link" onclick="App.backFromRecord()||App.backToList()">'+this.esc(sectionLabel)+'</a> ▸ '+this.esc(current||'')+'</div></div>'; },

  /* ----- register: LIST ----- */
  editorBtn(){ return ''; },
  cfg(){ return REG[LABEL2KEY[this.wsSection]]; },
  records(b){ const k=LABEL2KEY[this.wsSection]; return (b.records&&b.records[k])?b.records[k]:[]; },
  setRecords(b,arr){ const k=LABEL2KEY[this.wsSection]; b.records=b.records||{}; b.records[k]=arr; this.saveBiz(b); },
  filterList(v){ this.listQuery=v; this.pageNum=1; const b=this.curBiz(); const wrap=document.getElementById('regBody'); if(wrap) wrap.innerHTML=this.tableHtml(b); },

  listHtml(b){
    const c=this.cfg();
    return this.crumb(c.label)+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+this.esc(c.label)+'</span>'+
      '<button class="btn btn-primary btn-xs" onclick="App.newRecord()">'+this.esc(c.newLabel)+'</button>'+
      this.editorBtn()+
      '<div class="reg-search"><span class="reg-adv" onclick="App.advOpen()" style="cursor:pointer">▸ Advanced Queries'+(this.advFilters&&this.advFilters.length?' ('+this.advFilters.length+')':'')+'</span>'+
      '<input type="text" placeholder="Search" value="'+this.esc(this.listQuery)+'" oninput="App.filterList(this.value)">'+
      '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>'+
      '<div id="regBody">'+this.tableHtml(b)+'</div>';
  },
  sortedRecords(b){ const c=this.cfg(); let rows=this.records(b).slice(); const dc=c.columns.find(col=>col.kind==='date');
    if(dc){ rows.sort((x,y)=>{ const dx=Date.parse(x[dc.key])||0, dy=Date.parse(y[dc.key])||0; if(dy!==dx) return dy-dx; return (y.id||0)-(x.id||0); }); }
    return rows; },
  tableHtml(b){
    const c=this.cfg(); const cols=this._cols(c); let rows=this.sortedRecords(b);
    const q=(this.listQuery||'').toLowerCase();
    if(q) rows=rows.filter(r=>cols.some(col=>{ const v=col.calc?col.calc(r):r[col.key]; return String(v==null?'':v).toLowerCase().includes(q); }));
    rows=this._advFilter(b,c,rows);
    const bm=this.batchMode; let p=null; if(rows.length) p=this._paginate(rows,'pageSize','pageNum');
    let head=(bm?'<th class="act"></th>':'')+'<th class="act"></th><th class="act"></th>'+cols.map(col=>'<th class="'+(col.r?'r':'')+'">'+this.esc(col.label)+'</th>').join('');
    let body;
    if(!rows.length){
      body='<tr><td colspan="'+(cols.length+2+(bm?1:0))+'"><div class="reg-empty">'+
        (this.records(b).length? 'No records match “'+this.esc(this.listQuery)+'”.' :
        'No '+c.label.toLowerCase()+' yet. Click <b>'+this.esc(c.newLabel)+'</b> to add one.')+'</div></td></tr>';
    } else {
      body=p.rows.map(r=>'<tr>'+
        (bm?'<td class="act"><input type="checkbox" '+(this.batchSel&&this.batchSel[r.id]?'checked':'')+' onclick="App.batchToggle('+r.id+')"></td>':'')+
        '<td class="act"><button class="btn btn-xs" onclick="App.editRecord('+r.id+')">Edit</button></td>'+
        '<td class="act"><button class="btn btn-xs" onclick="App.viewRecord('+r.id+')">View</button></td>'+
        cols.map(col=>{
          if(col.kind==='ledger') return '<td><a class="led-link" onclick="App.rowLedger('+r.id+')">ledger ↗</a></td>';
          const raw=col.calc?col.calc(r):r[col.key];
          if(col.kind==='money'){ const inner=col.ledger?'<a class="led-link" onclick="App.openLedger('+r.id+')">'+this.money(raw)+'</a>':this.money(raw); return '<td class="m '+(col.r?'r ':'')+(col.color||'')+' '+(col.bold?'bold':'')+'">'+inner+'</td>'; }
          if(col.kind==='date') return '<td class="'+(col.r?'r':'')+'">'+this.fmtDateUS(raw)+'</td>';
          if(col.kind==='status'){ const s=raw||''; const cls=s==='Overdue'?'st-overdue':(s==='Paid'?'st-paid':(s==='Draft'?'st-draft':(s==='Partially paid'?'st-partial':(s==='Overpaid'?'st-overpaid':'st-unpaid')))); return '<td>'+(s?'<span class="st-badge '+cls+'">'+this.esc(s)+'</span>':'')+'</td>'; }
          return '<td class="'+(col.r?'r':'')+'">'+(col.ledger?'<a class="led-link" onclick="App.openLedger('+r.id+')">'+this.esc(raw==null?'':raw)+'</a>':this.esc(raw==null?'':raw))+'</td>';
        }).join('')+'</tr>').join('');
    }
    const tcount=rows.length;
    let total='';
    if(c.totalCol){ const tcol=c.columns.find(x=>x.key===c.totalCol); const sum=rows.reduce((a,r)=>a+(+((tcol&&tcol.calc)?tcol.calc(r):r[c.totalCol])||0),0); total='<span class="total num">'+this.money(sum)+'</span>'; }
    const ftActs=[['Edit columns','App.editColumns()'],['Batch Operations','App.batchMenu()'],['Copy to clipboard','App.copyTable()']];
    if(this._sectionKey()==='bankCash') ftActs.push(['Import bank statement','App.bankImportOpen()']);
    const ftBtns=ftActs.map(t=>'<button class="ftbtn" onclick="'+t[1]+'">'+(t[0]==='Batch Operations'?'▸ ':'')+t[0]+'</button>').join('');
    const batchBar = bm ? ('<div class="batch-bar">Select rows to delete, then <button class="btn btn-sm btn-danger" onclick="App.batchDeleteRun()">Delete selected (<span id="batchCount">'+Object.keys(this.batchSel||{}).length+'</span>)</button> <button class="btn btn-sm" onclick="App.batchCancel()">Cancel</button></div>') : '';
    const pager = rows.length ? this._pagerBar(p,'reg') : '';
    const foot='<div class="reg-foot"><span class="cnt">'+tcount+' '+(tcount===1?'record':'records')+'</span>'+ftBtns+total+'</div>';
    /* the rounded shell stays put; only the columns scroll on narrow screens */
    return batchBar+'<div class="tbl-scroll"><table class="reg-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+pager+foot;
  },
  copyTable(){
    const b=this.curBiz(), c=this.cfg(), cols=this._cols(c);
    const header=cols.map(col=>col.label).join('\t');
    const lines=this.sortedRecords(b).map(r=>cols.map(col=>{ const v=col.calc?col.calc(r):r[col.key];
      return col.kind==='money'?this.money(v):(col.kind==='date'?this.fmtDateUS(v):(v==null?'':v)); }).join('\t'));
    const tsv=[header].concat(lines).join('\n');
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(()=>alert('Copied '+this.records(b).length+' rows to clipboard.'),()=>alert(tsv)); }
    else alert(tsv);
  },

  /* ----- pagination ----- */
  _paginate(rows, sizeKey, numKey){ var size=this[sizeKey]||50; var total=rows.length; var pages=(size==='all')?1:Math.max(1,Math.ceil(total/size)); var num=Math.min(Math.max(1,this[numKey]||1),pages); this[numKey]=num; var slice=(size==='all')?rows:rows.slice((num-1)*size, num*size); return {rows:slice, total:total, pages:pages, num:num, size:size}; },
  _pagerBar(p, kind){ var sizeFn=(kind==='led')?'App.setLPageSize':'App.setPageSize'; var goFn=(kind==='led')?'App.gotoLPage':'App.gotoPage'; var sizes=[50,100,500,1000,'all'];
    var szBtns=sizes.map(function(s){ var lbl=(s==='all')?'All':s; var arg=(s==='all')?"'all'":s; var on=(String(p.size)===String(s)); return '<button class="pg-sz'+(on?' on':'')+'" onclick="'+sizeFn+'('+arg+')">'+lbl+'</button>'; }).join('');
    var sz=(p.size==='all')?(p.total||1):p.size; var from=p.total?((p.num-1)*sz+1):0; var to=(p.size==='all')?p.total:Math.min(p.num*sz,p.total);
    var nav=(p.pages>1)?('<button class="pg-nav"'+(p.num<=1?' disabled':'')+' onclick="'+goFn+'('+(p.num-1)+')">‹ Prev</button><span class="pg-info">Page '+p.num+' / '+p.pages+'</span><button class="pg-nav"'+(p.num>=p.pages?' disabled':'')+' onclick="'+goFn+'('+(p.num+1)+')">Next ›</button>'):'';
    return '<div class="pg-bar"><span class="pg-info">'+from+'–'+to+' of '+p.total+'</span><span style="flex:1"></span>'+nav+'<span class="pg-szwrap">Show '+szBtns+'</span></div>'; },
  setPageSize(s){ this.pageSize=s; this.pageNum=1; var w=document.getElementById('regBody'); if(w) w.innerHTML=this.tableHtml(this.curBiz()); },
  gotoPage(n){ this.pageNum=n; var w=document.getElementById('regBody'); if(w) w.innerHTML=this.tableHtml(this.curBiz()); },
  setLPageSize(s){ this.lPageSize=s; this.lPageNum=1; this.renderMain(this.curBiz()); },
  gotoLPage(n){ this.lPageNum=n; this.renderMain(this.curBiz()); },

  /* ----- batch operations (divide: import / delete) ----- */
  batchMenu(){ this._openOverlay('<div class="app-modal-h">Batch operations</div><div class="app-modal-b"><div style="display:flex;flex-direction:column;gap:8px"><button class="btn" style="justify-content:flex-start" onclick="App._closeOverlay();App.batchImport()">⬆ &nbsp;Import / create records from CSV</button><button class="btn" style="justify-content:flex-start" onclick="App._closeOverlay();App.batchDelete()">🗑 &nbsp;Delete records in bulk</button></div></div><div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button></div>'); },
  batchDelete(){ this.batchMode=true; this.batchSel={}; this.renderWorkspace(); },
  batchCancel(){ this.batchMode=false; this.batchSel={}; this.renderWorkspace(); },
  batchToggle(id){ this.batchSel=this.batchSel||{}; if(this.batchSel[id]) delete this.batchSel[id]; else this.batchSel[id]=1; var c=document.getElementById('batchCount'); if(c) c.textContent=Object.keys(this.batchSel).length; },
  batchDeleteRun(){ var b=this.curBiz(); var key=this._sectionKey(); var ids=Object.keys(this.batchSel||{}).map(Number); if(!ids.length){ alert('Select at least one row first.'); return; } var c=REG[key]||{}; var noun=(c.label||'records'); var _lk=(b&&b.lockDate)||''; if(_lk){ var _arr0=(b.records&&b.records[key])||[]; var _locked=_arr0.filter(function(r){ if(ids.indexOf(r.id)<0) return false; var _d=String(r.issueDate||r.date||'').slice(0,10); return _d&&_d<=_lk; }).length; if(_locked){ alert(_locked+' of the selected '+noun+' are dated on or before the lock date ('+_lk+') and can\u2019t be deleted while the period is locked. Update Settings \u2192 Lock Date first.'); return; } } if(!this._ask('Delete '+ids.length+' selected '+noun+'?\n\nThis can be undone from History.',()=>this.batchDeleteRun())) return;
    var idset={}; ids.forEach(function(i){ idset[i]=1; }); var arr=(b.records&&b.records[key])||[]; var deleted=arr.filter(function(r){ return idset[r.id]; }).map(function(r){ return JSON.parse(JSON.stringify(r)); });
    b.records[key]=arr.filter(function(r){ return !idset[r.id]; }); try{ this._logActivity(b,'delete',key,null,null,{bulkDeleted:deleted, label:'Batch delete — '+deleted.length+' '+noun}); }catch(e){} try{ refreshSummary(b); }catch(e){} this.saveBiz(b); this.batchMode=false; this.batchSel={}; this.renderWorkspace(); var n=deleted.length; setTimeout(function(){ alert('Deleted '+n+' '+noun+'.'); },30); },

  /* ----- advanced queries (multi-condition filter) ----- */
  advOpen(){ const c=this.cfg(); if(!c) return; if(!this.advFilters||!this.advFilters.length){ const cols=this._colPool(c); this.advFilters=[{col:(cols[0]||{}).key||'', op:'contains', val:''}]; } this._openOverlay(this._advHtml(c)); },
  _advOps(){ return [['contains','contains'],['eq','equals'],['ne','does not equal'],['gt','greater than'],['lt','less than'],['ge','≥'],['le','≤'],['empty','is empty'],['nempty','is not empty']]; },
  _advRowsHtml(c){ const self=this; const cols=this._colPool(c); const ops=this._advOps();
    const colOpts=(sel)=>cols.map(col=>'<option value="'+self.esc(col.key)+'"'+(col.key===sel?' selected':'')+'>'+self.esc(col.label)+'</option>').join('');
    const opOpts=(sel)=>ops.map(o=>'<option value="'+o[0]+'"'+(o[0]===sel?' selected':'')+'>'+o[1]+'</option>').join('');
    return (this.advFilters||[]).map((f,i)=>'<div class="adv-row" data-i="'+i+'"><select class="adv-col">'+colOpts(f.col)+'</select><select class="adv-op">'+opOpts(f.op)+'</select><input class="adv-val" type="text" value="'+self.esc(f.val||'')+'" placeholder="value"><button class="btn btn-xs" onclick="App.advDelRow('+i+')">✕</button></div>').join(''); },
  _advHtml(c){ return '<div class="app-modal-h">Advanced query — '+this.esc(c.label)+'</div><div class="app-modal-b">'+
    '<div style="margin-bottom:9px;font-size:13px">Show rows matching <select id="advMatch"><option value="all"'+(this.advMatch!=='any'?' selected':'')+'>all</option><option value="any"'+(this.advMatch==='any'?' selected':'')+'>any</option></select> of these conditions:</div>'+
    '<div id="advRows">'+this._advRowsHtml(c)+'</div>'+
    '<button class="btn btn-xs" style="margin-top:8px" onclick="App.advAddRow()">+ Add condition</button></div>'+
    '<div class="app-modal-f"><button class="btn btn-xs" onclick="App.advClear()">Clear all</button><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="App.advApply()">Apply filter</button></div>'; },
  _advReadDom(){ const rows=[]; const els=document.querySelectorAll('#advRows .adv-row'); els.forEach(function(el){ const col=el.querySelector('.adv-col'); const op=el.querySelector('.adv-op'); const val=el.querySelector('.adv-val'); rows.push({col:col?col.value:'', op:op?op.value:'contains', val:val?val.value:''}); }); const m=document.getElementById('advMatch'); return {rows:rows, match:m?m.value:'all'}; },
  _advRefreshRows(c){ const w=document.getElementById('advRows'); if(w) w.innerHTML=this._advRowsHtml(c); },
  advAddRow(){ const c=this.cfg(); const d=this._advReadDom(); this.advFilters=d.rows; this.advMatch=d.match; const cols=this._colPool(c); this.advFilters.push({col:(cols[0]||{}).key||'', op:'contains', val:''}); this._advRefreshRows(c); },
  advDelRow(i){ const c=this.cfg(); const d=this._advReadDom(); this.advFilters=d.rows; this.advMatch=d.match; this.advFilters.splice(i,1); this._advRefreshRows(c); },
  advApply(){ const d=this._advReadDom(); this.advFilters=(d.rows||[]).filter(f=>f.col && (f.op==='empty'||f.op==='nempty'||String(f.val).length)); this.advMatch=d.match; this._closeOverlay(); this.pageNum=1; this.renderWorkspace(); },
  advClear(){ this.advFilters=[]; this.advMatch='all'; this._closeOverlay(); this.pageNum=1; this.renderWorkspace(); },
  _advTest(r,f,col){ const raw=(col&&col.calc)?col.calc(r):r[f.col]; const op=f.op; const sv=String(raw==null?'':raw);
    if(op==='empty') return sv.trim()===''; if(op==='nempty') return sv.trim()!=='';
    if(op==='gt'||op==='lt'||op==='ge'||op==='le'){ let a,bv; if(col&&col.kind==='date'){ a=Date.parse(raw)||0; bv=Date.parse(f.val)||0; } else { a=parseFloat(String(raw).replace(/[^0-9.\-]/g,''))||0; bv=parseFloat(String(f.val).replace(/[^0-9.\-]/g,''))||0; } return op==='gt'?a>bv:op==='lt'?a<bv:op==='ge'?a>=bv:a<=bv; }
    const L=sv.toLowerCase(), V=String(f.val==null?'':f.val).toLowerCase();
    if(op==='eq') return L===V; if(op==='ne') return L!==V; return L.indexOf(V)>=0; },
  _advFilter(b, c, rows){ if(!this.advFilters||!this.advFilters.length) return rows; const self=this; const cmap={}; this._colPool(c).forEach(cc=>cmap[cc.key]=cc); const match=this.advMatch||'all';
    return rows.filter(function(r){ const res=self.advFilters.map(f=>self._advTest(r,f,cmap[f.col])); return match==='any'?res.some(Boolean):res.every(Boolean); }); },

  /* ----- app-level modal overlay ----- */
  _openOverlay(html){ this._closeOverlay(); const ov=document.createElement('div'); ov.id='appOverlay'; ov.className='app-modal-ov'; ov.onclick=function(e){ if(e.target===ov) App._closeOverlay(); }; ov.innerHTML='<div class="app-modal">'+html+'</div>'; document.body.appendChild(ov); },
  _closeOverlay(){ const o=document.getElementById('appOverlay'); if(o) o.remove(); },
  /* App modals instead of the browser's confirm()/prompt() (js/ui-modal.js). `if(!this._ask(msg,rerun)) return;`
     opens the modal and returns false; OK re-runs the action, which then passes straight through. */
  _ask(msg,rerun){ if(typeof UIModal!=='undefined'&&UIModal.gate) return UIModal.gate(msg,rerun); return (typeof confirm==='function')?confirm(msg):true; },
  _askText(msg,def,rerun){ if(typeof UIModal!=='undefined'&&UIModal.promptGate) return UIModal.promptGate(msg,def,rerun); return null; },

  /* ----- configurable list columns (#3) ----- */
  _sectionKey(){ return LABEL2KEY[this.wsSection]; },
  _colPool(c){ const pool=[]; const seen={};
    (c.columns||[]).forEach(col=>{ if(col.key){ pool.push(col); seen[col.key]=1; } });
    (c.form||[]).forEach(f=>{ if(f.key && !seen[f.key]){ const kind=(f.type==='date')?'date':((f.type==='money')?'money':'text'); pool.push({key:f.key,label:f.label,kind:kind}); seen[f.key]=1; } });
    pool.push({key:'__ledger',label:'Ledger',kind:'ledger'});
    return pool; },
  _cols(c){ if(!c) return []; const b=this.curBiz(); const key=this._sectionKey();
    const saved=(b&&b.details&&b.details.listCols&&b.details.listCols[key])||null;
    if(!saved||!saved.length) return c.columns;
    const pool={}; this._colPool(c).forEach(col=>{ pool[col.key]=col; });
    const out=[]; saved.forEach(k=>{ if(pool[k]) out.push(pool[k]); });
    return out.length?out:c.columns; },
  rowLedger(id){ const key=this._sectionKey(); const LED={customers:1,suppliers:1,employees:1,capital:1,inventory:1,fixedAssets:1,bankCash:1};
    if(LED[key]) this.openLedger(id); else this.viewRecord(id); },
  editColumns(){ const c=this.cfg(); if(!c) return; const pool=this._colPool(c); const cur=this._cols(c); const on={}; cur.forEach(col=>{ on[col.key]=1; });
    const rows=pool.map(col=>'<label style="display:flex;align-items:center;gap:9px;padding:7px 4px;border-bottom:1px solid #f2f2f2;cursor:pointer">'+
      '<input type="checkbox" data-colk="'+this.esc(col.key)+'"'+(on[col.key]?' checked':'')+'>'+
      '<span style="font-size:13.5px">'+this.esc(col.label)+(col.key==='__ledger'?' <span style="color:#aaa;font-size:11px">— link to this record\u2019s ledger</span>':'')+'</span></label>').join('');
    this._openOverlay('<div class="app-modal-h">Edit columns — '+this.esc(c.label)+'</div>'+
      '<div class="app-modal-b"><div style="color:#777;font-size:12.5px;margin-bottom:8px">Choose which columns appear in the '+this.esc(c.label)+' list. The list is built from the '+this.esc((c.singular||c.label)).toLowerCase()+' form fields, plus a Ledger link column.</div>'+rows+'</div>'+
      '<div class="app-modal-f"><button class="btn btn-xs" onclick="App.resetColumns()">Reset to default</button><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="App.saveColumns()">Save</button></div>'); },
  saveColumns(){ const b=this.curBiz(); const key=this._sectionKey(); const ov=document.getElementById('appOverlay'); if(!ov) return;
    const sel=[]; ov.querySelectorAll('input[data-colk]').forEach(ch=>{ if(ch.checked) sel.push(ch.getAttribute('data-colk')); });
    b.details=b.details||{}; b.details.listCols=b.details.listCols||{};
    if(!sel.length) delete b.details.listCols[key]; else b.details.listCols[key]=sel;
    this.saveBiz(b); this._closeOverlay(); this.renderWorkspace(); },
  resetColumns(){ const b=this.curBiz(); const key=this._sectionKey(); if(b.details&&b.details.listCols) delete b.details.listCols[key]; this.saveBiz(b); this._closeOverlay(); this.renderWorkspace(); },

  /* ----- batch import / upload (#2) ----- */
  _importFields(c){ const out=[]; const seen={};
    (c.form||[]).forEach(f=>{ if(f.key&&!seen[f.key]){ out.push({key:f.key,label:f.label,type:(f.type||'text')}); seen[f.key]=1; } });
    (c.columns||[]).forEach(col=>{ if(col.key&&!col.calc&&!seen[col.key]){ out.push({key:col.key,label:col.label,type:(col.kind||'text')}); seen[col.key]=1; } });
    return out; },
  _parseDelimited(text){ const lines=String(text||'').replace(/\r/g,'').split('\n').filter(l=>l.trim()!=='');
    if(!lines.length) return {header:[],rows:[]};
    const tabN=lines[0].split('\t').length, comN=lines[0].split(',').length; const delim=(tabN>=comN&&tabN>1)?'\t':',';
    function parseLine(line){ if(delim==='\t') return line.split('\t').map(s=>s.trim());
      const out=[]; let cur='',inq=false; for(let i=0;i<line.length;i++){ const ch=line[i];
        if(inq){ if(ch==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else inq=false; } else cur+=ch; }
        else { if(ch==='"') inq=true; else if(ch===','){ out.push(cur.trim()); cur=''; } else cur+=ch; } }
      out.push(cur.trim()); return out; }
    return {header:parseLine(lines[0]), rows:lines.slice(1).map(parseLine)}; },
  _mapHeaders(header, fields){ const byLabel={},byKey={}; fields.forEach(f=>{ byLabel[String(f.label).toLowerCase()]=f; byKey[String(f.key).toLowerCase()]=f; });
    const map={}; header.forEach((h,i)=>{ const k=String(h).toLowerCase().trim(); const f=byLabel[k]||byKey[k]; if(f) map[i]={key:f.key,type:f.type}; }); return map; },
  batchImport(){ const c=this.cfg(); if(!c) return; const fields=this._importFields(c); const hdr=fields.map(f=>f.label).join(', ');
    this._openOverlay('<div class="app-modal-h">Batch import — '+this.esc(c.label)+'</div>'+
      '<div class="app-modal-b">'+
      '<div style="color:#777;font-size:12.5px;margin-bottom:8px">Paste rows copied from Excel / Google Sheets, or load a CSV file. The <b>first row must be a header</b> matching these column names (order doesn\u2019t matter; unknown columns are ignored):</div>'+
      '<div style="font-size:12px;background:#f6f7f9;border:1px solid var(--line);border-radius:6px;padding:8px;margin-bottom:8px;color:#444;word-break:break-word">'+this.esc(hdr)+'</div>'+
      '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap"><button class="btn btn-xs" onclick="App.batchTemplate()">⬇ Download template (CSV)</button>'+
      '<button class="btn btn-xs" onclick="App.batchPickFile()">⬆ Load CSV / TSV file…</button></div>'+
      '<textarea id="bimp_ta" oninput="App._bimpDirty()" style="width:100%;min-height:150px;padding:8px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;font-size:12px" placeholder="'+this.esc(hdr)+'&#10;…paste rows here…"></textarea>'+
      '<div id="bimp_msg" style="font-size:12.5px;color:#777;margin-top:8px"></div>'+
      '</div>'+
      '<div class="app-modal-f"><button class="btn" onclick="App._closeOverlay()">Cancel</button><span style="flex:1"></span><button class="btn btn-primary" onclick="App.batchPreview()">Preview</button><button class="btn btn-primary" id="bimp_go" style="display:none" onclick="App.batchRun()">Import</button></div>'); },
  _bimpDirty(){ const go=document.getElementById('bimp_go'); if(go) go.style.display='none'; this._bimp=null; },
  batchTemplate(){ const c=this.cfg(); const fields=this._importFields(c); const hdr=fields.map(f=>'"'+String(f.label).replace(/"/g,'""')+'"').join(',');
    this._download((this._sectionKey()||'import')+'-template.csv', hdr+'\n'); },
  batchPickFile(){ const inp=document.createElement('input'); inp.type='file'; inp.accept='.csv,.tsv,.txt,text/csv'; inp.onchange=function(){ const f=inp.files&&inp.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=function(){ const ta=document.getElementById('bimp_ta'); if(ta){ ta.value=rd.result; App._bimpDirty(); App.batchPreview(); } }; rd.readAsText(f); }; inp.click(); },
  batchPreview(){ const ta=document.getElementById('bimp_ta'); const msg=document.getElementById('bimp_msg'); if(!ta||!msg) return;
    const c=this.cfg(); const fields=this._importFields(c); const parsed=this._parseDelimited(ta.value);
    if(!parsed.header.length){ msg.innerHTML='<span style="color:#c0392b">Nothing to import — paste some rows first.</span>'; return; }
    const map=this._mapHeaders(parsed.header, fields); const mapped=Object.keys(map).length;
    if(!mapped){ msg.innerHTML='<span style="color:#c0392b">No header matched the expected columns. Check the first row.</span>'; const go=document.getElementById('bimp_go'); if(go) go.style.display='none'; return; }
    const matched=parsed.header.filter((h,i)=>map[i]!=null).join(', ');
    msg.innerHTML='Ready: <b>'+parsed.rows.length+'</b> row'+(parsed.rows.length===1?'':'s')+', '+mapped+' column'+(mapped===1?'':'s')+' mapped (<span style="color:#444">'+this.esc(matched)+'</span>). Click <b>Import</b> to add them.';
    this._bimp={parsed:parsed, map:map}; const go=document.getElementById('bimp_go'); if(go) go.style.display=''; },
  batchRun(){ const b=this.curBiz(); const c=this.cfg(); const key=this._sectionKey(); const st=this._bimp; if(!st){ this.batchPreview(); return; }
    const arr=this.records(b).slice(); let maxId=arr.reduce((m,r)=>Math.max(m,+r.id||0),0); let n=0; const newIds=[];
    st.parsed.rows.forEach(cells=>{ const rec={}; let any=false;
      Object.keys(st.map).forEach(i=>{ const f=st.map[i]; let v=cells[i]; if(v==null) v=''; if((f.type==='money'||f.type==='number')&&v!=='') v=parseFloat(String(v).replace(/[^0-9.\-]/g,''))||0; rec[f.key]=v; if(String(v).trim()!=='') any=true; });
      if(!any) return; rec.id=++maxId; rec.uuid='r'+Date.now().toString(36)+maxId; arr.push(rec); newIds.push(rec.id); n++; });
    if(!n){ const msg=document.getElementById('bimp_msg'); if(msg) msg.innerHTML='<span style="color:#c0392b">No non-empty rows found.</span>'; return; }
    b.records=b.records||{}; b.records[key]=arr; try{ refreshSummary(b); }catch(e){} try{ this._logActivity(b,'create',key,null,null,{bulkIds:newIds,label:'Batch import — '+n+' '+(n===1?'record':'records')+' into '+c.label}); }catch(e){} this.saveBiz(b);
    this._closeOverlay(); this.renderWorkspace(); setTimeout(()=>alert('Imported '+n+' '+(n===1?'record':'records')+' into '+c.label+'.'),30); },

  /* ----- register: FORM (new / edit) ----- */
  newRecord(){ if(!this.guardWrite()) return; this.recReturn=null; this.histReturn=false; this.editingId=null;
    try{ var b=this.curBiz(); var k=LABEL2KEY[this.wsSection]; if(b&&k){ var pf=this.applyFormDefaults(b,k,this._prefill||null); if(pf&&Object.keys(pf).length) this._prefill=pf; } }catch(e){}
    this.wsMode='form'; this.renderMain(this.curBiz()); },
  editRecord(id){ this.editingId=id; this.wsMode='form'; this.renderMain(this.curBiz()); },
  refOptions(b,fromKey){ return ((b.records&&b.records[fromKey])||[]).map(r=>r.name).filter(Boolean); },
  accountOptions(b){ if(!b||!b.coa) return []; return b.coa.filter(n=>n.type==='account').map(n=>({id:n.id,label:acctPath(b,n)+(n.code?' ('+n.code+')':'')})).sort((x,y)=>x.label.localeCompare(y.label)); },
  _divisionBar(b,key,rec){ var self=this; var divs=b.divisions||[]; if(!divs.length) return '';
    var TXN=this._divisionTxnKeys();
    if(!TXN[key]) return ''; var cur=(rec&&rec.division)||'';
    var opts='<option value="">— No division —</option>'+divs.map(function(d){ return '<option value="'+self.esc(d.id)+'"'+(cur===d.id?' selected':'')+'>'+self.esc(d.name||'')+(d.code?(' ('+self.esc(d.code)+')'):'')+'</option>'; }).join('');
    return '<div class="div-bar"><label>Division</label><select id="f_division" data-qc-source="division">'+opts+'</select>'+
      this._projectPicker(b,key,rec)+'<span class="div-hint">Tag this transaction to a division / department.</span></div>'; },
  _divisionTxnKeys(){ return {receipts:1,payments:1,iat:1,salesInv:1,purchInv:1,salesQuotes:1,purchQuotes:1,salesOrders:1,purchOrders:1,
    creditNotes:1,debitNotes:1,deliveryNotes:1,goodsRec:1,journal:1,payslips:1,depreciation:1,
    expenseClaims:1,billableTime:1,whtReceipts:1,invWriteOffs:1,production:1,amortization:1}; },
  _projectPicker(b,key,rec){ var self=this; var ps=(b.projects||[]).filter(function(p){ return p&&p.name&&p.status!=='Complete'; });
    if(!ps.length) return ''; var cur=(rec&&rec.project)||'';
    return '<label style="margin-left:14px">Project</label><select id="f_project" data-qc-source="project"><option value="">— No project —</option>'+
      ps.map(function(p){ return '<option value="'+self.esc(p.id)+'"'+(cur===p.id?' selected':'')+'>'+self.esc(p.name)+(p.code?(' ('+self.esc(p.code)+')'):'')+'</option>'; }).join('')+'</select>'; },

  /* Values a new document opens with, from Settings -> Form Defaults. */
  formDefaultsFor(b,key){ return ((b&&b.formDefaults)||{})[key]||{}; },
  applyFormDefaults(b,key,pf){ var d=this.formDefaultsFor(b,key); if(!d) return pf; pf=pf||{};
    if(d.description && !pf.description) pf.description=d.description;
    if(d.division && !pf.division){ var dv=(b.divisions||[]).find(function(x){ return x.name===d.division; }); if(dv) pf.division=dv.id; }
    if(d.dueDays!=null && d.dueDays!=='' && pf.dueDays==null){ pf.dueType='Net'; pf.dueDays=d.dueDays; }
    if(d.taxCode && !pf.defaultTaxCode) pf.defaultTaxCode=d.taxCode;
    return pf; },
  /* Receipts, payments and sales invoices use the native voucher engine
     (js/txn-forms.js) unless the business switched that form to the Form
     Designer path: b.formEngine[key]==='designed'. */
  _nativeTxnForm(b,key){ return typeof TxnForms!=='undefined' && !!TxnForms.handles(b,key); },
  formHtml(b){
    const key=LABEL2KEY[this.wsSection]; const c=this.cfg();
    if(this._nativeTxnForm(b,key)) return TxnForms.formHtml(b,key);
    try{ this._ensureDefaultTemplate(key); }catch(e){}
    try{ this._refreshTemplateFromState(key); }catch(e){}
    const _erec=(this.editingId!=null)?(this.records(b)||[]).find(function(x){return x.id===App.editingId;}):null;
    const title=_erec ? (_erec.name||_erec.reference||_erec.number||_erec.code||('Edit '+(c?c.singular:'Record'))) : (c?c.newLabel:'New record');
    const uid=this.uuid();
    if(window.MgrForms && MgrForms.has && MgrForms.has(key)){
      return this.recCrumb((c?c.label:this.wsSection), title)+
        '<div id="deHost" class="de-host"></div>'+
        this._divisionBar(b,key,_erec)+
        '<div class="form-actions"><button class="btn btn-primary" onclick="App.saveDesignedRecord(\''+key+'\')">'+(this.editingId!=null?'Update':'Create')+'</button>'+
        '<button class="btn" onclick="App.backFromRecord()||App.backToList()">Cancel</button>'+
        (this.editingId!=null?'<button class="btn btn-sm" style="background:#d64545;border-color:#d64545;color:#fff" onclick="App.deleteRecord('+JSON.stringify(this.editingId)+')">Delete</button>':'')+
        '<button class="btn btn-sm" style="margin-left:auto" onclick="App.openDesignerFor(\''+key+'\')" title="Edit this form\u2019s design">\u270e Edit design</button>'+
        ((typeof TxnForms!=='undefined'&&TxnForms.KEYS[key])?'<button class="btn btn-sm" onclick="TxnForms.setEngine(\''+key+'\',\'native\')" title="Switch back to the standard entry form">Use standard form</button>':'')+'</div>';
    }
    return this.recCrumb((c?c.label:this.wsSection), title)+
      '<div class="card"><div class="card-head"><h2 style="margin:0">'+this.esc(title)+'</h2></div>'+
      '<div class="info-bar">No form has been designed for <b>'+this.esc(c?c.singular:this.wsSection)+'</b> yet.</div>'+
      '<p class="sub" style="margin:10px 2px">Open the designer in <b>Settings \u2192 Custom Themes</b>, lay out this form, click <b>Publish to app</b>, then return here \u2014 this screen will become your designed form.</p>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.openDesignerFor(\''+key+'\')">\u270e Design this form</button>'+
      '<button class="btn" onclick="App.backToList()">Back</button></div></div>';
  },
  linesSectionHtml(b,rec,c){ if(!c.lines) return ''; const add=(c.lines.kind==='journal'||c.lines.kind==='cash'||c.lines.kind==='payslip'||c.lines.kind==='depr')
      ? '<div class="li-add"><button class="btn btn-sm" onclick="App.addLine(1)">▶ Add line</button></div>'
      : '<div class="li-add"><span>Add lines:</span><button class="btn btn-sm" onclick="App.addLine(1)">+1</button><button class="btn btn-sm" onclick="App.addLine(5)">+5</button><button class="btn btn-sm" onclick="App.addLine(10)">+10</button><button class="btn btn-sm" onclick="App.addLine(20)">+20</button></div>';
    let s='<div class="li-sec">'+(c.lines.kind==='journal'?'Journal lines':(c.lines.kind==='payslip'?'Earnings & deductions':(c.lines.kind==='depr'?'Depreciation lines':'Line items')))+'</div>'+
      '<div id="linesWrap" class="li-scroll">'+this.linesTableHtml(c)+'</div>'+add+'<div id="linesTotals">'+this.linesTotalsHtml(c)+'</div>';
    if(c.lines.kind==='invoice') s+=this.invoiceOptions(b,rec); return s; },
  cfFieldBlockHtml(b,x,rec){ const e=s=>this.esc(s); const lbl=e(x.label||'Custom field');
    let t; try{ t=this.invoiceTotals(); }catch(_){ t={sub:Number(rec.subtotal)||0,tax:Number(rec.tax)||0,total:Number(rec.total)||0}; }
    let q=0,pr=0; (this._lines||[]).forEach(l=>{ q+=this.parseNum(l.qty)||0; pr+=this.parseNum(l.price)||0; });
    const def=(rec&&rec.custom&&rec.custom[x.key]!=null)?rec.custom[x.key]:(x.value||''); let inp;
    if(x.dataType==='formula'){ const val=this.money(this.evalCustomFormula(x,{subtotal:t.sub,qty:q,price:pr,taxAmt:t.tax,tax:t.tax,total:t.total,cf:k=>this.parseNum(rec&&rec.custom&&rec.custom[k])||0})); inp='<input id="f_cfdisp_'+x.key+'" type="text" readonly value="'+val+'" title="Calculated automatically" style="background:#fafafa;color:#555;max-width:240px">'; }
    else inp=this.cfEntryInput(x,'f_cf_'+x.key,def,(x.dataType==='number')?'oninput="App.recomputeLines()"':'');
    return '<label class="fld" style="margin-top:4px">'+lbl+(x.dataType==='formula'?' <span style="color:#999;font-weight:400;font-size:11px">(calculated)</span>':'')+'</label>'+inp; },
  cfFieldBlockGenericHtml(b,x,rec){ const lbl=this.esc(x.label||'Custom field'); const def=(rec&&rec.custom&&rec.custom[x.key]!=null)?rec.custom[x.key]:(x.value||'');
    let inp; if(x.dataType==='formula'){ inp='<input id="f_cf_'+x.key+'" type="text" readonly value="" title="Calculated automatically" style="background:#fafafa;color:#555;max-width:240px">'; }
    else inp=this.cfEntryInput(x,'f_cf_'+x.key,def,'');
    return '<label class="fld" style="margin-top:4px">'+lbl+'</label>'+inp; },
  invoiceBlocks(b,rec,c,linesSection){ const isP=this.purchaseDoc(); const v=k=>rec&&rec[k]!=null?rec[k]:''; const e=s=>this.esc(s);
    const partyKey=isP?'supplier':'customer', partyFrom=isP?'suppliers':'customers', partyLabel=isP?'Supplier':'Customer';
    const dueType=v('dueType')||'Net';
    let partyOpts=this.refOptions(b,partyFrom); const pv=v(partyKey); if(pv&&partyOpts.indexOf(pv)<0) partyOpts=[pv].concat(partyOpts);
    const partySel = partyOpts.length ? '<select id="f_'+partyKey+'" onchange="App.partyChange(this.value)" style="min-width:240px"><option value="">— select '+partyLabel.toLowerCase()+' —</option>'+partyOpts.map(o=>'<option'+(String(pv)===String(o)?' selected':'')+'>'+e(o)+'</option>').join('')+'</select>' : '<input id="f_'+partyKey+'_txt" type="text" placeholder="Add a '+partyLabel.toLowerCase()+' first" value="'+e(pv)+'">';
    const blocks={};
    blocks.date='<label class="fld">Issue date *</label><input id="f_issueDate" type="date" value="'+e(v('issueDate'))+'" style="max-width:220px">';
    blocks.dueDate='<label class="fld" style="margin-top:4px">Due date</label><div class="frm-inline"><select id="f_dueType" class="frm-mini" style="width:74px;flex:none" onchange="App.dueTypeChange(this.value)"><option'+(dueType==='Net'?' selected':'')+'>Net</option><option'+(dueType==='By'?' selected':'')+'>By</option></select><span id="dueCtl" style="flex:1">'+this.dueDateControl(dueType,rec)+'</span></div>';
    blocks.reference=this.refFieldHtml(b, LABEL2KEY[this.wsSection], v('reference'));
    blocks.party='<div class="frm-sec">'+partyLabel+'</div><div class="frm-inline">'+partySel+'</div>';
    blocks.address='<label class="fld" style="margin-top:4px">'+(isP?'Supplier address':'Billing address')+'</label><textarea id="f_billingAddress" rows="3">'+e(v('billingAddress'))+'</textarea>';
    blocks.description='<label class="fld" style="margin-top:4px">Description</label><input id="f_description" type="text" placeholder="Optional" value="'+e(v('description'))+'">';
    ((this.formCfg(b,LABEL2KEY[this.wsSection])||{}).custom||[]).filter(x=>x.type==='field').forEach(x=>{ blocks['cf:'+x.key]=this.cfFieldBlockHtml(b,x,rec); });
    const isNew=this.editingId==null;
    const disc=(rec&&rec.disclaimer!=null&&rec.disclaimer!=='')?rec.disclaimer:(isNew?'This is a computer generated invoice and does not need any signature.':'');
    const bank=(rec&&rec.bankDetails!=null)?rec.bankDetails:'';
    const pck=(k)=>{ const v=rec&&rec[k]; const on=(v!=null)?!!v:true; return '<label class="chk-row" style="margin:0 0 6px"><input type="checkbox" id="f_'+k+'"'+(on?' checked':'')+'> Print on document</label>'; };
    blocks.bankDetails='<label class="fld">'+(isP?'Notes':'Bank Account Details')+'</label>'+pck('printBankDetails')+'<textarea id="f_bankDetails" rows="4" placeholder="Account Title: ...&#10;Bank Name: ...&#10;Account no. ...&#10;IBAN Number: ...&#10;Swift Code: ...">'+e(bank)+'</textarea>';
    blocks.disclaimer='<label class="fld">Disclaimer</label>'+pck('printDisclaimer')+'<textarea id="f_disclaimer" rows="2">'+e(disc)+'</textarea>';
    blocks.lines=linesSection!=null?linesSection:this.linesSectionHtml(b,rec,c);
    return blocks; },
  entryOrderFor(b,key){ const c=this.cfgEnsure(b,key); if(!c) return []; const sc=this.formSchema(key);
    if(sc && sc.kind==='record'){ const base=(sc.fields||[]).map(f=>f.key); const cf=((c.custom)||[]).filter(x=>x.type==='field').map(x=>'cf:'+x.key); const tail=sc.lines?['lines']:[]; const all=base.concat(cf).concat(tail);
      let ord=Array.isArray(c.entryOrder)?c.entryOrder.slice():null; if(!ord) ord=all.slice();
      ord=ord.filter(id=>all.indexOf(id)>=0);
      all.forEach(id=>{ if(ord.indexOf(id)<0){ if(tail.indexOf(id)>=0){ ord.push(id); } else { const li=ord.indexOf('lines'); if(li>=0) ord.splice(li,0,id); else ord.push(id); } } });
      c.entryOrder=ord; return ord; }
    const head=['date','dueDate','reference','party','address','description']; const cf=((c.custom)||[]).filter(x=>x.type==='field').map(x=>'cf:'+x.key); const tail=['lines','bankDetails','disclaimer']; const all=head.concat(cf).concat(tail);
    let ord=Array.isArray(c.entryOrder)?c.entryOrder.slice():null; if(!ord) ord=all.slice();
    ord=ord.filter(id=>all.indexOf(id)>=0);
    all.forEach(id=>{ if(ord.indexOf(id)<0){ if(tail.indexOf(id)>=0){ ord.push(id); } else { const li=ord.indexOf('lines'); if(li>=0) ord.splice(li,0,id); else ord.push(id); } } });
    c.entryOrder=ord; return ord; },
  gridFor(b,key){ const c=this.cfgEnsure(b,key); if(!c) return {}; const order=this.entryOrderFor(b,key); const sc=this.formSchema(key);
    if(sc && sc.kind==='record'){ if(c.gridV!==6){ c.entryGrid={}; c.gridV=6; } const g=c.entryGrid||{}; let row=1; const DEF={};
      order.forEach(id=>{ DEF[id]= id==='lines' ? {r:row++,c:1} : {r:row++,c:1,w:300}; });
      order.forEach(id=>{ if(!g[id]) g[id]=Object.assign({},DEF[id]); });
      Object.keys(g).forEach(id=>{ if(order.indexOf(id)<0) delete g[id]; }); c.entryGrid=g; return g; }
    if(c.gridV!==6){ c.entryGrid={}; c.gridV=6; }
    const g=c.entryGrid||{};
    const cfKeys=order.filter(id=>id.indexOf('cf:')===0);
    const DEF={ date:{r:1,c:1,w:130}, dueDate:{r:1,c:2,w:0}, reference:{r:1,c:3,w:150}, party:{r:2,c:1,w:260}, address:{r:3,c:1,w:380}, description:{r:4,c:1,w:600} };
    let row=5; cfKeys.forEach(k=>{ DEF[k]={r:row++,c:1,w:240}; });
    DEF.lines={r:row++,c:1}; DEF.bankDetails={r:row,c:1,w:320}; DEF.disclaimer={r:row,c:2,w:320}; let fb=row+1;
    order.forEach(id=>{ if(!g[id]){ g[id]= DEF[id] ? Object.assign({},DEF[id]) : {r:fb++,c:1}; } });
    Object.keys(g).forEach(id=>{ if(order.indexOf(id)<0) delete g[id]; }); c.entryGrid=g; return g; },
  gridRows(order,grid){ const rowsMap={}; order.forEach(id=>{ const p=grid[id]||{r:999,c:1}; const r=p.r||1; (rowsMap[r]=rowsMap[r]||[]).push({id:id,c:p.c||1}); }); const rns=Object.keys(rowsMap).map(Number).sort((a,b)=>a-b); return rns.map(rn=>({r:rn,cells:rowsMap[rn].slice().sort((a,b)=>(a.c||1)-(b.c||1))})); },
  cfSetGrid(key,id,which,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.entryGrid=c.entryGrid||{}; const cur=c.entryGrid[id]||{r:1,c:1}; let n=parseInt(val,10); if(isNaN(n)||n<0) n=0; if((which==='r'||which==='c')&&n<1) n=1; cur[which]=n; c.entryGrid[id]=cur; this.fmtTouch(); this.fmtBuilderRerender(); },
  fmtBuilderRerender(){ const b=this.curBiz(); const key=this.fmtForm; if(!key) return; const el=document.getElementById('efPrev'); if(el) el.innerHTML=this.entryBuilderHtml(b,key); },
  cfSetRefPrefix(key,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.refPrefix=String(val||'').replace(/\s+/g,'').toUpperCase().trim(); this.fmtTouch(); const h=document.getElementById('refPrefixHint'); if(h) h.textContent='New auto references: '+(c.refPrefix?(c.refPrefix+'-0001'):'1, 2, 3…'); },
  fmtTouch(){ const u=document.getElementById('fmtUpdateBtn'); if(u) u.disabled=false; const d=document.getElementById('fmtDiscardBtn'); if(d) d.disabled=false; const s=document.getElementById('fmtStatus'); if(s){ s.textContent='\u25CF Unsaved changes \u2014 click Update to apply'; s.style.color='var(--warn)'; } },
  sizeAttr(g){ if(!g) return ''; let s=''; if(g.w) s+='--iw:'+g.w+'px;'; if(g.h) s+='--ih:'+g.h+'px;'; let a=''; if(g.w) a+=' data-iw'; if(g.h) a+=' data-ih'; return (s?(' style="'+s+'"'):'')+a; },
  /* ----- line items ----- */
  blankLines(c){ return c.lines.kind==='journal' ? [{},{}] : [{}]; },
  lineCols(c){ if(c.lines.kind==='journal'){ const bb=this.openBiz?this.curBiz():null; const anyCtrl=(this._lines||[]).some(ln=>this.subClassForAccount(bb,ln.account));
      const cols=[{key:'account',label:'Account',csacct:1}];
      if(anyCtrl) cols.push({key:'sub',label:'Customer / Item / Member',csub:1,w:190});
      cols.push({key:'desc',label:'Description'},{key:'debit',label:'Debit',w:120,num:1},{key:'credit',label:'Credit',w:120,num:1});
      return cols; }
    if(c.lines.kind==='cash'){ const bb=this.openBiz?this.curBiz():null; const anyCtrl=(this._lines||[]).some(ln=>this.subClassForAccount(bb,ln.account));
      const cols=[{key:'account',label:'Account',csacct:1}];
      if(anyCtrl) cols.push({key:'sub',label:'Customer / Item / Member',csub:1,w:190});
      cols.push({key:'desc',label:'Description'},{key:'amount',label:'Amount',w:120,num:1},{key:'amt',label:'Total',w:120,calc:1});
      return cols; }
    if(c.lines.kind==='payslip') return [{key:'ptype',label:'Type',w:130,sel:['Earning','Deduction']},{key:'desc',label:'Description'},{key:'account',label:'Account',acct:1},{key:'amount',label:'Amount',w:120,num:1},{key:'amt',label:'Total',w:120,calc:1}];
    if(c.lines.kind==='depr'){ const b=this.openBiz?this.curBiz():null; const assets=((b&&b.records&&b.records.fixedAssets)||[]).map(a=>a.name).filter(Boolean);
      return [{key:'asset',label:'Fixed asset',assetsel:assets},{key:'cost',label:'Cost',w:120,ro:1},{key:'accDep',label:'Accumulated depreciation',w:160,ro:1},{key:'rate',label:'Rate %',w:84,rate:1},{key:'amount',label:'Depreciation',w:130,num:1}]; }
    const b=this.openBiz?this.curBiz():null; const codes=(b&&b.taxCodes)||defaultTaxCodes();
    const cols=[];
    if(this._showLineNum) cols.push({key:'_ln',label:'#',w:32,ln:1});
    cols.push({key:'item',label:'Item',item:1});
    cols.push({key:'account',label:'Account',acct:1});
    if(this._showDesc) cols.push({key:'desc',label:'Description',wrap:1});
    cols.push({key:'qty',label:'Qty',w:90,num:1,unit:1},{key:'price',label:'Unit price',w:100,num:1},
       {key:'amount',label:'Amount (without TAX)',w:120,netcalc:1},
       {key:'tax',label:'Tax Code',w:110,ph:'No tax',sel:[''].concat(codes.map(t=>t.name))},
       {key:'taxAmt',label:'Tax Amount',w:100,taxcalc:1},
       {key:'lineTotal',label:'Total with vat',w:120,grosscalc:1});
    ((this.formCfg(b,LABEL2KEY[this.wsSection])||{}).custom||[]).filter(x=>x.type==='line').forEach(x=>cols.push({key:x.key,label:x.label||'Custom',w:x.w||130,cf:x}));
    return cols; },
  taxRate(tc){ const b=this.openBiz?this.curBiz():null; const codes=(b&&b.taxCodes)||[]; const f=codes.find(c=>c.name===tc); if(f) return (+f.rate||0); return ({'VAT 5%':5,'VAT 10%':10})[tc]||0; },
  lineAmount(ln){ const c=this.cfg(); if(c&&c.lines){ if(c.lines.kind==='cash'||c.lines.kind==='depr') return this.parseNum(ln.amount)||0; if(c.lines.kind==='payslip'){ const a=this.parseNum(ln.amount)||0; return ln.ptype==='Deduction'?-a:a; } } return (this.parseNum(ln.qty)||0)*(this.parseNum(ln.price)||0); },
  cashTotals(){ let s=0; this._lines.forEach(ln=>{ s+=this.parseNum(ln.amount)||0; }); return {total:s}; },
  payslipTotals(){ let earn=0,ded=0; this._lines.forEach(ln=>{ const a=this.parseNum(ln.amount)||0; if(ln.ptype==='Deduction') ded+=a; else earn+=a; }); return {earn,ded,net:earn-ded}; },
  nextRef(b,key){ const recs=(b&&b.records&&b.records[key])||[]; let max=0; recs.forEach(r=>{ const m=String(r.reference||'').match(/(\d+)\s*$/); if(m){ const n=parseInt(m[1],10); if(!isNaN(n)&&n>max) max=n; } }); const c=(b&&b.formConfig&&b.formConfig[key])||{}; const pre=String(c.refPrefix||'').trim(); return pre ? (pre+'-'+String(max+1).padStart(4,'0')) : String(max+1); },
  refFieldHtml(b,key,val){ const next=this.nextRef(b,key); this._nextRef=next; const ro=(this.editingId==null && !val); const shown=ro?'':(val||'');
    return '<label class="fld">Reference</label>'+
      '<div style="display:inline-flex;align-items:stretch">'+
        '<span style="display:flex;align-items:center;padding:6px 10px;background:#e9ecef;border:1px solid #ced4da;border-radius:4px 0 0 4px">'+
          '<input type="checkbox" id="f_refAuto"'+(ro?' checked':'')+' onchange="App.refAutoToggle(this.checked)" title="Automatic numbering" style="width:13px;height:13px;margin:0;cursor:pointer">'+
        '</span>'+
        '<input id="f_reference" type="text" placeholder="Automatic"'+(ro?' readonly':'')+' value="'+this.esc(shown)+'" style="width:120px!important;max-width:120px!important;text-align:center;padding:6px 10px;border:1px solid #ced4da;border-left:0;border-radius:0 4px 4px 0;background:#fff;color:#212529">'+
      '</div>'; },
  refAutoToggle(on){ const inp=document.getElementById('f_reference'); if(!inp) return; if(on){ inp.value=''; inp.readOnly=true; } else { inp.readOnly=false; inp.focus(); } },
  refModeChange(mode){ this.refAutoToggle(mode==='auto'); },
  cashNameControl(b,type,nameKey,val){ const e=s=>this.esc(s); val=val||'';
    const FROM={Customer:'customers',Supplier:'suppliers',Employee:'employees','Capital account':'capital'};
    if(FROM[type]){ const from=FROM[type]; const word=type.toLowerCase(); let opts=this.refOptions(b,from);
      if(val && opts.indexOf(val)<0) opts=[val].concat(opts);
      if(opts.length) return '<select id="f_'+nameKey+'" style="width:100%"><option value="">— select '+word+' —</option>'+opts.map(o=>'<option'+(String(val)===String(o)?' selected':'')+'>'+e(o)+'</option>').join('')+'</select>';
      return '<input id="f_'+nameKey+'" type="text" style="width:100%" placeholder="No '+word+'s yet — type a name" value="'+e(val)+'">'; }
    return '<input id="f_'+nameKey+'" type="text" style="width:100%" placeholder="Optional" value="'+e(val)+'">'; },
  cashContactChange(nameKey,type){ const w=document.getElementById('cashNameWrap'); if(w) w.innerHTML=this.cashNameControl(this.curBiz(),type,nameKey,''); },
  cashFormFields(b,rec){ const isR=LABEL2KEY[this.wsSection]==='receipts';
    const typeKey=isR?'paidByType':'payeeType', nameKey=isR?'paidBy':'payee', acctKey=isR?'receivedIn':'paidFrom';
    const contactLabel=isR?'Received from':'Paid to', acctLabel=isR?'Received in':'Paid from';
    const v=k=>rec&&rec[k]!=null?rec[k]:''; const e=s=>this.esc(s);
    const typeVal=v(typeKey)||'Customer'; const typeOpts=['Customer','Supplier','Others'];
    const bankOpts=this.refOptions(b,'bankCash'); const acctVal=v(acctKey);
    const acctSel = bankOpts.length
      ? '<select id="f_'+acctKey+'"><option value="">— none —</option>'+(acctVal&&!bankOpts.includes(acctVal)?'<option selected>'+e(acctVal)+'</option>':'')+bankOpts.map(o=>'<option'+(String(acctVal)===String(o)?' selected':'')+'>'+e(o)+'</option>').join('')+'</select>'
      : '<input id="f_'+acctKey+'_txt" type="text" placeholder="Add a bank or cash account first" value="'+e(acctVal)+'">';
    return '<label class="fld">Date *</label><input id="f_date" type="date" value="'+e(v('date'))+'">'+
        this.refFieldHtml(b, LABEL2KEY[this.wsSection], v('reference'))+
      '<label class="fld" style="margin-top:14px">'+contactLabel+' <span style="color:#aaa;font-weight:400">— shown on the document only</span></label>'+
      '<div class="frm-inline">'+
        '<select id="f_'+typeKey+'" style="width:150px" onchange="App.cashContactChange(\''+nameKey+'\',this.value)">'+typeOpts.map(o=>'<option'+(typeVal===o?' selected':'')+'>'+o+'</option>').join('')+'</select>'+
        '<span id="cashNameWrap" style="flex:1;min-width:180px">'+this.cashNameControl(b,typeVal,nameKey,v(nameKey))+'</span>'+
      '</div>'+
      '<div class="frm-sec">'+acctLabel+'</div>'+
      '<div class="frm-inline"><span class="fld-inline">Account</span>'+acctSel+'</div>'+
      '<div style="color:#888;font-size:12px;margin-top:8px">Tip: to affect a customer, supplier, capital, employee, inventory or fixed-asset ledger, choose that control account on a line below, then pick the name.</div>'+
      '<label class="fld" style="margin-top:14px">Description</label><input id="f_description" type="text" value="'+e(v('description'))+'">'; },
  linesTableHtml(c){
    const cols=this.lineCols(c); const b=this.openBiz?this.curBiz():null; const aopts=this.accountOptions(b);
    const head='<tr>'+cols.map(col=>'<th'+(col.w?' style="width:'+col.w+'px"':'')+((col.num||col.calc||col.netcalc||col.grosscalc||col.taxcalc)?' class="r"':'')+'>'+this.esc(col.label)+'</th>').join('')+'<th style="width:28px"></th></tr>';
    const body=this._lines.map((ln,i)=>'<tr>'+cols.map(col=>{
      if(col.ln) return '<td class="r" data-ln="'+i+'" style="color:#999">'+(i+1)+'</td>';
      if(col.calc) return '<td class="r m" data-lc="'+i+'">'+this.money(this.lineAmount(ln))+'</td>';
      if(col.netcalc) return '<td class="r m" data-net="'+i+'">'+this.money(this.lineNet(ln))+'</td>';
      if(col.grosscalc) return '<td class="r m" data-gross="'+i+'" style="font-weight:600">'+this.money(this.lineGross(ln))+'</td>';
      if(col.taxcalc) return '<td class="r m" data-tax="'+i+'" style="color:#666">'+this.money(this.lineTax(ln))+'</td>';
      const v=ln[col.key]==null?'':ln[col.key];
      if(col.wrap) return '<td><textarea rows="1" class="li-wrap" oninput="App.lineInput('+i+',\''+col.key+'\',this.value)">'+this.esc(v)+'</textarea></td>';
      if(col.csacct){ const found=aopts.some(o=>String(o.id)===String(v)); const extra=(v&&!found)?'<option value="'+this.esc(v)+'" selected>'+this.esc(v)+'</option>':'';
        return '<td><select onchange="App.cashAcctChange('+i+',this.value)"><option value="">— account —</option>'+extra+aopts.map(o=>'<option value="'+o.id+'"'+(String(v)===String(o.id)?' selected':'')+'>'+this.esc(o.label)+'</option>').join('')+'</select></td>'; }
      if(col.csub){ const cls=this.subClassForAccount(b,ln.account);
        if(!cls) return '<td style="text-align:center;color:#ccc">—</td>';
        const label={customers:'customer',suppliers:'supplier',capital:'capital account',employees:'employee',inventory:'item',fixedAssets:'fixed asset'}[cls]; let opts=this.refOptions(b,cls); const sv=ln.sub||''; if(sv&&opts.indexOf(sv)<0) opts=[sv].concat(opts);
        return '<td><select onchange="App.lineInput('+i+',\'sub\',this.value)"><option value="">— '+label+' —</option>'+opts.map(o=>'<option'+(String(sv)===String(o)?' selected':'')+'>'+this.esc(o)+'</option>').join('')+'</select></td>'; }
      if(col.assetsel){ const names=col.assetsel; const found=names.indexOf(v)>=0; const extra=(v&&!found)?'<option selected>'+this.esc(v)+'</option>':'';
        return '<td><select onchange="App.deprPick('+i+',this.value)"><option value="">— fixed asset —</option>'+extra+names.map(n=>'<option'+(String(v)===String(n)?' selected':'')+'>'+this.esc(n)+'</option>').join('')+'</select></td>'; }
      if(col.ro) return '<td class="r m" style="color:#555;background:#fafafa">'+this.money(ln[col.key]||0)+'</td>';
      if(col.rate) return '<td><input type="text" inputmode="decimal" class="r" value="'+this.esc(v)+'" onchange="App.deprRate('+i+',this.value)"></td>';
      if(col.acct){ const found=aopts.some(o=>String(o.id)===String(v)); const extra=(v&&!found)?'<option value="'+this.esc(v)+'" selected>'+this.esc(v)+'</option>':'';
        return '<td><select onchange="App.lineInput('+i+',\''+col.key+'\',this.value)"><option value="">— account —</option>'+extra+aopts.map(o=>'<option value="'+o.id+'"'+(String(v)===String(o.id)?' selected':'')+'>'+this.esc(o.label)+'</option>').join('')+'</select></td>'; }
      if(col.item){ const inv=(b&&b.records&&b.records.inventory)||[]; const names=inv.map(it=>it.name).filter(Boolean);
        if(names.length){ const found=names.indexOf(v)>=0; const extra=(v&&!found)?'<option selected>'+this.esc(v)+'</option>':'';
          return '<td><select onchange="App.itemPick('+i+',this.value)"><option value="">— item —</option>'+extra+names.map(n=>'<option'+(String(v)===String(n)?' selected':'')+'>'+this.esc(n)+'</option>').join('')+'</select></td>'; }
        return '<td><input type="text" placeholder="Item / description" value="'+this.esc(v)+'" oninput="App.lineInput('+i+',\'item\',this.value)"></td>'; }
      if(col.unit){ const unit=ln.unit?'<span class="li-unit">'+this.esc(ln.unit)+'</span>':'';
        return '<td><div class="li-qty"><input type="text" inputmode="decimal" class="r" value="'+this.esc(v)+'" oninput="App.lineInput('+i+',\''+col.key+'\',this.value)">'+unit+'</div></td>'; }
      if(col.cf){ const cf=col.cf;
        if(cf.dataType==='formula'){ var _ts=0; try{_ts=this.invoiceTotals().sub;}catch(_e){_ts=0;} return '<td class="r m" data-cff="'+i+':'+col.key+'" style="color:#555;background:#fafafa">'+this.money(this.evalCustomFormula(cf,{subtotal:_ts,qty:this.parseNum(ln.qty)||0,price:this.parseNum(ln.price)||0,taxAmt:this.lineTax(ln),total:this.lineAmount(ln),amount:this.lineAmount(ln),cf:k=>this.parseNum(ln[k])||0}))+'</td>'; }
        if(cf.dataType==='select'||(cf.dataType==='text'&&cf.textType==='dropdown')){ const opts=cf.options||[]; const sv=ln[col.key]||''; const found=opts.indexOf(sv)>=0; return '<td><select onchange="App.lineInput('+i+',\''+col.key+'\',this.value)"><option value=""></option>'+((sv&&!found)?'<option selected>'+this.esc(sv)+'</option>':'')+opts.map(o=>'<option'+(String(sv)===String(o)?' selected':'')+'>'+this.esc(o)+'</option>').join('')+'</select></td>'; }
        if(cf.dataType==='number'){ return '<td><input type="text" inputmode="decimal" class="r" value="'+this.esc(v)+'" oninput="App.lineInput('+i+',\''+col.key+'\',this.value)"></td>'; }
        return '<td><input type="text" value="'+this.esc(v)+'" oninput="App.lineInput('+i+',\''+col.key+'\',this.value)"></td>'; }
      if(col.sel) return '<td><select onchange="App.lineInput('+i+',\''+col.key+'\',this.value)">'+col.sel.map(o=>'<option value="'+this.esc(o)+'"'+(String(v)===String(o)?' selected':'')+'>'+(o===''?(col.ph||'—'):this.esc(o))+'</option>').join('')+'</select></td>';
      return '<td><input type="text"'+(col.num?' inputmode="decimal" class="r"':'')+' value="'+this.esc(v)+'" oninput="App.lineInput('+i+',\''+col.key+'\',this.value)"></td>';
    }).join('')+'<td><button class="li-x" onclick="App.removeLine('+i+')" title="Remove line">✕</button></td></tr>').join('');
    return '<table class="li-tbl"><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
  },
  itemPick(i,name){ const b=this.curBiz(); this._lines[i].item=name;
    const it=((b.records&&b.records.inventory)||[]).find(x=>x.name===name);
    if(it){ const isPurch=this.purchaseDoc();
      const px=isPurch?it.purchasePrice:it.salesPrice; if(px!=null&&px!=='') this._lines[i].price=px;
      this._lines[i].unit=it.unit||'';
      const acct=findAcct(b, isPurch?'Inventory on hand':'Inventory - sales');
      if(acct) this._lines[i].account=acct.id;
      else { const root=isPurch?'assets':'income'; const cands=(b.coa||[]).filter(n=>n.type==='account'&&acctRoot(b,n)===root); if(cands.length) this._lines[i].account=cands[0].id; } }
    else { this._lines[i].unit=''; }
    this.refreshLines(); },
  deprPick(i,name){ const b=this.curBiz(); const ln=this._lines[i]; ln.asset=name;
    const a=((b.records&&b.records.fixedAssets)||[]).find(x=>x.name===name);
    if(a){ ln.cost=Number(a.cost)||0; ln.accDep=faAccumDepExcl(b,a,this.editingId); }
    else { ln.cost=0; ln.accDep=0; }
    this.applyDeprRate(i); this.refreshLines(); },
  applyDeprRate(i){ const ln=this._lines[i]; const rate=this.parseNum(ln.rate)||0; if(!rate) return;
    const me=document.getElementById('f_method'); const meth=me?me.value:(this._deprMethod||'Reducing balance');
    const base=(meth==='Straight-line')?(Number(ln.cost)||0):((Number(ln.cost)||0)-(Number(ln.accDep)||0));
    ln.amount=Math.round(base*rate/100*100)/100; },
  deprMethodChange(v){ this._deprMethod=v; for(let i=0;i<this._lines.length;i++) this.applyDeprRate(i); this.refreshLines(); },
  deprRate(i,val){ this._lines[i].rate=val; this.applyDeprRate(i); this.refreshLines(); },
  subClassForAccount(b,acctId){ if(!acctId||!b) return null; const n=acctById(b,acctId); if(!n) return null; const nm=n.name||'';
    if(/^accounts receivable$/i.test(nm)) return 'customers'; if(/^accounts payable$/i.test(nm)) return 'suppliers';
    if(/^capital accounts$/i.test(nm)) return 'capital'; if(/^employee clearing account$/i.test(nm)) return 'employees';
    if(/^inventory on hand$/i.test(nm)) return 'inventory'; if(/^fixed assets, at cost$/i.test(nm)) return 'fixedAssets'; return null; },
  cashAcctChange(i,val){ const ln=this._lines[i]; ln.account=val; ln.sub=''; this.refreshLines(); },
  invCostOfSales(r){ return invoiceCogs(this.curBiz(), r.id); },
  /* balanceDue is kept up to date by syncInvoiceBalances() from the payments and
     allocations actually posted, so the badge follows the ledger. Overdue still
     wins over Partially paid — being past due is a fact about the date, and the
     ageing reports read this status. */
  invStatus(r){ if(r.statusOverride) return r.statusOverride;
    const tot=(Number(r.total)||0)-(r.withholding?(Number(r.withholdingAmt||r.whtAmount)||0):0);   /* withholding is not owed by the customer */ const bal=Number(r.balanceDue!=null?r.balanceDue:tot)||0;
    if(bal<=0.005) return 'Paid';
    if(r.dueDate){ const due=new Date(r.dueDate); const today=new Date(); today.setHours(0,0,0,0); if(due<today) return 'Overdue'; }
    if(tot>0.005 && bal<tot-0.005) return 'Partially paid';
    return 'Unpaid'; },
  toggleInvInc(v){ this._invInc=!!v; this.recomputeLines(); },
  toggleDescCol(v){ this._showDesc=!!v; this.refreshLines(); },
  toggleLineNum(v){ this._showLineNum=!!v; this.refreshLines(); },
  dueTypeChange(v){ const w=document.getElementById('dueCtl'); if(w) w.innerHTML=this.dueDateControl(v,{}); },
  partyChange(name){ const b=this.curBiz(); if(!b) return; const isP=this.purchaseDoc(); const from=isP?'suppliers':'customers';
    const rec=((b.records&&b.records[from])||[]).find(r=>String(r.name)===String(name)); if(!rec) return;
    const ta=document.getElementById('f_billingAddress'); if(!ta) return;
    const addr=String(rec.address||'').trim(); const trn=String(rec.trn||'').trim();
    let composed=addr; if(trn) composed+=(addr?'\n\n':'')+'TRN: '+trn;
    if(composed) ta.value=composed; },
  dueDateControl(type,rec){ const e=s=>this.esc(s); const v=k=>rec&&rec[k]!=null?rec[k]:'';
    if(type==='By') return '<input id="f_dueDateManual" type="date" value="'+e(v('dueDateManual'))+'">';
    const dd=(v('dueDays')!==''&&v('dueDays')!=null)?v('dueDays'):15;
    return '<span class="frm-inline" style="gap:6px"><input id="f_dueDays" type="number" step="1" style="width:74px;flex:none" value="'+e(dd)+'"><span class="fld-inline" style="min-width:0">days</span></span>'; },
  invoiceFormFields(b,rec){ const isP=this.purchaseDoc(); const isNew=this.editingId==null;
    const partyKey=isP?'supplier':'customer', partyFrom=isP?'suppliers':'customers', partyLabel=isP?'Supplier':'Customer';
    const v=k=>rec&&rec[k]!=null?rec[k]:''; const e=s=>this.esc(s);
    const dueType=v('dueType')||'Net';
    let partyOpts=this.refOptions(b,partyFrom); const pv=v(partyKey); if(pv&&partyOpts.indexOf(pv)<0) partyOpts=[pv].concat(partyOpts);
    const partySel = partyOpts.length
      ? '<select id="f_'+partyKey+'" style="min-width:240px"><option value="">— select '+partyLabel.toLowerCase()+' —</option>'+partyOpts.map(o=>'<option'+(String(pv)===String(o)?' selected':'')+'>'+e(o)+'</option>').join('')+'</select>'
      : '<input id="f_'+partyKey+'_txt" type="text" placeholder="Add a '+partyLabel.toLowerCase()+' first" value="'+e(pv)+'">';
    return '<div class="frm-row3">'+
        '<div><label class="fld">Issue date *</label><input id="f_issueDate" type="date" value="'+e(v('issueDate'))+'"></div>'+
        '<div><label class="fld">Due date</label><div class="frm-inline">'+
          '<select id="f_dueType" style="width:74px;flex:none" onchange="App.dueTypeChange(this.value)"><option'+(dueType==='Net'?' selected':'')+'>Net</option><option'+(dueType==='By'?' selected':'')+'>By</option></select>'+
          '<span id="dueCtl" style="flex:1">'+this.dueDateControl(dueType,rec)+'</span></div></div></div>'+
        this.refFieldHtml(b, LABEL2KEY[this.wsSection], v('reference'))+
      '<div class="frm-sec">'+partyLabel+'</div><div class="frm-inline">'+partySel+'</div>'+
      '<label class="fld" style="margin-top:14px">'+(isP?'Supplier address':'Billing address')+'</label><textarea id="f_billingAddress" rows="3">'+e(v('billingAddress'))+'</textarea>'+
      '<label class="fld" style="margin-top:14px">Description</label><input id="f_description" type="text" placeholder="Optional" value="'+e(v('description'))+'">'+
      this.customFieldsEntryHtml(b, LABEL2KEY[this.wsSection], rec); },
  customFieldsEntryHtml(b,key,rec){ const list=((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='field'); if(!list.length) return ''; const e=s=>this.esc(s);
    let t; try{ t=this.invoiceTotals(); }catch(_){ t={sub:Number(rec.subtotal)||0,tax:Number(rec.tax)||0,total:Number(rec.total)||0}; }
    let q=0,pr=0; (this._lines||[]).forEach(l=>{ q+=this.parseNum(l.qty)||0; pr+=this.parseNum(l.price)||0; });
    let h='<div class="frm-sec">Custom fields</div>';
    list.forEach(x=>{ const lbl=e(x.label||'Custom field'); const def=(rec&&rec.custom&&rec.custom[x.key]!=null)?rec.custom[x.key]:(x.value||''); let inp;
      if(x.dataType==='formula'){ const val=this.money(this.evalCustomFormula(x,{subtotal:t.sub,qty:q,price:pr,taxAmt:t.tax,tax:t.tax,total:t.total,cf:k=>this.parseNum(rec&&rec.custom&&rec.custom[k])||0})); inp='<input id="f_cfdisp_'+x.key+'" type="text" readonly value="'+val+'" title="Calculated automatically" style="background:#fafafa;color:#555;max-width:240px">'; }
      else inp=this.cfEntryInput(x,'f_cf_'+x.key,def,(x.dataType==='number')?'oninput="App.recomputeLines()"':'');
      h+='<label class="fld" style="margin-top:10px">'+lbl+(x.dataType==='formula'?' <span style="color:#999;font-weight:400;font-size:11px">(calculated)</span>':'')+'</label>'+inp; });
    return h; },
  purchaseDoc(){ return ['purchInv','purchQuotes','purchOrders','debitNotes','goodsRec'].indexOf(LABEL2KEY[this.wsSection])>=0; },
  invoiceOptions(b,rec){ const isNew=this.editingId==null; const e=s=>this.esc(s); const isP=this.purchaseDoc();
    const ckOn=(k,def)=>{ const val=rec&&rec[k]; if(val!=null) return !!val; return isNew?!!def:false; };
    const ctv=(rec&&rec.customTitle!=null&&rec.customTitle!=='')?rec.customTitle:((isNew&&LABEL2KEY[this.wsSection]==='salesInv')?'TAX INVOICE':'');
    const disc=(rec&&rec.disclaimer!=null&&rec.disclaimer!=='')?rec.disclaimer:(isNew?'This is a computer generated invoice and does not need any signature.':'');
    const bank=(rec&&rec.bankDetails!=null)?rec.bankDetails:'';
    const cb=(key,label,def,onch)=>'<label class="chk-row"><input type="checkbox" id="f_'+key+'"'+(ckOn(key,def)?' checked':'')+(onch?' onchange="'+onch+'"':'')+'> '+label+'</label>';
    const ctOn=ckOn('customTitleOn',isNew); const cthOn=ckOn('customThemeOn',false);
    let opts='<div class="inv-opts">'+
      cb('colLineNum','Column — Line number',true,'App.toggleLineNum(this.checked)')+
      cb('showDescCol','Column — Description',true,'App.toggleDescCol(this.checked)')+
      cb('colDiscount','Column — Discount',false)+
      cb('taxInclusive','Amounts are tax inclusive',false,'App.toggleInvInc(this.checked)')+
      cb('rounding','Rounding',false)+
      (isP?'':cb('earlyPay','Early payment discount',false))+
      (isP?'':cb('lateFees','Late payment fees',false))+
      cb('totalBase','Total amount in base currency',false)+
      '<label class="chk-row"><input type="checkbox" id="f_customTitleOn"'+(ctOn?' checked':'')+' onchange="App.onCheckToggle(\'customTitleOn\',this.checked)"> Custom title</label>'+
      '<div class="fld-wrap" data-showif="customTitleOn"'+(ctOn?'':' style="display:none"')+'><input id="f_customTitle" type="text" placeholder="Invoice" value="'+e(ctv)+'"></div>'+
      '<label class="chk-row"><input type="checkbox" id="f_customThemeOn"'+(cthOn?' checked':'')+' onchange="App.onCheckToggle(\'customThemeOn\',this.checked)"> Custom theme</label>'+
      '<div class="fld-wrap" data-showif="customThemeOn"'+(cthOn?'':' style="display:none"')+'><select id="f_customTheme"><option>New Sales Theme</option></select></div>'+
      cb('hideDueDate','Hide — Due date',false)+
      cb('hideBalanceDue','Hide — Balance due',false)+
      cb('showItemImages','Show item images',false)+
      cb('showTaxCol','Show tax amount column',true)+
      (isP?'':cb('printStatus','Print paid / unpaid status tag',false))+
      cb('amountInWords','Amount in words',true)+
      (isP?'':cb('alsoDelivery','Also acts as delivery note',false))+
      cb('footers','Footers',false)+
    '</div>';
    const img='<div class="inv-cf" style="margin-top:14px"><div class="inv-cf-lbl" style="font-size:12px;color:#666;margin-bottom:6px">Image</div><input type="file" accept="image/*" disabled style="opacity:.6"></div>';
    return opts+img; },
  invoiceTotals(){ const inc=!!this._invInc; let sub=0,tax=0,total=0;
    this._lines.forEach(ln=>{ const a=this.lineAmount(ln); const r=this.taxRate(ln.tax)/100;
      if(inc){ const t=r?a*r/(1+r):0; total+=a; tax+=t; sub+=a-t; }
      else { sub+=a; tax+=a*r; total+=a*(1+r); } });
    return {sub,tax,total}; },
  journalTotals(){ let d=0,cr=0; this._lines.forEach(ln=>{ d+=this.parseNum(ln.debit)||0; cr+=this.parseNum(ln.credit)||0; }); return {debit:d,credit:cr,diff:d-cr}; },
  linesTotalsHtml(c){
    if(c.lines.kind==='cash'){ const t=this.cashTotals();
      return '<div class="li-tot"><div class="grand"><span>Total</span><b class="num">'+this.money(t.total)+'</b></div></div>'; }
    if(c.lines.kind==='payslip'){ const t=this.payslipTotals();
      return '<div class="li-tot"><div><span>Earnings</span><b class="num">'+this.money(t.earn)+'</b></div>'+
        '<div><span>Deductions</span><b class="num">'+this.money(t.ded)+'</b></div>'+
        '<div class="grand"><span>Net pay</span><b class="num">'+this.money(t.net)+'</b></div></div>'; }
    if(c.lines.kind==='depr'){ const t=this.cashTotals();
      return '<div class="li-tot"><div class="grand"><span>Total depreciation</span><b class="num">'+this.money(t.total)+'</b></div></div>'; }
    if(c.lines.kind==='invoice'){ const t=this.invoiceTotals();
      if(this._invInc) return '<div class="li-tot"><div class="grand"><span>Total</span><b class="num">'+this.money(t.total)+'</b></div><div><span>Includes tax</span><b class="num">'+this.money(t.tax)+'</b></div></div>';
      return '<div class="li-tot"><div><span>Subtotal</span><b class="num">'+this.money(t.sub)+'</b></div>'+
        '<div><span>Tax</span><b class="num">'+this.money(t.tax)+'</b></div>'+
        '<div class="grand"><span>Total</span><b class="num">'+this.money(t.total)+'</b></div></div>'; }
    const j=this.journalTotals();
    return '<div class="li-tot"><div><span>Total debits</span><b class="num">'+this.money(j.debit)+'</b></div>'+
      '<div><span>Total credits</span><b class="num">'+this.money(j.credit)+'</b></div>'+
      (Math.abs(j.diff)>0.005?'<div class="grand oob"><span>Out of balance</span><b class="num">'+this.money(j.diff)+'</b></div>':'<div class="grand ok"><span>Balanced</span><b>✓</b></div>')+'</div>';
  },
  lineInput(i,key,val){ this._lines[i][key]=val; this.recomputeLines(); },
  lineTax(ln){ const gross=this.lineAmount(ln); const r=this.taxRate(ln.tax)/100; if(!r) return 0; return this._invInc? gross*r/(1+r) : gross*r; },
  lineNet(ln){ const gross=this.lineAmount(ln); const r=this.taxRate(ln.tax)/100; return this._invInc ? (r?gross/(1+r):gross) : gross; },
  lineGross(ln){ const gross=this.lineAmount(ln); const r=this.taxRate(ln.tax)/100; return this._invInc ? gross : gross*(1+r); },
  recomputeLines(){ const c=this.cfg();
    if(c.lines.kind==='invoice'||c.lines.kind==='cash'||c.lines.kind==='payslip'||c.lines.kind==='depr'){ this._lines.forEach((ln,i)=>{ const el=document.querySelector('[data-lc="'+i+'"]'); if(el) el.textContent=this.money(this.lineAmount(ln)); const tx=document.querySelector('[data-tax="'+i+'"]'); if(tx) tx.textContent=this.money(this.lineTax(ln)); const nt=document.querySelector('[data-net="'+i+'"]'); if(nt) nt.textContent=this.money(this.lineNet(ln)); const gr=document.querySelector('[data-gross="'+i+'"]'); if(gr) gr.textContent=this.money(this.lineGross(ln)); }); }
    if(c.lines.kind==='invoice'){ const b=this.curBiz(); const key=LABEL2KEY[this.wsSection]; const cfL=((this.formCfg(b,key)||{}).custom||[]); const t=this.invoiceTotals();
      this._lines.forEach((ln,i)=>{ cfL.filter(x=>x.type==='line'&&x.dataType==='formula').forEach(x=>{ const el=document.querySelector('[data-cff="'+i+':'+x.key+'"]'); if(el) el.textContent=this.money(this.evalCustomFormula(x,{subtotal:t.sub,qty:this.parseNum(ln.qty)||0,price:this.parseNum(ln.price)||0,taxAmt:this.lineTax(ln),total:this.lineAmount(ln),amount:this.lineAmount(ln),cf:k=>this.parseNum(ln[k])||0})); }); });
      let q=0,pr=0; this._lines.forEach(l=>{ q+=this.parseNum(l.qty)||0; pr+=this.parseNum(l.price)||0; });
      const dctx={subtotal:t.sub,qty:q,price:pr,taxAmt:t.tax,tax:t.tax,total:t.total,cf:k=>{ const el=document.getElementById('f_cf_'+k); return el?(this.parseNum(el.value)||0):0; }};
      cfL.filter(x=>x.type==='field'&&x.dataType==='formula').forEach(x=>{ const el=document.getElementById('f_cfdisp_'+x.key); if(el) el.value=this.money(this.evalCustomFormula(x,dctx)); }); }
    const tt=document.getElementById('linesTotals'); if(tt) tt.innerHTML=this.linesTotalsHtml(c); },
  refreshLines(){ const w=document.getElementById('linesWrap'); if(w) w.innerHTML=this.linesTableHtml(this.cfg()); this.recomputeLines(); },
  addLine(n){ n=n||1; for(let i=0;i<n;i++) this._lines.push({}); this.refreshLines(); },
  removeLine(i){ this._lines.splice(i,1); if(!this._lines.length) this._lines.push({}); this.refreshLines(); },
  fieldValue(f){
    const el=document.getElementById('f_'+f.key);
    if(f.type==='ref'){ const txt=document.getElementById('f_'+f.key+'_txt'); if(el&&el.value) return el.value; if(txt) return txt.value.trim(); return ''; }
    if(f.type==='check') return el?!!el.checked:false;
    if(!el) return '';
    if(f.type==='money'||f.type==='number') return this.parseNum(el.value);
    return el.value.trim?el.value.trim():el.value;
  },
  onCheckToggle(key,checked){ document.querySelectorAll('[data-showif="'+key+'"]').forEach(el=>{ el.style.display=checked?'':'none'; }); },
  uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }); },
  saveRecord(){
    const b=this.curBiz(), c=this.cfg();
    const data={};
    for(const f of c.form){ const v=this.fieldValue(f);
      if(f.req && (v===''||v==null)){ alert(f.label+' is required.'); const el=document.getElementById('f_'+f.key); if(el)el.focus(); return; }
      data[f.key]=v; }
    const _dcf=((this.formCfg(b,LABEL2KEY[this.wsSection])||{}).custom||[]).filter(x=>x.type==='field'&&x.dataType!=='formula');
    if(_dcf.length){ data.custom={}; _dcf.forEach(x=>{ const el=document.getElementById('f_cf_'+x.key); data.custom[x.key]=el?el.value:''; }); }
    if(c.lines){
      const cols=this.lineCols(c);
      const lines=this._lines.filter(ln=>cols.some(col=>!col.calc && String(ln[col.key]==null?'':ln[col.key]).trim()!==''));
      if(c.lines.kind==='cash'){
        data.lines=lines.map(ln=>({account:ln.account||'',sub:ln.sub||'',desc:ln.desc||'',amount:this.parseNum(ln.amount)}));
        const total=data.lines.reduce((a,ln)=>a+(Number(ln.amount)||0),0);
        data.amount=total; data.subtotal=total; data.tax=0;
      } else if(c.lines.kind==='payslip'){
        data.lines=lines.map(ln=>({ptype:ln.ptype==='Deduction'?'Deduction':'Earning',desc:ln.desc||'',account:ln.account||'',amount:this.parseNum(ln.amount)}));
        const t=this.payslipTotals(); data.earnings=t.earn; data.deductions=t.ded; data.netPay=t.net; data.total=t.net;
      } else if(c.lines.kind==='depr'){
        data.lines=lines.map(ln=>({asset:ln.asset||'',cost:this.parseNum(ln.cost),accDep:this.parseNum(ln.accDep),rate:this.parseNum(ln.rate),amount:this.parseNum(ln.amount)}));
        data.amount=data.lines.reduce((a,ln)=>a+(Number(ln.amount)||0),0);
      } else if(c.lines.kind==='invoice'){
        const inc=!!this._invInc;
        const lf=((this.formCfg(b,LABEL2KEY[this.wsSection])||{}).custom||[]).filter(x=>x.type==='line');
        data.lines=lines.map(ln=>{ const gross=this.lineAmount(ln); const r=this.taxRate(ln.tax)/100;
          const net=inc?(r?gross/(1+r):gross):gross; const taxAmt=inc?(gross-net):(gross*r);
          const o={item:ln.item||'',account:ln.account||'',desc:ln.desc||'',qty:this.parseNum(ln.qty),price:this.parseNum(ln.price),tax:ln.tax||'',unit:ln.unit||'',amount:gross,net:net,taxAmt:taxAmt};
          lf.forEach(x=>{ o[x.key]=ln[x.key]||''; }); return o; });
        const t=this.invoiceTotals();
        data.subtotal=t.sub; data.tax=t.tax; data.total=t.total; data.taxInclusive=inc; data.costOfSales=0; data.balanceDue=t.total;
        const _pb=document.getElementById('f_printBankDetails'); if(_pb) data.printBankDetails=!!_pb.checked;
        const _pd=document.getElementById('f_printDisclaimer'); if(_pd) data.printDisclaimer=!!_pd.checked;
        if(data.dueType==='By'){ data.dueDate=data.dueDateManual||''; }
        else if(data.dueDays!==''&&data.dueDays!=null&&data.issueDate){ const dt=new Date(data.issueDate); if(!isNaN(dt)){ dt.setDate(dt.getDate()+(Number(data.dueDays)||0)); data.dueDate=dt.toISOString().slice(0,10); } }
        if(data.reference===''||data.reference==null){ const _rc=document.getElementById('f_refAuto'); if(_rc&&_rc.checked) data.reference=this.nextRef(b,LABEL2KEY[this.wsSection]); }
      } else {
        const j=this.journalTotals();
        if(Math.abs(j.diff)>0.005 && !this._ask('Debits ('+this.money(j.debit)+') and credits ('+this.money(j.credit)+') are out of balance by '+this.money(Math.abs(j.diff))+'.\n\nManager requires journal entries to balance. Save anyway?',()=>this.saveRecord())) return;
        data.lines=lines.map(ln=>({account:ln.account||'',sub:ln.sub||'',desc:ln.desc||'',debit:this.parseNum(ln.debit),credit:this.parseNum(ln.credit)}));
        data.debit=j.debit; data.credit=j.credit;
      }
    }
    let arr=this.records(b).slice();
    if(this.editingId!=null){ const i=arr.findIndex(r=>r.id===this.editingId); if(i>=0) arr[i]={...arr[i],...data}; }
    else { data.id=Date.now()+Math.floor(Math.random()*1000); data.uuid=this.uuid(); arr.push(data); }
    const key=LABEL2KEY[this.wsSection];
    this.ensureControlsFor(b,key,data);
    this.setRecords(b,arr); refreshSummary(b); this.saveBiz(b); if(!this.backFromRecord()) this.backToList();
  },
  /* The control accounts a saved record of this kind needs to exist. Shared by
     the full-page register form and the quick-create dialog, so both paths
     create exactly the same chart-of-accounts entries. */
  ensureControlsFor(b,key,data){
    data=data||{};
    if(!b||!b.coa) return;
    if(key==='salesInv'){ ensureControl(b,'Accounts receivable','assets'); ensureControl(b,'Output VAT','liabilities'); }
    else if(key==='purchInv'){ ensureControl(b,'Accounts payable','liabilities'); ensureControl(b,'Input VAT','liabilities'); }
    else if(key==='creditNotes'){ ensureControl(b,'Accounts receivable','assets'); ensureControl(b,'Output VAT','liabilities'); }
    else if(key==='debitNotes'){ ensureControl(b,'Accounts payable','liabilities'); ensureControl(b,'Input VAT','liabilities'); }
    if(key==='bankCash') ensureCashControl(b);
    if(key==='receipts'||key==='payments'||key==='iat') ensureCashControl(b);
    if(key==='receipts' && data.customer) ensureControl(b,'Accounts receivable','assets');
    if(key==='payments' && data.supplier) ensureControl(b,'Accounts payable','liabilities');
    if(key==='payslips' || (key==='payments' && data.employee)) ensureControl(b,'Employee clearing account','liabilities');
    if(key==='customers') ensureControl(b,'Accounts receivable','assets');
    if(key==='suppliers') ensureControl(b,'Accounts payable','liabilities');
    if(key==='employees') ensureControl(b,'Employee clearing account','liabilities');
    if(key==='capital') ensureCapitalControl(b);
    if(key==='salesInv'||key==='purchInv'||key==='inventory') ensureInventoryAccounts(b);
    if(key==='fixedAssets'||key==='depreciation') ensureFixedAssetAccounts(b);
    if(key==='capital' || ((key==='receipts'||key==='payments') && data.capitalAcc)) ensureCapitalControl(b);
  },
  /* Create one register record without a DOM, using REG[key].form as the schema
     and the same required-field rule the full-page form applies. Returns
     {ok:true, record} or {ok:false, error} — the caller decides how to show it. */
  createEntityRecord(key,data){
    const b=this.curBiz(); if(!b) return {ok:false,error:'No business is open.'};
    if(this.isReadOnly(b)) return {ok:false,error:'Your access to this business is read only.'};
    const c=REG[key]; if(!c) return {ok:false,error:'Unknown record type.'};
    const rec={};
    for(const f of (c.form||[])){
      let v=data[f.key];
      if(f.type==='check') v=!!v;
      else if(f.type==='money'||f.type==='number') v=(v===''||v==null)?'':this.parseNum(v);
      else v=(v==null)?'':String(v).trim();
      if(f.req && (v===''||v==null)) return {ok:false,error:f.label+' is required.',field:f.key};
      rec[f.key]=v;
    }
    const name=String(rec.name||'').trim();
    if(name){
      const dup=((b.records&&b.records[key])||[]).some(r=>String(r.name||'').trim().toLowerCase()===name.toLowerCase());
      if(dup) return {ok:false,error:'A '+String(c.singular||'record').toLowerCase()+' named \u201c'+name+'\u201d already exists.',field:'name'};
    }
    rec.id=Date.now()+Math.floor(Math.random()*1000); rec.uuid=this.uuid();
    b.records=b.records||{}; const arr=(b.records[key]||[]).slice(); arr.push(rec); b.records[key]=arr;
    this.ensureControlsFor(b,key,rec);
    try{ refreshSummary(b); }catch(e){}
    try{ this._logActivity(b,'create',key,rec,null); }catch(e){}
    this.saveBiz(b);
    return {ok:true,record:rec};
  },
  deleteRecord(id){ if(!this.guardWrite()) return; const b=this.curBiz(), c=this.cfg(); var _r=(this.records(b)||[]).find(function(r){return r.id===id;}); var _lk=(b&&b.lockDate)||''; if(_lk&&_r){ var _d=String(_r.issueDate||_r.date||'').slice(0,10); if(_d&&_d<=_lk){ alert('This entry is dated on or before the lock date ('+_lk+') and can\u2019t be deleted while the period is locked. Update Settings \u2192 Lock Date first.'); return; } } if(!this._ask('Delete this '+c.singular.toLowerCase()+'?',()=>this.deleteRecord(id))) return;
    var _key=this._sectionKey(); var _bef=(this.records(b)||[]).find(function(r){return r.id===id;}); _bef=_bef?JSON.parse(JSON.stringify(_bef)):null;
    this.setRecords(b,this.records(b).filter(r=>r.id!==id)); try{ this._logActivity(b,'delete',_key,null,_bef); }catch(e){} refreshSummary(b); this.saveBiz(b); if(!this.backFromRecord()) this.backToList(); },
  backToList(){ this.recReturn=null; this.histReturn=false; this.editingId=null; this.wsMode='list'; this.renderWorkspace(); },

  /* ----- register: VIEW ----- */
  viewRecord(id){ this.editingId=id; this.wsMode='view'; this.renderMain(this.curBiz()); },
  numStr(n){ return (n==null||n===''||isNaN(n))?'':String(+n); },
  invRateLabel(rec){ const lns=rec.lines||[]; const rates=Array.from(new Set(lns.filter(l=>l.tax).map(l=>this.taxRate(l.tax)))); return rates.length===1?(rates[0]+'%'):'tax'; },
  /* ---------- form / voucher / statement formatting config ---------- */
  formSchema(key){
    const inv=['salesInv','purchInv','salesQuotes','purchQuotes','salesOrders','purchOrders','creditNotes','debitNotes','deliveryNotes','goodsRec'];
    if(inv.indexOf(key)>=0) return {kind:'form',
      cols:[['first','Item / Description / Account'],['qty','Quantity'],['price','Unit price'],['tax','Tax rate %'],['taxAmt','Tax amount'],['total','Amount / Total']],
      content:[['logo','Business logo'],['bizAddress','Business name & address'],['trn','Tax number (TRN)'],['party','Customer / Supplier name'],['partyAddress','Customer / Supplier address'],['date','Document date'],['dueDate','Due date'],['reference','Reference / number'],['description','Description line'],['status','Paid / overdue badge'],['bankDetails','Bank-details block'],['disclaimer','Disclaimer block'],['footer','Footer text']]};
    if(key==='receipts'||key==='payments') return {kind:'voucher',
      cols:[['account','Account'],['sub','Subsidiary (customer / item / …)'],['desc','Line description'],['amount','Amount']],
      content:[['logo','Business logo'],['bizAddress','Business name & address'],['trn','Tax number (TRN)'],['recipient','Received-from / Paid-to'],['date','Date'],['reference','Reference'],['bankacct','Received-in / Paid-from'],['description','Description'],['footer','Footer text']]};
    const REC=['bankCash','customers','suppliers','inventory','employees','fixedAssets','depreciation','journal','payslips',
      'bankRec','special','expenseClaims','billableTime','whtReceipts','invTransfers','invWriteOffs','production',
      'nonInvItems','intangibles','amortization','investments'];
    if(REC.indexOf(key)>=0){ const r=REG[key]||{}; return {kind:'record', cols:[], fields:(r.form||[]).slice(), lines:r.lines||null}; }
    return null; },
  _uid(p){ return (p||'cf')+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36); },
  _useDraft(key){ return this.wsMode==='settings' && this.fmtForm && key===this.fmtForm && !!this.fmtDraft; },
  cfgEnsure(b,key){ const sc=this.formSchema(key); if(!sc) return null; const useD=this._useDraft(key); let c;
    if(useD){ c=this.fmtDraft; if(!c){ c={show:{},cols:sc.cols.map(x=>({k:x[0],show:true,w:0,h:0})),custom:[]}; this.fmtDraft=c; } }
    else { b.formConfig=b.formConfig||{}; c=b.formConfig[key]; if(!c){ c={show:{},cols:sc.cols.map(x=>({k:x[0],show:true,w:0,h:0})),custom:[]}; b.formConfig[key]=c; } }
    if(!c.cols) c.cols=sc.cols.map(x=>({k:x[0],show:true,w:0,h:0}));
    sc.cols.forEach(x=>{ if(!c.cols.some(cc=>cc.k===x[0])) c.cols.push({k:x[0],show:true,w:0,h:0}); });
    if(!c.show) c.show={}; if(!c.custom) c.custom=[]; if(c.refPrefix==null) c.refPrefix='';
    c.custom.forEach(x=>{ if(!x.type) x.type='field'; if(!x.key) x.key=this._uid(x.type==='line'?'lf':'cf'); if(!x.dataType) x.dataType='text'; if(x.type==='line'){ if(!c.cols.some(cc=>cc.k===x.key)) c.cols.push({k:x.key,show:x.show!==false,w:x.w||0,h:0}); } });
    return c; },
  formCfg(b,key){ if(this._useDraft(key)) return this.fmtDraft; return (b.formConfig&&b.formConfig[key])||null; },
  cfgShow(b,key,ck){ const c=this._useDraft(key)?this.fmtDraft:(b.formConfig&&b.formConfig[key]); return !(c&&c.show&&c.show[ck]===false); },
  applyColCfg(b,key,colDefs){ const c=this.formCfg(b,key); const present=colDefs.filter(cd=>cd.present);
    if(!c||!c.cols||!c.cols.length) return present;
    const map={}; colDefs.forEach(cd=>{ if(cd.k) map[cd.k]=cd; }); const out=[];
    c.cols.forEach(cc=>{ const cd=map[cc.k]; if(cd&&cc.show!==false&&cd.present){ cd.w=cc.w||0; cd.h=cc.h||0; if(cc.a) cd.align=cc.a; out.push(cd); } });
    present.forEach(cd=>{ if(cd.k&&!c.cols.some(cc=>cc.k===cd.k)){ if(cd.k==='num') out.unshift(cd); else out.push(cd); } });
    return out; },
  _ivHeader(title,logoImg,co,bizLines){ return '<header class="iv-header">'+
    '<div class="iv-hlogo">'+(logoImg||'')+'</div>'+
    '<div class="iv-htitle"><h1 class="iv-title">'+this.esc(title)+'</h1></div>'+
    '<address class="iv-binfo"><strong>'+co+'</strong>'+(bizLines||'')+'</address></header>'; },
  _partyBlock(b,key,rec){ var e=s=>this.esc(s); var isP=(['purchInv','purchQuotes','purchOrders','debitNotes','goodsRec'].indexOf(key)>=0);
    var nm=rec.customer||rec.supplier||''; var listKey=isP?'suppliers':'customers';
    var prec=((b.records&&b.records[listKey])||[]).find(function(x){ return (x.name||'')===nm; })||{};
    var addrSrc=(rec.billingAddress!=null&&String(rec.billingAddress).trim()!=='')?rec.billingAddress:(prec.address||'');
    var addrH=(addrSrc||'').split('\n').filter(Boolean).map(l=>e(l)).join('<br>');
    var trnV=(isP&&rec.supTRN!=null&&String(rec.supTRN).trim()!=='')?rec.supTRN:prec.trn; var trn=trnV?('TRN: '+e(trnV)):''; var phone=prec.phone?('Tel: '+e(prec.phone)):''; var email=prec.email?e(prec.email):'';
    return [addrH,trn,phone,email].filter(Boolean).join('<br>'); },
  voucherDoc(b,c,rec,opts){ const d=b.details||{}; const isCash=c.lines&&c.lines.kind==='cash'; const isInv=c.lines&&c.lines.kind==='invoice'; const e=s=>this.esc(s);
    const _off={}; (Array.isArray(rec.printOff)?rec.printOff:[]).forEach(v=>{ _off[v]=1; }); const PO=(...vs)=>!(opts&&opts.edit)&&vs.some(v=>_off[v]);
    const _recHide={date:['f:date'],reference:['f:reference'],dueDate:['f:dueDate'],party:['f:custName','f:supName'],partyAddress:['f:custAddress','f:supAddress'],description:['f:narration','f:description'],bankDetails:['f:bank_accounts_detail']};
    const SHOW=(k,ck)=>this.cfgShow(b,k,ck)&&!(_recHide[ck]&&PO(..._recHide[ck])); const ed=!!(opts&&opts.edit); const selK=(opts&&opts.sel)||null;
    const co=e(d.legalName||b.name||''); const addr=(d.address||'').split('\n').filter(Boolean).map(l=>e(l)).join('<br>');
    const phone=(d.phone||'').split('\n').filter(Boolean).map(l=>e(l)).join('<br>'); const email=d.email?e(d.email):''; const trn=d.taxNumber?'TRN: '+e(d.taxNumber):'';
    const logo=d.logo?'<img class="vch-logo" src="'+e(d.logo)+'" alt="">':'';
    if(isInv){
      const key=(opts&&opts.key)||LABEL2KEY[this.wsSection]; const isP=(opts&&opts.key)?(['purchInv','purchQuotes','purchOrders','debitNotes','goodsRec'].indexOf(opts.key)>=0):this.purchaseDoc();
      const dateLbl=key==='salesInv'?'INVOICE DATE':(key==='purchInv'?'BILL DATE':'DATE');
      const numLbl=(key==='salesInv'||key==='purchInv')?'INVOICE NUMBER':'REFERENCE';
      const showStatus=(key==='salesInv'||key==='purchInv');
      const title=(rec.customTitleOn&&rec.customTitle)?rec.customTitle:(c.singular||'Invoice');
      const party=rec.customer||rec.supplier||'';
      const billing=(rec.billingAddress||'').split('\n').filter(Boolean).map(l=>e(l)).join('<br>');
      const showTax=rec.showTaxCol!==false; const lns=(rec.lines||[]).filter(l=>!(l&&l.rounding));
      const hasItem=lns.some(l=>l.item&&String(l.item).trim());
      const hasDesc=lns.some(l=>l.desc&&String(l.desc).trim());
      const firstHdr=hasItem?'Item':(hasDesc?'Description':'Account');
      const unitHdr=((lns.find(l=>l.unit)||{}).unit)||'Qty';
      let qtySum=0,taxSum=0,amtSum=0; lns.forEach(ln=>{ qtySum+=this.parseNum(ln.qty)||0; taxSum+=Number(ln.taxAmt)||0; amtSum+=Number(ln.amount)||0; });
      const has=k=>lns.some(l=>{ const v=l[k]; return v!==''&&v!=null&&!(k==='taxAmt'&&!Number(v)); });
      const hasTax=lns.some(l=>l.tax);
      const firstCell=ln=>{ const it=(ln.item!=null&&String(ln.item).trim())?String(ln.item):''; const de=(ln.desc!=null&&String(ln.desc).trim())?String(ln.desc):'';
        let main=it||de; if(!main&&ln.account){ const an=acctById(b,ln.account); main=an?an.name:''; }
        const sub=(it&&de)?'<div class="iv-sub">'+e(de)+'</div>':''; return e(main)+sub; };
      const colDefs=[
        {k:'first',th:firstHdr,align:'left',present:true,cell:firstCell,sum:''},
        {k:'qty',th:unitHdr,align:'right',present:has('qty')&&rec.colQty!==false&&!PO('c:qty'),cell:ln=>{ const q=this.parseNum(ln.qty); return q?e(this.numStr(q)):''; },sum:e(this.numStr(qtySum))},
        {k:'price',th:'Unit price',align:'right',present:has('price')&&!PO('c:price'),cell:ln=>((ln.price!==''&&ln.price!=null)?this.money(ln.price):''),sum:''},
        {k:'tax',th:'Tax',align:'right',present:hasTax&&!PO('c:taxRate'),cell:ln=>{ if(!ln.tax&&!ln.taxCode) return ''; const _r=this.taxRate(ln.taxCode||ln.tax)||(ln.taxRate!==''&&ln.taxRate!=null?Number(ln.taxRate):0)||(isNaN(Number(ln.tax))?0:Number(ln.tax)); return e(_r+'%'); },sum:''},
        {k:'taxAmt',th:'Tax Amount',align:'right',present:showTax&&hasTax&&!PO('c:taxAmount'),cell:ln=>this.money(ln.taxAmt),sum:this.money(taxSum)},
        {k:'total',th:'Total',align:'right',present:true,cell:ln=>this.money(ln.amount),sum:this.money(amtSum)}
      ];
      if(rec.colLineNum) colDefs.unshift({k:'num',th:'#',align:'left',present:true,cell:(ln,idx)=>String(idx+1),sum:''});
      ((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='line').forEach(x=>colDefs.push({k:x.key,th:x.label||'',align:x.a||((x.dataType==='number'||x.dataType==='formula')?'right':'left'),present:true,cell:ln=>this.cfDisplayValue(x,ln[x.key],this.cfLineCtx(ln,{subtotal:rec.subtotal,total:rec.total})),sum:''}));
      const shown=this.applyColCfg(b,key,colDefs); const ncol=shown.length;
      const wst=cd=>'text-align:'+cd.align+(cd.w?';min-width:'+cd.w+'px;width:'+cd.w+'px':'')+(cd.h?';height:'+cd.h+'px':'');
      const thr='<tr class="iv-thr">'+shown.map(cd=>'<th'+(ed?' draggable="true" ondragstart="App.fmtDragCol(\''+cd.k+'\')" ondragover="event.preventDefault()" ondrop="App.fmtDropCol(\''+cd.k+'\')" onclick="App.selectFmtCol(\''+cd.k+'\')"':'')+' style="'+wst(cd)+(ed?';cursor:grab'+(selK===cd.k?';outline:2px solid var(--primary);outline-offset:-2px':''):'')+'">'+e(cd.th)+(ed?' <span class="iv-grip">\u22EE\u22EE</span>':'')+(ed&&selK===cd.k?' \u270E':'')+'</th>').join('')+'</tr>';
      const rowsH=lns.map((ln,idx)=>'<tr class="iv-row'+(idx===lns.length-1?' iv-lastrow':'')+'">'+shown.map(cd=>'<td style="'+wst(cd)+'">'+cd.cell(ln,idx)+'</td>').join('')+'</tr>').join('');
      const anySum=shown.some(cd=>cd.sum);
      const coltot=anySum?'<tr class="iv-coltot">'+shown.map(cd=>'<td style="text-align:'+cd.align+'">'+(cd.sum||'')+'</td>').join('')+'</tr>':'';
      const tRow=(lbl,val,g)=>'<div class="iv-totrow'+(g?' iv-totrow-g':'')+'"><span>'+e(lbl)+'</span><span>'+this.money(val)+'</span></div>';
      let totRows; if(rec.taxInclusive){ totRows=(Number(rec.tax)?tRow('Includes '+this.invRateLabel(rec),rec.tax,0):'')+tRow('Total',rec.total,1); }
        else { totRows=tRow('Subtotal',rec.subtotal,0)+(Number(rec.tax)?tRow('Tax',rec.tax,0):'')+tRow('Total',rec.total,1); }
      if(Number(rec.roundingAmt)) totRows=totRows.replace(/(<div class="iv-totrow iv-totrow-g">)/, tRow('Rounding',rec.roundingAmt,0)+'$1');
      if(Number(rec.withholdingAmt)) totRows+=tRow('Withholding tax',-Number(rec.withholdingAmt),0);
      if((key==='salesInv'||key==='purchInv')&&!rec.hideBalanceDue&&!PO('f:balanceDue')){ const _bd=(rec.balanceDue!=null&&rec.balanceDue!=='')?Number(rec.balanceDue):(Number(rec.total)||0)-(Number(rec.withholdingAmt)||0); totRows+=tRow('Balance due',_bd,1); }
      const totalsBox='<div class="iv-totbox2">'+totRows+'</div>';
      const table='<div class="iv-twrap"><table class="iv-table"><thead>'+thr+'</thead><tbody>'+rowsH+coltot+'</tbody></table></div>';
      const showWords=(rec.amountInWords!==false)&&!PO('f:amounts_in_word');
      const wordsBox=showWords?'<div class="iv-aw2"><span class="iv-aw-lbl">Amount in words</span><span class="iv-aw-val">'+e(this.amountInWords(rec.total,(d.currency||b.currency||b.baseCurrency||'')))+'</span></div>':'';
      const belowH='<div class="iv-belowtbl"><div class="iv-bl-left">'+wordsBox+'</div><div class="iv-bl-right">'+totalsBox+'</div></div>';
      const trnLine=(d.taxNumber&&SHOW(key,'trn'))?'TRN No: '+e(d.taxNumber):'';
      const addrLines=SHOW(key,'bizAddress')?[addr,phone,email].filter(Boolean).join('<br>'):'';
      const bizLines=[addrLines,trnLine].filter(Boolean).join('<br>');
      let cf='';
      if(rec.disclaimer&&(rec.printDisclaimer==null||rec.printDisclaimer)&&SHOW(key,'disclaimer')) cf+='<div class="iv-cfblock"><strong>Disclaimer</strong>'+e(rec.disclaimer).split('\n').join('<br>')+'</div>';
      if(d.footer&&SHOW(key,'footer')) cf+='<div class="iv-cfblock">'+e(d.footer).split('\n').join('<br>')+'</div>';
      const cfWrap=cf?'<div class="iv-cf">'+cf+'</div>':'';
      const showBank=(!isP||rec.bankDetailsOn===true)&&(rec.printBankDetails==null||rec.printBankDetails)&&SHOW(key,'bankDetails');   /* purchase documents: the Bank Accounts Detail option */
      const _bankTxt=String(rec.bankDetails||rec.bank_accounts_detail||'').trim();
      const bankBox=(showBank&&(_bankTxt||ed))?'<div class="iv-bankbox"><div class="iv-bb-lbl">Bank Details:</div><div class="iv-bb-area">'+(_bankTxt?e(_bankTxt).split('\n').join('<br>'):'')+'</div></div>':'';
      const signBox='<div class="iv-sign"><div class="iv-sign-box"><div class="iv-sign-top">For '+co+'</div><div class="iv-sign-bot">Sign and stamp</div></div><div class="iv-sign-box"><div class="iv-sign-top">'+(isP?'For supplier':'For customer')+'</div><div class="iv-sign-bot">Sign and stamp</div></div></div>';
      const st=this.invStatus(rec); const stcls=st==='Overdue'?'neg':(st==='Paid'?'pos':'neu');
      const badge=(showStatus&&SHOW(key,'status')&&rec.printStatus===true)?'<div class="iv-status"><span class="'+stcls+'">'+e(st.toUpperCase())+'</span></div>':'';
      const cfgF=this.formCfg(b,key);
      const customAt=slot=>{ const list=((cfgF&&cfgF.custom)||[]).map((x,i)=>({x:x,i:i})).filter(o=>o.x.type!=='line'&&(ed?true:(o.x.label&&o.x.show!==false))&&((o.x.pos||'afterMeta')===slot));
        let h=list.map(o=>{ const lbl=o.x.label||'(unnamed field)'; const dim=(ed&&(o.x.show===false||!o.x.label))?';opacity:.5':''; const selb=(this.fmtSel&&this.fmtSel.type==='custom'&&this.fmtSel.i===o.i)?' data-sel="1"':'';
            let disp; if(o.x.dataType==='formula'){ disp=this.cfDisplayValue(o.x,null,this.cfDocCtx(rec)); } else { const raw=(rec.custom&&rec.custom[o.x.key]!=null&&rec.custom[o.x.key]!=='')?rec.custom[o.x.key]:(o.x.value||''); disp=raw?this.cfDisplayValue(o.x,raw,this.cfDocCtx(rec)):(ed?'\u2014':''); }
            return '<div class="iv-cblock"'+(ed?' draggable="true" ondragstart="App.fmtDragCustom('+o.i+')" onclick="App.selectFmtCustom('+o.i+')" style="cursor:grab'+dim+'"'+selb:'')+'><span class="iv-clbl">'+e(String(lbl).toUpperCase())+'</span><span class="iv-cval">'+disp+'</span></div>'; }).join('');
        if(ed){ h='<div class="iv-slot" ondragover="event.preventDefault()" ondrop="App.fmtDropSlot(\''+slot+'\')">'+(h||'<span class="iv-slot-empty">'+slot+' — drop a separate field here</span>')+'</div>'; }
        return h; };
      const fieldsH=(SHOW(key,'date')?'<dt>'+dateLbl+'</dt><dd>'+e(this.fmtDateUS(rec.issueDate||rec.date))+'</dd>':'')+
        (rec.reference&&SHOW(key,'reference')?'<dt>'+numLbl+'</dt><dd>'+e(rec.reference)+'</dd>':'')+(isP&&rec.supplierInvoiceNo?'<dt>'+(key==='purchInv'||key==='debitNotes'?'SUPPLIER INVOICE NO.':'SUPPLIER REFERENCE')+'</dt><dd>'+e(rec.supplierInvoiceNo)+'</dd>':'')+
        (()=>{ if(rec.hideDueDate||!SHOW(key,'dueDate')) return ''; const isQ=(key==='salesQuotes'||key==='purchQuotes'); const dv=isQ?(rec.validUntil||rec.expiryDate||rec.dueDate):rec.dueDate;
          if(!dv&&!(key==='salesInv'||key==='purchInv')) return ''; return '<dt>'+(isQ?'Valid until':'Due Date')+'</dt><dd>'+(dv?e(this.fmtDateUS(dv)):'-')+'</dd>'; })();
      const partyName=SHOW(key,'party')?e(party):''; let partyAddr=SHOW(key,'partyAddress')?this._partyBlock(b,key,rec):''; if(PO('f:custTRN','f:supTRN')) partyAddr=partyAddr.split('<br>').filter(l=>l.indexOf('TRN: ')!==0).join('<br>');
      const logoImg=(d.logo&&SHOW(key,'logo'))?'<img src="'+e(d.logo)+'" alt="">':'';
      const headerH=this._ivHeader(title,logoImg,co,bizLines);
      const metaH='<div class="iv-meta"><address class="iv-rinfo"><div class="iv-party-lbl">'+(isP?'SUPPLIER':'CUSTOMER')+'</div><strong>'+partyName+'</strong>'+partyAddr+'</address><div class="iv-mdiv"></div><dl class="iv-fields">'+fieldsH+'</dl></div>';
      const descH=(rec.description&&SHOW(key,'description')?'<p class="iv-desc">'+e(rec.description)+'</p>':'');
      return '<div class="iv-card">'+
        headerH+ customAt('afterHeader')+
        metaH+ customAt('afterMeta')+
        descH+ customAt('afterDesc')+
        table+ customAt('afterTable')+
        belowH+
        bankBox+
        signBox+
        cfWrap+ customAt('bottom')+
        badge+'</div>';
    }
    const key=(opts&&opts.key)||LABEL2KEY[this.wsSection];
    if((key==='receipts'||key==='payments') && b.formConfig && b.formConfig[key]){ const _c=b.formConfig[key]; if(_c.vdoc && _c.vdoc.elements && _c.vdoc.elements.length) return this.vbRenderDoc(b,rec,key); if(_c.docHtml && String(_c.docHtml).trim()) return this.wpRenderDoc(b,rec,key); }
    const trnLineV=(d.taxNumber&&SHOW(key,'trn'))?'TRN No: '+e(d.taxNumber):'';
    const bizLines=[(SHOW(key,'bizAddress')?[addr,phone,email].filter(Boolean).join('<br>'):''),trnLineV].filter(Boolean).join('<br>');
    const logoH=(d.logo&&SHOW(key,'logo'))?'<img src="'+e(d.logo)+'" alt="">':'';
    const title=(rec.customTitleOn&&rec.customTitle)?rec.customTitle:(c.singular||'Document');
    const fmt=v=>e(this.fmtDateUS(v));
    const ivTable=(cols,rowsData,totals)=>{ const n=cols.length;
      const thr='<tr class="iv-thr">'+cols.map(cc=>'<th style="text-align:'+cc.align+(cc.w?';min-width:'+cc.w+'px;width:'+cc.w+'px':'')+(cc.h?';height:'+cc.h+'px':'')+(ed&&cc.k?';cursor:pointer'+(selK===cc.k?';outline:2px solid var(--primary);outline-offset:-2px':''):'')+'"'+(ed&&cc.k?' onclick="App.selectFmtCol(\''+cc.k+'\')"':'')+'>'+e(cc.th)+(ed&&selK===cc.k?' \u270E':'')+'</th>').join('')+'</tr>';
      const rws=rowsData.map((r,i)=>'<tr class="iv-row'+(i===rowsData.length-1?' iv-lastrow':'')+'">'+r.map((cell,j)=>'<td style="text-align:'+cols[j].align+(cols[j].w?';min-width:'+cols[j].w+'px;width:'+cols[j].w+'px':'')+(cols[j].h?';height:'+cols[j].h+'px':'')+'">'+cell+'</td>').join('')+'</tr>').join('');
      const anySum=cols.some(cc=>cc.sum); const ct=anySum?'<tr class="iv-coltot">'+cols.map(cc=>'<td style="text-align:'+cc.align+'">'+(cc.sum||'')+'</td>').join('')+'</tr>':'';
      const tt=(totals||[]).map(t=>'<tr class="iv-tot"><td colspan="'+(n-1)+'"'+(t.emph?' style="font-weight:700"':'')+'>'+e(t.label)+'</td><td class="iv-totbox"'+(t.emph?' style="font-weight:700"':'')+'>'+this.money(t.val)+'</td></tr>').join('');
      return '<div class="iv-twrap"><table class="iv-table"><thead>'+thr+'</thead><tbody>'+rws+ct+tt+'</tbody></table></div>'; };
    let recipientName='',recipientAddr='',fields=[],descText='',body='',status='',vcf='';
    if(isCash){ const isRcpt=key==='receipts'; recipientName=SHOW(key,'recipient')?(isRcpt?(rec.paidBy||''):(rec.payee||'')):'';
      fields=[]; if(SHOW(key,'date')) fields.push({l:'DATE',t:fmt(rec.date)}); if(rec.reference&&SHOW(key,'reference')) fields.push({l:'REFERENCE',t:e(rec.reference)});
      if(SHOW(key,'bankacct')) fields.push({l:isRcpt?'RECEIVED IN':'PAID FROM',t:e(this.dispAcct?this.dispAcct(isRcpt?(rec.receivedIn||''):(rec.paidFrom||'')):(isRcpt?(rec.receivedIn||''):(rec.paidFrom||'')))});
      ((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.label&&x.show!==false).forEach(x=>fields.push({l:String(x.label).toUpperCase(),t:e(x.value||'')}));
      descText=SHOW(key,'description')?(rec.description||''):''; const lns=rec.lines||[]; let amt=0; lns.forEach(l=>amt+=this.parseNum(l.amount)||0);
      const cellFor={account:l=>e(acctName(b,l.account)||''),sub:l=>e(l.sub||''),desc:l=>e(l.desc||''),amount:l=>this.money(l.amount)};
      const colDefs=[{k:'account',th:'Account',align:'left',present:true,sum:''},{k:'sub',th:'Customer / Supplier / Member',align:'left',present:lns.some(l=>l.sub),sum:''},{k:'desc',th:'Description',align:'left',present:true,sum:''},{k:'amount',th:'Amount',align:'right',present:true,sum:this.money(amt)}];
      const scc=this.applyColCfg(b,key,colDefs); const cols=scc.map(cd=>({th:cd.th,align:cd.align,sum:cd.sum,w:cd.w,h:cd.h,k:cd.k})); const rowsData=lns.map(l=>scc.map(cd=>cellFor[cd.k](l)));
      body=ivTable(cols,rowsData,[{label:'Total',val:Number(rec.amount)||amt,emph:1}]);
      if(d.footer&&SHOW(key,'footer')) vcf='<div class="iv-cf"><div class="iv-cfblock">'+e(d.footer).split('\n').join('<br>')+'</div></div>';
    } else if(c.lines&&c.lines.kind==='journal'){ fields=[{l:'DATE',t:fmt(rec.date)}]; if(rec.reference) fields.push({l:'REFERENCE',t:e(rec.reference)});
      descText=rec.narration||''; const lns=rec.lines||[]; let ds=0,cs=0; lns.forEach(l=>{ds+=Number(l.debit)||0;cs+=Number(l.credit)||0;});
      const anySub=lns.some(l=>l.sub);
      const cols=anySub?[{th:'Account',align:'left',sum:''},{th:'Customer / Supplier / Member',align:'left',sum:''},{th:'Description',align:'left',sum:''},{th:'Debit',align:'right',sum:this.money(ds)},{th:'Credit',align:'right',sum:this.money(cs)}]
        :[{th:'Account',align:'left',sum:''},{th:'Description',align:'left',sum:''},{th:'Debit',align:'right',sum:this.money(ds)},{th:'Credit',align:'right',sum:this.money(cs)}];
      body=ivTable(cols,lns.map(l=>anySub?[e(acctName(b,l.account)||''),e(l.sub||''),e(l.desc||''),this.money(l.debit),this.money(l.credit)]:[e(acctName(b,l.account)||''),e(l.desc||''),this.money(l.debit),this.money(l.credit)]),[{label:'Total',val:ds,emph:1}]);
    } else if(key==='iat'){ fields=[{l:'DATE',t:fmt(rec.date)}]; if(rec.reference) fields.push({l:'REFERENCE',t:e(rec.reference)});
      fields.push({l:'PAID FROM',t:e(rec.paidFrom||'')}); fields.push({l:'RECEIVED IN',t:e(rec.receivedIn||'')}); descText=rec.description||'';
      body=ivTable([{th:'Description',align:'left',sum:''},{th:'Amount',align:'right',sum:''}],[[e(rec.description||'Funds transfer'),this.money(rec.amount)]],[{label:'Amount',val:rec.amount,emph:1}]);
    } else if(c.lines&&c.lines.kind==='payslip'){ recipientName=rec.employee||'';
      fields=[{l:'PAY DATE',t:fmt(rec.date)}]; if(rec.reference) fields.push({l:'REFERENCE',t:e(rec.reference)});
      descText=rec.description||''; const lns=rec.lines||[]; let earn=0,ded=0; lns.forEach(l=>{ const a=Number(l.amount)||0; if(l.ptype==='Deduction') ded+=a; else earn+=a; });
      const cols=[{th:'Type',align:'left',sum:''},{th:'Description',align:'left',sum:''},{th:'Account',align:'left',sum:''},{th:'Amount',align:'right',sum:''}];
      body=ivTable(cols,lns.map(l=>[e(l.ptype||'Earning'),e(l.desc||''),e(acctName(b,l.account)||''),this.money(l.amount)]),
        [{label:'Earnings',val:earn},{label:'Deductions',val:ded},{label:'Net pay',val:(rec.netPay!=null?rec.netPay:earn-ded),emph:1}]);
    } else if(c.lines&&c.lines.kind==='depr'){ fields=[{l:'DATE',t:fmt(rec.date)}]; if(rec.reference) fields.push({l:'REFERENCE',t:e(rec.reference)}); if(rec.method) fields.push({l:'METHOD',t:e(rec.method)});
      descText=rec.description||''; const lns=rec.lines||[]; let tot=0; lns.forEach(l=>tot+=Number(l.amount)||0);
      const cols=[{th:'Fixed asset',align:'left',sum:''},{th:'Cost',align:'right',sum:''},{th:'Accum. depreciation',align:'right',sum:''},{th:'Rate',align:'right',sum:''},{th:'Depreciation',align:'right',sum:this.money(tot)}];
      body=ivTable(cols,lns.map(l=>[e(l.asset||''),this.money(l.cost),this.money(l.accDep),(l.rate!=null&&l.rate!==''?e(l.rate)+'%':''),this.money(l.amount)]),[{label:'Total depreciation',val:(rec.amount!=null?rec.amount:tot),emph:1}]);
    } else { const nm=rec.name||''; if(nm) recipientName=nm;
      fields=(c.form||[]).map(f=>{ let v=rec[f.key]; if(f.key==='name') return null; if(v==null||v==='') return null;
        let t; if(f.type==='check'){ if(!v) return null; t='Yes'; } else { t=f.type==='account'?e(acctName(b,v)):(f.type==='money'?this.money(v):(f.type==='date'?fmt(v):e(v))); }
        return {l:String(f.label).toUpperCase(),t:t}; }).filter(Boolean);
    }
    const fieldsH=fields.map(f=>'<dt>'+e(f.l)+'</dt><dd>'+f.t+'</dd>').join('');
    const metaH=(recipientName||recipientAddr)
      ? '<div class="iv-meta"><address class="iv-rinfo"><strong>'+e(recipientName)+'</strong>'+(recipientAddr||'')+'</address><div class="iv-mdiv"></div><dl class="iv-fields">'+fieldsH+'</dl></div>'
      : (fieldsH?'<div class="iv-meta"><div style="flex:1"></div><dl class="iv-fields">'+fieldsH+'</dl></div>':'');
    const descH=descText?'<p class="iv-desc">'+e(descText)+'</p>':'';
    return '<div class="iv-card">'+this._ivHeader(title,logoH,co,bizLines)+metaH+descH+body+vcf+status+'</div>'; },
  viewHtml(b){
    const c=this.cfg(); const rec=this.records(b).find(r=>r.id===this.editingId)||{};
    let inner=this.voucherDoc(b,c,rec);
    const titleVal=rec.name||rec.reference||rec.code||c.singular;
    const list=this.records(b); const idx=list.findIndex(r=>r.id===this.editingId); const total=list.length;
    const pager = total>1 ? '<div class="view-pager"><button class="pgb" '+(idx<=0?'disabled':'')+' onclick="App.viewNav(-1)">«</button><button class="pgb" '+(idx<=0?'disabled':'')+' onclick="App.viewNav(-1)">‹</button><span>'+(idx+1)+' / '+total+'</span><button class="pgb" '+(idx>=total-1?'disabled':'')+' onclick="App.viewNav(1)">›</button><button class="pgb" '+(idx>=total-1?'disabled':'')+' onclick="App.viewNav(1)">»</button></div>' : '';
    return this.recCrumb(c.label, titleVal)+
      '<div class="card" style="max-width:920px">'+
      '<div class="view-bar"><span class="view-doc">'+this.esc(c.singular)+'</span>'+
        '<button class="btn btn-sm" onclick="App.editRecord('+this.editingId+')">Edit</button>'+
        '<button class="btn btn-sm" onclick="App.cloneRecord()">Clone</button>'+
        '<button class="btn btn-sm" onclick="App.copyToMenu()">▸ Copy to</button>'+
        '<button class="btn btn-sm" onclick="App.printView()">Print</button>'+
        '<button class="btn btn-sm" onclick="App.pdfView()">PDF</button>'+
        '<button class="btn btn-sm" onclick="App.emailDoc()">Email</button>'+
        pager+'</div>'+
      inner+
      '<div class="doc-foot"><span style="display:flex;gap:8px"><button class="ftbtn" onclick="App.txnJournal()">Transaction Journal</button></span></div>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.editRecord('+JSON.stringify(this.editingId)+')">Edit</button><button class="btn" onclick="App.historyBack()||App.backFromRecord()||App.backToList()">Close</button>'+((this.histReturn&&this.histEntry&&!this.histEntry.synthetic&&!this.histEntry.undone&&this.histEntry.id)?'<button class="btn btn-sm" style="color:#c0392b;border-color:#e2b8b8" onclick="App.historyUndoFromView()">↺ Undo this change</button>':'')+'<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="App.deleteRecord('+JSON.stringify(this.editingId)+')">Delete</button></div></div>';
  },
  viewNav(d){ const b=this.curBiz(); const list=this.records(b); const idx=list.findIndex(r=>r.id===this.editingId); const n=idx+d; if(n<0||n>=list.length) return; this.editingId=list[n].id; this.renderMain(b); },
  cloneRecord(){ const b=this.curBiz(); const rec=this.records(b).find(r=>r.id===this.editingId); if(!rec) return; const cp=JSON.parse(JSON.stringify(rec)); delete cp.id; delete cp.uuid; delete cp.reference; this._prefill=cp; this.recReturn=null; this.histReturn=false; this.editingId=null; this.wsMode='form'; this.renderWorkspace(); },
  copyView(){ const b=this.curBiz(), c=this.cfg(); const rec=this.records(b).find(r=>r.id===this.editingId)||{};
    const lines=c.form.map(f=>f.label+'\t'+(f.type==='account'?acctName(b,rec[f.key]):(rec[f.key]==null?'':rec[f.key]))).join('\n');
    if(navigator.clipboard) navigator.clipboard.writeText(lines).then(()=>this.toast&&this.toast('Copied'),()=>{}); },

  /* ----- print / pdf ----- */
  printView(){ var b=this.curBiz(); var c=this.cfg(); var rec=this.records(b).find(r=>r.id===this.editingId)||{}; this._printDoc(b,c,rec); },
  pdfView(){ this.printView(); },
  _printDoc(b,c,rec){ var inner=''; try{ inner=this.voucherDoc(b,c,rec); }catch(_){ inner='<pre>'+this.esc(JSON.stringify(rec,null,2))+'</pre>'; }
    var pr=document.getElementById('printRegion'); if(!pr){ pr=document.createElement('div'); pr.id='printRegion'; document.body.appendChild(pr); }
    pr.innerHTML='<div class="card">'+inner+'</div>';
    var clean=function(){ try{ pr.innerHTML=''; }catch(e){} window.removeEventListener('afterprint',clean); };
    window.addEventListener('afterprint',clean);
    setTimeout(function(){ try{ window.print(); }catch(e){} setTimeout(clean,1500); }, 80); },

  /* ----- transaction journal (double-entry for one document) ----- */
  _txnLines(b, key, rec){ var self=this; var out=[]; var anm=function(ln){ return (ln&&(ln.accountName||(ln.account&&acctName(b,ln.account))))||(ln&&typeof ln.account==='string'?ln.account:'')||''; };
    var add=function(account,dr,cr,sub){ dr=Number(dr)||0; cr=Number(cr)||0; if(Math.abs(dr)<0.005&&Math.abs(cr)<0.005) return; out.push({account:account||'(unspecified)', sub:sub||'', debit:dr, credit:cr}); };
    var lines=(rec.lines||[]);
    if(key==='journal'){ lines.forEach(function(ln){ add(anm(ln), ln.debit, ln.credit, ln.sub); }); }
    else if(key==='receipts'||key==='payments'){ var net=0,tax=0;
      lines.forEach(function(ln){ var twt=Number(ln.amount||0)||0; var n=Number(ln.net!=null&&ln.net!==''?ln.net:twt)||0; var t=Number(ln.taxAmt!=null?ln.taxAmt:(twt-n))||0; net+=n; if(t>0) tax+=t;
        if(key==='receipts') add(anm(ln),0,n,ln.sub); else add(anm(ln),n,0,ln.sub); });
      if(tax>0.005){ if(key==='receipts') add('Output VAT',0,tax); else add('Input VAT',tax,0); }
      var bank=(key==='receipts')?rec.receivedIn:rec.paidFrom; var bn=bank?(String(bank)):'Cash & cash equivalents'; var total=Number(rec.amount||0)||(net+tax);
      if(key==='receipts') add(bn,total,0); else add(bn,0,total); }
    else if(key==='salesInv'||key==='creditNotes'){ var rev=(key==='creditNotes'); var nA=0,tA=0; lines.forEach(function(ln){ var n=Number(ln.net!=null&&ln.net!==''?ln.net:(ln.amount||0))||0; var t=Number(ln.taxAmt||0)||0; nA+=n; tA+=t; add(anm(ln), rev?n:0, rev?0:n); }); if(tA>0.005) add('Output VAT', rev?tA:0, rev?0:tA); var tot=nA+tA; add('Accounts receivable', rev?0:tot, rev?tot:0, rec.customer); }
    else if(key==='purchInv'||key==='debitNotes'){ var rev2=(key==='debitNotes'); var nB=0,tB=0; lines.forEach(function(ln){ var n=Number(ln.net!=null&&ln.net!==''?ln.net:(ln.amount||0))||0; var t=Number(ln.taxAmt||0)||0; nB+=n; tB+=t; add(anm(ln), rev2?0:n, rev2?n:0); }); if(tB>0.005) add('Input VAT', rev2?0:tB, rev2?tB:0); var tot2=nB+tB; add('Accounts payable', rev2?tot2:0, rev2?0:tot2, rec.supplier); }
    return out; },
  txnJournal(){ var b=this.curBiz(); var c=this.cfg(); var key=LABEL2KEY[this.wsSection]; var rec=this.records(b).find(r=>r.id===this.editingId); if(!rec) return; var self=this;
    var rows=this._txnLines(b,key,rec)||[]; var dr=0,cr=0; rows.forEach(function(r){ dr+=r.debit; cr+=r.credit; });
    var body = rows.length ? rows.map(function(r){ return '<tr><td>'+self.esc(r.account)+(r.sub?' <span style="color:#888">— '+self.esc(r.sub)+'</span>':'')+'</td><td class="r m">'+(r.debit?self.money(r.debit):'')+'</td><td class="r m">'+(r.credit?self.money(r.credit):'')+'</td></tr>'; }).join('')
      : '<tr><td colspan="3" style="color:#888;padding:12px">A transaction journal isn’t available for this document type.</td></tr>';
    var bal=Math.abs(dr-cr)<0.005;
    this._openOverlay('<div class="app-modal-h">Transaction journal — '+self.esc(rec.reference||(c&&c.singular)||'')+'</div><div class="app-modal-b"><table class="reg-tbl"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>'+body+'</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td>'+(rows.length?(bal?'<span style="color:#0b6b49">Balanced ✓</span>':'<span style="color:#b42318">Out of balance</span>'):'')+'</td><td class="r m">'+self.money(dr)+'</td><td class="r m">'+self.money(cr)+'</td></tr></tfoot></table></div><div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Close</button></div>'); },

  /* ----- copy to (create a related document) ----- */
  /* Copy to — the Manager.io matrix. Party, lines (item, account, description, qty, price, tax), tax options and
     reference are carried over; money/settlement state is not. */
  _copyTargets:{ salesQuotes:['salesOrders','salesInv'], salesOrders:['salesInv','deliveryNotes'], salesInv:['receipts','creditNotes','deliveryNotes'],
    purchQuotes:['purchOrders','purchInv'], purchOrders:['purchInv','goodsRec'], purchInv:['payments','debitNotes','goodsRec'],
    creditNotes:['salesInv'], debitNotes:['purchInv'], receipts:['payments'], payments:['receipts'], journal:['journal'] },
  copyToMenu(){ var self=this; var key=LABEL2KEY[this.wsSection]; var targets=(this._copyTargets[key]||[]).filter(function(t){ return KEY2LABEL[t]; });
    if(!targets.length){ alert('There is nothing to copy this document to.'); return; }
    var btns=targets.map(function(t){ var lbl=(REG[t]&&REG[t].singular)||KEY2LABEL[t]||t; return '<button class="btn" style="justify-content:flex-start" onclick="App.copyTo(\''+t+'\')">▸ New '+self.esc(lbl)+'</button>'; }).join('');
    this._openOverlay('<div class="app-modal-h">Copy to…</div><div class="app-modal-b"><div style="display:flex;flex-direction:column;gap:8px">'+btns+'</div></div><div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button></div>');
    var ov=document.getElementById('appOverlay'); if(ov&&ov.setAttribute) ov.setAttribute('data-nav-close','1'); },
  /* the prefill a "Copy to" opens the target form with (pure: no DOM) */
  copyPrefill(b,key,rec,targetKey){ rec=rec||{};
    var total=0; (rec.lines||[]).forEach(function(ln){ total+=Number(ln.amount||0)||0; }); if(!total) total=Number(rec.amount||rec.total||0)||0;
    var isSale=function(k){ return ['salesQuotes','salesOrders','salesInv','creditNotes','deliveryNotes'].indexOf(k)>=0; };
    var isPurch=function(k){ return ['purchQuotes','purchOrders','purchInv','debitNotes','goodsRec'].indexOf(k)>=0; };
    if(key==='salesInv'&&targetKey==='receipts'&&typeof TxnForms!=='undefined') return TxnForms.receiptPrefill(b,rec);
    if(key==='salesInv'&&targetKey==='receipts') return { date:rec.date, customer:rec.customer, paidBy:rec.customer, paidByType:'customer', receivedIn:'', lines:[{accountName:'Accounts receivable', sub:rec.customer, amount:total}] };
    if(key==='purchInv'&&targetKey==='payments'){ var due=null; try{ var row=settlementIndex(b,'sup').byUid[invUid(rec)]; if(row) due=row.outstanding; }catch(e){}
      if(due==null) due=(rec.balanceDue!=null&&rec.balanceDue!=='')?Number(rec.balanceDue):total; due=Math.round((Number(due)||0)*100)/100;
      var ap=(b.coa||[]).find(function(n){ return n.type==='account'&&/^accounts payable$/i.test(n.name||''); }); var uid=invUid(rec);
      return { date:new Date().toISOString().slice(0,10), payeeType:'supplier', payee:rec.supplier||rec.supName||'', supplier:rec.supplier||rec.supName||'',
        description:'Payment for purchase invoice '+(rec.reference||''), lines:[{ account:ap?ap.id:'', accountName:'Accounts payable', sub:rec.supplier||rec.supName||'', amount:due, price:due }],
        _keepAlloc:true, allocations:(due>0&&uid)?[{ key:'purchInv', uid:uid, party:rec.supplier||'', amount:due }]:[] }; }
    var pf=JSON.parse(JSON.stringify(rec));
    ['id','uuid','allocations','balanceDue','status','amount','_keepAlloc','withholdingAmt','paid'].forEach(function(k){ delete pf[k]; });
    if(targetKey===key) delete pf.reference;
    if(isSale(targetKey)){ pf.customer=rec.customer||rec.custName||''; if(pf.customer) pf.custName=pf.customer; }
    if(isPurch(targetKey)){ pf.supplier=rec.supplier||rec.supName||''; if(pf.supplier) pf.supName=pf.supplier; }
    if(pf.date==null&&pf.issueDate) pf.date=pf.issueDate; if(pf.issueDate==null&&pf.date) pf.issueDate=pf.date;
    pf.lines=(rec.lines||[]).filter(function(ln){ return ln&&!ln.rounding; }).map(function(ln){ var o=JSON.parse(JSON.stringify(ln));
      if(o.item==null&&o.items!=null) o.item=o.items; if(o.items==null&&o.item!=null) o.items=o.item;
      if(o.desc==null&&o.description!=null) o.desc=o.description; if(o.description==null&&o.desc!=null) o.description=o.desc;
      if((o.accountName==null||o.accountName==='')&&o.account){ try{ o.accountName=acctName(b,o.account)||''; }catch(e){} }
      if(o.accounts==null&&o.accountName) o.accounts=o.accountName;
      if((o.taxRate==null||o.taxRate==='')&&o.taxCode){ var tc=(b.taxCodes||[]).find(function(t){ return t&&t.name===o.taxCode; }); if(tc) o.taxRate=tc.rate; }
      return o; });
    pf.copiedFrom={ key:key, id:rec.id, reference:rec.reference||'' };
    return pf; },
  copyTo(targetKey){ this._closeOverlay(); var b=this.curBiz(); var key=LABEL2KEY[this.wsSection]; var rec=this.records(b).find(r=>r.id===this.editingId); if(!rec) return; var label=KEY2LABEL[targetKey]; if(!label){ alert('Cannot copy to that document.'); return; }
    var pf=this.copyPrefill(b,key,rec,targetKey);
    this._prefill=pf; this.recReturn=null; this.histReturn=false; this.wsSection=label; this.editingId=null; this.wsMode='form'; this.renderWorkspace(); },

  /* ----- customer / supplier ledger ----- */
  _navLabel(){ const b=this.curBiz();
    if(this.wsMode==='dashboard') return 'Dashboard';
    if(this.wsMode==='summary') return 'Summary';
    if(this.wsMode==='glledger'){ const a=acctById(b,this.glAcctId); return a?(a.name||'Account'):'Account'; }
    if(this.wsMode==='ledger'){ const rec=(this.records(b)||[]).find(r=>r.id===this.ledgerId); return rec?(rec.name||this.wsSection||'Ledger'):(this.wsSection||'Ledger'); }
    if(this.wsMode==='statement') return 'Statement';
    if(this.wsMode==='list') return this.wsSection||'List';
    return this.wsSection||''; },
  _pushTrail(){ this.navTrail=this.navTrail||[]; this.navTrail.push({label:this._navLabel(), snap:this._snapNav()}); },
  navTrailGo(i){ const t=this.navTrail||[]; const e=t[i]; if(!e) return; this.navTrail=t.slice(0,i); this._restoreNav(e.snap); },
  navBack(){ const t=this.navTrail||[]; if(t.length){ const e=t[t.length-1]; this.navTrail=t.slice(0,-1); this._restoreNav(e.snap); return; }
    if(this.wsMode==='statement'){ this.backFromStatement(); return; } if(this.wsMode==='glledger'){ this.backToSummary(); return; } if(this.wsMode==='ledger'){ this.backToList(); return; } this.backToSummary(); },
  trailCrumb(currentLabel, cls){ const t=this.navTrail||[]; const self=this;
    let parts=t.map(function(e,i){ return '<a class="led-link" onclick="App.navTrailGo('+i+')">'+self.esc(e.label)+'</a>'; });
    parts.push('<span style="color:#444;font-weight:600">'+this.esc(currentLabel||'')+'</span>');
    const back=t.length?'<button class="btn btn-xs" style="margin-right:10px" onclick="App.navBack()">◀ Back</button>':'';
    return '<div class="ws-crumb '+(cls||'')+'"><div class="left">'+back+''+App._crumbIco()+' '+parts.join(' <span style="color:#cbcbcb">▸</span> ')+'</div></div>'; },
  openLedger(id){ this._pushTrail(); this.recReturn=null; this.histReturn=false; this.ledgerId=id; this.ledgerReturn=null; this.ledgerQuery=''; this.ledgerFrom=''; this.ledgerTo=''; this.wsMode='ledger'; this.renderMain(this.curBiz()); },
  /* Billable Time / Withholding Tax Receipts are retired tabs (data.js RETIRED_SECTIONS): their old
     records still post, and a ledger / statement row of one opens this read-only view, never a form. */
  _isRetired(src){ return !!(typeof RETIRED_SECTIONS!=='undefined' && RETIRED_SECTIONS[src]); },
  retiredView(src,id){ const b=this.curBiz(); const c=(typeof REG!=='undefined'&&REG[src])||{}; const self=this;
    const rec=((b&&b.records&&b.records[src])||[]).find(r=>String(r.id)===String(id));
    if(!rec){ this._openOverlay('<div class="app-modal-h">'+this.esc(c.singular||'Record')+'</div><div class="app-modal-b"><p>This record no longer exists.</p></div><div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Close</button></div>'); return; }
    const val=(f)=>{ let v=rec[f.key]; if((v==null||v==='')&&f.key==='customer') v=rec.custName; if((v==null||v==='')&&f.key==='employee') v=rec.empName;
      if(f.type==='date') return self.esc(self.fmtDate?self.fmtDate(v):(v||''));
      if(f.type==='money') return self.esc(self.money(Number(v)||0));
      return self.esc(v==null?'':v); };
    let rows=(c.form||[]).map(f=>'<tr><th style="text-align:left;font-weight:500;color:var(--muted);padding:6px 12px 6px 0;white-space:nowrap">'+this.esc(f.label)+'</th><td class="'+(f.type==='money'?'m':'')+'" style="padding:6px 0">'+val(f)+'</td></tr>').join('');
    if(src==='billableTime'){ let a=0; try{ a=billableAmount(rec); }catch(e){} rows+='<tr><th style="text-align:left;font-weight:500;color:var(--muted);padding:6px 12px 6px 0">Amount</th><td class="m" style="padding:6px 0">'+this.esc(this.money(a))+'</td></tr>'; }
    this._openOverlay('<div class="app-modal-h">'+this.esc(c.singular||'Record')+(rec.reference?' '+this.esc(rec.reference):'')+'</div>'+
      '<div class="app-modal-b"><div class="info-bar" style="margin:0 0 10px">The '+this.esc(RETIRED_SECTIONS[src])+' tab has been removed. This older record is kept and still posts to the ledger; it can be viewed but not edited.</div>'+
      '<div class="tbl-scroll"><table class="retired-view" style="border-collapse:collapse;width:100%"><tbody>'+rows+'</tbody></table></div></div>'+
      '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Close</button></div>'); },
  ledgerOpen(src,id,mode){ if(this._isRetired(src)){ this.retiredView(src,id); return; } const label=Object.keys(LABEL2KEY).find(l=>LABEL2KEY[l]===src); if(!label) return;
    this.recReturn=this._snapNav(); this.ledgerReturn={section:this.wsSection,id:this.ledgerId}; this.wsSection=label; this.editingId=id; this.wsMode=(mode==='edit'?'form':'view'); this.listQuery=''; this.renderWorkspace(); },
  backFromRecord(){ if(this.recReturn){ var s=this.recReturn; this.recReturn=null; this.ledgerReturn=null; this.editingId=null; this._restoreNav(s); return true; } if(this.ledgerReturn){ const r=this.ledgerReturn; this.ledgerReturn=null; this.wsSection=r.section; this.ledgerId=r.id; this.editingId=null; this.wsMode='ledger'; this.renderWorkspace(); return true; } return false; },
  gotoRecord(src,id){ if(this._isRetired(src)){ this.retiredView(src,id); return; } const label=Object.keys(LABEL2KEY).find(l=>LABEL2KEY[l]===src); if(!label) return; this.wsSection=label; this.editingId=id; this.wsMode='view'; this.listQuery=''; this.renderWorkspace(); },
  ledgerEntries(b,key,rec){ const _gl=(typeof GL!=='undefined')?GL.partyEntries(b,key,rec):null; if(_gl) return _gl;   /* the general ledger is the one source */
    const R=b.records||{}; const e=[]; const name=rec&&rec.name;
    const cashHits=(recsKey,re,asDebit,label)=>{ (R[recsKey]||[]).forEach(r=>{ const lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,sub:r.sub,amount:r.amount}];
      let amt=0,hit=false; lns.forEach(ln=>{ if(acctNameMatches(b,ln.account,re)&&ln.sub===name){ amt+=Number(ln.amount)||0; hit=true; } });
      if(hit){ const nm=(recsKey==='receipts'?r.paidBy:r.payee); e.push({date:r.date,ref:r.reference,type:label+(nm&&nm!==name?' — '+nm:''),debit:asDebit?amt:0,credit:asDebit?0:amt,src:recsKey,id:r.id}); } }); };
    const jrnlHits=(re)=>{ (R.journal||[]).forEach(j=>{ let d=0,c=0,hit=false; (j.lines||[]).forEach(ln=>{ if(acctNameMatches(b,ln.account,re)&&ln.sub===name){ d+=Number(ln.debit)||0; c+=Number(ln.credit)||0; hit=true; } }); if(hit&&(d||c)) e.push({date:j.date,ref:j.reference,type:'Journal entry'+(j.narration?' — '+j.narration:''),debit:d,credit:c,src:'journal',id:j.id}); }); };
    if(key==='customers'){ (R.salesInv||[]).forEach(i=>{ if(i.customer===name) e.push({date:i.issueDate||i.date,ref:i.reference,type:'Sales invoice',debit:Number(i.total)||0,credit:0,src:'salesInv',id:i.id}); });
      (R.creditNotes||[]).forEach(c=>{ if(c.customer===name) e.push({date:c.date,ref:c.reference,type:'Credit note',debit:0,credit:Number(c.total)||0,src:'creditNotes',id:c.id}); });
      cashHits('receipts',AR_RE,false,'Receipt'); cashHits('payments',AR_RE,true,'Refund'); jrnlHits(AR_RE); }
    else if(key==='suppliers'){ (R.purchInv||[]).forEach(i=>{ if(i.supplier===name) e.push({date:i.issueDate||i.date,ref:i.reference,type:'Purchase invoice',debit:0,credit:Number(i.total)||0,src:'purchInv',id:i.id}); });
      (R.debitNotes||[]).forEach(d=>{ if(d.supplier===name) e.push({date:d.date,ref:d.reference,type:'Debit note',debit:Number(d.total)||0,credit:0,src:'debitNotes',id:d.id}); });
      cashHits('payments',AP_RE,true,'Payment'); cashHits('receipts',AP_RE,false,'Refund'); jrnlHits(AP_RE); }
    else if(key==='employees'){ (R.payslips||[]).forEach(p=>{ if(p.employee===name) e.push({date:p.date,ref:p.reference,type:'Payslip',debit:0,credit:Number(p.netPay!=null?p.netPay:p.total)||0,src:'payslips',id:p.id}); });
      cashHits('payments',EMP_RE,true,'Payment'); cashHits('receipts',EMP_RE,false,'Repayment'); jrnlHits(EMP_RE); }
    else if(key==='capital'){ cashHits('receipts',CAP_RE,false,'Contribution'); cashHits('payments',CAP_RE,true,'Drawing'); jrnlHits(CAP_RE); }
    else if(key==='bankCash'){ (R.receipts||[]).forEach(r=>{ if(bankMatch(r.receivedIn,rec)) e.push({date:r.date,ref:r.reference,type:'Receipt'+(r.paidBy?' — '+r.paidBy:''),debit:Number(r.amount)||0,credit:0,src:'receipts',id:r.id}); });
      (R.payments||[]).forEach(p=>{ if(bankMatch(p.paidFrom,rec)) e.push({date:p.date,ref:p.reference,type:'Payment'+(p.payee?' — '+p.payee:''),debit:0,credit:Number(p.amount)||0,src:'payments',id:p.id}); });
      (R.iat||[]).forEach(t=>{ if(bankMatch(t.receivedIn,rec)) e.push({date:t.date,ref:t.reference,type:'Inter-account transfer (in)',debit:Number(t.amount)||0,credit:0,src:'iat',id:t.id}); if(bankMatch(t.paidFrom,rec)) e.push({date:t.date,ref:t.reference,type:'Inter-account transfer (out)',debit:0,credit:Number(t.amount)||0,src:'iat',id:t.id}); }); }
    e.sort((x,y)=>String(x.date||'').localeCompare(String(y.date||'')) || String(x.ref||'').localeCompare(String(y.ref||''))); return e; },
  ledgerData(b){ const key=LABEL2KEY[this.wsSection]; const isC=key==='customers'; const isBank=key==='bankCash'; const isE=key==='employees'; const isCap=key==='capital'; const debitNat=isC||isBank;
    const rec=this.records(b).find(r=>r.id===this.ledgerId)||{}; const name=rec.name||''; const opening=Number(rec.balance)||0;
    const entries=this.ledgerEntries(b,key,rec);
    let bal=opening; const er=[]; entries.forEach(e=>{ bal += debitNat ? (e.debit-e.credit) : (e.credit-e.debit); er.push(Object.assign({},e,{bal})); });
    const sl=this.periodSlice(er,['bal']); const periodOpen=(sl.carried&&sl.carried.bal!=null)?sl.carried.bal:opening; const prows=sl.rows; const pa=!!(this.ledgerFrom||this.ledgerTo);
    const closing=prows.length?prows[prows.length-1].bal:periodOpen;
    let od=0,oc=0; if(debitNat){ if(periodOpen>=0) od=periodOpen; else oc=-periodOpen; } else { if(periodOpen>=0) oc=periodOpen; else od=-periodOpen; }
    const sumD=prows.reduce((a,e)=>a+e.debit,0)+od, sumC=prows.reduce((a,e)=>a+e.credit,0)+oc;
    const openRow={date:'',ref:'',type:(isBank?'Starting balance':'Opening balance')+(pa?' (brought forward)':''),debit:od,credit:oc,bal:periodOpen,src:'',id:null,opening:1};
    const q=(this.ledgerQuery||'').trim().toLowerCase();
    const match=r=>{ if(!q) return true; return [this.fmtDateUS(r.date),r.ref,r.type,this.money(r.debit),this.money(r.credit),this.money(r.bal)].join(' ').toLowerCase().indexOf(q)>=0; };
    const rows=prows.slice().reverse().filter(match); if(!q) rows.push(openRow); else if(match(openRow)) rows.push(openRow);
    return {rec,name,opening:periodOpen,closing,sumD,sumC,isC,isBank,debitNat,rows,count:prows.length,
      partyLabel:isBank?'Bank / cash account':(isC?'Customer':(isE?'Employee':(isCap?'Capital account':'Supplier'))),
      balLabel:isBank?'Actual balance':(isC?'Accounts receivable':(isE?'Employee clearing':(isCap?'Capital balance':'Accounts payable'))),
      stmtLabel:isBank?'Account transactions':(isC?'Customer statement':(isE?'Employee statement':(isCap?'Capital account statement':'Supplier statement')))}; },
  ledgerRowHtml(r){ const has=r.src&&r.id!=null;
    const acts=has?(App._isRetired(r.src)?'':'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'edit\')">Edit</button> ')+'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">View</button>':'';
    const refCell=(has&&r.ref)?'<a class="led-link" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">'+this.esc(r.ref)+'</a>':(r.ref?this.esc(r.ref):'<span style="color:#bbb">—</span>');
    return '<tr'+(r.opening?' style="color:#666"':'')+'><td class="act" style="white-space:nowrap">'+acts+'</td><td>'+this.esc(r.date?this.fmtDateUS(r.date):'')+'</td><td>'+refCell+'</td><td>'+this.esc(r.type)+'</td>'+
      '<td class="r m">'+(r.debit?this.money(r.debit):'')+'</td><td class="r m">'+(r.credit?this.money(r.credit):'')+'</td><td class="r m">'+this.money(r.bal)+'</td></tr>'; },
  ledgerBodyHtml(b){ const d=this.ledgerData(b); const _p=this._paginate(d.rows,'lPageSize','lPageNum');
    const body=d.rows.length?_p.rows.map(r=>this.ledgerRowHtml(r)).join(''):'<tr><td colspan="7"><div class="reg-empty">No entries match “'+this.esc(this.ledgerQuery||'')+'”.</div></td></tr>';
    const foot='<div class="reg-foot"><span class="cnt">'+d.count+'</span><button class="ftbtn" onclick="App.copyLedger()">Copy to clipboard</button><span class="total num">'+this.money(d.closing)+'</span></div>';
    return '<table class="reg-tbl"><thead><tr><th style="width:1%"></th><th>Date</th><th>Reference</th><th>Transaction</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="4">Closing balance</td><td class="r m">'+this.money(d.sumD)+'</td><td class="r m">'+this.money(d.sumC)+'</td><td class="r m">'+this.money(d.closing)+'</td></tr></tfoot></table>'+(d.rows.length?this._pagerBar(_p,'led'):'')+foot; },
  ledgerSearch(v){ this.ledgerQuery=v; const w=document.getElementById('ledgerBody'); if(w){ if(this.wsMode==='glledger'){ w.innerHTML=this.glLedgerBodyHtml(this.curBiz()); return; } const k=LABEL2KEY[this.wsSection]; w.innerHTML=(k==='inventory')?this.invLedgerBodyHtml(this.curBiz()):(k==='fixedAssets'?this.faLedgerBodyHtml(this.curBiz()):this.ledgerBodyHtml(this.curBiz())); } },
  copyLedger(){ const b=this.curBiz();
    if(this.wsMode==='glledger'){ const d=this.glLedgerData(b);
      const header=['Date','Reference','Transaction','Debit','Credit','Balance'].join('\t');
      const lines=d.rows.slice().reverse().map(r=>[r.date?this.fmtDateUS(r.date):'',r.ref||'',r.type,r.debit?this.money(r.debit):'',r.credit?this.money(r.credit):'',this.money(r.bal)].join('\t'));
      const tsv=[this.esc(d.name)+' — General ledger',header].concat(lines).join('\n');
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(()=>alert('Copied '+lines.length+' rows to clipboard.'),()=>alert(tsv)); } else alert(tsv); return; }
    if(LABEL2KEY[this.wsSection]==='fixedAssets'){ const d=this.faLedgerData(b);
      const header=['Date','Reference','Transaction','Acquisition cost','Depreciation','Book value'].join('\t');
      const lines=d.rows.map(r=>[r.date?this.fmtDateUS(r.date):'',r.ref||'',r.type,r.cost?this.money(r.cost):'',r.dep?this.money(r.dep):'',this.money(r.book)].join('\t'));
      const tsv=[this.esc(d.name)+' — Fixed asset',header].concat(lines).join('\n');
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(()=>alert('Copied '+lines.length+' rows to clipboard.'),()=>alert(tsv)); } else alert(tsv); return; }
    if(LABEL2KEY[this.wsSection]==='inventory'){ const d=this.invLedgerData(b);
      const header=['Date','Reference','Transaction','Qty in','Qty out','Qty balance','Cost in','Cost out','Cost balance'].join('\t');
      const lines=d.rows.map(r=>[r.date?this.fmtDateUS(r.date):'',r.ref||'',r.type,r.qin?this.numStr(r.qin):'',r.qout?this.numStr(r.qout):'',this.numStr(r.qbal),r.cin?this.money(r.cin):'',r.cout?this.money(r.cout):'',this.money(r.cbal)].join('\t'));
      const tsv=[this.esc(d.name)+' — Inventory movements',header].concat(lines).join('\n');
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(()=>alert('Copied '+lines.length+' rows to clipboard.'),()=>alert(tsv)); } else alert(tsv); return; }
    const d=this.ledgerData(b);
    const header=['Date','Reference','Transaction','Debit','Credit','Balance'].join('\t');
    const lines=d.rows.map(r=>[r.date?this.fmtDateUS(r.date):'',r.ref||'',r.type,r.debit?this.money(r.debit):'',r.credit?this.money(r.credit):'',this.money(r.bal)].join('\t'));
    const tsv=[this.esc(d.name)+' — '+d.stmtLabel,header].concat(lines).join('\n');
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(tsv).then(()=>alert('Copied '+lines.length+' rows to clipboard.'),()=>alert(tsv)); } else alert(tsv); },
  ledgerHtml(b){ const k=LABEL2KEY[this.wsSection]; if(k==='inventory') return this.invLedgerHtml(b); if(k==='fixedAssets') return this.faLedgerHtml(b);
    const d=this.ledgerData(b);
    return this.trailCrumb(d.name)+
      '<div class="card" style="max-width:880px">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+this.esc(d.name||d.partyLabel)+'</span>'+
        '<span style="color:#999;font-size:12px;margin-left:2px">'+this.esc(d.stmtLabel)+'</span>'+
        '<div class="reg-search"><span class="reg-adv">▸ Advanced Queries</span>'+
          '<input type="text" placeholder="Search" value="'+this.esc(this.ledgerQuery||'')+'" oninput="App.ledgerSearch(this.value)">'+
          '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>'+
      this.ledgerToolbar()+
      '<div id="ledgerBody">'+this.ledgerBodyHtml(b)+'</div></div>'; },
  invLedgerData(b){ const item=(this.records(b)||[]).find(r=>r.id===this.ledgerId)||{}; const m=invItemMovements(b,item);
    const opening=m.rows[0]||{qbal:0,cbal:0}, moves=m.rows.slice(1); const pa=!!(this.ledgerFrom||this.ledgerTo);
    const sl=this.periodSlice(moves,['qbal','cbal']);
    const carriedQ=(sl.carried&&sl.carried.qbal!=null)?sl.carried.qbal:(opening.qbal||0);
    const carriedC=(sl.carried&&sl.carried.cbal!=null)?sl.carried.cbal:(opening.cbal||0);
    const prows=sl.rows; const last=prows.length?prows[prows.length-1]:null;
    const closeQ=last?last.qbal:carriedQ, closeC=last?last.cbal:carriedC;
    const openRow = pa ? {opening:1,date:'',ref:'',type:'Balance brought forward',qin:0,qout:0,qbal:carriedQ,cin:0,cout:0,cbal:carriedC,src:'',id:null} : opening;
    const q=(this.ledgerQuery||'').trim().toLowerCase();
    const match=r=>{ if(!q) return true; return [this.fmtDateUS(r.date),r.ref,r.type].join(' ').toLowerCase().indexOf(q)>=0; };
    const rows=prows.slice().reverse().filter(match); if(!q||match(openRow)) rows.push(openRow);
    return {item,name:item.name||'',rows,count:prows.length,stats:{qtyOnHand:closeQ,avgCost:(closeQ?closeC/closeQ:0),totalCost:closeC}}; },
  invLedgerRowHtml(r){ const has=r.src&&r.id!=null;
    const acts=has?(App._isRetired(r.src)?'':'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'edit\')">Edit</button> ')+'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">View</button>':'';
    const refCell=(has&&r.ref)?'<a class="led-link" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">'+this.esc(r.ref)+'</a>':(r.ref?this.esc(r.ref):'<span style="color:#bbb">—</span>');
    return '<tr'+(r.opening?' style="color:#666"':'')+'><td class="act" style="white-space:nowrap">'+acts+'</td><td>'+this.esc(r.date?this.fmtDateUS(r.date):'')+'</td><td>'+refCell+'</td><td>'+this.esc(r.type)+'</td>'+
      '<td class="r m">'+(r.qin?this.numStr(r.qin):'')+'</td><td class="r m">'+(r.qout?this.numStr(r.qout):'')+'</td><td class="r m">'+this.numStr(r.qbal)+'</td>'+
      '<td class="r m">'+(r.cin?this.money(r.cin):'')+'</td><td class="r m">'+(r.cout?this.money(r.cout):'')+'</td><td class="r m">'+this.money(r.cbal)+'</td></tr>'; },
  invLedgerBodyHtml(b){ const d=this.invLedgerData(b); const s=d.stats; const _p=this._paginate(d.rows,'lPageSize','lPageNum');
    const body=d.rows.length?_p.rows.map(r=>this.invLedgerRowHtml(r)).join(''):'<tr><td colspan="10"><div class="reg-empty">No stock movements yet.</div></td></tr>';
    const foot='<div class="reg-foot"><span class="cnt">'+d.count+'</span><button class="ftbtn" onclick="App.copyLedger()">Copy to clipboard</button><span class="total num">Avg cost '+this.money(s.avgCost)+' · Total cost '+this.money(s.totalCost)+'</span></div>';
    return '<div style="overflow-x:auto"><table class="reg-tbl"><thead><tr><th style="width:1%"></th><th>Date</th><th>Reference</th><th>Transaction</th><th class="r">Qty in</th><th class="r">Qty out</th><th class="r">Qty balance</th><th class="r">Cost in</th><th class="r">Cost out</th><th class="r">Cost balance</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="6">Qty on hand / Total cost</td><td class="r m">'+this.numStr(s.qtyOnHand)+'</td><td class="r m"></td><td class="r m"></td><td class="r m">'+this.money(s.totalCost)+'</td></tr></tfoot></table></div>'+(d.rows.length?this._pagerBar(_p,'led'):'')+foot; },
  invLedgerHtml(b){ const d=this.invLedgerData(b);
    return this.trailCrumb(d.name)+
      '<div class="card" style="max-width:1080px">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+this.esc(d.name||'Item')+'</span>'+
        '<span style="color:#999;font-size:12px;margin-left:2px">Inventory movements — Weighted average cost</span>'+
        '<div class="reg-search"><span class="reg-adv">▸ Advanced Queries</span>'+
          '<input type="text" placeholder="Search" value="'+this.esc(this.ledgerQuery||'')+'" oninput="App.ledgerSearch(this.value)">'+
          '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>'+
      this.ledgerToolbar()+
      '<div id="ledgerBody">'+this.invLedgerBodyHtml(b)+'</div></div>'; },
  faLedgerData(b){ const asset=(this.records(b)||[]).find(r=>r.id===this.ledgerId)||{}; const R=b.records||{}; const name=asset.name||'';
    const cost0=Number(asset.cost)||0, openDep=Number(asset.accumDep)||0;
    const ev=[]; (R.depreciation||[]).forEach(d=>{ (d.lines||[]).forEach(ln=>{ if(ln.asset===name){ const a=Number(ln.amount)||0; if(a) ev.push({date:d.date,ref:d.reference,dep:a,desc:ln.desc,src:'depreciation',id:d.id}); } }); });
    (R.payments||[]).forEach(d=>{ (d.lines||[]).forEach(ln=>{ if(ln.sub===name && acctNameMatches(b,ln.account,FAC_RE)){ const a=Number(ln.amount)||0; if(a) ev.push({date:d.date,ref:d.reference,cost:a,party:d.payee,src:'payments',id:d.id}); } }); });
    (R.receipts||[]).forEach(d=>{ (d.lines||[]).forEach(ln=>{ if(ln.sub===name && acctNameMatches(b,ln.account,FAC_RE)){ const a=Number(ln.amount)||0; if(a) ev.push({date:d.date,ref:d.reference,cost:-a,party:d.paidBy,src:'receipts',id:d.id}); } }); });
    (R.journal||[]).forEach(d=>{ (d.lines||[]).forEach(ln=>{ if(ln.sub===name && acctNameMatches(b,ln.account,FAC_RE)){ const a=(Number(ln.debit)||0)-(Number(ln.credit)||0); if(a) ev.push({date:d.date,ref:d.reference,cost:a,lbl:'Journal entry',src:'journal',id:d.id}); } }); });
    ev.sort((x,y)=>String(x.date||'').localeCompare(String(y.date||''))||String(x.ref||'').localeCompare(String(y.ref||'')));
    let rc=cost0, dep=openDep; const all=[{opening:1,date:asset.acqDate||'',type:'Acquisition / opening',cost:cost0,dep:openDep,book:cost0-openDep,rcost:cost0,rdep:openDep,src:'',id:null}];
    ev.forEach(e=>{ if(e.dep!=null){ dep+=e.dep; all.push({date:e.date,ref:e.ref,type:'Depreciation'+(e.desc?' — '+e.desc:''),cost:0,dep:e.dep,book:rc-dep,rcost:rc,rdep:dep,src:e.src,id:e.id}); }
      else { rc+=e.cost; all.push({date:e.date,ref:e.ref,type:e.lbl?e.lbl:((e.cost>=0?'Cash purchase':'Cash disposal')+(e.party?' — '+e.party:'')),cost:e.cost,dep:0,book:rc-dep,rcost:rc,rdep:dep,src:e.src,id:e.id}); } });
    const q=(this.ledgerQuery||'').trim().toLowerCase();
    const match=r=>{ if(!q) return true; return [this.fmtDateUS(r.date),r.ref,r.type].join(' ').toLowerCase().indexOf(q)>=0; };
    const opening0=all[0], moves=all.slice(1); const pa=!!(this.ledgerFrom||this.ledgerTo);
    const sl=this.periodSlice(moves,['book','rcost','rdep']);
    const carriedCost=(sl.carried&&sl.carried.rcost!=null)?sl.carried.rcost:cost0;
    const carriedDep=(sl.carried&&sl.carried.rdep!=null)?sl.carried.rdep:openDep;
    const prows=sl.rows; const last=prows.length?prows[prows.length-1]:null;
    const closeCost=last?last.rcost:carriedCost, closeDep=last?last.rdep:carriedDep;
    const opening = pa ? {opening:1,date:'',ref:'',type:'Balance brought forward',cost:carriedCost,dep:carriedDep,book:carriedCost-carriedDep,src:'',id:null} : opening0;
    const rows=prows.slice().reverse().filter(match); if(!q||match(opening)) rows.push(opening);
    return {asset,name,rows,count:prows.length,cost:closeCost,accum:closeDep,book:closeCost-closeDep}; },
  faLedgerRowHtml(r){ const has=r.src&&r.id!=null;
    const acts=has?(App._isRetired(r.src)?'':'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'edit\')">Edit</button> ')+'<button class="btn btn-xs" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">View</button>':'';
    const refCell=(has&&r.ref)?'<a class="led-link" onclick="App.ledgerOpen(\''+r.src+'\','+r.id+',\'view\')">'+this.esc(r.ref)+'</a>':(r.ref?this.esc(r.ref):'<span style="color:#bbb">—</span>');
    return '<tr'+(r.opening?' style="color:#666"':'')+'><td class="act" style="white-space:nowrap">'+acts+'</td><td>'+this.esc(r.date?this.fmtDateUS(r.date):'')+'</td><td>'+refCell+'</td><td>'+this.esc(r.type)+'</td>'+
      '<td class="r m">'+(r.cost?this.money(r.cost):'')+'</td><td class="r m">'+(r.dep?this.money(r.dep):'')+'</td><td class="r m">'+this.money(r.book)+'</td></tr>'; },
  faLedgerBodyHtml(b){ const d=this.faLedgerData(b); const _p=this._paginate(d.rows,'lPageSize','lPageNum');
    const body=d.rows.length?_p.rows.map(r=>this.faLedgerRowHtml(r)).join(''):'<tr><td colspan="7"><div class="reg-empty">No entries.</div></td></tr>';
    const foot='<div class="reg-foot"><span class="cnt">'+d.count+'</span><button class="ftbtn" onclick="App.copyLedger()">Copy to clipboard</button><span class="total num">Book value '+this.money(d.book)+'</span></div>';
    return '<table class="reg-tbl"><thead><tr><th style="width:1%"></th><th>Date</th><th>Reference</th><th>Transaction</th><th class="r">Acquisition cost</th><th class="r">Depreciation</th><th class="r">Book value</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="4">Cost / Accum. dep / Book value</td><td class="r m">'+this.money(d.cost)+'</td><td class="r m">'+this.money(d.accum)+'</td><td class="r m">'+this.money(d.book)+'</td></tr></tfoot></table>'+(d.rows.length?this._pagerBar(_p,'led'):'')+foot; },
  faLedgerHtml(b){ const d=this.faLedgerData(b);
    return this.trailCrumb(d.name)+
      '<div class="card" style="max-width:920px">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+this.esc(d.name||'Asset')+'</span>'+
        '<span style="color:#999;font-size:12px;margin-left:2px">Fixed asset — cost & depreciation</span>'+
        '<div class="reg-search"><span class="reg-adv">▸ Advanced Queries</span>'+
          '<input type="text" placeholder="Search" value="'+this.esc(this.ledgerQuery||'')+'" oninput="App.ledgerSearch(this.value)">'+
          '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>'+
      this.ledgerToolbar()+
      '<div id="ledgerBody">'+this.faLedgerBodyHtml(b)+'</div></div>'; },
  periodSlice(chrono, balFields){ const from=this.ledgerFrom||'', to=this.ledgerTo||''; if(!from&&!to) return {carried:null, rows:chrono.slice()};
    const carried={}; const rows=[]; let any=false;
    chrono.forEach(r=>{ const d=r.date||'';
      if(from){ if(!d || d<from){ balFields.forEach(f=>{ if(r[f]!=null) carried[f]=r[f]; }); any=true; return; } }
      if(to && d && d>to) return; rows.push(r); });
    return {carried:any?carried:null, rows}; },
  ledgerToolbar(){ return '<div class="led-tools" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 2px;padding:8px 10px;background:#fafafa;border:1px solid var(--line);border-radius:8px">'+
      '<span style="flex:1"></span>'+
      '<button class="btn btn-sm btn-primary" style="box-shadow:0 2px 6px rgba(0,0,0,.13)" onclick="App.viewStatement()">📄 View / print statement</button></div>'; },
  ledgerPeriodChange(which,val){ if(which==='from') this.ledgerFrom=val; else this.ledgerTo=val; this.renderMain(this.curBiz()); },
  ledgerPeriodClear(){ this.ledgerFrom=''; this.ledgerTo=''; this.renderMain(this.curBiz()); },
  backToSummary(){ this.navTrail=[]; this.recReturn=null; this.wsMode='summary'; this.wsSection='Summary'; this.glAcctId=null; this.ledgerFrom=''; this.ledgerTo=''; this.renderMain(this.curBiz()); },
  glLedgerData(b){ const g=glEntries(b,this.glAcctId); const acct=g.acct||{}; const nat=acctNature(b,acct); const debitNat=nat==='D';
    let bal=g.opening; const er=[]; g.rows.forEach(e=>{ bal+= debitNat?(e.debit-e.credit):(e.credit-e.debit); er.push(Object.assign({},e,{bal})); });
    const sl=this.periodSlice(er,['bal']); const periodOpen=(sl.carried&&sl.carried.bal!=null)?sl.carried.bal:g.opening; const prows=sl.rows;
    const closing=prows.length?prows[prows.length-1].bal:periodOpen;
    let od=0,oc=0; if(debitNat){ if(periodOpen>=0) od=periodOpen; else oc=-periodOpen; } else { if(periodOpen>=0) oc=periodOpen; else od=-periodOpen; }
    const sumD=prows.reduce((a,e)=>a+e.debit,0)+od, sumC=prows.reduce((a,e)=>a+e.credit,0)+oc;
    const openRow={date:'',ref:'',type:'Opening balance',debit:od,credit:oc,bal:periodOpen,src:'',id:null,opening:1};
    const q=(this.ledgerQuery||'').trim().toLowerCase();
    const match=r=>{ if(!q) return true; return [this.fmtDateUS(r.date),r.ref,r.type,this.money(r.debit),this.money(r.credit),this.money(r.bal)].join(' ').toLowerCase().indexOf(q)>=0; };
    const rows=prows.slice().reverse().filter(match); if(!q||match(openRow)) rows.push(openRow);
    return {acct,name:g.name,opening:periodOpen,closing,sumD,sumC,rows,count:prows.length,debitNat,nat}; },
  glLedgerBodyHtml(b){ const d=this.glLedgerData(b); const _p=this._paginate(d.rows,'lPageSize','lPageNum');
    const body=d.rows.length?_p.rows.map(r=>this.ledgerRowHtml(r)).join(''):'<tr><td colspan="7"><div class="reg-empty">No postings'+((this.ledgerFrom||this.ledgerTo)?' in this period':' to this account')+'.</div></td></tr>';
    const foot='<div class="reg-foot"><span class="cnt">'+d.count+'</span><button class="ftbtn" onclick="App.copyLedger()">Copy to clipboard</button><span class="total num">'+this.money(d.closing)+'</span></div>';
    return '<table class="reg-tbl"><thead><tr><th style="width:1%"></th><th>Date</th><th>Reference</th><th>Transaction</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="4">Closing balance</td><td class="r m">'+this.money(d.sumD)+'</td><td class="r m">'+this.money(d.sumC)+'</td><td class="r m">'+this.money(d.closing)+'</td></tr></tfoot></table>'+(d.rows.length?this._pagerBar(_p,'led'):'')+foot; },
  glLedgerHtml(b){ const d=this.glLedgerData(b); const natLbl=d.nat==='D'?'Debit (Dr) balance':'Credit (Cr) balance';
    const _acct=acctById(b,this.glAcctId)||{}; const _subSrc=App._subSourceForAccount(_acct.name||'');
    const _txActive = !(_subSrc && this.glTab==='sub'); const _sh='box-shadow:0 2px 6px rgba(0,0,0,.13)';
    const _btns = '<div class="ws-tabrow" style="margin-bottom:12px;gap:8px">'+
        (_subSrc?('<button class="btn btn-sm'+(this.glTab==='sub'?' btn-primary':'')+'" style="'+_sh+'" onclick="App.setGlTab(\'sub\')">Sub accounts</button>'):'')+
        '<button class="btn btn-sm'+(_txActive?' btn-primary':'')+'" style="'+_sh+'" onclick="App.setGlTab(\'tx\')">Transactions ledger</button>'+
        '<button class="btn btn-sm" style="'+_sh+'" onclick="App.viewStatement()">📄 Statement</button></div>';
    const _inner = (_subSrc && this.glTab==='sub') ? ('<div id="ledgerBody">'+this.glSubAccountsHtml(b)+'</div>') : ('<div id="ledgerBody">'+this.glLedgerBodyHtml(b)+'</div>');
    return this.trailCrumb(d.name)+
      '<div class="card" style="max-width:920px">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+this.esc(d.name||'Account')+'</span>'+
        '<span style="color:#999;font-size:12px;margin-left:2px">General ledger — '+natLbl+'</span>'+
        '<div class="reg-search"><span class="reg-adv">▸ Advanced Queries</span>'+
          '<input type="text" placeholder="Search" value="'+this.esc(this.ledgerQuery||'')+'" oninput="App.ledgerSearch(this.value)">'+
          '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>'+
      _btns + _inner + '</div>'; },
  setGlTab(t){ this.glTab=t; this.ledgerQuery=''; this.renderMain(this.curBiz()); },
  glToolbar(){ return '<div class="led-tools" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 2px;padding:8px 10px;background:#fafafa;border:1px solid var(--line);border-radius:8px">'+
    '<span style="color:#888;font-size:12px">Choose a date range when you open the statement.</span><span style="flex:1"></span>'+
    '<button class="btn btn-sm btn-primary" onclick="App.viewStatement()">📄 View / print statement</button></div>'; },
  openSubLedger(src,id){ this._pushTrail(); var map={customer:'Customers',supplier:'Suppliers',capital:'Capital Accounts',employee:'Employees',item:'Inventory Items',fixedAsset:'Fixed Assets'};
    var label=map[src]; if(!label) return; var key=LABEL2KEY[label]; var b=this.curBiz();
    var rec=((b.records&&b.records[key])||[]).find(function(r){ return r.id===id; }); if(!rec) return;
    this.wsSection=label; this.ledgerId=rec.id; this.ledgerQuery=''; this.ledgerFrom=''; this.ledgerTo=''; this.ledgerReturn=null; this.wsMode='ledger'; this.renderMain(b); },
  glSubAccountsHtml(b){ const acct=acctById(b,this.glAcctId)||{}; const src=App._subSourceForAccount(acct.name||''); const R=b.records||{}; let rows=[];
    if(src==='customer'){ (R.customers||[]).forEach(c=>rows.push({name:c.name,val:customerBalance(b,c.name),id:c.id})); }
    else if(src==='supplier'){ (R.suppliers||[]).forEach(c=>rows.push({name:c.name,val:supplierBalance(b,c.name),id:c.id})); }
    else if(src==='capital'){ (R.capital||[]).forEach(c=>rows.push({name:c.name,val:capitalBalance(b,c.name),id:c.id})); }
    else if(src==='employee'){ (R.employees||[]).forEach(c=>rows.push({name:c.name,val:employeeBalance(b,c.name),id:c.id})); }
    else if(src==='item'){ (R.inventory||[]).forEach(it=>rows.push({name:it.name,val:invItemStats(b,it).totalCost,id:it.id})); }
    else if(src==='fixedAsset'){ (R.fixedAssets||[]).forEach(a=>rows.push({name:a.name,val:faBookValue(b,a),id:a.id})); }
    rows=rows.filter(r=>r.name); const total=rows.reduce((a,r)=>a+(Number(r.val)||0),0);
    const q=(this.ledgerQuery||'').trim().toLowerCase(); let vis=q?rows.filter(r=>String(r.name).toLowerCase().indexOf(q)>=0):rows;
    const lnk=(r,inner)=>(r.id!=null?'<a class="led-link" onclick="App.openSubLedger(\''+src+'\','+r.id+')" title="Open this sub-account ledger">'+inner+'</a>':inner);
    const body=vis.length?vis.map(r=>'<tr><td></td><td>'+lnk(r,this.esc(r.name))+'</td><td class="r m">'+lnk(r,this.money(r.val))+'</td></tr>').join(''):'<tr><td colspan="3"><div class="reg-empty">No sub-accounts under this control account yet.</div></td></tr>';
    return '<table class="reg-tbl"><thead><tr><th style="width:1%"></th><th>Sub-account</th><th class="r">Balance</th></tr></thead><tbody>'+body+'</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="2">Total — '+this.esc(acct.name||'')+'</td><td class="r m">'+this.money(total)+'</td></tr></tfoot></table>'+'<div class="reg-foot"><span class="cnt">'+vis.length+'</span><span class="total num">'+this.money(total)+'</span></div>'; },
  openGL(acctId){ this._pushTrail(); this.recReturn=null; this.histReturn=false; this.glAcctId=acctId; this.glTab='sub'; this.ledgerQuery=''; this.ledgerFrom=''; this.ledgerTo=''; this.ledgerReturn=null; this.wsMode='glledger'; this.renderMain(this.curBiz()); },
  viewStatement(){ this._pushTrail(); this.statementReturn=(this.wsMode==='glledger')?'glledger':'ledger'; this.wsMode='statement'; this.renderMain(this.curBiz()); },
  backFromStatement(){ this.wsMode=this.statementReturn||'ledger'; this.renderMain(this.curBiz()); },
  statementData(b){
    const kind = this.statementReturn==='glledger' ? 'gl' : LABEL2KEY[this.wsSection];
    const d0=b.details||{}; const bizName=d0.legalName||d0.name||b.name||'Business'; const bizAddr=d0.address||'';
    const M=v=>this.money(v), N=v=>this.numStr(v), D=x=>x?this.fmtDateUS(x):'';
    const period=(this.ledgerFrom||this.ledgerTo)?((this.ledgerFrom?this.fmtDateUS(this.ledgerFrom):'Start')+'  to  '+(this.ledgerTo?this.fmtDateUS(this.ledgerTo):'Today')):'All dates';
    let title='',subtitle='',cols,rows,totals,colW;
    if(kind==='inventory'){ const d=this.invLedgerData(b); title=d.name; subtitle='Inventory Movements — Weighted Average Cost';
      cols=[{l:'Date'},{l:'Reference'},{l:'Transaction'},{l:'Qty In',r:1},{l:'Qty Out',r:1},{l:'Qty Balance',r:1},{l:'Cost In',r:1},{l:'Cost Out',r:1},{l:'Cost Balance',r:1}]; colW=[1.3,1.3,3,1,1,1.1,1.2,1.2,1.3];
      rows=d.rows.slice().reverse().map(r=>({op:!!r.opening,cells:[D(r.date),r.ref||'',r.type,r.qin?N(r.qin):'',r.qout?N(r.qout):'',N(r.qbal),r.cin?M(r.cin):'',r.cout?M(r.cout):'',M(r.cbal)]}));
      totals=['Closing balance','','','','',N(d.stats.qtyOnHand),'','',M(d.stats.totalCost)];
    } else if(kind==='fixedAssets'){ const d=this.faLedgerData(b); title=d.name; subtitle='Fixed Asset — Cost & Depreciation Schedule';
      cols=[{l:'Date'},{l:'Reference'},{l:'Transaction'},{l:'Acquisition Cost',r:1},{l:'Depreciation',r:1},{l:'Book Value',r:1}]; colW=[1.3,1.3,3.4,1.4,1.4,1.4];
      rows=d.rows.slice().reverse().map(r=>({op:!!r.opening,cells:[D(r.date),r.ref||'',r.type,r.cost?M(r.cost):'',r.dep?M(r.dep):'',M(r.book)]}));
      totals=['Closing balance','','',M(d.cost),M(d.accum),M(d.book)];
    } else { const d=(kind==='gl')?this.glLedgerData(b):this.ledgerData(b); title=d.name;
      subtitle=(kind==='gl')?'General Ledger':(kind==='customers'?'Customer Statement of Account':(kind==='suppliers'?'Supplier Statement of Account':(kind==='bankCash'?'Bank / Cash Account Statement':(kind==='employees'?'Employee Statement':(kind==='capital'?'Capital Account Statement':'Account Statement')))));
      cols=[{l:'Date'},{l:'Reference'},{l:'Transaction'},{l:'Debit',r:1},{l:'Credit',r:1},{l:'Balance',r:1}]; colW=[1.3,1.4,3.4,1.4,1.4,1.5];
      rows=d.rows.slice().reverse().map(r=>({op:!!r.opening,cells:[D(r.date),r.ref||'',r.type,r.debit?M(r.debit):'',r.credit?M(r.credit):'',M(r.bal)]}));
      totals=['Closing balance','','',M(d.sumD),M(d.sumC),M(d.closing)]; }
    const sCfg=this.stmtCfg(b); if(sCfg&&sCfg.title) subtitle=sCfg.title;
    if(!this.stmtShow(b,'opening')) rows=rows.filter(r=>!r.op);
    return {kind,bizName,bizAddr,title,subtitle,period,cols,rows,totals,colW}; },
  statementHtml(b){ const d=this.statementData(b); const e=s=>this.esc(s);
    const headRow='<tr>'+d.cols.map(c=>'<th'+(c.r?' class="r"':'')+'>'+e(c.l)+'</th>').join('')+'</tr>';
    const bodyRows=d.rows.map(r=>'<tr'+(r.op?' class="op"':'')+'>'+r.cells.map((v,i)=>'<td'+(d.cols[i].r?' class="r"':'')+'>'+e(v)+'</td>').join('')+'</tr>').join('');
    const totRow='<tr class="tot">'+d.totals.map((v,i)=>'<td'+(d.cols[i].r?' class="r"':'')+'>'+e(v)+'</td>').join('')+'</tr>';
    const logo=(b.details&&b.details.logo&&this.stmtShow(b,'logo'))?'<img src="'+e(b.details.logo)+'" style="max-height:54px;max-width:180px;object-fit:contain">':'';
    const showAddr=this.stmtShow(b,'address'); const showGen=this.stmtShow(b,'generated');
    return this.trailCrumb('Statement','no-print')+
      '<div class="stmt-bar no-print">'+
        '<button class="btn btn-sm" onclick="App.backFromStatement()">◀ Back</button>'+
        '<span style="color:#666;font-size:12px;font-weight:600;margin-left:6px">Period</span>'+
        '<input type="date" value="'+e(this.ledgerFrom||'')+'" onchange="App.ledgerPeriodChange(\'from\',this.value)">'+
        '<span style="color:#999">–</span>'+
        '<input type="date" value="'+e(this.ledgerTo||'')+'" onchange="App.ledgerPeriodChange(\'to\',this.value)">'+
        ((this.ledgerFrom||this.ledgerTo)?'<button class="btn btn-xs" onclick="App.ledgerPeriodClear()">Clear</button>':'')+
        '<span style="flex:1"></span>'+
        '<button class="btn btn-sm btn-primary" onclick="App.printStatement()">🖨 Print</button>'+
        '<button class="btn btn-sm" title="Opens the print dialog — choose “Save as PDF” as the destination" onclick="App.pdfStatement()">📄 Save as PDF</button>'+
        '<button class="btn btn-sm" onclick="App.excelStatement()">⬇ Excel</button>'+
      '</div>'+
      '<div id="stmtDoc" class="stmt-doc">'+
        ((showAddr||logo)?('<div class="stmt-head"><div>'+(showAddr?'<div class="stmt-biz">'+e(d.bizName)+'</div>'+(d.bizAddr?'<div class="stmt-addr">'+e(d.bizAddr).replace(/\n/g,'<br>')+'</div>':''):'')+'</div>'+(logo?'<div>'+logo+'</div>':'')+'</div>'):'')+
        '<div class="stmt-title">'+e(d.subtitle)+'</div>'+
        '<div class="stmt-meta"><div><span class="lbl">Account</span> '+e(d.title)+'</div><div><span class="lbl">Period</span> '+e(d.period)+'</div></div>'+
        '<table class="stmt-tbl"><thead>'+headRow+'</thead><tbody>'+bodyRows+'</tbody><tfoot>'+totRow+'</tfoot></table>'+
        (showGen?'<div class="stmt-genfoot">Generated on '+e(this.fmtDateUS(new Date().toISOString().slice(0,10)))+'</div>':'')+
      '</div>'; },
  printStatement(){ var el=document.getElementById('stmtDoc'); if(!el){ try{ window.print(); }catch(e){} return; } var pr=document.getElementById('printRegion'); if(!pr){ pr=document.createElement('div'); pr.id='printRegion'; document.body.appendChild(pr); } pr.innerHTML='<div class="card rep-print">'+el.innerHTML+'</div>'; var d=this.statementData(this.curBiz()); var oldt=document.title; document.title=(d.title||'Statement')+' — '+(d.subtitle||''); var clean=function(){ try{ pr.innerHTML=''; }catch(e){} document.title=oldt; window.removeEventListener('afterprint',clean); }; window.addEventListener('afterprint',clean); setTimeout(function(){ try{ window.print(); }catch(e){} setTimeout(clean,1500); },80); },
  _loadScript(src,onload,onerror){ const s=document.createElement('script'); s.src=src; s.async=true; s.onload=onload; s.onerror=onerror||onload; document.head.appendChild(s); },
  pdfStatement(){ this.printStatement(); },
  excelStatement(){ const d=this.statementData(this.curBiz());
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const num=v=>String(v==null?'':v).replace(/[^0-9.\-]/g,''); const span=d.cols.length;
    let h='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1" cellspacing="0">';
    h+='<tr><td colspan="'+span+'" style="font-size:15px;font-weight:bold">'+esc(d.bizName)+'</td></tr>';
    if(d.bizAddr) h+='<tr><td colspan="'+span+'">'+esc(d.bizAddr.replace(/\n/g,', '))+'</td></tr>';
    h+='<tr><td colspan="'+span+'" style="font-weight:bold">'+esc(d.subtitle)+'</td></tr>';
    h+='<tr><td colspan="'+span+'">Account: '+esc(d.title)+'   |   Period: '+esc(d.period)+'</td></tr><tr><td colspan="'+span+'"></td></tr>';
    h+='<tr>'+d.cols.map(c=>'<th style="background:#262626;color:#ffffff">'+esc(c.l)+'</th>').join('')+'</tr>';
    d.rows.forEach(r=>{ h+='<tr>'+r.cells.map((v,i)=>{ const rr=d.cols[i].r; return rr?'<td style="text-align:right">'+num(v)+'</td>':'<td>'+esc(v)+'</td>'; }).join('')+'</tr>'; });
    h+='<tr>'+d.totals.map((v,i)=>{ const rr=d.cols[i].r; return '<td style="font-weight:bold'+(rr?';text-align:right':'')+'">'+(rr?num(v):esc(v))+'</td>'; }).join('')+'</tr>';
    h+='</table></body></html>';
    const blob=new Blob([h],{type:'application/vnd.ms-excel;charset=utf-8'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=(d.title||'statement').replace(/[^A-Za-z0-9]+/g,'_')+'.xls'; document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },150); },
  gotoNew(src){ const label=Object.keys(LABEL2KEY).find(l=>LABEL2KEY[l]===src); if(!label) return;
    if(this.wsMode==='ledger'){ this.ledgerReturn={section:this.wsSection,id:this.ledgerId};
      const b=this.curBiz(); const lkey=LABEL2KEY[this.wsSection]; const rec=(this.records(b)||[]).find(r=>r.id===this.ledgerId);
      if(rec){ const pf={};
        const ctrlLine=(nm)=>{ const ca=(b.coa||[]).find(x=>x.type==='account'&&x.name.toLowerCase()===nm.toLowerCase()); return {account:ca?ca.id:'',sub:rec.name,amount:''}; };
        if(lkey==='bankCash'){ if(src==='receipts') pf.receivedIn=rec.name; if(src==='payments') pf.paidFrom=rec.name; }
        else if(lkey==='customers'){ if(src==='salesInv'||src==='creditNotes') pf.customer=rec.name; else pf.lines=[ctrlLine('Accounts receivable')]; }
        else if(lkey==='suppliers'){ if(src==='purchInv'||src==='debitNotes') pf.supplier=rec.name; else pf.lines=[ctrlLine('Accounts payable')]; }
        else if(lkey==='capital') pf.lines=[ctrlLine('Capital accounts')];
        else if(lkey==='employees'){ if(src==='payslips') pf.employee=rec.name; else pf.lines=[ctrlLine('Employee clearing account')]; }
        this._prefill=pf; } }
    this.wsSection=label; this.editingId=null; this.wsMode='form'; this.listQuery=''; this.renderWorkspace(); },

  /* ----- reports ----- */
  openReport(key){ this.repView=key; this.repMode='list'; this.repInst=null; this.renderMain(this.curBiz()); },
  reportsBack(){ this.repView=null; this.repMode='list'; this.repInst=null; this.renderMain(this.curBiz()); },
  reportsHtml(b){
    var v=this.repView;
    if(v&&this._REPDEF[v]){ if(this.repMode==='edit') return this.reportEditHtml(b,v,this.repInst); if(this.repMode==='view') return this.reportViewHtml(b,v,this.repInst); return this.reportListHtml(b,v); }
    const G=[
      ['Financial Statements',[['Profit and Loss Statement','pl'],['Balance Sheet','bs'],['Cash Flow Statement','cf'],['Statement of Changes in Equity','soe']]],
      ['Cash & cash equivalents',[['Receipts & Payments Summary','rcpt'],['Bank Account Summary','bank']]],
      ['General Ledger',[['Trial Balance','trial'],['General Ledger Summary','gls'],['General Ledger Transactions','glt']]],
      ['Tax Codes',[['Tax Summary','tax'],['Tax Transactions','taxtx'],['Tax Reconciliation','taxrec'],['Tax Audit','taxaudit']]],
      ['Customers',[['Customer Summary','ar'],['Aged Receivables','agedar'],['Customer Transactions','custx'],
        ['Customer Statements (Unpaid Invoices)','custunpaid'],['Sales Invoice Totals by Customer','sitc'],['Sales Invoice Totals by Item','siti']]],
      ['Suppliers',[['Supplier Summary','ap'],['Aged Payables','agedap'],['Supplier Transactions','suptx'],
        ['Supplier Statements (Unpaid Invoices)','supunpaid'],['Purchase Invoice Totals by Supplier','pitc'],['Purchase Invoice Totals by Item','piti']]],
      ['Inventory Items',[['Inventory Value Summary','invv'],['Inventory Quantity Summary','invq'],
        ['Inventory Quantity Movement','invqm'],['Inventory Value Movement','invvm'],
        ['Inventory Profit Margin','invpm'],['Inventory Price List','invpl']]],
      ['Non-inventory Items',[['Non-inventory Item Totals','nonitem']]],
      ['Fixed Assets',[['Fixed Asset Summary','fa'],['Fixed Asset Depreciation Schedule','fadep']]],
      ['Intangible Assets',[['Intangible Asset Summary','ia'],['Amortization Schedule','iaam']]],
      ['Expense Claims',[['Expense Claims Summary','expc']]],
      ['Investments',[['Investment Summary','invest']]],
      ['Capital Accounts',[['Capital Accounts Summary','cap'],['Capital Accounts Transactions','captx']]],
      ['Divisions',[['Transactions by Division','divsum']]],
      ['Custom Reports',[['Custom Reports','custom']]],
      ['Employees',[['Employee Summary','emp'],['Employee Statements (Transactions)','empstmt']]],
      ['Payslips',[['Payslip Summary','paysum'],['Payslip Totals per Item and Employee','payitem']]]
    ];
    const self=this;
    function oc(key,lbl){ return "App.openReport('"+key+"')"; }
    const cols=G.map(function(g){ const links=g[1].map(function(it){ return '<a class="rep-link" onclick="'+oc(it[1],it[0])+'">'+self.esc(it[0])+'</a>'; }).join('');
      return '<div class="rep-group"><div class="rep-ghead">'+self.esc(g[0])+'</div>'+links+'</div>'; }).join('');
    /* Themed off the same custom properties as the rest of the app, so dark
       mode needs no rules of its own. */
    const css='<style>.rep-wrap{column-gap:16px;columns:3 300px}'+
      '.rep-group{break-inside:avoid;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin:0 0 16px;overflow:hidden}'+
      '.rep-ghead{background:var(--surface-3);color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:8px 12px}'+
      '.rep-link{display:block;padding:8px 12px;color:var(--link);text-decoration:none;border-top:1px solid var(--line-soft);font-size:13.5px;cursor:pointer}'+
      '.rep-link:first-of-type{border-top:none}.rep-link:hover{background:var(--surface-2)}</style>';
    return this.crumb('Reports')+css+'<div class="rep-wrap">'+cols+'</div>';
  },
  _REPDEF:{ pl:{name:'Profit and Loss Statement',method:1,dated:1,cmp:1}, bs:{name:'Balance Sheet',dated:1,cmp:1}, cf:{name:'Cash Flow Statement',dated:1,cmp:1}, soe:{name:'Statement of Changes in Equity',dated:1}, rcpt:{name:'Receipts & Payments Summary',dated:1}, bank:{name:'Bank Account Summary',dated:1,bankPick:1}, trial:{name:'Trial Balance',dated:1,cmp:1}, gls:{name:'General Ledger Summary'}, glt:{name:'General Ledger Transactions',dated:1,acct:1}, tax:{name:'Tax Summary',dated:1}, taxtx:{name:'Tax Transactions',dated:1}, ar:{name:'Customer Summary'}, ap:{name:'Supplier Summary'}, custx:{name:'Customer Transactions',dated:1}, suptx:{name:'Supplier Transactions',dated:1}, cap:{name:'Capital Accounts Summary'}, emp:{name:'Employee Summary',dated:1,empPick:1}, empstmt:{name:'Employee Statements (Transactions)',dated:1,empPick:1}, paysum:{name:'Payslip Summary',dated:1}, payitem:{name:'Payslip Totals per Item and Employee',dated:1}, invv:{name:'Inventory Value Summary',dated:1}, invq:{name:'Inventory Quantity Summary',dated:1}, fa:{name:'Fixed Asset Summary',dated:1}, agedar:{name:'Aged Receivables',dated:1}, agedap:{name:'Aged Payables',dated:1}, custunpaid:{name:'Customer Statements (Unpaid Invoices)',dated:1}, supunpaid:{name:'Supplier Statements (Unpaid Invoices)',dated:1}, sitc:{name:'Sales Invoice Totals by Customer',dated:1}, siti:{name:'Sales Invoice Totals by Item',dated:1}, pitc:{name:'Purchase Invoice Totals by Supplier',dated:1}, piti:{name:'Purchase Invoice Totals by Item',dated:1}, invqm:{name:'Inventory Quantity Movement',dated:1}, invvm:{name:'Inventory Value Movement',dated:1}, invpm:{name:'Inventory Profit Margin',dated:1}, invpl:{name:'Inventory Price List'}, nonitem:{name:'Non-inventory Item Totals',dated:1}, taxrec:{name:'Tax Reconciliation',dated:1}, taxaudit:{name:'Tax Audit',dated:1}, fadep:{name:'Fixed Asset Depreciation Schedule',dated:1}, ia:{name:'Intangible Asset Summary',dated:1}, iaam:{name:'Amortization Schedule',dated:1}, expc:{name:'Expense Claims Summary',dated:1}, btsum:{name:'Billable Time Summary',retired:1}, btmov:{name:'Billable Time Movement',dated:1,retired:1}, invest:{name:'Investment Summary'}, captx:{name:'Capital Accounts Transactions',dated:1}, divsum:{name:'Transactions by Division',dated:1}, custom:{name:'Custom Reports',dated:1,customPick:1} },
  _repDate(s){ return this.fmtDateUS(s); },
  _newReportId(){ return 'r'+Date.now()+Math.floor(Math.random()*1000); },
  _getInst(b,key,id){ var list=(b.reports&&b.reports[key])||[]; return list.find(function(r){ return String(r.id)===String(id); }); },
  _defaultInst(b,key){ var p=periodOf(b); return { id:this._newReportId(), title:(this._REPDEF[key]||{}).name||'Report', desc:'', from:p.from||'2025-01-01', to:p.to||'2025-12-31', colName:'Total', method:'Accrual basis', rounding:'Off', collapse:'', footer:'', showCodes:false, excludeZero:false, customTheme:false }; },
  _ensureReports(b,key){ b.reports=b.reports||{}; if(!b.reports[key]||!b.reports[key].length){ b.reports[key]=[this._defaultInst(b,key)]; this.saveBiz(b); } return b.reports[key]; },
  _repCrumb(key, leaf){ var name=(this._REPDEF[key]||{}).name||key; return '<div class="ws-crumb"><div class="left">'+App._crumbIco()+' ▸ <a class="led-link" onclick="App.reportsBack()">Reports</a> ▸ <a class="led-link" onclick="App.openReport(\''+key+'\')">'+this.esc(name)+'</a>'+(leaf?' ▸ '+this.esc(leaf):'')+'</div></div>'; },
  reportNew(key){ var b=this.curBiz(); b.reports=b.reports||{}; b.reports[key]=b.reports[key]||[]; var inst=this._defaultInst(b,key); b.reports[key].push(inst); this.saveBiz(b); this.repView=key; this.repMode='edit'; this.repInst=inst.id; this.renderMain(b); },
  reportEdit(key,id){ this.repView=key; this.repMode='edit'; this.repInst=id; this.renderMain(this.curBiz()); },
  reportOpen(key,id){ this.repView=key; this.repMode='view'; this.repInst=id; this.renderMain(this.curBiz()); },
  reportClone(key,id){ var b=this.curBiz(); var inst=this._getInst(b,key,id); if(!inst) return; var cp=JSON.parse(JSON.stringify(inst)); cp.id=this._newReportId(); cp.title=(inst.title||'Report')+' (copy)'; b.reports[key]=b.reports[key]||[]; b.reports[key].push(cp); this.saveBiz(b); this.repView=key; this.repMode='edit'; this.repInst=cp.id; this.renderMain(b); },
  reportDelete(key,id){ if(!this._ask('Delete this report? This cannot be undone.',()=>this.reportDelete(key,id))) return; var b=this.curBiz(); b.reports[key]=((b.reports&&b.reports[key])||[]).filter(function(r){ return String(r.id)!==String(id); }); this.saveBiz(b); this.repView=key; this.repMode='list'; this.repInst=null; this.renderMain(b); },
  _applyEditForm(b,key,id){ var inst=this._getInst(b,key,id); if(!inst) return null; var g=function(i){ var el=document.getElementById(i); return el?el.value:''; }; var ck=function(i){ var el=document.getElementById(i); return el?el.checked:false; };
    inst.title=g('rp_title')||inst.title; inst.desc=g('rp_desc'); inst.from=g('rp_from'); inst.to=g('rp_to'); inst.colName=g('rp_col')||'Total';
    var m=document.getElementById('rp_method'); if(m) inst.method=m.value; var r=document.getElementById('rp_round'); if(r) inst.rounding=r.value;
    inst.collapse=g('rp_collapse'); inst.footer=g('rp_footer'); inst.showCodes=ck('rp_codes'); inst.excludeZero=ck('rp_zero'); inst.customTheme=ck('rp_theme');
    var ac=document.getElementById('rp_acct'); if(ac) inst.acctId=ac.value; var pa=document.getElementById('rp_party'); if(pa) inst.party=pa.value;
    var bk=document.getElementById('rp_bank'); if(bk) inst.bank=bk.value; var em=document.getElementById('rp_emp'); if(em) inst.emp=em.value;
    var cu=document.getElementById('rp_custom'); if(cu) inst.custom=cu.value;
    if(inst.comparatives&&inst.comparatives.length){ inst.comparatives.forEach(function(c,ix){ var cf=document.getElementById('rp_cmp_'+ix+'_from'); var ct=document.getElementById('rp_cmp_'+ix+'_to'); var cn=document.getElementById('rp_cmp_'+ix+'_col'); if(cf) c.from=cf.value; if(ct) c.to=ct.value; if(cn) c.colName=cn.value||'Total'; }); }
    return inst; },
  reportSave(key,id){ var b=this.curBiz(); if(!this._applyEditForm(b,key,id)) return; this.saveBiz(b); this.repView=key; this.repMode='view'; this.repInst=id; this.renderMain(b); },
  addComparative(key,id){ var b=this.curBiz(); var inst=this._applyEditForm(b,key,id); if(!inst) return; inst.comparatives=inst.comparatives||[]; inst.comparatives.push({from:inst.from,to:inst.to,colName:'Comparative'}); this.saveBiz(b); this.renderMain(b); },
  delComparative(key,id,idx){ var b=this.curBiz(); var inst=this._applyEditForm(b,key,id); if(!inst) return; inst.comparatives=(inst.comparatives||[]).filter(function(c,i){ return i!==idx; }); this.saveBiz(b); this.renderMain(b); },
  reportPrint(){ var el=document.getElementById('repDoc'); if(!el){ try{ window.print(); }catch(e){} return; } var pr=document.getElementById('printRegion'); if(!pr){ pr=document.createElement('div'); pr.id='printRegion'; document.body.appendChild(pr); } pr.innerHTML='<div class="card rep-print">'+el.innerHTML+'</div>'; var clean=function(){ try{ pr.innerHTML=''; }catch(e){} window.removeEventListener('afterprint',clean); }; window.addEventListener('afterprint',clean); setTimeout(function(){ try{ window.print(); }catch(e){} setTimeout(clean,1500); },80); },
  reportListHtml(b, key){ var self=this; var reg=this._REPDEF[key]||{}; var list=this._ensureReports(b,key);
    var rows=list.map(function(inst){ return '<tr>'+
      '<td class="act"><button class="btn btn-xs" onclick="App.reportEdit(\''+key+'\',\''+inst.id+'\')">Edit</button></td>'+
      '<td class="act"><button class="btn btn-xs" onclick="App.reportOpen(\''+key+'\',\''+inst.id+'\')">View</button></td>'+
      '<td style="white-space:nowrap">'+self._repDate(inst.from)+'</td>'+
      '<td style="white-space:nowrap">'+self._repDate(inst.to)+'</td>'+
      '<td>'+self.esc(reg.method?(inst.method||'Accrual basis'):(inst.colName||'Total'))+'</td></tr>'; }).join('');
    return this._repCrumb(key,'')+
      '<div class="card" style="max-width:none;padding:0;overflow:hidden">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">'+self.esc(reg.name||'Report')+'</span><span style="flex:1"></span><button class="btn btn-primary btn-xs" onclick="App.reportNew(\''+key+'\')">New Report</button></div>'+
      '<table class="reg-tbl"><thead><tr><th class="act"></th><th class="act"></th><th>From</th><th>To</th><th>'+(reg.method?'Accounting method':'Column')+'</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5"><div class="reg-empty">No saved reports yet. Click <b>New Report</b>.</div></td></tr>')+'</tbody></table>'+
      '<div class="reg-foot"><span class="cnt">'+list.length+'</span></div></div>'; },
  reportEditHtml(b, key, id){ var self=this; var reg=this._REPDEF[key]||{}; var inst=this._getInst(b,key,id); if(!inst){ this.repMode='list'; return this.reportListHtml(b,key); }
    var cmpBlock = reg.cmp ? ((inst.comparatives||[]).map(function(c,ix){ return '<div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:6px">'+'<div><label class="rp-lbl">From</label><br><input id="rp_cmp_'+ix+'_from" type="date" class="rp-in" value="'+self.esc(c.from||'')+'"></div>'+'<div><label class="rp-lbl">To</label><br><input id="rp_cmp_'+ix+'_to" type="date" class="rp-in" value="'+self.esc(c.to||'')+'"></div>'+'<div><label class="rp-lbl">Column name</label><br><input id="rp_cmp_'+ix+'_col" class="rp-in" value="'+self.esc(c.colName||'Comparative')+'"></div>'+'<button class="btn btn-xs btn-danger" onclick="App.delComparative(\''+key+'\',\''+id+'\','+ix+')">Remove</button></div>'; }).join('')+'<button class="btn btn-sm" onclick="App.addComparative(\''+key+'\',\''+id+'\')">\u25b8 Add comparative column</button>') : '';
    var acctSel = reg.acct ? ('<div style="margin-top:12px"><label class="rp-lbl">Account</label><br><select id="rp_acct" class="rp-in" style="min-width:280px"><option value="">All accounts</option>'+(b.coa||[]).filter(function(n){ return n.type==='account'; }).map(function(n){ return '<option value="'+n.id+'"'+(inst.acctId===n.id?' selected':'')+'>'+self.esc(typeof acctPath==='function'?acctPath(b,n):(n.name||''))+'</option>'; }).join('')+'</select></div>') : '';
    var partySel = (key==='custx'||key==='suptx') ? (function(){ var pk=key==='custx'?'customers':'suppliers'; var lbl=key==='custx'?'Customer':'Supplier'; return '<div style="margin-top:12px"><label class="rp-lbl">'+lbl+'</label><br><select id="rp_party" class="rp-in" style="min-width:240px"><option value="">All</option>'+(((b.records&&b.records[pk])||[]).map(function(p){ return '<option value="'+self.esc(p.name)+'"'+(inst.party===p.name?' selected':'')+'>'+self.esc(p.name)+'</option>'; }).join(''))+'</select></div>'; })() : '';
    var bankSel = reg.bankPick ? ('<div style="margin-top:12px"><label class="rp-lbl">Bank / cash account</label><br><select id="rp_bank" class="rp-in" style="min-width:240px"><option value="">All bank &amp; cash accounts</option>'+(((b.records&&b.records.bankCash)||[]).map(function(p){ return '<option value="'+self.esc(p.name)+'"'+(inst.bank===p.name?' selected':'')+'>'+self.esc(p.name)+'</option>'; }).join(''))+'</select></div>') : '';
    var empSel = reg.empPick ? ('<div style="margin-top:12px"><label class="rp-lbl">Employee</label><br><select id="rp_emp" class="rp-in" style="min-width:240px"><option value="">'+(key==='empstmt'?'— choose employee —':'All employees')+'</option>'+(((b.records&&b.records.employees)||[]).map(function(p){ return '<option value="'+self.esc(p.name)+'"'+(inst.emp===p.name?' selected':'')+'>'+self.esc(p.name)+'</option>'; }).join(''))+'</select></div>') : '';
    var customSel = reg.customPick ? (function(){ var defs=b.customReports||[];
      if(!defs.length) return '<div class="info-bar" style="margin-top:12px">No custom report definitions yet — build one in <b>Settings \u2192 Custom Reports</b>.</div>';
      return '<div style="margin-top:12px"><label class="rp-lbl">Definition</label><br><select id="rp_custom" class="rp-in" style="min-width:280px">'+
        defs.map(function(d){ var v=d.id||d.name; return '<option value="'+self.esc(v)+'"'+(String(inst.custom)===String(v)?' selected':'')+'>'+self.esc(d.name||'(unnamed)')+'</option>'; }).join('')+'</select></div>'; })() : '';
    var methodSel = reg.method ? '<div style="margin-top:12px"><label class="rp-lbl">Accounting method</label><br><select id="rp_method" class="rp-in"><option'+(inst.method==='Cash basis'?'':' selected')+'>Accrual basis</option><option'+(inst.method==='Cash basis'?' selected':'')+'>Cash basis</option></select></div>' : '';
    return this._repCrumb(key,'Edit')+
      '<div class="card" style="max-width:560px">'+
      '<div style="margin-bottom:10px"><label class="rp-lbl">Title</label><br><input id="rp_title" class="rp-in" style="width:330px" value="'+self.esc(inst.title||'')+'"></div>'+
      '<div style="margin-bottom:10px"><label class="rp-lbl">Description</label><br><input id="rp_desc" class="rp-in" style="width:430px" placeholder="Optional" value="'+self.esc(inst.desc||'')+'"></div>'+
      '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:6px">'+
        '<div><label class="rp-lbl">From</label><br><input id="rp_from" type="date" class="rp-in" value="'+self.esc(inst.from||'')+'"></div>'+
        '<div><label class="rp-lbl">To</label><br><input id="rp_to" type="date" class="rp-in" value="'+self.esc(inst.to||'')+'"></div>'+
        '<div><label class="rp-lbl">Column name</label><br><input id="rp_col" class="rp-in" value="'+self.esc(inst.colName||'Total')+'"></div>'+
      '</div>'+
      cmpBlock+
      methodSel+acctSel+partySel+bankSel+empSel+customSel+
      '<div style="margin-top:12px"><label class="rp-lbl">Rounding</label><br><select id="rp_round" class="rp-in"><option'+(inst.rounding==='Whole numbers'?'':' selected')+'>Off</option><option'+(inst.rounding==='Whole numbers'?' selected':'')+'>Whole numbers</option></select></div>'+
      '<div style="margin-top:12px"><label class="rp-lbl">Groups to collapse</label><br><input id="rp_collapse" class="rp-in" style="width:330px" value="'+self.esc(inst.collapse||'')+'"></div>'+
      '<div style="margin-top:12px"><label class="rp-lbl">Footer</label><br><textarea id="rp_footer" class="rp-in" style="width:450px;height:90px;resize:vertical">'+self.esc(inst.footer||'')+'</textarea></div>'+
      '<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">'+
        '<label class="chk-row"><input type="checkbox" id="rp_codes"'+(inst.showCodes?' checked':'')+'> Show account codes</label>'+
        '<label class="chk-row"><input type="checkbox" id="rp_zero"'+(inst.excludeZero?' checked':'')+'> Exclude zero balances</label>'+
        '<label class="chk-row"><input type="checkbox" id="rp_theme"'+(inst.customTheme?' checked':'')+'> Custom theme</label>'+
      '</div>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.reportSave(\''+key+'\',\''+id+'\')">Update</button><button class="btn btn-danger" onclick="App.reportDelete(\''+key+'\',\''+id+'\')">Delete</button></div>'+
      '</div>'; },
  reportViewHtml(b, key, id){ var inst=this._getInst(b,key,id); if(!inst){ this.repMode='list'; return this.reportListHtml(b,key); }
    this._repCtx={key:key, inst:inst}; var html='';
    try{
      if(key==='ar') html=this.partyReportHtml(b,'customers','Customer Summary',customerBalance);
      else if(key==='ap') html=this.partyReportHtml(b,'suppliers','Supplier Summary',supplierBalance);
      else if(key==='invv') html=this._renderInvValue(b,key,inst);
      else if(key==='invq') html=this._renderInvQty(b,key,inst);
      else if(key==='pl') html=this._renderStatement(b,key,inst,'pl');
      else if(key==='bs') html=this._renderStatement(b,key,inst,'bs');
      else if(key==='cf') html=this._renderCashFlow(b,key,inst);
      else if(key==='soe') html=this._renderSOE(b,key,inst);
      else if(key==='trial') html=this._renderTrial(b,key,inst);
      else if(key==='glt') html=this._renderGLTx(b,key,inst);
      else if(key==='taxtx') html=this._renderTaxTx(b,key,inst);
      else if(key==='custx') html=this._renderPartyTx(b,key,inst,'cust');
      else if(key==='suptx') html=this._renderPartyTx(b,key,inst,'sup');
      else if(key==='rcpt') html=this._renderRcptPay(b,key,inst);
      else if(key==='bank') html=this._renderBank(b,key,inst);
      else if(key==='fa') html=this._renderFixedAsset(b,key,inst);
      else if(key==='emp') html=this._renderEmpSummary(b,key,inst);
      else if(key==='paysum') html=this._renderPayslipSummary(b,key,inst);
      else if(key==='payitem') html=this._renderPayslipItems(b,key,inst);
      else if(key==='empstmt') html=this._renderEmpStatement(b,key,inst);
      else if(key==='agedar') html=this._renderAged(b,key,inst,'cust');
      else if(key==='agedap') html=this._renderAged(b,key,inst,'sup');
      else if(key==='custunpaid') html=this._renderUnpaid(b,key,inst,'cust');
      else if(key==='supunpaid') html=this._renderUnpaid(b,key,inst,'sup');
      else if(key==='sitc') html=this._renderInvTotalsByParty(b,key,inst,'cust');
      else if(key==='pitc') html=this._renderInvTotalsByParty(b,key,inst,'sup');
      else if(key==='siti') html=this._renderInvTotalsByItem(b,key,inst,'cust');
      else if(key==='piti') html=this._renderInvTotalsByItem(b,key,inst,'sup');
      else if(key==='invqm') html=this._renderInvMovement(b,key,inst,'qty');
      else if(key==='invvm') html=this._renderInvMovement(b,key,inst,'val');
      else if(key==='invpm') html=this._renderInvMargin(b,key,inst);
      else if(key==='invpl') html=this._renderInvPriceList(b,key,inst);
      else if(key==='nonitem') html=this._renderNonInvTotals(b,key,inst);
      else if(key==='taxrec') html=this._renderTaxRecon(b,key,inst);
      else if(key==='taxaudit') html=this._renderTaxAudit(b,key,inst);
      else if(key==='fadep') html=this._renderDeprSchedule(b,key,inst);
      else if(key==='ia') html=this._renderIntangibles(b,key,inst);
      else if(key==='iaam') html=this._renderAmortSchedule(b,key,inst);
      else if(key==='expc') html=this._renderExpenseClaims(b,key,inst);
      else if(key==='btsum') html=this._renderBillableSummary(b,key,inst);
      else if(key==='btmov') html=this._renderBillableMovement(b,key,inst);
      else if(key==='invest') html=this._renderInvestments(b,key,inst);
      else if(key==='captx') html=this._renderCapitalTx(b,key,inst);
      else if(key==='divsum') html=this._renderDivisionSummary(b,key,inst);
      else if(key==='custom') html=this._renderCustomReport(b,key,inst);
      else { var map={gls:'genLedgerSummaryHtml',tax:'taxSummaryHtml',cap:'capitalSummaryHtml'}; var fn=map[key]; html=(fn&&this[fn])?this[fn](b):this.repSoonHtml(b,inst.title); }
    }catch(err){ html=this._repCrumb(key,'View')+'<div class="card"><div class="info-bar">This report could not be generated: '+this.esc(String(err&&err.message||err))+'</div></div>'; }
    this._repCtx=null; return html; },
  _isoShift(iso,days,months,years){ if(!iso) return ''; var m=String(iso).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) return '';
    var d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
    if(years) d.setUTCFullYear(d.getUTCFullYear()+years);
    if(months) d.setUTCMonth(d.getUTCMonth()+months);
    if(days) d.setUTCDate(d.getUTCDate()+days);
    return d.toISOString().slice(0,10); },
  _dayBefore(iso){ if(!iso) return null; return this._isoShift(iso,-1)||null; },
  _inRange(d, from, to){ if(d==null||d==='') return !from; d=String(d).slice(0,10); if(from&&d<from) return false; if(to&&d>to) return false; return true; },
  _acctNatC(b,id){ var n=acctById(b,id); return n?acctNature(b,n)==='C':false; },
  _acctPeriod(b,id,from,to){ if(id==null) return 0; var ge=glEntries(b,id); var natC=this._acctNatC(b,id); var s=0; var self=this; (ge.rows||[]).forEach(function(r){ if(!self._inRange(r.date,from,to)) return; var d=Number(r.debit)||0,c=Number(r.credit)||0; s+= natC?(c-d):(d-c); }); return s; },
  _acctAsOf(b,id,to){ if(id==null) return 0; var ge=glEntries(b,id); var natC=this._acctNatC(b,id); var s=Number(ge.opening)||0; (ge.rows||[]).forEach(function(r){ var dt=String(r.date||'').slice(0,10); if(to&&dt&&dt>to) return; var d=Number(r.debit)||0,c=Number(r.credit)||0; s+= natC?(c-d):(d-c); }); return s; },
  _periods(inst){ var ps=[{from:inst.from,to:inst.to,colName:inst.colName||'Total'}]; (inst.comparatives||[]).forEach(function(c){ ps.push({from:c.from,to:c.to,colName:c.colName||'Total'}); }); return ps; },
  _treeForPeriod(b, from, to, kind){ var self=this; var base; try{ base=summaryFromCoa(b); }catch(e){ base={profitLoss:[],balanceSheet:[]}; }
    var sects=kind==='pl'?(base.profitLoss||[]):(base.balanceSheet||[]); var clone=JSON.parse(JSON.stringify(sects));
    var walk=function(node){ if(node.children){ node.children.forEach(walk); node.total=node.children.reduce(function(a,k){ return a+(k.amt!=null?k.amt:(k.total||0)); },0); } else if(node.id!=null){ node.amt = kind==='pl'? self._acctPeriod(b,node.id,from,to) : self._acctAsOf(b,node.id,to); } };
    clone.forEach(function(sec){ (sec.children||[]).forEach(walk); sec.total=(sec.children||[]).reduce(function(a,k){ return a+(k.amt!=null?k.amt:(k.total||0)); },0); }); return clone; },
  _bsForPeriod(b, from, to){ var self=this; var bs=this._treeForPeriod(b,from,to,'bs'); var pl=this._treeForPeriod(b,from,to,'pl');
    var plNet=(pl||[]).reduce(function(a,s){ return a+((s.plkind==='expense'?-1:1)*(s.total||0)); },0);
    var assets=bs[0]||{total:0}, liab=bs[1]||{total:0}, eq=bs[2]||{children:[],total:0};
    var eBase=0, realKids=[]; (eq.children||[]).forEach(function(k){ if(k.id!=null){ eBase+=(k.amt||0); realKids.push(k); } });
    var plug=(assets.total||0)-(liab.total||0)-eBase-plNet; var eChildren=realKids.slice();
    if(Math.abs(plNet)>0.0049) eChildren.push({name:'Net profit (loss)',amt:plNet});
    /* the ledger balances, so what is left is the profit of periods before the report starts: it is retained earnings */
    if(Math.abs(plug)>0.0049){ var re=eChildren.find(function(k){ return /retained earnings/i.test(k.name||''); }); if(re) re.amt=(re.amt||0)+plug; else eChildren.push({name:'Retained earnings',amt:plug}); }
    eq.children=eChildren; eq.total=eBase+plNet+plug; return bs; },
  _stmtArrays(sections, kind){ var rows=[], amts=[]; var net=0;
    var emit=function(node,depth){ if(node.children&&node.children.length){ rows.push({t:'sub',label:node.name,depth:depth}); amts.push(node.total||0); node.children.forEach(function(c){ emit(c,depth+1); }); } else { rows.push({t:'leaf',label:node.name,depth:depth}); amts.push(node.amt||0); } };
    (sections||[]).forEach(function(sec){ rows.push({t:'head',label:sec.title,depth:0}); amts.push(null); (sec.children||[]).forEach(function(c){ emit(c,1); }); rows.push({t:'total',label:'Total \u2014 '+sec.title,depth:0}); amts.push(sec.total||0); net += (kind==='pl'?((sec.plkind==='expense'?-1:1)*(sec.total||0)):0); });
    if(kind==='pl'){ rows.push({t:'net',label:'Net profit / (loss)',depth:0}); amts.push(net); }
    return {rows:rows, amts:amts}; },
  _renderStmtRows(b, key, inst, rows, amts){ var self=this; var periods=this._periods(inst); var exZero=inst.excludeZero;
    var nf=function(v){ if(v==null) return ''; var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var thCols=periods.map(function(p){ return '<th class="r">'+self.esc(p.colName||'Total')+'</th>'; }).join('');
    var body=rows.map(function(r,i){ if(exZero&&r.t==='leaf'){ var allZ=amts.every(function(a){ return Math.abs(Number(a[i])||0)<0.005; }); if(allZ) return ''; }
      var pad=8+(r.depth||0)*18; var style;
      if(r.t==='head') style='padding:11px 0 2px;font-weight:800';
      else if(r.t==='total') style='padding:5px 0;font-weight:700;border-top:1px solid var(--line)';
      else if(r.t==='net') style='padding:8px 0;font-weight:800;border-top:2px solid #222';
      else if(r.t==='sub') style='padding:5px 0 2px '+pad+'px;font-weight:600';
      else style='padding:3px 0 3px '+pad+'px';
      var tds=amts.map(function(a){ var bold=(r.t==='total'||r.t==='net'||r.t==='sub'); return '<td class="r m"'+(bold?' style="font-weight:700"':'')+'>'+nf(a[i])+'</td>'; }).join('');
      return '<tr><td style="'+style+'">'+self.esc(r.label)+'</td>'+tds+'</tr>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th>'+thCols+'</tr></thead><tbody>'+body+'</tbody></table>'+this.repFoot(); },
  _renderStatement(b, key, inst, kind){ var self=this; var periods=this._periods(inst);
    var trees=periods.map(function(p){ return kind==='pl'? self._treeForPeriod(b,p.from,p.to,'pl') : self._bsForPeriod(b,p.from,p.to); });
    var arr0=self._stmtArrays(trees[0], kind); var amts=trees.map(function(t){ return self._stmtArrays(t, kind).amts; });
    return self._renderStmtRows(b, key, inst, arr0.rows, amts); },
  _cashFlow(b, from, to){ var self=this; var R=b.records||{}; var byAcct={};
    var addLine=function(acctId, amt){ if(!acctId||!amt) return; var n=acctById(b,acctId); var nm=n?acctName(b,acctId):'Other'; if(!byAcct[acctId]) byAcct[acctId]={name:nm,amt:0,id:acctId}; byAcct[acctId].amt+=amt; };
    (R.receipts||[]).forEach(function(r){ if(!self._inRange(r.date,from,to)) return; var lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,amount:r.amount}]; lns.forEach(function(ln){ addLine(ln.account, Number(ln.amount)||0); }); });
    (R.payments||[]).forEach(function(p){ if(!self._inRange(p.date,from,to)) return; var lns=(p.lines&&p.lines.length)?p.lines:[{account:p.account,amount:p.amount}]; lns.forEach(function(ln){ addLine(ln.account, -(Number(ln.amount)||0)); }); });
    var O=[],I=[],F=[]; Object.keys(byAcct).forEach(function(id){ var e=byAcct[id]; if(Math.abs(e.amt)<0.005) return; var n=acctById(b,id); var root=n?acctRoot(b,n):'expense'; var nm=(n&&n.name||'').toLowerCase();
      if(root==='assets' && /fixed asset|equipment|vehicle|machinery|furniture|property|plant/.test(nm)) I.push(e);
      else if(root==='equity' || /capital|loan|owner|drawings|borrow|share/.test(nm)) F.push(e);
      else O.push(e); });
    var sum=function(a){ return a.reduce(function(s,x){ return s+x.amt; },0); };
    return {O:O,I:I,F:F,oT:sum(O),iT:sum(I),fT:sum(F),net:sum(O)+sum(I)+sum(F)}; },
  _renderCashFlow(b, key, inst){ var self=this; var periods=this._periods(inst); var cfs=periods.map(function(p){ return self._cashFlow(b,p.from,p.to); });
    var groups=[['operating activities','O','oT'],['investing activities','I','iT'],['financing activities','F','fT']];
    var rows=[]; var amts=periods.map(function(){ return []; });
    groups.forEach(function(g){ var act=g[1]; rows.push({t:'head',label:'Cash flows from '+g[0],depth:0}); amts.forEach(function(a){ a.push(null); });
      var order=[]; var seen={}; cfs.forEach(function(cf){ (cf[act]||[]).forEach(function(e){ if(!seen[e.id]){ seen[e.id]=true; order.push({id:e.id,name:e.name}); } }); });
      order.forEach(function(o){ rows.push({t:'leaf',label:o.name,depth:1}); periods.forEach(function(p,pi){ var e=(cfs[pi][act]||[]).find(function(x){ return x.id===o.id; }); amts[pi].push(e?e.amt:0); }); });
      rows.push({t:'total',label:'Net cash from '+g[0],depth:0}); periods.forEach(function(p,pi){ amts[pi].push(cfs[pi][g[2]]); }); });
    rows.push({t:'net',label:'Net increase / (decrease) in cash & cash equivalents',depth:0}); periods.forEach(function(p,pi){ amts[pi].push(cfs[pi].net); });
    return this._renderStmtRows(b, key, inst, rows, amts); },
  _renderSOE(b, key, inst){ var self=this; var from=inst.from, to=inst.to; var openTo=this._dayBefore(from);
    var closeEq=((self._bsForPeriod(b,from,to)[2])||{}).total||0; var openEq=((self._bsForPeriod(b,null,openTo)[2])||{}).total||0;
    var plTree=self._treeForPeriod(b,from,to,'pl'); var profit=(plTree||[]).reduce(function(a,s){ return a+((s.plkind==='expense'?-1:1)*(s.total||0)); },0);
    var capControl=(b.coa||[]).find(function(x){ return x.type==='account'&&/^capital accounts$/i.test(x.name||''); });
    var capMove=capControl? self._acctPeriod(b,capControl.id,from,to):0; var other=closeEq-openEq-profit-capMove;
    var data=[['Opening balance',openEq],['Profit / (loss) for the period',profit],['Capital contributions (net of drawings)',capMove]];
    if(Math.abs(other)>0.0049) data.push(['Other movements',other]); data.push(['__t','Closing balance',closeEq]);
    var nf=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var body=data.map(function(r){ if(r[0]==='__t') return '<tr><td style="padding:8px 0;font-weight:800;border-top:2px solid #222">'+self.esc(r[1])+'</td><td class="r m" style="font-weight:800">'+self.money(r[2])+'</td></tr>'; return '<tr><td style="padding:5px 0">'+self.esc(r[0])+'</td><td class="r m">'+nf(r[1])+'</td></tr>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th><th class="r">'+self.esc(inst.colName||'Total')+'</th></tr></thead><tbody>'+body+'</tbody></table>'+this.repFoot(); },
  _renderTrial(b, key, inst){ var self=this; var periods=this._periods(inst);
    var accts=(b.coa||[]).filter(function(n){ return n.type==='account'; });
    var rows=accts.map(function(n){ var natC=acctNature(b,n)==='C'; var cells=periods.map(function(p){ var bal=self._acctAsOf(b,n.id,p.to); var dr=0,cr=0; if(natC){ if(bal>=0) cr=bal; else dr=-bal; } else { if(bal>=0) dr=bal; else cr=-bal; } return {dr:dr,cr:cr}; }); return {name:(typeof acctPath==='function'?acctPath(b,n):(n.name||'')), cells:cells}; });
    rows=rows.filter(function(r){ return r.cells.some(function(c){ return Math.abs(c.dr)>0.005||Math.abs(c.cr)>0.005; }); });
    rows.sort(function(a,b){ return a.name.localeCompare(b.name); });
    var nf=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'':self.money(n); };
    var th='<th></th>'+periods.map(function(p){ var nm=self.esc(p.colName||'Total'); return '<th class="r">'+nm+' Dr</th><th class="r">'+nm+' Cr</th>'; }).join('');
    var totals=periods.map(function(){ return {dr:0,cr:0}; });
    var body=rows.map(function(r){ var tds=r.cells.map(function(c,pi){ totals[pi].dr+=c.dr; totals[pi].cr+=c.cr; return '<td class="r m">'+nf(c.dr)+'</td><td class="r m">'+nf(c.cr)+'</td>'; }).join(''); return '<tr><td>'+self.esc(r.name)+'</td>'+tds+'</tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total</td>'+totals.map(function(t){ return '<td class="r m">'+self.money(t.dr)+'</td><td class="r m">'+self.money(t.cr)+'</td>'; }).join('')+'</tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr>'+th+'</tr></thead><tbody>'+(body||'<tr><td>No data</td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _renderGLTx(b, key, inst){ var self=this; var from=inst.from,to=inst.to; var acctId=inst.acctId||'';
    var nf=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'':self.money(n); };
    var accts; if(acctId){ var n=acctById(b,acctId); accts=n?[n]:[]; } else { accts=(b.coa||[]).filter(function(x){ return x.type==='account'; }); }
    var blocks=''; accts.forEach(function(n){ var ge=glEntries(b,n.id); var rows=(ge.rows||[]).filter(function(r){ return self._inRange(r.date,from,to); }); if(!rows.length) return;
      rows.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
      var natC=acctNature(b,n)==='C'; var run=self._acctAsOf(b,n.id,self._dayBefore(from));
      var tr=rows.map(function(r){ var d=Number(r.debit)||0,c=Number(r.credit)||0; run+= natC?(c-d):(d-c); return '<tr><td style="white-space:nowrap">'+self._repDate(r.date)+'</td><td>'+self.esc(r.ref||'')+'</td><td>'+self.esc(r.type||'')+'</td><td class="r m">'+nf(d)+'</td><td class="r m">'+nf(c)+'</td><td class="r m">'+self.money(run)+'</td></tr>'; }).join('');
      blocks+='<div style="font-weight:700;margin:16px 0 4px">'+self.esc(typeof acctPath==='function'?acctPath(b,n):(n.name||''))+'</div><table class="reg-tbl"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>'+tr+'</tbody></table>'; });
    return this.repHead(b,(this._REPDEF[key]||{}).name)+(blocks||'<div class="reg-empty">No transactions in this period.</div>')+this.repFoot(); },
  _renderTaxTx(b, key, inst){ var self=this; var from=inst.from,to=inst.to; var R=b.records||{}; var rows=[];
    var addDoc=function(list,type,sign){ (list||[]).forEach(function(d){ var dt=d.issueDate||d.date; if(!self._inRange(dt,from,to)) return; var tax=Number(d.tax)||0; if(Math.abs(tax)<0.005) return; var base=Number(d.subtotal!=null?d.subtotal:((Number(d.total)||0)-tax))||0; rows.push({date:dt,ref:d.reference||'',type:type,party:d.customer||d.supplier||'',base:base,tax:tax,sign:sign}); }); };
    addDoc(R.salesInv,'Sales invoice','out'); addDoc(R.creditNotes,'Credit note','outneg'); addDoc(R.purchInv,'Purchase invoice','in'); addDoc(R.debitNotes,'Debit note','inneg');
    rows.sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
    var nf=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'':self.money(n); };
    var tOut=0,tIn=0; var body=rows.map(function(r){ var outTax=r.sign==='out'?r.tax:(r.sign==='outneg'?-r.tax:0); var inTax=r.sign==='in'?r.tax:(r.sign==='inneg'?-r.tax:0); tOut+=outTax; tIn+=inTax; return '<tr><td style="white-space:nowrap">'+self._repDate(r.date)+'</td><td>'+self.esc(r.ref)+'</td><td>'+self.esc(r.type)+'</td><td>'+self.esc(r.party)+'</td><td class="r m">'+nf(r.base)+'</td><td class="r m">'+nf(outTax)+'</td><td class="r m">'+nf(inTax)+'</td></tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="5">Total</td><td class="r m">'+self.money(tOut)+'</td><td class="r m">'+self.money(tIn)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Party</th><th class="r">Net</th><th class="r">Output VAT</th><th class="r">Input VAT</th></tr></thead><tbody>'+(body||'<tr><td colspan="7"><div class="reg-empty">No tax transactions in this period.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _renderPartyTx(b, key, inst, mode){ var self=this; var from=inst.from,to=inst.to; var R=b.records||{};
    var partyKey=mode==='cust'?'customers':'suppliers'; var only=inst.party||''; var RE=mode==='cust'?AR_RE:AP_RE;
    var recs=(R[partyKey]||[]); var parties=recs.map(function(p){ return p.name; }).filter(Boolean); if(only) parties=parties.filter(function(n){ return n===only; });
    var nf=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'':self.money(n); };
    var gather=function(name){ var tx=[];
      if(mode==='cust'){ (R.salesInv||[]).forEach(function(i){ if(i.customer===name) tx.push({date:i.issueDate||i.date,ref:i.reference,type:'Sales invoice',d:Number(i.total)||0}); });
        (R.creditNotes||[]).forEach(function(c){ if(c.customer===name) tx.push({date:c.date,ref:c.reference,type:'Credit note',d:-(Number(c.total)||0)}); }); }
      else { (R.purchInv||[]).forEach(function(i){ if(i.supplier===name) tx.push({date:i.issueDate||i.date,ref:i.reference,type:'Purchase invoice',d:Number(i.total)||0}); });
        (R.debitNotes||[]).forEach(function(dn){ if(dn.supplier===name) tx.push({date:dn.date,ref:dn.reference,type:'Debit note',d:-(Number(dn.total)||0)}); }); }
      var scan=function(list,kindKey){ (list||[]).forEach(function(r){ var lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,sub:r.sub,amount:r.amount}]; lns.forEach(function(ln){ if(ln.sub===name && acctNameMatches(b,ln.account,RE)){ var amt=Number(ln.amount)||0; if(!amt) return;
        if(kindKey==='receipts') tx.push({date:r.date,ref:r.reference,type:(mode==='cust'?'Receipt':'Refund'),d:(mode==='cust'?-amt:amt)});
        else tx.push({date:r.date,ref:r.reference,type:(mode==='cust'?'Refund':'Payment'),d:(mode==='cust'?amt:-amt)}); } }); }); };
      scan(R.receipts,'receipts'); scan(R.payments,'payments');
      (R.journal||[]).forEach(function(j){ (j.lines||[]).forEach(function(ln){ if(ln.sub===name && acctNameMatches(b,ln.account,RE)){ var net=(Number(ln.debit)||0)-(Number(ln.credit)||0); if(!net) return; tx.push({date:j.date,ref:j.reference,type:'Journal',d:(mode==='cust'?net:-net)}); } }); });
      return tx; };
    var blocks=parties.map(function(name){ var prec=recs.find(function(p){ return p.name===name; }); var opening0=prec?Number(prec.balance)||0:0;
      var all=gather(name); all.sort(function(a,b){ return String(a.date||'').localeCompare(String(b.date||'')); });
      var openBal=opening0; var inP=[]; all.forEach(function(t){ var dt=String(t.date||'').slice(0,10); if(from && dt && dt<from){ openBal+=t.d; } else if(self._inRange(t.date,from,to)){ inP.push(t); } });
      if(Math.abs(openBal)<0.005 && !inP.length) return '';
      var run=openBal; var rowsH='<tr><td style="white-space:nowrap">'+self._repDate(from)+'</td><td></td><td style="font-style:italic;color:#666">Opening balance</td><td class="r m"></td><td class="r m"></td><td class="r m">'+self.money(openBal)+'</td></tr>';
      rowsH+=inP.map(function(t){ run+=t.d; var dr=t.d>0?t.d:0, cr=t.d<0?-t.d:0; return '<tr><td style="white-space:nowrap">'+self._repDate(t.date)+'</td><td>'+self.esc(t.ref||'')+'</td><td>'+self.esc(t.type)+'</td><td class="r m">'+nf(dr)+'</td><td class="r m">'+nf(cr)+'</td><td class="r m">'+self.money(run)+'</td></tr>'; }).join('');
      rowsH+='<tr style="font-weight:700;border-top:1px solid var(--line)"><td colspan="5">Closing balance</td><td class="r m">'+self.money(run)+'</td></tr>';
      var dLbl=mode==='cust'?'Invoiced':'Debit'; var cLbl=mode==='cust'?'Received':'Credit';
      return '<div style="font-weight:700;margin:16px 0 4px">'+self.esc(name)+'</div><table class="reg-tbl"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th class="r">'+dLbl+'</th><th class="r">'+cLbl+'</th><th class="r">Balance</th></tr></thead><tbody>'+rowsH+'</tbody></table>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+(blocks||'<div class="reg-empty">No transactions in this period.</div>')+this.repFoot(); },
  _renderInvPrice(b, key, inst){ var self=this; var items=(b.records&&b.records.inventory)||[];
    var rows=items.map(function(it){ return '<tr><td>'+self.esc(it.name||'')+'</td><td>'+self.esc(it.code||it.itemCode||'')+'</td><td class="r m">'+self.money(Number(it.salePrice!=null?it.salePrice:it.price)||0)+'</td><td class="r m">'+self.money(Number(it.purchasePrice)||0)+'</td></tr>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Item</th><th>Code</th><th class="r">Sale price</th><th class="r">Purchase price</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4"><div class="reg-empty">No inventory items.</div></td></tr>')+'</tbody></table>'+this.repFoot(); },
  _renderInvCost(b, key, inst){ var self=this; var items=(b.records&&b.records.inventory)||[]; var nf=function(x){ var v=Number(x)||0; return (Math.round(v*1000)/1000).toLocaleString(); };
    var tQ=0,tV=0,tC=0; var rows=items.map(function(it){ var s=invItemStats(b,it); tQ+=s.qtyOnHand||0; tV+=s.totalCost||0; tC+=s.cogs||0; return '<tr><td>'+self.esc(it.name||'')+'</td><td class="r m">'+nf(s.qtyOnHand)+'</td><td class="r m">'+self.money(s.avgCost)+'</td><td class="r m">'+self.money(s.totalCost)+'</td><td class="r m">'+self.money(s.cogs)+'</td></tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total</td><td class="r m">'+nf(tQ)+'</td><td></td><td class="r m">'+self.money(tV)+'</td><td class="r m">'+self.money(tC)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Item</th><th class="r">Qty on hand</th><th class="r">Avg cost</th><th class="r">Stock value</th><th class="r">Cost of sales</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5"><div class="reg-empty">No inventory items.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _bankAsOf(b,rec,to){ var R=b.records||{}; var self=this; var bal=Number(rec.balance)||0;
    (R.receipts||[]).forEach(function(r){ if(bankMatch(r.receivedIn,rec)&&self._inRange(r.date,null,to)) bal+=Number(r.amount)||0; });
    (R.payments||[]).forEach(function(p){ if(bankMatch(p.paidFrom,rec)&&self._inRange(p.date,null,to)) bal-=Number(p.amount)||0; });
    (R.iat||[]).forEach(function(t){ if(self._inRange(t.date,null,to)){ if(bankMatch(t.receivedIn,rec)) bal+=Number(t.amount)||0; if(bankMatch(t.paidFrom,rec)) bal-=Number(t.amount)||0; } });
    return bal; },
  _cashAsOf(b,to){ var self=this; return ((b.records&&b.records.bankCash)||[]).reduce(function(a,r){ return a+self._bankAsOf(b,r,to); },0); },
  _invMovePeriod(b,item,from,to){ var self=this; var m=invItemMovements(b,item); var rows=m.rows||[];
    var oQ=rows.length?rows[0].qbal:(Number(item&&item.qty)||0); var oV=rows.length?rows[0].cbal:0;
    var purchQ=0,purchV=0,salesQ=0,cogsV=0,adjV=0,adjQ=0; var lastQ=oQ,lastV=oV;
    for(var i=1;i<rows.length;i++){ var r=rows[i]; var dt=String(r.date||'').slice(0,10);
      if(from && dt && dt<from){ oQ=r.qbal; oV=r.cbal; lastQ=r.qbal; lastV=r.cbal; continue; }
      if(self._inRange(r.date,from,to)){ if(r.src==='purchInv'){ purchQ+=r.qin||0; purchV+=r.cin||0; } else if(r.src==='salesInv'){ salesQ+=r.qout||0; cogsV+=r.cout||0; } else { adjV+=(r.cin||0)-(r.cout||0); adjQ+=(r.qin||0)-(r.qout||0); } lastQ=r.qbal; lastV=r.cbal; } }
    return {openQ:oQ,openV:oV,purchQ:purchQ,purchV:purchV,salesQ:salesQ,cogsV:cogsV,adjV:adjV,adjQ:adjQ,closeQ:lastQ,closeV:lastV}; },
  _rpLabel(b,ln){ return (ln.sub!=null&&ln.sub!=='')?ln.sub:(acctName(b,ln.account)||'Other'); },
  _renderRcptPay(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var rc={},pm={};
    (R.receipts||[]).forEach(function(r){ if(!self._inRange(r.date,from,to)) return; var lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,sub:r.sub,amount:r.amount}]; lns.forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var L=self._rpLabel(b,ln); rc[L]=(rc[L]||0)+a; }); });
    (R.payments||[]).forEach(function(p){ if(!self._inRange(p.date,from,to)) return; var lns=(p.lines&&p.lines.length)?p.lines:[{account:p.account,sub:p.sub,amount:p.amount}]; lns.forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var L=self._rpLabel(b,ln); pm[L]=(pm[L]||0)+a; }); });
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var rcK=Object.keys(rc).sort(), pmK=Object.keys(pm).sort();
    var totR=rcK.reduce(function(a,k){return a+rc[k];},0), totP=pmK.reduce(function(a,k){return a+pm[k];},0); var net=totR-totP;
    var begin=self._cashAsOf(b,self._dayBefore(from)); var end=self._cashAsOf(b,to);
    var body='<tr><td style="padding:8px 0 2px;font-weight:800">Receipts</td><td></td></tr>';
    body+=rcK.map(function(k){ return '<tr><td style="padding:3px 0 3px 14px">'+self.esc(k)+'</td><td class="r m">'+M(rc[k])+'</td></tr>'; }).join('')||'<tr><td style="padding-left:14px;color:#bbb">None</td><td></td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0;font-weight:700">Total — Receipts</td><td class="r m" style="font-weight:700">'+self.money(totR)+'</td></tr>';
    body+='<tr><td style="padding:10px 0 2px;font-weight:800">Less: Payments</td><td></td></tr>';
    body+=pmK.map(function(k){ return '<tr><td style="padding:3px 0 3px 14px">'+self.esc(k)+'</td><td class="r m">'+M(pm[k])+'</td></tr>'; }).join('')||'<tr><td style="padding-left:14px;color:#bbb">None</td><td></td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0;font-weight:700">Total — Payments</td><td class="r m" style="font-weight:700">'+self.money(totP)+'</td></tr>';
    body+='<tr style="border-top:2px solid #222"><td style="padding:8px 0;font-weight:800">Net increase (decrease) in cash held</td><td class="r m" style="font-weight:800">'+self.money(net)+'</td></tr>';
    body+='<tr><td style="padding:6px 0">Cash at the beginning of the period</td><td class="r m">'+self.money(begin)+'</td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:6px 0;font-weight:700">Cash at the end of the period</td><td class="r m" style="font-weight:700">'+self.money(end)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th><th class="r">'+self._repDate(to)+'</th></tr></thead><tbody>'+body+'</tbody></table>'+this.repFoot(); },
  _renderBank(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to; var banks=(R.bankCash||[]);
    var bankName=inst.bank||''; var sel=bankName?banks.filter(function(x){return x.name===bankName;}):banks;
    var match=function(ref){ return sel.some(function(x){ return bankMatch(ref,x); }); };
    var inf={},outf={};
    (R.receipts||[]).forEach(function(r){ if(!self._inRange(r.date,from,to)||!match(r.receivedIn)) return; var lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,sub:r.sub,amount:r.amount}]; lns.forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var L=self._rpLabel(b,ln); inf[L]=(inf[L]||0)+a; }); });
    (R.payments||[]).forEach(function(p){ if(!self._inRange(p.date,from,to)||!match(p.paidFrom)) return; var lns=(p.lines&&p.lines.length)?p.lines:[{account:p.account,sub:p.sub,amount:p.amount}]; lns.forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var L=self._rpLabel(b,ln); outf[L]=(outf[L]||0)+a; }); });
    var iatNet=0; (R.iat||[]).forEach(function(t){ if(!self._inRange(t.date,from,to)) return; if(match(t.receivedIn)) iatNet+=Number(t.amount)||0; if(match(t.paidFrom)) iatNet-=Number(t.amount)||0; });
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var iK=Object.keys(inf).sort(), oK=Object.keys(outf).sort();
    var totI=iK.reduce(function(a,k){return a+inf[k];},0), totO=oK.reduce(function(a,k){return a+outf[k];},0); var net=totI-totO;
    var begin=sel.reduce(function(a,r){return a+self._bankAsOf(b,r,self._dayBefore(from));},0); var end=sel.reduce(function(a,r){return a+self._bankAsOf(b,r,to);},0);
    var sub=bankName?('<div style="text-align:center;font-weight:700;margin:-8px 0 12px">'+self.esc(bankName)+'</div>'):'';
    var body='<tr><td style="padding:8px 0 2px;font-weight:800">Inflows</td><td></td></tr>';
    body+=iK.map(function(k){ return '<tr><td style="padding:3px 0 3px 14px">'+self.esc(k)+'</td><td class="r m">'+M(inf[k])+'</td></tr>'; }).join('')||'<tr><td style="padding-left:14px;color:#bbb">None</td><td></td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0;font-weight:700">Total — Inflows</td><td class="r m" style="font-weight:700">'+self.money(totI)+'</td></tr>';
    body+='<tr><td style="padding:10px 0 2px;font-weight:800">Less: Outflows</td><td></td></tr>';
    body+=oK.map(function(k){ return '<tr><td style="padding:3px 0 3px 14px">'+self.esc(k)+'</td><td class="r m">'+M(outf[k])+'</td></tr>'; }).join('')||'<tr><td style="padding-left:14px;color:#bbb">None</td><td></td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0;font-weight:700">Total — Outflows</td><td class="r m" style="font-weight:700">'+self.money(totO)+'</td></tr>';
    body+='<tr style="border-top:2px solid #222"><td style="padding:8px 0;font-weight:800">Net increase (decrease) in cash held</td><td class="r m" style="font-weight:800">'+self.money(net)+'</td></tr>';
    body+='<tr><td style="padding:6px 0">Cash at the beginning of the period</td><td class="r m">'+self.money(begin)+'</td></tr>';
    if(Math.abs(iatNet)>0.005) body+='<tr><td style="padding:4px 0">Inter Account Transfers</td><td class="r m">'+self.money(iatNet)+'</td></tr>';
    body+='<tr style="border-top:1px solid var(--line)"><td style="padding:6px 0;font-weight:700">Cash at the end of the period</td><td class="r m" style="font-weight:700">'+self.money(end)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+sub+'<table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th><th class="r">'+self._repDate(to)+'</th></tr></thead><tbody>'+body+'</tbody></table>'+this.repFoot(); },
  _renderInvValue(b,key,inst){ var self=this; var items=(b.records&&b.records.inventory)||[]; var from=inst.from,to=inst.to;
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var tO=0,tP=0,tC=0,tA=0,tCl=0;
    var rows=items.map(function(it){ var m=self._invMovePeriod(b,it,from,to); tO+=m.openV;tP+=m.purchV;tC+=m.cogsV;tA+=m.adjV;tCl+=m.closeV;
      return '<tr><td>'+self.esc(it.name||'')+'</td><td class="r m">'+M(m.openV)+'</td><td class="r m">'+M(m.purchV)+'</td><td class="r m"><span style="color:var(--muted-2)">-</span></td><td class="r m">'+M(-m.cogsV)+'</td><td class="r m">'+M(m.adjV)+'</td><td class="r m">'+M(m.closeV)+'</td></tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td></td><td class="r m">'+self.money(tO)+'</td><td class="r m">'+self.money(tP)+'</td><td></td><td class="r m">'+self.money(-tC)+'</td><td class="r m">'+self.money(tA)+'</td><td class="r m">'+self.money(tCl)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Item</th><th class="r">Opening balance</th><th class="r">Purchases</th><th class="r">Production Orders</th><th class="r">Cost of sales</th><th class="r">Adjustments</th><th class="r">Closing balance</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7"><div class="reg-empty">No inventory items.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _renderInvQty(b,key,inst){ var self=this; var items=(b.records&&b.records.inventory)||[]; var from=inst.from,to=inst.to;
    var Q=function(v){ var n=Number(v)||0; return Math.abs(n)<0.0005?'<span style="color:var(--muted-2)">-</span>':(Math.round(n*1000)/1000).toLocaleString(); };
    var rows=items.map(function(it){ var m=self._invMovePeriod(b,it,from,to);
      return '<tr><td>'+self.esc(it.name||'')+'</td><td class="r m">'+Q(m.openQ)+'</td><td class="r m">'+Q(m.purchQ)+'</td><td class="r m"><span style="color:var(--muted-2)">-</span></td><td class="r m">'+Q(-m.salesQ)+'</td><td class="r m">'+Q(m.closeQ)+'</td></tr>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Item</th><th class="r">Opening balance</th><th class="r">Purchases</th><th class="r">Inventory Write-offs</th><th class="r">Sales</th><th class="r">Closing balance</th></tr></thead><tbody>'+(rows||'<tr><td colspan="6"><div class="reg-empty">No inventory items.</div></td></tr>')+'</tbody></table>'+this.repFoot(); },
  _renderFixedAsset(b,key,inst){ var self=this; var fas=(b.records&&b.records.fixedAssets)||[];
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var tCost=0,tDep=0,tCl=0; var blank='<td class="r m"><span style="color:var(--muted-2)">-</span></td>';
    var rows=fas.map(function(a){ var cost=faCost(b,a), dep=faAccumDep(b,a), bv=faBookValue(b,a); tCost+=cost; tDep+=dep; tCl+=bv;
      var h='<tr><td style="font-weight:700;padding-top:8px">'+self.esc(a.name||'')+'</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
      h+='<tr><td style="padding-left:18px">At cost</td>'+blank+'<td class="r m">'+M(cost)+'</td>'+blank+blank+blank+'<td class="r m">'+M(cost)+'</td></tr>';
      if(Math.abs(dep)>0.005) h+='<tr><td style="padding-left:18px">Accumulated depreciation</td>'+blank+blank+blank+'<td class="r m">'+M(dep)+'</td>'+blank+'<td class="r m">'+M(-dep)+'</td></tr>';
      return h; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td></td><td></td><td class="r m">'+self.money(tCost)+'</td><td></td>'+(tDep?('<td class="r m">'+self.money(tDep)+'</td>'):'<td></td>')+'<td></td><td class="r m">'+self.money(tCl)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Asset</th><th class="r">Opening balance</th><th class="r">Acquisition cost</th><th class="r">Consideration received</th><th class="r">Depreciation</th><th class="r">Profit (loss)</th><th class="r">Closing balance</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7"><div class="reg-empty">No fixed assets.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _payslipAgg(b,from,to){ var self=this; var R=b.records||{}; var byEmp={}; var byItem={};
    (R.payslips||[]).forEach(function(p){ if(!self._inRange(p.date,from,to)) return; var emp=p.employee||'(unnamed)'; if(!byEmp[emp]) byEmp[emp]={gross:0,ded:0,net:0,contrib:0};
      (p.lines||[]).forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var it=ln.desc||ln.item||'Item';
        if(ln.ptype==='Deduction'){ byEmp[emp].ded+=a; } else if(ln.ptype==='Contribution'){ byEmp[emp].contrib+=a; } else { byEmp[emp].gross+=a; byItem[it]=byItem[it]||{}; byItem[it][emp]=(byItem[it][emp]||0)+a; } });
      var net=Number(p.netPay!=null?p.netPay:p.total); if(net==null||isNaN(net)) net=byEmp[emp].gross-byEmp[emp].ded; byEmp[emp].net+=net; });
    return {byEmp:byEmp, byItem:byItem}; },
  _renderPayslipSummary(b,key,inst){ var self=this; var ag=self._payslipAgg(b,inst.from,inst.to); var byEmp=ag.byEmp;
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var names=Object.keys(byEmp).sort(); var tG=0,tD=0,tN=0,tC=0;
    var rows=names.map(function(nm){ var e=byEmp[nm]; tG+=e.gross;tD+=e.ded;tN+=e.net;tC+=e.contrib;
      return '<tr><td>'+self.esc(nm)+'</td><td class="r m">'+M(e.gross)+'</td><td class="r m">'+M(e.ded)+'</td><td class="r m">'+M(e.net)+'</td><td class="r m">'+M(e.contrib)+'</td></tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td></td><td class="r m">'+self.money(tG)+'</td><td class="r m">'+self.money(tD)+'</td><td class="r m">'+self.money(tN)+'</td><td class="r m">'+(tC?self.money(tC):'<span style=\"color:#bbb\">-</span>')+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th></th><th class="r">Gross pay</th><th class="r">Total deductions</th><th class="r">Net pay</th><th class="r">Total contributions</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5"><div class="reg-empty">No payslips in this period.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _renderPayslipItems(b,key,inst){ var self=this; var ag=self._payslipAgg(b,inst.from,inst.to); var byItem=ag.byItem; var byEmp=ag.byEmp;
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    var items=Object.keys(byItem).sort(); var grossTot=0;
    var body=items.map(function(it){ var emps=byItem[it]; var eNames=Object.keys(emps); var itemTot=0;
      var rs='<tr><td style="padding:9px 0 2px;font-weight:800">'+self.esc(it)+'</td><td></td></tr>';
      rs+=eNames.map(function(nm){ itemTot+=emps[nm]; return '<tr><td style="padding:3px 0 3px 16px">'+self.esc(nm)+'</td><td class="r m">'+M(emps[nm])+'</td></tr>'; }).join('');
      rs+='<tr style="border-top:1px solid var(--line)"><td style="padding:5px 0;font-weight:700">Total — '+self.esc(it)+'</td><td class="r m" style="font-weight:700">'+self.money(itemTot)+'</td></tr>'; grossTot+=itemTot; return rs; }).join('');
    var netTot=Object.keys(byEmp).reduce(function(a,nm){ return a+byEmp[nm].net; },0);
    body+='<tr style="border-top:2px solid #222"><td style="padding:8px 0;font-weight:800">Gross pay</td><td class="r m" style="font-weight:800">'+self.money(grossTot)+'</td></tr>';
    body+='<tr><td style="padding:6px 0;font-weight:700">Net pay</td><td class="r m" style="font-weight:700">'+self.money(netTot)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th><th class="r">'+self.esc(inst.colName||'Total')+'</th></tr></thead><tbody>'+(body||'<tr><td colspan="2"><div class="reg-empty">No payslips in this period.</div></td></tr>')+'</tbody></table>'+this.repFoot(); },
  _renderEmpSummary(b,key,inst){ var self=this; var R=b.records||{}; var emp=inst.emp||'';
    var M=function(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':self.money(n); };
    if(emp){ var earn={},ded={}; var net=0; (R.payslips||[]).forEach(function(p){ if(p.employee!==emp||!self._inRange(p.date,inst.from,inst.to)) return; (p.lines||[]).forEach(function(ln){ var a=Number(ln.amount)||0; if(!a) return; var it=ln.desc||ln.item||'Item'; if(ln.ptype==='Deduction') ded[it]=(ded[it]||0)+a; else earn[it]=(earn[it]||0)+a; }); var n=Number(p.netPay!=null?p.netPay:p.total)||0; net+=n; });
      var eK=Object.keys(earn).sort(), dK=Object.keys(ded).sort();
      var body='<tr><td style="padding:8px 0 2px;font-weight:800">Payslip Earnings Items</td><td></td></tr>';
      body+=eK.map(function(k){ return '<tr><td style="padding:3px 0 3px 16px">'+self.esc(k)+'</td><td class="r m">'+M(earn[k])+'</td></tr>'; }).join('')||'<tr><td style="padding-left:16px;color:#bbb">None</td><td></td></tr>';
      if(dK.length){ body+='<tr><td style="padding:8px 0 2px;font-weight:800">Payslip Deduction Items</td><td></td></tr>'; body+=dK.map(function(k){ return '<tr><td style="padding:3px 0 3px 16px">'+self.esc(k)+'</td><td class="r m">'+M(ded[k])+'</td></tr>'; }).join(''); }
      body+='<tr style="border-top:2px solid #222"><td style="padding:8px 0;font-weight:800">Net pay</td><td class="r m" style="font-weight:800">'+self.money(net)+'</td></tr>';
      return this.repHead(b,(this._REPDEF[key]||{}).name)+'<div style="text-align:center;font-weight:700;margin:-8px 0 12px">'+self.esc(emp)+'</div><table class="reg-tbl" style="border-collapse:collapse"><thead><tr><th></th><th class="r">'+self.esc(inst.colName||'Total')+'</th></tr></thead><tbody>'+body+'</tbody></table>'+this.repFoot(); }
    var emps=(R.employees||[]); var tot=0; var rows=emps.map(function(e){ var v=employeeBalance(b,e.name); tot+=v; return '<tr><td>'+self.esc(e.name||'')+'</td><td class="r m">'+M(v)+'</td></tr>'; }).join('');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<table class="reg-tbl"><thead><tr><th>Employee</th><th class="r">Net balance owing</th></tr></thead><tbody>'+(rows||'<tr><td colspan="2"><div class="reg-empty">No employees.</div></td></tr>')+'</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total</td><td class="r m">'+self.money(tot)+'</td></tr></tfoot></table>'+this.repFoot(); },
  _renderEmpStatement(b,key,inst){ var self=this; var R=b.records||{}; var emp=inst.emp||''; var from=inst.from,to=inst.to;
    if(!emp){ return this.repHead(b,(this._REPDEF[key]||{}).name)+'<div class="info-bar">Choose an employee in the report settings (Edit) to produce a statement.</div>'+this.repFoot(); }
    var tx=[];
    (R.payslips||[]).forEach(function(p){ if(p.employee!==emp) return; var n=Number(p.netPay!=null?p.netPay:p.total)||0; if(n) tx.push({date:p.date,desc:'Payslip'+(p.reference?' '+p.reference:'')+' — '+(p.description||'Salary'),d:n}); });
    var scan=function(list,sign){ (list||[]).forEach(function(r){ var lns=(r.lines&&r.lines.length)?r.lines:[{account:r.account,sub:r.sub,amount:r.amount}]; lns.forEach(function(ln){ if(ln.sub===emp && acctNameMatches(b,ln.account,EMP_RE)){ var a=Number(ln.amount)||0; if(a) tx.push({date:r.date,desc:(r.description||r.reference||'')+'',ref:r.reference,d:sign*a}); } }); }); };
    scan(R.payments,-1); scan(R.receipts,1);
    (R.journal||[]).forEach(function(j){ (j.lines||[]).forEach(function(ln){ if(ln.sub===emp && acctNameMatches(b,ln.account,EMP_RE)){ var net=(Number(ln.credit)||0)-(Number(ln.debit)||0); if(net) tx.push({date:j.date,desc:(j.narration||j.reference||'Journal'),d:net}); } }); });
    var openBal=0; var inP=[]; tx.sort(function(a,b){ return String(a.date||'').localeCompare(String(b.date||'')); });
    tx.forEach(function(t){ var dt=String(t.date||'').slice(0,10); if(from && dt && dt<from){ openBal+=t.d; } else if(self._inRange(t.date,from,to)){ inP.push(t); } });
    var crd=function(v){ var n=Number(v)||0; if(Math.abs(n)<0.005) return ''; return self.money(Math.abs(n))+' '+(n>=0?'Cr':'Dr'); };
    var run=openBal; var tDr=0,tCr=0;
    var rowsH=''; if(Math.abs(openBal)>0.005) rowsH+='<tr><td>'+self._repDate(from)+'</td><td style="font-style:italic">Opening balance</td><td class="r m"></td><td class="r m"></td><td class="r m">'+crd(openBal)+'</td></tr>';
    rowsH+=inP.map(function(t){ run+=t.d; var dr=t.d<0?-t.d:0, cr=t.d>0?t.d:0; tDr+=dr; tCr+=cr; return '<tr><td style="white-space:nowrap">'+self._repDate(t.date)+'</td><td>'+self.esc(t.desc||'')+'</td><td class="r m">'+(dr?self.money(dr):'')+'</td><td class="r m">'+(cr?self.money(cr):'')+'</td><td class="r m">'+crd(run)+'</td></tr>'; }).join('');
    var tf='<tr style="font-weight:700;border-top:2px solid var(--line)"><td colspan="2" class="r">Total debits</td><td class="r m">'+self.money(tDr)+'</td><td></td><td class="r m">'+self.money(tDr)+' Dr</td></tr>'+
      '<tr style="font-weight:700"><td colspan="2" class="r">Total credits</td><td></td><td class="r m">'+self.money(tCr)+'</td><td class="r m">'+self.money(tCr)+' Cr</td></tr>'+
      '<tr style="font-weight:800;border-top:1px solid var(--line)"><td colspan="2" class="r">Closing balance</td><td></td><td></td><td class="r m">'+crd(run)+'</td></tr>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+'<div style="text-align:center;font-weight:700;margin:-8px 0 12px">'+self.esc(emp)+'</div><table class="reg-tbl"><thead><tr><th>Date</th><th>Description</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>'+(rowsH||'<tr><td colspan="5"><div class="reg-empty">No transactions in this period.</div></td></tr>')+'</tbody><tfoot>'+tf+'</tfoot></table>'+this.repFoot(); },
  _repSimpleTable(cols, rows, foot){
    const th=cols.map(c=>'<th'+(c.r?' class="r"':'')+'>'+this.esc(c.l)+'</th>').join('');
    const body=(rows&&rows.length)?rows.map(r=>'<tr>'+r.map((cell,i)=>'<td'+(cols[i]&&cols[i].r?' class="r m"':'')+'>'+cell+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+cols.length+'"><div class="reg-empty">Nothing to show yet.</div></td></tr>';
    const tf=foot?'<tfoot><tr style="font-weight:700;border-top:2px solid var(--line)">'+foot.map((cell,i)=>'<td'+(cols[i]&&cols[i].r?' class="r m"':'')+'>'+cell+'</td>').join('')+'</tr></tfoot>':'';
    return '<table class="reg-tbl"><thead><tr>'+th+'</tr></thead><tbody>'+body+'</tbody>'+tf+'</table>'; },
  genLedgerSummaryHtml(b){ const mov=accountMovements(b); const rank={assets:0,liabilities:1,equity:2,income:3,expense:4};
    const rows=[]; let tO=0,tD=0,tC=0,tCl=0;
    (b.coa||[]).filter(n=>n.type==='account').forEach(n=>{ const ge=glEntries(b,n.id); let d=0,c=0; (ge.rows||[]).forEach(r=>{ d+=Number(r.debit)||0; c+=Number(r.credit)||0; });
      const open=Number(ge.opening)||0; const close=liveBalance(b,n,mov);
      if(Math.abs(open)<0.005&&Math.abs(close)<0.005&&Math.abs(d)<0.005&&Math.abs(c)<0.005) return;
      rows.push({r:rank[acctRoot(b,n)]||0,name:acctPath(b,n),open,d,c,close}); });
    rows.sort((a,b)=>a.r-b.r||a.name.localeCompare(b.name));
    rows.forEach(r=>{ tO+=r.open; tD+=r.d; tC+=r.c; tCl+=r.close; });
    const tr=rows.map(r=>[this.esc(r.name), this.money(r.open), this.money(r.d), this.money(r.c), this.money(r.close)]);
    return this.repHead(b,'General Ledger Summary')+
      this._repSimpleTable([{l:'Account'},{l:'Opening',r:1},{l:'Debit',r:1},{l:'Credit',r:1},{l:'Closing',r:1}], tr, ['Total', this.money(tO), this.money(tD), this.money(tC), this.money(tCl)])+
      this.repFoot(); },
  bankSummaryHtml(b){ const banks=(b.records&&b.records.bankCash)||[]; let tot=0;
    const tr=banks.map(bk=>{ const val=bankActual(b,bk); tot+=val; return [this.esc(bk.name||'(unnamed)'), this.money(val)]; });
    return this.repHead(b,'Bank Account Summary')+this._repSimpleTable([{l:'Bank / cash account'},{l:'Balance',r:1}], tr, ['Total', this.money(tot)])+this.repFoot(); },
  receiptsPaymentsHtml(b){ const R=b.records||{}; const banks=(R.bankCash||[]); let trc=0,tpm=0;
    const tr=banks.map(bk=>{ let rc=0,pm=0; (R.receipts||[]).forEach(r=>{ if(bankMatch(r.receivedIn,bk)) rc+=Number(r.amount)||0; }); (R.payments||[]).forEach(p=>{ if(bankMatch(p.paidFrom,bk)) pm+=Number(p.amount)||0; }); trc+=rc; tpm+=pm; return [this.esc(bk.name||''), this.money(rc), this.money(pm), this.money(rc-pm)]; });
    return this.repHead(b,'Receipts & Payments Summary')+this._repSimpleTable([{l:'Bank / cash account'},{l:'Receipts',r:1},{l:'Payments',r:1},{l:'Net',r:1}], tr, ['Total', this.money(trc), this.money(tpm), this.money(trc-tpm)])+this.repFoot(); },
  capitalSummaryHtml(b){ const caps=(b.records&&b.records.capital)||[]; let tot=0;
    const tr=caps.map(c=>{ const val=capitalBalance(b,c.name); tot+=val; return [this.esc(c.name||''), this.money(val)]; });
    return this.repHead(b,'Capital Accounts Summary')+this._repSimpleTable([{l:'Member / partner'},{l:'Balance',r:1}], tr, ['Total', this.money(tot)])+this.repFoot(); },
  employeeSummaryHtml(b){ const emps=(b.records&&b.records.employees)||[]; let tot=0;
    const tr=emps.map(e=>{ const val=employeeBalance(b,e.name); tot+=val; return [this.esc(e.name||''), this.money(val)]; });
    return this.repHead(b,'Employee Summary')+this._repSimpleTable([{l:'Employee'},{l:'Net balance owing',r:1}], tr, ['Total', this.money(tot)])+this.repFoot(); },
  invReportHtml(b,mode){ const items=(b.records&&b.records.inventory)||[]; const nf=function(x){ var val=Number(x)||0; return (Math.round(val*1000)/1000).toLocaleString(); };
    let cols, tr, foot, title;
    if(mode==='qty'){ title='Inventory Quantity Summary'; cols=[{l:'Item'},{l:'Starting qty',r:1},{l:'Qty on hand',r:1}]; let t1=0,t2=0;
      tr=items.map(it=>{ const s=invItemStats(b,it); t1+=s.startQty||0; t2+=s.qtyOnHand||0; return [this.esc(it.name||''), nf(s.startQty), nf(s.qtyOnHand)]; }); foot=['Total', nf(t1), nf(t2)]; }
    else if(mode==='margin'){ title='Inventory Profit Margin'; cols=[{l:'Item'},{l:'Avg cost',r:1},{l:'Cost of sales',r:1},{l:'Stock value',r:1}]; let tc=0,tv=0;
      tr=items.map(it=>{ const s=invItemStats(b,it); tc+=s.cogs||0; tv+=s.totalCost||0; return [this.esc(it.name||''), this.money(s.avgCost), this.money(s.cogs), this.money(s.totalCost)]; }); foot=['Total','', this.money(tc), this.money(tv)]; }
    else { title='Inventory Value Summary'; cols=[{l:'Item'},{l:'Qty on hand',r:1},{l:'Avg cost',r:1},{l:'Stock value',r:1}]; let tq=0,tv=0;
      tr=items.map(it=>{ const s=invItemStats(b,it); tq+=s.qtyOnHand||0; tv+=s.totalCost||0; return [this.esc(it.name||''), nf(s.qtyOnHand), this.money(s.avgCost), this.money(s.totalCost)]; }); foot=['Total', nf(tq), '', this.money(tv)]; }
    return this.repHead(b,title)+this._repSimpleTable(cols, tr, foot)+this.repFoot(); },
  fixedAssetSummaryHtml(b){ const fas=(b.records&&b.records.fixedAssets)||[]; let tCost=0,tDep=0,tBv=0;
    const tr=fas.map(a=>{ const cost=faCost(b,a), dep=faAccumDep(b,a), bv=faBookValue(b,a); tCost+=cost; tDep+=dep; tBv+=bv; return [this.esc(a.name||''), this.money(cost), this.money(dep), this.money(bv)]; });
    return this.repHead(b,'Fixed Asset Summary')+this._repSimpleTable([{l:'Asset'},{l:'Cost',r:1},{l:'Accumulated depreciation',r:1},{l:'Book value',r:1}], tr, ['Total', this.money(tCost), this.money(tDep), this.money(tBv)])+this.repFoot(); },
  /* Safety net only: every key in _REPDEF has a renderer wired into
     reportViewHtml(). This shows if one is ever added without one, instead of
     a blank page. test/reports.test.mjs fails if it is ever reachable. */
  repSoonHtml(b,name){ return this.repHead(b,name)+
    '<div class="info-bar">This report has no renderer registered. Add a <code>_render*</code> method to <code>App</code> in <code>js/app.js</code> and wire it into <code>reportViewHtml()</code>’s dispatch.</div>'+this.repFoot(); },
  /* ===================== reports added for Manager.io parity ===================== */
  _repM(v){ var n=Number(v)||0; return Math.abs(n)<0.005?'<span style="color:var(--muted-2)">-</span>':this.money(n); },
  _repQ(v){ var n=Number(v)||0; return Math.abs(n)<0.0005?'<span style="color:var(--muted-2)">-</span>':(Math.round(n*1000)/1000).toLocaleString(); },
  _repTbl(head,body,foot,cols,empty){ return '<table class="reg-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+
    (body||('<tr><td colspan="'+cols+'"><div class="reg-empty">'+this.esc(empty||'Nothing to show.')+'</div></td></tr>'))+
    '</tbody>'+(foot?('<tfoot>'+foot+'</tfoot>'):'')+'</table>'; },
  _repTotRow(cells){ return '<tr style="font-weight:700;border-top:2px solid var(--line)">'+cells+'</tr>'; },

  /* ---- invoice helpers shared by the ageing / unpaid / totals reports ---- */
  _invPaidTo(b,inv,party,to){ var self=this; var R=b.records||{}; var isC=(party==='cust');
    var name=isC?inv.customer:inv.supplier; var paid=0;
    var RE=isC?AR_RE:AP_RE; var payKey=isC?'receipts':'payments', revKey=isC?'payments':'receipts';
    (R[payKey]||[]).forEach(function(r){ if(to && String(r.date||'').slice(0,10)>to) return;
      (r.lines||[]).forEach(function(ln){ if(ln.sub===name && acctNameMatches(b,ln.account,RE)) paid+=Number(ln.amount)||0; }); });
    (R[revKey]||[]).forEach(function(r){ if(to && String(r.date||'').slice(0,10)>to) return;
      (r.lines||[]).forEach(function(ln){ if(ln.sub===name && acctNameMatches(b,ln.account,RE)) paid-=Number(ln.amount)||0; }); });
    (R[isC?'creditNotes':'debitNotes']||[]).forEach(function(n){ if(to && String(n.issueDate||n.date||'').slice(0,10)>to) return;
      if((isC?n.customer:n.supplier)===name) paid+=Number(n.total)||0; });
    if(isC) (R.whtReceipts||[]).forEach(function(w){ if(to && String(w.date||'').slice(0,10)>to) return; if(w.customer===name) paid+=Number(w.amount)||0; });
    return paid; },
  /* What each party still owes, invoice by invoice. Explicit payment allocations
     are honoured first; whatever a party has paid without naming an invoice is
     still spread oldest-first, which is what keeps an ageing report meaningful.
     settlementIndex() is the single implementation — the allocation panel on the
     payment form reads the same numbers, so the two cannot drift apart. */
  _openInvoices(b,party,to){
    var ix=settlementIndex(b,party,{to:to}); var out=[];
    Object.keys(ix.byParty).forEach(function(nm){
      ix.byParty[nm].invoices.forEach(function(r){
        if(Math.abs(r.outstanding)<0.005) return;
        out.push({party:nm, inv:r.invoice, total:r.total, due:r.outstanding,
          date:String(r.invoice.issueDate||r.invoice.date||'').slice(0,10),
          dueDate:String(r.invoice.dueDate||'').slice(0,10), ref:r.invoice.reference||''});
      });
    });
    return out; },
  _ageDays(asOf,d){ if(!d) return 0; var P=function(v){ var m=String(v||'').slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m?Date.UTC(+m[1],+m[2]-1,+m[3]):NaN; };
    var a=P(asOf||new Date().toISOString().slice(0,10)), x=P(d);
    if(isNaN(a)||isNaN(x)) return 0; return Math.round((a-x)/86400000); },

  _renderAged(b,key,inst,party){ var self=this; var to=inst.to||new Date().toISOString().slice(0,10);
    var open=this._openInvoices(b,party,to);
    var buckets=[[0,'Current'],[1,'1–30 days'],[31,'31–60 days'],[61,'61–90 days'],[91,'Over 90 days']];
    var byParty={};
    open.forEach(function(o){ var ref=o.dueDate||o.date; var age=self._ageDays(to,ref);
      var bi=0; if(age<=0) bi=0; else if(age<=30) bi=1; else if(age<=60) bi=2; else if(age<=90) bi=3; else bi=4;
      var row=byParty[o.party]=byParty[o.party]||{n:[0,0,0,0,0],tot:0}; row.n[bi]+=o.due; row.tot+=o.due; });
    var names=Object.keys(byParty).sort(); var tots=[0,0,0,0,0], grand=0;
    var body=names.map(function(nm){ var r=byParty[nm]; grand+=r.tot;
      return '<tr><td>'+self.esc(nm)+'</td>'+r.n.map(function(v,i){ tots[i]+=v; return '<td class="r m">'+self._repM(v)+'</td>'; }).join('')+
        '<td class="r m" style="font-weight:600">'+self._repM(r.tot)+'</td></tr>'; }).join('');
    var head='<th>'+(party==='cust'?'Customer':'Supplier')+'</th>'+buckets.map(function(x){ return '<th class="r">'+x[1]+'</th>'; }).join('')+'<th class="r">Total</th>';
    var foot=this._repTotRow('<td></td>'+tots.map(function(v){ return '<td class="r m">'+self.money(v)+'</td>'; }).join('')+'<td class="r m">'+self.money(grand)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+
      this._repTbl(head,body,foot,7,party==='cust'?'Nothing outstanding from customers.':'Nothing outstanding to suppliers.')+
      '<div class="info-bar">Aged by due date where an invoice has one, otherwise by issue date. Payments that are not tied to a particular invoice are applied oldest-first.</div>'+this.repFoot(); },

  _renderUnpaid(b,key,inst,party){ var self=this; var to=inst.to||new Date().toISOString().slice(0,10);
    var open=this._openInvoices(b,party,to);
    var byParty={}; open.forEach(function(o){ (byParty[o.party]=byParty[o.party]||[]).push(o); });
    var names=Object.keys(byParty).sort(); var grand=0;
    var body=names.map(function(nm){ var list=byParty[nm]; var sub=0;
      var h='<tr><td colspan="5" style="font-weight:700;padding-top:10px">'+self.esc(nm)+'</td></tr>';
      h+=list.map(function(o){ sub+=o.due; grand+=o.due;
        return '<tr><td style="padding-left:18px">'+self._repDate(o.date)+'</td><td>'+self.esc(o.ref)+'</td><td>'+
          (o.dueDate?self._repDate(o.dueDate):'<span style="color:var(--muted-2)">-</span>')+'</td><td class="r m">'+self._repM(o.total)+'</td>'+
          '<td class="r m" style="font-weight:600">'+self._repM(o.due)+'</td></tr>'; }).join('');
      h+='<tr><td colspan="4" style="text-align:right;font-weight:600">Total for '+self.esc(nm)+'</td><td class="r m" style="font-weight:700">'+self.money(sub)+'</td></tr>';
      return h; }).join('');
    var head='<th>Issue date</th><th>Reference</th><th>Due date</th><th class="r">Invoice total</th><th class="r">Balance due</th>';
    var foot=this._repTotRow('<td colspan="4" style="text-align:right">Total outstanding</td><td class="r m">'+this.money(grand)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+
      this._repTbl(head,body,foot,5,'No unpaid invoices.')+this.repFoot(); },

  _renderInvTotalsByParty(b,key,inst,party){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var isC=(party==='cust'); var src=isC?'salesInv':'purchInv'; var pk=isC?'customer':'supplier';
    var agg={};
    (R[src]||[]).forEach(function(inv){ if(!self._inRange(inv.issueDate||inv.date,from,to)) return;
      var nm=inv[pk]||'(none)'; var a=agg[nm]=agg[nm]||{n:0,net:0,tax:0,tot:0};
      a.n++; a.net+=Number(inv.subtotal!=null?inv.subtotal:inv.total)||0; a.tax+=Number(inv.tax)||0; a.tot+=Number(inv.total)||0; });
    var names=Object.keys(agg).sort(function(x,y){ return agg[y].tot-agg[x].tot; });
    var tN=0,tNet=0,tTax=0,tTot=0;
    var body=names.map(function(nm){ var a=agg[nm]; tN+=a.n; tNet+=a.net; tTax+=a.tax; tTot+=a.tot;
      return '<tr><td>'+self.esc(nm)+'</td><td class="r m">'+a.n+'</td><td class="r m">'+self._repM(a.net)+'</td><td class="r m">'+
        self._repM(a.tax)+'</td><td class="r m" style="font-weight:600">'+self._repM(a.tot)+'</td></tr>'; }).join('');
    var head='<th>'+(isC?'Customer':'Supplier')+'</th><th class="r">Invoices</th><th class="r">Net</th><th class="r">Tax</th><th class="r">Total</th>';
    var foot=this._repTotRow('<td></td><td class="r m">'+tN+'</td><td class="r m">'+this.money(tNet)+'</td><td class="r m">'+
      this.money(tTax)+'</td><td class="r m">'+this.money(tTot)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,5,'No invoices in this period.')+this.repFoot(); },

  _renderInvTotalsByItem(b,key,inst,party){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var isC=(party==='cust'); var src=isC?'salesInv':'purchInv';
    var agg={};
    (R[src]||[]).forEach(function(inv){ if(!self._inRange(inv.issueDate||inv.date,from,to)) return;
      (inv.lines||[]).forEach(function(ln){ var nm=ln.item||ln.desc||'(no item)';
        var net=Number(ln.net!=null?ln.net:ln.amount)||0; if(!net && !ln.qty) return;
        var a=agg[nm]=agg[nm]||{qty:0,net:0}; a.qty+=Number(ln.qty)||0; a.net+=net; }); });
    var names=Object.keys(agg).sort(function(x,y){ return agg[y].net-agg[x].net; });
    var tQ=0,tNet=0;
    var body=names.map(function(nm){ var a=agg[nm]; tQ+=a.qty; tNet+=a.net;
      var avg=a.qty?a.net/a.qty:0;
      return '<tr><td>'+self.esc(nm)+'</td><td class="r m">'+self._repQ(a.qty)+'</td><td class="r m">'+self._repM(avg)+
        '</td><td class="r m" style="font-weight:600">'+self._repM(a.net)+'</td></tr>'; }).join('');
    var head='<th>Item</th><th class="r">Quantity</th><th class="r">Average price</th><th class="r">'+(isC?'Sales':'Purchases')+'</th>';
    var foot=this._repTotRow('<td></td><td class="r m">'+this._repQ(tQ)+'</td><td></td><td class="r m">'+this.money(tNet)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,4,'No invoice lines in this period.')+this.repFoot(); },

  _renderInvMovement(b,key,inst,mode){ var self=this; var items=(b.records&&b.records.inventory)||[]; var from=inst.from,to=inst.to;
    var isQ=(mode==='qty'); var F=isQ?function(v){return self._repQ(v);}:function(v){return self._repM(v);};
    var t=[0,0,0,0,0];
    var body=items.map(function(it){ var m=self._invMovePeriod(b,it,from,to);
      var vals=isQ?[m.openQ,m.purchQ,-m.salesQ,m.adjQ,m.closeQ]:[m.openV,m.purchV,-m.cogsV,m.adjV,m.closeV];
      vals.forEach(function(v,i){ t[i]+=v; });
      return '<tr><td>'+self.esc(it.name||'')+'</td>'+vals.map(function(v,i){
        return '<td class="r m"'+(i===4?' style="font-weight:600"':'')+'>'+F(v)+'</td>'; }).join('')+'</tr>'; }).join('');
    var head='<th>Item</th><th class="r">Opening</th><th class="r">'+(isQ?'Received':'Purchases')+'</th><th class="r">'+
      (isQ?'Issued':'Cost of sales')+'</th><th class="r">Adjustments</th><th class="r">Closing</th>';
    var foot=this._repTotRow('<td></td>'+t.map(function(v){ return '<td class="r m">'+(isQ?self._repQ(v):self.money(v))+'</td>'; }).join(''));
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,6,'No inventory items.')+this.repFoot(); },

  _renderInvMargin(b,key,inst){ var self=this; var R=b.records||{}; var items=R.inventory||[]; var from=inst.from,to=inst.to;
    var sales={};
    (R.salesInv||[]).forEach(function(inv){ if(!self._inRange(inv.issueDate||inv.date,from,to)) return;
      (inv.lines||[]).forEach(function(ln){ if(!ln.item) return; var a=sales[ln.item]=sales[ln.item]||{qty:0,rev:0};
        a.qty+=Number(ln.qty)||0; a.rev+=Number(ln.net!=null?ln.net:ln.amount)||0; }); });
    var tRev=0,tCost=0;
    var body=items.map(function(it){ var s=sales[it.name]||{qty:0,rev:0}; var m=self._invMovePeriod(b,it,from,to);
      var cost=m.cogsV; if(!s.qty && !cost) return '';
      var profit=s.rev-cost; var pct=s.rev?(profit/s.rev*100):0; tRev+=s.rev; tCost+=cost;
      return '<tr><td>'+self.esc(it.name||'')+'</td><td class="r m">'+self._repQ(s.qty)+'</td><td class="r m">'+self._repM(s.rev)+
        '</td><td class="r m">'+self._repM(cost)+'</td><td class="r m" style="font-weight:600">'+self._repM(profit)+
        '</td><td class="r m">'+(s.rev?((Math.round(pct*10)/10)+'%'):'<span style="color:var(--muted-2)">-</span>')+'</td></tr>'; }).join('');
    var tp=tRev-tCost;
    var head='<th>Item</th><th class="r">Qty sold</th><th class="r">Sales</th><th class="r">Cost of sales</th><th class="r">Gross profit</th><th class="r">Margin</th>';
    var foot=this._repTotRow('<td></td><td></td><td class="r m">'+this.money(tRev)+'</td><td class="r m">'+this.money(tCost)+
      '</td><td class="r m">'+this.money(tp)+'</td><td class="r m">'+(tRev?((Math.round(tp/tRev*1000)/10)+'%'):'-')+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,6,'Nothing sold in this period.')+this.repFoot(); },

  _renderInvPriceList(b,key,inst){ var self=this; var items=(b.records&&b.records.inventory)||[];
    var body=items.map(function(it){ var st=invItemStats(b,it);
      return '<tr><td>'+self.esc(it.code||'')+'</td><td>'+self.esc(it.name||'')+'</td><td>'+self.esc(it.unit||'')+
        '</td><td class="r m">'+self._repM(it.purchasePrice)+'</td><td class="r m">'+self._repM(it.salesPrice)+
        '</td><td class="r m">'+self._repM(st.avgCost)+'</td><td class="r m">'+self._repQ(st.qtyOnHand)+'</td></tr>'; }).join('');
    var head='<th>Code</th><th>Item</th><th>Unit</th><th class="r">Purchase price</th><th class="r">Sale price</th><th class="r">Average cost</th><th class="r">Qty on hand</th>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,'',7,'No inventory items.')+this.repFoot(); },

  _renderNonInvTotals(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var names={}; (R.nonInvItems||[]).forEach(function(i){ if(i.name) names[i.name]={sQty:0,sNet:0,pQty:0,pNet:0}; });
    var scan=function(src,qk,nk){ (R[src]||[]).forEach(function(inv){ if(!self._inRange(inv.issueDate||inv.date,from,to)) return;
      (inv.lines||[]).forEach(function(ln){ var a=names[ln.item]; if(!a) return;
        a[qk]+=Number(ln.qty)||0; a[nk]+=Number(ln.net!=null?ln.net:ln.amount)||0; }); }); };
    scan('salesInv','sQty','sNet'); scan('purchInv','pQty','pNet');
    var ks=Object.keys(names).sort(); var t=[0,0,0,0];
    var body=ks.map(function(nm){ var a=names[nm]; t[0]+=a.sQty; t[1]+=a.sNet; t[2]+=a.pQty; t[3]+=a.pNet;
      return '<tr><td>'+self.esc(nm)+'</td><td class="r m">'+self._repQ(a.sQty)+'</td><td class="r m">'+self._repM(a.sNet)+
        '</td><td class="r m">'+self._repQ(a.pQty)+'</td><td class="r m">'+self._repM(a.pNet)+
        '</td><td class="r m" style="font-weight:600">'+self._repM(a.sNet-a.pNet)+'</td></tr>'; }).join('');
    var head='<th>Item</th><th class="r">Qty sold</th><th class="r">Sales</th><th class="r">Qty bought</th><th class="r">Purchases</th><th class="r">Net</th>';
    var foot=this._repTotRow('<td></td><td class="r m">'+this._repQ(t[0])+'</td><td class="r m">'+this.money(t[1])+
      '</td><td class="r m">'+this._repQ(t[2])+'</td><td class="r m">'+this.money(t[3])+'</td><td class="r m">'+this.money(t[1]-t[3])+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,6,'No non-inventory items yet.')+this.repFoot(); },

  /* ---- tax ---- */
  _taxRows(b,from,to){ var self=this; var R=b.records||{}; var rows=[];
    var push=function(src,sign,partyKey,label){ (R[src]||[]).forEach(function(d){ var dt=d.issueDate||d.date;
      if(!self._inRange(dt,from,to)) return;
      (d.lines||[]).forEach(function(ln){ var net=Number(ln.net!=null?ln.net:ln.amount)||0;
        var rate=(ln.taxRate!=null&&ln.taxRate!=='')?Number(ln.taxRate):self.taxRate(ln.tax);
        var tax=(ln.taxAmt!=null&&ln.taxAmt!=='')?Number(ln.taxAmt):(net*(rate||0)/100);
        if(!net && !tax) return;
        rows.push({date:String(dt||'').slice(0,10), ref:d.reference||'', type:label, party:d[partyKey]||'',
          code:(ln.tax||(rate?(rate+'%'):'No tax')), rate:rate||0, net:sign*net, tax:sign*tax, dir:(src==='salesInv'||src==='creditNotes')?'out':'in'}); }); }); };
    push('salesInv',1,'customer','Sales invoice'); push('creditNotes',-1,'customer','Credit note');
    push('purchInv',1,'supplier','Purchase invoice'); push('debitNotes',-1,'supplier','Debit note');
    rows.sort(function(x,y){ return String(x.date).localeCompare(String(y.date)); });
    return rows; },
  _renderTaxRecon(b,key,inst){ var self=this; var from=inst.from,to=inst.to; var rows=this._taxRows(b,from,to);
    var agg={};
    rows.forEach(function(r){ var a=agg[r.code]=agg[r.code]||{rate:r.rate,outNet:0,outTax:0,inNet:0,inTax:0};
      if(r.dir==='out'){ a.outNet+=r.net; a.outTax+=r.tax; } else { a.inNet+=r.net; a.inTax+=r.tax; } });
    var ks=Object.keys(agg).sort(); var t=[0,0,0,0];
    var body=ks.map(function(c){ var a=agg[c]; t[0]+=a.outNet; t[1]+=a.outTax; t[2]+=a.inNet; t[3]+=a.inTax;
      return '<tr><td>'+self.esc(c)+'</td><td class="r m">'+self._repM(a.outNet)+'</td><td class="r m">'+self._repM(a.outTax)+
        '</td><td class="r m">'+self._repM(a.inNet)+'</td><td class="r m">'+self._repM(a.inTax)+
        '</td><td class="r m" style="font-weight:600">'+self._repM(a.outTax-a.inTax)+'</td></tr>'; }).join('');
    var due=t[1]-t[3];
    var ov=findAcct(b,'Output VAT'), iv=findAcct(b,'Input VAT');
    var ledger=(ov?this._acctAsOf(b,ov.id,to):0)-(iv?this._acctAsOf(b,iv.id,to):0);
    var foot=this._repTotRow('<td></td><td class="r m">'+this.money(t[0])+'</td><td class="r m">'+this.money(t[1])+
      '</td><td class="r m">'+this.money(t[2])+'</td><td class="r m">'+this.money(t[3])+'</td><td class="r m">'+this.money(due)+'</td>');
    var diff=Math.round((ledger-due)*100)/100;
    var recon='<table class="reg-tbl" style="margin-top:16px"><thead><tr><th>Reconciliation</th><th class="r">Amount</th></tr></thead><tbody>'+
      '<tr><td>Tax payable per this report</td><td class="r m">'+this.money(due)+'</td></tr>'+
      '<tr><td>Tax payable per the ledger (Output VAT less Input VAT)</td><td class="r m">'+this.money(ledger)+'</td></tr>'+
      '<tr style="font-weight:700;border-top:2px solid var(--line)"><td>Difference</td><td class="r m">'+this.money(diff)+'</td></tr>'+
      '</tbody></table>'+
      (Math.abs(diff)<0.005
        ? '<div class="info-bar">The tax on documents agrees with the tax control accounts.</div>'
        : '<div class="info-bar">These differ by '+this.money(diff)+'. Journal entries posted straight to Input or Output VAT, or documents dated outside the period, will show up here.</div>');
    var head='<th>Tax code</th><th class="r">Sales net</th><th class="r">Tax on sales</th><th class="r">Purchases net</th><th class="r">Tax on purchases</th><th class="r">Net tax</th>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,6,'No taxed documents in this period.')+recon+this.repFoot(); },
  _renderTaxAudit(b,key,inst){ var self=this; var rows=this._taxRows(b,inst.from,inst.to);
    var tN=0,tT=0;
    var body=rows.map(function(r){ tN+=r.net; tT+=r.tax;
      return '<tr><td style="white-space:nowrap">'+self._repDate(r.date)+'</td><td>'+self.esc(r.ref)+'</td><td>'+self.esc(r.type)+
        '</td><td>'+self.esc(r.party)+'</td><td>'+self.esc(r.code)+'</td><td class="r m">'+self._repM(r.net)+
        '</td><td class="r m">'+self._repM(r.tax)+'</td><td class="r m">'+self._repM(r.net+r.tax)+'</td></tr>'; }).join('');
    var head='<th>Date</th><th>Reference</th><th>Type</th><th>Party</th><th>Tax code</th><th class="r">Net</th><th class="r">Tax</th><th class="r">Gross</th>';
    var foot=this._repTotRow('<td colspan="5"></td><td class="r m">'+this.money(tN)+'</td><td class="r m">'+this.money(tT)+
      '</td><td class="r m">'+this.money(tN+tT)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,8,'No taxed documents in this period.')+
      '<div class="info-bar">Every line that carries tax, so you can trace a return figure back to the document it came from.</div>'+this.repFoot(); },

  /* ---- fixed / intangible asset schedules ---- */
  _renderDeprSchedule(b,key,inst){ var self=this; var R=b.records||{}; var fas=R.fixedAssets||[]; var from=inst.from,to=inst.to;
    var periodDep=function(name){ var s=0; (R.depreciation||[]).forEach(function(d){ if(!self._inRange(d.date,from,to)) return;
      (d.lines||[]).forEach(function(ln){ if(ln.asset===name) s+=Number((ln.amount!=null&&ln.amount!=='')?ln.amount:ln.depExpense)||0; }); }); return s; };
    var priorDep=function(name){ var s=0; (R.depreciation||[]).forEach(function(d){ var dt=String(d.date||'').slice(0,10);
      if(from && dt && dt>=from) return; if(!from) return;
      (d.lines||[]).forEach(function(ln){ if(ln.asset===name) s+=Number((ln.amount!=null&&ln.amount!=='')?ln.amount:ln.depExpense)||0; }); }); return s; };
    var t=[0,0,0,0,0];
    var body=fas.map(function(a){ var cost=faCost(b,a);
      var opening=(Number(a.accumDep)||0)+priorDep(a.name); var per=periodDep(a.name); var closing=opening+per;
      var bv=cost-closing; var vals=[cost,opening,per,closing,bv]; vals.forEach(function(v,i){ t[i]+=v; });
      return '<tr><td>'+self.esc(a.name||'')+'</td><td style="white-space:nowrap">'+(a.acqDate?self._repDate(a.acqDate):'')+'</td>'+
        vals.map(function(v,i){ return '<td class="r m"'+(i===4?' style="font-weight:600"':'')+'>'+self._repM(v)+'</td>'; }).join('')+'</tr>'; }).join('');
    var head='<th>Asset</th><th>Acquired</th><th class="r">Cost</th><th class="r">Accumulated at start</th><th class="r">Depreciation for period</th><th class="r">Accumulated at end</th><th class="r">Book value</th>';
    var foot=this._repTotRow('<td colspan="2"></td>'+t.map(function(v){ return '<td class="r m">'+this.money(v)+'</td>'; },this).join(''));
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,7,'No fixed assets.')+this.repFoot(); },

  _renderIntangibles(b,key,inst){ var self=this; var ias=(b.records&&b.records.intangibles)||[];
    var t=[0,0,0];
    var body=ias.map(function(a){ var cost=iaCost(b,a), am=iaAccumAmort(b,a), bv=iaBookValue(b,a);
      t[0]+=cost; t[1]+=am; t[2]+=bv;
      return '<tr><td>'+self.esc(a.name||'')+'</td><td style="white-space:nowrap">'+(a.acqDate?self._repDate(a.acqDate):'')+
        '</td><td class="r m">'+self._repM(cost)+'</td><td class="r m">'+self._repM(am)+
        '</td><td class="r m" style="font-weight:600">'+self._repM(bv)+'</td></tr>'; }).join('');
    var head='<th>Asset</th><th>Acquired</th><th class="r">At cost</th><th class="r">Accumulated amortization</th><th class="r">Book value</th>';
    var foot=this._repTotRow('<td colspan="2"></td>'+t.map(function(v){ return '<td class="r m">'+this.money(v)+'</td>'; },this).join(''));
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,5,'No intangible assets.')+this.repFoot(); },

  _renderAmortSchedule(b,key,inst){ var self=this; var R=b.records||{}; var ias=R.intangibles||[]; var from=inst.from,to=inst.to;
    var periodAm=function(name){ var s=0; (R.amortization||[]).forEach(function(d){ if(!self._inRange(d.date,from,to)) return;
      (d.lines||[]).forEach(function(ln){ if(ln.asset===name) s+=Number((ln.amount!=null&&ln.amount!=='')?ln.amount:ln.amortExpense)||0; }); }); return s; };
    var priorAm=function(name){ var s=0; if(!from) return 0; (R.amortization||[]).forEach(function(d){ var dt=String(d.date||'').slice(0,10);
      if(dt && dt>=from) return;
      (d.lines||[]).forEach(function(ln){ if(ln.asset===name) s+=Number((ln.amount!=null&&ln.amount!=='')?ln.amount:ln.amortExpense)||0; }); }); return s; };
    var t=[0,0,0,0,0];
    var body=ias.map(function(a){ var cost=iaCost(b,a);
      var opening=(Number(a.accumAmort)||0)+priorAm(a.name); var per=periodAm(a.name); var closing=opening+per; var bv=cost-closing;
      var vals=[cost,opening,per,closing,bv]; vals.forEach(function(v,i){ t[i]+=v; });
      return '<tr><td>'+self.esc(a.name||'')+'</td><td style="white-space:nowrap">'+(a.acqDate?self._repDate(a.acqDate):'')+'</td>'+
        vals.map(function(v,i){ return '<td class="r m"'+(i===4?' style="font-weight:600"':'')+'>'+self._repM(v)+'</td>'; }).join('')+'</tr>'; }).join('');
    var head='<th>Asset</th><th>Acquired</th><th class="r">Cost</th><th class="r">Accumulated at start</th><th class="r">Amortization for period</th><th class="r">Accumulated at end</th><th class="r">Book value</th>';
    var foot=this._repTotRow('<td colspan="2"></td>'+t.map(function(v){ return '<td class="r m">'+this.money(v)+'</td>'; },this).join(''));
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,7,'No intangible assets.')+this.repFoot(); },

  /* ---- expense claims / billable time / investments / capital / divisions ---- */
  _renderExpenseClaims(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var byPayer={}, byAccount={};
    (R.expenseClaims||[]).forEach(function(c){ if(!self._inRange(c.date,from,to)) return;
      var tot=claimTotal(c); var p=c.payer||'(unnamed)'; byPayer[p]=(byPayer[p]||0)+tot;
      var lns=(c.lines&&c.lines.length)?c.lines:[{account:c.account,amount:c.amount}];
      lns.forEach(function(ln){ var a=Number(ln.amount!=null&&ln.amount!==''?ln.amount:ln.amountNoTax)||0; if(!a) return;
        var nm=acctName(b,ln.account)||'(no account)'; byAccount[nm]=(byAccount[nm]||0)+a; }); });
    var pk=Object.keys(byPayer).sort(), ak=Object.keys(byAccount).sort();
    var tot=pk.reduce(function(a,k){ return a+byPayer[k]; },0);
    var body='<tr><td colspan="2" style="font-weight:800;padding-top:6px">By payer</td></tr>'+
      (pk.map(function(k){ return '<tr><td style="padding-left:18px">'+self.esc(k)+'</td><td class="r m">'+self._repM(byPayer[k])+'</td></tr>'; }).join('')
        ||'<tr><td style="padding-left:18px;color:#999" colspan="2">None</td></tr>')+
      '<tr><td colspan="2" style="font-weight:800;padding-top:12px">By account</td></tr>'+
      (ak.map(function(k){ return '<tr><td style="padding-left:18px">'+self.esc(k)+'</td><td class="r m">'+self._repM(byAccount[k])+'</td></tr>'; }).join('')
        ||'<tr><td style="padding-left:18px;color:#999" colspan="2">None</td></tr>');
    var foot=this._repTotRow('<td>Total claimed</td><td class="r m">'+this.money(tot)+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl('<th>Payer / account</th><th class="r">Amount</th>',
      (pk.length||ak.length)?body:'',foot,2,'No expense claims in this period.')+this.repFoot(); },

  _renderBillableSummary(b,key,inst){ var self=this; var R=b.records||{};
    var byCust={};
    (R.billableTime||[]).forEach(function(t){ var nm=t.customer||'(none)'; var st=t.status||'Uninvoiced';
      var a=byCust[nm]=byCust[nm]||{hrs:0,Uninvoiced:0,Invoiced:0,'Written off':0};
      a.hrs+=Number(t.hours)||0; a[st]=(a[st]||0)+billableAmount(t); });
    var ks=Object.keys(byCust).sort(); var t=[0,0,0,0];
    var body=ks.map(function(nm){ var a=byCust[nm]; var vals=[a.hrs,a.Uninvoiced,a.Invoiced,a['Written off']];
      vals.forEach(function(v,i){ t[i]+=v; });
      return '<tr><td>'+self.esc(nm)+'</td><td class="r m">'+self._repQ(a.hrs)+'</td><td class="r m" style="font-weight:600">'+
        self._repM(a.Uninvoiced)+'</td><td class="r m">'+self._repM(a.Invoiced)+'</td><td class="r m">'+self._repM(a['Written off'])+'</td></tr>'; }).join('');
    var head='<th>Customer</th><th class="r">Hours</th><th class="r">Uninvoiced</th><th class="r">Invoiced</th><th class="r">Written off</th>';
    var foot=this._repTotRow('<td></td><td class="r m">'+this._repQ(t[0])+'</td><td class="r m">'+this.money(t[1])+
      '</td><td class="r m">'+this.money(t[2])+'</td><td class="r m">'+this.money(t[3])+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,5,'No billable time recorded.')+
      '<div class="info-bar">Uninvoiced time is what is carried on the balance sheet as <b>Billable time</b>.</div>'+this.repFoot(); },

  _renderBillableMovement(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var rows=(R.billableTime||[]).filter(function(t){ return self._inRange(t.date,from,to); })
      .sort(function(x,y){ return String(x.date||'').localeCompare(String(y.date||'')); });
    var t=[0,0];
    var body=rows.map(function(r){ var amt=billableAmount(r); t[0]+=Number(r.hours)||0; t[1]+=amt;
      var st=r.status||'Uninvoiced';
      return '<tr><td style="white-space:nowrap">'+self._repDate(r.date)+'</td><td>'+self.esc(r.employee||'')+'</td><td>'+
        self.esc(r.customer||'')+'</td><td>'+self.esc(r.description||'')+'</td><td class="r m">'+self._repQ(r.hours)+
        '</td><td class="r m">'+self._repM(r.rate)+'</td><td class="r m" style="font-weight:600">'+self._repM(amt)+
        '</td><td>'+self.esc(st)+'</td></tr>'; }).join('');
    var head='<th>Date</th><th>Employee</th><th>Customer</th><th>Description</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th><th>Status</th>';
    var foot=this._repTotRow('<td colspan="4"></td><td class="r m">'+this._repQ(t[0])+'</td><td></td><td class="r m">'+this.money(t[1])+'</td><td></td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,8,'No billable time in this period.')+this.repFoot(); },

  _renderInvestments(b,key,inst){ var self=this; var ivs=(b.records&&b.records.investments)||[];
    var t=[0,0,0];
    var body=ivs.map(function(r){ var c=investCost(b,r), mv=investMarketValue(r), g=investGain(b,r);
      t[0]+=c; t[1]+=mv; t[2]+=g;
      return '<tr><td>'+self.esc(r.name||'')+'</td><td>'+self.esc(r.symbol||'')+'</td><td class="r m">'+self._repQ(r.qty)+
        '</td><td class="r m">'+self._repM(r.marketPrice)+'</td><td class="r m">'+self._repM(c)+'</td><td class="r m">'+
        self._repM(mv)+'</td><td class="r m" style="font-weight:600">'+self._repM(g)+'</td></tr>'; }).join('');
    var head='<th>Investment</th><th>Code</th><th class="r">Qty</th><th class="r">Market price</th><th class="r">Cost</th><th class="r">Market value</th><th class="r">Unrealised gain (loss)</th>';
    var foot=this._repTotRow('<td colspan="4"></td><td class="r m">'+this.money(t[0])+'</td><td class="r m">'+this.money(t[1])+
      '</td><td class="r m">'+this.money(t[2])+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,7,'No investments.')+this.repFoot(); },

  _renderCapitalTx(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var accts=(R.capital||[]).map(function(c){ return c.name; }).filter(Boolean);
    var body=accts.map(function(nm){
      var tx=[]; var opening=Number(((R.capital||[]).find(function(c){ return c.name===nm; })||{}).balance)||0;
      (R.receipts||[]).forEach(function(r){ (r.lines||[]).forEach(function(ln){ if(ln.sub!==nm||!acctNameMatches(b,ln.account,CAP_RE)) return;
        tx.push({date:r.date,ref:r.reference,type:'Receipt',amt:Number(ln.amount)||0}); }); });
      (R.payments||[]).forEach(function(p){ (p.lines||[]).forEach(function(ln){ if(ln.sub!==nm||!acctNameMatches(b,ln.account,CAP_RE)) return;
        tx.push({date:p.date,ref:p.reference,type:'Payment',amt:-(Number(ln.amount)||0)}); }); });
      (R.journal||[]).forEach(function(j){ (j.lines||[]).forEach(function(ln){ if(ln.sub!==nm||!acctNameMatches(b,ln.account,CAP_RE)) return;
        tx.push({date:j.date,ref:j.reference,type:'Journal entry',amt:(Number(ln.credit)||0)-(Number(ln.debit)||0)}); }); });
      tx.sort(function(x,y){ return String(x.date||'').localeCompare(String(y.date||'')); });
      var run=opening; var before=0;
      tx.forEach(function(x){ var d=String(x.date||'').slice(0,10); if(from && d && d<from) before+=x.amt; });
      run=opening+before;
      var h='<tr><td colspan="5" style="font-weight:700;padding-top:10px">'+self.esc(nm)+'</td></tr>';
      h+='<tr><td style="padding-left:18px;color:#666">Opening balance</td><td></td><td></td><td></td><td class="r m">'+self.money(run)+'</td></tr>';
      h+=tx.filter(function(x){ return self._inRange(x.date,from,to); }).map(function(x){ run+=x.amt;
        return '<tr><td style="padding-left:18px;white-space:nowrap">'+self._repDate(x.date)+'</td><td>'+self.esc(x.ref||'')+
          '</td><td>'+self.esc(x.type)+'</td><td class="r m">'+self._repM(x.amt)+'</td><td class="r m">'+self.money(run)+'</td></tr>'; }).join('');
      h+='<tr><td style="padding-left:18px;font-weight:600">Closing balance</td><td></td><td></td><td></td><td class="r m" style="font-weight:700">'+self.money(run)+'</td></tr>';
      return h; }).join('');
    var head='<th>Date</th><th>Reference</th><th>Type</th><th class="r">Movement</th><th class="r">Balance</th>';
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,'',5,'No capital accounts.')+this.repFoot(); },

  _renderDivisionSummary(b,key,inst){ var self=this; var R=b.records||{}; var from=inst.from,to=inst.to;
    var divs=(b.divisions||[]).map(function(d){ return (d&&d.name)?d.name:d; }).filter(Boolean);
    var agg={}; var touch=function(d){ return agg[d]=agg[d]||{income:0,expense:0,n:0}; };
    divs.forEach(touch); touch('(none)');
    var scan=function(src,field,sign,bucket){ (R[src]||[]).forEach(function(rec){ var dt=rec.issueDate||rec.date;
      if(!self._inRange(dt,from,to)) return; var d=rec.division||'(none)'; var a=touch(d);
      a[bucket]+=sign*(Number(rec[field])||0); a.n++; }); };
    scan('salesInv','total',1,'income'); scan('creditNotes','total',-1,'income');
    scan('purchInv','total',1,'expense'); scan('debitNotes','total',-1,'expense');
    scan('expenseClaims','amount',1,'expense'); scan('payslips','netPay',1,'expense');
    var ks=Object.keys(agg).filter(function(k){ var a=agg[k]; return a.n||k!=='(none)'; }).sort();
    var t=[0,0,0,0];
    var body=ks.map(function(k){ var a=agg[k]; var net=a.income-a.expense;
      t[0]+=a.n; t[1]+=a.income; t[2]+=a.expense; t[3]+=net;
      return '<tr><td>'+self.esc(k)+'</td><td class="r m">'+a.n+'</td><td class="r m">'+self._repM(a.income)+
        '</td><td class="r m">'+self._repM(a.expense)+'</td><td class="r m" style="font-weight:600">'+self._repM(net)+'</td></tr>'; }).join('');
    var head='<th>Division</th><th class="r">Documents</th><th class="r">Income</th><th class="r">Expenditure</th><th class="r">Net</th>';
    var foot=this._repTotRow('<td></td><td class="r m">'+t[0]+'</td><td class="r m">'+this.money(t[1])+'</td><td class="r m">'+
      this.money(t[2])+'</td><td class="r m">'+this.money(t[3])+'</td>');
    return this.repHead(b,(this._REPDEF[key]||{}).name)+this._repTbl(head,body,foot,5,'No divisions defined — add them in Settings → Divisions.')+
      '<div class="info-bar">Documents carry a division on the entry form. Anything untagged is grouped under <b>(none)</b>.</div>'+this.repFoot(); },

  repHead(b,title){ var ctx=this._repCtx;
    if(ctx){ var inst=ctx.inst||{}; var key=ctx.key; var reg=this._REPDEF[key]||{}; var ttl=inst.title||title;
      var period=(inst.from||inst.to)?('For the period from '+this._repDate(inst.from)+' to '+this._repDate(inst.to)):('As at '+this._repDate(inst.to||new Date().toISOString().slice(0,10)));
      var methodLine=reg.method?'<div class="rep-method">'+this.esc(inst.method||'Accrual basis')+'</div>':'';
      var bar='<div class="view-bar"><span class="view-doc">'+this.esc(ttl)+'</span><span class="vb-spacer"></span>'+
        '<button class="btn btn-sm" onclick="App.reportEdit(\''+key+'\',\''+inst.id+'\')">Edit</button>'+
        '<button class="btn btn-sm" onclick="App.reportClone(\''+key+'\',\''+inst.id+'\')">Clone</button>'+
        '<button class="btn btn-sm" onclick="App.reportPrint()">Print</button>'+
        '<button class="btn btn-sm" onclick="App.reportPrint()">PDF</button>'+
        '<button class="btn btn-sm" onclick="App.reportEmail()">Email</button></div>';
      return this._repCrumb(key,'View')+bar+
        '<div class="rep-doc" id="repDoc"><div class="rep-head">'+
        '<div class="rep-org">'+this.esc(b.name)+'</div>'+
        '<div class="rep-ttl">'+this.esc(ttl)+'</div>'+
        '<div class="rep-sub">'+this.esc(period)+'</div>'+methodLine+'</div>'; }
    return this.crumb('Reports',title)+
    '<div class="card" style="max-width:820px"><div style="text-align:center;margin-bottom:14px"><div style="font-weight:700;font-size:16px">'+this.esc(b.name)+'</div>'+
    '<div style="font-size:15px;margin-top:2px">'+this.esc(title)+'</div><div style="color:#999;font-size:12px">As at '+this.esc(this.fmtNow?this.fmtNow():new Date().toLocaleDateString())+'</div></div>'; },
  repFoot(){ if(this._repCtx){ var f=(this._repCtx.inst&&this._repCtx.inst.footer)?'<div style="margin-top:14px;white-space:pre-wrap;color:#444;font-size:12.5px">'+this.esc(this._repCtx.inst.footer)+'</div>':''; return f+'</div>'; } return '<div class="form-actions"><button class="btn" onclick="App.reportsBack()">Back to Reports</button></div></div>'; },
  /* Trial balance straight from the general ledger: Dr = Cr by construction. */
  trialBalance(b,to){ const rank={assets:0,liabilities:1,equity:2,income:3,expense:4};
    const tb=GL.trial(b,{to:to||null}); const rows=tb.rows.map(r=>{ const n=acctById(b,r.id); return {r:rank[r.root]||0,name:n?acctPath(b,n):r.name,code:r.code,debit:r.debit,credit:r.credit}; });
    rows.sort((x,y)=>x.r-y.r || x.name.localeCompare(y.name));
    return {rows,dr:tb.debit,cr:tb.credit}; },
  trialBalanceHtml(b){ const tb=this.trialBalance(b);
    const body=tb.rows.map(r=>'<tr><td>'+this.esc(r.name)+(r.code?' <span style="color:#bbb">('+this.esc(r.code)+')</span>':'')+'</td>'+
      '<td class="r m">'+(r.debit?this.money(r.debit):'')+'</td><td class="r m">'+(r.credit?this.money(r.credit):'')+'</td></tr>').join('')||
      '<tr><td colspan="3"><div class="reg-empty">No account balances yet.</div></td></tr>';
    const bal=Math.abs(tb.dr-tb.cr)<0.005;
    return this.repHead(b,'Trial Balance')+
      '<table class="reg-tbl"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total</td><td class="r m">'+this.money(tb.dr)+'</td><td class="r m">'+this.money(tb.cr)+'</td></tr></tfoot></table>'+
      (bal?'<div class="info-bar" style="color:#2e7d32;border-color:#bfe3c2;background:#f1f9f1">In balance — total debits equal total credits.</div>'
          :'<div class="info-bar" style="color:var(--warn);border-color:var(--warn-line);background:var(--warn-tint)">Out of balance by '+this.money(Math.abs(tb.dr-tb.cr))+'. This usually means an opening balance was entered without an offsetting capital/equity entry.</div>')+
      this.repFoot(); },
  partyReportHtml(b,key,title,fn){ const list=((b.records&&b.records[key])||[]).map(p=>({name:p.name,bal:fn(b,p.name)})).filter(x=>Math.abs(x.bal)>0.005);
    list.sort((a,b)=>b.bal-a.bal); const tot=list.reduce((a,x)=>a+x.bal,0);
    const body=list.map(x=>'<tr><td>'+this.esc(x.name)+'</td><td class="r m">'+this.money(x.bal)+'</td></tr>').join('')||
      '<tr><td colspan="2"><div class="reg-empty">No '+this.esc(key)+' with a balance yet. Raise an invoice to populate this.</div></td></tr>';
    return this.repHead(b,title)+
      '<table class="reg-tbl"><thead><tr><th>'+(key==='customers'?'Customer':'Supplier')+'</th><th class="r">Balance</th></tr></thead><tbody>'+body+
      '</tbody><tfoot><tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total</td><td class="r m">'+this.money(tot)+'</td></tr></tfoot></table>'+this.repFoot(); },
  taxSummaryHtml(b){ const R=b.records||{}; let out=0,inp=0;
    (R.salesInv||[]).forEach(i=>out+=Number(i.tax)||0); (R.creditNotes||[]).forEach(c=>{ /* credit notes reduce output */ });
    (R.purchInv||[]).forEach(i=>inp+=Number(i.tax)||0); const net=out-inp;
    return this.repHead(b,'Tax Summary')+
      '<table class="reg-tbl"><tbody>'+
      '<tr><td>Output VAT (on sales)</td><td class="r m">'+this.money(out)+'</td></tr>'+
      '<tr><td>Input VAT (on purchases)</td><td class="r m">'+this.money(inp)+'</td></tr>'+
      '<tr style="font-weight:700;border-top:2px solid var(--line)"><td>'+(net>=0?'Net VAT payable':'Net VAT refundable')+'</td><td class="r m">'+this.money(Math.abs(net))+'</td></tr>'+
      '</tbody></table><div class="info-bar">VAT is taken from the tax on sales and purchase invoices. Add tax codes in Settings → Tax Codes and apply them on invoice lines.</div>'+this.repFoot(); },

  openTool(which){ this.wsMode='tools'; this.toolView=which; this.navTrail=[]; this.editingId=null; this.renderMain(this.curBiz()); },
  toolsHtml(b){ if(this.toolView==='backup') return this.backupHtml(b); if(this.toolView==='histDetail') return this.histDetailHtml(b); if(this.toolView==='history') return this.historyHtml(b); if(this.toolView==='emailSettings') return this.emailSettingsHtml(b); if(this.toolView==='emails') return this.emailsHtml(b); return this.backupHtml(b); },
  _toolBack(){ return '<div style="margin-bottom:10px"><button class="btn btn-xs" onclick="App.backToSummary()">◀ Back</button></div>'; },
  backupHtml(b){ return this.crumb('Backup')+this._toolBack()+
    '<div class="card" style="max-width:640px;padding:0;overflow:hidden">'+
    '<div class="reg-panel-head"><span class="reg-panel-title">Backup</span></div>'+
    '<div style="padding:14px 16px">'+
    '<label style="display:flex;align-items:center;gap:9px;padding:7px 2px;cursor:pointer"><input type="checkbox" id="bk_ts" checked> <span>Timestamp <span style="color:#aaa;font-size:12px">— add the date &amp; time to the file name</span></span></label>'+
    '<label style="display:flex;align-items:center;gap:9px;padding:7px 2px;cursor:pointer"><input type="checkbox" id="bk_att"> <span>Attachments <span style="color:#aaa;font-size:12px">— include file attachments (if any)</span></span></label>'+
    '<div style="margin-top:14px"><button class="btn btn-primary" onclick="App.backupExport()">Backup</button></div>'+
    '<div class="info-bar" style="margin-top:12px">Downloads a complete JSON copy — chart of accounts, every transaction, settings and your designed forms. Your data lives only in this browser, so keep regular backups.</div>'+
    '</div></div>'; },
  backupExport(){ const b=this.curBiz(); if(!b){ alert('Open a business first.'); return; } var ts=true; var el=document.getElementById('bk_ts'); if(el) ts=el.checked; var nm=(b.name||'business').replace(/[^a-z0-9]+/gi,'_'); var stamp=ts?('-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')):''; this._download(nm+'-backup'+stamp+'.json', JSON.stringify(b,null,2)); },
  backupExportAll(){ const all=DB.get(DB.k.biz,[]); this._download('all-businesses-backup-'+new Date().toISOString().slice(0,10)+'.json', JSON.stringify(all,null,2)); },
  _download(name, text){ try{ const blob=new Blob([text],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },120); }catch(e){ alert('Download failed: '+e.message); } },
  backupImport(){ const self=this; const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json'; inp.onchange=function(){ const f=inp.files&&inp.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=function(){ try{ self._restoreBackup(JSON.parse(rd.result)); }catch(e){ alert('Could not read that backup file: '+e.message); } }; rd.readAsText(f); }; inp.click(); },
  _restoreBackup(obj){ const all=DB.get(DB.k.biz,[]); const list=Array.isArray(obj)?obj:[obj]; let n=0;
    list.forEach(function(bz){ if(!bz||!bz.id||!bz.name) return; const i=all.findIndex(x=>x.id===bz.id); if(i>=0) all[i]=bz; else all.push(bz); n++; });
    if(!n){ alert('No valid business was found in that file.'); return; }
    DB.set(DB.k.biz, all); alert(n+(n>1?' businesses':' business')+' restored.'); this.renderWorkspace(); },
  _fmtTs(iso){ if(!iso) return ''; var d=new Date(iso); if(isNaN(d.getTime())) return String(iso); var p=function(n){ return String(n).padStart(2,'0'); }; return p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); },
  _recLabel(key, rec){ if(!rec) return KEY2LABEL[key]||key||''; var c=REG[key]||{}; var singular=c.singular||c.label||KEY2LABEL[key]||key;
    var ref=rec.reference||rec.number||rec.code||''; var name=rec.name||rec.payee||rec.paidBy||rec.customer||rec.supplier||rec.employee||''; var date=rec.issueDate||rec.date||'';
    var bits=[singular]; if(ref) bits.push(String(ref)); else if(name) bits.push(String(name)); if(date) bits.push(this.fmtDateUS(date)); return bits.join(' — '); },
  _userName(){ var c=this.current; if(c&&(c.name||c.user)) return c.name||c.user; try{ var a=DB.get(DB.k.accounts,[]); if(a&&a[0]&&(a[0].name||a[0].user)) return a[0].name||a[0].user; }catch(e){} try{ var el=document.getElementById('userName'); if(el&&el.textContent.trim()) return el.textContent.trim(); }catch(e){} return 'Administrator'; },
  _logActivity(b, action, key, rec, before, extra){ if(!b) return; b.activity=b.activity||[];
    var user=this._userName();
    var ent={ id:'h'+Date.now().toString(36)+Math.floor(Math.random()*1e4), ts:new Date().toISOString(), user:user, action:action, key:key,
      recId:(rec&&rec.id)||(before&&before.id)||null, recUuid:(rec&&rec.uuid)||(before&&before.uuid)||null,
      label:(extra&&extra.label)||this._recLabel(key, rec||before),
      before:before?JSON.parse(JSON.stringify(before)):null, after:rec?JSON.parse(JSON.stringify(rec)):null };
    if(extra&&extra.bulkIds) ent.bulkIds=extra.bulkIds;
    b.activity.unshift(ent); if(b.activity.length>1000) b.activity.length=1000; return ent; },
  _syntheticHistory(b){ var R=b.records||{}; var self=this; var KEYS=['salesInv','purchInv','receipts','payments','journal','creditNotes','debitNotes','iat','depreciation','payslips','deliveryNotes','customers','suppliers','inventory','fixedAssets','capital','employees']; var out=[];
    KEYS.forEach(function(k){ (R[k]||[]).forEach(function(r){ var d=r.issueDate||r.date||''; out.push({ synthetic:true, action:'create', key:k, recId:r.id, recUuid:r.uuid, label:self._recLabel(k,r), ts:(d?(String(d).slice(0,10)+'T00:00:00'):''), user:self._userName() }); }); });
    out.sort(function(a,b){ return String(b.ts).localeCompare(String(a.ts)); }); return out.slice(0,150); },
  historyHtml(b){ var self=this; var real=(b.activity||[]).slice();
    var seen={}; real.forEach(function(e){ if(e.recId!=null) seen[e.key+':'+e.recId]=1; });
    var synth=this._syntheticHistory(b).filter(function(e){ return !seen[e.key+':'+e.recId]; });
    var all=real.concat(synth).sort(function(a,b){ return String(b.ts).localeCompare(String(a.ts)); });
    var fAct=this.histAction||'', fType=this.histType||'';
    var rows=all.filter(function(e){ return (!fAct||e.action===fAct) && (!fType||e.key===fType); });
    var keys={}; all.forEach(function(e){ if(e.key) keys[e.key]=1; });
    var typeOpts='<option value="">All types</option>'+Object.keys(keys).map(function(k){ return '<option value="'+k+'"'+(fType===k?' selected':'')+'>'+self.esc(KEY2LABEL[k]||k)+'</option>'; }).join('');
    var actOpts='<option value="">All actions</option>'+['create','update','delete'].map(function(a){ return '<option value="'+a+'"'+(fAct===a?' selected':'')+'>'+a.charAt(0).toUpperCase()+a.slice(1)+'</option>'; }).join('');
    function badge(a){ return '<span class="hist-act '+a+'">'+a.charAt(0).toUpperCase()+a.slice(1)+'</span>'; }
    var body=rows.slice(0,400).map(function(e){
      var undo = e.synthetic ? '<span style="color:#c8c8c8;font-size:11px">—</span>'
        : (e.undone ? '<span style="color:#aaa;font-size:11px">undone</span>'
          : '<button class="btn btn-xs" onclick="App.historyUndo(\''+e.id+'\')">Undo</button>');
      var desc = self.esc(e.label);
      if(e.action==='update'&&e.before&&e.after){ var ch=self._histChanges(e.key,e.before,e.after); if(ch.length) desc+='<div class="hist-chg">'+ch.slice(0,3).map(function(c){ return '<b>'+self.esc(c.label)+'</b>: <span class="hist-old">'+self.esc(self._histVal(c.old))+'</span><span class="hist-arrow">→</span><span class="hist-new">'+self.esc(self._histVal(c.new))+'</span>'; }).join(' · ')+(ch.length>3?' · +'+(ch.length-3)+' more':'')+'</div>'; }
      return '<tr'+(e.undone?' style="opacity:.5"':'')+'>'+
        '<td class="act"><button class="btn btn-xs" onclick="App.historyView(\''+(e.id||(e.key+':'+e.recId))+'\')">View</button></td>'+
        '<td style="white-space:nowrap">'+self.esc(self._fmtTs(e.ts))+'</td>'+
        '<td>'+self.esc(e.user||'')+'</td>'+
        '<td>'+desc+'</td>'+
        '<td>'+badge(e.action)+'</td>'+
        '<td class="r">'+undo+'</td></tr>'; }).join('')
      || '<tr><td colspan="6"><div class="reg-empty">No activity yet. Create, edit or delete a transaction and it will be recorded here.</div></td></tr>';
    return this.crumb('History')+this._toolBack()+
      '<div class="card" style="max-width:none;padding:0;overflow:hidden">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">History</span><span style="flex:1"></span>'+
        '<select class="hist-sel" onchange="App.histType=this.value;App.renderMain(App.curBiz())">'+typeOpts+'</select>'+
        '<select class="hist-sel" onchange="App.histAction=this.value;App.renderMain(App.curBiz())">'+actOpts+'</select></div>'+
      '<table class="reg-tbl"><thead><tr><th class="act"></th><th>Timestamp</th><th>User</th><th>Description</th><th>Action</th><th class="r"></th></tr></thead><tbody>'+body+'</tbody></table>'+
      '<div class="reg-foot"><span class="cnt">'+rows.length+'</span></div></div>'; },
  historyView(ref){ var b=this.curBiz(); var log=(b.activity||[]); var e=log.find(function(x){ return x.id===ref; });
    if(!e && typeof ref==='string' && ref.indexOf(':')>0){ var key=ref.slice(0,ref.indexOf(':')); var recId=ref.slice(ref.indexOf(':')+1); var rec=(((b.records&&b.records[key])||[]).find(function(r){ return String(r.id)===String(recId); })); if(!rec){ alert('That record is no longer available.'); return; } e={ synthetic:true, action:'create', key:key, recId:rec.id, recUuid:rec.uuid, label:this._recLabel(key,rec), after:JSON.parse(JSON.stringify(rec)), before:null, ts:'' }; }
    if(!e){ alert('That history item is unavailable.'); return; }
    this.histEntry=e; this.toolView='histDetail'; this.wsMode='tools'; this.navTrail=[]; this.editingId=null; this.renderMain(b); },
  historyBack(){ if(this.histReturn){ this.histReturn=false; this.histEntry=null; this.openTool('history'); return true; } return false; },
  historyUndoFromView(){ var e=this.histEntry; if(!e||e.synthetic||e.undone||!e.id) return; this.historyUndo(e.id); this.histReturn=false; this.histEntry=null; this.openTool('history'); },
  _humanKey(k){ return String(k).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_]+/g,' ').replace(/^./,function(c){ return c.toUpperCase(); }); },
  /* History: what a stored key is called on the form ("Customer", not "Cust Name") */
  _HIST_LABELS:{ custName:'Customer', supName:'Supplier', empName:'Employee', custTRN:'Customer TRN', supTRN:'Supplier TRN', custAddress:'Billing address', supAddress:'Supplier address',
    custEmail:'Email', supEmail:'Email', empEmail:'Email', custMobile:'Phone', supMobile:'Phone', custCode:'Code', supCode:'Code', empCode:'Code', empAddress:'Address', custBalance:'Starting balance', supBalance:'Starting balance', empBalance:'Starting balance',
    narration:'Narration', amounts_in_word:'Amount in words', bank_accounts_detail:'Bank details', bankDetails:'Bank details', issueDate:'Date', date:'Date', dueDate:'Due date', dueDateManual:'Due date', dueDays:'Due in days', dueType:'Due date type',
    receivedIn:'Received in', paidFrom:'Paid from', paidBy:'Paid by', paidByType:'Paid by (type)', payee:'Payee', payeeType:'Payee (type)', bankName:'Name', bankCode:'Code', bankIBAN:'IBAN', ibanNo:'IBAN', iban:'IBAN', hasIban:'International Bank Account Number (IBAN)', bankAcctNo:'Account number',
    itemName:'Name', itemCode:'Code', itemUnit:'Unit name', itemSellPrice:'Sales price', itemPurchPrice:'Purchase price', itemQty:'Starting quantity', itemOpeningCost:'Starting cost', faName:'Name', faCode:'Code', faCost:'Acquisition cost', faDate:'Acquisition date', faDepRate:'Depreciation rate', faAccDep:'Accumulated depreciation',
    capName:'Name', capCode:'Code', capDesc:'Description', capBalance:'Starting balance', balanceDue:'Balance due', subtotal:'Subtotal', tax:'Tax', total:'Total', amount:'Amount', reference:'Reference', description:'Description', withholdingAmt:'Withholding amount', roundingAmt:'Rounding amount', amountPaid:'Amount paid',
    colLineNum:'Column — Line number', colItem:'Column — Item', showDescCol:'Column — Description', colQty:'Column — Qty', colDiscount:'Column — Discount', discType:'Discount type', colDivision:'Column — Division', rounding:'Rounding', roundMode:'Rounding mode', withholding:'Withholding tax', whtType:'Withholding tax type', whtRate:'Withholding tax rate', whtAmount:'Withholding amount', showTaxCol:'Show tax amount column', fixedTotal:'Fixed total', fixedTotalValue:'Fixed total amount', customTitleOn:'Custom title', customTitle:'Custom title text', hideDueDate:'Hide — Due date', hideBalanceDue:'Hide — Balance due', amountInWords:'Amount in words', taxInclusive:'Amounts are tax inclusive', taxExclusive:'Amounts are tax exclusive', creditLimitOn:'Credit limit', creditLimit:'Credit limit amount', pending:'Can have pending transactions' },
  /* keys that mirror each other on one record: only the first one with a value is shown */
  _HIST_MIRRORS:[['customer','custName'],['supplier','supName'],['employee','empName'],['date','issueDate'],['description','narration'],['name','bankName','itemName','faName','capName'],['code','bankCode','itemCode','faCode','capCode','custCode','supCode','empCode'],['iban','bankIBAN','ibanNo'],['amount','total'],['email','custEmail','supEmail','empEmail'],['address','custAddress','supAddress','empAddress'],['phone','custMobile','supMobile'],['trn','custTRN','supTRN'],['qty','itemQty'],['salesPrice','itemSellPrice'],['purchasePrice','itemPurchPrice'],['unit','itemUnit'],['openingCost','itemOpeningCost'],['bankAcctNo','accountNo','acctNo'],['paidBy','customer'],['payee','supplier'],['bankDetails','bank_accounts_detail'],['withholdingAmt','whtAmount']],
  _histLabel(key,k){ var f=((REG[key]&&REG[key].form)||[]).find(function(x){ return x.key===k; }); if(f&&f.label) return f.label; return this._HIST_LABELS[k]||this._humanKey(k); },
  _histVal(v){ if(v==null||v==='') return '(empty)'; if(v===true||v==='true') return 'Yes'; if(v===false||v==='false') return 'No'; var sv=String(v); if(/^\d{4}-\d{2}-\d{2}$/.test(sv)){ try{ return this.fmtDate?this.fmtDate(sv):sv; }catch(e){ return sv; } } return sv; },
  /* the fields an update changed: [{label, old, new}] */
  _histChanges(key,before,after){ var self=this; before=before||{}; after=after||{}; var skip={lines:1,uuid:1,id:1,_dr:1,_cr:1,_subsNormalized:1,accountName:1,accounts:1,subAccount:1,amounts_in_word:1,allocations:1,printOff:1};
    var hide={}; this._HIST_MIRRORS.forEach(function(g){ var first=g.find(function(k){ return (after[k]!=null&&after[k]!=='')||(before[k]!=null&&before[k]!==''); }); g.forEach(function(k){ if(k!==first) hide[k]=1; }); });
    var out=[], seen={}; Object.keys(Object.assign({},before,after)).forEach(function(k){ if(skip[k]||hide[k]||seen[k]) return; seen[k]=1; var o=before[k], n=after[k]; if((o!=null&&typeof o==='object')||(n!=null&&typeof n==='object')) return;
      var os=(o==null?'':String(o)), ns=(n==null?'':String(n)); if(os===ns) return; out.push({k:k,label:self._histLabel(key,k),old:o,new:n}); });
    return out; },
  histCrumb(){ return '<div class="ws-crumb"><div class="left">'+App._crumbIco()+' ▸ <a class="led-link" onclick="App.openTool(\'history\')">History</a> ▸ History</div></div>'; },
  histDetailHtml(b){ var self=this; var e=this.histEntry; if(!e) return this.historyHtml(b); var c=REG[e.key]||{};
    var liveRec=(((b.records&&b.records[e.key])||[]).find(function(r){ return String(r.id)===String(e.recId)||(e.recUuid&&r.uuid===e.recUuid); }));
    var after=e.after||(e.synthetic?liveRec:null)||{}; var before=e.before||{};
    var isUpd=(e.action==='update' && e.before); var isDel=(e.action==='delete'); var base=isDel?before:after;
    var title=(c.singular||c.label||KEY2LABEL[e.key]||e.key);
    var isBoolKey=function(k){ return /Enabled$|^has|^Has|On$|Checked$|check/i.test(k); };
    var fmtVal=function(k,v){ if(v===true||v==='true') return 'is checked'; if(v===false) return 'is not checked'; if((v==='1'||v===1)&&isBoolKey(k)) return 'is checked'; if((v===''||v==='0'||v===0)&&isBoolKey(k)) return 'is not checked'; return self.esc(self._histVal(v)); };
    var skip={lines:1,uuid:1,id:1,_dr:1,_cr:1,_subsNormalized:1,accountName:1,accounts:1,subAccount:1,amounts_in_word:1,printOff:1,allocations:1};
    { var _src=Object.assign({},before,after); this._HIST_MIRRORS.forEach(function(g){ var first=g.find(function(k){ return _src[k]!=null&&_src[k]!==''; }); g.forEach(function(k){ if(k!==first) skip[k]=1; }); }); }
    var ks=[]; var seen={}; Object.keys(base||{}).forEach(function(k){ if(skip[k]||typeof base[k]==='object'||seen[k]) return; seen[k]=1; ks.push(k); });
    if(isUpd){ Object.keys(before||{}).forEach(function(k){ if(skip[k]||typeof before[k]==='object'||seen[k]) return; seen[k]=1; ks.push(k); }); }
    var rowLV=function(label,val,bold){ return '<tr><td style="font-weight:700;color:#222;white-space:nowrap;padding:3px 30px 3px 0;vertical-align:top">'+self.esc(label)+'</td><td style="padding:3px 0;color:#222'+(bold?';font-weight:700':'')+'">'+val+'</td></tr>'; };
    var shown={};
    var rowsH=ks.map(function(k){ var ov=before[k], nv=after[k]; var os=(ov==null?'':String(ov)), ns=(nv==null?'':String(nv));
      var lbl=self._histLabel(e.key,k);
      if(isUpd && os!==ns){ return rowLV(lbl,'<span class="hist-old">'+(os!==''?fmtVal(k,ov):'(empty)')+'</span><span class="hist-arrow">→</span><span class="hist-new">'+(ns!==''?fmtVal(k,nv):'(empty)')+'</span>',false); }
      var vs=isDel?os:ns; if(vs==='') return ''; var fv=fmtVal(k, isDel?ov:nv); if(shown[lbl+'\u0001'+fv]) return ''; shown[lbl+'\u0001'+fv]=1; return rowLV(lbl, fv, false);
    }).filter(Boolean).join('');
    var linesArr=isDel?(before.lines||[]):(after.lines||[]); var linesH='';
    if(Array.isArray(linesArr)&&linesArr.length){ var lh=rowLV('Lines','',false);
      linesArr.forEach(function(ln,i){ lh+='<tr><td style="font-weight:700;color:#222;padding:4px 0 1px 14px">'+(i+1)+'</td><td></td></tr>';
        var _ld={}; [['item','Item'],['items','Item'],['description','Line description'],['desc','Line description'],['accountName','Account'],['accounts','Account'],['sub','Sub-account'],['qty','Qty'],['price','Unit price'],['net','Amount'],['amount','Total'],['debit','Debit'],['credit','Credit'],['taxCode','Tax code'],['taxRate','Tax %']].forEach(function(p){ var val=ln[p[0]]; if(val==null||val==='') return; if(_ld[p[1]]) return; _ld[p[1]]=1; lh+='<tr><td style="font-weight:600;color:#444;white-space:nowrap;padding:2px 30px 2px 30px;vertical-align:top">'+self.esc(p[1])+'</td><td style="padding:2px 0;color:#222">'+self.esc(String(val))+'</td></tr>'; }); });
      linesH=lh; }
    var actions='<div style="margin-top:14px;display:flex;gap:10px;align-items:center">'+
      (liveRec?'<button class="btn btn-primary" onclick="App.historyEditRecord()">Edit</button>':'')+
      '<button class="btn" onclick="App.openTool(\'history\')">Close</button>'+
      (liveRec?'<button class="btn btn-danger" style="margin-left:auto" onclick="App.historyDeleteRecord()">Delete</button>':'')+
      '</div>';
    return this.histCrumb()+
      '<div class="hist-pagehead">History</div>'+
      '<div class="card" style="max-width:600px">'+
        '<div style="font-weight:700;font-size:12.5px;color:#555;margin-bottom:2px">'+self.esc(b.name||'')+'</div>'+
        '<div style="font-weight:800;font-size:20px;margin-bottom:12px">'+self.esc(title)+'</div>'+
        '<table style="font-size:13px;border-collapse:collapse;width:100%">'+(rowsH||'')+linesH+'</table>'+
      '</div>'+
      actions; },
  _histLines(bl, al, showOld, isDel){ var self=this; bl=Array.isArray(bl)?bl:[]; al=Array.isArray(al)?al:[]; if(!bl.length && !al.length) return '';
    var cols=[['accountName','Account'],['account','Account'],['sub','Sub-account'],['item','Item'],['description','Description'],['desc','Description'],['qty','Qty'],['price','Unit price'],['net','Net'],['amount','Amount'],['debit','Debit'],['credit','Credit']];
    var pick=function(lines){ var seen={}; var cs=[]; cols.forEach(function(p){ if(seen[p[1]]) return; if(lines.some(function(l){ return l&&l[p[0]]!=null&&l[p[0]]!==''; })){ cs.push(p); seen[p[1]]=1; } }); return cs; };
    var tbl=function(lines,struck,label){ if(!lines.length) return ''; var cs=pick(lines); var head=cs.map(function(c){ return '<th>'+self.esc(c[1])+'</th>'; }).join(''); var body=lines.map(function(ln){ return '<tr>'+cs.map(function(c){ var v=self.esc(ln[c[0]]==null?'':String(ln[c[0]])); return '<td'+(struck?' style="text-decoration:line-through;color:#c0392b;opacity:.85"':'')+'>'+v+'</td>'; }).join('')+'</tr>'; }).join(''); return '<div style="font-weight:700;margin:14px 0 5px;color:#555">'+label+'</div><table class="reg-tbl"><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table>'; };
    var changed=JSON.stringify(bl)!==JSON.stringify(al);
    if(showOld && changed && bl.length){ return tbl(bl,true,'Lines (before)')+tbl(isDel?[]:al,false,'Lines (after)'); }
    return tbl(isDel?bl:(al.length?al:bl), isDel, 'Lines'); },
  historyUndoView(){ var e=this.histEntry; if(!e||e.undone||e.synthetic) return; this.historyUndo(e.id); if(this.histEntry&&this.histEntry.undone){ this.openTool('history'); } },
  historyOpenRecord(){ var b=this.curBiz(); var e=this.histEntry; if(!e) return; var label=KEY2LABEL[e.key]; var rec=label?(((b.records&&b.records[e.key])||[]).find(function(r){ return String(r.id)===String(e.recId)||(e.recUuid&&r.uuid===e.recUuid); })):null; if(rec&&label){ this.toolView=null; this.navTrail=[]; this.recReturn=null; this.wsSection=label; this.listQuery=''; this.editingId=rec.id; this.wsMode='view'; this.renderMain(b); } else alert('Record not found.'); },
  historyEditRecord(){ var b=this.curBiz(); var e=this.histEntry; if(!e) return; var label=KEY2LABEL[e.key]; var rec=label?(((b.records&&b.records[e.key])||[]).find(function(r){ return String(r.id)===String(e.recId)||(e.recUuid&&r.uuid===e.recUuid); })):null; if(rec&&label){ this.toolView=null; this.navTrail=[]; this.recReturn=null; this.wsSection=label; this.listQuery=''; this.editingId=rec.id; this.wsMode='form'; this.renderMain(b); } else alert('Record not found.'); },
  historyDeleteRecord(){ var b=this.curBiz(); var e=this.histEntry; if(!e) return; var label=KEY2LABEL[e.key]; var rec=label?(((b.records&&b.records[e.key])||[]).find(function(r){ return String(r.id)===String(e.recId)||(e.recUuid&&r.uuid===e.recUuid); })):null; if(!rec||!label){ alert('Record not found.'); return; } this.toolView=null; this.navTrail=[]; this.recReturn=null; this.wsSection=label; this.deleteRecord(rec.id); },
  historyUndo(id){ var b=this.curBiz(); var log=(b.activity||[]); var e=log.find(function(x){ return x.id===id; }); if(!e||e.undone) return;
    if(!this._ask('Undo this change?\n\n'+e.label+'\n\nThis cannot be redone.',()=>this.historyUndo(id))) return;
    b.records=b.records||{}; var arr=(b.records[e.key]||[]).slice();
    if(e.bulkIds&&e.bulkIds.length){ var ids={}; e.bulkIds.forEach(function(x){ ids[x]=1; }); arr=arr.filter(function(r){ return !ids[r.id]; }); }
    else if(e.bulkDeleted&&e.bulkDeleted.length){ e.bulkDeleted.forEach(function(r){ arr.push(JSON.parse(JSON.stringify(r))); }); }
    else if(e.action==='create'){ arr=arr.filter(function(r){ return r.id!==e.recId && (!e.recUuid||r.uuid!==e.recUuid); }); }
    else if(e.action==='update'){ var i=arr.findIndex(function(r){ return r.id===e.recId||(e.recUuid&&r.uuid===e.recUuid); }); if(e.before){ if(i>=0) arr[i]=JSON.parse(JSON.stringify(e.before)); else arr.push(JSON.parse(JSON.stringify(e.before))); } }
    else if(e.action==='delete'){ if(e.before) arr.push(JSON.parse(JSON.stringify(e.before))); }
    b.records[e.key]=arr; e.undone=true; e.undoneTs=new Date().toISOString();
    try{ refreshSummary(b); }catch(_){} this.saveBiz(b); this.renderMain(b); },
  _snapshotModal(e){ var self=this; var snap=e.after||e.before||{}; var skip={lines:1,uuid:1,id:1};
    var rowsF=Object.keys(snap).filter(function(k){ return !skip[k] && typeof snap[k]!=='object' && String(snap[k]!=null?snap[k]:'')!==''; })
      .map(function(k){ return '<tr><td style="color:#777;padding:3px 14px 3px 0;white-space:nowrap;vertical-align:top">'+self.esc(k)+'</td><td style="padding:3px 0">'+self.esc(String(snap[k]))+'</td></tr>'; }).join('');
    var linesT='';
    if(Array.isArray(snap.lines)&&snap.lines.length){ var pref=['account','accountName','accounts','description','desc','qty','price','amount','debit','credit','sub']; var cols=pref.filter(function(k){ return snap.lines.some(function(l){ return l[k]!=null&&l[k]!==''; }); });
      linesT='<div style="font-weight:600;margin:12px 0 4px">Line items</div><table class="reg-tbl"><thead><tr>'+cols.map(function(c){ return '<th>'+self.esc(c)+'</th>'; }).join('')+'</tr></thead><tbody>'+snap.lines.map(function(ln){ return '<tr>'+cols.map(function(c){ return '<td>'+self.esc(String(ln[c]==null?'':ln[c]))+'</td>'; }).join('')+'</tr>'; }).join('')+'</tbody></table>'; }
    this._openOverlay('<div class="app-modal-h">'+self.esc(e.label||'Transaction')+' <span style="font-weight:400;color:#999;font-size:12px">— '+self.esc(e.action)+(e.undone?', undone':'')+'</span></div>'+
      '<div class="app-modal-b"><table style="font-size:13px;border-collapse:collapse;width:100%">'+(rowsF||'<tr><td style="color:#999">No fields recorded.</td></tr>')+'</table>'+linesT+'</div>'+
      '<div class="app-modal-f"><span style="flex:1"></span><button class="btn btn-primary" onclick="App._closeOverlay()">Close</button></div>'); },
  emailsHtml(b){ var self=this; var log=(b.records&&b.records.emails)||b.emailLog||[];
    var body=log.slice(0,400).map(function(m,i){ var st=(m.status||'Sent'); return '<tr>'+
      '<td class="act"><button class="btn btn-xs" onclick="App.emailView('+i+')">View</button></td>'+
      '<td style="white-space:nowrap">'+self.esc(self._fmtTs(m.ts))+'</td>'+
      '<td>'+self.esc(m.recipient||m.to||'')+'</td>'+
      '<td>'+self.esc(m.subject||'')+'</td>'+
      '<td><span class="hist-act create">'+self.esc(st)+'</span></td></tr>'; }).join('')
      || '<tr><td colspan="5"><div class="reg-empty">No emails sent yet. Emailed statements, invoices and receipts are logged here.</div></td></tr>';
    return this.crumb('Emails')+this._toolBack()+
      '<div class="card" style="max-width:none;padding:0;overflow:hidden">'+
      '<div class="reg-panel-head"><span class="reg-panel-title">Emails</span><span style="flex:1"></span>'+
        '<button class="btn btn-xs" onclick="App.openTool(\'emailSettings\')">⚙ Email settings</button></div>'+
      '<table class="reg-tbl"><thead><tr><th class="act"></th><th>Timestamp</th><th>Recipient</th><th>Subject</th><th>Status</th></tr></thead><tbody>'+body+'</tbody></table>'+
      '<div class="reg-foot"><span class="cnt">'+log.length+'</span><button class="ftbtn" onclick="App.copyEmailLog()">Copy to clipboard</button></div></div>'; },
  emailView(i){ var b=this.curBiz(); var log=(b.records&&b.records.emails)||b.emailLog||[]; var m=log[i]; if(!m) return;
    this._openOverlay('<div class="app-modal-h">'+this.esc(m.subject||'Email')+'</div>'+
      '<div class="app-modal-b"><div style="font-size:13px"><div><b>To:</b> '+this.esc(m.recipient||m.to||'')+'</div><div><b>Sent:</b> '+this.esc(this._fmtTs(m.ts))+'</div><div><b>Status:</b> '+this.esc(m.status||'Sent')+'</div></div>'+
      '<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;white-space:pre-wrap;font-size:13px;color:#333">'+this.esc(m.body||'')+'</div></div>'+
      '<div class="app-modal-f"><span style="flex:1"></span><button class="btn btn-primary" onclick="App._closeOverlay()">Close</button></div>'); },
  copyEmailLog(){ var b=this.curBiz(); var log=(b.records&&b.records.emails)||b.emailLog||[]; var self=this;
    var tsv=['Timestamp\tRecipient\tSubject\tStatus'].concat(log.map(function(m){ return [self._fmtTs(m.ts),(m.recipient||m.to||''),(m.subject||''),(m.status||'Sent')].join('\t'); })).join('\n');
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(function(){ alert('Copied '+log.length+' rows.'); },function(){ alert(tsv); }); else alert(tsv); },
  emailSettingsHtml(b){ const e=(b.details&&b.details.email)||{};
    const fld=(id,label,val)=>'<label style="display:block;font-size:12px;color:#666;margin:10px 0 4px">'+this.esc(label)+'</label><input id="'+id+'" value="'+this.esc(val||'')+'" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box">';
    return this.crumb('Emails','Settings')+'<div style="margin-bottom:10px"><button class="btn btn-xs" onclick="App.openTool(\'emails\')">◀ Back to emails</button></div>'+
      '<div class="card" style="max-width:620px"><div style="font-weight:700;font-size:15px;margin-bottom:4px">Email settings</div>'+
      '<div style="color:#777;font-size:13px;margin-bottom:6px">Default sender details used when emailing invoices, statements and receipts.</div>'+
      fld('em_from','From name', e.fromName||b.name)+
      fld('em_addr','From email address', e.fromAddr)+
      fld('em_reply','Reply-to address', e.replyTo)+
      '<label style="display:block;font-size:12px;color:#666;margin:10px 0 4px">Default message</label><textarea id="em_body" style="width:100%;min-height:90px;padding:8px;border:1px solid var(--line);border-radius:8px;box-sizing:border-box">'+this.esc(e.body||'Please find attached your document. Thank you for your business.')+'</textarea>'+
      '<div class="form-actions" style="margin-top:14px"><button class="btn" onclick="App.openTool(\'emails\')">Cancel</button><button class="btn btn-primary" onclick="App.saveEmails()">Save settings</button></div></div>'; },
  saveEmails(){ const b=this.curBiz(); if(!b) return; function g(id){ var el=document.getElementById(id); return el?el.value.trim():''; }
    b.details=Object.assign({},b.details,{email:{fromName:g('em_from'),fromAddr:g('em_addr'),replyTo:g('em_reply'),body:g('em_body')}}); this.saveBiz(b); alert('Email settings saved.'); this.openTool('emails'); },
  settingsBack(){ this.setView=null; this.spRoute=null; this.fmtCat=null; this.fmtForm=null; this.fmtDraft=null; this.fmtSel=null; this.ctrlEditId=null; this.renderMain(this.curBiz()); },
  openSetting(key){ this.setView=key; this.spRoute=null; this.fmtCat=null; this.fmtForm=null; this.fmtDraft=null; this.fmtSel=null; this.ctrlEditId=null; this._emTplType=null; this.curyCat=null; this.emailCat=null; this.renderMain(this.curBiz()); },
  _setTabs(items,active,fn){ var self=this; return '<div class="set-tabs">'+items.map(function(it){ return '<button class="set-tab'+(it[0]===active?' on':'')+'" onclick="App.'+fn+'(\''+it[0]+'\')">'+self.esc(it[1])+'</button>'; }).join('')+'</div>'; },
  /* Settings pages: [icon, name, key, description, block, ready].
     Block 1 and block 2 are the two groups of the Settings index, split by a
     divider (Manager.io order). Every key has an App.set_<key> handler — most
     are drawn by js/settings-pages.js, the rest live in this file. */
  setTiles(){ return [
    ['building','Business Details','business','Name, address, logo & tax number',1,1],
    ['landmark','Capital subaccounts','capitalSub','Drawings, contributions and other capital subaccounts',1,1],
    ['book','Chart of Accounts','coa','Account groups and accounts',1,1],
    ['reconcile','Control Accounts','control','Built-in & custom control accounts',1,1],
    ['arrowUpRight','Custom Buttons','extensions','Buttons that open pages you host',1,1],
    ['puzzle','Custom Fields','customFields','Text, date, number and other custom fields',1,1],
    ['card','Custom Themes','themes','Form, voucher & statement layouts',1,1],
    ['clock','Date & Number Format','format','How dates and amounts are displayed',1,1],
    ['quote','Email Settings','email','SMTP server & email templates',1,1],
    ['invoice','Footers','footers','Text printed at the foot of documents',1,1],
    ['box','Inventory Locations','locations','Hold stock in more than one place',1,1],
    ['alert','Obsolete Features','obsolete','Older behaviour, off unless you need it',1,1],
    ['wallet','Payslip Items','payslipItems','Earnings, deductions & contributions',1,1],
    ['percent','Tax Codes','tax','VAT / sales-tax codes for invoices',1,1],
    ['user','User Permissions','permissions','Who can open this business, and what they see',1,1],
    ['key','Access Tokens','accessTokens','Tokens for programs that read this business',2,1],
    ['download','Attachments','attachments','Files kept with this business',2,1],
    ['bank','Bank Rules','bankRules','Auto-code imported statement lines',2,1],
    ['receipt','Billable Expenses','billableExpenses','Recharge expenses to customers',2,1],
    ['trendUp','Cash Flow Statement Groups','cashFlowGroups','Operating, investing & financing groups',2,1],
    ['coins','Currencies','currencies','Base currency, foreign currencies & exchange rates',2,1],
    ['chart','Custom Reports','customReports','Build a statement from your own account groupings',2,1],
    ['users','Customer Portals','customerPortals','What each customer can see online',2,1],
    ['shuffle','Divisions','divisions','Track results by division / department',2,1],
    ['wallet2','Expense Claim Payers','claimPayers','Who pays expenses out of pocket',2,1],
    ['chart','Forecasts','forecasts','Expected income & expenses by account',2,1],
    ['order','Form Defaults','formDefaults','What a new document is pre-filled with',2,1],
    ['bag','Inventory Kits','kits','Sell a bundle, draw down its components',2,1],
    ['tag','Inventory Unit Costs','unitCosts','Fixed unit costs for inventory items',2,1],
    ['trendUp','Investment Market Prices','marketPrices','Market prices for investments',2,1],
    ['keyboard','Keyboard Navigation','keyboardNav','Enter and arrow keys on entry forms',2,1],
    ['clock','Late Payment Fees','lateFees','Charges added once an invoice is overdue',2,1],
    ['lock','Lock Date','lock','Prevent edits on or before a date',2,1],
    ['tag','Non-inventory Items','nonInvItems','Services and items not kept in stock',2,1],
    ['briefcase','Projects','projects','Group transactions by job or engagement',2,1],
    ['transfer','Recurring Transactions','recurring','Schedules that copy a document forward',2,1],
    ['scale','Starting Balances','starting','Where the books stood on day one',2,1],
    ['cloud','Web Services','webServices','Automatic exchange rates',2,1],
    ['percent','Withholding tax','withholdingTax','Withholding tax receivable & payable',2,1]
  ]; },
  /* The index: two columns of icon links in two blocks. Pages the signed-in
     user may not open are left out when the permissions layer provides
     App.canSetting. */
  settingsHtml(b){
    if(this.setView){ const fn='set_'+this.setView; if(typeof this[fn]==='function') return this[fn](b);
      return this.setMissing((this.setTiles().find(t=>t[2]===this.setView)||[])[1]||'Setting'); }
    const can=t=>typeof this.canSetting!=='function'||this.canSetting(b,t[2]);
    const ico=t=>(typeof window!=='undefined'&&window.ICO)?ICO.forSetting(t[2],22):'';
    const link=t=>'<button class="sp-link" title="'+this.esc(t[3])+'" onclick="App.openSetting(\''+t[2]+'\')"><span class="sp-link-ico">'+ico(t)+'</span><span class="sp-link-nm">'+this.esc(t[1])+'</span></button>';
    const tiles=this.setTiles().filter(can);
    const g1=tiles.filter(t=>t[4]===1).map(link).join(''), g2=tiles.filter(t=>t[4]===2).map(link).join('');
    return this.crumb('Settings')+'<div class="sp-index">'+
      (g1?'<div class="sp-grid">'+g1+'</div>':'')+(g1&&g2?'<div class="sp-divider"></div>':'')+(g2?'<div class="sp-grid">'+g2+'</div>':'')+'</div>';
  },
  setCard(sub,inner,saveFn){ return this.crumb('Settings',sub)+
    '<div class="card"><h2>'+this.esc(sub)+'</h2>'+inner+
    '<div class="form-actions">'+(saveFn?'<button class="btn btn-primary" onclick="'+saveFn+'">Update</button>':'')+
    '<button class="btn" onclick="App.settingsBack()">'+(saveFn?'Cancel':'Back to Settings')+'</button></div></div>'; },
  /* Safety net only: every tile in setTiles() has a matching set_* handler.
     This renders if a tile is ever added without one, instead of a blank page. */
  setMissing(sub){ return this.crumb('Settings',sub)+
    '<div class="card"><h2>'+this.esc(sub)+'</h2>'+
    '<div class="info-bar">This setting has no editor registered. Add a <code>set_'+this.esc(this.setView||'')+'()</code> method to <code>App</code> in <code>js/app.js</code>.</div>'+
    '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },

  set_business(b){ const d=b.details||{};
    const curOpt=['AED','USD','EUR','GBP','SAR','PKR','INR','AUD','CAD','SGD','NZD'].map(o=>'<option'+((b.baseCurrency||'AED')===o?' selected':'')+'>'+o+'</option>').join('');
    const preview=d.logo?'<img src="'+d.logo+'" style="max-height:80px;max-width:200px;border:1px solid var(--line-soft);border-radius:4px;padding:6px;margin:4px 0 8px;display:block">':'';
    const inner='<label class="fld">Business name</label><input id="bd_name" type="text" value="'+this.esc(b.name||'')+'">'+
      '<label class="fld">Full / legal name</label><input id="bd_legal" type="text" value="'+this.esc(d.legalName||'')+'">'+
      '<label class="fld">Address</label><textarea id="bd_addr">'+this.esc(d.address||'')+'</textarea>'+
      '<label class="fld">Email</label><input id="bd_email" type="text" value="'+this.esc(d.email||'')+'">'+
      '<label class="fld">Phone</label><input id="bd_phone" type="text" value="'+this.esc(d.phone||'')+'">'+
      '<label class="fld">Tax number / TRN</label><input id="bd_trn" type="text" value="'+this.esc(d.taxNumber||'')+'">'+
      '<label class="fld">Country</label><select id="bd_country">'+['United Arab Emirates','United States','United Kingdom','Australia','Canada','India','Pakistan','Saudi Arabia','Singapore','New Zealand','Automatic'].map(o=>'<option'+((b.country||'')===o?' selected':'')+'>'+o+'</option>').join('')+'</select>'+
      '<label class="fld">Base currency</label><select id="bd_currency">'+curOpt+'</select>'+
      '<label class="fld">Logo</label>'+preview+'<input id="lg_file" type="file" accept="image/*" onchange="App.logoFile(event)"><input id="lg_url" type="text" value="'+this.esc(d.logo||'')+'" placeholder="https://…  or upload above" style="margin-top:6px">';
    return this.setCard('Business Details',inner,'App.saveBusinessDetails()'); },
  saveBusinessDetails(){ const b=this.curBiz(); if(!b) return;
    b.name=document.getElementById('bd_name').value.trim()||b.name; b.country=document.getElementById('bd_country').value;
    b.baseCurrency=document.getElementById('bd_currency').value;
    b.details=Object.assign({},b.details,{legalName:document.getElementById('bd_legal').value.trim(),address:document.getElementById('bd_addr').value,
      email:document.getElementById('bd_email').value.trim(),phone:document.getElementById('bd_phone').value.trim(),taxNumber:document.getElementById('bd_trn').value.trim(),
      logo:document.getElementById('lg_url').value.trim()});
    this.saveBiz(b); this.settingsBack(); },

  set_logo(b){ const d=b.details||{};
    const preview=d.logo?'<img src="'+d.logo+'" style="max-height:90px;max-width:220px;border:1px solid var(--line-soft);border-radius:4px;padding:6px;margin-bottom:10px">':'<div class="info-bar">No logo set yet.</div>';
    const inner=preview+'<label class="fld">Upload logo</label><input id="lg_file" type="file" accept="image/*" onchange="App.logoFile(event)">'+
      '<label class="fld">or Logo URL</label><input id="lg_url" type="text" value="'+this.esc(d.logo||'')+'" placeholder="https://…">'+
      '<div style="color:#999;font-size:12px;margin-top:8px">This logo is used as the default on new voucher templates in the Editor.</div>';
    return this.setCard('Business Logo',inner,'App.saveLogo()'); },
  logoFile(e){ const f=e.target.files&&e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ const u=document.getElementById('lg_url'); if(u) u.value=r.result; }; r.readAsDataURL(f); },
  saveLogo(){ const b=this.curBiz(); if(!b) return; b.details=Object.assign({},b.details,{logo:document.getElementById('lg_url').value.trim()}); this.saveBiz(b); this.settingsBack(); },

  set_currency(b){
    const inner='<label class="fld">Base currency</label><select id="cur_sel">'+['AED','USD','EUR','GBP','SAR','PKR','INR','AUD','CAD','SGD','NZD'].map(o=>'<option'+((b.baseCurrency||'AED')===o?' selected':'')+'>'+o+'</option>').join('')+'</select>'+
      '<div style="color:#999;font-size:12px;margin-top:8px">The base currency is the currency your accounts and reports are presented in.</div>';
    return this.setCard('Base Currency',inner,'App.saveCurrency()'); },
  saveCurrency(){ const b=this.curBiz(); if(!b) return; b.baseCurrency=document.getElementById('cur_sel').value; this.saveBiz(b); this.settingsBack(); },

  set_format(b){ const f=b.fmt||{date:'DD/MM/YYYY',sep:'comma-dot',decimals:2};
    const dOpt=[['MM/DD/YYYY','05/31/2025'],['DD/MM/YYYY','31/05/2025'],['YYYY-MM-DD','2025-05-31'],['D MMM YYYY','31 May 2025']].map(o=>'<option value="'+o[0]+'"'+(f.date===o[0]?' selected':'')+'>'+o[0]+'  ('+o[1]+')</option>').join('');
    const sOpt=[['comma-dot','1,234,567.89'],['dot-comma','1.234.567,89'],['space-comma','1\u00A0234\u00A0567,89'],['none-dot','1234567.89']].map(o=>'<option value="'+o[0]+'"'+(f.sep===o[0]?' selected':'')+'>'+o[1]+'</option>').join('');
    const decOpt=[0,2,3].map(o=>'<option value="'+o+'"'+((+f.decimals)===o?' selected':'')+'>'+o+'</option>').join('');
    const inner='<label class="fld">Date format</label><select id="fmt_date">'+dOpt+'</select>'+
      '<label class="fld">Number format</label><select id="fmt_sep">'+sOpt+'</select>'+
      '<label class="fld">Decimal places</label><select id="fmt_dec">'+decOpt+'</select>'+
      '<div class="info-bar" style="margin:14px 0 0">This changes how every date and amount is shown across the whole business — registers, the Summary, and printed vouchers.</div>';
    return this.setCard('Date & Number Format',inner,'App.saveFormat()'); },
  saveFormat(){ const b=this.curBiz(); if(!b) return; b.fmt={date:document.getElementById('fmt_date').value,sep:document.getElementById('fmt_sep').value,decimals:+document.getElementById('fmt_dec').value}; this.saveBiz(b); this.settingsBack(); },

  set_currencies(b){ var self=this; var cat=this.curyCat||'base'; var base=b.baseCurrency||'AED';
    var allCur=['AED','USD','EUR','GBP','SAR','PKR','INR','AUD','CAD','SGD','NZD','JPY','CNY','CHF','ZAR','QAR','KWD','BHD','OMR','TRY'];
    var tabs=this._setTabs([['base','Base Currency'],['foreign','Foreign Currencies'],['rates','Exchange Rates']], cat, 'curyCatSet');
    var inner='';
    if(cat==='base'){
      var baseOpt=allCur.map(function(o){ return '<option'+(base===o?' selected':'')+'>'+o+'</option>'; }).join('');
      inner='<div class="info-bar">The <b>base currency</b> is the currency your accounts and reports are presented in.</div>'+
        '<label class="fld">Base currency</label><select id="cury_base" onchange="App.saveBaseCurrency(this.value)" style="max-width:180px">'+baseOpt+'</select>';
    } else if(cat==='foreign'){
      var list=b.currencies||[];
      var rows=list.map(function(c,i){ return '<div class="tax-row"><input class="rt" type="text" style="width:96px;text-transform:uppercase" value="'+self.esc(c.code||'')+'" placeholder="USD" onchange="App.curySet('+i+',\'code\',this.value)">'+
        '<input class="nm" type="text" value="'+self.esc(c.name||'')+'" placeholder="US Dollar" onchange="App.curySet('+i+',\'name\',this.value)">'+
        '<button class="dz-x" onclick="App.curyRemove('+i+')">✕</button></div>'; }).join('');
      inner='<div class="info-bar">Add the foreign currencies you transact in. Enter their rates under <b>Exchange Rates</b>.</div>'+
        '<div style="display:flex;gap:8px;font-size:11px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:6px"><span style="width:104px">Code</span><span style="flex:1">Name</span><span style="width:20px"></span></div>'+
        (rows||'<div style="color:#aaa;margin-bottom:8px">No foreign currencies yet — your books run in '+self.esc(base)+'.</div>')+
        '<button class="btn btn-sm" onclick="App.curyAdd()">+ Add currency</button>';
    } else {
      var cl=b.currencies||[]; var rl=b.exchangeRates||[];
      var codeList=cl.map(function(c){ return c.code; }).filter(Boolean);
      if(!codeList.length){ inner='<div class="info-bar">Add a foreign currency first (under <b>Foreign Currencies</b>), then record its exchange rates here.</div>'; }
      else {
        var optsFor=function(sel){ return codeList.map(function(cd){ return '<option'+(sel===cd?' selected':'')+'>'+self.esc(cd)+'</option>'; }).join(''); };
        var rrows=rl.map(function(r,i){ return '<div class="tax-row"><select style="width:96px" onchange="App.rateSet('+i+',\'code\',this.value)">'+optsFor(r.code)+'</select>'+
          '<input type="date" style="width:150px" value="'+self.esc(r.date||'')+'" onchange="App.rateSet('+i+',\'date\',this.value)">'+
          '<input class="rt" type="number" step="0.000001" style="flex:1" value="'+(r.rate==null?'':r.rate)+'" placeholder="units per 1 '+self.esc(base)+'" onchange="App.rateSet('+i+',\'rate\',this.value)">'+
          '<button class="dz-x" onclick="App.rateRemove('+i+')">✕</button></div>'; }).join('');
        inner='<div class="info-bar">Record dated exchange rates — the number of units of the foreign currency equal to one '+self.esc(base)+'. The latest rate on or before a transaction\u2019s date is used.</div>'+
          '<div style="display:flex;gap:8px;font-size:11px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:6px"><span style="width:104px">Currency</span><span style="width:158px">Date</span><span style="flex:1">Units per 1 '+self.esc(base)+'</span><span style="width:20px"></span></div>'+
          (rrows||'<div style="color:#aaa;margin-bottom:8px">No exchange rates yet.</div>')+
          '<button class="btn btn-sm" onclick="App.rateAdd()">+ Add exchange rate</button>';
      }
    }
    return this.crumb('Settings','Currencies')+'<div class="card" style="max-width:680px"><h2>Currencies</h2>'+tabs+inner+'<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  curyCatSet(c){ this.curyCat=c; this.renderMain(this.curBiz()); },
  saveBaseCurrency(v){ var b=this.curBiz(); if(!b) return; b.baseCurrency=v||b.baseCurrency; this.saveBiz(b); this.renderMain(b); },
  curyAdd(){ var b=this.curBiz(); b.currencies=b.currencies||[]; b.currencies.push({code:'',name:''}); this.saveBiz(b); this.renderMain(b); },
  curyRemove(i){ var b=this.curBiz(); (b.currencies||[]).splice(i,1); this.saveBiz(b); this.renderMain(b); },
  curySet(i,f,v){ var b=this.curBiz(); if(b.currencies&&b.currencies[i]){ b.currencies[i][f]= f==='code'?String(v||'').toUpperCase().trim():v; this.saveBiz(b); } },
  rateAdd(){ var b=this.curBiz(); b.exchangeRates=b.exchangeRates||[]; var first=((b.currencies||[])[0]||{}).code||''; b.exchangeRates.push({id:'x'+Date.now()+Math.floor(Math.random()*1000),code:first,date:new Date().toISOString().slice(0,10),rate:''}); this.saveBiz(b); this.renderMain(b); },
  rateRemove(i){ var b=this.curBiz(); (b.exchangeRates||[]).splice(i,1); this.saveBiz(b); this.renderMain(b); },
  rateSet(i,f,v){ var b=this.curBiz(); if(b.exchangeRates&&b.exchangeRates[i]){ b.exchangeRates[i][f]= f==='rate'?(this.parseNum(v)||0):(f==='code'?String(v||'').toUpperCase().trim():v); this.saveBiz(b); } },

  set_lock(b){ const inner='<label class="fld">Lock date</label><input id="lk_date" type="date" value="'+this.esc(b.lockDate||'')+'">'+
    '<div style="color:#999;font-size:12px;margin-top:8px">Transactions dated on or before this date can\u2019t be created or edited. Leave blank to remove the lock.</div>';
    return this.setCard('Lock Date',inner,'App.saveLock()'); },
  saveLock(){ const b=this.curBiz(); if(!b) return; b.lockDate=document.getElementById('lk_date').value||''; this.saveBiz(b); this.settingsBack(); },

  set_email(b){ var cat=this.emailCat||'smtp';
    var tabs=this._setTabs([['smtp','SMTP Settings'],['templates','Email Templates']], cat, 'emailCatSet');
    var inner, save; if(cat==='templates'){ inner=this._emailTplInner(b); save='App.saveEmailTemplate()'; } else { inner=this._smtpInner(b); save='App.saveSmtp()'; }
    return this.crumb('Settings','Email Settings')+'<div class="card"><h2>Email Settings</h2>'+tabs+inner+'<div class="form-actions"><button class="btn btn-primary" onclick="'+save+'">Update</button><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  emailCatSet(c){ this.emailCat=c; this.renderMain(this.curBiz()); },
  _smtpInner(b){ var e=(b.details&&b.details.email)||{}; var enc=e.encryption||'TLS'; var mode=e.mode||'mailto';
    var modeOpts=this.EMAIL_MODES.map(function(m){ return '<option value="'+m[0]+'"'+(mode===m[0]?' selected':'')+'>'+m[1]+'</option>'; }).join('');
    var smtpNote = mode==='relay'
      ? '<div class="info-bar">These credentials are forwarded to your relay with each message. The relay does the SMTP delivery.</div>'
      : '<div class="em-warn">Not used in mail-client mode — your mail client sends with its own account. They are kept for when you switch to a relay.</div>';
    var inner='<div class="info-bar">A web page cannot open an SMTP connection itself, so choose how messages leave this app. '+
        'The wording comes from <b>Email Templates</b>; every send is recorded under <b>Emails</b>.</div>'+
      '<label class="fld">Delivery method</label><select id="em_mode" onchange="App.saveSmtp(1)">'+modeOpts+'</select>'+
      (mode==='relay'
        ? '<label class="fld">Relay endpoint URL</label><input id="em_relay" type="text" value="'+this.esc(e.relayUrl||'')+'" placeholder="https://mail.yourcompany.com/send">'+
          '<div class="sub" style="margin:4px 0 0">A small service you run that accepts <code>POST</code> JSON <code>{to, subject, body, from, smtp:{…}}</code> and sends it. It must allow this origin via CORS.</div>'
        : '<div class="sub" style="margin:4px 0 0">Opens your desktop mail client with the message pre-filled. Attachments must be added by you — a web page cannot attach files to a <code>mailto:</code> link.</div>')+
      '<label class="fld">From name</label><input id="em_from" type="text" value="'+this.esc(e.fromName||b.name||'')+'">'+
      '<label class="fld">From email address</label><input id="em_addr" type="text" value="'+this.esc(e.fromAddr||'')+'" placeholder="accounts@yourcompany.com">'+
      '<label class="fld">Reply-to address</label><input id="em_reply" type="text" value="'+this.esc(e.replyTo||'')+'">'+
      '<div class="set-secn-label" style="margin-top:18px">SMTP server</div>'+smtpNote+
      '<label class="fld">SMTP host</label><input id="em_host" type="text" value="'+this.esc(e.smtpHost||'')+'" placeholder="smtp.example.com">'+
      '<label class="fld">SMTP port</label><input id="em_port" type="text" value="'+this.esc(e.smtpPort||'')+'" placeholder="587">'+
      '<label class="fld">SMTP username</label><input id="em_user" type="text" value="'+this.esc(e.smtpUser||'')+'">'+
      '<label class="fld">SMTP password</label><input id="em_pass" type="password" value="'+this.esc(e.smtpPass||'')+'">'+
      '<label class="fld">Encryption</label><select id="em_enc">'+['None','SSL','TLS'].map(function(o){ return '<option'+(enc===o?' selected':'')+'>'+o+'</option>'; }).join('')+'</select>'+
      '<div class="em-warn" style="margin-top:12px">The password is stored in this browser’s localStorage in plain text, readable by any script on this origin. Use an app-specific password, not your main mailbox password.</div>';
    return inner; },
  /* quiet=1 when re-rendering after a mode switch, so it doesn't toast on every change */
  saveSmtp(quiet){ var b=this.curBiz(); if(!b) return; var g=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
    var sel=function(id,d){ var el=document.getElementById(id); return (el&&el.value)||d; };
    var em=Object.assign({},(b.details&&b.details.email)||{},{
      mode:sel('em_mode','mailto'), relayUrl:g('em_relay')||((b.details&&b.details.email&&b.details.email.relayUrl)||''),
      fromName:g('em_from'),fromAddr:g('em_addr'),replyTo:g('em_reply'),
      smtpHost:g('em_host'),smtpPort:g('em_port'),smtpUser:g('em_user'),smtpPass:g('em_pass'),
      encryption:sel('em_enc','TLS')});
    b.details=Object.assign({},b.details,{email:em}); this.saveBiz(b);
    if(!quiet){ try{ this.toast&&this.toast('Email settings saved'); }catch(e){} }
    this.renderMain(b); },
  _emTplTypes(){ return [['default','Default (all documents)'],['salesInv','Sales Invoice'],['purchInv','Purchase Invoice'],['salesQuotes','Sales Quote'],['receipts','Receipt'],['payments','Payment'],['custStmt','Customer Statement'],['supStmt','Supplier Statement']]; },
  _emTplDefault(type){ var subs={'default':'{business} — your document','salesInv':'Invoice {ref} from {business}','purchInv':'Purchase invoice {ref}','salesQuotes':'Quote {ref} from {business}','receipts':'Receipt {ref} from {business}','payments':'Payment advice {ref}','custStmt':'Statement of account — {business}','supStmt':'Supplier statement — {business}'};
    return {subject:(subs[type]||subs['default']), body:'Dear {party},\n\nPlease find attached {document} {ref}.\n\nThank you for your business.\n\n{business}'}; },
  _emailTplInner(b){ var self=this; var type=this._emTplType||'default'; var tpls=b.emailTemplates||{}; var d=this._emTplDefault(type); var cur=tpls[type]||{}; var subject=(cur.subject!=null?cur.subject:d.subject); var body=(cur.body!=null?cur.body:d.body);
    var typeOpts=this._emTplTypes().map(function(t){ return '<option value="'+t[0]+'"'+(type===t[0]?' selected':'')+'>'+self.esc(t[1])+(tpls[t[0]]?'  •':'')+'</option>'; }).join('');
    var inner='<div class="info-bar">A separate subject &amp; message per document type. Use placeholders like <b>{business}</b>, <b>{party}</b>, <b>{ref}</b>, <b>{document}</b> and <b>{amount}</b> — they\u2019re filled in when the email is prepared. <b>•</b> marks templates you\u2019ve edited.</div>'+
      '<label class="fld">Document type</label><select id="et_type" onchange="App.emTplPick(this.value)" style="min-width:240px">'+typeOpts+'</select>'+
      '<label class="fld">Subject</label><input id="et_subject" type="text" value="'+this.esc(subject)+'">'+
      '<label class="fld">Message</label><textarea id="et_body" rows="7">'+this.esc(body)+'</textarea>';
    return inner; },
  _emTplStash(b,type){ var s=document.getElementById('et_subject'), bd=document.getElementById('et_body'); if(!s&&!bd) return; b.emailTemplates=b.emailTemplates||{}; b.emailTemplates[type]={subject:s?s.value:'',body:bd?bd.value:''}; },
  emTplPick(v){ var b=this.curBiz(); if(!b) return; this._emTplStash(b,this._emTplType||'default'); this._emTplType=v; this.saveBiz(b); this.renderMain(b); },
  saveEmailTemplate(){ var b=this.curBiz(); if(!b) return; this._emTplStash(b,this._emTplType||'default'); this.saveBiz(b); try{ this.toast&&this.toast('Email template saved'); }catch(e){} this.renderMain(b); },

  /* ===================== email delivery =====================
     A page served over http(s) cannot open an SMTP socket, so there are exactly
     two ways this app can deliver mail:
       mailto — hand the composed message to the user's own mail client.
                Always available; cannot carry an attachment (RFC 6068), so the
                PDF is saved separately and attached by the user.
       relay  — POST the message to an HTTP endpoint the user runs, which does
                the actual SMTP talking with the credentials stored here.
     Every send is written to the Emails log either way.                        */
  EMAIL_MODES:[['mailto','Mail client (mailto:)'],['relay','HTTP relay endpoint']],
  emailCfg(b){ return (b&&b.details&&b.details.email)||{}; },
  emailMode(b){ return this.emailCfg(b).mode||'mailto'; },

  _emFill(tpl,vars){ return String(tpl==null?'':tpl).replace(/\{(\w+)\}/g,function(m,k){
    return vars[k]!=null&&vars[k]!=='' ? String(vars[k]) : m; }); },
  /* Look up a party's stored email by the name held on the record. */
  _partyEmail(b,listKey,name){ if(!name) return '';
    var list=(b.records&&b.records[listKey])||[]; var n=String(name).trim().toLowerCase();
    var hit=list.find(function(p){ return String(p.name||'').trim().toLowerCase()===n; });
    return (hit&&hit.email)||''; },
  emailVars(b,key,rec){ rec=rec||{};
    var party=rec.customer||rec.supplier||rec.employee||rec.paidBy||rec.payee||rec.name||'';
    var amt=rec.total!=null?rec.total:(rec.amount!=null?rec.amount:(rec.netPay!=null?rec.netPay:''));
    return { business:(b&&b.name)||'', party:party||'Sir/Madam',
      document:(this.fmtFormName?this.fmtFormName(key):key)||'document',
      ref:rec.reference||rec.number||rec.code||String(rec.id||''),
      amount:(amt===''?'':this.money(amt)), date:this.fmtDateUS(rec.issueDate||rec.date||'') }; },
  emailTplFor(b,type){ var t=((b&&b.emailTemplates)||{})[type];
    var d=this._emTplDefault(type);
    return { subject:(t&&t.subject!=null&&t.subject!=='')?t.subject:d.subject,
             body:(t&&t.body!=null&&t.body!=='')?t.body:d.body }; },

  /* Open the composer for the record currently on screen. */
  emailDoc(){ var b=this.curBiz(); if(!b) return;
    var key=LABEL2KEY[this.wsSection]; var rec=(this.records(b)||[]).find(r=>String(r.id)===String(this.editingId));
    if(!rec){ alert('Open a document first.'); return; }
    var tplType=this.emailTplFor(b,key)&&this._emTplTypes().some(t=>t[0]===key)?key:'default';
    var vars=this.emailVars(b,key,rec); var tpl=this.emailTplFor(b,tplType);
    var to=this._partyEmail(b,'customers',rec.customer)||this._partyEmail(b,'suppliers',rec.supplier)||
           this._partyEmail(b,'employees',rec.employee)||'';
    this.emailCompose({ to:to, subject:this._emFill(tpl.subject,vars), body:this._emFill(tpl.body,vars),
      docLabel:this._recLabel(key,rec), attachHint:true }); },

  /* Reports have no party, so the recipient starts blank. */
  reportEmail(){ var b=this.curBiz(); if(!b) return;
    var title=(this._repCtx&&this._repCtx.inst&&this._repCtx.inst.name)||'Report';
    var vars={ business:b.name||'', party:'Sir/Madam', document:title, ref:'', amount:'', date:this.fmtDateUS(new Date().toISOString().slice(0,10)) };
    var tpl=this.emailTplFor(b,'default');
    this.emailCompose({ to:'', subject:this._emFill(tpl.subject,vars), body:this._emFill(tpl.body,vars),
      docLabel:title, attachHint:true }); },

  emailCompose(o){ o=o||{}; var b=this.curBiz(); var cfg=this.emailCfg(b); var mode=this.emailMode(b);
    this._emDraft={ docLabel:o.docLabel||'' };
    var modeOpts=this.EMAIL_MODES.map(function(m){ return '<option value="'+m[0]+'"'+(mode===m[0]?' selected':'')+'>'+m[1]+'</option>'; }).join('');
    var note = mode==='relay'
      ? (cfg.relayUrl
          ? '<div class="info-bar">Will POST to your relay at <code>'+this.esc(cfg.relayUrl)+'</code>, which sends it over SMTP.</div>'
          : '<div class="em-warn">No relay URL configured. Set one in Settings → Email Settings, or switch to the mail client below.</div>')
      : '<div class="info-bar">Opens your mail client with this message ready to send. <b>Attachments cannot be pre-filled by a web page</b> — use <b>Save PDF</b> below, then attach the file before sending.</div>';
    if(!cfg.fromAddr) note+='<div class="em-warn">No “from” address set — add one in Settings → Email Settings.</div>';
    this._openOverlay('<div class="app-modal-h">Email '+this.esc(o.docLabel||'document')+'</div>'+
      '<div class="app-modal-b">'+note+
        '<label class="fld">Delivery</label><select id="em_mode" onchange="App.emailModeSet(this.value)">'+modeOpts+'</select>'+
        '<label class="fld">To</label><input id="em_to" type="text" value="'+this.esc(o.to||'')+'" placeholder="name@example.com">'+
        '<label class="fld">Subject</label><input id="em_subj" type="text" value="'+this.esc(o.subject||'')+'">'+
        '<label class="fld">Message</label><textarea id="em_body" rows="9">'+this.esc(o.body||'')+'</textarea>'+
      '</div>'+
      '<div class="app-modal-f">'+
        (o.attachHint?'<button class="btn btn-xs" onclick="App.emailSavePdf()">⬇ Save PDF</button>':'')+
        '<span style="flex:1"></span>'+
        '<button class="btn" onclick="App._closeOverlay()">Cancel</button>'+
        '<button class="btn btn-primary" onclick="App.emailSend()">Send</button>'+
      '</div>'); },
  emailModeSet(m){ var b=this.curBiz(); if(!b) return;
    b.details=Object.assign({},b.details,{email:Object.assign({},this.emailCfg(b),{mode:m})});
    this.saveBiz(b);
    var d=this._emDraft||{}; var g=function(id){ var el=document.getElementById(id); return el?el.value:''; };
    this.emailCompose({ to:g('em_to'), subject:g('em_subj'), body:g('em_body'), docLabel:d.docLabel, attachHint:true }); },
  emailSavePdf(){ this._closeOverlay(); try{ this.pdfView?this.pdfView():this.printView(); }catch(e){ try{ this.printView(); }catch(_){ } } },

  emailSend(){ var b=this.curBiz(); if(!b) return; var self=this;
    var g=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
    var to=g('em_to'), subject=g('em_subj'), body=document.getElementById('em_body')?document.getElementById('em_body').value:'';
    if(!to){ alert('Enter a recipient address.'); return; }
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)){ alert('“'+to+'” is not a valid email address.'); return; }
    var cfg=this.emailCfg(b); var mode=cfg.mode||'mailto';
    if(mode==='relay'){
      if(!cfg.relayUrl){ alert('No relay URL configured. Set one in Settings → Email Settings, or switch to the mail client.'); return; }
      this._emailViaRelay(b,cfg,{to:to,subject:subject,body:body});
    } else {
      var href=this._mailtoHref(cfg,{to:to,subject:subject,body:body});
      try{ window.location.href=href; }catch(e){}
      this._emailLog(b,{to:to,subject:subject,body:body,status:'Handed to mail client',mode:'mailto'});
      this._closeOverlay();
      try{ this.toast&&this.toast('Opened in your mail client'); }catch(e){}
    } },
  /* Split out so it can be exercised without actually launching a mail client. */
  _mailtoHref(cfg,msg){ cfg=cfg||{};
    var q=['subject='+encodeURIComponent(msg.subject||''),'body='+encodeURIComponent(msg.body||'')];
    if(cfg.replyTo) q.push('reply-to='+encodeURIComponent(cfg.replyTo));
    return 'mailto:'+encodeURIComponent(msg.to||'')+'?'+q.join('&'); },
  _emailViaRelay(b,cfg,msg){ var self=this;
    var btns=document.querySelectorAll('#appOverlay .app-modal-f .btn');
    btns.forEach(function(x){ x.disabled=true; });
    var payload={ to:msg.to, subject:msg.subject, body:msg.body,
      from:cfg.fromAddr||'', fromName:cfg.fromName||b.name||'', replyTo:cfg.replyTo||'',
      smtp:{ host:cfg.smtpHost||'', port:cfg.smtpPort||'', user:cfg.smtpUser||'',
             pass:cfg.smtpPass||'', encryption:cfg.encryption||'TLS' } };
    fetch(cfg.relayUrl,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      .then(function(r){ if(!r.ok) throw new Error('relay responded '+r.status+' '+r.statusText); return r.text(); })
      .then(function(){ self._emailLog(b,{to:msg.to,subject:msg.subject,body:msg.body,status:'Sent',mode:'relay'});
        self._closeOverlay(); try{ self.toast&&self.toast('Email sent'); }catch(e){ alert('Email sent.'); } })
      .catch(function(err){ btns.forEach(function(x){ x.disabled=false; });
        self._emailLog(b,{to:msg.to,subject:msg.subject,body:msg.body,status:'Failed',mode:'relay',error:err.message});
        alert('Could not send via the relay:\n\n'+err.message+'\n\nThe attempt has been recorded in the Emails log.'); }); },
  _emailLog(b,m){ b.records=b.records||{}; b.records.emails=b.records.emails||[];
    b.records.emails.unshift({ id:this.uuid(), ts:new Date().toISOString(), recipient:m.to,
      subject:m.subject, body:m.body, status:m.status, mode:m.mode, error:m.error||'' });
    if(b.records.emails.length>500) b.records.emails.length=500;
    this.saveBiz(b); },

  set_divisions(b){ var self=this; var divs=b.divisions||[];
    var rows=divs.map(function(d,i){ return '<div class="tax-row"><input class="nm" type="text" value="'+self.esc(d.name||'')+'" placeholder="Division name" onchange="App.divSet('+i+',\'name\',this.value)">'+
      '<input class="rt" type="text" style="width:130px" value="'+self.esc(d.code||'')+'" placeholder="Code" onchange="App.divSet('+i+',\'code\',this.value)">'+
      '<button class="dz-x" onclick="App.divRemove('+i+')">✕</button></div>'; }).join('');
    var inner='<div class="info-bar">Divisions let you track results by department, branch or project. Add them here, then tag transactions with a division.</div>'+
      '<div style="display:flex;gap:8px;font-size:11px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:6px"><span style="flex:1">Name</span><span style="width:138px">Code</span><span style="width:20px"></span></div>'+
      (rows||'<div style="color:#aaa;margin-bottom:8px">No divisions yet.</div>')+
      '<button class="btn btn-sm" onclick="App.divAdd()">+ Add division</button>';
    return this.crumb('Settings','Divisions')+'<div class="card" style="max-width:620px"><h2>Divisions</h2>'+inner+'<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  divAdd(){ var b=this.curBiz(); b.divisions=b.divisions||[]; b.divisions.push({id:'d'+Date.now()+Math.floor(Math.random()*1000),name:'New division',code:''}); this.saveBiz(b); this.renderMain(b); },
  divRemove(i){ var b=this.curBiz(); (b.divisions||[]).splice(i,1); this.saveBiz(b); this.renderMain(b); },
  divSet(i,f,v){ var b=this.curBiz(); if(b.divisions&&b.divisions[i]){ b.divisions[i][f]=v; this.saveBiz(b); } },

  /* ===================== settings added for Manager.io parity ===================== */
  /* A small editor for the settings that are just a named list. `cfg.cols` is
     [[field, placeholder, width], …]; everything persists on the business. */
  _setListCard(b,title,storeKey,cfg,intro){ var self=this; var list=(b[storeKey]||[]);
    var cols=cfg.cols||[['name','Name',0]];
    var head='<div style="display:flex;gap:8px;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">'+
      cols.map(function(c){ return '<span style="'+(c[2]?('width:'+c[2]+'px'):'flex:1')+'">'+self.esc(c[1])+'</span>'; }).join('')+'<span style="width:20px"></span></div>';
    var rows=list.map(function(row,i){ return '<div class="tax-row">'+cols.map(function(c,ci){
        var v=row[c[0]]==null?'':row[c[0]];
        if(c[3]==='select') return '<select class="'+(ci?'rt':'nm')+'"'+(c[2]?(' style="width:'+c[2]+'px"'):'')+' onchange="App.setListSet(\''+storeKey+'\','+i+',\''+c[0]+'\',this.value)">'+
          (c[4]||[]).map(function(o){ return '<option'+(String(v)===String(o)?' selected':'')+'>'+self.esc(o)+'</option>'; }).join('')+'</select>';
        if(c[3]==='account'){ var opts=self.accountOptions(b);
          return '<select class="'+(ci?'rt':'nm')+'"'+(c[2]?(' style="width:'+c[2]+'px"'):'')+' onchange="App.setListSet(\''+storeKey+'\','+i+',\''+c[0]+'\',this.value)">'+
            '<option value="">— account —</option>'+opts.map(function(o){ return '<option value="'+o.id+'"'+(String(v)===String(o.id)?' selected':'')+'>'+self.esc(o.label)+'</option>'; }).join('')+'</select>'; }
        return '<input class="'+(ci?'rt':'nm')+'" type="'+(c[3]||'text')+'"'+(c[2]?(' style="width:'+c[2]+'px"'):'')+
          ' value="'+self.esc(v)+'" placeholder="'+self.esc(c[1])+'" onchange="App.setListSet(\''+storeKey+'\','+i+',\''+c[0]+'\',this.value)">'; }).join('')+
      '<button class="dz-x" onclick="App.setListRemove(\''+storeKey+'\','+i+')" title="Remove">✕</button></div>'; }).join('');
    var inner=(intro?('<div class="info-bar">'+intro+'</div>'):'')+head+
      (rows||'<div style="color:var(--muted-2);margin-bottom:8px">Nothing here yet.</div>')+
      '<button class="btn btn-sm" onclick="App.setListAdd(\''+storeKey+'\','+JSON.stringify(JSON.stringify(cfg.blank||{}))+')">+ Add</button>';
    return this.crumb('Settings',title)+'<div class="card" style="max-width:760px"><h2>'+this.esc(title)+'</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  setListAdd(storeKey,blankJson){ var b=this.curBiz(); b[storeKey]=b[storeKey]||[];
    var blank={}; try{ blank=JSON.parse(blankJson)||{}; }catch(e){}
    blank.id='x'+Date.now()+Math.floor(Math.random()*1000); b[storeKey].push(blank); this.saveBiz(b); this.renderMain(b); },
  setListRemove(storeKey,i){ var b=this.curBiz(); (b[storeKey]||[]).splice(i,1); this.saveBiz(b); this.renderMain(b); },
  setListSet(storeKey,i,f,v){ var b=this.curBiz(); if(b[storeKey]&&b[storeKey][i]){ b[storeKey][i][f]=v; this.saveBiz(b); } },

  /* ---- inventory locations ---- */
  set_locations(b){ return this._setListCard(b,'Inventory Locations','locations',
    {cols:[['name','Location name',0],['code','Code',130]],blank:{name:'New location',code:''}},
    'Locations let you hold the same item in more than one place. Inventory Transfers move quantity between them; the ledger value is unaffected.'); },

  /* ---- expense claim payers ---- */
  set_claimPayers(b){ return this._setListCard(b,'Expense Claim Payers','claimPayers',
    {cols:[['name','Payer name',0],['code','Code',130]],blank:{name:'New payer',code:''}},
    'Anyone who pays business expenses out of their own pocket. Employees and capital accounts can be picked on a claim as well — this list is for people who are neither.'); },

  /* ---- projects ---- */
  set_projects(b){ return this._setListCard(b,'Projects','projects',
    {cols:[['name','Project name',0],['code','Code',120],['status','Status',140,'select',['Active','On hold','Complete']]],
     blank:{name:'New project',code:'',status:'Active'}},
    'Projects group transactions the way Divisions do, but for work with a start and an end. Tag documents with a project on the entry form.'); },

  /* ---- bank import rules ---- */
  set_bankRules(b){ return this._setListCard(b,'Bank Rules','bankRules',
    {cols:[['match','If the statement line contains…',0],['account','Post to account',260,'account']],
     blank:{match:'',account:''}},
    'When you import a bank statement, the first rule whose text appears in the line decides which account the line is coded to. Rules are checked top to bottom.'); },

  /* ---- inventory kits ---- */
  set_kits(b){ var self=this; var kits=b.inventoryKits||[]; var items=((b.records&&b.records.inventory)||[]).map(function(i){ return i.name; }).filter(Boolean);
    var body=kits.map(function(k,i){
      var comps=(k.items||[]).map(function(c,ci){
        return '<div class="tax-row" style="margin-left:18px">'+
          '<select class="nm" onchange="App.kitComp('+i+','+ci+',\'item\',this.value)"><option value="">— item —</option>'+
            items.map(function(n){ return '<option'+(c.item===n?' selected':'')+'>'+self.esc(n)+'</option>'; }).join('')+'</select>'+
          '<input class="rt" style="width:110px" type="text" value="'+self.esc(c.qty==null?'':c.qty)+'" placeholder="Qty" onchange="App.kitComp('+i+','+ci+',\'qty\',this.value)">'+
          '<button class="dz-x" onclick="App.kitCompRemove('+i+','+ci+')">✕</button></div>'; }).join('');
      return '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px">'+
        '<div class="tax-row"><input class="nm" type="text" value="'+self.esc(k.name||'')+'" placeholder="Kit name" onchange="App.kitSet('+i+',\'name\',this.value)">'+
        '<input class="rt" style="width:130px" type="text" value="'+self.esc(k.salesPrice==null?'':k.salesPrice)+'" placeholder="Sale price" onchange="App.kitSet('+i+',\'salesPrice\',this.value)">'+
        '<button class="dz-x" onclick="App.kitRemove('+i+')">✕</button></div>'+
        comps+
        '<button class="btn btn-sm" style="margin-left:18px" onclick="App.kitCompAdd('+i+')">+ Add component</button>'+
        '<div style="margin-left:18px;margin-top:8px;color:var(--muted);font-size:12px">Component cost: '+self.money(self.kitCost(b,k))+'</div>'+
        '</div>'; }).join('');
    var inner='<div class="info-bar">A kit is sold as one line but drawn from stock as its components. Selling a kit reduces each component by its quantity.</div>'+
      (body||'<div style="color:var(--muted-2);margin-bottom:8px">No kits yet.</div>')+
      '<button class="btn btn-sm" onclick="App.kitAdd()">+ Add kit</button>';
    return this.crumb('Settings','Inventory Kits')+'<div class="card" style="max-width:760px"><h2>Inventory Kits</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  kitCost(b,k){ var self=this; var t=0; (k.items||[]).forEach(function(c){ t+=(Number(c.qty)||0)*invAvgCostByName(b,c.item); }); return Math.round(t*100)/100; },
  kitAdd(){ var b=this.curBiz(); b.inventoryKits=b.inventoryKits||[]; b.inventoryKits.push({id:'k'+Date.now(),name:'New kit',salesPrice:'',items:[]}); this.saveBiz(b); this.renderMain(b); },
  kitRemove(i){ var b=this.curBiz(); (b.inventoryKits||[]).splice(i,1); this.saveBiz(b); this.renderMain(b); },
  kitSet(i,f,v){ var b=this.curBiz(); if(b.inventoryKits&&b.inventoryKits[i]){ b.inventoryKits[i][f]=v; this.saveBiz(b); } },
  kitCompAdd(i){ var b=this.curBiz(); var k=(b.inventoryKits||[])[i]; if(!k) return; k.items=k.items||[]; k.items.push({item:'',qty:1}); this.saveBiz(b); this.renderMain(b); },
  kitCompRemove(i,ci){ var b=this.curBiz(); var k=(b.inventoryKits||[])[i]; if(!k) return; (k.items||[]).splice(ci,1); this.saveBiz(b); this.renderMain(b); },
  kitComp(i,ci,f,v){ var b=this.curBiz(); var k=(b.inventoryKits||[])[i]; if(!k||!k.items||!k.items[ci]) return; k.items[ci][f]=v; this.saveBiz(b); if(f==='item') this.renderMain(b); },

  /* ---- late payment fees ---- */
  set_lateFees(b){ var f=b.lateFees||{}; var e=function(x){ return App.esc(x==null?'':x); };
    var inner='<div class="info-bar">Charges added to a sales invoice once it is overdue. Turn it on here, then tick <b>Late payment fees</b> on the invoices it should apply to.</div>'+
      '<label class="chk-row"><input type="checkbox" id="lf_on"'+(f.enabled?' checked':'')+'> Charge late payment fees</label>'+
      '<div class="frm-row3" style="margin-top:12px">'+
        '<div><label class="fld">Rate</label><div class="frm-inline"><input id="lf_rate" type="text" inputmode="decimal" style="width:90px" value="'+e(f.rate!=null?f.rate:1.5)+'"><span class="fld-inline">%</span></div></div>'+
        '<div><label class="fld">Charged</label><select id="lf_period"><option'+(f.period==='month'?' selected':'')+' value="month">per month</option><option'+(f.period==='year'?' selected':'')+' value="year">per year</option><option'+(f.period==='once'?' selected':'')+' value="once">once</option></select></div>'+
        '<div><label class="fld">Grace period</label><div class="frm-inline"><input id="lf_grace" type="number" style="width:90px" value="'+e(f.grace!=null?f.grace:0)+'"><span class="fld-inline">days</span></div></div>'+
      '</div>'+
      '<label class="fld" style="margin-top:14px">Income account for fees charged</label>'+
      '<select id="lf_acct"><option value="">— none —</option>'+this.accountOptions(b).map(function(o){ return '<option value="'+o.id+'"'+(String(f.account)===String(o.id)?' selected':'')+'>'+App.esc(o.label)+'</option>'; }).join('')+'</select>';
    return this.setCard('Late Payment Fees',inner,'App.saveLateFees()'); },
  saveLateFees(){ var b=this.curBiz(); var g=function(id){ var el=document.getElementById(id); return el?el.value:''; };
    var on=document.getElementById('lf_on'); b.lateFees={enabled:!!(on&&on.checked),rate:this.parseNum(g('lf_rate')),period:g('lf_period'),grace:this.parseNum(g('lf_grace')),account:g('lf_acct')};
    this.saveBiz(b); this.settingsBack(); this.toast&&this.toast('Late payment fees saved'); },

  /* ---- form defaults ---- */
  _formDefaultKeys(){ return ['salesInv','purchInv','salesQuotes','purchQuotes','salesOrders','purchOrders',
    'creditNotes','debitNotes','deliveryNotes','goodsRec','receipts','payments','journal','expenseClaims']; },
  set_formDefaults(b){ var self=this; var d=b.formDefaults||{}; var codes=(b.taxCodes||[]).map(function(t){ return t.name; });
    var divs=(b.divisions||[]).map(function(x){ return x.name||x; }).filter(Boolean);
    var rows=this._formDefaultKeys().map(function(k){ var v=d[k]||{}; var nm=(REG[k]&&(REG[k].singular||REG[k].label))||k;
      return '<tr><td>'+self.esc(nm)+'</td>'+
        '<td><input type="text" style="width:100%" value="'+self.esc(v.description||'')+'" placeholder="Description" onchange="App.fdSet(\''+k+'\',\'description\',this.value)"></td>'+
        '<td><input type="number" style="width:80px" value="'+self.esc(v.dueDays==null?'':v.dueDays)+'" placeholder="Net" onchange="App.fdSet(\''+k+'\',\'dueDays\',this.value)"></td>'+
        '<td><select onchange="App.fdSet(\''+k+'\',\'taxCode\',this.value)"><option value="">— none —</option>'+
          codes.map(function(c){ return '<option'+(v.taxCode===c?' selected':'')+'>'+self.esc(c)+'</option>'; }).join('')+'</select></td>'+
        '<td><select onchange="App.fdSet(\''+k+'\',\'division\',this.value)"><option value="">— none —</option>'+
          divs.map(function(c){ return '<option'+(v.division===c?' selected':'')+'>'+self.esc(c)+'</option>'; }).join('')+'</select></td>'+
        '</tr>'; }).join('');
    var inner='<div class="info-bar">Values pre-filled on a new document. Anything left blank is simply not pre-filled — you can still change every field on the form.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Form</th><th>Default description</th><th>Due in (days)</th><th>Tax code</th><th>Division</th></tr></thead><tbody>'+rows+'</tbody></table>';
    return this.crumb('Settings','Form Defaults')+'<div class="card"><h2>Form Defaults</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  fdSet(key,f,v){ var b=this.curBiz(); b.formDefaults=b.formDefaults||{}; b.formDefaults[key]=b.formDefaults[key]||{}; b.formDefaults[key][f]=v; this.saveBiz(b); },

  /* ---- recurring transactions ---- */
  _recurKeys(){ return ['salesInv','purchInv','journal','payslips','expenseClaims']; },
  set_recurring(b){ var self=this; var list=b.recurring||[];
    var rows=list.map(function(r,i){ var recs=((b.records&&b.records[r.key])||[]);
      return '<tr><td><select onchange="App.recurSet('+i+',\'key\',this.value)">'+
          self._recurKeys().map(function(k){ return '<option value="'+k+'"'+(r.key===k?' selected':'')+'>'+self.esc((REG[k]&&REG[k].singular)||k)+'</option>'; }).join('')+'</select></td>'+
        '<td><select onchange="App.recurSet('+i+',\'src\',this.value)"><option value="">— pick one to copy —</option>'+
          recs.map(function(x){ return '<option value="'+x.id+'"'+(String(r.src)===String(x.id)?' selected':'')+'>'+self.esc(x.reference||x.description||('#'+x.id))+'</option>'; }).join('')+'</select></td>'+
        '<td><select onchange="App.recurSet('+i+',\'every\',this.value)">'+
          ['Weekly','Fortnightly','Monthly','Quarterly','Yearly'].map(function(o){ return '<option'+(r.every===o?' selected':'')+'>'+o+'</option>'; }).join('')+'</select></td>'+
        '<td><input type="date" value="'+self.esc(r.next||'')+'" onchange="App.recurSet('+i+',\'next\',this.value)"></td>'+
        '<td class="r"><button class="btn btn-sm" onclick="App.recurRun('+i+')">Create now</button> '+
          '<button class="dz-x" onclick="App.setListRemove(\'recurring\','+i+')">✕</button></td></tr>'; }).join('');
    var inner='<div class="info-bar">Point a schedule at an existing document and <b>Create now</b> copies it with today’s date and the next reference number. The next-due date rolls forward on its own.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Type</th><th>Copy of</th><th>Every</th><th>Next due</th><th class="r">Actions</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="5"><div class="reg-empty">No recurring transactions yet.</div></td></tr>')+'</tbody></table>'+
      '<button class="btn btn-sm" style="margin-top:10px" onclick="App.setListAdd(\'recurring\','+JSON.stringify(JSON.stringify({key:'salesInv',src:'',every:'Monthly',next:''}))+')">+ Add schedule</button>';
    return this.crumb('Settings','Recurring Transactions')+'<div class="card"><h2>Recurring Transactions</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  recurSet(i,f,v){ var b=this.curBiz(); if(b.recurring&&b.recurring[i]){ b.recurring[i][f]=v; this.saveBiz(b); if(f==='key') this.renderMain(b); } },
  _recurAdvance(iso,every){ if(!iso) return '';
    if(every==='Weekly') return this._isoShift(iso,7);
    if(every==='Fortnightly') return this._isoShift(iso,14);
    if(every==='Quarterly') return this._isoShift(iso,0,3);
    if(every==='Yearly') return this._isoShift(iso,0,0,1);
    return this._isoShift(iso,0,1); },
  recurRun(i){ var b=this.curBiz(); var r=(b.recurring||[])[i]; if(!r){ return; }
    if(!r.src){ alert('Pick the document this schedule should copy first.'); return; }
    var arr=(b.records&&b.records[r.key])||[]; var src=arr.find(function(x){ return String(x.id)===String(r.src); });
    if(!src){ alert('That document no longer exists — pick another one.'); return; }
    var copy=JSON.parse(JSON.stringify(src)); copy.id=Date.now(); copy.uuid=this.uuid();
    var today=(r.next||new Date().toISOString().slice(0,10));
    if(copy.issueDate!=null) copy.issueDate=today; if(copy.date!=null) copy.date=today;
    copy.reference=this.nextRef(b,r.key);
    b.records=b.records||{}; b.records[r.key]=arr.concat([copy]);
    r.next=this._recurAdvance(today,r.every);
    try{ refreshSummary(b); }catch(e){}
    try{ this._logActivity(b,'create',r.key,copy,null); }catch(e){}
    this.saveBiz(b); this.renderMain(b);
    var nm=(REG[r.key]&&REG[r.key].singular)||r.key;
    alert(nm+' '+copy.reference+' created. Next due '+(r.next||'—')+'.'); },

  /* ---- starting balances ---- */
  set_starting(b){ var self=this; var R=b.records||{};
    var section=function(title,key,field,label){ var list=R[key]||[];
      var rows=list.map(function(rec,i){ return '<tr><td>'+self.esc(rec.name||rec.reference||('#'+rec.id))+'</td>'+
        '<td class="r"><input class="r" type="text" inputmode="decimal" style="width:140px;text-align:right" value="'+
        self.esc(rec[field]==null?'':rec[field])+'" onchange="App.sbSet(\''+key+'\','+i+',\''+field+'\',this.value)"></td></tr>'; }).join('');
      var tot=list.reduce(function(a,x){ return a+(Number(x[field])||0); },0);
      return '<tr><td colspan="2" style="font-weight:800;padding-top:12px">'+self.esc(title)+'</td></tr>'+
        (rows||'<tr><td colspan="2" style="padding-left:18px;color:var(--muted-2)">None yet.</td></tr>')+
        (list.length?('<tr><td style="padding-left:18px;font-weight:600">Total '+self.esc(label||title.toLowerCase())+'</td><td class="r m" style="font-weight:700">'+self.money(tot)+'</td></tr>'):''); };
    var coaRows=(b.coa||[]).filter(function(n){ return n.type==='account'&&!n.control; }).map(function(n){
      return '<tr><td style="padding-left:18px">'+self.esc(acctPath(b,n))+'</td><td class="r"><input class="r" type="text" inputmode="decimal" style="width:140px;text-align:right" value="'+
        self.esc(n.balance==null?'':n.balance)+'" onchange="App.sbAcct(\''+n.id+'\',this.value)"></td></tr>'; }).join('');
    var inner='<div class="info-bar">Where the books stood the day before you started using this app. Control accounts are set from their own ledgers — customers, suppliers, inventory items and so on — so they are edited in those sections below rather than directly.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Account</th><th class="r">Starting balance</th></tr></thead><tbody>'+
      section('Bank and cash accounts','bankCash','balance','bank & cash')+
      section('Customers (accounts receivable)','customers','balance','receivable')+
      section('Suppliers (accounts payable)','suppliers','balance','payable')+
      section('Capital accounts','capital','balance','capital')+
      section('Special accounts','special','balance','special accounts')+
      '<tr><td colspan="2" style="font-weight:800;padding-top:12px">Other accounts</td></tr>'+
      (coaRows||'<tr><td colspan="2" style="padding-left:18px;color:var(--muted-2)">None.</td></tr>')+
      '</tbody></table>';
    return this.crumb('Settings','Starting Balances')+'<div class="card"><h2>Starting Balances</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  sbSet(key,i,field,v){ var b=this.curBiz(); var arr=(b.records&&b.records[key])||[]; if(!arr[i]) return;
    arr[i][field]=this.parseNum(v); try{ refreshSummary(b); }catch(e){} this.saveBiz(b); this.renderMain(b); },
  sbAcct(id,v){ var b=this.curBiz(); var n=acctById(b,id); if(!n) return; n.balance=this.parseNum(v);
    try{ refreshSummary(b); }catch(e){} this.saveBiz(b); this.renderMain(b); },

  /* ---- custom fields, gathered from every form ---- */
  set_customFields(b){ var self=this; var keys=Object.keys(REG); var any=false;
    var rows=keys.map(function(k){ var cfg=(b.formConfig&&b.formConfig[k])||{}; var list=(cfg.custom||[]);
      if(!list.length) return ''; any=true;
      return list.map(function(x){ return '<tr><td>'+self.esc((REG[k]&&(REG[k].singular||REG[k].label))||k)+'</td>'+
        '<td>'+self.esc(x.label||'(unnamed)')+'</td><td>'+self.esc(x.type==='line'?'Line item':'Form field')+'</td>'+
        '<td>'+self.esc(x.dataType||'text')+'</td>'+
        '<td class="r"><button class="btn btn-sm" onclick="App.openFmtForm(\''+k+'\')">Edit</button></td></tr>'; }).join(''); }).join('');
    var inner='<div class="info-bar">Custom fields are added on the form itself — <b>Custom Theme → pick a form → ＋ Add custom field</b>. This page lists every one you have defined, across all forms.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Form</th><th>Label</th><th>Placement</th><th>Type</th><th class="r"></th></tr></thead><tbody>'+
      (any?rows:'<tr><td colspan="5"><div class="reg-empty">No custom fields defined yet.</div></td></tr>')+'</tbody></table>';
    return this.crumb('Settings','Custom Fields')+'<div class="card"><h2>Custom Fields</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.openSetting(\'themes\')">Go to Custom Theme</button>'+
      '<button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },

  /* ---- custom reports ---- */
  set_customReports(b){ var self=this; var list=b.customReports||[];
    var accts=this.accountOptions(b);
    var body=list.map(function(r,i){
      var lines=(r.rows||[]).map(function(ln,li){ var sel=(ln.accounts||[]);
        return '<div class="tax-row" style="margin-left:18px;align-items:flex-start">'+
          '<input class="nm" type="text" style="max-width:200px" value="'+self.esc(ln.label||'')+'" placeholder="Line label" onchange="App.crRow('+i+','+li+',\'label\',this.value)">'+
          '<select class="rt" multiple size="4" style="width:320px" onchange="App.crAccounts('+i+','+li+',this)">'+
            accts.map(function(o){ return '<option value="'+o.id+'"'+(sel.indexOf(o.id)>=0?' selected':'')+'>'+self.esc(o.label)+'</option>'; }).join('')+'</select>'+
          '<select class="rt" style="width:90px" onchange="App.crRow('+i+','+li+',\'sign\',this.value)">'+
            ['+','−'].map(function(o){ return '<option'+((ln.sign||'+')===o?' selected':'')+'>'+o+'</option>'; }).join('')+'</select>'+
          '<button class="dz-x" onclick="App.crRowRemove('+i+','+li+')">✕</button></div>'; }).join('');
      return '<div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px">'+
        '<div class="tax-row"><input class="nm" type="text" value="'+self.esc(r.name||'')+'" placeholder="Report name" onchange="App.crSet('+i+',\'name\',this.value)">'+
        '<select class="rt" style="width:150px" onchange="App.crSet('+i+',\'basis\',this.value)">'+
          ['Period movement','Balance as at'].map(function(o){ return '<option'+((r.basis||'Period movement')===o?' selected':'')+'>'+o+'</option>'; }).join('')+'</select>'+
        '<button class="dz-x" onclick="App.setListRemove(\'customReports\','+i+')">✕</button></div>'+
        lines+
        '<button class="btn btn-sm" style="margin-left:18px" onclick="App.crRowAdd('+i+')">+ Add line</button></div>'; }).join('');
    var inner='<div class="info-bar">Build a statement of your own: name each line and pick the accounts it adds up. Saved reports appear under <b>Reports → Custom Reports</b>. Hold ⌘/Ctrl to select more than one account.</div>'+
      (body||'<div style="color:var(--muted-2);margin-bottom:8px">No custom reports yet.</div>')+
      '<button class="btn btn-sm" onclick="App.setListAdd(\'customReports\','+JSON.stringify(JSON.stringify({name:'New report',basis:'Period movement',rows:[]}))+')">+ Add report</button>';
    return this.crumb('Settings','Custom Reports')+'<div class="card"><h2>Custom Reports</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  crSet(i,f,v){ var b=this.curBiz(); if(b.customReports&&b.customReports[i]){ b.customReports[i][f]=v; this.saveBiz(b); } },
  crRowAdd(i){ var b=this.curBiz(); var r=(b.customReports||[])[i]; if(!r) return; r.rows=r.rows||[]; r.rows.push({label:'New line',accounts:[],sign:'+'}); this.saveBiz(b); this.renderMain(b); },
  crRowRemove(i,li){ var b=this.curBiz(); var r=(b.customReports||[])[i]; if(!r) return; (r.rows||[]).splice(li,1); this.saveBiz(b); this.renderMain(b); },
  crRow(i,li,f,v){ var b=this.curBiz(); var r=(b.customReports||[])[i]; if(!r||!r.rows||!r.rows[li]) return; r.rows[li][f]=v; this.saveBiz(b); },
  crAccounts(i,li,sel){ var b=this.curBiz(); var r=(b.customReports||[])[i]; if(!r||!r.rows||!r.rows[li]) return;
    var out=[]; for(var x=0;x<sel.options.length;x++){ if(sel.options[x].selected) out.push(sel.options[x].value); }
    r.rows[li].accounts=out; this.saveBiz(b); },
  _renderCustomReport(b,key,inst){ var self=this; var defs=b.customReports||[];
    var def=defs.find(function(d){ return String(d.id)===String(inst.custom)||d.name===inst.custom; })||defs[0];
    if(!def) return this.repHead(b,'Custom Reports')+'<div class="info-bar">No custom report is defined yet. Build one in <b>Settings → Custom Reports</b>.</div>'+this.repFoot();
    var asAt=(def.basis==='Balance as at');
    var tot=0;
    var body=(def.rows||[]).map(function(ln){ var v=0;
      (ln.accounts||[]).forEach(function(id){ v+= asAt ? self._acctAsOf(b,id,inst.to) : self._acctPeriod(b,id,inst.from,inst.to); });
      if((ln.sign||'+')==='−') v=-v; tot+=v;
      return '<tr><td>'+self.esc(ln.label||'')+'</td><td class="r m">'+self._repM(v)+'</td></tr>'; }).join('');
    var foot=this._repTotRow('<td>Total</td><td class="r m">'+this.money(tot)+'</td>');
    var picker=defs.length>1?('<div class="info-bar">Showing <b>'+this.esc(def.name||'Custom report')+'</b>. Other definitions: '+
      defs.filter(function(d){ return d!==def; }).map(function(d){ return self.esc(d.name||'(unnamed)'); }).join(', ')+
      ' — set which one this report uses on its Edit screen.</div>'):'';
    return this.repHead(b,def.name||'Custom Report')+this._repTbl('<th>Line</th><th class="r">Amount</th>',body,foot,2,'This report has no lines yet.')+picker+this.repFoot(); },

  /* ---- user permissions: set_permissions / permEdit / permEd / permSave live in js/users.js ---- */

  /* ---- attachments ---- */
  set_attachments(b){ var self=this; var files=b.attachments||[];
    var used=files.reduce(function(a,f){ return a+(Number(f.size)||0); },0);
    var rows=files.map(function(f,i){ return '<tr><td>'+self.esc(f.name||'')+'</td><td>'+self.esc(f.attachedTo||'')+
      '</td><td>'+self.esc(f.date||'')+'</td><td class="r m">'+self.fmtBytes(f.size||0)+
      '</td><td class="r"><button class="dz-x" onclick="App.attachRemove('+i+')" title="Delete">✕</button></td></tr>'; }).join('');
    var inner='<div class="info-bar">Files kept with this business. They are stored in this browser alongside the records, so they count towards the same storage — keep them small, and take a Backup to move them.</div>'+
      '<label class="fld">Add a file</label><input type="file" id="atFile" onchange="App.attachAdd(this)">'+
      '<table class="reg-tbl" style="margin-top:14px"><thead><tr><th>File</th><th>Attached to</th><th>Added</th><th class="r">Size</th><th class="r"></th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="5"><div class="reg-empty">No attachments yet.</div></td></tr>')+'</tbody></table>'+
      '<div style="margin-top:10px;color:var(--muted);font-size:12.5px">'+files.length+' file'+(files.length===1?'':'s')+', '+this.fmtBytes(used)+' in total.</div>';
    return this.crumb('Settings','Attachments')+'<div class="card"><h2>Attachments</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  fmtBytes(n){ n=Number(n)||0; if(n<1024) return n+' B'; if(n<1048576) return (Math.round(n/102.4)/10)+' KB'; return (Math.round(n/104857.6)/10)+' MB'; },
  attachAdd(input){ var self=this; var f=input&&input.files&&input.files[0]; if(!f) return;
    if(f.size>2*1024*1024){ alert('That file is '+this.fmtBytes(f.size)+'. Attachments live in browser storage, so keep them under 2 MB.'); input.value=''; return; }
    var rd=new FileReader();
    rd.onload=function(){ var b=self.curBiz(); b.attachments=b.attachments||[];
      b.attachments.push({id:'at'+Date.now(),name:f.name,size:f.size,type:f.type,date:new Date().toISOString().slice(0,10),attachedTo:'Business',data:String(rd.result)});
      try{ self.saveBiz(b); }catch(e){ alert('Browser storage is full — delete an attachment or take a Backup first.'); return; }
      self.renderMain(b); };
    rd.readAsDataURL(f); },
  attachRemove(i){ var b=this.curBiz(); var f=(b.attachments||[])[i]; if(!f) return;
    if(!this._ask('Delete “'+f.name+'”? This cannot be undone.',()=>this.attachRemove(i))) return;
    b.attachments.splice(i,1); this.saveBiz(b); this.renderMain(b); },

  /* ---- obsolete features ---- */
  _obsoleteList(){ return [
    ['billableExpenses','Billable expenses','Recharging a supplier bill straight to a customer. Use a sales invoice line instead.'],
    ['multiStepIat','Multi-step inter-account transfers','Splitting a transfer into in-transit legs. A single Inter Account Transfer covers it.'],
    ['legacyStarting','Legacy starting balances','The old per-account opening-balance screen, superseded by Settings → Starting Balances.'],
    ['flatTaxCodes','Flat tax codes','Single-rate codes without components. New codes support components.'],
    ['oldThemes','Legacy form themes','Handlebars-style themes from before the visual designer.']]; },
  set_obsolete(b){ var self=this; var on=b.obsolete||{};
    var rows=this._obsoleteList().map(function(o){ return '<tr><td><label class="chk-row" style="margin:0"><input type="checkbox"'+
      (on[o[0]]?' checked':'')+' onchange="App.obsToggle(\''+o[0]+'\',this.checked)"> '+self.esc(o[1])+'</label></td>'+
      '<td style="color:var(--muted)">'+self.esc(o[2])+'</td></tr>'; }).join('');
    var n=Object.keys(on).filter(function(k){ return on[k]; }).length;
    var inner='<div class="info-bar">Features kept for businesses that already rely on them. They stay hidden unless you switch one on here.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Feature</th><th>Why it is here</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<div style="margin-top:10px;color:var(--muted);font-size:12.5px">'+(n?(n+' enabled.'):'None enabled — nothing obsolete is showing.')+'</div>';
    return this.crumb('Settings','Obsolete Features')+'<div class="card"><h2>Obsolete Features</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  obsToggle(k,on){ var b=this.curBiz(); b.obsolete=b.obsolete||{}; b.obsolete[k]=!!on; this.saveBiz(b); this.renderMain(b); },

  /* ---- extensions ---- */
  set_extensions(b){ var self=this; var list=b.extensions||[];
    var rows=list.map(function(x,i){ return '<tr><td><input type="text" style="width:100%" value="'+self.esc(x.name||'')+
      '" placeholder="Extension name" onchange="App.setListSet(\'extensions\','+i+',\'name\',this.value)"></td>'+
      '<td><input type="text" style="width:100%" value="'+self.esc(x.url||'')+'" placeholder="https://…" onchange="App.setListSet(\'extensions\','+i+',\'url\',this.value)"></td>'+
      '<td><label class="chk-row" style="margin:0"><input type="checkbox"'+(x.enabled?' checked':'')+
      ' onchange="App.extToggle('+i+',this.checked)"> Enabled</label></td>'+
      '<td class="r"><button class="dz-x" onclick="App.setListRemove(\'extensions\','+i+')">✕</button></td></tr>'; }).join('');
    var inner='<div class="info-bar">Extensions point at a page you host that reads this business over <code>postMessage</code>. Nothing is fetched until you enable one, and disabled entries are inert.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Name</th><th>URL</th><th>Status</th><th class="r"></th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="4"><div class="reg-empty">No extensions registered.</div></td></tr>')+'</tbody></table>'+
      '<button class="btn btn-sm" style="margin-top:10px" onclick="App.setListAdd(\'extensions\','+JSON.stringify(JSON.stringify({name:'',url:'',enabled:false}))+')">+ Add extension</button>';
    return this.crumb('Settings','Extensions')+'<div class="card"><h2>Extensions</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  extToggle(i,on){ var b=this.curBiz(); if(b.extensions&&b.extensions[i]){ b.extensions[i].enabled=!!on; this.saveBiz(b); this.renderMain(b); } },

  /* ---------- bank statement import ----------
     Reads CSV with a header row; the column names below are matched
     case-insensitively so most bank exports work without editing. */
  bankImportOpen(){ var b=this.curBiz(); var banks=((b.records&&b.records.bankCash)||[]).map(function(x){ return x.name; }).filter(Boolean);
    if(!banks.length){ alert('Add a bank or cash account first.'); return; }
    var self=this;
    var opts=banks.map(function(n){ return '<option>'+self.esc(n)+'</option>'; }).join('');
    var rules=(b.bankRules||[]).length;
    this._openOverlay('<div class="app-modal-h">Import bank statement</div>'+
      '<div class="app-modal-b">'+
        '<div class="info-bar">Pick a CSV exported from your bank. It needs a header row with a <b>date</b> column, a <b>description</b> column, and either <b>amount</b>, or separate <b>debit</b> and <b>credit</b> columns.</div>'+
        '<label class="fld">Account</label><select id="bi_acct">'+opts+'</select>'+
        '<label class="fld" style="margin-top:12px">CSV file</label><input type="file" id="bi_file" accept=".csv,text/csv">'+
        '<div style="margin-top:10px;color:var(--muted);font-size:12.5px">'+
          (rules? (rules+' bank rule'+(rules===1?'':'s')+' will code the lines automatically.')
                : 'No bank rules yet — lines will import uncoded. Add rules in Settings → Bank Rules.')+'</div>'+
        '<div id="bi_out" style="margin-top:12px"></div>'+
      '</div>'+
      '<div class="app-modal-f"><button class="btn btn-primary" onclick="App.bankImportRun()">Import</button>'+
      '<button class="btn" onclick="App._closeOverlay()">Cancel</button></div>'); },
  _csvRows(text){ var rows=[], row=[], cur='', q=false;
    for(var i=0;i<text.length;i++){ var ch=text[i];
      if(q){ if(ch==='"'){ if(text[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=ch; }
      else if(ch==='"') q=true;
      else if(ch===','){ row.push(cur); cur=''; }
      else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
      else if(ch!=='\r') cur+=ch; }
    if(cur!==''||row.length){ row.push(cur); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(c){ return String(c).trim()!==''; }); }); },
  _csvPick(head,names){ for(var i=0;i<head.length;i++){ var h=String(head[i]||'').trim().toLowerCase();
      for(var j=0;j<names.length;j++){ if(h===names[j]||h.indexOf(names[j])>=0) return i; } } return -1; },
  _normDate(v){ v=String(v||'').trim(); if(!v) return '';
    var m=v.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[1]+'-'+m[2]+'-'+m[3];
    m=v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(m){ var d=m[1].padStart(2,'0'), mo=m[2].padStart(2,'0'), y=m[3]; if(y.length===2) y='20'+y; return y+'-'+mo+'-'+d; }
    var t=Date.parse(v); if(!isNaN(t)) return new Date(t).toISOString().slice(0,10);
    return ''; },
  bankRuleAccount(b,desc){ var d=String(desc||'').toLowerCase(); var rules=b.bankRules||[];
    for(var i=0;i<rules.length;i++){ var m=String(rules[i].match||'').trim().toLowerCase();
      if(m && d.indexOf(m)>=0) return rules[i].account||''; }
    return ''; },
  bankImportRun(){ var self=this; var b=this.curBiz();
    var accEl=document.getElementById('bi_acct'); var fileEl=document.getElementById('bi_file');
    var out=document.getElementById('bi_out');
    var acct=accEl?accEl.value:''; var f=fileEl&&fileEl.files&&fileEl.files[0];
    if(!f){ if(out) out.innerHTML='<div class="info-bar">Choose a CSV file first.</div>'; return; }
    var rd=new FileReader();
    rd.onload=function(){
      var rows=self._csvRows(String(rd.result||''));
      if(rows.length<2){ if(out) out.innerHTML='<div class="info-bar">That file has no data rows.</div>'; return; }
      var head=rows[0];
      var di=self._csvPick(head,['date']);
      var xi=self._csvPick(head,['description','narrative','details','particulars','reference']);
      var ai=self._csvPick(head,['amount','value']);
      var dr=self._csvPick(head,['debit','withdrawal','paid out']);
      var cr=self._csvPick(head,['credit','deposit','paid in']);
      if(di<0 || (ai<0 && dr<0 && cr<0)){
        if(out) out.innerHTML='<div class="info-bar">Could not find the columns. Found: <b>'+self.esc(head.join(', '))+
          '</b>. A <i>date</i> column and either an <i>amount</i> column or <i>debit</i>/<i>credit</i> columns are required.</div>'; return; }
      var num=function(v){ var n=parseFloat(String(v==null?'':v).replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:n; };
      var rcpt=[], pay=[], skipped=0;
      for(var i=1;i<rows.length;i++){ var r=rows[i];
        var date=self._normDate(r[di]); if(!date){ skipped++; continue; }
        var desc=xi>=0?String(r[xi]||'').trim():'';
        var amt = ai>=0 ? num(r[ai]) : (num(cr>=0?r[cr]:0)-num(dr>=0?r[dr]:0));
        if(!amt){ skipped++; continue; }
        var code=self.bankRuleAccount(b,desc);
        var base={ id:Date.now()+i, uuid:self.uuid(), date:date, description:desc, imported:1,
                   lines:[{ account:code, desc:desc, amount:Math.abs(amt) }], amount:Math.abs(amt) };
        if(amt>0){ base.receivedIn=acct; base.reference=self.nextRef(b,'receipts'); rcpt.push(base); }
        else { base.paidFrom=acct; base.reference=self.nextRef(b,'payments'); pay.push(base); } }
      if(!rcpt.length && !pay.length){ if(out) out.innerHTML='<div class="info-bar">No usable rows — '+skipped+' skipped.</div>'; return; }
      b.records=b.records||{};
      /* Renumber in one pass so references stay sequential across the batch. */
      var seq=function(key,arr){ arr.forEach(function(rec){ rec.reference=self.nextRef(b,key);
        b.records[key]=(b.records[key]||[]).concat([rec]); }); };
      seq('receipts',rcpt); seq('payments',pay);
      var coded=rcpt.concat(pay).filter(function(x){ return x.lines[0].account; }).length;
      try{ refreshSummary(b); }catch(e){}
      try{ self._logActivity(b,'create','receipts',null,null,{bulkIds:rcpt.map(function(x){return x.id;}),
        label:'Bank import — '+(rcpt.length+pay.length)+' transactions into '+acct}); }catch(e){}
      self.saveBiz(b); self._closeOverlay(); self.renderWorkspace();
      setTimeout(function(){ alert('Imported '+rcpt.length+' receipt'+(rcpt.length===1?'':'s')+' and '+pay.length+
        ' payment'+(pay.length===1?'':'s')+' into '+acct+'.\n\n'+coded+' coded automatically by bank rules'+
        (skipped?('\n'+skipped+' row'+(skipped===1?'':'s')+' skipped (no date or zero amount).'):'')+
        '\n\nUncoded lines land in Suspense until you pick an account.'); },30); };
    rd.readAsText(f); },

  _ctrlMadeOptions(){ return ['Customers','Suppliers','Capital accounts','Employees','Inventory items','Fixed assets','Special accounts','Posted directly']; },
  set_control(b){ if(this.ctrlEditId!=null) return this._ctrlEditHtml(b);
    const self=this; const mov=accountMovements(b);
    const names=['Accounts receivable','Accounts payable','Cash & cash equivalents','Capital accounts','Employee clearing account','Inventory on hand','Inventory - cost','Inventory - sales','Fixed assets, at cost','Fixed assets, accumulated depreciation','Depreciation','Output VAT','Input VAT'];
    const madeOf={'accounts receivable':'Customers','accounts payable':'Suppliers','cash & cash equivalents':'Bank & cash accounts','capital accounts':'Capital accounts (members)','employee clearing account':'Employees','inventory on hand':'Inventory items','fixed assets, at cost':'Fixed assets','fixed assets, accumulated depreciation':'Fixed assets','output vat':'Tax codes (sales)','input vat':'Tax codes (purchases)'};
    const secName={assets:'Assets',liabilities:'Liabilities',equity:'Equity',pl:'Profit & Loss'};
    const seen={}; const rows=[];
    names.forEach(nm=>{ const a=(b.coa||[]).find(x=>x.type==='account'&&(x.name||'').toLowerCase()===nm.toLowerCase()); if(!a||seen[a.id]) return; seen[a.id]=1;
      const src=madeOf[(a.name||'').toLowerCase()]||'<span style="color:#aaa">Posted directly</span>';
      rows.push('<tr><td>'+this.esc(a.name)+'</td><td>'+src+'</td><td>'+this.esc(secName[acctRoot(b,a)]||acctRoot(b,a)||'')+'</td><td class="r m"><a class="led-link" onclick="App.openGL(\''+a.id+'\')">'+this.money(liveBalance(b,a,mov))+'</a></td><td class="r"><span class="ctl-sys">built-in</span></td></tr>'); });
    (b.coa||[]).filter(x=>x.type==='account'&&x.custCtrl&&!seen[x.id]).forEach(a=>{ seen[a.id]=1;
      rows.push('<tr><td>'+this.esc(a.name)+'</td><td>'+this.esc(a.madeOf||'Posted directly')+'</td><td>'+this.esc(secName[acctRoot(b,a)]||acctRoot(b,a)||'')+'</td><td class="r m"><a class="led-link" onclick="App.openGL(\''+a.id+'\')">'+this.money(liveBalance(b,a,mov))+'</a></td><td class="r" style="white-space:nowrap"><button class="btn btn-xs" onclick="App.ctrlEdit(\''+a.id+'\')">Edit</button> <button class="btn btn-xs" style="color:#c0392b;border-color:#e2b8b8" onclick="App.ctrlRemove(\''+a.id+'\')">✕</button></td></tr>'); });
    const inner='<div class="info-bar">Control accounts summarise a subledger into one line on your statements. Built-in ones are maintained automatically — customers feed Accounts receivable, suppliers feed Accounts payable, and so on. You can also add your own control accounts (e.g. for special accounts), choose what they\u2019re <b>made up of</b> and which section they sit in. Click a balance to open its general ledger.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Control account</th><th>Made up of</th><th>Section</th><th class="r">Balance</th><th class="r"></th></tr></thead><tbody>'+(rows.join('')||'<tr><td colspan="5" style="color:#aaa">No control accounts yet.</td></tr>')+'</tbody></table>'+
      '<div style="margin-top:14px"><button class="btn btn-sm btn-primary" onclick="App.ctrlAddOpen()">+ New control account</button></div>';
    return this.crumb('Settings','Control Accounts')+'<div class="card" style="max-width:820px"><h2>Control Accounts</h2>'+inner+'<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  _ctrlEditHtml(b){ const self=this; const id=this.ctrlEditId; const isNew=(id==='new'); const a=isNew?null:(b.coa||[]).find(x=>x.id===id)||null;
    const name=a?(a.name||''):''; const made=a?(a.madeOf||'Special accounts'):'Special accounts'; const sec=a?(a.parent||'assets'):'assets';
    const moOpts=this._ctrlMadeOptions().map(o=>'<option'+(made===o?' selected':'')+'>'+o+'</option>').join('');
    const secOpts=[['assets','Assets'],['liabilities','Liabilities'],['equity','Equity']].map(o=>'<option value="'+o[0]+'"'+(sec===o[0]?' selected':'')+'>'+o[1]+'</option>').join('');
    const inner='<div class="info-bar">A control account groups many subaccounts into a single line on the Balance Sheet. Choose what it\u2019s <b>made up of</b> and which section it belongs to. It appears in your Chart of Accounts and can be selected on journal &amp; voucher lines.</div>'+
      '<label class="fld">Control account name</label><input id="ctl_name" type="text" value="'+this.esc(name)+'" placeholder="e.g. Special accounts">'+
      '<label class="fld">Made up of</label><select id="ctl_made" style="min-width:220px">'+moOpts+'</select>'+
      '<label class="fld">Section</label><select id="ctl_sec" style="min-width:200px">'+secOpts+'</select>';
    return this.crumb('Settings','Control Accounts ▸ '+(isNew?'New':'Edit'))+'<div class="card" style="max-width:620px"><h2>'+(isNew?'New control account':'Edit control account')+'</h2>'+inner+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.ctrlSave()">'+(isNew?'Create':'Update')+'</button><button class="btn" onclick="App.ctrlCancel()">Cancel</button></div></div>'; },
  ctrlAddOpen(){ this.ctrlEditId='new'; this.renderMain(this.curBiz()); },
  ctrlEdit(id){ this.ctrlEditId=id; this.renderMain(this.curBiz()); },
  ctrlCancel(){ this.ctrlEditId=null; this.renderMain(this.curBiz()); },
  ctrlSave(){ const b=this.curBiz(); if(!b) return; const nm=(document.getElementById('ctl_name')||{}).value; const name=(nm||'').trim(); if(!name){ alert('Enter a name for the control account.'); return; }
    const made=(document.getElementById('ctl_made')||{}).value||'Special accounts'; const sec=(document.getElementById('ctl_sec')||{}).value||'assets';
    b.coa=b.coa||[];
    if(this.ctrlEditId==='new'){ b.coa.push({id:'a'+Math.random().toString(36).slice(2,9),type:'account',name:name,code:'',parent:sec,balance:0,control:1,custCtrl:1,madeOf:made}); }
    else { const a=b.coa.find(x=>x.id===this.ctrlEditId); if(a){ a.name=name; a.parent=sec; a.madeOf=made; a.control=1; a.custCtrl=1; } }
    try{ refreshSummary(b); }catch(e){} this.saveBiz(b); this.ctrlEditId=null; this.renderMain(b); },
  ctrlRemove(id){ const b=this.curBiz(); if(!b) return; const a=(b.coa||[]).find(x=>x.id===id); if(!a||!a.custCtrl) return; if(!this._ask('Delete control account “'+(a.name||'')+'”?',()=>this.ctrlRemove(id))) return; b.coa=b.coa.filter(x=>x.id!==id); try{ refreshSummary(b); }catch(e){} this.saveBiz(b); this.renderMain(b); },

  set_footers(b){ const d=b.details||{};
    const inner='<div class="info-bar">This footer prints at the bottom of every voucher and invoice, below the totals. Use it for thank-you notes, return policies or registration details.</div>'+
      '<label class="fld">Document footer</label><textarea id="ft_text" rows="4" placeholder="e.g. Thank you for your business.">'+this.esc(d.footer||'')+'</textarea>';
    return this.setCard('Footers',inner,'App.saveFooters()'); },
  saveFooters(){ const b=this.curBiz(); if(!b) return; b.details=Object.assign({},b.details,{footer:document.getElementById('ft_text').value}); this.saveBiz(b); this.settingsBack(); },

  set_capitalSub(b){ const caps=(b.records&&b.records.capital)||[];
    const rows=caps.map(c=>'<tr><td>'+this.esc(c.name)+'</td><td class="r m">'+this.money(capitalBalance(b,c.name))+'</td></tr>').join('');
    const inner='<div class="info-bar">Capital subaccounts are the individual members / partners whose contributions and drawings roll up into the single <b>Capital accounts</b> control account. Add or edit them from the Capital Accounts register; on receipts, payments and journals choose <b>Capital accounts</b> on a line, then pick the member.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Member</th><th class="r">Balance</th></tr></thead><tbody>'+(rows||'<tr><td colspan="2" style="color:#aaa">No capital members yet.</td></tr>')+'</tbody></table>'+
      '<div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="App.selectSection(\'Capital Accounts\')">Open Capital Accounts</button></div>';
    return this.crumb('Settings','Capital Subaccounts')+'<div class="card" style="max-width:560px"><h2>Capital Subaccounts</h2>'+inner+'<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },

  set_startingBalances(b){ const accts=(b.coa||[]).filter(x=>x.type==='account');
    const rows=accts.map(a=>'<tr><td>'+this.esc(a.name)+'</td><td style="text-align:right"><input type="text" inputmode="decimal" id="sb_'+a.id+'" value="'+(a.balance?this.esc(a.balance):'')+'" placeholder="0.00" style="width:150px;text-align:right;padding:4px 6px;border:1px solid var(--line);border-radius:5px"></td></tr>').join('');
    const inner='<div class="info-bar">Opening balances are what each account carried on your accounting start date — they drive the “brought forward” figure in statements. Customer, supplier, bank and capital opening balances are entered on those individual records.</div>'+
      '<table class="reg-tbl"><thead><tr><th>Account</th><th class="r">Opening balance</th></tr></thead><tbody>'+(rows||'<tr><td colspan="2">No accounts yet — create them in Chart of Accounts.</td></tr>')+'</tbody></table>';
    return this.crumb('Settings','Starting Balances')+'<div class="card" style="max-width:640px"><h2>Starting Balances</h2>'+inner+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.saveStartingBalances()">Update</button><button class="btn" onclick="App.settingsBack()">Cancel</button></div></div>'; },
  saveStartingBalances(){ const b=this.curBiz(); if(!b) return; (b.coa||[]).filter(x=>x.type==='account').forEach(a=>{ const el=document.getElementById('sb_'+a.id); if(el) a.balance=this.parseNum(el.value)||0; }); this.saveBiz(b); refreshSummary(b); this.settingsBack(); },

  /* ---------- Custom Themes (form / voucher / statement formatting) ---------- */
  crumbThemes(sub){ return '<div class="ws-crumb"><div class="left">'+App._crumbIco('settings')+' ▸ <a class="led-link" onclick="App.settingsBack()">Settings</a> ▸ <a class="led-link" onclick="App.openThemesHub()">Custom Themes</a>'+(sub?' ▸ '+this.esc(sub):'')+'</div></div>'; },
  openThemesHub(){ this.fmtCat=null; this.fmtForm=null; this.fmtDraft=null; this.fmtSel=null; this.fmtColMenu=false; this._drag=null; this.renderMain(this.curBiz()); },
  openFmtCat(cat){ this.fmtCat=cat; this.fmtForm=null; this.fmtDraft=null; this.fmtSel=null; this.fmtColMenu=false; this._drag=null; this.renderMain(this.curBiz()); },
  openFmtForm(key){ this._fedReturn=this._snapNav(); this.fmtForm=key; this.fmtCat=this.fmtCat||this.fmtCatOf(key); this.fmtSel=null; this.fmtColMenu=false; this._drag=null; this._vbSel=null; this.renderMain(this.curBiz()); var self=this; setTimeout(function(){ self._mountInlineDesigner(key); },0); },
  _snapNav(){ var f=['view','wsMode','wsSection','wsSub','setView','fmtCat','fmtForm','repView','editingId','ledgerId','glAcctId','glTab','statementReturn','ledgerReturn','glReturn']; var o={}; var self=this; f.forEach(function(k){ o[k]=self[k]; }); return o; },
  _restoreNav(s){ if(!s){ try{ this.openFmtCat(this.fmtCat||this.fmtCatOf(this.fmtForm)); }catch(e){} return; } var self=this; Object.keys(s).forEach(function(k){ self[k]=s[k]; }); this.fmtDraft=null; this.fmtSel=null; this._drag=null; try{ if(this.view && this.view!=='workspace'){ this.go(this.view); } else { this.renderMain(this.curBiz()); } }catch(e){ try{ this.renderMain(this.curBiz()); }catch(_){} } },
  fmtDirty(){ const b=this.curBiz(); const key=this.fmtForm; if(!key||!this.fmtDraft) return false; return JSON.stringify((b.formConfig&&b.formConfig[key])||null)!==JSON.stringify(this.fmtDraft); },
  fmtSave(b){ if(this.fmtForm && this.fmtDraft && this.wsMode==='settings') return; this.saveBiz(b); },
  commitFmtForm(){ const b=this.curBiz(); const key=this.fmtForm; if(!key||!this.fmtDraft) return; b.formConfig=b.formConfig||{}; b.formConfig[key]=JSON.parse(JSON.stringify(this.fmtDraft)); this.saveBiz(b); this.fmtDraft=JSON.parse(JSON.stringify(b.formConfig[key])); this.renderMain(b); },
  discardFmtForm(){ const b=this.curBiz(); const key=this.fmtForm; this.fmtDraft=null; this.cfgEnsure(b,key); this.entryOrderFor(b,key); this.gridFor(b,key); this.fmtDraft=JSON.parse(JSON.stringify(b.formConfig[key])); this.fmtSel=null; this.fmtColMenu=false; this.renderMain(b); },
  backFromFmtForm(){ if(this.fmtDirty() && !this._ask('You have unsaved changes. Discard them and leave?',()=>this.backFromFmtForm())) return; this.fmtDraft=null; this.openFmtCat(this.fmtCat); },
  set_themes(b){
    if(this.fmtForm){ return this.advDesignerHtml(b,this.fmtForm); }
    if(this.fmtCat==='form') return this.crumbThemes('Form Formatting')+'<div class="info-bar">Pick a form to customise its printed layout — choose which fields print, reorder &amp; resize line-item columns, and add your own custom fields.</div>'+this.formListHtml(b,'form')+'<div class="form-actions"><button class="btn" onclick="App.openThemesHub()">◀ Back to Custom Themes</button></div>';
    if(this.fmtCat==='voucher') return this.crumbThemes('Voucher Formatting')+'<div class="info-bar">Customise receipt &amp; payment vouchers — printed fields, line columns and custom fields.</div>'+this.formListHtml(b,'voucher')+'<div class="form-actions"><button class="btn" onclick="App.openThemesHub()">◀ Back to Custom Themes</button></div>';
    if(this.fmtCat==='records') return this.crumbThemes('Record Forms')+'<div class="info-bar">Customise the data-entry forms for customers, suppliers, bank &amp; cash accounts, inventory items, fixed assets and employees — arrange fields and add your own custom fields (they appear on the actual form).</div>'+this.formListHtml(b,'records')+'<div class="form-actions"><button class="btn" onclick="App.openThemesHub()">◀ Back to Custom Themes</button></div>';
    if(this.fmtCat==='ledger') return this.crumbThemes('Accounting Forms')+'<div class="info-bar">Customise journal entries, payslips and depreciation entries — arrange fields, see their line columns, and add custom fields.</div>'+this.formListHtml(b,'ledger')+'<div class="form-actions"><button class="btn" onclick="App.openThemesHub()">◀ Back to Custom Themes</button></div>';
    if(this.fmtCat==='statement') return this.statementFmtHtml(b);
    const cat=(ic,nm,key,ds)=>'<button class="set-tile" onclick="App.openFmtCat(\''+key+'\')"><span class="ico">'+ic+'</span><span><span class="nm">'+this.esc(nm)+'</span><span class="ds">'+this.esc(ds)+'</span></span></button>';
    return this.crumb('Settings','Custom Theme')+'<div class="info-bar">Two layout themes to customise: <b>Form Formatting</b> for your sales &amp; purchase documents, and <b>Voucher</b> for receipt &amp; payment vouchers. Changes save when you click Update and apply next time you open or print that document.</div>'+
      '<div class="set-grid">'+
        cat('🧾','Form Formatting','form','Pick a form — sales / purchase invoices, quotes, orders, credit &amp; debit notes, delivery &amp; goods receipts')+
        cat('💳','Voucher','voucher','Receipt &amp; payment voucher theme')+
      '</div>'; },
  fmtFormName(key){ const r=REG[key]||{}; return r.singular||r.label||({deliveryNotes:'Delivery Note'}[key])||key; },
  formListHtml(b,cat){ const map={ voucher:['receipts','payments','expenseClaims'],
      form:['salesInv','purchInv','salesQuotes','purchQuotes','salesOrders','purchOrders','creditNotes','debitNotes','deliveryNotes','goodsRec'],
      records:['customers','suppliers','bankCash','inventory','nonInvItems','fixedAssets','intangibles','investments','employees','special','capital'],
      ledger:['journal','payslips','depreciation','amortization','invTransfers','invWriteOffs','production','bankRec'] };
    const forms=map[cat]||map.form; const isDoc=(cat==='form'||cat==='voucher'); const ds=isDoc?'Printed fields, columns &amp; custom fields':'Form fields &amp; custom fields';
    const tiles=forms.filter(k=>REG[k]||this.formSchema(k)).map(k=>{ const nm=this.fmtFormName(k); const cfg=b.formConfig&&b.formConfig[k];
      const tag=cfg?'<span class="fmt-tag">customised</span>':''; return '<button class="set-tile" onclick="App.openFmtForm(\''+k+'\')"><span class="ico">📄</span><span><span class="nm">'+this.esc(nm)+tag+'</span><span class="ds">'+ds+'</span></span></button>'; }).join('');
    return '<div class="set-grid">'+tiles+'</div>'; },

  /* ===== Word-style voucher editor ===== */
  voucherWordEditorHtml(b,key){ const nm=this.fmtFormName(key); const cfg=this.cfgEnsure(b,key)||{};
    const docHtml=(cfg.docHtml&&cfg.docHtml.trim())?cfg.docHtml:this.wpDefaultDoc(b,key);
    const pw=(cfg.docPage&&cfg.docPage.size==='Letter')?'816px':'794px';
    const toks=this.wpTokens(b,key);
    const close="this.closest('details').open=false";
    const insertMenu='<details class="wp-menu"><summary>Insert ▾</summary><div class="wp-menu-pop"><div class="wp-mi-h">Voucher content</div>'+
      toks.map(t=>'<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpInsertTok(\''+t.tok+'\');'+close+'"><span class="ic">'+t.ic+'</span>'+this.esc(t.label)+'</button>').join('')+
      '<div class="wp-mi-h">Elements</div>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpInsertHTML(\'<hr>\');'+close+'"><span class="ic">―</span>Horizontal line</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpInsertTable();'+close+'"><span class="ic">▦</span>Blank table (3×3)</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpInsertHTML(\'&nbsp;&nbsp;&nbsp;&nbsp;\');'+close+'"><span class="ic">⇥</span>Tab spacer</button>'+
      '</div></details>';
    const formatMenu='<details class="wp-menu"><summary>Format ▾</summary><div class="wp-menu-pop">'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpFormatBlock(\'H1\');'+close+'">Heading 1</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpFormatBlock(\'H2\');'+close+'">Heading 2</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpFormatBlock(\'P\');'+close+'">Normal text</button>'+
      '<div class="wp-mi-h">Line spacing</div>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpLineHeight(\'1.15\');'+close+'">Single</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpLineHeight(\'1.6\');'+close+'">1.5 lines</button>'+
      '<button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpLineHeight(\'2\');'+close+'">Double</button>'+
      '<div class="wp-mi-h"></div><button class="wp-mi" onmousedown="App.wpSaveSel()" onclick="App.wpCmd(\'removeFormat\');'+close+'">Clear formatting</button>'+
      '</div></details>';
    const pageMenu='<details class="wp-menu"><summary>Page ▾</summary><div class="wp-menu-pop">'+
      '<button class="wp-mi" onclick="App.wpSetPage(\'size\',\'A4\');'+close+'">A4 (210 × 297mm)</button>'+
      '<button class="wp-mi" onclick="App.wpSetPage(\'size\',\'Letter\');'+close+'">US Letter (8.5 × 11in)</button>'+
      '</div></details>';
    const fonts=['Calibri','Arial','Times New Roman','Georgia','Verdana','Tahoma','Courier New','Segoe UI'];
    const fontSel='<select title="Font" onchange="App.wpCmd(\'fontName\',this.value)"><option value="" selected>Font</option>'+fonts.map(f=>'<option value="'+this.esc(f)+'">'+this.esc(f)+'</option>').join('')+'</select>';
    const sizeSel='<select title="Font size" onchange="App.wpCmd(\'fontSize\',this.value)"><option value="" selected>Size</option><option value="1">8 pt</option><option value="2">10 pt</option><option value="3">12 pt</option><option value="4">14 pt</option><option value="5">18 pt</option><option value="6">24 pt</option><option value="7">36 pt</option></select>';
    const B=(cmd,inner,title)=>'<button class="wp-b" title="'+title+'" onmousedown="return false" onclick="App.wpCmd(\''+cmd+'\')">'+inner+'</button>';
    const ribbon='<div class="wp-ribbon">'+fontSel+sizeSel+'<span class="wp-sep"></span>'+
      B('bold','<b style="font-weight:700">B</b>','Bold')+B('italic','<i style="font-style:italic">I</i>','Italic')+B('underline','<u>U</u>','Underline')+B('strikeThrough','<s>S</s>','Strikethrough')+
      '<span class="wp-sep"></span>'+
      '<label class="wp-b" title="Text colour" onmousedown="return false">A<input type="color" value="#222222" onchange="App.wpCmd(\'foreColor\',this.value)"></label>'+
      '<label class="wp-b" title="Highlight colour" onmousedown="return false">▰<input type="color" value="#ffff00" onchange="App.wpHilite(this.value)"></label>'+
      '<span class="wp-sep"></span>'+
      B('justifyLeft','L','Align left')+B('justifyCenter','C','Centre')+B('justifyRight','R','Align right')+B('justifyFull','J','Justify')+
      '<span class="wp-sep"></span>'+
      B('insertUnorderedList','•','Bulleted list')+B('insertOrderedList','1.','Numbered list')+B('outdent','⇤','Decrease indent')+B('indent','⇥','Increase indent')+
      '<span class="wp-sep"></span>'+
      B('undo','↶','Undo')+B('redo','↷','Redo')+
      '</div>';
    return this.crumbThemes(nm)+
      '<div class="card" style="max-width:1000px"><h2>'+this.esc(nm)+' \u2014 voucher designer</h2>'+
      '<div class="info-bar">Design the printed '+this.esc(nm)+' like a Word page. Type freely, format with the toolbar, and use <b>Insert ▾</b> to drop in any voucher field (date, reference, amount, line-items table, signature\u2026). Live values fill in automatically when you view or print a real '+this.esc(nm)+'. Changes save as you type.</div>'+
      '<div class="wp-wrap">'+
        '<div class="wp-menubar">'+insertMenu+formatMenu+pageMenu+'<span style="flex:1"></span><span class="wp-status" id="wpStatus">✓ Saved</span></div>'+
        ribbon+
        '<div class="wp-canvas"><div class="wp-page" id="wpPage" style="width:'+pw+'" contenteditable="true" spellcheck="true" oninput="App.wpAutoSave()" onkeyup="App.wpSaveSel()" onmouseup="App.wpSaveSel()">'+docHtml+'</div></div>'+
      '</div>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.wpSaveNow(false)">Save</button>'+
        '<button class="btn" onclick="App.wpResetDoc()">Reset to default layout</button>'+
        '<span style="flex:1"></span><button class="btn" onclick="App.wpBack()">◀ Back to vouchers</button></div>'+
      '</div>'; },
  wpBack(){ this.fmtDraft=null; this.fmtForm=null; this._wpSel=null; this.openFmtCat(this.fmtCat||'voucher'); },
  wpTokens(b,key){ const isR=(key==='receipts'); const base=[
      {tok:'businessName',label:'Business name',ic:'🏢'},{tok:'bizAddress',label:'Business name & address',ic:'🏠'},
      {tok:'logo',label:'Business logo',ic:'🖼️'},{tok:'trn',label:'Tax number (TRN)',ic:'#'},
      {tok:'title',label:'Document title',ic:'🏷️'},{tok:'recipient',label:(isR?'Received from (name)':'Paid to (name)'),ic:'👤'},
      {tok:'bankAccount',label:(isR?'Received in (account)':'Paid from (account)'),ic:'🏦'},{tok:'date',label:'Date',ic:'📅'},
      {tok:'reference',label:'Reference / number',ic:'#'},{tok:'description',label:'Description',ic:'✎'},
      {tok:'linesTable',label:'Line items table',ic:'▦'},{tok:'amount',label:'Total amount',ic:'💰'},
      {tok:'amountWords',label:'Amount in words',ic:'🔤'},{tok:'signature',label:'Signature line',ic:'✍'},{tok:'footer',label:'Footer text',ic:'⤓'}];
    const cf=((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='field'&&x.label).map(x=>({tok:'custom:'+x.key,label:x.label+' (custom)',ic:'＋'}));
    return base.concat(cf); },
  wpTokChipHtml(b,key,tok){ const isR=(key==='receipts');
    if(tok==='logo') return '<div class="wp-block wp-tok" data-tok="logo" contenteditable="false"><span class="wp-logo-ph">LOGO</span></div>';
    if(tok==='bizAddress') return '<div class="wp-block wp-tok" data-tok="bizAddress" contenteditable="false">Business name &amp; address</div>';
    if(tok==='linesTable') return '<div class="wp-block wp-tok" data-tok="linesTable" contenteditable="false">'+this.wpLinesSampleHtml()+'</div>';
    if(tok==='signature') return '<div class="wp-block wp-tok" data-tok="signature" contenteditable="false">'+this.wpSignHtml()+'</div>';
    const L={ businessName:'Business name', trn:'Tax number (TRN)', title:(isR?'RECEIPT':'PAYMENT VOUCHER'), date:'Date', reference:'Reference', recipient:(isR?'Received from':'Paid to'), bankAccount:(isR?'Received in':'Paid from'), description:'Description', amount:'Amount', amountWords:'Amount in words', footer:'Footer text' };
    let label=L[tok]; if(tok.indexOf('custom:')===0){ const x=((this.formCfg(b,key)||{}).custom||[]).find(c=>c.key===tok.slice(7)); label=(x&&x.label)||'Custom field'; }
    return '<span class="wp-tok" data-tok="'+this.esc(tok)+'" contenteditable="false">'+this.esc(label||tok)+'</span>'; },
  wpLinesSampleHtml(){ return '<table class="wp-lines"><thead><tr><th>Account</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody><tr><td>Account name</td><td>Line description</td><td class="r">0.00</td></tr><tr><td colspan="2" style="text-align:right;font-weight:700">Total</td><td class="r" style="font-weight:700">0.00</td></tr></tbody></table>'; },
  wpSignHtml(){ return '<table style="width:100%;margin-top:42px;border:0"><tr><td style="border:0;border-top:1px solid #444;padding-top:5px;text-align:center;width:42%;font-size:13px">Received by</td><td style="border:0"></td><td style="border:0;border-top:1px solid #444;padding-top:5px;text-align:center;width:42%;font-size:13px">Authorised signature</td></tr></table>'; },
  wpDefaultDoc(b,key){ const isR=(key==='receipts'); const C=t=>this.wpTokChipHtml(b,key,t);
    return '<table style="width:100%;border:0;margin-bottom:6px"><tr>'+
        '<td style="border:0;vertical-align:top">'+C('bizAddress')+'<div style="margin-top:4px">'+C('trn')+'</div></td>'+
        '<td style="border:0;text-align:right;vertical-align:top">'+C('logo')+'</td></tr></table>'+
      '<h1 style="text-align:center;letter-spacing:1px;margin:6px 0 14px">'+C('title')+'</h1>'+
      '<table style="width:100%;border:0;margin-bottom:6px"><tbody>'+
        '<tr><td style="border:0;padding:2px 0"><b>'+(isR?'Received from:':'Paid to:')+'</b> '+C('recipient')+'</td><td style="border:0;padding:2px 0;text-align:right"><b>Date:</b> '+C('date')+'</td></tr>'+
        '<tr><td style="border:0;padding:2px 0"><b>'+(isR?'Received in:':'Paid from:')+'</b> '+C('bankAccount')+'</td><td style="border:0;padding:2px 0;text-align:right"><b>Reference:</b> '+C('reference')+'</td></tr>'+
      '</tbody></table>'+
      '<p><b>Description:</b> '+C('description')+'</p>'+
      C('linesTable')+
      '<p style="font-size:13px;margin-top:6px"><b>Amount in words:</b> '+C('amountWords')+'</p>'+
      C('signature')+
      '<p style="text-align:center;color:#888;font-size:12px;margin-top:28px">'+C('footer')+'</p>'; },
  wpSaveSel(){ try{ const s=window.getSelection(); if(s&&s.rangeCount){ const r=s.getRangeAt(0); const p=document.getElementById('wpPage'); if(p&&p.contains(r.commonAncestorContainer)) this._wpSel=r.cloneRange(); } }catch(_){ } },
  wpRestoreSel(){ const p=document.getElementById('wpPage'); if(p) p.focus(); try{ if(this._wpSel){ const s=window.getSelection(); s.removeAllRanges(); s.addRange(this._wpSel); } }catch(_){ } },
  wpCmd(cmd,val){ this.wpRestoreSel(); try{ document.execCommand('styleWithCSS',false,true); }catch(_){ } try{ document.execCommand(cmd,false,val); }catch(_){ } this.wpSaveSel(); this.wpAutoSave(); },
  wpHilite(val){ this.wpRestoreSel(); try{ document.execCommand('styleWithCSS',false,true); }catch(_){ } if(!document.execCommand('hiliteColor',false,val)){ try{ document.execCommand('backColor',false,val); }catch(_){ } } this.wpSaveSel(); this.wpAutoSave(); },
  wpFormatBlock(t){ this.wpRestoreSel(); try{ if(!document.execCommand('formatBlock',false,t)) document.execCommand('formatBlock',false,'<'+t+'>'); }catch(_){ } this.wpSaveSel(); this.wpAutoSave(); },
  wpLineHeight(v){ this.wpRestoreSel(); try{ const s=window.getSelection(); if(s&&s.rangeCount){ let n=s.getRangeAt(0).commonAncestorContainer; if(n.nodeType===3) n=n.parentNode; const p=document.getElementById('wpPage'); while(n&&n!==p&&!/^(P|H1|H2|DIV|LI|TD)$/.test(n.nodeName)) n=n.parentNode; if(n&&n!==p) n.style.lineHeight=v; } }catch(_){ } this.wpAutoSave(); },
  wpInsertTok(tok){ this.wpInsertHTML(this.wpTokChipHtml(this.curBiz(),this.fmtForm,tok)); },
  wpInsertHTML(html){ const p=document.getElementById('wpPage'); if(!p) return; this.wpRestoreSel();
    try{ document.execCommand('insertHTML',false,html+'\u200b'); }
    catch(_){ try{ const s=window.getSelection(); if(s&&s.rangeCount){ const r=s.getRangeAt(0); r.deleteContents(); const tmp=document.createElement('div'); tmp.innerHTML=html; const frag=document.createDocumentFragment(); let n; while((n=tmp.firstChild)) frag.appendChild(n); r.insertNode(frag); } }catch(__){ p.innerHTML+=html; } }
    this.wpSaveSel(); this.wpAutoSave(); },
  wpInsertTable(){ let h='<table class="wp-lines"><tbody>'; for(let r=0;r<3;r++){ h+='<tr>'; for(let c=0;c<3;c++) h+='<td>&nbsp;</td>'; h+='</tr>'; } h+='</tbody></table><p>&nbsp;</p>'; this.wpInsertHTML(h); },
  wpSetPage(prop,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,this.fmtForm); c.docPage=c.docPage||{size:'A4'}; c.docPage[prop]=val; const p=document.getElementById('wpPage'); if(p&&prop==='size') p.style.width=(val==='Letter'?'816px':'794px'); this.saveBiz(b); this.wpSaveNow(true); },
  wpAutoSave(){ clearTimeout(this._wpTimer); const s=document.getElementById('wpStatus'); if(s){ s.textContent='Saving…'; s.style.color='var(--warn)'; } this._wpTimer=setTimeout(()=>this.wpSaveNow(true),700); },
  wpSaveNow(silent){ const b=this.curBiz(); const p=document.getElementById('wpPage'); if(!p||!this.fmtForm) return; const c=this.cfgEnsure(b,this.fmtForm); c.docHtml=p.innerHTML; if(!c.docPage) c.docPage={size:'A4'}; this.saveBiz(b); const s=document.getElementById('wpStatus'); if(s){ s.textContent=silent?'✓ Saved':'✓ All changes saved'; s.style.color='var(--success)'; } },
  wpResetDoc(){ if(!this._ask('Reset this voucher to the default layout? Your custom design will be replaced.',()=>this.wpResetDoc())) return; const b=this.curBiz(); const def=this.wpDefaultDoc(b,this.fmtForm); const p=document.getElementById('wpPage'); if(p) p.innerHTML=def; const c=this.cfgEnsure(b,this.fmtForm); c.docHtml=def; this.saveBiz(b); const s=document.getElementById('wpStatus'); if(s){ s.textContent='✓ Reset to default'; s.style.color='var(--success)'; } },
  amountInWords(n,cur){ n=Number(n)||0; const neg=n<0; n=Math.abs(n); const whole=Math.floor(n); const cents=Math.round((n-whole)*100);
    const ones=['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
    const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
    const sub=x=>{ let s=''; if(x>=100){ s+=ones[Math.floor(x/100)]+' hundred'; x%=100; if(x) s+=' '; } if(x>=20){ s+=tens[Math.floor(x/10)]; x%=10; if(x) s+='-'+ones[x]; } else if(x>0) s+=ones[x]; return s; };
    const grp=['','thousand','million','billion']; let words; if(whole===0) words='zero'; else { let parts=[],x=whole,gi=0; while(x>0){ const cc=x%1000; if(cc) parts.unshift(sub(cc)+(grp[gi]?' '+grp[gi]:'')); x=Math.floor(x/1000); gi++; } words=parts.join(' '); }
    words=words.charAt(0).toUpperCase()+words.slice(1);
    let out=(cur?cur+' ':'')+words+(cents?(' and '+(cents<10?'0':'')+cents+'/100'):' only'); return (neg?'Minus ':'')+out; },
  wpTokValue(b,rec,key,tok){ const d=b.details||{}; const e=s=>this.esc(s==null?'':s); const isR=(key==='receipts');
    if(tok==='businessName') return e(b.name||d.company||'');
    if(tok==='bizAddress'){ const co=e(b.name||d.company||''); const addr=[d.address,d.phone,d.email].filter(Boolean).map(e).join('<br>'); return '<strong>'+co+'</strong>'+(addr?'<br>'+addr:''); }
    if(tok==='trn') return d.taxNumber?('TRN No: '+e(d.taxNumber)):'';
    if(tok==='logo') return d.logo?('<img src="'+e(d.logo)+'" alt="" style="max-height:64px">'):'';
    if(tok==='title') return e(((REG[key]||{}).singular)||(isR?'Receipt':'Payment'));
    if(tok==='date') return e(this.fmtDateUS(rec.date));
    if(tok==='reference') return e(rec.reference||'');
    if(tok==='recipient') return e((isR?rec.paidBy:rec.payee)||'');
    if(tok==='bankAccount') return e((isR?rec.receivedIn:rec.paidFrom)||'');
    if(tok==='description') return e(rec.description||'').split('\n').join('<br>');
    if(tok==='amount') return this.money(rec.amount);
    if(tok==='amountWords') return e(this.amountInWords(rec.amount,(d.currency||b.currency||'')));
    if(tok==='linesTable') return this.wpLinesRenderHtml(b,rec,key);
    if(tok==='signature') return this.wpSignHtml();
    if(tok==='footer') return e(d.footer||'').split('\n').join('<br>');
    if(tok.indexOf('custom:')===0){ const k=tok.slice(7); return e(rec.custom&&rec.custom[k]!=null?rec.custom[k]:''); }
    return ''; },
  wpLinesRenderHtml(b,rec,key){ const e=s=>this.esc(s==null?'':s); const lns=rec.lines||[]; let amt=0; lns.forEach(l=>amt+=this.parseNum(l.amount)||0);
    const an=id=>{ const a=acctById(b,id); return a?a.name:(id||''); }; const anySub=lns.some(l=>l.sub);
    const head='<tr><th>Account</th>'+(anySub?'<th>Customer / Supplier</th>':'')+'<th>Description</th><th class="r">Amount</th></tr>';
    const rows=lns.map(l=>'<tr><td>'+e(an(l.account))+'</td>'+(anySub?'<td>'+e(l.sub||'')+'</td>':'')+'<td>'+e(l.desc||'')+'</td><td class="r">'+this.money(l.amount)+'</td></tr>').join('');
    const tot='<tr><td colspan="'+(anySub?3:2)+'" style="text-align:right;font-weight:700">Total</td><td class="r" style="font-weight:700">'+this.money(rec.amount!=null?rec.amount:amt)+'</td></tr>';
    return '<table class="wp-lines"><thead>'+head+'</thead><tbody>'+rows+tot+'</tbody></table>'; },
  wpRenderDoc(b,rec,key){ const c=(b.formConfig&&b.formConfig[key])||{}; let html=c.docHtml||''; const self=this;
    html=html.replace(/<(span|div)\b[^>]*\bdata-tok="([^"]+)"[^>]*>[\s\S]*?<\/\1>/g, function(m,tag,tok){ return self.wpTokValue(b,rec,key,tok); });
    const cls=(c.docPage&&c.docPage.size==='Letter')?'wp-print wp-letter':'wp-print';
    return '<div class="'+cls+'">'+html+'</div>'; },

  /* ===== Voucher theme editor (block based, form-driven) ===== */
  _vbUid(){ return 'b'+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36); },
  vbCfg(){ const b=this.curBiz(); b.formConfig=b.formConfig||{}; if(!b.formConfig[this.fmtForm]) b.formConfig[this.fmtForm]={show:{},cols:[],custom:[]}; return b.formConfig[this.fmtForm]; },
  vbModel(){ const c=this.vbCfg(); if(!c.vdoc||c.vdoc.mode!=='stack'||!Array.isArray(c.vdoc.blocks)) c.vdoc=this.vbDefaultModel(this.curBiz(),this.fmtForm); return c.vdoc; },
  vbBlk(id){ return this.vbModel().blocks.find(x=>x.id===id); },
  vbDefaultModel(b,key){ const isR=(key==='receipts'); const B=[]; let n=1; const add=o=>{ o.id='b'+(n++); B.push(o); };
    add({type:'logo',align:'right'});
    add({type:'field',tok:'bizAddress',size:14,bold:1,align:'left'});
    add({type:'field',tok:'trn',size:12,align:'left'});
    add({type:'heading',text:(isR?'RECEIPT':'PAYMENT VOUCHER'),size:24,bold:1,align:'center'});
    add({type:'divider',color:'#333333',thickness:1});
    add({type:'row',left:{tok:'recipient',prefix:(isR?'Received from: ':'Paid to: ')},right:{tok:'date',prefix:'Date: '},size:15});
    add({type:'row',left:{tok:'bankAccount',prefix:(isR?'Received in: ':'Paid from: ')},right:{tok:'reference',prefix:'Reference: '},size:15});
    add({type:'field',tok:'description',prefix:'Description: ',size:15,align:'left'});
    add({type:'lines'});
    add({type:'field',tok:'amountWords',prefix:'Amount in words: ',size:13,align:'left'});
    add({type:'spacer',height:30});
    add({type:'signature'});
    add({type:'field',tok:'footer',size:12,align:'center',color:'#888888'});
    return {mode:'stack',blocks:B}; },
  vbTokLabel(b,key,tok){ if(!tok) return 'value'; if(tok.indexOf('custom:')===0){ const x=((this.formCfg(b,key)||{}).custom||[]).find(c=>c.key===tok.slice(7)); return (x&&x.label)||'Custom'; } const t=this.wpTokens(b,key).find(z=>z.tok===tok); return t?t.label:tok; },
  vbValOrPh(b,rec,key,tok,ph){ const v=rec?this.wpTokValue(b,rec,key,tok):''; if(v!=null && String(v).replace(/<[^>]*>/g,'').trim()!=='') return v; return ph?('<span class="vb-ph-inline">\u2039'+this.esc(this.vbTokLabel(b,key,tok))+'\u203a</span>'):''; },
  vbBlockRender(blk,b,rec,key,ph){ const e=s=>this.esc(s==null?'':s); const sz=blk.size||15; const al=blk.align||'left'; const col=blk.color?(';color:'+blk.color):''; const fw=blk.bold?';font-weight:700':''; const fi=blk.italic?';font-style:italic':''; const fu=blk.underline?';text-decoration:underline':'';
    const bs='font-size:'+sz+'px;text-align:'+al+col+fw+fi+fu;
    if(blk.type==='heading') return '<div style="'+bs+';line-height:1.15;margin:6px 0">'+e(blk.text||'')+'</div>';
    if(blk.type==='text') return '<div style="'+bs+';margin:4px 0">'+e(blk.text||'').split('\n').join('<br>')+'</div>';
    if(blk.type==='field'){ const pre=blk.prefix?('<b>'+e(blk.prefix)+'</b>'):''; return '<div style="'+bs+';margin:3px 0">'+pre+this.vbValOrPh(b,rec,key,blk.tok,ph)+'</div>'; }
    if(blk.type==='row'){ const L=blk.left||{},R=blk.right||{}; const cell=o=>{ const pre=o.prefix?('<b>'+e(o.prefix)+'</b>'):''; return o.tok?(pre+this.vbValOrPh(b,rec,key,o.tok,ph)):e(o.text||''); };
      return '<table style="width:100%;border:0;margin:3px 0;font-size:'+sz+'px'+col+'"><tr><td style="border:0;padding:0;text-align:left">'+cell(L)+'</td><td style="border:0;padding:0;text-align:right">'+cell(R)+'</td></tr></table>'; }
    if(blk.type==='lines') return rec?this.wpLinesRenderHtml(b,rec,key):this.wpLinesSampleHtml();
    if(blk.type==='divider') return '<hr style="border:0;border-top:'+(blk.thickness||1)+'px solid '+(blk.color||'#444')+';margin:8px 0">';
    if(blk.type==='signature') return this.wpSignHtml();
    if(blk.type==='logo'){ const img=rec?(this.wpTokValue(b,rec,key,'logo')||''):''; const inner=img||(ph?'<span class="vb-ph-inline">\u2039logo\u203a</span>':''); return '<div style="text-align:'+al+';margin:4px 0">'+inner+'</div>'; }
    if(blk.type==='spacer') return '<div style="height:'+(blk.height||20)+'px"></div>';
    return ''; },
  vbPreviewHtml(b,key){ const m=this.vbModel(); const rec=this.fmtSampleRec(b,key); return m.blocks.map(blk=>this.vbBlockRender(blk,b,rec,key,true)).join(''); },
  vbRenderDoc(b,rec,key){ const c=(b.formConfig&&b.formConfig[key])||{}; const m=c.vdoc; if(!m||m.mode!=='stack'||!Array.isArray(m.blocks)) return null;
    return '<div class="vb-print">'+m.blocks.map(blk=>this.vbBlockRender(blk,b,rec,key,false)).join('')+'</div>'; },
  vbCodeHtml(){ const m=this.vbModel(); const line=blk=>{ const sz=blk.size||15,al=blk.align||'left'; const sty='font-size:'+sz+'px;text-align:'+al+(blk.bold?';font-weight:700':'')+(blk.color?(';color:'+blk.color):'');
      if(blk.type==='heading'||blk.type==='text') return '  <div style="'+sty+'">'+(blk.text||'')+'</div>';
      if(blk.type==='field') return '  <div style="'+sty+'">'+(blk.prefix||'')+'{{'+(blk.tok||'')+'}}</div>';
      if(blk.type==='row'){ const L=blk.left||{},R=blk.right||{}; const c2=o=>o.tok?((o.prefix||'')+'{{'+o.tok+'}}'):(o.text||''); return '  <div style="display:flex;justify-content:space-between;font-size:'+sz+'px"><span>'+c2(L)+'</span><span>'+c2(R)+'</span></div>'; }
      if(blk.type==='lines') return '  {{lineItemsTable}}'; if(blk.type==='logo') return '  {{logo}}'; if(blk.type==='signature') return '  {{signature}}'; if(blk.type==='divider') return '  <hr>'; if(blk.type==='spacer') return '  <div style="height:'+(blk.height||20)+'px"></div>'; return ''; };
    return '<div class="voucher">\n'+m.blocks.map(line).join('\n')+'\n</div>'; },
  vbEditorHtml(b,key){ const nm=this.fmtFormName(key); this.cfgEnsure(b,key); this.vbModel();
    return this.crumbThemes(nm)+
      '<div class="card" style="max-width:1500px"><h2>'+this.esc(nm)+' \u2014 voucher theme editor</h2>'+
      '<div class="info-bar">Build your '+this.esc(nm)+' from blocks. Use <b>Add content from form</b> to drop in any field (date, reference, amount, line items\u2026), type your own headings &amp; text, set font size, alignment and colour, and reorder with the \u25b2\u25bc arrows. The preview on the right uses sample data \u2014 real values fill in when you view or print a '+this.esc(nm)+'.</div>'+
      this.vbToolbarHtml(b,key)+
      '<div class="vb-edit-grid"><div class="vb-blocks" id="vbBlocks">'+this.vbBlocksHtml(b,key)+'</div>'+
      '<div class="vb-pv-col"><div class="vb-pv-h">Live preview</div><div class="vb-pv" id="vbPreview">'+this.vbPreviewHtml(b,key)+'</div></div></div>'+
      '<details class="vb-code"><summary>&lt;/&gt; Live HTML \u2014 updates as you edit</summary><textarea id="vbCode" readonly spellcheck="false">'+this.esc(this.vbCodeHtml())+'</textarea></details>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.vbSaveNow()">Save</button><button class="btn" onclick="App.vbResetDoc()">Reset to default</button><span class="wp-status" id="vbStatus">\u2713 Saved</span><span style="flex:1"></span><button class="btn" onclick="App.vbBack()">\u25c0 Back to vouchers</button></div>'+
      '</div>'; },
  vbToolbarHtml(b,key){ const toks=this.wpTokens(b,key);
    const fieldSel='<select id="vbAddField" class="vb-addsel" onchange="App.vbAddFromForm(this.value);this.selectedIndex=0"><option value="">\uff0b Add content from form\u2026</option>'+toks.map(t=>'<option value="'+t.tok+'">'+this.esc(t.label)+'</option>').join('')+'</select>';
    const btn=(t,lbl)=>'<button class="btn btn-sm" onclick="App.vbAddBlock(\''+t+'\')">'+lbl+'</button>';
    return '<div class="vb-toolbar">'+fieldSel+'<span class="vb-tb-sep"></span>'+btn('heading','\uff0b Heading')+btn('text','\uff0b Text')+btn('row','\uff0b Two columns')+btn('divider','\uff0b Divider')+btn('spacer','\uff0b Spacer')+btn('signature','\uff0b Signature')+btn('logo','\uff0b Logo')+'</div>'; },
  vbBlocksHtml(b,key){ const m=this.vbModel(); if(!m.blocks.length) return '<div class="vb-empty">No blocks yet \u2014 add content using the buttons above.</div>'; return m.blocks.map((blk,i)=>this.vbBlockEditorHtml(b,key,blk,i,m.blocks.length)).join(''); },
  vbBlockEditorHtml(b,key,blk,i,total){ const id=blk.id; const e=s=>this.esc(s==null?'':s);
    const TY={heading:'Heading',text:'Text',field:'Field',row:'Two-column row',lines:'Line items',divider:'Divider',signature:'Signature',logo:'Logo',spacer:'Spacer'};
    const ord='<div class="vb-ord"><button class="vb-ob" '+(i===0?'disabled':'')+' onclick="App.vbMove(\''+id+'\',-1)">\u25b2</button><button class="vb-ob" '+(i===total-1?'disabled':'')+' onclick="App.vbMove(\''+id+'\',1)">\u25bc</button></div>';
    const del='<button class="vb-del" title="Delete block" onclick="App.vbDelete(\''+id+'\')">\u2715</button>';
    const toksOpts=sel=>this.wpTokens(b,key).filter(t=>['logo','linesTable','signature'].indexOf(t.tok)<0).map(t=>'<option value="'+t.tok+'"'+(sel===t.tok?' selected':'')+'>'+this.esc(t.label)+'</option>').join('');
    const styleRow=withAlign=>'<div class="vb-bstyle"><label>Size <input type="number" value="'+(blk.size||15)+'" min="6" max="60" onchange="App.vbSet(\''+id+'\',\'size\',parseInt(this.value,10)||15)"></label>'+
      '<div class="vb-mini"><button class="'+(blk.bold?'on':'')+'" title="Bold" onclick="App.vbSet(\''+id+'\',\'bold\','+(blk.bold?'false':'true')+')"><b>B</b></button><button class="'+(blk.italic?'on':'')+'" title="Italic" onclick="App.vbSet(\''+id+'\',\'italic\','+(blk.italic?'false':'true')+')"><i>I</i></button><button class="'+(blk.underline?'on':'')+'" title="Underline" onclick="App.vbSet(\''+id+'\',\'underline\','+(blk.underline?'false':'true')+')"><u>U</u></button></div>'+
      (withAlign===false?'':'<div class="vb-mini"><button class="'+((!blk.align||blk.align==='left')?'on':'')+'" title="Left" onclick="App.vbSet(\''+id+'\',\'align\',\'left\')">\u2630</button><button class="'+(blk.align==='center'?'on':'')+'" title="Centre" onclick="App.vbSet(\''+id+'\',\'align\',\'center\')">\u2261</button><button class="'+(blk.align==='right'?'on':'')+'" title="Right" onclick="App.vbSet(\''+id+'\',\'align\',\'right\')">\u2630</button></div>')+
      '<label class="vb-col">Colour <input type="color" value="'+(blk.color||'#222222')+'" onchange="App.vbSet(\''+id+'\',\'color\',this.value)"></label></div>';
    let body='';
    if(blk.type==='heading'||blk.type==='text'){ body='<input class="vb-txt" type="text" value="'+e(blk.text||'')+'" placeholder="Type text\u2026" oninput="App.vbSetText(\''+id+'\',this.value)">'+styleRow(true); }
    else if(blk.type==='field'){ body='<div class="vb-frow"><select onchange="App.vbSet(\''+id+'\',\'tok\',this.value)">'+toksOpts(blk.tok)+'</select><input class="vb-pre" type="text" value="'+e(blk.prefix||'')+'" placeholder="Label e.g. Date: " oninput="App.vbSetText(\''+id+'\',this.value,\'prefix\')"></div>'+styleRow(true); }
    else if(blk.type==='row'){ const L=blk.left||{},R=blk.right||{};
      body='<div class="vb-frow"><span class="vb-side">Left</span><select onchange="App.vbSetSide(\''+id+'\',\'left\',\'tok\',this.value)">'+toksOpts(L.tok)+'</select><input class="vb-pre" type="text" value="'+e(L.prefix||'')+'" placeholder="Label" oninput="App.vbSetSideText(\''+id+'\',\'left\',this.value)"></div>'+
        '<div class="vb-frow"><span class="vb-side">Right</span><select onchange="App.vbSetSide(\''+id+'\',\'right\',\'tok\',this.value)">'+toksOpts(R.tok)+'</select><input class="vb-pre" type="text" value="'+e(R.prefix||'')+'" placeholder="Label" oninput="App.vbSetSideText(\''+id+'\',\'right\',this.value)"></div>'+styleRow(false); }
    else if(blk.type==='divider'){ body='<div class="vb-bstyle"><label>Thickness <input type="number" value="'+(blk.thickness||1)+'" min="1" max="10" onchange="App.vbSet(\''+id+'\',\'thickness\',parseInt(this.value,10)||1)"></label><label class="vb-col">Colour <input type="color" value="'+(blk.color||'#444444')+'" onchange="App.vbSet(\''+id+'\',\'color\',this.value)"></label></div>'; }
    else if(blk.type==='spacer'){ body='<div class="vb-bstyle"><label>Height <input type="number" value="'+(blk.height||20)+'" min="2" max="400" onchange="App.vbSet(\''+id+'\',\'height\',parseInt(this.value,10)||20)"> px</label></div>'; }
    else if(blk.type==='logo'){ body='<div class="vb-bstyle"><span class="vb-note">Business logo (set in Settings \u203a Business)</span><div class="vb-mini"><button class="'+((!blk.align||blk.align==='left')?'on':'')+'" onclick="App.vbSet(\''+id+'\',\'align\',\'left\')">L</button><button class="'+(blk.align==='center'?'on':'')+'" onclick="App.vbSet(\''+id+'\',\'align\',\'center\')">C</button><button class="'+(blk.align==='right'?'on':'')+'" onclick="App.vbSet(\''+id+'\',\'align\',\'right\')">R</button></div></div>'; }
    else if(blk.type==='lines'){ body='<span class="vb-note">Line items table \u2014 Account \u00b7 Description \u00b7 Amount \u00b7 Total (filled from the voucher\u2019s lines).</span>'; }
    else if(blk.type==='signature'){ body='<span class="vb-note">Signature lines \u2014 Received by \u00b7 Authorised signature.</span>'; }
    return '<div class="vb-block"><div class="vb-bhead"><span class="vb-btype">'+(TY[blk.type]||blk.type)+'</span>'+ord+'<span style="flex:1"></span>'+del+'</div><div class="vb-bbody">'+body+'</div></div>'; },
  vbAddBlock(type){ const m=this.vbModel(); const blk={id:this._vbUid(),type:type}; if(type==='heading'){blk.text='Heading';blk.size=20;blk.bold=1;blk.align='center';} else if(type==='text'){blk.text='Text';blk.size=15;} else if(type==='row'){blk.left={tok:'recipient'};blk.right={tok:'date'};blk.size=15;} else if(type==='divider'){blk.color='#444444';blk.thickness=1;} else if(type==='spacer'){blk.height=20;} else if(type==='logo'){blk.align='left';} m.blocks.push(blk); this.vbSync(); this.vbRerenderEditor(); },
  vbAddFromForm(tok){ if(!tok) return; const m=this.vbModel(); if(tok==='linesTable') m.blocks.push({id:this._vbUid(),type:'lines'}); else if(tok==='logo') m.blocks.push({id:this._vbUid(),type:'logo',align:'left'}); else if(tok==='signature') m.blocks.push({id:this._vbUid(),type:'signature'}); else m.blocks.push({id:this._vbUid(),type:'field',tok:tok,size:15,align:'left'}); this.vbSync(); this.vbRerenderEditor(); },
  vbSet(id,prop,val){ const blk=this.vbBlk(id); if(!blk) return; blk[prop]=val; this.vbSync(); this.vbRerenderEditor(); },
  vbSetText(id,val,prop){ const blk=this.vbBlk(id); if(!blk) return; blk[prop||'text']=val; this.vbSync(); this.vbRerenderPreview(); },
  vbSetSide(id,side,prop,val){ const blk=this.vbBlk(id); if(!blk) return; blk[side]=blk[side]||{}; blk[side][prop]=val; this.vbSync(); this.vbRerenderEditor(); },
  vbSetSideText(id,side,val){ const blk=this.vbBlk(id); if(!blk) return; blk[side]=blk[side]||{}; blk[side].prefix=val; this.vbSync(); this.vbRerenderPreview(); },
  vbMove(id,dir){ const m=this.vbModel(); const i=m.blocks.findIndex(x=>x.id===id); if(i<0) return; const j=i+dir; if(j<0||j>=m.blocks.length) return; const t=m.blocks[i]; m.blocks[i]=m.blocks[j]; m.blocks[j]=t; this.vbSync(); this.vbRerenderEditor(); },
  vbDelete(id){ const m=this.vbModel(); const i=m.blocks.findIndex(x=>x.id===id); if(i>=0) m.blocks.splice(i,1); this.vbSync(); this.vbRerenderEditor(); },
  vbRerenderEditor(){ const el=document.getElementById('vbBlocks'); if(el) el.innerHTML=this.vbBlocksHtml(this.curBiz(),this.fmtForm); this.vbRerenderPreview(); },
  vbRerenderPreview(){ const p=document.getElementById('vbPreview'); if(p) p.innerHTML=this.vbPreviewHtml(this.curBiz(),this.fmtForm); const code=document.getElementById('vbCode'); if(code) code.value=this.vbCodeHtml(); },
  vbSync(){ const b=this.curBiz(); const c=this.vbCfg(); c.vdoc=this.vbModel(); this.saveBiz(b); const st=document.getElementById('vbStatus'); if(st){ st.textContent='\u2713 Saved'; st.style.color='var(--success)'; } },
  vbSaveNow(){ this.vbSync(); const st=document.getElementById('vbStatus'); if(st){ st.textContent='\u2713 All changes saved'; st.style.color='var(--success)'; } },
  vbResetDoc(){ if(!this._ask('Reset this voucher to the default theme? Your changes will be replaced.',()=>this.vbResetDoc())) return; const c=this.vbCfg(); c.vdoc=this.vbDefaultModel(this.curBiz(),this.fmtForm); this.saveBiz(this.curBiz()); this.vbRerenderEditor(); },
  vbBack(){ this.fmtForm=null; this.fmtDraft=null; this.openFmtCat(this.fmtCat||'voucher'); },

  fmtSampleRec(b,key){ const sc=this.formSchema(key); const tc=(b.taxCodes&&b.taxCodes[0])?b.taxCodes[0].name:''; const today=new Date().toISOString().slice(0,10); const due=new Date(Date.now()+14*864e5).toISOString().slice(0,10);
    if(sc.kind==='form'){ const rec={ customer:'Sample Customer Co.', supplier:'Sample Supplier Co.', issueDate:today, dueDate:due, reference:this.nextRef(b,key), billingAddress:'123 Example Street\nCity, Country', description:'Sample description / notes line.',
      bankDetails:'Account Title: '+(b.name||'Your Company')+'\nBank: Example Bank\nIBAN: XX00 0000 0000 0000', disclaimer:'This is a computer generated document.', taxInclusive:false,
      lines:[{item:'Sample item A',desc:'Description for item A',qty:2,price:100,amount:200,tax:tc,taxAmt:10},{item:'Sample item B',qty:1,price:50,amount:50,tax:tc,taxAmt:2.5}], subtotal:250, tax:12.5, total:262.5 };
      ((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='line').forEach(x=>{ rec.lines.forEach(l=>{ l[x.key]='Sample'; }); }); return rec; }
    return { date:today, reference:this.nextRef(b,key), paidBy:'Sample Customer', payee:'Sample Supplier', receivedIn:'Cash on hand', paidFrom:'Cash on hand', description:'Sample narration',
      lines:[{account:'',sub:'Sample sub-account',desc:'Line description',amount:100},{account:'',desc:'Another line',amount:50}], amount:150 }; },
  fmtHint(){ return '<div class="fmt-edit fmt-hint">Click a <b>column</b> or a <b>custom field</b> in the form below to edit it. Drag a column left/right to reorder; drag a separate field block between sections. Add fields with the buttons above.</div>'; },
  colLabel(b,key,k){ const sc=this.formSchema(key); const lo={}; if(sc) sc.cols.forEach(x=>lo[x[0]]=x[1]); if(lo[k]) return lo[k]; const cf=((this.formCfg(b,key)||{}).custom||[]).find(x=>x.key===k); return (cf&&cf.label)||k; },
  lineCustomFor(b,key,k){ return ((this.formCfg(b,key)||{}).custom||[]).find(x=>x.type==='line'&&x.key===k); },
  cfTypeControls(b,key,x){ const fk=x.key; const dt=x.dataType||'text'; const line=x.type==='line'; const e=s=>this.esc(s);
    const typeSel='<label class="fmt-il">Data type <select onchange="App.cfSetType(\''+key+'\',\''+fk+'\',this.value)">'+[['select','Multiple values'],['number','Number'],['formula','Arithmetic function'],['text','Text']].map(o=>'<option value="'+o[0]+'"'+(dt===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></label>';
    const optsEditor=()=>'<div class="cf-opts"><div class="fmt-grp" style="margin:2px 0 4px">Options</div>'+((x.options||[]).map((o,oi)=>'<div class="cf-opt"><input type="text" value="'+e(o)+'" placeholder="Option '+(oi+1)+'" onchange="App.cfSetOption(\''+key+'\',\''+fk+'\','+oi+',this.value);App.fmtRerender()"><button class="dz-x" title="Remove" onclick="App.cfDelOption(\''+key+'\',\''+fk+'\','+oi+')">\u2715</button></div>').join(''))+'<button class="btn btn-xs" onclick="App.cfAddOption(\''+key+'\',\''+fk+'\')">+ Add option</button></div>';
    let extra='';
    if(dt==='select') extra=optsEditor();
    else if(dt==='text'){ const tt=x.textType||'single';
      extra='<label class="fmt-il">Type <select onchange="App.cfSetTextType(\''+key+'\',\''+fk+'\',this.value)">'+[['single','Single line text'],['paragraph','Paragraph text'],['dropdown','Drop-down list'],['qr','QR code']].map(o=>'<option value="'+o[0]+'"'+(tt===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></label>'+((tt==='dropdown')?optsEditor():''); }
    else if(dt==='formula'){ const fm=x.formula||{}; const srcs=line?this.cfLineSources(b,key,fk):this.cfDocSources(b,key,fk); const kind=fm.operandKind||'value';
      const baseSel='<label class="fmt-il"><select onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'base\',this.value)">'+srcs.map(s=>'<option value="'+s[0]+'"'+((fm.base||'')===s[0]?' selected':'')+'>'+e(s[1])+'</option>').join('')+'</select></label>';
      const opSel='<label class="fmt-il"><select onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'op\',this.value)">'+[['*','\u00D7'],['/','\u00F7'],['+','+'],['-','\u2212']].map(o=>'<option value="'+o[0]+'"'+((fm.op||'*')===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></label>';
      const kindSel='<label class="fmt-il"><select onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'operandKind\',this.value)"><option value="value"'+(kind==='value'?' selected':'')+'>a value</option><option value="source"'+(kind==='source'?' selected':'')+'>a field</option></select></label>';
      const opnd=(kind==='source')
        ? '<label class="fmt-il"><select onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'operandSource\',this.value)">'+srcs.map(s=>'<option value="'+s[0]+'"'+((fm.operandSource||'')===s[0]?' selected':'')+'>'+e(s[1])+'</option>').join('')+'</select></label>'
        : '<label class="fmt-il"><input type="number" step="any" value="'+e(fm.operand==null?'':fm.operand)+'" placeholder="value" onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'operand\',this.value)" style="width:84px"></label>'+
          '<label class="fmt-il"><select onchange="App.cfSetFx(\''+key+'\',\''+fk+'\',\'operandType\',this.value)"><option value="amount"'+((fm.operandType||'amount')==='amount'?' selected':'')+'>amount</option><option value="percent"'+(fm.operandType==='percent'?' selected':'')+'>percent %</option></select></label>';
      extra='<div class="fmt-edit-row" style="margin-top:6px;flex-wrap:wrap"><span class="fmt-il" style="color:#555">Formula:</span>'+baseSel+opSel+kindSel+opnd+'</div>'+
        '<div style="font-size:11px;color:#8a97a2;margin-top:4px">Pick a starting field (Subtotal, VAT, Total, or any number field like “Principal amount”), an operator, then a value or another field.</div>'; }
    return typeSel+extra; },
  fmtSelCustom(b,key){ const s=this.fmtSel; if(!s) return null; if(s.type==='custom') return ((this.formCfg(b,key)||{}).custom||[])[s.i]||null; if(s.type==='col') return this.lineCustomFor(b,key,s.k)||null; return null; },
  customFieldPanel(b,key,x,sc){ const fk=x.key; const e=s=>this.esc(s); const line=x.type==='line'; const cfg=this.formCfg(b,key); const ci=line?cfg.cols.findIndex(c=>c.k===fk):-1; const cc=ci>=0?cfg.cols[ci]:{};
    const kindSel='<label class="fmt-il">Field option <select onchange="App.cfSetKind(\''+key+'\',\''+fk+'\',this.value)"><option value="field"'+(line?'':' selected')+'>Separate</option><option value="line"'+(line?' selected':'')+'>Line item</option></select></label>';
    const slots=[['afterHeader','After header'],['afterMeta','After customer & dates'],['afterDesc','After description'],['afterTable','After items table'],['bottom','Bottom of document']];
    const posSel=(!line&&sc.kind==='form')?'<label class="fmt-il">Printed position <select onchange="App.cfSetPos(\''+key+'\',\''+fk+'\',this.value);App.fmtRerender()">'+slots.map(s=>'<option value="'+s[0]+'"'+(((x.pos||'afterMeta')===s[0])?' selected':'')+'>'+s[1]+'</option>').join('')+'</select></label>':'';
    const colSettings=line?('<label class="fmt-il">Min width <input type="number" min="0" step="10" value="'+(cc.w||'')+'" placeholder="auto" onchange="App.cfColSet(\''+key+'\',\''+fk+'\',\'w\',this.value);App.fmtRerender()" style="width:70px"> px</label>'+
        '<label class="fmt-il">Align <select onchange="App.cfColSet(\''+key+'\',\''+fk+'\',\'a\',this.value);App.fmtRerender()"><option value=""'+(!cc.a?' selected':'')+'>Default</option><option value="left"'+(cc.a==='left'?' selected':'')+'>Left</option><option value="center"'+(cc.a==='center'?' selected':'')+'>Center</option><option value="right"'+(cc.a==='right'?' selected':'')+'>Right</option></select></label>'+
        '<button class="btn btn-xs" onclick="App.fmtColMoveKey(\''+key+'\',\''+fk+'\',-1)" title="Move left">\u25C0</button><button class="btn btn-xs" onclick="App.fmtColMoveKey(\''+key+'\',\''+fk+'\',1)" title="Move right">\u25B6</button>'):'';
    const note=(x.dataType==='formula')?'Calculated automatically.':(line?('Filled in per line when creating a '+e((REG[key]||{}).singular||key)+'.'):('Value is entered when you create a '+e((REG[key]||{}).singular||key)+'. Drag the block on the form to reorder it; its place on the printed document is set above.'));
    return '<div class="fmt-edit"><div class="fmt-edit-h"><b>Custom field'+(x.label?(' &mdash; '+e(x.label)):'')+'</b><button class="btn btn-xs" onclick="App.fmtClose()">Close \u2715</button></div>'+
      '<div class="fmt-edit-row">'+
        '<label class="fmt-il">Label <input type="text" value="'+e(x.label||'')+'" placeholder="Field label" onchange="App.cfSetLabel(\''+key+'\',\''+fk+'\',this.value);App.fmtRerender()" style="width:150px"></label>'+
        this.cfTypeControls(b,key,x)+
      '</div>'+
      '<div class="fmt-edit-row" style="margin-top:8px">'+kindSel+posSel+colSettings+
        '<label class="fmt-il">Print <input type="checkbox" '+(x.show!==false?'checked':'')+' onchange="App.cfSetPrint(\''+key+'\',\''+fk+'\',this.checked);App.fmtRerender()"></label>'+
        '<button class="btn btn-xs btn-danger" onclick="App.cfDelField(\''+key+'\',\''+fk+'\')">Delete field</button>'+
      '</div>'+(sc.kind==='form'?'<div class="fmt-il" style="margin-top:7px;color:#888">'+note+'</div>':'')+'</div>'; },
  fmtPanelHtml(b,key,sc){ const sel=this.fmtSel; const cfx=this.fmtSelCustom(b,key); if(cfx) return this.customFieldPanel(b,key,cfx,sc);
    const labelOf={}; sc.cols.forEach(x=>labelOf[x[0]]=x[1]); const cfg=this.formCfg(b,key);
    if(sel&&sel.type==='col'){ const i=cfg.cols.findIndex(c=>c.k===sel.k); if(i<0) return this.fmtHint(); const cc=cfg.cols[i]; const lab=labelOf[cc.k]||cc.k;
      return '<div class="fmt-edit"><div class="fmt-edit-h"><b>Editing column &mdash; '+this.esc(lab)+'</b><button class="btn btn-xs" onclick="App.fmtClose()">Close \u2715</button></div>'+
        '<div class="fmt-edit-row">'+
          '<button class="btn btn-xs" onclick="App.fmtColMoveSel(-1)"'+(i===0?' disabled':'')+'>\u25C0 Move left</button>'+
          '<button class="btn btn-xs" onclick="App.fmtColMoveSel(1)"'+(i===cfg.cols.length-1?' disabled':'')+'>Move right \u25B6</button>'+
          '<label class="fmt-il">Print <input type="checkbox" '+(cc.show!==false?'checked':'')+' onchange="App.cfgColShow(\''+key+'\','+i+',this.checked);App.fmtRerender()"></label>'+
          '<label class="fmt-il">Min width <input type="number" min="0" step="10" value="'+(cc.w||'')+'" placeholder="auto" onchange="App.cfgColW(\''+key+'\','+i+',this.value);App.fmtRerender()" style="width:72px"> px</label>'+
          '<label class="fmt-il">Height <input type="number" min="0" step="2" value="'+(cc.h||'')+'" placeholder="auto" onchange="App.cfgColH(\''+key+'\','+i+',this.value);App.fmtRerender()" style="width:64px"> px</label>'+
          '<label class="fmt-il">Align <select onchange="App.cfgColAlign(\''+key+'\','+i+',this.value);App.fmtRerender()"><option value=""'+(!cc.a?' selected':'')+'>Default</option><option value="left"'+(cc.a==='left'?' selected':'')+'>Left</option><option value="center"'+(cc.a==='center'?' selected':'')+'>Center</option><option value="right"'+(cc.a==='right'?' selected':'')+'>Right</option></select></label>'+
        '</div></div>'; }
    return this.fmtHint(); },
  cfSetLabel(key,fk,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x) x.label=val; this.fmtSave(b); },
  cfSetPrint(key,fk,on){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x){ x.show=!!on; if(x.type==='line'){ const cc=c.cols.find(z=>z.k===fk); if(cc) cc.show=!!on; } } this.fmtSave(b); },
  cfSetPos(key,fk,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x) x.pos=val||'afterMeta'; this.fmtSave(b); },
  cfSetTextType(key,fk,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x){ x.textType=val; if(val==='dropdown'&&!x.options) x.options=['Option 1','Option 2']; } this.fmtSave(b); this.renderMain(b); },
  cfAddOption(key,fk){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x){ x.options=x.options||[]; x.options.push('Option '+(x.options.length+1)); } this.fmtSave(b); this.renderMain(b); },
  cfSetOption(key,fk,idx,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x&&x.options&&x.options[idx]!=null) x.options[idx]=val; this.fmtSave(b); },
  cfDelOption(key,fk,idx){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x&&x.options) x.options.splice(idx,1); this.fmtSave(b); this.renderMain(b); },
  cfSetKind(key,fk,kind){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(!x) return;
    if(kind==='line'&&x.type!=='line'){ x.type='line'; delete x.pos; if(!c.cols.some(z=>z.k===fk)) c.cols.push({k:fk,show:x.show!==false,w:0,h:0}); this.fmtSel={type:'col',k:fk}; }
    else if(kind==='field'&&x.type==='line'){ x.type='field'; if(!x.pos) x.pos='afterMeta'; c.cols=c.cols.filter(z=>z.k!==fk); this.fmtSel={type:'custom',i:c.custom.indexOf(x)}; }
    this.fmtSave(b); this.renderMain(b); },
  cfDelField(key,fk){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x&&x.type==='line') c.cols=c.cols.filter(z=>z.k!==fk); c.custom=c.custom.filter(z=>z.key!==fk); this.fmtSel=null; this.fmtSave(b); this.renderMain(b); },
  cfColSet(key,fk,prop,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const cc=c.cols.find(z=>z.k===fk); if(cc){ if(prop==='w'||prop==='h') cc[prop]=parseInt(val,10)||0; else cc[prop]=val||''; } this.fmtSave(b); },
  fmtColMoveKey(key,fk,dir){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const i=c.cols.findIndex(z=>z.k===fk); const j=i+dir; if(i<0||j<0||j>=c.cols.length) return; const t=c.cols[i]; c.cols[i]=c.cols[j]; c.cols[j]=t; this.fmtSave(b); this.renderMain(b); },
  cfDisplayValue(x,raw,ctx){ const e=s=>this.esc(s); const dt=x.dataType||'text';
    if(dt==='formula') return this.money(this.evalCustomFormula(x,ctx||{}));
    const val=(raw==null?'':String(raw));
    if(dt==='text'&&x.textType==='qr'){ if(!val) return ''; return '<img class="iv-qr" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data='+encodeURIComponent(val)+'" alt="'+e(val)+'">'; }
    if(dt==='text'&&x.textType==='paragraph') return e(val).split('\n').join('<br>');
    return e(val); },
  cfEntryInput(x,id,val,onEvt){ const e=s=>this.esc(s); const dt=x.dataType||'text'; val=val==null?'':val; const ev=onEvt?(' '+onEvt):'';
    if(dt==='number') return '<input id="'+id+'" type="text" inputmode="decimal" value="'+e(val)+'"'+ev+'>';
    if(dt==='select'||(dt==='text'&&x.textType==='dropdown')){ const opts=x.options||[]; const found=opts.indexOf(val)>=0; return '<select id="'+id+'"'+ev+' style="min-width:200px"><option value=""></option>'+((val&&!found)?'<option selected>'+e(val)+'</option>':'')+opts.map(o=>'<option'+(String(val)===String(o)?' selected':'')+'>'+e(o)+'</option>').join('')+'</select>'; }
    if(dt==='text'&&x.textType==='paragraph') return '<textarea id="'+id+'" rows="3" style="width:100%">'+e(val)+'</textarea>';
    return '<input id="'+id+'" type="text" value="'+e(val)+'"'+ev+' style="max-width:320px">'; },
  fmtChecklistHtml(b,key,sc){ const labelOf={}; sc.cols.forEach(x=>labelOf[x[0]]=x[1]); const cfg=this.formCfg(b,key);
    const contentBoxes=sc.content.map(ct=>'<label class="fmt-chk"><input type="checkbox" '+(this.cfgShow(b,key,ct[0])?'checked':'')+' onchange="App.cfgToggle(\''+key+'\',\''+ct[0]+'\',this.checked);App.fmtRerender()"> '+this.esc(ct[1])+'</label>').join('');
    const colBoxes=cfg.cols.map((cc,i)=>({cc:cc,i:i})).filter(o=>labelOf[o.cc.k]).map(o=>'<label class="fmt-chk"><input type="checkbox" '+(o.cc.show!==false?'checked':'')+' onchange="App.cfgColShow(\''+key+'\','+o.i+',this.checked);App.fmtRerender()"> '+this.esc(labelOf[o.cc.k])+' <a class="fmt-mini" onclick="event.preventDefault();App.selectFmtCol(\''+o.cc.k+'\')">edit</a></label>').join('');
    return '<details class="fmt-std"><summary>Show / hide standard fields &amp; columns</summary>'+
      '<div class="fmt-grp">Document fields</div><div class="fmt-chkgrid">'+contentBoxes+'</div>'+
      '<div class="fmt-grp">Standard line-item columns</div><div class="fmt-chkgrid">'+colBoxes+'</div></details>'; },
  formEditorHtml(b,key){ const sc=this.formSchema(key); if(!sc) return this.crumbThemes('Form')+'<div class="card">This form can\u2019t be customised.</div>';
    this.cfgEnsure(b,key); const r=REG[key]||{}; const nm=this.fmtFormName(key);
    const builder=this.entryBuilderHtml(b,key); const dirty=this.fmtDirty(); const cfg=this.formCfg(b,key)||{};
    const hasRef=(sc.kind==='form'||sc.kind==='voucher'||((sc.fields||[]).some(f=>f.key==='reference')));
    const hasContent=!!(sc.content&&sc.content.length); const hasStdCols=!!(sc.cols&&sc.cols.length);
    const info=hasContent
      ? 'This is your '+this.esc(nm)+' entry form, laid out as a grid. Set each block\u2019s <b>Row</b> and <b>Column</b> number to place it — blocks sharing a row sit side-by-side (e.g. Issue date Row 1 Col 1, Due date Row 1 Col 2). Click <b>\uFF0B Add custom field</b> to add one. The checklist at the bottom controls which fields &amp; columns print on the document.'
      : 'This is your '+this.esc(nm)+' entry form. Set each field\u2019s <b>Row</b> and <b>Column</b> to arrange it, and click <b>\uFF0B Add custom field</b> to add your own fields \u2014 they appear on the actual form.';
    return this.crumbThemes(nm)+
      '<div class="card" style="max-width:940px"><h2>'+this.esc(nm)+' \u2014 form layout</h2>'+
        '<div class="info-bar">'+info+'</div>'+
        '<div id="fmtPanel">'+this.fmtPanelHtml(b,key,sc)+'</div>'+
        (hasRef?('<div class="fmt-edit-row" style="margin:2px 0 12px;align-items:center;gap:8px"><label class="fmt-il" style="font-weight:600">Reference prefix (initials) <input type="text" value="'+this.esc(cfg.refPrefix||'')+'" placeholder="e.g. SINV" maxlength="12" onchange="App.cfSetRefPrefix(\''+key+'\',this.value)" style="width:120px;text-transform:uppercase"></label><span id="refPrefixHint" style="font-size:11px;color:#8a97a2">New auto references: '+(cfg.refPrefix?this.esc(cfg.refPrefix)+'-0001':'1, 2, 3…')+'</span></div>'):'')+
        '<div class="fmt-toolbar"><span class="fmt-secn" style="margin:0">Form</span><span style="flex:1"></span>'+
          '<button class="btn btn-xs btn-primary" onclick="App.addSeparateField()">\uFF0B Add custom field</button>'+
          (hasStdCols?'<button class="btn btn-xs" onclick="App.fmtToggleColMenu()">\uFF0B Insert standard column</button>':'')+'</div>'+
        ((this.fmtColMenu&&hasStdCols)?this.fmtInsertMenuHtml(b,key,sc):'')+
        '<div class="fmt-prev fmt-prev-form" id="efPrev">'+builder+'</div>'+
        (hasContent?this.fmtChecklistHtml(b,key,sc):'')+
        '<div class="form-actions"><button id="fmtUpdateBtn" class="btn btn-primary" onclick="App.commitFmtForm()"'+(dirty?'':' disabled')+'>Update form</button>'+
          '<button id="fmtDiscardBtn" class="btn" onclick="App.discardFmtForm()"'+(dirty?'':' disabled')+'>Discard changes</button>'+
          '<span id="fmtStatus" style="font-size:12px;margin:0 6px;color:'+(dirty?'var(--warn)':'var(--success)')+'">'+(dirty?'\u25CF Unsaved changes \u2014 click Update to apply':'\u2713 All changes applied')+'</span>'+
          '<span style="flex:1"></span><button class="btn" onclick="App.backFromFmtForm()">◀ Back to list</button><button class="btn" onclick="App.cfgResetForm(\''+key+'\')">Reset to defaults</button></div>'+
      '</div>'; },
  selectFmtCol(k){ this.fmtSel={type:'col',k:k}; this.renderMain(this.curBiz()); },
  selectFmtCustom(i){ this.fmtSel={type:'custom',i:i}; this.renderMain(this.curBiz()); },
  selectFmtCustomKey(fk){ const b=this.curBiz(); const list=((this.formCfg(b,this.fmtForm)||{}).custom||[]); const i=list.findIndex(x=>x.key===fk); if(i>=0){ this.fmtSel={type:'custom',i:i}; this.renderMain(b); } },
  ebDragStart(id){ this._ebDrag=id; },
  ebDrop(targetId){ const id=this._ebDrag; this._ebDrag=null; if(!id||id===targetId) return; const b=this.curBiz(); const key=this.fmtForm; const ord=this.entryOrderFor(b,key); const from=ord.indexOf(id); if(from<0) return; ord.splice(from,1); const to=ord.indexOf(targetId); ord.splice(to<0?ord.length:to,0,id); const c=this.cfgEnsure(b,key); c.entryOrder=ord; this.fmtSave(b); this.renderMain(b); },
  ebMove(id,dir){ const b=this.curBiz(); const key=this.fmtForm; const ord=this.entryOrderFor(b,key); const i=ord.indexOf(id); const j=i+dir; if(i<0||j<0||j>=ord.length) return; const t=ord[i]; ord[i]=ord[j]; ord[j]=t; const c=this.cfgEnsure(b,key); c.entryOrder=ord; this.fmtSave(b); this.renderMain(b); },
  ebLinesPreview(b,key,labelOf,cfg){
    const sc=this.formSchema(key); const kind=(sc&&sc.lines&&sc.lines.kind)||((REG[key]&&REG[key].lines&&REG[key].lines.kind))||'invoice';
    const savSec=this.wsSection, savLn=this._showLineNum, savDesc=this._showDesc, savLines=this._lines;
    let lbl=null; for(const k in LABEL2KEY){ if(LABEL2KEY[k]===key){ lbl=k; break; } }
    if(lbl) this.wsSection=lbl;
    this._showLineNum=true; this._showDesc=true; this._lines=this._lines&&this._lines.length?this._lines:[{}];
    let cols; try{ cols=this.lineCols({lines:{kind:kind}}); } finally{ this.wsSection=savSec; this._showLineNum=savLn; this._showDesc=savDesc; this._lines=savLines; }
    const heads=cols.map(c=>'<th style="white-space:nowrap">'+this.esc(c.label)+'</th>').join('');
    const cells=cols.map(()=>'<td><div class="eb-cell"></div></td>').join('');
    const note=kind==='invoice'?'These are the entry-form line columns, shared by every document type. Add more with “＋ Add custom field → Line item”. The checklist below controls which columns print on the document.':'These are the entry-form line columns for this form.';
    return '<div style="overflow-x:auto;max-width:100%"><table class="eb-lines"><thead><tr>'+heads+'</tr></thead><tbody><tr>'+cells+'</tr><tr>'+cells+'</tr></tbody></table></div><div class="eb-note">'+note+'</div>'; },
  ebCardContent(b,key,id,labelOf,cfg){ const isP=this.purchaseDoc();
    const _sc=this.formSchema(key);
    if(_sc && _sc.kind==='record'){ const f=(_sc.fields||[]).find(x=>x.key===id);
      if(f){ const t=f.type||'text'; const lab='<label class="fld">'+this.esc(f.label||id)+(f.req?' *':'')+'</label>';
        if(t==='check') return '<label class="chk-row" style="margin:0"><input type="checkbox" disabled> '+this.esc(f.label||id)+'</label>';
        if(t==='textarea') return lab+'<textarea rows="2" disabled></textarea>';
        if(t==='date') return lab+'<input type="date" disabled style="max-width:200px">';
        if(t==='money') return lab+'<input type="text" disabled placeholder="0.00" style="max-width:200px">';
        if(t==='number') return lab+'<input type="number" disabled style="max-width:200px">';
        if(t==='ref'||t==='select'||t==='account') return lab+'<select disabled style="min-width:200px"><option>— select —</option></select>';
        return lab+'<input type="text" disabled style="max-width:280px">'; } }
    if(id==='date') return '<label class="fld">Issue date</label><input type="date" disabled style="max-width:200px">';
    if(id==='dueDate') return '<label class="fld">Due date</label><input type="text" disabled value="Net 14 days" style="max-width:200px">';
    if(id==='reference') return '<label class="fld">Reference</label><div style="display:inline-flex;align-items:stretch"><span style="padding:6px 9px;background:#e9ecef;border:1px solid #ced4da;border-radius:4px 0 0 4px"><input type="checkbox" disabled checked style="width:13px;height:13px;margin:0"></span><input type="text" disabled value="Automatic" style="width:120px;max-width:120px;text-align:center;padding:6px 10px;border:1px solid #ced4da;border-left:0;border-radius:0 4px 4px 0;background:#fff"></div>';
    if(id==='party') return '<label class="fld">'+(isP?'Supplier':'Customer')+'</label><select disabled style="min-width:220px"><option>— select —</option></select>';
    if(id==='address') return '<label class="fld">'+(isP?'Supplier address':'Billing address')+'</label><textarea rows="2" disabled></textarea>';
    if(id==='description') return '<label class="fld">Description</label><input type="text" disabled placeholder="Optional">';
    if(id==='bankDetails') return '<label class="fld">'+(isP?'Notes':'Bank details')+'</label><label class="chk-row" style="margin:0 0 6px"><input type="checkbox" disabled checked> Print on document</label><textarea rows="3" disabled placeholder="Account Title / IBAN / Swift…"></textarea>';
    if(id==='disclaimer') return '<label class="fld">Disclaimer</label><label class="chk-row" style="margin:0 0 6px"><input type="checkbox" disabled checked> Print on document</label><textarea rows="2" disabled placeholder="Disclaimer text…"></textarea>';
    if(id==='lines') return this.ebLinesPreview(b,key,labelOf,cfg);
    if(id.indexOf('cf:')===0){ const x=this.cfFieldByKey(b,key,id.slice(3))||{}; const dt=x.dataType||'text'; const tt=x.textType||'single'; let inp;
      if(dt==='number') inp='<input type="text" disabled placeholder="0.00" style="max-width:200px">';
      else if(dt==='select'||(dt==='text'&&tt==='dropdown')) inp='<select disabled style="min-width:200px"><option>'+((x.options||[])[0]?this.esc(x.options[0]):'— choose —')+'</option></select>';
      else if(dt==='formula') inp='<input type="text" disabled value="(calculated)" style="max-width:200px;background:#fafafa">';
      else if(dt==='text'&&tt==='paragraph') inp='<textarea rows="2" disabled></textarea>';
      else if(dt==='text'&&tt==='qr') inp='<input type="text" disabled placeholder="value → QR" style="max-width:200px">';
      else inp='<input type="text" disabled style="max-width:280px">';
      return '<label class="fld">'+this.esc(x.label||'Custom field')+'</label>'+inp; }
    return ''; },
  entryBuilderHtml(b,key){ const sc=this.formSchema(key); const labelOf={}; (sc.cols||[]).forEach(x=>labelOf[x[0]]=x[1]); const cfg=this.formCfg(b,key); const order=this.entryOrderFor(b,key); const grid=this.gridFor(b,key); const rows=this.gridRows(order,grid); const sel=this.fmtSel;
    const nameOf={date:'Issue date',dueDate:'Due date',reference:'Reference',party:(this.purchaseDoc()?'Supplier':'Customer'),address:(this.purchaseDoc()?'Supplier address':'Billing address'),description:'Description',lines:'Line items',bankDetails:(this.purchaseDoc()?'Notes':'Bank details'),disclaimer:'Disclaimer'};
    if(sc && sc.kind==='record') (sc.fields||[]).forEach(f=>{ nameOf[f.key]=f.label||f.key; });
    const cardFor=(id)=>{ const isCf=id.indexOf('cf:')===0; const fk=isCf?id.slice(3):null; const x=isCf?this.cfFieldByKey(b,key,fk):null; const g=grid[id]||{r:1,c:1};
      const selCard=isCf?(sel&&sel.type==='custom'&&(((cfg.custom||[])[sel.i]||{}).key===fk)):false;
      const title=isCf?((x&&x.label)||'Custom field'):(nameOf[id]||id);
      const content=this.ebCardContent(b,key,id,labelOf,cfg);
      const editBtn=isCf?'<button class="btn btn-xs" onclick="event.stopPropagation();App.selectFmtCustomKey(\''+fk+'\')">Edit</button>':'';
      const bodyClick=isCf?(' onclick="App.selectFmtCustomKey(\''+fk+'\')"'):'';
      const sizeInputs=(id==='lines')?'':(
        '<label class="ef-rc">W <input type="number" min="0" placeholder="auto" value="'+(g.w||'')+'" onchange="App.cfSetGrid(\''+key+'\',\''+id+'\',\'w\',this.value)"></label>'+
        '<label class="ef-rc">H <input type="number" min="0" placeholder="auto" value="'+(g.h||'')+'" onchange="App.cfSetGrid(\''+key+'\',\''+id+'\',\'h\',this.value)"></label>');
      const sa=(id==='lines')?'':this.sizeAttr(g);
      return '<div class="ef-card'+(selCard?' ef-sel':'')+(id==='lines'?' ef-full':'')+'">'+
        '<div class="ef-card-h"><span class="ef-title">'+this.esc(title)+(isCf?' <span class="ef-tag">custom</span>':'')+'</span><span style="flex:1"></span>'+
          '<label class="ef-rc">Row <input type="number" min="1" value="'+g.r+'" onchange="App.cfSetGrid(\''+key+'\',\''+id+'\',\'r\',this.value)"></label>'+
          '<label class="ef-rc">Col <input type="number" min="1" value="'+g.c+'" onchange="App.cfSetGrid(\''+key+'\',\''+id+'\',\'c\',this.value)"></label>'+sizeInputs+editBtn+'</div>'+
        '<div class="ef-card-body'+(isCf?' ef-click':'')+'"'+bodyClick+sa+'>'+content+'</div></div>'; };
    const html=rows.map(row=>'<div class="ef-grid-row">'+row.cells.map(cl=>cardFor(cl.id)).join('')+'</div>').join('');
    return '<div class="ef-form">'+html+'</div>'; },
  fmtClose(){ this.fmtSel=null; this.renderMain(this.curBiz()); },
  fmtRerender(){ this.renderMain(this.curBiz()); },
  fmtColMoveSel(dir){ const key=this.fmtForm; const c=this.formCfg(this.curBiz(),key); if(!c) return; const i=c.cols.findIndex(x=>x.k===(this.fmtSel&&this.fmtSel.k)); if(i<0) return; this.cfgColMove(key,i,dir); },
  fmtDragCol(k){ this._drag={type:'col',k:k}; },
  fmtDropCol(targetK){ const dr=this._drag; this._drag=null; if(!dr||dr.type!=='col') return; const key=this.fmtForm; const b=this.curBiz(); const c=this.formCfg(b,key); if(!c) return; const from=c.cols.findIndex(x=>x.k===dr.k); if(from<0||dr.k===targetK) return; const m=c.cols.splice(from,1)[0]; const to=c.cols.findIndex(x=>x.k===targetK); c.cols.splice(to<0?c.cols.length:to,0,m); this.fmtSave(b); this.renderMain(b); },
  fmtDragCustom(i){ this._drag={type:'custom',i:i}; },
  fmtDropSlot(slot){ const dr=this._drag; this._drag=null; if(!dr||dr.type!=='custom') return; const key=this.fmtForm; const b=this.curBiz(); const c=this.formCfg(b,key); if(!c||!c.custom[dr.i]) return; c.custom[dr.i].pos=slot; this.fmtSave(b); this.renderMain(b); },
  cfgCustomPos(key,i,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.custom[i]) c.custom[i].pos=val||'afterMeta'; this.fmtSave(b); },
  fmtToggleColMenu(){ this.fmtColMenu=!this.fmtColMenu; this.renderMain(this.curBiz()); },
  fmtInsertCol(k){ const key=this.fmtForm; const b=this.curBiz(); const c=this.cfgEnsure(b,key); const cc=c.cols.find(x=>x.k===k); if(cc) cc.show=true; this.fmtColMenu=false; this.fmtSel={type:'col',k:k}; this.fmtSave(b); this.renderMain(b); },
  fmtInsertMenuHtml(b,key,sc){ const cfg=this.formCfg(b,key); const labelOf={}; sc.cols.forEach(x=>labelOf[x[0]]=x[1]);
    const hidden=cfg.cols.filter(c=>c.show===false&&labelOf[c.k]);
    const cols=hidden.length?hidden.map(c=>'<button class="btn btn-xs" onclick="App.fmtInsertCol(\''+c.k+'\')">+ '+this.esc(labelOf[c.k])+'</button>').join(' '):'<span style="color:#999;font-size:12px">All standard columns are already shown.</span>';
    return '<div class="fmt-insert"><div class="fmt-edit-h"><b>Insert standard column</b><button class="btn btn-xs" onclick="App.fmtToggleColMenu()">Close \u2715</button></div>'+
      '<div class="fmt-edit-row">'+cols+'</div></div>'; },
  cfgCustomShow(key,i,on){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.custom[i]) c.custom[i].show=!!on; this.fmtSave(b); },
  cfgCustomAddSel(key){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.custom.push({label:'',value:'',show:true,pos:'afterMeta'}); this.fmtSel={type:'custom',i:c.custom.length-1}; this.fmtColMenu=false; this.fmtSave(b); this.renderMain(b); },
  cfgToggle(key,ck,on){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.show[ck]=!!on; this.fmtSave(b); },
  cfgColMove(key,i,dir){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const j=i+dir; if(j<0||j>=c.cols.length) return; const t=c.cols[i]; c.cols[i]=c.cols[j]; c.cols[j]=t; this.fmtSave(b); this.renderMain(b); },
  cfgColShow(key,i,on){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.cols[i]) c.cols[i].show=!!on; this.fmtSave(b); },
  cfgColW(key,i,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.cols[i]) c.cols[i].w=parseInt(val,10)||0; this.fmtSave(b); },
  cfgColH(key,i,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.cols[i]) c.cols[i].h=parseInt(val,10)||0; this.fmtSave(b); },
  cfgColAlign(key,i,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.cols[i]) c.cols[i].a=val||''; this.fmtSave(b); },
  cfgCustomAdd(key){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.custom.push({label:'',value:''}); this.fmtSave(b); this.renderMain(b); },
  cfgCustomDel(key,i){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const x=c.custom[i]; if(x&&x.type==='line') c.cols=c.cols.filter(cc=>cc.k!==x.key); c.custom.splice(i,1); this.fmtSave(b); this.renderMain(b); },
  cfgCustomSet(key,i,f,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); if(c.custom[i]) c.custom[i][f]=val; this.fmtSave(b); },
  cfFieldByKey(b,key,fk){ return ((this.formCfg(b,key)||{}).custom||[]).find(x=>x.key===fk); },
  cfSetType(key,fk,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x){ x.dataType=val; if(val==='select'&&!x.options) x.options=['Option 1','Option 2']; if(val==='formula'&&!x.formula) x.formula={base:'',op:'*',operand:'',operandType:'amount'}; if(val==='text'&&!x.textType) x.textType='single'; } this.fmtSave(b); this.renderMain(b); },
  cfSetOptions(key,fk,csv){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x) x.options=String(csv).split(',').map(s=>s.trim()).filter(Boolean); this.fmtSave(b); },
  cfSetFx(key,fk,part,val){ const b=this.curBiz(); this.cfgEnsure(b,key); const x=this.cfFieldByKey(b,key,fk); if(x){ x.formula=x.formula||{base:'',op:'*',operand:'',operandType:'amount'}; x.formula[part]=val; } this.fmtTouch(); if(part==='operandKind') this.fmtPanelRerender(); },
  fmtPanelRerender(){ const b=this.curBiz(); const key=this.fmtForm; const sc=this.formSchema(key); if(!sc) return; const el=document.getElementById('fmtPanel'); if(el) el.innerHTML=this.fmtPanelHtml(b,key,sc); },
  cfApplyFormula(base,op,operand,ptype){ base=Number(base)||0; operand=Number(operand)||0; if(ptype==='percent'){ const p=base*operand/100; if(op==='*') return p; if(op==='+') return base+p; if(op==='-') return base-p; if(op==='/') return operand?base/(operand/100):0; return p; } if(op==='*') return base*operand; if(op==='/') return operand?base/operand:0; if(op==='+') return base+operand; if(op==='-') return base-operand; return base; },
  cfBaseVal(base,ctx){ if(!base) return 0; if(base.indexOf('cf:')===0){ return Number(ctx.cf?ctx.cf(base.slice(3)):0)||0; } return Number(ctx[base])||0; },
  evalCustomFormula(x,ctx){ const fm=x.formula||{}; const baseV=this.cfBaseVal(fm.base,ctx); let opV,pt; if(fm.operandKind==='source'&&fm.operandSource){ opV=this.cfBaseVal(fm.operandSource,ctx); pt='amount'; } else { opV=fm.operand; pt=fm.operandType||'amount'; } return this.cfApplyFormula(baseV,fm.op||'*',opV,pt); },
  cfDocSources(b,key,selfKey){ const out=[['','— choose —'],['subtotal','Subtotal'],['qty','Quantity'],['price','Unit price'],['taxAmt','VAT amount'],['total','Total amount']]; ((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='field'&&x.dataType==='number'&&x.key!==selfKey).forEach(x=>out.push(['cf:'+x.key,(x.label||'field')+' (number field)'])); return out; },
  cfLineSources(b,key,selfKey){ const out=[['','— choose —'],['subtotal','Subtotal'],['qty','Quantity'],['price','Unit price'],['taxAmt','VAT amount'],['total','Total amount']]; ((this.formCfg(b,key)||{}).custom||[]).filter(x=>x.type==='line'&&x.dataType==='number'&&x.key!==selfKey).forEach(x=>out.push(['cf:'+x.key,(x.label||'column')+' (number field)'])); return out; },
  cfDocCtx(rec){ const lns=rec.lines||[]; let q=0,pr=0; lns.forEach(l=>{ q+=Number(l.qty)||0; pr+=Number(l.price)||0; }); const vat=Number(rec.tax)||0; return {subtotal:Number(rec.subtotal)||0,qty:q,price:pr,taxAmt:vat,tax:vat,total:Number(rec.total)||0,cf:k=>Number((rec.custom&&rec.custom[k])||0)}; },
  cfLineCtx(ln,doc){ doc=doc||{}; const amt=Number(ln.amount)||((Number(ln.qty)||0)*(Number(ln.price)||0)); return {subtotal:Number(doc.subtotal)||0,qty:Number(ln.qty)||0,price:Number(ln.price)||0,taxAmt:Number(ln.taxAmt)||0,total:amt,amount:amt,cf:k=>Number(ln[k]||0)}; },
  addSeparateField(){ const key=this.fmtForm; const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.custom.push({type:'field',key:this._uid('cf'),label:'',value:'',dataType:'text',textType:'single',show:true,pos:'afterMeta'}); this.fmtSel={type:'custom',i:c.custom.length-1}; this.fmtColMenu=false; this.fmtSave(b); this.renderMain(b); },
  addLineField(){ const key=this.fmtForm; const b=this.curBiz(); const c=this.cfgEnsure(b,key); const k=this._uid('lf'); c.custom.push({type:'line',key:k,label:'New column',show:true,w:0,h:0}); if(!c.cols.some(cc=>cc.k===k)) c.cols.push({k:k,show:true,w:0,h:0}); this.fmtSel={type:'col',k:k}; this.fmtColMenu=false; this.fmtSave(b); this.renderMain(b); },
  cfgLineLabel(key,k,val){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); const x=c.custom.find(z=>z.key===k); if(x) x.label=val; this.fmtSave(b); },
  delLineCol(key,k){ const b=this.curBiz(); const c=this.cfgEnsure(b,key); c.custom=c.custom.filter(z=>z.key!==k); c.cols=c.cols.filter(cc=>cc.k!==k); this.fmtSel=null; this.fmtSave(b); this.renderMain(b); },
  cfgResetForm(key){ const b=this.curBiz(); if(this._useDraft(key)){ const sc=this.formSchema(key); this.fmtDraft={show:{},cols:sc.cols.map(x=>({k:x[0],show:true,w:0,h:0})),custom:[]}; this.cfgEnsure(b,key); this.entryOrderFor(b,key); this.gridFor(b,key); this.fmtSel=null; this.fmtColMenu=false; this.renderMain(b); return; }
    if(b.formConfig) delete b.formConfig[key]; this.saveBiz(b); this.renderMain(b); },
  stmtCfg(b){ b.formConfig=b.formConfig||{}; let c=b.formConfig.__statement__; if(!c){ c={show:{},title:''}; b.formConfig.__statement__=c; } if(!c.show) c.show={}; return c; },
  stmtShow(b,ck){ const c=b.formConfig&&b.formConfig.__statement__; return !(c&&c.show&&c.show[ck]===false); },
  statementFmtHtml(b){ const c=this.stmtCfg(b); const opt=(ck,lab)=>'<label class="fmt-chk"><input type="checkbox" '+(this.stmtShow(b,ck)?'checked':'')+' onchange="App.stmtToggle(\''+ck+'\',this.checked)"> '+lab+'</label>';
    const inner='<div class="info-bar">These options apply to every printed statement — customer, supplier, bank, capital, inventory, fixed-asset and the general ledger.</div>'+
      '<div class="fmt-secn">Printed content</div><div class="fmt-chkgrid">'+opt('logo','Business logo')+opt('address','Business name &amp; address')+opt('opening','Opening / brought-forward row')+opt('generated','\u201CGenerated on\u201D footer')+'</div>'+
      '<div class="fmt-secn">Title override</div><input type="text" id="stmt_title" value="'+this.esc(c.title||'')+'" placeholder="Blank = default title (e.g. Customer Statement of Account)" onchange="App.stmtTitle(this.value)" style="max-width:420px">';
    return this.crumbThemes('Statement Formatting')+'<div class="card" style="max-width:640px"><h2>Statement Formatting</h2>'+inner+'<div class="form-actions"><button class="btn" onclick="App.openThemesHub()">◀ Back to Custom Themes</button></div></div>'; },
  stmtToggle(ck,on){ const b=this.curBiz(); const c=this.stmtCfg(b); c.show[ck]=!!on; this.saveBiz(b); },
  stmtTitle(v){ const b=this.curBiz(); const c=this.stmtCfg(b); c.title=v; this.saveBiz(b); },

  set_tax(b){ const codes=b.taxCodes||[];
    const rows=codes.map((t,i)=>'<div class="tax-row"><input class="nm" type="text" value="'+this.esc(t.name)+'" onchange="App.taxSet('+i+',\'name\',this.value)">'+
      '<input class="rt" type="number" step="0.01" value="'+(t.rate==null?'':t.rate)+'" onchange="App.taxSet('+i+',\'rate\',this.value)"><span style="color:#999">%</span>'+
      '<button class="dz-x" onclick="App.taxRemove('+i+')">✕</button></div>').join('');
    const inner='<div class="info-bar">Tax codes appear in the Tax dropdown on Sales &amp; Purchase Invoice line items and drive the tax calculation.</div>'+
      '<div style="display:flex;gap:8px;font-size:11px;color:#999;font-weight:700;text-transform:uppercase;margin-bottom:6px"><span style="flex:1">Name</span><span style="width:110px">Rate</span><span style="width:20px"></span></div>'+
      (rows||'<div style="color:#aaa;margin-bottom:8px">No tax codes yet.</div>')+
      '<button class="btn btn-sm" onclick="App.taxAdd()">+ Add tax code</button>';
    return this.crumb('Settings','Tax Codes')+'<div class="card"><h2>Tax Codes</h2>'+inner+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>'; },
  taxAdd(){ const b=this.curBiz(); b.taxCodes=b.taxCodes||[]; b.taxCodes.push({name:'New tax code',rate:0}); this.saveBiz(b); this.renderMain(b); },
  taxRemove(i){ const b=this.curBiz(); b.taxCodes.splice(i,1); this.saveBiz(b); this.renderMain(b); },
  taxSet(i,field,val){ const b=this.curBiz(); b.taxCodes[i][field]= field==='rate'?(this.parseNum(val)||0):val; this.saveBiz(b); },

  set_coa(b){
    if(this.coaCtx) return this.coaEditor(b);
    const T=b.coaSections||{assets:'Assets',liabilities:'Liabilities',equity:'Equity'}; const BS=['assets','liabilities','equity']; const editableSec={equity:1};
    const handle=id=>'<span class="coa-sort" draggable="true" ondragstart="App.coaDragStart(event,\''+id+'\')" title="Drag to reorder">↕</span>';
    const bsRows=()=>{ let r=''; (b.coaTop&&b.coaTop.bs||BS).forEach(id=>{
        if(BS.indexOf(id)>=0){ const eb=editableSec[id]?'<button class="btn btn-xs" onclick="App.coaEditSection(\''+id+'\',\'bs\')">Edit</button>':'';
          r+='<tr ondragover="App.coaDragOver(event)" ondrop="App.coaDrop(event,\''+id+'\')"><td class="ec">'+eb+'</td><td class="nm bold">'+this.esc(T[id])+'</td><td class="sc"></td></tr>'+this.coaRows(b,id,1); }
        else { const n=b.coa.find(x=>x.id===id); if(n&&n.type==='total') r+=this.coaTotalRow(n); } }); return r; };
    const plRows=()=>{ let r=''; (b.coaTop&&b.coaTop.pl||[]).forEach(id=>{ const n=b.coa.find(x=>x.id===id); if(!n) return;
        if(n.type==='group'){ const tag='<span class="coa-tag">'+(n.plkind==='expense'?'expense':'income')+'</span>';
          r+='<tr ondragover="App.coaDragOver(event)" ondrop="App.coaDrop(event,\''+n.id+'\')"><td class="ec"><button class="btn btn-xs" onclick="App.coaEditNode(\''+n.id+'\')">Edit</button></td>'+
            '<td class="nm bold">'+this.esc(n.name)+(n.code?'<span class="coa-code">'+this.esc(n.code)+'</span>':'')+tag+'</td><td class="sc">'+handle(n.id)+'</td></tr>'+this.coaRows(b,n.id,1); }
        else if(n.type==='total') r+=this.coaTotalRow(n); }); return r; };
    const panel=(title,buttons,rows)=>'<div class="coa-panel"><div class="coa-side-head"><span class="ttl">'+title+'</span><span class="btns">'+buttons+'</span></div>'+
      '<table class="coa-tbl"><thead><tr><th class="ec">✎</th><th>Name</th><th class="sc"></th></tr></thead><tbody>'+(rows||'')+'</tbody></table></div>';
    const bsBtns='<button class="btn btn-xs" onclick="App.coaNew(\'group\',\'bs\')">New Group</button> <button class="btn btn-xs btn-primary" onclick="App.coaNew(\'account\',\'bs\')">New Account</button>';
    const plBtns='<button class="btn btn-xs" onclick="App.coaNew(\'group\',\'pl\')">New Group</button> <button class="btn btn-xs btn-primary" onclick="App.coaNew(\'account\',\'pl\')">New Account</button> <button class="btn btn-xs" onclick="App.coaNew(\'total\',\'pl\')">New Total</button>';
    return this.crumb('Settings','Chart of Accounts')+
      '<div class="info-bar">Build the structure here — names only; balances appear on the Summary. The Profit &amp; Loss side has no default groups: create your own with <b>New Group</b> (choose <b>Income group</b> or <b>Expense group</b>), add <b>accounts</b> into them, add <b>totals</b>, and drag the <b>↕</b> handle to reorder.</div>'+
      '<div class="coa-grid">'+panel('Balance Sheet',bsBtns,bsRows())+panel('Profit and Loss Statement',plBtns,plRows())+'</div>'+
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div>';
  },
  coaTotalRow(n){ return '<tr ondragover="App.coaDragOver(event)" ondrop="App.coaDrop(event,\''+n.id+'\')"><td class="ec"><button class="btn btn-xs" onclick="App.coaEditNode(\''+n.id+'\')">Edit</button></td>'+
    '<td class="nm bold dashed">'+this.esc(n.name)+'</td><td class="sc"><span class="coa-sort" draggable="true" ondragstart="App.coaDragStart(event,\''+n.id+'\')" title="Drag to reorder">↕</span></td></tr>'; },
  coaRows(b,parentKey,depth){
    return b.coa.filter(n=>n.parent===parentKey).map(n=>{
      const oval=n.code?'<span class="coa-code">'+this.esc(n.code)+'</span>':'';
      const tag=n.control?'<span class="coa-tag">control</span>':'';
      const handle='<span class="coa-sort" draggable="true" ondragstart="App.coaDragStart(event,\''+n.id+'\')" title="Drag to reorder">↕</span>';
      const row='<tr ondragover="App.coaDragOver(event)" ondrop="App.coaDrop(event,\''+n.id+'\')">'+
        '<td class="ec"><button class="btn btn-xs" onclick="App.coaEditNode(\''+n.id+'\')">Edit</button></td>'+
        '<td class="nm'+(n.type==='group'?' bold':'')+'" style="padding-left:'+(8+depth*20)+'px">'+this.esc(n.name)+oval+tag+'</td>'+
        '<td class="sc">'+handle+'</td></tr>';
      return n.type==='group' ? row+this.coaRows(b,n.id,depth+1) : row;
    }).join('');
  },
  coaSectionSubtotal(b,key,mov){ mov=mov||accountMovements(b); const sc=k=>k.amt!=null?k.amt:(k.total||0);
    const build=n=> n.type==='group'? {total:b.coa.filter(x=>x.parent===n.id).map(build).reduce((a,k)=>a+sc(k),0)} : {amt:liveBalance(b,n,mov)};
    return b.coa.filter(x=>x.parent===key).map(build).reduce((a,k)=>a+sc(k),0); },
  coaRunningTotals(b){ const out={}; const mov=accountMovements(b); const BS=['assets','liabilities','equity'];
    { let acc=0; (b.coaTop&&b.coaTop.bs||BS).forEach(id=>{ if(BS.indexOf(id)>=0) acc+=this.coaSectionSubtotal(b,id,mov); else { const n=b.coa.find(x=>x.id===id); if(n&&n.type==='total'){ out[id]=acc; } } }); }
    { let acc=0; (b.coaTop&&b.coaTop.pl||[]).forEach(id=>{ const n=b.coa.find(x=>x.id===id); if(!n) return; if(n.type==='group') acc+=((n.plkind==='expense')?-1:1)*this.coaSectionSubtotal(b,id,mov); else if(n.type==='total'){ out[id]=acc; } }); }
    return out; },
  coaSideOf(b,n){ let p=n.parent,g=0; const roots=['assets','liabilities','equity','pl']; while(p&&roots.indexOf(p)<0&&g++<60){ const x=b.coa.find(y=>y.id===p); if(!x)break; p=x.parent; } return p==='pl'?'pl':'bs'; },
  /* ----- the five elements (FIX_SPEC_4 #1) -----
     The one list every account-creation form offers as its Group: the Chart of
     Accounts editor and the inline "＋ Add New Account" dialog both build from it,
     so Income / Expenses are always there — also before the business has any
     Profit & Loss group (a new chart has none). "Income" / "Expenses" carry a
     sentinel value that coaResolveParent turns into the proper P&L group. */
  COA_ELEMENTS:[
    {key:'assets',      label:'Assets',      side:'bs', value:'assets',      nature:'D'},
    {key:'liabilities', label:'Liabilities', side:'bs', value:'liabilities', nature:'C'},
    {key:'equity',      label:'Equity',      side:'bs', value:'equity',      nature:'C'},
    {key:'income',      label:'Income',      side:'pl', value:'@income',     nature:'C', plkind:'income'},
    {key:'expense',     label:'Expenses',    side:'pl', value:'@expense',    nature:'D', plkind:'expense'}],
  /* the Group a new account starts on, by the form it is created from (the user can change it) */
  COA_CONTEXT_DEFAULT:{ salesInv:'@income', creditNotes:'@income', salesQuotes:'@income', salesOrders:'@income',
    purchInv:'@expense', debitNotes:'@expense', purchQuotes:'@expense', purchOrders:'@expense', bankCash:'assets',
    sales:'@income', purchase:'@expense' },   /* the shared invoice form tags its account lists data-qc-context="sales" | "purchase" */
  COA_GROUP_REQUIRED:'Group is required — choose Assets, Liabilities, Equity, Income or Expenses.',
  coaDefaultGroupFor(key){ return (key && this.COA_CONTEXT_DEFAULT[key]) || ''; },
  /* top-level P&L groups of one kind, in statement order (no plkind reads as income, as acctRoot does) */
  coaPlGroupsOf(b,kind){ const order=(b.coaTop&&b.coaTop.pl)||[]; const pos=id=>{ const i=order.indexOf(id); return i<0?1e9:i; };
    return (b.coa||[]).filter(n=>n&&n.type==='group'&&n.parent==='pl'&&((n.plkind==='expense')?'expense':'income')===kind).sort((x,y)=>pos(x.id)-pos(y.id)); },
  _coaIsElementName(name,kind){ return kind==='expense' ? /^expenses?$/i.test(String(name||'').trim()) : /^income$/i.test(String(name||'').trim()); },
  /* The P&L group behind plain "Income" / "Expenses": the top-level group of that name, else the first
     one of that kind, else a new one — always listed in coaTop.pl, so it shows on the statement. */
  coaElementGroup(b,kind){ kind=kind==='expense'?'expense':'income'; b.coa=b.coa||[]; b.coaTop=b.coaTop||{bs:['assets','liabilities','equity'],pl:[]}; b.coaTop.pl=b.coaTop.pl||[];
    const gs=this.coaPlGroupsOf(b,kind); let g=gs.find(x=>this._coaIsElementName(x.name,kind))||gs[0];
    if(!g){ let id='sys_g_'+kind; if(b.coa.some(n=>n&&n.id===id)) id='g'+kind+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
      g={id,type:'group',name:kind==='income'?'Income':'Expenses',code:'',parent:'pl',plkind:kind}; b.coa.push(g); }
    if(b.coaTop.pl.indexOf(g.id)<0) this.plInsert(b,g.id);
    return g.id; },
  /* Group options for an account: the five elements, each with its own groups nested beneath it.
     The P&L group that *is* the element (named "Income" / "Expenses") is folded into the element row. */
  coaElementOptions(b,excludeId){ const opts=[];
    const add=(pk,d,el)=>{ (b.coa||[]).filter(n=>n.type==='group'&&n.parent===pk&&n.id!==excludeId).forEach(g=>{ opts.push({value:g.id,label:g.name,depth:d,element:el}); add(g.id,d+1,el); }); };
    this.COA_ELEMENTS.forEach(e=>{ opts.push({value:e.value,label:e.label,depth:0,element:e.key});
      if(e.side==='bs'){ add(e.value,1,e.key); return; }
      const gs=this.coaPlGroupsOf(b,e.plkind).filter(g=>g.id!==excludeId); const home=gs.find(g=>this._coaIsElementName(g.name,e.plkind));
      gs.forEach(g=>{ if(g===home){ add(g.id,1,e.key); return; } opts.push({value:g.id,label:g.name,depth:1,element:e.key}); add(g.id,2,e.key); }); });
    return opts; },
  /* the option value that stands for an account's current parent (its home P&L group shows as the element) */
  coaElementValueOf(b,parent){ const opts=this.coaElementOptions(b,null); if(opts.some(o=>String(o.value)===String(parent))) return parent;
    const n=(b.coa||[]).find(x=>x.id===parent); if(n&&n.type==='group'&&n.parent==='pl') return n.plkind==='expense'?'@expense':'@income'; return parent; },
  /* "Sale" / "Sales" created under Expenses because the Group list had no Income (FIX_SPEC_4 #1.6):
     moved once into the Income group. Returns true when `b` changed and needs saving. */
  coaFixSaleIncome(b){ if(!b||!b.coa||b._fix4SaleIncome) return false; const moved=[];
    b.coa.forEach(n=>{ if(!n||n.type!=='account'||!/^sales?$/i.test(String(n.name||'').trim())) return;
      let root='assets'; try{ root=acctRoot(b,n); }catch(e){} if(root!=='expense') return;
      const from=((b.coa.find(x=>x.id===n.parent)||{}).name)||n.parent; n.parent=this.coaElementGroup(b,'income'); moved.push({name:n.name,from}); });
    b._fix4SaleIncome=1;
    if(moved.length){ try{ refreshSummary(b); }catch(e){}
      moved.forEach(m=>{ try{ this._logActivity(b,'update','coa',null,null,{label:'Chart of Accounts — account “'+m.name+'” moved from '+m.from+' to Income'}); }catch(e){} }); }
    return true; },
  coaGroupOptions(b,side,excludeId){ if(side==='all') return this.coaElementOptions(b,excludeId); let opts=[];
    const add=(pk,d)=>{ b.coa.filter(n=>n.type==='group'&&n.parent===pk&&n.id!==excludeId).forEach(g=>{ opts.push({value:g.id,label:g.name,depth:d}); add(g.id,d+1); }); };
    if(side==='bs'){ const T=b.coaSections||{}; [['assets',T.assets||'Assets'],['liabilities',T.liabilities||'Liabilities'],['equity',T.equity||'Equity']].forEach(s=>{ opts.push({value:s[0],label:s[1],depth:0}); add(s[0],1); }); }
    else add('pl',0);
    return opts; },
  coaEditor(b){ const ctx=this.coaCtx; const node=ctx.id?b.coa.find(n=>n.id===ctx.id):null;
    const sideLabel=ctx.side==='bs'?'Balance Sheet':'Profit and Loss';
    let title, inner;
    if(ctx.kind==='section'){ title='Edit '+sideLabel+' Group';
      inner='<label class="fld">Name</label><input id="coa_name" type="text" value="'+this.esc((b.coaSections||{})[ctx.sectionKey]||'')+'">'; }
    else if(ctx.kind==='total'){ title=(node?'Edit ':'New ')+'Total';
      inner='<label class="fld">Total name</label><input id="coa_name" type="text" value="'+this.esc(node?node.name:'')+'" placeholder="e.g. Net profit (loss), Gross profit">'+
        '<div style="color:#999;font-size:12px;margin-top:8px">A total shows a running sum of the sections/groups above it (down to the previous total). Drag the ↕ handle to position it.</div>'; }
    else if(ctx.kind==='group'){ title=(node?'Edit ':'New ')+sideLabel+' Group';
      inner='<label class="fld">Name</label><input id="coa_name" type="text" value="'+this.esc(node?node.name:'')+'">'+
        '<label class="fld">Code</label><input id="coa_code" type="text" value="'+this.esc(node?node.code:'')+'" placeholder="optional">';
      if(ctx.side==='pl'){ const curType=node?(node.parent==='pl'?(node.plkind==='expense'?'Expense group':'Income group'):'Subgroup of'):'Income group';
        const tyOpt=['Income group','Expense group','Subgroup of'].map(o=>'<option'+(curType===o?' selected':'')+'>'+o+'</option>').join('');
        const subOpts=b.coa.filter(n=>n.type==='group'&&this.coaSideOf(b,n)==='pl'&&n.id!==ctx.id).map(g=>'<option value="'+g.id+'"'+(node&&node.parent===g.id?' selected':'')+'>'+this.esc(g.name)+'</option>').join('');
        inner+='<label class="fld">Type</label><select id="coa_type" onchange="App.coaTypeToggle(this.value)">'+tyOpt+'</select>'+
          '<div id="coa_subwrap" style="display:'+(curType==='Subgroup of'?'block':'none')+'"><label class="fld">Subgroup of</label><select id="coa_sub">'+(subOpts||'<option value="">(no groups yet)</option>')+'</select></div>'; }
      else { const curParent=node?node.parent:'assets';
        const opts=this.coaGroupOptions(b,'bs',ctx.id).map(o=>'<option value="'+o.value+'"'+(String(curParent)===String(o.value)?' selected':'')+'>'+'\u00A0\u00A0\u00A0\u00A0'.repeat(o.depth)+this.esc(o.label)+'</option>').join('');
        inner+='<label class="fld">Group</label><select id="coa_parent">'+opts+'</select>'; } }
    else { title=(node?'Edit ':'New ')+sideLabel+' Account';
      /* the five elements with their groups (COA_ELEMENTS) — a new account picks its Group, none is assumed */
      const gopts=this.coaGroupOptions(b,'all',null); const curParent=node?this.coaElementValueOf(b,node.parent):'';
      const optsHtml='<option value=""'+(curParent?'':' selected')+'>\u2014 select group \u2014</option>'+gopts.map(o=>'<option value="'+this.esc(o.value)+'"'+(String(curParent)===String(o.value)?' selected':'')+(o.depth?'':' style="font-weight:600"')+'>'+'\u00A0\u00A0\u00A0\u00A0'.repeat(o.depth)+this.esc(o.label)+'</option>').join('');
      inner='<label class="fld">Name</label><input id="coa_name" type="text" value="'+this.esc(node?node.name:'')+'">'+
        '<label class="fld">Code</label><input id="coa_code" type="text" value="'+this.esc(node?node.code:'')+'" placeholder="optional, e.g. 1200">'+
        '<label class="fld">Group</label><select id="coa_parent">'+optsHtml+'</select>'+
        '<div style="color:#999;font-size:12px;margin-top:4px">Choose Assets, Liabilities, Equity, Income or Expenses (or one of their groups). Income / Expenses accounts go to the Profit &amp; Loss statement.</div>'+
        '<label class="fld">Starting balance</label><input id="coa_bal" type="text" inputmode="decimal" value="'+(node&&node.balance?node.balance:'')+'" placeholder="0.00">'+
        (node&&node.control?'<div style="color:#999;font-size:12px;margin-top:6px">This is a control account. Its balance is this starting figure plus the movements in its subsidiary ledger (customers, suppliers, bank &amp; cash accounts, and so on), so it updates automatically as you post transactions.</div>':''); }
    const canDel=node&&ctx.kind!=='section'&&!node.mandatory&&!node.control&&!(ctx.kind==='group'&&b.coa.some(n=>n.parent===node.id));
    const del=(node&&ctx.kind!=='section')?('<button class="btn btn-danger" style="margin-left:auto" onclick="App.coaDelete(\''+node.id+'\')"'+(canDel?'':' disabled')+'>Delete</button>'):'';
    return this.crumb('Settings','Chart of Accounts ▸ '+(node||ctx.kind==='section'?'Edit':'New'))+
      '<div class="card"><h2>'+this.esc(title)+'</h2>'+inner+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.coaSave()">'+((node||ctx.kind==='section')?'Update':'Create')+'</button>'+
      '<button class="btn" onclick="App.coaCancel()">Cancel</button>'+del+'</div></div>';
  },
  coaTypeToggle(v){ const w=document.getElementById('coa_subwrap'); if(w) w.style.display=(v==='Subgroup of')?'block':'none'; },
  coaNew(kind,side){ this.coaCtx={kind,side,id:null}; this.renderMain(this.curBiz()); },
  coaEditSection(key,side){ this.coaCtx={kind:'section',side,sectionKey:key,id:null}; this.renderMain(this.curBiz()); },
  coaEditNode(id){ const b=this.curBiz(); const n=b.coa.find(x=>x.id===id); if(!n) return; this.coaCtx={kind:n.type,side:n.type==='total'?n.side:this.coaSideOf(b,n),id}; this.renderMain(b); },
  coaCancel(){ this.coaCtx=null; this.renderMain(this.curBiz()); },
  plInsert(b,id){ b.coaTop.pl=b.coaTop.pl||[]; const ti=b.coaTop.pl.findIndex(x=>{ const n=b.coa.find(y=>y.id===x); return n&&n.type==='total'; }); if(ti<0) b.coaTop.pl.push(id); else b.coaTop.pl.splice(ti,0,id); },
  coaSave(){ const b=this.curBiz(); const ctx=this.coaCtx; const nameEl=document.getElementById('coa_name'); const name=nameEl?nameEl.value.trim():'';
    if(!name){ alert('Name is required.'); return; }
    if(ctx.kind==='section'){ b.coaSections[ctx.sectionKey]=name; refreshSummary(b); this.saveBiz(b); this.coaCtx=null; this.renderMain(b); return; }
    if(ctx.kind==='total'){ if(ctx.id){ b.coa.find(x=>x.id===ctx.id).name=name; }
      else { const id='t'+Math.random().toString(36).slice(2,10); b.coa.push({id,type:'total',side:ctx.side,name}); (b.coaTop[ctx.side]=b.coaTop[ctx.side]||[]).push(id); }
      this.saveBiz(b); this.coaCtx=null; this.renderMain(b); return; }
    const code=((document.getElementById('coa_code')||{}).value||'').trim();
    if(ctx.kind==='group'){
      let parent, plkind=null;
      if(ctx.side==='pl'){ const ty=document.getElementById('coa_type').value;
        if(ty==='Income group'){ parent='pl'; plkind='income'; } else if(ty==='Expense group'){ parent='pl'; plkind='expense'; }
        else { parent=(document.getElementById('coa_sub')||{}).value||'pl'; } }
      else parent=(document.getElementById('coa_parent')||{}).value;
      if(ctx.id){ const n=b.coa.find(x=>x.id===ctx.id); n.name=name; n.code=code; n.parent=parent; if(plkind) n.plkind=plkind; else delete n.plkind;
        if(ctx.side==='pl'){ const inTop=b.coaTop.pl.indexOf(ctx.id)>=0; if(parent==='pl'&&!inTop) this.plInsert(b,ctx.id); if(parent!=='pl'&&inTop) b.coaTop.pl=b.coaTop.pl.filter(x=>x!==ctx.id); } }
      else { const id='g'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36); const node={id,type:'group',name,code,parent}; if(plkind) node.plkind=plkind; b.coa.push(node); if(parent==='pl') this.plInsert(b,id); }
      refreshSummary(b); this.saveBiz(b); this.coaCtx=null; this.renderMain(b); return;
    }
    // account
    if(!((document.getElementById('coa_parent')||{}).value)){ alert(this.COA_GROUP_REQUIRED); return; }
    const bal=this.parseNum((document.getElementById('coa_bal')||{}).value)||0;
    if(ctx.id){ const parent=this.coaResolveParent(b,ctx.side,(document.getElementById('coa_parent')||{}).value);
      const n=b.coa.find(x=>x.id===ctx.id); n.name=name; n.code=code; n.parent=parent; n.balance=bal; }
    else { const r=this.coaCreateAccount(b,{name,code,parent:(document.getElementById('coa_parent')||{}).value,side:ctx.side,balance:bal});
      if(!r.ok){ alert(r.error); return; } }
    refreshSummary(b); this.saveBiz(b); this.coaCtx=null; this.renderMain(b); },
  /* A Profit & Loss account needs a group to live in; make one if there is none. */
  coaResolveParent(b,side,parent){
    if(parent==='@income' || parent==='@expense') return this.coaElementGroup(b,parent.slice(1));   /* plain Income / Expenses (COA_ELEMENTS) */
    if(side==='pl' && !parent){ const gid='g'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
      b.coa.push({id:gid,type:'group',name:'Uncategorised',code:'',parent:'pl',plkind:'income'}); this.plInsert(b,gid); return gid; }
    return parent; },
  /* Add one account to the chart. Shared by the Chart of Accounts editor and the
     quick-create dialog. Does not save — the caller does, so it can batch. */
  coaCreateAccount(b,o){
    o=o||{}; const name=String(o.name||'').trim();
    if(!name) return {ok:false,error:'Name is required.',field:'name'};
    if((b.coa||[]).some(n=>n.type==='account' && String(n.name||'').trim().toLowerCase()===name.toLowerCase()))
      return {ok:false,error:'An account named \u201c'+name+'\u201d already exists.',field:'name'};
    const parent=this.coaResolveParent(b,o.side||'bs',o.parent);
    const id='a'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36);
    const node={id,type:'account',name,code:String(o.code||'').trim(),parent,balance:this.parseNum(o.balance)||0};
    b.coa.push(node);
    return {ok:true,node}; },
  coaDelete(id){ const b=this.curBiz(); const n=b.coa.find(x=>x.id===id); if(!n) return;
    if(n.mandatory||n.control){ alert('This account can\u2019t be deleted.'); return; }
    if(n.type==='group'&&b.coa.some(x=>x.parent===id)){ alert('Move or delete the accounts inside this group first.'); return; }
    if(!this._ask('Delete \u201c'+n.name+'\u201d?',()=>this.coaDelete(id))) return;
    b.coa=b.coa.filter(x=>x.id!==id);
    if(n.type==='total'&&b.coaTop){ ['bs','pl'].forEach(s=>{ b.coaTop[s]=b.coaTop[s].filter(x=>x!==id); }); }
    refreshSummary(b); this.saveBiz(b); this.coaCtx=null; this.renderMain(b); },
  coaDragStart(e,id){ this._coaDrag=id; if(e.dataTransfer){ e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain',id);}catch(x){} } },
  coaDragOver(e){ e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect='move'; },
  coaDrop(e,targetId){ e.preventDefault(); const src=this._coaDrag; this._coaDrag=null; if(!src||src===targetId) return;
    const b=this.curBiz(); const sn=b.coa.find(x=>x.id===src); if(!sn) return;
    const side = sn.type==='total'? sn.side : this.coaSideOf(b,sn); const top=b.coaTop&&b.coaTop[side];
    if(top && top.indexOf(src)>=0){ top.splice(top.indexOf(src),1); let ti=top.indexOf(targetId); if(ti<0) ti=top.length; top.splice(ti,0,src); this.saveBiz(b); this.renderMain(b); return; }
    const tn=b.coa.find(x=>x.id===targetId);
    if(tn && sn.parent===tn.parent){ const arr=b.coa; arr.splice(arr.indexOf(sn),1); arr.splice(arr.indexOf(tn),0,sn); refreshSummary(b); this.saveBiz(b); this.renderMain(b); return; }
    if(['assets','liabilities','equity'].indexOf(targetId)>=0 && side==='bs' && sn.type!=='total'){ sn.parent=targetId; refreshSummary(b); this.saveBiz(b); this.renderMain(b); }
  },

  /* ----- summary + period ----- */
  /* ===================================================================
     DASHBOARD
     Every figure below comes from the same engine the reports use —
     summaryFromCoa, glEntries, cashTotal, liveBalance, invStatus — so the
     dashboard can never disagree with the Balance Sheet underneath it.
     Charts are drawn as inline SVG; there is no chart library to load.
     =================================================================== */
  dashPeriod(b){ const p=periodOf(b);
    if(p.from&&p.to) return {from:p.from,to:p.to};
    const to=new Date().toISOString().slice(0,10);
    return {from:this._isoShift(to,0,-11)||'',to:to}; },
  /* n month buckets ending at `to`, oldest first */
  _dashMonths(to,n){ const out=[]; var cur=String(to||new Date().toISOString().slice(0,10)).slice(0,7)+'-01';
    for(var i=n-1;i>=0;i--){ var d=this._isoShift(cur,0,-i); if(!d) continue;
      var mo=+d.slice(5,7);
      out.push({key:d.slice(0,7),label:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo-1]}); }
    return out; },
  _plAccounts(b,kind){ return (b.coa||[]).filter(function(n){
      return n.type==='account' && acctRoot(b,n)===kind; }); },
  /* Monthly income and expense totals, one glEntries pass per account. */
  _dashSeries(b,months){
    var idx={}; months.forEach(function(m,i){ idx[m.key]=i; });
    var inc=new Array(months.length).fill(0), exp=new Array(months.length).fill(0);
    var walk=function(accts,arr,creditNatured){
      accts.forEach(function(a){ var ge;
        try{ ge=glEntries(b,a.id); }catch(e){ return; }
        (ge.rows||[]).forEach(function(r){ var k=String(r.date||'').slice(0,7); var i=idx[k];
          if(i==null) return; var d=Number(r.debit)||0,c=Number(r.credit)||0;
          arr[i]+= creditNatured ? (c-d) : (d-c); }); }); };
    walk(this._plAccounts(b,'income'),inc,true);
    walk(this._plAccounts(b,'expense'),exp,false);
    return {inc:inc,exp:exp}; },
  _dashTotals(b,from,to){
    var self=this; var inc=0,exp=0;
    this._plAccounts(b,'income').forEach(function(a){ inc+=self._acctPeriod(b,a.id,from,to); });
    this._plAccounts(b,'expense').forEach(function(a){ exp+=self._acctPeriod(b,a.id,from,to); });
    return {revenue:inc,expenses:exp,profit:inc-exp}; },
  /* Cash in / out over the period, straight off the bank ledgers. */
  _dashCash(b,from,to){ var self=this; var R=b.records||{}; var inp=0,out=0;
    (R.receipts||[]).forEach(function(r){ if(self._inRange(r.date,from,to)) inp+=Number(r.amount)||0; });
    (R.payments||[]).forEach(function(r){ if(self._inRange(r.date,from,to)) out+=Number(r.amount)||0; });
    return {in:inp,out:out,net:inp-out}; },
  _dashInvoiceStatus(b){ var self=this; var out={Paid:0,'Partially paid':0,Unpaid:0,Overdue:0,Draft:0};
    ((b.records&&b.records.salesInv)||[]).forEach(function(r){ var st=self.invStatus(r);
      if(out[st]==null) out[st]=0; out[st]++; });
    return out; },
  _dashExpenseBreakdown(b,from,to,limit){ var self=this;
    var rows=this._plAccounts(b,'expense').map(function(a){
      return {name:a.name,amt:self._acctPeriod(b,a.id,from,to)}; })
      .filter(function(r){ return Math.abs(r.amt)>0.005; })
      .sort(function(x,y){ return y.amt-x.amt; });
    return rows.slice(0,limit||6); },
  _dashRecent(b,limit){ var self=this; var R=b.records||{}; var out=[];
    (R.receipts||[]).forEach(function(r){ out.push({date:r.date,t:r.paidBy||r.description||'Receipt',
      s:'Receipt'+(r.receivedIn?(' · '+r.receivedIn):''),amt:Number(r.amount)||0,dir:'in'}); });
    (R.payments||[]).forEach(function(r){ out.push({date:r.date,t:r.payee||r.description||'Payment',
      s:'Payment'+(r.paidFrom?(' · '+r.paidFrom):''),amt:Number(r.amount)||0,dir:'out'}); });
    (R.salesInv||[]).forEach(function(r){ out.push({date:r.issueDate||r.date,t:r.customer||'Sales invoice',
      s:'Sales invoice'+(r.reference?(' · '+r.reference):''),amt:Number(r.total)||0,dir:'in'}); });
    (R.purchInv||[]).forEach(function(r){ out.push({date:r.issueDate||r.date,t:r.supplier||'Purchase invoice',
      s:'Purchase invoice'+(r.reference?(' · '+r.reference):''),amt:Number(r.total)||0,dir:'out'}); });
    out.sort(function(x,y){ return String(y.date||'').localeCompare(String(x.date||'')); });
    return out.slice(0,limit||6); },
  _dashUpcoming(b,limit){ var self=this; var out=[];
    ((b.records&&b.records.salesInv)||[]).forEach(function(r){ var st=self.invStatus(r); if(st==='Paid') return;
      out.push({party:r.customer||'(no customer)',due:r.dueDate||'',st:st,dir:'in',
        amt:Number(r.balanceDue!=null?r.balanceDue:r.total)||0}); });
    ((b.records&&b.records.purchInv)||[]).forEach(function(r){ var st=self.invStatus(r); if(st==='Paid') return;
      out.push({party:r.supplier||'(no supplier)',due:r.dueDate||'',st:st,dir:'out',
        amt:Number(r.balanceDue!=null?r.balanceDue:r.total)||0}); });
    out.sort(function(x,y){ return String(x.due||'9999').localeCompare(String(y.due||'9999')); });
    return out.slice(0,limit||5); },
  /* A 0–100 blend of margin, cash runway and how much receivable is overdue.
     Deliberately simple, and the caption on the card says what feeds it. */
  _dashHealth(b,tot,cash){
    var margin = tot.revenue>0 ? Math.max(0,Math.min(1,tot.profit/tot.revenue)) : (tot.expenses>0?0:0.5);
    var monthly = tot.expenses>0 ? tot.expenses/12 : 0;
    var runway = monthly>0 ? Math.max(0,Math.min(1,(cash/monthly)/6)) : (cash>0?1:0.5);
    var self=this; var arTot=0, arOver=0;
    ((b.records&&b.records.salesInv)||[]).forEach(function(r){ var st=self.invStatus(r); if(st==='Paid') return;
      var a=Number(r.balanceDue!=null?r.balanceDue:r.total)||0; arTot+=a; if(st==='Overdue') arOver+=a; });
    var collect = arTot>0 ? 1-(arOver/arTot) : 1;
    return Math.round((margin*0.4 + runway*0.35 + collect*0.25)*100); },

  /* ---- svg building blocks ---- */
  _svgPath(vals,w,h,pad,max){ if(!vals.length) return '';
    var n=vals.length, span=Math.max(1,n-1);
    return vals.map(function(v,i){
      var x=pad+ (i/span)*(w-pad*2);
      var y=h-pad-((max>0?v/max:0)*(h-pad*2));
      return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1); }).join(' '); },
  _dashChart(b,months,series){
    var w=760,h=240,pad=28;
    var all=series.inc.concat(series.exp).map(Math.abs);
    var max=Math.max.apply(null,all.concat([1]));
    if(!all.some(function(v){ return v>0.005; }))
      return '<div class="chart-empty">No income or expenses recorded in this period yet.<br>'+
        'They will appear here as soon as you post an invoice, receipt or payment.</div>';
    var self=this;
    var line=function(vals){ return self._svgPath(vals,w,h,pad,max); };
    var area=function(vals){ var p=line(vals); if(!p) return '';
      var span=Math.max(1,vals.length-1);
      return p+' L'+(pad+(w-pad*2)).toFixed(1)+' '+(h-pad)+' L'+pad+' '+(h-pad)+' Z'; };
    var grid=''; for(var g=0;g<=3;g++){ var y=pad+(g/3)*(h-pad*2);
      grid+='<line class="chart-grid" x1="'+pad+'" y1="'+y.toFixed(1)+'" x2="'+(w-pad)+'" y2="'+y.toFixed(1)+'"/>'; }
    var labels=months.map(function(m,i){
      if(months.length>8 && i%2) return '';
      var x=pad+(i/Math.max(1,months.length-1))*(w-pad*2);
      return '<text class="chart-axis" x="'+x.toFixed(1)+'" y="'+(h-8)+'" text-anchor="middle">'+m.label+'</text>'; }).join('');
    var dots=function(vals,cls){ return vals.map(function(v,i){
      var x=pad+(i/Math.max(1,vals.length-1))*(w-pad*2);
      var y=h-pad-((max>0?v/max:0)*(h-pad*2));
      return '<circle class="chart-dot" stroke="'+cls+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3"/>'; }).join(''); };
    return '<div class="chart-wrap"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Revenue against expenses by month">'+
      '<defs>'+
        '<linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">'+
          '<stop offset="0%" stop-color="var(--accent-solid)" stop-opacity=".26"/>'+
          '<stop offset="100%" stop-color="var(--accent-solid)" stop-opacity="0"/></linearGradient>'+
        '<linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">'+
          '<stop offset="0%" stop-color="var(--info)" stop-opacity=".16"/>'+
          '<stop offset="100%" stop-color="var(--info)" stop-opacity="0"/></linearGradient>'+
      '</defs>'+grid+
      '<path class="chart-area-rev" d="'+area(series.inc)+'"/>'+
      '<path class="chart-line-rev" d="'+line(series.inc)+'"/>'+
      '<path class="chart-line-exp" d="'+line(series.exp)+'"/>'+
      dots(series.inc,'var(--accent-solid)')+
      labels+'</svg></div>'+
      '<div class="legend"><span><i style="background:var(--accent-solid)"></i>Revenue</span>'+
      '<span><i style="background:var(--info)"></i>Expenses</span></div>'; },
  _dashDonut(counts){
    var order=[['Paid','var(--success)'],['Partially paid','var(--info)'],['Unpaid','var(--warn)'],['Overdue','var(--danger)'],['Draft','var(--muted-2)']];
    var total=order.reduce(function(a,o){ return a+(counts[o[0]]||0); },0);
    var r=52,c=2*Math.PI*r,off=0;
    var arcs=order.map(function(o){ var v=counts[o[0]]||0; if(!v) return '';
      var frac=total?v/total:0; var len=frac*c;
      var seg='<circle cx="64" cy="64" r="'+r+'" fill="none" stroke="'+o[1]+'" stroke-width="17"'+
        ' stroke-dasharray="'+len.toFixed(2)+' '+(c-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"'+
        ' stroke-linecap="butt"/>';
      off+=len; return seg; }).join('');
    var key=order.map(function(o){ var v=counts[o[0]]||0;
      return '<div><i style="background:'+o[1]+'"></i>'+o[0]+'<b>'+v+'</b></div>'; }).join('');
    var ring = total
      ? '<svg width="128" height="128"><circle cx="64" cy="64" r="'+r+'" fill="none" stroke="var(--surface-3)" stroke-width="17"/>'+arcs+'</svg>'
      : '<svg width="128" height="128"><circle cx="64" cy="64" r="'+r+'" fill="none" stroke="var(--surface-3)" stroke-width="17"/></svg>';
    return '<div class="ring-wrap"><div class="ring">'+ring+
      '<span class="ring-mid"><b>'+total+'</b><span>invoice'+(total===1?'':'s')+'</span></span></div>'+
      '<div class="ring-key">'+key+'</div></div>'; },
  _dashGauge(pct){
    pct=Math.max(0,Math.min(100,pct||0));
    var w=220,h=124,cx=110,cy=112,r=88;
    var pt=function(frac){ var a=Math.PI*(1-frac);
      return [(cx+r*Math.cos(a)).toFixed(1),(cy-r*Math.sin(a)).toFixed(1)]; };
    var a0=pt(0),a1=pt(pct/100);
    var track='M'+a0[0]+' '+a0[1]+' A'+r+' '+r+' 0 0 1 '+pt(1)[0]+' '+pt(1)[1];
    var fill ='M'+a0[0]+' '+a0[1]+' A'+r+' '+r+' 0 0 1 '+a1[0]+' '+a1[1];
    var col = pct>=70?'var(--success)':(pct>=45?'var(--warn)':'var(--danger)');
    return '<div class="gauge-wrap"><svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" role="img"'+
      ' aria-label="Financial health '+pct+' out of 100">'+
      '<path d="'+track+'" fill="none" stroke="var(--surface-3)" stroke-width="15" stroke-linecap="round"/>'+
      (pct>0?'<path d="'+fill+'" fill="none" stroke="'+col+'" stroke-width="15" stroke-linecap="round"/>':'')+
      '</svg><div class="gauge-val">'+pct+'%</div><div class="gauge-cap">'+
      (pct>=70?'Strong':(pct>=45?'Fair':'Needs attention'))+'</div></div>'; },

  /* ---- the dashboard itself ---- */
  dashboardHtml(b){
    var self=this; var e=function(x){ return self.esc(x); };
    var I=function(n,sz){ return (typeof window!=='undefined'&&window.ICO)?ICO.get(n,sz||18):''; };
    var per=this.dashPeriod(b); var from=per.from,to=per.to;
    var nMonths=this._dashRange||12;
    var months=this._dashMonths(to,nMonths);
    var series,tot,cash,cf,counts,cats,recent,upcoming,health,arBal,arCount;
    try{
      series=this._dashSeries(b,months);
      tot=this._dashTotals(b,from,to);
      cash=cashTotal(b);
      cf=this._dashCash(b,from,to);
      counts=this._dashInvoiceStatus(b);
      cats=this._dashExpenseBreakdown(b,from,to,6);
      recent=this._dashRecent(b,6);
      upcoming=this._dashUpcoming(b,5);
      var ar=findAcct(b,'Accounts receivable');
      arBal=ar?liveBalance(b,ar):0;
      arCount=((b.records&&b.records.salesInv)||[]).filter(function(r){ return self.invStatus(r)!=='Paid'; }).length;
      health=this._dashHealth(b,tot,cash);
    }catch(err){
      return '<div class="info-bar">The dashboard could not be built: '+e(String(err&&err.message||err))+
        '</div>'; }

    /* stat cards */
    var note=function(cls,ico,txt){ return '<span class="stat-note '+cls+'">'+I(ico,14)+e(txt)+'</span>'; };
    var prev=months.length>1?series.inc[months.length-2]:0, last=series.inc[months.length-1]||0;
    var revDelta = prev>0 ? Math.round(((last-prev)/prev)*1000)/10 : null;
    var pExp=months.length>1?series.exp[months.length-2]:0, lExp=series.exp[months.length-1]||0;
    var expDelta = pExp>0 ? Math.round(((lExp-pExp)/pExp)*1000)/10 : null;
    var cur=(b.baseCurrency||'');
    var money=function(v){ return '<span class="cur">'+e(cur)+'</span>'+self.money(v); };

    var card=function(cls,ico,label,val,noteHtml){
      return '<div class="stat '+cls+'"><span class="stat-ico">'+I(ico,20)+'</span>'+
        '<span class="stat-body"><span class="stat-label">'+e(label)+'</span>'+
        '<span class="stat-value">'+val+'</span></span>'+noteHtml+'</div>'; };
    var nBank=((b.records&&b.records.bankCash)||[]).length;
    var stats='<div class="dash-stats">'+
      card('g','trendUp','Total revenue',money(tot.revenue),
        revDelta===null?note('','chart','No prior month to compare')
          :note(revDelta>=0?'up':'down',revDelta>=0?'arrowUpRight':'arrowDownRight',
                Math.abs(revDelta)+'% vs last month'))+
      card('o','bag','Total expenses',money(tot.expenses),
        expDelta===null?note('','chart','No prior month to compare')
          :note(expDelta<=0?'up':'down',expDelta<=0?'arrowDownRight':'arrowUpRight',
                Math.abs(expDelta)+'% vs last month'))+
      card('b','invoice','Outstanding receivables',money(arBal),
        note('','clock',arCount+' unpaid invoice'+(arCount===1?'':'s')))+
      card('v','wallet2','Cash balance',money(cash),
        note('','bank',nBank+' bank & cash account'+(nBank===1?'':'s')))+
      '</div>';

    /* main chart */
    var seg=function(n,lbl){ return '<button class="'+(nMonths===n?'on':'')+'" onclick="App.dashRange('+n+')">'+lbl+'</button>'; };
    var chart='<div class="dash-panel"><div class="dash-ph"><div>'+
      '<h3>Financial Overview</h3>'+
      '<span class="sub">Revenue against expenses, '+e(months.length)+' months to '+e(this.fmtDateUS(to))+'</span></div>'+
      '<div class="right"><div class="seg-sw">'+seg(3,'3M')+seg(6,'6M')+seg(12,'12M')+'</div></div></div>'+
      this._dashChart(b,months,series)+'</div>';

    /* cash flow + invoice status */
    var cfMax=Math.max(cf.in,cf.out,1);
    var bar=function(lbl,v,col){ return '<div class="cat-row"><div class="cat-top">'+
      '<span class="cat-name">'+lbl+'</span><span class="cat-val">'+self.money(v)+'</span></div>'+
      '<div class="cat-bar"><i style="width:'+((v/cfMax)*100).toFixed(1)+'%;background:'+col+'"></i></div></div>'; };
    var cashPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Cash Flow</h3>'+
      '<span class="sub">Money in against money out this period</span></div></div>'+
      '<div class="cat">'+bar('Money in',cf.in,'var(--success)')+bar('Money out',cf.out,'var(--danger)')+'</div>'+
      '<div class="dlist-row" style="margin-top:14px;border:none;padding-bottom:0">'+
        '<span class="dlist-txt"><span class="dlist-t">Net movement</span>'+
        '<span class="dlist-s">Receipts less payments</span></span>'+
        '<span class="dlist-amt '+(cf.net>=0?'in':'out')+'">'+(cf.net>=0?'+':'−')+self.money(Math.abs(cf.net))+'</span>'+
      '</div></div>';

    var invPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Invoice Status</h3>'+
      '<span class="sub">Every sales invoice, by state</span></div></div>'+this._dashDonut(counts)+'</div>';

    /* recent transactions */
    var recRows=recent.length?recent.map(function(r){
      return '<div class="dlist-row"><span class="dlist-ico '+r.dir+'">'+I(r.dir==='in'?'arrowDownRight':'arrowUpRight',17)+'</span>'+
        '<span class="dlist-txt"><span class="dlist-t">'+e(r.t)+'</span><span class="dlist-s">'+e(r.s)+
        (r.date?(' · '+e(self.fmtDateUS(r.date))):'')+'</span></span>'+
        '<span class="dlist-amt '+r.dir+'">'+(r.dir==='in'?'+':'−')+self.money(r.amt)+'</span></div>'; }).join('')
      : '<div class="dlist-empty">No transactions yet.</div>';
    var recPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Recent Transactions</h3>'+
      '<span class="sub">Latest activity across the business</span></div>'+
      '<div class="right"><button class="btn btn-sm" onclick="App.selectSection(\'Receipts\')">View all</button></div></div>'+
      '<div class="dlist">'+recRows+'</div></div>';

    /* upcoming payments */
    var upRows=upcoming.length?upcoming.map(function(r){
      var cls=r.st==='Overdue'?'st-overdue':'st-unpaid';
      return '<div class="dlist-row"><span class="dlist-ico '+(r.dir==='in'?'in':'out')+'">'+
        I(r.dir==='in'?'user':'supplier',17)+'</span>'+
        '<span class="dlist-txt"><span class="dlist-t">'+e(r.party)+'</span>'+
        '<span class="dlist-s">'+(r.due?('Due '+e(self.fmtDateUS(r.due))):'No due date')+
        ' · '+(r.dir==='in'?'Receivable':'Payable')+'</span></span>'+
        '<span style="text-align:right"><span class="dlist-amt">'+self.money(r.amt)+'</span><br>'+
        '<span class="st-badge '+cls+'" style="margin-top:4px">'+e(r.st)+'</span></span></div>'; }).join('')
      : '<div class="dlist-empty">Nothing outstanding — every invoice is settled.</div>';
    var upPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Upcoming Payments</h3>'+
      '<span class="sub">Soonest due first</span></div></div><div class="dlist">'+upRows+'</div></div>';

    /* expense breakdown */
    var catMax=cats.length?Math.max.apply(null,cats.map(function(c){ return Math.abs(c.amt); })):1;
    var catTot=cats.reduce(function(a,c){ return a+c.amt; },0);
    var catRows=cats.length?cats.map(function(c,i){
      var pal=['var(--accent-solid)','var(--info)','var(--violet)','var(--success)','var(--warn)','var(--muted-2)'];
      var pct=catTot?Math.round((c.amt/catTot)*100):0;
      return '<div class="cat-row"><div class="cat-top"><span class="cat-name">'+e(c.name)+'</span>'+
        '<span class="cat-val">'+self.money(c.amt)+'</span><span class="cat-pct">'+pct+'%</span></div>'+
        '<div class="cat-bar"><i style="width:'+((Math.abs(c.amt)/catMax)*100).toFixed(1)+'%;background:'+pal[i%pal.length]+'"></i></div></div>'; }).join('')
      : '<div class="dlist-empty">No expenses in this period.</div>';
    var catPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Expense Breakdown</h3>'+
      '<span class="sub">Largest categories this period</span></div></div><div class="cat">'+catRows+'</div></div>';

    /* financial health */
    var healthPanel='<div class="dash-panel"><div class="dash-ph"><div><h3>Financial Health</h3>'+
      '<span class="sub">A blended score, updated live</span></div></div>'+
      this._dashGauge(health)+
      '<div class="gauge-note" style="margin-inline:auto">Based on profit margin, how many months of expenses your cash covers, '+
      'and how much of what you are owed is overdue.</div></div>';

    return '<div class="dash">'+stats+chart+
      '<div class="dash-grid two">'+recPanel+invPanel+'</div>'+
      '<div class="dash-grid">'+cashPanel+upPanel+healthPanel+'</div>'+
      '<div class="dash-grid">'+catPanel+'</div>'+
      '</div>'; },
  dashRange(n){ this._dashRange=n; this.renderMain(this.curBiz()); },

  summaryHtml(b){
    const p=periodOf(b); const periodTxt=p.from&&p.to?('For the period '+this.fmtDate(p.from)+' – '+this.fmtDate(p.to)):'';
    /* balance sheet as at the period end, profit and loss for the period — the same ledger the reports read */
    const S=summaryFromCoa(b,{from:p.from,to:p.to}); const totals={};
    /* P&L groups missing from the chart order (summaryFromCoa appends them) are listed too, before the first total line */
    const plOrder=((b.coaTop&&b.coaTop.pl)||[]).slice(); (b.coa||[]).forEach(n=>{ if(n&&n.type==='group'&&n.parent==='pl'&&plOrder.indexOf(n.id)<0){ const ti=plOrder.findIndex(x=>{ const m=(b.coa||[]).find(y=>y.id===x); return m&&m.type==='total'; }); if(ti<0) plOrder.push(n.id); else plOrder.splice(ti,0,n.id); } });
    { let acc=0; const sec={assets:0,liabilities:1,equity:2}; (b.coaTop&&b.coaTop.bs||['assets','liabilities','equity']).forEach(id=>{ if(sec[id]!=null) acc+=(S.balanceSheet[sec[id]]||{}).total||0; else totals[id]=acc; }); }
    /* S.profitLoss lists the chart-order groups first, then the missing ones (summaryFromCoa) */
    const grpIdx={}; { let gk=0; ((b.coaTop&&b.coaTop.pl)||[]).forEach(id=>{ const n=(b.coa||[]).find(x=>x.id===id); if(n&&n.type==='group'&&grpIdx[id]==null) grpIdx[id]=gk++; }); (b.coa||[]).forEach(n=>{ if(n&&n.type==='group'&&n.parent==='pl'&&grpIdx[n.id]==null) grpIdx[n.id]=gk++; }); }
    { let acc=0; plOrder.forEach(id=>{ const n=(b.coa||[]).find(x=>x.id===id); if(!n) return; if(n.type==='group'){ const g=S.profitLoss[grpIdx[id]]; if(g) acc+=(g.plkind==='expense'?-1:1)*(g.total||0); } else if(n.type==='total') totals[id]=acc; }); } const BS=['assets','liabilities','equity'];
    const bsMap={assets:S.balanceSheet[0],liabilities:S.balanceSheet[1],equity:S.balanceSheet[2]};
    let bsOut=''; (b.coaTop&&b.coaTop.bs||BS).forEach(id=>{ if(bsMap[id]) bsOut+=this.sectionHtml(bsMap[id]); else { const n=(b.coa||[]).find(x=>x.id===id); if(n&&n.type==='total') bsOut+=this.totalLineHtml(n.name,totals[id]||0); } });
    let plOut=''; plOrder.forEach(id=>{ const n=(b.coa||[]).find(x=>x.id===id); if(!n) return; if(n.type==='group'){ const sec=S.profitLoss[grpIdx[id]]; if(sec) plOut+=this.sectionHtml(sec); } else if(n.type==='total') plOut+=this.totalLineHtml(n.name,totals[id]||0); });
    /* Summary is the statements. The cards and charts derived from them live on
       the Dashboard tab above it — both read the same engine, so the two always
       agree. */
    return this.crumb('Summary')+
      '<div class="ws-tabrow"><span class="ws-tab active">Summary</span><button class="btn btn-sm" onclick="App.editSummary()">Edit</button></div>'+
      '<div class="ws-period">'+periodTxt+'</div>'+this._laterNote(b,p)+
      '<div class="sum-grid"><div class="sum-col"><div class="col-label">Balance Sheet</div>'+bsOut+'</div>'+
      '<div class="sum-col"><div class="col-label">Profit and Loss Statement</div>'+plOut+'</div></div>';
  },
  /* FIX_SPEC_4 #3: the Summary is as at the period end — a payroll dated at month end (or anything else
     dated after it) is not in it yet. Say so, rather than leave the salary expense silently missing. */
  _laterNote(b,p){ if(!p||!p.to) return ''; let txs=[]; try{ txs=GL.get(b).txs.filter(t=>t&&t.date&&t.date>p.to&&t.lines.some(L=>L.debit||L.credit)); }catch(e){ return ''; } if(!txs.length) return '';
    const pay=txs.filter(t=>t.src==='payroll'||t.src==='payslips'); const ex=(pay.length?pay:txs).slice().sort((x,y)=>String(x.date).localeCompare(String(y.date)))[0];
    return '<div class="info-bar sum-later" role="status">'+txs.length+' transaction'+(txs.length===1?' is':'s are')+' dated after '+this.esc(this.fmtDate(p.to))+' and not included'+(pay.length?' — including '+this.esc(ex.type||'payroll')+' on '+this.esc(this.fmtDate(ex.date)):'')+'. <a class="led-link" onclick="App.editSummary()">Change the period</a> to include '+(txs.length===1?'it':'them')+'.</div>'; },
  /* The Dashboard tab: the same cards, charts and panels that used to sit on top
     of the Summary, on a page of their own. */
  dashboardPageHtml(b){
    const p=periodOf(b); const periodTxt=p.from&&p.to?('For the period '+this.fmtDate(p.from)+' – '+this.fmtDate(p.to)):'';
    let dash=''; try{ dash=this.dashboardHtml(b); }catch(e){ dash=''; }
    return this.crumb('Dashboard')+
      '<div class="ws-tabrow"><span class="ws-tab active">Dashboard</span><button class="btn btn-sm" onclick="App.editSummary()">Edit period</button></div>'+
      '<div class="ws-period">'+periodTxt+'</div>'+
      dash;
  },
  totalLineHtml(name,val){ return '<div class="sum-card"><div class="sum-net sum-total-line"><span>'+this.esc(name)+'</span><span class="num">'+this.money(val)+'</span></div></div>'; },
  sectionHtml(sec){ const rows=(sec.children||[]).map(n=>this.nodeHtml(n,0)).join('');
    return '<div class="sum-card"><div class="sum-head"><span class="sum-title">'+this.esc(sec.title)+'</span><span class="sum-total num">'+this.money(sec.total||0)+'</span></div>'+
      '<div class="sum-rows">'+(rows||'<div class="sum-row"><span class="rn" style="color:#bbb">No data for this period</span></div>')+'</div></div>'; },
  nodeHtml(node,depth){ const pad=14+depth*20;
    if(node.children){ let h='<div class="sum-row" style="padding-left:'+pad+'px"><span class="rn">'+this.esc(node.name)+'</span><span class="ra grey num">'+this.money(node.total||0)+'</span></div>';
      return h+node.children.map(c=>this.nodeHtml(c,depth+1)).join(''); }
    const amt=this.money(node.amt||0); const cell=node.id?'<a class="led-link" onclick="App.openGL(\''+node.id+'\')">'+amt+'</a>':amt;
    return '<div class="sum-row" style="padding-left:'+pad+'px"><span class="rn">'+this.esc(node.name)+'</span><span class="ra blue num">'+cell+'</span></div>'; },
  /* The period drives both pages, so editing it returns to whichever one asked. */
  editSummary(){ this._periodReturn=(this.wsMode==='dashboard')?'dashboard':'summary';
    this.wsMode='summaryEdit'; this.renderMain(this.curBiz()); },
  periodFormHtml(b){
    const p=periodOf(b);
    const opt=(v,l)=>'<option value="'+v+'"'+(p.mode===v?' selected':'')+'>'+l+'</option>'; const custom=p.mode==='custom';
    return '<div class="ws-crumb"><div class="left">'+App._crumbIco()+' ▸ Summary ▸ Edit</div></div>'+
      '<div class="card"><h2>Summary</h2><p class="sub">Set the period shown on the Summary page.</p>'+
      '<label class="fld">Description</label><input id="edDesc" type="text" value="'+this.esc(p.description||'Summary')+'">'+
      '<label class="fld">Period</label><select id="edMode" onchange="App.onModeChange()">'+
      opt('thisMonth','This Month')+opt('thisQuarter','This Quarter')+opt('thisYear','This Financial Year')+opt('ytd','Year to Date')+opt('custom','Custom')+'</select>'+
      '<label class="fld">From</label><input id="edFrom" type="date" value="'+(p.from||'')+'"'+(custom?'':' disabled')+'>'+
      '<label class="fld">Until</label><input id="edTo" type="date" value="'+(p.to||'')+'"'+(custom?'':' disabled')+'>'+
      '<label class="chk"><input id="edZero" type="checkbox"'+(p.excludeZero?' checked':'')+'> Exclude accounts with zero balance</label>'+
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.savePeriod()">Update</button><button class="btn" onclick="App.cancelEdit()">Cancel</button></div></div>';
  },
  presetDates(mode){ return presetPeriod(mode); },
  onModeChange(){ const mode=document.getElementById('edMode').value, f=document.getElementById('edFrom'), t=document.getElementById('edTo');
    if(mode==='custom'){ f.disabled=false; t.disabled=false; } else { const d=this.presetDates(mode); if(d){ f.value=d[0]; t.value=d[1]; } f.disabled=true; t.disabled=true; } },
  savePeriod(){ const b=this.curBiz(); if(!b) return; const mode=document.getElementById('edMode').value;
    let from=document.getElementById('edFrom').value, to=document.getElementById('edTo').value;
    if(mode!=='custom'){ const d=this.presetDates(mode); if(d){ from=d[0]; to=d[1]; } }
    if(!from||!to){ alert('Please set both From and Until dates.'); return; }
    if(from>to){ alert('“From” date must be on or before the “Until” date.'); return; }
    b.period={mode,from,to,excludeZero:document.getElementById('edZero').checked,description:document.getElementById('edDesc').value.trim()||'Summary'};
    this.saveBiz(b); this.wsMode=this._periodReturn||'summary'; this.renderMain(b); },
  cancelEdit(){ this.wsMode=this._periodReturn||'summary'; this.renderMain(this.curBiz()); },

  /* ---------- users: Users page, user form and Profile live in js/users.js ---------- */

  /* ---------- utils ---------- */
  parseNum(s){ if(s==null) return ''; s=String(s).replace(/,/g,'').replace(/\s/g,'').trim(); if(s==='') return ''; const n=parseFloat(s); return isNaN(n)?'':n; },
  fmtNow(){ const b=this.openBiz?this.curBiz():null; const f=(b&&b.fmt)||{date:'MM/DD/YYYY',sep:'comma-dot',decimals:2};
    const m={'comma-dot':[',','.'],'dot-comma':['.',','],'space-comma':['\u00A0',','],'none-dot':['','.']}; const s=m[f.sep]||m['comma-dot'];
    return {decimals:(f.decimals==null?2:+f.decimals), thousands:s[0], decimal:s[1], date:f.date||'MM/DD/YYYY'}; },
  money(n){ n=Number(n)||0; const f=this.fmtNow(); const neg=n<0; let str=Math.abs(n).toFixed(f.decimals);
    let parts=str.split('.'); parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, f.thousands);
    let out=parts.length>1?parts[0]+f.decimal+parts[1]:parts[0]; return neg?('- '+out):out; },
  fmtDate(iso){ return this.fmtDateUS(iso); },
  fmtDateUS(iso){ if(!iso) return ''; const p=String(iso).split('-'); if(p.length!==3) return this.esc(iso);
    const Y=p[0],M=p[1],D=p[2]; const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    switch(this.fmtNow().date){ case 'DD/MM/YYYY': return D+'/'+M+'/'+Y; case 'YYYY-MM-DD': return Y+'-'+M+'-'+D;
      case 'D MMM YYYY': return (+D)+' '+mon[(+M)-1]+' '+Y; default: return M+'/'+D+'/'+Y; } },
  esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
};

/* Settings tiles whose screen is drawn by js/settings-pages.js. That file
   replaces these handlers when it loads; until then they show the no-editor card. */
App.setTiles().forEach(function(t){ var fn='set_'+t[2];
  if(typeof App[fn]!=='function') App[fn]=function(b){ return (typeof SettingsPages!=='undefined')?SettingsPages.page(b,t[2]):this.setMissing(t[1]); }; });

/* ===================== number → words ===================== */
function toWordsInt(n){
  n=Math.floor(Math.abs(Number(n)||0));
  if(n===0) return 'Zero';
  const ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const sc=['','Thousand','Million','Billion','Trillion'];
  function three(x){ let s=''; if(x>=100){ s+=ones[Math.floor(x/100)]+' Hundred'; x%=100; if(x) s+=' '; } if(x>=20){ s+=tens[Math.floor(x/10)]; x%=10; if(x) s+='-'+ones[x]; } else if(x>0){ s+=ones[x]; } return s; }
  let g=[]; while(n>0){ g.push(n%1000); n=Math.floor(n/1000); }
  let out=''; for(let i=g.length-1;i>=0;i--){ if(g[i]) out+=three(g[i])+(sc[i]?' '+sc[i]:'')+' '; }
  return out.trim();
}

