// Shellworks — app controller: screens, workshop UI, range, campaign & sandbox.
import { LEVELS, SANDBOX_TARGETS, SHELL_MATS, FILLERS, TMATS, T, PAINT_MATS, CELL, GRID_W, G_ROWS, CORE_WIN, FIN_NAMES, CANNON_MAX_BORE, CANNON_MAX_LEN, ROCKET_MAX_CAL, ROCKET_MAX_LEN, PROPELLANT, GRAVITY } from './data.js';
import { makeDesign, normalizeDesign, analyze, estimatePen, PRESETS, TYPES, encodeDesign, decodeDesign } from './design.js';
import { World } from './sim.js';
import { FX } from './fx.js';
import { Renderer } from './render.js';
import { ShellEditor, makeShellSprite } from './editor.js';
import { Grid } from './grid.js';
import { airDecel } from './physics.js';

const $ = id => document.getElementById(id);
const fmtC = v => '₵' + Math.round(v).toLocaleString();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------- storage ----------------
const KEY = 'shellworks.v1';
function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return { progress: {}, designs: [], levelDesign: {}, quality: 'auto', ...s }; } catch (e) { /* ignore */ }
  return { progress: {}, designs: [], levelDesign: {}, quality: 'auto' };
}
const store = loadStore();
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

// ---------------- state ----------------
const canvas = $('game');
const renderer = new Renderer(canvas);
const fx = new FX(1400);
const S = {
  screen: 'menu', mode: 'campaign', level: null,
  design: normalizeDesign(store.lastDesign || makeDesign('Ogive AP')),
  a: null, sprite: null,
  world: null, phase: 'idle', shotsLeft: 0, spent: 0, shotCost: 0,
  aim: null, aimOk: true, angle: 0.02, path: null, ts: 1, hold: 0, ff: false, settle: 0,
  sb: { target: 3, dist: 500, paint: false, mat: T.STEEL, slow: true },
  demo: null, demoT: 0,
};
S.a = analyze(S.design);

// ---------------- screens ----------------
const SCREENS = ['menu', 'levels', 'workshop', 'hud'];
function show(id) {
  S.screen = id;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  if (id === 'workshop') requestAnimationFrame(() => { editor.resize(); refreshWorkshop(); });
  if (id === 'levels') buildLevelGrid();
  if (id === 'menu') startDemo();
  renderer.resize();
}
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
function modal(html) { $('modalCard').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('modal').dataset.lock) closeModal(); });

document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.go;
  if (g === 'help') return showHelp();
  if (g === 'sandbox') return enterSandbox();
  show(g);
}));

// ---------------- quality ----------------
const Q = { auto: { dpr: 2, parts: 1400, debris: 320 }, high: { dpr: 2, parts: 1800, debris: 420 }, low: { dpr: 1, parts: 650, debris: 150 } };
let qualityLive = store.quality === 'auto' ? (matchMedia('(pointer:coarse)').matches ? 'mid' : 'auto') : store.quality;
function applyQuality() {
  let q = Q[qualityLive] || Q.auto;
  if (qualityLive === 'mid') q = { dpr: 1.5, parts: 1000, debris: 240 };
  renderer.maxDpr = q.dpr; renderer.resize();
  if (fx.max !== q.parts) fx.setMax(q.parts);
  fx.lite = qualityLive === 'low';
  S.debrisCap = q.debris;
}
$('quality').value = store.quality;
$('quality').addEventListener('change', e => { store.quality = e.target.value; save(); qualityLive = store.quality === 'auto' ? 'auto' : store.quality; applyQuality(); });
applyQuality();
let perf = { t: 0, frames: 0, slow: 0 };

// ---------------- workshop ----------------
const editor = new ShellEditor($('shellCanvas'), commit => onDesignChange(commit));
let tab = 'body';
let pendingRefresh = false;

function onDesignChange(commit) {
  S.a = analyze(S.design);
  editor.set(S.design, S.a);
  if (!pendingRefresh) { pendingRefresh = true; requestAnimationFrame(() => { pendingRefresh = false; updateStats(); }); }
  if (commit) { store.lastDesign = S.design; if (S.mode === 'campaign' && S.level) store.levelDesign[S.level.id] = S.design; save(); }
}

function setDesign(d) {
  S.design = normalizeDesign(d);
  S.a = analyze(S.design);
  editor.sel = 1;
  refreshWorkshop();
  onDesignChange(true);
}

