import { asList, asRecord, asText, collator, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Files & Media — a list of **references**, never bytes.
 *
 * The upload store is already content-addressed by sha256 (`data/uploads`), so a
 * cell holds `{ id, name, mime, size }` and the same photo in three cells is one
 * file on disk. Putting a data URL in a cell would make every row read, every
 * export and every backup carry the media twice.
 */

interface FileLike { [key: string]: CellValue; id: string; name: string; mime: string | null; size: number | null }

const filesOf = (value: CellValue): FileLike[] =>
  asList(value)
    .map((item) => asRecord(item))
    .map((record) => {
      if (!record) return null;
      const id = typeof record.id === "string" ? record.id : "";
      if (id === "") return null;
      return {
        id,
        name: typeof record.name === "string" ? record.name : id,
        mime: typeof record.mime === "string" ? record.mime : null,
        size: typeof record.size === "number" ? record.size : null,
      };
    })
    .filter((file): file is FileLike => file !== null);

export const filesProperty: PropertyTypeSpec = {
  type: "files",
  label: "Files & Media",
  empty: () => [],
  coerce: (raw) => {
    /* A bare string is an upload id, which is what a paste from the file field gives. */
    const candidates = Array.isArray(raw) ? raw : (asText(raw as CellValue).trim() === "" ? [] : [raw]);
    const files = candidates
      .map((candidate) => {
        const text = asText(candidate as CellValue).trim();
        return typeof candidate === "string" ? { id: text, name: text, mime: null, size: null } : candidate;
      });
    return filesOf(files as CellValue) as CellValue;
  },
  isEmpty: (value) => filesOf(value).length === 0,
  compare: (a, b) => collator.compare(filesOf(a)[0]?.name ?? "", filesOf(b)[0]?.name ?? ""),
  format: (value) => filesOf(value).map((file) => file.name).join(", "),
  fits: (operator, value, operand) => {
    const files = filesOf(value);
    const probe = asText(operand as CellValue).trim();
    const hit = probe !== "" && files.some((file) => file.id === probe || collator.compare(file.name, probe) === 0);
    switch (operator) {
      case "isEmpty": return files.length === 0;
      case "isNotEmpty": return files.length > 0;
      case "contains": return hit;
      case "doesNotContain": return !hit;
      default: return false;
    }
  },
  aggregates: ["count", "unique"],
};
