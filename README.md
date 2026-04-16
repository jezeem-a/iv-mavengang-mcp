# IV MavenGang MCP Server

MCP server that connects AI coding tools to the [MavenGang](https://mavengang.com) project management API. Hosted on Cloudflare Workers (free tier).

Manage your projects, tasks, and team — all from inside your AI coding assistant.

## How It Works

```
Your IDE ──OAuth 2.1 + DCR──▶ Cloudflare Worker
                                    │
                                    ├─ /authorize, /token, /register
                                    ├─ /.well-known/oauth-*
                                    └─ /mcp (Streamable HTTP)
                                             │
                                             ▼
                                    Durable Object per session
                                             │
                                             │ MavenGang JWT
                                             ▼
                                    MavenGang API
```

Each teammate connects their IDE via OAuth. On first connect, a browser opens to a MavenGang login page. After sign-in, the IDE caches a long-lived token. All API calls use the teammate's own MavenGang credentials — permissions and audit trail preserved.

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

## Setup

All IDEs use OAuth — one browser sign-in per machine, then cached.

### Claude Desktop (Mac/Windows app)

1. Settings → Connectors → "Add custom connector"
2. Paste: `https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp`
3. Browser opens → sign in with MavenGang email/password → done.

### Claude Code CLI

```bash
claude mcp add mavengang --transport http -s user -- https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp
```

First tool call opens browser for sign-in.

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
    }
  }
}
```

First use opens browser.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mavengang": {
      "serverUrl": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
    }
  }
}
```

### opencode

`~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mavengang": {
      "type": "remote",
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "enabled": true
    }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.mavengang]
url = "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
```

### Fallback (any IDE that fails OAuth)

Use `mcp-remote` bridge:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"]
}
```

## Test it

Done! Ask your AI assistant things like:
- "What are my tasks?"
- "List tasks in the BW project"
- "Create a subtask under PRJ5-42 for API changes"
- "Assign that task to John"

## Self-Hosting

Want to host your own instance? It's free.

### Prerequisites

- Node.js 22+ (required for zod v4)
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

# 3. Create KV namespace for OAuth storage
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create OAUTH_KV --preview

# 4. Update wrangler.toml with KV IDs and add Durable Object
# See wrangler.toml for the exact structure

# 5. Deploy
npx wrangler deploy
# Your server is live at https://<your-worker>.<your-subdomain>.workers.dev
```

### Cost

Free. Cloudflare Workers free tier covers 100,000 requests/day + Durable Objects (free tier works for typical team usage).

## Project Structure

```
iv-mavengang-mcp/
├── index.js               # MCP server (Cloudflare Workers + OAuthProvider)
├── wrangler.toml          # Cloudflare Workers config (DO + KV)
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
2. Add your tool in `index.js` inside `MavenGangMCP.init()` — follow the existing pattern
3. Reference `API_CONTRACT.md` for available MavenGang endpoints
4. Test locally with `npx wrangler dev`
5. Submit a PR

## API Reference

See `API_CONTRACT.md` for the full MavenGang API documentation (all 20 endpoint groups).

## License

MIT