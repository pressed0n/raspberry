import { test } from "node:test";
import assert from "node:assert/strict";
import { openMigrated } from "./schema";
import { RaspberryService, localActor } from "../src/server/service";
import { documentSchema, plainText, toMarkdown, type DocumentBlock } from "../src/lib/document";

/**
 * The four media blocks (B26). What matters here is not that they can be stored —
 * it is that a document cannot smuggle a script through `url`, and that an empty
 * block (just inserted, no file yet) stays saveable.
 */

const fileUrl = () => `/api/files/${crypto.randomUUID()}`;

function media(type: "image" | "video" | "audio" | "file", props: Record<string, unknown>): DocumentBlock {
  return { id: crypto.randomUUID(), type, props: props as DocumentBlock["props"], children: [] };
}

test("a stored file validates in all four media blocks", () => {
  const blocks = [
    media("image", { url: fileUrl(), name: "photo.png", caption: "A photo", showPreview: true, previewWidth: 480, textAlignment: "center", backgroundColor: "default" }),
    media("video", { url: fileUrl(), name: "clip.mp4", showPreview: true, previewWidth: 640, textAlignment: "left", backgroundColor: "default" }),
    media("audio", { url: fileUrl(), name: "song.mp3", showPreview: true, backgroundColor: "default" }),
    media("file", { url: fileUrl(), name: "report.pdf", backgroundColor: "default" }),
  ];
  assert.equal(documentSchema.parse(blocks).length, 4);
});

test("a block with no file yet is a valid document", () => {
  const parsed = documentSchema.parse([media("image", { url: "", name: "", caption: "", showPreview: true, previewWidth: undefined })]);
  assert.equal(parsed[0].props.url, "");
});

test("script and data URLs are refused", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///C:/Windows/win.ini"]) {
    assert.throws(() => documentSchema.parse([media("image", { url })]), /uploaded file or an http link/, `expected ${url} to be refused`);
  }
});

test("a remote http image is allowed for people who link rather than upload", () => {
  assert.equal(documentSchema.parse([media("image", { url: "https://example.com/cat.png" })])[0].props.url, "https://example.com/cat.png");
});

test("an unknown prop is rejected rather than silently stored", () => {
  assert.throws(() => documentSchema.parse([media("image", { url: fileUrl(), onerror: "alert(1)" })]));
});

test("caption is searchable text and empty media is not exported", () => {
  const blocks = [
    media("image", { url: fileUrl(), name: "holiday.png", caption: "Sunset over the harbour" }),
    media("file", { url: "" }),
  ];
  assert.equal(plainText(blocks).trimEnd(), "Sunset over the harbour");
  assert.match(toMarkdown([blocks[0]]), /!\[Sunset over the harbour\]\(\/api\/files\//);
  assert.equal(toMarkdown([blocks[1]]), "", "a heading for a file that does not exist is worse than silence");
});

test("a page with media saves and reads back through the service", async () => {
  const db = await openMigrated("file::memory:");
  const service = new RaspberryService(db);
  const actor = localActor();
  await service.seed();
  const url = fileUrl();
  const page = await service.create(actor, {
    title: "Media round trip",
    content: [media("image", { url, name: "a.png", caption: "Caption", showPreview: true, previewWidth: 320, textAlignment: "left", backgroundColor: "default" })],
    mutationId: crypto.randomUUID(),
  });
  const latest = await service.get(actor, page.id);
  assert.equal(latest.content[0].props.url, url);
  assert.equal(latest.content[0].props.caption, "Caption");
});
