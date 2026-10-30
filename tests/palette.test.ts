import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COLOR_NAMES,
  DEFAULT_PALETTE,
  accentFamily,
  hexToHsl,
  hslToHex,
  hslToRgba,
  isPaletteDefault,
  isValidHsl,
  normaliseHsl,
  overrideVars,
  paletteVars,
  resolvePalette,
  setEntry,
  withAxis,
  type Hsl,
} from "../src/lib/palette";
import { DEFAULT_SETTINGS, parseSettings, serialiseSettings, withVars } from "../src/lib/settings";

const CHANNELS = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("hslToHex matches known anchors", () => {
  assert.equal(hslToHex({ h: 0, s: 100, l: 50 }), "#ff0000");
  assert.equal(hslToHex({ h: 120, s: 100, l: 50 }), "#00ff00");
  assert.equal(hslToHex({ h: 240, s: 100, l: 50 }), "#0000ff");
  assert.equal(hslToHex({ h: 0, s: 0, l: 0 }), "#000000");
  assert.equal(hslToHex({ h: 0, s: 0, l: 100 }), "#ffffff");
  assert.equal(hslToHex({ h: 0, s: 0, l: 50 }), "#808080");
});

test("hslToHex wraps hue and clamps saturation and lightness", () => {
  assert.equal(hslToHex({ h: 360, s: 100, l: 50 }), hslToHex({ h: 0, s: 100, l: 50 }));
  assert.equal(hslToHex({ h: -120, s: 100, l: 50 }), hslToHex({ h: 240, s: 100, l: 50 }));
  assert.equal(hslToHex({ h: 0, s: 500, l: 50 }), "#ff0000");
  assert.equal(hslToHex({ h: 0, s: -20, l: 50 }), "#808080");
  assert.equal(hslToHex({ h: 0, s: 100, l: 500 }), "#ffffff");
});

test("normaliseHsl rounds to integers so sliders cannot emit fractions", () => {
  assert.deepEqual(normaliseHsl({ h: 12.6, s: 40.4, l: 60.5 }), { h: 13, s: 40, l: 61 });
  assert.deepEqual(normaliseHsl({ h: 720, s: 0, l: 0 }), { h: 0, s: 0, l: 0 });
  assert.deepEqual(normaliseHsl({ h: Number.NaN, s: Number.NaN, l: Number.NaN }), { h: 0, s: 0, l: 0 });
});

test("isValidHsl rejects partial and non-finite records", () => {
  assert.equal(isValidHsl({ h: 1, s: 2, l: 3 }), true);
  assert.equal(isValidHsl({ h: 1, s: 2 }), false);
  assert.equal(isValidHsl({ h: 1, s: 2, l: Number.POSITIVE_INFINITY }), false);
  assert.equal(isValidHsl({ h: "1", s: 2, l: 3 }), false);
  assert.equal(isValidHsl(null), false);
});

test("every palette colour survives hex -> hsl -> hex within a channel step", () => {
  // HSL is a coarser grid than eight-bit RGB, so a round trip through hex can
  // land one unit off per channel. That is invisible; two would not be.
  for (const mode of ["dark", "light"] as const) {
    for (const group of ["text", "background"] as const) {
      for (const name of COLOR_NAMES) {
        const hex = hslToHex(DEFAULT_PALETTE[mode][group][name]);
        const back = hslToHex(hexToHsl(hex));
        for (const [i, a] of CHANNELS(hex).entries()) {
          assert.ok(Math.abs(a - CHANNELS(back)[i]) <= 1, `${mode}/${group}/${name} drifted: ${hex} -> ${back}`);
        }
      }
    }
  }
});

test("hslToRgba keeps the same channel maths as hslToHex", () => {
  const rgba = hslToRgba({ h: 346, s: 79, l: 71 }, 0.12);
  assert.match(rgba, /^rgba\(\d+, \d+, \d+, 0\.12\)$/);
  const [r, g, b] = rgba.match(/\d+/g)!.map(Number);
  assert.deepEqual([r, g, b], CHANNELS(hslToHex({ h: 346, s: 79, l: 71 })));
});

test("withAxis moves one axis and leaves the others", () => {
  assert.deepEqual(withAxis({ h: 10, s: 50, l: 50 }, "h", 200), { h: 200, s: 50, l: 50 });
  assert.deepEqual(withAxis({ h: 10, s: 50, l: 50 }, "l", 70), { h: 10, s: 50, l: 70 });
});

test("resolvePalette returns a complete palette for no overrides", () => {
  const palette = resolvePalette();
  assert.deepEqual(palette, DEFAULT_PALETTE);
  assert.equal(Object.keys(palette.dark.text).length, COLOR_NAMES.length);
});

test("resolvePalette merges an override without mutating the defaults", () => {
  const before = structuredClone(DEFAULT_PALETTE);
  const palette = resolvePalette({ dark: { text: { red: { h: 10, s: 20, l: 30 } } } });
  assert.deepEqual(palette.dark.text.red, { h: 10, s: 20, l: 30 });
  assert.deepEqual(palette.dark.text.blue, DEFAULT_PALETTE.dark.text.blue);
  assert.deepEqual(palette.light.text.red, DEFAULT_PALETTE.light.text.red);
  assert.deepEqual(DEFAULT_PALETTE, before);
});

