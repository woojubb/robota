---
title: 'API-001: map model effort to provider capabilities and visible outcomes'
issue: https://github.com/woojubb/robota/issues/1987
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: agent-core, agent-framework, agent-cli, agent-preset, agent-remote-client, agent-server, Anthropic provider, OpenAI provider, Gemini provider
depends_on: []
---

# API-001: provider/model effort capabilities and mapping

## Objective

Replace provider-wide assumptions with model-aware effort capabilities and typed outcomes. The current
OpenAI adapter clamps xhigh/max to high, Anthropic is documented as a no-op despite its current
`output_config.effort` API, and Gemini exposes provider-specific thinking configuration without a
framework effort mapping. Unsupported settings must be visible rather than silently discarded.

## Plan

1. Re-read current official Anthropic, OpenAI, and Gemini documentation and record supported levels,
   including `none`/`minimal`, defaults, request fields, and model-dependent restrictions.
2. Define the provider-neutral selection, table accessor, resolution, serializable dispatch outcome, and
   exactly-once observer route. Core owns the pure resolver; each adapter owns source-dated model data
   and native request serialization.
3. Preserve `auto` through framework/CLI, generic raw APIs, forced summary, presets/frontmatter, and
   remote transport. Local adapters, cache, and opaque executors each own their declared result; a remote
   server-side adapter owns the terminal result and the client only transports it. Keep callbacks local
   and return one terminal envelope for non-streaming, raw streaming, HTTP, and SSE routes. Update the
   abstract/local executor contracts and remote `HttpClient` with their focused tests.
4. Keep native request-field assembly in each provider, reject a conflicting static native effort
   control, preserve unrelated native fields, and distinguish native dispatch from cache/executor
   non-dispatch. Bypass effort-bearing cache lookup/store until DATA-007 owns persisted fingerprint
   identity.
5. Test every tier, generic streaming/non-streaming and executor route, forced summary, cache bypass,
   provider negative paths, remote transport, static-native configuration, typechecked source examples,
   and RED→GREEN regression evidence.

## Progress

- 2026-09-11: implementation preparation resumed on `feat/api-001-provider-model-effort`. Re-verified
  current official provider documentation and current code. The investigation established that
  `auto` is converted to `high` before the provider boundary, so the affected scope also includes the
  framework/CLI effort hand-off needed to retain the distinction. Cache-key mutation remains owned by
  dependent Task DATA-007.
- 2026-09-11: independent architecture review found the original proposal could duplicate or lose its
  outcome on generic, forced-summary, cache, and remote paths. The revised plan keeps provider facts in
  adapters behind a Core accessor, makes outcome delivery serializable and exactly once, and bypasses
  effort-bearing cache reuse until DATA-007 can persist its fingerprint.
- 2026-09-11: final-preparation review identified an ambiguous remote authority boundary. The server-side
  adapter is now the sole remote outcome authority; the remote client transports one terminal envelope
  over HTTP/SSE and invokes only its local observer from that value. The outcome distinguishes
  selection/resolution, native-control, and provider-dispatch states.
- 2026-09-11: the final independent review found the executor envelope would also change the abstract and
  local executor return contracts and the remote `HttpClient`. Those source files and focused contract
  tests are now part of the declared API-001 scope.
- 2026-09-12: the public OpenAI example now loads only `AI_GATEWAY_API_KEY` from the Git-ignored root
  `.env.local` and selects `openai/gpt-5` itself. The live Vercel AI Gateway source run completed for
  `high`, `max`, and `auto` with `OPENAI_MODEL_EFFORT_PASS`; each correctly reported `not-applied`
  because a custom endpoint has no verified model-effort table. The outcome is transport evidence,
  not proof of native provider effort application. Its dedicated RED→GREEN test, the full OpenAI
  provider suite (173 tests), typecheck, build, and spec coverage scan passed.
