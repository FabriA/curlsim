/**
 * Replay di riferimento per verificare il determinismo tra ambienti.
 * Il tiro colpisce una catena di pietre con un tratto di spazzata, così esercita
 * moto, curva, urti multipli, rotazione e regole di uscita.
 * REFERENCE_HASH è calcolato in Node (npm test): il laboratorio lo ricalcola nel browser.
 */
import { BASE_PARAMS, ENGINE_VERSION } from "./params";
import { computeRelease, type Replay } from "./sim";
import { TEE_Y } from "./geometry";

export const REFERENCE_HASH = "97156709";

export function referenceReplay(): Replay {
  const params = { ...BASE_PARAMS, mu: 0.0074, curlK: 0.007 };
  const shot = { broomX: 0.25, broomY: TEE_Y, speed: 2.9, spin: -1 as const, spinRate: 1.2 };
  const skill = { lineSigma: 0.05, weightSigma: 0.02 };
  const seed = 20261103;
  return {
    format: "curling-replay",
    version: 1,
    engineVersion: ENGINE_VERSION,
    params,
    team: 0,
    stonesBefore: [
      { id: 0, team: 1, x: 0.05, y: TEE_Y - 0.3 },
      { id: 1, team: 1, x: 0.1, y: TEE_Y + 0.0 },
      { id: 2, team: 0, x: -0.6, y: TEE_Y + 0.9 },
      { id: 3, team: 1, x: 0.4, y: TEE_Y - 3.5 },
    ],
    shot,
    skill,
    seed,
    release: computeRelease(shot, skill, seed),
    sweep: [[2000, 6000]],
  };
}
