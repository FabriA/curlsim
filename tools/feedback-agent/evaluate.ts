/**
 * Valutazione delle segnalazioni: riesegue i replay con il motore attuale, aggrega i giudizi
 * e individua i segnali che suggeriscono un intervento sul modello fisico.
 * Non modifica mai i parametri: propone dove guardare.
 */
import { ENGINE_VERSION } from "../../src/core/params";
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
      if (shot.replay.engineVersion !== ENGINE_VERSION) replayCheck = "motore diverso";
      else replayCheck = expected && expected === hash ? "identico" : "diverso";
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

/** Domanda senza i numeri del tiro, per raggruppare «Spazzata per 16,6 s…» con «Spazzata per 3,2 s…». */
export function questionKey(q: string): string {
  return q.replace(/\d+(?:[.,]\d+)?/g, "#").replace(/\s+/g, " ").trim();
}

/** Risposte che confermano il modello o non danno indicazioni. */
const NEUTRAL = new Set(["Giusto", "Credibile", "Simile va bene", "Non so"]);

export interface QuestionStats {
  question: string;
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
      const key = questionKey(a.question);
      let st = map.get(key);
      if (!st) map.set(key, (st = { question: key, total: 0, counts: {}, signal: null }));
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
  n: number;
  meanShooterTravel: number;
  counts: Record<string, number>;
}

const ROLL_QUESTION = "Dopo l'urto, la distanza percorsa dalla pietra tirata è…";

/** Giudizi sul rotolamento della tirata dopo l'urto, raggruppati per pienezza del colpo. */
export function rollStats(shots: ShotRecord[]): RollStats[] {
  const out = new Map<FullnessBand, RollStats>();
  for (const s of shots) {
    const a = s.answers.find((x) => questionKey(x.question) === questionKey(ROLL_QUESTION));
    if (!a || !s.impact) continue;
    const b = band(s.impact.fullness);
    let st = out.get(b);
    if (!st) out.set(b, (st = { band: b, n: 0, meanShooterTravel: 0, counts: {} }));
    st.meanShooterTravel = (st.meanShooterTravel * st.n + s.impact.shooterTravel) / (st.n + 1);
    st.n++;
    st.counts[a.answer] = (st.counts[a.answer] ?? 0) + 1;
  }
  const order: FullnessBand[] = ["pieno", "mezza pietra", "sottile"];
  return order.filter((b) => out.has(b)).map((b) => out.get(b)!);
}

/** Indicazioni sul modello, ricavate dai segnali. Sono proposte da verificare, non correzioni automatiche. */
export function recommendations(qs: QuestionStats[], rs: RollStats[]): string[] {
  const rec: string[] = [];
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

  const s = (needle: string, text: Record<string, string>) => {
    const g = sig(needle);
    if (g && text[g.answer]) rec.push(`${text[g.answer]} (${Math.round(g.share * 100)}% delle risposte).`);
  };
  s("Il punto in cui la pietra inizia a curvare", {
    "Troppo presto": "La curva inizia troppo presto: ridurre il peso della deriva ad alta velocità (aumentare curlV0)",
    "Troppo tardi": "La curva inizia troppo tardi: anticipare la deriva (ridurre curlV0)",
  });
  s("La chiusura finale della curva", {
    "Troppo brusca": "Chiusura finale troppo brusca: ammorbidire la deriva a bassa velocità (aumentare curlV0)",
    "Troppo dolce": "Chiusura finale troppo dolce: accentuare la deriva a bassa velocità (ridurre curlV0)",
  });
  s("Con un hog-to-hog di # s", {
    "Troppo corto": "Tiri più corti del previsto per il tempo hog-to-hog impostato: verificare la calibrazione di μ e la relazione peso/tempo",
    "Troppo lungo": "Tiri più lunghi del previsto per il tempo hog-to-hog impostato: verificare la calibrazione di μ e la relazione peso/tempo",
  });
  s("Spazzata per # s: l'allungamento", {
    Troppo: "La spazzata allunga troppo: ridurre i guadagni dei livelli degli sweeper",
    "Troppo poco": "La spazzata allunga troppo poco: aumentare i guadagni dei livelli degli sweeper",
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
    Troppo: "Nei raise la pietra colpita avanza troppo: ridurre la restituzione (oggi 0,9)",
    "Troppo poco": "Nei raise la pietra colpita avanza troppo poco: aumentare la restituzione (oggi 0,9)",
  });
  s("Con rotazione bassa", {
    "Dovrebbe curvare di più": "Con rotazione bassa la curva dovrebbe crescere: introdurre una dipendenza della deriva dalla rotazione",
    "Dovrebbe curvare di meno": "Con rotazione bassa la curva dovrebbe ridursi: aumentare spinRatioRef",
  });
  s("Con rotazione alta", {
    "Dovrebbe curvare di più": "Con rotazione alta la curva dovrebbe crescere: introdurre una dipendenza della deriva dalla rotazione",
    "Dovrebbe curvare di meno": "Con rotazione alta la curva dovrebbe ridursi: introdurre una dipendenza della deriva dalla rotazione",
  });
  return rec;
}
