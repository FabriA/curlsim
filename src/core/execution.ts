/**
 * Errore di esecuzione del tiratore: quanto la pietra rilasciata si discosta dal tiro voluto.
 * Si ricava dal replay (tiro voluto e rilascio effettivo), quindi vale anche per i replay caricati.
 */
import { stopForSpeed } from "./calibrate";
import { TAKEOUT_SPEED } from "./params";
import type { Replay } from "./sim";

export interface ExecutionError {
  /** Punto in cui la linea effettiva passa all'altezza del mirino (m). */
  aimX: number;
  aimY: number;
  /** Errore di linea al mirino (m): positivo a destra, negativo a sinistra. */
  line: number;
  /** Velocità di rilascio effettiva e voluta (m/s). */
  speed: number;
  intendedSpeed: number;
  /** Per i tiri sotto il peso da bocciata: differenza d'arresto su un tiro dritto (m), positiva = lungo. */
  length: number | null;
}

/** Il tiratore ha un'abilità diversa da «Perfetto»: c'è un errore da mostrare. */
export function hasExecutionNoise(r: Pick<Replay, "skill">): boolean {
  const s = r.skill;
  return (s.lineSigma ?? 0) > 0 || (s.lineSigmaTakeout ?? 0) > 0 || (s.weightSigma ?? 0) > 0 || !!s.stopNoise?.sigma.some((x) => x > 0);
}

export function executionError(r: Pick<Replay, "shot" | "release" | "params">): ExecutionError {
  const rel = r.release;
  const shot = r.shot;
  const aimX = rel.x + ((shot.broomY - rel.y) * rel.vx) / rel.vy;
  const speed = Math.sqrt(rel.vx * rel.vx + rel.vy * rel.vy);
  const length = shot.speed < TAKEOUT_SPEED ? stopForSpeed(r.params, speed) - stopForSpeed(r.params, shot.speed) : null;
  return { aimX, aimY: shot.broomY, line: aimX - shot.broomX, speed, intendedSpeed: shot.speed, length };
}
