import { openDatabase } from "./database";
import { RaspberryService } from "./service";

const state = globalThis as typeof globalThis & { raspberryService?: Promise<RaspberryService> };
export function getService() {
  if (process.env.RASPBERRY_LOCAL_DEV !== "1") throw new Error("Authentication is not configured. Enable local development explicitly.");
  state.raspberryService ??= openDatabase().then(async (db) => { const service = new RaspberryService(db); await service.seed(); return service; });
  return state.raspberryService;
}
