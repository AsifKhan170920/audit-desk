/* ===================== Settings fixes A (FIX_SPEC_SETTINGS 95-111, leftovers 62 and 71) =====================
   Additive module, loaded last. It wraps App / SettingsPages / TxnForms / BankForm instead of
   rewriting them, so the parallel settings branch merges cleanly.

   95-97  Chart of Accounts: Cash Flow Statement group, Autofill (line description, tax code), no
          Starting balance on the account form (the figure stays on the account and is edited in
          Settings > Starting Balances); autofill when an account is picked on any line.
   98-101 Settings > Custom Fields render on the form of their Placement (native vouchers, the bank
          form, the payslip form and every Form Designer form), save to rec.custom[<field id>],
          load on Edit, print on View / Print / PDF when flagged, are left out of Clone / Copy to,
          honour "Locked", show as cf_<id> columns in Edit columns. Line placements ("… - Line")
          add a column to the line grid (rec.lines[].custom[<field id>]).
   102-103 Footers: a Footers checkbox list on every document form; the default footer is ticked
          on new documents; chosen footers print under View / Print / PDF (rec.footers = [ids]).
   104-105 + 62  Payslip form with Earnings / Deductions / Contributions sections picked from
          Payslip Items; each line carries its item's account so the general ledger posts it.
          Payslip item account dropdowns list expense and liability accounts only.
   106-108 Starting Balances: Balance Sheet accounts only (Debit / Credit), the difference shown in
          Starting balance equity with a warning, no starting balance fields on the register forms
          (lossless: the figures stay on the records and appear in the Starting Balances sub-pages).
   109    Billable expenses: "Billable to customer" on Payment and Purchase Invoice lines, the
          customer's Uninvoiced amount, and "Add to invoice" on the Sales Invoice form.
   110-111 Recurring transactions: a due notice with Create on the tab, "Every N days / weeks /
          months / years" interval.
   71     Expense Claim lines get a Tax code column.
   ========================================================================================= */
