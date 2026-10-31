import { accessMode } from "./access";
import { authConfigured } from "./auth/config";
import { openDatabase, type Database } from "./database";
import { DatabaseService } from "./databases";
import { FileStore } from "./files";
import { migrate } from "./migrations";
import { AppError, RaspberryService } from "./service";

/* A promise parked on `globalThis`, tagged with the class that produced it.
   ---------------------------------------------------------------
   The parking is deliberate: the module graph is re-evaluated on every hot reload, and a
   connection (or a seeded service) must outlive that. But the *other* thing that outlives
   it is the class — an instance from an earlier evaluation keeps calling the methods and
   the imported schemas of the module graph that built it, while the file on disk says
   something else. That is not a bug you can see: the route recompiles, the UI updates, the
   request arrives, and the answer comes from last hour's validators.

   So the memo carries `from`, the class it was built from, and a getter rebuilds when that
   is not the class it is holding. Both service classes are wrappers around the memoised
   database handle and nothing else, so rebuilding costs one allocation — which is what
   makes this affordable at all. `getDatabase` keeps its own untagged memo: reopening a
   connection, and re-running migrations on it, is not free.
   -
   Editing this file does **not** clear these. Nothing does; `state` is `globalThis`. */
export type ServiceMemo<T> = Promise<T> & { from?: unknown };

/* The one rule every getter below follows. Kept as a function so a test can hold it to
   its promise without a hot reload: same class, same instance; a replaced class, a
   replaced instance. */
export function reused<T>(memo: ServiceMemo<T> | undefined, type: unknown, create: () => Promise<T>): ServiceMemo<T> {
  if (memo && memo.from === type) return memo;
  return Object.assign(create(), { from: type });
}

const state = globalThis as typeof globalThis & {
  raspberryDatabase?: Promise<Database>;
  raspberryService?: ServiceMemo<RaspberryService>;
  raspberryDatabases?: ServiceMemo<DatabaseService>;
};

/**
 * The database handle, with no authentication decision attached.
 *
 * Opening a file is not admitting a caller: this is needed by `resolveActor` itself,
 * before anyone has been authenticated, and gating it on a "local dev" switch is what
 * used to make hosted mode unable to look anything up. The gate lives on
 * `getService`, which is the thing that actually hands out data.
 *
 * A failed open is not cached, so a transient error does not wedge the process.
 */
export function getDatabase(): Promise<Database> {
  state.raspberryDatabase ??= openDatabase()
    .then(async (database) => {
      await migrate(database);
      return database;
    })
    .catch((error: unknown) => {
      state.raspberryDatabase = undefined;
      throw error;
    });
  return state.raspberryDatabase;
}

/**
 * The service handle — and the second of the two gates in front of the data.
 *
 * Hosted mode reaches this only after `resolveActor` has produced an Actor, which it
 * can only do from a valid session. The check is repeated here anyway: a future caller
 * that forgets to go through `api()` should hit a refusal, not a workspace.
 *
 * The demo content is seeded in local mode only. Seeding it under a hosted deployment
 * would invent a workspace owned by the local user id that nobody can ever sign in as.
 */
export async function getService(): Promise<RaspberryService> {
  if (!servesData()) throw new AppError(503, "not_configured", "This deployment is not configured to serve data.");
  const database = await getDatabase();
  const next = reused(state.raspberryService, RaspberryService, () =>
    (async () => {
      const service = new RaspberryService(database);
      if (accessMode() === "local") await service.seed();
      return service;
    })().catch((error: unknown) => {
      state.raspberryService = undefined;
      throw error;
    }),
  );
  state.raspberryService = next;
  return next;
}

/**
 * The blob store. Shares the cached database handle, so a media request does not
 * open a second connection, and is gated like `getService`: a caller that reached
 * here without an actor would be serving bytes to nobody in particular.
 */
export async function getFileStore(): Promise<FileStore> {
  if (!servesData()) throw new AppError(503, "not_configured", "This deployment is not configured to serve data.");
  return new FileStore(await getDatabase());
}

/**
 * The database-service handle. Same gate as `getService` — a database is data, so a
 * caller that arrived without an actor gets a refusal rather than a schema.
 *
 * Memoised, but keyed on the class: see `ServiceMemo` above. This is the getter that taught
 * the lesson — the tag added to `sortSchema.direction` was on disk, in the recompiled
 * route, and in the disposable copy every probe ran against, while this instance kept
 * answering with the two-member enum it imported hours earlier. The UI offered the new
 * sort, the server rejected it with a message written by code that no longer existed
 * anywhere but here.
 */
export async function getDatabases(): Promise<DatabaseService> {
  if (!servesData()) throw new AppError(503, "not_configured", "This deployment is not configured to serve data.");
  const next = reused(state.raspberryDatabases, DatabaseService, () =>
    getDatabase()
      .then((database) => new DatabaseService(database))
      .catch((error: unknown) => { state.raspberryDatabases = undefined; throw error; }),
  );
  state.raspberryDatabases = next;
  return next;
}

/**
 * Whether this process is configured to serve data to anyone at all.
 *
 * Hosted mode counts only when it can actually authenticate: `authConfigured()` requires
 * a Google client, an https public origin, and a non-empty allowlist. A session-mode
 * deployment missing any of those serves nobody rather than everybody.
 */
function servesData(): boolean {
  if (process.env.RASPBERRY_LOCAL_DEV === "1") return true;
  return accessMode() === "session" && authConfigured();
}
