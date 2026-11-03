import { describe, expect, it } from "vitest";
import { calibrate } from "../src/core/calibrate";
import { TEE_Y } from "../src/core/geometry";
import { ENGINE_VERSION, PROFILES } from "../src/core/params";
import { REFERENCE_HASH, referenceReplay } from "../src/core/reference";
import { computeRelease, makeReplay, runReplay, validateReplay } from "../src/core/sim";
import { createRng } from "../src/core/rng";

describe("determinismo e replay", () => {
  it("il replay di riferimento dà l'hash registrato", () => {
    expect(runReplay(referenceReplay()).hash).toBe(REFERENCE_HASH);
  });

  it("lo stesso replay rieseguito dà lo stesso stato finale", () => {
    const params = calibrate(PROFILES.normal);
    const r = makeReplay(params, 0, [{ id: 0, team: 1, x: 0.1, y: TEE_Y }], { broomX: 0.3, broomY: TEE_Y, speed: 2.6, spin: 1, spinRate: 1.2 }, { lineSigma: 0.05, weightSigma: 0.02 }, 42);
    r.sweep = [[1000, 4000]];
    const a = runReplay(r);
    const b = runReplay(JSON.parse(JSON.stringify(r)));
    expect(a.hash).toBe(b.hash);
    expect(a.sim.world.tick).toBe(b.sim.world.tick);
  });

  it("il replay passa per JSON senza perdere precisione", () => {
    const r = referenceReplay();
    const back = JSON.parse(JSON.stringify(r));
    expect(validateReplay(back)).toBe(true);
    expect(runReplay(back).hash).toBe(REFERENCE_HASH);
  });

  it("un input di spazzata diverso cambia l'hash", () => {
    const r = referenceReplay();
    r.sweep = [];
    expect(runReplay(r).hash).not.toBe(REFERENCE_HASH);
  });

  it("il generatore con seme è ripetibile", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("l'errore del tiratore dipende solo dal seme", () => {
    const shot = { broomX: 0, broomY: TEE_Y, speed: 2, spin: 1 as const, spinRate: 1.2 };
    const skill = { lineSigma: 0.1, weightSigma: 0.05 };
    expect(computeRelease(shot, skill, 5)).toEqual(computeRelease(shot, skill, 5));
    expect(computeRelease(shot, skill, 5)).not.toEqual(computeRelease(shot, skill, 6));
  });

  it("il replay registra la versione del motore", () => {
    expect(referenceReplay().engineVersion).toBe(ENGINE_VERSION);
  });
});
