/**
 * Decisioni regolamentari sulle pietre fuori gioco, separate dalla fisica.
 * Riferimento: World Curling, The Rules of Curling (1 settembre 2026), R2 f–h.
 */
import { BACK_LINE_OUTSIDE, FAR_HOG_INSIDE, HALF_WIDTH, STONE_RADIUS } from "./geometry";
import type { Stone, World } from "./physics";

export type RemovalReason = "sideline" | "backline" | "hog";

export interface Removal {
  id: number;
  reason: RemovalReason;
  tick: number;
}

/** Durante il moto: rimuove le pietre che toccano la linea laterale o superano la back line. */
export function applyBoundaryRules(world: World): Removal[] {
  const out: Removal[] = [];
  for (const s of world.stones) {
    if (!s.inPlay) continue;
    let reason: RemovalReason | null = null;
    // R2 h: una pietra che tocca una sponda o la linea laterale è rimossa subito.
    if (s.x + STONE_RADIUS >= HALF_WIDTH || s.x - STONE_RADIUS <= -HALF_WIDTH) reason = "sideline";
    // R2 g: una pietra che oltrepassa completamente il bordo esterno della back line è rimossa.
    else if (s.y - STONE_RADIUS > BACK_LINE_OUTSIDE) reason = "backline";
    if (reason) {
      remove(s);
      out.push({ id: s.id, reason, tick: world.tick });
    }
  }
  return out;
}

/**
 * A fine tiro: R2 f — la pietra tirata che non si ferma completamente oltre il bordo
 * interno della hog line è rimossa, salvo se ha colpito un'altra pietra.
 */
export function applyHogRule(world: World, deliveredId: number): Removal[] {
  const s = world.stones.find((x) => x.id === deliveredId);
  if (!s || !s.inPlay) return [];
  if (s.y - STONE_RADIUS <= FAR_HOG_INSIDE && !s.hitStone) {
    remove(s);
    return [{ id: s.id, reason: "hog", tick: world.tick }];
  }
  return [];
}

function remove(s: Stone): void {
  s.inPlay = false;
  s.moving = false;
  s.vx = 0;
  s.vy = 0;
  s.w = 0;
}
