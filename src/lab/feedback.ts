/**
 * Riquadro «Il tuo giudizio»: mostra le domande dopo ogni tiro, raccoglie le risposte,
 * le conserva nel browser e le prepara per la copia o per una mail allo sviluppatore.
 */
import { num, t } from "../i18n";
import type { Key } from "../i18n/it";
import { APP_VERSION, ENGINE_VERSION } from "../core/params";
import {
  classify,
  describeImpact,
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
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d: number) => num(n, d);
const kindLabel = (k: ShotKind) => t(`fb.kind.${k}` as Key);

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
    $("fb-copy").addEventListener("click", () => void this.copy());
    $("fb-send").addEventListener("click", (e) => this.send(e));
    $("fb-clear").addEventListener("click", () => this.clear());
    $("fb-to").textContent = t("fb.to", { email: DEVELOPER_EMAIL });
    this.renderCollected();
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Prepara le domande per un tiro appena concluso. */
  ask(facts: ShotFacts): void {
    const kind = classify(facts);
    const questions = questionsFor(kind, facts, fmt);
    this.pending = { facts, kind };
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
      imp.textContent = t("fb.impact", { text: describeImpact(facts.impact, fmt, t("fb.out")) });
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
        inp.value = t(a);
        inp.dataset.question = t(q.text, q.params);
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
      this.msg(t("fb.saved", { n: this.records.length }));
    });

    box.append(form);
    this.onPendingChange(true);
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
    return formatReport(this.records, { app: APP_VERSION, engine: ENGINE_VERSION }, kindLabel, fmt, { removed: t("fb.removed"), out: t("fb.out") });
  }

  private async copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.report());
      this.msg(t("fb.copied", { email: DEVELOPER_EMAIL }));
      return true;
    } catch {
      const ta = $<HTMLTextAreaElement>("replay-text");
      ta.value = this.report();
      ta.focus();
      ta.select();
      this.msg(t("replay.copyFailed"));
      return false;
    }
  }

  private send(e: MouseEvent): void {
    const body = this.report();
    const link = $<HTMLAnchorElement>("fb-send");
    if (body.length > MAILTO_MAX) {
      // Testo lungo: lo copia negli appunti e apre la mail con un promemoria da sostituire.
      void navigator.clipboard?.writeText(body).catch(() => undefined);
      link.href = mailtoHref(t("fb.subject"), t("fb.pasteHere"));
      this.msg(t("fb.tooLong"));
    } else {
      link.href = mailtoHref(t("fb.subject"), body);
    }
    if (this.records.length === 0) {
      e.preventDefault();
      this.msg(t("fb.nothing"));
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
    this.msg(t("fb.cleared"));
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
    $<HTMLButtonElement>("fb-clear").disabled = none;
    $("fb-send").setAttribute("aria-disabled", String(none));
  }

  private msg(s: string): void {
    $("fb-msg").textContent = s;
  }
}
