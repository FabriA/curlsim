# Segnalazioni sul realismo

Questa cartella è scritta dall'agente delle segnalazioni (`tools/feedback-agent/`), che GitHub Actions
esegue a ogni rapporto arrivato dal laboratorio, ogni due ore e su richiesta (**Actions → Agente segnalazioni → Run workflow**).

- `inbox/` — rapporti inviati dal laboratorio con «Invia allo sviluppatore», salvati così come sono arrivati.
- `SUMMARY.md` — riepilogo di tutte le segnalazioni: indicazioni sul modello, verifica dei replay,
  rotolamento dopo l'urto per pienezza del colpo, distribuzione delle risposte, commenti.
- `messages/` — una scheda per ogni messaggio elaborato.
- `data.json` — tutti i tiri letti, con i replay, per analisi successive.

Nei file non compaiono indirizzi e-mail né indirizzi IP: ogni messaggio è identificato da un hash del suo Message-ID
(mail) o del suo testo (laboratorio, prefisso `web-`).
