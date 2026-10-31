// Does any element lose text at the bottom of its box?
//
// WHY THIS EXISTS
// The owner reported "the letter g gets cut off at the bottom slightly" in the tag chips on
// a database block, and asked whether other letters do the same. The cause is a box that
// clips (`overflow: hidden`) while its line box is exactly one font-size tall: a descender
// needs about 1.2em, so at `line-height: 1` the bottom ~2px of g, j, p, q, y — and of the
// comma, semicolon and parenthesis — is inside the clip. Nothing about that is visible in
// the DOM: `scrollHeight` equals `clientHeight`, because ink overflow is not scrollable
// overflow. So the only honest measurement is font metrics against the clip box.
//
// HOW IT MEASURES
// For every element that clips and holds its own text, it asks the canvas for the font the
// element actually resolves to (`fontBoundingBox*` for the line box, `actualBoundingBox*`
// for the ink of that exact string), places the baseline per CSS inline layout
// (half-leading + ascent), and compares the ink's bottom against the padding box. A
// positive number is clipped pixels. It reports the worst offenders and how many elements
// it examined, so "nothing clipped" cannot be mistaken for "nothing measured".
//
// READ-ONLY. It never clicks, types, or writes; against the live app the shared browser
// session also refuses any request that is not a GET.
//
// Usage:
//   node scripts/verify-text-clip.mjs [width] [height]              # live app, the tag page
//   BASE=http://127.0.0.1:3100 PAGE=<id> node scripts/verify-text-clip.mjs   # a copy
//
// PAGE defaults to the page that draws the owner's tag chips; pass PAGE=<id> for another.
// It measures the page as it loads, so a surface you have to click to open is out of scope by
// construction — the chips inside the tag panel are the same `.db-tag` markup and the same
// clip, so the closed cell and the panel share this result rather than each keeping a copy.
import { openBrowser } from "./browser-session.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const PAGE = process.env.PAGE ?? "cf8dae6b-0466-452b-9dd6-61b61fa4a52b";
const [width, height] = [Number(process.argv[2] ?? 1400), Number(process.argv[3] ?? 900)];

/* The measurement, as one expression so it runs inside the page in a single round trip.
   `SLACK` is 0.5px: sub-pixel antialiasing puts glyph edges on fractional pixels, and
   treating a half pixel of rasterisation as a clipping bug would make the check noisy
   rather than wrong. */
const MEASURE = `
(() => {
  const SLACK = 0.5;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const clips = (cs) => {
    const one = (v) => v === "hidden" || v === "clip";
    return one(cs.overflowX) || one(cs.overflowY) || one(cs.overflow);
  };

  let measured = 0;
  const offenders = [];

  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!clips(cs)) continue;
    if (el.getClientRects().length === 0) continue;

    // Only text this element actually renders, not what its children bring.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      .map((n) => n.textContent)
      .join(" ")
      .trim();
    if (!own) continue;

    const text = own.replace(/\\s+/g, " ");
    const fontSize = parseFloat(cs.fontSize);
    if (!fontSize) continue;

    ctx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const fonts = ctx.measureText("Hg");
    const face = ctx.measureText(text);
    const ascent = fonts.fontBoundingBoxAscent ?? fonts.actualBoundingBoxAscent;
    const descent = fonts.fontBoundingBoxDescent ?? fonts.actualBoundingBoxDescent;
    const content = ascent + descent;

    const declared = cs.lineHeight === "normal" ? content : parseFloat(cs.lineHeight);
    if (!declared) continue;

    // Where the ink sits relative to the line box.
    const halfLeading = (declared - content) / 2;
    const baseline = halfLeading + ascent;

    // Clip box is the padding box; the ink is placed on the LAST line box, because that is
    // the one the box edge can cut. (Counting lines from a Range rect does not work: for
    // inline content Chrome returns the font's text box — ~16px — not the 13px line box,
    // which made an earlier version of this probe skip every chip as "multiline" and report
    // a clean bill of health on the very bug it was written for.)
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const contentHeight = el.clientHeight - padTop - padBottom;
    const lines = Math.max(1, Math.round(contentHeight / declared));
    const lastLineTop = contentHeight - declared;

    const inkTopOnLine = baseline - (face.actualBoundingBoxAscent ?? ascent);
    const inkBottomOnLine = baseline + (face.actualBoundingBoxDescent ?? descent);
    const top = padTop + lastLineTop + inkTopOnLine;
    const bottom = padTop + lastLineTop + inkBottomOnLine;
    const paddingBox = el.clientHeight;
    const overflowBottom = bottom - paddingBox;
    const overflowTop = -(padTop + inkTopOnLine);

    measured++;
    if (overflowBottom > SLACK || overflowTop > SLACK) {
      offenders.push({
        selector: (el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\\s+/).join(".") : "")).slice(0, 120),
        text: text.slice(0, 28),
        font: cs.fontSize + "/" + cs.lineHeight,
        lines,
        lineBox: +declared.toFixed(2),
        inkHeight: +(inkBottomOnLine - inkTopOnLine).toFixed(2),
        paddingBox: +paddingBox.toFixed(2),
        clippedBottom: +Math.max(0, overflowBottom).toFixed(2),
        clippedTop: +Math.max(0, overflowTop).toFixed(2),
      });
    }
  }

  const worst = offenders.sort((a, b) => b.clippedBottom - a.clippedBottom);
  return {
    measured,
    clipped: worst.length,
    worst: worst.slice(0, 12),
    chips: (() => {
      const chip = document.querySelector(".db-tag-name");
      if (!chip) return null;
      const cs = getComputedStyle(chip);
      const box = chip.closest(".db-tag");
      return {
        lineHeight: cs.lineHeight,
        fontSize: cs.fontSize,
        nameBox: chip.clientHeight + "px",
        chipHeight: box ? getComputedStyle(box).height : null,
        chipRendered: box ? box.getBoundingClientRect().height.toFixed(2) + "px" : null,
        text: chip.textContent,
      };
    })(),
  };
})()
`;

const b = await openBrowser({ url: `${BASE}/#${PAGE}`, width, height });
await b.waitFor("!!document.querySelector('.db-tag-name')", { label: "a tag chip" });

const result = await b.evaluate(MEASURE);
console.log(JSON.stringify(result, null, 2));

b.check("the probe measured clipping boxes", result.measured > 0, `measured=${result.measured}`);
b.check(
  "no clipping element loses glyph ink",
  result.clipped === 0,
  result.worst.map((o) => `${o.selector} "${o.text}" ${o.font} clips ${o.clippedBottom}px`).join("; "),
);
/* The chip is the reason this file exists, so assert on it by name rather than only via the
   sweep: a sweep that measured zero chips would otherwise pass while the reported bug stood. */
const chipLineBox = result.chips ? (result.chips.lineHeight === "normal" ? Infinity : parseFloat(result.chips.lineHeight)) : 0;
b.check(
  "the chip's line box leaves room for a descender",
  result.chips != null && chipLineBox >= parseFloat(result.chips.fontSize) * 1.15,
  JSON.stringify(result.chips),
);

await b.close();
await b.report();
