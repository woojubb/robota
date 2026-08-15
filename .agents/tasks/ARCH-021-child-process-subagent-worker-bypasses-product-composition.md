---
title: "ARCH-021: the child-process subagent worker (robota's default runner) hard-codes the default provider set and rebuilds default tools — a product's custom providers and pack-owned tools cannot reach its subagents"
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-subagent-runner, packages/agent-cli, packages/pack-coding, packages/agent-product
depends_on: [ARCH-025]
---

# ARCH-021: subagent worker ignores the product's composition

## Problem

The child-process subagent worker — robota's DEFAULT subagent runner — reconstructs providers from a
hard-coded default vendor registry and rebuilds the framework default tool set, and its options offer
no seam to inject the product's provider surface or composed tools. So a product that declares custom
`IProductProfile.providerDefinitions` or contributes tools through a pack gets child-process
subagents that cannot use them, while the in-process runner passes the parent's composed surface. It
directly contradicts ARCH-006 ("every tool robota runs comes from a pack").

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-subagent-runner/src/child-process-subagent-worker.ts:87-91` —
  `createProviderFromProfile(payload.providerProfile, model, createDefaultProviderDefinitions())` — a
  fixed six-vendor registry; a custom provider type throws "Unknown provider" in agent-core's
  `createProviderFromConfig`.
- `child-process-subagent-worker.ts:103` — `parentTools: createDefaultTools({ cwd })`, no sandbox/
  retrieval adapters, no pack tools.
- `IChildProcessSubagentRunnerOptions` (`child-process-subagent-runner.ts:43-52`) has no
  `providerDefinitions` or `tools` field; `providerConfig` (`:144`) only shapes the serialized
  profile, never the worker's registry; the runner receives `deps.tools` and never uses them.
- Contrast: the in-process runner passes the composed surface —
  `agent-framework/src/subagents/in-process-subagent-runner.ts:139` `parentTools: deps.tools`.
- robota wires the child-process runner as the default unconditionally (`agent-cli/src/cli.ts:277-282`);
  the shell's `providerDefinitions` seam (`command-setup.ts:99`) and pack-owned tool surface
  (`robota-profile.ts:55-60`, `robota-plumbing.ts:210`, `defaultTools: []`) are both bypassed in the
  child.
- Nuances (do not defeat the finding): `workerPath` (`SPEC.md:116`) lets a product author a wholly
  custom worker — escape requires reimplementing the worker, not an injection seam. For robota today
  the tool-surface divergence is LATENT because `pack-coding` is name-equality-tested against
  `createDefaultTools()` (`coding-pack.ts:55-60`) — it becomes user-visible the moment a pack
  contributes a tool outside that mirror or a product supplies custom packs/providers.

## Direction

Treat the process boundary as a serialization boundary. Keep the exact composed provider definitions,
tool instances, credentials, and live owner-bound services in the parent, and expose them to the neutral
worker through a versioned correlated capability broker. The worker uses provider/tool proxies and must
fail startup when the broker handshake is unavailable; it never imports or reconstructs Robota defaults.

The protocol must preserve provider streaming, cancellation, typed errors, permissions, and settle-once
lifecycle behavior. Provider profile selection occurs through an injected parent resolver, falling back
to the invoking runtime provider only when the request omits a profile. Tool calls serialize every
classifiable `IToolExecutionContext` field, derive `signal`, and reconstruct live event/ask services in
the parent. Extensions use a bounded recursive tagged codec for `undefined`, finite/special numbers,
`Date`, `Error`, arrays, and plain records; cycles, invalid dates, unsupported prototypes, malformed tags,
and depth/byte overflow fail explicitly. Exhaustive fixtures cover every top-level context key and wire
variant.

## Test Plan

- Red-first: a custom provider and uniquely named pack tool execute through the parent broker without
  credentials or live instances entering the start payload.
- Forked-worker tests cover requested/default/unknown profiles, streaming, cancellation, typed errors,
  ownership-field and tagged-extension round trips, malformed/cyclic/over-limit rejection, missing
  capabilities, broker handshake failure, and settle-once disconnect/error/exit cleanup.
- Regression: existing in-process subagent tool-surface parity still holds.
- `pnpm harness:verify -- --scope packages/agent-subagent-runner` green.

## User Execution Test Scenarios

**Applies** (subagents are a CLI product surface; custom packs are public SDK usage).

- Prerequisites: built CLI; a scratch product/pack that contributes a uniquely-named tool and a custom
  provider definition — authored by this work; a prompt that spawns a subagent which uses that tool.
- Steps: run the CLI (default child-process subagent runner), ask it to delegate to a subagent that
  calls the custom pack tool.
- Expected (after fix): the subagent runs on the custom provider and successfully calls the pack tool.
- Expected (before fix, contrast): the subagent cannot see the custom tool (and errors on a custom
  provider).
- Cleanup: remove the scratch pack/provider.
- Evidence (fill in after implementation): subagent transcript showing the custom tool call.
