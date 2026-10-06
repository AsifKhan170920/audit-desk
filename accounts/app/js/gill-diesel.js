/* ===================== Gill Transport: Diesel =====================
   Daily diesel consumption (Date, Supplier, Truck No, Driver, Qty litres,
   Rate, Station/Ref, Description) kept Unbilled until the supplier's invoice
   arrives. Tick unbilled entries of one supplier -> "Create Purchase Invoice"
   opens a new Purchase Invoice prefilled (App._prefill, the Copy-to
   mechanism) with the supplier and one Fuel line for the summed litres.

   The link: while that form is open, the next Purchase Invoice the business
   saves is linked to the ticked entries (entry.invId = invoice id). Billed is
   never stored as a flag — an entry is Billed only while its invoice exists,
   so deleting the invoice (from anywhere) returns the entries to Unbilled,
   and cancelling the form leaves them untouched.
   Requires js/gill-trips.js (window.Gill). Registered as the custom module
   "diesel" (Settings -> Customisation), independent of Trips.
   ================================================================== */
(function (G) {
  'use strict';
  if (typeof App === 'undefined' || !G.Gill || G.Gill.pages.Diesel) return;
  var Gill = G.Gill, U = Gill.util, esc = U.esc;

  function invList(b) { return (b && b.records && b.records.purchInv) || []; }
  function findInv(b, id) { if (id == null || id === '') return null; return invList(b).find(function (x) { return String(x.id) === String(id); }) || null; }
  function supName(s) { return (s && (s.name || s.supName || s.supplier)) || ''; }

  var D = Gill.diesel = {
    invoiceOf: function (b, r) { return r && r.invId != null && r.invId !== '' ? findInv(b, r.invId) : null; },
    billed: function (b, r) { return !!D.invoiceOf(b, r); },
    /** clears links whose invoice no longer exists; true when something changed */
    reconcile: function (b) {
      var ch = false; ((b.gill && b.gill.diesel) || []).forEach(function (r) {
        if (r.invId != null && r.invId !== '' && !findInv(b, r.invId)) { delete r.invId; delete r.invRef; delete r.billedOn; ch = true; }
      });
      return ch;
    },
    /* unrounded: rounded once for display and once on the total, so the total matches the invoice */
    amount: function (r) { var q = Number(r.qty) || 0, rt = r.rate; return (rt === '' || rt == null) ? '' : q * (Number(rt) || 0); },
  };

  /* ------------------------------------------------------------------ Fuel account */
  D.fuelAccount = function (b) {
    var coa = b.coa = b.coa || [];
    var hit = coa.find(function (n) { return n.type === 'account' && /^(fuel|diesel)( (expenses?|costs?))?$/i.test(String(n.name || '').trim()); });
    if (hit) return hit;
    var rnd = function () { return Math.random().toString(36).slice(2, 9); };
    var expG = coa.find(function (n) { return n.type === 'group' && n.plkind === 'expense'; });
    if (!expG) {
      expG = { id: 'gExp' + rnd(), type: 'group', name: 'Expenses', code: '', parent: 'pl', plkind: 'expense' }; coa.push(expG);
      try { plInsertTop(b, expG.id); } catch (e) { b.coaTop = b.coaTop || { bs: ['assets', 'liabilities', 'equity'], pl: [] }; (b.coaTop.pl = b.coaTop.pl || []).push(expG.id); }
    }
    hit = { id: 'a' + rnd(), type: 'account', name: 'Fuel', code: '', parent: expG.id, balance: 0 };
    coa.push(hit); return hit;
  };

  /* ------------------------------------------------------------------ invoice prefill */
  /** Checks the chosen entries and builds the Purchase Invoice prefill. Pure apart from
      adding the Fuel account (and the supplier when opts.addSupplier) to b.
      -> {error} | {prefill, ids, supplier, qty, needSupplier} */
  D.buildInvoice = function (b, ids, opts) {
    opts = opts || {};
    var all = Gill.data(b).diesel, want = ids.map(String);
    var rows = all.filter(function (r) { return want.indexOf(String(r.id)) >= 0; });
    if (!rows.length) return { error: 'Tick the unbilled diesel entries the supplier’s invoice covers first.' };
    var billed = rows.filter(function (r) { return D.billed(b, r); });
    if (billed.length) return { error: billed.length + ' of the ticked entries ' + (billed.length === 1 ? 'is' : 'are') + ' already billed. Tick unbilled entries only.' };
    var sups = U.uniq(rows.map(function (r) { return r.supplier; }));
    if (rows.some(function (r) { return !String(r.supplier || '').trim(); })) return { error: 'Some ticked entries have no supplier. Fill in the Supplier column first.' };
    if (sups.length > 1) return { error: 'The ticked entries are from ' + sups.length + ' suppliers (' + sups.join(', ') + '). One purchase invoice covers one supplier — filter by supplier and tick again.' };
    var noQty = rows.filter(function (r) { return !(Number(r.qty) > 0); });
    if (noQty.length) return { error: noQty.length + ' ticked ' + (noQty.length === 1 ? 'entry has' : 'entries have') + ' no quantity.' };
    var name = sups[0], R = b.records = b.records || {};
    var sup = (R.suppliers || []).find(function (s) { return supName(s).toLowerCase() === name.toLowerCase(); });
    if (!sup && !opts.addSupplier) return { needSupplier: name };
    if (!sup) {
      sup = { supName: name, supplier: name, name: name, code: '', lines: [], id: Date.now(), uuid: App.uuid ? App.uuid() : String(Date.now()) };
      R.suppliers = (R.suppliers || []).concat([sup]);
    }
    name = supName(sup);
    var fuel = D.fuelAccount(b);
    var dates = rows.map(function (r) { return r.date || ''; }).filter(Boolean).sort();
    var qty = U.r3(rows.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0));
    var allRate = rows.every(function (r) { return r.rate !== '' && r.rate != null && !isNaN(Number(r.rate)); });
    var price = allRate ? Math.round(rows.reduce(function (s, r) { return s + Number(r.qty) * Number(r.rate); }, 0) / qty * 10000) / 10000 : '';
    var span = dates.length ? (U.ddmm(dates[0]) + (dates[dates.length - 1] !== dates[0] ? '–' + U.ddmm(dates[dates.length - 1]) : '')) : '';
    var desc = 'Diesel ' + span + ' (' + rows.length + ' ' + (rows.length === 1 ? 'entry' : 'entries') + ')';
    var today = U.todayIso();
    var line = { item: '', items: '', desc: desc, description: desc, account: fuel.id, accountName: fuel.name, accounts: fuel.name, qty: qty, price: price };
    if (price !== '') { line.amountNoTax = U.r2(qty * price); }
    var prefill = { date: today, issueDate: today, supplier: name, supName: name, description: desc, narration: desc, lines: [line] };
    return { prefill: prefill, ids: rows.map(function (r) { return r.id; }), supplier: name, qty: qty, desc: desc };
  };
  /** Opens the new Purchase Invoice form; Cancel / Save come back to Diesel. */
  D.openInvoice = function (b, res) {
    Gill._pending = { biz: b.id, ids: res.ids.map(String), before: invList(b).map(function (x) { return String(x.id); }) };
    App.recReturn = App._snapNav ? App._snapNav() : null;
    App._prefill = res.prefill; App.histReturn = false;
    App.wsSection = 'Purchase Invoices'; App.editingId = null; App.wsMode = 'form';
    App.renderWorkspace();
  };
  Gill.createInvoice = function (ids, addSupplier) {
    var b = U.curB(), p = Gill.pages.Diesel; if (!b) return;
    if (App.guardWrite && !App.guardWrite(b)) return;
    if (!ids) { var st = Gill.st('Diesel'); ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; }); }
    var res = D.buildInvoice(b, ids, { addSupplier: !!addSupplier });
    if (res.error) { UIModal.alert(res.error, { title: 'Create Purchase Invoice' }); return res; }
    if (res.needSupplier) {
      UIModal.confirm('“' + res.needSupplier + '” is not in Suppliers yet. Add it as a supplier and continue?', { title: 'Create Purchase Invoice', okText: 'Add supplier' })
        .then(function (ok) { if (ok) Gill.createInvoice(ids, true); });
      return res;
    }
    App.saveBiz(b);                   // Fuel account (and supplier) must exist before the form lists them
    Gill.st('Diesel').sel = {};
    D.openInvoice(App.curBiz(), res);
    return res;
  };
  Gill.openInvoice = function (id) {
    var b = U.curB(); if (!b || !findInv(b, id)) { U.toast('That purchase invoice no longer exists'); return; }
    var inv = findInv(b, id);
    App.recReturn = App._snapNav ? App._snapNav() : null;
    App.wsSection = 'Purchase Invoices'; App.editingId = inv.id; App.wsMode = 'view'; App.listQuery = '';
    App.renderWorkspace();
  };

  /* ------------------------------------------------------------------ the link, on save */
  /** the first Purchase Invoice saved while the prefilled form is open settles the ticked entries */
  D.linkPending = function (b) {
    var P = Gill._pending; if (!P || String(P.biz) !== String(b.id)) return 0;
    var inv = invList(b).find(function (x) { return P.before.indexOf(String(x.id)) < 0; });
    if (!inv) return 0;
    var n = 0, today = U.todayIso();
    Gill.data(b).diesel.forEach(function (r) {
      if (P.ids.indexOf(String(r.id)) < 0 || D.billed(b, r)) return;
      r.invId = inv.id; r.invRef = inv.reference || ''; r.billedOn = today; n++;
    });
    Gill._pending = null; Gill._justLinked = { n: n, ref: inv.reference || '' };
    return n;
  };
  var _save = App.saveBiz;
  App.saveBiz = function (b) {
    try { if (b && (b.gill || Gill._pending)) { if (b.gill) Gill.data(b); D.linkPending(b); D.reconcile(b); } } catch (e) { try { console.warn('gill link', e); } catch (_) {} }
    return _save.apply(this, arguments);
  };

  /* ------------------------------------------------------------------ the page */
  function statusOf(b, r) { var inv = D.invoiceOf(b, r); return inv ? { billed: true, inv: inv } : { billed: false }; }
  function selRows(b) {
    var st = Gill.st('Diesel');
    return Gill.data(b).diesel.filter(function (r) { return st.sel[r.id]; });
  }
  function selBar(b) {
    if (Gill.level(b, 'Diesel') < 2) {             // View only: the summary, no ticking / invoicing
      var all = Gill.visible(b, Gill.pages.Diesel).filter(function (r) { return !D.billed(b, r) && Number(r.qty) > 0; });
      return '<span class="gl-sb-txt">Unbilled in view: <b>' + all.length + '</b> ' + (all.length === 1 ? 'entry' : 'entries') + ' · <b>' + U.qtyFmt(all.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0)) + '</b> L.</span>';
    }
    var rows = selRows(b), unb = rows.filter(function (r) { return !D.billed(b, r); });
    var vis = Gill.visible(b, Gill.pages.Diesel), open = vis.filter(function (r) { return !D.billed(b, r) && Number(r.qty) > 0; });
    var openQty = open.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0);
    if (!rows.length) return '<span class="gl-sb-txt">Unbilled in view: <b>' + open.length + '</b> ' + (open.length === 1 ? 'entry' : 'entries') + ' · <b>' + U.qtyFmt(openQty) + '</b> L. ' +
      'When the supplier’s invoice arrives, tick its entries and create the purchase invoice.</span>' +
      (open.length ? '<button class="btn btn-xs" onclick="Gill.selAll(true)">Tick all unbilled shown</button>' : '');
    var qty = unb.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0), sups = U.uniq(unb.map(function (r) { return r.supplier; }));
    return '<span class="gl-sb-txt"><b>' + rows.length + '</b> ticked' + (rows.length !== unb.length ? ' (' + (rows.length - unb.length) + ' billed)' : '') +
      ' · <b>' + U.qtyFmt(qty) + '</b> L unbilled' + (sups.length ? ' · ' + esc(sups.join(', ')) : '') + '</span>' +
      '<button class="btn btn-xs" onclick="Gill.selAll(false)">Clear</button>' +
      '<button class="btn btn-primary btn-xs" onclick="Gill.createInvoice()"' + (unb.length ? '' : ' disabled') + '>Create Purchase Invoice</button>';
  }
  var qtyCol = { k: 'qty', label: 'Qty (litres)', t: 'num', total: 1, dec: 3, alias: ['Qty', 'Litres', 'Liters', 'Quantity'] };
  Gill.pages.Diesel = {
    label: 'Diesel', store: 'diesel', noun: 'entries', noun1: 'entry',
    cols: [
      { k: 'date', label: 'Date', t: 'date' },
      { k: 'supplier', label: 'Supplier', t: 'text', pick: 'supplier' },
      { k: 'truck', label: 'Truck No', t: 'text', pick: 'truck', alias: ['Truck', 'Vehicle'] },
      { k: 'driver', label: 'Driver', t: 'text', pick: 'driver', alias: ['Driver Name'] },
      qtyCol,
      { k: 'rate', label: 'Rate', t: 'num', alias: ['Price', 'Rate per litre'] },
      { k: 'amount', label: 'Amount', t: 'calc', total: 1, calc: function (b, r) { return D.amount(r); } },
      { k: 'ref', label: 'Station/Ref', t: 'text', alias: ['Station', 'Ref', 'Reference', 'Station / Ref'] },
      { k: 'desc', label: 'Description', t: 'text', alias: ['Remarks', 'Notes'] },
    ],
    noCopy: ['invId', 'invRef', 'billedOn'],
    locked: function (b, r) { return D.billed(b, r); },
    selectable: function (b, r) { return !D.billed(b, r); },
    defaults: function (b, last) { return last ? { supplier: last.supplier || '' } : {}; },
    extraHead: function () { return '<th class="gl-c-status">Status</th>'; },
    extraCells: function (b, r) {
      var s = statusOf(b, r);
      return '<td class="gl-c-status">' + (s.billed
        ? '<button type="button" class="gl-badge gl-settled" tabindex="-1" title="Billed on purchase invoice ' + esc(s.inv.reference || '') + ' — open it" onclick="Gill.openInvoice(\'' + esc(String(s.inv.id)) + '\')">✓ Settled' + (s.inv.reference ? ' · ' + esc(s.inv.reference) : '') + '</button>'
        : '<span class="gl-badge gl-unbilled">Unbilled</span>') + '</td>';
    },
    csvExtra: [{ k: '_status', label: 'Status', get: function (b, r) { return D.billed(b, r) ? 'Billed' : 'Unbilled'; } },
      { k: '_inv', label: 'Purchase Invoice', get: function (b, r) { var i = D.invoiceOf(b, r); return i ? (i.reference || String(i.id)) : ''; } }],
    filters: [{ k: 'supplier', label: 'Supplier', pick: 'supplier' }, { k: 'truck', label: 'Truck', pick: 'truck' }, { k: 'driver', label: 'Driver', pick: 'driver' },
      { k: 'status', label: 'Status', options: function () { return [['unbilled', 'Unbilled'], ['billed', 'Billed']]; }, test: function (b, r, v) { return (v === 'billed') === D.billed(b, r); } }],
    groups: [['truck', 'Truck'], ['supplier', 'Supplier'], ['month', 'Month']],
    reportCols: [{ k: 'n', label: 'Entries', int: 1 }, { k: 'qty', label: 'Litres', dec: 3 }, { k: 'amount', label: 'Amount' },
      { k: 'billedQty', label: 'Billed litres', dec: 3 }, { k: 'unbilledQty', label: 'Unbilled litres', dec: 3 }],
    reportRow: function (b, rows) {
      var t = Gill.totals(b, this, rows); t.billedQty = 0; t.unbilledQty = 0;
      rows.forEach(function (r) { if (D.billed(b, r)) t.billedQty += Number(r.qty) || 0; else t.unbilledQty += Number(r.qty) || 0; });
      t.billedQty = U.r3(t.billedQty); t.unbilledQty = U.r3(t.unbilledQty); return t;
    },
    topHtml: function (b) {
      var j = Gill._justLinked; Gill._justLinked = null;
      return (j && j.n ? '<div class="gl-note gl-note-ok">✓ ' + j.n + ' diesel ' + (j.n === 1 ? 'entry' : 'entries') + ' settled on purchase invoice ' + esc(j.ref) + '.</div>' : '') +
        '<div class="gl-selbar" id="glSelBar">' + selBar(b) + '</div>';
    },
    afterEdit: function (b) { var el = U.hasDom() && U.byId('glSelBar'); if (el) el.innerHTML = selBar(b); },
  };
  Gill.registerModule('diesel', 'Diesel', '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M3 21h13"/><path d="M7 8h5"/><path d="M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
    'Daily diesel per truck, kept Unbilled until the supplier’s invoice arrives; tick entries to create the Purchase Invoice and they show Settled.');
})(typeof window !== 'undefined' ? window : globalThis);
