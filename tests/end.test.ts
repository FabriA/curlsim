import { describe, expect, it } from "vitest";
import {
  applyShot,
  fgzActive,
  inFGZ,
  inHouse,
  isComplete,
  nextHammer,
  nextStoneNumber,
  nextTeam,
  resolveNoTick,
  scoreEnd,
  startEnd,
  stonesLeft,
  undoShot,
  type EndState,
} from "../src/core/end";
import { calibrate } from "../src/core/calibrate";
import { HOUSE_RADIUS, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import { Sim, type StonePlacement } from "../src/core/sim";

const r = STONE_RADIUS;
const guardY = TEE_Y - HOUSE_RADIUS - 1.5;
const S = (id: number, team: 0 | 1, x: number, y: number): StonePlacement => ({ id, team, x, y });

/** Simula `n` consegne senza cambiare le pietre, per portare l'end avanti. */
function advance(e: EndState, n: number): EndState {
  for (let i = 0; i < n; i++) e = applyShot(e, e.stones, e.stones, nextTeam(e)).state;
  return e;
}

describe("ordine di tiro e hammer (R5 a)", () => {
  it("tira per prima la squadra senza hammer, poi si alternano fino a 16 pietre", () => {
    let e = startEnd(1);
    const order: number[] = [];
    for (let i = 0; i < 16; i++) {
      order.push(nextTeam(e));
      e = advance(e, 1);
    }
    expect(order).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(isComplete(e)).toBe(true);
  });

  it("conta le pietre rimaste per squadra", () => {
    const e = advance(startEnd(1), 3);
    expect(nextStoneNumber(e)).toBe(4);
    expect(stonesLeft(e, 0)).toBe(6);
    expect(stonesLeft(e, 1)).toBe(7);
  });

  it("chi segna tira per primo nell'end successivo; con un end nullo l'hammer non cambia", () => {
    const e = advance(startEnd(1), 16);
    expect(nextHammer({ ...e, score: { team: 0, points: 1, counting: [] } })).toBe(1);
    expect(nextHammer({ ...e, score: { team: 1, points: 2, counting: [] } })).toBe(0);
    expect(nextHammer({ ...e, score: { team: null, points: 0, counting: [] } })).toBe(1);
  });
});

describe("zone", () => {
  it("riconosce casa (anche a contatto) e free guard zone", () => {
    expect(inHouse({ x: 0, y: TEE_Y })).toBe(true);
    expect(inHouse({ x: HOUSE_RADIUS + r * 0.9, y: TEE_Y })).toBe(true);
    expect(inHouse({ x: HOUSE_RADIUS + r * 1.1, y: TEE_Y })).toBe(false);
    expect(inFGZ({ x: 0, y: guardY })).toBe(true);
    expect(inFGZ({ x: 0, y: TEE_Y - HOUSE_RADIUS })).toBe(false); // tocca la casa
    expect(inFGZ({ x: 2, y: TEE_Y - 0.1 })).toBe(true); // a lato della casa, prima della tee line
  });
});

describe("free guard zone (R6)", () => {
  const guard = S(0, 1, 0.5, guardY);

  it("una guardia avversaria portata fuori gioco nelle prime 5 pietre: pietra tirata rimossa, pietre ripristinate", () => {
    const e = advance(startEnd(1), 2);
    const shooter = S(9, 0, 0.3, TEE_Y);
    const { state, ruling } = applyShot({ ...e, stones: [guard] }, [guard], [shooter], 0);
    expect(ruling.kind).toBe("fgz");
    expect(state.stones).toEqual([guard]);
    expect(state.delivered).toBe(3);
  });

  it("si può bocciare la propria guardia", () => {
    const own = S(0, 0, 0.5, guardY);
    const { ruling } = applyShot(startEnd(1), [own], [], 0);
    expect(ruling.kind).toBe("ok");
  });

  it("dalla sesta pietra la FGZ non protegge più", () => {
    const e = advance(startEnd(1), 5);
    expect(fgzActive(e)).toBe(false);
    expect(applyShot(e, [guard], [], 0).ruling.kind).toBe("ok");
  });

  it("una pietra avversaria in casa non è protetta", () => {
    const house = S(0, 1, 0, TEE_Y);
    expect(applyShot(startEnd(1), [house], [], 0).ruling.kind).toBe("ok");
  });

  it("con la FGZ disattivata nessuna protezione", () => {
    expect(applyShot(startEnd(1, { fgz: false, fgzStones: 5, noTick: true }), [guard], [], 0).ruling.kind).toBe("ok");
  });

  it("il numero di pietre protette è configurabile", () => {
    const e = advance(startEnd(1, { fgz: true, fgzStones: 4, noTick: true }), 4);
    expect(fgzActive(e)).toBe(false);
  });
});

describe("no-tick (R7)", () => {
  const centreGuard = S(0, 1, 0.05, guardY);

  it("una guardia sulla linea centrale spostata dalla linea: sceglie la squadra che subisce", () => {
    const moved = S(0, 1, 0.6, guardY + 0.4);
    const shooter = S(9, 0, -0.2, TEE_Y);
    const { state, ruling } = applyShot(startEnd(1), [centreGuard], [moved, shooter], 0);
    expect(ruling).toEqual({ kind: "noTick", guards: [0], chooser: 1 });
    expect(state.pending?.chooser).toBe(1);
    expect(isComplete(state)).toBe(false);
    expect(resolveNoTick(state, "leave").stones).toEqual([moved, shooter]);
    expect(resolveNoTick(state, "restore").stones).toEqual([centreGuard]);
  });

  it("una guardia spinta lungo la linea centrale, ancora nella FGZ e sulla linea, va bene", () => {
    const pushed = S(0, 1, 0.08, guardY + 0.5);
    expect(applyShot(startEnd(1), [centreGuard], [pushed], 0).ruling.kind).toBe("ok");
  });

  it("una guardia sulla linea centrale portata fuori gioco: si applica la FGZ (R7 b)", () => {
    expect(applyShot(startEnd(1), [centreGuard], [], 0).ruling.kind).toBe("fgz");
  });

  it("con il no-tick disattivato la guardia spostata dalla linea non conta", () => {
    const moved = S(0, 1, 0.6, guardY + 0.4);
    const e = startEnd(1, { fgz: true, fgzStones: 5, noTick: false });
    expect(applyShot(e, [centreGuard], [moved], 0).ruling.kind).toBe("ok");
  });
});

describe("annulla e punteggio (R12)", () => {
  it("annulla l'ultimo tiro e torna alle posizioni di prima", () => {
    const a = S(0, 0, 0, TEE_Y);
    let e = applyShot(startEnd(1), [], [a], 0).state;
    e = applyShot(e, [a], [], 1).state;
    e = undoShot(e);
    expect(e.stones).toEqual([a]);
    expect(e.delivered).toBe(1);
    expect(nextTeam(e)).toBe(1);
  });

  it("segna la squadra più vicina, un punto per pietra più vicina di ogni avversaria", () => {
    const score = scoreEnd([S(0, 0, 0, TEE_Y + 0.1), S(1, 0, 0.5, TEE_Y), S(2, 1, -1.0, TEE_Y), S(3, 0, 1.5, TEE_Y)]);
    expect(score).toEqual({ team: 0, points: 2, counting: [0, 1] });
  });

  it("le pietre avversarie fuori casa non riducono il punteggio se più lontane", () => {
    expect(scoreEnd([S(0, 1, 0, TEE_Y), S(1, 1, 0.8, TEE_Y), S(2, 0, 0, TEE_Y - 3)]).points).toBe(2);
  });

  it("nessuna pietra in casa: end nullo", () => {
    expect(scoreEnd([S(0, 0, 0, TEE_Y - 3)])).toEqual({ team: null, points: 0, counting: [] });
  });

  it("alla sedicesima pietra l'end si chiude con il punteggio", () => {
    let e = advance(startEnd(1), 15);
    const stones = [S(0, 1, 0, TEE_Y)];
    e = applyShot(e, e.stones, stones, nextTeam(e)).state;
    expect(e.score).toEqual({ team: 1, points: 1, counting: [0] });
  });
});

describe("con la fisica vera", () => {
  it("un peel della guardia avversaria come terza pietra viene annullato dalla FGZ", () => {
    const params = calibrate(PROFILES.normal);
    const guard = S(0, 1, 0, guardY);
    const e = advance({ ...startEnd(1), stones: [guard] }, 2);
    const sim = new Sim(params, e.stones, 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 3.6, w: 0 });
    sim.runToEnd();
    const after = sim.placements();
    expect(after.find((s) => s.id === 0)).toBeUndefined(); // la guardia è uscita
    const { state, ruling } = applyShot(e, e.stones, after, 0);
    expect(ruling.kind).toBe("fgz");
    expect(state.stones).toEqual([guard]);
  });
});
