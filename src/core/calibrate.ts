/**
 * Calibrazione del modello sui valori di un profilo di ghiaccio.
 *  - mu si ricava in forma chiusa dal tempo hog-to-hog di un draw al tee;
 *  - curlK si cerca per bisezione simulando lo stesso draw finché la curva
 *    raggiunge il valore richiesto.
 */
import { BASE_PARAMS, G, REF_GUARD_SPEED, SPIN_TURNS, SWEEP_DIR, SWEEP_GAIN, SWEEP_SIDE_SHARE, type IceParams, type IceTargets } from "./params";
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
 * Spostamento laterale (m) di una spazzata da un lato per sweeper che guadagnano `gain` metri con
 * Hard: tra i livelli di SWEEP_DIR in proporzione al guadagno, mai sotto zero.
 */
export function sweepDirTargetForGain(gain: number): number {
  const lo = SWEEP_GAIN.beginner;
  const hi = SWEEP_GAIN.elite;
  const d = SWEEP_DIR.beginner + ((gain - lo) * (SWEEP_DIR.elite - SWEEP_DIR.beginner)) / (hi - lo);
  return Math.max(0, d);
}

/**
 * Coefficiente della spinta laterale (sweepDir) che sposta di `target` metri la guardia di
 * riferimento spazzata da un solo sweeper al 100% dal rilascio all'arresto. Con decelerazione
 * costante a e spinta laterale costante b la pietra si ferma dopo T = v/a; l'attrito agisce anche
 * sulla velocità laterale (è opposto alla velocità), quindi lo spostamento vale b·T²/4.
 * Richiede sweepFriction già impostato.
 */
export function sweepDirFor(params: IceParams, target: number, speed = REF_GUARD_SPEED): number {
  const share = params.sweepSideShare ?? SWEEP_SIDE_SHARE;
  const reduction = (1 - params.sweepFriction) * share;
  if (reduction <= 0 || target <= 0) return 0;
  const a = params.mu * G * (1 - reduction);
  const t = speed / a;
  const b = (4 * target) / (t * t);
  return b / (params.mu * G * reduction);
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

/**
 * Fattori che danno la stessa curva totale alle forme 1/(v+v₀)^n, n = 0,5 · 1 · 1,5 · 2, su un draw al
 * tee (decelerazione costante, traiettoria quasi dritta): la curva vale ∫ v/(v+v₀)^n dv da 0 a V, a
 * meno di costanti. Integrale con Simpson, solo operazioni elementari e radici quadrate.
 */
export function curlNormFor(params: IceParams): number[] {
  const V = speedToStopAt(params, TEE_Y);
  const v0 = params.curlV0;
  const N = 2000;
  const h = V / N;
  const I = [0, 0, 0, 0];
  for (let i = 0; i <= N; i++) {
    const v = i * h;
    const w = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    const u = v + v0;
    const q = Math.sqrt(u);
    I[0] += (w * v) / q;
    I[1] += (w * v) / u;
    I[2] += (w * v) / (u * q);
    I[3] += (w * v) / (u * u);
  }
  return [I[1] / I[0], 1, I[1] / I[2], I[1] / I[3]];
}

export function calibrate(t: IceTargets, base: Partial<IceParams> & typeof BASE_PARAMS = BASE_PARAMS): IceParams {
  const mu = decelerationFor(t.hogToHog) / G;
  const params: IceParams = { ...base, mu, curlK: 0 };
  if (params.spinGain || params.spinCurve) params.spinRef = NORMAL_SPIN_RATIO;
  if (params.spinCurve) params.curlNorm = curlNormFor(params);
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