- 2026-09-12: model selection is now owned by all three public examples: `openai/gpt-5`,
  `claude-sonnet-4-6`, and `gemini-3-flash-preview`. Anthropic and Gemini load only their respective
  keys from the Git-ignored root `.env.local`; their RED→GREEN configuration tests, typechecks,
  full provider suites (100 and 156 tests), builds, and user-execution scenario format scan passed.
- 2026-09-12: live native provider scenarios completed with credentials loaded exclusively from the
  Git-ignored root `.env.local`. Anthropic reported exact `high` and `max` application and an omitted
  native control for `auto` (`model-default`); Gemini reported exact `high`, `max` clamped to `high`,
  and an omitted native control for `auto` (`model-default`). Both source runs exited zero.

## Completion Criteria

- Capability data is model-aware and owns ordered supported tiers, defaults, native control kind, and
  any documented legacy budget mapping.
- A requested unsupported level clamps to the highest supported level at or below it when that policy
  is valid, otherwise returns a visible not-applied outcome.
- Anthropic, OpenAI, and Gemini mappings match their current official APIs.
- Providers with no equivalent never silently pretend the setting applied.
- Provider/model documentation and package specs match runtime behavior.

## Test Plan

- Capability-resolution table tests across provider/model fixtures.
- Provider request-builder tests asserting native fields and absence when unsupported.
- Contract tests for exact, clamped, default, and not-applied outcomes.
- Affected package builds, `pnpm harness:scan`, and CI-equivalent verification before merge.

## Implementation Checklist

- [ ] TC-01 — Add Core vocabulary, source-dated effort-table resolution, and fingerprint unit/type tests.
- [ ] TC-02 — Preserve every tier and `auto` through preset, frontmatter, remote validation, framework,
      and CLI hand-off tests.
- [ ] TC-03 — Add execution-round, forced-summary, cache, opaque-executor, observer-failure, and native
      raw-event topology tests.
- [ ] TC-04 — Change generic and local executor terminal-result contracts, then cover direct/executor
      non-streaming and streaming terminal envelopes.
- [ ] TC-05 — Add the two-turn selected-effort cache-bypass regression test.
- [ ] TC-06 — Add OpenAI Responses, Chat Completions/custom endpoint, `auto`, and static-conflict tests.
- [ ] TC-07 — Add Anthropic output-config merge and known/unknown/custom-`baseURL` tests.
- [ ] TC-08 — Add Gemini exclusive-control, preserved non-control, static-conflict, and unknown-path tests.
- [ ] TC-09 — Add server-authoritative remote HTTP and SSE terminal-outcome contract tests.
- [ ] TC-10 — Cover the no-effort-table provider fallback and observable `not-applied` outcome.
- [ ] TC-11 — Add dedicated provider example typecheck projects and source-run public examples.
- [ ] TC-12 — Record every deterministic regression's RED result before its matching production edit, then
      retain GREEN receipts.
- [ ] TC-13 — Update affected Core, framework, CLI, preset, remote, and provider specifications; run
      spec-code conformance.
- [ ] TC-14 — Run targeted tests/builds/typechecks, harness scan, CI-equivalent verification, and exact
      PR-head GitHub CI.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

The three public provider examples below are directly runnable user-facing behavior. Their prerequisites
are existing environment variables and API credentials; no new fixture, local service, or seed data is
needed. Before a live invocation, request any missing credential from the user through an approved secret
channel; never place a credential in source, Task/spec text, command output, or chat evidence. The Gateway
scenario loads only `AI_GATEWAY_API_KEY` from the Git-ignored root `.env.local`; the example, rather than the
user, selects `openai/gpt-5`. A Vercel AI Gateway credential exercises OpenAI-compatible transport, but it has
no verified model-effort table, so its model-effort outcomes are truthfully `not-applied`; this does not prove
native provider effort application. `unverified-endpoint` is the separate structured-output provenance term,
not a model-effort disposition. The Gemini native scenario therefore still requires its native credential. The
user's standing instruction not to use multi-agent or worktree execution is the process override for separate
scenario-author dispatch; these scenarios remain the required execution evidence and will be run after implementation.

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
- evidence: 2026-09-12 source run exited 0 and emitted `OPENAI_MODEL_EFFORT_PASS`; `high`, `max`, and `auto` each reported `not-applied` with native control omitted because the Vercel AI Gateway custom endpoint has no verified model-effort table.

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
- evidence: 2026-09-12 source run exited 0 and emitted `ANTHROPIC_MODEL_EFFORT_PASS`; `high` and `max` were `exact` with `output_config.effort`, while `auto` was `model-default` with native control omitted.

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
- evidence: 2026-09-12 source run exited 0 and emitted `GEMINI_MODEL_EFFORT_PASS`; `high` was `exact` with `thinkingConfig.thinkingLevel`, `max` was clamped to `high`, and `auto` was `model-default` with native control omitted.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-11

