/* ============================================================
   AI ASSISTANT ON EVERY PAGE
   Shows the "AI Assistant" button on the dashboard, Users & access and
   Audit Desk. The assistant itself is the CRM assistant, running in a
   small frame (crm/?embed=1) so it can work on the CRM from anywhere.
   ============================================================ */
(function () {
  'use strict';
  if (window.FTAI) return;
  var ROOT = (function () { try { return new URL('../', document.currentScript.src).href; } catch (e) { return location.origin + '/audit-desk/'; } })();
  var frame = null, wrap = null, fab = null, ready = false, queue = [], mounted = false;

  var CSS = '#ftai-fab{position:fixed;right:18px;bottom:18px;z-index:99990;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:linear-gradient(135deg,#0f9d6b,#0b5c9c);color:#fff;font:700 14px/1 "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 28px rgba(11,92,156,.35);cursor:pointer}' +
    '#ftai-fab:hover{filter:brightness(1.07)}#ftai-fab svg{width:18px;height:18px}' +
    '#ftai-wrap{position:fixed;right:18px;bottom:18px;z-index:99991;width:410px;max-width:calc(100vw - 24px);height:min(640px,calc(100vh - 36px));display:none;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(16,24,40,.28);background:#fff}' +
    '#ftai-wrap.open{display:block}#ftai-wrap iframe{width:100%;height:100%;border:0;display:block}' +
    '#ftai-load{position:absolute;inset:0;display:grid;place-items:center;font:14px "Segoe UI",system-ui,sans-serif;color:#14284b;background:#fff}#ftai-load .sp{width:30px;height:30px;border-radius:50%;border:3px solid #cfd8e6;border-top-color:#0f9d6b;animation:ftais .8s linear infinite;margin:0 auto 10px}@keyframes ftais{to{transform:rotate(360deg)}}' +
    '@media (max-width:840px){#ftai-wrap{bottom:64px;height:min(640px,calc(100vh - 76px))}#ftai-fab{bottom:64px}}' +
    '@media (max-width:520px){#ftai-wrap{right:6px;left:6px;width:auto;max-width:none;height:calc(100vh - 72px)}#ftai-fab{right:10px}}';

  function canUse() { return !!(window.FT && FT.me && FT.canOpen(FT.me, 'crm')); }
  function post(msg) { if (ready && frame) frame.contentWindow.postMessage(Object.assign({ft: 1}, msg), location.origin); else queue.push(msg); }

  function build() {
    if (fab) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    fab = document.createElement('button'); fab.id = 'ftai-fab'; fab.type = 'button'; fab.title = 'AI assistant (Ctrl + /)';
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM6 15l.7 2 2 .7-2 .7L6 20.5l-.7-2.1-2-.7 2-.7L6 15z"/></svg>AI Assistant';
    fab.onclick = function () { open(); };
    wrap = document.createElement('div'); wrap.id = 'ftai-wrap'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'AI assistant');
    wrap.innerHTML = '<div id="ftai-load"><div><div class="sp"></div>Starting the assistant…</div></div>';
    document.body.appendChild(fab); document.body.appendChild(wrap);
    document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); wrap.classList.contains('open') ? close() : open(); } });
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data || !ev.data.ft || !frame || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (d.type === 'ready') { ready = true; var l = document.getElementById('ftai-load'); if (l) l.remove(); queue.splice(0).forEach(post); post({type: 'focus'}); }
      if (d.type === 'close') close();
      if (d.type === 'navigate' && d.url) location.href = d.url;
    });
  }
  function load() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.src = ROOT + 'crm/?embed=1';
    frame.setAttribute('allow', 'microphone; autoplay');
    frame.title = 'AI assistant';
    wrap.appendChild(frame);
  }
  function open(text, opts) {
    if (!mounted) return;
    load();
    wrap.classList.add('open'); fab.style.display = 'none';
    if (text) post({type: 'ask', text: text, spoken: !!(opts && opts.spoken)});
    else if (opts && opts.voice) post({type: opts.talk ? 'talk' : 'voice'});
    else post({type: 'focus'});
  }
  function close() { if (!wrap) return; post({type: 'stop'}); wrap.classList.remove('open'); fab.style.display = ''; }

  function mount() {
    if (!canUse()) { unmount(); return false; }
    build(); mounted = true; fab.style.display = wrap.classList.contains('open') ? 'none' : '';
    // start the assistant quietly in the background so the first question is fast
    setTimeout(function () { if (mounted) load(); }, 2500);
    return true;
  }
  function unmount() {
    mounted = false;
    if (wrap) { wrap.classList.remove('open'); if (frame) { frame.remove(); frame = null; } ready = false; queue = []; }
    if (fab) fab.style.display = 'none';
  }
  window.FTAI = {mount: mount, unmount: unmount, open: open, close: close, available: canUse};
})();
