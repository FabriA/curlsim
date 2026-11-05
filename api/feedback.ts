/**
 * Funzione Vercel: riceve dal laboratorio un rapporto «CurlSim – giudizi sui tiri» e lo salva nel
 * repository come file di testo in reports/feedback/inbox/. Il commit avvia l'agente delle
 * segnalazioni (GitHub Actions), che lo valuta come le mail.
 *
 * Variabili d'ambiente (impostazioni del progetto su Vercel):
 *   GITHUB_TOKEN    token fine-grained con «Contents: read and write» solo sul repository (obbligatoria)
 *   GITHUB_REPO     proprietario/repository, predefinito FabriA/curlsim
 *   GITHUB_BRANCH   ramo, predefinito main
 *   FEEDBACK_CODE   facoltativa: se c'è, gli invii devono riportare questo codice
 *
 * Il file è autonomo (nessun import dal resto del progetto): il controllo approfondito del
 * rapporto e dei replay lo fa l'agente, che tratta comunque il testo come dato non fidato.
 * Non si salvano indirizzi IP né altri dati del mittente: solo il testo del rapporto.
 */
import { createHash, timingSafeEqual } from "node:crypto";

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

const HEADER = /CurlSim\s+[–-]\s+giudizi sui tiri\s+\(versione\s+[\w.-]+,\s+motore\s+[\w.-]+\)/;
const MAX_CHARS = 1_000_000;
const MAX_SHOTS = 200;
/** Limite per istanza: un freno agli invii a raffica, non una garanzia. */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const recent = new Map<string, number[]>();

function client(req: Req): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() || "?";
  // Solo in memoria e solo come impronta: l'indirizzo non viene salvato da nessuna parte.
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function allowed(key: string, now: number): boolean {
  const list = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    recent.set(key, list);
    return false;
  }
  list.push(now);
  recent.set(key, list);
  return true;
}

function sameCode(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method" });
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({ error: "not-configured" });
    return;
  }
  if (!allowed(client(req), Date.now())) {
    res.status(429).json({ error: "rate" });
    return;
  }

  let body = req.body as { report?: unknown; code?: unknown } | string | undefined;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  const data = (body ?? {}) as { report?: unknown; code?: unknown };
  const code = process.env.FEEDBACK_CODE;
  if (code && !sameCode(data.code, code)) {
    res.status(401).json({ error: "code" });
    return;
  }
  const report = typeof data.report === "string" ? data.report.replace(/\r\n?/g, "\n") : "";
  if (report.length > MAX_CHARS) {
    res.status(413).json({ error: "too-large" });
    return;
  }
  const shots = report.match(/^Tiro \d+ · /gm)?.length ?? 0;
  if (!HEADER.test(report) || shots === 0 || shots > MAX_SHOTS) {
    res.status(400).json({ error: "invalid" });
    return;
  }

  const id = createHash("sha256").update(report).digest("hex").slice(0, 12);
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
  const path = `reports/feedback/inbox/${stamp}-${id}.txt`;
  const repo = process.env.GITHUB_REPO || "FabriA/curlsim";
  const branch = process.env.GITHUB_BRANCH || "main";

  // Un rapporto identico già ricevuto non si salva due volte.
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "curlsim-feedback",
  };
  try {
    const dir = await fetch(`https://api.github.com/repos/${repo}/contents/reports/feedback/inbox?ref=${branch}`, { headers });
    if (dir.ok) {
      const files = (await dir.json()) as { name: string }[];
      if (Array.isArray(files) && files.some((f) => f.name.endsWith(`-${id}.txt`))) {
        res.status(200).json({ ok: true, id, shots, duplicate: true });
        return;
      }
    }
    const put = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Segnalazione dal laboratorio (${shots} tiri)`,
        content: Buffer.from(report, "utf8").toString("base64"),
        branch,
      }),
    });
    if (put.status === 201 || put.status === 200) {
      res.status(201).json({ ok: true, id, shots });
      return;
    }
    console.error("GitHub ha rifiutato il salvataggio:", put.status, (await put.text()).slice(0, 300));
    res.status(502).json({ error: "storage" });
  } catch (e) {
    console.error("GitHub non raggiungibile:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "storage" });
  }
}
