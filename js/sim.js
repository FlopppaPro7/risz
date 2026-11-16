// World simulation: flight, terminal ballistics, blast and fragments. DOM-free.
import { CELL, G_ROWS, GRID_W, GRID_H, T, TMATS, GRAVITY, AIR_RHO, MUZZLE_H } from './data.js';
import { Grid } from './grid.js';
import { keStep, airDecel, clamp } from './physics.js';
import { penetratorFor } from './design.js';

const NOOP_FX = new Proxy({}, { get: () => () => {} });
const DEG = Math.PI / 180;

export class World {
  constructor({ build, dist, fx }) {
    this.grid = new Grid(build);
    this.dist = dist;
    this.x0 = dist;
    this.fx = fx || NOOP_FX;
    this.proj = null;
    this.frags = [];
    this.time = 0;
    this.log = [];
    this.collapsePending = false;
    this.debrisBudget = 300;
  }

  get gridW() { return GRID_W * CELL; }
  get gridTop() { return G_ROWS * CELL; }
  cellI(x) { return Math.floor((x - this.x0) / CELL); }
  cellJ(y) { return G_ROWS - 1 - Math.floor(y / CELL); }
  cx(i) { return this.x0 + (i + 0.5) * CELL; }
  cy(j) { return (G_ROWS - 1 - j + 0.5) * CELL; }
  matAt(x, y) { return this.grid.get(this.cellI(x), this.cellJ(y)); }
  inGrid(x, y) { return x >= this.x0 && x < this.x0 + this.gridW && y < this.gridTop && y > -GRID_H * CELL; }

  busy() { return !!this.proj || this.frags.length > 0; }

  // ---------- launching ----------
  fire(design, a, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const v0 = a.muzzleV;
    this.proj = {
      d: design, a, x: c * 2.2, y: MUZZLE_H + s * 2.2, vx: c * v0, vy: s * v0,
      state: 'flight', t: 0, mass: a.flightMass, burn: a.rocket ? a.burnTime : 0,
      yaw: 0.002 + (1 - a.stab) * 0.05, yawPhase: Math.random() * 6, noise: Math.random() * 2 - 1, noise2: Math.random() * 2 - 1,
      ricochets: 0, contact: -1, inSolid: false, lastMat: 0, depth: 0, impactV: 0, maxY: 0,
    };
    this.shot = { result: 'flying', impactV: 0, depth: 0, notes: [] };
    this.debrisBudget = 320;
    this.fx.muzzle(c * 2.2, MUZZLE_H + s * 2.2, angle, a.rocket, a.D);
  }

  // Deterministic, ideal-flight trajectory (no yaw noise) for aiming.
  static trajectory(a, angle, xTarget, maxT = 60, pts = null) {
    let x = Math.cos(angle) * 2.2, y = MUZZLE_H + Math.sin(angle) * 2.2;
    let vx = Math.cos(angle) * a.muzzleV, vy = Math.sin(angle) * a.muzzleV;
    let m = a.flightMass, burn = a.rocket ? a.burnTime : 0, t = 0;
    const mdot = a.rocket ? a.mass.prop / a.burnTime : 0;
    const yaw = 0.004 + (1 - a.stab) * 0.05;
    let px = x, py = y;
    while (t < maxT) {
      const v = Math.hypot(vx, vy) || 1e-6;
      const h = burn > 0 ? 1 / 240 : clamp(3 / v, 1 / 480, 1 / 60);
      let ax = 0, ay = -GRAVITY;
      if (burn > 0) { const f = a.thrust / m; ax += f * vx / v; ay += f * vy / v; m -= mdot * h; burn -= h; }
      const fd = airDecel(a, v, burn > 0, yaw) / m;
      ax -= fd * vx / v; ay -= fd * vy / v;
      vx += ax * h; vy += ay * h; px = x; py = y; x += vx * h; y += vy * h; t += h;
      if (pts && pts.length < 4000) pts.push(x, y);
      if (x >= xTarget) {
        const f = (xTarget - px) / (x - px);
        return { y: py + (y - py) * f, v: Math.hypot(vx, vy), t, hit: true };
      }
      if (y < -1 || (vx <= 0.5 && burn <= 0)) return { y: -1e9, v: 0, t, hit: false, x };
    }
    return { y: -1e9, v: 0, t, hit: false, x };
  }

