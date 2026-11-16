// Shellworks — app controller: screens, workshop UI, artillery range, campaign & sandbox.
import {
  LEVELS, SANDBOX_TARGETS, SHELL_MATS, FILLERS, TMATS, T, PAINT_MATS, CELL, GRID_W, G_ROWS, CORE_WIN, MAX_SHOTS,
  FIN_NAMES, CANNON_MAX_BORE, CANNON_MAX_LEN, ROCKET_MAX_CAL, ROCKET_MAX_LEN, PROPELLANT, GRAVITY,
} from './data.js';
import {
  makeDesign, normalizeDesign, analyze, estimatePen, PRESETS, MODES, LAYER_KINDS, FUSES, newLayer, defaultMat,
  ownerColor, encodeDesign, decodeDesign,
} from './design.js';
import { World } from './sim.js';
import { FX } from './fx.js';
import { Renderer } from './render.js';
import { ShellEditor, makeShellSprite, makeCoreSprite } from './editor.js';
import { Grid } from './grid.js';
import { airDecel } from './physics.js';

const $ = id => document.getElementById(id);
const fmtC = v => '₵' + Math.round(v).toLocaleString();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;

// ---------------- storage ----------------
const KEY = 'shellworks.v1';
function loadStore() {
  const base = { progress: {}, designs: [], levelDesign: {}, quality: 'auto' };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return { ...base, ...s }; } catch (e) { /* ignore */ }
  return base;
}
const store = loadStore();
store.designs = store.designs.map(d => normalizeDesign(d));
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

// ---------------- state ----------------
const canvas = $('game');
const renderer = new Renderer(canvas);
const fx = new FX(1400);
const S = {
  screen: 'menu', mode: 'campaign', level: null,
  design: normalizeDesign(store.lastDesign || makeDesign('Ogive AP')),
  a: null, sprite: null, coreSprite: null,
  world: null, phase: 'idle', shotsLeft: 0, shotsFired: 0, spent: 0,
  elev: 1 * DEG, step: 0.1, pred: null, path: null, predDirty: true,
  view: 'gun', ts: 1, hold: 0, ff: false, settle: 0, cine: 0, camMode: 'aim', recoil: 0,
  sb: { target: 3, dist: 500, paint: false, mat: T.STEEL, slow: true },
  demo: null, demoT: 0,
};
S.a = analyze(S.design);

function setBarrel() { World.setBarrel(S.a.rocket ? 3.5 : clamp(S.a.bore * 40, 2.5, 6.5)); }
setBarrel();

// ---------------- screens ----------------
const SCREENS = ['menu', 'levels', 'workshop', 'hud'];
function show(id) {
  S.screen = id;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  if (id === 'workshop') requestAnimationFrame(() => { editor.resize(); refreshWorkshop(); });
  if (id === 'levels') buildLevelGrid();
  if (id === 'menu') startDemo();
  if (id !== 'hud') $('report').classList.add('hidden');
  renderer.resize();
}
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(html) { $('modalCard').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.go;
  if (g === 'help') return showHelp();
  if (g === 'sandbox') return enterSandbox();
  show(g);
}));

// ---------------- quality ----------------
const Q = { auto: { dpr: 2, parts: 1400, debris: 320 }, mid: { dpr: 1.5, parts: 1000, debris: 240 }, high: { dpr: 2, parts: 1800, debris: 420 }, low: { dpr: 1, parts: 650, debris: 150 } };
let qualityLive = store.quality === 'auto' ? (matchMedia('(pointer:coarse)').matches ? 'mid' : 'auto') : store.quality;
function applyQuality() {
  const q = Q[qualityLive] || Q.auto;
  renderer.maxDpr = q.dpr; renderer.resize();
  if (fx.max !== q.parts) fx.setMax(q.parts);
  fx.lite = qualityLive === 'low';
  S.debrisCap = q.debris;
}
$('quality').value = store.quality;
$('quality').addEventListener('change', e => { store.quality = e.target.value; save(); qualityLive = store.quality === 'auto' ? 'auto' : store.quality; applyQuality(); });
applyQuality();
const perf = { t: 0, frames: 0 };

// ---------------- workshop ----------------
const editor = new ShellEditor($('shellCanvas'), commit => onDesignChange(commit));
let tab = 'body';
let pendingRefresh = false;

function onDesignChange(commit) {
  S.a = analyze(S.design);
  setBarrel();
  S.predDirty = true;
  editor.set(S.design, S.a);
  if (!pendingRefresh) { pendingRefresh = true; requestAnimationFrame(() => { pendingRefresh = false; updateStats(); }); }
  if (commit) { store.lastDesign = S.design; if (S.mode === 'campaign' && S.level) store.levelDesign[S.level.id] = S.design; save(); }
}

function setDesign(d, quiet = false) {
  S.design = normalizeDesign(d);
  S.a = analyze(S.design);
  setBarrel();
  editor.sel = 1; editor.layerSel = null;
  S.sprite = makeShellSprite(S.design, S.a); S.coreSprite = makeCoreSprite(S.a);
  S.predDirty = true;
  if (!quiet) refreshWorkshop();
  onDesignChange(true);
}

for (const name of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = name; o.textContent = name; $('tPreset').appendChild(o); }
$('tPreset').addEventListener('change', e => {
  const n = e.target.value; e.target.value = '';
  if (!n) return;
  setDesign({ ...makeDesign(n), name: n });
  toast(`Template “${n}” loaded`);
});
$('tAdd').addEventListener('click', () => editor.addPoint());
$('tDel').addEventListener('click', () => { if (!editor.deletePoint()) toast('Select a middle point to delete (tip and base stay)'); });
$('tSmooth').addEventListener('click', e => { editor.smooth = !editor.smooth; e.target.classList.toggle('on', editor.smooth); });
$('dName').addEventListener('input', e => { S.design.name = e.target.value || 'Unnamed'; onDesignChange(true); });
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  if (tab !== 'inside') { editor.layerSel = null; editor.draw(); }
  buildTab();
}));

