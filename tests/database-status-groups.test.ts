import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_STATUS_GROUPS,
  defaultStatusGroups,
  groupIdOf,
  groupsOf,
  optionsInGroup,
  pruneOptionValue,
  storedGroups,
  valueIsChecked,
} from "../src/lib/database/property-types/groups";
import { resolveProperty } from "../src/lib/database/properties";
import { statusGroupSchema, type RowDef } from "../src/lib/database/types";

/* Status groups — the To do / In progress / Complete rungs, made editable.
   ---------------------------------------------------------------------------
   The owner's ask, in full: *"Status property ... is slightly different than select. Whole
   point is that the tags are grouped. Default groups should be To do / In Progress /
   Complete ... Notion has those groups fixed, you cant change them or add more, but I want
   to add those capabilities to rename, add or remove them."*

   The thing that can go wrong quietly is not the pane, it is the *reading*. A status
   column that has never had its groups written has an empty `config.groups` — including
   the one in the owner's database — so everything below is about reading that empty array
   as three groups **without writing anything**, and about every tag having exactly one
   group to be drawn under. */

const unstored = { options: [{ id: "s1", name: "Not started", color: "gray", groupId: null }] };

const stored = {
  groups: [
    { id: "g1", name: "Queued", color: "gray", checked: false },
    { id: "g2", name: "Doing", color: "blue", checked: false },
    { id: "g3", name: "Shipped", color: "green", checked: true },
  ],
  options: [
    { id: "s1", name: "Later", color: "gray", groupId: "g1" },
    { id: "s2", name: "Mid", color: "blue", groupId: "g2" },
    { id: "s3", name: "Done", color: "green", groupId: "g3" },
    /* Points at a group that was deleted before the prune existed. */
    { id: "s4", name: "Orphan", color: "red", groupId: "g-gone" },
    /* Every tag on the owner's live Status column looks like this. */
    { id: "s5", name: "Legacy", color: "gray", groupId: null },
  ],
};

/* THE POINT OF THE MATERIALISATION. The owner's Status column stores `groups: []`. It must
   draw as To do / In progress / Complete anyway — and opening the panel must not be a
   write, so `storedGroups` still answers "nothing stored" after reading. */
test("a column whose groups were never written reads as the three defaults", () => {
  assert.deepEqual(storedGroups(unstored), []);
  assert.deepEqual(groupsOf(unstored).map((group) => group.name), ["To do", "In progress", "Complete"]);
  /* Reading is not writing: the same object is still empty afterwards. */
  assert.deepEqual(storedGroups(unstored), []);
});

test("the defaults mark Complete as checked and the other two as unchecked", () => {
  const byName = Object.fromEntries(defaultStatusGroups().map((group) => [group.name, group.checked]));
  assert.deepEqual(byName, { "To do": false, "In progress": false, Complete: true });
});

test("the default ids are constants, so a tag created before the first group write still resolves", () => {
  /* This is why the ids are `grp-todo` rather than random: `create` in the cell dropdown
     writes `groupId: "grp-todo"` into a column whose groups are still empty, and the
     default that the *first* group write stores has to be that same id. */
  assert.deepEqual(DEFAULT_STATUS_GROUPS.map((group) => group.id), ["grp-todo", "grp-in-progress", "grp-complete"]);
  assert.deepEqual(groupsOf(unstored).map((group) => group.id), DEFAULT_STATUS_GROUPS.map((group) => group.id));
});

test("the defaults are a fresh copy — writing them cannot mutate the constant", () => {
  const copy = defaultStatusGroups();
  copy[0].name = "Renamed";
  assert.equal(DEFAULT_STATUS_GROUPS[0].name, "To do");
});

/* Every tag is drawn under exactly one group, whatever its stored `groupId` says. A tag
   with null groups is the norm on a column that predates this feature; a tag naming a
   group that no longer exists is what a delete leaves behind. Neither may vanish. */
test("a tag with no group, or one naming a deleted group, is drawn in the first group", () => {
  const groups = groupsOf(stored);
  assert.equal(groupIdOf({ id: "s5", name: "Legacy", groupId: null }, groups), "g1");
  assert.equal(groupIdOf({ id: "s4", name: "Orphan", groupId: "g-gone" }, groups), "g1");
  assert.equal(groupIdOf({ id: "s3", name: "Done", groupId: "g3" }, groups), "g3");
});

test("the first group holds the ungrouped tags, and no group loses one", () => {
  const groups = groupsOf(stored);
  const counts = groups.map((group) => optionsInGroup(group, stored).map((option) => option.id));
  assert.deepEqual(counts, [["s1", "s4", "s5"], ["s2"], ["s3"]]);
  /* Total preserved — the property of the fallback that matters. */
  assert.equal(counts.flat().length, 5);
});

