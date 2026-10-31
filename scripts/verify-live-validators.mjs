// Asks the RUNNING server which sort directions its validator knows.
//
// The bug this exists for: `sortSchema.direction` gained a third member on disk, the UI reloaded
// and offered it, and the server answered `Invalid option: expected one of "ascending"|"descending"`
// — because the process had been running since before the change and was validating with the enum
// it imported hours earlier. Every probe passed, because every probe starts a new process.
//
// So this asks the process the owner is looking at, and it writes nothing: the payload carries
// `direction: "sideways"`, which is invalid in every version of the schema, and `patchView`
// validates the merged config BEFORE its UPDATE (`src/server/databases.ts`), so the transaction
// throws before anything is written. The error message quotes the validator's own vocabulary —
// that quote is the answer.
//
// Usage: node scripts/verify-live-validators.mjs [base url]
import { DatabaseSync } from "node:sqlite";

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:3000";
const ORIGIN = new URL(BASE).origin;
const file = new URL("../data/raspberry.sqlite", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const db = new DatabaseSync(file, { readOnly: true });
const view = db.prepare("select id, database_id, config from database_views order by rowid limit 1").get();
db.close();
if (!view) throw new Error("no views in data/raspberry.sqlite — is this the right project?");

const response = await fetch(`${BASE}/api/databases/${view.database_id}/views/${view.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin" },
  body: JSON.stringify({
    mutationId: `validator-probe-${Date.now()}`,
    config: { sorts: [{ propertyId: "00000000-0000-4000-8000-000000000000", direction: "sideways" }] },
  }),
});
const body = await response.json().catch(() => ({}));
const message = body?.error?.message ?? JSON.stringify(body);
const directions = message.match(/"(\w+)"/g)?.map((quoted) => quoted.replace(/"/g, "")) ?? [];

const after = new DatabaseSync(file, { readOnly: true }).prepare("select config from database_views where id=?").get(view.id);
const wrote = after.config !== view.config;

console.log(`server:     ${BASE}`);
console.log(`view:       ${view.id}`);
console.log(`status:     ${response.status}`);
console.log(`message:    ${message}`);
console.log(`directions: ${directions.join(", ") || "(unreadable)"}`);
console.log(`wrote:      ${wrote ? "YES — investigate before going on" : "nothing (config byte-identical)"}`);

const expected = ["ascending", "descending", "manual"];
const missing = expected.filter((name) => !directions.includes(name));
if (missing.length) {
  console.log(`\nSTALE: the running server does not know ${missing.join(", ")}.`);
  console.log("It is older than the source. Restart Start-Raspberry.cmd, or find which memo is holding it.");
  process.exitCode = 1;
} else if (wrote) {
  process.exitCode = 1;
} else {
  console.log("\nOK: the running server validates with the current vocabulary, and nothing was written.");
}
