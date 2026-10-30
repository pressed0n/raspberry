# B18 + B19 — reskin and de-fluff prototype

**Status: prototype only. Nothing in `src/` has been touched.** This folder is a
self-contained HTML/CSS/JS mock so the direction can be judged before it costs
anything to implement.

## Open it

```
prototype\index.html          the app, dark (default)
prototype\index.html#light    same screen, light
prototype\index.html#palette  command palette open
prototype\index-empty.html    empty state
prototype\mobile.html         two phones at 390px, framed
```

It is operable, not a picture: `Ctrl K` opens search, the `⋯` menu drops down,
the star toggles, the theme button switches, to-dos tick, `Esc` closes.

---

## The diagnosis

The current build is a wellness journal wearing a notes app's clothes. It is not
ugly — it is *soft in the wrong places*: 8–11px type, three create-page buttons,
and a page that says its own name three times before the first paragraph.

The reskin moves the warmth from **copy** into **typography and material**, which
is the one place that warmth survives daily use.

## The direction

| Decision | Why |
|---|---|
| Dark is default, light is a full sibling | Both themes are built from one token layer, so B20 is a toggle, not a second reskin |
| Serif page title (Palatino/Iowan, weight 400) | Replaces the lost warmth. A writing surface earns gravitas from its type, not from "Room to think" |
| One accent (berry), used only for state | Colour marks *active, focus, saved, checked*. Never structure, never decoration |
| 16px body / 1.65 leading / 708px measure | Legible at 100% zoom; the old build ran to 8px |
| 30px sidebar rows, 8px gutters | Reads calm at 20 pages and stays readable at 200 |
| Depth from value shifts + hairlines, not shadows | Shadows only on true overlays (menus, palette) |
| Sticky topbar is translucent, no bottom rule | Scroll edge fades in instead of drawing a line across the page |
| Motion: ~200ms, one curve `cubic-bezier(.32,.72,0,1)` | Settles without overshoot. Bounce is reserved for gesture-driven motion, of which there is none yet |
| `prefers-reduced-motion` and `<prefers-reduced-transparency>` | Cross-fade and solid chrome, not "animations off" |

---

## B19 — the fluff ledger

Everything below is **deleted**. Each row is a real element in `workspace.tsx` or
`globals.css` today.

| Removed | Where it lives now | Why |
|---|---|---|
| "YOUR SPACE TO THINK" eyebrow + rule | `.document-eyebrow` | Decorative caps above a page that already has a title |
| Fake `Y` avatar + "Your personal space" | `.document-meta`, `.author-avatar` | Invents an author on a single-user tool |
| "A little more clarity. A little more possibility." | `.workspace-note` | The single largest block of pure poetry |
| Leaf sprout glyph | `.workspace-note` icon | Decoration with no function |
| "raspberry · Good things grow here." | `.main-footer` | Tagline, not information |
| "A little progress, saved." + "Start another page" | `.document-bottom` | Duplicates the save state and the New page action |
| "Personal workspace / Room to think." + `P` avatar | `.workspace-name` | Duplicates the brand row and the title |
| Sidebar `+` inside section head | `.tiny-button` | Second of three create affordances |
| "Add a page" row at sidebar bottom | `.add-page` | Third of three create affordances |
| Red dot after the brand name | `.brand-period` | Decorative punctuation |
| Breadcrumb "Personal workspace › Page" | `.breadcrumbs` | The 40px title sits directly below it |
| "Find a little clarity" | search modal title | Replaced with plain "Search" |
| "A place for every thought. A way to find it again." | search modal footer | Removed; footer now shows only key hints |
| "A few little shortcuts" + help paragraph | help modal | Replaced with the shortcut list alone |
| "Your page, over time" | history modal | Replaced with "Version history" |
| "A change of mind is always welcome." | trash | Replaced with "Restore a page to bring it back." |
| "A fresh start." / "Your next idea deserves a page." | `.workspace-empty` | Replaced with "No pages yet" |
| "Making a little room…" / "Opening your page…" | loading | Replaced with "Loading…" |
| Decorative dots and rules | `.bottom-dot`, `.eyebrow-line`, `.meta-dot`, `.document-rule` | Noise |

**Kept, deliberately** — these are substance, not decoration:

- Save state (now a 5px dot + short label, not a sentence)
- Word count, favourites, trash, sign out
- Page icon picker, export, duplicate, history, delete
- `Local only` — honest about the fact that nothing is synced

---

## What the prototype does not cover

- **Tables, boards, calendars** — that is B9, not this.
- **Attachments** — placeholder block only; there is no binary storage (B10).
- **Real block set** — nine block types are styled here; the rest come with B21.
- **Focus traps and ARIA wiring** — the palette has `role="dialog"` but the real
  build needs the full focus management already used by the existing modals.

## Three bugs found by building this

Worth recording because they are the kind of thing that only shows up when you
look at a rendered screen:

1. **The document never scrolled.** `.app` had no explicit grid row, so the auto
   row grew to the document's height and the sidebar footer was pushed off-screen.
   Fixed with `grid-template-rows: minmax(0, 1fr)`.
2. **Mobile rendered blank.** The sidebar is `position: fixed` under 860px, which
   removes it from the grid — so `.main` fell into the zero-width first column.
   Fixed by collapsing the grid to a single track.
3. **12px meta text was 3.5:1.** Below the 4.5:1 floor. `--text-3` was lifted in
   both themes.
