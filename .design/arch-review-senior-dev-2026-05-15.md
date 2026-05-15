# Architecture Review — Senior Developer Perspective

Date: 2026-05-15
Reviewer: Senior TypeScript Engineer (automated code-level scan)

---

## Executive Summary

Overall code quality is high. Strict TypeScript is enforced with zero `any` usage and no `@ts-ignore` annotations across all production source files. The layered architecture is correctly implemented, command modules consistently depend only on `@robota-sdk/agent-sdk`, and all 57 workspace packages have `docs/SPEC.md`. The main open issues are: (1) `InteractiveSession` at 1,578 lines severely violates the 300-line anti-monolith rule; (2) six `as unknown as` escape hatches exist in transport adapter `attach()` implementations, caused by an `ISession` vs `IInteractiveSession` contract gap in `agent-interface-transport`; (3) `IMarketplaceSource` is duplicated verbatim between two files in the same package; (4) several I-prefixed `type` aliases violate the naming convention (interface ↔ type prefix rule); (5) the `@deprecated` rule is violated in `agent-provider-google` and `agent-playground`; and (6) the `agent-sessions` package hard-codes the product name `'robota-cli'` as the agent name, violating the no-product-names-in-code rule.

---

## Findings

### [ARCH-SD-001] InteractiveSession 1,578 lines — Severe Anti-Monolith Violation

- **Severity**: High
- **Area**: `packages/agent-sdk/src/interactive/interactive-session.ts`
- **Problem**: The class is 1,578 lines and implements `ISession`, `IAgentJobHostContext`, and `IInteractiveSession` simultaneously. It owns state management, streaming accumulation, tool tracking, skill routing, checkpoint management, background task subscriptions, persistence, fork execution, and system message rebuilding in one file. This is 5× the 300-line limit.
- **Rule violation**: Anti-monolith rule — file ≤ 300 lines, function ≤ 50 lines. The single function `executePrompt` (delegated via `executePromptInner`) plus the constructor are alone above the limit.
- **Recommendation**: Decompose into focused collaborators. The class already references several helpers (`interactive-session-execution.ts`, `interactive-session-streaming.ts`, `interactive-session-init.ts`, `interactive-session-persistence.ts`). What remains in the class body is still a god class. Extract: `InteractiveSessionCommandRouter` (skill/command routing), `InteractiveSessionBackgroundTaskAdapter` (background task subscriptions and state), `InteractiveSessionHistoryAdapter` (history + edit checkpoints). The class itself should be a thin coordinator ≤ 350 lines.

---

### [ARCH-SD-002] `as unknown as IInteractiveSession` in Three Transport Adapters — Contract Gap

- **Severity**: High
- **Area**:
  - `packages/agent-transport-headless/src/headless-transport.ts:30`
  - `packages/agent-transport-ws/src/ws-transport-configurable.ts:46`
  - `packages/agent-transport-http/src/http-transport.ts:27`
- **Problem**: All three transport `attach(session: ISession)` implementations immediately cast the `ISession` parameter to `IInteractiveSession` via `as unknown as IInteractiveSession`. This is not a trust boundary — it is a structural gap in the contract.
- **Rule violation**: `as unknown as` in production code is a type-safety escape hatch that signals a contract design issue. The `ITransportAdapter.attach()` signature accepts `ISession` (from `agent-core`), but all callers pass an `IInteractiveSession` (from `agent-sdk`). The two types are not structurally compatible without the cast.
- **Current code** (headless-transport.ts:30):
  ```typescript
  session = s as unknown as IInteractiveSession;
  ```
- **Recommendation**: Either (a) make `ITransportAdapter.attach()` in `agent-interface-transport` generic — `attach(session: TSession): void` — so each transport can declare its own session type, or (b) widen the `ISession` interface in `agent-core`/`agent-interface-transport` to include the methods the transports actually need (e.g., `getMessages()`, `on()`, `off()`). Option (a) is preferred as it keeps the contract honest without widening the base interface.

---

### [ARCH-SD-003] `ICommandHostContext` Has 10 Optional Members — Weak Interface Contract

