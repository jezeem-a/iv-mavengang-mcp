import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import axios from "axios";
import z from "zod";

const BASE_URL = process.env.BASE_URL || "https://mavengang.com/v1";
const PORT = parseInt(process.env.PORT || "3001");

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" }
});

const sessions = new Map();

async function hashKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function getSession(keyHash) {
  return sessions.get(keyHash);
}

function saveSession(keyHash, entry) {
  sessions.set(keyHash, entry);
}

function deleteSession(keyHash) {
  sessions.delete(keyHash);
}

async function loginToMavenGang(email, password) {
  const res = await api.post("/auth/login", { email, password });
  return res.data;
}

async function getMe(accessToken) {
  const res = await api.get("/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.data;
}

async function refreshToken(refreshToken) {
  const res = await api.post("/auth/refresh", { refreshToken });
  return res.data;
}

function createErrorResponse(code, message, status = 400) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-session-key, Mcp-Session-Id" }
  });
}

const loginPage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Maven Gang - Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 100%; max-width: 420px; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #333; }
    .error { background: #fee; color: #c00; padding: 0.75rem; border-radius: 4px; margin-bottom: 1rem; display: none; }
    .error.show { display: block; }
    label { display: block; margin-bottom: 0.5rem; color: #555; font-size: 0.875rem; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 1rem; font-size: 1rem; }
    input:focus { outline: none; border-color: #007bff; }
    button { width: 100%; padding: 0.75rem; background: #007bff; color: white; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
    button:hover { background: #0056b3; }
    .success { display: none; }
    .success.show { display: block; }
    .success h2 { color: #28a745; font-size: 1.25rem; margin-bottom: 1rem; }
    pre { background: #f8f8f8; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.875rem; margin-bottom: 1rem; }
    .copy-btn { padding: 0.5rem 1rem; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 1.5rem; }
    .copy-btn:hover { background: #218838; }
    table { width: 100%; font-size: 0.875rem; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { color: #555; }
    .note { margin-top: 1.5rem; color: #666; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <div id="login-form">
      <h1>Maven Gang Login</h1>
      <div class="error" id="error"></div>
      <label>Email</label>
      <input type="email" id="email" required>
      <label>Password</label>
      <input type="password" id="password" required>
      <button type="submit" form="login-form" onclick="doLogin()">Login</button>
    </div>
    <div class="success" id="success">
      <h2>Logged In</h2>
      <pre id="config-json"></pre>
      <button class="copy-btn" onclick="copyConfig()">Copy Config</button>
      <table>
        <tr><th>Tool</th><th>Config File</th></tr>
        <tr><td>Claude Code</td><td>~/.claude/claude_desktop_config.json</td></tr>
        <tr><td>Cursor</td><td>~/.cursor/mcp.json</td></tr>
        <tr><td>opencode</td><td>~/.config/opencode/config.json</td></tr>
        <tr><td>Windsurf</td><td>~/.codeium/windsurf/mcp_config.json</td></tr>
      </table>
      <p class="note">Paste the JSON into your IDE's config file and restart.</p>
    </div>
  </div>
  <script>
    const SERVER_URL = window.location.origin;
    async function doLogin() {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const error = document.getElementById('error');
      error.classList.remove('show');
      try {
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          error.textContent = data.error?.message || 'Login failed';
          error.classList.add('show');
          return;
        }
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('success').classList.add('show');
        document.getElementById('config-json').textContent = JSON.stringify({
          mcpServers: {
            mavengang: {
              url: SERVER_URL + '/mcp',
              headers: { 'x-session-key': data.session_key }
            }
          }
        }, null, 2);
      } catch (e) {
        error.textContent = 'Network error';
        error.classList.add('show');
      }
    }
    function copyConfig() {
      const text = document.getElementById('config-json').textContent;
      navigator.clipboard.writeText(text);
      document.querySelector('.copy-btn').textContent = 'Copied!';
      setTimeout(() => document.querySelector('.copy-btn').textContent = 'Copy Config', 2000);
    }
  </script>
</body>
</html>`;

const server = new McpServer({
  name: "mavengang",
  version: "1.0.0",
  description: "Maven Gang Project Management API"
});

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List all projects in your Maven Gang account.",
    inputSchema: z.object({})
  },
  async (_, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const res = await api.get(`/agencies/${session.agency_id}/projects`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const projects = res.data.items.map(p => ({
      id: p.id,
      name: p.name,
      key: p.key,
      status: p.status,
      client: p.clients?.[0]?.name || "No client",
      category: p.category_name,
      taskTotal: p.task_total,
      taskCompleted: p.task_completed
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      structuredContent: { projects }
    };
  }
);

server.registerTool(
  "get_project",
  {
    title: "Get Project",
    description: "Get details of a single project.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects")
    })
  },
  async ({ projectId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const res = await api.get(`/agencies/${session.agency_id}/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
      structuredContent: res.data
    };
  }
);

server.registerTool(
  "list_tasks",
  {
    title: "List Tasks",
    description: "List tasks in a project.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      status: z.enum(["todo", "in_progress", "in_qa", "done"]).describe("Filter by status").optional(),
      parentId: z.string().describe("Parent task ID for subtasks").optional()
    })
  },
  async ({ projectId, status, parentId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (parentId) params.append("parent_id", parentId);
    const query = params.toString() ? "?" + params.toString() : "";
    
    const res = await api.get(`/agencies/${session.agency_id}/projects/${projectId}/tasks${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const tasks = res.data.items.map(t => ({
      id: t.id,
      taskNumber: t.task_number,
      title: t.title,
      description: t.description || "",
      status: t.status_name || t.status,
      priority: t.priority,
      assignedTo: t.assigned_user?.first_name + " " + t.assigned_user?.last_name || "Unassigned",
      isSubtask: !!t.parent_id,
      dueDate: t.due_date
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
      structuredContent: { tasks }
    };
  }
);

server.registerTool(
  "get_task",
  {
    title: "Get Task",
    description: "Get full details of a single task.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      taskId: z.string().describe("Task ID from list_tasks")
    })
  },
  async ({ projectId, taskId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const res = await api.get(`/agencies/${session.agency_id}/projects/${projectId}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
      structuredContent: res.data
    };
  }
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create a new task or subtask.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      title: z.string().describe("Task title"),
      description: z.string().describe("Task description").optional(),
      parentId: z.string().describe("Parent task ID for subtask").optional(),
      assignedUserId: z.string().describe("User ID to assign").optional(),
      priority: z.number().describe("Priority: 0=none, 1=low, 2=medium, 3=high").optional(),
      dueDate: z.string().describe("Due date ISO format").optional(),
      status: z.enum(["todo", "in_progress", "in_qa", "done"]).describe("Status").optional()
    })
  },
  async ({ projectId, title, description, parentId, assignedUserId, priority, dueDate, status }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const body = { title };
    if (description) body.description = description;
    if (parentId) body.parent_id = parentId;
    if (assignedUserId) body.assigned_user_id = assignedUserId;
    if (priority !== undefined) body.priority = priority;
    if (dueDate) body.due_date = dueDate;
    if (status) body.status = status;
    
    const res = await api.post(`/agencies/${session.agency_id}/projects/${projectId}/tasks`, body, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const task = res.data.task;
    return {
      content: [{
        type: "text",
        text: `Task created: ${task.task_number} - "${task.title}"\nStatus: ${task.status_name}\nAssigned: ${task.assigned_user?.first_name || "Unassigned"}\nView: https://mavengang.com/projects/${projectId}/tasks/${task.id}`
      }],
      structuredContent: task
    };
  }
);

server.registerTool(
  "update_task",
  {
    title: "Update Task",
    description: "Update task status, assignee, priority, title, or due date.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      taskId: z.string().describe("Task ID from list_tasks"),
      title: z.string().describe("Task title").optional(),
      status: z.enum(["todo", "in_progress", "in_qa", "done"]).describe("Status").optional(),
      assignedUserId: z.string().describe("User ID to assign").optional(),
      priority: z.number().describe("Priority level").optional(),
      dueDate: z.string().describe("Due date ISO format").optional()
    })
  },
  async ({ projectId, taskId, title, status, assignedUserId, priority, dueDate }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const body = {};
    if (title) body.title = title;
    if (status) body.status = status;
    if (assignedUserId) body.assigned_user_id = assignedUserId;
    if (priority !== undefined) body.priority = priority;
    if (dueDate) body.due_date = dueDate;
    
    const res = await api.patch(`/agencies/${session.agency_id}/projects/${projectId}/tasks/${taskId}`, body, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
      structuredContent: res.data
    };
  }
);

server.registerTool(
  "list_project_members",
  {
    title: "List Project Members",
    description: "List members of a project.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects")
    })
  },
  async ({ projectId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const res = await api.get(`/agencies/${session.agency_id}/projects/${projectId}/members`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const members = res.data.items.map(m => ({
      userId: m.user_id,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(members, null, 2) }],
      structuredContent: { members }
    };
  }
);

server.registerTool(
  "get_my_tasks",
  {
    title: "Get My Tasks",
    description: "Get all tasks assigned to the current user.",
    inputSchema: z.object({
      status: z.string().describe("Filter by status: todo,in_progress").optional(),
      sort: z.enum(["due_date", "priority", "created_at"]).describe("Sort by").optional(),
      limit: z.number().describe("Limit (default 20)").optional()
    })
  },
  async ({ status, sort, limit }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (sort) params.append("sort", sort);
    if (limit) params.append("limit", limit.toString());
    const query = params.toString() ? "?" + params.toString() : "";
    
    const res = await api.get(`/agencies/${session.agency_id}/my-tasks${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const tasks = res.data.items.map(t => ({
      taskNumber: t.task_number,
      title: t.title,
      status: t.status_name || t.status,
      priority: t.priority,
      dueDate: t.due_date,
      projectId: t.project_id,
      projectName: t.project_name
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
      structuredContent: { tasks }
    };
  }
);

server.registerTool(
  "add_comment",
  {
    title: "Add Comment",
    description: "Add a comment to a task.",
    inputSchema: z.object({
      taskId: z.string().describe("Task ID from list_tasks"),
      content: z.string().describe("Comment content"),
      parentId: z.string().describe("Parent comment ID for replies").optional()
    })
  },
  async ({ taskId, content, parentId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const body = {
      entity_type: "task",
      entity_id: taskId,
      content,
      parent_id: parentId || null
    };
    
    const res = await api.post(`/agencies/${session.agency_id}/comments`, body, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
      structuredContent: res.data
    };
  }
);

server.registerTool(
  "list_comments",
  {
    title: "List Comments",
    description: "List comments on a task.",
    inputSchema: z.object({
      taskId: z.string().describe("Task ID from list_tasks")
    })
  },
  async ({ taskId }, sessionKey) => {
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    if (!session) throw new Error("SESSION_INVALID: Please re-login");
    
    const params = new URLSearchParams();
    params.append("entity_type", "task");
    params.append("entity_id", taskId);
    
    const res = await api.get(`/agencies/${session.agency_id}/comments?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const comments = res.data.items.map(c => ({
      id: c.id,
      content: c.content,
      author: c.author?.first_name + " " + c.author?.last_name || "Unknown",
      createdAt: c.created_at,
      parentId: c.parent_id
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
      structuredContent: { comments }
    };
  }
);

const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 5;
  const attempts = rateLimitMap.get(ip) || [];
  const recent = attempts.filter(t => now - t < windowMs);
  if (recent.length >= maxAttempts) return false;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return true;
}

async function handleLogin(req) {
  const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  
  if (!checkRateLimit(clientIp)) {
    return createErrorResponse("RATE_LIMITED", "Too many attempts. Try again in 15 minutes.", 429);
  }

  let body;
  try {
    const decoder = new TextDecoder();
    body = JSON.parse(decoder.decode(req.body));
  } catch {
    return createErrorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const { email, password } = body;
  if (!email || !password) {
    return createErrorResponse("VALIDATION_ERROR", "Email and password required", 400);
  }

  try {
    const loginRes = await loginToMavenGang(email, password);
    const meRes = await getMe(loginRes.access_token);
    const agencyId = meRes.memberships[0].agency_id;
    const agencyName = meRes.memberships[0].agency_name;

    const sessionKey = crypto.randomUUID();
    const entry = {
      access_token: loginRes.access_token,
      refresh_token: loginRes.refresh_token,
      agency_id: agencyId,
      email
    };
    const keyHash = await hashKey(sessionKey);
    saveSession(keyHash, entry);

    return new Response(JSON.stringify({
      session_key: sessionKey,
      email,
      agency_name: agencyName
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return createErrorResponse("INVALID_CREDENTIALS", "Wrong email or password", 401);
  }
}

const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID()
});

async function handleMcpRequest(req, sessionKey) {
  if (!sessionKey) {
    return createErrorResponse("SESSION_INVALID", "Missing x-session-key header", 401);
  }
  
  const keyHash = await hashKey(sessionKey);
  const session = getSession(keyHash);
  
  if (!session) {
    return createErrorResponse("SESSION_INVALID", "Session expired. Please re-login.", 401);
  }

  const authMiddleware = async (request) => {
    try {
      const response = await transport.handleRequest(request);
      return response;
    } catch (err) {
      if (err.message?.includes("401") || err.response?.status === 401) {
        try {
          const refreshed = await refreshToken(session.refresh_token);
          session.access_token = refreshed.access_token;
          session.refresh_token = refreshed.refresh_token;
          saveSession(keyHash, session);
          
          const retryRes = await api.get(`/agencies/${session.agency_id}/projects`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          });
          return retryRes;
        } catch {
          deleteSession(keyHash);
          return createErrorResponse("MAVENGANG_AUTH_FAILED", "Session expired. Please re-login.", 401);
        }
      }
      throw err;
    }
  };
  
  return transport.handleRequest(req);
}

await server.connect(transport);

async function handleRequest(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const sessionKey = req.headers.get("x-session-key");

  if (path === "/login" && method === "GET") {
    return new Response(loginPage, {
      headers: { "Content-Type": "text/html" }
    });
  }

  if (path === "/login" && method === "POST") {
    return handleLogin(req);
  }

  if (path === "/logout" && method === "POST") {
    if (sessionKey) {
      const keyHash = await hashKey(sessionKey);
      deleteSession(keyHash);
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (path === "/mcp" && (method === "POST" || method === "GET")) {
    if (!sessionKey) {
      return createErrorResponse("SESSION_INVALID", "Missing x-session-key header", 401);
    }
    
    const keyHash = await hashKey(sessionKey);
    const session = getSession(keyHash);
    
    if (!session) {
      return createErrorResponse("SESSION_INVALID", "Session expired. Please re-login.", 401);
    }

    req.headers.set("x-session-key", sessionKey);
    return transport.handleRequest(req);
  }

  return new Response("Not Found", { status: 404 });
}

if (typeof self !== "undefined" && self.addEventListener) {
  self.addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request));
  });
}

export { handleRequest, server };