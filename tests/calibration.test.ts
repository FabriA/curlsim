import { describe, expect, it } from "vitest";
import { calibrate, measureDrawCurl, speedToStopAt, stopForSpeed } from "../src/core/calibrate";
import { RELEASE_Y, TEE_Y } from "../src/core/geometry";
import { DEFAULT_SPIN_RATE, PROFILES } from "../src/core/params";
import { Sim } from "../src/core/sim";

const params = calibrate(PROFILES.normal);

function draw(speed: number, spin: 1 | -1 = 1, sweep = false) {
  const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speed, w: spin * DEFAULT_SPIN_RATE });
  while (!sim.done) sim.step(sweep);
  return sim;
}

describe("calibrazione su valori tipici", () => {
  it("il draw al tee ha il tempo hog-to-hog richiesto (±0,05 s)", () => {
    const sim = draw(speedToStopAt(params, TEE_Y));
    expect(Math.abs(sim.metrics.hogToHog! - PROFILES.normal.hogToHog)).toBeLessThan(0.05);
  });

  it("il draw al tee si ferma entro 10 cm dal tee in lunghezza", () => {
    const sim = draw(speedToStopAt(params, TEE_Y));
    expect(Math.abs(sim.metrics.stop!.y - TEE_Y)).toBeLessThan(0.1);
  });

  it("la curva del draw è quella richiesta (±2 cm)", () => {
    expect(Math.abs(measureDrawCurl(params) - PROFILES.normal.curl)).toBeLessThan(0.02);
  });

  it("la rotazione oraria curva a destra, l'antioraria a sinistra, in modo simmetrico", () => {
    const right = draw(speedToStopAt(params, TEE_Y), 1).metrics.stop!.x;
    const left = draw(speedToStopAt(params, TEE_Y), -1).metrics.stop!.x;
    expect(right).toBeGreaterThan(0.5);
    expect(left).toBeLessThan(-0.5);
    expect(Math.abs(right + left)).toBeLessThan(1e-9);
  });

  it("il draw compie tra 2 e 4 giri", () => {
    const turns = draw(speedToStopAt(params, TEE_Y)).metrics.rotations;
    expect(turns).toBeGreaterThan(2);
    expect(turns).toBeLessThan(4);
  });

  it("un profilo swingy curva più di uno diritto", () => {
    expect(measureDrawCurl(calibrate(PROFILES.swingy))).toBeGreaterThan(measureDrawCurl(calibrate(PROFILES.straight)) + 0.8);
  });

  it("stopForSpeed è l'inversa di speedToStopAt", () => {
    expect(stopForSpeed(params, speedToStopAt(params, 15))).toBeCloseTo(15, 9);
  });
});

describe("intervalli di plausibilità (valori tipici di gioco)", () => {
  for (const id of ["straight", "normal", "swingy"] as const) {
    it(`profilo ${id}: corsa del draw tra 22 e 30 s, curva tra 0,5 e 2 m, da 2 a 4 giri`, () => {
      const p = calibrate(PROFILES[id]);
      const sim = new Sim(p, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: speedToStopAt(p, TEE_Y), w: DEFAULT_SPIN_RATE });
      sim.runToEnd();
      const total = sim.metrics.ticks / 1000;
      expect(total).toBeGreaterThan(22);
      expect(total).toBeLessThan(30);
      expect(sim.metrics.stop!.x).toBeGreaterThan(0.5);
      expect(sim.metrics.stop!.x).toBeLessThan(2);
      expect(sim.metrics.rotations).toBeGreaterThan(2);
      expect(sim.metrics.rotations).toBeLessThan(4);
    });
  }
});

describe("comportamenti riconoscibili", () => {
  it("una bocciata curva molto meno di un draw prima della casa", () => {
    const sim = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: 3.0, w: DEFAULT_SPIN_RATE });
    let latAtTee = 0;
    while (!sim.done) {
      sim.step(false);
      if (sim.delivered.inPlay && sim.delivered.y < TEE_Y) latAtTee = sim.delivered.x;
    }
    expect(latAtTee).toBeLessThan(0.4);
    expect(latAtTee).toBeGreaterThan(0.05);
  });

  it("la spazzata allunga il tiro e, a parità di distanza, lo tiene più diritto", () => {
    const v = speedToStopAt(params, TEE_Y - 3);
    const plain = draw(v).metrics.stop!;
    const swept = new Sim(params, [], 0, { x: 0, y: RELEASE_Y, vx: 0, vy: v, w: DEFAULT_SPIN_RATE });
    let xAtPlainStop = 0;
    while (!swept.done) {
      const before = swept.delivered.y;
      swept.step(true);
      if (before < plain.y && swept.delivered.y >= plain.y) xAtPlainStop = swept.delivered.x;
    }
    expect(swept.metrics.stop!.y - plain.y).toBeGreaterThan(1.5);
    expect(xAtPlainStop).toBeLessThan(plain.x);
  });

  it("la spazzata si interrompe alla tee line (semplificazione v1)", () => {
    const sim = draw(speedToStopAt(params, TEE_Y - 2.5), 1, true);
    expect(sim.metrics.stop!.y).toBeGreaterThan(TEE_Y);
    expect(Math.abs(sim.metrics.sweepTime - sim.metrics.hogToTee!)).toBeLessThan(0.01);
  });
});
