// World simulation: flight, terminal ballistics, blast and fragments. DOM-free.
import { CELL, G_ROWS, GRID_W, GRID_H, T, TMATS, GRAVITY, AIR_RHO, MUZZLE_H } from './data.js';
import { Grid } from './grid.js';
import { keStep, airDecel, clamp } from './physics.js';
import { penetratorFor } from './design.js';

const NOOP_FX = new Proxy({}, { get: () => () => {} });
const DEG = Math.PI / 180;
let BARREL = 2.2; // distance from the gun's trunnion to the muzzle (m)

export class World {
  constructor({ build, dist, fx }) {
    this.grid = new Grid(build);
    this.dist = dist;
    this.x0 = dist;
    this.fx = fx || NOOP_FX;
    this.proj = null;
    this.frags = [];
    this.time = 0;
    this.hot = [];
    this.collapsePending = false;
    this.debrisBudget = 300;
    this.shot = { result: '', impactV: 0, depth: 0, notes: [], log: [] };
  }

  static setBarrel(len) { BARREL = len; }
  static get barrel() { return BARREL; }
  static muzzle(angle) { return [Math.cos(angle) * BARREL, MUZZLE_H + Math.sin(angle) * BARREL]; }

  get gridW() { return GRID_W * CELL; }
  get gridTop() { return G_ROWS * CELL; }
  cellI(x) { return Math.floor((x - this.x0) / CELL); }
  cellJ(y) { return G_ROWS - 1 - Math.floor(y / CELL); }
  cx(i) { return this.x0 + (i + 0.5) * CELL; }
  cy(j) { return (G_ROWS - 1 - j + 0.5) * CELL; }
  matAt(x, y) { return this.grid.get(this.cellI(x), this.cellJ(y)); }
  inGrid(x, y) { return x >= this.x0 && x < this.x0 + this.gridW && y < this.gridTop && y > -GRID_H * CELL; }

  busy() { return !!this.proj || this.frags.length > 0; }
  log(msg) { if (this.shot.log.length < 40) this.shot.log.push(msg); }

  // ---------- launching ----------
  fire(design, a, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const v0 = a.muzzleV;
    const [mx, my] = World.muzzle(angle);
    this.proj = {
      d: design, a, x: mx, y: my, vx: c * v0, vy: s * v0,
      state: 'flight', t: 0, mass: a.flightMass, burn: a.thrust > 0 ? a.burnTime : 0,
      yaw: 0.002 + (1 - a.stab) * 0.05, yawPhase: Math.random() * 6, noise: Math.random() * 2 - 1, noise2: Math.random() * 2 - 1,
      ricochets: 0, contact: -1, inSolid: false, lastMat: 0, depth: 0, impactV: 0, maxY: 0,
    };
    this.shot = { result: 'flying', impactV: 0, depth: 0, notes: [], log: [], coreBefore: this.grid.coreFraction() };
    this.debrisBudget = 320;
    this.embedded = null;
    this.fx.muzzle(mx, my, angle, a.rocket, a.D);
  }

  // One ideal-flight integration step shared by prediction helpers.
  static *flight(a, angle) {
    let [x, y] = World.muzzle(angle);
    let vx = Math.cos(angle) * a.muzzleV, vy = Math.sin(angle) * a.muzzleV;
    let m = a.flightMass, burn = a.thrust > 0 ? a.burnTime : 0, t = 0;
    const mdot = a.thrust > 0 ? a.mass.prop / a.burnTime : 0;
    const yaw = 0.002 + (1 - a.stab) * 0.05;
    while (t < 90) {
      const v = Math.hypot(vx, vy) || 1e-6;
      const h = yield { x, y, vx, vy, v, t, burn };
      let ax = 0, ay = -GRAVITY;
      if (burn > 0) { const f = a.thrust / m; ax += f * vx / v; ay += f * vy / v; m -= mdot * h; burn -= h; }
      const fd = airDecel(a, v, burn > 0, yaw) / m;
      ax -= fd * vx / v; ay -= fd * vy / v;
      vx += ax * h; vy += ay * h; x += vx * h; y += vy * h; t += h;
    }
  }

