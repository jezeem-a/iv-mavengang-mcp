# MCP Tools Complete Analysis

## vs API Contract — v1

**Analysis Date:** 2026-04-19 (revised)
**MCP Server:** iv-mavengang-mcp (Cloudflare Workers)
**API Contract:** API_CONTRACT.md (v1, 2026-04-02)
**Source File:** [index.js](index.js)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total MCP Tools | 10 |
| API Endpoint Groups Covered | 4 (Projects, Tasks, Members, Comments) |
| Critical Bugs | 5 (auth/state + security) |
| Schema Mismatches | 6 |
| Missing Features (params) | 14 |
| Gap Endpoint Groups | 10 |
| Security Issues | 3 (XSS, unsigned state, PII logging) |

---

## Tool-by-Tool Analysis

### 1. list_projects

**API Endpoint:** `GET /agencies/{agencyId}/projects`
**Status:** ⚠️ Partial Implementation

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | `limit`, `cursor`, `client_id`, `status`, `search` - Can't paginate, filter by client/status, or search |
| Schema mismatch | 🟠 | `p.key` - No `key` field in API Contract section 5.1 Project Model |
| Schema mismatch | 🟠 | `p.category_name` - Not in API Contract |
| Schema mismatch | 🟠 | `p.task_total`, `p.task_completed` - Not in API Contract |
| Null safety | 🟠 | `p.clients?.[0]?.name` - assumes array, may fail |

**Current code (lines 56-68):**
```javascript
const projects = res.items.map(p => ({
  id: p.id, name: p.name, key: p.key, status: p.status,
  client: p.clients?.[0]?.name || "No client",
  category: p.category_name,
  taskTotal: p.task_total, taskCompleted: p.task_completed,
}));
```

**Recommended fix:**
```javascript
const projects = res.items.map(p => ({
  id: p.id,
  name: p.name,
  status: p.status,
  client: p.clients?.[0]?.name || null,
  // Remove: key, category_name, task_total, task_completed
}));
```

---

### 2. get_project

**API Endpoint:** `GET /agencies/{agencyId}/projects/{projectId}`
**Status:** ⚠️ Incomplete

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | None needed |
| Output | 🟢 | Returns full raw API response - OK but could be cleaner for AI |
| Schema mismatch | 🟠 | Potential - returns full object, may contain unexpected fields |

---

### 3. list_tasks

**API Endpoint:** `GET /agencies/{agencyId}/projects/{projectId}/tasks`
**Status:** ⚠️ Missing Critical Filters

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | `assigned_user_id` - Can't filter by assignee |
| Missing params | 🟡 | `milestone_id` - Can't filter by milestone |
| Missing params | 🟡 | `top_level_only` - Default is `true` per contract, but no way to get ALL tasks |
| Missing params | 🟡 | `limit`, `cursor` - No pagination |
| Schema mismatch | 🟠 | `t.status_name` - API Contract returns `status`, not `status_name` |
| Schema mismatch | 🟠 | `t.assigned_user` as object - Contract doesn't define structure |

**Current code (lines 82-106):**
```javascript
const tasks = res.items.map(t => ({
  id: t.id, taskNumber: t.task_number, title: t.title,
  description: t.description || "",
  status: t.status_name || t.status, priority: t.priority,
  assignedTo: t.assigned_user
    ? `${t.assigned_user.first_name} ${t.assigned_user.last_name}`
    : "Unassigned",
  isSubtask: !!t.parent_id, dueDate: t.due_date,
}));
```

---

### 4. get_task

**API Endpoint:** `GET /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}`
**Status:** ✅ OK (prior "critical bug" claim was incorrect — `projectId` IS in schema and IS used in URL at [index.js:113](index.js:113))

| Issue | Severity | Detail |
|-------|----------|--------|
| Output | 🟢 | Returns full raw response — OK |
| UX | 🟡 | Could note in description that `projectId` must match the task's project |

---

### 5. create_task

**API Endpoint:** `POST /agencies/{agencyId}/projects/{projectId}/tasks`
**Status:** ⚠️ Missing Fields

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | `milestone_id` - Can't assign task to milestone |
| Missing params | 🟡 | `estimated_hours` - No time estimation |
| Missing params | 🟡 | `start_date` - Can't set start date |
| Output | 🟢 | Good transformation with confirmation |

