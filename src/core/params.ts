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
export const ENGINE_VERSION = "0.4.0";

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
  /** Rapporto ω/v della rotazione normale (3,5 giri su un draw al tee), riferimento di spinGain e spinCurve. */
  spinRef?: number;
  /**
   * Curva che dipende dai giri (dalla 0.4): forma e quantità della deriva in funzione dei giri che la
   * pietra farebbe su un draw al tee. Se c'è, curlExp e spinGain non si usano.
   */
  spinCurve?: SpinCurve;
  /**
   * Fattori che danno la stessa curva totale, su un draw al tee, alle forme 1/v^0,5, 1/v, 1/v^1,5 e
   * 1/v² (il secondo vale 1). Calcolati da calibrate() quando c'è spinCurve.
   */
  curlNorm?: number[];
  /** Fattore sull'attrito durante la spazzata (< 1). */
  sweepFriction: number;
  /** Fattore sulla deriva durante la spazzata (< 1). */
  sweepCurl: number;
  /**
   * Spazzata da un lato (dal motore 0.4.0): spinta laterale = sweepDir · μg · (riduzione d'attrito).
   * Ricavata dal livello degli sweeper con sweepDirFor (calibrate.ts). Senza, nessuna spinta.
   */
  sweepDir?: number;
  /** Quota della riduzione d'attrito ottenuta da un solo sweeper su un lato (rispetto a Hard). */
  sweepSideShare?: number;
  /** Coefficiente di restituzione negli urti in cui una delle due pietre è quella tirata. */
  restitution: number;
  /**
   * Coefficiente di restituzione negli urti tra due pietre che non sono quella tirata (pietre
   * colpite che ne colpiscono altre). Se manca vale `restitution`, come nei replay precedenti.
   */
  restitutionSecondary?: number;
  /**
   * Urti lenti meno elastici (dalla 0.4): con velocità relativa fino a `from` m/s la restituzione è
   * `e`, da `to` m/s in su è quella normale, in mezzo varia in modo lineare. Se manca, la restituzione
   * non dipende dalla velocità.
   */
  slowImpact?: SlowImpact;
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

/** Nodi della curva in funzione dei giri; tra due nodi i valori variano in modo lineare. */
export interface SpinCurve {
  /** Giri della rotazione di riferimento (quella per cui la curva è quella del profilo). */
  refTurns: number;
  /** Giri su un draw al tee, crescenti. */
  turns: number[];
  /** Forma: la deriva cresce come 1/v^exp quando la pietra rallenta (da 0,5 a 2). */
  exp: number[];
  /** Curva totale rispetto alla rotazione di riferimento. */
  gain: number[];
}

export interface SlowImpact {
  e: number;
  from: number;
  to: number;
}

/**
 * Curva in funzione dei giri, dalle indicazioni dei tester e dalla letteratura:
 *  - fino a 2 giri la pietra curva subito e di più (forma classica, +25%);
 *  - 3–5 giri è la rotazione normale: finale netto, curva del profilo;
 *  - con più giri va dritta più a lungo e chiude più forte: 10 giri +25%;
 *  - spinner (oltre 20 giri): curva quasi tutta nel finale, +50%; con 70–80 giri vicino al doppio
 *    della rotazione normale (Shegelski et al.).
 * Non si simula la perdita o l'inversione della rotazione con pochissimi giri.
 */
export const SPIN_CURVE: SpinCurve = {
  refTurns: 3.5,
  turns: [2, 3, 5, 6.5, 10, 25, 80],
  exp: [0.5, 1, 1, 1.3, 1.5, 1.7, 1.7],
  // Tarati sul profilo normale perché la curva totale sia +25%, +10%, +25%, +50% e circa +85%: la
  // deriva non può superare l'attrito, quindi con moltissimi giri la curva arriva a un tetto (circa
  // 2,2 m), che con 80 giri sul ghiaccio normale vale circa 1,85 volte la curva del profilo.
  gain: [1.24, 1, 1, 1.14, 1.35, 1.78, 2.3],
};

/**
 * Urti lenti smorzati: dai giudizi sui raise, sotto 0,8 m/s d'impatto la pietra colpita andava troppo
 * lontano (12 «troppo» su 12), sopra andava bene. Sui 13 raise lenti giudicati la colpita percorre in
 * media il 72% di prima; sopra 0,9 m/s la differenza resta sotto l'8%, da 1,1 m/s nessuna.
 */
export const SLOW_IMPACT: SlowImpact = { e: 0.55, from: 0.4, to: 1.1 };

