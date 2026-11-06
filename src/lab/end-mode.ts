/**
 * Modalità «Partita»: due giocatori sullo stesso dispositivo giocano una partita di più end.
 * Collega le regole pure di core/end.ts e core/match.ts all'interfaccia: tabellone end per end,
 * turno e giocatore di turno, FGZ, scelta no-tick, punteggio, hammer, extra end, abilità dei
 * giocatori, salvataggio automatico e copia della partita (con i replay di tutti i tiri).
 */
import {
  applyShot,
  fgzActive,
  isComplete,
  nextHammer,
  nextStoneNumber,
  nextTeam,
  resolveNoTick,
  stonesLeft,
  undoShot,
  WORLD_CURLING_2026,
  type EndState,
  type ShotRuling,
} from "../core/end";
import {
  currentRole,
  endNumber,
  finishEnd,
  isExtraEnd,
  ROLES,
  startMatch,
  sweepersFor,
  totals,
  uniformTeam,
  winner,
  type MatchRules,
  type MatchState,
  type PlayerSkill,
  type Role,
  type TeamSkills,
} from "../core/match";
import { APP_VERSION, ENGINE_VERSION, SHOT_PRECISION, SWEEP_GAIN, type Precision, type ShotLevel, type SkillLevel } from "../core/params";
import type { Team } from "../core/physics";
import type { Replay, StonePlacement } from "../core/sim";
import { bindText, t, textOf, tt, type Text } from "../i18n";
import type { Key } from "../i18n/it";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const teamName = (team: Team) => t(`team.${team}` as Key);
/** Nome della squadra che segue la lingua, per i messaggi che restano a schermo. */
const teamRef = (team: Team) => () => teamName(team);
const roleName = (r: Role) => t(`role.${r}` as Key);

const MATCH_KEY = "curlsim.match";
const SKILLS_KEY = "curlsim.players";
const SHOT_LEVELS: ShotLevel[] = ["perfect", "beginner", "club", "elite"];
const SWEEP_LEVELS: SkillLevel[] = ["beginner", "club", "elite"];

export interface EndHost {
  setStones(stones: StonePlacement[]): void;
  redraw(): void;
  status(msg: Text): void;
  /** true mentre una pietra è in corsa. */
  busy(): boolean;
  /** Cancella dal ghiaccio le traiettorie dell'ultimo tiro. */
  clearTraces(): void;
}

/** Tiro registrato nella partita, per rivederlo o riprodurre un errore. */
interface MatchShot {
  end: number;
  stone: number;
  replay: Replay;
}

/** File di una partita: si riapre con «Carica replay o posizione». */
export interface MatchFile {
  format: "curling-match";
  version: 1;
  app: string;
  engineVersion: string;
  seed: number;
  match: MatchState;
  skills: [TeamSkills, TeamSkills];
  uniform: [boolean, boolean];
  shots: MatchShot[];
}

/** Chi tira adesso e con quali abilità. */
export interface Shooter {
  team: Team;
  role: Role;
  precision: Precision;
  sweepGain: number;
  sweepers: [Role, Role];
}

export function isMatchFile(x: unknown): x is MatchFile {
  const f = x as MatchFile;
  return !!f && f.format === "curling-match" && f.version === 1 && !!f.match?.current && Array.isArray(f.match.current.stones) && Array.isArray(f.match.played);
}

export class EndMode {
  active = false;
  private match: MatchState = startMatch();
  private seed = 1;
  private shots: MatchShot[] = [];
  private skills: [TeamSkills, TeamSkills] = [uniformTeam(), uniformTeam()];
  private uniform: [boolean, boolean] = [true, true];
  private lastRuling: ShotRuling | null = null;
  private newArmed = false;
  /** Cosa fa il pulsante principale della scheda di fine end. */
  private sheetAction: "next" | "new" = "next";

