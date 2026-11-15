import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCell, resolveProperty } from "../src/lib/database/properties";
import { shortUrl, urlConfigOf, urlHref } from "../src/lib/database/property-types/link";
import { configSchemas } from "../src/lib/database/types";

/* The owner's ask, verbatim: "by default, when a link is entered, it should hide the
   `https://www` part of the link ... there needs to be an option on the dropdown to show
   the full link ... links should also be clickable if they are on the URL property cell".

   Three claims, and only one of them is a formatter. The other two are a *config* (one
   column's presentation, stored server-side and parsed strictly, so the schema has to learn
   the key or the write is refused) and an *opener* (a control, which is where the last two
   turns' worth of lessons apply: the press that puts a caret must never navigate).

   Kept in one file because they fail together: a shortened link with no opener is a dead
   cell, and an opener on the full `https://www.…` string is the width this turn removed. */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const url = (config: Record<string, unknown> = {}) => ({ type: "url" as const, config });
const render = (value: unknown, config: Record<string, unknown> = {}) => formatCell(url(config), value as never);

test("a link reads without the two things a browser adds for you", () => {
  assert.equal(render("https://www.example.com/"), "example.com");
  assert.equal(render("https://example.com/"), "example.com");
  assert.equal(render("http://example.com/"), "example.com");
  assert.equal(render("https://www.example.com/docs"), "example.com/docs");
  /* A slash after a path is the address's own, not the root path's. */
  assert.equal(render("https://example.com/docs/"), "example.com/docs/");
  assert.equal(render("https://www.example.com/a?b=1#c"), "example.com/a?b=1#c");
  /* Something that is not a web address keeps the scheme it needs to mean anything. */
  assert.equal(render("mailto:someone@example.com"), "mailto:someone@example.com");
  /* The owner's own cell, verbatim from `data/raspberry.sqlite` — the one URL value in the live
     database. It reads `youtube.com` now and is still `https://www.youtube.com/` on disk. */
  assert.equal(render("https://www.youtube.com/"), "youtube.com");
});

test("`www.` goes only from the front, and only once", () => {
  assert.equal(shortUrl("https://www.www.example.com/"), "www.example.com");
  /* A `www.` inside a path is part of the path. */
  assert.equal(shortUrl("https://example.com/www.x.com"), "example.com/www.x.com");
  /* Case is not meaning. */
  assert.equal(shortUrl("HTTPS://WWW.Example.com/"), "Example.com");
});

test("the column can say it wants the address exactly as stored", () => {
  assert.equal(render("https://www.example.com/", { fullUrl: true }), "https://www.example.com/");
  assert.equal(urlConfigOf({ fullUrl: true }).fullUrl, true);
  /* Anything that is not `true` is short: a config written by an older build, a string,
     a null. The default has to survive being read by something that does not share this
     file's types. */
  for (const junk of [undefined, null, {}, { fullUrl: "yes" }, { fullUrl: 1 }]) {
    assert.equal(urlConfigOf(junk).fullUrl, false, `urlConfigOf(${JSON.stringify(junk)}) said full`);
  }
});

test("an empty link is empty, not a shortened nothing", () => {
  assert.equal(render(null), "");
  assert.equal(render(""), "");
  assert.equal(render("   "), "");
});

test("shortening is presentation — the stored value keeps its scheme", () => {
  /* `coerce` is the write path and the formatter must not reach into it: a filter, a sort
     comparison and the MCP surface all read the stored string, and a URL that is only
     half-stored is a URL nothing can open. */
  const coerce = resolveProperty({ type: "url" }).coerce;
  assert.equal(coerce("example.com", {}), "https://example.com/");
  assert.equal(coerce("https://www.example.com/", {}), "https://www.example.com/");
  assert.equal(coerce("mailto:a@b.co", {}), "mailto:a@b.co");
});

test("the cell's href is the address, and never something the browser would execute", () => {
  assert.equal(urlHref("https://www.example.com/"), "https://www.example.com/");
  /* A scheme that is not a link is not a link, whatever is in the cell. `normalizeUrl` is
     the server's own filter, so a value that got past `coerce` and this agree. */
  for (const hostile of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:msgbox", "hello world", ""]) {
    assert.equal(urlHref(hostile as never), null, `${hostile} produced an href`);
  }
});

test("`fullUrl` is a key the server will accept, and it is off unless asked for", () => {
  const schema = configSchemas.url;
  assert.deepEqual(schema.parse({}), { fullUrl: false }, "a new URL column must start short");
  assert.deepEqual(schema.parse({ fullUrl: true }), { fullUrl: true });
  /* `configSchemas` is `.strict()` for types with no settings; a key the schema does not
     know is a write the API refuses with a 400, which is a toggle that silently does
     nothing. This is the assertion that says the key reached the schema. */
  assert.doesNotThrow(() => schema.parse({ fullUrl: false }));
});

