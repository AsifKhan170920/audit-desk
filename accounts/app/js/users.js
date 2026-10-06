/* ===================== Users & access =====================
   Ported from Bookkeeping Desk ("Users, businesses, login, profile, MFA" and
   "User permissions"), rewritten in this app's conventions.

   - Users live in mgr_users:
       {id, name, email, username, user (alias of username), role:'Administrator'|'Restricted user',
        salt, hash, businesses:[bizId], mfa, totpSecret?, created}
     Passwords are salted SHA-256 (crypto.subtle) — never stored in plain text.
     The old mgr_accounts list (plain-text passwords) is migrated on first load
     and then removed.
   - Sessions: mgr_sessions [{id,userId,device,created,last,imp?}] plus a pointer
     for this browser in mgr_session {sid,userId,name,user,role}.
   - Failed logins: mgr_login_fail {username:{n,until}} — 5 fails lock for 5 min.
   - Sign up (login screen, once an administrator exists): creates a business
     via App.addBusiness and a Restricted user assigned only to it (no
     permissions record = Full access). Switched by mgr_settings.allowSignup
     (default on; Users page switch).
   - Permissions per business: b.userPermissions[userId] =
       {username, access:'Full access'|'Custom access', perms:{SidebarLabel:LEVEL},
        reports:{reportKey:LEVEL}, settings:{settingKey:LEVEL}, banks:[bankRecordId]}
     No record (or Full access) = full access, as in Manager.io. Old
     b.permissions {role,hidden} entries are migrated into this shape.

   NOTE: this is browser-only storage. For real multi-computer use the user
   store, hashing and session checks belong on a server.

   Loaded right after app.js (before designer.js, which calls App.init()).
   Everything public is a method on App; UsersAccess exposes the pure core for tests.
   ============================================================================ */
