import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The owner's report, verbatim: "A lot of the times when editing different cells i
   accidentally or even intentionally double click, which throws me inside the page ...
   i should only be able to open up the page by clicking the designated open button which
   we already have."

   The row carried `onDoubleClick={() => onOpenRow(row.id)}` on the `<tr>`, advertised by a
   `.db-row-open { cursor: pointer }` class. Everything about that was wrong together:

     - a double press inside a cell is how a word gets selected while editing. The second
       press left the table and the edit went with it;
     - `cursor: pointer` across the whole row promised a click that did not exist on any
       single press — the pointer cursor is a *link* signal, and a row here is not a link;
     - the row already ships a named `Open` button, so the double-click was a second,
       silent route to the same page. Two routes, one of them invisible.

   These assertions pin the decision, not the symptom, because a probe can only catch the
   version of the bug that exists today: the double-click could come back on any cell, or
   on the row, or on the name span, and all three would look identical to a pointer. */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const table = read("src/components/database/table-view.tsx");
const css = read("src/app/database.css");

test("nothing in the table opens a page on a double press", () => {
  assert.doesNotMatch(
    table,
    /onDoubleClick/,
    "a double-click handler in table-view.tsx is a second way into a page, and the second " +
      "press of a double press belongs to the text being edited — the `Open` button is the " +
      "only route",
  );
});

test("the row element carries no press handler of its own", () => {
  /* A row is a container of cells. Every press in it belongs to the cell it lands on — a
     name to edit, a tag to pick, a grip to drag. A handler on the `<tr>` sees all of them
     and cannot tell them apart, which is exactly how a double press meant to select a
     word became a navigation. */
  const tbodyAt = table.indexOf("<tbody>");
  assert.ok(tbodyAt > 0, "table-view.tsx no longer draws a `<tbody>`; this test needs rewriting");

  const rowTag = /<tr\b[^>]*>/.exec(table.slice(tbodyAt));
  assert.ok(rowTag, "no row element is drawn inside `<tbody>`; this test needs rewriting");
  assert.doesNotMatch(
    rowTag[0],
    /\son[A-Z][A-Za-z]*=/,
    "the row element carries an event handler; a press anywhere in a row must reach the " +
      "cell it landed on and nothing wider",
  );
});

test("the `Open` button is the only caller of `onOpenRow`", () => {
  assert.ok(table.includes('className="db-open"'), "the `Open` button is gone; the page would have no opener");

  /* Any call shape counts: `onOpenRow(row.id)` or `onOpenRow?.(row.id)`. The optional-call
     form is what the row's double-click used, and it is the shape a call site takes when
     whoever wrote it did not know whether there was a page to open. */
  const calls = table.match(/onOpenRow(\?\.)?\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    "`onOpenRow` is called more than once. One call — the `Open` button's. A second is an " +
      "opener nobody can see",
  );

  /* And that one call must sit inside the button: a bare `onClick` on the name cell would
     open the page for everyone who clicks a name to edit it. */
  const button = table.slice(table.indexOf('className="db-open"'));
  const onclick = button.slice(button.indexOf("onClick"));
  assert.ok(
    onclick.indexOf("onOpenRow(row.id)") < onclick.indexOf("</button>"),
    "the `Open` button's onClick must be the thing that calls `onOpenRow(row.id)`",
  );
});

test("the row no longer advertises a click it does not have", () => {
  assert.doesNotMatch(
    css,
    /\.db-row-open/,
    "`.db-row-open` existed only to put `cursor: pointer` on a row that opened on a " +
      "double-click — a link cursor on something that is not a link",
  );

  /* Scoped to the row itself: `.db-cell` and the gutter carry their own cursors for their
     own reasons. */
  const row = /(^|\n)\.db-row\s*\{([^}]*)\}/.exec(css);
  if (row) {
    assert.doesNotMatch(
      row[2],
      /cursor:\s*pointer/,
      "`.db-row` must not set a pointer cursor: a row is a container of cells, and each " +
        "cell owns what a press on it does",
    );
  }
});

test("the icon button carries no double-click guard for a handler that is gone", () => {
  /* `entry-icon.tsx` used to stop propagation on `dblclick` so that reaching for the icon
     did not open the page. With the row's handler deleted, that guard protects nothing —
     and a guard for a handler that no longer exists is dead code that reads as a fix. */
  const icon = read("src/components/database/entry-icon.tsx");
  assert.doesNotMatch(icon, /onDoubleClick/, "entry-icon.tsx still guards a double-click nobody handles");
});
