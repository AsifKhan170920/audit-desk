/* ===================== icon set =====================
   Lucide-style line icons, inlined as SVG so the app stays dependency-free and
   works offline. Every glyph is a 24×24 viewBox drawn with currentColor at a
   consistent 1.75 stroke, so an icon inherits the colour of whatever it sits in.

   ICO.get(name) returns markup; ICO.forSection(label) maps a sidebar label to
   an icon. Labels are the routing keys used everywhere else in the app, so this
   file only ever reads them — never rename one here. */
(function () {
  var P = {
    /* navigation — overview */
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    /* banking */
    bank: '<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M9 14v3M15 14v3"/>',
    receipt: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
    transfer: '<path d="M17 2l4 4-4 4"/><path d="M3 6h18"/><path d="M7 22l-4-4 4-4"/><path d="M21 18H3"/>',
    reconcile: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M8.5 13.5l2.5 2.5 4.5-4.5"/>',
    /* sales */
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    quote: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h4"/>',
    order: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 2v3M15 2v3M8 11h8M8 15h5"/>',
    invoice: '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M15 2v5h5"/><path d="M9 12h6M9 16h6"/>',
    creditNote: '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M15 2v5h5"/><path d="M9 14h6"/>',
    truck: '<path d="M3 16V6a1 1 0 0 1 1-1h10v11"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    /* purchases */
    supplier: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/>',
    bag: '<path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    /* inventory / production */
    tag: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="8" cy="8" r="1.4"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6M4 4l5 5"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    factory: '<path d="M2 20h20V9l-6 4V9l-6 4V3H4l-2 17Z"/><path d="M8 20v-4M14 20v-4"/>',
    puzzle: '<path d="M9 3h6v3a2 2 0 1 0 4 0h2v6h-3a2 2 0 1 0 0 4h3v5H9v-3a2 2 0 1 1-4 0H3V9h3a2 2 0 1 0 0-4H3V3Z"/>',
    /* people */
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 4.5a3.5 3.5 0 0 1 0 7M18 21a7 7 0 0 0-2-4.9"/>',
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="17" cy="13.5" r="1.3"/>',
    /* assets */
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 6h2M13 6h2M9 10h2M13 10h2M9 14h2M13 14h2M10 22v-4h4v4"/>',
    trendDown: '<path d="M22 17 13.5 8.5 8.5 13.5 2 7"/><path d="M16 17h6v-6"/>',
    trendUp: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    lightbulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-3.6 10.8c.6.5.9 1.1 1 1.7l.1.5h5l.1-.5c.1-.6.4-1.2 1-1.7A6 6 0 0 0 12 2Z"/>',
    scale: '<path d="M12 3v18M7 21h10"/><path d="M6 7h12M3 13l3-6 3 6a3 3 0 0 1-6 0ZM15 13l3-6 3 6a3 3 0 0 1-6 0Z"/>',
    landmark: '<path d="M3 21h18M4 10h16M12 3l8 5H4l8-5ZM6 10v11M10 10v11M14 10v11M18 10v11"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
    book: '<path d="M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V4Z"/><path d="M4 20a2 2 0 0 1 2-2h13"/>',
    /* chrome */
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10.5 19a1.8 1.8 0 0 0 3 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M2 13h20"/>',
    lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    wallet2: '<path d="M4 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4Z"/><path d="M4 6a2 2 0 0 1 2-2h10"/><circle cx="16" cy="12.5" r="1.3"/>',
    arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
    arrowDownRight: '<path d="M7 7l10 10M17 8v9H8"/>',
    coins: '<ellipse cx="9" cy="6.5" rx="6" ry="3"/><path d="M3 6.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3"/><path d="M15 11.5c3 .3 6 1.5 6 3v3c0 1.7-2.7 3-6 3s-6-1.3-6-3v-3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
    download: '<path d="M12 3v12M7.5 11 12 15.5 16.5 11"/><path d="M4 20h16"/>',
    check: '<path d="m5 12.5 5 5L19 7"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
    /* settings */
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19Z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  };

  /* Sidebar label → icon. Anything unmapped falls back to a neutral glyph, so
     adding a tab never renders a hole. */
  var SECTION = {
    'Dashboard': 'dashboard', 'Summary': 'scale',
    'Bank and Cash Accounts': 'bank', 'Receipts': 'receipt', 'Payments': 'card',
    'Inter Account Transfers': 'transfer', 'Bank Reconciliations': 'reconcile',
    'Expense Claims': 'bag',
    'Customers': 'user', 'Sales Quotes': 'quote', 'Sales Orders': 'order',
    'Sales Invoices': 'invoice', 'Credit Notes': 'creditNote', 'Delivery Notes': 'truck',
    'Billable Time': 'clock', 'Withholding Tax Receipts': 'percent',
    'Suppliers': 'supplier', 'Purchase Quotes': 'quote', 'Purchase Orders': 'order',
    'Purchase Invoices': 'invoice', 'Debit Notes': 'creditNote', 'Goods Receipts': 'box',
    'Inventory Items': 'tag', 'Inventory Transfers': 'shuffle', 'Inventory Write-offs': 'trash',
    'Production Orders': 'factory', 'Non-inventory Items': 'puzzle',
    'Employees': 'users', 'Payslips': 'wallet', 'Payroll': 'briefcase',
    'Fixed Assets': 'building', 'Depreciation Entries': 'trendDown',
    'Intangible Assets': 'lightbulb', 'Amortization Entries': 'scale',
    'Capital Accounts': 'landmark', 'Special Accounts': 'star',
    'Investments': 'trendUp', 'Journal Entries': 'book',
    'Reports': 'chart', 'Settings': 'settings',
  };

  /* Settings tile key → icon, same contract as SECTION. */
  var SETTING = {
    business:'building', capitalSub:'landmark', coa:'book', control:'reconcile',
    extensions:'arrowUpRight', customFields:'puzzle', themes:'card', format:'clock', email:'quote',
    footers:'invoice', locations:'box', obsolete:'alert', payslipItems:'wallet', tax:'percent',
    permissions:'user', accessTokens:'key', attachments:'download', bankRules:'bank',
    billableExpenses:'receipt', cashFlowGroups:'trendUp', currencies:'coins', customReports:'chart',
    customerPortals:'users', divisions:'shuffle', claimPayers:'wallet2', forecasts:'chart',
    formDefaults:'order', kits:'bag', unitCosts:'tag', marketPrices:'trendUp',
    keyboardNav:'keyboard', lateFees:'clock', lock:'lock', nonInvItems:'tag', projects:'briefcase',
    recurring:'transfer', starting:'scale', webServices:'cloud', withholdingTax:'percent',
  };

  var ICO = {
    has: function (n) { return !!P[n]; },
    /* size in px; cls lands on the <svg> so callers can size/colour in CSS */
    get: function (name, size, cls) {
      var d = P[name] || P.box;
      return '<svg class="ico' + (cls ? ' ' + cls : '') + '" width="' + (size || 18) + '" height="' + (size || 18) +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    },
    forSection: function (label, size, cls) { return this.get(SECTION[label] || 'box', size, cls); },
    forSetting: function (key, size, cls) { return this.get(SETTING[key] || 'settings', size, cls); },
    sectionIcon: function (label) { return SECTION[label] || 'box'; },
  };

  if (typeof window !== 'undefined') window.ICO = ICO;
  if (typeof globalThis !== 'undefined') globalThis.ICO = ICO;
})();
