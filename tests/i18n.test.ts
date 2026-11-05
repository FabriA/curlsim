import { describe, expect, it } from "vitest";
import { it as itDict } from "../src/i18n/it";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { fr } from "../src/i18n/fr";
import { LANGS, numIn, setLanguage, t, tIn, tt } from "../src/i18n";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("traduzioni", () => {
  for (const [code, dict] of [["en", en], ["de", de], ["fr", fr]] as const) {
    it(`${code}: stesse chiavi e stessi segnaposto dell'italiano, nessun testo vuoto`, () => {
      const bad: string[] = [];
      for (const k of Object.keys(itDict) as (keyof typeof itDict)[]) {
        const v = (dict as Record<string, string>)[k];
        if (!v || !v.trim()) bad.push(`${k}: mancante`);
        else if (placeholders(v) !== placeholders(itDict[k])) bad.push(`${k}: segnaposto ${placeholders(v)} invece di ${placeholders(itDict[k])}`);
      }
      expect(bad).toEqual([]);
      expect(Object.keys(dict).length).toBe(Object.keys(itDict).length);
    });
  }

  it("il selettore offre le quattro lingue", () => {
    expect(LANGS.map((l) => l.code)).toEqual(["it", "en", "de", "fr"]);
  });

  it("cambio di lingua: t segue la lingua, tIn resta fissa, tt si ricalcola", () => {
    const msg = tt("status.done", { n: 3 });
    setLanguage("en");
    expect(t("shot.throw")).toBe("Throw");
    expect(msg()).toBe("Shot 3 finished.");
    expect(tIn("it", "shot.throw")).toBe("Tira");
    setLanguage("de");
    expect(msg()).toBe("Stein 3 beendet.");
    setLanguage("it");
    expect(msg()).toBe("Tiro 3 concluso.");
  });

  it("numeri: virgola in italiano, tedesco e francese, punto in inglese", () => {
    expect(numIn("it", 2.5, 2)).toBe("2,50");
    expect(numIn("de", 2.5, 2)).toBe("2,50");
    expect(numIn("fr", 2.5, 2)).toBe("2,50");
    expect(numIn("en", 2.5, 2)).toBe("2.50");
  });
});
