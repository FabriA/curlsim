/**
 * Parametri del motore fisico e profili di ghiaccio.
 *
 * Modello empirico v1: decelerazione costante (attrito di Coulomb) e deriva laterale
 * che cresce al diminuire della velocità. I valori di riferimento sono valori tipici
 * di gioco e vanno sostituiti con misure reali quando saranno disponibili.
 */

/** Versione del motore: entra in ogni replay. Cambiarla quando cambia il comportamento fisico. */
export const ENGINE_VERSION = "0.1.0";

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
  sweepFriction: 0.88,
  sweepCurl: 0.85,
  restitution: 0.9,
  stoneFriction: 0.2,
  inertiaK: 0.5,
};

/** Rotazione tipica al rilascio (rad/s): circa 2–3 giri su un draw. */
export const DEFAULT_SPIN_RATE = 1.2;
