/* ===================== Business Details: Trade License & company documents =====================
   FEATURES_SPEC section 3. Adds to Settings -> Business Details (js/settings-pages.js
   PAGES.business, a declarative 'form' page):

     Trade License   — number, issuing authority (free text with suggestions: DED,
                       RAKEZ, SHAMS, SAIF Zone, JAFZA, DMCC, ADDED, …), legal form,
                       activities, issue date, expiry date
     Company documents — lines of {type, number, issue, expiry, notes}
                       (Establishment card, Chamber of Commerce, VAT certificate (TRN),
                       Ejari / tenancy, Insurance, Other)

   Stored on the business, next to the existing details (nothing else changes):
     b.details.tradeLicense = {number, authority, legalForm, activities, issueDate, expiryDate}
     b.details.companyDocs  = [{type, number, issue, expiry, notes}]

   Reminders source 'license' (kind 'license'): each expiry produces one reminder
   whose id carries the stage it is in — 60 / 30 / 7 days before, due, overdue —
   so a reminder marked read comes back when the next stage starts. Severity is
   left to the Reminders core (lead days for 'license' default to 60). */
(function (root) {
  'use strict';
  if (typeof App === 'undefined') return;

  var AUTHORITIES = ['DED (Dubai Economy & Tourism)', 'Abu Dhabi DED (ADDED)', 'Sharjah SEDD', 'Ajman DED', 'RAK DED', 'Fujairah Municipality / DED', 'UAQ DED',
    'RAKEZ', 'SHAMS', 'SAIF Zone', 'JAFZA', 'DMCC', 'DAFZA', 'Dubai South', 'IFZA', 'Meydan Free Zone', 'Hamriyah Free Zone', 'Ajman Free Zone', 'ADGM', 'DIFC', 'KEZAD', 'Fujairah Free Zone', 'UAQ FTZ'];
  var LEGAL_FORMS = ['Limited Liability Company (LLC)', 'Sole Establishment', 'Civil Company', 'Free Zone Establishment (FZE)', 'Free Zone Company (FZCO / FZ-LLC)',
    'Branch of a Foreign Company', 'Branch of a UAE Company', 'Private Joint Stock Company (PJSC)', 'Public Joint Stock Company', 'Partnership'];
  var DOC_TYPES = ['Establishment card', 'Chamber of Commerce', 'VAT certificate (TRN)', 'Ejari / tenancy', 'Insurance', 'Other'];
  var STAGES = [60, 30, 7];

  function esc(s) { return App.esc(s == null ? '' : s); }
  function clean(s) { return String(s == null ? '' : s).trim(); }
  function isoDate(s) { s = clean(s); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }

  /* ---------- data ---------- */
  function license(b) { var t = (b && b.details && b.details.tradeLicense) || {}; return t; }
  function docs(b) { var d = b && b.details && b.details.companyDocs; return Array.isArray(d) ? d : []; }

  function stageOf(days) {
    if (days == null) return null;
    if (days < 0) return 'overdue';
    if (days === 0) return 'due';
    for (var i = STAGES.length - 1; i >= 0; i--) if (days <= STAGES[i]) return 'd' + STAGES[i];
    return 'later';
  }
  function reminderFor(base, name, due, detail) {
    var R = root.Reminders, days = R ? R.daysUntil(due) : null, stage = stageOf(days);
    if (stage == null) return null;
    var title = days < 0 ? name + ' expired' : days === 0 ? name + ' expires today' : name + ' expires in ' + days + (days === 1 ? ' day' : ' days');
    return { id: base + ':' + due + ':' + stage, kind: 'license', due: due, title: title,
      detail: detail || '',
      link: { section: 'Settings', setting: 'business' } };
  }
  function licenseSource(b) {
    var out = [], tl = license(b);
    var exp = isoDate(tl.expiryDate);
    if (exp) out.push(reminderFor('tl', 'Trade license' + (tl.number ? ' ' + clean(tl.number) : ''), exp, clean(tl.authority)));
    docs(b).forEach(function (d, i) {
      var e = d && isoDate(d.expiry); if (!e) return;
      var type = clean(d.type) || 'Company document', no = clean(d.number);
      out.push(reminderFor('doc:' + (type + '|' + (no || i)).toLowerCase(), type + (no ? ' ' + no : ''), e, clean(d.notes)));
    });
    return out.filter(Boolean);
  }

  /* ---------- the Business Details form ---------- */
  var SP = root.SettingsPages;
  function install() {
    if (!SP || !SP.PAGES || !SP.PAGES.business) return false;
    var P = SP.PAGES.business;
    if (P.__bdocs) return true;
    P.__bdocs = 1;

    var st = P.store, origGet = st.get, origSet = st.set;
    st.get = function (b) {
      var r = origGet.apply(this, arguments), t = license(b);
      r.tlNumber = t.number || ''; r.tlAuthority = t.authority || ''; r.tlLegalForm = t.legalForm || ''; r.tlActivities = t.activities || '';
      r.tlIssue = t.issueDate || ''; r.tlExpiry = t.expiryDate || '';
      r.companyDocs = docs(b).map(function (d) { return Object.assign({}, d); });
      return r;
    };
    st.set = function (b, r) {
      origSet.apply(this, arguments);
      var keep = license(b);            // any keys this form does not know about survive
      b.details = b.details || {};
      b.details.tradeLicense = Object.assign({}, keep, {
        number: clean(r.tlNumber), authority: clean(r.tlAuthority), legalForm: clean(r.tlLegalForm), activities: String(r.tlActivities == null ? '' : r.tlActivities).trim(),
        issueDate: isoDate(r.tlIssue), expiryDate: isoDate(r.tlExpiry) });
      if (Array.isArray(r.companyDocs)) {
        b.details.companyDocs = r.companyDocs.map(function (d) {
          return { type: clean(d.type) || 'Other', number: clean(d.number), issue: isoDate(d.issue), expiry: isoDate(d.expiry), notes: clean(d.notes) };
        }).filter(function (d) { return d.number || d.issue || d.expiry || d.notes; });
      }
    };

    var noDef = { def: '' };
    P.fields.push(
      { t: 'fieldset', l: 'Trade License', fields: [
        { k: 'tlNumber', l: 'License number', t: 'text', ph: 'e.g. 1234567' },
        { k: 'tlAuthority', l: 'Issuing authority', t: 'text', ph: 'e.g. DED, RAKEZ, SHAMS', cls: 'bd-auth' },
        { k: 'tlLegalForm', l: 'Legal form', t: 'text', ph: 'e.g. Limited Liability Company (LLC)', cls: 'bd-legal' },
        { k: 'tlActivities', l: 'Activities', t: 'textarea', ph: 'Licensed business activities' },
        Object.assign({ k: 'tlIssue', l: 'Issue date', t: 'date' }, noDef),
        Object.assign({ k: 'tlExpiry', l: 'Expiry date', t: 'date', hint: 'You are reminded 60, 30 and 7 days before, on the day and after it expires.' }, noDef)
      ] },
      { k: 'companyDocs', l: 'Company documents', t: 'lines', cols: [
        { k: 'type', l: 'Document', t: 'select', opts: DOC_TYPES },
        { k: 'number', l: 'Number' },
        { k: 'issue', l: 'Issue date' },
        { k: 'expiry', l: 'Expiry date' },
        { k: 'notes', l: 'Notes' }] }
    );

    /* the generic line editor only draws text boxes: make the two date columns date
       boxes and hang the suggestion lists on the authority / legal form boxes */
    var origPage = App.set_business;
    App.set_business = function (b) {
      var html = origPage.apply(this, arguments);
      if (typeof html !== 'string' || html.indexOf('data-k="tlNumber"') < 0) return html;
      html = html.replace(/type="text" data-c="(issue|expiry)"/g, 'type="date" data-c="$1"')
        .replace('data-k="tlAuthority"', 'data-k="tlAuthority" list="bdAuthList"')
        .replace('data-k="tlLegalForm"', 'data-k="tlLegalForm" list="bdLegalList"');
      return html + '<datalist id="bdAuthList">' + AUTHORITIES.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
        '<datalist id="bdLegalList">' + LEGAL_FORMS.map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>';
    };
    var origAdd = SP._addLine;
    SP._addLine = function (btn, k) {
      var r = origAdd.apply(this, arguments);
      if (k === 'companyDocs') {
        try { var t = btn.parentNode.querySelector('table[data-lines="companyDocs"]');
          t.querySelectorAll('input[data-c="issue"],input[data-c="expiry"]').forEach(function (i) { if (i.type !== 'date') i.type = 'date'; }); } catch (e) {}
      }
      return r;
    };
    return true;
  }
  install();

  if (root.Reminders && root.Reminders.register) {
    root.Reminders.defineKind && root.Reminders.defineKind('license', { label: 'Trade license & company documents', lead: 60, icon: 'building' });
    root.Reminders.register('license', licenseSource);
  }

  root.BusinessDocs = { AUTHORITIES: AUTHORITIES, LEGAL_FORMS: LEGAL_FORMS, DOC_TYPES: DOC_TYPES, source: licenseSource, stageOf: stageOf, install: install };
})(typeof window !== 'undefined' ? window : globalThis);
