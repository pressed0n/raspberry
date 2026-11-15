import { asList, asRecord, asText, collator, type PropertyTypeSpec } from "./shared";
import type { CellValue } from "../types";

/**
 * Files & Media — a list of **references**, never bytes.
 *
 * The upload store is already content-addressed by sha256 (`data/uploads`), so a
 * cell holds `{ id, name, mime, size }` and the same photo in three cells is one
 * file on disk. Putting a data URL in a cell would make every row read, every
 * export and every backup carry the media twice.
 *
 * The four helpers below are here rather than in the cell's component for the same
 * reason `place.ts` holds `placeAddress`: the *reading* of a file reference is a fact
 * about the value, and a map view, an export or a future gallery will need to read one
 * without importing a React component. `fileHref` in particular is the only place that
 * spells `/api/files/…`, so a URL cannot drift between the cell, the read-only table and
 * whatever reads this next.
 */

export type FileRef = { id: string; name: string; mime: string | null; size: number | null };

const filesOf = (value: CellValue): FileRef[] =>
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
    .filter((file): file is FileRef => file !== null);

/** The files a cell holds, in the order they were attached. The one way to read the value. */
export function fileList(value: CellValue): FileRef[] {
  return filesOf(value);
}

/** Where the bytes are served from. Encoded, because an id arrives from a value a person
 *  (or an import) could have written by hand. */
export function fileHref(id: string): string {
  return `/api/files/${encodeURIComponent(id)}`;
}

/**
 * The same bytes, as a download the browser saves rather than displays.
 *
 * The store serves images, audio, video and PDF `inline`, which is right for the name link and
 * wrong for a save: a picture would open in a tab and a PDF would open in a viewer, and the
 * person asked to keep the file. The server is what decides — the `download` attribute on an
 * `<a>` is a hint the browser may ignore, and it cannot name the file as reliably as the
 * `Content-Disposition` the store already builds from the stored name. So the query is the
 * request, and this is the only place that spells it.
 */
export function fileDownloadHref(id: string): string {
  return `${fileHref(id)}?download=1`;
}

/** Whether a thumbnail can be drawn. The mime is the server's, derived from the extension at
 *  upload time — a reference that arrived as a bare id has none, and guessing "it is probably
 *  an image" from a uuid is not a guess anyone can make. */
export function isImageFile(file: FileRef): boolean {
  return (file.mime ?? "").startsWith("image/");
}

/** `PDF`, `MP4` — the badge on a tile for a file with no picture. Short enough for a 22px
 *  square at 9px type, which is why anything longer than four characters gives way to the
 *  generic glyph: `DOCX` fits and `numbers` does not. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const extension = name.slice(dot + 1);
  return extension.length <= 4 ? extension.toUpperCase() : "";
}

/** `1.2 MB`. `null` (a bare-id reference, or an import) is the empty string rather than
 *  "0 B", which would be a claim about a file nobody measured. */
export function fileSizeText(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  /* One decimal below ten, none above: "1.2 MB" is useful and "12.3 MB" is noise beside a
   * name in a 236px panel. */
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

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
    /* Deduplicated by id, first one kept. The store is content-addressed, so attaching the
       same photo twice produces the same id — and two identical rows in one cell is a cell
       that says "two files" about one. It also makes a double-pressed `Upload` idempotent. */
    const seen = new Set<string>();
    const unique = filesOf(files as CellValue).filter((file) => {
      if (seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    });
    return unique as CellValue;
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
