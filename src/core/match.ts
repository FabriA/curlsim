/**
 * Partita a più end (formato a 4). Riferimento: World Curling, The Rules of Curling,
 * 1 settembre 2026 — R5 a (ultima pietra), R12 (punteggio ed extra end).
 *
 * Funzioni pure sopra core/end.ts: una partita è una serie di end conclusi più l'end in corso.
 * Abilità dei giocatori: chi tira e chi spazza dipendono dal numero della pietra della squadra.
 */
import { nextHammer, nextTeam, startEnd, STONES_PER_END, WORLD_CURLING_2026, type EndRules, type EndScore, type EndState } from "./end";
import type { Team } from "./physics";
import type { ShotLevel, SkillLevel } from "./params";

export interface MatchRules {
  /** End regolari della partita (R12: di solito 8 o 10). */
  ends: number;
  /** Extra end in caso di parità alla fine degli end regolari. */
  extraEnd: boolean;
  end: EndRules;
}

export const DEFAULT_MATCH_RULES: MatchRules = { ends: 8, extraEnd: true, end: WORLD_CURLING_2026 };

export interface PlayedEnd {
  hammer: Team;
  score: EndScore;
}

export interface MatchState {
  rules: MatchRules;
  firstHammer: Team;
  /** End già conclusi, in ordine. */
  played: PlayedEnd[];
  /** End in corso; quando la partita è finita resta l'ultimo end giocato. */
  current: EndState;
  over: boolean;
}

export function startMatch(rules: MatchRules = DEFAULT_MATCH_RULES, firstHammer: Team = 1): MatchState {
  const r = { ...rules, end: { ...rules.end } };
  return { rules: r, firstHammer, played: [], current: startEnd(firstHammer, r.end), over: false };
}

/** Numero dell'end in corso (1, 2, …); gli extra end continuano la numerazione. */
export function endNumber(m: MatchState): number {
  return m.over ? m.played.length : m.played.length + 1;
}

export function isExtraEnd(m: MatchState, n = endNumber(m)): boolean {
  return n > m.rules.ends;
}

export function totals(m: MatchState): [number, number] {
  const t: [number, number] = [0, 0];
  for (const e of m.played) if (e.score.team !== null) t[e.score.team] += e.score.points;
  return t;
}

/** Squadra che vince, null per un pareggio (senza extra end) o se la partita non è finita. */
export function winner(m: MatchState): Team | null {
  if (!m.over) return null;
  const [a, b] = totals(m);
  return a === b ? null : a > b ? 0 : 1;
}

/**
 * Chiude l'end in corso, che deve avere il punteggio, e prepara il successivo: l'hammer segue
 * R5 a. Dopo gli end regolari la partita finisce, salvo parità con l'extra end attivo; un extra
 * end che si chiude in parità (end nullo) ne richiede un altro.
 */
export function finishEnd(m: MatchState): MatchState {
  const e = m.current;
  if (m.over || !e.score) return m;
  const played = [...m.played, { hammer: e.hammer, score: e.score }];
  const done = { ...m, played };
  const [a, b] = totals(done);
  if (played.length >= m.rules.ends && (a !== b || !m.rules.extraEnd)) return { ...done, over: true };
  return { ...done, current: startEnd(nextHammer(e), m.rules.end) };
}

// ——— Giocatori ———

/** Ruoli nel formato a 4: ognuno tira due pietre, in quest'ordine. */
export const ROLES = ["lead", "second", "third", "skip"] as const;
export type Role = (typeof ROLES)[number];

export interface PlayerSkill {
  shot: ShotLevel;
  sweep: SkillLevel;
}

export type TeamSkills = Record<Role, PlayerSkill>;

export const DEFAULT_PLAYER: PlayerSkill = { shot: "perfect", sweep: "club" };

export function uniformTeam(p: PlayerSkill = DEFAULT_PLAYER): TeamSkills {
  return { lead: { ...p }, second: { ...p }, third: { ...p }, skip: { ...p } };
}

/** Pietre già tirate dalla squadra in questo end. */
function thrownBy(e: EndState, team: Team): number {
  const firstTeam: Team = e.hammer === 0 ? 1 : 0;
  return team === firstTeam ? Math.ceil(e.delivered / 2) : Math.floor(e.delivered / 2);
}

/** Chi tira la prossima pietra della squadra di turno: pietre 1–2 lead, 3–4 second, 5–6 third, 7–8 skip. */
export function currentRole(e: EndState): Role {
  const k = Math.min(thrownBy(e, nextTeam(e)), STONES_PER_END / 2 - 1);
  return ROLES[Math.floor(k / 2)];
}

/**
 * Chi spazza: i due compagni che non tirano e non tengono la scopa in casa. Quando tirano lead,
 * second o third la scopa la tiene lo skip; quando tira lo skip la tiene il third.
 */
export function sweepersFor(role: Role): [Role, Role] {
  switch (role) {
    case "lead":
      return ["second", "third"];
    case "second":
      return ["lead", "third"];
    case "third":
      return ["lead", "second"];
    case "skip":
      return ["lead", "second"];
  }
}
