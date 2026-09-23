---
status: in-progress
type: AGREEMENT
tags: [cli, mcp, auth]
lane: L2
---

# AGREEMENT-2525: coordinate MCP transport hosting and bounded data handling

Paired with `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`. Arising from [issue #2525](https://github.com/woojubb/robota/issues/2525).

## Problem

Issue #2525 currently groups six unfinished source rows, but four of its direct security/data outcomes have no Task owner: cross-platform stable external-payload replay ([issue #2153](https://github.com/woojubb/robota/issues/2153)), safe stdio client transport ([issue #2522](https://github.com/woojubb/robota/issues/2522)), bounded result admission/spill ([issue #2525](https://github.com/woojubb/robota/issues/2525)), and authenticated loopback Streamable HTTP hosting ([issue #2533](https://github.com/woojubb/robota/issues/2533)). Treating that register as one implementation would couple filesystem integrity, local process authority, model-context data lifecycle, and HTTP listener authentication into an unverifiable adapter.

The problem reproduces whenever planning starts from the umbrella Issue alone: an implementation can appear to address MCP transport while leaving an unsafe spill lifecycle, unsupported-host replay, an ambient subprocess spawn path, or an unauthenticated loopback listener unresolved. Existing `AGREEMENT-014` and `AGREEMENT-015` already own the separate client/server migration graphs, so reparenting them would create forbidden nested AGREEMENT ownership rather than evidence of delivery.

## Prior Art Research

- **Bounded MCP output and opaque spill references.** [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) separates a warning threshold, a default output limit, a hard maximum, and a per-tool metadata override; non-image overflow is saved in a session tool-results location and represented in conversation by a reference. Robota therefore needs the same order — measure/admit before provider conversion, allow a strictly bounded per-tool exception, and expose only an opaque reference — plus explicit containment, permission, redaction, partial-write, disk-full, retention, and cleanup contracts.
- **External payload references.** The [MCP Resources specification](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) identifies resources by URIs and expects sensitive-resource access control; the [MCP Roots specification](https://modelcontextprotocol.io/specification/2025-11-25/client/roots) requires root-bound path handling and traversal protection. Neither defines a portable, TOCTOU-safe filesystem handle. Robota must retain a supported-host stable-authority contract, reject replacement/traversal/symlink escape, and never disclose raw storage paths as user-facing references.
- **Stdio client transport.** The [MCP stdio transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) treats child-process stdout as newline-delimited JSON-RPC and stderr as logs. [SEP-1024's local-server client security requirements](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/1024-mcp-client-security-requirements-for-local-server-.md) require explicit disclosure/consent for the exact command and arguments, while the [MCP C# SDK transport guidance](https://csharp.sdk.modelcontextprotocol.io/v1/concepts/transports/transports.html) warns that inherited environments can leak credentials. Robota must independently authorize executable, arguments, cwd, environment, activation, and lifecycle rather than treat stdio as another HTTP URL.
- **Loopback Streamable HTTP host.** The [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) requires Origin validation and recommends loopback binding plus authentication for local servers; the [MCP Authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) keeps credentials in request headers rather than query strings. Robota consequently needs a distinct listener/admission/session-mapping boundary with explicit Host/Origin checks, credential redaction, and non-loopback refusal.

These references consistently separate result lifecycle, filesystem handles, local process authority, and HTTP network admission. They support a coordination-only Agreement with four independently designed and verified child Tasks, not a single MCP transport implementation.

## Architecture Review

### Affected Scope

- Agreement checkpoint: `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`, its four direct Task records, and this paired spec.
- `PAYLOAD-2153` investigation target: `packages/agent-session/src/session-log-sources.ts`, `external-payload-resolver.ts`, `external-payload-file-reader.ts`, their public replay entry points, and `packages/agent-session/docs/SPEC.md`.
- `MCP-2522` and `MCP-2525` investigation target: `packages/agent-tool-mcp/src/mcp-tool.ts`, `mcp-protocol.ts`, `mcp-activation*.ts`, associated tests, the generic session/tool-result admission owner, and the relevant package specs.
- `MCP-2533` investigation target: the existing MCP server product/CLI projection, shared network-admission owner, and a lower MCP carrier owner selected by the child design. This Agreement neither creates nor names a new package.
- Existing prerequisite streams: `AGREEMENT-014` / `MCP-001` through `MCP-005` and `AGREEMENT-015` / `MCP-006` through `MCP-008`; they remain externally owned Task graphs.

### Alternatives Considered

1. Implement every unchecked source row as one MCP transport feature.
   - Pro: one apparent entry point and one implementation branch.
   - Con: conflates filesystem authority, subprocess authority, result lifecycle, and network admission; acceptance failures cannot be assigned or independently tested.
2. Make the existing client/server migration Agreements the owners of all new work.
   - Pro: preserves a familiar MCP Task prefix and avoids another planning document.
   - Con: creates a forbidden nested-AGREEMENT projection and retroactively changes the source identity and completion contract of already-open Task graphs.
3. Create a coordination-only Agreement with four direct non-AGREEMENT Tasks, while keeping the existing client/server graphs as explicit prerequisite streams.
   - Pro: gives every source row one owner and verification boundary, preserves existing Task history, and allows only evidence-backed shared contracts later.
   - Con: requires four child designs and their own approval/verification cycles before the umbrella can close.

### Decision

Choose Alternative 3. `AGREEMENT-2525` owns only source-map consistency, dependency sequencing, and non-overlap rules; `PAYLOAD-2153`, `MCP-2522`, `MCP-2525`, and `MCP-2533` own their own runtime/security contracts. `AGREEMENT-014` and `AGREEMENT-015` stay as prerequisite streams instead of children.

This explicitly accepts Alternative 3's cost — four separate L2 designs, approvals, verification cycles, and a later umbrella close — in exchange for preserving the independent filesystem, subprocess, data-lifecycle, and network-admission security boundaries. A shorter single-feature path is rejected because it would make a partial delivery look complete while leaving at least one boundary without its own negative-path evidence.

Reachability is preserved because the shared client (`MCP-002`) remains the prerequisite for stdio and result-admission integrations, the served product (`MCP-007`) remains the prerequisite for the HTTP carrier, and `ARCH-042` remains the completed authority substrate for cross-platform payload replay. Capability preservation is explicit: no Task may replace a stable handle with a raw path, local process authorization with generic connection configuration, a result reference with context injection, or bearer admission with a session-id assertion. An independent finding-depth triage classified the umbrella as **FOUNDATIONAL**, specifically because these are independent external lifecycles; the prior-art research above provides the adversarial boundary check before any child design is presented for approval.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `.agents/spec-docs/active/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`, `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing `AGREEMENT-014`, `AGREEMENT-015`, `AGREEMENT-2520`, session external-payload owners, and MCP tool/transport seams reviewed
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Keep `AGREEMENT-2525` as the sole parent for the four new direct Task records and pair it with this L2 Agreement spec; do not make either existing migration Agreement a child.
2. Preserve the six-row source register in the Task, spec, and GitHub Issue map. The two pre-existing migration streams are prerequisites; the direct Task paths are `PAYLOAD-2153`, `MCP-2522`, `MCP-2525`, and `MCP-2533`.
3. Require each direct child to create its own L2 spec before code: the child spec must choose exact package/file ownership, publish contract updates, specify an executable user execution test scenario, and pass its own approval and security review.
4. Use the dependency order `ARCH-042 → PAYLOAD-2153 → MCP-2525`, `MCP-001 → MCP-002 → MCP-2522`, and `MCP-006/TRANS-013 → MCP-007 → MCP-2533`. `MCP-2520` remains the completed activation-admission constraint for the outbound stdio client child only; server hosting consumes `MCP-006`'s transport-neutral execution/cancellation contract and `TRANS-013`'s exact session port instead.
5. Reconcile and close the umbrella only after every direct child and each retained existing stream has merged delivery evidence on `origin/develop`; a Task record, accepted plan, or passing document scan is never delivery evidence by itself.
6. Preserve PAYLOAD-2153's five-host qualification as an applicable child of `pr-validation`.
   The simplified four-context policy from issue #2826 supersedes the older plan to activate an
   additional live required context. Selected native failures block the aggregate; this integration
   changes no remote protection setting. Final integration landing remains the user's decision,
   and conflict-free target advancement does not invalidate an unchanged reviewed head.

## Affected Files

- `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`
- `.agents/tasks/completed/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
- `.agents/tasks/MCP-2522-add-a-safe-stdio-mcp-client-transport.md`
- `.agents/tasks/MCP-2525-bound-mcp-results-and-spill-oversized-output-securely.md`
- `.agents/tasks/MCP-2533-add-authenticated-loopback-streamable-http-mcp-hosting.md`
- `.agents/spec-docs/todo/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`

No runtime file changes are authorized by this Agreement checkpoint. Each child spec must replace its investigation targets with an exact affected-file list before that child enters implementation.

## Completion Criteria

- [ ] TC-01: Direct review confirms one exact parent/child projection for the four direct Tasks and no nested AGREEMENT ownership.
- [ ] TC-02: Direct review confirms required metadata, child uniqueness, and dependency order in the five fixed records.
- [ ] TC-03: Observable: the approved decision and user authorization remain recorded here; no deleted multi-gate lifecycle is required before a child starts its own implementation.
- [ ] TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0 for the planning checkpoint.
- [ ] TC-05: The final parent audit reads all twelve retained Task records and their merged evidence, and proves no source-register row is closed only by a planning or administrative disposition.
- [ ] TC-06: Observable: selected native host evidence and its fail-closed summary are required by
      `pr-validation`, the four repository/live required contexts agree, and final integration remains
      unmerged pending the user's decision. This integration does not activate a fifth required context.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                             | Notes                                                                                                                                  |
| ----- | -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Agreement projection | Direct fixed-record review                                                                  | Verifies the direct child list and paired spec projection; existing Agreements are source-register prerequisites, not nested children. |
| TC-02 | Task graph contract  | Direct fixed-record review                                                                  | Verifies metadata, child uniqueness, and dependency graph integrity.                                                                   |
| TC-03 | Decision boundary    | Approved document plus recorded user authorization                                          | No deleted compatibility gate or new runtime authorization is implied.                                                                 |
| TC-04 | Planning regression  | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`              | Validates the complete documentation checkpoint rather than a source-code path.                                                        |
| TC-05 | Delivery audit       | Read source Issues, Task/spec records, merged PR evidence, and executable scenario receipts | Manual final audit because it spans independently released outcomes and cannot be represented by one unit test.                        |
| TC-06 | Operational rollout  | Selected native evidence, aggregate verdict, and live four-context comparison               | Selected native failures block the aggregate; conflict-free base movement does not invalidate an unchanged head.                       |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

Not applicable.

**Reason:** This Agreement coordinates child ownership, dependency evidence, and the final required-check
rollout; it exposes no independent runnable product behavior. Every direct child must author, execute,
and record its own product-surface scenario before it becomes terminal.

## Tasks

Paired parent Task: `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`.

- [x] PAYLOAD-2153 — done — `.agents/tasks/completed/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
- [ ] MCP-2522 — todo — `.agents/tasks/MCP-2522-add-a-safe-stdio-mcp-client-transport.md`
- [ ] MCP-2525 — todo — `.agents/tasks/MCP-2525-bound-mcp-results-and-spill-oversized-output-securely.md`
- [ ] MCP-2533 — todo — `.agents/tasks/MCP-2533-add-authenticated-loopback-streamable-http-mcp-hosting.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Failed criteria:**

- Decision references the trade-off that drove the choice: the Decision selects Alternative 3 and names the boundary-preservation benefits, but does not explicitly accept its four-child design/approval/verification cost and delayed umbrella closure in exchange.
  **Required action:** State that trade-off explicitly in the Decision.
- Each criterion uses Command form or Observable behavior form (no vague language): TC-03 requires `gate.mjs judge --gate GATE-WRITE` to exit 0, but the L2 mechanical judge returns exit 2 while its seven semantic criteria are pending; it therefore cannot demonstrate the stated full-gate outcome.
  **Required action:** Replace TC-03 with a verifiable two-stage GATE-WRITE outcome that distinguishes the mechanical check from the guardian verdict.

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this is the entry gate; the document remains in `.agents/spec-docs/draft/` with `status: draft`.
- GATE-WRITE — File begins with YAML frontmatter: PASS — a delimited frontmatter block begins at line 1.
- GATE-WRITE — `status: draft` is present: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is permitted: PASS — frontmatter declares `type: AGREEMENT`.
- GATE-WRITE — `tags:` is present: PASS — frontmatter declares three tags.
- GATE-WRITE — Problem has a concrete symptom: PASS — four direct security/data outcomes under issue #2525 lack Task owners, allowing one opaque transport effort to leave a filesystem, subprocess, result-lifecycle, or listener-admission boundary unowned.
- GATE-WRITE — Problem has a reproduction condition: PASS — it occurs when planning begins from the umbrella Issue alone and treats its six rows as one implementation.
- GATE-WRITE — Problem is specific and free of prohibited placeholders: PASS — the mechanical judge found no `TBD` or `TODO` and four substantive sentences.
- GATE-WRITE — Prior Art Research section is present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated: PASS — the mechanical judge accepted the cited MCP, Claude Code, SEP-1024, and MCP C# documentation sources.
- GATE-WRITE — Research waiver/substantiation requirement: PASS — the cited sources substantiate the section; no waiver is needed.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — the four sources' separate authority boundaries directly support rejecting the monolithic transport alternative and choosing a coordination-only Agreement with independently verified children.
- GATE-WRITE — Architecture checklist is complete: PASS — all five displayed items are checked.
- GATE-WRITE — Sibling scan has evidence: PASS — the checked item names the two retained Agreements, `AGREEMENT-2520`, session external-payload owners, and MCP tool/transport seams.
- GATE-WRITE — Alternatives have Pro/Con analysis: PASS — all three alternatives provide both.
- GATE-WRITE — Decision states the driving trade-off: PASS — it explicitly accepts four separate L2 designs, approvals, verification cycles, and a later umbrella close in exchange for preserving the four independent security boundaries.
- GATE-WRITE — New-surface placement: PASS (N/A) — this coordination-only Agreement authorizes no runtime change, package, app, presentation/interface surface, or layer/product-family reclassification; each child must make and validate its own placement decision before implementation.
- GATE-WRITE — Completion-criteria identifiers: PASS — TC-01 through TC-05 are all prefixed `TC-NN`.
- GATE-WRITE — Completion-criteria coverage: PASS — TC-01 and TC-02 cover the exact parent/child and Task-graph ownership, TC-03 covers the two-stage document gate, TC-04 covers the planning checkpoint, and TC-05 covers the final merged-evidence audit across the retained delivery outcomes.
- GATE-WRITE — Completion-criteria form: PASS — every TC specifies either a named command with an expected result or a concrete observable audit/gate outcome; TC-03 correctly distinguishes the mechanical result from the guardian verdict.
- GATE-WRITE — Forbidden vague criterion phrases: PASS — the mechanical judge found none.
- GATE-WRITE — Test Plan section exists: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan coverage matches Completion Criteria: PASS — five rows correspond to TC-01 through TC-05.
- GATE-WRITE — Test Plan rows are actionable: PASS — each has a non-empty test type, tool/approach, and no `TBD`.
- GATE-WRITE — Manual-test notes requirement: PASS — there are no rows whose tool is `manual`.
- GATE-WRITE — Tasks section exists: PASS — it names all four direct child Task placeholders.
- GATE-WRITE — Evidence Log initial-state requirement: PASS — the mechanical judge found one prior GATE-WRITE FAIL entry and no later-gate evidence, which is valid for this re-run.
- GATE-WRITE — No body status/classification sections: PASS — the mechanical judge found neither.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` reported 20 PASS, 0 FAIL, and the seven semantic criteria recorded above as guardian residue.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `13c4be8e87b6eb7ad24e758e952733b139f002c6` (staged before this evidence entry)

GATE VERDICT: PASS

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — this is the entry gate, so no prior gate is required; the document is still `status: draft` in the draft folder until the orchestrator advances it.
- GATE-WRITE — Concrete symptom: PASS — the Problem names the four exact source outcomes that lacked direct Task owners and the resulting risk that one transport effort leaves a filesystem, subprocess, result-lifecycle, or listener-admission boundary unowned.
- GATE-WRITE — Reproduction condition: PASS — the Problem states that the gap appears when planning starts from issue #2525 alone and treats its six source rows as one implementation.
- GATE-WRITE — Research feeds the Decision: PASS — the cited MCP/Claude/SEP-1024 sources distinguish filesystem authority, local-process authority, result lifecycle, and HTTP admission; the Alternatives and Decision use that evidence to reject the monolithic option and select independently verified child boundaries.
- GATE-WRITE — Decision trade-off: PASS — it explicitly accepts four L2 design, approval, verification, and closeout cycles in exchange for retaining the four independently testable security boundaries.
- GATE-WRITE — New-surface placement: PASS (N/A) — this coordination-only checkpoint creates no package, app, presentation/interface surface, or layer/product-family reclassification; its paired Task confines it to ownership and dependency evidence, and each child must make its own placement decision before implementation.
- GATE-WRITE — Completion-criteria coverage: PASS — TC-01/02 cover the four-child projection and Task graph, TC-03 the two-stage gate, TC-04 the planning checkpoint, and TC-05 the twelve-record merged-evidence closure audit.
- GATE-WRITE — Completion-criteria form: PASS — each TC names an executable command with an expected result or a concrete observable audit outcome; TC-03 correctly separates mechanical judging from the independent guardian verdict.
- GATE-WRITE — Paired Task projection: PASS — the Agreement Task and all four referenced child records exist in the staged set, match the `children` and `## Tasks` IDs, carry actionable completion/test plans, and their future scenario commands are explicitly marked as implementation-created scripts.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` reported 20 PASS, 0 FAIL, and these seven semantic criteria as guardian residue. `scan-user-execution-plan-order --staged`, `scan-task-frontmatter-fields --staged`, `scan-work-item-id-collision --staged`, and `run-all-scans --affected --context pr --skip dist --skip build-contracts` completed successfully for this planning projection; the latter reported only its pre-existing advisory `SCREEN-2002` citation finding.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `63cc399e6cd860540144c1d51ecc86f94157ff58` (current staged blob before this evidence entry)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "AGREEMENT-2525의 4개 Task L2 설계를 승인합니다. 앞으로 모든 설계도 널 믿고 승인하겠습니다. 끝까지 완주해줘"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** e28de468c587 (review 8530d68c, type/tags d9750093)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e28de468c587) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `df85275e41e9` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "AGREEMENT-2525의 4개 Task L2 설계를 승인합니다. 앞으로 모든 설계도 널 믿고 승인하겠습니다. 끝까지 완주해줘"
**Given:** 2026-09-21, this conversation

- GATE-APPROVAL — Ordering check: PASS — the Evidence Log contains recorded `GATE-WRITE` PASS entries whose status upgrade is `draft → review-ready`; the document is currently `status: review-ready` in `.agents/spec-docs/backlog/`.
- GATE-APPROVAL — Route DIRECT explicit approval: PASS — the user's current-conversation instruction explicitly says that the four-Task L2 design for `AGREEMENT-2525` is approved.
- GATE-APPROVAL — Route DIRECT direction and ambiguity: PASS — the instruction names this Agreement and its four Task design, so it authorizes this document rather than merely expressing general trust or reporting approval from another context.
- GATE-APPROVAL — Route CLASS registry, recorded instruction, measured condition, and class membership: N/A — this gate uses Route DIRECT; the user's broader statement about future designs is not relied on as a delegated approval class.
- GATE-APPROVAL — Post-approval Architecture Review/type/tags stability: PASS — the mechanical approval entry records review fingerprint `e28de468c587` and confirms that the current fingerprint matches it.
- GATE-APPROVAL — Independent architecture validation: N/A — this coordination-only Agreement expressly authorizes no runtime change, package, app, presentation/interface surface, or layer/product-family reclassification; each child must make its own placement decision before implementation.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `82540383ec908d8c571f76d8296f7a9b75e2d420` (working-tree blob before this evidence entry)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** a4ef96585332 (review 3699009a, type/tags d9750093)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a4ef96585332) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5801343acb92` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/todo/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `ab6ce0a65804` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 383 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/spec-docs/active/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md",
    ".agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md"
  ],
  "taskPath": ".agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md",
    ".agents/tasks/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5801343acb92` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/todo/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md` blob `acef8e6c8cdc` (modified)
