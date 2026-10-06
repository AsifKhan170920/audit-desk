/* ===================== app modals =====================
   window.UIModal replaces the browser's alert() / confirm() / prompt() with
   in-app dialogs that follow the theme (light / dark) and work on phones.

     UIModal.confirm(text, opts)      -> Promise<boolean>
     UIModal.alert(text, opts)        -> Promise<void>
     UIModal.prompt(text, def, opts)  -> Promise<string|null>   (null = cancelled)
     UIModal.toast(text)              -> short non-blocking notice
     UIModal.gate(text, rerun, opts)  -> boolean (sync), for legacy `if(!confirm(x)) return;` code:
         returns false and opens the modal; on OK it calls rerun() once, during which
         gate(text) returns true so the same code path runs through.
     UIModal.promptGate(text, def, rerun) -> string|null (sync), the prompt twin of gate():
         returns null and asks; on OK reruns, and the answer is returned once.

   opts: {title, okText | ok, cancelText | cancel, danger:true}. Enter confirms,
   Esc cancels, a click on the backdrop cancels. Dialogs stack: the newest one
   owns the keyboard.

   window.alert is routed here too, so no native browser dialog is left in the app.

   Outside a browser (the Node test harness has no real DOM) every call resolves
   immediately: confirm -> true, prompt -> default, so code paths still run. */
