/* Page tests used to open the *baseline* DDL — the schema as it was first shipped, not the
   one a running server has. `migrate()` is what the runtime calls before it serves a
   request, and page order (`position`, migration 4) is the first column the service writes
   that the baseline does not define, so those fixtures now open a migrated database the way
   `auth-login.test.ts` and `session-store.test.ts` always have.
*/
import { openDatabase, type Database } from "../src/server/database";
import { migrate } from "../src/server/migrations";

export async function openMigrated(url = "file::memory:"): Promise<Database> {
  const database = await openDatabase(url);
  await migrate(database);
  return database;
}
