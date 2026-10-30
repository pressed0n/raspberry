// The database row gutter, driven by a real mouse. Tracked, canonical version.
//
// Usage: node scripts/verify-db-gutter.mjs [width] [height]
//
// This is the probe `docs/TESTING.md` points at. It replaces the copy-pasted pattern of
// scripts/scratch/cdp-db-gutter.mjs: same assertions, but the spawn, transport, input and
// cleanup come from scripts/browser-session.mjs — so it cannot leak a Chrome profile, and it
// reports a score that exits non-zero.
//
// READ-ONLY BY CONSTRUCTION. It never clicks a control that writes: it hovers, measures and
// screenshots. Per AGENTS.md, the way to prove a write is to intercept the request and
// assert the body — never to modify the owner's database.
//
// What it asserts, and why each one is a pixel rather than a class name:
//
//   1. the controls are invisible at rest, visible on hover with real mouse events;
//   2. the table's left edge is the content's left edge — the owner's actual complaint;
//   3. the pair in the row is the *editor's own* pair: same glyph path data, same 39x30
//      split into 19.5+19.5, same `+`-then-grip order compared against BlockNote's own side
//      menu. A redrawn copy can match one of those; matching all of them is what "reused the
//      component" means;
//   4. the three controls share one vertical centre;
//   5. header row and data rows are the same height.
//
// Below 860px the page pays for the shelf instead of the cell, so the width-dependent
// assertions flip deliberately rather than being skipped.

import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const PAGE = process.env.RASPBERRY_PAGE ?? "http://127.0.0.1:3000/#cf8dae6b-0466-452b-9dd6-61b61fa4a52b";

const b = await openBrowser({ url: PAGE, width, height });
const wide = width > 860;

await b.waitFor(`!!document.querySelector(".db-row")`, { label: "a database row on the page" });
await new Promise((r) => setTimeout(r, 250));

/* ---- 1. invisible at rest ------------------------------------------------- */

const atRest = await b.evaluate(`(() => {
  const row = document.querySelector(".db-row");
  return [...row.querySelectorAll(".db-gutter .frame-grip, .db-gutter .db-check")]
    .map((el) => Number(getComputedStyle(el).opacity));
})()`);
b.check("gutter controls are invisible at rest",
  atRest.length >= 3 && atRest.every((o) => o === 0), JSON.stringify(atRest));

/* ---- 2. alignment: the grid starts where the content starts --------------- */

const align = await b.evaluate(`(() => {
  const x = (el) => el ? +el.getBoundingClientRect().x.toFixed(1) : null;
  const row = document.querySelector(".db-row");
  const tab = [...document.querySelectorAll("button,[role=tab]")]
    .find((el) => /^table$/i.test((el.textContent || "").trim()));
  const table = document.querySelector(".db-table");
  const anchor = row.querySelector(".db-gutter-inner .frame-anchor");
  const block = document.querySelector(".db-block");
  const cs = getComputedStyle(block);
  return {
    content: x(document.querySelector(".bn-editor")),
    tab: x(tab),
    tableLeft: x(table),
    nameCell: x(row.querySelector(".db-cell-name")),
    gutterW: +row.querySelector(".db-gutter").getBoundingClientRect().width.toFixed(1),
    anchorLeft: x(anchor),
    anchorRight: +anchor.getBoundingClientRect().right.toFixed(1),
    shelf: cs.getPropertyValue("--db-shelf").trim(),
    borrow: cs.getPropertyValue("--db-borrow").trim(),
    col: cs.getPropertyValue("--db-col").trim(),
    docPadStart: getComputedStyle(document.querySelector(".doc")).paddingInlineStart,
  };
})()`);

b.check("the table's left edge is the content's left edge",
  Math.abs(align.tableLeft - align.content) <= 0.5 && Math.abs(align.tab - align.content) <= 0.5,
  `content ${align.content}, tab ${align.tab}, table ${align.tableLeft}`);
b.check("the Name column starts on the content's left edge",
  Math.abs(align.nameCell - align.content) <= 0.5,
  `name ${align.nameCell} vs content ${align.content}`);
b.check("the gutter column itself is zero wide", align.gutterW === 0, `${align.gutterW}px`);
b.check("the pair hangs left of the table's left edge",
  align.anchorRight <= align.tableLeft + 0.5 && align.anchorLeft < align.tableLeft,
  `pair ${align.anchorLeft}..${align.anchorRight}, table ${align.tableLeft}`);
b.check("--db-shelf/--db-borrow/--db-col are 60/60/0 at every width",
  align.shelf === "60px" && align.borrow === "60px" && align.col === "0px",
  `${align.shelf} / ${align.borrow} / ${align.col}`);
if (!wide) {
  b.check("on a phone the page's own margin pays for the shelf, not the cell",
    Number.parseFloat(align.docPadStart ?? "0") >= 60,
    `doc padding-inline-start ${align.docPadStart}`);
}

/* ---- 3. hover, with a real mouse ----------------------------------------- */

const box = await b.evaluate(`(() => {
  const r = document.querySelector(".db-row").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`);
await b.move(box.x, box.y);
await new Promise((r) => setTimeout(r, 350)); // 100ms opacity transition, plus room

