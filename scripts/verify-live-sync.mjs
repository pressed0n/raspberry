// Two clients, one workspace: an edit on one appears on the other without a reload.
//
// Usage:
//   BASE=http://127.0.0.1:3112 node scripts/verify-live-sync.mjs [width] [height]
//   …or end to end on a disposable copy:  powershell -File scripts\run-sync-probe.ps1
//
// THE OWNER'S REPORT
//   "On notion if I make a change on one device it will be seen on another in a matter of
//    seconds ... on raspberry i need to manually refresh the page in order to see the change."
//
// WHY THIS PROBE DRIVES TWO BROWSERS AND EVERY OTHER ONE DRIVES ONE
//   The feature is a relationship between two clients. Nothing observable inside a single
//   page can say whether the *other* one would have noticed, so the second client is not a
//   convenience here — it is the only thing that can fail.
//
// WHY `performance.timeOrigin` IS THE ASSERTION THAT MATTERS
//   "The title changed" is also true after a manual reload, and a manual reload is the bug
//   being fixed. `timeOrigin` is stamped when a document is created and is re-stamped only by
//   a *new* document, so an unchanged `timeOrigin` on the second client is proof that the DOM
//   showing the new title is the one it loaded — not a reload it was never asked to do.
//
// WHY IT ALSO TYPES INTO THE SECOND CLIENT
//   The cheap way to make this feature "work" is to adopt every change, which deletes what
//   the other person is typing. So the second client types continuously while the first one
//   writes, and the claim is that its own text survives. `adoptedRemote` refuses an adoption
//   over unsaved work; this is the only check that would catch it deciding otherwise.
//
// WRITES: yes, against a *disposable* instance — it creates one page and retitles it. It is
// run by a runner that builds a copy on port 3112, which is not a live port.
import { openBrowser } from "./browser-session.mjs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 900);
const BASE = process.env.BASE ?? "http://127.0.0.1:3112";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { pass += 1; console.log("  PASS " + name + (detail ? "  " + detail : "")); }
  else { failures.push(name); console.log("  FAIL " + name + (detail ? "  " + detail : "")); }
}

/* Local mode refuses a write that does not look like a same-origin browser request; the probe
   is on the machine, so it says what it is. Same headers as the seed scripts. */
async function call(path, method, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, "fetch-site": "same-origin", "sec-fetch-site": "same-origin" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const stamp = Date.now();
const created = await call("/api/pages", "POST", { title: `Sync probe ${stamp}`, mutationId: crypto.randomUUID() });
const pageId = created?.page?.id;
if (!pageId) throw new Error("the seed printed no page id");

console.log(`\n=== live sync @ ${width}x${height} — page ${pageId} ===`);

const first = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });
const second = await openBrowser({ url: `${BASE}/#${pageId}`, width, height });

const READY = `!!document.querySelector('.doc-title') && !!document.querySelector('.bn-editor[contenteditable=true]')`;
await first.waitFor(READY, { label: "the first client's editor" });
await second.waitFor(READY, { label: "the second client's editor" });

/** Puts the caret in the title, the way a person does — a real press at its centre. */
async function focusTitle(browser) {
  const point = await browser.evaluate(`(() => {
    const el = document.querySelector('.doc-title');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  await browser.mouse(point.x, point.y);
}

/** Ctrl+A, so `type` replaces the title instead of appending to it. */
async function selectAll(browser) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await browser.send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  }
}

const RETITLE = `(title) => {
  const el = document.querySelector('.doc-title');
  return el ? el.value : null;
}`;
const titleOf = (browser) => browser.evaluate(`(${RETITLE})()`);

const originBefore = await second.evaluate("performance.timeOrigin");
const pollsBefore = second.requests("/api/sync").length;

/* ---------------------------------------------------------------------------
   1. An edit on one client reaches the other without a reload.
   --------------------------------------------------------------------------- */
const typedOnFirst = `Synced ${Date.now()}`;
await focusTitle(first);
await selectAll(first);
await first.type(typedOnFirst);

const arrived = await second
  .waitFor(`document.querySelector('.doc-title')?.value === ${JSON.stringify(typedOnFirst)}`, {
    timeoutMs: 15000,
    label: "the second client shows the title the first one typed",
  })
  .then(() => true)
  .catch(() => false);

check("an edit on one client reaches the other", arrived, arrived ? "" : `second client still shows ${JSON.stringify(await titleOf(second))}`);

const originAfter = await second.evaluate("performance.timeOrigin");
check("and it arrives without a reload", originAfter === originBefore, `${originBefore} → ${originAfter}`);

const pollsAfter = second.requests("/api/sync").length;
check("the second client is polling, not lucky", pollsAfter > pollsBefore, `${pollsBefore} → ${pollsAfter} /api/sync requests`);

/* ---------------------------------------------------------------------------
   2. The client being typed in keeps its own text while the other one writes.
   --------------------------------------------------------------------------- */
await focusTitle(second);
await selectAll(second);

let typed = 0;
let staleSeen = false;
let typing = true;
const typist = (async () => {
  while (typing) {
    await second.type("x");
    typed += 1;
    const className = await second.evaluate("document.querySelector('.save-state')?.className || ''");
    if (className.includes("is-stale")) staleSeen = true;
    await sleep(200);
  }
})();

await sleep(800);
const typedOnFirstAgain = `Moved by the other device ${Date.now()}`;
await focusTitle(first);
await selectAll(first);
await first.type(typedOnFirstAgain);
await sleep(3500);

typing = false;
await typist;

const secondTitle = await titleOf(second);
check("a client being typed in keeps its own text", typeof secondTitle === "string" && secondTitle.includes("x"), JSON.stringify(secondTitle));
check("and is told its copy is behind", staleSeen, `${typed} keystrokes typed while the other client wrote`);

await first.close();
await second.close();

const total = pass + failures.length;
console.log(`\n${failures.length === 0 ? "OK" : "FAILED"}: ${pass}/${total} passed @ ${width}x${height}`);
if (failures.length) console.log("  failed: " + failures.join("; "));
process.exit(failures.length ? 1 : 0);
