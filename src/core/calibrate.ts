/**
 * Calibrazione del modello sui valori di un profilo di ghiaccio.
 *  - mu si ricava in forma chiusa dal tempo hog-to-hog di un draw al tee;
 *  - curlK si cerca per bisezione simulando lo stesso draw finché la curva
 *    raggiunge il valore richiesto.
 */
import { BASE_PARAMS, G, REF_GUARD_SPEED, SPIN_TURNS, type IceParams, type IceTargets } from "./params";
import { FAR_HOG_OUTSIDE, RELEASE_Y, TEE_Y } from "./geometry";
import { Sim } from "./sim";

const D_TOTAL = TEE_Y - RELEASE_Y; // dal rilascio al tee
const D_REST = TEE_Y - FAR_HOG_OUTSIDE; // dalla hog line di gioco al tee

/** Decelerazione che fa fermare al tee un draw con il tempo hog-to-hog dato. */
export function decelerationFor(hogToHog: number): number {
  const s = (Math.sqrt(2 * D_TOTAL) - Math.sqrt(2 * D_REST)) / hogToHog;
  return s * s;
}

/** Velocità di rilascio che porta la pietra, dritta e senza spazzata, a fermarsi a `stopY`. */
export function speedToStopAt(params: IceParams, stopY: number): number {
  const a = params.mu * G;
  const d = Math.max(0, stopY - RELEASE_Y);
  return Math.sqrt(2 * a * d);
}

/** Punto d'arresto previsto (dritto, senza spazzata) per una velocità di rilascio. */
export function stopForSpeed(params: IceParams, speed: number): number {
  return RELEASE_Y + (speed * speed) / (2 * params.mu * G);
}

/**
 * Fattore d'attrito durante la spazzata che fa guadagnare `gain` metri alla guardia di
 * riferimento spazzata dal rilascio all'arresto. Con decelerazione costante la distanza
 * scala come 1/f, quindi f = D / (D + gain), con D la distanza senza spazzata.
 */
export function sweepFrictionForGain(params: IceParams, gain: number, speed = REF_GUARD_SPEED): number {
  const d = (speed * speed) / (2 * params.mu * G);
  return d / (d + Math.max(0, gain));
}

/**
 * Velocità angolare al rilascio (rad/s) che fa compiere `turns` giri a un draw al tee.
 * Nel modello la rotazione cala in proporzione alla velocità, quindi i giri valgono
 * (ω₀ / v₀) · percorso / 2π.
 */
export function spinRateForTurns(params: IceParams, turns: number): number {
  return (2 * Math.PI * turns * speedToStopAt(params, TEE_Y)) / D_TOTAL;
}

/** Curva di un draw al tee con i parametri dati (m), con rotazione normale salvo indicazione. */
export function measureDrawCurl(params: IceParams, spin: 1 | -1 = 1, turns = SPIN_TURNS.normal): number {
  const v = speedToStopAt(params, TEE_Y);
  const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: v, w: spin * spinRateForTurns(params, turns) });
  sim.runToEnd();
  return sim.delivered.x * spin;
}

/** Rapporto ω/v della rotazione normale: dipende solo dalla geometria (giri sul percorso del draw al tee). */
export const NORMAL_SPIN_RATIO = (2 * Math.PI * SPIN_TURNS.normal) / D_TOTAL;

export function calibrate(t: IceTargets, base: Partial<IceParams> & typeof BASE_PARAMS = BASE_PARAMS): IceParams {
  const mu = decelerationFor(t.hogToHog) / G;
  const params: IceParams = { ...base, mu, curlK: 0 };
  if (params.spinGain) params.spinRef = NORMAL_SPIN_RATIO;
  let lo = 0;
  let hi = 0.05;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    params.curlK = mid;
    if (measureDrawCurl(params) < t.curl) lo = mid;
    else hi = mid;
  }
  params.curlK = (lo + hi) / 2;
  return params;
}
