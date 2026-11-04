/**
 * Fase di consegna: la pietra, ancora in mano al tiratore, va dalla back line di consegna
 * al rilascio sulla hog line. Serve per l'intertempo back-to-hog e per l'animazione;
 * non entra nella simulazione fisica né nei replay, che partono dal rilascio.
 *
 * Modello: il tiratore scivola lungo la linea staffa → scopa con una decelerazione costante
 * e rilascia la pietra alla velocità del tiro. La decelerazione è una stima, da verificare
 * con tempi reali.
 */
import { BACK_LINE_OUTSIDE, HACK_POINT, RELEASE_Y } from "./geometry";
import type { Release } from "./sim";

/** Decelerazione della scivolata del tiratore con la pietra in mano (m/s²), stima. */
export const DELIVERY_DECEL = 0.1;

/** Bordo esterno della back line all'estremità di consegna: inizio dell'intertempo back-to-hog. */
export const DELIVERY_BACK_Y = -BACK_LINE_OUTSIDE;

export interface Delivery {
  /** Durata dalla back line al rilascio (s): l'intertempo back-to-hog. */
  backToHog: number;
  /** Velocità della pietra sulla back line (m/s). */
  speedAtBack: number;
  /** Distanza percorsa lungo la linea di tiro (m). */
  distance: number;
  /** Punto sulla back line e direzione della linea di tiro. */
  start: { x: number; y: number };
  ux: number;
  uy: number;
  decel: number;
}

export function planDelivery(release: Release, decel = DELIVERY_DECEL): Delivery {
  const v = Math.sqrt(release.vx * release.vx + release.vy * release.vy);
  const ux = release.vx / v;
  const uy = release.vy / v;
  // Distanza lungo la linea dalla back line al punto di rilascio.
  const distance = (RELEASE_Y - DELIVERY_BACK_Y) / uy;
  const start = { x: release.x - ux * distance, y: DELIVERY_BACK_Y };
  const speedAtBack = Math.sqrt(v * v + 2 * decel * distance);
  const backToHog = decel > 0 ? (speedAtBack - v) / decel : distance / v;
  return { backToHog, speedAtBack, distance, start, ux, uy, decel };
}

/** Posizione della pietra in mano al tiratore, `t` secondi dopo la back line. */
export function deliveryPosition(d: Delivery, t: number): { x: number; y: number } {
  const tt = Math.max(0, Math.min(t, d.backToHog));
  const s = d.speedAtBack * tt - 0.5 * d.decel * tt * tt;
  return { x: d.start.x + d.ux * s, y: d.start.y + d.uy * s };
}

/** Il punto di partenza dell'animazione sta sulla linea dalla staffa. */
export function deliveryStartsOnHackLine(d: Delivery): boolean {
  const cross = (d.start.x - HACK_POINT.x) * d.uy - (d.start.y - HACK_POINT.y) * d.ux;
  return Math.abs(cross) < 1e-9;
}
