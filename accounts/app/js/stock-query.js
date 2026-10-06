/* ===================== Qty in hand + Stock query (every form with an Item column) =====================
   - "In hand: 25.00" under the Item control of each line whose item is an inventory item, on the
     native Sales Invoice (js/txn-forms.js) and on every Form Designer document (Sales Quotes / Orders /
     Invoices, Delivery Notes, Credit Notes, Purchase Quotes / Orders / Invoices, Debit Notes, Goods
     Receipts, Inventory Transfers, Inventory Write-offs). Qty in hand is what the saved documents hold
     on the form's date at the form's location, the document being edited left out — worked out by
     js/pending-stock.js (PendingStock.available, on top of accounting.js invItemMovements, the same
     movements js/ledger-engine.js posts), never recomputed here. It turns red on a document that
     takes stock out ("In hand: 3.00 — short by 2.00"); that is a warning only, the pending-purchase
     popup of js/pending-stock.js stays the flow that acts on a shortage.
   - a "Stock query" button at the end of such a line (before ↑ ↓ ⧉ ×) opens one shared modal:
     summary (opening, purchased, sold, in hand, average cost), From / To and search, Purchases
     (purchase invoice lines) beside Sales (sales invoice lines), each with totals; a reference opens
     that invoice in a panel above the modal, which stays open. Print / Copy / Close.
   Screen only: nothing is stored, nothing is added to printed documents.

     StockQuery.getItemStock(b, itemIdOrName, asOfDate, opts{location, excl:{key,id}})
        -> {item, name, code, inHand, total} | null (not an inventory item)
     StockQuery.lineStock(b, key, doc{id, date, location, fromLocation, customer, copiedFrom, lines:[{item, qty}]})
        -> [{i, item, inHand, short} | null]
     StockQuery.queryData(b, itemIdOrName, {from, to}) -> {item, summary, purchases, sales}
     StockQuery.open(itemIdOrName, opts)  — the modal
   ===================================================================================================== */
