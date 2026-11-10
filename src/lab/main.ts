/**
 * Laboratorio 2D – fase 1.
 * Tira, spazza, osserva traiettorie e tempi, salva e riesegui i tiri.
 */
import { calibrate, spinRateForTurns, stopForSpeed, speedToStopAt, sweepDirFor, sweepDirTargetForGain, sweepFrictionForGain } from "../core/calibrate";
import { BACK_LINE_OUTSIDE, FAR_HOG_INSIDE, HACK_Y, HOUSE_RADIUS, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../core/geometry";
import { APP_VERSION, BASE_PARAMS, COLLISIONS, collisionLevelOf, CURVES, curveLevelOf, DT, ENGINE_VERSION, PROFILES, SHOT_PRECISION, SPIN_TURNS, SWEEP_GAIN, SWEEP_SIDE_SHARE, TAKEOUT_SPEED, type CollisionLevel, type IceParams, type Precision, type ProfileId, type ShotLevel, type SkillLevel, type SpinLevel } from "../core/params";
import { REFERENCE_HASH, referenceReplay } from "../core/reference";
import { makeReplay, runReplay, Sim, skillFromPrecision, sweepAt, validateReplay, type Replay, type Skill, type StonePlacement } from "../core/sim";
import { bindText, getLanguage, initialLanguage, num, onLanguageChange, setLanguage, t, tIn, tt, type Lang, type Text } from "../i18n";
import type { Key } from "../i18n/it";
import { HOUSE_VIEW, Renderer, SHEET_VIEW, type DrawStone, type Scene } from "./render";
import { PlacementTool } from "./placement-tool";
import { FeedbackPanel } from "./feedback";
import { mountLanguagePicker } from "./lang-picker";
import { Sound } from "./audio";
import { EndMode, isMatchFile, type MatchFile } from "./end-mode";
import { deliveryPosition, planDelivery, speedForSplit, splitTime, type Delivery, type SplitKind } from "../core/delivery";
import { makeScenario, validateScenario, type PlacementCheck } from "../core/placement";
import { SWEEP_HARD, type SweepCmd, type Team } from "../core/physics";
import { executionError, hasExecutionNoise, type ExecutionError } from "../core/execution";

const MAX_STONES = 16;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface LogEntry {
  n: number;
  replay: Replay;
  speed: number;
  spin: 1 | -1;
  bh: number;
  hh: number | null;
  ht: number | null;
  stop: { x: number; y: number } | null;
  curl: number;
  turns: number;
  sweep: number;
  outcome: Outcome;
  hash: string;
}

/** Esito di un tiro, tradotto quando serve: nel registro nella lingua scelta, nel rapporto in italiano. */
interface Outcome {
  reason: Key;
  others: number;
}
function outcomeText(o: Outcome, lang: Lang = getLanguage()): string {
  const base = tIn(lang, o.reason);
  return o.others ? `${base} · ${tIn(lang, "outcome.hit", { n: o.others })}` : base;
}

const state = {
  params: null as IceParams | null,
  stones: [] as StonePlacement[],
  broom: { x: -0.9, y: TEE_Y },
  sim: null as Sim | null,
  playback: null as Replay | null,
  pendingReplay: null as Replay | null,
  log: [] as LogEntry[],
  /** Tasti di spazzata tenuti premuti: Spazio (Hard) e frecce (da un lato). */
  keys: { space: false, left: false, right: false },
  /** Pulsante «Spazza» del riquadro (Hard). */
  sweepButton: false,
  /** Comando del pad di spazzata sotto la casa, o null se il dito non è sul pad. */
  sweepPad: null as SweepCmd | null,
  /** Posizione del dito sul pad (frazioni della larghezza e dell'altezza). */
  padDot: null as { x: number; y: number } | null,
  angles: new Map<number, number>(),
  lastFrame: 0,
  tickDebt: 0,
  /** Fase di consegna in corso (animazione dalla back line al rilascio), o null. */
  delivery: null as { plan: Delivery; t: number } | null,
  /** Intertempi dell'ultimo tiro, mostrati sopra la casa. */
  splits: { bh: null as number | null, hh: null as number | null, running: false },
  /** Errore di esecuzione dell'ultimo tiro (abilità non perfetta), o null. */
  execErr: null as ExecutionError | null,
  lastSetup: null as { stones: StonePlacement[] } | null,
  lastTraces: [] as Scene["traces"],
};

// ——— Interfaccia: testi statici ———
function applyTexts(): void {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t as Key, { version: ENGINE_VERSION, app: APP_VERSION });
  });
  document.querySelectorAll<HTMLElement>("[data-t-label]").forEach((el) => {
    const label = t(el.dataset.tLabel as Key);
    el.setAttribute("aria-label", label);
    el.title = label;
  });
  document.querySelectorAll<HTMLElement>("[data-t-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.tAria as Key));
  });
  document.title = t("app.title");
}

// ——— Ghiaccio ———
function readTargets() {
  return {
    hogToHog: Number($<HTMLInputElement>("hh").value),
    curl: Number($<HTMLInputElement>("curl").value),
  };
}

function recalibrate(): void {
  bindText($("derived"), tt("ice.calibrating"));
  // Lascia ridisegnare l'interfaccia prima del calcolo (circa mezzo secondo).
  setTimeout(() => {
    state.params = calibrate(readTargets(), { ...BASE_PARAMS, ...CURVES.spin });
    bindText($("derived"), tt("ice.derived", { mu: state.params.mu.toFixed(5), k: state.params.curlK.toFixed(5) }));
    updateWeightMarks();
    updateShotReadout();
    updateSweepReadout();
    draw();
  }, 20);
}

function applyProfile(id: ProfileId): void {
  const p = PROFILES[id];
  $<HTMLInputElement>("hh").value = String(p.hogToHog);
  $<HTMLInputElement>("curl").value = String(p.curl);
  recalibrate();
}

// ——— Peso ———
const weightSlider = () => $<HTMLInputElement>("weight");

/**
 * Tipi di tiro: ognuno imposta un peso di partenza, che poi si ritocca. Guardia: ferma 1,5 m prima
 * della casa; Draw e Freeze: al tee; Raise: peso fino alla hack line; Bocciata e Peel: 3,0 e 3,8 m/s.
 */
