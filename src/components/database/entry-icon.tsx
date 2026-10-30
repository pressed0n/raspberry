"use client";
/* An entry's icon, sitting inline before its name.
   ---------------------------------------------------------------------------
   An entry is a page, so its icon is `pages.icon` — the same column the sidebar and tab
   strip read. Adding a second "row icon" would have meant two sources for one glyph and a
   row whose sidebar entry disagreed with the table.

   Rows start on the default page icon, so most rows show a document. That is deliberate
   and matches the sidebar: the icon is always there, so it is always the thing you click.
   `none` is a real choice — it renders nothing, with a quiet placeholder that only appears
   on hover so an empty column does not look like a row of ghosts.
   --------------------------------------------------------------------------- */
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { IconPicker } from "./icon-picker";
import { NO_ICON, PropertyIcon } from "./property-icons";

export function EntryIcon({
  icon,
  label,
  onChange,
}: {
  icon: string;
  /** The entry's title, for the button's accessible name. */
  label: string;
  onChange?: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const empty = !icon || icon === NO_ICON;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={empty ? "db-entry-icon is-empty" : "db-entry-icon"}
        title={empty ? "Add an icon" : "Change icon"}
        aria-label={empty ? `Add an icon to ${label || "this entry"}` : `Change the icon of ${label || "this entry"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!onChange}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((was) => !was);
        }}
        /* The row's double-click opens the entry; reaching for its icon must not. */
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {empty ? <Plus size={13} aria-hidden /> : <PropertyIcon name={icon} size={14} />}
      </button>
      <IconPicker
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        value={empty ? undefined : icon}
        onPick={(name) => onChange?.(name)}
        onRemove={() => onChange?.(NO_ICON)}
        removeLabel="Remove"
      />
    </>
  );
}