  constructor(private readonly host: EndHost) {
    $("end-undo").addEventListener("click", () => this.undo());
    $("end-new").addEventListener("click", () => this.askNewMatch());
    $("match-copy").addEventListener("click", () => void this.copy());
    $("decision-leave").addEventListener("click", () => this.choose("leave"));
    $("decision-restore").addEventListener("click", () => this.choose("restore"));
    $("decision-new").addEventListener("click", () => (this.sheetAction === "next" ? this.nextEnd() : this.newMatch()));
    $("decision-close").addEventListener("click", () => this.hideSheet());
    for (const id of ["end-fgz", "end-fgz-stones", "end-notick", "end-hammer", "match-ends", "match-extra"]) $(id).addEventListener("change", () => this.render());
    this.loadSkills();
    this.renderSkills();
  }

  private get state(): EndState {
    return this.match.current;
  }

  /** Entra in modalità partita: riapre `file` se c'è, altrimenti la partita salvata non finita, altrimenti una nuova. */
  enter(file?: MatchFile): void {
    this.active = true;
    document.body.dataset.mode = "end";
    if (file && this.load(file)) return;
    const saved = this.readSaved();
    if (saved && !saved.match.over) {
      this.restore(saved);
      this.host.status(tt("match.resumed", { end: endNumber(this.match) }));
    } else this.newMatch();
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

  /** Seme del prossimo tiro: seme della partita più il numero del tiro nella partita. */
  seedFor(): number {
    return this.seed + this.shots.length;
  }

  /** Giocatore di turno: ruolo, precisione del tiro e guadagno medio dei due sweeper. */
  shooter(): Shooter {
    const team = nextTeam(this.state);
    const role = currentRole(this.state);
    const sk = this.skillsOf(team);
    const sweepers = sweepersFor(role);
    const gain = (SWEEP_GAIN[sk[sweepers[0]].sweep] + SWEEP_GAIN[sk[sweepers[1]].sweep]) / 2;
    return { team, role, precision: { ...SHOT_PRECISION[sk[role].shot] }, sweepGain: gain, sweepers };
  }

  /** Si può consegnare la prossima pietra? Se no, il motivo da mostrare. */
  canThrow(): Text | null {
    if (this.match.over) return tt("match.over");
    if (this.state.pending) return tt("end.waitChoice", { team: teamRef(this.state.pending.chooser) });
    if (isComplete(this.state)) return tt("end.over");
    return null;
  }

  /** Pietre e indicazioni da disegnare: FGZ in vigore e pietre che contano a fine end. */
  sceneExtras(): { fgz: boolean; counting: number[] } {
    return { fgz: fgzActive(this.state) && !isComplete(this.state), counting: this.state.score?.counting ?? [] };
  }

  /** Tiro concluso: applica FGZ e no-tick, registra il replay e aggiorna le pietre in gioco. */
  afterShot(before: StonePlacement[], after: StonePlacement[], team: Team, replay?: Replay): void {
    const n = nextStoneNumber(this.state);
    if (replay) this.shots.push({ end: endNumber(this.match), stone: n, replay });
    const { state, ruling } = applyShot(this.state, before, after, team);
    this.match = { ...this.match, current: state };
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
    this.save();
    this.render();
    if (ruling.kind === "ok") this.host.status(() => this.lineText());
    this.host.redraw();
  }

  private choose(choice: "leave" | "restore"): void {
    this.match = { ...this.match, current: resolveNoTick(this.state, choice) };
    this.host.setStones(this.state.stones);
    this.hideSheet();
    this.message(tt(choice === "leave" ? "end.noTickLeft" : "end.noTickRestored"));
    if (this.state.score) this.showResult();
    this.save();
    this.render();
    this.host.redraw();
  }

  private undo(): void {
    if (this.host.busy() || this.state.history.length === 0 || this.match.over) return;
    this.match = { ...this.match, current: undoShot(this.state) };
    const end = endNumber(this.match);
    const last = this.shots[this.shots.length - 1];
    if (last && last.end === end) this.shots.pop();
    this.host.setStones(this.state.stones);
    this.hideSheet();
    this.message(tt("end.undone", { n: nextStoneNumber(this.state) }));
    this.save();
    this.render();
    this.host.redraw();
  }

  /** «Nuova partita» durante una partita in corso va confermata con un secondo tocco. */
  private askNewMatch(): void {
    if (this.host.busy()) return;
    const inProgress = !this.match.over && (this.match.played.length > 0 || this.state.delivered > 0);
    if (inProgress && !this.newArmed) {
      this.newArmed = true;
      $("end-new").textContent = t("match.newConfirm");
      setTimeout(() => {
        this.newArmed = false;
        $("end-new").textContent = t("match.new");
      }, 3000);
      return;
    }
    this.newArmed = false;
    $("end-new").textContent = t("match.new");
    this.newMatch();
  }

  private newMatch(): void {
    if (this.host.busy()) return;
    const hammer = Number($<HTMLSelectElement>("end-hammer").value) as Team;
    this.match = startMatch(this.readRules(), hammer);
    this.seed = 1 + Math.floor(Math.random() * 1_000_000);
    this.shots = [];
    this.startCurrentEnd();
    this.host.status(tt("match.started", { ends: this.match.rules.ends, team: teamRef(nextTeam(this.state)), hammer: teamRef(hammer) }));
    this.save();
  }

  /** Chiude l'end concluso e prepara il successivo; se la partita è finita mostra il risultato. */
  private nextEnd(): void {
    if (this.host.busy() || !this.state.score) return;
    this.match = finishEnd(this.match);
    this.save();
    if (this.match.over) {
      this.showMatchOver();
      this.render();
      return;
    }
    this.startCurrentEnd();
    const key: Key = isExtraEnd(this.match) ? "match.extraStarted" : "match.endStarted";
    this.host.status(tt(key, { end: endNumber(this.match), team: teamRef(nextTeam(this.state)), hammer: teamRef(this.state.hammer) }));
  }

  private startCurrentEnd(): void {
    this.lastRuling = null;
    this.host.setStones(this.state.stones);
    this.host.clearTraces();
    this.hideSheet();
    this.message("");
    this.render();
    this.host.redraw();
  }

  private readRules(): MatchRules {
    const fgzStones = Math.max(0, Math.min(15, Math.round(Number($<HTMLInputElement>("end-fgz-stones").value) || WORLD_CURLING_2026.fgzStones)));
    const ends = Math.max(1, Math.min(12, Math.round(Number($<HTMLInputElement>("match-ends").value) || 8)));
    return {
      ends,
      extraEnd: $<HTMLInputElement>("match-extra").checked,
      end: { fgz: $<HTMLInputElement>("end-fgz").checked, fgzStones, noTick: $<HTMLInputElement>("end-notick").checked },
    };
  }

  // ——— Salvataggio ———

  serialize(): MatchFile {
    return {
      format: "curling-match",
      version: 1,
      app: APP_VERSION,
      engineVersion: ENGINE_VERSION,
      seed: this.seed,
      match: this.match,
      skills: this.skills,
      uniform: this.uniform,
      shots: this.shots,
    };
  }

  /** Riapre una partita salvata o copiata; restituisce false se il file non è valido. */
  load(file: unknown): boolean {
    if (!isMatchFile(file)) return false;
    this.restore(file);
    this.host.status(tt("match.loaded", { end: endNumber(this.match), n: Math.min(16, nextStoneNumber(this.state)) }));
    this.save();
    return true;
  }

  private restore(f: MatchFile): void {
    this.match = structuredClone(f.match);
    this.seed = f.seed;
    this.shots = structuredClone(f.shots ?? []);
    if (f.skills?.length === 2) this.skills = structuredClone(f.skills);
    if (f.uniform?.length === 2) this.uniform = [...f.uniform];
    $<HTMLInputElement>("match-ends").value = String(this.match.rules.ends);
    $<HTMLInputElement>("match-extra").checked = this.match.rules.extraEnd;
    $<HTMLSelectElement>("end-hammer").value = String(this.match.firstHammer);
    $<HTMLInputElement>("end-fgz").checked = this.match.rules.end.fgz;
    $<HTMLInputElement>("end-fgz-stones").value = String(this.match.rules.end.fgzStones);
    $<HTMLInputElement>("end-notick").checked = this.match.rules.end.noTick;
    this.saveSkills();
    this.renderSkills();
    this.startCurrentEnd();
    if (this.state.pending) this.showChoice(this.state.pending.chooser);
    else if (this.match.over) this.showMatchOver();
    else if (this.state.score) this.showResult();
  }

  private save(): void {
    try {
      localStorage.setItem(MATCH_KEY, JSON.stringify(this.serialize()));
    } catch {
      /* memoria del browser piena o non disponibile: la partita resta solo in questa pagina */
    }
  }

  private readSaved(): MatchFile | null {
    try {
      const raw = localStorage.getItem(MATCH_KEY);
      const f = raw ? JSON.parse(raw) : null;
      return isMatchFile(f) ? f : null;
    } catch {
      return null;
    }
  }

  private async copy(): Promise<void> {
    const text = JSON.stringify(this.serialize());
    try {
      await navigator.clipboard.writeText(text);
      this.message(tt("match.copied"));
    } catch {
      const ta = $<HTMLTextAreaElement>("replay-text");
      ta.value = text;
      ta.focus();
      ta.select();
      this.message(tt("replay.copyFailed"));
    }
  }

  // ——— Abilità dei giocatori ———

  private skillsOf(team: Team): TeamSkills {
    return this.uniform[team] ? uniformTeam(this.skills[team].lead) : this.skills[team];
  }

  private loadSkills(): void {
    try {
      const raw = localStorage.getItem(SKILLS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { skills: [TeamSkills, TeamSkills]; uniform: [boolean, boolean] };
      if (s.skills?.length === 2 && s.uniform?.length === 2) {
        this.skills = s.skills;
        this.uniform = s.uniform;
      }
    } catch {
      /* valori predefiniti */
    }
  }

  private saveSkills(): void {
    try {
      localStorage.setItem(SKILLS_KEY, JSON.stringify({ skills: this.skills, uniform: this.uniform }));
    } catch {
      /* niente */
    }
  }

  /** Tabella delle abilità: per squadra, una riga per ruolo oppure una sola per tutta la squadra. */
  renderSkills(): void {
    const box = $("players");
    box.replaceChildren();
    for (const team of [0, 1] as Team[]) {
      const fs = document.createElement("fieldset");
      fs.className = "team-skills";
      const lg = document.createElement("legend");
      lg.innerHTML = `<i class="dot t${team}"></i> `;
      lg.append(teamName(team));
      fs.append(lg);
      const uni = document.createElement("label");
      uni.className = "radio";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.uniform[team];
      cb.addEventListener("change", () => {
        this.uniform[team] = cb.checked;
        this.changed();
      });
      uni.append(cb, " ", t("match.uniform"));
      fs.append(uni);
      const grid = document.createElement("div");
      grid.className = "skill-grid";
      for (const h of ["", t("match.shotCol"), t("match.sweepCol")]) {
        const s = document.createElement("span");
        s.className = "skill-head";
        s.textContent = h;
        grid.append(s);
      }
      const roles: Role[] = this.uniform[team] ? ["lead"] : [...ROLES];
      for (const role of roles) {
        const name = document.createElement("span");
        name.textContent = this.uniform[team] ? t("match.team") : roleName(role);
        grid.append(name, this.levelSelect(team, role, "shot"), this.levelSelect(team, role, "sweep"));
      }
      fs.append(grid);
      box.append(fs);
    }
  }

  private levelSelect(team: Team, role: Role, kind: keyof PlayerSkill): HTMLSelectElement {
    const sel = document.createElement("select");
    const levels: string[] = kind === "shot" ? SHOT_LEVELS : SWEEP_LEVELS;
    for (const l of levels) {
      const o = document.createElement("option");
      o.value = l;
      o.textContent = t(`level.${l}` as Key);
      sel.append(o);
    }
    sel.value = this.skills[team][role][kind];
    sel.setAttribute("aria-label", `${teamName(team)} · ${this.uniform[team] ? t("match.team") : roleName(role)} · ${t(kind === "shot" ? "match.shotCol" : "match.sweepCol")}`);
    sel.addEventListener("change", () => {
      const set = (p: PlayerSkill) => {
        if (kind === "shot") p.shot = sel.value as ShotLevel;
        else p.sweep = sel.value as SkillLevel;
      };
      if (this.uniform[team]) for (const r of ROLES) set(this.skills[team][r]);
      else set(this.skills[team][role]);
      this.changed();
    });
    return sel;
  }

  private changed(): void {
    // Passando a «stessa abilità», vale quella del lead per tutti.
    for (const team of [0, 1] as Team[]) if (this.uniform[team]) this.skills[team] = uniformTeam(this.skills[team].lead);
    this.saveSkills();
    this.save();
    this.renderSkills();
    this.render();
  }

  // ——— Interfaccia ———

  render(): void {
    const e = this.state;
    for (const team of [0, 1] as Team[]) {
      const row = $(`end-row-${team}`);
      row.classList.toggle("turn", !this.match.over && !isComplete(e) && !e.pending && nextTeam(e) === team);
      $(`end-hammer-${team}`).hidden = e.hammer !== team || this.match.over;
      const pips = $(`end-pips-${team}`);
      pips.replaceChildren();
      const left = stonesLeft(e, team);
      for (let i = 0; i < 8; i++) {
        const p = document.createElement("i");
        p.className = `pip t${team}${i < left ? "" : " used"}`;
        pips.append(p);
      }
      pips.setAttribute("aria-label", t("end.stonesLeft", { n: left }));
      $(`end-points-${team}`).textContent = String(totals(this.match)[team] + (e.score && !this.match.over && e.score.team === team ? e.score.points : 0));
    }
    this.renderBoard();
    $("end-line").textContent = this.lineText();
    const sh = !this.match.over && !isComplete(e) && !e.pending ? this.shooter() : null;
    const sk = sh ? this.skillsOf(sh.team) : null;
    $("end-shooter").textContent =
      sh && sk
        ? t("match.shooter", { role: roleName(sh.role), shot: t(`level.${sk[sh.role].shot}` as Key), a: roleName(sh.sweepers[0]), b: roleName(sh.sweepers[1]) })
        : "";
    const r = e.rules;
    $("end-fgz-state").textContent = this.match.over ? "" : !r.fgz ? t("end.fgzOff") : fgzActive(e) ? t("end.fgzOn", { n: r.fgzStones + 1 }) : t("end.fgzOver");
    $<HTMLButtonElement>("end-undo").disabled = e.history.length === 0 || this.host.busy() || this.match.over;
    $<HTMLButtonElement>("end-new").disabled = this.host.busy();
    if (!this.newArmed) $("end-new").textContent = t("match.new");
    if (!$("decision").hidden && $("decision-result").hidden === false) this.refreshSheetButton();
  }

  /** Tabellone classico: una colonna per end (gli extra end con «X»), totale in fondo. */
  private renderBoard(): void {
    const m = this.match;
    const cols = Math.max(m.rules.ends, m.played.length + (m.over ? 0 : 1));
    const table = $("match-board");
    table.replaceChildren();
    const head = document.createElement("tr");
    const corner = document.createElement("th");
    corner.textContent = t("match.endCol");
    corner.scope = "col";
    head.append(corner);
    for (let i = 1; i <= cols; i++) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = i > m.rules.ends ? t("match.extraCol") : String(i);
      if (!m.over && i === endNumber(m)) th.className = "now";
      head.append(th);
    }
    const tot = document.createElement("th");
    tot.scope = "col";
    tot.textContent = t("match.total");
    head.append(tot);
    table.append(head);
    const sums = totals(m);
    for (const team of [0, 1] as Team[]) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.innerHTML = `<i class="dot t${team}"></i>`;
      th.append(" ", teamName(team));
      tr.append(th);
      for (let i = 1; i <= cols; i++) {
        const td = document.createElement("td");
        const p = m.played[i - 1];
        if (p) {
          td.textContent = p.score.team === team ? String(p.score.points) : "0";
          if (p.hammer === team) td.classList.add("had-hammer");
          if (p.score.team === team) td.classList.add("scored");
        } else if (!m.over && i === endNumber(m)) {
          td.className = "now";
          if (this.state.hammer === team) td.classList.add("had-hammer");
        }
        tr.append(td);
      }
      const total = document.createElement("td");
      total.className = "total";
      total.textContent = String(sums[team]);
      tr.append(total);
      table.append(tr);
    }
  }

