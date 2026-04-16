# MavenGang MCP Server — Proposal

## Objective

Build an internal MCP (Model Context Protocol) server that lets every team member interact with MavenGang directly from their AI coding tool (Claude Code, Cursor, Copilot) without switching context.

Instead of opening MavenGang in the browser to check tasks, update status, or assign work, a dev just asks their AI assistant — "what are my tasks today?", "create a subtask under PRJ5-42 for API changes" — and it happens through MCP.

---

## What MCP Enables (V1)

10 tools covering daily team usage:

| Tool | Use case |
|------|----------|
| `list_projects` | See all active projects |
| `get_project` | Project overview |
| `list_tasks` | Browse tasks in a project |
| `get_task` | Task details |
| `create_task` | Create tasks + subtasks from AI chat |
| `update_task` | Change status, assignee, priority |
| `list_project_members` | Find teammate IDs for assignment |
| `get_my_tasks` | Cross-project "what's on my plate" |
| `add_comment` | Comment on tasks without leaving IDE |
| `list_comments` | Read task discussion |

All work via each teammate's own MavenGang credentials — permissions respected, audit trail preserved.

---

## Why It Matters

- **Context switching kills flow.** Devs don't leave the editor to update MavenGang.
- **Standup prep in seconds.** "What did I close yesterday? What's next?" — one question.
- **AI-assisted task creation.** Claude can break an idea into subtasks and file them in MavenGang automatically.
- **No training needed.** Teammates already know MavenGang; they just talk to their AI instead of clicking.

---

## Future Prospects (V2+)

- **Time tracking tools** — start/stop timers via AI ("start timer on PRJ5-42")
- **Slack bot integration** on the same server — same tools, different client
- **Milestones + notifications** — proactive reminders from AI
- **Analytics queries** — "how many hours did I bill this week?"
- **Wiki search** — AI pulls SOPs and project docs directly
- **Agency picker** for multi-agency users
- **Custom domain** (e.g. `mcp.company.com`)

Same architecture scales — just adds tools.

---

## What I Need From You

1. **Bitbucket repo** — to version and push the code
2. **Cloudflare account access** — to deploy the Worker
3. **Cloudflare KV namespace** — for session storage (created inside existing account)
4. **(Optional) Custom subdomain** — e.g. `mcp.company.com` for a cleaner URL

No changes to MavenGang itself. No new credentials for anyone.

---

## Cost Analysis

**Hosting on Cloudflare Workers (free tier).**

| Resource | Free limit | Projected usage (10 users) | Over-limit cost |
|----------|-----------|----------------------------|-----------------|
| Workers requests | 100,000/day | ~200/day | $0.50 per million |
| Workers CPU time | 10 ms/request | well under | — |
| KV reads | 100,000/day | ~200/day | $0.50 per million |
| KV writes | 1,000/day | ~20/day | $5 per million |
| KV storage | 1 GB | < 1 MB | $0.50/GB-month |

**Expected monthly cost: $0.**

Even at 10× our current team size, we'd stay on free tier.

Only optional cost: custom domain registration, ~$10/year.

---

## Risk & Reversibility

- **Zero risk to MavenGang.** The MCP server is read/write against the public API, uses each user's own auth. If the server goes down, MavenGang is unaffected.
- **Zero risk to infra.** Cloudflare Workers is isolated; doesn't touch our other systems.
- **Easy to kill.** If we stop using it, delete the Worker. No cleanup, no migration.
- **Per-user security.** No shared credentials. Sessions hashed, HTTPS only, revocable via logout endpoint.

---

## Bottom Line

Small investment (access + repo), zero direct cost, potentially big productivity lift for the engineering team. Fully reversible, no impact on existing systems.
