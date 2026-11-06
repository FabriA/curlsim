/**
 * Suoni con la Web Audio API. Lo scivolamento usa un loop registrato (ricostruzione a 2 m/s,
 * assets/audio/LEGGIMI.md): una voce per ogni pietra in movimento, con volume e altezza che
 * seguono la velocità. Gli urti tra pietre usano un campione registrato (con un modello sintetico di riserva);
 * l'uscita dalla pista e la spazzata sono sintetizzate. Disattivabili; la scelta resta
 * memorizzata nel browser. I suoni non toccano la simulazione: sono solo una resa dell'interfaccia.
 */
const STORE_KEY = "curlsim.sound";

type Ctx = AudioContext;

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Riproduzione del campione d'urto in funzione della forza (0–1): urti violenti forti e chiari,
 * urti lenti più deboli e scuri; ogni urto varia l'altezza di ±4% per non suonare identico.
 */
export function collisionPlayback(strength: number, rand: () => number = Math.random): { gain: number; cutoff: number; rate: number } {
  const s = Math.min(1, Math.max(0, strength));
  return { gain: 0.7 * (0.12 + 0.88 * Math.pow(s, 0.8)), cutoff: 2500 + 8500 * s, rate: 0.96 + 0.08 * rand() };
}

/** Volume complessivo degli urti. */
const IMPACT_LEVEL = 0.55;

export interface ImpactModel {
  /** Modi del granito: sinusoidi smorzate (frequenza Hz, ampiezza, costante di tempo s). */
  partials: { freq: number; amp: number; decay: number }[];
  /** Scatto del contatto: rumore filtrato. */
  click: { gain: number; cutoff: number; decay: number };
}

/**
 * Modi del granito ricavati dall'analisi di urti reali (clip fornite il 6 novembre 2026; nessun
 * campione è incluso nel gioco). L'urto più pulito ha i picchi a circa 275, 412, 550 e 687 Hz,
 * quasi una serie armonica di 137 Hz, con il più forte a 412 Hz; poca energia sopra 1 kHz
 * (1–2 kHz circa −20 dB, 2–4 kHz circa −30 dB, 4–8 kHz circa −39 dB) e una coda che si spegne in un paio di decimi
 * di secondo (in parte riverbero del palazzetto). Ampiezze in dB rispetto al modo a 412 Hz.
 */
const GRANITE_MODES: [number, number][] = [
  [137, -16],
  [275, -8],
  [412, 0],
  [550, -10],
  [687, -5],
  [833, -9],
  [1100, -17],
  [1500, -20],
  [1950, -22],
  [2600, -24],
  [3400, -27],
  [4600, -30],
];

/**
 * Suono di un urto in funzione della forza (0–1: variazione di velocità fino a circa 2,5 m/s).
 * Urti forti: più forti e un po' più chiari; urti deboli: più scuri. Ogni urto varia un poco le
 * frequenze, così due urti non suonano mai identici.
 */
export function impactModel(strength: number, rand: () => number = Math.random): ImpactModel {
  const s = Math.min(1, Math.max(0, strength));
  const level = 0.15 + 0.85 * Math.pow(s, 0.8);
  const partials = GRANITE_MODES.map(([f, db]) => {
    const tilt = f > 700 ? (1 - s) * -6 * Math.log2(f / 700) : 0; // urti deboli: meno alti
    const amp = level * Math.pow(10, (db + tilt) / 20) * (0.85 + 0.3 * rand());
    const decay = 0.07 * Math.pow(412 / f, 0.5) * (0.85 + 0.3 * rand());
    return { freq: f * (0.98 + 0.04 * rand()), amp: amp * 0.45, decay };
  });
  return { partials, click: { gain: level * (0.2 + 0.15 * s), cutoff: 4000 + 2000 * s, decay: 0.002 + 0.002 * s } };
}

/** Volume del fruscio della spazzata. */
const SWEEP_LEVEL = 0.12;

/** Volume complessivo dello scivolamento e numero massimo di pietre che suonano insieme. */
const SLIDE_LEVEL = 0.6;
const MAX_VOICES = 6;

