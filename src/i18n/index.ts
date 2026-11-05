import { de } from "./de";
import { en } from "./en";
import { fr } from "./fr";
import { it, type Key } from "./it";

export type Lang = "it" | "en" | "de" | "fr";

/** Lingue disponibili, ognuna con il proprio nome nella propria lingua (per il selettore). */
export const LANGS: { code: Lang; name: string }[] = [
  { code: "it", name: "Italiano" },
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
];

const dictionaries: Record<Lang, Record<Key, string>> = { it, en, de, fr };
/** Formati dei numeri: virgola decimale in italiano, tedesco e francese; punto in inglese. */
const LOCALES: Record<Lang, string> = { it: "it-IT", en: "en-GB", de: "de-DE", fr: "fr-FR" };
const STORE_KEY = "curlsim.lang";

let lang: Lang = "it";
const listeners = new Set<() => void>();

export function isLang(x: unknown): x is Lang {
  return typeof x === "string" && x in dictionaries;
}

/** Lingua iniziale: quella scelta in precedenza, altrimenti quella del browser, altrimenti l'italiano. */
export function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* memoria del browser non disponibile */
  }
  const prefs = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
  for (const p of prefs) {
    const code = p?.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return "it";
}

export function getLanguage(): Lang {
  return lang;
}

/** Cambia lingua senza ricaricare: aggiorna i testi legati con bindText e avvisa chi si è registrato. */
export function setLanguage(next: string, persist = false): void {
  if (!isLang(next)) return;
  lang = next;
  if (persist) {
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      /* niente */
    }
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const [el, text] of bound) el.textContent = text();
  for (const fn of listeners) fn();
}

/** Registra una funzione da chiamare a ogni cambio di lingua. */
export function onLanguageChange(fn: () => void): void {
  listeners.add(fn);
}

/** Valore di un segnaposto: una funzione si valuta al momento, così segue anch'essa la lingua. */
export type Param = string | number | (() => string);
type Params = Record<string, Param>;

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined ? `{${k}}` : typeof v === "function" ? v() : String(v);
  });
}

/** Traduce una chiave nella lingua corrente sostituendo i segnaposto {nome}. */
export function t(key: Key, params: Params = {}): string {
  return format(dictionaries[lang][key], params);
}

/** Traduce in una lingua precisa: i rapporti per lo sviluppatore restano sempre in italiano. */
export function tIn(l: Lang, key: Key, params: Params = {}): string {
  return format(dictionaries[l][key], params);
}

/** Numero con un numero fisso di decimali, nel formato della lingua corrente. */
export function num(n: number, digits = 2): string {
  return numIn(lang, n, digits);
}

export function numIn(l: Lang, n: number, digits = 2): string {
  return n.toLocaleString(LOCALES[l], { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Testo fisso o calcolato: se calcolato, si ricalcola nella nuova lingua quando la lingua cambia. */
export type Text = string | (() => string);

const bound = new Map<HTMLElement, () => string>();

/** Scrive un testo in un elemento; se è una funzione, l'elemento si aggiorna da solo al cambio di lingua. */
export function bindText(el: HTMLElement, text: Text): void {
  if (typeof text === "function") {
    bound.set(el, text);
    el.textContent = text();
  } else {
    bound.delete(el);
    el.textContent = text;
  }
}

/** Testo tradotto che segue la lingua: i parametri si fissano subito, la traduzione a ogni cambio. */
export function tt(key: Key, params: Params = {}): () => string {
  return () => t(key, params);
}

/** Valore attuale di un Text. */
export function textOf(text: Text): string {
  return typeof text === "function" ? text() : text;
}
