/* ===================== Customisation: per-business custom modules =====================
   One codebase, many clients. A "custom module" is a set of extra sidebar tabs
   built for one client's needs (e.g. Trips and Diesel for a transport company).
   Every module ships in the same build but is OFF for every business until an
   administrator switches it on in Settings -> Customisation. Only that business
   then sees the module's tabs; all other businesses are unaffected.

   State lives on the business:  b.customModules = { <moduleId>: true, ... }
   (older businesses that had b.features.gill === true are read as Trips + Diesel on).

   What this file does for every registered module:
     - Settings -> Customisation page (admin only): one card per module with an
       Enable switch for the open business and a link to the module's settings
     - sidebar: the enabled tabs, under the module's group label (e.g. "Transport")
     - routing: App.selectSection(label) opens the tab; renderMain calls tab.render
     - permissions: enabled tabs are listed in the User Permissions editor
       (js/users.js) and enforced with the usual View / Create / Update / Delete
       levels (App.permLevel(b, label)); no access -> hidden + "no access" card
     - #hash reload: a reload on a custom tab (#b=..&s=Trips&m=section) reopens it
       once the module file has registered (module files load after the hash restore)

   ---------------------------------------------------------------------------------
   HOW TO ADD A NEW CUSTOM TAB (for a client requirement)
   ---------------------------------------------------------------------------------
   1. Create js/<client>-<thing>.js and add it to index.html AFTER js/custom-modules.js
      (next to js/gill-trips.js). Keep its data on the business outside b.records,
      e.g. b.myThing = {...}, so registers, ledgers and reports never see it.
   2. Register it:

        CustomModules.register({
          id: 'loadsheet',                       // unique, stored in b.customModules
          name: 'Load sheets',                   // shown in Settings -> Customisation
          description: 'Daily load sheets per vehicle.',
          group: 'Transport',                    // sidebar group (shared groups merge)
          tabs: [{
            label: 'Load Sheets',                // sidebar label = permission name
            icon: 'truck',                       // ICO name, or raw <path …/> markup
            render: function (b, ctx) {          // HTML for #wsMain
              // ctx.level: 1 View, 2 +Create, 3 +Update, 4 +Delete (4 for admins)
              return App.crumb('Load Sheets') + '<div class="card">…</div>';
            },
            after: function (b) {}               // optional: runs once the HTML is in the page
          }],
          settings: { key: 'loadsheet', title: 'Load sheet options' }   // optional:
          //   App.set_loadsheet = function (b) { return '…'; }  renders that page
        });

   3. Guard every write with App.guardWrite(b, need) (2 create, 3 update, 4 delete)
      and honour ctx.level when drawing buttons. That's it: the Customisation page,
      sidebar, permissions and #hash reload pick the module up automatically.
   ===================================================================================== */
