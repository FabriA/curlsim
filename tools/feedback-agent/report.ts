/**
 * Rapporti in Markdown: un riepilogo complessivo e una scheda per ogni messaggio elaborato.
 */
import { ENGINE_VERSION } from "../../src/core/params";
import { questionStats, recommendations, rollStats, type Dataset, type ShotRecord } from "./evaluate";

const n2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : v.toFixed(d).replace(".", ","));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function summaryMarkdown(ds: Dataset): string {
  const shots = ds.shots;
  const qs = questionStats(shots);
  const rs = rollStats(shots);
  const rec = recommendations(qs, rs);
  const checks = { identico: 0, diverso: 0, "motore diverso": 0, assente: 0 } as Record<ShotRecord["replayCheck"], number>;
  for (const s of shots) checks[s.replayCheck]++;

  const out: string[] = [];
  out.push("# Segnalazioni sul realismo", "");
  out.push(`Aggiornato il ${ds.updated} · motore ${ENGINE_VERSION} · messaggi elaborati: ${ds.processed.length} · tiri valutati: ${shots.length}`, "");

  out.push("## Indicazioni", "");
  if (rec.length) for (const r of rec) out.push(`- ${r}`);
  else out.push(`Nessun segnale netto: servono almeno ${3} risposte informative su una domanda, con almeno il 60% che chiede la stessa correzione.`);
  out.push("");

  out.push("## Replay", "");
  out.push("| Esito della riesecuzione | Tiri |", "| --- | --- |");
  out.push(`| Identico all'hash registrato | ${checks.identico} |`);
  out.push(`| Diverso dall'hash registrato | ${checks.diverso} |`);
  out.push(`| Registrato con un altro motore | ${checks["motore diverso"]} |`);
  out.push(`| Senza replay | ${checks.assente} |`, "");
  if (checks.diverso) out.push("Un replay diverso con lo stesso motore indica un problema di determinismo: va controllato per primo.", "");

  out.push("## Rotolamento dopo l'urto, per pienezza del colpo", "");
  if (rs.length) {
    out.push("| Colpo | Tiri | Tirata dopo l'urto, media (m) | Troppo corto | Giusto | Troppo lungo | Non so |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rs) {
      const c = (k: string) => r.counts[k] ?? 0;
      out.push(`| ${r.band} | ${r.n} | ${n2(r.meanShooterTravel)} | ${c("Troppo corto")} | ${c("Giusto")} | ${c("Troppo lungo")} | ${c("Non so")} |`);
    }
  } else out.push("Ancora nessun giudizio sul rotolamento con le misure dell'urto.");
  out.push("");

  out.push("## Risposte per domanda", "");
  if (qs.length) {
    out.push("| Domanda | Risposte | Distribuzione | Segnale |", "| --- | --- | --- | --- |");
    for (const q of qs) {
      const dist = Object.entries(q.counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${esc(k)} ${v}`)
        .join(" · ");
      out.push(`| ${esc(q.question)} | ${q.total} | ${dist} | ${q.signal ? `${esc(q.signal.answer)} (${pct(q.signal.share)})` : "—"} |`);
    }
  } else out.push("Nessuna risposta ancora.");
  out.push("");

  const comments = shots.filter((s) => s.comment);
  if (comments.length) {
    out.push("## Commenti", "");
    for (const s of comments.slice(-20).reverse()) out.push(`- ${s.date.slice(0, 10)} · tiro ${s.n} · ${esc(s.kind)}: ${esc(s.comment)}`);
    out.push("");
  }

  out.push("## Messaggi", "");
  const byMsg = new Map<string, ShotRecord[]>();
  for (const s of shots) byMsg.set(s.message, [...(byMsg.get(s.message) ?? []), s]);
  const msgs = [...byMsg.entries()].sort((a, b) => (a[1][0].date < b[1][0].date ? 1 : -1));
  for (const [id, list] of msgs) out.push(`- [${list[0].date.slice(0, 10)} · ${id}](messages/${messageFile(list[0].date, id)}) · ${list.length} tiri · versione ${list[0].app}`);
  out.push("");
  return out.join("\n");
}

export function messageFile(date: string, id: string): string {
  return `${date.slice(0, 10)}-${id}.md`;
}

export function messageMarkdown(id: string, list: ShotRecord[]): string {
  const out: string[] = [];
  const first = list[0];
  out.push(`# Segnalazione ${id}`, "");
  const via = id.startsWith("web-") ? "dal laboratorio" : "per e-mail";
  out.push(`Ricevuta ${via} il ${first.date} · laboratorio ${first.app} · motore ${first.engine} · tiri: ${list.length}`, "");
  for (const s of list) {
    out.push(`## Tiro ${s.n} · ${s.kind}`, "");
    out.push(`- Velocità ${n2(s.speed)} m/s · rotazione ${n2(s.spinTurns, 1)} giri · spazzata ${n2(s.sweepTime, 1)} s · urti ${s.collisions ?? "vivaci (versione precedente)"} · esito: ${s.outcome || "—"}`);
    if (s.impact) {
      const i = s.impact;
      out.push(
        `- Urto: colpo pieno al ${pct(i.fullness)} · velocità all'urto ${n2(i.speed)} m/s · tirata dopo l'urto ${n2(i.shooterTravel)} m${i.shooterOut ? " (fuori gioco)" : ""} · colpita ${n2(i.targetTravel)} m${i.targetOut ? " (fuori gioco)" : ""}`,
      );
    }
    out.push(`- Replay: ${s.replayCheck}${s.rerunHash ? ` (hash rieseguito ${s.rerunHash}${s.hash ? `, registrato ${s.hash}` : ""})` : ""}`);
    for (const a of s.answers) out.push(`- ${esc(a.question)} → **${esc(a.answer)}**`);
    if (s.comment) out.push(`- Commento: ${esc(s.comment)}`);
    for (const w of s.warnings) out.push(`- Avviso: ${w}`);
    out.push("");
  }
  return out.join("\n");
}
