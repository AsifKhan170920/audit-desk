/* ============ Party balance badge on the Receipt / Payment form ==============
   Picking a customer or supplier in "Paid by / Paid to" shows what that party
   currently owes, right beside the field. The figure is not computed here - it
   comes straight from the same functions the ledgers, statements and ageing
   reports use (customerBalance, supplierBalance, employeeBalance, ...), so the
   badge can never disagree with the rest of the app.

   Where the form already posts money for that party, the badge also shows where
   the balance lands once this document is saved.
   ============================================================================ */
(function(global){
  'use strict';

  function app(){ try{ return App; }catch(e){ return global.App || null; } }
  function esc(s){ var A=app(); return A ? A.esc(s==null?'':s) : String(s==null?'':s); }
  function money(n){ var A=app(); try{ return A.money(n); }catch(e){ return (Math.round(n*100)/100).toFixed(2); } }
  /* the business's base currency, the same field the rest of the app reads */
  function cur(b){ return (b && b.baseCurrency) || 'AED'; }

  /* Which engine function owns each party type, and what its sign means.
     `pos` is the wording when the balance runs the usual way round. */
  var KINDS = {
    customer:   { fn:function(b,n){ return customerBalance(b,n); },   pos:'Outstanding',      neg:'Credit' },
    supplier:   { fn:function(b,n){ return supplierBalance(b,n); },   pos:'Payable',          neg:'Prepaid' },
    employee:   { fn:function(b,n){ return employeeBalance(b,n); },   pos:'Owed to employee', neg:'Owed by employee' },
    capital:    { fn:function(b,n){ return capitalBalance(b,n); },    pos:'Capital balance',  neg:'Capital balance' },
    claimPayer: { fn:function(b,n){ return claimPayerBalance(b,n); }, pos:'Owed to payer',    neg:'Owed by payer' }
  };

  function supports(kind){ return !!KINDS[kind]; }

  /** {label, amount} for a party, or null when there is nothing to show. */
  function balanceOf(kind, name){
    var A = app(), b = A && A.curBiz();
    var K = KINDS[kind];
    if(!b || !K || !String(name||'').trim()) return null;
    var amt;
    try{ amt = K.fn(b, name); }catch(e){ return null; }
    if(typeof amt !== 'number' || isNaN(amt)) return null;
    return { label: amt < -0.005 ? K.neg : K.pos, amount: amt };
  }

  /* --------------------------------------------------------- the party field */

  /** The party a [data-party] block currently names: {kind, name}. */
  function readParty(block){
    var t = block.querySelector('.party-type');
    var kind = t ? String(t.value||'') : '';
    var ctl = block.querySelector('[data-party-kind="' + kind.replace(/["\\]/g,'\\$&') + '"]');
    var master = block.querySelector('[data-party-master]');
    var name = ctl ? String(ctl.value||'') : (master ? String(master.value||'') : '');
    return { kind:kind, name:name.trim() };
  }

  /**
   * What this form is about to post to that party's sub-ledger, signed the way
   * their balance moves. Reuses the allocation panel's read of the line grid so
   * the two agree on which lines belong to whom.
   */
  function pendingFor(host, key, kind, name){
    var AL = global.Allocations;
    if(!AL || !AL.scanParties || (kind !== 'customer' && kind !== 'supplier')) return 0;
    var want = kind === 'customer' ? 'cust' : 'sup';
    var total = 0;
    try{
      AL.scanParties(host, key).forEach(function(g){
        if(g.side !== want || g.party !== name) return;
        total += g.settles ? -g.amount : g.amount;   // settling reduces what is owed
      });
    }catch(e){ return 0; }
    return Math.round(total*100)/100;
  }

  function badgeHtml(bal, projected){
    var A = app(), b = A && A.curBiz(), c = cur(b);
    var main = '<span class="pb-l">' + esc(bal.label) + '</span>' +
               '<span class="pb-v">' + (c ? esc(c) + ' ' : '') + money(bal.amount) + '</span>';
    if(projected == null) return main;
    return main + '<span class="pb-arrow">\u2192</span>' +
      '<span class="pb-v pb-next" title="After this document is saved">' + money(projected) + '</span>';
  }

  /** Refresh every badge on the form. */
  function update(){
    var st = state; if(!st.host) return;
    st.host.querySelectorAll('[data-party]').forEach(function(block){
      var slot = block.querySelector('[data-party-bal]');
      if(!slot) return;
      var p = readParty(block);
      var bal = supports(p.kind) ? balanceOf(p.kind, p.name) : null;
      if(!bal){ slot.innerHTML = ''; slot.classList.add('hide'); return; }   // nothing selected
      var move = pendingFor(st.host, st.key, p.kind, p.name);
      slot.innerHTML = badgeHtml(bal, move ? Math.round((bal.amount + move)*100)/100 : null);
      slot.classList.remove('hide');
      slot.classList.toggle('pb-neg', bal.amount < -0.005);
    });
  }

  var state = { host:null, key:null };

  /** Called once the designed Receipt / Payment form is in the DOM. */
  function mount(host, key){
    if(!host || (key !== 'receipts' && key !== 'payments')) return;
    state = { host:host, key:key };
    var blocks = host.querySelectorAll('[data-party]');
    for(var i=0;i<blocks.length;i++){
      if(blocks[i].querySelector('[data-party-bal]')) continue;
      var slot = global.document.createElement('span');
      slot.className = 'party-bal hide';
      slot.setAttribute('data-party-bal', '');
      blocks[i].appendChild(slot);
    }
    if(!host._pbWired){
      host.addEventListener('change', update);
      host.addEventListener('input', update);
      host._pbWired = true;
    }
    update();
  }

  global.PartyBalance = {
    mount:mount, update:update, balanceOf:balanceOf, readParty:readParty,
    pendingFor:pendingFor, supports:supports, KINDS:KINDS
  };
})(typeof window !== 'undefined' ? window : this);
