// Status groups: are the three Notion groups editable — renameable, addable, removable —
// and does the group's "displays as checked" flag reach the table?
//
// Usage:
//   BASE=http://127.0.0.1:3103 PAGE=<page id> DB=<database id> STATUS=<property id> \
//     node scripts/verify-db-status-groups.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-groups-probe.ps1
//
// WHY IT WRITES: the feature *is* a config write, and the two claims that matter are about
// what the server stores afterwards — a toggle that only re-painted the local copy, or a
// group delete that left the tag in the config and the cells pointing at it, would pass any
// DOM-only assertion. Every step below reads the property back from `/api/databases`.
//
// The fixture stores `groups: []` and `groupId: null` on every tag, which is exactly what
// the owner's live Status column holds — see seed-qa-groups.mjs.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3103";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const statusId = process.env.STATUS;
if (!pageId || !databaseId || !statusId) {
  throw new Error("PAGE=<page id> DB=<database id> STATUS=<status property id> are required — run scripts/seed-qa-groups.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The property as the *server* holds it. This is the only source any claim below trusts. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  const property = database.properties.find((candidate) => candidate.id === statusId);
  if (!property) throw new Error(`property ${statusId} is not in the payload`);
  const groups = property.config?.groups ?? [];
  const options = property.config?.options ?? [];
  const rows = Object.fromEntries(database.rows.map((row) => [row.title, row.cells?.[statusId] ?? null]));
  return { groups, options, rows };
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const surfaceCount = () => b.evaluate("document.querySelectorAll('[data-db-popover]').length");
const panePresent = () => b.evaluate("!!document.querySelector('.db-groups-pane')");

/** Centre of the first element matching `selector` (and, optionally, whose text is `text`). */
const centre = (selector, text = "") => b.evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((node) => ${JSON.stringify(text)} === "" || node.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return null;
  /* The surface scrolls (.db-menu is overflow-y: auto), so an item below the fold has a
     rect outside the visible box and clicking its centre would land on the page. Scrolling
     first is what a person does; the hit test below is what says it worked. */
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, reachable: !!hit && (hit === el || el.contains(hit)) };
})()`);

async function click(selector, text = "") {
  const at = await centre(selector, text);
  if (!at) throw new Error(`nothing to click for ${selector} ${text}`);
  if (!at.reachable) throw new Error(`${selector} ${text} is at ${at.x},${at.y} but something else is on top of it — it is not reachable`);
  await b.mouse(at.x, at.y);
  await sleep(120);
}

/** A row of the last open surface, by its label — `.db-menu-item` is the shared menu row. */
async function clickMenu(label) {
  const at = await b.evaluate(`(() => {
    const surfaces = [...document.querySelectorAll('[data-db-popover]')];
    const surface = surfaces[surfaces.length - 1];
    if (!surface) return null;
    const item = [...surface.querySelectorAll('.db-menu-item')]
      .find((node) => (node.querySelector('.db-menu-label') ?? node).textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    item.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = item.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === item || item.contains(hit)) };
  })()`);
  if (!at) throw new Error(`no menu row "${label}" in the open surface`);
  if (!at.reachable) throw new Error(`the menu row "${label}" is at ${at.x},${at.y} but something else is on top of it`);
  await b.mouse(at.x, at.y);
  await sleep(140);
}

const menuLabels = () => b.evaluate(`(() => {
  const surfaces = [...document.querySelectorAll('[data-db-popover]')];
  const surface = surfaces[surfaces.length - 1];
  if (!surface) return [];
  return [...surface.querySelectorAll('.db-menu-item')].map((item) => ({
    label: (item.querySelector('.db-menu-label') ?? item).textContent.trim(),
    checked: !!item.querySelector('.db-menu-check'),
    disabled: item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true',
  }));
})()`);

/** The pane's groups: name and the count it prints beside it. */
const paneGroups = () => b.evaluate(`(() => [...document.querySelectorAll('.db-groups-pane .db-group-row')].map((row) => ({
  id: row.getAttribute('data-group-row'),
  name: row.querySelector('.db-group-name')?.textContent.trim() ?? '',
  count: row.querySelector('.db-group-count')?.textContent.trim() ?? '',
})))()`);

/** The sections the cell dropdown draws, and the tags inside them. */
const dropdownSections = () => b.evaluate(`(() => {
  const surface = [...document.querySelectorAll('[data-db-popover]')].at(-1);
  if (!surface) return [];
  return [...surface.querySelectorAll('.db-option-section')].map((section) => ({
    id: section.getAttribute('data-group') ?? null,
    /* The heading is the shared group row now, so its name lives in the group-name button;
       the bare .db-option-group div is only what a flattened list (a search) can show. */
    name:
      section.querySelector('.db-group-name')?.textContent.trim() ??
      section.querySelector('.db-option-group')?.textContent.trim() ??
      null,
    tags: [...section.querySelectorAll('.db-option-row')].map((row) =>
      row.querySelector('.db-tag-name')?.textContent.trim() ?? ''),
  }));
})()`);

/** Pick a tag in the open cell dropdown. A tag row is `.db-option-row`, not a menu row. */
async function clickTag(name) {
  const at = await b.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-db-popover] .db-option-row')]
      .find((candidate) => candidate.querySelector('.db-tag-name')?.textContent.trim() === ${JSON.stringify(name)});
    const button = row?.querySelector('.db-option-pick');
    if (!button) return null;
    /* The dropdown scrolls: four groups of tags do not fit in 460px. A person scrolls to the
       tag before clicking it; the rect alone would put the click on the page. */
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = button.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === button || button.contains(hit)) };
  })()`);
  if (!at) throw new Error(`no tag "${name}" in the open menu`);
  if (!at.reachable) throw new Error(`the tag "${name}" is at ${at.x},${at.y} but something else is on top of it`);
  await b.mouse(at.x, at.y);
  await sleep(150);
}

