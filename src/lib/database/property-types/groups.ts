import type { CellValue } from "../types";
import { asList, asText, optionsOf, type OptionLike } from "./shared";

/**
 * Status groups — the rungs a Status column is arranged in.
 * ---------------------------------------------------------------------------
 * Notion locks To do / In progress / Complete. The owner's ask is explicitly the
 * opposite: *"Notion has those groups fixed, you cant change them or add more, but I
 * want to add those capabilities to rename, add or remove them."* So the groups are
 * ordinary data in `config.groups`, and nothing here assumes which three exist.
 *
 * What still has to hold is the one promise a status cell reads through — **every tag
 * belongs to exactly one group** — so the stored array is *materialised* rather than
 * trusted:
 *
 *   - an empty `groups` means the three defaults (a column created before groups could
 *     be edited must still render as three sections);
 *   - an option whose `groupId` names nothing (null, or an id deleted earlier) lands in
 *     the first group.
 *
 * Both are reads, not writes. Opening the panel on a column that has never been edited
 * must not touch the owner's data; the first *edit* is what stores the ids it used, and
 * the defaults' ids are stable constants (`grp-todo`, …) precisely so that a tag created
 * into "To do" before any group has been saved still resolves after that save.
 */

export interface StatusGroupLike {
  id: string;
  name: string;
  color?: string;
  /**
   * A label, not a behaviour: the table draws a checked box before the chip when the
   * tag's group says so, and an empty box when it does not. Nothing is moved, nothing
   * is filtered — the owner asked for the glyph only.
   */
  checked: boolean;
}

type Config = Record<string, unknown> | undefined;

/* The ids are constants, not random: see the note above about resolving a tag created
   before the first group write. */
export const DEFAULT_STATUS_GROUPS: readonly StatusGroupLike[] = [
  { id: "grp-todo", name: "To do", color: "gray", checked: false },
  { id: "grp-in-progress", name: "In progress", color: "blue", checked: false },
  { id: "grp-complete", name: "Complete", color: "green", checked: true },
];

/** A fresh copy — callers write these into a config, and a shared array would alias. */
export function defaultStatusGroups(): StatusGroupLike[] {
  return DEFAULT_STATUS_GROUPS.map((group) => ({ ...group }));
}

/** Groups as *stored*: the empty array a never-edited column has, and nothing added. */
export function storedGroups(config: Config): StatusGroupLike[] {
  const list = config?.groups;
  if (!Array.isArray(list)) return [];
  return list
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string")
    .map((item) => ({
      id: item.id as string,
      name: typeof item.name === "string" ? item.name : "",
      color: typeof item.color === "string" ? item.color : "default",
      /* Old rows predate the flag; absent must read as "unchecked", not as a crash. */
      checked: item.checked === true,
    }));
}

/** Groups as *read*: stored ones, or the three defaults when nothing is stored yet. */
export function groupsOf(config: Config): StatusGroupLike[] {
  const stored = storedGroups(config);
  return stored.length > 0 ? stored : defaultStatusGroups();
}

/** Whether the column has ever had its groups written. */
export function hasStoredGroups(config: Config): boolean {
  return storedGroups(config).length > 0;
}

/** The group an option is drawn under. A dangling id is not an error — it is the first. */
export function groupIdOf(option: OptionLike | null, groups: StatusGroupLike[]): string | null {
  const first = groups[0]?.id ?? null;
  if (first === null) return null;
  const own = option?.groupId ?? null;
  if (own === null) return first;
  return groups.some((group) => group.id === own) ? own : first;
}

/** The group an option is drawn under, resolved all the way to the group. */
export function groupOfOption(option: OptionLike | null, config: Config): StatusGroupLike | null {
  const groups = groupsOf(config);
  const id = groupIdOf(option, groups);
  return groups.find((group) => group.id === id) ?? null;
}

/**
 * Whether the table draws a checked box before this value's chip.
 *
 * The lookup goes through the property's own config on purpose: the flag belongs to the
 * *group*, so moving a tag between groups changes what its cells draw, and no cell had to
 * be rewritten for that to happen.
 */
export function valueIsChecked(value: CellValue, config: Config): boolean {
  const id = asText(value);
  if (id === "") return false;
  const option = optionsOf(config).find((candidate) => candidate.id === id) ?? null;
  return groupOfOption(option, config)?.checked === true;
}

/**
 * The tags a group holds, in the order the property lists them.
 *
 * Read through `groupIdOf`, so "the first group" includes the tags whose `groupId` is
 * still null — which is every tag on every status column that existed before groups could
 * be edited.
 */
export function optionsInGroup(group: StatusGroupLike, config: Config): OptionLike[] {
  const groups = groupsOf(config);
  return optionsOf(config).filter((option) => groupIdOf(option, groups) === group.id);
}

/**
 * A cell value with every option id that no longer exists removed.
 *
 * Deleting a tag (or a whole group of them) is a config write; the cells that stored those
 * ids are left pointing at nothing. They are pruned here, on the server, in the same
 * transaction as the config write — a deleted tag that keeps rendering in a cell is a row
 * that no longer says anything true.
 *
 * The shape follows the value: a one-of type stored a string and gets `null` when nothing
 * survives; a Multi-select stored an array and gets `[]`.
 */
export function pruneOptionValue(value: CellValue, surviving: Set<string>): CellValue {
  if (Array.isArray(value)) {
    const kept = asList(value).map((item) => asText(item)).filter((id) => id !== "" && surviving.has(id));
    return kept.length === asList(value).length ? value : kept;
  }
  const id = asText(value);
  if (id === "" || surviving.has(id)) return value;
  return null;
}

/** A group id that is not already taken. Mirrors `newOptionId` in the panel. */
export function newGroupId(existing: StatusGroupLike[]): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = `grp-${Math.random().toString(36).slice(2, 10)}`;
    if (!existing.some((group) => group.id === id)) return id;
  }
  return `grp-${Date.now().toString(36)}`;
}
