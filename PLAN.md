# MavenGang MCP Server — Build Plan

## Context

MavenGang is a full-featured project management tool used internally by our team. The backend API is fully live at `https://mavengang.com/v1`. This MCP server wraps that API so teammates can interact with their projects and tasks directly from AI coding tools (Claude Code, Cursor, opencode) without switching context.

**Repo:** `~/Desktop/mavengang-mcp`  
**Stack:** Node.js ESM (`"type": "module"` in package.json)  
**MCP SDK:** `@modelcontextprotocol/server`  
**HTTP client:** `axios`  
**Validation:** `zod`

---

## Current State

| File | What it is | Status |
|------|-----------|--------|
| `index.js` | Express REST proxy — NOT MCP | legacy, ignore |
| `mcp-server.js` | MCP server, stdio transport | working locally |

`mcp-server.js` has 3 tools: `list_projects`, `list_tasks`, `create_task`.  
Transport is **stdio** — runs as a subprocess on each user's machine. Not shareable.

---

## Goal

Build `mcp-server-http.js` — same tools as `mcp-server.js` but with **HTTP transport (Streamable HTTP / SSE)** so it can be hosted on a single server and shared with the whole team. Teammates point their MCP config to one URL.

Local stdio version (`mcp-server.js`) stays intact for personal use until hosting is ready.

---

## Auth Model

MavenGang uses **Bearer JWT**. All endpoints scoped to `/v1/agencies/{agencyId}/...`.

### Per-user session architecture

Each teammate has their own session. No shared credentials. The server stores one token entry per user:

```js
{
  session_key: "abc123xyz",     // random UUID — what user puts in their MCP config
  access_token: "jwt...",       // MavenGang JWT for API calls
  refresh_token: "jwt...",      // for silent auto-refresh
  agency_id: "cuid",            // needed for every scoped API call
  email: "john@company.com"     // for display / debugging
}
```

### Login flow (one-time per teammate)

1. Teammate goes to `https://your-server/login` (hosted web page)
2. Enters their MavenGang **email** and **password**
3. Server calls `POST /auth/login` → gets `access_token` + `refresh_token`
4. Server calls `GET /auth/me` → gets `agency_id` + name
5. Server generates a `session_key` (random UUID), stores the full entry above
6. Page shows success + `session_key` to copy

```
✅ Logged in as John

Copy this into your MCP config:
┌──────────────────────────────────────────┐
│ "x-session-key": "abc123xyz"             │
└──────────────────────────────────────────┘
[ Copy ]
```

On wrong credentials → show "Wrong email or password. Try again." — no technical jargon.

### What the login success page shows

After successful login, page displays:

**1. Ready-to-copy JSON config block**
```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://your-server/mcp",
      "headers": {
        "x-session-key": "abc-123-uuid"
      }
    }
  }
}
```
With a `[ Copy ]` button.

**2. IDE config file location table**

