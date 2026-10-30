import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* The owner's complaint, twice over: "You STILL did not re-use the 6 dot grip and plus
   components that are already established ... Why are you constantly redoing them
   instead of using what is already established."

   A DOM test cannot catch a copy that happens to be pixel-perfect today. This is a
   source test: the pair is *defined once* and *rendered from one place*, and the day
   someone types `className="frame-anchor"` into a second file, this fails by name
   rather than by screenshot three sessions later. */

const ROOT = process.cwd();
const SOURCE_DIRS = ["src"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) walk(relative(ROOT, full), out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(dir));
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Files whose *markup* renders the pair — the class as a JSX attribute. */
const rendersPair = files.filter((file) => /className=\{?"frame-anchor|className=\{`frame-anchor/.test(read(file)));
/** Files that draw either glyph themselves. */
const usesGlyphs = files.filter((file) => /from "@\/components\/grip-glyphs"/.test(read(file))).sort();
/** Files that draw the *grip*. A grip outside `FrameAnchor` is a rebuilt pair. */
const usesGrip = files.filter((file) => /\bGripGlyph\b/.test(read(file))).sort();

test("the `+`-and-grip pair is rendered from exactly one component", () => {
  assert.deepEqual(rendersPair, ["src/components/frame-anchor.tsx"],
    "a second file renders `.frame-anchor` — reuse the component, do not redraw it");
});

test("the grip is drawn in exactly one place", () => {
  /* `GripGlyph` beside a `+` *is* the pair, so a second file drawing it is a second pair.
     A lone `AddGlyph` is not: it is the app's plus in a host that wants a plus, which is
     what `AGENTS.md` asks for — reuse the glyph rather than reaching for lucide's. So the
     grip is what is pinned here. */
  assert.deepEqual(usesGrip, ["src/components/frame-anchor.tsx", "src/components/grip-glyphs.tsx"],
    "a third file draws the grip — that is a copy of the pair, not a use of it");
});

test("the glyph module has exactly the consumers we have decided on", () => {
  /* A deliberate list rather than a count: a new consumer is a new decision, and it should
     fail here until someone says out loud that it is the same vocabulary.

       frame-anchor.tsx        the pair itself
       add-property-menu.tsx   `+ Add property` — a plus and a label, no grip */
  assert.deepEqual(usesGlyphs, [
    "src/components/database/add-property-menu.tsx",
    "src/components/frame-anchor.tsx",
  ], "the glyphs are imported somewhere new — reuse them, or add the file to this list on purpose");
  assert.doesNotMatch(read("src/components/database/add-property-menu.tsx"), /GripGlyph/,
    "the add-property control is a plus and a label, not a second grip");
});

test("the object menu renders the pair rather than its own copy", () => {
  const menu = read("src/components/editor/object-menu.tsx");
  assert.match(menu, /<FrameAnchor/, "the editor's object menu must render <FrameAnchor>");
  assert.doesNotMatch(menu, /className=\{?[`"][^`"]*frame-grip/,
    "the object menu declares a grip class of its own — the pair owns its buttons");
});

test("the database row renders the pair rather than its own copy", () => {
  const table = read("src/components/database/table-view.tsx");
  assert.match(table, /<FrameAnchor/, "the row gutter must render <FrameAnchor>");
  assert.doesNotMatch(table, /frame-grip/, "the row styles no grip of its own");
  /* The copies this replaced. If one comes back, it came back with its own class. */
  assert.doesNotMatch(table, /db-pair|db-plus/, "a hand-rolled pair is creeping back in");
});

test("the database stylesheet does not re-declare the pair", () => {
  const css = read("src/app/database.css");
  assert.doesNotMatch(css, /\.db-pair\b/, "the removed hand-rolled pair came back");
  assert.doesNotMatch(css, /\.db-plus\b/, "the removed hand-rolled plus came back");
  /* Only the cursor and its states are the gutter's business; everything visible about a
     grip — size, colour, hover, transition — belongs to `.frame-grip` in editor-blocks.css. */
  const gripRules = [...css.matchAll(/^([^{}\n]*\.frame-grip[^{}\n]*)\{([^}]*)\}/gm)];
  for (const [, selector, body] of gripRules) {
    for (const forbidden of ["width", "height", "background", "opacity", "border-radius", "transition", "color"]) {
      assert.ok(!new RegExp(`(^|;|\\s)${forbidden}\\s*:`).test(body),
        `${selector.trim()} re-declares \`${forbidden}\` on the shared grip — that is how the two pairs drifted apart`);
    }
  }
});

test("the gutter never becomes a column, at any width", () => {
  const css = read("src/app/database.css");
  /* The bug this guards, in its three historical shapes:

       1. the gutter was a 60px first column — the grid started 60px right of every other
          block on the page;
       2. below 860px the shelf docked *inside* the row and the Name cell took a 58px
          inset — the table's edge stopped moving, but every entry's text still started
          under the buttons, which is the indent, and on a phone the controls it made room
          for could not be hovered at all;
       3. `--db-borrow: 0` under the same query — the controls were then clipped by the
          wrap instead of being laid out somewhere they did not fit.

     So all three numbers are declared exactly once and no media query may touch them. What
     pays for the shelf is the *page's* margin — `.doc:has(.db-block)` — because the one
     thing that must never move is the grid's left edge. */
  assert.equal([...css.matchAll(/--db-shelf\s*:/g)].length, 1, "--db-shelf must be declared exactly once");
  assert.equal([...css.matchAll(/--db-col\s*:/g)].length, 1, "--db-col must be declared exactly once");
  assert.equal([...css.matchAll(/--db-borrow\s*:/g)].length, 1, "--db-borrow must be declared exactly once");

  /* No media query may re-declare geometry. Only `(hover: none)` remains, and it may only
     turn a hidden control visible. */
  const mediaBlocks = [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[0]);
  for (const block of mediaBlocks) {
    assert.doesNotMatch(block, /--db-shelf\s*:/, "a media query changed the shelf's width");
    assert.doesNotMatch(block, /--db-col\s*:/, "a media query changed the gutter back into a column");
    assert.doesNotMatch(block, /--db-borrow\s*:/, "a media query changed the borrowed margin");
    assert.doesNotMatch(block, /db-name-cell|db-th-label/, "a media query indented a cell to make room for the controls");
  }

  /* And the margin is the page's, at every width: not a breakpoint, not a media query. */
  const doc = css.match(/\.doc:has\(\.db-block\)\s*\{([^}]*)\}/);
  assert.ok(doc, "the page has to pay for the shelf: `.doc:has(.db-block)` is missing");
  assert.match(doc[1], /padding-inline:\s*var\(--db-shelf\)/, "the page must widen to the shelf, not the cell");
  assert.match(doc[1], /max-width:\s*calc\(/, "the box grows so the measure stays put");
});