function shotTypes(): { key: Key; v: number }[] {
  const p = state.params!;
  return [
    { key: "type.guard", v: speedToStopAt(p, TEE_Y - HOUSE_RADIUS - 1.5) },
    { key: "type.draw", v: speedToStopAt(p, TEE_Y) },
    { key: "type.freeze", v: speedToStopAt(p, TEE_Y - 0.3) },
    { key: "type.raise", v: speedToStopAt(p, HACK_Y) },
    { key: "type.takeout", v: 3.0 },
    { key: "type.peel", v: 3.8 },
  ];
}

function updateWeightMarks(): void {
  const box = $("shot-types");
  box.replaceChildren();
  for (const m of shotTypes()) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t(m.key);
    b.dataset.v = m.v.toFixed(2);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => setSpeed(m.v));
    box.append(b);
  }
  markShotType();
}

/** Evidenzia il tipo di tiro che corrisponde al peso attuale. */
function markShotType(): void {
  const v = currentSpeed().toFixed(2);
  document.querySelectorAll<HTMLButtonElement>("#shot-types button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
}

function setSpeed(v: number): void {
  const s = weightSlider();
  const clamped = Math.max(Number(s.min), Math.min(Number(s.max), v));
  s.value = clamped.toFixed(2);
  updateShotReadout();
  draw();
}

const SPLIT_KEY = "curlsim.splitKind";
function splitKind(): SplitKind {
  return $<HTMLSelectElement>("split-kind").value === "th" ? "th" : "bh";
}

/** Ritocco del peso di 0,05 s sull'intertempo scelto: più tempo = meno peso. */
function nudgeWeight(dt: number): void {
  const k = splitKind();
  const now = Math.round(splitTime(currentSpeed(), k) * 100) / 100;
  setSpeed(speedForSplit(now + dt, k));
}

function describeStop(y: number): string {
  if (y - STONE_RADIUS <= FAR_HOG_INSIDE) return t("where.beforeHog");
  if (y - STONE_RADIUS > BACK_LINE_OUTSIDE) return t("where.past");
  const front = TEE_Y - HOUSE_RADIUS - STONE_RADIUS;
  if (y < front) return t("where.fgz", { d: num(front - y, 1) });
  const d = y - TEE_Y;
  return t("where.house", { d: num(Math.abs(d), 2), side: t(d < 0 ? "side.short" : "side.long") });
}

function currentSpeed(): number {
  return Number(weightSlider().value);
}
function currentSpin(): 1 | -1 {
  return $<HTMLInputElement>("spin-cw").checked ? 1 : -1;
}

function currentTurns(): number {
  return Math.max(0, Number($<HTMLInputElement>("spin-turns").value) || 0);
}
function currentSpinRate(): number {
  return spinRateForTurns(state.params!, currentTurns());
}

function applySpinLevel(level: SpinLevel | "custom"): void {
  if (level !== "custom") $<HTMLInputElement>("spin-turns").value = String(SPIN_TURNS[level]);
  updateShotReadout();
}

/** Allinea il menu del livello al numero di giri scritto a mano. */
function syncSpinLevel(): void {
  const turns = currentTurns();
  const match = (Object.keys(SPIN_TURNS) as SpinLevel[]).find((k) => SPIN_TURNS[k] === turns);
  $<HTMLSelectElement>("spin-level").value = match ?? "custom";
  updateShotReadout();
}

/** Quanto più corta si ferma la pietra con i giri attuali rispetto al tiro dritto (m); 0 se non serve. */
function spinShortfall(v: number): number {
  const turns = currentTurns();
  if (!state.params || turns <= SPIN_TURNS.normal + 1.5 || v >= TAKEOUT_SPEED) return 0;
  const straight = stopForSpeed(state.params, v);
  if (straight > BACK_LINE_OUTSIDE + STONE_RADIUS) return 0;
  const sim = new Sim(state.params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: v, w: spinRateForTurns(state.params, turns) });
  sim.runToEnd();
  const stop = sim.metrics.stop;
  return stop ? straight - stop.y : 0;
}

function updateShotReadout(): void {
  if (!state.params) return;
  const w = currentSpinRate();
  $("spin-rate").textContent = t("shot.spinRate", { w: num(w, 2), rps: num(w / (2 * Math.PI), 2) });
  const v = currentSpeed();
  const kind = splitKind();
  const split = t("shot.weightValue", { t: num(splitTime(v, kind), 2), kind: t(kind === "th" ? "split.th" : "split.bh"), v: num(v, 2) });
  $("weight-value").textContent = split;
  markShotType();
  let where = describeStop(stopForSpeed(state.params, v));
  // Con molti giri la curva si concentra nel finale e la pietra si ferma più corta del tiro dritto.
  const short = spinShortfall(v);
  if (short >= 0.05) where += ` (${t("shot.spinShort", { turns: num(currentTurns(), 1), d: num(short, 2) })})`;
  $("weight-stop").textContent = t("shot.weightStop", { where });
  // Comandi flottanti su telefono: stesso peso e stessa rotazione dei comandi del riquadro Tiro.
  $<HTMLInputElement>("fab-weight").value = String(v);
  $("fab-weight-value").textContent = split;
  $("fab-weight-stop").textContent = `· ${where}`;
  $("fab-spin").textContent = t(currentSpin() === 1 ? "fab.spinCw" : "fab.spinCcw");
  const bx = state.broom.x;
  $("broom-value").textContent = t("shot.broomValue", {
    x: `${num(Math.abs(bx) * 100, 0)} cm ${bx < -0.005 ? t("shot.left") : bx > 0.005 ? t("shot.right") : ""}`.trim(),
  });
}

// ——— Abilità: precisione del tiro e livello degli sweeper ———
function applyShotLevel(level: ShotLevel | "custom"): void {
  if (level === "custom") return;
  const p = SHOT_PRECISION[level];
  $<HTMLInputElement>("sk-line").value = String(Math.round(p.lineDraw * 100));
  $<HTMLInputElement>("sk-line-to").value = String(Math.round(p.lineTakeout * 100));
  $<HTMLInputElement>("sk-stop").value = String(Math.round(p.stopTypical * 100));
  updateMixReadout();
}

function readPrecision(): Precision {
  const cm = (id: string) => Math.max(0, Number($<HTMLInputElement>(id).value) || 0) / 100;
  return { lineDraw: cm("sk-line"), lineTakeout: cm("sk-line-to"), stopTypical: cm("sk-stop") };
}