**API Contract fields (section 7):**
```json
{
  "title": "string",           // ✓ implemented
  "description": "string",    // ✓ implemented
  "milestone_id": "cuid | null",   // ✗ MISSING
  "assigned_user_id": "cuid | null",  // ✓ implemented
  "parent_id": "cuid | null",        // ✓ implemented
  "status": "todo | in_progress | in_qa | done",  // ✓ implemented
  "priority": 0,              // ✓ implemented
  "estimated_hours": 0,       // ✗ MISSING
  "start_date": "iso | null", // ✗ MISSING
  "due_date": "iso | null"   // ✓ implemented
}
```

---

### 6. update_task

**API Endpoint:** `PATCH /agencies/{agencyId}/projects/{projectId}/tasks/{taskId}`
**Status:** ⚠️ Missing Fields

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | `milestone_id` - Can't reassign milestone |
| Missing params | 🟡 | No `description` update - Can't change description |
| Output | 🟠 | Returns raw JSON - could be cleaner |

---

### 7. list_project_members

**API Endpoint:** `GET /agencies/{agencyId}/projects/{projectId}/members`
**Status:** ⚠️ Schema Uncertainty

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | No query params supported |
| Schema mismatch | 🟠 | Assumes `res.items || res` - API contract doesn't define wrapper |
| Schema mismatch | 🟠 | Maps `userId`, `firstName`, `lastName`, `role` - contract doesn't define structure |

**Current code (lines 174-185):**
```javascript
const members = (res.items || res).map(m => ({
  userId: m.user_id, firstName: m.first_name, lastName: m.last_name, role: m.role,
}));
```

---

### 8. get_my_tasks

**API Endpoint:** `GET /agencies/{agencyId}/my-tasks`
**Status:** ⚠️ Missing Pagination

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing params | 🟡 | `cursor` - Can't paginate results |
| Schema mismatch | 🟠 | `t.status_name` - Contract returns `status`, not `status_name` |

**API Contract (section 15, line 1592):**
```
Query: status (comma-separated), sort (due_date | priority | created_at), cursor, limit
```

Current tool has: `status`, `sort`, `limit` — missing `cursor` ❌

---

### 9. add_comment

**API Endpoint:** `POST /agencies/{agencyId}/comments`
**Status:** ⚠️ Context Uncertainty

| Issue | Severity | Detail |
|-------|----------|--------|
| Missing context | 🟡 | Uses `agencyId()` from OAuth session, but task belongs to a project which belongs to an agency. No validation that task.project_id matches agencyId |
| Schema | 🟠 | Good - matches contract |

**Current code (lines 211-228):**
```javascript
const body = {
  entity_type: "task",
  entity_id: taskId,
  content,
  parent_id: parentId || null,
};
const res = await apiCall("POST", `/agencies/${agencyId()}/comments`, body);
```

**Note:** Works because agencyId is derived from user's membership during OAuth. This is acceptable.

---

### 10. list_comments

**API Endpoint:** `GET /agencies/{agencyId}/comments`
**Status:** ⚠️ Same as add_comment

| Issue | Severity | Detail |
|-------|----------|--------|
| Output | 🟠 | Good transformation |

---

## Critical Bugs Summary

| # | Area | Issue | Severity | Action |
|---|------|-------|----------|--------|
| 1 | get_task | Earlier "missing projectId" claim was wrong — schema has it | ✅ | None |
| 2 | create_task | Missing `milestone_id`, `estimated_hours`, `start_date` | 🟡 | Add params |
| 3 | all list_* | No pagination (`cursor`, `limit`) | 🟡 | Add cursor param |
| 4 | apiCall refresh | Mutates `this.props` only in-memory; OAuthProvider KV keeps stale tokens → next agent instance loops on 401 | 🔴 | Persist refreshed tokens via OAuthProvider props update |
| 5 | apiCall refresh | Concurrent 401s trigger parallel refresh; single-use refresh tokens get burned | 🔴 | Mutex / single-flight refresh |
| 6 | OAuth state | `oauthReq` round-tripped unsigned via URL `state` param — tamperable (clientId / redirect_uri swap pre-POST) | 🔴 | Sign or store server-side keyed by opaque id |
| 7 | Login HTML | `clientName` and `errorMsg` interpolated into HTML without escaping → XSS via malicious DCR client name | 🔴 | HTML-escape all interpolations |
| 8 | Login flow | `meRes.memberships[0].agency_id` crashes if user has no memberships; no multi-agency selection | 🟠 | Validate, prompt selection or surface error |

