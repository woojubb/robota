---
name: root-cause-workflow
description: Guide a strict root-cause analysis workflow with validation, options exploration, and verification. Use when diagnosing issues or planning fixes.
---

# Root Cause Workflow

## Scope
Use this skill to diagnose issues and validate fixes with a strict, step-by-step process.

## Required Sequence
1. **Root Cause Discovery**
   - Identify the underlying cause, not just symptoms.
   - Use code reading, flow tracing, and log analysis.
2. **Root Cause Validation (3 checks)**
   - Can this cause the observed issue?
   - Are there other plausible causes?
   - If fixed, will it fully resolve the issue?
3. **Fix Options Exploration**
   - Enumerate multiple fixes and compare trade-offs.
4. **Fix Validation (3 checks)**
   - Does it remove the root cause?
   - Does it introduce side effects or new rule violations?
   - Does it prevent similar issues from recurring?
5. **If Validation Fails**
   - Return to step 3 and repeat until validation passes.
6. **Simulation**
   - Predict post-change behavior across scenarios.
   - Define concrete success criteria (including rule compliance).
7. **Explicit Permission**
   - Request approval before edits or commands.
   - Summarize intended changes and expected outcomes.
8. **Execute → Build → Verify**
   - Apply approved changes.
   - Build relevant packages as required.
   - Verify behavior and report results.

## Checklist Execution Protocol
1. Write explicit checklist items for the task scope.
2. Execute one checklist item at a time.
3. Validate each item with concrete commands (build/test/run/verify).
4. Mark an item complete only after validation passes.
5. If validation fails, keep/revert the item as incomplete and continue root-cause correction.

## Build Error Resolution Addendum
- Trace build failures to architectural causes.
- Prefer constraint-based generics and explicit validation over blind casting.
