/* Raspberry — object selection, as behaviour (B35)
   ------------------------------------------------
   Selection is BlockNote's own block selection, not a second one invented here.
   `editor.setSelection(start, end)` produces the same ProseMirror node selection
   that shift-clicking a range produces, which is why copying, pasting,
   backspace-to-delete, Escape-to-clear and arrow-to-extend all work without a
   line of code in this file: they are the primitives the editor already has.

   Everything below is the arithmetic around that decision — which blocks a verb
   applies to, how a duplicate is cloned, what may legally become what. */

import type { Block, PartialBlock } from "@blocknote/core";

/** A block from the live editor. Raspberry's schema carries its own blocks
 *  (callout, columns, column, pageLink, video), so anything narrower than `any`
 *  here would have to be widened again at every call site. */
export type AnyBlock = Block<any, any, any>;

/** The slice of the editor these helpers touch. Declared structurally so the
 *  helpers stay testable against a stub — a real `BlockNoteEditor` needs a DOM,
 *  and none of this arithmetic does. */
export type SelectionHost = {
  getBlock(id: string): AnyBlock | undefined;
  getSelection(): { blocks: AnyBlock[] } | undefined;
  insertBlocks(
    blocksToInsert: PartialBlock<any, any, any>[],
    referenceBlock: string,
    placement?: "before" | "after",
  ): AnyBlock[];
  removeBlocks(blocksToRemove: string[]): AnyBlock[];
  updateBlock(id: string, update: { type?: string; props?: Record<string, unknown> }): unknown;
};

/** Which blocks a verb applies to: Raspberry's selection when the block the menu
 *  is attached to is part of it, else the editor's own multi-block selection when
 *  it contains that block, else the block alone.
 *
 *  The middle case matters because dragging across blocks produces a real
 *  ProseMirror selection that this store knows nothing about — acting on one
 *  block while three are highlighted is the kind of near-miss that teaches a user
 *  to distrust the control. */
export function targetBlocks(editor: SelectionHost, block: AnyBlock, selectedIds: string[] = []): AnyBlock[] {
  const owned = selectedIds.map((id) => editor.getBlock(id)).filter(Boolean) as AnyBlock[];
  if (owned.length && owned.some((candidate) => candidate.id === block.id)) return owned;
  const native = editor.getSelection()?.blocks;
  if (native?.length && native.some((candidate) => candidate.id === block.id)) return native;
  return [block];
}

/** A deep copy with the ids removed, so the editor assigns fresh ones. Children
 *  are stripped too — a duplicated toggle or callout that kept its children's
 *  ids would produce two blocks claiming the same identity. */
export function withoutIds(block: AnyBlock): PartialBlock<any, any, any> {
  const { id: _id, children, ...rest } = block as AnyBlock & { id: string; children?: AnyBlock[] };
  return {
    ...(rest as PartialBlock<any, any, any>),
    ...(children?.length ? { children: children.map(withoutIds) } : {}),
  } as PartialBlock<any, any, any>;
}

/** Insert a copy of `blocks` directly after the last of them, and return it so
 *  the caller can select it. Selecting the copy rather than the original is what
 *  makes "duplicate then immediately move it" work as one gesture. */
export function duplicateBlocks(editor: SelectionHost, blocks: AnyBlock[]): AnyBlock[] {
  if (blocks.length === 0) return [];
  const anchor = blocks[blocks.length - 1];
  return editor.insertBlocks(blocks.map(withoutIds), anchor.id, "after");
}

/** Delete every block in the run. */
export function deleteBlocks(editor: SelectionHost, blocks: AnyBlock[]): void {
  if (blocks.length === 0) return;
  editor.removeBlocks(blocks.map((block) => block.id));
}

/* ------------------------------ Turn into ------------------------------ */

export type TurnInto = {
  /** Stable row id, independent of the label so a translation cannot break a test. */
  id: string;
  label: string;
  type: string;
  props?: Record<string, unknown>;
};

/** The types a text block may become. Deliberately only text-bearing types:
 *  "Turn into → Image" has no content to carry over, so offering it would mean
 *  either dropping the words or producing an empty image, and neither is a
 *  conversion. Media blocks are inserted, not converted. */
export const TURN_INTO: readonly TurnInto[] = [
  { id: "paragraph", label: "Text", type: "paragraph" },
  { id: "heading-1", label: "Heading 1", type: "heading", props: { level: 1 } },
  { id: "heading-2", label: "Heading 2", type: "heading", props: { level: 2 } },
  { id: "heading-3", label: "Heading 3", type: "heading", props: { level: 3 } },
  { id: "bullet", label: "Bulleted list", type: "bulletListItem" },
  { id: "numbered", label: "Numbered list", type: "numberedListItem" },
  { id: "check", label: "To-do list", type: "checkListItem" },
  { id: "quote", label: "Quote", type: "quote" },
  { id: "code", label: "Code", type: "codeBlock" },
];

/** Types whose block is a run of inline text, and therefore convertible. */
const TEXT_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
]);

/** A code block holds a single string, not child blocks, so converting a block
 *  that has children into one would silently orphan them. */
export function turnIntoTargets(block: AnyBlock): TurnInto[] {
  // Media and container blocks (image, video, audio, file, table, columns,
  // callout, pageLink, divider) have no text form. Returning an empty list is
  // what lets the menu say so, instead of listing nine conversions that each
  // decline once clicked.
  if (!TEXT_TYPES.has(block.type)) return [];
  const hasChildren = (block.children?.length ?? 0) > 0;
  return TURN_INTO.filter((target) => !(hasChildren && target.type === "codeBlock"));
}

/** Which row should read as current for this block, or null. */
export function currentTurnIntoId(block: AnyBlock): string | null {
  if (block.type === "heading") {
    const level = Number((block.props as { level?: number })?.level ?? 1);
    return `heading-${Math.min(3, Math.max(1, level))}`;
  }
  return TURN_INTO.find((target) => target.type === block.type)?.id ?? null;
}

/** Convert one block. Returns false rather than throwing when the conversion is
 *  not legal for that block, so the caller can leave the row disabled instead of
 *  surfacing an editor exception to the user. */
export function turnIntoBlock(editor: SelectionHost, block: AnyBlock, target: TurnInto): boolean {
  if (!TEXT_TYPES.has(block.type)) return false;
  if (target.type === "codeBlock" && (block.children?.length ?? 0) > 0) return false;
  if (currentTurnIntoId(block) === target.id) return true;
  editor.updateBlock(block.id, { type: target.type, props: { ...target.props } });
  return true;
}
