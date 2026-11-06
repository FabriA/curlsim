import { describe, expect, it } from "vitest";
import { impactModel, slideMapping } from "../src/lab/audio";
import { SLIDE_WAV_BASE64 } from "../src/lab/sounds/slide";

describe("suono dello scivolamento", () => {
  it("il volume cresce con la velocità e tace sotto 0,015 m/s; la pietra lenta è più scura", () => {
    expect(slideMapping(0.01).gain).toBe(0);
    expect(slideMapping(2).gain).toBe(1);
    expect(slideMapping(1).gain).toBeLessThan(1);
    expect(slideMapping(0.3).cutoff).toBeLessThan(slideMapping(2).cutoff);
    expect(slideMapping(10).cutoff).toBe(1200);
    expect(slideMapping(0).cutoff).toBe(300);
  });

  it("il loop incluso è un WAV mono a 16 kHz di 16 s", () => {
    const b = Buffer.from(SLIDE_WAV_BASE64, "base64");
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    expect(b.readUInt16LE(22)).toBe(1); // canali
    expect(b.readUInt32LE(24)).toBe(16000); // frequenza
    const seconds = (b.length - 44) / (2 * 16000);
    expect(Math.round(seconds)).toBe(16);
  });
});

describe("suono degli urti", () => {
  const fixed = () => 0.5;
  const energy = (m: ReturnType<typeof impactModel>, lo: number, hi: number) =>
    m.partials.filter((p) => p.freq >= lo && p.freq < hi).reduce((a, p) => a + p.amp * p.amp * p.decay, 0);
  it("più forte l'urto, più alto il volume e più chiaro il suono", () => {
    const weak = impactModel(0.1, fixed);
    const strong = impactModel(1, fixed);
    expect(energy(strong, 0, 20000)).toBeGreaterThan(energy(weak, 0, 20000));
    const bright = (m: ReturnType<typeof impactModel>) => energy(m, 2000, 20000) / energy(m, 500, 1000);
    expect(bright(strong)).toBeGreaterThan(bright(weak));
    expect(strong.click.cutoff).toBeGreaterThan(weak.click.cutoff);
  });
  it("suono basso: l'energia sta tra 250 e 800 Hz, con poca energia sopra 1 kHz e una breve risonanza", () => {
    const m = impactModel(0.6, fixed);
    expect(energy(m, 250, 800)).toBeGreaterThan(10 * energy(m, 1000, 20000));
    expect(energy(m, 250, 800)).toBeGreaterThan(energy(m, 0, 250));
    expect(m.partials.every((p) => p.decay < 0.15)).toBe(true);
  });
});
