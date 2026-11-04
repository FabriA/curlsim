/**
 * Tiro, simulazione passo-passo, replay e hash dello stato finale.
 * La stessa classe Sim serve al gioco interattivo (input di spazzata a ogni tick)
 * e alla riesecuzione dei replay senza interfaccia.
 */
import { DT, ENGINE_VERSION, MAX_TICKS, type IceParams } from "./params";
import { FAR_HOG_OUTSIDE, HACK_POINT, RELEASE_Y, STONE_RADIUS, TEE_Y } from "./geometry";
import { createStone, isAtRest, stepWorld, type Team, type World } from "./physics";
import { applyBoundaryRules, applyHogRule, type Removal } from "./rules";
import { createRng, gaussian } from "./rng";

export interface StonePlacement {
  id: number;
  team: Team;
  x: number;
  y: number;
}

/** Intenzione del tiratore: dove punta la scopa, con che peso e che rotazione. */
export interface ShotInput {
  broomX: number;
  broomY: number;
  /** Velocità al rilascio sulla hog line di consegna (m/s). */
  speed: number;
  /** +1 orario, −1 antiorario (visto dall'alto). */
  spin: 1 | -1;
  /** Modulo della rotazione al rilascio (rad/s). */
  spinRate: number;
  /** Giri previsti su un draw al tee (informativo, per il registro). */
  spinTurns?: number;
}

export interface Skill {
  /** Deviazione standard dell'errore di linea, misurata alla scopa (m). */
  lineSigma: number;
  /** Deviazione standard dell'errore di peso (frazione della velocità). */
  weightSigma: number;
}

/** Stato effettivo al rilascio, dopo l'errore del tiratore. */
export interface Release {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
}

export interface Replay {
  format: "curling-replay";
  version: 1;
  engineVersion: string;
  params: IceParams;
  team: Team;
  stonesBefore: StonePlacement[];
  shot: ShotInput;
  skill: Skill;
  seed: number;
  release: Release;
  /** Intervalli [inizio, fine) in tick in cui il comando di spazzata era attivo. */
  sweep: [number, number][];
  result?: { hash: string; ticks: number };
}

export interface ShotMetrics {
  /** Tempo dal rilascio all'attraversamento della hog line di gioco (s). */
  hogToHog: number | null;
  /** Tempo dal rilascio all'attraversamento della tee line di gioco (s). */
  hogToTee: number | null;
  /** Posizione d'arresto della pietra tirata, o null se rimossa. */
  stop: { x: number; y: number } | null;
  /** Spostamento laterale massimo rispetto al punto di rilascio (m). */
  maxLateral: number;
  /** Giri compiuti dalla pietra tirata. */
  rotations: number;
  /** Tempo di spazzata effettiva (s). */
  sweepTime: number;
  removals: Removal[];
  ticks: number;
  /** Primo urto della pietra tirata, o null se non ha colpito nulla. Solo misura: non cambia il tiro. */
  impact: ImpactMetrics | null;
}

export interface ImpactMetrics {
  /** Pietra colpita per prima. */
  targetId: number;
  /** Pienezza del colpo: 1 = pieno, 0,5 = mezza pietra, vicino a 0 = sottile. */
  fullness: number;
  /** Velocità della pietra tirata subito prima dell'urto (m/s). */
  speed: number;
  /** Strada percorsa dopo l'urto dalla pietra tirata e da quella colpita (m), finché restano in gioco. */
  shooterTravel: number;
  targetTravel: number;
  shooterOut: boolean;
  targetOut: boolean;
}

export function computeRelease(shot: ShotInput, skill: Skill, seed: number): Release {
  const rng = createRng(seed);
  const lineErr = gaussian(rng) * skill.lineSigma;
  const weightErr = gaussian(rng) * skill.weightSigma;
  // Linea di tiro: dalla staffa alla scopa (spostata dall'errore di linea).
  const tx = shot.broomX + lineErr;
  const ty = shot.broomY;
  const dx = tx - HACK_POINT.x;
  const dy = ty - HACK_POINT.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / d;
  const uy = dy / d;
  // Punto della linea in cui la pietra raggiunge la hog line di consegna.
  const s = (RELEASE_Y - HACK_POINT.y) / uy;
  const v = shot.speed * (1 + weightErr);
  return { x: HACK_POINT.x + ux * s, y: RELEASE_Y, vx: ux * v, vy: uy * v, w: shot.spin * shot.spinRate };
}

