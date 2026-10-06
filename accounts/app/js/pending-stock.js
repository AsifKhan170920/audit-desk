/* ===================== Pending purchases (stock sold before it is bought) =====================
   UAE trading clients often issue the Sales Invoice and the Delivery Note for goods they do not
   hold yet, buy them from the supplier, deliver, and enter the Purchase Invoice later. Without
   help that leaves negative stock and a wrong cost of sales. This module:

   - asks, on every stock-reducing line (native Sales Invoice; designer Delivery Note, Sales
     Invoice, Inventory Write-off, Inventory Transfer) whose qty is more than the stock available
     at that location on the document date (the document's own earlier qty excluded), what the
     shortage is: Purchase pending (expected supplier / date / note), Back-to-back, Stock
     correction later — or Cancel / change qty. The answer is kept on the line:
         line.pending = {pid, item, qty, short, term, supplier, expected, note, created}
     and shown as an amber "Pending purchase" badge (form, view; printed only when Settings ->
     Inventory says so). Same line + same qty is never asked again.
   - on a Purchase Invoice / Goods Receipt line of an item with open pending sales, lists them
     (oldest first up to the purchase qty, "only this supplier's") and stores the links on the
     purchase:  rec.pendingClears = [{pid, item, qty}].  The badge turns green "Cleared".
     The cost of the short qty is NOT stored anywhere: js/accounting.js invItemMovements costs it
     at the clearing purchase's unit cost and js/ledger-engine.js posts it, so editing or deleting
     the purchase recomputes everything (Trial Balance stays Dr = Cr).
   - Settings -> Inventory: "Selling more than in stock": Allow with pending (default) / Warn only
     (no tracking) / Block.
   - Reports -> Pending purchases (also linked from Inventory Items, which gets a
     "Qty pending purchase" column) with clearing from the list itself; Reminders source
     'pending-stock'.

   A Delivery Note does not move stock in this app (the invoice does), so a delivery note copied
   from a sales invoice, or covered by what was already invoiced to that customer, is not short:
   the shortage is counted once, on the invoice.  Old documents have no pending keys and behave
   exactly as before.
   ============================================================================================== */