- **Severity**: High
- **Area**: `packages/agent-sdk/src/command-api/host-context.ts:75–113`
- **Problem**: `ICommandHostContext` has 10 optional method members (marked `?`): `clearConversationHistory`, `validateCurrentSessionReplayLog`, `getAutoCompactThresholdSource`, `setAutoCompactThreshold`, `getCommandHostAdapters`, `listContextReferences`, `addContextReference`, `removeContextReference`, `clearContextReferences`, `getCommandInvocationSource`, `listCommands`, `listSkills`, `inspectEditCheckpoint`. Callers in command modules must guard every call with `?.`, making the contract meaningless as a guarantee. The interface is essentially a partial duck type with required methods as the exception, not the rule.
- **Rule violation**: Interface contracts should guarantee what is available. Optional members on a command-host context interface undermine the command isolation pattern — command modules cannot rely on the host providing key capabilities.
- **Recommendation**: Separate `ICommandHostContext` into a required base (`ICommandHostContext`) covering methods all command modules need, and optional capability interfaces (`ICompactCapable`, `IMemoryCapable`, `IContextReferenceCapable`, `ICheckpointCapable`) that individual command modules can `import type` and narrow to via `in` checks. Each command module declares which capabilities it requires via its `ICommandModule.sessionRequirements` array.

---

### [ARCH-SD-004] `agent-command-agent` Uses `as unknown as` to Cast `ICommandHostContext` → `IAgentJobHostContext`

- **Severity**: High
- **Area**: `packages/agent-command-agent/src/agent-command-module.ts:12`
- **Problem**: The `asAgentHostContext()` helper function performs `context as unknown as IAgentJobHostContext` to obtain the extended agent job interface. At runtime, `InteractiveSession` does implement `IAgentJobHostContext`, but the type system is blind to this.
- **Rule violation**: `as unknown as` in production code. This cast masks a structural mismatch that should be resolved at the contract level.
- **Current code**:
  ```typescript
  function asAgentHostContext(context: ICommandHostContext): IAgentJobHostContext {
    return context as unknown as IAgentJobHostContext;
  }
  ```
- **Recommendation**: `IAgentJobHostContext` should be exposed as an optional capability on `ICommandHostContext` (or via the capability split recommended in ARCH-SD-003). For example, `ICommandHostContext` could expose `getAgentJobCapabilities?(): IAgentJobHostContext | undefined`, and `agent-command-agent` calls that method and throws a `sessionRequirements` error if absent.

---

### [ARCH-SD-005] `IMarketplaceSource` Type Duplicated Verbatim in Same Package

- **Severity**: Medium
- **Area**:
  - `packages/agent-sdk/src/plugins/marketplace-types.ts:6–10` (SSOT)
  - `packages/agent-sdk/src/plugins/plugin-settings-store.ts:11–15` (duplicate)
- **Problem**: `IMarketplaceSource` is defined identically in both files:
  ```typescript
  export type IMarketplaceSource =
    | { type: 'github'; repo: string; ref?: string }
    | { type: 'git'; url: string; ref?: string }
    | { type: 'local'; path: string }
    | { type: 'url'; url: string };
  ```
  This is a direct SSOT violation. Additionally, `IKnownMarketplaceEntry` in `marketplace-types.ts` and `IPersistedMarketplaceSource` in `plugin-settings-store.ts` both describe `{ source: IMarketplaceSource }` with differing names and additional fields.
- **Rule violation**: No cross-package type duplication (applies equally within a package — one owner per fact).
- **Recommendation**: Remove the duplicate from `plugin-settings-store.ts` and import from `marketplace-types.ts`. Unify or at minimum `extend`/compose `IPersistedMarketplaceSource` from `IKnownMarketplaceEntry` if they differ intentionally.

---

### [ARCH-SD-006] `ExecFn` Naming Violates T/I Prefix Convention + Duplicate Definition

- **Severity**: Medium
- **Area**:
  - `packages/agent-sdk/src/plugins/marketplace-types.ts:39` (exported as `ExecFn`)
  - `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts:27` (private redefinition)
