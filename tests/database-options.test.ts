import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionIdsOf, optionsOf } from "../src/lib/database/property-types/shared";
import type { CellValue } from "../src/lib/database/types";

/* Tags — Select, Multi-select and Status.
   ---------------------------------------------------------------------------
   Three bugs, three sets of assertions. Each of these shipped, looked fine, and cost an
   afternoon; the browser probe (`scripts/verify-db-tags.mjs`) proves the behaviour end to
   end, and this file pins the two things that are cheapest to break again: how a cell's
   value is read back, and whether the panel is wired to its dismissal at all. */

const config = {
  options: [
    { id: "opt-alpha", name: "Alpha", color: "orange", groupId: null },
    { id: "opt-beta", name: "Beta", color: "purple", groupId: null },
  ],
};

/* THE BUG THIS FILE EXISTS FOR.
   `select` and `status` store one id as a bare string; only `multiSelect` stores a list.
   `optionIdsOf` used to run everything through `asList`, which answers [] for anything that
   is not an array — so every single-select cell read as "nothing selected". The chip never
   appeared, the cell looked empty, and the panel could not tick the option that was already
   set. It was invisible in review because the *stored* value was correct the whole time. */
test("a single-select cell stores one bare id, and reads back as one", () => {
  assert.deepEqual(optionIdsOf("opt-alpha", config), ["opt-alpha"]);
});

test("a multi-select cell stores a list, and keeps its order", () => {
  assert.deepEqual(optionIdsOf(["opt-beta", "opt-alpha"], config), ["opt-beta", "opt-alpha"]);
});

test("an empty cell reads back as nothing selected", () => {
  const empties: CellValue[] = [null, "", []];
  for (const empty of empties) {
    assert.deepEqual(optionIdsOf(empty, config), [], `value ${String(JSON.stringify(empty))}`);
  }
  // A cell can be absent from `row.cells` altogether, and the table passes that through.
  // `CellValue` does not include `undefined`, so this is the one case that needs the cast —
  // making it a cast keeps the other three honest.
  assert.deepEqual(optionIdsOf(undefined as unknown as CellValue, config), []);
});

test("an id that is not in the config resolves to nothing", () => {
  // A cell left pointing at a deleted option must not render a phantom tag.
  assert.deepEqual(optionIdsOf("opt-gone", config), []);
  assert.deepEqual(optionIdsOf(["opt-gone", "opt-alpha"], config), ["opt-alpha"]);
});

test("a tag typed as its name still resolves, because a filter operand can be a label", () => {
  assert.deepEqual(optionIdsOf("Alpha", config), ["opt-alpha"]);
});

test("optionsOf drops entries that are not options", () => {
  const messy = { options: [{ id: "opt-a", name: "A" }, { name: "no id" }, null, "nope"] };
  assert.deepEqual(optionsOf(messy).map((option) => option.id), ["opt-a"]);
});

/* THE SECOND BUG: a panel that cannot be dismissed.
   `MenuSurface` places a surface and nothing else — dismissal is the caller's job, and every
   other menu in the app pairs it with `useMenuDismiss`. The tag panel was written without
   it, so a press on the page did nothing: the menu could only be closed by pressing its own
   trigger again, and the next click landed on the surface instead of the cell behind it.
   That is why this is a test and not a comment. */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the tag panel registers its own dismissal", () => {
  const panel = source("../src/components/database/option-panel.tsx");
  const calls = panel.match(/useMenuDismiss\(/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `the cell panel and the option's colour panel both need it; found ${calls.length} call(s)`,
  );
  assert.match(panel, /import \{[^}]*useMenuDismiss[^}]*\} from "\.\/menu"/, "imported from the shared primitive");
});

test("no cell is a native <select> any more", () => {
  // A `<select>` can only choose from options that already exist: no creating a tag, no
  // colouring one, and on multi-select no keeping more than one. Comments are stripped
  // first, because this file's own explanation of the bug mentions the element by name.
  const editor = source("../src/components/database/cell-editor.tsx")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/<select[\s>]/.test(editor), "the select element is gone from the cell editor");
  assert.match(editor, /<OptionCell/, "the tag control replaced it");
});

