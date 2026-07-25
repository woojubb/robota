---
title: 'CLI-078: `robota eval` composes its own provider outside the product profile'
status: todo
created: 2026-07-25
priority: low
urgency: later
area: packages/agent-cli
depends_on: [ARCH-005]
---

# CLI-078: the eval surface bypasses the product profile

## Problem

After the ARCH-005 S2 collapse, `robota`'s main surfaces assemble through `assembleProduct`, but
`packages/agent-cli/src/eval/eval-command.ts:89` still composes its own provider outside the profile
(found by the S2 conformance review). So there are two provider-construction paths in one product.

## What

Decide and record: either route `eval` through the product profile like the other surfaces, or
document it as a deliberately separate shell path (with the reason — e.g. eval needs a provider
configuration the interactive profile should not carry). Silence is the thing to avoid: an
undocumented second path is how the composition root grew back last time.

## Test Plan

If routed: `eval` still passes its existing suite and the provider it receives is the one the profile
resolves (assert equality). If documented-as-separate: a comment at the call site + a line in
`agent-cli/docs/SPEC.md` stating the exemption and its reason.
