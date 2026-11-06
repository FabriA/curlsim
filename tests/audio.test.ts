import { describe, expect, it } from "vitest";
import { slideMapping } from "../src/lab/audio";
import { SLIDE_WAV_BASE64 } from "../src/lab/sounds/slide";

describe("suono dello scivolamento", () => {
  it("volume e altezza crescono con la velocità; silenzio sotto 0,015 m/s", () => {
    expect(slideMapping(0.01).gain).toBe(0);
    expect(slideMapping(2)).toEqual({ rate: 1, gain: 1 });
    expect(slideMapping(1).gain).toBeLessThan(1);
    expect(slideMapping(0.5).rate).toBeGreaterThan(0.87);
    expect(slideMapping(10).rate).toBeCloseTo(1.18, 9); // velocità limitata a 5 m/s
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
