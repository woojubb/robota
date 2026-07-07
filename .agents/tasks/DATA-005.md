# DATA-005 — Consolidate ToolRegistry / FunctionTool onto a single SSOT (agent-core)

Spec: `.agents/spec-docs/active/DATA-005-toolregistry-functiontool-ssot.md`
Resolves: ARL-01 (`.agents/architecture-remediation-log.md`)

## Tasks (one+ per TC-N)

- [ ] T1 (TC-04): Write RED-first characterization tests — `additionalProperties: true|object` extra-prop ACCEPTED on the core `tool-manager` path (RED on core today); `additionalProperties: false`/omitted guard rejects on both paths; concrete `ToolRegistry` surface (`size`, `getName`, `setEventService`, `getToolNames`, `getToolsByPattern`).
- [ ] T2 (TC-04): Relocate `agent-tools/src/implementations/function-tool/parameter-validator.ts` → `agent-core/src/tool-registry/parameter-validator.ts`; core `FunctionTool` adopts it (now honors `additionalProperties`, more permissive for `true|object`). Green under T1.
- [ ] T3 (TC-05): Barrel-export `FunctionTool` + `ToolRegistry` from `packages/agent-core/src/index.ts`.
- [ ] T4 (TC-01/TC-02): Delete `agent-tools/src/registry/tool-registry.ts`, the `FunctionTool` class in `agent-tools/src/implementations/function-tool.ts`, and the moved `function-tool/parameter-validator.ts`; factories (`createFunctionTool`/`createZodFunctionTool`) construct core's `FunctionTool`.
- [ ] T5 (TC-02): Drop `ToolRegistry`/`FunctionTool` class re-exports from `agent-tools/src/index.ts` (keep factory + interface exports).
- [ ] T6 (TC-03): Repoint the 5 `agent-playground` `FunctionTool` imports to `@robota-sdk/agent-core`.
- [ ] T7 (TC-01/TC-03): Structural assertions — single owner (`rg "class (ToolRegistry|FunctionTool)"` → only agent-core); no agent-tools class import remains.
- [ ] T8 (TC-06): `pnpm build`, `pnpm typecheck`, affected test suites, `pnpm harness:scan` (45/45) green.
- [ ] T9 (TC-07): Update `agent-core/docs/SPEC.md`, `agent-tools/docs/SPEC.md`, `.agents/project-structure.md` line 9; mark ARL-01 resolved in `.agents/architecture-remediation-log.md`.

## Test Plan / 검증

TDD, RED-first. T1 writes the characterization suite that is genuinely RED on the current core
`FunctionTool` (which rejects extra props unconditionally): a schema with `additionalProperties: true`
(and the object-schema form) + an extra property must be ACCEPTED on the core `tool-manager` path — it
fails today and passes only after T2 relocates the `additionalProperties`-aware validator into core. An
`additionalProperties: false`/omitted case is kept as an unchanged-behavior guard (rejects before and
after). Structural TCs (TC-01/02/03/05) are grep + type-import assertions. Green gate (TC-06):
`pnpm build && pnpm typecheck && pnpm test` for agent-core/agent-tools/agent-playground + `pnpm harness:scan`.
Delegated to the `architecture-implementer` agent under the repo's verified-change discipline.
