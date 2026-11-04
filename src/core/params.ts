/**
 * Parametri del motore fisico e profili di ghiaccio.
 *
 * Modello empirico v1: decelerazione costante (attrito di Coulomb) e deriva laterale
 * che cresce al diminuire della velocità. I valori di riferimento sono valori tipici
 * di gioco e vanno sostituiti con misure reali quando saranno disponibili.
 */

/** Versione dell'applicazione (allineata a package.json). */
export const APP_VERSION = "0.2.1";

/** Versione del motore: entra in ogni replay. Cambiarla quando cambia il comportamento fisico. */
export const ENGINE_VERSION = "0.2.0";

/** Passo temporale fisso (s). */
export const DT = 0.001;
/** Accelerazione di gravità (m/s²). */
export const G = 9.81;
/** Durata massima di un tiro (tick), per sicurezza. */
export const MAX_TICKS = 90_000;

export interface IceParams {
  /** Coefficiente d'attrito pietra-ghiaccio. */
  mu: number;
  /** Intensità della deriva laterale (m/s² · √(m/s)). */
  curlK: number;
  /** Velocità di regolarizzazione della deriva a bassa velocità (m/s). */
  curlV0: number;
  /** Rapporto rotazione/velocità sotto il quale la curva si riduce ((rad/s)/(m/s)). */
  spinRatioRef: number;
  /** Fattore sull'attrito durante la spazzata (< 1). */
  sweepFriction: number;
  /** Fattore sulla deriva durante la spazzata (< 1). */
  sweepCurl: number;
  /** Coefficiente di restituzione negli urti tra pietre. */
  restitution: number;
  /** Attrito tra le pietre al contatto. */
  stoneFriction: number;
  /** Momento d'inerzia come frazione di m·r². */
  inertiaK: number;
}

/** Valori misurabili di un profilo di ghiaccio, da cui si ricavano mu e curlK. */
export interface IceTargets {
  /** Tempo hog-to-hog di un draw al tee (s). Più alto = ghiaccio più veloce. */
  hogToHog: number;
  /** Curva totale di un draw al tee con rotazione normale (m). */
  curl: number;
}

export type ProfileId = "straight" | "normal" | "swingy";

export const PROFILES: Record<ProfileId, IceTargets> = {
  straight: { hogToHog: 14.5, curl: 0.6 },
  normal: { hogToHog: 14.5, curl: 1.2 },
  swingy: { hogToHog: 14.5, curl: 1.8 },
};

export const BASE_PARAMS: Omit<IceParams, "mu" | "curlK"> = {
  curlV0: 0.1,
  spinRatioRef: 0.1,
  sweepFriction: 0.92,
  sweepCurl: 0.85,
  restitution: 0.9,
  stoneFriction: 0.2,
  inertiaK: 0.5,
};

/** Livelli di abilità usati per sweeper e tiratori. */
export type SkillLevel = "beginner" | "club" | "elite";

/** Velocità di rilascio della guardia di riferimento per misurare l'effetto della spazzata (m/s). */
export const REF_GUARD_SPEED = 1.9;

/**
 * Metri guadagnati spazzando dal rilascio all'arresto la guardia di riferimento (1,9 m/s),
 * per livello degli sweeper. Intervalli indicati: principianti 1,0–1,7; club 1,8–2,5; élite 2,6–3,1.
 * Il fattore d'attrito durante la spazzata si ricava con sweepFrictionForGain (calibrate.ts),
 * così il guadagno resta lo stesso su ogni profilo di ghiaccio.
 */
export const SWEEP_GAIN: Record<SkillLevel, number> = { beginner: 1.35, club: 2.15, elite: 2.85 };
export const SWEEP_GAIN_RANGE: Record<SkillLevel, [number, number]> = { beginner: [1.0, 1.7], club: [1.8, 2.5], elite: [2.6, 3.1] };

/**
 * Precisione del tiratore per livello («perfetto» = nessun errore, il predefinito del laboratorio): deviazione standard dell'errore di linea alla scopa (m)
 * e dell'errore di peso (frazione della velocità di rilascio). Valori proposti, da affinare con i test di gioco.
 * Con un errore di peso dell'1% la distanza d'arresto di un draw varia di circa il 2% (circa 55 cm).
 */
export type ShotLevel = "perfect" | SkillLevel;

export const SHOT_PRECISION: Record<ShotLevel, { lineSigma: number; weightSigma: number }> = {
  perfect: { lineSigma: 0, weightSigma: 0 },
  beginner: { lineSigma: 0.4, weightSigma: 0.05 },
  club: { lineSigma: 0.2, weightSigma: 0.024 },
  elite: { lineSigma: 0.08, weightSigma: 0.008 },
};

export type SpinLevel = "low" | "normal" | "high";

/**
 * Giri compiuti dal rilascio all'arresto su un draw al tee, per livello di rotazione:
 * bassa 1–2, normale 3–4, alta 5–8. La velocità angolare al rilascio si ricava con
 * spinRateForTurns (calibrate.ts).
 */
export const SPIN_TURNS: Record<SpinLevel, number> = { low: 1.5, normal: 3.5, high: 6.5 };
