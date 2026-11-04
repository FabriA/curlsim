import { describe, expect, it } from "vitest";
import { calibrate, speedToStopAt } from "../src/core/calibrate";
import { DELIVERY_BACK_Y, deliveryPosition, deliveryStartsOnHackLine, planDelivery } from "../src/core/delivery";
import { RELEASE_Y, TEE_Y } from "../src/core/geometry";
import { PROFILES } from "../src/core/params";
import { computeRelease } from "../src/core/sim";

const params = calibrate(PROFILES.normal);
const exact = { lineSigma: 0, weightSigma: 0 };

describe("fase di consegna e intertempo back-to-hog", () => {
  it("un draw al tee ha un back-to-hog tra 3,5 e 4,5 s", () => {
    const r = computeRelease({ broomX: 0, broomY: TEE_Y, speed: speedToStopAt(params, TEE_Y), spin: 1, spinRate: 1.5 }, exact, 1);
    const d = planDelivery(r);
    expect(d.backToHog).toBeGreaterThan(3.5);
    expect(d.backToHog).toBeLessThan(4.5);
  });

  it("una bocciata ha un back-to-hog più breve di un draw", () => {
    const draw = planDelivery(computeRelease({ broomX: 0, broomY: TEE_Y, speed: 2.03, spin: 1, spinRate: 1.5 }, exact, 1));
    const hit = planDelivery(computeRelease({ broomX: 0, broomY: TEE_Y, speed: 3.0, spin: 1, spinRate: 1.5 }, exact, 1));
    expect(hit.backToHog).toBeLessThan(draw.backToHog - 0.8);
  });

  it("l'animazione parte dalla back line sulla linea di tiro e arriva al punto di rilascio", () => {
    const r = computeRelease({ broomX: 0.9, broomY: TEE_Y, speed: 2.03, spin: 1, spinRate: 1.5 }, exact, 1);
    const d = planDelivery(r);
    expect(d.start.y).toBe(DELIVERY_BACK_Y);
    expect(deliveryStartsOnHackLine(d)).toBe(true);
    const end = deliveryPosition(d, d.backToHog);
    expect(end.x).toBeCloseTo(r.x, 9);
    expect(end.y).toBeCloseTo(RELEASE_Y, 9);
  });

  it("senza decelerazione il back-to-hog è distanza diviso velocità", () => {
    const r = computeRelease({ broomX: 0, broomY: TEE_Y, speed: 2, spin: 1, spinRate: 1.5 }, exact, 1);
    const d = planDelivery(r, 0);
    expect(d.backToHog).toBeCloseTo((RELEASE_Y - DELIVERY_BACK_Y) / 2, 9);
  });
});
