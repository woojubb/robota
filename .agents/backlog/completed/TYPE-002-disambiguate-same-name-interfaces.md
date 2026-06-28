---
title: 'TYPE-002: Disambiguate same-name, different-shape interfaces across packages'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: later
area: packages (agent-core, agent-interface-transport, agent-playground, agent-transport-tui)
depends_on: []
---

## Evidence Log (2026-06-27) — user decision: "전부 정리" (rename all)

Disambiguated every same-name collision; the canonical contract types
(agent-interface-transport) keep their names, the others are renamed by import source:

- `IUsageSnapshot`: agent-playground → `IPlaygroundUsageSnapshot`.
- `IPermissionRequest`: agent-transport-tui → `IPendingPermissionRequest`.
- `IExecutionResult`: **agent-core** (public) → `ICoreExecutionResult` (the session-contract
  `IExecutionResult` is the canonical one). Internal-only — no external consumers broke.
- `IProviderConfig` (three): agent-playground → `IPlaygroundProviderConfig`;
  agent-core abstract-ai-provider → `IProviderRuntimeConfig`; agent-core provider-definition
  (public, exported) → `IProviderDefinitionConfig` (consumers in agent-framework,
  agent-subagent-runner, agent-executor updated).
- agent-core SPEC updated for the public renames; agent-framework SPEC left as-is (its
  `IExecutionResult` is the unchanged contract type).
- Verified: `pnpm build:deps` + `pnpm typecheck` clean (only the pre-existing EXAMPLES-002
  express drift remains); `pnpm harness:scan` 32/32 (public-surface + interface-imports PASS);
  agent-core + agent-interface-transport tests pass.

# Disambiguate same-name, different-shape interfaces

Split from TYPE-001 (which fixed the true `IDiffLine` SSOT duplicate). These are **distinct**
types in distinct modules that share a name — not SSOT violations (TypeScript resolves them by
import path), but a readability/foot-gun nit (importing the wrong one yields a confusing shape
mismatch).

## What

Confirmed-distinct same-name interfaces (rename the non-canonical ones for clarity; do NOT
merge — they model different data):

- `IExecutionResult` — `agent-interface-transport/session-contracts.ts` (response/history/usage)
  vs `agent-core/services/execution-types.ts` (response/messages/executionId/...). ~29 files.
  **Public in agent-core** — rename deliberately (e.g. the core one → `ICoreExecutionResult`),
  and present the naming choice before applying.
- `IPermissionRequest` — `agent-interface-transport/interaction-contracts.ts` (`id/toolName/toolArgs`)
  vs `agent-transport-tui/types.ts` (adds a `resolve` callback). ~9 files. Rename the TUI one
  (e.g. `IPendingPermissionRequest`).
- `IProviderConfig` — three shapes: `agent-playground/hooks/use-provider-config.ts`,
  `agent-core/abstracts/abstract-ai-provider.ts`, `agent-core/interfaces/provider-definition.ts`
  (note `baseUrl` vs `baseURL`). ~11 files. Rename the playground one + disambiguate the two
  agent-core ones (e.g. `IProviderRuntimeConfig` vs `IProviderDefinitionConfig`).
- `IUsageSnapshot` — `agent-interface-transport/session-contracts.ts` (token metrics) vs
  `agent-playground/.../usage-monitor/types.ts` (UI display). ~10 files. Rename the
  playground one (private package → low risk).

Start with the **private agent-playground** renames (low risk), then the TUI one, then the
public agent-core ones (with a confirmed naming decision). Add the I/T `naming-convention` lint
already enforces prefixes; this is about uniqueness, not prefixes.

## Why

Same-name types across package boundaries invite accidental wrong-imports and make the codebase
harder to read; disambiguating removes the foot-gun. Deferred from TYPE-001 because the
agent-core renames touch a public surface (29 files) and need a deliberate naming decision.

## Done When

- Each listed name resolves to a single declaration, or distinct ones are renamed to unambiguous
  names; SPEC/README updated for any public rename.
- `pnpm typecheck` + `pnpm harness:scan` pass.

## Test Plan

- `git grep -lw <name>` per type → either one declaration or clearly-distinct renamed types.
- Full typecheck after each package's renames.

## User Execution Test Scenarios

Not applicable — type-naming refactor; no runtime behavior change. Evidence = unique names +
green typecheck.
