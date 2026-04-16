# Step 3: Remote MCP Server with HTTP Transport

Step 2 gave us a working local MCP server. But it only works if the server process runs on the same machine as Claude/Cursor. This step explains how to make it public so anyone can connect without cloning the repo.

## The Problem with stdio

stdio transport works like this:

```
Claude Desktop
  │
  │ spawn node mcp-server.js  ← must be a local process
  │
  ▼
mcp-server.js (subprocess on YOUR machine)
```

This means:
- Each user must have Node.js installed
- Each user must clone the repo and install dependencies
- Each user must have their own `.env` credentials
- You can't share a single URL that everyone connects to

This is why stdio is called **"local transport"** — it only works when spawned as a subprocess on the same machine.

## The Solution: HTTP Transport

HTTP transport lets your MCP server run as a **web service** that anyone can connect to:

```
Employee A (Claude)    ──HTTPS──►  ┌─────────────────┐
Employee B (Cursor)    ──HTTPS──►  │  MCP Server      │  ──HTTPS──►  Maven Gang API
Employee C (opencode)  ──HTTPS──►  │  (Express, hosted│
                                   │   on Render)     │
                                   └─────────────────┘
```

No one needs to install anything. They just point their MCP client to your URL.

### How MCP HTTP Transport Works

Instead of stdin/stdout, the server listens for HTTP POST requests at an endpoint (e.g., `/mcp`). Each request contains a JSON-RPC message, and the server responds with JSON.

The protocol is called **Streamable HTTP** — it's the current MCP standard (replacing the older SSE-based approach). It works like:

```
Client sends:     POST /mcp  { "jsonrpc": "2.0", "method": "tools/call", ... }
Server responds:  { "jsonrpc": "2.0", "result": { "content": [...] } }
```

It's still JSON-RPC, just over HTTP instead of stdin/stdout.

## Architecture for Multi-User

The key challenge: stdio servers have one set of credentials baked in via environment variables. For a public server, each user needs to authenticate with **their own** Maven Gang account.

### Authentication Flow

```
1. Employee configures their MCP client:
   {
     "url": "https://your-app.onrender.com/mcp",
     "headers": {
       "X-Maven-Email": "employee@company.com",
       "X-Maven-Password": "their-password"
     }
   }

2. When the client calls a tool, it sends the headers with every request

3. Your server reads the headers and authenticates to Maven Gang per-request

4. Server calls Maven Gang API with the user's token

5. Returns results to the client
```

### Why Per-Request Login?

- **Stateless** — no sessions, no shared state between users
- **Safe** — if user A and user B call tools simultaneously, their requests don't interfere
- **Scalable** — works with any hosting platform, including serverless

## Hosting Options

### Option A: Render (Recommended for Beginners)

**Free tier:** 750 hours/month. Connects directly to Bitbucket/GitHub.

```
Your setup:
1. Push code to Bitbucket
2. Go to render.com → New Web Service
3. Connect Bitbucket repo
4. Render detects package.json, auto-deploys
5. Get URL: https://mavengang-mcp.onrender.com
```

**Pros:** Simplest setup, auto-deploys on push
**Cons:** Free tier sleeps after 15 min idle (first request is slow)

### Option B: Cloudflare Workers

**Free tier:** 100,000 requests/day. Never sleeps.

```
Your setup:
1. Install Wrangler CLI: npm install -g wrangler
2. wrangler init my-mcp-server
3. wrangler deploy
4. Get URL: https://mavengang-mcp.your-name.workers.dev
```

**Pros:** Fastest, never sleeps, cheapest at scale
**Cons:** Different runtime model (not standard Node.js), steeper learning curve

### Option C: Vercel

**Free tier:** 100GB bandwidth. Serverless.

```
Your setup:
1. Push code to Bitbucket
2. Go to vercel.com → Import Project
3. Connect Bitbucket repo
4. Auto-deploy
5. Get URL: https://mavengang-mcp.vercel.app
```

**Pros:** Familiar if you've used it
**Cons:** Cold starts, serverless limitations

## Code Changes Required

The main change is replacing `StdioServerTransport` with a web server:

### Current: `mcp-server.js` (stdio)
```javascript
const transport = new StdioServerTransport();
await server.connect(transport);
// Server communicates via stdin/stdout
```

### New: `server.js` (HTTP)
```javascript
import express from "express";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,  // stateless
});
await server.connect(transport);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // Read user credentials from headers
  const email = req.headers["x-maven-email"];
  const password = req.headers["x-maven-password"];

  // Login as this user
  await loginAs(email, password);

  // Handle MCP request
  await transport.handleRequest(req, res, req.body);
});

app.listen(process.env.PORT || 3000);
```

### How Tools Read Credentials

Instead of reading from environment variables, tools read from request headers:

```javascript
server.registerTool("list_projects", ...,
  async (args, ctx) => {
    // ctx.request has the HTTP request with headers
    const email = ctx.request.headers["x-maven-email"];
    const password = ctx.request.headers["x-maven-password"];

    // Login per-request
    const token = await login(email, password);

    // Call Maven Gang API
    const projects = await listProjects(token);
    return { content: [{ type: "text", text: JSON.stringify(projects) }] };
  }
);
```

## Employee Client Configuration

After hosting, employees configure their MCP client like this:

### Claude Desktop
```json
{
  "mcpServers": {
    "mavengang": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.onrender.com/mcp"],
      "env": {
        "EMAIL": "employee@company.com",
        "PASSWORD": "their-password"
      }
    }
  }
}
```

The `mcp-remote` package bridges local MCP clients to remote HTTP servers. It reads the `EMAIL` and `PASSWORD` env vars and sends them as headers to your server.

### Cursor
Same config format as Claude Desktop.

### opencode
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mavengang": {
      "type": "local",
      "command": ["npx", "-y", "mcp-remote", "https://your-app.onrender.com/mcp"],
      "environment": {
        "EMAIL": "employee@company.com",
        "PASSWORD": "their-password"
      }
    }
  }
}
```

## CI/CD with Bitbucket Pipelines

Create `bitbucket-pipelines.yml` in your repo root:

```yaml
image: node:20

pipelines:
  branches:
    main:
      - step:
          name: Deploy to Render
          script:
            - npm install
            # Render auto-deploys from Bitbucket — no manual deploy needed
            # This step can run tests before deployment
            - npm test || true
```

Or if using a different host, add the appropriate deploy commands.

## Security Considerations

### What's OK for Internal Use
- Credentials pass through your server (acceptable for company-internal tools)
- HTTPS encrypts all traffic
- No passwords stored on disk — used only for API calls

### What to Improve for Production
- **Maven Gang should support OAuth** — then your server never sees passwords
- Rate limiting per user
- Logging and monitoring
- Input validation on all tool parameters

## Deployment Checklist

- [ ] Create `server.js` with Streamable HTTP transport
- [ ] Create `render.yaml` (or equivalent hosting config)
- [ ] Add `.gitignore` to protect credentials
- [ ] Push to Bitbucket
- [ ] Connect repo to hosting platform
- [ ] Get the public URL
- [ ] Test with MCP Inspector using the URL
- [ ] Share URL + client config template with employees

→ [Back to README](../README.md)