export class Sim {
  readonly world: World;
  readonly deliveredId: number;
  readonly sweep: [number, number][] = [];
  readonly metrics: ShotMetrics;
  /** Traccia della pietra tirata e delle altre in movimento, ogni 20 ms. */
  readonly trace = new Map<number, { x: number; y: number }[]>();
  done = false;
  private sweepOn = false;
  private impactLast: { shooter: { x: number; y: number }; target: { x: number; y: number } } | null = null;
  private rotAccum = 0;

  constructor(params: IceParams, stonesBefore: StonePlacement[], team: Team, release: Release) {
    const stones = stonesBefore.map((s) => createStone(s.id, s.team, s.x, s.y));
    const id = stones.reduce((m, s) => Math.max(m, s.id), -1) + 1;
    const d = createStone(id, team, release.x, release.y);
    d.vx = release.vx;
    d.vy = release.vy;
    d.w = release.w;
    d.moving = true;
    stones.push(d);
    this.world = { params, stones, tick: 0 };
    this.deliveredId = id;
    this.metrics = {
      hogToHog: null,
      hogToTee: null,
      stop: null,
      maxLateral: 0,
      rotations: 0,
      sweepTime: 0,
      removals: [],
      ticks: 0,
      impact: null,
    };
    this.trace.set(id, [{ x: d.x, y: d.y }]);
  }

  get delivered() {
    return this.world.stones.find((s) => s.id === this.deliveredId)!;
  }

  /** La pietra tirata può essere spazzata? Semplificazione v1: solo davanti alla tee line. */
  canSweep(): boolean {
    const d = this.delivered;
    return d.inPlay && d.moving && d.y < TEE_Y;
  }

  /** Avanza di un tick con lo stato del comando di spazzata. */
  step(sweepInput: boolean): void {
    if (this.done) return;
    const w = this.world;
    if (sweepInput !== this.sweepOn) {
      if (sweepInput) this.sweep.push([w.tick, MAX_TICKS]);
      else this.sweep[this.sweep.length - 1][1] = w.tick;
      this.sweepOn = sweepInput;
    }
    const swept = sweepInput && this.canSweep();
    if (swept) this.metrics.sweepTime += DT;

    const d = this.delivered;
    const yBefore = d.y;
    const wasHit = d.hitStone;
    const pre = wasHit ? null : { x: d.x, y: d.y, vx: d.vx, vy: d.vy, others: w.stones.map((s) => ({ id: s.id, x: s.x, y: s.y, hit: s.hitStone })) };
    stepWorld(w, swept ? this.deliveredId : null);
    if (pre && d.hitStone) this.recordImpact(pre);
    else if (this.metrics.impact) this.trackImpact();
    this.metrics.removals.push(...applyBoundaryRules(w));

    if (d.inPlay) {
      const t = w.tick * DT;
      if (this.metrics.hogToHog === null && yBefore < FAR_HOG_OUTSIDE && d.y >= FAR_HOG_OUTSIDE) this.metrics.hogToHog = t;
      if (this.metrics.hogToTee === null && yBefore < TEE_Y && d.y >= TEE_Y) this.metrics.hogToTee = t;
      const lat = Math.abs(d.x);
      if (lat > this.metrics.maxLateral) this.metrics.maxLateral = lat;
      this.rotAccum += Math.abs(d.w) * DT;
    }

    if (w.tick % 20 === 0) {
      for (const s of w.stones) {
        if (!s.inPlay || !s.moving) continue;
        let tr = this.trace.get(s.id);
        if (!tr) this.trace.set(s.id, (tr = []));
        tr.push({ x: s.x, y: s.y });
      }
    }

    if (isAtRest(w) || w.tick >= MAX_TICKS) this.finish();
  }

  /** Primo urto della pietra tirata: pienezza del colpo misurata con le posizioni prima del tick. */
  private recordImpact(pre: { x: number; y: number; vx: number; vy: number; others: { id: number; x: number; y: number; hit: boolean }[] }): void {
    const v = Math.sqrt(pre.vx * pre.vx + pre.vy * pre.vy);
    if (v === 0) return;
    const ux = pre.vx / v;
    const uy = pre.vy / v;
    let best: { id: number; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const o of pre.others) {
      if (o.id === this.deliveredId) continue;
      const now = this.world.stones.find((s) => s.id === o.id)!;
      if (o.hit || !now.hitStone) continue; // solo le pietre toccate in questo tick
      const dd = (o.x - pre.x) ** 2 + (o.y - pre.y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = o;
      }
    }
    if (!best) return;
    // Distanza tra la traiettoria della tirata e il centro della colpita.
    const offset = Math.abs(ux * (best.y - pre.y) - uy * (best.x - pre.x));
    const fullness = Math.max(0, Math.min(1, 1 - offset / (2 * STONE_RADIUS)));
    const target = this.world.stones.find((s) => s.id === best!.id)!;
    const d = this.delivered;
    this.metrics.impact = { targetId: best.id, fullness, speed: v, shooterTravel: 0, targetTravel: 0, shooterOut: false, targetOut: false };
    this.impactLast = { shooter: { x: d.x, y: d.y }, target: { x: target.x, y: target.y } };
  }

