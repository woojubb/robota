# Gate Catalogue

This repository's gate catalogue: **which gates exist here, what each one requires, what precedes it, and
the format its evidence entry takes.** It is a **fact catalogue** — the same artifact kind as
[orchestration-map.md](orchestration-map.md) and [deployment-matrix.md](deployment-matrix.md), and
deliberately none of the three composition kinds in
[harness-composition-design.md](harness-composition-design.md): it is not a rule (it states no new
mandate — it enumerates the criteria the rules already mandate), not an orchestration skill (it has no
phases and no routing), and not an agent charter (it holds no judgement discipline).

**The role is not here.** How to judge a gate — apply every criterion, check ordering first, never soften a
verdict, record specific evidence, emit `GATE VERDICT: PASS | FAIL | NON-COMPLIANCE` — is owned by the
[`backlog-gate-guard` agent](../../.claude/agents/backlog-gate-guard.md). **The pipelines are not here
either**: [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md) dispatches the spec-document gates and
[`user-execution-scenario`](../skills/user-execution-scenario/SKILL.md) dispatches the two done-gate stages.

## Rule Anchor

- `.agents/rules/spec-workflow.md` > HARD GATE: No Immediate Implementation — the spec-document gate mandate
- `.agents/rules/spec-workflow.md` > Spec-Document Status and Lifecycle Folders — the status ↔ folder mapping
- `.agents/rules/backlog-execution.md` > Done Gate — the done-gate mandate
- `backlog-pipeline` skill > State Machine — the gate order for spec documents

## Gate index

| Gate                | Applies to                          | Artifact its evidence is recorded in |
| ------------------- | ----------------------------------- | ------------------------------------ |
| `GATE-WRITE`        | spec document                       | `## Evidence Log`                    |
| `GATE-APPROVAL`     | spec document                       | `## Evidence Log`                    |
| `GATE-IMPLEMENT`    | spec document                       | `## Evidence Log`                    |
| `GATE-VERIFY`       | spec document                       | `## Evidence Log`                    |
| `GATE-COMPLETE`     | spec document                       | `## Evidence Log`                    |
| `GATE-CONFORMANCE`  | spec document (standalone)          | `## Evidence Log`                    |
| `DONE-GATE-STAGE-1` | backlog item under `.agents/tasks/` | the item's scenario section          |
| `DONE-GATE-STAGE-2` | backlog item under `.agents/tasks/` | the item's scenario section          |

Spec-document gates are dispatched by `backlog-pipeline`; the two done-gate stages are dispatched by
`user-execution-scenario`.

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

## Prior-gate map

The agent runs its ordering check before any gate's own criteria. This table is the repository's
answer to "what precedes this gate, and what state must the document already be in":

| This gate         | Prior gate that must show PASS | Expected input status / folder             |
| ----------------- | ------------------------------ | ------------------------------------------ |
| GATE-APPROVAL     | GATE-WRITE                     | `review-ready`                             |
| GATE-IMPLEMENT    | GATE-APPROVAL                  | `approved`                                 |
| GATE-VERIFY       | GATE-IMPLEMENT                 | `in-progress`                              |
| GATE-COMPLETE     | GATE-VERIFY                    | `verifying`                                |
| DONE-GATE-STAGE-2 | DONE-GATE-STAGE-1              | scenarios written, implementation complete |

GATE-WRITE has no prior status gate (it is the entry gate); GATE-CONFORMANCE is standalone (no transition)
and is exempt; DONE-GATE-STAGE-1 has no prior gate. Authoritative spec-document gate order:
`backlog-pipeline` skill > State Machine.

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

**Prior Art Research (research.md — default-on):**

- [ ] `## Prior Art Research` (or `## Research`) section present
- [ ] Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found
- [ ] OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL
- [ ] Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted)

**Architecture Review Checklist:**

- [ ] All 4 checklist items are `[x]`
- [ ] Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`
- [ ] Alternatives Considered has at least 2 entries with pro/con for each
- [ ] Decision references the trade-off that drove the choice
- [ ] **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation
      or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision
      MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show
      reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See
      `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is
      introduced.)

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
- [ ] **Independent architecture validation (conditional):** IF the spec introduces a new package / app /
      surface or reclassifies a layer / product-family boundary, the Evidence Log MUST contain an independent
      `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement —
      not a bare "reviewed" claim. Retain an `architecture-audit-fanout` structure-channel result as
      additional placement evidence when the surface is new. A new-surface spec approved without a recorded independent
      placement review is a process violation (see `spec-workflow.md` "New-Surface Architecture Placement").

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
- [ ] The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`
- [ ] That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item

**Evidence to record:** One Evidence entry per TC-N (verification + test reference/skip), then a final summary entry.

