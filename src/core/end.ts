/**
 * Regole di un end standard (formato a 4, 8 pietre per squadra).
 * Riferimento: World Curling, The Rules of Curling, 1 settembre 2026 — R5 a (ordine di tiro),
 * R6 (free guard zone), R7 (no-tick), R12 (punteggio). Preset «World Curling 2026 — adattamento v1».
 *
 * Funzioni pure: ricevono le posizioni prima e dopo un tiro e decidono l'esito regolamentare.
 * La fisica non sa nulla di queste regole (vedi rules.ts per le uscite R2).
 */
import { FAR_HOG_INSIDE, HOUSE_RADIUS, STONE_RADIUS, TEE_Y } from "./geometry";
import type { Team } from "./physics";
import type { StonePlacement } from "./sim";

export const STONES_PER_END = 16;
/** Mezza larghezza della linea centrale (R1 b-IV: 13 mm). */
const CENTRE_LINE_HALF = 0.0065;

export interface EndRules {
  /** Free guard zone attiva (R6). */
  fgz: boolean;
  /** Pietre protette: la FGZ vale prima della consegna della pietra numero fgzStones + 1 (R6: 5). */
  fgzStones: number;
  /** No-tick attivo (R7). */
  noTick: boolean;
}

export const WORLD_CURLING_2026: EndRules = { fgz: true, fgzStones: 5, noTick: true };

export interface EndState {
  rules: EndRules;
  /** Squadra con l'ultima pietra dell'end. */
  hammer: Team;
  /** Pietre già consegnate nell'end (0–16). */
  delivered: number;
  stones: StonePlacement[];
  /** Posizioni prima di ogni consegna, per annullare un tiro. */
  history: { stones: StonePlacement[]; delivered: number }[];
  /** Scelta no-tick in attesa della squadra che subisce, o null. */
  pending: PendingNoTick | null;
  /** Punteggio, quando l'end è concluso. */
  score: EndScore | null;
}

export interface PendingNoTick {
  /** Squadra che subisce la violazione e sceglie. */
  chooser: Team;
  /** Posizioni se si lasciano le pietre dove si sono fermate. */
  leave: StonePlacement[];
  /** Posizioni se si rimuove la pietra tirata e si riportano le pietre spostate al loro posto. */
  restore: StonePlacement[];
}

export interface EndScore {
  /** Squadra che segna, o null per un end nullo (blank). */
  team: Team | null;
  points: number;
  /** Pietre che contano, dalla più vicina al tee. */
  counting: number[];
}

export type ShotRuling =
  | { kind: "ok" }
  | { kind: "fgz"; guards: number[] }
  | { kind: "noTick"; guards: number[]; chooser: Team };

export function startEnd(hammer: Team, rules: EndRules = WORLD_CURLING_2026): EndState {
  return { rules: { ...rules }, hammer, delivered: 0, stones: [], history: [], pending: null, score: null };
}

const other = (t: Team): Team => (t === 0 ? 1 : 0);

/** Squadra che consegna la prossima pietra: si alterna, a partire da quella senza hammer. */
export function nextTeam(e: EndState): Team {
  return e.delivered % 2 === 0 ? other(e.hammer) : e.hammer;
}

/** Numero della prossima pietra dell'end (1–16). */
export function nextStoneNumber(e: EndState): number {
  return e.delivered + 1;
}

export function stonesLeft(e: EndState, team: Team): number {
  const thrownByTeam = team === other(e.hammer) ? Math.ceil(e.delivered / 2) : Math.floor(e.delivered / 2);
  return STONES_PER_END / 2 - thrownByTeam;
}

export function isComplete(e: EndState): boolean {
  return e.delivered >= STONES_PER_END && e.pending === null;
}

/** La FGZ protegge ancora le guardie per la prossima pietra? */
export function fgzActive(e: EndState): boolean {
  return e.rules.fgz && e.delivered < e.rules.fgzStones;
}

function distToTee(s: { x: number; y: number }): number {
  return Math.hypot(s.x, s.y - TEE_Y);
}

/** In casa o a contatto con la casa (R12: dal tee al punto più vicino della pietra). */
export function inHouse(s: { x: number; y: number }): boolean {
  return distToTee(s) - STONE_RADIUS <= HOUSE_RADIUS;
}

/** Nella free guard zone: tra la hog line e la tee line di gioco, esclusa la casa (R6 a). */
export function inFGZ(s: { x: number; y: number }): boolean {
  return s.y < TEE_Y && s.y - STONE_RADIUS > FAR_HOG_INSIDE && !inHouse(s);
}

/** Tocca la linea centrale (R7). */
export function touchesCentreLine(s: { x: number }): boolean {
  return Math.abs(s.x) <= STONE_RADIUS + CENTRE_LINE_HALF;
}

