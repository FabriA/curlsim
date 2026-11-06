import { describe, expect, it } from "vitest";
import { calibrate, measureDrawCurl, spinRateForTurns, speedToStopAt } from "../src/core/calibrate";
import { RELEASE_Y, TEE_Y } from "../src/core/geometry";
import { BASE_PARAMS, CURVES, curveLevelOf, PROFILES, SPIN_TURNS, type CurveLevel } from "../src/core/params";
import { Sim } from "../src/core/sim";

const forCurve = (c: CurveLevel) => calibrate(PROFILES.normal, { ...BASE_PARAMS, ...CURVES[c] });

/** Quota della curva totale fatta negli ultimi 3 m prima dell'arresto. */
function lateShare(c: CurveLevel): number {
  const params = forCurve(c);
  const start = { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(params, TEE_Y), w: spinRateForTurns(params, SPIN_TURNS.normal) };
  const first = new Sim(params, [], 0, start);
  while (!first.done) first.step(false);
  const stop = first.metrics.stop!;
  const sim = new Sim(params, [], 0, start);
  let xAt = 0;
  while (!sim.done) {
    sim.step(false);
    const s = sim.world.stones[0];
    if (s.y < stop.y - 3) xAt = s.x;
  }
  return (stop.x - xAt) / stop.x;
}

function curlWithTurns(c: CurveLevel, turns: number): number {
  const params = forCurve(c);
  const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(params, TEE_Y), w: spinRateForTurns(params, turns) });
  while (!sim.done) sim.step(false);
  return sim.metrics.stop!.x;
}

describe("forma della curva del draw", () => {
  it("senza i nuovi parametri la fisica è quella della 0.3.1", () => {
    const old = calibrate(PROFILES.normal), classic = forCurve("classic");
    expect(classic.curlK).toBe(old.curlK);
    expect(classic.mu).toBe(old.mu);
    expect(lateShare("classic")).toBeCloseTo(0.41, 2);
    expect(curveLevelOf(calibrate(PROFILES.normal))).toBe("classic");
  });

  for (const c of ["late", "later"] as const) {
    it(`curva ${c}: la curva totale del draw di riferimento resta quella del profilo (±2 cm)`, () => {
      expect(Math.abs(measureDrawCurl(forCurve(c)) - PROFILES.normal.curl)).toBeLessThan(0.02);
    });
  }

  it("con il finale più netto una quota maggiore della curva arriva negli ultimi 3 m", () => {
    const a = lateShare("classic"), b = lateShare("late"), d = lateShare("later");
    expect(b).toBeGreaterThan(a + 0.05);
    expect(d).toBeGreaterThan(b + 0.05);
  });

  it("con il finale più netto più giri danno più curva", () => {
    const low = curlWithTurns("late", SPIN_TURNS.low), high = curlWithTurns("late", SPIN_TURNS.high);
    expect(high - low).toBeGreaterThan(0.2);
  });
});

describe("arresto con la curva netta", () => {
  // Caso reale: dopo una bocciata le pietre colpite restavano a 0,1 mm/s per sempre, il tiro non finiva.
  it("dopo una bocciata in una casa affollata tutte le pietre si fermano", () => {
    const stones = [
      { id: 0, team: 0 as const, x: -0.525, y: 16.062 }, { id: 1, team: 1 as const, x: -0.0465, y: 17.941 },
      { id: 2, team: 0 as const, x: 0.0358, y: 18.175 }, { id: 3, team: 1 as const, x: -0.1729, y: 17.723 },
      { id: 4, team: 0 as const, x: 0.1327, y: 18.95 },
    ];
    for (const c of ["late", "later"] as const) {
      const p = forCurve(c);
      const sp = 3.2288, ang = -0.01844;
      const sim = new Sim(p, stones, 0, { x: 0, y: RELEASE_Y, vx: sp * Math.sin(ang), vy: sp * Math.cos(ang), w: -spinRateForTurns(p, 4.19) });
      while (!sim.done) sim.step(false);
      expect(sim.metrics.ticks).toBeLessThan(30_000);
    }
  });
});
