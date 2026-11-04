# Registro delle versioni

## Non ancora rilasciato

Fase 2. Motore fisico invariato (0.2.0).

- **Modalità «End a due»:** due giocatori sullo stesso dispositivo giocano un end standard da 16 pietre.
  Tabellone con pietre rimaste e ultima pietra (hammer), turno evidenziato, numero della pietra.
- **Regole dell'end** in `src/core/end.ts`, senza interfaccia:
  ordine di tiro e hammer (R5 a), free guard zone (R6) con rimozione della pietra tirata e ripristino delle pietre spostate,
  no-tick (R7) con la scelta della squadra che subisce, punteggio (R12) con end nullo, annullamento dell'ultimo tiro.
  FGZ, numero di pietre protette e no-tick si attivano e disattivano.
- Zona FGZ evidenziata sulla pista finché è in vigore; pietre che contano segnate a fine end.
- Nuovo end con l'ultima pietra secondo R5 a: tira per prima la squadra che ha segnato; con un end nullo l'hammer non cambia.
- 22 nuovi test sulle regole dell'end, compreso un peel annullato dalla FGZ con la fisica vera.
- **Spazzata leggibile nei replay:** la riproduzione mostra la spazzata registrata (ombra e pulsante attivo);
  la traccia segna in blu i tratti spazzati; `result.swept` riporta gli intervalli di spazzata effettiva in secondi
  dal rilascio e `result.sweepTime` il totale. Il comando registrato resta in `sweep` (tick), come prima.
- **Ombra della spazzata** sempre davanti alla pietra, nella direzione del moto.
- **Icona del martello** (hammer) nel tabellone dell'end al posto della scritta «Ultima pietra».
- **Nuovo end** cancella dal ghiaccio le traiettorie dell'ultimo tiro.
- **Comandi su telefono:** nella barra in basso, accanto a «Tira», un pulsante per passare da in-turn a out-turn;
  subito sotto, il cursore del peso con velocità e punto d'arresto previsto. Durante la corsa restano solo «Spazza».
- Nuovo indirizzo per i giudizi sui tiri: curlsim@albonico.ch.
- **Agente delle segnalazioni** (`tools/feedback-agent/`): legge la casella via IMAP in sola lettura, riesegue i replay,
  aggrega i giudizi (anche il rotolamento per pienezza del colpo) e pubblica i rapporti in `reports/feedback/`.
  GitHub Actions lo esegue ogni due ore; Vercel ignora i commit dei soli rapporti.

## 0.2.2 — 4 novembre 2026

Motore fisico invariato (0.2.0): i replay delle versioni 0.2.x si riproducono identici.

- **Precisione «Perfetto»** come primo livello e predefinito; tolto il pulsante «Tiratore perfetto».
- **Questionario sul realismo** dopo ogni tiro, con domande scelte in base al tipo di tiro (draw, draw spazzato,
  bocciata, raise o freeze, rotazione bassa o alta) e risposte selezionabili. Le risposte restano nel browser,
  si copiano o si inviano per e-mail allo sviluppatore. Su telefono un pulsante «Valuta» porta alle domande.
- **Classificazione dei tiri corretta:** il tipo dipende dal peso. Da 2,6 m/s è una bocciata; sotto, un tiro che colpisce
  è un raise o freeze, anche se toglie una pietra («pietra rimossa»). Le domande sulla spazzata compaiono anche
  nei tiri con urto spazzati per almeno 1 s.
- **Misure dell'urto** nel rapporto e sopra le domande: pienezza del colpo, velocità della tirata all'urto,
  strada percorsa dopo l'urto dalla tirata e dalla colpita. Sono solo osservazioni: hash e replay non cambiano.
- **Replay sempre allegati** al rapporto, uno per ogni tiro valutato, da incollare in «Carica replay o posizione».
- **Intertempi in diretta** sopra la casa: back-to-hog durante la consegna e hog-to-hog durante la corsa,
  con il tempo che scorre finché la pietra non attraversa la linea. Il back-to-hog entra anche nel registro dei tiri.
- **Fase di consegna animata** dalla back line al rilascio, con decelerazione stimata della scivolata (0,1 m/s²,
  `src/core/delivery.ts`). Non entra nella fisica né nei replay.
- 78 test automatici.

## 0.2.1 — 4 novembre 2026

Motore fisico invariato (0.2.0): i replay della versione 0.2.0 si riproducono identici.

- **Spazzata per livello degli sweeper**, espressa come guadagno su una guardia a 1,9 m/s spazzata dal rilascio all'arresto:
  principianti 1,0–1,7 m (predefinito 1,35), club 1,8–2,5 m (2,15), élite 2,6–3,1 m (2,85), oppure un valore a scelta.
  Il fattore d'attrito si ricava dal guadagno per ogni profilo di ghiaccio. L'effetto predefinito è ridotto (da ×0,88 a ×0,92).
- **Precisione del tiro per livello:** principiante (40 cm, 5%), club (20 cm, 2,4%), élite (8 cm, 0,8%) o valori a scelta.
- **Posizionamento manuale delle pietre** con trascinamento, nel rispetto di R2 e senza sovrapposizioni, al massimo 8 per squadra;
  scelta della squadra del prossimo tiro; posizioni salvabili e caricabili come scenari JSON.
- **Uso su telefono:** riquadri richiudibili e barra fissa con «Tira» e «Spazza».
- La versione dell'applicazione e quella del motore compaiono separate nell'intestazione.
- 56 test automatici.

## 0.2.0 — 4 novembre 2026

- Linea di tiro dalla staffa all'estremità di consegna.
- Velocità di rotazione in tre livelli: bassa (1–2 giri su un draw), normale (3–4), alta (5–8), o personalizzata.
- Nuovo hash di riferimento: i replay 0.1.0 possono dare risultati diversi.

## 0.1.0 — 3 novembre 2026

- Fase 1: modello empirico di decelerazione, curl e spazzata, urti tra pietre, regole di uscita R2,
  replay deterministici con hash e laboratorio 2D.
