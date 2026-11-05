/**
 * Modalità «End»: due giocatori sullo stesso dispositivo giocano un end standard da 16 pietre.
 * Collega le regole pure di core/end.ts all'interfaccia: tabellone, turno, FGZ, scelta no-tick,
 * punteggio a fine end e nuovo end con l'hammer secondo R5 a.
 */
import {
  applyShot,
  fgzActive,
  isComplete,
  nextHammer,
  nextStoneNumber,
  nextTeam,
  resolveNoTick,
  startEnd,
  stonesLeft,
  undoShot,
  WORLD_CURLING_2026,
  type EndRules,
  type EndState,
  type ShotRuling,
} from "../core/end";
import type { Team } from "../core/physics";
import type { StonePlacement } from "../core/sim";
import { bindText, t, textOf, tt, type Text } from "../i18n";
import type { Key } from "../i18n/it";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const teamName = (team: Team) => t(`team.${team}` as Key);
/** Nome della squadra che segue la lingua, per i messaggi che restano a schermo. */
const teamRef = (team: Team) => () => teamName(team);

export interface EndHost {
  setStones(stones: StonePlacement[]): void;
  redraw(): void;
  status(msg: Text): void;
  /** true mentre una pietra è in corsa. */
  busy(): boolean;
  /** Cancella dal ghiaccio le traiettorie dell'ultimo tiro. */
  clearTraces(): void;
}

export class EndMode {
  active = false;
  private state: EndState = startEnd(1);
  private lastRuling: ShotRuling | null = null;

  constructor(private readonly host: EndHost) {
    $("end-undo").addEventListener("click", () => this.undo());
    $("end-new").addEventListener("click", () => this.newEnd());
    $("decision-leave").addEventListener("click", () => this.choose("leave"));
    $("decision-restore").addEventListener("click", () => this.choose("restore"));
    $("decision-new").addEventListener("click", () => this.newEnd());
    $("decision-close").addEventListener("click", () => this.hideSheet());
    for (const id of ["end-fgz", "end-fgz-stones", "end-notick", "end-hammer"]) $(id).addEventListener("change", () => this.render());
  }

  enter(): void {
    this.active = true;
    document.body.dataset.mode = "end";
    this.newEnd();
  }

  exit(): void {
    this.active = false;
    document.body.dataset.mode = "lab";
    this.hideSheet();
    this.host.redraw();
  }

  stones(): StonePlacement[] {
    return this.state.stones;
  }

  team(): Team {
    return nextTeam(this.state);
  }

  /** Si può consegnare la prossima pietra? Se no, il motivo da mostrare. */
  canThrow(): string | null {
    if (this.state.pending) return t("end.waitChoice", { team: teamName(this.state.pending.chooser) });
    if (isComplete(this.state)) return t("end.over");
    return null;
  }

  /** Pietre e indicazioni da disegnare: FGZ in vigore e pietre che contano a fine end. */
  sceneExtras(): { fgz: boolean; counting: number[] } {
    return { fgz: fgzActive(this.state) && !isComplete(this.state), counting: this.state.score?.counting ?? [] };
  }

  /** Tiro concluso: applica FGZ e no-tick e aggiorna le pietre in gioco. */
  afterShot(before: StonePlacement[], after: StonePlacement[], team: Team): void {
    const n = nextStoneNumber(this.state);
    const { state, ruling } = applyShot(this.state, before, after, team);
    this.state = state;
    this.lastRuling = ruling;
    this.host.setStones(state.stones);
    if (ruling.kind === "fgz") {
      this.message(tt("end.fgzViolation", { n, team: teamRef(team), protected: this.state.rules.fgzStones + 1 }));
    } else if (ruling.kind === "noTick") {
      this.message(tt("end.noTickViolation", { team: teamRef(team), chooser: teamRef(ruling.chooser) }));
      this.showChoice(ruling.chooser);
    } else {
      this.message("");
    }
    if (state.score) this.showResult();
    this.render();
    if (ruling.kind === "ok") this.host.status(() => this.lineText());
    this.host.redraw();
  }

  private choose(choice: "leave" | "restore"): void {
    this.state = resolveNoTick(this.state, choice);
    this.host.setStones(this.state.stones);
    this.hideSheet();
    this.message(tt(choice === "leave" ? "end.noTickLeft" : "end.noTickRestored"));
    if (this.state.score) this.showResult();
    this.render();
    this.host.redraw();
  }

