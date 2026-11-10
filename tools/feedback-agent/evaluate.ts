/**
 * Valutazione delle segnalazioni: riesegue i replay con il motore attuale, aggrega i giudizi
 * e individua i segnali che suggeriscono un intervento sul modello fisico.
 * Non modifica mai i parametri: propone dove guardare.
 */
import { collisionLevelOf, curveLevelOf, ENGINE_VERSION } from "../../src/core/params";
import { runReplay } from "../../src/core/sim";
import type { ParsedReport, ParsedShot } from "./parse";

export type ReplayCheck = "identico" | "diverso" | "motore diverso" | "assente";

export interface ShotRecord {
  message: string;
  date: string;
  app: string;
  engine: string;
  n: number;
  kind: string;
  speed: number | null;
  spinTurns: number | null;
  sweepTime: number | null;
  /** Vivacità degli urti; null nei rapporti precedenti, che avevano urti vivaci. */
  collisions?: string | null;
  curve?: string | null;
  outcome: string;
  hash: string | null;
  answers: { question: string; answer: string }[];
  comment: string;
  replayCheck: ReplayCheck;
  /** Hash ottenuto rieseguendo il replay con il motore attuale. */
  rerunHash: string | null;
  impact: ParsedShot["impact"];
  replay: ParsedShot["replay"];
  warnings: string[];
}

export interface Dataset {
  version: 1;
  engine: string;
  /** Identificativi (hash) dei messaggi già elaborati. */
  processed: string[];
  shots: ShotRecord[];
  updated: string;
}

export function emptyDataset(): Dataset {
  return { version: 1, engine: ENGINE_VERSION, processed: [], shots: [], updated: "" };
}

/** Riesegue il replay di un tiro e confronta l'hash; ricalcola le misure dell'urto se mancano. */
export function checkShot(shot: ParsedShot, message: string, date: string, report: ParsedReport): ShotRecord {
  let replayCheck: ReplayCheck = "assente";
  let rerunHash: string | null = null;
  let impact = shot.impact;
  const warnings = [...shot.warnings];
  if (shot.replay) {
    try {
      const { sim, hash } = runReplay(shot.replay);
      rerunHash = hash;
      const expected = shot.replay.result?.hash ?? shot.hash;
      // I motori successivi riproducono i replay precedenti: se l'hash coincide il replay è identico.
      if (expected && expected === hash) replayCheck = "identico";
      else replayCheck = shot.replay.engineVersion !== ENGINE_VERSION ? "motore diverso" : "diverso";
      const m = sim.metrics.impact;
      if (!impact && m) {
        impact = {
          fullness: m.fullness,
          speed: m.speed,
          shooterTravel: m.shooterTravel,
          targetTravel: m.targetTravel,
          shooterOut: m.shooterOut,
          targetOut: m.targetOut,
        };
      }
    } catch {
      warnings.push("replay non rieseguibile");
    }
  }
  return {
    message,
    date,
    app: report.app,
    engine: report.engine,
    n: shot.n,
    kind: shot.kind,
    speed: shot.speed,
    spinTurns: shot.spinTurns,
    sweepTime: shot.sweepTime,
    collisions: shot.collisions,
    curve: shot.curve,
    outcome: shot.outcome,
    hash: shot.hash,
    answers: shot.answers,
    comment: shot.comment,
    replayCheck,
    rerunHash,
    impact,
    replay: shot.replay,
    warnings,
  };
}

/** Aggiunge al dataset i tiri di un messaggio non ancora elaborato. */
export function addReport(ds: Dataset, message: string, date: string, report: ParsedReport): Dataset {
  if (ds.processed.includes(message)) return ds;
  const shots = report.shots.map((s) => checkShot(s, message, date, report));
  return { ...ds, processed: [...ds.processed, message], shots: [...ds.shots, ...shots] };
}

// ——— Aggregazione ———

