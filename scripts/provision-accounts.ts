/**
 * Create the accounts that the emailed-code sign-in will open.
 *
 * Sign-in is allowlist **and** account: an address in `RASPBERRY_ALLOWED_EMAILS` can
 * only get in if a row for it already exists in `accounts`. That is deliberate — the
 * allowlist is a string in a deployment's environment, and a typo there should not
 * quietly mint a workspace — but it means somebody has to create the row, on purpose,
 * once. This is that somebody.
 *
 * Three rules, all of them about not surprising the owner:
 *
 * 1. **Nothing is ever deleted or rewritten.** An address that already has an account is
 *    skipped and reported as skipped. Re-running this on a live database is a no-op,
 *    which is what makes it safe to run when unsure.
 *
 * 2. **The owner address adopts the notes that are already there.** `--adopt` (or
 *    `RASPBERRY_OWNER_EMAIL`) names the one address that inherits the local workspace's
 *    owner user id. Every other address gets a brand new empty workspace. Without a named
 *    owner nobody adopts anything: the safe reading of an absent value is "the first
 *    person to run this gets the existing pages", and that is not a rule worth guessing.
 *
 * 3. **It never invents an allowlist entry.** Addresses come from the command line or
 *    from `RASPBERRY_ALLOWED_EMAILS`; this script does not touch the deployment's
 *    environment, so provisioning and permitting stay two separate, visible acts.
 *
 * Usage:
 *   tsx scripts/provision-accounts.ts --dry-run
 *   tsx scripts/provision-accounts.ts --url postgres://… \
 *     --adopt owner@example.com a@example.com b@example.com
 *
 * With no addresses it reads `RASPBERRY_ALLOWED_EMAILS`. `--url` wins over
 * `DATABASE_URL`, so the same command can provision a probe branch first.
 */
import { randomUUID } from "node:crypto";
import { LOCAL_WORKSPACE_ID, openDatabase, type Database, type Sql } from "../src/server/database";
import { migrate } from "../src/server/migrations";
import { normalizeEmail } from "../src/server/auth/tokens";

type Plan = { email: string; action: "create" | "adopt" | "exists" };

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}

const dryRun = process.argv.includes("--dry-run");
const url = argument("--url") ?? process.env.DATABASE_URL ?? "file:./data/raspberry.sqlite";
const adopt = normalizeEmail(argument("--adopt") ?? process.env.RASPBERRY_OWNER_EMAIL ?? "");

/** Everything on the command line that is not a flag or a flag's value. */
function positional(): string[] {
  const flagsWithValues = new Set(["--url", "--adopt"]);
  const out: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (value === "--dry-run") continue;
    if (flagsWithValues.has(value)) { index += 1; continue; }
    if (value.startsWith("--")) continue;
    out.push(value);
  }
  return out;
}

function addresses(): string[] {
  const explicit = positional().map(normalizeEmail).filter((entry) => entry.includes("@"));
  if (explicit.length) return [...new Set(explicit)];
  return [...new Set((process.env.RASPBERRY_ALLOWED_EMAILS ?? "").split(/[\s,;]+/).map(normalizeEmail).filter((entry) => entry.includes("@")))];
}

/**
 * The user id that already owns the local workspace, if there is one.
 *
 * Scoped to the exact local workspace and the `owner` role, never to "anyone with an
 * owner membership": the wider query is how a provisioning script becomes a way to hand
 * somebody else's pages to whoever runs it.
 */
async function localOwner(sql: Sql): Promise<string | null> {
  const [row] = await sql.query("SELECT user_id FROM memberships WHERE workspace_id=$1 AND role='owner' LIMIT 1", [LOCAL_WORKSPACE_ID]);
  return row ? String(row.user_id) : null;
}

async function provision(database: Database, emails: readonly string[]): Promise<Plan[]> {
  return database.transaction(async (sql) => {
    const plans: Plan[] = [];
    const owner = adopt ? await localOwner(sql) : null;

    for (const email of emails) {
      const [existing] = await sql.query("SELECT id FROM accounts WHERE email=$1 LIMIT 1", [email]);
      if (existing) { plans.push({ email, action: "exists" }); continue; }

      if (owner && email === adopt) {
        // Adopt: attach the identity to the user that already owns the notes. The user
        // row is left exactly as it is — its id is what every page is keyed to.
        if (!dryRun) {
          await sql.query("INSERT INTO accounts(id,user_id,provider,subject,email,display_name,created_at) VALUES($1,$2,'email',$3,$4,$5,$6)", [
            randomUUID(),
            owner,
            email,
            email,
            null,
            new Date().toISOString(),
          ]);
        }
        plans.push({ email, action: "adopt" });
        continue;
      }

      // Everyone else: an empty workspace of their own. Never the local one, and never a
      // duplicate of an owner membership.
      const userId = randomUUID();
      const workspaceId = randomUUID();
      if (!dryRun) {
        await sql.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, email.split("@")[0]]);
        await sql.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [workspaceId, "Personal workspace"]);
        await sql.query("INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')", [userId, workspaceId]);
        await sql.query("INSERT INTO accounts(id,user_id,provider,subject,email,display_name,created_at) VALUES($1,$2,'email',$3,$4,$5,$6)", [
          randomUUID(),
          userId,
          email,
          email,
          null,
          new Date().toISOString(),
        ]);
      }
      plans.push({ email, action: "create" });
    }
    return plans;
  });
}

async function main(): Promise<void> {
  const emails = addresses();
  if (!emails.length) {
    console.error("No addresses. Pass them as arguments or set RASPBERRY_ALLOWED_EMAILS.");
    process.exitCode = 1;
    return;
  }
  if (!adopt) console.log("No --adopt / RASPBERRY_OWNER_EMAIL: every address gets its own new workspace, and the existing notes are left unclaimed.");

  console.log(`${dryRun ? "[dry run] " : ""}${emails.length} address(es) against ${url.replace(/\/\/[^@]*@/, "//***@")}`);
  const database = await openDatabase(url);
  try {
    const { applied } = await migrate(database);
    if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
    const plans = await provision(database, emails);
    for (const plan of plans) console.log(`  ${plan.action.padEnd(6)} ${plan.email}`);
    const created = plans.filter((plan) => plan.action !== "exists").length;
    console.log(`${created} account(s) ${dryRun ? "would be" : ""} provisioned, ${plans.length - created} already existed.`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
