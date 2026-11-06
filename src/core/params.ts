/**
 * Parametri del motore fisico e profili di ghiaccio.
 *
 * Modello empirico v1: decelerazione costante (attrito di Coulomb) e deriva laterale
 * che cresce al diminuire della velocità. I valori di riferimento sono valori tipici
 * di gioco e vanno sostituiti con misure reali quando saranno disponibili.
 */

/** Versione dell'applicazione (allineata a package.json). */
export const APP_VERSION = "0.3.1";

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
  /**
   * Come la deriva cresce quando la pietra rallenta: 0,5 = come 1/√v (fino alla 0.3.1),
   * 1 = come 1/v, 1,5 = come 1/v^1,5: concentrano la curva nel finale. Se manca vale 0,5.
   */
  curlExp?: 0.5 | 1 | 1.5;
  /**
   * Effetto dei giri sulla curva: 0 = nessuno (fino alla 0.3.1); con g la curva si moltiplica per
   * 1 + g·(ω/v ÷ spinRef − 1), cioè cresce con i giri rispetto alla rotazione normale.
   */
  spinGain?: number;
  /** Rapporto ω/v della rotazione normale (3,5 giri su un draw al tee), riferimento di spinGain. */
  spinRef?: number;
  /** Fattore sull'attrito durante la spazzata (< 1). */
  sweepFriction: number;
  /** Fattore sulla deriva durante la spazzata (< 1). */
  sweepCurl: number;
  /** Coefficiente di restituzione negli urti in cui una delle due pietre è quella tirata. */
  restitution: number;
  /**
   * Coefficiente di restituzione negli urti tra due pietre che non sono quella tirata (pietre
   * colpite che ne colpiscono altre). Se manca vale `restitution`, come nei replay precedenti.
   */
  restitutionSecondary?: number;
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

/** Forma della curva del draw. */
export type CurveLevel = "classic" | "late" | "later";

/**
 * «Classica» è il modello fino alla 0.3.1. «Finale più netto», dai giudizi dei tester (curva che
 * inizia troppo presto e si chiude troppo dolce, più curva con molti giri): deriva come 1/v
 * («netta») o 1/v^1,5 («molto netta») e curva che cresce con i giri. La curva totale del draw di
 * riferimento con rotazione normale resta quella del profilo.
 */
export const CURVES: Record<CurveLevel, Pick<IceParams, "curlExp" | "spinGain">> = {
  classic: { curlExp: 0.5, spinGain: 0 },
  late: { curlExp: 1, spinGain: 0.2 },
  later: { curlExp: 1.5, spinGain: 0.2 },
};

/** Forma della curva che corrisponde ai valori di un replay; senza curlExp è la classica. */
export function curveLevelOf(p: Pick<IceParams, "curlExp">): CurveLevel {
  return p.curlExp === 1.5 ? "later" : p.curlExp === 1 ? "late" : "classic";
}

/** Vivacità degli urti tra pietre: quanta energia passa da una pietra all'altra. */
export type CollisionLevel = "normal" | "lively";

/**
 * «Vivaci» sono i valori fino alla versione 0.2.2. «Normali» rendono gli urti quasi elastici, come le
 * pietre di granito: in una fila di pietre in freeze colpita in pieno la quantità di moto passa
 * lungo la fila (come nel pendolo di Newton), esce solo l'ultima e le altre si spostano di pochi
 * centimetri; nel colpo pieno la pietra tirata si ferma quasi sul posto.
 * (Una prima versione di «Normali», 0,85 / 0,6, faceva l'opposto e fu ritirata.)
 */
export const COLLISIONS: Record<CollisionLevel, Pick<IceParams, "restitution" | "restitutionSecondary">> = {
  normal: { restitution: 0.95, restitutionSecondary: 0.97 },
  lively: { restitution: 0.9, restitutionSecondary: 0.9 },
};

/**
 * Impostazione degli urti che corrisponde ai valori di un replay, oppure null se i valori sono
 * altri. Senza `restitutionSecondary` (replay fino alla 0.2.2) vale `restitution`.
 */
export function collisionLevelOf(p: Pick<IceParams, "restitution" | "restitutionSecondary">): CollisionLevel | null {
  const e2 = p.restitutionSecondary ?? p.restitution;
  for (const k of Object.keys(COLLISIONS) as CollisionLevel[]) {
    const c = COLLISIONS[k];
    if (c.restitution === p.restitution && (c.restitutionSecondary ?? c.restitution) === e2) return k;
  }
  return null;
}

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

/** Velocità di rilascio da cui un tiro è un colpo (bocciata) e non un tiro a peso da draw (m/s). */
export const TAKEOUT_SPEED = 2.6;

/**
 * Forma della dispersione del peso, da Brunner (2024, Università di Berna): l'errore sulla distanza
 * d'arresto è una miscela di gaussiane. Nel 30% dei tiri σ è un terzo del valore tipico, nel 63% è il
 * valore tipico, nel 7% (errori grossi) è 10/3 del valore tipico. Per l'élite il valore tipico è 30 cm.
 */
export const STOP_MIXTURE = { p: [0.3, 0.63, 0.07], factor: [1 / 3, 1, 10 / 3] } as const;

export interface Precision {
  /** Errore di linea alla scopa nei tiri a peso da draw (σ, m). */
  lineDraw: number;
  /** Errore di linea alla scopa nelle bocciate (σ, m). */
  lineTakeout: number;
  /** Errore tipico sulla distanza d'arresto (σ della componente principale, m). */
  stopTypical: number;
}

export type ShotLevel = "perfect" | SkillLevel;

/**
 * Precisione del tiratore per livello. L'élite riprende i valori di Brunner (2024): linea 10 cm nei draw
 * e 5 cm nelle bocciate, peso con valore tipico 30 cm. Club e principiante sono proposte da affinare.
 */
export const SHOT_PRECISION: Record<ShotLevel, Precision> = {
  perfect: { lineDraw: 0, lineTakeout: 0, stopTypical: 0 },
  beginner: { lineDraw: 0.35, lineTakeout: 0.18, stopTypical: 1.05 },
  club: { lineDraw: 0.2, lineTakeout: 0.1, stopTypical: 0.6 },
  elite: { lineDraw: 0.1, lineTakeout: 0.05, stopTypical: 0.3 },
};

export type SpinLevel = "low" | "normal" | "high";

/**
 * Giri compiuti dal rilascio all'arresto su un draw al tee, per livello di rotazione:
 * bassa 1–2, normale 3–4, alta 5–8. La velocità angolare al rilascio si ricava con
 * spinRateForTurns (calibrate.ts).
 */
export const SPIN_TURNS: Record<SpinLevel, number> = { low: 1.5, normal: 3.5, high: 6.5 };