(function (root) {
  'use strict';
  if (root.UIModal && root.UIModal.__v) return;

  var nativeAlert = root.alert;
  var pass = null;          // text currently allowed through by gate()
  var ppass = null;         // answer handed back by promptGate() on its rerun
  var stack = [];           // open dialogs, newest last

  function doc() { return root.document; }
  function hasDom() {
    var d = doc();
    return !!(d && typeof d.createElement === 'function' && typeof d.addEventListener === 'function' &&
      d.body && typeof d.body.appendChild === 'function');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hasCls(el, c) { return !!(el && el.classList && el.classList.contains && el.classList.contains(c)); }

  function open(kind, text, opts, def) {
    opts = opts || {};
    if (!hasDom()) {
      return Promise.resolve(kind === 'confirm' ? true : (kind === 'prompt' ? (def == null ? '' : String(def)) : undefined));
    }
    var d = doc();
    return new Promise(function (resolve) {
      var ov = d.createElement('div');
      ov.className = 'uim-ov ui-modal-ov';
      if (ov.setAttribute) ov.setAttribute('role', 'presentation');
      if (ov.style) ov.style.zIndex = String(1300 + stack.length);
      var title = opts.title || (kind === 'confirm' ? 'Please confirm' : (kind === 'prompt' ? 'Enter a value' : 'Notice'));
      var okText = opts.okText || opts.ok || 'OK';
      var cancelText = opts.cancelText || opts.cancel || 'Cancel';
      ov.innerHTML =
        '<div class="uim ui-modal" role="' + (kind === 'alert' ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="uimT' + stack.length + '">' +
          '<div class="uim-h" id="uimT' + stack.length + '">' + esc(title) + '</div>' +
          '<div class="uim-b"><div class="ui-modal-text">' + esc(text).replace(/\n/g, '<br>') + '</div>' +
            (kind === 'prompt' ? '<input class="uim-in ui-modal-in" type="text" value="' + esc(def == null ? '' : def) + '">' : '') +
          '</div>' +
          '<div class="uim-f">' +
            (kind === 'alert' ? '' : '<button type="button" class="btn uim-cancel ui-modal-cancel">' + esc(cancelText) + '</button>') +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + ' uim-ok ui-modal-ok">' + esc(okText) + '</button>' +
          '</div>' +
        '</div>';
      var done = false, prevFocus = d.activeElement;
      var cancelVal = function () { return kind === 'confirm' ? false : (kind === 'prompt' ? null : undefined); };
      var okVal = function () {
        if (kind === 'confirm') return true;
        if (kind === 'prompt') { var i = ov.querySelector('.ui-modal-in'); return i ? i.value : ''; }
        return undefined;
      };
      var onKey = function (e) {
        if (stack[stack.length - 1] !== ov) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelVal()); }
        else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
          /* Enter on the Cancel button means Cancel */
          if (hasCls(e.target, 'uim-cancel')) return;
          e.preventDefault(); e.stopPropagation(); close(okVal());
        }
        else if (e.key === 'Tab' && ov.querySelectorAll) { /* keep focus inside the dialog */
          var f = ov.querySelectorAll('button,input'); if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      function close(v) {
        if (done) return; done = true;
        try { if (d.removeEventListener) d.removeEventListener('keydown', onKey, true); } catch (e) {}
        try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
        var at = stack.indexOf(ov); if (at >= 0) stack.splice(at, 1);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
        resolve(v);
      }
      ov._uimClose = function () { close(cancelVal()); };
      if (ov.addEventListener) ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(cancelVal()); });
      ov.querySelector('.ui-modal-ok').onclick = function () { close(okVal()); };
      var cb = ov.querySelector('.ui-modal-cancel'); if (cb) cb.onclick = function () { close(cancelVal()); };
      if (d.addEventListener) d.addEventListener('keydown', onKey, true);
      d.body.appendChild(ov); stack.push(ov);
      setTimeout(function () {
        try {
          var inp = ov.querySelector('.ui-modal-in');
          if (kind === 'prompt' && inp) { inp.focus(); if (inp.select) inp.select(); }
          else { var t = (kind === 'confirm' && opts.danger) ? ov.querySelector('.ui-modal-cancel') : ov.querySelector('.ui-modal-ok'); if (t && t.focus) t.focus(); }
        } catch (e) {}
      }, 0);
    });
  }

  var toastTimer = 0;
  function toast(text) {
    if (!hasDom()) return;
    var d = doc();
    var t = d.getElementById && d.getElementById('uimToast');
    if (!t) { t = d.createElement('div'); t.id = 'uimToast'; t.className = 'uim-toast'; if (t.setAttribute) t.setAttribute('role', 'status'); d.body.appendChild(t); }
    t.textContent = String(text == null ? '' : text);
    if (t.classList) t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (t.classList) t.classList.remove('on'); }, 2600);
  }

  var UIModal = {
    __v: 2,
    confirm: function (text, opts) { return open('confirm', text, opts); },
    alert: function (text, opts) { return open('alert', text, opts); },
    prompt: function (text, def, opts) { return open('prompt', text, opts, def); },
    toast: toast,
    gate: function (text, rerun, opts) {
      if (pass !== null && pass === String(text)) { pass = null; return true; }
      opts = opts || {}; if (opts.danger == null && /\bdelete|remove|undo|reset|discard/i.test(String(text))) opts.danger = true;
      UIModal.confirm(text, opts).then(function (ok) {
        if (!ok || typeof rerun !== 'function') return;
        pass = String(text); try { rerun(); } finally { pass = null; }
      });
      return false;
    },
    promptGate: function (text, def, rerun) {
      if (ppass !== null) { var v = ppass; ppass = null; return v; }
      UIModal.prompt(text, def).then(function (v) {
        if (v == null || typeof rerun !== 'function') return;
        ppass = String(v); try { rerun(); } finally { ppass = null; }
      });
      return null;
    },
    /* closes the newest dialog as cancelled */
    close: function () { var ov = stack[stack.length - 1]; if (ov && ov._uimClose) ov._uimClose(); },
    isOpen: function () { return stack.length > 0; },
    _nativeAlert: nativeAlert
  };
  root.UIModal = UIModal;
  /* every remaining alert(...) in the app goes to the modal (non-blocking; callers return right after) */
  if (hasDom()) root.alert = function (m) { UIModal.alert(m); };
})(typeof window !== 'undefined' ? window : globalThis);
