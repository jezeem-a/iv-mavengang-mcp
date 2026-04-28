import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

async function mgFetch(path, { method = "GET", headers = {}, body, baseUrl }) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let errData;
    try { errData = await res.json(); } catch { errData = await res.text(); }
    const errDetail = typeof errData === "object" ? JSON.stringify(errData) : errData;
    const err = new Error(`MavenGang API error: ${method} ${path} returned ${res.status} — ${errDetail}`);
    err.status = res.status;
    err.method = method;
    err.path = path;
    err.data = errData;
    throw err;
  }
  return res.json();
}

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

export class MavenGangMCP extends McpAgent {
  server = new McpServer({
    name: "mavengang",
    version: "1.0.0",
  });

  async init() {
    if (!this.props.email) {
      throw new Error("Auth grant missing email. Reconnect required.");
    }
    const userKey = this.props.email;
    const tokensKey = `tokens:${userKey}`;
    const lockKey = `refresh_lock:${userKey}`;
    let refreshPromise = null;

    const loadTokensFromKV = async () => {
      const stored = await this.env.OAUTH_KV.get(tokensKey);
      if (!stored) return false;
      try {
        const tokens = JSON.parse(stored);
        this.props.accessToken = tokens.accessToken;
        this.props.refreshToken = tokens.refreshToken;
        return true;
      } catch {
        return false;
      }
    };

    await loadTokensFromKV();

    const saveTokensToKV = async (accessToken, refreshToken) => {
      await this.env.OAUTH_KV.put(tokensKey, JSON.stringify({
        accessToken, refreshToken,
      }), { expirationTtl: 604800 });
    };

    // KV-based cross-DO lock. Value = random nonce; TTL caps lock duration.
    const acquireRefreshLock = async () => {
      const nonce = crypto.randomUUID();
      const existing = await this.env.OAUTH_KV.get(lockKey);
      if (existing) return null;
      await this.env.OAUTH_KV.put(lockKey, nonce, { expirationTtl: 15 });
      const check = await this.env.OAUTH_KV.get(lockKey);
      return check === nonce ? nonce : null;
    };

    const releaseRefreshLock = async (nonce) => {
      const current = await this.env.OAUTH_KV.get(lockKey);
      if (current === nonce) await this.env.OAUTH_KV.delete(lockKey);
    };

    const refreshTokens = async () => {
      const baseUrl = this.env.BASE_URL;
      // Try to acquire distributed lock; if held, wait and re-read KV.
      let nonce = await acquireRefreshLock();
      let attempts = 0;
      while (!nonce && attempts < 10) {
        const prevToken = this.props.accessToken;
        await new Promise(r => setTimeout(r, 300));
        await loadTokensFromKV();
        if (this.props.accessToken !== prevToken) return; // tokens actually rotated by another DO
        nonce = await acquireRefreshLock();
        attempts++;
      }
      if (!nonce) throw new Error("Refresh lock timeout");

      try {
        // Re-read KV inside lock — another DO may have rotated just before.
        await loadTokensFromKV();
        const refreshed = await mgFetch("/auth/refresh", {
          method: "POST", baseUrl,
          body: { refreshToken: this.props.refreshToken },
        });
        this.props.accessToken = refreshed.access_token;
        this.props.refreshToken = refreshed.refresh_token;
        await saveTokensToKV(refreshed.access_token, refreshed.refresh_token);
      } finally {
        await releaseRefreshLock(nonce);
      }
    };

    const apiCall = async (method, path, body = null) => {
      const baseUrl = this.env.BASE_URL;
      try {
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      } catch (err) {
        if (err.status !== 401) throw err;

        if (!refreshPromise) {
          refreshPromise = refreshTokens().finally(() => { refreshPromise = null; });
        }
        try {
          await refreshPromise;
        } catch (refreshErr) {
          const isAuthFailure = refreshErr.status === 401 || refreshErr.status === 403;
          console.error("Token refresh failed", {
            userKey,
            isAuthFailure,
            status: refreshErr.status,
            code: refreshErr.data?.code,
            message: refreshErr.data?.message || refreshErr.message,
          });
          if (isAuthFailure) {
            // Only wipe tokens on genuine auth rejection — not transient errors or lock timeouts.
            await this.env.OAUTH_KV.delete(tokensKey);
            const error = new Error(`Session expired (${refreshErr.data?.code || refreshErr.status}). Please re-authenticate.`);
            throw error;
          }
          throw new Error(`Token refresh temporarily failed (${refreshErr.message}). Retry the request.`);
        }
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      }
    };

    const agencyId = () => this.props.agencyId;

    this.server.tool(
      "list_projects",
      "List all projects. Filter by status, client. Search by name.",
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
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects${q}`);
        const projects = (res.items || []).map(p => ({
          id: p.id, name: p.name, status: p.status,
          client: p.clients?.[0]?.name || null,
        }));
        return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
      }
    );

    this.server.tool(
      "get_project",
      "Get details of a single project",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_tasks",
      "List tasks in a project. Filter by status, assignee, milestone. Pass parentId to get subtasks. Set topLevelOnly=false to get all tasks. IMPORTANT: use `id_for_api` (UUID) for all API operations (taskId, parentId, etc). `taskNumber_display_only` (e.g. PRJ8-5) is for display only and will cause 400 errors if used as an ID.",
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
      async ({ projectId, status, assignedUserId, milestoneId, parentId, topLevelOnly, limit, cursor }) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (assignedUserId) params.append("assigned_user_id", assignedUserId);
        if (milestoneId) params.append("milestone_id", milestoneId);
        if (parentId) params.append("parent_id", parentId);
        if (topLevelOnly === false) params.append("top_level_only", "false");
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks${q}`);
        const tasks = (res.items || []).map(t => ({
          id_for_api: t.id,
          taskNumber_display_only: t.task_number,
          title: t.title,
          description: t.description || "",
          status: t.status_name || t.status, priority: t.priority,
          assignedTo: t.assigned_user
            ? `${t.assigned_user.first_name} ${t.assigned_user.last_name}`
            : "Unassigned",
          parent_id: t.parent_id || null,
          isSubtask: !!t.parent_id, dueDate: t.due_date,
        }));
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
    );

