/* ============================================================
   FAIR TAX PORTAL – sign-in, users & access, shared cloud data
   Firebase Authentication (user ID + password) and Cloud Firestore.
   Loaded by the dashboard and by the CRM / Audit Desk loader pages.
   Everything lives on window.FT so it never clashes with the apps.
   ============================================================ */
(function () {
  'use strict';
  var FT = window.FT = window.FT || {};

  // ---- filled in from the Firebase project settings ----
  FT.config = {
    apiKey: 'AIzaSyCi99HrNPxzxTm7G_plNo0Phn2XQnXyNWk',
    authDomain: 'fair-tax-audit-desk.firebaseapp.com',
    projectId: 'fair-tax-audit-desk',
    storageBucket: 'fair-tax-audit-desk.firebasestorage.app',
    messagingSenderId: '160519324912',
    appId: '1:160519324912:web:717c64ae8e45c4e6efee35'
  };
  FT.SDK = 'https://www.gstatic.com/firebasejs/11.10.0/';
  FT.USER_DOMAIN = 'users.fairtax-portal.app';     // user IDs without "@" become <id>@this-domain
  FT.OWNER_EMAIL = 'ask.asif93@gmail.com';           // the only admin – signs in with this Google account
  FT.ADMIN_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';   // lets the admin create staff accounts (public sign-up stays closed)
  FT.APPS = {
    audit: {name: 'Audit Desk', key: 'fairtax-audit-desk-v1'},
    crm: {name: 'CRM', key: 'fairtax_crm_v1'}
  };
  var PART = 300000;                                // characters per stored part (Firestore limit is 1 MB per document)

  /* ---------- loading the Firebase SDK ---------- */
  function script(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Could not load ' + src.split('/').pop() + ' – check the internet connection')); };
      document.head.appendChild(s);
    });
  }
  FT.ready = null;
  FT.init = function () {
    if (FT.ready) return FT.ready;
    FT.ready = (async function () {
      if (!FT.config.apiKey) throw new Error('The portal is not connected to Firebase yet.');
      if (!window.firebase || !firebase.auth) {
        await script(FT.SDK + 'firebase-app-compat.js');
        await script(FT.SDK + 'firebase-auth-compat.js');
        await script(FT.SDK + 'firebase-firestore-compat.js');
      }
      if (!firebase.apps.length) firebase.initializeApp(FT.config);
      FT.auth = firebase.auth();
      FT.db = firebase.firestore();
      return FT;
    })();
    return FT.ready;
  };

  /* ---------- users ---------- */
  FT.emailFor = function (id) {
    id = String(id || '').trim().toLowerCase();
    return id.indexOf('@') > 0 ? id : id.replace(/[^a-z0-9._-]/g, '') + '@' + FT.USER_DOMAIN;
  };
  FT.idFromEmail = function (email) {
    email = String(email || '');
    return email.endsWith('@' + FT.USER_DOMAIN) ? email.slice(0, -FT.USER_DOMAIN.length - 1) : email;
  };
  FT.friendlyError = function (e) {
    var c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'User ID or password is not correct.';
    if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/email-already-in-use/.test(c)) return 'This user ID is already taken.';
    if (/weak-password/.test(c)) return 'The password must be at least 6 characters.';
    if (/invalid-email/.test(c)) return 'The user ID can use letters, numbers, dot, dash or underscore.';
    if (/network-request-failed|unavailable/.test(c)) return 'No internet connection to the portal.';
    if (/permission-denied/.test(c)) return 'You do not have access to this.';
    if (/requires-recent-login/.test(c)) return 'Please sign out and sign in again, then retry.';
    return (e && e.message) || String(e);
  };
  // current signed-in user with profile {uid, id, name, role, apps, active}
  FT.me = null;
  FT.isOwner = function (u) {
    return !!(u && String(u.email || '').toLowerCase() === FT.OWNER_EMAIL && u.emailVerified !== false &&
      (u.providerData || []).some(function (p) { return p && p.providerId === 'google.com'; }));
  };
  FT.currentUser = function () {
    return FT.init().then(function () {
      return new Promise(function (res) {
        var off = FT.auth.onAuthStateChanged(async function (u) {
          off();
          if (!u) return res(null);
          if (FT.isOwner(u)) {
            FT.me = {uid: u.uid, email: u.email, id: u.email, name: u.displayName || 'Admin', role: 'admin', apps: {audit: true, crm: true}, active: true, owner: true, expertise: []};
            try { var own = await FT.db.collection('users').doc(u.uid).get(); if (own.exists) { var od = own.data(); FT.me.expertise = od.expertise || []; if (od.name) FT.me.name = od.name; } } catch (e) {}
            return res(FT.me);
          }
          // staff sign in with user ID + password only
          var viaPassword = (u.providerData || []).some(function (p) { return p && p.providerId === 'password'; });
          if (!viaPassword) return res({uid: u.uid, email: u.email, missing: true, notAdmin: true});
          try {
            var snap = await FT.db.collection('users').doc(u.uid).get();
            if (!snap.exists) return res({uid: u.uid, email: u.email, missing: true});
            FT.me = Object.assign({uid: u.uid, email: u.email}, snap.data(), {role: 'staff'});
            res(FT.me);
          } catch (e) { res({uid: u.uid, email: u.email, error: e}); }
        });
      });
    });
  };
  FT.canOpen = function (me, app) { return !!(me && me.active && (me.role === 'admin' || (me.apps && me.apps[app]))); };
  FT.signIn = async function (id, password) {
    await FT.init();
    if (FT.emailFor(id) === FT.OWNER_EMAIL) throw new Error('The admin signs in with the “Sign in with Google” button.');
    await FT.auth.signInWithEmailAndPassword(FT.emailFor(id), password);
    var me = await FT.currentUser();
    if (!me || me.missing) { await FT.auth.signOut(); throw new Error('This user has no access profile. Ask the admin.'); }
    if (me.error) { await FT.auth.signOut(); throw new Error(FT.friendlyError(me.error)); }
    if (!me.active) { await FT.auth.signOut(); throw new Error('This user is blocked. Ask the admin.'); }
    return me;
  };
  // admin: Google sign-in, only the registered Gmail is accepted
  var TOKEN_KEY = 'ft-admin-token';
  function googleProvider() {
    var p = new firebase.auth.GoogleAuthProvider();
    p.addScope(FT.ADMIN_SCOPE);
    p.setCustomParameters({login_hint: FT.OWNER_EMAIL, prompt: 'select_account'});
    return p;
  }
  function keepToken(result) {
    var t = result && result.credential && result.credential.accessToken;
    if (!t) return '';
    var rec = {t: t, exp: Date.now() + 50 * 60 * 1000};
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(rec)); } catch (e) {}
    return t;
  }
  FT.isNative = function () { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); };
  FT.signInAdmin = async function () {
    await FT.init();
    var result;
    if (FT.isNative()) {
      // inside the Android app Google does not allow its sign-in page in a web view – use the phone's Google account picker
      var FA = Capacitor.Plugins.FirebaseAuthentication;
      if (!FA) throw new Error('Google sign-in is not available in this app version.');
      var nat = await FA.signInWithGoogle();
      var idToken = nat && nat.credential && nat.credential.idToken;
      if (!idToken) throw new Error('Google sign-in was cancelled.');
      result = await FT.auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(idToken));
    } else {
      result = await FT.auth.signInWithPopup(googleProvider());
    }
    if (!FT.isOwner(result.user)) {
      var email = result.user && result.user.email;
      // not the admin: remove the Google account Firebase just made, if it is new, and sign out
      try { if (result.additionalUserInfo && result.additionalUserInfo.isNewUser) await result.user.delete(); } catch (e) {}
      try { await FT.auth.signOut(); } catch (e) {}
      throw new Error((email || 'This Google account') + ' is not the admin account. Staff sign in with their user ID and password.');
    }
    keepToken(result);
    return FT.currentUser();
  };
  // short-lived Google permission used only for creating / changing staff accounts
  FT.adminToken = async function (fresh) {
    if (FT.isNative()) throw new Error('Adding users, passwords, blocking and deleting are done on a computer (portal website). Access ticks and expertise can be changed here.');
    if (!fresh) {
      try { var rec = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); if (rec && rec.exp > Date.now()) return rec.t; } catch (e) {}
    }
    await FT.init();
    var u = FT.auth.currentUser;
    if (!FT.isOwner(u)) throw new Error('Only the admin can manage users.');
    var result = await u.reauthenticateWithPopup(googleProvider());
    var t = keepToken(result);
    if (!t) throw new Error('Google did not give permission to manage users. Please try again.');
    return t;
  };
  var API_ERRORS = {EMAIL_EXISTS: 'This user ID is already taken.', WEAK_PASSWORD: 'The password is too weak – use at least 8 characters.', INVALID_EMAIL: 'The user ID can use letters, numbers, dot, dash or underscore.',
    USER_NOT_FOUND: 'This user no longer exists.', PERMISSION_DENIED: 'Your Google account has no permission to manage users in the Firebase project.', INSUFFICIENT_PERMISSION: 'Your Google account has no permission to manage users in the Firebase project.'};
  FT.adminApi = async function (path, body) {
    var call = async function (token) {
      var r = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + FT.config.projectId + '/' + path, {
        method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
      var j = null; try { j = await r.json(); } catch (e) {}
      return {r: r, j: j || {}};
    };
    var out = await call(await FT.adminToken());
    if (out.r.status === 401) { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} out = await call(await FT.adminToken(true)); }
    if (!out.r.ok) {
      var m = (out.j.error && (out.j.error.message || out.j.error.status)) || out.r.statusText, code = String(m).split(/[ :]/)[0];
      throw new Error(API_ERRORS[code] || API_ERRORS[out.j.error && out.j.error.status] || ('Could not change the user account: ' + m));
    }
    return out.j;
  };
  FT.signOut = async function () {
    await FT.init();
    try { await FT.flushAll(); } catch (e) {}
    // remove local copies so the next person on this computer cannot see the data –
    // but only when the cloud already holds a complete copy (never lose data that was not uploaded yet)
    for (var a in FT.APPS) {
      var key = FT.APPS[a].key, st = state[key];
      try {
        if (st && st.pending) continue;
        var local = localStorage.getItem(key);
        if (local !== null) {
          var meta = await storeRef(a, key).get();
          var inCloud = meta.exists && (meta.data().size === local.length || (st && st.lastSent === local));
          if (!inCloud) continue;
        }
        localStorage.removeItem(key); localStorage.removeItem(key + '-ui');
      } catch (e) { /* no access to that app → leave its local copy alone */ }
    }
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    await FT.auth.signOut();
  };

  /* ---------- Claude AI key shared with staff (set by the admin) ---------- */
  FT.getAi = async function () {
    await FT.init();
    try { var s = await FT.db.collection('config').doc('ai').get(); return s.exists ? s.data() : {}; } catch (e) { return {}; }
  };
  FT.setAi = async function (fields) {
    await FT.init();
    fields.updatedBy = (FT.me && FT.me.name) || '';
    fields.at = firebase.firestore.FieldValue.serverTimestamp();
    await FT.db.collection('config').doc('ai').set(fields, {merge: true});
  };
  // admin adds a staff user: account created through the Google-authorised admin API (public sign-up is off)
  FT.addUser = async function (u) {
    await FT.init();
    var email = FT.emailFor(u.id);
    if (email === FT.OWNER_EMAIL) throw new Error('That is the admin account.');
    var made = await FT.adminApi('accounts', {email: email, password: u.password, displayName: u.name || u.id});
    var uid = made.localId;
    try {
      await FT.db.collection('users').doc(uid).set({id: FT.idFromEmail(email), name: u.name || u.id, role: 'staff', apps: {audit: !!u.audit, crm: !!u.crm}, active: true, expertise: u.expertise || [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: (FT.me && FT.me.name) || ''});
    } catch (e) {
      try { await FT.adminApi('accounts:delete', {localId: uid}); } catch (e2) {}
      throw e;
    }
    return uid;
  };
  FT.setUserPassword = async function (uid, password) { await FT.adminApi('accounts:update', {localId: uid, password: password}); };
  FT.setUserActive = async function (uid, active) {
    await FT.adminApi('accounts:update', {localId: uid, disableUser: !active});
    await FT.updateUser(uid, {active: !!active});
  };
  FT.deleteUser = async function (uid) {
    try { await FT.adminApi('accounts:delete', {localId: uid}); }
    catch (e) { if (!/no longer exists/.test(e.message)) throw e; }
    await FT.db.collection('users').doc(uid).delete();
  };
  // team directory that staff may read (names, expertise, access) – used for assignment and reminders
  FT.getTeam = async function () {
    await FT.init();
    try { var s = await FT.db.collection('config').doc('team').get(); return s.exists ? (s.data().members || []) : []; } catch (e) { return []; }
  };
  FT.saveTeam = async function (users) {
    await FT.init();
    var members = (users || []).filter(function (u) { return !(FT.me && u.uid === FT.me.uid); }).map(function (u) { return {uid: u.uid, name: u.name || u.id, id: u.id, expertise: u.expertise || [], crm: !!(u.apps && u.apps.crm), audit: !!(u.apps && u.apps.audit), active: !!u.active}; });
    if (FT.me && FT.me.owner) members.unshift({uid: FT.me.uid, name: FT.me.name, id: FT.me.id, expertise: FT.me.expertise || [], crm: true, audit: true, active: true, admin: true});
    await FT.db.collection('config').doc('team').set({members: members, at: firebase.firestore.FieldValue.serverTimestamp()});
    return members;
  };
  FT.listUsers = async function () {
    await FT.init();
    var s = await FT.db.collection('users').get();
    return s.docs.map(function (d) { return Object.assign({uid: d.id}, d.data()); }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  };
  FT.updateUser = async function (uid, fields) { await FT.init(); await FT.db.collection('users').doc(uid).update(fields); };
  FT.changeMyPassword = async function (current, next) {
    await FT.init();
    var u = FT.auth.currentUser;
    await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, current));
    await u.updatePassword(next);
  };

  /* ---------- shared data: an app's whole saved data, split into parts ---------- */
  var state = {};   // key -> {app, v, timer, pending, lastSent}
  function storeRef(app, key) { return FT.db.collection('apps').doc(app).collection('store').doc(key.replace(/[^\w-]/g, '_')); }
  var nativeSet = Storage.prototype.setItem;
  FT.pull = async function (app, key) {
    await FT.init();
    var ref = storeRef(app, key), meta = await ref.get();
    state[key] = state[key] || {app: app, v: 0};
    if (!meta.exists) return {found: false};
    var m = meta.data(), parts = await ref.collection('parts').get(), chunks = [];
    parts.docs.forEach(function (d) { chunks[+d.id] = d.data().t || ''; });
    var text = chunks.slice(0, m.parts).join('');
    if (text.length !== m.size) throw new Error('The saved data is incomplete – please try again in a moment.');
    nativeSet.call(localStorage, key, text);
    state[key].v = m.v; state[key].lastSent = text;
    return {found: true, meta: m};
  };
  FT.push = async function (app, key, text, force) {
    await FT.init();
    var st = state[key] = state[key] || {app: app, v: 0};
    var ref = storeRef(app, key), n = Math.max(1, Math.ceil(text.length / PART));
    var result = await FT.db.runTransaction(async function (tx) {
      var meta = await tx.get(ref), cur = meta.exists ? meta.data() : {v: 0, parts: 0};
      if (!force && cur.v !== st.v) return {conflict: true, by: cur.by, at: cur.at};
      for (var i = 0; i < n; i++) tx.set(ref.collection('parts').doc(String(i)), {t: text.slice(i * PART, (i + 1) * PART)});
      for (var j = n; j < (cur.parts || 0); j++) tx.delete(ref.collection('parts').doc(String(j)));
      var v = (cur.v || 0) + 1;
      tx.set(ref, {v: v, parts: n, size: text.length, by: (FT.me && FT.me.name) || '', byUid: (FT.me && FT.me.uid) || '', at: firebase.firestore.FieldValue.serverTimestamp()});
      return {v: v};
    });
    if (result.conflict) return result;
    st.v = result.v; st.lastSent = text;
    return result;
  };
  // save automatically whenever the app writes its data to the browser
  FT.startSync = function (app, key) {
    var st = state[key] = state[key] || {app: app, v: 0};
    Storage.prototype.setItem = function (k, val) {
      nativeSet.call(this, k, val);
      if (this === localStorage && state[k] && state[k].live) FT.queue(k, String(val));
    };
    st.live = true;
    // someone else saved → offer to reload
    FT.db && storeRef(app, key).onSnapshot(function (s) {
      if (!s.exists) return;
      var m = s.data();
      if (m.v > st.v && m.byUid !== (FT.me && FT.me.uid)) FT.badge('Updated by ' + (m.by || 'another user') + ' – reload to see the latest', 'reload');
    }, function () {});
  };
  FT.queue = function (key, text) {
    var st = state[key];
    if (text === st.lastSent) return;
    st.pending = text; FT.badge('Saving…');
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { FT.flush(key); }, 1500);
  };
  FT.flush = async function (key, force) {
    var st = state[key]; if (!st || st.pending === undefined || st.pending === null) return;
    var text = st.pending;
    try {
      var r = await FT.push(st.app, key, text, force);
      if (r.conflict) { FT.conflict(key, r); return; }
      if (st.pending === text) st.pending = null;
      FT.badge('Saved to cloud', 'ok');
    } catch (e) { FT.badge('Not saved to cloud – ' + FT.friendlyError(e), 'bad'); st.timer = setTimeout(function () { FT.flush(key); }, 15000); }
  };
  FT.flushAll = async function () { for (var k in state) { clearTimeout(state[k].timer); await FT.flush(k); } };
  FT.conflict = function (key, r) {
    var box = document.createElement('div');
    box.className = 'ft-modal';
    box.innerHTML = '<div class="ft-card"><h3>Someone else saved changes</h3><p><b>' + esc(r.by || 'Another user') + '</b> saved this data while you were working. Choose what to keep.</p>' +
      '<div class="ft-row"><button class="ft-btn" data-x="reload">Load their latest version</button><button class="ft-btn ft-danger" data-x="mine">Keep my version (replaces theirs)</button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', async function (e) {
      var x = e.target.getAttribute('data-x'); if (!x) return;
      box.remove();
      if (x === 'mine') await FT.flush(key, true);
      else { state[key].pending = null; location.reload(); }
    });
  };

  // first open on a computer that already had different data saved in the browser
  FT.localChoice = function (app, key) {
    var backupKey = key + '-local-backup', local = localStorage.getItem(backupKey);
    if (!local) return;
    var sizeKb = function (t) { return Math.max(1, Math.round((t || '').length / 1024)) + ' KB'; };
    var box = document.createElement('div');
    box.className = 'ft-modal';
    box.innerHTML = '<div class="ft-card"><h3>This computer has its own ' + esc(FT.APPS[app].name) + ' data</h3>' +
      '<p>The shared cloud data (' + sizeKb(localStorage.getItem(key)) + ') is open now. This browser also had data saved earlier (' + sizeKb(local) + ') that is different.</p>' +
      '<p>If the data on this computer is your real, up-to-date data, choose <b>Use this computer’s data</b> – it will replace the shared copy for everyone.</p>' +
      '<div class="ft-row"><button class="ft-btn" data-x="cloud">Keep the shared cloud data</button><button class="ft-btn ft-danger" data-x="local">Use this computer’s data</button></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', async function (e) {
      var x = e.target.getAttribute('data-x'); if (!x) return;
      box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      if (x === 'local') {
        try { await FT.push(app, key, local, true); nativeSet.call(localStorage, key, local); localStorage.removeItem(backupKey); location.reload(); }
        catch (err) { box.remove(); FT.badge('Not saved to cloud – ' + FT.friendlyError(err), 'bad'); }
      } else { localStorage.removeItem(backupKey); box.remove(); }
    });
  };

  /* ---------- small bar shown inside the apps ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  FT.esc = esc;
  FT.css = '.ft-bar{position:fixed;left:12px;bottom:12px;z-index:99999;display:flex;align-items:center;gap:8px;background:#14284b;color:#fff;border-radius:999px;padding:6px 8px 6px 12px;font:600 12.5px/1.2 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)}' +
    '.ft-bar a,.ft-bar button{all:unset;cursor:pointer;color:#fff;padding:4px 8px;border-radius:999px}.ft-bar a:hover,.ft-bar button:hover{background:rgba(255,255,255,.15)}' +
    '.ft-bar .ft-state{font-weight:500;opacity:.85;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ft-bar .ft-state.ok{color:#9fe3bf}.ft-bar .ft-state.bad{color:#ffb4a8}.ft-bar .ft-state.reload{color:#ffd88a;text-decoration:underline;cursor:pointer}' +
    '.ft-modal{position:fixed;inset:0;background:rgba(10,20,40,.45);z-index:100000;display:grid;place-items:center;padding:16px}.ft-card{background:#fff;color:#14284b;border-radius:12px;max-width:460px;padding:20px;font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif}' +
    '.ft-card h3{margin:0 0 8px}.ft-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.ft-btn{border:1px solid #c9d1de;background:#fff;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}.ft-danger{border-color:#c0392b;color:#c0392b}';
  FT.bar = function (me) {
    var st = document.createElement('style'); st.textContent = FT.css; document.head.appendChild(st);
    var b = document.createElement('div'); b.className = 'ft-bar';
    b.innerHTML = '<a href="../" title="Back to the dashboard">◀ Dashboard</a><span>' + esc(me.name || me.id) + '</span><span class="ft-state" id="ft-state"></span><button id="ft-out">Sign out</button>';
    document.body.appendChild(b);
    document.getElementById('ft-out').onclick = async function () { this.textContent = 'Signing out…'; await FT.signOut(); location.href = '../'; };
    document.getElementById('ft-state').onclick = function () { if (this.classList.contains('reload')) location.reload(); };
  };
  FT.badge = function (text, cls) {
    var el = document.getElementById('ft-state'); if (!el) return;
    el.textContent = text; el.className = 'ft-state ' + (cls || '');
    if (cls === 'ok') setTimeout(function () { if (el.textContent === text) el.textContent = ''; }, 2500);
  };

  /* ---------- loader used by /crm/ and /audit/ ---------- */
  FT.openApp = async function (app, appUrl, afterWrite) {
    var msg = document.getElementById('ft-msg');
    function say(t) { if (msg) msg.textContent = t; }
    try {
      say('Checking your sign-in…');
      var me = await FT.currentUser();
      if (!me || me.missing || !me.active) { location.replace('../?next=' + app); return; }
      if (!FT.canOpen(me, app)) { say('You do not have access to ' + FT.APPS[app].name + '. Ask the admin.'); return; }
      say('Loading the latest ' + FT.APPS[app].name + ' data…');
      var key = FT.APPS[app].key, markKey = 'ft-synced-' + key;
      var local = localStorage.getItem(key), firstHere = !localStorage.getItem(markKey);
      var got = await FT.pull(app, key);
      if (!got.found) {
        // first time in the cloud: keep what this browser already has (if anything) and upload it
        state[key] = state[key] || {app: app, v: 0};
        if (local) await FT.push(app, key, local, true);
      } else if (firstHere && local && local !== localStorage.getItem(key)) {
        // this computer had its own data before joining the portal – keep it aside and ask
        nativeSet.call(localStorage, key + '-local-backup', local);
      }
      nativeSet.call(localStorage, markKey, '1');
      say('Opening ' + FT.APPS[app].name + '…');
      var html = await fetch(appUrl, {cache: 'no-cache'}).then(function (r) { if (!r.ok) throw new Error('Could not load the ' + FT.APPS[app].name + ' program (' + r.status + ')'); return r.text(); });
      FT.startSync(app, key);
      document.open(); document.write(html); document.close();
      var done = function () {
        // (listeners must be added after document.write, which clears earlier ones)
        window.addEventListener('beforeunload', function (e) { var st = state[key]; if (st && st.pending) { e.preventDefault(); e.returnValue = ''; } });
        FT.bar(me); if (afterWrite) afterWrite(me);
        if (localStorage.getItem(key + '-local-backup')) FT.localChoice(app, key);
      };
      if (document.readyState === 'complete') setTimeout(done, 0); else window.addEventListener('load', done);
    } catch (e) {
      say(FT.friendlyError(e));
    }
  };
})();
