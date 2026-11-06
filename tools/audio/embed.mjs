// Genera src/lab/sounds/slide.ts dal WAV a 16 kHz: il suono viaggia nel codice, così funziona
// anche nella pagina singola del laboratorio (senza file separati) e si carica solo quando serve.
import { readFileSync, writeFileSync } from "node:fs";
const wav = readFileSync(new URL("../../assets/audio/slide-loop-2mps-16k.wav", import.meta.url));
const out = new URL("../../src/lab/sounds/slide.ts", import.meta.url);
writeFileSync(
  out,
  "// File generato da tools/audio/embed.mjs: non modificare a mano.\n" +
    "/** Scivolamento della pietra: loop WAV mono 16 kHz, riferimento 2 m/s (assets/audio/LEGGIMI.md). */\n" +
    `export const SLIDE_WAV_BASE64 =\n  "${wav.toString("base64")}";\n`,
);
console.log(`scritto ${out.pathname} (${wav.length} byte di WAV)`);
