/**
 * Composio × Claude Agent SDK
 * ---------------------------------------------------------------------------
 * Hand a Claude Agent SDK agent the tools it needs to take real action across
 * 1000+ apps (GitHub, Gmail, Slack, Linear, ...) with authentication handled
 * by Composio.
 *
 * How it works
 * ------------
 * Every Composio session exposes a hosted MCP endpoint. The Claude Agent SDK
 * speaks MCP natively, so we simply point its `mcpServers` option at the
 * session URL — no manual tool-wrapping required. The agent gets Composio's
 * meta-tools (discover / authenticate / execute) and can call into any
 * connected app at runtime without loading hundreds of tool schemas up front.
 *
 *   Composio session (mcp: true)  ──http──▶  Claude Agent SDK `query()`
 *
 * Usage
 * -----
 *   cp .env.example .env         # then fill in your keys
 *   npm install
 *   npm start                    # uses the default prompt
 *   node index.mjs "star the ComposioHQ/composio repo on GitHub"
 *
 * Docs: https://docs.composio.dev  ·  https://docs.claude.com/en/api/agent-sdk
 */

import { Composio } from '@composio/core';
import { query } from '@anthropic-ai/claude-agent-sdk';

const { COMPOSIO_API_KEY, ANTHROPIC_API_KEY } = process.env;

// The Claude Agent SDK reads ANTHROPIC_API_KEY from the environment itself; we
// check it here only to fail fast with a friendly message.
if (!COMPOSIO_API_KEY) {
  console.error('Missing COMPOSIO_API_KEY — get one at https://dashboard.composio.dev/settings');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY — get one at https://console.anthropic.com/settings/keys');
  process.exit(1);
}

// A session is scoped to one of *your* users, so each end-user gets their own
// connected accounts. Swap this for a real user id in your app.
const userId = process.env.COMPOSIO_USER_ID ?? 'default';

const prompt =
  process.argv.slice(2).join(' ') ||
  'List the Composio tools available to you, then summarise what you could help me automate.';

async function main() {
  const composio = new Composio({ apiKey: COMPOSIO_API_KEY });

  // `mcp: true` surfaces the session's hosted MCP endpoint on `session.mcp`.
  const session = await composio.create(userId, { mcp: true });
  console.error(`▶ Composio session ${session.sessionId} ready (user: ${userId})`);

  const response = query({
    prompt,
    options: {
      // Bridge: expose Composio's session as an HTTP MCP server to the agent.
      mcpServers: {
        composio: {
          type: 'http',
          url: session.mcp.url,
          headers: session.mcp.headers,
        },
      },
      // Allow every tool the Composio MCP server exposes.
      allowedTools: ['mcp__composio'],
      // This is a non-interactive script, so auto-approve tool calls. In an
      // interactive host you'd supply a `canUseTool` callback instead.
      permissionMode: 'bypassPermissions',
      systemPrompt:
        'You are an automation assistant. Use the Composio tools to inspect ' +
        'and act across the user\'s connected apps. Be concise.',
      maxTurns: 10,
    },
  });

  for await (const message of response) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
      }
    } else if (message.type === 'result') {
      process.stdout.write('\n');
      if (message.subtype === 'success') {
        console.error(
          `✔ done — ${message.num_turns} turn(s), $${message.total_cost_usd.toFixed(4)}`,
        );
      } else {
        console.error(`✘ agent stopped: ${message.subtype}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