**FAIL trigger:** Any TC-N unchecked, or checked without a matching Evidence entry. Any TC-N in Test Plan missing both a test reference and a skip reason.

**Post-PASS handoff:** task terminal status/date, task archival, the spec's archived task pointer, and
the spec's `verifying/active → done/done` transition are PASS outputs, not guardian preconditions. Their
atomic completion order is owned by
[`backlog-execution-orchestrator`](../skills/backlog-execution-orchestrator/SKILL.md) Phase 5 and the
status/folder mapping in [`spec-workflow.md`](../rules/spec-workflow.md). After assembling that one closing
commit, run the placement and task-archival scans against the final state.

---

### GATE-CONFORMANCE (architecture conformance — standalone, not a status transition)

Unlike the WRITE→COMPLETE gates, GATE-CONFORMANCE does not move a spec between folders. It validates
that the canonical architecture documents match code reality (see
[`spec-workflow.md` > GATE-CONFORMANCE](../rules/spec-workflow.md)). Run on demand, after any
cross-package change, and before a `develop → main` release.

- [ ] `pnpm harness:conformance` was run; its exit code and `CONFORMANCE_JSON_*` summary are captured
- [ ] `dependencyDirection` is `pass` in the JSON summary
- [ ] No **unresolved P0** finding remains (P0 = rule violation or authority-doc contradiction)

**Mechanical core:** `scripts/harness/check-architecture-conformance.mjs` (composes
`check-dependency-direction.mjs` + the workspace-package-name guard).
**Analytic layer:** the [`architecture-conformance-audit`](../skills/architecture-conformance-audit/SKILL.md)
skill set, producing `.design/architecture-audit/<date>/`.

**PASS:** `harness:conformance` exits 0 and no unresolved P0. **FAIL:** otherwise — surface the JSON
summary's `unknownPackageTokens` + any P0 findings. (Known baseline drift is tracked by INFRA-004~009;
until those land, a FAIL here is expected and is not a release blocker.)

---

### DONE-GATE-STAGE-1 — scenario written

Applies to a backlog item under `.agents/tasks/` that carries a
`## User Execution Test Scenarios` section. Mandate and definitions:
[`backlog-execution.md`](../rules/backlog-execution.md) > Done Gate.

- [ ] Every scenario is written with exact commands or UI steps, prerequisites, an expected observable
      result, and an evidence field
- [ ] Every scenario carries its executability decision (`agent-executable`, or `manual-only:` with a
      **specific technical reason** — a bare "it is a UI" is not one)
- [ ] The scenario drives a product surface. A scenario whose observable is a build, typecheck, lint, test
      run, harness check, CI check, or an inspection of repository text is **not** a scenario — FAIL
- [ ] A scenario requiring live credentials or an external service states that prerequisite **explicitly**
      (`backlog-execution.md` > Scenario Design Preference Order). An executor must learn the gate cannot
      run in their environment from the scenario, not from the failure

**Exception:** passes by exception only when writing a scenario is genuinely impossible AND a valid reason
is recorded explicitly under each unwritten scenario. An unwritten scenario with no stated reason does not
pass.

**Evidence to record on PASS:** each scenario named, with the field-completeness result per scenario.

---

### DONE-GATE-STAGE-2 — scenario executed

- [ ] The agent directly executed every scenario against the completed implementation or delivered artifact
- [ ] The observed result matched the expected observable result for every scenario
- [ ] Concrete evidence (command output, exit code, screenshot, log excerpt, diff, or another artifact) is
      recorded in the item under each scenario's evidence field

All three must hold. Two additional checks that turn a PASS into a FAIL:

- **Engineering verification cited as evidence** — see the authoritative statement in
  [`backlog-execution.md`](../rules/backlog-execution.md) > Done Gate. Build/test/lint/harness/CI output
  is never user-execution evidence. FAIL.
- **An unprobed capability-absence claim** — "the environment lacks the key/tool/device" is not a valid
  exception reason unless the probe itself is recorded (which surfaces were checked, and what they
  contained). FAIL.

For a code-changing item, evidence must reference **durable repository artifacts** (paths that exist), per
the durable-artifact rule the same document owns.

**Exception:** passes by exception only when execution is genuinely impossible AND a specific reason is
stated under the scenario that could not be executed, which must also carry the `manual-only` label.

**Evidence to record on PASS:** per scenario — the command run, the observed result, and where the
evidence now lives in the item.

**Mechanical floors behind this gate:** `check-done-evidence.mjs` (referenced artifacts still exist),
`check-backlog-placement.mjs` (terminal status ↔ location ↔ `completed:` date), and
`scan-capability-reachability.mjs` (a declared capability may not record `user_execution: none`).