(function(global){
  'use strict';

  var LEVELS = ['View', 'View, Create', 'View, Create, Update', 'View, Create, Update, Delete'];
  var ADMIN = 'Administrator', RESTRICTED = 'Restricted user';
  var FULL = 'Full access', CUSTOM = 'Custom access';
  var LOCK_FAILS = 5, LOCK_MS = 5 * 60000;
  /* settings screens that have no tile of their own: they take the level of their parent tile */
  var SETTING_ALIAS = { logo:'business', currency:'currencies', footers:'themes', capitalSub:'coa', startingBalances:'starting' };

  if(!DB.k.sessions) DB.k.sessions = 'mgr_sessions';
  if(!DB.k.loginFail) DB.k.loginFail = 'mgr_login_fail';
  if(!DB.k.appSettings) DB.k.appSettings = 'mgr_settings';

  /* ---------------- small helpers ---------------- */
  function esc(s){ return App.esc(s == null ? '' : s); }
  /* an argument for an inline onclick="App.x(...)" — JSON, attribute-escaped */
  function arg(v){ return esc(JSON.stringify(v)); }
  function lc(s){ return String(s == null ? '' : s).trim().toLowerCase(); }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function nowIso(){ return new Date().toISOString(); }
  function uid(){ return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function byId(id){ return id ? document.getElementById(id) : null; }
  function ico(n, sz){ return (global.ICO && global.ICO.get) ? global.ICO.get(n, sz || 16) : ''; }
  function fail(m){ throw new Error(m); }
  function sameId(a, b){ return String(a) === String(b); }

  /* ---------------- crypto ---------------- */
  function webCrypto(){
    var c = (typeof crypto !== 'undefined' && crypto) || global.crypto;
    if(!c || !c.subtle) fail('This browser cannot hash passwords (Web Crypto is unavailable). Open the app over https or from localhost.');
    return c;
  }
  function hex(buf){ return Array.prototype.map.call(new Uint8Array(buf), function(x){ return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function hashPw(pw, salt){
    var data = new TextEncoder().encode(String(salt) + ':' + String(pw));
    return webCrypto().subtle.digest('SHA-256', data).then(hex);
  }
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32gen(n){
    var a = webCrypto().getRandomValues(new Uint8Array(n || 20)), bits = '', out = '';
    for(var i = 0; i < a.length; i++) bits += ('00000000' + a[i].toString(2)).slice(-8);
    for(var j = 0; j + 5 <= bits.length; j += 5) out += B32[parseInt(bits.slice(j, j + 5), 2)];
    return out;
  }
  function b32dec(s){
    var bits = '';
    String(s || '').replace(/=+$/, '').toUpperCase().split('').forEach(function(c){
      var v = B32.indexOf(c); if(v >= 0) bits += ('00000' + v.toString(2)).slice(-5); });
    var out = new Uint8Array(Math.floor(bits.length / 8));
    for(var i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return out;
  }
  /* RFC 6238 TOTP, 6 digits, 30 s step, HMAC-SHA-1 */
  function totp(secret, t, step){
    t = (t == null ? Date.now() : t); step = step || 30;
    var ctr = Math.floor(t / 1000 / step), buf = new ArrayBuffer(8), dv = new DataView(buf);
    dv.setUint32(4, ctr >>> 0); dv.setUint32(0, Math.floor(ctr / 4294967296));
    var sub = webCrypto().subtle;
    return sub.importKey('raw', b32dec(secret), { name:'HMAC', hash:'SHA-1' }, false, ['sign'])
      .then(function(key){ return sub.sign('HMAC', key, buf); })
      .then(function(sig){
        var h = new Uint8Array(sig), o = h[h.length - 1] & 15;
        var n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
        return ('000000' + n).slice(-6);
      });
  }
  /* accepts the current code and one step either side (clock drift) */
  async function totpOk(secret, code, now){
    code = String(code || '').replace(/\s/g, ''); if(!/^\d{6}$/.test(code)) return false;
    now = now == null ? Date.now() : now;
    for(var d of [0, -30000, 30000]) if(await totp(secret, now + d) === code) return true;
    return false;
  }
  function otpauthUri(username, secret){
    return 'otpauth://totp/' + encodeURIComponent('Manager:' + username) + '?secret=' + secret + '&issuer=Manager';
  }

  /* ---------------- stores ---------------- */
  function users(){ var a = DB.get(DB.k.users, []); return Array.isArray(a) ? a : []; }
  function saveUsers(a){ DB.set(DB.k.users, a); }
  function sessions(){ var a = DB.get(DB.k.sessions, []); return Array.isArray(a) ? a : []; }
  function saveSessions(a){ DB.set(DB.k.sessions, a); }
  function bizList(){ var a = DB.get(DB.k.biz, []); return Array.isArray(a) ? a : []; }
  function userById(id){ if(id == null || id === '') return null; return users().find(function(u){ return sameId(u.id, id); }) || null; }
  function userByName(n){ var k = lc(n); if(!k) return null; return users().find(function(u){ return lc(u.username || u.user) === k; }) || null; }
  function isAdmin(u){ return !!u && u.role === ADMIN; }

  /* ---------------- migration ---------------- */
  /* Brings mgr_accounts (plain text) + mgr_users into the hashed user model.
     Runs on every load and is a no-op once done. Existing passwords keep working. */
  async function migrateUsers(){
    var raw = DB.get(DB.k.users, null), accts = DB.get(DB.k.accounts, null);
    var list = Array.isArray(raw) ? raw.map(function(u){ return Object.assign({}, u); }) : [];
    var changed = !Array.isArray(raw) && list.length > 0;
    var allBiz = bizList().map(function(b){ return b.id; });
    var find = function(n){ var k = lc(n); return list.find(function(u){ return lc(u.username || u.user) === k; }); };
    if(Array.isArray(accts)){
      for(var a of accts){
        if(!a || !a.user) continue;
        var u = find(a.user);
        /* self sign-up created administrators, so an account without a users row is one */
        if(!u){ u = { id:uid(), name:a.name || a.user, user:a.user, role:ADMIN }; list.push(u); }
        if(!u.hash && a.pass != null){ u.salt = uid(); u.hash = await hashPw(String(a.pass), u.salt); }
        changed = true;
      }
    }
    list.forEach(function(u){
      var before = JSON.stringify(u);
      u.id = String(u.id != null && u.id !== '' ? u.id : uid());
      u.username = String(u.username || u.user || '').trim(); u.user = u.username;
      u.name = u.name || ''; u.email = u.email || '';
      u.role = u.role === ADMIN ? ADMIN : RESTRICTED;
      /* before this change every user could open every business — keep that */
      if(!Array.isArray(u.businesses)) u.businesses = u.role === ADMIN ? [] : allBiz.slice();
      u.mfa = !!u.mfa; if(!u.created) u.created = nowIso();
      if(JSON.stringify(u) !== before) changed = true;
    });
    if(list.length && !list.some(isAdmin)){ list[0].role = ADMIN; list[0].businesses = []; changed = true; }
    if(changed) saveUsers(list);
    if(accts !== null){ try{ localStorage.removeItem(DB.k.accounts); }catch(e){} }
    return list;
  }

  /* b.permissions {who:{role,hidden}} -> b.userPermissions[userId]. Entries whose
     user can't be found are left where they are (they keep working by name). */
  function migratePermissions(){
    var all = bizList(), list = users(), ch = false;
    all.forEach(function(b){
      if(!b || !b.permissions || typeof b.permissions !== 'object') return;
      Object.keys(b.permissions).forEach(function(who){
        var k = lc(who), u = list.find(function(x){ return lc(x.username) === k; }) || list.find(function(x){ return lc(x.name) === k; });
        if(!u) return;
        var conv = legacyToPerm(b.permissions[who]);
        b.userPermissions = b.userPermissions || {};
        if(conv && conv.access === CUSTOM && !b.userPermissions[u.id]) b.userPermissions[u.id] = Object.assign({ username:u.username }, conv);
        delete b.permissions[who]; ch = true;
      });
      if(!Object.keys(b.permissions).length) delete b.permissions;
    });
    if(ch) DB.set(DB.k.biz, all);
    return ch;
  }

  /* ---------------- sessions ---------------- */
  function device(){
    var u = (global.navigator && navigator.userAgent) || '';
    var m = u.match(/(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/) || [null, 'Browser', ''];
    var name = m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1];
    var os = /Windows NT 10/.test(u) ? 'Windows 10/11' : /Windows/.test(u) ? 'Windows' : /Android/.test(u) ? 'Android' :
      /iPhone|iPad/.test(u) ? 'iOS' : /Mac OS/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'Unknown';
    return (name + ' ' + (m[2] || '').split('.')[0]).trim() + ' — ' + os;
  }
  function pointer(){ var p = DB.get(DB.k.session, null); return p && p.sid ? p : null; }
  function setPointer(s, u){
    var p = { sid:s.id, userId:u.id, name:u.name || u.username, user:u.username, role:u.role };
    DB.set(DB.k.session, p); App.current = p; return p;
  }
  function startSession(userId){
    var u = userById(userId); if(!u) fail('Unknown user.');
    var s = { id:uid(), userId:u.id, device:device(), created:nowIso(), last:nowIso() };
    saveSessions(sessions().concat([s])); setPointer(s, u); return s;
  }
  function endSession(id){
    saveSessions(sessions().filter(function(s){ return s.id !== id; }));
    var p = pointer(); if(p && p.sid === id){ try{ localStorage.removeItem(DB.k.session); }catch(e){} App.current = null; }
  }
  function currentSession(){ var p = pointer(); if(!p) return null; return sessions().find(function(s){ return s.id === p.sid; }) || null; }
  function sessionValid(){ var s = currentSession(); return !!(s && userById(s.userId)); }
  function touchSession(){
    var s = currentSession(); if(!s) return;
    if(Date.now() - new Date(s.last).getTime() > 60000)
      saveSessions(sessions().map(function(x){ return x.id === s.id ? Object.assign({}, x, { last:nowIso() }) : x; }));
  }
  function patchSession(fields){
    var s = currentSession(); if(!s) return;
    saveSessions(sessions().map(function(x){ return x.id === s.id ? Object.assign({}, x, fields) : x; }));
  }
  /* The user actually signed in (ignores impersonation). */
  function realUser(){
    var s = currentSession(); if(s) return userById(s.userId);
    return legacyCurrent(false);
  }
  /* The user whose rights apply right now — the impersonated one, if any. */
  function currentUser(){
    var s = currentSession(); if(s) return userById(s.imp || s.userId);
    return legacyCurrent(true);
  }
  /* No session pointer: fall back to App.current (older code paths and tests set it directly). */
  function legacyCurrent(imp){
    var c = App.current; if(!c) return null;
    if(c.userId) return userById((imp && c.imp) || c.userId);
    var name = c.user || c.username || c.name;
    var u = userByName(name); if(u) return u;
    return { id:null, name:c.name || name || '', username:name || '', user:name || '', role:c.role || RESTRICTED, pseudo:true };
  }
  function userBizIds(u){
    var all = bizList().map(function(b){ return b.id; });
    if(!u || isAdmin(u) || !Array.isArray(u.businesses)) return all;
    return all.filter(function(id){ return u.businesses.some(function(x){ return sameId(x, id); }); });
  }
  function canOpenBusiness(id, u){
    u = u === undefined ? currentUser() : u; if(!u) return true;
    return userBizIds(u).some(function(x){ return sameId(x, id); });
  }

  /* ---------------- permission model ---------------- */
  /* custom tabs (js/custom-modules.js) switched on for business b */
  function customTabs(b){ try{ return (b && global.CustomModules) ? global.CustomModules.tabsFor(b).map(function(t){ return t.label; }) : []; }catch(e){ return []; } }
  function permTabs(b){
    var t = SIDEBAR.map(function(r){ return r[1]; }).concat(SIDEBAR_FOOT.map(function(r){ return r[1]; }), customTabs(b));
    return t.filter(function(x, i){ return t.indexOf(x) === i; }).sort(function(a, b){ return a.localeCompare(b); });
  }
  function reportList(){
    var d = App._REPDEF || {};
    return Object.keys(d).map(function(k){ return { key:k, name:d[k].name || k }; }).sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  var rawTiles = null;  // the unfiltered App.setTiles, captured in install()
  function settingPages(){
    var t = []; try{ t = (rawTiles || App.setTiles).call(App) || []; }catch(e){}
    return t.map(function(x){ return { key:x[2], name:x[1] }; }).sort(function(a, b){ return a.name.localeCompare(b.name); });
  }
  function lvlOf(v){ var i = LEVELS.indexOf(v); return i >= 0 ? i + 1 : (v ? 1 : 0); }
  function allAt(list, level, keyOf){ var o = {}; list.forEach(function(x){ o[keyOf ? keyOf(x) : x] = level; }); return o; }

  /* Normalises any record shape (incl. the source app's arrays) to the model above. */
  function normPerm(x){
    x = x || {};
    x.access = x.access === CUSTOM ? CUSTOM : FULL;
    x.perms = (x.perms && typeof x.perms === 'object' && !Array.isArray(x.perms)) ? x.perms : {};
    if(Array.isArray(x.modules)){ x.modules.forEach(function(m){ x.perms[m] = LEVELS[3]; }); delete x.modules; }
    if(Array.isArray(x.reports)) x.reports = allAt(x.reports, LEVELS[0]);
    if(Array.isArray(x.settings)) x.settings = allAt(x.settings, LEVELS[3]);
    x.reports = (x.reports && typeof x.reports === 'object') ? x.reports : {};
    x.settings = (x.settings && typeof x.settings === 'object') ? x.settings : {};
    x.banks = Array.isArray(x.banks) ? x.banks.map(String) : [];
    return x;
  }
  /* The old {role:'Full access'|'Restricted'|'Read only', hidden:[labels]} shape. */
  function legacyToPerm(p){
    if(!p) return null;
    if(p.access) return normPerm(clone(p));
    var role = p.role || FULL;
    if(role === 'Restricted' || role === 'Read only'){
      var ro = role === 'Read only', L = ro ? LEVELS[0] : LEVELS[3], hid = p.hidden || [], perms = {};
      permTabs().forEach(function(t){ if(ro || hid.indexOf(t) < 0 || t === 'Summary' || t === 'Dashboard') perms[t] = L; });
      return normPerm({ access:CUSTOM, perms:perms,
        reports:allAt(reportList(), L, function(r){ return r.key; }),
        settings:allAt(settingPages(), L, function(s){ return s.key; }), banks:[] });
    }
    return normPerm({ access:FULL });
  }
  function permFor(b, u){
    if(!b || !u) return null;
    var up = b.userPermissions && u.id != null && b.userPermissions[u.id];
    if(up) return normPerm(clone(up));
    var lp = b.permissions && (b.permissions[u.username] || b.permissions[u.user] || b.permissions[u.name]);
    return lp ? legacyToPerm(lp) : null;
  }
  function permErrors(p){
    var E = [];
    if(p.access === CUSTOM && !Object.keys(p.perms).length) E.push('Tick at least one tab, or choose Full access.');
    if(p.access === CUSTOM && p.perms.Reports && !Object.keys(p.reports).length) E.push('Choose at least one report, or untick Reports.');
    if(p.access === CUSTOM && p.perms.Settings && !Object.keys(p.settings).length) E.push('Choose at least one settings page, or untick Settings.');
    return E;
  }
  function cleanPerm(p){
    if(p.access === FULL){ p.perms = {}; p.banks = []; p.reports = {}; p.settings = {}; }
    if(!p.perms.Reports) p.reports = {};
    if(!p.perms.Settings) p.settings = {};
    if(!p.perms['Bank and Cash Accounts']) p.banks = [];
    return p;
  }
  function curB(b){ return b || (App.openBiz != null ? App.curBiz() : null); }
  /* The restrictions that apply to the current user in b, or null for full access. */
  function myPerm(b){
    var u = currentUser(); if(!u || isAdmin(u)) return null;
    var p = permFor(curB(b), u);
    return p && p.access === CUSTOM ? p : null;
  }
  function permLevel(b, label){ var p = myPerm(b); if(!p) return 4; return p.perms[label] ? lvlOf(p.perms[label]) : 0; }
  function settingLevel(b, key){
    var p = myPerm(b); if(!p) return 4; if(!p.perms.Settings) return 0;
    key = SETTING_ALIAS[key] || key;
    if(p.settings[key]) return lvlOf(p.settings[key]);
    if(settingPages().some(function(s){ return s.key === key; })) return 0;
    /* a sub-screen with no tile: as much as the user has on any settings page */
    return Object.keys(p.settings).reduce(function(m, k){ return Math.max(m, lvlOf(p.settings[k])); }, 0);
  }
  function reportLevel(b, key){
    var p = myPerm(b); if(!p) return 4; if(!p.perms.Reports) return 0;
    return p.reports[key] ? lvlOf(p.reports[key]) : 0;
  }
  function bankRecs(b){ return ((b && b.records && b.records.bankCash) || []); }
  function bankAllowed(b, ref){
    b = curB(b); var p = myPerm(b);
    if(!p || !p.perms['Bank and Cash Accounts'] || !p.banks.length) return true;
    var r = bankRecs(b).find(function(x){ return sameId(x.id, ref); }) || bankRecs(b).find(function(x){ return x.name === ref; });
    return !!r && p.banks.indexOf(String(r.id)) >= 0;
  }
  function rowVisible(b, key, r){
    if(!r) return true;
    if(key === 'bankCash') return bankAllowed(b, r.id);
    if(key === 'receipts') return !r.receivedIn || bankAllowed(b, r.receivedIn);
    if(key === 'payments') return !r.paidFrom || bankAllowed(b, r.paidFrom);
    if(key === 'iat') return (!r.paidFrom || bankAllowed(b, r.paidFrom)) && (!r.receivedIn || bankAllowed(b, r.receivedIn));
    if(key === 'bankRec') return !r.account || bankAllowed(b, r.account);
    return true;
  }
  function firstAllowed(b){
    var order = [];
    (typeof SIDEBAR_GROUPS !== 'undefined' ? SIDEBAR_GROUPS : []).forEach(function(g){ order = order.concat(g[1]); });
    SIDEBAR.forEach(function(r){ if(order.indexOf(r[1]) < 0) order.push(r[1]); });
    order = order.concat(customTabs(b), ['Reports', 'Settings']);
    return order.find(function(l){ return permLevel(b, l) >= 1; }) || null;
  }

  /* ---------------- account operations (pure-ish, used by the UI and tests) ---------------- */
  function validUsername(name, exceptId){
    var n = String(name || '').trim(); if(!n) fail('Username is required.');
    if(users().some(function(u){ return !sameId(u.id, exceptId) && lc(u.username) === lc(n); })) fail('Username "' + n + '" is already taken.');
    return n;
  }
  function validPw(pw){ if(!pw || String(pw).length < 6) fail('Password must be at least 6 characters.'); return pw; }
  function failsMap(){ var m = DB.get(DB.k.loginFail, {}); return (m && typeof m === 'object') ? m : {}; }
  async function guard(fn){ try{ return await fn(); }catch(e){ return { ok:false, error:(e && e.message) || String(e) }; } }

  /* ---------------- self sign-up ----------------
     Global app settings (not per business) live in mgr_settings. allowSignup
     defaults to ON: anyone at the login screen can create a restricted account
     that owns one new business of its own (and sees no other business). */
  function appSettings(){ var s = DB.get(DB.k.appSettings, {}); return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {}; }
  function signupAllowed(){ return appSettings().allowSignup !== false; }
  function setSignupAllowed(on){ var s = appSettings(); s.allowSignup = !!on; DB.set(DB.k.appSettings, s); return s.allowSignup; }
  function emailTaken(email){ return users().some(function(u){ return lc(u.email) === lc(email); }); }
  var signupBusy = false;
  /* v = {name, email, username, password, confirm, business, country} */
  function signup(v){ return guard(async function(){
    if(signupBusy) fail('Your account is already being created.');
    if(!users().length) fail('Create the administrator account first.');
    if(!signupAllowed()) fail('Sign up is turned off. Ask an administrator to create an account for you.');
    v = v || {};
    var name = String(v.name || '').trim(), email = String(v.email || '').trim(), bizName = String(v.business || '').trim();
    if(!name) fail('Full name is required.');
    if(!email) fail('Email address is required.');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Email address is not valid.');
    if(emailTaken(email)) fail('An account with this email address already exists.');
    var username = validUsername(v.username); validPw(v.password);
    if(v.password !== v.confirm) fail('Passwords do not match.');
    if(!bizName) fail('Business / company name is required.');
    if(typeof App.addBusiness !== 'function') fail('Businesses cannot be created here.');
    signupBusy = true;
    try{
      var salt = uid(), hash = await hashPw(v.password, salt);
      /* checked again after the await: another tab may have taken them meanwhile */
      validUsername(username);
      if(emailTaken(email)) fail('An account with this email address already exists.');
      var b = App.addBusiness(bizName, String(v.country || '').trim() || 'United Arab Emirates');
      /* no b.userPermissions record for this user = Full access to the new business */
      var u = { id:uid(), name:name, email:email, username:username, user:username, role:RESTRICTED,
        salt:salt, hash:hash, businesses:[b.id], mfa:false, created:nowIso(), signup:true };
      saveUsers(users().concat([u]));
      return { ok:true, user:u, business:b, session:startSession(u.id) };
    } finally { signupBusy = false; }
  }); }
  var SIGNUP_COUNTRIES = ['United Arab Emirates', 'United States', 'United Kingdom', 'Australia', 'Canada', 'India', 'Pakistan', 'Saudi Arabia', 'Singapore', 'New Zealand'];
  /* the full list from js/settings-fixes-b.js when it is loaded */
  function countryOptions(){
    var l = []; try{ if(typeof App.countryList === 'function') l = App.countryList() || []; }catch(e){}
    return l.length ? l : SIGNUP_COUNTRIES.slice();
  }

  function createFirstAdmin(v){ return guard(async function(){
    if(users().length) fail('An administrator already exists. Please log in.');
    var username = validUsername(v.username); validPw(v.password);
    if(v.password !== v.confirm) fail('Passwords do not match.');
    var salt = uid(), u = { id:uid(), name:String(v.name || '').trim(), email:'', username:username, user:username, role:ADMIN,
      salt:salt, hash:await hashPw(v.password, salt), businesses:[], mfa:false, created:nowIso() };
    saveUsers([u]); var s = startSession(u.id);
    return { ok:true, user:u, session:s };
  }); }

  function login(username, password, opts){ return guard(async function(){
    opts = opts || {}; var now = opts.now == null ? Date.now() : opts.now;
    var name = String(username || '').trim(), key = lc(name), fails = failsMap(), fl = fails[key] || { n:0, until:0 };
    if(!name || !password) fail('Enter a username and password.');
    if(fl.until > now) return { ok:false, locked:true, error:'Too many failed attempts. Try again in ' + Math.ceil((fl.until - now) / 60000) + ' minute(s).' };
    var u = userByName(name);
    var good = !!(u && u.hash && (await hashPw(password, u.salt)) === u.hash);
    if(!good){
      var n = (fl.until && fl.until <= now ? 0 : fl.n) + 1;
      fails[key] = n >= LOCK_FAILS ? { n:0, until:now + LOCK_MS } : { n:n, until:0 }; DB.set(DB.k.loginFail, fails);
      return n >= LOCK_FAILS ? { ok:false, locked:true, error:'Too many failed attempts. Login is locked for 5 minutes.' }
                             : { ok:false, error:'Invalid username or password.' };
    }
    delete fails[key]; DB.set(DB.k.loginFail, fails);
    if(u.mfa) return { ok:false, mfa:true, pending:u.totpSecret ? { userId:u.id } : { userId:u.id, setup:true, secret:b32gen() } };
    return { ok:true, user:u, session:startSession(u.id) };
  }); }

  function completeMfa(pending, code, opts){ return guard(async function(){
    opts = opts || {};
    var u = pending && userById(pending.userId); if(!u) fail('Your sign-in expired. Log in again.');
    var secret = pending.setup ? pending.secret : u.totpSecret;
    if(!(await totpOk(secret, code, opts.now))) fail('Invalid code. Check the time on your phone and try again.');
    if(pending.setup) saveUsers(users().map(function(x){ return sameId(x.id, u.id) ? Object.assign({}, x, { totpSecret:secret }) : x; }));
    return { ok:true, user:u, session:startSession(u.id) };
  }); }

  /* d = the user form draft: {id?, name, email, username, newpw, role, businesses, mfa, perm:{bizId:perm}} */
  function saveUser(d, opts){ return guard(async function(){
    opts = opts || {};
    var all = users(), me = opts.me !== undefined ? opts.me : realUser();
    var id = d.id ? String(d.id) : null, old = id ? all.find(function(x){ return sameId(x.id, id); }) : null;
    if(id && !old) fail('User not found.');
    var username = validUsername(d.username, id);
    var email = String(d.email || '').trim();
    if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Email address is not valid.');
    if(!id || d.newpw) validPw(d.newpw);
    var role = d.role === RESTRICTED ? RESTRICTED : ADMIN;
    if(old && isAdmin(old) && role !== ADMIN && all.filter(isAdmin).length === 1) fail('At least one administrator is required.');
    if(old && me && sameId(old.id, me.id) && role !== ADMIN) fail('You cannot remove your own administrator role.');
    var bizAll = bizList();
    var rec = Object.assign({}, old || { id:uid(), created:nowIso() }, {
      name:String(d.name || '').trim(), email:email, username:username, user:username, role:role,
      businesses:role === RESTRICTED ? (d.businesses || []).filter(function(x){ return bizAll.some(function(b){ return sameId(b.id, x); }); }) : [],
      mfa:!!d.mfa });
    if(!rec.mfa || d.resetMfa) delete rec.totpSecret;
    var perms = d.perm || {};
    if(role === RESTRICTED) rec.businesses.forEach(function(bid){
      var p = perms[String(bid)]; if(!p) return; var E = permErrors(normPerm(clone(p)));
      if(E.length) fail(((bizAll.find(function(b){ return sameId(b.id, bid); }) || {}).name || 'Business') + ': ' + E[0]); });
    if(d.newpw){ rec.salt = uid(); rec.hash = await hashPw(d.newpw, rec.salt); }
    saveUsers(old ? all.map(function(x){ return sameId(x.id, id) ? rec : x; }) : all.concat([rec]));
    if(role === RESTRICTED){
      var ch = false;
      bizAll.forEach(function(b){
        if(!rec.businesses.some(function(x){ return sameId(x, b.id); })) return;
        var p = perms[String(b.id)]; if(!p) return;
        p = cleanPerm(normPerm(clone(p))); b.userPermissions = b.userPermissions || {};
        if(p.access === FULL) delete b.userPermissions[rec.id];   // no record = Full access
        else b.userPermissions[rec.id] = Object.assign({ username:rec.username }, p);
        ch = true; });
      if(ch) DB.set(DB.k.biz, bizAll);
    }
    var keep = (pointer() || {}).sid;
    if(old && d.newpw) saveSessions(sessions().filter(function(s){ return !sameId(s.userId, rec.id) || s.id === keep; }));
    if(old) refreshPointer();
    return { ok:true, user:rec, created:!old };
  }); }

  function deleteUser(id, opts){
    opts = opts || {};
    var me = opts.me !== undefined ? opts.me : realUser(), all = users(), u = all.find(function(x){ return sameId(x.id, id); });
    if(!u) return { ok:false, error:'User not found.' };
    if(me && sameId(me.id, id)) return { ok:false, error:'You cannot delete your own account.' };
    if(isAdmin(u) && all.filter(isAdmin).length === 1) return { ok:false, error:'At least one administrator is required.' };
    saveUsers(all.filter(function(x){ return !sameId(x.id, id); }));
    saveSessions(sessions().filter(function(s){ return !sameId(s.userId, id); }).map(function(s){ return sameId(s.imp, id) ? Object.assign({}, s, { imp:'' }) : s; }));
    var biz = bizList(), ch = false;
    biz.forEach(function(b){ if(b.userPermissions && b.userPermissions[u.id]){ delete b.userPermissions[u.id]; ch = true; } });
    if(ch) DB.set(DB.k.biz, biz);
    return { ok:true };
  }

  function changeProfile(v){ return guard(async function(){
    var me = realUser(); if(!me || me.pseudo) fail('You are not signed in.');
    if(!me.hash || (await hashPw(v.current || '', me.salt)) !== me.hash) fail('Current password is incorrect.');
    var username = validUsername(v.username, me.id), rec = Object.assign({}, me, { username:username, user:username });
    if(v.password){ validPw(v.password); rec.salt = uid(); rec.hash = await hashPw(v.password, rec.salt); }
    saveUsers(users().map(function(x){ return sameId(x.id, me.id) ? rec : x; }));
    var keep = (pointer() || {}).sid;
    if(v.password) saveSessions(sessions().filter(function(s){ return !sameId(s.userId, me.id) || s.id === keep; }));
    refreshPointer();
    return { ok:true, passwordChanged:!!v.password };
  }); }

  function refreshPointer(){
    var p = pointer(), u = p && userById(p.userId);
    if(p && u){ p.name = u.name || u.username; p.user = u.username; p.role = u.role; DB.set(DB.k.session, p); App.current = p; }
  }

  /* ---------------- markup helpers ---------------- */
  function msgBox(m){
    if(!m) return '';
    if(m.error) return '<div class="ua-err">' + esc(m.error) + '</div>';
    if(m.info) return '<div class="ua-ok">' + esc(m.info) + '</div>';
    return '';
  }
  function lvlSelect(tgt, key, item, cur){
    return '<select class="perm-lvl" aria-label="Access level" onchange="App.permEd(' + arg(tgt) + ',\'level\',' + arg(key) + ',' + arg(item) + ',this.value)">' +
      LEVELS.map(function(l){ return '<option' + (cur === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select>';
  }
  /* One permission editor, used by the user form (tgt = business id) and by
     Settings > User Permissions (tgt = 'pf'). banks: [{id,name}] of that business. */
  function permEditor(p, tgt, banks){
    var A = function(op){ return 'App.permEd(' + arg(tgt) + ',\'' + op + '\''; };
    /* the business being edited: its switched-on custom tabs are listed too */
    var eb = tgt === 'pf' ? curB() : bizList().find(function(x){ return sameId(x.id, tgt); }), cust = customTabs(eb);
    var sub = function(key, items){
      return '<div class="perm-reveal perm-sub">' + items.map(function(it){
        var on = !!p[key][it.key];
        return '<div class="perm-sub-item"><label class="chk-row"><input type="checkbox"' + (on ? ' checked' : '') +
          ' onchange="' + A('sub') + ',' + arg(key) + ',' + arg(it.key) + ',this.checked)">' + esc(it.name) + '</label>' +
          (on ? '<div class="perm-reveal">' + lvlSelect(tgt, key, it.key, p[key][it.key]) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    };
    var bankPick = function(){
      var tags = p.banks.filter(function(id){ return banks.some(function(x){ return String(x.id) === id; }); }).map(function(id){
        var bk = banks.find(function(x){ return String(x.id) === id; });
        return '<span class="ua-tag">' + esc(bk.name) + '<button type="button" title="Remove" aria-label="Remove ' + esc(bk.name) + '" onclick="' + A('bank') + ',' + arg(id) + ',false)">×</button></span>';
      }).join('');
      var avail = banks.filter(function(x){ return p.banks.indexOf(String(x.id)) < 0; });
      return '<div class="ua-tagbox perm-bankbox" title="Leave empty for all bank and cash accounts">' + tags +
        (avail.length ? '<select class="ua-tag-add" aria-label="Limit to account" onchange="if(this.value){' + A('bank') + ',this.value,true)}">' +
          '<option value="">' + (tags ? 'Add account…' : 'All accounts') + '</option>' +
          avail.map(function(x){ return '<option value="' + esc(String(x.id)) + '">' + esc(x.name) + '</option>'; }).join('') + '</select>'
          : (tags ? '' : '<span class="ua-hint">All accounts</span>')) + '</div>';
    };
    var html = '<div class="perm-ed"><label class="fld">Access type</label>' +
      '<select class="perm-access" onchange="' + A('access') + ',this.value)">' +
      [CUSTOM, FULL].map(function(a){ return '<option' + (p.access === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select>';
    if(p.access === CUSTOM){
      html += '<div class="perm-list">' + permTabs(eb).map(function(t){
        var on = !!p.perms[t], extra = '';
        if(on && t === 'Reports') extra = sub('reports', reportList());
        else if(on && t === 'Settings') extra = sub('settings', settingPages());
        else if(on) extra = '<div class="perm-reveal">' + (t === 'Bank and Cash Accounts' ? bankPick() : '') + lvlSelect(tgt, 'perms', t, p.perms[t]) + '</div>';
        return '<label class="chk-row perm-tab"><input type="checkbox"' + (on ? ' checked' : '') +
          ' onchange="' + A('tab') + ',' + arg(t) + ',this.checked)">' + esc(t) +
          (cust.indexOf(t) >= 0 ? ' <span class="perm-custom" title="Custom tab switched on for this business in Settings → Customisation">Customisation</span>' : '') + '</label>' + extra;
      }).join('') + '</div>';
    }
    return html + '</div>';
  }
  function banksOf(b){ return bankRecs(b).map(function(r){ return { id:String(r.id), name:r.name || '(unnamed)' }; }); }
  function permSummary(p){
    if(!p || p.access !== CUSTOM) return FULL;
    var n = Object.keys(p.perms).length; return 'Custom access (' + n + ' tab' + (n === 1 ? '' : 's') + ')';
  }

  /* ---------------- user-form draft ---------------- */
  var UF = null;
  function draftFor(u){
    var d = u ? clone(u) : { name:'', email:'', username:'', role:ADMIN, businesses:[], mfa:false };
    delete d.hash; delete d.salt; d.newpw = ''; d.perm = {};
    var all = bizList();
    (d.businesses || []).forEach(function(bid){
      var b = all.find(function(x){ return sameId(x.id, bid); });
      d.perm[String(bid)] = normPerm((b && u && permFor(b, u)) || { access:FULL });
    });
    return d;
  }
  function permTarget(tgt){
    if(tgt === 'pf') return App._permDraft ? App._permDraft.p : null;
    return UF && UF.perm ? UF.perm[String(tgt)] : null;
  }

  /* ---------------- install on App ---------------- */
  function wrap(name, fn){
    var orig = App[name];
    App[name] = function(){ return fn.call(this, orig, Array.prototype.slice.call(arguments)); };
  }
  function denyMsg(what){ return 'You do not have access to ' + what + '. Ask an administrator to change your permissions.'; }
  function say(m){ try{ (global.alert || function(){})(m); }catch(e){} }
  function ask(m,rerun){ try{ if(global.UIModal && global.UIModal.gate) return global.UIModal.gate(m,rerun); return global.confirm ? global.confirm(m) : true; }catch(e){ return true; } }
  /* Buttons whose onclick calls one of fns are removed from a rendered string. */
  function stripButtons(html, fns){
    if(!fns.length || typeof html !== 'string') return html;
    var re = new RegExp('<button\\b[^>]*onclick="[^"]*?App\\.(?:' + fns.join('|') + ')\\([^"]*"[^>]*>[\\s\\S]*?<\\/button>', 'g');
    return html.replace(re, '');
  }
  function stripForLevel(html, lvl){
    if(lvl >= 4) return html;
    var f = ['deleteRecord', 'batchMenu', 'batchDelete', 'batchDeleteRun', 'batchImport'];
    if(lvl < 3) f.push('editRecord');
    if(lvl < 2) f.push('newRecord', 'cloneRecord', 'copyToMenu', 'createFrom');
    return stripButtons(html, f);
  }
  function deniedHtml(title, what){
    return App.crumb(title) + '<div class="card perm-denied"><span class="perm-denied-ico">' + ico('alert', 20) + '</span><div>' + esc(denyMsg(what)) + '</div></div>';
  }
  function roWrap(html){
    var head = '', body = html, i = html.indexOf('<div class="ws-crumb">');
    if(i === 0){ var end = html.indexOf('</div></div>'); if(end > 0){ head = html.slice(0, end + 12); body = html.slice(end + 12); } }
    return head + '<div class="perm-ro-note">View only — your permissions do not allow changes on this page.</div>' +
      '<fieldset class="perm-ro" disabled>' + body + '</fieldset>';
  }

  var API = {
    /* ---------- contract helpers (used by other modules) ---------- */
    currentUser:function(){ return currentUser(); },
    realUser:function(){ return realUser(); },
    isAdminUser:function(u){ return isAdmin(u === undefined ? currentUser() : u); },
    permLevel:function(b, label){ return permLevel(b, label); },
    canCreate:function(b, label){ return permLevel(b, label) >= 2; },
    canEdit:function(b, label){ return permLevel(b, label) >= 3; },
    canDelete:function(b, label){ return permLevel(b, label) >= 4; },
    settingLevel:function(b, key){ return settingLevel(b, key); },
    canSetting:function(b, key, need){ return settingLevel(b, key) >= (need || 1); },
    reportLevel:function(b, key){ return reportLevel(b, key); },
    bankAllowed:function(b, ref){ return bankAllowed(b, ref); },
    visibleBusinesses:function(){ var ids = userBizIds(currentUser()); return bizList().filter(function(b){ return ids.some(function(x){ return sameId(x, b.id); }); }); },
    canOpenBusiness:function(id){ return canOpenBusiness(id); },

    /* ---------- replaces the old flat model (kept names, new meaning) ---------- */
    myPermissions:function(b){ return myPerm(b); },
    isHidden:function(b, label){
      if(label !== 'Summary' && label !== 'Dashboard' && this.hiddenSections(b).indexOf(label) >= 0) return true;
      return permLevel(b, label) < 1;
    },
    /* true when the current user can't create anything in the open section */
    isReadOnly:function(b){ return permLevel(b || this.curBiz(), this.wsSection) < 2; },
    guardWrite:function(b, need){
      b = b || this.curBiz(); need = need || (this.editingId != null ? 3 : 2);
      if(permLevel(b, this.wsSection) >= need) return true;
      say('Your permissions do not allow ' + (need >= 4 ? 'deleting' : need >= 3 ? 'changing' : 'creating') + ' ' +
        (this.wsSection || 'records') + '. Ask an administrator to change them in Settings → User Permissions.');
      return false;
    },

    /* ---------- auth screens ---------- */
    async authBoot(){
      try{ await migrateUsers(); migratePermissions(); }
      catch(e){ this._authMsg = { error:'Could not prepare user accounts: ' + ((e && e.message) || e) }; }
      this._authReady = true;
      var p = DB.get(DB.k.session, null);
      /* a session from before this change: {name,user} with no id — keep them signed in */
      if(p && !p.sid && (p.user || p.name)){
        var lu = userByName(p.user) || userByName(p.name);
        if(lu){ try{ startSession(lu.id); }catch(e){} } else { try{ localStorage.removeItem(DB.k.session); }catch(e){} }
      }
      if(sessionValid()){ this.current = pointer(); touchSession(); this.enterApp(); }
      else { if(pointer()){ try{ localStorage.removeItem(DB.k.session); }catch(e){} } this.current = null; this.showAuth(); }
    },
    showAuth:function(){
      var app = byId('app'), au = byId('auth');
      if(app) app.classList.add('hide'); if(au) au.classList.remove('hide');
      this.renderAuth();
    },
    renderAuth:function(){
      var el = byId('authBody'); if(!el) return;
      var m = msgBox(this._authMsg), html;
      var form = function(fn, inner){ return '<form class="ua-auth" data-enter-nav="off" autocomplete="on" onsubmit="event.preventDefault();App.' + fn + '()">' + inner + '</form>'; };
      var pend = this._authPending;
      if(!users().length){
        html = '<h2 class="ua-auth-t">Create administrator</h2><p class="ua-hint">No users exist yet. Create the first administrator account.</p>' + m +
          form('submitSetup', '<label class="fld" for="suName">Name</label><input id="suName" type="text" placeholder="Unnamed" autocomplete="name">' +
            '<label class="fld" for="auUser">Username</label><input id="auUser" type="text" autocomplete="username">' +
            '<label class="fld" for="auPass">Password</label><input id="auPass" type="password" autocomplete="new-password">' +
            '<label class="fld" for="auConfirm">Confirm password</label><input id="auConfirm" type="password" autocomplete="new-password">' +
            '<button class="btn btn-primary" type="submit" id="authBtn">Create</button>');
      } else if(pend){
        var pu = userById(pend.userId) || {};
        var code = '<label class="fld" for="auCode">' + (pend.setup ? 'Code' : 'Enter the 6-digit code from your authenticator app') + '</label>' +
          '<input id="auCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" class="ua-code">' +
          '<button class="btn btn-primary" type="submit" id="authBtn">Verify</button>' +
          '<div class="auth-foot"><a onclick="App.cancelMfa()">Cancel</a></div>';
        html = pend.setup
          ? '<h2 class="ua-auth-t">Set up multi-factor authentication</h2>' + m +
            '<p class="ua-hint">Add this key to an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code.</p>' +
            '<div class="ua-token" id="mfaSecret">' + esc(pend.secret) + '</div><p class="ua-hint ua-uri">' + esc(otpauthUri(pu.username || '', pend.secret)) + '</p>' + form('submitMfa', code)
          : '<h2 class="ua-auth-t">Multi-factor authentication</h2>' + m + form('submitMfa', code);
      } else if(this._authView === 'signup' && signupAllowed()){
        var d = this._signupDraft || {}, cur = d.country || 'United Arab Emirates', opts = countryOptions();
        if(opts.indexOf(cur) < 0) opts.unshift(cur);
        var fv = function(k){ return d[k] ? ' value="' + esc(d[k]) + '"' : ''; };
        html = '<h2 class="ua-auth-t">Create your account</h2><p class="ua-hint">Sign up to start your own business file.</p>' + m +
          form('submitSignup', '<label class="fld" for="sgName">Full name</label><input id="sgName" type="text" autocomplete="name"' + fv('name') + '>' +
            '<label class="fld" for="sgEmail">Email</label><input id="sgEmail" type="email" autocomplete="email"' + fv('email') + '>' +
            '<label class="fld" for="auUser">Username</label><input id="auUser" type="text" autocomplete="username"' + fv('username') + '>' +
            '<label class="fld" for="auPass">Password</label><input id="auPass" type="password" autocomplete="new-password" placeholder="At least 6 characters">' +
            '<label class="fld" for="auConfirm">Confirm password</label><input id="auConfirm" type="password" autocomplete="new-password">' +
            '<label class="fld" for="sgBiz">Business / company name</label><input id="sgBiz" type="text" autocomplete="organization"' + fv('business') + '>' +
            '<label class="fld" for="sgCountry">Country</label><select id="sgCountry" autocomplete="country-name">' +
              opts.map(function(c){ return '<option' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
            '<button class="btn btn-primary" type="submit" id="authBtn">Create account</button>' +
            '<div class="auth-foot">Already have an account? <a href="#" onclick="event.preventDefault();App.showLogin()">Back to login</a></div>');
      } else {
        this._authView = null;
        html = '<h2 class="ua-auth-t">Login</h2>' + m +
          form('submitAuth', '<label class="fld" for="auUser">Username</label><input id="auUser" type="text" autocomplete="username">' +
            '<label class="fld" for="auPass">Password</label><input id="auPass" type="password" autocomplete="current-password">' +
            '<button class="btn btn-primary" type="submit" id="authBtn">Login</button>' +
            (signupAllowed() ? '<div class="auth-foot" id="signupLink">Don\'t have an account? <a href="#" onclick="event.preventDefault();App.showSignup()">Create one</a></div>' : ''));
      }
      el.innerHTML = html; this._authMsg = null;
      /* a sign up that came back with an error keeps what was typed: start at the first empty field */
      try{
        var f = el.querySelector && el.querySelector('input');
        if(this._authView === 'signup' && el.querySelectorAll) f = Array.prototype.find.call(el.querySelectorAll('input'), function(x){ return !x.value; }) || f;
        if(f && f.focus) f.focus();
      }catch(e){}
    },
    _val:function(id){ var e = byId(id); return e ? e.value : ''; },
    _busy:function(on){ var b = byId('authBtn'); if(b) b.disabled = !!on; },
    async submitSetup(){
      this._busy(true);
      var r = await createFirstAdmin({ name:this._val('suName'), username:this._val('auUser'), password:this._val('auPass'), confirm:this._val('auConfirm') });
      this._busy(false);
      if(!r.ok){ this._authMsg = { error:r.error }; return this.renderAuth(); }
      this.enterApp();
    },
    async submitAuth(){
      this._busy(true);
      var name = this._val('auUser');
      var r = await login(name, this._val('auPass'));
      this._busy(false);
      if(r.mfa){ this._authPending = r.pending; return this.renderAuth(); }
      if(!r.ok){ this._authMsg = { error:r.error }; this.renderAuth(); var u = byId('auUser'), pw = byId('auPass');
        if(u) u.value = name; if(name && pw && pw.focus) pw.focus(); return; }
      this._authPending = null; this.enterApp();
    },
    async submitMfa(){
      this._busy(true);
      var r = await completeMfa(this._authPending, this._val('auCode'));
      this._busy(false);
      if(!r.ok){ this._authMsg = { error:r.error }; return this.renderAuth(); }
      this._authPending = null; this.enterApp();
    },
    cancelMfa:function(){ this._authPending = null; this.renderAuth(); },
    showSignup:function(){
      if(!signupAllowed()){ this._authView = null; this._authMsg = { error:'Sign up is turned off. Ask an administrator to create an account for you.' }; return this.renderAuth(); }
      this._authView = 'signup'; this._signupDraft = null; this._authMsg = null; this.renderAuth();
    },
    showLogin:function(){ this._authView = null; this._signupDraft = null; this._authMsg = null; this.renderAuth(); },
    async submitSignup(){
      if(this._signupBusy) return;   // double submit (Enter + click) while hashing
      var v = { name:this._val('sgName'), email:this._val('sgEmail'), username:this._val('auUser'), password:this._val('auPass'),
        confirm:this._val('auConfirm'), business:this._val('sgBiz'), country:this._val('sgCountry') };
      this._signupBusy = true; this._busy(true);
      var r;
      try{ r = await signup(v); } finally { this._signupBusy = false; this._busy(false); }
      if(!r.ok){
        /* keep what was typed (never the passwords) */
        this._signupDraft = { name:v.name, email:v.email, username:v.username, business:v.business, country:v.country };
        this._authMsg = { error:r.error }; if(!signupAllowed()) this._authView = null; return this.renderAuth();
      }
      this._authView = null; this._signupDraft = null; this._authPending = null;
      this.enterApp();   // a restricted user with one business opens it straight away
      if(r.business && this.openBiz == null) this.openBusiness(r.business.id);
    },
    logout:function(){
      var p = pointer(); if(p) endSession(p.sid);
      try{ localStorage.removeItem(DB.k.session); }catch(e){}
      this.current = null; this._authPending = null; this.openBiz = null; this._authView = null;
      this.showAuth();
    },

    /* ---------- impersonation ---------- */
    impersonate:function(id){
      var me = realUser(), u = userById(id);
      if(!isAdmin(me) || !u || sameId(u.id, me.id)) return;
      patchSession({ imp:u.id }); this.openBiz = null; this._usersMsg = null; this.go('businesses');
    },
    stopImpersonate:function(){ patchSession({ imp:'' }); this.openBiz = null; this.go('users'); },

    /* ---------- Users page ---------- */
    renderUsers:function(){
      var el = byId('usersBody'); if(!el) return;
      var me = realUser(), B = bizList();
      var U = users().slice().sort(function(a, b){ return (isAdmin(b) - isAdmin(a)) || String(a.name || a.username).localeCompare(String(b.name || b.username)); });
      var rows = U.map(function(u){
        var adm = isAdmin(u), bz = (u.businesses || []).filter(function(id){ return B.some(function(b){ return sameId(b.id, id); }); });
        var tree = adm ? '' : '<div class="mu-tree">' + (bz.length ? bz.map(function(id){
          var b = B.find(function(x){ return sameId(x.id, id); });
          return '<div><a onclick="App.openBusiness(' + arg(b.id) + ')">' + esc(b.name) + '</a></div>'; }).join('') : '<div><span>No businesses</span></div>') + '</div>';
        var mine = me && sameId(me.id, u.id);
        return '<tr class="urow' + (adm ? ' adm' : '') + '"><td class="mu-ic">' + ico('user', 18) + '</td>' +
          '<td><a class="mu-nm" onclick="App.editUser(' + arg(u.id) + ')">' + esc(u.name || 'Unnamed') + '</a><span class="mu-un">' + esc(u.username) + '</span>' +
          (mine ? ' <span class="pill pill-user">you</span>' : '') + (u.mfa ? ' <span class="pill pill-user" title="Multi-factor authentication enforced">MFA</span>' : '') +
          (!u.hash ? ' <span class="pill pill-user" title="Set a password to let this user log in">no password</span>' : '') + tree + '</td>' +
          '<td class="mu-r">' + (adm ? '<span class="mu-role">Administrator</span>' :
            '<button class="mu-btn" onclick="App.impersonate(' + arg(u.id) + ')"' + (mine ? ' disabled' : '') + '>Impersonate</button>') + '</td></tr>';
      }).join('');
      el.innerHTML = '<div class="mu">' + msgBox(this._usersMsg) +
        '<div class="mu-h"><span class="mu-t">Users</span><button class="btn btn-primary btn-sm" onclick="App.showNewUser()">New User</button></div>' +
        '<table class="mu-tbl"><tbody>' + (rows || '<tr><td colspan="3" class="ua-hint">No users.</td></tr>') + '</tbody></table>' +
        '<div class="mu-opt"><div class="mu-opt-txt"><label for="muSignup">Allow sign up from the login screen</label>' +
          '<div class="ua-hint">New people can create an account with a business of their own. They get the Restricted user role and see only that business.</div></div>' +
          '<label class="mu-switch"><input type="checkbox" id="muSignup" role="switch"' + (signupAllowed() ? ' checked' : '') +
          ' onchange="App.setAllowSignup(this.checked)"><span class="mu-knob"></span></label></div></div>';
      this._usersMsg = null;
    },
    setAllowSignup:function(on){
      if(!isAdmin(realUser())){ say('Only administrators can change this.'); return this.renderUsers(); }
      setSignupAllowed(on);
      this._usersMsg = { info:on ? 'Sign up is on: the login screen shows “Create one”.' : 'Sign up is off: only administrators can create accounts.' };
      this.renderUsers();
    },
    showNewUser:function(){ UF = draftFor(null); this._ufMsg = null; this.go('newUser'); this.renderUserForm(); },
    editUser:function(id){ var u = userById(id); if(!u) return; UF = draftFor(u); this._ufMsg = null; this.go('newUser'); this.renderUserForm(); },
    ufSet:function(k, v, redraw){ if(!UF) return; UF[k] = v; if(k === 'role' && v === RESTRICTED) UF.businesses = UF.businesses || []; if(redraw) this.renderUserForm(); },
    ufBiz:function(id, on){
      if(!UF || id === '' || id == null) return;
      UF.businesses = (UF.businesses || []).filter(function(x){ return !sameId(x, id); }); UF.perm = UF.perm || {};
      var b = bizList().find(function(x){ return sameId(x.id, id); }); if(!b) return;
      if(on){
        UF.businesses.push(b.id);
        if(!UF.perm[String(b.id)]){ var u = UF.id ? userById(UF.id) : null; UF.perm[String(b.id)] = normPerm((u && permFor(b, u)) || { access:FULL }); }
      } else delete UF.perm[String(b.id)];
      this.renderUserForm();
    },
    resetMfa:function(id){
      saveUsers(users().map(function(x){ if(!sameId(x.id, id)) return x; var y = Object.assign({}, x); delete y.totpSecret; return y; }));
      if(UF && sameId(UF.id, id)) delete UF.totpSecret;
      this._ufMsg = { info:'Authenticator reset. The user will set it up again at next login.' }; this.renderUserForm();
    },
    renderUserForm:function(){
      var el = byId('userFormBody'); if(!el || !UF) return;
      var u = UF, B = bizList(), restricted = u.role === RESTRICTED;
      var inp = function(label, k, type, extra){
        return '<label class="fld" for="uf_' + k + '">' + label + '</label><input id="uf_' + k + '" type="' + (type || 'text') + '" value="' + esc(u[k] || '') + '"' + (extra || '') +
          ' oninput="App.ufSet(\'' + k + '\',this.value)">'; };
      var html = '<div class="card uf-card' + (restricted ? ' wide' : '') + '"><h2>' + (u.id ? 'Edit User' : 'New User') + '</h2>' + msgBox(this._ufMsg) +
        '<form id="ufForm" data-enter-nav="off" autocomplete="off" onsubmit="event.preventDefault();App.saveUser()">' +
        inp('Name', 'name', 'text', ' placeholder="Unnamed"') + inp('Email address', 'email', 'email') + inp('Username', 'username') +
        inp('Password', 'newpw', 'password', ' autocomplete="new-password"' + (u.id ? ' placeholder="************"' : '')) +
        '<label class="fld" for="uf_role">Role</label><select id="uf_role" onchange="App.ufSet(\'role\',this.value,1)">' +
          [ADMIN, RESTRICTED].map(function(r){ return '<option' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>';
      if(restricted){
        var mine = (u.businesses || []).map(function(id){ return B.find(function(b){ return sameId(b.id, id); }); }).filter(Boolean);
        var avail = B.filter(function(b){ return !mine.some(function(x){ return sameId(x.id, b.id); }); });
        html += '<label class="fld">Businesses</label><div class="ua-tagbox">' +
          mine.map(function(b){ return '<span class="ua-tag">' + esc(b.name) + '<button type="button" title="Remove" aria-label="Remove ' + esc(b.name) + '" onclick="App.ufBiz(' + arg(b.id) + ',false)">×</button></span>'; }).join('') +
          (avail.length ? '<select class="ua-tag-add" aria-label="Add business" onchange="if(this.value){App.ufBiz(JSON.parse(this.value),true)}"><option value="">Add business…</option>' +
            avail.map(function(b){ return '<option value="' + esc(JSON.stringify(b.id)) + '">' + esc(b.name) + '</option>'; }).join('') + '</select>' : '') + '</div>' +
          (mine.length ? '' : '<div class="ua-hint">A restricted user only sees the businesses listed here.</div>');
        mine.forEach(function(b){
          var k = String(b.id); if(!u.perm[k]) u.perm[k] = normPerm({ access:FULL });
          html += '<fieldset class="perm-biz"><legend>' + esc(b.name) + '</legend>' + permEditor(u.perm[k], k, banksOf(b)) + '</fieldset>';
        });
      }
      html += '<label class="chk"><input type="checkbox"' + (u.mfa ? ' checked' : '') + ' onchange="App.ufSet(\'mfa\',this.checked)">Enforce multi-factor authentication</label>';
      if(u.id && u.totpSecret) html += '<div class="uf-reveal"><button type="button" class="btn btn-sm" onclick="App.resetMfa(' + arg(u.id) + ')">Reset authenticator</button>' +
        '<span class="ua-hint">User will set it up again at next login.</span></div>';
      html += '<div class="form-actions">' + (u.id
          ? '<button class="btn btn-primary" type="submit">Update</button><button class="btn btn-danger" type="button" onclick="App.removeUser(' + arg(u.id) + ')">Delete</button>'
          : '<button class="btn btn-primary" type="submit">Create</button>') +
        '<button class="btn" type="button" onclick="App.go(\'users\')">Cancel</button></div></form></div>';
      el.innerHTML = html; this._ufMsg = null;
    },
    async saveUser(){
      if(!UF) return;
      var r = await saveUser(UF);
      if(!r.ok){ this._ufMsg = { error:r.error }; return this.renderUserForm(); }
      this._usersMsg = { info:r.created ? 'User created.' : 'User updated.' }; UF = null;
      this._paintUsersChrome(); this.go('users');
    },
    /* kept name: the old list's Remove button called this */
    removeUser:function(id){
      var u = userById(id); if(!u) return;
      var self=this; if(!ask('Delete user “' + (u.name || u.username) + '”?', function(){ self.removeUser(id); })) return;
      var r = deleteUser(id);
      if(!r.ok){ if(UF){ this._ufMsg = { error:r.error }; this.renderUserForm(); } else say(r.error); return; }
      UF = null; this._usersMsg = { info:'User deleted.' }; this.go('users');
    },
    createUser:function(){ this.saveUser(); },

    /* ---------- Profile ---------- */
    renderProfile:function(){
      var el = byId('profileBody'); if(!el) return;
      var me = realUser(); if(!me){ el.innerHTML = ''; return; }
      var p = pointer() || {}, mine = sessions().filter(function(s){ return sameId(s.userId, me.id); });
      el.innerHTML = '<div class="card prof-card"><h2>' + esc(me.name || me.username) + '</h2>' + msgBox(this._profMsg) +
        '<form data-enter-nav="off" autocomplete="off" onsubmit="event.preventDefault();App.saveProfile()">' +
        '<label class="fld" for="pf_user">Username</label><input id="pf_user" type="text" value="' + esc(me.username) + '" autocomplete="username">' +
        '<label class="fld" for="pf_cur">Current password</label><input id="pf_cur" type="password" autocomplete="current-password" placeholder="Required to make changes">' +
        '<label class="fld" for="pf_new">Password</label><input id="pf_new" type="password" autocomplete="new-password" placeholder="************">' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Update</button></div></form>' +
        '<h3 class="prof-h">Where You Are Logged In</h3>' +
        '<table class="tbl prof-sessions"><tbody>' + mine.map(function(s){
          var here = s.id === p.sid;
          return '<tr><td>' + (here ? '<b>This Computer</b><br>' : '') + esc(s.device || 'Unknown device') +
            '<div class="ua-hint">since ' + esc(new Date(s.created).toLocaleString()) + '</div></td>' +
            '<td class="r"><button class="btn btn-sm" onclick="App.endSessionUI(' + arg(s.id) + ')">Logout</button></td></tr>'; }).join('') + '</tbody></table>' +
        (mine.length > 1 ? '<button class="btn btn-sm prof-others" onclick="App.logoutOthers()">Logout all other devices</button>' : '') + '</div>';
      this._profMsg = null;
    },
    async saveProfile(){
      var r = await changeProfile({ username:this._val('pf_user'), current:this._val('pf_cur'), password:this._val('pf_new') });
      this._profMsg = r.ok ? { info:r.passwordChanged ? 'Password changed. Other devices were logged out.' : 'Profile updated.' } : { error:r.error };
      this._paintUsersChrome(); this.renderProfile();
    },
    endSessionUI:function(id){ var p = pointer(); if(p && p.sid === id) return this.logout(); endSession(id); this.renderProfile(); },
    logoutOthers:function(){
      var me = realUser(), keep = (pointer() || {}).sid; if(!me) return;
      saveSessions(sessions().filter(function(s){ return !sameId(s.userId, me.id) || s.id === keep; }));
      this._profMsg = { info:'Other devices logged out.' }; this.renderProfile();
    },

    /* ---------- header chrome ---------- */
    _paintUsersChrome:function(view){
      var u = currentUser(), ru = realUser(), s = currentSession(), adm = isAdmin(u);
      var tu = byId('tabUsers'); if(tu) tu.classList.toggle('hide', !!this._authReady && !adm);
      var tp = byId('tabProfile'); if(tp && view !== undefined) tp.classList.toggle('active', view === 'profile');
      var pn = byId('tbProfileName'); if(pn) pn.textContent = (ru && (ru.name || ru.username)) || 'Profile';
      var nm = (u && (u.name || u.username)) || 'User';
      var av = byId('hdAvatar'); if(av) av.textContent = String(nm).trim().slice(0, 1).toUpperCase();
      var un = byId('hdUserName'); if(un) un.textContent = nm;
      var ur = byId('hdUserRole'); if(ur) ur.textContent = (u && u.role) || 'Administrator';
      var bar = byId('impBar');
      if(bar){
        var on = !!(s && s.imp && u);
        bar.classList.toggle('hide', !on);
        bar.innerHTML = on ? '<span>Impersonating <b>' + esc(u.name || u.username) + '</b> (signed in as ' + esc(ru ? ru.name || ru.username : '') + ')</span>' +
          '<button class="btn btn-xs" onclick="App.stopImpersonate()">Stop impersonating</button>' : '';
      }
      var adminOnly = ['addDd', 'removeBtn'];
      adminOnly.forEach(function(id){ var e = byId(id); if(e) e.classList.toggle('hide', !!App._authReady && !adm); });
    },

    /* ---------- Settings > User Permissions ---------- */
    set_permissions:function(b){
      var d = this._permDraft;
      if(d && d.bizId != null && !sameId(d.bizId, b.id)) d = this._permDraft = null;
      if(d){
        var u = userById(d.userId) || { username:d.username || '', name:'' };
        return this.crumb('Settings', 'User Permissions') + '<div class="card perm-card"><h2>User Permissions — ' + esc(u.name || u.username) + '</h2>' +
          '<div id="permErr">' + msgBox(d.msg) + '</div>' +
          '<label class="fld">Username</label><input type="text" value="' + esc(u.username) + '" disabled>' +
          permEditor(d.p, 'pf', banksOf(b)) +
          '<div class="form-actions"><button class="btn btn-primary" onclick="App.permSave()">Update</button>' +
          '<button class="btn" onclick="App.permEdit(null)">Cancel</button>' +
          (b.userPermissions && b.userPermissions[d.userId] ? '<button class="btn btn-danger" onclick="App.permReset()">Delete</button>' : '') + '</div></div>';
      }
      var list = users();
      var assigned = list.filter(function(u){ return !isAdmin(u) && (u.businesses || []).some(function(x){ return sameId(x, b.id); }); });
      var orphans = Object.keys(b.userPermissions || {}).filter(function(id){ return !assigned.some(function(u){ return sameId(u.id, id); }); });
      var row = function(u, issue){
        var p = permFor(b, u);
        return '<tr><td class="act"><button class="btn btn-xs" onclick="App.permEdit(' + arg(u.id) + ')">Edit</button></td>' +
          '<td>' + esc(u.username) + '</td><td>' + esc(u.name || '') + '</td><td>' + esc(p && p.access === CUSTOM ? CUSTOM : FULL) + '</td>' +
          '<td>' + (issue ? '<span class="perm-warn">' + esc(issue) + '</span>' : '<span class="ua-hint">' + esc(permSummary(p)) + '</span>') + '</td></tr>';
      };
      var rows = assigned.map(function(u){ return row(u, ''); }).join('') +
        orphans.map(function(id){ var u = userById(id); if(!u) return '';
          return row(u, isAdmin(u) ? 'Administrator — permissions not applied' : 'Not assigned to this business'); }).join('');
      var inner = '<div class="info-bar">Administrators can open every business with full access. A restricted user only sees the businesses assigned to them in <b>Users</b>; ' +
        'a user without a permissions record has <b>Full access</b> to an assigned business. Choose <b>Custom access</b> to pick tabs, reports, settings pages and bank accounts with ' +
        'View / Create / Update / Delete levels.</div>' +
        '<table class="reg-tbl perm-tbl"><thead><tr><th class="act"></th><th>Username</th><th>Name</th><th>Access type</th><th>Details</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5"><div class="reg-empty">No restricted users are assigned to this business yet — add them from the Users tab in the top bar.</div></td></tr>') +
        '</tbody></table>';
      return this.crumb('Settings', 'User Permissions') + '<div class="card"><h2>User Permissions</h2>' + inner +
        '<div class="form-actions"><button class="btn" onclick="App.settingsBack()">Back to Settings</button></div></div>';
    },
    permEdit:function(userId){
      var b = this.curBiz();
      if(userId == null){ this._permDraft = null; }
      else { var u = userById(userId); if(!u || !b) return;
        this._permDraft = { bizId:b.id, userId:u.id, username:u.username, p:normPerm(permFor(b, u) || { access:CUSTOM }) }; }
      this.renderMain(b);
    },
    permEd:function(tgt, op, a, b2, c){
      var P = permTarget(tgt); if(!P) return;
      if(op === 'access') P.access = a;
      else if(op === 'tab'){
        if(b2) P.perms[a] = P.perms[a] || LEVELS[0];
        else { delete P.perms[a]; if(a === 'Bank and Cash Accounts') P.banks = []; if(a === 'Reports') P.reports = {}; if(a === 'Settings') P.settings = {}; }
      }
      else if(op === 'level'){ (a === 'perms' ? P.perms : P[a])[b2] = c; return; }   // no redraw: keeps focus
      else if(op === 'bank'){ a = String(a); P.banks = P.banks.filter(function(x){ return x !== a; }); if(b2) P.banks.push(a); }
      else if(op === 'sub'){ if(c) P[a][b2] = P[a][b2] || LEVELS[0]; else delete P[a][b2]; }
      if(tgt === 'pf') this.renderMain(this.curBiz()); else this.renderUserForm();
    },
    permSave:function(){
      var d = this._permDraft, b = this.curBiz(); if(!d || !b) return;
      var E = permErrors(d.p); if(E.length){ d.msg = { error:E.join(' ') }; return this.renderMain(b); }
      var p = cleanPerm(clone(d.p)); b.userPermissions = b.userPermissions || {};
      if(p.access === FULL) delete b.userPermissions[d.userId]; else b.userPermissions[d.userId] = Object.assign({ username:d.username }, p);
      this.saveBiz(b); this._permDraft = null; this.renderMain(b);
    },
    permReset:function(){
      var d = this._permDraft, b = this.curBiz(); if(!d || !b) return;
      var self=this; if(!ask('Delete these user permissions? The user will have full access to this business.', function(){ self.permReset(); })) return;
      if(b.userPermissions) delete b.userPermissions[d.userId];
      this.saveBiz(b); this._permDraft = null; this.renderMain(b);
    },
  };

  function install(){
    rawTiles = App.setTiles;
    Object.assign(App, API);

    /* ---- top-level navigation ---- */
    wrap('go', function(orig, a){
      var view = a[0];
      if(this._authReady && !sessionValid()){ this.current = null; return this.showAuth(); }
      if(this._authReady) touchSession();
      if((view === 'users' || view === 'newUser') && this._authReady && !isAdmin(currentUser())) view = 'businesses';
      if((view === 'create') && this._authReady && !isAdmin(currentUser())) view = 'businesses';
      var pp = byId('pageProfile'); if(pp) pp.classList.add('hide');
      var r = orig.call(this, view);
      if(view === 'profile'){ if(pp) pp.classList.remove('hide'); this.renderProfile(); }
      this._paintUsersChrome(view);
      return r;
    });
    wrap('enterApp', function(orig, a){
      var r = orig.apply(this, a); this._paintUsersChrome('businesses');
      var u = currentUser();
      if(u && !isAdmin(u)){ var ids = userBizIds(u); if(ids.length === 1) this.openBusiness(ids[0]); }
      return r;
    });
    wrap('_paintChrome', function(orig, a){ var r = orig.apply(this, a); try{ this._paintUsersChrome(); }catch(e){} return r; });

    /* ---- business assignment ---- */
    wrap('renderBusinesses', function(orig, a){
      var r = orig.apply(this, a), u = currentUser();
      if(this._authReady && u && !isAdmin(u) && !userBizIds(u).length){
        var w = byId('bizListWrap'); if(w) w.innerHTML = '<div class="empty"><div class="big">No businesses</div>No businesses have been assigned to you. Ask an administrator.</div>';
      }
      this._paintUsersChrome();
      return r;
    });
    wrap('openBusiness', function(orig, a){
      if(!canOpenBusiness(a[0])){ say('You do not have access to this business.'); return; }
      var r = orig.apply(this, a), b = this.curBiz();
      if(b && permLevel(b, 'Summary') < 1){
        var first = firstAllowed(b);
        if(first) this.selectSection(first);
        else { var m = byId('wsMain'); if(m) m.innerHTML = deniedHtml(b.name, 'any section of this business'); }
      }
      return r;
    });
    var adminOnly = function(orig, a){ var u = currentUser(); if(this._authReady && u && !isAdmin(u)){ say('Only administrators can add or remove businesses.'); return; } return orig.apply(this, a); };
    ['showCreate', 'createBusiness', 'importBusiness'].forEach(function(n){ if(typeof App[n] === 'function') wrap(n, adminOnly); });
    wrap('removeSelected', function(orig, a){
      var before = bizList().map(function(b){ return b.id; });
      var r = adminOnly.call(this, orig, a);
      var after = bizList().map(function(b){ return b.id; });
      var gone = before.filter(function(id){ return after.indexOf(id) < 0; });
      if(gone.length) saveUsers(users().map(function(u){ return Array.isArray(u.businesses)
        ? Object.assign({}, u, { businesses:u.businesses.filter(function(x){ return !gone.some(function(g){ return sameId(g, x); }); }) }) : u; }));
      return r;
    });

    /* ---- tabs ---- */
    wrap('selectSection', function(orig, a){
      var b = this.curBiz();
      if(b && permLevel(b, a[0]) < 1){ say(denyMsg(a[0])); return; }
      return orig.apply(this, a);
    });
    wrap('renderMain', function(orig, a){
      var r = orig.apply(this, a), m = byId('wsMain'), b = a[0];
      if(m && m.classList && b){
        var lvl = LABEL2KEY[this.wsSection] ? permLevel(b, this.wsSection) : 4;
        m.classList.toggle('perm-nocreate', lvl < 2); m.classList.toggle('perm-noedit', lvl < 3); m.classList.toggle('perm-nodelete', lvl < 4);
      }
      return r;
    });
    var secLevel = function(self){ var b = self.curBiz(); return b ? permLevel(b, self.wsSection) : 4; };
    ['listHtml', 'tableHtml', 'viewHtml', 'formHtml'].forEach(function(n){
      if(typeof App[n] !== 'function') return;
      wrap(n, function(orig, a){
        var b = a[0] || this.curBiz();
        if(n === 'listHtml' && b && permLevel(b, this.wsSection) < 1) return deniedHtml(this.wsSection, this.wsSection);
        return stripForLevel(orig.apply(this, a), b ? permLevel(b, this.wsSection) : 4);
      });
    });
    wrap('sortedRecords', function(orig, a){
      var rows = orig.apply(this, a), b = a[0], key = LABEL2KEY[this.wsSection];
      if(!myPerm(b)) return rows;
      return rows.filter(function(r){ return rowVisible(b, key, r); });
    });
    wrap('newRecord', function(orig, a){ if(secLevel(this) < 2){ say('Your permissions do not allow creating ' + this.wsSection + '.'); return; } return orig.apply(this, a); });
    wrap('cloneRecord', function(orig, a){ if(secLevel(this) < 2){ say('Your permissions do not allow creating ' + this.wsSection + '.'); return; } return orig.apply(this, a); });
    wrap('editRecord', function(orig, a){
      var b = this.curBiz(), rec = b ? (this.records(b) || []).find(function(r){ return sameId(r.id, a[0]); }) : null;
      if(b && rec && !rowVisible(b, LABEL2KEY[this.wsSection], rec)){ say(denyMsg('this record')); return; }
      if(secLevel(this) < 3) return this.viewRecord(a[0]);   // read-only view instead of the form
      return orig.apply(this, a);
    });
    wrap('viewRecord', function(orig, a){
      var b = this.curBiz(), rec = b ? (this.records(b) || []).find(function(r){ return sameId(r.id, a[0]); }) : null;
      if(b && rec && !rowVisible(b, LABEL2KEY[this.wsSection], rec)){ say(denyMsg('this record')); return; }
      return orig.apply(this, a);
    });
    wrap('deleteRecord', function(orig, a){ if(secLevel(this) < 4){ say('Your permissions do not allow deleting ' + this.wsSection + '.'); return; } return orig.apply(this, a); });
    ['batchMenu', 'batchDelete', 'batchDeleteRun', 'batchImport', 'batchRun'].forEach(function(n){
      if(typeof App[n] !== 'function') return;
      wrap(n, function(orig, a){ if(secLevel(this) < 4){ say('Batch operations need full (View, Create, Update, Delete) access to ' + this.wsSection + '.'); return; } return orig.apply(this, a); });
    });
    wrap('createFrom', function(orig, a){
      var b = this.curBiz(); if(b && permLevel(b, a[0]) < 2){ say('Your permissions do not allow creating ' + a[0] + '.'); return; }
      return orig.apply(this, a);
    });
    wrap('createEntityRecord', function(orig, a){
      var b = this.curBiz(), label = KEY2LABEL[a[0]];
      if(b && label && permLevel(b, label) < 2) return { ok:false, error:'Your permissions do not allow creating ' + label + '.' };
      return orig.apply(this, a);
    });

    /* ---- settings ---- */
    wrap('setTiles', function(orig, a){
      var t = orig.apply(this, a), b = this.openBiz != null ? this.curBiz() : null;
      if(!b || !myPerm(b)) return t;
      return t.filter(function(x){ return settingLevel(b, x[2]) >= 1; });
    });
    wrap('openSetting', function(orig, a){
      var b = this.curBiz(); if(b && settingLevel(b, a[0]) < 1){ say(denyMsg('this settings page')); return; }
      return orig.apply(this, a);
    });
    wrap('settingsHtml', function(orig, a){
      var b = a[0], key = this.setView;
      if(b && key){
        var lv = settingLevel(b, key);
        var name = ((rawTiles.call(this) || []).find(function(t){ return t[2] === key; }) || [])[1] || 'this settings page';
        if(lv < 1) return deniedHtml('Settings', name);
        var html = orig.apply(this, a);
        return lv < 3 ? roWrap(html) : html;
      }
      return orig.apply(this, a);
    });

    /* ---- reports ---- */
    wrap('openReport', function(orig, a){
      var b = this.curBiz(); if(b && reportLevel(b, a[0]) < 1){ say(denyMsg('this report')); return; }
      return orig.apply(this, a);
    });
    wrap('reportsHtml', function(orig, a){
      var b = a[0], v = this.repView;
      if(b && v && reportLevel(b, v) < 1) return deniedHtml('Reports', ((this._REPDEF || {})[v] || {}).name || 'this report');
      var html = orig.apply(this, a);
      if(!b || v || !myPerm(b)) return html;
      return html.replace(/<a class="rep-link" onclick="App\.openReport\('([^']+)'\)">[\s\S]*?<\/a>/g, function(m, k){ return reportLevel(b, k) >= 1 ? m : ''; });
    });
  }
  install();

  global.UsersAccess = {
    LEVELS:LEVELS, hashPw:hashPw, b32gen:b32gen, b32dec:b32dec, totp:totp, totpOk:totpOk, otpauthUri:otpauthUri,
    migrateUsers:migrateUsers, migratePermissions:migratePermissions, legacyToPerm:legacyToPerm, normPerm:normPerm,
    permErrors:permErrors, cleanPerm:cleanPerm, permFor:permFor, permTabs:permTabs, reportList:reportList, settingPages:settingPages,
    users:users, sessions:sessions, currentUser:currentUser, realUser:realUser, currentSession:currentSession, sessionValid:sessionValid,
    startSession:startSession, endSession:endSession, userBizIds:userBizIds, rowVisible:rowVisible, firstAllowed:firstAllowed,
    createFirstAdmin:createFirstAdmin, login:login, signup:signup, signupAllowed:signupAllowed, setSignupAllowed:setSignupAllowed,
    countryOptions:countryOptions, completeMfa:completeMfa, saveUser:saveUser, deleteUser:deleteUser,
    changeProfile:changeProfile, draftFor:draftFor, permEditor:permEditor, stripForLevel:stripForLevel, device:device
  };
})(typeof window !== 'undefined' ? window : this);