function matOptions(sel) {
  return Object.entries(SHELL_MATS).map(([k, m]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${m.name} — ${(m.rho / 1000).toFixed(1)} g/cc, H${m.H}, ₵${m.cost}/kg</option>`).join('');
}
function fillOptions(sel) {
  return Object.entries(FILLERS).map(([k, f]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${f.name} — ×${f.power} power, ₵${f.cost}/kg</option>`).join('');
}
function slider(key, label, min, max, step, scale = 1, unit = '', dec = 0) {
  const v = S.design[key] * scale;
  return `<div class="field"><label>${label}<b data-out="${key}">${(+v).toFixed(dec)}${unit}</b></label>
    <input type="range" data-k="${key}" data-scale="${scale}" data-unit="${unit}" data-dec="${dec}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
function seg(key, opts) {
  return `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(S.design[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function lslider(li, key, label, val) {
  return `<div class="field sm"><label>${label}<b data-lout="${li}-${key}">${Math.round(val * 100)}%</b></label><input type="range" data-li="${li}" data-lk="${key}" min="0" max="100" step="1" value="${Math.round(val * 100)}"></div>`;
}

function buildTab() {
  const d = S.design, a = S.a, rocket = d.launcher === 'rocket';
  let h = '';
  if (tab === 'body') {
    h += slider('caliber', 'Caliber (max diameter)', 20, rocket ? ROCKET_MAX_CAL * 1000 : CANNON_MAX_BORE * 1000, 1, 1000, ' mm');
    h += slider('length', 'Length', 40, (rocket ? ROCKET_MAX_LEN : CANNON_MAX_LEN) * 1000, 5, 1000, ' mm');
    h += `<div class="field"><label>Body / casing material</label><select data-k="jacket">${matOptions(d.jacket)}</select></div>`;
    h += `<p class="note">The body fills everything that isn't a layer. A soft body (copper, lead, aluminium) peels off on hard armour and only your hardest core carries on.</p>`;
    h += `<div class="field"><label>Tail fins</label>${seg('finSize', FIN_NAMES.map((n, i) => [i, n]))}</div>`;
    h += `<p class="note">Fins pull the centre of pressure (⊕) behind the centre of mass (G). Cannon rounds without fins are spun by rifling — that only keeps stubby shells (L/D under ~5) stable.${d.launcher === 'cannon' && d.finSize ? ' Fins must fit the gun bore: widen the bore on the Launch tab.' : ''}</p>`;
    h += `<p class="note">Limits: ≥ ${20} mm diameter, L/D ≤ 30, no thin waist, ≥ 3 mm casing walls around soft fillings, and the shell must survive its own launch acceleration.</p>`;
  } else if (tab === 'inside') {
    h += `<div class="behaviour"><small>Behaviour</small><b>${MODES[a.type]}</b><span>${behaviourText(a)}</span></div>`;
    h += `<div class="field"><label>Fuse (for explosive layers)</label>${seg('fuse', Object.entries(FUSES))}</div>`;
    if (d.fuse === 'delay') h += slider('fuseDelay', 'Delay — distance travelled after impact', 2, 150, 1, 100, ' cm');
    h += `<p class="note">${{ impact: 'Explosive goes off the instant the nose touches.', delay: 'The shell burrows in first, then the explosive goes off inside.', squash: 'Squash head: the filler pancakes on the armour face and the shock knocks a scab off the back.' }[d.fuse]} Shaped charges always fire on contact.</p>`;
    h += `<div class="layers-head"><b>Layers</b><small>later layers sit on top of earlier ones</small></div>`;
    if (!d.layers.length) h += `<p class="note">No layers — the shell is one solid lump of ${SHELL_MATS[d.jacket].name.toLowerCase()}.</p>`;
    d.layers.forEach((l, li) => {
      const st = a.lstat[li];
      h += `<div class="layer-card ${editor.layerSel === li ? 'on' : ''}" data-card="${li}">
        <div class="lc-head"><i style="background:${ownerColor(d, li)}"></i>
          <select data-li="${li}" data-lsel="kind">${Object.entries(LAYER_KINDS).map(([k, n]) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${n}</option>`).join('')}</select>
          ${l.kind === 'core' ? `<select data-li="${li}" data-lsel="mat">${matOptions(l.mat)}</select>` : ''}
          ${l.kind === 'charge' || l.kind === 'shaped' ? `<select data-li="${li}" data-lsel="mat">${fillOptions(l.mat)}</select>` : ''}
          <span class="grow"></span>
          <button class="btn xs" data-lmove="${li}" data-dir="-1" title="Move up">↑</button><button class="btn xs" data-lmove="${li}" data-dir="1" title="Move down">↓</button><button class="btn xs" data-ldel="${li}" title="Remove">✕</button>
        </div>
        <div class="lc-grid">${lslider(li, 'x0', 'Starts at (from tip)', l.x0)}${lslider(li, 'x1', 'Ends at', l.x1)}${lslider(li, 'ro', 'Outer radius', l.ro)}${lslider(li, 'ri', 'Inner radius (hollow centre)', l.ri)}</div>
        <small class="lc-mass">${st.mass > 0 ? st.mass.toFixed(2) + ' kg' : l.kind === 'hollow' ? 'empty space' : 'covered by other layers'}</small>
      </div>`;
    });
    h += `<div class="add-row">${Object.entries(LAYER_KINDS).map(([k, n]) => `<button class="btn sm" data-addlayer="${k}">+ ${n.replace(' (jet)', '').replace(' (air)', '')}</button>`).join('')}</div>`;
  } else if (tab === 'launch') {
    h += `<div class="field"><label>Fired from</label>${seg('launcher', [['cannon', 'Artillery gun'], ['rocket', 'Rocket rail']])}</div>`;
    if (!rocket) {
      const minBore = Math.ceil(a.D * 1000);
      h += `<div class="field"><label>Gun bore<b data-out="bore">${(Math.max(d.bore, a.D) * 1000).toFixed(0)} mm</b></label><input type="range" data-k="bore" data-scale="1000" data-unit=" mm" data-dec="0" min="${minBore}" max="${CANNON_MAX_BORE * 1000}" step="1" value="${Math.max(d.bore, a.D) * 1000}"></div>`;
      h += `<p class="note">A bore wider than the shell adds a discarding sabot (₵). The sabot also carries most of the launch load, so slim darts survive the shot. The barrel is ${(clamp(a.bore * 40, 2.5, 6.5)).toFixed(1)} m long (40 calibres).</p>`;
      const mx = a.maxCharge;
      h += `<div class="field"><label>Propellant charge<b data-out="charge">${Math.min(d.charge, mx).toFixed(2)} kg</b></label><input type="range" data-k="charge" data-scale="1" data-unit=" kg" data-dec="2" min="0.05" max="${mx.toFixed(2)}" step="0.05" value="${Math.min(d.charge, mx)}"></div>`;
      h += `<p class="note">Chamber limit for this bore: ${mx.toFixed(1)} kg. Propellant costs ₵${PROPELLANT.cannonCost}/kg. Gun gas can't push much past ~1,850 m/s.</p>`;
      if (a.propMass > 0) h += `<p class="note">🚀 This shell has rocket fuel: it's a rocket-assisted shell. The motor lights at the muzzle and adds speed in flight.</p>`;
    } else {
      h += `<p class="note">Rockets leave the rail slowly and speed up as the fuel burns. They can be up to ${ROCKET_MAX_CAL * 1000} mm wide and ${ROCKET_MAX_LEN} m long. Add <b>Rocket fuel</b> layers (usually at the back) on the Inside tab. They need fins to fly straight. Fuel costs ₵${PROPELLANT.rocketCost}/kg.</p>`;
      if (a.propMass <= 0) h += `<button class="btn sm" id="addMotor">+ Add a rocket fuel layer at the back</button>`;
      else h += `<p class="note">Fuel ${a.propMass.toFixed(2)} kg · burn ${a.burnTime.toFixed(2)} s · thrust ${(a.thrust / 1000).toFixed(1)} kN.</p>`;
    }
  } else if (tab === 'saved') {
    h += `<div class="row" style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap"><button class="btn sm" id="svSave">💾 Save “${escapeHtml(d.name)}”</button><button class="btn sm" id="svShare">Copy share code</button></div>`;
    h += `<p class="note">Saved shells show up in the shell rack on the range, so you can switch between them shot by shot.</p>`;
    if (!store.designs.length) h += `<p class="note">No saved shells yet.</p>`;
    store.designs.forEach((s, i) => {
      const aa = analyze(s);
      h += `<div class="saved-item"><span>${escapeHtml(s.name)} <small style="color:var(--dim)">${MODES[aa.type]} · ${fmtC(aa.totalCost)}</small></span><button class="btn sm" data-load="${i}">Load</button><button class="btn sm" data-del="${i}">✕</button></div>`;
    });
    h += `<div class="field" style="margin-top:14px"><label>Import a friend’s shell (paste code)</label><textarea id="svCode" rows="3" placeholder="Paste a share code here"></textarea></div><button class="btn sm" id="svImport">Import</button>`;
  }
  $('tabBody').innerHTML = h;
  bindTab();
}

function behaviourText(a) {
  switch (a.type) {
    case 'AP': return a.core ? `Hits as one piece; on armour harder than ${(a.jacketH * 2).toFixed(0)} hardness the body peels and the ${a.coreName} core goes on alone.` : 'One solid slug.';
    case 'APHE': return `Burrows in, then ${a.chargeTNT.toFixed(2)} kg TNT-eq goes off ${(S.design.fuseDelay * 100).toFixed(0)} cm after impact.`;
    case 'HE': return `${a.fillerTNT.toFixed(2)} kg TNT-eq bursts on contact (blast ≈ ${a.blastRadius.toFixed(1)} m).`;
    case 'HESH': return `${a.fillerTNT.toFixed(2)} kg TNT-eq squashes on the face — scabs plates up to ≈ ${((0.04 + 0.065 * Math.cbrt(a.fillerTNT)) * 1000).toFixed(0)} mm.`;
    case 'HEAT': return a.jets.length > 1 ? `Tandem: ${a.jets.length - 1} precursor jet(s) clear reactive tiles, main jet ≈ ${(a.jetPen * 1000).toFixed(0)} mm.` : `Jet ≈ ${(a.jetPen * 1000).toFixed(0)} mm of steel. Stand-off ${(a.standoff * 1000).toFixed(0)} mm.`;
  }
  return '';
}

function bindTab() {
  const body = $('tabBody');
  body.querySelectorAll('input[type=range][data-k]').forEach(inp => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k, sc = +inp.dataset.scale;
      S.design[k] = +inp.value / sc;
      const out = body.querySelector(`[data-out="${k}"]`);
      if (out) out.textContent = (+inp.value).toFixed(+inp.dataset.dec) + inp.dataset.unit;
      if (k === 'caliber' && S.design.launcher === 'cannon' && S.design.bore < S.design.caliber) S.design.bore = S.design.caliber;
      onDesignChange(false);
    });
    inp.addEventListener('change', () => { onDesignChange(true); if (['caliber', 'bore', 'length'].includes(inp.dataset.k) && tab === 'launch') buildTab(); if (tab === 'inside') buildTab(); });
  });
  body.querySelectorAll('select[data-k]').forEach(sel => sel.addEventListener('change', () => { S.design[sel.dataset.k] = sel.value; onDesignChange(true); }));
  body.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const k = g.dataset.seg; let v = b.dataset.v; if (k === 'finSize') v = +v;
    S.design[k] = v;
    if (k === 'launcher' && v === 'cannon') {
      S.design.caliber = Math.min(S.design.caliber, CANNON_MAX_BORE); S.design.length = Math.min(S.design.length, CANNON_MAX_LEN);
      S.design.bore = clamp(S.design.bore || S.design.caliber, S.design.caliber, CANNON_MAX_BORE);
    }
    onDesignChange(true); buildTab();
  })));
  // ----- layers -----
  body.querySelectorAll('input[data-lk]').forEach(inp => {
    inp.addEventListener('input', () => {
      const li = +inp.dataset.li, k = inp.dataset.lk, l = S.design.layers[li];
      let v = +inp.value / 100;
      if (k === 'x0') v = Math.min(v, l.x1 - 0.01); if (k === 'x1') v = Math.max(v, l.x0 + 0.01);
      if (k === 'ri') v = Math.min(v, l.ro - 0.02); if (k === 'ro') v = Math.max(v, l.ri + 0.02);
      l[k] = clamp(v, 0, 1); inp.value = Math.round(l[k] * 100);
      body.querySelector(`[data-lout="${li}-${k}"]`).textContent = Math.round(l[k] * 100) + '%';
      editor.layerSel = li;
      onDesignChange(false);
    });
    inp.addEventListener('change', () => { onDesignChange(true); buildTab(); });
  });
  body.querySelectorAll('select[data-lsel]').forEach(sel => sel.addEventListener('change', () => {
    const l = S.design.layers[+sel.dataset.li];
    if (sel.dataset.lsel === 'kind') { l.kind = sel.value; l.mat = defaultMat(l.kind); } else l.mat = sel.value;
    onDesignChange(true); buildTab();
  }));
  body.querySelectorAll('[data-card]').forEach(c => c.addEventListener('pointerdown', () => { editor.layerSel = +c.dataset.card; editor.draw(); body.querySelectorAll('[data-card]').forEach(x => x.classList.toggle('on', x === c)); }));
  body.querySelectorAll('[data-ldel]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.design.layers.splice(+b.dataset.ldel, 1); editor.layerSel = null; onDesignChange(true); buildTab(); }));
  body.querySelectorAll('[data-lmove]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const i = +b.dataset.lmove, j = i + +b.dataset.dir, L = S.design.layers;
    if (j < 0 || j >= L.length) return;
    [L[i], L[j]] = [L[j], L[i]]; editor.layerSel = j; onDesignChange(true); buildTab();
  }));
  body.querySelectorAll('[data-addlayer]').forEach(b => b.addEventListener('click', () => {
    if (S.design.layers.length >= 10) return toast('Max 10 layers');
    S.design.layers.push(newLayer(b.dataset.addlayer, S.design)); editor.layerSel = S.design.layers.length - 1; onDesignChange(true); buildTab();
  }));
  const q = id => body.querySelector('#' + id);
  if (q('addMotor')) q('addMotor').addEventListener('click', () => { S.design.layers.push({ kind: 'motor', mat: null, x0: 0.45, x1: 1, ro: 0.85, ri: 0 }); onDesignChange(true); buildTab(); });
  if (q('svSave')) q('svSave').addEventListener('click', () => {
    const i = store.designs.findIndex(x => x.name === S.design.name);
    const copy = JSON.parse(JSON.stringify(S.design));
    if (i >= 0) store.designs[i] = copy; else store.designs.unshift(copy);
    save(); buildTab(); toast('Saved — it is now in your shell rack');
  });
  if (q('svShare')) q('svShare').addEventListener('click', async () => {
    const code = encodeDesign(S.design);
    q('svCode').value = code;
    try { await navigator.clipboard.writeText(code); toast('Share code copied — send it to a friend'); } catch (e) { q('svCode').select(); toast('Code shown below — copy it'); }
  });
  if (q('svImport')) q('svImport').addEventListener('click', () => {
    const d = decodeDesign(q('svCode').value);
    if (!d) return toast('That code is not valid');
    setDesign(d); toast(`Imported “${d.name}”`);
  });
  body.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { setDesign(store.designs[+b.dataset.load]); toast('Loaded'); }));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { store.designs.splice(+b.dataset.del, 1); save(); buildTab(); }));
}

