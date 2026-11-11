# Registro delle versioni

## Non ancora rilasciato

Fase 3. **Motore fisico 0.4.0** (spazzata direzionale) e **0.3.0** curva che dipende dai giri e urti lenti smorzati. I replay registrati con i motori precedenti si riproducono come prima (l'app avvisa che il motore è diverso).

- **Comandi di tiro nuovi** (senza proposta automatica dello skip):
  - schede del tipo di tiro (Guardia, Draw, Freeze, Raise, Bocciata, Peel) che impostano il peso di partenza: Guardia ferma 1,5 m prima della casa, Draw al tee, Freeze 30 cm prima del tee, Raise fino alla hack line, Bocciata 3,0 m/s, Peel 3,8 m/s;
  - peso espresso in secondi, back-to-hog o tee-to-hog a scelta (impostazione «Tempo del peso», ricordata dal browser), con − e + da 0,05 s; la velocità in m/s resta accanto;
  - la scopa dello skip si trascina sulla casa (o si tocca un punto); è disegnata come una scopa moderna vista dall'alto (pad e manico), così non si confonde con il punto d'arrivo della pietra.
- **Errore del tiratore visibile** (abilità diverse da «Perfetto»): dopo il rilascio, nel riquadro degli intertempi sopra la casa compare per esempio «Errore di tiro: 32 cm a sinistra della scopa · 20 cm corto»; sulla casa un anello tratteggiato segna dove passa davvero la linea all'altezza della scopa. Nei draw il peso è la differenza d'arresto su un tiro dritto; nelle bocciate la differenza sull'intertempo scelto (es. «0,04 s più lento (back-to-hog)»). Nel registro dei tiri una colonna «Errore» in breve (es. «←32 · −20 cm»). Si ricava dal replay, quindi vale anche per i replay caricati.
- **Spazzata direzionale** (motore 0.4.0): sotto la casa, durante il tiro, un pad a tre zone. Al centro Hard (due sweeper), ai lati Curl (più curva) e Straight (meno curva) con un solo sweeper; il lato di Curl segue la rotazione. L'altezza del dito è l'intensità, dal 100% in alto al 30% in basso. Da tastiera: Spazio = Hard, frecce ← → = spazzata da quel lato.
  - Modello: con un solo sweeper la riduzione d'attrito è il 60% di quella di Hard e l'asimmetria tra i due lati spinge la pietra lontano dal lato spazzato (Sonobe et al. 2024). Spostamento laterale di una guardia spazzata da un lato dal rilascio all'arresto: 0,10 / 0,20 / 0,30 m per principianti / club / élite (ipotesi da tarare). Straight riduce anche la curva naturale, Curl no.
  - Su un draw corto di 4 m spazzato fino al tee (sweeper di club): Hard +2,1 m in lunghezza; Curl +31 cm di curva e +1,2 m; Straight −26 cm di curva e +1,3 m.
  - Il replay registra i comandi con modo e intensità (`sweepCmds`); i replay precedenti si riproducono identici (Hard al 100% è la spazzata di prima).
  - Il rapporto riporta i secondi per modo e chiede un giudizio su Curl e Straight; l'agente ha le indicazioni corrispondenti.
- **Curva dai giri** (motore 0.3.0), dalle indicazioni dei tester e dalla letteratura (Shegelski et al.: con 70–80 rotazioni circa il doppio della curva che con 5). Al posto del menu «Curva del draw», forma e quantità della curva dipendono dai giri. Sul ghiaccio normale (curva del profilo 1,2 m), draw al tee:

  | Giri | Curva | Negli ultimi 3 m | Il 10% della curva è raggiunto a | Arresto rispetto al tiro dritto |
  | --- | --- | --- | --- | --- |
  | 1,5 | 1,50 m (+25%) | 42% | 15,4 m dall'arresto | −0,11 m |
  | 3,5 (riferimento) | 1,20 m | 50% | 13,8 m | −0,11 m |
  | 6,5 | 1,32 m (+10%) | 56% | 12,8 m | −0,19 m |
  | 10 | 1,50 m (+25%) | 59% | 12,0 m | −0,27 m |
  | 25 (spinner) | 1,80 m (+50%) | 61% | 11,4 m | −0,40 m |
  | 50 | 2,00 m | 61% | 11,5 m | −0,47 m |

  - Con 3–5 giri è la curva «Finale più netto» provata dai tester (inizio e chiusura giudicati giusti 6 volte su 6).
  - La deriva non supera il 90% dell'attrito: con moltissimi giri la curva arriva a un tetto di circa 2,2 m (80 giri sul ghiaccio normale escono dal lato se tirati dal centro).
  - Nuovo livello di rotazione «Spinner (oltre 20 giri)», 25 giri; il campo dei giri arriva a 80.
  - Con più di 5 giri, sotto il peso compare quanto la pietra si ferma più corta rispetto al tiro dritto.
  - Domande del giudizio riscritte per rotazione bassa e alta, e una nuova per lo spinner.
  - Non si simula la perdita o l'inversione della rotazione con pochissimi giri.
- **Urti lenti smorzati** (motore 0.3.0), nuova impostazione predefinita «Normali, urti lenti smorzati»: dai giudizi sui raise la pietra colpita andava troppo lontano in tutti i 12 urti sotto 0,8 m/s, mentre sopra 0,9 m/s andava bene. Ora la restituzione vale 0,55 fino a 0,4 m/s di velocità relativa e sale fino a quella di «Normali» a 1,1 m/s. Sui 13 raise lenti già giudicati la pietra colpita percorre in media il 72% di prima; sopra 0,9 m/s la differenza resta sotto l'8%; bocciate e catene di freeze non cambiano. «Normali» e «Vivaci» restano selezionabili per il confronto.
- **Agente dei giudizi:** nuova tabella «Pietra colpita nei raise, per velocità d'impatto»; le indicazioni sulla curva fanno riferimento alla tabella dei giri invece che a curlV0; i replay di motori precedenti si ricontrollano (identico se l'hash coincide).
- **Domanda più chiara** sulla distanza dopo l'urto: «la pietra tirata (la tua, non quella colpita)».

