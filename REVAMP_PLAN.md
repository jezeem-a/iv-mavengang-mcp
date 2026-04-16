# REVAMP_PLAN.md — Fix MCP architecture on Cloudflare Workers

**Audience:** Another coding agent (opencode) will execute this plan. Human user will only copy/paste. Be exact. No ambiguity.

**Status:** Current `index.js` is broken by design. Full rewrite required — not a patch.

---

## 1. Why revamp (the defect)

Current server at `/mcp` creates a fresh `McpServer` + `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request. Two fatal problems:

1. **MCP is a stateful protocol.** Client sends `initialize`, server must remember it, then client sends `tools/list` / `tools/call`. Cloudflare Workers run a new V8 isolate per HTTP request. Stateless transport + stateless Worker = each request forgets the handshake. Some clients re-handshake every call (Claude Code CLI) and tolerate this, but it violates the spec and breaks sessions that hold SSE notifications or `Mcp-Session-Id`.
2. **Custom `x-session-key` header is not a recognised MCP auth mechanism.** The MCP authorization spec (2025-06-18) requires `401 + WWW-Authenticate: Bearer resource_metadata=...` and `.well-known/oauth-protected-resource` discovery. Claude Desktop Mac "Connectors" UI **has no field to paste headers** — it only speaks OAuth 2.1 + DCR. As long as we keep custom-header auth, the server will **never** appear in Claude Desktop's Connectors UI.

**Verdict:** Switching hosts (mcphosting.io, Render, etc.) does not fix either problem. The fix is code, not platform. Cloudflare Workers + Durable Objects is the correct stack and is free for this workload.

---

## 2. Target architecture (verified against Cloudflare docs 2026-04)

```
┌────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (index.js)                              │
│                                                            │
│    new OAuthProvider({                                     │
│      apiHandlers: { "/mcp": MavenGangMCP.serve("/mcp") },  │
│      defaultHandler: loginHandler,                         │
│      authorizeEndpoint: "/authorize",                      │
│      tokenEndpoint: "/token",                              │
│      clientRegistrationEndpoint: "/register",              │
│    })                                                      │
│                                                            │
│  Routes served automatically by OAuthProvider:             │
│    GET  /.well-known/oauth-authorization-server            │
│    GET  /.well-known/oauth-protected-resource              │
│    POST /register        (RFC 7591 Dynamic Client Reg)     │
│    GET  /authorize       → defaultHandler renders login    │
│    POST /token           (PKCE S256, refresh tokens)       │
│                                                            │
│  loginHandler (your code):                                 │
│    GET  /authorize  → render MavenGang login HTML          │
│    POST /login      → call MavenGang /auth/login +         │
│                       /auth/me, then                       │
│                       OAUTH_PROVIDER.completeAuthorization │
│                       ({ props: { accessToken, ... }})     │
│                                                            │
│  MavenGangMCP (Durable Object, SQLite-backed):             │
│    class MavenGangMCP extends McpAgent {                   │
│      server = new McpServer(...)                           │
│      init() { register 10 tools using this.props }         │
│    }                                                       │
└────────────────────────────────────────────────────────────┘
                       │
                       │ per-user OAuth token = DO session
                       ▼
              One Durable Object instance per MCP session
              (hibernates when idle, free tier)
                       │
                       │ this.props.accessToken → Bearer
                       ▼
               MavenGang REST API
