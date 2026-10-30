"use client";
/* Raspberry — video block (B26)
   ---------------------------------------------------------------------------
   Why this is not `defaultBlockSpecs.video`: BlockNote's built-in video block
   renders a `<video>` element and nothing else. I read the shipped renderer to
   confirm it — there is no iframe anywhere in @blocknote/core 0.56 — so pasting a
   YouTube link into the native block produced a broken player. "Video (file upload
   or yt link)" needs both, and a block that silently fails on half its inputs is
   worse than one that does not offer it.

   So the wrapper is BlockNote's own `ResizableFileBlockWrapper` — the same chrome
   the native image and audio blocks use: add-file button, file panel with Upload
   and Embed tabs, caption, resize handles, replace/delete menu. Only the preview
   element differs, which is the part that needed to know about providers.

   The prop schema is copied from the native video block on purpose: a document
   written by the native block, or by an older build, keeps validating.
*/
import { createReactBlockSpec, ResizableFileBlockWrapper } from "@blocknote/react";
import { Video as VideoIcon } from "lucide-react";
import type { ReactNode } from "react";

const ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

/**
 * `ResizableFileBlockWrapper` is declared against the `file` block type, and the
 * only thing that differs is that literal: it reads `block.props`, `editor` and
 * `children`, never the block's `type`. So the cast below is a type-level
 * correction, not a runtime one — the alternative is reimplementing the add-file
 * button, the file panel, the caption field and the resize handles, which is how
 * those three parts would end up subtly different from image and audio.
 */
const FileWrapper = ResizableFileBlockWrapper as unknown as (props: {
  block: { id: string; type: "video"; props: Record<string, unknown> };
  editor: unknown;
  buttonIcon?: ReactNode;
  children?: ReactNode;
}) => ReactNode;

/**
 * Recognise the providers whose watch URLs are not media files.
 *
 * This is a whitelist rather than "anything that isn't an mp4", because an
 * arbitrary remote page framed inside the editor is a phishing surface: the frame
 * would sit under our URL bar with our chrome around it.
 */
export function embedUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const id = (value: string | null | undefined) => (value && /^[A-Za-z0-9_-]{6,}$/.test(value) ? value : null);

  if (host === "youtu.be") {
    const video = id(url.pathname.slice(1).split("/")[0]);
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const path = url.pathname;
    const video = id(url.searchParams.get("v"))
      ?? (path.startsWith("/shorts/") ? id(path.slice("/shorts/".length)) : null)
      ?? (path.startsWith("/embed/") ? id(path.slice("/embed/".length)) : null)
      ?? (path.startsWith("/live/") ? id(path.slice("/live/".length)) : null);
    return video ? `https://www.youtube-nocookie.com/embed/${video}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const match = /\/(?:video\/)?(\d{6,})/.exec(url.pathname);
    return match ? `https://player.vimeo.com/video/${match[1]}` : null;
  }
  return null;
}

export const createVideoBlock = createReactBlockSpec(
  {
    type: "video",
    content: "none",
    propSchema: {
      textAlignment: { default: "left" },
      backgroundColor: { default: "default" },
      name: { default: "" },
      url: { default: "" },
      caption: { default: "" },
      showPreview: { default: true },
      // A default width rather than `undefined`: an iframe has no intrinsic size,
      // so an embed inserted with no width would have rendered as a 300×150 box
      // floating in the page. Resizing still overrides this.
      previewWidth: { default: 640 },
    },
  },
  {
    meta: { fileBlockAccept: ["video/*"] },
    parse: (element) => {
      if (element.tagName === "VIDEO") return { url: element.getAttribute("src") ?? undefined };
      if (element.tagName === "IFRAME") {
        const source = embedUrl(element.getAttribute("src") ?? "");
        return source ? { url: element.getAttribute("src") ?? undefined } : undefined;
      }
      return undefined;
    },
    render: ({ block, editor }) => {
      const url = BlocknoteUrl(block.props.url);
      const embed = embedUrl(url);
      return (
        <FileWrapper block={block} editor={editor} buttonIcon={<VideoIcon size={24} />}>
          {embed ? (
            <div className="raspberry-embed">
              <iframe
                className="raspberry-embed-frame"
                src={embed}
                title={String(block.props.name || block.props.caption || "Video")}
                allow={ALLOW}
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
              />
            </div>
          ) : (
            <video className="bn-visual-media" src={url} controls playsInline preload="metadata" />
          )}
        </FileWrapper>
      );
    },
  },
);

function BlocknoteUrl(value: unknown): string {
  return typeof value === "string" ? value : "";
}
