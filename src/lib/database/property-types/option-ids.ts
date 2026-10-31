/* Tag ids and tag colours — one scheme, in the lib.
   ---------------------------------------------------------------------------
   These lived in `option-panel.tsx` until the group editor had to be shared by *two*
   surfaces (the tag dropdown and the property menu's groups pane). A component module may
   not import the module that imports it: `group-controls.tsx` is imported by
   `option-panel.tsx`, so anything `group-controls` needs must live below both. Function
   declarations would have survived the cycle by hoisting, but a cycle that only works
   because of hoisting is a cycle nobody can reason about later.
*/
import { COLOR_LABELS, COLOR_NAMES } from "@/lib/palette";
import type { OptionLike } from "./shared";

/** The server's `tagColors`, in the order Notion lists them. `default` has no palette
    entry, so it renders as the neutral chip rather than a tenth colour. */
export const TAG_COLORS = ["default", ...COLOR_NAMES] as const;
export type TagColorName = (typeof TAG_COLORS)[number];

export const COLOR_TEXT: Record<string, string> = { default: "Default", ...COLOR_LABELS };

export function asTagColor(color: string | undefined): TagColorName {
  return color && (TAG_COLORS as readonly string[]).includes(color)
    ? (color as TagColorName)
    : "default";
}

/* A new option's id only has to be unique within one property's list; the schema is
   `z.string().min(1)`. Random rather than a name slug, because renaming a tag must not
   orphan the cells that point at it. */
export function newOptionId() {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
  return `opt-${uuid.replace(/-/g, "").slice(0, 12)}`;
}

/* A new tag gets the first palette colour the column is not already using, then cycles.
   Notion picks a colour too, and a wall of grey tags is not what anyone wants first.
   `default` is last on purpose: it is the *absence* of a colour, so it is not a slot to
   fill — otherwise the very first tag created in an empty column came out uncoloured. */
export function nextColor(existing: OptionLike[]): TagColorName {
  const used = new Set(existing.map((option) => asTagColor(option.color)));
  return (
    COLOR_NAMES.find((color) => !used.has(color)) ??
    TAG_COLORS[existing.length % TAG_COLORS.length]
  );
}