(function (global) {
  'use strict';
  if (typeof App === 'undefined' || App.__stockQuery) return;
  App.__stockQuery = 1;
  var G = global;

  /* ------------------------------------------------------------------ helpers */
  function hasDom() { var d = G.document; return !!(d && d.body && d.body.nodeType === 1 && typeof d.createElement === 'function'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function r6(v) { return Math.round((Number(v) || 0) * 1e6) / 1e6; }
  function day(v) { return String(v || '').slice(0, 10); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtD(v) { if (!v) return ''; try { return App.fmtDate(v); } catch (e) { return String(v); } }
  function money(v) { try { return App.money(v); } catch (e) { return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2); } }
  function curB() { try { return App.openBiz != null ? App.curBiz() : null; } catch (e) { return null; } }
  function recs(b, k) { return ((b && b.records) || {})[k] || []; }
  function byId(id) { var d = G.document; return d && d.getElementById ? d.getElementById(id) : null; }
  function lnItem(ln) { return ln ? (ln.item || ln.items || '') : ''; }
  function wrap(name, fn) { var orig = App[name]; if (typeof orig !== 'function') return; App[name] = function () { return fn.call(this, orig, arguments); }; }
  function PS() { return G.PendingStock || null; }

  /* documents with an Item column */
  var FORM_KEYS = { salesQuotes: 1, salesOrders: 1, salesInv: 1, deliveryNotes: 1, creditNotes: 1, purchQuotes: 1, purchOrders: 1, purchInv: 1,
    debitNotes: 1, goodsRec: 1, invTransfers: 1, invWriteOffs: 1 };
  /* documents that take the goods out: a line asking for more than is in hand turns red */
  var OUT_KEYS = { salesQuotes: 1, salesOrders: 1, salesInv: 1, deliveryNotes: 1, debitNotes: 1, invTransfers: 1, invWriteOffs: 1 };
  /* the ones js/pending-stock.js tracks (its shortage rules: delivery notes covered by an invoice, ...) */
  var PS_KEYS = { salesInv: 1, deliveryNotes: 1, invWriteOffs: 1, invTransfers: 1 };
  var DOC = { purchInv: 'Purchase Invoice', salesInv: 'Sales Invoice' };

  /* ------------------------------------------------------------------ stock numbers */
  /** inventory item by id, uuid, name or code */
  function itemRec(b, x) { if (x == null || x === '') return null; if (typeof x === 'object') return x && x.name ? itemRec(b, x.name) : null;
    var L = recs(b, 'inventory'), s = String(x);
    return L.filter(function (r) { return r && r.name === s; })[0] ||
      L.filter(function (r) { return r && (String(r.id) === s || (r.uuid && String(r.uuid) === s)); })[0] ||
      L.filter(function (r) { return r && !blank(r.code) && String(r.code) === s; })[0] || null; }
  function movements(b, it) { try { return invItemMovements(b, it); } catch (e) { return { rows: [], avgCost: 0 }; } }
  /** whole-business quantity on `date` (inclusive; blank = all time), document `excl` left out */
  function totalAt(b, it, date, excl) { var q = 0;
    (movements(b, it).rows || []).forEach(function (r) {
      if (r.opening) { q += num(r.qin); return; }
      if (date && day(r.date) && day(r.date) > date) return;
      if (excl && excl.key === r.src && excl.id != null && String(excl.id) === String(r.id)) return;
      q += num(r.qin) - num(r.qout); });
    return r6(q); }
  /**
   * Qty in hand of an inventory item on a date. opts {location, excl:{key,id}}.
   * inHand is at the location (blank = Main location, like js/pending-stock.js), total is the whole business.
   */
  function getItemStock(b, item, asOfDate, opts) { opts = opts || {}; var it = itemRec(b, item); if (!b || !it) return null;
    var date = day(asOfDate), excl = opts.excl && opts.excl.id != null ? opts.excl : null, P = PS();
    var total = totalAt(b, it, date, excl);
    var inHand = P && P.available ? r6(P.available(b, it.name, { date: date, location: opts.location || '', excl: excl })) : total;
    return { item: it, name: it.name, code: it.code || '', inHand: inHand, total: total }; }

  /**
   * In hand + shortage for each line of a document being entered.
   * key = the document type; lines without an inventory item give null.
   */
  function lineStock(b, key, doc) { doc = doc || {}; var lines = doc.lines || [], out = [];
    if (!b) return lines.map(function () { return null; });
    var excl = doc.id != null ? { key: key, id: doc.id } : null;
    var loc = key === 'invTransfers' ? (doc.fromLocation || '') : (doc.location || '');
    var have = {}, used = {}, P = PS(), psShort = null;
    if (PS_KEYS[key] && P && P.shortages) { psShort = {};
      try { P.shortages(b, key, { id: doc.id, date: doc.date, location: doc.location || '', fromLocation: doc.fromLocation || '', customer: doc.customer, copiedFrom: doc.copiedFrom || null,
        lines: lines.map(function (l) { return { item: l.item, qty: num(l.qty) }; }) }).forEach(function (s) { psShort[s.i] = s.short; }); } catch (e) {} }
    lines.forEach(function (l, i) { var name = l && l.item; if (blank(name) || !itemRec(b, name)) { out.push(null); return; }
      if (!(name in have)) { var s = getItemStock(b, name, doc.date, { location: loc, excl: excl }); have[name] = s ? s.inHand : 0; used[name] = 0; }
      var q = num(l.qty), short = 0;
      if (OUT_KEYS[key]) {
        if (psShort) short = psShort[i] || 0;
        else if (q > 0) { var before = used[name]; used[name] = r6(before + q); short = r6(Math.min(q, used[name] - Math.max(0, have[name]))); if (short < 1e-9) short = 0; }
      }
      out.push({ i: i, item: name, inHand: have[name], short: r6(short) }); });
    return out; }

  /** amount of a line before tax, the way invItemMovements values a purchase */
  function lineNet(ln) { var q = num(ln.qty);
    if (ln.net != null && ln.net !== '') return num(ln.net);
    if (ln.amountNoTax != null && ln.amountNoTax !== '') return num(ln.amountNoTax);
    return q * num(ln.price); }
  function docRows(b, key, name, party, from, to) { var out = [];
    recs(b, key).forEach(function (d) { if (!d) return; var dt = day(d.issueDate || d.date);
      if (from && dt && dt < from) return; if (to && dt && dt > to) return;
      (d.lines || []).forEach(function (ln, k) { if (!ln || lnItem(ln) !== name) return; var q = num(ln.qty); if (!q) return;
        var amt = lineNet(ln);
        out.push({ key: key, id: d.id, date: dt, ref: d.reference || '', party: d[party] || d[party === 'customer' ? 'custName' : 'supName'] || '', line: k + 1,
          qty: r6(q), price: !blank(ln.price) ? num(ln.price) : (q ? amt / q : 0), amount: Math.round(amt * 100) / 100 }); }); });
    out.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)) || String(x.ref).localeCompare(String(y.ref), undefined, { numeric: true }) || x.line - y.line; });
    return out; }
  function totalsOf(rows) { var q = 0, a = 0; rows.forEach(function (r) { q += r.qty; a += r.amount; }); q = r6(q); a = Math.round(a * 100) / 100;
    return { qty: q, amount: a, avg: q ? a / q : 0, count: rows.length }; }
  /**
   * Stock query for one item. opts {from, to} (blank = all time).
   * summary {opening, purchased, sold, inHand, avgCost}: opening is the stock before `from` (the starting
   * quantity when there is no From), purchased / sold the purchase / sales invoice qty in the period,
   * inHand and avgCost the whole business at `to`, every stock movement counted.
   */
  function queryData(b, item, opts) { opts = opts || {}; var it = itemRec(b, item); if (!b || !it) return null;
    var from = day(opts.from), to = day(opts.to), rows = movements(b, it).rows || [];
    var opening = 0, qty = 0, val = 0, avg = num(it.purchasePrice);
    rows.forEach(function (r) { var d = day(r.date);
      if (!r.opening && to && d && d > to) return;
      if (r.opening || (from && d && d < from)) opening += num(r.qin) - num(r.qout);
      qty = num(r.qbal); val = num(r.cbal); if (qty > 1e-9) avg = val / qty; });
    var purchases = docRows(b, 'purchInv', it.name, 'supplier', from, to), sales = docRows(b, 'salesInv', it.name, 'customer', from, to);
    return { item: it, name: it.name, code: it.code || '', from: from, to: to, purchases: purchases, sales: sales,
      purchTotals: totalsOf(purchases), salesTotals: totalsOf(sales),
      summary: { opening: r6(opening), purchased: totalsOf(purchases).qty, sold: totalsOf(sales).qty, inHand: r6(qty), avgCost: avg } }; }

  /* ------------------------------------------------------------------ the label + button */
  var ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function handHtml(s) { if (!s) return '';
    return '<span class="sq-l">In hand:</span> <span class="sq-v">' + esc(money(s.inHand)) + '</span>' +
      (s.short > 1e-9 ? ' <span class="sq-sh">— short by ' + esc(money(s.short)) + '</span>' : ''); }
  /** put / refresh the label in `cell` and the button in `act` (before the line buttons) */
  function paint(cell, act, s, btnCls) { var d = G.document;
    if (cell) { var lab = cell.querySelector('.sq-hand');
      if (!s) { if (lab) lab.remove(); }
      else { if (!lab) { lab = d.createElement('div'); lab.className = 'sq-hand'; lab.setAttribute('data-noprint', ''); lab.setAttribute('aria-live', 'polite'); cell.appendChild(lab); }
        var h = handHtml(s); if (lab._sq !== h) { lab.innerHTML = h; lab._sq = h; }
        lab.classList.toggle('sq-short', s.short > 1e-9);
        lab.title = s.short > 1e-9 ? 'This line needs more than is in hand on this date' : 'Quantity in hand on this date, this document left out'; } }
    if (act) { var all = act.querySelectorAll('.sq-btn'), btn = all[0]; for (var k = 1; k < all.length; k++) all[k].remove();
      if (!s) { if (btn) btn.remove(); return; }
      if (!btn) { btn = d.createElement('button'); btn.type = 'button'; btn.className = 'sq-btn' + (btnCls ? ' ' + btnCls : ''); btn.tabIndex = -1;
        btn.title = 'Stock query'; btn.setAttribute('aria-label', 'Stock query'); btn.setAttribute('data-noprint', ''); btn.innerHTML = ICON; act.insertBefore(btn, act.firstChild); }
      btn.setAttribute('data-sq-item', s.item); } }

  /* ---- native Sales Invoice (js/txn-forms.js) */
  function txState() { return (G.TxnForms && TxnForms.state) ? TxnForms.state() : null; }
  function txDoc(t) { var qtyOn = t.colQty !== false;
    return { id: t.mode === 'edit' ? t.id : null, date: t.date || t.issueDate, location: t.location || '', customer: t.customer, copiedFrom: t.copiedFrom || null,
      lines: (t.lines || []).map(function (l) { return { item: l.item, qty: blank(l.item) ? 0 : (qtyOn ? num(l.qty) : 1) }; }) }; }
  function txPaint() { var t = txState(), b = curB(), h = byId('txHost'); if (!t || !b || !h || !h.querySelector || !FORM_KEYS[t.key]) return;
    var tb = h.querySelector('[data-line-items] tbody'); if (!tb) return; var S = lineStock(b, t.key, txDoc(t));
    Array.prototype.forEach.call(tb.rows, function (tr, i) { paint(tr.querySelector('td.itm'), tr.querySelector('td.act'), S[i] || null); }); }
  var txTimer = 0;
  function txSchedule() { clearTimeout(txTimer); txTimer = setTimeout(function () { try { txPaint(); } catch (e) {} }, 60); }
  function installTxn() { var TF = G.TxnForms; if (!TF || !TF.ext) return;
    TF.ext.onDraw.push(function () { try { txPaint(); } catch (e) {} wireTx(); });
    var mount = TF.mount; TF.mount = function () { var r = mount.apply(this, arguments); try { txPaint(); } catch (e) {} wireTx(); return r; }; }
  function wireTx() { var h = byId('txHost'); if (!h || h._sqWired || !h.addEventListener) return; h._sqWired = 1;
    var on = function (e) { var el = e.target; if (el && el.getAttribute && (el.getAttribute('data-f') === 'qty' || el.getAttribute('data-k') === 'date' || el.id === 'sfbLoc')) txSchedule(); };
    /* #sfbLoc: the Inventory location picker js/settings-fixes-b.js adds (it sets TX.location without a redraw) */
    h.addEventListener('input', on); h.addEventListener('change', on); }

  /* ---- Form Designer documents (js/form-editor-bridge.js) */
  var DS = null;   // {key, editId}
  function dHost() { return byId('deHost'); }
  function dVal(root, sel) { var el = root && root.querySelector(sel); return el ? String(el.value == null ? '' : el.value) : ''; }
  function dItemEl(tr) { return tr.querySelector('[data-var="items"]') || tr.querySelector('[data-var="item"]') || tr.querySelector('[data-item-select]'); }
  function dDoc(host, rows) { var P = PS(), dc = P && P._dc ? P._dc() : null;
    return { id: DS.editId, date: dVal(host, '[data-field-var="date"]') || dVal(host, '[data-field-var="issueDate"]') || today(),
      location: dVal(host, '[data-field-var="location"]'), fromLocation: dVal(host, '[data-field-var="fromLocation"]'), customer: dVal(host, '[data-field-var="custName"]'),
      copiedFrom: (dc && dc.key === DS.key && dc.copiedFrom) || null,
      lines: rows.map(function (tr) { var it = dItemEl(tr), q = tr.querySelector('[data-var="qty"]'); var name = it ? String(it.value || '') : '';
        return { item: name, qty: blank(name) ? 0 : (q ? (blank(q.value) ? 0 : num(q.value)) : 1) }; }) }; }
  function dPaint() { var host = dHost(), b = curB(); if (!DS || !host || !b) return;
    var tbl = host.querySelector('[data-line-items]'), tb = tbl && tbl.tBodies && tbl.tBodies[0]; if (!tb) return;
    var rows = Array.prototype.slice.call(tb.rows), S = lineStock(b, DS.key, dDoc(host, rows));
    rows.forEach(function (tr, i) { var it = dItemEl(tr); paint(it ? it.closest('td') : null, tr.querySelector('td.li-actc'), S[i] || null, 'li-btn'); }); }
  var dTimer = 0;
  function dSchedule() { clearTimeout(dTimer); dTimer = setTimeout(function () { try { dPaint(); } catch (e) {} }, 60); }
  function dMount(key, editId) { DS = null; if (!FORM_KEYS[key]) return; var host = dHost(); if (!host || !host.querySelector('[data-line-items]')) return;
    DS = { key: key, editId: editId != null ? editId : null };
    if (!host._sqWired && host.addEventListener) { host._sqWired = 1;
      var on = function (e) { var el = e.target; if (!DS || !el || !el.matches) return;
        if (el.matches('[data-var="qty"],[data-var="items"],[data-var="item"],[data-item-select],[data-field-var="date"],[data-field-var="issueDate"],[data-field-var="location"],[data-field-var="fromLocation"],[data-field-var="custName"]')) dSchedule(); };
      host.addEventListener('input', on, true); host.addEventListener('change', on, true);
      host.addEventListener('click', function (e) { var t = e.target; if (t && t.closest && t.closest('[data-ff-act],.li-add,.li-del')) dSchedule(); }); }
    var tb = host.querySelector('[data-line-items] tbody');
    if (tb && G.MutationObserver && !tb._sqObs) { tb._sqObs = new G.MutationObserver(function () { dSchedule(); }); tb._sqObs.observe(tb, { childList: true }); }
    dPaint(); }
  function installDesigned() {
    wrap('_mountDesignedForm', function (orig, args) { var key = args[0], editId = this.editingId; var r = orig.apply(this, args);
      try { dMount(key, editId); } catch (e) { if (G.console) console.warn('stock-query mount', e); } return r; }); }

  /* ------------------------------------------------------------------ the modal */
  var Q = null;   // open query {item, from, to, q, ov}
  var STACK = [];
  function topOv() { return STACK[STACK.length - 1] || null; }
  function overlay(cls, html, label) { var d = G.document, ov = d.createElement('div');
    ov.className = 'uim-ov sq-ov ' + cls; ov.style.zIndex = String(1360 + STACK.length * 10);
    ov.innerHTML = '<div class="uim sq-dlg" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' + html + '</div>';
    ov._prev = d.activeElement; d.body.appendChild(ov); STACK.push(ov);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeOv(ov); });
    return ov; }
  function closeOv(ov) { if (!ov) return; var at = STACK.indexOf(ov); if (at >= 0) STACK.splice(at, 1); if (ov.parentNode) ov.parentNode.removeChild(ov);
    if (Q && Q.ov === ov) Q = null; try { if (ov._prev && ov._prev.focus && G.document.contains(ov._prev)) ov._prev.focus(); } catch (e) {} }
  function onKey(e) { var ov = topOv(); if (!ov) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOv(ov); } }

  function tableHtml(kind, rows, t) { var party = kind === 'purchases' ? 'Supplier' : 'Customer';
    var head = '<thead><tr><th>Date</th><th>Reference</th><th>' + party + '</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>';
    if (!rows.length) return '<table class="sq-tbl">' + head + '<tbody><tr class="sq-empty"><td colspan="6">' + (kind === 'purchases' ? 'No purchases' : 'No sales') + '</td></tr></tbody></table>';
    var body = rows.map(function (r) {
      return '<tr><td class="sq-nw">' + esc(fmtD(r.date)) + '</td><td><a class="sq-ref" role="button" tabindex="0" data-sq-doc="' + esc(r.key) + '" data-sq-id="' + esc(JSON.stringify(r.id)) + '">' + esc(r.ref || '—') + '</a></td>' +
        '<td>' + esc(r.party) + '</td><td class="r m">' + esc(money(r.qty)) + '</td><td class="r m">' + esc(money(r.price)) + '</td><td class="r m">' + esc(money(r.amount)) + '</td></tr>'; }).join('');
    return '<table class="sq-tbl">' + head + '<tbody>' + body + '</tbody><tfoot><tr><td colspan="3">Total · ' + t.count + (t.count === 1 ? ' line' : ' lines') + '</td>' +
      '<td class="r m">' + esc(money(t.qty)) + '</td><td class="r m" title="Weighted average unit price">' + esc(money(t.avg)) + '</td><td class="r m">' + esc(money(t.amount)) + '</td></tr></tfoot></table>'; }
  function matches(r, q) { if (!q) return true; q = q.toLowerCase();
    return [fmtD(r.date), r.date, r.ref, r.party, money(r.qty), money(r.amount)].some(function (s) { return String(s || '').toLowerCase().indexOf(q) >= 0; }); }
  function filtered(data, q) { var P = data.purchases.filter(function (r) { return matches(r, q); }), S = data.sales.filter(function (r) { return matches(r, q); });
    return { purchases: P, sales: S, pt: totalsOf(P), st: totalsOf(S) }; }
  function summaryHtml(s) { var cell = function (l, v, cls) { return '<div class="sq-sum-c' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + esc(v) + '</b></div>'; };
    return cell('Opening qty', money(s.opening)) + cell('Total purchased', money(s.purchased)) + cell('Total sold', money(s.sold)) +
      cell('Qty in hand', money(s.inHand), s.inHand < -1e-9 ? 'sq-neg' : 'sq-key') + cell('Average cost', money(s.avgCost)); }
  function render() { if (!Q) return; var b = curB(); var data = b && queryData(b, Q.item, { from: Q.from, to: Q.to }); var ov = Q.ov;
    if (!data) { closeOv(ov); return; } Q.data = data; var f = filtered(data, Q.q); Q.f = f;
    ov.querySelector('[data-sq-sum]').innerHTML = summaryHtml(data.summary);
    ov.querySelector('[data-sq-p]').innerHTML = tableHtml('purchases', f.purchases, f.pt);
    ov.querySelector('[data-sq-s]').innerHTML = tableHtml('sales', f.sales, f.st);
    ov.querySelector('[data-sq-pc]').textContent = f.purchases.length; ov.querySelector('[data-sq-sc]').textContent = f.sales.length; }
  function title(data) { return 'Stock Query — ' + [data.code, data.name].filter(function (x) { return !blank(x); }).join(' '); }
  /** open the stock query of an item. opts {from, to} */
  function open(item, opts) { opts = opts || {}; var b = curB(); if (!b) return null; var it = itemRec(b, item);
    if (!it) { if (G.UIModal) UIModal.toast('Not an inventory item'); return null; }
    if (!hasDom()) { Q = { item: it.name, from: day(opts.from), to: day(opts.to), q: String(opts.q || '').trim() };
      Q.data = queryData(b, it.name, Q); Q.f = filtered(Q.data, Q.q); return Q.data; }
    if (Q && Q.ov) closeOv(Q.ov);
    var data = queryData(b, it.name, {});
    var html = '<div class="uim-h sq-h"><span>' + esc(title(data)) + '</span><button type="button" class="sq-x" data-sq-close aria-label="Close">×</button></div>' +
      '<div class="uim-b sq-b">' +
        '<div class="sq-sum" data-sq-sum></div>' +
        '<div class="sq-bar">' +
          '<label class="sq-f"><span>From</span><input type="date" data-sq-from value="' + esc(day(opts.from)) + '"></label>' +
          '<label class="sq-f"><span>To</span><input type="date" data-sq-to value="' + esc(day(opts.to)) + '"></label>' +
          '<button type="button" class="btn btn-sm sq-all" data-sq-all>All time</button>' +
          '<label class="sq-f sq-search"><span>Search</span><input type="text" role="searchbox" enterkeyhint="search" data-sq-q placeholder="Reference, party, date…" autocomplete="off"></label>' +
        '</div>' +
        '<div class="sq-cols">' +
          '<section class="sq-sec"><h3>Purchases <small data-sq-pc></small></h3><div class="sq-scroll" data-sq-p></div></section>' +
          '<section class="sq-sec"><h3>Sales <small data-sq-sc></small></h3><div class="sq-scroll" data-sq-s></div></section>' +
        '</div></div>' +
      '<div class="uim-f sq-foot"><button type="button" class="btn" data-sq-print>Print</button><button type="button" class="btn" data-sq-copy>Copy to clipboard</button>' +
        '<button type="button" class="btn btn-primary" data-sq-close>Close</button></div>';
    var ov = overlay('sq-main', html, title(data));
    Q = { item: it.name, from: day(opts.from), to: day(opts.to), q: '', ov: ov };
    var inp = function (sel) { return ov.querySelector(sel); };
    ov.addEventListener('input', function (e) { var t = e.target; if (!Q || Q.ov !== ov) return;
      if (t.matches('[data-sq-q]')) { Q.q = String(t.value || '').trim(); render(); }
      else if (t.matches('[data-sq-from],[data-sq-to]')) { Q.from = day(inp('[data-sq-from]').value); Q.to = day(inp('[data-sq-to]').value); render(); } });
    ov.addEventListener('click', function (e) { var t = e.target; if (!t || !t.closest) return;
      if (t.closest('[data-sq-close]')) { closeOv(ov); return; }
      if (t.closest('[data-sq-all]')) { inp('[data-sq-from]').value = ''; inp('[data-sq-to]').value = ''; Q.from = Q.to = ''; render(); return; }
      if (t.closest('[data-sq-print]')) { printQuery(); return; }
      if (t.closest('[data-sq-copy]')) { copyQuery(); return; }
      var a = t.closest('[data-sq-doc]'); if (a) { e.preventDefault(); openDoc(a.getAttribute('data-sq-doc'), JSON.parse(a.getAttribute('data-sq-id'))); } });
    ov.addEventListener('keydown', function (e) { var a = e.target && e.target.closest && e.target.closest('[data-sq-doc]');
      if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDoc(a.getAttribute('data-sq-doc'), JSON.parse(a.getAttribute('data-sq-id'))); } });
    render();
    setTimeout(function () { var f = inp('[data-sq-q]'); if (f && Q && Q.ov === ov) try { f.focus(); } catch (e) {} }, 0);
    return data; }

  /** the invoice behind a reference, in a panel above the stock query (the form underneath is untouched) */
  function openDoc(key, id) { var b = curB(); if (!b) return; var rec = recs(b, key).filter(function (r) { return r && String(r.id) === String(id); })[0];
    if (!rec) { if (G.UIModal) UIModal.toast('That document no longer exists'); return; }
    var c = (typeof REG !== 'undefined' && REG[key]) || {}, inner = '';
    try { inner = App.voucherDoc(b, c, rec); } catch (e) { inner = '<p class="sq-err">This document cannot be shown here.</p>'; }
    var name = (c.singular || DOC[key] || 'Document') + (rec.reference ? ' ' + rec.reference : '');
    var html = '<div class="uim-h sq-h"><span>' + esc(name) + '</span><button type="button" class="sq-x" data-sq-close aria-label="Close">×</button></div>' +
      '<div class="uim-b sq-b sq-docb"><div class="card sq-doc">' + inner + '</div></div>' +
      '<div class="uim-f sq-foot"><button type="button" class="btn btn-primary" data-sq-close>Back to stock query</button></div>';
    var ov = overlay('sq-docov', html, name);
    ov.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('[data-sq-close]')) closeOv(ov); });
    setTimeout(function () { var f = ov.querySelector('.btn-primary'); if (f) try { f.focus(); } catch (e) {} }, 0); }

  function periodText() { if (!Q) return ''; if (!Q.from && !Q.to) return 'All time';
    return (Q.from ? fmtD(Q.from) : 'Start') + ' – ' + (Q.to ? fmtD(Q.to) : 'Today'); }
  function printTable(kind, rows, t) { var party = kind === 'purchases' ? 'Supplier' : 'Customer';
    return '<h3 class="sq-ph">' + (kind === 'purchases' ? 'Purchases' : 'Sales') + '</h3><table class="reg-tbl"><thead><tr><th>Date</th><th>Reference</th><th>' + party + '</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr><td class="m">' + esc(fmtD(r.date)) + '</td><td>' + esc(r.ref) + '</td><td>' + esc(r.party) + '</td><td class="r m">' + esc(money(r.qty)) + '</td><td class="r m">' + esc(money(r.price)) + '</td><td class="r m">' + esc(money(r.amount)) + '</td></tr>'; }).join('')
        : '<tr><td colspan="6">' + (kind === 'purchases' ? 'No purchases' : 'No sales') + '</td></tr>') +
      '</tbody>' + (rows.length ? '<tfoot><tr><td colspan="3"><b>Total</b></td><td class="r m"><b>' + esc(money(t.qty)) + '</b></td><td class="r m"><b>' + esc(money(t.avg)) + '</b></td><td class="r m"><b>' + esc(money(t.amount)) + '</b></td></tr></tfoot>' : '') + '</table>'; }
  function printHtml() { var b = curB(), d = Q.data, f = Q.f, s = d.summary;
    return '<div class="rep-head"><div class="rep-org">' + esc((b && b.name) || '') + '</div><div class="rep-ttl">' + esc(title(d)) + '</div><div class="rep-sub">' + esc(periodText()) + (Q.q ? ' · Search: ' + esc(Q.q) : '') + '</div></div>' +
      '<table class="reg-tbl sq-psum"><tbody><tr><td>Opening qty</td><td class="r m">' + esc(money(s.opening)) + '</td><td>Total purchased</td><td class="r m">' + esc(money(s.purchased)) + '</td><td>Total sold</td><td class="r m">' + esc(money(s.sold)) + '</td></tr>' +
      '<tr><td>Qty in hand</td><td class="r m"><b>' + esc(money(s.inHand)) + '</b></td><td>Average cost</td><td class="r m">' + esc(money(s.avgCost)) + '</td><td></td><td></td></tr></tbody></table>' +
      printTable('purchases', f.purchases, f.pt) + printTable('sales', f.sales, f.st); }
  function printQuery() { if (!Q || !Q.data) return; var d = G.document, pr = byId('printRegion');
    if (!pr) { pr = d.createElement('div'); pr.id = 'printRegion'; d.body.appendChild(pr); }
    pr.innerHTML = '<div class="card rep-print sq-print">' + printHtml() + '</div>';
    var clean = function () { try { pr.innerHTML = ''; } catch (e) {} G.removeEventListener('afterprint', clean); };
    G.addEventListener('afterprint', clean);
    setTimeout(function () { try { G.print(); } catch (e) {} setTimeout(clean, 1500); }, 80); }
  /** tab-separated text of what the modal shows */
  function copyText() { if (!Q || !Q.data) return ''; var d = Q.data, f = Q.f, s = d.summary, L = [];
    L.push(title(d)); L.push('Period\t' + periodText() + (Q.q ? '\tSearch\t' + Q.q : ''));
    L.push(['Opening qty', 'Total purchased', 'Total sold', 'Qty in hand', 'Average cost'].join('\t'));
    L.push([money(s.opening), money(s.purchased), money(s.sold), money(s.inHand), money(s.avgCost)].join('\t'));
    [['Purchases', 'Supplier', f.purchases, f.pt], ['Sales', 'Customer', f.sales, f.st]].forEach(function (g) {
      L.push(''); L.push(g[0]); L.push(['Date', 'Reference', g[1], 'Qty', 'Unit price', 'Amount'].join('\t'));
      g[2].forEach(function (r) { L.push([fmtD(r.date), r.ref, r.party, money(r.qty), money(r.price), money(r.amount)].join('\t')); });
      L.push(['Total', '', '', money(g[3].qty), money(g[3].avg), money(g[3].amount)].join('\t')); });
    return L.join('\n'); }
  function copyQuery() { var txt = copyText(); if (!txt) return; var ok = function () { if (G.UIModal) UIModal.toast('Copied to clipboard'); };
    var fallback = function () { try { var d = G.document, ta = d.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      (Q && Q.ov ? Q.ov : d.body).appendChild(ta); ta.select(); d.execCommand('copy'); ta.remove(); ok(); } catch (e) { if (G.UIModal) UIModal.toast('Copy failed'); } };
    try { if (G.navigator && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fallback); else fallback(); } catch (e) { fallback(); } }

  /* ------------------------------------------------------------------ wiring */
  function installDom() { if (!hasDom()) return; var d = G.document;
    d.addEventListener('click', function (e) { var bt = e.target && e.target.closest && e.target.closest('.sq-btn[data-sq-item]'); if (!bt) return;
      e.preventDefault(); e.stopPropagation(); open(bt.getAttribute('data-sq-item')); }, true);
    d.addEventListener('keydown', onKey, true);
    /* a page change closes the query (its form is gone) */
    ['selectSection', 'go', 'openTool', 'openSetting', 'gotoRecord', 'openLedger', 'renderWorkspace'].forEach(function (n) {
      wrap(n, function (orig, args) { while (STACK.length) closeOv(STACK[STACK.length - 1]); return orig.apply(this, args); }); }); }

  G.StockQuery = {
    getItemStock: getItemStock, lineStock: lineStock, queryData: queryData, itemRec: itemRec, open: open, openDoc: openDoc,
    copyText: copyText, close: function () { while (STACK.length) closeOv(STACK[STACK.length - 1]); Q = null; },
    refresh: function () { try { txPaint(); } catch (e) {} try { dPaint(); } catch (e) {} },
    FORM_KEYS: FORM_KEYS, OUT_KEYS: OUT_KEYS, _state: function () { return Q; }
  };
  App.getItemStock = getItemStock;

  installTxn(); installDesigned(); installDom();
})(typeof window !== 'undefined' ? window : globalThis);
