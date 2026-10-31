// The property header: no chevron, and a "clicked" fill that outlives the pointer.
//
// Usage: node scripts/verify-db-th-state.mjs [width] [height]
//
// READ-ONLY, by construction: the session refuses every non-GET on the live port. The only
// press this probe makes opens a column menu; it never presses a row, the menu's items, or
// anything that writes.
//
// WHY THIS EXISTS
//   The owner, on the property row: "i would remove the chevron/arrow signaling the dropdown.
//   However i would add a clicked state ... now we have a hover state, lets also add a clicked
//   state which is brighter than hover."
//
//   Two claims are easy to fake in a unit test and impossible to fake here:
//     1. The chevron is gone. A DOM test can assert `.db-th-caret` is absent while the glyph
//        comes back under another class — so this enumerates every <svg> in the label and
//        requires the set to be exactly the property icon plus the sort arrow.
//     2. The open fill is brighter than hover. `--hover` and `--hover-strong` are *translucent*
//        (rgba(255,255,255,.04) against .07), so comparing the computed strings compares
//        alpha, not brightness. This composites each fill over the nearest opaque ancestor
//        and compares relative luminance — the number the eye actually reads — and it holds
//        the pointer *away from the button* while measuring, so a state that is really just
//        hover cannot pass.
import { openBrowser } from "./browser-session.mjs";

const W = Number(process.argv[2] ?? 1400);
const H = Number(process.argv[3] ?? 900);
const PAGE = process.env.RASPBERRY_PAGE ?? "http://127.0.0.1:3000/#cf8dae6b-0466-452b-9dd6-61b61fa4a52b";

const b = await openBrowser({ url: PAGE, width: W, height: H });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LABEL = `button.db-th-label[aria-haspopup="menu"]`;

/* Every svg in the label, and whether any element in it can take space while invisible.
   The removed caret was `opacity: 0`, which does *not* collapse: it reserved 11px plus a
   5px gap on every column, all the time, and only showed itself on hover. */
const ANATOMY = `(() => {
  const label = document.querySelector(${JSON.stringify(LABEL)});
  if (!label) return null;
  const allowed = new Set(["db-th-icon", "db-th-sorted"]);
  const svgs = [...label.querySelectorAll("svg")].map((s) => String(s.getAttribute("class") ?? ""));
  const foreign = svgs.filter((c) => !c.split(/\\s+/).some((t) => allowed.has(t)));
  const invisible = [...label.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.opacity) === 0 && el.getBoundingClientRect().width > 0.5;
  }).map((el) => String(el.className));
  const r = label.getBoundingClientRect();
  return {
    svgs, foreign, invisible,
    expanded: label.getAttribute("aria-expanded"),
    x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    left: r.left, right: r.right, top: r.top, height: r.height,
  };
})()`;

/* The label's own background composited over the first opaque ancestor, as relative
   luminance. Also reports the raw computed value so a failure says *which* token won. */
const FILL = `(() => {
  const label = document.querySelector(${JSON.stringify(LABEL)});
  if (!label) return null;
  const parse = (c) => {
    const m = /^rgba?\\(([^)]+)\\)$/.exec(String(c).trim());
    if (!m) return null;
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  let base = { r: 0, g: 0, b: 0 };
  for (let el = label.parentElement; el; el = el.parentElement) {
    const c = parse(getComputedStyle(el).backgroundColor);
    if (c && c.a >= 0.999) { base = c; break; }
  }
  const own = parse(getComputedStyle(label).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
  const mix = (fg, bg) => fg * own.a + bg * (1 - own.a);
  const r = mix(own.r, base.r), g = mix(own.g, base.g), bl = mix(own.b, base.b);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return {
    alpha: own.a,
    raw: getComputedStyle(label).backgroundColor,
    base: [base.r, base.g, base.b],
    rgb: [Math.round(r), Math.round(g), Math.round(bl)],
    lum: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl),
    expanded: label.getAttribute("aria-expanded"),
  };
})()`;

const MENU_OPEN = `!!document.querySelector('[role="menu"]')`;

const escape = async () => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(220);
};

/* A point clear of the block, for parking the pointer: away from the header, away from any
   menu the press opens. */
const away = async () => {
  await b.move(8, Math.round(H - 12));
  await sleep(220);
};

