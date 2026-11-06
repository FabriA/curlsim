# Suoni

- `slide-loop-2mps-48k.wav` — scivolamento della pietra, loop continuo di 16 s, mono 48 kHz, riferimento 2 m/s.
  Ricostruzione sintetica fornita dallo sviluppatore (6 novembre 2026), in attesa di una registrazione su una pietra reale.
  Corpo principale tra circa 40 e 230 Hz.
- `slide-loop-2mps-16k.wav` — lo stesso loop ricampionato a 16 kHz (soxr), da cui si genera `src/lab/sounds/slide.ts`.
  Il ricampionamento è fatto su tre copie consecutive prendendo quella centrale, così il loop resta senza giunture.

Per sostituire il suono:

```
ffmpeg -stream_loop 2 -i nuovo.wav -af aresample=16000:resampler=soxr -ac 1 -c:a pcm_s16le tri.wav
ffmpeg -i tri.wav -ss <durata> -t <durata> -c:a pcm_s16le assets/audio/slide-loop-2mps-16k.wav
node tools/audio/embed.mjs
```
