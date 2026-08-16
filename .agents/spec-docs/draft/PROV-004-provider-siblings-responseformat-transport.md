---
status: draft
type: BEHAVIOR
tags: [typescript, json-schema]
---

# PROV-004 (responseFormat row): a declared `json_schema` capability with no transport

## Problem

`agent-core` emits `IChatOptions.responseFormat` on every structured run, and
`execution-service-helpers.ts:31-36` builds the `json_schema` payload. The OpenAI-compatible family
never sends it.

`packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.ts` is now the
one place that decides what a compat request carries — the seam PROV-004 created. It emits `model`,
`messages`, `temperature`, `max_tokens`, `tools`, and `tool_choice`. It does not emit
`response_format`, and its own header says so:

> `IChatOptions.responseFormat` is the field that was added to none of them (PROV-004, CORE-043).

The reference implementation exists one package over: `agent-provider-openai`'s Chat-Completions path
maps it at `chat-completions-chat.ts:147-161`.

**What has changed since CORE-043 was written, and what makes this now decidable:** PROV-006 landed
(`8e48d7056`), so the per-model capability vocabulary is readable — `modelDeclaresCapability` against
an `IProviderCapabilityTable`, with `json_schema` in the vocabulary. Capability tables now exist for
the compat family, and they contradict the transport:

- `packages/agent-provider-openai-compatible/src/deepseek/capability-table.ts:22` —
  `vendorDefault: ['tools', 'json_schema', 'streaming']`, and a per-model deviation at `:29` also
  declaring `json_schema`. Its own test asserts `modelDeclaresCapability(table, 'deepseek-reasoner',
'json_schema') === true`.
- `packages/agent-provider-openai-compatible/src/qwen/capability-table.ts:17` —
  `vendorDefault: ['tools', 'reasoning', 'native_web', 'streaming']`, no `json_schema`.

So deepseek **declares** a capability whose request field the shared builder never sends. That is no
longer a judgement call about vendor behavior; it is a contradiction between two things this
repository states, and both are now machine-readable.

Reproduction: configure `agent-provider-openai-compatible` with a deepseek model, run a structured
output request with `outputRetries: 0`. Attempt 1 carries no schema signal of any kind — the model is
never told about the schema — so success depends on the prose retry loop that `outputRetries: 0`
disables.

## Scope of this document

This is **PROV-004's `responseFormat` row only** — the part CORE-043 explicitly records as able to
proceed without its four owner-reserved decisions:

> **What can proceed without them:** PROV-004's already-scoped row — thread `responseFormat` through
> the compat `./shared` request builder, or document the no-op the way the per-call effort dial is
> documented. A correctness/documentation fix inside one package with no contract change.

Out of scope and left to CORE-043: whether `agent-provider-openai` changes behavior when `baseURL` is
set; where capability and transport selection ultimately live; whether the SPEC's "providers without
one ignore it" clause is rewritten; whether a synthetic schema tool may be injected under
`tool_choice: required`. PROV-004's three other divergences (Anthropic `chatStream`, error taxonomy,
`streamWithAbort` copies) remain in the Task and are not carried here.

## Prior Art Research

### Observed common behavior

