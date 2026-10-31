// The strip above and below a database block must not select it.
//
// Usage: node scripts/verify-db-topstrip.mjs [width] [height]
//
// READ-ONLY, by construction: the session refuses every non-GET on the live port, and this
// probe only presses. It types nothing and never touches a control that writes.
//
// WHY THIS EXISTS
//   The owner, twice: "There is still a very small hitbox at the top of the database block
//   that when pressed will highlight the database object and it will be stuck in that
//   highlighted state until the page is refreshed."
//   The guard was attached to `.db-block`, but the six pixels above it — `.db-block`'s own
//   4px margin plus `.bn-block-content`'s 2px padding — are outside `.db-block` and inside
//   `.tiptap`, so ProseMirror turned them into a `NodeSelection` on the database. Clicking
//   the block could not clear it afterwards, because the guard (correctly) swallows those
//   presses. A DOM test cannot see this: the element, the listener and the geometry were
//   all "correct"; only a real press at a real pixel showed it.
import { openBrowser } from "./browser-session.mjs";

const W = Number(process.argv[2] ?? 1400);
const H = Number(process.argv[3] ?? 900);
const PAGE = process.env.RASPBERRY_PAGE ?? "http://127.0.0.1:3000/#cf8dae6b-0466-452b-9dd6-61b61fa4a52b";

const b = await openBrowser({ url: PAGE, width: W, height: H });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SELECTION = `(() => {
  const sel = document.querySelector(".ProseMirror-selectednode");
  return sel ? (sel.getAttribute("data-content-type") ?? String(sel.className).slice(0, 40)) : null;
})()`;

try {
  await b.waitFor("!!document.querySelector('.db-block')", { timeoutMs: 25000, label: "db block" });
  await sleep(1200);

  const geo = await b.evaluate(`(() => {
    const block = document.querySelector(".db-block");
    const band = block.closest(".bn-block-content");
    const rb = block.getBoundingClientRect();
    const rn = band.getBoundingClientRect();
    const cs = getComputedStyle(block);
    return {
      blockTop: rb.top, blockBottom: rb.bottom, blockLeft: rb.left, blockWidth: rb.width,
      bandTop: rn.top, bandBottom: rn.bottom,
      margin: cs.marginTop + " " + cs.marginBottom,
      padding: cs.paddingTop + " " + cs.paddingBottom,
      bandPad: getComputedStyle(band).paddingTop,
    };
  })()`);
  console.log(`  band ${geo.bandTop.toFixed(2)}..${geo.bandBottom.toFixed(2)}  block ${geo.blockTop.toFixed(2)}..${geo.blockBottom.toFixed(2)}  margin=${geo.margin} padding=${geo.padding} bandPad=${geo.bandPad}`);

  /* The block must own the space it occupies: a margin there is a hitbox, not spacing. */
  b.check("db-block has no vertical margin", geo.margin === "0px 0px", geo.margin);

  const x = Math.round(geo.blockLeft + Math.min(300, geo.blockWidth / 2));

  /* Every pixel from 16px above the band to 4px inside the block, and the same at the
     bottom, pressed with real pointer input. Nothing here may select the database. */
  const presses = [];
  for (let y = geo.bandTop - 16; y <= geo.blockTop + 2; y += 1) presses.push({ where: "top", y: Math.round(y) });
  for (let y = geo.blockBottom - 2; y <= geo.bandBottom + 16; y += 1) presses.push({ where: "bottom", y: Math.round(y) });

  let selected = [];
  let selectedAt = [];
  for (const press of presses) {
    /* Spaced past the platform's multi-click window, and reset from a *different* point
       each time: three rapid presses at one place are a triple-click, and ProseMirror
       answers a triple-click by selecting the enclosing block group — a real gesture, but
       not the one under test, and it made the first version of this probe report a bug that
       only the probe could produce. */
    await b.mouse(x, press.y);
    await sleep(90);
    const sel = await b.evaluate(SELECTION);
    if (sel) { selected.push(sel); selectedAt.push(press.where + y0(press.y, geo)); }
    await b.mouse(x, Math.round(geo.bandTop - 60));
    await sleep(620);
  }
  b.check(`no press in the band selects the block (${presses.length} points)`,
    selected.length === 0,
    selected.length ? "selected at " + selectedAt.slice(0, 6).join(", ") : "");

  /* A class-based assertion can pass for the wrong reason — the ring could be renamed and
     this probe would go quiet. So also assert the press is *inert*: park a caret in the
     paragraph above the block, press each point, and require the selection to be exactly
     where it was. An unguarded press moves it into the database node, which is the bug. */
  const caretState = `(() => {
    const s = getSelection();
    if (!s.rangeCount) return "none";
    const n = s.anchorNode;
    return (n?.parentElement?.closest(".bn-block-content")?.getAttribute("data-content-type") ?? "?") + ":" + s.anchorOffset;
  })()`;
  const above = await b.evaluate(`(() => {
    const block = document.querySelector(".db-block");
    const para = [...document.querySelectorAll(".bn-block-content")]
      .find((el) => el.getAttribute("data-content-type") === "paragraph" && el.getBoundingClientRect().top > block.getBoundingClientRect().bottom);
    if (!para) return null;
    const r = para.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (above) {
    const moves = [];
    for (const y of [geo.bandTop + 1, geo.bandTop + 2, geo.blockTop + 1, geo.blockTop + 4]) {
      await b.mouse(above.x, above.y);
      await sleep(650);
      const before = await b.evaluate(caretState);
      await b.mouse(x, Math.round(y));
      await sleep(120);
      const after = await b.evaluate(caretState);
      if (before !== after) moves.push(`${Math.round(y)}: ${before} -> ${after}`);
      await sleep(620);
    }
    b.check("a press in the band leaves the caret untouched", moves.length === 0, moves.join(" · "));
  } else {
    b.check("a block above the database to park a caret in", false, "none found");
  }

  /* The guard must not have swallowed the block's own controls. */
  const title = await b.evaluate(`(() => {
    const el = document.querySelector(".db-title") || document.querySelector(".db-block input");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (title) {
    await b.mouse(title.x, title.y);
    await sleep(200);
    const focused = await b.evaluate(`document.activeElement?.className?.toString().includes("db-title") || document.activeElement?.tagName === "INPUT"`);
    b.check("a press on the title still focuses it", focused === true, String(focused));
  } else {
    b.check("title input present", false, "not found");
  }

  /* And a press on a column header still opens its menu — the other control the guard
     must not eat. Escape closes it, so the page is left as found. */
  const head = await b.evaluate(`(() => {
    const el = document.querySelector(".db-th-label");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (head) {
    await b.mouse(head.x, head.y);
    await sleep(300);
    const open = await b.evaluate(`!!document.querySelector('[role="menu"]')`);
    b.check("a press on a column header still opens its menu", open === true, String(open));
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(200);
    const closed = await b.evaluate(`!document.querySelector('[role="menu"]')`);
    b.check("Escape closes it", closed === true, String(closed));
  } else {
    b.check("column header present", false, "not found");
  }

  const blocked = await b.blockedWrites();
  b.check("nothing tried to write", blocked.length === 0, JSON.stringify(blocked));

  await b.shot("db-topstrip");
  await b.report();
} catch (error) {
  console.log("ERROR " + error.message);
  await b.close();
  process.exit(1);
}

function y0(y, geo) {
  const base = y < (geo.blockTop + geo.blockBottom) / 2 ? geo.blockTop : geo.blockBottom;
  const d = Math.round(y - base);
  return "(" + (d >= 0 ? "+" : "") + d + ")";
}
