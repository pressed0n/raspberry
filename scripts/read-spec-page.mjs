// Read one page's content as plain text, including checkbox state.
//
//   node scripts/read-spec-page.mjs <page-id> [--json]
//
// READ-ONLY. Opens the database with `readOnly: true`, so it cannot write even by
// accident. The owner writes specs as pages inside Raspberry itself, with checklists and
// embedded screenshots; this is how an agent reads that spec without a browser, and
// without the page's content arriving as a wall of escaped JSON.
//
// Output is one `n|state|text` line per block, indented by nesting depth:
//
//   3|[x]|  Nested to-do item
//   4| • |  A bullet
//
// `--json` prints the raw block tree instead, for when the props matter (an embedded
// image's `/api/files/<id>` URL lives in a block's props, not its text).

import { DatabaseSync } from "node:sqlite";

const id = process.argv[2];
const asJson = process.argv.includes("--json");

if (!id) {
  console.error("usage: node scripts/read-spec-page.mjs <page-id> [--json]");
  process.exit(2);
}

const db = new DatabaseSync("data/raspberry.sqlite", { readOnly: true });

const page = db
  .prepare("SELECT id, title, icon, parent_id, updated_at, content FROM pages WHERE id = ?")
  .get(id);

if (!page) {
  console.error(`no page with id ${id}`);
  process.exit(1);
}

const blocks = JSON.parse(page.content || "[]");

if (asJson) {
  console.log(JSON.stringify(blocks, null, 1));
  process.exit(0);
}

console.log("TITLE:", page.title);
console.log("ICON:", page.icon);
console.log("PARENT:", page.parent_id ?? "(top level)");
console.log("EDITED:", page.updated_at);
console.log("---");

/** Concatenate a block's inline content. A block's text is an array of inline nodes, not
 *  a string: plain text and links are both objects, and an unstyled run has no `type`. */
function textOf(block) {
  if (!Array.isArray(block.content)) return "";
  return block.content
    .map((node) => {
      if (typeof node === "string") return node;
      if (node.type === "link") return (node.content ?? []).map((inner) => inner.text ?? "").join("");
      return node.text ?? "";
    })
    .join("");
}

const MARK = {
  checkListItem: (b) => (b.props?.checked === true ? "[x]|" : "[ ]|"),
  bulletListItem: () => " • |",
  numberedListItem: () => " 1 |",
};

let n = 0;

function walk(list, depth) {
  for (const block of list) {
    const pad = "  ".repeat(depth);
    const mark = MARK[block.type]?.(block) ?? "   |";
    const body =
      block.type === "database"
        ? `<<database block ${JSON.stringify(block.props)}>>`
        : block.type === "image"
          ? `<<image ${block.props?.url ?? "?"}>>`
          : textOf(block);
    console.log(`${n}|${mark}${pad}${body}`);
    n++;
    if (Array.isArray(block.children) && block.children.length) walk(block.children, depth + 1);
  }
}

walk(blocks, 0);
