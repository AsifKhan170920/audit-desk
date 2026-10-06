/* ===================== Settings pages =====================
   A small, declarative framework for the Settings area, modelled on the
   Bookkeeping Desk / Manager.io layout:

     kind 'menu'   — a card listing sub-pages
     kind 'list'   — a card with search, sort, table, record count, Edit columns
                     and Copy to clipboard; New opens an edit form, a row opens it
     kind 'form'   — a single record (e.g. Lock Date, Keyboard Navigation)
     kind 'legacy' — hands over to an existing App.set_* screen
     kind 'link'   — a menu entry that runs an App action

   Every page reads and writes the open business object `b` and persists with
   App.saveBiz(b). Pages that already existed keep their data where the rest of
   the app reads it (b.taxCodes, b.currencies, b.lockDate, b.fmt, …) through a
   `store` adapter, so accounting.js and the forms see no difference.

   The module publishes one global, `SettingsPages`, and installs App.set_<key>
   for every page it owns. Pages it does not own (Chart of Accounts, User
   Permissions, Custom Reports, Attachments) keep their App handlers. */
(function () {
  'use strict';
  if (typeof App === 'undefined') return;

  /* ---------- small helpers ---------- */
  function esc(s) { return App.esc(s == null ? '' : s); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function uid() { return 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function q(s) { return esc(JSON.stringify(String(s))); }          // a JS string literal safe inside onclick="…"
  function fmtNum(v) { return App.money(num(v)); }
  function fmtDate(v) { return v ? App.fmtDateUS(v) : ''; }
  function pathGet(o, p) { return String(p).split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function pathSet(o, p, v) { var ks = String(p).split('.'), x = o;
    for (var i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== 'object') x[ks[i]] = {}; x = x[ks[i]]; }
    x[ks[ks.length - 1]] = v; }
  function toast(msg) {
    try { if (typeof document === 'undefined' || !document.body || !document.body.nodeType) return;
      var t = document.createElement('div'); t.className = 'sp-toast'; t.textContent = msg; document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (e) {} }, 2200); } catch (e) {}
  }
  function ask(qs, rerun) { try { if (typeof UIModal !== 'undefined' && UIModal.gate) return UIModal.gate(qs, rerun); return typeof confirm === 'function' ? confirm(qs) : true; } catch (e) { return true; } }
  function recs(b, key) { return (b && b.records && b.records[key]) || []; }
  function names(b, key) { return recs(b, key).map(function (r) { return r.name; }).filter(Boolean); }

  /* ---------- shared option lists ---------- */
  var REPEAT = ['Never', 'Every day', 'Every week', 'Every 2 weeks', 'Every month', 'Every 2 months', 'Every 3 months', 'Every 6 months', 'Every year'];
  var EVERY = ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Yearly'];   // what App._recurAdvance understands
  var ALL_CUR = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'PKR', 'INR', 'AUD', 'CAD', 'SGD', 'NZD', 'JPY', 'CNY', 'CHF', 'ZAR', 'QAR', 'KWD', 'BHD', 'OMR', 'TRY'];
  var DOC_TYPES = ['Bank and Cash Accounts', 'Receipts', 'Payments', 'Inter Account Transfers', 'Bank Reconciliations', 'Customers', 'Sales Quotes', 'Sales Orders', 'Sales Invoices', 'Credit Notes', 'Delivery Notes', 'Suppliers', 'Purchase Quotes', 'Purchase Orders', 'Purchase Invoices', 'Debit Notes', 'Goods Receipts', 'Inventory Items', 'Inventory Kits', 'Non-inventory Items', 'Inventory Transfers', 'Inventory Write-offs', 'Production Orders', 'Projects', 'Employees', 'Payslips', 'Expense Claims', 'Fixed Assets', 'Depreciation Entries', 'Intangible Assets', 'Amortization Entries', 'Capital Accounts', 'Journal Entries', 'Special Accounts'];
  var CF_PLACEMENTS = ['Amortization Entry', 'Bank or Cash Account', 'Bank Reconciliation', 'Business Details', 'Capital Account', 'Credit Note', 'Credit Note - Line', 'Customer', 'Debit Note', 'Debit Note - Line', 'Delivery Note', 'Delivery Note - Line', 'Depreciation Entry', 'Employee', 'Expense Claim', 'Expense Claim - Line', 'Fixed Asset', 'Goods Receipt', 'Goods Receipt - Line', 'Intangible Asset', 'Inter Account Transfer', 'Inventory Item', 'Inventory kit', 'Inventory Transfer', 'Inventory Write-off', 'Investment', 'Journal Entry', 'Journal Entry - Line', 'Non-inventory Item', 'Payment', 'Payment - Line', 'Payslip', 'Production Order', 'Project', 'Purchase Invoice', 'Purchase Invoice - Line', 'Purchase Order', 'Purchase Order - Line', 'Purchase Quote', 'Purchase Quote - Line', 'Receipt', 'Receipt - Line', 'Sales Invoice', 'Sales Invoice - Line', 'Sales Order', 'Sales Order - Line', 'Sales Quote', 'Sales Quote - Line', 'Special Account', 'Supplier', 'Tax Code'];

  /* option sources take the business so they always read live data */
  function accountOpts(b) { return [['', '— account —']].concat(App.accountOptions(b).map(function (o) { return [o.id, o.label]; })); }
  function acctLabel(b, id) { if (!id) return ''; var o = App.accountOptions(b).find(function (x) { return String(x.id) === String(id); }); return o ? o.label : String(id); }
  function taxOpts(b) { return [''].concat(((b && b.taxCodes) || []).map(function (t) { return t.name; }).filter(Boolean)); }
  function divOpts(b) { return [''].concat(((b && b.divisions) || []).map(function (d) { return d.name; }).filter(Boolean)); }
  function curOpts(b) { return ((b && b.currencies) || []).map(function (c) { return c.code; }).filter(Boolean); }
  function recOpts(key) { return function (b) { return [''].concat(names(b, key)); }; }

  /* ---------- field builders (same vocabulary as the source) ---------- */
  function ext(o, x) { if (x) for (var k in x) o[k] = x[k]; return o; }
  function T(k, l, o) { return ext({ k: k, l: l, t: 'text' }, o); }
  function N(k, l, o) { return ext({ k: k, l: l, t: 'number' }, o); }
  function D(k, l, o) { return ext({ k: k, l: l, t: 'date', def: today }, o); }
  function S(k, l, opts, o) { return ext({ k: k, l: l, t: 'select', opts: opts }, o); }
  function C(k, l, reveal, o) { return ext({ k: k, l: l, t: 'checkbox', reveal: reveal }, o); }
  function TA(k, l, o) { return ext({ k: k, l: l, t: 'textarea' }, o); }
  function CODE(k, l, o) { return ext({ k: k, l: l, t: 'code' }, o); }
  function PW(k, l, o) { return ext({ k: k, l: l, t: 'password' }, o); }
  function ACC(k, l, o) { return ext({ k: k, l: l, t: 'select', opts: accountOpts, def: '' }, o); }
  function IMG(k, l) { return { k: k || 'image', l: l || 'Image', t: 'image' }; }
  function CHECKS(k, l, items, o) { return ext({ k: k, l: l, t: 'checks', items: items }, o); }
  function MSEL(k, l, items, o) { return ext({ k: k, l: l, t: 'msel', items: items }, o); }
  function LINES(k, l, cols, o) { return ext({ k: k, l: l, t: 'lines', cols: cols }, o); }
  function FS(l, fields, o) { return ext({ t: 'fieldset', l: l, fields: fields }, o); }

  /* ---------- store adapters ---------- */
  /* A subset of one array (e.g. the payment rules inside b.bankRules). Order of
     the whole array is preserved, since bank rules match first-wins. */
  function subset(path, pred, stamp) {
    return {
      get: function (b) { var all = pathGet(b, path) || []; ensureIds(all); return all.filter(pred); },
      set: function (b, rows) { var all = pathGet(b, path) || [], out = [], seen = {};
        all.forEach(function (r) {
          if (!pred(r)) { out.push(r); return; }
          var n = rows.find(function (x) { return String(x.id) === String(r.id); });
          if (n) { out.push(stamp(n)); seen[n.id] = 1; }
        });
        rows.forEach(function (n) { if (!seen[n.id]) out.push(stamp(n)); });
        pathSet(b, path, out); }
    };
  }
  /* Starting balances held on the subsidiary records themselves
     (records[key][].balance and similar): the list shows the records that carry
     a figure, and saving writes the figures back by name. */
  function recordFigures(key, nameCol, map) {
    var fields = Object.keys(map);
    return {
      get: function (b) { return recs(b, key).filter(function (r) { return fields.some(function (f) { return num(r[map[f]]) !== 0; }); })
        .map(function (r) { var o = { id: 'r' + r.id }; o[nameCol] = r.name; fields.forEach(function (f) { o[f] = r[map[f]]; }); return o; }); },
      set: function (b, rows) { recs(b, key).forEach(function (r) {
        var row = rows.find(function (x) { return x[nameCol] === r.name; });
        fields.forEach(function (f) { var v = row ? App.parseNum(row[f]) : 0; r[map[f]] = (v === '' ? 0 : v); }); }); }
    };
  }

  /* ---------- page builders ---------- */
  function nameList(title, store, entity, newLabel, seed) {
    return { kind: 'list', title: title, entity: entity, newLabel: newLabel, store: store, seed: seed,
      cols: [{ k: 'name', l: 'Name' }], fields: [T('name', 'Name', { req: 1 })] };
  }
  function customFieldPage(title, type) {
    var f = [T('name', 'Name', { req: 1 }), N('position', 'Position', { cls: 'w-sm' })];
    if (type === 'image') f.push(N('width', 'Width', { cls: 'w-sm' }), N('height', 'Height', { cls: 'w-sm' }));
    f.push(MSEL('placement', 'Placement', CF_PLACEMENTS));
    if (type === 'text') f.push(S('type', 'Type', ['Single line text', 'Paragraph text', 'Drop-down list', 'QR Code']),
      TA('options', 'Options for drop-down list', { show: function (v) { return v.type === 'Drop-down list'; } }),
      S('size', 'Size', ['Small', 'Medium', 'Large']));
    if (type === 'multi') f.push(T('options', 'Options'));
    f.push(TA('description', 'Description'), C('noCopy', 'Exclude from copying or cloning'), C('locked', 'Locked for manual editing'));
    if (type === 'number') f.push(C('minDecimals', 'Minimal decimal places', [N('decimals', '', { cls: 'w-sm', ph: '0' })]));
    f.push(C('printed', 'Show custom field on printed documents'));
    if (type === 'number') f.push(C('hideTotal', 'Hide total amount'));
    return { kind: 'list', title: title, entity: title.replace(/s$/, ''), newLabel: 'New Custom Field', advanced: true,
      store: 'customFieldDefs.' + type,
      cols: [{ k: 'name', l: 'Name' }, { k: 'placement', l: 'Placement', fmt: function (v) { return (v || []).join(', '); } }, { k: 'position', l: 'Position', num: 1 }],
      fields: f };
  }
  function footerPage(title, slug) {
    return { kind: 'list', title: title, entity: 'Footer', newLabel: 'New Footer', store: 'footers.' + slug,
      cols: [{ k: 'name', l: 'Name' }], fields: [T('name', 'Name', { req: 1 }), CODE('content', 'Content (HTML)')] };
  }
  /* Control accounts are accounts in b.coa flagged control+custCtrl with a
     "made up of" label — the same shape the Control Accounts editor writes. */
  function controlPage(title, madeOf) {
    var low = madeOf.toLowerCase();
    return { kind: 'list', title: title, entity: 'Control Account', newLabel: 'New Control Account',
      store: subset('coa', function (n) { return n.type === 'account' && n.custCtrl && String(n.madeOf || '').toLowerCase() === low; },
        function (n) { return { id: n.id, type: 'account', name: n.name, code: n.code || '', parent: n.parent || 'assets',
          balance: n.balance || 0, control: 1, custCtrl: 1, madeOf: madeOf }; }),
      idPrefix: 'a',
      cols: [{ k: 'name', l: 'Name' }, { k: 'code', l: 'Code' }, { k: 'parent', l: 'Group', fmt: function (v, r, b) { var o = groupOpts(b).find(function (x) { return x[0] === v; }); return o ? o[1].trim() : v; } }],
      fields: [T('name', 'Name', { req: 1 }), T('code', 'Code', { ph: 'Optional' }), S('parent', 'Group', groupOpts, { def: 'assets' })],
      after: function (b) { try { refreshSummary(b); } catch (e) {} } };
  }
  function groupOpts(b) { return App.coaGroupOptions(b, 'bs', null).map(function (o) { return [o.value, '   '.repeat(o.depth) + o.label]; }); }
  function bankRulePage(title, entity, kind) {
    return { kind: 'list', title: title, entity: entity, newLabel: 'New ' + entity, advanced: true,
      intro: 'When a bank statement is imported, the first rule whose text appears in the line decides the account it is coded to. Rules are checked top to bottom.',
      store: subset('bankRules', function (r) { return !r.kind || r.kind === kind; }, function (r) { r.kind = kind; return r; }),
      cols: [{ k: 'bank', l: 'Bank account', fmt: function (v) { return v || 'Any'; } }, { k: 'match', l: 'Description contains' }, { k: 'payee', l: 'Payee' },
        { k: 'account', l: 'Account', fmt: function (v, r, b) { return acctLabel(b, v); } }],
      fields: [S('bank', 'If bank account is:', function (b) { return [['', 'Any bank or cash account']].concat(names(b, 'bankCash')); }),
        S('amountIs', '... and amount is', ['Any amount', 'Exactly', 'More than', 'Less than']),
        N('amount', 'Amount', { cls: 'w-sm', show: function (v) { return v.amountIs && v.amountIs !== 'Any amount'; } }),
        T('match', '... and description contains', { req: 1 }),
        FS('... then allocate to', [S('payeeType', 'Payee', ['Other', 'Customer', 'Supplier']), T('payee', '', { ph: 'Payee / customer / supplier' }),
          ACC('account', 'Account'), T('description', 'Description', { ph: 'Optional' }), S('taxCode', 'Tax code', taxOpts)])] };
  }
  function recurringPage(key) {
    var reg = REG[key] || {}, title = 'Recurring ' + (reg.label || key), entity = 'Recurring ' + (reg.singular || key);
    function docLabel(b, id) { var r = recs(b, key).find(function (x) { return String(x.id) === String(id); }); return r ? (r.reference || r.description || ('#' + r.id)) : ''; }
    return { kind: 'list', title: title, entity: entity, newLabel: 'New ' + entity,
      intro: 'Point a schedule at an existing document; Create now copies it with the next reference number and rolls the next issue date forward.',
      store: subset('recurring', function (r) { return r.key === key; }, function (r) { r.key = key; return r; }),
      cols: [{ k: 'next', l: 'Next issue date', fmt: fmtDate }, { k: 'every', l: 'Interval' }, { k: 'src', l: 'Copy of', fmt: function (v, r, b) { return docLabel(b, v); } }, { k: 'description', l: 'Description' }],
      fields: [D('next', 'Next issue date'), S('every', 'Interval', EVERY, { def: 'Monthly' }), D('end', 'End date', { def: '', hint: 'Optional' }),
        S('src', 'Copy of', function (b) { return [['', '— pick the document to copy —']].concat(recs(b, key).map(function (x) { return [String(x.id), x.reference || x.description || ('#' + x.id)]; })); }),
        T('description', 'Description')],
      editActions: function (rec) { return '<button class="btn" type="button" onclick="SettingsPages.recurRun(' + q(rec.id) + ')">Create now</button>'; } };
  }
  function sbPage(title, entity, store, fields, cols, after) {
    return { kind: 'list', title: title, entity: entity, newLabel: 'New Starting Balance', store: store, fields: fields, cols: cols,
      after: after || function (b) { try { refreshSummary(b); } catch (e) {} } };
  }
  function moneyCol(k, l) { return { k: k, l: l, num: 1, fmt: function (v) { return fmtNum(v); } }; }

  /* ---------- tax codes ---------- */
  function taxRateOf(t) {
    if (t.taxRate === 'Zero (0%)') return 0;
    if (t.taxRate === 'Pass-through (100%)') return 100;
    if (t.type === 'Multiple rates') return Math.round((t.components || []).reduce(function (s, c) { return s + num(c.rate); }, 0) * 1e6) / 1e6;
    return num(t.rate);
  }

  /* ---------- page definitions (keys are the settings tile keys) ---------- */
  var PAGES = {
    /* ---- block 1 ---- */
    business: { title: 'Business Details', kind: 'form',
      store: { get: function (b) { var d = b.details || {}; return { name: b.name, legalName: d.legalName, address: d.address, email: d.email, phone: d.phone, taxNumber: d.taxNumber, country: b.country, logo: d.logo }; },
        set: function (b, r) { b.name = String(r.name || '').trim() || b.name; if (r.country) b.country = r.country;
          b.details = Object.assign({}, b.details, { legalName: r.legalName || '', address: r.address || '', email: r.email || '', phone: r.phone || '', taxNumber: r.taxNumber || '', logo: r.logo || '' }); } },
      fields: [T('name', 'Name', { req: 1 }), T('legalName', 'Full / legal name', { ph: 'Optional' }), TA('address', 'Address'),
        T('email', 'Email', { ph: 'Optional' }), T('phone', 'Phone', { ph: 'Optional' }),
        T('taxNumber', 'Tax Registration Number (TRN)', { ph: 'Optional' }),
        S('country', 'Country', ['United Arab Emirates', 'United States', 'United Kingdom', 'Australia', 'Canada', 'India', 'Pakistan', 'Saudi Arabia', 'Singapore', 'New Zealand', 'Automatic']),
        IMG('logo', 'Logo')] },

    capitalSub: nameList('Capital subaccounts', 'capitalSubaccounts', 'Capital subaccount', 'New Subaccount',
      [{ name: 'Drawings' }, { name: 'Funds contributed' }, { name: 'Share of profit' }]),

    control: { title: 'Control Accounts', kind: 'menu', items: {
      'built-in': { title: 'Built-in control accounts & balances', kind: 'legacy', fn: 'set_control' },
      'bank-cash': controlPage('Bank and Cash Accounts', 'Bank and cash accounts'),
      'amortization': controlPage('Amortization Entries', 'Amortization entries'),
      'capital': controlPage('Capital Accounts', 'Capital accounts'),
      'customers': controlPage('Customers', 'Customers'),
      'depreciation': controlPage('Depreciation Entries', 'Depreciation entries'),
      'employees': controlPage('Employees', 'Employees'),
      'fixed-assets': controlPage('Fixed Assets', 'Fixed assets'),
      'intangible': controlPage('Intangible Assets', 'Intangible assets'),
      'inventory': controlPage('Inventory Items', 'Inventory items'),
      'special': controlPage('Special Accounts', 'Special accounts'),
      'suppliers': controlPage('Suppliers', 'Suppliers') } },

    extensions: { title: 'Custom Buttons', kind: 'list', entity: 'Custom Button', newLabel: 'New Custom Button', store: 'extensions',
      intro: 'A custom button opens a page you host (or inline HTML) that reads this business over postMessage. Nothing is fetched until a button is enabled.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'source', l: 'Source', fmt: function (v) { return v || 'Url'; } }, { k: 'placement', l: 'Placement', fmt: function (v) { return v ? '/' + v : ''; } },
        { k: 'enabled', l: 'Status', fmt: function (v) { return v ? 'Enabled' : 'Disabled'; } }],
      fields: [T('name', 'Name', { req: 1 }), S('source', 'Source', ['Url', 'Inline']),
        T('url', 'Endpoint', { ph: 'https://…', show: function (v) { return v.source !== 'Inline'; } }),
        CODE('content', 'Content', { show: function (v) { return v.source === 'Inline'; } }),
        T('placement', 'Placement', { prefix: '/', hint: 'e.g. sales-invoice-view' }), C('enabled', 'Enabled')] },

    customFields: { title: 'Custom Fields', kind: 'menu', items: {
      'text': customFieldPage('Text Custom Fields', 'text'), 'checkbox': customFieldPage('Checkbox Custom Fields', 'checkbox'),
      'date': customFieldPage('Date Custom Fields', 'date'), 'image': customFieldPage('Image Custom Fields', 'image'),
      'multiple': customFieldPage('Multiple Value Custom Fields', 'multi'), 'number': customFieldPage('Number Custom Fields', 'number'),
      'form-fields': { title: 'Fields added in the form designer', kind: 'legacy', fn: 'set_customFields' } } },

    /* Form Formatting / Voucher / Record Forms / Accounting Forms / Statement Formatting
       are hidden from the menu for now (App.openFmtCat still exists) */
    themes: { title: 'Custom Themes', kind: 'menu', items: {
      'html': { title: 'HTML Themes', kind: 'list', entity: 'Theme', newLabel: 'New Theme', store: 'customThemes',
        cols: [{ k: 'name', l: 'Name' }], fields: [T('name', 'Name', { req: 1 }), CODE('content', 'Content', { def: function () { return THEME_SKELETON; } })] } } },

    format: { title: 'Date & Number Format', kind: 'form', store: 'fmt',
      intro: 'This changes how every date and amount is shown across the business — registers, the Summary and printed documents.',
      fields: [S('date', 'Date format', [['MM/DD/YYYY', 'MM/DD/YYYY  (12/31/2026)'], ['DD/MM/YYYY', 'DD/MM/YYYY  (31/12/2026)'], ['YYYY-MM-DD', 'YYYY-MM-DD  (2026-12-31)'], ['D MMM YYYY', 'D MMM YYYY  (31 Dec 2026)']], { def: 'DD/MM/YYYY' }),
        S('time', 'Time format', ['9:40:07', '9:40:07 AM', '09:40:07', '09:40:07 AM'], { def: '09:40:07 AM' }),
        S('week', 'First day of week', ['Sunday', 'Monday', 'Saturday'], { def: 'Monday' }),
        S('sep', 'Number format', [['comma-dot', '123,456,789.00'], ['dot-comma', '123.456.789,00'], ['space-comma', '123 456 789,00'], ['none-dot', '123456789.00']], { def: 'comma-dot' }),
        S('decimals', 'Decimal places', [['0', '0'], ['2', '2'], ['3', '3']], { def: 2, asNum: 1 })] },

    email: { title: 'Email Settings', kind: 'menu', items: {
      'smtp': { title: 'SMTP server', kind: 'form', test: true,
        intro: 'A web page cannot open an SMTP connection itself: choose your mail client, or an HTTP relay you run that does the SMTP delivery with the details below.',
        store: { get: function (b) { var e = clone((b.details && b.details.email) || {}); e.reply = !!e.replyTo; e.bcc = !!e.bccTo; return e; },
          set: function (b, e) { if (!e.reply) e.replyTo = ''; if (!e.bcc) e.bccTo = ''; delete e.reply; delete e.bcc;
            b.details = Object.assign({}, b.details, { email: e }); } },
        fields: [S('mode', 'Delivery method', [['mailto', 'Mail client (mailto:)'], ['relay', 'HTTP relay endpoint']], { def: 'mailto' }),
          T('relayUrl', 'HTTP endpoint', { ph: 'https://mail.yourcompany.com/send', show: function (v) { return v.mode === 'relay'; } }),
          T('fromName', 'From name'), T('fromAddr', 'From email address', { ph: 'accounts@yourcompany.com' }),
          FS('SMTP server', [T('smtpHost', 'Hostname', { ph: 'smtp.example.com' }), S('smtpPort', 'Port', ['25', '465', '587'], { def: '587' }), S('encryption', 'Encryption', ['None', 'SSL', 'TLS'], { def: 'TLS' })]),
          FS('SMTP credentials', [T('smtpUser', 'Username'), PW('smtpPass', 'Password', { ph: '********', hint: 'Stored in this browser in plain text. Use an app-specific password.' })]),
          C('bcc', 'Send a copy of every email to this address', [T('bccTo', '', { ph: 'email@example.com' })]),
          C('reply', 'Receive email replies at a different address than you send from', [T('replyTo', '', { ph: 'email@example.com' })]),
          C('noTls', 'Do not verify TLS certificate')] },
      'templates': { title: 'Email Templates', kind: 'list', entity: 'Email Template', newLabel: 'New Email Template',
        intro: 'Placeholders such as {business}, {party}, {ref}, {document} and {amount} are filled in when an email is prepared.',
        store: { get: function (b) { var m = b.emailTemplates || {}; return Object.keys(m).map(function (t) { return { id: t, type: t, subject: m[t].subject, body: m[t].body }; }); },
          set: function (b, rows) { var m = {}; rows.forEach(function (r) { if (r.type) m[r.type] = { subject: r.subject || '', body: r.body || '' }; }); b.emailTemplates = m; } },
        cols: [{ k: 'type', l: 'Type', fmt: function (v) { var t = App._emTplTypes().find(function (x) { return x[0] === v; }); return t ? t[1] : v; } }, { k: 'subject', l: 'Subject' }],
        fields: [S('type', 'Type', function () { return App._emTplTypes(); }),
          T('subject', 'Subject', { def: function () { return App._emTplDefault('default').subject; } }),
          TA('body', 'Body', { def: function () { return App._emTplDefault('default').body; } })] } } },

    footers: { title: 'Footers', kind: 'menu', items: (function () {
      var it = { 'default': { title: 'Default footer (all documents)', kind: 'form',
        store: { get: function (b) { return { footer: (b.details || {}).footer || '' }; }, set: function (b, r) { b.details = Object.assign({}, b.details, { footer: r.footer || '' }); } },
        fields: [TA('footer', 'Footer text', { ph: 'e.g. Thank you for your business.', hint: 'Prints at the bottom of every voucher and invoice, below the totals.' })] } };
      ['Sales Invoices', 'Sales Quotes', 'Credit Notes', 'Debit Notes', 'Delivery Notes', 'Goods Receipts', 'Inter Account Transfers', 'Journal Entries', 'Payments', 'Payslips', 'Purchase Invoices', 'Purchase Orders', 'Purchase Quotes', 'Receipts', 'Sales Orders']
        .forEach(function (t) { var s = t.toLowerCase().replace(/ /g, '-'); it[s] = footerPage(t, s); });
      return it; })() },

    locations: { title: 'Inventory Locations', kind: 'menu', items: {
      'custom': { title: 'Custom Inventory Locations', kind: 'list', entity: 'Custom Inventory Location', newLabel: 'New Custom Inventory Location', store: 'locations',
        intro: 'Locations let you hold the same item in more than one place. Inventory Transfers move quantity between them; the ledger value is unaffected.',
        cols: [{ k: 'name', l: 'Name' }, { k: 'code', l: 'Code' }], fields: [T('name', 'Name', { req: 1 }), T('code', 'Code', { ph: 'Optional' })] },
      'default': { title: 'Default Inventory Location', kind: 'form', store: 'defaultLocation', fields: [T('name', 'Name', { def: 'Default location' })] } } },

    obsolete: { title: 'Obsolete Features', kind: 'menu', items: {
      'features': { title: 'Older behaviour', kind: 'form', store: 'obsolete',
        intro: 'Features kept for businesses that already rely on them. They stay hidden unless you switch one on here.',
        fields: App._obsoleteList().map(function (o) { return C(o[0], o[1], null, { hint: o[2] }); }) },
      'classic-custom-fields': { title: 'Classic Custom Fields', kind: 'list', entity: 'Custom Field', newLabel: 'New Custom Field', store: 'classicCustomFields',
        cols: [{ k: 'name', l: 'Name' }, { k: 'placement', l: 'Placement' }], fields: [T('name', 'Name', { req: 1 }), S('placement', 'Placement', DOC_TYPES), TA('description', 'Description')] },
      'script-extensions': { title: 'ScriptExtensions', kind: 'list', entity: 'ScriptExtension', newLabel: 'New ScriptExtension', store: 'scriptExtensions',
        cols: [{ k: 'name', l: 'Name' }, { k: 'placement', l: 'Placement' }], fields: [T('name', 'Name', { req: 1 }), T('placement', 'Placement'), CODE('script', 'Script')] } } },

    payslipItems: { title: 'Payslip Items', kind: 'menu', items: {
      'deductions': { title: 'Payslip Deduction Items', kind: 'list', entity: 'Payslip Deduction Item', newLabel: 'New Payslip Item', store: 'payslipItems.deductions',
        cols: [{ k: 'name', l: 'Name' }, { k: 'account', l: 'Account', fmt: function (v, r, b) { return acctLabel(b, v); } }],
        fields: [T('name', 'Name', { req: 1 }), ACC('account', 'Account'), T('category', 'Reporting Category')] },
      'earnings': { title: 'Payslip Earnings Items', kind: 'list', entity: 'Payslip Earnings Item', newLabel: 'New Payslip Item', store: 'payslipItems.earnings',
        cols: [{ k: 'name', l: 'Name' }, { k: 'account', l: 'Expense account', fmt: function (v, r, b) { return acctLabel(b, v); } }],
        fields: [T('name', 'Name', { req: 1 }), ACC('account', 'Expense account'), T('category', 'Reporting Category')],
        seed: [{ name: 'Basic salary' }, { name: 'Housing allowance' }, { name: 'Transport allowance' }, { name: 'Overtime' }] },
      'contributions': { title: 'Payslip Contribution Items', kind: 'list', entity: 'Payslip Contribution Item', newLabel: 'New Payslip Item', store: 'payslipItems.contributions',
        cols: [{ k: 'name', l: 'Name' }, { k: 'expense', l: 'Expense account', fmt: function (v, r, b) { return acctLabel(b, v); } }, { k: 'liability', l: 'Liability account', fmt: function (v, r, b) { return acctLabel(b, v); } }],
        fields: [T('name', 'Name', { req: 1 }), ACC('expense', 'Expense account'), ACC('liability', 'Liability account'), T('category', 'Reporting Category')] } } },

    /* b.taxCodes keeps {name, rate} — `rate` is always the effective percentage
       the invoice lines and accounting.js multiply by; the rest is extra. */
    tax: { title: 'Tax Codes', kind: 'list', entity: 'Tax Code', newLabel: 'New Tax Code', advanced: true, store: 'taxCodes',
      intro: 'Tax codes appear in the Tax dropdown on invoice lines and drive the tax calculation.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'label', l: 'Label' }, { k: 'rate', l: 'Rate', num: 1, fmt: function (v, r) { return taxRateOf(load_tax(clone(r))) + '%'; } },
        { k: 'account', l: 'Account', fmt: function (v, r, b) { return acctLabel(b, v); } }],
      load: load_tax,
      fields: [T('name', 'Name', { req: 1 }), T('label', 'Label', { ph: 'Optional' }),
        S('taxRate', 'Tax rate', ['Zero (0%)', 'Pass-through (100%)', 'Custom %'], { def: 'Custom %' }),
        S('type', 'Type', ['Single rate', 'Multiple rates'], { show: function (v) { return v.taxRate === 'Custom %'; } }),
        N('rate', 'Rate', { suffix: '%', ph: '0', show: function (v) { return v.taxRate === 'Custom %' && v.type !== 'Multiple rates'; } }),
        LINES('components', 'Components', [{ k: 'name', l: 'Name' }, { k: 'rate', l: 'Rate %', t: 'number', sum: 1 }, { k: 'account', l: 'Account', t: 'select', opts: accountOpts }],
          { show: function (v) { return v.taxRate === 'Custom %' && v.type === 'Multiple rates'; } }),
        ACC('account', 'Account', { show: function (v) { return v.taxRate === 'Custom %' && v.type !== 'Multiple rates'; }, hint: 'Leave blank to post to the Output / Input VAT control accounts.' }),
        C('reverse', 'Reverse charged', null, { show: function (v) { return v.taxRate === 'Custom %'; } }),
        C('customSiTitle', 'Custom sales invoice title', [T('siTitle', '', { ph: 'Tax Invoice' })]),
        C('customCnTitle', 'Custom credit note title', [T('cnTitle', '', { ph: 'Tax Credit Note' })])],
      beforeSave: function (r) { r.rate = taxRateOf(r); if (r.type !== 'Multiple rates') delete r.components; } },

    /* ---- block 2 ---- */
    accessTokens: { title: 'Access Tokens', kind: 'list', entity: 'Access Token', newLabel: 'New Access Token', advanced: true, store: 'accessTokens',
      intro: 'Tokens identify other programs that read this business. They are stored with the business; treat them like passwords.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'created', l: 'Created', fmt: fmtDate }],
      fields: [T('name', 'Name', { req: 1 }), { t: 'token' }],
      onCreate: function (r) { r.token = makeToken(); r.created = today(); } },

    bankRules: { title: 'Bank Rules', kind: 'menu', items: {
      'payment-rules': bankRulePage('Payment Rules', 'Payment Rule', 'payment'),
      'receipt-rules': bankRulePage('Receipt Rules', 'Receipt Rule', 'receipt') } },

    billableExpenses: { title: 'Billable Expenses', kind: 'form', store: 'billableExpenses',
      fields: [C('enabled', 'Enabled', null, { hint: 'Lets expense lines on payments and purchase invoices be marked as billable to a customer.' })] },

    cashFlowGroups: { title: 'Cash Flow Statement Groups', kind: 'menu', items: {
      'financing': nameList('Financing activities', 'cashFlowGroups.financing', 'Financing activities group', 'New Group'),
      'investing': nameList('Investing activities', 'cashFlowGroups.investing', 'Investing activities group', 'New Group'),
      'operating': nameList('Operating activities', 'cashFlowGroups.operating', 'Operating activities group', 'New Group') } },

    currencies: { title: 'Currencies', kind: 'menu', items: {
      'base': { title: 'Base Currency', kind: 'form',
        intro: 'The base currency is the currency your accounts and reports are presented in.',
        store: { get: function (b) { return Object.assign({ code: b.baseCurrency || 'AED' }, b.baseCurrencyInfo || {}); },
          set: function (b, r) { b.baseCurrency = String(r.code || '').toUpperCase().trim() || b.baseCurrency;
            b.baseCurrencyInfo = { name: r.name || '', prefix: r.prefix || '', suffix: r.suffix || '', decimals: r.decimals }; } },
        fields: [S('code', 'Code', function (b) { var l = ALL_CUR.slice(); if (b.baseCurrency && l.indexOf(b.baseCurrency) < 0) l.unshift(b.baseCurrency); return l; }),
          T('name', 'Name', { ph: 'e.g. UAE Dirham' }), T('prefix', 'Prefix'), T('suffix', 'Suffix'), N('decimals', 'Decimal places', { ph: '2', def: 2, cls: 'w-sm' })] },
      'exchange-rates': { title: 'Exchange Rates', kind: 'list', entity: 'Exchange Rate', newLabel: 'New Exchange Rate', store: 'exchangeRates',
        intro: 'Units of the foreign currency equal to one unit of the base currency. The latest rate on or before a transaction’s date is used.',
        cols: [{ k: 'date', l: 'Date', fmt: fmtDate }, { k: 'code', l: 'Currency' }, { k: 'rate', l: 'Exchange rate', num: 1, fmt: function (v) { return num(v).toFixed(6); } }],
        fields: [D('date', 'Date'), S('code', 'Currency', curOpts, { req: 1 }), N('rate', 'Exchange rate', { ph: '1.000000' })] },
      'foreign': { title: 'Foreign Currencies', kind: 'list', entity: 'Foreign Currency', newLabel: 'New Foreign Currency', store: 'currencies',
        cols: [{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }],
        fields: [T('code', 'Code', { req: 1, ph: 'USD' }), T('name', 'Name'), T('prefix', 'Prefix'), T('suffix', 'Suffix'), N('decimals', 'Decimal places', { ph: '2', cls: 'w-sm' })],
        beforeSave: function (r) { r.code = String(r.code || '').toUpperCase().trim(); } } } },

    customerPortals: { title: 'Customer Portals', kind: 'list', entity: 'Customer Portal', newLabel: 'New Customer Portal', store: 'customerPortals',
      cols: [{ k: 'customer', l: 'Customer' }, { k: 'docs', l: 'Access', fmt: function (v) { return (v || []).join(', '); } }],
      fields: [S('customer', 'Customer', recOpts('customers'), { req: 1 }), CHECKS('docs', 'Access', ['Sales Quotes', 'Sales Orders', 'Sales Invoices', 'Credit Notes', 'Delivery Notes'], { flat: 1 })] },

    divisions: { title: 'Divisions', kind: 'list', entity: 'Division', newLabel: 'New Division', advanced: true, store: 'divisions', idPrefix: 'd',
      intro: 'Divisions let you track results by department, branch or project. Tag transactions with a division on the entry form.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'code', l: 'Code' }], fields: [T('name', 'Name', { req: 1 }), T('code', 'Code', { ph: 'Optional' })] },

    forecasts: { title: 'Forecasts', kind: 'list', entity: 'Forecast', newLabel: 'New Forecast', store: 'forecasts',
      cols: [{ k: 'date', l: 'Date', fmt: fmtDate }, { k: 'description', l: 'Description' }, { k: 'repeat', l: 'Repeat' },
        { k: 'lines', l: 'Amount', num: 1, fmt: function (v) { return fmtNum((v || []).reduce(function (s, r) { return s + num(r.amount); }, 0)); } }],
      fields: [D('date', 'Date'), S('repeat', 'Repeat', REPEAT), T('description', 'Description'),
        LINES('lines', '', [{ k: 'account', l: 'Account', t: 'select', opts: accountOpts }, { k: 'amount', l: 'Amount', t: 'number', sum: 1 }])] },

    kits: { title: 'Inventory Kits', kind: 'list', entity: 'Inventory Kit', newLabel: 'New Inventory Kit', advanced: true, store: 'inventoryKits', idPrefix: 'k',
      intro: 'A kit is sold as one line but drawn from stock as its components. Selling a kit reduces each component by its quantity.',
      cols: [{ k: 'code', l: 'Item code' }, { k: 'name', l: 'Item name' }, { k: 'unit', l: 'Unit name' },
        { k: 'salesPrice', l: 'Unit price', num: 1, fmt: function (v) { return v === '' || v == null ? '' : fmtNum(v); } },
        { k: 'items', l: 'Component cost', num: 1, fmt: function (v, r, b) { return fmtNum(App.kitCost(b, r)); } }],
      load: function (r) { if (r.afPrice == null) r.afPrice = r.salesPrice !== '' && r.salesPrice != null; return r; },
      fields: [T('code', 'Item code', { ph: 'Optional' }), T('name', 'Item name', { req: 1 }), T('unit', 'Unit Name', { ph: 'Optional' }),
        LINES('items', 'Components', [{ k: 'item', l: 'Inventory Item', t: 'select', opts: recOpts('inventory') }, { k: 'qty', l: 'Qty', t: 'number' }]),
        C('afDesc', 'Autofill — Line description', [TA('lineDesc', '')]), C('afPrice', 'Autofill — Unit price', [N('salesPrice', '', { ph: '0' })]),
        C('afDiv', 'Autofill — Sales — Division', [S('division', '', divOpts)]), C('afTax', 'Autofill — Tax Code', [S('taxCode', '', taxOpts)]),
        C('customIncome', 'Custom income account', [ACC('incomeAccount', '')]), C('hideName', 'Hide item name on printed documents'), IMG()],
      beforeSave: function (r) { if (!r.afPrice) r.salesPrice = ''; } },

    unitCosts: { title: 'Inventory Unit Costs', kind: 'list', entity: 'Inventory Unit Cost', newLabel: 'New Inventory Unit Cost', advanced: true, store: 'inventoryUnitCosts',
      cols: [{ k: 'date', l: 'Date', fmt: fmtDate }, { k: 'item', l: 'Inventory Item' }, moneyCol('cost', 'Unit cost')],
      fields: [D('date', 'Date'), S('item', 'Inventory Item', recOpts('inventory'), { req: 1 }), N('cost', 'Unit cost', { ph: '0' })] },

    marketPrices: { title: 'Investment Market Prices', kind: 'list', entity: 'Investment Market Price', newLabel: 'New Investment Market Price', advanced: true, store: 'investmentPrices',
      cols: [{ k: 'date', l: 'Date', fmt: fmtDate }, { k: 'investment', l: 'Investment' }, moneyCol('price', 'Market price')],
      fields: [D('date', 'Date'), S('investment', 'Investment', recOpts('investments'), { req: 1 }), N('price', 'Market price', { ph: '0', show: function (v) { return !!v.investment; } })] },

    /* b.keyboardNav is read by the voucher forms (PR3): keep these keys. */
    keyboardNav: { title: 'Keyboard Navigation', kind: 'form', store: 'keyboardNav',
      fields: [C('enter', 'Enter moves to the next field (like Tally)', null, { def: true }),
        C('arrows', 'Left / Right arrow at the start or end of a field moves to the previous / next field (press twice)', null, { def: true }),
        C('lastToSave', 'Enter on the last field moves to the Create / Update button', null, { def: false }),
        C('autoLine', 'Enter on the last field of the last line adds a new line', null, { def: true }),
        C('newLine', 'Shift + Enter makes a new line in multi-line boxes', null, { def: true })] },

    lock: { title: 'Lock Date', kind: 'form',
      store: { get: function (b) { return { lock: !!b.lockDate, lockDate: b.lockDate || '' }; },
        set: function (b, r) { b.lockDate = (r.lock && r.lockDate) ? r.lockDate : ''; } },
      fields: [C('lock', 'Lock accounting periods', [D('lockDate', 'Lock date', { def: '', hint: 'Transactions dated on or before this date can’t be created or edited.' })])] },

    /* Non-inventory items are the same records the Non-inventory Items tab lists. */
    nonInvItems: { title: 'Non-inventory Items', kind: 'list', entity: 'Non-inventory Item', newLabel: 'New Non-inventory Item', advanced: true,
      store: 'records.nonInvItems', numId: 1,
      cols: [{ k: 'code', l: 'Code' }, { k: 'name', l: 'Name' }, { k: 'unit', l: 'Unit name' },
        { k: 'salesAccount', l: 'When sold', fmt: function (v, r, b) { return acctLabel(b, v); } }, { k: 'purchaseAccount', l: 'When purchased', fmt: function (v, r, b) { return acctLabel(b, v); } }],
      load: function (r) { if (r.afSalePrice == null) r.afSalePrice = r.salesPrice !== '' && r.salesPrice != null;
        if (r.afBuyPrice == null) r.afBuyPrice = r.purchasePrice !== '' && r.purchasePrice != null;
        if (r.afTax == null) r.afTax = !!r.taxCode; return r; },
      fields: [T('code', 'Code', { ph: 'Optional' }), T('name', 'Name', { req: 1 }), T('unit', 'Unit Name', { ph: 'Optional' }),
        FS('When sold', [ACC('salesAccount', 'Account')]), FS('When purchased', [ACC('purchaseAccount', 'Account')]),
        C('afDesc', 'Autofill — Line description', [TA('lineDesc', '')]), C('afSalePrice', 'Autofill — Sales — Unit price', [N('salesPrice', '', { ph: '0' })]),
        C('afBuyPrice', 'Autofill — Purchases — Unit price', [N('purchasePrice', '', { ph: '0' })]), C('afTax', 'Autofill — Tax Code', [S('taxCode', '', taxOpts)]),
        C('afDiv', 'Autofill — Division', [S('division', '', divOpts)]), C('hideName', 'Hide item name on printed documents'), IMG()],
      validate: function (r, b, id) { var n = String(r.name || '').trim().toLowerCase();
        if (recs(b, 'nonInvItems').some(function (x) { return String(x.id) !== String(id) && String(x.name || '').trim().toLowerCase() === n; })) return 'A non-inventory item with this name already exists.'; },
      beforeSave: function (r) { if (!r.afSalePrice) r.salesPrice = ''; if (!r.afBuyPrice) r.purchasePrice = ''; if (!r.afTax) r.taxCode = ''; if (!r.uuid) r.uuid = App.uuid(); } },

    recurring: { title: 'Recurring Transactions', kind: 'menu', items: (function () {
      var it = {};
      ['iat', 'journal', 'payments', 'payslips', 'purchInv', 'purchOrders', 'receipts', 'salesInv', 'salesOrders', 'salesQuotes', 'expenseClaims']
        .filter(function (k) { return REG[k]; }).forEach(function (k) { it[k] = recurringPage(k); });
      return it; })() },

    starting: { title: 'Starting Balances', kind: 'menu', items: {
      'balance-sheet': sbPage('Balance Sheet Accounts', 'Starting Balance',
        { get: function (b) { return (b.coa || []).filter(function (n) { return n.type === 'account' && !n.control && num(n.balance) !== 0; })
            .map(function (n) { return { id: 'c' + n.id, account: n.id, amount: n.balance }; }); },
          set: function (b, rows) { (b.coa || []).filter(function (n) { return n.type === 'account' && !n.control; }).forEach(function (n) {
            var r = rows.filter(function (x) { return String(x.account) === String(n.id); }).pop(); n.balance = r ? (App.parseNum(r.amount) || 0) : 0; }); } },
        [S('account', 'Account', function (b) { return [['', '— account —']].concat((b.coa || []).filter(function (n) { return n.type === 'account' && !n.control; }).map(function (n) { return [n.id, acctLabel(b, n.id)]; })); }, { req: 1 }),
          N('amount', 'Amount', { hint: 'Debit positive, credit negative' })],
        [{ k: 'account', l: 'Account', fmt: function (v, r, b) { return acctLabel(b, v); } }, moneyCol('amount', 'Amount')]),
      'bank': sbPage('Bank and Cash Accounts', 'Starting Balance', recordFigures('bankCash', 'account', { amount: 'balance' }),
        [S('account', 'Bank or cash account', recOpts('bankCash'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'account', l: 'Bank or cash account' }, moneyCol('amount', 'Amount')]),
      'customers': sbPage('Customers', 'Starting Balance', recordFigures('customers', 'party', { amount: 'balance' }),
        [S('party', 'Customer', recOpts('customers'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'party', l: 'Customer' }, moneyCol('amount', 'Amount')]),
      'suppliers': sbPage('Suppliers', 'Starting Balance', recordFigures('suppliers', 'party', { amount: 'balance' }),
        [S('party', 'Supplier', recOpts('suppliers'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'party', l: 'Supplier' }, moneyCol('amount', 'Amount')]),
      'capital': sbPage('Capital Accounts', 'Starting Balance', recordFigures('capital', 'account', { amount: 'balance' }),
        [S('account', 'Capital account', recOpts('capital'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'account', l: 'Capital account' }, moneyCol('amount', 'Amount')]),
      'special': sbPage('Special Accounts', 'Starting Balance', recordFigures('special', 'account', { amount: 'balance' }),
        [S('account', 'Special account', recOpts('special'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'account', l: 'Special account' }, moneyCol('amount', 'Amount')]),
      'employees': sbPage('Employees', 'Starting Balance', 'startingBalances.employees',
        [S('employee', 'Employee', recOpts('employees'), { req: 1 }), N('amount', 'Amount')],
        [{ k: 'employee', l: 'Employee' }, moneyCol('amount', 'Amount')], function () {}),
      'exchange-rates': sbPage('Exchange Rates', 'Starting Exchange Rate', 'startingBalances.exchangeRates',
        [S('currency', 'Currency', curOpts, { req: 1 }), N('rate', 'Exchange rate')],
        [{ k: 'currency', l: 'Currency' }, { k: 'rate', l: 'Exchange rate', num: 1 }], function () {}),
      'fixed-assets': sbPage('Fixed Assets', 'Starting Balance', recordFigures('fixedAssets', 'asset', { cost: 'cost', dep: 'accumDep' }),
        [S('asset', 'Fixed asset', recOpts('fixedAssets'), { req: 1 }), N('cost', 'Purchase cost'), N('dep', 'Accumulated depreciation')],
        [{ k: 'asset', l: 'Fixed asset' }, moneyCol('cost', 'Purchase cost'), moneyCol('dep', 'Accumulated depreciation')]),
      'intangible-assets': sbPage('Intangible Assets', 'Starting Balance', recordFigures('intangibles', 'asset', { cost: 'cost', amort: 'accumAmort' }),
        [S('asset', 'Intangible asset', recOpts('intangibles'), { req: 1 }), N('cost', 'Purchase cost'), N('amort', 'Accumulated amortization')],
        [{ k: 'asset', l: 'Intangible asset' }, moneyCol('cost', 'Purchase cost'), moneyCol('amort', 'Accumulated amortization')]),
      'inventory': sbPage('Inventory Items', 'Starting Balance', recordFigures('inventory', 'item', { qty: 'qty', cost: 'openingCost' }),
        [S('item', 'Inventory item', recOpts('inventory'), { req: 1 }), N('qty', 'Qty on hand'), N('cost', 'Total cost')],
        [{ k: 'item', l: 'Inventory item' }, { k: 'qty', l: 'Qty', num: 1 }, moneyCol('cost', 'Total cost')]),
      'purchase-invoices': sbPage('Purchase Invoices', 'Purchase Invoice', 'startingBalances.purchaseInvoices',
        [D('date', 'Issue date'), T('ref', 'Reference'), S('party', 'Supplier', recOpts('suppliers'), { req: 1 }), D('due', 'Due date', { def: '' }), T('description', 'Description'), N('amount', 'Amount')],
        [{ k: 'date', l: 'Issue date', fmt: fmtDate }, { k: 'ref', l: 'Reference' }, { k: 'party', l: 'Supplier' }, moneyCol('amount', 'Invoice amount')], function () {}),
      'sales-invoices': sbPage('Sales Invoices', 'Sales Invoice', 'startingBalances.salesInvoices',
        [D('date', 'Issue date'), T('ref', 'Reference'), S('party', 'Customer', recOpts('customers'), { req: 1 }), D('due', 'Due date', { def: '' }), T('description', 'Description'), N('amount', 'Amount')],
        [{ k: 'date', l: 'Issue date', fmt: fmtDate }, { k: 'ref', l: 'Reference' }, { k: 'party', l: 'Customer' }, moneyCol('amount', 'Invoice amount')], function () {}) } },

    webServices: { title: 'Web Services', kind: 'menu', items: {
      'exchange-rates': { title: 'Exchange Rates', kind: 'form', store: 'webServices.exchangeRates',
        fields: [C('enabled', 'Retrieve exchange rates automatically from web service', [S('provider', 'Provider', ['European Central Bank', 'Open Exchange Rates', 'Central Bank of the UAE'])])] } } },

    withholdingTax: { title: 'Withholding tax', kind: 'form', store: 'withholdingTax',
      fields: [C('receivable', 'Withholding tax receivable'), C('payable', 'Withholding tax payable')] },

    /* ---- pages this app had before the redesign, kept on the new framework ---- */
    claimPayers: { title: 'Expense Claim Payers', kind: 'list', entity: 'Expense Claim Payer', newLabel: 'New Expense Claim Payer', store: 'claimPayers',
      intro: 'Anyone who pays business expenses out of their own pocket and is neither an employee nor a capital account.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'code', l: 'Code' }], fields: [T('name', 'Name', { req: 1 }), T('code', 'Code', { ph: 'Optional' })] },

    projects: { title: 'Projects', kind: 'list', entity: 'Project', newLabel: 'New Project', store: 'projects',
      intro: 'Projects group transactions the way Divisions do, but for work with a start and an end.',
      cols: [{ k: 'name', l: 'Name' }, { k: 'code', l: 'Code' }, { k: 'status', l: 'Status' }],
      fields: [T('name', 'Name', { req: 1 }), T('code', 'Code', { ph: 'Optional' }), S('status', 'Status', ['Active', 'On hold', 'Complete'])] },

    lateFees: { title: 'Late Payment Fees', kind: 'form', store: 'lateFees',
      intro: 'Charges added to a sales invoice once it is overdue. Turn it on here, then tick Late payment fees on the invoices it should apply to.',
      fields: [C('enabled', 'Charge late payment fees', [N('rate', 'Rate', { suffix: '%', def: 1.5 }),
        S('period', 'Charged', [['month', 'per month'], ['year', 'per year'], ['once', 'once']], { def: 'month' }),
        N('grace', 'Grace period', { suffix: 'days', def: 0 }), ACC('account', 'Income account for fees charged')])] },

    formDefaults: { title: 'Form Defaults', kind: 'menu', items: (function () {
      var it = {};
      App._formDefaultKeys().filter(function (k) { return REG[k]; }).forEach(function (k) {
        it[k] = { title: (REG[k].singular || REG[k].label) + ' — Form Defaults', kind: 'form', store: 'formDefaults.' + k,
          intro: 'Values a new document opens with. Anything left blank is not pre-filled.',
          fields: [T('description', 'Default description'), N('dueDays', 'Due in (days)', { cls: 'w-sm', ph: 'Net' }), S('taxCode', 'Tax code', taxOpts), S('division', 'Division', divOpts)] }; });
      return it; })() },
  };

  function load_tax(r) {
    if (!r.taxRate) r.taxRate = num(r.rate) > 0 ? 'Custom %' : 'Zero (0%)';
    if (!r.type) r.type = 'Single rate';
    return r;
  }
  function makeToken() {
    var s = '';
    try { var a = new Uint8Array(24); (window.crypto || globalThis.crypto).getRandomValues(a); for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2); }
    catch (e) { for (var j = 0; j < 48; j++) s += Math.floor(Math.random() * 16).toString(16); }
    return 'mgr_' + s;
  }
  var THEME_SKELETON = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<style>\n  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; }\n  main { padding: 30px; }\n  table { width: 100%; border-collapse: collapse; }\n  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }\n</style>\n</head>\n<body>\n<main id="doc"></main>\n</body>\n</html>';

  /* ---------- routing ---------- */
  function routeFor(key) { var r = App.spRoute; return (r && r.key === key) ? r : { key: key, sub: '', action: null, id: null }; }
  function resolve(key, sub) {
    var def = PAGES[key]; if (!def) return null;
    var crumbs = [{ t: def.title, sub: '' }], parts = String(sub || '').split('/').filter(Boolean), acc = [];
    for (var i = 0; i < parts.length; i++) {
      if (def.kind !== 'menu' || !def.items[parts[i]]) break;
      def = def.items[parts[i]]; acc.push(parts[i]); crumbs.push({ t: def.title, sub: acc.join('/') });
    }
    return { def: def, crumbs: crumbs, sub: acc.join('/') };
  }
  function splitPath(path) { var p = String(path).split('/'); return { key: p[0], sub: p.slice(1).join('/') }; }
  function defAt(path) { var s = splitPath(path), r = resolve(s.key, s.sub); return r ? r.def : null; }
  function go(key, sub, action, id) {
    App.setView = key; App.spRoute = { key: key, sub: sub || '', action: action || null, id: id == null ? null : String(id) };
    var b = App.curBiz(); if (b) App.renderMain(b);
    try { var m = document.getElementById('wsMain'); if (m && m.scrollTo) m.scrollTo(0, 0); } catch (e) {}
  }

  /* ---------- data access ---------- */
  var DIRTY = false;
  function ensureIds(arr, def) {
    (arr || []).forEach(function (r) { if (r && typeof r === 'object' && (r.id == null || r.id === '')) { r.id = newId(def); DIRTY = true; } });
    return arr;
  }
  function newId(def) { if (def && def.numId) return Date.now() + Math.floor(Math.random() * 100000); return (def && def.idPrefix ? def.idPrefix : '') + uid(); }
  function listGet(b, def) {
    if (def.store && typeof def.store === 'object') return def.store.get(b) || [];
    var arr = pathGet(b, def.store);
    if (arr == null) { arr = clone(def.seed || []); if (def.seed) { pathSet(b, def.store, arr); DIRTY = true; } }
    return ensureIds(arr, def);
  }
  function listSet(b, def, rows) { if (def.store && typeof def.store === 'object') def.store.set(b, rows); else pathSet(b, def.store, rows); }
  function formGet(b, def) { var v = (def.store && typeof def.store === 'object') ? def.store.get(b) : pathGet(b, def.store); return clone(v || {}); }
  function formSet(b, def, rec) { if (def.store && typeof def.store === 'object') def.store.set(b, rec); else pathSet(b, def.store, rec); }
  function flush(b) { if (DIRTY && b) { DIRTY = false; App.saveBiz(b); } }

  /* defaults: every field (and revealed sub-field) the record has no value for */
  function walk(fields, fn) { (fields || []).forEach(function (f) { if (f.t === 'fieldset') walk(f.fields, fn); else { fn(f); if (f.reveal) walk(f.reveal, fn); } }); }
  function optsOf(f, b) { var o = typeof f.opts === 'function' ? f.opts(b) : (f.opts || []); return o.map(function (x) { return Array.isArray(x) ? [String(x[0]), String(x[1])] : [String(x), String(x)]; }); }
  function withDefaults(fields, rec, b) {
    walk(fields, function (f) {
      if (!f.k || rec[f.k] !== undefined) return;
      if (f.def !== undefined) { rec[f.k] = typeof f.def === 'function' ? f.def(b) : f.def; return; }
      if (f.t === 'select') { var o = optsOf(f, b); rec[f.k] = o.length ? (f.asNum ? App.parseNum(o[0][0]) : o[0][0]) : ''; }
    });
    return rec;
  }
  function loadRec(def, rec, b) { rec = clone(rec || {}); if (def.load) rec = def.load(rec, b) || rec; return withDefaults(def.fields, rec, b); }

  /* ---------- the DOM-free API (used by the screens and by the tests) ---------- */
  function rowsAt(path, b) { b = b || App.curBiz(); var def = defAt(path); if (!def || def.kind !== 'list') return []; var r = listGet(b, def); flush(b); return r; }
  function validate(def, v, b, id) {
    var err = null;
    walk(def.fields, function (f) { if (!err && f.req && (v[f.k] === '' || v[f.k] == null || (Array.isArray(v[f.k]) && !v[f.k].length))) err = (f.l || f.k) + ' is required.'; });
    if (!err && def.validate) err = def.validate(v, b, id) || null;
    return err;
  }
  function saveRecord(path, v, id) {
    var b = App.curBiz(); var def = defAt(path); if (!b || !def) return { ok: false, error: 'Nothing to save.' };
    if (def.kind === 'form') {
      var err0 = validate(def, v, b, null); if (err0) return { ok: false, error: err0 };
      var cur = formGet(b, def), rec0 = Object.assign({}, cur, v);
      if (def.beforeSave) def.beforeSave(rec0, b);
      formSet(b, def, rec0); if (def.after) def.after(b); App.saveBiz(b);
      return { ok: true, record: rec0 };
    }
    var err = validate(def, v, b, id); if (err) return { ok: false, error: err };
    var rows = listGet(b, def), rec;
    if (id != null && id !== '') {
      var i = rows.findIndex(function (x) { return String(x.id) === String(id); });
      if (i < 0) return { ok: false, error: 'That record no longer exists.' };
      rec = Object.assign({}, rows[i], v); if (def.beforeSave) def.beforeSave(rec, b); rows[i] = rec;
    } else {
      rec = Object.assign({ id: newId(def) }, v); if (def.onCreate) def.onCreate(rec, b); if (def.beforeSave) def.beforeSave(rec, b); rows.push(rec);
    }
    listSet(b, def, rows); if (def.after) def.after(b); DIRTY = false; App.saveBiz(b);
    return { ok: true, record: rec };
  }
  function deleteRecord(path, id) {
    var b = App.curBiz(); var def = defAt(path); if (!b || !def || def.kind !== 'list') return false;
    var rows = listGet(b, def), n = rows.length; rows = rows.filter(function (x) { return String(x.id) !== String(id); });
    if (rows.length === n) return false;
    listSet(b, def, rows); if (def.after) def.after(b); DIRTY = false; App.saveBiz(b); return true;
  }
  function formAt(path, b) { b = b || App.curBiz(); var def = defAt(path); return def && def.kind === 'form' ? loadRec(def, formGet(b, def), b) : null; }

  /* ---------- field rendering ---------- */
  var CONDS = [];
  function selHtml(attrs, opts, val) {
    var v = val == null ? '' : String(val), has = opts.some(function (o) { return o[0] === v; });
    if (!has && v !== '') opts = opts.concat([[v, v]]);
    return '<select ' + attrs + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function condAttr(fn, rec) { CONDS.push(fn); var on = false; try { on = !!fn(rec); } catch (e) {} return ' data-cond="' + (CONDS.length - 1) + '"' + (on ? '' : ' style="display:none"'); }
  function wrap(f, inner, rec, raw) { var c = f.show ? condAttr(f.show, rec) : ''; return raw && !c ? inner : '<div class="sp-f"' + c + '>' + inner + '</div>'; }
  function fieldHTML(f, rec, b) {
    var v = rec[f.k];
    var lbl = f.l ? '<label class="sp-l">' + esc(f.l) + (f.req ? ' <span class="sp-req">*</span>' : '') + '</label>' : '';
    var hint = f.hint ? '<div class="sp-hint">' + esc(f.hint) + '</div>' : '';
    var inner = '';
    switch (f.t) {
      case 'fieldset':
        return wrap(f, '<fieldset class="sp-fs"><legend>' + esc(f.l) + '</legend>' + f.fields.map(function (x) { return fieldHTML(x, rec, b); }).join('') + '</fieldset>', rec, true);
      case 'text': case 'number': case 'date': case 'password': {
        var type = f.t === 'number' ? 'text' : f.t;
        var inp = '<input type="' + type + '" data-k="' + f.k + '"' + (f.t === 'number' ? ' data-num="1" inputmode="decimal"' : '') +
          ' class="' + (f.cls || '') + '" placeholder="' + esc(f.ph || '') + '" value="' + esc(v == null ? '' : v) + '" autocomplete="off">';
        inner = f.prefix ? '<div class="sp-ig"><span>' + esc(f.prefix) + '</span>' + inp + '</div>' : f.suffix ? '<div class="sp-ig suf">' + inp + '<span>' + esc(f.suffix) + '</span></div>' : inp;
        inner = lbl + inner + hint; break; }
      case 'textarea': inner = lbl + '<textarea data-k="' + f.k + '" placeholder="' + esc(f.ph || '') + '">' + esc(v || '') + '</textarea>' + hint; break;
      case 'code': inner = lbl + '<textarea class="sp-code" spellcheck="false" data-k="' + f.k + '" onkeydown="SettingsPages._tab(event,this)">' + esc(v || '') + '</textarea>' + hint; break;
      case 'select': inner = lbl + selHtml('data-k="' + f.k + '"' + (f.asNum ? ' data-num="1"' : ''), optsOf(f, b), v) + hint; break;
      case 'checkbox': {
        inner = '<label class="sp-chk"><input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + '><span>' + esc(f.l) + '</span></label>' + hint;
        if (f.reveal) { var k = f.k; inner += '<div class="sp-reveal"' + condAttr(function (vv) { return !!vv[k]; }, rec) + '>' + f.reveal.map(function (x) { return fieldHTML(Object.assign({}, x, { show: undefined }), rec, b); }).join('') + '</div>'; }
        break; }
      case 'checks': {
        var sel = v || [];
        inner = lbl + '<div class="' + (f.items.length > 12 || !f.flat ? 'sp-chks' : 'sp-chks flat') + '" data-checks="' + f.k + '">' + f.items.map(function (x) {
          return '<label class="sp-chk"><input type="checkbox" value="' + esc(x) + '"' + (sel.indexOf(x) >= 0 ? ' checked' : '') + '><span>' + esc(x) + '</span></label>'; }).join('') + '</div>' + hint;
        break; }
      case 'msel': {
        var cur = (v || []).slice(), all = f.items.concat(cur.filter(function (x) { return f.items.indexOf(x) < 0; }));
        inner = lbl + '<div class="sp-ms" data-checks="' + f.k + '"><div class="sp-ms-box" onmousedown="SettingsPages._msBox(event,this)"><span class="sp-ms-chips">' + msChipsHtml(cur) + '</span>' +
          '<input type="text" class="sp-ms-q" autocomplete="off" spellcheck="false" placeholder="' + (cur.length ? '' : 'Select…') + '" onfocus="SettingsPages._msOpen(this)" oninput="SettingsPages._msFilter(this)" onkeydown="SettingsPages._msKey(event,this)" onblur="SettingsPages._msClose(this)"></div>' +
          '<div class="sp-ms-dd"></div><div class="sp-ms-src" hidden>' + all.map(function (x) { return '<input type="checkbox" value="' + esc(x) + '"' + (cur.indexOf(x) >= 0 ? ' checked' : '') + '>'; }).join('') + '</div></div>' + hint;
        break; }
      case 'lines': inner = lbl + linesHTML(f, v || [], b, rec) + hint; break;
      case 'image':
        inner = '<fieldset class="sp-fs"><legend>' + esc(f.l) + '</legend><input type="hidden" data-k="' + f.k + '" value="' + esc(v || '') + '">' +
          (v ? '<img class="sp-img" src="' + esc(v) + '" alt="">' : '') +
          '<input type="file" accept="image/*" onchange="SettingsPages._img(this,\'' + f.k + '\')"> ' +
          (v ? '<button type="button" class="btn btn-xs" onclick="SettingsPages._imgClear(this,\'' + f.k + '\')">Remove</button>' : '') + '</fieldset>';
        return wrap(f, inner, rec, true);
      case 'token':
        return rec.token ? '<div class="sp-f"><label class="sp-l">Token</label><div class="sp-token">' + esc(rec.token) + '</div><div class="sp-hint">Send it as the X-API-KEY header.</div></div>' :
          '<div class="sp-f"><div class="sp-hint">A token is generated when you click Create.</div></div>';
    }
    return wrap(f, inner, rec);
  }
  function msChipsHtml(sel) { return sel.map(function (x) { return '<span class="sp-ms-chip">' + esc(x) + '<i onmousedown="SettingsPages._msDel(event,this)" data-v="' + esc(x) + '">&times;</i></span>'; }).join(''); }
  function linesHTML(f, rows, b, rec) {
    if (!rows.length) rows = [{}];
    var sum = f.cols.some(function (c) { return c.sum; });
    var sums = {}; f.cols.forEach(function (c) { if (c.sum) sums[c.k] = rows.reduce(function (s, r) { return s + num(r[c.k]); }, 0); });
    return '<div class="sp-ln-wrap"><table class="sp-ln" data-lines="' + f.k + '"><thead><tr>' + f.cols.map(function (c) { return '<th' + (c.t === 'number' ? ' class="r"' : '') + '>' + esc(c.l) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      rows.map(function (r) { return lineRow(f, r, b); }).join('') + '</tbody>' +
      (sum ? '<tfoot><tr>' + f.cols.map(function (c) { return '<td' + (c.sum ? ' class="r" data-sum="' + c.k + '"' : '') + '>' + (c.sum ? esc(fmtNum(sums[c.k])) : '') + '</td>'; }).join('') + '<td></td></tr></tfoot>' : '') +
      '</table></div><button type="button" class="btn btn-xs sp-addln" onclick="SettingsPages._addLine(this,\'' + f.k + '\')">+ Add line</button>';
  }
  function lineRow(f, r, b) {
    return '<tr>' + f.cols.map(function (c) {
      var v = r[c.k];
      if (c.t === 'select') return '<td>' + selHtml('data-c="' + c.k + '"', optsOf(c, b), v) + '</td>';
      return '<td><input type="text" data-c="' + c.k + '"' + (c.t === 'number' ? ' data-num="1" inputmode="decimal" class="r"' : '') + ' value="' + esc(v == null ? '' : v) + '"></td>';
    }).join('') + '<td class="sp-act"><button type="button" title="Move up" onclick="SettingsPages._mvLine(this,-1)">' + ico('chevronDown', 'up') + '</button>' +
      '<button type="button" title="Move down" onclick="SettingsPages._mvLine(this,1)">' + ico('chevronDown') + '</button>' +
      '<button type="button" title="Remove" onclick="SettingsPages._rmLine(this)">' + ico('close') + '</button></td></tr>';
  }
  function ico(n, cls) { return (typeof ICO !== 'undefined') ? ICO.get(n, 14, cls ? 'sp-' + cls : '') : (n === 'close' ? '&times;' : cls ? '&#9650;' : '&#9660;'); }

  /* ---------- collecting a form back out of the DOM ---------- */
  function val(el) { return el.getAttribute('data-num') ? App.parseNum(el.value) : el.value; }
  function collect(root) {
    var v = {};
    root.querySelectorAll('[data-k]').forEach(function (el) { if (el.closest('table.sp-ln')) return; v[el.getAttribute('data-k')] = el.type === 'checkbox' ? el.checked : val(el); });
    root.querySelectorAll('[data-checks]').forEach(function (el) { v[el.getAttribute('data-checks')] = Array.prototype.map.call(el.querySelectorAll('input:checked'), function (i) { return i.value; }); });
    root.querySelectorAll('table[data-lines]').forEach(function (t) {
      v[t.getAttribute('data-lines')] = Array.prototype.map.call(t.tBodies[0].rows, function (tr) { var o = {}; tr.querySelectorAll('[data-c]').forEach(function (i) { o[i.getAttribute('data-c')] = val(i); }); return o; })
        .filter(function (o) { return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] != null; }); });
    });
    return v;
  }
  function refresh() {
    var root = document.getElementById('spForm'); if (!root) return;
    var v = collect(root);
    root.querySelectorAll('[data-cond]').forEach(function (el) { var fn = CONDS[+el.getAttribute('data-cond')]; var on = false; try { on = fn && fn(v); } catch (e) {} el.style.display = on ? '' : 'none'; });
    root.querySelectorAll('td[data-sum]').forEach(function (td) { var k = td.getAttribute('data-sum'), s = 0;
      td.closest('table').querySelectorAll('tbody [data-c="' + k + '"]').forEach(function (i) { s += num(i.value); }); td.textContent = fmtNum(s); });
  }

  /* ---------- screens ---------- */
  var STATE = {};       // per list path: search, sort, advanced
  var CUR = null;       // the record form on screen
  function crumbHtml(key, res, last) {
    var c = '<div class="ws-crumb sp-crumb"><div class="left">' + App._crumbIco() + ' ▸ <a class="led-link" onclick="App.settingsBack()">Settings</a>';
    res.crumbs.forEach(function (x, i) {
      var isLast = i === res.crumbs.length - 1 && !last;
      c += ' ▸ ' + (isLast ? '<span class="sp-here">' + esc(x.t) + '</span>' : '<a class="led-link" onclick="SettingsPages.go(\'' + key + '\',\'' + x.sub + '\')">' + esc(x.t) + '</a>');
    });
    if (last) c += ' ▸ <span class="sp-here">' + esc(last) + '</span>';
    return c + '</div></div>';
  }
  function introHtml(def) { return def.intro ? '<div class="info-bar sp-intro">' + esc(def.intro) + '</div>' : ''; }
  function hiddenCols(path) { var m = DB.get('mgr_sp_cols', {}) || {}; return m[path] || []; }
  function cellVal(def, r, c, b) { var v = r[c.k]; if (c.fmt) return c.fmt(v, r, b); if (Array.isArray(v)) return v.length + ' line(s)'; if (typeof v === 'boolean') return v ? 'Yes' : ''; return v == null ? '' : v; }

  function menuView(key, res) {
    var def = res.def;
    return '<div class="sp-card sp-menu">' + Object.keys(def.items).map(function (s) {
      var d = def.items[s], sub = (res.sub ? res.sub + '/' : '') + s;
      var on = d.kind === 'link' ? d.action : 'SettingsPages.go(\'' + key + '\',\'' + sub + '\')';
      return '<a class="sp-menu-a" onclick="' + on + '">' + esc(d.title) + '<span class="sp-menu-go">' + ico('chevronRight') + '</span></a>';
    }).join('') + '</div>';
  }
  function listView(b, key, res) {
    var def = res.def, path = key + (res.sub ? '/' + res.sub : '');
    var st = STATE[path] || (STATE[path] = { q: '', sort: '', dir: 1, adv: false });
    var hidden = hiddenCols(path), cols = def.cols.filter(function (c) { return hidden.indexOf(c.k) < 0; });
    var all = listGet(b, def); flush(b);
    var rows = all.map(function (r) { return def.load ? def.load(clone(r), b) : r; });
    if (st.q) { var qq = st.q.toLowerCase(); rows = rows.filter(function (x) { return def.cols.some(function (c) { return String(cellVal(def, x, c, b)).toLowerCase().indexOf(qq) >= 0; }); }); }
    if (st.sort) { var sc = def.cols.find(function (c) { return c.k === st.sort; });
      if (sc) rows = rows.slice().sort(function (x, y) { var A = sc.num ? num(x[sc.k]) : String(cellVal(def, x, sc, b)).toLowerCase(), B = sc.num ? num(y[sc.k]) : String(cellVal(def, y, sc, b)).toLowerCase(); return (A > B ? 1 : A < B ? -1 : 0) * st.dir; }); }
    var P = '\'' + path + '\'';
    var head = '<div class="sp-card-h"><span class="sp-ttl">' + esc(def.title) + '</span>' +
      '<button class="btn btn-primary btn-sm" onclick="SettingsPages.go(\'' + key + '\',\'' + res.sub + '\',\'new\')">' + esc(def.newLabel || 'New') + '</button>' +
      '<div class="sp-search">' + (def.advanced ? '<button class="sp-adv" onclick="SettingsPages._adv(' + P + ')">' + (st.adv ? '▾' : '▸') + ' Advanced Queries</button>' : '') +
      '<input type="text" id="spQ" placeholder="Search" value="' + esc(st.q) + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();SettingsPages._search(' + P + ',this.value)}">' +
      '<button class="btn btn-sm" onclick="SettingsPages._search(' + P + ',document.getElementById(\'spQ\').value)">Search</button></div></div>' +
      (st.adv ? '<div class="sp-card-h sp-adv-bar">Sort by <select onchange="SettingsPages._sort(' + P + ',this.value,null)"><option value="">—</option>' +
        def.cols.map(function (c) { return '<option value="' + c.k + '"' + (st.sort === c.k ? ' selected' : '') + '>' + esc(c.l) + '</option>'; }).join('') + '</select>' +
        '<select onchange="SettingsPages._sort(' + P + ',null,+this.value)"><option value="1"' + (st.dir === 1 ? ' selected' : '') + '>Ascending</option><option value="-1"' + (st.dir === -1 ? ' selected' : '') + '>Descending</option></select></div>' : '');
    var table = rows.length ? '<div class="sp-t-wrap"><table class="sp-t"><thead><tr><th class="sp-ec"></th>' + cols.map(function (c) {
        return '<th class="' + (c.num ? 'r' : '') + '" onclick="SettingsPages._sortCol(' + P + ',\'' + c.k + '\')">' + esc(c.l) + (st.sort === c.k ? (st.dir > 0 ? ' ▴' : ' ▾') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (x) { var open = 'SettingsPages.go(\'' + key + '\',\'' + res.sub + '\',\'edit\',' + q(x.id) + ')';
        return '<tr onclick="' + open + '"><td class="sp-ec"><button class="btn btn-xs" onclick="event.stopPropagation();' + open + '">Edit</button></td>' +
          cols.map(function (c) { return '<td class="' + (c.num ? 'r' : '') + '">' + esc(cellVal(def, x, c, b)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="sp-empty">' + (st.q ? 'No matches.' : 'Empty') + '</div>';
    var foot = '<div class="sp-card-f"><span class="sp-count">' + rows.length + '</span><span class="sp-grow"></span>' +
      '<button class="btn btn-sm" onclick="SettingsPages._editCols(' + P + ')">Edit columns</button>' +
      '<button class="btn btn-sm" onclick="SettingsPages._copy(' + P + ')">Copy to clipboard</button></div>';
    return introHtml(def) + '<div class="sp-card">' + head + table + foot + '</div>';
  }
  function editView(b, key, res, r) {
    var def = res.def, path = key + (res.sub ? '/' + res.sub : ''), isNew = r.action !== 'edit';
    var rec;
    if (isNew) rec = loadRec(def, {}, b);
    else { var hit = listGet(b, def).find(function (x) { return String(x.id) === String(r.id); }); flush(b);
      if (!hit) return '<div class="sp-card"><div class="sp-empty">Record not found.</div><div class="sp-card-f"><button class="btn" onclick="SettingsPages.go(\'' + key + '\',\'' + res.sub + '\')">Back</button></div></div>';
      rec = loadRec(def, hit, b); }
    CONDS = []; CUR = { path: path, key: key, sub: res.sub, id: isNew ? null : String(r.id), kind: 'list' };
    var btns = isNew ? '<button class="btn btn-primary" onclick="SettingsPages.submit(\'create\')">Create</button><button class="btn" onclick="SettingsPages.submit(\'another\')">Create &amp; add another</button>'
      : '<button class="btn btn-primary" onclick="SettingsPages.submit(\'update\')">Update</button>' + (def.editActions ? def.editActions(rec, b) : '') +
        '<button class="btn btn-danger" onclick="SettingsPages.remove()">Delete</button>';
    btns += '<span class="sp-grow"></span><button class="btn" onclick="SettingsPages.go(\'' + key + '\',\'' + res.sub + '\')">Cancel</button>';
    return '<div class="sp-card sp-form" id="spForm" oninput="SettingsPages.refresh()" onchange="SettingsPages.refresh()">' +
      '<div class="sp-card-h"><span class="sp-ttl">' + esc(def.entity || def.title) + '</span>' + (isNew ? '' : '<span class="sp-uid">' + esc(rec.id) + '</span>') + '</div>' +
      '<div id="spErr"></div><div class="sp-card-b">' + def.fields.map(function (f) { return fieldHTML(f, rec, b); }).join('') + '</div>' +
      '<div class="sp-card-f">' + btns + '</div></div>';
  }
  function formView(b, key, res) {
    var def = res.def, path = key + (res.sub ? '/' + res.sub : '');
    var rec = loadRec(def, formGet(b, def), b);
    CONDS = []; CUR = { path: path, key: key, sub: res.sub, id: null, kind: 'form' };
    return introHtml(def) + '<div class="sp-card sp-form" id="spForm" oninput="SettingsPages.refresh()" onchange="SettingsPages.refresh()">' +
      '<div class="sp-card-h"><span class="sp-ttl">' + esc(def.title) + '</span></div>' +
      '<div id="spErr"></div><div class="sp-card-b">' + def.fields.map(function (f) { return fieldHTML(f, rec, b); }).join('') + '</div>' +
      '<div class="sp-card-f"><button class="btn btn-primary" onclick="SettingsPages.submit(\'single\')">Update</button>' +
      (def.test ? '<button class="btn" onclick="SettingsPages._testEmail()">Test email settings</button>' : '') +
      '<span class="sp-grow"></span><button class="btn" onclick="SettingsPages.go(\'' + key + '\',\'' + res.sub + '\')">Reset</button></div></div>';
  }

  var OLD = {};
  function page(b, key) {
    var r = routeFor(key), res = resolve(key, r.sub); if (!res) return App.setMissing(key);
    var def = res.def;
    if (def.kind === 'legacy') return OLD[def.fn] ? OLD[def.fn].call(App, b) : App.setMissing(def.title);
    if (def.kind === 'menu') return crumbHtml(key, res) + menuView(key, res);
    if (def.kind === 'form') return crumbHtml(key, res) + formView(b, key, res);
    if (r.action === 'new' || r.action === 'edit') return crumbHtml(key, res, r.action === 'new' ? 'New' : 'Edit') + editView(b, key, res, r);
    return crumbHtml(key, res) + listView(b, key, res);
  }

  /* ---------- actions ---------- */
  function showErr(msg) { var el = document.getElementById('spErr'); if (el) el.innerHTML = '<div class="sp-errbox">' + esc(msg) + '</div>'; else alert(msg); }
  var API = {
    PAGES: PAGES, OLD: OLD, go: go, page: page, resolve: resolve,
    rows: rowsAt, form: formAt, save: saveRecord, del: deleteRecord, taxRateOf: taxRateOf, collect: collect, refresh: refresh, toast: toast,
    /* every page path, menus included — the tests walk this */
    paths: function () { var out = [];
      function w(key, def, sub) { out.push({ key: key, sub: sub, kind: def.kind });
        if (def.kind === 'menu') Object.keys(def.items).forEach(function (s) { w(key, def.items[s], sub ? sub + '/' + s : s); }); }
      Object.keys(PAGES).forEach(function (k) { w(k, PAGES[k], ''); });
      return out; },
    submit: function (act) {
      if (!CUR) return; var root = document.getElementById('spForm'); if (!root) return;
      var v = collect(root), res = saveRecord(CUR.path, v, act === 'update' ? CUR.id : null);
      if (!res.ok) { showErr(res.error); return; }
      var def = defAt(CUR.path);
      toast(act === 'single' || act === 'update' ? 'Updated' : 'Created');
      if (act === 'single') { go(CUR.key, CUR.sub); return; }
      if (act === 'another') { go(CUR.key, CUR.sub, 'new'); return; }
      if (act === 'create' && def.onCreate) { go(CUR.key, CUR.sub, 'edit', res.record.id); return; }
      go(CUR.key, CUR.sub);
    },
    remove: function () { if (!CUR || CUR.id == null) return; if (!ask('Delete this record?', function () { SettingsPages.remove(); })) return;
      deleteRecord(CUR.path, CUR.id); toast('Deleted'); go(CUR.key, CUR.sub); },
    recurRun: function (id) { var b = App.curBiz(); if (!b) return; var i = (b.recurring || []).findIndex(function (x) { return String(x.id) === String(id); });
      if (i < 0) return; App.recurRun(i); if (CUR) go(CUR.key, CUR.sub, 'edit', id); },
    _search: function (p, v) { (STATE[p] = STATE[p] || { q: '', sort: '', dir: 1 }).q = v || ''; App.renderMain(App.curBiz()); },
    _adv: function (p) { STATE[p].adv = !STATE[p].adv; App.renderMain(App.curBiz()); },
    _sort: function (p, k, d) { var s = STATE[p]; if (k !== null) s.sort = k; if (d !== null) s.dir = d; App.renderMain(App.curBiz()); },
    _sortCol: function (p, k) { var s = STATE[p]; s.dir = s.sort === k ? -s.dir : 1; s.sort = k; App.renderMain(App.curBiz()); },
    _copy: function (p) { var b = App.curBiz(), def = defAt(p); var rows = listGet(b, def);
      var cell = function (v) { return String(v == null ? '' : v).replace(/\t/g, ' ').replace(/\r?\n/g, ' '); };
      var tsv = [def.cols.map(function (c) { return c.l; }).join('\t')].concat(rows.map(function (r) { return def.cols.map(function (c) { return cell(cellVal(def, r, c, b)); }).join('\t'); })).join('\n');
      var fallback = function () { App._openOverlay('<div class="app-modal-h">Copy</div><div class="app-modal-b"><textarea class="sp-code" readonly>' + esc(tsv) + '</textarea></div><div class="app-modal-f"><span class="sp-grow"></span><button class="btn" onclick="App._closeOverlay()">Close</button></div>'); };
      try { navigator.clipboard.writeText(tsv).then(function () { toast('Copied to clipboard'); }, fallback); } catch (e) { fallback(); } },
    _editCols: function (p) { var def = defAt(p), hid = hiddenCols(p);
      App._openOverlay('<div class="app-modal-h">Edit columns</div><div class="app-modal-b" id="spCols">' + def.cols.map(function (c) {
        return '<label class="sp-chk"><input type="checkbox" value="' + c.k + '"' + (hid.indexOf(c.k) >= 0 ? '' : ' checked') + '><span>' + esc(c.l) + '</span></label>'; }).join('') +
        '</div><div class="app-modal-f"><span class="sp-grow"></span><button class="btn" onclick="App._closeOverlay()">Cancel</button><button class="btn btn-primary" onclick="SettingsPages._saveCols(\'' + p + '\')">Update</button></div>'); },
    _saveCols: function (p) { var box = document.getElementById('spCols'); if (!box) return;
      var m = DB.get('mgr_sp_cols', {}) || {}; m[p] = Array.prototype.map.call(box.querySelectorAll('input:not(:checked)'), function (i) { return i.value; });
      DB.set('mgr_sp_cols', m); App._closeOverlay(); App.renderMain(App.curBiz()); },
    _testEmail: function () { var b = App.curBiz(); var mode = App.emailMode(b);
      toast(mode === 'relay' ? 'Test message queued — it is sent through your relay when you email a document' : 'Mail-client mode: your mail client sends the message'); },
    _tab: function (e, ta) { if (e.key !== 'Tab') return; e.preventDefault(); var s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; },
    _addLine: function (btn, k) { if (!CUR) return; var def = defAt(CUR.path), f = null;
      walk(def.fields, function (x) { if (x.k === k) f = x; });
      var t = btn.parentNode.querySelector('table[data-lines="' + k + '"]'); if (!f || !t) return;
      t.tBodies[0].insertAdjacentHTML('beforeend', lineRow(f, {}, App.curBiz())); refresh();
      var last = t.tBodies[0].rows[t.tBodies[0].rows.length - 1]; var first = last && last.querySelector('input,select'); if (first) first.focus(); },
    _rmLine: function (el) { var tr = el.closest('tr'), tb = tr.parentNode; if (tb.rows.length > 1) tr.remove(); else tr.querySelectorAll('input').forEach(function (x) { x.value = ''; }); refresh(); },
    _mvLine: function (el, d) { var tr = el.closest('tr'); if (d < 0 && tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling); if (d > 0 && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr); },
    _img: function (inp, k) { var f = inp.files && inp.files[0]; if (!f) return; if (f.size > 1.5e6) { alert('That image is too large (max 1.5 MB).'); inp.value = ''; return; }
      var rd = new FileReader(); rd.onload = function () { var fs = inp.parentNode, h = fs.querySelector('[data-k="' + k + '"]'); h.value = rd.result;
        var im = fs.querySelector('img'); if (!im) { im = document.createElement('img'); im.className = 'sp-img'; h.after(im); } im.src = rd.result; }; rd.readAsDataURL(f); },
    _imgClear: function (btn, k) { var fs = btn.parentNode; fs.querySelector('[data-k="' + k + '"]').value = ''; var im = fs.querySelector('img'); if (im) im.remove(); btn.remove(); },
    /* multi-select tag picker */
    _msBox: function (e, box) { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'I') { e.preventDefault(); box.querySelector('.sp-ms-q').focus(); } },
    _msOpen: function (qi) { var ms = qi.closest('.sp-ms'); ms.setAttribute('data-hi', '0'); ms.classList.add('open'); msDraw(ms); },
    _msClose: function (qi) { var ms = qi.closest('.sp-ms'); ms.classList.remove('open'); qi.value = ''; },
    _msFilter: function (qi) { var ms = qi.closest('.sp-ms'); ms.setAttribute('data-hi', '0'); ms.classList.add('open'); msDraw(ms); },
    _msPick: function (e, o) { e.preventDefault(); var ms = o.closest('.sp-ms'), qi = ms.querySelector('.sp-ms-q'); msSet(ms, o.getAttribute('data-v'), true); qi.value = ''; msDraw(ms); qi.focus(); },
    _msDel: function (e, x) { e.preventDefault(); e.stopPropagation(); var ms = x.closest('.sp-ms'); msSet(ms, x.getAttribute('data-v'), false); if (ms.classList.contains('open')) msDraw(ms); },
    _msKey: function (e, qi) {
      var ms = qi.closest('.sp-ms'), opts = ms.querySelectorAll('.sp-ms-o'), hi = +(ms.getAttribute('data-hi') || 0);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!ms.classList.contains('open')) return API._msOpen(qi);
        hi = Math.max(0, Math.min(opts.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); ms.setAttribute('data-hi', String(hi)); msDraw(ms); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); var o = opts[hi]; if (o && ms.classList.contains('open')) { msSet(ms, o.getAttribute('data-v'), true); qi.value = ''; msDraw(ms); } }
      else if (e.key === 'Backspace' && !qi.value) { var on = ms.querySelectorAll('.sp-ms-src input:checked'); var last = on[on.length - 1]; if (last) { msSet(ms, last.value, false); if (ms.classList.contains('open')) msDraw(ms); } }
      else if (e.key === 'Escape') ms.classList.remove('open');
    }
  };
  function msDraw(ms) {
    var qv = ms.querySelector('.sp-ms-q').value.trim().toLowerCase(), dd = ms.querySelector('.sp-ms-dd');
    var opts = Array.prototype.filter.call(ms.querySelectorAll('.sp-ms-src input'), function (i) { return !i.checked && i.value.toLowerCase().indexOf(qv) >= 0; }).map(function (i) { return i.value; });
    var hi = Math.min(+(ms.getAttribute('data-hi') || 0), Math.max(opts.length - 1, 0)); ms.setAttribute('data-hi', String(hi));
    dd.innerHTML = opts.length ? opts.map(function (x, n) { return '<div class="sp-ms-o' + (n === hi ? ' on' : '') + '" data-v="' + esc(x) + '" onmousedown="SettingsPages._msPick(event,this)">' + esc(x) + '</div>'; }).join('') : '<div class="sp-ms-none">No results found</div>';
    var on = dd.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  function msSet(ms, v, on) {
    var cb = Array.prototype.find.call(ms.querySelectorAll('.sp-ms-src input'), function (i) { return i.value === v; }); if (!cb) return;
    cb.checked = on; var sel = Array.prototype.map.call(ms.querySelectorAll('.sp-ms-src input:checked'), function (i) { return i.value; });
    ms.querySelector('.sp-ms-chips').innerHTML = msChipsHtml(sel); ms.querySelector('.sp-ms-q').placeholder = sel.length ? '' : 'Select…'; refresh();
  }

  /* ---------- install on App ---------- */
  Object.keys(PAGES).forEach(function (key) {
    var fn = 'set_' + key;
    if (typeof App[fn] === 'function') OLD[fn] = App[fn];
    App[fn] = function (b) { return page(b, key); };
  });
  /* the two legacy hand-offs reached from a menu entry */
  if (!OLD.set_control && App.set_control) OLD.set_control = App.set_control;
  if (!OLD.set_customFields && App.set_customFields) OLD.set_customFields = App.set_customFields;
  /* Custom Themes and Control Accounts open sub-editors through App state of
     their own; while one of those is on screen, the old handler draws it. */
  App.set_themes = function (b) { return (this.fmtCat || this.fmtForm) ? OLD.set_themes.call(this, b) : page(b, 'themes'); };
  App.set_control = function (b) { return this.ctrlEditId != null ? OLD.set_control.call(this, b) : page(b, 'control'); };

  window.SettingsPages = API;
  if (typeof globalThis !== 'undefined') globalThis.SettingsPages = API;
})();