/** Forma della curva del draw: «spin» è il modello dalla 0.4, le altre restano per i replay. */
export type CurveLevel = "classic" | "late" | "later" | "spin";

/**
 * «Classica» è il modello fino alla 0.3.1. «Finale più netto», dai giudizi dei tester (curva che
 * inizia troppo presto e si chiude troppo dolce, più curva con molti giri): deriva come 1/v
 * («netta») o 1/v^1,5 («molto netta») e curva che cresce con i giri. La curva totale del draw di
 * riferimento con rotazione normale resta quella del profilo.
 */
export const CURVES: Record<CurveLevel, Pick<IceParams, "curlExp" | "spinGain" | "spinCurve">> = {
  classic: { curlExp: 0.5, spinGain: 0 },
  late: { curlExp: 1, spinGain: 0.2 },
  later: { curlExp: 1.5, spinGain: 0.2 },
  spin: { spinCurve: SPIN_CURVE },
};

/** Forma della curva che corrisponde ai valori di un replay; senza curlExp è la classica. */
export function curveLevelOf(p: Pick<IceParams, "curlExp" | "spinCurve">): CurveLevel {
  if (p.spinCurve) return "spin";
  return p.curlExp === 1.5 ? "later" : p.curlExp === 1 ? "late" : "classic";
}

/** Vivacità degli urti tra pietre: quanta energia passa da una pietra all'altra. */
export type CollisionLevel = "soft" | "normal" | "lively";

/**
 * «Vivaci» sono i valori fino alla versione 0.2.2. «Normali» rendono gli urti quasi elastici, come le
 * pietre di granito: in una fila di pietre in freeze colpita in pieno la quantità di moto passa
 * lungo la fila (come nel pendolo di Newton), esce solo l'ultima e le altre si spostano di pochi
 * centimetri; nel colpo pieno la pietra tirata si ferma quasi sul posto.
 * (Una prima versione di «Normali», 0,85 / 0,6, faceva l'opposto e fu ritirata.)
 */
export const COLLISIONS: Record<CollisionLevel, Pick<IceParams, "restitution" | "restitutionSecondary" | "slowImpact">> = {
  soft: { restitution: 0.95, restitutionSecondary: 0.97, slowImpact: SLOW_IMPACT },
  normal: { restitution: 0.95, restitutionSecondary: 0.97, slowImpact: undefined },
  lively: { restitution: 0.9, restitutionSecondary: 0.9 },
};

/**
 * Impostazione degli urti che corrisponde ai valori di un replay, oppure null se i valori sono
 * altri. Senza `restitutionSecondary` (replay fino alla 0.2.2) vale `restitution`.
 */
export function collisionLevelOf(p: Pick<IceParams, "restitution" | "restitutionSecondary" | "slowImpact">): CollisionLevel | null {
  const e2 = p.restitutionSecondary ?? p.restitution;
  const same = (a?: SlowImpact, b?: SlowImpact) => (!a && !b) || (!!a && !!b && a.e === b.e && a.from === b.from && a.to === b.to);
  for (const k of Object.keys(COLLISIONS) as CollisionLevel[]) {
    const c = COLLISIONS[k];
    if (c.restitution === p.restitution && (c.restitutionSecondary ?? c.restitution) === e2 && same(c.slowImpact, p.slowImpact)) return k;
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
/**
 * Spazzata da un lato (Curl o Straight): spostamento laterale (m) di una guardia spazzata da un solo
 * sweeper, al 100%, dal rilascio all'arresto. Ipotesi da tarare con i giudizi: Sonobe et al. (2024)
 * misurano circa 7 cm su 6,5 m con pietre lente e senza rotazione.
 */
export const SWEEP_DIR: Record<SkillLevel, number> = { beginner: 0.1, club: 0.2, elite: 0.3 };
/** Quota dell'effetto sull'attrito di un solo sweeper rispetto a due (Hard). */
export const SWEEP_SIDE_SHARE = 0.6;

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

export type SpinLevel = "low" | "normal" | "high" | "spinner";

/**
 * Giri compiuti dal rilascio all'arresto su un draw al tee, per livello di rotazione:
 * bassa 1–2, normale 3–4, alta 5–8. La velocità angolare al rilascio si ricava con
 * spinRateForTurns (calibrate.ts).
 */
export const SPIN_TURNS: Record<SpinLevel, number> = { low: 1.5, normal: 3.5, high: 6.5, spinner: 25 };
