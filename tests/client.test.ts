import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestError, request } from "../src/lib/api-client";

async function withFetch<T>(response: Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("a non-JSON failure surfaces as a request error, not a syntax error", async () => {
  // A crash page or proxy error used to reach JSON.parse, throwing SyntaxError past
  // every caller that checks for RequestError and the 409 conflict path.
  await withFetch(new Response("<html><body>Bad gateway</body></html>", { status: 502, headers: { "Content-Type": "text/html" } }), async () => {
    await assert.rejects(request("/api/pages"), (error: RequestError) => error instanceof RequestError && error.status === 502 && error.code === "request_failed" && error.message.length > 0);
  });
});

test("an empty body on an otherwise successful response is reported, not parsed", async () => {
  await withFetch(new Response("", { status: 200 }), async () => {
    await assert.rejects(request("/api/pages"), (error: RequestError) => error instanceof RequestError && error.code === "invalid_response");
  });
});

test("a JSON conflict keeps the server's code and message", async () => {
  const body = JSON.stringify({ error: { code: "revision_conflict", message: "This page changed. Reload before saving." } });
  await withFetch(new Response(body, { status: 409, headers: { "Content-Type": "application/json" } }), async () => {
    await assert.rejects(request("/api/pages"), (error: RequestError) => error.status === 409 && error.code === "revision_conflict" && error.message === "This page changed. Reload before saving.");
  });
});

test("a successful response is returned as parsed JSON", async () => {
  await withFetch(new Response(JSON.stringify({ page: { id: "abc" } }), { status: 200 }), async () => {
    assert.deepEqual(await request<{ page: { id: string } }>("/api/pages/abc"), { page: { id: "abc" } });
  });
});