- **Problem**: `ExecFn` has no `T` prefix despite being a type alias for a function type. It is also privately redefined in `bundle-plugin-installer.ts` despite `marketplace-types.ts` already exporting the same shape.
- **Rule violation**: `T*` prefix for type aliases. No type duplication.
- **Recommendation**: Rename to `TExecFn` in `marketplace-types.ts`. Remove the duplicate private definition in `bundle-plugin-installer.ts` and import `TExecFn` from `marketplace-types.ts`.

---

### [ARCH-SD-007] I-Prefixed `type` Aliases — Naming Convention Violations

- **Severity**: Medium
- **Area**: Multiple files
  - `packages/agent-sdk/src/plugins/marketplace-types.ts:6` — `export type IMarketplaceSource`
  - `packages/agent-sdk/src/plugins/marketplace-types.ts:36` — `export type IKnownMarketplacesRegistry`
  - `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts:24` — `export type IInstalledPluginsRegistry`
  - `packages/agent-sdk/src/interactive/interactive-session-init.ts:116` — `export type IInteractiveSessionOptions`
  - `packages/agent-runtime/src/background-tasks/types.ts:116` — `export type IBackgroundTaskRequest`
  - `packages/agent-core/src/hooks/types.ts:61` — `export type IHookDefinition`
  - `packages/agent-cli/src/utils/statusline-settings.ts:10` — `export type IStatusLineSettings`
  - `packages/agent-transport-http/src/routes.ts:14` — `export type ISessionFactory`
- **Problem**: All the above use the `I*` prefix on `type` aliases. Per the naming convention, `I*` is reserved for `interface` declarations; `type` aliases must use `T*`.
- **Rule violation**: Interface naming rule: `I*` = `interface` only, `T*` = type alias only.
- **Recommendation**: Rename all `type I*` aliases to `T*`. This is a breaking rename across the codebase; do it in one PR with a search-and-replace pass. Key renames: `IMarketplaceSource` → `TMarketplaceSource`, `IInteractiveSessionOptions` → `TInteractiveSessionOptions`, `IBackgroundTaskRequest` → `TBackgroundTaskRequest`, `IHookDefinition` → `THookDefinition`, `ISessionFactory` → `TSessionFactory`.

---

### [ARCH-SD-008] `@deprecated` Annotations in `agent-provider-google` and `agent-playground`

- **Severity**: Medium
- **Area**:
  - `packages/agent-provider-google/src/types.ts:7,12`
  - `packages/agent-provider-google/src/provider.ts:5`
  - `packages/agent-playground/src/contexts/playground-context/types.ts:31`
- **Problem**: `@deprecated` JSDoc annotations are present on exported types and a class.

  ```typescript
  // types.ts
  /** @deprecated Use `TGeminiProviderOptionValue` from `@robota-sdk/agent-provider-gemini`. */
  export type TGoogleProviderOptionValue = TGeminiProviderOptionValue;

  // provider.ts
  /** @deprecated Import `GeminiProvider` from `@robota-sdk/agent-provider-gemini`. */
  export class GoogleProvider extends GeminiProvider { ... }

  // playground types.ts
  /** @deprecated Use usePlaygroundState() or usePlaygroundActions() for better performance. */
  ```

- **Rule violation**: No deprecated — delete or migrate within the same PR. `agent-provider-google` is an undistributed package; its consumers are internal and can be migrated.
- **Recommendation**: For `agent-provider-google`: verify no external consumers, remove the package or fold its redirect exports into a single barrel in `agent-provider-gemini`. For `agent-playground`: migrate callers of the deprecated context type to `usePlaygroundState()`/`usePlaygroundActions()`, then delete the deprecated type.

---

### [ARCH-SD-009] Hard-coded Product Name `'robota-cli'` in `agent-sessions` — Foundation Layer

- **Severity**: Medium
- **Area**: `packages/agent-sessions/src/session.ts:167`
- **Problem**: The `Session` constructor hard-codes `name: 'robota-cli'` in the `IAgentConfig` it builds:
  ```typescript
  const agentConfig: IAgentConfig = {
    name: 'robota-cli',
    ...
  };
  ```
  `agent-sessions` is a foundation package consumed by SDK, transports, and potentially any host. The agent name is an internal implementation detail of the CLI, not the session layer.
