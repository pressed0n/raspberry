import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCell, resolveProperty } from "../src/lib/database/properties";
import {
  fileDownloadHref, fileExtension, fileHref, fileList, fileSizeText, isImageFile,
} from "../src/lib/database/property-types/files";

/* The owner's ask: "an upload field that holds one or more files ... make it functional and
   make a good solid and simple ux".

   The half that can be asserted without a browser is the *value*: what a cell holds, how it
   reads, and the four helpers the cell and the read-only table both draw from. The other half
   — press the cell, a surface opens, files go in and come out — is `scripts/verify-db-files.mjs`
   against a disposable instance, because a click is not a string.

   The last three tests are source guards, and they exist for the two failures this file cannot
   see: a Files column that quietly went back to being a text input (the bug this turn fixes —
   typing a *name* stored a reference to bytes nobody uploaded), and a second copy of the small
   button or of the cell-as-button box, which is how this app grew three grip glyphs. */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const files = (config: Record<string, unknown> = {}) => ({ type: "files" as const, config });
const store = (raw: unknown) => resolveProperty(files()).coerce(raw as never, {} as never);

const photo = { id: "6f1a", name: "holiday.png", mime: "image/png", size: 2048 };
const deck = { id: "9c2b", name: "pitch.pdf", mime: "application/pdf", size: 5 * 1024 * 1024 };

test("a cell holds references, and nothing else survives", () => {
  assert.deepEqual(store([photo]), [photo]);
  /* An entry with no id points at no bytes; an entry that is a number points at nothing at
     all. Both are dropped rather than stored as a file with an empty name. */
  assert.deepEqual(store([{ name: "orphan.pdf" }, 42, null]), []);
  assert.deepEqual(store(null), []);
  assert.deepEqual(store(""), []);
  /* A missing mime or size is a fact about how the reference arrived, not an error. */
  assert.deepEqual(store([{ id: "a" }]), [{ id: "a", name: "a", mime: null, size: null }]);
});

test("a bare upload id is one file whose name is the id", () => {
  /* What a paste from the file field gives. The name is the id because nothing else knows
     the name — inventing one ("file.pdf") would be a lie the panel then displays. */
  assert.deepEqual(fileList(store("6f1a")), [{ id: "6f1a", name: "6f1a", mime: null, size: null }]);
});

test("the same bytes twice is one file", () => {
  /* The store is content-addressed, so attaching the same photo twice produces the same id.
     Two identical rows in a cell is a cell that says "2 files" about one — and it is also
     what makes a double-pressed Upload idempotent instead of additive. */
  assert.equal(fileList(store([photo, photo])).length, 1);
  assert.deepEqual(fileList(store([photo, deck, photo])).map((file) => file.id), ["6f1a", "9c2b"]);
});

test("the order files were attached in is the order they keep", () => {
  assert.deepEqual(fileList(store([deck, photo])).map((file) => file.name), ["pitch.pdf", "holiday.png"]);
  assert.equal(formatCell(files(), store([deck, photo]) as never), "pitch.pdf, holiday.png");
});

test("a size reads as a size, and an unknown size says nothing", () => {
  assert.equal(fileSizeText(0), "0 B");
  assert.equal(fileSizeText(1023), "1023 B");
  assert.equal(fileSizeText(1024), "1.0 KB");
  assert.equal(fileSizeText(1536), "1.5 KB");
  assert.equal(fileSizeText(10 * 1024 * 1024), "10 MB");
  assert.equal(fileSizeText(1024 * 1024 * 1024 - 1), "1024 MB");
  /* `null` is a bare-id reference or an import. "0 B" would be a measurement nobody made. */
  assert.equal(fileSizeText(null), "");
  assert.equal(fileSizeText(-1), "");
});

test("the badge shows an extension only when it fits in the square", () => {
  assert.equal(fileExtension("invoice-2024.PDF"), "PDF");
  assert.equal(fileExtension("clip.mp4"), "MP4");
  assert.equal(fileExtension("archive.tar.gz"), "GZ");
  /* A dotfile has no extension; a word after the dot has. `.gitignore` is a name, and
     `numbers` would be four characters in a 22px square, which is why the cut is at four. */
  assert.equal(fileExtension(".gitignore"), "");
  assert.equal(fileExtension("README"), "");
  assert.equal(fileExtension("budget.numbers"), "");
  assert.equal(fileExtension("trailing."), "");
});

test("only a reference the server typed as an image gets a thumbnail", () => {
  assert.equal(isImageFile({ id: "a", name: "a.png", mime: "image/png", size: 1 }), true);
  assert.equal(isImageFile({ id: "a", name: "a.png", mime: "application/octet-stream", size: 1 }), false);
  assert.equal(isImageFile({ id: "a", name: "a.png", mime: null, size: 1 }), false);
});

