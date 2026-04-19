# MavenGang MCP Server

MCP server that connects AI coding assistants (Claude Desktop, Claude Code, Cursor, Windsurf, opencode, Codex CLI) to the [MavenGang](https://mavengang.com) project management API. Runs free on Cloudflare Workers with OAuth 2.1 authentication.

## How It Works

```
Your IDE ──OAuth 2.1 + DCR──▶ Cloudflare Worker
                                    │
                                    ├─ /authorize, /token, /register
                                    ├─ /.well-known/oauth-*
                                    └─ /mcp (Streamable HTTP)
                                             │
                                             ▼
                                    Durable Object per session
                                             │
                                             │ MavenGang JWT
                                             ▼
                                    MavenGang API
```

Each teammate connects their IDE via OAuth. On first connect, a browser opens to a MavenGang login page. After sign-in, the IDE caches a long-lived token. All API calls use the teammate's own MavenGang credentials — permissions and audit trail preserved.

## Available Tools (131)

### Projects
| Tool | What it does |
|------|-------------|
| `list_projects` | List all projects, filter by status / client / search |
| `get_project` | Full project details |
| `create_project` | Create a new project with billing model |
| `update_project` | Update project name, status, visibility, rates |
| `get_project_dashboard` | Progress, hours, milestones, recent activity |
| `add_project_member` | Add a member to a project |
| `update_project_member` | Change a member's project role |
| `remove_project_member` | Remove a member from a project |

### Tasks
| Tool | What it does |
|------|-------------|
| `list_tasks` | Tasks in a project — filter by status, assignee, milestone, parent |
| `get_task` | Full task details including description |
| `create_task` | Create task or subtask with all fields |
| `update_task` | Update status, assignee, priority, milestone, due date |
| `delete_task` | Delete a task |
| `get_my_tasks` | Cross-project "what's on my plate" view |
| `bulk_update_tasks` | Update status / assignee / milestone on many tasks at once |
| `bulk_delete_tasks` | Delete multiple tasks at once |

### Milestones
| Tool | What it does |
|------|-------------|
| `list_milestones` | List project milestones (needed to get IDs for task assignment) |
| `create_milestone` | Create a milestone, optionally nested under a parent |
| `update_milestone` | Update title, status, due date, parent |
| `delete_milestone` | Delete milestone (tasks unlinked, children re-parented automatically) |

### Comments
| Tool | What it does |
|------|-------------|
| `add_comment` | Comment on a task or milestone |
| `list_comments` | Read task or milestone discussion thread |
| `update_comment` | Edit a comment |
| `delete_comment` | Delete a comment |

### Members & Invites
| Tool | What it does |
|------|-------------|
| `list_project_members` | Project members + user IDs (needed for assignment) |
| `list_agency_members` | All agency members with roles |
| `update_agency_member` | Change role, hourly rate, weekly capacity |
| `remove_agency_member` | Remove a member from the agency |
| `create_invite` | Invite a user to the agency by email |
| `list_invites` | List pending invitations |
| `delete_invite` | Cancel an invitation |

### Clients
| Tool | What it does |
|------|-------------|
| `list_clients` | List all clients |
| `get_client` | Client details |
| `create_client` | Create a new client |
| `update_client` | Update client name / contact email |

### Time Tracking
| Tool | What it does |
|------|-------------|
| `start_timer` | Start a timer on a task |
| `stop_timer` | Stop the running timer |
| `pause_timer` | Pause the running timer |
| `resume_timer` | Resume a paused timer |
| `log_time` | Manually log time on a task |
| `list_time_entries` | List time entries — filter by project, task, user, date range |
| `get_time_entry` | Single time entry details |
| `update_time_entry` | Edit a time entry |
| `delete_time_entry` | Delete a time entry |
| `get_team_time_summary` | Team time summary across a date range |
| `get_weekly_time_summary` | Weekly grid summary for timesheets |

### Timesheets
| Tool | What it does |
|------|-------------|
| `get_timesheet` | Get timesheet status for a week |
| `list_pending_timesheets` | List all timesheets waiting for approval |
| `submit_timesheet` | Submit your timesheet for approval |
| `recall_timesheet` | Pull back a submitted timesheet to draft |
| `approve_timesheet` | Approve a timesheet (per project or all) |
| `reject_timesheet` | Reject a timesheet with a note |

### Time Entry Tags
| Tool | What it does |
|------|-------------|
| `list_time_entry_tags` | List all time entry tags |
| `create_time_entry_tag` | Create a tag |
| `update_time_entry_tag` | Rename / recolor a tag |
| `delete_time_entry_tag` | Delete a tag |

### Task Watchers
| Tool | What it does |
|------|-------------|
| `list_task_watchers` | List users watching a task |
| `add_task_watcher` | Watch a task |
| `remove_task_watcher` | Stop watching a task |

### Task Dependencies
| Tool | What it does |
|------|-------------|
| `list_task_dependencies` | List what a task depends on |
| `add_task_dependency` | Add a dependency between tasks |
| `remove_task_dependency` | Remove a dependency |

### Task Recurrence
| Tool | What it does |
|------|-------------|
| `set_task_recurrence` | Set a task to repeat daily / weekly / monthly |
| `update_task_recurrence` | Change recurrence settings |
| `delete_task_recurrence` | Remove recurrence from a task |
| `list_task_occurrences` | List upcoming occurrences of a recurring task |

### Task Labels
| Tool | What it does |
|------|-------------|
| `list_task_labels` | List all labels (optionally scoped to a project) |
| `create_task_label` | Create a label with a color |
| `update_task_label` | Rename / recolor a label |
| `delete_task_label` | Delete a label |

### Task Templates
| Tool | What it does |
|------|-------------|
| `list_task_templates` | List all task templates |
| `get_task_template` | Template details including task list |
| `create_task_template` | Create a reusable task template |
| `update_task_template` | Update a template |
| `delete_task_template` | Delete a template |
| `apply_task_template` | Stamp a template onto a project, creating all its tasks |

### Concerns
| Tool | What it does |
|------|-------------|
| `list_concerns` | List project concerns / blockers |
| `create_concern` | Raise a new concern on a project |
| `update_concern` | Update concern status (open / acknowledged / resolved) |

### Billing & Invoices
| Tool | What it does |
|------|-------------|
| `get_invoice_preview` | Preview invoice totals before generating |
| `list_invoices` | List invoices — filter by client, status, period |
| `get_invoice` | Invoice details with line items |
| `create_invoice` | Generate an invoice for a client |
| `void_invoice` | Void an invoice with a reason |
| `mark_invoice_paid` | Mark an invoice as paid |

### Activity & Notifications
| Tool | What it does |
|------|-------------|
| `get_activity_feed` | Agency activity feed — filter by project, entity, actor |
| `list_notifications` | Your notification inbox |
| `get_unread_notification_count` | How many unread notifications you have |
| `mark_notification_read` | Mark one notification read |
| `mark_all_notifications_read` | Clear all notifications |

### Analytics
| Tool | What it does |
|------|-------------|
| `get_analytics` | Revenue, utilization, project health overview |
| `get_client_analytics` | Client-specific revenue analytics |
| `get_project_analytics` | Project-level performance analytics |
| `get_financial_analytics` | Financial breakdown analytics |
| `get_utilization_analytics` | Team utilization and hours analytics |
| `get_personal_analytics` | Your own personal performance analytics |

### Attachments
| Tool | What it does |
|------|-------------|
| `list_attachments` | List files attached to a task, project, or comment |
| `get_attachment_download_url` | Get a presigned download URL (15-min expiry) |
| `delete_attachment` | Delete an attachment |

### Wiki
| Tool | What it does |
|------|-------------|
| `list_wiki_pages` | Agency-wide wiki tree |
| `create_wiki_page` | Create a global wiki page |
| `get_wiki_page` | Get a wiki page by slug |
| `update_wiki_page` | Edit a wiki page |
| `delete_wiki_page` | Delete a page and all its children |
| `search_wiki` | Full-text search across all wiki pages |
| `get_wiki_page_revisions` | Revision history for a page |
| `list_project_wiki_pages` | Project-scoped wiki tree |
| `create_project_wiki_page` | Create a project wiki page |
| `get_project_wiki_page` | Get a project wiki page by slug |
| `update_project_wiki_page` | Edit a project wiki page |
| `delete_project_wiki_page` | Delete a project wiki page |

### Project Categories
| Tool | What it does |
|------|-------------|
| `list_project_categories` | List all project categories |
| `create_project_category` | Create a category |
| `update_project_category` | Rename / recolor a category |
| `delete_project_category` | Delete a category |
| `reorder_project_categories` | Reorder categories |

### Project Statuses
| Tool | What it does |
|------|-------------|
| `list_project_statuses` | List project status definitions |
| `create_project_status` | Create a custom project status |
| `update_project_status` | Rename / recolor a project status |
| `delete_project_status` | Delete a status (requires a replacement) |
| `reorder_project_statuses` | Reorder project statuses |

### Task Statuses (Agency defaults)
| Tool | What it does |
|------|-------------|
| `list_task_statuses` | List agency-level task status definitions |
| `create_task_status` | Create a custom task status |
| `update_task_status` | Rename / recolor a task status |
| `delete_task_status` | Delete a status (requires a replacement) |
| `reorder_task_statuses` | Reorder task statuses |

### Task Statuses (Per project)
| Tool | What it does |
|------|-------------|
| `list_project_task_statuses` | List task statuses for a specific project |
| `create_project_task_status` | Create a project-specific task status |
| `update_project_task_status` | Edit a project task status |
| `delete_project_task_status` | Delete a project task status |
| `reset_project_task_statuses` | Reset project statuses back to agency defaults |

---

## What to Ask

The AI can handle natural language. You don't need to name tools — just describe what you want.

### Tasks
```
What are my tasks this week?
List all in-progress tasks in the Alpha project
Show me all tasks assigned to Sarah
Create a task "Write API docs" in the Backend project, due Friday, assigned to me
Move PRJ5-42 to in_progress and assign it to John
Create a subtask under PRJ8-1 for frontend changes
What's blocking task PRJ3-7?
Delete all done tasks in the Cleanup project
```

### Milestones
```
List milestones for the Q2 Launch project
Create a milestone "Beta Release" due June 30
What tasks are in the Sprint 2 milestone?
Mark the Alpha milestone as completed
```

### Time Tracking
```
Start a timer on task PRJ5-42
Stop my timer
Log 2 hours on PRJ3-7 for today with note "API integration"
How many hours did the team log this week?
Show me my time entries for this month
Show me last week's timesheet summary
```

### Timesheets
```
Submit my timesheet for this week
Show me timesheets waiting for approval
Approve John's timesheet
Reject Sarah's timesheet — hours don't match the project
```

### Projects & Members
```
List all active projects
Create a new project "Client Portal" with hourly billing at $150/hr
Who are the members of the Backend project?
Add Alice to the Frontend project as a contributor
Invite bob@acme.com to the agency as a staff member
```

### Comments & Discussion
```
Add a comment to PRJ5-42: "Fixed in commit abc123"
Show me the discussion on PRJ3-7
```

### Billing
```
Preview the invoice for Acme Corp for March
Generate an invoice for Acme Corp for March
List all unpaid invoices
Mark invoice INV-42 as paid
```

### Analytics & Activity
```
Show me this month's revenue and utilization
What's the team utilization for this quarter?
Show recent activity on the Alpha project
How many unread notifications do I have?
```

### Wiki
```
List all wiki pages
Search the wiki for "deployment process"
Create a wiki page "Onboarding Guide" in the Engineering project
Show me revision history for the setup-guide page
```

### Labels & Templates
```
List all task labels
Create a label "urgent" in red
Apply the "Sprint Template" to the Q3 project
```

---

## Setup

All IDEs use OAuth — one browser sign-in per machine, then cached.

### Claude Desktop (Mac/Windows app)

1. Settings → Connectors → "Add custom connector"
2. Paste: `https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp`
3. Browser opens → sign in with MavenGang email/password → done.

### Claude Code CLI

```bash
claude mcp add mavengang --transport http -s user -- https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp
```

First tool call opens browser for sign-in.

### Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mavengang": {
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mavengang": {
      "serverUrl": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
    }
  }
}
```

### opencode

`~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mavengang": {
      "type": "remote",
      "url": "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp",
      "enabled": true
    }
  }
}
```

### OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.mavengang]
url = "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"
```

