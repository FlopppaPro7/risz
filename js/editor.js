// Workshop: draws the shell cut-away and lets the player edit its Bezier outline.
import { SHELL_MATS } from './data.js';
import { profilePolyline, SLICES, RBINS, bez, ownerColor, ownerName, LAYER_KINDS } from './design.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Sprite of the inner penetrator that carries on after the body strips off.
export function makeCoreSprite(a) {
  const W = 128, dh = 12;
  const c = document.createElement('canvas'); c.width = W; c.height = dh + 2; c.dh = dh;
  const g = c.getContext('2d'), cy = c.height / 2, col = a.coreColor;
  const grad = g.createLinearGradient(0, cy - dh / 2, 0, cy + dh / 2);
  grad.addColorStop(0, shade(col, 1.5)); grad.addColorStop(0.4, shade(col, 1.15)); grad.addColorStop(1, shade(col, 0.6));
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(W, cy); g.lineTo(W - 22, cy - dh / 2); g.lineTo(0, cy - dh / 2); g.lineTo(0, cy + dh / 2); g.lineTo(W - 22, cy + dh / 2); g.closePath(); g.fill();
  return c;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * f, 0, 255) | 0, g = clamp(((n >> 8) & 255) * f, 0, 255) | 0, b = clamp((n & 255) * f, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}

// Side-view sprite used in flight. Tip on the right.
export function makeShellSprite(d, a) {
  const W = 256;
  const dh = Math.max(6, W * a.D / a.L);
  const span = a.span / a.D;
  const H = Math.ceil(dh * (1 + 2 * span) + 4);
  const c = document.createElement('canvas');
  c.width = W; c.height = H; c.dh = dh;
  const g = c.getContext('2d');
  const cy = H / 2;
  const r = a.r, N = r.length;
  const jc = SHELL_MATS[d.jacket].color;
  // fins
  if (d.finSize) {
    const ch = a.chord / a.L * W, s = span * dh;
    g.fillStyle = shade('#9aa6b2', 0.8);
    g.beginPath(); g.moveTo(0, cy); g.lineTo(0, cy - dh / 2 - s); g.lineTo(ch * 0.45, cy - dh / 2 - s); g.lineTo(ch, cy); g.lineTo(ch * 0.45, cy + dh / 2 + s); g.lineTo(0, cy + dh / 2 + s); g.fill();
  }
  const grad = g.createLinearGradient(0, cy - dh / 2, 0, cy + dh / 2);
  grad.addColorStop(0, shade(jc, 1.35)); grad.addColorStop(0.35, shade(jc, 1.1)); grad.addColorStop(1, shade(jc, 0.55));
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(W, cy);
  for (let i = 0; i < N; i++) g.lineTo(W - (i + 0.5) / N * W, cy - r[i] / (a.rmax || 1) * dh / 2);
  g.lineTo(0, cy - r[N - 1] / (a.rmax || 1) * dh / 2); g.lineTo(0, cy + r[N - 1] / (a.rmax || 1) * dh / 2);
  for (let i = N - 1; i >= 0; i--) g.lineTo(W - (i + 0.5) / N * W, cy + r[i] / (a.rmax || 1) * dh / 2);
  g.closePath(); g.fill();
  if (d.launcher === 'cannon' && !d.finSize) { g.fillStyle = '#c47a3c'; g.fillRect(W * 0.18, cy - dh / 2, Math.max(2, W * 0.035), dh); }
  return c;
}

