/* ===================== Employees — UAE information & documents (FEATURES_SPEC 2) =====================
   The employee form becomes a sectioned native form (the Form Designer path for employees is not
   used any more; records saved by it keep every field, see _applyDesignedToNative below):

     Personal · Employment (incl. Employee type "Company Driver", contract, probation) ·
     UAE documents (Passport, Emirates ID, Residence visa, Labour card / work permit, Medical
     insurance — number, issue date, expiry) · Driving licence (+ assigned vehicle, Salik tag;
     required for Company Drivers) · Bank & WPS · Leave & end of service · Pay setup (Payslip
     Items, read by js/payroll.js) · Document attachments (b.attachments, with an expiry each).

   Values are flat keys on the employee record (passportNo, passportExpiry, eidNo, ...), so Edit
   columns, Advanced queries, sorting and batch import pick them up; pay setup is rec.pay and
   attachments rec.docs = [{id, name, number, expiry, attId}].

   Employees list: Edit columns offers every field, expiry columns are coloured (expired / due
   within 30 days), and a "Document expiries" panel lists what needs renewing. Reminders source
   "employee-docs" (window.Reminders, guarded) warns 30 days before and on / after every expiry,
   contract end and probation end.
   ================================================================================ */
(function (global) {
  'use strict';
  function app() { try { return App; } catch (e) { return global.App || null; } }
  function reg() { try { return REG; } catch (e) { return global.REG || {}; } }
  function l2k() { try { return LABEL2KEY; } catch (e) { return global.LABEL2KEY || {}; } }
  function G(n) { try { return global[n]; } catch (e) { return undefined; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v).replace(/,/g, '').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
  function r2(v) { return Math.round(((Number(v) || 0) + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function doc() { return global.document; }
  function byId(id) { var d = doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function money(v) { var A = app(); try { return A.money(v); } catch (e) { return r2(v).toFixed(2); } }
  function fmtD(v) { var A = app(); try { return A.fmtDate ? A.fmtDate(v) : v; } catch (e) { return v; } }
  function recs(b, key) { return ((b && b.records) || {})[key] || []; }
  function toast(m) { var A = app(); try { if (A && A.toast) A.toast(m); else if (global.UIModal && UIModal.toast) UIModal.toast(m); } catch (e) {} }
  function say(m) { try { if (global.UIModal && UIModal.alert) return UIModal.alert(m); } catch (e) {} try { global.alert(m); } catch (e) {} }

  var EU = {};
  EU._today = null;
  function today() { if (EU._today) return EU._today; var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(iso) { var p = String(iso || '').slice(0, 10).split('-'); if (p.length !== 3) return NaN; return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }
  function daysUntil(iso, now) { return Math.round(dayNum(iso) - dayNum(now || today())); }
  var LEAD = 30;

  /* ------------------------------------------------------------- the fields */
  var TYPES = ['Staff', 'Labour', 'Company Driver', 'Manager', 'Part-time', 'Other'];
  var STATUSES = ['Active', 'On leave', 'Resigned', 'Terminated'];
  var METHODS = ['Bank transfer (WPS)', 'Exchange house (WPS)', 'Cash', 'Cheque'];
  var NATIONS = ['United Arab Emirates', 'India', 'Pakistan', 'Bangladesh', 'Philippines', 'Nepal', 'Sri Lanka', 'Egypt', 'Jordan', 'Syria', 'Lebanon', 'Sudan', 'Yemen', 'Afghanistan', 'Nigeria', 'Kenya', 'Uganda', 'Ethiopia', 'Indonesia', 'China', 'United Kingdom', 'United States'];
  var DL_CATS = ['Light vehicle', 'Heavy vehicle', 'Light bus', 'Heavy bus', 'Motorcycle', 'Forklift', 'Light + Heavy'];
  function F(key, label, type, o) { o = o || {}; o.key = key; o.label = label; o.type = type || 'text'; return o; }
  var SECTIONS = [
    { id: 'personal', title: 'Personal', open: 1, fields: [F('name', 'Name', 'text', { req: 1 }), F('code', 'Code', 'text', { ph: 'Optional' }), F('nationality', 'Nationality', 'text', { list: 'euNations' }),
      F('dob', 'Date of birth', 'date'), F('gender', 'Gender', 'select', { opts: ['', 'Male', 'Female'] }), F('phone', 'Mobile', 'tel'), F('email', 'Email', 'email'), F('address', 'Address', 'textarea', { w: 2 })] },
    { id: 'employment', title: 'Employment', open: 1, fields: [F('designation', 'Designation'), F('department', 'Department'), F('empType', 'Employee type', 'select', { opts: [''].concat(TYPES) }), F('isDriver', 'Is driver', 'checkbox', { hint: 'Listed as a driver in Trips and Diesel (also: type Company Driver, or designation Driver).' }),
      F('status', 'Status', 'select', { opts: STATUSES }), F('joinDate', 'Joining date', 'date'), F('leaveDate', 'Leaving date', 'date', { cls: 'eu-if-left' }),
      F('contractType', 'Contract type', 'select', { opts: ['', 'Limited', 'Unlimited'] }), F('contractExpiry', 'Contract expiry', 'date', { exp: 'Contract' }), F('probationEnd', 'Probation end', 'date', { exp: 'Probation' }),
      F('workLocation', 'Work location'), F('lineManager', 'Line manager', 'text', { list: 'euManagers' })] },
    { id: 'documents', title: 'UAE documents', open: 1, groups: [
      { title: 'Passport', fields: [F('passportNo', 'Passport number'), F('passportIssue', 'Issue date', 'date'), F('passportExpiry', 'Expiry date', 'date', { exp: 'Passport' })] },
      { title: 'Emirates ID', fields: [F('eidNo', 'Emirates ID number', 'text', { ph: '784-YYYY-NNNNNNN-N' }), F('eidIssue', 'Issue date', 'date'), F('eidExpiry', 'Expiry date', 'date', { exp: 'Emirates ID' })] },
      { title: 'Residence visa', fields: [F('visaUid', 'UID number'), F('visaFileNo', 'File number'), F('visaIssue', 'Issue date', 'date'), F('visaExpiry', 'Expiry date', 'date', { exp: 'Residence visa' })] },
      { title: 'Labour card / work permit (MOHRE)', fields: [F('labourNo', 'Labour card number'), F('mohrePersonCode', 'MOHRE person code'), F('labourIssue', 'Issue date', 'date'), F('labourExpiry', 'Expiry date', 'date', { exp: 'Labour card' })] },
      { title: 'Medical insurance', fields: [F('insProvider', 'Provider'), F('insPolicy', 'Policy number'), F('insIssue', 'Start date', 'date'), F('insExpiry', 'Expiry date', 'date', { exp: 'Medical insurance' })] }] },
    { id: 'driver', title: 'Driving licence', fields: [F('dlNo', 'Licence number', 'text', { dreq: 1 }), F('dlCategory', 'Category', 'text', { list: 'euDlCats' }), F('dlIssue', 'Issue date', 'date'), F('dlExpiry', 'Expiry date', 'date', { dreq: 1, exp: 'Driving licence' }),
      F('vehicleNo', 'Assigned vehicle / truck no.'), F('salikTag', 'RTA / Salik tag')] },
    { id: 'bank', title: 'Bank & WPS', open: 1, fields: [F('payMethod', 'Payment method', 'select', { opts: [''].concat(METHODS) }), F('bankName', 'Bank'), F('iban', 'IBAN', 'text', { ph: 'AE07 0331 2345 6789 0123 456', w: 2 }),
      F('wpsRouting', 'WPS routing code'), F('wpsAgent', 'WPS agent / exchange house')] },
    { id: 'leave', title: 'Leave & end of service', fields: [F('leaveDays', 'Annual leave days', 'number', { ph: '30' }), F('gratuityStart', 'Gratuity start date', 'date', { hint: 'Leave empty to use the joining date.' })] }
  ];
  function allFields() { var out = []; SECTIONS.forEach(function (s) { (s.fields || []).forEach(function (f) { out.push(f); }); (s.groups || []).forEach(function (g) { g.fields.forEach(function (f) { out.push(Object.assign({ group: g.title }, f)); }); }); }); return out; }
  var FIELDS = allFields();
  var EXPIRIES = FIELDS.filter(function (f) { return f.exp; }).map(function (f) { return { key: f.key, label: f.exp }; });
  var EXP_KEY = {}; EXPIRIES.forEach(function (x) { EXP_KEY[x.key] = 1; });

  function isDriver(v) { return lc(v && v.empType) === 'company driver'; }
  /** a driver for Trips / Diesel: Is driver ticked, type Company Driver, or designation Driver */
  function isDriverEmp(e) { var G2 = G('Gill'); if (G2 && G2.isDriver) return G2.isDriver(e); return !!e && (/^(1|true|yes|on)$/i.test(String(e.isDriver || '')) || isDriver(e) || /^\s*driver\s*$/i.test(String(e.designation || ''))); }
  function isLeft(v) { var s = lc(v && v.status); return s === 'resigned' || s === 'terminated'; }
  function empActive(e) { var s = lc(e && e.status); return !(s === 'resigned' || s === 'terminated' || s === 'inactive' || s === 'left'); }

  /* --------------------------------------------------------------- expiries */
  /** 'expired' | 'today' | 'soon' | 'ok' | '' for an expiry date */
  function expState(iso, now) { if (blank(iso) || isNaN(dayNum(iso))) return ''; var d = daysUntil(iso, now); return d < 0 ? 'expired' : (d === 0 ? 'today' : (d <= LEAD ? 'soon' : 'ok')); }
  /** every dated document of an employee: [{key, label, date, number}] */
  function empDocs(e) {
    var out = [];
    EXPIRIES.forEach(function (x) { if (!blank(e[x.key])) out.push({ key: x.key, label: x.label, date: String(e[x.key]).slice(0, 10) }); });
    (e.docs || []).forEach(function (d) { if (d && !blank(d.expiry)) out.push({ key: 'doc:' + d.id, label: d.name || 'Document', date: String(d.expiry).slice(0, 10), number: d.number || '' }); });
    return out;
  }
  /** reminders in the shared contract shape (FEATURES_SPEC "Reminders") */
  function reminders(b, now) {
    now = now || today(); var out = [];
    recs(b, 'employees').forEach(function (e) {
      if (!e || blank(e.name) || !empActive(e)) return;
      empDocs(e).forEach(function (d) {
        var st = expState(d.date, now); if (!st || st === 'ok') return;
        if ((d.key === 'probationEnd' || d.key === 'contractExpiry') && st === 'expired' && daysUntil(d.date, now) < -LEAD) return;
        var ends = d.key === 'probationEnd' ? 'ends' : (d.key === 'contractExpiry' ? 'ends' : 'expires'), endedW = d.key === 'probationEnd' || d.key === 'contractExpiry' ? 'ended' : 'expired';
        var n = daysUntil(d.date, now);
        out.push({ id: 'empdoc-' + e.id + '-' + d.key, title: e.name + ' — ' + d.label + (st === 'expired' ? ' ' + endedW : (st === 'today' ? ' ' + ends + ' today' : ' ' + ends + ' in ' + n + ' day' + (n === 1 ? '' : 's'))),
          detail: d.label + (d.number ? ' ' + d.number : '') + (st === 'expired' ? ' ' + endedW + ' on ' : ' ' + ends + ' on ') + fmtD(d.date) + (e.code ? ' · ' + e.code : ''),
          due: d.date, kind: 'expiry', severity: st === 'expired' ? 'overdue' : (st === 'today' ? 'due' : 'soon'), link: { section: 'Employees', id: e.id } });
      }); });
    out.sort(function (x, y) { return String(x.due).localeCompare(String(y.due)); });
    return out;
  }
  var registeredWith = null;
  function registerReminders() { var R = G('Reminders'); if (!R || typeof R.register !== 'function' || registeredWith === R) return; try { R.register('employee-docs', function (b) { return reminders(b); }); registeredWith = R; } catch (e) {} }

  /* ------------------------------------------------------------ validation */
  function normIban(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
  function validate(b, v, id, pay) {
    var E = [], emps = recs(b, 'employees').filter(function (e) { return e && String(e.id) !== String(id); });
    if (blank(v.name)) E.push('Name is required.');
    else if (emps.some(function (e) { return lc(e.name) === lc(v.name); })) E.push('Another employee is already called "' + String(v.name).trim() + '".');
    if (!blank(v.code) && emps.some(function (e) { return lc(e.code) === lc(v.code); })) E.push('Code ' + v.code + ' is already used by another employee.');
    if (!blank(v.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.email).trim())) E.push('Email address is not valid.');
    if (isDriver(v)) { if (blank(v.dlNo)) E.push('Driving licence number is required for a Company Driver.'); if (blank(v.dlExpiry)) E.push('Driving licence expiry date is required for a Company Driver.'); }
    if (!blank(v.iban)) { var ib = normIban(v.iban);
      if (/^AE/.test(ib)) { if (!/^AE\d{21}$/.test(ib)) E.push('A UAE IBAN is AE followed by 21 digits (23 characters).'); }
      else if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(ib)) E.push('IBAN is not valid.'); }
    if (!blank(v.eidNo) && String(v.eidNo).replace(/\D/g, '').length !== 15) E.push('Emirates ID number has 15 digits (784-YYYY-NNNNNNN-N).');
    [['passportIssue', 'passportExpiry', 'Passport'], ['eidIssue', 'eidExpiry', 'Emirates ID'], ['visaIssue', 'visaExpiry', 'Residence visa'], ['labourIssue', 'labourExpiry', 'Labour card'], ['insIssue', 'insExpiry', 'Medical insurance'], ['dlIssue', 'dlExpiry', 'Driving licence'], ['joinDate', 'contractExpiry', 'Contract']].forEach(function (p) {
      if (!blank(v[p[0]]) && !blank(v[p[1]]) && v[p[1]] < v[p[0]]) E.push(p[2] + ': the expiry date is before the ' + (p[0] === 'joinDate' ? 'joining' : 'issue') + ' date.'); });
    if (isLeft(v) && !blank(v.leaveDate) && !blank(v.joinDate) && v.leaveDate < v.joinDate) E.push('The leaving date is before the joining date.');
    if (!blank(v.leaveDays) && (isNaN(Number(v.leaveDays)) || Number(v.leaveDays) < 0)) E.push('Annual leave days must be a number.');
    var PR = G('Payroll');
    if (pay && PR) PR.SECS.forEach(function (s) { (pay[s[0]] || []).forEach(function (l, i) { if (num(l.amount) && blank(l.itemId) && blank(l.item)) E.push('Pay setup — ' + s[1].toLowerCase() + ' line ' + (i + 1) + ': choose an item.'); if (num(l.amount) < 0) E.push('Pay setup — ' + s[1].toLowerCase() + ' line ' + (i + 1) + ': the amount cannot be negative.'); }); });
    return E;
  }

  /* ------------------------------------------------------------ form state */
  var S = null;
  function payItems(b, sec) { var PR = G('Payroll'); return PR ? PR.items(b, sec) : ((b && b.payslipItems && b.payslipItems[sec]) || []); }
  function start(b, rec, mode) {
    rec = rec || {};
    var v = {}; FIELDS.forEach(function (f) { var x = rec[f.key]; v[f.key] = x == null ? '' : String(x); });
    if (blank(v.name)) v.name = rec.empName || ''; if (blank(v.code)) v.code = rec.empCode || ''; if (blank(v.address)) v.address = rec.empAddress || '';
    if (blank(v.status)) v.status = 'Active';
    var pay = { earnings: [], deductions: [], contributions: [] };
    ['earnings', 'deductions', 'contributions'].forEach(function (s) { ((rec.pay || {})[s] || []).forEach(function (l) { if (l) pay[s].push({ itemId: blank(l.itemId) ? '' : String(l.itemId), item: l.item || '', amount: l.amount == null ? '' : String(l.amount) }); }); });
    if (!pay.earnings.length && !pay.deductions.length && !pay.contributions.length) { var bs = payItems(b, 'earnings').filter(function (x) { return lc(x.name) === 'basic salary'; })[0]; if (bs) pay.earnings.push({ itemId: String(bs.id), item: bs.name, amount: '' }); }
    var docs = (rec.docs || []).map(function (d) { return { id: d.id, name: d.name || '', number: d.number || '', expiry: d.expiry || '', attId: d.attId || '', fileName: d.fileName || '' }; });
    return { mode: mode, id: mode === 'edit' ? rec.id : null, v: v, pay: pay, docs: docs, src: rec };
  }
  function fieldHtml(f, v) {
    if (f.type === 'checkbox') { var cv = /^(1|true|yes|on)$/i.test(String(v[f.key] || '')); return '<label class="eu-f eu-chk" for="eu_' + f.key + '"><span class="eu-l">' + esc(f.label) + '</span><span class="eu-chk-r"><input type="checkbox" id="eu_' + f.key + '" data-eu="' + f.key + '"' + (cv ? ' checked' : '') + ' onchange="EmpUAE.f._set(\'' + f.key + '\',this.checked?\'1\':\'\')"> Yes</span>' + (f.hint ? '<small class="eu-hint">' + esc(f.hint) + '</small>' : '') + '</label>'; }
    var val = v[f.key] == null ? '' : v[f.key], id = 'eu_' + f.key, on = (f.type === 'select' || f.type === 'date') ? 'onchange' : 'oninput';
    var h = on + '="EmpUAE.f._set(\'' + f.key + '\',this.value)" id="' + id + '" data-eu="' + f.key + '"';
    var inp;
    if (f.type === 'select') inp = '<select ' + h + '>' + f.opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o || '—') + '</option>'; }).join('') + (val && f.opts.indexOf(val) < 0 ? '<option selected>' + esc(val) + '</option>' : '') + '</select>';
    else if (f.type === 'textarea') inp = '<textarea rows="2" ' + h + '>' + esc(val) + '</textarea>';
    else inp = '<input type="' + (f.type === 'number' ? 'text' : f.type) + '"' + (f.type === 'number' ? ' inputmode="numeric"' : '') + ' value="' + esc(val) + '"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.list ? ' list="' + f.list + '"' : '') + ' ' + h + '>';
    var st = f.exp ? expState(val) : '';
    return '<label class="eu-f' + (f.w ? ' eu-w2' : '') + (f.cls ? ' ' + f.cls : '') + (f.dreq ? ' eu-dreq' : '') + '" for="' + id + '"><span class="eu-l">' + esc(f.label) + (f.req ? '<i class="eu-req">*</i>' : '') + (f.dreq ? '<i class="eu-req eu-dstar">*</i>' : '') +
      (st && st !== 'ok' ? '<em class="eu-exp eu-exp-' + st + '">' + (st === 'expired' ? 'Expired' : (st === 'today' ? 'Today' : daysUntil(val) + ' days')) + '</em>' : '') + '</span>' + inp + (f.hint ? '<small class="eu-hint">' + esc(f.hint) + '</small>' : '') + '</label>';
  }
  /* FIX_SPEC_3 #1: the add button never disappears — disabled with a tooltip once every item of the
     section is on a line (or when there are no items yet); removing a line enables it again */
  function payAddBtn(L, s) {
    var used = {}; S.pay[s[0]].forEach(function (l) { if (!blank(l.itemId)) used[String(l.itemId)] = 1; });
    var left = L.filter(function (it) { return !used[String(it.id)]; }).length, tip = !L.length ? 'No ' + s[1].toLowerCase() + ' items yet — add them in Settings → Payslip Items' : 'All items added';
    return '<span class="eu-add-w"' + (left ? '' : ' title="' + esc(tip) + '"') + '><button type="button" class="btn btn-xs" data-eu-add="' + s[0] + '"' + (left ? '' : ' disabled aria-disabled="true" title="' + esc(tip) + '"') + ' onclick="EmpUAE.f._payAdd(\'' + s[0] + '\')">+ Add ' + s[2].toLowerCase() + '</button></span>';
  }
  function payHtml(b) {
    var PR = G('Payroll'); if (!PR) return '';
    var t = { earnings: 0, deductions: 0, contributions: 0 };
    var secs = PR.SECS.map(function (s) {
      var L = payItems(b, s[0]);
      var rows = S.pay[s[0]].map(function (l, i) { t[s[0]] += num(l.amount);
        var opts = '<option value="">— item —</option>' + L.map(function (it) { return '<option value="' + esc(it.id) + '"' + (String(it.id) === String(l.itemId) ? ' selected' : '') + '>' + esc(it.name) + '</option>'; }).join('') + (blank(l.itemId) && !blank(l.item) ? '<option value="" selected>' + esc(l.item) + '</option>' : '');
        return '<tr><td><select aria-label="' + s[2] + ' item" onchange="EmpUAE.f._pay(\'' + s[0] + '\',' + i + ',\'itemId\',this.value)">' + opts + '</select></td>' +
          '<td class="r"><input type="text" inputmode="decimal" class="eu-num" aria-label="Monthly amount" value="' + esc(l.amount) + '" oninput="EmpUAE.f._pay(\'' + s[0] + '\',' + i + ',\'amount\',this.value)"></td>' +
          '<td class="act"><button type="button" title="Remove line" aria-label="Remove line" onclick="EmpUAE.f._payRm(\'' + s[0] + '\',' + i + ')">×</button></td></tr>'; }).join('');
      return '<div class="eu-pay-sec"><div class="eu-pay-h">' + s[1] + '</div>' + (!L.length ? '<div class="eu-hint">No ' + s[1].toLowerCase() + ' items yet — add them in <a class="led-link" onclick="EmpUAE.f._items(\'' + s[0] + '\')">Settings → Payslip Items</a>.</div>' : '') +
        '<table class="eu-pay-t"><tbody>' + rows + '</tbody></table>' + payAddBtn(L, s) + '</div>'; }).join('');
    var net = r2(t.earnings - t.deductions);
    return '<div class="eu-pay">' + secs + '</div><div class="eu-pay-sum"><span>Monthly gross <b data-eu-sum="earnings">' + money(t.earnings) + '</b></span><span>Deductions <b data-eu-sum="deductions">' + money(t.deductions) + '</b></span><span class="grand">Net pay <b data-eu-sum="net">' + money(net) + '</b></span>' + (t.contributions ? '<span>Employer contributions <b>' + money(t.contributions) + '</b></span>' : '') + '</div>' +
      '<div class="eu-hint">Payroll (Payroll tab) pre-fills each month’s payslip from these amounts.</div>';
  }
  function docsHtml() {
    var rows = S.docs.map(function (d, i) { var st = expState(d.expiry);
      return '<tr><td><input type="text" aria-label="Document name" value="' + esc(d.name) + '" placeholder="e.g. Offer letter" oninput="EmpUAE.f._doc(' + i + ',\'name\',this.value)"></td>' +
        '<td><input type="text" aria-label="Document number" value="' + esc(d.number) + '" oninput="EmpUAE.f._doc(' + i + ',\'number\',this.value)"></td>' +
        '<td><input type="date" aria-label="Expiry date" value="' + esc(d.expiry) + '" onchange="EmpUAE.f._doc(' + i + ',\'expiry\',this.value)">' + (st && st !== 'ok' ? '<em class="eu-exp eu-exp-' + st + '">' + (st === 'expired' ? 'Expired' : (st === 'today' ? 'Today' : daysUntil(d.expiry) + ' days')) + '</em>' : '') + '</td>' +
        '<td class="eu-file">' + (d.file ? '<span class="eu-fname">' + esc(d.file.name) + '</span>' : (d.attId ? '<a class="led-link" onclick="EmpUAE.f._open(' + i + ')">' + esc(d.fileName || 'Open file') + '</a>' : '')) +
          '<label class="btn btn-xs eu-up">' + (d.file || d.attId ? 'Replace' : 'Attach file') + '<input type="file" onchange="EmpUAE.f._file(' + i + ',this)"></label></td>' +
        '<td class="act"><button type="button" title="Remove document" aria-label="Remove document" onclick="EmpUAE.f._docRm(' + i + ')">×</button></td></tr>'; }).join('');
    return '<div class="tbl-scroll"><table class="eu-docs-t"><thead><tr><th>Document</th><th>Number</th><th>Expiry</th><th>File</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="eu-hint">No attachments. Add scanned copies (passport, visa, contract …) with their expiry date.</td></tr>') + '</tbody></table></div>' +
      '<button type="button" class="btn btn-xs" onclick="EmpUAE.f._docAdd()">+ Add document</button><span class="eu-hint"> Files up to 2 MB, kept with the business (Settings → Attachments).</span>';
  }
  function bodyHtml(b) {
    var v = S.v, mgrs = recs(b, 'employees').filter(function (e) { return e && e.name && String(e.id) !== String(S.id); });
    var sec = function (s) {
      var inner = s.groups ? s.groups.map(function (g) { return '<div class="eu-grp"><div class="eu-grp-h">' + esc(g.title) + '</div><div class="eu-grid">' + g.fields.map(function (f) { return fieldHtml(f, v); }).join('') + '</div></div>'; }).join('')
        : '<div class="eu-grid">' + s.fields.map(function (f) { return fieldHtml(f, v); }).join('') + '</div>';
      var open = s.open || (s.id === 'driver' && (isDriver(v) || !blank(v.dlNo))) || (s.id === 'leave' && (!blank(v.leaveDays) || !blank(v.gratuityStart)));
      return '<details class="eu-sec eu-sec-' + s.id + '"' + (open ? ' open' : '') + '><summary>' + esc(s.title) + (s.id === 'driver' ? '<span class="eu-drv-note">Required for Company Drivers</span>' : '') + '</summary>' + inner + '</details>'; };
    return '<datalist id="euNations">' + NATIONS.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<datalist id="euDlCats">' + DL_CATS.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<datalist id="euManagers">' + mgrs.map(function (e) { return '<option value="' + esc(e.name) + '">'; }).join('') + '</datalist>' +
      SECTIONS.map(sec).join('') +
      '<details class="eu-sec eu-sec-pay" open><summary>Pay setup</summary><div id="euPay">' + payHtml(b) + '</div></details>' +
      '<details class="eu-sec eu-sec-docs"' + (S.docs.length ? ' open' : '') + '><summary>Document attachments' + (S.docs.length ? ' <span class="eu-cnt">' + S.docs.length + '</span>' : '') + '</summary><div id="euDocs">' + docsHtml() + '</div></details>';
  }
  function rootCls() { return 'card eu-card' + (isDriver(S.v) ? ' eu-driver' : '') + (isLeft(S.v) ? ' eu-left' : ''); }
  function can(fn) { var A = app(), b = A.curBiz(); try { return typeof A[fn] === 'function' ? !!A[fn](b, 'Employees') : true; } catch (e) { return true; } }
  function sfa() { return G('SettingsFixesA'); }

  var Form = {
    start: start, validate: validate, state: function () { return S; }, setState: function (s) { S = s; },
    html: function (b) {
      var A = app(), rec = null, mode = 'new';
      if (A.editingId != null) { rec = recs(b, 'employees').filter(function (r) { return String(r.id) === String(A.editingId); })[0] || null; if (rec) mode = 'edit'; }
      var pf = null; if (!rec && A._prefill) { pf = clone(A._prefill); rec = pf; A._prefill = null; }
      S = start(b, rec, mode);
      var x = { cf: '', ft: '' }; try { if (sfa() && sfa().extrasHtml) x = sfa().extrasHtml(b, 'employees', rec, mode); } catch (e) {}
      var title = mode === 'edit' ? (S.v.name || 'Employee') : ((reg().employees || {}).newLabel || 'New Employee');
      var btns = mode === 'edit'
        ? (can('canEdit') ? '<button type="button" class="btn btn-primary" onclick="EmpUAE.f.save(\'update\')">Update</button>' : '') +
          (can('canDelete') ? '<button type="button" class="btn btn-danger" onclick="App.deleteRecord(' + JSON.stringify(S.id) + ')">Delete</button>' : '')
        : '<button type="button" class="btn btn-primary" onclick="EmpUAE.f.save(\'create\')">Create</button><button type="button" class="btn" onclick="EmpUAE.f.save(\'another\')">Create &amp; add another</button>';
      var crumb = ''; try { crumb = A.recCrumb((reg().employees || {}).label || 'Employees', title); } catch (e) {}
      return crumb + '<div class="' + rootCls() + '" id="euForm" data-enter-nav="off"><div class="eu-head"><h2>' + esc(title) + '</h2>' + (mode === 'edit' && S.v.code ? '<span class="eu-code">' + esc(S.v.code) + '</span>' : '') + '</div><div id="euErr"></div>' +
        '<div id="euBody">' + bodyHtml(b) + '</div>' + (x.cf ? '<div class="sfa-extras eu-extras">' + x.cf + '</div>' : '') +
        '<div class="form-actions">' + btns + '<button type="button" class="btn" onclick="EmpUAE.f.cancel()">Cancel</button></div></div>';
    },
    mount: function () { var h = byId('euForm'); if (!h) return; try { if (global.QuickCreate) QuickCreate.scan(h); } catch (e) {} var n = byId('eu_name'); if (n && S && S.mode !== 'edit') try { n.focus(); } catch (e) {} },
    _set: function (k, val) { if (!S) return; S.v[k] = val; if (k === 'empType' || k === 'status') { var h = byId('euForm'); if (h) h.className = rootCls(); if (k === 'empType' && isDriver(S.v)) { var d = h && h.querySelector('.eu-sec-driver'); if (d) d.open = true; } } },
    _pay: function (sec, i, k, val) { if (!S || !S.pay[sec][i]) return; var l = S.pay[sec][i];
      if (k === 'itemId') { var it = payItems(app().curBiz(), sec).filter(function (x) { return String(x.id) === String(val); })[0]; l.itemId = it ? String(it.id) : ''; l.item = it ? it.name : ''; Form._payAddState(sec); return; }
      l[k] = val; Form._paySum(); },
    _paySum: function () { var h = byId('euPay'); if (!h || !S) return; var t = {}; ['earnings', 'deductions'].forEach(function (s) { t[s] = r2(S.pay[s].reduce(function (a, l) { return a + num(l.amount); }, 0)); }); t.net = r2(t.earnings - t.deductions);
      Object.keys(t).forEach(function (k) { var el = h.querySelector('[data-eu-sum="' + k + '"]'); if (el) el.textContent = money(t[k]); }); },
    _payAdd: function (sec) { if (!S) return; S.pay[sec].push({ itemId: '', item: '', amount: '' }); Form._drawPay(); },
    /* refresh one section's add button without redrawing (keeps focus on the select) */
    _payAddState: function (sec) { var h = byId('euPay'), PR = G('Payroll'); if (!h || !S || !PR) return; var old = h.querySelector('[data-eu-add="' + sec + '"]'); if (!old || !old.parentNode) return;
      var s = PR.SECS.filter(function (x) { return x[0] === sec; })[0]; if (!s) return; var w = doc().createElement('span'); w.innerHTML = payAddBtn(payItems(app().curBiz(), sec), s);
      var span = old.parentNode; if (span.parentNode && w.firstChild) span.parentNode.replaceChild(w.firstChild, span); },
    _payRm: function (sec, i) { if (!S) return; S.pay[sec].splice(i, 1); Form._drawPay(); },
    _drawPay: function () { var h = byId('euPay'); if (h) h.innerHTML = payHtml(app().curBiz()); },
    _items: function (sec) { if (sfa() && sfa().openPayslipItems) sfa().openPayslipItems(sec); },
    _doc: function (i, k, val) { if (!S || !S.docs[i]) return; S.docs[i][k] = val; if (k === 'expiry') Form._drawDocs(); },
    _docAdd: function () { if (!S) return; S.docs.push({ id: 'd' + Date.now().toString(36) + S.docs.length, name: '', number: '', expiry: '', attId: '' }); Form._drawDocs(); var d = byId('euForm'); var s = d && d.querySelector('.eu-sec-docs'); if (s) s.open = true; },
    _docRm: function (i) { if (!S) return; S.docs.splice(i, 1); Form._drawDocs(); },
    _drawDocs: function () { var h = byId('euDocs'); if (h) h.innerHTML = docsHtml(); },
    _file: function (i, inp) { var f = inp.files && inp.files[0]; if (!f || !S || !S.docs[i]) return;
      if (f.size > 2 * 1024 * 1024) { say('That file is larger than 2 MB. Attachments live in browser storage — scan at a lower resolution or save as PDF.'); inp.value = ''; return; }
      var rd = new FileReader(); rd.onload = function () { var d = S && S.docs[i]; if (!d) return; d.file = { name: f.name, size: f.size, type: f.type, data: String(rd.result) }; if (blank(d.name)) d.name = f.name.replace(/\.[^.]+$/, ''); Form._drawDocs(); }; rd.readAsDataURL(f); },
    _open: function (i) { var d = S && S.docs[i]; if (!d) return; var b = app().curBiz(); var at = (b.attachments || []).filter(function (a) { return a && a.id === d.attId; })[0];
      if (!at || !at.data) return say('The file is no longer in Settings → Attachments.'); openData(at); },
    cancel: function () { var A = app(); S = null; if (!(A.backFromRecord && A.backFromRecord())) A.backToList(); },
    /** act: create | another | update. opts.noNav for tests. Returns the stored record or {errors} */
    save: function (act, opts) {
      opts = opts || {}; var A = app(), b = A.curBiz(); if (!b || !S) return null;
      var editing = S.mode === 'edit' && S.id != null;
      if (!can(editing ? 'canEdit' : 'canCreate')) { say('Your permissions do not allow ' + (editing ? 'changing' : 'creating') + ' employees.'); return null; }
      var E = validate(b, S.v, S.id, S.pay), box = byId('euErr');
      if (E.length) { if (box) { box.innerHTML = '<div class="tf-errbox" role="alert">' + E.map(esc).join('<br>') + '</div>'; try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {} } return { errors: E }; }
      if (box) box.innerHTML = '';
      var arr = recs(b, 'employees').slice(), idx = editing ? arr.findIndex(function (r) { return String(r.id) === String(S.id); }) : -1, before = idx >= 0 ? clone(arr[idx]) : null;
      var rec = idx >= 0 ? Object.assign({}, arr[idx]) : {};
      FIELDS.forEach(function (f) { var val = S.v[f.key]; val = val == null ? '' : String(val); if (f.type !== 'textarea') val = val.trim(); rec[f.key] = val; });
      if (!blank(rec.iban)) rec.iban = normIban(rec.iban).replace(/(.{4})/g, '$1 ').trim();
      if (!blank(rec.leaveDays)) rec.leaveDays = String(Number(rec.leaveDays));
      if (!isLeft(rec)) rec.leaveDate = '';
      var oldName = before ? (before.name || before.empName || '') : '';
      if ('empName' in rec) rec.empName = rec.name; if ('empCode' in rec) rec.empCode = rec.code; if ('empAddress' in rec) rec.empAddress = rec.address; if ('employee' in rec) rec.employee = rec.name;
      var pay = {}; ['earnings', 'deductions', 'contributions'].forEach(function (s) { pay[s] = S.pay[s].filter(function (l) { return num(l.amount) || !blank(l.itemId); }).map(function (l) { return { itemId: l.itemId, item: l.item, amount: r2(num(l.amount)) }; }); });
      rec.pay = pay;
      /* attachments: new files go to b.attachments, removed rows take their file with them */
      var keepAtt = {}; b.attachments = b.attachments || [];
      rec.docs = S.docs.filter(function (d) { return !blank(d.name) || !blank(d.number) || !blank(d.expiry) || d.file || d.attId; }).map(function (d) {
        var o = { id: d.id, name: String(d.name || '').trim(), number: String(d.number || '').trim(), expiry: d.expiry || '', attId: d.attId || '', fileName: d.fileName || '' };
        if (d.file) { if (o.attId) b.attachments = b.attachments.filter(function (a) { return a && a.id !== o.attId; });
          var at = { id: 'at' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: d.file.name, size: d.file.size, type: d.file.type, date: today(), attachedTo: 'Employee — ' + rec.name, data: d.file.data };
          b.attachments.push(at); o.attId = at.id; o.fileName = d.file.name; }
        if (o.attId) keepAtt[o.attId] = 1; return o; });
      ((before && before.docs) || []).forEach(function (d) { if (d && d.attId && !keepAtt[d.attId]) b.attachments = b.attachments.filter(function (a) { return a && a.id !== d.attId; }); });
      b.attachments.forEach(function (a) { if (a && keepAtt[a.id]) a.attachedTo = 'Employee — ' + rec.name; });
      if (!b.attachments.length) delete b.attachments;
      if (idx >= 0) arr[idx] = rec; else { rec.id = Date.now() + Math.floor(Math.random() * 1000); rec.uuid = A.uuid ? A.uuid() : String(rec.id); rec.lines = []; arr.push(rec); }
      b.records = b.records || {}; b.records.employees = arr;
      if (editing && oldName && oldName !== rec.name) renameEmployee(b, oldName, rec.name);
      try { var x = sfa() && sfa().readExtras ? sfa().readExtras(byId('euForm')) : null; if (x) sfa().applyExtras(rec, x); } catch (e) {}
      try { G('refreshSummary')(b); } catch (e) {}
      try { A._logActivity(b, editing ? 'update' : 'create', 'employees', rec, before); } catch (e) {}
      A.saveBiz(b); toast(editing ? 'Updated' : 'Created');
      if (opts.noNav) return rec;
      S = null;
      if (act === 'another') { A.editingId = null; A._prefill = null; A.recReturn = null; A.wsMode = 'form'; A.renderMain(A.curBiz()); return rec; }
      A.editingId = null; if (!(A.backFromRecord && A.backFromRecord())) A.backToList();
      return rec;
    }
  };
  function openData(at) { try { var a = doc().createElement('a'); a.href = at.data; a.download = at.name || 'document'; doc().body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 100); } catch (e) {} }
  EU.openAtt = function (id) { var b = app().curBiz(); var at = ((b && b.attachments) || []).filter(function (a) { return a && a.id === id; })[0]; if (at && at.data) openData(at); else say('The file is no longer in Settings → Attachments.'); };

  /** a renamed employee keeps its payslips, payroll rows, payments, journal lines and claims */
  function renameEmployee(b, from, to) {
    var R = b.records || {}, n = 0;
    (R.payslips || []).forEach(function (p) { if (!p) return; if (p.employee === from) { p.employee = to; n++; } if (p.empName === from) p.empName = to; });
    (R.payroll || []).forEach(function (r) { (r && r.rows || []).forEach(function (x) { if (x && x.employee === from) x.employee = to; }); });
    ['payments', 'receipts', 'journal', 'expenseClaims'].forEach(function (k) { (R[k] || []).forEach(function (d) { if (!d) return;
      if (d.payee === from) d.payee = to; if (d.paidBy === from) d.paidBy = to; if (d.payer === from) d.payer = to;
      (d.lines || []).forEach(function (l) { if (l && l.sub === from) l.sub = to; if (l && l.subAccount === from) l.subAccount = to; }); }); });
    (R.billableTime || []).forEach(function (t) { if (t && t.employee === from) t.employee = to; });
    (R.employees || []).forEach(function (e) { if (e && e.lineManager === from) e.lineManager = to; });
    return n;
  }

  /* ---------------------------------------------------------------- view */
  function viewHtml(b, e) {
    var A = app(), v = e;
    var dl = function (fields) { var items = fields.filter(function (f) { return !blank(v[f.key]); }).map(function (f) { var val = v[f.key], st = f.exp ? expState(val) : '';
      return '<div class="eu-dv"><dt>' + esc(f.label) + '</dt><dd>' + (f.type === 'date' ? esc(fmtD(val)) : f.type === 'checkbox' ? (/^(1|true|yes|on)$/i.test(String(val)) ? 'Yes' : '') : esc(val)) + (st && st !== 'ok' ? ' <em class="eu-exp eu-exp-' + st + '">' + (st === 'expired' ? 'Expired' : (st === 'today' ? 'Today' : daysUntil(val) + ' days')) + '</em>' : '') + '</dd></div>'; });
      return items.length ? '<dl class="eu-dl">' + items.join('') + '</dl>' : ''; };
    var parts = SECTIONS.map(function (s) {
      var inner = s.groups ? s.groups.map(function (g) { var x = dl(g.fields); return x ? '<div class="eu-grp"><div class="eu-grp-h">' + esc(g.title) + '</div>' + x + '</div>' : ''; }).join('') : dl(s.fields);
      return inner ? '<section class="eu-vsec"><h3>' + esc(s.title) + '</h3>' + inner + '</section>' : ''; }).join('');
    var PR = G('Payroll'), payPart = '';
    if (PR && PR.hasSetup(e)) { var ps = PR.paySetup(e), t = PR.setupTotals(e);
      payPart = '<section class="eu-vsec"><h3>Pay setup</h3><table class="eu-vpay">' + PR.SECS.map(function (s) { return ps[s[0]].filter(function (l) { return l.amount; }).map(function (l) { return '<tr><td>' + esc(l.item) + '</td><td class="eu-vk">' + s[2] + '</td><td class="m r">' + money(l.amount) + '</td></tr>'; }).join(''); }).join('') +
        '<tr class="eu-vtot"><td colspan="2">Net pay</td><td class="m r">' + money(t.net) + '</td></tr></table></section>'; }
    var docsPart = (e.docs || []).length ? '<section class="eu-vsec"><h3>Document attachments</h3><table class="eu-vpay">' + e.docs.map(function (d) { var st = expState(d.expiry);
      return '<tr><td>' + esc(d.name) + (d.number ? ' <span class="eu-vk">' + esc(d.number) + '</span>' : '') + '</td><td>' + (d.expiry ? esc(fmtD(d.expiry)) + (st && st !== 'ok' ? ' <em class="eu-exp eu-exp-' + st + '">' + (st === 'expired' ? 'Expired' : (st === 'today' ? 'Today' : daysUntil(d.expiry) + ' days')) + '</em>' : '') : '') + '</td><td class="r">' + (d.attId ? '<a class="led-link" onclick="EmpUAE.openAtt(' + esc(JSON.stringify(d.attId)) + ')">' + esc(d.fileName || 'Download') + '</a>' : '') + '</td></tr>'; }).join('') + '</table></section>' : '';
    var bal = 0; try { bal = G('employeeBalance')(b, e.name); } catch (x) {}
    var crumb = ''; try { crumb = A.recCrumb((reg().employees || {}).label || 'Employees', e.name); } catch (x) {}
    var canE = can('canEdit');
    return crumb + '<div class="card eu-card eu-view"><div class="eu-head"><h2>' + esc(e.name) + '</h2>' + (e.code ? '<span class="eu-code">' + esc(e.code) + '</span>' : '') +
      (e.empType ? '<span class="eu-tag">' + esc(e.empType) + '</span>' : '') + '<span class="st-badge ' + (empActive(e) ? (lc(e.status) === 'on leave' ? 'st-partial' : 'st-paid') : 'st-draft') + '">' + esc(e.status || 'Active') + '</span>' +
      '<span class="eu-bal">Net owing <a class="led-link" onclick="App.openLedger(' + JSON.stringify(e.id) + ')">' + money(bal) + '</a></span></div>' +
      '<div class="eu-vgrid">' + (parts || '<div class="eu-hint">No details yet.</div>') + payPart + docsPart + '</div>' +
      '<div class="form-actions">' + (canE ? '<button class="btn btn-primary" onclick="App.editRecord(' + JSON.stringify(e.id) + ')">Edit</button>' : '') +
      '<button class="btn" onclick="App.openLedger(' + JSON.stringify(e.id) + ')">Ledger</button><button class="btn" onclick="App.backFromRecord()||App.backToList()">Back</button></div></div>';
  }

  /* ------------------------------------------------------- list: panel + columns */
  function panelHtml(b) {
    var list = reminders(b); if (!list.length) return '';
    var n = { overdue: 0, due: 0, soon: 0 }; list.forEach(function (r) { n[r.severity]++; });
    var max = 6, more = list.length - max;
    return '<details class="eu-panel"' + (n.overdue || n.due ? ' open' : '') + '><summary><span class="eu-panel-t">Document expiries</span>' +
      (n.overdue ? '<span class="eu-pill eu-exp-expired">' + n.overdue + ' expired</span>' : '') + (n.due ? '<span class="eu-pill eu-exp-today">' + n.due + ' today</span>' : '') + (n.soon ? '<span class="eu-pill eu-exp-soon">' + n.soon + ' within ' + LEAD + ' days</span>' : '') + '</summary>' +
      '<ul class="eu-panel-l">' + list.slice(0, max).map(function (r) { return '<li class="sev-' + r.severity + '"><a class="led-link" onclick="App.viewRecord(' + JSON.stringify(r.link.id) + ')">' + esc(r.title) + '</a><span class="eu-hint">' + esc(fmtD(r.due)) + '</span></li>'; }).join('') +
      (more > 0 ? '<li class="eu-hint">… and ' + more + ' more. Add the expiry columns with <b>Edit columns</b> and sort by them.</li>' : '') + '</ul></details>';
  }
  var COLS = null;
  function extraCols() {
    if (COLS) return COLS;
    var skip = { name: 1, code: 1, email: 1, phone: 1, address: 1 };
    COLS = FIELDS.filter(function (f) { return !skip[f.key]; }).map(function (f) { var lbl = f.group && /^(Issue date|Expiry date|Start date)$/.test(f.label) ? f.group.replace(/ \/.*$/, '').replace(/ \(.*\)$/, '') + ' ' + f.label.toLowerCase() : f.label;
      if (f.key === 'dlIssue' || f.key === 'dlExpiry') lbl = 'Driving licence ' + f.label.toLowerCase();
      var col = { key: f.key, label: lbl, kind: f.type === 'date' ? 'date' : 'text', euExpiry: !!f.exp, euField: 1 };
      if (f.type === 'checkbox') col.calc = function (r) { return /^(1|true|yes|on)$/i.test(String(r[f.key] || '')) ? 'Yes' : ''; };
      return col; });
    COLS.push({ key: 'euNextExpiry', label: 'Next document expiry', kind: 'date', euExpiry: true, euField: 1, calc: function (r) { var d = empDocs(r).filter(function (x) { return x.key !== 'probationEnd'; }).map(function (x) { return x.date; }).sort(); return d[0] || ''; } });
    COLS.push({ key: 'euNetPay', label: 'Monthly net pay', kind: 'money', r: 1, euField: 1, calc: function (r) { var PR = G('Payroll'); return PR ? PR.setupTotals(r).net : 0; } });
    return COLS;
  }

  /* ---------------------------------------------------------------- install */
  function wrap(obj, name, fn) { if (!obj || typeof obj[name] !== 'function') return; var orig = obj[name]; obj[name] = function () { return fn.call(this, orig, Array.prototype.slice.call(arguments)); }; }
  function isEmp(A) { return l2k()[A.wsSection] === 'employees'; }
  function install() {
    var A = app(); if (!A || A._euInstalled) return; A._euInstalled = true;
    wrap(A, 'formHtml', function (orig, args) { if (!isEmp(this)) return orig.apply(this, args); return Form.html(args[0] || this.curBiz()); });
    wrap(A, '_mountDesignedForm', function (orig, args) { if (args[0] === 'employees' && byId('euForm')) return Form.mount(); return orig.apply(this, args); });
    wrap(A, 'viewHtml', function (orig, args) { if (!isEmp(this)) return orig.apply(this, args); var b = args[0] || this.curBiz(), self = this;
      var e = recs(b, 'employees').filter(function (r) { return String(r.id) === String(self.editingId); })[0]; return e ? viewHtml(b, e) : orig.apply(this, args); });
    wrap(A, 'listHtml', function (orig, args) { var h = orig.apply(this, args); if (!isEmp(this)) return h; try { var p = panelHtml(args[0] || this.curBiz()); if (p) { var i = h.indexOf('<div id="regBody">'); h = i >= 0 ? h.slice(0, i) + p + h.slice(i) : h + p; } } catch (e) {} return h; });
    wrap(A, '_colPool', function (orig, args) { var pool = orig.apply(this, args) || []; if (args[0] !== reg().employees) return pool;
      var seen = {}; pool.forEach(function (p) { seen[p.key] = 1; }); var add = extraCols().filter(function (c) { return !seen[c.key]; });
      var li = pool.findIndex(function (p) { return p.key === '__ledger'; }); if (li < 0) return pool.concat(add); pool.splice.apply(pool, [li, 0].concat(add)); return pool; });
    wrap(A, '_cellHtml', function (orig, args) { var col = args[2], r = args[3]; if (!col || !col.euExpiry) return orig.apply(this, args);
      var v = col.calc ? col.calc(r) : r[col.key], st = expState(v);
      return '<td class="nw">' + (v ? '<span class="eu-expc' + (st && st !== 'ok' ? ' eu-exp-' + st : '') + '"' + (st === 'expired' ? ' title="Expired"' : (st === 'soon' || st === 'today' ? ' title="Expires within ' + LEAD + ' days"' : '')) + '>' + esc(fmtD(v)) + '</span>' : '') + '</td>'; });
    wrap(A, '_importFields', function (orig, args) { var out = orig.apply(this, args); if (args[0] !== reg().employees) return out; var seen = {}; out.forEach(function (f) { seen[f.key] = 1; });
      FIELDS.forEach(function (f) { if (!seen[f.key]) out.push({ key: f.key, label: f.group && /date$/i.test(f.label) ? f.group.replace(/ \/.*$/, '').replace(/ \(.*\)$/, '') + ' ' + f.label.toLowerCase() : f.label, type: f.type === 'date' ? 'date' : 'text' }); }); return out; });
    /* an employee saved through the Form Designer (if a business still uses it) keeps the UAE fields */
    wrap(A, '_applyDesignedToNative', function (orig, args) { var key = args[0], rec = args[1], r = orig.apply(this, args);
      try { if (key === 'employees' && this.editingId != null) { var self = this, old = recs(this.curBiz(), 'employees').filter(function (x) { return String(x.id) === String(self.editingId); })[0];
        if (old) Object.keys(old).forEach(function (k) { if (!(k in rec)) rec[k] = old[k]; }); } } catch (e) {}
      return r; });
    /* "Drivers only" on the Employees list (Is driver ticked, type Company Driver or designation Driver) */
    wrap(A, 'listHtml', function (orig, args) { var h = orig.apply(this, args); if (!isEmp(this)) return h;
      var t = '<label class="eu-drvf"><input type="checkbox"' + (EU._drvOnly ? ' checked' : '') + ' onchange="EmpUAE.driversOnly(this.checked)"> Drivers only</label>';
      var i = h.indexOf('<div id="regBody">'); return i >= 0 ? h.slice(0, i) + t + h.slice(i) : h + t; });
    wrap(A, '_advFilter', function (orig, args) { var rows = orig.apply(this, args); if (!EU._drvOnly || !isEmp(this)) return rows; return (rows || []).filter(isDriverEmp); });
    registerReminders();
    try { if (A.view === 'workspace' && isEmp(A) && A.curBiz && A.curBiz()) A.renderMain(A.curBiz()); } catch (e) {}
  }

  EU.FIELDS = FIELDS; EU.SECTIONS = SECTIONS; EU.EXPIRIES = EXPIRIES; EU.expState = expState; EU.empDocs = empDocs; EU.reminders = reminders; EU.validate = validate;
  EU.renameEmployee = renameEmployee; EU.registerReminders = registerReminders; EU.install = install; EU.f = Form; EU.viewHtml = viewHtml; EU.panelHtml = panelHtml; EU.extraCols = extraCols;
  EU.isDriverEmp = isDriverEmp; EU._drvOnly = false;
  EU.driversOnly = function (on) { EU._drvOnly = !!on; var A = app(); try { A.renderMain(A.curBiz()); } catch (e) {} };
  global.EmpUAE = EU;
  install();
  try { if (doc() && doc().addEventListener) doc().addEventListener('DOMContentLoaded', function () { install(); registerReminders(); }); } catch (e) {}
  try { if (global.addEventListener) global.addEventListener('load', registerReminders); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