  private undo(): void {
    if (this.host.busy() || this.state.history.length === 0) return;
    this.state = undoShot(this.state);
    this.host.setStones(this.state.stones);
    this.hideSheet();
    this.message(tt("end.undone", { n: nextStoneNumber(this.state) }));
    this.render();
    this.host.redraw();
  }

  /** Nuovo end: alla fine di un end l'hammer segue R5 a, altrimenti quello scelto nel menu. */
  private newEnd(): void {
    if (this.host.busy()) return;
    let hammer = Number($<HTMLSelectElement>("end-hammer").value) as Team;
    if (this.state.score) {
      hammer = nextHammer(this.state);
      $<HTMLSelectElement>("end-hammer").value = String(hammer);
    }
    this.state = startEnd(hammer, this.readRules());
    this.lastRuling = null;
    this.host.setStones([]);
    this.host.clearTraces();
    this.hideSheet();
    this.message("");
    this.host.status(tt("end.started", { team: teamRef(nextTeam(this.state)), hammer: teamRef(hammer) }));
    this.render();
    this.host.redraw();
  }

  private readRules(): EndRules {
    const fgzStones = Math.max(0, Math.min(15, Math.round(Number($<HTMLInputElement>("end-fgz-stones").value) || WORLD_CURLING_2026.fgzStones)));
    return { fgz: $<HTMLInputElement>("end-fgz").checked, fgzStones, noTick: $<HTMLInputElement>("end-notick").checked };
  }

  render(): void {
    const e = this.state;
    for (const team of [0, 1] as Team[]) {
      const row = $(`end-row-${team}`);
      row.classList.toggle("turn", !isComplete(e) && !e.pending && nextTeam(e) === team);
      $(`end-hammer-${team}`).hidden = e.hammer !== team;
      const pips = $(`end-pips-${team}`);
      pips.replaceChildren();
      const left = stonesLeft(e, team);
      for (let i = 0; i < 8; i++) {
        const p = document.createElement("i");
        p.className = `pip t${team}${i < left ? "" : " used"}`;
        pips.append(p);
      }
      pips.setAttribute("aria-label", t("end.stonesLeft", { n: left }));
      $(`end-points-${team}`).textContent = e.score && e.score.team === team ? String(e.score.points) : e.score ? "0" : "";
    }
    $("end-line").textContent = this.lineText();
    const r = e.rules;
    $("end-fgz-state").textContent = !r.fgz
      ? t("end.fgzOff")
      : fgzActive(e)
        ? t("end.fgzOn", { n: r.fgzStones + 1 })
        : t("end.fgzOver");
    $<HTMLButtonElement>("end-undo").disabled = e.history.length === 0 || this.host.busy();
    $<HTMLButtonElement>("end-new").disabled = this.host.busy();
  }

  private lineText(): string {
    const e = this.state;
    if (e.pending) return t("end.waitChoice", { team: teamName(e.pending.chooser) });
    if (isComplete(e)) return this.resultText();
    return t("end.next", { n: nextStoneNumber(e), team: teamName(nextTeam(e)) });
  }

  private resultText(): string {
    const s = this.state.score!;
    return s.team === null ? t("end.blank") : t("end.scored", { team: teamName(s.team), n: s.points });
  }

  private message(s: Text): void {
    bindText($("end-msg"), s);
    if (textOf(s)) this.host.status(s);
  }

  private showChoice(chooser: Team): void {
    bindText($("decision-text"), () => t("end.choiceText", { team: teamName(chooser) }));
    $("decision-choice").hidden = false;
    $("decision-result").hidden = true;
    $("decision").hidden = false;
    this.showBoard();
  }

  private showResult(): void {
    const s = this.state.score!;
    const hammer = nextHammer(this.state);
    const text = this.resultText.bind(this);
    bindText($("decision-text"), () => text() + " " + t("end.nextHammer", { team: teamName(hammer) }) + (s.team === null ? " " + t("end.blankHammer") : ""));
    $("decision-choice").hidden = true;
    $("decision-result").hidden = false;
    $("decision").hidden = false;
    this.showBoard();
  }

  /** Su telefono la scheda copre la parte bassa: porta in vista la casa, per decidere guardando le pietre. */
  private showBoard(): void {
    if (window.matchMedia("(max-width: 720px)").matches) $("views").scrollIntoView({ block: "start" });
  }

  private hideSheet(): void {
    $("decision").hidden = true;
  }

  /** Esito dell'ultimo tiro, per i test e per eventuali estensioni dell'interfaccia. */
  get ruling(): ShotRuling | null {
    return this.lastRuling;
  }
}
