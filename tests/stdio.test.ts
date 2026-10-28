import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the actual stdio entry point negotiates with an SDK client", { timeout: 15_000 }, async () => {
  const client = new Client({ name: "stdio-smoke-test", version: "1" });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/stdio.ts"], cwd: process.cwd(), env: { ...env, RASPBERRY_LOCAL_DEV: "1", DATABASE_URL: "file::memory:", RASPBERRY_MCP_WRITE: "0" }, stderr: "pipe" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 3);
    const result = await client.callTool({ name: "search_pages", arguments: { query: "" } });
    assert.equal(JSON.parse((result.content as { text: string }[])[0].text).pages.length, 3);
  } finally { await client.close(); await transport.close(); }
});