function rangeDist() { return S.mode === 'campaign' && S.level ? S.level.dist : S.sb.dist; }

function burnoutSpeed(a) {
  let v = a.muzzleV, m = a.flightMass, t = 0;
  if (!a.thrust) return v;
  const h = 1 / 120, mdot = a.mass.prop / a.burnTime;
  while (t < a.burnTime) { v += (a.thrust / m - airDecel(a, v, true, 0.002) / m - GRAVITY * 0.08) * h; m -= mdot * h; t += h; }
  return v;
}

function updateStats() {
  const d = S.design, a = S.a;
  $('wsCost').textContent = fmtC(a.totalCost);
  const dist = rangeDist();
  let impact = null;
  if (!a.errors.some(e => !e.includes('clamped'))) {
    const sol = World.solveAngle(a, dist + 5, 1.2);
    if (sol.ok) impact = sol;
  }
  const vStart = burnoutSpeed(a);
  let pen = '—', penLabel = 'Penetration';
  if (a.type === 'HE' || a.type === 'HESH') { penLabel = 'Blast radius'; pen = `${a.blastRadius.toFixed(1)} m`; }
  else if (a.type === 'HEAT') { penLabel = 'Jet (steel)'; pen = `${(a.jetPen * 1000).toFixed(0)} mm`; }
  else if (impact) pen = `${estimatePen(a, impact.v).toFixed(0)} mm`;
  const stabTxt = a.stab >= 0.95 ? 'Stable' : a.stab >= 0.5 ? 'Wobbly' : a.stab > 0.05 ? 'Unstable' : 'Tumbles';
  const stabCol = a.stab >= 0.95 ? 'var(--good)' : a.stab >= 0.5 ? '#ffd34d' : 'var(--danger)';
  const stabWhy = a.stabMode === 'spin' ? `spin, Sg ${a.Sg.toFixed(2)}` : `margin ${a.margin.toFixed(2)} cal`;
  const ll = a.launchLoad, llCol = ll < 0.7 ? 'var(--good)' : ll <= 1 ? '#ffd34d' : 'var(--danger)';
  let h = `
    <div class="stat"><small>Mass</small><b>${a.flightMass.toFixed(a.flightMass < 10 ? 2 : 1)} kg</b></div>
    <div class="stat"><small>${a.thrust > 0 ? 'Burn-out v' : 'Muzzle v'}</small><b>${vStart.toFixed(0)} m/s</b></div>
    <div class="stat"><small>Impact v @${dist} m</small><b>${impact ? impact.v.toFixed(0) + ' m/s' : '<span style="color:var(--danger)">no reach</span>'}</b></div>
    <div class="stat"><small>${penLabel}</small><b>${pen}</b></div>
    <div class="stat"><small>Drag Cd (M2)</small><b>${(a.cdWave * Math.pow(1.2 / 2, 0.5) * 1.1 + a.cdBase + a.cdFric + a.cdFin).toFixed(2)}</b></div>
    <div class="stat"><small>L / D</small><b>${a.LD.toFixed(1)}</b></div>
    <div class="stat wide"><small>Stability — <span style="color:${stabCol}">${stabTxt}</span> (${stabWhy})</small><div class="stab"><i style="width:${(a.stab * 100).toFixed(0)}%;background:${stabCol}"></i></div></div>
    <div class="stat wide"><small>Launch load — <span style="color:${llCol}">${(ll * 100).toFixed(0)}% of strength</span> (${Math.round(a.launchG).toLocaleString()} g)</small><div class="stab"><i style="width:${Math.min(100, ll * 100).toFixed(0)}%;background:${llCol}"></i></div></div>`;
  if (a.fillerTNT > 0) h += `<div class="stat"><small>Explosive (TNT eq)</small><b>${a.fillerTNT.toFixed(2)} kg</b></div>`;
  if (a.sabotMass > 0) h += `<div class="stat"><small>Sabot</small><b>${a.sabotMass.toFixed(2)} kg</b></div>`;
  if (impact) h += `<div class="stat"><small>Flight time</small><b>${impact.t.toFixed(2)} s</b></div>`;
  for (const e of a.errors) h += `<div class="warn">⚠ ${e}</div>`;
  $('stats').innerHTML = h;
  if (document.activeElement !== $('dName')) $('dName').value = d.name;
}