test("resolvePalette ignores malformed entries instead of painting them", () => {
  const palette = resolvePalette({
    dark: { text: { red: { h: Number.NaN, s: 1, l: 1 } as Hsl, blue: { s: 5 } as Hsl } },
  });
  assert.deepEqual(palette.dark.text.red, DEFAULT_PALETTE.dark.text.red);
  assert.deepEqual(palette.dark.text.blue, DEFAULT_PALETTE.dark.text.blue);
});

test("setEntry always carries the hue, and only the hue, to the sibling", () => {
  const next = setEntry({}, "dark", "blue", "text", { h: 120, s: 90, l: 70 });
  const palette = resolvePalette(next);
  assert.equal(palette.dark.text.blue.h, 120);
  assert.equal(palette.dark.background.blue.h, 120);
  // Saturation and lightness belong to the group: a fill at text lightness would
  // be unreadable, and vice versa.
  assert.equal(palette.dark.background.blue.s, DEFAULT_PALETTE.dark.background.blue.s);
  assert.equal(palette.dark.background.blue.l, DEFAULT_PALETTE.dark.background.blue.l);
});

test("the hue link cannot be opted out of — a fill edit moves the ink too", () => {
  // B34 deleted the `linkHue` flag. There is no argument to pass and no stored
  // field to read, so the sibling follows in both directions, always.
  const next = setEntry({}, "dark", "green", "background", { h: 300, s: 40, l: 18 });
  const palette = resolvePalette(next);
  assert.equal(palette.dark.background.green.h, 300);
  assert.equal(palette.dark.text.green.h, 300);
});

test("setEntry leaves the sibling alone for a non-hue edit", () => {
  // The defaults are not hue-matched (red text is 0°, red fill is 350°), so
  // propagating on every edit would rewrite a colour nobody touched.
  const next = setEntry({}, "dark", "blue", "text", withAxis(DEFAULT_PALETTE.dark.text.blue, "s", 40));
  assert.equal(next.dark?.background, undefined);
});

test("setEntry does not touch the other theme", () => {
  const next = setEntry({}, "light", "pink", "background", { h: 10, s: 20, l: 30 });
  assert.equal(next.dark, undefined);
  assert.equal(next.light?.background?.pink?.h, 10);
});

