import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt, stopForSpeed, sweepFrictionForGain } from "../src/core/calibrate";
import { RELEASE_Y } from "../src/core/geometry";
import { PROFILES, REF_GUARD_SPEED, SHOT_PRECISION, SWEEP_GAIN, SWEEP_GAIN_RANGE, type ShotLevel, type SkillLevel } from "../src/core/params";
import { computeRelease, runReplay, Sim, skillFromPrecision } from "../src/core/sim";
import { REFERENCE_HASH, referenceReplay } from "../src/core/reference";

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
  const ice = calibrate(PROFILES.normal);
  const draw = { broomX: 0, broomY: 17.375, speed: speedToStopAt(ice, 17.375), spin: 1 as const, spinRate: 1.5 };
  const stopOf = (r: { vx: number; vy: number }) => stopForSpeed(ice, Math.hypot(r.vx, r.vy));
  const N = 4000;
  const errors = (level: ShotLevel) => {
    const out: number[] = [];
    for (let seed = 1; seed <= N; seed++) out.push(stopOf(computeRelease(draw, skillFromPrecision(SHOT_PRECISION[level]), seed, ice)) - stopOf({ vx: 0, vy: draw.speed }));
    return out;
  };

  it("perfetto: nessun errore", () => {
    expect(errors("perfect").every((e) => Math.abs(e) < 1e-9)).toBe(true);
  });

  it("élite: errore sull'arresto con la miscela di Brunner (σ complessiva circa 36 cm, errori oltre 1 m rari)", () => {
    const e = errors("elite");
    const rms = Math.sqrt(e.reduce((a, x) => a + x * x, 0) / N);
    expect(rms).toBeGreaterThan(0.3);
    expect(rms).toBeLessThan(0.42);
    const big = e.filter((x) => Math.abs(x) > 1).length / N;
    expect(big).toBeGreaterThan(0.01);
    expect(big).toBeLessThan(0.05);
  });

  it("la dispersione si riduce da principiante a club a élite", () => {
    const rms = (l: ShotLevel) => Math.sqrt(errors(l).reduce((a, x) => a + x * x, 0) / N);
    expect(rms("beginner")).toBeGreaterThan(rms("club"));
    expect(rms("club")).toBeGreaterThan(rms("elite"));
  });

  it("nelle bocciate l'errore di linea è quello delle bocciate", () => {
    const sk = skillFromPrecision(SHOT_PRECISION.elite);
    const lateral = (speed: number) => {
      let s2 = 0;
      for (let seed = 1; seed <= N; seed++) {
        const r = computeRelease({ ...draw, speed }, sk, seed, ice);
        // direzione rispetto alla scopa: x alla scopa = x al rilascio scalata sulla distanza staffa → scopa
        s2 += ((r.vx / r.vy) * (17.375 + 21.033)) ** 2;
      }
      return Math.sqrt(s2 / N);
    };
    expect(lateral(2.0)).toBeGreaterThan(lateral(3.0) * 1.7);
  });

  it("il formato precedente dell'abilità resta valido: il replay di riferimento dà lo stesso hash", () => {
    expect(runReplay(referenceReplay()).hash).toBe(REFERENCE_HASH);
  });
});
