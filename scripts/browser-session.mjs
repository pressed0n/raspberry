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

export async function openBrowser({ width = 1400, height = 900, url, chrome = CHROME_DEFAULT, headless = true } = {}) {
  if (!url) throw new Error("openBrowser needs a url");
  mkdirSync("artifacts", { recursive: true });

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
    url,
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
