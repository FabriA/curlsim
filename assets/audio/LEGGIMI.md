# Suoni

- `collision-original.wav` — urto tra due pietre, fornito dallo sviluppatore (6 novembre 2026): mono 48 kHz, 0,33 s.
  Colpo secco, energia soprattutto tra 300 e 1000 Hz (picchi a circa 325, 550 e 716 Hz), un secondo piccolo colpo a 75 ms.
- `collision.wav` — lo stesso, tagliato 6 ms prima dell'attacco e con una dissolvenza negli ultimi 50 ms; genera `src/lab/sounds/collision.ts`.
  Nel gioco: volume e brillantezza dalla forza dell'urto (filtro passa-basso da circa 2,5 kHz per gli urti lenti a 11 kHz
  per quelli violenti), altezza variata di ±4% a ogni urto.

- `slide-loop-2mps-48k.wav` — scivolamento della pietra, loop continuo di 16 s, mono 48 kHz, riferimento 2 m/s.
  Ricostruzione sintetica fornita dallo sviluppatore (6 novembre 2026), in attesa di una registrazione su una pietra reale.
  Corpo principale tra circa 40 e 230 Hz.
- `slide-loop-2mps-48k-smooth.wav` — lo stesso loop senza la pulsazione ritmica (circa 3 e 5,6 Hz) che lo faceva
  sembrare un motore: `python3 tools/audio/smooth.py <originale> <uscita>`.
- `slide-loop-2mps-16k.wav` — il loop senza pulsazione ricampionato a 16 kHz (soxr), da cui si genera `src/lab/sounds/slide.ts`.
  Il ricampionamento è fatto su tre copie consecutive prendendo quella centrale, così il loop resta senza giunture.

Per sostituire il suono:

```
python3 tools/audio/smooth.py nuovo.wav nuovo-smooth.wav
ffmpeg -stream_loop 2 -i nuovo-smooth.wav -af aresample=16000:resampler=soxr -ac 1 -c:a pcm_s16le tri.wav
ffmpeg -i tri.wav -ss <durata> -t <durata> -c:a pcm_s16le assets/audio/slide-loop-2mps-16k.wav
node tools/audio/embed.mjs
```

Nel gioco l'altezza del loop non cambia con la velocità (salendo di tono sembrava un motore che accelera):
con la velocità cambiano il volume e la brillantezza (filtro passa-basso da circa 300 Hz da ferma a 1200 Hz
sopra 2,5 m/s). Ogni pietra ha una piccola differenza d'altezza fissa (±3%), così due pietre non suonano uguali.

La spazzata è sintetizzata (rumore filtrato tra circa 2 e 3 kHz, modulato a 5 Hz): un campione provato il 6 novembre 2026 è stato scartato.
