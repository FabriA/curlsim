/**
 * Lettura dei rapporti «CurlSim – giudizi sui tiri» prodotti dal laboratorio (feedback-model.ts).
 * Il testo arriva da una mail: è un dato non fidato. Si legge soltanto, senza eseguire nulla,
 * e i replay passano dalla validazione del motore prima di essere usati.
 */
import { validateReplay, type Replay } from "../../src/core/sim";

export const REPORT_HEADER = /CurlSim\s+[–-]\s+giudizi sui tiri\s+\(versione\s+([\w.-]+),\s+motore\s+([\w.-]+)\)/;

export interface ParsedShot {
  n: number;
  /** Tipo di tiro come scritto nel rapporto (es. «Bocciata», «Raise o freeze · pietra rimossa»). */
  kind: string;
  speed: number | null;
  spinTurns: number | null;
  sweepTime: number | null;
  ice: { hogToHog: number | null; curl: number | null };
  sweepGain: number | null;
  /** Vivacità degli urti («normali», «vivaci»); null nei rapporti fino alla versione 0.2.2 (urti vivaci). */
  collisions: string | null;
  /** Forma della curva («classica», «netta», «molto netta»); null fino alla 0.3.1 (classica). */
  curve: string | null;
  outcome: string;
  hash: string | null;
  impact: { fullness: number; speed: number; shooterTravel: number; targetTravel: number; shooterOut: boolean; targetOut: boolean } | null;
  answers: { question: string; answer: string }[];
  comment: string;
  replay: Replay | null;
  /** Problemi di lettura, per esempio un replay non valido. */
  warnings: string[];
}

export interface ParsedReport {
  app: string;
  engine: string;
  shots: ParsedShot[];
}

/** Limite di sicurezza sulla dimensione del testo di un rapporto. */
const MAX_REPORT_CHARS = 2_000_000;

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

/** Riconosce un rapporto e ne estrae i tiri. Restituisce null se il testo non contiene un rapporto. */
export function parseReport(raw: string): ParsedReport | null {
  if (raw.length > MAX_REPORT_CHARS) return null;
  // Normalizza le righe e toglie le citazioni «> » delle risposte inoltrate.
  const text = raw.replace(/\r\n?/g, "\n").replace(/^(> ?)+/gm, "");
  const head = REPORT_HEADER.exec(text);
  if (!head) return null;
  const lines = text.slice(head.index).split("\n");
  const shots = new Map<number, ParsedShot>();
  let current: ParsedShot | null = null;
  let inReplays = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (/^Replay\b/.test(line)) {
      inReplays = true;
      current = null;
      continue;
    }

    if (inReplays) {
      const m = /^Tiro\s+(\d+):\s*(\{.*)$/.exec(line);
      if (!m) continue;
      // Il JSON può essere spezzato su più righe dal programma di posta: si riunisce fino a chiudere le graffe.
      let json = m[2];
      let j = i;
      while (!balanced(json) && j + 1 < lines.length && json.length < 200_000) {
        j++;
        json += lines[j].replace(/\s+$/, "");
      }
      i = j;
      const shot = shots.get(Number(m[1]));
      if (!shot) continue;
      try {
        const r = JSON.parse(json);
        if (validateReplay(r)) shot.replay = r;
        else shot.warnings.push("replay non valido");
      } catch {
        shot.warnings.push("replay illeggibile (JSON interrotto)");
      }
      continue;
    }

    const t = /^Tiro\s+(\d+)\s+·\s+(.+)$/.exec(line);
    if (t) {
      current = parseShotLine(Number(t[1]), t[2]);
      shots.set(current.n, current);
      continue;
    }
    if (!current) continue;
    const urto = /^\s+Urto:\s+(.+)$/.exec(line);
    if (urto) {
      current.impact = parseImpact(urto[1]);
      continue;
    }
    const qa = /^\s+-\s+(.+?)\s+→\s+(.+)$/.exec(line);
    if (qa) {
      current.answers.push({ question: qa[1].trim(), answer: qa[2].trim() });
      continue;
    }
    const c = /^\s+Commento:\s+(.+)$/.exec(line);
    if (c) current.comment = c[1].trim();
  }
  return { app: head[1], engine: head[2], shots: [...shots.values()] };
}

function balanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return depth === 0 && !inStr;
}

function parseShotLine(n: number, rest: string): ParsedShot {
  const parts = rest.split(" · ");
  const kindParts: string[] = [];
  for (const p of parts) {
    if (/m\/s$/.test(p)) break;
    kindParts.push(p);
  }
  const field = (re: RegExp) => re.exec(rest)?.[1];
  return {
    n,
    kind: kindParts.join(" · "),
    speed: num(field(/(\d+(?:,\d+)?)\s+m\/s/)),
    spinTurns: num(field(/rotazione\s+(\d+(?:,\d+)?)\s+giri/)),
    sweepTime: num(field(/spazzata\s+(\d+(?:,\d+)?)\s+s/)),
    ice: { hogToHog: num(field(/hog-to-hog\s+(\d+(?:,\d+)?)\s+s/)), curl: num(field(/curva\s+(\d+(?:,\d+)?)\s+m/)) },
    sweepGain: num(field(/sweeper\s+(\d+(?:,\d+)?)\s+m/)),
    collisions: field(/·\s+urti\s+(\p{L}+)/u) ?? null,
    curve: field(/·\s+curva\s+(molto netta|netta|classica|dai giri)/u) ?? null,
    outcome: field(/esito:\s+(.+?)\s+·\s+hash/) ?? "",
    hash: field(/hash\s+([0-9a-f]{8})/) ?? null,
    impact: null,
    answers: [],
    comment: "",
    replay: null,
    warnings: [],
  };
}

function parseImpact(s: string): ParsedShot["impact"] {
  const f = num(/pieno al\s+(\d+)%/.exec(s)?.[1]);
  const v = num(/urto\s+(\d+(?:,\d+)?)\s+m\/s/.exec(s)?.[1]);
  const sh = /tirata dopo l'urto\s+(\d+(?:,\d+)?)\s+m(\s+\(fuori gioco\))?/.exec(s);
  const tg = /colpita\s+(\d+(?:,\d+)?)\s+m(\s+\(fuori gioco\))?/.exec(s);
  if (f === null || v === null || !sh || !tg) return null;
  return { fullness: f / 100, speed: v, shooterTravel: num(sh[1])!, targetTravel: num(tg[1])!, shooterOut: !!sh[2], targetOut: !!tg[2] };
}