function refreshWorkshop() {
  if (S.mode === 'campaign' && S.level) {
    const L = S.level;
    $('wsBrief').textContent = `Stage ${L.id} · ${L.name} · ${L.dist} m · max ${MAX_SHOTS} shells · ★★★ ≤ ${fmtC(L.stars[0])}`;
  } else $('wsBrief').textContent = `Sandbox · ${S.sb.dist} m range`;
  $('dName').value = S.design.name;
  editor.set(S.design, S.a);
  buildTab(); updateStats();
}

$('wsBack').addEventListener('click', () => { if (S.mode === 'campaign') show('levels'); else show('menu'); });
$('wsDeploy').addEventListener('click', () => {
  const errs = S.a.errors.filter(e => !e.includes('clamped'));
  if (errs.length) return toast('⚠ ' + errs[0], 3500);
  S.sprite = makeShellSprite(S.design, S.a); S.coreSprite = makeCoreSprite(S.a);
  if (!S.world || (S.mode === 'campaign' && S.attemptLevel !== S.level.id)) newAttempt();
  enterRange();
});

// ---------------- campaign ----------------
function starsFor(L, cost) { return cost <= L.stars[0] ? 3 : cost <= L.stars[1] ? 2 : 1; }
function unlocked(L) { return L.id === 1 || !!store.progress[L.id - 1] || !!store.progress[L.id]; }

