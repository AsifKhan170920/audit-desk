/* ===================== Settings fixes (B) =====================
   FIX_SPEC_SETTINGS items 112-126, leftover 65 and the grouped Trial Balance.
   Layered over js/app.js, js/settings-pages.js, js/users.js and friends
   without rewriting them: every change here wraps or extends an existing
   App / SettingsPages definition. Loaded last.

   112-114  Tax Codes: Reverse charged (UAE RCM) — the code's document rate is
            0 and its real rate is kept in rcRate; the ledger engine posts the
            reverse charge to Input VAT (Dr) and Output VAT (Cr). Transactions
            column. Account dropdown limited to tax asset / liability accounts.
   115-117  Every live date format, Indian and "/00" number formats, applied
            through the one formatter (App.fmtDate / App.money) incl. the
            invoice designer tokens, report headings and date-picker text.
   118      Themes list (Name + HTML) and a Theme dropdown on document views.
   119      "New User Permissions" button; permission gaps closed.
   120-121  Email Settings like live (Protocol, Hostname, Port, …, Test email
            settings); Email Templates for every document type.
   122-126  No record id above settings forms; Form Defaults and Batch
            Operations on every settings list; full country list; Settings
            index split into "in use" and the rest; "Settings ▸ …" + Back.
   65       Sales Invoice warns when a line's qty exceeds the stock at the
            chosen inventory location.
   TB       Trial Balance grouped by Assets, Liabilities, Equity, Income,
            Expenses with subtotals (still Dr = Cr).
   ============================================================== */
