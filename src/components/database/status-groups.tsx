"use client";
/* The property menu's half of group editing.
   ---------------------------------------------------------------------------
   Notion fixes To do / In progress / Complete. The owner's ask is the opposite of fixing
   them: *"I want to add those capabilities to rename, add or remove them."*

   This file used to *be* that editor. It is now only the shell — a back arrow, a title and
   the list — because the same rows are also drawn inside the tag dropdown, and the owner
   looked for them there and found a bare heading:

       "You said there's a + on the group ... there isnt."

   The row, its expanded panel and the New-group block live in `group-controls.tsx` and are
   rendered by both. Nothing here writes on open: `groupsOf` is what is drawn, `storedGroups`
   is what a write carries, so a column still on the defaults stays on the defaults until the
   owner edits something.
*/
import { ArrowLeft } from "lucide-react";
import type { PropertyDef } from "@/lib/database/types";
import { MenuDivider } from "./menu";
import { GroupRow, NewGroupBlock, useGroupEditor } from "./group-controls";

export function StatusGroupsPane({
  property,
  onConfig,
  onBack,
  onCreated,
}: {
  property: PropertyDef;
  onConfig?: (patch: Record<string, unknown>) => Promise<unknown> | void;
  onBack: () => void;
  onCreated?: (option: { id: string; name: string; color?: string; groupId?: string | null }) => void;
}) {
  const editor = useGroupEditor({ config: property.config, onConfig, onCreated });

  return (
    <div className="db-groups-pane">
      <div className="db-groups-head">
        <button type="button" className="db-prop-icon-btn db-menu-back" aria-label="Back to property" title="Back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden />
        </button>
        <span className="db-groups-title">Status groups</span>
      </div>

      <MenuDivider />

      {/* No heading over this list. It used to read "Groups, top to bottom", which told the
          owner the one thing the shape already says — a list is top to bottom — and implied
          an ordering they cannot change, since group rows have no grip. A label that
          restates the layout is furniture; the space is now real spacing instead. */}
      <div className="db-groups-list">
        {editor.groups.map((group) => (
          <GroupRow key={group.id} editor={editor} group={group} />
        ))}
      </div>

      <MenuDivider />

      <NewGroupBlock editor={editor} />
    </div>
  );
}
