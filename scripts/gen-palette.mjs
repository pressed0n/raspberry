// Scratch: print the `--palette-*` / accent / checkbox values that `theme.css`
// must carry for the current DEFAULT_PALETTE. Used when the defaults change.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/tmp-gen-palette.mjs
import { DEFAULT_PALETTE, paletteVars, COLOR_NAMES } from "../src/lib/palette.ts";

for (const mode of ["dark", "light"]) {
  const vars = paletteVars(DEFAULT_PALETTE, mode);
  console.log(`--- ${mode} ---`);
  for (const name of COLOR_NAMES) {
    console.log(`  --palette-${name}-text: ${vars[`--palette-${name}-text`]};`);
    console.log(`  --palette-${name}-background: ${vars[`--palette-${name}-background`]};`);
  }
  for (const key of ["--accent", "--accent-strong", "--accent-soft", "--accent-line", "--checkbox"]) {
    console.log(`  ${key}: ${vars[key]};`);
  }
}
