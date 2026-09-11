---
status: in-progress
type: API
tags: [typescript, async]
lane: L2
---

# API-001: map model effort to provider capabilities and visible outcomes

Paired with `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md`. Arising from [issue #1987](https://github.com/woojubb/robota/issues/1987).

## Problem

The single framework effort scale reaches a provider request as `IChatOptions.effort`, but the runtime
does not know which levels the selected model supports. Reproduce with an effort-enabled session or a
direct provider call: OpenAI's current mapper receives no model identifier and converts every `xhigh`
or `max` request to `high`; Anthropic never merges `effort` into `output_config`; Gemini never maps
the framework value into `thinkingConfig`. The outgoing request and native-payload callback therefore
cannot truthfully report whether the requested value was applied.

The loss begins earlier for an interactive session. FLOW-008 resolves `auto` to a framework fallback
of `high`, and `execution-round-provider.ts` also defaults an omitted value to `high`. At the provider
boundary, an explicit `high` and `auto` are indistinguishable, so a provider cannot select and report
its documented per-model default. Sending an unverified native field would turn this ambiguity into a
remote validation error; silently omitting it would turn it into a false success claim.

There is a second unreported path: all three adapters delegate to an injected `IExecutor` before they
reach their native SDK, while the generic `IProviderRequest` used by `generateResponse()` has no effort
field at all. An adapter cannot truthfully emit a provider-native raw request for either opaque path;
the public outcome channel must report that limitation instead of inventing native-payload evidence.

The reachable surface is wider than those three seams. A forced execution summary directly calls
`provider.chat()`, presets and frontmatter currently reject the two missing effort tiers, and remote
execution serializes `IChatOptions` through `agent-remote-client` and `agent-server`. A callback cannot
cross that wire unchanged, so each of these paths needs the same serializable effort outcome rather
than a local-only success claim.

## Prior Art Research

Verified on 2026-09-11 against the current provider documentation, rather than relying on the
2026-08-22 snapshot in issue #1987.

- [OpenAI's reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) defines the
  Responses request field as `reasoning.effort`; it explicitly says that GPT-6 Astra rejects `none`
  and that defaults are model-dependent (for example, `gpt-5.5` defaults to `medium`). A provider-wide
  clamp is therefore not a valid capability model.
- [Anthropic's effort guide](https://platform.claude.com/docs/en/build-with-claude/effort) defines
  `output_config.effort`, calls effort a behavioural signal rather than a fixed token budget, and
  documents model-dependent level availability and defaults. It also warns that support for `max`
  does not imply support for `xhigh`.
- [Gemini's thinking guide](https://ai.google.dev/gemini-api/docs/thinking) defines a model table for
  `thinking_level`; the table contains different defaults and level sets even inside the Gemini 3
  family. The legacy [Generate Content thinking guide](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
  documents the older numeric `thinkingBudget` control used by the SDK surface Robota currently calls.

The common constraint is that the user-facing names are ordinal only within a documented model
capability set. Robota must keep its provider-neutral request and outcome typed, preserve the native
wire payload inside each adapter, and refuse to claim application when the selected model or endpoint
is not verified.

## Architecture Review

### Affected Scope

- `packages/agent-core/src/interfaces/provider.ts`, a new core-owned model-effort capability module,
  its public exports, `IProviderRequest`/`IRawProviderResponse`, the provider-instance effort-table
  port, and the execution request assembly/cache-input seam.
- `packages/agent-core/src/abstracts/abstract-ai-provider.ts` and executor helper tests, which must
  preserve selection, resolution handoff, and outcome delivery on both generic streaming shapes while
  reporting an opaque executor as unable to verify native application.
- `packages/agent-core/src/services/execution-forced-summary.ts`, which must reuse the same assembly and
  outcome path instead of bypassing it with a hand-built `IChatOptions`.
- `packages/agent-framework/src/effort/`, command-session model reapplication contracts, and their
  tests, which must preserve `auto` until a provider-model resolver has enough information.
- `packages/agent-cli/src/startup/effort-resolution.ts` and its focused tests, which must not relabel a
  provisional framework fallback as the provider's actual model default.
- `packages/agent-preset` validation and the framework frontmatter decoder, which must accept the
  Core-owned `none` and `minimal` vocabulary at their untrusted-data boundaries.
- `packages/agent-remote-client/src/client/wire-chat-options.ts`, its remote protocol tests, and
  `apps/agent-server/src/remote-chat-options.ts`, which must serialize selection, reject invalid tiers,
  keep function callbacks local, and return a serializable outcome to the requesting client.
- `packages/agent-provider-openai/src/openai/` request construction, capability table, focused tests,
  and a public verification example.
- `packages/agent-provider-anthropic/src/anthropic/` output-config assembly, capability table, focused
  tests, and a public verification example.
- `packages/agent-provider-gemini/src/gemini/` request construction, capability table, focused tests,
  and a public verification example.
- The governing `docs/SPEC.md` files for all affected packages and, if the core contract changes the
  cross-package provider boundary, its owning cross-cutting specification.

Sibling scan: the existing `IProviderCapabilityTable` / `resolveModelCapabilities` pair is the
structural analogue for provider-owned model facts, while `structured-output-transport.ts` is the
analogue for a pure core resolution outcome that an adapter serializes. Neither may be extended by
embedding an SDK request type in Core.

### Alternatives Considered

1. Retain a separate provider-wide mapper in every adapter.
   - Pro: Smallest immediate diff and no shared contract change.
   - Con: It cannot represent a model default, an unknown model, endpoint provenance, or the same
     requested/effective/disposition outcome for direct and framework calls. It repeats the stale
     OpenAI assumption that caused this Task.
2. Resolve every effort selection in the CLI/framework before provider construction.
   - Pro: One apparent user-facing decision point.
   - Con: The CLI does not own provider model documentation or native field rules, and it has already
     erased `auto`. This would duplicate provider capability data in a product layer and make direct
     provider consumers incorrect.
3. Define a Core-owned semantic capability/outcome contract, let each provider package declare only
   verified model entries, and serialize the resolved outcome in its own adapter.
   - Pro: One typed result is available to execution, the native-payload callback, tests, and DATA-007
     without leaking OpenAI, Anthropic, or Gemini SDK types into Core.
   - Con: It changes a shared contract and requires coordinated tests and package-spec updates.

### Decision

Choose alternative 3, with the following ownership boundary. `agent-core` owns `TModelEffort` (extended
with `none` and `minimal`), the separate `auto` selection, the provider-neutral effort-table type, the
serializable `IModelEffortResolution` / `IModelEffortOutcome` records, and a pure resolver. It does not
own any vendor's models, defaults, source dates, or native field names. Each adapter owns a complete,
source-dated table and exposes it through a new optional `IAIProvider` effort-table accessor; a missing
accessor or model entry is intentionally `not-applied`. This differs from general model capabilities:
effort-table silence never falls back to a vendor default because sending an undocumented field mutates a
request.

The resolution has `exact`, `clamped`, `model-default`, or `not-applied` semantics and an immutable
fingerprint. The separate serializable outcome has three non-conflated facts: selection/resolution,
native-control state (`sent` or `omitted` with reason), and provider-dispatch state (`sent` or
`not-dispatched` with reason). Thus `auto` can report a documented effective default while omitting the
control from an otherwise dispatched request; an unknown model can likewise dispatch without that
control; and only cache or opaque-executor branches are `not-dispatched`.

Placement decision: the new provider accessor, request handoff, result record, and public observer
mirror the existing Core-owned `IProviderCapabilityTable` / `resolveModelCapabilities` contract layer.
Their taxonomy is shared Core library/contract infrastructure, not a provider, framework, CLI, or
presentation product surface. Providers reuse the Core resolver and outcome types, retain their own
verified tables and SDK serialization, and never depend on a sibling provider product or leak SDK types
through Core.

There is one request-scoped outcome route, with a topology-specific authority. Core resolves through the
provider accessor before dispatch and passes an immutable resolution handoff to the adapter. A direct or
local framework adapter publishes once after its branch is chosen. Core publishes only the explicit cache
`not-dispatched` outcome because no adapter is called. An opaque executor uses the local canonical
`not-applied`/`not-dispatched` result. A remote executor does neither: the server-side adapter that owns
the endpoint resolves and produces the terminal outcome, and the client executor transports it without
inventing a local result.

`IChatOptions` and `IProviderRequest` both carry selection plus an `onModelEffortOutcome` observer.
`IExecutor` gains a serializable terminal-result envelope so remote and local execution can return that
one outcome without attaching it to every message chunk. Default generic non-streaming bridges return the
terminal outcome; generic streaming exposes one explicit terminal outcome envelope after message chunks,
never a repeated optional field. Remote HTTP returns the same envelope and remote SSE emits one terminal
outcome frame. The remote client keeps the callback local and invokes it once from that terminal value.
Observer failures are caught and logged as observation failures; they never replace a provider dispatch
failure. The native raw-payload event is emitted only when a native SDK request is actually constructed,
after the semantic outcome has established its control and dispatch states.

For an effort-bearing request API-001 disables cache lookup and storage until DATA-007 adds the semantic
fingerprint to cache identity; this preserves correctness for `low` → `high` calls without changing the
cache key in this Task. DATA-007 remains the only owner of cache-key persistence and re-enables safe
reuse. The forced-summary path uses this same assembly helper. Remote transport serializes selection and
the final `IModelEffortOutcome`; its callback is explicitly local, and the remote client invokes it once
from the returned serialized outcome.

Native mapping remains adapter-owned. OpenAI Responses sends `reasoning.effort`; Chat Completions is
`not-applied`. Anthropic merges `output_config.effort` with `output_config.format`. Gemini chooses one
of `thinkingLevel` or `thinkingBudget`, preserves non-control `thinkingConfig` members, and rejects a
conflicting static native control rather than silently overwriting it. The same conflict rule applies to
OpenAI static `reasoning.effort`; `auto` never pins a provider default onto the wire. Providers without
an effort table follow the canonical `not-applied` route. The framework's FLOW-008
source/precedence record remains a separate requested-setting record; it is not reused as a provider
application outcome.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `IProviderCapabilityTable`, structured-output transport, generic raw bridges,
      forced summary, preset/frontmatter validators, and remote option transport were read. The new
      semantic contract mirrors their Core owner/package boundary without reusing provider SDK types.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: the provider effort-table accessor, typed request handoff, outcome record,
      and local observer mirror `IProviderCapabilityTable` / `resolveModelCapabilities` in the shared
      Core library/contract layer. Provider adapters own their declarations and serialization; remote
      client/server carry the serializable Core record rather than a provider-product dependency.

## Fallback & Degradation Declaration

1. An unknown model, an undeclared native control, or a non-vendor endpoint omits the native effort
   field and reports `not-applied`. This is sanctioned because guessing a field can cause a provider
   request failure or a false applied claim; it must include the reason in semantic metadata and
   never substitute a made-up default.
2. A documented ordered capability set may select the highest supported tier at or below an explicit
   request and report `clamped`. The resolver must never clamp upward, cross a missing tier without
   declaring it, or use clamping for an unknown model.
3. An explicit effort selection bypasses cache lookup and storage until DATA-007 persists the semantic
   fingerprint. A cache outcome is therefore never reported as native application; this is a temporary
   correctness guard, not a cache-key change.
4. A conflicting provider-specific native effort control fails validation rather than being silently
   overwritten. Non-control native configuration remains intact. An observer exception is contained and
   logged separately so it cannot turn into a false provider failure.

## Solution

1. Extend the Core vocabulary with `none` and `minimal`; define the selection, effort-table,
   resolution, outcome, observer, and provider-accessor contracts in one Core-owned module. The resolver
   accepts only adapter-owned source-dated data, clamps strictly downward, fingerprints all semantic
   fields, and never imports provider SDK types or vendor data.
2. Change Core, framework, and CLI hand-off so `auto` survives as a selection until the provider table
   resolves it. Carry the immutable resolution handoff through `IChatOptions` and `IProviderRequest`.
   Define authority by topology: local adapters publish, cache publishes its own no-dispatch result,
   opaque executors publish the canonical local fallback, and remote executors transport the
   server-adapter's terminal value. Preserve FLOW-008's separate source-precedence record.
3. Route execution-round and forced-summary calls through one helper. For any selection, bypass cache
   lookup/store until DATA-007 owns its persisted fingerprint; for a no-dispatch branch publish
   `not-dispatched` rather than fabricate a native event. Contain observer exceptions as diagnostics.
4. Add a Core executor terminal-result envelope and one generic raw-stream terminal envelope. Update
   `AbstractExecutor`, `LocalExecutor`, executor helpers, and their contract tests so the new return
   shape is coherent on every local execution path. Update preset validation, framework frontmatter,
   remote client `HttpClient` HTTP/SSE serialization, and remote server validation/routes for the new
   vocabulary. Keep the observer local at the remote boundary, transport the server-authoritative
   outcome once, and invoke the caller's local observer once.
5. Create adapter-owned OpenAI, Anthropic, and Gemini tables. Apply their native controls only after a
   verified resolution, preserve non-control subobjects, reject conflicting static controls, and cover
   Responses versus Chat Completions, custom endpoints, executors, and providers without a table.
6. Add table/route/adapter/remote/functional tests and source-run public examples. Add checked provider
   example TypeScript projects, record each regression's RED result before production code changes, then
   update all affected package SPECs and run spec-code conformance after implementation.

## Affected Files

- `packages/agent-core/src/interfaces/provider.ts`
- `packages/agent-core/src/interfaces/model-effort-capability.ts` (new) and `interfaces/index.ts`
- `packages/agent-core/src/interfaces/executor.ts`, `abstracts/abstract-ai-provider.ts`, and
  `abstracts/abstract-ai-provider.ts`, `abstracts/abstract-executor.ts`,
  `abstracts/ai-provider-helpers.ts`, `executors/local-executor.ts`, and their focused contract tests
- `packages/agent-core/src/services/execution-round-provider.ts`, `execution-forced-summary.ts`, cache
  eligibility tests, and focused execution tests
- `packages/agent-framework/src/effort/effort-resolution.ts` and effort/command tests
- `packages/agent-cli/src/startup/effort-resolution.ts` and focused tests
- `packages/agent-framework/src/frontmatter/frontmatter-primitives.ts` and `packages/agent-preset/src/`
  effort validation/tests
- `packages/agent-remote-client/src/client/wire-chat-options.ts`, `chat-http-methods.ts`,
  `chat-stream-http.ts`, `http-client.ts`, and `remote-executor-simple.ts`, plus remote outcome
  protocol/tests
- `apps/agent-server/src/remote-chat-options.ts`, `routes/provider-chat.ts`, and
  `routes/provider-chat-stream.ts`, plus validation/HTTP/SSE contract tests
- `packages/agent-provider-openai/src/openai/reasoning-effort.ts`, a model-effort table module,
  response request builders, tests, and `examples/verify-model-effort.ts`
- `packages/agent-provider-anthropic/src/anthropic/output-schema.ts`, a model-effort table module,
  provider tests, and `examples/verify-model-effort.ts`
- `packages/agent-provider-gemini/src/gemini/` request conversion, a model-effort table module,
  transport tests, and `examples/verify-model-effort.ts`
- `packages/agent-core/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md`,
  `packages/agent-cli/docs/SPEC.md`, `packages/agent-preset/docs/SPEC.md`, remote client/server docs,
  and the three provider `docs/SPEC.md` files

## Completion Criteria

- [ ] TC-01: Table-driven Core tests prove both new tiers, `exact`, documented downward `clamped`,
      `model-default`, unknown `not-applied`, and a fingerprint that distinguishes selection, effective
      tier, resolution, and native-control identity without SDK types.
- [ ] TC-02: Preset, frontmatter, and remote validation tests accept every Core tier and reject an
      unrecognised one; an interactive framework test keeps `auto` distinct from explicit `high` and
      preserves FLOW-008 source-precedence output.
- [ ] TC-03: Framework execution and forced-summary tests prove the provider accessor is used, local
      adapter, cache, and opaque-executor branches each publish their designated exactly-once outcome,
      observer exceptions do not replace provider errors, and the native raw event occurs only when a
      native SDK request is constructed.
- [ ] TC-04: Generic `generateResponse()` and `generateStreamingResponse()` tests cover direct and
      executor branches, preserve selection/resolution, return one terminal envelope after non-streaming
      completion or streamed message chunks, observe it exactly once, and never fabricate a native
      payload for executors. `AbstractExecutor` and `LocalExecutor` contract tests prove the changed
      return shape remains coherent for local non-streaming and streaming execution.
- [ ] TC-05: A two-turn cached Core test proves every selected-effort call bypasses cache lookup/store
      until DATA-007, so low then high produces two provider dispatches; the documented fingerprint is
      retained for DATA-007 without changing cache-key persistence here.
- [ ] TC-06: OpenAI tests prove Responses receives a verified `reasoning.effort`, `auto` omits the field,
      Chat Completions/custom endpoints/unknown models are `not-applied`, and a conflicting static effort
      control is rejected while unrelated static reasoning properties survive.
- [ ] TC-07: Anthropic tests prove `output_config.effort` merges with `output_config.format`; known,
      unknown, and custom-`baseURL` paths expose the correct outcome and never send an unverified field.
- [ ] TC-08: Gemini tests prove a verified model sends exactly one supported control, preserves
      non-control thinking settings, rejects conflicting static controls, and sends no effort control for
      unknown/custom paths.
- [ ] TC-09: Remote client/server HTTP and SSE contract tests serialize selection and one server-adapter
      authoritative terminal outcome; the client transports that value, keeps its observer local, and
      invokes the local observer exactly once without inventing a competing outcome.
- [ ] TC-10: A provider with no effort-table accessor follows the canonical `not-applied` route without
      a provider-specific native field or a missing observable result.
- [ ] TC-11: Each provider public example is typechecked by its dedicated example project and source-run
      with `tsx --conditions=source`; it prints requested/effective/resolution/dispatch/native-control
      for documented `high`, `max`, and `auto` inputs without writing settings or cache files.
- [ ] TC-12: Before production edits, every new regression test records a failing RED result against the
      current behavior; after the fix the same deterministic tests are GREEN and their receipts are kept
      as GATE-VERIFY evidence.
- [ ] TC-13: Core, framework, CLI, preset, remote, and provider SPECs describe the owner, transport,
      native mapping, degradation, and verification contract; spec-code conformance finds no discrepancy.
- [ ] TC-14: Targeted package test/build/typecheck checks, affected harness scan, CI-equivalent
      verification, and required GitHub CI pass on the exact PR head.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                      | Notes                                                                                        |
| ----- | -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| TC-01 | Unit + type          | Core table/resolver Vitest tests and package typecheck                               | Includes `none`, `minimal`, every resolution, and fingerprint fields                         |
| TC-02 | Boundary integration | Preset/frontmatter/remote validator tests plus framework effort tests                | Covers all accepted tiers and preserves `auto` provenance                                    |
| TC-03 | Core integration     | Execution-round and forced-summary tests                                             | Covers topology authority, cache/opaque fallbacks, callback error, and native-event ordering |
| TC-04 | Core integration     | Abstract raw provider plus AbstractExecutor/LocalExecutor contract tests             | Direct/executor matrix with one terminal-result envelope on local and generic routes         |
| TC-05 | Cache integration    | Two-turn cached execution test                                                       | Asserts selected effort bypasses lookup and store until DATA-007                             |
| TC-06 | Adapter unit         | OpenAI Responses/Chat Completions request and static-config tests                    | Includes unknown/custom and conflict paths                                                   |
| TC-07 | Adapter unit         | Anthropic Messages request and `baseURL` tests                                       | Verifies output-config merge and negative paths                                              |
| TC-08 | Adapter unit         | Gemini Generate Content request and static-thinking tests                            | Asserts exclusive controls and preserved non-control fields                                  |
| TC-09 | Remote contract      | Remote client/server HTTP and SSE tests                                              | Server adapter is authoritative; client transports one terminal outcome                      |
| TC-10 | Provider contract    | Base provider/no-table focused tests                                                 | Canonical `not-applied` fallback                                                             |
| TC-11 | Public example       | Example `tsconfig` plus `tsx --conditions=source` commands                           | Requires the provider key/model environment variables from the Task                          |
| TC-12 | Regression           | TDD RED output then deterministic GREEN receipts                                     | RED occurs before the corresponding production edit                                          |
| TC-13 | Conformance          | `spec-code-conformance` procedure plus contract tests                                | The final loop fixes code to match accepted SPECs                                            |
| TC-14 | Regression           | affected builds/tests, `pnpm harness:scan`, `pnpm harness:verify-like-ci`, GitHub CI | No partial command is reported as CI-equivalent                                              |

## User Execution Test Scenarios

Before a live invocation, request any missing credential from the user through an approved secret channel;
never place a credential in source, Task/spec text, command output, or chat evidence. The Gateway scenario
loads only `AI_GATEWAY_API_KEY` from the Git-ignored repository-root `.env.local`; the example, rather than
the user, selects `openai/gpt-5`. A Vercel AI Gateway credential exercises OpenAI-compatible transport, but
it has no verified model-effort table, so its model-effort outcomes are truthfully `not-applied`; this does not
prove native provider effort application. `unverified-endpoint` is the separate structured-output provenance
term, not a model-effort disposition; the Gemini native scenario therefore still requires its native credential.

### Scenario 1: OpenAI model-effort outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: workspace dependencies and the agent-provider-openai package build are current; current directory is `packages/agent-provider-openai`; the Git-ignored repository-root `.env.local` contains `AI_GATEWAY_API_KEY`; the public `examples/verify-model-effort.ts` loads that file and selects `openai/gpt-5`
- command: `pnpm exec tsx examples/verify-model-effort.ts high max auto`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=OPENAI_MODEL_EFFORT_PASS with `not-applied` outcomes for `high`, `max`, and `auto`
- cleanup: the example creates no settings or cache files; no cleanup is required
- evidence: pending implementation: capture this command's stdout and exit code after implementation

### Scenario 2: Anthropic model-effort outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: workspace dependencies and the agent-provider-anthropic package build are current; current directory is `packages/agent-provider-anthropic`; the Git-ignored repository-root `.env.local` contains `ANTHROPIC_API_KEY`; the public `examples/verify-model-effort.ts` loads that file and selects `claude-sonnet-4-6`
- command: `pnpm exec tsx examples/verify-model-effort.ts high max auto`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=ANTHROPIC_MODEL_EFFORT_PASS
- cleanup: the example creates no settings or cache files; no cleanup is required
- evidence: pending implementation: capture this command's stdout and exit code after implementation

### Scenario 3: Gemini model-effort outcomes

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: workspace dependencies and the agent-provider-gemini package build are current; current directory is `packages/agent-provider-gemini`; the Git-ignored repository-root `.env.local` contains `GEMINI_API_KEY`; the public `examples/verify-model-effort.ts` loads that file and selects `gemini-3-flash-preview`
- command: `pnpm exec tsx examples/verify-model-effort.ts high max auto`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=GEMINI_MODEL_EFFORT_PASS
- cleanup: the example creates no settings or cache files; no cleanup is required
- evidence: pending implementation: capture this command's stdout and exit code after implementation

## Tasks

- [ ] `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` — in-progress

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-11

**Status remains:** draft

`node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` reported 20 mechanical PASS,
0 FAIL, and 7 semantic PENDING-GUARDIAN. Independent guardian `Carson` judged the semantic set:

- GATE-WRITE — Concrete symptom: PASS — the draft names incorrect mappings and absent outcome
  visibility, corroborated by the current adapter code.
- GATE-WRITE — Reproduction condition: PASS — effort-enabled sessions and direct provider calls are
  named as triggering paths.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — official provider documentation drives
  the model-aware Core-table decision.
- GATE-WRITE — Decision trade-off: PASS — alternative 3 weighs shared-contract cost against consistent
  cross-provider outcomes.
- GATE-WRITE — New-surface placement: FAIL — the prior `N/A` declaration was invalid because the draft
  adds public `IChatOptions`, `IProviderRequest`, and export surfaces. Required correction: name the
  analogous Core contract layer, classify the surface, and state shared-Core reuse instead of a
  sibling-product dependency. The correction is applied above and requires a fresh guardian verdict.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-09 cover the planned
  features and verification.
- GATE-WRITE — Command/Observable criterion form: PASS — each criterion is testable through an
  observable behavior, command result, or durable artifact.

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status upgrade:** draft → review-ready

Mechanical re-run: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` reported
20 PASS, 0 FAIL, and 7 semantic PENDING-GUARDIAN. Independent guardian `Tesla` re-reviewed the
corrected draft and returned `GATE VERDICT: PASS`:

- GATE-WRITE — Concrete symptom: PASS — the draft names incorrect effort mappings, missing provider
  mappings, and absent truthful outcome visibility.
- GATE-WRITE — Reproduction condition: PASS — effort-enabled sessions and direct provider calls are
  explicit triggering paths.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — official provider evidence leads directly
  to per-model Core capability tables and guarded serialization.
- GATE-WRITE — Decision trade-off: PASS — alternative 3 accepts a coordinated shared-contract change
  to gain consistent cross-provider outcomes.
- GATE-WRITE — New-surface placement: PASS — the draft names `IProviderCapabilityTable` /
  `resolveModelCapabilities` as the Core analogue, classifies the additions as shared Core contract
  infrastructure, and prohibits sibling-provider coupling.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-09 cover resolution,
  request flow, each adapter, examples, documentation, and verification.
- GATE-WRITE — Command/Observable criterion form: PASS — every TC specifies a testable behavior,
  durable artifact, or verification outcome.

### [ARCHITECTURE-AUDIT] — ❌ REVISE | 2026-09-11

**Independent coverage:** `architecture-audit-fanout` run `r20260911120041` covered all 23 assigned
cells (structure 7/7, design 6/6, runtime 5/5, gate 5/5) with no uncovered cell. The four read-only
audits found that the original proposal required revision before approval:

- Structure — Core must own only provider-neutral types and the pure resolver; adapters must expose
  their source-dated tables through an `IAIProvider` accessor. Generic requests need the same typed
  selection/outcome route, and provider examples need dedicated typecheck coverage.
- Design — define one resolution handoff and one publisher to prevent duplicate framework/direct
  callbacks; retain FLOW-008 selection provenance separately; route forced summary through the shared
  assembly helper; and specify Gemini static-thinking conflict/merge semantics.
- Runtime — do not report an applied native outcome on a cache hit; carry generic streaming outcomes;
  distinguish framework/native/executor ownership; and contain observer exceptions.
- Gate — test `none` and `minimal`, all generic direct/executor streaming shapes, cache behavior,
  every provider's negative endpoint/model cases, source-run examples, and RED→GREEN proof.

The corrected Architecture Review, Solution, scope, criteria, and test plan above incorporate these
findings. The audit run is closed `converged` for coverage only; its material findings remain active
until a fresh independent recommendation review endorses the correction.

### [RECOMMENDATION] — ❌ REVISE | 2026-09-11

Independent `proposal-reviewer` verdict: `REVIEW VERDICT: REVISE`.

- Placement: `agent-core` is the correct shared contract owner; provider tables and native serialization
  stay in provider packages behind an instance accessor.
- Required local scope: one generic/direct/framework/remote outcome route; preset, frontmatter, and
  remote consumers for the expanded union; explicit OpenAI static/Chat Completions and Gemini static
  control policy; forced-summary and framework functional coverage.
- Separate root item retained: DATA-007 owns persisted cache-key identity. API-001 now bypasses selected
  effort cache reuse and retains the fingerprint until DATA-007 re-enables safe caching.

The reviewer found no new product direction or foundational initiative. This revision retains
alternative 3 and must receive a fresh `REVIEW VERDICT: ENDORSE` before GATE-APPROVAL.

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status remains:** review-ready (corrected-document re-run)

`node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` reported 20 mechanical PASS,
0 FAIL, and 7 semantic PENDING-GUARDIAN. Independent guardian `Bernoulli` returned
`GATE VERDICT: PASS`:

- GATE-WRITE — Concrete symptom: PASS — current incorrect mappings and missing outcomes are specific.
- GATE-WRITE — Reproduction condition: PASS — effort-enabled and direct calls are named triggers.
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — provider evidence leads to the model-aware
  Core contract.
- GATE-WRITE — Decision trade-off: PASS — coordinated contract cost is weighed against consistent typed
  outcomes.
- GATE-WRITE — New-surface placement: PASS — the Core analogue, shared-contract classification, and
  prohibition on sibling-product coupling are explicit.
- GATE-WRITE — One criterion per distinct feature: PASS — TC-01 through TC-14 cover every planned
  contract, route, adapter, fallback, and verification surface.
- GATE-WRITE — Command/Observable criterion form: PASS — every criterion has a testable behavior,
  command outcome, or durable verification artifact.

### [FINDING-DEPTH] — FOUNDATIONAL | 2026-09-11

**Finding:** `API001-PROBLEM`
**Verdict:** `DEPTH: id=API001-PROBLEM outcome=FOUNDATIONAL`

The shared provider-contract gap is a recurring root problem rather than a one-off adapter defect. The
expanded Core-to-transport plan addresses that root within API-001; DATA-007 remains separately owned
because cache-key persistence is a distinct semantic-identity change.

### [RECOMMENDATION] — ❌ REVISE | 2026-09-11

Independent final-preparation reviewer `Hubble` returned `REVIEW VERDICT: REVISE`. The correction is
local to the existing decision: separate selection/resolution, native-control, and provider-dispatch
states; make the server-side adapter authoritative for a remote executor; transport one terminal
envelope through `IExecutor`, generic raw streaming, remote HTTP, and remote SSE; and cover the remote
end-to-end topology. The decision, affected files, completion criteria, and test plan above now state
those requirements. One final independent proposal review must return `ENDORSE` before GATE-APPROVAL.

### [RECOMMENDATION] — ❌ REVISE | 2026-09-11

Independent reviewer `Pascal` confirmed the remote authority, terminal protocol, and three-state model,
but found one material local contract omission: changing `IExecutor` also changes `AbstractExecutor`,
`LocalExecutor`, remote `HttpClient`, and their return-shape tests. The Solution, Affected Files, TC-04,
and its test-plan row now explicitly cover those implementation and verification surfaces. No code was
changed by the reviewer.

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-11

Independent guardian `Archimedes` returned `GATE VERDICT: FAIL` for all pending semantic conditions:

- Directness: the verbatim instruction `예외허용` authorizes the narrow independent-review exception,
  not the API-001 design or implementation decision.
- Scope: that exception does not authorize this L2 shared-contract change.
- Independent architecture validation: the placement-covering proposal review remains `REVISE`, not
  `ENDORSE`.

The recorded DIRECT route remains an auditable instruction record, but it does not advance this spec.
Implementation is blocked until the user provides direct API-001 approval and the required independent
endorsement condition is satisfied or explicitly waived.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

Independent guardian `Bohr` returned `GATE VERDICT: PASS` after the user's verbatim instruction:

> API-001의 현재 사양과 구현을 직접 승인하며, 최종 proposal-reviewer ENDORSE 조건도 면제합니다.

- Directness: PASS — the instruction explicitly approves the current API-001 spec and implementation.
- Scope: PASS — the approval covers the L2 shared-contract change.
- Independent architecture validation: PASS — the completed architecture fanout plus the explicit final
  `ENDORSE` waiver satisfies this condition.

### [GATE-WRITE] — ❌ FAIL | 2026-09-11

**Status remains:** review-ready
**Failed criteria:**

- GATE-WRITE — `status: draft` present in frontmatter: `status: review-ready`, required `status: draft`
  **Required action:** set `status: draft`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `c10595f474f8` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "예외허용"
**Given:** 2026-09-11, this conversation
**Review fingerprint:** cb782891e710 (review f818493a, type/tags 13f8e61f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (cb782891e710) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `8519fd7676c8` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-11, this conversation
**Review fingerprint:** cb782891e710 (review f818493a, type/tags 13f8e61f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (cb782891e710) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `7ec2cf2ee6f0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "API-001의 현재 사양과 구현을 직접 승인하며, 최종 proposal-reviewer ENDORSE 조건도 면제합니다."
**Given:** 2026-09-11, this conversation
**Review fingerprint:** cb782891e710 (review f818493a, type/tags 13f8e61f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (cb782891e710) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `ef497df5267e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "API-001의 현재 사양과 구현을 직접 승인하며, 최종 proposal-reviewer ENDORSE 조건도 면제합니다."
**Given:** 2026-09-11, this conversation
**Review fingerprint:** 19662650b9f0 (review f2f00ca2, type/tags 13f8e61f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (19662650b9f0) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/todo/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `101693cf238d` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-11

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-11; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (14)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 319 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 3`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md",
  "specPath": ".agents/spec-docs/todo/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 3
  },
  "worktreePaths": [
    ".agents/loop-runs/architecture-audit-fanout.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md",
    ".agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/todo/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md` blob `1bda9c10f611` (untracked)