### Fallback (any IDE that fails OAuth)

Use `mcp-remote` bridge:

```json
{
  "command": "npx",
  "args": ["-y", "mcp-remote", "https://iv-mavengang-mcp.jezeem-dev.workers.dev/mcp"]
}
```

---

## Self-Hosting

Want to host your own instance? It's free.

### Prerequisites

- Node.js 22+
- Cloudflare account ([sign up free](https://dash.cloudflare.com))
- Wrangler CLI

### Steps

```bash
# 1. Clone
git clone https://github.com/jezeem-a/iv-mavengang-mcp.git
cd iv-mavengang-mcp
npm install

# 2. Install Wrangler and login
npm install -g wrangler
wrangler login

# 3. Create KV namespaces
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create OAUTH_KV --preview

# 4. Update wrangler.toml with your KV IDs
# See wrangler.toml for the exact structure

# 5. Deploy
npx wrangler deploy
# Live at https://<your-worker>.<your-subdomain>.workers.dev
```

### Cost

Free. Cloudflare Workers free tier covers 100,000 requests/day + Durable Objects (free tier handles typical team usage).

---

## Project Structure

```
iv-mavengang-mcp/
├── index.js               # All 131 MCP tools (Cloudflare Workers + OAuthProvider)
├── wrangler.toml          # Cloudflare config (Durable Object + KV namespaces)
├── package.json
├── API_CONTRACT.md        # Full MavenGang API documentation (all endpoint groups)
├── MCP_TOOLS_PLAN.md      # Implementation plan for batch 2 tools
└── README.md
```

---

## Contributing

This is an open-source project. Contributions welcome!

- **Found a bug?** [Open an issue](https://github.com/jezeem-a/iv-mavengang-mcp/issues)
- **Want a new feature?** Fork it, build it, send a PR
- **Have an idea?** Start a discussion in issues

### Adding a new MCP tool

1. Fork the repo
2. Add your tool in `index.js` inside `MavenGangMCP.init()` — follow the existing pattern
3. Reference `API_CONTRACT.md` for available MavenGang endpoints
4. `node --check index.js` before committing
5. Test locally with `npx wrangler dev`
6. Submit a PR

---

## License

MIT