- **Rule violation**: No product names in code (feedback rule). Foundation packages must not reference specific consumer names.
- **Recommendation**: Add an optional `agentName?: string` field to `ISessionOptions` (or infer from the provider name). Default to a generic string like `'session-agent'` or the provider name. The CLI can pass `'robota-cli'` if it needs to.

---

### [ARCH-SD-010] `IWorkflowConversionResult.data` Non-Optional But Bypassed with `undefined as unknown as TOutput`

- **Severity**: Medium
- **Area**: `packages/agent-core/src/abstracts/workflow-converter-helpers.ts:91`
- **Problem**: `IWorkflowConversionResult<TOutput>.data` is typed as the required non-optional `TOutput`. The `buildFailureResult` helper sets it to `undefined as unknown as TOutput` to satisfy the shape on failure paths:
  ```typescript
  data: undefined as unknown as TOutput,
  success: false,
  ```
  This is a dishonest type that allows callers to dereference `result.data` even when `result.success === false`, producing a runtime error.
- **Rule violation**: `as unknown as` bypass; dishonest contract.
- **Recommendation**: Change `IWorkflowConversionResult` to `data: TOutput | undefined` (or `data?: TOutput`). Callers should narrow on `result.success` before using `result.data`. Alternatively, use a discriminated union: `{ success: true; data: TOutput } | { success: false; data?: never }`.

---

### [ARCH-SD-011] `ICommandSessionRuntime.getAutoCompactThreshold` Optional vs Required Inconsistency

- **Severity**: Medium
- **Area**: `packages/agent-sdk/src/command-api/host-context.ts:64,79`
- **Problem**: `getAutoCompactThreshold` appears twice with different optionality:
  - In `ICommandSessionRuntime` (line 64): `getAutoCompactThreshold?(): number | false` (optional)
  - In `ICommandHostContext` (line 79): `getAutoCompactThreshold(): TAutoCompactThreshold` (required)
    The two interfaces form a composition (`ICommandHostContext.getSession()` returns `ICommandSessionRuntime`), so the same operation has two different contracts depending on which interface you call it through.
- **Rule violation**: Inconsistent contract between related interfaces. Callers of `ICommandSessionRuntime` must guard with `?.`, while callers of `ICommandHostContext` do not.
- **Recommendation**: Decide the canonical optionality. If `getAutoCompactThreshold` is always available on the session, make it required in `ICommandSessionRuntime`. If not, make it optional in `ICommandHostContext` too and update all callers.

---

### [ARCH-SD-012] `agent-tools` Built-in Tools Use Repeated `as unknown as IZodSchema` Pattern

- **Severity**: Medium
- **Area**:
  - `packages/agent-tools/src/builtins/web-fetch-tool.ts:104`
  - `packages/agent-tools/src/builtins/write-tool.ts:51`
  - `packages/agent-tools/src/builtins/glob-tool.ts:103`
  - `packages/agent-tools/src/builtins/read-tool.ts:164`
  - `packages/agent-tools/src/builtins/edit-tool.ts:115`
  - `packages/agent-tools/src/builtins/web-search-tool.ts:101`
  - `packages/agent-tools/src/builtins/grep-tool.ts:228`
  - `packages/agent-tools/src/builtins/bash-tool.ts:144`
- **Problem**: Every built-in tool must cast its Zod schema to `IZodSchema` via `as unknown as IZodSchema`. This is an 8-instance systematic cast that indicates the `IZodSchema` interface (in `implementations/function-tool/types.ts`) does not correctly structurally type Zod schemas.
- **Rule violation**: `as unknown as` in production code — 8 occurrences in this domain alone.
- **Recommendation**: Widen `IZodSchema` to be structurally compatible with `z.ZodObject<...>`, or replace `IZodSchema` with a proper type that Zod schemas implement without a cast. The comment in `types.ts` admits type assertions as a trade-off; this is an accepted but unsatisfactory resolution. At minimum, the cast should be centralized to one location (inside `createZodFunctionTool`) rather than repeated at every call site.

