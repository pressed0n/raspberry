import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The owner's report, verbatim: "It's not vertically in the center of the cell" and "an
   unchecked checkbox has a different position than the checked checkbox".

   Both were one cause and it was not a missing `margin`. The tick was an `inline-grid`
   rendered straight into the `<td>`, so it lived in the cell's *line box*:

     - `vertical-align: top` on the cell put the line box at the top, which left 4px above
       the box and 12px below it;
     - an inline-grid's baseline is the baseline of its contents. Empty, that is the bottom
       edge of the box. Ticked, it is the baseline of the `✓`, some 11px in. So the same
       element drew 2.5px lower once it had a value.

   Neither is visible in a type checker, and neither is visible to a test that renders one
   state. `scripts/verify-db-checkbox.mjs` measures the pixels; this file pins the two
   structural decisions that make those pixels true, because the pixels are only as durable
   as the shape that produced them. */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const editor = read("src/components/database/cell-editor.tsx");
const css = read("src/app/database.css");

/** The checkbox branch of the cell editor — from its `if` to the next one. */
function checkboxBranch(source: string): string {
  const start = source.indexOf('if (property.type === "checkbox")');
  assert.notEqual(start, -1, "cell-editor.tsx no longer has a checkbox branch");
  const end = source.indexOf('if (property.type ===', start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

/** One CSS rule's body, by selector. Throws rather than returning null: a missing rule is a
 *  failure here, and a helper that silently hands back an empty string turns this file into
 *  one that always passes. */
function rule(source: string, selector: string): string {
  const pattern = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(source);
  assert.ok(match, `database.css has no "${selector}" rule`);
  return match[2];
}

test("the cell's tick is a flex item, not a line of text", () => {
  const branch = checkboxBranch(editor);
  assert.match(
    branch,
    /className="db-check-cell"/,
    "the checkbox value is rendered without its wrapper — as an inline-level box it sits on " +
      "the cell's text baseline, which is what made it 4px high and 2.5px lower once ticked",
  );
  /* The wrapper has to be the branch's root: a wrapper *beside* a bare button leaves the bare
     button as the thing in the line box. */
  const beforeButton = branch.slice(0, branch.indexOf("<button"));
  assert.match(beforeButton, /<div className="db-check-cell">/, "the wrapper must open before the button it holds");
  assert.equal(
    (branch.match(/<button/g) ?? []).length,
    1,
    "one button, inside the wrapper — a second one here would be a second control",
  );
});

test("nothing in the stylesheet hands the value tick a layout of its own", () => {
  /* The old rule was `.db-cell > .db-check { margin-left: 10px }`. Positioning the box by a
     margin on the box is how it ended up in the line box at all: the fix has to be about the
     *container*, not about nudging the control. */
  assert.doesNotMatch(
    css,
    /\.db-cell\s*>\s*\.db-check/,
    "a direct-child rule positions the tick from outside its wrapper — the inset now lives on " +
      ".db-check-cell, where the vertical centring is",
  );
  assert.doesNotMatch(
    css,
    /\.db-check[^{]*\{[^}]*vertical-align/,
    "`vertical-align` on the tick aligns a box against a baseline it must not be part of",
  );
});

test("the wrapper centres the tick in the cell's content box", () => {
  const body = rule(css, ".db-check-cell");
  assert.match(body, /display:\s*flex/, "the wrapper must be a flex container, or the tick is inline again");
  assert.match(body, /align-items:\s*center/, "a flex row that does not centre its item does not centre the tick");
  assert.match(
    body,
    /height:\s*100%/,
    "the wrapper must fill the cell's content box — a hard-coded height is a number that goes " +
      "stale the moment the row height or the row's border changes",
  );
  assert.match(body, /padding-left:\s*10px/, "the value inset belongs here, with the centring");
});

test("the gutter's tick keeps its own geometry", () => {
  /* One class, two jobs: a property value (this file) and the row's select box, which is a
     flex item of `.db-gutter-inner` and was already centred. The `.db-check` box itself must
     stay free of host-specific position, or fixing the cell breaks the shelf. */
  const box = rule(css, ".db-check");
  assert.match(box, /width:\s*15px/, "the tick is 15px wide");
  assert.match(box, /height:\s*15px/, "the tick is 15px tall");
  for (const forbidden of ["margin-left", "margin-top", "position", "vertical-align"]) {
    assert.doesNotMatch(
      box,
      new RegExp(forbidden),
      `\`.db-check\` carries \`${forbidden}\` — the shared box is positioned by its host, and a ` +
        "rule here changes the gutter and the cell at once",
    );
  }
});
