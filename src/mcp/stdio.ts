import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";
import { getService } from "../server/runtime";
import { localActor } from "../server/service";
try {
  const service = await getService();
  const server = createMcpServer(service, localActor("mcp-local"), process.env.RASPBERRY_MCP_WRITE === "1");
  await server.connect(new StdioServerTransport());
} catch (error) { console.error(error instanceof Error ? error.message : "Unable to start MCP server."); process.exitCode = 1; }
