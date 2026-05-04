# ADR-002: Auth and Credits Package Boundaries

## Status

accepted

## Context

Published DAG execution introduces external callers, API keys, user ownership, and credit checks before a workflow can run. The monorepo already has `dag-cost` for CEL-based cost estimation, but it does not own identity, account balance, reservations, settlement, or billing provider integration. Those concerns need stable package boundaries before route middleware and orchestrator policy checks are added.

The immediate beta need is to make the contracts composable without binding them to Express, a payment provider, or a specific DAG execution path.

## Alternatives Considered

1. **Put auth and credits inside `dag-orchestrator-server`**
   - Pros: fastest route-level integration.
   - Cons: makes authentication and credit policy app-specific, blocks reuse by SDK, CLI, remote execution, or other servers.

2. **Put credits inside `dag-cost` and auth inside `dag-orchestrator`**
   - Pros: fewer packages.
   - Cons: `dag-cost` would mix formula evaluation with account state, reservations, and settlement. `dag-orchestrator` would gain identity concerns unrelated to run translation.

3. **Create neutral `@robota-sdk/auth` and `@robota-sdk/credits` packages; defer `billing` until payment provider selection**
   - Pros: keeps identity and credit ledger/reservation contracts reusable, testable, and independent from DAG execution. Keeps `dag-cost` focused on cost formulas.
   - Cons: route integration requires explicit composition and adapter wiring later.

## Decision

Use neutral private packages:

- `@robota-sdk/auth` owns credential, principal, auth context, verifier port, and scope policy contracts.
- `@robota-sdk/credits` owns credit account, reservation, ledger entry, store ports, and pure reservation/settlement policy.
- `@robota-sdk/dag-cost` remains the cost formula evaluator. It does not store balances or decide account authorization.
- `@robota-sdk/billing` is not created yet. Billing must become a separate package when a concrete payment provider or invoice lifecycle is selected.

The DAG orchestrator server will later compose these packages at its HTTP/API boundary: verify caller, estimate cost with `dag-cost`, reserve credits with `credits`, run the workflow, then settle or release credits based on execution result.

## Consequences

- Auth and credit logic can be tested without Express, ComfyUI, or DAG runtime dependencies.
- Published workflow routes can add middleware later without changing the core package contracts.
- Credit reservation uses integer credit units to avoid floating-point balance drift.
- Billing remains an explicit future boundary instead of a placeholder package with unstable contracts.
- A later adapter package or application layer must provide concrete auth verifiers and credit stores.

## References

- `.agents/project-structure.md`
- `.agents/rules/code-quality.md`
- `.agents/tasks/SDK-BL-001-auth-and-credits-package-design.md`
- `.agents/tasks/DAG-BL-006-dag-publish-api-endpoint.md`
