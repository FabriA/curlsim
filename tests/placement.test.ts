import { describe, expect, it } from "vitest";
import { calibrate } from "../src/core/calibrate";
import { BACK_LINE_OUTSIDE, FAR_HOG_INSIDE, HALF_WIDTH, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import {
  addStone,
  checkPlacement,
  hitTest,
  inPlayArea,
  makeScenario,
  moveStone,
  removeStone,
  STONES_PER_TEAM,
  validateScenario,
} from "../src/core/placement";
import { Sim, type StonePlacement } from "../src/core/sim";

const r = STONE_RADIUS;

describe("posizionamento manuale delle pietre", () => {
  it("accetta una pietra in casa e la rifiuta prima della hog line, oltre la back line o sulla linea laterale", () => {
    expect(inPlayArea(0, TEE_Y)).toBe(true);
    expect(inPlayArea(0, FAR_HOG_INSIDE + r * 0.5)).toBe(false);
    expect(inPlayArea(0, FAR_HOG_INSIDE + r * 1.01)).toBe(true);
    expect(inPlayArea(0, BACK_LINE_OUTSIDE + r * 1.01)).toBe(false);
    expect(inPlayArea(HALF_WIDTH - r * 0.9, TEE_Y)).toBe(false);
  });

  it("impedisce le sovrapposizioni ma ammette pietre a contatto", () => {
    const one = addStone([], 0, 0, TEE_Y)!;
    expect(addStone(one, 1, 0, TEE_Y + r)).toBeNull();
    expect(addStone(one, 1, 0, TEE_Y + 2 * r)).not.toBeNull();
  });

  it("limita a 8 le pietre per squadra", () => {
    let stones: StonePlacement[] = [];
    for (let i = 0; i < STONES_PER_TEAM; i++) stones = addStone(stones, 0, -1.6 + i * 0.4, TEE_Y)!;
    expect(stones.length).toBe(8);
    expect(checkPlacement(stones, 0, TEE_Y + 1, null, 0)).toBe("teamFull");
    expect(checkPlacement(stones, 0, TEE_Y + 1, null, 1)).toBe("ok");
  });

  it("sposta una pietra solo in una posizione valida e la toglie", () => {
    const stones = addStone(addStone([], 0, 0, TEE_Y)!, 1, 0.5, TEE_Y)!;
    expect(moveStone(stones, 0, 0.5, TEE_Y)).toBeNull();
    const moved = moveStone(stones, 0, -0.5, TEE_Y - 1)!;
    expect(moved.find((s) => s.id === 0)).toEqual({ id: 0, team: 0, x: -0.5, y: TEE_Y - 1 });
    expect(removeStone(moved, 0).length).toBe(1);
  });

  it("trova la pietra sotto il dito con un piccolo margine", () => {
    const stones = addStone([], 0, 0, TEE_Y)!;
    expect(hitTest(stones, r * 1.1, TEE_Y)?.id).toBe(0);
    expect(hitTest(stones, r * 1.5, TEE_Y)).toBeNull();
  });

  it("uno scenario valido passa per JSON e uno con pietre sovrapposte viene rifiutato", () => {
    const stones = addStone(addStone([], 0, 0, TEE_Y)!, 1, 0.4, TEE_Y - 2)!;
    const sc = JSON.parse(JSON.stringify(makeScenario(stones, 1)));
    expect(validateScenario(sc)).toBe(true);
    sc.stones[1].x = 0.05;
    sc.stones[1].y = TEE_Y;
    expect(validateScenario(sc)).toBe(false);
  });

  it("le pietre posate partecipano agli urti come quelle tirate", () => {
    const params = calibrate(PROFILES.normal);
    const stones = addStone([], 1, 0, TEE_Y)!;
    const sim = new Sim(params, stones, 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 2.6, w: 0 });
    sim.runToEnd();
    expect(sim.world.stones.find((s) => s.id === 0)!.hitStone).toBe(true);
  });
});
