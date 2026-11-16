// Shell design model: Bezier outline + free stack of internal layers
// -> geometry, mass, cost, aerodynamics, stability, launch loads and terminal behaviour.
import {
  SHELL_MATS, FILLERS, PROPELLANT, FIN_SPAN, FIN_COST, CANNON_MAX_BORE, CANNON_MAX_LEN,
  ROCKET_MAX_CAL, ROCKET_MAX_LEN, TMATS, T,
} from './data.js';
import { estimateKE, heatPen, clamp } from './physics.js';

export const SLICES = 120;
export const RBINS = 24;
export const MIN_CAL = 0.02;      // 20 mm minimum diameter
export const MIN_WALL = 0.003;    // 3 mm minimum casing wall around soft fillings
export const MODES = { AP: 'Solid penetrator', APHE: 'Penetrator + delayed charge', HE: 'High explosive', HESH: 'Squash head', HEAT: 'Shaped charge' };
export const LAYER_KINDS = {
  core: 'Penetrator core', charge: 'Explosive', shaped: 'Shaped charge (jet)', hollow: 'Hollow (air)', motor: 'Rocket fuel',
};
export const FUSES = { impact: 'Impact', delay: 'Delay', squash: 'Squash' };
export const LAYER_COLORS = { charge: '#e8c04a', shaped: '#f0a640', hollow: '#0d1218', motor: '#8a5cc8' };

const A = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy });
const Ly = (kind, mat, x0, x1, ro, ri = 0) => ({ kind, mat, x0, x1, ro, ri });

const OGIVE = [A(0, 0, 0, 0, 0.02, 0.45), A(0.32, 1, 0.16, 1, 0.5, 1), A(0.9, 1, 0.8, 1, 0.95, 0.97), A(1, 0.9, 0.97, 0.93, 1, 0.9)];
const BLUNTISH = [A(0, 0, 0, 0, 0.03, 0.5), A(0.3, 1, 0.15, 1, 0.5, 1), A(0.9, 1, 0.8, 1, 0.95, 0.95), A(1, 0.85, 0.97, 0.88, 1, 0.85)];
const DART = [A(0, 0, 0, 0, 0.03, 0.5), A(0.09, 1, 0.06, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)];
const CONE = [A(0, 0, 0, 0, 0.0, 0.3), A(0.38, 1, 0.22, 0.6, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)];
const ROUND = [A(0, 0, 0, 0, 0.0, 0.7), A(0.14, 1, 0.05, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)];
const ROCKET = [A(0, 0, 0, 0, 0.0, 0.4), A(0.12, 1, 0.07, 0.8, 0.4, 1), A(1, 1, 0.9, 1, 1, 1)];

