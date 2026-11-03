/**
 * Laboratorio 2D – fase 1.
 * Tira, spazza, osserva traiettorie e tempi, salva e riesegui i tiri.
 */
import { calibrate, spinRateForTurns, stopForSpeed, speedToStopAt } from "../core/calibrate";
import { BACK_LINE_OUTSIDE, FAR_HOG_INSIDE, HACK_Y, HOUSE_RADIUS, RELEASE_Y, STONE_RADIUS, TEE_Y } from "../core/geometry";
import { DT, ENGINE_VERSION, PROFILES, SPIN_TURNS, type IceParams, type ProfileId, type SpinLevel } from "../core/params";
import { REFERENCE_HASH, referenceReplay } from "../core/reference";
import { makeReplay, runReplay, Sim, validateReplay, type Replay, type StonePlacement } from "../core/sim";
import { num, t } from "../i18n";
import type { Key } from "../i18n/it";
import { HOUSE_VIEW, Renderer, SHEET_VIEW, type DrawStone, type Scene } from "./render";

const MAX_STONES = 16;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface LogEntry {
  n: number;
  replay: Replay;
  speed: number;
  spin: 1 | -1;
  hh: number | null;
  ht: number | null;
  stop: { x: number; y: number } | null;
  curl: number;
  turns: number;
  sweep: number;
  outcome: string;
  hash: string;
}

const state = {
  params: null as IceParams | null,
  stones: [] as StonePlacement[],
  broom: { x: -0.9, y: TEE_Y },
  sim: null as Sim | null,
  playback: null as Replay | null,
  pendingReplay: null as Replay | null,
  log: [] as LogEntry[],
  sweepKey: false,
  sweepButton: false,
  angles: new Map<number, number>(),
  lastFrame: 0,
  tickDebt: 0,
  lastSetup: null as { stones: StonePlacement[] } | null,
  lastTraces: [] as Scene["traces"],
};