function previewCanvas(build) {
  const g = new Grid(build);
  const c = document.createElement('canvas'); c.width = GRID_W; c.height = 100;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(GRID_W, 100);
  const off = G_ROWS - 96;
  for (let j = 0; j < 100; j++) for (let i = 0; i < GRID_W; i++) {
    const m = g.mat[(j + off) * GRID_W + i]; const k = (j * GRID_W + i) * 4;
    const col = m ? TMATS[m].color : [14, 21, 30];
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function buildLevelGrid() {
  const grid = $('levelGrid'); grid.innerHTML = '';
  let total = 0;
  for (const L of LEVELS) {
    const p = store.progress[L.id];
    if (p) total += p.stars;
    const b = document.createElement('button');
    b.className = 'lvl' + (unlocked(L) ? '' : ' locked');
    const st = p ? p.stars : 0;
    b.innerHTML = `<span class="n">STAGE ${L.id}</span><span class="t">${L.name}</span><span class="s">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span><span class="b">${p ? 'Best ' + fmtC(p.best) : L.dist + ' m · ★★★ ≤ ' + fmtC(L.stars[0])}</span>`;
    b.insertBefore(previewCanvas(L.build), b.firstChild);
    b.addEventListener('click', () => openLevel(L));
    grid.appendChild(b);
  }
  $('totalStars').textContent = `★ ${total} / ${LEVELS.length * 3}`;
}

function openLevel(L) {
  S.mode = 'campaign'; S.level = L;
  const d = store.levelDesign[L.id] || store.lastDesign || makeDesign(L.id <= 2 ? 'Cheap HE' : 'Ogive AP');
  setDesign(d, true);
  S.world = null; S.attemptLevel = null;
  show('workshop');
  modal(`<h3>Stage ${L.id}: ${escapeHtml(L.name)}</h3><p>${escapeHtml(L.brief)}</p>
    <div class="kv"><span>Range</span><b>${L.dist} m</b><span>Shells</span><b>up to ${MAX_SHOTS} — a 6th means defeat</b><span>Win</span><b>destroy ≥ ${CORE_WIN * 100}% of the core</b>
    <span>★★★</span><b>total ≤ ${fmtC(L.stars[0])}</b><span>★★</span><b>total ≤ ${fmtC(L.stars[1])}</b>${store.progress[L.id] ? `<span>Your best</span><b>${fmtC(store.progress[L.id].best)}</b>` : ''}</div>
    <div class="row"><button class="btn primary" id="mOk">Design a shell</button></div>`);
  $('mOk').onclick = closeModal;
}

function newAttempt() {
  fx.clear();
  if (S.mode === 'campaign') {
    S.world = new World({ build: S.level.build, dist: S.level.dist, fx });
    S.shotsLeft = MAX_SHOTS; S.attemptLevel = S.level.id;
  } else {
    S.world = new World({ build: SANDBOX_TARGETS[S.sb.target].build, dist: S.sb.dist, fx });
    S.shotsLeft = Infinity;
  }
  S.spent = 0; S.shotsFired = 0;
  S.world.bbox = null;
  S.phase = 'aim'; S.view = 'gun';
  S.elev = startingElevation();
  S.predDirty = true;
  $('report').classList.add('hidden');
}

// a gunner's first guess: lay the gun on the foot of the structure
function startingElevation() {
  const w = S.world, b = w.bbox || (w.bbox = w.grid.bounds());
  const sol = World.solveAngle(S.a, w.x0 + b.i0 * CELL, 0.3);
  return Math.round((sol.ok ? sol.angle : 10 * DEG) / DEG * 10) / 10 * DEG;
}

// ---------------- range ----------------
function enterRange() {
  show('hud');
  $('sandboxBar').classList.toggle('hidden', S.mode !== 'sandbox');
  if (S.phase !== 'flight') S.phase = 'aim';
  S.predDirty = true;
  buildRack();
  snapCamera();
  updateHud();
}

function buildRack() {
  const sel = $('hudShell');
  let h = `<option value="cur">▶ ${escapeHtml(S.design.name)} — ${fmtC(S.a.totalCost)}</option>`;
  store.designs.forEach((d, i) => { if (d.name !== S.design.name) h += `<option value="${i}">${escapeHtml(d.name)} — ${fmtC(analyze(d).totalCost)}</option>`; });
  if (!store.designs.length) h += `<option disabled>(save shells in the workshop to rack them here)</option>`;
  sel.innerHTML = h; sel.value = 'cur';
}
$('hudShell').addEventListener('change', e => {
  const v = e.target.value; if (v === 'cur') return;
  const d = store.designs[+v];
  setDesign(d, true);
  const errs = S.a.errors.filter(x => !x.includes('clamped'));
  if (errs.length) toast('⚠ ' + errs[0], 3000); else toast(`Loaded “${d.name}”`);
  buildRack();
});

function updatePrediction() {
  if (!S.world || !S.predDirty) return;
  S.predDirty = false;
  const a = S.a, w = S.world;
  S.path = [];
  const pr = w.predict(a, S.elev, S.path);
  S.pred = pr.hit ? pr : (pr.short ? { ...pr, x: pr.x, y: 0 } : pr);
  $('elVal').textContent = (S.elev / DEG).toFixed(S.step < 0.1 ? 2 : S.step < 1 ? 2 : 1) + '°';
  let txt;
  if (pr.hit) {
    const what = TMATS[pr.mat].name;
    let extra = '';
    if (a.type === 'HE' || a.type === 'HESH') extra = ` · ${a.fillerTNT.toFixed(2)} kg TNT`;
    else if (a.type === 'HEAT') extra = ` · jet ${(a.jetPen * 1000).toFixed(0)} mm`;
    else extra = ` · pen ≈ <b>${estimatePen(a, pr.v).toFixed(0)} mm</b>`;
    txt = `<span class="${pr.mat === T.CORE ? 'hit-core' : 'hit'}">◎ Hits ${what}</span> at ${pr.y.toFixed(1)} m · <b>${pr.v.toFixed(0)} m/s</b>${extra} · ${pr.t.toFixed(1)} s`;
  } else if (pr.over) txt = `<span class="miss">Flies over the target</span> — lower the gun`;
  else txt = `<span class="miss">Lands ${Math.max(0, Math.round(w.x0 - pr.x))} m short</span> — raise the gun${pr.apex ? '' : ''}`;
  $('aimInfo').innerHTML = txt;
}

function setElev(v) {
  const nv = clamp(v, -2 * DEG, 70 * DEG);
  if (nv !== S.elev) { S.elev = nv; S.predDirty = true; }
}
// elevation buttons with hold-to-repeat
for (const [id, dir] of [['elUp', 1], ['elDown', -1]]) {
  const b = $(id); let timer = null, rep = null;
  const stop = () => { clearTimeout(timer); clearInterval(rep); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S.phase !== 'aim') return;
    setElev(S.elev + dir * S.step * DEG);
    timer = setTimeout(() => { rep = setInterval(() => setElev(S.elev + dir * S.step * DEG), 60); }, 350);
  });
  b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
}
document.querySelectorAll('#steps button').forEach(b => b.addEventListener('click', () => {
  S.step = +b.dataset.step; document.querySelectorAll('#steps button').forEach(x => x.classList.toggle('on', x === b)); S.predDirty = true;
}));
$('viewBtn').addEventListener('click', () => { S.view = S.view === 'gun' ? 'target' : 'gun'; });

function updateHud() {
  const w = S.world;
  if (S.mode === 'campaign') {
    $('hudName').textContent = `Stage ${S.level.id} · ${S.level.name}`;
    $('hudDist').textContent = `${S.level.dist} m · ★★★ ≤ ${fmtC(S.level.stars[0])}`;
    $('hudShots').textContent = `${S.shotsFired}/${MAX_SHOTS}`;
  } else {
    $('hudName').textContent = 'Sandbox';
    $('hudDist').textContent = `${S.sb.dist} m`;
    $('hudShots').textContent = `${S.shotsFired}`;
  }
  $('hudSpent').textContent = fmtC(S.spent);
  const cf = w ? w.grid.coreFraction() : 0;
  $('coreBar').style.width = (Math.min(1, cf) * 100).toFixed(0) + '%';
  $('corePct').textContent = (cf * 100).toFixed(0) + '%';
  const aiming = S.phase === 'aim';
  $('hudFire').disabled = !aiming;
  $('aimBar').classList.toggle('dim', !aiming);
}

