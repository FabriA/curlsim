/**
 * Motore fisico: moto delle pietre e urti.
 *
 * Usa solo + − × ÷ e Math.sqrt (correttamente arrotondata in IEEE 754),
 * così lo stesso input produce lo stesso risultato in ogni ambiente.
 * Le decisioni regolamentari (pietre fuori gioco) stanno in rules.ts.
 */
import { DT, G, type IceParams } from "./params";
import { STONE_RADIUS } from "./geometry";

export type Team = 0 | 1;

export interface Stone {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Velocità angolare (rad/s), positiva in senso orario visto dall'alto. */
  w: number;
  moving: boolean;
  inPlay: boolean;
  /** La pietra ha toccato un'altra pietra durante il tiro (R2 f). */
  hitStone: boolean;
}

export interface World {
  params: IceParams;
  stones: Stone[];
  tick: number;
  /** Pietra tirata: gli urti tra altre pietre usano `restitutionSecondary`. */
  deliveredId?: number;
}

const STOP_SPEED = 1e-4;
/** Rapporto massimo rotazione/velocità (rispetto al draw normale) che aumenta la curva: i draw arrivano a circa 1,9. */
const SPIN_RATIO_MAX = 2.5;

export function createStone(id: number, team: Team, x: number, y: number): Stone {
  return { id, team, x, y, vx: 0, vy: 0, w: 0, moving: false, inPlay: true, hitStone: false };
}

/**
 * Comando di spazzata di un tick (dal motore 0.4.0). `push` = 0: Hard, due sweeper davanti alla
 * pietra; −1 o +1: un solo sweeper su un lato, la pietra è spinta verso sinistra (−1) o destra (+1)
 * rispetto alla direzione di moto. `level` = intensità, da 0 a 1.
 */
export interface SweepCmd {
  push: -1 | 0 | 1;
  level: number;
}

/** La spazzata Hard a piena intensità: è la spazzata dei motori precedenti. */
export const SWEEP_HARD: SweepCmd = { push: 0, level: 1 };

/** Avanza di un tick una singola pietra in movimento. */
function advanceStone(s: Stone, p: IceParams, sweep: SweepCmd | null): void {
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  // Riduzione dell'attrito: piena con Hard al 100% (come prima), in proporzione all'intensità,
  // e solo per la quota di un singolo sweeper quando si spazza da un lato.
  let fr = 1;
  if (sweep) {
    const share = sweep.push === 0 ? 1 : p.sweepSideShare ?? 0.6;
    fr = sweep.level === 1 && share === 1 ? p.sweepFriction : 1 - (1 - p.sweepFriction) * sweep.level * share;
  }
  const aLong = p.mu * G * fr;
  const dv = aLong * DT;
  if (v <= dv || v < STOP_SPEED) {
    s.vx = 0;
    s.vy = 0;
    s.w = 0;
    s.moving = false;
    return;
  }
  const ux = s.vx / v;
  const uy = s.vy / v;

  // Deriva laterale verso destra per rotazione oraria, più forte a bassa velocità.
  let spinFactor = s.w / (p.spinRatioRef * v);
  // Effetto della spazzata sulla curva naturale: Hard la riduce (come prima); da un lato la riduce solo
  // se spinge contro la curva (Straight), mentre spingendo verso la curva (Curl) la lascia com'è.
  let sc = 1;
  if (sweep) {
    if (sweep.push === 0) sc = sweep.level === 1 ? p.sweepCurl : 1 - (1 - p.sweepCurl) * sweep.level;
    else if (sweep.push * s.w < 0) sc = 1 - (1 - p.sweepCurl) * sweep.level;
  }
  if (spinFactor > 1) spinFactor = 1;
  else if (spinFactor < -1) spinFactor = -1;
  const vv = v + p.curlV0;
  let aLat: number;
  if (p.spinCurve && p.curlNorm) {
    // Dalla 0.4: forma e quantità dipendono dai giri (rapporto ω/v rispetto alla rotazione normale).
    const c = p.spinCurve;
    const turns = ((s.w < 0 ? -s.w : s.w) / v / (p.spinRef ?? 1)) * c.refTurns;
    const T = c.turns;
    const last = T.length - 1;
    let n = c.exp[last];
    let gain = c.gain[last];
    if (turns <= T[0]) {
      n = c.exp[0];
      gain = c.gain[0];
    } else if (turns < T[last]) {
      let i = 0;
      while (turns > T[i + 1]) i++;
      const f = (turns - T[i]) / (T[i + 1] - T[i]);
      n = c.exp[i] + (c.exp[i + 1] - c.exp[i]) * f;
      gain = c.gain[i] + (c.gain[i + 1] - c.gain[i]) * f;
    }
    // 1/v^n tra le forme con esponente multiplo di 0,5, ciascuna normalizzata alla stessa curva totale.
    const q = Math.sqrt(vv);
    const m = (n - 0.5) * 2;
    const i0 = m >= 2 ? 2 : m >= 1 ? 1 : 0;
    const f = m - i0;
    const basis = (k: number) => p.curlNorm![k] / (k === 0 ? q : k === 1 ? vv : k === 2 ? vv * q : vv * vv);
    const shape = f > 0 ? basis(i0) * (1 - f) + basis(i0 + 1) * f : basis(i0);
    aLat = spinFactor * p.curlK * gain * sc * shape;
  } else {
  // Curva «finale più netto»: più rotazione per metro, più curva (il «grab» con molti giri).
  if (p.spinGain) {
    // Limitato: dopo un urto una pietra quasi ferma può girare molto (rapporto giri/metro enorme),
    // e senza limite la deriva supererebbe l'attrito e la pietra non si fermerebbe più.
    let ratio = (s.w < 0 ? -s.w : s.w) / v / (p.spinRef ?? 1);
    if (ratio > SPIN_RATIO_MAX) ratio = SPIN_RATIO_MAX;
    let k = 1 + p.spinGain * (ratio - 1);
    if (k < 0.5) k = 0.5;
    spinFactor = spinFactor * k;
  }
  // La deriva cresce quando la pietra rallenta: come 1/√v (classica), 1/v o 1/v^1,5 (finale più netto).
  const slow = p.curlExp === 1 ? vv : p.curlExp === 1.5 ? vv * Math.sqrt(vv) : Math.sqrt(vv);
  aLat = (spinFactor * p.curlK * sc) / slow;
  }
  // La deriva nasce dall'attrito e non può superarlo: con la curva «netta» a velocità quasi nulla
  // la spinta laterale ricostruirebbe a ogni tick la velocità persa e la pietra non si fermerebbe
  // mai. Con 0,9 la velocità di equilibrio resta sotto la soglia di arresto. Con la curva classica
  // la deriva resta sempre molto sotto l'attrito: nessun effetto.
  // Spazzata da un lato: l'asimmetria d'attrito tra i due lati spinge la pietra (Sonobe et al. 2024),
  // in proporzione alla riduzione d'attrito ottenuta.
  if (sweep && sweep.push !== 0 && p.sweepDir) aLat += sweep.push * p.sweepDir * p.mu * G * (1 - fr);
  const aLatMax = 0.9 * aLong;
  if (aLat > aLatMax) aLat = aLatMax;
  else if (aLat < -aLatMax) aLat = -aLatMax;

  // Accelerazione = −aLong·u + aLat·(perpendicolare destra di u), con perp destra = (uy, −ux).
  s.vx += (-aLong * ux + aLat * uy) * DT;
  s.vy += (-aLong * uy - aLat * ux) * DT;

  // La rotazione si riduce in proporzione alla velocità.
  const vNew = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  s.w = s.w * (vNew / v);

  s.x += s.vx * DT;
  s.y += s.vy * DT;
}

