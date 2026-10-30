# Where everything lives

Read this before grepping. It exists because every session re-derived the same answers —
"which file owns drag?", "where does the database live?", "which test is the pattern to
copy?" — and because the reuse rule in `AGENTS.md` is unenforceable if you cannot find the
component to reuse.

One rule for this file: **one line per thing, with the path.** A sentence with no path
belongs in `STATE.md` (what is true now) or `DECISIONS.md` (why it is like that).

Sections are ordered by what you need first, not by filesystem order.

---

## 1. Run it

```powershell
Start-Raspberry.cmd          # the only supported way on the owner's machine
# then http://127.0.0.1:3000  — dev server, hot reload, loopback only
```

`start_raspberry.cmd` finds Node itself: it prefers a vendored toolchain at
`.tools\node-v24.22.1-win-x64\`, and falls back to `%USERPROFILE%\.cache\codex-runtimes\…`.
**`.tools/` is gitignored**, so on a fresh clone that path does not exist and a documented
`$env:Path = "$PWD\.tools\…"` line is a lie. Either use the launcher, or use whatever
`node --version` already works for you (24+).

| Task | Command |
|---|---|
| Run the app | `Start-Raspberry.cmd` |
| Typecheck | `node node_modules\typescript\bin\tsc --noEmit` |
| Unit + integration suite | `node node_modules\tsx\dist\cli.mjs --test tests\*.test.ts` |
| Both, plus the drift gate | `node scripts\check-docs.mjs --full` — this is the one that prints the pass count |
| Docs/tests/scripts drift gate only | `node scripts\check-docs.mjs` (`--fix` repairs the snapshot) |
| Back up the live database | `node node_modules\tsx\dist\cli.mjs scripts\backup.ts` (also `pnpm backup`) |
| MCP stdio server | `node node_modules\tsx\dist\cli.mjs src/mcp/stdio.ts` |

`package.json` also has `pnpm dev`, `pnpm test`, `pnpm check` — the same commands, but pnpm is
not on PATH here, so the invocations above are the ones that work.

**Restart the launcher after adding a server method.** See §3.

---

## 2. Shape of the repo

| Path | What it is | Read it when |
|---|---|---|
| `src/` | The app. Next.js App Router + React 19. 129 files. | Always. |
| `tests/` | 31 test files + `schema.ts` helper. `tsx --test`. | Before and after any change. |
| `docs/` | `STATE.md` (truth), `MAP.md` (this), `DECISIONS.md` (why), `TESTING.md` (how to prove), `ARCHIVE/` (history). | First, in that order. |
| `scripts/` | 13 real tools, documented in §7. | To run or verify something. |
| `scripts/scratch/` | 74 gitignored one-off probes, incl. the 28 `cdp-*.mjs` browser probes. Evidence, not tooling. Import `scripts/browser-session.mjs` for new ones. | Only to read a past measurement. |
| `data/` | Gitignored. `raspberry.sqlite` is **the owner's live database**, plus `uploads/<sha>` blobs, `logs/`, `archive/`. | Never casually. §8. |
| `artifacts/` | Gitignored test evidence: screenshots, DB snapshots. Was 14.6 GB of leaked Chrome profiles — see §9. | Rarely. |
| `deploy/` | `raspberry.service` unit for running the built app as a Windows service via `scripts/install-service.ps1`. | Only for "run it as a service". |
| `prototype/` | Standalone HTML explorations. Not imported by the app, not built, not tested. | Only when the owner points at it. |
| `src/app/*.css` | Eight stylesheets, each with one owner. §5. | Any visual change. |
| `.tools/`, `.secrets/`, `.unjess/`, `.next/` | Gitignored: vendored Node, push credentials, agent harness state, build output. | Never commit. |

---

## 3. One request, end to end

This is the single most useful paragraph in the file. A page save, top to bottom:

| Step | File |
|---|---|
| The editor component owns the draft | `src/components/block-editor.tsx` |
| Draft persistence / debounce | `src/lib/draft-registry.ts`, `src/lib/draft-sync.ts`, `src/components/use-page-draft.ts` |
| Client fetch layer (the one exception to "lib is pure") | `src/lib/api-client.ts` |
| Route handler | `src/app/api/pages/[id]/route.ts` |
| HTTP plumbing, JSON, errors, auth gate | `src/server/http.ts`, `src/server/access.ts`, `src/server/local-access.ts` |
| Business logic (all of it) | `src/server/service.ts` |
| SQL | `src/server/database.ts` |
| Schema changes | `src/server/migrations.ts` — 7 migrations, numbered, append-only |
| Service instance lookup | `src/server/runtime.ts` |

Databases have their own layer on top of the same spine:
`src/server/databases.ts` (service) → `src/lib/database/properties.ts` (schema/edit rules) →
`src/lib/database/rows.ts` (cells, ordering, `sortRows`) →
`src/lib/database/property-types/<type>.ts` (one file per property type; `shared.ts` is the
common contract) → UI in `src/components/database/`.

### API surface — every route, and where a body's shape is defined

| Route (under `/api`) | Methods |
|---|---|
| `/pages` | GET, POST |
| `/pages/[id]` | GET, PATCH, DELETE |
| `/pages/[id]/history` | GET |
| `/pages/[id]/move` | POST |
| `/pages/[id]/purge` | DELETE |
| `/pages/[id]/restore` | POST |
| `/trash` | DELETE |
| `/databases` | POST |
| `/databases/[id]` | GET, PATCH |
| `/databases/[id]/properties` | POST |
| `/databases/[id]/properties/[propertyId]` | PATCH, DELETE |
| `/databases/[id]/rows` | POST |
| `/databases/[id]/rows/[rowId]` | PATCH, DELETE |
| `/databases/[id]/rows/[rowId]/duplicate` | POST |
| `/databases/[id]/rows/order` | POST |
| `/databases/[id]/views/[viewId]` | PATCH |
| `/files` | POST |
| `/files/[id]` | GET |
| `/health` | GET |
| `/auth/google/start`, `/auth/google/callback` | GET |
| `/auth/verify-code`, `/auth/resend`, `/auth/logout` | POST |

**Bodies are not validated at the route layer.** Every handler is three lines: `readBody`,
hand the object to one service method, wrap it in `api()`. So the shape of a body is defined
by the method that receives it — `addProperty`, `patchProperty`, `addRow`, `patchRow`,
`reorderRows`, `patchView`, `duplicateRow`, `patchDatabase` in `src/server/databases.ts` —
not by the route. Read the method; the route will tell you nothing.

Two absences are deliberate, not oversights: there is no `POST /views` (a database ships with
its views) and no `DELETE /views/[id]`, and there is no filter endpoint — filters are
client-side.

### Where the schema lives — two files, and a trap in each

| Tables | Defined in |
|---|---|
| `schema_migrations`, `users`, `workspaces`, `memberships`, `pages`, `revisions`, `mutations` — the baseline | `src/server/database.ts` |
| `accounts`, `sessions`, `login_challenges`, `auth_events` | `migrations.ts`, migration 3 |
| `files` | migration 5 |
| `databases`, `database_properties`, `database_views`, `database_cells` | migrations 6–7 |

The baseline is in `database.ts`, not in `migrations.ts`, so "grep migrations for the table"
misses every table the page editor actually uses. A new table is a new numbered migration;
the baseline is never edited.

**There is no `blocks` table.** A page's blocks are JSON in `pages.content` (with a flattened
copy in `plain_text` for search, and `revision` incremented on write). Two consequences worth
knowing before you touch page writes:

- **Nesting is stored twice** — `pages.parent_id` (what the sidebar draws) and a `pageLink`
  block appended to the *parent's* content (what the parent's page shows). Writing one and not
  the other is how a nested page "disappears". This has shipped as a bug once.
- **Purging and restoring are recursive** over `parent_id`, not over content. See
  `src/server/service.ts` and `tests/purge.test.ts`.

### The 500 that is not a bug

`src/server/runtime.ts` memoises service instances on **`globalThis`**, which is exactly why
it is dangerous: hot reload re-evaluates the *class* but the stored *instance* survives, so a
method you added a minute ago answers `is not a function` and the route returns 500 — which
looks like a bug in your new method. Restart `Start-Raspberry.cmd` after adding a server
method. (Older docs said the state was "memoised on the module" and that reload *cleared* it.
It is global, and it survives. `DECISIONS.md` has the correction.)

---

## 4. Reuse before you write

`AGENTS.md` rule 2, and `tests/frame-anchor.test.ts` enforces the grip half of it. Search
here first; if the control you need is one of these, import it.

| Control | Import from | Use for | Trap |
|---|---|---|---|
| Grip + plus pair | `src/components/frame-anchor.tsx` renders `FrameAnchor`; it draws `GripGlyph` internally | The 6-dot grip and the plus, together, **always plus before grip** | **Never import `GripGlyph` directly.** `frame-anchor.test.ts` pins it to `frame-anchor.tsx` and `grip-glyphs.tsx` only. A database row grip is a `FrameAnchor`, not a `GripGlyph`. |
| The bare glyphs | `src/components/grip-glyphs.tsx` | Definitions only (`GripGlyph`, `AddGlyph`). | Two importers are permitted and pinned by `frame-anchor.test.ts`: `frame-anchor.tsx` (the pair) and `database/add-property-menu.tsx` (`+ Add property` — plus and label, no grip). A third fails the suite by design. |
| Drag preview / drop indicator | `src/components/drag-layer.tsx` | Anything dragged: pages, blocks, rows | One layer for the whole app; do not position a second one. |
| Modal shell, focus trap, Esc | `src/components/modal.tsx`; richer dialog `src/components/editor/dialog.tsx`, `src/components/settings/dialog.tsx` | Any dialog | Use the one whose layer you are in; do not fork a third. |
| Menu positioned at a point or button | `src/components/database/menu.tsx` with placement maths in `src/lib/menu-place.ts` | `⋯` menus, context menus, submenus | Placement is a shared calculation — right-click and `⋯` use the same one. |
| Page glyph / entry icon | `src/components/page-glyph.tsx`, `src/components/database/entry-icon.tsx` | Page and database icons | Do not reach for `lucide-react`. |
| Property type icons | `src/components/database/property-icons.tsx` | Any property-type icon | Driven by generated palette data; see `scripts/gen-palette.mjs`. |
| Colour palette / swatches | `src/lib/palette.ts`, `src/components/database/icon-picker.tsx` | Colour and icon pickers | Palette is generated; regenerate, do not hand-edit. |
| Form controls (toggle, field, row) | `src/components/settings/controls.tsx` | Settings and any settings-shaped form | These are small and easy to redraw by accident. |
| Page picker / move destination | `src/components/page-picker.tsx`, `src/components/move-picker.tsx` | Choosing a parent page | Both already handle cycles and self-move. |
| Object selection & clipboard | `src/components/editor/object-selection.tsx`, `src/lib/page-copy.ts` | Selecting/copying non-text objects | Copy is serialised through `page-copy.ts`, not the system clipboard alone. |

### `FrameAnchor` — the contract, because you cannot place a row grip without it

```ts
type FrameAnchorProps = {
  onAdd: () => void;              // required — a pair without it is the one object you
  addLabel: string;               //           cannot add below
  addTest?: string;
  onGrip?: () => void;            // press of the grip; omit when the grip is a drag handle
  gripLabel: string;
  gripTest?: string;
  gripOpen?: boolean;             // drives aria-expanded and the is-open tick
  gripClass?: string;             // `db-grip` for a drag handle, `is-inert` when it cannot act
  gripPointer?: GripPointerHandlers;  // { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
  inline?: boolean;               // host lays the pair out (row gutter) instead of floating
  anchorRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
};
```

Floating (default) is the editor's side menu: `.frame-anchor` positions itself on the block's
left edge. `inline` is the database row: the host positions it, so the pair can hang in the
page margin *outside* the table's own box — that is the 39×30 pair at 19.5+19.5, plus then
grip. A drag source passes `gripPointer` and `gripClass="db-grip"` rather than `onGrip`;
`scripts/verify-db-gutter.mjs` asserts all of it in a real browser.

---

## 5. Where to edit

### App shell and styling

| File | Owns |
|---|---|
| `src/app/layout.tsx` | Root layout, fonts, providers |
| `src/app/page.tsx` | The single page that mounts the shell |
| `src/app/globals.css` | Reset, tokens, typography |
| `src/app/shell.css` | Sidebar + main shell geometry |
| `src/app/tabs.css` | Tab strip |
| `src/app/settings.css` | Settings window |
| `src/app/database.css` | Database block, table, gutter, cells |
| `src/app/document.css` | Document column (`.doc`), page content measure |
| `src/app/editor-blocks.css` | Block types inside the editor |
| `src/app/theme.css` | Theme variables |
| `src/lib/theme.ts` | Theme selection and persistence |

A CSS rule for a component belongs in the sheet that owns that component's area, not in
`globals.css`. The gutter/table alignment bug (`STATE.md`) came from one sheet overriding
another's width — check specificity and which sheet loads last before blaming the component.

### Components

| File | Role |
|---|---|
| `src/components/workspace.tsx` | Top-level client shell: sidebar, document, state |
| `src/components/block-editor.tsx` | The editor itself (largest component) |
| `src/components/use-page-draft.ts` | Draft hook used by the editor |
| `src/components/tab-strip.tsx` | Open-page tabs |
| `src/components/crumbs.tsx` | Breadcrumb trail |
| `src/components/page-menu.tsx` | Page context menu (also right-click) |
| `src/components/page-picker.tsx` | Page chooser |
| `src/components/move-picker.tsx` | Move-to destination chooser |
| `src/components/page-glyph.tsx` | Page icon glyph |
| `src/components/sign-in.tsx` | Hosted-mode sign-in UI |

The shared controls — `frame-anchor.tsx`, `grip-glyphs.tsx`, `drag-layer.tsx`,
`modal.tsx` — also live here but are documented in §4, where the traps are.

`src/components/editor/`

| File | Role |
|---|---|
| `object-menu.tsx` | Block/object `⋯` menu |
| `object-selection.tsx` | Selecting non-text objects |
| `dialog.tsx` | Editor-layer dialog |
| `media.ts` | Media block helpers |
| `media-video.tsx` | Video embed block |
| `paste-images.ts` | Image paste handling |
| `schema.tsx` | Block schema/capabilities |
| `selection.ts` | Selection model helpers |

`src/components/database/`

| File | Role |
|---|---|
| `database-block.tsx` | The database block: owns view state, sorts, calls the API |
| `table-view.tsx` | Table rendering, row/cell layout, gutter alignment |
| `property-header.tsx` | Column header, property menu, `Change type` slot |
| `cell-editor.tsx` | Per-type cell editing |
| `add-property-menu.tsx` | New-property menu |
| `menu.tsx` | Menu primitive + placement (§4) |
| `property-icons.tsx` | Property-type icons (§4) |
| `icon-picker.tsx` | Icon + colour picker |
| `entry-icon.tsx` | Row/page icon in the database |
| `use-database.ts` | Data-fetching hook for a database |

`src/components/settings/`

| File | Role |
|---|---|
| `nav.tsx` | Settings window navigation |
| `controls.tsx` | Shared form controls (§4) |
| `dialog.tsx` | Settings dialog |
| `preview.tsx` | Live preview pane |

### Logic — `src/lib/` (pure, unit-tested)

`api-client.ts` (fetch layer — the documented exception), `document.ts` (document model),
`page-changes.ts` (diffing a draft against saved), `page-copy.ts` (copy/paste serialisation),
`crumbs.ts`, `tabs.ts`, `draft-registry.ts`, `draft-sync.ts`, `sidebar-drag.ts` (page tree
drag maths), `sidebar-menu.ts`, `menu-place.ts` (menu positioning), `palette.ts`,
`theme.ts`, `settings.ts`, `settings-nav.ts`, `clipboard-image.ts`.

`src/lib/database/`: `properties.ts`, `rows.ts`, `types.ts`, `property-types/*`.

### Server — `src/server/`

| File | Role |
|---|---|
| `service.ts` | All page/document business logic |
| `database.ts` | SQLite access, queries |
| `migrations.ts` | 7 append-only migrations |
| `runtime.ts` | Memoised service instance (§3) |
| `http.ts` | Request/response helpers, error shape |
| `access.ts`, `local-access.ts` | Who may do what; loopback single-user gate |
| `databases.ts` | Database/property/row service |
| `files.ts` | Upload/download of `data/uploads/<sha>` |
| `backup.ts` | Database backup |
| `session.ts`, `rate-limit.ts` | Sessions, request limits |
| `auth/` | `config`, `google`, `login`, `challenges`, `cookies`, `events`, `limits`, `mail`, `session-store`, `tokens` |

`src/mcp/`: `server.ts` (the MCP tool implementation), `stdio.ts` (stdio entry).

---

## 6. Tests — 31 files, and which one to copy

| Group | Files | Copy this one |
|---|---|---|
| Pages and documents | `pages`, `blocks`, `move`, `purge`, `positions`, `page-changes`, `drafts`, `crumbs`, `tabs` | `tests/pages.test.ts` |
| Service + SQLite integration | `service`, `databases`, `database-columns`, `database-properties`, `database-writes`, `migrations`, `files`, `access` | `tests/database-writes.test.ts` |
| Auth | `auth-login`, `session-store` | `tests/auth-login.test.ts` |
| Pure helpers | `sidebar-drag`, `sidebar-menu`, `menu-place`, `palette`, `settings-nav`, `clipboard-image`, `client` | `tests/sidebar-drag.test.ts` |
| Browser/UI primitives | `frame-anchor`, `media-blocks` | `tests/frame-anchor.test.ts` |
| MCP | `mcp`, `stdio` | `tests/mcp.test.ts` |
| **Guards on agents themselves** | `docs-freshness` (STATE/MAP/counts/artifacts), `frame-anchor` (reuse rule) | — |

`tests/schema.ts` is a helper, not a test. Guard tests are the two worth reading before you
argue with them: they exist because a note was ignored and a rule was re-broken.

Pixel-level UI verification is **not** in the suite. It is CDP probes; see `docs/TESTING.md`
and use `scripts/browser-session.mjs` so the browser profile cleans itself up.

---

## 7. Scripts — 13 tools

| File | Does |
|---|---|
| `scripts/local.mjs` | Dev/preview launcher behind `Start-Raspberry.cmd` (`pnpm dev`, `pnpm preview`) |
| `scripts/serve.mjs` | Production server (`pnpm start`) |
| `scripts/backup.ts` | Copies the live database to a timestamped backup (`pnpm backup`) |
| `scripts/check-docs.mjs` | The drift gate: STATE snapshot, counts, MAP coverage, root-markdown allowlist, artifacts leak, git facts |
| `scripts/check-icons.mjs` | Verifies property/icon references resolve |
| `scripts/gen-palette.mjs` | Regenerates the colour palette data used by `src/lib/palette.ts` |
| `scripts/browser-session.mjs` | **Tracked CDP browser session** for UI verification; removes its own Chrome profile |
| `scripts/verify-db-gutter.mjs` | The canonical row-gutter probe (20 assertions, 1400/390): alignment, reuse-by-pixel, heights |
| `scripts/read-spec-page.mjs` | Reads one spec page out of the running app |
| `scripts/verify-local.ps1` | Local smoke verification |
| `scripts/verify-session.ps1` | Session/auth verification |
| `scripts/install-service.ps1` | Installs `deploy/raspberry.service` |
| `scripts/uninstall-service.ps1` | Removes it |

One-off probes live in `scripts/scratch/` (gitignored). A file named `cdp-*`, `probe-*` or
`tmp-*` in `scripts/` itself fails `check-docs.mjs`.

---

## 8. Data

| Path | What |
|---|---|
| `data/raspberry.sqlite` | **The owner's live database.** One user's real pages. |
| `data/uploads/<sha>` | Live attachments, content-addressed. Not disposable. |
| `data/logs/` | Server and dev logs. |
| `data/archive/` | Dead databases moved aside, not deleted. |

Hard rule, twice over: **never delete, trash, or "tidy" pages in the live database.** Not
as cleanup after a test, not because they look like fixtures or say "Untitled". Full rule and
the safe read-only procedure: `docs/TESTING.md`. If a test must write, delete only the exact
ids it created in that same run.

---

## 9. Hazards

- **Do not recurse the repo root** if you can scope it. `node_modules/` is ~40 k files; a
  bare `Get-ChildItem -Recurse` from the root took **15 s** after cleanup and **timed out at
  120 s** before it. Scope to `src`, `tests`, `docs`.
- **`artifacts/` was a 14.6 GB, 371 607-file hole** (292 leaked Chrome profiles from CDP
  probes) and `.gitignore` hid it from every check. It is now 182 files / 43 MB.
  `scripts/check-docs.mjs` fails if a `.chrome-*` profile reappears; use
  `scripts/browser-session.mjs`, which deletes its profile on exit.
- **A 500 right after you edited a service class** is the stale instance, not your code. §3.
- **`docs/STATE.md` is the only truth about state.** If this file disagrees with it about
  what is done, STATE wins; if this file disagrees about *where things are*, they have both
  rotted — run `node scripts\check-docs.mjs`.
