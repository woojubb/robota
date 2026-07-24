---
name: contract-testing
description: Applies consumer-driven contract testing to verify API compatibility between packages or services without full E2E tests. Use when designing or evolving API boundaries between loosely coupled modules.
---

# Contract Testing (Consumer-Driven Contracts)

## Rule Anchor

- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Type System (Strict)"

For an API boundary between independently developed modules (HTTP, WebSocket, or typed interface):

1. The **consumer defines the contract** — a version-controlled file (JSON/TS) of the
   request/response pairs it depends on — and tests against a mock derived from it.
2. The **provider verifies the contract** — replays the consumer's expectations against its real
   handlers in its own tests, without either side needing the other running.
3. CI runs both sides; a contract violation blocks the merge. When the API changes, update the
   contract first, then the implementation (breaking vs. additive goes through review).

Anti-patterns: hand-written consumer mocks that drift from the real API; provider changes without
a contract update; contracts that test internal implementation instead of the boundary shape;
relying solely on E2E tests for compatibility.
