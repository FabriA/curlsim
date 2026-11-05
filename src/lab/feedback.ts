/**
 * Riquadro «Il tuo giudizio»: mostra le domande dopo ogni tiro, raccoglie le risposte,
 * le conserva nel browser e le prepara per la copia o per una mail allo sviluppatore.
 */
import { bindText, num, numIn, onLanguageChange, t, tIn, tt, type Text } from "../i18n";
import type { Key } from "../i18n/it";
import { APP_VERSION, ENGINE_VERSION } from "../core/params";
import {
  classify,
  shotLabel,
  DEVELOPER_EMAIL,
  formatReport,
  MAILTO_MAX,
  mailtoHref,
  questionsFor,
  type FeedbackRecord,
  type ShotFacts,
  type ShotKind,
} from "./feedback-model";

const STORE_KEY = "curlsim.feedback";
const CODE_KEY = "curlsim.feedbackCode";
/** Funzione su Vercel che salva il rapporto nel repository (api/feedback.ts). */
const UPLOAD_URL = "/api/feedback";
const UPLOAD_TIMEOUT_MS = 20_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d: number) => num(n, d);
const kindLabel = (k: ShotKind) => t(`fb.kind.${k}` as Key);
/** Il rapporto per lo sviluppatore resta sempre in italiano, qualunque sia la lingua scelta:
 *  l'agente delle segnalazioni riconosce domande e risposte da quel testo. */
const fmtIt = (n: number, d: number) => numIn("it", n, d);
const kindLabelIt = (k: ShotKind) => tIn("it", `fb.kind.${k}` as Key);

export class FeedbackPanel {
  private records: FeedbackRecord[] = [];
  private pending: { facts: ShotFacts; kind: ShotKind } | null = null;
  private clearArmed = false;