/** One row's status cell: its chip's name and the group tick in front of it. */
const cellTick = (index) => b.evaluate(`(() => {
  const row = [...document.querySelectorAll('tr.db-row[data-row-id]')][${index}];
  const cell = row?.querySelector('[data-property-id=${JSON.stringify(statusId)}]');
  if (!cell) return null;
  const tick = cell.querySelector('.db-tag-check');
  return {
    tick: tick ? tick.getAttribute('aria-checked') : null,
    tag: cell.querySelector('.db-tag-name')?.textContent.trim() ?? null,
    empty: !!cell.querySelector('.db-cell-empty'),
  };
})()`);

async function waitStored(predicate, label, timeoutMs = 8000) {
  const steps = Math.ceil(timeoutMs / 200);
  for (let i = 0; i < steps; i++) {
    try { if (predicate(await stored())) return await stored(); } catch {}
    await sleep(200);
  }
  throw new Error(`the server never reached: ${label}`);
}

async function openPropertyMenu() {
  await click(".db-th-label", "Status");
  await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", { label: "the property menu opened" });
}

async function openGroupsPane() {
  await openPropertyMenu();
  await clickMenu("Status groups");
  await b.waitFor("!!document.querySelector('.db-groups-pane')", { label: "the groups pane opened" });
}

/* Rows are addressed by index, not by title: the primary cell is an editable field, so the
   title is an input *value* and `textContent` never contains it. The seed writes them in
   order, and the rows are ordered by `position`. */
async function openCellMenu(index) {
  const at = await b.evaluate(`(() => {
    const row = [...document.querySelectorAll('tr.db-row[data-row-id]')][${index}];
    const trigger = row?.querySelector('[data-property-id=${JSON.stringify(statusId)}] .db-tag-trigger');
    if (!trigger) return null;
    /* The table scrolls sideways, and a narrow viewport can leave this column past the right
       edge — so scroll it in first, then say whether a press at the centre would reach it.
       Found the hard way: once the viewport was pinned to a true 390 (browser-session.mjs) the
       un-scrolled centre landed outside the page and the click went nowhere, which read as
       "the status menu did not open". */
    trigger.scrollIntoView({ block: "nearest", inline: "center" });
    const r = trigger.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: !!hit && (hit === trigger || trigger.contains(hit)), view: [innerWidth, innerHeight] };
  })()`);
  if (!at) throw new Error(`no status cell on the row at index ${index}`);
  if (!at.reachable) throw new Error(`the status cell at ${at.x},${at.y} is not reachable at ${at.view.join("x")} — something is on top of it`);
  await b.mouse(at.x, at.y);
  await b.waitFor("[...document.querySelectorAll('[data-db-popover]')].some((s) => s.querySelector('.db-option-section'))", {
    label: `the tag menu for the row at ${index} opened`,
  });
}

