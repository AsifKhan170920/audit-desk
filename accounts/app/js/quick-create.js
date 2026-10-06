/* ===================== Quick-create dropdowns (additive) =====================
   Every dropdown that lists a database-managed entity gets a "＋ Add New …"
   row. Choosing it opens a small dialog, creates the record through the app's
   own creation logic (App.createEntityRecord / App.coaCreateAccount — the same
   functions the full-page forms call), then refreshes every dropdown of that
   kind and selects the new record, without leaving the form.

   Long lists additionally get a searchable panel in place of the native popup.

   A dropdown opts in by carrying data-qc-source="<entity>"; anything without
   it — Status, Yes/No, Net/By, party-type … — is left completely alone.
   ============================================================================ */
(function(global){
  'use strict';

  var ADD = '__qc_add__';        // sentinel value of the "＋ Add New" option
  var SEARCH_MIN = 8;            // options before a dropdown becomes searchable

  /* Entity registry, keyed by the listSource names the designed forms already
     use. `rec` entities are register records and reuse REG[key].form as their
     schema, so the dialog asks for exactly what the full-page form asks for. */
  var SOURCES = {
    customer:   { rec:'customers'  },
    supplier:   { rec:'suppliers'  },
    bank:       { rec:'bankCash'   },
    employee:   { rec:'employees'  },
    item:       { rec:'inventory'  },
    nonInvItem: { rec:'nonInvItems'},
    fixedAsset: { rec:'fixedAssets'},
    intangible: { rec:'intangibles'},
    capital:    { rec:'capital'    },
    investment: { rec:'investments'},
    account:    { label:'Account',  valueKey:'name' },
    tax:        { label:'Tax Rate', valueKey:'rate' },
    project:    { label:'Project',  list:'projects',    valueKey:'id',
                  extra:[{key:'status',label:'Status',type:'select',options:['Active','On hold','Complete'],def:'Active'}] },
    division:   { label:'Division', list:'divisions',   valueKey:'id' },
    location:   { label:'Location', list:'locations',   valueKey:'name' },
    claimPayer: { label:'Payer',    list:'claimPayers', valueKey:'name' }
  };

  /* app.js and data.js declare `const App` / `const REG`, which live in the
     shared script scope but are NOT properties of window — so reach them by
     name, falling back to the global for anyone loading this file alone. */
  function app(){ try{ return App; }catch(e){ return global.App || null; } }
  function regs(){ try{ return REG; }catch(e){ return global.REG || {}; } }
  function biz(){ var A=app(); return A && A.curBiz ? A.curBiz() : null; }
  function esc(s){ var A=app(); return A ? A.esc(s==null?'':s) : String(s==null?'':s); }
  function known(src){ return !!(src && SOURCES[src]); }

  /** "Customer", "Account", "Tax Rate" — what the dialog and the option say. */
  function labelOf(src){
    var d = SOURCES[src]; if(!d) return 'Item';
    if(d.rec){ var r = regs()[d.rec]; return (r && r.singular) || d.rec; }
    return d.label;
  }

  /** Which property of the created thing the <select> holds as its value. */
  function valueKeyOf(src){ var d=SOURCES[src]; return (d && (d.valueKey || 'name')) || 'name'; }

  /* ---------------------------------------------------------------- schema */

  /** The dialog's fields — REG's own form definition wherever one exists. */
  function fieldsFor(src){
    var d = SOURCES[src]; if(!d) return [];
    if(d.rec){ var r=regs()[d.rec]; return ((r&&r.form)||[]).slice(); }
    if(src==='account') return [
      { key:'name',    label:'Account Name',     type:'text',     req:1 },
      { key:'code',    label:'Code',             type:'text' },
      { key:'parent',  label:'Group',            type:'coaGroup', req:1 }];   /* starting balances live in Settings > Starting Balances */
    if(src==='tax') return [
      { key:'name', label:'Tax Code Name', type:'text',   req:1 },
      { key:'rate', label:'Rate %',        type:'number', req:1 }];
    return [{ key:'name', label:labelOf(src)+' Name', type:'text', req:1 },
            { key:'code', label:'Code', type:'text' }].concat(d.extra||[]);
  }

  /* ---------------------------------------------------------------- create */

  /**
   * Create the entity and return {ok:true, value} — `value` being what the
   * dropdown should now hold — or {ok:false, error, field}. Every branch goes
   * through the app's existing persistence, so a later Postgres/Supabase data
   * layer only has to be swapped in behind App.saveBiz / App.createEntityRecord.
   */
  function create(src, values){
    var A=app(), b=biz(), d=SOURCES[src];
    if(!A || !b) return { ok:false, error:'No business is open.' };
    if(A.isReadOnly && A.isReadOnly(b)) return { ok:false, error:'Your access to this business is read only.' };
    if(!d) return { ok:false, error:'Unknown entity.' };

    if(d.rec){
      var r = A.createEntityRecord(d.rec, values);
      return r.ok ? { ok:true, value:r.record.name } : r;
    }
    if(src==='account'){
      var side = A.coaSideOf ? sideOfGroup(b, values.parent) : 'bs';
      var a = A.coaCreateAccount(b, { name:values.name, code:values.code, parent:values.parent, side:side, balance:values.balance });
      if(!a.ok) return a;
      try{ refreshSummary(b); }catch(e){}
      A.saveBiz(b);
      return { ok:true, value:a.node.name };
    }
    if(src==='tax'){
      var nm=String(values.name||'').trim();
      if(!nm) return { ok:false, error:'Tax Code Name is required.', field:'name' };
      var rate=A.parseNum(values.rate);
      if(values.rate==='' || values.rate==null || isNaN(rate)) return { ok:false, error:'Rate % is required.', field:'rate' };
      if(rate<0 || rate>100) return { ok:false, error:'Rate % must be between 0 and 100.', field:'rate' };
      b.taxCodes = b.taxCodes || [];
      if(b.taxCodes.some(function(t){ return String(t.name||'').trim().toLowerCase()===nm.toLowerCase(); }))
        return { ok:false, error:'A tax code named “'+nm+'” already exists.', field:'name' };
      b.taxCodes.push({ name:nm, rate:rate });
      A.saveBiz(b);
      return { ok:true, value:String(rate) };
    }
    /* plain settings lists: projects, divisions, locations, claim payers */
    var list=d.list, name=String(values.name||'').trim();
    if(!name) return { ok:false, error:labelOf(src)+' Name is required.', field:'name' };
    b[list] = b[list] || [];
    if(b[list].some(function(x){ return String((x&&x.name)||x||'').trim().toLowerCase()===name.toLowerCase(); }))
      return { ok:false, error:'A '+labelOf(src).toLowerCase()+' named “'+name+'” already exists.', field:'name' };
    var row = { id:'x'+Date.now()+Math.floor(Math.random()*1000), name:name, code:String(values.code||'').trim() };
    (d.extra||[]).forEach(function(f){ row[f.key] = values[f.key] || f.def || ''; });
    b[list].push(row);
    A.saveBiz(b);
    return { ok:true, value: valueKeyOf(src)==='id' ? row.id : row.name };
  }

  /** Balance-sheet or profit-and-loss, so a new account lands on the right side. */
  function sideOfGroup(b, parentId){
    if(parentId==='pl') return 'pl';
    var n=(b.coa||[]).filter(function(x){ return x.id===parentId; })[0];
    if(!n) return 'bs';
    try{ return app().coaSideOf(b, n); }catch(e){ return 'bs'; }
  }

  /* --------------------------------------------------------------- options */

  function optionsFor(src){
    var A=app(), b=biz();
    try{ return A._liveOptionsFor(b, src) || []; }catch(e){ return []; }
  }

  function realCount(sel){
    var n=0;
    for(var i=0;i<sel.options.length;i++){ var o=sel.options[i]; if(o.value!==ADD && !o.disabled && o.value!=='') n++; }
    return n;
  }

  function stripAddRow(sel){
    for(var i=sel.options.length-1;i>=0;i--){
      var o=sel.options[i];
      if(o.value===ADD || o.className==='qc-sep') sel.remove(i);
    }
  }

  /** Append the separator + "＋ Add New …" row to one dropdown. */
  function decorate(sel){
    var src = sel.getAttribute('data-qc-source');
    if(!known(src)) return;
    stripAddRow(sel);
    var sep = global.document.createElement('option');
    sep.disabled = true; sep.className = 'qc-sep'; sep.textContent = '──────────';
    var add = global.document.createElement('option');
    add.value = ADD; add.className = 'qc-add'; add.textContent = '＋ Add New ' + labelOf(src);
    sel.appendChild(sep); sel.appendChild(add);
    sel.setAttribute('data-qc-on', '');
    if(realCount(sel) >= SEARCH_MIN) sel.setAttribute('data-qc-search', '');
    else sel.removeAttribute('data-qc-search');
    if(sel.value !== ADD) sel.setAttribute('data-qc-prev', sel.value);
  }

  /** Decorate every opted-in dropdown under `root`. */
  function scan(root){
    root = root || global.document;
    if(!root.querySelectorAll) return;
    var list = root.querySelectorAll('select[data-qc-source]');
    for(var i=0;i<list.length;i++){ try{ decorate(list[i]); }catch(e){} }
  }

  /** Rebuild one dropdown's options from live data, keeping what was selected. */
  function refresh(sel){
    var src = sel.getAttribute('data-qc-source');
    if(!known(src)) return;
    var keep = sel.value === ADD ? (sel.getAttribute('data-qc-prev')||'') : sel.value;
    var first = sel.options[0];
    var ph = (first && first.value === '') ? first.outerHTML : '';
    sel.innerHTML = ph + optionsFor(src).join('');
    decorate(sel);
    sel.value = keep;
  }

  /** Rebuild every dropdown of this entity kind across the page. */
  function refreshAll(src){
    var list = global.document.querySelectorAll('select[data-qc-source="'+src+'"]');
    for(var i=0;i<list.length;i++){ try{ refresh(list[i]); }catch(e){} }
  }

  /* ---------------------------------------------------------------- dialog */

  var pending = null;   // { src, sel } while the dialog is open

  function fieldHtml(src, f){
    var id = 'qc_' + f.key, A = app(), b = biz();
    if(f.type === 'check')
      return '<label class="chk-row"><input type="checkbox" id="'+id+'" onchange="QuickCreate.reveal()"> '+esc(f.label)+'</label>';
    var lbl = '<label class="fld">'+esc(f.label)+(f.req?' *':'')+'</label>';
    if(f.type === 'textarea') return lbl + '<textarea id="'+id+'" rows="2"></textarea>';
    if(f.type === 'select')
      return lbl + '<select id="'+id+'">' + (f.options||[]).map(function(o){
        return '<option'+(o===f.def?' selected':'')+'>'+esc(o)+'</option>'; }).join('') + '</select>';
    if(f.type === 'account'){
      var accts = (A.accountOptions && A.accountOptions(b)) || [];
      return lbl + '<select id="'+id+'"><option value="">— none —</option>' +
        accts.map(function(o){ return '<option value="'+esc(o.id)+'">'+esc(o.label)+'</option>'; }).join('') + '</select>';
    }
    if(f.type === 'coaGroup'){
      var gs = (A.coaGroupOptions && A.coaGroupOptions(b, 'bs', null)) || [];
      var pl = (A.coaGroupOptions && A.coaGroupOptions(b, 'pl', null)) || [];
      var opt = function(o){ return '<option value="'+esc(o.value)+'">'+'    '.repeat(o.depth)+esc(o.label)+'</option>'; };
      return lbl + '<select id="'+id+'">' +
        (gs.length ? '<optgroup label="Balance Sheet">'+gs.map(opt).join('')+'</optgroup>' : '') +
        (pl.length ? '<optgroup label="Profit &amp; Loss">'+pl.map(opt).join('')+'</optgroup>' : '') +
        (gs.length||pl.length ? '' : '<option value="">(a group will be created)</option>') + '</select>';
    }
    var t = (f.type === 'date') ? 'date' : (f.type === 'number' || f.type === 'money') ? 'text' : 'text';
    var im = (f.type === 'number' || f.type === 'money') ? ' inputmode="decimal"' : '';
    return (f.showIf ? '' : lbl) + '<input id="'+id+'" type="'+t+'"'+im+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+(f.showIf?' aria-label="'+esc(f.label)+'"':'')+'>';
  }

  /* Same layout as the full form: fields sharing a `row` sit side by side (Name | Code), and a field
     with `showIf` is revealed under its checkbox (IBAN, Credit limit). */
  function layoutHtml(src, fields){
    var h='', i=0;
    while(i<fields.length){ var f=fields[i];
      if(f.row){ var g=[]; while(i<fields.length && fields[i].row===f.row){ g.push(fields[i]); i++; }
        h+='<div class="ff-row">'+g.map(function(x){ return '<div class="ff-f'+(x.w?' ff-small':'')+'">'+fieldHtml(src, x)+'</div>'; }).join('')+'</div>'; continue; }
      h+= f.showIf ? '<div class="ff-reveal" data-showif="'+esc(f.showIf)+'" hidden>'+fieldHtml(src, f)+'</div>' : fieldHtml(src, f);
      i++; }
    return h;
  }
  function reveal(){ var d=global.document, ov=d.getElementById('appOverlay'); if(!ov) return;
    ov.querySelectorAll('[data-showif]').forEach(function(el){ var cb=d.getElementById('qc_'+el.getAttribute('data-showif')); el.hidden=!(cb && cb.checked); }); }

  /** Open the quick-create dialog for `src`, wired back to `sel`. */
  function open(src, sel, seedName){
    var A = app();
    if(!A || !known(src)) return;
    var b = biz();
    if(!b || (A.guardWrite && !A.guardWrite(b))) return;
    pending = { src:src, sel:sel };
    var fields = fieldsFor(src);
    var html =
      '<div class="app-modal-h">Add New ' + esc(labelOf(src)) + '</div>' +
      '<div class="app-modal-b"><div id="qcErr" class="qc-err hide"></div>' +
        layoutHtml(src, fields) +
      '</div>' +
      '<div class="app-modal-f"><span style="flex:1"></span>' +
        '<button class="btn" onclick="QuickCreate.cancel()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="QuickCreate.submit()">Add</button></div>';
    A._openOverlay(html);
    var ov = global.document.getElementById('appOverlay');
    if(ov){
      ov.onclick = null;                                  // a half-typed record must not vanish on a stray click
      ov.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){ e.preventDefault(); cancel(); }
      });
    }
    var first = global.document.getElementById('qc_' + (fields[0] ? fields[0].key : 'name'));
    if(first){
      if(seedName && first.type === 'text'){ first.value = seedName; }
      try{ first.focus(); first.select && first.select(); }catch(e){}
    }
  }

  function readValues(src){
    var out = {};
    fieldsFor(src).forEach(function(f){
      var el = global.document.getElementById('qc_' + f.key);
      if(!el) return;
      out[f.key] = (f.type === 'check') ? !!el.checked : el.value;
    });
    return out;
  }

  function showError(msg, field){
    var e = global.document.getElementById('qcErr');
    if(e){ e.textContent = msg; e.classList.remove('hide'); }
    var el = field && global.document.getElementById('qc_' + field);
    if(el){ try{ el.focus(); el.select && el.select(); }catch(_){} }
  }

  function submit(){
    if(!pending) return;
    var src = pending.src, sel = pending.sel;
    var res = create(src, readValues(src));
    if(!res.ok){ showError(res.error || 'Could not save.', res.field); return; }
    var A = app();
    try{ A.pushAppLists && A.pushAppLists(); }catch(e){}
    A._closeOverlay();
    pending = null;
    refreshAll(src);
    if(sel && sel.isConnected !== false){
      sel.value = res.value;
      if(sel.value !== res.value){                        // not in the list (a filtered source) — add it
        var o = global.document.createElement('option');
        o.value = res.value; o.textContent = res.value;
        sel.insertBefore(o, sel.options[sel.options.length-2] || null);
        sel.value = res.value;
      }
      sel.setAttribute('data-qc-prev', sel.value);
      fireUser(sel);
      try{ sel.focus(); }catch(e){}
    }
  }

  function cancel(){
    var sel = pending && pending.sel;
    app()._closeOverlay();
    pending = null;
    if(sel){ try{ sel.focus(); }catch(e){} }
  }

  /* -------------------------------------------------- searchable dropdowns */

  var pop = null;   // { el, sel, input, list, items, idx }

  function closePop(refocus){
    if(!pop) return;
    var sel = pop.sel;
    if(pop.el && pop.el.parentNode) pop.el.parentNode.removeChild(pop.el);
    pop = null;
    if(refocus && sel){ try{ sel.focus(); }catch(e){} }
  }

  function openPop(sel, seed){
    closePop(false);
    var doc = global.document, src = sel.getAttribute('data-qc-source');
    var el = doc.createElement('div');
    el.className = 'qc-pop';
    el.setAttribute('data-enter-nav', 'off');           // the panel owns its own Enter
    el.innerHTML =
      '<input class="qc-pop-search" type="text" placeholder="Search ' + esc(labelOf(src).toLowerCase()) + '…" aria-label="Search">' +
      '<div class="qc-pop-list" role="listbox"></div>' +
      '<button type="button" class="qc-pop-add">＋ Add New ' + esc(labelOf(src)) + '</button>';
    doc.body.appendChild(el);

    var r = sel.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(r.left, (global.innerWidth||1024) - el.offsetWidth - 8)) + 'px';
    el.style.top = (r.bottom + 4) + 'px';
    /* near the bottom of the screen the panel opens upward (flip) */
    var vh = global.innerHeight || 768;
    if(vh - r.bottom < 280 && r.top > vh - r.bottom){ el.style.top = ''; el.style.bottom = (vh - r.top + 4) + 'px'; el.classList.add('qc-pop-up'); }
    el.style.minWidth = Math.max(r.width, 220) + 'px';

    pop = { el:el, sel:sel, input:el.querySelector('.qc-pop-search'), list:el.querySelector('.qc-pop-list'), items:[], idx:-1 };
    el.querySelector('.qc-pop-add').addEventListener('mousedown', function(e){
      e.preventDefault(); var s = pop.sel, q = pop.input.value.trim(); closePop(false); open(src, s, q);
    });
    pop.input.addEventListener('input', function(){ renderPop(); });
    pop.input.addEventListener('keydown', popKeys);
    if(seed) pop.input.value = seed;
    renderPop();
    try{ pop.input.focus(); }catch(e){}
  }

  function renderPop(){
    if(!pop) return;
    var q = pop.input.value.trim().toLowerCase(), sel = pop.sel, out = [];
    for(var i=0;i<sel.options.length;i++){
      var o = sel.options[i];
      if(o.value === ADD || o.className === 'qc-sep' || o.disabled) continue;
      var txt = o.textContent || '';
      if(q && txt.toLowerCase().indexOf(q) < 0) continue;
      out.push({ value:o.value, text:txt, sel:o.value === sel.value });
    }
    pop.items = out;
    pop.idx = out.length ? 0 : -1;
    pop.list.innerHTML = out.length
      ? out.map(function(it, n){
          return '<div class="qc-pop-opt' + (n===0?' on':'') + (it.sel?' cur':'') + '" role="option" data-i="'+n+'">' + esc(it.text) + '</div>';
        }).join('')
      : '<div class="qc-pop-empty">No ' + esc(labelOf(sel.getAttribute('data-qc-source')).toLowerCase()) + ' found.</div>';
    pop.list.querySelectorAll('.qc-pop-opt').forEach(function(node){
      node.addEventListener('mousedown', function(e){ e.preventDefault(); pick(parseInt(node.getAttribute('data-i'),10)); });
    });
  }

  function highlight(n){
    if(!pop || !pop.items.length) return;
    pop.idx = (n + pop.items.length) % pop.items.length;
    var nodes = pop.list.querySelectorAll('.qc-pop-opt');
    for(var i=0;i<nodes.length;i++) nodes[i].classList.toggle('on', i === pop.idx);
    if(nodes[pop.idx] && nodes[pop.idx].scrollIntoView) nodes[pop.idx].scrollIntoView({ block:'nearest' });
  }

  function pick(n){
    if(!pop) return;
    var it = pop.items[n]; if(!it) return;
    var sel = pop.sel;
    sel.value = it.value;
    sel.setAttribute('data-qc-prev', sel.value);
    closePop(true);
    fireUser(sel);
  }
  /** input + change for a value the user picked here. Script events are not isTrusted, so they carry
      userPick: listeners that ignore the values a form restores when it opens (js/pending-stock.js,
      js/forms-fixes.js) still act on a pick from this list. */
  function fireUser(sel){
    ['input', 'change'].forEach(function(type){
      try{ var ev = new global.Event(type, { bubbles:true }); ev.userPick = true; sel.dispatchEvent(ev); }catch(e){}
    });
  }

  function popKeys(e){
    if(!pop) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); highlight(pop.idx + 1); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); highlight(pop.idx - 1); }
    else if(e.key === 'Enter'){
      e.preventDefault(); e.stopPropagation();
      if(pop.items.length) pick(pop.idx);
      else { var s = pop.sel, src = s.getAttribute('data-qc-source'), q = pop.input.value.trim(); closePop(false); open(src, s, q); }
    }
    else if(e.key === 'Escape'){ e.preventDefault(); closePop(true); }
    else if(e.key === 'Tab'){ closePop(true); }
  }

  /* ----------------------------------------------------------------- wiring */

  function isOn(el){ return !!(el && el.tagName === 'SELECT' && el.hasAttribute('data-qc-on') && !el.disabled); }

  function install(doc){
    /* Capture phase: revert the sentinel before any app handler sees it, so no
       form logic ever runs against the "＋ Add New" value. */
    doc.addEventListener('change', function(e){
      var sel = e.target;
      if(!isOn(sel)) return;
      if(sel.value !== ADD){ sel.setAttribute('data-qc-prev', sel.value); return; }
      e.stopPropagation();
      sel.value = sel.getAttribute('data-qc-prev') || '';
      open(sel.getAttribute('data-qc-source'), sel);
    }, true);

    /* Long lists open the searchable panel instead of the native popup.
       Arrow keys, Home/End and type-ahead on the closed select are untouched. */
    doc.addEventListener('mousedown', function(e){
      var sel = e.target;
      if(!isOn(sel) || !sel.hasAttribute('data-qc-search')) return;
      e.preventDefault();
      if(pop && pop.sel === sel) closePop(true); else openPop(sel, '');
    }, true);

    doc.addEventListener('keydown', function(e){
      var sel = e.target;
      if(!isOn(sel) || !sel.hasAttribute('data-qc-search')) return;
      if(e.altKey && e.key === 'ArrowDown'){ e.preventDefault(); openPop(sel, ''); return; }
      if(e.ctrlKey || e.metaKey || e.altKey) return;
      if(e.key && e.key.length === 1 && e.key !== ' '){ e.preventDefault(); openPop(sel, e.key); }
    }, true);

    doc.addEventListener('mousedown', function(e){
      if(pop && pop.el && !pop.el.contains(e.target) && e.target !== pop.sel) closePop(false);
    }, false);

    global.addEventListener('resize', function(){ closePop(false); });
  }

  var QuickCreate = {
    ADD:ADD, SEARCH_MIN:SEARCH_MIN, SOURCES:SOURCES,
    labelOf:labelOf, valueKeyOf:valueKeyOf, fieldsFor:fieldsFor, known:known,
    create:create, decorate:decorate, scan:scan, refresh:refresh, refreshAll:refreshAll,
    open:open, submit:submit, cancel:cancel, readValues:readValues, reveal:reveal,
    openPop:openPop, closePop:closePop, install:install
  };
  global.QuickCreate = QuickCreate;

  if(global.document && global.document.addEventListener) install(global.document);
})(typeof window !== 'undefined' ? window : this);