// ——— Interfaccia: testi statici ———
function applyTexts(): void {
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t as Key, { version: ENGINE_VERSION });
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
  $("derived").textContent = t("ice.calibrating");
  // Lascia ridisegnare l'interfaccia prima del calcolo (circa mezzo secondo).
  setTimeout(() => {
    state.params = calibrate(readTargets());
    $("derived").textContent = t("ice.derived", { mu: state.params.mu.toFixed(5), k: state.params.curlK.toFixed(5) });
    updateWeightMarks();
    updateShotReadout();
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

function weightMarks(): { key: Key; v: number }[] {
  const p = state.params!;
  return [
    { key: "weight.guard", v: speedToStopAt(p, TEE_Y - HOUSE_RADIUS - 1.5) },
    { key: "weight.tee", v: speedToStopAt(p, TEE_Y) },
    { key: "weight.back", v: speedToStopAt(p, BACK_LINE_OUTSIDE - STONE_RADIUS) },
    { key: "weight.hack", v: speedToStopAt(p, HACK_Y) },
    { key: "weight.takeout", v: 3.0 },
    { key: "weight.peel", v: 3.8 },
  ];
}

function updateWeightMarks(): void {
  const box = $("weight-marks");
  box.replaceChildren();
  for (const m of weightMarks()) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mark";
    b.innerHTML = `<span>${t(m.key)}</span><b>${num(m.v, 2)}</b>`;
    b.addEventListener("click", () => {
      weightSlider().value = m.v.toFixed(2);
      updateShotReadout();
      draw();
    });
    box.append(b);
  }
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

function updateShotReadout(): void {
  if (!state.params) return;
  const w = currentSpinRate();
  $("spin-rate").textContent = t("shot.spinRate", { w: num(w, 2), rps: num(w / (2 * Math.PI), 2) });
  const v = currentSpeed();
  $("weight-value").textContent = t("shot.weightValue", { v: num(v, 2) });
  $("weight-stop").textContent = t("shot.weightStop", { where: describeStop(stopForSpeed(state.params, v)) });
  const bx = state.broom.x;
  $("broom-value").textContent = t("shot.broomValue", {
    x: `${num(Math.abs(bx) * 100, 0)} cm ${bx < -0.005 ? "a sinistra" : bx > 0.005 ? "a destra" : ""}`.trim(),
  });
}

// ——— Tiro ———
function skill() {
  return {
    lineSigma: Number($<HTMLInputElement>("sk-line").value) / 100,
    weightSigma: Number($<HTMLInputElement>("sk-weight").value) / 100,
  };
}

function throwStone(): void {
  if (state.sim || !state.params) return;
  if (state.stones.length >= MAX_STONES) {
    setStatus(t("status.full"));
    return;
  }
  const n = state.log.length + 1;
  const seed = Number($<HTMLInputElement>("seed").value) + n;
  const team = (state.log.length % 2) as 0 | 1;
  const replay = makeReplay(
    state.params,
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
  state.tickDebt = 0;
  state.lastFrame = performance.now();
  setStatus(playback ? t("status.replaying", { n: state.log.length }) : t("status.moving"));
  setBusy(true);
  requestAnimationFrame(frame);
}

function sweepInput(): boolean {
  return state.sweepKey || state.sweepButton;
}

function frame(now: number): void {
  const sim = state.sim;
  if (!sim) return;
  const speed = Number($<HTMLSelectElement>("play-speed").value);
  const elapsed = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.tickDebt += (elapsed * speed) / DT;
  const ticks = Math.floor(state.tickDebt);
  state.tickDebt -= ticks;
  const schedule = state.playback?.sweep;
  for (let i = 0; i < ticks && !sim.done; i++) {
    let on: boolean;
    if (schedule) {
      const tk = sim.world.tick;
      on = schedule.some(([a, b]) => tk >= a && tk < b);
    } else on = sweepInput();
    sim.step(on);
    for (const s of sim.world.stones) {
      if (s.moving) state.angles.set(s.id, (state.angles.get(s.id) ?? 0) + s.w * DT);
    }
  }
  $("sweep-btn").classList.toggle("active", !!(sim && !sim.done && sim.canSweep() && (schedule ? false : sweepInput())));
  draw();
  if (sim.done) finishShot();
  else requestAnimationFrame(frame);
}

function finishShot(): void {
  const sim = state.sim!;
  const replay = state.pendingReplay!;
  replay.sweep = state.playback ? state.playback.sweep.map((x) => [...x] as [number, number]) : sim.sweep.map((x) => [...x] as [number, number]);
  const hash = runReplay(replay).hash;
  replay.result = { hash, ticks: sim.metrics.ticks };
  state.stones = sim.placements();
  state.lastTraces = collectTraces(sim);
  state.sim = null;
  setBusy(false);

  if (state.playback) {
    const expected = state.playback.result?.hash;
    setStatus(expected === hash || !expected ? t("status.same", { hash }) : t("status.different", { a: hash, b: expected }));
    state.playback = null;
    draw();
    return;
  }

  const m = sim.metrics;
  const removedDelivered = m.removals.find((r) => r.id === sim.deliveredId);
  const others = m.removals.filter((r) => r.id !== sim.deliveredId).length;
  let outcome = removedDelivered ? t(`outcome.${removedDelivered.reason}` as Key) : t("outcome.inPlay");
  if (others) outcome += ` · ${t("outcome.hit", { n: others })}`;

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
  renderLog();
  showReplay(replay);
  setStatus(t("status.done", { n: entry.n }));
  draw();
}

function repeatLast(): void {
  const last = state.log[state.log.length - 1];
  if (!last || state.sim) return;
  resetTo(last.replay.stonesBefore);
  startSim(structuredClone(last.replay), last.replay);
}

function retryFromSame(): void {
  const last = state.log[state.log.length - 1];
  if (!last || state.sim) return;
  resetTo(last.replay.stonesBefore);
  state.log.pop();
  renderLog();
  setStatus(t("status.ready", { n: state.stones.length }));
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
  setStatus(t("status.ready", { n: 0 }));
  draw();
}

// ——— Disegno ———
let houseR: Renderer;
let sheetR: Renderer;

function scene(): Scene {
  const stones: DrawStone[] = [];
  const traces: Scene["traces"] = [];
  const sim = state.sim;
  if (sim) {
    for (const s of sim.world.stones) {
      if (s.inPlay) stones.push({ id: s.id, team: s.team, x: s.x, y: s.y, angle: state.angles.get(s.id) ?? 0, delivered: s.id === sim.deliveredId });
    }
    traces.push(...collectTraces(sim));
  } else {
    traces.push(...state.lastTraces);
    for (const s of state.stones) stones.push({ id: s.id, team: s.team, x: s.x, y: s.y, angle: state.angles.get(s.id) ?? 0 });
  }
  return {
    stones,
    traces,
    broom: state.broom,
    predictedStopY: state.params && !sim ? stopForSpeed(state.params, currentSpeed()) : null,
    sweeping: !!sim && !sim.done && sim.canSweep() && (state.playback ? false : sweepInput()),
  };
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
      e.hh === null ? "—" : num(e.hh, 2),
      e.ht === null ? "—" : num(e.ht, 2),
      stop,
      num(e.curl, 2),
      num(e.turns, 1),
      num(e.sweep, 1),
      e.outcome,
      e.hash,
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c;
      if (i === 10) td.className = "mono";
      tr.append(td);
    });
    tr.tabIndex = 0;
    tr.title = "Mostra il replay di questo tiro";
    tr.addEventListener("click", () => showReplay(e.replay));
    body.append(tr);
  }
}

