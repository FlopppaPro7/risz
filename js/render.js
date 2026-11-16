// Game view renderer: sky, ground, launcher, target grid image, projectile, effects.
import { CELL, GRID_W, GRID_H, G_ROWS, GROUND_ROWS, TMATS, T, MUZZLE_H } from './data.js';

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.maxDpr = 2;
    this.cam = { x: 0, y: 3, scale: 40, sx: x => (x - this.cam.x) * this.cam.scale + this.w / 2 + this.shx, sy: y => this.h / 2 - (y - this.cam.y) * this.cam.scale + this.shy };
    this.shx = 0; this.shy = 0;
    // grid image
    this.gc = document.createElement('canvas');
    this.gc.width = GRID_W; this.gc.height = GRID_H;
    this.gctx = this.gc.getContext('2d');
    this.img = this.gctx.createImageData(GRID_W, GRID_H);
    this.u32 = new Uint32Array(this.img.data.buffer);
    this.palette = TMATS.map(m => m && m.color ? m.color : [0, 0, 0]);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * this.dpr); this.c.height = Math.round(this.h * this.dpr);
    this.sky = null;
  }

  cellColor(g, k) {
    const m = g.mat[k];
    if (!m) return 0;
    const c = this.palette[m];
    let f = 0.86 + (g.noise[k] / 255) * 0.22;
    if (m !== T.CORE) f *= 0.55 + 0.45 * Math.max(0, g.hp[k]);
    f *= 1 - g.scorch[k] / 400;
    // subtle brick/plank pattern
    const i = k % GRID_W, j = (k / GRID_W) | 0;
    if (m === T.BRICK && ((j % 3 === 0) || ((i + (((j / 3) | 0) % 2) * 3) % 6 === 0))) f *= 0.78;
    if (m === T.WOOD && j % 4 === 0) f *= 0.82;
    if (m === T.ERA && (i + j) % 4 === 0) f *= 0.7;
    if (m === T.GROUND) f = j === G_ROWS ? 1.35 : 0.97 + (g.noise[k] / 255) * 0.05;
    const r = Math.min(255, c[0] * f) | 0, gg = Math.min(255, c[1] * f) | 0, b = Math.min(255, c[2] * f) | 0;
    return (255 << 24) | (b << 16) | (gg << 8) | r;
  }

  syncGrid(g) {
    if (g.allDirty) {
      for (let k = 0; k < g.mat.length; k++) this.u32[k] = this.cellColor(g, k);
      g.allDirty = false;
      for (const k of g.dirty) g.changed[k] = 0;
      g.dirty.length = 0;
      this.gctx.putImageData(this.img, 0, 0);
      return;
    }
    if (!g.dirty.length) return;
    for (const k of g.dirty) { this.u32[k] = this.cellColor(g, k); g.changed[k] = 0; }
    g.dirty.length = 0;
    this.gctx.putImageData(this.img, 0, 0);
  }

  // camera helpers
  fitTarget(world, vw = this.w, vh = this.h, topPad = 60, botPad = 90) {
    if (!world.bbox) world.bbox = world.grid.bounds();
    const b = world.bbox;
    const x0 = Math.max(0, b.i0 - 14) * CELL, x1 = Math.min(GRID_W, b.i1 + 15) * CELL;
    const hTop = Math.max(2.5, (G_ROWS - b.top) * CELL + 0.8);
    const usableH = Math.max(100, vh - topPad - botPad);
    const scale = Math.min(vw / (x1 - x0), usableH / hTop, 160);
    const midScreen = topPad + usableH / 2;
    const cy = hTop / 2 + (vh / 2 - midScreen) / scale;
    return { x: world.x0 + (x0 + x1) / 2, y: cy, scale };
  }

  render(world, fx, st) {
    const ctx = this.ctx, cam = this.cam, W = this.w, H = this.h;
    this.shx = (Math.random() - 0.5) * fx.shakeAmt * 10; this.shy = (Math.random() - 0.5) * fx.shakeAmt * 10;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // sky
    if (!this.sky) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0b1018'); g.addColorStop(0.6, '#16202c'); g.addColorStop(1, '#232a30');
      this.sky = g;
    }
    ctx.fillStyle = this.sky; ctx.fillRect(0, 0, W, H);
    const S = cam.scale;
    const viewX0 = cam.x - W / 2 / S, viewX1 = cam.x + W / 2 / S;
    // parallax hills
    this.hills(ctx, 0.04, 0.55, '#121922', 26);
    this.hills(ctx, 0.12, 0.62, '#18202a', 14);
    // ground
    const gy = cam.sy(0);
    ctx.fillStyle = '#2b2722'; ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = '#3a342c'; ctx.fillRect(0, gy, W, Math.max(1, S * 0.06));
    // distance markers
    let step = 100; if (S > 12) step = 10; else if (S > 3) step = 50; else if (S < 0.4) step = 500;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let d = Math.ceil(viewX0 / step) * step; d < viewX1; d += step) {
      if (d < 0) continue;
      const x = cam.sx(d);
      ctx.fillRect(x - 0.5, gy, 1, 8);
      if (d % (step * 2) === 0 || step >= 100) ctx.fillText(d + ' m', x, gy + 20);
    }
    // launcher
    if (viewX0 < 6) this.drawLauncher(ctx, st);
    // target grid
    const gx0 = cam.sx(world.x0), gy0 = cam.sy(G_ROWS * CELL);
    const gw = GRID_W * CELL * S, gh = GRID_H * CELL * S;
    if (gx0 < W && gx0 + gw > 0) {
      this.syncGrid(world.grid);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.gc, gx0, gy0, gw, gh);
      if (st.showGridBox) { ctx.strokeStyle = 'rgba(120,200,255,0.25)'; ctx.setLineDash([4, 4]); ctx.strokeRect(gx0, gy0, gw, gh - GROUND_ROWS * CELL * S); ctx.setLineDash([]); }
    }
    // embedded penetrator
    if (world.embedded && st.sprite) this.drawShell(ctx, st.sprite, world.embedded.x, world.embedded.y, world.embedded.ang, world.embedded.a, 0);
    // fragments
    if (world.frags.length) {
      ctx.strokeStyle = 'rgba(255,230,160,0.95)'; ctx.lineWidth = Math.max(1, S * 0.015);
      ctx.beginPath();
      for (const f of world.frags) { const x = cam.sx(f.x), y = cam.sy(f.y); ctx.moveTo(x, y); ctx.lineTo(x - f.vx * 0.0015 * S, y + f.vy * 0.0015 * S); }
      ctx.stroke();
    }
    // projectile
    const p = world.proj;
    if (p && st.sprite) {
      const ang = Math.atan2(p.vy, p.vx) + (p.state === 'flight' ? p.yaw * Math.sin(p.yawPhase) : 0);
      this.drawShell(ctx, st.sprite, p.x, p.y, ang, p.a, p.state === 'flight' && p.burn > 0 ? 1 : 0);
    }
    fx.draw(ctx, cam, { x0: viewX0 - 2, x1: viewX1 + 2, y0: -2, y1: cam.y + H / 2 / S + 2 });
    // aim reticle
    if (st.aim && st.showAim) {
      const x = cam.sx(st.aim.x), y = cam.sy(st.aim.y);
      ctx.strokeStyle = st.aimOk ? '#7fe0ff' : '#ff6a5a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.moveTo(x - 22, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 22, y); ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 22); ctx.stroke();
    }
    // predicted path
    if (st.path && st.showAim) {
      ctx.strokeStyle = 'rgba(127,224,255,0.35)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); let started = false;
      for (let i = 0; i < st.path.length; i += 2) {
        const x = st.path[i]; if (x < viewX0 - 5) continue; if (x > viewX1 + 5) break;
        const sx = cam.sx(x), sy = cam.sy(st.path[i + 1]);
        if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  hills(ctx, par, base, color, amp) {
    const W = this.w, H = this.h, ox = this.cam.x * this.cam.scale * par;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H);
    const gy = Math.min(H, this.cam.sy(0));
    for (let x = 0; x <= W + 20; x += 20) {
      const u = (x + ox) * 0.004;
      const y = gy - H * (1 - base) * 0.35 - (Math.sin(u) * 0.6 + Math.sin(u * 2.3 + 1) * 0.3 + Math.sin(u * 5.1) * 0.1) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  drawLauncher(ctx, st) {
    const cam = this.cam, S = cam.scale;
    const ang = st.angle || 0;
    const bx = cam.sx(0), by = cam.sy(MUZZLE_H);
    ctx.save();
    ctx.fillStyle = '#39424c';
    if (st.rocket) {
      ctx.fillRect(cam.sx(-1.2), cam.sy(1.2), 2.4 * S, 1.2 * S);
      ctx.translate(bx, by); ctx.rotate(-ang);
      ctx.fillStyle = '#56616c'; ctx.fillRect(-1.5 * S, -0.08 * S, 3.7 * S, 0.16 * S);
      ctx.fillStyle = '#2c333a'; ctx.fillRect(-1.5 * S, 0.08 * S, 3.7 * S, 0.1 * S);
    } else {
      ctx.fillRect(cam.sx(-2), cam.sy(1.1), 4 * S, 1.1 * S);
      ctx.fillStyle = '#4a545e';
      ctx.beginPath(); ctx.arc(bx, by, 0.7 * S, Math.PI, 0); ctx.fill();
      ctx.translate(bx, by); ctx.rotate(-ang);
      const bore = Math.max(0.06, st.bore || 0.1);
      ctx.fillStyle = '#5d6873'; ctx.fillRect(0, -bore * 1.6 * S, 2.3 * S, bore * 3.2 * S);
      ctx.fillStyle = '#6b7783'; ctx.fillRect(1.9 * S, -bore * 2.1 * S, 0.4 * S, bore * 4.2 * S);
    }
    ctx.restore();
  }

  drawShell(ctx, sprite, x, y, ang, a, burning) {
    const cam = this.cam, S = cam.scale;
    let len = a.L * S, dia = a.D * S;
    const minLen = 18;
    if (len < minLen) { const k = minLen / len; len *= k; dia *= k; }
    ctx.save();
    ctx.translate(cam.sx(x), cam.sy(y)); ctx.rotate(-ang);
    if (burning) {
      ctx.globalCompositeOperation = 'lighter';
      const fl = len * (0.5 + Math.random() * 0.3);
      const g = ctx.createLinearGradient(-len, 0, -len - fl, 0);
      g.addColorStop(0, 'rgba(255,240,200,0.95)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-len, -dia * 0.35); ctx.lineTo(-len - fl, 0); ctx.lineTo(-len, dia * 0.35); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const sh = dia * sprite.height / sprite.dh;
    ctx.drawImage(sprite, -len, -sh / 2, len, sh);
    ctx.restore();
  }
}
