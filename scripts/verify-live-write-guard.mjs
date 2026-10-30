// Proves the LIVE WRITE GUARD in scripts/browser-session.mjs actually refuses.
//
// Opens the real app on :3000 through the shared helper. It performs a GET (must succeed),
// then attempts a POST (must be refused *before* the request leaves the browser), then
// reports what the guard recorded. It also counts pages read-only before and after, so the
// claim "nothing was written" is measured rather than trusted.
import { openBrowser } from "./browser-session.mjs";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";

// Same variable the server honours, so the count cannot drift from the instance being tested.
// Hardcoding the path here is the bug that made verify-database-b40.mjs once read the owner's
// database while its browser pointed at a sandbox.
const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/raspberry.sqlite";
const databasePath = DATABASE_URL.replace(/^file:/, "").split("?")[0];

function liveCount() {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const row = db.prepare("select count(*) as c from pages").get();
  db.close();
  return row.c;
}

const before = liveCount();
console.log(`pages in ${databasePath} before: ${before}`);

const b = await openBrowser({ url: `${BASE}/`, width: 1400, height: 900 });
console.log(`guard installed: ${b.guarded}`);

// The guard only arms on the live port. Against a disposable copy there is nothing to prove,
// and pretending otherwise would print a red line for a correct configuration.
if (!b.guarded) {
  console.log(`SKIP: ${BASE} is not the live instance, so no guard is armed.`);
  console.log(`      Point BASE at the live app (default http://127.0.0.1:3000) to prove it.`);
  await b.close();
  process.exit(0);
}

await b.waitFor("!!document.querySelector('main, [data-testid], body')", { label: "the app shell" });

const getResult = await b.evaluate(`
  (async () => {
    const r = await fetch("/api/pages");
    return r.status;
  })()
`);
b.check("a GET still works under the guard", getResult === 200, `status=${getResult}`);

const postResult = await b.evaluate(`
  (async () => {
    try {
      const r = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "zz guard probe — must never exist" }),
      });
      return "ALLOWED " + r.status;
    } catch (error) {
      return "REFUSED " + error.message;
    }
  })()
`);
b.check(
  "a POST is refused before it leaves the browser",
  String(postResult).startsWith("REFUSED"),
  String(postResult).slice(0, 160),
);

const blocked = await b.blockedWrites();
b.check(
  "the guard recorded the attempt",
  blocked.some((line) => line.startsWith("POST /api/pages")),
  JSON.stringify(blocked),
);

await b.close();

const after = liveCount();
b.check("the live database gained no page", after === before, `${before} -> ${after}`);

await b.report();
