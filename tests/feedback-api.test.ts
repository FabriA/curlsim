import { describe, expect, it } from "vitest";
import handler from "../api/feedback";
import { formatReport } from "../src/lab/feedback-model";
import { REFERENCE_HASH, referenceReplay } from "../src/core/reference";

const fmt = (n: number, d: number) => n.toFixed(d).replace(".", ",");
const report = formatReport(
  [{
    facts: { n: 1, speed: 3, hit: true, removedOthers: 1, sweepTime: 0, spinTurns: 3.5, stopped: true, outcome: "In gioco", hash: REFERENCE_HASH, ice: { hogToHog: 14.5, curl: 1.2 }, sweepGain: 2.15, collisions: "normali", replay: referenceReplay() },
    kind: "takeout",
    answers: [{ question: "Dopo l'urto, la distanza percorsa dalla pietra tirata è…", answer: "Giusto" }],
    comment: "",
    at: "",
  }],
  { app: "0.3.0", engine: "0.2.0" },
  () => "Bocciata",
  fmt,
);

/** GitHub finto: registra le chiamate; `existing` sono i file già nella cartella inbox. */
function fakeGitHub(existing: string[] = []) {
  const calls: { url: string; method: string; body: any }[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    if (!init?.method) return new Response(JSON.stringify(existing.map((name) => ({ name }))), { status: existing.length ? 200 : 404 });
    return new Response("{}", { status: 201 });
  };
  return calls;
}

async function call(body: unknown, ip = "10.0.0.1", method = "POST"): Promise<[number, any]> {
  let status = 0;
  let out: any;
  const res: any = { status(c: number) { status = c; return res; }, setHeader() {}, json(b: any) { out = b; } };
  await handler({ method, headers: { "x-forwarded-for": ip }, body }, res);
  return [status, out];
}

describe("funzione /api/feedback", () => {
  it("salva il rapporto, identico, in reports/feedback/inbox", async () => {
    process.env.GITHUB_TOKEN = "t";
    delete process.env.FEEDBACK_CODE;
    const calls = fakeGitHub();
    const [status, out] = await call({ report }, "10.0.0.2");
    expect(status).toBe(201);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/contents\/reports\/feedback\/inbox\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[0-9a-f]{12}\.txt$/);
    expect(put.url.endsWith(`-${out.id}.txt`)).toBe(true);
    expect(Buffer.from(put.body.content, "base64").toString("utf8")).toBe(report);
  });

  it("non salva due volte lo stesso rapporto", async () => {
    process.env.GITHUB_TOKEN = "t";
    const first = await call({ report }, "10.0.0.3");
    const calls = fakeGitHub([`2026-11-05T09-00-00Z-${first[1].id}.txt`]);
    const [status, out] = await call({ report }, "10.0.0.3");
    expect(status).toBe(200);
    expect(out.duplicate).toBe(true);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("rifiuta testi che non sono rapporti, richieste non POST e invii senza il codice richiesto", async () => {
    process.env.GITHUB_TOKEN = "t";
    fakeGitHub();
    expect((await call({ report: "ciao" }, "10.0.0.4"))[0]).toBe(400);
    expect((await call(undefined, "10.0.0.4", "GET"))[0]).toBe(405);
    process.env.FEEDBACK_CODE = "curling";
    expect((await call({ report }, "10.0.0.4"))[0]).toBe(401);
    expect((await call({ report, code: "curling" }, "10.0.0.4"))[0]).toBe(201);
    delete process.env.FEEDBACK_CODE;
  });

  it("senza token risponde che non è configurata", async () => {
    delete process.env.GITHUB_TOKEN;
    expect((await call({ report }, "10.0.0.5"))[0]).toBe(503);
  });
});
