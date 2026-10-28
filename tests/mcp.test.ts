import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
import { openDatabase } from "../src/server/database";
import { RaspberryService, localActor } from "../src/server/service";
import { emptyDocument, inlineText } from "../src/lib/document";

test("MCP negotiates, is read-only by default, and applies permission checks", async () => {
  const database = await openDatabase("file::memory:"), service = new RaspberryService(database); await service.seed();
  const server = createMcpServer(service, localActor("mcp-test"));
  const client = new Client({ name: "integration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a); await client.connect(b);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["get_page", "list_children", "search_pages"]);
    const result = await client.callTool({ name: "search_pages", arguments: { query: "clarity" } });
    assert.equal(result.isError, undefined);
    assert.equal(Array.isArray(JSON.parse((result.content as { text: string }[])[0].text).pages), true);
    const denied = await client.callTool({ name: "get_page", arguments: { pageId: crypto.randomUUID() } });
    assert.equal(denied.isError, true);
  } finally { await client.close(); await server.close(); await database.close(); }
});
test("MCP can create, append, and precisely update blocks through the shared service", async () => {
  const database = await openDatabase("file::memory:"), service = new RaspberryService(database); await service.seed();
  const server = createMcpServer(service, localActor("mcp-test"), true), client = new Client({ name: "integration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  try {
    await server.connect(a); await client.connect(b);
    const { page } = await call("create_page", { title: "An AI thought", mutationId: crypto.randomUUID() });
    const blocks = emptyDocument(); blocks[0].content = [{ type: "text", text: "Appended by AI", styles: {} }];
    const append = { pageId: page.id, expectedRevision: 1, mutationId: crypto.randomUUID(), blocks };
    assert.deepEqual(await call("append_blocks", append), await call("append_blocks", append));
    const updated = { ...blocks[0], content: [{ type: "text", text: "Revised by AI", styles: {} }] };
    const update = { pageId: page.id, expectedRevision: 2, mutationId: crypto.randomUUID(), blocks: [updated] };
    assert.deepEqual(await call("update_blocks", update), await call("update_blocks", update));
    const saved = await service.get(localActor(), page.id);
    assert.equal(saved.content.length, 2); assert.equal(saved.revision, 3);
    assert.equal(inlineText(Array.isArray(saved.content[1].content) ? saved.content[1].content : []), "Revised by AI");
    const conflict = await client.callTool({ name: "append_blocks", arguments: { pageId: page.id, expectedRevision: 1, mutationId: crypto.randomUUID(), blocks: emptyDocument() } });
    assert.equal(conflict.isError, true);
  } finally { await client.close(); await server.close(); await database.close(); }
});
