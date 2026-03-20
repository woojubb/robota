---
title: 'Spec Audit: agent-core'
status: completed
priority: high
created: 2026-03-20
packages:
  - agent-core
---

# Spec Audit: agent-core

## Goal

agent-core SPEC.md is severely stale. 8 plugins were extracted to separate packages but SPEC still documents them as internal. Class Contract Registry, Inheritance Chains, and file paths are largely incorrect.

## Issues Found (14)

### HIGH (3)

1. **Plugin architecture mismatch**: 8 plugins extracted to agent-plugin-\* packages, but SPEC lists them as `src/plugins/` internal. Only EventEmitterPlugin remains.
2. **Robota class path wrong**: SPEC says `src/robota.ts`, actual is `src/core/robota.ts`.
3. **IAIProvider/AbstractAIProvider path wrong**: SPEC says `src/abstracts/abstract-provider.ts`, actual is `src/abstracts/abstract-ai-provider.ts`.

### MEDIUM (8)

4. Plugin count inconsistency: "10 built-in" in heading, 9 in table, 1 in reality.
5. IEventService/IOwnerPathSegment wrong directory: SPEC says `services/event-service.ts`, actual is `event-service/interfaces.ts`.
6. IPluginsManager/Plugins wrong path: SPEC says `managers/plugin-manager.ts`, actual is `managers/plugins.ts`.
7. EventHistoryModule/InMemoryHistoryStore wrong paths.
8. MemoryCacheStorage wrong path: SPEC says `utils/cache-storage.ts`, actual is `services/cache/memory-cache-storage.ts`.
9. FunctionTool/ToolRegistry paths: moved from `src/tools/` to `src/tool-registry/`.
10. MCPTool/RelayMcpTool: moved to agent-tool-mcp, OpenAPITool to agent-tools.
11. BaseConversationHistory does not exist; classes implement IConversationHistory directly.

### LOW (3)

12. ConversationService wrong path: directory module, not single file.
13. Cross-Package Port Consumer package names: "sessions" → "agent-sessions", "remote" → "agent-remote".
14. TToolParameters SSOT location: `interfaces/types.ts`, not `interfaces/tool.ts`.

## Approach

This SPEC needs near-complete rewrite of Architecture, Class Contract Registry, and Inheritance Chains sections. Plugin section should reference external packages, not list internal implementations.