  // Ideal trajectory up to xTarget (used by the balancing tools and the menu demo).
  static trajectory(a, angle, xTarget, maxT = 60, pts = null) {
    const it = World.flight(a, angle);
    let s = it.next().value, px = s.x, py = s.y;
    while (s && s.t < maxT) {
      const h = s.burn > 0 ? 1 / 240 : clamp(3 / s.v, 1 / 480, 1 / 60);
      px = s.x; py = s.y;
      s = it.next(h).value;
      if (!s) break;
      if (pts && pts.length < 4000) pts.push(s.x, s.y);
      if (s.x >= xTarget) { const f = (xTarget - px) / (s.x - px); return { y: py + (s.y - py) * f, v: s.v, t: s.t, hit: true }; }
      if (s.y < -1 || (s.vx <= 0.5 && s.burn <= 0)) return { y: -1e9, v: 0, t: s.t, hit: false, x: s.x };
    }
    return { y: -1e9, v: 0, t: 0, hit: false, x: px };
  }

  static solveAngle(a, xT, yT) {
    const f = ang => World.trajectory(a, ang, xT).y - yT;
    let lo = -4 * DEG, hi = 45 * DEG;
    if (f(hi) < 0) return { angle: hi, ok: false };
    if (f(lo) > 0) return { angle: lo, ok: true };
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
    const ang = (lo + hi) / 2;
    const tr = World.trajectory(a, ang, xT);
    return { angle: ang, ok: true, v: tr.v, t: tr.t };
  }

  // Where would an ideal (perfectly stable) shot at this elevation strike this world?
  predict(a, angle, pts = null) {
    const it = World.flight(a, angle);
    let s = it.next().value, apex = 0;
    while (s && s.t < 90) {
      const near = s.x > this.x0 - s.v * 0.02 - 1 && s.x < this.x0 + this.gridW + 1 && s.y < this.gridTop + 1;
      const h = near ? Math.min(1 / 240, CELL * 0.45 / s.v) : s.burn > 0 ? 1 / 240 : clamp(4 / s.v, 1 / 480, 1 / 40);
      s = it.next(h).value;
      if (!s) break;
      if (pts && (pts.length < 6000) && (!near || pts.length % 8 === 0)) pts.push(s.x, s.y);
      apex = Math.max(apex, s.y);
      if (this.inGrid(s.x, s.y)) {
        const m = this.matAt(s.x, s.y);
        if (m) return { hit: true, x: s.x, y: s.y, v: s.v, t: s.t, mat: m, apex };
      }
      if (s.y < 0 && !(s.x >= this.x0 && s.x < this.x0 + this.gridW)) return { hit: false, x: s.x, y: 0, v: s.v, t: s.t, short: s.x < this.x0, apex };
      if (s.x > this.x0 + this.gridW + 2) return { hit: false, x: s.x, y: s.y, v: s.v, t: s.t, over: true, apex };
      if (s.vx <= 0.5 && s.burn <= 0) return { hit: false, x: s.x, y: s.y, v: s.v, t: s.t, short: true, apex };
    }
    return { hit: false, x: s ? s.x : 0, y: 0, v: 0, t: 90, short: true, apex };
  }

  // ---------- stepping ----------
  step(dt) {
    let left = dt, guard = 0;
    while (left > 1e-9 && guard++ < 5000) {
      let h = Math.min(left, 1 / 240);
      const p = this.proj;
      if (p) {
        const v = Math.hypot(p.vx, p.vy) || 1;
        const near = p.x > this.x0 - v * 0.02 - 2 && p.x < this.x0 + this.gridW + 1 && p.y < this.gridTop + 2;
        if (near || p.state !== 'flight') h = Math.min(h, (CELL * 0.4) / v);
      }
      if (this.frags.length) h = Math.min(h, (CELL * 0.5) / 1800);
      this.time += h; left -= h;
      if (this.proj) this.stepProj(h);
      if (this.frags.length) this.stepFrags(h);
    }
    if (!this.busy() && this.collapsePending) { this.collapsePending = false; this.collapse(); }
  }

