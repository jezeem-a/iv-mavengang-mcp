# Step 2: Local MCP Server with stdio

The REST API proved we could talk to Maven Gang. But Claude and Cursor don't speak REST — they speak MCP. This step converts our proxy into a proper MCP server that runs locally.

## What is MCP?

**Model Context Protocol (MCP)** is an open standard (created by Anthropic) that lets AI assistants use external tools. Think of it as a plugin system for Claude, Cursor, etc.

Instead of HTTP endpoints, MCP uses **JSON-RPC 2.0** — a lightweight protocol where each message is a JSON object. The key difference:

| | REST API | MCP |
|---|---|---|
| Purpose | Serve a web app | Provide tools to AI assistants |
| Transport | HTTP (over network) | **stdio** (stdin/stdout, or HTTP) |
| Format | HTTP requests/responses | JSON-RPC 2.0 messages |
| Schema | OpenAPI/Swagger | Zod schemas in the SDK |

## The Code: `mcp-server.js`

```javascript
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import axios from "axios";
import dotenv from "dotenv";
import z from "zod";

dotenv.config({ quiet: true });

const api = axios.create({
  baseURL: process.env.BASE_URL || "https://mavengang.com/v1",
  headers: {
    "Content-Type": "application/json"
  }
});

let agencyId = null;
let isLoggedIn = false;

async function login() {
  if (isLoggedIn) return;

  if (!process.env.EMAIL || !process.env.PASSWORD) {
    process.stderr.write("⚠️ EMAIL and PASSWORD env vars are required\n");
    throw new Error("Missing EMAIL or PASSWORD");
  }

  try {
    const res = await api.post("/auth/login", {
      email: process.env.EMAIL,
      password: process.env.PASSWORD
    });
    api.defaults.headers.common["Authorization"] = "Bearer " + res.data.access_token;

    const me = await api.get("/auth/me");
    agencyId = me.data.memberships[0].agency_id;

    isLoggedIn = true;
    process.stderr.write("✅ Logged into Maven Gang (agency: " + agencyId + ")\n");
  } catch (err) {
    process.stderr.write("⚠️ Login error: " + err.message + "\n");
    throw err;
  }
}

const server = new McpServer({
  name: "mavengang",
  version: "1.0.0",
  description: "Maven Gang Project Management API"
});

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List all projects in your Maven Gang account. Returns project name, ID, key, status, client, and task counts.",
    inputSchema: z.object({})
  },
  async () => {
    await login();
    const res = await api.get(`/agencies/${agencyId}/projects`);
    const projects = res.data.items.map(p => ({
      id: p.id,
      name: p.name,
      key: p.key,
      status: p.status,
      client: p.clients?.[0]?.name || "No client",
      category: p.category_name,
      taskTotal: p.task_total,
      taskCompleted: p.task_completed
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      structuredContent: { projects }
    };
  }
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create a new task in a Maven Gang project. Requires project ID and title.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      title: z.string().describe("Task title"),
      description: z.string().describe("Task description (optional)").optional()
    })
  },
  async ({ projectId, title, description = "" }) => {
    await login();
    const res = await api.post(`/agencies/${agencyId}/projects/${projectId}/tasks`, {
      title,
      description
    });
    const task = res.data.task;
    return {
      content: [{
        type: "text",
        text: `Task created: ${task.task_number} - "${task.title}"\nStatus: ${task.status_name}\n\nView: https://mavengang.com/projects/${projectId}/tasks/${task.id}`
      }],
      structuredContent: task
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("🚀 Maven Gang MCP server running on stdio\n");

  process.stdin.resume();
}

main();
```

## Why stdio?

stdio = **standard input/output**. When Claude Desktop or Cursor starts your MCP server, it spawns it as a **subprocess** and communicates through stdin (requests) and stdout (responses).

```
Claude Desktop
  │
  │ spawn mcp-server.js
  │
  ▼
