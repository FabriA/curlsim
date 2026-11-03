import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt } from "../src/core/calibrate";
import { FAR_HOG_INSIDE, HALF_WIDTH, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import { createStone, stepWorld, type World } from "../src/core/physics";
import { Sim } from "../src/core/sim";

const params = calibrate(PROFILES.normal);
const noFriction = { ...params, mu: 0, curlK: 0 };

function world(stones: ReturnType<typeof createStone>[], p = noFriction): World {
  return { params: p, stones, tick: 0 };
}

function runUntil(w: World, ticks: number) {
  for (let i = 0; i < ticks; i++) stepWorld(w, null);
}

describe("urti tra pietre", () => {
  it("urto frontale: si conserva la quantità di moto e la pietra ferma parte", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 0, 1);
    a.vy = 2;
    a.moving = true;
    const w = world([a, b]);
    runUntil(w, 1000);
    expect(a.vy + b.vy).toBeCloseTo(2, 9);
    expect(b.vy).toBeCloseTo((2 * (1 + params.restitution)) / 2, 6);
    expect(a.vy).toBeCloseTo((2 * (1 - params.restitution)) / 2, 6);
  });

  it("urto radente: la pietra colpita parte lungo la congiungente dei centri", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 2 * STONE_RADIUS * 0.8, 1);
    a.vy = 2;
    a.moving = true;
    const w = world([a, b], { ...noFriction, stoneFriction: 0 });
    runUntil(w, 1000);
    const angle = Math.atan2(b.vx, b.vy);
    expect(angle).toBeCloseTo(Math.asin(0.8), 2);
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(2);
  });

  it("catena di tre pietre allineate: l'ultima riceve quasi tutta la velocità", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 0, 1);
    const c = createStone(2, 1, 0, 1 + 2 * STONE_RADIUS);
    a.vy = 2;
    a.moving = true;
    const w = world([a, b, c], { ...noFriction, restitution: 1 });
    runUntil(w, 2000);
    expect(c.vy).toBeGreaterThan(1.9);
    expect(a.vy + b.vy + c.vy).toBeCloseTo(2, 6);
  });

  it("nessuna compenetrazione dopo un urto", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 0.1, 1);
    a.vy = 3;
    a.moving = true;
    const w = world([a, b]);
    for (let i = 0; i < 1500; i++) {
      stepWorld(w, null);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(2 * STONE_RADIUS - 1e-3);
    }
  });

  it("una pietra veloce non attraversa un'altra tra due passi", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 0, 2);
    a.vy = 6;
    a.moving = true;
    const w = world([a, b]);
    runUntil(w, 1000);
    expect(a.y).toBeLessThan(b.y);
    expect(b.vy).toBeGreaterThan(5);
  });

  it("l'attrito tra le pietre trasferisce rotazione in un urto radente", () => {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 2 * STONE_RADIUS * 0.7, 1);
    a.vy = 2;
    a.moving = true;
    const w = world([a, b]);
    runUntil(w, 1000);
    expect(Math.abs(b.w)).toBeGreaterThan(0.1);
  });
});

describe("uscita dal gioco (R2)", () => {
  it("una pietra che tocca la linea laterale viene rimossa", () => {
    const sim = new Sim(params, [], 0, { x: HALF_WIDTH - STONE_RADIUS - 0.5, y: RELEASE_Y, vx: 0.15, vy: 2.0, w: 0 });
    sim.runToEnd();
    expect(sim.metrics.removals[0]?.reason).toBe("sideline");
    expect(sim.metrics.stop).toBeNull();
  });

  it("una pietra che supera la back line viene rimossa", () => {
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 3.0, w: 0 });
    sim.runToEnd();
    expect(sim.metrics.removals[0]?.reason).toBe("backline");
  });

  it("un tiro corto che non tocca pietre è rimosso alla hog line", () => {
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 1.6, w: 0 });
    sim.runToEnd();
    expect(sim.metrics.removals[0]?.reason).toBe("hog");
  });

  it("una pietra ancora in movimento prima della hog line non viene rimossa", () => {
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 1.9, w: 0 });
    for (let i = 0; i < 3000; i++) sim.step(false);
    expect(sim.done).toBe(false);
    expect(sim.delivered.y - STONE_RADIUS).toBeLessThan(FAR_HOG_INSIDE);
    expect(sim.delivered.inPlay).toBe(true);
    expect(sim.metrics.removals.length).toBe(0);
  });

  it("una pietra ferma a cavallo della hog line viene rimossa a tiro concluso", () => {
    const stopY = FAR_HOG_INSIDE + STONE_RADIUS * 0.5; // il bordo posteriore resta prima della linea
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(params, stopY), w: 0 });
    sim.runToEnd();
    expect(sim.metrics.removals[0]?.reason).toBe("hog");
  });

  it("una pietra ferma appena oltre la hog line resta in gioco", () => {
    const stopY = FAR_HOG_INSIDE + STONE_RADIUS * 1.5;
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(params, stopY), w: 0 });
    sim.runToEnd();
    expect(sim.delivered.inPlay).toBe(true);
  });

  it("un tiro corto che colpisce una pietra resta in gioco", () => {
    const sim = new Sim(params, [{ id: 0, team: 1, x: 0, y: 8 }], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 1.9, w: 0 });
    sim.runToEnd();
    expect(sim.metrics.removals.find((r) => r.id === sim.deliveredId)).toBeUndefined();
    expect(sim.delivered.inPlay).toBe(true);
    expect(sim.delivered.y).toBeLessThan(TEE_Y);
  });
});
