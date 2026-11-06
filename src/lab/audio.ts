/**
 * Suoni con la Web Audio API. Lo scivolamento usa un loop registrato (ricostruzione a 2 m/s,
 * assets/audio/LEGGIMI.md): una voce per ogni pietra in movimento, con volume e altezza che
 * seguono la velocità. Urti e spazzata sono ancora sintetizzati. Disattivabili; la scelta resta
 * memorizzata nel browser. I suoni non toccano la simulazione: sono solo una resa dell'interfaccia.
 */
const STORE_KEY = "curlsim.sound";

type Ctx = AudioContext;

/** Volume complessivo degli urti. */
const IMPACT_LEVEL = 0.55;

export interface ImpactModel {
  /** Modi del granito: sinusoidi smorzate (frequenza Hz, ampiezza, costante di tempo s). */
  partials: { freq: number; amp: number; decay: number }[];
  /** Scatto del contatto: rumore filtrato. */
  click: { gain: number; cutoff: number; decay: number };
}

/**
 * Modi misurati su urti reali (analisi spettrale di clip fornite, 6 novembre 2026; nessun campione
 * è incluso nel gioco): energia soprattutto tra 500 e 1000 Hz, picchi intorno a 440, 590, 800,
 * 876, 1010 e 1340 Hz, decadimento rapido (circa 5–40 ms per perdere 20 dB). Rispetto alla banda
 * 500–1000 Hz: 1–2 kHz circa −5 dB, 2–4 kHz circa −13 dB, 4–8 kHz circa −20 dB. Ampiezze relative
 * in dB rispetto al picco più forte (876 Hz).
 */
const GRANITE_MODES: [number, number][] = [
  [440, -7.4],
  [590, -2.5],
  [800, -2.6],
  [876, 0],
  [1010, -3.3],
  [1340, -3],
  [1740, -4],
  [2250, -6],
  [2900, -8],
  [3700, -11],
];

/**
 * Suono di un urto in funzione della forza (0–1: variazione di velocità fino a circa 2,5 m/s).
 * Urti forti: più forti e più brillanti (più modi alti, scatto più chiaro), smorzamento più rapido.
 * Urti deboli: più scuri, quasi solo i modi tra 500 e 900 Hz. Ogni urto varia un poco le frequenze.
 */
export function impactModel(strength: number, rand: () => number = Math.random): ImpactModel {
  const s = Math.min(1, Math.max(0, strength));
  const level = 0.15 + 0.85 * Math.pow(s, 0.8);
  const partials = GRANITE_MODES.map(([f, db]) => {
    const tilt = f > 1000 ? (1 - s) * -2 * Math.log2(f / 1000) : 0; // urti deboli: meno alti
    const amp = level * Math.pow(10, (db + tilt) / 20) * (0.85 + 0.3 * rand());
    const decay = (0.012 - 0.005 * s) * Math.pow(876 / f, 0.5) * (0.85 + 0.3 * rand());
    return { freq: f * (0.97 + 0.06 * rand()), amp: amp * 0.4, decay };
  });
  return { partials, click: { gain: level * (0.5 + 0.15 * s), cutoff: 6500 + 1000 * s, decay: 0.003 + 0.002 * s } };
}

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

    // Spazzata: rumore acuto, modulato a circa 5 colpi al secondo.
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
      const bin = atob(SLIDE_WAV_BASE64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      this.slideBuffer = await decode(ctx, bytes.buffer);
    } catch {
      this.slideBuffer = null; // senza il loop la pietra scivola in silenzio
    }
  }

  /**
   * Aggiornamento a ogni fotogramma: `stones` sono le pietre in movimento con la loro velocità
   * (m/s), `sweeping` se si sta spazzando, `impact` la variazione di velocità dell'urto più forte
   * nel fotogramma (0 se nessuno).
   */
  update(stones: { id: number; speed: number }[], sweeping: boolean, impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    this.updateSlide(ctx, stones);
    this.sweepGain!.gain.setTargetAtTime(sweeping ? 0.12 : 0, now, 0.03);
    if (impact > 0.05 && now - this.lastImpact > 0.03) {
      this.lastImpact = now;
      this.clack(Math.min(1, impact / 2.5));
    }
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

  /** Urto tra due pietre: modi del granito più lo scatto del contatto (vedi impactModel). */
  private clack(strength: number): void {
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
