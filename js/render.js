// Game view renderer: sky, ground, artillery, target grid image, projectile, effects.
// Supports a main view plus a picture-in-picture inset that share the same world.
import { CELL, GRID_W, GRID_H, G_ROWS, GROUND_ROWS, TMATS, T, MUZZLE_H } from './data.js';
import { World } from './sim.js';

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.maxDpr = 2;
    this.cam = { x: 0, y: 3, scale: 40 };
    this.shx = 0; this.shy = 0;
    this.gc = document.createElement('canvas');
    this.gc.width = GRID_W; this.gc.height = GRID_H;
    this.gctx = this.gc.getContext('2d');
    this.img = this.gctx.createImageData(GRID_W, GRID_H);
    this.u32 = new Uint32Array(this.img.data.buffer);
    this.palette = TMATS.map(m => m && m.color ? m.color : [0, 0, 0]);
    this.skyCache = new Map();
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * this.dpr); this.c.height = Math.round(this.h * this.dpr);
    this.skyCache.clear();
  }

  cellColor(g, k) {
    const m = g.mat[k];
    if (!m) return 0;
    const c = this.palette[m];
    let f = 0.86 + (g.noise[k] / 255) * 0.22;
    if (m !== T.CORE) f *= 0.55 + 0.45 * Math.max(0, g.hp[k]);
    f *= 1 - g.scorch[k] / 400;
    const i = k % GRID_W, j = (k / GRID_W) | 0;
    if (m === T.BRICK && ((j % 3 === 0) || ((i + (((j / 3) | 0) % 2) * 3) % 6 === 0))) f *= 0.78;
    if (m === T.WOOD && j % 4 === 0) f *= 0.82;
    if (m === T.ERA && (i + j) % 4 === 0) f *= 0.7;
    if ((m === T.STEEL || m === T.HHA) && (i % 10 === 0) && (j % 10 === 0)) f *= 1.3; // rivets
    if (m === T.GROUND) f = j === G_ROWS ? 1.35 : 0.97 + (g.noise[k] / 255) * 0.05;
    let r = Math.min(255, c[0] * f), gg = Math.min(255, c[1] * f), b = Math.min(255, c[2] * f);
    const ht = g.heat[k];
    if (ht) { // red-hot → white-hot glow around fresh holes
      const t = ht / 255, mix = Math.min(1, t * 1.1);
      r += (255 - r) * mix; gg += (70 + 170 * t * t - gg) * mix; b += (20 + 140 * t * t * t - b) * mix;
    }
    return (255 << 24) | ((b | 0) << 16) | ((gg | 0) << 8) | (r | 0);
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

  fitTarget(world, vw = this.w, vh = this.h, topPad = 60, botPad = 90) {
    if (!world.bbox) world.bbox = world.grid.bounds();
    const b = world.bbox;
    const x0 = Math.max(0, b.i0 - 14) * CELL, x1 = Math.min(GRID_W, b.i1 + 15) * CELL;
    const hTop = Math.max(2.5, (G_ROWS - b.top) * CELL + 0.8);
    const usableH = Math.max(60, vh - topPad - botPad);
    const scale = Math.min(vw / (x1 - x0), usableH / hTop, 160);
    const midScreen = topPad + usableH / 2;
    const cy = hTop / 2 + (vh / 2 - midScreen) / scale;
    return { x: world.x0 + (x0 + x1) / 2, y: cy, scale };
  }

  fitGun(vw, vh, topPad = 60, botPad = 150) {
    const narrow = vw < 520;
    const span = World.barrel + (narrow ? 6 : 10);
    const usable = vh - topPad - botPad;
    const scale = Math.min(vw / span, usable / (narrow ? 5 : 7), 120);
    return { x: World.barrel * 0.5 + (narrow ? -0.4 : 0.8), y: 2.4 + (vh / 2 - (topPad + usable * 0.55)) / scale, scale };
  }

  // st: per-frame state from the game; inset: {cam, vp, label} or null
  render(world, fx, st) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.shx = (Math.random() - 0.5) * fx.shakeAmt * 10; this.shy = (Math.random() - 0.5) * fx.shakeAmt * 10;
    this.view(world, fx, st, this.cam, { x: 0, y: 0, w: this.w, h: this.h }, false);
    if (st.inset) {
      const v = st.inset.vp;
      this.shx = this.shy = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(v.x - 3, v.y - 3, v.w + 6, v.h + 6);
      this.view(world, fx, st, st.inset.cam, v, true);
      ctx.strokeStyle = 'rgba(127,224,255,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(v.x + 0.5, v.y + 0.5, v.w - 1, v.h - 1);
      ctx.fillStyle = 'rgba(8,12,18,0.75)'; ctx.fillRect(v.x, v.y, 74, 18);
      ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(st.inset.label, v.x + 6, v.y + 13);
    }
    if (st.cine > 0.01) {
      const bh = this.h * 0.09 * st.cine;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.w, bh); ctx.fillRect(0, this.h - bh, this.w, bh);
      if (st.cineText) {
        ctx.globalAlpha = Math.min(1, st.cine); ctx.fillStyle = '#ffd34d'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'right';
        ctx.fillText(st.cineText, this.w - 14, this.h - bh / 2 + 4); ctx.globalAlpha = 1;
      }
    }
  }

  view(world, fx, st, cam, vp, inset) {
    const ctx = this.ctx, S = cam.scale, shx = this.shx, shy = this.shy;
    const V = {
      scale: S,
      sx: x => (x - cam.x) * S + vp.x + vp.w / 2 + shx,
      sy: y => vp.y + vp.h / 2 - (y - cam.y) * S + shy,
    };
    this.V = V;
    ctx.save();
    ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
    // sky
    const key = vp.h | 0;
    let sky = this.skyCache.get(key);
    if (!sky) {
      sky = ctx.createLinearGradient(0, 0, 0, vp.h);
      sky.addColorStop(0, '#0b1018'); sky.addColorStop(0.6, '#16202c'); sky.addColorStop(1, '#232a30');
      this.skyCache.set(key, sky);
    }
    ctx.save(); ctx.translate(0, vp.y); ctx.fillStyle = sky; ctx.fillRect(vp.x, 0, vp.w, vp.h); ctx.restore();
    const viewX0 = cam.x - vp.w / 2 / S, viewX1 = cam.x + vp.w / 2 / S;
    if (!inset) { this.hills(ctx, V, vp, cam, 0.04, 0.55, '#121922', 26); this.hills(ctx, V, vp, cam, 0.12, 0.62, '#18202a', 14); }
    // ground
    const gy = V.sy(0);
    if (gy < vp.y + vp.h) {
      ctx.fillStyle = '#2b2722'; ctx.fillRect(vp.x, gy, vp.w, vp.y + vp.h - gy);
      ctx.fillStyle = '#3a342c'; ctx.fillRect(vp.x, gy, vp.w, Math.max(1, S * 0.06));
    }
    if (!inset) {
      let step = 100; if (S > 12) step = 10; else if (S > 3) step = 50; else if (S < 0.4) step = 500;
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (let d = Math.ceil(viewX0 / step) * step; d < viewX1; d += step) {
        if (d < 0) continue;
        const x = V.sx(d);
        ctx.fillRect(x - 0.5, gy, 1, 8);
        if (d % (step * 2) === 0 || step >= 100) ctx.fillText(d + ' m', x, gy + 20);
      }
    }
    if (viewX0 < 8) this.drawLauncher(ctx, V, st);
    // target grid
    const gx0 = V.sx(world.x0), gy0 = V.sy(G_ROWS * CELL);
    const gw = GRID_W * CELL * S, gh = GRID_H * CELL * S;
    if (gx0 < vp.x + vp.w && gx0 + gw > vp.x) {
      this.syncGrid(world.grid);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.gc, gx0, gy0, gw, gh);
      if (st.showGridBox && !inset) { ctx.strokeStyle = 'rgba(120,200,255,0.25)'; ctx.setLineDash([4, 4]); ctx.strokeRect(gx0, gy0, gw, gh - GROUND_ROWS * CELL * S); ctx.setLineDash([]); }
    }
    const e = world.embedded;
    if (e && st.sprite) this.drawShell(ctx, V, e.stripped ? st.coreSprite : st.sprite, e.x, e.y, e.ang, Math.max(e.len, 0.02), e.d, 0, false);
    if (world.frags.length) {
      ctx.strokeStyle = 'rgba(255,230,160,0.95)'; ctx.lineWidth = Math.max(1, S * 0.015);
      ctx.beginPath();
      for (const f of world.frags) { const x = V.sx(f.x), y = V.sy(f.y); ctx.moveTo(x, y); ctx.lineTo(x - f.vx * 0.0015 * S, y + f.vy * 0.0015 * S); }
      ctx.stroke();
    }
    const p = world.proj;
    if (p && st.sprite) {
      if (p.state === 'pen') {
        const pen = p.pen;
        this.drawShell(ctx, V, pen.stripped ? st.coreSprite : st.sprite, p.x, p.y, Math.atan2(p.dy, p.dx), Math.max(pen.len, 0.02), pen.d, 0, p.inSolid);
      } else {
        const ang = Math.atan2(p.vy, p.vx) + p.yaw * Math.sin(p.yawPhase);
        this.drawShell(ctx, V, st.sprite, p.x, p.y, ang, p.a.L, p.a.D, p.burn > 0 ? 1 : 0, false);
      }
    }
    fx.draw(ctx, V, { x0: viewX0 - 2, x1: viewX1 + 2, y0: -2, y1: cam.y + vp.h / 2 / S + 2 });
    // predicted path + impact marker
    if (st.path && st.showAim) {
      ctx.strokeStyle = 'rgba(127,224,255,0.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); let started = false;
      for (let i = 0; i < st.path.length; i += 2) {
        const x = st.path[i]; if (x < viewX0 - 5) continue; if (x > viewX1 + 5) break;
        const sx = V.sx(x), sy = V.sy(st.path[i + 1]);
        if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (st.pred && st.showAim) {
      const x = V.sx(st.pred.x), y = V.sy(st.pred.y);
      const col = st.pred.hit ? (st.pred.mat === T.CORE ? '#ff5a4a' : '#7fe0ff') : '#ffb347';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      const r = inset ? 8 : 12;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 1.8, y); ctx.lineTo(x - r * 0.4, y); ctx.moveTo(x + r * 0.4, y); ctx.lineTo(x + r * 1.8, y);
      ctx.moveTo(x, y - r * 1.8); ctx.lineTo(x, y - r * 0.4); ctx.moveTo(x, y + r * 0.4); ctx.lineTo(x, y + r * 1.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  hills(ctx, V, vp, cam, par, base, color, amp) {
    const ox = cam.x * cam.scale * par;
    const gy = Math.min(vp.y + vp.h, V.sy(0));
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(vp.x, vp.y + vp.h);
    for (let x = vp.x; x <= vp.x + vp.w + 20; x += 20) {
      const u = (x + ox) * 0.004;
      const y = gy - vp.h * (1 - base) * 0.35 - (Math.sin(u) * 0.6 + Math.sin(u * 2.3 + 1) * 0.3 + Math.sin(u * 5.1) * 0.1) * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(vp.x + vp.w, vp.y + vp.h); ctx.closePath(); ctx.fill();
  }

  // Towed howitzer (or rocket rail) at the origin, barrel pivoting at (0, MUZZLE_H).
  drawLauncher(ctx, V, st) {
    const S = V.scale, ang = st.angle || 0;
    const X = V.sx, Y = V.sy;
    const steel = '#4f5a64', dark = '#2f363d', light = '#6c7884';
    ctx.save();
    ctx.lineJoin = 'round';
    if (st.rocket) {
      // truck bed + cab
      ctx.fillStyle = '#3c4a3a'; ctx.fillRect(X(-3.5), Y(1.5), 6.2 * S, 0.6 * S);
      ctx.fillStyle = '#465a44'; ctx.fillRect(X(2.7), Y(2.4), 1.6 * S, 1.5 * S);
      ctx.fillStyle = '#9fc4d6'; ctx.fillRect(X(3.3), Y(2.25), 0.8 * S, 0.6 * S);
      for (const wx of [-2.6, -1.2, 3.4]) this.wheel(ctx, X(wx), Y(0.55), 0.55 * S, dark, steel);
      ctx.translate(X(0), Y(MUZZLE_H)); ctx.rotate(-ang);
      const L = World.barrel;
      ctx.fillStyle = steel; ctx.fillRect(-1.2 * S, 0.02 * S, (L + 1.2) * S, 0.14 * S);
      ctx.fillStyle = light; ctx.fillRect(-1.2 * S, -0.04 * S, (L + 1.2) * S, 0.06 * S);
      ctx.fillStyle = dark; for (let k = -1; k < L; k += 0.8) ctx.fillRect(k * S, 0.16 * S, 0.12 * S, 0.12 * S);
      if (st.loaded && st.sprite) {
        const len = st.shellL * S, dia = Math.max(3, st.shellD * S);
        ctx.drawImage(st.sprite, L * S - len, -dia * st.sprite.height / st.sprite.dh / 2 - dia * 0.5, len, dia * st.sprite.height / st.sprite.dh);
      }
      ctx.restore();
      return;
    }
    const rec = (st.recoil || 0) * 0.9;
    // split trail and spade
    ctx.strokeStyle = steel; ctx.lineWidth = Math.max(2, 0.22 * S); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(-0.2), Y(1.0)); ctx.lineTo(X(-4.6), Y(0.15)); ctx.stroke();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(X(-4.7), Y(0.35)); ctx.lineTo(X(-4.3), Y(0.35)); ctx.lineTo(X(-4.6), Y(-0.2)); ctx.fill();
    // wheels
    this.wheel(ctx, X(-0.35), Y(0.62), 0.62 * S, dark, steel);
    // gun shield
    ctx.fillStyle = '#56626d';
    ctx.beginPath(); ctx.moveTo(X(0.42), Y(0.7)); ctx.lineTo(X(0.58), Y(2.75)); ctx.lineTo(X(0.86), Y(2.75)); ctx.lineTo(X(0.74), Y(0.7)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3f4952'; ctx.fillRect(X(0.42), Y(2.75), 0.44 * S, 0.08 * S);
    // cradle + barrel (recoils along its axis)
    ctx.translate(X(0), Y(MUZZLE_H)); ctx.rotate(-ang);
    const L = World.barrel, bore = Math.max(0.06, st.bore || 0.1);
    const tube = Math.max(0.09, bore * 1.7), breech = tube * 2.0;
    ctx.fillStyle = dark; ctx.fillRect(-0.7 * S, -tube * 0.4 * S, 1.9 * S, tube * 1.6 * S);           // cradle
    ctx.fillStyle = light; ctx.fillRect(-0.6 * S, tube * 0.8 * S, 1.6 * S, tube * 0.6 * S);           // recuperator
    ctx.translate(-rec * S, 0);
    ctx.fillStyle = steel; ctx.fillRect(-1.0 * S, -breech / 2 * S, 1.0 * S, breech * S);              // breech block
    const g = ctx.createLinearGradient(0, -tube * S / 2, 0, tube * S / 2);
    g.addColorStop(0, light); g.addColorStop(0.4, '#7d8994'); g.addColorStop(1, '#3a434b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -tube * 0.6 * S); ctx.lineTo(L * S, -tube * 0.42 * S); ctx.lineTo(L * S, tube * 0.42 * S); ctx.lineTo(0, tube * 0.6 * S); ctx.fill();
    ctx.fillStyle = steel; ctx.fillRect((L - 0.45) * S, -tube * 0.75 * S, 0.45 * S, tube * 1.5 * S);   // muzzle brake
    ctx.fillStyle = '#111'; ctx.fillRect((L - 0.35) * S, -tube * 0.75 * S, 0.08 * S, tube * 0.3 * S); ctx.fillRect((L - 0.35) * S, tube * 0.45 * S, 0.08 * S, tube * 0.3 * S);
    ctx.restore();
    // elevation arc
    if (st.showArc) {
      const cx = X(0), cy = Y(MUZZLE_H), R = Math.min(140, (L + 1) * S * 0.55);
      ctx.strokeStyle = 'rgba(127,224,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2.4, 0.04); ctx.stroke();
      for (let d = 0; d <= 75; d += 5) {
        const a = -d * Math.PI / 180, r2 = R - (d % 15 === 0 ? 10 : 5);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(-ang) * (R + 8), cy + Math.sin(-ang) * (R + 8)); ctx.stroke();
    }
  }

  wheel(ctx, x, y, r, tyre, hub) {
    ctx.fillStyle = tyre; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = tyre; ctx.lineWidth = Math.max(1, r * 0.08);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); ctx.stroke(); }
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x, y, r * 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // Draw a shell sprite whose tip sits at (x,y). hot = glowing tip while inside armour.
  drawShell(ctx, V, sprite, x, y, ang, L, D, burning, hot) {
    if (!sprite) return;
    const S = V.scale;
    let len = L * S, dia = D * S;
    const minLen = 18;
    if (len < minLen) { const k = minLen / len; len *= k; dia *= k; }
    ctx.save();
    ctx.translate(V.sx(x), V.sy(y)); ctx.rotate(-ang);
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
    if (hot) {
      ctx.globalCompositeOperation = 'lighter';
      const r = Math.max(6, dia * 1.6);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,220,0.95)'); g.addColorStop(0.4, 'rgba(255,150,40,0.6)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
}