  static solveAngle(a, xT, yT) {
    const f = ang => World.trajectory(a, ang, xT).y - yT;
    let lo = -4 * DEG, hi = 45 * DEG;
    const fhi = f(hi);
    if (fhi < 0) return { angle: hi, ok: false };
    if (f(lo) > 0) return { angle: lo, ok: true };
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
    const ang = (lo + hi) / 2;
    const tr = World.trajectory(a, ang, xT);
    return { angle: ang, ok: true, v: tr.v, t: tr.t };
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
      // yaw dynamics
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
        this.shot.result = 'Missed — hit the ground';
        if (a.fillerTNT > 0) this.detonate(p.x, 0.05, a.fillerTNT, a.jacketMass);
        else this.fx.dust(p.x, 0, 1);
        this.endProj(); return;
      }
      if (p.x > this.x0 + this.gridW + 2 || p.t > 60 || (p.vx < 0 && p.burn <= 0)) {
        this.shot.result = 'Missed — flew past';
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
    if (!this.shot.impactV) { this.shot.impactV = v; this.shot.angle = theta / DEG; }
    const yawNow = p.yaw * Math.abs(Math.sin(p.yawPhase));
    // back off to just outside the surface
    const bx = p.x - dx * CELL * 0.6, by = p.y - dy * CELL * 0.6;
    if (a.type === 'HE') {
      this.shot.result = 'Detonated on contact';
      this.detonate(bx, by, a.fillerTNT, a.jacketMass);
      this.endProj(); return;
    }
    if (a.type === 'HEAT') {
      this.shot.result = 'Shaped charge fired';
      this.fireJet(p.x - dx * CELL * 0.3, p.y - dy * CELL * 0.3, dx, dy, a.jetPen * Math.pow(Math.cos(Math.min(yawNow, 1.4)), 4), a.linerD);
      this.detonate(bx, by, a.fillerTNT * 0.5, a.jacketMass, true);
      this.endProj(); return;
    }
    if (tm.fixed) { this.shot.result = 'Hit the ground'; this.fx.dust(p.x, p.y, 1); if (a.type === 'APHE') this.detonate(bx, by, a.fillerTNT, a.jacketMass); this.endProj(); return; }
    // ricochet test
    let thetaC = (64 + (1 - a.nf) * 16 + (a.LD > 8 ? 8 : 0) + (v > 1300 ? 4 : 0)) * DEG;
    if (tm.H < 3) thetaC = 89 * DEG;
    if (theta > thetaC && p.ricochets < 3) {
      const dot = dx * nx + dy * ny;
      let rx = dx - 2 * dot * nx, ry = dy - 2 * dot * ny;
      const sp = v * 0.55;
      p.vx = rx * sp; p.vy = ry * sp; p.x = bx; p.y = by; p.ricochets++;
      p.yaw = Math.min(1.5, p.yaw + 0.5);
      this.grid.damage(i, j, 0.6);
      this.fx.spark(p.x, p.y, rx * 200, ry * 200, 40, 0.6, 400);
      this.fx.shake(0.3);
      this.shot.notes.push('Ricochet!');
      this.shot.result = 'Ricochet';
      return;
    }
    const pen = penetratorFor(a, tm.H);
    pen.v = v; pen.yaw = yawNow;
    const stripped = pen.m < a.whole.m * 0.98;
    if (stripped) { this.carve(p.x, p.y, a.D / 2, dx, dy, -dx * 20, -dy * 20, 30, 0); this.fx.spark(bx, by, -dx * 150, -dy * 150, 25, 1.2, 250); this.shot.notes.push('Jacket stripped'); }
    // normalisation toward surface normal
    const turn = Math.min(theta, (5 + 8 * (1 - a.nf)) * DEG);
    const ang = Math.atan2(dy, dx), tgt = Math.atan2(-ny, -nx);
    let diff = tgt - ang; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    const na = ang + clamp(diff, -turn, turn);
    p.dx = Math.cos(na); p.dy = Math.sin(na);
    p.pen = pen; p.state = 'pen'; p.contact = 0; p.depth = 0; p.cellKey = -1;
    this.fx.spark(bx, by, -p.dx * 300, -p.dy * 300, 30, 1.0, 500);
    this.fx.flash(bx, by, 0.6 + a.D * 4);
    this.fx.shake(0.25 + Math.min(1, pen.m * v * v / 2 / 2e7));
    this.shot.result = 'Penetrating';
  }

