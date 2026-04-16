# Step 1: Building a REST API Proxy

This is where we started — a simple Express.js server that acts as a proxy to the Maven Gang API.

## The Problem

We wanted AI assistants (Claude, Cursor) to interact with Maven Gang, our project management tool. The first step was understanding how the Maven Gang API works by building a simple REST API.

## The Code: `index.js`

```javascript
import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

let token = null;
let agencyId = null;

const api = axios.create({
  baseURL: process.env.BASE_URL,
});

async function login() {
  const res = await api.post("/auth/login", {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
  });

  token = res.data.access_token;

  const me = await api.get("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });

  agencyId = me.data.memberships[0].agency_id;

  console.log("✅ Logged in");
}

app.get("/projects", async (req, res) => {
  const data = await api.get(
    `/agencies/${agencyId}/projects`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  res.json(data.data);
});

app.post("/create-task", async (req, res) => {
  const { projectId, title } = req.body;

  const data = await api.post(
    `/agencies/${agencyId}/projects/${projectId}/tasks`,
    {
      title,
      description: "",
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  res.json(data.data);
});

app.listen(3000, async () => {
  await login();
  console.log("🚀 MCP running on http://localhost:3000");
});
```

## How It Works

### 1. Authentication
The server logs in once at startup using email/password from `.env`, stores the JWT token, and fetches the agency ID.

### 2. Proxy Endpoints
Two endpoints forward requests to Maven Gang:
- `GET /projects` → Lists all projects
- `POST /create-task` → Creates a task in a project

### 3. Request Flow
```
curl http://localhost:3000/projects
  → Express receives request
  → Adds Bearer token to headers
  → Forwards to https://mavengang.com/v1/agencies/{id}/projects
  → Returns Maven Gang's response
```

## Why This Approach First?

As a mobile developer, REST APIs are familiar territory. This approach let us:
- Understand the Maven Gang API contract
- Test authentication flow
- Verify data structures before building anything complex
- Test with simple `curl` commands

## Limitations

This REST API approach has problems for our actual goal:

1. **AI assistants don't speak REST** — Claude and Cursor expect MCP protocol, not HTTP endpoints
2. **Single user only** — The server logs in once with hardcoded credentials. Everyone shares the same account.
3. **No tool descriptions** — AI assistants need to know what each endpoint does, what parameters it needs, and what it returns. REST APIs don't provide this metadata.

This is where MCP comes in. → [Step 2: Local MCP Server with stdio](./02-step-2-local-mcp-stdio.md)

## Running This Step

```bash
npm start
# Server runs on http://localhost:3000

# Test it:
curl http://localhost:3000/projects
curl -X POST http://localhost:3000/create-task \
  -H "Content-Type: application/json" \
  -d '{"projectId": "your-project-id", "title": "Test task"}'
```