┌─────────────────┐
│   stdin ──────→ │ mcp-server.js
│   stdout ←───── │ (process)
│   stderr ─────→ │ (logs here)
└─────────────────┘
```

**Why not HTTP?** Because Claude Desktop and Cursor can't connect to a remote URL with stdio — they need to spawn the process themselves on the same machine. This is the **only** transport that works with local MCP clients.

## How It Works

### 1. Transport Layer
`StdioServerTransport` connects the MCP server to stdin/stdout. No ports, no HTTP — just file descriptors.

### 2. Tool Registration
`server.registerTool()` defines what the AI assistant can do:

```javascript
server.registerTool(
  "tool_name",           // Name the AI sees
  {                      // Schema / description
    title: "Human Title",
    description: "What this does...",
    inputSchema: z.object({ ... })  // MUST be Zod, not JSON Schema
  },
  async (args) => {      // The actual implementation
    return {
      content: [{ type: "text", text: "Result" }],
      structuredContent: { /* structured data */ }
    };
  }
);
```

### 3. Login Flow
The `login()` function is lazy — it only runs on the first tool call, not at server startup. This is because MCP servers connect immediately (the `initialize` handshake), but credentials aren't needed until actual tool execution.

### 4. Connecting to Claude/Cursor
Create a config file that tells Claude/Cursor how to spawn your server:

```json
{
  "mcpServers": {
    "mavengang": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": {
        "BASE_URL": "https://mavengang.com/v1",
        "EMAIL": "your@email.com",
        "PASSWORD": "your-password"
      }
    }
  }
}
```

The `env` field passes credentials as environment variables to the spawned process.

## Pitfalls We Hit

### Pitfall 1: Wrong Schema Format
The MCP SDK requires **Zod schemas**, not raw JSON Schema objects.

```javascript
// ❌ WRONG — this doesn't work
inputSchema: {
  type: "object",
  properties: {
    projectId: { type: "string", description: "Project ID" }
  },
  required: ["projectId"]
}

// ✅ RIGHT — use Zod
inputSchema: z.object({
  projectId: z.string().describe("Project ID")
})
```

### Pitfall 2: dotenv Banner Leaks into stdio
`dotenv` prints a log banner by default. In a stdio MCP server, stdout is reserved for JSON-RPC. Any non-JSON output on stdout breaks everything.

```javascript
// ❌ WRONG — dotenv banner goes to stdout
dotenv.config();

// ✅ RIGHT — suppress the banner
dotenv.config({ quiet: true });
```

### Pitfall 3: structuredContent Must Be an Object
The `structuredContent` field in tool results must be a **record/object**, not an array.

```javascript
// ❌ WRONG — array breaks validation
structuredContent: projects  // projects is an array

// ✅ RIGHT — wrap it in an object
structuredContent: { projects }
```

### Pitfall 4: Logging to stdout
`console.log()` goes to stdout, which is the JSON-RPC channel. Any extra bytes on stdout corrupt the protocol.

```javascript
// ❌ WRONG — console.log goes to stdout
console.log("Logged in");

// ✅ RIGHT — use stderr
process.stderr.write("Logged in\n");
```

## Testing with MCP Inspector

MCP Inspector is a browser-based tool for testing MCP servers:

```bash
# In one terminal — start the MCP server
npm run start:mcp

# In another terminal — launch the inspector
npx @modelcontextprotocol/inspector node mcp-server.js
```

Opens a browser UI at `http://localhost:6274` where you can:
- Connect to the server
- See all registered tools
- Click a tool to see its schema
- Run tools and see responses

## What's Next?

This works great locally. But there's a problem: **only you can use it**. Each person who wants to connect needs to:
1. Clone the repo
2. Install dependencies
3. Create a `.env` file with their credentials
4. Configure their MCP client

That's a lot of friction. What if we could host this server publicly so everyone connects to it directly?

→ [Step 3: Remote MCP Server with HTTP](./03-step-3-remote-mcp-http.md)

## Running This Step

```bash
# Start the MCP server
npm run start:mcp

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node mcp-server.js

# Connect from Claude Desktop
cp config/claude-desktop.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
# Restart Claude Desktop
```
