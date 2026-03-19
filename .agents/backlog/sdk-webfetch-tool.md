# WebFetch and WebSearch Tools

## What

Add web content access tools as built-in tools alongside Bash, Read, Write, Edit, Glob, Grep.

## Package Location

**`@robota-sdk/agent-tools/builtins/`** — same as all other built-in tools.

```
packages/agent-tools/src/builtins/
├── bash-tool.ts
├── read-tool.ts
├── write-tool.ts
├── edit-tool.ts
├── glob-tool.ts
├── grep-tool.ts
├── web-fetch-tool.ts    ← NEW
└── web-search-tool.ts   ← NEW
```

Registered in Session's tool list in `agent-sessions`, same as other tools.

## WebFetch Tool

- HTTP GET a URL, return content as text
- HTML → text/markdown conversion (strip tags)
- Accept: URL (required), headers (optional)
- 30K char output limit (same as other tools)
- Uses Node.js native `fetch` or `undici` (no external deps)
- Permission: requires approval in default mode

## WebSearch Tool

- Search the internet, return results (title, URL, snippet)
- Implementation varies by available API:
  - If `BRAVE_API_KEY` env set → use Brave Search API
  - Otherwise → error with message to configure search API
- Accept: query (required), limit (optional, default 10)
- Return: JSON array of { title, url, snippet }
- Permission: requires approval in default mode

## Anthropic Server Tools (future optimization)

When using Anthropic provider, there's an option to use their built-in `web_search_20250305` / `web_fetch_20250910` server tools. This is an **optimization** — the tool from the user's perspective is the same, but the provider can route the execution to Anthropic's server-side implementation instead of our FunctionTool.

This optimization lives in `agent-provider-anthropic`, not in `agent-tools`. It's a future enhancement, not required for initial implementation.

## Cost

| Tool                          | Implementation   | Cost                                |
| ----------------------------- | ---------------- | ----------------------------------- |
| WebFetch                      | Node.js fetch    | Free (no API)                       |
| WebSearch (Brave)             | Brave Search API | Free 2,000/month, then $0.005/query |
| WebSearch (Anthropic, future) | API server tool  | $0.01/query                         |

## Priority

WebFetch first (no external API needed), WebSearch second.
