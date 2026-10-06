/* ===================== Unsaved changes guard =====================
   Opening another page from the sidebar (App.selectSection) while a form has
   unsaved changes asks first: "Leave without saving?". Covers
     - every register form (wsMode 'form'): any typing / change inside #wsMain
       after the form was opened marks it changed; saving or leaving clears it
     - pages that keep their own draft (e.g. Payroll → Run payroll) through
       UnsavedGuard.register(function () { return 'message' | '' })
   Closing / reloading the browser tab while something is unsaved gets the
   browser's own "Leave site?" prompt.
   ================================================================= */
(function (G) {
  'use strict';
  if (typeof App === 'undefined' || G.UnsavedGuard) return;
  var checks = [], formDirty = false, formKey = '';
  function key() { return [App.wsSection, App.wsMode, App.editingId].join('|'); }
  function ask(msg) {
    try { if (G.UIModal && UIModal.confirm) return Promise.resolve(UIModal.confirm(msg, { title: 'Unsaved changes', okText: 'Leave without saving', danger: true })); } catch (e) {}
    try { return Promise.resolve(G.confirm(msg)); } catch (e) { return Promise.resolve(true); }
  }
  var UG = G.UnsavedGuard = {
    register: function (fn) { if (typeof fn === 'function') checks.push(fn); },
    /** the first unsaved-changes message, or '' */
    pending: function () {
      for (var i = 0; i < checks.length; i++) { try { var m = checks[i](); if (m) return m; } catch (e) {} }
      if (formDirty && App.wsMode === 'form' && key() === formKey) return 'This form has changes that are not saved yet. Leave without saving?';
      return '';
    },
    clear: function () { formDirty = false; },
    /** runs go() now, or after the user agrees to drop the unsaved changes */
    confirmLeave: function (go) {
      var m = UG.pending(); if (!m) return go();
      ask(m).then(function (ok) { if (ok) { formDirty = false; UG._leaving = true; try { go(); } finally { UG._leaving = false; } } });
    },
  };
  UG.register(function () { return G.Payroll && typeof Payroll.unsaved === 'function' ? Payroll.unsaved() : ''; });
  /* a form becomes "changed" on the first input inside the workspace */
  try {
    var mark = function (e) { if (App.wsMode !== 'form') return; var m = document.getElementById('wsMain'); if (!m || !m.contains(e.target)) return; if (key() !== formKey) { formKey = key(); } formDirty = true; };
    document.addEventListener('input', mark, true);
    document.addEventListener('change', mark, true);
  } catch (e) {}
  var _rm = App.renderMain;
  App.renderMain = function () { if (key() !== formKey) { formDirty = false; formKey = key(); } return _rm.apply(this, arguments); };
  var _sv = App.saveBiz;
  App.saveBiz = function () { if (App.wsMode === 'form') formDirty = false; return _sv.apply(this, arguments); };
  var _sel = App.selectSection;
  App.selectSection = function () {
    var self = this, args = arguments;
    if (UG._leaving || !UG.pending()) return _sel.apply(self, args);
    UG.confirmLeave(function () { _sel.apply(self, args); });
  };
  try { G.addEventListener('beforeunload', function (e) { if (UG.pending()) { e.preventDefault(); e.returnValue = ''; return ''; } }); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
