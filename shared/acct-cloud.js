/* ============================================================
   FAIR TAX PORTAL – Accounts (the accounting software) in the cloud
   Loaded by /accounts/ after shared/cloud.js. Each business is stored on
   its own in Firestore, split into parts (1 MB document limit):

     acct/{bizDoc}            { bid, name, v, parts, size, by, byUid, sid, at, deleted? }
     acct/{bizDoc}/parts/{i}  { t }
     users/{uid}              apps.accounts = true, acctBiz = [bizDoc, …]   (set by the admin)

   - The admin (Google sign-in, ask.asif93@gmail.com) sees every business and
     can add / remove businesses. A client user sees only the businesses ticked
     for them in Users & access, and cannot add or remove businesses.
   - The app keeps working on localStorage['mgr_businesses'] exactly as before;
     every save there is split per business and only the changed businesses are
     sent (one at a time, with a version check so two people never overwrite
     each other silently).
   - The app's own login is replaced by the portal sign-in: a session for the
     signed-in person is written before the app starts.
   - The Windows app "Fair Tax Accounting" (window.ftAccounting) is for clients
     only: the admin account is refused there and uses the website.
   ============================================================ */
(function () {
  'use strict';
  var FT = window.FT, FA = window.FTAcct = {};
  var KEY = 'mgr_businesses', PART = 300000;
  var LOCAL_KEYS = ['mgr_businesses', 'mgr_users', 'mgr_sessions', 'mgr_session', 'mgr_login_fail'];
  var SID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var nativeSet = Storage.prototype.setItem;
  var docs = {};      // bizDoc -> {v, lastSent, pending, timer, inFlight, name}
  var me = null, PORTAL = new URL('../', location.href).href;

  FA.isDesktop = function () { try { return !!(window.ftAccounting && window.ftAccounting.desktop); } catch (e) { return false; } };
  FA.docId = function (id) { return String(id == null ? '' : id).replace(/[^\w-]/g, '_') || 'x'; };
  function ref(d) { return FT.db.collection('acct').doc(d); }
  function isAdmin() { return !!(me && me.role === 'admin'); }
  function withTimeout(p, ms) { return Promise.race([Promise.resolve(p), new Promise(function (r) { setTimeout(function () { r('__timeout__'); }, ms); })]); }

  /* ---------- reading ---------- */
  /** the businesses this person may open: [{doc, name}] */
  FA.list = async function () {
    if (isAdmin()) {
      var s = await FT.db.collection('acct').get();
      return s.docs.filter(function (d) { return !d.data().deleted; }).map(function (d) { return { doc: d.id, name: d.data().name || d.id }; });
    }
    var ids = (me && Array.isArray(me.acctBiz)) ? me.acctBiz : [];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      try { var m = await ref(ids[i]).get(); if (m.exists && !m.data().deleted) out.push({ doc: ids[i], name: m.data().name || ids[i] }); } catch (e) {}
    }
    return out;
  };
  /** admin: every business (name only), for the Users & access ticks */
  FA.allNames = async function () {
    await FT.init();
    var s = await FT.db.collection('acct').get();
    return s.docs.filter(function (d) { return !d.data().deleted; }).map(function (d) { return { doc: d.id, name: d.data().name || d.id }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  };
  FA.pull = async function (doc) {
    var r = ref(doc), meta = await r.get();
    if (!meta.exists) return null;
    var m = meta.data(), parts = await r.collection('parts').get(), chunks = [];
    parts.docs.forEach(function (d) { chunks[+d.id] = d.data().t || ''; });
    var text = chunks.slice(0, m.parts).join('');
    if (text.length !== m.size) throw new Error('The saved data of ' + (m.name || doc) + ' is incomplete – please try again in a moment.');
    docs[doc] = { v: m.v, lastSent: text, name: m.name };
    return text;
  };

  /* ---------- writing ---------- */
  FA.push = async function (doc, text, name, force) {
    var st = docs[doc] = docs[doc] || { v: 0 };
    var r = ref(doc), n = Math.max(1, Math.ceil(text.length / PART));
    var res = await FT.db.runTransaction(async function (tx) {
      var meta = await tx.get(r), cur = meta.exists ? meta.data() : { v: 0, parts: 0 };
      if (!force && (cur.v || 0) !== (st.v || 0)) return { conflict: true, by: cur.by };
      for (var i = 0; i < n; i++) tx.set(r.collection('parts').doc(String(i)), { t: text.slice(i * PART, (i + 1) * PART) });
      for (var j = n; j < (cur.parts || 0); j++) tx.delete(r.collection('parts').doc(String(j)));
      var v = (cur.v || 0) + 1, bid = null; try { bid = JSON.parse(text).id; } catch (e) {}
      tx.set(r, { bid: bid, name: name || cur.name || '', v: v, parts: n, size: text.length, by: (me && me.name) || '', byUid: (me && me.uid) || '', sid: SID,
        at: firebase.firestore.FieldValue.serverTimestamp(), deleted: false });
      return { v: v };
    });
    if (res.conflict) return res;
    st.v = res.v; st.lastSent = text; st.name = name;
    return res;
  };
  function queue(doc, text, name) {
    var st = docs[doc] = docs[doc] || { v: 0 };
    if (text === st.lastSent) return;
    st.pending = text; st.pname = name; FT.badge('Saving…');
    clearTimeout(st.timer); st.timer = setTimeout(function () { flush(doc); }, 1500);
  }
  async function flush(doc, force) {
    var st = docs[doc]; if (!st || st.pending == null || st.inFlight) return;
    var text = st.pending;
    try {
      st.inFlight = true;
      var r = await withTimeout(FA.push(doc, text, st.pname, force), 30000);
      if (r === '__timeout__') throw { code: 'deadline-exceeded', message: 'no answer from the cloud' };
      if (r.conflict) { conflict(doc, r); return; }
      if (st.pending === text) st.pending = null;
      FT.badge('Saved to cloud', 'ok');
    } catch (e) {
      FT.badge('Not saved to cloud – ' + FT.friendlyError(e), 'bad');
      st.timer = setTimeout(function () { flush(doc); }, /permission-denied|unauthenticated/.test((e && e.code) || '') ? 300000 : 15000);
    } finally { st.inFlight = false; if (st.pending != null && st.pending !== text) flush(doc); }
  }
  FA.flushAll = async function () { for (var d in docs) { clearTimeout(docs[d].timer); await flush(d); } };
  FA.pending = function () { return Object.keys(docs).some(function (d) { return docs[d].pending != null; }); };
  function conflict(doc, r) {
    var box = document.createElement('div'); box.className = 'ft-modal';
    box.innerHTML = '<div class="ft-card"><h3>Someone else saved changes</h3><p><b>' + FT.esc(r.by || 'Another user') + '</b> saved <b>' + FT.esc((docs[doc] && docs[doc].pname) || 'this business') +
      '</b> while you were working. Choose what to keep.</p><div class="ft-row"><button class="ft-btn" data-x="reload">Load their latest version</button><button class="ft-btn ft-danger" data-x="mine">Keep my version (replaces theirs)</button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', async function (e) {
      var x = e.target.getAttribute('data-x'); if (!x) return; box.remove();
      if (x === 'mine') await flush(doc, true); else { docs[doc].pending = null; FA.leaving = true; location.reload(); }
    });
  }

  /* every save of the app's businesses: send the ones that changed */
  var known = {};     // bizDoc -> name, the businesses loaded or saved in this session
  function onSave(text) {
    var arr; try { arr = JSON.parse(text); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    var seen = {};
    arr.forEach(function (b) {
      if (!b || b.id == null) return;
      var d = FA.docId(b.id); seen[d] = 1;
      if (!known[d] && !isAdmin()) { FT.badge('Only the admin can add a business – ask Fair Tax', 'bad'); return; }
      known[d] = b.name || d;
      queue(d, JSON.stringify(b), b.name || '');
    });
    /* a business removed in the app (admin only): kept in the cloud, marked deleted */
    if (isAdmin() && arr.length) Object.keys(known).forEach(function (d) {
      if (seen[d]) return; delete known[d];
      ref(d).set({ deleted: true, deletedBy: me.name || '', deletedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(function () {});
    });
  }

  /* ---------- the app's own login replaced by the portal sign-in ---------- */
  function setSession(ids) {
    var uid = 'ft-' + me.uid, now = new Date().toISOString();
    var u = { id: uid, name: me.name || me.id, email: me.email || '', username: me.id, user: me.id, role: isAdmin() ? 'Administrator' : 'Restricted user',
      businesses: ids, mfa: false, created: now, portal: true };
    nativeSet.call(localStorage, 'mgr_users', JSON.stringify([u]));
    nativeSet.call(localStorage, 'mgr_sessions', JSON.stringify([{ id: 'ft', userId: uid, device: FA.isDesktop() ? 'Fair Tax Accounting (Windows)' : 'Fair Tax Portal', created: now, last: now }]));
    nativeSet.call(localStorage, 'mgr_session', JSON.stringify({ sid: 'ft', userId: uid, name: u.name, user: u.username, role: u.role }));
    try { var s = JSON.parse(localStorage.getItem('mgr_settings') || '{}'); s.allowSignup = false; nativeSet.call(localStorage, 'mgr_settings', JSON.stringify(s)); } catch (e) {}
  }
  /** after sign-out nothing of the books stays on this computer (unless a change could not be sent) */
  function clearLocal() { LOCAL_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); }
  FA.signOut = async function () {
    try { await withTimeout(FA.flushAll(), 8000); } catch (e) {}
    if (FA.pending() && !confirm('Some changes could not be saved to the cloud yet. Sign out anyway and lose them?')) return false;
    FA.leaving = true; clearLocal();
    var ok = await FT.signOut(); if (ok === false) { FA.leaving = false; return false; }
    location.href = PORTAL + (FA.isDesktop() ? '?desktop=1&next=accounts' : '');
    return true;
  };

  /* ---------- the loader ---------- */
  FA.open = async function () {
    var msgEl = document.getElementById('ft-msg'); function say(t) { if (msgEl) msgEl.textContent = t; }
    try {
      say('Checking your sign-in…');
      me = await FT.currentUser();
      var back = PORTAL + '?next=accounts' + (FA.isDesktop() ? '&desktop=1' : '');
      if (!me || me.missing || !me.active) { location.replace(back); return; }
      if (FA.isDesktop() && isAdmin()) {
        await FT.signOut(); clearLocal();
        say('The admin account opens Accounts on the website only (asifkhan170920.github.io/audit-desk). In this app, sign in with a client user ID.');
        setTimeout(function () { location.replace(back); }, 4000); return;
      }
      if (!FT.canOpen(me, 'accounts')) { say('You do not have access to Accounts. Ask Fair Tax.'); return; }
      say('Loading your books…');
      var list = await FA.list(), arr = [];
      for (var i = 0; i < list.length; i++) {
        say('Loading ' + list[i].name + ' (' + (i + 1) + ' of ' + list.length + ')…');
        var text = await FA.pull(list[i].doc);
        if (text) { try { var b = JSON.parse(text); arr.push(b); known[list[i].doc] = b.name || list[i].name; } catch (e) {} }
      }
      /* the admin's first visit: books kept so far in this browser go up to the cloud */
      var local = null; try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
      if (isAdmin() && !arr.length && Array.isArray(local) && local.length && !localStorage.getItem('ft-acct-synced')) {
        if (confirm('This browser has ' + local.length + ' business(es) of the accounting software saved (' + local.map(function (b) { return b.name; }).join(', ') + '). Upload them to the cloud so clients can be given access?')) {
          for (var j = 0; j < local.length; j++) { say('Uploading ' + local[j].name + '…'); await FA.push(FA.docId(local[j].id), JSON.stringify(local[j]), local[j].name, true); known[FA.docId(local[j].id)] = local[j].name; }
          arr = local;
        }
      }
      nativeSet.call(localStorage, KEY, JSON.stringify(arr));
      nativeSet.call(localStorage, 'ft-acct-synced', '1');
      setSession(arr.map(function (b) { return b.id; }));
      if (!arr.length && !isAdmin()) { say('No business has been given to your user yet. Ask Fair Tax to tick your business in Users & access.'); return; }
      say('Opening Accounts…');
      var html = await fetch('app/index.html', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Could not load the Accounts program (' + r.status + ')'); return r.text(); });
      html = html.replace(/<head([^>]*)>/i, '<head$1><base href="app/">');
      Storage.prototype.setItem = function (k, v) { nativeSet.call(this, k, v); if (this === localStorage && k === KEY && !FA.leaving) onSave(String(v)); };
      listen();
      document.open(); document.write(html); document.close();
      var done = function () {
        window.addEventListener('beforeunload', function (e) { if (FA.leaving) return; if (FA.pending()) { e.preventDefault(); e.returnValue = ''; } });
        FT.bar(me); fixBar();
        try { if (window.App) { App.logout = function () { FA.signOut(); }; } } catch (e) {}
      };
      if (document.readyState === 'complete') setTimeout(done, 0); else window.addEventListener('load', done);
    } catch (e) { say(FT.friendlyError(e)); }
  };
  /* the small portal bar: links back to the portal (not to the app folder), sign-out through Accounts */
  function fixBar() {
    var a = document.querySelector('.ft-bar a'); if (a) { a.href = PORTAL; if (!isAdmin()) a.remove(); }
    var out = document.getElementById('ft-out'); if (out) out.onclick = function () { this.textContent = 'Signing out…'; FA.signOut(); };
    var rf = document.getElementById('ft-refresh'); if (rf) rf.onclick = async function () { this.disabled = true; FT.badge('Saving, then refreshing…'); await withTimeout(FA.flushAll(), 8000); FA.leaving = true; location.replace(PORTAL + 'accounts/?r=' + Date.now()); };
    var q = document.getElementById('ft-quit'); if (q) q.remove();
    var _pend = FT.pendingSave; FT.pendingSave = function () { return FA.pending() || _pend(); };
  }
  /* someone else saved one of the open businesses -> offer to reload */
  function listen() {
    Object.keys(known).forEach(function (d) {
      ref(d).onSnapshot(function (s) {
        if (!s.exists) return; var m = s.data(), st = docs[d] || {};
        if (m.v > (st.v || 0) && (m.byUid !== me.uid || (m.sid && m.sid !== SID))) FT.badge('Updated by ' + (m.by || 'another user') + ' – click to reload', 'reload');
      }, function () {});
    });
  }
})();
