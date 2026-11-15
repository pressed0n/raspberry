#!/usr/bin/env node
// Keeps docs/STATE.md honest.
//
// The reason this file exists: three documents used to claim to describe the project's
// state. Two of them were wrong — CHECKLIST.md said "257/257 tests pass" when 395 passed,
// and BACKLOG.md filed 11 already-shipped features under "Active to-do". Nothing failed,
// so nothing got noticed, so agents spent whole sessions building things that existed.
//
// A note in a document is only followed by whoever read it that session. A failing test is
// read by everyone. This is the failing test's engine.
//
// Usage:
//   node scripts/check-docs.mjs            structural checks only (safe to run from a test)
//   node scripts/check-docs.mjs --full     also runs the suite and checks the real count
//   node scripts/check-docs.mjs --fix      rewrite the snapshot block from reality
//   node scripts/check-docs.mjs --root DIR check a fixture tree instead (used by the test
//                                          that proves this checker can actually fail)
//
// `--offline` (the default) deliberately does NOT run the suite: it is invoked from
// tests/docs-freshness.test.ts, and a test that runs the suite to check the suite's count
// would be counting itself. The headline number is verified by `--full` in CI/manually.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const args = new Set(argv);
const FIX = args.has("--fix");
const FULL = args.has("--full");
const rootFlag = argv.indexOf("--root");
const root = rootFlag === -1 ? resolve(scriptDir, "..") : resolve(argv[rootFlag + 1]);
const STATE = join(root, "docs", "STATE.md");

const BEGIN = "<!-- SNAPSHOT:BEGIN — checked by tests/docs-freshness.test.ts -->";
const END = "<!-- SNAPSHOT:END -->";

const problems = [];
const fixed = [];
const fail = (msg) => problems.push(msg);

// ---------------------------------------------------------------- snapshot block

function readState() {
  if (!existsSync(STATE)) return null;
  return readFileSync(STATE, "utf8");
}

const stateText = readState();
if (stateText === null) {
  fail("docs/STATE.md is missing. It is the single source of truth; see AGENTS.md.");
}

function snapshotBlock(text) {
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b === -1 || e === -1 || e < b) return null;
  return { start: b, end: e + END.length, body: text.slice(b + BEGIN.length, e) };
}
const block = stateText === null ? null : snapshotBlock(stateText);
if (stateText !== null && block === null) {
  fail(
    "docs/STATE.md has no SNAPSHOT block. The markers are how the checked numbers are " +
      "located; without them the file cannot be kept honest."
  );
}

