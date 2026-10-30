import { Compass, FileText, Leaf, Lightbulb, NotebookPen, Sparkles } from "lucide-react";
import type { PageIcon } from "@/lib/document";

/* The page-icon set, extracted from `workspace.tsx` so the sidebar, the tab
   strip and anything else that lists pages render the same glyph from one map
   rather than three copies that could drift. */
const icons = { file: FileText, sparkles: Sparkles, notebook: NotebookPen, lightbulb: Lightbulb, compass: Compass, leaf: Leaf };

/** The icon set as an ordered list, for the page-icon picker. */
export const PAGE_ICONS = Object.keys(icons) as PageIcon[];

export function PageGlyph({ icon, size = 15 }: { icon: PageIcon; size?: number }) {
  const Icon = icons[icon] ?? FileText;
  return <Icon size={size} strokeWidth={1.7} />;
}
