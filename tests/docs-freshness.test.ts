import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
