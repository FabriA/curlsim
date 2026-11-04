import { describe, expect, it } from "vitest";
import { calibrate, stopForSpeed, sweepFrictionForGain } from "../src/core/calibrate";
import { RELEASE_Y } from "../src/core/geometry";
import { PROFILES, REF_GUARD_SPEED, SHOT_PRECISION, SWEEP_GAIN, SWEEP_GAIN_RANGE, type SkillLevel } from "../src/core/params";
import { computeRelease, Sim } from "../src/core/sim";

const levels: SkillLevel[] = ["beginner", "club", "elite"];

function guardStop(params: ReturnType<typeof calibrate>, sweep: boolean): number {
  const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: REF_GUARD_SPEED, w: 0 });
  while (!sim.done) sim.step(sweep);
  return sim.metrics.stop!.y;
}

describe("livelli degli sweeper", () => {
  for (const id of ["straight", "normal", "swingy"] as const) {
    for (const level of levels) {
      const [lo, hi] = SWEEP_GAIN_RANGE[level];
      it(`ghiaccio ${id}, sweeper ${level}: la guardia a 1,9 m/s spazzata guadagna tra ${lo} e ${hi} m`, () => {
        const ice = calibrate(PROFILES[id]);
        const params = { ...ice, sweepFriction: sweepFrictionForGain(ice, SWEEP_GAIN[level]) };
        const gain = guardStop(params, true) - guardStop(params, false);
        expect(gain).toBeGreaterThanOrEqual(lo);
        expect(gain).toBeLessThanOrEqual(hi);
        expect(Math.abs(gain - SWEEP_GAIN[level])).toBeLessThan(0.05);
      });
    }
  }

  it("la guardia di riferimento resta davanti alla tee line anche spazzata dagli élite", () => {
    const ice = calibrate(PROFILES.normal);
    expect(stopForSpeed(ice, REF_GUARD_SPEED) + SWEEP_GAIN.elite).toBeLessThan(17.375);
  });

  it("più esperti gli sweeper, minore l'attrito spazzando", () => {
    const ice = calibrate(PROFILES.normal);
    const f = levels.map((l) => sweepFrictionForGain(ice, SWEEP_GAIN[l]));
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[1]).toBeGreaterThan(f[2]);
    expect(sweepFrictionForGain(ice, 0)).toBe(1);
  });
});

describe("registrazione della spazzata", () => {
  it("gli intervalli di spazzata effettiva corrispondono al tempo spazzato e si fermano alla tee line", () => {
    const ice = calibrate(PROFILES.normal);
    const sim = new Sim(ice, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 2.0, w: 0 });
    sim.runToEnd([[1000, 4000], [8000, 60000]]);
    const total = sim.swept.reduce((a, [x, y]) => a + (y - x), 0) / 1000;
    expect(Math.abs(total - sim.metrics.sweepTime)).toBeLessThan(0.002);
    expect(sim.swept[0]).toEqual([1000, 4000]);
    expect(sim.sweptSeconds()[0]).toEqual([1, 4]);
    // il secondo intervallo finisce quando la pietra supera la tee line, prima della fine del comando
    expect(sim.swept[1][1]).toBeLessThan(60000);
  });

  it("la traccia della pietra tirata segna i tratti spazzati", () => {
    const ice = calibrate(PROFILES.normal);
    const sim = new Sim(ice, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 2.0, w: 0 });
    sim.runToEnd([[2000, 5000]]);
    const pts = sim.trace.get(sim.deliveredId)!;
    expect(pts.some((p) => p.swept)).toBe(true);
    expect(pts.some((p) => !p.swept)).toBe(true);
  });
});

describe("precisione del tiro per livello", () => {
  it("la dispersione dei tiri si riduce da principiante a élite", () => {
    const shot = { broomX: 0, broomY: 17.375, speed: 2, spin: 1 as const, spinRate: 1.5 };
    const spread = (level: SkillLevel) => {
      let sx = 0;
      let sv = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const r = computeRelease(shot, SHOT_PRECISION[level], seed);
        sx += r.x * r.x;
        sv += (Math.hypot(r.vx, r.vy) - 2) ** 2;
      }
      return { x: Math.sqrt(sx / 400), v: Math.sqrt(sv / 400) };
    };
    const b = spread("beginner");
    const c = spread("club");
    const e = spread("elite");
    expect(b.x).toBeGreaterThan(c.x);
    expect(c.x).toBeGreaterThan(e.x);
    expect(b.v).toBeGreaterThan(c.v);
    expect(c.v).toBeGreaterThan(e.v);
  });
});
