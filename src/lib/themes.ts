export const THEME_STORAGE_KEY = "ytdb:theme";
export const DEFAULT_THEME_ID = "dark";

export const THEMES = [
  {
    id: "dark",
    name: "Dark",
    appearance: "dark",
    swatch: "#242424",
    keywords: ["default", "black", "neutral"],
  },
  {
    id: "light",
    name: "Light",
    appearance: "light",
    swatch: "#ffffff",
    keywords: ["day", "white"],
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    appearance: "dark",
    swatch: "#23272e",
    keywords: ["onedark", "atom", "pro"],
  },
  {
    id: "nord",
    name: "Nord",
    appearance: "dark",
    swatch: "#2e3440",
    keywords: ["arctic", "frost", "blue"],
  },
  {
    id: "dracula",
    name: "Dracula",
    appearance: "dark",
    swatch: "#282a36",
    keywords: ["purple", "vampire"],
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    appearance: "dark",
    swatch: "#1a1b26",
    keywords: ["tokyo", "night", "japan"],
  },
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeId = Theme["id"];

const THEME_IDS: ThemeId[] = THEMES.map((theme) => theme.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.includes(value as ThemeId);
}

export function applyTheme(id: ThemeId) {
  const theme = THEMES.find((item) => item.id === id);
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle("dark", theme.appearance === "dark");
}

const LIGHT_THEME_IDS = THEMES.filter((theme) => theme.appearance === "light").map(
  (theme) => theme.id,
);

/** Blocking script so the first paint matches the persisted theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var allowed=${JSON.stringify(THEME_IDS)};var light=${JSON.stringify(LIGHT_THEME_IDS)};var id=${JSON.stringify(DEFAULT_THEME_ID)};var raw=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||localStorage.getItem("db-studio:theme");if(raw){var parsed=JSON.parse(raw);var value=parsed&&parsed.state&&parsed.state.theme;if(typeof value==="string"&&allowed.indexOf(value)!==-1)id=value;}var root=document.documentElement;root.setAttribute("data-theme",id);root.classList.toggle("dark",light.indexOf(id)===-1);}catch(e){}})();`;
