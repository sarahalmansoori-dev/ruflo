#!/usr/bin/env bash
# Register the standard set of MCP servers with Claude Code.
#
# Idempotent: existing entries with the same name are replaced.
# Secrets are read from the environment and are never written to the repo.
#
#   FIRECRAWL_API_KEY   free key from https://firecrawl.dev  (optional)
#   PERPLEXITY_API_KEY  paid key from https://perplexity.ai  (optional)
#
# Usage:
#   scripts/setup-mcp-servers.sh [--scope local|user|project]
#
# Scope notes:
#   local   (default) this machine, this project — written to ~/.claude.json
#   user              this machine, every project
#   project           writes .mcp.json, which this repo gitignores by design
#
# MCP servers are loaded when a Claude Code session starts. Restart Claude Code
# (or run /mcp) after this script for the servers to become available.

set -euo pipefail

SCOPE="local"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope) SCOPE="${2:?--scope needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$SCOPE" in
  local|user|project) ;;
  *) echo "--scope must be one of: local, user, project" >&2; exit 2 ;;
esac

command -v claude >/dev/null 2>&1 || { echo "claude CLI not found on PATH" >&2; exit 1; }

added=() skipped=()

# Replace any existing entry so re-runs converge on the config below.
readd() {
  local name="$1"; shift
  claude mcp remove "$name" -s "$SCOPE" >/dev/null 2>&1 || true
  claude mcp add "$name" -s "$SCOPE" "$@" >/dev/null
  added+=("$name")
}

# 1. Playwright — browser automation over stdio. No credentials.
readd playwright -- npx -y @playwright/mcp@latest

# 2. Composio — 1000+ app integrations. Authenticates interactively via OAuth
#    on first use; run /mcp inside Claude Code to complete sign-in.
readd composio -t http https://connect.composio.dev/mcp

# 3. Firecrawl — web scraping and crawling. Firecrawl's remote endpoint takes
#    the API key in the URL path. If your dashboard shows a bearer-token
#    endpoint instead, set FIRECRAWL_MCP_AUTH=header to switch forms.
if [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
  if [[ "${FIRECRAWL_MCP_AUTH:-path}" == "header" ]]; then
    readd firecrawl -t http https://mcp.firecrawl.dev/v2/mcp \
      -H "Authorization: Bearer ${FIRECRAWL_API_KEY}"
  else
    readd firecrawl -t http "https://mcp.firecrawl.dev/${FIRECRAWL_API_KEY}/v2/mcp"
  fi
else
  skipped+=("firecrawl (set FIRECRAWL_API_KEY)")
fi

# 4. Perplexity — search and research. Paid API key, bearer auth.
if [[ -n "${PERPLEXITY_API_KEY:-}" ]]; then
  readd perplexity -t http https://api.perplexity.ai/mcp \
    -H "Authorization: Bearer ${PERPLEXITY_API_KEY}"
else
  skipped+=("perplexity (set PERPLEXITY_API_KEY)")
fi

printf 'configured (scope=%s): %s\n' "$SCOPE" "${added[*]}"
if [[ ${#skipped[@]} -gt 0 ]]; then
  printf 'skipped:\n'
  printf '  - %s\n' "${skipped[@]}"
fi

echo
echo "Health check (HTTP servers report 'Needs authentication' until you sign in;"
echo "that status does not confirm the endpoint is reachable):"
claude mcp list || true