/**
 * Impostazione degli urti di un tiro. Si ricava dai valori del replay, che sono quelli usati
 * davvero (l'etichetta nel testo dei rapporti 0.3.0 era sbagliata: «vivaci» anche per «Normali»).
 * Senza replay vale l'etichetta del rapporto; senza etichetta (fino alla 0.2.2) gli urti erano vivaci.
 */
export function collisionsOf(s: Pick<ShotRecord, "replay" | "collisions">): string {
  const p = s.replay?.params;
  if (p) {
    const lvl = collisionLevelOf(p);
    if (lvl) return { soft: "smorzati", normal: "normali", lively: "vivaci" }[lvl];
    const e2 = p.restitutionSecondary ?? p.restitution;
    if (p.restitution === 0.85 && e2 === 0.6) return "normali (prima versione, 0,85/0,6)";
    return `personalizzati (${String(p.restitution).replace(".", ",")}/${String(e2).replace(".", ",")})`;
  }
  return s.collisions ?? "vivaci";
}

/** Forma della curva di un tiro: dal replay se c'è, altrimenti dal rapporto; prima della 0.3.2 era la classica. */
export function curveOf(s: Pick<ShotRecord, "replay" | "curve">): string {
  if (s.replay?.params) return { classic: "classica", late: "netta", later: "molto netta", spin: "dai giri" }[curveLevelOf(s.replay.params)];
  return s.curve ?? "classica";
}

/** Impostazioni che separano le statistiche: urti e, se non è la classica, forma della curva. */
export function settingsOf(s: Pick<ShotRecord, "replay" | "collisions" | "curve">): string {
  const c = curveOf(s);
  return c === "classica" ? collisionsOf(s) : `${collisionsOf(s)}, curva ${c}`;
}

/** Domanda senza i numeri del tiro, per raggruppare «Spazzata per 16,6 s…» con «Spazzata per 3,2 s…». */
export function questionKey(q: string): string {
  return q.replace(/\d+(?:[.,]\d+)?/g, "#").replace(/\s+/g, " ").trim();
}

/** Risposte che confermano il modello o non danno indicazioni. */
const NEUTRAL = new Set(["Giusto", "Credibile", "Simile va bene", "Non so"]);

export interface QuestionStats {
  question: string;
  /** Impostazione degli urti dei tiri raggruppati: le risposte si contano separatamente. */
  collisions: string;
  total: number;
  counts: Record<string, number>;
  /** Risposta prevalente che chiede una correzione, se supera la soglia. */
  signal: { answer: string; share: number } | null;
}

export const MIN_ANSWERS = 3;
export const SIGNAL_SHARE = 0.6;

