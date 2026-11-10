import { describe, expect, it } from "vitest";
import { calibrate, stopForSpeed } from "../src/core/calibrate";
import { executionError, hasExecutionNoise } from "../src/core/execution";
import { TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import { makeReplay, skillFromPrecision } from "../src/core/sim";

const p = calibrate(PROFILES.normal);
const shot = (speed: number) => ({ broomX: 0.6, broomY: TEE_Y, speed, spin: 1 as const, spinRate: 1.5, spinTurns: 3.5 });

describe("errore di esecuzione", () => {
  it("abilità perfetta: nessun errore da mostrare, errore nullo", () => {
    const r = makeReplay(p, 0, [], shot(2.03), skillFromPrecision({ lineDraw: 0, lineTakeout: 0, stopTypical: 0 }), 7);
    expect(hasExecutionNoise(r)).toBe(false);
    const e = executionError(r);
    expect(Math.abs(e.line)).toBeLessThan(1e-9);
    expect(Math.abs(e.length!)).toBeLessThan(1e-9);
  });

  it("abilità non perfetta: linea al mirino e differenza d'arresto coerenti con il rilascio", () => {
    for (let seed = 1; seed < 30; seed++) {
      const r = makeReplay(p, 0, [], shot(2.03), skillFromPrecision({ lineDraw: 0.3, lineTakeout: 0.2, stopTypical: 0.6 }), seed);
      expect(hasExecutionNoise(r)).toBe(true);
      const e = executionError(r);
      expect(e.aimX - r.shot.broomX).toBeCloseTo(e.line, 12);
      expect(e.length!).toBeCloseTo(stopForSpeed(p, e.speed) - stopForSpeed(p, 2.03), 12);
      expect(Math.abs(e.line)).toBeLessThan(1.5);
    }
  });

  it("bocciata: niente differenza d'arresto, si usa la velocità", () => {
    const e = executionError(makeReplay(p, 0, [], shot(3), skillFromPrecision({ lineDraw: 0.3, lineTakeout: 0.2, stopTypical: 0.6 }), 3));
    expect(e.length).toBeNull();
    expect(e.intendedSpeed).toBe(3);
  });
});
