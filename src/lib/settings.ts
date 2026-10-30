/* Raspberry — colour settings (B30)
   ---------------------------------------------------------------------------
   One stored record, three consumers:

     · `applyStoredPalette(mode)` writes the resolved custom properties onto
       <html> while the app runs;
     · `SETTINGS_BOOTSTRAP` writes the same properties from a `<script>` in
       `<head>` before the first paint;
     · the settings page edits the record and rewrites both.

   Why the bootstrap does not import the model: a `<script>` in `<head>` runs
   before any module, so it cannot call `paletteVars`. Inlining the HSL maths
   would be ~700 bytes of duplicated arithmetic with its own rounding bugs. So
   each save also writes a small **cache of the custom properties** — and only
   the ones the user actually changed (`overrideVars` filters out anything equal
   to a default). Two consequences worth keeping:

     1. the cache contains no default material at all, so changing a default in
        `palette.ts` can never leave a stale value behind in it;
     2. the bootstrap is a loop over six keys, not a colour library.

   Scope: this is a local, single-user workspace, and the theme it sits next to
   already lives in `localStorage`. Settings follow the browser, not the
   account. If you want them to follow the account instead, this record is the
   only thing that has to move behind the `accounts` table.
*/

import {
  overrideVars,
  paletteVars,
  resolvePalette,
  type PaletteOverride,
  type ThemeMode,
} from "./palette";

export const SETTINGS_STORAGE_KEY = "raspberry.settings.v1";

export type Settings = {
  version: 1;
  palette: PaletteOverride;
  /** Derived. Written on every save, never edited by hand. */
  vars: Record<ThemeMode, Record<string, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  palette: {},
  vars: { dark: {}, light: {} },
};

/** Rebuild the derived cache from the overrides. Pure, and the only place the
 *  cache is produced, so it cannot disagree with `palette`. */
export function withVars(settings: Omit<Settings, "vars">): Settings {
  return {
    ...settings,
    vars: {
      dark: overrideVars(settings.palette, "dark"),
      light: overrideVars(settings.palette, "light"),
    },
  };
}

/** Coerce anything found in storage into a shape the app can use. A settings
 *  record is not worth crashing a workspace over — a corrupt one resets.
 *
 *  `linkHue` is gone from the record (B34) but old saves still carry it. It is
 *  simply not read: unknown keys are ignored, which is the cheapest possible
 *  migration — a user who had unlinked hues gets linked hues back on the next
 *  hue edit, and nothing else about their palette moves. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return withVars(DEFAULT_SETTINGS);
  try {
    const parsed = JSON.parse(raw) as Partial<Settings> | null;
    if (!parsed || typeof parsed !== "object") return withVars(DEFAULT_SETTINGS);
    const palette = (parsed.palette && typeof parsed.palette === "object" ? parsed.palette : {}) as PaletteOverride;
    return withVars({ version: 1, palette });
  } catch {
    return withVars(DEFAULT_SETTINGS);
  }
}

/** The record as text, for the clipboard (B31).
 *
 *  Deliberately the same shape `parseSettings` reads back: that round trip is
 *  the contract, and there is a test for it, because an "export" that cannot be
 *  re-imported is a screenshot with extra steps. Pretty-printed because a human
 *  may read it — and because the settings dialog asks you to copy it to whoever
 *  is being asked to bake new defaults. */
export function serialiseSettings(settings: Settings): string {
  return JSON.stringify({ version: 1, palette: settings.palette }, null, 2);
}

export function readSettings(): Settings {
  if (typeof localStorage === "undefined") return withVars(DEFAULT_SETTINGS);
  try {
    return parseSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return withVars(DEFAULT_SETTINGS);
  }
}

export function storeSettings(settings: Settings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* A full or blocked storage quota must not stop the UI from updating; the
       vars are already applied, only persistence is lost. */
  }
}

/** Apply a theme's custom properties. Only the *overridden* keys are written,
 *  and every key the palette knows about that is not overridden is removed.
 *
 *  Writing the full palette instead would look identical on screen but leave the
 *  document permanently holding values identical to the stylesheet — so "Reset"
 *  could never actually reset, and a future change to a default would never reach
 *  anyone who had once opened this page. Removal is the difference between
 *  "no override" and "an override that happens to match". */
export function applyPalette(mode: ThemeMode, palette: PaletteOverride = readSettings().palette): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const overrides = overrideVars(palette, mode);
  for (const key of Object.keys(paletteVars(resolvePalette({}), mode))) {
    if (key in overrides) root.style.setProperty(key, overrides[key]);
    else root.style.removeProperty(key);
  }
  if (Object.keys(overrides).length) root.dataset.palette = "custom";
  else delete root.dataset.palette;
}

export const applyStoredPalette = (mode: ThemeMode): void => applyPalette(mode, readSettings().palette);

/** Drop every override in this theme and put the stylesheet's own values back. */
export function clearPalette(mode: ThemeMode): void {
  applyPalette(mode, {});
}

/* ---------- pre-paint ---------- */

/** Runs in `<head>`, after `THEME_BOOTSTRAP` has set `data-theme`. Reads the
 *  cached property map for that theme and applies it. Deliberately silent on
 *  every error path: a broken settings record must not stop the app painting. */
export const SETTINGS_BOOTSTRAP = `(function(){try{
var raw=localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)});
if(!raw)return;
var parsed=JSON.parse(raw);
var vars=parsed&&parsed.vars;if(!vars)return;
var theme=document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";
var map=vars[theme];if(!map)return;
var root=document.documentElement;
for(var key in map){if(Object.prototype.hasOwnProperty.call(map,key))root.style.setProperty(key,map[key]);}
root.dataset.palette="custom";
}catch(e){}})();`;
