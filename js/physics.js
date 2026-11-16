// Shared terminal-ballistics helpers.
import { TMATS, T, AIR_RHO, SOUND } from './data.js';

export const K_ERO = 4.3;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// One step of kinetic penetration of length ds (m) through target material tm.
// p: { m, v, d, len, nf, H, rho, brittle, selfSharpen, yaw }
// Returns false when the penetrator is stopped / consumed.
export function keStep(p, tm, ds) {
  const A = Math.PI * p.d * p.d * 0.25;
  const sy = Math.min(1, Math.abs(Math.sin(p.yaw)));
  const Aeff = A * (1 - sy) + p.d * p.len * sy * 0.8;
  const nfE = p.nf * (1 - sy);
  const shape = 1.25 - 0.6 * nfE;
  const cost = tm.R * Aeff * ds * shape;
  // erosion of the penetrator: strongest just above the erosion threshold, easing at
  // hyper-velocity (Tate-like), and mostly a long-rod effect (short shells barely erode).
  const ev = clamp((p.v - 300) / 200, 0, 1) * Math.pow(1000 / Math.max(p.v, 500), 1.64);
  if (ev > 0 && tm.H > p.H * 0.25) {
    const slender = clamp((p.len / p.d - 3) / 6, 0.15, 1);
    let er = ds * Math.sqrt(tm.rho / p.rho) * Math.pow(tm.H / p.H, 0.7) * ev * K_ERO * slender;
    if (p.brittle && tm.H >= 8) er *= 1.6;
    const lose = Math.min(p.len, er);
    const f = (p.len - lose) / p.len;
    p.m *= f; p.len -= lose;
  }
  if (!p.selfSharpen) p.nf = Math.max(0.3, p.nf - ds * (tm.H / p.H) * 0.5);
  if (p.H < tm.H * 0.6) p.d = Math.min(p.d * 1.6, p.d * (1 + ds * 1.5 * (tm.H / p.H - 1) * 0.15));
  const E = 0.5 * p.m * p.v * p.v - cost;
  if (E <= 0 || p.len <= 0.003 || p.m <= 0.002) { p.v = 0; return false; }
  p.v = Math.sqrt(2 * E / p.m);
  return true;
}

// Estimated penetration (m) into uniform material at velocity v.
export function estimateKE(pen, v, matId = T.STEEL) {
  const p = { ...pen, v, yaw: 0 };
  const tm = TMATS[matId];
  let depth = 0; const ds = 0.0025;
  for (let i = 0; i < 4000; i++) { if (!keStep(p, tm, ds)) break; depth += ds; }
  return depth;
}

// HEAT jet potential in metres of RHA.
export function heatPen(a) {
  if (!a.linerD) return 0;
  const sd = a.standoff / a.linerD;
  let sof = sd < 2 ? 0.55 + 0.225 * sd : sd < 5 ? 1 : Math.max(0.5, 1 - (sd - 5) * 0.04);
  const lenF = Math.min(1, Math.sqrt(a.fillLenM / a.linerD));
  return a.linerD * 4.6 * Math.pow(a.fillerPower, 0.35) * sof * lenF;
}

export function dragCd(a, mach, burning) {
  let wave, base = a.cdBase;
  if (mach < 0.8) wave = 0.0;
  else if (mach < 1.2) wave = a.cdWave * ((mach - 0.8) / 0.4) * 1.15;
  else wave = a.cdWave * Math.pow(1.2 / mach, 0.5) * 1.1;
  if (mach < 0.9) base *= 0.5;
  if (burning) base *= 0.25;
  return wave + base + a.cdFric + a.cdFin;
}

export function airDecel(a, v, burning, yaw) {
  const cd = dragCd(a, v / SOUND, burning) * (1 + 7 * Math.sin(yaw) ** 2);
  return 0.5 * AIR_RHO * v * v * cd * a.area;
}