test("the file URL is spelled in one place, and it is encoded", () => {
  assert.equal(fileHref("6f1a"), "/api/files/6f1a");
  /* An id arrives from a value a person or an import could have written by hand, so it is a
     path segment that has to be escaped. */
  assert.equal(fileHref("../etc"), "/api/files/..%2Fetc");
  assert.equal(fileHref("a b"), "/api/files/a%20b");

  const cell = read("src/components/database/files-cell.tsx");
  assert.doesNotMatch(cell, /\/api\/files\//, "the cell must call `fileHref`, not spell the URL");
});

test("a filter can ask about files", () => {
  const spec = resolveProperty(files());
  const value = store([photo, deck]) as never;
  const config = {} as never;
  assert.equal(spec.isEmpty(value, config), false);
  assert.equal(spec.isEmpty(store([]) as never, config), true);
  assert.equal(spec.fits("contains", value, "pitch.pdf", config), true);
  assert.equal(spec.fits("contains", value, deck.id, config), true);
  assert.equal(spec.fits("doesNotContain", value, "pitch.pdf", config), false);
  assert.equal(spec.fits("isNotEmpty", value, null, config), true);
});

test("a Files column is not a text field any more", () => {
  const editor = read("src/components/database/cell-editor.tsx");
  /* The branch must exist *before* the shared input, and it must return `FilesCell`: a text
     field here let "holiday.png" be typed, which stored a reference to bytes that were never
     uploaded. */
  const branch = editor.indexOf('property.type === "files"');
  const field = editor.indexOf("const field = (");
  assert.ok(branch > 0, "the Files branch is missing from the cell editor");
  assert.ok(branch < field, "the Files branch must come before the shared text field");
  assert.match(editor, /return <FilesCell value=\{value\} onCommit=\{onCommit\} \/>;/);
  /* And the read-only table draws the same summary, with the name as the link. */
  assert.match(read("src/components/database/table-view.tsx"), /<FilesText value=\{/);
});

test("the small button and the cell-as-button box are each declared once", () => {
  const sheet = read("src/app/database.css");
  /* `Upload` and `Retry` are the same control; a `.db-retry` beside a `.db-files-upload` is how
     two buttons that do one job become two shapes. */
  assert.doesNotMatch(sheet, /\.db-retry\b/, "the Retry button must wear `.db-mini-btn`");
  assert.match(sheet, /\.db-tag-trigger,\n\.db-date-trigger,\n\.db-files-trigger,\n\.db-formula-trigger \{/);
  /* The box is declared in the shared rule, so a trigger must not restate it — that is
     the copy this test exists to stop, and the formula cell is the fourth caller. Both
     own-rules are checked by their first declaration, which is the one in the column's
     own section of the sheet. */
  const own = [
    /\.db-files-trigger \{([^}]*)\}/.exec(sheet),
    /\.db-formula-trigger \{\n  display: block;([^}]*)\}/.exec(sheet),
  ];
  for (const trigger of own) {
    assert.ok(trigger, "a trigger has no rule of its own");
    for (const property of ["width: 100%", "border-radius", "background:", "font:", "cursor:"]) {
      assert.ok(!trigger[1].includes(property), `a trigger restates \`${property}\``);
    }
  }
  assert.match(read("src/components/database/files-cell.tsx"), /className="db-mini-btn db-files-upload"/);
});

test("removing a file removes the reference, never the bytes", () => {
  /* The store is content-addressed: the same photo can be attached to three rows, and a delete
     that swept the blob would empty the other two cells. So no `DELETE` of an upload, anywhere
     in the cell — the store has no route for it and this file must not grow one by habit. */
  const cell = read("src/components/database/files-cell.tsx");
  assert.doesNotMatch(cell, /method:\s*"(DELETE|PUT)"/);
  assert.doesNotMatch(cell, /fetch\(\s*fileHref/);
  const remove = /const remove = \(id: string\) => \{([\s\S]*?)\n  \};/.exec(cell);
  assert.ok(remove, "`remove` is gone from the cell");
  assert.match(remove[1], /onCommit\(next as CellValue\)/);
});

test("a download asks the server to save, and the cell does not spell the query", () => {
  assert.equal(fileDownloadHref("6f1a"), "/api/files/6f1a?download=1");
  assert.equal(fileDownloadHref("a b"), "/api/files/a%20b?download=1");

  const cell = read("src/components/database/files-cell.tsx");
  assert.match(cell, /href=\{fileDownloadHref\(file\.id\)\}/);
  /* The URL is spelled in `files.ts` and nowhere else — the same rule the name link follows. */
  assert.doesNotMatch(cell, /download=1/, "the cell must call `fileDownloadHref`, not spell the query");
});

test("the preview is one rule about images, and the store has the last word", () => {
  /* "only if an image file or svg" is one condition, not two lists. `image/svg+xml` starts with
     `image/`, so the SVG case needs no branch of its own — and a second list in the peek is
     exactly how the two answers drift apart later. */
  assert.equal(isImageFile({ id: "a", name: "logo.svg", mime: "image/svg+xml", size: 12 }), true);
  assert.equal(isImageFile({ id: "a", name: "pitch.pdf", mime: "application/pdf", size: 12 }), false);

  const peek = read("src/components/database/file-peek.tsx");
  assert.match(peek, /isImageFile\(file\)/, "the peek must ask `isImageFile`, not its own list");
  assert.doesNotMatch(peek, /startsWith\(["']image\//, "a mime prefix here would be a second answer to the same question");
  /* Portalled, because the panel it hangs off clips and scrolls; aria-hidden and
     pointer-events: none, because it is decoration that must not close itself when the pointer
     lands where it just appeared. */
  assert.match(peek, /createPortal\(/);
  assert.match(peek, /aria-hidden/);
  const sheet = read("src/app/database.css");
  const box = /\.db-file-peek \{([\s\S]*?)\}/.exec(sheet);
  assert.ok(box, "the peek has no rule of its own");
  assert.match(box[1], /position: fixed/);
  assert.match(box[1], /pointer-events: none/);
});