/**
 * Decide l'esito regolamentare di un tiro.
 * `before`: pietre in gioco prima della consegna; `after`: pietre in gioco a tiro concluso
 * (compresa la pietra tirata, se è rimasta in gioco); `team`: squadra che ha tirato.
 */
export function ruleShot(e: EndState, before: StonePlacement[], after: StonePlacement[], team: Team): ShotRuling {
  if (!fgzActive(e)) return { kind: "ok" };
  const opp = other(team);
  const afterById = new Map(after.map((s) => [s.id, s]));
  const guards = before.filter((s) => s.team === opp && inFGZ(s));

  // R6 b: una guardia avversaria nella FGZ portata fuori gioco, direttamente o indirettamente.
  const removed = guards.filter((g) => !afterById.has(g.id)).map((g) => g.id);
  if (removed.length) return { kind: "fgz", guards: removed };

  // R7 a: una guardia avversaria nella FGZ che tocca la linea centrale, spostata dalla linea o fuori dalla FGZ.
  if (e.rules.noTick) {
    const ticked = guards
      .filter((g) => touchesCentreLine(g))
      .filter((g) => {
        const a = afterById.get(g.id)!;
        const moved = a.x !== g.x || a.y !== g.y;
        return moved && (!touchesCentreLine(a) || !inFGZ(a));
      })
      .map((g) => g.id);
    if (ticked.length) return { kind: "noTick", guards: ticked, chooser: opp };
  }
  return { kind: "ok" };
}

/**
 * Registra un tiro concluso e applica la regola: con la FGZ la pietra tirata è rimossa e le
 * pietre spostate tornano al loro posto; con il no-tick la scelta passa alla squadra che subisce.
 */
export function applyShot(e: EndState, before: StonePlacement[], after: StonePlacement[], team: Team): { state: EndState; ruling: ShotRuling } {
  const ruling = ruleShot(e, before, after, team);
  const history = [...e.history, { stones: before.map((s) => ({ ...s })), delivered: e.delivered }];
  const delivered = e.delivered + 1;
  const restore = before.map((s) => ({ ...s }));
  let state: EndState;
  if (ruling.kind === "fgz") {
    state = { ...e, history, delivered, stones: restore, pending: null };
  } else if (ruling.kind === "noTick") {
    state = { ...e, history, delivered, stones: after.map((s) => ({ ...s })), pending: { chooser: ruling.chooser, leave: after, restore } };
  } else {
    state = { ...e, history, delivered, stones: after.map((s) => ({ ...s })), pending: null };
  }
  return { state: finishIfComplete(state), ruling };
}

/** Scelta della squadra che subisce un no-tick (R7 a I–II). */
export function resolveNoTick(e: EndState, choice: "leave" | "restore"): EndState {
  if (!e.pending) return e;
  const stones = (choice === "leave" ? e.pending.leave : e.pending.restore).map((s) => ({ ...s }));
  return finishIfComplete({ ...e, stones, pending: null });
}

/** Annulla l'ultima consegna: tornano le posizioni di prima del tiro. */
export function undoShot(e: EndState): EndState {
  const last = e.history[e.history.length - 1];
  if (!last) return e;
  return { ...e, stones: last.stones.map((s) => ({ ...s })), delivered: last.delivered, history: e.history.slice(0, -1), pending: null, score: null };
}

function finishIfComplete(e: EndState): EndState {
  if (e.delivered >= STONES_PER_END && e.pending === null) return { ...e, score: scoreEnd(e.stones) };
  return e;
}

/**
 * Punteggio (R12 b, f): un punto per ogni pietra in casa più vicina al tee di qualsiasi pietra
 * avversaria. Se le due pietre più vicine sono alla stessa distanza, l'end è nullo.
 */
export function scoreEnd(stones: StonePlacement[]): EndScore {
  const inside = stones.filter(inHouse).map((s) => ({ s, d: distToTee(s) })).sort((a, b) => a.d - b.d);
  if (inside.length === 0) return { team: null, points: 0, counting: [] };
  const leader = inside[0].s.team;
  const oppAll = stones.filter((s) => s.team !== leader).map(distToTee);
  const oppBest = oppAll.length ? Math.min(...oppAll) : Infinity;
  if (oppBest === inside[0].d) return { team: null, points: 0, counting: [] };
  const counting = inside.filter((x) => x.s.team === leader && x.d < oppBest).map((x) => x.s.id);
  return { team: leader, points: counting.length, counting };
}

/** Hammer dell'end successivo (R5 a): tira per prima la squadra che ha segnato; end nullo, hammer invariato. */
export function nextHammer(e: EndState): Team {
  if (!e.score || e.score.team === null) return e.hammer;
  return other(e.score.team);
}