(function (global) {
  'use strict';
  function app() { try { return App; } catch (e) { return global.App || null; } }
  function reg() { try { return REG; } catch (e) { return global.REG || {}; } }
  function l2k() { try { return LABEL2KEY; } catch (e) { return global.LABEL2KEY || {}; } }
  function k2l() { try { return KEY2LABEL; } catch (e) { return global.KEY2LABEL || {}; } }
  function G(n) { try { return global[n]; } catch (e) { return undefined; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function num(v) { if (v == null || v === '') return 0; if (typeof v === 'number') return isFinite(v) ? v : 0; var n = parseFloat(String(v).replace(/,/g, '').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
  function r2(v) { return Math.round(((Number(v) || 0) + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function doc() { return global.document; }
  function byId(id) { var d = doc(); return d && d.getElementById ? d.getElementById(id) : null; }
  function fire(el, type) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {} }
  function money(v) { var A = app(); try { return A.money(v); } catch (e) { return r2(v).toFixed(2); } }
  function fmtD(v) { var A = app(); try { return A.fmtDate ? A.fmtDate(v) : v; } catch (e) { return v; } }
  function q(s) { return esc(JSON.stringify(String(s))); }
  function toast(m) { var A = app(); try { if (A && A.toast) A.toast(m); else if (global.UIModal && UIModal.toast) UIModal.toast(m); } catch (e) {} }
  function acct(b, id) { return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && n.id === id; })[0] || null; }
  function acctByName(b, name) { if (blank(name)) return null; var t = String(name).trim().toLowerCase(); return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && String(n.name || '').trim().toLowerCase() === t; })[0] || null; }
  function rootOf(b, n) { try { return G('acctRoot')(b, n); } catch (e) { return 'assets'; } }
  function sideOf(b, n) { var r = rootOf(b, n); return (r === 'income' || r === 'expense') ? 'pl' : 'bs'; }
  function natureD(b, n) { var r = rootOf(b, n); return r === 'assets' || r === 'expense'; }
  function acctLabel(b, id) { var A = app(); var o = null; try { o = A.accountOptions(b).filter(function (x) { return String(x.id) === String(id); })[0]; } catch (e) {} return o ? o.label : (acct(b, id) ? acct(b, id).name : String(id || '')); }
  function recs(b, key) { return ((b && b.records) || {})[key] || []; }

  var SFA = {};

  /* =================================================================== 95-97  Chart of Accounts */
  var CF_CATS = [['operating', 'Operating activities'], ['investing', 'Investing activities'], ['financing', 'Financing activities'], ['cash', 'Cash and cash equivalents']];
  /** [value, label] — the four Manager groups, then the custom groups of Settings > Cash Flow Statement Groups */
  function cashFlowOptions(b) {
    var out = [['', '— automatic —']].concat(CF_CATS.map(function (c) { return [c[0], c[1]]; }));
    var g = (b && b.cashFlowGroups) || {};
    ['operating', 'investing', 'financing'].forEach(function (cat) { (g[cat] || []).forEach(function (x) { if (x && x.name) out.push(['cfg:' + x.id, x.name + ' (' + CF_CATS.filter(function (c) { return c[0] === cat; })[0][1].toLowerCase() + ')']); }); });
    return out;
  }
  /** the activity an account is reported under: operating | investing | financing | cash, or null (automatic) */
  function cashFlowCat(b, n) {
    var v = n && n.cashFlow; if (blank(v)) return null;
    if (/^cfg:/.test(v)) { var id = v.slice(4), g = (b && b.cashFlowGroups) || {}, hit = null;
      ['operating', 'investing', 'financing'].forEach(function (cat) { if ((g[cat] || []).some(function (x) { return x && String(x.id) === id; })) hit = cat; }); return hit; }
    return v;
  }
  function taxNames(b) { return ((b && b.taxCodes) || []).map(function (t) { return t && t.name; }).filter(Boolean); }
  function coaExtraHtml(b, node) {
    var n = node || {}, cf = n.cashFlow || '';
    var sel = function (id, opts, v) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
    var tax = [['', '— no tax —']].concat(taxNames(b).map(function (t) { return [t, t]; }));
    var h = '<label class="fld">Cash Flow Statement</label>' + sel('coa_cf', cashFlowOptions(b), cf) +
      '<div class="sfa-af"><label class="chk-row"><input type="checkbox" id="coa_afdesc"' + (n.afDesc ? ' checked' : '') + ' onchange="SettingsFixesA._reveal(this,\'coa_afdesc_box\')"> Autofill — Line description</label>' +
      '<div id="coa_afdesc_box" class="sfa-reveal"' + (n.afDesc ? '' : ' hidden') + '><textarea id="coa_lineDesc" rows="2">' + esc(n.lineDesc || '') + '</textarea></div>' +
      '<label class="chk-row"><input type="checkbox" id="coa_aftax"' + (n.afTax ? ' checked' : '') + ' onchange="SettingsFixesA._reveal(this,\'coa_aftax_box\')"> Autofill — Tax Code</label>' +
      '<div id="coa_aftax_box" class="sfa-reveal"' + (n.afTax ? '' : ' hidden') + '>' + sel('coa_taxCode', tax, n.taxCode || '') + '</div></div>';
    if (num(n.balance)) h += '<div class="sfa-note">Starting balance ' + esc(money(n.balance)) + ' — kept in <a class="led-link" onclick="SettingsFixesA.openStarting(\'balance-sheet\')">Settings → Starting Balances</a>.</div>';
    return h;
  }
  function readCoaExtra() {
    var g = function (id) { return byId(id); }; if (!g('coa_cf') && !g('coa_afdesc')) return null;
    return { cashFlow: g('coa_cf') ? g('coa_cf').value : '', afDesc: !!(g('coa_afdesc') && g('coa_afdesc').checked), lineDesc: g('coa_lineDesc') ? g('coa_lineDesc').value : '',
      afTax: !!(g('coa_aftax') && g('coa_aftax').checked), taxCode: g('coa_taxCode') ? g('coa_taxCode').value : '' };
  }
  function applyCoaExtra(n, x) {
    if (!n || !x) return;
    if (x.cashFlow) n.cashFlow = x.cashFlow; else delete n.cashFlow;
    n.afDesc = !!x.afDesc; n.lineDesc = x.afDesc ? x.lineDesc : '';
    n.afTax = !!x.afTax; n.taxCode = x.afTax ? x.taxCode : '';
    if (!n.afDesc) { delete n.afDesc; delete n.lineDesc; } if (!n.afTax) { delete n.afTax; delete n.taxCode; }
  }
  /** what picking `acctId` on a line fills in: {desc, tax} (only the flagged ones) */
  function autofillOf(b, acctId) { var n = acct(b, acctId); if (!n) return {}; var o = {};
    if (n.afDesc && !blank(n.lineDesc)) o.desc = n.lineDesc;
    if (n.afTax && !blank(n.taxCode) && taxNames(b).indexOf(n.taxCode) >= 0) o.tax = n.taxCode;
    return o; }
  SFA.autofillOf = autofillOf; SFA.cashFlowCat = cashFlowCat; SFA.cashFlowOptions = cashFlowOptions;

  /* ============================================================ 98-101  custom fields (Settings) */
  var CF_STORES = ['text', 'checkbox', 'date', 'image', 'multi', 'number'];
  var SPECIAL_SINGULAR = { 'inventory kit': null, 'business details': null, 'tax code': null };
  /** REG key for a placement name ("Sales Invoice", "Bank or Cash Account", "Sales Invoice - Line") */
  function placementKey(name) {
    var s = String(name || '').trim(), line = / - line$/i.test(s); if (line) s = s.replace(/ - line$/i, '');
    var t = s.toLowerCase(); if (t in SPECIAL_SINGULAR) return null;
    var R = reg(), hit = null; Object.keys(R).forEach(function (k) { if (!hit && String((R[k] && R[k].singular) || '').toLowerCase() === t) hit = k; });
    return hit ? { key: hit, line: line } : null;
  }
  /** Settings custom fields for a document type, sorted by Position: [{id, type, name, def}] */
  function fieldsFor(b, key, line) {
    var defs = (b && b.customFieldDefs) || {}, out = [];
    CF_STORES.forEach(function (type) { (defs[type] || []).forEach(function (d) { if (!d || blank(d.name) || d.id == null) return;
      var pl = Array.isArray(d.placement) ? d.placement : (blank(d.placement) ? [] : [d.placement]);
      if (pl.some(function (p) { var m = placementKey(p); return m && m.key === key && !!m.line === !!line; })) out.push({ id: String(d.id), type: type, name: d.name, def: d }); }); });
    out.sort(function (a, b2) { var pa = blank(a.def.position) ? 1e9 : num(a.def.position), pb = blank(b2.def.position) ? 1e9 : num(b2.def.position); return pa - pb || String(a.name).localeCompare(String(b2.name)); });
    return out;
  }
  SFA.placementKey = placementKey; SFA.fieldsFor = fieldsFor;
  function optList(s) { return String(s || '').split(/\r?\n|,/).map(function (x) { return x.trim(); }).filter(Boolean); }
  var SIZE = { Small: '220px', Medium: '340px', Large: '520px' };
  /** one field's input. attrs carries the data-* the reader needs. */
  function cfInput(f, v, attrs, lock) {
    var d = f.def, ro = lock ? ' disabled' : '', w = SIZE[d.size] || '';
    switch (f.type) {
      case 'checkbox': return '<label class="sfa-chk"><input type="checkbox" ' + attrs + (v === true || v === 'true' || v === 1 || v === '1' ? ' checked' : '') + ro + '> ' + esc(f.name) + '</label>';
      case 'date': return '<input type="date" ' + attrs + ' value="' + esc(v || '') + '"' + ro + '>';
      case 'number': return '<input type="text" inputmode="decimal" class="sfa-num" ' + attrs + ' value="' + esc(v == null ? '' : v) + '"' + ro + '>';
      case 'image': return '<span class="sfa-img"><input type="hidden" ' + attrs + ' value="' + esc(v || '') + '">' + (v ? '<img src="' + esc(v) + '" alt="">' : '') +
        (lock ? '' : '<input type="file" accept="image/*" onchange="SettingsFixesA._img(this)">' + (v ? '<button type="button" class="btn btn-xs" onclick="SettingsFixesA._imgClear(this)">Remove</button>' : '')) + '</span>';
      case 'multi': { var opts = optList(d.options), cur = Array.isArray(v) ? v : optList(v);
        if (opts.length) return '<span class="sfa-multi" ' + attrs + '>' + opts.concat(cur.filter(function (x) { return opts.indexOf(x) < 0; })).map(function (o) { return '<label class="sfa-chk"><input type="checkbox" value="' + esc(o) + '"' + (cur.indexOf(o) >= 0 ? ' checked' : '') + ro + '> ' + esc(o) + '</label>'; }).join('') + '</span>';
        return '<textarea rows="2" placeholder="One value per line" ' + attrs + ro + '>' + esc(cur.join('\n')) + '</textarea>'; }
      default: {
        var st = w ? ' style="width:' + w + ';max-width:100%"' : '';
        if (d.type === 'Paragraph text') return '<textarea rows="3" ' + attrs + st + (lock ? ' readonly' : '') + '>' + esc(v || '') + '</textarea>';
        if (d.type === 'Drop-down list') { var o2 = optList(d.options); if (!blank(v) && o2.indexOf(v) < 0) o2.unshift(v);
          return '<select ' + attrs + st + ro + '><option value=""></option>' + o2.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'; }
        return '<input type="text" ' + attrs + st + ' value="' + esc(v == null ? '' : v) + '"' + (lock ? ' readonly' : '') + '>';
      }
    }
  }
  /** the value of one rendered input (by its data attribute element) */
  function cfRead(el, type) {
    if (!el) return '';
    if (type === 'checkbox') return !!el.checked;
    if (type === 'multi') { if (el.tagName === 'TEXTAREA') return optList(el.value);
      return Array.prototype.map.call(el.querySelectorAll('input:checked'), function (i) { return i.value; }); }
    if (type === 'number') { var s = String(el.value || '').trim(); if (!s) return ''; var A = app(); var n = A && A.parseNum ? A.parseNum(s) : num(s); return n === '' ? '' : n; }
    return String(el.value == null ? '' : el.value);
  }
  /** printed value (HTML) or '' when there is nothing to show */
  function cfDisplay(f, v) {
    var d = f.def;
    if (f.type === 'checkbox') return (v === true || v === 'true' || v === 1 || v === '1') ? '&#10003; Yes' : '';
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    if (f.type === 'date') return esc(fmtD(v));
    if (f.type === 'number') { var n = num(v); if (d.minDecimals && !blank(d.decimals)) return esc(n.toFixed(Math.max(0, Math.min(10, num(d.decimals))))); var A = app(); try { return esc(A.numStr ? A.numStr(n) : String(n)); } catch (e) { return esc(String(n)); } }
    if (f.type === 'image') { var w = num(d.width), h = num(d.height); return '<img class="sfa-pimg" src="' + esc(v) + '" alt="" style="' + (w ? 'max-width:' + w + 'px;' : 'max-width:180px;') + (h ? 'max-height:' + h + 'px' : 'max-height:120px') + '">'; }
    if (f.type === 'multi') return esc((Array.isArray(v) ? v : optList(v)).join(', '));
    return esc(v).split('\n').join('<br>');
  }
  /** plain text for list columns */
  function cfText(f, v) {
    if (f.type === 'checkbox') return (v === true || v === 'true' || v === 1 || v === '1') ? 'Yes' : '';
    if (v == null) return ''; if (Array.isArray(v)) return v.join(', ');
    if (f.type === 'image') return v ? '[image]' : '';
    return v;
  }
  SFA.cfDisplay = cfDisplay; SFA.cfText = cfText;

  /* ============================================================== 102-103  footers */
  function footerSlugs() { try { return Object.keys(SettingsPages.PAGES.footers.items).filter(function (s) { return s !== 'default'; }); } catch (e) { return []; } }
  function footerSlug(key) { var R = reg()[key]; if (!R || !R.label) return null; var s = String(R.label).toLowerCase().replace(/ /g, '-'); return footerSlugs().indexOf(s) >= 0 ? s : null; }
  /** footers a document type can carry: the default footer, then the type's own footers */
  function footersFor(b, key) {
    var slug = footerSlug(key); if (!slug) return [];
    var out = [], d = (b && b.details) || {};
    if (!blank(d.footer)) out.push({ id: 'default', name: 'Default footer', text: d.footer, def: 1 });
    (((b && b.footers) || {})[slug] || []).forEach(function (f) { if (f && f.id != null) out.push({ id: String(f.id), name: f.name || 'Footer', html: f.content || '' }); });
    return out;
  }
  function cleanHtml(h) { return String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''); }
  function footerBlockHtml(f) { return '<div class="iv-cfblock sfa-footer">' + (f.html != null ? cleanHtml(f.html) : esc(f.text).split('\n').join('<br>')) + '</div>'; }
  SFA.footersFor = footersFor; SFA.footerSlug = footerSlug;

  /* ======================================================= form extras: custom fields + footers */
  /** {cf, ft} HTML for a form. src = the stored record (edit) or the prefill (new); isPrefill drops "exclude from copying" fields */
  function extrasHtml(b, key, src, mode) {
    src = src || {}; var isNew = mode !== 'edit';
    var F = fieldsFor(b, key, false), cf = '';
    if (F.length) {
      cf = '<div class="sfa-cf" data-sfa-block="cf">' + F.map(function (f) {
        var v = (src.custom && src.custom[f.id] != null && !(isNew && f.def.noCopy)) ? src.custom[f.id] : '';
        var attrs = 'data-sfa-cf="' + esc(f.id) + '" data-sfa-t="' + f.type + '"';
        var inp = cfInput(f, v, attrs, !!f.def.locked);
        return '<div class="sfa-f sfa-f-' + f.type + '">' + (f.type === 'checkbox' ? '' : '<label class="fld">' + esc(f.name) + (f.def.locked ? ' <span class="sfa-lock" title="Locked for manual editing">&#128274;</span>' : '') + '</label>') + inp +
          (blank(f.def.description) ? '' : '<div class="sfa-hint">' + esc(f.def.description) + '</div>') + '</div>'; }).join('') + '</div>';
    }
    var FT = footersFor(b, key), ft = '';
    if (FT.length) {
      /* a record that chose footers keeps its choice; new documents (and older records, which always
         printed the default footer) start with the default footer ticked */
      var sel = Array.isArray(src.footers) ? src.footers.map(String) : null;
      ft = '<div class="sfa-ft" data-sfa-block="ft"><label class="fld">Footers</label><div class="sfa-ft-list">' + FT.map(function (f) {
        var on = sel ? sel.indexOf(f.id) >= 0 : !!f.def;
        return '<label class="sfa-chk"><input type="checkbox" data-sfa-ft="' + esc(f.id) + '"' + (on ? ' checked' : '') + '> ' + esc(f.name) + '</label>'; }).join('') + '</div></div>';
    }
    return { cf: cf, ft: ft };
  }
  /** read the extras back out of a form root: {custom?, footers?} */
  function readExtras(root) {
    if (!root || !root.querySelectorAll) return null; var out = {}, any = false;
    var cfs = root.querySelectorAll('[data-sfa-cf]'); if (cfs.length) { out.custom = {}; any = true;
      Array.prototype.forEach.call(cfs, function (el) { out.custom[el.getAttribute('data-sfa-cf')] = cfRead(el, el.getAttribute('data-sfa-t')); }); }
    if (root.querySelector('[data-sfa-block="ft"]')) { any = true; out.footers = Array.prototype.map.call(root.querySelectorAll('[data-sfa-ft]:checked'), function (i) { return i.getAttribute('data-sfa-ft'); }); }
    return any ? out : null;
  }
  SFA.extrasHtml = extrasHtml; SFA.readExtras = readExtras;
  /* Values captured from the form at save time are applied to the record the engine is about to
     store. Every engine (TxnForms, BankForm, payslip, Form Designer) logs the change with the
     record object right before App.saveBiz, so App._logActivity is the one place to apply them. */
  var PENDING = null;
  function applyExtras(rec, x) {
    if (!rec || !x) return rec;
    if (x.custom) { rec.custom = Object.assign({}, rec.custom || {}, x.custom); Object.keys(rec.custom).forEach(function (k) { var v = rec.custom[k]; if (v === '' || v == null) delete rec.custom[k]; }); }
    if (x.footers) rec.footers = x.footers.slice();
    return rec;
  }
  SFA.applyExtras = applyExtras;
  function withPending(key, root, fn) { var x = readExtras(root); if (!x && PENDING) return fn(); return withValues(key, x, fn); }
  function withValues(key, x, fn) { PENDING = x ? { key: key, x: x } : null; try { return fn(); } finally { PENDING = null; } }
  /** run a save with these extras pending (tests; DOM-free) */
  SFA._withValues = withValues;
  /* inject the extras into a mounted form */
  function srcFor(A, b, key, prefill) {
    if (A.editingId != null) { var r = recs(b, key).filter(function (x) { return x.id === A.editingId; })[0]; if (r) return { src: r, mode: 'edit' }; }
    return { src: prefill || null, mode: 'new' };
  }
  function injectExtras(root, before, ftBefore, b, key, src, mode) {
    if (!root || root.querySelector('[data-sfa-block]')) return;
    var x = extrasHtml(b, key, src, mode); if (!x.cf && !x.ft) return;
    var put = function (html, ref, parent) { if (!html) return; var w = doc().createElement('div'); w.className = 'sfa-extras'; w.innerHTML = html; if (ref && ref.parentNode) ref.parentNode.insertBefore(w, ref); else (parent || root).appendChild(w); };
    put(x.cf, before, root); put(x.ft, ftBefore || null, root);
  }

  /* =================================================== 104-105 + 62  payslip form */
  var PS_SECS = [['earnings', 'Earnings', 'Earning'], ['deductions', 'Deductions', 'Deduction'], ['contributions', 'Contributions', 'Contribution']];
  function psItems(b, sec) {
    var L = (b && b.payslipItems && b.payslipItems[sec]);
    if (!L && sec === 'earnings') { try { L = SettingsPages.rows('payslipItems/earnings', b); } catch (e) { L = null; } }
    return (L || []).filter(function (x) { return x && !blank(x.name); });
  }
  function psItem(b, sec, id, name) { var L = psItems(b, sec); return L.filter(function (x) { return id != null && id !== '' && String(x.id) === String(id); })[0] || L.filter(function (x) { return !blank(name) && String(x.name).trim().toLowerCase() === String(name).trim().toLowerCase(); })[0] || null; }
  var PS = null;
  /* FIX_SPEC_3 #3 — days in period / absent on the payslip, through js/payroll.js (Payroll.daysCalc):
     Basic salary stays in full and an "Absent deduction" line is added; earnings ticked Pro-rata are
     paid for the days worked inside their own line (the form keeps the monthly amount). */
  function PRL() { var P = global.Payroll; return P && typeof P.daysCalc === 'function' ? P : null; }
  function psDefDays(b, date) { var P = PRL(); return P ? P.periodDays(b, String(date || '').slice(0, 7)) : 0; }
  /** the days maths for the form state: Payroll.daysCalc result over the earnings lines (or null) */
  function psCalc(b, t) { var P = PRL(); if (!P || !t) return null;
    return P.daysCalc(b, t.lines.earnings.map(function (l) { return { sec: 'earnings', itemId: l.itemId, item: l.item, amount: l.amount }; }), t.daysTotal, t.daysAbsent); }
  function psStart(b, rec, mode) {
    rec = rec || {}; var A = app();
    var t = { mode: mode, id: mode === 'edit' ? rec.id : null, date: String(rec.date || rec.issueDate || '').slice(0, 10) || today(), employee: rec.employee || rec.empName || '',
      description: rec.description || rec.narration || '', reference: mode === 'edit' ? (rec.reference || '') : (blank(rec.reference) ? '' : rec.reference), autoRef: mode !== 'edit' && blank(rec.reference),
      lines: { earnings: [], deductions: [], contributions: [] }, src: rec };
    var dt = psDefDays(b, t.date), hasDays = rec.daysTotal != null && rec.daysTotal !== '';
    t.daysTotal = hasDays ? String(rec.daysTotal) : (dt ? String(dt) : ''); t.daysAuto = !hasDays || num(rec.daysTotal) === dt; t.daysAbsent = num(rec.daysAbsent) ? String(rec.daysAbsent) : '';
    if (t.autoRef) { try { t.reference = A.nextRef(b, 'payslips'); } catch (e) { t.reference = ''; } }
    (rec.lines || []).forEach(function (ln) { if (!ln || ln.absent) return; /* the Absent deduction is worked out again from the days */
      var a = num(ln.amount != null && ln.amount !== '' ? ln.amount : (ln.net != null && ln.net !== '' ? ln.net : ln.amountNoTax));
      if (ln.proRata && ln.fullAmount != null && ln.fullAmount !== '') a = Math.abs(num(ln.fullAmount)); /* a pro-rated line: edit the monthly amount */
      var pt = String(ln.ptype || ln.type || '').toLowerCase(); var sec = pt === 'contribution' ? 'contributions' : ((pt === 'deduction' || a < 0) ? 'deductions' : 'earnings');
      var nm = ln.item || ln.items || ''; var it = psItem(b, sec, ln.itemId, nm) || (blank(nm) ? psItem(b, sec, null, ln.desc || ln.description) : null);
      var d = ln.desc != null && ln.desc !== '' ? ln.desc : (ln.description || '');
      if (ln.proRata && it && d.indexOf(it.name + ' — ') === 0) d = ''; /* the generated "N days of M" text is rebuilt on save */
      t.lines[sec].push({ itemId: it ? String(it.id) : '', item: it ? it.name : nm, desc: (it && d === it.name) ? '' : d, amount: a ? String(Math.abs(a)) : '' }); });
    PS_SECS.forEach(function (s) { if (!t.lines[s[0]].length) t.lines[s[0]].push({ itemId: '', item: '', desc: '', amount: '' }); });
    return t;
  }
  function psTotals(t) { var s = {}; PS_SECS.forEach(function (x) { s[x[0]] = r2(t.lines[x[0]].reduce(function (a, l) { return a + num(l.amount); }, 0)); });
    var c = null; try { c = psCalc(app().curBiz(), t); } catch (e) { c = null; }
    s.absentDed = 0; s.worked = c ? c.worked : 0;
    if (c && c.on) { s.earnings = r2(c.rows.reduce(function (a, r) { return a + r.earned; }, 0)); s.absentDed = c.absentDed; s.deductions = r2(s.deductions + c.absentDed); }
    s.net = r2(s.earnings - s.deductions); return s; }
  function psRowsHtml(b, t, sec) {
    var items = psItems(b, sec);
    return t.lines[sec].map(function (l, i) {
      var opts = '<option value="">— select item —</option>' + items.map(function (it) { return '<option value="' + esc(it.id) + '"' + (String(it.id) === String(l.itemId) ? ' selected' : '') + '>' + esc(it.name) + '</option>'; }).join('') +
        ((l.itemId === '' && !blank(l.item)) ? '<option value="" selected>' + esc(l.item) + '</option>' : '');
      var P = '\'' + sec + '\',' + i, PR = PRL(), pk = PR && sec === 'earnings' ? PR.proKind(b, sec, l.itemId, l.item) : '';
      return '<tr><td><select data-ps="' + sec + ':' + i + ':itemId" onchange="SettingsFixesA.ps._item(' + P + ',this.value)">' + opts + '</select>' + (pk === 'prorata' ? '<small class="pr-ps-tag">Pro-rata</small>' : '') + '</td>' +
        '<td><input type="text" value="' + esc(l.desc) + '" placeholder="' + esc(l.item || '') + '" oninput="SettingsFixesA.ps._set(' + P + ',\'desc\',this.value)"></td>' +
        '<td class="r"><input type="text" inputmode="decimal" class="r sfa-num" value="' + esc(l.amount) + '" oninput="SettingsFixesA.ps._set(' + P + ',\'amount\',this.value)"' + (pk === 'prorata' ? ' title="Monthly amount — paid for the days worked"' : '') + '>' +
          (pk === 'prorata' ? '<div class="pr-earned" data-ps-pro="' + i + '">' + esc(psProHint(b, t, i)) + '</div>' : '') + '</td>' +
        '<td class="act"><button type="button" tabindex="-1" title="Move up" onclick="SettingsFixesA.ps._mv(' + P + ',-1)">↑</button><button type="button" tabindex="-1" title="Move down" onclick="SettingsFixesA.ps._mv(' + P + ',1)">↓</button>' +
        '<button type="button" tabindex="-1" title="Duplicate line" onclick="SettingsFixesA.ps._dup(' + P + ')">⧉</button><button type="button" tabindex="-1" title="Remove line" onclick="SettingsFixesA.ps._rm(' + P + ')">×</button></td></tr>'; }).join('');
  }
  function psSecHtml(b, t, s) {
    var none = !psItems(b, s[0]).length;
    return '<div class="sfa-ps-sec" data-ps-sec="' + s[0] + '"><div class="sfa-ps-h">' + s[1] + '</div>' +
      (none ? '<div class="sfa-hint">No ' + s[1].toLowerCase() + ' items yet — add them in <a class="led-link" onclick="SettingsFixesA.openPayslipItems(\'' + s[0] + '\')">Settings → Payslip Items</a>.</div>' : '') +
      '<div class="sfa-ps-wrap"><table class="sfa-ps-t"><thead><tr><th>Item</th><th>Description</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + psRowsHtml(b, t, s[0]) + (s[0] === 'deductions' ? psAbsentRow(b, t) : '') + '</tbody>' +
      '<tfoot><tr><td colspan="2" class="r">Total ' + s[1].toLowerCase() + '</td><td class="r m" data-ps-tot="' + s[0] + '">' + money(psTotals(t)[s[0]]) + '</td><td></td></tr></tfoot></table></div>' +
      '<button type="button" class="btn btn-sm" onclick="SettingsFixesA.ps._add(\'' + s[0] + '\')">▸ Add line</button></div>';
  }
  function psProHint(b, t, i) { var c = psCalc(b, t); if (!c || !c.on || !c.rows[i] || c.rows[i].kind !== 'prorata') return ''; return '= ' + money(c.rows[i].earned) + ' for ' + c.worked + ' of ' + c.total + ' days'; }
  function psAbsentTxt(c) { return c && c.on && c.absentDed > 0 ? c.absent + ' day' + (c.absent === 1 ? '' : 's') + ' absent × ' + (c.basicName || 'Basic salary') + ' ' + money(c.basic) + ' ÷ ' + c.total + ' days' : ''; }
  function psAbsentRow(b, t) { if (!PRL()) return ''; var c = psCalc(b, t), on = !!(c && c.on && c.absentDed > 0);
    return '<tr class="pr-ps-auto" data-ps-absent' + (on ? '' : ' hidden') + '><td><span class="pr-ps-auto-n">Absent deduction</span><small class="pr-ps-tag">Automatic</small></td><td class="pr-ps-auto-d" data-ps-absent-d>' + esc(psAbsentTxt(c)) + '</td>' +
      '<td class="r m" data-ps-absent-a>' + money(on ? c.absentDed : 0) + '</td><td></td></tr>'; }
  function psDaysHtml(b, t) { if (!PRL()) return ''; var P = PRL(), c = psCalc(b, t), err = P.daysError(t.daysTotal, t.daysAbsent);
    return '<div class="tf-row2 pr-ps-days" id="psDays"><div class="tf-f"><label class="tf-l" for="ps_dtot">Total days in period</label><input type="text" inputmode="decimal" id="ps_dtot" value="' + esc(t.daysTotal) + '" oninput="SettingsFixesA.ps._days(\'daysTotal\',this.value)" style="width:110px">' +
        '<small class="pr-f-h" data-ps-basis>' + esc(t.daysAuto ? P.basisLabel(b) : 'Entered by hand') + '</small></div>' +
      '<div class="tf-f"><label class="tf-l" for="ps_dabs">Days absent</label><input type="text" inputmode="decimal" id="ps_dabs" placeholder="0" value="' + esc(t.daysAbsent) + '" oninput="SettingsFixesA.ps._days(\'daysAbsent\',this.value)" style="width:110px"' + (err ? ' class="pr-bad" aria-invalid="true" title="' + esc(err) + '"' : '') + '></div>' +
      '<div class="tf-f"><label class="tf-l" for="ps_dwk">Days worked</label><input type="text" id="ps_dwk" readonly tabindex="-1" class="pr-ro" value="' + esc(err ? '' : (c && c.total ? String(c.worked) : '')) + '" style="width:110px"></div></div>'; }
  function psBodyHtml(b, t) {
    var emps = recs(b, 'employees').filter(function (e) { return e && e.name; }), cur = t.employee;
    var empRec = emps.filter(function (e) { return e.name === cur; })[0];
    var eopts = '<option value="">— select employee —</option>' + (cur && !empRec ? '<option selected>' + esc(cur) + '</option>' : '') +
      emps.map(function (e) { return '<option value="' + esc(e.name) + '"' + (e.name === cur ? ' selected' : '') + '>' + esc((e.code ? e.code + ' - ' : '') + e.name) + '</option>'; }).join('');
    var T = psTotals(t);
    return '<div class="tf-row2">' +
        '<div class="tf-f"><label class="tf-l">Date</label><input type="date" value="' + esc(t.date) + '" onchange="SettingsFixesA.ps._hdr(\'date\',this.value)" style="width:170px"></div>' +
        '<div class="tf-f"><label class="tf-l">Reference</label><div class="tf-ig"><span><input type="checkbox" title="Automatic"' + (t.autoRef ? ' checked' : '') + ' onchange="SettingsFixesA.ps._auto(this.checked)"></span>' +
          '<input type="text" id="ps_ref" value="' + esc(t.reference) + '"' + (t.autoRef ? ' readonly tabindex="-1"' : '') + ' oninput="SettingsFixesA.ps._hdr(\'reference\',this.value)" style="width:120px"></div></div></div>' +
      '<div class="tf-f"><label class="tf-l">Employee</label><div class="tf-ig wide"><select id="ps_emp" data-qc-source="employee" onchange="SettingsFixesA.ps._emp(this.value)" style="min-width:260px">' + eopts + '</select>' +
        '<span class="sfa-code" id="ps_code">' + (empRec && empRec.code ? esc('Code: ' + empRec.code) : '') + '</span></div></div>' +
      psDaysHtml(b, t) +
      '<div class="tf-f" style="max-width:600px"><label class="tf-l">Description</label><input type="text" value="' + esc(t.description) + '" placeholder="Optional" oninput="SettingsFixesA.ps._hdr(\'description\',this.value)" style="width:100%"></div>' +
      '<div class="sfa-ps-secs">' + PS_SECS.map(function (s) { return psSecHtml(b, t, s); }).join('') + '</div>' +
      '<div class="sfa-ps-sum"><div><span>Total earnings</span><b data-ps-sum="earnings">' + money(T.earnings) + '</b></div><div><span>Total deductions</span><b data-ps-sum="deductions">' + money(T.deductions) + '</b></div>' +
        '<div class="grand"><span>Net pay</span><b data-ps-sum="net">' + money(T.net) + '</b></div><div class="muted"><span>Employer contributions</span><b data-ps-sum="contributions">' + money(T.contributions) + '</b></div></div>';
  }
  function psDraw() { var b = app().curBiz(), h = byId('psBody'); if (!b || !h || !PS) return; h.innerHTML = psBodyHtml(b, PS); try { if (global.QuickCreate) QuickCreate.scan(h); } catch (e) {} }
  function psUpdTotals() { var h = byId('psForm'); if (!h || !PS) return; var T = psTotals(PS), b = app().curBiz();
    Object.keys(T).forEach(function (k) { var a = h.querySelector('[data-ps-sum="' + k + '"]'); if (a) a.textContent = money(T[k]); var c = h.querySelector('[data-ps-tot="' + k + '"]'); if (c) c.textContent = money(T[k]); });
    if (!PRL()) return; var c = psCalc(b, PS), on = !!(c && c.on && c.absentDed > 0), P = PRL(), err = P.daysError(PS.daysTotal, PS.daysAbsent);
    var row = h.querySelector('[data-ps-absent]'); if (row) { if (on) row.removeAttribute('hidden'); else row.setAttribute('hidden', ''); var d = row.querySelector('[data-ps-absent-d]'); if (d) d.textContent = psAbsentTxt(c); var a = row.querySelector('[data-ps-absent-a]'); if (a) a.textContent = money(on ? c.absentDed : 0); }
    var wk = byId('ps_dwk'); if (wk) wk.value = err ? '' : (c && c.total ? String(c.worked) : '');
    var ab = byId('ps_dabs'); if (ab) { ab.classList.toggle('pr-bad', !!err); if (err) { ab.setAttribute('aria-invalid', 'true'); ab.setAttribute('title', err); } else { ab.removeAttribute('aria-invalid'); ab.removeAttribute('title'); } }
    PS.lines.earnings.forEach(function (l, i) { var e = h.querySelector('[data-ps-sec="earnings"] [data-ps-pro="' + i + '"]'); if (e) e.textContent = psProHint(b, PS, i); }); }
  function psBuild(b, t) {
    var lines = [], c = psCalc(b, t), ei = -1;
    PS_SECS.forEach(function (s) { t.lines[s[0]].forEach(function (l) {
      if (s[0] === 'earnings') ei++;
      if (!num(l.amount) && blank(l.itemId) && blank(l.desc) && blank(l.item)) return;
      var it = psItem(b, s[0], l.itemId, l.item), a = Math.abs(num(l.amount));
      var accId = it ? (s[0] === 'contributions' ? (it.expense || '') : (it.account || '')) : '';
      var n = acct(b, accId);
      var o = { ptype: s[2], item: it ? it.name : (l.item || ''), itemId: it ? String(it.id) : '', desc: blank(l.desc) ? (it ? it.name : (l.item || '')) : l.desc,
        account: n ? n.id : '', accountName: n ? n.name : '', amount: a, net: a, amountNoTax: a, totalWithTax: a, taxAmt: 0, qty: '', price: '' };
      var cr = s[0] === 'earnings' && c ? c.rows[ei] : null;
      if (cr && c.on && cr.kind === 'prorata') { var e = Math.abs(cr.earned); o.proRata = true; o.fullAmount = a; o.amount = o.net = o.amountNoTax = o.totalWithTax = e; if (blank(l.desc)) o.desc = PRL().proDesc(o.item || o.desc, c, a); }
      o.description = o.desc;
      if (s[0] === 'contributions') { var la = acct(b, it && it.liability); o.liabilityAccount = la ? la.id : ''; o.liabilityAccountName = la ? la.name : ''; }
      lines.push(o); }); });
    if (c && c.on && c.absentDed > 0) { var ad = PRL().absentLine(b, c), di = lines.findIndex(function (x) { return String(x.ptype).toLowerCase() === 'contribution'; }); if (di < 0) lines.push(ad); else lines.splice(di, 0, ad); }
    var T = psTotals(t);
    var out = { date: t.date, issueDate: t.date, reference: t.reference, employee: t.employee, empName: t.employee, description: t.description, narration: t.description,
      lines: lines, earnings: T.earnings, deductions: T.deductions, contributions: T.contributions, netPay: T.net, total: T.net, subtotal: T.net, amount: T.net, tax: 0, balanceDue: T.net };
    if (c && c.total > 0) { out.daysTotal = c.total; out.daysAbsent = c.absent; out.daysWorked = c.worked; out.daysBasis = t.daysAuto ? PRL().paySettings(b).basis : 'manual'; }
    return out;
  }
  function psValidate(b, t) {
    var E = [];
    if (!t.date) E.push('Date is required.');
    if (blank(t.employee)) E.push('Select an employee.');
    var any = false; PS_SECS.forEach(function (s) { t.lines[s[0]].forEach(function (l, i) { if (num(l.amount)) { any = true; if (blank(l.itemId) && blank(l.item) && blank(l.desc)) E.push(s[1] + ' line ' + (i + 1) + ': select an item.'); } }); });
    if (!any) E.push('Enter at least one amount.');
    if (PRL()) { var de = PRL().daysError(t.daysTotal, t.daysAbsent); if (de) E.push('Days: ' + de); if (!de && num(t.daysAbsent) > 0 && psTotals(t).net < 0) E.push('Deductions are more than earnings (net pay ' + money(psTotals(t).net) + ').'); }
    if (!t.autoRef && !blank(t.reference) && recs(b, 'payslips').some(function (x) { return String(x.reference || '') === String(t.reference) && x.id !== t.id; })) E.push('Reference ' + t.reference + ' is already used by another payslip.');
    var lk = b.lockDate || ''; if (lk) { var od = ''; if (t.id != null) { var old = recs(b, 'payslips').filter(function (x) { return x.id === t.id; })[0]; if (old) od = String(old.date || old.issueDate || '').slice(0, 10); }
      if ((t.date && t.date <= lk) || (od && od <= lk)) E.push('Date falls on or before the lock date (' + lk + '). Change the date, or update Settings → Lock Date.'); }
    return E;
  }
  var PayslipForm = {
    start: psStart, build: psBuild, validate: psValidate, totals: psTotals,
    state: function () { return PS; }, setState: function (t) { PS = t; },
    html: function (b) {
      var A = app(), R = reg().payslips || {}, rec = null, mode = 'new';
      if (A.editingId != null) { rec = recs(b, 'payslips').filter(function (r) { return r.id === A.editingId; })[0] || null; if (rec) mode = 'edit'; }
      var pf = null; if (!rec && A._prefill) { pf = clone(A._prefill); rec = pf; }
      PS = psStart(b, rec, mode); if (mode === 'new') A._prefill = null;
      var x = extrasHtml(b, 'payslips', mode === 'edit' ? rec : pf, mode);
      var lbl = R.label || 'Payslips', title = mode === 'edit' ? ('Payslip' + (PS.reference ? ' ' + PS.reference : '')) : (R.newLabel || 'New Payslip');
      var can = function (fn) { return typeof A[fn] === 'function' ? !!A[fn](b, lbl) : true; };
      var btns = mode === 'edit'
        ? (can('canEdit') ? '<button type="button" class="btn btn-primary" onclick="SettingsFixesA.ps.save(\'update\')">Update</button>' : '') +
          (can('canCreate') ? '<button type="button" class="btn" onclick="App.cloneRecord()">Clone</button>' : '') +
          (can('canDelete') ? '<button type="button" class="btn btn-danger" onclick="App.deleteRecord(' + JSON.stringify(PS.id) + ')">Delete</button>' : '')
        : '<button type="button" class="btn btn-primary" onclick="SettingsFixesA.ps.save(\'create\')">Create</button><button type="button" class="btn" onclick="SettingsFixesA.ps.save(\'another\')">Create &amp; add another</button>';
      var crumb = ''; try { crumb = A.recCrumb(lbl, title); } catch (e) {}
      return crumb + '<div class="card tf-card sfa-psf" id="psForm" data-enter-nav="off"><div class="tf-card-h"><h2>Payslip</h2></div><div id="psErr"></div>' +
        '<div id="psBody">' + psBodyHtml(b, PS) + '</div>' + (x.cf ? '<div class="sfa-extras">' + x.cf + '</div>' : '') + (x.ft ? '<div class="sfa-extras">' + x.ft + '</div>' : '') +
        '<div class="form-actions">' + btns + '<button type="button" class="btn" onclick="SettingsFixesA.ps.cancel()">Cancel</button>' +
        '<a class="tf-engine" role="button" tabindex="-1" onclick="TxnForms.setEngine(\'payslips\',\'designed\')" title="Switch payslips to the Form Designer layout">Use Form Designer for this form</a></div></div>';
    },
    mount: function () { var h = byId('psForm'); if (!h) return; try { if (global.QuickCreate) QuickCreate.scan(h); } catch (e) {} },
    _hdr: function (k, v) { if (!PS) return; PS[k] = v;
      if (k === 'date' && PS.daysAuto && PRL()) { var dt = psDefDays(app().curBiz(), v); if (dt) { PS.daysTotal = String(dt); var el = byId('ps_dtot'); if (el) el.value = PS.daysTotal; psUpdTotals(); } } },
    _days: function (k, v) { if (!PS) return; PS[k] = v; if (k === 'daysTotal') { PS.daysAuto = false; var bs = byId('psDays'); var s = bs && bs.querySelector('[data-ps-basis]'); if (s) s.textContent = 'Entered by hand'; } psUpdTotals(); },
    _auto: function (on) { var A = app(); if (!PS) return; PS.autoRef = !!on; if (on) { try { PS.reference = A.nextRef(A.curBiz(), 'payslips'); } catch (e) {} } psDraw(); var r = byId('ps_ref'); if (r && !on) try { r.focus(); } catch (e) {} },
    _emp: function (v) { if (!PS) return; PS.employee = v || ''; var b = app().curBiz(); var e = recs(b, 'employees').filter(function (x) { return x.name === v; })[0]; var c = byId('ps_code'); if (c) c.textContent = e && e.code ? 'Code: ' + e.code : ''; },
    _item: function (sec, i, v) { if (!PS) return; var l = PS.lines[sec][i]; if (!l) return; var it = psItem(app().curBiz(), sec, v, null); l.itemId = it ? String(it.id) : ''; l.item = it ? it.name : ''; psDraw(); },
    _set: function (sec, i, f, v) { if (!PS || !PS.lines[sec][i]) return; PS.lines[sec][i][f] = v; if (f === 'amount') psUpdTotals(); },
    _add: function (sec) { if (!PS) return; PS.lines[sec].push({ itemId: '', item: '', desc: '', amount: '' }); psDraw(); },
    _rm: function (sec, i) { if (!PS) return; PS.lines[sec].splice(i, 1); if (!PS.lines[sec].length) PS.lines[sec].push({ itemId: '', item: '', desc: '', amount: '' }); psDraw(); },
    _dup: function (sec, i) { if (!PS || !PS.lines[sec][i]) return; PS.lines[sec].splice(i + 1, 0, clone(PS.lines[sec][i])); psDraw(); },
    _mv: function (sec, i, d) { if (!PS) return; var L = PS.lines[sec], j = i + d; if (j < 0 || j >= L.length) return; var x = L[i]; L[i] = L[j]; L[j] = x; psDraw(); },
    cancel: function () { var A = app(); PS = null; if (!(A.backFromRecord && A.backFromRecord())) A.backToList(); },
    /** act: create | another | update. opts.noNav for tests. Returns the stored record or {errors}. */
    save: function (act, opts) {
      opts = opts || {}; var A = app(), b = A.curBiz(); if (!b || !PS) return null;
      var editing = PS.mode === 'edit' && PS.id != null, lbl = k2l().payslips || 'Payslips', perm = editing ? 'canEdit' : 'canCreate';
      if (typeof A[perm] === 'function') { if (!A[perm](b, lbl)) { alert('Your permissions do not allow ' + (editing ? 'changing' : 'creating') + ' payslips.'); return null; } }
      else if (A.guardWrite && !A.guardWrite(b)) return null;
      var E = psValidate(b, PS), box = byId('psErr');
      if (E.length) { if (box) box.innerHTML = '<div class="tf-errbox" role="alert">' + E.map(esc).join('<br>') + '</div>'; return { errors: E }; }
      if (box) box.innerHTML = '';
      var x = readExtras(byId('psForm'));
      var rec = psBuild(b, PS), arr = ((b.records = b.records || {}).payslips || []).slice(), before = null;
      if (editing) { var idx = arr.findIndex(function (r) { return r.id === PS.id; }); before = idx >= 0 ? clone(arr[idx]) : null;
        var merged = Object.assign({}, idx >= 0 ? arr[idx] : {}, rec); merged.id = PS.id; if (!merged.uuid) merged.uuid = A.uuid(); if (idx >= 0) arr[idx] = merged; else arr.push(merged); rec = merged; }
      else { if (PS.autoRef || blank(rec.reference)) rec.reference = A.nextRef(b, 'payslips'); rec.id = Date.now() + Math.floor(Math.random() * 1000); rec.uuid = A.uuid(); arr.push(rec); }
      if (x) applyExtras(rec, x);
      b.records.payslips = arr;
      try { if (b.coa) { G('ensureAllControls')(b); } } catch (e) {}
      try { G('refreshSummary')(b); } catch (e) {}
      try { A._logActivity(b, editing ? 'update' : 'create', 'payslips', rec, before); } catch (e) {}
      A.saveBiz(b); toast(editing ? 'Updated' : 'Created');
      if (opts.noNav) return rec;
      PS = null;
      if (act === 'another') { A.editingId = null; A._prefill = null; A.recReturn = null; A.wsMode = 'form'; A.renderMain(A.curBiz()); return rec; }
      A.editingId = null; if (!(A.backFromRecord && A.backFromRecord())) A.backToList();
      return rec;
    }
  };
  SFA.ps = PayslipForm;
  /** the payslip View: Earnings / Deductions / Contributions sections */
  /* FIX_SPEC_5 A7 — payslip print / PDF: header (employee, ID, period, payroll date, days), then
     A. Earnings → Gross earnings; B. Salary deductions → Total, = Salary for the period; C. Recoveries – loan / advance
     → Total, = Net pay; D. Account summary; E. Loan / advance status. A section with no amounts is left out. */
  function payslipViewBody(b, rec) {
    var P = global.Payroll; if (P && typeof P.payslipSections === 'function') { try { return payslipSectionsHtml(b, rec, P.payslipSections(b, rec)); } catch (e) { if (global.console) console.warn('payslip sections', e); } }
    return payslipViewBodyOld(b, rec);
  }
  function balWord(v) { return v > 0.004 ? 'Payable ' + money(v) : (v < -0.004 ? 'Overpaid ' + money(-v) : 'Settled'); }
  function payslipSectionsHtml(b, rec, s) {
    var h = '', H = s.header || {}, dd = H.days || {};
    h += '<div class="pr-psp-h"><dl>' + [['Employee', H.employee], ['Employee ID', H.code], ['Period', H.period], ['Payroll date', H.date ? fmtD(H.date) : '']].filter(function (x) { return !blank(x[1]); })
      .map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (dd.daysTotal != null ? '<div class="pr-ps-vdays"><span>Total days in period <b>' + esc(String(dd.daysTotal)) + '</b></span><span>Days absent <b>' + esc(String(dd.daysAbsent || 0)) + '</b></span><span>Days worked <b>' + esc(String(dd.daysWorked)) + '</b></span></div>' : '') + '</div>';
    var tbl = function (letter, title, L, totLbl, tot, after) { if (!L.length) return '';
      return '<div class="iv-twrap sfa-ps-view pr-psp-sec" data-psp="' + letter + '"><table class="iv-table"><thead><tr class="iv-thr"><th style="text-align:left">' + esc(letter ? letter + '. ' + title : title) + '</th><th style="text-align:left">Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>' +
        L.map(function (x, i) { return '<tr class="iv-row' + (i === L.length - 1 ? ' iv-lastrow' : '') + '"><td>' + esc(x.name) + '</td><td>' + esc(x.desc) + '</td><td style="text-align:right">' + money(x.amount) + '</td></tr>'; }).join('') +
        '<tr class="iv-tot"><td colspan="2">' + esc(totLbl) + '</td><td class="iv-totbox">' + money(tot) + '</td></tr>' + (after || '') + '</tbody></table></div>'; };
    var eq = function (lbl, v) { return '<tr class="iv-tot pr-psp-eq"><td colspan="2">= ' + esc(lbl) + '</td><td class="iv-totbox">' + money(v) + '</td></tr>'; };
    h += tbl('A', 'Earnings', s.earnings, 'Gross earnings', s.gross);
    h += tbl('B', 'Salary deductions', s.salDed, 'Total salary deductions', s.salTotal, eq('Salary for the period', s.cost));
    h += tbl('C', 'Recoveries – loan / advance', s.recov, 'Total recoveries', s.recTotal, eq('Net pay', s.net));
    if (s.contributions.length) h += tbl('', 'Employer contributions (paid by the employer, not deducted)', s.contributions, 'Total employer contributions', s.contrib);
    h += '<div class="iv-belowtbl"><div class="iv-bl-left"></div><div class="iv-bl-right"><div class="iv-totbox2"><div class="iv-totrow"><span>Gross earnings</span><span>' + money(s.gross) + '</span></div>' +
      (s.salDed.length ? '<div class="iv-totrow"><span>Salary deductions</span><span>' + money(s.salTotal) + '</span></div><div class="iv-totrow"><span>Salary for the period</span><span>' + money(s.cost) + '</span></div>' : '') +
      (s.recov.length ? '<div class="iv-totrow"><span>Recoveries</span><span>' + money(s.recTotal) + '</span></div>' : '') +
      '<div class="iv-totrow iv-totrow-g"><span>Net pay</span><span>' + money(s.net) + '</span></div></div></div></div>';
    var A = s.account || {};
    if (Math.abs(A.opening || 0) > 0.004 || Math.abs(A.paid || 0) > 0.004 || Math.abs(A.net || 0) > 0.004)
      h += '<div class="iv-twrap sfa-ps-view pr-psp-sec" data-psp="D"><table class="iv-table"><thead><tr class="iv-thr"><th style="text-align:left" colspan="2">D. Account summary</th><th style="text-align:right">Amount</th></tr></thead><tbody>' +
        '<tr class="iv-row"><td colspan="2">Opening balance</td><td style="text-align:right">' + esc(balWord(A.opening)) + '</td></tr>' +
        '<tr class="iv-row"><td colspan="2">+ Net pay</td><td style="text-align:right">' + money(A.net) + '</td></tr>' +
        (Math.abs(A.paid) > 0.004 ? '<tr class="iv-row"><td colspan="2">− Paid</td><td style="text-align:right">' + money(A.paid) + '</td></tr>' : '') +
        '<tr class="iv-tot"><td colspan="2">= Closing balance</td><td class="iv-totbox">' + esc(balWord(A.closing)) + '</td></tr></tbody></table></div>';
    if ((s.loans || []).length)
      h += '<div class="iv-twrap sfa-ps-view pr-psp-sec" data-psp="E"><table class="iv-table"><thead><tr class="iv-thr"><th style="text-align:left">E. Loan / advance status</th><th style="text-align:right">Opening outstanding</th><th style="text-align:right">Recovered this month</th><th style="text-align:right">Closing outstanding</th></tr></thead><tbody>' +
        s.loans.map(function (x) { return '<tr class="iv-row"><td>' + esc(x.name) + '</td><td style="text-align:right">' + money(x.opening) + '</td><td style="text-align:right">' + money(x.recovered) + '</td><td style="text-align:right">' + money(x.closing) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return h;
  }
  function payslipViewBodyOld(b, rec) {
    var lns = (rec.lines || []).filter(Boolean), by = { earnings: [], deductions: [], contributions: [] };
    lns.forEach(function (l) { var a = num(l.amount != null && l.amount !== '' ? l.amount : l.net); var pt = String(l.ptype || l.type || '').toLowerCase();
      by[pt === 'contribution' ? 'contributions' : ((pt === 'deduction' || a < 0) ? 'deductions' : 'earnings')].push({ l: l, a: Math.abs(a) }); });
    var tot = {}; var h = '';
    var P = global.Payroll, dd = P && P.psDays ? P.psDays(rec) : null;
    if (dd && dd.daysTotal != null) h += '<div class="pr-ps-vdays"><span>Total days in period <b>' + esc(String(dd.daysTotal)) + '</b></span><span>Days absent <b>' + esc(String(dd.daysAbsent || 0)) + '</b></span><span>Days worked <b>' + esc(String(dd.daysWorked)) + '</b></span></div>';
    PS_SECS.forEach(function (s) { var L = by[s[0]]; tot[s[0]] = r2(L.reduce(function (x, y) { return x + y.a; }, 0)); if (!L.length) return;
      h += '<div class="iv-twrap sfa-ps-view"><table class="iv-table"><thead><tr class="iv-thr"><th style="text-align:left">' + s[1] + '</th><th style="text-align:left">Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>' +
        L.map(function (x, i) { var it = x.l.item || ''; var d = x.l.desc || x.l.description || ''; return '<tr class="iv-row' + (i === L.length - 1 ? ' iv-lastrow' : '') + '"><td>' + esc(it || d) + '</td><td>' + esc(it && d !== it ? d : '') + '</td><td style="text-align:right">' + money(x.a) + '</td></tr>'; }).join('') +
        '<tr class="iv-tot"><td colspan="2">Total ' + s[1].toLowerCase() + '</td><td class="iv-totbox">' + money(tot[s[0]]) + '</td></tr></tbody></table></div>'; });
    var net = rec.netPay != null && rec.netPay !== '' ? num(rec.netPay) : r2(tot.earnings - tot.deductions);
    h += '<div class="iv-belowtbl"><div class="iv-bl-left"></div><div class="iv-bl-right"><div class="iv-totbox2"><div class="iv-totrow"><span>Total earnings</span><span>' + money(tot.earnings) + '</span></div>' +
      '<div class="iv-totrow"><span>Total deductions</span><span>' + money(tot.deductions) + '</span></div><div class="iv-totrow iv-totrow-g"><span>Net pay</span><span>' + money(net) + '</span></div></div></div></div>';
    return h;
  }

  /* ============================================================ 106-108  starting balances */
  function sbBsAccounts(b) { return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && !n.control && sideOf(b, n) === 'bs'; }); }
  function cashCtrl(b, n) { try { return GL.subKind(b, n) === 'bankCash'; } catch (e) { return !!n.cashControl; } }
  var SB_BS_STORE = {
    get: function (b) { return ((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && num(n.balance) !== 0 && !cashCtrl(b, n); }).map(function (n) {
      var v = num(n.balance), d = natureD(b, n), dr = d ? (v > 0 ? v : 0) : (v < 0 ? -v : 0), cr = d ? (v < 0 ? -v : 0) : (v > 0 ? v : 0);
      return { id: 'c' + n.id, account: n.id, debit: dr || '', credit: cr || '' }; }); },
    set: function (b, rows) { ((b && b.coa) || []).forEach(function (n) { if (!n || n.type !== 'account' || cashCtrl(b, n)) return;
      var r = rows.filter(function (x) { return String(x.account) === String(n.id); }).pop();
      if (!r) { if (num(n.balance) !== 0) n.balance = 0; return; }
      var dr = num(r.debit), cr = num(r.credit), v = natureD(b, n) ? dr - cr : cr - dr; n.balance = r2(v); }); }
  };
  function sbAcctOpts(b) {
    return [['', '— account —']].concat(sbBsAccounts(b).map(function (n) { return [n.id, acctLabel(b, n.id)]; }).sort(function (x, y) { return String(x[1]).localeCompare(String(y[1])); }));
  }
  function sbAcctCol(v, r, b) { var n = acct(b, v); if (!n) return String(v || ''); var lab = acctLabel(b, v); if (sideOf(b, n) === 'pl') lab += ' (Profit and loss — not a balance sheet account)'; else if (n.control) lab += ' (control account)'; return lab; }
  function recordStore(key, nameCol, field) {
    return { get: function (b) { return recs(b, key).filter(function (r) { return r && num(r[field]) !== 0; }).map(function (r) { var o = { id: 'r' + r.id, amount: r[field] }; o[nameCol] = r.name; return o; }); },
      set: function (b, rows) { recs(b, key).forEach(function (r) { var row = rows.filter(function (x) { return x[nameCol] === r.name; }).pop(); var A = app(); var v = row ? (A && A.parseNum ? A.parseNum(row.amount) : num(row.amount)) : 0; r[field] = (v === '' ? 0 : v); }); } };
  }
  /** debits and credits of every starting balance, and the difference that lands in Starting balance equity */
  function sbSummary(b) {
    var out = { debit: 0, credit: 0, diff: 0 };
    try { var g = GL.get(b), sbe = GL.sysAcct(b, 'starting balance equity', false), sid = sbe ? sbe.id : '@sbe';
      g.lines.forEach(function (L) { if (L.date) return; if (L.acct === sid) return; out.debit += L.debit; out.credit += L.credit; }); } catch (e) {}
    out.debit = r2(out.debit); out.credit = r2(out.credit); out.diff = r2(out.debit - out.credit); return out;
  }
  function sbNoticeHtml(b) {
    var s = sbSummary(b); if (!s.debit && !s.credit) return '';
    if (Math.abs(s.diff) < 0.005) return '<div class="info-bar sfa-sb ok">Starting balances are balanced — debits ' + esc(money(s.debit)) + ' = credits ' + esc(money(s.credit)) + '.</div>';
    return '<div class="info-bar sfa-sb warn" role="alert"><b>Starting balances do not balance.</b> Debits ' + esc(money(s.debit)) + ', credits ' + esc(money(s.credit)) + '. The difference of ' + esc(money(Math.abs(s.diff))) +
      ' is shown in <b>Starting balance equity</b> (' + (s.diff > 0 ? 'credit' : 'debit') + '). Enter the missing starting balances so this account is zero.</div>';
  }
  SFA.sbSummary = sbSummary;
  /* old employee starting balances lived in b.startingBalances.employees; the ledger reads records.employees[].balance */
  function migrateEmployeeSB(b) {
    var sb = b && b.startingBalances, L = sb && sb.employees; if (!Array.isArray(L) || !L.length || sb._employeesMigrated) return false;
    L.forEach(function (row) { if (!row) return; var e = recs(b, 'employees').filter(function (r) { return r && r.name === row.employee; })[0]; if (e && num(e.balance) === 0 && num(row.amount) !== 0) e.balance = num(row.amount); });
    sb._employeesMigrated = 1; return true;
  }
  SFA.migrateEmployeeSB = migrateEmployeeSB;

  /* ================================================================ 109  billable expenses */
  function billOn(b) { return !!(b && b.billableExpenses && b.billableExpenses.enabled); }
  function isExpense(b, id) { var n = acct(b, id); return !!(n && rootOf(b, n) === 'expense'); }
  function custNames(b) { return recs(b, 'customers').map(function (c) { return c && c.name; }).filter(Boolean); }
  /** every billable expense line: {ref, key, id, idx, date, reference, customer, desc, amount, invoiced} */
  function billableLines(b) {
    var done = {}; recs(b, 'salesInv').forEach(function (inv) { (inv && inv.lines || []).forEach(function (l) { if (l && l.billableRef) done[l.billableRef] = inv.reference || String(inv.id); }); });
    var out = [];
    ['payments', 'purchInv'].forEach(function (key) { recs(b, key).forEach(function (r) { if (!r) return; (r.lines || []).forEach(function (l, i) { if (!l || blank(l.billableCustomer)) return;
      var ref = key + ':' + r.id + ':' + i, net = (l.net != null && l.net !== '') ? num(l.net) : num(l.amount);
      out.push({ ref: ref, key: key, id: r.id, idx: i, date: r.date || r.issueDate || '', reference: r.reference || '', customer: l.billableCustomer, desc: l.desc || l.description || l.item || '', amount: r2(net), invoiced: done[ref] || '' }); }); }); });
    return out;
  }
  function uninvoiced(b, customer) { return billableLines(b).filter(function (x) { return !x.invoiced && (customer == null || x.customer === customer); }); }
  function billIncomeAcct(b) {
    var n = acctByName(b, 'Billable expenses - invoiced'); if (n) return n;
    var g = (b.coa || []).filter(function (x) { return x && x.type === 'group' && x.parent === 'pl' && x.plkind === 'income'; })[0];
    if (!g) { try { GL.sysAcct(b, 'inventory - sales', true); } catch (e) {} g = (b.coa || []).filter(function (x) { return x && x.type === 'group' && x.parent === 'pl' && x.plkind === 'income'; })[0]; }
    n = { id: 'sys_bx_inv', type: 'account', name: 'Billable expenses - invoiced', code: '', parent: g ? g.id : 'pl', balance: 0, sys: 1 };
    b.coa.push(n); return n;
  }
  SFA.billableLines = billableLines; SFA.uninvoiced = uninvoiced;
  function billSel(attrs, b, v) { var names = custNames(b); if (!blank(v) && names.indexOf(v) < 0) names.unshift(v);
    return '<select ' + attrs + '><option value=""></option>' + names.map(function (n) { return '<option' + (n === v ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>'; }
  function billPanelHtml(b, t) {
    if (!billOn(b) || !t || t.key !== 'salesInv' || blank(t.customer)) return '';
    var onInv = {}; (t.lines || []).forEach(function (l) { if (l && l.billableRef) onInv[l.billableRef] = 1; });
    var L = uninvoiced(b, t.customer).filter(function (x) { return !onInv[x.ref]; }); if (!L.length) return '';
    var tot = r2(L.reduce(function (s, x) { return s + x.amount; }, 0));
    return '<div class="info-bar sfa-bill"><div><b>' + L.length + ' uninvoiced billable expense' + (L.length === 1 ? '' : 's') + '</b> for ' + esc(t.customer) + ' — ' + esc(money(tot)) + '</div>' +
      '<div class="sfa-bill-l">' + L.map(function (x) { return '<label class="sfa-chk"><input type="checkbox" checked data-sfa-bill="' + esc(x.ref) + '"> ' + esc(fmtD(x.date)) + ' · ' + esc((x.key === 'payments' ? 'Payment ' : 'Purchase invoice ') + (x.reference || '')) + ' · ' + esc(x.desc) + ' · <b>' + esc(money(x.amount)) + '</b></label>'; }).join('') + '</div>' +
      '<button type="button" class="btn btn-sm btn-primary" onclick="SettingsFixesA.billAdd()">Add to invoice</button></div>';
  }
  function billPanelRefresh(b, t) { var h = byId('sfaBill'); if (h) h.innerHTML = billPanelHtml(b, t); }
  SFA.billAdd = function () {
    var A = app(), TF = global.TxnForms, t = TF && TF.state(); if (!t) return; var b = A.curBiz(); var h = byId('sfaBill');
    var boxes = h ? h.querySelectorAll('[data-sfa-bill]') : [];
    var pick = boxes.length ? Array.prototype.filter.call(boxes, function (i) { return i.checked; }).map(function (i) { return i.getAttribute('data-sfa-bill'); }) : null;
    var L = uninvoiced(b, t.customer).filter(function (x) { return !pick || pick.indexOf(x.ref) >= 0; }); if (!L.length) return;
    var inc = billIncomeAcct(b); A.saveBiz(b);
    t.lines = (t.lines || []).filter(function (l) { return !(blank(l.account) && blank(l.item) && blank(l.desc) && !num(l.price)); });
    L.forEach(function (x) { t.lines.push({ item: '', account: inc.id, sub: '', desc: x.desc || ('Billable expense ' + (x.reference || '')), qty: '1', price: String(x.amount), discount: '', taxCode: '', division: '', billableRef: x.ref }); });
    t.showDescCol = true; TF.redraw();
  };

  /* =============================================================== 110-111  recurring */
  var UNITS = ['days', 'weeks', 'months', 'years'];
  function parseEvery(every) {
    var s = String(every || '').trim(), m = s.match(/^every\s+(\d+)?\s*(day|week|month|year)s?$/i);
    if (m) return { n: m[1] ? parseInt(m[1], 10) : 1, unit: m[2].toLowerCase() + 's' };
    return ({ Weekly: { n: 1, unit: 'weeks' }, Fortnightly: { n: 2, unit: 'weeks' }, Monthly: { n: 1, unit: 'months' }, Quarterly: { n: 3, unit: 'months' }, Yearly: { n: 1, unit: 'years' }, Daily: { n: 1, unit: 'days' } })[s] || { n: 1, unit: 'months' };
  }
  function everyText(n, unit) { n = Math.max(1, parseInt(n, 10) || 1); unit = UNITS.indexOf(unit) >= 0 ? unit : 'months'; return 'Every ' + (n === 1 ? unit.replace(/s$/, '') : n + ' ' + unit); }
  function advance(iso, every) {
    if (!iso) return ''; var p = parseEvery(every), A = app(), n = p.n;
    if (p.unit === 'days') return A._isoShift(iso, n); if (p.unit === 'weeks') return A._isoShift(iso, 7 * n);
    if (p.unit === 'years') return A._isoShift(iso, 0, 0, n); return A._isoShift(iso, 0, n);
  }
  SFA.parseEvery = parseEvery; SFA.everyText = everyText; SFA.advance = advance;
  function dueSchedules(b, key) { var t = today(); return (b.recurring || []).map(function (r, i) { return { r: r, i: i }; }).filter(function (x) { var r = x.r;
    return r && r.key === key && !blank(r.src) && !blank(r.next) && r.next <= t && (blank(r.end) || r.next <= r.end) && recs(b, key).some(function (d) { return String(d.id) === String(r.src); }); }); }
  SFA.dueSchedules = dueSchedules;
  /** copy the schedule's document dated on its next issue date; noCopy custom fields and settlement state are left out */
  function createFromSchedule(b, r) {
    var A = app(), arr = recs(b, r.key), src = arr.filter(function (x) { return String(x.id) === String(r.src); })[0]; if (!src) return null;
    var copy = clone(src); copy.id = Date.now() + Math.floor(Math.random() * 1000); copy.uuid = A.uuid();
    ['allocations', 'paid', 'status', 'copiedFrom'].forEach(function (k) { delete copy[k]; });
    if (copy.custom) { fieldsFor(b, r.key, false).forEach(function (f) { if (f.def.noCopy) delete copy.custom[f.id]; }); }
    var d = r.next || today(); if (copy.issueDate != null) copy.issueDate = d; if (copy.date != null) copy.date = d; if (copy.issueDate == null && copy.date == null) copy.date = d;
    if (copy.dueDate && copy.dueType === 'Net' && !blank(copy.dueDays)) { try { copy.dueDate = A._isoShift(d, num(copy.dueDays)); } catch (e) {} }
    if (copy.total != null && copy.balanceDue != null) copy.balanceDue = num(copy.total) - num(copy.withholdingAmt);
    copy.reference = A.nextRef(b, r.key);
    b.records[r.key] = arr.concat([copy]);
    r.next = advance(d, r.every);
    try { A._logActivity(b, 'create', r.key, copy, null); } catch (e) {}
    return copy;
  }
  SFA.createFromSchedule = createFromSchedule;
  SFA.recurCreateDue = function (key) {
    var A = app(), b = A.curBiz(); if (!b) return; if (A.guardWrite && !A.guardWrite(b)) return;
    var made = []; dueSchedules(b, key).forEach(function (x) { var c = createFromSchedule(b, b.recurring[x.i]); if (c) made.push(c.reference); });
    if (!made.length) return; try { G('refreshSummary')(b); } catch (e) {} A.saveBiz(b);
    var nm = ((reg()[key] || {}).singular || key); toast('Created ' + nm + ' ' + made.join(', ')); A.renderMain(A.curBiz());
  };
  function dueNoticeHtml(b, key) {
    var n = dueSchedules(b, key).length; if (!n) return ''; var nm = String((reg()[key] || {}).singular || key).toLowerCase();
    return '<div class="info-bar sfa-due"><span><b>' + n + '</b> recurring ' + esc(nm) + (n === 1 ? '' : 's') + ' due</span>' +
      '<button type="button" class="btn btn-sm btn-primary" onclick="SettingsFixesA.recurCreateDue(' + q(key) + ')">Create</button>' +
      '<a class="led-link" onclick="SettingsFixesA.openRecurring(' + q(key) + ')">View schedule</a></div>';
  }

  /* ========================================================== 71  expense claims: tax code */
  function migrateExpenseClaimState(st) {
    if (!st || !Array.isArray(st.blocks)) return false; var ch = false;
    st.blocks.forEach(function (bl) { if (!bl || bl.type !== 'lines' || !Array.isArray(bl.columns)) return;
      var cols = bl.columns, has = function (v) { return cols.some(function (c) { return c && (c.var === v || c.key === v); }); };
      var ai = cols.findIndex(function (c) { return c && (c.var === 'amountNoTax' || c.key === 'amountNoTax'); }); if (ai < 0) return;
      var base = cols[ai], mk = function (o) { return Object.assign({}, base, { id: 'sfa_' + o.var + '_' + Math.random().toString(36).slice(2, 7), key: 'custom', num: false, formula: '', concat: '', options: [], defaultValue: '', placeholder: '', itemAttr: '', dropSource: '', cellMode: 'input', w: 110, wUnit: 'px', align: '' }, o); };
      if (!has('taxRate')) { cols.splice(ai + 1, 0, mk({ label: 'Tax code', var: 'taxRate', cellMode: 'dropdown', dropSource: 'tax', w: 130 })); ch = true; }
      if (!has('totalWithTax')) { var ti = cols.findIndex(function (c) { return c && (c.var === 'taxRate' || c.key === 'taxRate'); });
        cols.splice(ti + 1, 0, mk({ label: 'Total', var: 'totalWithTax', num: true, cellMode: 'formula', formula: '@amountNoTax+@amountNoTax*@taxRate/100', align: 'right', w: 120 })); ch = true; }
    });
    return ch;
  }
  SFA.migrateExpenseClaimState = migrateExpenseClaimState;
  /* 108: no starting balance boxes on the designed Capital / Special Account forms (the stored figure is kept) */
  var NO_SB = { capital: function (bl) { return bl.field === 'capBalance' || bl.var === 'capBalance'; }, special: function (bl) { return bl.var === 'balance' || bl.field === 'balance'; } };
  function migrateTplState(key, st) {
    if (!st || !Array.isArray(st.blocks)) return false; var ch = false;
    if (NO_SB[key]) { var n0 = st.blocks.length; st.blocks = st.blocks.filter(function (bl) { return !(bl && bl.type === 'field' && NO_SB[key](bl)); }); if (st.blocks.length !== n0) ch = true; }
    if (key === 'expenseClaims' && migrateExpenseClaimState(st)) ch = true;
    return ch;
  }
  SFA.migrateTplState = migrateTplState;
  function migrateTemplate(key) {
    var MF = global.MgrForms; if (!MF || !MF.tpl) return false; var t = MF.tpl(key); if (!t || !t.state) return false;
    var st; try { st = clone(t.state); } catch (e) { return false; }
    if (!migrateTplState(key, st)) return false;
    var bundle = MF.bundle; if (!bundle || !bundle.templates) return false;
    bundle.templates[key] = Object.assign({}, t, { state: st });
    try { global.localStorage.setItem('mgr_form_templates', JSON.stringify(bundle)); } catch (e) {}
    return true;
  }

  /* ============================================================ designer forms: live parts */
  function syncCombo(sel) { if (!sel || !sel.parentNode) return; var box = sel.parentNode.querySelector('[data-combo-val]'); if (!box) return;
    var o = sel.options[sel.selectedIndex], txt = o ? String(o.textContent || '').replace(/\s+/g, ' ').trim() : '', ph = sel.getAttribute('data-ph') || '';
    if (sel.value === '' || txt === '') { box.textContent = ph; box.className = 'li-combo-val placeholder' + (sel.disabled ? ' locked' : ''); } else { box.textContent = txt; box.className = 'li-combo-val' + (sel.disabled ? ' locked' : ''); } }
  function pickTaxOption(sel, b, code) { if (!sel) return false; var rate = null; ((b.taxCodes) || []).forEach(function (t) { if (t && t.name === code) rate = String(t.rate); });
    for (var i = 0; i < sel.options.length; i++) { var o = sel.options[i], txt = String(o.textContent || '').trim();
      if (txt === code || txt.indexOf(code + ' ') === 0 || (rate != null && o.value === rate && txt.indexOf(code) === 0)) { sel.selectedIndex = i; return true; } }
    for (var j = 0; j < sel.options.length; j++) { if (rate != null && sel.options[j].value === rate) { sel.selectedIndex = j; return true; } }
    return false; }
  function designerAutofill(host, b) {
    var tbl = host.querySelector('[data-line-items]'); if (!tbl || tbl.getAttribute('data-sfa-af')) return; tbl.setAttribute('data-sfa-af', '1');
    tbl.addEventListener('change', function (e) { var s = e.target; if (!(e.isTrusted || e.userPick) || !s || !s.matches || !s.matches('select[data-account-col]')) return;
      var bb = app().curBiz(), n = acctByName(bb, s.value) || acct(bb, s.value); if (!n) return; var af = autofillOf(bb, n.id), tr = s.closest('tr'); if (!tr) return;
      if (af.desc) { var d = tr.querySelector('[data-var="description"]'); if (d && blank(d.value)) { d.value = af.desc; fire(d, 'input'); } }
      if (af.tax) { var t = tr.querySelector('select[data-var="taxRate"]'); if (t && pickTaxOption(t, bb, af.tax)) { syncCombo(t); fire(t, 'change'); fire(t, 'input'); } } });
  }
  /** add a column to a designed line grid (cells cloned with row 1 when lines are added) */
  function addDesignerColumn(tbl, th, cellHtml, cls) {
    if (!tbl || tbl.querySelector('th.' + cls)) return false;
    var hr = tbl.tHead && tbl.tHead.rows[0]; if (!hr) return false;
    var act = hr.querySelector('th.li-actc'); var h = doc().createElement('th'); h.className = cls; h.textContent = th; if (act) hr.insertBefore(h, act); else hr.appendChild(h);
    Array.prototype.forEach.call(tbl.tBodies[0] ? tbl.tBodies[0].rows : [], function (tr, i) { var td = doc().createElement('td'); td.className = cls; td.innerHTML = cellHtml(i); var a = tr.querySelector('td.li-actc'); if (a) tr.insertBefore(td, a); else tr.appendChild(td); });
    Array.prototype.forEach.call(tbl.tFoot ? tbl.tFoot.rows : [], function (tr) { var add = tr.querySelector('td.li-addc,td[colspan]'); if (add && tr.cells.length === 1) { add.colSpan = (add.colSpan || 1) + 1; return; }
      var td = doc().createElement('td'); var a = tr.querySelector('td.li-actc'); if (a) tr.insertBefore(td, a); else tr.appendChild(td); });
    return true;
  }
  function designerLines(A, b, key, src) { var L = []; try { L = (A._linesForEdit ? A._linesForEdit(key, src) : src.lines) || []; } catch (e) { L = (src && src.lines) || []; } return L; }
  function designerExtras(key, prefill) {
    var A = app(), b = A.curBiz(), host = byId('deHost'); if (!host || !b) return;
    var form = host.querySelector('.app-form') || host, s = srcFor(A, b, key, prefill);
    var tbl = host.querySelector('[data-line-items]'), wrap = tbl ? (tbl.closest('.li-wrap') || tbl) : null;
    injectExtras(form, wrap, null, b, key, s.src, s.mode);
    designerAutofill(host, b);
    var src = s.src || {}, lines = designerLines(A, b, key, src);
    /* billable to customer on payment / purchase invoice lines */
    if (tbl && billOn(b) && (key === 'purchInv' || key === 'payments')) {
      addDesignerColumn(tbl, 'Billable to customer', function (i) { var l = lines[i] || {}; return billSel('data-var="billableCustomer" class="sfa-billsel"', b, l.billableCustomer || ''); }, 'sfa-billc');
    }
    /* line custom fields */
    if (tbl) fieldsFor(b, key, true).forEach(function (f) {
      addDesignerColumn(tbl, f.name, function (i) { var l = lines[i] || {}; var v = (l.custom && l.custom[f.id] != null && !(s.mode !== 'edit' && f.def.noCopy)) ? l.custom[f.id] : '';
        return lcfInput(f, v, 'data-var="sfacf_' + esc(f.id) + '"'); }, 'sfa-lcf-' + f.id.replace(/[^a-z0-9_-]/gi, ''));
    });
  }
  function lcfInput(f, v, attrs) {
    var lock = f.def.locked ? ' disabled' : '';
    if (f.type === 'checkbox') return '<input type="checkbox" ' + attrs + (v === true || v === '1' || v === 'true' ? ' checked' : '') + lock + '>';
    if (f.type === 'date') return '<input type="date" ' + attrs + ' value="' + esc(v || '') + '"' + lock + '>';
    if (f.def.type === 'Drop-down list') { var o = optList(f.def.options); if (!blank(v) && o.indexOf(v) < 0) o.unshift(v); return '<select ' + attrs + lock + '><option value=""></option>' + o.map(function (x) { return '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>'; }
    return '<input type="text"' + (f.type === 'number' ? ' inputmode="decimal"' : '') + ' ' + attrs + ' value="' + esc(Array.isArray(v) ? v.join(', ') : (v == null ? '' : v)) + '"' + lock + '>';
  }
  /* designed lines save line custom fields as sfacf_<id>: fold them into ln.custom */
  function foldLineCustom(b, key, rec) {
    var F = fieldsFor(b, key, true), byKey = {}; F.forEach(function (f) { byKey['sfacf_' + f.id] = f; });
    (rec.lines || []).forEach(function (ln) { if (!ln) return; Object.keys(ln).forEach(function (k) { if (k.indexOf('sfacf_') !== 0) return; var f = byKey[k], v = ln[k]; delete ln[k];
      if (!f) return; if (f.type === 'checkbox') v = v === '1' || v === true; else if (f.type === 'number') v = blank(v) ? '' : num(v); else if (f.type === 'multi') v = optList(v);
      if (v === '' || v === false || (Array.isArray(v) && !v.length)) { if (ln.custom) delete ln.custom[f.id]; return; }
      ln.custom = ln.custom || {}; ln.custom[f.id] = v; }); if (ln.billableCustomer === '') delete ln.billableCustomer; });
  }

  /* ==================================================================== list columns */
  function settingsCols(b, key) {
    return fieldsFor(b, key, false).map(function (f) { var nm = f.type === 'number', dt = f.type === 'date';
      return { key: 'cf_' + f.id, label: f.name, kind: nm ? 'num' : (dt ? 'date' : 'text'), r: nm ? 1 : 0, custom: 1, settings: 1,
        calc: function (r) { var v = r && r.custom ? r.custom[f.id] : ''; return cfText(f, v == null ? '' : v); } }; });
  }
  SFA.settingsCols = settingsCols;

  /* ===================================================================== install */
  function install() {
    var A = app(); if (!A || A._settingsFixesA) return; A._settingsFixesA = true;
    var wrap = function (obj, name, fn) { var orig = obj && obj[name]; if (typeof orig !== 'function') return; obj[name] = function () { return fn.call(this, orig, arguments); }; };

    /* ---------- 95-97 chart of accounts ---------- */
    wrap(A, 'coaEditor', function (orig, args) { var h = orig.apply(this, args); var ctx = this.coaCtx;
      if (!ctx || (ctx.kind !== 'account')) return h;
      var b = args[0], node = ctx.id ? (b.coa || []).filter(function (n) { return n.id === ctx.id; })[0] : null;
      var hidden = '<input type="hidden" id="coa_bal" value="' + esc(node && node.balance ? node.balance : '') + '">';
      var re = /<label class="fld">Starting balance<\/label><input id="coa_bal"[^>]*>/;
      var extra = coaExtraHtml(b, node);
      if (re.test(h)) h = h.replace(re, function () { return hidden + extra; });
      else h = h.replace('<div class="form-actions">', function () { return hidden + extra + '<div class="form-actions">'; });
      return h.replace(/<div style="color:#999;font-size:12px;margin-top:6px">This is a control account\. Its balance is this starting figure plus/, '<div style="color:#999;font-size:12px;margin-top:6px">This is a control account. Its balance is its starting balance plus');
    });
    wrap(A, 'coaSave', function (orig, args) { var ctx = this.coaCtx ? clone(this.coaCtx) : null, x = readCoaExtra(), nm = byId('coa_name') ? String(byId('coa_name').value || '').trim() : '';
      var r = orig.apply(this, args);
      if (ctx && ctx.kind === 'account' && x && !this.coaCtx) { var b = this.curBiz(); if (b) {
        var n = ctx.id ? (b.coa || []).filter(function (y) { return y.id === ctx.id; })[0] : (b.coa || []).filter(function (y) { return y.type === 'account' && String(y.name || '').trim() === nm; }).pop();
        if (n) { applyCoaExtra(n, x); this.saveBiz(b); } } }
      return r; });
    wrap(A, '_cashFlow', function (orig, args) { var res = orig.apply(this, args), b = args[0]; try {
      var all = [].concat(res.O.map(function (e) { return ['O', e]; }), res.I.map(function (e) { return ['I', e]; }), res.F.map(function (e) { return ['F', e]; }));
      var M = { operating: 'O', investing: 'I', financing: 'F' }, out = { O: [], I: [], F: [] };
      all.forEach(function (p) { var n = acct(b, p[1].id), c = n ? cashFlowCat(b, n) : null; out[(c && M[c]) || p[0]].push(p[1]); });
      var sum = function (a) { return a.reduce(function (s, x) { return s + x.amt; }, 0); };
      return { O: out.O, I: out.I, F: out.F, oT: sum(out.O), iT: sum(out.I), fT: sum(out.F), net: sum(out.O) + sum(out.I) + sum(out.F) }; } catch (e) { return res; } });
    var TF = global.TxnForms;
    if (TF && TF.ext) {
      TF.ext.onAccount.push(function (b, t, l) { var af = autofillOf(b, l.account); if (af.desc && blank(l.desc)) { l.desc = af.desc; t.showDescCol = true; } if (af.tax) l.taxCode = af.tax; });
      /* 109: billable to customer (payments), the invoice line it was billed on (sales invoices) */
      TF.ext.cols.push({ id: 'billable', th: 'Billable to customer',
        show: function (b, t) { return billOn(b) && t.key === 'payments'; },
        cell: function (b, t, l, i) { return isExpense(b, l.account) ? billSel('data-l="' + i + '" data-f="billableCustomer" onchange="TxnForms._ch(this)" class="sfa-billsel"', b, l.billableCustomer || '') : ''; },
        load: function (tl, ln, b, t) { if (!blank(ln.billableCustomer)) tl.billableCustomer = ln.billableCustomer; if (!blank(ln.billableRef)) tl.billableRef = ln.billableRef;
          /* values of fields that are no longer line fields of this type are kept as they are */
          if (ln.custom) { var known = {}; fieldsFor(b, t.key, true).forEach(function (f) { known[f.id] = 1; }); var keep = {};
            Object.keys(ln.custom).forEach(function (k) { if (!known[k]) keep[k] = ln.custom[k]; }); if (Object.keys(keep).length) tl.custom = keep; } },
        save: function (l, o, b) { if (!blank(l.billableCustomer) && isExpense(b, l.account)) o.billableCustomer = l.billableCustomer; if (!blank(l.billableRef)) o.billableRef = l.billableRef;
          var c = {}; Object.keys(l).forEach(function (k) { if (k.indexOf('lcf_') === 0 && l[k] !== '' && l[k] != null && l[k] !== false) c[k.slice(4)] = l[k]; });
          if (l.custom) Object.keys(l.custom).forEach(function (k) { if (!(('lcf_' + k) in l)) c[k] = l.custom[k]; });
          if (Object.keys(c).length) o.custom = c; } });
      TF.ext.onDraw.push(function (b, t) { billPanelRefresh(b, t); });
    }

    /* ---------- 98-103 extras on every form ---------- */
    wrap(A, '_logActivity', function (orig, args) { var key = args[2], rec = args[3], act = args[1];
      if (PENDING && rec && PENDING.key === key && (act === 'create' || act === 'update')) { applyExtras(rec, PENDING.x); PENDING = null; }
      return orig.apply(this, args); });
    /* payslips: the native form unless the business switched it to the Form Designer */
    wrap(A, '_nativeTxnForm', function (orig, args) { if (args[1] === 'payslips') return !(((args[0] && args[0].formEngine) || {}).payslips === 'designed'); return orig.apply(this, args); });
    if (TF) {
      var nativePrefill = null;
      wrap(TF, 'formHtml', function (orig, args) { var b = args[0], key = args[1]; nativePrefill = A._prefill ? clone(A._prefill) : null;
        if (key === 'payslips') return PayslipForm.html(b);
        /* line custom fields of this document type become line columns */
        TF.ext.cols = TF.ext.cols.filter(function (c) { return !c._lcf; }).concat(fieldsFor(b, key, true).map(function (f) {
          return { _lcf: 1, id: 'lcf:' + f.id, th: f.name, show: function (bb, t) { return t.key === key; },
            cell: function (bb, t, l, i) { var v = l['lcf_' + f.id]; var attrs = 'data-l="' + i + '" data-f="lcf_' + esc(f.id) + '" ' + ((f.type === 'checkbox' || f.def.type === 'Drop-down list' || f.type === 'date') ? 'onchange="TxnForms._ch(this)"' : 'oninput="TxnForms._in(this)"');
              return lcfInput(f, v, attrs); },
            load: function (tl, ln, bb, t) { var v = ln.custom && ln.custom[f.id]; if (v != null && !(t.mode !== 'edit' && f.def.noCopy)) tl['lcf_' + f.id] = v; } }; }));
        return orig.apply(this, args); });
      wrap(TF, 'mount', function (orig, args) { var key = args[0]; if (key === 'payslips') { PayslipForm.mount(); return; }
        var r = orig.apply(this, args); try { var b = A.curBiz(), s = srcFor(A, b, key, nativePrefill);
          var host = byId('txHost') || byId('bankForm');
          if (host) { var lines = host.querySelector('#txLines'), act = host.querySelector('.form-actions');
            injectExtras(host, lines || act, act, b, key, s.src, s.mode);
            if (key === 'salesInv' && lines && !byId('sfaBill')) { var bp = doc().createElement('div'); bp.id = 'sfaBill'; lines.parentNode.insertBefore(bp, lines); billPanelRefresh(b, TF.state()); } } } catch (e) { if (global.console) console.warn('settings-fixes-a mount', e); }
        return r; });
      wrap(TF, 'save', function (orig, args) { var t = TF.state(); return withPending(t ? t.key : null, byId('txHost'), function () { return orig.apply(TF, args); }); });
    }
    if (global.BankForm) wrap(global.BankForm, 'save', function (orig, args) { return withPending('bankCash', byId('bankForm'), function () { return orig.apply(global.BankForm, args); }); });
    wrap(A, '_mountDesignedForm', function (orig, args) { var pf = this._prefill ? clone(this._prefill) : null; var r = orig.apply(this, args);
      try { designerExtras(args[0], pf); } catch (e) { if (global.console) console.warn('settings-fixes-a designer', e); } return r; });
    wrap(A, 'saveDesignedRecord', function (orig, args) { var self = this; return withPending(args[0], byId('deHost'), function () { return orig.apply(self, args); }); });
    wrap(A, '_applyDesignedToNative', function (orig, args) { var key = args[0], rec = args[1]; var r = orig.apply(this, args);
      try { var b = this.curBiz(); foldLineCustom(b, key, rec); if (PENDING && PENDING.key === key) applyExtras(rec, PENDING.x);
        if (key === 'expenseClaims' && rec.total != null && rec.total !== '') rec.amount = rec.total; } catch (e) {}
      return r; });
    wrap(A, '_refreshTemplateFromState', function (orig, args) { try { migrateTemplate(args[0]); } catch (e) {} return orig.apply(this, args); });

    /* view / print / pdf: printed custom fields, chosen footers, payslip sections */
    wrap(A, 'voucherDoc', function (orig, args) {
      var b = args[0], c = args[1] || {}, rec = args[2] || {}, opts = args[3];
      if (opts && opts.edit) return orig.apply(this, args);
      var key = (opts && opts.key) || l2k()[this.wsSection];
      var chosen = Array.isArray(rec.footers), saved;
      if (chosen && b && b.details) { saved = b.details.footer; b.details.footer = ''; }
      var h; try { h = orig.apply(this, args); } finally { if (chosen && b && b.details) b.details.footer = saved; }
      try {
        if (c.lines && c.lines.kind === 'payslip') { var s0 = h.indexOf('<div class="iv-twrap">'), e0 = h.indexOf('</table></div>', s0);
          if (s0 >= 0 && e0 > s0) h = h.slice(0, s0) + payslipViewBody(b, rec) + h.slice(e0 + 14); }
        var F = fieldsFor(b, key, false).filter(function (f) { return f.def.printed; }), cf = '';
        F.forEach(function (f) { var v = rec.custom ? rec.custom[f.id] : ''; var d = cfDisplay(f, v); if (d) cf += '<div class="iv-cblock"><span class="iv-clbl">' + esc(String(f.name).toUpperCase()) + '</span><span class="iv-cval">' + d + '</span></div>'; });
        if (cf) { cf = '<div class="sfa-cfprint">' + cf + '</div>'; var mi = h.indexOf('</dl></div>');
          if (mi >= 0) h = h.slice(0, mi + 11) + cf + h.slice(mi + 11); else { var hi = h.indexOf('</header>'); h = hi >= 0 ? h.slice(0, hi + 9) + cf + h.slice(hi + 9) : cf + h; } }
        if (chosen) { var FT = footersFor(b, key).filter(function (f) { return rec.footers.map(String).indexOf(f.id) >= 0; });
          if (FT.length) { var fh = '<div class="iv-cf sfa-footers">' + FT.map(footerBlockHtml).join('') + '</div>'; var li = h.lastIndexOf('</div>'); h = li >= 0 ? h.slice(0, li) + fh + h.slice(li) : h + fh; } }
      } catch (e) {}
      return h;
    });
    /* Clone and Copy to never carry fields marked "Exclude from copying or cloning" */
    wrap(A, 'copyPrefill', function (orig, args) { var pf = orig.apply(this, args); try { var b = args[0], tk = args[3]; stripNoCopy(b, pf, tk); stripNoCopy(b, pf, args[1]); } catch (e) {} return pf; });

    /* list columns: Settings custom fields (cf_<id>), the customer's uninvoiced billable expenses */
    wrap(A, '_colPool', function (orig, args) { var pool = orig.apply(this, args) || [], c = args[0], b = args[1] || this.curBiz();
      try { var key = null; Object.keys(reg()).forEach(function (k) { if (reg()[k] === c) key = k; }); if (!key) return pool;
        var seenK = {}, seenL = {}; pool.forEach(function (p) { seenK[p.key] = 1; seenL[String(p.label || '').trim().toLowerCase()] = 1; });
        var extra = settingsCols(b, key).filter(function (x) { return !seenK[x.key] && !seenL[String(x.label).trim().toLowerCase()]; });
        if (key === 'customers' && billOn(b) && !seenK.billableUninvoiced) extra.push({ key: 'billableUninvoiced', label: 'Uninvoiced', kind: 'money', r: 1, calc: function (r) { return r2(uninvoiced(app().curBiz(), r.name).reduce(function (s, x) { return s + x.amount; }, 0)); } });
        if (!extra.length) return pool;
        var li = pool.findIndex(function (p) { return p.key === '__ledger'; }); if (li < 0) return pool.concat(extra); pool.splice.apply(pool, [li, 0].concat(extra)); } catch (e) {}
      return pool; });
    wrap(A, '_defaultColKeys', function (orig, args) { var out = orig.apply(this, args); try { var c = args[0], b = args[1] || this.curBiz();
      if (c === reg().customers && billOn(b) && uninvoiced(b).length && out.indexOf('billableUninvoiced') < 0) out = out.concat(['billableUninvoiced']); } catch (e) {} return out; });

    /* 110: due notice on the tab */
    wrap(A, 'listHtml', function (orig, args) { var h = orig.apply(this, args); try { var b = args[0], key = l2k()[this.wsSection]; var n = key ? dueNoticeHtml(b, key) : ''; if (n) h = n + h; } catch (e) {} return h; });
    wrap(A, '_recurAdvance', function (orig, args) { var e = args[1]; if (/^every\s/i.test(String(e || '')) || e === 'Daily') return advance(args[0], e); return orig.apply(this, args); });

    /* 108 / 106-107: starting balance notice; migrations when a business opens */
    wrap(A, 'set_starting', function (orig, args) { var h = orig.apply(this, args); try { var r = A.spRoute; if (r && r.key === 'starting' && (r.action === 'new' || r.action === 'edit')) return h;
      var n = sbNoticeHtml(args[0]); if (!n) return h; var ci = h.indexOf('</div></div>'); return ci >= 0 ? h.slice(0, ci + 12) + n + h.slice(ci + 12) : n + h; } catch (e) { return h; } });
    wrap(A, 'renderWorkspace', function (orig, args) { try { var b = this.curBiz && this.curBiz(); if (b && migrateEmployeeSB(b)) this.saveBiz(b); } catch (e) {} return orig.apply(this, args); });

    /* ---------- register forms: no starting balance boxes (108) ---------- */
    var R = reg();
    ['capital', 'special'].forEach(function (k) { if (R[k] && Array.isArray(R[k].form)) R[k].form = R[k].form.filter(function (f) { return f.key !== 'balance'; }); });
    if (R.special && Array.isArray(R.special.columns)) R.special.columns.forEach(function (col) { if (col.key === 'balance' && !col.calc) col.calc = function (r) { try { var b = app().curBiz(); return GL.subBalance(b, 'special accounts', r.name); } catch (e) { return num(r.balance); } }; });

    installSettingsPages();
  }
  function stripNoCopy(b, pf, key) { if (!pf || !key) return; fieldsFor(b, key, false).forEach(function (f) { if (f.def.noCopy && pf.custom) delete pf.custom[f.id]; });
    fieldsFor(b, key, true).forEach(function (f) { if (f.def.noCopy) (pf.lines || []).forEach(function (l) { if (l && l.custom) delete l.custom[f.id]; }); }); }

  /* ------------------------------------------------- Settings pages (SettingsPages.PAGES) */
  function installSettingsPages() {
    var SP = global.SettingsPages; if (!SP || !SP.PAGES || SP._fixesA) return; SP._fixesA = true; var P = SP.PAGES;
    var findF = function (fields, k) { return (fields || []).filter(function (f) { return f && f.k === k; })[0]; };
    /* 105: payslip item accounts — expense and liability accounts only, no control accounts */
    var accOpts = function (roots) { return function (b) { return [['', '— account —']].concat(((b && b.coa) || []).filter(function (n) { return n && n.type === 'account' && !n.control && roots.indexOf(rootOf(b, n)) >= 0; })
      .map(function (n) { return [n.id, acctLabel(b, n.id)]; }).sort(function (x, y) { return String(x[1]).localeCompare(String(y[1])); })); }; };
    try { var pi = P.payslipItems.items;
      [['earnings', 'account', ['expense', 'liabilities']], ['deductions', 'account', ['expense', 'liabilities', 'income', 'assets']], ['contributions', 'expense', ['expense']], ['contributions', 'liability', ['liabilities']]].forEach(function (x) {
        var f = findF(pi[x[0]].fields, x[1]); if (f) { f.opts = accOpts(x[2]); f.hint = x[2].length > 2 ? 'Salary deduction: expense, liability or income account. Recovery: employee loan / advance asset account' : x[2].length > 1 ? 'Expense and liability accounts' :(x[2][0] === 'expense' ? 'Expense accounts' : 'Liability accounts'); } });
    } catch (e) {}
    /* 106-107: balance sheet starting balances — balance sheet accounts, Debit / Credit */
    try { var bs = P.starting.items['balance-sheet'];
      bs.store = SB_BS_STORE;
      bs.intro = 'Balance sheet accounts only. Debits and credits must agree; any difference is shown in Starting balance equity. Bank, customer, supplier, employee, capital and special account starting balances have their own pages.';
      bs.fields = [{ k: 'account', l: 'Account', t: 'select', opts: sbAcctOpts, req: 1 }, { k: 'debit', l: 'Debit', t: 'number', cls: 'w-sm' }, { k: 'credit', l: 'Credit', t: 'number', cls: 'w-sm' }];
      bs.cols = [{ k: 'account', l: 'Account', fmt: sbAcctCol }, { k: 'debit', l: 'Debit', num: 1, fmt: function (v) { return num(v) ? money(v) : ''; } }, { k: 'credit', l: 'Credit', num: 1, fmt: function (v) { return num(v) ? money(v) : ''; } }];
      bs.validate = function (v) { if (num(v.debit) && num(v.credit)) return 'Enter either a debit or a credit amount, not both.'; if (!num(v.debit) && !num(v.credit)) return 'Enter a debit or a credit amount.'; };
      /* 108: employee starting balances on the employee records (where the general ledger reads them) */
      var emp = P.starting.items.employees; emp.store = recordStore('employees', 'employee', 'balance');
      emp.after = function (b) { try { G('refreshSummary')(b); } catch (e) {} };
      emp.intro = 'Amounts owed to an employee at the start date (negative when the employee owes the business).';
    } catch (e) {}
    /* 111: Every [N] days / weeks / months / years */
    try { Object.keys(P.recurring.items).forEach(function (k) { var d = P.recurring.items[k], i = (d.fields || []).findIndex(function (f) { return f && f.k === 'every'; }); if (i < 0) return;
      d.fields.splice(i, 1, { k: 'everyN', l: 'Interval — every', t: 'number', cls: 'w-sm', def: 1 }, { k: 'everyUnit', l: '', t: 'select', opts: UNITS.map(function (u) { return [u, u]; }), def: 'months' });
      var ld = d.load; d.load = function (r, b) { r = ld ? (ld(r, b) || r) : r; if (r.everyN == null || r.everyUnit == null) { var p = parseEvery(r.every); if (r.everyN == null) r.everyN = p.n; if (r.everyUnit == null) r.everyUnit = p.unit; } return r; };
      var bsv = d.beforeSave; d.beforeSave = function (r, b) { if (bsv) bsv(r, b); var n = Math.max(1, parseInt(r.everyN, 10) || 1); r.everyN = n; if (UNITS.indexOf(r.everyUnit) < 0) r.everyUnit = 'months'; r.every = everyText(n, r.everyUnit); };
      (d.cols || []).forEach(function (c) { if (c.k === 'every') c.fmt = function (v, r) { if (r && r.everyN) return everyText(r.everyN, r.everyUnit); var p = parseEvery(v); return everyText(p.n, p.unit); }; });
      d.intro = 'Point a schedule at an existing document. When the next issue date arrives a notice with Create appears on that tab; Create now copies it here and then rolls the next issue date forward.'; }); } catch (e) {}
  }

  /* ----------------------------------------------------------------- small UI helpers */
  SFA._reveal = function (cb, id) { var el = byId(id); if (el) el.hidden = !cb.checked; };
  SFA._img = function (inp) { var f = inp.files && inp.files[0]; if (!f) return; if (f.size > 1.5e6) { alert('That image is too large (max 1.5 MB).'); inp.value = ''; return; }
    var rd = new FileReader(); rd.onload = function () { var box = inp.parentNode, h = box.querySelector('input[type="hidden"]'); h.value = rd.result; var im = box.querySelector('img'); if (!im) { im = doc().createElement('img'); im.alt = ''; h.after(im); } im.src = rd.result; }; rd.readAsDataURL(f); };
  SFA._imgClear = function (btn) { var box = btn.parentNode, h = box.querySelector('input[type="hidden"]'); if (h) h.value = ''; var im = box.querySelector('img'); if (im) im.remove(); btn.remove(); };
  SFA.openStarting = function (sub) { var A = app(); A.coaCtx = null; if (global.SettingsPages) { A.wsMode = 'settings'; SettingsPages.go('starting', sub || ''); } };
  SFA.openPayslipItems = function (sec) { var A = app(); if (global.SettingsPages) { A.wsMode = 'settings'; SettingsPages.go('payslipItems', sec || ''); } };
  SFA.openRecurring = function (key) { var A = app(); if (global.SettingsPages) { A.wsMode = 'settings'; SettingsPages.go('recurring', key || ''); } };

  SFA.install = install; SFA.PayslipForm = PayslipForm;
  global.SettingsFixesA = SFA;
  install();
})(typeof window !== 'undefined' ? window : this);