  stepProj(h) {
    const p = this.proj, a = p.a;
    p.t += h;
    if (p.state === 'flight') {
      const v = Math.hypot(p.vx, p.vy) || 1e-6;
      let ax = 0, ay = -GRAVITY;
      const burning = p.burn > 0;
      if (burning) {
        const f = a.thrust / p.mass;
        ax += f * p.vx / v; ay += f * p.vy / v;
        const lat = f * 0.004 * (1.05 - a.stab) * p.noise2;
        ax += -p.vy / v * lat; ay += p.vx / v * lat;
        p.mass -= a.mass.prop / a.burnTime * h; p.burn -= h;
        if (Math.random() < h * 60) this.fx.trail(p.x, p.y, p.vx, p.vy, true);
      }
      if (a.stab >= 0.98) p.yaw = Math.max(0.0003, p.yaw * Math.exp(-h * 3));
      else p.yaw = Math.min(1.5, p.yaw + p.yaw * 7 * (1 - a.stab) ** 2 * h);
      p.yawPhase += h * (18 + 10 * a.stab);
      p.noise = clamp(p.noise + (Math.random() * 2 - 1) * h * 6, -1, 1);
      p.noise2 = clamp(p.noise2 + (Math.random() * 2 - 1) * h * 3, -1, 1);
      const fd = airDecel(a, v, burning, p.yaw) / p.mass;
      ax -= fd * p.vx / v; ay -= fd * p.vy / v;
      const lift = 0.5 * AIR_RHO * v * v * a.area * 1.2 * Math.sin(2 * Math.min(p.yaw, 0.78)) / p.mass * p.noise;
      ax += -p.vy / v * lift; ay += p.vx / v * lift;
      p.vx += ax * h; p.vy += ay * h;
      p.x += p.vx * h; p.y += p.vy * h;
      if (p.y > p.maxY) p.maxY = p.y;
      if (!burning && p.yaw < 0.2 && Math.random() < h * 30 && v > 300) this.fx.trail(p.x, p.y, p.vx, p.vy, false);
      if (this.inGrid(p.x, p.y)) {
        const m = this.matAt(p.x, p.y);
        if (m) { this.impact(m); return; }
      }
      if (p.y < 0 && !(p.x >= this.x0 && p.x < this.x0 + this.gridW)) {
        this.shot.result = p.x < this.x0 ? `Missed — landed ${Math.round(this.x0 - p.x)} m short` : 'Missed — landed long';
        this.log(this.shot.result);
        if (a.fillerTNT > 0) this.detonate(p.x, 0.05, a.fillerTNT, a.jacketMass);
        else this.fx.dust(p.x, 0, 1);
        this.endProj(); return;
      }
      if (p.x > this.x0 + this.gridW + 2 || p.t > 90 || (p.vx < 0 && p.burn <= 0)) {
        this.shot.result = 'Missed — flew over';
        this.log(this.shot.result);
        this.endProj();
      }
    } else if (p.state === 'pen') {
      this.stepPen(h);
    }
  }