  private trackImpact(): void {
    const imp = this.metrics.impact!;
    const last = this.impactLast!;
    const d = this.delivered;
    const tg = this.world.stones.find((s) => s.id === imp.targetId)!;
    if (d.inPlay) {
      imp.shooterTravel += Math.hypot(d.x - last.shooter.x, d.y - last.shooter.y);
      last.shooter = { x: d.x, y: d.y };
    }
    if (tg.inPlay) {
      imp.targetTravel += Math.hypot(tg.x - last.target.x, tg.y - last.target.y);
      last.target = { x: tg.x, y: tg.y };
    }
  }

  private finish(): void {
    const w = this.world;
    if (this.sweepOn) this.sweep[this.sweep.length - 1][1] = w.tick;
    this.sweepOn = false;
    this.metrics.removals.push(...applyHogRule(w, this.deliveredId));
    const d = this.delivered;
    this.metrics.stop = d.inPlay ? { x: d.x, y: d.y } : null;
    this.metrics.rotations = this.rotAccum / (2 * Math.PI);
    this.metrics.ticks = w.tick;
    const imp = this.metrics.impact;
    if (imp) {
      imp.shooterOut = !this.delivered.inPlay;
      imp.targetOut = !this.world.stones.find((s) => s.id === imp.targetId)!.inPlay;
    }
    this.done = true;
  }

  /** Avanza fino a fine tiro seguendo un programma di spazzata registrato. */
  runToEnd(schedule: [number, number][] = []): void {
    while (!this.done) {
      const t = this.world.tick;
      let on = false;
      for (const [a, b] of schedule) if (t >= a && t < b) on = true;
      this.step(on);
    }
  }

  /** Pietre in gioco a fine tiro, pronte per il tiro successivo. */
  placements(): StonePlacement[] {
    return this.world.stones.filter((s) => s.inPlay).map((s) => ({ id: s.id, team: s.team, x: s.x, y: s.y }));
  }
}

export function makeReplay(
  params: IceParams,
  team: Team,
  stonesBefore: StonePlacement[],
  shot: ShotInput,
  skill: Skill,
  seed: number,
): Replay {
  return {
    format: "curling-replay",
    version: 1,
    engineVersion: ENGINE_VERSION,
    params: { ...params },
    team,
    stonesBefore: stonesBefore.map((s) => ({ ...s })),
    shot: { ...shot },
    skill: { ...skill },
    seed,
    release: computeRelease(shot, skill, seed),
    sweep: [],
  };
}

/** Riesegue un replay senza interfaccia e restituisce simulazione e hash finale. */
export function runReplay(r: Replay): { sim: Sim; hash: string } {
  const sim = new Sim(r.params, r.stonesBefore, r.team, r.release);
  sim.runToEnd(r.sweep);
  return { sim, hash: hashWorld(sim.world) };
}

/** Hash FNV-1a a 32 bit sui byte esatti di posizione e stato di ogni pietra. */
export function hashWorld(world: World): string {
  const stones = [...world.stones].sort((a, b) => a.id - b.id);
  const buf = new Float64Array(stones.length * 4 + 1);
  let i = 0;
  buf[i++] = world.tick;
  for (const s of stones) {
    buf[i++] = s.id;
    buf[i++] = s.inPlay ? s.x : 0;
    buf[i++] = s.inPlay ? s.y : 0;
    buf[i++] = s.inPlay ? 1 : 0;
  }
  const bytes = new Uint8Array(buf.buffer);
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) {
    h ^= bytes[k];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function validateReplay(x: unknown): x is Replay {
  const r = x as Replay;
  return (
    !!r &&
    r.format === "curling-replay" &&
    r.version === 1 &&
    typeof r.engineVersion === "string" &&
    !!r.params &&
    Array.isArray(r.stonesBefore) &&
    !!r.release &&
    Array.isArray(r.sweep)
  );
}
