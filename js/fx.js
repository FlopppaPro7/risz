// Pooled particle effects. Fixed-size typed arrays, ring-buffer reuse, batched drawing.
import { TMATS } from './data.js';

const DEBRIS = 0, SPARK = 1, FIRE = 2, SMOKE = 3, FLASH = 4, PUFF = 5, MOLTEN = 6;

function makeSprite(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

export class FX {
  constructor(max = 1400) {
    this.setMax(max);
    this.jets = [];
    this.shakeAmt = 0;
    this.lite = false;
    this.maxR = 400;
    this.matColors = TMATS.map(m => (m && m.color ? `rgb(${m.color[0]},${m.color[1]},${m.color[2]})` : '#000'));
    this.matColors[40] = '#b58a3a'; // brass casing
    this.customStart = 41;
    this.sprites = {
      fire: [
        makeSprite(64, [[0, 'rgba(255,255,230,1)'], [0.25, 'rgba(255,220,120,0.95)'], [0.6, 'rgba(255,120,30,0.55)'], [1, 'rgba(255,60,0,0)']]),
        makeSprite(64, [[0, 'rgba(255,190,90,0.9)'], [0.5, 'rgba(230,80,20,0.5)'], [1, 'rgba(120,20,0,0)']]),
      ],
      smoke: makeSprite(64, [[0, 'rgba(70,66,62,0.75)'], [0.6, 'rgba(60,56,54,0.35)'], [1, 'rgba(50,50,50,0)']]),
      flash: makeSprite(128, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,240,200,0.9)'], [0.5, 'rgba(255,170,80,0.25)'], [1, 'rgba(255,120,40,0)']]),
      puff: makeSprite(32, [[0, 'rgba(225,225,225,0.5)'], [1, 'rgba(200,200,200,0)']]),
    };
  }

  setMax(max) {
    this.max = max;
    const F = n => new Float32Array(n);
    this.x = F(max); this.y = F(max); this.vx = F(max); this.vy = F(max);
    this.life = F(max); this.maxLife = F(max); this.size = F(max); this.grow = F(max);
    this.type = new Uint8Array(max); this.col = new Uint8Array(max); this.alive = new Uint8Array(max);
    this.head = 0; this.count = 0;
  }

  spawn(type, x, y, vx, vy, life, size, col = 0, grow = 0) {
    // find a free slot from the ring head; overwrite oldest when full
    let k = this.head;
    for (let n = 0; n < 8; n++) { const kk = (this.head + n) % this.max; if (!this.alive[kk]) { k = kk; break; } }
    this.head = (k + 1) % this.max;
    if (!this.alive[k]) this.count++;
    this.alive[k] = 1; this.type[k] = type; this.x[k] = x; this.y[k] = y; this.vx[k] = vx; this.vy[k] = vy;
    this.life[k] = life; this.maxLife[k] = life; this.size[k] = size; this.col[k] = col; this.grow[k] = grow;
  }

  clear() { this.alive.fill(0); this.count = 0; this.jets.length = 0; this.shakeAmt = 0; }

  colorIndex(css) {
    let i = this.matColors.indexOf(css, this.customStart);
    if (i < 0) { i = Math.max(this.customStart, this.matColors.length); if (i > 250) i = this.customStart; this.matColors[i] = css; }
    return i;
  }
  // glowing droplets of molten metal
  molten(x, y, vx, vy, n) {
    n = this.lite ? Math.ceil(n / 2) : n;
    for (let i = 0; i < n; i++) this.spawn(MOLTEN, x, y, vx + (Math.random() - 0.5) * 8, vy + Math.random() * 6, 1.2 + Math.random() * 1.6, 0.02 + Math.random() * 0.025);
  }
  // shreds of a shell's outer body peeling back off the armour face
  peel(x, y, dx, dy, css, n) {
    const ci = this.colorIndex(css), base = Math.atan2(-dy, -dx);
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * 2.4, s = 4 + Math.random() * 22;
      this.spawn(DEBRIS, x, y, Math.cos(a) * s, Math.sin(a) * s + 3, 2 + Math.random() * 2, 0.025 + Math.random() * 0.03, ci);
    }
  }
  casing(x, y, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    this.spawn(DEBRIS, x - c * 0.8, y - s * 0.8, -c * 4 - 1, 4 + Math.random() * 2, 4, 0.12, 40);
  }

  // ----- interface used by the simulation -----
  muzzle(x, y, ang, rocket, D) {
    const c = Math.cos(ang), s = Math.sin(ang);
    if (rocket) {
      for (let i = 0; i < 14; i++) this.spawn(SMOKE, x - c * 2, y - s * 2, -c * (6 + Math.random() * 10) + (Math.random() - 0.5) * 4, (Math.random() - 0.3) * 3, 1.5 + Math.random(), 0.6, 0, 1.2);
      this.spawn(FLASH, x - c * 1.5, y - s * 1.5, 0, 0, 0.12, 2.5);
    } else {
      const big = 1 + D * 8;
      this.spawn(FLASH, x + c * 0.6, y + s * 0.6, 0, 0, 0.09, 3.5 * big);
      for (let i = 0; i < 10; i++) this.spawn(FIRE, x + c * 0.4, y + s * 0.4, c * (20 + Math.random() * 40), s * 20 + (Math.random() - 0.5) * 12, 0.15 + Math.random() * 0.1, 0.5 * big, 0, 3);
      for (let i = 0; i < 16; i++) this.spawn(SMOKE, x + c, y + s, c * (5 + Math.random() * 14) + (Math.random() - 0.5) * 6, (Math.random() - 0.2) * 5, 1.6 + Math.random() * 1.4, 0.6 * big, 0, 1.4);
      this.shake(0.6);
    }
  }
  trail(x, y, vx, vy, rocket) {
    if (rocket) {
      const v = Math.hypot(vx, vy) || 1;
      this.spawn(FIRE, x - vx / v * 0.6, y - vy / v * 0.6, -vx * 0.05, -vy * 0.05, 0.08, 0.35, 0, 2);
      this.spawn(PUFF, x - vx / v * 0.8, y - vy / v * 0.8, (Math.random() - 0.5), (Math.random() - 0.5) + 0.5, 1.6, 0.4, 0, 1.5);
    } else this.spawn(PUFF, x, y, 0, 0.2, 0.5, 0.15, 0, 0.6);
  }
  spark(x, y, vx, vy, n, spread, speed) {
    const base = Math.atan2(vy, vx);
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * 2 * spread;
      const s = speed * (0.2 + Math.random() * 0.8) * 0.12;
      this.spawn(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.2 + Math.random() * 0.5, 0.02, 0);
    }
  }
  debris(x, y, vx, vy, mat, scale = 1) {
    this.spawn(DEBRIS, x, y, vx, vy, 2.5 + Math.random() * 2, 0.05 * scale * (0.6 + Math.random() * 0.6), mat);
  }
  explosion(x, y, size) {
    this.spawn(FLASH, x, y, 0, 0, 0.12, 5 * size);
    const L = this.lite ? 0.5 : 1;
    const nf = Math.min(28, 8 + size * 10) * L;
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 10) * size;
      this.spawn(FIRE, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.25 + Math.random() * 0.35, (0.4 + Math.random() * 0.5) * size, 0, 2.2);
    }
    const ns = Math.min(22, 6 + size * 8) * L;
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 4) * size;
      this.spawn(SMOKE, x, y, Math.cos(a) * s, Math.sin(a) * s + 1.5, 2 + Math.random() * 2, (0.6 + Math.random() * 0.6) * size, 0, 0.9);
    }
    this.spark(x, y, 0, 1, Math.min(60, 20 + size * 25) * L, Math.PI, 900 * Math.min(1.5, size));
    // a lazy smoke column that hangs around after the bang
    for (let i = 0; i < 4 * L; i++) this.spawn(SMOKE, x + (Math.random() - 0.5) * size, y + Math.random() * size, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.6, 6 + Math.random() * 3, (0.8 + Math.random() * 0.6) * size, 0, 0.25);
  }
  flash(x, y, size) { this.spawn(FLASH, x, y, 0, 0, 0.08, 3 * size); }
  smoke(x, y, size) { this.spawn(SMOKE, x, y, 0, 1, 2.5, size, 0, 0.8); }
  dust(x, y, size) { for (let i = 0; i < 10; i++) this.spawn(SMOKE, x, y, (Math.random() - 0.5) * 6, Math.random() * 4, 1.5 + Math.random(), 0.5 * size, 0, 1); }
  jet(x0, y0, x1, y1, precursor = false) { this.jets.push({ x0, y0, x1, y1, life: 0.3, max: 0.3, pre: precursor }); }
  shake(a) { this.shakeAmt = Math.min(2, Math.max(this.shakeAmt, a)); }

  update(dt) {
    const { x, y, vx, vy, life, type, alive, size, grow } = this;
    for (let k = 0; k < this.max; k++) {
      if (!alive[k]) continue;
      life[k] -= dt;
      if (life[k] <= 0) { alive[k] = 0; this.count--; continue; }
      const t = type[k];
      if (t === DEBRIS || t === MOLTEN) {
        vy[k] -= 9.81 * dt;
        x[k] += vx[k] * dt; y[k] += vy[k] * dt;
        if (y[k] < size[k] * 0.5) { y[k] = size[k] * 0.5; vy[k] *= -0.25; vx[k] *= 0.6; }
      } else if (t === SPARK) {
        vy[k] -= 9.81 * dt * 0.5;
        x[k] += vx[k] * dt; y[k] += vy[k] * dt;
        if (y[k] < 0) { y[k] = 0; vy[k] *= -0.3; }
      } else {
        const drag = t === SMOKE || t === PUFF ? 1.6 : 3;
        const f = Math.max(0, 1 - drag * dt);
        vx[k] *= f; vy[k] *= f;
        if (t === SMOKE || t === PUFF) vy[k] += 0.6 * dt;
        x[k] += vx[k] * dt; y[k] += vy[k] * dt;
        size[k] += grow[k] * dt * size[k] * 0.5 + grow[k] * dt * 0.2;
      }
    }
    for (let i = this.jets.length - 1; i >= 0; i--) { this.jets[i].life -= dt; if (this.jets[i].life <= 0) this.jets.splice(i, 1); }
    this.shakeAmt *= Math.max(0, 1 - dt * 5);
  }

  // cam: {sx(x), sy(y), scale}
  draw(ctx, cam, view) {
    const { x, y, vx, vy, life, maxLife, type, alive, size, col } = this;
    const S = cam.scale;
    const minX = view.x0, maxX = view.x1, minY = view.y0, maxY = view.y1;
    // smoke (normal blend)
    const sm = this.sprites.smoke, pf = this.sprites.puff;
    for (let k = 0; k < this.max; k++) {
      if (!alive[k]) continue; const t = type[k];
      if (t !== SMOKE && t !== PUFF) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      const a = life[k] / maxLife[k];
      ctx.globalAlpha = Math.min(1, a * 1.4) * 0.8;
      const r = Math.min(this.maxR, Math.max(2, size[k] * S));
      ctx.drawImage(t === SMOKE ? sm : pf, cam.sx(x[k]) - r, cam.sy(y[k]) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // debris, batched by colour with a counting sort (one fillStyle change per colour)
    if (!this.bucketCount || this.bucketIdx.length !== this.max) { this.bucketCount = new Uint16Array(257); this.bucketIdx = new Uint16Array(this.max); }
    const cnt = this.bucketCount, idx = this.bucketIdx;
    cnt.fill(0);
    for (let k = 0; k < this.max; k++) {
      if (!alive[k] || type[k] !== DEBRIS) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      cnt[col[k] + 1]++;
    }
    for (let c = 1; c < 257; c++) cnt[c] += cnt[c - 1];
    const fillPos = cnt.slice(0, 256);
    for (let k = 0; k < this.max; k++) {
      if (!alive[k] || type[k] !== DEBRIS) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      idx[fillPos[col[k]]++] = k;
    }
    const total = cnt[256];
    let lastCol = -1;
    for (let n = 0; n < total; n++) {
      const k = idx[n];
      if (col[k] !== lastCol) { lastCol = col[k]; ctx.fillStyle = this.matColors[lastCol] || '#888'; }
      const s = Math.max(1.5, size[k] * S);
      ctx.fillRect(cam.sx(x[k]) - s / 2, cam.sy(y[k]) - s / 2, s, s);
    }
    // additive pass
    ctx.globalCompositeOperation = 'lighter';
    const f0 = this.sprites.fire[0], f1 = this.sprites.fire[1], fl = this.sprites.flash;
    for (let k = 0; k < this.max; k++) {
      if (!alive[k]) continue; const t = type[k];
      if (t !== FIRE && t !== FLASH) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      const a = life[k] / maxLife[k];
      ctx.globalAlpha = t === FLASH ? a : Math.min(1, a * 1.8);
      const r = Math.min(this.maxR, Math.max(3, size[k] * S));
      ctx.drawImage(t === FLASH ? fl : a > 0.5 ? f0 : f1, cam.sx(x[k]) - r, cam.sy(y[k]) - r, r * 2, r * 2);
    }
    // molten droplets: white-hot cooling to dull red
    for (let k = 0; k < this.max; k++) {
      if (!alive[k] || type[k] !== MOLTEN) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      const a = life[k] / maxLife[k];
      ctx.globalAlpha = Math.min(1, a * 1.5);
      const r = Math.min(10, Math.max(2, size[k] * S * (0.7 + a)));
      ctx.drawImage(a > 0.55 ? f0 : f1, cam.sx(x[k]) - r, cam.sy(y[k]) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    // sparks as one path
    ctx.strokeStyle = 'rgba(255,200,110,0.9)';
    ctx.lineWidth = Math.max(1, Math.min(3, S * 0.02));
    ctx.beginPath();
    const tail = 0.012;
    for (let k = 0; k < this.max; k++) {
      if (!alive[k] || type[k] !== SPARK) continue;
      if (x[k] < minX || x[k] > maxX || y[k] < minY || y[k] > maxY) continue;
      const sx = cam.sx(x[k]), sy = cam.sy(y[k]);
      ctx.moveTo(sx, sy); ctx.lineTo(sx - vx[k] * tail * S, sy + vy[k] * tail * S);
    }
    ctx.stroke();
    for (const j of this.jets) {
      const a = j.life / j.max;
      ctx.strokeStyle = j.pre ? `rgba(255,220,150,${a})` : `rgba(190,230,255,${a})`;
      ctx.lineWidth = Math.max(2, S * (j.pre ? 0.025 : 0.04)) * (0.5 + a);
      ctx.beginPath(); ctx.moveTo(cam.sx(j.x0), cam.sy(j.y0)); ctx.lineTo(cam.sx(j.x1), cam.sy(j.y1)); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