```

**Key properties:**
- All 6 IDEs (Claude Desktop, Claude Code CLI, Cursor, Windsurf, opencode, Codex) connect via OAuth auto-flow. No manual token paste.
- First request: browser opens to `/authorize` → user enters MavenGang email/password → redirect back with OAuth code → IDE exchanges for access token. One-time per user per IDE.
- Subsequent requests: IDE sends `Authorization: Bearer <oauth_token>`. OAuthProvider decrypts `props` from KV (end-to-end-encrypted), injects as `this.props` inside the DO.
- MavenGang access token + refresh token live in `this.props` (encrypted in OAUTH_KV). On MavenGang 401, refresh inside the DO, update props via `tokenExchangeCallback` if needed.

---

## 3. Package changes

### 3.1 Replace deps in `package.json`

**Remove:**
- `@modelcontextprotocol/server` (unusual package; replace with canonical SDK)
- `agents-sdk` (wrong package name; actual name is `agents`)
- `@cfworker/json-schema` (only needed by the removed SDK)

**Add:**
- `agents` — exports `agents/mcp` with `McpAgent`
- `@modelcontextprotocol/sdk` — exports `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `@cloudflare/workers-oauth-provider` — OAuth 2.1 + DCR helper

**Keep:** `zod`, `wrangler` (dev)

Final `package.json` dependencies section:

```json
{
  "dependencies": {
    "agents": "^0.0.x",
    "@modelcontextprotocol/sdk": "^1.x",
    "@cloudflare/workers-oauth-provider": "^0.0.x",
    "zod": "^3.23.0"
  }
}
```

(Use whatever `latest` resolves to — agent: run `npm install agents @modelcontextprotocol/sdk @cloudflare/workers-oauth-provider zod && npm uninstall @modelcontextprotocol/server agents-sdk @cfworker/json-schema`.)

### 3.2 Update `wrangler.toml`

Replace entire file with:

```toml
name = "iv-mavengang-mcp"
main = "index.js"
compatibility_date = "2025-03-10"
compatibility_flags = ["nodejs_compat"]

[vars]
BASE_URL = "https://mavengang.com/v1"

# OAuth provider KV — stores encrypted grants, client registrations, tokens
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "<RUN: npx wrangler kv namespace create OAUTH_KV --remote>"
preview_id = "<RUN: npx wrangler kv namespace create OAUTH_KV --preview --remote>"

# Legacy SESSIONS KV (existing). Keep only if we use it for shared MavenGang refresh caching.
# If not used, DELETE this block and run: npx wrangler kv namespace delete --namespace-id 3ccf96101fde4261a114beecef91987c
[[kv_namespaces]]
binding = "SESSIONS"
id = "3ccf96101fde4261a114beecef91987c"
preview_id = "86ef0e58247a4f2c9adeeead5dbbec51"

# Durable Object — one instance per MCP session, SQLite-backed, free tier
[[durable_objects.bindings]]
name = "MCP_OBJECT"
class_name = "MavenGangMCP"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MavenGangMCP"]
```

**Binding names are load-bearing** — `MCP_OBJECT` is the default `McpAgent.serve()` looks for; `OAUTH_KV` is what `@cloudflare/workers-oauth-provider` looks for. Don't rename.

Agent: before `wrangler deploy`, create the new KV namespace:
```
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create OAUTH_KV --preview
```
Paste the returned IDs into `wrangler.toml` replacing the placeholders.

---

## 4. File-by-file rewrite

### 4.1 `index.js` — full rewrite (~350 lines)

Top-level structure:

