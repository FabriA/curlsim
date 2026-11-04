# Registro delle versioni

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
