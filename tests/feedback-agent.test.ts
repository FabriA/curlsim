import { describe, expect, it } from "vitest";
import { formatReport, type FeedbackRecord, type ShotFacts } from "../src/lab/feedback-model";
import { REFERENCE_HASH, referenceReplay } from "../src/core/reference";
import { COLLISIONS, CURVES } from "../src/core/params";
import { parseReport } from "../tools/feedback-agent/parse";
import { addReport, band, collisionsOf, curveOf, emptyDataset, impactSpeedBand, questionKey, questionStats, recommendations, rollStats, settingsOf } from "../tools/feedback-agent/evaluate";
import { messageMarkdown, summaryMarkdown } from "../tools/feedback-agent/report";

const fmt = (n: number, d: number) => n.toFixed(d).replace(".", ",");
const facts = (over: Partial<ShotFacts>): ShotFacts => ({
  n: 1, speed: 3, hit: true, removedOthers: 1, sweepTime: 0, spinTurns: 3.5, stopped: true, outcome: "In gioco",
  hash: REFERENCE_HASH, ice: { hogToHog: 14.5, curl: 1.2 }, sweepGain: 2.15, ...over,
});
const roll = (n: number, fullness: number, answer: string): FeedbackRecord => ({
  facts: facts({ n, impact: { targetId: 0, fullness, speed: 2.8, shooterTravel: 1.3, targetTravel: 4, shooterOut: false, targetOut: true } }),
  kind: "takeout",
  answers: [{ question: "Dopo l'urto, la distanza percorsa dalla pietra tirata è…", answer }],
  comment: "",
  at: "",
});
const report = (records: FeedbackRecord[]) =>
  formatReport(records, { app: "0.2.2", engine: "0.2.0" }, (k) => ({ draw: "Draw", sweptDraw: "Draw spazzato", takeout: "Bocciata", raise: "Raise o freeze" })[k], fmt);

describe("agente delle segnalazioni: lettura", () => {
  it("riconosce il rapporto e ne legge tiri, urto, risposte, commento e replay", () => {
    const replay = referenceReplay();
    const r = parseReport(report([{ ...roll(2, 0.5, "Troppo lungo"), facts: { ...roll(2, 0.5, "x").facts, replay }, comment: "Rotola troppo" }]))!;
    expect(r.app).toBe("0.2.2");
    const s = r.shots[0];
    expect(s.n).toBe(2);
    expect(s.kind).toBe("Bocciata");
    expect(s.speed).toBe(3);
    expect(s.impact?.fullness).toBe(0.5);
    expect(s.impact?.targetOut).toBe(true);
    expect(s.answers[0].answer).toBe("Troppo lungo");
    expect(s.comment).toBe("Rotola troppo");
    expect(s.replay?.seed).toBe(replay.seed);
    expect(s.collisions).toBeNull(); // rapporto senza l'indicazione: versioni fino alla 0.2.2
  });

  it("legge la vivacità degli urti", () => {
    const r = parseReport(report([{ ...roll(1, 1, "Giusto"), facts: { ...roll(1, 1, "x").facts, collisions: "normali" } }]))!;
    expect(r.shots[0].collisions).toBe("normali");
    expect(r.shots[0].outcome).toBe("In gioco");
  });

  it("riunisce un replay spezzato su più righe e ignora le citazioni di una risposta", () => {
    const text = report([{ ...roll(1, 1, "Giusto"), facts: { ...roll(1, 1, "x").facts, replay: referenceReplay() } }]);
    const wrapped = text
      .split("\n")
      .flatMap((l) => (l.startsWith("Tiro 1: {") ? [l.slice(0, 300), l.slice(300, 900), l.slice(900)] : [l]))
      .map((l) => "> " + l)
      .join("\r\n");
    expect(parseReport(wrapped)!.shots[0].replay).not.toBeNull();
  });

  it("un testo qualsiasi non è un rapporto", () => {
    expect(parseReport("Ciao, ecco le foto della partita.")).toBeNull();
  });

  it("un replay manomesso viene scartato con un avviso", () => {
    const text = report([roll(1, 1, "Giusto")]) + "\nReplay:\n\nTiro 1: {\"format\":\"altro\"}\n";
    const s = parseReport(text)!.shots[0];
    expect(s.replay).toBeNull();
    expect(s.warnings.length).toBe(1);
  });
});

