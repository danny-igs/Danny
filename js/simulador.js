// Simulador de circuitos tipo Proteus: componentes, cables libres y solver nodal (MNA)
(function () {
  const $ = (s) => document.querySelector(s);
  const G = 20, W = 800, H = 520;
  const svg = $('#board'), layer = $('#layer');

  const TYPES = {
    bat:  { name: 'Pila',        pre: 'B',   val: 9,   unit: 'V' },
    res:  { name: 'Resistencia', pre: 'R',   val: 220, unit: 'Ω' },
    lamp: { name: 'Bombilla',    pre: 'L',   val: 60,  unit: 'Ω' },
    sw:   { name: 'Interruptor', pre: 'S' },
    vm:   { name: 'Voltímetro',  pre: 'VM' },
    am:   { name: 'Amperímetro', pre: 'A' },
    gnd:  { name: 'Tierra',      pre: 'GND', pins: [[0, 0]] }
  };
  Object.values(TYPES).forEach((t) => { t.pins = t.pins || [[-40, 0], [40, 0]]; });

  const S = { comps: [], wires: [], sel: null, armed: null, tool: 'select', run: true, zoom: 1, nid: 1, cnt: {}, sol: null };
  let wiring = null, drag = null, cur = { x: 0, y: 0 };

  /* ---------- utilidades ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const snap = (v) => Math.round(v / G) * G;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fR = (r) => (r >= 1000 ? +(r / 1000).toFixed(2) + ' kΩ' : +r.toFixed(1) + ' Ω');
  const fI = (a) => { const x = Math.abs(a), s = a < 0 ? '−' : ''; return s + (x >= 1 ? x.toFixed(2) + ' A' : (x * 1000).toFixed(1) + ' mA'); };
  const byId = (id) => S.comps.find((c) => c.id === id);
  const key = (p) => p[0] + ',' + p[1];

  function pinPos(c, i) {
    const [px, py] = TYPES[c.type].pins[i];
    const cs = [1, 0, -1, 0][c.rot], sn = [0, 1, 0, -1][c.rot];
    return [c.x + px * cs - py * sn, c.y + px * sn + py * cs];
  }
  function epPos(e) {
    if (e.c != null) { const c = byId(e.c); if (c) return pinPos(c, e.p); }
    return [e.x, e.y];
  }
  function wirePts(w) {
    const a = epPos(w.a), b = epPos(w.b);
    return a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [b[0], a[1]], b];
  }
  function onSeg(P, a, b) {
    if (a[0] === b[0] && P[0] === a[0]) return P[1] >= Math.min(a[1], b[1]) && P[1] <= Math.max(a[1], b[1]);
    if (a[1] === b[1] && P[1] === a[1]) return P[0] >= Math.min(a[0], b[0]) && P[0] <= Math.max(a[0], b[0]);
    return false;
  }
  function onAnyWire(P) {
    return S.wires.some((w) => { const q = wirePts(w); for (let i = 0; i < q.length - 1; i++) if (onSeg(P, q[i], q[i + 1])) return true; return false; });
  }
  function endpointAt(x, y) {
    for (const c of S.comps) for (let i = 0; i < TYPES[c.type].pins.length; i++) {
      const p = pinPos(c, i);
      if (p[0] === x && p[1] === y) return { c: c.id, p: i };
    }
    return { x, y };
  }

  /* ---------- solver nodal modificado ---------- */
  function solve() {
    const bats = S.comps.filter((c) => c.type === 'bat');
    if (!bats.length) return { none: true };
    const par = {};
    const f = (k) => { if (par[k] === undefined) par[k] = k; while (par[k] !== k) { par[k] = par[par[k]]; k = par[k]; } return k; };
    const u = (a, b) => { par[f(a)] = f(b); };
    S.wires.forEach((w) => u(key(epPos(w.a)), key(epPos(w.b))));
    S.wires.forEach((w) => [w.a, w.b].forEach((e) => {
      if (e.c != null) return;
      const P = [e.x, e.y];
      S.wires.forEach((v) => { const q = wirePts(v); for (let i = 0; i < q.length - 1; i++) if (onSeg(P, q[i], q[i + 1])) u(key(P), key(epPos(v.a))); });
    }));
    const roots = new Set();
    S.comps.filter((c) => c.type === 'gnd').forEach((c) => roots.add(f(key(pinPos(c, 0)))));
    if (!roots.size) roots.add(f(key(pinPos(bats[0], 0))));
    const idx = {}; let n = 0;
    S.comps.forEach((c) => {
      c.n = TYPES[c.type].pins.map((_, i) => {
        const r = f(key(pinPos(c, i)));
        if (roots.has(r)) return -1;
        if (idx[r] === undefined) idx[r] = n++;
        return idx[r];
      });
    });
    const m = n + bats.length;
    const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
    for (let i = 0; i < n; i++) A[i][i] += 1e-9;
    const stamp = (a, b, g) => {
      if (a >= 0) A[a][a] += g;
      if (b >= 0) A[b][b] += g;
      if (a >= 0 && b >= 0) { A[a][b] -= g; A[b][a] -= g; }
    };
    const cond = (c) => ({
      res: 1 / c.val, lamp: 1 / c.val, sw: c.closed ? 1e3 : 1e-10, vm: 1e-7, am: 1e3
    }[c.type]);
    S.comps.forEach((c) => { if (c.type !== 'bat' && c.type !== 'gnd') stamp(c.n[0], c.n[1], cond(c)); });
    bats.forEach((c, j) => {
      const k = n + j, a = c.n[0], b = c.n[1];
      if (b >= 0) { A[b][k] += 1; A[k][b] += 1; }
      if (a >= 0) { A[a][k] -= 1; A[k][a] -= 1; }
      A[k][k] -= 0.05;
      A[k][m] = c.val;
    });
    // Gauss-Jordan con pivoteo parcial
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-13) return { err: true };
      [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < m; r++) {
        if (r === c) continue;
        const fct = A[r][c] / A[c][c];
        if (fct) for (let k = c; k <= m; k++) A[r][k] -= fct * A[c][k];
      }
    }
    const x = A.map((row, i) => row[m] / row[i]);
    const V = (i) => (i < 0 ? 0 : x[i]);
    let imax = 1e-12, total = 0;
    S.comps.forEach((c) => {
      if (c.type === 'gnd') { c.r = null; return; }
      const v0 = V(c.n[0]), v1 = V(c.n[1]);
      if (c.type === 'bat') {
        const j = bats.indexOf(c);
        c.r = { v: v1 - v0, i: -x[n + j] };
        total += Math.abs(c.r.i);
      } else {
        c.r = { v: v0 - v1, i: (v0 - v1) * cond(c) };
      }
      if (c.type !== 'vm') imax = Math.max(imax, Math.abs(c.r.i));
    });
    return { imax, short: bats.some((c) => Math.abs(c.r.i) > 30), total: bats.reduce((s, c) => s + c.r.i, 0) };
  }

  /* ---------- dibujo ---------- */
  function sym(c) {
    switch (c.type) {
      case 'bat': return '<path d="M-40 0H-4M4 0H40M-4-9V9M4-18V18M18-12h10M23-17v10"/>';
      case 'res': return '<path d="M-40 0H-20L-14-10L-6 10L2-10L10 10L16 0H40"/>';
      case 'lamp': return '<path d="M-40 0H-14M14 0H40M-10-10L10 10M-10 10L10-10"/><circle r="14"/>';
      case 'sw': return '<path d="M-40 0H-18M18 0H40"/><circle cx="-18" r="3"/><circle cx="18" r="3"/>' +
        (c.closed ? '<path d="M-18 0H18"/>' : '<path d="M-18 0L14-16"/>');
      case 'vm': return '<path d="M-40 0H-18M18 0H40M-34-10h6M-31-13v6"/><circle r="18"/><path d="M-6-6L0 7L6-6"/>';
      case 'am': return '<path d="M-40 0H-18M18 0H40M-34-10h6M-31-13v6"/><circle r="18"/><path d="M-7 7L0-7L7 7M-4 2H4"/>';
      default: return '<path d="M0 0V10M-14 10H14M-9 16H9M-4 22H4"/>';
    }
  }
  function valueText(c) {
    if (c.type === 'bat') return c.val + ' V';
    if (c.type === 'res' || c.type === 'lamp') return fR(c.val);
    if (c.type === 'sw') return c.closed ? 'cerrado' : 'abierto';
    return '';
  }
  function readout(c) {
    if (!S.run || !c.r || !S.sol || !S.sol.imax) return '';
    if (c.type === 'vm') return c.r.v.toFixed(2) + ' V';
    if (c.type === 'am') return fI(c.r.i);
    return Math.abs(c.r.v).toFixed(2) + ' V · ' + fI(Math.abs(c.r.i));
  }
  function compMarkup(c, ghost) {
    const sel = S.sel && S.sel.k === 'c' && S.sel.id === c.id;
    const r = S.run && !ghost && S.sol && S.sol.imax ? c.r : null;
    let s = '<g class="comp' + (sel ? ' sel' : '') + (ghost ? ' ghost' : '') + '" data-id="' + c.id +
      '" transform="translate(' + c.x + ',' + c.y + ')"><g transform="rotate(' + c.rot * 90 + ')">';
    const hb = c.type === 'gnd' ? '-18" y="-4" width="36" height="30' : '-34" y="-22" width="68" height="44';
    s += '<rect class="hitb" x="' + hb + '"/>';
    if (c.type === 'lamp' && r) {
      const b = Math.min(1.2, (Math.abs(r.v * r.i)) / (144 / c.val));
      s += '<circle r="26" fill="#ffd45a" fill-opacity="' + (b * 0.28).toFixed(2) + '"/><circle r="13" fill="#ffd45a" fill-opacity="' + Math.min(1, b).toFixed(2) + '"/>';
    }
    if (r && c.type !== 'gnd' && Math.abs(r.i) > 1e-6) {
      const dur = (2.2 - 1.6 * Math.abs(r.i) / S.sol.imax).toFixed(2);
      s += '<path class="cflow' + (r.i < 0 ? ' rev' : '') + '" style="animation-duration:' + dur + 's" d="M-40 0H40"/>';
    }
    s += '<g class="sym">' + sym(c) + '</g></g>';
    TYPES[c.type].pins.forEach((_, i) => {
      const p = pinPos(c, i), dx = p[0] - c.x, dy = p[1] - c.y;
      s += '<circle class="pin" cx="' + dx + '" cy="' + dy + '" r="3.5"/>';
      if (!ghost) s += '<circle class="ph" data-c="' + c.id + '" data-p="' + i + '" cx="' + dx + '" cy="' + dy + '" r="9"/>';
    });
    if (c.type !== 'gnd') {
      const vert = c.rot % 2 === 1;
      const t1 = esc(c.label) + ' ' + valueText(c), t2 = readout(c);
      s += vert
        ? '<text class="lab st" x="24" y="-3">' + t1 + '</text><text class="lab st rd" x="24" y="13">' + t2 + '</text>'
        : '<text class="lab" y="-28">' + t1 + '</text><text class="lab rd" y="38">' + t2 + '</text>';
    }
    return s + '</g>';
  }

  function render() {
    S.sol = S.run ? solve() : null;
    let h = '';
    S.wires.forEach((w, i) => {
      const pts = wirePts(w).map((p) => p.join(',')).join(' ');
      const sel = S.sel && S.sel.k === 'w' && S.sel.i === i;
      h += '<polyline class="cw' + (sel ? ' sel' : '') + '" points="' + pts + '"/><polyline class="wh" data-w="' + i + '" points="' + pts + '"/>';
    });
    S.wires.forEach((w, wi) => [w.a, w.b].forEach((e) => {
      if (e.c != null) return;
      const P = [e.x, e.y];
      const hit = S.wires.some((v, vi) => { if (vi === wi) return false; const q = wirePts(v); for (let i = 0; i < q.length - 1; i++) if (onSeg(P, q[i], q[i + 1])) return true; return false; });
      if (hit) h += '<circle class="jn" cx="' + P[0] + '" cy="' + P[1] + '" r="5"/>';
    }));
    S.comps.forEach((c) => { h += compMarkup(c, false); });
    if (S.armed) {
      const g = { id: 0, type: S.armed, x: cur.x, y: cur.y, rot: 0, label: TYPES[S.armed].pre, val: TYPES[S.armed].val, closed: true };
      h += compMarkup(g, true);
    }
    if (wiring) {
      const a = epPos(wiring.a), b = [cur.x, cur.y];
      const q = a[0] === b[0] || a[1] === b[1] ? [a, b] : [a, [b[0], a[1]], b];
      h += '<polyline class="pv" points="' + q.map((p) => p.join(',')).join(' ') + '"/>';
    }
    layer.innerHTML = h;
    status();
  }

  function status() {
    const el = $('#status'), s = S.sol;
    let t;
    if (!S.run) t = 'Simulación detenida. Pulsa Simular para ver voltajes y corrientes.';
    else if (s.none) t = 'Agrega una pila a la biblioteca para empezar a simular.';
    else if (s.err) t = 'No se pudo resolver el circuito. Revisa que los cables estén bien conectados.';
    else if (s.short) t = '⚠ Cortocircuito: hay un cable uniendo los dos polos de la pila sin resistencia.';
    else t = 'Simulando · corriente entregada por la pila: ' + fI(s.total);
    el.textContent = t;
  }

  /* ---------- edición ---------- */
  function select(k, v) {
    S.sel = k ? (k === 'c' ? { k, id: v } : { k, i: v }) : null;
    props();
  }
  function addComp(type, x, y, rot, val) {
    const T = TYPES[type];
    S.cnt[type] = (S.cnt[type] || 0) + 1;
    const c = {
      id: S.nid++, type, x: clamp(x, 40, W - 40), y: clamp(y, 40, H - 40), rot: rot || 0,
      label: type === 'gnd' ? 'GND' : T.pre + S.cnt[type], val: val != null ? val : T.val, closed: true
    };
    S.comps.push(c);
    return c;
  }
  function removeSel() {
    if (!S.sel) return;
    if (S.sel.k === 'w') S.wires.splice(S.sel.i, 1);
    else {
      const c = byId(S.sel.id);
      S.wires.forEach((w) => [w.a, w.b].forEach((e) => {
        if (e.c === c.id) { const p = pinPos(c, e.p); delete e.c; delete e.p; e.x = p[0]; e.y = p[1]; }
      }));
      S.comps.splice(S.comps.indexOf(c), 1);
    }
    select(null);
    render();
  }
  function rotateSel() {
    if (S.sel && S.sel.k === 'c') { const c = byId(S.sel.id); c.rot = (c.rot + 1) % 4; render(); }
  }
  function props() {
    const box = $('#props');
    if (!S.sel) { box.innerHTML = '<p class="note">Selecciona un componente para editar su nombre y su valor.</p>'; return; }
    if (S.sel.k === 'w') { box.innerHTML = '<p class="note">Cable seleccionado. Pulsa Eliminar para quitarlo.</p>'; return; }
    const c = byId(S.sel.id), T = TYPES[c.type];
    let h = '<p class="note">' + T.name + '</p><label class="f">Nombre<input id="p-l" type="text" maxlength="8" value="' + esc(c.label) + '"></label>';
    if (T.val != null) h += '<label class="f">Valor (' + T.unit + ')<input id="p-v" type="number" min="0.1" step="any" inputmode="decimal" value="' + c.val + '"></label>';
    if (c.type === 'sw') h += '<label class="chk"><input id="p-s" type="checkbox"' + (c.closed ? ' checked' : '') + '> Cerrado</label>';
    box.innerHTML = h;
    const L = $('#p-l'), Vv = $('#p-v'), Sw = $('#p-s');
    L.addEventListener('input', () => { c.label = L.value; render(); });
    if (Vv) Vv.addEventListener('input', () => { const v = parseFloat(Vv.value); if (v > 0) { c.val = v; render(); } });
    if (Sw) Sw.addEventListener('change', () => { c.closed = Sw.checked; render(); });
  }

  /* ---------- cables ---------- */
  function startWire(p, ep, dragMode, e) {
    wiring = { a: ep || endpointAt(p.x, p.y), from: p, drag: dragMode };
    if (e) svg.setPointerCapture(e.pointerId);
    render();
  }
  function finishWire(p, keepChain) {
    const a = wiring.a, b = endpointAt(p.x, p.y);
    const pa = epPos(a);
    if (pa[0] === p.x && pa[1] === p.y) return;
    S.wires.push({ a, b });
    const cont = keepChain && b.c == null && !onAnyWire([p.x, p.y]) && S.wires.filter((w) => {
      const q = epPos(w.a), r = epPos(w.b); return (q[0] === p.x && q[1] === p.y) || (r[0] === p.x && r[1] === p.y);
    }).length < 2;
    wiring = cont ? { a: b, from: p, drag: false } : null;
    render();
  }
  function cancel() { wiring = null; S.armed = null; syncUI(); render(); }

  /* ---------- eventos del tablero ---------- */
  function raw(e) {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function sp(e) { const p = raw(e); return { x: clamp(snap(p.x), 20, W - 20), y: clamp(snap(p.y), 20, H - 20), rx: p.x, ry: p.y }; }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = sp(e), t = e.target;
    cur = p;
    if (S.armed) { const c = addComp(S.armed, p.x, p.y); select('c', c.id); render(); return; }
    if (wiring) { finishWire(p, true); return; }
    const ph = t.closest && t.closest('[data-p]');
    if (ph || S.tool === 'wire') { startWire(p, ph ? { c: +ph.dataset.c, p: +ph.dataset.p } : null, true, e); return; }
    const cg = t.closest && t.closest('.comp');
    if (cg) {
      const c = byId(+cg.dataset.id);
      select('c', c.id);
      drag = { c, ox: p.rx - c.x, oy: p.ry - c.y, moved: false };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    const wh = t.closest && t.closest('[data-w]');
    if (wh) { select('w', +wh.dataset.w); render(); return; }
    select(null);
    render();
  });
  svg.addEventListener('pointermove', (e) => {
    const p = sp(e);
    const changed = p.x !== cur.x || p.y !== cur.y;
    cur = p;
    if (drag) {
      const nx = clamp(snap(p.rx - drag.ox), 40, W - 40), ny = clamp(snap(p.ry - drag.oy), 40, H - 40);
      if (nx !== drag.c.x || ny !== drag.c.y) { drag.c.x = nx; drag.c.y = ny; drag.moved = true; render(); }
    } else if (changed && (S.armed || wiring)) render();
  });
  svg.addEventListener('pointerup', (e) => {
    const p = sp(e);
    if (drag) {
      if (!drag.moved && drag.c.type === 'sw') { drag.c.closed = !drag.c.closed; props(); }
      drag = null; render();
    } else if (wiring && wiring.drag) {
      const a = epPos(wiring.a);
      if (Math.abs(p.x - a[0]) + Math.abs(p.y - a[1]) >= G) finishWire(p, false);
      else wiring.drag = false;     // un clic: sigue en modo clic-clic
    }
  });
  svg.addEventListener('dblclick', () => { wiring = null; render(); });
  svg.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') cancel();
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (e.key === 'r' || e.key === 'R') rotateSel();
  });

  /* ---------- biblioteca y barra ---------- */
  const lib = $('#lib');
  Object.keys(TYPES).forEach((k) => {
    const b = document.createElement('button');
    b.className = 'libitem'; b.dataset.type = k; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = '<svg class="sym" viewBox="-48 -28 96 56" aria-hidden="true"><g transform="translate(0,' + (k === 'gnd' ? -6 : 0) + ')">' +
      sym({ type: k, closed: true }) + '</g></svg><span>' + TYPES[k].name + '</span>';
    b.addEventListener('click', () => {
      S.armed = S.armed === k ? null : k;
      S.tool = 'select'; wiring = null;
      syncUI(); render();
    });
    lib.append(b);
  });

  function syncUI() {
    document.querySelectorAll('.libitem').forEach((b) => b.setAttribute('aria-pressed', String(S.armed === b.dataset.type)));
    const tw = S.tool === 'wire' && !S.armed;
    $('#t-select').classList.toggle('on', !tw && !S.armed); $('#t-select').setAttribute('aria-pressed', String(!tw && !S.armed));
    $('#t-wire').classList.toggle('on', tw); $('#t-wire').setAttribute('aria-pressed', String(tw));
    $('#t-run').textContent = S.run ? 'Detener' : 'Simular';
    $('#t-run').setAttribute('aria-pressed', String(S.run));
    svg.style.cursor = S.armed ? 'copy' : tw ? 'crosshair' : 'default';
    svg.parentElement.style.setProperty('--z', S.zoom);
    svg.style.width = S.zoom * 100 + '%';
  }
  $('#t-select').addEventListener('click', () => { S.tool = 'select'; S.armed = null; wiring = null; syncUI(); render(); });
  $('#t-wire').addEventListener('click', () => { S.tool = S.tool === 'wire' ? 'select' : 'wire'; S.armed = null; wiring = null; syncUI(); render(); });
  $('#t-rot').addEventListener('click', rotateSel);
  $('#t-del').addEventListener('click', removeSel);
  $('#t-zi').addEventListener('click', () => { S.zoom = Math.min(3, S.zoom + 0.5); syncUI(); });
  $('#t-zo').addEventListener('click', () => { S.zoom = Math.max(1, S.zoom - 0.5); syncUI(); });
  $('#t-run').addEventListener('click', () => { S.run = !S.run; syncUI(); render(); });

  /* ---------- ejemplos ---------- */
  const P = (c, p) => ({ c, p }), Q = (x, y) => ({ x, y });
  const wire = (a, b) => S.wires.push({ a, b });
  function load(name) {
    S.comps = []; S.wires = []; S.cnt = {}; S.nid = 1; wiring = null; S.armed = null; select(null);
    if (name === 'serie') {
      const b = addComp('bat', 120, 260, 3, 12).id, r1 = addComp('res', 220, 220, 0, 100).id,
        r2 = addComp('res', 360, 220, 0, 220).id, r3 = addComp('res', 500, 220, 0, 330).id,
        g = addComp('gnd', 120, 340, 0).id, v = addComp('vm', 360, 140, 0).id;
      wire(P(b, 1), P(r1, 0)); wire(P(r1, 1), P(r2, 0)); wire(P(r2, 1), P(r3, 0));
      wire(P(r3, 1), Q(540, 300)); wire(Q(540, 300), P(b, 0)); wire(P(b, 0), P(g, 0));
      wire(P(r2, 0), P(v, 0)); wire(P(r2, 1), P(v, 1));
    } else if (name === 'paralelo') {
      const b = addComp('bat', 120, 260, 3, 12).id, a = addComp('am', 180, 220, 0).id,
        r1 = addComp('res', 280, 260, 1, 100).id, r2 = addComp('res', 400, 260, 1, 220).id,
        r3 = addComp('res', 520, 260, 1, 330).id, g = addComp('gnd', 120, 340, 0).id;
      wire(P(b, 1), P(a, 0)); wire(P(a, 1), P(r1, 0)); wire(P(r1, 0), P(r2, 0)); wire(P(r2, 0), P(r3, 0));
      wire(P(b, 0), P(r1, 1)); wire(P(r1, 1), P(r2, 1)); wire(P(r2, 1), P(r3, 1)); wire(P(b, 0), P(g, 0));
    } else if (name === 'mixto') {
      const b = addComp('bat', 120, 260, 3, 12).id, r1 = addComp('res', 220, 220, 0, 100).id,
        r2 = addComp('res', 360, 260, 1, 220).id, r3 = addComp('res', 480, 260, 1, 330).id,
        g = addComp('gnd', 120, 340, 0).id;
      wire(P(b, 1), P(r1, 0)); wire(P(r1, 1), P(r2, 0)); wire(P(r2, 0), P(r3, 0));
      wire(P(b, 0), P(r2, 1)); wire(P(r2, 1), P(r3, 1)); wire(P(b, 0), P(g, 0));
    }
    syncUI(); render();
  }
  $('#ex').addEventListener('change', (e) => {
    if (e.target.value) {
      if (e.target.value === 'vacio' && S.comps.length && !confirm('¿Borrar todo el tablero?')) { e.target.value = ''; return; }
      load(e.target.value);
    }
    e.target.value = '';
  });

  load('serie');
})();
