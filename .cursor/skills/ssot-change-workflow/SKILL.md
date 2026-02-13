---
name: ssot-change-workflow
description: Guide SSOT change workflows for ownership audits and example migration phases. Use when running SSOT inventory, batch rollouts, or example ownership migrations.
---

# SSOT Change Workflow

## Rule Anchor
- `.cursor/rules/type-ssot-rules.mdc`
- `.cursor/rules/build-and-resolution-rules.mdc`

## Scope
Use this skill for SSOT ownership audits and phased example migrations.

## Ownership Audit Workflow
1. Define audit scope (packages/apps, include tests or not).
2. Define a candidate collection routine for duplicate declarations.
3. Build an inventory table with owner, consumer, issue category, batch, and summary.
4. Execute batches in order (UI/contexts/hooks → message/conversation → tool contract → workflow graph → event name ownership).
5. Verify each batch is complete before moving to the next.

## Example Ownership Migration Workflow
### Phase 0: Decision Gate
1. Decide the role of `apps/examples` (remove vs integration/demo).

### Phase 1: Scaffolding
1. Decide whether each package needs an `examples/package.json`.
2. Keep a single execution rule: `npx tsx examples/<file>.ts`.

### Phase 2: Migration Batches
1. Batch 1: move low-dependency examples (agents/openai).
2. Batch 2: move workflow examples and confirm CLI/util ownership.
3. Batch 3: move remaining packages (team/remote, etc).

### Phase 3: Documentation
1. Maintain package-level `examples/README.md`.
2. Update `apps/examples` docs based on the Phase 0 decision.

### Phase 4: CI/Quality Check Scope
1. Redefine example quality check scope by package.
2. If integration examples remain, run a single integration job.
