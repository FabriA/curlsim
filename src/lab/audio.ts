/**
 * Suoni sintetizzati con la Web Audio API, senza file audio: il rombo della pietra che scivola
 * (più forte quanto più è veloce), il colpo secco degli urti (più forte quanto più è violento)
 * e il fruscio ritmato della spazzata. Disattivabili; la scelta resta memorizzata nel browser.
 * I suoni non toccano la simulazione: sono solo una resa dell'interfaccia.
 */
const STORE_KEY = "curlsim.sound";

type Ctx = AudioContext;

export class Sound {
  private ctx: Ctx | null = null;
  private slideGain: GainNode | null = null;
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

    // Scivolamento: rumore filtrato in basso, il granito sul ghiaccio.
    const slide = ctx.createBufferSource();
    slide.buffer = buf;
    slide.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 320;
    low.Q.value = 0.7;
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = 120;
    body.gain.value = 8;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    slide.connect(low).connect(body).connect(this.slideGain).connect(ctx.destination);
    slide.start();

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

  /**
   * Aggiornamento a ogni fotogramma: `speed` è la velocità della pietra più veloce (m/s),
   * `sweeping` se si sta spazzando, `impact` la variazione di velocità dell'urto più forte
   * nel fotogramma (0 se nessuno).
   */
  update(speed: number, sweeping: boolean, impact: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const slide = Math.min(1, speed / 3) * 0.35;
    this.slideGain!.gain.setTargetAtTime(slide, now, 0.05);
    this.sweepGain!.gain.setTargetAtTime(sweeping ? 0.12 : 0, now, 0.03);
    if (impact > 0.05 && now - this.lastImpact > 0.03) {
      this.lastImpact = now;
      this.clack(Math.min(1, impact / 2.5));
    }
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
    this.slideGain?.gain.setTargetAtTime(0, now, 0.02);
    this.sweepGain?.gain.setTargetAtTime(0, now, 0.02);
  }
}
