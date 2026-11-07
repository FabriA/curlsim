import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt } from "../src/core/calibrate";
import { FAR_HOG_INSIDE, HALF_WIDTH, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../src/core/geometry";
import { COLLISIONS, collisionLevelOf, PROFILES } from "../src/core/params";
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

describe("vivacità degli urti", () => {
  /** Distanza percorsa da ogni pietra: tirata (id 0) contro le pietre in `layout`. */
  function travel(p: typeof params, layout: [number, number][], v = 2.5): number[] {
    const st = [createStone(0, 0, 0, 0), ...layout.map(([x, y], i) => createStone(i + 1, 1, x, y))];
    st[0].vy = v;
    st[0].moving = true;
    const start = st.map((s) => [s.x, s.y]);
    const w: World = { params: p, stones: st, tick: 0, deliveredId: 0 };
    runUntil(w, 60000);
    return st.map((s, i) => Math.hypot(s.x - start[i][0], s.y - start[i][1]));
  }
  const lively = { ...params, ...COLLISIONS.lively };
  const normal = { ...params, ...COLLISIONS.normal };
  const chain: [number, number][] = [[0, 1], [0, 1 + 2 * STONE_RADIUS]];

  it("«vivaci» riproduce esattamente gli urti fino alla 0.2.2 (senza restituzione secondaria)", () => {
    const legacy = { ...params, restitution: 0.9 };
    delete (legacy as { restitutionSecondary?: number }).restitutionSecondary;
    expect(travel(lively, chain)).toEqual(travel(legacy, chain));
  });

  it("«normali»: fila di tre pietre in freeze colpita in pieno, esce solo l'ultima e le altre restano quasi ferme", () => {
    // Pietre allineate sulla linea centrale, a 1 cm l'una dall'altra; la tirata arriva dritta a 2,2 m/s.
    const freeze: [number, number][] = [[0, 1], [0, 1 + 2 * STONE_RADIUS + 0.01], [0, 1 + 4 * STONE_RADIUS + 0.02]];
    const [shooter, first, middle, last] = travel(normal, freeze, 2.2);
    expect(first).toBeLessThan(0.05);
    expect(middle).toBeLessThan(0.05);
    expect(shooter - (1 - 2 * STONE_RADIUS)).toBeLessThan(0.05); // dopo il contatto la tirata si ferma quasi sul posto
    expect(last).toBeGreaterThan(10);
    // Con «vivaci» le pietre intermedie si muovono di più.
    const v = travel(lively, freeze, 2.2);
    expect(v[1] + v[2]).toBeGreaterThan(first + middle);
  });

  it("la restituzione della pietra tirata vale solo per gli urti in cui c'è lei", () => {
    // Senza pietra tirata dichiarata ogni urto è secondario.
    const a = createStone(5, 0, 0, 0);
    const b = createStone(6, 1, 0, 1);
    a.vy = 2;
    a.moving = true;
    const w: World = { params: { ...noFriction, restitution: 0.9, restitutionSecondary: 0.5 }, stones: [a, b], tick: 0 };
    runUntil(w, 1000);
    expect(b.vy).toBeCloseTo(1.5, 6); // (1 + 0,5) / 2 · 2
  });
});

describe("riconoscimento dell'impostazione degli urti", () => {
  it("riconosce Normali, Vivaci e i replay fino alla 0.2.2", () => {
    expect(collisionLevelOf(COLLISIONS.normal)).toBe("normal");
    expect(collisionLevelOf(COLLISIONS.soft)).toBe("soft");
    expect(collisionLevelOf({ restitution: 0.95, restitutionSecondary: 0.97 })).toBe("normal");
    expect(collisionLevelOf(COLLISIONS.lively)).toBe("lively");
    expect(collisionLevelOf({ restitution: 0.9 })).toBe("lively");
    expect(collisionLevelOf({ restitution: 0.85, restitutionSecondary: 0.6 })).toBeNull();
  });
});

describe("urti lenti smorzati", () => {
  const soft = { ...noFriction, ...COLLISIONS.soft };
  const normal = { ...noFriction, ...COLLISIONS.normal };
  function hit(p: typeof params, v: number): number {
    const a = createStone(0, 0, 0, 0);
    const b = createStone(1, 1, 0, 1);
    a.vy = v;
    a.moving = true;
    const w: World = { params: p, stones: [a, b], tick: 0, deliveredId: 0 };
    runUntil(w, 5000);
    return b.vy;
  }

  it("urto lento: la pietra colpita parte più piano (restituzione 0,55 fino a 0,4 m/s)", () => {
    expect(hit(soft, 0.25)).toBeCloseTo((0.25 * 1.55) / 2, 6);
    // A 0,5 m/s la strada della colpita (∝ v²) cala di circa un terzo.
    const r = (hit(soft, 0.5) / hit(normal, 0.5)) ** 2;
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeLessThan(0.75);
  });

  it("urto veloce: nessuna differenza da 1,1 m/s in su", () => {
    expect(hit(soft, 1.1)).toBe(hit(normal, 1.1));
    expect(hit(soft, 3)).toBe(hit(normal, 3));
  });

  it("fila di tre pietre in freeze colpita in pieno: esce solo l'ultima, come con «Normali»", () => {
    const freeze: [number, number][] = [[0, 1], [0, 1 + 2 * STONE_RADIUS + 0.01], [0, 1 + 4 * STONE_RADIUS + 0.02]];
    const st = [createStone(0, 0, 0, 0), ...freeze.map(([x, y], i) => createStone(i + 1, 1, x, y))];
    st[0].vy = 2.2;
    st[0].moving = true;
    const start = st.map((s) => [s.x, s.y]);
    runUntil({ params: { ...params, ...COLLISIONS.soft }, stones: st, tick: 0, deliveredId: 0 }, 60000);
    const [shooter, first, middle, last] = st.map((s, i) => Math.hypot(s.x - start[i][0], s.y - start[i][1]));
    expect(first).toBeLessThan(0.05);
    expect(middle).toBeLessThan(0.05);
    expect(shooter - (1 - 2 * STONE_RADIUS)).toBeLessThan(0.05);
    expect(last).toBeGreaterThan(10);
  });
});