```js
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─────────── 1. MavenGang API helper ───────────
// Keep existing mgFetch() and authHeaders() logic. No changes.

async function mgFetch(path, { method = "GET", headers = {}, body, baseUrl }) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`MavenGang API ${res.status}`);
    err.status = res.status;
    try { err.data = await res.json(); } catch {}
    throw err;
  }
  return res.json();
}
const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

// ─────────── 2. Durable Object / McpAgent ───────────
export class MavenGangMCP extends McpAgent {
  server = new McpServer({
    name: "mavengang",
    version: "1.0.0",
  });

  // Called once per DO session, after OAuth completes and this.props is populated
  async init() {
    // Helper inside init() so it closes over this.props
    const apiCall = async (method, path, body = null) => {
      const baseUrl = this.env.BASE_URL;
      try {
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      } catch (err) {
        if (err.status !== 401) throw err;
        // Refresh MavenGang token
        const refreshed = await mgFetch("/auth/refresh", {
          method: "POST", baseUrl,
          body: { refreshToken: this.props.refreshToken },
        });
        this.props.accessToken = refreshed.access_token;
        this.props.refreshToken = refreshed.refresh_token;
        // Retry
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      }
    };

    const agencyId = () => this.props.agencyId;

    // ─── 10 tools — use this.server.tool() API (NOT registerTool) ───

    this.server.tool(
      "list_projects",
      {},
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects`);
        const projects = res.items.map(p => ({
          id: p.id, name: p.name, key: p.key, status: p.status,
          client: p.clients?.[0]?.name || "No client",
          category: p.category_name,
          taskTotal: p.task_total, taskCompleted: p.task_completed,
        }));
        return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
      }
    );

    this.server.tool(
      "get_project",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_tasks",
      {
        projectId: z.string(),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
        parentId: z.string().optional(),
      },
      async ({ projectId, status, parentId }) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (parentId) params.append("parent_id", parentId);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks${q}`);
        const tasks = res.items.map(t => ({
          id: t.id, taskNumber: t.task_number, title: t.title,
          description: t.description || "",
          status: t.status_name || t.status, priority: t.priority,
          assignedTo: t.assigned_user
            ? `${t.assigned_user.first_name} ${t.assigned_user.last_name}`
            : "Unassigned",
          isSubtask: !!t.parent_id, dueDate: t.due_date,
        }));
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
    );

    this.server.tool(
      "get_task",
      { projectId: z.string(), taskId: z.string() },
      async ({ projectId, taskId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task",
      {
        projectId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        parentId: z.string().optional(),
        assignedUserId: z.string().optional(),
        priority: z.number().optional(),
        dueDate: z.string().optional(),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
      },
      async ({ projectId, title, description, parentId, assignedUserId, priority, dueDate, status }) => {
        const body = { title };
        if (description) body.description = description;
        if (parentId) body.parent_id = parentId;
        if (assignedUserId) body.assigned_user_id = assignedUserId;
        if (priority !== undefined) body.priority = priority;
        if (dueDate) body.due_date = dueDate;
        if (status) body.status = status;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks`, body);
        const task = res.task;
        return {
          content: [{
            type: "text",
            text: `Task created: ${task.task_number} - "${task.title}"\nStatus: ${task.status_name}\nAssigned: ${task.assigned_user?.first_name || "Unassigned"}`,
          }],
        };
      }
    );

    this.server.tool(
      "update_task",
      {
        projectId: z.string(),
        taskId: z.string(),
        title: z.string().optional(),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
        assignedUserId: z.string().optional(),
        priority: z.number().optional(),
        dueDate: z.string().optional(),
      },
      async ({ projectId, taskId, title, status, assignedUserId, priority, dueDate }) => {
        const body = {};
        if (title) body.title = title;
        if (status) body.status = status;
        if (assignedUserId) body.assigned_user_id = assignedUserId;
        if (priority !== undefined) body.priority = priority;
        if (dueDate) body.due_date = dueDate;
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_project_members",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/members`);
        const members = (res.items || res).map(m => ({
          userId: m.user_id, firstName: m.first_name, lastName: m.last_name, role: m.role,
        }));
        return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
      }
    );

    this.server.tool(
      "get_my_tasks",
      {
        status: z.string().optional(),
        sort: z.enum(["due_date", "priority", "created_at"]).optional(),
        limit: z.number().optional(),
      },
      async ({ status, sort, limit }) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (sort) params.append("sort", sort);
        if (limit) params.append("limit", String(limit));
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/my-tasks${q}`);
        const tasks = res.items.map(t => ({
          taskNumber: t.task_number, title: t.title,
          status: t.status_name || t.status, priority: t.priority,
          dueDate: t.due_date, projectId: t.project_id, projectName: t.project_name,
        }));
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
    );

    this.server.tool(
      "add_comment",
      {
        taskId: z.string(),
        content: z.string(),
        parentId: z.string().optional(),
      },
      async ({ taskId, content, parentId }) => {
        const body = {
          entity_type: "task",
          entity_id: taskId,
          content,
          parent_id: parentId || null,
        };
        const res = await apiCall("POST", `/agencies/${agencyId()}/comments`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_comments",
      { taskId: z.string() },
      async ({ taskId }) => {
        const res = await apiCall(
          "GET",
          `/agencies/${agencyId()}/comments?entity_type=task&entity_id=${taskId}`
        );
        const comments = (res.items || []).map(c => ({
          id: c.id,
          content: c.content,
          author: c.author ? `${c.author.first_name} ${c.author.last_name}` : "Unknown",
          createdAt: c.created_at,
          parentId: c.parent_id,
        }));
        return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
      }
    );
  }
}

// ─────────── 3. Login / OAuth default handler ───────────
const loginPageHtml = (errorMsg = "", clientName = "your IDE") => `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to MavenGang</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;
       display:flex;align-items:center;justify-content:center;margin:0}
  .card{background:#fff;padding:2rem;border-radius:8px;max-width:400px;width:90%;
        box-shadow:0 2px 8px rgba(0,0,0,.1)}
  h1{margin:0 0 .5rem;font-size:1.25rem}
  p.sub{color:#666;margin:0 0 1.5rem;font-size:.9rem}
  input{width:100%;padding:.75rem;border:1px solid #ddd;border-radius:4px;
        margin-bottom:1rem;font-size:1rem;box-sizing:border-box}
  button{width:100%;padding:.75rem;background:#007bff;color:#fff;border:0;
         border-radius:4px;font-size:1rem;cursor:pointer}
  .err{background:#fee;color:#c00;padding:.75rem;border-radius:4px;margin-bottom:1rem}
</style></head><body>
<form class="card" method="POST" action="">
  <h1>Sign in to MavenGang</h1>
  <p class="sub">${clientName} is requesting access to your account.</p>
  ${errorMsg ? `<div class="err">${errorMsg}</div>` : ""}
  <input name="email" type="email" placeholder="Email" required autofocus>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const loginHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Root health check
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "iv-mavengang-mcp" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // OAuth /authorize — render login page (GET) or process credentials (POST)
    if (url.pathname === "/authorize") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);

      if (request.method === "GET") {
        // Preserve the auth request state in URL so we can recover it on POST
        const state = encodeURIComponent(JSON.stringify(oauthReq));
        const html = loginPageHtml("", clientInfo?.clientName || "your IDE")
          .replace(`action=""`, `action="/authorize?state=${state}"`);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      if (request.method === "POST") {
        const state = url.searchParams.get("state");
        const savedReq = state ? JSON.parse(decodeURIComponent(state)) : oauthReq;
        const form = await request.formData();
        const email = form.get("email");
        const password = form.get("password");

        try {
          const loginRes = await mgFetch("/auth/login", {
            method: "POST", baseUrl: env.BASE_URL,
            body: { email, password },
          });
          const meRes = await mgFetch("/auth/me", {
            baseUrl: env.BASE_URL,
            headers: authHeaders(loginRes.access_token),
          });
          const agencyId = meRes.memberships[0].agency_id;

          const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
            request: savedReq,
            userId: email,
            scope: savedReq.scope || ["mcp"],
            metadata: { email, agencyId },
            props: {
              email,
              agencyId,
              accessToken: loginRes.access_token,
              refreshToken: loginRes.refresh_token,
            },
          });
          return Response.redirect(redirectTo, 302);
        } catch (err) {
          const html = loginPageHtml("Wrong email or password", clientInfo?.clientName);
          return new Response(html, {
            status: 401,
            headers: { "Content-Type": "text/html" },
          });
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// ─────────── 4. OAuthProvider wraps everything ───────────
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandlers: {
    "/mcp": MavenGangMCP.serve("/mcp"),
  },
  defaultHandler: loginHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // Access token TTL — refresh tokens issued automatically
  accessTokenTTL: 3600,
});
```

**API correctness notes (verified against `cloudflare/agents` source):**
- Use `this.server.tool(name, schemaShape, handler)` — pass the raw zod shape object, NOT `z.object({...})`. The SDK wraps it internally.
- DO binding name is `MCP_OBJECT` (default). If you rename in wrangler.toml, also pass `{ binding: "..." }` to `serve()`.
- `McpAgent.serve("/mcp")` returns a plain fetch handler that OAuthProvider can mount under `apiHandlers`.
- `env.OAUTH_PROVIDER` is the helper object injected by `@cloudflare/workers-oauth-provider` at runtime — do NOT instantiate it yourself inside the handler.
- `completeAuthorization` returns `{ redirectTo }` — always use `Response.redirect(redirectTo, 302)` (not 301).
- OAuthProvider auto-serves `.well-known/oauth-authorization-server`, `.well-known/oauth-protected-resource`, `/register` (DCR), `/token`. Do not implement these manually.
- `this.props` is set automatically from the `props` passed to `completeAuthorization`. Available inside `init()` and every tool. End-to-end encrypted in OAUTH_KV.

### 4.2 Delete `session-store.js`

No longer used. OAuthProvider handles token storage (encrypted in OAUTH_KV). Remove the file and its imports.

### 4.3 Delete `config/` directory if present

Anything in `config/` was for the old custom-header auth. Remove if unused after rewrite.

### 4.4 Keep `API_CONTRACT.md`

No changes — documents MavenGang API endpoints, still accurate.

### 4.5 `.gitignore`

Ensure contains: `node_modules/`, `.wrangler/`, `.env`, `.dev.vars`, `.claude/`

---

## 5. README.md — what to change

### 5.1 Sections to **replace**

**Replace the "How It Works" diagram** with:

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

Text update: "Each teammate connects their IDE via OAuth. On first connect, a browser opens to a MavenGang login page. After sign-in, the IDE caches a long-lived token. All API calls use the teammate's own MavenGang credentials."

### 5.2 Replace "Quick Start" entirely

Delete the `x-session-key` / "paste session key" references. New setup per IDE:

```markdown
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
{ "mcpServers": { "mavengang": { "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp" } } }
```
First use opens browser.

### Windsurf
`~/.codeium/windsurf/mcp_config.json`:
```json
{ "mcpServers": { "mavengang": { "serverUrl": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp" } } }
```

### opencode
`~/.config/opencode/opencode.json`:
```json
{ "$schema": "https://opencode.ai/config.json",
  "mcp": { "mavengang": { "type": "remote", "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp", "enabled": true } } }
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
{ "command": "npx", "args": ["-y", "mcp-remote", "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"] }
```
```

### 5.3 Delete these sections

- Anything mentioning `x-session-key`
- The `/login` HTML page copy-paste JSON UI instructions
- "Session key" FAQ entries

### 5.4 Keep these sections

- Available Tools table (10 tools, unchanged)
- Self-hosting / Fork instructions (update env names: KV becomes OAUTH_KV; add DO migration note)
- Contributing / PR welcome

---

## 6. PLAN.md — update

Replace the "Auth model" and "Architecture" sections:

- **Auth model:** OAuth 2.1 with Dynamic Client Registration (RFC 7591). MavenGang email/password is the upstream identity. Access tokens are short-lived (1 hour), refresh tokens long-lived (30 days). No manual token copy-paste.
- **Architecture:** Cloudflare Worker → OAuthProvider → DO (`McpAgent`) per session → MavenGang API. One DO instance per OAuth grant. SQLite-backed, hibernates when idle.
- **Storage:** `OAUTH_KV` (encrypted grants/clients/tokens, managed by OAuthProvider) + DO SQLite (per-session state, optional). Legacy `SESSIONS` KV removed.

Delete the "session key" / "/login page table" sections entirely.

---

## 7. Verification (run after every change batch)

### 7.1 Local dev
```bash
npm install
npx wrangler dev
```
Expected: worker starts, logs show binding `MCP_OBJECT` and `OAUTH_KV`.

### 7.2 Deploy
```bash
npx wrangler kv namespace create OAUTH_KV
# paste returned id into wrangler.toml
npx wrangler deploy
```
Expected: "Deployed iv-mavengang-mcp triggers" with URL.

### 7.3 OAuth discovery endpoints (must return 200 JSON)
```bash
curl https://iv-mavengang-mcp.jezeem-dev.workers.dev/.well-known/oauth-authorization-server
curl https://iv-mavengang-mcp.jezeem-dev.workers.dev/.well-known/oauth-protected-resource
```

### 7.4 Unauthenticated MCP must return 401 with WWW-Authenticate
```bash
curl -i -X POST https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```
Expected: `HTTP/2 401` + header `WWW-Authenticate: Bearer resource_metadata="https://.../.well-known/oauth-protected-resource"`

### 7.5 DCR smoke test
```bash
curl -X POST https://iv-mavengang-mcp.jezeem-dev.workers.dev/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"test","redirect_uris":["http://localhost:9999/callback"]}'
```
Expected: 201 JSON with `client_id`, `client_secret`.

### 7.6 Real IDE tests (in order of confidence)
1. **Claude Code CLI** — `claude mcp remove mavengang -s user && claude mcp add mavengang --transport http -s user -- https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp`. Browser should open. After login, `claude mcp list` shows ✓ Connected.
2. **Cursor** — update `~/.cursor/mcp.json` (URL only, remove `headers`). Restart Cursor. Settings → MCP shows mavengang with 10 tools.
3. **Claude Desktop Mac** — Settings → Connectors → Add custom connector → paste URL → complete OAuth. Tools show in the Connectors panel.
4. **Windsurf, opencode, Codex** — update each config file, remove any `headers` with `x-session-key`, keep URL only. Restart each.

If any IDE fails OAuth, fall back to `mcp-remote` bridge (see README section 5.2).

### 7.7 Tool execution test (from any connected IDE)
Prompt: "list my mavengang projects". Expect the list. Prompt: "what tasks are on my plate". Expect tasks.

---

## 8. Commit strategy (for the executing agent)

One commit per logical step, in this order:
1. `feat: add agents + workers-oauth-provider, remove old MCP SDK`
2. `feat: add Durable Object binding + migrations to wrangler.toml`
3. `feat: rewrite index.js around McpAgent + OAuthProvider`
4. `chore: delete session-store.js (replaced by OAuthProvider KV)`
5. `docs: update README for OAuth setup across all 6 IDEs`
6. `docs: update PLAN.md auth + architecture sections`

Push to GitHub after each commit. Deploy (`npx wrangler deploy`) only after commit #3 is in.

---

## 9. Known corrections from prior attempts (do NOT repeat)

- `registerTool` **is not** the Cloudflare agents API. Use `this.server.tool(name, shape, handler)`.
- `@modelcontextprotocol/server` package is alpha and obsolete for this use case. Use `@modelcontextprotocol/sdk`.
- `agents-sdk` is a wrong/unrelated npm name. Correct is `agents`.
- Do NOT use `sessionIdGenerator: undefined` (stateless mode). `McpAgent` handles sessions via DOs.
- Do NOT keep the old `x-session-key` code path. OAuth is the single auth mechanism. Simpler, works in all 6 IDEs.
- Binding names are not arbitrary — `MCP_OBJECT` and `OAUTH_KV` are defaults the libraries look for.
- `compatibility_date` must be 2024-09-23 or later for `McpAgent` hibernation to work cleanly. Use `2025-03-10` (matches Cloudflare template).

---

## 10. Rough line counts to expect

- `index.js`: ~350 lines (down from ~672; OAuthProvider absorbs login/rate-limit/CORS/well-known logic)
- `wrangler.toml`: ~25 lines
- `package.json`: unchanged structure, 4 deps changed
- `README.md`: ~150 lines (down from current; simpler setup)
- `session-store.js`: deleted (was 40 lines)
