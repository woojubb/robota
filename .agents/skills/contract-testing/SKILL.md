---
name: contract-testing
description: Applies consumer-driven contract testing to verify API compatibility between packages or services without full E2E tests. Use when designing or evolving API boundaries between loosely coupled modules.
---

# Contract Testing (Consumer-Driven Contracts)

## Rule Anchor
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Type System (Strict)"

## Use This Skill When
- Two modules communicate via API (HTTP, WebSocket, or typed interface).
- The consumer and provider are developed independently.
- You need to catch breaking API changes before deployment.
- E2E tests are too slow or flaky for API compatibility checks.

## Core Principles
1. **Consumer defines the contract**: what requests it sends and what responses it expects.
2. **Provider verifies the contract**: replays consumer expectations against its implementation.
3. **Contracts live in version control**: JSON or TypeScript files checked into the repo.
4. **Independent testing**: consumer and provider run contract tests without needing the other running.

## Workflow
1. Consumer writes a contract file describing expected request/response pairs.
2. Consumer tests pass against a mock that satisfies the contract.
3. Provider loads the contract and replays requests against its real handlers.
4. Provider tests verify all consumer expectations are met.
5. CI runs both sides; a contract violation blocks the merge.
6. When the API changes, update the contract first, then the implementation.

## Contract File Format (Lightweight)
```ts
// contracts/designer-api.contract.ts
export const DESIGNER_API_CONTRACT = {
  name: 'dag-designer',
  interactions: [
    {
      description: 'create a new DAG definition',
      request: { method: 'POST', path: '/v1/dag-definitions', body: { dagId: 'test-dag', nodes: [], edges: [] } },
      response: { status: 201, bodySchema: { dagId: 'string', version: 'number', status: 'string' } },
    },
    {
      description: 'get server capabilities',
      request: { method: 'GET', path: '/v1/capabilities' },
      response: { status: 200, bodySchema: { scheduler: 'boolean', projection: 'boolean' } },
    },
  ],
} as const;
```

## Checklist
- [ ] Contract file exists for each API boundary.
- [ ] Consumer tests use a mock derived from the contract.
- [ ] Provider tests replay contract interactions.
- [ ] Contract violations fail CI before merge.
- [ ] Contract changes go through review (breaking vs. additive).
- [ ] Contracts are versioned alongside API version (v1, v2).

## Anti-Patterns
- Consumer tests use hand-written mocks that drift from the real API.
- Provider changes API without updating the contract.
- Contracts are too detailed (testing internal implementation, not contract shape).
- Relying solely on E2E tests for API compatibility.
- Contracts stored outside version control.
