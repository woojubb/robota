---
title: 'API-001: map model effort to provider capabilities and visible outcomes'
issue: https://github.com/woojubb/robota/issues/1987
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: agent-core, Anthropic provider, OpenAI provider, Gemini provider
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
2. Define provider-neutral capability metadata and resolution outcomes for exact, clamped,
   model-default, and unsupported/no-op requests; preserve that equal names are not quantitatively
   comparable across models.
3. Keep native request-field assembly inside each provider adapter and have that adapter expose a
   normalized semantic fingerprint for cache identity without leaking its SDK payload into core.
4. Test requests and raw-payload evidence for supported and unsupported model/provider combinations.

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

## User Execution Test Scenarios

Prerequisites: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`; one supported model ID per
provider exported as `ANTHROPIC_EFFORT_MODEL`, `OPENAI_EFFORT_MODEL`, and `GEMINI_EFFORT_MODEL`. This
child adds `examples/verify-model-effort.ts` to each of the three provider packages. Each example uses
only that package's public provider API and the public native-payload callback; it must not import an
internal test fixture or a FLOW-008 CLI surface.

1. Run
   `pnpm --filter @robota-sdk/agent-provider-openai exec tsx examples/verify-model-effort.ts "$OPENAI_EFFORT_MODEL" high max auto`.
2. Run
   `pnpm --filter @robota-sdk/agent-provider-anthropic exec tsx examples/verify-model-effort.ts "$ANTHROPIC_EFFORT_MODEL" high max auto`.
3. Run
   `pnpm --filter @robota-sdk/agent-provider-gemini exec tsx examples/verify-model-effort.ts "$GEMINI_EFFORT_MODEL" high max auto`.

Expected: each example prints requested/effective/disposition plus the provider-native effort field;
supported requests are `exact`, allowed downward clamps show both values, `auto` shows the model
default, and unsupported controls are `not-applied`. Each command exits 0 and writes no settings or
cache files, so cleanup is not required. Evidence: pending implementation with each command's exact
output and exit code.
