# Docs Audit Report — content/ examples, integrations, plugins, ko (2026-06-16)

Scope: content/examples (12), integrations (1), plugins (1), ko (2). Verified imports/symbols/options
against packages/\*/src + package.json exports at 3.0.0-beta.76.

## Summary

16 files. **5 with findings (4 high)**, 11 clean.
Top themes: (1) transport split not reflected in 3 transport examples; (2) Korean docs v2-era stale;
(3) `SessionStore` symbol removed; (4) github-action self-contradicts; (5) plugin event names wrong.

## Findings

### content/ko/getting-started/README.md — HIGH (entirely v2-era; won't run)

- `import { Anthropic } from '@robota-sdk/anthropic'` / `'@robota-sdk/openai'` — packages don't exist.
  Current: `@robota-sdk/agent-provider/anthropic` exporting `AnthropicProvider`.
- `createAgent({ providers, defaultModel: 'claude-sonnet-4-5' })` — `createAgent` not exported. Current:
  `new Robota({ name, aiProviders: [...], defaultModel: { provider, model, systemMessage } })`.
- Wrong options (`providers:` → `aiProviders:`; string `defaultModel` → object); inline tool literal →
  `createZodFunctionTool` from `@robota-sdk/agent-tools`; model id `claude-sonnet-4-5` → `-4-6`.
- Fix: rewrite to mirror current English getting-started, or remove + redirect.

### content/ko/README.md — MEDIUM

- Broken links `/ko/guide`, `/ko/examples`, `/ko/packages` (lines ~8–10) — only README.md +
  getting-started/ exist under ko. Fix: create sections or point to English.

### content/examples/http-transport.md — HIGH

- Imports `createHttpTransport`/`createAgentRoutes` from `@robota-sdk/agent-transport/http` (removed
  subpath). Real: `@robota-sdk/agent-transport-http` root. Fix: change both imports.

### content/examples/ws-transport.md — HIGH

- Imports from `@robota-sdk/agent-transport/ws` (removed). Real: `@robota-sdk/agent-transport-ws`
  (`createWsTransport`, `createWsHandler`). Fix: change both imports.

### content/examples/mcp-transport.md — HIGH

- Imports from `@robota-sdk/agent-transport/mcp` (removed). Real: `@robota-sdk/agent-transport-mcp`
  (`createMcpTransport`, `createAgentMcpServer`). Fix: change both imports.

### content/examples/session-management.md — HIGH

- `import { InteractiveSession, SessionStore }` + `new SessionStore()` — `SessionStore` not exported by
  agent-framework; only `createProjectSessionStore`/`createUserSessionStore`. Everything else valid.
  Fix: replace with `createUserSessionStore()`.

### content/integrations/github-action.md — MEDIUM

- Self-contradictory: declares action "Not yet available" (~1–3) but presents `uses: robota-sdk/action@v1`
  as shipped (~47–121). Fix: fence Quick Start/Inputs/Outputs under "Planned (future)" or remove until shipped.

### content/plugins/README.md — LOW

- Event names colon-style `execution:start`/`tool:call`/`error` (line ~20) don't exist. Real
  `TExecutionEventName` uses dot/prefixed: `tool.beforeExecute`, `tool.afterExecute`, `tool.success`,
  `error.occurred`, `execution.hierarchy`. Fix: use real names or describe generically.

## Clean files (11)

examples/README.md, basic-conversation.md, multi-provider.md, streaming.md, one-shot-query.md,
tool-calling.md, interactive-mode.md, print-mode.md. Vendor names (Anthropic/OpenAI/Gemini/LM Studio)
are legitimate external references. No `sub-agent` hyphen in scope.