function updateMixReadout(): void {
  const s = readPrecision().stopTypical;
  $("sk-mix").textContent =
    s === 0 ? t("skill.mixNone") : t("skill.mix", { a: num((s * 100) / 3, 0), b: num(s * 100, 0), c: num((s * 10) / 3, 1) });
}
function syncShotLevel(): void {
  const s = readPrecision();
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const match = (Object.keys(SHOT_PRECISION) as ShotLevel[]).find((k) => {
    const p = SHOT_PRECISION[k];
    return close(p.lineDraw, s.lineDraw) && close(p.lineTakeout, s.lineTakeout) && close(p.stopTypical, s.stopTypical);
  });
  $<HTMLSelectElement>("shot-level").value = match ?? "custom";
  updateMixReadout();
}

function sweepGain(): number {
  return Math.max(0, Number($<HTMLInputElement>("sweep-gain").value) || 0);
}
function applySweepLevel(level: SkillLevel | "custom"): void {
  if (level !== "custom") $<HTMLInputElement>("sweep-gain").value = String(SWEEP_GAIN[level]);
  updateSweepReadout();
}
function syncSweepLevel(): void {
  const g = sweepGain();
  const match = (Object.keys(SWEEP_GAIN) as SkillLevel[]).find((k) => Math.abs(SWEEP_GAIN[k] - g) < 1e-9);
  $<HTMLSelectElement>("sweep-level").value = match ?? "custom";
  updateSweepReadout();
}

/** Parametri del tiro: ghiaccio calibrato più l'effetto della spazzata del livello scelto. */
function shotParams(): IceParams {
  const ice = state.params!;
  const gain = activeSweepGain();
  const p: IceParams = { ...ice, sweepFriction: sweepFrictionForGain(ice, gain), sweepSideShare: SWEEP_SIDE_SHARE, ...COLLISIONS[collisionLevel()] };
  return { ...p, sweepDir: sweepDirFor(p, sweepDirTargetForGain(gain)) };
}

/** Etichetta degli urti per il rapporto (sempre in italiano), ricavata dai valori usati davvero nel tiro. */
function collisionsLabel(p: IceParams): string {
  const lvl = collisionLevelOf(p);
  if (lvl) return tIn("it", `fb.collisions.${lvl}` as Key);
  return tIn("it", "fb.collisions.custom", { e: String(p.restitution).replace(".", ","), e2: String(p.restitutionSecondary ?? p.restitution).replace(".", ",") });
}

function collisionLevel(): CollisionLevel {
  const v = $<HTMLSelectElement>("collisions").value;
  return v === "lively" || v === "normal" ? v : "soft";
}

function updateSweepReadout(): void {
  if (!state.params) return;
  const p = shotParams();
  // Draw al tee spazzato dal rilascio alla tee line: tutto il percorso è spazzato.
  const d = TEE_Y - RELEASE_Y;
  $("sweep-readout").textContent = t("skill.sweepReadout", { f: num(p.sweepFriction, 3), d: num(d / p.sweepFriction - d, 1) });
}

// ——— Tiro ———
function skill(): Skill {
  return skillFromPrecision(endMode?.active ? endMode.shooter().precision : readPrecision());
}

/** Guadagno della spazzata del tiro: in partita è quello dei due sweeper di turno. */
function activeSweepGain(): number {
  return endMode?.active ? endMode.shooter().sweepGain : sweepGain();
}

function throwStone(): void {
  if (state.sim || !state.params) return;
  if (endMode?.active) {
    const reason = endMode.canThrow();
    if (reason) {
      setStatus(reason);
      return;
    }
  } else if (state.stones.length >= MAX_STONES) {
    setStatus(tt("status.full"));
    return;
  }
  const n = state.log.length + 1;
  const seed = endMode?.active ? endMode.seedFor() : Number($<HTMLInputElement>("seed").value) + n;
  const team = endMode?.active ? endMode.team() : nextTeam();
  const replay = makeReplay(
    shotParams(),
    team,
    state.stones,
    { broomX: state.broom.x, broomY: state.broom.y, speed: currentSpeed(), spin: currentSpin(), spinRate: currentSpinRate(), spinTurns: currentTurns() },
    skill(),
    seed,
  );
  startSim(replay, null);
}

function startSim(replay: Replay, playback: Replay | null): void {
  state.lastSetup = { stones: replay.stonesBefore.map((s) => ({ ...s })) };
  state.pendingReplay = replay;
  state.playback = playback;
  state.sim = new Sim(replay.params, replay.stonesBefore, replay.team, replay.release);
  state.delivery = { plan: planDelivery(replay.release), t: 0 };
  state.splits = { bh: null, hh: null, running: true };
  state.execErr = hasExecutionNoise(replay) ? executionError(replay) : null;
  state.tickDebt = 0;
  state.lastFrame = performance.now();
  sound.unlock();
  setStatus(playback ? tt("status.replaying", { n: state.log.length }) : tt("status.moving"));
  setBusy(true);
  // Su telefono porta in vista la casa, dove si vede la pietra arrivare.
  if (isNarrow()) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("views").scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }
  requestAnimationFrame(frame);
}

/** Comando di spazzata dal vivo: il pad prima di tutto, poi frecce, Spazio e pulsante (Hard). */
function sweepInput(): SweepCmd | null {
  if (state.sweepPad) return state.sweepPad;
  const k = state.keys;
  if (k.left !== k.right) return { push: k.left ? -1 : 1, level: 1 };
  if (k.space || state.sweepButton) return SWEEP_HARD;
  return null;
}

/** Comando di spazzata del tick attuale: dal replay in riproduzione, altrimenti dal vivo. */
function currentSweep(sim: Sim): SweepCmd | null {
  if (state.playback) return sweepAt(sim.world.tick, state.playback.sweep, state.playback.sweepCmds);
  return sweepInput();
}

