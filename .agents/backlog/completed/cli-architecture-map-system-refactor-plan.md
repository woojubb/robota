# CLI Architecture Map System Refactor Plan

## Status

Completed.

Completed: 2026-05-05

Implementation branch: docs/cli-architecture-target-plan

## Priority

P1 - converts the current architecture map from a descriptive audit into a target architecture and
implementation plan for the CLI beta.

## Problem

`packages/agent-cli/docs/ARCHITECTURE-MAP.md` now documents the current CLI composition path, but
the next step is not to improve the document format. The next step is to use that map as the source
for a real architecture review: check whether package layers, class ownership, dependency edges, and
cross-package contracts form a coherent system.

Known areas that need architecture-level review:

- CLI TUI state and SDK session state boundaries.
- Built-in command package ownership versus SDK command API ownership.
- Provider/model setup and volatile model catalog ownership.
- Session persistence, resume/fork, and project-local storage facades.
- Interactive TUI versus non-interactive transport composition.
- Background task, subagent, worktree, checkpoint, and reversible execution ownership.
- Whether contracts are owned by the right package instead of being duplicated or passed through.

## Recommended Direction

Run a source-backed architecture audit against `packages/agent-cli/docs/ARCHITECTURE-MAP.md`, then
produce a target architecture and refactor plan. The target must describe the intended system
architecture, not merely a cleaner documentation layout.

Recommended work sequence:

1. Verify the current architecture map against source imports, package manifests, and package
   `docs/SPEC.md` files.
2. Identify actual architectural contradictions:
   - forbidden or surprising dependency edges;
   - UI state leaking into SDK/session objects;
   - SDK owning behavior that should be a command package or host adapter;
   - command packages depending on CLI/TUI concerns;
   - duplicated provider/model/session contracts;
   - pass-through exports that hide true ownership;
   - runtime concerns bypassing SDK-owned ports.
3. Define a target architecture with explicit layer ownership:
   - CLI/TUI: thin host, rendering, input, and host adapters only;
   - SDK: common APIs, ports, command host contracts, session orchestration, and facades;
   - built-in command packages: command behavior and descriptors;
   - provider packages: provider definitions and provider transport translation;
   - sessions/runtime/tools/core: lower-level execution contracts and implementations.
4. Update `ARCHITECTURE-MAP.md` with both:
   - the verified current architecture and known design debts;
   - the recommended target architecture and migration direction.
5. Split implementation into concrete refactor backlogs, each with package/file scope, acceptance
   criteria, and verification commands.
6. Add or extend harness checks for mechanically enforceable boundaries.

## Acceptance Criteria

- [x] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` is re-verified against current source and
      package specs.
- [x] The audit explicitly evaluates actual architecture quality, not document organization.
- [x] All confirmed contradictions are recorded with source file references and owner package.
- [x] A target architecture is documented with allowed dependency edges and contract ownership.
- [x] Each recommended structural change is split into an actionable backlog item.
- [x] Recommendations distinguish immediate beta refactors from optional polish.
- [x] Any mechanically enforceable boundary has either a harness check or a follow-up backlog for
      adding one.
- [x] Repository rules or common-mistakes guidance are updated only for durable lessons that apply
      beyond this one package.

## Verification Plan

- `rg -n "from '@robota-sdk|from \"@robota-sdk" packages/agent-cli/src packages/agent-sdk/src packages/agent-command-*`
- `pnpm harness:scan:commands`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:specs`
- `pnpm docs:build`

If the audit leads to code changes, run the affected package build/test/typecheck commands for every
changed package.

## Result

Completed via `docs/cli-architecture-target-plan`. `ARCHITECTURE-MAP.md` now separates the verified
current CLI composition from the recommended target architecture, records source-backed structural
debts, and links each confirmed refactor to a dedicated backlog item:

- `.agents/backlog/cli-command-effect-state-boundary.md`
- `.agents/backlog/cli-command-compat-shims-retirement.md`
- `.agents/backlog/cli-runtime-adapter-boundary-audit.md`
- `.agents/backlog/provider-model-catalog-refresh-adapters.md`
- `.agents/backlog/sdk-public-surface-owner-audit.md`

No repository rule change was needed in this task because architecture-map update requirements were
already present in `.agents/rules/spec-workflow.md`, `.agents/rules/documentation-sync.md`, and
`.agents/rules/common-mistakes.md`.
