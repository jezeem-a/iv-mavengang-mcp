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