  surfaceNormal(i, j, dx, dy) {
    let sx = 0, sy = 0;
    for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
      if (this.grid.get(i + c, j + b)) { sx += c; sy -= b; }
    }
    const l = Math.hypot(sx, sy);
    if (l < 2) return [-dx, -dy];
    return [-sx / l, -sy / l];
  }

  impact(m) {
    const p = this.proj, a = p.a;
    const v = Math.hypot(p.vx, p.vy), dx = p.vx / v, dy = p.vy / v;
    const i = this.cellI(p.x), j = this.cellJ(p.y);
    const [nx, ny] = this.surfaceNormal(i, j, dx, dy);
    const cosT = clamp(-(dx * nx + dy * ny), -1, 1);
    const theta = Math.acos(cosT);
    const tm = TMATS[m];
    if (!this.shot.impactV) {
      this.shot.impactV = v; this.shot.angle = theta / DEG;
      this.log(`Impact on ${tm.name} at ${v.toFixed(0)} m/s, ${(theta / DEG).toFixed(0)}° from square`);
    }
    const yawNow = p.yaw * Math.abs(Math.sin(p.yawPhase));
    if (yawNow > 0.25) this.log(`Arrived ${(yawNow / DEG).toFixed(0)}° sideways (unstable)`);
    const bx = p.x - dx * CELL * 0.6, by = p.y - dy * CELL * 0.6;
    if (a.type === 'HE') {
      this.shot.result = 'Detonated on contact';
      this.log(`Burst: ${a.fillerTNT.toFixed(2)} kg TNT-equivalent`);
      this.detonate(bx, by, a.fillerTNT, a.jacketMass);
      this.endProj(); return;
    }
    if (a.type === 'HESH') { this.squash(p.x, p.y, bx, by, dx, dy, m); this.endProj(); return; }
    if (a.type === 'HEAT') {
      this.shot.result = 'Shaped charge fired';
      const yf = Math.pow(Math.cos(Math.min(yawNow, 1.4)), 4);
      a.jets.forEach((jt, k) => {
        const last = k === a.jets.length - 1;
        this.log(`${a.jets.length > 1 ? (last ? 'Main jet' : 'Precursor jet') : 'Jet'}: ${(jt.pen * yf * 1000).toFixed(0)} mm potential${jt.obst > 0.01 ? ` (lost ${(jt.obst * 1200).toFixed(0)} mm cutting through your own shell)` : ''}`);
        this.fireJet(p.x - dx * CELL * 0.3, p.y - dy * CELL * 0.3, dx, dy, jt.pen * yf, jt.linerD, !last);
      });
      this.detonate(bx, by, a.fillerTNT * 0.5, a.jacketMass, true);
      this.endProj(); return;
    }
    if (tm.fixed) { this.shot.result = 'Hit the ground'; this.fx.dust(p.x, p.y, 1); if (a.type === 'APHE') this.detonate(bx, by, a.fillerTNT, a.jacketMass); this.endProj(); return; }
    let thetaC = (64 + (1 - a.nf) * 16 + (a.LD > 8 ? 8 : 0) + (v > 1300 ? 4 : 0)) * DEG;
    if (tm.H < 3) thetaC = 89 * DEG;
    if (theta > thetaC && p.ricochets < 3) {
      const dot = dx * nx + dy * ny;
      const rx = dx - 2 * dot * nx, ry = dy - 2 * dot * ny;
      const sp = v * 0.55;
      p.vx = rx * sp; p.vy = ry * sp; p.x = bx; p.y = by; p.ricochets++;
      p.yaw = Math.min(1.5, p.yaw + 0.5);
      this.grid.damage(i, j, 0.6);
      this.fx.spark(p.x, p.y, rx * 200, ry * 200, 40, 0.6, 400);
      this.fx.shake(0.3);
      this.shot.notes.push('Ricochet!'); this.log(`Ricochet off ${tm.name} (too shallow: ${(theta / DEG).toFixed(0)}° > ${(thetaC / DEG).toFixed(0)}°)`);
      this.shot.result = 'Ricochet';
      return;
    }
    const pen = penetratorFor(a, tm.H);
    pen.v = v; pen.yaw = yawNow;
    if (pen.stripped) {
      // the softer body peels away and the hard inner core carries on
      this.carve(p.x, p.y, a.D / 2, dx, dy, -dx * 20, -dy * 20, 30, 0);
      this.fx.peel(bx, by, dx, dy, a.jacketColor, Math.round(10 + a.D * 120));
      this.fx.molten(bx, by, -dx * 6, -dy * 6, 14);
      this.shot.notes.push('Body stripped');
      this.log(`Outer body peels off on the ${tm.name} — ${a.coreName} core carries on (${pen.m.toFixed(2)} kg)`);
    }
    const turn = Math.min(theta, (5 + 8 * (1 - a.nf)) * DEG);
    const ang = Math.atan2(dy, dx), tgt = Math.atan2(-ny, -nx);
    let diff = tgt - ang; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    const na = ang + clamp(diff, -turn, turn);
    p.dx = Math.cos(na); p.dy = Math.sin(na);
    p.pen = pen; p.state = 'pen'; p.contact = 0; p.depth = 0; p.cellKey = -1; p.layer = null;
    this.fx.spark(bx, by, -p.dx * 300, -p.dy * 300, 30, 1.0, 500);
    this.fx.flash(bx, by, 0.1 + a.D);
    this.fx.shake(0.25 + Math.min(1, pen.m * v * v / 2 / 2e7));
    this.shot.result = 'Penetrating';
  }

  openLayer(m) {
    const p = this.proj;
    if (p.layer && p.layer.mat === m) return;
    this.closeLayer('through');
    p.layer = { mat: m, len: 0, v0: p.pen.v };
  }
  closeLayer(how) {
    const p = this.proj;
    if (!p || !p.layer) return;
    const L = p.layer; p.layer = null;
    const mm = Math.round(L.len * 1000);
    if (how === 'through') this.log(`${TMATS[L.mat].name}: ${mm} mm — through (${L.v0.toFixed(0)}→${p.pen.v.toFixed(0)} m/s)`);
    else this.log(`${TMATS[L.mat].name}: ${mm} mm — ${how}`);
  }

  stepPen(h) {
    const p = this.proj, a = p.a, pen = p.pen;
    const ds = Math.min(pen.v * h, CELL * 0.45);
    p.x += p.dx * ds; p.y += p.dy * ds;
    p.vx = p.dx * pen.v; p.vy = p.dy * pen.v;
    if (p.contact >= 0) p.contact += ds;
    if (!this.inGrid(p.x, p.y)) { this.closeLayer('through'); this.shot.result = p.depth > 0 ? 'Passed right through' : this.shot.result; this.endProj(); return; }
    const i = this.cellI(p.x), j = this.cellJ(p.y);
    const key = j * GRID_W + i;
    if (key === p.cellKey) return;
    p.cellKey = key;
    const m = this.grid.get(i, j);
    if (m) {
      const tm = TMATS[m];
      if (tm.fixed) { this.closeLayer('through'); this.stopPen('Buried in the ground'); return; }
      if (tm.era) {
        this.triggerERA(i, j);
        pen.len *= 0.72; pen.m *= 0.72; pen.yaw = Math.min(1.2, pen.yaw + 0.18);
        const na = Math.atan2(p.dy, p.dx) + (Math.random() < 0.5 ? -1 : 1) * 4 * DEG;
        p.dx = Math.cos(na); p.dy = Math.sin(na);
        this.shot.notes.push('Reactive tile hit'); this.log('Reactive tile exploded — penetrator cut and knocked off line');
        return;
      }
      this.openLayer(m);
      const chord = CELL / Math.max(Math.abs(p.dx), Math.abs(p.dy));
      const alive = keStep(pen, tm, chord);
      p.depth += chord; p.layer.len += chord;
      const sy = Math.abs(Math.sin(pen.yaw));
      let rad = Math.max(pen.d / 2, pen.d * pen.len * sy / 2);
      if (m === T.CORE) rad = rad * 1.4 + CELL * clamp(0.5 * pen.m * pen.v * pen.v / 2.5e5, 0, 1.5);
      this.carve(p.x, p.y, rad, p.dx, p.dy, p.dx * Math.min(pen.v, 300) * 0.1, p.dy * Math.min(pen.v, 300) * 0.1, 3);
      if (tm.H >= 3) {
        this.heatRing(p.x, p.y, rad + CELL * 1.2);
        if (Math.random() < 0.6) this.fx.molten(p.x - p.dx * CELL, p.y - p.dy * CELL, -p.dx * 4 + (Math.random() - 0.5) * 4, -p.dy * 4 + Math.random() * 3, 2);
      }
      if (Math.random() < 0.35) this.fx.spark(p.x - p.dx * CELL, p.y - p.dy * CELL, -p.dx * 120, -p.dy * 120, 3, 1.4, 260);
      p.inSolid = true; p.lastMat = m;
      if (!alive) { this.closeLayer('stopped'); this.stopPen(`Stopped inside the ${tm.name.toLowerCase()}`); return; }
    } else if (p.inSolid) {
      p.inSolid = false;
      this.closeLayer('through');
      this.spall(p.x, p.y, p.dx, p.dy, pen, p.lastMat);
    }
    if (a.type === 'APHE' && p.contact >= a.fuse) {
      this.closeLayer('through');
      this.shot.result = 'Burrowed in, then detonated';
      this.log(`Delay fuse fired ${(p.contact * 100).toFixed(0)} cm after impact: ${a.fillerTNT.toFixed(2)} kg TNT-eq`);
      this.detonate(p.x, p.y, a.fillerTNT, a.jacketMass * 0.5);
      this.endProj();
    }
  }

  stopPen(msg) {
    const p = this.proj, a = p.a;
    if (a.type === 'APHE') {
      this.shot.result = 'Stopped, then detonated';
      this.log(`Charge goes off where the shell stopped: ${a.fillerTNT.toFixed(2)} kg TNT-eq`);
      this.detonate(p.x - p.dx * CELL, p.y - p.dy * CELL, a.fillerTNT, a.jacketMass * 0.5);
    } else {
      this.shot.result = msg;
      this.embedded = { x: p.x, y: p.y, ang: Math.atan2(p.dy, p.dx), a, len: p.pen.len, d: p.pen.d, stripped: p.pen.stripped };
    }
    this.endProj();
  }

  endProj() {
    const p = this.proj;
    if (p && p.depth) this.shot.depth = Math.max(this.shot.depth, p.depth);
    this.proj = null;
    this.collapsePending = true;
  }

  // Destroy the cross-section disc (radius rad, m) perpendicular to direction (dx,dy).
  // Cells ahead of the point are never removed, so armour must be paid for.
  carve(x, y, rad, dx, dy, vx, vy, debrisN, ahead = 0.5) {
    const g = this.grid;
    const ci = this.cellI(x), cj = this.cellJ(y);
    const rc = Math.max(0.5, rad / CELL);
    const R = Math.ceil(rc);
    let n = 0;
    for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
      const ox = c, oy = -b;
      const along = ox * dx + oy * dy;
      const lat = Math.abs(ox * dy - oy * dx);
      if (!(b === 0 && c === 0) && (along > ahead || along < -1.2 || lat > rc + 0.2)) continue;
      const m = g.destroy(ci + c, cj + b, rad < 0.2);
      if (m) {
        n++;
        if (n <= debrisN && this.debrisBudget > 0) { this.debrisBudget--; this.fx.debris(this.cx(ci + c), this.cy(cj + b), vx + (Math.random() - 0.5) * 18, vy + Math.random() * 12, m); }
      }
    }
    return n;
  }

  // Cells around a hole glow red-hot and cool down over a few seconds.
  heatRing(x, y, rad) {
    const g = this.grid, ci = this.cellI(x), cj = this.cellJ(y);
    const R = Math.ceil(rad / CELL);
    for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
      const i = ci + c, j = cj + b;
      if (i < 0 || j < 0 || i >= g.W || j >= G_ROWS) continue;
      const k = j * g.W + i, m = g.mat[k];
      if (!m || TMATS[m].fixed || c * c + b * b > R * R + 1) continue;
      if (!g.heat[k]) { if (this.hot.length > 5000) continue; this.hot.push(k); }
      g.heat[k] = 255; g.mark(k);
    }
  }
  cool(dt) {
    const g = this.grid, d = Math.max(1, Math.round(dt * 110));
    for (let n = this.hot.length - 1; n >= 0; n--) {
      const k = this.hot[n];
      const h = g.mat[k] ? Math.max(0, g.heat[k] - d) : 0;
      g.heat[k] = h; g.mark(k);
      if (!h) { this.hot[n] = this.hot[this.hot.length - 1]; this.hot.pop(); }
    }
  }

  spall(x, y, dx, dy, pen, lastMat) {
    const tm = TMATS[lastMat];
    if (!tm || tm.H < 2.5) return;
    const E = 0.5 * pen.m * pen.v * pen.v;
    let n = clamp(Math.round(E / 4e4), 0, 34);
    if (n < 2) return;
    if (pen.pyro) n = Math.round(n * 1.4);
    const base = Math.atan2(dy, dx), spread = 0.35 + Math.min(0.8, pen.yaw);
    for (let k = 0; k < n; k++) {
      const ang = base + (Math.random() + Math.random() - 1) * spread;
      const sp = Math.min(Math.max(pen.v, 300), 1400) * (0.4 + Math.random() * 0.5);
      this.addFrag(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.02 + Math.random() * 0.05, 0.25);
    }
    this.fx.spark(x, y, dx * 400, dy * 400, 30, spread, 700);
    this.fx.molten(x, y, dx * 8, dy * 8, 8);
    if (pen.pyro) this.fx.flash(x, y, 1.2);
    this.log(`Spall: ${n} fragments burst out of the back of the ${tm.name.toLowerCase()}${pen.pyro ? ' (uranium ignites!)' : ''}`);
  }

  addFrag(x, y, vx, vy, m, life = 0.3) {
    if (this.frags.length > 260) return;
    this.frags.push({ x, y, vx, vy, m, A: Math.pow(m / 7850, 2 / 3), life });
  }

  stepFrags(h) {
    const g = this.grid, fr = this.frags;
    for (let k = fr.length - 1; k >= 0; k--) {
      const f = fr[k];
      f.life -= h;
      const v = Math.hypot(f.vx, f.vy);
      f.x += f.vx * h; f.y += f.vy * h;
      f.vx *= 1 - h * 0.6; f.vy = f.vy * (1 - h * 0.6) - GRAVITY * h;
      let dead = f.life <= 0 || v < 60 || !this.inGrid(f.x, f.y);
      if (!dead) {
        const i = this.cellI(f.x), j = this.cellJ(f.y), m = g.get(i, j);
        if (m) {
          const tm = TMATS[m];
          if (tm.fixed) dead = true;
          else {
            const cost = tm.R * f.A * CELL * (m === T.CORE ? 0.5 : 1);
            const E = 0.5 * f.m * v * v;
            if (E > cost) {
              g.destroy(i, j, true);
              if (this.debrisBudget > 0 && Math.random() < 0.3) { this.debrisBudget--; this.fx.debris(f.x, f.y, f.vx * 0.03, f.vy * 0.03 + 4, m); }
              const nv = Math.sqrt(2 * (E - cost) / f.m) / v;
              f.vx *= nv; f.vy *= nv;
            } else {
              g.damage(i, j, 0.6 * E / cost);
              if (Math.random() < 0.3) this.fx.spark(f.x, f.y, -f.vx * 0.2, -f.vy * 0.2, 2, 2, 120);
              dead = true;
            }
          }
        }
      }
      if (dead) { fr[k] = fr[fr.length - 1]; fr.pop(); }
    }
  }

  // ---------- explosives ----------
  detonate(x, y, W, casingMass = 0, quiet = false) {
    if (W <= 0) return;
    this.blast(x, y, W);
    if (casingMass > 0) {
      const cm = W / casingMass;
      const v = 2400 * Math.sqrt(cm / (1 + 0.5 * cm));
      const n = clamp(Math.round(casingMass * 6), 6, 48);
      const fm = casingMass * 0.7 / n;
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * Math.PI * 2;
        const s = v * (0.7 + Math.random() * 0.4);
        this.addFrag(x, y, Math.cos(ang) * s, Math.sin(ang) * s, fm, 0.2);
      }
    }
    const size = Math.cbrt(W);
    this.fx.explosion(x, y, size * (quiet ? 0.7 : 1));
    this.fx.shake(Math.min(1.6, 0.4 + size * 0.5));
  }

  // Squash head: the explosive pancakes on the face and knocks a scab off the back.
  squash(px, py, bx, by, dx, dy, m) {
    const a = this.proj.a, W = a.fillerTNT, tm = TMATS[m];
    let t = 0, x = px, y = py;
    while (t < 0.9) { x += dx * CELL * 0.5; y += dy * CELL * 0.5; t += CELL * 0.5; if (!this.inGrid(x, y)) break; const mm = this.matAt(x, y); if (!mm || TMATS[mm].fixed) break; }
    const limit = 0.04 + 0.065 * Math.cbrt(W);
    this.log(`Squash head spreads ${W.toFixed(2)} kg TNT-eq on a ${(t * 1000).toFixed(0)} mm ${tm.name.toLowerCase()} face`);
    this.detonate(bx, by, W, a.jacketMass * 0.3);
    if (tm.H >= 2.5 && t <= limit && this.matAt(x, y) === 0) {
      const rs = Math.max(CELL * 1.5, a.D * 0.9);
      const g = this.grid, ci = this.cellI(x), cj = this.cellJ(y), R = Math.ceil(rs / CELL);
      for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
        const along = c * dx - b * dy;
        if (along > 0.5 || along < -2.5 || c * c + b * b > R * R) continue;
        const mm = g.destroy(ci + c, cj + b);
        if (mm && this.debrisBudget-- > 0) this.fx.debris(this.cx(ci + c), this.cy(cj + b), dx * 25 + (Math.random() - 0.5) * 10, dy * 25 + Math.random() * 8, mm);
      }
      const n = Math.round(10 + 18 * Math.cbrt(W)), base = Math.atan2(dy, dx);
      for (let k = 0; k < n; k++) {
        const ang = base + (Math.random() + Math.random() - 1) * 0.7, sp = 250 + Math.random() * 400;
        this.addFrag(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.05 + Math.random() * 0.15, 0.3);
      }
      this.fx.spark(x, y, dx * 300, dy * 300, 30, 0.8, 500);
      this.shot.result = 'Scab blown off the back face';
      this.log(`Shock wave tears a scab off the back: ${n} heavy fragments`);
    } else {
      this.shot.result = 'Squash head — plate too thick';
      this.log(t > limit ? `Too thick for a scab (limit ≈ ${(limit * 1000).toFixed(0)} mm)` : 'Soft material — no scab');
    }
  }

  blast(x, y, W) {
    const g = this.grid;
    const cw = Math.cbrt(W);
    const rmax = 1.6 * cw + 0.3;
    const nR = clamp(Math.round(96 + W * 30), 96, 320);
    const ds = CELL * 0.5;
    const P0 = 6 * cw;
    let debrisLeft = Math.min(this.debrisBudget, 140); const start = debrisLeft;
    for (let r = 0; r < nR; r++) {
      const ang = (r + Math.random() * 0.5) / nR * Math.PI * 2;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let mult = 1;
      for (let d = 0.04; d < rmax; d += ds) {
        const px = x + dx * d, py = y + dy * d;
        if (!this.inGrid(px, py)) break;
        const i = this.cellI(px), j = this.cellJ(py);
        const m = g.get(i, j);
        if (!m) continue;
        const tm = TMATS[m];
        if (tm.fixed) break;
        const p = P0 / Math.max(d, 0.1) * mult * (1 - d / rmax * 0.5);
        if (p >= tm.blast) {
          if (tm.era) { this.triggerERA(i, j); break; }
          g.destroy(i, j);
          if (debrisLeft > 0 && Math.random() < 0.5) {
            debrisLeft--;
            const sp = 6 + Math.min(40, p * 2);
            this.fx.debris(this.cx(i), this.cy(j), dx * sp * (0.5 + Math.random()), dy * sp * (0.5 + Math.random()) + 3, m);
          }
          mult *= Math.max(0, 1 - 0.45 * tm.absorb * tm.blast / p);
          if (mult < 0.05) break;
        } else {
          const share = Math.min(1, (2 * Math.PI * Math.max(d, 0.1)) / (nR * CELL));
          g.damage(i, j, 0.7 * share * p / tm.blast);
          const k = j * g.W + i; if (g.scorch[k] < 200) { g.scorch[k] += 40; g.mark(k); }
          break;
        }
      }
    }
    this.debrisBudget -= start - debrisLeft;
  }

  fireJet(x, y, dx, dy, J, linerD, precursor = false) {
    const g = this.grid, ds = CELL * 0.5;
    const rj = Math.max(CELL * 0.5, linerD * 0.15);
    const chord = CELL / Math.max(Math.abs(dx), Math.abs(dy));
    let inSolid = false, travelled = 0, hitAny = false, lastKey = -1, depth = 0, layerMat = 0, layerLen = 0;
    const closeL = how => { if (layerMat && !precursor) this.log(`${TMATS[layerMat].name}: ${Math.round(layerLen * 1000)} mm — ${how}`); layerMat = 0; layerLen = 0; };
    let px = x, py = y;
    while (J > 0 && travelled < 14) {
      px += dx * ds; py += dy * ds; travelled += ds;
      if (!this.inGrid(px, py)) break;
      const i = this.cellI(px), j = this.cellJ(py);
      const key = j * GRID_W + i;
      if (hitAny && !inSolid) { J -= ds * 0.02; J *= 1 - ds * 0.35; }
      if (key === lastKey) continue;
      lastKey = key;
      const m = g.get(i, j);
      if (m) {
        const tm = TMATS[m];
        if (tm.fixed) break;
        if (tm.era) {
          this.triggerERA(i, j);
          if (precursor) { this.log('Precursor jet sets off the reactive tile — main jet goes through clean'); J = 0; break; }
          J *= 0.3; this.shot.notes.push('Reactive tile disrupted jet'); this.log('Reactive tile shreds the jet (−70%)'); continue;
        }
        if (layerMat !== m) { closeL('through'); layerMat = m; }
        J -= chord * tm.heat; hitAny = true; depth += chord; layerLen += chord;
        this.carve(px, py, m === T.CORE ? rj + CELL * 1.5 : rj, dx, dy, dx * 30, dy * 30, 2);
        if (tm.H >= 3) this.heatRing(px, py, rj + CELL);
        inSolid = true;
        if (J <= 0) closeL('stopped');
      } else if (inSolid) {
        inSolid = false; closeL('through');
        if (J > 0 && !precursor) {
          const n = clamp(Math.round(J * 60), 3, 26);
          for (let k = 0; k < n; k++) {
            const ang = Math.atan2(dy, dx) + (Math.random() + Math.random() - 1) * 0.45;
            const sp = 900 + Math.random() * 900;
            this.addFrag(px, py, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.015 + Math.random() * 0.02, 0.2);
          }
          this.fx.spark(px, py, dx * 500, dy * 500, 20, 0.5, 800);
          this.fx.molten(px, py, dx * 10, dy * 10, 6);
        }
      }
    }
    if (layerMat) closeL('stopped');
    this.fx.jet(x, y, px, py, precursor);
    if (!precursor) this.shot.depth = Math.max(this.shot.depth, depth);
  }

  triggerERA(i, j) {
    const g = this.grid;
    const q = [[i, j]]; let n = 0, sx = 0, sy = 0;
    const seen = new Set();
    while (q.length && n < 30) {
      const [a, b] = q.pop();
      const key = b * g.W + a;
      if (seen.has(key)) continue; seen.add(key);
      if (g.get(a, b) !== T.ERA || Math.abs(a - i) > 6 || Math.abs(b - j) > 6) continue;
      g.destroy(a, b); n++; sx += a; sy += b;
      q.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
    if (n) {
      const x = this.cx(sx / n), y = this.cy(sy / n);
      this.fx.explosion(x, y, 0.45);
      this.blast(x, y, 0.08);
    }
  }

  // detached chunks fall as debris
  collapse() {
    const out = this.grid.detachFloating();
    if (!out.length) return;
    const W = this.grid.W, cnt = out.length / 2;
    const stride = cnt > 400 ? Math.ceil(cnt / 400) : 1;
    for (let k = 0; k < out.length; k += 2 * stride) {
      const idx = out[k], m = out[k + 1];
      const i = idx % W, j = (idx / W) | 0;
      this.fx.debris(this.cx(i), this.cy(j), (Math.random() - 0.5) * 2, Math.random() * 1.5, m, stride > 1 ? 1.6 : 1);
    }
    this.fx.shake(Math.min(0.8, cnt / 800));
    this.log(`${cnt} loose cells collapsed`);
  }
}