- **Partita a più end** (al posto di «End a due»): numero di end a scelta (8 predefiniti), tabellone end per end con totale, hammer che passa secondo R5 a, extra end in caso di parità (un extra end nullo ne richiede un altro) o pareggio se l'extra end è disattivato, risultato finale e «Nuova partita».
- **Giocatori:** livello di tiro e di spazzata per lead, second, third e skip, oppure uno per tutta la squadra. Il giocatore al tiro dipende dal numero della pietra; spazzano i due compagni che non tengono la scopa.
- **Salvataggio della partita:** automatico nel browser a ogni tiro (la partita riprende da dove era rimasta) e «Copia partita», un file con regole, end giocati, end in corso e replay di tutti i tiri, da riaprire con «Carica replay o posizione».
- **Suoni** disattivabili dall'intestazione: scivolamento, urti, spazzata.
- **Scivolamento più realistico:** al posto del rumore sintetico, il loop fornito (ricostruzione a 2 m/s, corpo tra 40 e 230 Hz), una voce per ogni pietra in movimento, con volume e altezza che seguono la velocità. Urti e spazzata restano sintetici per ora.
- **Scivolamento meno «meccanico»:** tolta dal loop la pulsazione ritmica (circa 3 e 5,6 Hz); l'altezza non sale più con la velocità (sembrava un motore che accelera): la velocità cambia volume e brillantezza (più scuro quando la pietra rallenta), con una piccola differenza d'altezza fissa tra le pietre.
- **Urti con un campione registrato:** il suono fornito (colpo secco, energia tra 300 e 1000 Hz) a ogni urto, con volume e brillantezza che seguono la forza dell'urto e un'altezza variata di ±4%. Il modello sintetico del granito resta come riserva se il campione non si carica.
- **Uscita dalla pista:** una pietra che esce dal gioco sulla linea laterale o in fondo fa un suono suo (il colpo sintetico originale), non più quello dell'urto tra pietre.
- **Più lingue:** italiano, inglese, tedesco e francese. Il selettore in alto a destra mostra solo la bandiera; il cambio è immediato, senza ricaricare la pagina, e non perde le risposte già scelte nel riquadro dei giudizi. Alla prima apertura vale la lingua del browser; la scelta resta memorizzata.
- **Curva del draw a scelta** (riquadro Ghiaccio, sostituita poi dalla curva dai giri), come per gli urti, per confrontare le versioni sulla base dei giudizi («la curva inizia troppo presto», «finale troppo dolce», «con molti giri curva poco»):
  - «Classica (fino alla 0.3.1)»: deriva come 1/√v; il 41% della curva negli ultimi 3 m.
  - «Finale più netto» (predefinita): deriva come 1/v e curva che cresce con i giri; il 50% della curva negli ultimi 3 m.
  - «Finale molto netto»: deriva come 1/v^1,5; il 59% della curva negli ultimi 3 m, arresto circa 20 cm più corto a parità di peso.
  - La curva totale del draw di riferimento resta quella del profilo in tutte e tre. Con le due nuove, a parità di peso, 1,5 / 3,5 / 6,5 giri danno circa 1,07 / 1,20 / 1,40 m.
  - I replay registrati prima si riproducono identici (senza i nuovi valori vale la classica). Il rapporto riporta «· curva …» e l'agente separa le statistiche anche per forma della curva, ricavandola dal replay.