---

## Additional Findings (revision 2026-04-19)

### Auth & State

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| A1 | [index.js:31-51](index.js:31) `apiCall` | Refresh writes new tokens to `this.props` but never persists. McpAgent restart / new instance reads original (stale) token from OAuthProvider KV → re-401 → re-refresh → eventually refresh token revoked. | 🔴 |
| A2 | [index.js:39-50](index.js:39) | No single-flight on refresh. N parallel tool calls hitting 401 all POST `/auth/refresh` with the same refresh token; only first succeeds, others kill the session. | 🔴 |
| A3 | [index.js:39](index.js:39) | Only retries on 401; never retries transient 5xx / network errors. | 🟡 |
| A4 | [index.js:40-43](index.js:40) | If `/auth/refresh` itself fails, the original 401 is swallowed and a fresh error from refresh is thrown — confusing for AI clients. | 🟡 |
| A5 | [index.js:365](index.js:365) | `meRes.memberships[0].agency_id` — crashes on empty memberships array; silently ignores additional agencies. No way for user to pick agency. | 🟠 |
| A6 | OAuthProvider config | `accessTokenTTL: 3600` but MavenGang's underlying access token TTL is independent. Mismatch can cause MCP token still valid while upstream expired (handled by refresh) or vice-versa. Document expectation. | 🟢 |

### Security

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| S1 | [index.js:273-274](index.js:273) | `${clientName}` and `${errorMsg}` interpolated raw into login HTML. `clientName` comes from OAuth Dynamic Client Registration → attacker-controllable → stored XSS in the consent screen. | 🔴 |
| S2 | [index.js:329](index.js:329) | OAuth `oauthReq` (clientId, redirectUri, scope, state, PKCE) round-tripped through unsigned `state` URL param. Tamperable between GET render and POST submit — a MITM/active attacker can swap `redirectUri` post-consent. | 🔴 |
| S3 | [index.js:301,354,359,366,379,382](index.js:301) | `console.log` emits user email and OAuth params on every request. PII in Workers logs. | 🟠 |
| S4 | [index.js:238](index.js:238) `list_comments` | `taskId` interpolated into query string with no `encodeURIComponent`. Low risk (caller-supplied UUID) but breaks if id ever contains `&` or `#`. | 🟡 |

### Tool Correctness (beyond original analysis)

| # | Tool | Location | Issue | Severity |
|---|------|----------|-------|----------|
| T1 | update_task | [index.js:162-169](index.js:162) | If caller passes only `projectId` + `taskId`, sends `PATCH {}`. Should require ≥1 mutable field or short-circuit. | 🟠 |
| T2 | create_task / update_task | [index.js:131-138, 162-168](index.js:131) | Falsy checks (`if (dueDate)`) silently drop empty strings. Cannot **clear** a `dueDate` / `assignedUserId` — need explicit null-passing semantics. | 🟠 |
| T3 | add_comment | [index.js:224](index.js:224) | Always sends `parent_id: null` when not a reply. Verify contract accepts `null` vs requiring field omission. | 🟡 |
| T4 | get_my_tasks | [index.js:191](index.js:191) | `status: z.string()` — no enum validation, comma-separated semantics undocumented in the tool description. | 🟡 |
| T5 | get_my_tasks | [index.js:205](index.js:205) | Returns `t.project_name` — not in API_CONTRACT Task model (section 7). Likely `undefined`. Verify or remove. | 🟠 |
| T6 | list_projects / list_tasks / get_my_tasks | [index.js:61, 95, 202](index.js:61) | `res.items.map(...)` crashes if API returns `{items: null}` or error-shaped body. Guard with `(res.items || [])`. | 🟡 |
| T7 | list_tasks | [index.js:84-93](index.js:84) | API contract default `top_level_only=true`. Tool exposes no override → cannot fetch ALL tasks (top-level + subtasks) in one call. | 🟡 |
| T8 | list_tasks | [index.js:84-88](index.js:84) | Missing `assigned_user_id`, `milestone_id`, `limit`, `cursor` (already noted) AND `search`, `priority`, `due_before`, `due_after` if contract supports. | 🟡 |
| T9 | All tools | n/a | On thrown error from `apiCall`, the MCP tool handler does not catch → SDK surfaces a generic transport error. Should `try/catch` and return `{ isError: true, content: [...] }` with status + endpoint context for the LLM. | 🟠 |
| T10 | mgFetch | [index.js:14](index.js:14) | Error message `MavenGang API ${status}` lacks method + path. Non-JSON error bodies dropped. | 🟡 |
| T11 | list_project_members | [index.js:180](index.js:180) | `res.items || res` — defensive but ambiguous. Pin actual contract shape; if both supported, document why. | 🟡 |

