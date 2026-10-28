import { openDatabase } from "./database";
import { migrate } from "./migrations";
import { RaspberryService } from "./service";

const state = globalThis as typeof globalThis & { raspberryService?: Promise<RaspberryService> };

/**
 * The one place the application decides whether it may serve data at all.
 *
 * Local mode is opt-in by exact string match, so a stray `RASPBERRY_LOCAL_DEV=0`
 * or `true` does not admit anyone. Hosted mode is gated by session authentication
 * in `session.ts` instead; this function additionally requires that the deployment
 * is in a mode that can authenticate, so a missing switch is never read as "open".
 *
 * A failed start is not cached: the promise is dropped on rejection so a transient
 * database error does not wedge the process until it is restarted.
 */
export function getService(): Promise<RaspberryService> {
  if (!servesData()) throw new Error("Authentication is not configured. Enable local development explicitly.");
  state.raspberryService ??= openDatabase()
    .then(async (database) => {
      await migrate(database);
      const service = new RaspberryService(database);
      await service.seed();
      return service;
    })
    .catch((error: unknown) => {
      state.raspberryService = undefined;
      throw error;
    });
  return state.raspberryService;
}

/** Whether this process is configured to serve data to anyone at all. */
function servesData(): boolean {
  return process.env.RASPBERRY_LOCAL_DEV === "1";
}