interface Voice {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Volume e brillantezza dello scivolamento in funzione della velocità (m/s). L'altezza non cambia:
 * un rombo che sale di tono con la velocità ricorda un motore che accelera, non una pietra.
 * Il volume segue il modello del file fornito; la pietra lenta è più scura (meno alti).
 */
export function slideMapping(v: number): { gain: number; cutoff: number } {
  const s = Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0;
  const r = s / 2;
  return { gain: s <= 0.015 ? 0 : Math.pow(Math.min(r, 2), 0.8), cutoff: 300 + 900 * Math.min(1, s / 2.5) };
}

async function decode(ctx: Ctx, data: ArrayBuffer): Promise<AudioBuffer> {
  // Safari meno recenti conoscono solo la forma con le callback.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

export class Sound {
  private ctx: Ctx | null = null;
  private slideBuffer: AudioBuffer | null = null;
  private collisionBuffer: AudioBuffer | null = null;
  private slideBus: GainNode | null = null;
  private voices = new Map<number, Voice>();
  private sweepGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastImpact = 0;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORE_KEY) !== "0";
    } catch {
      /* predefinito: attivi */
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORE_KEY, on ? "1" : "0");
    } catch {
      /* niente */
    }
    if (!on) this.silence();
    else this.unlock();
  }

  /**
   * Da chiamare dentro un gesto dell'utente (Tira): i browser permettono l'audio solo dopo
   * un'interazione. Crea il contesto la prima volta e lo riprende se era sospeso.
   */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this.build();
      if (this.ctx?.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    // Due secondi di rumore bianco, riusati da tutti i suoni.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    this.noise = buf;

    // Scivolamento: il loop registrato si carica a parte, solo quando serve.
    this.slideBus = ctx.createGain();
    this.slideBus.gain.value = SLIDE_LEVEL;
    this.slideBus.connect(ctx.destination);
    void this.loadSlide(ctx);

    // Spazzata: fruscio sintetico, rumore acuto modulato a circa 5 colpi al secondo.
    const sweep = ctx.createBufferSource();
    sweep.buffer = buf;
    sweep.loop = true;
    sweep.playbackRate.value = 0.9;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 0.8;
    const strokes = ctx.createGain();
    strokes.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(strokes.gain);
    lfo.start();
    this.sweepGain = ctx.createGain();
    this.sweepGain.gain.value = 0;
    sweep.connect(band).connect(strokes).connect(this.sweepGain).connect(ctx.destination);
    sweep.start();
  }

  private async loadSlide(ctx: Ctx): Promise<void> {
    try {
      const { SLIDE_WAV_BASE64 } = await import("./sounds/slide");
      this.slideBuffer = await decode(ctx, fromBase64(SLIDE_WAV_BASE64));
    } catch {
      this.slideBuffer = null; // senza il loop la pietra scivola in silenzio
    }
    try {
      const { COLLISION_WAV_BASE64 } = await import("./sounds/collision");
      this.collisionBuffer = await decode(ctx, fromBase64(COLLISION_WAV_BASE64));
    } catch {
      this.collisionBuffer = null; // senza il campione resta il modello sintetico
    }
  }

  /**
   * Aggiornamento a ogni fotogramma: `stones` sono le pietre in movimento con la loro velocità
   * (m/s), `sweeping` se si sta spazzando, `impact` la variazione di velocità dell'urto più forte
   * nel fotogramma (0 se nessuno).
   */
  update(stones: { id: number; speed: number }[], sweeping: boolean, impact: number, board = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    this.updateSlide(ctx, stones);
    this.setSweeping(now, sweeping);
    if (impact > 0.05 && now - this.lastImpact > 0.03) {
      this.lastImpact = now;
      this.clack(Math.min(1, impact / 2.5));
    }
    // Pietra che esce dal gioco contro la sponda: il suono sintetico, diverso da un urto tra pietre.
    if (board > 0.05) this.boardHit(Math.min(1, board / 2.5));
  }

  /** Spazzata: fruscio sintetico, attivo finché si tiene premuto Spazza. */
  private setSweeping(now: number, sweeping: boolean): void {
    this.sweepGain!.gain.setTargetAtTime(sweeping ? SWEEP_LEVEL : 0, now, 0.03);
  }

  /** Una voce per pietra; più pietre insieme abbassano il volume di ognuna per non saturare. */
  private updateSlide(ctx: Ctx, stones: { id: number; speed: number }[]): void {
    const buf = this.slideBuffer;
    if (!buf || !this.slideBus) return;
    const now = ctx.currentTime;
    const active = stones.filter((s) => s.speed > 0.015).sort((a, b) => b.speed - a.speed).slice(0, MAX_VOICES);
    const scale = 1 / Math.sqrt(Math.max(1, active.length));
    const keep = new Set(active.map((s) => s.id));
    for (const [id, v] of this.voices) if (!keep.has(id)) this.release(id, v);
    for (const s of active) {
      let v = this.voices.get(s.id);
      if (!v) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        // Ogni pietra ha una piccola differenza d'altezza fissa e parte da un punto diverso del loop.
        src.playbackRate.value = 0.97 + Math.random() * 0.06;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.value = 0.6;
        filter.frequency.value = slideMapping(s.speed).cutoff;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.slideBus);
        src.start(now, Math.random() * buf.duration);
        v = { src, filter, gain };
        this.voices.set(s.id, v);
      }
      const m = slideMapping(s.speed);
      v.filter.frequency.setTargetAtTime(m.cutoff, now, 0.1);
      v.gain.gain.setTargetAtTime(m.gain * scale, now, 0.04);
    }
  }

  private release(id: number, v: Voice): void {
    const ctx = this.ctx!;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    v.src.stop(ctx.currentTime + 0.3);
    this.voices.delete(id);
  }

  /** Pietra che esce dal gioco contro la sponda o in fondo: colpo sintetico, più secco e legnoso. */
  private boardHit(strength: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1300;
    band.Q.value = 3;
    const g = ctx.createGain();
    const peak = 0.2 + 0.8 * strength;
    g.gain.setValueAtTime(peak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(band).connect(g).connect(ctx.destination);
    src.start(now, Math.random() * 1.5, 0.15);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1900, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.25 * peak, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(og).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /** Urto con il campione registrato: volume e brillantezza dalla forza, altezza un poco variata. */
  private playCollision(strength: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const p = collisionPlayback(strength, Math.random);
    const src = ctx.createBufferSource();
    src.buffer = this.collisionBuffer;
    src.playbackRate.value = p.rate;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.cutoff;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = p.gain;
    src.connect(lp).connect(g).connect(ctx.destination);
    src.start(now);
  }

  /** Urto tra due pietre: modi del granito più lo scatto del contatto (vedi impactModel). */
  private clack(strength: number): void {
    if (this.collisionBuffer) {
      this.playCollision(strength);
      return;
    }
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const m = impactModel(strength, Math.random);
    const bus = ctx.createGain();
    bus.gain.value = IMPACT_LEVEL;
    bus.connect(ctx.destination);
    for (const p of m.partials) {
      const osc = ctx.createOscillator();
      osc.frequency.value = p.freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(p.amp, now + 0.0015);
      g.gain.setTargetAtTime(0, now + 0.0015, p.decay);
      osc.connect(g).connect(bus);
      osc.start(now);
      osc.stop(now + 0.0015 + p.decay * 7);
    }
    // Scatto del contatto: rumore brevissimo, più chiaro e più forte negli urti violenti.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = m.click.cutoff;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(m.click.gain, now);
    cg.gain.setTargetAtTime(0, now, m.click.decay);
    src.connect(hp).connect(lp).connect(cg).connect(bus);
    src.start(now, Math.random() * 1.5, 0.08);
  }

  /** Silenzio immediato: fine del tiro, tiro fermato, scheda nascosta o suoni disattivati. */
  silence(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [id, v] of this.voices) this.release(id, v);
    this.sweepGain?.gain.setTargetAtTime(0, now, 0.02);
  }
}