for (const name of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = name; o.textContent = name; $('tPreset').appendChild(o); }
$('tPreset').addEventListener('change', e => {
  const n = e.target.value; e.target.value = '';
  if (!n) return;
  const keepName = S.design.name;
  setDesign({ ...makeDesign(n), name: n });
  toast(`Template “${n}” loaded`);
  if (keepName === n) return;
});
$('tAdd').addEventListener('click', () => editor.addPoint());
$('tDel').addEventListener('click', () => { if (!editor.deletePoint()) toast('Select a middle point to delete (tip and base stay)'); });
$('tSmooth').addEventListener('click', e => { editor.smooth = !editor.smooth; e.target.classList.toggle('on', editor.smooth); });
$('dName').addEventListener('input', e => { S.design.name = e.target.value || 'Unnamed'; onDesignChange(true); });
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  buildTab();
}));

function matOptions(sel) {
  return Object.entries(SHELL_MATS).map(([k, m]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${m.name} — ${(m.rho / 1000).toFixed(1)} g/cc, ₵${m.cost}/kg</option>`).join('');
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

function buildTab() {
  const d = S.design, a = S.a, rocket = d.launcher === 'rocket';
  let h = '';
  if (tab === 'body') {
    h += slider('caliber', 'Caliber (max diameter)', 15, rocket ? ROCKET_MAX_CAL * 1000 : CANNON_MAX_BORE * 1000, 1, 1000, ' mm');
    h += slider('length', 'Length', 30, (rocket ? ROCKET_MAX_LEN : CANNON_MAX_LEN) * 1000, 5, 1000, ' mm');
    h += `<div class="field"><label>Body / jacket material</label><select data-k="jacket">${matOptions(d.jacket)}</select></div>`;
    h += `<div class="field"><label>Tail fins</label>${seg('finSize', FIN_NAMES.map((n, i) => [i, n]))}</div>`;
    h += `<p class="note">Fins pull the centre of pressure behind the centre of mass. Cannon rounds without fins are spun by rifling instead — that only works for stubby shells (L/D under ~5).${d.launcher === 'cannon' && d.finSize ? ' Fins must fit the gun bore: widen the bore (sabot) on the Launch tab.' : ''}</p>`;
  } else if (tab === 'payload') {
    h += `<div class="field"><label>Shell type</label>${seg('type', Object.entries(TYPES).map(([k, v]) => [k, v]))}</div>`;
    const desc = {
      AP: 'Pure kinetic energy. A hard, dense core punches through; a soft jacket strips off on hard armour. Exiting armour throws spall.',
      APHE: 'Armour-piercing with a small bursting charge that goes off after the fuse delay — deadly once inside.',
      HE: 'Bursts on contact. Wrecks brick, timber and concrete; barely scratches steel.',
      HEAT: 'Shaped charge: a copper liner becomes a jet. Penetration depends on charge diameter and stand-off, not speed. Spaced plates, reactive tiles and ceramic ruin it.',
    }[d.type];
    h += `<p class="note">${desc}</p>`;
    if (d.type === 'AP' || d.type === 'APHE') {
      h += `<div class="field"><label>Core material</label><select data-k="core">${matOptions(d.core)}</select></div>`;
      h += slider('coreR', 'Core radius', 20, 100, 1, 100, '%');
      h += slider('coreLen', 'Core length (from tip)', 10, 100, 1, 100, '%');
    }
    if (d.type !== 'AP') {
      h += `<div class="field"><label>Explosive</label><select data-k="filler">${fillOptions(d.filler)}</select></div>`;
      h += slider('fillR', d.type === 'HE' ? 'Charge radius (thinner walls = bigger bang, fewer fragments)' : 'Charge radius', 20, 95, 1, 100, '%');
      h += slider('fillLen', 'Charge length', 5, 90, 1, 100, '%');
    }
    if (d.type === 'HEAT') h += slider('capLen', 'Stand-off cap (hollow nose)', 5, 60, 1, 100, '%');
    if (d.type === 'APHE') h += slider('fuse', 'Fuse delay (distance after impact)', 2, 150, 1, 100, ' cm');
  } else if (tab === 'launch') {
    h += `<div class="field"><label>Launcher</label>${seg('launcher', [['cannon', 'Cannon'], ['rocket', 'Rocket motor']])}</div>`;
    if (!rocket) {
      const minBore = Math.ceil(a.D * 1000);
      h += `<div class="field"><label>Gun bore<b data-out="bore">${(Math.max(d.bore, a.D) * 1000).toFixed(0)} mm</b></label><input type="range" data-k="bore" data-scale="1000" data-unit=" mm" data-dec="0" min="${minBore}" max="${CANNON_MAX_BORE * 1000}" step="1" value="${Math.max(d.bore, a.D) * 1000}"></div>`;
      h += `<p class="note">A bore wider than the shell adds a discarding sabot (₵) so a slim dart can ride a big propellant charge.</p>`;
      const mx = a.maxCharge;
      h += `<div class="field"><label>Propellant charge<b data-out="charge">${Math.min(d.charge, mx).toFixed(2)} kg</b></label><input type="range" data-k="charge" data-scale="1" data-unit=" kg" data-dec="2" min="0.05" max="${mx.toFixed(2)}" step="0.05" value="${Math.min(d.charge, mx)}"></div>`;
      h += `<p class="note">Chamber limit for this bore: ${mx.toFixed(1)} kg. Propellant costs ₵${PROPELLANT.cannonCost}/kg.</p>`;
    } else {
      h += slider('motorLen', 'Motor length (rear section)', 15, 85, 1, 100, '%');
      h += `<p class="note">Rockets leave a rail slowly and accelerate. They can carry huge warheads (up to ${ROCKET_MAX_CAL * 1000} mm), but need fins to fly straight. Propellant ₵${PROPELLANT.rocketCost}/kg.</p>`;
    }
  } else if (tab === 'saved') {
    h += `<div class="row" style="display:flex;gap:6px;margin-bottom:10px"><button class="btn sm" id="svSave">💾 Save “${escapeHtml(d.name)}”</button><button class="btn sm" id="svShare">Copy share code</button></div>`;
    if (!store.designs.length) h += `<p class="note">No saved shells yet.</p>`;
    store.designs.forEach((s, i) => {
      const aa = analyze(normalizeDesign(s));
      h += `<div class="saved-item"><span>${escapeHtml(s.name)} <small style="color:var(--dim)">${TYPES[s.type] || ''} · ${fmtC(aa.totalCost)}</small></span><button class="btn sm" data-load="${i}">Load</button><button class="btn sm" data-del="${i}">✕</button></div>`;
    });
    h += `<div class="field" style="margin-top:14px"><label>Import a friend’s shell (paste code)</label><textarea id="svCode" rows="3" placeholder="Paste a share code here"></textarea></div><button class="btn sm" id="svImport">Import</button>`;
  }
  $('tabBody').innerHTML = h;
  bindTab();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

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
    inp.addEventListener('change', () => { onDesignChange(true); if (['caliber', 'bore', 'length'].includes(inp.dataset.k) && tab === 'launch') buildTab(); });
  });
  body.querySelectorAll('select[data-k]').forEach(sel => sel.addEventListener('change', () => { S.design[sel.dataset.k] = sel.value; onDesignChange(true); }));
  body.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const k = g.dataset.seg; let v = b.dataset.v; if (k === 'finSize') v = +v;
    S.design[k] = v;
    if (k === 'launcher' && v === 'cannon') {
      S.design.caliber = Math.min(S.design.caliber, CANNON_MAX_BORE); S.design.length = Math.min(S.design.length, CANNON_MAX_LEN);
      S.design.bore = clamp(S.design.bore || S.design.caliber, S.design.caliber, CANNON_MAX_BORE);
    }
    if (k === 'type' && v === 'AP' && S.design.coreLen < 0.2) S.design.coreLen = 0.8;
    onDesignChange(true); buildTab();
  })));
  const q = id => body.querySelector('#' + id);
  if (q('svSave')) q('svSave').addEventListener('click', () => {
    const i = store.designs.findIndex(x => x.name === S.design.name);
    const copy = JSON.parse(JSON.stringify(S.design));
    if (i >= 0) store.designs[i] = copy; else store.designs.unshift(copy);
    save(); buildTab(); toast('Saved');
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

function rocketBurnout(a) {
  let v = a.muzzleV, m = a.flightMass, t = 0;
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
  const vStart = a.rocket ? rocketBurnout(a) : a.muzzleV;
  let pen = '—', penLabel = 'Penetration';
  if (d.type === 'HE') { penLabel = 'Blast radius'; pen = `${a.blastRadius.toFixed(1)} m`; }
  else if (d.type === 'HEAT') { penLabel = 'Jet (RHA)'; pen = `${(a.jetPen * 1000).toFixed(0)} mm`; }
  else if (impact) pen = `${estimatePen(a, impact.v).toFixed(0)} mm`;
  const stabTxt = a.stab >= 0.95 ? 'Stable' : a.stab >= 0.5 ? 'Wobbly' : a.stab > 0.05 ? 'Unstable' : 'Tumbles';
  const stabCol = a.stab >= 0.95 ? 'var(--good)' : a.stab >= 0.5 ? '#ffd34d' : 'var(--danger)';
  const stabWhy = a.stabMode === 'spin' ? `spin, Sg ${a.Sg.toFixed(2)}` : `margin ${a.margin.toFixed(2)} cal`;
  let h = `
    <div class="stat"><small>Mass</small><b>${a.flightMass.toFixed(a.flightMass < 10 ? 2 : 1)} kg</b></div>
    <div class="stat"><small>${a.rocket ? 'Burn-out v' : 'Muzzle v'}</small><b>${vStart.toFixed(0)} m/s</b></div>
    <div class="stat"><small>Impact v @${dist} m</small><b>${impact ? impact.v.toFixed(0) + ' m/s' : '<span style="color:var(--danger)">no reach</span>'}</b></div>
    <div class="stat"><small>${penLabel}</small><b>${pen}</b></div>
    <div class="stat"><small>Drag Cd (M2)</small><b>${(a.cdWave * Math.pow(1.2 / 2, 0.5) * 1.1 + a.cdBase + a.cdFric + a.cdFin).toFixed(2)}</b></div>
    <div class="stat"><small>L / D</small><b>${a.LD.toFixed(1)}</b></div>
    <div class="stat wide"><small>Stability — <span style="color:${stabCol}">${stabTxt}</span> (${stabWhy})</small><div class="stab"><i style="width:${(a.stab * 100).toFixed(0)}%;background:${stabCol}"></i></div></div>`;
  if (d.type === 'APHE' || d.type === 'HE' || d.type === 'HEAT') h += `<div class="stat"><small>Explosive (TNT eq)</small><b>${a.fillerTNT.toFixed(2)} kg</b></div>`;
  if (a.sabotMass > 0) h += `<div class="stat"><small>Sabot</small><b>${a.sabotMass.toFixed(2)} kg</b></div>`;
  if (impact) h += `<div class="stat"><small>Flight time</small><b>${impact.t.toFixed(2)} s</b></div>`;
  for (const e of a.errors) h += `<div class="warn">⚠ ${e}</div>`;
  $('stats').innerHTML = h;
  if (document.activeElement !== $('dName')) $('dName').value = d.name;
}

function refreshWorkshop() {
  if (S.mode === 'campaign' && S.level) {
    const L = S.level;
    $('wsBrief').textContent = `Stage ${L.id} · ${L.name} · ${L.dist} m · ${L.shots} shot${L.shots > 1 ? 's' : ''} · ★★★ ≤ ${fmtC(L.stars[0])}`;
  } else $('wsBrief').textContent = `Sandbox · ${S.sb.dist} m range`;
  $('dName').value = S.design.name;
  editor.set(S.design, S.a);
  buildTab(); updateStats();
}

$('wsBack').addEventListener('click', () => { if (S.mode === 'campaign') show('levels'); else show('menu'); });
$('wsDeploy').addEventListener('click', () => {
  const errs = S.a.errors.filter(e => !e.includes('clamped'));
  if (errs.length) return toast('⚠ ' + errs[0], 3000);
  S.sprite = makeShellSprite(S.design, S.a);
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
    b.innerHTML = `<span class="n">STAGE ${L.id}</span><span class="t">${L.name}</span><span class="s">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span><span class="b">${p ? 'Best ' + fmtC(p.best) : L.dist + ' m · ' + L.shots + ' shot' + (L.shots > 1 ? 's' : '')}</span>`;
    b.insertBefore(previewCanvas(L.build), b.firstChild);
    b.addEventListener('click', () => openLevel(L));
    grid.appendChild(b);
  }
  $('totalStars').textContent = `★ ${total} / ${LEVELS.length * 3}`;
}

function openLevel(L) {
  S.mode = 'campaign'; S.level = L;
  const d = store.levelDesign[L.id] || store.lastDesign || makeDesign(L.id <= 2 ? 'Cheap HE' : 'Ogive AP');
  S.design = normalizeDesign(d); S.a = analyze(S.design);
  S.world = null; S.attemptLevel = null;
  show('workshop');
  modal(`<h3>Stage ${L.id}: ${escapeHtml(L.name)}</h3><p>${escapeHtml(L.brief)}</p>
    <div class="kv"><span>Range</span><b>${L.dist} m</b><span>Shots</span><b>${L.shots}</b><span>Win</span><b>destroy ≥ ${CORE_WIN * 100}% of the core</b>
    <span>★★★</span><b>total ≤ ${fmtC(L.stars[0])}</b><span>★★</span><b>total ≤ ${fmtC(L.stars[1])}</b>${store.progress[L.id] ? `<span>Your best</span><b>${fmtC(store.progress[L.id].best)}</b>` : ''}</div>
    <div class="row"><button class="btn primary" id="mOk">Design a shell</button></div>`);
  $('mOk').onclick = closeModal;
}

function newAttempt() {
  const fxReset = () => fx.clear();
  fxReset();
  if (S.mode === 'campaign') {
    S.world = new World({ build: S.level.build, dist: S.level.dist, fx });
    S.shotsLeft = S.level.shots; S.spent = 0; S.attemptLevel = S.level.id;
  } else {
    S.world = new World({ build: SANDBOX_TARGETS[S.sb.target].build, dist: S.sb.dist, fx });
    S.shotsLeft = Infinity; S.spent = 0;
  }
  S.world.debrisMax = S.debrisCap;
  S.world.bbox = null;
  S.aim = defaultAim(S.world);
  S.phase = 'aim';
  solveAim();
}

function defaultAim(w) {
  const g = w.grid; let sx = 0, sy = 0, n = 0;
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (g.mat[j * g.W + i] === T.CORE) { sx += i; sy += j; n++; }
  if (!n) return { x: w.x0 + 5, y: 1.2 };
  return { x: w.cx(sx / n), y: w.cy(sy / n) };
}

// ---------------- range ----------------
function enterRange() {
  show('hud');
  $('sandboxBar').classList.toggle('hidden', S.mode !== 'sandbox');
  S.phase = S.world.busy() ? 'flight' : 'aim';
  if (S.phase === 'aim') solveAim();
  snapCamera();
  updateHud();
}

function solveAim() {
  if (!S.aim || !S.world) return;
  const a = S.a;
  const sol = World.solveAngle(a, S.aim.x, S.aim.y);
  S.angle = sol.angle; S.aimOk = sol.ok;
  S.path = [];
  World.trajectory(a, sol.angle, S.aim.x + 0.5, 60, S.path);
  if (!sol.ok) { $('aimInfo').innerHTML = `<span style="color:var(--danger)">Out of range — this shell can’t reach that point</span>`; return; }
  let extra;
  if (a.type === 'HE') extra = `blast ${a.blastRadius.toFixed(1)} m`;
  else if (a.type === 'HEAT') extra = `jet ${(a.jetPen * 1000).toFixed(0)} mm`;
  else extra = `pen ≈ <b>${estimatePen(a, sol.v).toFixed(0)} mm</b>`;
  $('aimInfo').innerHTML = `Impact <b>${sol.v.toFixed(0)} m/s</b> · ${extra} · ${sol.t.toFixed(2)} s · elev ${(sol.angle * 180 / Math.PI).toFixed(2)}°`;
}

function updateHud() {
  const w = S.world;
  if (S.mode === 'campaign') {
    $('hudName').textContent = `Stage ${S.level.id} · ${S.level.name}`;
    $('hudDist').textContent = `${S.level.dist} m · ★★★ ≤ ${fmtC(S.level.stars[0])}`;
    $('hudShots').textContent = S.shotsLeft;
  } else {
    $('hudName').textContent = 'Sandbox';
    $('hudDist').textContent = `${S.sb.dist} m`;
    $('hudShots').textContent = '∞';
  }
  $('hudSpent').textContent = fmtC(S.spent);
  const cf = w ? w.grid.coreFraction() : 0;
  $('coreBar').style.width = (Math.min(1, cf / 1) * 100).toFixed(0) + '%';
  $('corePct').textContent = (cf * 100).toFixed(0) + '%';
  $('hudFire').disabled = S.phase !== 'aim';
}

$('hudFire').addEventListener('click', fire);
function fire() {
  if (S.phase !== 'aim' || !S.world) return;
  const errs = S.a.errors.filter(e => !e.includes('clamped'));
  if (errs.length) return toast('⚠ ' + errs[0]);
  if (S.mode === 'campaign' && S.shotsLeft <= 0) return;
  S.sprite = makeShellSprite(S.design, S.a);
  S.world.debrisMax = S.debrisCap;
  S.world.fire(S.design, S.a, S.angle);
  S.world.debrisBudget = S.debrisCap;
  S.spent += S.a.totalCost; S.shotCost = S.a.totalCost;
  if (S.mode === 'campaign') S.shotsLeft--;
  S.phase = 'flight'; S.hold = 0; S.ff = false; S.settle = 0; S.ts = 1; S.world.embedded = null;
  S.camMode = 'launch'; S.launchT = 0;
  $('hudMsg').textContent = '';
  updateHud();
}

function endShot() {
  const w = S.world, cf = w.grid.coreFraction();
  const shot = w.shot || {};
  updateHud();
  if (S.mode === 'sandbox') {
    S.phase = 'aim';
    const bits = [shot.result];
    if (shot.impactV) bits.push(`${shot.impactV.toFixed(0)} m/s`);
    if (shot.depth) bits.push(`${(shot.depth * 1000).toFixed(0)} mm path in material`);
    toast(bits.filter(Boolean).join(' · '), 3200);
    solveAim(); updateHud();
    return;
  }
  if (cf >= CORE_WIN) {
    S.phase = 'result';
    const L = S.level, st = starsFor(L, S.spent);
    const prev = store.progress[L.id];
    const isBest = !prev || S.spent < prev.best;
    store.progress[L.id] = { best: Math.min(S.spent, prev ? prev.best : Infinity), stars: Math.max(st, prev ? prev.stars : 0), design: isBest ? S.design : prev.design };
    save();
    const next = LEVELS.find(x => x.id === L.id + 1);
    modal(`<h3>Target destroyed</h3><div class="big-stars">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></div>
      <div class="kv"><span>Core destroyed</span><b>${(cf * 100).toFixed(0)}%</b><span>Total cost</span><b>${fmtC(S.spent)}</b>
      <span>Best on this stage</span><b>${fmtC(store.progress[L.id].best)}${isBest && prev ? ' — new record!' : ''}</b>
      <span>Next star at</span><b>${st >= 3 ? 'max' : fmtC(L.stars[st === 2 ? 0 : 1])}</b></div>
      <div class="row"><button class="btn" id="mRetry">Retry cheaper</button>${next ? '<button class="btn primary" id="mNext">Next stage ›</button>' : '<button class="btn primary" id="mDone">Campaign</button>'}</div>`);
    $('mRetry').onclick = () => { closeModal(); S.world = null; show('workshop'); };
    if (next) $('mNext').onclick = () => { closeModal(); openLevel(next); };
    else $('mDone').onclick = () => { closeModal(); show('levels'); };
    return;
  }
  if (S.shotsLeft > 0) {
    S.phase = 'aim'; solveAim(); updateHud();
    toast(`${shot.result || 'Shot done'} — core ${(cf * 100).toFixed(0)}%. ${S.shotsLeft} shot${S.shotsLeft > 1 ? 's' : ''} left (you may change the shell).`, 3600);
    return;
  }
  S.phase = 'result';
  modal(`<h3>Target survived</h3><p style="color:var(--dim)">${escapeHtml(shot.result || '')}${shot.notes && shot.notes.length ? ' · ' + escapeHtml([...new Set(shot.notes)].join(', ')) : ''}</p>
    <div class="kv"><span>Core destroyed</span><b>${(cf * 100).toFixed(0)}% / ${CORE_WIN * 100}%</b>${shot.impactV ? `<span>Impact speed</span><b>${shot.impactV.toFixed(0)} m/s</b>` : ''}<span>Spent</span><b>${fmtC(S.spent)}</b></div>
    <div class="row"><button class="btn" id="mWs">Workshop</button><button class="btn primary" id="mRetry">Retry</button></div>`);
  $('mWs').onclick = () => { closeModal(); S.world = null; show('workshop'); };
  $('mRetry').onclick = () => { closeModal(); newAttempt(); enterRange(); };
}

$('hudWorkshop').addEventListener('click', () => { if (S.phase === 'flight') return; show('workshop'); });
$('hudBack').addEventListener('click', () => { if (S.mode === 'campaign') show('levels'); else show('menu'); });

// ---------------- sandbox ----------------
SANDBOX_TARGETS.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = t.name; $('sbTarget').appendChild(o); });
function enterSandbox() {
  S.mode = 'sandbox'; S.level = null;
  S.design = normalizeDesign(store.lastDesign || makeDesign('Ogive AP')); S.a = analyze(S.design);
  $('sbTarget').value = S.sb.target; $('sbDist').value = S.sb.dist; $('sbDistV').textContent = S.sb.dist + ' m';
  S.world = null;
  show('workshop');
}
$('sbTarget').addEventListener('change', e => { S.sb.target = +e.target.value; newAttempt(); snapCamera(); updateHud(); });
$('sbDist').addEventListener('input', e => { S.sb.dist = +e.target.value; $('sbDistV').textContent = S.sb.dist + ' m'; });
$('sbDist').addEventListener('change', () => {
  if (!S.world) return;
  // move the existing (possibly damaged) target to the new range
  const g = S.world.grid; S.world.x0 = S.world.dist = S.sb.dist;
  S.aim = defaultAim(S.world); solveAim(); snapCamera(); updateHud(); void g;
});
$('sbReset').addEventListener('click', () => { if (S.phase === 'flight') return; newAttempt(); updateHud(); });
$('sbSlow').addEventListener('click', e => { S.sb.slow = !S.sb.slow; e.target.classList.toggle('on', S.sb.slow); });
$('sbPaint').addEventListener('click', e => { S.sb.paint = !S.sb.paint; e.target.classList.toggle('on', S.sb.paint); $('paintBar').classList.toggle('hidden', !S.sb.paint); });
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
function screenToWorld(px, py) {
  const cam = renderer.cam, r = canvas.getBoundingClientRect();
  return [(px - r.left - renderer.w / 2) / cam.scale + cam.x, (renderer.h / 2 - (py - r.top)) / cam.scale + cam.y];
}
let painting = false;
function paintAt(e) {
  const [x, y] = screenToWorld(e.clientX, e.clientY);
  const w = S.world, i0 = w.cellI(x), j0 = w.cellJ(y);
  for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) w.grid.paint(i0 + c, j0 + b, S.sb.mat);
  updateHud();
}
canvas.addEventListener('pointerdown', e => {
  if (S.screen !== 'hud' || !S.world) return;
  if (S.phase === 'flight') { S.ff = true; return; }
  if (S.phase !== 'aim') return;
  if (S.mode === 'sandbox' && S.sb.paint) { painting = true; paintAt(e); canvas.setPointerCapture?.(e.pointerId); return; }
  const [x, y] = screenToWorld(e.clientX, e.clientY);
  const w = S.world;
  if (x < w.x0 - 3 || x > w.x0 + GRID_W * CELL + 3 || y < 0 || y > G_ROWS * CELL + 3) return;
  S.aim = { x: clamp(x, w.x0, w.x0 + GRID_W * CELL), y: clamp(y, 0.03, G_ROWS * CELL) };
  solveAim();
});
canvas.addEventListener('pointermove', e => { if (painting) paintAt(e); });
window.addEventListener('pointerup', () => { painting = false; });

// ---------------- camera ----------------
function targetCam() { return renderer.fitTarget(S.world, renderer.w, renderer.h, S.mode === 'sandbox' ? (S.sb.paint ? 150 : 110) : 64, 80); }
function snapCamera() { if (!S.world) return; const t = targetCam(); Object.assign(renderer.cam, { x: t.x, y: t.y, scale: t.scale }); }

function updateCamera(dt) {
  const cam = renderer.cam, w = S.world;
  if (!w) return;
  const p = w.proj;
  let tx, ty, ts, k = 6;
  const tc = targetCam();
  if (S.phase === 'flight' && p && p.state === 'flight' && p.x < w.x0 - 25) {
    ts = clamp(renderer.w / 34, 10, 60);
    const half = renderer.w / 2 / ts;
    tx = Math.max(p.x + half * 0.35, half - 4);
    ty = Math.max(p.y * 0.85 + 1.2, renderer.h * 0.25 / ts);
    cam.x = tx; cam.scale += (ts - cam.scale) * Math.min(1, dt * 10); cam.y += (ty - cam.y) * Math.min(1, dt * 8);
    return;
  }
  tx = tc.x; ty = tc.y; ts = tc.scale;
  if (S.phase === 'flight' && p && p.state === 'flight') k = 10;
  const f = Math.min(1, dt * k);
  cam.x += (tx - cam.x) * f; cam.y += (ty - cam.y) * f; cam.scale += (ts - cam.scale) * f;
}

// ---------------- demo (menu background) ----------------
function startDemo() {
  const t = SANDBOX_TARGETS[3];
  S.demo = new World({ build: t.build, dist: 60, fx });
  S.demoT = 1.2; S.demoDesigns = Object.keys(PRESETS).filter(n => !n.includes('Rocket'));
  fx.clear();
}
function stepDemo(dt) {
  const w = S.demo; if (!w) return;
  S.demoT -= dt;
  if (S.demoT <= 0 && !w.busy()) {
    if (w.grid.coreFraction() > 0.6 || Math.random() < 0.15) { w.grid.reset(); w.embedded = null; }
    const name = S.demoDesigns[(Math.random() * S.demoDesigns.length) | 0];
    const d = makeDesign(name), a = analyze(d);
    S.demoSprite = makeShellSprite(d, a);
    const gx = w.x0 + 4 + Math.random() * 1.5, gy = 0.5 + Math.random() * 4.5;
    w.fire(d, a, World.solveAngle(a, gx, gy).angle);
    w.debrisBudget = S.debrisCap;
    S.demoT = 2.6;
  }
  const near = w.proj && w.proj.x > w.x0 - 8;
  const ts = near || (w.frags.length) ? 0.12 : 1;
  w.step(dt * ts);
  fx.update(dt * Math.max(ts, 0.35));
  const cam = renderer.cam, t = renderer.fitTarget(w, renderer.w, renderer.h, 40, 40);
  cam.x = t.x + 1.5; cam.y = t.y; cam.scale = t.scale * 0.85;
}

// ---------------- main loop ----------------
let last = performance.now();
function loop(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now;
  perfTrack(dtReal);
  if (S.screen === 'menu') {
    stepDemo(dtReal);
    if (S.demo) renderer.render(S.demo, fx, { sprite: S.demoSprite, angle: 0 });
  } else if (S.screen === 'hud' && S.world) {
    stepRange(dtReal);
    updateCamera(dtReal);
    renderer.render(S.world, fx, {
      sprite: S.sprite, angle: S.angle, rocket: S.a.rocket, bore: S.a.bore,
      aim: S.aim, aimOk: S.aimOk, showAim: S.phase === 'aim' && !S.sb.paint || (S.phase === 'aim' && S.mode === 'campaign'), path: S.path,
      showGridBox: S.mode === 'sandbox' && S.sb.paint,
    });
  }
  requestAnimationFrame(loop);
}

function stepRange(dtReal) {
  const w = S.world;
  if (S.phase === 'flight') {
    const p = w.proj;
    const slowOn = S.mode === 'campaign' || S.sb.slow;
    let target = 1;
    if (p) {
      const v = Math.hypot(p.vx, p.vy) || 1;
      const gap = w.x0 - p.x;
      if (p.state !== 'flight' || gap < v * 0.1 + 3) target = slowOn ? 0.06 : 1;
      else if (S.ff) target = 6;
      S.hold = 0;
    } else {
      S.hold += dtReal;
      target = S.hold < 0.9 && slowOn ? 0.08 : 1;
    }
    S.ts += (target - S.ts) * Math.min(1, dtReal * (target < S.ts ? 25 : 3));
    w.step(dtReal * S.ts);
    if (!w.busy()) {
      S.settle += dtReal;
      if (S.settle > 2.2) { S.phase = 'post'; endShot(); }
    }
    if ((S.frameN = (S.frameN || 0) + 1) % 6 === 0) updateHud();
  }
  const fxScale = S.ts < 1 ? Math.max(S.ts, 0.3) : Math.min(S.ts, 2);
  fx.update(dtReal * fxScale);
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
  <p>Each stage hides a <b style="color:#e44">red core</b>. Destroy at least ${CORE_WIN * 100}% of it. Every shell you fire costs credits — the cheaper your total, the more stars.</p>
  <h4>1 · Shape (Bezier)</h4><p>Drag points and handles to draw the outline. The game spins it into a solid of revolution and works out volume, mass, centre of mass, drag and centre of pressure from it. Pointy, slender noses cut drag and bite deeper; blunt noses resist ricochets.</p>
  <h4>2 · Payload</h4><p><b>Solid shot</b>: kinetic energy. Dense, hard cores (tungsten, DU) go deepest; long thin rods erode less at high speed. <b>AP-HE</b>: penetrate, then burst inside. <b>HE</b>: blast + fragments — great vs brick, timber and concrete. <b>HEAT</b>: a shaped-charge jet that ignores speed but hates gaps, ceramic and reactive tiles.</p>
  <h4>3 · Launch</h4><p><b>Cannon</b>: more charge = more speed, limited by bore. A wider bore than the shell adds a sabot so darts can ride big charges. Rifling spins stubby shells stable; long ones need fins. <b>Rocket</b>: slow off the rail but can carry huge warheads; needs fins.</p>
  <h4>4 · Fire</h4><p>Tap the target to aim — the computer solves the elevation for an ideal flight. Unstable designs wobble, lose speed and can miss. Tap during flight to fast-forward.</p>
  <h4>Sharing</h4><p>In the workshop's Saved tab, copy a share code and send it to friends so they can try to beat your cost.</p>
  <div class="row"><button class="btn primary" id="mOk">Got it</button></div></div>`);
  $('mOk').onclick = closeModal;
}

// ---------------- boot ----------------
window.addEventListener('resize', () => { renderer.resize(); fx.maxR = Math.max(renderer.w, renderer.h) * 0.45; if (S.screen === 'workshop') editor.resize(); });
fx.maxR = Math.max(renderer.w, renderer.h) * 0.45;
show('menu');
requestAnimationFrame(loop);
