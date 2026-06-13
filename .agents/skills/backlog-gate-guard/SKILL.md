---
name: backlog-gate-guard
description: Validates a single named gate for a spec document and appends the result to the Evidence Log. Invoked as a subagent by backlog-pipeline. Does exactly one thing — check one gate and record the outcome.
---

# Backlog Gate Guard

Single-gate validator for spec documents. This skill checks exactly one gate, appends the result to the Evidence Log, and returns PASS, FAIL, or NON-COMPLIANCE. It does not write content, orchestrate pipeline flow, or perform implementation.

## Rule Anchor

- `.agents/rules/spec-workflow.md` > HARD GATE: No Immediate Implementation
- `backlog-pipeline` skill > State Machine

## When to Use

Invoked as a **subagent** (Agent tool) by `backlog-pipeline`. Each invocation handles exactly one gate.

**Input required from caller:**

- Gate name: one of `GATE-WRITE`, `GATE-APPROVAL`, `GATE-IMPLEMENT`, `GATE-VERIFY`, `GATE-COMPLETE`, `GATE-CONFORMANCE`
- Spec document path: `.agents/spec-docs/<stage>/<ID>.md`

## Output

Always appends one or more entries to `## Evidence Log` in the spec document using the **Edit tool** (append after the last existing entry, or directly after the `## Evidence Log` header if empty). Then returns one of:

- `PASS` — all criteria met, status upgrade is authorized
- `FAIL` — one or more criteria not met, status upgrade blocked
- `NON-COMPLIANCE` — gate was bypassed or evidence from a prior gate is missing

## Evidence Log Entry Format

Every entry MUST use this format. No exceptions.

```markdown
### [<GATE-NAME>] — ✅ PASS | <YYYY-MM-DD>

**Status upgrade:** <current> → <next>
<Specific evidence for each criterion checked. One line per criterion.>

### [<GATE-NAME>] — ❌ FAIL | <YYYY-MM-DD>

**Status remains:** <current>
**Failed criteria:**

- <criterion>: <what was found vs. what was required>
  **Required action:** <what must be fixed before re-running this gate>

### [<GATE-NAME>] — 🔴 NON-COMPLIANCE | <YYYY-MM-DD>

**Status remains:** <current>
**Violation:** <what was bypassed or skipped>
**Required action:** <what must be done to resolve — may include rejecting the item>
```

Partial entries (e.g., PASS without specific evidence lines) are treated as NON-COMPLIANCE on the next gate run.

---

## Gate Criteria

### GATE-WRITE `draft → review-ready`

Check every item. A single unmet item = FAIL.

**Frontmatter:**

- [ ] File begins with `---` YAML frontmatter block
- [ ] `status: draft` present in frontmatter
- [ ] `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY
- [ ] `tags:` field present in frontmatter (may be empty array `[]`)

**Problem section:**

- [ ] Contains a concrete symptom (specific command, output, or behavior that is wrong)
- [ ] Contains a reproduction condition (when/where it occurs)
- [ ] Does not contain "TBD", "TODO", or vague single-sentence descriptions

**Architecture Review Checklist:**

- [ ] All 4 checklist items are `[x]`
- [ ] Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`
- [ ] Alternatives Considered has at least 2 entries with pro/con for each
- [ ] Decision references the trade-off that drove the choice

**Completion Criteria:**

- [ ] Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL
- [ ] At least 1 criterion per distinct feature or sub-item
- [ ] Each criterion uses Command form or Observable behavior form (no vague language)
- [ ] No criterion uses: "works correctly", "no errors", "implemented", "displays correctly"

**Test Plan section:**

- [ ] `## Test Plan` section present
- [ ] One row exists for each TC-N in Completion Criteria (count must match)
- [ ] Each row has a non-empty Test Type and Tool/Approach (no "TBD")
- [ ] Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible

**Structure:**

- [ ] Tasks section present with placeholder
- [ ] Evidence Log section present and empty (first GATE-WRITE run)
- [ ] No `## Status` or `## Classification` sections in the body (these are frontmatter fields)

**Evidence to record on PASS:** State each section checked and its result. Confirm TC-N count matches between Completion Criteria and Test Plan.

---

### GATE-APPROVAL `review-ready → approved`

- [ ] User has provided explicit approval in the current conversation
- [ ] Approval is a direct, unambiguous statement directed at this spec document
- [ ] No Architecture Review or frontmatter type/tags modified after approval

**What counts as explicit approval:**

- "승인", "진행해", "맞아 진행해", "ok 시작해", "끝까지 책임지고 작업해"
- Any statement that clearly confirms the design and authorizes implementation

**What does NOT count:**

- Answering a clarifying question ("C", "ㅇㅇ", "응") without confirming the design
- Silence or lack of objection
- Approval of a different item in the same conversation

**Evidence to record on PASS:** Quote the exact user statement verbatim and the date.

