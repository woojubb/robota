---
name: effect-style-error-modeling
description: Model predictable TypeScript workflow failures with explicit Result or Either-like flows.
---

# Effect-Style Error Modeling

## Rule Anchor

[common-mistakes.md, entry 57](../../rules/common-mistakes.md) owns the failure convention.
This skill supplies an implementation method, not another Result-vs-throw policy.

## Method

1. Read the owning SPEC and trace failures from producer through adapters to callers, marking
   where the public contract changes. If the convention is unspecified or contradictory, resolve
   it in that SPEC before changing the implementation.
2. Reuse the declared error/result types. For a Result-based contract, enumerate predictable
   failure variants and implement the caller's handling of each variant. Locate any conversion
   in the adapter that owns the receiving contract.
3. Verify the selected contract with focused tests for failure outcomes, required exception
   identity, and declared boundary conversions.
