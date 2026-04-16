import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import z from "zod";

const server = new McpServer({
  name: "test-server",
  version: "1.0.0"
});

server.registerTool(
  "hello",
  {
    title: "Hello",
    description: "Returns a greeting",
    inputSchema: z.object({
      name: z.string().describe("Name to greet").optional()
    })
  },
  async ({ name = "World" }) => ({
    content: [{ type: "text", text: "Hello, " + name + "!" }]
  })
);

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("🚀 Test MCP server running on stdio\n");
  process.stdin.resume();
})();
