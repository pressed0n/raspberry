/* Raspberry — the colour palette, as data (B30)
   ---------------------------------------------------------------------------
   Why this file exists at all: until now the nine block colours lived only as
   `--bn-colors-highlights-*` hex literals in `globals.css`. A picker needs to
   *move* those values, and you cannot interpolate a hex literal from JavaScript
   without a model behind it. So the palette is defined once here in HSL — hue /
   saturation / lightness, the three axes a person actually reasons about when
   they say "a bit less pink" — and every consumer derives from it:

     · `src/app/globals.css`      static defaults, so first paint needs no JS
     · `src/lib/settings.ts`      writes overrides onto <html> at runtime
     · `src/app/settings/*`       the sliders
     · `prototype/color-lab.html` the standalone tuner

   HSL is the storage format and hex is the output, never the reverse. Round-
   tripping hex → HSL → hex drifts by a unit or two per channel because the
   eight-bit grid is coarser than the degree grid, and a slider that jumps from
   71 to 72 while you drag it feels broken. `DEFAULT_PALETTE` is therefore the
   source of truth and `globals.css` is the projection — `tests/palette.test.ts`
   parses the stylesheet and fails if the two ever disagree, which is the only
   thing standing between us and a flash of the old colours on load.

   Two groups, not three. BlockNote paints a highlight and a callout from the
   same variable pair — `*-background` for the fill, `*-text` for the ink inside
   it — so "highlight colours" and "callout colours" are one editable thing
   here. Pretending otherwise would give the picker two controls that fight over
   one variable.
*/

/** Hue degrees, saturation and lightness percent — all integers. */
export type Hsl = { h: number; s: number; l: number };

/** The nine BlockNote colour names that exist as variables. `default` is not
 *  among them: it means "no colour", and resolves to `--text`. */
export const COLOR_NAMES = [
  "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_LABELS: Record<ColorName, string> = {
  gray: "Gray", brown: "Brown", red: "Red", orange: "Orange", yellow: "Yellow",
  green: "Green", blue: "Blue", purple: "Purple", pink: "Pink",
};

export type ThemeMode = "dark" | "light";
export type ColorGroup = "text" | "background";

export type ThemePalette = {
  text: Record<ColorName, Hsl>;
  background: Record<ColorName, Hsl>;
};

export type Palette = {
  accent: Record<ThemeMode, Hsl>;
  /** Checklist tick. Not derived from the accent: the wishlist asks for a green
   *  tick, and a tick that follows the accent would turn red for anyone who
   *  picked a red accent — which reads as "this item is wrong". */
  checkbox: Record<ThemeMode, Hsl>;
} & Record<ThemeMode, ThemePalette>;

/** Stored shape. Sparse on purpose: only what was touched is written, so a
 *  later change to a default reaches everyone who never overrode that entry. */
export type ThemeOverride = Partial<Record<ColorGroup, Partial<Record<ColorName, Hsl>>>>;
export type PaletteOverride = Partial<{
  accent: Partial<Record<ThemeMode, Hsl>>;
  checkbox: Partial<Record<ThemeMode, Hsl>>;
  dark: ThemeOverride;
  light: ThemeOverride;
}>;

/* ---------- colour maths ---------- */

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** Round to integers and wrap hue. Anything the UI or storage hands us goes
 *  through here, so a corrupted record cannot paint an invalid colour. */
export function normaliseHsl(input: Hsl): Hsl {
  const hue = ((Math.round(clamp(input.h, -3600, 3600)) % 360) + 360) % 360;
  return {
    h: hue,
    s: Math.round(clamp(input.s, 0, 100)),
    l: Math.round(clamp(input.l, 0, 100)),
  };
}

export const isValidHsl = (value: unknown): value is Hsl =>
  typeof value === "object" && value !== null &&
  ["h", "s", "l"].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

/** HSL → `#rrggbb`. The standard piecewise formula, kept whole-channel-rounded
 *  so the output is a colour the browser and the stylesheet agree on. */