(function () {
  'use strict';
  if (typeof App === 'undefined' || App.__settingsFixesB) return;
  App.__settingsFixesB = 1;

  var G = (typeof window !== 'undefined') ? window : globalThis;
  var hasDom = typeof document !== 'undefined' && document && document.body && document.body.nodeType === 1;
  function esc(s) { return App.esc(s == null ? '' : s); }
  function num(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function q(s) { return esc(JSON.stringify(String(s))); }
  function pad(n) { return ('0' + n).slice(-2); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function curB() { try { return App.openBiz != null ? App.curBiz() : null; } catch (e) { return null; } }
  function modalAlert(t) { try { if (G.UIModal && G.UIModal.alert) return G.UIModal.alert(t); } catch (e) {} try { alert(t); } catch (e) {} }
  function modalConfirm(t, o) { try { if (G.UIModal && G.UIModal.confirm) return G.UIModal.confirm(t, o); } catch (e) {} return Promise.resolve(true); }
  function toast(t) { try { if (G.UIModal && G.UIModal.toast) return G.UIModal.toast(t); if (G.SettingsPages && G.SettingsPages.toast) return G.SettingsPages.toast(t); } catch (e) {} }
  function rootOf(b, n) { try { return acctRoot(b, n); } catch (e) { return ''; } }
  function recsOf(b, key) { return ((b && b.records && b.records[key]) || []); }

  /* =====================================================================
     115-117  Date & number formats
     ===================================================================== */
  var DATE_FORMATS = [['DD-MM-YY', '31-12-26'], ['DD-MM-YYYY', '31-12-2026'], ['DD.MM.YY', '31.12.26'], ['DD.MM.YYYY', '31.12.2026'],
    ['DD/MM/YY', '31/12/26'], ['DD/MM/YYYY', '31/12/2026'], ['MM/DD/YYYY', '12/31/2026'], ['YYYY-MM-DD', '2026-12-31'],
    ['YYYY.MM.DD', '2026.12.31'], ['YYYY/MM/DD', '2026/12/31']];
  var NUM_FORMATS = [['comma-dot', '123,456,789.00'], ['dot-comma', '123.456.789,00'], ['space-comma', '123 456 789,00'],
    ['none-dot', '123456789.00'], ['indian', '12,34,56,789.00'], ['comma-slash', '123,456,789/00']];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Format Y / M / D (strings, M and D two digits) with a pattern such as DD.MM.YY. */
  function fmtParts(f, Y, M, D) {
    if (f === 'D MMM YYYY') return (+D) + ' ' + MON[(+M) - 1] + ' ' + Y;
    if (!/YY|MM|DD/.test(f || '')) f = 'DD/MM/YYYY';
    return String(f).replace(/YYYY|YY|MM|DD/g, function (t) { return t === 'YYYY' ? Y : t === 'YY' ? Y.slice(-2) : t === 'MM' ? M : D; });
  }
  App.dateFormats = function () { return DATE_FORMATS.slice(); };
  App.numberFormats = function () { return NUM_FORMATS.slice(); };
  /** What an empty date box shows: the chosen format in lower case ("dd/mm/yyyy"). */
  App.datePlaceholder = function () { var f = this.fmtNow().date; return f === 'D MMM YYYY' ? 'd mmm yyyy' : String(f).toLowerCase(); };

  var prevFmtNow = App.fmtNow;
  App.fmtNow = function () {
    var r = prevFmtNow.apply(this, arguments), b = curB(), sep = (b && b.fmt && b.fmt.sep) || 'comma-dot';
    if (sep === 'indian') { r.thousands = ','; r.decimal = '.'; r.group = 'indian'; }
    else if (sep === 'comma-slash') { r.thousands = ','; r.decimal = '/'; }
    r.sep = sep;
    return r;
  };
  var prevFmtDate = App.fmtDateUS;
  App.fmtDateUS = function (iso) {
    if (iso == null || iso === '') return '';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso));
    if (!m) return prevFmtDate.call(this, iso);
    return fmtParts(this.fmtNow().date, m[1], pad(m[2]), pad(m[3]));
  };
  App.fmtDate = function (iso) { return this.fmtDateUS(iso); };

  function indianGroup(s) { if (s.length <= 3) return s; var last = s.slice(-3), rest = s.slice(0, -3); return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last; }
  var prevMoney = App.money;
  App.money = function (n) {
    var f = this.fmtNow();
    if (f.group !== 'indian') return prevMoney.apply(this, arguments);
    n = Number(n) || 0; var neg = n < 0, p = Math.abs(n).toFixed(f.decimals).split('.');
    var out = indianGroup(p[0]) + (p.length > 1 ? '.' + p[1] : '');
    return neg && /[1-9]/.test(out) ? '-' + out : out;
  };
  /* amounts typed in the chosen format read back: "1,234/50" and (dot-comma) "1.234,50" */
  var prevParse = App.parseNum;
  App.parseNum = function (s) {
    if (s != null && typeof s !== 'number') {
      var str = String(s);
      if (/^\s*-?[\d,\s]*\/\d+\s*$/.test(str)) s = str.replace('/', '.');
      else if (/^\s*-?[\d.\s ]*,\d+\s*$/.test(str)) {
        var f = null; try { f = this.fmtNow(); } catch (e) {}
        if (f && f.decimal === ',') s = str.replace(/[.\s ]/g, '').replace(',', '.');
      }
    }
    return prevParse.call(this, s);
  };
  /* report headings printed "As at [object Object]" (fmtNow returns the settings object) */
  if (typeof App.repHead === 'function') {
    var prevRepHead = App.repHead;
    App.repHead = function () { var h = prevRepHead.apply(this, arguments); return typeof h === 'string' ? h.replace('As at [object Object]', 'As at ' + esc(this.fmtDate(todayIso()))) : h; };
  }
  /* invoice designer tokens (TypeScript bundle formats MM/DD/YYYY and en-US money) */
  function patchDesignerModule() {
    var M = G.InvoiceDesignerModule; if (!M) return;
    [M, M.default, M.InvoiceDesignerAPI].forEach(function (o) {
      if (!o || typeof o.mapRecordToInvoiceData !== 'function' || o.mapRecordToInvoiceData.__sfb) return;
      var orig = o.mapRecordToInvoiceData;
      var w = function (b, rec) {
        var d = orig.apply(this, arguments); rec = rec || {};
        try {
          d.invoice_date = App.fmtDate(rec.issueDate || rec.date || '');
          d.due_date = App.fmtDate(rec.dueDate || '');
          if (rec.subtotal != null && rec.subtotal !== '') d.subtotal = App.money(rec.subtotal);
          if (rec.tax != null && rec.tax !== '') d.tax = App.money(rec.tax);
          d.discount = App.money(rec.discount || 0);
          d.grand_total = App.money(rec.total || 0);
        } catch (e) {}
        return d;
      };
      w.__sfb = 1;
      try { o.mapRecordToInvoiceData = w; } catch (e) {}
    });
  }
  patchDesignerModule();

  /* Date boxes: the browser draws <input type=date> in its own locale order
     (mm/dd/yyyy). While a box is not focused its text is painted in the chosen
     format (or the format as a placeholder) and the native text is hidden;
     focusing it shows the native editor and picker as before. Value stays ISO. */
  var DATE_OK = false;
  try { DATE_OK = hasDom && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(::-webkit-datetime-edit)'); } catch (e) { DATE_OK = false; }
  function svgText(txt, cs, col, h) {
    var fam = String(cs.fontFamily || 'sans-serif').replace(/"/g, "'");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="' + h + '"><text x="0" y="' + (h / 2) + '" dominant-baseline="central" font-family="' + esc(fam) +
      '" font-size="' + esc(cs.fontSize) + '" font-weight="' + esc(cs.fontWeight) + '" fill="' + esc(col) + '">' + esc(txt) + '</text></svg>';
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29') + '")';
  }
  function paintDate(inp) {
    try {
      var cs = getComputedStyle(inp), v = inp.value, h = inp.clientHeight || 30;
      var key = v + '|' + cs.color + '|' + h + '|' + App.fmtNow().date;
      if (inp._sfbKey === key) return; inp._sfbKey = key;
      var txt = v ? App.fmtDate(v) : App.datePlaceholder();
      var col = v ? cs.color : 'rgba(128,128,128,.85)';
      inp.style.backgroundImage = svgText(txt, cs, col, h);
      inp.style.backgroundRepeat = 'no-repeat';
      inp.style.backgroundPosition = (parseFloat(cs.paddingLeft) || 0) + 'px 0';
      if (!inp.classList.contains('sfb-date')) inp.classList.add('sfb-date');
    } catch (e) {}
  }
  function paintAllDates(root) {
    if (!DATE_OK) return;
    var list = (root && root.querySelectorAll ? root : document).querySelectorAll('input[type="date"]');
    for (var i = 0; i < list.length; i++) paintDate(list[i]);
  }
  if (DATE_OK) {
    var dTimer = 0;
    var schedule = function () { if (dTimer) return; dTimer = setTimeout(function () { dTimer = 0; paintAllDates(document); stockScan(); }, 30); };
    try { new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    ['input', 'change', 'focusout'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { var t = e.target; if (t && t.tagName === 'INPUT' && t.type === 'date') { t._sfbKey = null; setTimeout(function () { paintDate(t); }, 0); } }, true);
    });
    /* values set by code without an event, and the dark-mode switch */
    setInterval(function () { try { paintAllDates(document); } catch (e) {} }, 1200);
    setTimeout(function () { paintAllDates(document); }, 0);
  }

  /* =====================================================================
     Settings framework
     ===================================================================== */
  var SP = G.SettingsPages;
  var COUNTRIES = ['Afghanistan', 'Åland Islands', 'Albania', 'Algeria', 'American Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica', 'Antigua and Barbuda',
    'Argentina', 'Armenia', 'Aruba', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
    'Bermuda', 'Bhutan', 'Bolivia', 'Bonaire, Sint Eustatius and Saba', 'Bosnia and Herzegovina', 'Botswana', 'Bouvet Island', 'Brazil',
    'British Indian Ocean Territory', 'Brunei Darussalam', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada',
    'Cayman Islands', 'Central African Republic', 'Chad', 'Chile', 'China', 'Christmas Island', 'Cocos (Keeling) Islands', 'Colombia', 'Comoros', 'Congo',
    'Congo, Democratic Republic of the', 'Cook Islands', 'Costa Rica', "Côte d'Ivoire", 'Croatia', 'Cuba', 'Curaçao', 'Cyprus', 'Czechia', 'Denmark',
    'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia',
    'Falkland Islands (Malvinas)', 'Faroe Islands', 'Fiji', 'Finland', 'France', 'French Guiana', 'French Polynesia', 'French Southern Territories', 'Gabon',
    'Gambia', 'Georgia', 'Germany', 'Ghana', 'Gibraltar', 'Greece', 'Greenland', 'Grenada', 'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinea',
    'Guinea-Bissau', 'Guyana', 'Haiti', 'Heard Island and McDonald Islands', 'Holy See', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia',
    'Iran', 'Iraq', 'Ireland', 'Isle of Man', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jersey', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati',
    'Korea, Democratic People\'s Republic of', 'Korea, Republic of', 'Kuwait', 'Kyrgyzstan', 'Lao People\'s Democratic Republic', 'Latvia', 'Lebanon',
    'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macao', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
    'Marshall Islands', 'Martinique', 'Mauritania', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro',
    'Montserrat', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Caledonia', 'New Zealand', 'Nicaragua', 'Niger',
    'Nigeria', 'Niue', 'Norfolk Island', 'North Macedonia', 'Northern Mariana Islands', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine, State of',
    'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Pitcairn', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar', 'Réunion', 'Romania',
    'Russian Federation', 'Rwanda', 'Saint Barthélemy', 'Saint Helena, Ascension and Tristan da Cunha', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Martin (French part)', 'Saint Pierre and Miquelon', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
    'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Sint Maarten (Dutch part)', 'Slovakia', 'Slovenia', 'Solomon Islands',
    'Somalia', 'South Africa', 'South Georgia and the South Sandwich Islands', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
    'Svalbard and Jan Mayen', 'Sweden', 'Switzerland', 'Syrian Arab Republic', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
    'Tokelau', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Türkiye', 'Turkmenistan', 'Turks and Caicos Islands', 'Tuvalu', 'Uganda', 'Ukraine',
    'United Arab Emirates', 'United Kingdom', 'United States', 'United States Minor Outlying Islands', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela',
    'Viet Nam', 'Virgin Islands (British)', 'Virgin Islands (U.S.)', 'Wallis and Futuna', 'Western Sahara', 'Yemen', 'Zambia', 'Zimbabwe'];
  App.countryList = function () { return COUNTRIES.slice(); };

  /* tax accounts: balance-sheet asset / liability accounts that are not a sub-ledger control account */
  function taxAccountOpts(b) {
    var accts = ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account'; });
    var bs = accts.filter(function (n) {
      var r = rootOf(b, n); if (r !== 'assets' && r !== 'liabilities') return false;
      if (n.sbeControl || n.suspenseControl) return false;
      try { if (typeof GL !== 'undefined' && GL.subKind(b, n)) return false; } catch (e) {}
      return true;
    });
    var taxy = bs.filter(function (n) { return /\b(vat|tax|gst|hst|zakat|excise|duty|duties)\b/i.test(n.name || ''); });
    var list = taxy.length ? taxy : bs;
    var label = function (n) { try { return acctPath(b, n) + (n.code ? ' (' + n.code + ')' : ''); } catch (e) { return n.name; } };
    return [['', '— Output / Input VAT (default) —']].concat(list.map(function (n) { return [n.id, label(n)]; }).sort(function (x, y) { return x[1].localeCompare(y[1]); }));
  }
  App.taxAccountOptions = taxAccountOpts;

  /** How many documents use a tax code (by name; designed-form lines by their stored rate when only that code has it). */
  function taxTxCount(b, code) {
    if (!b || !code) return 0;
    var name = code.name, rate = code.reverse ? null : num(code.rate);
    var sameRate = rate ? (b.taxCodes || []).filter(function (t) { return t && !t.reverse && num(t.rate) === rate; }).length : 0;
    var n = 0, R = b.records || {};
    Object.keys(R).forEach(function (k) {
      (Array.isArray(R[k]) ? R[k] : []).forEach(function (rec) {
        if (!rec || !Array.isArray(rec.lines)) return;
        var hit = rec.lines.some(function (ln) {
          if (!ln) return false;
          var vals = [ln.taxCode, ln.tax, ln.taxRate].filter(function (v) { return !blank(v); }).map(String);
          if (vals.some(function (v) { return v === name || (code.reverse && v === rcValue(code)); })) return true;
          if (sameRate === 1 && blank(ln.taxCode) && vals.length && !vals.some(function (v) { return (b.taxCodes || []).some(function (t) { return t && t.name === v; }); })) {
            var r = num(ln.taxRate != null && ln.taxRate !== '' ? ln.taxRate : ln.tax); return r === rate && num(ln.taxAmt || ln.taxAmount) !== 0;
          }
          return false;
        });
        if (hit) n++;
      });
    });
    return n;
  }
  App.taxCodeTxCount = taxTxCount;
  /* the rate a reverse-charge code really carries */
  function rcRateOf(t) { if (!t) return 0; if (t.rcRate != null && t.rcRate !== '') return num(t.rcRate); return SP ? SP.taxRateOf(Object.assign({}, t, { reverse: false })) : num(t.rate); }

  /* designed forms: the reverse-charge code adds no tax to the document. Their formulas read the tax value as a
     number, so the code is told apart by "0e<tag>" (Number("0e123") === 0) — js/ledger-engine.js reads the tag back */
  function rcTag(t) { try { if (typeof GL !== 'undefined' && GL.rcTagOf) return GL.rcTagOf(t); } catch (e) {} return String(t && t.rcTag || ''); }
  function rcValue(t) { return '0e' + rcTag(t); }
  if (typeof App._liveOptionsFor === 'function') {
    var prevLive = App._liveOptionsFor;
    App._liveOptionsFor = function (b, src) {
      if (src !== 'tax') return prevLive.apply(this, arguments);
      var codes = (b && b.taxCodes) || [];
      if (!codes.some(function (t) { return t && t.reverse; })) return prevLive.apply(this, arguments);
      return codes.filter(function (t) { return t && (t.name || (t.rate !== '' && t.rate != null)); }).map(function (t) {
        if (t.reverse) return '<option value="' + esc(rcValue(t)) + '" data-rate="0">' + esc(t.name + ' (reverse charge ' + rcRateOf(t) + '%)') + '</option>';
        var r = (t.rate == null || t.rate === '') ? '' : t.rate;
        return '<option value="' + esc(r) + '" data-rate="' + esc(r) + '">' + esc((t.name ? t.name + ' ' : '') + (r !== '' ? '(' + r + '%)' : '')) + '</option>';
      });
    };
  }

  if (SP && SP.PAGES) installSettings();

  function walkFields(fields, fn) { (fields || []).forEach(function (f) { if (!f) return; if (f.t === 'fieldset') walkFields(f.fields, fn); else { fn(f); if (f.reveal) walkFields(f.reveal, fn); } }); }
  function fieldOf(def, k) { var hit = null; walkFields(def && def.fields, function (f) { if (!hit && f.k === k) hit = f; }); return hit; }

  function installSettings() {
    var P = SP.PAGES;

    /* ---- 124 full country list ---- */
    var cf = fieldOf(P.business, 'country');
    if (cf) cf.opts = function (b) { var l = COUNTRIES.slice(); var cur = b && b.country; if (cur && l.indexOf(cur) < 0) l.unshift(cur); return l; };

    /* ---- 115 / 116 formats ---- */
    var df = fieldOf(P.format, 'date');
    if (df) df.opts = function (b) { var o = DATE_FORMATS.map(function (x) { return [x[0], x[1]]; }); if (b && b.fmt && b.fmt.date === 'D MMM YYYY') o.push(['D MMM YYYY', '31 Dec 2026']); return o; };
    var nf = fieldOf(P.format, 'sep');
    if (nf) nf.opts = NUM_FORMATS.map(function (x) { return [x[0], x[1]]; });

    /* ---- 112-114 tax codes ---- */
    var T = P.tax;
    if (T) {
      var origLoad = T.load, origBefore = T.beforeSave;
      T.load = function (r, b) {
        r = origLoad ? (origLoad(r, b) || r) : r;
        if (r.reverse && r.rcRate != null && r.rcRate !== '' && r.type !== 'Multiple rates') r.rate = r.rcRate;
        try { r._tx = taxTxCount(b || curB(), r); } catch (e) { r._tx = 0; }
        return r;
      };
      T.beforeSave = function (r, b) {
        delete r._tx;
        if (origBefore) origBefore(r, b);
        if (r.reverse && r.taxRate === 'Custom %') { r.rcRate = num(r.rate); r.rate = 0; if (blank(r.rcTag)) r.rcTag = String(100000 + Math.floor(Math.random() * 900000)); }
        else { r.reverse = false; delete r.rcRate; }
      };
      T.cols = [{ k: 'name', l: 'Name' }, { k: 'label', l: 'Label' },
        { k: 'rate', l: 'Rate', num: 1, fmt: function (v, r) { return r.reverse ? rcRateOf(r) + '% (reverse charge)' : SP.taxRateOf(Object.assign({}, r, { taxRate: r.taxRate || (num(r.rate) > 0 ? 'Custom %' : 'Zero (0%)') })) + '%'; } },
        { k: 'account', l: 'Account', fmt: function (v, r, b) { if (!v) return ''; var o = taxAccountOpts(b).concat(((b && b.coa) || []).filter(function (n) { return n.type === 'account'; }).map(function (n) { return [n.id, n.name]; })).find(function (x) { return String(x[0]) === String(v); }); return o ? o[1] : String(v); } },
        { k: '_tx', l: 'Transactions', num: 1, fmt: function (v, r, b) { return r._tx != null ? r._tx : taxTxCount(b, r); } }];
      var af = fieldOf(T, 'account');
      if (af) { af.opts = taxAccountOpts; af.hint = 'Only tax asset / liability accounts are listed. Leave blank to post to the Output / Input VAT accounts.'; }
      var lf = fieldOf(T, 'components');
      if (lf && lf.cols) lf.cols.forEach(function (c) { if (c.k === 'account') c.opts = taxAccountOpts; });
      var rf = fieldOf(T, 'reverse');
      if (rf) rf.hint = 'For imports and other reverse-charge purchases: no tax is added to the document; the tax is posted to Input VAT and Output VAT at the same time, so it nets to zero.';
    }

    /* ---- 118 Themes list first in Custom Themes ---- */
    if (P.themes && P.themes.items && P.themes.items.html) {
      var th = P.themes.items.html, items = {};
      th.title = 'Themes'; th.entity = 'Theme';
      th.intro = 'A theme is an HTML template a document View, Print and PDF can be rendered through (pick it with the Theme dropdown on the View). ' +
        'Placeholders: {{document}} (the standard layout), {{business_name}}, {{business_address}}, {{title}}, {{reference}}, {{date}}, {{due_date}}, {{party}}, ' +
        '{{party_address}}, {{description}}, {{lines}}, {{subtotal}}, {{tax}}, {{total}}, {{amount_in_words}}, {{footer}}. An element with id="doc" receives the standard layout.';
      th.cols = [{ k: 'name', l: 'Name' }, { k: 'content', l: 'Used by', num: 1, fmt: function (v, r, b) { return themeUseCount(b, r.id); } }];
      items.html = th;
      Object.keys(P.themes.items).forEach(function (k) { if (k !== 'html') items[k] = P.themes.items[k]; });
      P.themes.items = items;
    }

    /* ---- 120 email settings like live ---- */
    if (P.email && P.email.items && P.email.items.smtp) {
      var S = P.email.items.smtp;
      S.title = 'Email Server (SMTP / HTTP)';
      S.intro = 'Emails are sent through the server below. A web page cannot open an SMTP connection itself, so delivery goes through an HTTP relay you run (it receives these settings and talks to the SMTP server). With no relay URL, emails open in your mail client.';
      S.store = {
        get: function (b) {
          var e = clone((b.details && b.details.email) || {});
          if (!e.protocol) e.protocol = 'SMTP';
          e.reply = !!e.replyTo; e.bcc = !!e.bccTo;
          if (!e.smtpPort) e.smtpPort = '587';
          return e;
        },
        set: function (b, e) {
          if (!e.reply) e.replyTo = ''; if (!e.bcc) e.bccTo = ''; delete e.reply; delete e.bcc;
          e.relayUrl = String(e.relayUrl || '').trim();
          e.mode = e.relayUrl ? 'relay' : 'mailto';
          e.encryption = String(e.smtpPort) === '465' ? 'SSL' : String(e.smtpPort) === '25' ? 'None' : 'TLS';
          b.details = Object.assign({}, b.details, { email: Object.assign({}, (b.details && b.details.email) || {}, e) });
        }
      };
      var fld = function (k, l, t, o) { return Object.assign({ k: k, l: l, t: t }, o || {}); };
      S.fields = [
        fld('protocol', 'Protocol', 'select', { opts: [['SMTP', 'SMTP'], ['HTTP', 'HTTP']], def: 'SMTP' }),
        fld('relayUrl', 'HTTP endpoint (relay URL)', 'text', { ph: 'https://mail.yourcompany.com/send', hint: 'Required for HTTP. For SMTP it is the relay that delivers through the SMTP server below; leave blank to use your mail client.' }),
        fld('smtpHost', 'Hostname', 'text', { ph: 'smtp.example.com', show: function (v) { return v.protocol !== 'HTTP'; } }),
        fld('smtpPort', 'Port', 'select', { opts: ['25', '465', '587'], def: '587', show: function (v) { return v.protocol !== 'HTTP'; } }),
        fld('smtpUser', 'Username', 'text', { show: function (v) { return v.protocol !== 'HTTP'; } }),
        fld('smtpPass', 'Password', 'password', { ph: '********', hint: 'Stored in this browser in plain text. Use an app-specific password.', show: function (v) { return v.protocol !== 'HTTP'; } }),
        fld('fromName', 'From name', 'text'), fld('fromAddr', 'From email address', 'text', { ph: 'accounts@yourcompany.com' }),
        fld('bcc', 'Send a copy of every email to', 'checkbox', { reveal: [fld('bccTo', '', 'text', { ph: 'email@example.com' })] }),
        fld('reply', 'Receive email replies at a different address than you send from', 'checkbox', { reveal: [fld('replyTo', '', 'text', { ph: 'email@example.com' })] }),
        fld('noTls', 'Do not verify TLS certificate', 'checkbox')
      ];
      S.test = true;
      var ET = P.email.items.templates;
      if (ET) {
        ET.intro = 'One template per document type. Placeholders: {business}, {party}, {document}, {ref}, {date}, {due}, {amount}, {balance}, {description}. The Email button on a document uses the template of its type (or Default).';
        var tf = fieldOf(ET, 'type'); if (tf) tf.opts = function () { return App._emTplTypes(); };
        var sf = fieldOf(ET, 'subject'), bf = fieldOf(ET, 'body');
        if (sf) sf.def = function () { return App._emTplDefault('default').subject; };
        if (bf) bf.def = function () { return App._emTplDefault('default').body; };
        ET.validate = function (r, b, id) { var m = b.emailTemplates || {}; if (r.type && m[r.type] && String(id) !== String(r.type)) return 'There is already a template for this document type — edit that one.'; };
      }
    }

    /* ---- Test email settings ---- */
    SP._testEmail = function () { App.testEmailSettings(); };

    /* ---- 122 / 123 / 126 page wrappers ---- */
    Object.keys(P).forEach(function (key) {
      var fn = 'set_' + key, orig = App[fn];
      if (typeof orig !== 'function') return;
      App[fn] = function (b) {
        var R = App.sfbRoute;
        if (R && R.key === key) return extraPage(b, R);
        var r = App.spRoute, restore = null;
        if (r && r.key === key && r.action === 'new') restore = applyFormDefaults(b, key, r.sub);
        var html;
        try { html = orig.apply(this, arguments); } finally { if (restore) restore(); }
        return decorate(html);
      };
    });
    var prevGo = SP.go;
    SP.go = function () { App.sfbRoute = null; return prevGo.apply(this, arguments); };
  }

  /* remove the record id above settings forms, add Form Defaults + Batch Operations to settings lists */
  function decorate(html) {
    if (typeof html !== 'string') return html;
    html = html.replace(/<span class="sp-uid">[^<]*<\/span>/g, '');
    var m = /SettingsPages\._editCols\('([^']+)'\)/.exec(html);
    if (m && html.indexOf('sfb-fd-btn') < 0) {
      var p = m[1];
      html = html.replace('<button class="btn btn-sm" onclick="SettingsPages._editCols(\'' + p + '\')">',
        '<button class="btn btn-sm sfb-fd-btn" onclick="SettingsFixesB.openExtra(\'' + p + '\',\'formDefaults\')">Form Defaults</button>' +
        '<button class="btn btn-sm sfb-bo-btn" onclick="SettingsFixesB.openExtra(\'' + p + '\',\'batch\')">Batch Operations</button>' +
        '<button class="btn btn-sm" onclick="SettingsPages._editCols(\'' + p + '\')">');
    }
    return html;
  }

  function splitPath(path) { var p = String(path).split('/'); return { key: p[0], sub: p.slice(1).join('/') }; }
  function defAt(path) { var s = splitPath(path), r = SP.resolve(s.key, s.sub); return r ? r.def : null; }
  function simpleFields(def) {
    var out = [];
    walkFields(def && def.fields, function (f) { if (f.k && ['text', 'number', 'date', 'select', 'checkbox', 'textarea'].indexOf(f.t) >= 0 && f.l) out.push(f); });
    return out;
  }
  function optsOf(f, b) { var o = typeof f.opts === 'function' ? f.opts(b) : (f.opts || []); return o.map(function (x) { return Array.isArray(x) ? [String(x[0]), String(x[1])] : [String(x), String(x)]; }); }

  /* Form Defaults for settings lists: values a New record opens with */
  function fdStore(b) { return (b.spFormDefaults = b.spFormDefaults || {}); }
  function applyFormDefaults(b, key, sub) {
    var path = key + (sub ? '/' + sub : ''), fd = ((b && b.spFormDefaults) || {})[path];
    if (!fd) return null;
    var def = defAt(path); if (!def) return null;
    var saved = [];
    walkFields(def.fields, function (f) {
      if (!f.k || !(f.k in fd) || fd[f.k] === '' || fd[f.k] == null) return;
      saved.push([f, Object.prototype.hasOwnProperty.call(f, 'def'), f.def]);
      var v = fd[f.k]; f.def = function () { return v; };
    });
    return function () { saved.forEach(function (s) { if (s[1]) s[0].def = s[2]; else delete s[0].def; }); };
  }

  function crumb(path, leaf) {
    var s = splitPath(path), res = SP.resolve(s.key, s.sub);
    var c = '<div class="ws-crumb sp-crumb"><div class="left">' + App._crumbIco() + ' ▸ <a class="led-link" onclick="App.settingsBack()">Settings</a>';
    (res ? res.crumbs : []).forEach(function (x) { c += ' ▸ <a class="led-link" onclick="SettingsPages.go(\'' + s.key + '\',\'' + x.sub + '\')">' + esc(x.t) + '</a>'; });
    return c + ' ▸ <span class="sp-here">' + esc(leaf) + '</span></div></div>';
  }
  function extraPage(b, R) {
    var def = defAt(R.path);
    if (!def || def.kind !== 'list') { App.sfbRoute = null; return App['set_' + R.key](b); }
    return R.action === 'batch' ? batchPage(b, R.path, def) : formDefaultsPage(b, R.path, def);
  }
  function inputFor(f, v, b, attr) {
    if (f.t === 'select') return '<select ' + attr + '><option value=""></option>' + optsOf(f, b).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    if (f.t === 'checkbox') return '<select ' + attr + '><option value=""></option><option value="1"' + (v === true ? ' selected' : '') + '>Ticked</option><option value="0"' + (v === false ? ' selected' : '') + '>Not ticked</option></select>';
    if (f.t === 'textarea') return '<textarea ' + attr + '>' + esc(v || '') + '</textarea>';
    return '<input type="' + (f.t === 'date' ? 'date' : 'text') + '" ' + attr + ' value="' + esc(v == null ? '' : v) + '" autocomplete="off">';
  }
  function formDefaultsPage(b, path, def) {
    var fd = ((b.spFormDefaults || {})[path]) || {}, fields = simpleFields(def);
    var rows = fields.map(function (f) {
      return '<div class="sp-f"><label class="sp-l">' + esc(f.l) + '</label>' + inputFor(f, fd[f.k], b, 'data-fd="' + esc(f.k) + '" data-ft="' + f.t + '"') + '</div>';
    }).join('');
    return crumb(path, 'Form Defaults') +
      '<div class="sp-card sp-form" id="sfbFd"><div class="sp-card-h"><span class="sp-ttl">' + esc((def.entity || def.title) + ' — Form Defaults') + '</span></div>' +
      '<div class="sp-card-b"><div class="info-bar sp-intro">Values a new ' + esc((def.entity || 'record').toLowerCase()) + ' opens with. Anything left blank is not pre-filled.</div>' +
      (rows || '<div class="sp-empty">This form has no fields that can take a default.</div>') + '</div>' +
      '<div class="sp-card-f"><button class="btn btn-primary" onclick="SettingsFixesB.saveFormDefaults(' + q(path) + ')">Update</button>' +
      '<span class="sp-grow"></span><button class="btn" onclick="SettingsFixesB.leaveExtra()">Cancel</button></div></div>';
  }
  function tsvCell(v) { if (v == null) return ''; if (Array.isArray(v)) return v.join('; '); if (typeof v === 'object') return ''; if (v === true) return 'TRUE'; if (v === false) return 'FALSE'; return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' '); }
  function batchPage(b, path, def) {
    var fields = simpleFields(def), rows = SP.rows(path, b);
    var head = ['id'].concat(fields.map(function (f) { return f.k; }));
    var tsv = [head.join('\t')].concat(rows.map(function (r) { return head.map(function (k) { return tsvCell(r[k]); }).join('\t'); })).join('\n');
    var list = rows.map(function (r) { var nm = r.name || r.code || r.type || r.match || r.customer || r.date || r.id;
      return '<label class="sp-chk"><input type="checkbox" value="' + esc(r.id) + '"><span>' + esc(nm) + '</span></label>'; }).join('');
    return crumb(path, 'Batch Operations') +
      '<div class="sp-card" id="sfbBatch"><div class="sp-card-h"><span class="sp-ttl">Batch Operations — ' + esc(def.title) + '</span></div>' +
      '<div class="sp-card-b">' +
      '<div class="sfb-bo-sec"><div class="sfb-bo-h">Batch Create / Batch Update</div>' +
      '<div class="sp-hint">Copy the table into a spreadsheet, edit it and paste it back (tab-separated, first row = field names). Rows with an <b>id</b> update that record; rows without one are created.</div>' +
      '<textarea class="sp-code sfb-bo-tsv" id="sfbTsv" spellcheck="false">' + esc(tsv) + '</textarea>' +
      '<div class="sfb-bo-act"><button class="btn btn-primary" onclick="SettingsFixesB.batchApply(' + q(path) + ')">Batch Create / Update</button></div></div>' +
      '<div class="sfb-bo-sec"><div class="sfb-bo-h">Batch Delete</div>' +
      (list ? '<div class="sp-chks" id="sfbDel">' + list + '</div><div class="sfb-bo-act"><button class="btn btn-danger" onclick="SettingsFixesB.batchDelete(' + q(path) + ')">Delete selected</button></div>' : '<div class="sp-empty">Nothing to delete.</div>') +
      '</div></div><div class="sp-card-f"><span class="sp-grow"></span><button class="btn" onclick="SettingsFixesB.leaveExtra()">Back</button></div></div>';
  }
  /** Parse pasted TSV into objects keyed by the header row. */
  function parseTsv(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return [];
    var head = lines[0].split('\t').map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (l) { var c = l.split('\t'), o = {}; head.forEach(function (h, i) { if (h) o[h] = c[i] == null ? '' : c[i]; }); return o; });
  }
  function coerce(f, v) {
    if (f.t === 'checkbox') return /^(true|yes|1|ticked|x)$/i.test(String(v).trim());
    if (f.t === 'number') { var n = App.parseNum(v); return n === '' ? '' : n; }
    if (f.asNum) return App.parseNum(v);
    return String(v == null ? '' : v);
  }
  /** Batch create / update rows on a settings list. Returns {created, updated, errors}. */
  function batchApplyRows(path, rows) {
    var def = defAt(path), fields = simpleFields(def), out = { created: 0, updated: 0, errors: [] };
    rows.forEach(function (r, i) {
      var v = {};
      fields.forEach(function (f) { if (f.k in r) v[f.k] = coerce(f, r[f.k]); });
      var id = blank(r.id) ? null : String(r.id).trim();
      var res = SP.save(path, v, id);
      if (res.ok) { if (id) out.updated++; else out.created++; } else out.errors.push('Row ' + (i + 2) + ': ' + res.error);
    });
    return out;
  }

  /* ---- Settings index: "in use" first (125) ---- */
  function anyLen(o) { if (!o) return false; if (Array.isArray(o)) return o.length > 0; if (typeof o === 'object') return Object.keys(o).some(function (k) { return anyLen(o[k]); }); return !!o; }
  function settingInUse(b, key) {
    if (!b) return false;
    var R = b.records || {}, d = b.details || {};
    switch (key) {
      case 'business': return !!(d.address || d.email || d.phone || d.taxNumber || d.logo || d.legalName);
      case 'capitalSub': return anyLen(b.capitalSubaccounts);
      case 'coa': return ((b.coa || []).filter(function (n) { return n && n.type === 'account'; })).length > 0;
      case 'control': return (b.coa || []).some(function (n) { return n && n.custCtrl; });
      case 'extensions': return anyLen(b.extensions);
      case 'customFields': return anyLen(b.customFieldDefs) || Object.keys(b.formConfig || {}).some(function (k) { return anyLen((b.formConfig[k] || {}).custom); });
      case 'themes': return anyLen(b.customThemes) || anyLen(b.invoiceDesigns) || Object.keys(b.formConfig || {}).some(function (k) { var c = b.formConfig[k] || {}; return anyLen(c.show); });
      case 'format': return !!(b.fmt && ((b.fmt.date && b.fmt.date !== 'DD/MM/YYYY') || (b.fmt.sep && b.fmt.sep !== 'comma-dot') || (b.fmt.decimals != null && +b.fmt.decimals !== 2)));
      case 'email': { var e = d.email || {}; return !!(e.smtpHost || e.relayUrl || e.fromAddr) || anyLen(b.emailTemplates); }
      case 'footers': return !!d.footer || anyLen(b.footers);
      case 'locations': return anyLen(b.locations);
      case 'obsolete': return anyLen(b.obsolete && Object.keys(b.obsolete).filter(function (k) { return b.obsolete[k] === true; })) || anyLen(b.classicCustomFields) || anyLen(b.scriptExtensions);
      case 'payslipItems': return anyLen(b.payslipItems);
      case 'tax': return anyLen(b.taxCodes);
      case 'permissions': return anyLen(b.userPermissions);
      case 'accessTokens': return anyLen(b.accessTokens);
      case 'attachments': return anyLen(b.attachments) || anyLen(R.attachments);
      case 'bankRules': return anyLen(b.bankRules);
      case 'billableExpenses': return !!(b.billableExpenses && b.billableExpenses.enabled);
      case 'cashFlowGroups': return anyLen(b.cashFlowGroups);
      case 'currencies': return anyLen(b.currencies) || anyLen(b.exchangeRates);
      case 'customReports': return anyLen(b.reports) || anyLen(b.customReports);
      case 'customerPortals': return anyLen(b.customerPortals);
      case 'divisions': return anyLen(b.divisions);
      case 'claimPayers': return anyLen(b.claimPayers);
      case 'forecasts': return anyLen(b.forecasts);
      case 'formDefaults': return Object.keys(b.formDefaults || {}).some(function (k) { var f = b.formDefaults[k] || {}; return Object.keys(f).some(function (x) { return x !== 'options' && !blank(f[x]); }); });
      case 'kits': return anyLen(b.inventoryKits);
      case 'unitCosts': return anyLen(b.inventoryUnitCosts);
      case 'marketPrices': return anyLen(b.investmentPrices);
      case 'keyboardNav': return !!b.keyboardNav;
      case 'lateFees': return !!(b.lateFees && b.lateFees.enabled);
      case 'lock': return !!b.lockDate;
      case 'nonInvItems': return anyLen(R.nonInvItems);
      case 'projects': return anyLen(b.projects);
      case 'recurring': return anyLen(b.recurring);
      case 'starting': return (b.coa || []).some(function (n) { return n && n.type === 'account' && num(n.balance) !== 0; }) ||
        ['bankCash', 'customers', 'suppliers', 'capital', 'special', 'employees'].some(function (k) { return (R[k] || []).some(function (r) { return r && num(r.balance) !== 0; }); }) ||
        anyLen(b.startingBalances);
      case 'webServices': return !!(b.webServices && b.webServices.exchangeRates && b.webServices.exchangeRates.enabled);
      case 'withholdingTax': return !!(b.withholdingTax && (b.withholdingTax.receivable || b.withholdingTax.payable));
    }
    return false;
  }
  App.settingInUse = settingInUse;
  var prevSettingsHtml = App.settingsHtml;
  App.settingsHtml = function (b) {
    if (this.setView) {
      var html = prevSettingsHtml.apply(this, arguments);
      return withBack(this, html);
    }
    var self = this;
    var can = function (t) { return typeof self.canSetting !== 'function' || self.canSetting(b, t[2]); };
    var ico = function (t) { return (typeof window !== 'undefined' && window.ICO) ? ICO.forSetting(t[2], 22) : ''; };
    var link = function (t) { return '<button class="sp-link" title="' + self.esc(t[3]) + '" onclick="App.openSetting(\'' + t[2] + '\')"><span class="sp-link-ico">' + ico(t) + '</span><span class="sp-link-nm">' + self.esc(t[1]) + '</span></button>'; };
    var tiles = this.setTiles().filter(can);
    var used = tiles.filter(function (t) { return settingInUse(b, t[2]); }), rest = tiles.filter(function (t) { return !settingInUse(b, t[2]); });
    return this.crumb('Settings') + '<div class="sp-index sfb-index">' +
      (used.length ? '<div class="sfb-idx-h">In use</div><div class="sp-grid sfb-used">' + used.map(link).join('') + '</div>' : '') +
      (used.length && rest.length ? '<div class="sp-divider"></div>' : '') +
      (rest.length ? '<div class="sfb-idx-h">' + (used.length ? 'Not in use yet' : 'Settings') + '</div><div class="sp-grid sfb-rest">' + rest.map(link).join('') + '</div>' : '') + '</div>';
  };

  /* every settings page: "Settings ▸ …" breadcrumb with a Back button (126) */
  function withBack(app, html) {
    if (typeof html !== 'string') return html;
    if (html.indexOf('ws-crumb') < 0) {
      var t = (app.setTiles().find(function (x) { return x[2] === app.setView; }) || [])[1] || 'Settings';
      html = app.crumb('Settings', t) + html;
    }
    if (html.indexOf('sfb-back') >= 0) return html;
    return html.replace(/(<div class="ws-crumb[^"]*"><div class="left">)/, '$1<button type="button" class="btn btn-xs sfb-back" onclick="SettingsFixesB.back()" title="Back">‹ Back</button>');
  }
  function back() {
    var R = App.sfbRoute;
    if (R) { App.sfbRoute = null; var s = splitPath(R.path); return SP.go(s.key, s.sub); }
    var r = App.spRoute;
    if (App.fmtForm && typeof App.openFmtCat === 'function' && App.fmtCat) { App.fmtForm = null; App.fmtDraft = null; return App.openFmtCat(App.fmtCat); }
    if (App.fmtCat) { App.fmtCat = null; return App.renderMain(App.curBiz()); }
    if (App.ctrlEditId != null) { App.ctrlEditId = null; return App.renderMain(App.curBiz()); }
    if (App._permDraft) { App._permDraft = null; return App.renderMain(App.curBiz()); }
    if (SP && r && r.key === App.setView) {
      if (r.action) return SP.go(r.key, r.sub);
      if (r.sub) { var parts = r.sub.split('/'); parts.pop(); return SP.go(r.key, parts.join('/')); }
    }
    return App.settingsBack();
  }

  /* =====================================================================
     120  Email delivery: copy-to, TLS flag, protocol; Test email settings
     ===================================================================== */
  App._sfbRelayPayload = function (b, cfg, msg) {
    cfg = cfg || {};
    return { to: msg.to, subject: msg.subject, body: msg.body, test: !!msg.test,
      from: cfg.fromAddr || '', fromName: cfg.fromName || (b && b.name) || '', replyTo: cfg.replyTo || '', bcc: cfg.bccTo || '',
      protocol: cfg.protocol || 'SMTP',
      smtp: { host: cfg.smtpHost || '', port: cfg.smtpPort || '', user: cfg.smtpUser || '', pass: cfg.smtpPass || '',
        encryption: cfg.encryption || 'TLS', verifyTls: !cfg.noTls } };
  };
  App._emailViaRelay = function (b, cfg, msg) {
    var self = this;
    var btns = hasDom ? document.querySelectorAll('#appOverlay .app-modal-f .btn') : [];
    Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
    fetch(cfg.relayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(self._sfbRelayPayload(b, cfg, msg)) })
      .then(function (r) { if (!r.ok) throw new Error('relay responded ' + r.status + ' ' + r.statusText); return r.text(); })
      .then(function () { self._emailLog(b, { to: msg.to, subject: msg.subject, body: msg.body, status: 'Sent', mode: 'relay' });
        self._closeOverlay(); toast('Email sent'); })
      .catch(function (err) { Array.prototype.forEach.call(btns, function (x) { x.disabled = false; });
        self._emailLog(b, { to: msg.to, subject: msg.subject, body: msg.body, status: 'Failed', mode: 'relay', error: err.message });
        modalAlert('Could not send via the relay:\n\n' + err.message + '\n\nThe attempt has been recorded in the Emails log.'); });
  };
  var prevMailto = App._mailtoHref;
  App._mailtoHref = function (cfg, msg) { var h = prevMailto.apply(this, arguments); if (cfg && cfg.bccTo) h += '&bcc=' + encodeURIComponent(cfg.bccTo); return h; };
  /** "Test email settings": through the relay when one is set, otherwise say clearly what will happen. */
  App.testEmailSettings = function () {
    var b = this.curBiz(); if (!b) return;
    /* test what is on screen, saved or not */
    var cfg = Object.assign({}, this.emailCfg(b));
    try { if (hasDom && document.getElementById('spForm') && SP) { var v = SP.collect(document.getElementById('spForm')); Object.keys(v).forEach(function (k) { cfg[k] = v[k]; }); if (!v.bcc) cfg.bccTo = ''; if (!v.reply) cfg.replyTo = ''; } } catch (e) {}
    cfg.relayUrl = String(cfg.relayUrl || '').trim();
    var to = cfg.fromAddr || cfg.bccTo || '';
    var probs = [];
    if (!cfg.fromAddr) probs.push('Enter a From email address.');
    if (cfg.protocol === 'HTTP' && !cfg.relayUrl) probs.push('HTTP needs the endpoint (relay) URL.');
    if (cfg.protocol !== 'HTTP' && cfg.relayUrl && !cfg.smtpHost) probs.push('Enter the SMTP hostname the relay should use.');
    if (probs.length) return modalAlert('Email settings are incomplete:\n\n• ' + probs.join('\n• '));
    if (!cfg.relayUrl) {
      return modalAlert('No relay URL is set, so nothing can be sent from this page directly — a browser cannot open an SMTP connection' +
        (cfg.smtpHost ? ' to ' + cfg.smtpHost + ':' + (cfg.smtpPort || '587') : '') + '.\n\nEmails will open in your mail client (from ' + cfg.fromAddr + '). ' +
        'To send straight from the app, run a small HTTP relay that receives these settings and delivers through your SMTP server, then enter its URL here.');
    }
    var self = this, msg = { to: to, subject: 'Test email from ' + (b.name || 'Manager'), body: 'This is a test message sent from the Email Settings page.', test: true };
    toast('Sending test email…');
    return fetch(cfg.relayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(self._sfbRelayPayload(b, cfg, msg)) })
      .then(function (r) { if (!r.ok) throw new Error('relay responded ' + r.status + ' ' + r.statusText); return r.text(); })
      .then(function () { self._emailLog(b, { to: to, subject: msg.subject, body: msg.body, status: 'Sent (test)', mode: 'relay' }); modalAlert('Test email sent to ' + to + '.'); })
      .catch(function (err) { self._emailLog(b, { to: to, subject: msg.subject, body: msg.body, status: 'Failed (test)', mode: 'relay', error: err.message });
        modalAlert('The test email could not be sent:\n\n' + err.message + '\n\nCheck the relay URL and that the relay is running.'); });
  };

  /* =====================================================================
     121  Email templates for every document type
     ===================================================================== */
  var TPL_TYPES = [['default', 'Default (all documents)'], ['salesQuotes', 'Sales Quote'], ['salesOrders', 'Sales Order'], ['salesInv', 'Sales Invoice'],
    ['creditNotes', 'Credit Note'], ['deliveryNotes', 'Delivery Note'], ['receipts', 'Receipt'], ['purchQuotes', 'Purchase Quote'], ['purchOrders', 'Purchase Order'],
    ['purchInv', 'Purchase Invoice'], ['debitNotes', 'Debit Note'], ['goodsRec', 'Goods Receipt'], ['payments', 'Payment'], ['payslips', 'Payslip'],
    ['expenseClaims', 'Expense Claim'], ['custStmt', 'Customer Statement'], ['supStmt', 'Supplier Statement']];
  var TPL_SUBJ = { salesOrders: 'Sales order {ref} from {business}', creditNotes: 'Credit note {ref} from {business}', deliveryNotes: 'Delivery note {ref} from {business}',
    purchQuotes: 'Request for quotation {ref} — {business}', purchOrders: 'Purchase order {ref} from {business}', debitNotes: 'Debit note {ref} from {business}',
    goodsRec: 'Goods receipt {ref} — {business}', payslips: 'Payslip {ref} — {business}', expenseClaims: 'Expense claim {ref} — {business}' };
  App._emTplTypes = function () { return TPL_TYPES.slice(); };
  var prevTplDefault = App._emTplDefault;
  App._emTplDefault = function (type) { var d = prevTplDefault.call(this, type); if (TPL_SUBJ[type]) d.subject = TPL_SUBJ[type]; return d; };
  var prevVars = App.emailVars;
  App.emailVars = function (b, key, rec) {
    var v = prevVars.apply(this, arguments); rec = rec || {};
    v.due = rec.dueDate ? this.fmtDate(rec.dueDate) : '';
    v.balance = (rec.balanceDue != null && rec.balanceDue !== '') ? this.money(rec.balanceDue) : '';
    v.description = rec.description || '';
    v.reference = v.ref; v.customer = v.party;
    return v;
  };
  /* the Email dialog: a Template picker that refills subject and message */
  var prevEmailDoc = App.emailDoc;
  App.emailDoc = function () {
    var b = this.curBiz(), key = (typeof LABEL2KEY !== 'undefined') ? LABEL2KEY[this.wsSection] : null;
    var rec = b ? (this.records(b) || []).find(function (r) { return String(r.id) === String(App.editingId); }) : null;
    this._sfbEmailCtx = rec ? { key: key, rec: rec } : null;
    return prevEmailDoc.apply(this, arguments);
  };
  var prevCompose = App.emailCompose;
  App.emailCompose = function (o) {
    var r = prevCompose.apply(this, arguments);
    try {
      var ctx = this._sfbEmailCtx; if (!ctx || !hasDom) return r;
      var body = document.querySelector('#appOverlay .app-modal-b'); if (!body || body.querySelector('#em_tpl')) return r;
      var b = this.curBiz(), saved = b.emailTemplates || {};
      var cur = TPL_TYPES.some(function (t) { return t[0] === ctx.key; }) ? ctx.key : 'default';
      var sel = document.createElement('div');
      sel.innerHTML = '<label class="fld">Template</label><select id="em_tpl" onchange="App._sfbPickTpl(this.value)">' + TPL_TYPES.filter(function (t) { return t[0].indexOf('Stmt') < 0; }).map(function (t) {
        return '<option value="' + t[0] + '"' + (t[0] === cur ? ' selected' : '') + '>' + esc(t[1]) + (saved[t[0]] ? '' : ' (standard)') + '</option>'; }).join('') + '</select>';
      var to = body.querySelector('#em_to'); var lab = to && to.previousElementSibling;
      while (sel.firstChild) body.insertBefore(sel.firstChild, lab || body.firstChild);
    } catch (e) {}
    return r;
  };
  App._sfbPickTpl = function (type) {
    var ctx = this._sfbEmailCtx, b = this.curBiz(); if (!ctx || !b) return;
    var vars = this.emailVars(b, ctx.key, ctx.rec), tpl = this.emailTplFor(b, type);
    var s = document.getElementById('em_subj'), m = document.getElementById('em_body');
    if (s) s.value = this._emFill(tpl.subject, vars); if (m) m.value = this._emFill(tpl.body, vars);
  };

  /* =====================================================================
     118  Themes on document views
     ===================================================================== */
  var DOC_KEYS = { salesQuotes: 1, salesOrders: 1, salesInv: 1, creditNotes: 1, deliveryNotes: 1, purchQuotes: 1, purchOrders: 1, purchInv: 1, debitNotes: 1,
    goodsRec: 1, receipts: 1, payments: 1, iat: 1, journal: 1, payslips: 1, expenseClaims: 1, invTransfers: 1, invWriteOffs: 1, production: 1,
    depreciation: 1, amortization: 1 };
  function themes(b) { return ((b && b.customThemes) || []).filter(function (t) { return t && t.id != null; }); }
  function themeById(b, id) { if (blank(id)) return null; return themes(b).find(function (t) { return String(t.id) === String(id); }) || null; }
  function themeUseCount(b, id) { var n = 0, R = (b && b.records) || {}; Object.keys(R).forEach(function (k) { (Array.isArray(R[k]) ? R[k] : []).forEach(function (r) { if (r && String(r.theme) === String(id)) n++; }); }); return n; }
  function curKey() { return (typeof LABEL2KEY !== 'undefined' && App.wsSection) ? LABEL2KEY[App.wsSection] : null; }
  function keyOfCfg(c) { if (c && c.label && typeof LABEL2KEY !== 'undefined' && LABEL2KEY[c.label]) return LABEL2KEY[c.label]; return curKey(); }
  function partyOf(rec) { return rec.customer || rec.supplier || rec.employee || rec.paidBy || rec.payee || rec.payer || ''; }
  function linesTable(b, rec) {
    var L = (rec.lines || []).filter(function (l) { return l && !l.rounding; });
    if (!L.length) return '';
    var M = function (v) { return v === '' || v == null ? '' : esc(App.money(v)); };
    return '<table class="theme-lines"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead><tbody>' +
      L.map(function (l) {
        var d = l.desc || l.description || l.item || l.items || l.accountName || '';
        return '<tr><td>' + esc(d) + '</td><td class="r">' + esc(l.qty == null ? '' : l.qty) + '</td><td class="r">' + M(l.price) + '</td><td class="r">' +
          M(l.taxAmt != null ? l.taxAmt : l.taxAmount) + '</td><td class="r">' + M(l.amount != null ? l.amount : (l.net != null ? l.net : l.debit)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  /** Render a record through a theme's HTML. `inner` is the standard layout. */
  function renderTheme(b, key, rec, theme, inner) {
    var d = (b && b.details) || {}, c = (typeof REG !== 'undefined' && REG[key]) || {};
    var pr = null; try { var pk = rec.customer ? 'customers' : rec.supplier ? 'suppliers' : null; if (pk) pr = recsOf(b, pk).find(function (x) { return x && x.name === partyOf(rec); }); } catch (e) {}
    var total = rec.total != null && rec.total !== '' ? rec.total : (rec.amount != null ? rec.amount : rec.netPay);
    var vars = {
      document: inner, business_name: esc(d.legalName || b.name || ''), business_address: esc(d.address || '').replace(/\n/g, '<br>'),
      title: esc(rec.customTitleOn && rec.customTitle ? rec.customTitle : (c.singular || '')), reference: esc(rec.reference || ''),
      date: esc(App.fmtDate(rec.issueDate || rec.date || '')), due_date: esc(App.fmtDate(rec.dueDate || '')), party: esc(partyOf(rec)),
      party_address: esc(rec.billingAddress || (pr && pr.address) || '').replace(/\n/g, '<br>'), description: esc(rec.description || rec.narration || ''),
      lines: linesTable(b, rec), subtotal: rec.subtotal != null && rec.subtotal !== '' ? esc(App.money(rec.subtotal)) : '',
      tax: rec.tax != null && rec.tax !== '' && !isNaN(Number(rec.tax)) ? esc(App.money(rec.tax)) : '', total: total != null && total !== '' ? esc(App.money(total)) : '',
      amount_in_words: total != null && total !== '' ? esc(App.amountInWords ? App.amountInWords(total) : '') : '', footer: esc(d.footer || '').replace(/\n/g, '<br>')
    };
    var html = String(theme.content || '');
    var usesDoc = /\{\{\s*document\s*\}\}/.test(html) || /id=["']doc["']/.test(html);
    html = html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, k) { k = k.toLowerCase(); return k in vars ? vars[k] : m; });
    html = html.replace(/(<[a-z]+[^>]*\bid=["']doc["'][^>]*>)(\s*)(<\/[a-z]+>)/i, function (m, open, sp, close) { return open + inner + close; });
    if (!/<html[\s>]/i.test(html)) html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
    var head = (usesDoc ? '<link rel="stylesheet" href="css/app.css"><link rel="stylesheet" href="css/forms-fixes.css"><link rel="stylesheet" href="css/txn-forms.css">' : '') +
      '<style>html,body{background:#fff;color:#111}.theme-lines{width:100%;border-collapse:collapse}.theme-lines th,.theme-lines td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}.theme-lines .r{text-align:right}</style>';
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + head; }) : html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + head + '</head>'; });
    return html;
  }
  App.renderTheme = renderTheme;
  var prevVoucher = App.voucherDoc;
  App.voucherDoc = function (b, c, rec, opts) {
    var inner = prevVoucher.apply(this, arguments);
    try {
      var key = keyOfCfg(c), th = rec && themeById(b, rec.theme);
      if (!th || !DOC_KEYS[key] || (opts && opts.noTheme)) return inner;
      var html = renderTheme(b, key, rec, th, inner);
      return '<iframe class="sfb-theme-frame" title="' + esc(th.name) + '" srcdoc="' + esc(html) + '" onload="SettingsFixesB._fit(this)"></iframe>';
    } catch (e) { return inner; }
  };
  var prevPrint = App._printDoc;
  App._printDoc = function (b, c, rec) {
    var key = keyOfCfg(c), th = rec && themeById(b, rec.theme);
    if (!th || !DOC_KEYS[key] || !hasDom) return prevPrint.apply(this, arguments);
    var inner = ''; try { inner = prevVoucher.call(this, b, c, rec); } catch (e) {}
    var html = renderTheme(b, key, rec, th, inner);
    var f = document.createElement('iframe'); f.className = 'sfb-print-frame'; f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.onload = function () { setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(function () { try { f.remove(); } catch (e) {} }, 2000); }, 150); };
    f.srcdoc = html; document.body.appendChild(f);
  };
  var prevView = App.viewHtml;
  App.viewHtml = function (b) {
    var html = prevView.apply(this, arguments), key = curKey();
    if (typeof html !== 'string' || !DOC_KEYS[key] || html.indexOf('inv-designed-view') >= 0 || html.indexOf('sfb-theme-sel') >= 0) return html;
    var rec = (this.records(b) || []).find(function (r) { return r.id === App.editingId; }) || {};
    var cur = themeById(b, rec.theme) ? String(rec.theme) : '';
    var sel = '<label class="sfb-theme-wrap" title="Theme"><span>Theme</span><select class="sfb-theme-sel" onchange="SettingsFixesB.setTheme(this.value)">' +
      '<option value="">Default</option>' + themes(b).map(function (t) { return '<option value="' + esc(t.id) + '"' + (String(t.id) === cur ? ' selected' : '') + '>' + esc(t.name || 'Theme') + '</option>'; }).join('') +
      '<option value="__manage">Manage themes…</option></select></label>';
    return html.replace(/(<div class="view-bar"><span class="view-doc">[\s\S]*?<\/span>)/, function (m) { return m + sel; });
  };
  function setTheme(id) {
    if (id === '__manage') { App.selectSection('Settings'); App.setView = 'themes'; App.spRoute = { key: 'themes', sub: 'html', action: null, id: null };
      App.fmtCat = null; App.fmtForm = null; return App.renderMain(App.curBiz()); }
    var b = App.curBiz(), key = curKey(); if (!b || !key) return;
    var arr = recsOf(b, key), rec = arr.find(function (r) { return r.id === App.editingId; }); if (!rec) return;
    if (id) rec.theme = id; else delete rec.theme;
    App.saveBiz(b); App.renderMain(b);
  }

  /* =====================================================================
     119  User Permissions: "New User Permissions"; levels enforced
     ===================================================================== */
  function usersList() { try { var a = DB.get(DB.k.users, []); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  if (typeof App.set_permissions === 'function') {
    var prevPerm = App.set_permissions;
    App.set_permissions = function (b) {
      var d = this._permDraft, html = prevPerm.apply(this, arguments);
      if (typeof html !== 'string') return html;
      if (d && d.newMode) {
        var have = b.userPermissions || {};
        var opts = usersList().filter(function (u) { return u.role !== 'Administrator' && !have[u.id]; });
        var sel = '<select id="permNewUser" onchange="App.permNewUser(this.value)"><option value="">— choose a user —</option>' + opts.map(function (u) {
          return '<option value="' + esc(u.id) + '"' + (String(u.id) === String(d.userId || '') ? ' selected' : '') + '>' + esc(u.username + (u.name ? ' — ' + u.name : '')) + '</option>'; }).join('') + '</select>' +
          (opts.length ? '' : '<div class="ua-hint">Every restricted user already has permissions here. Add users from the Users tab in the top bar.</div>');
        html = html.replace(/<label class="fld">Username<\/label><input type="text" value="[^"]*" disabled>/, '<label class="fld">Username</label>' + sel)
          .replace(/<h2>User Permissions — [^<]*<\/h2>/, '<h2>New User Permissions</h2>');
        return html;
      }
      if (!d) html = html.replace('<div class="card"><h2>User Permissions</h2>', '<div class="card"><div class="sfb-perm-h"><h2>User Permissions</h2><button class="btn btn-primary btn-sm" onclick="App.permNew()">New User Permissions</button></div>');
      return html;
    };
    App.permNew = function () {
      var b = this.curBiz(); if (!b) return;
      var UA = G.UsersAccess, p = { access: 'Custom access', perms: {}, reports: {}, settings: {}, banks: [] };
      try { if (UA && UA.normPerm) p = UA.normPerm(p); } catch (e) {}
      this._permDraft = { bizId: b.id, userId: null, username: '', newMode: true, p: p };
      this.renderMain(b);
    };
    App.permNewUser = function (id) {
      var d = this._permDraft; if (!d) return;
      var u = usersList().find(function (x) { return String(x.id) === String(id); });
      d.userId = u ? u.id : null; d.username = u ? u.username : '';
    };
    var prevPermSave = App.permSave;
    App.permSave = function () {
      var d = this._permDraft, b = this.curBiz();
      if (d && d.newMode) {
        if (!d.userId) { d.msg = { error: 'Choose the user these permissions are for.' }; return this.renderMain(b); }
        /* the user can only open the business once it is assigned to them */
        var list = usersList(), u = list.find(function (x) { return String(x.id) === String(d.userId); });
        if (u && !(u.businesses || []).some(function (x) { return String(x) === String(b.id); })) { u.businesses = (u.businesses || []).concat([b.id]); DB.set(DB.k.users, list); }
      }
      return prevPermSave.apply(this, arguments);
    };
  }
  /* views drawn by other modules (TxnForms, ledger-nav pager, designed invoices) keep their own Edit / Delete buttons:
     strip what the user's level does not allow from every rendered record page */
  function secLevel() { var b = curB(); try { return b && typeof App.permLevel === 'function' && App.wsSection && typeof LABEL2KEY !== 'undefined' && LABEL2KEY[App.wsSection] ? App.permLevel(b, App.wsSection) : 4; } catch (e) { return 4; } }
  function stripLevel(html, lvl) {
    if (typeof html !== 'string' || lvl >= 4) return html;
    var fns = ['deleteRecord', 'TxnForms\\.del', 'batchMenu', 'batchDelete'];
    if (lvl < 3) fns.push('editRecord', 'TxnForms\\.save\\(\'update\'');
    if (lvl < 2) fns.push('newRecord', 'cloneRecord', 'copyToMenu', 'createFrom', 'TxnForms\\.cloneDoc', 'TxnForms\\.receivePayment', 'receivePayment');
    var re = new RegExp('<button\\b[^>]*onclick="[^"]*?(?:App\\.)?(?:' + fns.join('|') + ')[^"]*"[^>]*>[\\s\\S]*?<\\/button>', 'g');
    return html.replace(re, '');
  }
  App._sfbStripLevel = stripLevel;
  ['viewHtml', 'formHtml'].forEach(function (n) {
    if (typeof App[n] !== 'function') return;
    var prev = App[n];
    App[n] = function () { return stripLevel(prev.apply(this, arguments), secLevel()); };
  });

  /* =====================================================================
     65  Sales Invoice: qty beyond the location's stock
     ===================================================================== */
  /* sales invoices / credit notes that name a custom location draw from (return to) that location */
  if (typeof invQtyByLocation === 'function') {
    var prevByLoc = invQtyByLocation;
    var byLoc = function (b, loc) {
      var out = prevByLoc(b, loc), R = (b && b.records) || {};
      [['salesInv', -1], ['creditNotes', 1]].forEach(function (p) {
        (R[p[0]] || []).forEach(function (r) { if (!r || (r.location || '') !== loc || !loc) return;
          (r.lines || []).forEach(function (ln) { var q = Number(ln.qty) || 0, it = ln.item || ln.items; if (!q || !it) return; out[it] = (out[it] || 0) + p[1] * q; }); });
      });
      return out;
    };
    try { G.invQtyByLocation = byLoc; } catch (e) {}
    try { invQtyByLocation = byLoc; } catch (e) {} // eslint-disable-line no-global-assign
  }
  function locNames(b) { return ['Main location'].concat(((b && b.locations) || []).map(function (l) { return l && l.name; }).filter(Boolean)); }
  /** Lines of a sales invoice whose qty is more than the location holds. editId: the invoice being edited (its own qty is added back). */
  function stockShortfalls(b, lines, loc, editId) {
    var inv = recsOf(b, 'inventory'), want = {}, out = [];
    (lines || []).forEach(function (l) { var it = l && (l.item || l.items); if (!it || !inv.some(function (x) { return x && x.name === it; })) return; var q = blank(l.qty) ? 1 : num(l.qty); if (q > 0) want[it] = (want[it] || 0) + q; });
    var mine = {};
    if (editId != null) { var old = recsOf(b, 'salesInv').find(function (r) { return r && String(r.id) === String(editId); });
      if (old && (old.location || 'Main location') === (loc || 'Main location')) (old.lines || []).forEach(function (l) { var it = l.item || l.items; if (it) mine[it] = (mine[it] || 0) + (Number(l.qty) || 0); }); }
    Object.keys(want).forEach(function (it) {
      var have = 0; try { have = invQtyAtLocation(b, it, loc || 'Main location'); } catch (e) {}
      have += mine[it] || 0;
      if (want[it] > have + 1e-9) out.push({ item: it, qty: want[it], available: Math.round(have * 1e6) / 1e6 });
    });
    return out;
  }
  App.stockShortfalls = stockShortfalls;
  function stockScan() {
    if (!hasDom) return;
    var host = document.getElementById('txHost'); if (!host || host.getAttribute('data-tx-key') !== 'salesInv' || !G.TxnForms) return;
    var TX = G.TxnForms.state && G.TxnForms.state(); if (!TX || TX.key !== 'salesInv') return;
    var b = App.curBiz(); if (!b) return;
    var locs = locNames(b);
    if (TX.location == null) { var old = TX.id != null ? recsOf(b, 'salesInv').find(function (r) { return r && r.id === TX.id; }) : null; TX.location = (old && old.location) || ''; }
    var head = document.getElementById('txHead');
    if (head && locs.length > 1 && !head.querySelector('#sfbLoc')) {
      var div = document.createElement('div'); div.className = 'tf-row2 sfb-loc-row';
      div.innerHTML = '<div class="tf-f"><label class="tf-l">Inventory location</label><select id="sfbLoc" onchange="SettingsFixesB.setLocation(this.value)">' +
        locs.map(function (l, i) { var v = i === 0 ? '' : l; return '<option value="' + esc(v) + '"' + (String(TX.location || '') === v ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select></div>';
      head.appendChild(div);
    }
    var lines = document.getElementById('txLines'); if (!lines) return;
    var box = document.getElementById('sfbStock');
    var short = stockShortfalls(b, TX.lines, TX.location || 'Main location', TX.mode === 'edit' ? TX.id : null);
    var txt = short.map(function (s) { return '<li><b>' + esc(s.item) + '</b>: qty ' + esc(App.numStr ? App.numStr(s.qty) : s.qty) + ' is more than the ' + esc(App.numStr ? App.numStr(s.available) : s.available) + ' in stock at ' + esc(TX.location || 'Main location') + '.</li>'; }).join('');
    var key = TX.location + '|' + txt;
    if (!short.length) { if (box) box.remove(); return; }
    if (box && box.getAttribute('data-k') === key) return;
    if (!box) { box = document.createElement('div'); box.id = 'sfbStock'; box.className = 'sfb-stock'; box.setAttribute('role', 'status'); lines.parentNode.insertBefore(box, lines.nextSibling); }
    box.setAttribute('data-k', key);
    box.innerHTML = '<div class="sfb-stock-t">Not enough stock</div><ul>' + txt + '</ul><div class="sfb-stock-n">You can still save — the item will show a negative quantity until stock is received.</div>';
  }
  if (hasDom) document.addEventListener('input', function (e) { if (e.target && e.target.closest && e.target.closest('#txHost')) setTimeout(stockScan, 0); }, true);
  /* the location travels with the saved invoice */
  if (typeof App.ensureControlsFor === 'function') {
    var prevEnsure = App.ensureControlsFor;
    App.ensureControlsFor = function (b, key, rec) {
      try { if (key === 'salesInv' && rec && G.TxnForms && G.TxnForms.state) { var TX = G.TxnForms.state(); if (TX && TX.key === 'salesInv' && TX.location != null) { if (TX.location) rec.location = TX.location; else delete rec.location; } } } catch (e) {}
      return prevEnsure.apply(this, arguments);
    };
  }

  /* =====================================================================
     Trial Balance grouped by account type with subtotals
     ===================================================================== */
  var TB_GROUPS = [['assets', 'Assets'], ['liabilities', 'Liabilities'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expenses']];
  /** Rows of a trial balance in groups: [{root, label, rows:[{name, cells:[{dr,cr}]}], sub:[{dr,cr}]}] plus totals. */
  function trialGroups(b, periods, balOf) {
    var accts = ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account'; });
    var groups = TB_GROUPS.map(function (g) { return { root: g[0], label: g[1], rows: [], sub: periods.map(function () { return { dr: 0, cr: 0 }; }) }; });
    var totals = periods.map(function () { return { dr: 0, cr: 0 }; });
    accts.forEach(function (n) {
      var natC = false; try { natC = acctNature(b, n) === 'C'; } catch (e) {}
      var cells = periods.map(function (p) { var bal = balOf(n, p), dr = 0, cr = 0; if (natC) { if (bal >= 0) cr = bal; else dr = -bal; } else { if (bal >= 0) dr = bal; else cr = -bal; } return { dr: dr, cr: cr }; });
      if (!cells.some(function (c) { return Math.abs(c.dr) > 0.005 || Math.abs(c.cr) > 0.005; })) return;
      var root = rootOf(b, n), g = groups.find(function (x) { return x.root === root; }) || groups[0];
      var name = (typeof acctPath === 'function' ? acctPath(b, n) : (n.name || ''));
      g.rows.push({ name: name, code: n.code || '', id: n.id, cells: cells });
      cells.forEach(function (c, i) { g.sub[i].dr += c.dr; g.sub[i].cr += c.cr; totals[i].dr += c.dr; totals[i].cr += c.cr; });
    });
    groups.forEach(function (g) {
      /* "Income › Sales" under the Income heading reads as "Sales" */
      g.rows.forEach(function (r) { var pre = g.label + ' › '; if (r.name.indexOf(pre) === 0) r.name = r.name.slice(pre.length); });
      g.rows.sort(function (x, y) { return x.name.localeCompare(y.name); }); });
    return { groups: groups.filter(function (g) { return g.rows.length; }), totals: totals };
  }
  App.trialGroups = trialGroups;
  function trialTable(app, g, periods) {
    var nf = function (v) { var n = Number(v) || 0; return Math.abs(n) < 0.005 ? '' : app.money(n); };
    var th = '<th>Account</th>' + periods.map(function (p) { var nm = app.esc(p.colName || ''); return '<th class="r">' + (nm ? nm + ' ' : '') + 'Debit</th><th class="r">' + (nm ? nm + ' ' : '') + 'Credit</th>'; }).join('');
    var span = 1 + periods.length * 2;
    var body = g.groups.map(function (grp) {
      return '<tr class="tb-grp"><td colspan="' + span + '">' + app.esc(grp.label) + '</td></tr>' +
        grp.rows.map(function (r) { return '<tr class="tb-row"><td class="tb-acct">' + app.esc(r.name) + (r.code ? ' <span class="tb-code">(' + app.esc(r.code) + ')</span>' : '') + '</td>' +
          r.cells.map(function (c) { return '<td class="r m">' + nf(c.dr) + '</td><td class="r m">' + nf(c.cr) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '<tr class="tb-sub"><td>Total ' + app.esc(grp.label) + '</td>' + grp.sub.map(function (c) { return '<td class="r m">' + nf(c.dr) + '</td><td class="r m">' + nf(c.cr) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var tf = '<tr class="tb-total"><td>Total</td>' + g.totals.map(function (t) { return '<td class="r m">' + app.money(t.dr) + '</td><td class="r m">' + app.money(t.cr) + '</td>'; }).join('') + '</tr>';
    var ok = g.totals.every(function (t) { return Math.abs(t.dr - t.cr) < 0.005; });
    return '<table class="reg-tbl tb-grouped"><thead><tr>' + th + '</tr></thead><tbody>' + (body || '<tr><td colspan="' + span + '"><div class="reg-empty">No account balances yet.</div></td></tr>') + '</tbody><tfoot>' + tf + '</tfoot></table>' +
      (ok ? '' : '<div class="info-bar" style="color:var(--warn);border-color:var(--warn-line);background:var(--warn-tint)">Out of balance — total debits do not equal total credits.</div>');
  }
  if (typeof App._renderTrial === 'function') {
    App._renderTrial = function (b, key, inst) {
      var self = this, periods = this._periods(inst);
      var g = trialGroups(b, periods, function (n, p) { return self._acctAsOf(b, n.id, p.to); });
      return this.repHead(b, (this._REPDEF[key] || {}).name) + trialTable(this, g, periods.map(function (p) { return { colName: periods.length > 1 ? (p.colName || '') : '' }; })) + this.repFoot();
    };
  }
  if (typeof App.trialBalanceHtml === 'function' && typeof GL !== 'undefined') {
    App.trialBalanceHtml = function (b) {
      var tb = GL.trial(b, {}), byId = {}; tb.rows.forEach(function (r) { byId[r.id] = r; });
      var g = trialGroups(b, [{}], function (n) { var r = byId[n.id]; if (!r) return 0; var natC = false; try { natC = acctNature(b, n) === 'C'; } catch (e) {} return natC ? (r.credit - r.debit) : (r.debit - r.credit); });
      return this.repHead(b, 'Trial Balance') + trialTable(this, g, [{ colName: '' }]) + this.repFoot();
    };
  }

  /* =====================================================================
     public API (inline handlers + tests)
     ===================================================================== */
  var API = {
    DATE_FORMATS: DATE_FORMATS, NUM_FORMATS: NUM_FORMATS, COUNTRIES: COUNTRIES,
    fmtParts: fmtParts, taxAccountOpts: taxAccountOpts, taxTxCount: taxTxCount, settingInUse: settingInUse,
    parseTsv: parseTsv, batchApplyRows: batchApplyRows, renderTheme: renderTheme, stockShortfalls: stockShortfalls, trialGroups: trialGroups,
    stripLevel: stripLevel, decorate: decorate, paintAllDates: paintAllDates,
    back: back,
    openExtra: function (path, action) { var s = splitPath(path); App.setView = s.key; App.spRoute = { key: s.key, sub: s.sub, action: null, id: null }; App.sfbRoute = { key: s.key, path: path, action: action };
      var b = App.curBiz(); if (b) App.renderMain(b); try { var m = document.getElementById('wsMain'); if (m && m.scrollTo) m.scrollTo(0, 0); } catch (e) {} },
    leaveExtra: function () { var R = App.sfbRoute; App.sfbRoute = null; if (R) { var s = splitPath(R.path); SP.go(s.key, s.sub); } else App.settingsBack(); },
    saveFormDefaults: function (path, values) {
      var b = App.curBiz(); if (!b) return false; var def = defAt(path); if (!def) return false;
      var v = values;
      if (!v) { v = {}; var root = hasDom && document.getElementById('sfbFd'); if (root) root.querySelectorAll('[data-fd]').forEach(function (el) { var k = el.getAttribute('data-fd'), t = el.getAttribute('data-ft');
        var x = el.value; if (t === 'checkbox') x = x === '1' ? true : x === '0' ? false : ''; v[k] = x; }); }
      var clean = {}; simpleFields(def).forEach(function (f) { if (f.k in v && v[f.k] !== '' && v[f.k] != null) clean[f.k] = f.t === 'number' ? App.parseNum(v[f.k]) : v[f.k]; });
      var st = fdStore(b); if (Object.keys(clean).length) st[path] = clean; else delete st[path];
      App.saveBiz(b); if (!values) { toast('Updated'); API.leaveExtra(); }
      return true;
    },
    batchApply: function (path) {
      var ta = document.getElementById('sfbTsv'); if (!ta) return;
      var rows = parseTsv(ta.value); if (!rows.length) return modalAlert('Paste a table with a header row first.');
      var r = batchApplyRows(path, rows);
      modalAlert('Created ' + r.created + ', updated ' + r.updated + '.' + (r.errors.length ? '\n\n' + r.errors.join('\n') : ''));
      App.renderMain(App.curBiz());
    },
    batchDelete: function (path) {
      var box = document.getElementById('sfbDel'); if (!box) return;
      var ids = Array.prototype.map.call(box.querySelectorAll('input:checked'), function (i) { return i.value; });
      if (!ids.length) return modalAlert('Tick the records to delete.');
      Promise.resolve(modalConfirm('Delete ' + ids.length + ' record' + (ids.length === 1 ? '' : 's') + '? This cannot be undone.', { danger: true, okText: 'Delete' })).then(function (ok) {
        if (!ok) return; ids.forEach(function (id) { SP.del(path, id); }); toast('Deleted ' + ids.length); App.renderMain(App.curBiz()); });
    },
    setTheme: setTheme,
    setLocation: function (v) { var TX = G.TxnForms && G.TxnForms.state && G.TxnForms.state(); if (!TX) return; TX.location = v || ''; stockScan(); },
    _fit: function (f) { try { var d = f.contentDocument; if (!d) return; var h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0); f.style.height = (h + 8) + 'px'; } catch (e) {} },
    stockScan: stockScan
  };
  G.SettingsFixesB = API;
})();