describe("agente delle segnalazioni: valutazione", () => {
  it("riesegue il replay e conferma l'hash; elabora ogni messaggio una sola volta", () => {
    const text = report([{ ...roll(1, 1, "Giusto"), facts: { ...roll(1, 1, "x").facts, replay: referenceReplay() } }]);
    let ds = addReport(emptyDataset(), "abc", "2026-11-04T08:00:00Z", parseReport(text)!);
    ds = addReport(ds, "abc", "2026-11-04T08:00:00Z", parseReport(text)!);
    expect(ds.shots.length).toBe(1);
    expect(ds.shots[0].rerunHash).toBe(REFERENCE_HASH);
    expect(ds.shots[0].replayCheck).toBe("identico"); // senza result.hash si confronta con l'hash scritto nel rapporto
  });

  it("raggruppa le domande che differiscono solo per i numeri", () => {
    expect(questionKey("Spazzata per 16,6 s: l'allungamento del tiro è…")).toBe(questionKey("Spazzata per 3,2 s: l'allungamento del tiro è…"));
  });

  it("con tre colpi a mezza pietra giudicati troppo lunghi propone di alzare l'attrito tra le pietre", () => {
    const ds = addReport(emptyDataset(), "m1", "2026-11-04T08:00:00Z", parseReport(report([roll(1, 0.5, "Troppo lungo"), roll(2, 0.45, "Troppo lungo"), roll(3, 0.55, "Troppo lungo"), roll(4, 0.95, "Giusto")]))!);
    const rs = rollStats(ds.shots);
    expect(rs.find((r) => r.band === "mezza pietra")?.n).toBe(3);
    const rec = recommendations(questionStats(ds.shots), rs);
    expect(rec.some((r) => r.includes("attrito tra le pietre"))).toBe(true);
    expect(rec.some((r) => r.includes("colpi pieni"))).toBe(false);
  });

  it("con poche risposte non propone nulla", () => {
    const ds = addReport(emptyDataset(), "m1", "2026-11-04T08:00:00Z", parseReport(report([roll(1, 0.5, "Troppo lungo")]))!);
    expect(recommendations(questionStats(ds.shots), rollStats(ds.shots))).toEqual([]);
  });

  it("ricava gli urti dai valori del replay, non dall'etichetta del rapporto", () => {
    const rep = referenceReplay();
    const normal = { ...rep, params: { ...rep.params, restitution: 0.95, restitutionSecondary: 0.97 } };
    expect(collisionsOf({ replay: normal, collisions: "vivaci" })).toBe("normali");
    expect(collisionsOf({ replay: { ...rep, params: { ...rep.params, restitution: 0.9 } }, collisions: null })).toBe("vivaci");
    expect(collisionsOf({ replay: { ...rep, params: { ...rep.params, restitution: 0.85, restitutionSecondary: 0.6 } }, collisions: null })).toMatch(/prima versione/);
    expect(collisionsOf({ replay: null, collisions: null })).toBe("vivaci");
  });

  it("segnala un giudizio netto anche senza misure dell'urto, separato per impostazione degli urti", () => {
    const noImpact = (n: number, answer: string, collisions?: string): FeedbackRecord => ({ ...roll(n, 1, answer), facts: { ...facts({ n, collisions }), impact: null } });
    const ds = addReport(emptyDataset(), "m1", "2026-11-04T08:00:00Z", parseReport(report([noImpact(1, "Troppo lungo"), noImpact(2, "Troppo lungo"), noImpact(3, "Troppo lungo"), noImpact(4, "Giusto", "normali")]))!);
    const rec = recommendations(questionStats(ds.shots), rollStats(ds.shots));
    expect(rec.length).toBe(1);
    expect(rec[0].startsWith("[urti vivaci] «Dopo l'urto, la distanza")).toBe(true);
    expect(rec[0].includes("100% di 3 risposte")).toBe(true);
  });

  it("le fasce di pienezza seguono le soglie 75% e 35%", () => {
    expect(band(0.8)).toBe("pieno");
    expect(band(0.5)).toBe("mezza pietra");
    expect(band(0.2)).toBe("sottile");
  });

  it("i rapporti in Markdown contengono indicazioni, tabelle e schede, senza indirizzi e-mail", () => {
    const ds = { ...addReport(emptyDataset(), "m1", "2026-11-04T08:00:00Z", parseReport(report([roll(1, 0.5, "Troppo lungo"), roll(2, 0.5, "Troppo lungo"), roll(3, 0.5, "Troppo lungo")]))!), updated: "2026-11-04 08:00 UTC" };
    const md = summaryMarkdown(ds);
    expect(md.includes("## Indicazioni")).toBe(true);
    expect(md.includes("| vivaci | mezza pietra | 3 |")).toBe(true);
    expect(md.includes("@")).toBe(false);
    expect(messageMarkdown("m1", ds.shots).includes("## Tiro 1 · Bocciata")).toBe(true);
  });
});

describe("forma della curva nei rapporti", () => {
  it("la riga del tiro riporta la curva e il lettore la legge", () => {
    const text = report([{ facts: facts({ collisions: "normali", curve: "molto netta" }), kind: "draw", answers: [], comment: "", at: "" }]);
    expect(text).toMatch(/· curva molto netta/);
    expect(parseReport(text)!.shots[0].curve).toBe("molto netta");
  });
  it("dal replay: senza curlExp è la classica e non separa le statistiche", () => {
    const r = referenceReplay();
    expect(curveOf({ replay: r })).toBe("classica");
    expect(settingsOf({ replay: r })).toBe(collisionsOf({ replay: r }));
    const late = { ...r, params: { ...r.params, curlExp: 1 as const, spinGain: 0.2 } };
    expect(settingsOf({ replay: late })).toBe(`${collisionsOf({ replay: late })}, curva netta`);
  });
});

describe("modello 0.4 nei rapporti", () => {
  it("urti smorzati e curva dai giri si riconoscono dal replay", () => {
    const r = referenceReplay();
    const p = { ...r, params: { ...r.params, ...COLLISIONS.soft, ...CURVES.spin } };
    expect(collisionsOf({ replay: p })).toBe("smorzati");
    expect(curveOf({ replay: p })).toBe("dai giri");
    expect(settingsOf({ replay: p })).toBe("smorzati, curva dai giri");
  });
  it("fasce di velocità d'impatto", () => {
    expect(impactSpeedBand(0.3)).toBe("sotto 0,5 m/s");
    expect(impactSpeedBand(0.7)).toBe("0,5–0,8 m/s");
    expect(impactSpeedBand(1)).toBe("0,8–1,2 m/s");
    expect(impactSpeedBand(2)).toBe("sopra 1,2 m/s");
  });
});