### Missing CRUD / Endpoints (additions to gap table)

In addition to the section gaps already listed, the following granular endpoints from sections already "covered" are missing:

| Section | Endpoint | Tool gap |
|---------|----------|----------|
| 7 | `DELETE /tasks/{taskId}` | No `delete_task` |
| 7 | `POST /tasks/bulk-delete` | No bulk delete |
| 7 | `PATCH /tasks/bulk-update` | No bulk update |
| 7b | Task watchers (GET/POST/DELETE) | No watcher tools |
| 7c | Task dependencies | No dependency tools |
| 7e | Task labels | No label CRUD |
| 9 | `PATCH /comments/{id}` & `DELETE /comments/{id}` | No update/delete comment |
| 4 | `GET /clients` | No list_clients (project results reference clients with no way to enumerate) |
| 6 | Milestones GET/POST/PATCH/DELETE | None implemented |
| 3 | Agency members | Not exposed |

---

## Missing Features by Priority

### Priority 0 (Security / Auth correctness — fix first)

- **S1** HTML-escape `clientName` and `errorMsg` in `loginPageHtml` (XSS).
- **S2** Stop round-tripping `oauthReq` through unsigned URL `state`. Either sign (HMAC) or store server-side keyed by an opaque random id.
- **S3** Remove email / OAuth-param `console.log` calls; if needed, mask.
- **A1 + A4** Persist refreshed tokens back to OAuthProvider props (so KV reflects new tokens) AND surface refresh failure as a re-auth-required tool error rather than swallowing.
- **A2** Single-flight the refresh inside the agent (one in-flight refresh promise shared by concurrent calls).
- **A5** Validate `meRes.memberships.length > 0`; return a clear login error if zero. Add multi-agency selection (later).
- **T9** Wrap every tool body in try/catch; return `{ isError: true, content: [...] }` with status + endpoint info for AI.

### Priority 1 (Critical correctness)

- Add missing fields to `create_task`: `milestone_id`, `estimated_hours`, `start_date`.
- Add `cursor` + `limit` to all list tools.
- **T1** `update_task` reject empty body (no mutable fields supplied).
- **T2** Allow explicit `null` for clearable fields (`dueDate`, `assignedUserId`, `parentId`, `milestoneId`) on create/update — distinguish "omit" from "clear".
- **T6** Guard all `res.items.map` with `(res.items || [])`.
- **S4** `encodeURIComponent(taskId)` in `list_comments` query.

### Priority 2 (High)

- Add `milestone_id` + `description` to `update_task`.
- Add filters to `list_tasks`: `assigned_user_id`, `milestone_id`, `topLevelOnly` override (T7), `search`.
- Add full params to `list_projects`: `status`, `client_id`, `search`.
- **T5** Verify `t.project_name` actually returned by `/my-tasks`; remove or document.
- **T10** Include method + path in `mgFetch` error messages; capture non-JSON error bodies.
- Add `delete_task`, `update_comment`, `delete_comment`.

### Priority 3 (Medium)

- Add time tracking tools (section 8 of API contract).
- Add milestone tools (section 6).
- Add `list_clients` (section 4) — projects reference clients but enumeration is impossible.
- Add task watchers / dependencies / labels (sections 7b, 7c, 7e).
- Add bulk task operations (section 7).
- Add analytics view (section 16).

---

## Gap Analysis: Uncovered API Endpoint Groups

These major endpoint groups have **zero MCP tool coverage**:

| Section | Endpoint Group | Endpoints | Priority |
|---------|----------------|-----------|----------|
| 6 | Milestones | CRUD for project milestones | Medium |
| 8 | Time Tracking | Timer start/stop/pause, manual entry | High |
| 8b | Timesheets | Submit, approve, reject | Medium |
| 11 | Concerns | Create/update project concerns | Low |
| 12 | Billing & Invoices | Generate, view, void invoices | Medium |
| 15 | Activity | Activity feed, notifications | Medium |
| 16 | Analytics | Revenue, utilization, project health | Low |
| 17 | File Attachments | Upload/download files | Low |
| 18 | Wiki | Create, edit, search wiki pages | Low |
| 19 | Project Categories | CRUD categories | Low |
| 20 | Status Definitions | Project/task statuses | Low |

