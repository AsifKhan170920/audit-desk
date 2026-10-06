/* ===================== list tools =====================
   Everything the register lists and ledgers share, layered over js/app.js
   without editing it. Loaded right after app.js (and before users.js, so the
   permission wrappers in users.js wrap these versions).

   - one date formatter (Settings > Date & Number Format, default DD/MM/YYYY)
     used by lists, views, ledgers, reports and History
   - money(): negatives as "-1,234.00", shown in red in tables
   - amount in words with the currency: "AED Two Thousand Dirhams only"
   - "ADCB - ADCB" shown once; Type values capitalised
   - list table: sortable headers (type-aware, empties last, whole data set,
     state per tab in localStorage and ?sort=&dir= in the URL), ✎ / 👁 header
     icons, nowrap Code / Reference / Date, Name min-width, horizontal scroll,
     footer Total row under the amount column(s), auto-hidden empty columns
   - bulk delete: checkbox column, Select All (indeterminate), "N selected —
     Delete | Cancel" bar, app confirm modal
   - Batch Operations: Import, Bulk delete, Batch Update (edit via CSV)
   - Edit columns as its own page: drag handle + ↑/↓ + checkbox, Update,
     Reset to default, saved per tab on the business
   - Receipts / Payments (and other transactions) "Journal" column
   - ledger tables: the same sortable headers
*/
(function () {
  'use strict';
  if (typeof App === 'undefined' || App.__listTools) return;
  App.__listTools = 1;

  var hasDoc = typeof document !== 'undefined' && document && typeof document.getElementById === 'function';
  var win = typeof window !== 'undefined' ? window : null;
  function M() { return (win && win.UIModal) || null; }
  function modalAlert(t) { var m = M(); if (m) return m.alert(t); try { alert(t); } catch (e) {} return Promise.resolve(); }
  function modalConfirm(t, o) { var m = M(); if (m) return m.confirm(t, o); return Promise.resolve(true); }
  function toast(t) { var m = M(); if (m && m.toast) m.toast(t); }
  function esc(s) { return App.esc(s == null ? '' : s); }

  /* =====================================================================
     D. data display
     ===================================================================== */
  var DEFAULT_DATE = 'DD/MM/YYYY';
  var origFmtNow = App.fmtNow;
  App.fmtNow = function () {
    var r = origFmtNow.apply(this, arguments);
    var b = this.openBiz != null ? this.curBiz() : null;
    if (!(b && b.fmt && b.fmt.date)) r.date = DEFAULT_DATE;
    return r;
  };
  /* One formatter for every date the app shows. Accepts YYYY-MM-DD and full
     ISO timestamps; anything else is shown as typed. */
  App.fmtDateUS = function (iso) {
    if (iso == null || iso === '') return '';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso));
    if (!m) return this.esc(iso);
    var Y = m[1], Mo = ('0' + m[2]).slice(-2), D = ('0' + m[3]).slice(-2);
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    switch (this.fmtNow().date) {
      case 'MM/DD/YYYY': return Mo + '/' + D + '/' + Y;
      case 'YYYY-MM-DD': return Y + '-' + Mo + '-' + D;
      case 'D MMM YYYY': return (+D) + ' ' + mon[(+Mo) - 1] + ' ' + Y;
      default: return D + '/' + Mo + '/' + Y;
    }
  };
  App.fmtDate = function (iso) { return this.fmtDateUS(iso); };
  /* History / Emails timestamps: the same date format plus local time */
  App._fmtTs = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso);
    var p = function (n) { return String(n).padStart(2, '0'); };
    var local = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return this.fmtDateUS(local) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  /* negatives as "-1,234.00" — no space after the minus */
  var origMoney = App.money;
  App.money = function (n) {
    var s = origMoney.apply(this, arguments);
    return s.indexOf('- ') === 0 ? '-' + s.slice(2) : s;
  };

  /* Amount in words with the currency: "AED Two Thousand Dirhams only",
     "AED One Hundred Dirhams and Fifty Fils only". */
  var CUR_WORDS = {
    AED: ['Dirham', 'Dirhams', 'Fils', 'Fils'], USD: ['Dollar', 'Dollars', 'Cent', 'Cents'],
    EUR: ['Euro', 'Euros', 'Cent', 'Cents'], GBP: ['Pound', 'Pounds', 'Penny', 'Pence'],
    SAR: ['Riyal', 'Riyals', 'Halala', 'Halalas'], QAR: ['Riyal', 'Riyals', 'Dirham', 'Dirhams'],
    OMR: ['Rial', 'Rials', 'Baisa', 'Baisa'], KWD: ['Dinar', 'Dinars', 'Fils', 'Fils'],
    BHD: ['Dinar', 'Dinars', 'Fils', 'Fils'], PKR: ['Rupee', 'Rupees', 'Paisa', 'Paisa'],
    INR: ['Rupee', 'Rupees', 'Paisa', 'Paise'], AUD: ['Dollar', 'Dollars', 'Cent', 'Cents'],
    CAD: ['Dollar', 'Dollars', 'Cent', 'Cents'], SGD: ['Dollar', 'Dollars', 'Cent', 'Cents'],
    NZD: ['Dollar', 'Dollars', 'Cent', 'Cents']
  };
  function words(n) {
    var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    var grp = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
    var sub = function (x) { var s = ''; if (x >= 100) { s += ones[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) s += ' '; }
      if (x >= 20) { s += tens[Math.floor(x / 10)]; x %= 10; if (x) s += '-' + ones[x]; } else if (x > 0) s += ones[x]; return s; };
    if (!n) return 'Zero';
    var parts = [], gi = 0;
    while (n > 0) { var c = n % 1000; if (c) parts.unshift(sub(c) + (grp[gi] ? ' ' + grp[gi] : '')); n = Math.floor(n / 1000); gi++; }
    return parts.join(' ');
  }
  App.amountInWords = function (n, cur) {
    n = Number(n) || 0; var neg = n < 0; n = Math.abs(n);
    var whole = Math.floor(n + 1e-9), cents = Math.round((n - whole) * 100);
    if (cents === 100) { whole += 1; cents = 0; }
    var b = this.openBiz != null ? this.curBiz() : null;
    var code = String(cur || (b && (b.baseCurrency || b.currency)) || '').trim();
    var cw = CUR_WORDS[code.toUpperCase()] || null;
    var out = (code ? code + ' ' : '') + words(whole);
    if (cw) out += ' ' + (whole === 1 ? cw[0] : cw[1]);
    if (cents) out += ' and ' + words(cents) + (cw ? ' ' + (cents === 1 ? cw[2] : cw[3]) : '/100');
    out += ' only';
    return (neg ? 'Minus ' : '') + out;
  };

  /* "ADCB - ADCB" (code and name the same) shown once */
  App.dispAcct = function (s) {
    if (s == null) return '';
    var str = String(s), m = /^\s*(.+?)\s+[-–—]\s+(.+?)\s*$/.exec(str);
    if (m && m[1].toLowerCase() === m[2].toLowerCase()) return m[2];
    return str;
  };
  /* "Code - Name" for pickers, but the name alone when there is no code or
     the code repeats the name */
  App.codeName = function (code, name) {
    code = code == null ? '' : String(code).trim(); name = name == null ? '' : String(name);
    if (!code || code.toLowerCase() === name.trim().toLowerCase()) return name;
    return code + ' - ' + name;
  };
  App.capLabel = function (s) { s = String(s == null ? '' : s); return s.charAt(0).toUpperCase() + s.slice(1); };

  /* =====================================================================
     column model
     ===================================================================== */
  var LED = { customers: 1, suppliers: 1, employees: 1, capital: 1, inventory: 1, fixedAssets: 1, bankCash: 1 };
  var OPT_KEYS = {}; (typeof INV_OPTS_FORM !== 'undefined' ? INV_OPTS_FORM : []).forEach(function (f) { OPT_KEYS[f.key] = 1; });
  ['dueType', 'dueDays', 'bankDetails', 'disclaimer'].forEach(function (k) { OPT_KEYS[k] = 1; });
  var ACCT_KEYS = { receivedIn: 1, paidFrom: 1, bank: 1, account: 1 };
  var NO_SUM = { avgCost: 1, salesPrice: 1, purchasePrice: 1, rate: 1, price: 1, unitPrice: 1, marketPrice: 1, statementBalance: 1, creditLimit: 1 };

  function sectionKey() { return LABEL2KEY[App.wsSection]; }
  function listColsStore(b) { b.details = b.details || {}; b.details.listCols = b.details.listCols || {}; return b.details.listCols; }
  function customDefs(b, key) {
    var c = b && b.formConfig && b.formConfig[key];
    return ((c && c.custom) || []).filter(function (x) { return x && x.key && x.type !== 'line' && x.label; });
  }

  /* Every column a tab can show: the built-in list columns (in their Manager
     order), then the form's own fields, then the tab's custom fields, then the
     Ledger / Journal link. No key and no label appears twice. */
  App._colPool = function (c, b) {
    var pool = [], seenK = {}, seenL = {};
    b = b || this.curBiz();
    var key = null; Object.keys(REG).forEach(function (k) { if (REG[k] === c) key = k; });
    var add = function (col) {
      if (!col || !col.key || seenK[col.key]) return;
      var lab = String(col.label || col.key).trim().toLowerCase();
      if (seenL[lab]) return;
      seenK[col.key] = 1; seenL[lab] = 1; pool.push(col);
    };
    (c.columns || []).forEach(function (col) { add(Object.assign({ builtin: 1 }, col, { label: App.capLabel(col.label) })); });
    (c.form || []).forEach(function (f) {
      if (!f.key || OPT_KEYS[f.key] || f.type === 'check') return;
      if (f.key === 'dueDateManual') { add({ key: 'dueDate', label: 'Due date', kind: 'date' }); return; }
      var kind = f.type === 'date' ? 'date' : (f.type === 'money' ? 'money' : (f.type === 'number' ? 'num' : (f.type === 'account' ? 'account' : 'text')));
      add({ key: f.key, label: App.capLabel(f.label), kind: kind, r: (kind === 'money' || kind === 'num') ? 1 : 0 });
    });
    customDefs(b, key).forEach(function (x) {
      var num = x.dataType === 'number' || x.dataType === 'formula';
      add({ key: 'cf_' + x.key, label: App.capLabel(x.label), kind: num ? 'num' : 'text', r: num ? 1 : 0, custom: 1,
        calc: function (r) { return r && r.custom && r.custom[x.key] != null ? r.custom[x.key] : ''; } });
    });
    add({ key: '__ledger', label: (key && LED[key]) ? 'Ledger' : 'Journal', kind: 'ledger' });
    return pool;
  };

  function rawVal(col, r) { try { return col.calc ? col.calc(r) : r[col.key]; } catch (e) { return ''; } }
  function isEmptyVal(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

  /* default columns: the built-in ones, minus those empty in every row (the
     tab's main amount column always stays, so a missing figure is visible) */
  App._defaultColKeys = function (c, b, rows) {
    /* a tab with Manager's own default selection (REG.<key>.defaultCols) shows exactly that */
    if (c && Array.isArray(c.defaultCols) && c.defaultCols.length) return c.defaultCols.slice();
    rows = rows || ((b && b.records && b.records[sectionKeyOf(c)]) || []);
    return (c.columns || []).filter(function (col) {
      if (!rows.length || col.key === c.totalCol || col.key === 'name') return true;
      return rows.some(function (r) { return !isEmptyVal(rawVal(col, r)); });
    }).map(function (col) { return col.key; });
  };
  function sectionKeyOf(c) { var key = null; Object.keys(REG).forEach(function (k) { if (REG[k] === c) key = k; }); return key; }

  App._cols = function (c) {
    if (!c) return [];
    var b = this.curBiz(), key = sectionKeyOf(c);
    var pool = this._colPool(c, b), byKey = {};
    pool.forEach(function (col) { byKey[col.key] = col; });
    var saved = (b && b.details && b.details.listCols && b.details.listCols[key]) || null;
    var keys = (saved && saved.length) ? saved.map(function (k) { return String(k).indexOf('cf:') === 0 ? 'cf_' + String(k).slice(3) : k; }) : this._defaultColKeys(c, b);
    var out = []; keys.forEach(function (k) { if (byKey[k]) out.push(byKey[k]); });
    if (!out.length) out = (c.columns || []).map(function (col) { return byKey[col.key]; }).filter(Boolean);
    return out;
  };

  /* =====================================================================
     H. sorting
     ===================================================================== */
  var SORT_LS = 'mgr_list_sort';
  function sortStore() { try { return JSON.parse(localStorage.getItem(SORT_LS) || '{}') || {}; } catch (e) { return {}; } }
  function sortSave(s) { try { localStorage.setItem(SORT_LS, JSON.stringify(s)); } catch (e) {} }
  /* context key: one per list tab, one per kind of ledger */
  App._sortCtx = function () {
    if (this.wsMode === 'list') return 'list:' + sectionKey();
    if (this.wsMode === 'glledger') return 'ledger:gl';
    if (this.wsMode === 'ledger') return 'ledger:' + sectionKey();
    return null;
  };
  App.sortState = function (ctx) {
    ctx = ctx || this._sortCtx(); if (!ctx) return null;
    var s = sortStore()[ctx]; return (s && s.col) ? { col: s.col, dir: s.dir === 'desc' ? 'desc' : 'asc' } : null;
  };
  App.setSortState = function (ctx, col, dir) {
    var s = sortStore();
    if (!col) delete s[ctx]; else s[ctx] = { col: col, dir: dir === 'desc' ? 'desc' : 'asc' };
    sortSave(s); syncUrl();
  };
  /* 1st click ascending, 2nd descending, then back to ascending */
  function nextDir(ctx, col) { var cur = App.sortState(ctx); return (cur && cur.col === col && cur.dir === 'asc') ? 'desc' : 'asc'; }

  function numOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim(); if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    var n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return null;
    return neg ? -n : n;
  }
  var NUMERIC_TEXT = /^\(?-?\s*[\d,]+(\.\d+)?\)?$/;
  /* sort key for one cell: {e: empty?, t: 'n'|'d'|'s', v} */
  function sortKey(kind, v) {
    if (isEmptyVal(v)) return { e: 1 };
    if (kind === 'money' || kind === 'num') { var n = numOf(v); return n == null ? { e: 1 } : { t: 'n', v: n }; }
    if (kind === 'date') { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? { t: 's', v: m[0] } : { t: 's', v: String(v) }; }
    var s = String(v).trim();
    if (NUMERIC_TEXT.test(s)) { var nn = numOf(s); if (nn != null) return { t: 'n', v: nn }; }
    return { t: 's', v: s.toLowerCase() };
  }
  var collator = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) : null;
  function cmpKeys(a, b) {
    if (a.t === 'n' && b.t === 'n') return a.v - b.v;
    if (a.t === 'n') return -1; if (b.t === 'n') return 1;
    return collator ? collator.compare(a.v, b.v) : (a.v < b.v ? -1 : a.v > b.v ? 1 : 0);
  }
  /* Stable, type-aware sort; empty values always last, whatever the direction. */
  App.sortRows = function (rows, getKey, dir) {
    var desc = dir === 'desc';
    return rows.map(function (r, i) { return { r: r, i: i, k: getKey(r) }; }).sort(function (x, y) {
      if (x.k.e && y.k.e) return x.i - y.i;
      if (x.k.e) return 1; if (y.k.e) return -1;
      var c = cmpKeys(x.k, y.k); if (desc) c = -c;
      return c || (x.i - y.i);
    }).map(function (o) { return o.r; });
  };
  App.listSort = function (col) {
    var ctx = 'list:' + sectionKey();
    this.setSortState(ctx, col, nextDir(ctx, col));
    this.pageNum = 1;
    var w = hasDoc ? document.getElementById('regBody') : null;
    if (w) w.innerHTML = this.tableHtml(this.curBiz()); else this.renderWorkspace();
    syncUrl();
  };
  App.listSortClear = function () { this.setSortState('list:' + sectionKey(), null); this.renderWorkspace(); };

  /* ?sort=amount&dir=desc mirrors the active tab's sort (other params kept) */
  var urlRead = false;
  function syncUrl() {
    if (!win || !win.history || !win.history.replaceState || !win.location || typeof URLSearchParams === 'undefined') return;
    try {
      var ctx = App._sortCtx(), st = ctx ? App.sortState(ctx) : null;
      var u = new URL(win.location.href);
      if (st) { u.searchParams.set('sort', st.col); u.searchParams.set('dir', st.dir); }
      else { u.searchParams.delete('sort'); u.searchParams.delete('dir'); }
      if (u.href !== win.location.href) win.history.replaceState(win.history.state, '', u.href);
    } catch (e) {}
  }
  /* a link opened with ?sort= applies to the first list / ledger shown */
  function adoptUrl() {
    if (urlRead || !win || !win.location || typeof URLSearchParams === 'undefined') return;
    var ctx = App._sortCtx(); if (!ctx) return;
    urlRead = true;
    try {
      var q = new URLSearchParams(win.location.search || ''), col = q.get('sort');
      if (col) { var s = sortStore(); s[ctx] = { col: col, dir: q.get('dir') === 'desc' ? 'desc' : 'asc' }; sortSave(s); }
    } catch (e) {}
  }

  /* =====================================================================
     list page
     ===================================================================== */
  App.listHtml = function (b) {
    var c = this.cfg();
    adoptUrl();
    return this.crumb(c.label) +
      '<div class="reg-panel-head lt-head"><div class="lt-head-l"><span class="reg-panel-title">' + esc(c.label) + '</span>' +
      '<button class="btn btn-primary btn-xs" onclick="App.newRecord()">' + esc(c.newLabel) + '</button>' + this.editorBtn() + '</div>' +
      '<div class="reg-search"><span class="reg-adv" role="button" tabindex="0" onclick="App.advOpen()" onkeydown="if(event.key===\'Enter\')App.advOpen()">▸ Advanced Queries' +
      (this.advFilters && this.advFilters.length ? ' (' + this.advFilters.length + ')' : '') + '</span>' +
      '<input type="text" placeholder="Search" aria-label="Search ' + esc(c.label) + '" value="' + esc(this.listQuery) + '" oninput="App.filterList(this.value)">' +
      '<button class="btn btn-xs" onclick="App.renderWorkspace()">Search</button></div></div>' +
      '<div id="regBody">' + this.tableHtml(b) + '</div>';
  };

  function colClass(col) {
    var cls = [];
    if (col.r || col.kind === 'money' || col.kind === 'num') cls.push('r');
    if (col.kind === 'date' || /^(code|reference|symbol|ref)$/i.test(col.key) || /code$/i.test(col.key)) cls.push('nw');
    if (col.key === 'name' || /^(customer|supplier|employee|paidBy|payee|payer|item)$/.test(col.key)) cls.push('c-name');
    return cls;
  }
  function moneyCell(v) { var n = Number(v) || 0; return { txt: App.money(n), neg: n < -0.0000001 }; }
  function sortVal(col, r) {
    var v = rawVal(col, r);
    if (col.kind === 'account') v = (typeof acctName === 'function') ? acctName(App.curBiz(), v) : v;
    if (ACCT_KEYS[col.key]) v = App.dispAcct(v);
    if (col.kind === 'ledger') return { e: 1 };
    return sortKey(col.kind === 'status' ? 'text' : col.kind, v);
  }

  /* filtered + sorted rows for the current tab (whole data set, before paging) */
  App.listRows = function (b) {
    var c = this.cfg(), cols = this._cols(c), pool = this._colPool(c, b), self = this;
    var rows = this.sortedRecords(b);
    var q = (this.listQuery || '').toLowerCase();
    if (q) rows = rows.filter(function (r) {
      return cols.some(function (col) { var v = rawVal(col, r); if (col.kind === 'date') v = (v || '') + ' ' + self.fmtDateUS(v); return String(v == null ? '' : v).toLowerCase().indexOf(q) >= 0; });
    });
    rows = this._advFilter(b, c, rows);
    var st = this.sortState('list:' + sectionKey());
    if (st) {
      var col = pool.find(function (x) { return x.key === st.col; });
      if (col && col.kind !== 'ledger') rows = this.sortRows(rows, function (r) { return sortVal(col, r); }, st.dir);
    }
    return rows;
  };

  App.tableHtml = function (b) {
    var self = this, c = this.cfg(), key = sectionKey(), cols = this._cols(c);
    var rows = this.listRows(b);
    var bm = this.batchMode, sel = this.batchSel || {};
    var p = rows.length ? this._paginate(rows, 'pageSize', 'pageNum') : null;
    var st = this.sortState('list:' + key);
    var nFixed = 2 + (bm ? 1 : 0);
    this._pageIds = p ? p.rows.map(function (r) { return r.id; }) : [];

    var head = (bm ? '<th class="act chk"><input type="checkbox" id="batchAll" aria-label="Select all rows on this page" title="Select all" onclick="App.batchAll(this.checked)"></th>' : '') +
      '<th class="act ico-h" title="Edit" aria-label="Edit">✎</th><th class="act ico-h" title="View" aria-label="View">👁</th>' +
      cols.map(function (col) {
        var cls = colClass(col);
        if (col.kind === 'ledger') return '<th class="' + cls.join(' ') + '">' + esc(col.label) + '</th>';
        var on = st && st.col === col.key;
        cls.push('sortable'); if (on) cls.push('sorted');
        var arrow = on ? (st.dir === 'desc' ? '▼' : '▲') : '⇅';
        return '<th class="' + cls.join(' ') + '" role="columnheader" tabindex="0" aria-sort="' + (on ? (st.dir === 'desc' ? 'descending' : 'ascending') : 'none') + '"' +
          ' title="Sort by ' + esc(col.label) + '" onclick="App.listSort(\'' + esc(col.key) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();App.listSort(\'' + esc(col.key) + '\')}">' +
          '<span class="th-l">' + esc(col.label) + '</span><span class="sort-ind" aria-hidden="true">' + arrow + '</span></th>';
      }).join('');

    var body;
    if (!rows.length) {
      body = '<tr><td colspan="' + (cols.length + nFixed) + '"><div class="reg-empty">' +
        (this.records(b).length ? 'No records match “' + esc(this.listQuery) + '”.' :
          'No ' + c.label.toLowerCase() + ' yet. Click <b>' + esc(c.newLabel) + '</b> to add one.') + '</div></td></tr>';
    } else {
      body = p.rows.map(function (r) {
        var on = !!sel[r.id];
        return '<tr' + (on ? ' class="row-sel"' : '') + ' data-id="' + esc(r.id) + '">' +
          (bm ? '<td class="act chk"><input type="checkbox" class="batch-chk" aria-label="Select row" ' + (on ? 'checked' : '') + ' onclick="App.batchToggle(' + JSON.stringify(r.id).replace(/"/g, '&quot;') + ')"></td>' : '') +
          '<td class="act"><button class="btn btn-xs" onclick="App.editRecord(' + r.id + ')">Edit</button></td>' +
          '<td class="act"><button class="btn btn-xs" onclick="App.viewRecord(' + r.id + ')">View</button></td>' +
          cols.map(function (col) { return self._cellHtml(b, key, col, r); }).join('') + '</tr>';
      }).join('');
    }

    /* footer Total row: label on the left, each amount under its own column */
    var sums = cols.map(function (col) { return col.kind === 'money' && !NO_SUM[col.key] && !col.custom; });
    var tfoot = '';
    if (rows.length && sums.some(Boolean)) {
      tfoot = '<tfoot><tr class="tot-row"><td colspan="' + nFixed + '" class="tot-lbl">Total</td>' +
        cols.map(function (col, i) {
          if (!sums[i]) return '<td></td>';
          var s = rows.reduce(function (a, r) { return a + (Number(rawVal(col, r)) || 0); }, 0);
          var mc = moneyCell(s);
          return '<td class="m r' + (mc.neg ? ' neg' : '') + '">' + mc.txt + '</td>';
        }).join('') + '</tr></tfoot>';
    }

    var ftActs = [['Edit columns', 'App.editColumns()'], ['Batch Operations', 'App.batchMenu()'], ['Copy to clipboard', 'App.copyTable()']];
    if (key === 'bankCash') ftActs.push(['Import bank statement', 'App.bankImportOpen()']);
    if (st) ftActs.push(['Clear sort', 'App.listSortClear()']);
    var ftBtns = ftActs.map(function (t) { return '<button class="ftbtn" onclick="' + t[1] + '">' + (t[0] === 'Batch Operations' ? '▸ ' : '') + t[0] + '</button>'; }).join('');
    var n = Object.keys(sel).length;
    var batchBar = bm ? ('<div class="batch-bar" role="region" aria-label="Bulk delete"><span><b id="batchCount">' + n + '</b> selected</span><span class="bb-sep">—</span>' +
      '<button class="btn btn-sm btn-danger" id="batchDelBtn" onclick="App.batchDeleteRun()"' + (n ? '' : ' disabled') + '>Delete</button><span class="bb-sep">|</span>' +
      '<button class="btn btn-sm" onclick="App.batchCancel()">Cancel</button></div>') : '';
    var pager = rows.length ? this._pagerBar(p, 'reg') : '';
    var foot = '<div class="reg-foot"><span class="cnt">' + rows.length + ' ' + (rows.length === 1 ? 'record' : 'records') + '</span>' + ftBtns + '</div>';
    return batchBar + '<div class="tbl-scroll"><table class="reg-tbl lt-tbl' + (bm ? ' lt-bulk' : '') + '"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + tfoot + '</table></div>' + pager + foot;
  };

  App._cellHtml = function (b, key, col, r) {
    var cls = colClass(col);
    if (col.kind === 'ledger') {
      var isLed = !!LED[key];
      return '<td class="nw"><a class="led-link" onclick="App.' + (isLed ? 'rowLedger' : 'rowJournal') + '(' + r.id + ')">' + (isLed ? 'Ledger' : 'Journal') + ' ↗</a></td>';
    }
    var raw = rawVal(col, r);
    if (col.kind === 'money') {
      var mc = moneyCell(raw);
      var inner = col.ledger ? '<a class="led-link" onclick="App.openLedger(' + r.id + ')">' + mc.txt + '</a>' : mc.txt;
      return '<td class="m ' + cls.join(' ') + (mc.neg ? ' neg' : '') + '">' + inner + '</td>';
    }
    if (col.kind === 'date') return '<td class="' + cls.join(' ') + '">' + this.fmtDateUS(raw) + '</td>';
    if (col.kind === 'status') {
      var s = raw || '';
      var sc = s === 'Overdue' ? 'st-overdue' : (s === 'Paid' ? 'st-paid' : (s === 'Draft' ? 'st-draft' : (s === 'Partially paid' ? 'st-partial' : (s === 'Overpaid' ? 'st-overpaid' : 'st-unpaid'))));
      return '<td>' + (s ? '<span class="st-badge ' + sc + '">' + esc(s) + '</span>' : '') + '</td>';
    }
    var v = raw == null ? '' : raw;
    if (col.kind === 'account' && typeof acctName === 'function') v = acctName(b, v) || v;
    if (ACCT_KEYS[col.key]) v = this.dispAcct(v);
    if (/Type$/.test(col.key) && typeof v === 'string') v = this.capLabel(v);
    var neg = (col.kind === 'num' || col.r) && typeof v !== 'object' && /^\s*-\s*\d/.test(String(v));
    var txt = esc(v);
    return '<td class="' + cls.join(' ') + (neg ? ' neg' : '') + '">' + (col.ledger ? '<a class="led-link" onclick="App.openLedger(' + r.id + ')">' + txt + '</a>' : txt) + '</td>';
  };

  /* Journal column: the voucher's transaction journal when that exists, else its View */
  App.rowJournal = function (id) {
    var key = sectionKey();
    if (typeof this.showTransactionJournal === 'function') return this.showTransactionJournal(key, id);
    return this.viewRecord(id);
  };

  App.copyTable = function () {
    var self = this, b = this.curBiz(), c = this.cfg(), key = sectionKey();
    var cols = this._cols(c).filter(function (col) { return col.kind !== 'ledger'; });
    var rows = this.listRows(b);
    var header = cols.map(function (col) { return col.label; }).join('\t');
    var lines = rows.map(function (r) {
      return cols.map(function (col) {
        var v = rawVal(col, r);
        if (col.kind === 'money') return self.money(v);
        if (col.kind === 'date') return self.fmtDateUS(v);
        if (ACCT_KEYS[col.key]) v = self.dispAcct(v);
        return v == null ? '' : String(v).replace(/[\t\n]/g, ' ');
      }).join('\t');
    });
    var tsv = [header].concat(lines).join('\n');
    var done = function () { toast('Copied ' + rows.length + ' rows to the clipboard.'); };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(done, function () { modalAlert(tsv); });
    else modalAlert(tsv);
    return tsv;
  };

  /* =====================================================================
     B. bulk delete
     ===================================================================== */
  App.batchDelete = function () { this.batchMode = true; this.batchSel = {}; this.renderWorkspace(); };
  App.batchCancel = function () { this.batchMode = false; this.batchSel = {}; this.renderWorkspace(); };
  App.batchToggle = function (id) {
    this.batchSel = this.batchSel || {};
    if (this.batchSel[id]) delete this.batchSel[id]; else this.batchSel[id] = 1;
    syncBatch();
  };
  /* Select All: every row on the current page */
  App.batchAll = function (on) {
    var self = this; this.batchSel = this.batchSel || {};
    (this._pageIds || []).forEach(function (id) { if (on) self.batchSel[id] = 1; else delete self.batchSel[id]; });
    if (hasDoc) {
      var tb = document.querySelectorAll('.lt-bulk tbody tr[data-id]');
      Array.prototype.forEach.call(tb, function (tr) {
        var ch = tr.querySelector('.batch-chk'); if (ch) ch.checked = !!on;
      });
    }
    syncBatch();
  };
  /* header checkbox: checked / indeterminate (–) / clear; count and button */
  function syncBatch() {
    if (!hasDoc || !App.batchMode) return;
    var sel = App.batchSel || {}, ids = App._pageIds || [];
    var on = ids.filter(function (id) { return sel[id]; }).length;
    var all = document.getElementById('batchAll');
    if (all) { all.checked = ids.length > 0 && on === ids.length; all.indeterminate = on > 0 && on < ids.length; }
    var n = Object.keys(sel).length;
    var c = document.getElementById('batchCount'); if (c) c.textContent = n;
    var d = document.getElementById('batchDelBtn'); if (d) d.disabled = !n;
    var trs = document.querySelectorAll('.lt-bulk tbody tr[data-id]');
    Array.prototype.forEach.call(trs, function (tr) {
      var id = tr.getAttribute('data-id'); var hit = !!(sel[id] || sel[Number(id)]);
      if (tr.classList) tr.classList.toggle('row-sel', hit);
    });
  }
  App._syncBatch = syncBatch;

  App.batchDeleteRun = function () {
    var self = this, b = this.curBiz(), key = sectionKey();
    var ids = Object.keys(this.batchSel || {}).map(function (x) { return isNaN(Number(x)) ? x : Number(x); });
    if (!ids.length) { modalAlert('Select at least one row first.'); return Promise.resolve(false); }
    var c = REG[key] || {}, noun = ids.length === 1 ? 'record' : 'records';
    var lk = (b && b.lockDate) || '';
    if (lk) {
      var locked = ((b.records && b.records[key]) || []).filter(function (r) {
        if (ids.indexOf(r.id) < 0) return false; var d = String(r.issueDate || r.date || '').slice(0, 10); return d && d <= lk;
      }).length;
      if (locked) { modalAlert(locked + ' of the selected ' + (c.label || 'records').toLowerCase() + ' are dated on or before the lock date (' + this.fmtDateUS(lk) + ') and can’t be deleted while the period is locked. Update Settings → Lock Date first.'); return Promise.resolve(false); }
    }
    return modalConfirm('Delete ' + ids.length + ' selected ' + noun + '?\n\nThis can be undone from History.', { title: 'Delete ' + (c.label || 'records'), danger: true, okText: 'Delete' }).then(function (ok) {
      if (!ok) return false;
      var idset = {}; ids.forEach(function (i) { idset[i] = 1; });
      var arr = (b.records && b.records[key]) || [];
      var deleted = arr.filter(function (r) { return idset[r.id]; }).map(function (r) { return JSON.parse(JSON.stringify(r)); });
      b.records[key] = arr.filter(function (r) { return !idset[r.id]; });
      try { self._logActivity(b, 'delete', key, null, null, { bulkDeleted: deleted, label: 'Batch delete — ' + deleted.length + ' ' + (c.label || 'records') }); } catch (e) {}
      try { refreshSummary(b); } catch (e) {}
      self.saveBiz(b); self.batchMode = false; self.batchSel = {};
      self.renderWorkspace();
      toast('Deleted ' + deleted.length + ' ' + (deleted.length === 1 ? 'record' : 'records') + '.');
      return true;
    });
  };

  /* =====================================================================
     Batch Operations: Import / Bulk delete / Batch Update
     ===================================================================== */
  App.batchMenu = function () {
    var I = function (n) { return (win && win.ICO) ? ICO.get(n, 16) : ''; };
    this._openOverlay('<div class="app-modal-h">Batch Operations</div><div class="app-modal-b"><div class="bo-list">' +
      '<button class="btn bo-item" onclick="App._closeOverlay();App.batchImport()">' + I('download') + '<span><b>Import</b><small>Create new records from a CSV file or pasted rows</small></span></button>' +
      '<button class="btn bo-item" onclick="App._closeOverlay();App.batchUpdate()">' + I('shuffle') + '<span><b>Batch Update</b><small>Edit existing records in a spreadsheet, then paste them back</small></span></button>' +
      '<button class="btn bo-item" onclick="App._closeOverlay();App.batchDelete()">' + I('trash') + '<span><b>Batch Delete</b><small>Tick rows in the list and delete them together</small></span></button>' +
      '</div></div><div class="app-modal-f"><span style="flex:1"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button></div>');
  };

  /* editable fields for Batch Update: form fields + plain columns + custom fields */
  App._updateFields = function (c, b) {
    var out = this._importFields(c).filter(function (f) { return !OPT_KEYS[f.key] && f.type !== 'check'; });
    customDefs(b, sectionKeyOf(c)).forEach(function (x) { if (x.dataType === 'formula') return; out.push({ key: 'cf_' + x.key, label: x.label, type: x.dataType === 'number' ? 'number' : 'text' }); });
    return out;
  };
  function csvCell(v) { var s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function fieldGet(r, f) { if (f.key.indexOf('cf_') === 0) { var k = f.key.slice(3); return r.custom && r.custom[k] != null ? r.custom[k] : ''; } return r[f.key]; }
  function fieldSet(r, f, v) { if (f.key.indexOf('cf_') === 0) { r.custom = r.custom || {}; r.custom[f.key.slice(3)] = v; } else r[f.key] = v; }

  App.batchUpdateCsv = function () {
    var b = this.curBiz(), c = this.cfg(), fields = this._updateFields(c, b);
    var rows = this.records(b);
    var lines = [['Id'].concat(fields.map(function (f) { return f.label; })).map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push([r.id].concat(fields.map(function (f) { var v = fieldGet(r, f); return v == null ? '' : v; })).map(csvCell).join(',')); });
    return lines.join('\n') + '\n';
  };
  App.batchUpdate = function () {
    var c = this.cfg(); if (!c) return;
    this._bupd = null;
    this._openOverlay('<div class="app-modal-h">Batch Update — ' + esc(c.label) + '</div>' +
      '<div class="app-modal-b">' +
      '<ol class="bo-steps"><li><button class="btn btn-xs" onclick="App.batchUpdateDownload()">⬇ Download current ' + esc(c.label.toLowerCase()) + ' (CSV)</button></li>' +
      '<li>Edit the cells you want to change in Excel or Google Sheets. Keep the <b>Id</b> column and the header row.</li>' +
      '<li>Paste the rows below (or load the file), click <b>Preview</b>, then <b>Update</b>.</li></ol>' +
      '<div style="margin:8px 0"><button class="btn btn-xs" onclick="App.batchUpdatePick()">⬆ Load CSV / TSV file…</button></div>' +
      '<textarea id="bupd_ta" class="bo-ta" oninput="App._bupdDirty()" placeholder="Id, …&#10;…paste rows here…"></textarea>' +
      '<div id="bupd_msg" class="bo-msg"></div></div>' +
      '<div class="app-modal-f"><button class="btn" onclick="App._closeOverlay()">Cancel</button><span style="flex:1"></span>' +
      '<button class="btn btn-primary" onclick="App.batchUpdatePreview()">Preview</button><button class="btn btn-primary" id="bupd_go" style="display:none" onclick="App.batchUpdateRun()">Update</button></div>');
  };
  App._bupdDirty = function () { this._bupd = null; var g = hasDoc && document.getElementById('bupd_go'); if (g) g.style.display = 'none'; };
  App.batchUpdateDownload = function () { this._download((sectionKey() || 'records') + '-batch-update.csv', this.batchUpdateCsv()); };
  App.batchUpdatePick = function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.tsv,.txt,text/csv';
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () { var ta = document.getElementById('bupd_ta'); if (ta) { ta.value = rd.result; App._bupdDirty(); App.batchUpdatePreview(); } }; rd.readAsText(f); };
    inp.click();
  };
  /* Works out the changes without touching data: {changes:[{id,set:{key:val}}], unknown, cells} */
  App.batchUpdatePlan = function (text) {
    var b = this.curBiz(), c = this.cfg(), fields = this._updateFields(c, b);
    var parsed = this._parseDelimited(text);
    if (!parsed.header.length) return { error: 'Nothing to update — paste some rows first.' };
    var idIdx = parsed.header.findIndex(function (h) { return String(h).trim().toLowerCase() === 'id'; });
    if (idIdx < 0) return { error: 'The first row must contain an "Id" column (download the CSV to get one).' };
    var map = this._mapHeaders(parsed.header, fields);
    var fByKey = {}; fields.forEach(function (f) { fByKey[f.key] = f; });
    var recs = this.records(b), byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
    var changes = [], unknown = 0, cells = 0;
    parsed.rows.forEach(function (cellsRow) {
      var id = String(cellsRow[idIdx] == null ? '' : cellsRow[idIdx]).trim(); if (!id) return;
      var r = byId[id]; if (!r) { unknown++; return; }
      var set = {};
      Object.keys(map).forEach(function (i) {
        if (Number(i) === idIdx) return;
        var m = map[i], f = fByKey[m.key] || m; var v = cellsRow[i]; if (v == null) v = '';
        if ((f.type === 'money' || f.type === 'number') && v !== '') { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); v = isNaN(n) ? 0 : n; }
        var cur = fieldGet(r, f); cur = cur == null ? '' : cur;
        if (String(cur) !== String(v)) { set[f.key] = v; cells++; }
      });
      if (Object.keys(set).length) changes.push({ id: r.id, set: set });
    });
    return { changes: changes, unknown: unknown, cells: cells, rows: parsed.rows.length, fields: fByKey };
  };
  App.batchUpdatePreview = function () {
    var ta = document.getElementById('bupd_ta'), msg = document.getElementById('bupd_msg'); if (!ta || !msg) return;
    var plan = this.batchUpdatePlan(ta.value), go = document.getElementById('bupd_go');
    if (plan.error) { msg.innerHTML = '<span class="bo-err">' + esc(plan.error) + '</span>'; if (go) go.style.display = 'none'; return; }
    msg.innerHTML = 'Ready: <b>' + plan.changes.length + '</b> record' + (plan.changes.length === 1 ? '' : 's') + ' will change (' + plan.cells + ' cell' + (plan.cells === 1 ? '' : 's') + ').' +
      (plan.unknown ? ' <span class="bo-err">' + plan.unknown + ' row' + (plan.unknown === 1 ? '' : 's') + ' with an unknown Id will be skipped.</span>' : '');
    this._bupd = plan; if (go) go.style.display = plan.changes.length ? '' : 'none';
  };
  App.batchUpdateApply = function (plan) {
    var self = this, b = this.curBiz(), key = sectionKey(), c = this.cfg();
    var recs = this.records(b), byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
    var before = [];
    plan.changes.forEach(function (ch) {
      var r = byId[String(ch.id)]; if (!r) return;
      before.push(JSON.parse(JSON.stringify(r)));
      Object.keys(ch.set).forEach(function (k) { fieldSet(r, plan.fields[k] || { key: k }, ch.set[k]); });
    });
    try { refreshSummary(b); } catch (e) {}
    try { self._logActivity(b, 'update', key, null, null, { bulkUpdated: before, label: 'Batch update — ' + before.length + ' ' + c.label }); } catch (e) {}
    this.saveBiz(b);
    return before.length;
  };
  App.batchUpdateRun = function () {
    var plan = this._bupd; if (!plan) { this.batchUpdatePreview(); return; }
    var n = this.batchUpdateApply(plan);
    this._bupd = null; this._closeOverlay(); this.renderWorkspace();
    toast('Updated ' + n + ' ' + (n === 1 ? 'record' : 'records') + '.');
  };

  /* Batch Create: same as before, with app notices instead of alert() */
  var origBatchRun = App.batchRun;
  App.batchRun = function () {
    var saved = win ? win.alert : null;
    /* app.js reports the result with alert(), the success one on a 30 ms timer */
    if (win) win.alert = function (m) { toast(m); };
    try { return origBatchRun.apply(this, arguments); }
    finally { if (win) setTimeout(function () { win.alert = saved; }, 80); }
  };

  /* =====================================================================
     F. Edit columns page
     ===================================================================== */
  App.editColumns = function () {
    var c = this.cfg(); if (!c) return;
    this._colsReturn = { mode: this.wsMode, section: this.wsSection };
    this._colDraft = this._colDraftFor(c);
    this.wsMode = 'listCols';
    this.renderWorkspace();
  };
  App._colDraftFor = function (c) {
    var b = this.curBiz(), key = sectionKeyOf(c);
    var pool = this._colPool(c, b), byKey = {}; pool.forEach(function (col) { byKey[col.key] = col; });
    var lc = (b && b.details && b.details.listCols) || {};
    var order = (b && b.details && b.details.listColsOrder && b.details.listColsOrder[key]) || [];
    var vis = (lc[key] && lc[key].length) ? lc[key] : this._defaultColKeys(c, b);
    var on = {}; vis.forEach(function (k) { on[k] = 1; });
    var keys = [], seen = {};
    var push = function (k) { if (byKey[k] && !seen[k]) { seen[k] = 1; keys.push(k); } };
    if (order.length) order.forEach(push); else vis.forEach(push);
    pool.forEach(function (col) { push(col.key); });
    return keys.map(function (k) { return { key: k, label: byKey[k].label, on: !!on[k], builtin: !!byKey[k].builtin, custom: !!byKey[k].custom }; });
  };
  App._colsPageHtml = function (b) {
    var c = this.cfg(), d = this._colDraft || [];
    var crumb = '<div class="ws-crumb"><div class="left">' + this._crumbIco() + ' ▸ <a class="led-link" onclick="App.colsCancel()">' + esc(c.label) + '</a> ▸ Edit columns</div></div>';
    var rows = d.map(function (x, i) {
      var tag = x.custom ? '<span class="ec-tag">Custom field</span>' : (x.key === '__ledger' ? '<span class="ec-tag">Link</span>' : '');
      return '<li class="ec-row' + (x.on ? '' : ' off') + '" draggable="true" data-i="' + i + '"' +
        ' ondragstart="App._ecDragStart(event,' + i + ')" ondragover="App._ecDragOver(event,' + i + ')" ondragleave="App._ecDragLeave(event)" ondrop="App._ecDrop(event,' + i + ')" ondragend="App._ecDragEnd(event)">' +
        '<span class="ec-handle" title="Drag to reorder" aria-hidden="true">↕</span>' +
        '<label class="ec-lbl"><input type="checkbox"' + (x.on ? ' checked' : '') + ' onchange="App._ecToggle(' + i + ',this.checked)"> <span>' + esc(x.label) + '</span></label>' + tag +
        '<span class="ec-move"><button type="button" class="btn btn-xs" title="Move up" aria-label="Move ' + esc(x.label) + ' up"' + (i === 0 ? ' disabled' : '') + ' onclick="App._ecMove(' + i + ',-1)">↑</button>' +
        '<button type="button" class="btn btn-xs" title="Move down" aria-label="Move ' + esc(x.label) + ' down"' + (i === d.length - 1 ? ' disabled' : '') + ' onclick="App._ecMove(' + i + ',1)">↓</button></span></li>';
    }).join('');
    return crumb + '<div class="card ec-card"><div class="ec-h">Edit columns</div>' +
      '<p class="ec-note">Tick the columns to show in <b>' + esc(c.label) + '</b> and drag them (or use ↑ ↓) into order. Edit, View and selection columns always stay on the left.</p>' +
      '<ul class="ec-list" id="ecList">' + rows + '</ul>' +
      '<div class="form-actions ec-actions"><button class="btn btn-primary" onclick="App.colsUpdate()">Update</button>' +
      '<button class="btn" onclick="App.colsReset()">Reset to default</button><span style="flex:1"></span>' +
      '<button class="btn" onclick="App.colsCancel()">Cancel</button></div></div>';
  };
  function rerenderCols() { var m = hasDoc && document.getElementById('wsMain'); if (m) m.innerHTML = App._colsPageHtml(App.curBiz()); }
  App._ecToggle = function (i, on) { var d = this._colDraft; if (d && d[i]) { d[i].on = !!on; } rerenderCols(); };
  App._ecMove = function (i, delta) {
    var d = this._colDraft, j = i + delta; if (!d || j < 0 || j >= d.length) return;
    var t = d[i]; d[i] = d[j]; d[j] = t; rerenderCols();
    if (hasDoc) { var btn = document.querySelector('#ecList .ec-row[data-i="' + j + '"] .ec-move button:' + (delta < 0 ? 'first-child' : 'last-child')); if (btn && !btn.disabled) btn.focus(); }
  };
  App._ecMoveTo = function (from, to) {
    var d = this._colDraft; if (!d || from === to || from < 0 || to < 0 || from >= d.length || to >= d.length) return;
    var it = d.splice(from, 1)[0]; d.splice(to, 0, it);
  };
  App._ecDragStart = function (e, i) { this._ecFrom = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('dragging'); };
  App._ecDragOver = function (e, i) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (x) {} if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('drop-on'); };
  App._ecDragLeave = function (e) { if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('drop-on'); };
  App._ecDrop = function (e, i) { e.preventDefault(); var from = this._ecFrom; this._ecFrom = null; if (from == null) return; this._ecMoveTo(from, i); rerenderCols(); };
  App._ecDragEnd = function () { this._ecFrom = null; if (hasDoc) Array.prototype.forEach.call(document.querySelectorAll('.ec-row'), function (r) { r.classList.remove('dragging', 'drop-on'); }); };
  /* save order + selection on the business (per tab); defaults clear the entry */
  App.colsSave = function (draft) {
    var b = this.curBiz(), c = this.cfg(), key = sectionKeyOf(c); if (!b || !key) return;
    draft = draft || this._colDraft || [];
    var vis = draft.filter(function (x) { return x.on; }).map(function (x) { return x.key; });
    var order = draft.map(function (x) { return x.key; });
    var store = listColsStore(b); b.details.listColsOrder = b.details.listColsOrder || {};
    if (!vis.length) vis = this._defaultColKeys(c, b);
    store[key] = vis; b.details.listColsOrder[key] = order;
    this.saveBiz(b);
  };
  App.colsUpdate = function () { this.colsSave(); this._colDraft = null; this.wsMode = 'list'; this.renderWorkspace(); };
  App.colsReset = function () {
    var b = this.curBiz(), key = sectionKey();
    if (b && b.details) { if (b.details.listCols) delete b.details.listCols[key]; if (b.details.listColsOrder) delete b.details.listColsOrder[key]; this.saveBiz(b); }
    this._colDraft = this._colDraftFor(this.cfg());
    rerenderCols();
    toast('Columns reset to default.');
  };
  App.colsCancel = function () { this._colDraft = null; this.wsMode = 'list'; this.renderWorkspace(); };
  /* the old popup handlers, kept as aliases */
  App.saveColumns = function () { this.colsUpdate(); };
  App.resetColumns = function () { this.colsReset(); };

  /* =====================================================================
     ledgers: whole-data-set sort on the shared row arrays
     ===================================================================== */
  var LEDGER_FIELDS = {
    'date': ['date', 'date'], 'reference': ['ref', 'text'], 'transaction': ['type', 'text'], 'description': ['desc', 'text'],
    'debit': ['debit', 'money'], 'credit': ['credit', 'money'], 'balance': ['bal', 'money'], 'amount': ['amount', 'money'],
    'qty in': ['qin', 'num'], 'qty out': ['qout', 'num'], 'qty balance': ['qbal', 'num'],
    'cost in': ['cin', 'money'], 'cost out': ['cout', 'money'], 'cost balance': ['cbal', 'money'],
    'acquisition cost': ['cost', 'money'], 'depreciation': ['dep', 'money'], 'book value': ['book', 'money'],
    'account': ['account', 'text']
  };
  var FIELD_KIND = {}; Object.keys(LEDGER_FIELDS).forEach(function (k) { FIELD_KIND[LEDGER_FIELDS[k][0]] = LEDGER_FIELDS[k][1]; });
  App.sortLedgerRows = function (rows, ctx) {
    var st = this.sortState(ctx); if (!st || !Array.isArray(rows)) return rows;
    var kind = FIELD_KIND[st.col] || 'text';
    var pinnedTop = [], pinnedEnd = [], body = [];
    rows.forEach(function (r, i) { if (r && r.opening) { (i === 0 ? pinnedTop : pinnedEnd).push(r); } else body.push(r); });
    var sorted = this.sortRows(body, function (r) {
      var v = r[st.col];
      if ((kind === 'money' || kind === 'num') && (v === 0 || v === '0') && (st.col === 'debit' || st.col === 'credit' || /^(qin|qout|cin|cout|cost|dep)$/.test(st.col))) return { e: 1 };
      return sortKey(kind, v);
    }, st.dir);
    return pinnedTop.concat(sorted, pinnedEnd);
  };
  ['ledgerData', 'glLedgerData', 'invLedgerData', 'faLedgerData'].forEach(function (fn) {
    var orig = App[fn]; if (typeof orig !== 'function') return;
    App[fn] = function () {
      var d = orig.apply(this, arguments);
      try { var ctx = this._sortCtx(); if (d && d.rows && ctx && ctx.indexOf('ledger:') === 0) d.rows = this.sortLedgerRows(d.rows, ctx); } catch (e) {}
      return d;
    };
  });
  App.ledgerSort = function (field) {
    var ctx = this._sortCtx(); if (!ctx) return;
    this.setSortState(ctx, field, nextDir(ctx, field));
    this.lPageNum = 1;
    if (hasDoc && document.getElementById('ledgerBody') && typeof this.ledgerSearch === 'function') this.ledgerSearch(this.ledgerQuery || '');
    else this.renderMain(this.curBiz());
    syncUrl();
  };
  /* ledger headers are drawn by app.js; make the data ones clickable here */
  function decorateLedgerHeads(root) {
    var ctx = App._sortCtx(); if (!ctx || ctx.indexOf('ledger:') !== 0) return;
    var st = App.sortState(ctx);
    var ths = root.querySelectorAll('#ledgerBody table.reg-tbl > thead th');
    /* the GL sub-account summary is not a ledger */
    if (Array.prototype.some.call(ths, function (th) { return String(th.textContent || '').trim() === 'Sub-account'; })) return;
    Array.prototype.forEach.call(ths, function (th, i) {
      if (th.getAttribute('data-ls') === '1') return;
      var txt = String(th.textContent || '').trim();
      if (!txt) { if (i === 0) { th.textContent = '✎ 👁'; th.className += ' act ico-h'; th.title = 'Edit / View'; } th.setAttribute('data-ls', '1'); return; }
      var f = LEDGER_FIELDS[txt.toLowerCase()];
      th.setAttribute('data-ls', '1');
      if (!f) return;
      var on = st && st.col === f[0];
      th.classList.add('sortable'); if (on) th.classList.add('sorted');
      if (f[1] === 'date' || f[0] === 'ref') th.classList.add('nw');
      th.setAttribute('tabindex', '0'); th.setAttribute('title', 'Sort by ' + txt);
      th.setAttribute('aria-sort', on ? (st.dir === 'desc' ? 'descending' : 'ascending') : 'none');
      th.innerHTML = '<span class="th-l">' + esc(txt) + '</span><span class="sort-ind" aria-hidden="true">' + (on ? (st.dir === 'desc' ? '▼' : '▲') : '⇅') + '</span>';
      th.onclick = function () { App.ledgerSort(f[0]); };
      th.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.ledgerSort(f[0]); } };
    });
  }
  /* red negatives in every table cell that shows an amount */
  function markNegatives(root) {
    var cells = root.querySelectorAll('td.m, td.r, td.num, .total.num, .sum-total.num, .iv-totbox');
    Array.prototype.forEach.call(cells, function (td) {
      var t = String(td.textContent || '').trim();
      var neg = /^-\s?\d/.test(t) || /^\(\d[\d,]*(\.\d+)?\)$/.test(t);
      if (neg && !td.classList.contains('neg')) td.classList.add('neg');
      else if (!neg && td.classList.contains('neg')) td.classList.remove('neg');
    });
  }
  App._decorateMain = function () {
    if (!hasDoc) return;
    var m = document.getElementById('wsMain'); if (!m || !m.querySelectorAll) return;
    try { decorateLedgerHeads(m); } catch (e) {}
    try { markNegatives(m); } catch (e) {}
    try { syncBatch(); } catch (e) {}
  };

  /* =====================================================================
     render hooks
     ===================================================================== */
  var origRenderMain = App.renderMain;
  App.renderMain = function (b) {
    if (this.wsMode === 'listCols') {
      var m = hasDoc ? document.getElementById('wsMain') : null;
      if (!this._colDraft) this._colDraft = this._colDraftFor(this.cfg());
      if (m) m.innerHTML = this._colsPageHtml(b || this.curBiz());
      syncUrl();
      return;
    }
    adoptUrl();
    var r = origRenderMain.apply(this, arguments);
    syncUrl();
    this._decorateMain();
    return r;
  };
  /* re-decorate after partial re-renders (search box, paging, sorting) */
  if (hasDoc && typeof MutationObserver !== 'undefined') {
    var pending = false;
    var observe = function () {
      var m = document.getElementById('wsMain'); if (!m) return false;
      new MutationObserver(function () {
        if (pending) return; pending = true;
        setTimeout(function () { pending = false; App._decorateMain(); }, 0);
      }).observe(m, { childList: true, subtree: true });
      return true;
    };
    if (!observe() && document.addEventListener) document.addEventListener('DOMContentLoaded', observe);
  }
})();
