/* ===================== voucher template designer ===================== */
const DESIGN_DOCS={receipts:1,payments:1,salesInv:1,purchInv:1,customers:1,suppliers:1};

const Designer={
  docType:null, biz:null, tpl:null, built:false, selId:null, drag:null, _oe:null, _tt:null,
  PAPER:{A4:[210,297],Letter:[215.9,279.4],Legal:[215.9,355.6]},
  DOC:{receipts:{title:'RECEIPT VOUCHER',party:'Received From'},payments:{title:'PAYMENT VOUCHER',party:'Paid To'},
    salesInv:{title:'TAX INVOICE',party:'Bill To'},purchInv:{title:'PURCHASE INVOICE',party:'Supplier'},
    customers:{title:'CUSTOMER STATEMENT',party:'Customer'},suppliers:{title:'SUPPLIER STATEMENT',party:'Supplier'}},
  ELEMENTS:[['logo','Logo'],['business','Business details'],['party','Customer / Supplier details'],
    ['meta','Voucher details (date, ref…)'],['table','Items table'],['amountWords','Amount in words'],
    ['text','Text / Notes'],['signature','Signature']],

  uid(){ return 'b'+Date.now().toString(36)+Math.floor(Math.random()*1e5).toString(36); },
  esc(s){ return App.esc(s==null?'':s); },
  money(n){ return App.money(n); },
  num(v){ const n=parseFloat(String(v==null?'':v).replace(/,/g,'')); return isNaN(n)?0:n; },
  find(id){ return this.tpl.blocks.find(b=>b.id===id); },
  el(id){ return document.querySelector('#dzPage .dz-block[data-id="'+id+'"]'); },
  tableBlock(){ return this.tpl.blocks.find(b=>b.type==='table'); },
  blockLabel(t){ return ({logo:'Logo',business:'Business details',party:'Party details',meta:'Voucher details',table:'Items table',amountWords:'Amount in words',text:'Text / Notes',signature:'Signature'})[t]||t; },

  /* ---- open / close / persist ---- */
  open(docType){
    const b=App.curBiz(); if(!b){ alert('Open a business first.'); return; }
    this.docType=docType; this.biz=b; b.templates=b.templates||{};
    this.tpl = b.templates[docType] ? JSON.parse(JSON.stringify(b.templates[docType])) : this.defaultTpl(docType);
    this.selId=null;
    if(!this.built) this.build();
    document.getElementById('designerOverlay').classList.remove('hide');
    this.renderAll();
  },
  close(){ this.save(); document.getElementById('designerOverlay').classList.add('hide'); },
  save(){ const b=App.curBiz(); if(!b) return; b.templates=b.templates||{}; b.templates[this.docType]=JSON.parse(JSON.stringify(this.tpl)); App.saveBiz(b); },
  reset(){ if(!(window.UIModal?UIModal.gate('Reset this template to the default layout?',()=>this.reset()):true)) return; this.tpl=this.defaultTpl(this.docType); this.selId=null; this.save(); this.renderAll(); },

  /* ---- default template + element defaults ---- */
  defaultData(type){
    const biz=App.curBiz()||{}; const d=biz.details||{};
    if(type==='logo') return {src:d.logo||''};
    if(type==='business'){ const lines=[d.legalName||biz.name||'Your Business']; if(d.address) lines.push(d.address);
      if(d.taxNumber) lines.push('TRN: '+d.taxNumber); if(d.email) lines.push(d.email); if(d.phone) lines.push(d.phone);
      return {text:lines.join('\n')}; }
    if(type==='party') return {label:(this.DOC[this.docType]||{}).party||'Party', text:'Name\nAddress\nTRN: ____'};
    if(type==='meta') return {title:(this.DOC[this.docType]||{}).title||'DETAILS', fields:[{label:'Date',value:''},{label:'Reference',value:''}]};
    if(type==='table') return {columns:[{cid:this.uid(),label:'Description',type:'text',align:'left',w:46},
        {cid:this.uid(),label:'Qty',type:'qty',align:'right',w:12},{cid:this.uid(),label:'Rate',type:'rate',align:'right',w:18},
        {cid:this.uid(),label:'Amount',type:'amount',align:'right',w:24}],
        rows:[{},{}], showTotals:true, taxLabel:'VAT', taxPct:5};
    if(type==='amountWords') return {currency:'UAE Dirham',fraction:'Fils',manual:''};
    if(type==='text') return {text:'Notes / Terms & Conditions'};
    if(type==='signature') return {label:'Authorized Signature'};
    return {};
  },
  defaultTpl(docType){
    const T=(type,x,y,w,h,align,fontPt,extra)=>Object.assign({id:this.uid(),type,x,y,w,h,align:align||'left',fontPt:fontPt||10,bold:false,color:'#333333',data:this.defaultData(type)},extra||{});
    const tbl=T('table',4,40,92,34,'left',9.5);
    const r=tbl.data.rows; r[0]={[tbl.data.columns[0].cid]:'Item description',[tbl.data.columns[1].cid]:1,[tbl.data.columns[2].cid]:0};
    return { page:{size:'A4',orient:'portrait',wmm:210,hmm:297,marginmm:10},
      blocks:[ T('logo',4,3,24,12), T('business',30,3,66,15,'right'), T('meta',60,20,36,18,'left'),
        T('party',4,20,50,16,'left'), tbl, T('amountWords',4,76,56,8,'left',9.5), T('text',4,88,92,8,'left',9) ] };
  },

  /* ---- page dims ---- */
  pageDims(){ const p=this.tpl.page; let w,h; if(p.size==='Custom'){ w=+p.wmm||210; h=+p.hmm||297; } else { const d=this.PAPER[p.size]||this.PAPER.A4; w=d[0]; h=d[1]; } if(p.orient==='landscape'){ const t=w; w=h; h=t; } return {w,h}; },

  /* ---- build overlay ---- */
  build(){
    const ov=document.createElement('div'); ov.id='designerOverlay'; ov.className='dz-overlay hide';
    ov.innerHTML=
      '<div class="dz-top"><div class="dz-title" id="dzTitle">Template Designer</div>'+
        '<div class="dz-topbtns">'+
          '<button class="btn btn-sm" onclick="Designer.addMenuToggle(event)">+ Add element ▾</button>'+
          '<button class="btn btn-sm" onclick="Designer.print()">Preview / Print</button>'+
          '<button class="btn btn-sm" onclick="Designer.reset()">Reset</button>'+
          '<button class="btn btn-sm btn-primary" onclick="Designer.save();Designer.toast(\'Template saved\')">Save</button>'+
          '<button class="btn btn-sm" onclick="Designer.close()">Close</button>'+
        '</div><div class="dz-addmenu hide" id="dzAddMenu"></div></div>'+
      '<div class="dz-main">'+
        '<div class="dz-left" id="dzLeft"></div>'+
        '<div class="dz-center"><div class="dz-page" id="dzPage" onmousedown="Designer.bgClick(event)"></div></div>'+
        '<div class="dz-right" id="dzProps"></div>'+
      '</div><div class="dz-toast hide" id="dzToast"></div>';
    document.body.appendChild(ov);
    this._oe=this.onEdit.bind(this);
    this.built=true;
  },

  renderAll(){ document.getElementById('dzTitle').textContent='Template Designer — '+((this.DOC[this.docType]||{}).title||this.docType);
    this.renderAddMenu(); this.renderLeft(); this.renderCanvas(); this.renderProps(); },

  /* ---- canvas ---- */
  renderCanvas(){
    const {w,h}=this.pageDims(); const page=document.getElementById('dzPage');
    page.style.width=w+'mm'; page.style.height=h+'mm';
    const m=this.num(this.tpl.page.marginmm);
    const margin=m? '<div class="dz-margin" style="left:'+m+'mm;top:'+m+'mm;right:'+m+'mm;bottom:'+m+'mm"></div>':'';
    page.innerHTML=margin+this.renderBlocks(true);
    this.bindInline();
  },
  renderBlocks(editable){
    return this.tpl.blocks.map(b=>{
      const style='position:absolute;left:'+b.x+'%;top:'+b.y+'%;width:'+b.w+'%;height:'+b.h+'%;text-align:'+b.align+';font-size:'+b.fontPt+'pt;color:'+b.color+';font-weight:'+(b.bold?'700':'400')+';';
      const chrome=editable?('<div class="dz-chrome"><div class="dz-grip" onmousedown="Designer.gripDown(event,\''+b.id+'\')">✥ move</div>'+
        '<div class="dz-tools"><button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();Designer.dup(\''+b.id+'\')" title="Duplicate">⧉</button>'+
        '<button onmousedown="event.stopPropagation()" onclick="event.stopPropagation();Designer.del(\''+b.id+'\')" title="Delete">✕</button></div>'+
        '<div class="dz-resize" onmousedown="Designer.resizeDown(event,\''+b.id+'\')"></div></div>'):'';
      const md=editable?(' onmousedown="Designer.blockDown(event,\''+b.id+'\')"'):'';
      return '<div class="dz-block'+(editable&&b.id===this.selId?' sel':'')+'" data-id="'+b.id+'" style="'+style+'"'+md+'>'+chrome+'<div class="dz-bc">'+this.blockContent(b,editable)+'</div></div>';
    }).join('');
  },
  blockContent(b,ed){
    const e=ed?' contenteditable="true"':'';
    if(b.type==='logo') return b.data.src?'<img src="'+b.data.src+'" style="max-width:100%;max-height:100%;object-fit:contain">':'<div class="dz-ph">Logo</div>';
    if(b.type==='business') return '<div class="dz-pre"'+e+' data-blk="'+b.id+'" data-prop="text">'+this.esc(b.data.text)+'</div>';
    if(b.type==='text') return '<div class="dz-pre"'+e+' data-blk="'+b.id+'" data-prop="text">'+this.esc(b.data.text)+'</div>';
    if(b.type==='party') return '<div class="dz-strong"'+e+' data-blk="'+b.id+'" data-prop="label">'+this.esc(b.data.label)+'</div>'+
      '<div class="dz-pre"'+e+' data-blk="'+b.id+'" data-prop="text">'+this.esc(b.data.text)+'</div>';
    if(b.type==='signature') return '<div style="height:100%;display:flex;flex-direction:column;justify-content:flex-end">'+
      '<div style="border-top:1px solid #999;padding-top:3px"><span'+e+' data-blk="'+b.id+'" data-prop="label">'+this.esc(b.data.label)+'</span></div></div>';
    if(b.type==='meta'){
      let rows=(b.data.fields||[]).map((f,i)=>'<div class="dz-metarow"><span'+e+' data-blk="'+b.id+'" data-mi="'+i+'" data-part="label">'+this.esc(f.label)+'</span>'+
        '<span class="dz-metasep">:</span><span'+e+' data-blk="'+b.id+'" data-mi="'+i+'" data-part="value">'+this.esc(f.value)+'</span></div>').join('');
      return '<div class="dz-strong" style="font-size:1.25em;margin-bottom:4px"'+e+' data-blk="'+b.id+'" data-prop="title">'+this.esc(b.data.title)+'</div>'+rows;
    }
    if(b.type==='amountWords') return '<span class="dz-strong">Amount in words: </span><span data-awtext>'+this.esc(this.amountWordsText())+'</span>';
    if(b.type==='table'){
      const cols=b.data.columns||[]; const tot=this.tableTotals(b);
      const head='<tr>'+cols.map(c=>'<th style="width:'+c.w+'%;text-align:'+c.align+'">'+
        (ed?'<span contenteditable="true" data-blk="'+b.id+'" data-coltitle="'+c.cid+'">'+this.esc(c.label)+'</span>':this.esc(c.label))+'</th>').join('')+'</tr>';
      const body=(b.data.rows||[]).map((row,ri)=>'<tr>'+cols.map(c=>{
        if(c.type==='amount') return '<td data-amt="'+ri+'" style="text-align:'+c.align+'">'+this.money(this.rowAmount(b,row))+'</td>';
        const v=row[c.cid]==null?'':row[c.cid];
        return '<td style="text-align:'+c.align+'"'+(ed?' contenteditable="true" data-blk="'+b.id+'" data-row="'+ri+'" data-cid="'+c.cid+'"':'')+'>'+this.esc(v)+'</td>';
      }).join('')+'</tr>').join('');
      let totals='';
      if(b.data.showTotals && cols.length>=2){ const lc=cols.length;
        const tr=(lab,key,bold)=>'<tr class="dz-totrow"><td colspan="'+(lc-1)+'" style="text-align:right;font-weight:'+(bold?'700':'400')+'">'+lab+'</td>'+
          '<td data-tot="'+key+'" style="text-align:right;font-weight:'+(bold?'700':'400')+'">'+this.money(tot[key])+'</td></tr>';
        totals=tr('Subtotal','sub',false)+tr(this.esc(b.data.taxLabel||'VAT')+' ('+(this.num(b.data.taxPct))+'%)','tax',false)+tr('Total','total',true);
      }
      return '<table class="dz-itable"><thead>'+head+'</thead><tbody>'+body+totals+'</tbody></table>';
    }
    return '';
  },

  /* ---- table computations ---- */
  rowAmount(t,row){ const cols=t.data.columns; const q=cols.find(c=>c.type==='qty'), r=cols.find(c=>c.type==='rate'); return (q&&r)?this.num(row[q.cid])*this.num(row[r.cid]):0; },
  tableTotals(t){ let sub=0; (t.data.rows||[]).forEach(row=>{ sub+=this.rowAmount(t,row); }); const tax=t.data.showTotals?sub*(this.num(t.data.taxPct)/100):0; return {sub,tax,total:sub+tax}; },
  docTotal(){ const t=this.tableBlock(); return t?this.tableTotals(t).total:0; },
  amountWordsText(){ const aw=this.tpl.blocks.find(b=>b.type==='amountWords'); let amt;
    if(aw && aw.data.manual!=='' && aw.data.manual!=null && !isNaN(parseFloat(aw.data.manual))) amt=this.num(aw.data.manual); else amt=this.docTotal();
    return this.words(amt, aw?aw.data.currency:'', aw?aw.data.fraction:''); },
  words(amt,cur,fr){ amt=Math.round((Number(amt)||0)*100)/100; const neg=amt<0; amt=Math.abs(amt);
    const ip=Math.floor(amt), fp=Math.round((amt-ip)*100);
    let s=(neg?'Minus ':'')+toWordsInt(ip)+(cur?' '+cur:''); if(fp>0) s+=' and '+toWordsInt(fp)+(fr?' '+fr:''); return s+' Only'; },
  updateTableComputed(){ const t=this.tableBlock(); if(!t) return; const page=document.getElementById('dzPage');
    (t.data.rows||[]).forEach((row,ri)=>{ const c=page.querySelector('[data-amt="'+ri+'"]'); if(c) c.textContent=this.money(this.rowAmount(t,row)); });
    const tot=this.tableTotals(t); ['sub','tax','total'].forEach(k=>{ const e=page.querySelector('[data-tot="'+k+'"]'); if(e) e.textContent=this.money(tot[k]); });
    const aw=page.querySelector('[data-awtext]'); if(aw) aw.textContent=this.amountWordsText(); },

  /* ---- inline editing ---- */
  bindInline(){ document.querySelectorAll('#dzPage [contenteditable]').forEach(el=>el.addEventListener('input', this._oe)); },
  onEdit(e){ const el=e.target;
    if(el.dataset.row!==undefined){ const t=this.find(el.dataset.blk); if(t){ const row=t.data.rows[+el.dataset.row]; if(row) row[el.dataset.cid]=el.textContent; this.updateTableComputed(); } this.save(); return; }
    if(el.dataset.coltitle!==undefined){ const t=this.find(el.dataset.blk); if(t){ const col=t.data.columns.find(c=>c.cid===el.dataset.coltitle); if(col) col.label=el.textContent; } this.save(); return; }
    if(el.dataset.mi!==undefined){ const b=this.find(el.dataset.blk); if(b){ const f=b.data.fields[+el.dataset.mi]; if(f) f[el.dataset.part]=el.textContent; } this.save(); return; }
    if(el.dataset.prop!==undefined){ const b=this.find(el.dataset.blk); if(b){ const isText=(b.type==='business'||b.type==='party'||b.type==='text')&&el.dataset.prop==='text'; b.data[el.dataset.prop]=isText?el.innerText:el.textContent; } this.save(); return; }
  },

  /* ---- selection ---- */
  blockDown(e,id){ if(e.target.closest('.dz-tools')) return; e.stopPropagation(); this.select(id); },
  bgClick(e){ if(e.target===document.getElementById('dzPage')){ this.selId=null; document.querySelectorAll('#dzPage .dz-block').forEach(el=>el.classList.remove('sel')); this.renderLeft(); this.renderProps(); } },
  select(id){ this.selId=id; document.querySelectorAll('#dzPage .dz-block').forEach(el=>el.classList.toggle('sel',el.dataset.id===id)); this.renderLeft(); this.renderProps(); },

  /* ---- drag / resize ---- */
  gripDown(e,id){ e.preventDefault(); e.stopPropagation(); this.select(id); this.startDrag(e,id,'move'); },
  resizeDown(e,id){ e.preventDefault(); e.stopPropagation(); this.select(id); this.startDrag(e,id,'resize'); },
  startDrag(e,id,mode){ const blk=this.find(id); const rect=document.getElementById('dzPage').getBoundingClientRect();
    this.drag={id,mode,sx:e.clientX,sy:e.clientY,ox:blk.x,oy:blk.y,ow:blk.w,oh:blk.h,rw:rect.width,rh:rect.height};
    this._mm=this.onMove.bind(this); this._mu=this.onUp.bind(this);
    window.addEventListener('mousemove',this._mm); window.addEventListener('mouseup',this._mu); },
  onMove(e){ const d=this.drag; if(!d) return; const blk=this.find(d.id); const el=this.el(d.id); if(!blk||!el) return;
    if(d.mode==='move'){ let nx=d.ox+(e.clientX-d.sx)/d.rw*100, ny=d.oy+(e.clientY-d.sy)/d.rh*100;
      nx=Math.max(0,Math.min(100-blk.w,nx)); ny=Math.max(0,Math.min(100-blk.h,ny));
      blk.x=Math.round(nx*10)/10; blk.y=Math.round(ny*10)/10; el.style.left=blk.x+'%'; el.style.top=blk.y+'%'; }
    else { let nw=d.ow+(e.clientX-d.sx)/d.rw*100, nh=d.oh+(e.clientY-d.sy)/d.rh*100;
      nw=Math.max(6,Math.min(100-blk.x,nw)); nh=Math.max(3,Math.min(100-blk.y,nh));
      blk.w=Math.round(nw*10)/10; blk.h=Math.round(nh*10)/10; el.style.width=blk.w+'%'; el.style.height=blk.h+'%'; } },
  onUp(){ window.removeEventListener('mousemove',this._mm); window.removeEventListener('mouseup',this._mu); this.drag=null; this.save(); this.renderProps(); },

  /* ---- element add / dup / del ---- */
  addMenuToggle(e){ if(e) e.stopPropagation(); document.getElementById('dzAddMenu').classList.toggle('hide'); },
  renderAddMenu(){ document.getElementById('dzAddMenu').innerHTML=this.ELEMENTS.map(x=>'<button onclick="Designer.addBlock(\''+x[0]+'\');Designer.addMenuToggle()">'+x[1]+'</button>').join(''); },
  addBlock(type){ const b={id:this.uid(),type,x:8,y:8,w:42,h:12,align:'left',fontPt:10,bold:false,color:'#333333',data:this.defaultData(type)};
    this.tpl.blocks.push(b); this.selId=b.id; this.save(); this.renderAll(); },
  dup(id){ const b=this.find(id); const c=JSON.parse(JSON.stringify(b)); c.id=this.uid(); c.x=Math.min(90,b.x+3); c.y=Math.min(90,b.y+3);
    if(c.type==='table' && c.data.columns){ const map={}; c.data.columns.forEach(col=>{ const nc=this.uid(); map[col.cid]=nc; col.cid=nc; }); c.data.rows=(c.data.rows||[]).map(r=>{ const nr={}; Object.keys(r).forEach(k=>{ if(map[k]) nr[map[k]]=r[k]; }); return nr; }); }
    this.tpl.blocks.push(c); this.selId=c.id; this.save(); this.renderAll(); },
  del(id){ this.tpl.blocks=this.tpl.blocks.filter(b=>b.id!==id); if(this.selId===id) this.selId=null; this.save(); this.renderAll(); },

  /* ---- left panel ---- */
  renderLeft(){ const p=this.tpl.page; let h='<div class="dz-sec">Page</div>';
    h+='<div class="dz-prop"><label>Paper size</label><select onchange="Designer.setPage(\'size\',this.value)">'+['A4','Letter','Legal','Custom'].map(s=>'<option'+(p.size===s?' selected':'')+'>'+s+'</option>').join('')+'</select></div>';
    h+='<div class="dz-prop"><label>Orientation</label><select onchange="Designer.setPage(\'orient\',this.value)"><option value="portrait"'+(p.orient==='portrait'?' selected':'')+'>Portrait</option><option value="landscape"'+(p.orient==='landscape'?' selected':'')+'>Landscape</option></select></div>';
    if(p.size==='Custom') h+='<div class="dz-prop"><label>Custom width / height (mm)</label><div class="row"><input type="number" value="'+(p.wmm||210)+'" onchange="Designer.setPage(\'wmm\',this.value,true)"><input type="number" value="'+(p.hmm||297)+'" onchange="Designer.setPage(\'hmm\',this.value,true)"></div></div>';
    h+='<div class="dz-prop"><label>Margin guide (mm)</label><input type="number" value="'+(p.marginmm||0)+'" onchange="Designer.setPage(\'marginmm\',this.value,true)"></div>';
    h+='<div class="dz-sec">Add element</div>'+this.ELEMENTS.map(x=>'<button class="dz-layer" onclick="Designer.addBlock(\''+x[0]+'\')">+ '+x[1]+'</button>').join('');
    h+='<div class="dz-sec">Layers</div>'+this.tpl.blocks.map(b=>'<button class="dz-layer'+(b.id===this.selId?' on':'')+'" onclick="Designer.select(\''+b.id+'\')">'+this.blockLabel(b.type)+'</button>').join('');
    document.getElementById('dzLeft').innerHTML=h;
  },
  setPage(prop,val,isNum){ this.tpl.page[prop]=isNum?this.num(val):val; this.save(); this.renderAll(); },

  /* ---- right (properties) panel ---- */
  renderProps(){ const p=document.getElementById('dzProps');
    if(!this.selId){ p.innerHTML='<div class="dz-sec">Properties</div><div style="color:#999;font-size:12.5px">Select an element on the voucher to edit it.<br><br>Drag the blue <b>✥ move</b> handle to reposition. Drag the corner box to resize. Click text to type.</div>'; return; }
    const b=this.find(this.selId); if(!b){ this.selId=null; return this.renderProps(); }
    let h='<div class="dz-sec">'+this.blockLabel(b.type)+'</div>';
    h+='<div class="dz-prop"><label>Position X / Y (%)</label><div class="row"><input type="number" value="'+b.x+'" onchange="Designer.setStyle(\'x\',this.value)"><input type="number" value="'+b.y+'" onchange="Designer.setStyle(\'y\',this.value)"></div></div>';
    h+='<div class="dz-prop"><label>Width / Height (%)</label><div class="row"><input type="number" value="'+b.w+'" onchange="Designer.setStyle(\'w\',this.value)"><input type="number" value="'+b.h+'" onchange="Designer.setStyle(\'h\',this.value)"></div></div>';
    h+='<div class="dz-prop"><label>Font (pt) / Align</label><div class="row"><input type="number" step="0.5" value="'+b.fontPt+'" onchange="Designer.setStyle(\'fontPt\',this.value)"><select onchange="Designer.setStyle(\'align\',this.value)">'+['left','center','right'].map(a=>'<option'+(b.align===a?' selected':'')+'>'+a+'</option>').join('')+'</select></div></div>';
    h+='<div class="dz-prop"><label><input type="checkbox" style="width:auto" '+(b.bold?'checked':'')+' onchange="Designer.setStyle(\'bold\',this.checked)"> Bold &nbsp; &nbsp; Color <input type="color" style="width:42px;height:24px;padding:0;vertical-align:middle" value="'+(b.color||'#333333')+'" onchange="Designer.setStyle(\'color\',this.value)"></label></div>';
    h+=this.propsFor(b);
    h+='<div class="dz-sec">Element</div><div class="row" style="gap:6px"><button class="dz-mini" onclick="Designer.dup(\''+b.id+'\')">⧉ Duplicate</button><button class="dz-mini" style="color:#c0392b" onclick="Designer.del(\''+b.id+'\')">✕ Delete</button></div>';
    p.innerHTML=h;
  },
  propsFor(b){
    if(b.type==='logo') return '<div class="dz-sec">Logo</div>'+
      '<div class="dz-prop"><label>Upload image</label><input type="file" accept="image/*" onchange="Designer.logoUpload(event)"></div>'+
      '<div class="dz-prop"><label>or Image URL</label><input type="text" value="'+this.esc(b.data.src||'')+'" onchange="Designer.setData(\'src\',this.value)"></div>'+
      (b.data.src?'<button class="dz-mini" onclick="Designer.setData(\'src\',\'\')">Clear image</button>':'');
    if(b.type==='business'||b.type==='text'||b.type==='party'||b.type==='signature')
      return '<div class="dz-prop" style="color:#999;font-size:12px">Click the text on the voucher to edit it directly.</div>';
    if(b.type==='meta') return '<div class="dz-sec">Voucher details</div><div style="font-size:12px;color:#999;margin-bottom:6px">Edit the title and values on the voucher. Manage which fields appear here:</div>'+
      (b.data.fields||[]).map((f,i)=>'<div class="ci" style="display:flex;gap:4px;align-items:center;margin-bottom:5px"><span style="flex:1;font-size:12px">'+this.esc(f.label||'(field)')+'</span><button class="dz-x" onclick="Designer.metaRemove('+i+')">✕</button></div>').join('')+
      '<button class="dz-mini" onclick="Designer.metaAdd()">+ Add custom field</button>';
    if(b.type==='table') return '<div class="dz-sec">Columns</div><div class="dz-collist">'+
      (b.data.columns||[]).map((c,i)=>'<div class="ci"><input style="flex:2" value="'+this.esc(c.label)+'" onchange="Designer.colSet('+i+',\'label\',this.value)">'+
        '<select onchange="Designer.colSet('+i+',\'type\',this.value)">'+['text','qty','rate','amount','number'].map(t=>'<option'+(c.type===t?' selected':'')+'>'+t+'</option>').join('')+'</select>'+
        '<select onchange="Designer.colSet('+i+',\'align\',this.value)">'+['left','center','right'].map(a=>'<option'+(c.align===a?' selected':'')+'>'+a+'</option>').join('')+'</select>'+
        '<input type="number" style="width:46px" value="'+c.w+'" title="width %" onchange="Designer.colSet('+i+',\'w\',this.value)">'+
        '<button class="dz-x" onclick="Designer.colRemove('+i+')">✕</button></div>').join('')+
      '</div><button class="dz-mini" onclick="Designer.colAdd()">+ Add column (custom field)</button>'+
      '<div class="dz-sec">Rows</div><div class="row" style="gap:6px"><button class="dz-mini" onclick="Designer.rowAdd()">+ Add row</button><button class="dz-mini" onclick="Designer.rowRemove()">− Remove last row</button></div>'+
      '<div style="font-size:12px;color:#999;margin-top:6px">Type into the cells on the voucher to fill them. Amount = Qty × Rate.</div>'+
      '<div class="dz-sec">Totals</div><div class="dz-prop"><label><input type="checkbox" style="width:auto" '+(b.data.showTotals?'checked':'')+' onchange="Designer.setData(\'showTotals\',this.checked)"> Show Subtotal / Tax / Total</label></div>'+
      '<div class="dz-prop"><label>Tax label / Tax %</label><div class="row"><input value="'+this.esc(b.data.taxLabel||'VAT')+'" onchange="Designer.setData(\'taxLabel\',this.value)"><input type="number" step="0.01" value="'+(b.data.taxPct||0)+'" onchange="Designer.setData(\'taxPct\',this.value,true)"></div></div>';
    if(b.type==='amountWords') return '<div class="dz-sec">Amount in words</div>'+
      '<div class="dz-prop"><label>Currency word</label><input value="'+this.esc(b.data.currency||'')+'" onchange="Designer.setData(\'currency\',this.value)"></div>'+
      '<div class="dz-prop"><label>Fraction word</label><input value="'+this.esc(b.data.fraction||'')+'" onchange="Designer.setData(\'fraction\',this.value)"></div>'+
      '<div class="dz-prop"><label>Manual amount (blank = auto from table total)</label><input value="'+this.esc(b.data.manual||'')+'" onchange="Designer.setData(\'manual\',this.value)"></div>';
    return '';
  },
  setStyle(prop,val){ const b=this.find(this.selId); if(!b) return; if(prop==='bold') b.bold=!!val; else if(prop==='align'||prop==='color') b[prop]=val; else b[prop]=this.num(val);
    const el=this.el(b.id); if(el){ el.style.left=b.x+'%';el.style.top=b.y+'%';el.style.width=b.w+'%';el.style.height=b.h+'%';el.style.textAlign=b.align;el.style.fontSize=b.fontPt+'pt';el.style.color=b.color;el.style.fontWeight=b.bold?'700':'400'; } this.save(); },
  setData(prop,val,isNum){ const b=this.find(this.selId); if(!b) return; b.data[prop]=(typeof val==='boolean')?val:(isNum?this.num(val):val); this.save(); this.renderCanvas(); this.renderProps(); },
  logoUpload(e){ const f=e.target.files&&e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ const b=this.find(this.selId); if(b){ b.data.src=r.result; this.save(); this.renderCanvas(); this.renderProps(); } }; r.readAsDataURL(f); },
  metaAdd(){ const b=this.find(this.selId); b.data.fields.push({label:'Custom field',value:''}); this.save(); this.renderCanvas(); this.renderProps(); },
  metaRemove(i){ const b=this.find(this.selId); b.data.fields.splice(i,1); this.save(); this.renderCanvas(); this.renderProps(); },
  colAdd(){ const b=this.find(this.selId); b.data.columns.push({cid:this.uid(),label:'Custom',type:'text',align:'left',w:15}); this.save(); this.renderCanvas(); this.renderProps(); },
  colRemove(i){ const b=this.find(this.selId); const cid=b.data.columns[i].cid; b.data.columns.splice(i,1); (b.data.rows||[]).forEach(r=>{ delete r[cid]; }); this.save(); this.renderCanvas(); this.renderProps(); },
  colSet(i,prop,val){ const b=this.find(this.selId); b.data.columns[i][prop]=(prop==='w')?this.num(val):val; this.save(); this.renderCanvas(); this.renderProps(); },
  rowAdd(){ const b=this.find(this.selId); b.data.rows.push({}); this.save(); this.renderCanvas(); this.renderProps(); },
  rowRemove(){ const b=this.find(this.selId); if(b.data.rows.length) b.data.rows.pop(); this.save(); this.renderCanvas(); this.renderProps(); },

  /* ---- preview / print ---- */
  print(){ const {w,h}=this.pageDims();
    let pc=document.getElementById('designPrint'); if(!pc){ pc=document.createElement('div'); pc.id='designPrint'; document.body.appendChild(pc); }
    let st=document.getElementById('designPrintStyle'); if(!st){ st=document.createElement('style'); st.id='designPrintStyle'; document.head.appendChild(st); }
    st.textContent='@page{size:'+w+'mm '+h+'mm;margin:0}@media print{body>*:not(#designPrint){display:none!important}#designPrint{display:block!important;left:0!important}}';
    pc.innerHTML='<div style="position:relative;width:'+w+'mm;height:'+h+'mm;background:#fff;overflow:hidden;font-family:'+ "'Segoe UI',Arial,sans-serif" +';color:#333">'+this.renderBlocks(false)+'</div>';
    var clean=function(){ try{ st.textContent=''; pc.innerHTML=''; }catch(e){} window.removeEventListener('afterprint',clean); };
    window.addEventListener('afterprint',clean);
    window.print(); setTimeout(clean,1500);
  },

  toast(msg){ const t=document.getElementById('dzToast'); t.textContent=msg; t.classList.remove('hide'); clearTimeout(this._tt); this._tt=setTimeout(()=>t.classList.add('hide'),1500); },
};

document.addEventListener('click', e=>{ const dd=document.getElementById('addDd'); if(dd && !dd.contains(e.target)) document.getElementById('addMenu')?.classList.add('hide'); });
App.init();

