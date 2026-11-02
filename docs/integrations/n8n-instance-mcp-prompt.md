# Prompt: connect Claude Code to n8n Instance-level MCP (sandbox)

Paste into Claude Code **on the machine that can reach the n8n sandbox** (not a cloud session).
Replace `<BASE_URL>`, `<OUTBOUND_MAILBOX>` and `<OTHER_AUTOMATION_PLATFORM>` locally before use; do not commit the filled-in copy.

```text
Goal: connect Claude Code to my n8n sandbox via n8n's built-in Instance-level MCP server (<BASE_URL>/mcp-server/http). Not the community n8n-mcp package, not the MCP Server Trigger node. Install nothing, clone nothing.

Rules (never break)
1. Target n8n-sandbox only. Never touch n8n-dev or production.
2. Never ask for, print, or write the token. It lives only in $N8N_MCP_TOKEN in my shell.
3. Do not enable MCP on, create, edit, run or delete any workflow, or touch credentials, until I say "go".
4. Never run any workflow that sends email (e.g. Outlook / <OUTBOUND_MAILBOX>) through this connection.
5. Automations on other platforms (<OTHER_AUTOMATION_PLATFORM>) are out of scope.
6. If anything fails twice or is unclear, stop and ask. No retry loops.
7. Never run `claude mcp add` with the token inside double quotes. The shell would expand it into ~/.claude.json.

Step 1 — Inspect (read-only): n8n version, how it runs (Docker/npm), base URL and port, whether N8N_DISABLED_MODULES contains "mcp", HTTPS or localhost only, `claude --version`, and any existing n8n entry in `claude mcp list`. Check the minimum version for instance-level MCP against n8n's official docs/release notes. Don't assume it. If it's too old, give me the upgrade command and stop.

Step 2 — Give me the manual steps: Settings → Instance-level MCP → Enable; copy the Access Token; I run `export N8N_MCP_TOKEN='…'` in my own terminal and restart Claude Code from that shell. Wait for "token set".

Step 3 — Register with the variable NOT expanded (single quotes):
claude mcp add-json n8n-sandbox '{"type":"http","url":"<BASE_URL>/mcp-server/http","headers":{"Authorization":"Bearer ${N8N_MCP_TOKEN}"}}' --scope user
Then verify without printing secrets: confirm the stored n8n-sandbox entry contains the literal text ${N8N_MCP_TOKEN} (report yes/no only). If it contains anything else, remove the entry (`claude mcp remove n8n-sandbox -s user`) and stop.

Step 4 — Test (read-only): `claude mcp list`, then call only the search/list-workflows tool. Report: connected yes/no, tool names, count of MCP-enabled workflows (expected 0). Execute nothing.

Step 5 — Report in one table: version, endpoint, scope, auth method, token stored as a variable (yes/no), tools exposed, workflows visible, problems. Then list: enable MCP only on chosen published workflows (webhook/form/schedule/chat trigger); never enable any email-sending workflow; keep the token out of git; how to revoke (Instance-level MCP page → connected clients / rotate token); every client sees the same enabled workflows.
```

## Operator notes

- Launch Claude Code from the same shell where `N8N_MCP_TOKEN` was exported, or the connection returns 401.
- An `export` is lost when the terminal closes. For persistence use the OS keychain or a password manager, not `~/.zshrc` / `~/.bashrc`.