/* THE THIRD BUG: a submenu placed past the bottom of the window.
   `menuStyle`'s side placement reserved a flat 120px for the submenu's height. The colour
   list is 408px, so on a 1440x900 window its lower half sat below the fold — the last
   colours could not be clicked at all, because a point outside the viewport hits nothing.
   `menuStyle` reads `window`, so it is exercised with a stub. */
test("a side submenu is never placed so tall that it leaves the window", async () => {
  const stub = (innerWidth: number, innerHeight: number) => {
    (globalThis as { window?: unknown }).window = { innerWidth, innerHeight };
  };
  stub(1378, 802);
  try {
    const { menuStyle } = await import("../src/components/database/menu");
    /* The ⋯ of the third option row in a panel that is already near the bottom. */
    const anchor = { top: 576, bottom: 600, left: 1040, right: 1064, width: 24, height: 24 } as DOMRect;
    const style = menuStyle(anchor, 252, 460, "right");
    const top = Number(style.top);
    const maxHeight = Number(style.maxHeight);
    assert.ok(top >= 0, `top ${top} must not be negative`);
    assert.ok(
      top + maxHeight <= 802,
      `a ${maxHeight}px panel at ${top} runs to ${top + maxHeight}, past the 802px viewport`,
    );
    assert.ok(maxHeight >= 160, `a panel clamped to ${maxHeight}px is not usable`);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("a side submenu with room below still tracks its row", async () => {
  (globalThis as { window?: unknown }).window = { innerWidth: 1378, innerHeight: 802 };
  try {
    const { menuStyle } = await import("../src/components/database/menu");
    const anchor = { top: 100, bottom: 124, left: 300, right: 324, width: 24, height: 24 } as DOMRect;
    const style = menuStyle(anchor, 252, 460, "right");
    assert.equal(Number(style.top), 96, "4px above the row's top edge, as before");
    assert.equal(Number(style.maxHeight), 460, "the full cap, because it fits");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

/* THE REORDER, which is a grip to drag and two menu items for everyone who cannot drag.
   ---------------------------------------------------------------------------
   The splice is the part that goes wrong silently: a list reordered one place off is
   still a list of four tags, and no screenshot can tell you it is wrong. So the move is a
   pure function and these are its cases, not a comment saying it works. Four ids, never
   two: with two, "moved down one" and "swapped" are the same array. */
const IDS = ["gamma", "alpha", "delta", "beta"];

test("a drag downwards lands the tag *after* the one it was dropped on", async () => {
  const { moveRelative } = await import("../src/lib/database/order");
  assert.deepEqual(moveRelative(IDS, "gamma", "delta"), ["alpha", "delta", "gamma", "beta"]);
  // The end of the list, which is where an off-by-one would run off the array.
  assert.deepEqual(moveRelative(IDS, "gamma", "beta"), ["alpha", "delta", "beta", "gamma"]);
});

test("a drag upwards lands the tag *before* the one it was dropped on", async () => {
  const { moveRelative } = await import("../src/lib/database/order");
  assert.deepEqual(moveRelative(IDS, "beta", "alpha"), ["gamma", "beta", "alpha", "delta"]);
  assert.deepEqual(moveRelative(IDS, "beta", "gamma"), ["beta", "gamma", "alpha", "delta"]);
});

test("a move that goes nowhere writes nothing", async () => {
  const { moveBySteps, moveRelative } = await import("../src/lib/database/order");
  // A press on the grip that never moved, and a drop back on its own row: `null` is what
  // stops the panel sending a config write it did not need.
  assert.equal(moveRelative(IDS, "alpha", "alpha"), null);
  assert.equal(moveRelative(IDS, "nope", "alpha"), null);
  assert.equal(moveRelative(IDS, "alpha", "nope"), null);
  // The ends. `null`, not a clamp — the `⋯` items are disabled there, so a clamp would
  // only ever turn a bug into a silent no-op write.
  assert.equal(moveBySteps(IDS, "gamma", -1), null);
  assert.equal(moveBySteps(IDS, "beta", 1), null);
});

test("Move up and Move down are one place, in both directions", async () => {
  const { moveBySteps } = await import("../src/lib/database/order");
  // One place down, and one place up, landing on the same permutation from either side.
  assert.deepEqual(moveBySteps(IDS, "alpha", 1), ["gamma", "delta", "alpha", "beta"]);
  assert.deepEqual(moveBySteps(IDS, "delta", -1), ["gamma", "delta", "alpha", "beta"]);
  // Down one and back up one is the identity — the round trip a drag makes.
  const down = moveBySteps(IDS, "delta", 1)!;
  assert.deepEqual(moveBySteps(down, "delta", -1), IDS);
});

test("the reorder grip is the shared control, and it is a drag handle", () => {
  const panel = source("../src/components/database/option-panel.tsx");
  const glyphs = source("../src/components/grip-glyphs.tsx");
  // Rule 2: the dots come from the one definition, through the one button. Drawing them
  // here would be the row gutter's mistake again, one level down.
  assert.match(panel, /import \{[^}]*GripButton[^}]*\} from "@\/components\/grip-glyphs"/);
  assert.ok(!/GripGlyph/.test(panel.replace(/\/\*[\s\S]*?\*\//g, "")), "no second drawing of the dots");
  // And the button is a **modifier**, not a replacement: `frame-grip` is always there, so the
  // transition, the hover lift and the `(hover: none)` visibility are the shared ones. A host
  // passing its own base class silently lost all three — a copy one level up from the glyph.
  assert.match(panel, /extraClass="db-option-grip"/);
  assert.match(glyphs, /className=\{`frame-grip\$\{open/, "the base class never leaves the shared rule");
  assert.ok(!/baseClass/.test(glyphs), "no host may replace the base class");
  // A drag handle is not a menu item: it must stay out of the arrow-key ring, or it
  // becomes an unlabelled tab stop in front of every tag.
  assert.match(panel, /tabIndex=\{-1\}/);
});

test("a reorder resolves by id, never by an index into the drawn list", () => {
  const panel = source("../src/components/database/option-panel.tsx");
  /* The list on screen is `matches`, a filtered projection. Splicing that would move the
     wrong tag the moment somebody typed in the search box — and the write goes to the
     property, so it would persist. Both gestures must go through the id-based move. */
  assert.match(panel, /moveRelative\(rawIds, id, targetId\)/);
  assert.match(panel, /moveBySteps\(rawIds, id, delta\)/);
  assert.ok(!/splice\(/.test(panel), "the splice lives in lib/database/order.ts, where it is tested");
});

test("the reorder grip disappears while the list is filtered", () => {
  const panel = source("../src/components/database/option-panel.tsx");
  /* A subset has no meaningful index to drop into: dropping between two visible tags says
     nothing about where it goes among the hidden ones. Notion hides the grip here too. */
  assert.match(panel, /const sortable = query\.trim\(\) === ""/);
  assert.match(panel, /sortable\s*\n?\s*\? \{/, "the grip is only handed pointer handlers when sortable");
});

test("only one ⋯ panel can be open, because the primitive cannot close another", () => {
  const panel = source("../src/components/database/option-panel.tsx");
  const menu = source("../src/components/database/menu.tsx");
  /* The trap, stated as the assertion. `useMenuDismiss` returns early on a press that lands
     anywhere inside `[data-db-popover]` — and one row's `⋯` is inside the main panel's
     popover. So per-row state left two colour panels open side by side and a press on a
     second row's `⋯` looked like it did nothing. The open row is the panel's, not the row's. */
  assert.match(menu, /closest\("\[data-db-popover\]"\)/, "the blanket early-return is still there");
  assert.match(panel, /const \[editingId, setEditingId\] = useState<string \| null>\(null\)/);
  assert.match(panel, /editing=\{editingId === option\.id\}/);
  assert.doesNotMatch(panel, /useState\(false\)/, "no row owns its own `editing` flag");
});
