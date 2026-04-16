# IV MavenGang MCP Server

MCP server that connects AI coding tools to the [MavenGang](https://mavengang.com) project management API. Hosted on Cloudflare Workers (free tier).

Manage your projects, tasks, and team — all from inside your AI coding assistant.

## How It Works

```
Your IDE (Claude Code, Cursor, etc.)
    │
    │  MCP over HTTP
    ▼
This server (Cloudflare Workers)
    │
    │  REST API (Bearer JWT, per-user)
    ▼
MavenGang API
```

Each user logs in once at `/login`, gets a session key, adds it to their IDE config. All tool calls use their own MavenGang credentials — permissions and audit trail preserved.

## Available Tools

| Tool | What it does |
|------|-------------|
| `list_projects` | List all projects |
| `get_project` | Project details |
| `list_tasks` | Tasks in a project (filterable by status, assignee) |
| `get_task` | Full task details including description |
| `create_task` | Create task or subtask |
| `update_task` | Update status, assignee, priority, due date |
| `list_project_members` | Members + user IDs (needed for assignment) |
| `get_my_tasks` | Cross-project "what's on my plate" view |
| `add_comment` | Comment on a task |
| `list_comments` | Read task discussion thread |

## Quick Start (for users)

> **🚀 EASY SETUP** — Most IDEs let you paste config or use CLI to auto-configure. Skip manual setup below if your IDE supports it!

### Option A: Easy Setup (Recommended)

| IDE | How to set up |
|-----|---------------|
| **Claude Desktop** | Paste config into `~/.claude/claude_desktop_config.json`, restart app |
| **Claude Code** | Run: `claude mcp add mavengang <URL> --header "x-session-key: <KEY>"` |
| **Cursor** | Settings → Tools → MCP → Add server → Paste URL + header |
| **opencode** | Run: `opencode config add mcp mavengang <URL> --header "x-session-key: <KEY>"` |
| **Codex** | Run: `codex mcp add mavengang <URL> --header "x-session-key: <KEY>"` |
| **Windsurf** | Settings → Cascade → MCP → Add server → Paste config |
| **VS Code** | Extensions → Search "MCP" → Add from marketplace or paste to `.vscode/mcp.json` |

**After setup: Quit/restart your IDE or terminal session for changes to take effect.**

---

### Option B: Manual Setup

If your IDE doesn't support easy setup, add it manually:

Each IDE stores MCP config differently. Find yours below:

---

#### Claude Desktop
File: `~/.claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

---

#### Claude Code (CLI)
Use the CLI to add:

```bash
claude mcp add mavengang https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp \
  --header "x-session-key: YOUR_SESSION_KEY"
```

Or manually in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

---

#### Cursor
File: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

Or add manually: **Cursor Settings → Tools & Integrations → MCP → Add new MCP server** → choose HTTP → paste URL → add header `x-session-key`.

---

#### Windsurf
File: `~/.codeium/windsurf/mcp_config.json`

> ⚠️ Windsurf uses `serverUrl` not `url`

```json
{
  "mcpServers": {
    "mavengang": {
      "serverUrl": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

Or add manually: **Windsurf Settings → Cascade → MCP Servers → Add Server** → select Remote → paste URL → add header.

---

#### opencode
File: `~/.config/opencode/config.json`

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

Or add via opencode config command.

#### Codex CLI
File: `~/.codex/config.toml`

> ⚠️ Codex uses TOML format, not JSON

```toml
[mcp_servers.mavengang]
url = "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
http_headers = { x-session-key = "YOUR_SESSION_KEY" }
enabled = true
```

Or add manually: **Codex Settings → MCP servers → Add server** → paste URL → add header `x-session-key`.

---

#### VS Code (GitHub Copilot)
File: `.vscode/mcp.json` in your workspace root (create if it doesn't exist)

> ⚠️ VS Code uses `servers` instead of `mcpServers`

```json
{
  "servers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "headers": {
        "x-session-key": "YOUR_SESSION_KEY"
      }
    }
  }
}
```

> ⚠️ **Important:** Quit/restart your IDE or terminal session for changes to take effect.

### 3. Test it

Done! Ask your AI assistant things like:
- "What are my tasks?"
- "List tasks in the BW project"
- "Create a subtask under PRJ5-42 for API changes"
- "Assign that task to John"

## Self-Hosting

Want to host your own instance? It's free.

### Prerequisites

- Node.js 18+
- Cloudflare account ([sign up free](https://dash.cloudflare.com))
- Wrangler CLI

### Steps

```bash
# 1. Clone
git clone https://github.com/jezeem-a/iv-mavengang-mcp.git
cd iv-mavengang-mcp
npm install

# 2. Install Wrangler and login
npm install -g wrangler
wrangler login

# 3. Create KV namespace for session storage
wrangler kv namespace create SESSIONS
# Copy the ID it outputs into wrangler.toml

# 4. Create preview namespace (for local dev)
wrangler kv namespace create SESSIONS --preview
# Copy the preview ID into wrangler.toml

# 5. Deploy
wrangler deploy
# Your server is live at https://<your-worker>.<your-subdomain>.workers.dev

# 6. Local dev
wrangler dev
# Runs at http://localhost:8787
```

### Cost

Free. Cloudflare Workers free tier covers 100,000 requests/day. A team of 50 uses ~10,000/day.

## Project Structure

```
iv-mavengang-mcp/
├── index.js               # MCP server (Cloudflare Workers)
├── session-store.js       # Session storage (Cloudflare KV)
├── wrangler.toml          # Cloudflare Workers config
├── package.json
├── API_CONTRACT.md        # MavenGang API documentation
├── PLAN.md                # Build plan + architecture decisions
└── README.md
```

## Contributing

This is an open-source project. Contributions welcome!

- **Found a bug?** [Open an issue](https://github.com/jezeem-a/iv-mavengang-mcp/issues)
- **Want a new feature?** Fork it, build it, send a PR
- **Have an idea?** Start a discussion in issues

### Adding a new MCP tool

1. Fork the repo
2. Add your tool in `index.js` inside `createMcpServer()` — follow the existing pattern
3. Reference `API_CONTRACT.md` for available MavenGang endpoints
4. Test locally with `wrangler dev`
5. Submit a PR

## API Reference

See `API_CONTRACT.md` for the full MavenGang API documentation (all 20 endpoint groups).

## License

MIT
