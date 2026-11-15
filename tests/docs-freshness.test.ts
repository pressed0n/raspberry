import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/* The owner's complaint, in their words: "you got worse at working on the Raspberry
   project and I assume it's because the project got bigger and probably also messier
   which makes it harder for you to efficiently get context ... sometimes you're missing
   the essentials, sometimes you get filler context that you dont need."

   They were right, and the measurement was unambiguous:

     - CHECKLIST.md said "State: 257/257 tests pass". The suite ran 395.
     - CHECKLIST.md's to-do said B9 and B21. The whole database programme had shipped.
     - BACKLOG.md's "## 2. Active to-do" contained 14 headings of which 11 began
       "Shipped <date>".
     - AGENTS.md was 7.4 KB and truncated on injection, so its tail rules were the ones lost.

   Nothing failed, so nothing was noticed. This file is the answer to that: it shells out to
   scripts/check-docs.mjs and asserts that the documentation still matches the disk.

   What it catches: a test file added without updating docs/STATE.md, a migration added past
   the documented version, a link left dangling by a moved file, a new 52 KB planning
   document dropped at the repo root, and a `probe-*.mjs` left in scripts/ instead of
   scripts/scratch/.

   What it deliberately does NOT catch: the headline pass count. Verifying the suite's own
   total from inside the suite is counting yourself. `node scripts/check-docs.mjs --full`
   does that, and is the thing to run before claiming the docs are current. */

const ROOT = process.cwd();
const check = (cwd: string, extra: string[] = []) =>
  spawnSync(process.execPath, ["scripts/check-docs.mjs", "--root", cwd, ...extra], {
    cwd: ROOT,
    encoding: "utf8",
  });

test("docs/STATE.md still matches the code on disk", () => {
  const run = check(ROOT);
  assert.equal(
    run.status,
    0,
    `Documentation has drifted from the code.\n\n${run.stderr || run.stdout}\n` +
      `docs/STATE.md is the single source of truth for what is built, what is next and what ` +
      `is parked. When the code changes, that file changes with it — otherwise the next ` +
      `session spends its budget rediscovering the truth, which is the exact failure this ` +
      `suite was extended to prevent.`
  );
});