---

### [ARCH-SD-013] `process.cwd()` Fallback in `InteractiveSession.getCwd()` Masks Missing `cwd`

- **Severity**: Low
- **Area**: `packages/agent-sdk/src/interactive/interactive-session.ts:655`
- **Problem**: `getCwd()` returns `this.cwd ?? process.cwd()`. This is a silent fallback that masks the case where no `cwd` was provided — a condition that should be an error for tools that write files.
- **Rule violation**: No fallback — if value is absent, treat it as a bug. `process.cwd()` varies between test environments and production contexts, making behavior non-deterministic.
- **Recommendation**: Make `cwd` required in `IInteractiveSessionStandardOptions` (it already is). For the `IInteractiveSessionInjectedOptions` path where `cwd` is optional, throw explicitly if `getCwd()` is called and `cwd` is undefined rather than silently falling back to `process.cwd()`.

---

### [ARCH-SD-014] `agent-remote-client` Debug Logger Calls with Emoji Prefixes and Verbose Diagnostics

- **Severity**: Low
- **Area**: `packages/agent-remote-client/src/client/chat-http-methods.ts:105,181,198,202,249`
- **Problem**: The file contains 6 logger calls with emoji prefixes (`🔧`, `🌐`, `❌`, `🔍`) and debug-level diagnostic strings like `'🔧 [HTTP-CLIENT] Request tools:'` that appear to be leftover development scaffolding rather than structured log events.
- **Rule violation**: Production files should use structured logging via DI, not ad-hoc emoji strings as message prefixes. While these use the injected `logger` (not `console.*`), the message format is not structured and the info-level calls emit on every request.
- **Recommendation**: Remove emoji prefixes. Reduce info-level tool-count logging to debug. Add a structured fields object (not the message string) for queryable log events.

---

### [ARCH-SD-015] `TModelConfig` and `TConfigurationSnapshot` Are Private `type` Shapes in `robota.ts` — Should Be `interface`

- **Severity**: Low
- **Area**: `packages/agent-core/src/core/robota.ts:63,73`
- **Problem**: Two type aliases define object shapes with multiple named properties:
  ```typescript
  type TModelConfig = { provider: string; model: string; temperature?: number; ... };
  type TConfigurationSnapshot = { version: number; tools: Array<...>; updatedAt: number; };
  ```
  Both are shapes (not unions or mapped types), so the correct declaration form is `interface`.
- **Rule violation**: Object shapes must use `interface`, not `type` alias.
- **Recommendation**: Convert to `interface IModelConfig` and `interface IConfigurationSnapshot` (or keep private with `interface` by removing `export` if not needed externally).

---

### [ARCH-SD-016] `provider-command-execution.ts` at 713 Lines — Anti-Monolith

- **Severity**: Low
- **Area**: `packages/agent-command-provider/src/provider-command-execution.ts`
- **Problem**: This file is 713 lines, 2.4× the 300-line limit. It contains the complete provider command execution logic including profile picker, profile edit, test, duplicate, delete, and switch flows in a single file.
- **Rule violation**: Anti-monolith rule — file ≤ 300 lines.
- **Recommendation**: Split into sub-files by flow: `provider-command-picker.ts`, `provider-command-edit.ts`, `provider-command-test.ts`, with a thin `provider-command-execution.ts` that delegates to each.

---

## Positive Findings

