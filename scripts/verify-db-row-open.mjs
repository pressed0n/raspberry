// A row opens from its `Open` button and from nowhere else.
//
// Usage:
//   BASE=http://127.0.0.1:3106 PAGE=<page id> node scripts/verify-db-row-open.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-row-open-probe.ps1
//
// THE OWNER'S REPORT
//   "A lot of the times when editing different cells i accidentally or even intentionally
//    double click, which throws me inside the page ... i should only be able to open up the
//    page by clicking the designated open button which we already have."
//
// WHY EVERY CHECK HERE IS A GESTURE AND NOT A SOURCE READ
//   The `<tr>` carried `onDoubleClick`. Nothing about the markup says *which* presses reach
//   it: a double press inside a cell, on a checkbox, on the filler strip — all of them bubble
//   to the row. So each one is tried, separately, with a pointer that counts the second press
//   as the second (`b.doubleMouse`), and the claim is always the same one: the address bar
//   still names the page we are on.
//
// WHY IT ALSO PRESSES `Open`
//   Deleting a handler is easy to do too well. The route that is supposed to work is asserted
//   in the same run, on the same row, so "nothing opens the page" cannot pass as a fix.
//
// WRITES: none. It types into a cell and abandons the edit with `Escape` (the input's own
// cancel), and it opens a page — both are navigation, not data. The runner still starts a
// disposable copy (:3106) because reading is not the only thing a probe may accidentally do.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3106";
const pageId = process.env.PAGE;
if (!pageId) throw new Error("PAGE=<page id> is required — run scripts/seed-qa-checkbox.mjs first");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

/** A row, found the way a person reads it — by the name in its title cell. */
const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

const here = () => b.evaluate("location.hash");

/** The centre of one control inside one row, after scrolling it into view — and whether a
 *  press there would land on it. At 390 the table scrolls sideways, so "on screen" is the
 *  wrong claim; "the press reaches it" is the claim that matters. */
const pointAt = (title, selector) => b.evaluate(`(() => {
  const row = ${ROW(title)};
  if (!row) return null;
  const el = row.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, reachable: !!hit && (hit === el || el.contains(hit)) };
})()`);

/** Every press is conditional. On a tree that navigates on the gesture the row the probe
 *  meant to press is gone by the next section, and a probe that throws there reports one
 *  failure instead of the eight it was written to report. */
function pressable(label, point) {
  const ok = !!point && point.reachable === true;
  b.check(`${label} is pressable at this width`, ok, JSON.stringify(point));
  return ok;
}

/** What the address bar says after one gesture, and whether the table is still drawn. */
async function state() {
  return b.evaluate(`({
    hash: location.hash,
    rows: document.querySelectorAll('tr[data-row-id]').length,
    active: document.activeElement?.className ?? null,
  })`);
}

