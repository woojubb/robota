---
name: spec-code-conformance
description: Mandatory verification loop after any SPEC.md or contract document change. Compares spec against implementation code, fixes code to match spec, repeats until zero discrepancies, then runs regression tests. Spec is always the source of truth — never modify the spec within this workflow.
loop: over=finding-set; escape=no-progress
---

## Rule Anchor

- "Spec-Code Conformance Verification" in `.agents/rules/spec-workflow.md`
- "ABSOLUTE RULE: Verification does not modify SPEC to match code" in `.agents/rules/spec-workflow.md`

## When to Use

This skill is **mandatory** whenever:

- A `docs/SPEC.md` file is created or modified
- An API specification document is created or modified
- A contract test file is created or modified that changes expected behavior

**Trigger condition:** Any SPEC.md diff in the current changeset.

Run once for the coherent changeset, not once per SPEC edit. Collect related gaps and fix them
as one batch under [execution-cadence.md](../../rules/execution-cadence.md); reuse this run and
its evidence across supplements. Only changed claims and their affected consequences need rechecking.

## Core Principle

**Spec is the source of truth.** This workflow only fixes code to match the spec. It never modifies the spec itself. If the spec appears wrong, that is a separate concern handled by other workflows (e.g., `spec-writing-standard`, `spec-first-development`). Within this workflow, the spec is assumed correct and the code must conform.

## Workflow

```
┌─────────────────────────────────────┐
│  Step 1: Collect affected specs     │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Step 2: Read spec, read code       │
│          Compare each assertion     │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Step 3: List all gaps              │
│  (spec says X, code does Y)         │
└──────────────┬──────────────────────┘
               ▼
        ┌──────┴──────┐
        │ Gaps = 0 ?  │──── yes ──► Step 6: Regression tests
        └──────┬──────┘
               │ no
               ▼
┌─────────────────────────────────────┐
│  Step 4: Fix code to match spec    │
│  Add/update contract test per fix   │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Step 5: Build + test affected      │
│  packages                           │
└──────────────┬──────────────────────┘
               │
               └──────► Back to Step 2 (repeat)
```

**The loop's escape.** Repeat until step 2 finds no discrepancy, or until the same discrepancy set
recurs unchanged — then STOP and escalate to the user rather than spin. A round that changes nothing
is a round that will change nothing again, and a spec-versus-code disagreement neither side resolves
is a decision, not a defect. [no-progress escape](../../rules/enforcement-architecture.md) owns what that comparison means.

### Step 1: Collect affected specs

Identify all SPEC.md files that were changed in the current work. For each spec, note:

- File path
- Packages whose code must conform to this spec
- Existing contract test files (if any)

### Step 2: Read spec, compare against code

For each spec assertion (endpoints, types, error codes, response shapes, status codes, class contracts):

1. Read the spec statement
2. Find the corresponding implementation code
3. Check if the code matches the spec exactly

Pay attention to:

- HTTP status codes (spec says 404, code returns 400?)
- Response envelope shapes (raw error vs IProblemDetails?)
- Type names and field names
- Error codes and their mapping
- Public API surface (all exports listed in spec exist?)
- Extension points (interfaces implemented correctly?)

### Step 3: List all gaps

Create a gap table:

| #   | Spec file | Spec assertion | Code location | Discrepancy |
| --- | --------- | -------------- | ------------- | ----------- |

Every gap is a code fix. The spec is not modified in this workflow.

If zero gaps: skip to Step 6.

### Step 4: Fix code to match spec

For each gap:

1. Fix the implementation code so it conforms to the spec
2. Add or update a contract test that verifies the corrected behavior

The test must fail before the fix and pass after.

**Never modify the spec in this step.** If you believe the spec is wrong, flag it to the user but still fix the code to match the current spec. Spec corrections are a separate workflow.

### Step 5: Build and test

```bash
pnpm --filter <affected-package> build
pnpm --filter <affected-package> test
pnpm --filter <affected-package> exec tsc -p tsconfig.json --noEmit
```

All must pass. If not, fix and retry.

Then return to Step 2 for the repaired claims and affected consequences. Do not repeat unchanged
comparisons or already-passing commands on identical inputs.

### Step 6: Regression tests

Only when Step 2 produces **zero gaps**, confirm coverage below. Reuse Step 5's passing commands
on unchanged inputs instead of executing them again; missing coverage runs in the integrated batch:

```bash
# All affected packages
pnpm --filter <pkg1> --filter <pkg2> ... test

# Full typecheck of affected packages
pnpm --filter <pkg1> --filter <pkg2> ... exec tsc -p tsconfig.json --noEmit

# Full build of affected packages
pnpm --filter <pkg1> --filter <pkg2> ... build
```

All must pass. Only then is the conformance verification complete.

## Bidirectional Verification (mandatory)

Drift is bidirectional. The loop above catches code-ahead-of-spec; you MUST also run the
reverse direction:

**Direction 2 — SPEC→code.** Enumerate every field, export, option, event, and behavior the
SPEC declares, and confirm each exists in code with the declared shape. Record both directions
in the conformance evidence ("code→SPEC: N items checked; SPEC→code: M items checked").

Incident (2026-06-11, CLI-053): agent-transport SPEC documented `allowedTools`/`deniedTools` on
the TUI render options while `IRenderOptions` had neither field — SPEC-ahead drift that
one-directional verification never caught. The flags silently no-opped in TUI mode.

## Completion Criteria

The verification is complete when ALL of the following are true:

- [ ] Every spec assertion has a matching implementation
- [ ] Every fix has a corresponding contract test
- [ ] All contract tests pass
- [ ] All affected packages build without errors
- [ ] All affected packages pass typecheck without errors
- [ ] Full regression test suite passes for affected packages

## Orchestrated Skills

| Skill                    | Role in this workflow            |
| ------------------------ | -------------------------------- |
| `contract-testing`       | Contract test patterns           |
| `repo-change-loop`       | Build and verify loop            |
| `tdd-red-green-refactor` | Test-first approach for each fix |

## Anti-Patterns

- **Modifying the spec to match code:** This workflow treats the spec as immutable truth. If the spec seems wrong, flag it — do not change it here.
- **Single-pass verification:** Reading the spec once and declaring "all good" without re-reading after fixes. Gaps cascade — always re-verify.
- **Fixing code without a test:** Every code fix must have a corresponding contract test. A fix without a test will regress.
- **Skipping regression:** Passing contract tests is necessary but not sufficient. Regression tests catch unintended side effects.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop spec-code-conformance
node scripts/harness/loop-run.mjs round --loop spec-code-conformance --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop spec-code-conformance --run <id> --terminal <reason>
```
