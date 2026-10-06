/* ===================== Document templates (default print / View / PDF layout) =====================
   The default look of every transaction voucher, modelled on the Fair Tax CRM sales invoice:
   letterhead (logo + business name left, business details right), a navy / gold double rule,
   a title band (TITLE left, document meta right), a "Bill to" box with a gold edge, a navy
   header table with zebra rows, a totals box, amount in words, payment (bank) details, notes,
   signature lines and a "computer-generated" footer line. Generic for any business: the name,
   logo, address, TRN, licence and bank details come from Settings -> Business Details.

   Additive: App.voucherDoc / App._ivHeader are wrapped, nothing in app.js is rewritten.
   The standard document is still built by App.voucherDoc (every print option, column choice,
   custom field, footer and the amount-in-words switch keep working); this module only
   re-arranges the finished card and adds what the classic layout lacks:
     - a title band carrying the document meta (number, dates)
     - an amount box with the amount in words on receipts, payments, transfers, expense claims,
       withholding tax receipts and payslips
     - line tables for inventory transfers / write-offs / production orders and fixed-asset
       depreciation / amortization (rate column fixed)
     - the invoices a receipt / payment is allocated to
     - business bank details on sales documents when the document has none of its own
     - signature lines on vouchers without them, the footer line, currency on grand totals
   Left alone (the business's own choice wins):
     - a document with an HTML theme (settings-fixes-b) or a designed receipt / payment
       (vdoc / docHtml), an invoice with a saved Invoice Designer design (invoice-designer-bridge)
     - Settings -> Business Details -> Printed documents -> Layout = Classic
   ================================================================================================ */
