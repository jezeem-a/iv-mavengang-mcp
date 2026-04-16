import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { hashKey, getSession, saveSession, deleteSession } from "./session-store.js";

// --- Helper: call MavenGang API using native fetch ---

async function mgFetch(path, options = {}, env) {
  const baseUrl = env.BASE_URL || "https://mavengang.com/v1";
  const url = `${baseUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = new Error(`MavenGang API error: ${res.status}`);
    err.status = res.status;
    try { err.data = await res.json(); } catch {}
    throw err;
  }
  return res.json();
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// --- Error response helper ---

function errorResponse(code, message, status = 400) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-session-key, Mcp-Session-Id"
    }
  });
}

// --- CORS preflight ---

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-session-key, Mcp-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

// --- Rate limiting (in-memory per worker instance, best-effort) ---

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

// --- Login page HTML ---

const loginPage = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .success { display: none; }
    .success.show { display: block; }
    .success h2 { color: #28a745; font-size: 1.25rem; margin-bottom: 1rem; }
    pre { background: #f8f8f8; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.875rem; margin-bottom: 1rem; }
    .copy-btn { padding: 0.5rem 1rem; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 1.5rem; width: auto; }
    .copy-btn:hover { background: #218838; }
    table { width: 100%; font-size: 0.875rem; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { color: #555; }
    td code { background: #f0f0f0; padding: 2px 4px; border-radius: 2px; font-size: 0.8rem; }
    .note { margin-top: 1.5rem; color: #666; font-size: 0.875rem; }
    .ide-tabs { display: flex; gap: 4px; margin-bottom: 1rem; flex-wrap: wrap; }
    .ide-tab { padding: 8px 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    .ide-tab:hover { background: #f5f5f5; }
    .ide-tab.active { background: #007bff; color: #fff; border-color: #007bff; }
    .ide-config pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; margin: 0.5rem 0; }
    .ide-config .config-path { color: #666; font-size: 0.8rem; margin: 0.5rem 0; }
    .ide-config .config-path code { background: #f0f0f0; padding: 2px 6px; border-radius: 2px; }
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
      <button id="login-btn" onclick="doLogin()">Login</button>
    </div>
    <div class="success" id="success">
      <h2>&#10003; Logged In</h2>
      <p style="margin-bottom:0.5rem;color:#555;">Copy the config for your IDE:</p>
      
      <div class="ide-tabs">
        <button class="ide-tab active" onclick="showIde('claude-desktop')">Claude Desktop</button>
        <button class="ide-tab" onclick="showIde('claude-code')">Claude Code</button>
        <button class="ide-tab" onclick="showIde('cursor')">Cursor</button>
        <button class="ide-tab" onclick="showIde('opencode')">opencode</button>
        <button class="ide-tab" onclick="showIde('windsurf')">Windsurf</button>
        <button class="ide-tab" onclick="showIde('vscode')">VS Code</button>
      </div>
      
      <div id="ide-config-claude-desktop" class="ide-config">
        <pre></pre>
        <p class="config-path">File: <code>~/.claude/claude_desktop_config.json</code></p>
        <button class="copy-btn" onclick="copyIdeConfig('claude-desktop')">Copy</button>
      </div>
      <div id="ide-config-claude-code" class="ide-config" style="display:none">
        <pre></pre>
        <p class="config-path">File: <code>~/.claude/settings.json</code> or use CLI: <code>claude mcp add</code></p>
        <button class="copy-btn" onclick="copyIdeConfig('claude-code')">Copy</button>
      </div>
      <div id="ide-config-cursor" class="ide-config" style="display:none">
        <pre></pre>
        <p class="config-path">File: <code>~/.cursor/mcp.json</code></p>
        <button class="copy-btn" onclick="copyIdeConfig('cursor')">Copy</button>
      </div>
      <div id="ide-config-opencode" class="ide-config" style="display:none">
        <pre></pre>
        <p class="config-path">File: <code>~/.config/opencode/config.json</code> or CLI: <code>opencode config add mcp</code></p>
        <button class="copy-btn" onclick="copyIdeConfig('opencode')">Copy</button>
      </div>
      <div id="ide-config-windsurf" class="ide-config" style="display:none">
        <pre></pre>
        <p class="config-path">File: <code>~/.codeium/windsurf/mcp_config.json</code></p>
        <button class="copy-btn" onclick="copyIdeConfig('windsurf')">Copy</button>
      </div>
      <div id="ide-config-vscode" class="ide-config" style="display:none">
        <pre></pre>
        <p class="config-path">File: <code>.vscode/mcp.json</code> in your workspace</p>
        <button class="copy-btn" onclick="copyIdeConfig('vscode')">Copy</button>
      </div>
      
      <p class="note">⚠️ Quit/restart your IDE or terminal session for changes to take effect.</p>
    </div>
  </div>
  <script>
    async function doLogin() {
      const btn = document.getElementById('login-btn');
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const error = document.getElementById('error');
      error.classList.remove('show');
      btn.disabled = true;
      btn.textContent = 'Logging in...';
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
          btn.disabled = false;
          btn.textContent = 'Login';
          return;
        }
        
        // Success - show config
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('success').classList.add('show');
        
        const baseUrl = window.location.origin + '/mcp';
        const sessionKey = data.session_key;
        
        var standardConfig = {
          mcpServers: {
            mavengang: {
              url: baseUrl,
              headers: { 'x-session-key': sessionKey }
            }
          }
        };
        
        var windsurfConfig = {
          mcpServers: {
            mavengang: {
              serverUrl: baseUrl,
              headers: { 'x-session-key': sessionKey }
            }
          }
        };
        
        var vscodeConfig = {
          servers: {
            mavengang: {
              url: baseUrl,
              headers: { 'x-session-key': sessionKey }
            }
          }
        };
        
        document.querySelector('#ide-config-claude-desktop pre').textContent = JSON.stringify(standardConfig, null, 2);
        document.querySelector('#ide-config-claude-code pre').textContent = JSON.stringify(standardConfig, null, 2);
        document.querySelector('#ide-config-cursor pre').textContent = JSON.stringify(standardConfig, null, 2);
        document.querySelector('#ide-config-opencode pre').textContent = JSON.stringify(standardConfig, null, 2);
        document.querySelector('#ide-config-windsurf pre').textContent = JSON.stringify(windsurfConfig, null, 2);
        document.querySelector('#ide-config-vscode pre').textContent = JSON.stringify(vscodeConfig, null, 2);
      } catch (e) {
        error.textContent = 'Network error. Please try again.';
        error.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Login';
      }
    }
    
    function showIde(ide) {
        var tabs = document.querySelectorAll('.ide-tab');
        var configs = document.querySelectorAll('.ide-config');
        for (var i = 0; i < tabs.length; i++) {
          tabs[i].classList.remove('active');
        }
        for (var j = 0; j < configs.length; j++) {
          configs[j].style.display = 'none';
        }
        var activeTab = document.querySelector('.ide-tab[onclick="showIde(\'' + ide + '\')"]');
        if (activeTab) activeTab.classList.add('active');
        var activeConfig = document.getElementById('ide-config-' + ide);
        if (activeConfig) activeConfig.style.display = 'block';
      }
      
      function copyIdeConfig(ide) {
        var configEl = document.querySelector('#ide-config-' + ide + ' pre');
        var text = configEl ? configEl.textContent : '';
        navigator.clipboard.writeText(text);
        var btn = document.querySelector('#ide-config-' + ide + ' .copy-btn');
        if (btn) {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
        }
      }
    </script>
  </body>
</html>`;

// --- Build MCP server with all 10 tools ---
// Context (kv, env, sessionKey, session, keyHash) passed via closure, not extra

function createMcpServer({ kv, env, session, keyHash }) {
  const server = new McpServer({
    name: "mavengang",
    version: "1.0.0",
    description: "Maven Gang Project Management API"
  });

  // Helper: make authenticated API call with auto-refresh (uses closure vars)
  async function apiCall(method, path, body) {
    try {
      return await mgFetch(path, { method, headers: authHeaders(session.access_token), body }, env);
    } catch (err) {
      if (err.status === 401) {
        try {
          const refreshed = await mgFetch("/auth/refresh", {
            method: "POST",
            body: { refreshToken: session.refresh_token }
          }, env);
          session.access_token = refreshed.access_token;
          session.refresh_token = refreshed.refresh_token;
          await saveSession(kv, keyHash, session);
          return await mgFetch(path, { method, headers: authHeaders(session.access_token), body }, env);
        } catch {
          await deleteSession(kv, keyHash);
          throw new Error("MAVENGANG_AUTH_FAILED");
        }
      }
      throw err;
    }
  }

  // 1. list_projects
  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all projects in your Maven Gang account.",
      inputSchema: z.object({})
    },
    async () => {
      const res = await apiCall("GET", `/agencies/${session.agency_id}/projects`, null);
      const projects = res.items.map(p => ({
        id: p.id, name: p.name, key: p.key, status: p.status,
        client: p.clients?.[0]?.name || "No client",
        category: p.category_name,
        taskTotal: p.task_total, taskCompleted: p.task_completed
      }));
      return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
    }
  );

  // 2. get_project
  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description: "Get details of a single project.",
      inputSchema: z.object({
        projectId: z.string().describe("Project ID from list_projects")
      })
    },
    async ({ projectId }) => {
      const res = await apiCall("GET", `/agencies/${session.agency_id}/projects/${projectId}`, null);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // 3. list_tasks
  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List tasks in a project. Pass parentId to get subtasks.",
      inputSchema: z.object({
        projectId: z.string().describe("Project ID from list_projects"),
        status: z.enum(["todo", "in_progress", "in_qa", "done"]).describe("Filter by status").optional(),
        parentId: z.string().describe("Parent task ID for subtasks").optional()
      })
    },
    async ({ projectId, status, parentId }) => {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      if (parentId) params.append("parent_id", parentId);
      const query = params.toString() ? "?" + params.toString() : "";
      const res = await apiCall("GET", `/agencies/${session.agency_id}/projects/${projectId}/tasks${query}`, null);
      const tasks = res.items.map(t => ({
        id: t.id, taskNumber: t.task_number, title: t.title,
        description: t.description || "",
        status: t.status_name || t.status, priority: t.priority,
        assignedTo: t.assigned_user ? `${t.assigned_user.first_name} ${t.assigned_user.last_name}` : "Unassigned",
        isSubtask: !!t.parent_id, dueDate: t.due_date
      }));
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // 4. get_task
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
    async ({ projectId, taskId }) => {
      const res = await apiCall("GET", `/agencies/${session.agency_id}/projects/${projectId}/tasks/${taskId}`, null);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // 5. create_task
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
    async ({ projectId, title, description, parentId, assignedUserId, priority, dueDate, status }) => {
      const body = { title };
      if (description) body.description = description;
      if (parentId) body.parent_id = parentId;
      if (assignedUserId) body.assigned_user_id = assignedUserId;
      if (priority !== undefined) body.priority = priority;
      if (dueDate) body.due_date = dueDate;
      if (status) body.status = status;
      const res = await apiCall("POST", `/agencies/${session.agency_id}/projects/${projectId}/tasks`, body);
      const task = res.task;
      return {
        content: [{
          type: "text",
          text: `Task created: ${task.task_number} - "${task.title}"\nStatus: ${task.status_name}\nAssigned: ${task.assigned_user?.first_name || "Unassigned"}`
        }]
      };
    }
  );

  // 6. update_task
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
    async ({ projectId, taskId, title, status, assignedUserId, priority, dueDate }) => {
      const body = {};
      if (title) body.title = title;
      if (status) body.status = status;
      if (assignedUserId) body.assigned_user_id = assignedUserId;
      if (priority !== undefined) body.priority = priority;
      if (dueDate) body.due_date = dueDate;
      const res = await apiCall("PATCH", `/agencies/${session.agency_id}/projects/${projectId}/tasks/${taskId}`, body);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // 7. list_project_members
  server.registerTool(
    "list_project_members",
    {
      title: "List Project Members",
      description: "List members of a project with user IDs for assignment.",
      inputSchema: z.object({
        projectId: z.string().describe("Project ID from list_projects")
      })
    },
    async ({ projectId }) => {
      const res = await apiCall("GET", `/agencies/${session.agency_id}/projects/${projectId}/members`, null);
      const members = (res.items || res).map(m => ({
        userId: m.user_id, firstName: m.first_name, lastName: m.last_name, role: m.role
      }));
      return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
    }
  );

  // 8. get_my_tasks
  server.registerTool(
    "get_my_tasks",
    {
      title: "Get My Tasks",
      description: "Get all tasks assigned to current user across all projects.",
      inputSchema: z.object({
        status: z.string().describe("Filter by status: todo,in_progress").optional(),
        sort: z.enum(["due_date", "priority", "created_at"]).describe("Sort by").optional(),
        limit: z.number().describe("Limit (default 20, max 100)").optional()
      })
    },
    async ({ status, sort, limit }) => {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      if (sort) params.append("sort", sort);
      if (limit) params.append("limit", limit.toString());
      const query = params.toString() ? "?" + params.toString() : "";
      const res = await apiCall("GET", `/agencies/${session.agency_id}/my-tasks${query}`, null);
      const tasks = res.items.map(t => ({
        taskNumber: t.task_number, title: t.title,
        status: t.status_name || t.status, priority: t.priority,
        dueDate: t.due_date, projectId: t.project_id, projectName: t.project_name
      }));
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // 9. add_comment
  server.registerTool(
    "add_comment",
    {
      title: "Add Comment",
      description: "Add a comment to a task.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID"),
        content: z.string().describe("Comment content"),
        parentId: z.string().describe("Parent comment ID for replies").optional()
      })
    },
    async ({ taskId, content, parentId }) => {
      const body = { entity_type: "task", entity_id: taskId, content, parent_id: parentId || null };
      const res = await apiCall("POST", `/agencies/${session.agency_id}/comments`, body);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
  );

  // 10. list_comments
  server.registerTool(
    "list_comments",
    {
      title: "List Comments",
      description: "List comments on a task.",
      inputSchema: z.object({
        taskId: z.string().describe("Task ID")
      })
    },
    async ({ taskId }) => {
      const res = await apiCall("GET", `/agencies/${session.agency_id}/comments?entity_type=task&entity_id=${taskId}`, null);
      const comments = (res.items || []).map(c => ({
        id: c.id, content: c.content,
        author: c.author ? `${c.author.first_name} ${c.author.last_name}` : "Unknown",
        createdAt: c.created_at, parentId: c.parent_id
      }));
      return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
    }
  );

  return server;
}

// --- Login handler ---

async function handleLogin(request, env) {
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";

  if (!checkRateLimit(clientIp)) {
    return errorResponse("RATE_LIMITED", "Too many attempts. Try again in 15 minutes.", 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse("VALIDATION_ERROR", "Email and password required", 400);
  }

  try {
    const loginRes = await mgFetch("/auth/login", { method: "POST", body: { email, password } }, env);
    const meRes = await mgFetch("/auth/me", { headers: authHeaders(loginRes.access_token) }, env);
    const agencyId = meRes.memberships[0].agency_id;
    const agencyName = meRes.memberships[0].agency_name;

    const sessionKey = crypto.randomUUID();
    const keyHash = await hashKey(sessionKey);
    await saveSession(env.SESSIONS, keyHash, {
      access_token: loginRes.access_token,
      refresh_token: loginRes.refresh_token,
      agency_id: agencyId,
      email
    });

    return new Response(JSON.stringify({
      session_key: sessionKey,
      email,
      agency_name: agencyName
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  } catch (err) {
    return errorResponse("INVALID_CREDENTIALS", "Wrong email or password", 401);
  }
}

// --- Cloudflare Workers entry point ---

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Login page
    if (path === "/login" && method === "GET") {
      return new Response(loginPage, {
        headers: { "Content-Type": "text/html", ...corsHeaders() }
      });
    }

    // Login API
    if (path === "/login" && method === "POST") {
      return handleLogin(request, env);
    }

    // Logout
    if (path === "/logout" && method === "POST") {
      const sessionKey = request.headers.get("x-session-key");
      if (sessionKey) {
        const keyHash = await hashKey(sessionKey);
        await deleteSession(env.SESSIONS, keyHash);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    // Health check
    if (path === "/" && method === "GET") {
      return new Response(JSON.stringify({ status: "ok", service: "iv-mavengang-mcp" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // MCP endpoint
    if (path === "/mcp") {
      const sessionKey = request.headers.get("x-session-key");
      if (!sessionKey) {
        return errorResponse("SESSION_INVALID", "Missing x-session-key header", 401);
      }

      const keyHash = await hashKey(sessionKey);
      const session = await getSession(env.SESSIONS, keyHash);
      if (!session) {
        return errorResponse("SESSION_INVALID", "Session expired. Please re-login.", 401);
      }

      // Create new server per request
      const server = createMcpServer({ kv: env.SESSIONS, env, session, keyHash });

      // Stateless transport
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      await server.connect(transport);

      // Override Accept header to ensure MCP protocol works
      const headers = new Headers(request.headers);
      headers.set("Accept", "application/json, text/event-stream");
      const modifiedRequest = new Request(request, { headers });

      return transport.handleRequest(modifiedRequest);
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
};
