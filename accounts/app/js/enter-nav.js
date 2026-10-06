/* ===================== ENTER-as-TAB form navigation (additive) =====================
   One document-level keydown listener gives every form control in the app the
   same "Enter moves to the next field" behaviour, using the browser's natural
   tab order rather than a hand-written field list. Nothing else changes: TAB,
   SHIFT+TAB, arrows, Escape, Space and Ctrl/Cmd shortcuts are untouched, and
   buttons keep their normal Enter action.

   The decision logic is pure and exposed on window.EnterNav so it can be unit
   tested without a DOM. ==================================================== */
(function(global){
  'use strict';

  /* <input> types that are not "fields the user types into" — Enter on these
     already does something useful (activate) or they cannot be focused. */
  var NON_FIELD_INPUT = { submit:1, button:1, reset:1, image:1, hidden:1 };

  /* Types whose content the browser selects when TAB lands on them; we mirror
     that when we move focus ourselves. date/time/color throw on .select(). */
  var SELECT_ON_FOCUS = { text:1, search:1, url:1, tel:1, password:1, number:1 };

  /* Subtrees that own the Enter key themselves: the two visual designers.
     data-enter-nav="off" / .no-enter-nav are escape hatches for future markup. */
  var OPT_OUT = '#invDesignerHost,#fedHost,[data-enter-nav="off"],.no-enter-nav';

  /* Everything the browser puts in the tab order in this app. No positive
     tabindex is used anywhere, so document order is the tab order. */
  var FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]';

  /* The line-items grid of a designed form. */
  var LINE_GRID = '[data-line-items]';

  function tagOf(el){ return (el && el.tagName) ? String(el.tagName).toUpperCase() : ''; }
  function typeOf(el){ return String((el && el.type) || 'text').toLowerCase(); }
  function attr(el,name){ return (el && el.getAttribute) ? (el.getAttribute(name) || '') : ''; }

  /** A control the user enters a value into — the only places Enter navigates from. */
  function isField(el){
    var t = tagOf(el);
    if(t === 'SELECT' || t === 'TEXTAREA') return true;
    if(t === 'INPUT') return !NON_FIELD_INPUT[typeOf(el)];
    return false;
  }

  /** The element already reacts to Enter itself (inline handler) — leave it be. */
  function hasOwnEnterHandler(el){
    return /Enter|\b13\b/.test(attr(el,'onkeydown') + ' ' + attr(el,'onkeypress'));
  }

  /* A one-row auto-growing textarea inside a line-items table is a spreadsheet
     cell (the Description column), not a place for prose — Enter moves on. */
  function isGridCell(el){
    if(attr(el,'rows') !== '1') return false;
    return !!(el.closest && el.closest(LINE_GRID));
  }

  function isOptedOut(el){
    return !!(el && el.closest && el.closest(OPT_OUT));
  }

  /**
   * What Enter should do for this event: 'move' to the next field, or 'ignore'
   * and let the browser/app handle the key exactly as it does today.
   */
  function decide(el, evt){
    evt = evt || {};
    if(evt.key !== 'Enter') return 'ignore';
    if(evt.defaultPrevented) return 'ignore';           // an app handler claimed it
    if(evt.isComposing || evt.keyCode === 229) return 'ignore';  // IME composition
    if(evt.altKey || evt.shiftKey) return 'ignore';     // SHIFT+ENTER stays a newline
    if(!isField(el)) return 'ignore';                   // buttons, links, canvas…
    if(el.isContentEditable) return 'ignore';
    if(hasOwnEnterHandler(el)) return 'ignore';
    if(isOptedOut(el)) return 'ignore';

    /* Textareas are multiline: Enter keeps inserting a newline. Three exceptions
       are not really multiline — a read-only one cannot be typed into at all, a
       line-items grid cell is a single-line control in disguise, and
       Ctrl/Cmd+Enter is offered as a way out of a genuine one. */
    if(tagOf(el) === 'TEXTAREA'){
      if(el.readOnly || el.disabled) return 'move';
      if(isGridCell(el)) return 'move';
      return (evt.ctrlKey || evt.metaKey) ? 'move' : 'ignore';
    }
    if(evt.ctrlKey || evt.metaKey) return 'ignore';     // don't shadow shortcuts
    return 'move';
  }

  /** Can this element receive focus right now? */
  function isFocusable(el){
    if(!el || el.disabled) return false;
    if(tagOf(el) === 'INPUT' && typeOf(el) === 'hidden') return false;
    if(el.hidden) return false;
    if(el.getAttribute){
      var ti = el.getAttribute('tabindex');
      if(ti != null && ti !== '' && parseInt(ti,10) < 0) return false;
    }
    if(el.getClientRects && el.getClientRects().length === 0) return false;
    return true;
  }

  /** The document's focusable elements, in tab order. */
  function tabOrder(doc){
    var list = (doc || global.document).querySelectorAll(FOCUSABLE), out = [];
    for(var i=0;i<list.length;i++){ if(isFocusable(list[i])) out.push(list[i]); }
    return out;
  }

  /** Neighbour of `el` in `list`, `dir` steps away; null at either end. */
  function neighbour(list, el, dir){
    var i = Array.prototype.indexOf.call(list, el);
    if(i < 0) return null;
    var j = i + (dir || 1);
    return (j >= 0 && j < list.length) ? list[j] : null;
  }

  /** Focus an element the way TAB would (selecting text where the browser does). */
  function focusLikeTab(el){
    if(!el) return false;
    try{ el.focus(); }catch(e){ return false; }
    var t = tagOf(el);
    if(t === 'TEXTAREA' || (t === 'INPUT' && SELECT_ON_FOCUS[typeOf(el)])){
      try{ el.select(); }catch(e){}
    }
    return true;
  }

  function onKeyDown(evt){
    var el = evt && evt.target;
    if(decide(el, evt) !== 'move') return;
    /* Always stop the default first: on a designed form (<form class="app-form">)
       Enter would otherwise implicitly submit and reload the page. */
    if(evt.preventDefault) evt.preventDefault();
    focusLikeTab(neighbour(tabOrder(el.ownerDocument), el, 1));
  }

  var EnterNav = {
    isField: isField, decide: decide, isFocusable: isFocusable,
    tabOrder: tabOrder, neighbour: neighbour, focusLikeTab: focusLikeTab,
    isGridCell: isGridCell, onKeyDown: onKeyDown,
    OPT_OUT: OPT_OUT, FOCUSABLE: FOCUSABLE, LINE_GRID: LINE_GRID
  };
  global.EnterNav = EnterNav;

  /* Bubble phase, so any element-level handler still runs (and can cancel us
     by calling preventDefault) before we take over. */
  if(global.document && global.document.addEventListener){
    global.document.addEventListener('keydown', onKeyDown, false);
  }
})(typeof window !== 'undefined' ? window : this);
