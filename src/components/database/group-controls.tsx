"use client";
/* One implementation of "edit a group", rendered by two surfaces.
   ---------------------------------------------------------------------------
   The owner asked for group management, was told it existed, and could not find it:

       "You said there's a + on the group ... there isnt. Clicking on a group name
        expands it ... it doesnt. There is no way to add a group. There is no way
        to remove a group."

   Every word of that was true *of the tag dropdown*. The controls existed only in the
   property menu's Status-groups pane, and the summary described the pane in the words of
   the dropdown. Two places that look alike and behave differently is the actual bug, so
   the group row, its expanded panel and the New-group block live here once and both
   surfaces render *this*. `variant` changes the heading's size in a section list; nothing
   else. If a control is added to a group, it is added in one place.

   Nothing here is allowed to write on open: `groupsOf` is what is *drawn* (the three
   defaults for a column that has never been edited), `storedGroups` is what a *write*
   carries. Keeping them apart is why opening either surface writes nothing.
*/
import { useCallback, useMemo, useState } from "react";
import { Trash } from "lucide-react";
import { AddGlyph } from "@/components/grip-glyphs";
import {
  groupsOf,
  newGroupId,
  optionsInGroup,
  storedGroups,
  type StatusGroupLike,
} from "@/lib/database/property-types/groups";
import { optionsOf, type OptionLike } from "@/lib/database/property-types/shared";
import { newOptionId, nextColor } from "@/lib/database/property-types/option-ids";
import { MenuItem } from "./menu";

type Config = Record<string, unknown>;

export type GroupWriter = (patch: Config) => Promise<unknown> | void;

export function useGroupEditor({
  config,
  onConfig,
  onCreated,
}: {
  config: Config;
  onConfig?: GroupWriter;
  onCreated?: (option: OptionLike) => void;
}) {
  const groups = useMemo(() => groupsOf(config), [config]);
  const options = useMemo(() => optionsOf(config), [config]);

  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChecked, setNewChecked] = useState(false);

  const write = useCallback(
    (nextGroups: StatusGroupLike[], nextOptions: OptionLike[]) =>
      onConfig?.({ groups: nextGroups, options: nextOptions }),
    [onConfig],
  );

  /* A write always carries the groups that are drawn, so a column still on the defaults
     becomes real data on its first edit — and never carries an empty array, which would
     read back as "the defaults" and silently undo the edit. */
  const base = useCallback(() => (storedGroups(config).length ? storedGroups(config) : groups), [config, groups]);

  const collapse = useCallback(() => {
    setOpen(null);
    setRenaming(null);
    setAdding(null);
    setConfirmDelete(null);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setOpen((current) => (current === id ? null : id));
      setRenaming(null);
      setAdding(null);
      setConfirmDelete(null);
    },
    [],
  );

  const setGroup = useCallback(
    (id: string, patch: Partial<StatusGroupLike>) => {
      const nextGroups = base().map((group) => (group.id === id ? { ...group, ...patch } : group));
      write(nextGroups, options);
    },
    [base, options, write],
  );

  const startAdd = useCallback((id: string) => {
    setOpen(id);
    setAdding(id);
    setTagDraft("");
    setRenaming(null);
    setConfirmDelete(null);
  }, []);

  const commitAdd = useCallback(
    async (group: StatusGroupLike) => {
      const name = tagDraft.trim();
      if (!name) return;
      const option: OptionLike = { id: newOptionId(), name, color: nextColor(options), groupId: group.id };
      /* The config write must land *before* the cell write. The server coerces a cell value
         against the property's options, so a cell pointing at an id the config does not have
         yet is silently emptied — and a cell dropdown's `+` does both writes. At 390px the
         two requests happened to arrive in order; at 1400px they did not, and the tag was
         created while the cell came back empty. `onConfig` is the promise that settles it. */
      await write(base(), [...options, option]);
      setAdding(null);
      setTagDraft("");
      /* The dropdown selects what it just made; the pane only adds it. Same action, and
         the difference belongs to the caller, not to a second implementation. */
      onCreated?.(option);
    },
    [base, onCreated, options, tagDraft, write],
  );

  const confirmRemove = useCallback(
    (group: StatusGroupLike) => {
      const nextGroups = base().filter((entry) => entry.id !== group.id);
      const nextOptions = options.filter((option) => option.groupId !== group.id);
      if (!nextGroups.length) return;
      write(nextGroups, nextOptions);
      collapse();
    },
    [base, collapse, options, write],
  );

  const submitCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const nextGroups = [...base(), { id: newGroupId(base()), name, color: "default", checked: newChecked }];
    write(nextGroups, options);
    setCreating(false);
    setNewName("");
    setNewChecked(false);
  }, [base, newChecked, newName, options, write]);

  const count = useCallback((group: StatusGroupLike) => optionsInGroup(group, config).length, [config]);

  const startRename = useCallback((group: StatusGroupLike) => {
    setRenaming(group.id);
    setNameDraft(group.name);
  }, []);

  return {
    config,
    groups,
    options,
    count,
    open,
    toggle,
    collapse,
    renaming,
    nameDraft,
    setNameDraft,
    startRename,
    adding,
    tagDraft,
    setTagDraft,
    startAdd,
    commitAdd,
    confirmDelete,
    setConfirmDelete,
    confirmRemove,
    creating,
    newName,
    setNewName,
    newChecked,
    setNewChecked,
    submitCreate,
    setCreating,
    setAdding,
    setRenaming,
    setGroup,
  };
}