$('hudFire').addEventListener('click', fire);
function fire() {
  if (S.phase !== 'aim' || !S.world) return;
  const errs = S.a.errors.filter(e => !e.includes('clamped'));
  if (errs.length) return toast('⚠ ' + errs[0]);
  if (S.mode === 'campaign' && S.shotsLeft <= 0) return;
  S.sprite = makeShellSprite(S.design, S.a); S.coreSprite = makeCoreSprite(S.a);
  setBarrel();
  S.world.fire(S.design, S.a, S.elev);
  S.world.debrisBudget = S.debrisCap;
  if (!S.a.rocket) { const [mx, my] = World.muzzle(S.elev); fx.casing(mx - Math.cos(S.elev) * World.barrel * 0.9, my - Math.sin(S.elev) * World.barrel * 0.9, S.elev); }
  S.spent += S.a.totalCost; S.shotsFired++;
  if (S.mode === 'campaign') S.shotsLeft--;
  S.phase = 'flight'; S.hold = 0; S.ff = false; S.settle = 0; S.ts = 1; S.recoil = 1;
  S.camMode = 'launch';
  $('report').classList.add('hidden');
  updateHud();
}

function showReport(shot, coreDelta) {
  const r = $('report');
  const items = shot.log.map(t => `<li>${escapeHtml(t)}</li>`).join('');
  r.innerHTML = `<div class="rep-head"><b>${escapeHtml(shot.result || 'Shot report')}</b><button class="btn xs" id="repClose">✕</button></div>
    <ul>${items}</ul><div class="rep-core">Core damage this shot: <b>${coreDelta >= 0.005 ? '+' + (coreDelta * 100).toFixed(0) + '%' : 'none'}</b></div>`;
  r.classList.remove('hidden');
  $('repClose').onclick = () => r.classList.add('hidden');
}

function endShot() {
  const w = S.world, cf = w.grid.coreFraction();
  const shot = w.shot || { log: [] };
  updateHud();
  showReport(shot, cf - (shot.coreBefore || 0));
  if (S.mode === 'sandbox') { S.phase = 'aim'; S.predDirty = true; updateHud(); return; }
  if (cf >= CORE_WIN) {
    S.phase = 'result';
    const L = S.level, st = starsFor(L, S.spent);
    const prev = store.progress[L.id];
    const isBest = !prev || S.spent < prev.best;
    store.progress[L.id] = { best: Math.min(S.spent, prev ? prev.best : Infinity), stars: Math.max(st, prev ? prev.stars : 0) };
    save();
    const next = LEVELS.find(x => x.id === L.id + 1);
    setTimeout(() => {
      modal(`<h3>Target destroyed</h3><div class="big-stars">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></div>
        <div class="kv"><span>Core destroyed</span><b>${(cf * 100).toFixed(0)}%</b><span>Shells used</span><b>${S.shotsFired} / ${MAX_SHOTS}</b><span>Total cost</span><b>${fmtC(S.spent)}</b>
        <span>Best on this stage</span><b>${fmtC(store.progress[L.id].best)}${isBest && prev ? ' — new record!' : ''}</b>
        <span>Next star at</span><b>${st >= 3 ? 'max' : fmtC(L.stars[st === 2 ? 0 : 1])}</b></div>
        <div class="row"><button class="btn" id="mRetry">Retry cheaper</button>${next ? '<button class="btn primary" id="mNext">Next stage ›</button>' : '<button class="btn primary" id="mDone">Campaign</button>'}</div>`);
      $('mRetry').onclick = () => { closeModal(); S.world = null; show('workshop'); };
      if (next) $('mNext').onclick = () => { closeModal(); openLevel(next); };
      else $('mDone').onclick = () => { closeModal(); show('levels'); };
    }, 700);
    return;
  }
  if (S.shotsLeft > 0) {
    S.phase = 'aim'; S.predDirty = true; updateHud();
    toast(`Core ${(cf * 100).toFixed(0)}% — ${S.shotsLeft} shell${S.shotsLeft > 1 ? 's' : ''} left. Swap shells from the rack or the workshop.`, 3200);
    return;
  }
  S.phase = 'result';
  setTimeout(() => {
    modal(`<h3>Out of shells</h3><p style="color:var(--dim)">All ${MAX_SHOTS} shells fired and the core survived.</p>
      <div class="kv"><span>Core destroyed</span><b>${(cf * 100).toFixed(0)}% / ${CORE_WIN * 100}%</b><span>Spent</span><b>${fmtC(S.spent)}</b></div>
      <div class="row"><button class="btn" id="mWs">Workshop</button><button class="btn primary" id="mRetry">Retry</button></div>`);
    $('mWs').onclick = () => { closeModal(); S.world = null; show('workshop'); };
    $('mRetry').onclick = () => { closeModal(); newAttempt(); enterRange(); };
  }, 700);
}

$('hudWorkshop').addEventListener('click', () => { if (S.phase === 'flight') return; show('workshop'); });
$('hudBack').addEventListener('click', () => { if (S.mode === 'campaign') show('levels'); else show('menu'); });

// ---------------- sandbox ----------------
SANDBOX_TARGETS.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = t.name; $('sbTarget').appendChild(o); });
function enterSandbox() {
  S.mode = 'sandbox'; S.level = null;
  setDesign(store.lastDesign || makeDesign('Ogive AP'), true);
  $('sbTarget').value = S.sb.target; $('sbDist').value = S.sb.dist; $('sbDistV').textContent = S.sb.dist + ' m';
  S.world = null;
  show('workshop');
}
$('sbTarget').addEventListener('change', e => { if (S.phase === 'flight') return; S.sb.target = +e.target.value; newAttempt(); snapCamera(); updateHud(); });
$('sbDist').addEventListener('input', e => { S.sb.dist = +e.target.value; $('sbDistV').textContent = S.sb.dist + ' m'; });
$('sbDist').addEventListener('change', () => {
  if (!S.world || S.phase === 'flight') return;
  S.world.x0 = S.world.dist = S.sb.dist;
  S.elev = startingElevation(); S.predDirty = true; snapCamera(); updateHud();
});
$('sbReset').addEventListener('click', () => { if (S.phase === 'flight') return; newAttempt(); updateHud(); });
$('sbSlow').addEventListener('click', e => { S.sb.slow = !S.sb.slow; e.target.classList.toggle('on', S.sb.slow); });
$('sbPaint').addEventListener('click', e => {
  S.sb.paint = !S.sb.paint; e.target.classList.toggle('on', S.sb.paint); $('paintBar').classList.toggle('hidden', !S.sb.paint);
  if (S.sb.paint) S.view = 'target';
});
(function buildPaint() {
  const bar = $('paintBar');
  const er = document.createElement('button'); er.className = 'erase'; er.textContent = 'Erase'; er.dataset.m = 0; bar.appendChild(er);
  for (const m of PAINT_MATS) {
    const b = document.createElement('button'); const c = TMATS[m].color;
    b.style.background = `rgb(${c[0]},${c[1]},${c[2]})`; b.title = TMATS[m].name; b.dataset.m = m;
    if (m === S.sb.mat) b.classList.add('on');
    bar.appendChild(b);
  }
  const lab = document.createElement('span'); lab.className = 'mini'; lab.id = 'paintName'; lab.textContent = TMATS[S.sb.mat].name; bar.appendChild(lab);
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.sb.mat = +b.dataset.m; bar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('paintName').textContent = S.sb.mat ? TMATS[S.sb.mat].name : 'Erase';
  });
})();

