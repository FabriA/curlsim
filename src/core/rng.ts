/**
 * Generatore pseudo-casuale deterministico (mulberry32).
 * Usa solo operazioni intere e somme, quindi dà la stessa sequenza in ogni browser e in Node.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Numero con distribuzione approssimativamente normale (media 0, deviazione 1).
 * Somma di 12 uniformi (Irwin–Hall): evita log e cos, la cui precisione
 * può variare tra motori JavaScript.
 */
export function gaussian(rng: () => number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng();
  return s - 6;
}
