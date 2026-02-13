---
name: scenario-guard-checklist
description: Provide a pre-change checklist for scenario-related modifications. Use when making scenario changes or workflow change gates.
---

# Scenario Guard Checklist

## Scope
Use this checklist before making scenario-related changes.

## Pre-Change Checklist
- [ ] Is the change required only for scenario functionality?
  - If yes, stop and redesign as a general workflow capability.
- [ ] Is the owner package for the changed contract/category/event appropriate?
  - No duplicate declarations, meaningless aliases, or pass-through re-exports.
- [ ] Is the change independent of scenario-specific domain logic?
  - No scenario-only fields, keywords, regex, or inferred logic.
- [ ] Will the change violate No-Fallback or Path-Only rules?
  - No inferred linkage, delayed linking, alternate paths, or dedup suppression.
- [ ] Is event parent-child linkage modeled through `context.ownerPath`?
  - Do not add side-channel linkage fields when ownerPath can encode the relation.
- [ ] Are scenario records cleanly regenerated (overwrite), not appended to stale records?
- [ ] If core changes are required, build the affected packages:
  - `pnpm --filter @robota-sdk/* build`
