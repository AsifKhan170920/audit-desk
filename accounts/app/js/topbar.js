/* ===================== top bar: account menu =====================
   The single header row (index.html .toolbar) ends in a round avatar. Clicking
   it opens a right-aligned menu:

     Name (bold) + role
     ─────────────
     My Profile · Emails · History · Backup · Dark Mode (switch)
     ─────────────
     Logout (red)

   Every item calls the same App function its old header button did, so no
   behaviour is lost: App.go('profile'), App.openTool('emails'|'history'|'backup'),
   App.toggleTheme(), App.logout(). Emails / History / Backup belong to a
   business, so they are disabled until one is open.

   Closes on outside click, Esc, or after an item runs. Arrow keys move between
   items. The name / role / initial are filled by js/users.js
   (_paintUsersChrome writes #hdUserName, #hdUserRole, #hdAvatar). */
(function (root) {
  'use strict';
  var doc = typeof document !== 'undefined' ? document : null;
  function getApp() { try { return typeof App !== 'undefined' ? App : (root.App || null); } catch (e) { return root.App || null; } }
  function byId(id) { return doc && doc.getElementById ? doc.getElementById(id) : null; }
  function menu() { return byId('tbUserMenu'); }
  function btn() { return byId('tbAvatarBtn'); }
  function isOpen() { var m = menu(); return !!(m && m.classList && !m.classList.contains('hide')); }
  function items() { var m = menu(); return m && m.querySelectorAll ? Array.prototype.slice.call(m.querySelectorAll('button:not([disabled])')) : []; }
  function isDark() { return !!(doc && doc.body && doc.body.classList && doc.body.classList.contains('theme-dark')); }

  var Topbar = {
    /* reflect state (dark mode switch, business-only items) into the menu */
    sync: function () {
      var dark = isDark();
      var d = byId('tbDarkItem');
      if (d) { d.setAttribute('aria-checked', dark ? 'true' : 'false'); if (d.classList) d.classList.toggle('on', dark); }
      var hasBiz = !!(getApp() && getApp().openBiz != null && getApp().curBiz && getApp().curBiz());
      var m = menu();
      if (m && m.querySelectorAll) {
        Array.prototype.forEach.call(m.querySelectorAll('.tb-biz-only'), function (el) {
          el.disabled = !hasBiz;
          el.title = hasBiz ? '' : 'Open a business first';
        });
      }
    },
    open: function () {
      var m = menu(), b = btn(); if (!m) return;
      this.sync();
      m.classList.remove('hide');
      if (b) b.setAttribute('aria-expanded', 'true');
      this._place();
      var first = items()[0]; if (first && first.focus) setTimeout(function () { try { first.focus(); } catch (e) {} }, 0);
    },
    close: function (refocus) {
      var m = menu(), b = btn(); if (!m) return;
      var was = isOpen();
      m.classList.add('hide');
      if (b) b.setAttribute('aria-expanded', 'false');
      if (was && refocus && b && b.focus) b.focus();
    },
    toggle: function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (isOpen()) this.close(); else this.open();
    },
    /* keep the menu on screen: right-aligned under the avatar, clamped to the viewport */
    _place: function () {
      var m = menu(); if (!m || !m.getBoundingClientRect || typeof window === 'undefined') return;
      m.style.right = ''; m.style.left = ''; m.style.top = '';
      var fixed = false; try { fixed = window.getComputedStyle(m).position === 'fixed'; } catch (e) {}
      if (fixed) { var bb = btn() && btn().getBoundingClientRect(); if (bb) m.style.top = Math.round(bb.bottom + 8) + 'px'; return; }
      m.style.right = '0px'; m.style.left = 'auto';
      var r = m.getBoundingClientRect(), vw = window.innerWidth || 0;
      if (r.left < 8) { m.style.right = (r.left - 8) + 'px'; }
      if (vw && r.right > vw - 8) { m.style.right = '0px'; }
    },
    run: function (what) {
      var A = getApp(); this.close(); if (!A) return;
      if (what === 'profile') { A.go('profile'); return; }
      if (what === 'theme') { A.toggleTheme(); this.sync(); return; }
      if (what === 'logout') { A.logout(); return; }
      if (what === 'emails' || what === 'history' || what === 'backup') {
        if (A.openBiz == null || !A.curBiz()) return;
        if (A.view !== 'workspace') { A.wsMode = 'tools'; A.toolView = what; A.navTrail = []; A.editingId = null; A.go('workspace'); return; }
        A.openTool(what);
      }
    },
    _onKey: function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); Topbar.close(true); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        var list = items(); if (!list.length) return;
        var i = list.indexOf(doc.activeElement);
        if (e.key === 'Home') i = 0; else if (e.key === 'End') i = list.length - 1;
        else i = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
        e.preventDefault(); list[i].focus();
      }
    },
    _onDocClick: function (e) {
      if (!isOpen()) return;
      var wrap = byId('tbUser');
      if (wrap && wrap.contains && wrap.contains(e.target)) return;
      Topbar.close();
    },
    install: function () {
      if (!doc || !doc.addEventListener || this._installed) return;
      this._installed = true;
      doc.addEventListener('mousedown', this._onDocClick, true);
      doc.addEventListener('touchstart', this._onDocClick, { capture: true, passive: true });
      doc.addEventListener('keydown', this._onKey, true);
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', function () { if (isOpen()) Topbar._place(); });
      var A = getApp();
      if (A && typeof A.toggleTheme === 'function' && !A.toggleTheme.__tb) {
        var orig = A.toggleTheme;
        A.toggleTheme = function () { var r = orig.apply(this, arguments); try { Topbar.sync(); } catch (e) {} return r; };
        A.toggleTheme.__tb = 1;
      }
      if (A && typeof A.go === 'function' && !A.go.__tb) {
        var og = A.go;
        A.go = function () { Topbar.close(); var r = og.apply(this, arguments); try { Topbar.sync(); } catch (e) {} return r; };
        A.go.__tb = 1;
      }
      /* icons added to the menu after App.init painted the static ones */
      try { if (A && A.paintStaticIcons) A.paintStaticIcons(); } catch (e) {}
      this.sync();
    }
  };
  root.Topbar = Topbar;
  if (doc && doc.readyState === 'loading' && doc.addEventListener) doc.addEventListener('DOMContentLoaded', function () { Topbar.install(); });
  else Topbar.install();
})(typeof window !== 'undefined' ? window : globalThis);