/* The checkbox is a label on the *group*: the table draws it before the chip of any tag in
   a checked group. Moving a tag between groups therefore changes its cells' glyphs without
   a single cell being rewritten. */
test("the tick follows the tag's group, not the tag", () => {
  assert.equal(valueIsChecked("s3", stored), true, "Done is in the checked group");
  assert.equal(valueIsChecked("s2", stored), false);
  /* Same tag, different group: only the config changed. */
  const moved = { ...stored, options: stored.options.map((option) => option.id === "s2" ? { ...option, groupId: "g3" } : option) };
  assert.equal(valueIsChecked("s2", moved), true);
  /* A cell pointing at nothing is not a checked box. */
  assert.equal(valueIsChecked("s-nothing", stored), false);
  assert.equal(valueIsChecked(null, stored), false);
});

/* A group can be checked only through the schema — the field is required to round-trip, or
   the toggle in the pane would be erased by the next read. */
test("the schema stores `checked`, and defaults an older group to unchecked", () => {
  assert.equal(statusGroupSchema.parse({ id: "g", name: "Later" }).checked, false);
  assert.equal(statusGroupSchema.parse({ id: "g", name: "Later", checked: true }).checked, true);
});

/* The arranged order reads the same groups the pane draws: first group, then the order the
   dropdown lists inside it. Before this existed, an ungrouped tag sorted *after* every
   group — i.e. a status column with no stored groups claimed its tags were rung-less. */
test("the arranged order puts the first group first, ungrouped tags included", () => {
  const status = { id: "p", name: "Status", type: "status" as const, config: stored, position: 0 };
  const spec = resolveProperty(status);
  const rows: RowDef[] = ["s3", "s5", "s2", "s1", "s4"].map((id, index) => ({
    id, title: id, icon: "", cells: { p: id } as RowDef["cells"], createdAt: "", updatedAt: "", position: index,
  }));
  const ordered = [...rows].sort((a, b) => spec.order!(a.cells.p as never, b.cells.p as never, stored));
  /* First group first ("Later", "Orphan", "Legacy"), then Doing, then Shipped — and inside
     the first group, the order the property lists them, which is s1, s4, s5. */
  assert.deepEqual(ordered.map((row) => row.id), ["s1", "s4", "s5", "s2", "s3"]);
});

/* Deleting a group takes its tags, and the server then clears the cells that stored them.
   `pruneOptionValue` is the half that runs inside the transaction. */
test("pruning drops the ids that no longer exist, and leaves a clean value untouched", () => {
  const surviving = new Set(["s1", "s3"]);
  /* One-of types stored a bare string: nothing survives → the cell is empty. */
  assert.equal(pruneOptionValue("s2", surviving), null);
  assert.equal(pruneOptionValue("s1", surviving), "s1");
  /* Multi-select stored a list: it keeps the survivors, and [] is its empty value. */
  assert.deepEqual(pruneOptionValue(["s1", "s2", "s3"], surviving), ["s1", "s3"]);
  assert.deepEqual(pruneOptionValue(["s2"], surviving), []);
  /* No drop → the *same* reference, which is what lets the server skip the write entirely. */
  const untouched = ["s1", "s3"];
  assert.equal(pruneOptionValue(untouched, surviving), untouched);
  assert.equal(pruneOptionValue("s3", surviving), "s3");
  assert.equal(pruneOptionValue(null, surviving), null);
});

/* ---------------------------------------------------------------------------
   Source guards. These are the parts a unit test cannot reach — a pane that writes half a
   config, and a checkbox that is secretly a button.
   --------------------------------------------------------------------------- */

const optionPanel = readFileSync("src/components/database/option-panel.tsx", "utf8");
const groupsPane = readFileSync("src/components/database/status-groups.tsx", "utf8");
const groupControls = readFileSync("src/components/database/group-controls.tsx", "utf8");

/* The owner asked for groups, was told they existed, and could not find them:

     "You said there's a + on the group ... there isnt. Clicking on a group name expands it
      ... it doesnt. There is no way to add a group. There is no way to remove a group."

   Every word was true of the tag dropdown. The controls existed in one surface and were
   described in the words of the other, so the fix was not to build them twice — it was to
   have one row that both render. This is the assertion that keeps it that way: the dropdown
   and the pane must reach the row, the `+` and the New-group block through the shared
   module, and must not draw a heading of their own that only *looks* like one. */
