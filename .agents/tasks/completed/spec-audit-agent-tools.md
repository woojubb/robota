---
title: 'Spec Audit: agent-tools'
status: completed
priority: medium
created: 2026-03-20
packages:
  - agent-tools
---

# Spec Audit: agent-tools

## Goal

agent-tools SPEC.md has stale content after WebFetch/WebSearch addition and incorrect inheritance claims.

## Issues Found (6)

### HIGH (2)

1. **Scope description**: Lists only 6 built-in tools, omits WebFetch and WebSearch.
2. **Public API table**: "Built-in CLI Tools" table lists only 6 entries, missing `webFetchTool` and `webSearchTool`.

### MEDIUM (3)

3. **Inheritance Chains completely wrong**: Claims FunctionTool and OpenAPITool extend AbstractTool. Both actually `implements` their respective interfaces without extending AbstractTool (explicit comment: "to avoid circular runtime dependency").
4. **Interface Implementations wrong**: Claims FunctionTool implements IToolWithEventService. Actual: `implements IFunctionTool`.
5. **Cross-Package Port Consumers wrong**: Claims both consume AbstractTool. Actual ports are IFunctionTool and ITool.

### LOW (1)

6. `openapi-types` is a devDependency used in production type imports — undocumented packaging concern.