function frame(now: number): void {
  const sim = state.sim;
  if (!sim) return;
  const speed = Number($<HTMLSelectElement>("play-speed").value);
  const elapsed = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  let simTime = elapsed * speed;
  // Prima del rilascio: la pietra è ancora in mano al tiratore.
  const dl = state.delivery;
  if (dl) {
    dl.t += simTime;
    if (dl.t < dl.plan.backToHog) {
      // In consegna: la pietra scivola alla velocità della traiettoria di consegna.
      const speed = Math.max(0, dl.plan.speedAtBack - dl.plan.decel * Math.min(dl.t, dl.plan.backToHog));
      sound.update([{ id: state.sim?.world.deliveredId ?? -1, speed }], false, 0);
      updateSplits();
      draw();
      requestAnimationFrame(frame);
      return;
    }
    simTime = dl.t - dl.plan.backToHog;
    state.splits.bh = dl.plan.backToHog;
    state.delivery = null;
  }
  state.tickDebt += simTime / DT;
  const ticks = Math.floor(state.tickDebt);
  state.tickDebt -= ticks;
  let impact = 0;
  let board = 0;
  for (let i = 0; i < ticks && !sim.done; i++) {
    const before = sim.world.stones.map((s) => [s.vx, s.vy, s.inPlay ? 1 : 0]);
    sim.step(currentSweep(sim));
    // Urto: un salto di velocità in un solo passo (l'attrito del ghiaccio toglie molto meno).
    // Una pietra che esce dal gioco (sponda, linea laterale, fondo) si ferma di colpo: è un altro suono.
    sim.world.stones.forEach((s, k) => {
      const b = before[k];
      if (!b) return;
      if (b[2] && !s.inPlay) board = Math.max(board, Math.hypot(b[0], b[1]));
      else if (s.inPlay) impact = Math.max(impact, Math.hypot(s.vx - b[0], s.vy - b[1]));
    });
    for (const s of sim.world.stones) {
      if (s.moving) state.angles.set(s.id, (state.angles.get(s.id) ?? 0) + s.w * DT);
    }
  }
  const sweepActive = !!(sim && !sim.done && sim.canSweep() && currentSweep(sim));
  $("sweep-btn").classList.toggle("active", sweepActive);
  renderPad();
  const moving = sim.done ? [] : sim.world.stones.filter((s) => s.moving && s.inPlay).map((s) => ({ id: s.id, speed: Math.hypot(s.vx, s.vy) }));
  sound.update(moving, sweepActive, impact, board);
  if (sim.done) sound.silence();
  if (sim.metrics.hogToHog !== null) state.splits.hh = sim.metrics.hogToHog;
  if (sim.done) state.splits.running = false;
  updateSplits();
  draw();
  if (sim.done) finishShot();
  else requestAnimationFrame(frame);
}

/** Intertempi sopra la casa: back-to-hog e hog-to-hog, che scorrono durante la corsa. */
function updateSplits(): void {
  const box = $("splits");
  box.hidden = false;
  const sp = state.splits;
  const dl = state.delivery;
  const sim = state.sim;
  const bh = $("split-bh");
  const hh = $("split-hh");
  // L'errore del tiratore si vede dopo il rilascio.
  const errBox = $("split-err");
  errBox.hidden = !state.execErr || !!dl;
  if (state.execErr && !dl) errBox.textContent = `${t("err.label")}: ${errorText(state.execErr)}`;
  if (dl) {
    bh.textContent = num(dl.t, 2);
    bh.dataset.state = "running";
  } else {
    bh.textContent = sp.bh === null ? "—" : num(sp.bh, 2);
    bh.dataset.state = "done";
  }
  if (sp.hh !== null) {
    hh.textContent = num(sp.hh, 2);
    hh.dataset.state = "done";
  } else if (!dl && sim && !sim.done) {
    hh.textContent = num(sim.world.tick * DT, 2);
    hh.dataset.state = "running";
  } else {
    hh.textContent = "—";
    hh.dataset.state = dl ? "waiting" : "done";
  }
}

function finishShot(): void {
  const sim = state.sim!;
  const replay = state.pendingReplay!;
  replay.sweep = state.playback ? state.playback.sweep.map((x) => [...x] as [number, number]) : sim.sweep.map((x) => [...x] as [number, number]);
  const cmds = state.playback ? state.playback.sweepCmds : sim.sweepCmds;
  if (cmds) replay.sweepCmds = cmds.map((x) => [...x] as typeof x);
  else delete replay.sweepCmds;
  const hash = runReplay(replay).hash;
  replay.result = { hash, ticks: sim.metrics.ticks, sweepTime: Math.round(sim.metrics.sweepTime * 100) / 100, swept: sim.sweptSeconds() };
  state.stones = sim.placements();
  state.lastTraces = collectTraces(sim);
  state.sim = null;
  setBusy(false);

  if (state.playback) {
    // Nell'end la riproduzione non cambia la partita: tornano le pietre decise dalle regole.
    if (endMode?.active) state.stones = endMode.stones().map((s) => ({ ...s }));
    const expected = state.playback.result?.hash;
    setStatus(expected === hash || !expected ? tt("status.same", { hash }) : tt("status.different", { a: hash, b: expected }));
    state.playback = null;
    draw();
    return;
  }

  const m = sim.metrics;
  const removedDelivered = m.removals.find((r) => r.id === sim.deliveredId);
  const others = m.removals.filter((r) => r.id !== sim.deliveredId).length;
  const outcome: Outcome = { reason: removedDelivered ? (`outcome.${removedDelivered.reason}` as Key) : "outcome.inPlay", others };

  // Curva = distanza dell'ultimo punto dalla linea iniziale di tiro.
  const tr = sim.trace.get(sim.deliveredId) ?? [];
  const last = m.stop ?? tr[tr.length - 1] ?? { x: 0, y: RELEASE_Y };
  const r0 = replay.release;
  const v0 = Math.hypot(r0.vx, r0.vy);
  const curl = ((last.x - r0.x) * r0.vy - (last.y - r0.y) * r0.vx) / v0;

  const entry: LogEntry = {
    n: state.log.length + 1,
    replay,
    speed: v0,
    spin: replay.shot.spin,
    bh: planDelivery(replay.release).backToHog,
    hh: m.hogToHog,
    ht: m.hogToTee,
    stop: m.stop,
    curl,
    turns: m.rotations,
    sweep: m.sweepTime,
    outcome,
    hash,
  };
  state.log.push(entry);
  setNextTeam(replay.team === 0 ? 1 : 0);
  renderLog();
  showReplay(replay);
  setStatus(tt("status.done", { n: entry.n }));
  feedback?.ask({
    n: entry.n,
    speed: v0,
    hit: sim.delivered.hitStone,
    removedOthers: others,
    sweepTime: m.sweepTime,
    sweepModes: { ...m.sweepModes },
    spinTurns: replay.shot.spinTurns ?? SPIN_TURNS.normal,
    stopped: !!m.stop,
    outcome: outcomeText(outcome, "it"),
    hash,
    ice: readTargets(),
    sweepGain: activeSweepGain(),
    collisions: collisionsLabel(replay.params),
    curve: tIn("it", `fb.curve.${curveLevelOf(replay.params)}` as Key),
    impact: m.impact,
    replay,
  });
  if (endMode?.active) endMode.afterShot(replay.stonesBefore, sim.placements(), replay.team, replay);
  draw();
}

