# WebFetch and WebSearch Tools

## What

Add web content access tools: WebFetch (fetch URLs) and WebSearch (search the internet).

## Architecture: Two Implementation Paths

### Path A: Anthropic API Built-in Server Tools

When using `agent-provider-anthropic`, leverage Anthropic's native server-side tools. These are NOT regular FunctionTools — they're activated by adding them to the API request's `tools` parameter with a special type.

**Package: `@robota-sdk/agent-provider-anthropic`**

```typescript
// In the provider's chat() method, add server tools to the request
const requestParams = {
  model: '...',
  messages: [...],
  tools: [
    ...functionTools,  // existing Bash, Read, etc.
    // Anthropic server tools — not FunctionTools, different format
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 10 },
  ],
};
```

- Claude decides when to search/fetch automatically
- Results come back as `server_tool_use` blocks in the response
- Provider must parse these in `convertFromAnthropicResponse()`
- Cost: WebSearch $0.01/query, WebFetch free (tokens only)
- No external API key needed

**Files to modify:**

- `packages/agent-provider-anthropic/src/provider.ts` — add server tools to request, parse server_tool_use results
- `packages/agent-sessions/src/session.ts` — config option to enable/disable web tools

### Path B: External API Tools (Brave Search, HTTP fetch)

When using non-Anthropic providers (OpenAI, Google, etc.), implement as regular FunctionTools.

**Package: `@robota-sdk/agent-tools/builtins/`**

```
web-search-tool.ts  — calls Brave Search API (or SerpAPI)
web-fetch-tool.ts   — HTTP GET with HTML→text conversion
```

These are standard FunctionTools like Bash/Read/Write:

- Registered in Session's tool list
- Subject to permission system
- Require external API key (e.g., BRAVE_API_KEY)

**Files to create:**

- `packages/agent-tools/src/builtins/web-search-tool.ts`
- `packages/agent-tools/src/builtins/web-fetch-tool.ts`

### How They Connect

```
Session (agent-sessions)
├── detects provider type
├── if Anthropic → enable server tools in provider config
│   └── agent-provider-anthropic adds web_search/web_fetch to API request
│       └── Claude auto-executes, results in response
└── if other provider → register FunctionTool versions
    └── agent-tools/builtins/web-search-tool.ts (Brave API)
    └── agent-tools/builtins/web-fetch-tool.ts (HTTP fetch)
```

**Config in `.robota/settings.json`:**

```json
{
  "webTools": {
    "enabled": true,
    "searchProvider": "auto",
    "braveApiKey": "$ENV:BRAVE_API_KEY"
  }
}
```

`"auto"` = Anthropic built-in when available, Brave fallback otherwise.

## Package Placement Summary

| Component                        | Package                    | Why                               |
| -------------------------------- | -------------------------- | --------------------------------- |
| Anthropic server tool activation | `agent-provider-anthropic` | Provider-specific API format      |
| server_tool_use response parsing | `agent-provider-anthropic` | Provider-specific response format |
| WebSearch FunctionTool (Brave)   | `agent-tools/builtins/`    | General-purpose tool              |
| WebFetch FunctionTool (HTTP)     | `agent-tools/builtins/`    | General-purpose tool              |
| Enable/disable config            | `agent-sessions`           | Session manages tool registration |
| Settings schema                  | `agent-sdk/config/`        | SDK-specific file config          |

## Cost

| Tool      | Anthropic Built-in | Brave Search                        |
| --------- | ------------------ | ----------------------------------- |
| WebSearch | $0.01/query        | Free 2,000/month, then $0.005/query |
| WebFetch  | Token cost only    | N/A (direct HTTP)                   |

## Priority

WebFetch first (simpler, no external API), WebSearch second.
