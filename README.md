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
  end.ts           regole dell'end: ordine di tiro, hammer, FGZ, no-tick, punteggio, annulla
  delivery.ts      fase di consegna dalla back line al rilascio e intertempo back-to-hog
  calibrate.ts     calibrazione su tempo hog-to-hog e curva di un draw
  rng.ts           generatore con seme, solo operazioni intere
  reference.ts     replay di riferimento per il controllo di determinismo
src/i18n/        stringhe dell'interfaccia (italiano)
src/lab/         laboratorio 2D (canvas); placement-tool.ts è lo strumento di trascinamento riusabile
tests/           calibrazione, plausibilità, urti, regole, determinismo
```

## Modello fisico v1

- **Decelerazione:** attrito costante `μ·g`; `μ` si ricava in forma chiusa dal tempo hog-to-hog di un draw al tee.
- **Curl (dal motore 0.3.0):** accelerazione laterale `K · A(giri) / (v + v₀)^n(giri)` verso destra per rotazione oraria,
  più forte a bassa velocità. Forma `n` e quantità `A` dipendono dai giri (tabella `SPIN_CURVE`): fino a 2 giri la pietra
  curva subito e di più (n 0,5, +25%), con 3–5 giri ha il finale netto (n 1, curva del profilo), con 10 giri va dritta
  più a lungo e chiude più forte (n 1,5, +25%), lo spinner con 25 giri curva quasi tutto nel finale (+50%). La deriva
  non supera il 90% dell'attrito, così ogni pietra si ferma e la curva massima ha un tetto (circa 2,2 m). `K` si calibra
  per bisezione sulla curva di un draw con 3,5 giri. I replay dei motori precedenti (curva `K / √(v + v₀)`, oppure
  le curve «netta» e «molto netta») si riproducono come prima.
- **Linea di tiro:** parte dalla staffa (hack) all'estremità di consegna e passa per la scopa dello skip; il moto libero inizia quando la pietra raggiunge la hog line di consegna.
- **Rotazione:** decresce in proporzione alla velocità. Quattro livelli, espressi in giri su un draw dal rilascio all'arresto: bassa (1–2, predefinito 1,5), normale (3–4, predefinito 3,5), alta (5–8, predefinito 6,5), spinner (25); oppure un numero di giri a scelta, fino a 80.
- **Spazzata:** riduce attrito e curl della pietra spazzata. L'effetto dipende dal livello degli sweeper, espresso
  come metri guadagnati spazzando una guardia a 1,9 m/s dal rilascio all'arresto: principianti 1,0–1,7 m
  (predefinito 1,35), club 1,8–2,5 m (2,15), élite 2,6–3,1 m (2,85), oppure un valore a scelta. Il fattore d'attrito
  si ricava da quel guadagno per ogni profilo di ghiaccio.
- **Precisione del tiro:** errore di linea alla scopa (distinto per draw e bocciate, da 2,6 m/s) ed errore di peso
  espresso come distanza all'arresto, con la miscela di Brunner (2024): 30% dei tiri con un terzo del valore tipico,
  63% con il valore tipico, 7% con 10/3 del valore tipico. Livelli: perfetto (nessun errore), élite (linea 10/5 cm,
  peso 30 cm, valori di Brunner), club (20/10 cm, 60 cm), principiante (35/18 cm, 105 cm), oppure valori a scelta.
  spazza solo chi tira, solo la pietra appena consegnata, solo davanti alla tee line.
- **Urti:** impulso normale con restituzione e impulso tangenziale con attrito di Coulomb tra le pietre
  (scambio di rotazione); più passate per le catene. Con «Normali, urti lenti smorzati» (predefiniti) la restituzione
  vale 0,55 fino a 0,4 m/s di velocità relativa e sale in modo lineare fino a quella normale (0,95 / 0,97) a 1,1 m/s.

I valori sono approssimazioni su valori tipici di gioco, da validare con misure su ghiaccio.

## Lingue

Le stringhe dell'interfaccia sono in `src/i18n/` (`it.ts` è il riferimento; `en.ts`, `de.ts`, `fr.ts` hanno le stesse chiavi,
controllate dai test insieme ai segnaposto). Per aggiungere una lingua: un nuovo file con tutte le chiavi, la voce in `LANGS`
e la bandiera in `src/lab/lang-picker.ts`. Il rapporto dei giudizi resta sempre in italiano.

## Partita (fasi 2 e 3)

Nell'intestazione si passa da **Laboratorio** a **Partita**: due giocatori sullo stesso dispositivo giocano una partita
di più end (8 per impostazione, da 1 a 12) con il preset «World Curling 2026 — adattamento v1».

- **Tabellone:** una colonna per end, gli extra end con «X», il totale; una barra indica chi aveva l'ultima pietra.
  Sopra, per l'end in corso: pietre rimaste, hammer, turno e giocatore al tiro.
- **Free guard zone (R6):** prima della sesta pietra una guardia avversaria nella FGZ non può essere portata fuori gioco;
  altrimenti la pietra tirata è rimossa e le pietre spostate tornano al loro posto. La zona è evidenziata sulla pista.
- **No-tick (R7):** una guardia avversaria nella FGZ che tocca la linea centrale non può esserne spostata; la squadra
  che subisce sceglie se lasciare le pietre o ripristinarle. Se la guardia esce dal gioco vale la FGZ.
- **Punteggio (R12) e hammer (R5 a):** a fine end le pietre che contano sono segnate; **End successivo** assegna
  l'ultima pietra alla squadra che non ha segnato (dopo un end nullo resta). Dopo l'ultimo end la partita finisce,
  salvo parità con l'extra end attivo; un extra end nullo ne richiede un altro. Senza extra end la parità è un pareggio.
- **Giocatori:** pietre 1–2 lead, 3–4 second, 5–6 third, 7–8 skip. Ognuno ha un livello di tiro (precisione) e di
  spazzata, oppure un solo livello per tutta la squadra. Spazzano i due compagni che non tengono la scopa: lo skip la
  tiene per lead, second e third, il third per lo skip; il guadagno della spazzata è la media dei due.
- **Salvataggio:** la partita si salva da sola nel browser a ogni tiro e riprende tornando alla modalità Partita.
  **Copia partita** produce un file `curling-match` con le regole, gli end giocati, l'end in corso e i replay di tutti
  i tiri; si riapre con **Carica replay o posizione** (anche per riprodurre un errore).
- **Annulla l'ultimo tiro** riporta le pietre a prima della consegna; un tiro interrotto con **Ferma** non conta.

## Suoni

Il pulsante con l'altoparlante nell'intestazione attiva o disattiva i suoni (sintetizzati con la Web Audio API, senza
file): scivolamento della pietra, urti tra pietre, spazzata. La scelta resta memorizzata; i suoni non influiscono
sulla simulazione.

## Posizionamento delle pietre

Nel pannello **Pietre in gioco** si sceglie lo strumento attivo sulla casa:

- **Posiziona le pietre:** tocca un punto libero per aggiungere una pietra della squadra scelta e trascinala;
  trascina una pietra per spostarla; portala oltre la back line o sulla linea laterale, oppure toccala due volte, per toglierla.
  Le posizioni devono essere in gioco secondo R2 e senza sovrapposizioni; al massimo 8 pietre per squadra.
- **Prossimo tiro** indica la squadra che tira; dopo ogni tiro passa all'altra.
- **Copia posizione** salva la disposizione come scenario JSON (`curling-scenario`); **Carica** accetta sia replay sia scenari.

La logica sta in `src/core/placement.ts` e lo strumento d'interfaccia in `src/lab/placement-tool.ts`,
pronti per la modalità di allenamento.

## Invio dei giudizi senza mail

Il pulsante **Invia allo sviluppatore** del riquadro «Il tuo giudizio» manda il rapporto (risposte e replay)
alla funzione `api/feedback.ts`, ospitata da Vercel nello stesso progetto. La funzione controlla che sia un
rapporto, lo salva nel repository come `reports/feedback/inbox/<data>-<hash>.txt` e il commit avvia l'agente.
I tester non hanno bisogno di un account GitHub né della posta. Non si salvano indirizzi IP o altri dati del
mittente; un rapporto identico già ricevuto non viene salvato due volte; c'è un limite di invii all'ora per
istanza e, se si vuole, un codice condiviso con i tester. Se l'invio non riesce resta «Invia per e-mail».

**Configurazione (una volta), su Vercel → progetto → Settings → Environment Variables**, ambiente Production:

| Variabile | Valore |
| --- | --- |
| `GITHUB_TOKEN` | token fine-grained di GitHub con accesso solo a questo repository e permesso «Contents: Read and write» |
| `GITHUB_REPO` | facoltativa, predefinita `FabriA/curlsim` |
| `GITHUB_BRANCH` | facoltativa, predefinita `main` |
| `FEEDBACK_CODE` | facoltativa: se c'è, l'invio chiede questo codice ai tester |

Dopo aver aggiunto o cambiato le variabili serve un nuovo deploy (**Deployments → … → Redeploy**).
Senza `GITHUB_TOKEN` la funzione risponde 503 e il laboratorio propone la mail.

## Agente delle segnalazioni

`tools/feedback-agent/` legge i rapporti arrivati dal laboratorio in `reports/feedback/inbox/` e, se configurata,
la casella dei giudizi via IMAP, **in sola lettura** (nessun messaggio viene spostato, cancellato o segnato come
letto). Riconosce i rapporti «CurlSim – giudizi sui tiri», riesegue i replay
con il motore attuale, aggrega le risposte e scrive i risultati in `reports/feedback/`
(`SUMMARY.md`, una scheda per messaggio in `messages/`, `data.json`). Ogni messaggio è elaborato una sola volta.
Le indicazioni sul modello sono proposte da verificare: l'agente non modifica mai i parametri.

GitHub Actions lo esegue a ogni rapporto salvato in `reports/feedback/inbox/`, ogni due ore e su richiesta
(`.github/workflows/feedback-agent.yml`), e pubblica i rapporti nuovi con un commit.
Vercel ignora i commit che toccano solo `reports/` (`vercel.json`), quindi non parte un deploy a ogni aggiornamento.

**Posta (facoltativa):** senza `IMAP_HOST` l'agente legge solo i rapporti dal laboratorio. Per la casella, in GitHub, **Settings → Secrets and variables → Actions → New repository secret**:

| Segreto | Valore |
| --- | --- |
| `IMAP_HOST` | server IMAP del provider (per esempio `mail.example.ch`) |
| `IMAP_PORT` | facoltativo, predefinito `993` (TLS) |
| `IMAP_USER` | `curlsim@albonico.ch` |
| `IMAP_PASSWORD` | password della casella, meglio una password per applicazioni se il provider la offre |
| `IMAP_MAILBOX` | facoltativo, predefinito `INBOX` |

In **Settings → Actions → General → Workflow permissions** serve «Read and write permissions» perché l'agente
possa pubblicare i rapporti. Per una prima prova: **Actions → Agente segnalazioni → Run workflow**.

In locale: `npm run agent -- --file messaggio.txt` (o `.eml`) elabora un messaggio salvato, senza IMAP.

## Determinismo

Passo fisso di 1 ms, ordine stabile di risoluzione degli urti, input di spazzata registrati per tick,
generatore con seme e versione del motore nel replay. Il motore usa solo `+ − × ÷` e `Math.sqrt`.
`npm test` verifica che il replay di riferimento dia l'hash registrato in `src/core/reference.ts`;
il pulsante **Verifica determinismo** del laboratorio rifà lo stesso calcolo nel browser.
Se il comportamento fisico cambia, aggiornare `ENGINE_VERSION` e l'hash di riferimento.

Hash di riferimento `97156709` (motore 0.2.0) confermato identico in Node e nei browser: Chromium, Chrome per Android,
Edge, Firefox per Windows e per Android, Safari per iPhone.