try {
  await b.waitFor(`document.querySelectorAll('tr[data-row-id]').length >= 3`, { timeoutMs: 15000, label: "three seeded rows" });
  const home = await here();

  /* ---------------------------------------------------------------------------
     1. A row is not dressed as a link.
     ---------------------------------------------------------------------------
     `.db-row-open { cursor: pointer }` put a link cursor on every cell of every row. A
     pointer cursor is a promise that a press goes somewhere; each press here goes to the
     cell it landed on. */
  const cursors = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    const cell = row.querySelector('td.db-cell:not(.db-gutter)');
    return {
      row: getComputedStyle(row).cursor,
      cell: getComputedStyle(cell).cursor,
      cellText: cell.className,
    };
  })()`);
  b.check(
    "the row does not wear a pointer cursor",
    cursors.row !== "pointer" && cursors.cell !== "pointer",
    `row ${cursors.row} / cell ${cursors.cell} (${cursors.cellText})`,
  );

  /* ---------------------------------------------------------------------------
     2. A double press inside a text cell — the owner's actual gesture.
     ---------------------------------------------------------------------------
     Press once: the field takes focus, which is what a press in a cell is for. Type: the
     draft is live and uncommitted. Then a double press on the same pixel, which is how a
     word gets selected. Before the fix the second press bubbled to the row and the page
     changed, taking the half-typed value with it. */
  const TEXT = "td:not(.db-cell-name) input.db-cell-input";
  const note = await pointAt("Ticked", TEXT);
  if (!pressable("the text cell", note)) {
    throw new Error("the text cell could not be pressed; every claim below describes a press inside a cell");
  }

  await b.mouse(note.x, note.y);
  await sleep(200);
  await b.type("abc");
  await sleep(150);
  const typed = await state();
  b.check("a press in a text cell puts the caret in it", typed.active?.includes("db-cell-input") === true, typed.active);

  await b.doubleMouse(note.x, note.y);
  await sleep(400);
  const afterDouble = await state();
  b.check(
    "a double press inside a text cell does not leave the table",
    afterDouble.hash === home,
    `${home} → ${afterDouble.hash}`,
  );
  b.check("and the table is still drawn", afterDouble.rows >= 3, String(afterDouble.rows));
  b.check("and the caret is still in the field it was typed in", afterDouble.active?.includes("db-cell-input") === true, afterDouble.active);
  const draft = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    return row?.querySelector('td:not(.db-cell-name) input.db-cell-input')?.value ?? null;
  })()`);
  b.check("and the half-typed value is still there", draft === "abc", JSON.stringify(draft));

  /* Leave the edit the way the editor's own Escape leaves it: draft reset, blur, no write. */
  await b.key("Escape", { code: "Escape", keyCode: 27 });
  await sleep(250);

  /* ---------------------------------------------------------------------------
     3. A double press on the name — the gesture people try first.
     ---------------------------------------------------------------------------
     This one is the most likely to be "fixed" by wiring the name cell to the page, which is
     the same bug wearing a smaller target. The name is where a rename starts. */
  const name = await pointAt("Cleared", ".db-name-cell input");
  if (pressable("the name cell", name)) {
    await b.doubleMouse(name.x, name.y);
    await sleep(400);
    const afterName = await state();
    b.check(
      "a double press on a row's name does not open it",
      afterName.hash === home,
      `${home} → ${afterName.hash}`,
    );
    b.check("and the name is still the field that renames it", afterName.active?.includes("db-cell-input") === true, afterName.active);
  } else {
    b.check("a double press on a row's name does not open it", false, "the name cell could not be pressed");
    b.check("and the name is still the field that renames it", false, "the name cell could not be pressed");
  }

  /* ---------------------------------------------------------------------------
     4. A double press on a value tick.
     ---------------------------------------------------------------------------
     A checkbox is the cell most often pressed twice, because one press is the whole value.
     Its `onClick` does not stop propagation, so a handler on the `<tr>` saw both presses. The
     claim measured here is the address bar only: whether two presses commit once or twice
     depends on a server round trip, and that is not what this probe is about. */
  const tick = await pointAt("Ticked", "button.db-check");
  if (tick?.reachable) {
    await b.doubleMouse(tick.x, tick.y);
    await sleep(400);
    const afterTick = await state();
    b.check("a double press on a value tick does not open the row", afterTick.hash === home, `${home} → ${afterTick.hash}`);
  } else {
    b.check("the value tick is reachable at this width", false, JSON.stringify(tick));
  }

  /* ---------------------------------------------------------------------------
     5. A `dblclick` event, dispatched straight at the row.
     ---------------------------------------------------------------------------
     A real gesture can be eaten by something in between — an overlay, a focus trap, a stale
     scroll offset. This one cannot: it is the event the handler would have listened for, on
     the element that would have listened for it. */
  const synthetic = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    const cell = row?.querySelector('td.db-cell:not(.db-gutter)');
    if (!cell) return { hash: location.hash, dispatched: false };
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window, detail: 2 }));
    return { hash: location.hash, dispatched: true };
  })()`);
  await sleep(400);
  b.check(
    "a `dblclick` event on the row's own markup opens nothing",
    synthetic.dispatched && synthetic.hash === home && (await here()) === home,
    `${home} → ${synthetic.hash} → ${await here()}`,
  );

  /* ---------------------------------------------------------------------------
     6. The route that is supposed to work still works.
     ---------------------------------------------------------------------------
     `Open` is revealed on hover and takes no clicks until it is: a button that is invisible
     must not be a button you can press by accident. Both halves are asserted — hidden and
     inert before the pointer arrives, visible and pressable after. The pointer is parked at the
     corner first, because sections 2-4 pressed inside this very row and `.db-row:hover` is
     still on until it leaves -- and the tick they pressed still has focus, which reveals the
     button through `.db-row:focus-within`. Both have to be given up before "invisible" is a
     statement about the stylesheet rather than about what the probe left behind. */
  await b.evaluate("document.activeElement instanceof HTMLElement && document.activeElement.blur()");
  await b.move(2, 2);
  await sleep(300);
  const button = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    const el = row?.querySelector('.db-open');
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), opacity: cs.opacity, events: cs.pointerEvents, label: el.textContent.trim() };
  })()`);
  b.check("the row carries an `Open` button", !!button, button ? `"${button.label}" at ${button.x},${button.y}` : "no `.db-open` in the row");
  b.check("and it is named, not a bare glyph", button?.label === "Open", JSON.stringify(button?.label));
  b.check(
    "and it takes no presses while it is invisible",
    button?.events === "none",
    `pointer-events ${button?.events} at opacity ${button?.opacity}`,
  );

  await b.move(button?.x ?? 2, button?.y ?? 2);
  await sleep(300);
  const revealed = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    const el = row?.querySelector('.db-open');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return { opacity: cs.opacity, events: cs.pointerEvents, onTop: !!hit && (hit === el || el.contains(hit)) };
  })()`);
  b.check(
    "hovering the row reveals the `Open` button",
    !!revealed && revealed.opacity === "1" && revealed.events !== "none" && revealed.onTop,
    JSON.stringify(revealed),
  );

  await b.shot(`row-open-${width}`);

  if (button) {
    await b.mouse(button.x, button.y);
    await sleep(700);
  }
  const opened = await here();
  b.check(
    "pressing `Open` opens the row's page",
    !!button && opened !== home && /^#[0-9a-f-]{36}$/i.test(opened),
    `${home} → ${opened}`,
  );

  /* ---------------------------------------------------------------------------
     7. And nothing the probe did was refused by the live-write guard.
     ---------------------------------------------------------------------------
     The probe types into a cell; on :3106 the guard is not armed. If this ever runs against
     the live port, the typing is refused and this check names it instead of leaving a silent
     failure behind. */
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
