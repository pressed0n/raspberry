// A box that clips must not have a line box shorter than a descender.
//
// THE BUG THIS PINS
// The owner reported, with a screenshot: "the letter g gets cut off at the bottom slightly
// and I suppose similar letters will have the same bug". `.db-tag-name` clips — it needs
// `overflow: hidden` for the ellipsis — and it inherited `line-height: 1` from `.db-tag`,
// which makes the line box exactly one font-size tall (13px) for a font whose ascent plus
// descent is 15px. The bottom 1.5px of every g, j, p, q, y and comma was inside the clip.
//
// WHY IT SURVIVED. `scrollHeight` equalled `clientHeight`, so no DOM check could see it:
// ink overflow is not scrollable overflow. It was only visible by measuring font metrics
// against the clip box, which is what `scripts/verify-text-clip.mjs` does in a real browser
// (1.5px before, 0 after, at 1400x900 and 390x844).
//
// WHY A CSS TEST RATHER THAN ONLY THE PROBE. The probe is the deep evidence, but nothing
// runs it in CI. This fails in `pnpm test`, which every session runs.
//
// WHAT IT CANNOT SEE. Inheritance. A rule that clips and inherits a tight line-height from
// an ancestor is invisible to a text scan — that is exactly how this bug was written. So the
// second test resolves the inherited value for the chip by hand, and the third test forbids
// the shape it came from: a rule that both clips and declares a tight line box.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const css = read("src/app/database.css").replace(/\/\*[\s\S]*?\*\//g, "");
const theme = read("src/app/theme.css");

/** Bodies of every top-level rule whose selector list contains `selector` exactly. */
function rules(sheet: string, selector: string, { nested = false } = {}) {
  const source = nested ? sheet : sheet.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "");
  const bodies: string[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = match[1].split(",").map((part) => part.trim());
    if (list.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

/** The font-size the chip resolves to: `var(--fs-ui)` from the theme, in px. */
function uiFontSize() {
  const declared = /--fs-ui:\s*([^;]+);/.exec(theme)?.[1]?.trim();
  assert.ok(declared, "--fs-ui must be declared in theme.css");
  if (declared.startsWith("var(")) return uiFontSize();
  const px = /^([\d.]+)px$/.exec(declared);
  assert.ok(px, `--fs-ui must be a px length, got ${declared}`);
  return Number(px[1]);
}

/** line-height / font-size as a ratio, from `line-height:` or a `font:` shorthand's `/ n`. */
function ratio(bodies: string[], fontSize: number): { ratio: number; from: string } | null {
  for (const body of bodies.reverse()) {
    const lh = /(?:^|;|\s)line-height\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (lh) {
      if (lh === "normal") return { ratio: Number.POSITIVE_INFINITY, from: `line-height: ${lh}` };
      if (/^[\d.]+$/.test(lh)) return { ratio: Number(lh), from: `line-height: ${lh}` };
      const px = /^([\d.]+)px$/.exec(lh);
      if (px) return { ratio: Number(px[1]) / fontSize, from: `line-height: ${lh}` };
    }
    const shorthand = /(?:^|;|\s)font\s*:\s*([^;]+)/.exec(body)?.[1];
    const slash = shorthand && /\d(?:px|rem)?\s*\/\s*([^\s;]+)/.exec(shorthand)?.[1];
    if (slash) {
      if (slash === "normal") return { ratio: Number.POSITIVE_INFINITY, from: `font: … / ${slash}` };
      if (/^[\d.]+$/.test(slash)) return { ratio: Number(slash), from: `font: … / ${slash}` };
    }
  }
  return null;
}

/* Inter's ascent + descent is 1.21em and Segoe UI's is 1.33em, so a line box under ~1.15em
   cannot hold a descender in either. The chip uses 1.4. */
const MINIMUM = 1.15;

test("the tag chip's name leaves room for a descender", () => {
  const fontSize = uiFontSize();
  const own = rules(css, ".db-tag-name");
  assert.ok(own.length > 0, ".db-tag-name must exist — the chip's name is what clips");

  /* Own declaration first; otherwise it inherits `.db-tag`'s shorthand, which is the exact
     value that cut the g: `font: 500 var(--fs-ui) / 1 var(--font-ui)`. */
  const inherited = rules(css, ".db-tag");
  const effective = ratio([...inherited, ...own], fontSize);

  assert.ok(effective, ".db-tag-name must resolve to a line-height");
  assert.ok(
    effective.ratio >= MINIMUM,
    `the chip's line box is ${effective.ratio.toFixed(2)}em (${effective.from}): a descender ` +
      `needs ~1.2em, so overflow: hidden will slice the bottom off g, j, p, q and y — ` +
      `measured at 1.5px in the browser by scripts/verify-text-clip.mjs`,
  );
});

test("the chip still clips, so long names still ellipsise", () => {
  /* The tempting wrong fix is to delete `overflow: hidden`. That stops the cut and starts a
     name painting outside its chip. The fix has to be the line box. */
  const body = rules(css, ".db-tag-name").join(";");
  assert.match(body, /overflow\s*:\s*hidden/, ".db-tag-name must keep overflow: hidden");
  assert.match(body, /text-overflow\s*:\s*ellipsis/, ".db-tag-name must keep its ellipsis");
});

test("no rule both clips and declares a line box too short for a descender", () => {
  /* The shape the bug came from, checked everywhere it could appear next. Vertical padding
     buys the room back, so a padded rule is allowed. */
  const findings: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const body = match[2];
    if (!/overflow(?:-[xy])?\s*:\s*(hidden|clip)/.test(body)) continue;
    const padded = /padding(?:-top|-bottom)?\s*:\s*[^;]*?\b[1-9][\d.]*px/.test(body);

    const shorthand = /(?:^|;|\s)font\s*:\s*([^;]+)/.exec(body)?.[1];
    const slash = shorthand && /\d(?:px|rem)?\s*\/\s*([^\s;]+)/.exec(shorthand)?.[1];
    const declared = /(?:^|;|\s)line-height\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    const value = declared ?? (slash && /^[\d.]+$/.test(slash) ? slash : undefined);
    if (value == null) continue;
    if (value === "normal") continue;
    const asRatio = /^[\d.]+$/.test(value) ? Number(value) : null;
    if (asRatio == null) continue;
    if (asRatio >= MINIMUM) continue;
    if (padded) continue;
    findings.push(`${selector} clips with line-height ${value}`);
  }

  assert.deepEqual(
    findings,
    [],
    `these rules clip their own text and give the line box no descender room: ${findings.join("; ")}`,
  );
});
