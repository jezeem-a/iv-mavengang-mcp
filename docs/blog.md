# How I Used MCP to Power My Tasks Locally to Maven Gang 🚀

So I had this wild idea — what if I could just *talk* to Claude and say "show me my projects" and it actually connects to Maven Gang? Turns out, MCP makes that possible. Here's how I did it 😄

## What Even is MCP? 🤔

MCP (Model Context Protocol) is basically a plugin system for AI assistants. Anthropic built it as an open standard, and it lets tools like Claude and Cursor call your custom functions. You define what the AI can do, and it handles the rest.

## Step 1: Start Simple — A REST API 💡

Before going full MCP, I built a tiny Express server that just proxies Maven Gang's API. Nothing fancy — two endpoints to list projects and create tasks.

Why? Because I needed to understand how the API worked first. Login flow, response shapes, all that jazz. It's like writing unit tests before writing the feature, you know? ✅

## Step 2: Make It MCP 🔧

Here's where the magic happened. Instead of HTTP endpoints, I registered **tools**. Each tool has a name, description, and input schema. Now Claude and Cursor can do things like:

- "List all my projects" → calls `list_projects`
- "Create a task 'Fix login' in project X" → calls `create_task`

The server runs locally over stdio (no ports needed!), using the official MCP SDK from Anthropic.

## Gotchas I Hit 😅

Not gonna lie, MCP has some quirks:

- **Schema format matters** — The SDK wants Zod schemas, not raw JSON Schema. I spent way too long debugging this 😭
- **dotenv has a banner** — It prints to stdout and breaks everything. You need `quiet: true` 🔇
- **Arrays don't work in structuredContent** — Has to be an object. Easy fix once you know 💡
- **No console.log!** — It goes to stdout, which is the JSON-RPC channel. Use stderr instead 📢

## What's Next 🎯

Right now this works great locally — everyone clones the repo and connects. But the next step is hosting it publicly over HTTP so anyone with their Maven Gang credentials can connect to a shared URL.

That's a story for another day 😊

## Tech Stack 🛠️

- `@modelcontextprotocol/server` (Anthropic's MCP SDK)
- `axios` + `dotenv` for API calls
- `zod` for schema validation
- Maven Gang API

## Huge Thanks 🙏

Shoutout to **Saneesh** for sharing the Maven Gang API documentation and walking me through the details. Couldn't have done this without you! 🙌

---

*If you want to try it out or build something similar, check out the [docs](./docs/01-step-1-rest-api.md) — I documented the whole journey step by step! 📚*
