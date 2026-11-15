// A CDP browser session that cleans up after itself.
//
// WHY THIS FILE IS TRACKED
//
// Every UI verification in this repo used to be a copy-pasted CDP probe, and each copy
// spawned Chrome with a throwaway profile under `artifacts/.chrome-<port>/` and never
// removed it. 292 of those had accumulated: 371,607 files and 14.6 GB, hidden by
// `.gitignore`'s `artifacts/` line. The consequence was not disk space — it was that
// `Get-ChildItem -Recurse` from the repo root, the first thing any agent does, went from
// 15 seconds to timing out at 120. A one-line leak became a context problem.
//
// So the leak is fixed here, once, instead of in 28 copies: `close()` and every exit path
// remove the profile. And the boilerplate lives in one tracked file, so a fresh clone has
// the pattern and nobody has to re-derive the WebSocket transport.
//
// USAGE
//
//   import { openBrowser } from "../scripts/browser-session.mjs";
//
//   const b = await openBrowser({ url: "http://127.0.0.1:3000/#<page-id>" });
//   await b.waitFor(`!!document.querySelector(".db-table tbody tr")`);
//   const r = await b.evaluate(`document.querySelector(".db-row").getBoundingClientRect().x`);
//   b.check("row starts where the page does", r === 24, `x=${r}`);
//   await b.mouse(x, y);          // real input events, not element.click()
//   await b.shot("gutter-1400");  // artifacts/shots/gutter-1400.png
//   await b.report();             // prints totals, exits non-zero on failure
//
// The rules this supports are in `docs/TESTING.md`: assert pixels not class names, run at
// 1400 / 900 / 390, and never write to the owner's database to prove a write works —
// intercept the request and assert the body the UI built.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const CHROME_DEFAULT = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let live = new Set();

function killProfile(profile) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A locked file is not worth failing a verification run over; the next run starts
    // from a fresh random port, and `scripts/check-docs.mjs` reports the leftovers.
  }
}

// LIVE WRITE GUARD
//
// On 30 October the owner's live database was found holding 194 trashed pages — repeated
// loops of "Untitled" / "Alpha" / "Beta" / "Ship the table", created in batches and swept by
// a script's own id (`cleanup-1793362212300`). No tracked probe did it; a CDP script pointed
// at http://127.0.0.1:3000 did, and nothing stopped it, because the only rule against it was
// a paragraph in docs/TESTING.md.
//
// So the rule is now code. A session opened against the LIVE port installs a fetch guard
// before the app's first script runs: any non-GET is refused with an error naming the URL
// and pointing at the disposable instance. Reads still work, which is what the read-only
// probes need. A probe that genuinely must write passes { allowMutations: true } and the
// session prints a warning, so it shows up in the transcript instead of in the database.
const LIVE_PORTS = new Set(
  (process.env.RASPBERRY_LIVE_PORT ?? "3000").split(",").map((p) => Number(p.trim())),
);

function portOf(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return Number(u.port || (u.protocol === "https:" ? 443 : 80));
  } catch {
    return Number.NaN;
  }
}

/** Injected before any page script. Refuses every mutation, and records the attempt. */
function writeGuardSource(host) {
  return `(() => {
  if (window.__raspberryWriteGuard) return;
  const blocked = [];
  window.__raspberryWriteGuard = blocked;
  const refuse = (method, url) => {
    blocked.push(method + " " + url);
    return Promise.reject(new Error(
      "REFUSED by scripts/browser-session.mjs: " + location.host +
      " is the LIVE instance and a probe may not " + method + " " + url +
      ". Point BASE and DATABASE_URL at a disposable copy (docs/TESTING.md), " +
      "or pass { allowMutations: true } if writing here is deliberate."
    ));
  };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      return refuse(method, url);
    }
    return realFetch.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    navigator.sendBeacon = () => { blocked.push("BEACON"); return false; };
  }
  window.__raspberryWriteGuardHost = ${JSON.stringify(host)};
})();`;
}

