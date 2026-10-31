import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The owner reported the same defect three times:
     "There is still a very small hitbox at the top of the database block that when pressed
      will highlight the database object and it will be stuck in that highlighted state
      until the page is refreshed."
   Two mechanisms had to be wrong at once for that to keep happening, and both were invisible
   to the checks that existed at the time. These assertions cover the reasons, not the
   symptom, because a CDP probe can only catch the version of the bug that exists today.

   1. `selectable: false` sat in the *config* of `createReactBlockSpec`, where BlockNote 0.56
      does not read it. It builds the ProseMirror node spec from
      `implementation.meta.selectable`, so the config key type-checked, read correctly, and
      did nothing. Moving it to `meta` is what actually makes the node unselectable.
   2. The press guard was attached to `.db-block`, whose own vertical space was `margin` —
      and a margin is not hit-testable. Those pixels belonged to `.bn-block-content`, inside
      `.tiptap`, so ProseMirror's own handler saw them and built the node selection anyway.
      A guard cannot stop a press that does not reach the element it is attached to. */

const read = (path: string) => readFileSync(path, "utf8");

test("the database block is made non-selectable in `meta`, where BlockNote reads it", () => {
  const source = read("src/components/editor/schema.tsx");
  const start = source.indexOf("const createDatabaseBlock = createReactBlockSpec(");
  assert.ok(start >= 0, "createDatabaseBlock is gone; this test needs rewriting, not deleting");

  const body = source.slice(start, source.indexOf("const createPageLinkBlock"));

  assert.match(
    body,
    /meta:\s*\{\s*selectable:\s*false\s*\}/,
    "`selectable: false` must be in the implementation's `meta` — BlockNote builds the node " +
      "spec from `implementation.meta.selectable` and ignores the config",
  );

  /* The config object is the first argument. If `selectable` reappears there it is dead code
     that reads as a fix, which is exactly how this survived three rounds. */
  const config = body.slice(body.indexOf("{"), body.indexOf("},\n  {"));
  assert.doesNotMatch(
    config,
    /selectable/,
    "`selectable` in the config is inert in BlockNote 0.56; it belongs in `meta`",
  );
});

test("the press guard is attached to the block's whole band, not to .db-block", () => {
  const source = read("src/components/database/database-block.tsx");

  assert.match(
    source,
    /node\.closest<HTMLElement>\("\.bn-block-content"\)/,
    "the guard must attach to the enclosing `.bn-block-content`, whose box covers the gaps " +
      "around `.db-block`",
  );
  assert.match(
    source,
    /surface\.addEventListener\("mousedown", guard, true\)/,
    "the listener must go on the band, in the capture phase, before ProseMirror's",
  );
  assert.match(source, /surface\.removeEventListener\("mousedown", guard, true\)/);
  assert.doesNotMatch(
    source,
    /node\.addEventListener\("mousedown", guard, true\)/,
    "attaching to `.db-block` again leaves the margin and the wrapper's padding unguarded",
  );
});

test("the database block spends no vertical space as margin", () => {
  const css = read("src/app/database.css");
  const rule = /\.db-block\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, "the `.db-block` rule is gone");

  const margin = /margin:\s*([^;]+);/.exec(rule[1])?.[1]?.trim();
  assert.equal(
    margin,
    "0",
    "a vertical margin is a hitbox owned by the editor, not by the block: space the block " +
      "needs, the block owns as padding",
  );
  assert.match(rule[1], /padding:\s*8px 0 12px;/, "the spacing the margin carried is padding now");
});