- **Correzione (curva netta):** dopo una bocciata alcune pietre colpite restavano in moto a circa 0,1 mm/s senza fermarsi mai: la deriva laterale a velocità quasi nulla superava l'attrito. Il tiro non si chiudeva (niente giudizio, niente registro) fino al limite di 90 s. Ora la deriva non supera il 90% dell'attrito e l'aumento di curva per i giri ha un tetto; draw e curva classica non cambiano. Verificato su 9.000 tiri casuali con tutte le combinazioni di urti e curva.
- I rapporti per lo sviluppatore restano in italiano qualunque sia la lingua scelta (domande, risposte, esito e numeri), così l'agente li legge come prima; i commenti dei tester restano nella loro lingua.

## 0.3.1 — 5 novembre 2026

Motore fisico invariato (0.2.0): i replay delle versioni 0.2.x e 0.3.0 si riproducono identici.

- **Scia delle pietre:** nel riquadro Tiro la casella «Mostra la scia delle pietre» mostra o nasconde le tracce sulla casa e sulla pista; la scelta resta memorizzata nel browser.
- **Correzione:** i rapporti dei giudizi indicavano «urti vivaci» anche per i tiri con «Normali». Ora l'impostazione si ricava dai valori usati nel tiro; l'agente la ricava dal replay, quindi anche i rapporti già arrivati sono classificati correttamente.
- **Agente:** statistiche e indicazioni separate per impostazione degli urti; ogni domanda con un segnale netto (almeno 3 risposte, almeno il 60% nella stessa direzione) compare tra le indicazioni anche quando mancano le misure dell'urto.
- **Invia allo sviluppatore:** i giudizi arrivano al repository senza mail e senza account. La funzione Vercel
  `api/feedback.ts` salva il rapporto in `reports/feedback/inbox/`; il commit avvia subito l'agente, che ora legge
  questa cartella e, solo se configurata, la posta. Duplicati scartati, limite di invii, codice tester facoltativo.
  «Invia per e-mail» resta come alternativa.

## 0.3.0 — 5 novembre 2026

Fase 2. Motore fisico 0.2.0: i replay delle versioni 0.2.x si riproducono identici (i nuovi parametri degli urti viaggiano nel replay).

- **Comandi di tiro sotto la casa**, su telefono e su desktop: rotazione, Tira, Spazza, Valuta e peso stanno subito sotto la casa e la pista, dimensionate per restare in vista insieme ai comandi. Nel pannello Tiro restano le impostazioni.
- **Ferma:** durante un tiro o una riproduzione, accanto a Spazza, ferma la simulazione e riporta le pietre alla posizione di partenza. Il tiro fermato non entra nel registro né, nell'end a due, nel conteggio delle pietre.
- **Urti tra pietre, «Normali» o «Vivaci»** (pannello Ghiaccio). «Normali», predefinito, rende gli urti quasi elastici: restituzione 0,95 negli urti con la pietra tirata e 0,97 negli urti tra le altre pietre. In una fila di pietre in freeze colpita in pieno esce solo l'ultima e le altre si spostano di pochi centimetri; nel colpo pieno la tirata si ferma quasi sul posto. «Vivaci» è il comportamento fino alla 0.2.2 (0,9 per tutti gli urti). Una prima versione di «Normali» (0,85 / 0,6) faceva muovere di più le pietre intermedie ed è stata sostituita; i replay registrati con quei valori si rivedono identici, perché il replay li contiene. Il rapporto dei giudizi indica gli urti usati.
- **Peso:** il cursore va da 1,6 a 3,8 m/s (prima fino a 4,6); 3,8 m/s resta il riferimento della pelata.

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
- **Precisione del tiro come distanza all'arresto**, con la miscela di Brunner (2024, Università di Berna):
  30% dei tiri ±⅓ del valore tipico, 63% ± il valore tipico, 7% ± 10/3 del valore tipico. Errore di linea separato
  per draw e bocciate. Livelli: élite 10/5 cm e 30 cm (valori di Brunner), club 20/10 cm e 60 cm, principiante 35/18 cm
  e 105 cm. Il vecchio formato dell'abilità resta valido: i replay salvati e l'hash di riferimento non cambiano.
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
