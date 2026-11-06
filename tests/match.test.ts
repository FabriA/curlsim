import { describe, expect, it } from "vitest";
import { applyShot, type EndState } from "../src/core/end";
import { currentRole, endNumber, finishEnd, isExtraEnd, startMatch, sweepersFor, totals, winner, type MatchState } from "../src/core/match";
import { TEE_Y } from "../src/core/geometry";
import type { Team } from "../src/core/physics";

/** Gioca l'end in corso: 16 consegne; alla fine resta in casa una pietra di `scorer` (o nessuna). */
function playEnd(m: MatchState, scorer: Team | null, points = 1): MatchState {
  let e: EndState = m.current;
  for (let i = 0; i < 16; i++) {
    const team = (i % 2 === 0 ? (e.hammer === 0 ? 1 : 0) : e.hammer) as Team;
    const last = i === 15;
    const after = last && scorer !== null ? Array.from({ length: points }, (_, k) => ({ id: 100 + k, team: scorer, x: 0.3 * k, y: TEE_Y })) : [];
    e = applyShot(e, e.stones, after, team).state;
  }
  return finishEnd({ ...m, current: e });
}

describe("partita a più end", () => {
  it("l'hammer passa alla squadra che non ha segnato; dopo un end nullo resta", () => {
    let m = startMatch({ ends: 4, extraEnd: true, end: { fgz: true, fgzStones: 5, noTick: true } }, 1);
    expect(m.current.hammer).toBe(1);
    m = playEnd(m, 1, 2); // segna chi ha l'hammer: l'hammer passa
    expect(m.current.hammer).toBe(0);
    m = playEnd(m, null); // end nullo: resta
    expect(m.current.hammer).toBe(0);
    m = playEnd(m, 1, 1); // ruba la squadra senza hammer: l'hammer resta a chi non ha segnato
    expect(m.current.hammer).toBe(0);
    expect(totals(m)).toEqual([0, 3]);
    expect(endNumber(m)).toBe(4);
  });

  it("finisce dopo gli end previsti se non c'è parità", () => {
    let m = startMatch({ ends: 2, extraEnd: true, end: { fgz: true, fgzStones: 5, noTick: true } }, 1);
    m = playEnd(m, 0, 2);
    m = playEnd(m, 1, 1);
    expect(m.over).toBe(true);
    expect(winner(m)).toBe(0);
  });

  it("in parità si gioca l'extra end, e un altro se anche quello è nullo", () => {
    let m = startMatch({ ends: 2, extraEnd: true, end: { fgz: true, fgzStones: 5, noTick: true } }, 1);
    m = playEnd(m, 0, 1);
    m = playEnd(m, 1, 1);
    expect(m.over).toBe(false);
    expect(isExtraEnd(m)).toBe(true);
    m = playEnd(m, null);
    expect(m.over).toBe(false);
    expect(endNumber(m)).toBe(4);
    m = playEnd(m, 1, 1);
    expect(m.over).toBe(true);
    expect(winner(m)).toBe(1);
  });

  it("senza extra end la parità è un pareggio", () => {
    let m = startMatch({ ends: 1, extraEnd: false, end: { fgz: true, fgzStones: 5, noTick: true } }, 1);
    m = playEnd(m, null);
    expect(m.over).toBe(true);
    expect(winner(m)).toBeNull();
  });

  it("ruoli: pietre 1–2 lead, 3–4 second, 5–6 third, 7–8 skip, per ciascuna squadra", () => {
    let e = startMatch().current;
    const roles: string[] = [];
    for (let i = 0; i < 16; i++) {
      roles.push(currentRole(e));
      const team = (i % 2 === 0 ? (e.hammer === 0 ? 1 : 0) : e.hammer) as Team;
      e = applyShot(e, e.stones, [], team).state;
    }
    expect(roles).toEqual(["lead", "lead", "lead", "lead", "second", "second", "second", "second", "third", "third", "third", "third", "skip", "skip", "skip", "skip"]);
    expect(sweepersFor("lead")).toEqual(["second", "third"]);
    expect(sweepersFor("skip")).toEqual(["lead", "second"]);
  });
});
