"use client";
/* Raspberry — drag layer (B28)
   ---------------------------------------------------------------------------
   The two things a sidebar drag draws *outside* the tree: the ghosted row that follows
   the cursor, and the insertion line that says where a gap drop will land.

   Both are portalled to <body> and positioned `fixed`. Not a styling preference: the
   sidebar sits inside a transformed, filtered container, and a filtered ancestor becomes
   the containing block for fixed descendants — so an absolutely positioned line inside
   the tree would be measured against the tree while the pointer was measured against the
   viewport. (Same trap the crumb and tab menus hit in B24.) Rendering to <body> keeps one
   coordinate system for the whole gesture.

   The ghost is moved with `transform` and nothing else. It has no transition: it must sit
   under the cursor exactly, and a smoothed follow reads as lag rather than as weight. The
   insertion line does fade in — it appears where there was nothing, and a hard pop draws
   the eye to the wrong thing.
*/
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type GhostView = { title: string; icon: ReactNode; x: number; y: number; width: number; height: number };
export type LineView = { x: number; y: number; width: number };

export default function DragLayer({ ghost, line }: { ghost: GhostView | null; line: LineView | null }) {
  /* Portals need a document, and this component is rendered during the server pass too.
     One frame of nothing is cheaper than a hydration mismatch. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  if (!host) return null;
  return createPortal(
    <>
      {line && <div className="tree-drop-line" style={{ width: line.width, transform: `translate3d(${line.x}px, ${line.y}px, 0)` }} />}
      {ghost && (
        <div className="tree-ghost" aria-hidden="true" style={{ width: ghost.width, height: ghost.height, transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)` }}>
          {ghost.icon}
          <span>{ghost.title}</span>
        </div>
      )}
    </>,
    host,
  );
}