| Tool | Config file |
|------|------------|
| Claude Code | `~/.claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| opencode | `~/.config/opencode/config.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` in workspace |

**3. Instruction line**
> Paste the JSON into your IDE's config file, restart your IDE. Done.

No Slack needed. No manual help needed. Self-contained onboarding.

### On every MCP tool call

Server reads `x-session-key` header → looks up session → uses stored `access_token` + `agency_id` to call MavenGang API as that user.

### Token auto-refresh

MavenGang tokens expire. Server handles this silently:
- On `401` from MavenGang API → call `POST /auth/refresh` with `refresh_token`
- Get new `access_token` + `refresh_token`, update stored session
- Retry original request
- MavenGang has rotation + reuse detection built in — secure by default

Teammate never gets randomly logged out.

### IDE config (after getting session key)

```json
{
  "mcpServers": {
    "mavengang": {
      "transport": "http",
      "url": "https://your-hosted-url/mcp",
      "headers": {
        "x-session-key": "abc123xyz"
      }
    }
  }
}
```

Same config format works in Claude Code, Cursor, and opencode.

---

## API Base

```
Base URL: https://mavengang.com/v1
Auth header: Authorization: Bearer <token>
All endpoints scoped to: /agencies/{agencyId}/...
```

---

## V1 Tools — 10 Tools

These cover daily team usage. All accessible to `staff`, `manager`, `admin` roles.

---

### 1. `list_projects`
**Purpose:** List all projects in the agency.  
**API:** `GET /agencies/{agencyId}/projects`  
**Input:** none  
**Returns:** id, name, key, status, client, category, taskTotal, taskCompleted

---

### 2. `get_project`
**Purpose:** Get details of a single project.  
**API:** `GET /agencies/{agencyId}/projects/{projectId}`  
**Input:**
- `projectId` (string, required)

**Returns:** full project object

---

### 3. `list_tasks`
**Purpose:** List tasks in a project. Supports filtering and subtask listing.  
**API:** `GET /agencies/{agencyId}/projects/{projectId}/tasks`  
**Input:**
- `projectId` (string, required)
- `status` (enum: todo | in_progress | in_qa | done, optional)
- `assigned_user_id` (string, optional)
- `parent_id` (string, optional — pass to get subtasks of a task)
- `top_level_only` (boolean, optional, default true)

**Returns:** id, taskNumber, title, status, priority, assignedTo, dueDate, isSubtask

---

### 4. `get_task`
**Purpose:** Get full details of a single task including description.  
**API:** `GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}`  
**Input:**
- `projectId` (string, required)
- `taskId` (string, required)

**Returns:** full task object

---

### 5. `create_task`
**Purpose:** Create a task or subtask in a project.  
**API:** `POST /agencies/{agencyId}/projects/{projectId}/tasks`  
**Input:**
- `projectId` (string, required)
- `title` (string, required)
- `description` (string, optional)
- `parent_id` (string, optional — makes it a subtask)
- `assigned_user_id` (string, optional)
- `priority` (number, optional — 0=none, 1=low, 2=medium, 3=high)
- `due_date` (ISO string, optional)
- `status` (enum: todo | in_progress | in_qa | done, optional, default: todo)

**Returns:** created task with id, taskNumber, link to task on MavenGang

---

### 6. `update_task`
**Purpose:** Update task status, assignee, priority, title, or due date.  
**API:** `PATCH /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}`  
**Input:**
- `projectId` (string, required)
- `taskId` (string, required)
- `title` (string, optional)
- `status` (enum: todo | in_progress | in_qa | done, optional)
- `assigned_user_id` (string, optional)
- `priority` (number, optional)
- `due_date` (ISO string, optional)

**Note:** Changing `parent_id` (re-parenting a subtask) is not supported in v1.

**Returns:** updated task object

---

### 7. `list_project_members`
**Purpose:** List members of a project with their roles and user IDs (needed for assignment).  
**API:** `GET /agencies/{agencyId}/projects/{projectId}/members`  
**Input:**
- `projectId` (string, required)

**Returns:** userId, firstName, lastName, role (MANAGER | CONTRIBUTOR | VIEWER)

---

### 8. `get_my_tasks`
**Purpose:** Get all tasks assigned to the current user across all projects. Great for daily standup / what's on my plate.  
**API:** `GET /agencies/{agencyId}/my-tasks`  
**Input:**
- `status` (string, optional — comma-separated: e.g. `todo,in_progress`)
- `sort` (enum: due_date | priority | created_at, optional)
- `limit` (number, optional, default 20, max 100)

**Returns:** taskNumber, title, status, priority, dueDate, projectId, projectName

---

### 9. `add_comment`
**Purpose:** Add a comment to a task.  
**API:** `POST /agencies/{agencyId}/comments`  
**Input:**
- `taskId` (string, required)
- `content` (string, required)
- `parent_id` (string, optional — for threaded replies)

**Body sent to API:**
```json
{ "entity_type": "task", "entity_id": "<taskId>", "content": "<content>", "parent_id": null }
```

**Returns:** comment id, content, created_at

---

### 10. `list_comments`
**Purpose:** List comments on a task.  
**API:** `GET /agencies/{agencyId}/comments?entity_type=task&entity_id={taskId}`  
**Input:**
- `taskId` (string, required)

**Returns:** id, content, author (firstName + lastName), created_at, parent_id

---

## File to Create

**`mcp-server-http.js`**

This is the new file. Do NOT modify `mcp-server.js`.

### Transport

Use `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`.

The server listens on `POST /mcp` for MCP requests and `GET /mcp` for SSE.

### Auth Flow

Per-user sessions as defined in the **Auth Model** section above. Server does NOT have its own MavenGang credentials. Each user authenticates via `/login` and uses their own `x-session-key` header on every MCP request.

### Port

Default `3001` (so it doesn't conflict with `index.js` on 3000).

### package.json script to add

```json
"start:http": "node mcp-server-http.js"
```

---

## Environment Variables

`.env` for the HTTP server (no shared credentials):

```env
BASE_URL=https://mavengang.com/v1
PORT=3001
SESSION_SECRET=<random-32-char-string>   # used to hash session keys in storage
```

`EMAIL` and `PASSWORD` only exist in `mcp-server.js` (stdio local server). HTTP server gets credentials per-user via `/login`.

---

## Session Storage

**Cloudflare KV from day 1.**
- Key: `session:<sha256(session_key)>`
- Value: JSON of session entry
- TTL: 30 days (refreshed on each use)

Wrap in a small abstraction (`getSession`, `saveSession`, `deleteSession`) for testability.

---

## /login Endpoint Spec

### GET /login
Serves a static HTML page with the login form. Form submits to `POST /login`.

### POST /login
**Request:**
```json
{ "email": "user@example.com", "password": "..." }
```

**Success `200`:**
```json
{
  "session_key": "uuid-here",
  "email": "user@example.com",
  "agency_name": "Incredible Visibility"
}
```

**Failure `401`:**
```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Wrong email or password" } }
```

**Server flow:**
1. Receives `email` + `password`
2. Calls MavenGang `POST /auth/login` → `access_token` + `refresh_token`
3. Calls MavenGang `GET /auth/me` → `agency_id` + name
4. Generates `session_key = crypto.randomUUID()`
5. Stores hash + session entry: `sessionStore.save(sha256(session_key), entry)`
6. Returns plaintext `session_key` to user (only time it is ever sent)

**Rate limiting:** 5 attempts per IP per 15 min. Return `429` if exceeded.

### POST /logout
**Header:** `x-session-key: <key>`
**Action:** `sessionStore.delete(sha256(key))`
**Response:** `200 { "ok": true }`

---

## Multiple Agency Memberships

MavenGang `GET /auth/me` returns `memberships[]`. For v1:
- Use `memberships[0]` (first one)
- If `memberships.length > 1`, log a warning server-side

V2: login page shows agency picker if user has multiple memberships, stores chosen `agency_id` in session.

---

## Error Response Format

Every tool returns errors in this shape (wrapped in MCP tool response):

```json
{ "error": { "code": "STRING", "message": "human-readable" } }
```

**Standard error codes:**
| Code | When |
|------|------|
| `SESSION_INVALID` | `x-session-key` missing, bad, or expired (user must re-login) |
| `MAVENGANG_AUTH_FAILED` | Refresh also failed, session dead |
| `UPSTREAM_ERROR` | MavenGang API returned 5xx or network error |
| `NOT_FOUND` | Resource ID doesn't exist |
| `VALIDATION_ERROR` | Bad input params (zod fail) |
| `FORBIDDEN` | User lacks role permission |

---

## MCP Protocol Session vs Auth Session

MCP Streamable HTTP has its own `Mcp-Session-Id` header, managed by the SDK. It is separate from our `x-session-key`. Both coexist with no conflict. The SDK handles `Mcp-Session-Id` automatically; we only read `x-session-key` in our auth middleware.

---

## CORS

For v1 (internal team):
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type, x-session-key, Mcp-Session-Id
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

Tighten to specific origins in v2.

---

## Security

- **HTTPS required** in production. Session key travels as a header — must not be sent over plain HTTP.
- **Session keys** generated via `crypto.randomUUID()`.
- **Storage:** store `sha256(session_key)` in the session store, never the raw key. On lookup, hash incoming key and compare. Same pattern as password hashing — if storage leaks, session keys are not exposed.
- `.env` must be in `.gitignore`.
- No logging of `access_token`, `refresh_token`, or `session_key` (full). Log only first 6 chars for debugging if needed.

---

## MCP Client Config (for teammates, after hosting)

### Claude Code / claude_desktop_config.json
```json
{
  "mcpServers": {
    "mavengang": {
      "transport": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Replace `localhost:3001` with hosted URL when deployed.

---

## Deployment Target

**Cloudflare Workers + KV from day 1.**

- Code runs on Cloudflare Workers (not local Node)
- Use `wrangler` CLI to deploy
- Session data stored in Cloudflare KV namespace
- Public URL: `https://mavengang-mcp.<account>.workers.dev` (or custom domain later)
- Team members use that URL for `/login` and MCP config

Local dev: `wrangler dev` runs the Worker locally for testing, with a preview KV namespace.

---

## V2 Scope (after v1 is working)

- Agency picker on login page for multi-agency users
- Slack bot integration on same server
- Additional tools: `start_timer`, `stop_timer`, `list_milestones`, `get_my_notifications`
- Tighten CORS to specific origins
- Custom domain instead of `*.workers.dev`

---

## Notes

- All IDs are CUIDs (strings)
- Timestamps are ISO 8601 UTC
- Pagination uses `cursor` + `limit` — for v1 just use default limit (20), no need to implement cursor pagination in tools
- `client` role users cannot create/update tasks — not a concern for this MCP (team members only)
- QA status (`in_qa`) only works if QA stage is enabled on the project