// ---------------- input on the range ----------------
function insetRect() {
  const w = renderer.w, h = renderer.h;
  const top = S.mode === 'sandbox' ? (S.sb.paint ? 150 : 104) : 62;
  const iw = Math.round(Math.min(w * 0.42, 380)), ih = Math.round(Math.min(iw * 0.6, h * 0.3));
  return { x: w - iw - 10, y: top, w: iw, h: ih };
}
function screenToWorld(px, py) {
  const cam = renderer.cam, r = canvas.getBoundingClientRect();
  return [(px - r.left - renderer.w / 2) / cam.scale + cam.x, (renderer.h / 2 - (py - r.top)) / cam.scale + cam.y];
}
let painting = false, drag = null;
function paintAt(e) {
  const [x, y] = screenToWorld(e.clientX, e.clientY);
  const w = S.world, i0 = w.cellI(x), j0 = w.cellJ(y);
  for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) w.grid.paint(i0 + c, j0 + b, S.sb.mat);
  S.predDirty = true;
  updateHud();
}
canvas.addEventListener('pointerdown', e => {
  if (S.screen !== 'hud' || !S.world) return;
  if (S.phase === 'flight') { S.ff = true; return; }
  if (S.phase !== 'aim') return;
  const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const ir = insetRect();
  if (!S.sb.paint && px >= ir.x && px <= ir.x + ir.w && py >= ir.y && py <= ir.y + ir.h) { S.view = S.view === 'gun' ? 'target' : 'gun'; return; }
  if (S.mode === 'sandbox' && S.sb.paint && S.view === 'target') { painting = true; paintAt(e); canvas.setPointerCapture?.(e.pointerId); return; }
  drag = { y: e.clientY, elev: S.elev }; canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (painting) return paintAt(e);
  if (drag && S.phase === 'aim') setElev(drag.elev + (drag.y - e.clientY) * S.step * 0.1 * DEG);
});
window.addEventListener('pointerup', () => { painting = false; drag = null; });
window.addEventListener('keydown', e => {
  if (S.screen !== 'hud' || S.phase !== 'aim') return;
  if (e.key === 'ArrowUp') { setElev(S.elev + S.step * DEG); e.preventDefault(); }
  if (e.key === 'ArrowDown') { setElev(S.elev - S.step * DEG); e.preventDefault(); }
  if (e.key === ' ' || e.key === 'Enter') { fire(); e.preventDefault(); }
});

// ---------------- camera ----------------
function hudPads() { return { top: S.mode === 'sandbox' ? (S.sb.paint ? 150 : 104) : 62, bot: 150 }; }
function targetCam(vw = renderer.w, vh = renderer.h, pads = hudPads()) { return renderer.fitTarget(S.world, vw, vh, pads.top, pads.bot); }
function gunCam(vw = renderer.w, vh = renderer.h, pads = hudPads()) { return renderer.fitGun(vw, vh, pads.top, pads.bot); }
function snapCamera() { if (!S.world) return; const t = S.view === 'gun' && S.phase === 'aim' ? gunCam() : targetCam(); Object.assign(renderer.cam, t); }

function impactPoint() {
  const w = S.world;
  if (S.pred && S.pred.hit) return [S.pred.x, S.pred.y];
  const b = w.bbox || w.grid.bounds();
  return [w.x0 + b.i0 * CELL, 1.2];
}

function updateCamera(dt) {
  const cam = renderer.cam, w = S.world;
  if (!w) return;
  const p = w.proj, W = renderer.w, H = renderer.h;
  const ease = (t, k) => { const f = Math.min(1, dt * k); cam.x += (t.x - cam.x) * f; cam.y += (t.y - cam.y) * f; cam.scale += (t.scale - cam.scale) * f; };
  if (S.phase === 'aim' || S.phase === 'result' || S.phase === 'post') { ease(S.view === 'gun' && S.phase === 'aim' ? gunCam() : targetCam(), 6); return; }
  if (!p) { ease(targetCam(), 2.5); return; }
  if (S.camMode === 'follow' || S.camMode === 'launch') {
    const ts = clamp(W / 34, 10, 60);
    const half = W / 2 / ts;
    cam.x = Math.max(p.x + half * 0.35, half - 5);
    cam.scale += (ts - cam.scale) * Math.min(1, dt * 10);
    cam.y += (Math.max(p.y * 0.85 + 1.2, H * 0.25 / ts) - cam.y) * Math.min(1, dt * 8);
    return;
  }
  if (S.camMode === 'cine') {
    const [ix, iy] = impactPoint();
    const dist = Math.hypot(ix - p.x, iy - p.y);
    const span = clamp(dist * 1.5 + 3, 4, 40);
    const sc = W / span;
    cam.x = p.x + (ix - p.x) * 0.55; cam.y = Math.max(p.y + (iy - p.y) * 0.55, H * 0.3 / sc);
    cam.scale += (sc - cam.scale) * Math.min(1, dt * 12);
    return;
  }
  // inside the target: hold close on the penetrator
  const sc = W / 6;
  ease({ x: p.x + 0.8, y: Math.max(p.y, H * 0.3 / sc), scale: sc }, 8);
}

// ---------------- demo (menu background) ----------------
function startDemo() {
  const t = SANDBOX_TARGETS[3];
  S.demo = new World({ build: t.build, dist: 60, fx });
  S.demoT = 1.2; S.demoDesigns = ['Ogive AP', 'Cheap HE', 'HEAT round', 'APHE', 'HESH', 'Tandem HEAT'];
  fx.clear();
}
function stepDemo(dt) {
  const w = S.demo; if (!w) return;
  S.demoT -= dt;
  if (S.demoT <= 0 && !w.busy()) {
    if (w.grid.coreFraction() > 0.6 || Math.random() < 0.15) { w.grid.reset(); w.embedded = null; w.hot.length = 0; }
    const name = S.demoDesigns[(Math.random() * S.demoDesigns.length) | 0];
    const d = makeDesign(name), a = analyze(d);
    S.demoSprite = makeShellSprite(d, a); S.demoCore = makeCoreSprite(a);
    World.setBarrel(clamp(a.bore * 40, 2.5, 6.5));
    const gx = w.x0 + 4 + Math.random() * 1.5, gy = 0.5 + Math.random() * 4.5;
    w.fire(d, a, World.solveAngle(a, gx, gy).angle);
    w.debrisBudget = S.debrisCap;
    S.demoT = 2.6;
  }
  const near = w.proj && w.proj.x > w.x0 - 8;
  const ts = near || w.frags.length ? 0.12 : 1;
  w.step(dt * ts);
  w.cool(dt * Math.max(ts, 0.35));
  fx.update(dt * Math.max(ts, 0.35));
  const cam = renderer.cam, t = renderer.fitTarget(w, renderer.w, renderer.h, 40, 40);
  cam.x = t.x + 1.5; cam.y = t.y; cam.scale = t.scale * 0.85;
}

