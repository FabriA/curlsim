/**
 * Strumento di trascinamento delle pietre su una vista della pista.
 * Indipendente dal laboratorio: la modalità di allenamento lo collegherà allo stesso modo.
 *
 *  - trascina una pietra per spostarla;
 *  - tocca un punto libero per aggiungerne una della squadra scelta, e trascinala;
 *  - portala oltre la back line o sulla linea laterale, oppure toccala due volte, per toglierla.
 */
import { checkPlacement, hitTest, nextId, removeStone, type PlacementCheck } from "../core/placement";
import type { Team } from "../core/physics";
import type { StonePlacement } from "../core/sim";
import type { Renderer } from "./render";

export interface PlacementHost {
  stones(): StonePlacement[];
  setStones(stones: StonePlacement[]): void;
  team(): Team;
  /** true mentre una pietra è in corsa: il posizionamento è sospeso. */
  locked(): boolean;
  redraw(): void;
  message(check: PlacementCheck | "removed" | "added" | "moved"): void;
}

interface Drag {
  id: number;
  team: Team;
  isNew: boolean;
  origin: { x: number; y: number } | null;
  x: number;
  y: number;
  check: PlacementCheck;
  pointerId: number;
}

const DOUBLE_TAP_MS = 350;

export class PlacementTool {
  enabled = false;
  private drag: Drag | null = null;
  private lastTap = { id: -1, time: 0 };

  constructor(
    private readonly view: Renderer,
    private readonly host: PlacementHost,
  ) {
    const c = view.canvas;
    c.addEventListener("pointerdown", (e) => this.down(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.up(e));
    c.addEventListener("pointercancel", () => this.cancel());
    c.addEventListener("lostpointercapture", () => this.cancel());
  }

  /** Pietre da disegnare, con quella trascinata nella posizione corrente. */
  preview(): { stones: StonePlacement[]; highlight: { id: number; ok: boolean } | null } {
    const base = this.host.stones();
    const d = this.drag;
    if (!d) return { stones: base, highlight: null };
    const others = base.filter((s) => s.id !== d.id);
    return { stones: [...others, { id: d.id, team: d.team, x: d.x, y: d.y }], highlight: { id: d.id, ok: d.check === "ok" } };
  }

  private down(e: PointerEvent): void {
    if (!this.enabled || this.host.locked()) return;
    e.preventDefault();
    const p = this.view.eventToWorld(e);
    const stones = this.host.stones();
    const hit = hitTest(stones, p.x, p.y);
    if (hit) {
      const now = performance.now();
      if (this.lastTap.id === hit.id && now - this.lastTap.time < DOUBLE_TAP_MS) {
        this.host.setStones(removeStone(stones, hit.id));
        this.lastTap = { id: -1, time: 0 };
        this.host.message("removed");
        this.host.redraw();
        return;
      }
      this.lastTap = { id: hit.id, time: now };
      this.drag = { id: hit.id, team: hit.team, isNew: false, origin: { x: hit.x, y: hit.y }, x: hit.x, y: hit.y, check: "ok", pointerId: e.pointerId };
    } else {
      const team = this.host.team();
      const check = checkPlacement(stones, p.x, p.y, null, team);
      if (check === "teamFull") {
        this.host.message("teamFull");
        return;
      }
      this.drag = { id: nextId(stones), team, isNew: true, origin: null, x: p.x, y: p.y, check, pointerId: e.pointerId };
    }
    try {
      this.view.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* non disponibile in alcuni browser */
    }
    this.host.redraw();
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = this.view.eventToWorld(e);
    d.x = p.x;
    d.y = p.y;
    d.check = checkPlacement(this.host.stones(), p.x, p.y, d.isNew ? null : d.id, d.team);
    this.host.redraw();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    const stones = this.host.stones();
    const unmoved = !d.isNew && d.origin && Math.hypot(d.x - d.origin.x, d.y - d.origin.y) < 0.002;
    if (unmoved) {
      // Semplice tocco su una pietra: nessuna modifica (un secondo tocco rapido la toglie).
    } else if (d.check === "ok") {
      const others = stones.filter((s) => s.id !== d.id);
      this.host.setStones([...others, { id: d.id, team: d.team, x: d.x, y: d.y }].sort((a, b) => a.id - b.id));
      this.host.message(d.isNew ? "added" : "moved");
    } else if (d.check === "outside" && !d.isNew) {
      this.host.setStones(removeStone(stones, d.id));
      this.host.message("removed");
    } else {
      this.host.message(d.check);
    }
    this.host.redraw();
  }

  /** Gesto interrotto: la pietra torna dov'era. */
  private cancel(): void {
    if (!this.drag) return;
    this.drag = null;
    this.host.redraw();
  }
}