  constructor(private readonly onPendingChange: (pending: boolean) => void) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.records = JSON.parse(raw);
    } catch {
      this.records = [];
    }
    try {
      const code = localStorage.getItem(CODE_KEY);
      if (code) {
        $<HTMLInputElement>("fb-code").value = code;
        $("fb-code-row").hidden = false;
      }
    } catch {
      /* memoria del browser non disponibile */
    }
    $("fb-upload").addEventListener("click", () => void this.upload());
    $("fb-copy").addEventListener("click", () => void this.copy());
    $("fb-send").addEventListener("click", (e) => this.send(e));
    $("fb-clear").addEventListener("click", () => this.clear());
    bindText($("fb-to"), tt("fb.to", { email: DEVELOPER_EMAIL }));
    this.renderCollected();
    onLanguageChange(() => this.relocalize());
  }

  /** Cambio di lingua: ridisegna le domande in corso lasciando le risposte già scelte e il commento. */
  private relocalize(): void {
    if (this.pending) {
      const selected = new Map<number, number>();
      $("fb-current")
        .querySelectorAll<HTMLInputElement>("input[type=radio]:checked")
        .forEach((i) => selected.set(Number(i.dataset.qi), Number(i.dataset.ai)));
      const comment = ($("fb-current").querySelector("#fb-comment") as HTMLTextAreaElement | null)?.value ?? "";
      this.renderPending(selected, comment);
    }
    if (!this.clearArmed) $("fb-clear").textContent = t("fb.clear");
    this.renderCollected();
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Prepara le domande per un tiro appena concluso. */
  ask(facts: ShotFacts): void {
    this.pending = { facts, kind: classify(facts) };
    this.renderPending(new Map(), "");
    this.onPendingChange(true);
  }

  private renderPending(selected: Map<number, number>, commentText: string): void {
    const { facts, kind } = this.pending!;
    const questions = questionsFor(kind, facts, fmt);
    const questionsIt = questionsFor(kind, facts, fmtIt);
    const box = $("fb-current");
    box.replaceChildren();
    $("fb-empty").hidden = true;

    const intro = document.createElement("p");
    intro.className = "fb-intro";
    intro.textContent = t("fb.intro", { n: facts.n, kind: shotLabel(kind, facts, kindLabel, t("fb.removed")) });
    box.append(intro);
    if (facts.impact) {
      const imp = document.createElement("p");
      imp.className = "hint";
      const i = facts.impact;
      const out = (o: boolean) => (o ? ` (${t("fb.out")})` : "");
      const text = t("fb.impactText", { pct: Math.round(i.fullness * 100), v: fmt(i.speed, 2), s: fmt(i.shooterTravel, 2), so: out(i.shooterOut), tg: fmt(i.targetTravel, 2), to: out(i.targetOut) });
      imp.textContent = t("fb.impact", { text });
      box.append(imp);
    }

    const form = document.createElement("form");
    form.className = "fb-form";
    questions.forEach((q, qi) => {
      const fs = document.createElement("fieldset");
      fs.className = "fb-q";
      const lg = document.createElement("legend");
      lg.textContent = t(q.text, q.params);
      fs.append(lg);
      const chips = document.createElement("div");
      chips.className = "chips";
      q.answers.forEach((a, ai) => {
        const id = `fb-${facts.n}-${qi}-${ai}`;
        const lab = document.createElement("label");
        lab.htmlFor = id;
        const inp = document.createElement("input");
        inp.type = "radio";
        inp.name = `fb-${qi}`;
        inp.id = id;
        // Nel rapporto: domanda e risposta in italiano.
        inp.value = tIn("it", a);
        inp.dataset.question = tIn("it", questionsIt[qi].text, questionsIt[qi].params);
        inp.dataset.qi = String(qi);
        inp.dataset.ai = String(ai);
        inp.checked = selected.get(qi) === ai;
        const span = document.createElement("span");
        span.textContent = t(a);
        lab.append(inp, span);
        chips.append(lab);
      });
      fs.append(chips);
      form.append(fs);
    });

    const cl = document.createElement("label");
    cl.className = "field";
    const cs = document.createElement("span");
    cs.textContent = t("fb.comment");
    const ta = document.createElement("textarea");
    ta.id = "fb-comment";
    ta.rows = 2;
    ta.value = commentText;
    cl.append(cs, ta);
    form.append(cl);

    const actions = document.createElement("div");
    actions.className = "actions secondary";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "primary";
    save.textContent = t("fb.save");
    const skip = document.createElement("button");
    skip.type = "button";
    skip.textContent = t("fb.skip");
    skip.addEventListener("click", () => this.dismiss());
    actions.append(save, skip);
    form.append(actions);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const answers = [...form.querySelectorAll<HTMLInputElement>("input[type=radio]:checked")].map((i) => ({
        question: i.dataset.question ?? "",
        answer: i.value,
      }));
      const comment = (form.querySelector("#fb-comment") as HTMLTextAreaElement).value;
      if (answers.length === 0 && !comment.trim()) {
        this.dismiss();
        return;
      }
      this.records.push({ facts, kind, answers, comment, at: new Date().toISOString() });
      this.persist();
      this.dismiss();
      this.msg(tt("fb.saved", { n: this.records.length }));
    });

    box.append(form);
  }

  /** Chiude le domande del tiro corrente senza salvare. */
  dismiss(): void {
    this.pending = null;
    $("fb-current").replaceChildren();
    $("fb-empty").hidden = false;
    this.renderCollected();
    this.onPendingChange(false);
  }

  /** Porta il riquadro in vista, aperto. */
  reveal(): void {
    const panel = $<HTMLDetailsElement>("p-feedback");
    panel.open = true;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private report(): string {
    return formatReport(this.records, { app: APP_VERSION, engine: ENGINE_VERSION }, kindLabelIt, fmtIt, { removed: tIn("it", "fb.removed"), out: tIn("it", "fb.out") });
  }

  private async copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.report());
      this.msg(tt("fb.copied", { email: DEVELOPER_EMAIL }));
      return true;
    } catch {
      const ta = $<HTMLTextAreaElement>("replay-text");
      ta.value = this.report();
      ta.focus();
      ta.select();
      this.msg(tt("replay.copyFailed"));
      return false;
    }
  }

  /** Invia il rapporto alla funzione su Vercel; se va a buon fine le risposte inviate si cancellano. */
  private async upload(): Promise<void> {
    if (this.records.length === 0) {
      this.msg(tt("fb.nothing"));
      return;
    }
    const btn = $<HTMLButtonElement>("fb-upload");
    const code = $<HTMLInputElement>("fb-code").value.trim();
    const sent = this.records.length;
    btn.disabled = true;
    this.msg(tt("fb.uploading"));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const r = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: this.report(), code: code || undefined }),
        signal: ctrl.signal,
      });
      const data = (await r.json().catch(() => ({}))) as { id?: string; duplicate?: boolean };
      if (r.ok && data.id) {
        try {
          if (code) localStorage.setItem(CODE_KEY, code);
        } catch {
          /* niente */
        }
        this.records = [];
        this.persist();
        this.msg(tt(data.duplicate ? "fb.uploadedDup" : "fb.uploaded", { n: sent, id: data.id }));
      } else if (r.status === 401) {
        $("fb-code-row").hidden = false;
        $<HTMLInputElement>("fb-code").focus();
        this.msg(tt("fb.codeNeeded"));
      } else if (r.status === 429) this.msg(tt("fb.uploadRate"));
      else if (r.status === 413) this.msg(tt("fb.uploadTooLarge"));
      else this.msg(tt("fb.uploadFailed"));
    } catch {
      this.msg(tt("fb.uploadFailed"));
    } finally {
      clearTimeout(timer);
      this.renderCollected();
    }
  }

  private send(e: MouseEvent): void {
    const body = this.report();
    const link = $<HTMLAnchorElement>("fb-send");
    if (body.length > MAILTO_MAX) {
      // Testo lungo: lo copia negli appunti e apre la mail con un promemoria da sostituire.
      void navigator.clipboard?.writeText(body).catch(() => undefined);
      link.href = mailtoHref(t("fb.subject"), t("fb.pasteHere"));
      this.msg(tt("fb.tooLong"));
    } else {
      link.href = mailtoHref(t("fb.subject"), body);
    }
    if (this.records.length === 0) {
      e.preventDefault();
      this.msg(tt("fb.nothing"));
    }
  }

  private clear(): void {
    const btn = $<HTMLButtonElement>("fb-clear");
    if (!this.clearArmed) {
      this.clearArmed = true;
      btn.textContent = t("fb.clearConfirm");
      setTimeout(() => {
        this.clearArmed = false;
        btn.textContent = t("fb.clear");
      }, 3000);
      return;
    }
    this.clearArmed = false;
    btn.textContent = t("fb.clear");
    this.records = [];
    this.persist();
    this.msg(tt("fb.cleared"));
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.records));
    } catch {
      /* memoria del browser non disponibile: le risposte restano solo in questa pagina */
    }
    this.renderCollected();
  }

  private renderCollected(): void {
    const body = this.report();
    $<HTMLAnchorElement>("fb-send").href = mailtoHref(t("fb.subject"), body.length > MAILTO_MAX ? t("fb.pasteHere") : body);
    $("fb-count").textContent = t("fb.collected", { n: this.records.length });
    const none = this.records.length === 0;
    $<HTMLButtonElement>("fb-copy").disabled = none;
    $<HTMLButtonElement>("fb-upload").disabled = none;
    $<HTMLButtonElement>("fb-clear").disabled = none;
    $("fb-send").setAttribute("aria-disabled", String(none));
  }

  private msg(s: Text): void {
    bindText($("fb-msg"), s);
  }
}
