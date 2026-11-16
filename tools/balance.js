// Headless balance harness: fires designs at stages and reports core damage.
import { LEVELS } from '../js/data.js';
import { makeDesign, analyze, estimatePen, PRESETS } from '../js/design.js';
import { World } from '../js/sim.js';

export function runShot(level, design, trials = 3, aimY = null) {
  const a = analyze(design);
  const res = [];
  for (let t = 0; t < trials; t++) {
    const w = new World({ build: level.build, dist: level.dist });
    // aim at core centroid
    let sx = 0, sy = 0, n = 0;
    const g = w.grid;
    for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) if (g.mat[j * g.W + i] === 10) { sx += i; sy += j; n++; }
    const xT = w.cx(0) - 0.025, tx = w.cx(sx / n), ty = aimY ?? w.cy(sy / n);
    // aim so that the line reaches core height at grid entrance roughly
    const sol = World.solveAngle(a, tx, ty);
    let s = 0;
    for (; s < level.shots; s++) {
      w.fire(design, a, sol.angle);
      let guard = 0;
      while (w.busy() && guard++ < 200000) w.step(1 / 120);
      w.step(0.01);
      if (g.coreFraction() >= 0.4) break;
    }
    res.push({ core: g.coreFraction(), shots: Math.min(s + 1, level.shots), result: w.shot.result, v: Math.round(w.shot.impactV), notes: w.shot.notes.join(',') });
  }
  return { a, res };
}

if ((process.argv[1] || '').endsWith('balance.js')) {
  for (const name of Object.keys(PRESETS)) {
    const d = makeDesign(name); const a = analyze(d);
    console.log(`\n== ${name}: cost ${a.totalCost} mass ${a.flightMass.toFixed(2)}kg v0 ${a.muzzleV.toFixed(0)} stab ${a.stab.toFixed(2)} (${a.stabMode} margin ${a.margin.toFixed(2)} Sg ${a.Sg?.toFixed?.(2)}) pen ${estimatePen(a, a.muzzleV).toFixed(0)}mm jet ${(a.jetPen*1000).toFixed(0)} TNT ${a.fillerTNT.toFixed(2)} err ${a.errors}`);
    for (const L of LEVELS) {
      const { res } = runShot(L, d, 2);
      console.log(`  L${L.id} ${L.name.padEnd(18)} ` + res.map(r => `${(r.core * 100).toFixed(0)}%/${r.shots}sh ${r.result}`).join(' | '));
    }
  }
}
