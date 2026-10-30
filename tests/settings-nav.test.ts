import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SECTION_ID,
  SETTINGS_SECTIONS,
  findSection,
  groupSections,
  isSectionId,
  showsGroupCaptions,
  stepSection,
  type SettingsSection,
} from "../src/lib/settings-nav";

/* A section is five fields and an icon; the icon is never rendered by these
   tests, so a stub keeps them from dragging React into the run. */
const stub = (() => null) as unknown as SettingsSection["icon"];
const section = (id: string, group = "Editor"): SettingsSection => ({
  id,
  label: id,
  icon: stub,
  group,
  lede: `${id} section`,
});

const MENU = [section("appearance", "Editor"), section("editor", "Editor"), section("account", "Workspace")];

/* --------------------------------------------------------------------------
   what ships
   -------------------------------------------------------------------------- */

test("the menu ships with Appearance alone, and it is the default", () => {
  assert.deepEqual(SETTINGS_SECTIONS.map((entry) => entry.id), ["appearance"]);
  assert.equal(DEFAULT_SECTION_ID, "appearance");
});

test("every shipped section carries the copy the dialog renders", () => {
  for (const entry of SETTINGS_SECTIONS) {
    assert.ok(entry.label.length > 0, `${entry.id} has no label`);
    assert.ok(entry.lede.length > 0, `${entry.id} has no lede`);
    assert.ok(entry.group.length > 0, `${entry.id} has no group`);
    assert.equal(entry.id, entry.id.trim().toLowerCase(), "ids are lowercase and untrimmed");
  }
});

test("ids are unique, so a switch on one cannot be ambiguous", () => {
  const ids = SETTINGS_SECTIONS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("findSection returns the record the dialog needs, and nothing for junk", () => {
  assert.equal(findSection("appearance")?.label, "Appearance");
  assert.equal(findSection("nope"), undefined);
});

test("isSectionId accepts what shipped and refuses what did not", () => {
  assert.equal(isSectionId("appearance"), true);
  assert.equal(isSectionId("colours"), false);
  assert.equal(isSectionId(""), false);
});

/* --------------------------------------------------------------------------
   keyboard walk
   -------------------------------------------------------------------------- */

test("a step forward moves to the next section", () => {
  assert.equal(stepSection("appearance", 1, MENU), "editor");
});

test("a step back moves to the previous section", () => {
  assert.equal(stepSection("editor", -1, MENU), "appearance");
});

test("the walk wraps at both ends", () => {
  assert.equal(stepSection("account", 1, MENU), "appearance");
  assert.equal(stepSection("appearance", -1, MENU), "account");
});

test("a delta wider than the menu still lands inside it", () => {
  assert.equal(stepSection("appearance", 7, MENU), "editor");
  assert.equal(stepSection("appearance", -7, MENU), "account");
});

test("an unknown id resolves to the first section instead of throwing", () => {
  assert.equal(stepSection("gone", 1, MENU), MENU[0].id);
  assert.equal(stepSection("gone", -1, MENU), MENU[0].id);
});

test("a menu of one is a fixed point, which is what ships today", () => {
  assert.equal(stepSection("appearance", 1), "appearance");
  assert.equal(stepSection("appearance", -1), "appearance");
});

test("an empty menu cannot invent a section", () => {
  assert.equal(stepSection("appearance", 1, []), "appearance");
});

/* --------------------------------------------------------------------------
   grouping
   -------------------------------------------------------------------------- */

test("consecutive sections sharing a group become one block, in declared order", () => {
  const groups = groupSections(MENU);
  assert.deepEqual(groups.map((entry) => entry.group), ["Editor", "Workspace"]);
  assert.deepEqual(groups[0].sections.map((entry) => entry.id), ["appearance", "editor"]);
  assert.deepEqual(groups[1].sections.map((entry) => entry.id), ["account"]);
});

test("a group that is revisited is not merged back into the first block", () => {
  const groups = groupSections([section("a", "One"), section("b", "Two"), section("c", "One")]);
  assert.deepEqual(groups.map((entry) => entry.group), ["One", "Two", "One"]);
});

test("the shipped one-section menu is a single group", () => {
  assert.equal(groupSections().length, 1);
});

test("a caption needs a second group to separate", () => {
  assert.equal(showsGroupCaptions(groupSections()), false);
  assert.equal(showsGroupCaptions(groupSections(MENU)), true);
});

test("one unnamed group earns no caption even beside a named one", () => {
  assert.equal(showsGroupCaptions([{ group: "", sections: [section("a", "")] }]), false);
});

test("every section appears exactly once across the groups", () => {
  const flat = groupSections(MENU).flatMap((entry) => entry.sections.map((item) => item.id));
  assert.deepEqual(flat, MENU.map((entry) => entry.id));
});
