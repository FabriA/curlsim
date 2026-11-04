import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt } from "../src/core/calibrate";
import { RELEASE_Y, STONE_RADIUS, TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import { REFERENCE_HASH, referenceReplay } from "../src/core/reference";
import { runReplay, Sim } from "../src/core/sim";

const params = calibrate(PROFILES.normal);

/** Bocciata dritta senza rotazione su una pietra al tee, con la tirata spostata lateralmente di `offset`. */
function hit(offset: number, speed = 3) {
  const sim = new Sim(params, [{ id: 0, team: 1, x: 0, y: TEE_Y }], 0, { x: offset, y: RELEASE_Y, vx: 0, vy: speed, w: 0 });
  sim.runToEnd();
  return sim.metrics.impact!;
}

describe("misure dell'urto (solo osservazione)", () => {
  it("un colpo pieno vale circa 100%, uno a mezza pietra circa 50%, uno sottile poco", () => {
    expect(hit(0).fullness).toBeGreaterThan(0.98);
    expect(Math.abs(hit(STONE_RADIUS).fullness - 0.5)).toBeLessThan(0.02);
    expect(hit(STONE_RADIUS * 1.8).fullness).toBeLessThan(0.15);
  });

  it("registra la velocità della tirata subito prima dell'urto", () => {
    // Con decelerazione costante: v² = v0² − 2·μ·g·d, con d fino al contatto (centri a 2r).
    const d = TEE_Y - 2 * STONE_RADIUS - RELEASE_Y;
    const expected = Math.sqrt(9 - 2 * params.mu * 9.81 * d);
    expect(Math.abs(hit(0).speed - expected)).toBeLessThan(0.01);
  });

  it("in un colpo pieno la tirata percorre poco e la colpita molto", () => {
    const imp = hit(0);
    expect(imp.shooterTravel).toBeLessThan(0.5);
    expect(imp.targetOut).toBe(true);
  });

  it("in un colpo a mezza pietra la tirata rotola più che in un colpo pieno", () => {
    expect(hit(STONE_RADIUS).shooterTravel).toBeGreaterThan(hit(0).shooterTravel + 0.5);
  });

  it("senza urti non c'è misura", () => {
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(params, TEE_Y), w: 0 });
    sim.runToEnd();
    expect(sim.metrics.impact).toBeNull();
  });

  it("le misure non cambiano il tiro: il replay di riferimento dà lo stesso hash", () => {
    const { sim, hash } = runReplay(referenceReplay());
    expect(hash).toBe(REFERENCE_HASH);
    expect(sim.metrics.impact).not.toBeNull();
  });
});
