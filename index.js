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
    const err = new Error(`MavenGang API ${res.status}`);
    err.status = res.status;
    try { err.data = await res.json(); } catch {}
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
    const apiCall = async (method, path, body = null) => {
      const baseUrl = this.env.BASE_URL;
      try {
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      } catch (err) {
        if (err.status !== 401) throw err;
        const refreshed = await mgFetch("/auth/refresh", {
          method: "POST", baseUrl,
          body: { refreshToken: this.props.refreshToken },
        });
        this.props.accessToken = refreshed.access_token;
        this.props.refreshToken = refreshed.refresh_token;
        return await mgFetch(path, {
          method, body, baseUrl,
          headers: authHeaders(this.props.accessToken),
        });
      }
    };

    const agencyId = () => this.props.agencyId;

    this.server.tool(
      "list_projects",
      "List all projects in your Maven Gang account",
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
      "Get details of a single project",
      { projectId: z.string() },
      async ({ projectId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "list_tasks",
      "List tasks in a project. Pass parentId to get subtasks.",
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
      "Get full details of a single task",
      { projectId: z.string(), taskId: z.string() },
      async ({ projectId, taskId }) => {
        const res = await apiCall("GET", `/agencies/${agencyId()}/projects/${projectId}/tasks/${taskId}`);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      }
    );

    this.server.tool(
      "create_task",
      "Create a new task or subtask",
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
      "Update task status, assignee, priority, title, or due date",
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
      "List members of a project with user IDs for assignment",
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
      "Get all tasks assigned to current user across all projects",
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
      "Add a comment to a task",
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
      "List comments on a task",
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

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "iv-mavengang-mcp" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/authorize") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);

      if (request.method === "GET") {
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

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandlers: {
    "/mcp": MavenGangMCP.serve("/mcp"),
  },
  defaultHandler: loginHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  accessTokenTTL: 3600,
});