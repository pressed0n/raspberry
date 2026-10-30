/* Raspberry — copying a page (B25)
   ---------------------------------------------------------------------------
   Two callers now duplicate a page: the topbar menu and the sidebar `⋯`. This is
   the one implementation.

   Copying content is not `structuredClone`. Two rules:
   1. Every block needs a fresh id, or two documents share block identity.
   2. A `pageLink` block that means "this page lives under me" becomes a plain
      link in the copy. Duplicating a parent must not claim the original's
      children — they still have a real parent, and a copy that appeared to own
      them would be a lie the sidebar then contradicts.
*/

import type { Page } from "./document";

export function copyBlocks(blocks: Page["content"]): Page["content"] {
  return blocks.map((block) => ({
    ...block,
    id: crypto.randomUUID(),
    props: block.type === "pageLink" ? { ...block.props, relationship: "link" } : block.props,
    children: copyBlocks(block.children ?? []),
  })) as Page["content"];
}
