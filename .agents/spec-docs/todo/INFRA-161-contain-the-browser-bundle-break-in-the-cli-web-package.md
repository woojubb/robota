---
status: approved
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-161: Contain the browser bundle break in the CLI web package

Paired with `.agents/tasks/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md`. Arising from [issue #2579](https://github.com/woojubb/robota/issues/2579).

## Problem

`pnpm --filter @robota-sdk/agent-cli-web build` fails with `"randomBytes" is not exported by
"__vite-browser-external"`, naming the transport protocol package's node bundle. The SPA reaches that
bundle through the transport GUI client, which imports two runtime decoders from the protocol package;
the package declares one `.` export condition whose every branch resolves to `dist/node`, and its
barrel re-exports the two modules that import `node:crypto`. A browser consumer therefore receives the
node graph, and the bundler reports the builtin rather than the import that asked for it.

It reproduces on any tree where the SPA is built, which the CLI build does, so every change that makes
`agent-cli` an affected package is blocked by a break it did not cause. Registered as
[issue #2579](https://github.com/woojubb/robota/issues/2579).

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: the containment repairs a bundler resolution inside this repository; the published-contract fix it defers is INFRA-158, which carries the prior art

## Architecture Review

### Affected Scope

- `packages/agent-cli-web`
- `packages/agent-transport-protocol`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** <!-- one line: the trade-off that drove it -->

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: the containment repairs a bundler resolution inside this repository; the published-contract fix it defers is INFRA-158, which carries the prior art
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Apply the fix at the site the Problem names, following the repository's existing precedent for
this shape, and add the test TC-01 names so the symptom is refused mechanically from then on.

## Affected Files

- `packages/agent-cli-web`
- `packages/agent-transport-protocol`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run <test file>` → exits 0, and exits 1 with the fix reverted
      <!-- name the test; the reverted run is the red-proof of the refusal -->
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run <the test file TC-01 names>` → exits 0 on the whole file, not only the new case

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on the named test    | RED with the fix reverted, GREEN with it          |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `pnpm exec vitest run <path>.test.mjs`      | The whole test file                               |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2f7cfddd175b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md) is at or above the floor L1)
**Review fingerprint:** 024df436a5fb (review d81919be, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (024df436a5fb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `14bff35b8e63` (untracked)

### [GATE-PLAN] — ❌ FAIL | 2026-09-05

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` is 56 chars / 1 sentence(s) after stripping HTML comments — below the floor of ≥ 2 sentences or ≥ 200 chars of real text
  **Required action:** describe the symptom and its reproduction condition in the prose itself
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `e0aab6bb15e0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2f7cfddd175b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md) is at or above the floor L1)
**Review fingerprint:** 024df436a5fb (review d81919be, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (024df436a5fb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `9678b7095342` (untracked)

### [GATE-PLAN] — ❌ FAIL | 2026-09-05

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: not-applicable PLAN reason is invalid: expected exactly one visible **Reason:** field
  **Required action:** record one visible substantive **Reason:** field

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `50ddc51f62f7` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2f7cfddd175b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md) is at or above the floor L1)
**Review fingerprint:** 024df436a5fb (review d81919be, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (024df436a5fb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `8c626fe08368` (untracked)

### [GATE-PLAN] — ❌ FAIL | 2026-09-05

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: not-applicable PLAN reason is invalid: Reason cites forbidden engineering evidence: build
  **Required action:** record one visible substantive **Reason:** field

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `563bd8f8c68c` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2f7cfddd175b) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md) is at or above the floor L1)
**Review fingerprint:** 024df436a5fb (review d81919be, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (024df436a5fb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `bf7f0b11e57b` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 840 chars, 5 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 7 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (024df436a5fb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `2f7cfddd175b` · base `origin/develop@2f7cfddd175b` · document `.agents/spec-docs/draft/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` blob `b63d1df5593a` (untracked)
