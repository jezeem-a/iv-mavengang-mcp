# Maven Gang MCP Server

A learning journey: from REST API proxy to MCP server, step by step.

**Goal:** Connect AI assistants (Claude Desktop, Cursor) to our Maven Gang project management tool so teams can list projects and create tasks by talking to AI.

## The Journey

This repo documents the progression of building an MCP server for a company PM tool.

| Step | File | What It Does |
|------|------|--------------|
| [Step 1: REST API](./docs/01-step-1-rest-api.md) | `index.js` | Express proxy to Maven Gang API |
| [Step 2: Local MCP](./docs/02-step-2-local-mcp-stdio.md) | `mcp-server.js` | MCP server with stdio transport (works locally) |
| [Step 3: Remote MCP](./docs/03-step-3-remote-mcp-http.md) | `server.js` | MCP server with HTTP transport (works publicly) |

**Current status:** Step 2 is working. Step 3 is the plan.

## Quick Start

### Prerequisites

- Node.js 18+
- Maven Gang account

### Installation

```bash
git clone <your-repo>
cd mavengang-mcp
npm install
```

### Configuration

Edit `.env` file with your Maven Gang credentials:

```env
BASE_URL=https://mavengang.com/v1
EMAIL=your-email@example.com
PASSWORD=your-password
```

### Running

**Option 1: REST API (for testing with curl)**

```bash
npm start
# Server runs on http://localhost:3000

curl http://localhost:3000/projects
```

**Option 2: MCP Server (for Claude/Cursor)**

```bash
npm run start:mcp
# Connects via stdio - no port needed
```

**Option 3: MCP Inspector (for testing MCP tools)**

```bash
npx @modelcontextprotocol/inspector node mcp-server.js
# Opens browser UI at http://localhost:6274
```

## Available Tools

### list_projects

Lists all projects in your Maven Gang account.

**Parameters:** None

### create_task

Creates a new task in a Maven Gang project.

**Parameters:**
- `projectId` (required): Project ID from list_projects
- `title` (required): Task title
- `description` (optional): Task description

## Connecting to AI Tools

### Claude Desktop

```bash
cp config/claude-desktop.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
# Restart Claude Desktop
```

### Cursor

```bash
cp config/cursor.json ~/.cursor/mcp.json
# Restart Cursor
```

### opencode

```bash
opencode --config config/opencode.json
```

## How MCP Works

```
Claude/Cursor ← JSON-RPC (stdio) → MCP Server ← HTTP (Bearer JWT) → Maven Gang API
```

- **JSON-RPC 2.0**: Protocol for remote procedure calls
- **stdio**: Standard input/output (local only)
- **Streamable HTTP**: Remote transport (for public hosting)

## Project Structure

```
mavengang-mcp/
├── .env                          # Environment variables (API credentials)
├── index.js                      # REST API server (Step 1)
├── mcp-server.js                 # MCP server with stdio (Step 2)
├── package.json                  # Node.js dependencies
├── config/                       # MCP client configurations
│   ├── claude-desktop.json
│   ├── cursor.json
│   └── opencode.json
├── docs/                         # Learning documentation
│   ├── 01-step-1-rest-api.md     # Why we started with REST
│   ├── 02-step-2-local-mcp-stdio.md  # Local MCP with stdio
│   └── 03-step-3-remote-mcp-http.md  # Remote MCP with HTTP (plan)
├── API_CONTRACT.md               # Maven Gang API documentation
└── README.md                     # This file
```

## Dependencies

- `@modelcontextprotocol/server` — Official MCP SDK
- `axios` — HTTP client
- `express` — REST server (for Step 1 and Step 3)
- `dotenv` — Environment variable loading
- `zod` — Schema validation (required by MCP SDK)

## Future Enhancements

Planned tools:
- `list_tasks` - List tasks in a project
- `get_task` - Get task details
- `update_task` - Update task status
- `list_members` - List team members
- `assign_task` - Assign task to user

## API Reference

See `API_CONTRACT.md` for the full Maven Gang API documentation.

## License

MIT

## Credits

- Built with [@modelcontextprotocol/server](https://github.com/modelcontextprotocol/typescript-sdk)
- Maven Gang API: https://mavengang.com