try {
  await b.waitFor("!!document.querySelector('.db-tag-trigger')", { label: "the seeded table rendered" });

  /* ---------------------------------------------------------------------------
     1. A column with no stored groups still draws the three Notion ones — and drawing
        them is not a write.
     --------------------------------------------------------------------------- */
  const seededConfig = await stored();
  b.check(
    "the fixture starts with no stored groups and null groupIds, like the live column",
    seededConfig.groups.length === 0 && seededConfig.options.every((option) => (option.groupId ?? null) === null),
    `groups=${seededConfig.groups.length} groupIds=${seededConfig.options.map((option) => String(option.groupId)).join(",")}`,
  );

  await openCellMenu(0);
  const sections = await dropdownSections();
  b.check(
    "the cell dropdown draws To do / In progress / Complete on a column with no stored groups",
    JSON.stringify(sections.map((section) => section.name)) === JSON.stringify(["To do", "In progress", "Complete"]),
    JSON.stringify(sections.map((section) => section.name)),
  );
  b.check(
    "every tag with a null groupId is drawn under the first group",
    sections[0]?.tags.length === 3 && sections[1]?.tags.length === 0 && sections[2]?.tags.length === 0,
    JSON.stringify(sections.map((section) => section.tags)),
  );
  b.check(
    "the default group ids are the stable constants, not random ones",
    sections[0]?.id === "grp-todo" && sections[2]?.id === "grp-complete",
    JSON.stringify(sections.map((section) => section.id)),
  );
  await b.shot(`groups-dropdown-open-${width}`);
  await b.key("Escape", { keyCode: 27 });
  await sleep(150);
  const afterRead = await stored();
  b.check(
    "opening the dropdown wrote nothing — the defaults are a reading, not a migration",
    afterRead.groups.length === 0,
    `groups=${JSON.stringify(afterRead.groups)}`,
  );
  await b.shot(`groups-dropdown-defaults-${width}`);

  /* ---------------------------------------------------------------------------
     2. The pane lists them, with the counts.
     --------------------------------------------------------------------------- */
  await openGroupsPane();
  const listed = await paneGroups();
  b.check(
    "the property menu opens a Status groups pane listing the three defaults",
    JSON.stringify(listed.map((group) => group.name)) === JSON.stringify(["To do", "In progress", "Complete"]),
    JSON.stringify(listed.map((group) => group.name)),
  );
  b.check(
    "each group prints how many tags it holds",
    JSON.stringify(listed.map((group) => group.count)) === JSON.stringify(["3", "0", "0"]),
    JSON.stringify(listed.map((group) => group.count)),
  );
  b.check(
    "the pane replaced the menu inside one surface — it is not a second popover",
    (await surfaceCount()) === 1,
    `surfaces=${await surfaceCount()}`,
  );
  await b.shot(`groups-pane-${width}`);

  /* ---------------------------------------------------------------------------
     3. "Displays as checked" is a write, and it stores the defaults it drew.
     --------------------------------------------------------------------------- */
  await click(".db-groups-pane .db-group-name", "To do");
  await sleep(120);
  const panel = await menuLabels();
  b.check(
    "a group's panel offers Rename, Displays as checked, Add a tag and Delete group",
    ["Rename", "Displays as checked", "Add a tag", "Delete group"].every((label) => panel.some((item) => item.label === label)),
    JSON.stringify(panel.map((item) => item.label)),
  );
  b.check(
    "the checked row starts unchecked and unticked",
    panel.find((item) => item.label === "Displays as checked")?.checked === false,
    JSON.stringify(panel.find((item) => item.label === "Displays as checked")),
  );
  await clickMenu("Displays as checked");
  const toggled = await waitStored((state) => state.groups[0]?.checked === true, "To do stored as checked");
  b.check(
    "the toggle stores three groups — the ones the pane drew — with To do checked",
    toggled.groups.length === 3 && toggled.groups[0].id === "grp-todo" && toggled.groups[0].checked === true,
    JSON.stringify(toggled.groups.map((group) => `${group.id}:${group.checked}`)),
  );
  b.check(
    "the write carried the tags too — a config write that dropped them would leave an empty column",
    toggled.options.length === 3,
    `options=${toggled.options.length}`,
  );
  await b.shot(`groups-pane-checked-${width}`);

  /* ---------------------------------------------------------------------------
     4. The flag is a *label on the group*: it reaches the table without a cell write.
     --------------------------------------------------------------------------- */
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  const todoCell = await cellTick(0);
  b.check(
    "a tag in the checked group draws a ticked box in its cell",
    todoCell?.tick === "true",
    JSON.stringify(todoCell),
  );
  b.check(
    "the cell was not rewritten — the glyph follows the group, not the value",
    (await stored()).rows["Row one"] === seededConfig.rows["Row one"],
    `${JSON.stringify(seededConfig.rows["Row one"])} → ${JSON.stringify((await stored()).rows["Row one"])}`,
  );

  /* ---------------------------------------------------------------------------
     5. A new group, with the checked flag set *at creation*.
     --------------------------------------------------------------------------- */
  await openGroupsPane();
  await clickMenu("New group");
  await sleep(120);
  await b.waitFor("!!document.querySelector('.db-groups-pane input[aria-label=\"New group name\"]')", { label: "the new-group form opened" });
  await b.type("Blocked");
  await sleep(80);
  await click(".db-group-confirm");
  const created = await waitStored((state) => state.groups.length === 4, "a fourth group was stored");
  const blocked = created.groups.find((group) => group.name === "Blocked");
  b.check(
    "a new group is added at the end, unchecked unless the form said otherwise",
    blocked !== undefined && blocked.checked === false,
    JSON.stringify(created.groups.map((group) => `${group.name}:${group.checked}`)),
  );

  /* A tag created *into* a group — the `+` on its row. Without it a group can be made but
     never filled: the cell dropdown always creates into the first one. */
  await click(".db-groups-pane .db-group-name", "Blocked");
  await sleep(120);
  await clickMenu("Add a tag");
  await sleep(120);
  await b.waitFor("!!document.querySelector('.db-groups-pane input[aria-label=\"New tag in Blocked\"]')", { label: "the tag field opened" });
  await b.type("Stuck");
  await b.key("Enter", { keyCode: 13 });
  const withTag = await waitStored(
    (state) => state.options.some((option) => option.name === "Stuck"),
    "the tag was created in Blocked",
  );
  const stuck = withTag.options.find((option) => option.name === "Stuck");
  b.check(
    "the + creates the tag in that group, not in the first one",
    stuck?.groupId === blocked.id,
    `groupId=${stuck?.groupId} blocked=${blocked.id}`,
  );
  await b.shot(`groups-pane-new-${width}`);

  /* ---------------------------------------------------------------------------
     6. The new group shows up in the cell dropdown as its own section.
     --------------------------------------------------------------------------- */
  await b.key("Escape", { keyCode: 27 });
  await sleep(200);
  await openCellMenu(3);
  const nowSections = await dropdownSections();
  b.check(
    "the stored groups drive the dropdown: four headings, in the order the pane lists them",
    JSON.stringify(nowSections.map((section) => section.name)) === JSON.stringify(["To do", "In progress", "Complete", "Blocked"]),
    JSON.stringify(nowSections.map((section) => section.name)),
  );
  b.check(
    "the new tag sits under its own group's heading",
    JSON.stringify(nowSections[3]?.tags) === JSON.stringify(["Stuck"]),
    JSON.stringify(nowSections[3]?.tags),
  );
  await clickTag("Stuck");
  const picked = await waitStored((state) => state.rows["Row four"] === stuck.id, "Row four stores the new tag");
  b.check(
    "the picked tag is stored on the row",
    picked.rows["Row four"] === stuck.id,
    JSON.stringify(picked.rows["Row four"]),
  );
  await sleep(200);
  const blockedCell = await cellTick(3);
  b.check(
    "a tag in an unchecked group draws an empty box, and the tag itself is drawn",
    blockedCell?.tick === "false" && blockedCell?.tag === "Stuck",
    JSON.stringify(blockedCell),
  );

  /* ---------------------------------------------------------------------------
     7. Deleting a group: two presses, and it takes its tags and their cells with it.
     --------------------------------------------------------------------------- */
  await sleep(150);
  await openGroupsPane();
  await click(".db-groups-pane .db-group-name", "Blocked");
  await sleep(120);
  await clickMenu("Delete group");
  await sleep(200);
  const afterFirstPress = await stored();
  b.check(
    "one press on Delete group deletes nothing — it only names what the next one would",
    afterFirstPress.groups.length === 4 && afterFirstPress.options.some((option) => option.name === "Stuck"),
    `groups=${afterFirstPress.groups.length} tags=${afterFirstPress.options.length}`,
  );
  const confirmRow = (await menuLabels()).find((item) => item.label.startsWith("Delete Blocked"));
  b.check(
    "the confirm row says what it would take with it",
    confirmRow?.label === "Delete Blocked and its 1 tag",
    JSON.stringify(confirmRow),
  );
  await b.shot(`groups-delete-confirm-${width}`);
  await clickMenu(confirmRow.label);
  const deleted = await waitStored((state) => state.groups.length === 3, "the group was deleted");
  b.check(
    "the second press removes the group and its tag from the config",
    deleted.groups.every((group) => group.name !== "Blocked") && !deleted.options.some((option) => option.name === "Stuck"),
    `groups=${JSON.stringify(deleted.groups.map((group) => group.name))} tags=${JSON.stringify(deleted.options.map((option) => option.name))}`,
  );
  b.check(
    "the cell that held the deleted tag is cleared on the server, not left pointing at nothing",
    deleted.rows["Row four"] === null,
    JSON.stringify(deleted.rows["Row four"]),
  );
  b.check(
    "the pane is still open after the delete, and still one surface",
    (await panePresent()) && (await surfaceCount()) === 1,
    `pane=${await panePresent()} surfaces=${await surfaceCount()}`,
  );

  /* ---------------------------------------------------------------------------
     8. A rename, and the tag that was in the group survives it.
     --------------------------------------------------------------------------- */
  await click(".db-groups-pane .db-group-name", "In progress");
  await sleep(120);
  await clickMenu("Rename");
  await sleep(120);
  await b.waitFor("!!document.querySelector('.db-groups-pane input[aria-label=\"Group name\"]')", { label: "the rename field opened" });
  const renameFocus = await b.evaluate("document.activeElement?.getAttribute?.('aria-label') ?? document.activeElement?.tagName ?? ''");
  b.check("the rename field takes focus when it opens", renameFocus === "Group name", String(renameFocus));
  await b.type("Underway");
  await b.key("Enter", { keyCode: 13 });
  const renamed = await waitStored(
    (state) => state.groups.some((group) => group.name === "Underway"),
    "the group was renamed",
  );
  b.check(
    "renaming a group keeps its id — the tags in it are not orphaned",
    renamed.groups.find((group) => group.name === "Underway")?.id === "grp-in-progress" &&
      renamed.options.length === 3,
    JSON.stringify(renamed.groups.map((group) => `${group.id}:${group.name}`)),
  );
  b.check(
    "the last press left To do checked and the table agreeing with it",
    renamed.groups[0].checked === true && (await cellTick(0))?.tick === "true",
    JSON.stringify({ checked: renamed.groups[0].checked, cell: await cellTick(0) }),
  );

  /* ---------------------------------------------------------------------------
     9. The tag dropdown — the surface the owner was actually looking at.

     "You said there's a + on the group ... there isnt. Clicking on a group name expands it
      ... it doesnt. There is no way to add a group. There is no way to remove a group."

     All four were true of the dropdown, where the heading was a bare `<div>`. Each bullet
     below is one of those four sentences, and each one reads its answer back from the
     server, because a `+` that only re-painted would pass a DOM check.
     --------------------------------------------------------------------------- */
  await b.key("Escape", { keyCode: 27 });
  await sleep(250);
  b.check(
    "the property menu is closed before the dropdown is tested",
    (await surfaceCount()) === 0,
    `surfaces=${await surfaceCount()}`,
  );

  const pointIn = (selector) =>
    b.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(x, y);
      return { x, y, reachable: !!hit && (hit === el || el.contains(hit)) };
    })()`);

  const openCellDropdown = async () => {
    const cell = await b.evaluate(`(() => {
      const row = document.querySelector('tr.db-row[data-row-id]');
      const cell = row && row.querySelector('[data-property-id=${JSON.stringify(statusId)}]');
      const trigger = cell && (cell.querySelector('.db-tag-trigger') ?? cell);
      if (!trigger) return null;
      trigger.scrollIntoView({ block: "center" });
      const r = trigger.getBoundingClientRect();
      const x = Math.round(r.left + Math.min(30, r.width / 2)), y = Math.round(r.top + r.height / 2);
      return { x, y };
    })()`);
    if (!cell) throw new Error("no status cell in the first row");
    await b.mouse(cell.x, cell.y);
    await b.waitFor("document.querySelectorAll('[data-db-popover]').length === 1", {
      label: "the tag dropdown opened",
      timeoutMs: 8000,
    });
    await sleep(150);
  };

  await openCellDropdown();

  const groupRows = await b.evaluate(`(() => [...document.querySelectorAll('.db-option-group-row')].map((row) => {
    const name = row.querySelector('.db-group-name');
    const add = row.querySelector('.db-group-add');
    return {
      id: row.getAttribute('data-group-row'),
      name: name ? name.textContent.trim() : null,
      expanded: name ? name.getAttribute('aria-expanded') : null,
      addLabel: add ? add.getAttribute('aria-label') : null,
    };
  }))()`);

  b.check(
    "the dropdown draws one group row per group",
    groupRows.length >= 3,
    JSON.stringify(groupRows),
  );
  b.check(
    "every group in the dropdown carries a + that names the group it fills",
    groupRows.length > 0 && groupRows.every((row) => (row.addLabel ?? "").startsWith("Add a tag to ")),
    JSON.stringify(groupRows.map((row) => row.addLabel)),
  );
  b.check(
    "the dropdown offers a way to add a group",
    (await menuLabels()).some((item) => item.label === "New group"),
    JSON.stringify(await menuLabels()),
  );
  await b.shot(`dropdown-groups-${width}`);

  /* "Clicking on a group name expands it ... it doesnt." One press, at 20px into the name —
     far from the `+`, which is the other hit target on that row. */
  const firstName = await pointIn('.db-option-group-row[data-group-row="grp-in-progress"] .db-group-name');
  if (!firstName) throw new Error("the In progress group row is not in the dropdown");
  await b.mouse(firstName.x, firstName.y);
  await sleep(200);
  const panelAfterPress = await b.evaluate(`(() => {
    const row = document.querySelector('.db-option-group-row[data-group-row="grp-in-progress"]');
    return {
      expanded: row?.querySelector('.db-group-name')?.getAttribute('aria-expanded') ?? null,
      items: [...document.querySelectorAll('.db-option-group-row[data-group-row="grp-in-progress"] .db-group-panel .db-menu-item')]
        .map((node) => (node.querySelector('.db-menu-label') ?? node).textContent.trim()),
    };
  })()`);
  b.check(
    "one press on a group name in the dropdown expands it",
    panelAfterPress.expanded === "true",
    JSON.stringify(panelAfterPress),
  );
  b.check(
    "the expanded dropdown panel holds the same four actions as the pane",
    ["Rename", "Displays as checked", "Add a tag", "Delete group"].every((label) =>
      panelAfterPress.items.includes(label),
    ),
    JSON.stringify(panelAfterPress.items),
  );

  /* "There is no way to add a group" — and, with it, no way to put a tag in an *empty*
     group, which is what the `+` is for. Complete holds no tags in this fixture. */
  const plus = await pointIn('.db-option-group-row[data-group-row="grp-complete"] .db-group-add');
  if (!plus) throw new Error("the Complete group has no + in the dropdown");
  await b.mouse(plus.x, plus.y);
  await sleep(200);
  await b.waitFor(
    `!!document.querySelector('.db-option-group-row[data-group-row="grp-complete"] input[aria-label="New tag in Complete"]')`,
    { label: "the + opened a tag field inside Complete", timeoutMs: 5000 },
  );
  await b.type("Shipped");
  await b.key("Enter", { keyCode: 13 });
  /* Two writes, in order: the option into the config, then the cell that points at it. The
     probe has to wait for the *second* one — it used to wait for the option alone and then
     read `rows`, which passed all run at 1400 and failed at 390 whenever the read landed
     between the two requests. Waiting for the claim is not the same as weakening it: if the
     cell write were really lost, this times out and says so. */
  const withShipped = await waitStored(
    (state) => {
      const made = state.options.find((option) => option.name === "Shipped");
      return Boolean(made) && Object.values(state.rows).includes(made.id);
    },
    "the tag created from a group's + was stored and selected in the cell",
  );
  const shipped = withShipped.options.find((option) => option.name === "Shipped");
  b.check(
    "a tag created from a group's + is stored in that group, not the first one",
    shipped?.groupId === "grp-complete",
    JSON.stringify(shipped),
  );
  b.check(
    "the + selects the tag it created, so the cell is what you pressed it for",
    Object.values(withShipped.rows).includes(shipped?.id),
    JSON.stringify(withShipped.rows),
  );

  /* "There is no way to remove a group" — from the dropdown, two presses, and the tag it
     held goes with it. */
  await sleep(200);
  const afterCreate = await b.evaluate(`(() => ({
    surfaces: document.querySelectorAll('[data-db-popover]').length,
    completeExpanded:
      document.querySelector('.db-option-group-row[data-group-row="grp-complete"] .db-group-name')
        ?.getAttribute('aria-expanded') ?? null,
  }))()`);
  b.check(
    "picking the new tag closes the single-select dropdown",
    afterCreate.surfaces === 0,
    JSON.stringify(afterCreate),
  );

  if (afterCreate.surfaces !== 0) {
    await b.key("Escape", { keyCode: 27 });
    await sleep(150);
  }
  await openCellDropdown();

  /* "There is no way to remove a group" — from the dropdown, two presses, and the tag it
     held goes with it. A press on a row that is *already* expanded would collapse it, so
     the state is read before the press and the press is only made when it is closed. */
  const beforeDeletePress = await b.evaluate(
    `document.querySelector('.db-option-group-row[data-group-row="grp-complete"] .db-group-name')?.getAttribute('aria-expanded') ?? null`,
  );
  if (beforeDeletePress !== "true") {
    await b.mouse(...Object.values(await pointIn('.db-option-group-row[data-group-row="grp-complete"] .db-group-name')));
    await sleep(220);
  }
  const expandedForDelete = await b.evaluate(
    `document.querySelector('.db-option-group-row[data-group-row="grp-complete"] .db-group-name')?.getAttribute('aria-expanded') ?? null`,
  );
  b.check(
    "the Complete group can be expanded in the dropdown",
    expandedForDelete === "true",
    `expanded=${expandedForDelete} beforePress=${beforeDeletePress}`,
  );
  await clickMenu("Delete group");
  await sleep(200);
  const stillThere = await stored();
  b.check(
    "one press on Delete group in the dropdown deletes nothing",
    stillThere.groups.some((group) => group.id === "grp-complete"),
    JSON.stringify(stillThere.groups.map((group) => group.name)),
  );
  const confirm = (await menuLabels()).find((item) => item.label.startsWith("Delete Complete"));
  b.check(
    "the dropdown's confirm row names the tag it would take",
    confirm?.label === "Delete Complete and its 1 tag",
    JSON.stringify(confirm),
  );
  if (!confirm) throw new Error("no confirm row for deleting Complete");
  await clickMenu(confirm.label);
  const afterDelete = await waitStored(
    (state) => !state.groups.some((group) => group.id === "grp-complete"),
    "the group was deleted from the dropdown",
  );
  b.check(
    "the second press removes the group and its tag from the config",
    !afterDelete.groups.some((group) => group.id === "grp-complete") &&
      !afterDelete.options.some((option) => option.name === "Shipped"),
    JSON.stringify({ groups: afterDelete.groups.map((g) => g.name), tags: afterDelete.options.map((o) => o.name) }),
  );
  b.check(
    "the cell that held the deleted tag is cleared on the server",
    !Object.values(afterDelete.rows).includes(shipped?.id),
    JSON.stringify(afterDelete.rows),
  );
  b.check(
    "the dropdown stayed open and is still exactly one surface",
    (await surfaceCount()) === 1,
    `surfaces=${await surfaceCount()}`,
  );
  await b.shot(`dropdown-groups-after-delete-${width}`);

  b.check(
    "nothing the probe did was blocked by the write guard",
    (await b.blockedWrites()).length === 0,
    JSON.stringify(await b.blockedWrites()),
  );
} catch (error) {
  /* `report()` ends the process, so a throw inside the body used to be swallowed and the run
     still printed OK — see docs/TESTING.md. An exception is a failure of the probe itself. */
  b.check("the probe itself ran to the end without throwing", false, String(error?.stack ?? error));
} finally {
  await b.report();
}
