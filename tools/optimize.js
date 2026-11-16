// Random-search the cheapest winning design per stage (used to set star thresholds).
import { LEVELS, CORE_WIN, SHELL_MATS, FILLERS } from '../js/data.js';
import { analyze, PRESETS, normalizeDesign } from '../js/design.js';
import { World } from '../js/sim.js';

const A = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy });
const NOSES = [
  [A(0, 0, 0, 0, 0, 0.9), A(0.04, 1, 0.02, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
  [A(0, 0, 0, 0, 0.02, 0.45), A(0.32, 1, 0.16, 1, 0.5, 1), A(0.9, 1, 0.8, 1, 0.95, 0.97), A(1, 0.9, 0.97, 0.93, 1, 0.9)],
  [A(0, 0, 0, 0, 0.03, 0.5), A(0.12, 1, 0.07, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
  [A(0, 0, 0, 0, 0.0, 0.3), A(0.38, 1, 0.22, 0.6, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
];
const rodProf = [A(0, 0, 0, 0, 0.03, 0.5), A(0.09, 1, 0.06, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)];
const SEEDS = [
  { type: 'AP', caliber: 0.034, length: 1.0, jacket: 'du', core: 'du', coreR: 1, coreLen: 1, launcher: 'cannon', bore: 0.155, charge: 21.6, finSize: 2, profile: rodProf },
  { type: 'AP', caliber: 0.03, length: 0.9, jacket: 'wha', core: 'wha', coreR: 1, coreLen: 1, launcher: 'cannon', bore: 0.155, charge: 21.6, finSize: 2, profile: rodProf },
  { type: 'AP', caliber: 0.026, length: 0.75, jacket: 'wha', core: 'wha', coreR: 1, coreLen: 1, launcher: 'cannon', bore: 0.12, charge: 12.9, finSize: 2, profile: rodProf },
  { ...PRESETS['Rocket HEAT'], caliber: 0.25, length: 1.6, filler: 'octol', fillLen: 0.45, capLen: 0.35, motorLen: 0.5 },
  { type: 'HE', caliber: 0.2, length: 1.6, jacket: 'steel', filler: 'compb', fillR: 0.85, fillLen: 0.8, launcher: 'rocket', motorLen: 0.45, finSize: 3, profile: PRESETS['Rocket HEAT'].profile },
];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const mats = Object.keys(SHELL_MATS), fills = Object.keys(FILLERS);

function randomDesign() {
  const type = pick(['AP', 'AP', 'HE', 'HEAT', 'APHE']);
  const rocket = Math.random() < 0.25;
  const cal = rocket ? rnd(0.05, 0.3) : rnd(0.02, 0.155);
  const LD = type === 'AP' && Math.random() < 0.4 ? rnd(8, 30) : rnd(1.2, 6);
  const fins = rocket ? pick([1, 2, 3]) : (LD > 6 ? pick([1, 2, 3]) : 0);
  const d = {
    type, caliber: cal, length: Math.min(rocket ? 3 : 1, cal * LD), profile: pick(NOSES),
    jacket: pick(mats), core: pick(mats), coreR: rnd(0.3, 1), coreLen: rnd(0.3, 1),
    filler: pick(fills), fillR: rnd(0.4, 0.9), fillLen: rnd(0.2, 0.6), capLen: rnd(0.1, 0.5), fuse: rnd(0.05, 1.0),
    launcher: rocket ? 'rocket' : 'cannon', motorLen: rnd(0.25, 0.7), finSize: fins,
    bore: fins ? Math.min(0.155, cal * (1 + 2 * [0, 0.35, 0.7, 1.1][fins]) * rnd(1, 1.6)) : cal, charge: 0,
  };
  if (!rocket) { d.bore = Math.max(d.bore, cal); d.charge = rnd(0.05, 1) * 900 * d.bore * d.bore; }
  return d;
}
function mutate(d) {
  const o = JSON.parse(JSON.stringify(d));
  const k = pick(['caliber', 'length', 'charge', 'fillR', 'fillLen', 'coreR', 'coreLen', 'motorLen', 'mat', 'fuse', 'capLen']);
  const f = rnd(0.8, 1.2);
  if (k === 'mat') { if (Math.random() < 0.5) o.jacket = pick(mats); else o.core = pick(mats); }
  else if (k === 'fillR' || k === 'coreR') o[k] = Math.min(1, Math.max(0.2, o[k] * f));
  else o[k] *= f;
  if (o.launcher === 'cannon') { o.caliber = Math.min(o.caliber, 0.155); o.bore = Math.min(0.155, Math.max(o.bore, o.caliber)); o.charge = Math.min(o.charge, 900 * o.bore * o.bore); o.length = Math.min(1, o.length); }
  return o;
}
function valid(a) { return a.errors.filter(e => !e.includes('clamped')).length === 0; }

function wins(level, d, a, trials) {
  for (let t = 0; t < trials; t++) {
    const w = new World({ build: level.build, dist: level.dist });
    const g = w.grid; let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (g.mat[j * g.W + i] === 10) { sx += i; sy += j; n++; }
    const sol = World.solveAngle(a, w.cx(sx / n), w.cy(sy / n));
    if (!sol.ok) return false;
    for (let s = 0; s < level.shots; s++) {
      w.fire(d, a, sol.angle);
      let guard = 0; while (w.busy() && guard++ < 100000) w.step(1 / 60);
      w.step(0.01);
      if (g.coreFraction() >= CORE_WIN) break;
    }
    if (g.coreFraction() < CORE_WIN) return false;
  }
  return true;
}

const only = process.argv[2] ? +process.argv[2] : 0;
const budgetMs = +(process.argv[3] || 20000);
for (const L of LEVELS) {
  if (only && L.id !== only) continue;
  const t0 = Date.now(); let best = null, bestCost = Infinity, tried = 0;
  for (const src of [...Object.values(PRESETS), ...SEEDS]) { const d = normalizeDesign(src); const a = analyze(d); if (valid(a) && a.totalCost < bestCost && wins(L, d, a, 3)) { best = d; bestCost = a.totalCost; } }
  const presetBest = bestCost;
  while (Date.now() - t0 < budgetMs) {
    const d = best && Math.random() < 0.5 ? mutate(best) : randomDesign();
    const a = analyze(d); tried++;
    if (!valid(a) || a.totalCost >= bestCost) continue;
    if (wins(L, d, a, 1) && wins(L, d, a, 2)) { best = d; bestCost = a.totalCost; }
  }
  const a = best ? analyze(best) : null;
  console.log(`L${L.id} ${L.name}: cheapest ${bestCost} (preset best ${presetBest}) tried ${tried}` + (a ? ` -> ${best.type} ${best.launcher} cal ${(best.caliber * 1000).toFixed(0)}mm L ${best.length.toFixed(2)} jacket ${best.jacket} core ${best.core} v0 ${a.muzzleV.toFixed(0)} m ${a.flightMass.toFixed(2)} TNT ${a.fillerTNT.toFixed(2)}` : ''));
}
