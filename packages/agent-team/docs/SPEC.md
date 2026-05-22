# agent-team Specification

## Scope

- Reserved for future multi-agent coordination capabilities.
- The `assignTask` relay tool pattern has been removed in favour of the Agent Command pattern
  (`robota_command_agent` via `@robota-sdk/agent-command`).
- This package currently exports nothing and has no runtime behaviour.

## Boundaries

- Must not depend on any `agent-*` package until new coordination features are designed and approved.
- Must not reintroduce `assignTask`, `listTemplates`, `listTemplateCategories`, or any relay-tool pattern removed by TOOL-002.
- Zero exported symbols until new coordination features are implemented.

## Architecture Overview

```
src/
  index.ts   # Empty barrel — no exports until new features are added
```

## Type Ownership

None. This package defines no types until new coordination features are implemented.

## Public API Surface

None. The package exports nothing as of TOOL-002 removal.

## Extension Points

When multi-agent coordination features are designed, they will be added here. Any new capability
must go through the spec-first workflow defined in `.agents/rules/process.md`.

## Error Taxonomy

None.

## Class Contract Registry

None.

## Test Strategy

No tests required while the package is empty. Tests will be added alongside new features.
