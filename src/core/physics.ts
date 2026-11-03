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
}

const STOP_SPEED = 1e-4;

export function createStone(id: number, team: Team, x: number, y: number): Stone {
  return { id, team, x, y, vx: 0, vy: 0, w: 0, moving: false, inPlay: true, hitStone: false };
}

/** Avanza di un tick una singola pietra in movimento. */
function advanceStone(s: Stone, p: IceParams, swept: boolean): void {
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  const aLong = p.mu * G * (swept ? p.sweepFriction : 1);
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
  if (spinFactor > 1) spinFactor = 1;
  else if (spinFactor < -1) spinFactor = -1;
  const aLat = (spinFactor * p.curlK * (swept ? p.sweepCurl : 1)) / Math.sqrt(v + p.curlV0);

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
        const jn = ((1 + p.restitution) * vn) / 2;
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
export function stepWorld(world: World, sweptId: number | null): void {
  for (const s of world.stones) {
    if (s.inPlay && s.moving) advanceStone(s, world.params, s.id === sweptId);
  }
  resolveCollisions(world);
  world.tick++;
}

export function isAtRest(world: World): boolean {
  for (const s of world.stones) if (s.inPlay && s.moving) return false;
  return true;
}