---

## Schema Verification Needed

The following fields are used in MCP tools but NOT defined in API_CONTRACT.md. Need to verify actual API response:

| Field | Tool | Notes |
|-------|------|-------|
| `p.key` | list_projects | Verify if exists |
| `p.category_name` | list_projects | Verify if exists |
| `p.task_total` | list_projects | Verify if exists |
| `p.task_completed` | list_projects | Verify if exists |
| `t.status_name` | list_tasks, get_my_tasks | Should be `status` per contract |
| `t.assigned_user` | list_tasks | Verify object structure |
| `m.user_id`, `m.first_name`, `m.last_name`, `m.role` | list_project_members | Verify structure |

---

## Recommended Fixes

### Fix 1: Add Missing Params to create_task

```javascript
this.server.tool(
  "create_task",
  "Create a new task or subtask",
  {
    projectId: z.string(),
    title: z.string(),
    description: z.string().optional(),
    parentId: z.string().optional(),
    milestoneId: z.string().optional(),
    assignedUserId: z.string().optional(),
    priority: z.number().optional(),
    dueDate: z.string().optional(),
    startDate: z.string().optional(),
    estimatedHours: z.number().optional(),
    status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
  },
  async ({ projectId, title, description, parentId, milestoneId, assignedUserId, priority, dueDate, startDate, estimatedHours, status }) => {
    const body = { title };
    if (description) body.description = description;
    if (parentId) body.parent_id = parentId;
    if (milestoneId) body.milestone_id = milestoneId;
    if (assignedUserId) body.assigned_user_id = assignedUserId;
    if (priority !== undefined) body.priority = priority;
    if (dueDate) body.due_date = dueDate;
    if (startDate) body.start_date = startDate;
    if (estimatedHours) body.estimated_hours = estimatedHours;
    if (status) body.status = status;
    // ... rest of implementation
```

### Fix 2: Add Pagination to list_projects

```javascript
this.server.tool(
  "list_projects",
  "List all projects in your Maven Gang account",
  {
    status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
    clientId: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().min(1).max(100).optional(),
    cursor: z.string().optional(),
  },
  async ({ status, clientId, search, limit, cursor }) => {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (clientId) params.append("client_id", clientId);
    if (search) params.append("search", search);
    if (limit) params.append("limit", String(limit));
    if (cursor) params.append("cursor", cursor);
    const q = params.toString() ? "?" + params.toString() : "";
    // ... implementation
```

### Fix 3: Add Full Filters to list_tasks

```javascript
this.server.tool(
  "list_tasks",
  "List tasks in a project",
  {
    projectId: z.string(),
    status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
    assignedUserId: z.string().optional(),
    milestoneId: z.string().optional(),
    parentId: z.string().optional(),
    topLevelOnly: z.boolean().default(true),
    limit: z.number().min(1).max(100).optional(),
    cursor: z.string().optional(),
  },
  // ... implementation
```

---

## Testing Recommendations

1. **Unit test each tool** with mock API responses
2. **Integration test** against staging API
3. **Schema verification** - create a test that dumps actual API responses and compares to expectations

---

## Appendix: Field Mapping Reference

### Project Model (API Contract 5.1)

```json
{
  "id": "cuid",
  "name": "string",
  "billing_model": "hourly | fixed_price | staff_augmentation | retainer_unlimited | retainer_hours_capped",
  "status": "active | on_hold | completed | cancelled",
  "visibility": "public | private",
  "qa_stage_enabled": true,
  "hours_visibility": "totals | by_resource | hidden",
  "hourly_rate": 0,
  "fixed_price": 0,
  "created_by_id": "uuid | null"
}
```

### Task Status Values

- `todo`
- `in_progress`
- `in_qa` (only if QA enabled on project)
- `done`

### Task Model (API Contract 7)

```json
{
  "title": "string",
  "description": "string",
  "milestone_id": "cuid | null",
  "assigned_user_id": "cuid | null",
  "parent_id": "cuid | null",
  "status": "todo | in_progress | in_qa | done",
  "priority": 0,
  "estimated_hours": 0,
  "start_date": "iso | null",
  "due_date": "iso | null"
}
```