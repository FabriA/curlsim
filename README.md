# curlsim

Esperimento di vibe coding per un simulatore di curling. Lavori in corso.

## Fase 1 — laboratorio fisico 2D

Laboratorio fisico 2D: un profilo di ghiaccio, un modello di curl empirico, urti tra pietre,
regole di uscita (R2) e replay deterministici. È la base su cui si costruiscono l'end
giocabile (fase 2), la partita (fase 3) e l'IA (fase 4).

## Avvio in locale

Serve Node.js 20 o successivo.

```bash
npm install
npm run dev      # laboratorio su http://localhost:5173
npm test         # test automatici (Vitest)
npm run build    # controllo dei tipi + build di produzione in dist/
```

## Pubblicazione su Vercel

1. Collega il repository GitHub a Vercel (**Add New → Project → Import**).
2. Vercel riconosce Vite: comando di build `npm run build`, cartella di output `dist`.
3. Ogni push sul ramo principale pubblica una nuova versione; ogni pull request ha un'anteprima.

Il multiplayer (fase successiva) userà le WebSocket delle Vercel Functions con lo stato delle stanze in Redis.

## Struttura

```
src/core/        motore puro, senza grafica (usabile anche in Node e in un Web Worker)
  geometry.ts      misure del rink (World Curling, R1–R2, edizione 1 settembre 2026)
  params.ts        parametri del modello, profili di ghiaccio, versione del motore
  physics.ts       moto delle pietre, curl, spazzata, urti
  rules.ts         pietre fuori gioco (R2 f–h), separate dalla fisica
  sim.ts           tiro, simulazione passo-passo, replay, hash dello stato
  placement.ts     posizionamento manuale delle pietre e scenari salvabili
  calibrate.ts     calibrazione su tempo hog-to-hog e curva di un draw
  rng.ts           generatore con seme, solo operazioni intere
  reference.ts     replay di riferimento per il controllo di determinismo
src/i18n/        stringhe dell'interfaccia (italiano)
src/lab/         laboratorio 2D (canvas); placement-tool.ts è lo strumento di trascinamento riusabile
tests/           calibrazione, plausibilità, urti, regole, determinismo
```

## Modello fisico v1

- **Decelerazione:** attrito costante `μ·g`; `μ` si ricava in forma chiusa dal tempo hog-to-hog di un draw al tee.
- **Curl:** accelerazione laterale `K / √(v + v₀)` verso destra per rotazione oraria, più forte a bassa velocità;
  quasi indipendente dall'intensità della rotazione. `K` si calibra per bisezione sulla curva di un draw.
- **Linea di tiro:** parte dalla staffa (hack) all'estremità di consegna e passa per la scopa dello skip; il moto libero inizia quando la pietra raggiunge la hog line di consegna.
- **Rotazione:** decresce in proporzione alla velocità. Tre livelli, espressi in giri su un draw dal rilascio all'arresto: bassa (1–2, predefinito 1,5), normale (3–4, predefinito 3,5), alta (5–8, predefinito 6,5); oppure un numero di giri a scelta.
- **Spazzata:** riduce attrito e curl della pietra spazzata. Preset «World Curling 2026 — adattamento v1»:
  spazza solo chi tira, solo la pietra appena consegnata, solo davanti alla tee line.
- **Urti:** impulso normale con restituzione e impulso tangenziale con attrito di Coulomb tra le pietre
  (scambio di rotazione); più passate per le catene.

I valori sono approssimazioni su valori tipici di gioco, da validare con misure su ghiaccio.

## Posizionamento delle pietre

Nel pannello **Pietre in gioco** si sceglie lo strumento attivo sulla casa:

- **Posiziona le pietre:** tocca un punto libero per aggiungere una pietra della squadra scelta e trascinala;
  trascina una pietra per spostarla; portala oltre la back line o sulla linea laterale, oppure toccala due volte, per toglierla.
  Le posizioni devono essere in gioco secondo R2 e senza sovrapposizioni; al massimo 8 pietre per squadra.
- **Prossimo tiro** indica la squadra che tira; dopo ogni tiro passa all'altra.
- **Copia posizione** salva la disposizione come scenario JSON (`curling-scenario`); **Carica** accetta sia replay sia scenari.

La logica sta in `src/core/placement.ts` e lo strumento d'interfaccia in `src/lab/placement-tool.ts`,
pronti per la modalità di allenamento.

## Determinismo

Passo fisso di 1 ms, ordine stabile di risoluzione degli urti, input di spazzata registrati per tick,
generatore con seme e versione del motore nel replay. Il motore usa solo `+ − × ÷` e `Math.sqrt`.
`npm test` verifica che il replay di riferimento dia l'hash registrato in `src/core/reference.ts`;
il pulsante **Verifica determinismo** del laboratorio rifà lo stesso calcolo nel browser.
Se il comportamento fisico cambia, aggiornare `ENGINE_VERSION` e l'hash di riferimento.