  private message(s: Text): void {
    bindText($("end-msg"), s);
    if (textOf(s)) this.host.status(s);
  }

  private lineText(): string {
    const m = this.match;
    const e = m.current;
    if (m.over) return this.matchResultText();
    if (e.pending) return t("end.waitChoice", { team: teamName(e.pending.chooser) });
    if (isComplete(e)) return this.resultText();
    const end = isExtraEnd(m) ? t("match.extraCol") : String(endNumber(m));
    return `${t("match.endLabel", { end })} · ${t("end.next", { n: nextStoneNumber(e), team: teamName(nextTeam(e)) })}`;
  }

  private resultText(): string {
    const s = this.state.score!;
    return s.team === null ? t("end.blank") : t("end.scored", { team: teamName(s.team), n: s.points });
  }

  private matchResultText(): string {
    const [a, b] = totals(this.match);
    const w = winner(this.match);
    if (w === null) return t("match.draw", { a, b });
    return t("match.won", { team: teamName(w), a: Math.max(a, b), b: Math.min(a, b) });
  }

  private showChoice(chooser: Team): void {
    bindText($("decision-text"), () => t("end.choiceText", { team: teamName(chooser) }));
    $("decision-choice").hidden = false;
    $("decision-result").hidden = true;
    $("decision").hidden = false;
    this.showBoard();
  }

  /** Fine end: punteggio, hammer dell'end successivo e pulsante per proseguire o concludere. */
  private showResult(): void {
    const s = this.state.score!;
    const hammer = nextHammer(this.state);
    const last = finishEnd(this.match).over;
    this.sheetAction = "next";
    bindText($("decision-text"), () => {
      let text = this.resultText();
      if (!last) text += " " + t("end.nextHammer", { team: teamName(hammer) }) + (s.team === null ? " " + t("end.blankHammer") : "");
      return text;
    });
    this.refreshSheetButton();
    $("decision-choice").hidden = true;
    $("decision-result").hidden = false;
    $("decision").hidden = false;
    this.showBoard();
  }

  private showMatchOver(): void {
    this.sheetAction = "new";
    bindText($("decision-text"), () => this.matchResultText());
    this.refreshSheetButton();
    $("decision-choice").hidden = true;
    $("decision-result").hidden = false;
    $("decision").hidden = false;
    this.showBoard();
  }

  private refreshSheetButton(): void {
    const key: Key = this.sheetAction === "new" ? "match.new" : finishEnd(this.match).over ? "match.finish" : "match.nextEnd";
    $("decision-new").textContent = t(key);
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
