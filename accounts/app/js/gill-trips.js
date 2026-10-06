/* ===================== Gill Transport: core + Trips =====================
   Two custom modules (js/custom-modules.js), switched on per business in
   Settings -> Customisation: "trips" (the Trips tab, this file) and "diesel"
   (the Diesel tab, js/gill-diesel.js). Each can be on alone; a business with
   neither sees nothing of this code. The shared pick-lists page (App.set_gill)
   is reached from Customisation while either module is on. Businesses that
   had the old b.features.gill flag read as both modules on.

   Data lives on the business itself, outside b.records, so no register,
   ledger, report or list tool ever sees it:
     b.gill = { trips:[…], diesel:[…], lists:{ trucks, crushers, destinations,
                materials, vessels, dieselSuppliers } }
   lists.trucks holds the Trucks tab (js/gill-trucks.js): [{id, no, plate, make,
   status:'Active'|'Inactive', notes}]; an older list of plain truck numbers is
   read as Active trucks, and the first time the list is read it is seeded with
   the truck numbers already used in trips and diesel (g.trucksSeeded).
   lists.dieselSuppliers is no longer used (Diesel lists registered Suppliers).

   Truck, Driver and Supplier cells are pick cells: a searchable list of the
   registered trucks (Active, Trucks tab), drivers (Active employees marked
   as drivers) and suppliers (Purchases -> Suppliers, "Diesel" category first).
   Typed text that is not in the list is refused, with a "+ Add …" shortcut;
   older values that are not in the list are kept and shown in orange. Date
   cells open a small calendar. A row counts (totals, reports, saving) once a
   field other than the date (and the values filled in for it) is entered.

   This file owns the shared pieces (pick-lists page, the spreadsheet grid,
   paste from Excel, filters, CSV, print and the grouped report) and the Trips
   page. Sidebar group "Transport", routing, #hash reload and permissions come
   from CustomModules; the grid follows the tab's View / Create / Update /
   Delete level (App.permLevel). js/gill-diesel.js adds the Diesel page and
   its Purchase Invoice link.
   ======================================================================= */