(function (global) {
  'use strict';
  var A = (function () { try { return App; } catch (e) { return global.App || null; } })();
  if (!A || typeof A.voucherDoc !== 'function') return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function r2(n) { return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function money(n) { try { return A.money(n); } catch (e) { return r2(n).toFixed(2); } }
  function fmtD(s) { s = String(s || '').slice(0, 10); if (!s) return ''; try { return A.fmtDate(s); } catch (e) { return s; } }
  function l2k() { try { return LABEL2KEY; } catch (e) { return global.LABEL2KEY || {}; } }
  function reg() { try { return REG; } catch (e) { return global.REG || {}; } }
  function acctNm(b, id) { if (blank(id)) return ''; try { return acctName(b, id); } catch (e) { return String(id); } }

  var INVOICE = { salesQuotes: 1, salesOrders: 1, salesInv: 1, creditNotes: 1, deliveryNotes: 1, purchQuotes: 1, purchOrders: 1, purchInv: 1, debitNotes: 1, goodsRec: 1 };
  var PURCHASE = { purchQuotes: 1, purchOrders: 1, purchInv: 1, debitNotes: 1, goodsRec: 1 };
  /* the business's bank details print on these when the document has none of its own */
  var BANK_DOCS = { salesQuotes: 1, salesOrders: 1, salesInv: 1 };
  /* settings-fixes-b DOC_KEYS: a chosen HTML theme replaces the document on these */
  var THEME_KEYS = { salesQuotes: 1, salesOrders: 1, salesInv: 1, creditNotes: 1, deliveryNotes: 1, purchQuotes: 1, purchOrders: 1, purchInv: 1, debitNotes: 1,
    goodsRec: 1, receipts: 1, payments: 1, iat: 1, journal: 1, payslips: 1, expenseClaims: 1, invTransfers: 1, invWriteOffs: 1, production: 1, depreciation: 1, amortization: 1 };

  var TITLES = { receipts: 'Payment Receipt', payments: 'Payment Voucher', iat: 'Transfer Voucher', journal: 'Journal Voucher', expenseClaims: 'Expense Claim',
    payslips: 'Payslip', whtReceipts: 'Withholding Tax Receipt', purchOrders: 'Purchase Order', goodsRec: 'Goods Received Note', depreciation: 'Depreciation Voucher',
    amortization: 'Amortization Voucher' };
  var REF_LBL = { salesInv: 'Invoice No.', purchInv: 'Invoice No.', salesQuotes: 'Quotation No.', salesOrders: 'Order No.', creditNotes: 'Credit Note No.',
    deliveryNotes: 'Delivery Note No.', purchQuotes: 'Quotation No.', purchOrders: 'PO No.', debitNotes: 'Debit Note No.', goodsRec: 'GRN No.', receipts: 'Receipt No.',
    payments: 'Voucher No.', iat: 'Voucher No.', journal: 'Voucher No.', expenseClaims: 'Claim No.', payslips: 'Payslip No.', whtReceipts: 'Certificate No.' };
  var PARTY_LBL = { salesQuotes: 'Quotation For', salesOrders: 'Bill To', salesInv: 'Bill To', creditNotes: 'Credit To', deliveryNotes: 'Deliver To',
    purchQuotes: 'Supplier', purchOrders: 'Supplier', purchInv: 'Supplier', debitNotes: 'Supplier', goodsRec: 'Received From',
    receipts: 'Received From', payments: 'Paid To', payslips: 'Employee', expenseClaims: 'Claimant', whtReceipts: 'Customer' };
  var HERO_LBL = { receipts: 'Amount received', payments: 'Amount paid', iat: 'Amount transferred', expenseClaims: 'Amount claimed', whtReceipts: 'Tax withheld', payslips: 'Net pay' };
  var SIGNS = { receipts: ['Received by'], payments: ['Authorised signature', 'Receiver’s signature'], iat: ['Prepared by', 'Approved by'],
    journal: ['Prepared by', 'Approved by'], expenseClaims: ['Claimant', 'Approved by'], payslips: ['Employee signature', 'Authorised signature'],
    whtReceipts: ['Authorised signature'] };

  /* the "Fair Tax invoice" layout (the default for these; Letterhead for every other voucher) */
  var FT_KEYS = { salesInv: 1, creditNotes: 1, salesQuotes: 1, salesOrders: 1 };
  var FT_NOUN = { salesInv: 'Invoice', creditNotes: 'Credit Note', salesQuotes: 'Quotation', salesOrders: 'Order' };
  var FT_PARTY = { salesInv: 'Invoice To', creditNotes: 'Credit To', salesQuotes: 'Quotation For', salesOrders: 'Order For' };
  var FT_ACCEPT = { salesInv: 'Received by', creditNotes: 'Received by', salesQuotes: 'Accepted by', salesOrders: 'Accepted by' };

  /* ------------------------------------------------------------------ business document settings */
  function ds(b) { return (b && b.details) || {}; }
  function enabled(b) { return ds(b).docLayout !== 'classic'; }
  /** Settings value of the Layout select: fairtax (default; a legacy 'standard' meant "the default") | letterhead | classic. */
  function layoutOf(b) { var v = ds(b).docLayout; return v === 'classic' || v === 'letterhead' ? v : 'fairtax'; }
  function ftOn(b, key) { return !!FT_KEYS[key] && layoutOf(b) === 'fairtax'; }
  function colour(v, def) { v = String(v || '').trim(); return /^#[0-9a-f]{3,8}$/i.test(v) ? v : def; }
  function currencyOf(b) { var d = ds(b); return String(d.currency || (b && (b.currency || b.baseCurrency)) || '').trim(); }

  function keyOf(c, opts) {
    if (opts && opts.key) return opts.key;
    var L = l2k(); if (c && c.label && L[c.label]) return L[c.label];
    var R = reg(); for (var k in R) if (R[k] === c) return k;
    return A.wsSection ? L[A.wsSection] || null : null;
  }
  function kindOf(c) { return (c && c.lines && c.lines.kind) || ''; }
  function hasTheme(b, key, rec) {
    if (!rec || blank(rec.theme) || !THEME_KEYS[key]) return false;
    return ((b && b.customThemes) || []).some(function (t) { return t && String(t.id) === String(rec.theme); });
  }
  function printOff(rec, opts) { var o = {}; if (!(opts && opts.edit)) (Array.isArray(rec.printOff) ? rec.printOff : []).forEach(function (v) { o[v] = 1; }); return o; }

  function titleFor(b, key, c, rec) {
    if (rec.customTitleOn && !blank(rec.customTitle)) return String(rec.customTitle);
    var vat = !blank(ds(b).taxNumber) && num(rec.tax) !== 0;
    if (key === 'salesInv') return vat ? 'Tax Invoice' : 'Invoice';
    if (key === 'creditNotes') return vat ? 'Tax Credit Note' : 'Credit Note';
    return TITLES[key] || (c && c.singular) || 'Document';
  }
  function partyOf(key, rec) {
    switch (key) {
      case 'receipts': return rec.paidBy || rec.customer || '';
      case 'payments': return rec.payee || rec.supplier || '';
      case 'payslips': return rec.employee || rec.empName || '';
      case 'expenseClaims': return rec.payer || rec.employee || '';
      case 'whtReceipts': return rec.customer || rec.custName || '';
      default: return rec.customer || rec.supplier || '';
    }
  }
  function partyRec(b, key, name) {
    if (blank(name)) return null; var R = (b && b.records) || {};
    var lists = key === 'payslips' || key === 'expenseClaims' ? ['employees'] : (PURCHASE[key] || key === 'payments' ? ['suppliers', 'customers'] : ['customers', 'suppliers']);
    for (var i = 0; i < lists.length; i++) { var r = (R[lists[i]] || []).filter(function (x) { return x && x.name === name; })[0]; if (r) return r; }
    return null;
  }
  function payslipNet(rec) {
    if (!blank(rec.netPay)) return num(rec.netPay);
    var e = 0, d = 0; (rec.lines || []).forEach(function (l) { if (!l) return; var a = num(l.amount != null && l.amount !== '' ? l.amount : l.net), pt = String(l.ptype || l.type || '').toLowerCase();
      if (pt === 'contribution') return; if (pt === 'deduction' || a < 0) d += Math.abs(a); else e += a; });
    return r2(e - d);
  }
  function heroAmount(key, rec) {
    var sumLines = function () { return r2((rec.lines || []).reduce(function (s, l) { return s + num(l && l.amount); }, 0)); };
    switch (key) {
      case 'receipts': case 'payments': return num(rec.amount) || sumLines();
      case 'iat': case 'whtReceipts': return num(rec.amount);
      case 'expenseClaims': return !blank(rec.total) ? num(rec.total) : (num(rec.amount) || sumLines());
      case 'payslips': return payslipNet(rec);
    }
    return null;
  }

  /* ------------------------------------------------------------------ a tiny top-level HTML splitter */
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  /** Split an HTML fragment into its top-level nodes (elements, comments, text). The app's
      own markup is escaped, so a '>' never appears inside an attribute value. */
  function splitTop(html) {
    var out = [], depth = 0, start = 0, re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g, m;
    var push = function (s) { if (s && s.trim()) out.push(s); };
    while ((m = re.exec(html))) {
      if (m[0].charAt(1) === '!') { if (depth === 0) { push(html.slice(start, m.index)); push(m[0]); start = re.lastIndex; } continue; }
      var tag = m[2].toLowerCase(), close = m[1] === '/', self = m[3] === '/' || VOID[tag];
      if (close) { depth--; if (depth <= 0) { depth = 0; push(html.slice(start, re.lastIndex)); start = re.lastIndex; } }
      else if (self) { if (depth === 0) { push(html.slice(start, m.index)); push(m[0]); start = re.lastIndex; } }
      else { if (depth === 0) { push(html.slice(start, m.index)); start = m.index; } depth++; }
    }
    push(html.slice(start));
    return out;
  }
  function clsOf(seg) { var m = /^<[a-zA-Z][\w-]*\b[^>]*?\bclass="([^"]*)"/.exec(seg); return m ? ' ' + m[1] + ' ' : ''; }
  function has(seg, c) { return clsOf(seg).indexOf(' ' + c + ' ') >= 0; }
  function textOf(h) { return String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim(); }

  /* ------------------------------------------------------------------ pieces */
  function prettyLabel(key, t) {
    var u = textOf(t).toUpperCase();
    if (u === 'INVOICE NUMBER' || u === 'REFERENCE') return REF_LBL[key] || 'Reference';
    if (u === 'INVOICE DATE' || u === 'BILL DATE' || u === 'DATE') return 'Date';
    if (u === 'DUE DATE') return 'Due date';
    var s = textOf(t).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function sigBlock(labels, co) {
    return '<div class="dt-sign">' + labels.map(function (l, i) {
      return '<div class="dt-sig"><div class="dt-sig-s">' + (i === 0 ? 'For ' + co : '&nbsp;') + '</div><div class="dt-sig-l"></div><div class="dt-sig-t">' + esc(l) + '</div></div>'; }).join('') + '</div>';
  }
  function table(cols, rows, foot) {
    return '<div class="iv-twrap dt-extra"><table class="iv-table"><thead><tr class="iv-thr">' + cols.map(function (c) { return '<th style="text-align:' + (c.r ? 'right' : 'left') + '">' + esc(c.th) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) { return '<tr class="iv-row' + (i === rows.length - 1 ? ' iv-lastrow' : '') + '">' + r.map(function (v, j) { return '<td style="text-align:' + (cols[j].r ? 'right' : 'left') + '">' + v + '</td>'; }).join('') + '</tr>'; }).join('') +
      (foot ? '<tr class="iv-coltot">' + foot.map(function (v, j) { return '<td style="text-align:' + (cols[j].r ? 'right' : 'left') + '">' + v + '</td>'; }).join('') + '</tr>' : '') +
      '</tbody></table></div>';
  }
  /** Inventory transfer / write-off / production order lines (the classic view lists none). */
  function qtyTable(b, rec) {
    var L = (rec.lines || []).filter(function (l) { return l && (!blank(l.item || l.items) || !blank(l.desc || l.description) || num(l.qty)); });
    if (!L.length) return '';
    var withAmt = L.some(function (l) { return num(l.amount) || num(l.unitCost); });
    var cols = [{ th: '#' }, { th: 'Item' }, { th: 'Description' }, { th: 'Qty', r: 1 }].concat(withAmt ? [{ th: 'Unit cost', r: 1 }, { th: 'Amount', r: 1 }] : []);
    var q = 0, t = 0;
    var rows = L.map(function (l, i) { q += num(l.qty); t += num(l.amount); var it = l.item || l.items || '', de = l.desc || l.description || '';
      return [String(i + 1), esc(it), esc(de !== it ? de : ''), esc(blank(l.qty) ? '' : (A.numStr ? A.numStr(num(l.qty)) : String(l.qty)))].concat(withAmt ? [blank(l.unitCost) ? '' : money(l.unitCost), num(l.amount) ? money(l.amount) : ''] : []); });
    return table(cols, rows, ['Total', '', '', esc(A.numStr ? A.numStr(r2(q)) : String(r2(q)))].concat(withAmt ? ['', money(t)] : []));
  }
  /** Fixed-asset depreciation / amortization lines (rate is depRate on stored records). */
  function deprTable(key, rec) {
    var L = (rec.lines || []).filter(function (l) { return l && (!blank(l.asset) || num(l.amount)); });
    if (!L.length) return '';
    var t = 0, lbl = key === 'amortization' ? 'Amortization' : 'Depreciation';
    var rows = L.map(function (l) { var a = num(l.amount != null && l.amount !== '' ? l.amount : (l.depExpense || l.amortExpense)); t += a; var rate = !blank(l.depRate) ? l.depRate : l.rate;
      return [esc(l.asset || ''), blank(l.cost) ? '' : money(l.cost), blank(l.accDep) ? '' : money(l.accDep), blank(rate) ? '' : esc(rate) + '%', money(a), blank(l.wdv) ? '' : money(l.wdv)]; });
    var anyWdv = L.some(function (l) { return !blank(l.wdv); });
    var cols = [{ th: key === 'amortization' ? 'Intangible asset' : 'Fixed asset' }, { th: 'Cost', r: 1 }, { th: 'Accumulated', r: 1 }, { th: 'Rate', r: 1 }, { th: lbl, r: 1 }];
    if (anyWdv) cols.push({ th: 'Written-down value', r: 1 }); else rows = rows.map(function (r) { return r.slice(0, 5); });
    return table(cols, rows, ['Total', '', '', '', money(rec.amount != null && rec.amount !== '' && !anyWdv ? rec.amount : t)].concat(anyWdv ? [''] : []));
  }
  /** The invoices a receipt / payment pays (rec.allocations: [{key, uid, party, amount}]). */
  function allocTable(b, rec) {
    var al = Array.isArray(rec.allocations) ? rec.allocations.filter(function (a) { return a && num(a.amount); }) : [];
    if (!al.length) return '';
    var R = (b && b.records) || {}, tot = 0;
    var rows = al.map(function (a) {
      var inv = (R[a.key] || []).filter(function (r) { return r && (r.uuid === a.uid || 'id:' + r.id === a.uid || String(r.id) === String(a.uid)); })[0] || {};
      tot += num(a.amount);
      return [esc(inv.reference || '—'), esc(fmtD(inv.issueDate || inv.date)), esc(a.party || inv.customer || inv.supplier || ''), blank(inv.total) ? '' : money(inv.total), money(a.amount)]; });
    var isRc = al[0].key !== 'purchInv';
    return '<div class="dt-sec-h">' + (isRc ? 'Invoices settled' : 'Bills settled') + '</div>' +
      table([{ th: isRc ? 'Invoice No.' : 'Bill No.' }, { th: 'Date' }, { th: isRc ? 'Customer' : 'Supplier' }, { th: 'Invoice total', r: 1 }, { th: 'Amount applied', r: 1 }], rows, ['Total', '', '', '', money(r2(tot))]);
  }

  /* ------------------------------------------------------------------ letterhead (App._ivHeader) */
  var CTX = null;
  var origHeader = A._ivHeader;
  A._ivHeader = function (title, logoImg, co, bizLines) {
    var x = CTX; if (!x) return origHeader.apply(this, arguments);
    if (x.ft) return ftHeader(x, logoImg, co);
    var d = ds(x.b), lic = d.tradeLicense && d.tradeLicense.number, lines = bizLines || '';
    if (lic && d.docShowLicence !== false && A.cfgShow(x.b, x.key, 'bizAddress')) lines = (lines ? lines + '<br>' : '') + 'Licence No. ' + esc(lic);
    var hideName = !!(logoImg && d.docLogoHasName);
    x.co = co;
    return '<header class="iv-header dt-lh"><div class="dt-lh-l">' + (logoImg ? '<div class="dt-logo">' + logoImg + '</div>' : '') +
        (hideName ? '' : '<div class="dt-lh-n"><div class="dt-co">' + co + '</div>' + (blank(d.docTagline) ? '' : '<div class="dt-tag">' + esc(d.docTagline) + '</div>') + '</div>') + '</div>' +
        '<address class="iv-binfo dt-lh-r"><strong>' + co + '</strong>' + lines + '</address></header>' +
      '<div class="dt-rule"><i></i><i></i></div>' +
      '<div class="dt-band"><h1 class="iv-title">' + esc(x.title) + '</h1><!--dt-meta--></div>';
  };

  /* ------------------------------------------------------------------ the re-arrangement */
  function transform(h, x) {
    var top = splitTop(h), ci = -1;
    for (var i = 0; i < top.length; i++) { if (/^<div class="iv-card[ "]/.test(top[i])) { ci = i; break; } }
    if (ci < 0) return h;
    var card = top[ci], open = card.slice(0, card.indexOf('>') + 1), inner = card.slice(open.length, card.length - 6);
    var segs = splitTop(inner), b = x.b, rec = x.rec, key = x.key, kind = x.kind, co = x.co || esc(ds(b).legalName || b.name || '');
    var metaDl = '', billIdx = -1;

    /* 1. meta fields move into the title band; the party becomes the "Bill to" box */
    segs = segs.map(function (s) {
      if (!has(s, 'iv-meta')) return s;
      var m = /<dl class="iv-fields">([\s\S]*?)<\/dl>/.exec(s);
      if (m) { metaDl += m[1]; s = s.replace(m[0], ''); }
      var ri = /<address class="iv-rinfo">([\s\S]*?)<\/address>/.exec(s);
      if (!ri || !textOf(ri[1].replace(/<div class="iv-party-lbl">[\s\S]*?<\/div>/, ''))) return '';
      var lbl = PARTY_LBL[key] || (PURCHASE[key] ? 'Supplier' : 'Bill To');
      var body = /<div class="iv-party-lbl">[\s\S]*?<\/div>/.test(ri[1]) ? ri[1].replace(/<div class="iv-party-lbl">[\s\S]*?<\/div>/, '<div class="iv-party-lbl">' + esc(lbl) + '</div>') : '<div class="iv-party-lbl">' + esc(lbl) + '</div>' + ri[1];
      if (!INVOICE[key] && body.indexOf('</strong>') >= 0 && !textOf(body.slice(body.indexOf('</strong>')))) {    // name only: add the party's address / TRN
        var pr0 = partyRec(b, key, textOf(/<strong>([\s\S]*?)<\/strong>/.exec(body)[1]).replace(/&amp;/g, '&')), more = [];
        if (pr0) { String(pr0.address || '').split('\n').forEach(function (l) { if (l.trim()) more.push(esc(l)); }); if (!blank(pr0.trn)) more.push('TRN: ' + esc(pr0.trn)); }
        body += more.join('<br>');
      }
      var seen = {}; body = body.split('<br>').filter(function (ln) { var k = textOf(ln).toLowerCase(); if (!k) return true; if (seen[k]) return false; seen[k] = 1; return true; }).join('<br>');
      return '<div class="iv-meta dt-billto"><address class="iv-rinfo">' + body + '</address></div>';
    }).filter(Boolean);
    var moved = [];
    if (metaDl) metaDl = metaDl.replace(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g, function (m0, t, v) {
      if (!textOf(v)) return '';                                                    // a field with nothing to say
      if (PARTY_LBL[key] && !INVOICE[key] && textOf(v) === textOf(esc(partyOf(key, rec)))) return '';   // the party has its own box
      var lb = prettyLabel(key, t);
      if (/^(description|narration)$/i.test(lb)) { moved.push(v); return ''; }       // long text reads better under the band
      return '<dt>' + esc(lb) + '</dt><dd>' + v + '</dd>'; });
    if (moved.length && !segs.some(function (s) { return has(s, 'iv-desc'); })) {
      var bi0 = -1; segs.forEach(function (s, k) { if (has(s, 'dt-band') || has(s, 'dt-billto')) bi0 = k; });
      segs.splice(bi0 + 1, 0, '<p class="iv-desc">' + moved.join('<br>') + '</p>');
    }
    segs = segs.map(function (s) { return s.indexOf('<!--dt-meta-->') >= 0 ? s.replace('<!--dt-meta-->', metaDl ? '<dl class="iv-fields dt-meta">' + metaDl + '</dl>' : '') : s; });
    var find = function (c) { for (var k = 0; k < segs.length; k++) if (has(segs[k], c)) return k; return -1; };
    var findLast = function (c) { for (var k = segs.length - 1; k >= 0; k--) if (has(segs[k], c)) return k; return -1; };
    var bandIdx = find('dt-band');

    /* 2. a party box where the classic layout had none (expense claimant, payslip employee, WHT customer) */
    billIdx = find('dt-billto');
    var party = partyOf(key, rec);
    if (billIdx < 0 && !blank(party) && PARTY_LBL[key] && !INVOICE[key]) {
      var pr = partyRec(b, key, party), sub = [];
      if (pr) { if (!blank(pr.code)) sub.push('Code: ' + esc(pr.code)); if (!blank(pr.designation)) sub.push(esc(pr.designation)); if (!blank(pr.trn)) sub.push('TRN: ' + esc(pr.trn)); }
      var box = '<div class="iv-meta dt-billto"><address class="iv-rinfo"><div class="iv-party-lbl">' + esc(PARTY_LBL[key]) + '</div><strong>' + esc(party) + '</strong>' + sub.join('<br>') + '</address></div>';
      segs.splice(bandIdx >= 0 ? bandIdx + 1 : 0, 0, box); billIdx = bandIdx >= 0 ? bandIdx + 1 : 0;
    }

    /* 3. amount box with the amount in words */
    var hv = heroAmount(key, rec);
    if (hv != null && HERO_LBL[key]) {
      var off = x.off, words = rec.amountInWords !== false && !off['f:amounts_in_word'];
      var hero = '<div class="dt-amt"><div class="dt-amt-l">' + esc(HERO_LBL[key]) + '</div><div class="dt-amt-n">' + (x.cur ? '<small>' + esc(x.cur) + '</small> ' : '') + money(hv) + '</div>' +
        (words ? '<div class="dt-amt-w">' + esc(A.amountInWords(hv, x.cur)) + '</div>' : '') + '</div>';
      var at = billIdx >= 0 ? billIdx : (bandIdx >= 0 ? bandIdx + 1 : 0);
      segs.splice(at, 0, hero);
    }

    /* 4. line tables the classic view does not draw (or draws incompletely) */
    var extra = '';
    if (kind === 'qty' || kind === 'writeoff') extra = qtyTable(b, rec);
    else if (kind === 'depr' || kind === 'amort') { extra = deprTable(key, rec); if (extra) segs = segs.filter(function (s) { return !has(s, 'iv-twrap'); }); }
    if (extra) {
      var after = Math.max(findLast('iv-desc'), findLast('sfa-cfprint'), find('dt-billto'), find('dt-amt'), bandIdx);
      segs.splice(after + 1, 0, extra);
    }

    /* 5. receipts / payments: the invoices they settle, under the lines */
    if (key === 'receipts' || key === 'payments') {
      var at2 = findLast('iv-twrap'), al = allocTable(b, rec);
      if (al) segs.splice(at2 >= 0 ? at2 + 1 : segs.length, 0, al);
    }

    /* 6. bank details: "Payment details"; the business's own when the document has none */
    segs = segs.map(function (s) { return has(s, 'iv-bankbox') ? s.replace(/<div class="iv-bb-lbl">[\s\S]*?<\/div>/, '<div class="iv-bb-lbl">Payment details</div>') : s; });
    var dBank = String(ds(b).docBank || '').trim();
    if (BANK_DOCS[key] && dBank && find('iv-bankbox') < 0 && !(x.opts && x.opts.edit) && (rec.printBankDetails == null || rec.printBankDetails) &&
        A.cfgShow(b, key, 'bankDetails') && !x.off['f:bank_accounts_detail']) {
      var bi = find('iv-belowtbl'); var bank = '<div class="iv-bankbox"><div class="iv-bb-lbl">Payment details</div><div class="iv-bb-area">' + esc(dBank).split('\n').join('<br>') + '</div></div>';
      segs.splice(bi >= 0 ? bi + 1 : segs.length, 0, bank);
    }

    /* 7. signature lines where the classic layout has none */
    if (find('iv-sign') < 0) {
      var labels = SIGNS[key] || (kind ? ['Prepared by', 'Approved by'] : null);
      if (labels) { var si = find('iv-cf'); if (si < 0) si = find('iv-status'); segs.splice(si >= 0 ? si : segs.length, 0, sigBlock(labels, co)); }
    }

    /* 8. currency on the grand total rows */
    if (x.cur) segs = segs.map(function (s) {
      return (has(s, 'iv-belowtbl') || s.indexOf('iv-totrow-g') >= 0) ? s.replace(/(<div class="iv-totrow iv-totrow-g"><span>[\s\S]*?<\/span><span>)/g, '$1<small class="dt-cur">' + esc(x.cur) + '</small> ') : s; });

    /* 9. one total per table: the column totals and a "Total" row saying the same thing collapse
          (journals keep the Debit / Credit column totals); an item whose description only
          repeats its name prints once */
    segs = segs.map(function (s) {
      if (!has(s, 'iv-twrap')) return s;
      if (s.indexOf('<tr class="iv-coltot">') >= 0 && s.indexOf('<tr class="iv-tot">') >= 0) {
        s = kind === 'journal' ? s.replace(/<tr class="iv-tot">[\s\S]*?<\/tr>/g, '') : s.replace(/<tr class="iv-coltot">[\s\S]*?<\/tr>/, '');
      }
      s = s.replace(/(<tr class="iv-coltot"><td[^>]*>)(<\/td>)/, '$1Total$2');
      if (kind === 'journal') { var z = '>' + money(0) + '</td>'; s = s.replace(/<tr class="iv-row[^"]*">[\s\S]*?<\/tr>/g, function (row) { return row.split(z).join('></td>'); }); }
      return s.replace(/>([^<>]+)<div class="iv-sub">([^<]*)<\/div>/g, function (m0, a, sub) { return a.trim() === sub.trim() ? '>' + a : m0; });
    });

    /* 10. the footer line */
    if (ds(b).docNoFootNote !== true) segs.push('<div class="dt-foot">This is a computer-generated ' + esc(String(x.title).toLowerCase()) + ' issued by ' + co + '.</div>');

    var d = ds(b), style = '--dt-ink:' + colour(d.docAccent, '#17324c') + ';--dt-acc:' + colour(d.docAccent2, '#c1922b');
    var nopen = open.replace(/class="iv-card([^"]*)"/, function (m0, rest) { return 'class="iv-card dt-doc dt-k-' + esc(key || 'doc') + rest + '" style="' + style + '"'; });
    top[ci] = nopen + segs.join('') + '</div>';
    return top.join('');
  }

  /* ------------------------------------------------------------------ the "Fair Tax invoice" layout
     Sales quotes, orders, invoices and credit notes, modelled on the Fair Tax International tax
     invoices: letterhead (logo + tagline left, business identity right), a gold rule, a navy title
     bar, "Invoice To" / "Invoice Details" panels, a navy-headed line table, amount in words beside
     the totals (grand row in navy), bank details beside terms & notes, two signature blocks and a
     footer line with the business identity. On paper the letterhead and footer repeat on every page. */
  function ftFirm(x, co) {
    var d = ds(x.b), show = A.cfgShow(x.b, x.key, 'bizAddress'), lic = d.tradeLicense && d.tradeLicense.number;
    return { co: co,
      lic: !blank(lic) && d.docShowLicence !== false && show ? String(lic).trim() : '',
      trn: !blank(d.taxNumber) && A.cfgShow(x.b, x.key, 'trn') ? String(d.taxNumber).trim() : '',
      addr: show ? String(d.address || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [],
      email: show && !blank(d.email) ? String(d.email).trim() : '',
      phone: show ? String(d.phone || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join(' · ') : '' };
  }
  var DOT = ' <span class="ft-dot">&middot;</span> ';
  function ftHeader(x, logoImg, co) {
    var d = ds(x.b), f = ftFirm(x, co); x.co = co; x.firm = f; x.logoImg = logoImg || '';
    var ids = [f.lic ? 'Licence No. ' + esc(f.lic) : '', f.trn ? '<span class="ft-trn">TRN ' + esc(f.trn) + '</span>' : ''].filter(Boolean).join(DOT);
    var lines = [ids].concat(f.addr.map(esc)).concat([[esc(f.email), esc(f.phone)].filter(Boolean).join(DOT)]).filter(Boolean);
    var left = (logoImg ? '<div class="dt-logo ft-logo">' + logoImg + '</div>' : '<div class="dt-co ft-brand">' + co + '</div>') +
      (blank(d.docTagline) ? '' : '<div class="dt-tag ft-tag">' + esc(d.docTagline) + '</div>');
    var sub = x.key === 'salesInv' || x.key === 'creditNotes' ? '<div class="ft-sub">Original for Recipient</div>' : '';
    return '<header class="iv-header dt-lh ft-lh"><div class="ft-lh-l">' + left + '</div>' +
        '<address class="iv-binfo ft-firm"><strong>' + co + '</strong>' + lines.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</address></header>' +
      '<div class="dt-rule ft-rule"></div>' +
      '<div class="dt-band ft-band"><h1 class="iv-title">' + esc(x.title) + '</h1>' + sub + '</div>';
  }
  function ftLabel(key, t) {
    var u = textOf(t).toUpperCase();
    if (u === 'INVOICE NUMBER' || u === 'REFERENCE') return REF_LBL[key] || 'Reference';
    if (u === 'INVOICE DATE' || u === 'BILL DATE' || u === 'DATE') return (FT_NOUN[key] || 'Document') + ' Date';
    if (u === 'DUE DATE') return 'Due Date';
    if (u === 'VALID UNTIL') return 'Valid Until';
    var s = textOf(t); return s === u ? s.charAt(0) + s.slice(1).toLowerCase() : s;
  }
  function ftPanel(cls, head, body) { return '<div class="ft-panel ' + cls + '"><div class="ft-ph">' + head + '</div><div class="ft-pb">' + body + '</div></div>'; }
  /** "Key: value" lines become a two-column table (bank details). */
  function ftKv(lines) {
    return '<table class="ft-kv">' + lines.map(function (l) {
      var m = /^([^:]{1,40}?)\s*:\s*(.+)$/.exec(l);
      return m ? '<tr><td class="k">' + m[1] + '</td><td class="v">' + m[2] + '</td></tr>' : '<tr><td class="v" colspan="2">' + l + '</td></tr>'; }).join('') + '</table>';
  }
  function ftTaxName(rec) {
    var n = {}; (rec.lines || []).forEach(function (l) { var t = l && (l.taxCode || l.tax); if (!blank(t)) n[String(t).trim()] = 1; });
    var k = Object.keys(n); return k.length === 1 && isNaN(Number(k[0])) ? k[0] : 'Tax';
  }
  function ftAmt(v, cur) {
    var t = textOf(v), neg = /^\s*[-(−]/.test(t), core = t.replace(/^[\s\-(−]+|[)\s]+$/g, '');
    var out = (cur ? esc(cur) + ' ' : '') + core; return neg ? '(' + out + ')' : out;
  }
  function ftTotals(s, x) {
    var rec = x.rec, d = ds(x.b), cur = x.cur, rows = [], taxNm = ftTaxName(rec), bal = -1;
    s.replace(/<div class="iv-totrow( iv-totrow-g)?"><span>([\s\S]*?)<\/span><span>([\s\S]*?)<\/span><\/div>/g, function (m0, g, l, v) {
      var lb = textOf(l);
      if (lb === 'Subtotal') lb = 'Sub-total';
      else if (lb === 'Tax') lb = taxNm;
      else if (/^Includes /.test(lb)) lb = 'Includes ' + (taxNm === 'Tax' ? lb.slice(9) : taxNm);
      else if (lb === 'Balance due') { lb = 'Balance Due'; bal = rows.length; }
      rows.push({ l: esc(lb), v: v }); return m0; });
    if (bal >= 0) {                                                     // what has been received so far
      var bd = num(textOf(rows[bal].v).replace(/[\s−]/g, '').replace(/^\((.*)\)$/, '-$1')), paid = r2(num(rec.total) - num(rec.withholdingAmt) - bd);
      if (paid > 0.004) rows.splice(bal, 0, { l: 'Amount received', v: '-' + money(paid) });
    }
    var tr = rows.map(function (r, i) { return '<tr' + (i === rows.length - 1 ? ' class="grand"' : '') + '><td class="k">' + r.l + '</td><td class="v">' + ftAmt(r.v, cur) + '</td></tr>'; }).join('');
    var w = /<span class="iv-aw-val">([\s\S]*?)<\/span>/.exec(s), words = w ? w[1].trim() : '';
    if (words && num(rec.tax)) words += ' (inclusive of ' + (/vat/i.test(taxNm) || !blank(d.taxNumber) ? 'VAT' : 'tax') + ')';
    if (words && !/\.$/.test(words)) words += '.';
    return '<div class="ft-row ft-row-tot">' + (words ? ftPanel('ft-aiw', 'Amount in Words', '<div class="ft-aiw-t">' + words + '</div>') : '<div></div>') +
      (tr ? '<table class="ft-tot">' + tr + '</table>' : '<div></div>') + '</div>';
  }
  function ftSign(x, party) {
    var sig = function (lead, name, meta) { return '<div class="ft-sig"><div class="ft-sig-for">' + lead + ' <span>' + (name || '&nbsp;') + '</span></div><div class="ft-sig-line"></div><div class="ft-sig-meta">' + meta + '</div></div>'; };
    return '<div class="ft-sign">' + sig('For and on behalf of', x.co, 'Authorised Signatory<br>Date &amp; Company Stamp') +
      sig(FT_ACCEPT[x.key] || 'Received by', party, 'Name &middot; Designation &middot; Signature<br>Date &amp; Company Stamp') + '</div>';
  }
  function ftTransform(h, x) {
    var top = splitTop(h), ci = -1;
    for (var i = 0; i < top.length; i++) { if (/^<div class="iv-card[ "]/.test(top[i])) { ci = i; break; } }
    if (ci < 0) return h;
    var card = top[ci], open = card.slice(0, card.indexOf('>') + 1), inner = card.slice(open.length, card.length - 6);
    var b = x.b, rec = x.rec, key = x.key, d = ds(b), co = x.co || esc(d.legalName || b.name || ''), ed = !!(x.opts && x.opts.edit);
    var segs = splitTop(inner), head = [], body = [], cfs = [], terms = [], party = '', disc = '', bank = null, tableSeen = false, hasTot = segs.some(function (s) { return has(s, 'iv-belowtbl'); });
    if (BANK_DOCS[key] && !blank(d.docTerms)) terms.push(esc(String(d.docTerms).trim()).split('\n').join('<br>'));
    segs.forEach(function (s) {
      if (has(s, 'ft-lh') || has(s, 'ft-rule') || has(s, 'ft-band')) { head.push(s); return; }
      if (has(s, 'iv-meta')) {                                          // party + document fields -> two panels
        var boxes = '', ri = /<address class="iv-rinfo">([\s\S]*?)<\/address>/.exec(s), m = /<dl class="iv-fields">([\s\S]*?)<\/dl>/.exec(s);
        if (ri) {
          var pb = ri[1].replace(/<div class="iv-party-lbl">[\s\S]*?<\/div>/, ''), nm = /<strong>([\s\S]*?)<\/strong>/.exec(pb), seen = {};
          party = nm ? nm[1] : '';
          var rest = (nm ? pb.slice(pb.indexOf('</strong>') + 9) : pb).split('<br>').filter(function (ln) { var k = textOf(ln).toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; });
          if (textOf(party) || rest.length) boxes += ftPanel('ft-party', esc(FT_PARTY[key] || 'Bill To'), (textOf(party) ? '<div class="ft-pname">' + party + '</div>' : '') + (rest.length ? '<div class="ft-addr">' + rest.join('<br>') + '</div>' : ''));
        }
        var rows = [];
        if (m) m[1].replace(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g, function (m0, t, v) { if (textOf(v)) rows.push([ftLabel(key, t), v]); return m0; });
        var ri0 = -1; rows.forEach(function (r, k) { if (r[0] === REF_LBL[key]) ri0 = k; });
        if (ri0 > 0) rows.unshift(rows.splice(ri0, 1)[0]);              // the number first
        if (rows.length) boxes += ftPanel('ft-details', esc((FT_NOUN[key] || 'Document') + ' Details'), '<table class="ft-kv">' + rows.map(function (r) { return '<tr><td class="k">' + esc(r[0]) + '</td><td class="v">' + r[1] + '</td></tr>'; }).join('') + '</table>');
        if (boxes) body.push('<div class="ft-row ft-row-top">' + boxes + '</div>');
        return;
      }
      if (!ed && !tableSeen && (has(s, 'sfa-cfprint') || has(s, 'iv-cblock'))) { if (!cfs.length) body.push('<!--ft-cf-->'); cfs.push(has(s, 'sfa-cfprint') ? s.slice(s.indexOf('>') + 1, -6) : s); return; }
      if (has(s, 'iv-twrap')) {
        tableSeen = true;
        if (hasTot) s = s.replace(/<tr class="iv-coltot">[\s\S]*?<\/tr>/, '');      // the totals table says it
        if (x.cur) s = s.replace(/>Total(<\/th><\/tr><\/thead>)/, '>Total (' + esc(x.cur) + ')$1');
        s = s.replace(/>([^<>]+)<div class="iv-sub">([^<]*)<\/div>/g, function (m0, a, sub) { return a.trim() === sub.trim() ? '>' + a : m0; });
        body.push(s.replace('<div class="iv-twrap">', '<div class="iv-twrap ft-items">')); return;
      }
      if (has(s, 'iv-belowtbl')) { body.push(ftTotals(s, x)); body.push('<!--ft-bt-->'); return; }
      if (has(s, 'iv-bankbox')) { var ba = /<div class="iv-bb-area">([\s\S]*?)<\/div>/.exec(s); bank = ba ? ba[1].split('<br>').filter(function (l) { return textOf(l); }) : []; if (ed && !bank.length) bank = ['&nbsp;']; return; }
      if (has(s, 'iv-cf')) {                                            // disclaimer -> footer line; footers -> terms & notes
        splitTop(s.slice(s.indexOf('>') + 1, -6)).forEach(function (blk) {
          var bi = blk.slice(blk.indexOf('>') + 1, -6);
          if (/^<strong>Disclaimer<\/strong>/.test(bi)) disc = bi.replace(/^<strong>Disclaimer<\/strong>/, ''); else if (textOf(bi)) terms.push(bi);
        });
        return;
      }
      if (has(s, 'iv-sign')) { body.push('<!--ft-bt-->' + ftSign(x, party)); return; }
      body.push(s);
    });
    /* the business's bank details when the document has none of its own (as on the Letterhead layout) */
    var dBank = String(d.docBank || '').trim();
    if (!bank && BANK_DOCS[key] && dBank && !ed && (rec.printBankDetails == null || rec.printBankDetails) && A.cfgShow(b, key, 'bankDetails') && !x.off['f:bank_accounts_detail'])
      bank = esc(dBank).split('\n').filter(function (l) { return l.trim(); });
    var bt = (bank && bank.length ? ftPanel('ft-bank', 'Bank Details', ftKv(bank)) : '') + (terms.length ? ftPanel('ft-terms', 'Terms &amp; Notes', terms.map(function (t) { return '<div class="ft-note">' + t + '</div>'; }).join('')) : '');
    var content = body.join(''), btAt = content.indexOf('<!--ft-bt-->');
    if (bt) bt = '<div class="ft-row ft-row-bt">' + bt + '</div>';
    content = btAt >= 0 ? content.slice(0, btAt) + bt + content.slice(btAt).split('<!--ft-bt-->').join('') : content + bt;
    if (cfs.length) {
      var blocks = []; cfs.forEach(function (c) { splitTop(c).forEach(function (blk) { if (has(blk, 'iv-cblock')) blocks.push(blk); }); });
      content = content.replace('<!--ft-cf-->', blocks.length ? ftPanel('ft-cf', 'Reference Details', '<div class="ft-cfgrid">' + blocks.join('') + '</div>') : '');
    }
    /* the footer line: the business identity, then the disclaimer (or the computer-generated note) */
    var f = x.firm || ftFirm(x, co), t = String(x.title || '').toLowerCase();
    var l1 = ['<span class="ft-fco">' + co + '</span>', f.lic ? 'Licence No. ' + esc(f.lic) : '', f.trn ? 'TRN ' + esc(f.trn) : '', esc(f.email), esc(f.phone)].filter(Boolean).join(DOT);
    if (!disc && d.docNoFootNote !== true) disc = /^tax /.test(t) && /^aed$/i.test(x.cur) && f.trn ?
      'This is a computer-generated ' + esc(t) + ' issued under Federal Decree-Law No. 8 of 2017 on Value Added Tax and is valid without a physical signature.' :
      'This is a computer-generated ' + esc(t) + ' issued by ' + co + ' and is valid without a physical signature.';
    var foot = '<div class="dt-foot ft-foot"><div class="ft-fl1">' + l1 + '</div>' + (disc ? '<div class="ft-disc">' + disc + '</div>' : '') + '</div>';
    var wm = x.logoImg && d.docNoWatermark !== true ? '<div class="ft-wm" aria-hidden="true">' + x.logoImg + '</div>' : '';
    var st = '--dt-ink:' + colour(d.docAccent, '#17324c') + ';--dt-acc:' + colour(d.docAccent2, '#b8892a');
    var nopen = open.replace(/class="iv-card([^"]*)"/, function (m0, rest) { return 'class="iv-card dt-doc dt-k-' + esc(key) + ' dt-ft' + rest + '" style="' + st + '"'; });
    top[ci] = nopen + wm + '<div class="ft-fixfoot" aria-hidden="true">' + foot + '</div>' +
      '<table class="ft-page"><thead><tr><td>' + head.join('') + '<div class="ft-gap-t"></div></td></tr></thead>' +
      '<tfoot><tr><td><div class="ft-gap-b"></div>' + foot + '</td></tr></tfoot>' +
      '<tbody><tr><td><div class="ft-content">' + content + '</div></td></tr></tbody></table></div>';
    return top.join('');
  }

  /* ------------------------------------------------------------------ App.voucherDoc */
  var origVoucher = A.voucherDoc;
  A.voucherDoc = function (b, c, rec, opts) {
    c = c || {}; rec = rec || {};
    var key = keyOf(c, opts);
    if (!b || !key || CTX || !enabled(b) || hasTheme(b, key, rec)) return origVoucher.apply(this, arguments);
    if ((key === 'receipts' || key === 'payments') && b.formConfig && b.formConfig[key]) {
      var fc = b.formConfig[key]; if ((fc.vdoc && fc.vdoc.elements && fc.vdoc.elements.length) || (fc.docHtml && String(fc.docHtml).trim())) return origVoucher.apply(this, arguments);
    }
    var x = { b: b, c: c, rec: rec, opts: opts, key: key, kind: kindOf(c), title: titleFor(b, key, c, rec), cur: currencyOf(b), off: printOff(rec, opts), ft: ftOn(b, key) };
    var h; CTX = x;
    try { h = origVoucher.apply(this, arguments); } finally { CTX = null; }
    if (typeof h !== 'string' || h.indexOf('dt-band') < 0) return h;
    try { return x.ft ? ftTransform(h, x) : transform(h, x); } catch (e) { if (global.console) console.warn('doc-templates', e); return h; }
  };

  /* ------------------------------------------------------------------ Settings -> Business Details */
  function installSettings() {
    var SP = global.SettingsPages; if (!SP || !SP.PAGES || !SP.PAGES.business) return false;
    var P = SP.PAGES.business; if (P.__docTpl) return true; P.__docTpl = 1;
    var st = P.store, get0 = st.get, set0 = st.set;
    var KEYS = ['docLayout', 'docTagline', 'docBank', 'docTerms', 'docNoWatermark', 'docAccent', 'docAccent2', 'docLogoHasName', 'docShowLicence', 'docNoFootNote'];
    st.get = function (b) { var r = get0.apply(this, arguments), d = ds(b);
      r.docLayout = layoutOf(b); r.docTerms = d.docTerms || ''; r.docNoWatermark = !!d.docNoWatermark; r.docTagline = d.docTagline || ''; r.docBank = d.docBank || '';
      r.docAccent = d.docAccent || ''; r.docAccent2 = d.docAccent2 || ''; r.docLogoHasName = !!d.docLogoHasName; r.docShowLicence = d.docShowLicence !== false; r.docNoFootNote = !!d.docNoFootNote;
      return r; };
    st.set = function (b, r) { set0.apply(this, arguments); b.details = b.details || {};
      if (!KEYS.some(function (k) { return k in r; })) return;            // a caller that does not know these fields changes none of them
      var d = b.details;
      d.docLayout = r.docLayout === 'classic' || r.docLayout === 'letterhead' ? r.docLayout : 'fairtax';
      d.docTerms = String(r.docTerms || '').replace(/\s+$/, ''); d.docNoWatermark = !!r.docNoWatermark;
      d.docTagline = String(r.docTagline || '').trim(); d.docBank = String(r.docBank || '').replace(/\s+$/, '');
      d.docAccent = colour(r.docAccent, ''); d.docAccent2 = colour(r.docAccent2, '');
      d.docLogoHasName = !!r.docLogoHasName; d.docShowLicence = r.docShowLicence !== false && r.docShowLicence !== 0; d.docNoFootNote = !!r.docNoFootNote; };
    P.fields.push({ t: 'fieldset', l: 'Printed documents', fields: [
      { k: 'docLayout', l: 'Layout', t: 'select', opts: [['fairtax', 'Fair Tax invoice (default)'], ['letterhead', 'Letterhead'], ['classic', 'Classic']], hint: 'The default View / Print / PDF layout. Fair Tax invoice styles sales quotes, orders, invoices and credit notes; every other transaction uses Letterhead. A theme or a custom design chosen on a document still replaces it.' },
      { k: 'docTagline', l: 'Tagline under the name', t: 'text', ph: 'e.g. Audit · Tax · Advisory' },
      { k: 'docBank', l: 'Bank details', t: 'textarea', ph: 'Account title: …\nBank: …\nIBAN: …\nSWIFT: …', hint: 'Printed as Payment details on sales quotes, orders and invoices that have no bank details of their own.' },
      { k: 'docTerms', l: 'Terms & notes', t: 'textarea', ph: 'e.g. Payment is due on or before the due date by bank transfer to the account shown.', hint: 'Printed under Terms & Notes on sales quotes, orders and invoices (Fair Tax invoice layout).' },
      { k: 'docAccent', l: 'Main colour', t: 'text', ph: '#17324c', cls: 'w-sm' },
      { k: 'docAccent2', l: 'Accent colour', t: 'text', ph: '#c1922b', cls: 'w-sm' },
      { k: 'docLogoHasName', l: 'The logo already shows the business name', t: 'checkbox' },
      { k: 'docShowLicence', l: 'Print the trade licence number in the letterhead', t: 'checkbox' },
      { k: 'docNoFootNote', l: 'Hide the “This is a computer-generated …” line', t: 'checkbox' },
      { k: 'docNoWatermark', l: 'No faint logo watermark (Fair Tax invoice layout)', t: 'checkbox' }] });
    return true;
  }
  installSettings();

  global.DocTemplates = { splitTop: splitTop, transform: transform, ftTransform: ftTransform, titleFor: titleFor, enabled: enabled, layoutOf: layoutOf, ftOn: ftOn, installSettings: installSettings,
    _qtyTable: qtyTable, _deprTable: deprTable, _allocTable: allocTable };
})(typeof window !== 'undefined' ? window : this);