export function hslToHex(input: Hsl): string {
  const { h, s, l } = normaliseHsl(input);
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** `#rgb` / `#rrggbb` → HSL. Only used to import literals and by the lab. */
export function hexToHsl(hex: string): Hsl {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { h: 0, s: 0, l: 0 };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return normaliseHsl({ h: hue * 60, s: s * 100, l: l * 100 });
}

/** `rgba()` for the accent's translucent siblings. Alpha is rounded to three
 *  places because `0.12000000000000001` in a stylesheet looks like a bug. */
export function hslToRgba(input: Hsl, alpha: number): string {
  const { h, s, l } = normaliseHsl(input);
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
  };
  return `rgba(${channel(0)}, ${channel(8)}, ${channel(4)}, ${Math.round(alpha * 1000) / 1000})`;
}

/** Shift one axis without touching the others — the operation behind "link the
 *  hue" and behind every slider. */
export function withAxis(input: Hsl, axis: keyof Hsl, value: number): Hsl {
  return normaliseHsl({ ...input, [axis]: value });
}

/* ---------- defaults ---------- */

const DARK_TEXT: Palette["dark"]["text"] = {
  gray: { h: 40, s: 6, l: 74 },
  brown: { h: 24, s: 57, l: 65 },
  red: { h: 0, s: 76, l: 72 },
  orange: { h: 28, s: 88, l: 68 },
  yellow: { h: 46, s: 92, l: 66 },
  green: { h: 145, s: 76, l: 72 },
  blue: { h: 210, s: 100, l: 76 },
  purple: { h: 250, s: 100, l: 81 },
  pink: { h: 326, s: 90, l: 80 },
};

const DARK_BACKGROUND: Palette["dark"]["background"] = {
  gray: { h: 40, s: 6, l: 17 },
  brown: { h: 24, s: 30, l: 14 },
  red: { h: 350, s: 45, l: 19 },
  orange: { h: 26, s: 56, l: 18 },
  yellow: { h: 45, s: 50, l: 17 },
  green: { h: 148, s: 32, l: 16 },
  blue: { h: 210, s: 46, l: 19 },
  purple: { h: 250, s: 40, l: 20 },
  pink: { h: 326, s: 31, l: 19 },
};

const LIGHT_TEXT: Palette["light"]["text"] = {
  gray: { h: 40, s: 5, l: 38 },
  brown: { h: 24, s: 45, l: 36 },
  red: { h: 355, s: 62, l: 42 },
  orange: { h: 26, s: 72, l: 38 },
  yellow: { h: 42, s: 74, l: 32 },
  green: { h: 148, s: 76, l: 32 },
  blue: { h: 212, s: 81, l: 50 },
  purple: { h: 250, s: 71, l: 48 },
  pink: { h: 332, s: 45, l: 60 },
};

const LIGHT_BACKGROUND: Palette["light"]["background"] = {
  gray: { h: 40, s: 8, l: 93 },
  brown: { h: 24, s: 40, l: 84 },
  red: { h: 352, s: 81, l: 89 },
  orange: { h: 26, s: 80, l: 86 },
  yellow: { h: 45, s: 85, l: 88 },
  green: { h: 148, s: 42, l: 85 },
  blue: { h: 212, s: 70, l: 89 },
  purple: { h: 250, s: 72, l: 90 },
  pink: { h: 332, s: 52, l: 91 },
};

export const DEFAULT_PALETTE: Palette = {
  accent: { dark: { h: 0, s: 79, l: 71 }, light: { h: 345, s: 54, l: 43 } },
  checkbox: { dark: { h: 145, s: 52, l: 58 }, light: { h: 148, s: 55, l: 36 } },
  dark: { text: DARK_TEXT, background: DARK_BACKGROUND },
  light: { text: LIGHT_TEXT, background: LIGHT_BACKGROUND },
};

/* ---------- overrides ---------- */

/** Merge stored overrides over the defaults. Always returns a complete palette,
 *  so no consumer has to ask whether a given entry was customised. */
export function resolvePalette(override?: PaletteOverride | null): Palette {
  const palette: Palette = structuredClone(DEFAULT_PALETTE);
  if (!override) return palette;
  for (const mode of ["dark", "light"] as const) {
    const themeOverride = override[mode];
    if (themeOverride) {
      for (const group of ["text", "background"] as const) {
        const entries = themeOverride[group];
        if (!entries) continue;
        for (const name of COLOR_NAMES) {
          const value = entries[name];
          if (isValidHsl(value)) palette[mode][group][name] = normaliseHsl(value);
        }
      }
    }
  }
  for (const key of ["accent", "checkbox"] as const) {
    for (const mode of ["dark", "light"] as const) {
      const value = override[key]?.[mode];
      if (isValidHsl(value)) palette[key][mode] = normaliseHsl(value);
    }
  }
  return palette;
}

