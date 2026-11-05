/**
 * Selettore della lingua nell'intestazione: un pulsante con la bandiera della lingua attuale
 * che apre un piccolo menu di bandiere. Il cambio è immediato, senza ricaricare la pagina.
 */
import { getLanguage, LANGS, setLanguage, t, type Lang } from "../i18n";

let uid = 0;

/** Bandiere disegnate in SVG: le emoji delle bandiere non si vedono su Windows. */
function flag(lang: Lang): string {
  const w = 'width="26" height="18" aria-hidden="true" focusable="false"';
  switch (lang) {
    case "it":
      return `<svg viewBox="0 0 3 2" ${w}><rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>`;
    case "fr":
      return `<svg viewBox="0 0 3 2" ${w}><rect width="1" height="2" fill="#0055a4"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ef4135"/></svg>`;
    case "de":
      return `<svg viewBox="0 0 5 3" ${w}><rect width="5" height="1" fill="#000"/><rect y="1" width="5" height="1" fill="#dd0000"/><rect y="2" width="5" height="1" fill="#ffce00"/></svg>`;
    case "en": {
      const a = `uk-a${++uid}`;
      const b = `uk-b${uid}`;
      return `<svg viewBox="0 0 60 30" ${w}><clipPath id="${a}"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="${b}"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><g clip-path="url(#${a})"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#${b})" stroke="#c8102e" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></g></svg>`;
    }
  }
}

const nameOf = (l: Lang) => LANGS.find((x) => x.code === l)!.name;

export function mountLanguagePicker(root: HTMLElement): { refresh(): void } {
  root.classList.add("lang");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "lang-menu";
  menu.hidden = true;
  for (const { code, name } of LANGS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lang-item";
    item.lang = code;
    item.dataset.lang = code;
    item.title = name;
    item.setAttribute("aria-label", name);
    item.innerHTML = flag(code);
    item.addEventListener("click", () => {
      close();
      if (code !== getLanguage()) setLanguage(code, true);
      btn.focus();
    });
    menu.append(item);
  }
  root.append(btn, menu);

  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    (menu.querySelector<HTMLButtonElement>(`[data-lang="${getLanguage()}"]`) ?? menu.querySelector("button"))?.focus();
  };
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  document.addEventListener("click", (e) => {
    if (!root.contains(e.target as Node)) close();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      close();
      btn.focus();
    }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.hidden) {
      const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
      e.preventDefault();
    }
  });

  const refresh = () => {
    const l = getLanguage();
    btn.innerHTML = flag(l);
    const label = t("lang.choose", { name: nameOf(l) });
    btn.setAttribute("aria-label", label);
    btn.title = label;
    menu.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.lang === l)));
  };
  refresh();
  return { refresh };
}