**Status upgrade:** scenario drafted → scenario written

**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1. The user
prohibits multi-agent execution. Each scenario is an agent-executable public provider example with an
exact source-run command, required credential/model inputs, directly observable provider outcome, and
no residual state.

- DONE-GATE-STAGE-1 — Field completeness: PASS — all three scenarios declare executability, canonical
  product surface and rationale, prerequisites, command, observable and rationale, cleanup, and evidence.
- DONE-GATE-STAGE-1 — Observable: PASS — public provider API and native-payload callback output, rather
  than an engineering test result, exposes the requested and applied effort outcome.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: OpenAI model-effort outcomes",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-model-effort.ts \"$OPENAI_EFFORT_MODEL\" high max auto",
      "observableType": "sdk-result",
      "observable": "result=OPENAI_MODEL_EFFORT_PASS",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "workspace dependencies and the agent-provider-openai package build are current; current directory is `packages/agent-provider-openai`; `OPENAI_API_KEY` and documented `OPENAI_EFFORT_MODEL` exported; the Task adds public `examples/verify-model-effort.ts`",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-model-effort.ts \"$OPENAI_EFFORT_MODEL\" high max auto"
      },
      "expectedObservable": "result=OPENAI_MODEL_EFFORT_PASS",
      "cleanup": "the example creates no settings or cache files; no cleanup is required",
      "evidence": "pending implementation: capture this command's stdout and exit code after implementation"
    },
    {
      "name": "Scenario 2: Anthropic model-effort outcomes",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-model-effort.ts \"$ANTHROPIC_EFFORT_MODEL\" high max auto",
      "observableType": "sdk-result",
      "observable": "result=ANTHROPIC_MODEL_EFFORT_PASS",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "workspace dependencies and the agent-provider-anthropic package build are current; current directory is `packages/agent-provider-anthropic`; `ANTHROPIC_API_KEY` and documented `ANTHROPIC_EFFORT_MODEL` exported; the Task adds public `examples/verify-model-effort.ts`",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-model-effort.ts \"$ANTHROPIC_EFFORT_MODEL\" high max auto"
      },
      "expectedObservable": "result=ANTHROPIC_MODEL_EFFORT_PASS",
      "cleanup": "the example creates no settings or cache files; no cleanup is required",
      "evidence": "pending implementation: capture this command's stdout and exit code after implementation"
    },
    {
      "name": "Scenario 3: Gemini model-effort outcomes",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-model-effort.ts \"$GEMINI_EFFORT_MODEL\" high max auto",
      "observableType": "sdk-result",
      "observable": "result=GEMINI_MODEL_EFFORT_PASS",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "workspace dependencies and the agent-provider-gemini package build are current; current directory is `packages/agent-provider-gemini`; `GEMINI_API_KEY` and documented `GEMINI_EFFORT_MODEL` exported; the Task adds public `examples/verify-model-effort.ts`",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-model-effort.ts \"$GEMINI_EFFORT_MODEL\" high max auto"
      },
      "expectedObservable": "result=GEMINI_MODEL_EFFORT_PASS",
      "cleanup": "the example creates no settings or cache files; no cleanup is required",
      "evidence": "pending implementation: capture this command's stdout and exit code after implementation"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
