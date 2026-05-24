# agent-team Specification

## Scope

- Reserved for future multi-agent coordination capabilities.
- The `assignTask` relay tool pattern has been removed in favour of the Agent Command pattern
  (`robota_command_agent` via `@robota-sdk/agent-command`).
- This package currently exports nothing and has no runtime behaviour.

## Boundaries

- Must not reintroduce `assignTask`, `listTemplates`, `listTemplateCategories`, or any relay-tool pattern removed by TOOL-002.
- Zero exported symbols until new coordination features are implemented.
- **Stale dependencies** — `package.json` still declares runtime deps on `@robota-sdk/agent-core`,
  `@robota-sdk/agent-tools`, and `@robota-sdk/agent-tool-mcp` from the pre-TOOL-002 era. These must
  be removed before the next publish; no code in `src/` currently references them.
- New coordination features must not introduce `agent-*` dependencies without a spec-first design
  approval.

## Architecture Overview

```
src/
  index.ts   # Placeholder comment only — no exports until new features are added

examples/
  verify-offline.ts      # STALE — imports symbols removed by TOOL-002; must be deleted or rewritten
  template-payloads.ts   # STALE — residual type definitions from removed template tools; must be deleted
  scenarios/
    offline-verify.record.json  # STALE — recorded against pre-TOOL-002 build; no longer valid
```

The `examples/` directory contains stale artifacts from the pre-TOOL-002 era. The scenario script
`verify-offline.ts` imports `listTemplateCategoriesTool`, `listTemplatesTool`, and
`getTemplateDetailTool` which no longer exist in `src/index.ts`. These files should be removed
before the next publish.

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

No unit tests required while the package is empty. Tests will be added alongside new features.

**Note:** The `scenario:verify` script in `package.json` and `examples/verify-offline.ts` are
stale artifacts from the pre-TOOL-002 era. The script imports symbols that no longer exist and will
fail at runtime. Both the script and its recorded baseline (`examples/scenarios/offline-verify.record.json`)
must be removed before the scenario harness is re-run for this package.
