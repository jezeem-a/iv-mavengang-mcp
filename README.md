# IV MavenGang MCP Server

MCP server that connects AI coding tools (Claude Code, Cursor, opencode, Windsurf, VS Code Copilot) to the MavenGang project management API. Hosted on Cloudflare Workers.

## How It Works

```
AI IDE ← MCP (HTTP) → This server ← REST (Bearer JWT) → MavenGang API
```

Each user logs in once at `/login`, gets a session key, adds it to their IDE config. All tool calls use their own MavenGang credentials — permissions and audit trail preserved.

## Available Tools

| Tool | What it does |
|------|-------------|
| `list_projects` | List all projects |
| `get_project` | Project details |
| `list_tasks` | Tasks in a project (filterable) |
| `get_task` | Full task details |
| `create_task` | Create task or subtask |
| `update_task` | Update status, assignee, priority |
| `list_project_members` | Members + user IDs for assignment |
| `get_my_tasks` | Cross-project "what's on my plate" |
| `add_comment` | Comment on a task |
| `list_comments` | Read task comments |

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account (free)
- Wrangler CLI (`npm install -g wrangler`)

### Deploy

```bash
git clone https://github.com/jezeem/iv-mavengang-mcp.git
cd iv-mavengang-mcp
npm install

wrangler login
wrangler kv namespace create SESSIONS
# Copy the namespace ID into wrangler.toml

wrangler deploy
```

### Local Dev

```bash
wrangler kv namespace create SESSIONS --preview
# Copy the preview ID into wrangler.toml

wrangler dev
# Server runs at http://localhost:8787
```

## Connecting Your IDE

1. Go to `https://iv-mavengang-mcp.<account>.workers.dev/login`
2. Enter your MavenGang email and password
3. Copy the JSON config shown on success
4. Paste into your IDE's MCP config file:

| Tool | Config file |
|------|------------|
| Claude Code | `~/.claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| opencode | `~/.config/opencode/config.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` in workspace |

5. Restart your IDE. Done.

## Project Structure

```
iv-mavengang-mcp/
├── index.js               # MCP server (Cloudflare Workers)
├── session-store.js       # Session storage (KV)
├── wrangler.toml          # Cloudflare config
├── package.json
├── config/                # IDE config examples
├── API_CONTRACT.md        # MavenGang API docs
├── PLAN.md                # Build plan
└── README.md
```

## API Reference

See `API_CONTRACT.md` for the full MavenGang API documentation.

## License

MIT