  stepPen(h) {
    const p = this.proj, a = p.a, pen = p.pen;
    const ds = Math.min(pen.v * h, CELL * 0.45);
    p.x += p.dx * ds; p.y += p.dy * ds;
    p.vx = p.dx * pen.v; p.vy = p.dy * pen.v;
    if (p.contact >= 0) p.contact += ds;
    if (!this.inGrid(p.x, p.y)) { this.shot.result = p.depth > 0 ? 'Passed through' : this.shot.result; this.endProj(); return; }
    const i = this.cellI(p.x), j = this.cellJ(p.y);
    const key = j * GRID_W + i;
    if (key === p.cellKey) return; // still inside a cell already paid for
    p.cellKey = key;
    const m = this.grid.get(i, j);
    if (m) {
      const tm = TMATS[m];
      if (tm.fixed) { this.stopPen('Stopped by bedrock'); return; }
      if (tm.era) {
        this.triggerERA(i, j);
        pen.len *= 0.72; pen.m *= 0.72; pen.yaw = Math.min(1.2, pen.yaw + 0.18);
        const na = Math.atan2(p.dy, p.dx) + (Math.random() < 0.5 ? -1 : 1) * 4 * DEG;
        p.dx = Math.cos(na); p.dy = Math.sin(na);
        this.shot.notes.push('Reactive tile hit');
        return;
      }
      const chord = CELL / Math.max(Math.abs(p.dx), Math.abs(p.dy));
      const alive = keStep(pen, tm, chord);
      p.depth += chord;
      const sy = Math.abs(Math.sin(pen.yaw));
      let rad = Math.max(pen.d / 2, pen.d * pen.len * sy / 2);
      if (m === T.CORE) rad = rad * 1.4 + CELL * clamp(0.5 * pen.m * pen.v * pen.v / 2.5e5, 0, 1.5); // innards shatter
      this.carve(p.x, p.y, rad, p.dx, p.dy, p.dx * Math.min(pen.v, 300) * 0.1, p.dy * Math.min(pen.v, 300) * 0.1, 3);
      if (Math.random() < 0.35) this.fx.spark(p.x - p.dx * CELL, p.y - p.dy * CELL, -p.dx * 120, -p.dy * 120, 3, 1.4, 260);
      p.inSolid = true; p.lastMat = m;
      if (!alive) { this.stopPen('Stopped inside armour'); return; }
    } else if (p.inSolid) {
      p.inSolid = false;
      this.spall(p.x, p.y, p.dx, p.dy, pen, p.lastMat);
    }
    if (a.type === 'APHE' && p.contact >= a.fuse) {
      this.shot.result = 'AP-HE burst inside';
      this.detonate(p.x, p.y, a.fillerTNT, a.jacketMass * 0.5);
      this.endProj();
    }
  }

  stopPen(msg) {
    const p = this.proj, a = p.a;
    if (a.type === 'APHE') {
      this.shot.result = 'AP-HE burst (stopped)';
      this.detonate(p.x - p.dx * CELL, p.y - p.dy * CELL, a.fillerTNT, a.jacketMass * 0.5);
    } else {
      this.shot.result = msg;
      this.embedded = { x: p.x, y: p.y, ang: Math.atan2(p.dy, p.dx), a };
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
      // offsets in world orientation (y up)
      const ox = c, oy = -b;
      const along = ox * dx + oy * dy;
      const lat = Math.abs(ox * dy - oy * dx);
      if (!(b === 0 && c === 0) && (along > ahead || along < -1.2 || lat > rc + 0.2)) continue;
      const m = g.destroy(ci + c, cj + b);
      if (m) {
        n++;
        if (n <= debrisN && this.debrisBudget > 0) { this.debrisBudget--; this.fx.debris(this.cx(ci + c), this.cy(cj + b), vx + (Math.random() - 0.5) * 18, vy + Math.random() * 12, m); }
      }
    }
    return n;
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
    if (pen.pyro) this.fx.flash(x, y, 1.2);
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
              g.destroy(i, j);
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

  fireJet(x, y, dx, dy, J, linerD) {
    const g = this.grid, ds = CELL * 0.5;
    const rj = Math.max(CELL * 0.5, linerD * 0.15);
    const chord = CELL / Math.max(Math.abs(dx), Math.abs(dy));
    let inSolid = false, travelled = 0, hitAny = false, lastKey = -1, depth = 0;
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
        if (tm.era) { this.triggerERA(i, j); J *= 0.3; this.shot.notes.push('Reactive tile disrupted jet'); continue; }
        J -= chord * tm.heat; hitAny = true; depth += chord;
        this.carve(px, py, m === T.CORE ? rj + CELL * 1.5 : rj, dx, dy, dx * 30, dy * 30, 2);
        inSolid = true;
      } else if (inSolid) {
        inSolid = false;
        if (J > 0) {
          const n = clamp(Math.round(J * 60), 3, 26);
          for (let k = 0; k < n; k++) {
            const ang = Math.atan2(dy, dx) + (Math.random() + Math.random() - 1) * 0.45;
            const sp = 900 + Math.random() * 900;
            this.addFrag(px, py, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.015 + Math.random() * 0.02, 0.2);
          }
          this.fx.spark(px, py, dx * 500, dy * 500, 20, 0.5, 800);
        }
      }
    }
    this.fx.jet(x, y, px, py);
    this.shot.depth = Math.max(this.shot.depth, depth);
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
  }
}
