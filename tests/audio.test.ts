import { describe, expect, it } from "vitest";
import { slideMapping } from "../src/lab/audio";
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