const hovered = await b.evaluate(`(() => {
  const inner = document.querySelector(".db-row .db-gutter-inner");
  const pair = inner.querySelector(".frame-anchor");
  const geo = (el) => {
    const r = el.getBoundingClientRect();
    const svg = el.querySelector("svg");
    return {
      cls: String(el.className), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      cx: +(r.x + r.width / 2).toFixed(2), cy: +(r.y + r.height / 2).toFixed(2),
      opacity: Number(getComputedStyle(el).opacity),
      svg: svg ? {
        w: svg.getAttribute("width"), h: svg.getAttribute("height"),
        fill: svg.getAttribute("fill"), stroke: svg.getAttribute("stroke"),
        paths: [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      } : null,
    };
  };
  const side = document.querySelector(".bn-side-menu");
  const pr = pair && pair.getBoundingClientRect();
  return {
    parts: [...inner.children].map(geo),
    buttons: pair ? [...pair.children].filter((el) => el.tagName === "BUTTON").map(geo) : [],
    innerDisplay: getComputedStyle(inner).display,
    pairClass: pair ? String(pair.className) : null,
    pair: pr ? { w: +pr.width.toFixed(2), h: +pr.height.toFixed(2) } : null,
    rowPaths: pair ? [...pair.querySelectorAll("button svg path")].map((p) => p.getAttribute("d")) : [],
    sidePaths: side ? [...side.querySelectorAll("button svg path")].map((p) => p.getAttribute("d")) : null,
  };
})()`);

const [pairBox, tick] = hovered.parts;
const [plus, grip] = hovered.buttons;

b.check("gutter is pair-then-checkbox",
  hovered.parts.length === 2 && pairBox.cls.includes("frame-anchor") && tick.cls.includes("db-check"),
  hovered.parts.map((p) => p.cls).join(" » "));
b.check("the pair is `.frame-anchor`, positioned by its host",
  hovered.pairClass === "frame-anchor frame-anchor--inline", hovered.pairClass);
b.check("the pair is exactly 39x30",
  hovered.pair?.w === 39 && hovered.pair?.h === 30, `${hovered.pair?.w}x${hovered.pair?.h}`);
b.check("the pair holds `+` then grip — the editor's order",
  hovered.buttons.length === 2 && plus.cls.includes("frame-add") && grip.cls.includes("db-grip"),
  hovered.buttons.map((el) => el.cls).join(" » "));
b.check("the shelf is one flex row", hovered.innerDisplay === "flex", hovered.innerDisplay);
b.check("plus, grip and checkbox share a vertical centre (≤0.5px)",
  Math.abs(plus.cy - grip.cy) <= 0.5 && Math.abs(grip.cy - tick.cy) <= 0.5,
  `+ ${plus.cy} / grip ${grip.cy} / check ${tick.cy}`);
b.check("all three are visible on hover",
  hovered.buttons.every((el) => el.opacity === 1) && pairBox.opacity === 1 && tick.opacity === 1,
  [...hovered.buttons.map((el) => el.opacity), tick.opacity].join(","));

/* ---- 4. it is the editor's own pair, compared against the editor ---------- */

if (hovered.sidePaths && hovered.sidePaths.length) {
  b.check("same glyph path data as BlockNote's own side menu",
    JSON.stringify(hovered.rowPaths) === JSON.stringify(hovered.sidePaths),
    `${hovered.rowPaths.length} paths vs ${hovered.sidePaths.length}`);
} else {
  console.log("  SKIP side-menu comparison — no `.bn-side-menu` in the DOM to compare against");
}

b.check("each button is 19.5x30 (39px pair, split)",
  [plus.w, grip.w].every((w) => Math.abs(w - 19.5) <= 0.05) && plus.h === 30 && grip.h === 30,
  `+ ${plus.w}x${plus.h}, grip ${grip.w}x${grip.h}`);
b.check("checkbox is 15x15", tick.w === 15 && tick.h === 15, `${tick.w}x${tick.h}`);
b.check("grip glyph is the shared 18x22 filled six-dot",
  grip.svg?.w === "18" && grip.svg?.h === "22" && grip.svg?.fill === "currentColor" &&
  grip.svg?.stroke === "none" && grip.svg?.paths.some((d) => d.startsWith("M11 18c0 1.1")),
  JSON.stringify({ w: grip.svg?.w, h: grip.svg?.h, fill: grip.svg?.fill }));
b.check("`+` glyph is the shared 18x22 AddGlyph",
  plus.svg?.w === "18" && plus.svg?.h === "22" && plus.svg?.fill === "currentColor" &&
  plus.svg?.stroke === "none" && plus.svg?.paths.some((d) => d.startsWith("M192 474h672")),
  JSON.stringify({ w: plus.svg?.w, h: plus.svg?.h, fill: plus.svg?.fill }));
b.check("the pair's two buttons abut (no gap inside the pair)",
  Math.abs((grip.cx - plus.cx) - 19.5) <= 0.05, `centres ${plus.cx} / ${grip.cx}`);

/* ---- 5. header and rows are the same height ------------------------------ */

/* 1px, not equality: row heights land on half pixels (33 vs 32.5) because a 1px border on
   an odd-height box is laid out at subpixel precision, and the original probe allowed it for
   exactly this reason. Asserting strict equality here would fail on correct layout — an
   assertion stricter than reality gets deleted, not fixed. */
const heights = await b.evaluate(`(() => {
  const h = (el) => +el.getBoundingClientRect().height.toFixed(1);
  const head = document.querySelector(".db-table thead tr");
  const rows = [...document.querySelectorAll(".db-table tbody tr.db-row")];
  return { head: head ? h(head) : null, rows: rows.map(h) };
})()`);
b.check("the header row is the same height as every data row (≤1px)",
  heights.head !== null && heights.rows.length > 0 &&
  heights.rows.every((h) => Math.abs(h - heights.head) <= 1),
  `head ${heights.head}, rows ${heights.rows.join("/")}`);

await b.shot(`gutter-${width}`);
await b.report();