**NON-COMPLIANCE trigger:** Implementation work (file edits, code commits) was started before this gate ran.

---

### GATE-IMPLEMENT `approved → in-progress`

- [ ] `.agents/tasks/<ID>.md` has been created
- [ ] Tasks file path is recorded in the `## Tasks` section of the spec document
- [ ] Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N)
- [ ] The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the
      `test-plans` harness scan requires development docs to carry one (else `harness:scan` fails). [AF-24]

**Evidence to record on PASS:** Tasks file path + list of tasks created.

**NON-COMPLIANCE trigger:** Implementation commits exist but no tasks file was created.

---

### GATE-VERIFY `in-progress → verifying`

- [ ] All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`)
- [ ] No tasks are blocked or pending
- [ ] Build passes for all affected packages (`pnpm build`)
- [ ] Tests pass for all affected packages (`pnpm test`)

**Evidence to record on PASS:** Confirm tasks file completion state + build/test commands run and result.

**FAIL trigger:** Any task is unchecked, blocked, or build/test is failing.

---

### GATE-COMPLETE `verifying → done`

For each TC-N in `## Completion Criteria`:

- [ ] The checkbox is checked (`[x]`)
- [ ] A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with:
  - The exact command or action used to verify
  - The actual output or result observed
  - Exit code if applicable

For each TC-N in `## Test Plan`:

- [ ] **One of the following is recorded:**
  - **Test written:** test file path + test function/describe name (e.g., `packages/agent-cli/src/__tests__/some-feature.test.ts > TC-01 expected behavior`)
  - **Test skipped:** explicit reason why automated test was not written (e.g., `TC-02: ANSI color requires visual inspection — manual verification via terminal screenshot`)
- [ ] No TC-N is silently unaddressed — every row must have either a test reference or a skip reason

After all criteria:

- [ ] Spec document `## Completion Criteria` checkboxes are all `[x]`
- [ ] `## Test Plan` updated with test references or skip reasons for all TC-N rows
- [ ] Tasks file archived to `.agents/tasks/completed/<ID>.md`
- [ ] `## Tasks` section updated to reflect archived path

**Evidence to record:** One Evidence entry per TC-N (verification + test reference/skip), then a final summary entry.

**FAIL trigger:** Any TC-N unchecked, or checked without a matching Evidence entry. Any TC-N in Test Plan missing both a test reference and a skip reason.

---

### GATE-CONFORMANCE (architecture conformance — standalone, not a status transition)

Unlike the WRITE→COMPLETE gates, GATE-CONFORMANCE does not move a spec between folders. It validates
that the canonical architecture documents match code reality (see
[`spec-workflow.md` > GATE-CONFORMANCE](../../rules/spec-workflow.md)). Run on demand, after any
cross-package change, and before a `develop → main` release.

- [ ] `pnpm harness:conformance` was run; its exit code and `CONFORMANCE_JSON_*` summary are captured
- [ ] `dependencyDirection` is `pass` in the JSON summary
- [ ] No **unresolved P0** finding remains (P0 = rule violation or authority-doc contradiction)

**Mechanical core:** `scripts/harness/check-architecture-conformance.mjs` (composes
`check-dependency-direction.mjs` + the workspace-package-name guard).
**Analytic layer:** the [`architecture-conformance-audit`](../architecture-conformance-audit/SKILL.md)
skill set, producing `.design/architecture-audit/<date>/`.

**PASS:** `harness:conformance` exits 0 and no unresolved P0. **FAIL:** otherwise — surface the JSON
summary's `unknownPackageTokens` + any P0 findings. (Known baseline drift is tracked by INFRA-004~009;
until those land, a FAIL here is expected and is not a release blocker.)

---

## What This Skill Does NOT Do

- Orchestrate which gate runs next → that is `backlog-pipeline`
- Write or edit spec document section content → that is `backlog-writer`
- Perform implementation work or suggest fixes
- Modify any section except `## Evidence Log`, `## Test Plan` (TC-N references at GATE-COMPLETE), and `## Tasks`
- Run multiple gates in one invocation — one gate per subagent call

## Anti-Patterns

| Anti-pattern                                                | Correct behavior                                        |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Checking a criterion without recording specific evidence    | Always record what was checked and what was found       |
| Writing PASS when one criterion is unmet                    | Write FAIL with the specific failing criterion          |
| Skipping a criterion because it seems inapplicable          | Explicitly document why it is N/A in the evidence entry |
| Editing Problem or Solution sections during guard run       | Read-only except Evidence Log, Test Plan, and Tasks     |
| Combining PASS evidence from multiple gates in one entry    | One entry per gate, clearly labelled                    |
| Marking TC-N complete without test reference or skip reason | Write the reference or skip reason before marking PASS  |
| Checking `## Status` section instead of frontmatter         | Always read frontmatter `status:` field                 |
