import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import axios from "axios";
import dotenv from "dotenv";
import z from "zod";

dotenv.config({ quiet: true });

const api = axios.create({
  baseURL: process.env.BASE_URL || "https://mavengang.com/v1",
  headers: {
    "Content-Type": "application/json"
  }
});

let agencyId = null;
let isLoggedIn = false;

async function login() {
  if (isLoggedIn) return;

  if (!process.env.EMAIL || !process.env.PASSWORD) {
    process.stderr.write("⚠️ EMAIL and PASSWORD env vars are required\n");
    throw new Error("Missing EMAIL or PASSWORD");
  }

  try {
    const res = await api.post("/auth/login", {
      email: process.env.EMAIL,
      password: process.env.PASSWORD
    });
    api.defaults.headers.common["Authorization"] = "Bearer " + res.data.access_token;

    const me = await api.get("/auth/me");
    agencyId = me.data.memberships[0].agency_id;

    isLoggedIn = true;
    process.stderr.write("✅ Logged into Maven Gang (agency: " + agencyId + ")\n");
  } catch (err) {
    process.stderr.write("⚠️ Login error: " + err.message + "\n");
    throw err;
  }
}

const server = new McpServer({
  name: "mavengang",
  version: "1.0.0",
  description: "Maven Gang Project Management API"
});

server.registerTool(
  "list_projects",
  {
    title: "List Projects",
    description: "List all projects in your Maven Gang account. Returns project name, ID, key, status, client, and task counts.",
    inputSchema: z.object({})
  },
  async () => {
    await login();
    const res = await api.get(`/agencies/${agencyId}/projects`);
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
  "list_tasks",
  {
    title: "List Tasks",
    description: "List tasks in a project. Returns task number, title, status, and assigned user.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      status: z.enum(["todo", "in_progress", "in_qa", "done"]).describe("Filter by status (optional)").optional(),
      parentId: z.string().describe("Parent task ID to list subtasks (optional)").optional()
    })
  },
  async ({ projectId, status, parentId }) => {
    await login();
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (parentId) params.append("parent_id", parentId);

    const query = params.toString() ? "?" + params.toString() : "";
    const res = await api.get(`/agencies/${agencyId}/projects/${projectId}/tasks${query}`);
    const tasks = res.data.items.map(t => ({
      id: t.id,
      taskNumber: t.task_number,
      title: t.title,
      description: t.description || "",
      status: t.status_name || t.status,
      priority: t.priority,
      assignedTo: t.assigned_user?.first_name + " " + t.assigned_user?.last_name || "Unassigned",
      isSubtask: t.parent_id ? true : false,
      dueDate: t.due_date
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
      structuredContent: { tasks }
    };
  }
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create a new task or subtask in a Maven Gang project. Supports description, priority, assignee, and subtask creation.",
    inputSchema: z.object({
      projectId: z.string().describe("Project ID from list_projects"),
      title: z.string().describe("Task title"),
      description: z.string().describe("Task description (optional)").optional(),
      parentId: z.string().describe("Parent task ID to create a subtask (optional)").optional(),
      assignedUserId: z.string().describe("User ID to assign the task (optional)").optional(),
      priority: z.number().describe("Priority level, e.g. 0 for none, 1 for low, 2 for medium, 3 for high (optional)").optional(),
      dueDate: z.string().describe("Due date in ISO format, e.g. 2026-04-10T00:00:00Z (optional)").optional()
    })
  },
  async ({ projectId, title, description, parentId, assignedUserId, priority, dueDate }) => {
    await login();

    const body = { title };
    if (description) body.description = description;
    if (parentId) body.parent_id = parentId;
    if (assignedUserId) body.assigned_user_id = assignedUserId;
    if (priority !== undefined) body.priority = priority;
    if (dueDate) body.due_date = dueDate;

    const res = await api.post(`/agencies/${agencyId}/projects/${projectId}/tasks`, body);
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("🚀 Maven Gang MCP server running on stdio\n");

  process.stdin.resume();
}

main();