export const PRESETS = {
  'Ogive AP': {
    caliber: 0.088, length: 0.36, jacket: 'steel', fuse: 'impact', launcher: 'cannon', bore: 0.088, charge: 6, finSize: 0,
    layers: [Ly('core', 'hsteel', 0, 0.85, 0.7)], profile: OGIVE,
  },
  'Cheap HE': {
    caliber: 0.09, length: 0.34, jacket: 'steel', fuse: 'impact', launcher: 'cannon', bore: 0.09, charge: 1.2, finSize: 0,
    layers: [Ly('charge', 'tnt', 0.06, 0.68, 0.8)], profile: BLUNTISH,
  },
  'Dart (APFSDS)': {
    caliber: 0.026, length: 0.62, jacket: 'wha', fuse: 'impact', launcher: 'cannon', bore: 0.12, charge: 10, finSize: 2,
    layers: [], profile: DART,
  },
  'HEAT round': {
    caliber: 0.105, length: 0.5, jacket: 'steel', fuse: 'impact', launcher: 'cannon', bore: 0.105, charge: 4, finSize: 0,
    layers: [Ly('hollow', null, 0, 0.38, 0.9), Ly('shaped', 'compb', 0.38, 0.73, 0.85)], profile: CONE,
  },
  'Tandem HEAT': {
    caliber: 0.12, length: 0.56, jacket: 'steel', fuse: 'impact', launcher: 'cannon', bore: 0.12, charge: 5, finSize: 0,
    layers: [Ly('hollow', null, 0, 0.14, 0.85), Ly('shaped', 'compb', 0.14, 0.26, 0.55), Ly('hollow', null, 0.26, 0.44, 0.88), Ly('shaped', 'octol', 0.44, 0.78, 0.88)],
    profile: [A(0, 0, 0, 0, 0.0, 0.5), A(0.2, 0.65, 0.1, 0.65, 0.3, 0.65), A(0.36, 1, 0.3, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
  },
  'APHE': {
    caliber: 0.1, length: 0.42, jacket: 'hsteel', fuse: 'delay', fuseDelay: 0.4, launcher: 'cannon', bore: 0.1, charge: 6, finSize: 0,
    layers: [Ly('core', 'hsteel', 0, 0.4, 1), Ly('charge', 'compb', 0.4, 0.65, 0.45)],
    profile: [A(0, 0, 0, 0, 0.04, 0.55), A(0.3, 1, 0.16, 1, 0.5, 1), A(0.92, 1, 0.8, 1, 0.96, 0.97), A(1, 0.9, 0.98, 0.92, 1, 0.9)],
  },
  'HESH': {
    caliber: 0.105, length: 0.42, jacket: 'steel', fuse: 'squash', launcher: 'cannon', bore: 0.105, charge: 2.6, finSize: 0,
    layers: [Ly('charge', 'compb', 0.02, 0.6, 0.86)], profile: ROUND,
  },
  'Rocket-assisted AP': {
    caliber: 0.1, length: 0.45, jacket: 'steel', fuse: 'impact', launcher: 'cannon', bore: 0.1, charge: 4, finSize: 0,
    layers: [Ly('core', 'hsteel', 0, 0.5, 0.65), Ly('motor', null, 0.58, 0.97, 0.78)], profile: OGIVE,
  },
  'Rocket HEAT': {
    caliber: 0.15, length: 1.4, jacket: 'aluminum', fuse: 'impact', launcher: 'rocket', finSize: 3,
    layers: [Ly('hollow', null, 0, 0.16, 0.9), Ly('shaped', 'compb', 0.16, 0.32, 0.9), Ly('motor', null, 0.45, 1, 0.82)], profile: ROCKET,
  },
};

const DEFAULTS = {
  name: 'New Shell', caliber: 0.08, length: 0.32, jacket: 'steel', layers: [],
  fuse: 'impact', fuseDelay: 0.3, launcher: 'cannon', bore: 0.08, charge: 3, finSize: 0,
  profile: OGIVE,
};

export function makeDesign(preset = 'Ogive AP') {
  const d = JSON.parse(JSON.stringify({ ...DEFAULTS, ...(PRESETS[preset] || {}) }));
  d.name = preset;
  return d;
}

// Convert designs saved by the first version (fixed shell types) into layer stacks.
function legacyLayers(d) {
  const t = d.type || 'AP', rocket = d.launcher === 'rocket';
  const xm = rocket ? 1 - (d.motorLen ?? 0.45) : 1;
  const cl = d.coreLen ?? 0.8, cr = d.coreR ?? 0.7, fl = d.fillLen ?? 0.4, fr = d.fillR ?? 0.6, cap = d.capLen ?? 0.3, f = d.filler || 'tnt';
  const out = [];
  if ((t === 'AP' || t === 'APHE') && d.core && d.core !== d.jacket) out.push(Ly('core', d.core, 0, cl * xm, cr));
  if (t === 'APHE') out.push(Ly('charge', f, cl * xm, Math.min(1, cl + fl) * xm, fr));
  if (t === 'HE') out.push(Ly('charge', f, 0.06 * xm, Math.min(1, 0.06 + fl) * xm, fr));
  if (t === 'HEAT') { out.push(Ly('hollow', null, 0, cap * xm, 0.9)); out.push(Ly('shaped', f, cap * xm, Math.min(1, cap + fl) * xm, fr)); }
  if (rocket) out.push(Ly('motor', null, xm, 1, 0.82));
  return out;
}

export function normalizeDesign(d) {
  const o = JSON.parse(JSON.stringify({ ...DEFAULTS, ...d }));
  if (!Array.isArray(d.layers)) {
    o.layers = legacyLayers(d);
    o.fuseDelay = typeof d.fuse === 'number' ? d.fuse : 0.3;
    o.fuse = d.type === 'APHE' ? 'delay' : 'impact';
  }
  if (!FUSES[o.fuse]) o.fuse = 'impact';
  if (!Array.isArray(o.profile) || o.profile.length < 2) o.profile = JSON.parse(JSON.stringify(DEFAULTS.profile));
  if (!SHELL_MATS[o.jacket]) o.jacket = 'steel';
  o.layers = o.layers.filter(l => LAYER_KINDS[l.kind]).map(l => ({
    kind: l.kind, mat: defaultMat(l.kind, l.mat), x0: clamp(+l.x0 || 0, 0, 1), x1: clamp(+l.x1 || 0, 0, 1), ro: clamp(+l.ro || 0, 0, 1), ri: clamp(+l.ri || 0, 0, 1),
  }));
  for (const k of ['type', 'core', 'coreR', 'coreLen', 'filler', 'fillR', 'fillLen', 'capLen', 'motorLen']) delete o[k];
  return o;
}

export function defaultMat(kind, mat) {
  if (kind === 'core') return SHELL_MATS[mat] ? mat : 'wha';
  if (kind === 'charge' || kind === 'shaped') return FILLERS[mat] ? mat : (kind === 'shaped' ? 'compb' : 'tnt');
  return null;
}

export function newLayer(kind, d) {
  const used = d.layers.reduce((m, l) => Math.max(m, l.x1), 0);
  const x0 = used < 0.85 ? used : 0.2, x1 = Math.min(1, x0 + 0.3);
  return Ly(kind, defaultMat(kind), x0, x1, kind === 'core' ? 0.6 : 0.75, 0);
}

// ---------- profile ----------
export function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function profilePolyline(profile, steps = 24) {
  const pts = [];
  for (let s = 0; s < profile.length - 1; s++) {
    const a = profile[s], b = profile[s + 1];
    for (let k = s === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      pts.push(bez(a.x, a.ox, b.ix, b.x, t), clamp(bez(a.y, a.oy, b.iy, b.y, t), 0, 1));
    }
  }
  return pts;
}

export function sampleProfile(profile, N = SLICES) {
  const r = new Float32Array(N);
  const pts = profilePolyline(profile);
  for (let k = 0; k < pts.length - 2; k += 2) {
    const x0 = pts[k], y0 = pts[k + 1], x1 = pts[k + 2], y1 = pts[k + 3];
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const i0 = Math.max(0, Math.ceil(lo * N - 0.5)), i1 = Math.min(N - 1, Math.floor(hi * N - 0.5));
    for (let i = i0; i <= i1; i++) {
      const xc = (i + 0.5) / N;
      const t = hi > lo ? (xc - x0) / (x1 - x0) : 0;
      const y = y0 + (y1 - y0) * clamp(t, 0, 1);
      if (y > r[i]) r[i] = y;
    }
  }
  return r;
}

// colour of a composition owner (-1 = body)
export function ownerColor(d, o) {
  if (o < 0) return SHELL_MATS[d.jacket].color;
  const l = d.layers[o];
  if (!l) return '#000';
  if (l.kind === 'core') return SHELL_MATS[l.mat].color;
  return LAYER_COLORS[l.kind];
}
export function ownerName(d, o) {
  if (o < 0) return SHELL_MATS[d.jacket].name;
  const l = d.layers[o];
  if (l.kind === 'core') return SHELL_MATS[l.mat].name;
  if (l.kind === 'charge' || l.kind === 'shaped') return FILLERS[l.mat].name;
  return LAYER_KINDS[l.kind];
}

// ---------- full analysis ----------
export function analyze(d) {
  const N = SLICES, RB = RBINS;
  const r = sampleProfile(d.profile, N);
  const L = d.length, Rm = d.caliber / 2, dx = L / N;
  const jm = SHELL_MATS[d.jacket];
  const layers = d.layers;
  let rmax = 0; for (let i = 0; i < N; i++) rmax = Math.max(rmax, r[i]);
  const D = 2 * rmax * Rm || 0.001;
  const area = Math.PI * D * D / 4;
  const wallFrac = Math.max(0.06, MIN_WALL / Math.max(0.004, D / 2));
  // composition grid
  const bins = new Int8Array(N * RB).fill(-1);
  const lstat = layers.map(() => ({ mass: 0, vol: 0, minX: 1e9, maxX: -1, maxR: 0, frontR: 0 }));
  const mass = { jacket: 0, core: 0, filler: 0, prop: 0 };
  let moment = 0, volume = 0, solidVol = 0, coreH = 0, coreRho = 0, coreVol = 0;
  let tnt = 0, chargeMass = 0, chargeCost = 0, coreCost = 0, propMass = 0;
  const sliceMass = new Float32Array(N), sliceCap = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const xf = (i + 0.5) / N, R = r[i] * Rm;
    if (R <= 0) continue;
    for (let k = 0; k < RB; k++) {
      const rc = (k + 0.5) / RB;
      let own = -1;
      for (let li = 0; li < layers.length; li++) {
        const l = layers[li];
        if (xf < l.x0 || xf > l.x1 || rc < l.ri || rc > l.ro) continue;
        if (l.kind !== 'core' && rc > 1 - wallFrac) continue; // keep a casing wall around soft fillings
        own = li;
      }
      bins[i * RB + k] = own;
      const a0 = k / RB, a1 = (k + 1) / RB;
      const v = Math.PI * (a1 * a1 - a0 * a0) * R * R * dx;
      const ar = v / dx;
      volume += v;
      let m = 0, strength = 0;
      if (own < 0) { m = v * jm.rho; mass.jacket += m; strength = jm.H; solidVol += v; }
      else {
        const l = layers[own], st = lstat[own];
        if (l.kind === 'core') { const sm = SHELL_MATS[l.mat]; m = v * sm.rho; mass.core += m; coreH += sm.H * m; coreVol += v; coreCost += m * sm.cost; strength = sm.H; solidVol += v; }
        else if (l.kind === 'charge' || l.kind === 'shaped') { const f = FILLERS[l.mat]; m = v * f.rho; mass.filler += m; chargeMass += m; chargeCost += m * f.cost; if (l.kind === 'charge') tnt += m * f.power; }
        else if (l.kind === 'motor') { m = v * PROPELLANT.rocketRho; mass.prop += m; propMass += m; }
        st.mass += m; st.vol += v;
        st.minX = Math.min(st.minX, xf * L); st.maxX = Math.max(st.maxX, xf * L); st.maxR = Math.max(st.maxR, a1 * R);
        if (xf * L <= st.minX + dx * 1.01) st.frontR = Math.max(st.frontR, a1 * R);
      }
      moment += m * xf * L; sliceMass[i] += m; sliceCap[i] += ar * strength * 0.35e9;
    }
  }
  const coreMass = mass.core;
  if (coreMass > 0) { coreH /= coreMass; coreRho = coreMass / coreVol; }
  // nose / tail
  let iNose = 0; while (iNose < N - 1 && r[iNose] < 0.95 * rmax) iNose++;
  let iTail = N - 1; while (iTail > 0 && r[iTail] < 0.95 * rmax) iTail--;
  let waist = rmax; for (let i = iNose; i < N * 0.92; i++) waist = Math.min(waist, r[i]);
  const Ln = (iNose + 0.5) / N * L;
  const fineness = Ln / D;
  const nf = clamp(0.35 + 0.3 * fineness, 0.35, 1);
  const rBase = r[N - 1] * Rm;
  // fins
  const fs = d.finSize | 0;
  const span = FIN_SPAN[fs] * D;
  const chord = fs ? Math.min(0.28 * L, 2.6 * D + span * 0.5) : 0;
  const finMass = fs ? 4 * span * chord * 0.6 * Math.max(0.003, 0.05 * chord) * 2700 : 0;
  const finX = L - chord * 0.5;
  const finTipD = D + 2 * span;
  const flightMass = mass.jacket + mass.core + mass.filler + mass.prop + finMass;
  const cgX = flightMass > 0 ? (moment + finMass * finX) / flightMass : L / 2;
  // centre of pressure (Barrowman-style)
  let cnSum = 2, cnX = 2 * 0.47 * Ln;
  if (rBase < rmax * Rm * 0.98) {
    const cnBt = 2 * ((rBase / (rmax * Rm)) ** 2 - 1);
    const xbt = (iTail + 0.5) / N * L;
    cnSum += cnBt; cnX += cnBt * (xbt + 0.45 * (L - xbt));
  }
  if (fs) {
    const s = span, cr = chord, ct = chord * 0.45, Rb = D / 2;
    const interf = 1 + Rb / (s + Rb);
    const cnf = interf * (16 * (s / D) ** 2) / (1 + Math.sqrt(1 + (2 * s / (cr + ct)) ** 2));
    const xle = L - cr;
    const xf = xle + (cr - ct) * (cr + 2 * ct) / (3 * (cr + ct)) + (cr + ct - cr * ct / (cr + ct)) / 6;
    cnSum += cnf; cnX += cnf * xf;
  }
  const cpX = cnSum > 0.01 ? cnX / cnSum : 0;
  const margin = (cpX - cgX) / D;
  const LD = L / D;
  const rocket = d.launcher === 'rocket';
  let stab, stabMode, Sg = 0;
  if (!rocket && fs === 0) { Sg = 32 / (LD * LD); stab = clamp((Sg - 0.9) / 0.5, 0, 1); stabMode = 'spin'; }
  else { stab = clamp((margin - 0.1) / 1.0, 0, 1); stabMode = 'fins'; }
  // drag
  const cdWave = 1.0 / (1 + 1.6 * fineness * fineness);
  const cdBase = 0.25 * (rBase / (rmax * Rm || 1)) ** 2 + 0.03;
  const cdFric = 0.011 * LD;
  const cdFin = fs ? 0.012 * (4 * span * chord) / area * 0.5 + 0.02 : 0;
  // motors (rocket launcher, or rocket-assisted cannon shell)
  let motorLen = 0; for (let li = 0; li < layers.length; li++) if (layers[li].kind === 'motor' && lstat[li].mass > 0) motorLen += lstat[li].maxX - lstat[li].minX + dx;
  const burnTime = propMass > 0 ? 0.5 + 2.0 * Math.min(1, motorLen / L) : 0;
  const thrust = propMass > 0 ? propMass * PROPELLANT.rocketVe / burnTime : 0;
  // launch
  let muzzleV = 0, sabotMass = 0, maxCharge = 0, launchMass = flightMass, acc = 0;
  const errors = [];
  const bore = Math.max(d.bore || D, D);
  if (!rocket) {
    maxCharge = 900 * bore * bore;
    if (bore > D * 1.05) sabotMass = Math.PI * ((bore / 2) ** 2 - (D / 2) ** 2) * L * 0.5 * 2700 * 0.4;
    const charge = Math.min(d.charge, maxCharge);
    launchMass = flightMass + sabotMass + charge / 3;
    const v = Math.sqrt(2 * charge * PROPELLANT.cannonEnergy / Math.max(0.01, launchMass));
    muzzleV = 1850 * Math.tanh(v / 1850);
    const barrel = clamp(bore * 40, 2.5, 6.5);
    acc = muzzleV * muzzleV / (2 * barrel) * 1.6;
    if (bore > CANNON_MAX_BORE + 1e-6) errors.push(`Gun bore over ${CANNON_MAX_BORE * 1000} mm`);
    if (L > CANNON_MAX_LEN + 1e-6) errors.push(`Cannon rounds max ${CANNON_MAX_LEN} m long`);
    if (fs && finTipD > bore + 1e-6) errors.push('Fins wider than the gun bore — widen the bore (adds a sabot)');
    if (d.charge > maxCharge + 1e-6) errors.push('Charge exceeds chamber size (clamped)');
  } else {
    muzzleV = 25;
    acc = thrust / Math.max(0.01, flightMass) * 1.3;
    if (D > ROCKET_MAX_CAL + 1e-6) errors.push(`Rocket max caliber ${ROCKET_MAX_CAL * 1000} mm`);
    if (L > ROCKET_MAX_LEN + 1e-6) errors.push(`Rocket max length ${ROCKET_MAX_LEN} m`);
    if (propMass <= 0) errors.push('A rocket needs a Rocket fuel layer');
  }
  if (flightMass < 0.05) errors.push('Shell is too small');
  if (D < MIN_CAL - 1e-6) errors.push(`Too thin: minimum diameter is ${MIN_CAL * 1000} mm`);
  if (waist < rmax * 0.55) errors.push('Body pinches too thin in the middle (keep it ≥ 55% of max diameter)');
  if (LD > 30) errors.push(`Too slender: L/D ${LD.toFixed(0)} > 30 (it would snap)`);
  // structural check: every cross-section must carry the mass ahead of it under launch acceleration
  let ahead = 0, worst = 0, worstX = 0;
  for (let i = 0; i < N; i++) {
    ahead += sliceMass[i];
    if (i < iNose * 0.5 || r[i] <= 0) continue;
    const ratio = ahead * acc * (sabotMass > 0 ? 0.25 : 1) / Math.max(1, sliceCap[i]);
    if (ratio > worst) { worst = ratio; worstX = (i + 0.5) / N; }
  }
  const launchG = acc / 9.81, launchLoad = worst;
  if (worst > 1) errors.push(`Breaks apart at launch: ${Math.round(launchG).toLocaleString()} g overloads the section at ${(worstX * 100).toFixed(0)}% length (${(worst * 100).toFixed(0)}%). Use stronger metal, thicker walls, less charge or a sabot.`);
  // cost
  const shapedIdx = layers.map((l, i) => i).filter(i => layers[i].kind === 'shaped' && lstat[i].mass > 0);
  const cost = {
    body: mass.jacket * jm.cost + coreCost,
    filler: chargeCost,
    launch: rocket ? 0 : Math.min(d.charge, maxCharge) * PROPELLANT.cannonCost,
    extras: 8 + (chargeMass > 0 ? 25 : 0) + (shapedIdx.length > 1 ? 20 : 0) + FIN_COST[fs] + sabotMass * SHELL_MATS.aluminum.cost + (rocket ? 15 : 10 + 150 * bore),
  };
  cost.launch += propMass * PROPELLANT.rocketCost;
  const totalCost = Math.round(cost.body + cost.filler + cost.extras + cost.launch);
  // ----- terminal behaviour -----
  // shaped charges: jets. Anything solid on the axis in front reduces the jet.
  const jets = shapedIdx.map(li => {
    const st = lstat[li], l = layers[li];
    let obst = 0;
    const iFront = Math.floor(st.minX / L * N);
    for (let i = 0; i < iFront; i++) {
      const o = bins[i * RB];
      if (r[i] <= 0) continue;
      if (o < 0) obst += dx * jm.rho / 7850;
      else if (layers[o].kind === 'core') obst += dx * SHELL_MATS[layers[o].mat].rho / 7850;
      else if (layers[o].kind === 'charge' || layers[o].kind === 'shaped') obst += dx * 0.2;
    }
    const j = { linerD: 2 * st.frontR, standoff: st.minX + 0.2 * D, fillLenM: st.maxX - st.minX + dx, fillerPower: FILLERS[l.mat].power, mass: st.mass, layer: li };
    j.pen = Math.max(0, heatPen(j) - obst * 1.2);
    j.obst = obst;
    return j;
  });
  jets.sort((p, q) => p.standoff - q.standoff);
  const mainJet = jets.reduce((b, j) => (!b || j.pen > b.pen ? j : b), null);
  const shapedTNT = jets.reduce((s, j) => s + j.mass * j.fillerPower, 0);
  let type;
  if (jets.length) type = 'HEAT';
  else if (tnt > 0 && d.fuse === 'impact') type = 'HE';
  else if (tnt > 0 && d.fuse === 'squash') type = 'HESH';
  else if (tnt > 0) type = 'APHE';
  else type = 'AP';
  // penetrators
  let coreMinX = 1e9, coreMaxX = -1, coreMaxR = 0;
  layers.forEach((l, li) => { if (l.kind === 'core' && lstat[li].mass > 0) { coreMinX = Math.min(coreMinX, lstat[li].minX); coreMaxX = Math.max(coreMaxX, lstat[li].maxX); coreMaxR = Math.max(coreMaxR, lstat[li].maxR); } });
  const pyro = layers.some((l, li) => l.kind === 'core' && l.mat === 'du' && lstat[li].mass > coreMass * 0.5) || d.jacket === 'du';
  const bodyMassNoProp = flightMass - mass.prop - finMass * 0.5;
  const whole = {
    m: bodyMassNoProp, v: 0, d: D, len: L * (1 - motorLen / L * 0.6), nf,
    H: Math.max(jm.H, coreMass > 0 ? (coreH * coreMass + jm.H * mass.jacket) / (coreMass + mass.jacket) : jm.H),
    rho: Math.max(1000, bodyMassNoProp / Math.max(1e-9, volume)),
    brittle: !!jm.brittle || (coreMass > mass.jacket && layers.some(l => l.kind === 'core' && SHELL_MATS[l.mat].brittle)),
    selfSharpen: !!jm.selfSharpen || (coreMass > mass.jacket && layers.some(l => l.kind === 'core' && SHELL_MATS[l.mat].selfSharpen)),
    pyro,
  };
  const coreD = Math.max(0.004, 2 * coreMaxR);
  const core = coreMass > 0 ? {
    m: coreMass, v: 0, d: coreD, len: Math.max(0.005, coreMaxX - coreMinX + dx),
    nf: coreMinX < L * 0.08 ? clamp(0.35 + 0.3 * Ln / coreD, 0.35, 1) : 0.5, H: coreH, rho: coreRho,
    brittle: layers.some(l => l.kind === 'core' && SHELL_MATS[l.mat].brittle), selfSharpen: layers.some(l => l.kind === 'core' && SHELL_MATS[l.mat].selfSharpen), pyro,
  } : null;
  const coreMat = layers.find(l => l.kind === 'core');
  const a = {
    r, rmax, D, L, area, Ln, fineness, nf, LD, stab, stabMode, margin, cgX, cpX, Sg, bins, lstat,
    mass, flightMass, finMass, sabotMass, launchMass, cdWave, cdBase, cdFric, cdFin,
    muzzleV, thrust, burnTime, propMass, rocket, bore, maxCharge, errors, cost, totalCost,
    whole, core, jacketH: jm.H, jacketMass: mass.jacket, fillerTNT: tnt + (type === 'HEAT' ? shapedTNT : 0), chargeTNT: tnt,
    jets, mainJet, jetPen: mainJet ? mainJet.pen : 0, linerD: mainJet ? mainJet.linerD : 0, standoff: mainJet ? mainJet.standoff : 0,
    tandem: jets.length > 1, type, fuse: d.fuseDelay ?? 0.3, finTipD, span, chord, launchG, launchLoad,
    coreColor: coreMat ? SHELL_MATS[coreMat.mat].color : jm.color, jacketColor: jm.color,
    coreName: coreMat ? SHELL_MATS[coreMat.mat].name.toLowerCase() : jm.name.toLowerCase(),
  };
  a.blastRadius = a.fillerTNT > 0 ? 1.6 * Math.cbrt(a.fillerTNT) + 0.3 : 0;
  return a;
}

// Penetrator against a target of hardness H: a soft body strips off hard armour, the core carries on.
export function penetratorFor(a, targetH) {
  if (a.core && a.jacketH < 0.5 * targetH) return { ...a.core, stripped: true };
  return { ...a.whole, stripped: false };
}

// Estimated RHA penetration (mm) at velocity v.
export function estimatePen(a, v) {
  if (a.type === 'HEAT') return a.jetPen * 1000;
  if (a.type === 'HE' || a.type === 'HESH') return 0;
  return estimateKE(penetratorFor(a, TMATS[T.STEEL].H), v) * 1000;
}

// ---------- share codes ----------
export function encodeDesign(d) {
  const json = JSON.stringify(d, (k, v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v));
  return btoa(unescape(encodeURIComponent(json)));
}
export function decodeDesign(s) {
  try { return normalizeDesign(JSON.parse(decodeURIComponent(escape(atob(s.trim()))))); } catch (e) { return null; }
}
