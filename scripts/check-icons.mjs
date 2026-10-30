// Every icon name the icon set references must exist in the installed lucide-react.
// Usage: node scripts/check-icons.mjs
//
// A missing export is an `undefined` component: nothing fails at build time, and React
// only complains when it tries to render it — i.e. in the one picker nobody opened yet.
// This is a 20-line guard against that, run by hand or before a commit.
import * as lucide from "lucide-react";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/database/property-icons.tsx", "utf8");

const imports = source
  .slice(source.indexOf("import {"), source.indexOf('} from "lucide-react"'))
  .replace("import {", "")
  .split(/[,\n]/)
  .map((name) => name.trim())
  .filter((name) => name && !name.startsWith("type "));

const missingImports = imports.filter((name) => !(name in lucide));

/* Only the map body, not the whole file: `Record<string, LucideIcon>` in the type
   annotation looks exactly like `key: Component` to a loose pattern. */
const mapStart = source.indexOf("export const PROPERTY_ICONS");
const mapBody = source.slice(source.indexOf("{", mapStart), source.indexOf("/** No icon chosen"));
const entries = [...mapBody.matchAll(/(?:^|[\s,{])(?:"([\w-]+)"|([\w-]+)):\s*([A-Z][A-Za-z0-9]*)/gm)].map((match) => [match[1] ?? match[2], match[3]]);
const unknownComponents = [...new Set(entries.map(([, component]) => component).filter((name) => !(name in lucide)))];

const bad = [...new Set([...missingImports, ...unknownComponents])];
/* Coverage is printed, not just the verdict: "0 unknown" from a regex that matched nothing
   is the same output as success, and this guard exists to be trusted. */
console.log(`checked ${imports.length} imports and ${entries.length} map entries — ${bad.length} unknown`);
if (!entries.length) {
  console.log("the map was not parsed at all — this check is not doing anything");
  process.exit(2);
}
if (bad.length) {
  console.log(bad.join("\n"));
  process.exit(1);
}
console.log("ok");