function showReplay(r: Replay): void {
  $<HTMLTextAreaElement>("replay-text").value = JSON.stringify(r, null, 1);
}

async function copyReplay(): Promise<void> {
  const ta = $<HTMLTextAreaElement>("replay-text");
  try {
    await navigator.clipboard.writeText(ta.value);
    setReplayMsg(t("replay.copied"));
  } catch {
    ta.focus();
    ta.select();
    setReplayMsg(t("replay.copyFailed"));
  }
}

function loadReplayText(text: string): void {
  let r: unknown;
  try {
    r = JSON.parse(text);
  } catch {
    setReplayMsg(t("replay.invalid"));
    return;
  }
  if (!validateReplay(r)) {
    setReplayMsg(t("replay.invalid"));
    return;
  }
  if (state.sim) return;
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

function setReplayMsg(s: string): void {
  $("replay-msg").textContent = s;
}
function setStatus(s: string): void {
  $("status").textContent = s;
}
function setBusy(b: boolean): void {
  for (const id of ["throw", "repeat", "retry", "clear", "load-file"]) $<HTMLButtonElement>(id).disabled = b;
}

// ——— Input ———
function bindSweepButton(): void {
  const btn = $("sweep-btn");
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
  window.addEventListener("blur", () => {
    state.sweepButton = false;
    state.sweepKey = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.sweepButton = false;
      state.sweepKey = false;
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    e.preventDefault();
    if (!state.sim && !e.repeat) {
      throwStone();
      return;
    }
    state.sweepKey = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") state.sweepKey = false;
  });
}

function bindBroom(): void {
  const c = houseR.canvas;
  const set = (ev: PointerEvent) => {
    if (state.sim) return;
    const p = houseR.eventToWorld(ev);
    state.broom = { x: Math.max(-2.2, Math.min(2.2, p.x)), y: Math.max(FAR_HOG_INSIDE + 0.5, Math.min(HACK_Y, p.y)) };
    updateShotReadout();
    draw();
  };
  c.addEventListener("pointerdown", (ev) => {
    c.setPointerCapture(ev.pointerId);
    set(ev);
  });
  c.addEventListener("pointermove", (ev) => {
    if (ev.buttons) set(ev);
  });
}

function init(): void {
  applyTexts();
  houseR = new Renderer($<HTMLCanvasElement>("house"), HOUSE_VIEW, true);
  sheetR = new Renderer($<HTMLCanvasElement>("sheet"), SHEET_VIEW, false);

  $<HTMLSelectElement>("profile").addEventListener("change", (e) => applyProfile((e.target as HTMLSelectElement).value as ProfileId));
  $("hh").addEventListener("change", recalibrate);
  $("curl").addEventListener("change", recalibrate);
  weightSlider().addEventListener("input", () => {
    updateShotReadout();
    draw();
  });
  for (const id of ["spin-cw", "spin-ccw"]) $(id).addEventListener("change", updateShotReadout);
  $<HTMLSelectElement>("spin-level").addEventListener("change", (e) => applySpinLevel((e.target as HTMLSelectElement).value as SpinLevel | "custom"));
  $("spin-turns").addEventListener("input", syncSpinLevel);
  $("throw").addEventListener("click", throwStone);
  $("repeat").addEventListener("click", repeatLast);
  $("retry").addEventListener("click", retryFromSame);
  $("clear").addEventListener("click", clearSheet);
  $("perfect").addEventListener("click", () => {
    $<HTMLInputElement>("sk-line").value = "0";
    $<HTMLInputElement>("sk-weight").value = "0";
  });
  $("copy-replay").addEventListener("click", copyReplay);
  $("load-text").addEventListener("click", () => loadReplayText($<HTMLTextAreaElement>("replay-text").value));
  $<HTMLInputElement>("load-file").addEventListener("change", async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) loadReplayText(await f.text());
  });
  $("det-check").addEventListener("click", checkDeterminism);
  bindSweepButton();
  bindBroom();

  new ResizeObserver(() => draw()).observe($("views"));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  renderLog();
  setStatus(t("status.ready", { n: 0 }));
  applyProfile("normal");
  weightSlider().value = "2.03";
  checkDeterminism();
}

init();