export function questionStats(shots: ShotRecord[]): QuestionStats[] {
  const map = new Map<string, QuestionStats>();
  for (const s of shots) {
    for (const a of s.answers) {
      const q = questionKey(a.question);
      const c = settingsOf(s);
      const key = `${q}\u0000${c}`;
      let st = map.get(key);
      if (!st) map.set(key, (st = { question: q, collisions: c, total: 0, counts: {}, signal: null }));
      st.total++;
      st.counts[a.answer] = (st.counts[a.answer] ?? 0) + 1;
    }
  }
  for (const st of map.values()) {
    const informative = Object.entries(st.counts).filter(([k]) => k !== "Non so");
    const n = informative.reduce((a, [, v]) => a + v, 0);
    const top = informative.filter(([k]) => !NEUTRAL.has(k)).sort((a, b) => b[1] - a[1])[0];
    if (top && n >= MIN_ANSWERS && top[1] / n >= SIGNAL_SHARE) st.signal = { answer: top[0], share: top[1] / n };
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type FullnessBand = "pieno" | "mezza pietra" | "sottile";

export function band(fullness: number): FullnessBand {
  if (fullness >= 0.75) return "pieno";
  if (fullness >= 0.35) return "mezza pietra";
  return "sottile";
}

export interface RollStats {
  band: FullnessBand;
  collisions: string;
  n: number;
  meanShooterTravel: number;
  counts: Record<string, number>;
}

const ROLL_QUESTION = "Dopo l'urto, la distanza percorsa dalla pietra tirata";
const RAISE_QUESTION = "La pietra colpita è avanzata…";

export type ImpactSpeedBand = "sotto 0,5 m/s" | "0,5–0,8 m/s" | "0,8–1,2 m/s" | "sopra 1,2 m/s";

export function impactSpeedBand(v: number): ImpactSpeedBand {
  return v < 0.5 ? "sotto 0,5 m/s" : v < 0.8 ? "0,5–0,8 m/s" : v < 1.2 ? "0,8–1,2 m/s" : "sopra 1,2 m/s";
}

export interface RaiseStats {
  band: ImpactSpeedBand;
  collisions: string;
  n: number;
  meanTargetTravel: number;
  counts: Record<string, number>;
}

/** Giudizi sulla strada della pietra colpita nei raise, per velocità d'impatto: gli urti lenti e veloci si comportano diversamente. */
export function raiseStats(shots: ShotRecord[]): RaiseStats[] {
  const out = new Map<string, RaiseStats>();
  for (const s of shots) {
    const a = s.answers.find((x) => x.question === RAISE_QUESTION);
    if (!a || !s.impact) continue;
    const b = impactSpeedBand(s.impact.speed);
    const c = collisionsOf(s);
    const key = `${b}\u0000${c}`;
    let st = out.get(key);
    if (!st) out.set(key, (st = { band: b, collisions: c, n: 0, meanTargetTravel: 0, counts: {} }));
    st.meanTargetTravel = (st.meanTargetTravel * st.n + s.impact.targetTravel) / (st.n + 1);
    st.n++;
    st.counts[a.answer] = (st.counts[a.answer] ?? 0) + 1;
  }
  const order: ImpactSpeedBand[] = ["sotto 0,5 m/s", "0,5–0,8 m/s", "0,8–1,2 m/s", "sopra 1,2 m/s"];
  return [...out.values()].sort((x, y) => x.collisions.localeCompare(y.collisions) || order.indexOf(x.band) - order.indexOf(y.band));
}

/** Giudizi sul rotolamento della tirata dopo l'urto, raggruppati per pienezza del colpo. */
export function rollStats(shots: ShotRecord[]): RollStats[] {
  const out = new Map<string, RollStats>();
  for (const s of shots) {
    const a = s.answers.find((x) => x.question.startsWith(ROLL_QUESTION));
    if (!a || !s.impact) continue;
    const b = band(s.impact.fullness);
    const c = settingsOf(s);
    const key = `${b}\u0000${c}`;
    let st = out.get(key);
    if (!st) out.set(key, (st = { band: b, collisions: c, n: 0, meanShooterTravel: 0, counts: {} }));
    st.meanShooterTravel = (st.meanShooterTravel * st.n + s.impact.shooterTravel) / (st.n + 1);
    st.n++;
    st.counts[a.answer] = (st.counts[a.answer] ?? 0) + 1;
  }
  const order: FullnessBand[] = ["pieno", "mezza pietra", "sottile"];
  return [...out.values()].sort((x, y) => x.collisions.localeCompare(y.collisions) || order.indexOf(x.band) - order.indexOf(y.band));
}

/** Indicazioni sul modello, ricavate dai segnali, separate per impostazione degli urti. Sono proposte da verificare, non correzioni automatiche. */
export function recommendations(qs: QuestionStats[], rs: RollStats[]): string[] {
  const groups = [...new Set([...qs.map((q) => q.collisions), ...rs.map((r) => r.collisions)])].sort();
  const rec: string[] = [];
  for (const c of groups) {
    const lines = recommendationsFor(qs.filter((q) => q.collisions === c), rs.filter((r) => r.collisions === c), c);
    for (const l of lines) rec.push(groups.length > 1 || c !== "normali" ? `[urti ${c}] ${l}` : l);
  }
  return rec;
}

function recommendationsFor(qs: QuestionStats[], rs: RollStats[], group: string): string[] {
  /** Dalla 0.4 la forma della curva dipende dai giri (SPIN_CURVE): le indicazioni su curlV0 valgono solo per la classica. */
  const spinModel = group.includes("curva dai giri");
  const damped = group.startsWith("smorzati");
  const rec: string[] = [];
  /** Domande per cui è già stata data un'indicazione specifica. */
  const covered = new Set<string>();
  const sig = (needle: string) => qs.find((q) => q.signal && q.question.startsWith(needle))?.signal ?? null;
  const majority = (r: RollStats, ans: string) => {
    const n = Object.entries(r.counts).filter(([k]) => k !== "Non so").reduce((a, [, v]) => a + v, 0);
    return n >= MIN_ANSWERS && (r.counts[ans] ?? 0) / n >= SIGNAL_SHARE;
  };

  const partialLong = rs.filter((r) => r.band !== "pieno" && majority(r, "Troppo lungo"));
  const fullLong = rs.find((r) => r.band === "pieno" && majority(r, "Troppo lungo"));
  const partialShort = rs.filter((r) => r.band !== "pieno" && majority(r, "Troppo corto"));
  if (partialLong.length) rec.push(`Rotolamento troppo lungo nei colpi ${partialLong.map((r) => r.band).join(" e ")}: candidato l'aumento dell'attrito tra le pietre (stoneFriction, oggi 0,2).`);
  if (fullLong) rec.push("Rotolamento troppo lungo anche nei colpi pieni: la restituzione non spiega il difetto; rivedere la perdita di energia dopo l'urto.");
  if (partialShort.length) rec.push(`Rotolamento troppo corto nei colpi ${partialShort.map((r) => r.band).join(" e ")}: candidata la riduzione dell'attrito tra le pietre.`);
  if (partialLong.length || fullLong || partialShort.length) for (const q of qs) if (q.question.startsWith(ROLL_QUESTION)) covered.add(q.question);

  const s = (needle: string, text: Record<string, string>) => {
    const g = sig(needle);
    if (g && text[g.answer]) {
      rec.push(`${text[g.answer]} (${Math.round(g.share * 100)}% delle risposte).`);
      covered.add(qs.find((q) => q.question.startsWith(needle))!.question);
    }
  };
  if (spinModel) {
    s("Il punto in cui la pietra inizia a curvare", {
      "Troppo presto": "La curva inizia troppo presto: alzare gli esponenti di SPIN_CURVE per le rotazioni giudicate (forma più tardiva)",
      "Troppo tardi": "La curva inizia troppo tardi: abbassare gli esponenti di SPIN_CURVE per le rotazioni giudicate",
    });
    s("La chiusura finale della curva", {
      "Troppo brusca": "Chiusura finale troppo brusca: abbassare gli esponenti di SPIN_CURVE per le rotazioni giudicate",
      "Troppo dolce": "Chiusura finale troppo dolce: alzare gli esponenti di SPIN_CURVE per le rotazioni giudicate",
    });
  } else {
    s("Il punto in cui la pietra inizia a curvare", {
      "Troppo presto": "La curva inizia troppo presto: ridurre il peso della deriva ad alta velocità (aumentare curlV0)",
      "Troppo tardi": "La curva inizia troppo tardi: anticipare la deriva (ridurre curlV0)",
    });
    s("La chiusura finale della curva", {
      "Troppo brusca": "Chiusura finale troppo brusca: ammorbidire la deriva a bassa velocità (aumentare curlV0)",
      "Troppo dolce": "Chiusura finale troppo dolce: accentuare la deriva a bassa velocità (ridurre curlV0)",
    });
  }
  s("Con un hog-to-hog di # s", {
    "Troppo corto": "Tiri più corti del previsto per il tempo hog-to-hog impostato: verificare la calibrazione di μ e la relazione peso/tempo",
    "Troppo lungo": "Tiri più lunghi del previsto per il tempo hog-to-hog impostato: verificare la calibrazione di μ e la relazione peso/tempo",
  });
  s("Spazzata per # s: l'allungamento", {
    Troppo: "La spazzata allunga troppo: ridurre i guadagni dei livelli degli sweeper",
    "Troppo poco": "La spazzata allunga troppo poco: aumentare i guadagni dei livelli degli sweeper",
  });
  s("Spazzata Curl per", {
    Troppo: "La spazzata Curl aumenta troppo la curva: ridurre gli spostamenti laterali di SWEEP_DIR",
    "Troppo poco": "La spazzata Curl aumenta poco la curva: aumentare gli spostamenti laterali di SWEEP_DIR",
  });
  s("Spazzata Straight per", {
    Troppo: "La spazzata Straight riduce troppo la curva: ridurre SWEEP_DIR o avvicinare sweepCurl a 1",
    "Troppo poco": "La spazzata Straight riduce poco la curva: aumentare SWEEP_DIR",
  });
  s("La riduzione della curva dovuta alla spazzata", {
    Troppa: "La spazzata riduce troppo la curva: avvicinare sweepCurl a 1 (oggi 0,85)",
    Troppo: "La spazzata riduce troppo la curva: avvicinare sweepCurl a 1 (oggi 0,85)",
    "Troppo poco": "La spazzata riduce poco la curva: abbassare sweepCurl (oggi 0,85)",
  });
  s("La curva di questo colpo", {
    Troppo: "Le bocciate curvano troppo: ridurre la deriva ad alta velocità",
    "Troppo poco": "Le bocciate curvano troppo poco: aumentare la deriva ad alta velocità",
  });
  s("La pietra colpita è avanzata", {
    Troppo: damped
      ? "Nei raise la pietra colpita avanza ancora troppo con gli urti lenti smorzati: abbassare SLOW_IMPACT.e o alzare le soglie (vedi la tabella per velocità d'impatto)"
      : "Nei raise la pietra colpita avanza troppo: confrontare con gli urti lenti smorzati (vedi la tabella per velocità d'impatto)",
    "Troppo poco": "Nei raise la pietra colpita avanza troppo poco: aumentare la restituzione degli urti con la pietra tirata",
  });
  const more = spinModel ? "alzare il guadagno di SPIN_CURVE per quei giri" : "introdurre una dipendenza della deriva dalla rotazione (fatto nella 0.4: curva dai giri)";
  const less = spinModel ? "abbassare il guadagno di SPIN_CURVE per quei giri" : "introdurre una dipendenza della deriva dalla rotazione (fatto nella 0.4: curva dai giri)";
  s("Con rotazione bassa", { "Dovrebbe curvare di più": `Con rotazione bassa la curva dovrebbe crescere: ${more}`, "Dovrebbe curvare di meno": `Con rotazione bassa la curva dovrebbe ridursi: ${less}` });
  s("Con rotazione alta", { "Dovrebbe curvare di più": `Con rotazione alta la curva dovrebbe crescere: ${more}`, "Dovrebbe curvare di meno": `Con rotazione alta la curva dovrebbe ridursi: ${less}` });
  s("Spinner", { "Dovrebbe curvare di più": `Lo spinner dovrebbe curvare di più: ${more} (attenzione al tetto dato dall'attrito)`, "Dovrebbe curvare di meno": `Lo spinner dovrebbe curvare di meno: ${less}` });

  // Ogni altro segnale netto, anche senza le misure dell'urto: da guardare a mano.
  for (const q of qs) {
    if (!q.signal || covered.has(q.question)) continue;
    const n = Object.entries(q.counts).filter(([k]) => k !== "Non so").reduce((a, [, v]) => a + v, 0);
    rec.push(`«${q.question}»: ${Math.round(q.signal.share * 100)}% di ${n} risposte dice «${q.signal.answer}». Da verificare rivedendo i replay di quei tiri.`);
  }
  return rec;
}
