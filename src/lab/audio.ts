/**
 * Suoni con la Web Audio API. Lo scivolamento usa un loop registrato (ricostruzione a 2 m/s,
 * assets/audio/LEGGIMI.md): una voce per ogni pietra in movimento, con volume e altezza che
 * seguono la velocità. Urti e spazzata sono ancora sintetizzati. Disattivabili; la scelta resta
 * memorizzata nel browser. I suoni non toccano la simulazione: sono solo una resa dell'interfaccia.
 */
const STORE_KEY = "curlsim.sound";

type Ctx = AudioContext;

/** Volume complessivo dello scivolamento e numero massimo di pietre che suonano insieme. */
const SLIDE_LEVEL = 0.6;
const MAX_VOICES = 6;

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** Altezza e volume dello scivolamento in funzione della velocità (m/s), dal modello del file fornito. */
export function slideMapping(v: number): { rate: number; gain: number } {
  const s = Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : 0;
  const r = s / 2;
  return { rate: Math.min(1.2, Math.max(0.88, 0.88 + 0.12 * r)), gain: s <= 0.015 ? 0 : Math.pow(Math.min(r, 2), 0.8) };
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
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(this.slideBus);
        // Ogni pietra parte da un punto diverso del loop, così due pietre non suonano identiche.
        src.start(now, Math.random() * buf.duration);
        v = { src, gain };
        this.voices.set(s.id, v);
      }
      const m = slideMapping(s.speed);
      v.src.playbackRate.setTargetAtTime(m.rate, now, 0.06);
      v.gain.gain.setTargetAtTime(m.gain * scale, now, 0.04);
    }
  }

  private release(id: number, v: Voice): void {
    const ctx = this.ctx!;
    v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    v.src.stop(ctx.currentTime + 0.3);
    this.voices.delete(id);
  }

  /** Colpo secco dell'urto tra due pietre. */
  private clack(strength: number): void {
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
    // Una nota breve dà il «toc» del granito.
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

  /** Silenzio immediato: fine del tiro, tiro fermato, scheda nascosta o suoni disattivati. */
  silence(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [id, v] of this.voices) this.release(id, v);
    this.sweepGain?.gain.setTargetAtTime(0, now, 0.02);
  }
}
