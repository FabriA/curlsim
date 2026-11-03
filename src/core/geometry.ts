/**
 * Misure del rink secondo World Curling, The Rules of Curling (1 settembre 2026), R1 e R2.
 *
 * Sistema di coordinate (metri):
 *  - origine al centro della pista;
 *  - asse y lungo la pista, positivo verso l'estremità di gioco (playing end);
 *  - asse x trasversale, positivo a destra di chi tira guardando verso la casa.
 */

/** Distanza del centro della tee line dal centro della pista (R1 b-I). */
export const TEE_Y = 17.375;

/** Larghezza della hog line (R1 b-III). */
export const HOG_WIDTH = 0.102;
/** Bordo interno della hog line all'estremità di gioco: 6,401 m dal tee (R1 b-III). */
export const FAR_HOG_INSIDE = TEE_Y - 6.401;
/** Bordo della hog line di gioco verso il centro della pista. */
export const FAR_HOG_OUTSIDE = FAR_HOG_INSIDE - HOG_WIDTH;
/** Bordo della hog line di consegna verso il centro della pista (rilascio). */
export const NEAR_HOG_EDGE = -FAR_HOG_OUTSIDE;

/** Bordo esterno della back line: 1,829 m dal tee (R1 b-II). */
export const BACK_LINE_OUTSIDE = TEE_Y + 1.829;
export const BACK_LINE_WIDTH = 0.013;

/** Hack line: 3,658 m oltre il tee (R1 b-IV, b-V). */
export const HACK_Y = TEE_Y + 3.658;

/** Metà lunghezza e metà larghezza della pista (R1 a: 45,720 m × 4,750 m). */
export const HALF_LENGTH = 45.72 / 2;
export const HALF_WIDTH = 4.75 / 2;

/** Raggi dei cerchi della casa (R1 d): 12, 8, 4 piedi e bottone. */
export const HOUSE_RADII = [1.829, 1.219, 0.61, 0.152] as const;
export const HOUSE_RADIUS = HOUSE_RADII[0];

/** Raggio della pietra: circonferenza massima 914 mm (R2 a). */
export const STONE_RADIUS = 0.145;

/** Punto di partenza della simulazione: centro della pietra sul bordo della hog line di consegna. */
export const RELEASE_Y = NEAR_HOG_EDGE;
