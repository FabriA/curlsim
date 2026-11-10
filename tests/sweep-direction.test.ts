import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt, spinRateForTurns, sweepDirFor, sweepDirTargetForGain, sweepFrictionForGain } from "../src/core/calibrate";
import { RELEASE_Y, TEE_Y } from "../src/core/geometry";
import { BASE_PARAMS, COLLISIONS, CURVES, PROFILES, REF_GUARD_SPEED, SWEEP_DIR, SWEEP_GAIN, SWEEP_SIDE_SHARE } from "../src/core/params";
import { SWEEP_HARD, type SweepCmd } from "../src/core/physics";
import { makeReplay, runReplay, Sim, sweepAt } from "../src/core/sim";

const ice = calibrate(PROFILES.normal, { ...BASE_PARAMS, ...CURVES.spin });
function paramsFor(gain: number) {
  const p = { ...ice, ...COLLISIONS.soft, sweepFriction: sweepFrictionForGain(ice, gain), sweepSideShare: SWEEP_SIDE_SHARE };
  return { ...p, sweepDir: sweepDirFor(p, sweepDirTargetForGain(gain)) };
}
const p = paramsFor(SWEEP_GAIN.club);

function run(speed: number, w: number, cmd: SweepCmd | null) {
  const sim = new Sim(p, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speed, w });
  while (!sim.done) sim.step(cmd);
  return sim;
}

describe("spazzata direzionale (motore 0.4.0)", () => {
  it("Hard al 100% è la spazzata di prima", () => {
    const a = run(REF_GUARD_SPEED, 1, true);
    const b = run(REF_GUARD_SPEED, 1, SWEEP_HARD);
    expect(b.metrics.stop).toEqual(a.metrics.stop);
  });

  it("guardia senza rotazione spazzata da un lato: si sposta di circa lo spostamento del livello", () => {
    for (const lvl of ["beginner", "club", "elite"] as const) {
      const q = paramsFor(SWEEP_GAIN[lvl]);
      const sim = new Sim(q, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: REF_GUARD_SPEED, w: 0 });
      while (!sim.done) sim.step({ push: 1, level: 1 });
      expect(sim.metrics.stop!.x).toBeGreaterThan(SWEEP_DIR[lvl] * 0.85);
      expect(sim.metrics.stop!.x).toBeLessThan(SWEEP_DIR[lvl] * 1.15);
    }
  });

  it("simmetria: spingere a sinistra o a destra dà traiettorie speculari", () => {
    const l = run(REF_GUARD_SPEED, 0, { push: -1, level: 0.7 });
    const r = run(REF_GUARD_SPEED, 0, { push: 1, level: 0.7 });
    expect(l.metrics.stop!.x).toBeCloseTo(-r.metrics.stop!.x, 10);
    expect(l.metrics.stop!.y).toBeCloseTo(r.metrics.stop!.y, 10);
  });

  it("draw al tee: Curl aumenta la curva, Straight la riduce, con poca e molta rotazione", () => {
    const v = speedToStopAt(p, TEE_Y - 3);
    for (const turns of [1.5, 3.5, 10]) {
      const w = spinRateForTurns(p, turns);
      const none = run(v, w, null).metrics.stop!.x;
      const curl = run(v, w, { push: 1, level: 1 }).metrics.stop!.x;
      const straight = run(v, w, { push: -1, level: 1 }).metrics.stop!.x;
      expect(curl).toBeGreaterThan(none + 0.05);
      expect(straight).toBeLessThan(none - 0.05);
    }
  });

  it("l'intensità scala l'effetto: al 50% la pietra va meno lontano che al 100%", () => {
    const full = run(REF_GUARD_SPEED, 0, SWEEP_HARD).metrics.stop!.y;
    const half = run(REF_GUARD_SPEED, 0, { push: 0, level: 0.5 }).metrics.stop!.y;
    const none = run(REF_GUARD_SPEED, 0, null).metrics.stop!.y;
    expect(half).toBeGreaterThan(none + 0.3);
    expect(half).toBeLessThan(full - 0.3);
  });

  it("i comandi registrati riproducono il tiro identico", () => {
    const r = makeReplay(p, 0, [], { broomX: 0.3, broomY: TEE_Y, speed: 2.1, spin: 1, spinRate: spinRateForTurns(p, 3.5), spinTurns: 3.5 }, { lineSigma: 0, weightSigma: 0 }, 1);
    const sim = new Sim(r.params, [], 0, r.release);
    let k = 0;
    while (!sim.done) {
      k++;
      sim.step(k < 2000 ? { push: 1, level: 0.8 } : k < 4000 ? SWEEP_HARD : k < 5000 ? { push: -1, level: 0.4 } : null);
    }
    r.sweep = sim.sweep;
    r.sweepCmds = sim.sweepCmds;
    expect(runReplay(r).sim.metrics.stop).toEqual(sim.metrics.stop);
    expect(sim.metrics.sweepModes.curl).toBeGreaterThan(1.9);
    expect(sim.metrics.sweepModes.straight).toBeGreaterThan(0.9);
    expect(sweepAt(10, [], [[0, 20, 0, 1]])).toBe(SWEEP_HARD);
  });

  it("tutte le pietre si fermano con spazzate casuali", () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 60; n++) {
      const stones = Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => ({ id: i, team: (i % 2) as 0 | 1, x: (rnd() - 0.5) * 3, y: TEE_Y + (rnd() - 0.6) * 4 }));
      const sim = new Sim(p, stones, 0, { x: 0, y: RELEASE_Y, vx: (rnd() - 0.5) * 0.1, vy: 1.8 + rnd() * 1.5, w: (rnd() - 0.5) * 6 });
      while (!sim.done) {
        const u = rnd();
        sim.step(u < 0.3 ? null : { push: (u < 0.5 ? -1 : u < 0.7 ? 0 : 1) as -1 | 0 | 1, level: Math.round(rnd() * 10) / 10 });
      }
      expect(sim.metrics.ticks).toBeLessThan(40000);
    }
  });
});
