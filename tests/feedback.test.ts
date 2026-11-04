import { describe, expect, it } from "vitest";
import { classify, DEVELOPER_EMAIL, formatReport, mailtoHref, questionsFor, type ShotFacts } from "../src/lab/feedback-model";
import { SHOT_PRECISION } from "../src/core/params";

const base: ShotFacts = {
  n: 1, speed: 2.03, hit: false, removedOthers: 0, sweepTime: 0, spinTurns: 3.5, stopped: true,
  outcome: "In gioco", hash: "abcd1234", ice: { hogToHog: 14.5, curl: 1.2 }, sweepGain: 2.15,
};
const fmt = (n: number, d: number) => n.toFixed(d);

describe("questionario sul realismo", () => {
  it("riconosce draw, draw spazzato, bocciata e raise", () => {
    expect(classify(base)).toBe("draw");
    expect(classify({ ...base, sweepTime: 3 })).toBe("sweptDraw");
    expect(classify({ ...base, speed: 3 })).toBe("takeout");
    expect(classify({ ...base, hit: true, removedOthers: 1 })).toBe("takeout");
    expect(classify({ ...base, hit: true })).toBe("raise");
  });

  it("un draw chiede punto di curva, chiusura e peso", () => {
    const ids = questionsFor("draw", base, fmt).map((q) => q.id);
    expect(ids).toEqual(["draw.breakPoint", "draw.finish", "draw.weight"]);
  });

  it("una bocciata che colpisce chiede curva, direzione e distanza del rotolamento", () => {
    const f = { ...base, speed: 3, hit: true, removedOthers: 1 };
    expect(questionsFor("takeout", f, fmt).map((q) => q.id)).toEqual(["takeout.curl", "takeout.rollDir", "takeout.rollDist"]);
  });

  it("la domanda sulla rotazione compare solo con rotazione bassa o alta e senza urti", () => {
    expect(questionsFor("draw", { ...base, spinTurns: 1.5 }, fmt).some((q) => q.id === "spin.curl")).toBe(true);
    expect(questionsFor("draw", { ...base, spinTurns: 6.5 }, fmt).some((q) => q.id === "spin.curl")).toBe(true);
    expect(questionsFor("draw", base, fmt).some((q) => q.id === "spin.curl")).toBe(false);
    expect(questionsFor("raise", { ...base, hit: true, spinTurns: 1.5 }, fmt).some((q) => q.id === "spin.curl")).toBe(false);
  });

  it("ogni domanda offre «Non so»", () => {
    for (const k of ["draw", "sweptDraw", "takeout", "raise"] as const) {
      for (const q of questionsFor(k, { ...base, hit: k !== "draw" && k !== "sweptDraw", spinTurns: 1.5 }, fmt)) {
        expect(q.answers.includes("fb.a.dontKnow")).toBe(true);
      }
    }
  });

  it("il rapporto contiene tiro, parametri, risposte e commento", () => {
    const text = formatReport(
      [{ facts: base, kind: "draw", answers: [{ question: "Chiusura", answer: "Giusto" }], comment: "Ok", at: "" }],
      { app: "0.2.1", engine: "0.2.0" },
      () => "Draw",
      fmt,
    );
    expect(text.includes("Tiro 1 · Draw")).toBe(true);
    expect(text.includes("hash abcd1234")).toBe(true);
    expect(text.includes("Chiusura → Giusto")).toBe(true);
    expect(text.includes("Commento: Ok")).toBe(true);
  });

  it("il link e-mail va allo sviluppatore con oggetto e testo codificati", () => {
    const href = mailtoHref("CurlSim – giudizi", "a & b");
    expect(href.startsWith(`mailto:${DEVELOPER_EMAIL}?subject=`)).toBe(true);
    expect(href.includes("a%20%26%20b")).toBe(true);
  });

  it("il livello «Perfetto» è il primo e non ha errori", () => {
    expect(Object.keys(SHOT_PRECISION)[0]).toBe("perfect");
    expect(SHOT_PRECISION.perfect).toEqual({ lineSigma: 0, weightSigma: 0 });
  });
});
