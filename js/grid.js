// Destructible target grid. Pure data (no DOM) so it also runs in Node for balancing.
import { GRID_W, GRID_H, GROUND_ROWS, G_ROWS, T, TMATS } from './data.js';

export class Grid {
  constructor(build) {
    this.W = GRID_W; this.H = GRID_H;
    const n = this.W * this.H;
    this.mat = new Uint8Array(n);
    this.hp = new Float32Array(n);
    this.scorch = new Uint8Array(n);
    this.noise = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.noise[i] = (Math.random() * 255) | 0;
    this.changed = new Uint8Array(n);
    this.dirty = [];
    this.allDirty = true;
    this.build = build;
    this.reset();
  }

  reset() {
    this.mat.fill(0); this.hp.fill(1); this.scorch.fill(0);
    for (let j = G_ROWS; j < this.H; j++) for (let i = 0; i < this.W; i++) this.mat[j * this.W + i] = T.GROUND;
    if (this.build) this.build(this.builder());
    this.recount();
    this.allDirty = true;
  }

  recount() {
    let c = 0;
    for (let i = 0; i < this.mat.length; i++) if (this.mat[i] === T.CORE) c++;
    this.coreTotal = c; this.coreLeft = c;
  }

  // builder API: x from left edge, y from ground up, in cells
  builder() {
    const g = this;
    const put = (i, yc, m) => {
      const j = G_ROWS - 1 - yc;
      if (i < 0 || i >= g.W || j < 0 || j >= G_ROWS) return;
      const k = j * g.W + i; g.mat[k] = m; g.hp[k] = 1;
    };
    return {
      rect(x, y, w, h, m) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, m); },
      box(x, y, w, h, t, m) { this.rect(x, y, t, h, m); this.rect(x + w - t, y, t, h, m); this.rect(x, y + h - t, w, t, m); },
      circle(cx, cy, r, m) { for (let yy = Math.floor(cy - r); yy <= cy + r; yy++) for (let xx = Math.floor(cx - r); xx <= cx + r; xx++) if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= r * r) put(xx, yy, m); },
      poly(pts, m) {
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        for (let yy = Math.floor(minY); yy < maxY; yy++) for (let xx = Math.floor(minX); xx < maxX; xx++) {
          const px = xx + 0.5, py = yy + 0.5; let inside = false;
          for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
            const [xa, ya] = pts[a], [xb, yb] = pts[b];
            if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) inside = !inside;
          }
          if (inside) put(xx, yy, m);
        }
      },
    };
  }

  get(i, j) { if (i < 0 || j < 0 || i >= this.W || j >= this.H) return 0; return this.mat[j * this.W + i]; }

  mark(k) { if (!this.changed[k]) { this.changed[k] = 1; this.dirty.push(k); } }

  // returns destroyed material id (0 if nothing)
  destroy(i, j) {
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return 0;
    const k = j * this.W + i, m = this.mat[k];
    if (!m || TMATS[m].fixed) return 0;
    this.mat[k] = 0; this.hp[k] = 1;
    if (m === T.CORE) this.coreLeft--;
    this.mark(k);
    return m;
  }

  // damage 0..1; returns material if the cell broke
  damage(i, j, amt) {
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return 0;
    const k = j * this.W + i, m = this.mat[k];
    if (!m || TMATS[m].fixed) return 0;
    this.hp[k] -= amt; this.mark(k);
    if (this.hp[k] <= 0) return this.destroy(i, j);
    return 0;
  }

  paint(i, j, m) {
    if (i < 0 || j < 0 || i >= this.W || j >= G_ROWS) return;
    const k = j * this.W + i, old = this.mat[k];
    if (old === m) return;
    if (old === T.CORE) { this.coreLeft--; this.coreTotal--; }
    if (m === T.CORE) { this.coreLeft++; this.coreTotal++; }
    this.mat[k] = m; this.hp[k] = 1; this.scorch[k] = 0; this.mark(k);
  }

  // bounding box (cells) of everything above ground
  bounds() {
    let i0 = this.W, i1 = -1, top = G_ROWS;
    for (let j = 0; j < G_ROWS; j++) for (let i = 0; i < this.W; i++) {
      if (this.mat[j * this.W + i]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < top) top = j; }
    }
    if (i1 < 0) return { i0: 40, i1: 200, top: G_ROWS - 40 };
    return { i0, i1, top };
  }

  coreFraction() { return this.coreTotal ? 1 - this.coreLeft / this.coreTotal : 0; }

  // Remove cells no longer connected to the ground. Returns list of [k, mat].
  detachFloating(maxReturn = 1e9) {
    const W = this.W, n = this.mat.length, mat = this.mat;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n); let sp = 0;
    for (let i = 0; i < W; i++) { const k = G_ROWS * W + i; seen[k] = 1; stack[sp++] = k; }
    while (sp > 0) {
      const k = stack[--sp];
      const i = k % W;
      const nb0 = k - W, nb1 = k + W, nb2 = i > 0 ? k - 1 : -1, nb3 = i < W - 1 ? k + 1 : -1;
      if (nb0 >= 0 && !seen[nb0] && mat[nb0]) { seen[nb0] = 1; stack[sp++] = nb0; }
      if (nb1 < n && !seen[nb1] && mat[nb1]) { seen[nb1] = 1; stack[sp++] = nb1; }
      if (nb2 >= 0 && !seen[nb2] && mat[nb2]) { seen[nb2] = 1; stack[sp++] = nb2; }
      if (nb3 >= 0 && !seen[nb3] && mat[nb3]) { seen[nb3] = 1; stack[sp++] = nb3; }
    }
    const out = [];
    for (let k = 0; k < n; k++) {
      if (mat[k] && !seen[k]) {
        const m = mat[k];
        if (out.length < maxReturn) out.push(k, m);
        mat[k] = 0; if (m === T.CORE) this.coreLeft--;
        this.mark(k);
      }
    }
    return out;
  }
}
