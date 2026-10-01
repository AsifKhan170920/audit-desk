/* ============================================================
   VAT DESK – inside the Fair Tax CRM
   • one workspace per client and tax period (#/vat/<client>/<YYYY-MM of period end>)
   • registers: sales, purchases & expenses, imports (customs), reverse charge, adjustments
   • Excel / CSV import (column mapping remembered per client) or paste from Excel
   • VAT 201 boxes, monthly breakdown, review checks
   • report on the firm's letterhead with a client sign & stamp block
   • filing details flow back to the client's VAT Filing panel in the CRM
   Each return is saved as its own cloud record (apps/crm/store/ftvat-…), so large registers
   never slow down the CRM; the CRM keeps a small index (db.vatReturns).
   ============================================================ */
(function () {
  'use strict';
  if (window.VATDESK || typeof load !== 'function') return;

  var EMIRATES = [['AUH', 'Abu Dhabi', '1a'], ['DXB', 'Dubai', '1b'], ['SHJ', 'Sharjah', '1c'], ['AJM', 'Ajman', '1d'], ['UAQ', 'Umm Al Quwain', '1e'], ['RAK', 'Ras Al Khaimah', '1f'], ['FUJ', 'Fujairah', '1g']];
  var REGS = [['sales', 'Sales'], ['purchases', 'Purchases & expenses'], ['imports', 'Imports (customs)'], ['rc', 'Reverse charge'], ['adj', 'Adjustments']];
  var CATS = {
    sales: [['SR', 'Standard rated 5%'], ['ZR', 'Zero rated'], ['EX', 'Exempt'], ['TR', 'Tourist refund'], ['OS', 'Out of scope']],
    purchases: [['SR', 'Standard rated – recoverable'], ['BL', 'Blocked – not recoverable'], ['NV', 'No VAT (zero / exempt / unregistered)']],
    imports: [['IM', 'Import – VAT recoverable'], ['IB', 'Import – not recoverable']],
    rc: [['RC', 'Reverse charge – recoverable'], ['RB', 'Reverse charge – not recoverable']],
    adj: [['1a', 'Box 1a Abu Dhabi'], ['1b', 'Box 1b Dubai'], ['1c', 'Box 1c Sharjah'], ['1d', 'Box 1d Ajman'], ['1e', 'Box 1e Umm Al Quwain'], ['1f', 'Box 1f Ras Al Khaimah'], ['1g', 'Box 1g Fujairah'], ['7', 'Box 7 Adjustments to imports'], ['9', 'Box 9 Expenses']]
  };
  var STATUSES = ['Not started', 'In progress', 'Ready for review', 'Sent to client', 'Approved by client', 'Filed'];
  var ST_TONE = {'Not started': 'low', 'In progress': 'blue', 'Ready for review': 'pending', 'Sent to client': 'pending', 'Approved by client': 'progress', 'Filed': 'completed'};
  var DOCS = ['Sales invoices', 'Purchase & expense invoices', 'Bank statements', 'Customs declarations (imports)', 'Credit / debit notes', 'Sales & purchase registers from the client'];
  var BLOCK_RE = /entertain|hospitality|meal|lunch|dinner|restaurant|cafe|gift|personal|car rental|fuel – private|leisure|club membership/i;
  var KEY = function (id) { return 'ftvat-' + id; };
  var r2 = function (n) { return Math.round((+n || 0) * 100) / 100; };
  var CUR = null, TAB = 'boxes', FILTER = '', LIST_FILTER = 'due', LIST_SEARCH = '', pushTimers = {};

  /* ---------- storage: one record per return ---------- */
  function cloud() { return window.FT && FT.pull && FT.push && FT.me; }
  function readLocal(id) { try { var t = localStorage.getItem(KEY(id)); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function remember(id) {   // keep at most 20 returns cached in this browser
    try { var L = JSON.parse(localStorage.getItem('ftvat-recent') || '[]').filter(function (x) { return x !== id; }); L.unshift(id);
      L.slice(20).forEach(function (x) { localStorage.removeItem(KEY(x)); }); localStorage.setItem('ftvat-recent', JSON.stringify(L.slice(0, 20))); } catch (e) {}
  }
  async function openReturn(cid, period) {
    var id = cid + '_' + period, r = null;
    if (cloud()) { try { var got = await FT.pull('crm', KEY(id)); if (got.found) r = readLocal(id); } catch (e) { toast('Could not load the latest copy – using this computer\'s copy'); r = readLocal(id); } }
    else r = readLocal(id);
    if (!r) r = newReturn(cid, period);
    remember(id);
    return r;
  }
  function newReturn(cid, period) {
    var c = client(cid), monthly = /month/i.test((c && c.vatCycle) || ''), e = new Date(+period.slice(0, 4), +period.slice(5, 7), 0), s = new Date(e.getFullYear(), e.getMonth() - (monthly ? 0 : 2), 1);
    return {id: cid + '_' + period, clientId: cid, period: period, start: ymd(s), end: ymd(e), status: 'Not started', lines: [], ov: {}, docs: {}, notes: '', created: ymd(new Date()), by: meName()};
  }
  function saveReturn(r, quiet) {
    r.updated = new Date().toISOString(); r.updatedBy = meName();
    if (r.status === 'Not started' && r.lines.length) r.status = 'In progress';
    var text = JSON.stringify(r);
    try { localStorage.setItem(KEY(r.id), text); } catch (e) { toast('This computer\'s storage is full – the return is still saved online'); }
    // small index in the CRM data
    var db = load(), B = calc(r, client(r.clientId) || {}), ix = (db.vatReturns = db.vatReturns || []), row = ix.find(function (x) { return x.id === r.id; });
    var sum = {id: r.id, clientId: r.clientId, period: r.period, status: r.status, payable: B.n14, lines: r.lines.length, updated: r.updated, by: r.updatedBy};
    if (row) Object.assign(row, sum); else ix.push(sum);
    save();
    if (cloud()) { clearTimeout(pushTimers[r.id]); pushTimers[r.id] = setTimeout(function () { delete pushTimers[r.id]; pushNow(r, text); }, 1200); }
    if (!quiet) toast('Saved');
  }
  async function pushNow(r, text) {
    try {
      var res = await FT.push('crm', KEY(r.id), text);
      if (res && res.conflict) { toast('This return was changed by ' + (res.by || 'someone else') + ' – reloading their copy'); CUR = await openReturn(r.clientId, r.period); draw(); }
    } catch (e) { toast('Could not save online – will retry with the next change'); }
  }
  function outside(r, l) { return !!(l.date && (l.date < r.start || l.date > r.end)); }
  function periodFor(c, date) {   // the client's tax period (YYYY-MM of its last month) that contains this date
    var d = pDate(date); if (!d) return '';
    var ends = vatMonths(c.vatCycle);
    for (var i = 0; i < 12; i++) { var m = new Date(d.getFullYear(), d.getMonth() + i, 1); if (ends.indexOf(m.getMonth() + 1) >= 0) return ymd(m).slice(0, 7); }
    return '';
  }
  function client(id) { return load().clients.find(function (c) { return c.id === id; }); }

  /* ---------- the VAT 201 ---------- */
  function calc(r, c) {
    var B = {}, k, em = c.emirate || 'DXB';
    ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '2', '3', '4', '5', '6', '7', '9', '10'].forEach(function (x) { B[x] = {amt: 0, vat: 0, adj: 0}; });
    (r.lines || []).forEach(function (l) {
      var n = +l.net || 0, v = +l.vat || 0, rec = l.rec === '' || l.rec == null ? 100 : +l.rec;
      if (l.reg === 'sales') {
        if (l.cat === 'SR') { var e = EMIRATES.find(function (x) { return x[0] === (l.emirate || em); }) || EMIRATES[1]; B[e[2]].amt += n; B[e[2]].vat += v; }
        else if (l.cat === 'ZR') B['4'].amt += n; else if (l.cat === 'EX') B['5'].amt += n;
        else if (l.cat === 'TR') { B['2'].amt -= Math.abs(n); B['2'].vat -= Math.abs(v); }
      } else if (l.reg === 'purchases') { if (l.cat === 'SR' && rec > 0) { B['9'].amt += n; B['9'].vat += v * rec / 100; } }
      else if (l.reg === 'imports') { B['6'].amt += n; B['6'].vat += v; if (l.cat !== 'IB') { B['10'].amt += n; B['10'].vat += v * rec / 100; } }
      else if (l.reg === 'rc') { B['3'].amt += n; B['3'].vat += v; if (l.cat !== 'RB') { B['10'].amt += n; B['10'].vat += v * rec / 100; } }
      else if (l.reg === 'adj') { if (l.cat === '7') { B['7'].amt += n; B['7'].vat += v; } else if (B[l.cat]) B[l.cat].adj += v; }
    });
    for (k in (r.ov || {})) if (B[k]) ['amt', 'vat', 'adj'].forEach(function (f) { if (r.ov[k][f] !== '' && r.ov[k][f] != null) B[k][f] = +r.ov[k][f]; });
    for (k in B) { B[k].amt = r2(B[k].amt); B[k].vat = r2(B[k].vat); B[k].adj = r2(B[k].adj); }
    var out = ['1a', '1b', '1c', '1d', '1e', '1f', '1g', '2', '3', '4', '5', '6', '7'];
    B['8'] = {amt: r2(out.reduce(function (s, x) { return s + B[x].amt; }, 0)), vat: r2(['1a', '1b', '1c', '1d', '1e', '1f', '1g', '2', '3', '6', '7'].reduce(function (s, x) { return s + B[x].vat; }, 0)), adj: r2(['1a', '1b', '1c', '1d', '1e', '1f', '1g'].reduce(function (s, x) { return s + B[x].adj; }, 0))};
    B['11'] = {amt: r2(B['9'].amt + B['10'].amt), vat: r2(B['9'].vat + B['10'].vat), adj: B['9'].adj};
    B.n12 = r2(B['8'].vat + B['8'].adj); B.n13 = r2(B['11'].vat + B['11'].adj); B.n14 = r2(B.n12 - B.n13);
    return B;
  }
  var BOX_TXT = {'1a': 'Standard rated supplies in Abu Dhabi', '1b': 'Standard rated supplies in Dubai', '1c': 'Standard rated supplies in Sharjah', '1d': 'Standard rated supplies in Ajman',
    '1e': 'Standard rated supplies in Umm Al Quwain', '1f': 'Standard rated supplies in Ras Al Khaimah', '1g': 'Standard rated supplies in Fujairah', '2': 'Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme',
    '3': 'Supplies subject to the reverse charge provisions', '4': 'Zero rated supplies', '5': 'Supplies of goods and services which are exempt from VAT', '6': 'Goods imported into the UAE', '7': 'Adjustments to goods imported into the UAE',
    '8': 'Totals', '9': 'Standard rated expenses', '10': 'Supplies subject to the reverse charge provisions', '11': 'Totals'};
  function dueOf(r) { var e = pDate(r.end), d = new Date(e.getFullYear(), e.getMonth() + 1, 28), w = d.getDay(); if (w === 6) d.setDate(d.getDate() + 2); if (w === 0) d.setDate(d.getDate() + 1); return ymd(d); }
  function periodLabel(r) { var s = pDate(r.start), e = pDate(r.end); return s.getMonth() === e.getMonth() ? MON3[e.getMonth()] + ' ' + e.getFullYear() : MON3[s.getMonth()] + (s.getFullYear() !== e.getFullYear() ? ' ' + s.getFullYear() : '') + '–' + MON3[e.getMonth()] + ' ' + e.getFullYear(); }

  /* ---------- monthly breakdown ---------- */
  function monthly(r) {
    var s = pDate(r.start), M = [], i;
    for (i = 0; i < 12; i++) { var d = new Date(s.getFullYear(), s.getMonth() + i, 1); if (ymd(d) > r.end) break; M.push({key: ymd(d).slice(0, 7), label: MON3[d.getMonth()] + ' ' + d.getFullYear(), sales: 0, out: 0, purch: 0, inp: 0}); }
    var other = {key: 'x', label: 'Invoices dated in other periods, declared here', sales: 0, out: 0, purch: 0, inp: 0};
    (r.lines || []).forEach(function (l) {
      var m = M.find(function (x) { return (l.date || '').slice(0, 7) === x.key; }) || other, n = +l.net || 0, v = +l.vat || 0, rec = l.rec === '' || l.rec == null ? 100 : +l.rec;
      if (l.reg === 'sales' && l.cat !== 'OS') { m.sales += l.cat === 'TR' ? 0 : n; m.out += l.cat === 'SR' ? v : l.cat === 'TR' ? -Math.abs(v) : 0; }
      else if (l.reg === 'purchases') { m.purch += n; if (l.cat === 'SR') m.inp += v * rec / 100; }
      else if (l.reg === 'imports' || l.reg === 'rc') { m.purch += n; m.out += v; if (l.cat === 'IM' || l.cat === 'RC') m.inp += v * rec / 100; }
    });
    if (other.sales || other.purch || other.out || other.inp) M.push(other);
    M.forEach(function (m) { m.net = r2(m.out - m.inp); });
    return M;
  }

  /* ---------- review checks ---------- */
  function checks(r) {
    var out = [], seen = {};
    (r.lines || []).forEach(function (l) {
      var n = +l.net || 0, v = +l.vat || 0, tag = (REGS.find(function (x) { return x[0] === l.reg; }) || [])[1] + ' · ' + (l.no || l.party || 'line');
      if (l.reg === 'adj') return;
      if (outside(r, l) && !l.here) out.push(['warn', tag, 'Dated ' + fmtDate(l.date) + ' – in another tax period. Declare it here (e.g. invoice received late) or move it to its own period.', l.id, 'date']);
      if (!l.date) out.push(['warn', tag, 'No date', l.id]);
      if ((l.cat === 'SR' || l.cat === 'IM' || l.cat === 'RC') && n && Math.abs(v - n * 0.05) > Math.max(1, Math.abs(n) * 0.002)) out.push(['high', tag, 'VAT ' + money(v) + ' is not 5% of ' + money(n) + ' (' + money(n * 0.05) + ')', l.id]);
      if ((l.cat === 'ZR' || l.cat === 'EX' || l.cat === 'NV') && v) out.push(['high', tag, 'VAT charged on a ' + (l.cat === 'ZR' ? 'zero-rated' : l.cat === 'EX' ? 'exempt' : 'no-VAT') + ' line', l.id]);
      if (l.reg === 'purchases' && l.cat === 'SR' && v && !/^100\d{12}$/.test(String(l.trn || '').replace(/\D/g, ''))) out.push(['high', tag, l.trn ? 'Supplier TRN ' + l.trn + ' does not look valid (15 digits starting 100)' : 'Supplier TRN missing – input VAT needs a valid tax invoice', l.id]);
      if (l.reg === 'purchases' && l.cat === 'SR' && BLOCK_RE.test((l.desc || '') + ' ' + (l.party || ''))) out.push(['warn', tag, 'Looks like entertainment / private use – input VAT may be blocked (Cabinet Decision 52 of 2017, Art. 53)', l.id]);
      if (l.reg === 'sales' && l.cat === 'SR' && l.emirate === '') out.push(['warn', tag, 'No emirate – counted under the client\'s main emirate', l.id]);
      var key = l.reg + '|' + String(l.party || '').toLowerCase().trim() + '|' + String(l.no || '').toLowerCase().trim();
      if (l.no && seen[key]) out.push(['high', tag, 'Possible duplicate of another line with the same party and invoice no.', l.id]); else seen[key] = 1;
    });
    if (!(r.lines || []).length) out.push(['warn', 'Return', 'No lines yet – import the registers or add lines', null]);
    return out;
  }

  /* ---------- list of VAT clients ---------- */
  function vatClients(db) { return db.clients.filter(function (c) { return c.status !== 'Inactive' && svcList(c).indexOf('VAT Filing') >= 0; }); }
  function currentPeriod(c, db) {
    var P = vatPeriods(c, db).filter(function (p) { return p.st !== 'before'; });
    return P.filter(function (p) { return p.st === 'overdue' || p.st === 'pending'; })[0] || P.filter(function (p) { return p.st === 'open'; })[0] || P[P.length - 1];
  }
  function renderList() {
    undockAI();
    var db = load(), q = LIST_SEARCH.toLowerCase(), ix = db.vatReturns || [];
    var rows = vatClients(db).map(function (c) {
      var p = c.vatCycle ? currentPeriod(c, db) : null, ret = p ? ix.find(function (x) { return x.id === c.id + '_' + p.key; }) : null;
      return {c: c, p: p, ret: ret};
    }).filter(function (x) { return (!q || x.c.name.toLowerCase().indexOf(q) >= 0) && (LIST_FILTER === 'all' || (x.p && (x.p.st === 'pending' || x.p.st === 'overdue'))); })
      .sort(function (a, b) { return ((a.p && ymd(a.p.due)) || '9').localeCompare((b.p && ymd(b.p.due)) || '9'); });
    var all = vatClients(db), toFile = all.filter(function (c) { var p = c.vatCycle && currentPeriod(c, db); return p && (p.st === 'pending' || p.st === 'overdue'); }).length;
    app.innerHTML = '<div class="page-head"><div><h1>VAT Desk</h1></div></div>' +
      '<div class="pdc-tabs"><button class="' + (LIST_FILTER === 'due' ? 'on' : '') + '" data-vd="list-filter" data-v="due">To file (' + toFile + ')</button><button class="' + (LIST_FILTER === 'all' ? 'on' : '') + '" data-vd="list-filter" data-v="all">All VAT clients (' + all.length + ')</button></div>' +
      '<div class="card"><div style="overflow-x:auto"><table class="tbl sm"><thead><tr><th>Client</th><th>Tax periods</th><th>Period</th><th>Due</th><th>Filing</th><th>Return</th><th class="r">Net VAT (AED)</th><th></th></tr></thead><tbody>' +
      (rows.map(function (x) {
        var c = x.c, p = x.p, ret = x.ret, st = ret ? ret.status : 'Not started', tone = p ? ST_PILL[p.st] : ['low', '—'];
        return '<tr><td><span class="link" data-goto="#/client/' + c.id + '">' + esc(c.name) + '</span></td><td class="sub2">' + esc((VAT_CYCLES.find(function (v) { return v[0] === c.vatCycle; }) || ['', 'not set'])[1]) + '</td>' +
          '<td>' + (p ? esc(p.label) : '<span class="sub2">set the VAT periods</span>') + '</td><td>' + (p ? fmtDate(ymd(p.due)) : '—') + '</td><td>' + (p ? '<span class="pill ' + tone[0] + '">' + tone[1] + '</span>' : '') + '</td>' +
          '<td><span class="pill ' + (ST_TONE[st] || 'low') + '">' + esc(st) + '</span>' + (ret && ret.lines ? ' <span class="sub2">' + ret.lines + ' lines</span>' : '') + '</td>' +
          '<td class="r mono">' + (ret && ret.lines ? (ret.payable < 0 ? '(' + money(-ret.payable) + ')' : money(ret.payable)) : '—') + '</td>' +
          '<td class="r">' + (p ? '<a class="btn btn-sm btn-primary" href="#/vat/' + c.id + '/' + p.key + '">Open</a>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="empty" style="padding:22px">' + (LIST_FILTER === 'due' ? 'Nothing to file right now.' : 'No clients with the VAT Filing service.') + '</td></tr>') +
      '</tbody></table></div></div><div class="cd-hint">Clients appear here when VAT Filing is ticked under Client details. Open a return to import the registers, review and send the report.</div>';
    setCount(rows.length + ' client' + (rows.length !== 1 ? 's' : ''));
    pageTitle();
  }

  /* ---------- one return ---------- */
  async function renderReturn(cid, period) {
    undockAI();
    var c = client(cid); if (!c) { app.innerHTML = '<div class="empty">Client not found</div>'; return; }
    if (!CUR || CUR.id !== cid + '_' + period) { app.innerHTML = '<div class="empty">Loading the return…</div>'; CUR = await openReturn(cid, period); TAB = 'boxes'; FILTER = ''; }
    draw();
  }
  function draw() {
    var r = CUR; if (!r) return;
    var c = client(r.clientId) || {name: '?'}, B = calc(r, c), K = checks(r), due = dueOf(r), cnt = function (reg) { return r.lines.filter(function (l) { return l.reg === reg; }).length; };
    var tabs = [['boxes', 'VAT 201 (for filing)'], ['month', 'Monthly']].concat(REGS.map(function (x) { return [x[0], x[1] + ' (' + cnt(x[0]) + ')']; })).concat([['checks', 'Checks (' + K.length + ')'], ['docs', 'Documents & approval']]);
    var pos = B.n14 >= 0;
    app.innerHTML = '<div class="page-head cd-head"><div style="display:flex;gap:10px;align-items:center"><a class="back" href="#/vat">←</a><div><h1 style="font-size:22px">VAT return – ' + esc(c.name) + '</h1>' +
      '<div style="color:var(--muted);font-size:12.5px">' + esc(periodLabel(r)) + ' · due ' + fmtDate(due) + (c.trn && c.trn !== '-' ? ' · TRN ' + esc(c.trn) : '') + '</div></div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><select class="pdc-sel ' + (ST_TONE[r.status] || 'low') + '" data-vd-status title="Return status">' + STATUSES.map(function (s) { return '<option' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<button class="btn" data-vd="import">📥 Import Excel</button><button class="btn" data-vd="report">🖨 Report</button>' + (r.status !== 'Filed' ? '<button class="btn btn-primary" data-vd="file">Mark filed</button>' : '') + '</div></div>' +
      '<div class="vd-sum"><div><span>Output VAT</span><b>' + money(B.n12) + '</b></div><div><span>Input VAT</span><b>' + money(B.n13) + '</b></div><div class="' + (pos ? 'pay' : 'ref') + '"><span>' + (pos ? 'Payable to FTA' : 'Refundable') + '</span><b>AED ' + money(Math.abs(B.n14)) + '</b></div><div><span>Due</span><b>' + fmtDate(due) + '</b></div><div class="' + (K.some(function (k) { return k[0] === 'high'; }) ? 'bad' : '') + '"><span>Checks</span><b>' + K.length + '</b></div></div>' +
      '<div class="pdc-tabs">' + tabs.map(function (t) { return '<button class="' + (TAB === t[0] ? 'on' : '') + '" data-vd="tab" data-v="' + t[0] + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="card card-p vd-body">' + body(r, c, B, K) + '</div>';
    pageTitle();
  }
  function body(r, c, B, K) {
    if (TAB === 'boxes') return boxesHtml(r, B, true);
    if (TAB === 'month') return monthHtml(r);
    if (TAB === 'checks') return K.length ? '<table class="tbl sm"><thead><tr><th></th><th>Line</th><th>Issue</th><th></th></tr></thead><tbody>' + K.map(function (k) { return '<tr><td><span class="pill ' + (k[0] === 'high' ? 'high' : 'pending') + '">' + (k[0] === 'high' ? 'Fix' : 'Check') + '</span></td><td>' + esc(k[1]) + '</td><td>' + esc(k[2]) + '</td><td class="r" style="white-space:nowrap">' + (k[4] === 'date' ? '<span class="link" data-vd="here" data-v="' + k[3] + '">Declare here</span> · <span class="link" data-vd="move" data-v="' + k[3] + '">Move</span> · ' : '') + (k[3] ? '<span class="link" data-vd="goto-line" data-v="' + k[3] + '">Show</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No issues found.</div>';
    if (TAB === 'docs') return docsHtml(r, c);
    return regHtml(r, TAB);
  }
  function boxesHtml(r, B, edit) {
    var row = function (k, cols, txt) {
      var b = B[k], ov = (r.ov || {})[k] || {}, cell = function (f, show) {
        if (!show) return '<td></td>';
        var v = b[f], o = ov[f] !== '' && ov[f] != null;
        return edit ? '<td class="r"><input class="tb-in vd-ov' + (o ? ' ov' : '') + '" type="number" step="any" data-vd-ov="' + k + '.' + f + '" value="' + v + '" title="' + (o ? 'Overridden – clear to use the registers' : 'From the registers – type to override') + '"></td>' : '<td class="r mono">' + money(v) + '</td>';
      };
      return '<tr><td class="bx">' + k + '</td><td>' + esc(txt || BOX_TXT[k]) + '</td>' + cell('amt', cols[0]) + cell('vat', cols[1]) + cell('adj', cols[2]) + '</tr>';
    };
    var tot = function (k) { return '<tr class="pf-tot"><td class="bx">' + k + '</td><td>' + BOX_TXT[k] + '</td><td class="r mono">' + money(B[k].amt) + '</td><td class="r mono">' + money(B[k].vat) + '</td><td class="r mono">' + money(B[k].adj) + '</td></tr>'; };
    return '<table class="tbl sm vd-box"><thead><tr><th style="width:40px">Box</th><th>VAT on sales and all other outputs</th><th class="r">Amount (AED)</th><th class="r">VAT amount (AED)</th><th class="r">Adjustment (AED)</th></tr></thead><tbody>' +
      ['1a', '1b', '1c', '1d', '1e', '1f', '1g'].map(function (k) { return row(k, [1, 1, 1]); }).join('') + row('2', [1, 1, 0]) + row('3', [1, 1, 0]) + row('4', [1, 0, 0]) + row('5', [1, 0, 0]) + row('6', [1, 1, 0]) + row('7', [1, 1, 0]) + tot('8') +
      '</tbody><thead><tr><th></th><th>VAT on expenses and all other inputs</th><th class="r">Amount (AED)</th><th class="r">Recoverable VAT (AED)</th><th class="r">Adjustment (AED)</th></tr></thead><tbody>' +
      row('9', [1, 1, 1]) + row('10', [1, 1, 0]) + tot('11') + '</tbody></table>' +
      '<table class="tbl sm vd-box" style="margin-top:10px"><tbody><tr><td class="bx">12</td><td>Total value of due tax for the period</td><td class="r mono">' + money(B.n12) + '</td></tr><tr><td class="bx">13</td><td>Total value of recoverable tax for the period</td><td class="r mono">' + money(B.n13) + '</td></tr>' +
      '<tr class="pf-tot"><td class="bx">14</td><td>' + (B.n14 >= 0 ? 'Payable tax for the period' : 'Repayable tax for the period') + '</td><td class="r mono" style="color:' + (B.n14 >= 0 ? 'var(--red)' : 'var(--green)') + '">' + money(Math.abs(B.n14)) + '</td></tr></tbody></table>' +
      (edit ? '<div class="cd-hint">Boxes fill themselves from the registers. Typing in a box overrides it (shown in amber) – clear it to go back to the registers.</div>' : '');
  }
  function monthHtml(r) {
    var M = monthly(r), T = M.reduce(function (t, m) { ['sales', 'out', 'purch', 'inp', 'net'].forEach(function (k) { t[k] += m[k]; }); return t; }, {sales: 0, out: 0, purch: 0, inp: 0, net: 0});
    return '<table class="tbl sm"><thead><tr><th>Month</th><th class="r">Sales (net)</th><th class="r">Output VAT</th><th class="r">Purchases & expenses (net)</th><th class="r">Input VAT recoverable</th><th class="r">Net VAT</th></tr></thead><tbody>' +
      M.map(function (m) { return '<tr' + (m.key === 'x' ? ' class="late"' : '') + '><td>' + esc(m.label) + '</td><td class="r mono">' + money(m.sales) + '</td><td class="r mono">' + money(m.out) + '</td><td class="r mono">' + money(m.purch) + '</td><td class="r mono">' + money(m.inp) + '</td><td class="r mono">' + money(m.net) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="r mono">' + money(T.sales) + '</td><td class="r mono">' + money(T.out) + '</td><td class="r mono">' + money(T.purch) + '</td><td class="r mono">' + money(T.inp) + '</td><td class="r mono">' + money(T.net) + '</td></tr></tfoot></table>';
  }
  function dateTag(r, l) {
    if (!outside(r, l)) return '';
    var c = client(r.clientId) || {}, p = periodFor(c, l.date);
    return l.here ? '<div class="vd-late on" title="' + esc(l.here) + '">✓ declared here' + (l.here !== 'yes' ? ' – ' + esc(l.here) : '') + ' <span class="link" data-vd="unhere" data-v="' + l.id + '">undo</span></div>'
      : '<div class="vd-late">other period' + (p ? ' (' + esc(periodLabel(newReturn(r.clientId, p))) + ')' : '') + ': <span class="link" data-vd="here" data-v="' + l.id + '">declare here</span> · <span class="link" data-vd="move" data-v="' + l.id + '">move</span></div>';
  }
  function regHtml(r, reg) {
    var all = r.lines.filter(function (l) { return l.reg === reg; }), q = FILTER.toLowerCase();
    var L = all.filter(function (l) { return !q || [l.no, l.party, l.trn, l.desc].join(' ').toLowerCase().indexOf(q) >= 0; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    var em = function (l) { return '<select class="tb-in" data-vl="' + l.id + '.emirate"><option value="">—</option>' + EMIRATES.map(function (e) { return '<option value="' + e[0] + '"' + (l.emirate === e[0] ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>'; };
    var inp = function (l, f, t, w) { return '<input class="tb-in" ' + (t ? 'type="' + t + '" step="any" ' : '') + 'data-vl="' + l.id + '.' + f + '" value="' + esc(l[f] == null ? '' : l[f]) + '"' + (w ? ' style="width:' + w + '"' : '') + '>'; };
    var cat = function (l) { return '<select class="tb-in" data-vl="' + l.id + '.cat">' + CATS[reg].map(function (x) { return '<option value="' + x[0] + '"' + (l.cat === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>'; };
    var T = L.reduce(function (t, l) { t.n += +l.net || 0; t.v += +l.vat || 0; return t; }, {n: 0, v: 0});
    var party = reg === 'sales' ? 'Customer' : 'Supplier', head = reg === 'adj' ? '<th>Date</th><th>Ref</th><th>Description</th><th>Box</th><th class="r">Net</th><th class="r">VAT</th>' :
      '<th>Date</th><th>Invoice no.</th><th>' + party + '</th><th>TRN</th>' + (reg === 'sales' ? '<th>Emirate</th>' : '<th>Description</th>') + '<th>Category</th><th class="r">Net</th><th class="r">VAT</th>' + (reg === 'sales' ? '' : '<th class="r">Recover %</th>');
    return '<div class="vd-tools"><input class="hd-in" placeholder="Search invoice no., party, TRN…" value="' + esc(FILTER) + '" data-vd-filter style="width:240px"><button class="btn btn-sm btn-primary" data-vd="add" data-v="' + reg + '">＋ Line</button><button class="btn btn-sm" data-vd="import" data-v="' + reg + '">📥 Import Excel / paste</button>' + (all.length ? '<button class="btn btn-sm btn-danger" data-vd="clear" data-v="' + reg + '">Delete all ' + all.length + '</button>' : '') + '</div>' +
      '<div style="overflow-x:auto"><table class="tbl sm vd-reg"><thead><tr>' + head + '<th></th></tr></thead><tbody>' +
      (L.map(function (l) {
        return '<tr id="vl-' + l.id + '">' + (reg === 'adj' ? '<td>' + inp(l, 'date', 'date') + '</td><td>' + inp(l, 'no') + '</td><td>' + inp(l, 'desc') + '</td><td>' + cat(l) + '</td>' :
          '<td>' + inp(l, 'date', 'date') + dateTag(r, l) + '</td><td>' + inp(l, 'no', '', '100px') + '</td><td>' + inp(l, 'party') + '</td><td>' + inp(l, 'trn', '', '130px') + '</td><td>' + (reg === 'sales' ? em(l) : inp(l, 'desc')) + '</td><td>' + cat(l) + '</td>') +
          '<td class="r">' + inp(l, 'net', 'number', '100px') + '</td><td class="r">' + inp(l, 'vat', 'number', '90px') + '</td>' + (reg === 'sales' || reg === 'adj' ? '' : '<td class="r">' + inp(l, 'rec', 'number', '60px') + '</td>') +
          '<td class="r"><span class="link" data-vd="del" data-v="' + l.id + '" title="Delete">✕</span></td></tr>';
      }).join('') || '<tr><td colspan="11" class="empty" style="padding:22px">No lines – import the client\'s register from Excel, paste rows, or add lines one by one.</td></tr>') +
      '</tbody>' + (L.length ? '<tfoot><tr><td colspan="' + (reg === 'adj' ? 4 : 6) + '">Total (' + L.length + ' lines)</td><td class="r mono">' + money(T.n) + '</td><td class="r mono">' + money(T.v) + '</td><td colspan="2"></td></tr></tfoot>' : '') + '</table></div>' +
      (reg === 'purchases' ? '<div class="cd-hint">Blocked = input VAT not recoverable (e.g. entertainment, private motor vehicles). Recover % below 100 applies partial recovery (apportionment).</div>' : '') +
      (reg === 'sales' ? '<div class="cd-hint">Standard-rated sales go to Box 1a–1g by emirate (blank = the client\'s main emirate: ' + esc((EMIRATES.find(function (e) { return e[0] === (client(r.clientId).emirate || 'DXB'); }) || [])[1]) + ').</div>' : '');
  }
  function docsHtml(r, c) {
    var d = r.docs || {};
    return '<div class="cd-grp">Documents from the client</div><div class="vd-docs">' + DOCS.map(function (x, i) { var got = d[i]; return '<label class="' + (got ? 'on' : '') + '"><input type="checkbox" data-vd-doc="' + i + '"' + (got ? ' checked' : '') + '> ' + esc(x) + (got ? ' <span class="sub2">received ' + fmtDate(got) + '</span>' : '') + '</label>'; }).join('') + '</div>' +
      '<div style="margin:8px 0 14px"><a class="btn btn-sm" href="' + cloudFolder(c.name) + '" target="_blank" rel="noopener">📁 Open the client\'s Google Drive folder</a> <span class="sub2">Keep this quarter\'s files under VAT / ' + esc(periodLabel(r)) + '.</span></div>' +
      '<div class="cd-grp">Client main emirate (for sales without an emirate)</div><select class="hd-in" data-vd-emirate style="height:30px">' + EMIRATES.map(function (e) { return '<option value="' + e[0] + '"' + ((c.emirate || 'DXB') === e[0] ? ' selected' : '') + '>' + e[1] + '</option>'; }).join('') + '</select>' +
      '<div class="cd-grp" style="margin-top:14px">Notes for the report</div><textarea class="cd-note" data-vd-notes placeholder="e.g. Sales register provided by the client; 3 purchase invoices without TRN excluded">' + esc(r.notes || '') + '</textarea>' +
      '<div class="cd-grp" style="margin-top:14px">Approval & filing</div><table class="tbl sm pf"><tbody>' +
      '<tr><td>Report sent to client</td><td>' + (r.sent ? fmtDate(r.sent) : '<span class="link" data-vd="mark" data-v="sent">mark sent today</span>') + '</td></tr>' +
      '<tr><td>Approved by client (signed & stamped)</td><td>' + (r.approved ? fmtDate(r.approved) : '<span class="link" data-vd="mark" data-v="approved">mark approved today</span>') + '</td></tr>' +
      '<tr><td>Filed on EmaraTax</td><td>' + (r.filed ? fmtDate(r.filed.date) + (r.filed.ref ? ' · ref ' + esc(r.filed.ref) : '') + (r.filed.amount !== '' && r.filed.amount != null ? ' · AED ' + money(r.filed.amount) : '') : '<span class="link" data-vd="file">mark filed</span>') + '</td></tr></tbody></table>';
  }

  /* ---------- our own VAT report on the letterhead (not the FTA box layout) ---------- */
  function report() {
    var r = CUR, c = client(r.clientId) || {}, b = biz(), B = calc(r, c), M = monthly(r), due = dueOf(r), K = checks(r), em = c.emirate || 'DXB';
    var L = r.lines || [], sum = function (f) { return r2(L.filter(f).reduce(function (s, l) { return s + (+l.net || 0); }, 0)); }, sumV = function (f) { return r2(L.filter(f).reduce(function (s, l) { return s + (+l.vat || 0); }, 0)); };
    var recOf = function (l) { return l.rec === '' || l.rec == null ? 100 : +l.rec; };
    var A = function (n) { return n < 0 ? '(' + money(-n) + ')' : money(n); };
    // figures in our own layout
    var srN = ['1a', '1b', '1c', '1d', '1e', '1f', '1g'].reduce(function (s, k) { return s + B[k].amt; }, 0), srV = ['1a', '1b', '1c', '1d', '1e', '1f', '1g'].reduce(function (s, k) { return s + B[k].vat + B[k].adj; }, 0);
    var zr = B['4'].amt, ex = B['5'].amt, tr = B['2'], rc = B['3'], im = {amt: B['6'].amt + B['7'].amt, vat: B['6'].vat + B['7'].vat};
    var sales = r2(srN + zr + ex), purchN = sum(function (l) { return l.reg === 'purchases'; }), impN = sum(function (l) { return l.reg === 'imports' || l.reg === 'rc'; });
    var inPur = r2(B['9'].vat + B['9'].adj), inImp = B['10'].vat;
    var blocked = r2(L.reduce(function (s, l) { var v = +l.vat || 0; if (l.reg === 'purchases' && l.cat === 'BL') return s + v; if ((l.reg === 'purchases' && l.cat === 'SR') || (l.reg === 'imports' && l.cat !== 'IB') || (l.reg === 'rc' && l.cat !== 'RB')) return s + v * (100 - recOf(l)) / 100; if ((l.reg === 'imports' && l.cat === 'IB') || (l.reg === 'rc' && l.cat === 'RB')) return s + v; return s; }, 0));
    var pay = B.n14 >= 0, netAbs = Math.abs(B.n14), per = periodLabel(r);
    var pct = function (a) { return sales ? Math.round(a / sales * 1000) / 10 + '%' : '—'; };
    var emRows = EMIRATES.map(function (e) { return {n: e[1], a: B[e[2]].amt, v: B[e[2]].vat + B[e[2]].adj}; }).filter(function (x) { return x.a || x.v; });
    var top = function (reg) {
      var g = {}; L.filter(function (l) { return reg.indexOf(l.reg) >= 0; }).forEach(function (l) { var k = (l.party || '(not named)').trim(); g[k] = g[k] || {n: k, a: 0, v: 0, c: 0}; g[k].a += +l.net || 0; g[k].v += +l.vat || 0; g[k].c++; });
      return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.a - a.a; }).slice(0, 5);
    };
    var topC = top(['sales']), topS = top(['purchases', 'imports', 'rc']);
    var narrative = esc(c.name || 'The company') + ' recorded sales of <b>AED ' + money(sales) + '</b> for ' + esc(per) +
      (sales ? ' – standard rated ' + pct(srN) + (zr ? ', zero rated ' + pct(zr) : '') + (ex ? ', exempt ' + pct(ex) : '') : '') + '. ' +
      'Output VAT is <b>AED ' + money(B.n12) + '</b> and recoverable input VAT on purchases' + (impN ? ', imports and services from abroad' : '') + ' is <b>AED ' + money(B.n13) + '</b>' + (blocked ? ' (AED ' + money(blocked) + ' of input VAT is not recoverable and has been left out)' : '') + '. ' +
      (pay ? 'The net VAT of <b>AED ' + money(netAbs) + '</b> is payable to the Federal Tax Authority by <b>' + fmtDate(due) + '</b>.' : 'The period shows a VAT refund position of <b>AED ' + money(netAbs) + '</b>, which can be carried forward or claimed from the Federal Tax Authority.');

    // monthly chart (inline SVG): output vs input VAT per month
    var MM = M.filter(function (m) { return m.key !== 'x'; }), mx = Math.max.apply(null, MM.map(function (m) { return Math.max(m.out, m.inp, 1); }).concat([1]));
    var W = 420, H = 150, gw = W / Math.max(MM.length, 1), bw = Math.min(34, gw / 3);
    var chart = '<svg viewBox="0 0 ' + W + ' ' + (H + 34) + '" width="100%" height="' + (H + 34) + '" style="max-width:' + W + 'px">' +
      [0.25, 0.5, 0.75, 1].map(function (f) { return '<line x1="0" x2="' + W + '" y1="' + (H - H * f) + '" y2="' + (H - H * f) + '" stroke="#e8edf2"/>'; }).join('') +
      MM.map(function (m, i) { var x = i * gw + gw / 2, ho = m.out / mx * (H - 14), hi = m.inp / mx * (H - 14);
        return '<rect x="' + (x - bw - 2) + '" y="' + (H - ho) + '" width="' + bw + '" height="' + ho + '" fill="#17324c" rx="2"/><rect x="' + (x + 2) + '" y="' + (H - hi) + '" width="' + bw + '" height="' + hi + '" fill="#c1922b" rx="2"/>' +
          '<text x="' + x + '" y="' + (H + 14) + '" text-anchor="middle" font-size="12" fill="#54687c" font-family="Arial">' + esc(m.label) + '</text>' +
          '<text x="' + x + '" y="' + (H + 28) + '" text-anchor="middle" font-size="11" fill="' + (m.net >= 0 ? '#a61b1b' : '#1f6b3a') + '" font-family="Arial">net ' + A(m.net) + '</text>'; }).join('') +
      '<line x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '" stroke="#9aa6b2"/></svg>' +
      '<div class="legend"><span><i style="background:#17324c"></i>Output VAT</span><span><i style="background:#c1922b"></i>Input VAT recoverable</span></div>';

    var reg = function (key, title) {
      var X = L.filter(function (l) { return l.reg === key; }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }); if (!X.length) return '';
      var T = X.reduce(function (t, l) { t.n += +l.net || 0; t.v += +l.vat || 0; return t; }, {n: 0, v: 0}), cn = function (l) { return ((CATS[key].find(function (x) { return x[0] === l.cat; }) || [])[1] || l.cat || '').replace(/ –.*$/, ''); };
      return '<section class="pb"><div class="sec"><span class="sn">' + title[0] + '</span>' + title[1] + '</div><table class="t reg"><thead><tr><th>#</th><th>Date</th><th>Invoice no.</th><th>' + (key === 'sales' ? 'Customer' : key === 'adj' ? 'Description' : 'Supplier') + '</th><th>TRN</th><th>' + (key === 'sales' ? 'Emirate / type' : 'Type') + '</th><th class="r">Net (AED)</th><th class="r">VAT (AED)</th><th class="r">Total (AED)</th></tr></thead><tbody>' +
        X.map(function (l, i) { var n = +l.net || 0, v = +l.vat || 0; return '<tr><td>' + (i + 1) + '</td><td>' + (l.date ? fmtDate(l.date) : '') + (outside(r, l) ? '*' : '') + '</td><td>' + esc(l.no || '') + '</td><td>' + esc(key === 'adj' ? l.desc || '' : l.party || '') + '</td><td>' + esc(l.trn || '') + '</td><td>' + esc(key === 'sales' && l.cat === 'SR' ? ((EMIRATES.find(function (e) { return e[0] === (l.emirate || em); }) || [])[1] || '') : cn(l)) + '</td><td class="r">' + A(n) + '</td><td class="r">' + A(v) + '</td><td class="r">' + A(n + v) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="6">Total · ' + X.length + ' entr' + (X.length === 1 ? 'y' : 'ies') + '</td><td class="r">' + A(T.n) + '</td><td class="r">' + A(T.v) + '</td><td class="r">' + A(T.n + T.v) + '</td></tr></tfoot></table>' +
        (X.some(function (l) { return outside(r, l); }) ? '<div class="fn">* Invoice dated in another tax period and declared in this return' + (key === 'sales' ? '' : ' (e.g. tax invoice received after that period)') + '.</div>' : '') + '</section>';
    };
    var lineRow = function (label, amt, vat, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td class="r">' + (amt === null ? '' : A(amt)) + '</td><td class="r">' + (vat === null ? '' : A(vat)) + '</td></tr>'; };
    var open = K.filter(function (k) { return k[0] === 'high'; }), lateN = L.filter(function (l) { return outside(r, l) && l.here; }).length;
    var points = [];
    if (r.notes) points.push(esc(r.notes));
    if (blocked) points.push('Input VAT of AED ' + money(blocked) + ' is not recoverable (blocked expenses such as entertainment, or partial recovery) and is excluded from the claim.');
    if (lateN) points.push(lateN + ' invoice' + (lateN > 1 ? 's' : '') + ' dated in another tax period ' + (lateN > 1 ? 'are' : 'is') + ' declared in this return (marked * in the registers).');
    open.slice(0, 8).forEach(function (k) { points.push(esc(k[1] + ' – ' + k[2])); });
    if (open.length > 8) points.push('…and ' + (open.length - 8) + ' more line(s) to be confirmed.');
    var docsGot = DOCS.filter(function (x, i) { return (r.docs || {})[i]; });

    var css = '@page{size:A4;margin:14mm 14mm 16mm;@bottom-left{content:"' + esc((c.name || '').replace(/"/g, '')) + ' · VAT report ' + esc(per) + '";font:7pt Arial;color:#9aa6b2}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:7pt Arial;color:#9aa6b2}}' +
      '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0}body{background:#e7ebf0;font:9.5pt/1.5 "Segoe UI",Arial,sans-serif;color:#26313d}' +
      '.toolbar{width:210mm;margin:14px auto 0;text-align:right}.toolbar button{background:#17324c;color:#fff;border:none;border-radius:8px;padding:9px 16px;font:600 10pt Arial;cursor:pointer}' +
      '.page{width:210mm;background:#fff;margin:14px auto;padding:14mm;box-shadow:0 6px 30px rgba(0,0,0,.14)}@media print{body{background:#fff}.page{width:auto;margin:0;padding:0;box-shadow:none}.toolbar{display:none}section.pb{page-break-before:always}.keep{page-break-inside:avoid}}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start}.lh-l{display:flex;gap:11px;align-items:center}.fx{font:800 15pt Arial;color:#1c3d5a;line-height:1}.intl{font:700 7.5pt Arial;color:#c1922b;letter-spacing:4px;margin-top:2px}' +
      '.co{font-size:7.8pt;color:#7b8794;text-align:right;line-height:1.5}.rule{margin:9px 0 0}.rule .n{height:2.5px;background:#17324c}.rule .g{height:2px;background:#c1922b;margin-top:2px}' +
      '.hero{margin:18px 0 12px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.hero .k{font:700 8pt Arial;letter-spacing:3px;color:#c1922b}.hero h1{font:800 24pt Arial;color:#17324c;margin:2px 0 0;letter-spacing:-.3px}.hero .p{font-size:10.5pt;color:#54687c;margin-top:2px}' +
      '.cl{min-width:240px;border:1px solid #e3e8ee;border-radius:8px;padding:9px 12px;font-size:8.6pt;line-height:1.6}.cl b{color:#17324c}.cl .nm{font:700 11pt Arial;color:#17324c;margin-bottom:2px}' +
      '.result{display:flex;justify-content:space-between;align-items:center;border-radius:10px;padding:14px 18px;margin:6px 0 14px;color:#fff}.result.pay{background:linear-gradient(90deg,#17324c,#244a6e)}.result.ref{background:linear-gradient(90deg,#1f6b3a,#2c8a50)}' +
      '.result .l{font:700 8pt Arial;letter-spacing:2px;opacity:.85}.result .v{font:800 22pt Arial;letter-spacing:-.5px}.result .d{text-align:right;font-size:9pt;opacity:.95}.result .d b{font-size:11pt;display:block}' +
      '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.kpi{border:1px solid #e3e8ee;border-top:3px solid #c1922b;border-radius:6px;padding:8px 10px}.kpi .l{font:700 7pt Arial;letter-spacing:1.2px;color:#7b8794;text-transform:uppercase}.kpi .v{font:700 13pt Arial;color:#17324c;margin-top:2px}.kpi .s{font-size:7.5pt;color:#7b8794}' +
      '.sec{font:700 11pt Arial;color:#17324c;margin:16px 0 7px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e3e8ee;padding-bottom:5px}.sn{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#17324c;color:#fff;font-size:8.5pt}' +
      '.lead{font-size:9.8pt;color:#33404d;margin:0 0 4px}' +
      'table.t{width:100%;border-collapse:collapse;font-size:8.6pt}table.t th{text-align:left;font:700 7.4pt Arial;letter-spacing:.6px;text-transform:uppercase;color:#54687c;border-bottom:1.5px solid #17324c;padding:5px 7px}table.t td{padding:5px 7px;border-bottom:1px solid #edf1f5}' +
      'table.t .r{text-align:right;font-variant-numeric:tabular-nums}table.t tr.h td{font:700 8pt Arial;color:#c1922b;letter-spacing:1px;text-transform:uppercase;border-bottom:none;padding-top:9px}table.t tr.st td{font-weight:700;border-top:1px solid #9aa6b2;background:#f7f9fb}' +
      'table.t tr.grand td{font:800 10.5pt Arial;color:#17324c;border-top:2px solid #17324c;border-bottom:3px double #17324c;background:#eef2f6}table.t tr.mut td{color:#8a96a3;font-style:italic}table.t tfoot td{font-weight:700;border-top:1.5px solid #17324c;background:#f7f9fb}' +
      'table.reg{font-size:7.8pt}table.reg td{padding:3px 6px}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.legend{display:flex;gap:16px;font-size:8pt;color:#54687c;margin-top:2px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}' +
      '.pts{margin:0;padding-left:16px;font-size:9pt;color:#33404d}.pts li{margin-bottom:3px}.fn{font-size:7.5pt;color:#7b8794;margin-top:4px}' +
      '.appr{border:1px solid #cfd6de;border-radius:8px;padding:12px 14px;margin-top:6px}.appr p{margin:0 0 10px;font-size:9pt}.sg{display:grid;grid-template-columns:1.3fr 1fr;gap:18px}.ln{border-bottom:1px solid #9aa6b2;height:24px;margin:2px 0 8px}.lb{font:700 7pt Arial;letter-spacing:1.2px;color:#7b8794;text-transform:uppercase}' +
      '.stamp{border:1.5px dashed #b8c2cc;border-radius:50%;width:120px;height:120px;display:flex;align-items:center;justify-content:center;color:#9aa6b2;font-size:8pt;margin:6px auto 0}.prep{font-size:8pt;color:#54687c;margin-top:10px;border-top:1px solid #edf1f5;padding-top:6px}';
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>VAT report – ' + esc(c.name) + ' – ' + esc(per) + '</title><style>' + css + '</style></head><body>' +
      '<div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div><div class="page">' +
      '<div class="top"><div class="lh-l">' + resolveLogo() + '<div><div class="fx">' + esc(b.name) + '</div><div class="intl">AUDIT · TAX · ADVISORY</div></div></div><div class="co"><b style="color:#17324c;font:700 9pt Arial">' + esc(b.name) + '</b><br>' + (b.licence ? 'Licence No. ' + esc(b.licence) + '<br>' : '') + (b.trn ? 'TRN ' + esc(b.trn) + '<br>' : '') + bizAddrBr() + '<br>' + esc(b.email) + ' · ' + esc(b.phone) + '</div></div>' +
      '<div class="rule"><div class="n"></div><div class="g"></div></div>' +
      // 1. cover
      '<div class="hero"><div><div class="k">VAT REPORT</div><h1>' + esc(per) + '</h1><div class="p">' + fmtDate(r.start) + ' to ' + fmtDate(r.end) + ' · prepared ' + fmtDate(ymd(new Date())) + '</div></div>' +
      '<div class="cl"><div class="nm">' + esc(c.name) + '</div>TRN <b>' + esc(c.trn && c.trn !== '-' ? c.trn : '—') + '</b><br>Trade licence <b>' + esc(c.tradeLicence || '—') + '</b>' + (c.address && c.address !== '-' ? '<br>' + esc(c.address) : '') + '</div></div>' +
      '<div class="result ' + (pay ? 'pay' : 'ref') + '"><div><div class="l">' + (pay ? 'NET VAT PAYABLE' : 'NET VAT REFUNDABLE') + '</div><div class="v">AED ' + money(netAbs) + '</div></div><div class="d">' + (pay ? 'Pay by<b>' + fmtDate(due) + '</b>' : 'Return due<b>' + fmtDate(due) + '</b>') + '</div></div>' +
      '<div class="kpis"><div class="kpi"><div class="l">Total sales</div><div class="v">' + money(sales) + '</div><div class="s">AED, excluding VAT</div></div><div class="kpi"><div class="l">Output VAT</div><div class="v">' + money(B.n12) + '</div><div class="s">on sales &amp; imports</div></div>' +
      '<div class="kpi"><div class="l">Input VAT recoverable</div><div class="v">' + money(B.n13) + '</div><div class="s">on purchases ' + money(r2(purchN + impN)) + '</div></div><div class="kpi"><div class="l">Effective VAT on sales</div><div class="v">' + (sales ? (Math.round(B.n14 / sales * 1000) / 10) + '%' : '—') + '</div><div class="s">net VAT ÷ sales</div></div></div>' +
      // 2. summary
      '<div class="sec"><span class="sn">1</span>Summary</div><p class="lead">' + narrative + '</p>' +
      // 3. computation
      '<div class="keep"><div class="sec"><span class="sn">2</span>VAT computation</div><table class="t"><thead><tr><th>Description</th><th class="r">Value (AED)</th><th class="r">VAT (AED)</th></tr></thead><tbody>' +
      '<tr class="h"><td colspan="3">Output tax – sales and other outputs</td></tr>' + lineRow('Standard rated sales (5%)', srN, srV) + (zr ? lineRow('Zero rated sales (exports, international services)', zr, 0) : '') + (ex ? lineRow('Exempt sales', ex, 0) : '') +
      (tr.amt || tr.vat ? lineRow('Tax refunds to tourists', tr.amt, tr.vat) : '') + (rc.amt || rc.vat ? lineRow('Services received from abroad (reverse charge)', rc.amt, rc.vat) : '') + (im.amt || im.vat ? lineRow('Goods imported through customs', im.amt, im.vat) : '') +
      '<tr class="st"><td>Total output VAT</td><td class="r"></td><td class="r">' + A(B.n12) + '</td></tr>' +
      '<tr class="h"><td colspan="3">Input tax – purchases and expenses</td></tr>' + lineRow('Purchases and expenses – VAT recoverable', B['9'].amt, inPur) + (inImp || B['10'].amt ? lineRow('Imports and reverse charge – VAT recoverable', B['10'].amt, inImp) : '') +
      (blocked ? lineRow('Input VAT not recoverable (excluded)', null, blocked, 'mut') : '') + '<tr class="st"><td>Total input VAT recoverable</td><td class="r"></td><td class="r">(' + money(B.n13) + ')</td></tr>' +
      '<tr class="grand"><td>' + (pay ? 'Net VAT payable' : 'Net VAT refundable') + '</td><td class="r"></td><td class="r">' + money(netAbs) + '</td></tr></tbody></table></div>' +
      // 4. monthly
      '<div class="keep"><div class="sec"><span class="sn">3</span>Month by month</div><div class="two" style="grid-template-columns:1.1fr 1fr;align-items:start"><table class="t"><thead><tr><th>Month</th><th class="r">Sales</th><th class="r">Output VAT</th><th class="r">Input VAT</th><th class="r">Net VAT</th></tr></thead><tbody>' +
      M.map(function (m) { return '<tr><td>' + esc(m.key === 'x' ? 'Other periods *' : m.label) + '</td><td class="r">' + A(m.sales) + '</td><td class="r">' + A(m.out) + '</td><td class="r">' + A(m.inp) + '</td><td class="r">' + A(m.net) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="r">' + A(M.reduce(function (s, m) { return s + m.sales; }, 0)) + '</td><td class="r">' + A(M.reduce(function (s, m) { return s + m.out; }, 0)) + '</td><td class="r">' + A(M.reduce(function (s, m) { return s + m.inp; }, 0)) + '</td><td class="r">' + A(M.reduce(function (s, m) { return s + m.net; }, 0)) + '</td></tr></tfoot></table><div>' + chart + '</div></div></div>' +
      // 5. sales mix + emirates
      '<div class="keep"><div class="sec"><span class="sn">4</span>Sales analysis</div><div class="two"><table class="t"><thead><tr><th>Type of sale</th><th class="r">Value (AED)</th><th class="r">Share</th></tr></thead><tbody>' +
      '<tr><td>Standard rated (5%)</td><td class="r">' + A(srN) + '</td><td class="r">' + pct(srN) + '</td></tr><tr><td>Zero rated</td><td class="r">' + A(zr) + '</td><td class="r">' + pct(zr) + '</td></tr><tr><td>Exempt</td><td class="r">' + A(ex) + '</td><td class="r">' + pct(ex) + '</td></tr></tbody><tfoot><tr><td>Total sales</td><td class="r">' + A(sales) + '</td><td class="r">' + (sales ? '100%' : '—') + '</td></tr></tfoot></table>' +
      '<table class="t"><thead><tr><th>Standard rated sales by emirate</th><th class="r">Value (AED)</th><th class="r">VAT (AED)</th></tr></thead><tbody>' + (emRows.map(function (x) { return '<tr><td>' + x.n + '</td><td class="r">' + A(x.a) + '</td><td class="r">' + A(x.v) + '</td></tr>'; }).join('') || '<tr><td colspan="3" style="color:#8a96a3">No standard rated sales</td></tr>') + '</tbody></table></div></div>' +
      // 6. top customers and suppliers
      (topC.length || topS.length ? '<div class="keep"><div class="sec"><span class="sn">5</span>Main customers and suppliers</div><div class="two">' +
        '<table class="t"><thead><tr><th>Top customers</th><th class="r">Sales (AED)</th><th class="r">VAT</th></tr></thead><tbody>' + (topC.map(function (x) { return '<tr><td>' + esc(x.n) + ' <span style="color:#9aa6b2">· ' + x.c + '</span></td><td class="r">' + A(x.a) + '</td><td class="r">' + A(x.v) + '</td></tr>'; }).join('') || '<tr><td colspan="3" style="color:#8a96a3">—</td></tr>') + '</tbody></table>' +
        '<table class="t"><thead><tr><th>Top suppliers</th><th class="r">Purchases (AED)</th><th class="r">VAT</th></tr></thead><tbody>' + (topS.map(function (x) { return '<tr><td>' + esc(x.n) + ' <span style="color:#9aa6b2">· ' + x.c + '</span></td><td class="r">' + A(x.a) + '</td><td class="r">' + A(x.v) + '</td></tr>'; }).join('') || '<tr><td colspan="3" style="color:#8a96a3">—</td></tr>') + '</tbody></table></div></div>' : '') +
      // 7. points for attention
      '<div class="keep"><div class="sec"><span class="sn">' + (topC.length || topS.length ? 6 : 5) + '</span>Points for your attention</div>' + (points.length ? '<ul class="pts">' + points.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' : '<p class="lead">No open points – the records provided are complete for this period.</p>') +
      (docsGot.length ? '<div class="fn" style="margin-top:6px">Records reviewed: ' + esc(docsGot.join(', ')) + '.</div>' : '') + '</div>' +
      // 8. approval
      '<div class="keep"><div class="sec"><span class="sn">' + (topC.length || topS.length ? 7 : 6) + '</span>Client approval</div><div class="appr"><p>We have reviewed this VAT report and the attached registers. We confirm that all sales, purchases and imports of ' + esc(c.name) + ' for ' + esc(per) + ' are included and correct, and we authorise ' + esc(b.name) + ' to file the VAT return on our behalf' + (pay ? '. We will pay AED ' + money(netAbs) + ' to the Federal Tax Authority by ' + fmtDate(due) : '') + '.</p>' +
      '<div class="sg"><div><div class="lb">Name</div><div class="ln"></div><div class="lb">Designation</div><div class="ln"></div><div class="lb">Signature</div><div class="ln"></div><div class="lb">Date</div><div class="ln"></div></div><div><div class="lb" style="text-align:center">Company stamp</div><div class="stamp">Stamp here</div></div></div>' +
      '<div class="prep">Prepared by ' + esc(r.updatedBy || meName()) + ', ' + esc(b.name) + ', from the records provided by the client.</div></div></div>' +
      // appendices
      reg('sales', ['A', 'Appendix A – Sales register']) + reg('purchases', ['B', 'Appendix B – Purchases and expenses register']) + reg('imports', ['C', 'Appendix C – Imports register']) + reg('rc', ['D', 'Appendix D – Services from abroad (reverse charge)']) + reg('adj', ['E', 'Appendix E – Adjustments']) +
      '</div></body></html>';
    var w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the report'); return; } w.document.write(html); w.document.close();
  }

  /* ---------- Excel / paste import ---------- */
  var IMP = null;
  var FIELDS = [['date', 'Date', /date|dt\b/i], ['no', 'Invoice no.', /inv|bill|voucher|doc.*no|ref|^no\.?$|number/i], ['party', 'Customer / supplier', /customer|supplier|vendor|party|client|name|ledger|particular/i],
    ['trn', 'TRN', /trn|tax.?reg|vat.?(no|reg)/i], ['desc', 'Description', /desc|narration|item|detail|remark/i], ['emirate', 'Emirate', /emirate|place.?of.?supply|city|location/i],
    ['net', 'Net amount', /net|taxable|excl|before.?vat|value|amount$/i], ['vat', 'VAT amount', /^vat$|vat.?amount|tax.?amount|output.?tax|input.?tax|^tax$/i], ['total', 'Total incl. VAT', /total|gross|incl|grand/i], ['cat', 'VAT rate / code', /rate|code|category|tax.?type|vat.?%/i]];
  function loadXlsx() { return window.XLSX ? Promise.resolve() : new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = function () { bad(new Error('Could not load the Excel reader – check the internet connection')); }; document.head.appendChild(s); }); }
  function importModal(reg) {
    IMP = {reg: reg || (REGS.find(function (x) { return x[0] === TAB; }) ? TAB : 'sales'), rows: null};
    modal('<div class="modal wide"><div class="modal-head"><h3>Import into the registers</h3><button class="x" data-act="close">×</button></div>' +
      '<div class="two-col"><div class="field"><label>Register</label><select id="vi_reg">' + REGS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === IMP.reg ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>Excel or CSV file</label><input type="file" id="vi_file" accept=".xlsx,.xls,.csv"></div></div>' +
      '<div class="field"><label>…or paste rows copied from Excel (with the heading row)</label><textarea id="vi_paste" rows="3" placeholder="Date	Invoice No	Customer	TRN	Net	VAT"></textarea></div>' +
      '<button class="btn" data-vd="imp-read">Read</button><div id="vi_map" style="margin-top:12px"></div></div>');
  }
  async function impRead() {
    IMP.reg = $('#vi_reg').value;
    var f = $('#vi_file').files && $('#vi_file').files[0], txt = $('#vi_paste').value, aoa = null;
    try {
      if (f) { await loadXlsx(); var wb = XLSX.read(await f.arrayBuffer(), {type: 'array', cellDates: true}); IMP.wb = wb; IMP.sheet = wb.SheetNames[0]; aoa = XLSX.utils.sheet_to_json(wb.Sheets[IMP.sheet], {header: 1, raw: true, defval: ''}); }
      else if (txt.trim()) { aoa = txt.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return l.split('\t'); }); IMP.wb = null; }
      else { toast('Choose a file or paste rows'); return; }
    } catch (e) { toast(e.message || 'Could not read the file'); return; }
    IMP.aoa = aoa; IMP.hrForced = null; impMap();
  }
  function impMap() {
    var aoa = IMP.aoa, hr = IMP.hrForced != null ? IMP.hrForced : 0;
    if (IMP.hrForced == null) for (var i = 0; i < Math.min(aoa.length, 25); i++) { var txt = aoa[i].filter(function (v) { return typeof v === 'string' && v.trim() && isNaN(+v); }).length; if (txt >= 3) { hr = i; break; } }
    IMP.hr = hr; var H = (aoa[hr] || []).map(function (h) { return String(h).trim(); });
    var c = client(CUR.clientId), saved = ((c.vatMap || {})[IMP.reg]) || {}, used = {};
    var guess = FIELDS.map(function (f) {
      var col = saved[f[0]] != null ? H.indexOf(saved[f[0]]) : -1;
      if (col < 0) col = H.findIndex(function (h, j) { return !used[j] && f[2].test(h); });
      if (col >= 0) used[col] = 1; return col;
    });
    var opts = function (sel) { return '<option value="-1">— not in the file —</option>' + H.map(function (h, j) { return '<option value="' + j + '"' + (j === sel ? ' selected' : '') + '>' + esc(h || 'Column ' + (j + 1)) + '</option>'; }).join(''); };
    var sample = aoa.slice(hr + 1, hr + 4);
    $('#vi_map').innerHTML = (IMP.wb && IMP.wb.SheetNames.length > 1 ? '<div class="field"><label>Sheet</label><select id="vi_sheet">' + IMP.wb.SheetNames.map(function (s) { return '<option' + (s === IMP.sheet ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="field"><label>Heading row</label><input type="number" id="vi_hr" min="1" value="' + (hr + 1) + '" style="width:90px"> <span class="sub2">' + (aoa.length - hr - 1) + ' rows below it</span></div>' +
      '<div class="cd-grp">Match the columns</div><div class="vi-grid">' + FIELDS.map(function (f, k) { return '<label>' + f[1] + '<select data-vi-col="' + f[0] + '">' + opts(guess[k]) + '</select></label>'; }).join('') + '</div>' +
      '<div class="two-col" style="margin-top:8px"><div class="field"><label>Default VAT category</label><select id="vi_cat">' + CATS[IMP.reg].map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>If only the total is given</label><select id="vi_incl"><option value="1">Total includes 5% VAT – split it</option><option value="0">Total has no VAT</option></select></div></div>' +
      (sample.length ? '<div class="sub2" style="margin-bottom:8px">First rows: ' + sample.map(function (r) { return esc(r.slice(0, 6).map(function (v) { return v instanceof Date ? ymd(v) : v; }).join(' | ')); }).join('<br>') + '</div>' : '') +
      '<button class="btn btn-primary" style="width:100%" data-vd="imp-go">Import rows</button>';
    var sh = $('#vi_sheet'); if (sh) sh.onchange = function () { IMP.sheet = sh.value; IMP.hrForced = null; IMP.aoa = XLSX.utils.sheet_to_json(IMP.wb.Sheets[IMP.sheet], {header: 1, raw: true, defval: ''}); impMap(); };
    var hi = $('#vi_hr'); hi.onchange = function () { IMP.hrForced = Math.min(aoa.length - 1, Math.max(1, +hi.value || 1) - 1); impMap(); };
  }
  function toNum(v) { if (typeof v === 'number') return v; var s = String(v || '').replace(/[^\d.\-()]/g, ''); if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1); var n = parseFloat(s); return isNaN(n) ? 0 : n; }
  function toDate(v) {
    if (v instanceof Date && !isNaN(v)) return ymd(new Date(v.getFullYear(), v.getMonth(), v.getDate() + (v.getHours() >= 12 ? 1 : 0)));
    if (typeof v === 'number' && v > 20000 && v < 80000) return ymd(new Date(Math.round((v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4));
    var s = String(v || '').trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{2,4})$/))) { var mi = MON3.findIndex(function (x) { return x.toLowerCase() === m[2].toLowerCase(); }); if (mi >= 0) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    return '';
  }
  function toEmirate(v) { var s = String(v || '').toLowerCase(); if (!s) return ''; if (/abu|auh/.test(s)) return 'AUH'; if (/dubai|dxb/.test(s)) return 'DXB'; if (/sharjah|shj/.test(s)) return 'SHJ'; if (/ajman|ajm/.test(s)) return 'AJM'; if (/umm|uaq/.test(s)) return 'UAQ'; if (/ras|rak/.test(s)) return 'RAK'; if (/fuj/.test(s)) return 'FUJ'; return ''; }
  function toCat(v, vat, reg, dflt, hasVat) {
    var s = String(v || '').toLowerCase();
    if (reg === 'sales' && !s && hasVat && !vat && dflt === 'SR') return 'ZR';   // no VAT on the line: most likely zero rated (export) – the checks ask to confirm
    if (reg === 'sales') { if (/zero|zr|^0%?$/.test(s)) return 'ZR'; if (/exempt|ex\b/.test(s)) return 'EX'; if (/out of scope|os\b/.test(s)) return 'OS'; if (/5|standard|sr/.test(s)) return 'SR'; return dflt; }
    if (reg === 'purchases') { if (/block|non.?recover/.test(s)) return 'BL'; if (vat) return dflt === 'NV' ? 'SR' : dflt; return /5|standard|sr/.test(s) ? 'SR' : 'NV'; }
    return dflt;
  }
  function impGo() {
    var col = {}; document.querySelectorAll('[data-vi-col]').forEach(function (s) { col[s.getAttribute('data-vi-col')] = +s.value; });
    var aoa = IMP.aoa, H = (aoa[IMP.hr] || []).map(function (h) { return String(h).trim(); }), dflt = $('#vi_cat').value, incl = $('#vi_incl').value === '1', reg = IMP.reg, added = 0, skipped = 0;
    var get = function (row, f) { return col[f] >= 0 ? row[col[f]] : ''; };
    aoa.slice(IMP.hr + 1).forEach(function (row) {
      var net = toNum(get(row, 'net')), vat = toNum(get(row, 'vat')), tot = toNum(get(row, 'total')), date = toDate(get(row, 'date')), no = String(get(row, 'no') || '').trim(), party = String(get(row, 'party') || '').trim();
      if (!net && !vat && !tot) { skipped++; return; }
      if (!date && !no && /total/i.test(row.join(' '))) { skipped++; return; }   // the file's own total row
      if (!net && tot) { if (vat) net = r2(tot - vat); else if (incl && dflt !== 'ZR' && dflt !== 'EX' && dflt !== 'NV') { net = r2(tot / 1.05); vat = r2(tot - net); } else net = tot; }
      var cat = toCat(get(row, 'cat'), vat, reg, dflt, col.vat >= 0);
      if (!vat && col.vat < 0 && (cat === 'SR' || cat === 'IM' || cat === 'RC') && !tot) vat = r2(net * 0.05);
      CUR.lines.push({id: uid('vl'), reg: reg, date: date, no: no, party: party, trn: String(get(row, 'trn') || '').replace(/\s/g, ''), desc: String(get(row, 'desc') || '').trim(), emirate: reg === 'sales' ? toEmirate(get(row, 'emirate')) : '', cat: cat, net: r2(net), vat: r2(vat), rec: '', src: 'import'});
      added++;
    });
    // remember the mapping for this client and register
    var db = load(), c = db.clients.find(function (x) { return x.id === CUR.clientId; }); if (c) { c.vatMap = c.vatMap || {}; var m = {}; Object.keys(col).forEach(function (k) { if (col[k] >= 0) m[k] = H[col[k]]; }); c.vatMap[reg] = m; save(); }
    saveReturn(CUR, true); closeModal(); TAB = reg; draw();
    toast(added + ' line' + (added !== 1 ? 's' : '') + ' imported' + (skipped ? ' · ' + skipped + ' empty / total rows skipped' : ''));
  }

  async function moveLine(id) {
    var l = lineById(id), c = client(CUR.clientId); if (!l || !c) return;
    var p = periodFor(c, l.date); if (!p) { toast('Set the client\'s VAT periods first'); return; }
    if (p === CUR.period) { toast('This line already belongs to this period'); return; }
    var target = await openReturn(CUR.clientId, p), ln = Object.assign({}, l); delete ln.here;
    target.lines.push(ln); saveReturn(target, true);
    CUR.lines = CUR.lines.filter(function (x) { return x.id !== id; }); saveReturn(CUR, true); draw();
    toast('Moved to the ' + periodLabel(target) + ' return');
  }
  /* ---------- clicks & edits ---------- */
  function lineById(id) { return CUR && CUR.lines.find(function (l) { return l.id === id; }); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-vd]'); if (!b) return;
    e.preventDefault(); var a = b.getAttribute('data-vd'), v = b.getAttribute('data-v');
    switch (a) {
      case 'list-filter': LIST_FILTER = v; renderList(); break;
      case 'tab': TAB = v; FILTER = ''; draw(); break;
      case 'add': { var ln = {id: uid('vl'), reg: v, date: CUR.end, no: '', party: '', trn: '', desc: '', emirate: '', cat: CATS[v][0][0], net: '', vat: '', rec: '', src: 'manual'}; CUR.lines.push(ln); saveReturn(CUR, true); FILTER = ''; draw(); var row = document.getElementById('vl-' + ln.id); if (row) { row.scrollIntoView({block: 'center'}); var i = row.querySelector('input'); if (i) i.focus(); } break; }
      case 'del': CUR.lines = CUR.lines.filter(function (l) { return l.id !== v; }); saveReturn(CUR, true); draw(); break;
      case 'clear': if (confirm('Delete all lines in this register?')) { CUR.lines = CUR.lines.filter(function (l) { return l.reg !== v; }); saveReturn(CUR); draw(); } break;
      case 'goto-line': { var l = lineById(v); if (l) { TAB = l.reg; draw(); var rw = document.getElementById('vl-' + v); if (rw) { rw.scrollIntoView({block: 'center'}); rw.classList.add('late'); } } break; }
      case 'here': { var lh = lineById(v); if (!lh) break; modal('<div class="modal"><div class="modal-head"><h3>Declare in this period</h3><button class="x" data-act="close">×</button></div><p class="sub2" style="margin-top:0">' + esc((lh.no || lh.party || 'Line') + ' is dated ' + fmtDate(lh.date) + '.') + '</p><div class="field"><label>Reason (shown on the report)</label><select id="vh_why"><option>' + (lh.reg === 'sales' ? 'Tax point (payment / delivery) in this period' : 'Tax invoice received in this period') + '</option><option>Missed in the earlier return (below AED 10,000 net error – corrected here)</option><option>Credit / debit note issued in this period</option><option>Other</option></select></div><button class="btn btn-primary" style="width:100%" data-vd="here-save" data-v="' + lh.id + '">Declare here</button></div>'); break; }
      case 'here-save': { var lw = lineById(v); if (lw) { lw.here = $('#vh_why').value; saveReturn(CUR, true); } closeModal(); draw(); break; }
      case 'unhere': { var lu = lineById(v); if (lu) { delete lu.here; saveReturn(CUR, true); draw(); } break; }
      case 'move': moveLine(v); break;
      case 'import': importModal(v); break;
      case 'imp-read': impRead(); break;
      case 'imp-go': impGo(); break;
      case 'report': report(); if (CUR.status === 'In progress' || CUR.status === 'Not started') { CUR.status = 'Ready for review'; saveReturn(CUR, true); draw(); } break;
      case 'mark': CUR[v] = ymd(new Date()); if (v === 'sent' && STATUSES.indexOf(CUR.status) < 3) CUR.status = 'Sent to client'; if (v === 'approved' && STATUSES.indexOf(CUR.status) < 4) CUR.status = 'Approved by client'; saveReturn(CUR); draw(); break;
      case 'file': {
        var B = calc(CUR, client(CUR.clientId) || {});
        modal('<div class="modal"><div class="modal-head"><h3>VAT return filed — ' + esc(periodLabel(CUR)) + '</h3><button class="x" data-act="close">×</button></div>' +
          '<div class="two-col"><div class="field"><label>Filed on</label><input type="date" id="vf_date" value="' + ymd(new Date()) + '"></div><div class="field"><label>FTA reference no.</label><input id="vf_ref" placeholder="e.g. 230011801439"></div></div>' +
          '<div class="field"><label>VAT payable / (refundable) AED</label><input type="number" step="any" id="vf_amt" value="' + B.n14 + '"></div>' +
          '<button class="btn btn-primary" style="width:100%" data-vd="file-save">Save</button></div>'); break;
      }
      case 'file-save': {
        var d = $('#vf_date').value || ymd(new Date()), ref = $('#vf_ref').value.trim(), am = $('#vf_amt').value;
        CUR.filed = {date: d, ref: ref, amount: am === '' ? '' : +am}; CUR.status = 'Filed'; saveReturn(CUR, true);
        var db = load(), c = db.clients.find(function (x) { return x.id === CUR.clientId; }); if (c) { cdFiled(db, c, 'vat', CUR.period, d, ref, am === '' ? '' : +am); save(); }
        closeModal(); toast('Filed – the client\'s VAT Filing panel is updated'); draw(); break;
      }
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-vl')) {
      var p = t.getAttribute('data-vl').split('.'), l = lineById(p[0]); if (!l) return;
      var f = p[1], val = t.type === 'number' ? (t.value === '' ? '' : +t.value) : t.value.trim();
      l[f] = val;
      if (f === 'net' && (l.cat === 'SR' || l.cat === 'IM' || l.cat === 'RC') && (l.vat === '' || l.vat == null)) l.vat = r2(+val * 0.05);
      saveReturn(CUR, true);
      if (t.tagName === 'SELECT' || f === 'net' || f === 'vat') { var y = window.scrollY; draw(); window.scrollTo(0, y); }
      return;
    }
    if (t.hasAttribute('data-vd-ov')) { var q = t.getAttribute('data-vd-ov').split('.'); CUR.ov = CUR.ov || {}; CUR.ov[q[0]] = CUR.ov[q[0]] || {}; CUR.ov[q[0]][q[1]] = t.value === '' ? '' : +t.value; saveReturn(CUR); var y2 = window.scrollY; draw(); window.scrollTo(0, y2); return; }
    if (t.hasAttribute('data-vd-status')) { CUR.status = t.value; saveReturn(CUR); draw(); return; }
    if (t.hasAttribute('data-vd-doc')) { CUR.docs = CUR.docs || {}; if (t.checked) CUR.docs[t.getAttribute('data-vd-doc')] = ymd(new Date()); else delete CUR.docs[t.getAttribute('data-vd-doc')]; saveReturn(CUR, true); draw(); return; }
    if (t.hasAttribute('data-vd-notes')) { CUR.notes = t.value; saveReturn(CUR); return; }
    if (t.hasAttribute('data-vd-emirate')) { var db = load(), c = db.clients.find(function (x) { return x.id === CUR.clientId; }); if (c) { c.emirate = t.value; save(); } saveReturn(CUR); draw(); return; }
  });
  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-vd-filter')) { FILTER = e.target.value; var pos = e.target.selectionStart; draw(); var i = document.querySelector('[data-vd-filter]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} } }
  });

  window.VATDESK = {
    route: function (h) { if (h[1] && h[2]) renderReturn(h[1], h[2]); else renderList(); },
    search: function (q) { LIST_SEARCH = q; renderList(); },
    calc: calc, checks: checks
  };
  if (/^#\/vat/.test(location.hash) && typeof route === 'function') route();
})();
