import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PUBLIC_APIS, PUBLIC_PAGES } from "../src/proxy";

/**
 * Every sign-in route has to be reachable *before* anyone is signed in.
 *
 * `src/proxy.ts` runs in front of every request and refuses one without a session cookie.
 * The sign-in routes therefore have to be named in `PUBLIC_APIS`, or the form that is
 * supposed to create a session gets 401 with "You are not signed in" — from the proxy,
 * before the handler it is calling ever runs.
 *
 * Unit tests of the handlers cannot catch that, and did not: `/api/auth/start` shipped
 * without its entry, every handler test passed, and the browser answered
 * `{"error":{"code":"unauthorized"}}`. Only a real build and a real request found it.
 *
 * So this test walks the routes on disk and insists each one is listed. Adding a route is
 * now a decision that has to be made out loud, which is the point.
 */

const AUTH_ROOT = join(process.cwd(), "src", "app", "api", "auth");

/** `/api/auth/verify-code` and friends, read from the file tree rather than typed twice. */
function authRoutes(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== "route.ts") continue;
      const segments = relative(join(process.cwd(), "src", "app"), full.slice(0, full.lastIndexOf(sep)))
        .split(sep)
        .filter(Boolean);
      found.push(`/${segments.join("/")}`);
    }
  };
  walk(AUTH_ROOT);
  return found.sort();
}

test("every sign-in route is reachable without a session", () => {
  const routes = authRoutes();
  assert.ok(routes.length >= 5, `expected the auth routes to be found, got ${JSON.stringify(routes)}`);

  const missing = routes.filter((route) => !PUBLIC_APIS.has(route));
  assert.deepEqual(
    missing,
    [],
    `these routes exist on disk but the proxy would 401 them before their handler runs: ${missing.join(", ")}. ` +
      "Add each to PUBLIC_APIS in src/proxy.ts, or move it out of /api/auth/.",
  );
});

test("the sign-in screens are public pages, and nothing wider is", () => {
  const [login] = [...PUBLIC_PAGES];
  assert.equal(login, "/login", "the login page itself is the one that has to be public");
  assert.ok(PUBLIC_PAGES.has("/login/code"), "the code screen follows the password screen");
  assert.equal(PUBLIC_PAGES.size, 2, "a third public page would be a page served to nobody in particular");
});

test("the proxy really is wired in, so the exemption list means something", () => {
  const config = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
  assert.match(config, /export function proxy\(/, "src/proxy.ts exports the function Next runs");
  assert.match(config, /export const config = \{ matcher: \[/, "and the matcher that decides what it sees");
});