(function (G) {
  'use strict';
  if (typeof App === 'undefined' || G.CustomModules) return;

  var defs = [];
  var hasDom = function () { return typeof document !== 'undefined' && document && document.body && document.body.nodeType === 1; };
  var byId = function (id) { try { return document.getElementById(id); } catch (e) { return null; } };
  function esc(s) { return App.esc(s == null ? '' : s); }
  function sameId(a, b) { return String(a) === String(b); }
  function curB() { try { return App.openBiz != null ? App.curBiz() : null; } catch (e) { return null; } }
  function toast(m) { try { if (G.UIModal) UIModal.toast(m); } catch (e) {} }
  function lvl(b, label) { try { return typeof App.permLevel === 'function' ? App.permLevel(b, label) : 4; } catch (e) { return 4; } }
  /** Administrators (or no signed-in user at all, as in a fresh install) manage customisations. */
  function isAdmin() {
    try {
      if (typeof App.currentUser !== 'function') return true;
      var u = App.currentUser(); if (!u) return true;
      return typeof App.isAdminUser === 'function' ? App.isAdminUser(u) : u.role === 'Administrator';
    } catch (e) { return false; }
  }
  function svg(paths, size, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" width="' + (size || 18) + '" height="' + (size || 18) +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  function iconHtml(icon, size, cls) {
    if (typeof icon === 'function') return icon(size, cls);
    if (icon && /^\s*</.test(icon)) return svg(icon, size, cls);
    return G.ICO ? ICO.get(icon || 'box', size, cls) : '';
  }
  var SLIDERS = '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/><path d="M4 12h3"/><path d="M11 12h9"/><circle cx="9" cy="12" r="2"/><path d="M4 18h11"/><path d="M19 18h1"/><circle cx="17" cy="18" r="2"/>';

  /* ------------------------------------------------------------------ registry + state */
  function getDef(id) { return defs.find(function (d) { return d.id === id; }) || null; }
  /** Effective {id:true|false} for b, with the old b.features flags folded in (read only). */
  function stateOf(b) {
    var out = {}, cm = b && b.customModules && typeof b.customModules === 'object' ? b.customModules : {};
    Object.keys(cm).forEach(function (k) { out[k] = !!cm[k]; });
    defs.forEach(function (d) {
      if (d.id in out) return;
      var f = d.legacyFeature;
      if (f && b && b.features && b.features[f] === true) out[d.id] = true;
    });
    /* def.autoWith: ['a','b'] — on while any of those is on, until switched off by hand */
    defs.forEach(function (d) { if (!(d.id in cm) && Array.isArray(d.autoWith) && d.autoWith.some(function (x) { return out[x]; })) out[d.id] = true; });
    return out;
  }
  function allTabs() {
    var out = [];
    defs.forEach(function (d) { d.tabs.forEach(function (t) { out.push(Object.assign({}, t, { module: d, group: t.group || d.group || 'Custom' })); }); });
    return out;
  }

  var CM = G.CustomModules = {
    /** Adds a module (see the header). Re-registering an id replaces it. */
    register: function (def) {
      if (!def || !def.id || !Array.isArray(def.tabs)) throw new Error('CustomModules.register: id and tabs are required');
      def = Object.assign({ name: def.id, description: '', group: 'Custom' }, def);
      def.tabs = def.tabs.map(function (t) { return Object.assign({}, t); });
      var i = defs.findIndex(function (d) { return d.id === def.id; });
      if (i >= 0) defs[i] = def; else defs.push(def);
      CM._afterRegister(def);
      return def;
    },
    list: function () { return defs.slice(); },
    get: getDef,
    isOn: function (b, id) { return !!(b && getDef(id) && stateOf(b)[id]); },
    /** Switches a module on/off for b and saves it (data the module keeps is never deleted). */
    setOn: function (b, id, on) {
      if (!b || !getDef(id)) return false;
      var st = stateOf(b), had = (b.customModules && typeof b.customModules === 'object') ? b.customModules : {};
      defs.forEach(function (d) { if (d.autoWith && d.id !== id && !(d.id in had)) delete st[d.id]; });   // keep following its modules
      st[id] = !!on;
      b.customModules = st;
      /* the old flags are now folded into b.customModules */
      defs.forEach(function (d) { if (d.legacyFeature && b.features && d.legacyFeature in b.features) delete b.features[d.legacyFeature]; });
      var d = getDef(id); if (on && typeof d.onEnable === 'function') { try { d.onEnable(b); } catch (e) {} }
      App.saveBiz(b);
      return true;
    },
    /** Tabs of the modules switched on for b (permissions not applied). */
    tabsFor: function (b) { if (!b) return []; var st = stateOf(b); return allTabs().filter(function (t) { return st[t.module.id]; }); },
    /** The enabled tab with this sidebar label, or null. */
    tabFor: function (b, label) { return CM.tabsFor(b).find(function (t) { return t.label === label; }) || null; },
    /** Any registered tab with this label (enabled or not). */
    anyTab: function (label) { return allTabs().find(function (t) { return t.label === label; }) || null; },
    isAdmin: isAdmin,
    iconHtml: iconHtml,
  };

  /* ------------------------------------------------------------------ sidebar */
  var _side = App.renderSidebar;
  App.renderSidebar = function (b) {
    var tabs = (b && typeof SIDEBAR !== 'undefined') ? CM.tabsFor(b) : [];
    if (!tabs.length) return _side.apply(this, arguments);
    var addedS = [], swapped = [], inserted = [];
    tabs.forEach(function (t) { if (!SIDEBAR.some(function (x) { return x[1] === t.label; })) { var r = ['', t.label, null]; SIDEBAR.push(r); addedS.push(r); } });
    if (typeof SIDEBAR_GROUPS !== 'undefined') {
      var byGroup = {}, order = [];
      tabs.forEach(function (t) { if (!byGroup[t.group]) { byGroup[t.group] = []; order.push(t.group); } byGroup[t.group].push(t.label); });
      var after = SIDEBAR_GROUPS.findIndex(function (g) { return g[0] === 'Purchases'; });
      order.forEach(function (name) {
        var gi = SIDEBAR_GROUPS.findIndex(function (g) { return g[0] === name; });
        if (gi >= 0) { var old = SIDEBAR_GROUPS[gi]; swapped.push([gi, old]); SIDEBAR_GROUPS[gi] = [old[0], old[1].concat(byGroup[name].filter(function (l) { return old[1].indexOf(l) < 0; }))]; return; }
        var at = after < 0 ? SIDEBAR_GROUPS.length : after + 1 + inserted.length;
        var row = [name, byGroup[name]]; SIDEBAR_GROUPS.splice(at, 0, row); inserted.push(row);
      });
    }
    try { return _side.apply(this, arguments); }
    finally {
      addedS.forEach(function (r) { var i = SIDEBAR.indexOf(r); if (i >= 0) SIDEBAR.splice(i, 1); });
      if (typeof SIDEBAR_GROUPS !== 'undefined') {
        inserted.forEach(function (r) { var i = SIDEBAR_GROUPS.indexOf(r); if (i >= 0) SIDEBAR_GROUPS.splice(i, 1); });
        swapped.forEach(function (s) { SIDEBAR_GROUPS[s[0]] = s[1]; });
      }
    }
  };
  if (G.ICO && typeof ICO.forSection === 'function') {
    var _fs = ICO.forSection, _fset = ICO.forSetting;
    ICO.forSection = function (label, size, cls) { var t = CM.anyTab(label); return t ? iconHtml(t.icon, size, cls) : _fs.apply(this, arguments); };
    ICO.forSetting = function (key, size, cls) { return key === 'customisation' ? svg(SLIDERS, size, cls) : _fset.apply(this, arguments); };
  }

  /* ------------------------------------------------------------------ main area */
  function noteCard(label, msg) {
    return App.crumb(label) + '<div class="card perm-denied"><span class="perm-denied-ico">' + (G.ICO ? ICO.get('alert', 20) : '') + '</span><div>' + esc(msg) + '</div></div>';
  }
  var _rm = App.renderMain;
  App.renderMain = function (b) {
    var bb = b || (this.openBiz != null ? this.curBiz() : null);
    if (this.view === 'workspace' && this.wsMode === 'section' && bb && CM.anyTab(this.wsSection)) {
      var m = byId('wsMain'), label = this.wsSection, tab = CM.tabFor(bb, label), L = tab ? lvl(bb, label) : 0, html;
      if (!tab) html = noteCard(label, label + ' is not switched on for this business. An administrator can turn it on in Settings → Customisation.');
      else if (L < 1) html = noteCard(label, 'You do not have access to ' + label + '. Ask an administrator to change your permissions.');
      else {
        try { html = tab.render(bb, { level: L, readOnly: L < 2, tab: tab }); }
        catch (e) { try { console.error('custom tab', label, e); } catch (_) {} html = noteCard(label, 'This page could not be drawn: ' + ((e && e.message) || e)); }
      }
      if (m) {
        m.innerHTML = html;
        if (m.classList) { m.classList.toggle('perm-nocreate', L < 2); m.classList.toggle('perm-noedit', L < 3); m.classList.toggle('perm-nodelete', L < 4); }
      }
      if (tab && L >= 1 && typeof tab.after === 'function') { try { tab.after(bb); } catch (e) {} }
      if (hasDom()) { try { var a = document.querySelector('#sidebar .side-item.active'); if (!a || a.getAttribute('data-side') !== label) App.renderSidebar(bb); } catch (e) {} }
      return;
    }
    return _rm.apply(this, arguments);
  };

  /* ------------------------------------------------------------------ Settings -> Customisation */
  var _tiles = App.setTiles;
  App.setTiles = function () {
    var t = _tiles.apply(this, arguments) || [];
    if (!isAdmin() || t.some(function (x) { return x[2] === 'customisation'; })) return t;
    var row = ['puzzle', 'Customisation', 'customisation', 'Client-specific tabs (e.g. Trips, Diesel) for this business only', 1, 1];
    var at = t.findIndex(function (x) { return x[4] === 1 && String(x[1]).toLowerCase() > 'customisation'; });
    if (at < 0) { at = 0; t.forEach(function (x, i) { if (x[4] === 1) at = i + 1; }); }
    t = t.slice(); t.splice(at, 0, row);
    return t;
  };
  var _openSetting = App.openSetting;
  App.openSetting = function (key) {
    if (key === 'customisation' && !isAdmin()) { try { (G.alert || function () {})('Only administrators can change Customisation.'); } catch (e) {} return; }
    return _openSetting.apply(this, arguments);
  };
  function moduleCard(b, d, st) {
    var on = !!st[d.id], id = esc(d.id);
    var chips = d.tabs.map(function (t) { return '<span class="cm-chip">' + iconHtml(t.icon, 14) + esc(t.label) + '</span>'; }).join('');
    var setLink = d.settings && on ? '<button type="button" class="btn btn-xs" onclick="App.openSetting(\'' + esc(d.settings.key) + '\')">' + esc(d.settings.title || 'Settings') + ' ›</button>' : '';
    return '<div class="cm-card' + (on ? ' on' : '') + '" data-cm="' + id + '">' +
      '<label class="cm-switch" title="' + (on ? 'Switch off' : 'Switch on') + ' for this business"><input type="checkbox" id="cm_on_' + id + '"' + (on ? ' checked' : '') +
        ' onchange="CustomModules.toggle(\'' + id + '\',this.checked)" aria-label="Enable ' + esc(d.name) + ' for this business"><span class="cm-knob"></span></label>' +
      '<div class="cm-body"><div class="cm-name">' + esc(d.name) + (on ? '<span class="cm-state">On</span>' : '') + '</div>' +
        (d.description ? '<div class="cm-desc">' + esc(d.description) + '</div>' : '') +
        '<div class="cm-tabs"><span class="cm-tabs-l">Adds to the sidebar' + (d.group ? ' under <b>' + esc(d.group) + '</b>' : '') + ':</span>' + chips + '</div>' +
        (setLink ? '<div class="cm-actions">' + setLink + '</div>' : '') + '</div></div>';
  }
  App.set_customisation = function (b) {
    if (!isAdmin()) return noteCard('Settings', 'Only administrators can change Customisation.');
    var st = stateOf(b);
    var cards = defs.length ? defs.map(function (d) { return moduleCard(b, d, st); }).join('') : '<div class="reg-empty">No custom modules are installed in this build.</div>';
    return App.crumb('Settings', 'Customisation') +
      '<div class="card cm-page"><h2>Customisation</h2>' +
      '<div class="info-bar"><b>Only this business (' + esc(b.name || '') + ') will see these tabs.</b> Custom tabs are built for particular clients; ' +
        'switching one on here adds it to the sidebar of this business only — other businesses do not see it. Switching it off hides the tab but keeps its entries. ' +
        'Restricted users also need the tab ticked in Settings → User Permissions.</div>' +
      '<div class="cm-list">' + cards + '</div>' +
      '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>';
  };
  /** The Enable switch on the Customisation page. */
  CM.toggle = function (id, on) {
    var b = curB(); if (!b) return;
    if (!isAdmin()) { toast('Only administrators can change Customisation'); return; }
    var d = getDef(id); if (!d) return;
    CM.setOn(b, id, on);
    var nb = App.curBiz(), m = byId('wsMain'), top = m ? m.scrollTop : 0;
    try { App.renderSidebar(nb); } catch (e) {}
    try { App.renderMain(nb); } catch (e) {}
    try { if (m && top) m.scrollTop = top; } catch (e) {}                      // stay at the card that was switched
    var names = d.tabs.map(function (t) { return t.label; }).join(', ');
    toast(on ? names + ' switched on — see ' + (d.group || 'the sidebar') : names + ' switched off (entries are kept)');
  };

  /* ------------------------------------------------------------------ #hash reload onto a custom tab */
  /* js/ledger-nav.js restores #b=..&s=..&m=.. when the app starts, but custom tabs are
     registered by files that load after it, so it cannot recognise them. Keep the hash
     as loaded and open the tab as soon as both the business and the module are ready. */
  var pending = null;
  try {
    var h = String((G.location && G.location.hash) || '').replace(/^#\/?/, ''), o = {};
    h.split('&').forEach(function (p) { if (!p) return; var i = p.indexOf('='), k = i < 0 ? p : p.slice(0, i), v = i < 0 ? '' : p.slice(i + 1); try { o[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { o[k] = v; } });
    if (o.b && o.s && (!o.m || o.m === 'section')) pending = { b: o.b, s: o.s };
  } catch (e) {}
  var allLoaded = false;
  function tabByToken(s) {
    var k = String(s || '').toLowerCase();
    return allTabs().find(function (t) { return t.label.toLowerCase() === k || String(t.id || '').toLowerCase() === k || (t.module.tabs.length === 1 && t.module.id.toLowerCase() === k); }) || null;
  }
  CM._tryRoute = function () {
    if (!pending) return false;
    if (App.view !== 'workspace' || App.openBiz == null) return false;          // not signed in / no business yet: wait
    if (!sameId(App.openBiz, pending.b)) { pending = null; return false; }
    var t = tabByToken(pending.s);
    if (!t) { if (allLoaded) pending = null; return false; }                   // its module may not have loaded yet
    pending = null;
    var b = App.curBiz(); if (!b || !CM.isOn(b, t.module.id) || lvl(b, t.label) < 1) return false;
    if (App.wsSection === t.label && App.wsMode === 'section') { App.renderWorkspace(); return true; }
    App.selectSection(t.label);
    return true;
  };
  CM._pending = function () { return pending; };
  var _ob = App.openBusiness;
  if (typeof _ob === 'function') App.openBusiness = function () { var r = _ob.apply(this, arguments); try { CM._tryRoute(); } catch (e) {} return r; };
  var _enter = App.enterApp;
  if (typeof _enter === 'function') App.enterApp = function () { var r = _enter.apply(this, arguments); try { CM._tryRoute(); } catch (e) {} return r; };
  /** index.html calls this after the last module file. */
  CM.ready = function () { allLoaded = true; try { CM._tryRoute(); } catch (e) {} };

  /** A module registered after the workspace was drawn: repaint the sidebar and its open tab. */
  CM._afterRegister = function (def) {
    try {
      if (CM._tryRoute()) return;
      if (!hasDom() || App.view !== 'workspace') return;
      var b = curB(); if (!b || !CM.isOn(b, def.id)) return;
      App.renderSidebar(b);
      if (App.wsMode === 'section' && def.tabs.some(function (t) { return t.label === App.wsSection; })) App.renderMain(b);
    } catch (e) {}
  };
})(typeof window !== 'undefined' ? window : globalThis);
