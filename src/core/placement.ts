/**
 * Posizionamento manuale delle pietre e scenari salvabili.
 * Funzioni pure, senza interfaccia: le usano il laboratorio e la futura modalità di allenamento.
 *
 * Una pietra posata è valida se si trova in gioco secondo R2 (oltre la hog line di gioco,
 * non oltre la back line, senza toccare le linee laterali) e non si sovrappone ad altre pietre.
 */
import { BACK_LINE_OUTSIDE, FAR_HOG_INSIDE, HALF_WIDTH, STONE_RADIUS } from "./geometry";
import type { Team } from "./physics";
import type { StonePlacement } from "./sim";

/** Pietre per squadra in un end del formato a 4 (R2 b, R3 a). */
export const STONES_PER_TEAM = 8;

export type PlacementCheck = "ok" | "outside" | "overlap" | "teamFull";

export interface Scenario {
  format: "curling-scenario";
  version: 1;
  stones: StonePlacement[];
  /** Squadra che tira la prossima pietra. */
  nextTeam: Team;
  /** Descrizione libera, utile per gli scenari di allenamento. */
  note?: string;
}

/** La posizione è in gioco secondo R2 f–h? */
export function inPlayArea(x: number, y: number): boolean {
  return (
    y - STONE_RADIUS > FAR_HOG_INSIDE &&
    y - STONE_RADIUS <= BACK_LINE_OUTSIDE &&
    x + STONE_RADIUS < HALF_WIDTH &&
    x - STONE_RADIUS > -HALF_WIDTH
  );
}

/** La pietra in (x, y) si sovrappone a un'altra? `ignoreId` esclude la pietra trascinata. */
export function overlaps(stones: StonePlacement[], x: number, y: number, ignoreId: number | null = null): boolean {
  const min2 = (2 * STONE_RADIUS) ** 2;
  return stones.some((s) => s.id !== ignoreId && (s.x - x) ** 2 + (s.y - y) ** 2 < min2 - 1e-12);
}

export function teamCount(stones: StonePlacement[], team: Team): number {
  return stones.filter((s) => s.team === team).length;
}

/** Verifica una posizione per una pietra nuova (id null) o già posata. */
export function checkPlacement(stones: StonePlacement[], x: number, y: number, id: number | null, team: Team): PlacementCheck {
  if (id === null && teamCount(stones, team) >= STONES_PER_TEAM) return "teamFull";
  if (!inPlayArea(x, y)) return "outside";
  if (overlaps(stones, x, y, id)) return "overlap";
  return "ok";
}

export function nextId(stones: StonePlacement[]): number {
  return stones.reduce((m, s) => Math.max(m, s.id), -1) + 1;
}

/** Aggiunge una pietra se la posizione è valida; restituisce il nuovo elenco o null. */
export function addStone(stones: StonePlacement[], team: Team, x: number, y: number): StonePlacement[] | null {
  if (checkPlacement(stones, x, y, null, team) !== "ok") return null;
  return [...stones, { id: nextId(stones), team, x, y }];
}

/** Sposta una pietra se la nuova posizione è valida; restituisce il nuovo elenco o null. */
export function moveStone(stones: StonePlacement[], id: number, x: number, y: number): StonePlacement[] | null {
  const s = stones.find((p) => p.id === id);
  if (!s || checkPlacement(stones, x, y, id, s.team) !== "ok") return null;
  return stones.map((p) => (p.id === id ? { ...p, x, y } : p));
}

export function removeStone(stones: StonePlacement[], id: number): StonePlacement[] {
  return stones.filter((p) => p.id !== id);
}

/** Pietra sotto il punto indicato (con un margine per il tocco), la più vicina. */
export function hitTest(stones: StonePlacement[], x: number, y: number, margin = 1.25): StonePlacement | null {
  const r2 = (STONE_RADIUS * margin) ** 2;
  let best: StonePlacement | null = null;
  let bestD = Infinity;
  for (const s of stones) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d <= r2 && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function makeScenario(stones: StonePlacement[], nextTeam: Team, note?: string): Scenario {
  return { format: "curling-scenario", version: 1, stones: stones.map((s) => ({ ...s })), nextTeam, ...(note ? { note } : {}) };
}

/** Controlla forma e validità di uno scenario (posizioni in gioco, senza sovrapposizioni, al massimo 8 per squadra). */
export function validateScenario(x: unknown): x is Scenario {
  const s = x as Scenario;
  if (!s || s.format !== "curling-scenario" || s.version !== 1 || !Array.isArray(s.stones)) return false;
  if (s.nextTeam !== 0 && s.nextTeam !== 1) return false;
  const ids = new Set<number>();
  for (const p of s.stones) {
    if (typeof p.x !== "number" || typeof p.y !== "number" || (p.team !== 0 && p.team !== 1) || !Number.isInteger(p.id)) return false;
    if (ids.has(p.id)) return false;
    ids.add(p.id);
    if (!inPlayArea(p.x, p.y) || overlaps(s.stones, p.x, p.y, p.id)) return false;
  }
  return teamCount(s.stones, 0) <= STONES_PER_TEAM && teamCount(s.stones, 1) <= STONES_PER_TEAM;
}