(function (global) {
  'use strict';
  if (typeof App === 'undefined' || App.__pendingStock) return;
  App.__pendingStock = 1;
  var G = global;

  /* ------------------------------------------------------------------ helpers */
  function hasDom() { var d = G.document; return !!(d && d.body && d.body.nodeType === 1 && typeof d.createElement === 'function'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function r6(v) { return Math.round((Number(v) || 0) * 1e6) / 1e6; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function day(v) { return String(v || '').slice(0, 10); }
  function fmtD(v) { if (!v) return ''; try { return App.fmtDate(v); } catch (e) { return String(v); } }
  function money(v) { try { return App.money(v); } catch (e) { return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2); } }
  function qstr(v) { v = r6(v); try { return App.numStr ? App.numStr(v) : String(v); } catch (e) { return String(v); } }
  function curB() { try { return App.openBiz != null ? App.curBiz() : null; } catch (e) { return null; } }
  function recs(b, k) { return ((b && b.records) || {})[k] || []; }
  function byId(id) { var d = G.document; return d && d.getElementById ? d.getElementById(id) : null; }
  function newPid() { return 'pp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function wrap(name, fn) { var orig = App[name]; if (typeof orig !== 'function') return; App[name] = function () { return fn.call(this, orig, arguments); }; }

  var SALE_KEYS = { salesInv: 1, deliveryNotes: 1, invWriteOffs: 1, invTransfers: 1 };
  var BUY_KEYS = { purchInv: 1, goodsRec: 1 };
  var DOC = { salesInv: 'Sales Invoice', deliveryNotes: 'Delivery Note', invWriteOffs: 'Inventory Write-off', invTransfers: 'Inventory Transfer',
    purchInv: 'Purchase Invoice', goodsRec: 'Goods Receipt' };
  var TERMS = { purchase: 'Purchase pending', b2b: 'Back-to-back (supplier delivers to customer)', correction: 'Stock correction later' };
  var TERM_SHORT = { purchase: 'Purchase pending', b2b: 'Back-to-back', correction: 'Stock correction later' };
  /* write-offs and transfers move stock you hold: buying for them makes no sense */
  function moveKind(key) { return key === 'invWriteOffs' || key === 'invTransfers'; }

  /* ------------------------------------------------------------------ settings */
  function cfg(b) { var s = (b && b.inventorySettings) || {};
    return { oversell: (s.oversell === 'warn' || s.oversell === 'block') ? s.oversell : 'pending', printBadges: !!s.printBadges }; }

  /* ------------------------------------------------------------------ availability */
  function invRec(b, name) { if (blank(name)) return null; return recs(b, 'inventory').filter(function (x) { return x && x.name === name; })[0] || null; }
  function isMain(loc) { return blank(loc) || /^main location$/i.test(String(loc).trim()); }
  function locNames(b) { var s = {};
    ((b && b.locations) || []).forEach(function (l) { var n = l && (l.name || (typeof l === 'string' ? l : '')); if (n && !isMain(n)) s[n] = 1; });
    recs(b, 'invTransfers').forEach(function (t) { if (!t) return; [t.fromLocation, t.toLocation].forEach(function (n) { if (n && !isMain(n)) s[n] = 1; }); });
    return Object.keys(s); }
  function same(excl, key, id) { return !!(excl && excl.key === key && excl.id != null && String(excl.id) === String(id)); }
  /** quantity of an item in the whole business as at `date` (inclusive), without document `excl` */
  function totalQty(b, item, date, excl) {
    var it = invRec(b, item); if (!it) return 0; var m; try { m = invItemMovements(b, it); } catch (e) { return 0; }
    var q = 0;
    (m.rows || []).forEach(function (r) {
      if (r.opening) { q += num(r.qin); return; }
      if (date && day(r.date) && day(r.date) > date) return;
      if (same(excl, r.src, r.id)) return;
      q += num(r.qin) - num(r.qout); });
    return q; }
  /** what one custom location holds: transfers in / out, sales invoices and credit notes that name it */
  function locQty(b, item, loc, date, excl) { var q = 0;
    recs(b, 'invTransfers').forEach(function (t) { if (!t || same(excl, 'invTransfers', t.id)) return; if (date && day(t.date) && day(t.date) > date) return;
      (t.lines || []).forEach(function (ln) { if (!ln || (ln.item || ln.items) !== item) return; var n = num(ln.qty);
        if ((t.toLocation || '') === loc) q += n; if ((t.fromLocation || '') === loc) q -= n; }); });
    [['salesInv', -1], ['creditNotes', 1]].forEach(function (p) { recs(b, p[0]).forEach(function (r) {
      if (!r || (r.location || '') !== loc || same(excl, p[0], r.id)) return; var d = day(r.issueDate || r.date); if (date && d && d > date) return;
      (r.lines || []).forEach(function (ln) { if (ln && (ln.item || ln.items) === item) q += p[1] * num(ln.qty); }); }); });
    return q; }
  /** Stock available for a document line. opts {date, location, excl:{key,id}} */
  function available(b, item, opts) { opts = opts || {}; var date = day(opts.date), excl = opts.excl || null, loc = opts.location || '';
    if (!isMain(loc)) return r6(locQty(b, item, loc, date, excl));
    var q = totalQty(b, item, date, excl); locNames(b).forEach(function (n) { q -= locQty(b, item, n, date, excl); });
    return r6(q); }
  /** sold to this customer on sales invoices but not delivered yet (other delivery notes) */
  function invoicedUndelivered(b, doc, item) { var c = doc.customer; if (blank(c)) return 0; var q = 0;
    recs(b, 'salesInv').forEach(function (r) { if (!r || (r.customer || r.custName) !== c) return; (r.lines || []).forEach(function (ln) { if (ln && (ln.item || ln.items) === item) q += num(ln.qty); }); });
    recs(b, 'deliveryNotes').forEach(function (r) { if (!r || (r.customer || r.custName) !== c || (doc.id != null && String(r.id) === String(doc.id))) return;
      (r.lines || []).forEach(function (ln) { if (ln && (ln.item || ln.items) === item) q -= num(ln.qty); }); });
    return Math.max(0, q); }

  /**
   * Lines of a stock-reducing document that need more than is available.
   * doc {id, date, location, fromLocation, customer, copiedFrom, lines:[{item, qty}]}
   * -> [{i, item, qty, available, short}]
   */
  function shortages(b, key, doc) {
    var out = []; if (!b || !SALE_KEYS[key] || !doc) return out;
    if (key === 'deliveryNotes' && doc.copiedFrom && doc.copiedFrom.key === 'salesInv') return out;   // the invoice tracks it
    var excl = doc.id != null ? { key: key, id: doc.id } : null;
    var loc = key === 'invTransfers' ? (doc.fromLocation || '') : (key === 'salesInv' ? (doc.location || '') : '');
    var avail = {}, used = {}, cover = {};
    (doc.lines || []).forEach(function (ln, i) {
      var it = ln && ln.item; if (!it || !invRec(b, it)) return; var q = num(ln.qty); if (!(q > 0)) return;
      if (!(it in avail)) { avail[it] = available(b, it, { date: doc.date, location: loc, excl: excl }); used[it] = 0;
        cover[it] = key === 'deliveryNotes' ? invoicedUndelivered(b, doc, it) : 0; }
      var before = used[it]; used[it] += q;
      var have = Math.max(0, avail[it]) + cover[it];
      var sh = r6(Math.min(q, used[it] - have));
      if (sh > 1e-9) out.push({ i: i, item: it, qty: r6(q), available: r6(Math.max(0, have - before)), short: sh });
    });
    return out; }

  /* ------------------------------------------------------------------ the pending index */
  function pendOfLine(ln) { var p = ln && ln.pending; if (!p || typeof p !== 'object' || blank(p.pid)) return null; return num(p.short) > 0 ? p : null; }
  /**
   * Every pending line with what has cleared it.  opts.exclude {key,id}: leave that purchase's
   * links out (the form editing it shows its own choice).
   * -> {list:[entry], byPid:{pid:entry}}
   * entry {pid, key, id, ref, date, party, item, line, short, term, supplier, expected, note, created,
   *        cleared, received, open, clears:[{key,id,ref,date,qty}], tracked:{key,id,ref}|null}
   */
  function pendingIndex(b, opts) { opts = opts || {}; var list = [], byPid = {};
    Object.keys(SALE_KEYS).forEach(function (key) { recs(b, key).forEach(function (r) { if (!r) return;
      (r.lines || []).forEach(function (ln, i) { var p = pendOfLine(ln); if (!p || byPid[p.pid]) return;
        var e = { pid: p.pid, key: key, id: r.id, ref: r.reference || '', date: day(r.issueDate || r.date), party: r.customer || r.custName || '',
          item: ln.item || ln.items || p.item || '', line: i + 1, short: r6(num(p.short)), qty: num(ln.qty), term: p.term || 'purchase', supplier: p.supplier || '',
          expected: p.expected || '', note: p.note || '', created: p.created || '', cleared: 0, received: 0, clears: [], tracked: null, copiedFrom: r.copiedFrom || null };
        list.push(e); byPid[p.pid] = e; }); }); });
    ['purchInv', 'goodsRec'].forEach(function (key) { recs(b, key).forEach(function (d) {
      if (!d || !Array.isArray(d.pendingClears) || !d.pendingClears.length || same(opts.exclude, key, d.id)) return;
      var left = {}; (d.lines || []).forEach(function (ln) { var it = ln && (ln.item || ln.items); if (it) left[it] = (left[it] || 0) + num(ln.qty); });
      d.pendingClears.forEach(function (c) { var e = c && byPid[c.pid]; if (!e || e.item !== c.item) return;
        var done = key === 'purchInv' ? e.cleared : e.received;
        var q = r6(Math.min(num(c.qty), left[c.item] || 0, e.short - done)); if (!(q > 0)) return; left[c.item] -= q;
        if (key === 'purchInv') e.cleared = r6(e.cleared + q); else e.received = r6(e.received + q);
        e.clears.push({ key: key, id: d.id, ref: d.reference || '', date: day(d.issueDate || d.date), qty: q, supplier: d.supplier || d.supName || '' }); }); }); });
    /* a delivery note's shortage is the invoice's when that customer was invoiced the item (counted once) */
    list.forEach(function (e) { if (e.key !== 'deliveryNotes') return;
      var cf = e.copiedFrom; if (cf && cf.key === 'salesInv') { e.tracked = { key: 'salesInv', id: cf.id, ref: cf.reference || '' }; return; }
      var si = list.filter(function (x) { return x.key === 'salesInv' && x.item === e.item && x.party && x.party === e.party; })[0];
      if (si) e.tracked = { key: 'salesInv', id: si.id, ref: si.ref }; });
    list.forEach(function (e) { e.open = e.tracked ? 0 : r6(Math.max(0, e.short - e.cleared)); });
    list.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)) || String(x.ref).localeCompare(String(y.ref), undefined, { numeric: true }) || x.line - y.line; });
    return { list: list, byPid: byPid }; }
  /** open pending lines a purchase (purchInv) or goods receipt (goodsRec) of `item` can clear */
  function openFor(b, item, key, excl) {
    return pendingIndex(b, { exclude: excl }).list.filter(function (e) {
      if (e.item !== item || e.tracked) return false;
      var left = key === 'goodsRec' ? e.short - e.cleared - e.received : e.short - e.cleared;
      e.avail = r6(Math.max(0, left)); return e.avail > 1e-9; }); }
  function hasClears(b, pid) { var e = pendingIndex(b).byPid[pid]; return !!(e && e.clears.length); }
  var _qCache = { k: null, v: null };
  /** open (uncleared) pending qty per item, for the Inventory Items column */
  function openQtyByItem(b) { var R = (b && b.records) || {}; var k;
    try { k = JSON.stringify([b.id, R.salesInv, R.deliveryNotes, R.invWriteOffs, R.invTransfers, R.purchInv, R.goodsRec]); } catch (e) { k = null; }
    if (k && _qCache.k === k) return _qCache.v;
    var out = {}; pendingIndex(b).list.forEach(function (e) { if (e.open > 0) out[e.item] = r6((out[e.item] || 0) + e.open); });
    _qCache = { k: k, v: out }; return out; }
  /** latest known unit cost of an item (last purchase invoice line, else its purchase price) */
  function lastCost(b, item) { var best = null;
    recs(b, 'purchInv').forEach(function (d) { if (!d) return; var u = (typeof purchUnitCost === 'function') ? purchUnitCost(d, item) : { qty: 0 }; if (!u.qty) return;
      var dt = day(d.issueDate || d.date); if (!best || dt >= best.d) best = { d: dt, c: u.unit }; });
    if (best) return best.c; var it = invRec(b, item); return it ? num(it.purchasePrice) : 0; }

  /* ------------------------------------------------------------------ badges */
  function docLink(key, id, text) { return '<a class="ps-link" onclick="PendingStock.openDoc(\'' + key + '\',' + esc(JSON.stringify(id)) + ')">' + esc(text) + '</a>'; }
  function chip(cls, html, title) { return '<span class="ps-badge ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + html + '</span>'; }
  /** badge(s) of a saved pending line (index entry), or of an unsaved choice ({short, term, ...}) */
  function badgeHtml(e, opts) { opts = opts || {}; var link = !opts.plain;
    var L = function (key, id, t) { return link ? docLink(key, id, t) : esc(t); };
    if (e.tracked) return chip('ps-info', 'Counted on ' + L('salesInv', e.tracked.id, 'Sales Invoice ' + (e.tracked.ref || '')), 'The invoice moves the stock; the shortage is tracked there');
    var h = '', short = r6(num(e.short)), cleared = r6(num(e.cleared)), recv = r6(num(e.received));
    var pi = (e.clears || []).filter(function (c) { return c.key === 'purchInv'; }), gr = (e.clears || []).filter(function (c) { return c.key === 'goodsRec'; });
    if (cleared >= short - 1e-9 && cleared > 0) {
      h += chip('ps-ok', '✓ Cleared — ' + pi.map(function (c) { return L('purchInv', c.id, 'Purchase Invoice ' + (c.ref || '')) + ' (' + esc(fmtD(c.date)) + ')'; }).join(', '));
    } else {
      var term = TERM_SHORT[e.term] || TERM_SHORT.purchase;
      var extra = []; if (e.term === 'purchase' && e.supplier) extra.push('from ' + e.supplier); if (e.expected) extra.push('by ' + fmtD(e.expected));
      h += chip('ps-warn', '⏳ Pending purchase · short ' + esc(qstr(short)) + (cleared > 0 ? ' · ' + esc(qstr(short - cleared)) + ' open' : ''), e.note || '') +
        '<span class="ps-meta">' + esc(term) + (extra.length ? ' · ' + esc(extra.join(' ')) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</span>';
      pi.forEach(function (c) { h += chip('ps-ok', '✓ ' + esc(qstr(c.qty)) + ' cleared — ' + L('purchInv', c.id, 'Purchase Invoice ' + (c.ref || ''))); });
    }
    if (recv > 0 && cleared < short - 1e-9) gr.forEach(function (c) { h += chip('ps-rcv', '📦 ' + esc(qstr(c.qty)) + ' received — ' + L('goodsRec', c.id, 'Goods Receipt ' + (c.ref || ''))); });
    return h; }

  /* ------------------------------------------------------------------ dialogs */
  var STACK = [];
  /** An app dialog (UIModal look). buttons [{v, text, cls}]; resolves {v, ov}. Esc / backdrop -> {v:'cancel'} */
  function dialog(title, body, buttons, opts) { opts = opts || {}; var d = G.document;
    return new Promise(function (resolve) {
      var ov = d.createElement('div'); ov.className = 'uim-ov ui-modal-ov ps-ov'; ov.style.zIndex = String(1350 + STACK.length);
      ov.innerHTML = '<div class="uim ui-modal ps-dlg' + (opts.wide ? ' ps-wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
        '<div class="uim-h">' + esc(title) + '</div><div class="uim-b ps-b">' + body + '</div><div class="uim-f">' +
        buttons.map(function (bt) { return '<button type="button" class="btn ' + (bt.cls || '') + '" data-ps-btn="' + esc(bt.v) + '">' + esc(bt.text) + '</button>'; }).join('') + '</div></div>';
      var done = false, prev = d.activeElement;
      function close(v) { if (done) return; done = true; d.removeEventListener('keydown', onKey, true); if (ov.parentNode) ov.parentNode.removeChild(ov);
        var at = STACK.indexOf(ov); if (at >= 0) STACK.splice(at, 1); try { if (prev && prev.focus) prev.focus(); } catch (e) {} resolve({ v: v, ov: ov }); }
      function onKey(e) { if (STACK[STACK.length - 1] !== ov) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('cancel'); }
        else if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && opts.enter) { e.preventDefault(); e.stopPropagation(); close(opts.enter); } }
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close('cancel'); });
      ov.addEventListener('click', function (e) { var bt = e.target.closest && e.target.closest('[data-ps-btn]'); if (bt) close(bt.getAttribute('data-ps-btn')); });
      d.addEventListener('keydown', onKey, true);
      d.body.appendChild(ov); STACK.push(ov);
      if (opts.onOpen) try { opts.onOpen(ov); } catch (e) {}
      setTimeout(function () { var f = ov.querySelector(opts.focus || '.btn-primary'); if (f && f.focus) try { f.focus(); } catch (e) {} }, 0);
    }); }
  function supplierOpts(b) { return recs(b, 'suppliers').map(function (s) { return s && (s.name || s.supName || s.supplier); }).filter(Boolean); }

  /**
   * "Not enough stock" for one line. s {item, available, qty, short}; c {key, mode, prev}
   * -> Promise<{term, supplier, expected, note} | {warned:1} | {cancel:1}>
   */
  function askShort(b, s, c) { c = c || {}; var mode = c.mode || cfg(b).oversell;
    if (!hasDom()) { var a = PS._auto ? PS._auto(s, c) : null; if (a) return Promise.resolve(a);
      return Promise.resolve(mode === 'block' ? { cancel: 1 } : mode === 'warn' ? { warned: 1 } : { term: moveKind(c.key) ? 'correction' : 'purchase' }); }
    var what = c.key === 'invWriteOffs' ? 'This write-off' : c.key === 'invTransfers' ? 'This transfer' : c.key === 'deliveryNotes' ? 'This delivery' : 'This sale';
    var head = '<div class="ps-short"><div class="ps-item">' + esc(s.item) + '</div><div class="ps-nums">' +
      '<span>Available <b>' + esc(qstr(s.available)) + '</b></span><span>' + what + ' <b>' + esc(qstr(s.qty)) + '</b></span>' +
      '<span class="ps-neg">Short <b>' + esc(qstr(s.short)) + '</b></span></div></div>';
    if (mode === 'block') return dialog('Not enough stock', head + '<p class="ps-note">Selling more than is in stock is blocked for this business (Settings → Inventory). Change the quantity, or enter the purchase first.</p>',
      [{ v: 'cancel', text: 'Change qty', cls: 'btn-primary' }]).then(function () { return { cancel: 1 }; });
    if (mode === 'warn') return dialog('Not enough stock', head + '<p class="ps-note">You can still save — the item shows a negative quantity until stock is received. Pending purchases are not tracked (Settings → Inventory).</p>',
      [{ v: 'cancel', text: 'Change qty' }, { v: 'ok', text: 'Continue', cls: 'btn-primary' }], { enter: 'ok' }).then(function (r) { return r.v === 'ok' ? { warned: 1 } : { cancel: 1 }; });
    var p = c.prev || {}, move = moveKind(c.key);
    var cur = p.term && (!move || p.term === 'correction') ? p.term : (move ? 'correction' : 'purchase');
    var opt = function (v, label, extra) { return '<label class="ps-opt"><input type="radio" name="psTerm" value="' + v + '"' + (cur === v ? ' checked' : '') + '><span>' + esc(label) + '</span></label>' + (extra || ''); };
    var sups = supplierOpts(b);
    var more = '<div class="ps-more" data-ps-more>' +
      '<label class="ps-f"><span>Expected supplier</span><input type="text" list="psSupList" data-ps="supplier" value="' + esc(p.supplier || '') + '" placeholder="Optional"><datalist id="psSupList">' +
        sups.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label>' +
      '<label class="ps-f"><span>Expected date</span><input type="date" data-ps="expected" value="' + esc(p.expected || '') + '"></label>' +
      '<label class="ps-f ps-f-w"><span>Note</span><input type="text" data-ps="note" value="' + esc(p.note || '') + '" placeholder="Optional"></label></div>';
    var body = head + '<div class="ps-q">How will this be settled?</div><div class="ps-opts" role="radiogroup">' +
      (move ? '' : opt('purchase', TERMS.purchase, more) + opt('b2b', TERMS.b2b)) + opt('correction', TERMS.correction) + opt('cancel', 'Cancel / change qty') + '</div>' +
      (move ? '' : '<p class="ps-note">The short quantity’s cost of sales waits for the purchase that clears it.</p>');
    var sync = function (ov) { var v = (ov.querySelector('input[name="psTerm"]:checked') || {}).value; var m = ov.querySelector('[data-ps-more]'); if (m) m.hidden = v !== 'purchase'; };
    return dialog('Not enough stock', body, [{ v: 'cancel', text: 'Cancel / change qty' }, { v: 'ok', text: 'Save choice', cls: 'btn-primary' }],
      { enter: 'ok', onOpen: function (ov) { sync(ov); ov.addEventListener('change', function () { sync(ov); }); } })
      .then(function (r) { if (r.v !== 'ok') return { cancel: 1 }; var ov = r.ov;
        var term = (ov.querySelector('input[name="psTerm"]:checked') || {}).value || 'purchase'; if (term === 'cancel') return { cancel: 1 };
        var g = function (k) { var el = ov.querySelector('[data-ps="' + k + '"]'); return el ? String(el.value || '').trim() : ''; };
        return term === 'purchase' ? { term: term, supplier: g('supplier'), expected: g('expected'), note: g('note') } : { term: term }; }); }
  /** the pending record a choice leaves on a line */
  function pendingFrom(item, s, res, prev) { prev = prev || {};
    return { pid: prev.pid || newPid(), item: item, qty: s.qty, short: s.short, term: res.term || 'purchase', supplier: res.supplier || '', expected: res.expected || '',
      note: res.note || '', created: prev.created || today() }; }

  /**
   * Purchase / goods receipt: which open pending sales does it clear?
   * list from openFor(); o {qty, supplier, preset:[{pid,qty}], key}
   * -> Promise<[{pid, qty}] | null>   (null = leave as it was)
   */
  function defaultPick(list, qty, onlySup) { var left = num(qty), out = [];
    list.forEach(function (e) { if (onlySup != null && (e.supplier || '') !== onlySup) return; if (left <= 1e-9) return; var q = r6(Math.min(e.avail, left)); left -= q; out.push({ pid: e.pid, qty: q }); });
    return out; }
  function askClear(b, item, list, o) { o = o || {};
    var preset = (o.preset || []).filter(function (c) { return list.some(function (e) { return e.pid === c.pid; }); });
    var init = preset.length ? preset : defaultPick(list, o.qty);
    if (!hasDom()) { var a = PS._autoClear ? PS._autoClear(list, o) : null; return Promise.resolve(a || init); }
    var pick = {}; init.forEach(function (c) { pick[c.pid] = c.qty; });
    var gr = o.key === 'goodsRec';
    var rows = list.map(function (e) { var on = pick[e.pid] != null;
      return '<tr data-pid="' + esc(e.pid) + '" data-sup="' + esc(e.supplier || '') + '">' +
        '<td class="ps-ck"><input type="checkbox" aria-label="Clear ' + esc(DOC[e.key] + ' ' + e.ref) + '"' + (on ? ' checked' : '') + '></td>' +
        '<td>' + esc(DOC[e.key]) + '</td><td>' + esc(e.ref) + '</td><td class="ps-nw">' + esc(fmtD(e.date)) + '</td><td>' + esc(e.party) + '</td>' +
        '<td class="r">' + esc(qstr(e.avail)) + '</td><td class="ps-term">' + esc(TERM_SHORT[e.term] || '') + '</td><td>' + esc(e.supplier || '') + '</td>' +
        '<td class="r"><input type="text" inputmode="decimal" class="ps-qty" value="' + esc(on ? qstr(pick[e.pid]) : qstr(e.avail)) + '" aria-label="Qty to clear"></td></tr>'; }).join('');
    var anySup = !blank(o.supplier) && list.some(function (e) { return e.supplier === o.supplier; });
    var body = '<p class="ps-lead"><b>' + esc(item) + '</b> was sold before it was in stock. Tick the sales this ' + (gr ? 'goods receipt brings the goods in for' : 'purchase clears') +
      ' — their cost of sales ' + (gr ? 'still waits for the purchase invoice.' : 'is taken at this purchase’s unit cost.') + '</p>' +
      '<div class="ps-bar"><span>This ' + (gr ? 'receipt' : 'purchase') + ': <b data-ps-pq>' + esc(qstr(o.qty)) + '</b></span><span>Selected: <b data-ps-sel>0</b></span>' +
      (anySup ? '<label class="ps-chk"><input type="checkbox" data-ps-only> Only ' + esc(o.supplier) + '’s</label>' : '') + '</div>' +
      '<div class="ps-tw"><table class="ps-tbl"><thead><tr><th></th><th>Doc type</th><th>No.</th><th>Date</th><th>Customer</th><th class="r">Short qty</th><th>Term</th><th>Expected supplier</th><th class="r">Clear</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ps-warnline" data-ps-over hidden>More is selected than this document’s quantity.</div>';
    var recalc = function (ov) { var s = 0; ov.querySelectorAll('tbody tr').forEach(function (tr) { if (!tr.hidden && tr.querySelector('.ps-ck input').checked) s += num(tr.querySelector('.ps-qty').value); });
      ov.querySelector('[data-ps-sel]').textContent = qstr(s); var w = ov.querySelector('[data-ps-over]'); if (w) w.hidden = !(num(o.qty) > 0 && s > num(o.qty) + 1e-9); };
    return dialog('Pending sales for ' + item, body, [{ v: 'cancel', text: 'Not now' }, { v: 'ok', text: 'Clear selected', cls: 'btn-primary' }], { wide: true,
      onOpen: function (ov) { recalc(ov);
        ov.addEventListener('input', function () { recalc(ov); });
        ov.addEventListener('change', function (e) { var t = e.target;
          if (t && t.hasAttribute && t.hasAttribute('data-ps-only')) {
            var only = t.checked, keep = only ? defaultPick(list, o.qty, o.supplier) : defaultPick(list, o.qty), km = {}; keep.forEach(function (c) { km[c.pid] = c.qty; });
            ov.querySelectorAll('tbody tr').forEach(function (tr) { var pid = tr.getAttribute('data-pid'); tr.hidden = only && tr.getAttribute('data-sup') !== o.supplier;
              var e2 = list.filter(function (x) { return x.pid === pid; })[0]; tr.querySelector('.ps-ck input').checked = km[pid] != null; tr.querySelector('.ps-qty').value = qstr(km[pid] != null ? km[pid] : e2.avail); }); }
          recalc(ov); }); } })
      .then(function (r) { if (r.v !== 'ok') return null; var out = [];
        r.ov.querySelectorAll('tbody tr').forEach(function (tr) { if (tr.hidden || !tr.querySelector('.ps-ck input').checked) return; var pid = tr.getAttribute('data-pid');
          var e = list.filter(function (x) { return x.pid === pid; })[0]; var q = r6(Math.min(num(tr.querySelector('.ps-qty').value), e ? e.avail : 0)); if (q > 0) out.push({ pid: pid, qty: q }); });
        return out; }); }

  /* ================================================================ native Sales Invoice (TxnForms) */
  var busy = false;
  function txState() { return (G.TxnForms && TxnForms.state) ? TxnForms.state() : null; }
  function txQty(t, l, force) { if (blank(l.item)) return 0; if (t.colQty === false) return 0; if (blank(l.qty)) return force ? 1 : 0; return num(l.qty); }
  function txDoc(t, force) { return { id: t.mode === 'edit' ? t.id : null, date: t.date, location: t.location || '', customer: t.customer,
    lines: (t.lines || []).map(function (l) { return { item: l.item, qty: txQty(t, l, force) }; }) }; }
  function sig(item, qty) { return String(item) + '|' + r6(qty); }
  function resolved(l, s, mode) { if (!l) return true;
    if (mode === 'pending') return !!(l.pending && l.pending.item === l.item && r6(num(l.pending.qty)) === r6(s.qty));
    if (mode === 'warn') return l._psWarn === sig(l.item, s.qty) || !!(l.pending && l.pending.item === l.item && r6(num(l.pending.qty)) === r6(s.qty));
    return false; }
  /** drop a pending choice from lines that are no longer short (unless a purchase already cleared it) */
  function tidy(b, lines, S) { var short = {}; S.forEach(function (s) { short[s.i] = s; }); var ch = false;
    lines.forEach(function (l, i) { if (!l) return; var p = l.pending || l._psPending; if (short[i]) { if (p && p.item === l.item && r6(num(p.qty)) === short[i].qty && r6(num(p.short)) !== short[i].short && !hasClears(b, p.pid)) { p.short = short[i].short; ch = true; } return; }
      if (p && !hasClears(b, p.pid)) { if (l.pending) delete l.pending; if (l._psPending) delete l._psPending; ch = true; } });
    return ch; }
  /**
   * Ask about every short line of the open Sales Invoice not answered yet.
   * force (save): blank qty counts as 1 and lines the user skipped are asked again.
   * -> Promise<boolean> all resolved
   */
  function txCheck(force) {
    var b = curB(), t = txState(); if (!b || !t || t.key !== 'salesInv' || busy) return Promise.resolve(true);
    var mode = cfg(b).oversell, S = shortages(b, 'salesInv', txDoc(t, force));
    var changed = tidy(b, t.lines, S);
    var todo = S.filter(function (s) { var l = t.lines[s.i]; if (resolved(l, s, mode)) return false; return force || l._psSkip !== sig(l.item, s.qty); });
    if (!todo.length) { if (changed && !force) TxnForms.redraw(); return Promise.resolve(mode !== 'block' || !S.length); }
    busy = true; var ok = true, focusAt = -1;
    return todo.reduce(function (p, s) { return p.then(function () {
      var l = t.lines[s.i]; if (!l || l.item !== s.item || !ok) return;
      return askShort(b, s, { key: 'salesInv', mode: mode, prev: l.pending }).then(function (res) {
        if (res.cancel) { ok = false; l._psSkip = sig(l.item, s.qty); if (focusAt < 0) focusAt = s.i; return; }
        if (res.warned) { l._psWarn = sig(l.item, s.qty); return; }
        l.pending = pendingFrom(l.item, s, res, l.pending); delete l._psSkip; }); }); }, Promise.resolve())
      .then(function () { busy = false; if (txState() === t) { TxnForms.redraw(); if (focusAt >= 0) focusQty(focusAt); } return ok && mode !== 'block'; },
        function (e) { busy = false; throw e; }); }
  function focusQty(i) { setTimeout(function () { var h = byId('txHost'); var el = h && h.querySelector('[data-l="' + i + '"][data-f="qty"]'); if (el) try { el.focus(); el.select && el.select(); } catch (e) {} }, 30); }
  function txBadges(b, t) { var h = byId('txHost'); if (!h || !h.querySelectorAll || !t || t.key !== 'salesInv') return;
    var idx = pendingIndex(b), rows = h.querySelectorAll('table.tx-ln tbody tr');
    Array.prototype.forEach.call(rows, function (tr, i) { var old = tr.querySelector('.ps-badges'); if (old) old.remove();
      var l = t.lines[i]; var p = l && l.pending; if (!p || p.item !== l.item) return;
      var e = idx.byPid[p.pid]; var html = badgeHtml(e && r6(e.short) === r6(p.short) ? e : p);
      var cell = tr.querySelector('td.itm') || tr.querySelector('td:nth-child(2)') || tr.firstElementChild; if (!cell) return;
      var box = G.document.createElement('div'); box.className = 'ps-badges'; box.innerHTML = html; cell.appendChild(box); }); }
  var txTimer = 0;
  function txSchedule() { clearTimeout(txTimer); txTimer = setTimeout(function () { txCheck(false); }, 60); }
  /** watch the open Sales Invoice: a qty, the date or the inventory location (js/settings-fixes-b.js #sfbLoc
      sets TX.location without a redraw) changes what is short */
  function txWire() { var h = byId('txHost'); if (!h || h._psWired || !h.addEventListener) return; h._psWired = 1;
    h.addEventListener('change', function (e) { var el = e.target; if (!el || !el.getAttribute) return;
      if (el.getAttribute('data-f') === 'qty' || el.getAttribute('data-k') === 'date' || el.id === 'sfbLoc') txSchedule(); }); }
  /* ---- native Purchase Invoice: an item / qty change offers the pending sales it can clear (as dPurchase does) */
  function txBuyQty(t, l) { if (blank(l.item)) return 0; if (t.colQty === false) return 1; return blank(l.qty) ? 0 : num(l.qty); }
  function txBuySigs(t) { var q = {}; (t.lines || []).forEach(function (l) { if (l && !blank(l.item)) q[l.item] = (q[l.item] || 0) + txBuyQty(t, l); });
    var out = {}; Object.keys(q).forEach(function (it) { out[it] = sig(it, q[it]); }); return { qty: q, sig: out }; }
  /** what the open record already clears; the current lines count as already asked */
  function txBuyInit(b, t) { if (!b || !t || t._psClears) return;
    var rec = t.mode === 'edit' && t.id != null ? recs(b, t.key).filter(function (r) { return r && r.id === t.id; })[0] : null;
    t._psClears = clone((rec && rec.pendingClears) || []); t._psSig = txBuySigs(t).sig;
    var h = byId('txHost'); if (h && h.addEventListener && !h._psBuyWired) { h._psBuyWired = 1;
      h.addEventListener('change', function (e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-f') === 'qty') setTimeout(txBuyScan, 30); }); } }
  function txBuyScan() { var b = curB(), t = txState(); if (!b || !t || !BUY_KEYS[t.key] || busy) return Promise.resolve();
    if (!hasDom() && !PS._autoClear) return Promise.resolve();
    if (!t._psClears) txBuyInit(b, t);
    var S = txBuySigs(t), it = Object.keys(S.sig).filter(function (x) { return S.qty[x] > 0 && t._psSig[x] !== S.sig[x] && invRec(b, x); })[0];
    if (!it) return Promise.resolve(); t._psSig[it] = S.sig[it];
    var list = openFor(b, it, t.key, t.mode === 'edit' && t.id != null ? { key: t.key, id: t.id } : null); if (!list.length) return txBuyScan();
    busy = true; var preset = t._psClears.filter(function (c) { return c.item === it; });
    return askClear(b, it, list, { qty: S.qty[it], supplier: t.supplier || '', preset: preset, key: t.key }).then(function (sel) { busy = false;
      if (sel != null) { t._psClears = t._psClears.filter(function (c) { return c.item !== it; }).concat(sel.map(function (c) { return { pid: c.pid, item: it, qty: c.qty }; })); t._psTouched = true; }
      return txBuyScan(); }, function (e) { busy = false; throw e; }); }
  function installTxn() {
    var TF = G.TxnForms; if (!TF || TF.__ps) return; TF.__ps = 1;
    TF.ext = TF.ext || { cols: [], onAccount: [], onDraw: [] }; TF.ext.cols = TF.ext.cols || []; TF.ext.onDraw = TF.ext.onDraw || [];
    TF.ext.cols.push({ id: 'pendingStock', th: '', show: function () { return false; },
      /* the choice travels with an edited invoice; a clone / copy is asked afresh */
      load: function (tl, ln, b, t) { if (t && t.mode === 'edit' && ln && ln.pending && typeof ln.pending === 'object') tl.pending = clone(ln.pending); },
      save: function (l, o) { var p = l.pending; if (p && p.item === o.item && r6(num(p.qty)) === r6(num(o.qty))) o.pending = clone(p); } });
    TF.ext.onDraw.push(function (b, t) { if (t && BUY_KEYS[t.key]) { txBuyScan(); return; } if (!t || t.key !== 'salesInv') return; try { txBadges(b, t); } catch (e) {}
      txWire(); if (hasDom()) txSchedule(); });
    /* the native Purchase Invoice keeps the pending sales it clears (header field, like the designed form) */
    TF.ext.onSave = TF.ext.onSave || [];
    TF.ext.onSave.push(function (b, t, rec) { if (!t || !BUY_KEYS[t.key] || !t._psTouched) return;
      var have = {}; (rec.lines || []).forEach(function (ln) { if (ln && ln.item && num(ln.qty) > 0) have[ln.item] = 1; });
      rec.pendingClears = (t._psClears || []).filter(function (c) { return c && have[c.item] && num(c.qty) > 0; }); });
    /* mount() draws the form without the onDraw hooks, and a qty / date / location change does not redraw
       it: the listener has to be there from the start (an invoice opened to edit is changed with no redraw) */
    var mount = TF.mount;
    if (typeof mount === 'function') TF.mount = function () { var r = mount.apply(this, arguments);
      try { var t = txState(); if (t && t.key === 'salesInv') { txWire(); txBadges(curB(), t); } if (t && BUY_KEYS[t.key]) txBuyInit(curB(), t); } catch (e) {} return r; };
    var origSave = TF.save;
    TF.save = function (act, opts) { var t = txState(), b = curB(), self = this, args = arguments;
      if (!t || !b || t.key !== 'salesInv') return origSave.apply(this, args);
      var mode = cfg(b).oversell, S = shortages(b, 'salesInv', txDoc(t, true));
      var todo = S.filter(function (s) { return !resolved(t.lines[s.i], s, mode); });
      if (mode === 'block' && todo.length) { var E = todo.map(function (s) { return 'Not enough stock: ' + s.item + ' — available ' + qstr(s.available) + ', this sale ' + qstr(s.qty) + ', short ' + qstr(s.short) + '.'; });
        E.push('Selling more than is in stock is blocked (Settings → Inventory).');
        var box = byId('txErr'); if (box) box.innerHTML = '<div class="tf-errbox" role="alert">' + E.map(esc).join('<br>') + '</div>';
        return { errors: E }; }
      if (!todo.length) { tidy(b, t.lines, S); return origSave.apply(this, args); }
      if (!hasDom()) { var stop = false; todo.forEach(function (s) { var l = t.lines[s.i]; var res = PS._auto ? PS._auto(s, { key: 'salesInv', mode: mode }) : (mode === 'warn' ? { warned: 1 } : { term: 'purchase' });
          if (!res || res.cancel) { stop = true; return; } if (res.warned) { l._psWarn = sig(l.item, s.qty); return; } l.pending = pendingFrom(l.item, s, res, l.pending); });
        if (stop) return { cancelled: true };
        tidy(b, t.lines, S); return origSave.apply(this, args); }
      txCheck(true).then(function (ok) { if (ok && txState() === t) origSave.apply(self, args); });
      return { pending: true }; };
  }

  /* ================================================================ designer forms */
  var DC = null;   // the designed form being edited: {key, editId, copiedFrom, clears, touched}
  function dHost() { return byId('deHost'); }
  function dRows(host) { var t = host && host.querySelector('[data-line-items]'); return (t && t.tBodies && t.tBodies[0]) ? Array.prototype.slice.call(t.tBodies[0].rows) : []; }
  function dVal(root, sel) { var el = root && root.querySelector(sel); return el ? String(el.value == null ? '' : el.value) : ''; }
  function dItem(tr) { return dVal(tr, '[data-var="items"]') || dVal(tr, '[data-var="item"]'); }
  function dQty(tr) { var v = dVal(tr, '[data-var="qty"]'); return blank(v) ? 0 : num(v); }
  function dDoc(host) { return { id: DC && DC.editId, date: dVal(host, '[data-field-var="date"]') || dVal(host, '[data-field-var="issueDate"]') || today(), customer: dVal(host, '[data-field-var="custName"]'),
    fromLocation: dVal(host, '[data-field-var="fromLocation"]'), location: dVal(host, '[data-field-var="location"]'), copiedFrom: DC && DC.copiedFrom,
    lines: dRows(host).map(function (tr) { return { item: dItem(tr), qty: dQty(tr) }; }) }; }
  /** the rows the designer turns into saved lines (rows with any value), in order */
  function usedRows(host) { return dRows(host).filter(function (tr) { var any = false;
    tr.querySelectorAll('[data-var]').forEach(function (el) { var v = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value; if (String(v == null ? '' : v).trim() !== '') any = true; }); return any; }); }
  function dRowLines(host) { return dRows(host).map(function (tr) { return { item: dItem(tr), qty: dQty(tr), pending: tr._psPending, _psPending: tr._psPending, _psWarn: tr._psWarn, _psSkip: tr._psSkip, tr: tr }; }); }
  function dBadges() { var host = dHost(), b = curB(); if (!host || !b || !DC) return; var idx = pendingIndex(b, BUY_KEYS[DC.key] ? { exclude: { key: DC.key, id: DC.editId } } : null);
    dRows(host).forEach(function (tr) { var old = tr.querySelector('.ps-badges'); if (old) old.remove(); var it = dItem(tr), html = '';
      if (SALE_KEYS[DC.key]) { var p = tr._psPending; if (p && p.item === it) { var e = idx.byPid[p.pid]; html = badgeHtml(e && r6(e.short) === r6(p.short) ? e : p); } }
      else { var mine = (DC.clears || []).filter(function (c) { return c.item === it; }); if (mine.length && it) { var q = mine.reduce(function (s, c) { return s + num(c.qty); }, 0);
        html = chip('ps-ok', (DC.key === 'goodsRec' ? '📦 Receives ' : '✓ Clears ') + esc(qstr(q)) + ' pending — ' + mine.length + ' sale' + (mine.length > 1 ? 's' : '')); } }
      if (!html) return; var sel = tr.querySelector('[data-var="items"]') || tr.querySelector('[data-var]'); var cell = sel && sel.closest ? sel.closest('td') : null; if (!cell) return;
      var box = G.document.createElement('div'); box.className = 'ps-badges'; box.setAttribute('data-noprint', ''); box.innerHTML = html; cell.appendChild(box); });
    /* a delivery note copied from an invoice: the invoice tracks the shortage */
    var info = host.querySelector('.ps-dn-info'); if (info) info.remove();
    if (DC.key === 'deliveryNotes' && DC.copiedFrom && DC.copiedFrom.key === 'salesInv') { var si = recs(b, 'salesInv').filter(function (r) { return r && String(r.id) === String(DC.copiedFrom.id); })[0];
      if (si && (si.lines || []).some(function (ln) { return pendOfLine(ln); })) { var d = G.document.createElement('div'); d.className = 'ps-dn-info'; d.setAttribute('data-noprint', '');
        d.innerHTML = chip('ps-info', 'Stock shortage is tracked on ' + docLink('salesInv', si.id, 'Sales Invoice ' + (si.reference || ''))); var tb = host.querySelector('[data-line-items]'); if (tb && tb.parentNode) tb.parentNode.insertBefore(d, tb); } } }
  function dCheck(force) { var host = dHost(), b = curB(); if (!host || !b || !DC || !SALE_KEYS[DC.key] || busy) return Promise.resolve(true);
    var key = DC.key, mode = cfg(b).oversell, S = shortages(b, key, dDoc(host)), L = dRowLines(host);
    tidy(b, L, S); L.forEach(function (l) { l.tr._psPending = l._psPending; });
    var todo = S.filter(function (s) { var l = L[s.i]; if (resolved(l, s, mode)) return false; return force || l._psSkip !== sig(l.item, s.qty); });
    if (!todo.length) { dBadges(); return Promise.resolve(mode !== 'block' || !S.length); }
    busy = true; var ok = true;
    return todo.reduce(function (p, s) { return p.then(function () { var l = L[s.i]; if (!ok) return;
      return askShort(b, s, { key: key, mode: mode, prev: l.tr._psPending }).then(function (res) {
        if (res.cancel) { ok = false; l.tr._psSkip = sig(l.item, s.qty); var q = l.tr.querySelector('[data-var="qty"]'); if (q) setTimeout(function () { try { q.focus(); q.select && q.select(); } catch (e) {} }, 30); return; }
        if (res.warned) { l.tr._psWarn = sig(l.item, s.qty); return; }
        l.tr._psPending = pendingFrom(l.item, s, res, l.tr._psPending); delete l.tr._psSkip; }); }); }, Promise.resolve())
      .then(function () { busy = false; dBadges(); return ok && mode !== 'block'; }, function (e) { busy = false; throw e; }); }
  function dPurchase(tr, force) { var host = dHost(), b = curB(); if (!host || !b || !DC || !BUY_KEYS[DC.key] || busy) return Promise.resolve();
    var it = dItem(tr); if (!it || !invRec(b, it)) return Promise.resolve();
    var qty = 0; dRows(host).forEach(function (r) { if (dItem(r) === it) qty += dQty(r); }); if (!(qty > 0)) return Promise.resolve();
    var sg = sig(it, qty); if (!force && tr._psSig === sg) return Promise.resolve(); tr._psSig = sg;
    var list = openFor(b, it, DC.key, DC.editId != null ? { key: DC.key, id: DC.editId } : null); if (!list.length) return Promise.resolve();
    busy = true;
    var supplier = dVal(host, '[data-field-var="supName"]');
    var preset = (DC.clears || []).filter(function (c) { return c.item === it; });
    return askClear(b, it, list, { qty: qty, supplier: supplier, preset: preset, key: DC.key }).then(function (sel) { busy = false; if (sel == null) return;
      DC.clears = (DC.clears || []).filter(function (c) { return c.item !== it; }).concat(sel.map(function (c) { return { pid: c.pid, item: it, qty: c.qty }; }));
      DC.touched = true; dBadges(); }, function (e) { busy = false; throw e; }); }
  function dMount(key, pf, editId) {
    DC = null; if (!SALE_KEYS[key] && !BUY_KEYS[key]) return;
    var host = dHost(), b = curB(); if (!host || !b) return;
    var rec = editId != null ? recs(b, key).filter(function (r) { return r && r.id === editId; })[0] || null : null;
    DC = { key: key, editId: rec ? rec.id : null, copiedFrom: (rec && rec.copiedFrom) || (pf && pf.copiedFrom) || null, clears: clone((rec && rec.pendingClears) || []), touched: false };
    var rows = dRows(host);
    if (rec) { var lines = (App._linesForEdit ? App._linesForEdit(key, rec) : rec.lines) || [];
      rows.forEach(function (tr, i) { var ln = lines[i]; if (SALE_KEYS[key] && ln && ln.pending && typeof ln.pending === 'object') tr._psPending = clone(ln.pending);
        if (BUY_KEYS[key]) { var it = dItem(tr); if (it) { var q = 0; rows.forEach(function (r) { if (dItem(r) === it) q += dQty(r); }); tr._psSig = sig(it, q); } } }); }
    if (!host._psWired) { host._psWired = 1;
      /* the user's changes only, not the values the designer restores when a record opens. An item picked from
         the searchable list (js/quick-create.js) arrives as a script event marked userPick. */
      host.addEventListener('change', function (e) { if (!(e.isTrusted || e.userPick) || !DC) return; var el = e.target; if (!el || !el.matches) return;
        var tr = el.closest && el.closest('[data-line-items] tbody tr'), ITEM = '[data-var="items"],[data-var="item"],[data-item-select]';
        if (SALE_KEYS[DC.key]) { if (el.matches('[data-var="qty"],' + ITEM + ',[data-field-var="date"],[data-field-var="issueDate"],[data-field-var="location"],[data-field-var="fromLocation"],[data-field-var="custName"]')) setTimeout(function () { dCheck(false); }, 30); }
        else if (tr && el.matches('[data-var="qty"],' + ITEM)) setTimeout(function () { dPurchase(tr, false); }, 30); }, true);
      host.addEventListener('click', function (e) { var t = e.target; if (t && t.closest && t.closest('[data-ff-act]')) setTimeout(dBadges, 0); }); }
    dBadges();
  }
  function installDesigned() {
    wrap('_mountDesignedForm', function (orig, args) { var key = args[0], pf = this._prefill, editId = this.editingId; var r = orig.apply(this, args);
      try { dMount(key, pf, editId); } catch (e) { if (G.console) console.warn('pending-stock mount', e); } return r; });
    wrap('saveDesignedRecord', function (orig, args) { var key = args[0], self = this, b = this.curBiz(), host = dHost();
      if (!DC || DC.key !== key || !SALE_KEYS[key] || !b || !host) return orig.apply(this, args);
      var mode = cfg(b).oversell, S = shortages(b, key, dDoc(host)), L = dRowLines(host);
      var todo = S.filter(function (s) { return !resolved(L[s.i], s, mode); });
      if (mode === 'block' && todo.length) { var msg = todo.map(function (s) { return 'Not enough stock: ' + s.item + ' — available ' + qstr(s.available) + ', this document ' + qstr(s.qty) + ', short ' + qstr(s.short) + '.'; }).join('\n') +
          '\n\nTaking out more than is in stock is blocked (Settings → Inventory).';
        if (G.UIModal) UIModal.alert(msg, { title: 'Not enough stock' }); else alert(msg); return; }
      if (!todo.length || !hasDom()) { var stop = false; if (!hasDom()) todo.forEach(function (s) { var tr = L[s.i].tr; var res = PS._auto ? PS._auto(s, { key: key, mode: mode }) : (mode === 'warn' ? { warned: 1 } : { term: moveKind(key) ? 'correction' : 'purchase' });
          if (!res || res.cancel) { stop = true; return; } if (res.warned) { tr._psWarn = sig(L[s.i].item, s.qty); return; } L[s.i]._psPending = tr._psPending = pendingFrom(L[s.i].item, s, res, tr._psPending); });
        if (stop) return;
        tidy(b, L, S); L.forEach(function (l) { l.tr._psPending = l._psPending; }); return orig.apply(this, args); }
      dCheck(true).then(function (ok) { if (ok && DC && DC.key === key) orig.apply(self, args); }); });
    wrap('_applyDesignedToNative', function (orig, args) { var key = args[0], rec = args[1]; var r = orig.apply(this, args);
      try { var host = dHost(); if (DC && DC.key === key && rec && host) {
        if (SALE_KEYS[key] && Array.isArray(rec.lines)) { var used = usedRows(host);
          rec.lines.forEach(function (ln, k) { var tr = used[k], p = tr && tr._psPending; var it = ln && (ln.item || ln.items);
            if (p && p.item === it && r6(num(p.qty)) === r6(num(ln.qty))) ln.pending = clone(p); else if (ln) delete ln.pending; }); }
        if (!rec.copiedFrom && DC.copiedFrom && DC.editId == null) rec.copiedFrom = clone(DC.copiedFrom);
        if (BUY_KEYS[key] && DC.touched) { var have = {}; (rec.lines || []).forEach(function (ln) { var it = ln && (ln.item || ln.items); if (it && num(ln.qty) > 0) have[it] = 1; });
          rec.pendingClears = (DC.clears || []).filter(function (c) { return c && have[c.item] && num(c.qty) > 0; }); }
      } } catch (e) { if (G.console) console.warn('pending-stock save', e); }
      return r; });
  }

  /* ================================================================ view panel / print */
  function curKey() { try { return LABEL2KEY[App.wsSection]; } catch (e) { return null; } }
  function panelHtml(b, key, rec, plain) { if (!rec || (!SALE_KEYS[key] && !BUY_KEYS[key])) return '';
    var idx = pendingIndex(b), items = [];
    if (SALE_KEYS[key]) {
      (rec.lines || []).forEach(function (ln, i) { var p = pendOfLine(ln); if (!p) return; var e = idx.byPid[p.pid] || p;
        items.push('<li><span class="ps-ln">Line ' + (i + 1) + ' · ' + esc(ln.item || ln.items || p.item) + ' · qty ' + esc(qstr(ln.qty)) + '</span>' + badgeHtml(e, { plain: plain }) + '</li>'); });
      if (!items.length && key === 'deliveryNotes' && rec.copiedFrom && rec.copiedFrom.key === 'salesInv') {
        var si = recs(b, 'salesInv').filter(function (r) { return r && String(r.id) === String(rec.copiedFrom.id); })[0];
        if (si && (si.lines || []).some(function (ln) { return pendOfLine(ln); })) items.push('<li>' + chip('ps-info', 'Stock shortage tracked on ' + (plain ? esc('Sales Invoice ' + (si.reference || '')) : docLink('salesInv', si.id, 'Sales Invoice ' + (si.reference || '')))) + '</li>'); }
    } else {
      idx.list.forEach(function (e) { e.clears.forEach(function (c) { if (c.key !== key || String(c.id) !== String(rec.id)) return;
        items.push('<li><span class="ps-ln">' + esc(qstr(c.qty)) + ' × ' + esc(e.item) + '</span>' + chip('ps-ok', (key === 'goodsRec' ? '📦 Received for ' : '✓ Clears ') +
          (plain ? esc(DOC[e.key] + ' ' + e.ref) : docLink(e.key, e.id, DOC[e.key] + ' ' + e.ref)) + (e.party ? ' — ' + esc(e.party) : '') + ' (' + esc(fmtD(e.date)) + ')') + '</li>'); }); });
      if (items.length && key === 'purchInv') items.push('<li class="ps-hint">The cost of sales of these quantities is taken at this purchase’s unit cost, dated ' + esc(fmtD(day(rec.issueDate || rec.date))) + ' or the sale date if later.</li>');
    }
    if (!items.length) return '';
    return '<div class="ps-panel' + (plain ? ' ps-print' : '') + '"' + (plain ? '' : ' data-noprint') + '><div class="ps-panel-h">' + (SALE_KEYS[key] ? 'Stock — pending purchases' : 'Pending sales cleared') + '</div><ul>' + items.join('') + '</ul></div>'; }
  function installView() {
    wrap('viewHtml', function (orig, args) { var html = orig.apply(this, args), key = curKey();
      try { if (typeof html !== 'string' || (!SALE_KEYS[key] && !BUY_KEYS[key])) return html; var b = args[0] || curB();
        var rec = (this.records(b) || []).filter(function (r) { return r.id === App.editingId; })[0]; var p = panelHtml(b, key, rec, false); if (!p) return html;
        var at = html.indexOf('<div class="doc-foot">'); if (at < 0) at = html.lastIndexOf('<div class="form-actions">');
        return at < 0 ? html + p : html.slice(0, at) + p + html.slice(at); } catch (e) { return html; } });
    /* the badge reaches printed documents / PDFs only when Settings -> Inventory says so */
    wrap('_printDoc', function (orig, args) { var b = args[0], rec = args[2], key = curKey(), self = this;
      if (!b || !cfg(b).printBadges || (!SALE_KEYS[key] && !BUY_KEYS[key])) return orig.apply(this, args);
      var p = panelHtml(b, key, rec, true); if (!p) return orig.apply(this, args);
      var vd = this.voucherDoc; this.voucherDoc = function () { return vd.apply(self, arguments) + p; };
      try { return orig.apply(this, args); } finally { this.voucherDoc = vd; } });
  }

  /* ================================================================ report */
  var REP = { show: 'open' };
  function openDoc(key, id) { var b = curB(); if (!b) return; var r = recs(b, key).filter(function (x) { return x && String(x.id) === String(id); })[0];
    if (!r) { if (G.UIModal) UIModal.toast('That document no longer exists'); return; }
    try { App.recReturn = App._snapNav ? App._snapNav() : null; } catch (e) {}
    App.gotoRecord(key, r.id); }
  function openReport() { try { App.selectSection('Reports'); } catch (e) {} App.repView = 'pendstock'; App.repMode = 'list'; App.repInst = null; App.renderMain(App.curBiz()); }
  function reportHtml(b) {
    var idx = pendingIndex(b), all = idx.list, open = all.filter(function (e) { return e.open > 1e-9; });
    var rows = REP.show === 'all' ? all : open;
    var by = {}; open.forEach(function (e) { var g = by[e.item] = by[e.item] || { item: e.item, qty: 0, oldest: e.date, docs: [], sups: {} };
      g.qty = r6(g.qty + e.open); if (e.date && (!g.oldest || e.date < g.oldest)) g.oldest = e.date; g.docs.push(e); if (e.supplier) g.sups[e.supplier] = 1; });
    var groups = Object.keys(by).sort().map(function (k) { return by[k]; }), est = 0;
    var sum = groups.map(function (g) { var c = lastCost(b, g.item), v = r6(c * g.qty); est += v;
      return '<tr><td>' + esc(g.item) + '</td><td class="r">' + esc(qstr(g.qty)) + '</td><td class="ps-nw">' + esc(fmtD(g.oldest)) + '</td><td>' +
        g.docs.map(function (e) { return docLink(e.key, e.id, DOC[e.key] + ' ' + e.ref); }).join(', ') + '</td><td>' + esc(Object.keys(g.sups).join(', ')) + '</td>' +
        '<td class="r" title="Estimate at the last known cost — not posted">' + money(v) + ' <span class="ps-flag">est.</span></td></tr>'; }).join('');
    var det = rows.map(function (e) { var st = e.tracked ? 'Counted on Sales Invoice ' + e.tracked.ref : (e.open <= 1e-9 ? 'Cleared' : (e.cleared > 0 ? 'Partly cleared' : (e.received > 0 ? 'Received, awaiting purchase invoice' : 'Pending')));
      return '<tr><td class="ps-nw">' + esc(fmtD(e.date)) + '</td><td>' + docLink(e.key, e.id, DOC[e.key] + ' ' + e.ref) + '</td><td>' + esc(e.party) + '</td><td>' + esc(e.item) + '</td>' +
        '<td class="r">' + esc(qstr(e.short)) + '</td><td class="r">' + esc(qstr(e.cleared)) + '</td><td class="r"><b>' + esc(qstr(e.open)) + '</b></td><td>' + esc(TERM_SHORT[e.term] || '') + '</td>' +
        '<td>' + esc(e.supplier) + '</td><td class="ps-nw">' + esc(fmtD(e.expected)) + '</td><td>' + esc(st) + (e.clears.length ? '<div class="ps-sub">' +
          e.clears.map(function (c) { return docLink(c.key, c.id, DOC[c.key] + ' ' + c.ref) + ' ×' + esc(qstr(c.qty)); }).join(', ') + '</div>' : '') + '</td>' +
        '<td data-noprint>' + (e.open > 1e-9 ? '<button type="button" class="btn btn-xs" onclick="PendingStock.clearFromReport(' + esc(JSON.stringify(e.pid)) + ')">Clear…</button>' : '') + '</td></tr>'; }).join('');
    var crumb = ''; try { crumb = App._repCrumb('pendstock'); } catch (e) { crumb = ''; }
    return crumb + '<div class="card ps-rep"><div class="ps-rep-h"><h2>Pending purchases</h2>' +
      '<div class="ps-rep-tools" data-noprint><div class="ps-seg" role="group" aria-label="Show">' +
        '<button type="button" class="btn btn-xs' + (REP.show !== 'all' ? ' on' : '') + '" onclick="PendingStock.repShow(\'open\')">Open</button>' +
        '<button type="button" class="btn btn-xs' + (REP.show === 'all' ? ' on' : '') + '" onclick="PendingStock.repShow(\'all\')">All</button></div>' +
        '<button type="button" class="btn btn-xs" onclick="App.reportPrint()">Print</button></div></div>' +
      '<div id="repDoc"><p class="ps-lead">Inventory sold before it was purchased. The cost of sales of an open quantity is posted when a purchase invoice clears it' +
        ' (at that purchase’s unit cost). Estimates use the last known cost and are not posted.</p>' +
      '<h3 class="ps-h3">By item</h3><div class="ps-tw"><table class="ps-tbl"><thead><tr><th>Item</th><th class="r">Qty pending purchase</th><th>Oldest</th><th>Documents</th><th>Expected supplier</th><th class="r">Est. cost</th></tr></thead><tbody>' +
        (sum || '<tr><td colspan="6" class="ps-empty">Nothing is waiting for a purchase.</td></tr>') + '</tbody>' +
        (groups.length ? '<tfoot><tr><td>Total</td><td class="r">' + esc(qstr(groups.reduce(function (s, g) { return s + g.qty; }, 0))) + '</td><td colspan="3"></td><td class="r">' + money(est) + '</td></tr></tfoot>' : '') + '</table></div>' +
      '<h3 class="ps-h3">Documents</h3><div class="ps-tw"><table class="ps-tbl"><thead><tr><th>Date</th><th>Document</th><th>Customer</th><th>Item</th><th class="r">Short</th><th class="r">Cleared</th><th class="r">Open</th><th>Term</th><th>Expected supplier</th><th>Expected</th><th>Status</th><th data-noprint></th></tr></thead><tbody>' +
        (det || '<tr><td colspan="12" class="ps-empty">' + (REP.show === 'all' ? 'No document was sold short.' : 'No open pending purchases.') + '</td></tr>') + '</tbody></table></div></div>' +
      '<div class="form-actions"><button class="btn" onclick="App.reportsBack()">Back to Reports</button></div></div>'; }
  /** purchase invoices of an item with quantity left to clear (not already linked to other sales) */
  function purchasesWithRoom(b, item) { var out = [];
    recs(b, 'purchInv').forEach(function (d) { if (!d) return; var q = 0; (d.lines || []).forEach(function (ln) { if (ln && (ln.item || ln.items) === item) q += num(ln.qty); }); if (!(q > 0)) return;
      var used = (d.pendingClears || []).reduce(function (s, c) { return s + (c && c.item === item ? num(c.qty) : 0); }, 0);
      var room = r6(q - used); if (room > 1e-9) out.push({ d: d, room: room }); });
    return out.sort(function (x, y) { return String(day(y.d.issueDate || y.d.date)).localeCompare(String(day(x.d.issueDate || x.d.date))); }); }
  /** add a clearance link to a purchase invoice (from the report) */
  function addClear(b, purchId, pid, qty) { var d = recs(b, 'purchInv').filter(function (x) { return x && String(x.id) === String(purchId); })[0]; var e = pendingIndex(b).byPid[pid];
    if (!d || !e) return false; d.pendingClears = (d.pendingClears || []).slice();
    var ex = d.pendingClears.filter(function (c) { return c && c.pid === pid; })[0]; if (ex) ex.qty = r6(num(ex.qty) + num(qty)); else d.pendingClears.push({ pid: pid, item: e.item, qty: r6(num(qty)) });
    return true; }
  function clearFromReport(pid) { var b = curB(); if (!b) return; if (App.guardWrite && !App.guardWrite(b)) return;
    var e = pendingIndex(b).byPid[pid]; if (!e || e.open <= 0) return;
    var list = purchasesWithRoom(b, e.item);
    if (!list.length) { UIModal.alert('No purchase invoice of ' + e.item + ' has quantity left to clear this sale. Enter the purchase invoice first — its form lists this sale.', { title: 'Clear pending purchase' }); return; }
    var body = '<div class="ps-short"><div class="ps-item">' + esc(e.item) + '</div><div class="ps-nums"><span>' + esc(DOC[e.key] + ' ' + e.ref) + '</span><span>' + esc(e.party) + '</span><span class="ps-neg">Open <b>' + esc(qstr(e.open)) + '</b></span></div></div>' +
      '<label class="ps-f ps-f-w"><span>Purchase invoice</span><select data-ps="pi">' + list.map(function (x) { var d = x.d;
        return '<option value="' + esc(d.id) + '" data-room="' + x.room + '">' + esc((d.reference || '') + ' · ' + fmtD(day(d.issueDate || d.date)) + ' · ' + (d.supplier || d.supName || '') + ' · ' + qstr(x.room) + ' available') + '</option>'; }).join('') + '</select></label>' +
      '<label class="ps-f"><span>Qty to clear</span><input type="text" inputmode="decimal" data-ps="qty" value="' + esc(qstr(Math.min(e.open, list[0].room))) + '"></label>';
    dialog('Clear pending purchase', body, [{ v: 'cancel', text: 'Cancel' }, { v: 'ok', text: 'Clear', cls: 'btn-primary' }], { enter: 'ok' }).then(function (r) { if (r.v !== 'ok') return;
      var sel = r.ov.querySelector('[data-ps="pi"]'), opt = sel.options[sel.selectedIndex]; var q = r6(Math.min(num(r.ov.querySelector('[data-ps="qty"]').value), e.open, num(opt.getAttribute('data-room'))));
      if (!(q > 0)) return; var bb = App.curBiz(); if (!addClear(bb, sel.value, pid, q)) return;
      try { refreshSummary(bb); } catch (er) {} App.saveBiz(bb); try { UIModal.toast('Cleared ' + qstr(q) + ' × ' + e.item); } catch (er) {} App.renderMain(App.curBiz()); }); }
  function installReport() {
    try { App._REPDEF.pendstock = { name: 'Pending purchases' }; } catch (e) {}
    wrap('reportsHtml', function (orig, args) { var b = args[0] || curB();
      if (this.repView === 'pendstock') return reportHtml(b);
      var html = orig.apply(this, args);
      if (typeof html === 'string' && html.indexOf('pendstock') < 0) html = html.replace('>Inventory Price List</a>', '>Inventory Price List</a><a class="rep-link" onclick="App.openReport(\'pendstock\')">Pending purchases</a>');
      return html; });
    /* Inventory Items: a "Qty pending purchase" column and a link to the report */
    try { var c = REG.inventory; if (c && !(c.columns || []).some(function (x) { return x.key === 'qtyPending'; })) {
      var col = { key: 'qtyPending', label: 'Qty pending purchase', kind: 'text', r: 1, calc: function (r) { var q = openQtyByItem(App.curBiz())[r && r.name]; return q ? qstr(q) : ''; } };
      var at = c.columns.findIndex(function (x) { return x.key === 'qtyHand'; }); if (at < 0) c.columns.push(col); else c.columns.splice(at + 1, 0, col);
      if (Array.isArray(c.defaultCols) && c.defaultCols.indexOf('qtyPending') < 0) c.defaultCols.push('qtyPending'); } } catch (e) {}
    wrap('listHtml', function (orig, args) { var html = orig.apply(this, args);
      try { if (curKey() !== 'inventory' || typeof html !== 'string') return html; var b = args[0] || curB(), q = openQtyByItem(b), n = Object.keys(q).length;
        var bar = '<div class="ps-listbar" data-noprint>' + (n ? chip('ps-warn', '⏳ ' + n + ' item' + (n > 1 ? 's' : '') + ' sold awaiting purchase') : '') +
          '<a class="ps-link" onclick="PendingStock.openReport()">Pending purchases report</a></div>';
        var at = html.indexOf('<div id="regBody">'); return at < 0 ? html : html.slice(0, at) + bar + html.slice(at); } catch (e) { return html; } });
  }

  /* ================================================================ settings */
  function settingsHtml(b) { var s = cfg(b);
    var opt = function (v, t, d) { return '<label class="ps-opt ps-set"><input type="radio" name="psOversell" value="' + v + '"' + (s.oversell === v ? ' checked' : '') + '><span><b>' + esc(t) + '</b><small>' + esc(d) + '</small></span></label>'; };
    var inner = '<div class="ps-settings"><h3 class="ps-h3">Selling more than in stock</h3><div class="ps-opts" role="radiogroup" aria-label="Selling more than in stock">' +
      opt('pending', 'Allow with pending purchase (default)', 'Ask how the shortage will be settled, track it until a purchase clears it, and take its cost of sales from that purchase.') +
      opt('warn', 'Warn only (no tracking)', 'Show a warning; the item goes negative and the cost of sales uses the average cost as before.') +
      opt('block', 'Block', 'A document that takes out more than is in stock cannot be saved.') + '</div>' +
      '<label class="ps-chk ps-set-chk"><input type="checkbox" id="psPrintBadges"' + (s.printBadges ? ' checked' : '') + '> Show the “Pending purchase” badges on printed documents and PDFs</label>' +
      '<p class="ps-note"><a class="ps-link" onclick="PendingStock.openReport()">Open the Pending purchases report</a></p></div>';
    try { return App.setCard('Inventory', inner, 'PendingStock.saveSettings()'); } catch (e) { return inner; } }
  function saveSettings(vals) { var b = curB(); if (!b) return; if (App.guardWrite && !App.guardWrite(b)) return;
    if (!vals) { var d = G.document; var r = d.querySelector('input[name="psOversell"]:checked'), pb = d.getElementById('psPrintBadges'); vals = { oversell: r ? r.value : 'pending', printBadges: !!(pb && pb.checked) }; }
    b.inventorySettings = Object.assign({}, b.inventorySettings || {}, { oversell: (vals.oversell === 'warn' || vals.oversell === 'block') ? vals.oversell : 'pending', printBadges: !!vals.printBadges });
    App.saveBiz(b); try { UIModal.toast('Inventory settings saved'); } catch (e) {}
    if (hasDom()) { try { App.settingsBack(); } catch (e) {} } }
  function installSettings() {
    wrap('setTiles', function (orig, args) { var t = orig.apply(this, args);
      if (!t.some(function (x) { return x[2] === 'inventorySettings'; })) { var row = ['box', 'Inventory', 'inventorySettings', 'Selling more than in stock, pending purchases', 1, 1];
        var at = t.findIndex(function (x) { return x[2] === 'locations'; }); if (at < 0) t.push(row); else t.splice(at, 0, row); }
      return t; });
    App.set_inventorySettings = function (b) { return settingsHtml(b); };
    if (G.ICO && G.ICO.forSetting && !G.ICO.forSetting.__ps) { var fs = G.ICO.forSetting;
      G.ICO.forSetting = function (key, size, cls) { return key === 'inventorySettings' ? this.get('box', size, cls) : fs.apply(this, arguments); }; G.ICO.forSetting.__ps = 1; }
  }

  /* ================================================================ reminders */
  function reminders(b) { var open = pendingIndex(b).list.filter(function (e) { return e.open > 1e-9; }); if (!open.length) return [];
    var items = {}, qty = 0, oldest = '', exp = ''; open.forEach(function (e) { items[e.item] = 1; qty += e.open; if (e.date && (!oldest || e.date < oldest)) oldest = e.date; if (e.expected && (!exp || e.expected < exp)) exp = e.expected; });
    var n = Object.keys(items).length, t = today();
    return [{ id: 'open', title: n + ' item' + (n > 1 ? 's' : '') + ' sold awaiting purchase', detail: qstr(qty) + ' short on ' + open.length + ' document line' + (open.length > 1 ? 's' : '') + (oldest ? ' · oldest ' + fmtD(oldest) : '') + (exp ? ' · expected ' + fmtD(exp) : ''),
      due: exp && exp < t ? exp : t, kind: 'inventory', severity: exp && exp < t ? 'overdue' : 'due', link: { section: 'Reports', open: openReport } }]; }
  function installReminders() { var R = G.Reminders; if (!R || typeof R.register !== 'function') return;
    try { if (R.defineKind) R.defineKind('inventory', { label: 'Inventory — pending purchases', lead: 7 }); } catch (e) {}
    R.register('pending-stock', reminders); }

  /* ------------------------------------------------------------------ public */
  var PS = G.PendingStock = {
    cfg: cfg, available: available, shortages: shortages, pendingIndex: pendingIndex, openFor: openFor, openQtyByItem: openQtyByItem,
    badgeHtml: badgeHtml, panelHtml: panelHtml, reportHtml: reportHtml, reminders: reminders, askShort: askShort, askClear: askClear,
    pendingFrom: pendingFrom, defaultPick: defaultPick, addClear: addClear, purchasesWithRoom: purchasesWithRoom, lastCost: lastCost,
    txCheck: txCheck, dCheck: dCheck, openDoc: openDoc, openReport: openReport, clearFromReport: clearFromReport, saveSettings: saveSettings, settingsHtml: settingsHtml,
    repShow: function (v) { REP.show = v === 'all' ? 'all' : 'open'; App.renderMain(App.curBiz()); },
    TERMS: TERMS, _auto: null, _autoClear: null, _dc: function () { return DC; }
  };
  App.openPendingReport = openReport;

  installTxn(); installDesigned(); installView(); installReport(); installSettings(); installReminders();
  /* the app draws its first page (a #hash reload) before this file loads: repaint the page types it adds to */
  if (hasDom()) setTimeout(function () { try { if (App.view === 'workspace' && App.openBiz != null && /^(view|list|reports|settings)$/.test(App.wsMode || '')) {
    var k = curKey(); if (App.wsMode === 'reports' || App.wsMode === 'settings' || SALE_KEYS[k] || BUY_KEYS[k] || k === 'inventory') App.renderMain(App.curBiz()); } } catch (e) {} }, 0);
})(typeof window !== 'undefined' ? window : globalThis);
