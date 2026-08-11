# DATA-001: Extract transport-facing interface types to agent-interface-transport (INFRA-010 L1)

Spec: `.agents/spec-docs/todo/DATA-001-extract-transport-interface-types.md`

## Tasks

- [x] TC-01: Relocate the transport-consumed interface-type closure (currently in
      `packages/agent-framework/src/**`) into `packages/agent-interface-transport/src/**`,
      grouped coherently (e.g. `command-contracts.ts`, `session-contracts.ts`,
      `interaction-contracts.ts`) and re-exported from its `index.ts`. Add
      `@robota-sdk/agent-core` (+ `@robota-sdk/agent-executor` if the closure references
      runtime-layer contracts) to `agent-interface-transport/package.json` deps. Verify the
      exports (`IInteractiveSession`, `ICommand`, `ICommandResult`, `ICommandPluginAdapter`,
      `ICommandInteraction`, `TCommandEffect`, and the rest of the moved closure) via a type
      import test in `agent-interface-transport`.
- [x] TC-02: In `agent-framework`, replace the moved definitions with re-exports from
      `@robota-sdk/agent-interface-transport` so every existing framework import path still
      resolves. Confirm `pnpm --filter @robota-sdk/agent-interface-transport build`,
      `pnpm --filter @robota-sdk/agent-framework build`, and
      `pnpm --filter @robota-sdk/agent-framework typecheck` all pass.
- [x] TC-03: Run the full affected-package gate: `pnpm build`, `pnpm typecheck`, `pnpm test`
      green for all affected packages, plus `node scripts/harness/check-dependency-direction.mjs`
      and `pnpm harness:conformance` exit 0 (no new direction violation; interface→core/executor
      are allowed one-way edges).

## Test Plan

Each task maps 1:1 to a Completion Criterion in the spec; verification mirrors the spec's Test Plan.

| TC-ID | Test Type                     | Tool / Approach                                                                          | Notes                       |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| TC-01 | vitest-expect-type / tsd      | type import test in agent-interface-transport asserting the moved exports                | DATA + typescript           |
| TC-02 | Build/typecheck assertion     | `pnpm --filter` build + typecheck for interface-transport & framework                    | re-export surface unchanged |
| TC-03 | CI pipeline smoke + dep check | `pnpm build`/`typecheck`/`test`; `check-dependency-direction.mjs`; `harness:conformance` | full green gate             |
