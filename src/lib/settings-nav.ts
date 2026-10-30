/* Raspberry — the settings menu, as data (B33)
   ---------------------------------------------------------------------------
   One section today: Appearance. The menu lives here rather than inline in the
   dialog because a settings menu grows in a shape that JSX does not: sections
   get *added*, and every addition needs the same four things — an id the dialog
   can switch on, a label, an icon, and a sentence that says what the section is
   for. Adding one is an object in this array; the rail, the keyboard roving and
   the panel heading all read from it and need no edit.

   `group` does nothing at one section and is load-bearing at two: a rail with a
   single entry under a "Editor" caption is a caption for nothing, so the caption
   only appears once there is more than one group to separate. That decision is
   `showsGroupCaptions`, which is why it is a function with an argument rather
   than a constant — it can be tested against a menu wider than this one.

   Deliberately absent: routes. Settings is a modal (B31), so a section id never
   reaches a URL, nothing links to one, and one can be renamed without leaving a
   dead bookmark behind. If settings ever becomes its own page, this array is
   already the router's source of truth.
*/

import { Palette, type LucideIcon } from "lucide-react";

export type SettingsSection = {
  /** Stable id. The dialog switches on it. */
  id: string;
  /** The rail row, and the h3 above the controls. */
  label: string;
  icon: LucideIcon;
  /** Rail caption. Sections sharing one are listed together beneath it. */
  group: string;
  /** One sentence under the heading — the only explainer the surface carries. */
  lede: string;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    group: "Editor",
    // The non-breaking space keeps "own." off a line by itself when the column is
    // narrow enough to wrap — an orphan is the one thing a one-line hint cannot
    // afford, since it turns one line back into two.
    lede: "Every colour the editor paints with — each theme keeps its\u00A0own.",
  },
];

export const DEFAULT_SECTION_ID = SETTINGS_SECTIONS[0].id;

export const findSection = (id: string): SettingsSection | undefined =>
  SETTINGS_SECTIONS.find((section) => section.id === id);

/** Narrow an id that came from somewhere less trustworthy than a click. A menu
 *  that grows also hands back ids that no longer exist; the dialog should land
 *  on the default section rather than on a blank panel. */
export const isSectionId = (id: string): boolean => findSection(id) !== undefined;

/** Arrow-key movement in the rail, cyclic. The rail is short and one-dimensional,
 *  so wrapping costs nothing and saves a special case at each end. `sections` is
 *  a parameter so the walk can be tested against a menu wider than this one. */
export function stepSection(
  id: string,
  delta: number,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): string {
  const length = sections.length;
  if (length === 0) return id;
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) return sections[0].id;
  // `+ length` before the modulo keeps a negative delta positive, and the extra
  // `% length` absorbs a delta larger than the menu.
  const next = (((index + delta) % length) + length) % length;
  return sections[next].id;
}

export type SettingsGroup = { group: string; sections: SettingsSection[] };

/** Consecutive sections sharing a `group` become one caption block. Order is the
 *  declared order — a settings rail that re-sorts itself is a rail where you
 *  cannot learn where anything is. */
export function groupSections(
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.group === section.group) last.sections.push(section);
    else groups.push({ group: section.group, sections: [section] });
  }
  return groups;
}

/** A caption earns its line only when it separates something. */
export const showsGroupCaptions = (groups: readonly SettingsGroup[]): boolean =>
  groups.length > 1 && groups.some((entry) => entry.group !== "");