test("the cell field stays an editor and the opener is a real link", () => {
  const editor = read("src/components/database/cell-editor.tsx");
  const start = editor.indexOf('if (property.type === "url")');
  assert.notEqual(start, -1, "cell-editor.tsx has no url branch");
  const branch = editor.slice(start, editor.indexOf("return field;", start));

  assert.match(branch, /className="db-url-cell"/, "the url branch renders the bare field — the opener has nowhere to sit");
  assert.match(branch, /<UrlOpen\b/, "the url branch has no opener");
  assert.match(branch, /\{field\}/, "the url branch stops rendering the shared text field");

  const cell = read("src/components/database/url-cell.tsx");
  /* The field must not be an anchor: a press inside it puts a caret, and every other
     column in the table does the same on that press. */
  assert.doesNotMatch(
    cell.slice(cell.indexOf("export function UrlOpen"), cell.indexOf("export function UrlText")),
    /<input/,
    "the opener is drawn from the field — the anchor and the caret are competing for one press",
  );
  const open = cell.slice(cell.indexOf("export function UrlOpen"), cell.indexOf("export function UrlText"));
  assert.match(open, /<a\s/, "the opener is not an `<a>`, so the browser cannot show the address or open it in a new tab");
  assert.match(open, /href=\{href\}/, "the opener draws a link with no address");
  assert.match(open, /target="_blank"/, "following a link in the same tab throws away a half-written table");
  assert.match(open, /noopener/, "`target=_blank` without `noopener` hands the new page a reference back into this one");
  assert.match(open, /title=\{href\}/, "the full address is only ever readable from the mark — it needs the `title`");
});

test("the opener takes no clicks while it is invisible", () => {
  const css = read("src/app/database.css");
  const rule = (selector: string) => {
    const match = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(match, `database.css has no "${selector}" rule`);
    return match[2];
  };
  const open = rule(".db-url-open");
  assert.match(open, /opacity:\s*0/, "the mark is always visible — it would sit on the tail of every address");
  assert.match(
    open,
    /pointer-events:\s*none/,
    "an invisible mark that still takes clicks is a trap: something is pressed, and nothing is on screen",
  );
  /* Scoped to the *row*, exactly as `.db-open` is: a hover anywhere in the row reveals the
     mark of the cell being hovered, which is the same promise the row's `Open` button makes. */
  assert.match(
    css,
    /\.db-row:hover \.db-url-open/,
    "nothing reveals the mark on hover, so the link is unopenable and looks unopenable",
  );
});

test("the empty cell's hint is an example, not a prefix", () => {
  /* The hint used to be `https://`, which read as a fixed prefix in front of what you type —
     and this turn's whole point is that the scheme is not part of what the column shows. A
     placeholder that teaches the scheme is a placeholder arguing with the formatter one line
     above it. `example.com` is what the cell will read after you type it. */
  const editor = read("src/components/database/cell-editor.tsx");
  assert.doesNotMatch(
    editor,
    /property\.type === "url" \? "https:\/\//,
    'the URL placeholder is `https://` again — a prefix for a scheme the cell no longer shows',
  );
  assert.match(editor, /property\.type === "url" \? "example\.com"/, "the URL placeholder is not an example address");
});

test("the dropdown offers the setting, and offers it as the column's", () => {
  const header = read("src/components/database/property-header.tsx");
  assert.match(header, /label="Show full URL"/, "the property menu has no row for it");
  /* One call, writing the property's own config. `onConfig` on a cell writes the *cell*;
     the two are different writes and this setting is the column's. */
  assert.match(header, /onConfig\(\{ fullUrl: !url\.fullUrl \}\)/, "the row does not write `fullUrl` to the column");
  assert.match(header, /urlConfigOf\(property\.config\)/, "the row does not read the column's current setting");
});

test("both openers stay opaque with the pointer on them", () => {
  /* The report: "on hover i can see the text behind it when it overlays it".

     Both of these controls are drawn *over* the words of the cell they belong to — that is
     their job. Both were filled with `background: var(--surface)` and both had a hover state
     of `background: var(--hover-strong)`, which is `rgba(255,255,255,0.07)` or
     `rgba(24,22,20,0.07)` depending on the theme. The `background` shorthand does not lay a
     second coat over the first: it *replaces* it. So the fill became a wash, and a wash is
     transparent — the address underneath read straight through the mark at exactly the moment
     a person reached for it.

     A tint over a surface is a `background-image` layer. That is the only shape in which the
     opaque colour underneath it survives, so that is what this asserts — for both openers,
     because `.db-open` sits over the row's name for the same reason and had the same bug. */
  const css = read("src/app/database.css");
  const rule = (selector: string) => {
    const match = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(match, `database.css has no "${selector}" rule`);
    return match[2];
  };

  for (const selector of [".db-open", ".db-url-open"]) {
    const base = rule(selector);
    assert.match(
      base,
      /background-color:\s*var\(--surface\)/,
      `${selector} does not paint the surface as an opaque \`background-color\``,
    );
    assert.doesNotMatch(
      base,
      /background:\s/,
      `${selector} is filled with the \`background\` shorthand — its hover state will replace ` +
        "that fill rather than tint it, and the words it is covering will read through",
    );
  }

  for (const selector of [".db-open:hover", ".db-url-open:hover"]) {
    const hover = rule(selector);
    assert.match(
      hover,
      /background-image:\s*linear-gradient\(var\(--hover-strong\)/,
      `${selector} does not tint the mark as a layer — a plain \`background: var(--hover-strong)\` ` +
        "is a wash over nothing, and nothing is what the mark was covering",
    );
  }
});
