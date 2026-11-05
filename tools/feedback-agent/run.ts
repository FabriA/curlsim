/**
 * Agente delle segnalazioni CurlSim.
 *
 *   npx tsx tools/feedback-agent/run.ts                 legge i rapporti inviati dal laboratorio
 *                                                      (reports/feedback/inbox/) e, se configurata,
 *                                                      la casella IMAP (variabili IMAP_*)
 *   npx tsx tools/feedback-agent/run.ts --file mail.txt  elabora un file di testo o .eml, per prova
 *
 * Scrive in reports/feedback/: SUMMARY.md, messages/<data>-<id>.md e data.json.
 * Elabora ogni messaggio una sola volta (gli identificativi sono in data.json).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addReport, emptyDataset, type Dataset } from "./evaluate";
import { configFromEnv, fetchReports, type MailItem } from "./imap";
import { parseReport, REPORT_HEADER } from "./parse";
import { messageFile, messageMarkdown, summaryMarkdown } from "./report";

const OUT = process.env.FEEDBACK_OUT || "reports/feedback";
const DATA = join(OUT, "data.json");
/** Rapporti salvati dalla funzione /api/feedback: <data>-<hash>.txt. */
const INBOX = join(OUT, "inbox");
/** Giorni di posta da rileggere a ogni esecuzione: i messaggi già elaborati vengono saltati. */
const LOOKBACK_DAYS = Number(process.env.FEEDBACK_LOOKBACK_DAYS || 30);

function load(): Dataset {
  if (!existsSync(DATA)) return emptyDataset();
  try {
    return JSON.parse(readFileSync(DATA, "utf8")) as Dataset;
  } catch {
    throw new Error(`${DATA} non è leggibile: correggilo o eliminalo per ricominciare.`);
  }
}

function save(ds: Dataset, changed: string[]): void {
  mkdirSync(join(OUT, "messages"), { recursive: true });
  writeFileSync(DATA, JSON.stringify(ds, null, 1) + "\n");
  writeFileSync(join(OUT, "SUMMARY.md"), summaryMarkdown(ds));
  for (const id of changed) {
    const list = ds.shots.filter((s) => s.message === id);
    if (!list.length) continue;
    const file = join(OUT, "messages", messageFile(list[0].date, id));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, messageMarkdown(id, list));
  }
}

async function fromFile(path: string): Promise<MailItem[]> {
  const raw = readFileSync(path);
  let text = raw.toString("utf8");
  if (/\.eml$/i.test(path)) {
    const name = "mailparser";
    const { simpleParser } = (await import(name)) as { simpleParser: (b: Buffer) => Promise<{ text?: string }> };
    text = (await simpleParser(raw)).text ?? "";
  }
  const { createHash } = await import("node:crypto");
  return [{ id: createHash("sha256").update(text).digest("hex").slice(0, 12), date: new Date().toISOString(), text }];
}

/** Rapporti arrivati dal laboratorio attraverso la funzione su Vercel. */
function fromInbox(): MailItem[] {
  if (!existsSync(INBOX)) return [];
  const out: MailItem[] = [];
  for (const name of readdirSync(INBOX).sort()) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-([0-9a-f]{12})\.txt$/.exec(name);
    if (!m) continue;
    out.push({ id: `web-${m[5]}`, date: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`, text: readFileSync(join(INBOX, name), "utf8") });
  }
  return out;
}

async function main(): Promise<void> {
  const fileArg = process.argv.indexOf("--file");
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  let items: MailItem[];
  if (fileArg >= 0) items = await fromFile(process.argv[fileArg + 1]);
  else {
    items = fromInbox();
    console.log(`Rapporti dal laboratorio: ${items.length}.`);
    if (process.env.IMAP_HOST) items.push(...(await fetchReports(configFromEnv(process.env, since), (t) => REPORT_HEADER.test(t))));
    else console.log("Casella di posta non configurata (IMAP_HOST assente): leggo solo i rapporti dal laboratorio.");
  }

  let ds = load();
  const changed: string[] = [];
  for (const item of items) {
    if (ds.processed.includes(item.id)) continue;
    const report = parseReport(item.text);
    if (!report) continue;
    ds = addReport(ds, item.id, item.date, report);
    changed.push(item.id);
  }
  if (!changed.length) {
    console.log(`Nessuna nuova segnalazione (${items.length} messaggi letti).`);
    return;
  }
  ds.updated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  save(ds, changed);
  console.log(`Elaborate ${changed.length} nuove segnalazioni; tiri totali: ${ds.shots.length}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