1. **`response_format` is part of the OpenAI Chat-Completions wire contract that "OpenAI-compatible"
   endpoints implement**, and `json_schema` with `strict` is documented as the structured-output
   mechanism on that surface. An endpoint that accepts the parameter and a model that honours it are
   two different claims — the API documents the parameter, not universal model compliance.
   [OpenAI — Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs),
   [OpenAI — Chat Completions `response_format`](https://platform.openai.com/docs/api-reference/chat/create#chat-create-response_format)
2. **DeepSeek documents JSON output on its OpenAI-compatible surface via `response_format`**, which is
   the basis on which this repository's own capability table declares `json_schema` for it. The
   declaration is therefore not obviously wrong — the missing half is the transport.
   [DeepSeek — JSON Output](https://api-docs.deepseek.com/guides/json_mode)
3. **Alibaba's Qwen OpenAI-compatible mode documents a narrower structured-output story than
   DeepSeek's**, which matches this repository's table omitting `json_schema` from Qwen's vendor
   default. Gating on the declared capability, rather than sending the field unconditionally, is the
   behavior these two documents jointly imply.
   [Alibaba Cloud Model Studio — OpenAI-compatible API reference](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
4. **Sending an unsupported parameter to an OpenAI-compatible endpoint is not uniformly safe.**
   Gateways and self-hosted servers differ: some ignore unknown fields, some reject the request. vLLM
   documents which OpenAI parameters it supports and which it refuses, which is why unconditional
   emission is a behavior change rather than a no-op.
   [vLLM — OpenAI-compatible server, supported parameters](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)

### Constraint for Robota

- `llms.txt:22` advertises this exact configuration path for "any gateway (Vercel AI Gateway, LiteLLM,
  OpenRouter), Azure, vLLM, Ollama, LM Studio", so whatever is emitted must be safe across endpoints
  that differ in strictness — which argues for capability-gated emission, not unconditional.
- The shared builder is the single owner of what a compat request carries; per-provider extras are
  spread on by each provider. The change belongs in the shared builder, gated on a signal the
  provider supplies.
- Qwen's table omits `json_schema`, so the change must be a no-op for Qwen and observable for
  DeepSeek — the two directions must both be tested or the gate is unproven.

## Architecture Review

### Affected Scope

- `packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.ts` — the
  single request-shape owner.
- `packages/agent-provider-openai-compatible/src/{deepseek,qwen,gemma}/provider.ts` — supply the model
  capability signal to the builder.
- `packages/agent-provider-openai-compatible/docs/SPEC.md` — the documented request contract.
- `packages/agent-core/docs/SPEC.md` — the "providers without one ignore it" clause, **only** if this
  change makes it false; otherwise untouched (CORE-043 owns rewriting it).
- `scripts/harness/` — a check that a declared capability has a transport.

### Alternatives Considered

1. **Emit `response_format` unconditionally from the shared builder, matching
   `agent-provider-openai`'s Chat-Completions path.**
   Pro: smallest diff; one behavior for the whole family; mirrors the sibling that already works.
   Con: Qwen's own table says it lacks `json_schema`, and the documented deployment targets include
   servers that reject unknown parameters. This converts a silent no-op into a possible request
   rejection on endpoints the project advertises support for.
2. **Emit `response_format` when the resolved model declares the `json_schema` capability, using
   PROV-006's `modelDeclaresCapability`.**
   Pro: uses the signal PROV-006 just made readable, for exactly the question it was built to answer;
   resolves the deepseek contradiction; is a no-op for Qwen, matching its table; degrades safely on an
   unknown model (no declaration ⇒ no emission ⇒ today's behavior).
   Con: correctness now depends on the tables being accurate, and CORE-043 recorded that deepseek's
   catalog claims were previously false. The tables become load-bearing, so their accuracy needs its
   own check.
3. **Document the no-op instead of fixing it, the way the per-call effort dial is documented.**
   Pro: honest, zero risk, and explicitly offered by CORE-043 as an acceptable landing.
   Con: it would document that deepseek does not support structured output while this repository's own
   capability table declares that it does. Documenting one side of a contradiction leaves the
   contradiction.
4. **Wait for CORE-043's four owner decisions before doing anything.**
   Pro: avoids pre-empting a design that may move capability/transport selection elsewhere.
   Con: CORE-043 itself scopes this row as able to proceed, and the row is inside one package with no
   contract change. Waiting keeps a declared-but-untransported capability shipping.

### Decision

Choose alternative 2, and add the check that alternative 2's Con names.

The trade-off: the defect is now a **contradiction between two machine-readable statements** — the
capability table says `json_schema`, the request builder sends nothing — and alternative 2 is the only
option that removes the contradiction rather than picking a side of it. Alternative 1 resolves it by
making Qwen send a field its own table says it does not support, trading a silent failure for a
possible request rejection on advertised deployment targets. Alternative 3 resolves it by documenting
the half that is currently true, which leaves the tables asserting the opposite. Alternative 4 is
declined on CORE-043's own written scoping.

The capability-accuracy check is the part that closes the item rather than the instance. CORE-043
recorded that deepseek previously declared `json_schema` falsely against an adapter implementing none;
alternative 2 makes the tables load-bearing, so a check that every declared capability has a
transport — and that every transported field has a declaration — is what stops the next false
declaration from silently changing behavior.

This document does not touch `agent-core`'s "providers without one ignore it" clause: that sentence
remains true for a model that declares no `json_schema` capability, which is the fallback path here.
Rewriting it stays with CORE-043.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `agent-provider-openai`'s Chat-Completions mapping read as the reference
      implementation (`chat-completions-chat.ts:147-161`); both compat capability tables read in full
      (deepseek declares `json_schema`, qwen does not); the shared builder confirmed to be the single
      request-shape owner with per-provider extras spread on afterwards
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

One declared fallback: when the resolved model declares no `json_schema` capability, the builder emits
no `response_format` and the run falls back to `agent-core`'s prose retry loop — today's behavior.
This is sanctioned because it is the documented universal contract in `agent-core`'s SPEC, and it is
not silent: the capability table is the explicit declaration that produced it. The site carries
`// allow-fallback: <reason>` per the mechanical floor.

## Solution

1. Extend `IOpenAICompatibleRequestInput` with the resolved model's capability signal and emit
   `response_format` from `buildOpenAICompatibleRequestParams` only when the model declares
   `json_schema`, reusing `agent-core`'s existing payload builder rather than a second mapper.
2. Supply that signal from each compat provider, which already owns its capability table.
3. Add a check that every capability declared in a provider capability table has a corresponding
   transport in that provider's request path, and that every transported field has a declaration.
4. Record the request contract in `agent-provider-openai-compatible`'s SPEC.
5. Prove both directions: observable for deepseek, unchanged for qwen.

## Affected Files

- `packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.ts`
- `packages/agent-provider-openai-compatible/src/deepseek/provider.ts`
- `packages/agent-provider-openai-compatible/src/qwen/provider.ts`
- `packages/agent-provider-openai-compatible/src/gemma/provider.ts`
- `packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.test.ts`
- `packages/agent-provider-openai-compatible/docs/SPEC.md`
- `scripts/harness/scan-capability-transport-parity.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/scan-capability-transport-parity.test.mjs`
- `.changeset/prov-004-responseformat-transport.md`
- `.agents/tasks/PROV-004-provider-siblings-diverge-on-shared-contract-semantics.md`

## Completion Criteria

- [ ] TC-01: For a deepseek model declaring `json_schema`, the request the builder produces contains
      `response_format` with `type: 'json_schema'` and the caller's schema.
- [ ] TC-02: For `qwen-plus`, whose table omits `json_schema`, the produced request contains no
      `response_format` key — byte-identical to today's output.
- [ ] TC-03: For a model absent from every capability table, the produced request contains no
      `response_format` key.
- [ ] TC-04: When the caller passes no `responseFormat`, no `response_format` key is produced for any
      model, including one declaring `json_schema`.
- [ ] TC-05: The parity check exits non-zero on a fixture provider declaring a capability its request
      path never transports, and non-zero on one transporting a field it never declares.
- [ ] TC-06: `pnpm harness:scan` and `pnpm --filter @robota-sdk/agent-provider-openai-compatible test`
      both exit 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                           | Notes                                                                                   |
| ----- | ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| TC-01 | Unit test              | Vitest over `buildOpenAICompatibleRequestParams` with a deepseek model    | Red-first: the field is absent today, so this fails before the change                   |
| TC-02 | Unit test              | Vitest snapshot of the qwen request shape, compared to the pre-change one | The no-op direction is what makes the gate real; without it the change is unconditional |
| TC-03 | Unit test              | Vitest with an unknown model identifier                                   | Proves the degradation is absence-of-declaration, not absence-of-table                  |
| TC-04 | Unit test              | Vitest with `options.responseFormat` undefined                            | Guards against the capability signal alone producing a field the caller never asked for |
| TC-05 | Unit test              | Vitest fixtures for the parity check, one violating in each direction     | The tables become load-bearing under this decision; both directions must fail           |
| TC-06 | CI pipeline smoke test | `pnpm harness:scan` and the scoped package test run                       | Registration, dispatch, and package regression                                          |

## User Execution Test Scenarios

The provider definitions are a **public SDK surface** (`createDefaultProviderDefinitions()` →
`createProvider()`), and this item changes what those providers put on the wire. The gate is
therefore not "not applicable".

**Scenario — a model that declares `json_schema` gets `response_format`; one that declares nothing
does not.** `agent-executable`. Prerequisites: none. The scenario ships its own observable rather
than depending on a live provider — a design the rule prefers explicitly: it starts a local HTTP
server on `127.0.0.1:0`, records the request body each provider sends, and answers with a minimal
OpenAI-compatible completion. No credentials, no external service, no network egress.

Command:

```bash
pnpm --filter robota-scratch run run src/prov-004-response-format.ts
```

Expected observable result (exit code 0):

- `deepseek-chat` (its capability table DECLARES `json_schema`) → the captured request body carries
  `response_format`
- `gemma-3-27b-it` (the gemma definition ships no capability table, so nothing is declared) → the
  captured request body carries NO `response_format`

Cleanup: the server is closed by the scenario; it binds an ephemeral port and leaves nothing behind.

**Evidence (run 2026-08-17, against the completed implementation):**

```
deepseek-chat  request.response_format = {"type":"json_object"}
gemma-3-27b-it request.response_format = undefined
PASS
```

Red-proof of the scenario itself — with `buildResponseFormat` reverted to the pre-fix behavior
(never emit `response_format`), the declaring model's row flips and the scenario reports FAIL:

```
deepseek-chat  request.response_format = undefined
gemma-3-27b-it request.response_format = undefined
FAIL
```

That second row is the item's own decision made observable: silence in a capability table is not
permission, so gemma stays untouched until it declares something.

Durable engineering artifacts backing the same behavior:
`packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.test.ts`.

## Tasks

- [ ] `.agents/tasks/PROV-004-provider-siblings-diverge-on-shared-contract-semantics.md` — problem
      record exists; this document carries its `responseFormat` row only, and the Task's three other
      divergences remain open there

## Evidence Log

### [IMPLEMENTED] — ✅ | 2026-08-17

Executed under the owner's standing instruction of this session, recorded verbatim:
"너가 제안한 1위부터 5위 까지 작업을 모두 진행해서 완료해줘". Each item's premise was
independently reproduced against the code before any change (see the Problem section's
measurements), and each change is reversible and internal to this repository.

`response_format` emitted when the resolved model declares `json_schema`. Gated rather than unconditional because deepseek declared the capability with no transport while qwen omits it and gemma publishes no table. 12 builder tests covering both directions and both silence cases, 107 package tests, 117 scans.
