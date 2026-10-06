/* ===================== Invoice Designer bridge (Canva-style) ===================== */
(function () {
  var STORAGE_KEY = 'mgr_invoice_designs';
  var INVOICE_DOCS = {
    salesInv: 1, purchInv: 1, salesQuotes: 1, purchQuotes: 1,
    salesOrders: 1, purchOrders: 1, creditNotes: 1, debitNotes: 1, deliveryNotes: 1,
    goodsRec: 1,
  };
  /* purchase-side documents — the party is a supplier, not a customer */
  var PURCHASE_DOCS = ['purchInv', 'purchQuotes', 'purchOrders', 'debitNotes', 'goodsRec'];
  function isPurchaseDoc(key) { return PURCHASE_DOCS.indexOf(key) >= 0; }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeStore(store) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function bizId(b) {
    return b && (b.id != null ? String(b.id) : b.uuid ? String(b.uuid) : b.name ? String(b.name) : 'default');
  }

  window.InvoiceDesigns = {
    isInvoiceDoc: function (key) { return !!INVOICE_DOCS[key]; },
    has: function (b, key) {
      var id = typeof b === 'string' ? b : bizId(b);
      var store = readStore();
      return !!(store[id] && store[id][key]);
    },
    get: function (b, key) {
      var id = typeof b === 'string' ? b : bizId(b);
      var store = readStore();
      return (store[id] && store[id][key]) || null;
    },
    save: function (b, key, design) {
      var id = bizId(b);
      var store = readStore();
      if (!store[id]) store[id] = {};
      store[id][key] = design;
      writeStore(store);
    },
    list: function (b) {
      var id = bizId(b);
      var store = readStore();
      return store[id] ? Object.keys(store[id]) : [];
    },
    duplicate: function (b, fromKey, toKey) {
      var d = this.get(b, fromKey);
      if (!d) return false;
      var copy = JSON.parse(JSON.stringify(d));
      copy.id = 'design_' + Date.now();
      copy.name = (copy.name || 'Design') + ' (Copy)';
      copy.updatedAt = new Date().toISOString();
      this.save(b, toKey, copy);
      return true;
    },
  };

  function mod() {
    var M = window.InvoiceDesignerModule;
    if (!M) return null;
    /* Vite IIFE assigns the module namespace to the global, not the API object directly */
    if (M.mount) return M;
    if (M.default && M.default.mount) return M.default;
    if (M.InvoiceDesignerAPI && M.InvoiceDesignerAPI.mount) return M.InvoiceDesignerAPI;
    if (M.mountInvoiceDesigner) {
      return {
        mount: M.mountInvoiceDesigner,
        unmount: M.unmountInvoiceDesigner,
        createDefaultTemplate: M.createDefaultInvoiceTemplate,
        mapRecordToInvoiceData: M.mapRecordToInvoiceData,
        sampleInvoiceData: M.sampleInvoiceData,
        renderDesignPrintDocument: M.renderDesignPrintDocument,
        renderDesignToHtml: M.renderDesignToHtml,
      };
    }
    return null;
  }

  App.isInvoiceDesignDoc = function (key) {
    return window.InvoiceDesigns && InvoiceDesigns.isInvoiceDoc(key);
  };

  App.invDesignerHtml = function (b, key) {
    var name = App.fmtFormName ? App.fmtFormName(key) : key;
    var cat = App.fmtCat || App.fmtCatOf(key);
    return App.crumbThemes(name) +
      '<div class="info-bar">Design your <b>' + App.esc(name) + '</b> layout visually — drag elements, edit text inline, use placeholders like <code>{{invoice_number}}</code>, then click <b>Save design</b>. Real invoice data fills in automatically when printing.</div>' +
      '<div id="invDesignerHost" class="inv-designer-host"></div>' +
      '<div class="form-actions" style="margin-top:10px"><button class="btn" onclick="App.openFmtCat(\'' + cat + '\')">◀ Back</button></div>';
  };

  App._mountInvoiceDesigner = function (key) {
    var host = document.getElementById('invDesignerHost');
    if (!host) return;
    var b = App.curBiz();
    if (!b) return;
    var M = mod();
    if (!M || !M.mount) {
      host.innerHTML = '<div class="card"><p>Invoice Designer module not loaded. Run <code>npm run build</code> in <code>invoice-designer/</code> and refresh.</p></div>';
      return;
    }

    var existing = InvoiceDesigns.get(b, key);
    var sample = M.sampleInvoiceData ? M.sampleInvoiceData() : {};
    try {
      if (M.mapRecordToInvoiceData) {
        var recs = App.records(b) || [];
        var rec = recs.length ? recs[recs.length - 1] : {};
        var isP = isPurchaseDoc(key);
        sample = M.mapRecordToInvoiceData(b, rec, {
          isPurchase: isP,
          amountInWords: function (n, cur) {
            try { return App.amountInWords(n, cur || b.currency || ''); } catch (e) { return String(n); }
          },
        });
      }
    } catch (e) {}

    M.unmount && M.unmount(host);
    M.mount(host, {
      businessId: bizId(b),
      docKey: key,
      design: existing,
      sampleData: sample,
      onSave: function (design) {
        InvoiceDesigns.save(b, key, design);
        try { App.toast && App.toast('Invoice design saved'); } catch (e) {}
      },
      onExit: function () {
        try { App._restoreNav(App._fedReturn); } catch (e) {
          try { App.openFmtCat(App.fmtCat || App.fmtCatOf(key)); } catch (_) {}
        }
      },
    });
  };

  App._invoiceDesignData = function (b, key, rec) {
    var M = mod();
    if (!M || !M.mapRecordToInvoiceData) return {};
    var isP = isPurchaseDoc(key);
    return M.mapRecordToInvoiceData(b, rec || {}, {
      isPurchase: isP,
      amountInWords: function (n, cur) {
        try { return App.amountInWords(n, cur || (b && b.currency) || ''); } catch (e) { return String(n); }
      },
    });
  };

  App._renderInvoiceDesigned = function (b, key, rec) {
    var design = InvoiceDesigns.get(b, key);
    if (!design) return null;
    var M = mod();
    if (!M || !M.renderDesignToHtml) return null;
    var data = App._invoiceDesignData(b, key, rec);
    return M.renderDesignToHtml(design, data);
  };

  App._printInvoiceDesigned = function (b, key, rec) {
    var design = InvoiceDesigns.get(b, key);
    if (!design) return false;
    var M = mod();
    if (!M || !M.renderDesignPrintDocument) return false;
    var data = App._invoiceDesignData(b, key, rec);
    var html = M.renderDesignPrintDocument(design, data, App.fmtFormName ? App.fmtFormName(key) : key);
    var pr = document.getElementById('printRegion');
    if (!pr) {
      pr = document.createElement('div');
      pr.id = 'printRegion';
      document.body.appendChild(pr);
    }
    var pageHtml = M.renderDesignToHtml ? M.renderDesignToHtml(design, data) : '';
    pr.innerHTML = pageHtml;
    var clean = function () {
      try { pr.innerHTML = ''; } catch (e) {}
      window.removeEventListener('afterprint', clean);
    };
    window.addEventListener('afterprint', clean);
    setTimeout(function () {
      try { window.print(); } catch (e) {}
      setTimeout(clean, 1500);
    }, 80);
    return true;
  };

  /* Override designer mount for invoice document types */
  var _origAdv = App.advDesignerHtml;
  App.advDesignerHtml = function (b, key) {
    if (App.isInvoiceDesignDoc && App.isInvoiceDesignDoc(key)) return App.invDesignerHtml(b, key);
    return _origAdv.call(this, b, key);
  };

  var _origMount = App._mountInlineDesigner;
  App._mountInlineDesigner = function (key) {
    if (App.isInvoiceDesignDoc && App.isInvoiceDesignDoc(key)) {
      setTimeout(function () { App._mountInvoiceDesigner(key); }, 0);
      return;
    }
    return _origMount.call(this, key);
  };

  var _origPrintDoc = App._printDoc;
  App._printDoc = function (b, c, rec) {
    var key = LABEL2KEY && App.wsSection ? LABEL2KEY[App.wsSection] : null;
    if (key && App.isInvoiceDesignDoc && App.isInvoiceDesignDoc(key) && InvoiceDesigns.has(b, key)) {
      if (App._printInvoiceDesigned(b, key, rec)) return;
    }
    return _origPrintDoc.call(this, b, c, rec);
  };

  /* Patch viewHtml to use custom invoice design when available */
  var _origViewHtml = App.viewHtml;
  App.viewHtml = function (b) {
    var c = App.cfg();
    var key = LABEL2KEY && App.wsSection ? LABEL2KEY[App.wsSection] : null;
    if (key && App.isInvoiceDesignDoc && App.isInvoiceDesignDoc(key) && InvoiceDesigns.has(b, key)) {
      var rec = App.records(b).find(function (r) { return r.id === App.editingId; }) || {};
      var inner = App._renderInvoiceDesigned(b, key, rec);
      if (inner) {
        var titleVal = rec.name || rec.reference || rec.code || c.singular;
        var list = App.records(b);
        var idx = list.findIndex(function (r) { return r.id === App.editingId; });
        var total = list.length;
        var pager = total > 1 ? '<div class="view-pager"><button class="pgb" ' + (idx <= 0 ? 'disabled' : '') + ' onclick="App.viewNav(-1)">«</button><button class="pgb" ' + (idx <= 0 ? 'disabled' : '') + ' onclick="App.viewNav(-1)">‹</button><span>' + (idx + 1) + ' / ' + total + '</span><button class="pgb" ' + (idx >= total - 1 ? 'disabled' : '') + ' onclick="App.viewNav(1)">›</button><button class="pgb" ' + (idx >= total - 1 ? 'disabled' : '') + ' onclick="App.viewNav(1)">»</button></div>' : '';
        return App.recCrumb(c.label, titleVal) +
          '<div class="card" style="max-width:920px">' +
          '<div class="view-bar"><span class="view-doc">' + App.esc(c.singular) + '</span>' +
          '<button class="btn btn-sm" onclick="App.editRecord(' + App.editingId + ')">Edit</button>' +
          '<button class="btn btn-sm" onclick="App.cloneRecord()">Clone</button>' +
          '<button class="btn btn-sm" onclick="App.openDesignerFor(\'' + key + '\')" title="Edit invoice design">✎ Design</button>' +
          '<button class="btn btn-sm" onclick="App.printView()">Print</button>' +
          '<button class="btn btn-sm" onclick="App.pdfView()">PDF</button>' + pager + '</div>' +
          '<div class="inv-designed-view" style="overflow:auto;padding:16px;background:#eef0f3">' + inner + '</div>' +
          '<div class="form-actions"><button class="btn btn-primary" onclick="App.editRecord(' + JSON.stringify(App.editingId) + ')">Edit</button><button class="btn" onclick="App.historyBack()||App.backFromRecord()||App.backToList()">Close</button></div></div>';
      }
    }
    return _origViewHtml.call(this, b);
  };
})();