test("both surfaces render the shared group row, and neither draws its own", () => {
  for (const [name, source] of [["dropdown", optionPanel], ["pane", groupsPane]] as const) {
    assert.match(source, /from "\.\/group-controls"/, `the ${name} must use the shared group editor`);
  }
  assert.match(optionPanel, /<GroupRow[\s\S]{0,160}variant="option"/,
    "the dropdown draws the shared row in section-heading form");
  assert.match(groupsPane, /<GroupRow /, "the pane draws the same row");
  assert.match(optionPanel, /<NewGroupBlock editor=\{editor\} \/>/,
    "there is no way to add a group in the dropdown is the bug — the row must be there");
  assert.match(optionPanel, /status && query\.trim\(\) === ""/,
    "a filtered list is a subset: group creation is hidden while searching, like the grip");
});

/* The owner's reply to the micro-caps heading that sat over this list:

     "Really? 'Groups, top to bottom' ? ... Whats this fluff text"

   The heading said the one thing the shape already says — a list is top to bottom — and
   implied an order the rows have no grip to change, since only the tag list is reorderable.
   A paragraph in DECISIONS.md would not stop it coming back; this does. Note what stays
   allowed: a heading that names a *place*, like "Colors", "Currency" or "Hidden in this
   view", answers "where am I" — which is the one question a heading is for. */
test("the groups pane draws no heading that only restates its layout", () => {
  assert.doesNotMatch(groupsPane, /<MenuHeading/, "a list does not need a label saying it is a list");
  assert.doesNotMatch(groupsPane, /import \{[^}]*MenuHeading[^}]*\} from "\.\/menu"/,
    "and it must not import the primitive that draws one");
});

/* The pane's back arrow is navigation, not an input; the bordered 28px box it wore is the
   property menu's icon *well*, right there because it sits beside a text field. The modifier
   that drops the chrome is added alongside the base class — `.db-grip`'s rule — because
   replacing it would silently lose the size, the radius and the hover lift. */
test("the back arrow keeps the shared icon button and only drops its chrome", () => {
  assert.match(groupsPane, /className="db-prop-icon-btn db-menu-back"/,
    "a modifier is added alongside the base class, never instead of it");
  const css = readFileSync("src/app/database.css", "utf8");
  const rule = css.match(/\.db-prop-icon-btn\.db-menu-back\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /border-color:\s*transparent/, "the modifier removes the border");
  assert.doesNotMatch(rule, /width:|height:|border-radius:|display:/,
    "it must not restate geometry it inherits — that is the drift the base class prevents");
});

/* The server validates the whole status config it is handed, so a write that carried only
   `options` would erase the groups — and a write that carried only `groups` would erase
   every tag. Both halves are asserted at their call sites. */
test("every status config write carries both lists", () => {
  assert.match(optionPanel, /\{ options: next, groups \}/, "the tag menu must send the groups back with the tags");
  assert.match(optionPanel, /\{ options: \[\.\.\.raw, option\], groups \}/, "creating a tag sends both lists too");
  assert.match(groupControls, /onConfig\?\.\(\{ groups: nextGroups, options: nextOptions \}\)/,
    "the group editor writes one config, not two");
});

/* The owner asked for the checkbox *only* before the chip in the table, and said it means
   nothing functionally. A `<button>` there would promise a behaviour that does not exist. */
test("the status tick is a label, not a control", () => {
  const tick = optionPanel.slice(optionPanel.indexOf("db-tag-check") - 400, optionPanel.indexOf("db-tag-check") + 200);
  assert.match(tick, /aria-hidden="true"/, "the tick is decorative");
  assert.doesNotMatch(tick, /<button/, "the tick must not be a button");
  assert.match(readFileSync("src/app/database.css", "utf8"), /\.db-tag-check\s*\{[^}]*pointer-events:\s*none/,
    "the tick must not take a click from the cell");
});

/* Deleting a group is two presses: the first only names what the second destroys. */
test("deleting a group takes a deliberate second press", () => {
  assert.match(groupControls, /confirmDelete === group\.id \?/, "the row must have a confirm step");
  assert.match(groupControls, /Delete \$\{group\.name\} and its/, "the confirm must name the tags it would take");
});

/* The `+` on a group creates a tag *into that group*. It was the one action that made an
   empty group reachable at all, and it is the one the owner said was missing. */
test("the group + creates its tag in that group, not in the first one", () => {
  assert.match(groupControls, /groupId: group\.id/, "a tag created from a group's + belongs to that group");
  assert.match(groupControls, /aria-label=\{`Add a tag to \$\{group\.name\}`\}/,
    "the + must name the group it fills — screen readers and the probe both read this");
});
