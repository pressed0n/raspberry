# Implementation Plan: Make Raspberry's context layer cheap to load and impossible to lie

> Generated at: 2026-10-30 18:05:06

## Executive Summary
Diagnosis first, because the shape of the fix depends on it. The repo is not too big: src/ is 129 files / 871 KB and scripts/ only 5 tracked files matter. The damage is concentrated in the *meta-layer* — the files an agent reads before touching code.

Measured, not guessed:

1. THREE COMPETING STATE FILES, ALL STALE.
   - CHECKLIST.md line 9: "State: 257/257 tests pass". Actual, measured just now: 395/395 pass. 54% understated drift.
   - CHECKLIST.md "To do": B9, B21. Reality: the whole database programme (B39–B45) shipped.
   - BACKLOG.md §2 is titled "Active to-do — Notion parity". All seven entries under it begin with the word "Shipped 28/29/30 October". 42 KB of delivered history filed as pending work.
   So an agent that reads the docs to decide what to do next is told to build things that already exist, and is not told what exists.

2. AGENTS.md IS GOOD BUT SELF-DEFEATING. 129 lines / 7.4 KB, auto-injected every session — and it *truncated in my own context window this session*. The hard safety rules sit at the top and survive; the hard-won tail rules ("the guard is a test, not a note", "the dev server caches instances → restart before believing a 500") are exactly what gets cut. It also mixes three unrelated genres: 9 lines of `next dev` boilerplate that the tool rewrites, two hard safety rules, one genuinely excellent component-registry table, and ~50 lines of CSS-specificity war stories.

3. NO MAP. Nothing in the repo says where anything lives. 129 src files, 31 test files. The component table in AGENTS.md is the single best artifact in the repo and it only covers the ~14 controls the owner complained about — nothing else. Every session I re-derive `src/lib/sidebar-drag.ts` by grep.

4. SCRIPTS IS A GRAVEYARD, AND .gitignore ONLY HALF WORKS. 84 files, 5 tracked, 64 untracked, zero referenced by anything. .gitignore has a good rule (`scripts/tmp-*`) with a good comment explaining it — but only matches `tmp-*`. The `probe-*` and `cdp-*` one-offs escape it. That is 64 of the 164 dirty entries in `git status`, which trains everyone to ignore dirtiness entirely.

5. THE TRUTH LIVES OUTSIDE THE REPO. Last commit is 28 Oct. Every database feature since is uncommitted working-tree change across ~100 files. So `git log` cannot describe the project, the docs do not describe it, and the only accurate record is my cross-session memory — which is exactly why the context feels flaky: the accurate channel is the one that isn't in the repo.

The fix, therefore, is not "move folders around". It is: make the repo's meta-layer *machine-checked* so it cannot drift, keep the always-injected file small enough that its essentials survive truncation, and give every session one map and one state file. The repo already knows this principle — AGENTS.md's own line, "The guard is a test, not a note. A note is only followed by whoever read it that session; a failing test is read by everyone." I am applying that sentence to the documentation.

Nothing in src/ logic changes. No page or database row is touched (owner's data rule). No file that package.json references moves.

## Action Steps
1. Establish a baseline so 'without breaking the app' is provable, not asserted: run tsc --noEmit and the full suite (expect 395 pass), record both numbers. Save them as the reference for every later step.
2. Create docs/ with four focused files: MAP.md (where everything lives — src/lib pure logic, src/server service layer, src/components, src/app CSS ownership, tests/*.test.ts ↔ lib module pairing, which scripts are real vs scratch), STATE.md (the single current-state file: test count, uncommitted-work reality, current feature, what is genuinely next), TESTING.md (how to verify with the read-only CDP rule and the never-delete-owner-pages rule restated where a test author will actually see it), and DECISIONS.md (the why: CSS specificity collisions, drag layer, frame-anchor alignment, dev-server instance caching).
3. Slim AGENTS.md to what must survive injection: the two hard safety rules, a 'start here' three-line pointer to STATE.md/MAP.md, and the component registry table kept verbatim because it is the most valuable thing in the file. Move the war stories to docs/DECISIONS.md. Relocate the auto-generated next.js block to the END of the file — its BEGIN/END markers are byte-preserved so next dev does not re-add it, and if truncation bites it now eats generated boilerplate instead of hard-won rules.
4. Stop the docs from lying. Retitle BACKLOG.md §2 from 'Active to-do' to what it actually is (delivered), fix CHECKLIST.md's 257→measured count, and cross-link each of the three legacy files to docs/STATE.md as the authority so two files can never again disagree about what is done.
5. Quarantine the graveyard: move the 64 untracked one-offs into scripts/scratch/, extend .gitignore from scripts/tmp-* to also cover scripts/scratch/ (keeping the existing explanatory comment, extended), so git status stops crying wolf and searches stop returning probe noise. Only the 5 tracked scripts stay in scripts/ — nothing that package.json references moves.
6. Turn the state file into a guard rather than a note: add scripts/check-docs.mjs that recomputes the real test count and src/test file inventory, and tests/docs-freshness.test.ts which fails the suite when STATE.md's numbers no longer match reality. This is the mechanism that makes step 4 impossible to re-break — drift becomes a red test, not a slow decay.
7. Re-verify identically to the baseline: tsc --noEmit clean, full suite back to 395 pass (now 396 with the new guard), plus one CDP smoke against the running app to confirm the UI is untouched. Then summarise what moved, what was rewritten, and what I deliberately did not touch.

## Open Questions & Considerations
- The deepest problem I can't fix by reorganizing files: your last 5 features (B39–B40e, ~100 files) are uncommitted, so `git log` stops at 28 Oct and an agent reading history sees a project 5 features out of date. Want me to commit the current working tree as a baseline (after tests pass) so history becomes a usable signal again? I'd do it as one clearly-labelled commit, nothing else.
- Should I keep CHECKLIST.md as a one-screen summary (regenerated by the freshness guard), or retire it entirely into docs/STATE.md? Keeping it means maintaining two short files; retiring it means one truth plus one deep archive.
- The 83 MB in data/ (three 10 MB sha-named blobs, 5 sqlite snapshots) is gitignored but still pollutes every glob. Leave it alone, or move the non-live files to data/archive/?