function repeatLast(): void {
  const last = state.log[state.log.length - 1];
  if (!last || state.sim) return;
  resetTo(last.replay.stonesBefore);
  startSim(structuredClone(last.replay), last.replay);
}

/** Ferma il tiro (o la riproduzione) in corso e riporta le pietre alla posizione di partenza. */
function stopShot(): void {
  if (!state.sim) return;
  sound.silence();
  state.sim = null;
  state.delivery = null;
  state.pendingReplay = null;
  state.playback = null;
  state.splits = { bh: null, hh: null, running: false };
  releaseSweep();
  // Nell'end la posizione valida è quella decisa dalle regole; il tiro fermato non conta.
  const start = endMode?.active ? endMode.stones() : state.lastSetup?.stones ?? state.stones;
  resetTo(start);
  $("splits").hidden = true;
  setBusy(false);
  setStatus(tt("status.stopped", { n: state.stones.length }));
  draw();
}

function retryFromSame(): void {
  const last = state.log[state.log.length - 1];
  if (!last || state.sim) return;
  resetTo(last.replay.stonesBefore);
  state.log.pop();
  renderLog();
  setStatus(tt("status.ready", { n: state.stones.length }));
  draw();
}

function resetTo(stones: StonePlacement[]): void {
  state.stones = stones.map((s) => ({ ...s }));
  state.angles.clear();
  state.lastTraces = [];
}

function clearSheet(): void {
  if (state.sim) return;
  state.stones = [];
  state.angles.clear();
  state.lastTraces = [];
  state.log = [];
  renderLog();
  setStatus(tt("status.ready", { n: 0 }));
  draw();
}

// ——— Disegno ———
let houseR: Renderer;
let sheetR: Renderer;
let placement: PlacementTool | null = null;
let feedback: FeedbackPanel | null = null;
let endMode: EndMode | null = null;

// ——— Squadre e posizionamento ———
function nextTeam(): Team {
  return $<HTMLInputElement>("next-1").checked ? 1 : 0;
}
function setNextTeam(team: Team): void {
  $<HTMLInputElement>(team === 1 ? "next-1" : "next-0").checked = true;
}
function placeTeam(): Team {
  return $<HTMLInputElement>("place-1").checked ? 1 : 0;
}

function setTool(tool: "broom" | "place"): void {
  if (placement) placement.enabled = tool === "place";
  houseR.canvas.dataset.tool = tool;
  $("tool-hint").textContent = t(tool === "place" ? "place.hint" : "shot.broomHint");
}

function placementMessage(m: PlacementCheck | "removed" | "added" | "moved"): void {
  const keys: Record<typeof m, Key> = {
    ok: "place.moved",
    added: "place.added",
    moved: "place.moved",
    removed: "place.removed",
    outside: "place.outside",
    overlap: "place.overlap",
    teamFull: "place.teamFull",
  };
  setStatus(tt(keys[m], { n: state.stones.length }));
}

function copyScenario(): void {
  const json = JSON.stringify(makeScenario(state.stones, nextTeam()), null, 1);
  $<HTMLTextAreaElement>("replay-text").value = json;
  void copyReplay();
}

function scene(): Scene {
  let highlight: Scene["highlight"] = null;
  const stones: DrawStone[] = [];
  const traces: Scene["traces"] = [];
  const sim = state.sim;
  if (sim) {
    for (const s of sim.world.stones) {
      if (!s.inPlay) continue;
      const isDelivered = s.id === sim.deliveredId;
      const pos = isDelivered && state.delivery ? deliveryPosition(state.delivery.plan, state.delivery.t) : s;
      stones.push({ id: s.id, team: s.team, x: pos.x, y: pos.y, vx: s.vx, vy: s.vy, angle: state.angles.get(s.id) ?? 0, delivered: isDelivered });
    }
    traces.push(...collectTraces(sim));
  } else {
    traces.push(...state.lastTraces);
    const pv = placement ? placement.preview() : { stones: state.stones, highlight: null };
    highlight = pv.highlight;
    for (const s of pv.stones) stones.push({ id: s.id, team: s.team, x: s.x, y: s.y, angle: state.angles.get(s.id) ?? 0 });
  }
  return {
    stones,
    traces: showTrails() ? traces : [],
    broom: state.broom,
    aimActual: state.execErr && !state.delivery ? { x: state.execErr.aimX, y: state.execErr.aimY } : null,
    predictedStopY: state.params && !sim ? stopForSpeed(state.params, currentSpeed()) : null,
    highlight,
    ...(endMode?.active && !sim ? endMode.sceneExtras() : endMode?.active ? { fgz: endMode.sceneExtras().fgz } : {}),
    sweeping: sim && !sim.done && sim.canSweep() ? currentSweep(sim) : null,
  };
}

const TRAILS_KEY = "curlsim.showTrails";

/** Scia delle pietre sulla casa e sulla pista: si può nascondere dal riquadro Tiro. */
function showTrails(): boolean {
  return $<HTMLInputElement>("show-trails").checked;
}

function bindTrails(): void {
  const box = $<HTMLInputElement>("show-trails");
  try {
    if (localStorage.getItem(TRAILS_KEY) === "0") box.checked = false;
  } catch {
    /* memoria del browser non disponibile: scia visibile */
  }
  box.addEventListener("change", () => {
    try {
      localStorage.setItem(TRAILS_KEY, box.checked ? "1" : "0");
    } catch {
      /* niente */
    }
    draw();
  });
}

function collectTraces(sim: Sim): Scene["traces"] {
  const out: Scene["traces"] = [];
  for (const [id, pts] of sim.trace) {
    const s = sim.world.stones.find((x) => x.id === id);
    if (s) out.push({ team: s.team, points: s.inPlay ? [...pts, { x: s.x, y: s.y }] : pts });
  }
  return out;
}

