import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reused, type ServiceMemo } from "../src/server/runtime";

/* The rule in `src/server/runtime.ts`: a promise parked on `globalThis` remembers the
   class that produced it, and a getter rebuilds when that is not the class it is holding.

   The bug this exists for is invisible from every direction except one. `sortSchema`
   gained a third direction (`manual`); `tsc` passed, 456 tests passed, and two browser
   probes passed 21/21 each — because a probe runs in a *new process*, and a new process
   evaluates the current modules. The app you were looking at had been running since
   before the edit, and its parked `DatabaseService` was still calling the two-member
   enum imported hours earlier. The UI offered the sort; the server answered
   `Invalid option: expected one of "ascending"|"descending"`.

   So the assertions here are about *identity*, which is the only thing that can tell a
   fresh instance from a stale one. They cannot perform a hot reload; they hold the rule
   a hot reload depends on. */

interface Shape {
  readonly made: string;
}
class First implements Shape {
  readonly made = "first";
}
class Second implements Shape {
  readonly made = "second";
}

test("the same class is not rebuilt", () => {
  let builds = 0;
  const build = () => {
    builds += 1;
    return Promise.resolve<Shape>(new First());
  };
  const park = reused(undefined, First, build);
  const again = reused(park, First, build);
  assert.equal(again, park, "the same promise object, not an equal one");
  assert.equal(builds, 1, "and nothing was constructed a second time");
});

test("a replaced class is rebuilt, which is what a hot reload is", () => {
  const builds: string[] = [];
  const park = reused(undefined, First, () => {
    builds.push("First");
    return Promise.resolve<Shape>(new First());
  });
  const after = reused(park, Second, () => {
    builds.push("Second");
    return Promise.resolve<Shape>(new Second());
  });
  assert.notEqual(after, park, "a new instance, because the class changed under it");
  assert.equal(after.from, Second, "tagged with the class it was built from");
  assert.deepEqual(builds, ["First", "Second"]);
});

test("an untagged promise left by the previous code is rebuilt, not trusted", async () => {
  // The upgrade path: a process already parked a bare promise before this rule existed.
  // It carries no `from`, so it is indistinguishable from a stale one and must go.
  const bare = Promise.resolve<Shape>(new First()) as ServiceMemo<Shape>;
  const rebuilt = reused(bare, First, () => Promise.resolve<Shape>(new Second()));
  assert.notEqual(rebuilt, bare);
  assert.equal((await rebuilt).made, "second", "rebuilt rather than reused");
});

test("both service getters memoise through the rule, not with ??=", () => {
  const source = readFileSync("src/server/runtime.ts", "utf8");
  /* `??=` on a `globalThis` slot is a memo nothing can ever clear: not a restart-free
     reload, not editing the file, not the class being replaced. It is how last hour's
     validators answered a request built by this hour's UI. */
  assert.doesNotMatch(
    source,
    /state\.raspberry(?:Service|Databases)\s*\?\?=/,
    "a getter went back to `??=`, which can never notice a replaced class",
  );
  assert.match(source, /reused\(state\.raspberryService,/, "getService must go through the rule");
  assert.match(source, /reused\(state\.raspberryDatabases,/, "getDatabases must go through the rule");
});
