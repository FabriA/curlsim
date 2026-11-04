/**
 * Disegno 2D della pista su canvas, vista dall'alto.
 * Due viste: la pista intera (striscia verticale) e la casa di gioco ingrandita.
 * I colori arrivano dai token CSS, così il disegno segue il tema chiaro o scuro.
 */
import {
  BACK_LINE_OUTSIDE,
  BACK_LINE_WIDTH,
  FAR_HOG_INSIDE,
  HACK_Y,
  HALF_LENGTH,
  HALF_WIDTH,
  HOG_WIDTH,
  HACK_POINT,
  HOUSE_RADII,
  STONE_RADIUS,
  TEE_Y,
} from "../core/geometry";

export interface ViewRect {
  /** Estremi in metri dell'area mostrata. */
  y0: number;
  y1: number;
}

export interface DrawStone {
  id: number;
  team: 0 | 1;
  x: number;
  y: number;
  angle: number;
  delivered?: boolean;
  /** Velocità, per disegnare la spazzata davanti alla pietra. */
  vx?: number;
  vy?: number;
}

export interface Scene {
  stones: DrawStone[];
  traces: { team: 0 | 1; points: { x: number; y: number; swept?: boolean }[] }[];
  broom: { x: number; y: number };
  /** Punto d'arresto previsto (dritto, senza spazzata) per il peso scelto. */
  predictedStopY: number | null;
  sweeping: boolean;
  /** Pietra trascinata: anello verde se la posizione è valida, rosso se no. */
  highlight?: { id: number; ok: boolean } | null;
  /** Free guard zone in vigore: si evidenzia l'area tra hog line e tee line, casa esclusa. */
  fgz?: boolean;
  /** Pietre che contano a fine end. */
  counting?: number[];
}

export const HOUSE_VIEW: ViewRect = { y0: FAR_HOG_INSIDE - 0.6, y1: HACK_Y + 0.4 };
export const SHEET_VIEW: ViewRect = { y0: -HALF_LENGTH, y1: HALF_LENGTH };

