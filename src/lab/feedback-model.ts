/**
 * Questionario sul realismo dopo ogni tiro: classificazione del tiro, domande con risposte
 * predefinite e testo del rapporto da inviare allo sviluppatore. Nessun accesso al DOM.
 */
import type { Key } from "../i18n/it";
import type { ImpactMetrics, Replay } from "../core/sim";

export const DEVELOPER_EMAIL = "curlsim@albonico.ch";

export type ShotKind = "draw" | "sweptDraw" | "takeout" | "raise";

/** Dati di un tiro concluso che servono a scegliere le domande e a descriverlo nel rapporto. */
export interface ShotFacts {
  n: number;
  speed: number;
  /** La pietra tirata ha toccato altre pietre. */
  hit: boolean;
  /** Pietre avversarie o proprie rimosse dal tiro. */
  removedOthers: number;
  sweepTime: number;
  spinTurns: number;
  stopped: boolean;
  outcome: string;
  hash: string;
  ice: { hogToHog: number; curl: number };
  sweepGain: number;
  /** Primo urto della pietra tirata, se c'è stato. */
  impact?: ImpactMetrics | null;
  /** Replay completo del tiro: entra sempre nel rapporto, per riprodurre il tiro identico. */
  replay?: Replay;
}

/** Velocità oltre la quale un tiro è un colpo (bocciata) e non un draw (m/s). */
export { TAKEOUT_SPEED } from "../core/params";
import { TAKEOUT_SPEED } from "../core/params";
/** Tempo minimo di spazzata per chiedere un giudizio sulla spazzata (s). */
export const SWEEP_MIN_TIME = 1;

/**
 * Il peso decide il tipo: da TAKEOUT_SPEED in su è un colpo (bocciata), sotto è un tiro a peso
 * da draw. Un tiro a peso da draw che colpisce è un raise o un freeze, anche se toglie una pietra.
 */
export function classify(f: ShotFacts): ShotKind {
  if (f.speed >= TAKEOUT_SPEED) return "takeout";
  if (f.hit) return "raise";
  if (f.sweepTime >= SWEEP_MIN_TIME) return "sweptDraw";
  return "draw";
}

export interface Question {
  id: string;
  text: Key;
  params?: Record<string, string | number>;
  answers: Key[];
}

const SCALE_TOO_MUCH: Key[] = ["fb.a.tooMuch", "fb.a.right", "fb.a.tooLittle", "fb.a.dontKnow"];
const SCALE_EARLY: Key[] = ["fb.a.tooEarly", "fb.a.right", "fb.a.tooLate", "fb.a.dontKnow"];
const SCALE_SHARP: Key[] = ["fb.a.tooSharp", "fb.a.right", "fb.a.tooSoft", "fb.a.dontKnow"];
const SCALE_LENGTH: Key[] = ["fb.a.tooShort", "fb.a.right", "fb.a.tooLong", "fb.a.dontKnow"];

export function questionsFor(kind: ShotKind, f: ShotFacts, fmt: (n: number, d: number) => string): Question[] {
  const q: Question[] = [];
  switch (kind) {
    case "draw":
      q.push({ id: "draw.breakPoint", text: "fb.q.breakPoint", answers: SCALE_EARLY });
      q.push({ id: "draw.finish", text: "fb.q.finish", answers: SCALE_SHARP });
      if (f.stopped) q.push({ id: "draw.weight", text: "fb.q.weightRef", params: { hh: fmt(f.ice.hogToHog, 1) }, answers: SCALE_LENGTH });
      break;
    case "sweptDraw":
      q.push({ id: "sweep.length", text: "fb.q.sweepLength", params: { s: fmt(f.sweepTime, 1) }, answers: SCALE_TOO_MUCH });
      q.push({ id: "sweep.curl", text: "fb.q.sweepCurl", answers: SCALE_TOO_MUCH });
      break;
    case "takeout":
      q.push({ id: "takeout.curl", text: "fb.q.takeoutCurl", answers: SCALE_TOO_MUCH });
      if (f.hit) {
        q.push({ id: "takeout.rollDir", text: "fb.q.rollDirection", answers: ["fb.a.straighter", "fb.a.credible", "fb.a.wider", "fb.a.dontKnow"] });
        q.push({ id: "takeout.rollDist", text: "fb.q.rollDistance", answers: SCALE_LENGTH });
      }
      break;
    case "raise":
      q.push({ id: "raise.target", text: "fb.q.raiseTarget", answers: SCALE_TOO_MUCH });
      q.push({ id: "raise.shooter", text: "fb.q.raiseShooter", answers: ["fb.a.tooFarBack", "fb.a.right", "fb.a.tooFarForward", "fb.a.dontKnow"] });
      break;
  }
  // Spazzata: domande anche sui tiri con urto, se si è spazzato abbastanza.
  if (kind !== "sweptDraw" && f.sweepTime >= SWEEP_MIN_TIME) {
    q.push({ id: "sweep.length", text: "fb.q.sweepLength", params: { s: fmt(f.sweepTime, 1) }, answers: SCALE_TOO_MUCH });
    q.push({ id: "sweep.curl", text: "fb.q.sweepCurl", answers: SCALE_TOO_MUCH });
  }
  // Rotazione bassa o alta, solo sui tiri senza urti: la curva dipende poco dalla rotazione nel modello.
  if (!f.hit && (f.spinTurns <= 2 || f.spinTurns >= 5)) {
    q.push({
      id: "spin.curl",
      text: f.spinTurns <= 2 ? "fb.q.spinLow" : "fb.q.spinHigh",
      params: { turns: fmt(f.spinTurns, 1) },
      answers: ["fb.a.shouldCurlMore", "fb.a.similarOk", "fb.a.shouldCurlLess", "fb.a.dontKnow"],
    });
  }
  return q;
}