export async function openBrowser({
  width = 1400,
  height = 900,
  url,
  chrome = CHROME_DEFAULT,
  headless = true,
  allowMutations = false,
} = {}) {
  if (!url) throw new Error("openBrowser needs a url");
  mkdirSync("artifacts", { recursive: true });

  const liveTarget = LIVE_PORTS.has(portOf(url));
  const guardWrites = liveTarget && !allowMutations;
  if (liveTarget && allowMutations) {
    console.log(`  WARNING mutations are ALLOWED against the live instance at ${url}`);
  }

  const port = 9200 + Math.floor(Math.random() * 500);
  const profile = join(process.cwd(), "artifacts", `.chrome-${port}`);
  rmSync(profile, { recursive: true, force: true });

  const args = [
    headless ? "--headless=new" : null,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    // Deliberately NOT the url: Chrome is pointed at about:blank so the write guard can be
    // registered before the app's first script runs. Navigating first loses that race.
    "about:blank",
  ].filter(Boolean);

  const child = spawn(chrome, args, { stdio: "ignore" });
  live.add(profile);

  // Every path out — throw, Ctrl+C, process.exit — removes the profile. This is the line
  // whose absence cost 14.6 GB.
  const cleanup = () => {
    live.delete(profile);
    killProfile(profile);
  };
  process.once("exit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(130); });

  async function target() {
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page;
      } catch {}
      await sleep(250);
    }
    throw new Error("no debuggable page — is Chrome at CHROME_DEFAULT? pass { chrome } to override");
  }

  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  /* Every request the *page* makes, in order. Enabled because "did anything leave this machine"
     is not a question a DOM assertion can reach: a map drawn from `<img src="https://…">` looks
     exactly like a map drawn from our own route, and the only difference that matters is one
     line in somebody else's access log. */
  const traffic = [];
  let listener = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Network.requestWillBeSent") {
      traffic.push({ url: m.params.request.url, type: m.params.type, at: Date.now() });
    }
    /* One listener the probe can install, for the few protocols that are a *conversation*
       (`Fetch.requestPaused` must be answered, or the page hangs waiting for itself). Passing
       `null` removes it. */
    if (listener) {
      try { listener(m.method, m.params ?? {}); } catch {}
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(`${ex.text} ${ex.exception?.description ?? ""}`);
    return r.result?.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("DOM.enable");
  await send("Network.enable");

  /* The window is not the viewport, and the difference was never in the log line.
     `--window-size=390,844` asks for a *window*: Windows refuses to make one narrower than
     about 500px, and the frame takes a bite out of both dimensions anyway. So a probe that
     printed `@ 390x844` was measuring 500x746, and one that printed `@ 1400x900` was
     measuring 1378x802 — a claim about a layout nobody had actually looked at (found by the
     date probe, which asserts the picker is inside the viewport at 390 and reported a 500px
     one). This pins the page viewport to the numbers the log line and `report()` print. */
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  if (guardWrites) {
    await send("Page.addScriptToEvaluateOnNewDocument", { source: writeGuardSource(url) });
  }
  await send("Page.navigate", { url });

  let pass = 0;
  let fail = 0;
  const failures = [];
  const title = `=== ${url} @ ${width}x${height} ===`;
  console.log(`\n${title}`);

  return {
    port,
    width,
    height,
    profile,
    send,
    evaluate,
    guarded: guardWrites,

    /** Every mutation the guard refused, e.g. ["POST /api/pages"]. Empty is the good case. */
    async blockedWrites() {
      if (!guardWrites) return [];
      try {
        return (await evaluate("window.__raspberryWriteGuard ? window.__raspberryWriteGuard.slice() : []")) ?? [];
      } catch {
        return [];
      }
    },

    /** Every request the page has made, in order — `{ url, type, at }`.
     *
     *  `match` filters by substring, `from` skips the first N (a caller marks a point in time by
     *  reading `.length` first). What this is *for*: proving that a feature which needs the
     *  network went through our own server. A map drawn from `<img src="https://tile…">` and one
     *  drawn from `/api/places/tile` are the same pixels, so no assertion about the DOM can tell
     *  them apart — this can. */
    requests(match, from = 0) {
      const all = traffic.slice(from).map((entry) => ({ ...entry }));
      return match === undefined ? all : all.filter((entry) => entry.url.includes(match));
    },

    /** How many requests the page had made at this instant, for `requests(match, from)`. */
    requestCount() {
      return traffic.length;
    },

    /** Install (or with `null`, remove) a listener for every CDP event. */
    onEvent(fn) {
      listener = fn;
    },

    async waitFor(expression, { timeoutMs = 10000, label = expression } = {}) {
      const steps = Math.ceil(timeoutMs / 250);
      for (let i = 0; i < steps; i++) {
        try { if (await evaluate(expression)) return true; } catch {}
        await sleep(250);
      }
      throw new Error(`waitFor timed out: ${label}`);
    },

    /** Real pointer input. Use this instead of element.click() so handlers see isTrusted. */
    async mouse(x, y, { modifiers = 0, button = "left" } = {}) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
    },

    async move(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    },

    /** A real double press. `mouse()` twice will not do: Blink dispatches `dblclick` from the
     *  *second* press's `clickCount`, so the count is the event. Two presses counted as two
     *  separate clicks select a word and fire no `dblclick` at all — which is how a probe can
     *  "test" a double-click handler and never once reach it. */
    async doubleMouse(x, y, { modifiers = 0, button = "left" } = {}) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 2, modifiers });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 2, modifiers });
    },

    async drag(from, to, { steps = 12 } = {}) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          button: "left", buttons: 1,
        });
        await sleep(16);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
    },

    async type(text) {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch });
        await send("Input.dispatchKeyEvent", { type: "keyUp", text: ch, unmodifiedText: ch });
      }
    },

    async key(key, { code = key, keyCode = 0 } = {}) {
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },

    async shot(name) {
      const dir = join("artifacts", "shots");
      mkdirSync(dir, { recursive: true });
      const r = await send("Page.captureScreenshot", { format: "png" });
      const file = join(dir, `${name}.png`);
      writeFileSync(file, Buffer.from(r.result.data, "base64"));
      return file;
    },

    /** The colour the browser actually painted at a **viewport** coordinate — the same space
     *  `getBoundingClientRect()` speaks — as `{ r, g, b, a }`.
     *
     *  Why a 1x1 screenshot and not `getComputedStyle`: "is this box opaque" is a question
     *  about the composited frame, and computed style answers a different one. An element
     *  with `background-color: rgba(255,255,255,0.07)` reports exactly that and looks like
     *  nothing at all — the URL mark's hover state was transparent for a turn and every
     *  style assertion about it passed.
     *
     *  Why the scroll is added here: `Page.captureScreenshot`'s `clip` is in *page*
     *  coordinates, and this file's callers all hold rectangles measured against the
     *  viewport. Measured, not assumed: a red block at document y=1000 with the window
     *  scrolled to 800 is sampled at `pixel(x, 1030)` and *not* at `pixel(x, 230)`. Doing that
     *  subtraction at one call site and forgetting it at the next is how a probe ends up
     *  reading the colour of the header.
     *
     *  Decoding is 20 lines because the shot is one pixel: PNG filters are all defined
     *  against the pixel to the left and the row above, and a 1x1 image has neither, so
     *  every filter type reduces to `raw` and the first pixel is the payload. */
    async pixel(x, y) {
      const view = (await evaluate("({ x: window.scrollX, y: window.scrollY })")) ?? { x: 0, y: 0 };
      const r = await send("Page.captureScreenshot", {
        format: "png",
        clip: { x: Math.round(x + view.x), y: Math.round(y + view.y), width: 1, height: 1, scale: 1 },
      });
      const png = Buffer.from(r.result.data, "base64");
      let offset = 8; // the 8-byte signature
      let colorType = 6;
      const chunks = [];
      while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        const body = png.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") colorType = body[9];
        if (type === "IDAT") chunks.push(body);
        offset += 12 + length;
      }
      const raw = zlib.inflateSync(Buffer.concat(chunks));
      const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
      const red = raw[1];
      const green = channels === 1 ? red : raw[2];
      const blue = channels === 1 ? red : raw[3];
      return { r: red, g: green, b: blue, a: channels === 4 ? raw[4] : 255 };
    },

    check(name, ok, detail = "") {
      if (ok) { pass++; console.log("  PASS " + name + (detail ? "  " + detail : "")); }
      else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? "  " + detail : "")); }
    },

    /** Prints the score and exits nonzero on any failure, so CI and agents see red. */
    async report() {
      const line = `${pass}/${pass + fail} passed @ ${width}x${height}`;
      console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${line}`);
      if (fail) console.log("  failed: " + failures.join("; "));
      await this.close();
      process.exit(fail ? 1 : 0);
    },

    async close() {
      try { ws.close(); } catch {}
      try { child.kill(); } catch {}
      await sleep(150);
      cleanup();
    },
  };
}
