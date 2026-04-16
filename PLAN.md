# MavenGang MCP Server — Build Plan

## Context

MavenGang is a project management tool used by our team. The backend API is live at `https://mavengang.com/v1`. This MCP server wraps that API so teammates can interact with projects and tasks directly from AI coding tools (Claude Code, Cursor, opencode) without context switching.

**Repo:** `https://github.com/jezeem/iv-mavengang-mcp`
**Stack:** Node.js ESM (`"type": "module"`)
**MCP SDK:** `@modelcontextprotocol/sdk` + `agents` (Cloudflare McpAgent)
**Hosting:** Cloudflare Workers + Durable Objects (free tier)

---

## Auth Model

**OAuth 2.1 with Dynamic Client Registration (RFC 7591).**

MavenGang email/password is the upstream identity. Access tokens are short-lived (1 hour), refresh tokens long-lived (30 days). No manual token copy-paste.

### Architecture

```
Cloudflare Worker → OAuthProvider → DO (McpAgent) per session → MavenGang API
                     │
                     └─ OAUTH_KV (encrypted grants/clients/tokens)
```

- One DO instance per OAuth grant
- SQLite-backed, hibernates when idle (free tier)
- `this.props` contains `{ accessToken, refreshToken, agencyId, email }`

### Login flow (one-time per IDE)

1. IDE connects to `https://.../mcp`
2. Browser opens to `/authorize` → user enters MavenGang email/password
3. Server validates credentials, stores OAuth tokens in OAUTH_KV
4. IDE exchanges auth code for access token (cached locally)
5. Subsequent calls use Bearer token in Authorization header

### Token refresh

On MavenGang 401 → refresh inside the DO, update props via OAuthProvider.

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
- `parentId` (string, optional — pass to get subtasks)

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
- `parentId` (string, optional — makes it a subtask)
- `assignedUserId` (string, optional)
- `priority` (number, optional)
- `dueDate` (ISO string, optional)
- `status` (enum: todo | in_progress | in_qa | done, optional)

**Returns:** created task with id, taskNumber

---

### 6. `update_task`
**Purpose:** Update task status, assignee, priority, title, or due date.
**API:** `PATCH /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}`
**Input:**
- `projectId` (string, required)
- `taskId` (string, required)
- `title` (string, optional)
- `status` (enum: todo | in_progress | in_qa | done, optional)
- `assignedUserId` (string, optional)
- `priority` (number, optional)
- `dueDate` (ISO string, optional)

**Returns:** updated task object

---

### 7. `list_project_members`
**Purpose:** List members of a project with their roles and user IDs (needed for assignment).
**API:** `GET /agencies/{agencyId}/projects/{projectId}/members`
**Input:**
- `projectId` (string, required)

**Returns:** userId, firstName, lastName, role

---

### 8. `get_my_tasks`
**Purpose:** Get all tasks assigned to the current user across all projects.
**API:** `GET /agencies/{agencyId}/my-tasks`
**Input:**
- `status` (string, optional)
- `sort` (enum: due_date | priority | created_at, optional)
- `limit` (number, optional)

**Returns:** taskNumber, title, status, priority, dueDate, projectId, projectName

---

### 9. `add_comment`
**Purpose:** Add a comment to a task.
**API:** `POST /agencies/{agencyId}/comments`
**Input:**
- `taskId` (string, required)
- `content` (string, required)
- `parentId` (string, optional — for threaded replies)

**Returns:** comment id

---

### 10. `list_comments`
**Purpose:** List comments on a task.
**API:** `GET /agencies/{agencyId}/comments?entity_type=task&entity_id={taskId}`
**Input:**
- `taskId` (string, required)

**Returns:** id, content, author, createdAt, parentId

---

## Storage

- **OAUTH_KV** — encrypted grants, client registrations, tokens (managed by OAuthProvider)
- **DO SQLite** — per-session state (optional)
- **SESSIONS** — legacy KV (kept for backwards compatibility, not used in new flow)

---

## Project Structure

```
iv-mavengang-mcp/
├── index.js               # MCP server (Cloudflare Workers + OAuthProvider)
├── wrangler.toml          # Cloudflare Workers config (DO + KV)
├── package.json
├── API_CONTRACT.md        # MavenGang API documentation
├── PLAN.md                # This file
└── README.md
```

---

## Deployment

**Cloudflare Workers (free tier).**

- Deployed via `npx wrangler deploy`
- Public URL: `https://iv-mavengang-mcp.<account>.workers.dev`
- Local dev: `npx wrangler dev`
- GitHub repo: `https://github.com/jezeem/iv-mavengang-mcp`

### Setup steps
1. Create free Cloudflare account at `dash.cloudflare.com`
2. `npm install -g wrangler`
3. `wrangler login`
4. Create KV namespace: `npx wrangler kv namespace create OAUTH_KV`
5. Add DO + migrations in wrangler.toml
6. `npx wrangler dev` for local testing
7. `npx wrangler deploy` to go live

---

## V2 Scope

- Additional tools: `start_timer`, `stop_timer`, `list_milestones`, `get_my_notifications`
- Custom domain instead of `*.workers.dev`