try {
  await b.waitFor(`!!document.querySelector(${JSON.stringify(LABEL)})`, { timeoutMs: 25000, label: "header label" });
  await sleep(1000);

  const anatomy = await b.evaluate(ANATOMY);
  b.check("a column header is present and is a menu trigger", anatomy !== null);

  if (!anatomy) {
    await b.report();
  } else {
    b.check("the label holds no svg beyond its property icon and sort arrow",
      anatomy.foreign.length === 0,
      anatomy.foreign.length ? "found " + JSON.stringify(anatomy.foreign) : JSON.stringify(anatomy.svgs));
    b.check("nothing in the label is invisible yet still reserving width",
      anatomy.invisible.length === 0,
      anatomy.invisible.length ? JSON.stringify(anatomy.invisible) : "");

    /* Rest. */
    await away();
    const rest = await b.evaluate(FILL);
    b.check("at rest the header paints nothing",
      rest.alpha === 0,
      rest.raw);
    await b.shot("db-th-rest");

    /* Hover: a real pointer move, not a synthetic mouseenter. */
    await b.move(anatomy.x, anatomy.y);
    await sleep(260);
    const hover = await b.evaluate(FILL);
    await b.shot("db-th-hover");

    b.check("hover paints a fill above rest",
      hover.lum > rest.lum + 1e-6,
      `lum ${rest.lum.toFixed(5)} -> ${hover.lum.toFixed(5)}  ${hover.raw}`);

    /* Open. The menu opens on mousedown, so a press is the real gesture. */
    await b.mouse(anatomy.x, anatomy.y);
    await sleep(320);
    const open = await b.evaluate(FILL);
    const menuShown = await b.evaluate(MENU_OPEN);

    b.check("a press on the header opens its menu", menuShown === true, String(menuShown));
    b.check("the trigger says it is expanded while the menu is open",
      open.expanded === "true", String(open.expanded));

    /* The point of a *clicked* state: the fill must not be the pointer's. Take the pointer
       off the label, land it far from the menu, and measure again. A hover-only state drops
       back to rest here — which is precisely the bug this asserts against. */
    await away();
    const held = await b.evaluate(FILL);
    const stillOpen = await b.evaluate(MENU_OPEN);

    b.check("the menu stays open with the pointer elsewhere", stillOpen === true, String(stillOpen));
    b.check("the open fill survives the pointer leaving the trigger",
      held.lum > rest.lum + 1e-6,
      `lum ${rest.lum.toFixed(5)} -> ${held.lum.toFixed(5)}  ${held.raw}`);
    b.check("the open fill is strictly brighter than hover",
      held.lum > hover.lum + 1e-6,
      `hover ${hover.lum.toFixed(5)} ${JSON.stringify(hover.rgb)}  open ${held.lum.toFixed(5)} ${JSON.stringify(held.rgb)}`);

    /* Brightness the eye can actually resolve, not a float epsilon: the two fills must be at
       least 4 sRGB levels apart on at least one channel, over the same base. */
    const step = Math.max(
      Math.abs(held.rgb[0] - hover.rgb[0]),
      Math.abs(held.rgb[1] - hover.rgb[1]),
      Math.abs(held.rgb[2] - hover.rgb[2]),
    );
    b.check("the open/hover step is visible, not a rounding artefact",
      step >= 4,
      `${step} channel levels: hover ${JSON.stringify(hover.rgb)} open ${JSON.stringify(held.rgb)} over base ${JSON.stringify(rest.base)}`);

    await b.shot("db-th-open");

    /* And it must not be sticky: Escape closes the menu and the fill goes with it. */
    await escape();
    const closed = await b.evaluate(FILL);
    const menuGone = await b.evaluate(`!(${MENU_OPEN})`);

    b.check("Escape closes the menu", menuGone === true, String(menuGone));
    b.check("the trigger says it is collapsed again", closed.expanded === "false", String(closed.expanded));
    b.check("the open fill is gone once the menu closes",
      closed.lum <= rest.lum + 1e-6,
      `back to lum ${closed.lum.toFixed(5)}  ${closed.raw}`);

    const blocked = await b.blockedWrites();
    b.check("nothing tried to write", blocked.length === 0, JSON.stringify(blocked));

    await b.report();
  }
} catch (error) {
  console.log("ERROR " + error.message);
  await b.close();
  process.exit(1);
}