export class ShellEditor {
  constructor(canvas, onChange) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.onChange = onChange;
    this.sel = 1; this.drag = null; this.smooth = true;
    this.hatch = null;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', () => { if (this.drag) { this.drag = null; this.onChange(true); } });
    canvas.style.touchAction = 'none';
  }

  set(d, a) { this.d = d; this.a = a; this.sel = clamp(this.sel, 0, d.profile.length - 1); this.draw(); }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * this.dpr); this.c.height = Math.round(r.height * this.dpr);
    this.draw();
  }

  layout() {
    const d = this.d, w = this.w, h = this.h;
    const padL = 34, padR = 30;
    const lenPx = Math.max(60, w - padL - padR);
    const trueRad = lenPx * (d.caliber / 2) / d.length;
    const maxRad = h * 0.3;
    const radPx = clamp(trueRad, Math.min(46, maxRad), maxRad);
    this.L = { tipX: padL + lenPx, lenPx, axisY: h * 0.56, radPx, exag: radPx / trueRad };
    return this.L;
  }
  X(xf) { return this.L.tipX - xf * this.L.lenPx; }
  Y(yn, side = -1) { return this.L.axisY + side * yn * this.L.radPx; }

  draw() {
    if (!this.d || !this.w) return;
    const ctx = this.ctx, d = this.d, a = this.a, w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = this.layout();
    // grid
    ctx.strokeStyle = 'rgba(140,170,200,0.07)'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    // axis
    ctx.strokeStyle = 'rgba(160,190,220,0.25)'; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(10, L.axisY); ctx.lineTo(w - 10, L.axisY); ctx.stroke();
    // bore / max caliber guides
    ctx.strokeStyle = 'rgba(127,224,255,0.25)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(this.X(1), this.Y(1, s)); ctx.lineTo(this.X(0), this.Y(1, s)); ctx.stroke(); }
    if (d.launcher === 'cannon' && a.bore > a.D * 1.05) {
      const bs = a.bore / d.caliber;
      ctx.strokeStyle = 'rgba(255,190,90,0.35)';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(this.X(1), this.Y(Math.min(bs, (h * 0.5) / L.radPx), s)); ctx.lineTo(this.X(0.55), this.Y(Math.min(bs, (h * 0.5) / L.radPx), s)); ctx.stroke(); }
    }
    ctx.setLineDash([]);
    const r = a.r, N = SLICES, dxPx = L.lenPx / N;
    // fins
    if (d.finSize) {
      const ch = a.chord / d.length, sp = (a.span / (d.caliber / 2)) + a.rmax;
      ctx.fillStyle = 'rgba(150,165,180,0.55)'; ctx.strokeStyle = 'rgba(200,215,230,0.8)';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(this.X(1), this.Y(a.rmax, s)); ctx.lineTo(this.X(1), this.Y(sp, s)); ctx.lineTo(this.X(1 - ch * 0.45), this.Y(sp, s)); ctx.lineTo(this.X(1 - ch), this.Y(a.rmax * 0.98, s)); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    // lower half: exterior metal
    const jc = SHELL_MATS[d.jacket].color;
    const grad = ctx.createLinearGradient(0, L.axisY, 0, L.axisY + L.radPx);
    grad.addColorStop(0, shade(jc, 1.25)); grad.addColorStop(0.5, shade(jc, 0.95)); grad.addColorStop(1, shade(jc, 0.5));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(this.X(0), L.axisY);
    for (let i = 0; i < N; i++) ctx.lineTo(this.X((i + 0.5) / N), this.Y(r[i], 1));
    ctx.lineTo(this.X(1), this.Y(r[N - 1], 1)); ctx.lineTo(this.X(1), L.axisY); ctx.closePath(); ctx.fill();
    if (d.launcher === 'cannon' && !d.finSize) {
      // driving band
      const xb = 0.82; const i = Math.min(N - 1, Math.floor(xb * N));
      ctx.fillStyle = '#c47a3c'; ctx.fillRect(this.X(xb), L.axisY, Math.max(3, L.lenPx * 0.04), r[i] * L.radPx + 1);
    }
    // upper half: cut-away composition from the layer grid
    const RB = RBINS, bins = a.bins;
    for (let i = 0; i < N; i++) {
      const R = r[i];
      if (R <= 0) continue;
      const x = this.X((i + 0.5) / N) - dxPx / 2;
      let k = 0;
      while (k < RB) {
        const o = bins[i * RB + k]; let e = k + 1;
        while (e < RB && bins[i * RB + e] === o) e++;
        ctx.fillStyle = ownerColor(d, o);
        const y1 = this.Y(e / RB * R), y0 = this.Y(k / RB * R);
        ctx.fillRect(x, y1, dxPx + 0.6, y0 - y1 + 0.5);
        k = e;
      }
    }
    // shaped-charge liners (copper cones pointing forward)
    for (const j of a.jets) {
      const xs = j.standoff - 0.2 * a.D, rr = j.linerD / 2;
      ctx.strokeStyle = '#e08a40'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(this.X((xs + Math.min(j.fillLenM * 0.5, rr * 1.4)) / d.length), this.Y(rr / (d.caliber / 2))); ctx.lineTo(this.X(xs / d.length), L.axisY); ctx.stroke();
    }
    // highlight selected layer
    if (this.layerSel != null && d.layers[this.layerSel]) {
      const l = d.layers[this.layerSel];
      ctx.strokeStyle = '#ffffff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      const ymax = Math.max(...Array.from(r.slice(Math.floor(l.x0 * N), Math.ceil(l.x1 * N) + 1))) || a.rmax;
      ctx.strokeRect(this.X(l.x1), this.Y(l.ro * ymax), this.X(l.x0) - this.X(l.x1), this.Y(l.ri * ymax) - this.Y(l.ro * ymax));
      ctx.setLineDash([]);
    }
    // hatch overlay on the cut
    ctx.save();
    ctx.beginPath(); ctx.moveTo(this.X(0), L.axisY);
    for (let i = 0; i < N; i++) ctx.lineTo(this.X((i + 0.5) / N), this.Y(r[i]));
    ctx.lineTo(this.X(1), this.Y(r[N - 1])); ctx.lineTo(this.X(1), L.axisY); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    for (let k = -h; k < w; k += 7) { ctx.beginPath(); ctx.moveTo(k, L.axisY); ctx.lineTo(k + L.radPx, L.axisY - L.radPx); ctx.stroke(); }
    ctx.restore();
    // outline
    ctx.strokeStyle = 'rgba(230,240,250,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(this.X(1), this.Y(r[N - 1], 1));
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(this.X((i + 0.5) / N), this.Y(r[i], 1));
    ctx.lineTo(this.X(0), L.axisY);
    for (let i = 0; i < N; i++) ctx.lineTo(this.X((i + 0.5) / N), this.Y(r[i]));
    ctx.lineTo(this.X(1), this.Y(r[N - 1])); ctx.closePath(); ctx.stroke();
    // CG / CP markers
    const cgx = this.X(a.cgX / d.length), cpx = this.X(clamp(a.cpX / d.length, 0, 1.1));
    ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(cgx, L.axisY, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText('G', cgx, L.axisY + 3);
    if (a.stabMode === 'fins') {
      ctx.strokeStyle = '#59d0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cpx, L.axisY, 6, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cpx - 6, L.axisY); ctx.lineTo(cpx + 6, L.axisY); ctx.moveTo(cpx, L.axisY - 6); ctx.lineTo(cpx, L.axisY + 6); ctx.stroke();
    }
    // Bezier handles
    this.drawHandles(ctx);
    // callouts
    this.drawCallouts(ctx);
    // scale bar & info
    ctx.fillStyle = 'rgba(200,220,240,0.6)'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    const exagTxt = L.exag > 1.05 ? `  ·  radial ×${L.exag.toFixed(1)}` : '';
    ctx.fillText(`${(d.length * 1000).toFixed(0)} mm long  ·  Ø ${(a.D * 1000).toFixed(0)} mm${exagTxt}`, 12, h - 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd34d'; ctx.fillText('● G = centre of mass', w - 12, h - 26);
    if (a.stabMode === 'fins') { ctx.fillStyle = '#59d0ff'; ctx.fillText('⊕ P = centre of pressure', w - 12, h - 12); }
  }

  drawHandles(ctx) {
    const p = this.d.profile;
    ctx.lineWidth = 1;
    for (let k = 0; k < p.length; k++) {
      const q = p[k], on = k === this.sel;
      const ax = this.X(q.x), ay = this.Y(q.y);
      if (on || this.showAll) {
        ctx.strokeStyle = 'rgba(127,224,255,0.6)';
        if (k > 0) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(this.X(q.ix), this.Y(q.iy)); ctx.stroke(); this.sq(ctx, this.X(q.ix), this.Y(q.iy)); }
        if (k < p.length - 1) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(this.X(q.ox), this.Y(q.oy)); ctx.stroke(); this.sq(ctx, this.X(q.ox), this.Y(q.oy)); }
      }
      ctx.fillStyle = on ? '#7fe0ff' : '#0e1620'; ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ax, ay, on ? 8 : 6, 0, 7); ctx.fill(); ctx.stroke();
    }
    // neighbours' handles faintly
    for (const k of [this.sel - 1, this.sel + 1]) {
      const q = p[k]; if (!q) continue;
      ctx.strokeStyle = 'rgba(127,224,255,0.25)';
      if (k === this.sel - 1 && k < p.length - 1) { ctx.beginPath(); ctx.moveTo(this.X(q.x), this.Y(q.y)); ctx.lineTo(this.X(q.ox), this.Y(q.oy)); ctx.stroke(); this.sq(ctx, this.X(q.ox), this.Y(q.oy), 0.5); }
      if (k === this.sel + 1 && k > 0) { ctx.beginPath(); ctx.moveTo(this.X(q.x), this.Y(q.y)); ctx.lineTo(this.X(q.ix), this.Y(q.iy)); ctx.stroke(); this.sq(ctx, this.X(q.ix), this.Y(q.iy), 0.5); }
    }
  }
  sq(ctx, x, y, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = '#ffb347'; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.globalAlpha = 1; }

  drawCallouts(ctx) {
    const d = this.d, a = this.a, L = this.L;
    const items = [];
    // centroid of each composition owner in the upper half
    const acc = new Map();
    for (let i = 0; i < SLICES; i++) {
      const R = a.r[i]; if (R <= 0) continue;
      for (let k = 0; k < RBINS; k++) {
        const o = a.bins[i * RBINS + k];
        let s = acc.get(o); if (!s) { s = [0, 0, 0]; acc.set(o, s); }
        s[0] += (i + 0.5) / SLICES; s[1] += (k + 0.5) / RBINS * R; s[2]++;
      }
    }
    const pos = o => { const s = acc.get(o); return s && s[2] ? [s[0] / s[2], s[1] / s[2]] : null; };
    const p0 = pos(-1);
    if (p0) items.push({ p: p0, title: ownerName(d, -1).toUpperCase(), sub: `Body · ${a.mass.jacket.toFixed(2)} kg`, col: ownerColor(d, -1) });
    d.layers.forEach((l, li) => {
      const p = pos(li); if (!p) return;
      const m = a.lstat[li].mass;
      items.push({ p, title: ownerName(d, li).toUpperCase(), sub: `${LAYER_KINDS[l.kind]}${m > 0 ? ' · ' + m.toFixed(2) + ' kg' : ''}`, col: ownerColor(d, li) });
    });
    const n = Math.min(items.length, Math.max(2, Math.floor((this.w - 10) / 110)));
    items.length = n;
    if (!n) return;
    const boxW = Math.min(150, (this.w - 20) / n - 8), boxH = 34;
    items.sort((u, v) => v.p[0] - u.p[0]);
    ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    items.forEach((it, k) => {
      const bx = 10 + k * (boxW + 8), by = 10;
      const tx = this.X(it.p[0]), ty = this.Y(it.p[1]);
      ctx.strokeStyle = 'rgba(220,235,250,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx + 14, by + boxH); ctx.lineTo(bx + 14, by + boxH + 8); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeRect(tx - 3, ty - 3, 6, 6);
      ctx.fillStyle = 'rgba(14,20,28,0.88)'; ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = 'rgba(200,220,240,0.45)'; ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH);
      ctx.fillStyle = it.col; ctx.fillRect(bx, by, 3, boxH);
      ctx.fillStyle = '#7fe0ff'; ctx.fillText('0' + (k + 1), bx + 6, by + 14);
      ctx.fillStyle = '#e8f0f8'; ctx.font = 'bold 10px system-ui'; ctx.fillText(it.title.slice(0, 18), bx + 24, by + 14);
      ctx.font = '9px system-ui'; ctx.fillStyle = 'rgba(200,215,230,0.75)'; ctx.fillText(it.sub, bx + 6, by + 27);
      ctx.font = '10px system-ui';
    });
  }

  // ----- interaction -----
  pos(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  inv(px, py) { return [(this.L.tipX - px) / this.L.lenPx, (this.L.axisY - py) / this.L.radPx]; }

  down(e) {
    if (!this.d) return;
    const [px, py] = this.pos(e);
    const p = this.d.profile;
    const hits = [];
    const test = (k, part, x, y) => { const dd = Math.hypot(this.X(x) - px, this.Y(y) - py); if (dd < 24) hits.push({ k, part, dd: dd - (k === this.sel ? 6 : 0) - (part !== 'a' ? 3 : 0) }); };
    for (let k = 0; k < p.length; k++) {
      test(k, 'a', p[k].x, p[k].y);
      const near = Math.abs(k - this.sel) <= 1;
      if (near && k > 0) test(k, 'i', p[k].ix, p[k].iy);
      if (near && k < p.length - 1) test(k, 'o', p[k].ox, p[k].oy);
    }
    if (!hits.length) return;
    hits.sort((u, v) => u.dd - v.dd);
    const h = hits[0];
    this.drag = h; if (h.part === 'a') this.sel = h.k;
    this.c.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    this.draw();
  }

  move(e) {
    if (!this.drag) return;
    const [px, py] = this.pos(e);
    let [x, y] = this.inv(px, py);
    const p = this.d.profile, k = this.drag.k, q = p[k];
    y = clamp(y, 0, 1);
    if (this.drag.part === 'a') {
      if (k === 0) return; // tip fixed
      if (k === p.length - 1) x = 1;
      else x = clamp(x, p[k - 1].x + 0.01, p[k + 1].x - 0.01);
      const dx = x - q.x, dy = y - q.y;
      q.x = x; q.y = y; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy;
    } else {
      x = clamp(x, -0.05, 1.05);
      if (this.drag.part === 'i') { q.ix = x; q.iy = y; } else { q.ox = x; q.oy = y; }
      if (this.smooth && k > 0 && k < p.length - 1) {
        const [hx, hy, ox, oy] = this.drag.part === 'i' ? [q.ix, q.iy, 'ox', 'oy'] : [q.ox, q.oy, 'ix', 'iy'];
        const vx = q.x - hx, vy = q.y - hy, l = Math.hypot(vx, vy) || 1;
        const ol = Math.hypot(q[ox] - q.x, q[oy] - q.y);
        q[ox] = q.x + vx / l * ol; q[oy] = clamp(q.y + vy / l * ol, 0, 1);
      }
    }
    this.onChange(false);
  }

  addPoint() {
    const p = this.d.profile;
    let s = Math.max(0, Math.min(this.sel, p.length - 2));
    if (this.sel === p.length - 1) s = p.length - 2;
    const a = p[s], b = p[s + 1], t = 0.5;
    // de Casteljau split keeps the curve shape
    const L = (u, v) => u + (v - u) * t;
    const p01x = L(a.x, a.ox), p01y = L(a.y, a.oy), p12x = L(a.ox, b.ix), p12y = L(a.oy, b.iy), p23x = L(b.ix, b.x), p23y = L(b.iy, b.y);
    const p012x = L(p01x, p12x), p012y = L(p01y, p12y), p123x = L(p12x, p23x), p123y = L(p12y, p23y);
    const mx = bez(a.x, a.ox, b.ix, b.x, t), my = bez(a.y, a.oy, b.iy, b.y, t);
    a.ox = p01x; a.oy = p01y; b.ix = p23x; b.iy = p23y;
    p.splice(s + 1, 0, { x: mx, y: clamp(my, 0, 1), ix: p012x, iy: clamp(p012y, 0, 1), ox: p123x, oy: clamp(p123y, 0, 1) });
    this.sel = s + 1;
    this.onChange(true);
  }

  deletePoint() {
    const p = this.d.profile;
    if (this.sel <= 0 || this.sel >= p.length - 1) return false;
    p.splice(this.sel, 1); this.sel = Math.max(1, this.sel - 1);
    this.onChange(true); return true;
  }
}

export { profilePolyline };