// ---------------- main loop ----------------
let last = performance.now(), coolAcc = 0;
function loop(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  perfTrack(dtReal);
  S.recoil = Math.max(0, S.recoil - dtReal * 1.6);
  if (S.screen === 'menu') {
    stepDemo(dtReal);
    if (S.demo) renderer.render(S.demo, fx, { sprite: S.demoSprite, coreSprite: S.demoCore, angle: 0 });
  } else if (S.screen === 'hud' && S.world) {
    setBarrel();
    if (S.phase === 'aim') updatePrediction();
    stepRange(dtReal);
    updateCamera(dtReal);
    const aiming = S.phase === 'aim';
    let inset = null;
    if (aiming && !S.sb.paint) {
      const vp = insetRect(), pads = { top: 6, bot: 6 };
      inset = { vp, cam: S.view === 'gun' ? targetCam(vp.w, vp.h, pads) : gunCam(vp.w, vp.h, { top: 8, bot: 8 }), label: S.view === 'gun' ? 'TARGET ⇄' : 'GUN ⇄' };
    }
    renderer.render(S.world, fx, {
      sprite: S.sprite, coreSprite: S.coreSprite, angle: S.elev, rocket: S.a.rocket, bore: S.a.bore, recoil: S.recoil,
      loaded: aiming && S.a.rocket, shellL: S.a.L, shellD: S.a.D,
      pred: S.pred, path: S.path, showAim: aiming, showArc: aiming,
      showGridBox: S.mode === 'sandbox' && S.sb.paint, inset,
      cine: S.cine, cineText: S.cine > 0.3 && S.ts < 0.5 ? `SLOW MOTION ×${Math.max(2, Math.round(1 / S.ts))}` : '',
    });
  }
  requestAnimationFrame(loop);
}

function stepRange(dtReal) {
  const w = S.world;
  let cineTarget = 0;
  if (S.phase === 'flight') {
    const p = w.proj;
    const slowOn = S.mode === 'campaign' || S.sb.slow;
    let target = 1;
    if (p) {
      const v = Math.hypot(p.vx, p.vy) || 1;
      if (p.state === 'flight') {
        const [ix, iy] = impactPoint();
        const dist = Math.hypot(ix - p.x, iy - p.y);
        const trig = clamp(v * 0.04, 20, 40);
        if (slowOn && dist < trig && p.x < w.x0 + w.gridW) {
          const Treal = 0.2 + dist * 0.025;
          target = clamp(Math.max(dist, 0.3) / (v * Treal), 0.0015, 0.08);
          S.camMode = 'cine'; cineTarget = 1;
        } else {
          target = S.ff && dist > v * 0.6 ? 6 : 1;
          if (S.camMode !== 'cine') S.camMode = p.t < 0.05 ? 'launch' : 'follow';
          else { S.camMode = 'follow'; }
        }
      } else {
        target = slowOn ? clamp((p.inSolid ? 1.6 : 6) / p.pen.v, 0.0008, 0.06) : 1;
        S.camMode = 'impact'; cineTarget = slowOn ? 1 : 0;
      }
      S.hold = 0;
    } else {
      S.hold += dtReal;
      target = slowOn && S.hold < 1.0 ? 0.08 : 1;
      cineTarget = slowOn && S.hold < 1.0 ? 1 : 0;
      S.camMode = 'after';
    }
    // slow down instantly, speed back up smoothly
    S.ts = target < S.ts ? target : S.ts + (target - S.ts) * Math.min(1, dtReal * 2.5);
    w.step(dtReal * S.ts);
    if (!w.busy()) {
      S.settle += dtReal;
      if (S.settle > 2.0) { S.phase = 'post'; endShot(); }
    }
    if ((S.frameN = (S.frameN || 0) + 1) % 6 === 0) updateHud();
  } else S.ts += (1 - S.ts) * Math.min(1, dtReal * 3);
  S.cine += (cineTarget - S.cine) * Math.min(1, dtReal * 6);
  const fxScale = S.ts < 1 ? Math.max(S.ts, S.camMode === 'impact' ? 0.12 : 0.3) : Math.min(S.ts, 2);
  fx.update(dtReal * fxScale);
  coolAcc += dtReal * fxScale;
  if (coolAcc > 0.05) { w.cool(coolAcc); coolAcc = 0; }
}

function perfTrack(dt) {
  perf.t += dt; perf.frames++;
  if (perf.t >= 2) {
    const fps = perf.frames / perf.t;
    $('fpsLabel').textContent = `${fps.toFixed(0)} fps`;
    if (store.quality === 'auto' && fps < 42 && (S.screen === 'hud' || S.screen === 'menu')) {
      if (qualityLive === 'auto') qualityLive = 'mid';
      else if (qualityLive === 'mid') qualityLive = 'low';
      applyQuality();
    }
    perf.t = 0; perf.frames = 0;
  }
}

// ---------------- help ----------------
function showHelp() {
  modal(`<div class="help"><h3>How it works</h3>
  <p>Each stage hides a <b style="color:#e44">red core</b>. Destroy at least ${CORE_WIN * 100}% of it with <b>no more than ${MAX_SHOTS} shells</b>. Every shell costs credits — the cheaper your total, the more stars.</p>
  <h4>1 · Shape (Bezier)</h4><p>Drag points and handles to draw the outline. The game spins it into a solid and works out volume, mass, centre of mass, drag and centre of pressure. Pointy, slender noses cut drag and bite deeper; blunt noses resist ricochets.</p>
  <h4>2 · Inside (layers)</h4><p>Stack layers inside the body: <b>penetrator cores</b> of any metal, <b>explosive</b>, <b>shaped charges</b> (jets), <b>hollow</b> space and <b>rocket fuel</b>. Each has a start, end, outer and inner radius. Combine them freely — tandem charges, a tungsten core with explosive behind it, a rocket-assisted shell… The fuse decides when explosive layers go off: on impact, after a delay inside, or as a squash head.</p>
  <h4>3 · Launch</h4><p><b>Artillery gun</b>: more charge = more speed, limited by the bore and by what the shell can survive. A wider bore adds a sabot. Rifling spins stubby shells stable; long ones need fins. <b>Rocket rail</b>: slow off the rail but carries huge warheads; needs fins.</p>
  <h4>4 · Aim &amp; fire</h4><p>Drag up/down (or use + / −) to set the gun's elevation. The small window shows where an ideal shot would land — wobbly designs won't follow it exactly. Watch the hit in slow motion and read the shot report. Tap during flight to fast-forward.</p>
  <h4>Sharing</h4><p>In the workshop's Saved tab, copy a share code and send it to friends so they can try to beat your cost.</p>
  <div class="row"><button class="btn primary" id="mOk">Got it</button></div></div>`);
  $('mOk').onclick = closeModal;
}

// ---------------- boot ----------------
window.addEventListener('resize', () => { renderer.resize(); fx.maxR = Math.max(renderer.w, renderer.h) * 0.45; if (S.screen === 'workshop') editor.resize(); });
fx.maxR = Math.max(renderer.w, renderer.h) * 0.45;
S.sprite = makeShellSprite(S.design, S.a); S.coreSprite = makeCoreSprite(S.a);
show('menu');
requestAnimationFrame(loop);