function draw(): void {
  if (!houseR) return;
  houseR.resize();
  sheetR.resize();
  const sc = scene();
  houseR.draw(sc);
  sheetR.draw(sc);
}

// ——— Registro e replay ———
function renderLog(): void {
  const body = $("log-body");
  body.replaceChildren();
  $("log-empty").hidden = state.log.length > 0;
  $("log-table").hidden = state.log.length === 0;
  for (const e of [...state.log].reverse()) {
    const tr = document.createElement("tr");
    const stop = e.stop ? `${num(e.stop.x, 2)} · ${num(e.stop.y - TEE_Y, 2)}` : "—";
    const cells = [
      String(e.n),
      e.spin === 1 ? "↻" : "↺",
      num(e.speed, 2),
      num(e.bh, 2),
      e.hh === null ? "—" : num(e.hh, 2),
      e.ht === null ? "—" : num(e.ht, 2),
      stop,
      num(e.curl, 2),
      num(e.turns, 1),
      num(e.sweep, 1),
      hasExecutionNoise(e.replay) ? errorText(executionError(e.replay), true) : "—",
      outcomeText(e.outcome),
      e.hash,
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      if (i === 12) td.className = "mono";
      tr.append(td);
    });
    tr.tabIndex = 0;
    tr.title = t("log.rowTitle");
    tr.addEventListener("click", () => showReplay(e.replay));
    body.append(tr);
  }
}

/**
 * Errore del tiratore in parole: linea al mirino e peso. Nei draw il peso è la differenza
 * d'arresto (corto o lungo); nelle bocciate la differenza sull'intertempo scelto.
 */
function errorText(e: ExecutionError, compact = false): string {
  const cm = (m: number) => String(Math.round(Math.abs(m) * 100));
  const line = Math.abs(e.line) < 0.005 ? t("err.onLine") : t(e.line < 0 ? "err.left" : "err.right", { d: cm(e.line) });
  let weight: string;
  if (e.length !== null) {
    weight = Math.abs(e.length) < 0.005 ? t("err.exactWeight") : t(e.length < 0 ? "err.short" : "err.long", { d: cm(e.length) });
  } else {
    const k = splitKind();
    const dt = splitTime(e.speed, k) - splitTime(e.intendedSpeed, k);
    weight = Math.abs(dt) < 0.005 ? t("err.exactWeight") : t(dt > 0 ? "err.slow" : "err.fast", { s: num(Math.abs(dt), 2), kind: t(k === "th" ? "split.th" : "split.bh") });
  }
  if (compact) {
    const l = Math.abs(e.line) < 0.005 ? "0" : `${e.line < 0 ? "←" : "→"}${cm(e.line)}`;
    const w = e.length !== null ? `${e.length < 0 ? "−" : "+"}${cm(e.length)}` : weight;
    return e.length !== null ? `${l} · ${w} cm` : `${l} cm · ${w}`;
  }
  return `${line} · ${weight}`;
}

function showReplay(r: Replay): void {
  $<HTMLTextAreaElement>("replay-text").value = JSON.stringify(r, null, 1);
}

async function copyReplay(): Promise<void> {
  const ta = $<HTMLTextAreaElement>("replay-text");
  try {
    await navigator.clipboard.writeText(ta.value);
    setReplayMsg(tt("replay.copied"));
  } catch {
    ta.focus();
    ta.select();
    setReplayMsg(tt("replay.copyFailed"));
  }
}

function loadReplayText(text: string): void {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    setReplayMsg(tt("replay.invalid"));
    return;
  }
  if (state.sim) return;
  if (isMatchFile(r)) {
    $<HTMLInputElement>("mode-end").checked = true;
    setMode("end", r);
    setReplayMsg("");
    return;
  }
  // Un replay o una posizione si rivedono nel laboratorio: la partita resta salvata e si riprende tornando alla modalità partita.
  if (endMode?.active) {
    $<HTMLInputElement>("mode-lab").checked = true;
    setMode("lab");
  }
  if ((r as { format?: string }).format === "curling-scenario") {
    if (!validateScenario(r)) {
      setReplayMsg(tt("scenario.invalid"));
      return;
    }
    resetTo(r.stones);
    setNextTeam(r.nextTeam);
    setReplayMsg(tt("scenario.loaded", { n: r.stones.length }));
    setStatus(tt("status.ready", { n: state.stones.length }));
    draw();
    return;
  }
  if (!validateReplay(r)) {
    setReplayMsg(tt("replay.invalid"));
    return;
  }
  const msg = r.engineVersion !== ENGINE_VERSION ? t("replay.versionWarn", { v: r.engineVersion }) + " " : "";
  const { hash } = runReplay(r);
  setReplayMsg(msg + t("replay.loaded", { hash }));
  resetTo(r.stonesBefore);
  startSim(structuredClone(r), r);
}

function checkDeterminism(): void {
  const { hash } = runReplay(referenceReplay());
  const ok = hash === REFERENCE_HASH;
  const el = $("det-result");
  el.replaceChildren();
  const pill = document.createElement("span");
  pill.className = `pill ${ok ? "ok" : "bad"}`;
  pill.textContent = t(ok ? "replay.match" : "replay.mismatch");
  const txt = document.createElement("span");
  txt.textContent = " " + t("replay.reference", { expected: REFERENCE_HASH, got: hash });
  el.append(pill, txt);
}

function setReplayMsg(s: Text): void {
  bindText($("replay-msg"), s);
}
function setStatus(s: Text): void {
  bindText($("status"), s);
}
function setBusy(b: boolean): void {
  for (const id of ["throw", "repeat", "retry", "clear", "load-file", "copy-scenario"]) $<HTMLButtonElement>(id).disabled = b;
  // Barra flottante: «Tira» sparisce durante la corsa, «Spazza» compare solo per i tiri dal vivo.
  $("fab-throw").hidden = b;
  $("fab-spin").hidden = b;
  $("fab-weight-row").hidden = b;
  $("fab-rate").hidden = b || !feedback?.hasPending;
  $("sweep-pad").hidden = !b || !!state.playback;
  $("fab-stop").hidden = !b;
  $("stop").hidden = !b;
  if (!b) {
    releaseSweep();
    $("sweep-btn").classList.remove("active");
  }
  renderPad();
  endMode?.render();
}

