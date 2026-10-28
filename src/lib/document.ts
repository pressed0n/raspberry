import { z } from "zod";

export const iconSchema = z.enum(["file", "sparkles", "notebook", "lightbulb", "compass", "leaf"]);
export type PageIcon = z.infer<typeof iconSchema>;
export const calloutColors = ["gray", "yellow", "blue", "green", "pink", "purple"] as const;
const blockBackgroundColors = z.enum(["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const alignment = z.enum(["left", "center", "right", "justify"]);
const color = z.string().max(40);
const safeLink = z.string().max(2048).refine((value) => {
  try { return ["https:", "http:", "mailto:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an https, http, or mailto link.");
const styles = z.object({ bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(), code: z.boolean().optional(), textColor: color.optional(), backgroundColor: color.optional() }).strict();
const textSchema = z.object({ type: z.literal("text"), text: z.string().max(100_000), styles }).strict();
const inlineSchema = z.union([textSchema, z.object({ type: z.literal("link"), href: safeLink, content: z.array(textSchema).max(1000) }).strict()]);
const inlineArray = z.array(inlineSchema).max(5000);
export type Inline = z.infer<typeof inlineSchema>;
const tableCell = z.object({ type: z.literal("tableCell"), props: z.object({ backgroundColor: color, textColor: color, textAlignment: alignment, colspan: z.number().int().min(1).max(30).optional(), rowspan: z.number().int().min(1).max(100).optional() }).strict(), content: inlineArray }).strict();
const tableContentSchema = z.object({
  type: z.literal("tableContent"), columnWidths: z.array(z.number().min(20).max(5000).nullish()).min(1).max(30),
  headerRows: z.number().int().min(0).max(100).optional(), headerCols: z.number().int().min(0).max(30).optional(),
  rows: z.array(z.object({ cells: z.array(z.union([inlineArray, tableCell])).min(1).max(30) }).strict()).min(1).max(100),
}).strict();
export type TableContent = z.infer<typeof tableContentSchema>;
export type DocumentBlock = {
  id: string;
  type: "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "checkListItem" | "codeBlock" | "quote" | "table" | "divider" | "callout" | "pageLink" | "columns" | "column";
  props: Record<string, string | number | boolean>;
  content?: Inline[] | TableContent;
  children: DocumentBlock[];
};
const textProps = z.object({ textColor: color.optional(), backgroundColor: color.optional(), textAlignment: alignment.optional(), level: z.number().int().min(1).max(6).optional(), checked: z.boolean().optional(), language: z.string().max(40).optional(), start: z.number().int().min(0).max(1_000_000).optional(), isToggleable: z.boolean().optional() }).strict();
const blockSchema: z.ZodType<DocumentBlock> = z.lazy(() => {
  const base = { id: z.string().uuid(), children: z.array(blockSchema).max(1000) };
  return z.discriminatedUnion("type", [
    z.object({ ...base, type: z.enum(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "codeBlock", "quote"]), props: textProps, content: inlineArray }).strict(),
    z.object({ ...base, type: z.literal("table"), props: z.object({ textColor: color.optional() }).strict(), content: tableContentSchema }).strict(),
    z.object({ ...base, type: z.literal("divider"), props: z.object({}).strict(), content: z.undefined().optional() }).strict(),
    z.object({ ...base, type: z.literal("callout"), props: z.object({ emoji: z.string().min(1).max(32), color: z.enum(calloutColors).optional(), backgroundColor: blockBackgroundColors.optional() }).strict(), content: z.undefined().optional() }).strict(),
    z.object({ ...base, type: z.literal("pageLink"), props: z.object({ pageId: z.string().uuid(), title: z.string().max(200), relationship: z.enum(["child", "link"]) }).strict(), content: z.undefined().optional() }).strict(),
    z.object({ ...base, type: z.enum(["columns", "column"]), props: z.object({}).strict(), content: z.undefined().optional() }).strict(),
  ]);
});
export const documentSchema = z.array(blockSchema).min(1).max(2000).superRefine((blocks, ctx) => {
  const ids = new Set<string>(); let count = 0;
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  function visit(items: DocumentBlock[], depth: number, parent?: DocumentBlock["type"]) {
    if (depth > 10) { issue("Documents support up to ten nesting levels."); return; }
    for (const block of items) {
      if (++count > 2000) { issue("Document exceeds 2,000 blocks."); return; }
      if (ids.has(block.id)) issue("Block IDs must be unique.");
      ids.add(block.id);
      if (block.type === "column" && parent !== "columns") issue("A column must be inside a columns block.");
      if (block.type === "columns" && (block.children.length < 2 || block.children.length > 5 || block.children.some((child) => child.type !== "column"))) issue("Columns must contain two to five column blocks.");
      if (["callout", "column"].includes(block.type) && !block.children.length) issue("A container must have at least one child block.");
      if (["divider", "pageLink", "table"].includes(block.type) && block.children.length) issue("This block cannot contain child blocks.");
      if (block.type === "table" && block.content && !Array.isArray(block.content)) {
        const table = block.content;
        if ((table.headerRows ?? 0) > table.rows.length || (table.headerCols ?? 0) > table.columnWidths.length) issue("Table headers exceed the table dimensions.");
        for (const row of table.rows) {
          const width = row.cells.reduce((sum, cell) => sum + (Array.isArray(cell) ? 1 : cell.props.colspan ?? 1), 0);
          if (width !== table.columnWidths.length) issue("Table rows must match the column count.");
        }
      }
      visit(block.children, depth + 1, block.type);
    }
  }
  visit(blocks, 0);
});
export const createPageSchema = z.object({
  title: z.string().trim().max(200).default("Untitled"), icon: iconSchema.default("file"),
  parentId: z.string().uuid().nullable().default(null), content: documentSchema.optional(), mutationId: z.string().uuid(),
  linkInParent: z.boolean().default(true),
}).strict();
export const patchPageSchema = z.object({
  expectedRevision: z.number().int().positive(), mutationId: z.string().uuid(),
  title: z.string().trim().max(200).optional(), icon: iconSchema.optional(), content: documentSchema.optional(), favorite: z.boolean().optional(),
}).strict().refine((value) => [value.title, value.icon, value.content, value.favorite].some((v) => v !== undefined), "Supply a change.");
export type CreatePageInput = z.infer<typeof createPageSchema>;
export type PatchPageInput = z.infer<typeof patchPageSchema>;
export type PageSummary = { id: string; parentId: string | null; title: string; icon: PageIcon; favorite: boolean; revision: number; createdAt: string; updatedAt: string; deletedAt: string | null; wordCount: number };
export type Page = PageSummary & { content: DocumentBlock[]; schemaVersion: 1 };
export type Revision = { revision: number; createdAt: string; clientId: string; title: string };

export function inlineText(content: Inline[] = []): string { return content.map((part) => part.type === "text" ? part.text : part.content.map((t) => t.text).join("")).join(""); }
export function cellContent(cell: TableContent["rows"][number]["cells"][number]): Inline[] { return Array.isArray(cell) ? cell : cell.content; }
export function pageReferences(blocks: DocumentBlock[]): string[] { return blocks.flatMap((block) => [...(block.type === "pageLink" ? [String(block.props.pageId)] : []), ...pageReferences(block.children)]); }
export function plainText(blocks: DocumentBlock[]): string {
  return blocks.map((block) => {
    let own = "";
    if (Array.isArray(block.content)) own = inlineText(block.content);
    else if (block.content?.type === "tableContent") own = block.content.rows.map((row) => row.cells.map((cell) => inlineText(cellContent(cell))).join("\t")).join("\n");
    else if (block.type === "pageLink") own = String(block.props.title);
    return [own, plainText(block.children)].filter(Boolean).join("\n");
  }).join("\n");
}
export function wordCount(blocks: DocumentBlock[]): number { return plainText(blocks).trim().split(/\s+/u).filter(Boolean).length; }
export function emptyDocument(): DocumentBlock[] { return [{ id: crypto.randomUUID(), type: "paragraph", props: {}, content: [], children: [] }]; }
export function createCallout(): DocumentBlock { return { id: crypto.randomUUID(), type: "callout", props: { emoji: "💡", backgroundColor: "yellow" }, children: emptyDocument() }; }
// Older pages used a separate callout palette. Convert it before the editor
// supplies defaults, including callouts nested inside other containers.
export function editorDocument(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.map((block) => {
    const children = editorDocument(block.children);
    if (block.type !== "callout") return { ...block, children };
    const { color: legacyColor, ...props } = block.props;
    return { ...block, props: { ...props, backgroundColor: props.backgroundColor ?? legacyColor ?? "yellow" }, children };
  });
}
export function createColumns(count: number): DocumentBlock {
  if (!Number.isInteger(count) || count < 2 || count > 5) throw new Error("Choose two to five columns.");
  return { id: crypto.randomUUID(), type: "columns", props: {}, children: Array.from({ length: count }, () => ({ id: crypto.randomUUID(), type: "column" as const, props: {}, children: emptyDocument() })) };
}
export function createPageLink(page: Pick<PageSummary, "id" | "title">, relationship: "child" | "link" = "link"): DocumentBlock { return { id: crypto.randomUUID(), type: "pageLink", props: { pageId: page.id, title: page.title, relationship }, children: [] }; }
const escape = (value: string) => value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
function inlineMarkdown(content: Inline[]): string {
  return content.map((part) => {
    const render = (t: z.infer<typeof textSchema>) => {
      let value = escape(t.text);
      if (t.styles.code) { const fence = "`".repeat(Math.max(1, ...Array.from(t.text.matchAll(/`+/g), (m) => m[0].length + 1))); value = `${fence} ${t.text} ${fence}`; }
      if (t.styles.bold) value = `**${value}**`;
      if (t.styles.italic) value = `*${value}*`;
      if (t.styles.strike) value = `~~${value}~~`;
      return value;
    };
    return part.type === "text" ? render(part) : `[${part.content.map(render).join("")}](${part.href.replace(/[()]/g, (c) => c === "(" ? "%28" : "%29")})`;
  }).join("");
}
export function toMarkdown(blocks: DocumentBlock[], depth = 0): string {
  return blocks.map((block) => {
    if (block.type === "divider") return "---";
    if (block.type === "pageLink") return `[${escape(String(block.props.title))}](#${block.props.pageId})`;
    if (block.type === "callout") return `> ${block.props.emoji}\n${toMarkdown(block.children).split("\n").map((line) => `> ${line}`).join("\n")}`;
    if (block.type === "columns") return block.children.map((column, index) => `### Column ${index + 1}\n\n${toMarkdown(column.children)}`).join("\n\n");
    if (block.type === "column") return toMarkdown(block.children, depth);
    if (block.type === "table" && block.content && !Array.isArray(block.content)) {
      const rows = block.content.rows.map((row) => `| ${row.cells.map((cell) => inlineMarkdown(cellContent(cell)).replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`);
      return [rows[0], `| ${block.content.columnWidths.map(() => "---").join(" | ")} |`, ...rows.slice(1)].join("\n");
    }
    const content = Array.isArray(block.content) ? block.content : [], text = inlineMarkdown(content);
    const prefix = { heading: "#".repeat(Number(block.props.level ?? 1)) + " ", bulletListItem: "- ", numberedListItem: "1. ", checkListItem: block.props.checked ? "- [x] " : "- [ ] ", quote: "> " }[block.type as string] ?? "";
    const code = inlineText(content), fence = "~".repeat(Math.max(4, ...Array.from(code.matchAll(/~+/g), (m) => m[0].length + 1)));
    const body = block.type === "codeBlock" ? `${fence}${block.props.language ?? ""}\n${code}\n${fence}` : `${"  ".repeat(depth)}${prefix}${text}`;
    return body + (block.children.length ? "\n" + toMarkdown(block.children, depth + 1) : "");
  }).join("\n\n");
}
