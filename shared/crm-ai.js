/* ============================================================
   CRM AI ASSISTANT – type or speak an instruction, Claude does it in the CRM
   Loaded into the CRM page after it opens (crm/index.html).
   Uses the CRM's own data functions: load(), save(), route() …
   Claude is called straight from this browser (Anthropic Messages API + tools).
   ============================================================ */
(function () {
  'use strict';
  if (window.CRMAI) return;
  // embed mode: the assistant runs inside a small frame on the dashboard / Audit Desk
  var EMBED = /[?&]embed=1\b/.test(location.search);
  function toParent(msg) { try { if (EMBED && window.parent !== window) window.parent.postMessage(Object.assign({ft: 1}, msg), location.origin); } catch (e) {} }
  function goto(hash) { if (EMBED) toParent({type: 'navigate', url: location.pathname.replace(/[^/]*$/, '') + hash}); else location.hash = hash; }
  var OWN_KEY = 'fairtax-crm-ai-key', AUDIT_KEY = 'fairtax-audit-desk-ai-key', PREF_KEY = 'fairtax-crm-ai-prefs';
  var DEFAULT_MODEL = 'claude-sonnet-5';
  var MODELS = [['claude-sonnet-5', 'Claude Sonnet 5 – recommended'], ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5 – fastest, lowest cost'], ['claude-opus-5', 'Claude Opus 5 – most careful']];
  var LANGS = [['en-GB', 'English'], ['en-IN', 'English (India/Pakistan accent)'], ['ar-AE', 'العربية Arabic'], ['ur-PK', 'اردو Urdu'], ['hi-IN', 'हिन्दी Hindi']];

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function today() { return ymd(new Date()); }
  function prefs() { try { return Object.assign({lang: 'en-GB', speak: true, autoSend: true, model: ''}, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (e) { return {lang: 'en-GB', speak: true, autoSend: true, model: ''}; } }
  function setPref(k, v) { var p = prefs(); p[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }
  function me() { return (window.FT && FT.me) || {}; }
  function myName() { var m = me(); return m.name || m.id || 'AI Assistant'; }
  function shortDate() { return new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}); }
  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function arr(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean)); }
  function pick(list, value, fallback) {
    if (value == null || value === '') return fallback;
    var v = lc(value), hit = list.filter(function (x) { return lc(x) === v; })[0] || list.filter(function (x) { return lc(x).indexOf(v) === 0 || v.indexOf(lc(x)) === 0; })[0];
    return hit || fallback;
  }

  /* ---------------- CRM data access ---------------- */
  var COLL = {lead: 'leads', client: 'clients', task: 'tasks', quotation: 'quotations', agreement: 'agreements', invoice: 'invoices', receipt: 'receipts', service: 'services'};
  function coll(type) { var t = lc(type).replace(/s$/, ''); return COLL[t] ? {type: t, key: COLL[t]} : null; }
  function db() { return load(); }
  function partnerName(d, id) { var p = (d.partners || []).find(function (x) { return x.id === id; }); return p ? p.name : ''; }
  function clientName(d, id) { var c = (d.clients || []).find(function (x) { return x.id === id; }); return c ? c.name : ''; }

  // find one record by id or by (part of) its name
  function findOne(d, type, ref) {
    var c = coll(type); if (!c) throw new Error('Unknown record type "' + type + '"');
    var list = d[c.key] || [], r = String(ref == null ? '' : ref).trim();
    if (!r) throw new Error('Say which ' + c.type + ' (name or id).');
    var byId = list.find(function (x) { return x.id === r; }); if (byId) return byId;
    var label = function (x) { return lc(x.name || x.title || x.invoiceNo || x.receiptNo || x.reference || x.refName || x.clientName || ''); };
    var q = lc(r);
    var exact = list.filter(function (x) { return label(x) === q || lc(x.invoiceNo) === q || lc(x.receiptNo) === q || lc(x.reference) === q; });
    if (exact.length === 1) return exact[0];
    var part = list.filter(function (x) { return label(x).indexOf(q) >= 0 || (x.clientName && lc(x.clientName).indexOf(q) >= 0); });
    if (part.length === 1) return part[0];
    if (!part.length) {
      var words = q.split(/\s+/).filter(function (w) { return w.length > 2; });
      part = list.filter(function (x) { var l = label(x); return words.length && words.every(function (w) { return l.indexOf(w) >= 0; }); });
      if (part.length === 1) return part[0];
    }
    if (!part.length) throw new Error('No ' + c.type + ' matches "' + r + '".');
    throw new Error('More than one ' + c.type + ' matches "' + r + '": ' + part.slice(0, 8).map(function (x) { return (x.name || x.title || x.invoiceNo || x.receiptNo || x.reference) + ' [' + x.id + ']'; }).join('; ') + '. Ask the user which one.');
  }

  function brief(d, type, x, full) {
    var lastNote = function (n) { return n && n.length ? (n[0].text || n[0].note || '') : ''; };
    switch (type) {
      case 'lead': return {id: x.id, name: x.name, stage: x.stage, source: x.source, phone: x.phone, email: x.email, contact: x.contact, assignedTo: x.assignedTo, services: x.services, date: x.date, tradeLicence: x.tradeLicence || '', address: full ? x.address : undefined, notes: full ? (x.notes || []).slice(0, 10) : lastNote(x.notes) || undefined};
      case 'client': return {id: x.id, name: x.name, status: x.status, partner: partnerName(d, x.partnerId), email: x.email, phone: x.phone, services: x.services, vatCycle: x.vatCycle, taxYearEnd: x.taxYearEnd, trn: x.trn, tradeLicence: x.tradeLicence || '', contractExpiry: x.contractExpiry, staff: x.staff,
        address: full ? x.address : undefined, portalId: full ? x.portalId : undefined, notes: full ? (x.notes || []).slice(0, 10) : undefined};
      case 'task': return {id: x.id, title: x.title, type: x.type, status: x.status, priority: x.priority, dueDate: x.dueDate, recurrence: x.recurrence, client: clientName(d, x.clientId), assignees: x.assignees,
        checklist: full ? x.checklist : undefined, comments: full ? (x.comments || []).slice(0, 10) : lastNote(x.comments) || undefined};
      case 'quotation': return {id: x.id, reference: x.reference, for: x.forType, name: x.refName, status: x.status, date: x.date, amount: x.amount || itemsTotal(x.items), items: full ? x.items : undefined, scope: full ? (x.scope || []).map(function (s) { return s.heading; }) : undefined};
      case 'agreement': return {id: x.id, reference: x.reference, client: x.clientName, status: x.status, date: x.date, amount: x.amount || itemsTotal(x.items), items: full ? x.items : undefined,
        schedule: full ? (x.schedule || []).map(function (r) { return {label: r.label, amount: r.amount, dueDate: r.dueDate, status: r.status, method: r.method}; }) : undefined};
      case 'invoice': var sub = itemsTotal(x.items), vat = vatSum(x.items, x.vatRate);
        return {id: x.id, invoiceNo: x.invoiceNo, client: x.clientName, date: x.date, dueDate: x.dueDate, status: x.status, subtotal: sub, vat: vat, total: sub + vat, items: full ? x.items : undefined, notes: full ? x.notes : undefined};
      case 'receipt': return {id: x.id, receiptNo: x.receiptNo, client: x.clientName, date: x.date, amount: x.amount, method: x.method, reference: x.reference, chequeNo: x.chequeNo || undefined, chequeDate: x.chequeDate || undefined, bank: x.bank || undefined, notes: full ? x.notes : undefined};
      case 'service': return {id: x.id, type: x.type, client: x.clientName, period: x.period, status: x.status, nextFollowUp: x.nextDate, deadline: x.deadline, completedDate: x.completedDate || undefined, feedback: full ? (x.feedback || []).slice(0, 10) : lastNote(x.feedback) || undefined};
    }
    return x;
  }

  /* ---------------- tools Claude can use ---------------- */
  var S = function (props, req) { return {type: 'object', properties: props, required: req || []}; };
  var str = function (d) { return {type: 'string', description: d}; };
  var TYPES = ['lead', 'client', 'task', 'quotation', 'agreement', 'invoice', 'receipt', 'service'];
  var TOOLS = [
    {name: 'get_overview', description: 'Snapshot of the CRM right now: counts, overdue tasks, tasks due in the next 7 days, lead pipeline, unpaid invoices, service follow-ups due, team members and partners. Use it for "what is pending / overdue / my day" questions and before assigning people.', input_schema: S({})},
    {name: 'search_records', description: 'Find records. Text search looks in names, titles, numbers, phone, email and client names. Returns short rows with ids.', input_schema: S({
      type: {type: 'string', enum: TYPES}, query: str('words to search for (optional)'), status: str('stage (leads) or status to filter by (optional)'),
      assigned_to: str('team member name (optional; leads/tasks)'), client: str('client name or id (optional; tasks/invoices/receipts/services)'),
      date_from: str('YYYY-MM-DD (optional; due date for tasks, date for others)'), date_to: str('YYYY-MM-DD (optional)'), limit: {type: 'integer', description: 'max rows, default 25'}}, ['type'])},
    {name: 'get_record', description: 'Full details of one record, including notes/comments/items.', input_schema: S({type: {type: 'string', enum: TYPES}, ref: str('id, or the exact/partial name or number')}, ['type', 'ref'])},
    {name: 'create_lead', description: 'Add a new lead (prospect).', input_schema: S({name: str('company / lead name'), phone: str(''), email: str(''), contact: str('contact person'), source: {type: 'string', enum: ['Website', 'Referral', 'Walk-in', 'Social']},
      stage: {type: 'string', enum: ['New', 'Contacted', 'Quotation Sent', 'Follow-up', 'Closed']}, services: {type: 'array', items: {type: 'string'}}, assigned_to: str('team member'), trade_licence: str(''), address: str(''), note: str('first note (optional)')}, ['name'])},
    {name: 'update_lead', description: 'Change a lead and/or add a note (e.g. call outcome). Only send the fields that change.', input_schema: S({ref: str('lead id or name'), name: str(''), phone: str(''), email: str(''), contact: str(''), source: str(''), stage: {type: 'string', enum: ['New', 'Contacted', 'Quotation Sent', 'Follow-up', 'Closed']},
      services: {type: 'array', items: {type: 'string'}}, assigned_to: str(''), trade_licence: str(''), address: str(''), note: str('note to add')}, ['ref'])},
    {name: 'convert_lead_to_client', description: 'Turn a won lead into a client (lead stage becomes Closed).', input_schema: S({ref: str('lead id or name')}, ['ref'])},
    {name: 'create_client', description: 'Add a client directly.', input_schema: S({name: str(''), email: str(''), phone: str(''), partner: str('partner name'), services: {type: 'array', items: {type: 'string'}}, vat_cycle: {type: 'string', enum: ['Monthly', 'Stagger 1', 'Stagger 2', 'Stagger 3']},
      tax_year_end: str('YYYY-MM-DD'), trn: str(''), trade_licence: str(''), contract_expiry: str('YYYY-MM-DD'), address: str(''), staff: {type: 'array', items: {type: 'string'}}, note: str('')}, ['name'])},
    {name: 'update_client', description: 'Change client details and/or add a note. Only send fields that change.', input_schema: S({ref: str('client id or name'), name: str(''), status: {type: 'string', enum: ['Active', 'Inactive']}, email: str(''), phone: str(''), partner: str('partner name'),
      services: {type: 'array', items: {type: 'string'}}, vat_cycle: {type: 'string', enum: ['Monthly', 'Stagger 1', 'Stagger 2', 'Stagger 3']}, tax_year_end: str(''), trn: str(''), trade_licence: str(''), contract_expiry: str(''), address: str(''), staff: {type: 'array', items: {type: 'string'}}, note: str('note to add')}, ['ref'])},
    {name: 'create_task', description: 'Create a task, reminder, meeting or renewal.', input_schema: S({title: str(''), due_date: str('YYYY-MM-DD'), type: {type: 'string', enum: ['Task', 'Reminder', 'Meeting', 'Renewal']}, priority: {type: 'string', enum: ['High', 'Medium', 'Low']},
      client: str('client name or id (optional)'), assignees: {type: 'array', items: {type: 'string'}}, recurrence: {type: 'string', enum: ['None', 'Weekly', 'Monthly', 'Quarterly', 'Annual']}, checklist: {type: 'array', items: {type: 'string'}}, comment: str('first comment (optional)'),
      time: str('HH:MM 24h, for meetings (optional)'), location: str('place or meeting link (optional)')}, ['title', 'due_date'])},
    {name: 'update_task', description: 'Change a task (status, due date, priority, people…) and/or add a comment. Completing a recurring task creates the next one automatically.', input_schema: S({ref: str('task id or title'), title: str(''),
      status: {type: 'string', enum: ['Not Started', 'In Progress', 'Pending to Client', 'Completed']}, due_date: str(''), priority: {type: 'string', enum: ['High', 'Medium', 'Low']}, type: str(''), assignees: {type: 'array', items: {type: 'string'}},
      recurrence: {type: 'string', enum: ['None', 'Weekly', 'Monthly', 'Quarterly', 'Annual']}, comment: str('comment to add'), time: str('HH:MM'), location: str('')}, ['ref'])},
    {name: 'create_invoice', description: 'Create a tax invoice for a client (AED). VAT per line: standard (5%), zero or exempt.', input_schema: S({client: str('client name or id'),
      items: {type: 'array', items: S({description: str(''), quantity: {type: 'number'}, unit_price: {type: 'number'}, vat: {type: 'string', enum: ['standard', 'zero', 'exempt']}}, ['description', 'unit_price'])},
      date: str('YYYY-MM-DD, default today'), due_date: str('YYYY-MM-DD, default +14 days'), notes: str('')}, ['client', 'items'])},
    {name: 'update_invoice', description: 'Change invoice status, dates or notes.', input_schema: S({ref: str('invoice id or number'), status: {type: 'string', enum: ['Unpaid', 'Partial', 'Paid']}, date: str(''), due_date: str(''), notes: str('')}, ['ref'])},
    {name: 'create_receipt', description: 'Record money received from a client. For a post-dated cheque use method PDC with cheque_date – a reminder task is created.', input_schema: S({client: str('client name or id'), amount: {type: 'number'},
      method: {type: 'string', enum: ['Cash', 'Online Transfer', 'CDC', 'PDC']}, date: str('YYYY-MM-DD, default today'), reference: str('e.g. invoice number'), cheque_no: str(''), bank: str(''), cheque_date: str('YYYY-MM-DD'), notes: str('')}, ['client', 'amount'])},
    {name: 'create_quotation', description: 'Create a draft quotation for a lead or client. Scope services add the standard scope wording.', input_schema: S({for_type: {type: 'string', enum: ['lead', 'client']}, ref: str('lead/client name or id'),
      items: {type: 'array', items: S({description: str(''), period: str('e.g. FY2025, Monthly'), amount: {type: 'number'}}, ['description', 'amount'])},
      scope_services: {type: 'array', items: {type: 'string', enum: ['Bookkeeping', 'VAT Return Filing', 'Corporate Tax Return Filing', 'Financial Audit', 'Preparation of Financial Statements', 'Anti Money Laundering', 'Access to Accounting Software']}}, reference: str(''), date: str('')}, ['for_type', 'ref'])},
    {name: 'add_service', description: 'Start tracking an engagement for a client; the CRM then creates follow-up tasks automatically.', input_schema: S({client: str('client name or id'),
      type: {type: 'string', enum: ['Bookkeeping', 'VAT Return Filing', 'Corporate Tax Return Filing', 'Financial Audit', 'Preparation of Financial Statements', 'Anti Money Laundering', 'Access to Accounting Software']}, period: str('e.g. FY2025 or Q3 2026'), start_date: str('first follow-up YYYY-MM-DD, default today'), deadline: str('submission deadline YYYY-MM-DD (optional)')}, ['client', 'type', 'period'])},
    {name: 'service_followup', description: 'Log a follow-up on a service: add feedback and either set the next follow-up date, snooze to the normal cycle, or complete the service.', input_schema: S({ref: str('service id, or client name + service type'),
      action: {type: 'string', enum: ['log_and_snooze', 'set_next_date', 'complete']}, note: str('what happened'), next_date: str('YYYY-MM-DD for set_next_date')}, ['ref', 'action'])},
    {name: 'log_client_contact', description: 'Record a client check-in (call, message, feedback or meeting). This resets the client check-in reminder.', input_schema: S({client: str('client name or id'),
      type: {type: 'string', enum: ['call', 'message', 'feedback', 'meeting']}, note: str('what was discussed (optional)'), next_in_days: {type: 'integer', description: 'next check-in in N days instead of the normal schedule (optional)'}}, ['client', 'type'])},
    {name: 'assign_client', description: 'Assign staff to a client, or let the system pick by expertise and workload ("auto").', input_schema: S({client: str('client name or id'), staff: {type: 'array', items: {type: 'string'}, description: 'team member names; leave empty with auto=true'}, auto: {type: 'boolean'}}, ['client'])},
    {name: 'set_client_schedule', description: 'Change a client\'s reminder schedule. Omit a field to keep it; use 0 / "auto" to go back to automatic.', input_schema: S({client: str('client name or id'), check_in_days: {type: 'integer'},
      bookkeeping: {type: 'string', enum: ['auto', 'Weekly', 'Fortnightly', 'Monthly']}, fs_months: {type: 'integer'}, audit_months: {type: 'integer'}, missing_days: {type: 'integer'}}, ['client'])},
    {name: 'get_reminders', description: 'List upcoming reminders (lead nudges, check-ins, meetings, VAT/CT/FS/audit/bookkeeping deadlines, contracts, cheques, missing details).', input_schema: S({days: {type: 'integer', description: 'default 7'}, everyone: {type: 'boolean', description: 'whole team (admin) instead of only mine'}, kind: str('optional filter e.g. vat, lead, health, meeting')})},
    {name: 'delete_record', description: 'Delete a record. The user is asked to confirm on screen before anything is deleted.', input_schema: S({type: {type: 'string', enum: TYPES}, ref: str('id or name')}, ['type', 'ref'])},
    {name: 'open_page', description: 'Show a page in the CRM window: a list (dashboard, leads, clients, tasks, quotations, agreements, invoices, receipts, payments, retention, settings) or one record (type + ref). Use it when the user wants to see or print something.', input_schema: S({page: str('list name, or a record type'), ref: str('record id or name when opening one record')}, ['page'])}
  ];

  var changed = false;   // set when a tool changed data during this turn

  function applyCommon(x, a, map) {
    Object.keys(map).forEach(function (k) {
      if (a[k] === undefined || a[k] === null || a[k] === '') return;
      var f = map[k];
      if (Array.isArray(f)) x[f[0]] = f[1](a[k]); else x[f] = a[k];
    });
  }
  function teamName(d, name) { if (!name) return ''; return pick(d.team || [], name, String(name)); }
  function teamList(d, names) { return arr(names).map(function (n) { return teamName(d, n); }); }
  function defaultAssignee(d) { var n = myName().split(/\s+/)[0]; return pick(d.team || [], n, (d.team || [])[0] || n); }

  var RUN = {
    get_overview: function () {
      var d = db(), t = today(), in7 = ymd(new Date(Date.now() + 7 * 864e5));
      var open = d.tasks.filter(function (x) { return x.status !== 'Completed'; });
      var unpaid = d.invoices.filter(function (x) { return x.status !== 'Paid'; });
      var stages = {}; d.leads.forEach(function (l) { stages[l.stage] = (stages[l.stage] || 0) + 1; });
      return {today: t, weekday: new Date().toLocaleDateString('en-GB', {weekday: 'long'}), signedInUser: myName(), team: d.team, partners: d.partners.map(function (p) { return p.name; }),
        counts: {clients: d.clients.length, activeClients: d.clients.filter(function (c) { return c.status === 'Active'; }).length, leads: d.leads.length, openTasks: open.length, quotations: d.quotations.length, agreements: d.agreements.length, invoices: d.invoices.length, receipts: d.receipts.length},
        leadPipeline: stages,
        overdueTasks: open.filter(function (x) { return x.dueDate && x.dueDate < t; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; }).slice(0, 20).map(function (x) { return brief(d, 'task', x); }),
        dueNext7Days: open.filter(function (x) { return x.dueDate && x.dueDate >= t && x.dueDate <= in7; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; }).slice(0, 20).map(function (x) { return brief(d, 'task', x); }),
        unpaidInvoices: unpaid.slice(0, 20).map(function (x) { return brief(d, 'invoice', x); }),
        unpaidTotal: unpaid.reduce(function (s, x) { return s + itemsTotal(x.items) + vatSum(x.items, x.vatRate); }, 0),
        serviceFollowUpsDue: (d.services || []).filter(function (s) { return s.status === 'Active' && s.nextDate && s.nextDate <= in7; }).slice(0, 20).map(function (x) { return brief(d, 'service', x); })};
    },
    search_records: function (a) {
      var d = db(), c = coll(a.type); if (!c) throw new Error('Unknown type');
      var q = lc(a.query), rows = (d[c.key] || []).slice();
      if (q) rows = rows.filter(function (x) {
        var hay = lc([x.name, x.title, x.invoiceNo, x.receiptNo, x.reference, x.refName, x.clientName, x.phone, x.email, x.contact, x.type, x.period, x.tradeLicence, x.trn, clientName(d, x.clientId), (x.services || []).join(' ')].join(' | '));
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (a.status) { var s = lc(a.status); rows = rows.filter(function (x) { return lc(x.stage || x.status) === s; }); }
      if (a.assigned_to) { var p = lc(a.assigned_to); rows = rows.filter(function (x) { return lc(x.assignedTo).indexOf(p) >= 0 || (x.assignees || []).some(function (n) { return lc(n).indexOf(p) >= 0; }) || (x.staff || []).some(function (n) { return lc(n).indexOf(p) >= 0; }); }); }
      if (a.client) { var cl = findOne(d, 'client', a.client); rows = rows.filter(function (x) { return x.clientId === cl.id || lc(x.clientName) === lc(cl.name) || lc(x.refName) === lc(cl.name); }); }
      var dateOf = function (x) { return c.type === 'task' ? x.dueDate : (c.type === 'service' ? x.nextDate : x.date); };
      if (a.date_from) rows = rows.filter(function (x) { return dateOf(x) && dateOf(x) >= a.date_from; });
      if (a.date_to) rows = rows.filter(function (x) { return dateOf(x) && dateOf(x) <= a.date_to; });
      var total = rows.length, lim = Math.min(+a.limit || 25, 60);
      return {total: total, showing: Math.min(total, lim), rows: rows.slice(0, lim).map(function (x) { return brief(d, c.type, x); })};
    },
    get_record: function (a) { var d = db(), c = coll(a.type); return brief(d, c.type, findOne(d, a.type, a.ref), true); },

    create_lead: function (a) {
      var d = db();
      var l = {id: uid('l'), name: String(a.name).trim(), stage: pick(LEAD_STAGES, a.stage, 'New'), source: pick(['Website', 'Referral', 'Walk-in', 'Social'], a.source, 'Website'), phone: a.phone || '-', email: a.email || '-', contact: a.contact || '-', address: a.address || '-',
        tradeLicence: a.trade_licence || '', services: arr(a.services), date: today(), assignedTo: a.assigned_to ? teamName(d, a.assigned_to) : defaultAssignee(d), notes: []};
      if (a.note) l.notes.unshift({by: myName(), at: shortDate(), text: a.note});
      d.leads.unshift(l); changed = true;
      return {ok: true, created: brief(d, 'lead', l)};
    },
    update_lead: function (a) {
      var d = db(), l = findOne(d, 'lead', a.ref);
      applyCommon(l, a, {name: 'name', phone: 'phone', email: 'email', contact: 'contact', address: 'address', trade_licence: 'tradeLicence', services: ['services', arr],
        stage: ['stage', function (v) { return pick(LEAD_STAGES, v, l.stage); }], source: ['source', function (v) { return pick(['Website', 'Referral', 'Walk-in', 'Social'], v, l.source); }], assigned_to: ['assignedTo', function (v) { return teamName(d, v); }]});
      if (a.note) { l.notes = l.notes || []; l.notes.unshift({by: myName(), at: shortDate(), text: a.note}); }
      if (a.note || a.stage) l.lastActivity = today();
      changed = true; return {ok: true, lead: brief(d, 'lead', l)};
    },
    convert_lead_to_client: function (a) {
      var d = db(), l = findOne(d, 'lead', a.ref);
      if (d.clients.some(function (c) { return lc(c.name) === lc(l.name); })) return {ok: false, error: 'A client named "' + l.name + '" already exists.'};
      var c = {id: uid('c'), name: l.name, status: 'Active', partnerId: 'p_un', email: l.email, phone: l.phone, services: l.services || [], vatCycle: 'Stagger 3', taxYearEnd: '2025-12-31', trn: '-', tradeLicence: l.tradeLicence || '', portalId: '', portalPassword: '', contractExpiry: '', address: l.address, staff: [], invoiced: 0, received: 0, ledger: [], notes: []};
      d.clients.unshift(c); l.stage = 'Closed'; changed = true;
      return {ok: true, client: brief(d, 'client', c)};
    },
    create_client: function (a) {
      var d = db();
      if (d.clients.some(function (c) { return lc(c.name) === lc(a.name); })) return {ok: false, error: 'A client with this name already exists.'};
      var p = a.partner ? (d.partners || []).find(function (x) { return lc(x.name).indexOf(lc(a.partner)) >= 0; }) : null;
      var c = {id: uid('c'), name: String(a.name).trim(), status: 'Active', partnerId: p ? p.id : 'p_un', email: a.email || '', phone: a.phone || '', services: arr(a.services), vatCycle: a.vat_cycle || 'Stagger 3', taxYearEnd: a.tax_year_end || '', trn: a.trn || '-',
        tradeLicence: a.trade_licence || '', portalId: '', portalPassword: '', contractExpiry: a.contract_expiry || '', address: a.address || '-', staff: teamList(d, a.staff), invoiced: 0, received: 0, ledger: [], notes: []};
      if (a.note) c.notes.unshift({by: myName(), text: a.note});
      d.clients.unshift(c); changed = true;
      return {ok: true, created: brief(d, 'client', c)};
    },
    update_client: function (a) {
      var d = db(), c = findOne(d, 'client', a.ref);
      applyCommon(c, a, {name: 'name', email: 'email', phone: 'phone', trn: 'trn', trade_licence: 'tradeLicence', address: 'address', tax_year_end: 'taxYearEnd', contract_expiry: 'contractExpiry',
        status: ['status', function (v) { return pick(['Active', 'Inactive'], v, c.status); }], vat_cycle: ['vatCycle', function (v) { return pick(['Monthly', 'Stagger 1', 'Stagger 2', 'Stagger 3'], v, c.vatCycle); }],
        services: ['services', arr], staff: ['staff', function (v) { return teamList(d, v); }]});
      if (a.partner) { var p = (d.partners || []).find(function (x) { return lc(x.name).indexOf(lc(a.partner)) >= 0; }); if (!p) throw new Error('No partner called "' + a.partner + '". Partners: ' + d.partners.map(function (x) { return x.name; }).join(', ')); c.partnerId = p.id; }
      if (a.note) { c.notes = c.notes || []; c.notes.unshift({by: myName(), text: a.note}); }
      changed = true; return {ok: true, client: brief(d, 'client', c)};
    },
    create_task: function (a) {
      var d = db(), cl = a.client ? findOne(d, 'client', a.client) : null;
      if (!isDate(a.due_date)) throw new Error('due_date must be YYYY-MM-DD');
      var t = {id: uid('t'), title: String(a.title).trim(), type: pick(['Task', 'Reminder', 'Meeting', 'Renewal'], a.type, 'Task'), status: 'Not Started', dueDate: a.due_date, recurrence: pick(['None', 'Weekly', 'Monthly', 'Quarterly', 'Annual'], a.recurrence, 'None'),
        priority: pick(['High', 'Medium', 'Low'], a.priority, 'Medium'), clientId: cl ? cl.id : null, assignees: a.assignees && arr(a.assignees).length ? teamList(d, a.assignees) : [defaultAssignee(d)], source: 'ai', checklist: arr(a.checklist), comments: [], createdBy: myName(), createdAt: today()};
      if (a.comment) t.comments.unshift({by: myName(), at: shortDate(), text: a.comment});
      if (a.time) t.time = String(a.time).slice(0, 5); if (a.location) t.location = a.location;
      d.tasks.unshift(t); changed = true;
      return {ok: true, created: brief(d, 'task', t)};
    },
    update_task: function (a) {
      var d = db(), t = findOne(d, 'task', a.ref), old = t.status;
      if (a.due_date && !isDate(a.due_date)) throw new Error('due_date must be YYYY-MM-DD');
      applyCommon(t, a, {title: 'title', type: 'type', due_date: 'dueDate', time: 'time', location: 'location', priority: ['priority', function (v) { return pick(['High', 'Medium', 'Low'], v, t.priority); }],
        status: ['status', function (v) { return pick(TASK_STATUSES, v, t.status); }], recurrence: ['recurrence', function (v) { return pick(['None', 'Weekly', 'Monthly', 'Quarterly', 'Annual'], v, t.recurrence); }], assignees: ['assignees', function (v) { return teamList(d, v); }]});
      if (a.comment) { t.comments = t.comments || []; t.comments.unshift({by: myName(), at: shortDate(), text: a.comment}); }
      var next = null;
      if (t.status === 'Completed' && old !== 'Completed' && t.recurrence && t.recurrence !== 'None') { var before = d.tasks.length; nextRecurring(d, t); if (d.tasks.length > before) next = brief(d, 'task', d.tasks[0]); }
      changed = true; return {ok: true, task: brief(d, 'task', t), nextRecurringTask: next || undefined};
    },
    create_invoice: function (a) {
      var d = db(), cl = findOne(d, 'client', a.client), inv = mkInvoice(d, cl.id);
      inv.items = (a.items || []).map(function (i) { return {desc: i.description || '', qty: i.quantity == null ? 1 : num(i.quantity), unit: num(i.unit_price), vat: pick(['standard', 'zero', 'exempt'], i.vat, 'standard')}; });
      if (!inv.items.length) inv.items = [{desc: '', qty: 1, unit: 0, vat: 'standard'}];
      if (isDate(a.date)) inv.date = a.date;
      if (isDate(a.due_date)) inv.dueDate = a.due_date;
      if (a.notes) inv.notes = a.notes;
      changed = true; return {ok: true, created: brief(d, 'invoice', inv)};
    },
    update_invoice: function (a) {
      var d = db(), v = findOne(d, 'invoice', a.ref);
      applyCommon(v, a, {status: ['status', function (s) { return pick(['Unpaid', 'Partial', 'Paid'], s, v.status); }], date: 'date', due_date: 'dueDate', notes: 'notes'});
      changed = true; return {ok: true, invoice: brief(d, 'invoice', v)};
    },
    create_receipt: function (a) {
      var d = db(), cl = findOne(d, 'client', a.client), rc = mkReceipt(d, cl.id);
      rc.amount = num(a.amount); rc.method = pick(['Cash', 'Online Transfer', 'CDC', 'PDC'], a.method, 'Online Transfer'); rc.isPDC = rc.method === 'PDC';
      if (isDate(a.date)) rc.date = a.date;
      ['reference', 'bank', 'notes'].forEach(function (k) { if (a[k]) rc[k] = a[k]; });
      if (a.cheque_no) rc.chequeNo = a.cheque_no;
      if (isDate(a.cheque_date)) rc.chequeDate = a.cheque_date;
      try { syncPdcTask(d, rc); } catch (e) {}
      changed = true; return {ok: true, created: brief(d, 'receipt', rc), pdcReminderTask: rc.taskId ? true : undefined};
    },
    create_quotation: function (a) {
      var d = db(), type = a.for_type === 'client' ? 'client' : 'lead', src = findOne(d, type, a.ref);
      var q = {id: uid('q'), title: 'Service Quotation', forType: type, refId: src.id, refName: src.name, clientLicence: src.tradeLicence || '', reference: a.reference || '', amount: 0, status: 'Draft', date: isDate(a.date) ? a.date : today(),
        intro: 'We are pleased to present this quotation for our below mentioned scope of services.', scope: [], items: [],
        closing: 'We look forward to working with you and assure you of our best service at all times.', signatory: 'Muhammad Asif Khan', signatoryTitle: 'Managing Director', email: (biz().email || 'asif@fairtaxint.com')};
      arr(a.scope_services).forEach(function (s) { var k = pick(Object.keys(SCOPE_CATALOG), s, null); if (k) q.scope.push({heading: k, items: SCOPE_CATALOG[k].slice()}); });
      q.items = (a.items || []).map(function (i) { return {desc: i.description || '', period: i.period || '', amount: num(i.amount)}; });
      if (!q.items.length) q.items = [{desc: '', period: '', amount: 0}];
      q.amount = itemsTotal(q.items);
      d.quotations.unshift(q); changed = true;
      return {ok: true, created: brief(d, 'quotation', q), tip: 'Open it with open_page if the user wants to review or print.'};
    },
    add_service: function (a) {
      var d = db(), cl = findOne(d, 'client', a.client), type = pick(SVC_TYPES, a.type, null);
      if (!type) throw new Error('Service type must be one of: ' + SVC_TYPES.join(', '));
      var s = createService(d, cl.id, type, a.period, isDate(a.start_date) ? a.start_date : today(), isDate(a.deadline) ? a.deadline : '');
      runServiceEngine(d); changed = true;
      return {ok: true, created: brief(d, 'service', s)};
    },
    service_followup: function (a) {
      var d = db(), s;
      try { s = findOne(d, 'service', a.ref); }
      catch (e) {
        var q = lc(a.ref), hits = (d.services || []).filter(function (x) { return x.status === 'Active' && q.split(/\s+/).every(function (w) { return lc(x.clientName + ' ' + x.type + ' ' + x.period).indexOf(w) >= 0; }); });
        if (hits.length !== 1) throw e; s = hits[0];
      }
      var r;
      if (a.action === 'complete') { svcComplete(d, s.id, a.note || ''); r = {completed: true}; }
      else if (a.action === 'set_next_date') { if (!isDate(a.next_date)) throw new Error('next_date must be YYYY-MM-DD'); r = svcSetDate(d, s.id, a.next_date, a.note || ''); }
      else r = svcSnooze(d, s.id, a.note || '');
      changed = true; return {ok: true, result: r, service: brief(d, 'service', s)};
    },
    log_client_contact: function (a) {
      var d = db(), c = findOne(d, 'client', a.client);
      if (window.CRMPLUS) CRMPLUS.logContact(d, c, a.type || 'call', a.note || '');
      else { c.lastContact = today(); c.notes = c.notes || []; c.notes.unshift({by: myName(), text: (a.type || 'call') + (a.note ? ': ' + a.note : '')}); }
      c.nextContact = a.next_in_days ? ymd(new Date(Date.now() + a.next_in_days * 864e5)) : '';
      changed = true; return {ok: true, client: c.name, lastContact: c.lastContact, nextContact: c.nextContact || 'normal schedule'};
    },
    assign_client: function (a) {
      var d = db(), c = findOne(d, 'client', a.client);
      if (a.auto || !arr(a.staff).length) {
        var n = window.CRMPLUS ? CRMPLUS.autoAssign(d, c, true) : null;
        if (!n) return {ok: false, error: 'No staff member has matching expertise. The admin can add expertise in Users & access.'};
        changed = true; return {ok: true, assigned: c.staff, reason: c.assignedNote};
      }
      c.staff = teamList(d, a.staff); c.assignedBy = 'manual';
      d.tasks.forEach(function (t) { if (t.clientId === c.id && t.status !== 'Completed' && !(t.assignees || []).length) t.assignees = c.staff.slice(0, 1); });
      changed = true; return {ok: true, assigned: c.staff};
    },
    set_client_schedule: function (a) {
      var d = db(), c = findOne(d, 'client', a.client); c.plan = c.plan || {};
      var setp = function (k, v) { if (v === undefined || v === null) return; if (v === 0 || v === 'auto' || v === '') delete c.plan[k]; else c.plan[k] = v; };
      setp('healthDays', a.check_in_days); setp('bookkeeping', a.bookkeeping); setp('fsMonths', a.fs_months); setp('auditMonths', a.audit_months); setp('missingDays', a.missing_days);
      d.engineRunOn = '';
      changed = true; return {ok: true, client: c.name, schedule: window.FTReminders ? FTReminders.planOf(c, FTReminders.policyOf(d)) : c.plan};
    },
    get_reminders: function (a) {
      if (!window.CRMPLUS) return {ok: false, error: 'Reminders are not available'};
      var list = CRMPLUS.reminders(!!a.everyone, Math.min(+a.days || 7, 30));
      if (a.kind) list = list.filter(function (r) { return r.kind === a.kind; });
      return {count: list.length, reminders: list.slice(0, 80).map(function (r) { return {when: r.at.toLocaleString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}), kind: r.kind, title: r.title, detail: r.body}; })};
    },
    delete_record: async function (a) {
      var d = db(), c = coll(a.type), x = findOne(d, a.type, a.ref);
      var label = x.name || x.title || x.invoiceNo || x.receiptNo || x.reference || x.refName || x.clientName || x.id;
      var yes = await UI.confirm('Delete ' + c.type + ' “' + label + '”?');
      if (!yes) return {ok: false, cancelled: true, message: 'The user did not confirm, nothing was deleted.'};
      if (x.taskId) d.tasks = d.tasks.filter(function (t) { return t.id !== x.taskId; });
      d[c.key] = d[c.key].filter(function (y) { return y.id !== x.id; });
      changed = true; return {ok: true, deleted: label};
    },
    open_page: function (a) {
      var d = db(), p = lc(a.page).trim();
      var lists = ['dashboard', 'leads', 'clients', 'tasks', 'quotations', 'agreements', 'invoices', 'receipts', 'payments', 'retention', 'settings'];
      if (a.ref && coll(p)) { var c = coll(p); if (c.type === 'service') { var sv = findOne(d, 'service', a.ref); goto('#/client/' + sv.clientId); return {ok: true}; } var x = findOne(d, c.type, a.ref); goto('#/' + c.type + '/' + x.id); return {ok: true, opened: c.type}; }
      var l = pick(lists, p.replace(/^invoice$/, 'invoices'), null) || (coll(p) ? coll(p).key : null);
      if (!l || lists.indexOf(l) < 0) l = 'dashboard';
      goto('#/' + l); return {ok: true, opened: l};
    }
  };

  /* ---------------- Claude ---------------- */
  var history = [];      // Messages API history for this browser tab
  var busy = false, stopFlag = false;
  var shared = null;
  async function keyAndModel() {
    if (shared === null) { shared = (window.FT && FT.getAi) ? await FT.getAi().catch(function () { return {}; }) : {}; }
    var own = '', audit = '';
    try { own = localStorage.getItem(OWN_KEY) || ''; audit = localStorage.getItem(AUDIT_KEY) || ''; } catch (e) {}
    var key = own || shared.key || audit;
    return {key: key, source: own ? 'your own key' : (shared.key ? 'the company key set by the admin' : (audit ? 'the key saved in Audit Desk on this computer' : '')),
      model: prefs().model || shared.model || DEFAULT_MODEL};
  }
  function systemPrompt() {
    var d = db(), m = me();
    return 'You are the AI assistant built into the CRM of ' + (biz().name || 'Fair Tax International FZC') + ', a UAE accounting, VAT, corporate tax and audit firm. ' +
      'You work for the signed-in user and carry out their instructions in the CRM using the tools.\n' +
      'Today is ' + today() + ' (' + new Date().toLocaleDateString('en-GB', {weekday: 'long'}) + '). Signed-in user: ' + myName() + (m.role ? ' (' + m.role + ')' : '') + '.\n' +
      'Team members: ' + (d.team || []).join(', ') + '. Partners: ' + (d.partners || []).map(function (p) { return p.name; }).join(', ') + '.\n' +
      'Lead stages: ' + LEAD_STAGES.join(', ') + '. Task statuses: ' + TASK_STATUSES.join(', ') + '. Service types: ' + SVC_TYPES.join(', ') + '. Currency: AED; standard VAT 5%.\n' +
      'Rules:\n' +
      '- Never invent ids, names or amounts. Look records up with search_records / get_record first when you are not sure which one is meant.\n' +
      '- Resolve relative dates ("tomorrow", "next Friday", "end of month") from today and use YYYY-MM-DD.\n' +
      '- If an instruction could match several records, or an essential detail (like an amount) is missing, ask one short question instead of guessing.\n' +
      '- When the user speaks, the text comes from voice recognition and may contain misheard words or company names – match them sensibly to existing records.\n' +
      '- You may do several steps for one instruction (e.g. find the client, create the task, add a comment).\n' +
      '- After changes, reply with a short confirmation of exactly what you did (names, dates, amounts). Keep every reply brief and plain – it may be read aloud. Use simple lists only when listing several items.\n' +
      '- Reply in the language the user used.\n' +
      '- Deleting needs the user to confirm on screen; the delete_record tool handles that.\n' +
      '- Do not show or repeat client portal passwords.\n' +
      '- Reminders: leads are nudged every few hours until contact is logged (update_lead with a note); clients need a check-in every few days (log_client_contact); meetings should have a time (create_task type Meeting with time).';
  }
  async function callClaude(km, messages) {
    var res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {method: 'POST',
        headers: {'content-type': 'application/json', 'x-api-key': km.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
        body: JSON.stringify({model: km.model, max_tokens: 2500, system: systemPrompt(), tools: TOOLS, messages: messages})});
    } catch (e) { throw new Error('Could not reach Claude – check the internet connection.'); }
    var body = null; try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      var msg = (body && body.error && body.error.message) || res.statusText;
      if (res.status === 401) throw new Error('The Claude API key is not valid. Open ⚙ settings to add a correct key.');
      if (res.status === 404 && /model/i.test(msg)) throw new Error('This Claude model is not available for the key. Choose another model in ⚙ settings.');
      if (res.status === 429) throw new Error('Claude is busy or the account limit was reached – try again in a minute.');
      if (/credit|billing|balance/i.test(msg)) throw new Error('The Anthropic account has no credit – add credit at console.anthropic.com.');
      throw new Error('Claude error: ' + msg);
    }
    return body;
  }
  function trimHistory() {
    // keep the conversation small: cut at a plain user message
    while (history.length > 40) {
      var i = 1;
      while (i < history.length && !(history[i].role === 'user' && typeof history[i].content === 'string')) i++;
      if (i >= history.length) break;
      history = history.slice(i);
    }
  }
  var LABEL = {create_lead: 'Lead added', update_lead: 'Lead updated', convert_lead_to_client: 'Converted to client', create_client: 'Client added', update_client: 'Client updated', create_task: 'Task created', update_task: 'Task updated',
    log_client_contact: 'Contact logged', assign_client: 'Client assigned', set_client_schedule: 'Schedule updated', create_invoice: 'Invoice created', update_invoice: 'Invoice updated', create_receipt: 'Receipt recorded', create_quotation: 'Quotation drafted', add_service: 'Service added', service_followup: 'Service follow-up logged', delete_record: 'Deleted', open_page: 'Opened'};
  function actionText(name, input, out) {
    if (!LABEL[name] || !out || out.ok === false) return '';
    var o = out.created || out.task || out.lead || out.client || out.invoice || out.service || {};
    var what = o.name || o.title || o.invoiceNo || o.receiptNo || o.reference || o.type || out.deleted || out.opened || input.ref || input.client || '';
    return LABEL[name] + (what ? ': ' + what : '');
  }

  async function ask(text, spoken) {
    text = String(text || '').trim();
    if (!text || busy) return;
    var km = await keyAndModel();
    UI.add('user', text);
    if (!km.key) { UI.add('error', 'No Claude API key yet. Ask the admin to add the company key (Dashboard → Users & access), or add your own key in ⚙ settings.'); UI.settings(true); return; }
    busy = true; stopFlag = false; UI.busy(true);
    var snapshot = JSON.stringify(db()), actions = [], startLen = history.length;
    changed = false;
    history.push({role: 'user', content: text});
    try {
      for (var step = 0; step < 12; step++) {
        if (stopFlag) break;
        var r = await callClaude(km, history);
        history.push({role: 'assistant', content: r.content});
        var said = (r.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
        var uses = (r.content || []).filter(function (b) { return b.type === 'tool_use'; });
        if (said && uses.length) UI.add('thinking', said);
        if (r.stop_reason !== 'tool_use' || !uses.length) {
          if (said) { UI.add('assistant', said); if (spoken || prefs().speakAll) Voice.say(said); }
          break;
        }
        var results = [];
        for (var i = 0; i < uses.length; i++) {
          var u = uses[i], out;
          UI.status(u.name.replace(/_/g, ' ') + '…');
          try {
            if (!RUN[u.name]) throw new Error('Unknown tool');
            out = await RUN[u.name](u.input || {});
          } catch (e) { out = {ok: false, error: e.message || String(e)}; }
          var at = actionText(u.name, u.input || {}, out); if (at) actions.push(at);
          results.push({type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000), is_error: out && out.ok === false && !!out.error});
        }
        history.push({role: 'user', content: results});
        if (step === 11) UI.add('assistant', 'I stopped after many steps – please tell me what to do next.');
      }
    } catch (e) {
      // drop the unfinished turn so the conversation stays valid
      history = history.slice(0, startLen);
      if (changed) {
        history.push({role: 'user', content: text});
        history.push({role: 'assistant', content: [{type: 'text', text: '(Stopped by an error after making some changes: ' + actions.join('; ') + ')'}]});
      }
      UI.add('error', e.message || String(e));
    } finally {
      if (changed) {
        try { save(); } catch (e) {}
        try { route(); } catch (e) {}
      }
      var dataActions = actions.filter(function (a) { return !/^Opened/.test(a); });
      if (changed && dataActions.length) UI.actions(dataActions, snapshot);
      trimHistory();
      busy = false; UI.busy(false); UI.status('');
      if (Voice.conversation && spoken) Voice.resumeAfterSpeech();
    }
  }
  function undo(snapshot) {
    var d = db(), snap = JSON.parse(snapshot);
    Object.keys(d).forEach(function (k) { delete d[k]; });
    Object.assign(d, snap);
    save(); route();
    history.push({role: 'user', content: '(The user pressed Undo: all changes from your last reply were reverted.)'});
    history.push({role: 'assistant', content: [{type: 'text', text: 'Understood – those changes were undone.'}]});
  }

  /* ---------------- voice ---------------- */
  var Voice = {
    rec: null, listening: false, conversation: false, finalText: '',
    supported: function () { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    start: function () {
      if (!Voice.supported()) { UI.add('error', 'Voice typing needs Google Chrome or Microsoft Edge.'); return; }
      if (Voice.listening || busy) return;
      try { speechSynthesis.cancel(); } catch (e) {}
      var R = window.SpeechRecognition || window.webkitSpeechRecognition, rec = new R();
      rec.lang = prefs().lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      Voice.finalText = ''; Voice.rec = rec;
      var input = $('#cai-input'), base = input.value ? input.value.trim() + ' ' : '';
      rec.onresult = function (ev) {
        var fin = '', interim = '';
        for (var i = 0; i < ev.results.length; i++) { if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript; }
        Voice.finalText = fin; input.value = base + fin + interim; UI.grow();
      };
      rec.onerror = function (ev) {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') UI.add('error', 'Microphone permission is blocked. Click the lock icon in the address bar and allow the microphone.');
        else if (ev.error === 'no-speech') { if (!Voice.conversation) UI.status('Did not hear anything.'); }
        else if (ev.error !== 'aborted') UI.add('error', 'Voice error: ' + ev.error);
        if (ev.error !== 'no-speech') Voice.conversation = false;
      };
      rec.onend = function () {
        Voice.listening = false; UI.mic(false);
        var t = input.value.trim();
        if (Voice.finalText && t && prefs().autoSend) { input.value = ''; UI.grow(); ask(t, true); }
        else if (Voice.conversation && !t) { setTimeout(function () { if (Voice.conversation && !busy) Voice.start(); }, 400); }
      };
      try { rec.start(); Voice.listening = true; UI.mic(true); UI.status('Listening… speak now'); } catch (e) { UI.add('error', 'Could not start the microphone: ' + e.message); }
    },
    stop: function () { Voice.conversation = false; if (Voice.rec) try { Voice.rec.stop(); } catch (e) {} },
    voiceFor: function (lang) {
      var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [], base = lang.split('-')[0];
      return vs.find(function (v) { return v.lang === lang; }) || vs.find(function (v) { return v.lang && v.lang.indexOf(base) === 0; }) || null;
    },
    say: function (text) {
      if (!prefs().speak || !window.speechSynthesis) return;
      var clean = String(text).replace(/[*_#`>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n+/g, '. ').slice(0, 1500);
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(clean), lang = /[؀-ۿ]/.test(clean) ? (prefs().lang.indexOf('ur') === 0 ? 'ur-PK' : 'ar-AE') : (/[ऀ-ॿ]/.test(clean) ? 'hi-IN' : 'en-GB');
        u.lang = lang; var v = Voice.voiceFor(lang); if (v) u.voice = v; u.rate = 1.03;
        Voice.speaking = true;
        u.onend = u.onerror = function () { Voice.speaking = false; if (Voice.pendingResume) { Voice.pendingResume = false; setTimeout(function () { if (Voice.conversation && !busy) Voice.start(); }, 250); } };
        speechSynthesis.speak(u);
      } catch (e) {}
    },
    resumeAfterSpeech: function () {
      if (!Voice.conversation) return;
      if (Voice.speaking || (window.speechSynthesis && speechSynthesis.speaking)) Voice.pendingResume = true;
      else setTimeout(function () { if (Voice.conversation && !busy) Voice.start(); }, 300);
    }
  };

  /* ---------------- panel ---------------- */
  var CSS = '#cai-fab{position:fixed;right:18px;bottom:18px;z-index:99990;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:linear-gradient(135deg,#0f9d6b,#0b5c9c);color:#fff;font:700 14px/1 Inter,"Segoe UI",system-ui,sans-serif;box-shadow:0 10px 28px rgba(11,92,156,.35);cursor:pointer}' +
    '#cai-fab:hover{filter:brightness(1.07)}#cai-fab svg{width:18px;height:18px}' +
    '#cai{position:fixed;right:18px;bottom:18px;z-index:99991;width:410px;max-width:calc(100vw - 24px);height:min(640px,calc(100vh - 36px));display:none;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 24px 60px rgba(16,24,40,.28);font:14px/1.45 Inter,"Segoe UI",system-ui,sans-serif;color:#111827;overflow:hidden}' +
    '#cai.open{display:flex}#cai *{box-sizing:border-box}' +
    '#cai .hd{display:flex;align-items:center;gap:8px;padding:12px 12px 12px 16px;background:linear-gradient(135deg,#0f9d6b,#0b5c9c);color:#fff}#cai .hd b{flex:1;font-size:15px}#cai .hd small{display:block;font-weight:500;opacity:.85;font-size:11.5px}' +
    '#cai .ib{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:15px;display:grid;place-items:center}#cai .ib:hover{background:rgba(255,255,255,.26)}' +
    '#cai .body{flex:1;overflow:auto;padding:14px;background:#f7f9fb;display:flex;flex-direction:column;gap:10px}' +
    '#cai .m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}#cai .m.user{align-self:flex-end;background:#0b5c9c;color:#fff;border-bottom-right-radius:4px}' +
    '#cai .m.assistant{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}#cai .m.thinking{align-self:flex-start;color:#6b7280;font-size:12.5px;padding:2px 4px;background:none}' +
    '#cai .m.error{align-self:stretch;background:#fee2e2;color:#991b1b;font-size:13px}#cai .acts{align-self:stretch;background:#e7f6ef;border:1px solid #bfe6d3;border-radius:12px;padding:8px 10px;font-size:13px;color:#0b7e55}' +
    '#cai .acts div{margin:2px 0}#cai .acts button,#cai .conf button{border:1px solid #0f9d6b;background:#fff;color:#0b7e55;border-radius:8px;padding:4px 10px;font-weight:600;cursor:pointer;margin-top:6px;margin-right:6px}' +
    '#cai .conf{align-self:stretch;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px;font-size:13.5px}#cai .conf .del{border-color:#dc2626;color:#dc2626}' +
    '#cai .hint{color:#6b7280;font-size:13px}#cai .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}#cai .chips button{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:6px 10px;font-size:12.5px;cursor:pointer;text-align:left}#cai .chips button:hover{border-color:#0f9d6b;color:#0b7e55}' +
    '#cai .st{min-height:18px;padding:0 14px;font-size:12px;color:#6b7280;background:#f7f9fb}' +
    '#cai .ft{display:flex;align-items:flex-end;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}#cai textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font:inherit;max-height:120px;min-height:40px;outline:none}#cai textarea:focus{border-color:#0f9d6b}' +
    '#cai .rb{border:0;border-radius:10px;width:40px;height:40px;cursor:pointer;display:grid;place-items:center;font-size:17px;flex:none}#cai .send{background:#0f9d6b;color:#fff}#cai .send:disabled{opacity:.5}#cai .mic{background:#eef2f7;color:#0b5c9c}#cai .mic.on{background:#dc2626;color:#fff;animation:caipulse 1.2s infinite}' +
    '#cai .conv{background:#eef2f7;color:#0b5c9c;font-size:12px;width:auto;padding:0 10px;font-weight:600}#cai .conv.on{background:#0b5c9c;color:#fff}' +
    '@keyframes caipulse{0%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}70%{box-shadow:0 0 0 10px rgba(220,38,38,0)}100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}}' +
    '#cai .set{position:absolute;inset:66px 0 0 0;background:#fff;padding:16px;overflow:auto;display:none}#cai .set.open{display:block}#cai .set label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}#cai .set input[type=password],#cai .set select{width:100%;border:1px solid #d1d5db;border-radius:8px;padding:8px}' +
    '#cai .set .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}#cai .set .btn{border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer}#cai .set .btn.p{background:#0f9d6b;border-color:#0f9d6b;color:#fff}' +
    '#cai .set .chk{display:flex;align-items:center;gap:8px;font-weight:500;margin-top:10px}#cai .note{font-size:12px;color:#6b7280;margin-top:6px}' +
    '@media (max-width:840px){#cai{bottom:64px;height:min(640px,calc(100vh - 76px))}#cai-fab{bottom:64px}}@media (max-width:520px){#cai{right:6px;left:6px;width:auto;max-width:none;height:calc(100vh - 72px)}#cai-fab{right:10px}}';

  function md(text) {
    var h = esc(text);
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\n)\s*[-•]\s+/g, '$1• ').replace(/(^|\n)#+\s*/g, '$1');
    return h;
  }
  var UI = {
    root: null,
    build: function () {
      var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      var fab = document.createElement('button'); fab.id = 'cai-fab'; fab.type = 'button'; fab.title = 'AI assistant (Ctrl + /)';
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM6 15l.7 2 2 .7-2 .7L6 20.5l-.7-2.1-2-.7 2-.7L6 15z"/></svg>AI Assistant';
      document.body.appendChild(fab);
      var p = document.createElement('div'); p.id = 'cai'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'CRM AI assistant');
      p.innerHTML = '<div class="hd"><div style="flex:1"><b>AI Assistant</b><small>Type or speak – e.g. “add a follow-up call with Rio Trading on Monday”</small></div>' +
        '<button class="ib" data-c="clear" title="New conversation">⟲</button><button class="ib" data-c="settings" title="Settings">⚙</button><button class="ib" data-c="close" title="Close">✕</button></div>' +
        '<div class="body" id="cai-body"></div><div class="st" id="cai-st"></div>' +
        '<div class="ft"><button class="rb conv" data-c="conv" title="Hands-free: talk back and forth">Talk</button><button class="rb mic" data-c="mic" title="Speak an instruction">🎤</button>' +
        '<textarea id="cai-input" rows="1" placeholder="Ask or instruct… (Enter to send)"></textarea><button class="rb send" data-c="send" title="Send">➤</button></div>' +
        '<div class="set" id="cai-set"></div>';
      document.body.appendChild(p);
      UI.root = p;
      fab.onclick = function () { UI.open(true); };
      p.addEventListener('click', function (e) {
        var b = e.target.closest('[data-c]'); if (!b) return;
        var c = b.getAttribute('data-c');
        if (c === 'close') { if (EMBED) { Voice.stop(); toParent({type: 'close'}); } else UI.open(false); }
        else if (c === 'settings') UI.settings(!$('#cai-set').classList.contains('open'));
        else if (c === 'clear') { if (busy) { stopFlag = true; return; } history = []; $('#cai-body').innerHTML = ''; UI.welcome(); }
        else if (c === 'send') { var t = $('#cai-input').value; $('#cai-input').value = ''; UI.grow(); ask(t, false); }
        else if (c === 'mic') { if (Voice.listening) Voice.stop(); else { Voice.conversation = false; UI.conv(false); Voice.start(); } }
        else if (c === 'conv') { if (Voice.conversation) { Voice.stop(); UI.conv(false); try { speechSynthesis.cancel(); } catch (e2) {} } else { Voice.conversation = true; UI.conv(true); setPref('speak', true); Voice.start(); } }
        else if (c === 'chip') { ask(b.textContent, false); }
      });
      var input = $('#cai-input');
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); var t = input.value; input.value = ''; UI.grow(); ask(t, false); } });
      input.addEventListener('input', UI.grow);
      document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); UI.open(!p.classList.contains('open')); } if (e.key === 'Escape' && p.classList.contains('open') && !$('.modal')) UI.open(false); });
      if (window.speechSynthesis) try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}
      UI.welcome();
    },
    open: function (on) {
      UI.root.classList.toggle('open', on); $('#cai-fab').style.display = on ? 'none' : '';
      if (on) setTimeout(function () { $('#cai-input').focus(); }, 50); else { Voice.stop(); UI.conv(false); }
    },
    welcome: function () {
      var w = document.createElement('div'); w.className = 'm assistant';
      w.innerHTML = 'Hello ' + esc(myName().split(/\s+/)[0]) + '. Tell me what to do in the CRM – by typing or with the 🎤 microphone. <span class="hint">“Talk” keeps listening so you can speak back and forth.</span>' +
        '<div class="chips">' + ['What is overdue today?', 'Which invoices are unpaid?', 'Add a lead: Rio Trading, phone 0501234567, from referral', 'Create a VAT return reminder for Power Poles due on the 28th, high priority', 'Mark the latest Power Poles VAT task as completed']
          .map(function (s) { return '<button data-c="chip">' + esc(s) + '</button>'; }).join('') + '</div>';
      $('#cai-body').appendChild(w);
    },
    add: function (role, text) {
      var el = document.createElement('div'); el.className = 'm ' + role;
      if (role === 'assistant') el.innerHTML = md(text); else el.textContent = text;
      $('#cai-body').appendChild(el); UI.scroll();
    },
    actions: function (list, snapshot) {
      var el = document.createElement('div'); el.className = 'acts';
      el.innerHTML = list.map(function (a) { return '<div>✓ ' + esc(a) + '</div>'; }).join('') + '<button type="button">Undo</button>';
      el.querySelector('button').onclick = function () { undo(snapshot); el.innerHTML = '<div>↺ Changes undone</div>'; };
      $('#cai-body').appendChild(el); UI.scroll();
    },
    confirm: function (question) {
      return new Promise(function (res) {
        var el = document.createElement('div'); el.className = 'conf';
        el.innerHTML = '<div>' + esc(question) + '</div><button type="button" class="del">Yes, delete</button><button type="button">Cancel</button>';
        var bs = el.querySelectorAll('button');
        bs[0].onclick = function () { el.innerHTML = '<div>Deleted after your confirmation.</div>'; res(true); };
        bs[1].onclick = function () { el.innerHTML = '<div>Delete cancelled.</div>'; res(false); };
        $('#cai-body').appendChild(el); UI.scroll();
        Voice.say(question + ' Please confirm on the screen.');
      });
    },
    scroll: function () { var b = $('#cai-body'); b.scrollTop = b.scrollHeight; },
    status: function (t) { $('#cai-st').textContent = t || ''; },
    busy: function (on) { $('.send', UI.root).disabled = on; if (on) UI.status('Thinking…'); },
    mic: function (on) { $('.mic', UI.root).classList.toggle('on', on); if (!on && !busy) UI.status(''); },
    conv: function (on) { $('.conv', UI.root).classList.toggle('on', on); },
    grow: function () { var t = $('#cai-input'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; },
    settings: async function (on) {
      var box = $('#cai-set'); box.classList.toggle('open', on); if (!on) return;
      shared = null;
      var km = await keyAndModel(), p = prefs(), own = ''; try { own = localStorage.getItem(OWN_KEY) || ''; } catch (e) {}
      box.innerHTML = '<b style="font-size:15px">Assistant settings</b>' +
        '<p class="note">' + (km.key ? 'Using ' + esc(km.source) + ' (…' + esc(km.key.slice(-4)) + ').' : 'No Claude API key available yet.') + '</p>' +
        '<label for="cai-key">Your own Claude API key (optional, only on this computer)</label><input type="password" id="cai-key" autocomplete="off" placeholder="' + (own ? 'saved – type a new key to replace' : 'sk-ant-…') + '">' +
        '<div class="row"><button class="btn p" data-s="savekey">Save key</button>' + (own ? '<button class="btn" data-s="delkey">Remove my key</button>' : '') + '</div>' +
        '<p class="note">Without your own key the assistant uses the company key the admin saved. Keys: console.anthropic.com → API keys.</p>' +
        '<label for="cai-model">Model</label><select id="cai-model"><option value="">Company default</option>' + MODELS.map(function (m) { return '<option value="' + m[0] + '"' + (p.model === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
        '<label for="cai-lang">Voice language (what you speak)</label><select id="cai-lang">' + LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (p.lang === l[0] ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('') + '</select>' +
        '<label class="chk"><input type="checkbox" id="cai-speak"' + (p.speak ? ' checked' : '') + '> Read replies aloud after I speak</label>' +
        '<label class="chk"><input type="checkbox" id="cai-speakall"' + (p.speakAll ? ' checked' : '') + '> Also read replies aloud when I type</label>' +
        '<label class="chk"><input type="checkbox" id="cai-auto"' + (p.autoSend ? ' checked' : '') + '> Send automatically when I stop speaking</label>' +
        '<p class="note">Voice typing uses the browser’s speech service (Chrome or Edge). Allow the microphone when asked.</p>' +
        '<div class="row"><button class="btn" data-s="done">Done</button></div>';
      box.onclick = function (e) {
        var s = e.target.getAttribute && e.target.getAttribute('data-s'); if (!s) return;
        if (s === 'savekey') { var k = $('#cai-key').value.trim(); if (!/^sk-ant-/.test(k)) { $('#cai-key').focus(); $('#cai-key').placeholder = 'The key starts with sk-ant-'; return; } try { localStorage.setItem(OWN_KEY, k); } catch (e2) {} UI.settings(true); }
        if (s === 'delkey') { try { localStorage.removeItem(OWN_KEY); } catch (e2) {} UI.settings(true); }
        if (s === 'done') UI.settings(false);
      };
      box.onchange = function (e) {
        var id = e.target.id;
        if (id === 'cai-model') setPref('model', e.target.value);
        if (id === 'cai-lang') setPref('lang', e.target.value);
        if (id === 'cai-speak') setPref('speak', e.target.checked);
        if (id === 'cai-speakall') setPref('speakAll', e.target.checked);
        if (id === 'cai-auto') setPref('autoSend', e.target.checked);
      };
    }
  };

  /* ---------------- start ---------------- */
  function ready() { return typeof load === 'function' && typeof save === 'function' && typeof route === 'function'; }
  var EMBED_CSS = 'html,body{background:transparent!important;overflow:hidden!important}body.ft-embed>*:not(#cai):not(style):not(script){display:none!important}' +
    '#cai{inset:0!important;width:100%!important;max-width:none!important;height:100%!important;border-radius:0!important;border:0!important;box-shadow:none!important;display:flex!important}#cai-fab{display:none!important}';
  function start() {
    if (!ready()) { console.warn('CRM AI: CRM functions not found'); return; }
    UI.build();
    if (EMBED) {
      document.body.classList.add('ft-embed');
      var st = document.createElement('style'); st.textContent = EMBED_CSS; document.head.appendChild(st);
      UI.open(true);
      $('#cai .hd small').textContent = 'Works on your CRM from any page – type or speak';
      window.addEventListener('message', function (ev) {
        if (ev.origin !== location.origin || !ev.data || !ev.data.ft) return;
        var d = ev.data;
        if (d.type === 'focus') setTimeout(function () { $('#cai-input').focus(); }, 30);
        if (d.type === 'ask' && d.text) ask(d.text, !!d.spoken);
        if (d.type === 'voice') { Voice.conversation = false; Voice.start(); }
        if (d.type === 'talk') { Voice.conversation = true; UI.conv(true); setPref('speak', true); Voice.start(); }
        if (d.type === 'stop') { Voice.stop(); UI.conv(false); }
      });
      toParent({type: 'ready'});
    }
  }
  window.CRMAI = {ask: ask, tools: TOOLS, run: RUN, open: function () { UI.open(true); }, embed: EMBED, _history: function () { return history; }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
