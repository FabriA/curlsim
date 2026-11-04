/**
 * Lettura della casella via IMAP, in sola lettura: nessun messaggio viene spostato, cancellato
 * o segnato come letto. Le credenziali arrivano solo da variabili d'ambiente (segreti di GitHub).
 */

export interface MailItem {
  /** Identificativo stabile del messaggio (hash del Message-ID, senza dati personali). */
  id: string;
  date: string;
  text: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  /** Messaggi più vecchi di questa data non vengono letti. */
  since: Date;
}

export function configFromEnv(env: NodeJS.ProcessEnv, since: Date): ImapConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Manca la variabile ${k}: impostala come segreto del repository (Settings → Secrets and variables → Actions).`);
    return v;
  };
  return {
    host: need("IMAP_HOST"),
    port: Number(env.IMAP_PORT || 993),
    user: need("IMAP_USER"),
    password: need("IMAP_PASSWORD"),
    mailbox: env.IMAP_MAILBOX || "INBOX",
    since,
  };
}

async function sha(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Scarica i messaggi dal giorno `since` e restituisce il testo di quelli che contengono un rapporto. */
export async function fetchReports(cfg: ImapConfig, isReport: (text: string) => boolean): Promise<MailItem[]> {
  // Import dinamici: le librerie servono solo nell'agente, non nel gioco.
  const imapflowName = "imapflow";
  const mailparserName = "mailparser";
  const { ImapFlow } = (await import(imapflowName)) as { ImapFlow: new (o: unknown) => any };
  const { simpleParser } = (await import(mailparserName)) as { simpleParser: (src: Buffer) => Promise<any> };

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });
  const out: MailItem[] = [];
  await client.connect();
  try {
    await client.mailboxOpen(cfg.mailbox, { readOnly: true });
    const uids: number[] = (await client.search({ since: cfg.since }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      if (!msg?.source || msg.source.length > 5_000_000) continue;
      const parsed = await simpleParser(msg.source);
      const text: string = parsed.text || "";
      if (!isReport(text)) continue;
      const messageId: string = parsed.messageId || msg.envelope?.messageId || `${uid}-${parsed.date?.toISOString?.() ?? ""}`;
      out.push({ id: await sha(messageId), date: (parsed.date ?? new Date()).toISOString(), text });
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return out;
}