/** Descrizione breve dell'urto: pienezza del colpo, velocità all'urto e strada dopo l'urto. */
export function describeImpact(imp: ImpactMetrics, fmt: (n: number, d: number) => string, outLabel: string): string {
  const out = (o: boolean) => (o ? ` (${outLabel})` : "");
  return (
    `colpo pieno al ${Math.round(imp.fullness * 100)}% · velocità all'urto ${fmt(imp.speed, 2)} m/s` +
    ` · tirata dopo l'urto ${fmt(imp.shooterTravel, 2)} m${out(imp.shooterOut)}` +
    ` · colpita ${fmt(imp.targetTravel, 2)} m${out(imp.targetOut)}`
  );
}

/** Etichetta del tipo di tiro, con l'indicazione di una pietra rimossa nei raise. */
export function shotLabel(kind: ShotKind, f: ShotFacts, label: (k: ShotKind) => string, removedLabel: string): string {
  return kind === "raise" && f.removedOthers > 0 ? `${label(kind)} · ${removedLabel}` : label(kind);
}

export interface FeedbackRecord {
  facts: ShotFacts;
  kind: ShotKind;
  /** Domanda e risposta già tradotte, per un rapporto leggibile. */
  answers: { question: string; answer: string }[];
  comment: string;
  at: string;
}

export function formatReport(
  records: FeedbackRecord[],
  header: { app: string; engine: string },
  label: (k: ShotKind) => string,
  fmt: (n: number, d: number) => string,
  words: { removed: string; out: string } = { removed: "pietra rimossa", out: "fuori gioco" },
): string {
  const lines = [`CurlSim – giudizi sui tiri (versione ${header.app}, motore ${header.engine})`, `Tiri valutati: ${records.length}`, ""];
  for (const r of records) {
    const f = r.facts;
    lines.push(
      `Tiro ${f.n} · ${shotLabel(r.kind, f, label, words.removed)} · ${fmt(f.speed, 2)} m/s · rotazione ${fmt(f.spinTurns, 1)} giri · spazzata ${fmt(f.sweepTime, 1)} s` +
        ` · ghiaccio hog-to-hog ${fmt(f.ice.hogToHog, 1)} s, curva ${fmt(f.ice.curl, 1)} m · sweeper ${fmt(f.sweepGain, 2)} m` +
        ` · esito: ${f.outcome} · hash ${f.hash}`,
    );
    if (f.impact) lines.push(`  Urto: ${describeImpact(f.impact, fmt, words.out)}`);
    for (const a of r.answers) lines.push(`  - ${a.question} → ${a.answer}`);
    if (r.comment.trim()) lines.push(`  Commento: ${r.comment.trim()}`);
    lines.push("");
  }
  const withReplay = records.filter((r) => r.facts.replay);
  if (withReplay.length) {
    lines.push("Replay (da incollare in «Carica replay o posizione» per rivedere il tiro identico):", "");
    for (const r of withReplay) lines.push(`Tiro ${r.facts.n}: ${JSON.stringify(r.facts.replay)}`, "");
  }
  return lines.join("\n");
}

/** Lunghezza oltre la quale un link mailto rischia di essere troncato da client e browser. */
export const MAILTO_MAX = 1800;

export function mailtoHref(subject: string, body: string): string {
  return `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