export type GroupEditor = ReturnType<typeof useGroupEditor>;

/* The row itself: name, count, `+`, and the panel it expands into. */
export function GroupRow({
  editor,
  group,
  variant = "pane",
  showCount = true,
}: {
  editor: GroupEditor;
  group: StatusGroupLike;
  variant?: "pane" | "option";
  showCount?: boolean;
}) {
  const expanded = editor.open === group.id;
  const lastOne = editor.groups.length === 1;
  const inSection = variant === "option";

  return (
    <div
      className={`db-group-row${inSection ? " db-option-group-row" : ""}${expanded ? " is-open" : ""}`}
      data-group-row={group.id}
      {...(inSection ? { "data-group-heading": group.id } : {})}
    >
      <button
        type="button"
        className="db-group-name"
        aria-expanded={expanded}
        onClick={() => editor.toggle(group.id)}
      >
        {group.name}
      </button>

      {showCount ? (
        <span className="db-group-count" aria-hidden>
          {editor.count(group)}
        </span>
      ) : null}

      <button
        type="button"
        className="db-group-add"
        aria-label={`Add a tag to ${group.name}`}
        title="Add a tag to this group"
        onClick={() => editor.startAdd(group.id)}
      >
        <AddGlyph />
      </button>

      {expanded ? <GroupPanel editor={editor} group={group} lastOne={lastOne} /> : null}
    </div>
  );
}

function GroupPanel({
  editor,
  group,
  lastOne,
}: {
  editor: GroupEditor;
  group: StatusGroupLike;
  lastOne: boolean;
}) {
  return (
    <div className="db-group-panel">
      {editor.renaming === group.id ? (
        <input
          className="db-prop-name"
          autoFocus
          value={editor.nameDraft}
          aria-label="Group name"
          /* Selecting on focus is what makes a rename a rename: the field opens holding the
             old name, and typing must replace it, not append to it. */
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => editor.setNameDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              editor.setGroup(group.id, { name: group.name === editor.nameDraft ? group.name : editor.nameDraft.trim() });
              editor.setRenaming(null);
            }
            if (event.key === "Escape") editor.setRenaming(null);
          }}
        />
      ) : (
        <MenuItem label="Rename" onSelect={() => editor.startRename(group)} />
      )}

      <MenuItem
        label="Displays as checked"
        hint="The table draws a checked box before this group's tags"
        check={group.checked}
        onSelect={() => editor.setGroup(group.id, { checked: !group.checked })}
      />

      {editor.adding === group.id ? (
        <input
          className="db-prop-name"
          autoFocus
          value={editor.tagDraft}
          placeholder="Tag name"
          aria-label={`New tag in ${group.name}`}
          onChange={(event) => editor.setTagDraft(event.target.value)}
          /* Leaving the field with a name in it creates the tag: the same rule the dropdown's
             create row follows, so a half-typed tag is not silently thrown away. */
          onBlur={() => {
            if (editor.tagDraft.trim() !== "") void editor.commitAdd(group);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              void editor.commitAdd(group);
            }
            if (event.key === "Escape") {
              editor.setAdding(null);
              editor.setTagDraft("");
            }
          }}
        />
      ) : (
        <MenuItem icon={<AddGlyph />} label="Add a tag" onSelect={() => editor.startAdd(group.id)} />
      )}

      {editor.confirmDelete === group.id ? (
        <MenuItem
          danger
          icon={<Trash size={14} aria-hidden />}
          label={`Delete ${group.name} and its ${editor.count(group)} ${
            editor.count(group) === 1 ? "tag" : "tags"
          }`}
          onSelect={() => editor.confirmRemove(group)}
        />
      ) : (
        <MenuItem
          danger
          icon={<Trash size={14} aria-hidden />}
          label="Delete group"
          disabled={lastOne}
          hint={lastOne ? "A status column needs at least one group" : undefined}
          onSelect={() => editor.setConfirmDelete(group.id)}
        />
      )}
    </div>
  );
}

/* "New group" — the name field and the checked flag at creation, as the owner asked. */
export function NewGroupBlock({ editor }: { editor: GroupEditor }) {
  return editor.creating ? (
    <div className="db-group-panel">
      <input
        className="db-prop-name"
        autoFocus
        value={editor.newName}
        placeholder="Group name"
        aria-label="New group name"
        onChange={(event) => editor.setNewName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            editor.submitCreate();
          }
          if (event.key === "Escape") {
            editor.setCreating(false);
            editor.setNewName("");
            editor.setNewChecked(false);
          }
        }}
      />
      {/* "When creating a group a user also sets whether that group displays as checked."
          A menu row with a tick, not a checkbox glyph: the owner asked for the box itself
          to appear only in the table. */}
      <MenuItem
        label="Displays as checked"
        hint="The table draws a checked box before this group's tags"
        check={editor.newChecked}
        onSelect={() => editor.setNewChecked(!editor.newChecked)}
      />
      <button
        type="button"
        className="db-group-confirm"
        disabled={editor.newName.trim() === ""}
        onClick={() => editor.submitCreate()}
      >
        Create group
      </button>
    </div>
  ) : (
    <MenuItem icon={<AddGlyph />} label="New group" onSelect={() => editor.setCreating(true)} />
  );
}