test("paletteVars covers every variable the stylesheet defines", () => {
  const vars = paletteVars(DEFAULT_PALETTE, "dark");
  for (const name of COLOR_NAMES) {
    assert.match(vars[`--palette-${name}-text`], /^#[0-9a-f]{6}$/);
    assert.match(vars[`--palette-${name}-background`], /^#[0-9a-f]{6}$/);
  }
  assert.match(vars["--accent"], /^#[0-9a-f]{6}$/);
  assert.match(vars["--accent-strong"], /^#[0-9a-f]{6}$/);
  assert.match(vars["--accent-soft"], /^rgba\(/);
  assert.match(vars["--accent-line"], /^rgba\(/);
  assert.match(vars["--checkbox"], /^#[0-9a-f]{6}$/);
  assert.equal(Object.keys(vars).length, COLOR_NAMES.length * 2 + 5);
});

test("accentFamily emphasises upward in dark and downward in light", () => {
  const base = { h: 200, s: 50, l: 50 };
  const dark = hexToHsl(accentFamily(base, "dark")["--accent-strong"]);
  const light = hexToHsl(accentFamily(base, "light")["--accent-strong"]);
  assert.ok(dark.l > base.l, `dark strong should be lighter: ${dark.l}`);
  assert.ok(light.l < base.l, `light strong should be darker: ${light.l}`);
  assert.equal(dark.h, base.h);
});

test("overrideVars emits nothing for a palette that matches the defaults", () => {
  assert.deepEqual(overrideVars({}, "dark"), {});
  assert.deepEqual(overrideVars(null, "light"), {});
  // Writing a default value explicitly is not a customisation.
  assert.deepEqual(
    overrideVars({ dark: { text: { red: DEFAULT_PALETTE.dark.text.red } } }, "dark"),
    {},
  );
  assert.equal(isPaletteDefault({ dark: { text: { red: DEFAULT_PALETTE.dark.text.red } } }), true);
});

test("overrideVars emits only the changed keys, plus accent siblings", () => {
  const vars = overrideVars({ dark: { text: { red: { h: 120, s: 80, l: 60 } } } }, "dark");
  assert.equal(vars["--palette-red-text"], hslToHex({ h: 120, s: 80, l: 60 }));
  // Only the overridden half is cached. The link is applied by `setEntry` when a
  // hue moves, not by the cache filter — a record that stored a fill the user never
  // touched would make "reset" and "default" disagree.
  assert.equal(vars["--palette-red-background"], undefined);
  assert.equal(Object.keys(vars).length, 1);

  const accent = overrideVars({ accent: { dark: { h: 200, s: 60, l: 60 } } }, "dark");
  assert.deepEqual(
    Object.keys(accent).sort(),
    ["--accent", "--accent-line", "--accent-soft", "--accent-strong"],
  );
});

/* ---------- the stylesheet must not drift ---------- */

const readCss = (file: string) =>
  readFileSync(resolve(import.meta.dirname, "..", "src", "app", file), "utf8");

const blockFor = (css: string, selector: string) => {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
};

test("globals.css maps BlockNote's names onto the palette tokens, never literals", () => {
  const css = readCss("globals.css");
  for (const mode of ["dark", "light"] as const) {
    const block = blockFor(css, `:root[data-theme="${mode}"],`);
    for (const name of COLOR_NAMES) {
      for (const group of ["text", "background"] as const) {
        const key = `--bn-colors-highlights-${name}-${group}`;
        // A literal here is the bug this test exists for: it would shadow every
        // custom palette written to `:root`, because the editor element declares
        // it too and a declaration beats inheritance.
        const found = block.match(new RegExp(`${key}:\\s*var\\((--palette-[a-z-]+)\\)`));
        assert.ok(found, `${mode}: ${key} must alias a --palette-* token`);
        assert.equal(found![1], `--palette-${name}-${group}`);
      }
    }
    assert.doesNotMatch(block, /--bn-colors-highlights-[a-z-]+:\s*#/, `${mode}: a literal hex crept back in`);
  }
});

test("theme.css carries the palette, accent and checkbox defaults", () => {
  const css = readCss("theme.css");
  const darkBlock = css.slice(css.indexOf(":root {"), css.indexOf('}'));
  for (const mode of ["dark", "light"] as const) {
    const vars = paletteVars(DEFAULT_PALETTE, mode);
    const block = mode === "dark" ? darkBlock : blockFor(css, '[data-theme="light"] {');
    for (const name of COLOR_NAMES) {
      for (const group of ["text", "background"] as const) {
        const key = `--palette-${name}-${group}`;
        const found = block.match(new RegExp(`${key}:\\s*(#[0-9a-fA-F]{6})`));
        assert.ok(found, `${mode}: ${key} missing from theme.css`);
        assert.equal(found![1].toLowerCase(), vars[key], `${mode}: ${key} drifted from palette.ts`);
      }
    }
    for (const key of ["--accent", "--accent-strong", "--checkbox"]) {
      const found = block.match(new RegExp(`${key}:\\s*(#[0-9a-fA-F]{6})`));
      assert.ok(found, `${mode}: ${key} missing from theme.css`);
      assert.equal(found![1].toLowerCase(), vars[key], `${mode}: ${key} drifted from palette.ts`);
    }
  }
});


/* ---------- storage ---------- */

test("parseSettings falls back to defaults for junk", () => {
  assert.deepEqual(parseSettings(null).palette, {});
  assert.deepEqual(parseSettings("{not json").palette, {});
  assert.deepEqual(parseSettings('"a string"').palette, {});
  assert.deepEqual(parseSettings("null").palette, {});
});

test("parseSettings keeps overrides and ignores a legacy link flag", () => {
  // Records written before B34 still carry `linkHue`. It is dropped on read — the
  // link is no longer optional, so the flag has nothing left to mean.
  const settings = parseSettings(
    JSON.stringify({ version: 1, palette: { dark: { text: { red: { h: 1, s: 2, l: 3 } } } }, linkHue: false }),
  );
  assert.deepEqual(settings.palette.dark?.text?.red, { h: 1, s: 2, l: 3 });
  assert.ok(!("linkHue" in settings));
  assert.deepEqual(settings.vars.dark["--palette-red-text"], hslToHex({ h: 1, s: 2, l: 3 }));
});

test("withVars rebuilds the pre-paint cache from overrides alone", () => {
  const settings = withVars({ version: 1, palette: {} });
  assert.deepEqual(settings.vars, { dark: {}, light: {} });
  assert.deepEqual(DEFAULT_SETTINGS.vars, { dark: {}, light: {} });
});

/* ---------- the record you can copy (B31) ---------- */

test("serialiseSettings round-trips through parseSettings", () => {
  // The dialog's "Copy record" button is only honest if what it copies can be
  // read back — a record that does not survive this is a screenshot with extra
  // steps.
  const original = withVars({
    version: 1,
    palette: {
      dark: { text: { red: { h: 12, s: 34, l: 56 } } },
      light: { background: { blue: { h: 210, s: 60, l: 92 } } },
      accent: { dark: { h: 300, s: 44, l: 66 } },
    },
  });
  const copy = parseSettings(serialiseSettings(original));
  assert.deepEqual(copy.palette, original.palette);
  assert.deepEqual(copy.vars, original.vars);
});

test("serialiseSettings writes only the record, not the derived vars", () => {
  // `vars` is a cache of `palette`; storing it would let the two disagree.
  const text = serialiseSettings(withVars({ version: 1, palette: { dark: { text: { red: { h: 1, s: 2, l: 3 } } } } }));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["palette", "version"]);
  assert.ok(!text.includes("vars"));
});
