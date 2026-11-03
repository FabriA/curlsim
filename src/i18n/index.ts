import { it, type Key } from "./it";

const dictionaries: Record<string, Record<Key, string>> = { it };
let current: Record<Key, string> = it;

export function setLanguage(lang: string): void {
  current = dictionaries[lang] ?? it;
}

/** Traduce una chiave sostituendo i segnaposto {nome}. */
export function t(key: Key, params: Record<string, string | number> = {}): string {
  return current[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** Formato numerico italiano con un numero fisso di decimali. */
export function num(n: number, digits = 2): string {
  return n.toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
