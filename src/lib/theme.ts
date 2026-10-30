/**
 * Theme selection.
 *
 * Dark is the default surface, so `DEFAULT_THEME` is the one place that decision
 * lives. The palette itself is in `src/app/theme.css`; this module only decides
 * which attribute the document carries and remembers the choice.
 *
 * The bootstrap script runs in `<head>` before the first paint. Without it the
 * page paints dark, then flips to light once React hydrates — a visible flash on
 * every load. It is a string rather than a React component so it can be inlined
 * synchronously.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "raspberry-theme";
export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** Reads the stored preference, falling back to the default rather than to the OS. */
export function readTheme(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Private-mode Safari throws on localStorage access. A missing preference is
    // not an error worth surfacing.
    return DEFAULT_THEME;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence is a convenience; the attribute below is the actual behaviour.
  }
}

/**
 * Writes the theme to the document. `color-scheme` is set as well so native
 * widgets — scrollbars, the caret, form controls — follow without extra CSS.
 */
export function applyTheme(theme: Theme): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Inlined in `<head>`. Must stay synchronous and dependency-free. */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t!=="light"&&t!=="dark"){t=${JSON.stringify(
  DEFAULT_THEME,
)};}var r=document.documentElement;r.setAttribute("data-theme",t);r.style.colorScheme=t;}catch(e){}})();`;
