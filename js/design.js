// Shell design model: Bezier profile -> geometry, mass, cost, aero, stability, ballistics.
import {
  SHELL_MATS, FILLERS, PROPELLANT, FIN_SPAN, FIN_COST, CANNON_MAX_BORE, CANNON_MAX_LEN,
  ROCKET_MAX_CAL, ROCKET_MAX_LEN, TMATS, T,
} from './data.js';
import { estimateKE, heatPen, clamp } from './physics.js';

export const SLICES = 120;
export const TYPES = { AP: 'Solid Shot', APHE: 'AP-HE', HE: 'High Explosive', HEAT: 'Shaped Charge' };

const A = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy });

export const PRESETS = {
  'Ogive AP': {
    type: 'AP', caliber: 0.088, length: 0.36, jacket: 'steel', core: 'hsteel', coreR: 0.7, coreLen: 0.85,
    launcher: 'cannon', bore: 0.088, charge: 6, finSize: 0,
    profile: [A(0, 0, 0, 0, 0.02, 0.45), A(0.32, 1, 0.16, 1, 0.5, 1), A(0.9, 1, 0.8, 1, 0.95, 0.97), A(1, 0.9, 0.97, 0.93, 1, 0.9)],
  },
  'Cheap HE': {
    type: 'HE', caliber: 0.09, length: 0.34, jacket: 'steel', filler: 'tnt', fillR: 0.8, fillLen: 0.62,
    launcher: 'cannon', bore: 0.09, charge: 1.2, finSize: 0,
    profile: [A(0, 0, 0, 0, 0.03, 0.5), A(0.3, 1, 0.15, 1, 0.5, 1), A(0.9, 1, 0.8, 1, 0.95, 0.95), A(1, 0.85, 0.97, 0.88, 1, 0.85)],
  },
  'Dart (APFSDS)': {
    type: 'AP', caliber: 0.026, length: 0.62, jacket: 'wha', core: 'wha', coreR: 1, coreLen: 1,
    launcher: 'cannon', bore: 0.12, charge: 10, finSize: 2,
    profile: [A(0, 0, 0, 0, 0.03, 0.5), A(0.09, 1, 0.06, 1, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
  },
  'HEAT round': {
    type: 'HEAT', caliber: 0.105, length: 0.5, jacket: 'steel', filler: 'compb', fillR: 0.85, fillLen: 0.35, capLen: 0.38,
    launcher: 'cannon', bore: 0.105, charge: 4, finSize: 0,
    profile: [A(0, 0, 0, 0, 0.0, 0.3), A(0.38, 1, 0.22, 0.6, 0.5, 1), A(1, 1, 0.9, 1, 1, 1)],
  },
  'APHE': {
    type: 'APHE', caliber: 0.1, length: 0.42, jacket: 'hsteel', core: 'hsteel', coreR: 1, coreLen: 0.4, filler: 'compb', fillR: 0.45, fillLen: 0.25, fuse: 0.4,
    launcher: 'cannon', bore: 0.1, charge: 6, finSize: 0,
    profile: [A(0, 0, 0, 0, 0.04, 0.55), A(0.3, 1, 0.16, 1, 0.5, 1), A(0.92, 1, 0.8, 1, 0.96, 0.97), A(1, 0.9, 0.98, 0.92, 1, 0.9)],
  },
  'Rocket HEAT': {
    type: 'HEAT', caliber: 0.15, length: 1.4, jacket: 'aluminum', filler: 'compb', fillR: 0.9, fillLen: 0.35, capLen: 0.35,
    launcher: 'rocket', motorLen: 0.55, finSize: 3,
    profile: [A(0, 0, 0, 0, 0.0, 0.4), A(0.12, 1, 0.07, 0.8, 0.4, 1), A(1, 1, 0.9, 1, 1, 1)],
  },
};

const DEFAULTS = {
  name: 'New Shell', type: 'AP', caliber: 0.08, length: 0.32,
  jacket: 'steel', core: 'steel', coreR: 0.7, coreLen: 0.8,
  filler: 'tnt', fillR: 0.6, fillLen: 0.4, capLen: 0.3, fuse: 0.3,
  launcher: 'cannon', bore: 0.08, charge: 3, motorLen: 0.45, finSize: 0,
  profile: PRESETS['Ogive AP'].profile,
};

export function makeDesign(preset = 'Ogive AP') {
  const d = JSON.parse(JSON.stringify({ ...DEFAULTS, ...(PRESETS[preset] || {}) }));
  d.name = preset;
  return d;
}

export function normalizeDesign(d) {
  const o = JSON.parse(JSON.stringify({ ...DEFAULTS, ...d }));
  if (!Array.isArray(o.profile) || o.profile.length < 2) o.profile = JSON.parse(JSON.stringify(DEFAULTS.profile));
  return o;
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

// Composition rings of a slice. xf: 0 tip .. 1 base. Returns [kind, rIn, rOut] with radii as fraction of R.
export function sliceRings(d, xf) {
  const rocket = d.launcher === 'rocket';
  const xm = rocket ? 1 - d.motorLen : 1;
  if (rocket && xf >= xm) return [['prop', 0, 0.82], ['jacket', 0.82, 1]];
  const xw = xf / xm;
  switch (d.type) {
    case 'AP':
      if (xw <= d.coreLen) return d.coreR >= 0.999 ? [['core', 0, 1]] : [['core', 0, d.coreR], ['jacket', d.coreR, 1]];
      return [['jacket', 0, 1]];
    case 'APHE':
      if (xw <= d.coreLen) return d.coreR >= 0.999 ? [['core', 0, 1]] : [['core', 0, d.coreR], ['jacket', d.coreR, 1]];
      if (xw <= d.coreLen + d.fillLen) return [['filler', 0, d.fillR], ['jacket', d.fillR, 1]];
      return [['jacket', 0, 1]];
    case 'HE':
      if (xw < 0.06) return [['jacket', 0, 1]];
      if (xw <= 0.06 + d.fillLen) return [['filler', 0, d.fillR], ['jacket', d.fillR, 1]];
      return [['jacket', 0, 1]];
    case 'HEAT':
      if (xw < d.capLen) return [['air', 0, 0.9], ['jacket', 0.9, 1]];
      if (xw <= d.capLen + d.fillLen) return [['filler', 0, d.fillR], ['jacket', d.fillR, 1]];
      return [['jacket', 0, 1]];
  }
  return [['jacket', 0, 1]];
}

export function fillerWord(d) { return d.type === 'AP' ? null : FILLERS[d.filler].name; }

// ---------- full analysis ----------
export function analyze(d) {
  const N = SLICES;
  const r = sampleProfile(d.profile, N);
  const L = d.length, Rm = d.caliber / 2, dx = L / N;
  const rocket = d.launcher === 'rocket';
  const jm = SHELL_MATS[d.jacket], cm = SHELL_MATS[d.core], fm = FILLERS[d.filler];
  const dens = { jacket: jm.rho, core: cm.rho, filler: fm.rho, prop: PROPELLANT.rocketRho, air: 0 };
  const mass = { jacket: 0, core: 0, filler: 0, prop: 0, air: 0 };
  let moment = 0, propMoment = 0, volume = 0;
  let rmax = 0; for (let i = 0; i < N; i++) rmax = Math.max(rmax, r[i]);
  let coreMinX = 1e9, coreMaxX = -1, coreMaxR = 0, fillMaxR = 0, fillMinX = 1e9, fillMaxX = -1;
  for (let i = 0; i < N; i++) {
    const xf = (i + 0.5) / N, R = r[i] * Rm;
    if (R <= 0) continue;
    for (const [kind, a, b] of sliceRings(d, xf)) {
      const v = Math.PI * (b * b - a * a) * R * R * dx;
      const m = v * dens[kind];
      mass[kind] += m; volume += v;
      moment += m * xf * L;
      if (kind === 'prop') propMoment += m * xf * L;
      if (kind === 'core') { coreMinX = Math.min(coreMinX, xf * L); coreMaxX = Math.max(coreMaxX, xf * L); coreMaxR = Math.max(coreMaxR, b * R); }
      if (kind === 'filler') { fillMinX = Math.min(fillMinX, xf * L); fillMaxX = Math.max(fillMaxX, xf * L); fillMaxR = Math.max(fillMaxR, b * R); }
    }
  }
  const D = 2 * rmax * Rm || 0.001;
  const area = Math.PI * D * D / 4;
  // nose / tail
  let iNose = 0; while (iNose < N - 1 && r[iNose] < 0.95 * rmax) iNose++;
  let iTail = N - 1; while (iTail > 0 && r[iTail] < 0.95 * rmax) iTail--;
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
  // masses
  const flightMass = mass.jacket + mass.core + mass.filler + mass.prop + finMass;
  const cgX = flightMass > 0 ? (moment + finMass * finX) / flightMass : L / 2;
  // centre of pressure (Barrowman-ish)
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
  const margin = (cpX - cgX) / D; // calibers, positive = stable
  const LD = L / D;
  // stability
  let stab, stabMode, Sg = 0;
  if (!rocket && fs === 0) {
    Sg = 32 / (LD * LD);
    stab = clamp((Sg - 0.9) / 0.5, 0, 1); stabMode = 'spin';
  } else {
    stab = clamp((margin - 0.1) / 1.0, 0, 1); stabMode = 'fins';
  }
  // drag coefficients (ref = max cross section)
  const cdWave = 1.0 / (1 + 1.6 * fineness * fineness);
  const cdBase = 0.25 * (rBase / (rmax * Rm || 1)) ** 2 + 0.03;
  const cdFric = 0.011 * LD;
  const cdFin = fs ? 0.012 * (4 * span * chord) / area * 0.5 + 0.02 : 0;
  // launch
  let muzzleV = 0, sabotMass = 0, maxCharge = 0, thrust = 0, burnTime = 0, launchMass = flightMass;
  const errors = [];
  const bore = Math.max(d.bore || D, D);
  if (!rocket) {
    maxCharge = 900 * bore * bore;
    if (bore > D * 1.05) sabotMass = Math.PI * ((bore / 2) ** 2 - (D / 2) ** 2) * L * 0.5 * 2700 * 0.4;
    const charge = Math.min(d.charge, maxCharge);
    launchMass = flightMass + sabotMass + charge / 3;
    const v = Math.sqrt(2 * charge * PROPELLANT.cannonEnergy / Math.max(0.01, launchMass));
    muzzleV = 2000 * Math.tanh(v / 2000);
    if (bore > CANNON_MAX_BORE + 1e-6) errors.push(`Gun bore over ${CANNON_MAX_BORE * 1000} mm`);
    if (L > CANNON_MAX_LEN + 1e-6) errors.push(`Cannon rounds max ${CANNON_MAX_LEN} m long`);
    if (fs && finTipD > bore + 1e-6) errors.push('Fins wider than the gun bore — widen bore (sabot)');
    if (d.charge > maxCharge + 1e-6) errors.push('Charge exceeds chamber size (clamped)');
  } else {
    burnTime = 0.5 + 2.0 * d.motorLen;
    thrust = mass.prop * PROPELLANT.rocketVe / burnTime;
    muzzleV = 25;
    if (D > ROCKET_MAX_CAL + 1e-6) errors.push(`Rocket max caliber ${ROCKET_MAX_CAL * 1000} mm`);
    if (L > ROCKET_MAX_LEN + 1e-6) errors.push(`Rocket max length ${ROCKET_MAX_LEN} m`);
    if (mass.prop <= 0) errors.push('Rocket has no propellant');
  }
  if (flightMass < 0.01) errors.push('Shell is too small');
  if (D < 0.015 - 1e-6) errors.push('Minimum caliber is 15 mm');
  if (LD > 30) errors.push(`Too slender: L/D ${LD.toFixed(0)} > 30 (it would snap)`);
  // cost
  const cost = { body: 0, filler: 0, launch: 0, extras: 0 };
  cost.body = mass.jacket * jm.cost + mass.core * cm.cost;
  cost.filler = mass.filler * fm.cost;
  cost.extras = 8 + (d.type !== 'AP' ? 25 : 0) + FIN_COST[fs] + sabotMass * SHELL_MATS.aluminum.cost + (rocket ? 15 : 10 + 150 * bore);
  cost.launch = rocket ? mass.prop * PROPELLANT.rocketCost : Math.min(d.charge, maxCharge) * PROPELLANT.cannonCost;
  const totalCost = Math.round(cost.body + cost.filler + cost.extras + cost.launch);

  // penetrators
  const jacketH = jm.H;
  const coreLenM = coreMaxX >= 0 ? coreMaxX - Math.max(0, coreMinX - dx / 2) + dx / 2 : 0;
  const whole = {
    m: flightMass - mass.prop - finMass * 0.5, v: 0, d: D, len: L * (rocket ? 1 - d.motorLen : 1), nf,
    H: d.type === 'AP' || d.type === 'APHE' ? Math.max(cm.H * 0.7 + jm.H * 0.3, jm.H) : jm.H,
    rho: Math.max(1000, (flightMass - mass.prop) / Math.max(volume, 1e-9)),
    brittle: !!cm.brittle && d.coreR > 0.6, selfSharpen: !!cm.selfSharpen && d.coreR > 0.6, pyro: !!cm.pyro,
  };
  const core = mass.core > 0 ? {
    m: mass.core, v: 0, d: Math.max(0.004, 2 * coreMaxR), len: Math.max(0.005, coreLenM),
    nf: clamp(0.35 + 0.3 * Ln / Math.max(0.004, 2 * coreMaxR), 0.35, 1), H: cm.H, rho: cm.rho,
    brittle: !!cm.brittle, selfSharpen: !!cm.selfSharpen, pyro: !!cm.pyro,
  } : null;
  const fillerTNT = mass.filler * fm.power;
  const a = {
    r, rmax, D, L, area, Ln, fineness, nf, LD, stab, stabMode, margin, cgX, cpX, Sg,
    mass, flightMass, finMass, sabotMass, launchMass, cdWave, cdBase, cdFric, cdFin,
    muzzleV, thrust, burnTime, rocket, bore, maxCharge, errors, cost, totalCost,
    whole, core, jacketH, jacketMass: mass.jacket, fillerTNT, fillerPower: fm.power,
    linerD: d.type === 'HEAT' ? 2 * fillMaxR : 0,
    standoff: d.type === 'HEAT' ? Math.max(0, fillMinX) + 0.2 * D : 0,
    fillLenM: fillMaxX > 0 ? fillMaxX - fillMinX + dx : 0,
    type: d.type, fuse: d.fuse, finTipD, span, chord,
  };
  a.jetPen = d.type === 'HEAT' ? heatPen(a) : 0;
  a.blastRadius = fillerTNT > 0 ? 1.6 * Math.cbrt(fillerTNT) + 0.3 : 0;
  return a;
}

// Penetrator against a target of hardness H: jacket holds on soft targets.
export function penetratorFor(a, targetH) {
  if (a.type === 'AP' && a.core && a.jacketH < 0.5 * targetH) return { ...a.core };
  return { ...a.whole };
}

// Estimated RHA penetration (mm) at velocity v.
export function estimatePen(a, v) {
  if (a.type === 'HEAT') return a.jetPen * 1000;
  if (a.type === 'HE') return 0;
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