interface Palette {
  ice: string;
  pebble: string;
  line: string;
  hog: string;
  ring12: string;
  ring4: string;
  granite: string;
  graniteEdge: string;
  team0: string;
  team1: string;
  broom: string;
  aim: string;
  sweep: string;
  ok: string;
  bad: string;
  fgz: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => cs.getPropertyValue(n).trim();
  return {
    ice: g("--ice"),
    pebble: g("--pebble"),
    line: g("--ink"),
    hog: g("--hog"),
    ring12: g("--ring-blue"),
    ring4: g("--ring-red"),
    granite: g("--granite"),
    graniteEdge: g("--granite-edge"),
    team0: g("--team-0"),
    team1: g("--team-1"),
    broom: g("--broom"),
    aim: g("--aim"),
    sweep: g("--sweep"),
    ok: g("--ok"),
    bad: g("--bad"),
    fgz: g("--fgz"),
  };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private pebbleCache: HTMLCanvasElement | null = null;
  private pebbleKey = "";

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly view: ViewRect,
    readonly detailed: boolean,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  /** Adatta la risoluzione del canvas alle dimensioni CSS e al pixel ratio. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.pebbleCache = null;
    }
    this.scale = w / (2 * HALF_WIDTH);
  }

  /** Coordinate canvas (pixel del dispositivo) → metri. */
  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: px / this.scale - HALF_WIDTH, y: this.view.y1 - py / this.scale };
  }

  /** Coordinate CSS dell'evento → metri. */
  eventToWorld(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.width / rect.width;
    return this.toWorld((ev.clientX - rect.left) * ratio, (ev.clientY - rect.top) * ratio);
  }

  private X(x: number): number {
    return (x + HALF_WIDTH) * this.scale;
  }
  private Y(y: number): number {
    return (this.view.y1 - y) * this.scale;
  }

  draw(scene: Scene): void {
    const ctx = this.ctx;
    const pal = palette();
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    this.drawIce(pal, W, H);
    if (scene.fgz) {
      ctx.fillStyle = pal.fgz;
      ctx.fillRect(0, this.Y(TEE_Y), W, (TEE_Y - FAR_HOG_INSIDE) * this.scale);
    }
    this.drawHouse(pal, TEE_Y);
    if (this.view.y0 < -TEE_Y + 2) this.drawHouse(pal, -TEE_Y);
    this.drawLines(pal);

    // Linea di mira dalla staffa alla scopa.
    ctx.save();
    ctx.strokeStyle = pal.aim;
    ctx.lineWidth = Math.max(1, this.scale * 0.012);
    ctx.setLineDash([this.scale * 0.15, this.scale * 0.12]);
    ctx.beginPath();
    ctx.moveTo(this.X(HACK_POINT.x), this.Y(HACK_POINT.y));
    ctx.lineTo(this.X(scene.broom.x), this.Y(scene.broom.y));
    ctx.stroke();
    ctx.restore();

    if (scene.predictedStopY !== null && this.detailed) this.drawPredicted(pal, scene.predictedStopY);

    for (const tr of scene.traces) {
      if (tr.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = tr.team === 0 ? pal.team0 : pal.team1;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(1, this.scale * 0.02);
      ctx.beginPath();
      ctx.moveTo(this.X(tr.points[0].x), this.Y(tr.points[0].y));
      for (const p of tr.points) ctx.lineTo(this.X(p.x), this.Y(p.y));
      ctx.stroke();
      // Tratti spazzati: una banda del colore della spazzata sotto la traccia.
      ctx.strokeStyle = pal.sweep;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(3, this.scale * 0.11);
      ctx.lineCap = "round";
      for (let i = 1; i < tr.points.length; i++) {
        if (!tr.points[i].swept) continue;
        ctx.beginPath();
        ctx.moveTo(this.X(tr.points[i - 1].x), this.Y(tr.points[i - 1].y));
        ctx.lineTo(this.X(tr.points[i].x), this.Y(tr.points[i].y));
        ctx.stroke();
      }
      ctx.restore();
    }

    this.drawBroom(pal, scene.broom.x, scene.broom.y);
    for (const s of scene.stones) this.drawStone(pal, s, scene.sweeping && !!s.delivered);
    for (const id of scene.counting ?? []) {
      const s = scene.stones.find((x) => x.id === id);
      if (!s) continue;
      ctx.save();
      ctx.strokeStyle = pal.ok;
      ctx.lineWidth = Math.max(2, this.scale * 0.035);
      ctx.beginPath();
      ctx.arc(this.X(s.x), this.Y(s.y), STONE_RADIUS * this.scale * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const hl = scene.highlight;
    if (hl) {
      const s = scene.stones.find((x) => x.id === hl.id);
      if (s) {
        ctx.save();
        ctx.strokeStyle = hl.ok ? pal.ok : pal.bad;
        ctx.lineWidth = Math.max(2, this.scale * 0.03);
        ctx.beginPath();
        ctx.arc(this.X(s.x), this.Y(s.y), STONE_RADIUS * this.scale * 1.25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawIce(pal: Palette, W: number, H: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = pal.ice;
    ctx.fillRect(0, 0, W, H);
    if (!this.detailed) return;
    // Pebble: punti fissi generati una volta per dimensione e colore.
    const key = `${W}x${H}:${pal.pebble}`;
    if (!this.pebbleCache || this.pebbleKey !== key) {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      g.fillStyle = pal.pebble;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round((W * H) / 900);
      for (let i = 0; i < n; i++) {
        const r = 0.6 + rnd() * 1.1;
        g.beginPath();
        g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
        g.fill();
      }
      this.pebbleCache = c;
      this.pebbleKey = key;
    }
    ctx.drawImage(this.pebbleCache, 0, 0);
  }

  private drawHouse(pal: Palette, teeY: number): void {
    const ctx = this.ctx;
    const fills = [pal.ring12, pal.ice, pal.ring4, pal.ice];
    HOUSE_RADII.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(this.X(0), this.Y(teeY), r * this.scale, 0, Math.PI * 2);
      ctx.fillStyle = fills[i];
      ctx.fill();
    });
  }

  private hline(y: number, width: number, color: string, x0 = -HALF_WIDTH, x1 = HALF_WIDTH): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const h = Math.max(1, width * this.scale);
    ctx.fillRect(this.X(x0), this.Y(y) - h / 2, (x1 - x0) * this.scale, h);
  }

  private drawLines(pal: Palette): void {
    const ctx = this.ctx;
    const thin = 0.013;
    for (const sgn of [1, -1]) {
      this.hline(sgn * TEE_Y, thin, pal.line);
      this.hline(sgn * (BACK_LINE_OUTSIDE - BACK_LINE_WIDTH / 2), BACK_LINE_WIDTH, pal.line);
      this.hline(sgn * (FAR_HOG_INSIDE - HOG_WIDTH / 2), HOG_WIDTH, pal.hog);
      this.hline(sgn * HACK_Y, thin, pal.line, -0.2285, 0.2285);
      // Hack: due appoggi ai lati della linea centrale (R1 e).
      ctx.fillStyle = pal.line;
      for (const side of [-1, 1]) {
        const x = side * (0.076 + 0.076);
        ctx.fillRect(this.X(x - 0.076), this.Y(sgn * HACK_Y) - (sgn > 0 ? 0 : 0.2 * this.scale), 0.152 * this.scale, 0.2 * this.scale);
      }
    }
    // Linea centrale: da un hack line all'altro, oltre i tee di 3,658 m.
    ctx.fillStyle = pal.line;
    const cw = Math.max(1, thin * this.scale);
    ctx.fillRect(this.X(0) - cw / 2, this.Y(HACK_Y), cw, (2 * HACK_Y) * this.scale);
    // Linee laterali.
    const sw = Math.max(1, 0.02 * this.scale);
    ctx.fillRect(0, 0, sw, this.canvas.height);
    ctx.fillRect(this.canvas.width - sw, 0, sw, this.canvas.height);
  }

  private drawPredicted(pal: Palette, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = pal.aim;
    ctx.lineWidth = Math.max(1, this.scale * 0.015);
    ctx.setLineDash([this.scale * 0.06, this.scale * 0.06]);
    ctx.beginPath();
    ctx.moveTo(this.X(-0.45), this.Y(y));
    ctx.lineTo(this.X(0.45), this.Y(y));
    ctx.stroke();
    ctx.restore();
  }

  private drawBroom(pal: Palette, x: number, y: number): void {
    const ctx = this.ctx;
    const cx = this.X(x);
    const cy = this.Y(y);
    const r = Math.max(5, 0.13 * this.scale);
    ctx.save();
    ctx.fillStyle = pal.broom;
    ctx.globalAlpha = 0.9;
    // Testa della scopa: un pad rettangolare arrotondato.
    const w = r * 2.2;
    const h = r * 0.9;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.ice;
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.32, cy);
    ctx.lineTo(cx + w * 0.32, cy);
    ctx.stroke();
    ctx.restore();
  }

  private drawStone(pal: Palette, s: DrawStone, sweeping: boolean): void {
    const ctx = this.ctx;
    const cx = this.X(s.x);
    const cy = this.Y(s.y);
    const r = STONE_RADIUS * this.scale;
    if (sweeping) {
      ctx.save();
      ctx.fillStyle = pal.sweep;
      ctx.globalAlpha = 0.35;
      // Davanti alla pietra, nella direzione del moto: le scope lavorano sul ghiaccio che la pietra sta per attraversare.
      const v = Math.hypot(s.vx ?? 0, s.vy ?? 0);
      const ux = v > 1e-6 ? (s.vx ?? 0) / v : 0;
      const uy = v > 1e-6 ? (s.vy ?? 0) / v : 1;
      // In coordinate canvas l'asse y è invertito.
      const ax = cx + ux * r * 2.2;
      const ay = cy - uy * r * 2.2;
      const rot = Math.atan2(-uy, ux) + Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(ax, ay, r * 1.3, r * 0.7, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = pal.granite;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = pal.graniteEdge;
    ctx.stroke();
    // Coperchio colorato e maniglia, ruotata secondo la rotazione accumulata.
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = s.team === 0 ? pal.team0 : pal.team1;
    ctx.fill();
    if (r > 4) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.angle);
      ctx.fillStyle = pal.graniteEdge;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.roundRect(-r * 0.14, -r * 0.55, r * 0.28, r * 0.9, r * 0.12);
      ctx.fill();
      ctx.restore();
    }
  }
}
