"use client";
/* Raspberry — the settings rail (B33)
   ---------------------------------------------------------------------------
   A one-row rail is a strange thing to build, and worth building anyway: the
   moment settings has a second section the shape has to exist, and retrofitting
   a menu around a finished surface is how a menu ends up with the wrong keyboard
   model. So the rail is real — the list, the roving tab stop, the arrow keys, the
   caption rule — and it happens to have one item in it today.

   Three decisions worth naming:

   · `nav` + a list of buttons with `aria-current`, not `tablist`/`tab`. These are
     destinations, not tabs of one widget, and `aria-current` is what a screen
     reader already knows how to announce. Nothing here hides or shows a panel by
     index; the dialog switches the panel itself.

   · Arrow keys move *and* select. A rail you must arrow to and then press Enter
     on is a rail with a hidden second step; System Settings moves on the arrow
     too, and no state is committed by moving here — the palette is already
     written, the section is only what you are looking at.

   · The tab stop follows the selection. Without it, Tab lands on the rail and
     then again on the row you are already in, which reads as a broken list.
*/

import { useRef, type KeyboardEvent } from "react";
import {
  groupSections,
  showsGroupCaptions,
  stepSection,
  type SettingsSection,
} from "@/lib/settings-nav";

export default function SettingsNav({ active, onSelect, sections }: {
  active: string;
  onSelect: (id: string) => void;
  /** Injected so the rail can be rendered — and tested — against a menu wider
   *  than the one that ships. */
  sections?: readonly SettingsSection[];
}) {
  const rail = useRef<HTMLElement>(null);
  const groups = groupSections(sections);
  const captions = showsGroupCaptions(groups);
  const flat = groups.flatMap((entry) => entry.sections);

  /* Every row is mounted, so focus can move in the same tick as the selection —
     no effect is needed to chase the re-render. */
  const move = (id: string) => {
    onSelect(id);
    rail.current?.querySelector<HTMLButtonElement>(`[data-section="${id}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(stepSection(active, step, flat));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const end = flat[event.key === "Home" ? 0 : flat.length - 1];
      if (end) move(end.id);
    }
  };

  return (
    <nav className="set-rail" aria-label="Settings sections" ref={rail} onKeyDown={onKeyDown}>
      {groups.map((entry) => (
        <div className="set-rail-group" key={entry.group || "sections"}>
          {captions && entry.group && <p className="set-rail-caption">{entry.group}</p>}
          <ul className="set-rail-list">
            {entry.sections.map((section) => {
              const Icon = section.icon;
              const current = section.id === active;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    data-section={section.id}
                    data-autofocus={current ? "" : undefined}
                    className={`set-rail-row${current ? " is-active" : ""}`}
                    aria-current={current ? "true" : undefined}
                    // The roving stop: one row is reachable by Tab, the rest by
                    // arrow keys.
                    tabIndex={current ? 0 : -1}
                    onClick={() => onSelect(section.id)}
                  >
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                    <span>{section.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