function documentedNumber(label, pattern) {
  if (!block) return null;
  const m = block.body.match(pattern);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- reality on disk

const testFiles = readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.ts"));

const migrationsSrc = readFileSync(join(root, "src", "server", "migrations.ts"), "utf8");
const versions = [...migrationsSrc.matchAll(/^\s*version:\s*(\d+),/gm)].map((m) => Number(m[1]));
const maxMigration = versions.length ? Math.max(...versions) : 0;

let suite = null;
if (FULL) {
  const node = process.execPath;
  const run = spawnSync(
    node,
    ["node_modules/tsx/dist/cli.mjs", "--test", "tests/*.test.ts"],
    { cwd: root, encoding: "utf8" }
  );
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const pass = Number((out.match(/^# pass (\d+)$/m) ?? out.match(/pass (\d+)/) ?? [])[1]);
  const failCount = Number((out.match(/^# fail (\d+)$/m) ?? out.match(/fail (\d+)/) ?? [])[1]);
  suite = { pass, failCount, code: run.status };
}

// ---------------------------------------------------------------- assertions

const docFiles = documentedNumber("test files", /across (\d+) test files/);
if (docFiles === null) {
  fail("docs/STATE.md does not state how many test files there are ('across N test files').");
} else if (docFiles !== testFiles.length) {
  fail(
    `docs/STATE.md says ${docFiles} test files; tests/ holds ${testFiles.length}. ` +
      `Run: node scripts/check-docs.mjs --fix`
  );
}

const docMigrations = documentedNumber("migrations", /migrations 1–(\d+)/);
if (docMigrations === null) {
  fail("docs/STATE.md does not state the schema version ('migrations 1–N').");
} else if (docMigrations !== maxMigration) {
  fail(
    `docs/STATE.md says migrations 1–${docMigrations}; migrations.ts defines ${maxMigration}. ` +
      `Run: node scripts/check-docs.mjs --fix`
  );
}

if (suite) {
  const documented = documentedNumber("tests", /\*\*Tests:\*\* (\d+) passing/);
  if (documented === null) {
    fail("docs/STATE.md does not state the passing test count.");
  } else if (suite.pass !== documented) {
    fail(
      `docs/STATE.md says ${documented} tests pass; the suite reports ${suite.pass}. ` +
        `Run: node scripts/check-docs.mjs --fix`
    );
  }
  if (suite.code !== 0) fail(`the test suite exited ${suite.code}; it must be green to check docs.`);
}

// Every relative markdown link in AGENTS.md and docs/STATE.md must resolve. A refactor that
// moves a file and forgets a link is exactly how the old docs rotted.
for (const file of ["AGENTS.md", "docs/STATE.md", "docs/MAP.md", "docs/TESTING.md", "docs/DECISIONS.md"]) {
  const abs = join(root, file);
  if (!existsSync(abs)) {
    fail(`${file} is missing.`);
    continue;
  }
  const text = readFileSync(abs, "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)#][^)]*)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue; // external
    const resolved = resolve(dirname(abs), target.replace(/[?#].*$/, ""));
    if (!existsSync(resolved)) fail(`${file} links to "${target}" which does not exist.`);
  }
}

// Root markdown is an allowlist, not a habit. Each file has exactly one job. This is what
// stops the next 157 KB of competing planning documents from accumulating at the root.
//
// PLAN.md is deliberately NOT here. It used to be, with the justification "generated by the
// planning tool, overwritten each plan" — which made the checker pass while a plan claiming
// "395 tests, AGENTS.md is 129 lines" sat at the root contradicting STATE.md. That is the
// self-serving exemption this file exists to catch. A plan is a session artifact, not
// project truth: it is gitignored now, and truth lives in docs/STATE.md.
const ALLOWED_ROOT_MD = new Set([
  "AGENTS.md", "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "LICENSE",
  // PLAN.md has its own rule below: allowed to exist, never allowed to be committed.
  "PLAN.md",
]);
for (const f of readdirSync(root)) {
  if (!f.endsWith(".md")) continue;
  if (!ALLOWED_ROOT_MD.has(f)) {
    fail(
      `unexpected markdown at the repo root: ${f}. New documents go in docs/; history goes ` +
        `in docs/ARCHIVE/; plans are gitignored session artifacts. Root files must be added to ` +
        `the allowlist in scripts/check-docs.mjs deliberately.`
    );
  }
}

// A plan file is allowed to exist on disk (the planning tool writes it) but never in git —
// and a session should know it is holding a stale one rather than treat it as state.
if (existsSync(join(root, "PLAN.md"))) {
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "PLAN.md"], { cwd: root, encoding: "utf8" });
  if (tracked.status === 0) {
    fail(
      "PLAN.md is committed. It is a session artifact that goes stale the moment the plan " +
        "ships; docs/STATE.md is the durable version. Run: git rm --cached PLAN.md"
    );
  } else {
    console.log(
      "note: PLAN.md is on disk, untracked. It is a plan, not state — docs/STATE.md is what " +
        "is true. Delete it once its plan has shipped."
    );
  }
}

// scripts/ holds real tools. Anything named like a one-off probe belongs in
// scripts/scratch/, which is gitignored — that graveyard was 74 of 84 files and made
// `git status` meaningless.
const SCRATCH_NAME = /^(cdp-|probe-|tmp-|prelude-)/;
const scriptsDir = join(root, "scripts");
const allScripts = existsSync(scriptsDir)
  ? readdirSync(scriptsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  : [];
// The naming check needs every file; the MAP-coverage check needs only real tools. Filtering
// for coverage first would have made the naming check dead code — the freshness test caught
// exactly that, which is what it is for.
for (const f of allScripts) {
  if (SCRATCH_NAME.test(f)) {
    fail(
      `scripts/${f} is named like a one-off probe. Move it to scripts/scratch/ (gitignored), ` +
        `or give it a real name if it is a tool worth keeping.`
    );
  }
}
const scriptFiles = allScripts.filter((f) => !SCRATCH_NAME.test(f));

// ---------------------------------------------------------------- coverage of MAP.md
//
// MAP.md's whole promise is "read this before grepping". A file it does not mention is a
// grep the next session has to run, so coverage is the thing worth asserting — prose
// quality is not machine-checkable, but omission is. The first version of this file
// documented 13 of 36 components and nobody noticed, because nothing counted.

const mapPath = join(root, "docs", "MAP.md");
const mapText = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : null;
if (mapText === null) {
  fail("docs/MAP.md is missing. It is how a session finds code without grepping.");
} else {
  // Every component in src/components/**, by path relative to the repo root. Tolerates a
  // tree without src/components/ — the freshness test drives this script against a synthetic
  // fixture of a few files, and a checker that only works on the full repo is a checker the
  // test cannot prove.
  const componentsDir = join(root, "src", "components");
  const components = [];
  const walk = (dir) => {
    if (!existsSync(join(root, dir))) return;
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(tsx|ts)$/.test(e.name)) components.push(rel);
    }
  };
  walk("src/components");

  const unmentioned = components.filter((c) => !mapText.includes(c) && !mapText.includes(c.split("/").pop()));
  if (unmentioned.length) {
    fail(
      `docs/MAP.md does not mention ${unmentioned.length} of ${components.length} files in ` +
        `src/components/: ${unmentioned.map((c) => c.split("/").pop()).join(", ")}. ` +
        `Add a one-line row for each — an undocumented file is a grep every future session repeats.`
    );
  }

  const unmentionedScripts = scriptFiles.filter((s) => !mapText.includes(s));
  if (unmentionedScripts.length) {
    fail(`docs/MAP.md does not mention scripts/${unmentionedScripts.join(", scripts/")}.`);
  }

  /* Counts in prose rot in silence. `--full` printed OK while MAP.md claimed "129 files"
     (131), "31 test files" (32) and "13 real tools" (16), because the only numbers ever
     checked were the ones inside STATE.md's snapshot block. A number MAP states about the
     tree is asserted here; a number that cannot be checked is removed, not guessed —
     `scripts/scratch/`'s count went stale inside a single session. */
  const countOf = (dir, filter) => {
    if (!existsSync(join(root, dir))) return null;
    let n = 0;
    const walkDir = (rel) => {
      for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
        if (e.isDirectory()) walkDir(`${rel}/${e.name}`);
        else if (!filter || filter(e.name)) n++;
      }
    };
    walkDir(dir);
    return n;
  };
  const claimedCounts = [
    { re: /(\d+)\s+files\.\s*\|/, actual: () => countOf("src"), what: "files in src/" },
    { re: /(\d+)\s+test files/, actual: () => testFiles.length, what: "test files" },
    { re: /(\d+)\s+real tools/, actual: () => scriptFiles.length, what: "tracked scripts" },
    { re: /(\d+)\s+gitignored one-off probes/, actual: () => countOf("scripts/scratch"), what: "scratch probes" },
  ];
  for (const { re, actual, what } of claimedCounts) {
    const m = mapText.match(re);
    if (!m) continue; // not stated, or a synthetic fixture — nothing to contradict
    const truth = actual();
    if (truth !== null && Number(m[1]) !== truth) {
      fail(`docs/MAP.md says ${m[1]} ${what}; the tree holds ${truth}.`);
    }
  }

  // The launcher is the only supported way to start the app on the owner's machine; if MAP
  // stops naming it, a session will invent a dev-server invocation and hit a stale-instance 500.
  if (!mapText.includes("Start-Raspberry.cmd")) {
    fail("docs/MAP.md no longer names Start-Raspberry.cmd as the way to run the app.");
  }

  // frame-anchor.test.ts pins GripGlyph to exactly two files. Advice to import it anywhere
  // else is advice that fails the suite, so MAP.md may only name the allowed importer.
  for (const line of mapText.split("\n")) {
    if (!/\bGripGlyph\b/.test(line)) continue;
    if (!/frame-anchor/.test(line)) {
      fail(
        `docs/MAP.md mentions GripGlyph on a line that does not say "frame-anchor": ` +
          `"${line.trim().slice(0, 90)}". tests/frame-anchor.test.ts permits GripGlyph only in ` +
          `frame-anchor.tsx and grip-glyphs.tsx — importing it for a database row fails the suite.`
      );
    }
  }
}

// ---------------------------------------------------------------- repo hazards
//
// `artifacts/` is gitignored, so nothing in version control ever complained about it. It
// reached 292 leaked Chrome profiles — 371,607 files, 14.6 GB — which made a recursive
// listing from the repo root time out. That is a context problem, not a disk problem: it
// is the first thing an agent does. scripts/browser-session.mjs cleans up after itself now;
// this is the check that notices if something new starts leaking.

const artifactsDir = join(root, "artifacts");
if (existsSync(artifactsDir)) {
  const entries = readdirSync(artifactsDir, { withFileTypes: true });
  const leaked = entries.filter((e) => e.isDirectory() && e.name.startsWith(".chrome-")).map((e) => e.name);
  if (leaked.length) {
    fail(
      `artifacts/ holds ${leaked.length} leaked Chrome profile(s) (${leaked.slice(0, 3).join(", ")}` +
        `${leaked.length > 3 ? ", …" : ""}). Use scripts/browser-session.mjs, which removes its profile ` +
        `on exit; delete the leftovers with: rd /s /q artifacts\\.chrome-*`
    );
  }

  /* `run-b40-probe.ps1` copies the project to `artifacts/qa-run` and deletes it in `finally`.
     A crash skips `finally`, and the leftover is not harmless: it carries its own
     `data/qa.sqlite` and its own `src/`, so the next probe can quietly verify stale code
     against a stale database. That is a false green, which is worse than a red. */
  if (entries.some((e) => e.isDirectory() && e.name === "qa-run")) {
    fail(
      `artifacts/qa-run is left over from a probe run that was killed before its finally block. ` +
        `It carries a second database and a stale copy of src/, so it must not be probed against. ` +
        `Delete it: rd /s /q artifacts\\qa-run — run-b40-probe.ps1 rebuilds it.`
    );
  }

  /* The owner's database must never live in a folder that every document describes as
     disposable evidence. Two full snapshots (30 MB, 25 and 16 pages) sat in artifacts/ until
     30 October, one `rd /s /q artifacts\\*` away from being deleted by the very instructions
     written to clean the place up. `pnpm backup` already owns the correct destination. */
  const strayDatabases = existsSync(artifactsDir)
    ? readdirSync(artifactsDir).filter((name) => /\.sqlite(-shm|-wal)?$/.test(name))
    : [];
  if (strayDatabases.length) {
    fail(
      `artifacts/ holds ${strayDatabases.length} SQLite file(s): ${strayDatabases.join(", ")}. ` +
        `artifacts/ is disposable evidence — the docs tell sessions to delete it. Owner data ` +
        `belongs in data/backups/ (write one with: pnpm backup). Move it, never delete it.`
    );
  }
}

/* A stale pass count in the working directory is worse than a missing one. `tests.out.log`
   sat at the root claiming "pass 397" while the suite ran 415, and a session that greps the
   root finds that number before it finds docs/STATE.md. The dev server's own console is
   allowed, because a detached server holds those two files open; anything else is litter
   that quotes a number nobody recomputed. */
const ROOT_LOG_ALLOWLIST = new Set(["dev.out.log", "dev.err.log"]);
const rootLogs = readdirSync(root)
  .filter((name) => /\.(log|err|out)$/.test(name))
  .filter((name) => !ROOT_LOG_ALLOWLIST.has(name));
if (rootLogs.length) {
  fail(
    `the repo root holds ${rootLogs.join(", ")}. Files named *.log/*.out/*.err at the root are ` +
      `stale run output quoting numbers nobody recomputed — the last one claimed "pass 397" ` +
      `beside 415 real tests. Pipe test output into artifacts/ or do not keep it. ` +
      `(Only dev.out.log and dev.err.log are allowed: a detached dev server holds those open.)`
  );
}

/* The live-write guard is the only thing standing between a CDP probe and the owner's
   database. It is four lines of setup; deleting it restores the bug it was written for —
   which left 194 trashed pages in data/raspberry.sqlite, created and then swept by a script. */
const browserSessionPath = join(root, "scripts", "browser-session.mjs");
const browserSession = existsSync(browserSessionPath) ? readFileSync(browserSessionPath, "utf8") : null;
for (const marker of ["LIVE WRITE GUARD", "Page.addScriptToEvaluateOnNewDocument", "allowMutations"]) {
  if (browserSession === null) break; // synthetic fixture: the helper is not part of it
  if (!browserSession.includes(marker)) {
    fail(
      `scripts/browser-session.mjs no longer contains "${marker}". Without it a probe opened ` +
        `against http://127.0.0.1:3000 can POST/PATCH/DELETE into data/raspberry.sqlite — which ` +
        `is how 194 fixture pages ended up in the owner's trash. See docs/TESTING.md.`
    );
  }
}

// ---------------------------------------------------------------- git facts
//
// The snapshot's first version said "Committed through f22c6ce" while HEAD was cb3578f —
// because --fix preserved the old line verbatim rather than recomputing it. A number the
// tool cannot derive is a number that rots silently, and this one rots fastest: it is the
// line telling a session which commit everything below is known to be true at.

const git = (args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
};
const head = git(["rev-parse", "--short", "HEAD"]);

// Dirtiness ignores docs/STATE.md itself. Without that, the snapshot can never describe a
// clean tree: `--fix` writes the file, which makes the tree dirty, so the value it just wrote
// is already false and every docs change needs a second "snapshot" commit. A file describing
// its own uncommitted state is not uncommitted work.
const dirtyLines = (git(["status", "--porcelain"]) ?? "")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((l) => !/(^|\/)docs\/STATE\.md$/.test(l.replace(/^.. /, "")));
const treeDirty = head === null ? null : dirtyLines.length > 0;

if (head && block) {
  const docHead = (block.body.match(/Committed through:\*\* `([0-9a-f]+)`/) ?? [])[1] ?? null;
  if (docHead === null) {
    fail("docs/STATE.md does not say which commit it describes ('Committed through `abc1234`').");
  } else if (docHead !== head) {
    // Ancestry, not equality. Equality can never converge: the commit that updates this line
    // changes the sha it is updating to. What the line actually claims is "everything below
    // was true as of this commit", and a docs-or-tooling commit on top does not falsify that.
    // A rewritten or unreachable sha does — which is the case worth failing on.
    const reachable = spawnSync("git", ["merge-base", "--is-ancestor", docHead, "HEAD"], { cwd: root }).status === 0;
    if (!reachable) {
      /* A shallow clone fails this check for a reason that is not the snapshot's fault:
         `actions/checkout` clones depth 1 by default, so the parent commit the snapshot
         names is simply absent and `--is-ancestor` reports "no". Saying "history was
         rewritten" there is a lie that costs a session an hour, so the two cases are
         named separately. The fix in CI is `fetch-depth: 0` on the job that runs the
         suite; the fix locally is `git fetch --unshallow`. */
      const shallow = git(["rev-parse", "--is-shallow-repository"]) === "true";
      fail(
        shallow
          ? `docs/STATE.md says committed through ${docHead}, which cannot be shown to be an ` +
            `ancestor of HEAD (${head}) because this clone is shallow. The snapshot is probably ` +
            `fine; the history it needs was not fetched. Fix: \`git fetch --unshallow\`, or set ` +
            `fetch-depth: 0 on the checkout step that runs this suite (.github/workflows/ci.yml).`
          : `docs/STATE.md says committed through ${docHead}, which is not an ancestor of HEAD ` +
            `(${head}). Either history was rewritten or the sha is wrong. ` +
            `Run: node scripts/check-docs.mjs --fix`
      );
    }
  }
  const docTree = /Working tree:\*\* (clean|dirty)/.exec(block.body)?.[1] ?? null;
  if (docTree === null) {
    fail("docs/STATE.md does not state whether the working tree is clean.");
  } else if (docTree === "clean" && treeDirty) {
    // Asymmetric on purpose, for the same reason the sha check is. "clean" is a claim about
    // the tree *now*, and a dirty tree falsifies it. "dirty" is a claim about the moment it
    // was written; committing that work afterwards does not make the sentence a lie, it makes
    // it history. Failing in that direction is what forced a second "snapshot" commit after
    // every change — a rule that punishes the correct workflow gets bypassed, not obeyed.
    fail(
      `docs/STATE.md says the working tree is clean, but ${dirtyLines.length} file(s) are ` +
        `uncommitted: ${dirtyLines.slice(0, 3).join(", ")}. Run: node scripts/check-docs.mjs --fix`
    );
  }
}

// ---------------------------------------------------------------- repair

if (FIX && block) {
  const passing = suite ? suite.pass : documentedNumber("tests", /\*\*Tests:\*\* (\d+) passing/);
  const subject = head ? (git(["log", "-1", "--format=%s"]) ?? "") : "";
  const body = [
    "",
    `- **Tests:** ${passing} passing, 0 failing, across ${testFiles.length} test files.`,
    `- **Typecheck:** \`tsc --noEmit\` clean.`,
    `- **Committed through:** \`${head ?? "unknown"}\`${subject ? ` — ${subject}` : ""}.`,
    `- **Schema:** migrations 1–${maxMigration}.`,
    `- **Working tree:** ${treeDirty === null ? "unknown" : treeDirty ? "dirty (uncommitted work in progress)" : "clean"}.`,
    "",
  ]
    .filter((l) => l !== "" || true)
    .join("\n");
  const next = `${stateText.slice(0, block.start)}${BEGIN}\n${body.trimEnd()}\n${END}${stateText.slice(block.end)}`;
  if (next !== stateText) {
    writeFileSync(STATE, next, "utf8");
    fixed.push("docs/STATE.md snapshot rewritten");
  }
}

// ---------------------------------------------------------------- report

if (problems.length === 0) {
  console.log(`docs OK — ${testFiles.length} test files, migrations 1–${maxMigration}` +
    (suite ? `, ${suite.pass} tests passing` : " (structural checks only; --full to verify the count)"));
  for (const f of fixed) console.log(`fixed: ${f}`);
  process.exit(0);
}

console.error(`docs drift — ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
for (const p of problems) console.error(`  • ${p}`);
for (const f of fixed) console.error(`  fixed: ${f}`);
process.exit(1);
