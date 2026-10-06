/* ===================== Gill Transport: Trucks =====================
   The register of trucks behind the Truck No cells of Trips and Diesel.
   Stored on the business as b.gill.lists.trucks = [{id, no, plate, make,
   status:'Active'|'Inactive', notes}] (see Gill.data in js/gill-trips.js for
   the migration from plain truck numbers and the one-time seeding from the
   truck numbers already used in trips and diesel).

   - Trips / Diesel list only Active trucks; Inactive ones stay on old rows.
   - A truck used by any trip or diesel entry cannot be deleted — the user is
     offered "Mark Inactive" instead.
   - Renaming a truck renames it on its trips and diesel entries.
   Registered as the custom module "trucks" (sidebar Transport, after Diesel);
   it is on automatically while Trips or Diesel is on (autoWith).
   ================================================================== */
(function (G) {
  'use strict';
  if (typeof App === 'undefined' || !G.Gill || !G.CustomModules || G.Gill.trucks) return;
  var Gill = G.Gill, U = Gill.util, esc = U.esc, CM = G.CustomModules;
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function same(a, b) { return lc(a).replace(/\s+/g, ' ') === lc(b).replace(/\s+/g, ' '); }
  var ui = { q: '', status: '' };

  var T = Gill.trucks = {
    list: function (b) { return Gill.data(b).lists.trucks; },
    active: function (b) { return T.list(b).filter(function (t) { return t.status !== 'Inactive'; }); },
    byId: function (b, id) { return T.list(b).find(function (t) { return String(t.id) === String(id); }) || null; },
    /** {trips, diesel} entries that use this truck number */
    usage: function (b, no) {
      var g = Gill.data(b), f = function (r) { return r && same(r.truck, no); };
      return { trips: g.trips.filter(f).length, diesel: g.diesel.filter(f).length };
    },
    /** add (id null) or update a truck. -> {ok, truck, renamed} | {error, field} */
    save: function (b, v, id) {
      var no = String((v && v.no) || '').trim();
      if (!no) return { error: 'Truck No is required.', field: 'no' };
      var L = T.list(b), cur = id != null ? T.byId(b, id) : null;
      if (id != null && !cur) return { error: 'That truck no longer exists.' };
      if (L.some(function (t) { return t !== cur && same(t.no, no); })) return { error: 'Truck ' + no + ' is already in the list.', field: 'no' };
      var t = cur || { id: 't' + U.uid() }, renamed = 0, old = cur ? cur.no : '';
      t.no = no; t.plate = String(v.plate || '').trim(); t.make = String(v.make || '').trim();
      t.status = v.status === 'Inactive' ? 'Inactive' : 'Active'; t.notes = String(v.notes || '').trim();
      if (!cur) L.push(t);
      if (cur && old && old !== no) {
        var g = Gill.data(b);
        g.trips.concat(g.diesel).forEach(function (r) { if (r && same(r.truck, old)) { r.truck = no; renamed++; } });
      }
      return { ok: true, truck: t, renamed: renamed };
    },
    /** -> {ok} | {used:{trips, diesel}} */
    remove: function (b, id) {
      var t = T.byId(b, id); if (!t) return { ok: true };
      var u = T.usage(b, t.no); if (u.trips || u.diesel) return { used: u, truck: t };
      Gill.data(b).lists.trucks = T.list(b).filter(function (x) { return x !== t; });
      return { ok: true };
    },
  };

  function lvl(b) { return Gill.level(b, 'Trucks'); }
  function guard(b, need) { return !(App.guardWrite && !App.guardWrite(b, need)); }
  function rerender() { var b = U.curB(); if (b) App.renderMain(b); }
  function usedTxt(u) { return [u.trips ? u.trips + ' trip' + (u.trips === 1 ? '' : 's') : '', u.diesel ? u.diesel + ' diesel entr' + (u.diesel === 1 ? 'y' : 'ies') : ''].filter(Boolean).join(' and '); }

  /* ------------------------------------------------------------------ page */
  function pageHtml(b, L) {
    var g = Gill.data(b), all = g.lists.trucks, q = lc(ui.q);
    var uses = {}; g.trips.concat(g.diesel).forEach(function (r) { var k = lc(r && r.truck).replace(/\s+/g, ' '); if (!k) return; var u = uses[k] = uses[k] || { trips: 0, diesel: 0 }; if (g.trips.indexOf(r) >= 0) u.trips++; else u.diesel++; });
    var rows = all.filter(function (t) { return (!ui.status || t.status === ui.status) && (!q || [t.no, t.plate, t.make, t.notes].some(function (x) { return lc(x).indexOf(q) >= 0; })); })
      .sort(function (x, y) { return x.no.localeCompare(y.no, undefined, { numeric: true, sensitivity: 'base' }); });
    var body = rows.map(function (t) { var u = uses[lc(t.no).replace(/\s+/g, ' ')] || { trips: 0, diesel: 0 };
      return '<tr class="gl-trk-row" onclick="Gill.trucks.edit(\'' + esc(t.id) + '\')"><td><a class="led-link"><b>' + esc(t.no) + '</b></a></td><td>' + esc(t.plate || '') + '</td><td>' + esc(t.make || '') + '</td>' +
        '<td><span class="st-badge ' + (t.status === 'Inactive' ? 'st-draft' : 'st-paid') + '">' + esc(t.status) + '</span></td><td class="r">' + u.trips + '</td><td class="r">' + u.diesel + '</td><td class="gl-trk-notes">' + esc(t.notes || '') + '</td></tr>'; }).join('');
    var nA = all.filter(function (t) { return t.status !== 'Inactive'; }).length;
    var seg = function (v, l) { return '<button class="' + (ui.status === v ? 'on' : '') + '" onclick="Gill.trucks.filter(\'status\',\'' + v + '\')">' + l + '</button>'; };
    return App.crumb('Trucks') +
      '<div class="gl-page gl-trucks"><div class="reg-panel-head gl-head"><span class="reg-panel-title">Trucks</span>' +
      (L >= 2 ? '<button class="btn btn-primary btn-xs" onclick="Gill.trucks.edit()">+ New truck</button>' : '') +
      '<div class="seg-sw gl-views">' + seg('', 'All') + seg('Active', 'Active') + seg('Inactive', 'Inactive') + '</div>' +
      '<div class="gl-tools"><input type="search" class="gl-trk-q" placeholder="Search" aria-label="Search trucks" value="' + esc(ui.q) + '" oninput="Gill.trucks.filter(\'q\',this.value,true)"></div></div>' +
      (L < 2 ? '<div class="perm-ro-note">View only — your permissions do not allow changes on this page.</div>' : '') +
      '<p class="gl-hint">' + nA + ' active of ' + all.length + ' trucks. Trips and Diesel list the <b>Active</b> trucks only. A truck that is used in trips or diesel cannot be deleted — mark it Inactive instead.</p>' +
      '<div class="gl-grid-wrap"><table class="reg-tbl gl-trk"><thead><tr><th>Truck No</th><th>Plate / Emirate</th><th>Make / Model</th><th>Status</th><th class="r">Trips</th><th class="r">Diesel</th><th>Notes</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7"><div class="gl-empty">' + (all.length ? 'No trucks match.' : 'No trucks yet.' + (L >= 2 ? ' Click <b>+ New truck</b>.' : '')) + '</div></td></tr>') +
      '</tbody></table></div></div>';
  }
  T.filter = function (k, v, keepFocus) {
    ui[k] = v; rerender();
    if (keepFocus) { var i = document.querySelector('.gl-trk-q'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} } }
  };

  /* ------------------------------------------------------------------ form (overlay) */
  /** fromCell: opened by "+ Add truck" in a Trips / Diesel cell (Gill.addMaster) */
  T.formHtml = function (t, seed, fromCell) {
    var b = U.curB(), L = b ? lvl(b) : 0, ro = t ? L < 3 : false;
    var f = function (id, label, v, extra) { return '<label class="fld" for="' + id + '">' + label + '</label><input id="' + id + '" type="text" value="' + esc(v || '') + '"' + (ro ? ' readonly' : '') + (extra || '') + '>'; };
    var st = t ? t.status : 'Active';
    var u = t && b ? T.usage(b, t.no) : null;
    return '<div class="app-modal-h">' + (t ? 'Truck ' + esc(t.no) : 'New truck') + '</div><div class="app-modal-b gl-add" data-tid="' + esc(t ? t.id : '') + '" data-from="' + (fromCell ? '1' : '') + '">' +
      '<div id="glAddErr" class="qc-err hide"></div>' +
      '<div class="gl-add-2">' + f('glT_no', 'Truck No *', t ? t.no : seed, ' maxlength="40"') + f('glT_plate', 'Plate / Emirate', t && t.plate, ' placeholder="e.g. Dubai P 12345"') + '</div>' +
      '<div class="gl-add-2">' + f('glT_make', 'Make / Model', t && t.make, ' placeholder="e.g. Volvo FH 480"') +
        '<div><label class="fld" for="glT_status">Status</label><select id="glT_status"' + (ro ? ' disabled' : '') + '><option' + (st === 'Active' ? ' selected' : '') + '>Active</option><option' + (st === 'Inactive' ? ' selected' : '') + '>Inactive</option></select></div></div>' +
      '<label class="fld" for="glT_notes">Notes</label><textarea id="glT_notes" rows="2"' + (ro ? ' readonly' : '') + '>' + esc(t ? t.notes || '' : '') + '</textarea>' +
      (u && (u.trips || u.diesel) ? '<p class="gl-hint">Used in ' + usedTxt(u) + '.' + (!ro ? ' Changing the Truck No renames it on those entries.' : '') + '</p>' : '') + '</div>' +
      '<div class="app-modal-f">' + (t && L >= 4 ? '<button class="btn btn-danger" onclick="Gill.trucks.del(\'' + esc(t.id) + '\')">Delete</button>' : '') + '<span style="flex:1"></span>' +
      '<button class="btn" onclick="' + (fromCell ? 'Gill.addCancel()' : 'App._closeOverlay()') + '">' + (ro ? 'Close' : 'Cancel') + '</button>' +
      (ro ? '' : '<button class="btn btn-primary" onclick="Gill.trucks.saveForm()">' + (t ? 'Update' : 'Add') + '</button>') + '</div>';
  };
  T.edit = function (id) {
    var b = U.curB(); if (!b) return;
    var t = id != null ? T.byId(b, id) : null;
    if (!t && !guard(b, 2)) return;
    App._openOverlay(T.formHtml(t, '', false));
    var ov = U.byId('appOverlay');
    if (ov) ov.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); T.saveForm(); } });
    setTimeout(function () { var n = U.byId('glT_no'); if (n) { n.focus(); try { n.select(); } catch (e) {} } }, 0);
  };
  function err(m) { var e = U.byId('glAddErr'); if (e) { e.textContent = m; e.classList.remove('hide'); } else U.toast(m); }
  function v(id) { var e = U.byId(id); return e ? e.value : ''; }
  T.saveForm = function () {
    var b = U.curB(); if (!b) return;
    var box = document.querySelector('.gl-add[data-tid]'), id = box && box.getAttribute('data-tid') || null, fromCell = box && box.getAttribute('data-from') === '1';
    if (!fromCell && !guard(b, id ? 3 : 2)) return;
    var res = T.save(b, { no: v('glT_no'), plate: v('glT_plate'), make: v('glT_make'), status: v('glT_status'), notes: v('glT_notes') }, id);
    if (res.error) { err(res.error); return; }
    App.saveBiz(b);
    if (fromCell) { if (res.truck.status === 'Inactive') { Gill.addCancel(); U.toast('Saved as Inactive — Inactive trucks are not listed'); return; } Gill.addDone(res.truck.no); return; }
    App._closeOverlay();
    U.toast((id ? 'Updated ' : 'Added ') + res.truck.no + (res.renamed ? ' — renamed on ' + res.renamed + ' entr' + (res.renamed === 1 ? 'y' : 'ies') : ''));
    rerender();
  };
  T.del = function (id) {
    var b = U.curB(); if (!b || !guard(b, 4)) return;
    var t = T.byId(b, id); if (!t) return;
    var u = T.usage(b, t.no);
    if (u.trips || u.diesel) {
      UIModal.confirm('Truck ' + t.no + ' is used in ' + usedTxt(u) + ', so it cannot be deleted. Mark it Inactive instead? It then no longer appears in the Trips and Diesel lists; the old entries keep it.',
        { title: 'Delete truck', okText: 'Mark Inactive' }).then(function (ok) {
        if (!ok) return; var b2 = U.curB(), t2 = T.byId(b2, id); if (!t2) return; t2.status = 'Inactive'; App.saveBiz(b2); App._closeOverlay(); U.toast(t2.no + ' marked Inactive'); rerender(); });
      return;
    }
    UIModal.confirm('Delete truck ' + t.no + '?', { title: 'Delete truck', okText: 'Delete', danger: true }).then(function (ok) {
      if (!ok) return; var b2 = U.curB(); T.remove(b2, id); App.saveBiz(b2); App._closeOverlay(); U.toast('Deleted'); rerender(); });
  };

  CM.register({
    id: 'trucks', name: 'Trucks', group: 'Transport', legacyFeature: 'gill', autoWith: ['trips', 'diesel'],
    description: 'The list of trucks (Truck No, plate, make, Active / Inactive) offered in the Truck No cells of Trips and Diesel. On automatically with Trips or Diesel.',
    tabs: [{ id: 'trucks', label: 'Trucks', icon: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
      render: function (b, ctx) { var h = pageHtml(b, ctx && ctx.level != null ? ctx.level : lvl(b)); if (Gill._takeMigrated()) { try { App.saveBiz(b); } catch (e) {} } return h; } }],
    settings: { key: 'gill', title: 'Transport pick-lists' },
    onEnable: function (b) { Gill.data(b); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