    this.server.tool(
      "get_task",
      "Get full details of a single task. taskId must be the UUID `id` field, not the display task_number (e.g. PRJ8-1).",
      { projectId: z.string(), taskId: z.string() },
      async ({ projectId, taskId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task",
      "Create a new task or subtask. To create a subtask pass parentId = the UUID `id` field of the parent task (NOT the display task_number like 'PRJ8-5'). Get the UUID from list_tasks or get_task first.",
      {
        projectId: z.string(),
        title: z.string(),
        description: z.string().nullable().optional(),
        parentId: z.string().nullable().optional().describe("UUID id of parent task. Must be the id field (UUID), NOT the display taskNumber like 'PRJ8-5'."),
        milestoneId: z.string().nullable().optional(),
        assignedUserId: z.string().nullable().optional(),
        priority: z.number().optional(),
        dueDate: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        estimatedHours: z.number().optional(),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
      },
      async ({ projectId, title, description, parentId, milestoneId, assignedUserId, priority, dueDate, startDate, estimatedHours, status }) => {
        const body = { title };
        if (description !== undefined) body.description = description;
        if (parentId !== undefined) body.parent_id = parentId;
        if (milestoneId !== undefined) body.milestone_id = milestoneId;
        if (assignedUserId !== undefined) body.assigned_user_id = assignedUserId;
        if (priority !== undefined) body.priority = priority;
        if (dueDate !== undefined) body.due_date = dueDate;
        if (startDate !== undefined) body.start_date = startDate;
        if (estimatedHours !== undefined) body.estimated_hours = estimatedHours;
        if (status) body.status = status;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks`, body);
        const task = res.task;
        return {
          content: [{
            type: "text",
            text: `Task created: ${task.task_number} - "${task.title}"\nid (UUID for API calls, parentId, etc): ${task.id}\nStatus: ${task.status_name}\nAssigned: ${task.assigned_user?.first_name || "Unassigned"}\nparent_id: ${task.parent_id || "none (top-level task)"}`,
          }],
        };
      }
    );

    this.server.tool(
      "update_task",
      "Update task status, assignee, priority, title, description, milestone, or due date. Pass null to clear optional fields. taskId must be the UUID `id_for_api` field, NOT the display taskNumber like 'PRJ8-5'.",
      {
        projectId: z.string(),
        taskId: z.string().describe("UUID id of the task (id_for_api from list_tasks). NOT the display taskNumber like 'PRJ8-5'."),
        title: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
        assignedUserId: z.string().nullable().optional(),
        milestoneId: z.string().nullable().optional(),
        priority: z.number().optional(),
        dueDate: z.string().nullable().optional(),
      },
      async ({ projectId, taskId, title, description, status, assignedUserId, milestoneId, priority, dueDate }) => {
        const body = {};
        if (title !== undefined) body.title = title;
        if (description !== undefined) body.description = description;
        if (status !== undefined) body.status = status;
        if (assignedUserId !== undefined) body.assigned_user_id = assignedUserId;
        if (milestoneId !== undefined) body.milestone_id = milestoneId;
        if (priority !== undefined) body.priority = priority;
        if (dueDate !== undefined) body.due_date = dueDate;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update. Pass at least one of: title, description, status, assignedUserId, milestoneId, priority, dueDate." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_project_members",
      "List members of a project with user IDs for assignment",
      {
        projectId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/members${q}`);
        const members = (res.items || []).map(m => ({
          userId: m.user_id, firstName: m.first_name, lastName: m.last_name, role: m.role,
        }));
        return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
      }
    );

    this.server.tool(
      "get_my_tasks",
      "Get all tasks assigned to current user across all projects. Filter by status (comma-separated: todo,in_progress,in_qa,done).",
      {
        status: z.string().optional(),
        sort: z.enum(["due_date", "priority", "created_at"]).optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ status, sort, limit, cursor }) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (sort) params.append("sort", sort);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/my-tasks${q}`);
        const tasks = (res.items || []).map(t => ({
          id_for_api: t.id,
          taskNumber_display_only: t.task_number,
          title: t.title,
          status: t.status_name || t.status, priority: t.priority,
          dueDate: t.due_date, projectId: t.project_id, projectName: t.project_name,
        }));
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      }
    );

    this.server.tool(
      "add_comment",
      "Add a comment to a task. taskId must be the UUID id_for_api from list_tasks, NOT the display taskNumber like 'PRJ8-5'.",
      {
        taskId: z.string().describe("UUID id of the task (id_for_api). NOT the display taskNumber like 'PRJ8-5'."),
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
      "List comments on a task. taskId must be the UUID id_for_api from list_tasks, NOT the display taskNumber like 'PRJ8-5'.",
      { taskId: z.string().describe("UUID id of the task (id_for_api). NOT the display taskNumber like 'PRJ8-5'.") },
      async ({ taskId }) => {
        const res = await apiCall(
          "GET",
          `/agencies/${agencyId()}/comments?entity_type=task&entity_id=${encodeURIComponent(taskId)}`
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

    this.server.tool(
      "delete_task",
      "Delete a task from a project. taskId must be the UUID `id_for_api` from list_tasks, NOT the display taskNumber like 'PRJ8-5'.",
      { projectId: z.string(), taskId: z.string().describe("UUID id of the task (id_for_api from list_tasks). NOT the display taskNumber.") },
      async ({ projectId, taskId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`);
        return { content: [{ type: "text", text: `Task ${taskId} deleted successfully.` }] };
      }
    );

    this.server.tool(
      "update_comment",
      "Update a comment's content",
      { commentId: z.string(), content: z.string() },
      async ({ commentId, content }) => {
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/comments/${commentId}`, { content });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_comment",
      "Delete a comment",
      { commentId: z.string() },
      async ({ commentId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/comments/${commentId}`);
        return { content: [{ type: "text", text: `Comment ${commentId} deleted.` }] };
      }
    );

    this.server.tool(
      "list_clients",
      "List all clients in the agency",
      {
        search: z.string().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ search, status, limit, cursor }) => {
        const params = new URLSearchParams();
        if (search) params.append("search", search);
        if (status) params.append("status", status);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/clients${q}`);
        const clients = (res.items || []).map(c => ({
          id: c.id, name: c.name, contactEmail: c.contact_email,
        }));
        return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
      }
    );

    // §3 Agency Members
    this.server.tool(
      "list_agency_members",
      "List all members of the agency",
      {
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/members${q}`);
        const members = (res.items || []).map(m => ({
          userId: m.user_id, firstName: m.first_name, lastName: m.last_name, email: m.email, role: m.role,
        }));
        return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
      }
    );

    this.server.tool(
      "update_agency_member",
      "Update member role, hourly rate, or weekly capacity",
      {
        userId: z.string(),
        role: z.enum(["admin", "manager", "staff", "finance", "client"]).optional(),
        hourlyRate: z.number().optional(),
        weeklyCapacityHours: z.number().optional(),
      },
      async ({ userId, role, hourlyRate, weeklyCapacityHours }) => {
        const body = {};
        if (role !== undefined) body.role = role;
        if (hourlyRate !== undefined) body.hourly_rate = hourlyRate;
        if (weeklyCapacityHours !== undefined) body.weekly_capacity_hours = weeklyCapacityHours;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/members/${userId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "remove_agency_member",
      "Remove a member from the agency (soft delete)",
      { userId: z.string() },
      async ({ userId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/members/${userId}`);
        return { content: [{ type: "text", text: `Member ${userId} removed.` }] };
      }
    );

    this.server.tool(
      "create_invite",
      "Invite a user to the agency",
      {
        email: z.string(),
        role: z.enum(["admin", "manager", "staff", "finance", "client"]),
      },
      async ({ email, role }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/invites`, { email, role });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_invites",
      "List pending invites",
      {
        status: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ status, limit, cursor }) => {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/invites${q}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_invite",
      "Cancel a pending invite",
      { inviteId: z.string() },
      async ({ inviteId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/invites/${inviteId}`);
        return { content: [{ type: "text", text: `Invite ${inviteId} deleted.` }] };
      }
    );

    // §4 Clients (complete)
    this.server.tool(
      "create_client",
      "Create a new client",
      {
        name: z.string(),
        contactEmail: z.string().optional(),
      },
      async ({ name, contactEmail }) => {
        const body = { name };
        if (contactEmail !== undefined) body.contact_email = contactEmail;
        const res = await apiCall("POST", `/agencies/${agencyId()}/clients`, body);
        return { content: [{ type: "text", text: JSON.stringify({ id: res.client.id, name: res.client.name }, null, 2) }] };
      }
    );

    this.server.tool(
      "get_client",
      "Get client details",
      { clientId: z.string() },
      async ({ clientId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/clients/${clientId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_client",
      "Update client details",
      {
        clientId: z.string(),
        name: z.string().optional(),
        contactEmail: z.string().optional(),
      },
      async ({ clientId, name, contactEmail }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (contactEmail !== undefined) body.contact_email = contactEmail;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/clients/${clientId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §5 Projects (additions)
    this.server.tool(
      "create_project",
      "Create a new project",
      {
        name: z.string(),
        billingModel: z.enum(["hourly", "fixed_price", "staff_augmentation", "retainer_unlimited", "retainer_hours_capped"]),
        status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
        visibility: z.enum(["public", "private"]).optional(),
        hourlyRate: z.number().optional(),
        fixedPrice: z.number().optional(),
        qaStageEnabled: z.boolean().optional(),
      },
      async ({ name, billingModel, status, visibility, hourlyRate, fixedPrice, qaStageEnabled }) => {
        const body = { name, billing_model: billingModel };
        if (status !== undefined) body.status = status;
        if (visibility !== undefined) body.visibility = visibility;
        if (hourlyRate !== undefined) body.hourly_rate = hourlyRate;
        if (fixedPrice !== undefined) body.fixed_price = fixedPrice;
        if (qaStageEnabled !== undefined) body.qa_stage_enabled = qaStageEnabled;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project",
      "Update project details",
      {
        projectId: z.string(),
        name: z.string().optional(),
        status: z.enum(["active", "on_hold", "completed", "cancelled"]).optional(),
        visibility: z.enum(["public", "private"]).optional(),
        hourlyRate: z.number().optional(),
        fixedPrice: z.number().optional(),
        qaStageEnabled: z.boolean().optional(),
      },
      async ({ projectId, name, status, visibility, hourlyRate, fixedPrice, qaStageEnabled }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (status !== undefined) body.status = status;
        if (visibility !== undefined) body.visibility = visibility;
        if (hourlyRate !== undefined) body.hourly_rate = hourlyRate;
        if (fixedPrice !== undefined) body.fixed_price = fixedPrice;
        if (qaStageEnabled !== undefined) body.qa_stage_enabled = qaStageEnabled;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_project_dashboard",
      "Get project dashboard with progress and activity",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/dashboard`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "add_project_member",
      "Add a member to a project",
      {
        projectId: z.string(),
        userId: z.string(),
        role: z.enum(["MANAGER", "CONTRIBUTOR", "VIEWER"]),
      },
      async ({ projectId, userId, role }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/members`, { user_id: userId, role });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project_member",
      "Update a project member's role",
      {
        projectId: z.string(),
        userId: z.string(),
        role: z.enum(["MANAGER", "CONTRIBUTOR", "VIEWER"]),
      },
      async ({ projectId, userId, role }) => {
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/members/${userId}`, { role });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "remove_project_member",
      "Remove a member from a project",
      { projectId: z.string(), userId: z.string() },
      async ({ projectId, userId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/members/${userId}`);
        return { content: [{ type: "text", text: "Member removed from project." }] };
      }
    );

    // §6 Milestones
    this.server.tool(
      "list_milestones",
      "List milestones in a project",
      {
        projectId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/milestones${q}`);
        const milestones = (res.items || []).map(m => ({
          id: m.id, title: m.title, status: m.status, dueDate: m.due_date, parentId: m.parent_id, sequenceOrder: m.sequence_order,
        }));
        return { content: [{ type: "text", text: JSON.stringify(milestones, null, 2) }] };
      }
    );

    this.server.tool(
      "create_milestone",
      "Create a new milestone",
      {
        projectId: z.string(),
        title: z.string(),
        status: z.enum(["not_started", "in_progress", "completed"]).optional(),
        dueDate: z.string().optional(),
        parentId: z.string().optional(),
        sequenceOrder: z.number().optional(),
      },
      async ({ projectId, title, status, dueDate, parentId, sequenceOrder }) => {
        const body = { title };
        if (status !== undefined) body.status = status;
        if (dueDate !== undefined) body.due_date = dueDate;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sequenceOrder !== undefined) body.sequence_order = sequenceOrder;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/milestones`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_milestone",
      "Update a milestone",
      {
        projectId: z.string(),
        milestoneId: z.string(),
        title: z.string().optional(),
        status: z.enum(["not_started", "in_progress", "completed"]).optional(),
        dueDate: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        sequenceOrder: z.number().optional(),
      },
      async ({ projectId, milestoneId, title, status, dueDate, parentId, sequenceOrder }) => {
        const body = {};
        if (title !== undefined) body.title = title;
        if (status !== undefined) body.status = status;
        if (dueDate !== undefined) body.due_date = dueDate;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sequenceOrder !== undefined) body.sequence_order = sequenceOrder;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/milestones/${milestoneId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_milestone",
      "Delete a milestone",
      { projectId: z.string(), milestoneId: z.string() },
      async ({ projectId, milestoneId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/milestones/${milestoneId}`);
        return { content: [{ type: "text", text: "Milestone deleted." }] };
      }
    );

    // §7 Bulk Tasks
    this.server.tool(
      "bulk_update_tasks",
      "Update multiple tasks at once. taskIds must be UUID id_for_api values from list_tasks, NOT display taskNumbers like 'PRJ8-5'.",
      {
        projectId: z.string(),
        taskIds: z.array(z.string()).min(1).describe("Array of UUID id_for_api values. NOT display taskNumbers."),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).optional(),
        assignedUserId: z.string().nullable().optional(),
        milestoneId: z.string().nullable().optional(),
      },
      async ({ projectId, taskIds, status, assignedUserId, milestoneId }) => {
        const body = { task_ids: taskIds };
        if (status !== undefined) body.status = status;
        if (assignedUserId !== undefined) body.assigned_user_id = assignedUserId;
        if (milestoneId !== undefined) body.milestone_id = milestoneId;
        if (Object.keys(body).length <= 1) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/tasks/bulk-update`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "bulk_delete_tasks",
      "Delete multiple tasks. taskIds must be UUID id_for_api values from list_tasks, NOT display taskNumbers like 'PRJ8-5'.",
      { projectId: z.string(), taskIds: z.array(z.string()).min(1).describe("Array of UUID id_for_api values. NOT display taskNumbers.") },
      async ({ projectId, taskIds }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks/bulk-delete`, { task_ids: taskIds });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §7b Task Watchers
    this.server.tool(
      "list_task_watchers",
      "List watchers of a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'.") },
      async ({ projectId, taskId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/watchers`);
        const watchers = (res.items || []).map(w => ({ userId: w.user_id, firstName: w.first_name, lastName: w.last_name }));
        return { content: [{ type: "text", text: JSON.stringify(watchers, null, 2) }] };
      }
    );

    this.server.tool(
      "add_task_watcher",
      "Add a watcher to a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'."), userId: z.string() },
      async ({ projectId, taskId, userId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/watchers`, { user_id: userId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "remove_task_watcher",
      "Remove a watcher from a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'."), userId: z.string() },
      async ({ projectId, taskId, userId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/watchers/${userId}`);
        return { content: [{ type: "text", text: "Watcher removed." }] };
      }
    );

    // §7c Task Dependencies
    this.server.tool(
      "list_task_dependencies",
      "List dependencies of a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'.") },
      async ({ projectId, taskId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/dependencies`);
        const deps = (res.items || []).map(d => ({ id: d.id, dependsOnTaskId: d.depends_on_task_id, title: d.depends_on_task?.title }));
        return { content: [{ type: "text", text: JSON.stringify(deps, null, 2) }] };
      }
    );

    this.server.tool(
      "add_task_dependency",
      "Add a dependency to a task. Both taskId and dependsOnTaskId must be UUID id_for_api, NOT display taskNumbers.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber."), dependsOnTaskId: z.string().describe("UUID id_for_api of the task this depends on. NOT display taskNumber.") },
      async ({ projectId, taskId, dependsOnTaskId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/dependencies`, { depends_on_task_id: dependsOnTaskId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "remove_task_dependency",
      "Remove a dependency from a task. taskId must be UUID id_for_api, NOT display taskNumber. dependencyId is the dependency record UUID from list_task_dependencies.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber."), dependencyId: z.string().describe("UUID of the dependency record (id from list_task_dependencies).") },
      async ({ projectId, taskId, dependencyId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/dependencies/${dependencyId}`);
        return { content: [{ type: "text", text: "Dependency removed." }] };
      }
    );

    // §7d Task Recurrence
    this.server.tool(
      "set_task_recurrence",
      "Set recurrence on a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      {
        projectId: z.string(),
        taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'."),
        frequency: z.enum(["daily", "weekly", "monthly"]),
        interval: z.number(),
        endDate: z.string().nullable().optional(),
        maxOccurrences: z.number().optional(),
      },
      async ({ projectId, taskId, frequency, interval, endDate, maxOccurrences }) => {
        const body = { frequency, interval };
        if (endDate !== undefined) body.end_date = endDate;
        if (maxOccurrences !== undefined) body.max_occurrences = maxOccurrences;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/recurrence`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_task_recurrence",
      "Update recurrence on a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      {
        projectId: z.string(),
        taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'."),
        frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
        interval: z.number().optional(),
        endDate: z.string().nullable().optional(),
        maxOccurrences: z.number().optional(),
      },
      async ({ projectId, taskId, frequency, interval, endDate, maxOccurrences }) => {
        const body = {};
        if (frequency !== undefined) body.frequency = frequency;
        if (interval !== undefined) body.interval = interval;
        if (endDate !== undefined) body.end_date = endDate;
        if (maxOccurrences !== undefined) body.max_occurrences = maxOccurrences;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/recurrence`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_task_recurrence",
      "Remove recurrence from a task. taskId must be UUID id_for_api, NOT display taskNumber.",
      { projectId: z.string(), taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'.") },
      async ({ projectId, taskId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/recurrence`);
        return { content: [{ type: "text", text: "Recurrence removed." }] };
      }
    );

    this.server.tool(
      "list_task_occurrences",
      "List occurrences of a recurring task. taskId must be UUID id_for_api, NOT display taskNumber.",
      {
        projectId: z.string(),
        taskId: z.string().describe("UUID id_for_api. NOT display taskNumber like 'PRJ8-5'."),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, taskId, limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}/occurrences${q}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §7e Task Labels
    this.server.tool(
      "list_task_labels",
      "List task labels",
      { projectId: z.string().optional() },
      async ({ projectId }) => {
        const params = new URLSearchParams();
        if (projectId) params.append("project_id", projectId);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/task-labels${q}`);
        const labels = (res.items || []).map(l => ({ id: l.id, name: l.name, color: l.color, projectId: l.project_id }));
        return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task_label",
      "Create a task label",
      {
        name: z.string(),
        color: z.string().optional(),
        projectId: z.string().nullable().optional(),
      },
      async ({ name, color, projectId }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        if (projectId !== undefined) body.project_id = projectId;
        const res = await apiCall("POST", `/agencies/${agencyId()}/task-labels`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_task_label",
      "Update a task label",
      {
        labelId: z.string(),
        name: z.string().optional(),
        color: z.string().optional(),
      },
      async ({ labelId, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/task-labels/${labelId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_task_label",
      "Delete a task label",
      { labelId: z.string() },
      async ({ labelId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/task-labels/${labelId}`);
        return { content: [{ type: "text", text: "Label deleted." }] };
      }
    );

    // §7f Task Templates
    this.server.tool(
      "list_task_templates",
      "List task templates",
      {
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/task-templates${q}`);
        const templates = (res.items || []).map(t => ({ id: t.id, name: t.name, description: t.description }));
        return { content: [{ type: "text", text: JSON.stringify(templates, null, 2) }] };
      }
    );

    this.server.tool(
      "get_task_template",
      "Get task template details",
      { templateId: z.string() },
      async ({ templateId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/task-templates/${templateId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task_template",
      "Create a task template",
      {
        name: z.string(),
        description: z.string().optional(),
        tasks: z.array(z.object({ title: z.string(), description: z.string().optional() })),
      },
      async ({ name, description, tasks }) => {
        const body = { name, tasks };
        if (description !== undefined) body.description = description;
        const res = await apiCall("POST", `/agencies/${agencyId()}/task-templates`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_task_template",
      "Update a task template",
      {
        templateId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ templateId, name, description }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (description !== undefined) body.description = description;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/task-templates/${templateId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_task_template",
      "Delete a task template",
      { templateId: z.string() },
      async ({ templateId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/task-templates/${templateId}`);
        return { content: [{ type: "text", text: "Template deleted." }] };
      }
    );

    this.server.tool(
      "apply_task_template",
      "Apply a task template to a project",
      {
        templateId: z.string(),
        projectId: z.string(),
        milestoneId: z.string().nullable().optional(),
      },
      async ({ templateId, projectId, milestoneId }) => {
        const body = { milestone_id: milestoneId ?? null };
        const res = await apiCall("POST", `/agencies/${agencyId()}/task-templates/${templateId}/apply/${projectId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §8 Time Tracking
    this.server.tool(
      "start_timer",
      "Start a time timer",
      {
        projectId: z.string(),
        taskId: z.string().nullable().optional().describe("UUID id_for_api of the task. NOT display taskNumber."),
        note: z.string().optional(),
        isBillable: z.boolean().optional(),
      },
      async ({ projectId, taskId, note, isBillable }) => {
        const body = { project_id: projectId };
        if (taskId !== undefined) body.task_id = taskId;
        if (note !== undefined) body.note = note;
        if (isBillable !== undefined) body.is_billable = isBillable;
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entries/timer/start`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "stop_timer",
      "Stop a running timer",
      { timeEntryId: z.string() },
      async ({ timeEntryId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entries/timer/stop`, { time_entry_id: timeEntryId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "pause_timer",
      "Pause a running timer",
      { timeEntryId: z.string() },
      async ({ timeEntryId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entries/timer/pause`, { time_entry_id: timeEntryId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "resume_timer",
      "Resume a paused timer",
      { timeEntryId: z.string() },
      async ({ timeEntryId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entries/timer/resume`, { time_entry_id: timeEntryId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "log_time",
      "Log time entry manually",
      {
        projectId: z.string(),
        startTime: z.string(),
        endTime: z.string().nullable().optional(),
        durationMinutes: z.number().optional(),
        taskId: z.string().nullable().optional().describe("UUID id_for_api of the task. NOT display taskNumber."),
        note: z.string().optional(),
        isBillable: z.boolean().optional(),
        tagIds: z.array(z.string()).optional(),
        userId: z.string().nullable().optional(),
      },
      async ({ projectId, startTime, endTime, durationMinutes, taskId, note, isBillable, tagIds, userId }) => {
        if (!endTime && !durationMinutes) {
          return { content: [{ type: "text", text: "Either endTime or durationMinutes is required." }] };
        }
        const body = { project_id: projectId, start_time: startTime };
        if (endTime !== undefined) body.end_time = endTime;
        if (durationMinutes !== undefined) body.duration_minutes = durationMinutes;
        if (taskId !== undefined) body.task_id = taskId;
        if (note !== undefined) body.note = note;
        if (isBillable !== undefined) body.is_billable = isBillable;
        if (tagIds !== undefined) body.tag_ids = tagIds;
        if (userId !== undefined) body.user_id = userId;
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entries`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_time_entries",
      "List time entries",
      {
        projectId: z.string().optional(),
        taskId: z.string().optional().describe("UUID id_for_api of the task to filter by. NOT display taskNumber."),
        userId: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, taskId, userId, fromDate, toDate, limit, cursor }) => {
        const params = new URLSearchParams();
        if (projectId) params.append("project_id", projectId);
        if (taskId) params.append("task_id", taskId);
        if (userId) params.append("user_id", userId);
        if (fromDate) params.append("from_date", fromDate);
        if (toDate) params.append("to_date", toDate);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/time-entries${q}`);
        const entries = (res.items || []).map(e => ({
          id: e.id, projectId: e.project_id, taskId: e.task_id, durationMinutes: e.duration_minutes,
          note: e.note, isBillable: e.is_billable, startTime: e.start_time, endTime: e.end_time, userId: e.user_id,
        }));
        return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
      }
    );

    this.server.tool(
      "get_time_entry",
      "Get time entry details",
      { timeEntryId: z.string() },
      async ({ timeEntryId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/time-entries/${timeEntryId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_time_entry",
      "Update a time entry",
      {
        timeEntryId: z.string(),
        note: z.string().optional(),
        isBillable: z.boolean().optional(),
        startTime: z.string().optional(),
        endTime: z.string().nullable().optional(),
        durationMinutes: z.number().optional(),
        tagIds: z.array(z.string()).optional(),
      },
      async ({ timeEntryId, note, isBillable, startTime, endTime, durationMinutes, tagIds }) => {
        const body = {};
        if (note !== undefined) body.note = note;
        if (isBillable !== undefined) body.is_billable = isBillable;
        if (startTime !== undefined) body.start_time = startTime;
        if (endTime !== undefined) body.end_time = endTime;
        if (durationMinutes !== undefined) body.duration_minutes = durationMinutes;
        if (tagIds !== undefined) body.tag_ids = tagIds;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/time-entries/${timeEntryId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_time_entry",
      "Delete a time entry (soft delete)",
      { timeEntryId: z.string() },
      async ({ timeEntryId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/time-entries/${timeEntryId}`);
        return { content: [{ type: "text", text: "Time entry deleted." }] };
      }
    );

    this.server.tool(
      "get_team_time_summary",
      "Get team time entries summary",
      {
        fromDate: z.string(),
        toDate: z.string(),
        projectId: z.string().optional(),
        userId: z.string().optional(),
      },
      async ({ fromDate, toDate, projectId, userId }) => {
        const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
        if (projectId) params.append("project_id", projectId);
        if (userId) params.append("user_id", userId);
        const res = await apiCall("GET", `/agencies/${agencyId()}/time-entries/team-summary?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_weekly_time_summary",
      "Get weekly time summary for timesheet",
      {
        weekStart: z.string(),
        userId: z.string().optional(),
      },
      async ({ weekStart, userId }) => {
        const params = new URLSearchParams({ week_start: weekStart });
        if (userId) params.append("user_id", userId);
        const res = await apiCall("GET", `/agencies/${agencyId()}/time-entries/weekly-summary?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §8b Timesheets
    this.server.tool(
      "get_timesheet",
      "Get timesheet for a week",
      {
        weekStart: z.string(),
        userId: z.string().optional(),
      },
      async ({ weekStart, userId }) => {
        const params = new URLSearchParams({ week_start: weekStart });
        if (userId) params.append("user_id", userId);
        const res = await apiCall("GET", `/agencies/${agencyId()}/timesheets?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_pending_timesheets",
      "List timesheets pending approval",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/timesheets/pending`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "submit_timesheet",
      "Submit a timesheet for approval",
      { weekStart: z.string() },
      async ({ weekStart }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/timesheets/submit`, { week_start: weekStart });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "recall_timesheet",
      "Recall a submitted timesheet",
      { timesheetId: z.string() },
      async ({ timesheetId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/timesheets/${timesheetId}/recall`, {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "approve_timesheet",
      "Approve a submitted timesheet",
      {
        timesheetId: z.string(),
        note: z.string().optional(),
        projectId: z.string().nullable().optional(),
      },
      async ({ timesheetId, note, projectId }) => {
        const body = {};
        if (note !== undefined) body.note = note;
        if (projectId !== undefined) body.project_id = projectId;
        const res = await apiCall("POST", `/agencies/${agencyId()}/timesheets/${timesheetId}/approve`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "reject_timesheet",
      "Reject a submitted timesheet",
      {
        timesheetId: z.string(),
        note: z.string().optional(),
        projectId: z.string().nullable().optional(),
      },
      async ({ timesheetId, note, projectId }) => {
        const body = {};
        if (note !== undefined) body.note = note;
        if (projectId !== undefined) body.project_id = projectId;
        const res = await apiCall("POST", `/agencies/${agencyId()}/timesheets/${timesheetId}/reject`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §8c Time Entry Tags
    this.server.tool(
      "list_time_entry_tags",
      "List time entry tags",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/time-entry-tags`);
        const tags = (res.items || []).map(t => ({ id: t.id, name: t.name, color: t.color }));
        return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
      }
    );

    this.server.tool(
      "create_time_entry_tag",
      "Create a time entry tag",
      {
        name: z.string(),
        color: z.string().optional(),
      },
      async ({ name, color }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        const res = await apiCall("POST", `/agencies/${agencyId()}/time-entry-tags`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_time_entry_tag",
      "Update a time entry tag",
      {
        tagId: z.string(),
        name: z.string().optional(),
        color: z.string().optional(),
      },
      async ({ tagId, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/time-entry-tags/${tagId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_time_entry_tag",
      "Delete a time entry tag",
      { tagId: z.string() },
      async ({ tagId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/time-entry-tags/${tagId}`);
        return { content: [{ type: "text", text: "Tag deleted." }] };
      }
    );

    // §11 Concerns
    this.server.tool(
      "list_concerns",
      "List concerns for a project",
      {
        projectId: z.string(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/concerns${q}`);
        const concerns = (res.items || []).map(c => ({
          id: c.id, title: c.title, description: c.description, status: c.status, resolution: c.resolution,
        }));
        return { content: [{ type: "text", text: JSON.stringify(concerns, null, 2) }] };
      }
    );

    this.server.tool(
      "create_concern",
      "Create a concern for a project",
      { projectId: z.string(), title: z.string(), description: z.string() },
      async ({ projectId, title, description }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/concerns`, { title, description });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_concern",
      "Update a concern's status",
      {
        projectId: z.string(),
        concernId: z.string(),
        status: z.enum(["open", "acknowledged", "resolved"]),
        resolution: z.string().optional(),
      },
      async ({ projectId, concernId, status, resolution }) => {
        const body = { status };
        if (resolution !== undefined) body.resolution = resolution;
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/concerns/${concernId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §12 Billing & Invoices
    this.server.tool(
      "get_invoice_preview",
      "Preview invoice before generation",
      { clientId: z.string(), period: z.string() },
      async ({ clientId, period }) => {
        const params = new URLSearchParams({ client_id: clientId, period });
        const res = await apiCall("GET", `/agencies/${agencyId()}/billing/invoice-preview?${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_invoices",
      "List invoices",
      {
        clientId: z.string().optional(),
        status: z.string().optional(),
        period: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ clientId, status, period, limit, cursor }) => {
        const params = new URLSearchParams();
        if (clientId) params.append("client_id", clientId);
        if (status) params.append("status", status);
        if (period) params.append("period", period);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/invoices${q}`);
        const invoices = (res.items || []).map(i => ({
          id: i.id, clientId: i.client_id, status: i.status, total: i.total, period: i.period, createdAt: i.created_at,
        }));
        return { content: [{ type: "text", text: JSON.stringify(invoices, null, 2) }] };
      }
    );

    this.server.tool(
      "get_invoice",
      "Get invoice details",
      { invoiceId: z.string() },
      async ({ invoiceId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/invoices/${invoiceId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_invoice",
      "Generate an invoice",
      { clientId: z.string(), period: z.string() },
      async ({ clientId, period }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/invoices`, { client_id: clientId, period });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "void_invoice",
      "Void an invoice",
      { invoiceId: z.string(), reason: z.string() },
      async ({ invoiceId, reason }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/invoices/${invoiceId}/void`, { reason });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "mark_invoice_paid",
      "Mark an invoice as paid",
      { invoiceId: z.string() },
      async ({ invoiceId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/invoices/${invoiceId}/mark-paid`, {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §15 Activity & Notifications
    this.server.tool(
      "get_activity_feed",
      "Get agency activity feed",
      {
        projectId: z.string().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        actorId: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ projectId, entityType, entityId, actorId, limit, cursor }) => {
        const params = new URLSearchParams();
        if (projectId) params.append("project_id", projectId);
        if (entityType) params.append("entity_type", entityType);
        if (entityId) params.append("entity_id", entityId);
        if (actorId) params.append("actor_id", actorId);
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/activity${q}`);
        const activities = (res.items || []).map(a => ({
          id: a.id, type: a.type, entityType: a.entity_type, entityId: a.entity_id,
          actorId: a.actor_id, createdAt: a.created_at, data: a.data,
        }));
        return { content: [{ type: "text", text: JSON.stringify(activities, null, 2) }] };
      }
    );

    this.server.tool(
      "list_notifications",
      "List notifications for current user",
      {
        limit: z.number().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      async ({ limit, cursor }) => {
        const params = new URLSearchParams();
        if (limit) params.append("limit", String(limit));
        if (cursor) params.append("cursor", cursor);
        const q = params.toString() ? "?" + params.toString() : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/notifications${q}`);
        const notifications = (res.items || []).map(n => ({
          id: n.id, type: n.type, read: n.read, createdAt: n.created_at, data: n.data,
        }));
        return { content: [{ type: "text", text: JSON.stringify(notifications, null, 2) }] };
      }
    );

    this.server.tool(
      "get_unread_notification_count",
      "Get count of unread notifications",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/notifications/unread-count`);
        return { content: [{ type: "text", text: String(res.count) }] };
      }
    );

    this.server.tool(
      "mark_notification_read",
      "Mark a notification as read",
      { notificationId: z.string() },
      async ({ notificationId }) => {
        await apiCall("PATCH", `/agencies/${agencyId()}/notifications/${notificationId}/read`, {});
        return { content: [{ type: "text", text: "Notification marked as read." }] };
      }
    );

    this.server.tool(
      "mark_all_notifications_read",
      "Mark all notifications as read",
      async () => {
        await apiCall("POST", `/agencies/${agencyId()}/notifications/mark-all-read`, {});
        return { content: [{ type: "text", text: "All notifications marked as read." }] };
      }
    );

    // §16 Analytics
    this.server.tool(
      "get_analytics",
      "Get agency analytics overview",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_client_analytics",
      "Get client-specific analytics",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics/clients${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_project_analytics",
      "Get project-specific analytics",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics/projects${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_financial_analytics",
      "Get financial analytics",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics/financial${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_utilization_analytics",
      "Get team utilization analytics",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics/utilization${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_personal_analytics",
      "Get personal analytics for current user",
      { period: z.string().optional() },
      async ({ period }) => {
        const params = period ? `?period=${period}` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/analytics/personal${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §17 Attachments (list/download/delete only)
    this.server.tool(
      "list_attachments",
      "List attachments for an entity",
      {
        entityType: z.enum(["project", "task", "comment"]),
        entityId: z.string(),
      },
      async ({ entityType, entityId }) => {
        const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
        const res = await apiCall("GET", `/agencies/${agencyId()}/attachments?${params}`);
        const attachments = (res.items || []).map(a => ({
          id: a.id, filename: a.filename, mimeType: a.mime_type, size: a.size, createdAt: a.created_at,
        }));
        return { content: [{ type: "text", text: JSON.stringify(attachments, null, 2) }] };
      }
    );

    this.server.tool(
      "get_attachment_download_url",
      "Get download URL for an attachment",
      { attachmentId: z.string() },
      async ({ attachmentId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/attachments/${attachmentId}/download-url`);
        return { content: [{ type: "text", text: res.url }] };
      }
    );

    this.server.tool(
      "delete_attachment",
      "Delete an attachment",
      { attachmentId: z.string() },
      async ({ attachmentId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/attachments/${attachmentId}`);
        return { content: [{ type: "text", text: "Attachment deleted." }] };
      }
    );

    // §18 Wiki (agency-wide)
    this.server.tool(
      "list_wiki_pages",
      "List agency wiki pages",
      { includeDrafts: z.boolean().optional() },
      async ({ includeDrafts }) => {
        const params = includeDrafts ? `?include_drafts=true` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/wiki${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_wiki_page",
      "Create a wiki page",
      {
        title: z.string(),
        slug: z.string(),
        content: z.object({}).optional(),
        parentId: z.string().optional(),
        sortOrder: z.number().optional(),
        isPublished: z.boolean().optional(),
      },
      async ({ title, slug, content, parentId, sortOrder, isPublished }) => {
        const body = { title, slug };
        if (content !== undefined) body.content = content;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        if (isPublished !== undefined) body.is_published = isPublished;
        const res = await apiCall("POST", `/agencies/${agencyId()}/wiki`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "search_wiki",
      "Search wiki pages",
      { q: z.string().min(2), projectId: z.string().optional() },
      async ({ q, projectId }) => {
        const params = new URLSearchParams({ q });
        if (projectId) params.append("project_id", projectId);
        const res = await apiCall("GET", `/agencies/${agencyId()}/wiki/search?${params}`);
        const results = (res.results || []).map(r => ({ id: r.id, title: r.title, slug: r.slug, headline: r.headline }));
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.server.tool(
      "get_wiki_page",
      "Get a wiki page by slug",
      { slug: z.string() },
      async ({ slug }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/wiki/${slug}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_wiki_page",
      "Update a wiki page",
      {
        slug: z.string(),
        title: z.string().optional(),
        newSlug: z.string().optional(),
        content: z.object({}).optional(),
        parentId: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
        isPublished: z.boolean().optional(),
      },
      async ({ slug, title, newSlug, content, parentId, sortOrder, isPublished }) => {
        const body = {};
        if (title !== undefined) body.title = title;
        if (newSlug !== undefined) body.slug = newSlug;
        if (content !== undefined) body.content = content;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        if (isPublished !== undefined) body.is_published = isPublished;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/wiki/${slug}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_wiki_page",
      "Delete a wiki page",
      { slug: z.string() },
      async ({ slug }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/wiki/${slug}`);
        return { content: [{ type: "text", text: "Wiki page deleted." }] };
      }
    );

    this.server.tool(
      "get_wiki_page_revisions",
      "Get revision history for a wiki page",
      { pageId: z.string() },
      async ({ pageId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/wiki/${pageId}/revisions`);
        const revisions = (res.revisions || []).map(r => ({ id: r.id, editedBy: r.edited_by, createdAt: r.created_at }));
        return { content: [{ type: "text", text: JSON.stringify(revisions, null, 2) }] };
      }
    );

    // §18 Wiki (project-scoped)
    this.server.tool(
      "list_project_wiki_pages",
      "List wiki pages for a project",
      { projectId: z.string(), includeDrafts: z.boolean().optional() },
      async ({ projectId, includeDrafts }) => {
        const params = includeDrafts ? `?include_drafts=true` : "";
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/wiki${params}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_project_wiki_page",
      "Create a wiki page for a project",
      {
        projectId: z.string(),
        title: z.string(),
        slug: z.string(),
        content: z.object({}).optional(),
        parentId: z.string().optional(),
        sortOrder: z.number().optional(),
        isPublished: z.boolean().optional(),
      },
      async ({ projectId, title, slug, content, parentId, sortOrder, isPublished }) => {
        const body = { title, slug };
        if (content !== undefined) body.content = content;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        if (isPublished !== undefined) body.is_published = isPublished;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/wiki`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "get_project_wiki_page",
      "Get a project wiki page by slug",
      { projectId: z.string(), slug: z.string() },
      async ({ projectId, slug }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/wiki/${slug}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project_wiki_page",
      "Update a project wiki page",
      {
        projectId: z.string(),
        slug: z.string(),
        title: z.string().optional(),
        newSlug: z.string().optional(),
        content: z.object({}).optional(),
        parentId: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
        isPublished: z.boolean().optional(),
      },
      async ({ projectId, slug, title, newSlug, content, parentId, sortOrder, isPublished }) => {
        const body = {};
        if (title !== undefined) body.title = title;
        if (newSlug !== undefined) body.slug = newSlug;
        if (content !== undefined) body.content = content;
        if (parentId !== undefined) body.parent_id = parentId;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        if (isPublished !== undefined) body.is_published = isPublished;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/wiki/${slug}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_project_wiki_page",
      "Delete a project wiki page",
      { projectId: z.string(), slug: z.string() },
      async ({ projectId, slug }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/wiki/${slug}`);
        return { content: [{ type: "text", text: "Project wiki page deleted." }] };
      }
    );

    // §19 Project Categories
    this.server.tool(
      "list_project_categories",
      "List project categories",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/project-categories`);
        const categories = (res.items || []).map(c => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sort_order }));
        return { content: [{ type: "text", text: JSON.stringify(categories, null, 2) }] };
      }
    );

    this.server.tool(
      "create_project_category",
      "Create a project category",
      {
        name: z.string(),
        color: z.string().optional(),
        sortOrder: z.number().optional(),
      },
      async ({ name, color, sortOrder }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        const res = await apiCall("POST", `/agencies/${agencyId()}/project-categories`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project_category",
      "Update a project category",
      {
        categoryId: z.string(),
        name: z.string().optional(),
        color: z.string().optional(),
        sortOrder: z.number().optional(),
      },
      async ({ categoryId, name, color, sortOrder }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (sortOrder !== undefined) body.sort_order = sortOrder;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/project-categories/${categoryId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_project_category",
      "Delete a project category",
      { categoryId: z.string() },
      async ({ categoryId }) => {
        await apiCall("DELETE", `/agencies/${agencyId()}/project-categories/${categoryId}`);
        return { content: [{ type: "text", text: "Category deleted." }] };
      }
    );

    this.server.tool(
      "reorder_project_categories",
      "Reorder project categories",
      { items: z.array(z.object({ id: z.string(), sortOrder: z.number() })) },
      async ({ items }) => {
        const body = { items: items.map(i => ({ id: i.id, sort_order: i.sortOrder })) };
        const res = await apiCall("PUT", `/agencies/${agencyId()}/project-categories/reorder`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §20a Project Statuses
    this.server.tool(
      "list_project_statuses",
      "List project statuses",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/project-statuses`);
        const statuses = (res.items || []).map(s => ({ id: s.id, name: s.name, color: s.color }));
        return { content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }] };
      }
    );

    this.server.tool(
      "create_project_status",
      "Create a project status",
      { name: z.string(), color: z.string().optional() },
      async ({ name, color }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        const res = await apiCall("POST", `/agencies/${agencyId()}/project-statuses`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project_status",
      "Update a project status",
      { statusId: z.string(), name: z.string().optional(), color: z.string().optional() },
      async ({ statusId, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/project-statuses/${statusId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_project_status",
      "Delete a project status",
      { statusId: z.string(), replacementId: z.string() },
      async ({ statusId, replacementId }) => {
        const res = await apiCall("DELETE", `/agencies/${agencyId()}/project-statuses/${statusId}`, { replacement_id: replacementId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "reorder_project_statuses",
      "Reorder project statuses",
      { items: z.array(z.object({ id: z.string(), sortOrder: z.number() })) },
      async ({ items }) => {
        const body = { items: items.map(i => ({ id: i.id, sort_order: i.sortOrder })) };
        const res = await apiCall("PUT", `/agencies/${agencyId()}/project-statuses/reorder`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §20b Task Statuses (Agency defaults)
    this.server.tool(
      "list_task_statuses",
      "List agency default task statuses",
      async () => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/task-statuses`);
        const statuses = (res.items || []).map(s => ({ id: s.id, name: s.name, color: s.color }));
        return { content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task_status",
      "Create an agency task status",
      { name: z.string(), color: z.string().optional() },
      async ({ name, color }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        const res = await apiCall("POST", `/agencies/${agencyId()}/task-statuses`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_task_status",
      "Update an agency task status",
      { statusId: z.string(), name: z.string().optional(), color: z.string().optional() },
      async ({ statusId, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/task-statuses/${statusId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_task_status",
      "Delete an agency task status",
      { statusId: z.string(), replacementId: z.string() },
      async ({ statusId, replacementId }) => {
        const res = await apiCall("DELETE", `/agencies/${agencyId()}/task-statuses/${statusId}`, { replacement_id: replacementId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "reorder_task_statuses",
      "Reorder agency task statuses",
      { items: z.array(z.object({ id: z.string(), sortOrder: z.number() })) },
      async ({ items }) => {
        const body = { items: items.map(i => ({ id: i.id, sort_order: i.sortOrder })) };
        const res = await apiCall("PUT", `/agencies/${agencyId()}/task-statuses/reorder`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    // §20c Task Statuses (Project overrides)
    this.server.tool(
      "list_project_task_statuses",
      "List task statuses for a project",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/task-statuses`);
        const statuses = (res.items || []).map(s => ({ id: s.id, name: s.name, color: s.color }));
        return { content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }] };
      }
    );

    this.server.tool(
      "create_project_task_status",
      "Create a task status for a project",
      { projectId: z.string(), name: z.string(), color: z.string().optional() },
      async ({ projectId, name, color }) => {
        const body = { name };
        if (color !== undefined) body.color = color;
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/task-statuses`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "update_project_task_status",
      "Update a project task status",
      { projectId: z.string(), statusId: z.string(), name: z.string().optional(), color: z.string().optional() },
      async ({ projectId, statusId, name, color }) => {
        const body = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        if (Object.keys(body).length === 0) {
          return { content: [{ type: "text", text: "No fields to update." }] };
        }
        const res = await apiCall("PATCH", `/agencies/${agencyId()}/projects/${projectId}/task-statuses/${statusId}`, body);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "delete_project_task_status",
      "Delete a project task status",
      { projectId: z.string(), statusId: z.string(), replacementId: z.string() },
      async ({ projectId, statusId, replacementId }) => {
        const res = await apiCall("DELETE", `/agencies/${agencyId()}/projects/${projectId}/task-statuses/${statusId}`, { replacement_id: replacementId });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "reset_project_task_statuses",
      "Reset project task statuses to agency defaults",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("POST", `/agencies/${agencyId()}/projects/${projectId}/task-statuses/reset-to-defaults`, {});
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );
  }
}

const htmlEscape = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

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
  <p class="sub">${htmlEscape(clientName)} is requesting access to your account.</p>
  ${errorMsg ? `<div class="err">${htmlEscape(errorMsg)}</div>` : ""}
  <input name="email" type="email" placeholder="Email" required autofocus>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Sign in</button>
</form>
</body></html>`;

const loginHandler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "iv-mavengang-mcp" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/authorize") {
      const clientId = url.searchParams.get("client_id");
      const scope = url.searchParams.get("scope") || "mcp";
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const responseType = url.searchParams.get("response_type") || "code";

      if (request.method === "GET") {
        const codeChallenge = url.searchParams.get("code_challenge") || "";
        const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
        const clientState = url.searchParams.get("state") || "";

        let clientName = "your IDE";
        if (clientId) {
          try {
            const clientInfo = await env.OAUTH_PROVIDER.lookupClient(clientId);
            clientName = clientInfo?.clientName || "your IDE";
          } catch (e) {}
        }

        const stateId = crypto.randomUUID();
        const oauthReq = {
          clientId: clientId || undefined,
          redirectUri,
          scope: scope.split(" ").filter(s => s),
          responseType,
          codeChallenge: codeChallenge || undefined,
          codeChallengeMethod: codeChallengeMethod || "S256",
          state: clientState || undefined,
        };

        await env.OAUTH_KV.put(`oauth_state:${stateId}`, JSON.stringify(oauthReq), { expirationTtl: 600 });

        const html = loginPageHtml("", clientName)
          .replace(`action=""`, `action="/authorize?state=${stateId}"`);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      if (request.method === "POST") {
        const stateId = url.searchParams.get("state");
        if (!stateId) {
          return new Response("Missing state parameter", { status: 400 });
        }

        let savedReq;
        try {
          const stored = await env.OAUTH_KV.get(`oauth_state:${stateId}`);
          if (!stored) {
            return new Response("Invalid or expired state", { status: 400 });
          }
          savedReq = JSON.parse(stored);
          await env.OAUTH_KV.delete(`oauth_state:${stateId}`);
        } catch {
          return new Response("Invalid state parameter", { status: 400 });
        }
        
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

          if (!meRes.memberships || meRes.memberships.length === 0) {
            const html = loginPageHtml("No agency found. Please create an agency first.", savedReq?.clientName);
            return new Response(html, { status: 400, headers: { "Content-Type": "text/html" } });
          }

          const agencyId = meRes.memberships[0].agency_id;

          await env.OAUTH_KV.put(`tokens:${email}`, JSON.stringify({
            accessToken: loginRes.access_token,
            refreshToken: loginRes.refresh_token,
          }), { expirationTtl: 604800 }); // 7 days - matches typical refresh token TTL

          const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
            request: savedReq,
            userId: email,
            scope: savedReq.scope || ["mcp"],
            props: {
              email,
              agencyId,
              accessToken: loginRes.access_token,
              refreshToken: loginRes.refresh_token,
            },
          });
          return Response.redirect(redirectTo, 302);
        } catch (err) {
          let clientName = "your IDE";
          if (savedReq?.clientId) {
            try {
              const clientInfo = await env.OAUTH_PROVIDER.lookupClient(savedReq.clientId);
              clientName = clientInfo?.clientName || "your IDE";
            } catch {}
          }
          const html = loginPageHtml("Wrong email or password", clientName);
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

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandlers: {
    "/mcp": MavenGangMCP.serve("/mcp"),
  },
  defaultHandler: loginHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  accessTokenTTL: 2592000,
});