(function (G) {
  'use strict';
  if (typeof App === 'undefined' || G.Gill || !G.CustomModules) return;
  var CM = G.CustomModules;

  var hasDom = function () { return typeof document !== 'undefined' && document && document.body && document.body.nodeType === 1; };
  var byId = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
  function esc(s) { return App.esc(s == null ? '' : s); }
  function pad(n) { return ('0' + n).slice(-2); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function toast(m) { try { if (G.UIModal) UIModal.toast(m); } catch (e) {} }
  var _seq = 0;
  function uid() { return Date.now() * 100 + ((_seq++) % 100); }
  function curB() { try { return App.openBiz != null ? App.curBiz() : null; } catch (e) { return null; } }
  function fmtD(iso) { if (!iso) return ''; try { return App.fmtDate(iso); } catch (e) { return iso; } }
  function money(n) { try { return App.money(n); } catch (e) { return r2(n).toFixed(2); } }
  function qtyFmt(n) { n = r3(n); return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 }); }
  function ddmm(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }

  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function validIso(y, m, d) {
    y = +y; m = +m; d = +d;
    if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }
  /** User / Excel text -> 'YYYY-MM-DD'; '' for blank, null when it is not a date.
      Day-first unless the business shows dates month-first. */
  function parseDate(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/);
    if (m) return validIso(m[1], m[2], m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) {                     // Excel serial day number
      var n = Math.floor(+s); if (n < 20000 || n > 90000) return null;
      var dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }
    var thisYear = new Date().getFullYear();
    var yr = function (y) { if (y == null || y === '') return thisYear; y = String(y); return y.length <= 2 ? 2000 + (+y) : +y; };
    m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})\.?(?:[\s\-\/.,]+(\d{2,4}))?$/);
    if (m) { var mn = m[2].toLowerCase(), mi = MON[mn] != null ? MON[mn] : MON[mn.slice(0, 3)]; return mi == null ? null : validIso(yr(m[3]), mi, m[1]); }
    m = s.match(/^(\d{1,2})[\/.\-\s](\d{1,2})(?:[\/.\-\s](\d{2,4}))?$/);
    if (!m) return null;
    var b = curB(), f = (b && b.fmt && b.fmt.date) || 'DD/MM/YYYY';
    var mdy = /^MM/.test(f);
    return validIso(yr(m[3]), mdy ? m[1] : m[2], mdy ? m[2] : m[1]);
  }
  /** "1,234.50" / "AED 12" -> number; '' when blank; null when not a number. */
  function parseNum(s) {
    if (typeof s === 'number') return isFinite(s) ? s : null;
    s = String(s == null ? '' : s).replace(/[,\s]/g, '').replace(/^(aed|dhs?|usd)/i, '');
    if (s === '' || s === '-') return '';
    if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
    if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
    return parseFloat(s);
  }
  /** Tab-separated text as Excel puts it on the clipboard (quoted cells may hold tabs / newlines). */
  function parseTSV(text) {
    text = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var rows = [], row = [], cell = '', q = false, i = 0, at0 = true;
    for (; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
        continue;
      }
      if (c === '"' && at0) { q = true; at0 = false; continue; }
      if (c === '\t') { row.push(cell); cell = ''; at0 = true; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; at0 = true; continue; }
      cell += c; at0 = false;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { x = String(x == null ? '' : x).trim(); if (!x) return; var k = x.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(x); }); return out; }
  function sortStr(a) { return a.slice().sort(function (x, y) { return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }); }); }

  var Gill = G.Gill = {
    pages: {}, state: {}, _pending: null,
    /* free pick-lists edited on the pick-lists page (trucks, drivers and suppliers are registers of their own) */
    LISTS: [['crushers', 'Crushers', 'Crusher names'], ['destinations', 'Destinations', 'Sites / ports'],
      ['materials', 'Materials', 'e.g. Gabbro 3/4"'], ['vessels', 'Vessels', 'Vessel names']],
    STORE_LISTS: ['trucks', 'crushers', 'destinations', 'materials', 'vessels', 'dieselSuppliers'],
    util: { esc: esc, parseDate: parseDate, parseNum: parseNum, parseTSV: parseTSV, csvCell: csvCell, todayIso: todayIso, ddmm: ddmm, r2: r2, r3: r3, uid: uid, uniq: uniq, money: money, qtyFmt: qtyFmt, fmtD: fmtD, toast: toast, curB: curB, byId: byId, hasDom: hasDom },
    /** true while Trips or Diesel is switched on for b (Settings -> Customisation) */
    enabled: function (b) { return !!b && (CM.isOn(b, 'trips') || CM.isOn(b, 'diesel')); },
    /** the signed-in user's level on a Gill tab: 0 none, 1 View, 2 +Create, 3 +Update, 4 +Delete */
    level: function (b, label) { try { return typeof App.permLevel === 'function' ? App.permLevel(b, label || App.wsSection) : 4; } catch (e) { return 4; } },
    /** b.gill with every part present (mutates b; the caller saves). */
    data: function (b) {
      var g = b.gill = (b.gill && typeof b.gill === 'object') ? b.gill : {};
      if (!Array.isArray(g.trips)) g.trips = [];
      if (!Array.isArray(g.diesel)) g.diesel = [];
      g.lists = (g.lists && typeof g.lists === 'object') ? g.lists : {};
      Gill.STORE_LISTS.forEach(function (k) { if (!Array.isArray(g.lists[k])) g.lists[k] = []; });
      normTrucks(g);
      return g;
    },
    st: function (label) {
      return Gill.state[label] = Gill.state[label] || { f: {}, sel: {}, fresh: {}, view: 'entries', g: '', cur: null };
    },
    page: function () { return Gill.pages[App.wsSection] || null; },
  };

  /* ------------------------------------------------------------------ pick-lists */
  function used(b, store, key) { return ((Gill.data(b)[store]) || []).map(function (r) { return r[key]; }); }
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function truthy(v) { return v === true || v === 1 || /^(true|yes|on|1)$/i.test(String(v == null ? '' : v).trim()); }
  /** an employee counts as a driver: "Is driver" ticked, Employee type "Company Driver" or Designation "Driver" */
  function isDriver(e) {
    if (!e) return false;
    if (truthy(e.isDriver)) return true;
    var t = [e.employeeType, e.empType, e.type, e.employmentType, e.category, e.empCategory].filter(Boolean).join(' ');
    return /company\s*driver/i.test(t) || /^\s*(heavy\s+|light\s+|truck\s+|company\s+)?driver\s*$/i.test(String(e.designation || ''));
  }
  function empActive(e) { var s = lc(e && e.status); return !(s === 'resigned' || s === 'terminated' || s === 'inactive' || s === 'left'); }
  function supName(s) { return String((s && (s.name || s.supName || s.supplier)) || '').trim(); }
  function isDieselSup(s) { return /diesel|fuel/i.test(String((s && s.category) || '')); }

  /* ---- trucks: the Trucks tab's list (objects), migrated from plain numbers and seeded once from the entries */
  var _migrated = false;
  function truckObj(x) {
    if (x && typeof x === 'object') { if (!x.id) x.id = 't' + uid(); x.no = String(x.no == null ? '' : x.no).trim(); if (x.status !== 'Inactive') x.status = 'Active'; return x.no ? x : null; }
    var no = String(x == null ? '' : x).trim();
    return no ? { id: 't' + uid(), no: no, plate: '', make: '', status: 'Active', notes: '' } : null;
  }
  function normTrucks(g) {
    var L = g.lists, before = JSON.stringify(L.trucks), seen = {};
    L.trucks = L.trucks.map(truckObj).filter(function (t) { if (!t || seen[lc(t.no)]) return false; seen[lc(t.no)] = 1; return true; });
    if (!g.trucksSeeded) {
      g.trips.concat(g.diesel).forEach(function (r) { var no = String((r && r.truck) || '').trim(); if (no && !seen[lc(no)]) { seen[lc(no)] = 1; L.trucks.push(truckObj(no)); } });
      g.trucksSeeded = true;
    }
    if (JSON.stringify(L.trucks) !== before) _migrated = true;
  }
  Gill._takeMigrated = function () { var m = _migrated; _migrated = false; return m; };

  /** the registered entries a pick cell offers: [{v, note, grp}] */
  Gill.pickOptions = function (b, kind) {
    var R = b.records || {};
    if (kind === 'truck') return Gill.data(b).lists.trucks.filter(function (t) { return t.status !== 'Inactive'; })
      .sort(function (x, y) { return x.no.localeCompare(y.no, undefined, { numeric: true, sensitivity: 'base' }); })
      .map(function (t) { return { v: t.no, note: [t.plate, t.make].filter(Boolean).join(' · ') }; });
    if (kind === 'driver') return (R.employees || []).filter(function (e) { return e && (e.name || e.empName) && empActive(e) && isDriver(e); })
      .map(function (e) { return { v: String(e.name || e.empName).trim(), note: e.code || e.empCode || '' }; })
      .sort(function (x, y) { return x.v.localeCompare(y.v, undefined, { sensitivity: 'base' }); });
    if (kind === 'supplier') {
      var all = (R.suppliers || []).filter(function (s) { return supName(s); }), anyCat = all.some(isDieselSup);
      return all.map(function (s) { return { v: supName(s), note: s.category || '', grp: anyCat ? (isDieselSup(s) ? 'Diesel suppliers' : 'Other suppliers') : '' }; })
        .sort(function (x, y) { return (x.grp === y.grp ? 0 : x.grp === 'Diesel suppliers' ? -1 : 1) || x.v.localeCompare(y.v, undefined, { sensitivity: 'base' }); });
    }
    return [];
  };
  /** the registered name typed (any case / spacing) -> its stored spelling, else null */
  Gill.pickMatch = function (b, kind, v) {
    var k = lc(v).replace(/\s+/g, ' '); if (!k) return null;
    var hit = Gill.pickOptions(b, kind).find(function (o) { return lc(o.v).replace(/\s+/g, ' ') === k; });
    return hit ? hit.v : null;
  };
  Gill.PICKS = {
    truck: { noun: 'truck', add: '+ Add truck', not: 'Not a registered truck', where: 'Transport → Trucks' },
    driver: { noun: 'driver', add: '+ Add driver', not: 'Not a registered driver', where: 'Payroll → Employees (Is driver ticked, Active)' },
    supplier: { noun: 'supplier', add: '+ Add supplier', not: 'Not a registered supplier', where: 'Purchases → Suppliers' },
  };
  Gill.source = function (b, src) {
    var R = b.records || {}, L = Gill.data(b).lists;
    if (Gill.PICKS[src]) return Gill.pickOptions(b, src).map(function (o) { return o.v; });
    switch (src) {
      case 'account': return sortStr(uniq((R.customers || []).map(function (c) { return c.name || c.custName; }).concat(used(b, 'trips', 'account'))));
      case 'crusher': return sortStr(uniq(L.crushers.concat(used(b, 'trips', 'crusher'))));
      case 'dest': return sortStr(uniq(L.destinations.concat(used(b, 'trips', 'dest'))));
      case 'material': return sortStr(uniq(L.materials.concat(used(b, 'trips', 'material'))));
      case 'vessel': return sortStr(uniq(L.vessels.concat(used(b, 'trips', 'vessel'))));
    }
    return [];
  };
  Gill.isDriver = isDriver;

  /* ------------------------------------------------------------------ pick-lists page (Settings -> Customisation -> Transport pick-lists) */
  App.set_gill = function (b) {
    var head = App.crumb('Settings', 'Customisation');
    if (!Gill.enabled(b)) return head + '<div class="card gl-set"><h2>Transport pick-lists</h2><p class="gl-hint">Switch on Trips or Diesel for this business first.</p>' +
      '<div class="form-actions"><button class="btn btn-primary" onclick="App.openSetting(\'customisation\')">Open Customisation</button></div></div>';
    var g = Gill.data(JSON.parse(JSON.stringify(b)));
    var lists = Gill.LISTS.map(function (L) {
      return '<div class="gl-set-list"><label class="fld" for="gl_set_' + L[0] + '">' + esc(L[1]) + '</label>' +
        '<textarea id="gl_set_' + L[0] + '" rows="6" placeholder="' + esc(L[2]) + ' — one per line">' + esc(g.lists[L[0]].join('\n')) + '</textarea></div>';
    }).join('');
    return head +
      '<div class="card gl-set"><h2>Transport pick-lists</h2>' +
      '<p class="gl-hint">Suggestions offered while typing in Trips. Any other value can still be typed. Accounts come from Customers. ' +
        'Truck, Driver and Supplier cells list only registered entries: trucks from Transport → Trucks, drivers from Payroll → Employees (Is driver ticked), suppliers from Purchases → Suppliers.</p>' +
      '<div class="gl-set-grid">' + lists + '</div>' +
      '<div class="form-actions"><button class="btn btn-primary" onclick="Gill.saveLists()">Update</button><button class="btn" onclick="App.openSetting(\'customisation\')">Cancel</button></div></div>';
  };
  Gill.saveLists = function (vals) {
    var b = curB(); if (!b) return;
    if (App.guardWrite && !App.guardWrite(b)) return;
    var g = Gill.data(b);
    Gill.LISTS.forEach(function (L) {
      var v = vals ? vals[L[0]] : (byId('gl_set_' + L[0]) || {}).value;
      if (v == null) return;
      g.lists[L[0]] = uniq(Array.isArray(v) ? v : String(v).split(/\n/));
    });
    App.saveBiz(b); toast('Pick-lists saved');
    if (!vals) App.openSetting('customisation');
  };

  /* ------------------------------------------------------------------ registration (CustomModules) */
  /** Registers one Gill page as its own custom module (sidebar group "Transport"). */
  Gill.registerModule = function (id, label, icon, description) {
    return CM.register({
      id: id, name: label, description: description, group: 'Transport',
      legacyFeature: 'gill',                     // old b.features.gill === true -> on
      tabs: [{ id: id, label: label, icon: icon,
        render: function (b, ctx) { return Gill.pageHtml(b, label, ctx && ctx.level); },
        after: function (b) { Gill._afterRender(b); } }],
      settings: { key: 'gill', title: 'Transport pick-lists' },
      onEnable: function (b) { Gill.data(b); },
    });
  };
  var _rm = App.renderMain;
  App.renderMain = function () {
    /* a Purchase Invoice opened from Diesel is pending only while its form is open */
    if (Gill._pending && !(this.wsMode === 'form' && this.wsSection === 'Purchase Invoices' && this.editingId == null)) Gill._pending = null;
    return _rm.apply(this, arguments);
  };
  Gill._afterRender = function (b) {
    if (!hasDom()) return;
    var st = Gill.st(App.wsSection);
    if (st.focusNext) {
      var f = st.focusNext; st.focusNext = null;
      setTimeout(function () {
        var el = document.querySelector('.gl-grid input.gl-cell[data-id="' + f.id + '"][data-k="' + f.k + '"]');
        if (el) { el.focus(); try { el.select(); } catch (e) {} }
      }, 0);
    }
  };
  Gill.open = function (label) { App.selectSection(label); };

  /* ------------------------------------------------------------------ grid model */
  function colsOf(p) { return p.cols; }
  function editableCols(p) { return p.cols.filter(function (c) { return c.t !== 'calc'; }); }
  /** nothing entered but the date (values a new row was given from the row above — r._d — do not count) */
  function rowBlank(p, r) { return editableCols(p).every(function (c) { return c.k === 'date' || blank(r[c.k]) || (Array.isArray(r._d) && r._d.indexOf(c.k) >= 0); }); }
  Gill.rowBlank = rowBlank;
  function touch(r, k) { if (Array.isArray(r._d)) { r._d = r._d.filter(function (x) { return x !== k; }); if (!r._d.length) delete r._d; } }
  Gill.rows = function (b, p) { return Gill.data(b)[p.store]; };
  /** rows after filters, in display order (date, then entry order); rows added this visit always show */
  Gill.visible = function (b, p) {
    var st = Gill.st(p.label), f = st.f;
    var rows = Gill.rows(b, p).filter(function (r) {
      if (st.fresh[r.id]) return true;
      if (f.from && (r.date || '') < f.from) return false;
      if (f.to && (r.date || '') > f.to) return false;
      return (p.filters || []).every(function (fl) {
        var v = f[fl.k]; if (blank(v)) return true;
        if (fl.test) return fl.test(b, r, v);
        if (fl.pick && v === UNREG) return !blank(r[fl.k]) && !Gill.pickMatch(b, fl.pick, r[fl.k]);
        return String(r[fl.k] || '').toLowerCase() === String(v).toLowerCase();
      });
    });
    return rows.sort(function (x, y) {
      var dx = x.date || '9999', dy = y.date || '9999'; if (dx !== dy) return dx < dy ? -1 : 1;
      return (x.seq || 0) - (y.seq || 0);
    });
  };
  Gill.totals = function (b, p, rows) {
    rows = rows.filter(function (r) { return !rowBlank(p, r); });          // empty rows are not entries
    var t = { n: rows.length };
    p.cols.forEach(function (c) { if (c.total) t[c.k] = 0; });
    rows.forEach(function (r) { p.cols.forEach(function (c) { if (c.total) t[c.k] += Number(c.calc ? c.calc(b, r) : r[c.k]) || 0; }); });
    p.cols.forEach(function (c) { if (c.total) t[c.k] = c.dec === 3 ? r3(t[c.k]) : r2(t[c.k]); });
    return t;
  };
  function nextSeq(rows) { return rows.reduce(function (m, r) { return Math.max(m, r.seq || 0); }, 0) + 1; }
  function locked(b, p, r) { return !!(p.locked && p.locked(b, r)); }
  /** Store one parsed value. 'ok' | 'bad' (not a date / number) | 'unreg' (pick cell, not registered: not stored)
      | 'kept' (paste: not registered, stored as typed and shown in orange). strict = a typed cell edit. */
  function setVal(b, p, r, c, raw, strict) {
    var v;
    if (c.t === 'date') { v = parseDate(raw); if (v === null) return 'bad'; }
    else if (c.t === 'num') { v = parseNum(raw); if (v === null) return 'bad'; }
    else v = String(raw == null ? '' : raw).trim();
    var res = 'ok';
    if (c.pick && v !== '') {
      var m = Gill.pickMatch(b, c.pick, v);
      if (m) v = m;
      else if (strict) return 'unreg';
      else res = 'kept';
    }
    r[c.k] = v; touch(r, c.k); return res;
  }
  Gill.newRow = function (b, p, after) {
    var rows = Gill.rows(b, p), st = Gill.st(p.label);
    var last = after || Gill.visible(b, p).slice(-1)[0];
    var r = { id: uid(), seq: nextSeq(rows), date: (last && last.date) || st.f.to || todayIso() };
    if (p.defaults) { var d = p.defaults(b, last) || {}; Object.assign(r, d); var ks = Object.keys(d).filter(function (k) { return !blank(d[k]); }); if (ks.length) r._d = ks; }
    rows.push(r); st.fresh[r.id] = 1; return r;
  };

  /* ------------------------------------------------------------------ mutations (UI) */
  function save(b, msg) {
    App.saveBiz(b);
    if (hasDom()) { var s = byId('glSaved'); if (s) { var d = new Date(); s.textContent = (msg || 'Saved') + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); s.classList.add('on'); } }
  }
  function rerender() { var b = curB(); if (b) App.renderMain(b); }
  /* need: 2 create (new rows), 3 update (existing rows), 4 delete — the tab's permission level */
  function guard(b, need) { return !(App.guardWrite && !App.guardWrite(b, need || 2)); }

  Gill.setField = function (id, k, raw, label) {
    var p = label ? Gill.pages[label] : Gill.page(); var b = curB(); if (!p || !b) return 'none';
    var r = Gill.rows(b, p).find(function (x) { return String(x.id) === String(id); }); if (!r) return 'none';
    if (locked(b, p, r)) return 'locked';
    var c = p.cols.find(function (x) { return x.k === k; }); if (!c || c.t === 'calc') return 'none';
    var before = r[c.k], beforeD = r._d ? r._d.slice() : null;
    /* an older value left as it was (e.g. Tab through an orange cell) is kept, registered or not */
    if (c.pick && String(raw == null ? '' : raw).trim() === String(before == null ? '' : before)) return 'ok';
    var res = setVal(b, p, r, c, raw, true); if (res !== 'ok') return res;
    if (String(before == null ? '' : before) === String(r[c.k] == null ? '' : r[c.k]) && String(beforeD) === String(r._d || null)) return 'ok';   // unchanged: nothing to save
    /* a row added on this visit needs Create; changing an older row needs Update */
    if (!guard(b, Gill.st(p.label).fresh[r.id] ? 2 : 3)) { r[c.k] = before; if (beforeD) r._d = beforeD; return 'denied'; }
    save(b); return 'ok';
  };
  Gill._timers = {};
  Gill.cellInput = function (el) {
    var key = el.getAttribute('data-id') + ':' + el.getAttribute('data-k');
    clearTimeout(Gill._timers[key]);
    if (el.getAttribute('data-pick')) { Pop.refresh(el, true); return; }     // a pick cell saves when it is left (Enter / Tab / a choice)
    if (el.getAttribute('data-k') === 'date') Pop.refresh(el, true);
    Gill._timers[key] = setTimeout(function () { Gill._commit(el, true); }, 600);
  };
  Gill.cellChange = function (el) { Gill._commit(el, false); };
  /** saves the cell; returns the setField result ('ok', 'bad', 'unreg', …) */
  Gill._commit = function (el, soft) {
    var id = el.getAttribute('data-id'), k = el.getAttribute('data-k'), kind = el.getAttribute('data-pick');
    clearTimeout(Gill._timers[id + ':' + k]);
    var res = Gill.setField(id, k, el.value);
    if (el.classList) el.classList.toggle('gl-bad', res === 'bad' || res === 'unreg');
    if (res === 'bad' && !soft) toast(k === 'date' ? 'Not a date — type it as ' + (App.datePlaceholder ? App.datePlaceholder() : 'dd/mm/yyyy') + ' (e.g. 07/10/2026 or 7-10)' : 'Not a number');
    if (res === 'unreg' && !soft) { var P = Gill.PICKS[kind] || {}; toast(P.not + ' — choose one from the list, or use “' + P.add + '”'); }
    if (res !== 'ok') return res;
    var p = Gill.page(), b = curB(); if (!p || !b) return res;
    var r = Gill.rows(b, p).find(function (x) { return String(x.id) === String(id); });
    if (!soft && r) {
      var c = p.cols.find(function (x) { return x.k === k; }); el.value = cellText(c, r[k]);
      if (kind && el.classList) { var un = !blank(r[k]) && !Gill.pickMatch(b, kind, r[k]); el.classList.toggle('gl-unreg', un); if (!un) el.removeAttribute('title'); }
    }
    Gill._paintTotals(b, p, r);
    return res;
  };
  Gill._paintTotals = function (b, p, r) {
    if (!hasDom()) return;
    var t = Gill.totals(b, p, Gill.visible(b, p));
    p.cols.forEach(function (c) { if (!c.total) return; var el = byId('gl-tot-' + c.k); if (el) el.textContent = c.dec === 3 ? qtyFmt(t[c.k]) : money(t[c.k]); });
    var nl = byId('gl-tot-n'); if (nl) nl.textContent = totLabel(p, t.n);
    if (r) p.cols.forEach(function (c) { if (c.t !== 'calc') return; var el = byId('gl-c-' + r.id + '-' + c.k); if (el) el.textContent = calcText(b, c, r); });
    if (p.afterEdit) p.afterEdit(b);
  };
  function totLabel(p, n) { return 'Total · ' + n + ' ' + (n === 1 ? p.noun1 : p.noun); }
  Gill.cellFocus = function (el) {
    var st = Gill.st(App.wsSection); st.cur = el.getAttribute('data-id');
    if (!el.readOnly && !el.disabled && (el.getAttribute('data-pick') || el.getAttribute('data-k') === 'date')) Pop.open(el);
  };
  /* leaving a row that is still empty removes it (unless a "+ Add …" dialog opened from it is in use) */
  Gill.cellBlur = function (el, e) {
    var to = e && e.relatedTarget;
    if (to && Pop.el && Pop.el.contains(to)) return;
    if (Pop.input === el) Pop.close();
    var tr = el.closest ? el.closest('tr') : null;
    if (to && tr && tr.contains(to)) return;
    var id = el.getAttribute('data-id');
    setTimeout(function () { Gill._dropIfBlank(id); }, 0);
  };
  Gill._dropIfBlank = function (id) {
    if (Gill._hold && String(Gill._hold) === String(id)) return false;
    var p = Gill.page(), b = curB(); if (!p || !b) return false;
    if (hasDom()) { var a = document.activeElement; if (a && a.getAttribute && a.getAttribute('data-id') === String(id)) return false; }
    var rows = Gill.rows(b, p), r = rows.find(function (x) { return String(x.id) === String(id); });
    if (!r || !rowBlank(p, r) || locked(b, p, r)) return false;
    Gill.data(b)[p.store] = rows.filter(function (x) { return x !== r; });
    var st = Gill.st(p.label); delete st.fresh[r.id]; delete st.sel[r.id]; if (String(st.cur) === String(id)) st.cur = null;
    App.saveBiz(b);
    if (hasDom()) {
      var tr = document.querySelector('.gl-grid tr[data-row="' + id + '"]');
      if (tr && tr.parentNode) {
        var body = tr.parentNode; tr.parentNode.removeChild(tr);
        Array.prototype.forEach.call(body.querySelectorAll('tr[data-row]'), function (row, i) {
          var n = row.querySelector('td.gl-n'); if (n) n.textContent = i + 1;
          Array.prototype.forEach.call(row.querySelectorAll('input.gl-cell'), function (x) { x.setAttribute('data-ri', i); });
        });
      }
      Gill._paintTotals(curB(), p, null);
    }
    return true;
  };
  function gridInputs() { return Array.prototype.slice.call(document.querySelectorAll('.gl-grid input.gl-cell')).filter(function (x) { return !x.disabled; }); }
  function focusEl(el) { if (!el) return; el.focus(); try { el.select(); } catch (e) {} }
  Gill.cellKey = function (e, el) {
    var k = e.key, popOn = Pop.input === el && Pop.kind;
    if (popOn === 'pick' && (k === 'ArrowDown' || k === 'ArrowUp')) { e.preventDefault(); Pop.move(k === 'ArrowDown' ? 1 : -1); return; }
    if (popOn && k === 'Escape') { e.preventDefault(); Pop.close(); var b0 = curB(), p0 = Gill.page(), r0 = b0 && p0 && Gill.rows(b0, p0).find(function (x) { return String(x.id) === el.getAttribute('data-id'); });
      if (r0) { var c0 = p0.cols.find(function (x) { return x.k === el.getAttribute('data-k'); }); el.value = cellText(c0, r0[c0.k]); el.classList.remove('gl-bad'); } return; }
    if (k === 'ArrowDown' && e.altKey && !popOn && (el.getAttribute('data-pick') || el.getAttribute('data-k') === 'date')) { e.preventDefault(); Pop.open(el); return; }
    if ((k === 'Enter' || k === 'Tab') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (popOn === 'pick') { var it = Pop.current(); if (it && it.add) { Pop.add(); return; } if (it) el.value = it.v; }
      var res = Gill._commit(el, false);
      if (res === 'unreg' || res === 'bad') { if (el.getAttribute('data-pick') || el.getAttribute('data-k') === 'date') Pop.open(el); try { el.select(); } catch (x) {} return; }
      Pop.close();
      var all = gridInputs(), i = all.indexOf(el), back = e.shiftKey;
      var tgt = all[i + (back ? -1 : 1)];
      if (tgt) return focusEl(tgt);
      if (!back && Gill.level(curB(), App.wsSection) >= 2) Gill.addRow();
      return;
    }
    if ((k === 'ArrowDown' || k === 'ArrowUp') && !el.getAttribute('list') && popOn !== 'pick') {
      e.preventDefault(); Gill._commit(el, false);
      var ri = +el.getAttribute('data-ri') + (k === 'ArrowDown' ? 1 : -1);
      focusEl(document.querySelector('.gl-grid input.gl-cell[data-ri="' + ri + '"][data-k="' + el.getAttribute('data-k') + '"]'));
      return;
    }
    if ((k === 'd' || k === 'D') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); Gill._commit(el, false); Gill.dupRows(); }
  };
  Gill.addRow = function () {
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b)) return;
    var st = Gill.st(p.label), cur = st.cur && Gill.rows(b, p).find(function (x) { return String(x.id) === String(st.cur); });
    var r = Gill.newRow(b, p, cur || null);
    save(b); st.cur = r.id; st.focusNext = { id: r.id, k: p.cols[1] ? p.cols[1].k : 'date' };
    rerender();
    return r;
  };
  function targets(b, p) {
    var st = Gill.st(p.label), ids = Object.keys(st.sel).filter(function (k) { return st.sel[k]; });
    if (!ids.length && st.cur) ids = [String(st.cur)];
    return Gill.rows(b, p).filter(function (r) { return ids.indexOf(String(r.id)) >= 0; });
  }
  Gill.dupRows = function () {
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b, 2)) return;
    var src = targets(b, p); if (!src.length) { toast('Click a row (or tick some) to duplicate'); return; }
    var rows = Gill.rows(b, p), st = Gill.st(p.label), last = null;
    src.forEach(function (r) {
      var c = JSON.parse(JSON.stringify(r)); c.id = uid(); c.seq = nextSeq(rows); delete c._d;
      (p.noCopy || []).forEach(function (k) { delete c[k]; });
      rows.push(c); st.fresh[c.id] = 1; last = c;
    });
    st.sel = {}; save(b); st.cur = last.id; st.focusNext = { id: last.id, k: p.cols[1].k };
    toast('Duplicated ' + src.length + ' row' + (src.length === 1 ? '' : 's')); rerender();
  };
  Gill.deleteRows = function () {
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b, 4)) return;
    var src = targets(b, p); if (!src.length) { toast('Click a row (or tick some) to delete'); return; }
    var lockedN = src.filter(function (r) { return locked(b, p, r); }).length;
    src = src.filter(function (r) { return !locked(b, p, r); });
    if (!src.length) { UIModal.alert('Billed entries cannot be deleted. Delete the purchase invoice first — the entries then return to Unbilled.', { title: 'Delete rows' }); return; }
    var n = src.length;
    var go = function () {
      var b2 = curB(), ids = src.map(function (r) { return String(r.id); });
      Gill.data(b2)[p.store] = Gill.rows(b2, p).filter(function (r) { return ids.indexOf(String(r.id)) < 0; });
      var st = Gill.st(p.label); st.sel = {}; st.cur = null; save(b2);
      toast('Deleted ' + n + ' row' + (n === 1 ? '' : 's')); rerender();
    };
    var msg = 'Delete ' + n + ' ' + (n === 1 ? 'row' : 'rows') + '?' + (lockedN ? ' (' + lockedN + ' billed ' + (lockedN === 1 ? 'entry is' : 'entries are') + ' kept.)' : '');
    if (G.UIModal && hasDom()) UIModal.confirm(msg, { title: 'Delete rows', okText: 'Delete', danger: true }).then(function (ok) { if (ok) go(); });
    else go();
  };
  Gill.toggleSel = function (id, on) {
    var st = Gill.st(App.wsSection); if (on) st.sel[id] = true; else delete st.sel[id];
    if (hasDom()) { var tr = document.querySelector('.gl-grid tr[data-row="' + id + '"]'); if (tr) tr.classList.toggle('gl-rsel', !!on); }
    var p = Gill.page(); if (p && p.afterEdit) p.afterEdit(curB());
  };
  Gill.selAll = function (on) {
    var p = Gill.page(), b = curB(); if (!p || !b) return; var st = Gill.st(p.label); st.sel = {};
    if (on) Gill.visible(b, p).forEach(function (r) { if (!p.selectable || p.selectable(b, r)) st.sel[r.id] = true; });
    rerender();
  };
  Gill.setFilter = function (k, v) { var st = Gill.st(App.wsSection); st.f[k] = v; st.fresh = {}; st.sel = {}; rerender(); };
  Gill.clearFilters = function () { var st = Gill.st(App.wsSection); st.f = {}; st.fresh = {}; st.sel = {}; rerender(); };
  Gill.setView = function (v) { var st = Gill.st(App.wsSection); st.view = v; rerender(); };
  Gill.setGroup = function (g) { var st = Gill.st(App.wsSection); st.g = g; rerender(); };

  /* ------------------------------------------------------------------ paste */
  function headerMap(p, row) {
    var cols = editableCols(p), map = [], hits = 0;
    row.forEach(function (h, i) {
      var n = norm(h), c = cols.find(function (x) { return norm(x.label) === n || (x.alias || []).some(function (a) { return norm(a) === n; }); });
      map[i] = c || null; if (c) hits++;
    });
    return hits >= 2 ? map : null;
  }
  /** Paste a block. Positional: from column `startK` of row `startId` across/down, overwriting
      and adding rows as needed (Excel-like). With a header row the columns are matched by name
      and every line becomes a new row. Returns {rows, bad, skipped}. */
  Gill.pasteBlock = function (b, p, text, startId, startK) {
    var data = parseTSV(text); if (!data.length) return { rows: 0, bad: 0, skipped: 0 };
    var cols = editableCols(p), hm = headerMap(p, data[0]), st = Gill.st(p.label);
    var view = Gill.visible(b, p), rows = Gill.rows(b, p);
    var ri = -1, ci = 0;
    if (hm) data = data.slice(1);
    else {
      ri = view.findIndex(function (r) { return String(r.id) === String(startId); });
      ci = Math.max(0, cols.findIndex(function (c) { return c.k === startK; }));
    }
    var out = { rows: 0, bad: 0, skipped: 0, unreg: 0 }, prev = view.slice(-1)[0] || null;
    data.forEach(function (line, i) {
      var r = (!hm && ri >= 0) ? view[ri + i] : null;
      if (r && locked(b, p, r)) { out.skipped++; return; }
      if (!r) {
        r = { id: uid(), seq: nextSeq(rows), date: (prev && prev.date) || todayIso() };
        if (p.defaults) { var d = p.defaults(b, prev) || {}; Object.assign(r, d); var ks = Object.keys(d).filter(function (k) { return !blank(d[k]); }); if (ks.length) r._d = ks; }
        rows.push(r); st.fresh[r.id] = 1;
      }
      line.forEach(function (v, j) {
        var c = hm ? hm[j] : cols[ci + j]; if (!c) return;
        var res = setVal(b, p, r, c, v, false);
        if (res === 'bad') out.bad++; else if (res === 'kept') out.unreg++;
      });
      prev = r; out.rows++;
    });
    /* pasted lines with nothing but a date are not entries */
    Gill.data(b)[p.store] = Gill.rows(b, p).filter(function (r) { return !(st.fresh[r.id] && rowBlank(p, r) && String(r.id) !== String(st.cur)); });
    return out;
  };
  function unregNote(res) { return res.unreg ? ' — ' + res.unreg + ' truck / driver / supplier name(s) not registered, shown in orange' : ''; }
  Gill.onPaste = function (e) {
    var el = e.target; if (!el || !el.classList || !el.classList.contains('gl-cell')) return;
    var text = ''; try { text = (e.clipboardData || G.clipboardData).getData('text'); } catch (x) {}
    if (!/[\t\n]/.test(String(text).replace(/\n$/, ''))) return;     // one value: a normal paste
    e.preventDefault();
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b, 3)) return;   // overwrites existing rows
    var res = Gill.pasteBlock(b, p, text, el.getAttribute('data-id'), el.getAttribute('data-k'));
    save(b); rerender();
    toast('Pasted ' + res.rows + ' row' + (res.rows === 1 ? '' : 's') + (res.bad ? ' — ' + res.bad + ' value(s) not understood, left blank' : '') + (res.skipped ? ' — ' + res.skipped + ' billed row(s) skipped' : '') + unregNote(res));
  };
  Gill.pasteDialog = function () {
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b, 2)) return;
    var hdr = editableCols(p).map(function (c) { return c.label; }).join(' ⇥ ');
    App._openOverlay('<div class="app-modal-h">Paste rows from Excel</div><div class="app-modal-b">' +
      '<p class="gl-hint">Copy the rows in Excel (with or without the heading row) and paste them below. Without headings the columns are read in this order:<br><span class="gl-cols">' + esc(hdr) + '</span></p>' +
      '<textarea id="glPasteBox" class="gl-paste" rows="10" placeholder="Paste here (Ctrl+V)"></textarea></div>' +
      '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="Gill.pasteFromDialog()">Add rows</button></div>');
    setTimeout(function () { var t = byId('glPasteBox'); if (t) t.focus(); }, 0);
  };
  Gill.pasteFromDialog = function (text) {
    var p = Gill.page(), b = curB(); if (!p || !b || !guard(b)) return;
    if (text == null) { var t = byId('glPasteBox'); text = t ? t.value : ''; }
    if (!String(text).trim()) { toast('Nothing to paste'); return; }
    var res = Gill.pasteBlock(b, p, text, null, null);
    App._closeOverlay(); save(b); rerender();
    toast('Added ' + res.rows + ' row' + (res.rows === 1 ? '' : 's') + (res.bad ? ' — ' + res.bad + ' value(s) not understood, left blank' : '') + unregNote(res));
    return res;
  };

  /* ------------------------------------------------------------------ popups: pick list + calendar */
  var UNREG = '__unreg__';
  var CAL_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* One floating panel under the focused cell. It never takes the focus: typing, Enter / Tab and
     paste stay in the cell; the mouse picks with mousedown (default prevented). */
  var Pop = Gill.pop = {
    el: null, input: null, kind: '', items: [], idx: -1, typed: false, ym: '',
    ensure: function () {
      if (Pop.el && Pop.el.isConnected) return Pop.el;
      var d = document.createElement('div'); d.className = 'gl-pop'; d.id = 'glPop'; d.setAttribute('role', 'listbox');
      d.addEventListener('mousedown', function (e) { e.preventDefault(); });
      d.addEventListener('click', Pop.onClick);
      document.body.appendChild(d); Pop.el = d;
      if (!Pop._wired) { Pop._wired = 1; document.addEventListener('scroll', function () { Pop.place(); }, true); G.addEventListener('resize', function () { Pop.place(); }); }
      return d;
    },
    open: function (el) {
      if (!hasDom() || !el) return;
      Pop.input = el; Pop.typed = false;
      Pop.kind = el.getAttribute('data-pick') ? 'pick' : 'date';
      if (Pop.kind === 'date') { var iso = parseDate(el.value); Pop.ym = (iso || todayIso()).slice(0, 7); }
      Pop.ensure(); Pop.draw(); Pop.place();
      el.setAttribute('aria-expanded', 'true');
    },
    close: function () {
      if (Pop.input) try { Pop.input.setAttribute('aria-expanded', 'false'); } catch (e) {}
      Pop.input = null; Pop.kind = ''; Pop.items = []; Pop.idx = -1;
      if (Pop.el) { Pop.el.innerHTML = ''; Pop.el.style.display = 'none'; }
    },
    /** the cell's text changed: filter the list / move the calendar */
    refresh: function (el, typed) {
      if (Pop.input !== el) Pop.open(el);
      if (typed) Pop.typed = true;
      if (Pop.kind === 'date') { var iso = parseDate(el.value); if (iso) Pop.ym = iso.slice(0, 7); }
      Pop.draw(); Pop.place();
    },
    place: function () {
      var el = Pop.input, d = Pop.el; if (!el || !d || !Pop.kind) return;
      if (!el.isConnected) { Pop.close(); return; }
      var r = el.getBoundingClientRect(), vh = G.innerHeight || 800, vw = G.innerWidth || 1200;
      d.style.display = 'block'; d.style.minWidth = Math.max(r.width, Pop.kind === 'date' ? 0 : 200) + 'px';
      var h = d.offsetHeight, w = d.offsetWidth;
      var top = r.bottom + 2; if (top + h > vh - 6 && r.top - h - 2 > 6) top = r.top - h - 2;
      d.style.top = Math.max(6, top) + 'px'; d.style.left = Math.max(6, Math.min(r.left, vw - w - 6)) + 'px';
    },
    draw: function () {
      var d = Pop.el, el = Pop.input; if (!d || !el) return;
      if (Pop.kind === 'date') { d.className = 'gl-pop gl-pop-cal'; d.innerHTML = calHtml(parseDate(el.value), Pop.ym); return; }
      d.className = 'gl-pop gl-pop-pick';
      var b = curB(), kind = el.getAttribute('data-pick'), P = Gill.PICKS[kind], all = b ? Gill.pickOptions(b, kind) : [];
      var q = Pop.typed ? lc(el.value) : '', list = all;
      if (q) {
        list = all.filter(function (o) { return lc(o.v).indexOf(q) >= 0 || lc(o.note).indexOf(q) >= 0; });
        var rank = function (o) { var v = lc(o.v); return v === q ? 0 : v.indexOf(q) === 0 ? 1 : 2; };
        list.sort(function (x, y) { return rank(x) - rank(y); });
      }
      var canAdd = b && Gill.level(b, App.wsSection) >= 2;
      Pop.items = list.slice(); if (canAdd) Pop.items.push({ add: true, v: '' });
      var cur = lc(el.value);
      Pop.idx = q ? (list.length ? 0 : (canAdd ? Pop.items.length - 1 : -1)) : list.findIndex(function (o) { return lc(o.v) === cur; });
      var exact = q && all.some(function (o) { return lc(o.v) === q; });
      var h = '', grp = null;
      list.forEach(function (o, i) {
        if (o.grp && o.grp !== grp) { grp = o.grp; h += '<div class="gl-pop-g">' + esc(grp) + '</div>'; }
        h += '<div class="gl-opt' + (i === Pop.idx ? ' on' : '') + '" role="option" data-i="' + i + '"' + (i === Pop.idx ? ' aria-selected="true"' : '') + '><span>' + esc(o.v) + '</span>' + (o.note ? '<small>' + esc(o.note) + '</small>' : '') + '</div>';
      });
      if (!list.length) h += '<div class="gl-pop-msg">' + (q && !exact ? esc(P.not) : 'No ' + esc(P.noun) + 's registered yet') + '<small>' + esc(P.where) + '</small></div>';
      if (canAdd) { var i2 = Pop.items.length - 1; h += '<div class="gl-opt gl-opt-add' + (i2 === Pop.idx ? ' on' : '') + '" role="option" data-i="' + i2 + '">' + esc(P.add) + (q && !exact ? ' “' + esc(el.value.trim()) + '”' : '') + '</div>'; }
      d.innerHTML = '<div class="gl-pop-l">' + h + '</div>';
      Pop.scrollOn();
    },
    scrollOn: function () { var o = Pop.el && Pop.el.querySelector('.gl-opt.on'); if (o && o.scrollIntoView) try { o.scrollIntoView({ block: 'nearest' }); } catch (e) {} },
    move: function (dir) {
      if (!Pop.items.length) return; var n = Pop.items.length;
      Pop.idx = Pop.idx < 0 ? (dir > 0 ? 0 : n - 1) : (Pop.idx + dir + n) % n;
      Array.prototype.forEach.call(Pop.el.querySelectorAll('.gl-opt'), function (x) { var on = +x.getAttribute('data-i') === Pop.idx; x.classList.toggle('on', on); if (on) x.setAttribute('aria-selected', 'true'); else x.removeAttribute('aria-selected'); });
      Pop.scrollOn();
    },
    current: function () { return Pop.idx >= 0 ? Pop.items[Pop.idx] || null : null; },
    /** "+ Add …" from the list: the new entry is filled into this cell */
    add: function () {
      var el = Pop.input; if (!el) return;
      var kind = el.getAttribute('data-pick'), seed = String(el.value || '').trim();
      if (seed && Gill.pickMatch(curB(), kind, seed)) seed = '';
      var cell = { id: el.getAttribute('data-id'), k: el.getAttribute('data-k'), label: App.wsSection };
      Pop.close();
      Gill.addMaster(kind, seed, cell);
    },
    onClick: function (e) {
      var t = e.target, el = Pop.input; if (!el) return;
      var o = t.closest ? t.closest('.gl-opt') : null;
      if (o) {
        Pop.idx = +o.getAttribute('data-i'); var it = Pop.current(); if (!it) return;
        if (it.add) return Pop.add();
        el.value = it.v; var res = Gill._commit(el, false); if (res === 'ok') { Pop.close(); try { el.select(); } catch (x) {} }
        return;
      }
      var nav = t.closest ? t.closest('[data-cal]') : null; if (!nav) return;
      var a = nav.getAttribute('data-cal');
      if (a === 'prev' || a === 'next') { var p = Pop.ym.split('-'), y = +p[0], m = +p[1] + (a === 'next' ? 1 : -1); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } Pop.ym = y + '-' + pad(m); Pop.draw(); Pop.place(); return; }
      var iso = a === 'today' ? todayIso() : a;
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { el.value = fmtD(iso); var r2 = Gill._commit(el, false); if (r2 === 'ok') { Pop.close(); try { el.select(); } catch (x) {} } }
    },
  };
  function calHtml(sel, ym) {
    var p = ym.split('-'), y = +p[0], m = +p[1], first = new Date(y, m - 1, 1), start = (first.getDay() + 6) % 7, n = new Date(y, m, 0).getDate(), today = todayIso();
    var h = '<div class="gl-cal-h"><button type="button" tabindex="-1" data-cal="prev" aria-label="Previous month">‹</button><b>' + MONTHS[m - 1] + ' ' + y + '</b><button type="button" tabindex="-1" data-cal="next" aria-label="Next month">›</button></div>' +
      '<div class="gl-cal-g">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<span class="gl-cal-w">' + d + '</span>'; }).join('');
    for (var i = 0; i < start; i++) h += '<span></span>';
    for (var d = 1; d <= n; d++) { var iso = y + '-' + pad(m) + '-' + pad(d);
      h += '<button type="button" tabindex="-1" data-cal="' + iso + '" class="gl-cal-d' + (iso === sel ? ' sel' : '') + (iso === today ? ' today' : '') + '">' + d + '</button>'; }
    return h + '</div><div class="gl-cal-f"><button type="button" tabindex="-1" data-cal="today">Today</button><span>Type it too: 07/10/2026 or 7-10</span></div>';
  }
  Gill.cellClick = function (el) { if (Pop.input !== el && !el.readOnly && !el.disabled && (el.getAttribute('data-pick') || el.getAttribute('data-k') === 'date')) Pop.open(el); };
  Gill.calBtn = function (btn) {
    var el = btn.parentNode && btn.parentNode.querySelector('input.gl-cell'); if (!el) return;
    if (Pop.input === el) { Pop.close(); return; }
    if (document.activeElement !== el) el.focus(); else Pop.open(el);
    if (Pop.input !== el) Pop.open(el);
  };

  /* ------------------------------------------------------------------ "+ Add truck / driver / supplier" */
  /** Opens the short form for a new truck, driver or supplier; on save the new name is filled into `cell` ({id, k, label}). */
  Gill.addMaster = function (kind, seed, cell) {
    var b = curB(); if (!b || !guard(b, 2)) return;
    Gill._hold = cell ? cell.id : null; Gill._addCell = cell || null;
    var f = function (id, label, val, extra) { return '<label class="fld" for="' + id + '">' + label + '</label><input id="' + id + '" type="text" value="' + esc(val || '') + '"' + (extra || '') + '>'; };
    var html;
    if (kind === 'truck') {
      if (!Gill.trucks) return;
      html = Gill.trucks.formHtml(null, seed, true);
    } else if (kind === 'supplier') {
      html = '<div class="app-modal-h">Add supplier</div><div class="app-modal-b gl-add"><div id="glAddErr" class="qc-err hide"></div>' +
        f('glA_name', 'Supplier name *', seed) + '<div class="gl-add-2">' + f('glA_code', 'Code', '') + f('glA_cat', 'Category', App.wsSection === 'Diesel' ? 'Diesel' : '', ' list="glSupCats"') + '</div>' +
        '<datalist id="glSupCats"><option value="Diesel"><option value="Spare parts"><option value="Tyres"><option value="Services"></datalist>' +
        '<div class="gl-add-2">' + f('glA_phone', 'Phone number', '') + f('glA_trn', 'TRN number', '') + '</div>' +
        '<p class="gl-hint">Saved in Purchases → Suppliers. “Diesel” suppliers are listed first in Diesel.</p></div>';
    } else {
      html = '<div class="app-modal-h">Add driver</div><div class="app-modal-b gl-add"><div id="glAddErr" class="qc-err hide"></div>' +
        f('glA_name', 'Name *', seed) + '<div class="gl-add-2">' + f('glA_code', 'Code', '') + f('glA_phone', 'Mobile', '') + '</div>' +
        '<div class="gl-add-2">' + f('glA_dl', 'Driving licence no.', '') + f('glA_veh', 'Assigned truck no.', '') + '</div>' +
        '<label class="chk-row"><input type="checkbox" checked disabled> Is driver</label>' +
        '<p class="gl-hint">Saved in Payroll → Employees as an Active employee with <b>Is driver</b> ticked. Add the rest (documents, pay setup) there, or open the <a class="led-link" onclick="Gill.fullDriverForm()">full employee form</a>.</p></div>';
    }
    if (kind !== 'truck') html += '<div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="Gill.addCancel()">Cancel</button><button class="btn btn-primary" onclick="Gill.addSave(\'' + kind + '\')">Add</button></div>';
    App._openOverlay(html);
    var ov = byId('appOverlay');
    if (ov) { ov.onclick = null; ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); Gill.addCancel(); } if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); if (kind === 'truck') Gill.trucks.saveForm(); else Gill.addSave(kind); } }); }
    setTimeout(function () { var n = byId(kind === 'truck' ? 'glT_no' : 'glA_name'); if (n) { n.focus(); try { n.select(); } catch (e) {} } }, 0);
  };
  function addErr(msg) { var e = byId('glAddErr'); if (e) { e.textContent = msg; e.classList.remove('hide'); } else toast(msg); }
  function val(id) { var e = byId(id); return e ? String(e.value || '').trim() : ''; }
  /** creates the supplier / driver from the dialog (or from vals, for tests) -> the name, or null */
  Gill.addSave = function (kind, vals) {
    var b = curB(); if (!b) return null;
    vals = vals || { name: val('glA_name'), code: val('glA_code'), category: val('glA_cat'), phone: val('glA_phone'), trn: val('glA_trn'), dlNo: val('glA_dl'), vehicleNo: val('glA_veh') };
    var name = String(vals.name || '').trim();
    if (!name) { addErr((kind === 'supplier' ? 'Supplier name' : 'Name') + ' is required.'); return null; }
    if (kind === 'supplier') {
      var res = App.createEntityRecord('suppliers', { name: name, code: vals.code || '', category: vals.category || '', phone: vals.phone || '', trn: vals.trn || '' });
      if (!res.ok) { addErr(res.error); return null; }
      name = res.record.name;
    } else {
      var R = b.records = b.records || {}, emps = (R.employees || []).slice();
      if (emps.some(function (e) { return e && lc(e.name || e.empName) === lc(name); })) { addErr('An employee called “' + name + '” already exists. Open Payroll → Employees and tick “Is driver” on that employee.'); return null; }
      if (vals.code && emps.some(function (e) { return e && lc(e.code) === lc(vals.code); })) { addErr('Code ' + vals.code + ' is already used by another employee.'); return null; }
      var rec = { name: name, code: vals.code || '', phone: vals.phone || '', designation: 'Driver', isDriver: '1', status: 'Active', dlNo: vals.dlNo || '', vehicleNo: vals.vehicleNo || '', lines: [], pay: { earnings: [], deductions: [], contributions: [] } };
      rec.id = Date.now() + Math.floor(Math.random() * 1000); rec.uuid = App.uuid ? App.uuid() : String(rec.id);
      emps.push(rec); R.employees = emps;
      try { App._logActivity(b, 'create', 'employees', rec, null); } catch (e) {}
      App.saveBiz(b);
    }
    Gill.addDone(name);
    return name;
  };
  Gill.addCancel = function () { var c = Gill._addCell; Gill._hold = null; Gill._addCell = null; try { App._closeOverlay(); } catch (e) {} if (c) { Gill.st(c.label).focusNext = { id: c.id, k: c.k }; rerender(); } };
  /** after a truck / supplier / driver was added from a cell: fill it in and carry on from that cell */
  Gill.addDone = function (name) {
    var c = Gill._addCell; Gill._hold = null; Gill._addCell = null;
    try { App._closeOverlay(); } catch (e) {}
    toast('Added ' + name);
    if (c && name) { var r = Gill.setField(c.id, c.k, name, c.label); Gill.st(c.label).focusNext = { id: c.id, k: c.k }; if (r !== 'ok') toast('Added — pick it from the list'); }
    rerender();
  };
  /** the driver dialog's "full employee form" link: the Employee form with Is driver ticked, back to this page after */
  Gill.fullDriverForm = function () {
    var name = val('glA_name'); Gill._hold = null; Gill._addCell = null;
    try { App._closeOverlay(); } catch (e) {}
    App.recReturn = App._snapNav ? App._snapNav() : null; App.histReturn = false;
    App._prefill = { name: name, isDriver: '1', designation: 'Driver', status: 'Active' };
    App.wsSection = 'Employees'; App.editingId = null; App.wsMode = 'form';
    App.renderWorkspace();
  };

  /* ------------------------------------------------------------------ rendering */
  function cellText(c, v) {
    if (v == null || v === '') return '';
    if (c.t === 'date') return fmtD(v);
    if (c.t === 'num') return String(c.dec === 3 ? r3(v) : r2(v));
    return String(v);
  }
  function calcText(b, c, r) { var v = c.calc(b, r); return (v === '' || v == null) ? '' : (c.dec === 3 ? qtyFmt(v) : money(v)); }
  function datalists(b, p) {
    var seen = {};
    return p.cols.filter(function (c) { return c.src && !c.pick && !seen[c.src] && (seen[c.src] = 1); }).map(function (c) {
      return '<datalist id="gl-dl-' + c.src + '">' + Gill.source(b, c.src).map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>';
    }).join('');
  }
  Gill.gridHtml = function (b, p, lvl) {
    if (lvl == null) lvl = Gill.level(b, p.label);
    var noSel = lvl < 2 ? ' disabled' : '';
    var st = Gill.st(p.label), rows = Gill.visible(b, p), t = Gill.totals(b, p, rows);
    var allSel = rows.length && rows.every(function (r) { return st.sel[r.id] || (p.selectable && !p.selectable(b, r)); }) && Object.keys(st.sel).length;
    var head = '<th class="gl-sel"><input type="checkbox" tabindex="-1" title="Select all shown"' + noSel + ' ' + (allSel ? 'checked ' : '') + 'onchange="Gill.selAll(this.checked)"></th><th class="gl-n">#</th>' +
      p.cols.map(function (c) { return '<th class="' + (c.t === 'num' || c.t === 'calc' ? 'r ' : '') + 'gl-c-' + c.k + '">' + esc(c.label) + '</th>'; }).join('') +
      (p.extraHead ? p.extraHead(b) : '');
    /* registered names per pick column, to show older values that are not registered in orange */
    var reg = {};
    p.cols.forEach(function (c) { if (c.pick && !reg[c.pick]) { reg[c.pick] = {}; Gill.pickOptions(b, c.pick).forEach(function (o) { reg[c.pick][lc(o.v).replace(/\s+/g, ' ')] = 1; }); } });
    var body = rows.map(function (r, ri) {
      var lk = locked(b, p, r), sel = !!st.sel[r.id];
      var ro = !lk && (lvl < 2 || (lvl < 3 && !st.fresh[r.id]));   // permission: read-only cells
      var cells = p.cols.map(function (c) {
        if (c.t === 'calc') return '<td class="r gl-calc" id="gl-c-' + r.id + '-' + c.k + '">' + calcText(b, c, r) + '</td>';
        var typ = c.t === 'num' ? ' inputmode="decimal"' : '';
        var un = c.pick && !blank(r[c.k]) && !reg[c.pick][lc(r[c.k]).replace(/\s+/g, ' ')], P = c.pick ? Gill.PICKS[c.pick] : null;
        var inp = '<input class="gl-cell' + (c.t === 'num' ? ' r' : '') + (c.pick ? ' gl-pick' : '') + (un ? ' gl-unreg' : '') + '" type="text" autocomplete="off"' + typ +
          (c.src && !c.pick ? ' list="gl-dl-' + c.src + '"' : '') + (c.pick ? ' data-pick="' + c.pick + '" role="combobox" aria-autocomplete="list" aria-expanded="false"' : '') +
          (un ? ' title="' + esc(P.not + ' — choose one from the list (' + P.where + ')') + '"' : '') +
          (c.t === 'date' ? ' placeholder="' + esc(App.datePlaceholder ? App.datePlaceholder() : 'dd/mm/yyyy') + '"' : '') +
          ' data-id="' + r.id + '" data-k="' + c.k + '" data-ri="' + ri + '" value="' + esc(cellText(c, r[c.k])) + '"' + (lk ? ' disabled' : ro ? ' readonly' : '') +
          ' aria-label="' + esc(c.label) + ' row ' + (ri + 1) + '"' +
          ' oninput="Gill.cellInput(this)" onchange="Gill.cellChange(this)" onkeydown="Gill.cellKey(event,this)" onfocus="Gill.cellFocus(this)" onblur="Gill.cellBlur(this,event)" onclick="Gill.cellClick(this)">';
        if (c.t === 'date' && !lk && !ro) inp = '<div class="gl-dwrap">' + inp + '<button type="button" class="gl-cal" tabindex="-1" aria-label="Open calendar" title="Calendar (Alt+↓)" onmousedown="event.preventDefault()" onclick="Gill.calBtn(this)">' + CAL_ICO + '</button></div>';
        if (c.pick && !lk && !ro) inp = '<div class="gl-pwrap">' + inp + '<span class="gl-caret" aria-hidden="true">▾</span></div>';
        return '<td class="' + (c.t === 'num' ? 'r ' : '') + 'gl-c-' + c.k + '">' + inp + '</td>';
      }).join('');
      return '<tr class="' + (lk ? 'gl-locked ' : '') + (sel ? 'gl-rsel' : '') + '" data-row="' + r.id + '">' +
        '<td class="gl-sel"><input type="checkbox" tabindex="-1"' + noSel + (sel ? ' checked' : '') + ' onchange="Gill.toggleSel(\'' + r.id + '\',this.checked)" aria-label="Select row ' + (ri + 1) + '"></td>' +
        '<td class="gl-n">' + (ri + 1) + '</td>' + cells + (p.extraCells ? p.extraCells(b, r) : '') + '</tr>';
    }).join('');
    if (!rows.length) body = '<tr><td colspan="' + (p.cols.length + 2 + (p.extraHead ? 1 : 0)) + '"><div class="gl-empty">' +
      (Gill.rows(b, p).length ? 'No ' + esc(p.label.toLowerCase()) + ' match the filters.' : 'No ' + esc(p.noun) + ' yet.' + (lvl >= 2 ? ' Click <b>+ Add row</b>, or paste rows copied from Excel.' : '')) + '</div></td></tr>';
    var firstTot = p.cols.findIndex(function (c) { return c.total; });
    var foot = '<tr><td class="gl-sel"></td><td class="gl-n"></td><td colspan="' + Math.max(1, firstTot) + '" class="gl-tot-l" id="gl-tot-n">' + esc(totLabel(p, t.n)) + '</td>' +
      p.cols.slice(Math.max(1, firstTot)).map(function (c) { return c.total ? '<td class="r" id="gl-tot-' + c.k + '">' + (c.dec === 3 ? qtyFmt(t[c.k]) : money(t[c.k])) + '</td>' : '<td></td>'; }).join('') +
      (p.extraHead ? '<td></td>' : '') + '</tr>';
    return datalists(b, p) + '<div class="gl-grid-wrap"><table class="gl-grid" data-enter-nav="off" onpaste="Gill.onPaste(event)"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  };
  function filterBar(b, p) {
    var st = Gill.st(p.label), f = st.f, rows = Gill.rows(b, p);
    var sel = function (fl) {
      var opts;
      if (fl.pick) {                      // the registered list; older names that are not registered under one entry
        opts = Gill.pickOptions(b, fl.pick).map(function (o) { return o.v; });
        if (rows.some(function (r) { return !blank(r[fl.k]) && !Gill.pickMatch(b, fl.pick, r[fl.k]); }) || f[fl.k] === UNREG) opts.push([UNREG, '⚠ Not registered']);
      } else opts = fl.options ? fl.options(b) : sortStr(uniq(rows.map(function (r) { return r[fl.k]; })));
      return '<label class="gl-f"><span>' + esc(fl.label) + '</span><select onchange="Gill.setFilter(\'' + fl.k + '\',this.value)"><option value="">All</option>' +
        opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(f[fl.k] || '') === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select></label>';
    };
    var any = Object.keys(f).some(function (k) { return !blank(f[k]); });
    return '<div class="gl-filters">' +
      '<label class="gl-f"><span>From</span><input type="date" value="' + esc(f.from || '') + '" onchange="Gill.setFilter(\'from\',this.value)"></label>' +
      '<label class="gl-f"><span>To</span><input type="date" value="' + esc(f.to || '') + '" onchange="Gill.setFilter(\'to\',this.value)"></label>' +
      (p.filters || []).map(sel).join('') +
      (any ? '<button class="btn btn-xs gl-clear" onclick="Gill.clearFilters()">Clear filters</button>' : '') + '</div>';
  }
  /* grouped summary ("report") */
  Gill.report = function (b, p, g) {
    var grp = (p.groups || []).find(function (x) { return x[0] === g; }) || p.groups[0];
    var rows = Gill.visible(b, p).filter(function (r) { return !rowBlank(p, r); }), map = {}, order = [];
    rows.forEach(function (r) {
      var k = grp[0] === 'month' ? String(r.date || '').slice(0, 7) : String(r[grp[0]] || '').trim();
      k = k || '(blank)';
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(r);
    });
    order.sort(function (x, y) { if (x === '(blank)') return 1; if (y === '(blank)') return -1; return x.localeCompare(y, undefined, { numeric: true }); });
    var lines = order.map(function (k) { return { key: k, label: grp[0] === 'month' && k !== '(blank)' ? monthName(k) : k, t: p.reportRow(b, map[k]) }; });
    return { group: grp, lines: lines, total: p.reportRow(b, rows) };
  };
  function monthName(ym) { var p = ym.split('-'); var n = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(+p[1]) - 1]; return n ? n + ' ' + p[0] : ym; }
  function reportTable(b, p, rep) {
    var cols = p.reportCols;
    var cell = function (c, v) { return '<td class="r">' + (c.dec === 3 ? qtyFmt(v) : c.int ? String(v) : money(v)) + '</td>'; };
    return '<div class="gl-grid-wrap"><table class="reg-tbl gl-rep"><thead><tr><th>' + esc(rep.group[1]) + '</th>' + cols.map(function (c) { return '<th class="r">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rep.lines.length ? rep.lines.map(function (L) { return '<tr><td>' + esc(L.label) + '</td>' + cols.map(function (c) { return cell(c, L.t[c.k]); }).join('') + '</tr>'; }).join('') :
        '<tr><td colspan="' + (cols.length + 1) + '"><div class="gl-empty">Nothing to report for these filters.</div></td></tr>') +
      '</tbody><tfoot><tr><td>Total</td>' + cols.map(function (c) { return cell(c, rep.total[c.k]); }).join('') + '</tr></tfoot></table></div>';
  }
  Gill.pageHtml = function (b, label, lvl) {
    var p = Gill.pages[label], st = Gill.st(label);
    if (lvl == null) lvl = Gill.level(b, label);
    /* tidy: empty rows are dropped, except the one being typed in (a row just added) */
    var g = Gill.data(b), before = g[p.store].length, keep = st.focusNext ? st.focusNext.id : st.cur;
    g[p.store] = g[p.store].filter(function (r) { return String(r.id) === String(keep) || String(r.id) === String(Gill._hold) || !rowBlank(p, r) || locked(b, p, r); });
    if (Gill._takeMigrated() || g[p.store].length !== before) { try { App.saveBiz(b); } catch (e) {} }
    var I = function (n) { return G.ICO ? ICO.get(n, 15) : ''; };
    var rep = st.view === 'report';
    var tools = rep || lvl < 2 ? '' :
      '<button class="btn btn-primary btn-xs" onclick="Gill.addRow()">+ Add row</button>' +
      '<button class="btn btn-xs" onclick="Gill.dupRows()" title="Duplicate the current or ticked rows (Ctrl+D)">Duplicate</button>' +
      (lvl >= 4 ? '<button class="btn btn-xs" onclick="Gill.deleteRows()">Delete</button>' : '') +
      '<button class="btn btn-xs" onclick="Gill.pasteDialog()" title="Paste rows copied from Excel">Paste rows</button>';
    var groupSel = rep ? '<label class="gl-f gl-f-inline"><span>Group by</span><select onchange="Gill.setGroup(this.value)">' +
      p.groups.map(function (x) { return '<option value="' + x[0] + '"' + ((st.g || p.groups[0][0]) === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' : '';
    return App.crumb(label) +
      '<div class="gl-page" data-gill="' + esc(p.store) + '">' +
      '<div class="reg-panel-head gl-head"><span class="reg-panel-title">' + esc(label) + '</span>' +
      '<div class="seg-sw gl-views"><button class="' + (rep ? '' : 'on') + '" onclick="Gill.setView(\'entries\')">Entries</button><button class="' + (rep ? 'on' : '') + '" onclick="Gill.setView(\'report\')">Report</button></div>' +
      '<div class="gl-tools">' + tools + groupSel +
      '<button class="btn btn-xs" onclick="Gill.exportCsv()">' + I('download') + ' CSV</button>' +
      '<button class="btn btn-xs" onclick="Gill.print()">Print</button>' +
      '<span class="gl-saved" id="glSaved" aria-live="polite"></span></div></div>' +
      (lvl < 2 ? '<div class="perm-ro-note">View only — your permissions do not allow changes on this page.</div>' : '') +
      filterBar(b, p) +
      (p.topHtml && !rep ? p.topHtml(b, lvl) : '') +
      (rep ? reportTable(b, p, Gill.report(b, p, st.g)) : Gill.gridHtml(b, p, lvl)) +
      (rep || lvl < 2 ? '' : '<div class="gl-help">Enter or Tab moves to the next cell (a new row after the last one) · ↑ ↓ move between rows · Ctrl+D duplicates · paste a block copied from Excel into any cell. Changes save automatically.</div>') +
      '</div>';
  };

  /* ------------------------------------------------------------------ CSV + print */
  function tableData(b, p) {
    var st = Gill.st(p.label);
    if (st.view === 'report') {
      var rep = Gill.report(b, p, st.g);
      var hdr = [rep.group[1]].concat(p.reportCols.map(function (c) { return c.label; }));
      var val = function (c, v) { return c.dec === 3 ? r3(v) : c.int ? v : r2(v).toFixed(2); };
      var body = rep.lines.map(function (L) { return [L.label].concat(p.reportCols.map(function (c) { return val(c, L.t[c.k]); })); });
      var tot = ['Total'].concat(p.reportCols.map(function (c) { return val(c, rep.total[c.k]); }));
      return { hdr: hdr, body: body, tot: tot, title: p.label + ' by ' + rep.group[1], numCols: p.reportCols.map(function (c, i) { return i + 1; }) };
    }
    var rows = Gill.visible(b, p).filter(function (r) { return !rowBlank(p, r); }), t = Gill.totals(b, p, rows);
    var cols = p.cols.concat(p.csvExtra || []);
    var out = function (c, r) { if (c.get) return c.get(b, r); if (c.t === 'calc') { var v = c.calc(b, r); return v === '' ? '' : (c.dec === 3 ? r3(v) : r2(v).toFixed(2)); } if (c.t === 'date') return fmtD(r[c.k]); return r[c.k] == null ? '' : r[c.k]; };
    return {
      hdr: cols.map(function (c) { return c.label; }),
      body: rows.map(function (r) { return cols.map(function (c) { return out(c, r); }); }),
      tot: cols.map(function (c, i) { return i === 0 ? 'Total (' + t.n + ')' : c.total ? (c.dec === 3 ? r3(t[c.k]) : r2(t[c.k]).toFixed(2)) : ''; }),
      title: p.label, numCols: cols.map(function (c, i) { return (c.t === 'num' || c.t === 'calc') ? i : -1; }).filter(function (i) { return i >= 0; })
    };
  }
  Gill.csv = function (b, p) {
    var d = tableData(b, p);
    return [d.hdr].concat(d.body, [d.tot]).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  };
  Gill.exportCsv = function () {
    var p = Gill.page(), b = curB(); if (!p || !b) return;
    var st = Gill.st(p.label);
    App._download('gill-' + p.store + (st.view === 'report' ? '-report' : '') + '-' + todayIso() + '.csv', '﻿' + Gill.csv(b, p));
  };
  function filterText(b, p) {
    var f = Gill.st(p.label).f, parts = [];
    if (f.from || f.to) parts.push((f.from ? fmtD(f.from) : '…') + ' – ' + (f.to ? fmtD(f.to) : '…'));
    (p.filters || []).forEach(function (fl) { if (!blank(f[fl.k])) parts.push(fl.label + ': ' + (f[fl.k] === UNREG ? 'not registered' : f[fl.k])); });
    return parts.join(' · ');
  }
  Gill.printHtml = function (b, p) {
    var d = tableData(b, p), num = {}; d.numCols.forEach(function (i) { num[i] = 1; });
    var td = function (tag, v, i) { return '<' + tag + (num[i] ? ' style="text-align:right"' : '') + '>' + esc(v) + '</' + tag + '>'; };
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.title) + '</title><style>' +
      'body{font:12px/1.35 Inter,Segoe UI,Arial,sans-serif;color:#111;margin:14mm 10mm}h1{font-size:17px;margin:0}' +
      '.sub{color:#555;margin:2px 0 12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cfd5dd;padding:4px 6px;vertical-align:top}' +
      'th{background:#f1f4f8;text-align:left;font-size:10.5px;text-transform:uppercase}tfoot td{font-weight:700;background:#f7f8fa}@page{size:landscape;margin:10mm}' +
      '</style></head><body><h1>' + esc(b.name) + ' — ' + esc(d.title) + '</h1><div class="sub">' + esc(filterText(b, p) || 'All entries') + ' · printed ' + esc(fmtD(todayIso())) + '</div>' +
      '<table><thead><tr>' + d.hdr.map(function (h, i) { return td('th', h, i); }).join('') + '</tr></thead><tbody>' +
      d.body.map(function (r) { return '<tr>' + r.map(function (v, i) { return td('td', v, i); }).join('') + '</tr>'; }).join('') +
      '</tbody><tfoot><tr>' + d.tot.map(function (v, i) { return td('td', v, i); }).join('') + '</tr></tfoot></table></body></html>';
  };
  Gill.print = function () {
    var p = Gill.page(), b = curB(); if (!p || !b || !hasDom()) return;
    var html = Gill.printHtml(b, p);
    var fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(fr);
    var w = fr.contentWindow, d = w.document; d.open(); d.write(html); d.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} setTimeout(function () { fr.remove(); }, 1500); }, 60);
  };

  /* ------------------------------------------------------------------ Trips */
  var money2 = { t: 'num', total: 1 };
  Gill.pages.Trips = {
    label: 'Trips', store: 'trips', noun: 'trips', noun1: 'trip',
    cols: [
      { k: 'date', label: 'Date', t: 'date' },
      { k: 'ticket', label: 'Ticket No', t: 'text', alias: ['Ticket', 'Ticket Number'] },
      { k: 'truck', label: 'Truck No', t: 'text', pick: 'truck', alias: ['Truck', 'Truck Number', 'Vehicle'] },
      { k: 'driver', label: 'Driver Name', t: 'text', pick: 'driver', alias: ['Driver'] },
      { k: 'account', label: 'Account', t: 'text', src: 'account', alias: ['Customer'] },
      { k: 'crusher', label: 'Crusher Name', t: 'text', src: 'crusher', alias: ['Crusher'] },
      { k: 'dest', label: 'Destination', t: 'text', src: 'dest' },
      { k: 'material', label: 'Material', t: 'text', src: 'material' },
      { k: 'vessel', label: 'Vessel', t: 'text', src: 'vessel' },
      { k: 'weight', label: 'Weight', t: 'num', total: 1, dec: 3, alias: ['Weight (t)', 'Tons', 'Tonnes'] },
      Object.assign({ k: 'gillFnrc', label: 'Gill FNRC' }, money2),
      Object.assign({ k: 'otherFnrc', label: 'Other FNRC' }, money2),
      Object.assign({ k: 'aberToll', label: 'Aber Toll' }, money2),
      Object.assign({ k: 'sharjahToll', label: 'Sharjah Toll' }, money2),
      { k: 'desc', label: 'Description', t: 'text', alias: ['Remarks', 'Notes'] },
    ],
    filters: [{ k: 'truck', label: 'Truck', pick: 'truck' }, { k: 'driver', label: 'Driver', pick: 'driver' }, { k: 'crusher', label: 'Crusher' }, { k: 'material', label: 'Material' }, { k: 'account', label: 'Account' }],
    groups: [['truck', 'Truck'], ['driver', 'Driver'], ['crusher', 'Crusher'], ['month', 'Month']],
    reportCols: [{ k: 'n', label: 'Trips', int: 1 }, { k: 'weight', label: 'Weight', dec: 3 }, { k: 'gillFnrc', label: 'Gill FNRC' }, { k: 'otherFnrc', label: 'Other FNRC' },
      { k: 'aberToll', label: 'Aber Toll' }, { k: 'sharjahToll', label: 'Sharjah Toll' }, { k: 'charges', label: 'Total charges' }],
    reportRow: function (b, rows) {
      var t = Gill.totals(b, this, rows);
      t.charges = r2(t.gillFnrc + t.otherFnrc + t.aberToll + t.sharjahToll);
      return t;
    },
  };

  Gill.registerModule('trips', 'Trips', 'truck', 'Daily trip sheet: ticket, truck, driver, crusher, destination, material, weight, FNRC and tolls, with a grouped report, CSV and print.');

  /* reminders: none needed for this module */
})(typeof window !== 'undefined' ? window : globalThis);