test("the checker fails, by name, on every kind of drift it claims to catch", () => {
  // A guard that cannot fail is decoration. This builds a deliberately wrong project and
  // requires the checker to name each planted problem, so a future edit that guts the
  // checker fails here rather than silently un-protecting the docs.
  const fixture = mkdtempSync(join(tmpdir(), "raspberry-docs-"));

  try {
    mkdirSync(join(fixture, "docs"), { recursive: true });
    mkdirSync(join(fixture, "tests"), { recursive: true });
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    mkdirSync(join(fixture, "src", "server"), { recursive: true });

    writeFileSync(
      join(fixture, "docs", "STATE.md"),
      [
        "# State",
        "",
        "<!-- SNAPSHOT:BEGIN — checked by tests/docs-freshness.test.ts -->",
        "- **Tests:** 999 passing, 0 failing, across 2 test files.",
        "- **Schema:** migrations 1–99.",
        "<!-- SNAPSHOT:END -->",
        "",
      ].join("\n"),
      "utf8"
    );

    // Reality: one test file, one migration.
    writeFileSync(join(fixture, "tests", "a.test.ts"), "", "utf8");
    writeFileSync(
      join(fixture, "src", "server", "migrations.ts"),
      [
        "export const migrations = [",
        "  {",
        "    version: 1,",
        '    name: "one",',
        "  },",
        "];",
        "",
      ].join("\n"),
      "utf8"
    );

    // The five documents whose links are checked must exist, so the only failures below
    // are the ones planted on purpose.
    for (const f of ["AGENTS.md", join("docs", "MAP.md"), join("docs", "TESTING.md"), join("docs", "DECISIONS.md")]) {
      writeFileSync(join(fixture, f), "# doc\n", "utf8");
    }

    // Planted problems:
    writeFileSync(join(fixture, "STRAY-PLAN.md"), "# a 52 KB planning document\n", "utf8");
    writeFileSync(join(fixture, "scripts", "probe-what-is-this.mjs"), "", "utf8");
    writeFileSync(join(fixture, "docs", "MAP.md"), "[gone](GONE.md)\n", "utf8");

    const run = check(fixture);
    const output = `${run.stderr}${run.stdout}`;

    assert.notEqual(run.status, 0, "the checker must fail on a project whose docs are wrong");
    assert.match(output, /docs\/STATE\.md says 2 test files; tests\/ holds 1/, "must catch a wrong test-file count");
    assert.match(output, /migrations 1–99; migrations\.ts defines 1/, "must catch a wrong schema version");
    assert.match(output, /unexpected markdown at the repo root: STRAY-PLAN\.md/, "must catch root doc sprawl");
    assert.match(output, /scripts\/probe-what-is-this\.mjs is named like a one-off probe/, "must catch probe litter in scripts/");
    assert.match(output, /docs\/MAP\.md links to "GONE\.md"/, "must catch a dangling link");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

/* 2833a7c went red in CI with a message that had nothing to do with the code:
   "docs/STATE.md says committed through f7b7ce2, which is not an ancestor of HEAD".

   The snapshot was correct. `actions/checkout` clones depth 1 by default, so the parent
   commit the snapshot names was simply not in the clone, and `git merge-base
   --is-ancestor` answered "no" — which the checker reported as rewritten history.

   Two separate lessons are pinned here. The first is mechanical: the job that runs this
   suite must fetch history, because the docs check reads it. The second is the one that
   matters — a guard that fails for the wrong reason is a guard people learn to ignore,
   so the checker now tells a shallow clone apart from a broken snapshot instead of
   blaming the docs for the clone's shape. */
test("the CI job that runs this suite checks out the history the docs check reads", () => {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8").replace(/\r\n/g, "\n");
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === "  verify:");
  assert.notEqual(start, -1, "ci.yml has no `verify` job; the suite would never run on a push");
  // Bounded by the *next* job rather than by a hard-coded name: bounding this slice with
  // `build:` meant that adding a job between the two silently widened what it inspected.
  const next = lines.findIndex((line, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line));
  const job = lines.slice(start, next === -1 ? undefined : next).join("\n");

  assert.match(job, /actions\/checkout@v\d+/, "the verify job must check the repository out");
  assert.match(
    job,
    /fetch-depth:\s*0/,
    "The verify job clones depth 1 by default, but tests/docs-freshness.test.ts runs " +
      "scripts/check-docs.mjs, which asks git whether the commit docs/STATE.md names is an " +
      "ancestor of HEAD. With no history that question is unanswerable and a correct snapshot " +
      "reads as rewritten history — the exact false red the run on 2833a7c produced. Add " +
      "`with: fetch-depth: 0` to the checkout step in the verify job."
  );
});

/* B4's whole problem was that the PostgreSQL adapter existed and had never been executed:
   `docs/STATE.md` called it "unverified code", and every job ran the suite on
   `file::memory:`, so nothing could ever disagree. A comment cannot prevent that state from
   coming back. This can: if the job that points the suite at a real server is deleted or
   loses its URL, this fails and says exactly which adapter is unrun again. */
test("some CI job still runs the suite against a real PostgreSQL server", () => {
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    workflow,
    /RASPBERRY_TEST_DATABASE_URL:\s*postgres(ql)?:\/\//,
    "No CI job sets RASPBERRY_TEST_DATABASE_URL to a postgres:// URL, so the PostgreSQL branch " +
      "of openDatabase — the one a hosted deployment uses — is no longer executed anywhere. " +
      "That is precisely the state B4 was opened to fix, and it is invisible: the suite stays " +
      "green because it only ever runs on SQLite. Restore the `postgres` job in " +
      ".github/workflows/ci.yml (service container plus this variable)."
  );
});