/**
 * Risolve gli urti tra pietre con impulso normale (restituzione) e tangenziale
 * (attrito di Coulomb tra le pietre, con scambio di rotazione).
 * Le coppie sono esaminate in ordine di indice; più passate gestiscono le catene.
 */
function resolveCollisions(world: World): void {
  const p = world.params;
  const r = STONE_RADIUS;
  const minDist = 2 * r;
  const minDist2 = minDist * minDist;
  const stones = world.stones;
  const k = p.inertiaK;
  const eSecondary = p.restitutionSecondary ?? p.restitution;

  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (let i = 0; i < stones.length; i++) {
      const a = stones[i];
      if (!a.inPlay) continue;
      for (let j = i + 1; j < stones.length; j++) {
        const b = stones[j];
        if (!b.inPlay) continue;
        if (!a.moving && !b.moving) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;

        // Separazione geometrica a metà.
        const overlap = minDist - d;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn <= 0) continue; // si stanno già allontanando
        any = true;

        // Impulso normale per masse uguali (m = 1).
        let e = a.id === world.deliveredId || b.id === world.deliveredId ? p.restitution : eSecondary;
        // Dalla 0.4, se richiesto: urti lenti meno elastici.
        const si = p.slowImpact;
        if (si) {
          const rx = a.vx - b.vx;
          const ry = a.vy - b.vy;
          const sp = Math.sqrt(rx * rx + ry * ry);
          if (sp <= si.from) e = si.e;
          else if (sp < si.to) e = si.e + ((e - si.e) * (sp - si.from)) / (si.to - si.from);
        }
        const jn = ((1 + e) * vn) / 2;
        a.vx -= jn * nx;
        a.vy -= jn * ny;
        b.vx += jn * nx;
        b.vy += jn * ny;

        // Velocità relativa tangenziale al punto di contatto.
        // wz = −w (antiorario positivo). Contatto: a in +r·n, b in −r·n.
        const tx = -ny;
        const ty = nx;
        const wzA = -a.w;
        const wzB = -b.w;
        const vtA = a.vx * tx + a.vy * ty + wzA * r; // (wz × r·n)·t = wz·r
        const vtB = b.vx * tx + b.vy * ty - wzB * r;
        const vt = vtA - vtB;
        let jt = vt / (2 + 2 / k);
        const jtMax = p.stoneFriction * jn;
        if (jt > jtMax) jt = jtMax;
        else if (jt < -jtMax) jt = -jtMax;
        a.vx -= jt * tx;
        a.vy -= jt * ty;
        b.vx += jt * tx;
        b.vy += jt * ty;
        const dwz = -jt / (k * r);
        a.w = -(wzA + dwz);
        b.w = -(wzB + dwz);

        a.moving = true;
        b.moving = true;
        a.hitStone = true;
        b.hitStone = true;
      }
    }
    if (!any) break;
  }
}

/** Avanza il mondo di un tick. `sweptId` è la pietra spazzata in questo tick, o null. */
export function stepWorld(world: World, sweptId: number | null, sweep: SweepCmd = SWEEP_HARD): void {
  for (const s of world.stones) {
    if (s.inPlay && s.moving) advanceStone(s, world.params, s.id === sweptId ? sweep : null);
  }
  resolveCollisions(world);
  world.tick++;
}

export function isAtRest(world: World): boolean {
  for (const s of world.stones) if (s.inPlay && s.moving) return false;
  return true;
}
