// The Checkbox cell: a box that is centred in its cell, and stays put when it is ticked.
//
// Usage:
//   BASE=http://127.0.0.1:3105 PAGE=<page id> DB=<database id> BOX=<property id> \
//     node scripts/verify-db-checkbox.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-checkbox-probe.ps1
//
// WHY IT WRITES: the owner's second complaint was that the *same* control lands on a
// different pixel depending on its value. That cannot be checked by looking at one state:
// it is a claim about two renderings of the same box. So section 4 reads the geometry, presses
// the tick, reads it again, presses it back and reads it a third time — and every write is
// also read back from `/api/databases`, because a tick that only repainted the local copy
// would pass a DOM-only assertion.
//
// WHAT IT DOES NOT DO: it never touches a database it did not seed. The runner starts a
// disposable copy on :3105 with its own sqlite file (docs/TESTING.md).
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3105";
const pageId = process.env.PAGE;
const databaseId = process.env.DB;
const boxId = process.env.BOX;
if (!pageId || !databaseId || !boxId) {
  throw new Error("PAGE=<page id> DB=<database id> BOX=<checkbox property id> are required — run scripts/seed-qa-checkbox.mjs first");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The cells as the *server* holds them. The only source any claim about a write trusts. */
async function stored() {
  const response = await fetch(`${BASE}/api/databases/${databaseId}`, { headers: { origin: BASE } });
  if (!response.ok) throw new Error(`GET /api/databases/${databaseId} → ${response.status}`);
  const payload = await response.json();
  const database = payload.database ?? payload;
  return Object.fromEntries(database.rows.map((row) => [row.title, row.cells?.[boxId] ?? null]));
}

const b = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

/** A row, found the way a person reads it — by the name in its title cell.
 *
 *  The title is an `<input value="…">`, not a text node, so `textContent` cannot find it:
 *  matching on text found nothing and reported failures that were all the probe. */
const ROW = (title) => `[...document.querySelectorAll('tr[data-row-id]')].find((node) => {
  const name = node.querySelector('.db-name-cell input')?.value
    ?? node.querySelector('.db-name-cell .db-cell-text')?.textContent
    ?? '';
  return name.trim() === ${JSON.stringify(title)};
})`;

/** Everything about one tick, measured: its own box, the cell that holds it, and the cell's
 *  content box (which is what "centred in the cell" has to mean — a 32px row with a 1px
 *  border has 31px of inside).
 *
 *  `settle` rounds to hundredths; a sub-pixel claim made in floats that never compare equal
 *  is a test that fails for arithmetic reasons rather than for a layout one. */
const geometry = (title) => b.evaluate(`(() => {
  const row = ${ROW(title)};
  if (!row) return null;
  const cell = row.querySelector('td[data-property-id="${boxId}"]');
  const tick = cell?.querySelector('.db-check');
  if (!cell || !tick) return null;
  const cr = cell.getBoundingClientRect();
  const tr = tick.getBoundingClientRect();
  const cs = getComputedStyle(cell);
  const bt = parseFloat(cs.borderTopWidth) || 0;
  const bb = parseFloat(cs.borderBottomWidth) || 0;
  /* The neighbouring *text* control, and its own padding — because the inset that matters is
     not the number "10", it is "the pixel where the first glyph of every other column
     starts". Comparing *box* edges would be comparing the wrong thing: a text input spans
     its whole cell and carries the 10px as padding, while the tick has no width to span. The
     name column is skipped on purpose — its values start at 29px, behind the entry icon, so
     it is the one cell that is not the reference. */
  const other = [...row.querySelectorAll('td')]
    .find((node) => node !== cell && !node.classList.contains('db-cell-name') && node.querySelector('.db-cell-input'));
  const field = other?.querySelector('.db-cell-input');
  const r = (n) => Math.round(n * 100) / 100;
  return {
    checked: tick.getAttribute('aria-checked'),
    box: { w: r(tr.width), h: r(tr.height) },
    cellH: r(cr.height),
    topGap: r(tr.top - (cr.top + bt)),
    bottomGap: r((cr.bottom - bb) - tr.bottom),
    tickCy: r(tr.top + tr.height / 2),
    cellCy: r(cr.top + bt + (cr.height - bt - bb) / 2),
    tickInset: r(tr.left - (cr.left + (parseFloat(cs.borderLeftWidth) || 0))),
    textInset: field ? r(parseFloat(getComputedStyle(field).paddingLeft)) : null,
  };
})()`);

/** Centre of the tick in one row, and a promise that a press there reaches the tick itself. */
const tickAt = (title) => b.evaluate(`(() => {
  const row = ${ROW(title)};
  const tick = row?.querySelector('td[data-property-id="${boxId}"] .db-check');
  if (!tick) return null;
  tick.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = tick.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  return { x, y, reachable: !!hit && (hit === tick || tick.contains(hit)) };
})()`);

async function press(title) {
  const at = await tickAt(title);
  if (!at) throw new Error(`no tick in the "${title}" row`);
  if (!at.reachable) throw new Error(`the "${title}" tick is at ${at.x},${at.y} but something else is on top of it`);
  await b.mouse(at.x, at.y);
  await sleep(220);
}

try {
  await b.waitFor(`document.querySelectorAll('tr[data-row-id]').length >= 3`, { timeoutMs: 15000, label: "three seeded rows" });

  /* ---------------------------------------------------------------------------
     1. The column draws a box at all, in the three states a checkbox actually has.
     ---------------------------------------------------------------------------
     `true`, `false` and `null` — a row nobody has touched. The third renders the same empty
     box as the second, and a fix that moved one and not the other would be invisible unless
     all three are measured. */
  const ticked = await geometry("Ticked");
  const cleared = await geometry("Cleared");
  const untouched = await geometry("Untouched");
  b.check("all three rows draw a tick", [ticked, cleared, untouched].every(Boolean), JSON.stringify([ticked, cleared, untouched]));
  b.check(
    "the value decides the tick, not the presence of the box",
    ticked?.checked === "true" && cleared?.checked === "false" && untouched?.checked === "false",
    `${ticked?.checked} / ${cleared?.checked} / ${untouched?.checked}`,
  );
  b.check("the box is 15x15", [ticked, cleared, untouched].every((g) => g && g.box.w === 15 && g.box.h === 15), JSON.stringify(ticked?.box));

  /* ---------------------------------------------------------------------------
     2. Vertically centred — the owner's first complaint.
     ---------------------------------------------------------------------------
     "Centred" has to be about the cell's *content* box: the row is 32px tall with a 1px
     border, so the inside is 31px and the box needs 8 above and 8 below. Before the fix the
     gaps were 4 and 12. */
  for (const [label, g] of [["ticked", ticked], ["unticked", cleared], ["untouched", untouched]]) {
    b.check(
      `the ${label} box has equal space above and below it`,
      !!g && Math.abs(g.topGap - g.bottomGap) <= 0.5,
      `top ${g?.topGap} / bottom ${g?.bottomGap} in a ${g?.cellH}px row`,
    );
    b.check(
      `the ${label} box is on the cell's centre line`,
      !!g && Math.abs(g.tickCy - g.cellCy) <= 0.5,
      `box centre ${g?.tickCy} / cell centre ${g?.cellCy}`,
    );
  }

  /* ---------------------------------------------------------------------------
     3. One position, two values — the owner's second complaint.
     ---------------------------------------------------------------------------
     This is the assertion the whole probe exists for. An `inline-grid` sits on the text
     baseline, and its baseline is the bottom edge when empty but the `✓`'s own baseline when
     ticked, so the same control drew 2.5px lower once it was checked. A tick that is a flex
     item cannot: no text line reaches it. */
  const tops = [ticked, cleared, untouched].map((g) => g?.topGap);
  b.check(
    "a ticked box and an unticked box sit on the same pixel",
    Math.abs(tops[0] - tops[1]) <= 0.5 && Math.abs(tops[1] - tops[2]) <= 0.5,
    `top gaps ${tops.join(" / ")}`,
  );

  /* ---------------------------------------------------------------------------
     4. Press it: the write lands, and nothing moves.
     ---------------------------------------------------------------------------
     The bug was a position that depended on the value, so the check has to be *after* the
     value changed — measured on the same element, in the same session, at the same scroll
     offset. */
  const before = await geometry("Cleared");
  await press("Cleared");
  await b.waitFor(`(() => {
    const row = ${ROW("Cleared")};
    return row?.querySelector('td[data-property-id="${boxId}"] .db-check')?.getAttribute('aria-checked') === 'true';
  })()`, { timeoutMs: 5000, label: "the tick to turn on" });
  const afterOn = await geometry("Cleared");
  b.check("pressing an unticked box ticks it", afterOn?.checked === "true", afterOn?.checked);
  b.check("the server stored `true`", (await stored()).Cleared === true, JSON.stringify(await stored()));
  b.check(
    "and the box did not move by a single pixel",
    !!before && !!afterOn && Math.abs(before.topGap - afterOn.topGap) <= 0.5 && Math.abs(before.tickCy - afterOn.tickCy) <= 0.5,
    `${before?.topGap} → ${afterOn?.topGap}`,
  );

  await press("Cleared");
  await b.waitFor(`(() => {
    const row = ${ROW("Cleared")};
    return row?.querySelector('td[data-property-id="${boxId}"] .db-check')?.getAttribute('aria-checked') === 'false';
  })()`, { timeoutMs: 5000, label: "the tick to turn off" });
  const afterOff = await geometry("Cleared");
  b.check("pressing a ticked box clears it", afterOff?.checked === "false", afterOff?.checked);
  b.check("the server stored `false` — not `null`", (await stored()).Cleared === false, JSON.stringify(await stored()));
  b.check(
    "and it is back on exactly the pixel it started on",
    !!before && !!afterOff && Math.abs(before.topGap - afterOff.topGap) <= 0.5,
    `${before?.topGap} → ${afterOff?.topGap}`,
  );

  /* Every row again, after two writes: the column's geometry is a property of the column. */
  const settled = await Promise.all(["Ticked", "Cleared", "Untouched"].map((title) => geometry(title)));
  b.check(
    "all three still share one top offset after the writes",
    settled.every((g) => g && Math.abs(g.topGap - settled[0].topGap) <= 0.5),
    settled.map((g) => g?.topGap).join(" / "),
  );

  /* ---------------------------------------------------------------------------
     5. It starts where every other value in the row starts.
     ---------------------------------------------------------------------------
     The left inset was `margin-left: 10px` on the tick itself. Moving the box into a wrapper
     is the kind of change that quietly shifts a column 1px, so the claim is not "10px" — it is
     "the same inset the text field beside it has". */
  b.check(
    "the tick's left inset matches the text control beside it",
    settled.every((g) => g && g.textInset !== null && Math.abs(g.tickInset - g.textInset) <= 0.5),
    settled.map((g) => `${g?.tickInset} vs ${g?.textInset}`).join(" / "),
  );

  /* ---------------------------------------------------------------------------
     6. The other tick on the row did not move.
     ---------------------------------------------------------------------------
     `.db-check` is one class with two jobs: a *value* here, and the row's own select box in
     the gutter, which is a flex item of `.db-gutter-inner` and was already centred. This fix
     changed the cell, not the class — and the gutter probe asserts the rest of that shelf. */
  const gutter = await b.evaluate(`(() => {
    const row = ${ROW("Ticked")};
    const tick = row?.querySelector('.db-gutter .db-check');
    if (!tick) return null;
    const tr = tick.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return { cy: Math.round((tr.top + tr.height / 2) * 100) / 100, rowCy: Math.round((rr.top + rr.height / 2) * 100) / 100 };
  })()`);
  b.check(
    "the row's own select box is still on the row's centre",
    !!gutter && Math.abs(gutter.cy - gutter.rowCy) <= 1,
    `gutter ${gutter?.cy} / row ${gutter?.rowCy}`,
  );

  await b.shot(`checkbox-${width}`);

  /* ---------------------------------------------------------------------------
     7. Reachable at this width, and nothing the probe did was refused.
     ---------------------------------------------------------------------------
     At 390 the table scrolls sideways, so "inside the viewport" is the wrong claim — a
     column that is off-screen until you scroll is a phone table, not a bug. The claim that
     matters is that the tick becomes pressable once the table is scrolled to it, which is
     what `tickAt` proves: it scrolls, then asks `elementFromPoint` whether the press would
     land on the tick rather than on something stacked over it. Three earlier probes
     "passed" by clicking a coordinate outside the page; this is the check that refuses. */
  const reach = await tickAt("Ticked");
  b.check("the tick is pressable at this width once the table is scrolled to it", !!reach && reach.reachable, JSON.stringify(reach));

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