/** Record a single entry change.
 *
 *  Hue is always linked across the pair (B34). A block colour is one colour —
 *  ink and fill are two lightnesses of the same hue, and the fill sitting 50
 *  points away from the ink on the wheel is not a thing anyone wants to build.
 *  So a hue edit carries to the sibling group, and there is no way to switch that
 *  off: `linkHue` used to be a checkbox, and a checkbox whose unticked state is
 *  only ever a mistake is a checkbox that should not exist. Saturation and
 *  lightness stay per-group, which is the whole point of the pair.
 *
 *  Only an actual hue *change* propagates. Linking on every edit would mean
 *  dragging saturation also snapped the sibling's hue to this group's — and the
 *  defaults are not hue-matched (red text is 0°, red fill is 350°), so that would
 *  silently rewrite a colour nobody touched. */
export function setEntry(
  override: PaletteOverride,
  mode: ThemeMode,
  name: ColorName,
  group: ColorGroup,
  next: Hsl,
): PaletteOverride {
  const wanted = normaliseHsl(next);
  const patch: PaletteOverride = {
    ...override,
    [mode]: {
      ...override[mode],
      [group]: { ...override[mode]?.[group], [name]: wanted },
    },
  };
  const resolved = resolvePalette(override);
  if (resolved[mode][group][name].h === wanted.h) return patch;
  const sibling: ColorGroup = group === "text" ? "background" : "text";
  if (resolved[mode][sibling][name].h === wanted.h) return patch;
  return {
    ...patch,
    [mode]: {
      ...patch[mode],
      [sibling]: {
        ...patch[mode]?.[sibling],
        [name]: withAxis(resolved[mode][sibling][name], "h", wanted.h),
      },
    },
  };
}

/* ---------- output ---------- */

/** The accent's four siblings, derived rather than stored: raising lightness in
 *  dark and lowering it in light is what makes `strong` read as emphasis on
 *  both surfaces. */
export function accentFamily(accent: Hsl, mode: ThemeMode): Record<string, string> {
  const base = normaliseHsl(accent);
  const strong = withAxis(base, "l", base.l + (mode === "dark" ? 9 : -8));
  return {
    "--accent": hslToHex(base),
    "--accent-strong": hslToHex(strong),
    "--accent-soft": hslToRgba(base, mode === "dark" ? 0.12 : 0.09),
    "--accent-line": hslToRgba(base, mode === "dark" ? 0.42 : 0.35),
  };
}

/** Every custom property one theme needs, ready for `style.setProperty`.
 *
 *  The block colours are emitted as `--palette-*`, not as BlockNote's
 *  `--bn-colors-highlights-*`. `globals.css` declares those deeper names as
 *  aliases *on `.bn-editor`*, and a declaration on an element beats a value
 *  inherited from `:root` — so writing the BlockNote names on the root would be
 *  silently ignored inside the editor. Writing the token it aliases is what makes
 *  one property on `:root` reach every block. */
export function paletteVars(palette: Palette, mode: ThemeMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of COLOR_NAMES) {
    vars[`--palette-${name}-text`] = hslToHex(palette[mode].text[name]);
    vars[`--palette-${name}-background`] = hslToHex(palette[mode].background[name]);
  }
  return {
    ...vars,
    ...accentFamily(palette.accent[mode], mode),
    "--checkbox": hslToHex(palette.checkbox[mode]),
  };
}

/** Only the entries the user actually changed, for the pre-paint script. The
 *  defaults are already in the stylesheet, so shipping them again as JS would
 *  duplicate the table and let it drift. */
export function overrideVars(override: PaletteOverride | null | undefined, mode: ThemeMode): Record<string, string> {
  if (!override) return {};
  const vars = paletteVars(resolvePalette(override), mode);
  const defaults = paletteVars(DEFAULT_PALETTE, mode);
  return Object.fromEntries(
    Object.entries(vars).filter(([key, value]) => defaults[key] !== value),
  );
}

export const isPaletteDefault = (override?: PaletteOverride | null) =>
  !override || Object.keys(overrideVars(override, "dark")).length === 0 &&
    Object.keys(overrideVars(override, "light")).length === 0;