1. **Zero `any` usage**: `grep ": any\|as any\|<any>"` across all `src/` directories returns no results. Strict TypeScript is fully enforced.
2. **No `@ts-ignore` or `@ts-nocheck`**: Zero occurrences across the entire monorepo source.
3. **No React in `agent-sdk`**: No `from 'react'` imports in `packages/agent-sdk/src/`.
4. **No `console.*` in production `src/` files**: All logging routes through the injected `ILogger` DI interface. The only `console` match is a URL constant in a provider definition (not a log call).
5. **All 57 packages have SPEC.md**: Complete coverage — no package is missing its contract document.
6. **Command module dependency isolation is clean**: All `agent-command-*` packages depend only on `@robota-sdk/agent-sdk` (and `agent-core` for `agent-command-provider`). None import from peer command modules.
7. **`ICommandHostContext` is the sole injection point**: Command module `execute()` callbacks consistently receive only `ICommandHostContext` — no direct `InteractiveSession` references in command packages.
8. **Named constants for magic numbers**: `STREAMING_FLUSH_INTERVAL_MS`, `MAX_COMPLETED_TOOLS`, `DEFAULT_MAX_TURNS`, `CONTEXT_HARD_BLOCK_THRESHOLD`, `GIT_TIMEOUT_MS` — magic numbers are promoted to named constants in their respective files.
9. **No cross-layer dependency violations**: `agent-core` → `agent-sessions` → `agent-sdk` direction is respected. `agent-interface-transport` is correctly isolated with no dependency on `agent-sdk`.
10. **`IInteractiveSession` interface exists and is correct**: The transport-facing interface is properly defined and structurally sound. The issue (ARCH-SD-002) is the `ISession` vs `IInteractiveSession` structural gap in the transport attach contract, not a missing abstraction.

---

## Summary Table

| ID          | Title                                                                                                | Severity | Area                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| ARCH-SD-001 | InteractiveSession 1,578 lines — anti-monolith                                                       | High     | `agent-sdk/src/interactive/interactive-session.ts`                       |
| ARCH-SD-002 | `as unknown as IInteractiveSession` in 3 transport adapters                                          | High     | `agent-transport-headless`, `agent-transport-ws`, `agent-transport-http` |
| ARCH-SD-003 | `ICommandHostContext` has 10 optional members — weak contract                                        | High     | `agent-sdk/src/command-api/host-context.ts`                              |
| ARCH-SD-004 | `agent-command-agent` casts ICommandHostContext via `as unknown as`                                  | High     | `agent-command-agent/src/agent-command-module.ts`                        |
| ARCH-SD-005 | `IMarketplaceSource` duplicated verbatim in same package                                             | Medium   | `agent-sdk/src/plugins/`                                                 |
| ARCH-SD-006 | `ExecFn` naming violation + duplicate definition                                                     | Medium   | `agent-sdk/src/plugins/`                                                 |
| ARCH-SD-007 | I-prefixed `type` aliases violate naming convention (8 files)                                        | Medium   | Multiple packages                                                        |
| ARCH-SD-008 | `@deprecated` annotations present in production source                                               | Medium   | `agent-provider-google`, `agent-playground`                              |
| ARCH-SD-009 | Hard-coded `'robota-cli'` product name in `agent-sessions` foundation                                | Medium   | `agent-sessions/src/session.ts`                                          |
| ARCH-SD-010 | `buildFailureResult` uses `undefined as unknown as TOutput` to satisfy non-optional field            | Medium   | `agent-core/src/abstracts/workflow-converter-helpers.ts`                 |
| ARCH-SD-011 | `getAutoCompactThreshold` optional in `ICommandSessionRuntime` but required in `ICommandHostContext` | Medium   | `agent-sdk/src/command-api/host-context.ts`                              |
| ARCH-SD-012 | Built-in tools repeat `as unknown as IZodSchema` 8 times                                             | Medium   | `agent-tools/src/builtins/`                                              |
| ARCH-SD-013 | `process.cwd()` silent fallback in `getCwd()`                                                        | Low      | `agent-sdk/src/interactive/interactive-session.ts:655`                   |
| ARCH-SD-014 | Emoji + diagnostic logger calls in `agent-remote-client`                                             | Low      | `agent-remote-client/src/client/chat-http-methods.ts`                    |
| ARCH-SD-015 | `TModelConfig` / `TConfigurationSnapshot` are object shapes — should be `interface`                  | Low      | `agent-core/src/core/robota.ts:63,73`                                    |
| ARCH-SD-016 | `provider-command-execution.ts` at 713 lines — anti-monolith                                         | Low      | `agent-command-provider/src/provider-command-execution.ts`               |
