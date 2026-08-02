# Composio × Claude Agent SDK

A minimal, self-contained example that gives a **Claude Agent SDK** agent access
to **Composio's** 1000+ app tools (GitHub, Gmail, Slack, Linear, …) over MCP,
with authentication handled by Composio.

## How it works

Every Composio session exposes a hosted **MCP** endpoint. The Claude Agent SDK
speaks MCP natively, so the bridge is just one config block — point the SDK's
`mcpServers` option at the session URL. No manual tool-wrapping.

```
Composio session (mcp: true)  ──http──▶  Claude Agent SDK query()
```

The agent receives Composio's meta-tools (discover → authenticate → execute) and
can act across any connected app at runtime, without loading hundreds of tool
schemas into context up front.

## Setup

```bash
cd examples/composio-claude-agent
cp .env.example .env      # then fill in COMPOSIO_API_KEY and ANTHROPIC_API_KEY
npm install
```

- `COMPOSIO_API_KEY` — https://dashboard.composio.dev/settings
- `ANTHROPIC_API_KEY` — https://console.anthropic.com/settings/keys

## Run

```bash
# Default prompt (lists available tools and what it can automate)
npm start

# Or pass your own instruction
node index.mjs "star the ComposioHQ/composio repo on GitHub"
```

> Connect apps to your Composio account first (via the Composio dashboard or the
> agent's own auth flow) so the tools have accounts to act on.

## Files

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `index.mjs`     | The integration — Composio session → SDK `query()`. |
| `package.json`  | Declares the two dependencies.                      |
| `.env.example`  | Template for the required API keys.                 |

## References

- Composio docs — https://docs.composio.dev
- Claude Agent SDK — https://docs.claude.com/en/api/agent-sdk