function setMode(mode: "lab" | "end", file?: MatchFile): void {
  if (state.sim) return;
  if (mode === "end") {
    $<HTMLInputElement>("tool-broom").checked = true;
    setTool("broom");
    state.lastTraces = [];
    endMode!.enter(file);
  } else {
    endMode!.exit();
    setStatus(tt("status.ready", { n: state.stones.length }));
  }
  draw();
}

// ——— Input ———
/** Collega un pulsante di spazzata: attivo solo finché è tenuto premuto. */
function bindSweepButton(btn: HTMLElement): void {
  const on = (ev: PointerEvent) => {
    ev.preventDefault();
    state.sweepButton = true;
    try {
      btn.setPointerCapture(ev.pointerId);
    } catch {
      /* alcuni browser non lo permettono */
    }
  };
  const off = () => {
    state.sweepButton = false;
  };
  btn.addEventListener("pointerdown", on);
  for (const e of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) btn.addEventListener(e, off);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** Smette di spazzare: pad, tasti e pulsante. */
function releaseSweep(): void {
  state.sweepButton = false;
  state.sweepPad = null;
  state.keys = { space: false, left: false, right: false };
  renderPad();
}

/** Rotazione del tiro in corso (o di quello impostato): decide da che parte stanno Curl e Straight. */
function shotSpin(): 1 | -1 {
  return state.pendingReplay?.shot.spin ?? currentSpin();
}

/**
 * Pad di spazzata: la zona centrale è Hard, quelle laterali spingono la pietra verso il loro lato.
 * Il lato verso cui la pietra curva è Curl, l'altro Straight; l'altezza del dito è l'intensità,
 * dal 100% in alto al 30% in basso, a passi del 10%.
 */
function padCommand(ev: PointerEvent): SweepCmd {
  const r = $("sweep-pad").getBoundingClientRect();
  const fx = Math.max(0, Math.min(0.999, (ev.clientX - r.left) / r.width));
  const fy = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
  const zone = Math.floor(fx * 3) - 1;
  const level = Math.round((1 - 0.7 * fy) * 10) / 10;
  state.padDot = { x: fx, y: fy };
  return { push: zone as -1 | 0 | 1, level };
}

function bindSweepPad(): void {
  const pad = $("sweep-pad");
  pad.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    try {
      pad.setPointerCapture(ev.pointerId);
    } catch {
      /* alcuni browser non lo permettono */
    }
    state.sweepPad = padCommand(ev);
    renderPad();
  });
  pad.addEventListener("pointermove", (ev) => {
    if (!state.sweepPad) return;
    state.sweepPad = padCommand(ev);
    renderPad();
  });
  const off = () => {
    state.sweepPad = null;
    state.padDot = null;
    renderPad();
  };
  for (const e of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(e, off);
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** Etichette e stato del pad: zone laterali secondo la rotazione, zona attiva, dito e intensità. */
function renderPad(): void {
  const spin = shotSpin();
  // Rotazione oraria (+1): la pietra curva a destra, quindi Curl è a destra.
  const right: Key = spin === 1 ? "sweep.curl" : "sweep.straight";
  const left: Key = spin === 1 ? "sweep.straight" : "sweep.curl";
  $("zone-right-name").textContent = t(right);
  $("zone-right-sub").textContent = t(right === "sweep.curl" ? "sweep.curlSub" : "sweep.straightSub");
  $("zone-left-name").textContent = t(left);
  $("zone-left-sub").textContent = t(left === "sweep.curl" ? "sweep.curlSub" : "sweep.straightSub");
  const sim = state.sim;
  const cmd = sim && !state.playback ? sweepInput() : null;
  document.querySelectorAll<HTMLElement>("#sweep-pad .zone").forEach((z) => z.classList.toggle("active", !!cmd && Number(z.dataset.zone) === cmd.push));
  const dot = $("pad-dot");
  dot.hidden = !state.padDot;
  if (state.padDot) {
    dot.style.left = `${state.padDot.x * 100}%`;
    dot.style.top = `${state.padDot.y * 100}%`;
  }
  const mode: Key = !cmd ? "sweep.hard" : cmd.push === 0 ? "sweep.hard" : cmd.push === 1 ? right : left;
  $("pad-status").textContent = cmd ? t("sweep.status", { mode: t(mode), p: Math.round(cmd.level * 100) }) : "";
}

function bindSweepInputs(): void {
  bindSweepButton($("sweep-btn"));
  bindSweepPad();
  window.addEventListener("blur", releaseSweep);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseSweep();
  });
  const typing = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "SUMMARY";
  };
  window.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!state.sim && !e.repeat) {
        throwStone();
        return;
      }
      state.keys.space = true;
    } else if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && state.sim) {
      e.preventDefault();
      state.keys[e.code === "ArrowLeft" ? "left" : "right"] = true;
    } else return;
    renderPad();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") state.keys.space = false;
    else if (e.code === "ArrowLeft") state.keys.left = false;
    else if (e.code === "ArrowRight") state.keys.right = false;
    else return;
    renderPad();
  });
}

// ——— Riquadri richiudibili ———
const isNarrow = () => window.matchMedia("(max-width: 720px)").matches;

function bindPanels(): void {
  const panels = document.querySelectorAll<HTMLDetailsElement>("details.panel");
  let saved: Record<string, boolean> = {};
  try {
    saved = JSON.parse(localStorage.getItem("curlsim.panels") ?? "{}");
  } catch {
    saved = {};
  }
  // Su telefono si parte con aperti solo Tiro e Registro.
  const narrowOpen = new Set(["p-end", "p-shot", "p-log", "p-feedback"]);
  panels.forEach((d) => {
    if (d.id in saved) d.open = saved[d.id];
    else if (isNarrow()) d.open = narrowOpen.has(d.id);
    d.addEventListener("toggle", () => {
      saved[d.id] = d.open;
      try {
        localStorage.setItem("curlsim.panels", JSON.stringify(saved));
      } catch {
        /* memoria del browser non disponibile */
      }
    });
  });
}

function bindBroom(): void {
  const c = houseR.canvas;
  const set = (ev: PointerEvent) => {
    if (state.sim || placement?.enabled) return;
    const p = houseR.eventToWorld(ev);
    state.broom = { x: Math.max(-2.2, Math.min(2.2, p.x)), y: Math.max(FAR_HOG_INSIDE + 0.5, Math.min(HACK_Y, p.y)) };
    if (!state.sim) state.execErr = null;
    updateShotReadout();
    draw();
  };
  c.addEventListener("pointerdown", (ev) => {
    if (placement?.enabled) return;
    c.setPointerCapture(ev.pointerId);
    set(ev);
  });
  c.addEventListener("pointermove", (ev) => {
    if (ev.buttons) set(ev);
  });
}

