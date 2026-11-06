// Genera i moduli dei suoni in src/lab/sounds/ dai WAV in assets/audio: i suoni viaggiano nel
// codice, così funzionano anche nella pagina singola del laboratorio, e si caricano solo quando servono.
import { readFileSync, writeFileSync } from "node:fs";
const sounds = [
  { wav: "slide-loop-2mps-16k.wav", out: "slide.ts", name: "SLIDE_WAV_BASE64", doc: "Scivolamento della pietra: loop WAV mono 16 kHz, riferimento 2 m/s" },
  { wav: "collision.wav", out: "collision.ts", name: "COLLISION_WAV_BASE64", doc: "Urto tra due pietre: WAV mono 48 kHz, circa 0,3 s" },
];
for (const s of sounds) {
  const wav = readFileSync(new URL(`../../assets/audio/${s.wav}`, import.meta.url));
  const out = new URL(`../../src/lab/sounds/${s.out}`, import.meta.url);
  writeFileSync(
    out,
    "// File generato da tools/audio/embed.mjs: non modificare a mano.\n" +
      `/** ${s.doc} (assets/audio/LEGGIMI.md). */\n` +
      `export const ${s.name} =\n  "${wav.toString("base64")}";\n`,
  );
  console.log(`scritto ${out.pathname} (${wav.length} byte di WAV)`);
}
