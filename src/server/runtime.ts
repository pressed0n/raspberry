import { accessMode } from "./access";
import { authConfigured } from "./auth/config";
import { openDatabase, type Database } from "./database";
import { migrate } from "./migrations";
import { AppError, RaspberryService } from "./service";

const state = globalThis as typeof globalThis & {
  raspberryDatabase?: Promise<Database>;
  raspberryService?: Promise<RaspberryService>;
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
  state.raspberryService ??= (async () => {
    const service = new RaspberryService(database);
    if (accessMode() === "local") await service.seed();
    return service;
  })().catch((error: unknown) => {
    state.raspberryService = undefined;
    throw error;
  });
  return state.raspberryService;
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