/** Cambio di lingua senza ricaricare: testi statici, letture calcolate, registro e riquadri. */
function relocalize(): void {
  applyTexts();
  if (state.params) updateWeightMarks();
  updateShotReadout();
  updateMixReadout();
  updateSweepReadout();
  renderLog();
  if (state.splits.bh !== null || state.sim) updateSplits();
  endMode?.render();
  endMode?.renderSkills();
  langPicker?.refresh();
  renderSoundButton();
  renderPad();
  draw();
}

let langPicker: { refresh(): void } | null = null;
const sound = new Sound();

const SPEAKER_ON = '<svg viewBox="0 0 24 24" width="26" height="18" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="26" height="18" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/** Pulsante dei suoni nell'intestazione: icona dell'altoparlante, testo per lettori di schermo. */
function renderSoundButton(): void {
  const btn = $("sound-btn");
  btn.innerHTML = sound.enabled ? SPEAKER_ON : SPEAKER_OFF;
  const label = t(sound.enabled ? "sound.on" : "sound.off");
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.setAttribute("aria-pressed", String(sound.enabled));
}

function init(): void {
  setLanguage(initialLanguage());
  applyTexts();
  langPicker = mountLanguagePicker($("lang"));
  renderSoundButton();
  $("sound-btn").addEventListener("click", () => {
    sound.setEnabled(!sound.enabled);
    renderSoundButton();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sound.silence();
  });
  onLanguageChange(relocalize);
  houseR = new Renderer($<HTMLCanvasElement>("house"), HOUSE_VIEW, true);
  sheetR = new Renderer($<HTMLCanvasElement>("sheet"), SHEET_VIEW, false);

  $<HTMLSelectElement>("profile").addEventListener("change", (e) => applyProfile((e.target as HTMLSelectElement).value as ProfileId));
  $("hh").addEventListener("change", recalibrate);
  $("curl").addEventListener("change", recalibrate);
  weightSlider().addEventListener("input", () => {
    updateShotReadout();
    draw();
  });
  $("w-less").addEventListener("click", () => nudgeWeight(0.05));
  $("w-more").addEventListener("click", () => nudgeWeight(-0.05));
  const sk = $<HTMLSelectElement>("split-kind");
  try {
    if (localStorage.getItem(SPLIT_KEY) === "th") sk.value = "th";
  } catch {
    /* memoria del browser non disponibile */
  }
  sk.addEventListener("change", () => {
    try {
      localStorage.setItem(SPLIT_KEY, splitKind());
    } catch {
      /* niente */
    }
    updateShotReadout();
  });
  for (const id of ["spin-cw", "spin-ccw"]) $(id).addEventListener("change", () => {
    updateShotReadout();
    renderPad();
  });
  $("fab-spin").addEventListener("click", () => {
    $<HTMLInputElement>(currentSpin() === 1 ? "spin-ccw" : "spin-cw").checked = true;
    updateShotReadout();
    renderPad();
  });
  $<HTMLInputElement>("fab-weight").addEventListener("input", (e) => {
    weightSlider().value = (e.target as HTMLInputElement).value;
    updateShotReadout();
    draw();
  });
  $<HTMLSelectElement>("spin-level").addEventListener("change", (e) => applySpinLevel((e.target as HTMLSelectElement).value as SpinLevel | "custom"));
  $("spin-turns").addEventListener("input", syncSpinLevel);
  $("throw").addEventListener("click", throwStone);
  $("repeat").addEventListener("click", repeatLast);
  $("retry").addEventListener("click", retryFromSame);
  $("clear").addEventListener("click", clearSheet);
  $<HTMLSelectElement>("shot-level").addEventListener("change", (e) => applyShotLevel((e.target as HTMLSelectElement).value as ShotLevel | "custom"));
  for (const id of ["sk-line", "sk-line-to", "sk-stop"]) $(id).addEventListener("input", syncShotLevel);
  updateMixReadout();
  $<HTMLSelectElement>("sweep-level").addEventListener("change", (e) => applySweepLevel((e.target as HTMLSelectElement).value as SkillLevel | "custom"));
  $("sweep-gain").addEventListener("input", syncSweepLevel);
  $("copy-replay").addEventListener("click", copyReplay);
  $("load-text").addEventListener("click", () => loadReplayText($<HTMLTextAreaElement>("replay-text").value));
  $<HTMLInputElement>("load-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadReplayText(await f.text());
  });
  $("det-check").addEventListener("click", checkDeterminism);
  bindSweepInputs();
  bindPanels();
  bindTrails();
  $("fab-throw").addEventListener("click", throwStone);
  $("stop").addEventListener("click", stopShot);
  $("fab-stop").addEventListener("click", stopShot);
  endMode = new EndMode({
    setStones: (s) => {
      state.stones = s.map((p) => ({ ...p }));
    },
    redraw: draw,
    status: setStatus,
    busy: () => !!state.sim,
    clearTraces: () => {
      state.lastTraces = [];
      state.angles.clear();
    },
  });
  document.body.dataset.mode = "lab";
  $("mode-lab").addEventListener("change", () => setMode("lab"));
  $("mode-end").addEventListener("change", () => setMode("end"));
  feedback = new FeedbackPanel((pending) => {
    $("fab-rate").hidden = !pending || !!state.sim;
  });
  $("fab-rate").addEventListener("click", () => feedback?.reveal());
  bindBroom();
  placement = new PlacementTool(houseR, {
    stones: () => state.stones,
    setStones: (s) => {
      state.stones = s;
      state.lastTraces = [];
    },
    team: placeTeam,
    locked: () => !!state.sim,
    redraw: draw,
    message: placementMessage,
  });
  for (const id of ["tool-broom", "tool-place"]) $(id).addEventListener("change", () => setTool($<HTMLInputElement>("tool-place").checked ? "place" : "broom"));
  $("copy-scenario").addEventListener("click", copyScenario);
  setTool("broom");

  new ResizeObserver(() => draw()).observe($("views"));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  renderLog();
  setStatus(tt("status.ready", { n: 0 }));
  applyProfile("normal");
  weightSlider().value = "2.03";
  checkDeterminism();
}

init();
