import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipboardHasFiles,
  isImageOnlyHtml,
  shouldUploadClipboardImages,
} from "../src/lib/clipboard-image";

/* ---------------------------------------------------------------------------
   isImageOnlyHtml
   The guard that keeps a text-carrying paste out of the upload path. Getting it
   too permissive loses the user's text; too strict and the original bug returns.
--------------------------------------------------------------------------- */

test("a bare img tag is image-only", () => {
  assert.equal(isImageOnlyHtml('<img src="https://example.com/a.png">'), true);
});

test("an image wrapped in a link is image-only", () => {
  assert.equal(
    isImageOnlyHtml('<a href="https://example.com"><img src="a.png" alt="a"></a>'),
    true,
  );
});

test("an image wrapped in layout divs is image-only", () => {
  assert.equal(isImageOnlyHtml('<div><div><img src="a.png"><br></div></div>'), true);
});

test("html with no image at all is not image-only", () => {
  assert.equal(isImageOnlyHtml("<p>hello</p>"), false);
  assert.equal(isImageOnlyHtml(""), false);
});

test("text beside an image is not image-only", () => {
  assert.equal(isImageOnlyHtml('<p>caption</p><img src="a.png">'), false);
  assert.equal(isImageOnlyHtml('<img src="a.png">trailing'), false);
});

test("whitespace and blank entities do not count as text", () => {
  assert.equal(isImageOnlyHtml('<p>&nbsp;</p><img src="a.png">'), true);
  assert.equal(isImageOnlyHtml('<img src="a.png">\n   \t &#8203;'), true);
});

test("an html comment does not count as text", () => {
  assert.equal(isImageOnlyHtml('<!-- <p>not real text</p> --><img src="a.png">'), true);
});

test("a table cell holding text beside an image is not image-only", () => {
  assert.equal(isImageOnlyHtml('<table><tr><td>Name</td><td><img src="a.png"></td></tr></table>'), false);
});

test("srcset and alt attributes are not mistaken for text", () => {
  assert.equal(
    isImageOnlyHtml('<img alt="a picture of a cat" srcset="a-2x.png 2x" src="a.png">'),
    true,
  );
});

/* ---------------------------------------------------------------------------
   clipboardHasFiles
--------------------------------------------------------------------------- */

test("recognises the Files marker", () => {
  assert.equal(clipboardHasFiles(["Files"]), true);
  assert.equal(clipboardHasFiles(["text/html", "Files"]), true);
});

test("recognises a concrete image mime type", () => {
  assert.equal(clipboardHasFiles(["image/png"]), true);
});

test("text-only clipboards carry no files", () => {
  assert.equal(clipboardHasFiles(["text/html", "text/plain"]), false);
  assert.equal(clipboardHasFiles([]), false);
});

/* ---------------------------------------------------------------------------
   shouldUploadClipboardImages — the two real shapes measured in the browser.
--------------------------------------------------------------------------- */

test("screenshot shape: Files alone is uploaded", () => {
  assert.equal(shouldUploadClipboardImages(["Files"], ""), true);
  assert.equal(shouldUploadClipboardImages(["Files"], null), true);
});

test("copy-image-from-web shape: html plus Files is uploaded, not hotlinked", () => {
  // This is the exact payload Chrome produced in scripts/cdp-paste.mjs case B,
  // and the one that used to insert a remote URL the CSP then blocked.
  const html = '<img src="https://example.com/remote.png" alt="remote.png">';
  assert.equal(shouldUploadClipboardImages(["text/html", "Files"], html), true);
});

test("a copied paragraph with an inline image keeps its html path", () => {
  const html = '<p>Some text I care about</p><img src="https://example.com/a.png">';
  assert.equal(shouldUploadClipboardImages(["text/html", "Files"], html), false);
});

test("text-only clipboard never takes the upload path", () => {
  assert.equal(shouldUploadClipboardImages(["text/html", "text/plain"], "<p>hello</p>"), false);
  assert.equal(shouldUploadClipboardImages(["text/markdown"], "# hello"), false);
});

test("an empty clipboard is not an upload", () => {
  assert.equal(shouldUploadClipboardImages([], ""), false);
});
