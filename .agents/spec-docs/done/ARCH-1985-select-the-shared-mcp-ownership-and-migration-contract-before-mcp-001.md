---
status: done
type: INFRA
tags: [mcp, architecture, typescript]
lane: L2
---

# ARCH-1985: select the shared MCP ownership and migration contract before MCP-001

Paired with
`.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`.
Arising from [issue #1985](https://github.com/woojubb/robota/issues/1985) and its foundational re-plan
[record](https://github.com/woojubb/robota/issues/1985#issuecomment-5754525322).

## Problem

MCP-001 cannot start from `origin/develop@5801343ac` without a product architecture owner. The private
`agent-tool-mcp` package owns an HTTP-only configuration and activation policy but has no deployable
product consumer; `agent-core` separately exports an incompatible MCP config/factory contract with no
production caller; framework settings omit `mcpServers`; and the activation registry has no canonical
definition producer. The DAG MCP node independently constructs the official SDK Client plus HTTP and
stdio transports, so simply renaming the first package would leave a parallel client owner.

AGREEMENT-014 legitimately owns the existing MCP-001 through MCP-005 relationship, but its approved scope
is administrative Issue-to-Task migration and explicitly makes no product, package, API, or dependency
decision. A proposed replacement parent, AGREEMENT-1985, was rejected before commit by the repository's
atomic Agreement invariant: `agreementPrelude()` requires a new parent and every declared child Task to be
newly added together, while MCP-001 through MCP-005 already exist and are bound by their source Issues.
Reproduce the governance failure by staging a new Agreement that names those five Tasks and running
`node scripts/harness/scan-user-execution-plan-order.mjs --staged`; it reports that every child must
resolve to one newly staged Task. Product architecture therefore needs a non-parent prerequisite rather
than a second relationship owner.

## Prior Art Research

- The current [MCP architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture)
  assigns client creation, lifecycle, permissions, and consent to the host. Robota therefore needs one
  host-owned contract below settings and presentation adapters.
- The current [MCP TypeScript SDK client guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)
  makes `connect()` the activation boundary. Definition parsing and management must not cross it.
- The current [Claude Code MCP reference](https://code.claude.com/docs/en/mcp) demonstrates named scopes,
  whole-entry precedence, declared-field environment templates, foreign `mcpServers` import, reversible
  disablement, and secret-safe management output.
- [Issue #1985](https://github.com/woojubb/robota/issues/1985) selects a shared lower client seam and
  requires DAG and agent products to be sibling consumers; [issue #2521](https://github.com/woojubb/robota/issues/2521)
  forbids two authoritative client stacks, while [issue #2522](https://github.com/woojubb/robota/issues/2522)
  separately owns stdio subprocess security.
- Repository Agreement precedent and `scan-user-execution-plan-order.mjs` require atomic creation of a
  parent with its new children. Existing-task sequencing instead uses ordinary `depends_on` prerequisites.

Adopt one lower host-owned MCP seam, whole-entry resolution, non-activating inspection, and the existing
Task dependency mechanism. Adapt the scope vocabulary so Robota `project-local` maps to local and managed
configuration wins. Reject field-level merges, fallback past malformed higher winners, ambient secret
expansion in management output, a replacement parent over existing Tasks, and a policy exception that
would weaken atomic Agreement creation.

## Architecture Review

### Affected Scope

- `.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md` — durable product decision.
- This ARCH-1985 Task/spec pair — non-parent architecture prerequisite.
- `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` — add the direct
  dependency on ARCH-1985; later children remain transitively ordered through existing edges.
- `.agents/tasks/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md` and its paired spec —
  existing relationship owner, intentionally unchanged.
- `packages/agent-tool-mcp/` → `packages/agent-mcp/` in MCP-001, including manifest, exports, tests,
  examples, activation types, and package contracts.
- `packages/agent-core/` and `packages/agent-playground/` — remove the duplicate exported config/factory
  contract and the unreferenced, incompatible `null`-returning playground stub in MCP-001.
- `packages/agent-framework/`, `packages/agent-command/`, and `packages/agent-cli/` — generic adapters,
  existing `/mcp` metadata/effects, and concrete composition/presentation respectively.
- `packages/dag-nodes/mcp-tool/` — migrate SDK Client and Streamable HTTP mechanics to the shared owner in
  MCP-002; fail closed for stdio until MCP-2522 restores the admitted shared path.
- `packages/agent-transport-mcp/` — unchanged opposite-direction MCP server adapter.
- Issue #1985 and umbrella issue #2525 — record ARCH-1985 as the prerequisite while retaining
  AGREEMENT-014 as the five-child relationship owner.

### Alternatives Considered

1. **Keep product policy in `agent-framework`.**
   - Pro: settings, plugin inputs, workspace authority, and command-host ports already exist there.
   - Con: a generic assembly package would own protocol-domain identity and lifecycle; lower DAG/client
     code could not consume it without reversing dependency direction.
2. **Create a separate configuration package beside `agent-tool-mcp`.**
   - Pro: avoids an immediate rename.
   - Con: preserves two MCP owners and requires a facade before official-SDK client work begins.
3. **Rename/reclassify private `agent-tool-mcp` to `agent-mcp`, remove duplicate core/playground
   contracts, and grow one owner through the existing MCP Tasks (product choice).**
   - Pro: produces one dependency-safe owner for definitions, activation identity, client/catalogue
     lifecycle, and existing tests without publishing an unfinished package.
   - Con: MCP-001 carries an atomic rename and approved breaking cleanup; MCP-002 must also migrate the
     DAG HTTP client while explicitly deferring stdio restoration to MCP-2522.
4. **Record choice 3 in a new Agreement that adopts MCP-001 through MCP-005.**
   - Pro: appears to place product architecture and child projection under one new record.
   - Con: violates the atomic Agreement invariant and duplicates the valid AGREEMENT-014 relationship.
5. **Create five replacement child Tasks or amend the harness to permit adoption.**
   - Pro: either route could make a new parent mechanically possible.
   - Con: replacement Tasks break stable source identity; a policy change weakens a deliberate lifecycle
     invariant and introduces multiple-parent semantics for a one-off need.

### Decision

Choose product alternative 3 and governance Option A: ARCH-1985 is a non-parent architecture
prerequisite, ADR-005 is its durable decision, and AGREEMENT-014 remains the unchanged relationship owner
for MCP-001 through MCP-005. Add `ARCH-1985` to `MCP-001.depends_on`; the existing child dependency graph
orders MCP-002 through MCP-005 transitively. Do not create replacement child Tasks, rewrite
AGREEMENT-014's approved decision, or change the Agreement gate.

MCP-001 atomically renames the private package and npm identity to `@robota-sdk/agent-mcp`. It becomes the
sole owner of raw/validated/resolved server definitions, source provenance and shadow metadata, strict
foreign decoding, environment-template materialization, redacted management projections, reversible
disable overlays, activation identities/fingerprints, and pure typed management results. It absorbs the
current activation request/registry types into one transport-neutral identity; an HTTP endpoint is not
required for stdio. Under the direct approval recorded in this conversation, MCP-001 removes
`agent-core.IMCPToolConfig` and `IToolFactory.createMCPTool()` without a facade and removes or replaces the
unreferenced playground stub. The package remains private through MCP-001.

The dependency direction is `agent-mcp → agent-core`. Public `agent-framework` keeps generic
settings/plugin/workspace and command-host ports and does not import or re-export private `agent-mcp`
types. `agent-command` extends the existing `/mcp`; `agent-cli` composes the lower owner and renders
secret-free results. This mirrors the existing `agent-session` lower lifecycle/neutral-port owner beneath
framework interpretation and CLI presentation; the preset data/application/command split corroborates
the direction. No sibling-product dependency is introduced.

MCP-002 publishes `agent-mcp`, adds the official SDK Client, Streamable HTTP, discovery/bootstrap,
connection lifecycle, and the first product vertical slice. It migrates the DAG node's direct SDK Client
and HTTP mechanics so `dag-node-mcp-tool → agent-mcp`, leaving only DAG configuration, validation/error
projection, and result mapping. The current DAG-local stdio path becomes a typed
unsupported-pending-MCP-2522 result before environment access, transport construction, network action, or
process spawn. MCP-2522 alone adds the admitted shared `StdioClientTransport` adapter and restores DAG
stdio. The opposite-direction `agent-transport-mcp` remains independent.

MCP-001 resolves complete entries by `managed > local > project > user > plugin`, maps existing
`project-local` to local, and fails closed when a malformed or unresolved higher winner shadows a lower
entry. Source templates remain separate from transient activation material. Diagnostics identify
source/server/field paths without echoing literal or expanded credentials, header values, or sensitive
URL components. Parse, import, resolve, list, get, and configuration status never connect or spawn.

**Delivery mode:** `single`

Validated recommendation:

- Final product review: `REVIEW VERDICT: ENDORSE` after explicit DAG ownership and MCP-002/MCP-2522
  corrections; it validated the lower product family, `agent-session` analog, acyclic sibling-consumer
  graph, independent server direction, and no-spawn degradation barrier.
- Planning-shape review: `REVIEW VERDICT: ENDORSE` for ARCH-1985; it rejected duplicate replacement Tasks
  and a harness-policy exception because the existing Agreement and normal dependency mechanism already
  provide the correct owners.
- Approval preservation: the user directly approved the package rename, exported-contract removal,
  ADR-005, DAG/CLI composition, and outer integration boundary. This re-plan changes only the uncommitted
  administrative wrapper, and the user's standing instruction authorizes the independently endorsed
  correction.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — durable decision, lower MCP owner, core/playground duplicates,
      generic framework/command/CLI adapters, DAG consumer, and independent server direction are named.
- [x] Sibling scan 완료 — issues #1985/#2519/#2521/#2522, AGREEMENT-014, MCP-001 through MCP-005,
      MCP-2522, package manifests/imports, settings/plugin sources, `/mcp`, activation registry, DAG SDK
      client, and architecture maps were inspected.
- [x] 대안 최소 2개 검토 완료 — five product/governance alternatives state concrete benefits and costs.
- [x] 결정 근거 문서화 완료 — correctness requires one lower owner and stable Task identities; diff size
      is not used to choose the design.
- [x] New-surface placement: `agent-session` is the closest lower neutral-contract/host-adapter analog;
      `agent-mcp` depends on shared core, while CLI and DAG are sibling consumers and the server adapter
      remains independent.

## Fallback & Degradation Declaration

MCP-002 intentionally makes DAG stdio execution unavailable at its integration checkpoint instead of
publishing the current unaudited local spawn path. A stdio request returns a typed
unsupported-pending-MCP-2522 result before transport/process/environment/network effects. MCP-2522 alone
restores stdio with activation-before-spawn, executable/argument authority, environment/cwd containment,
and deterministic child lifecycle. This intermediate state remains on integration branches: the enclosing
AGREEMENT-2525 final PR cannot merge to `develop` before MCP-2522 restores and verifies the shared path.

## Solution

1. Pass ARCH-1985's own L2 gates and accept ADR-005 under the existing direct approval.
2. Commit the exact Task/spec planning checkpoint before changing ADR-005 or existing Task dependencies.
3. Add ARCH-1985 to MCP-001's dependencies, keep AGREEMENT-014 unchanged, and verify the transitive graph.
4. Update and read back issue #1985/#2525 execution maps after repository evidence is durable.
5. Complete this architecture unit, merge it to `develop`, then resume the existing AGREEMENT-014 child
   stream with MCP-001 from a base containing the accepted prerequisite.

## Affected Files

- `.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`
- `.agents/spec-docs/{draft,backlog,todo,active,done}/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`
- `.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md`
- `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`
- GitHub issues #1985 and #2525

Downstream implementation governed by this decision touches `packages/agent-tool-mcp/` →
`packages/agent-mcp/`, `packages/agent-core/`, `packages/agent-playground/`, `packages/agent-framework/`,
`packages/agent-command/`, `packages/agent-cli/`, and `packages/dag-nodes/mcp-tool/` in their existing Tasks.

## Completion Criteria

- [x] TC-01: Observable: ADR-005 is `accepted`, records the directly approved package/contract decision,
      and `node scripts/harness/check-adr-completeness.mjs` exits 0.
- [x] TC-02: Observable: MCP-001 declares `depends_on: [ARCH-1985]`; MCP-002 through MCP-005 retain their
      existing dependency edges and are transitively ordered without replacement child Tasks.
- [x] TC-03: Command: `git diff origin/develop -- .agents/tasks/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md .agents/spec-docs/active/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md`
      prints nothing, while issue #1985/#2525 read-back names ARCH-1985 as the prerequisite and retains
      AGREEMENT-014 as relationship owner.
- [x] TC-04: Observable: ADR-005 and this Decision name the single lower owner, core/playground cleanup,
      generic framework/command/CLI boundary, DAG HTTP migration, no-spawn MCP-002 stdio state,
      MCP-2522-only restoration, independent server direction, precedence, redaction, and non-activating
      inspection.
- [x] TC-05: Command: Task/spec lifecycle, task-plan, ADR, formatting, diff, and affected repository scans
      exit 0 before MCP-001 implementation starts.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                                                        | Notes                                                                                          |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| TC-01 | Architecture          | ADR completeness and exact status/content inspection                                                   | Test skipped: documentation-only decision; scanner and content assertion are the verification. |
| TC-02 | Dependency graph      | Parse Task frontmatter and traverse MCP-001 through MCP-005 dependencies                               | Test skipped: metadata-only graph; exact traversal command is recorded.                        |
| TC-03 | History/external map  | Exact AGREEMENT-014 no-diff command plus authenticated issue read-back                                 | Test skipped: immutable-history and remote-state assertions are not runtime behavior.          |
| TC-04 | Architecture boundary | Structured assertions over ADR/Decision owner, DAG, stdio, server, precedence, and side-effect clauses | Test skipped: decision-text contract; structured assertion command is recorded.                |
| TC-05 | Repository gate       | Lifecycle/task-plan/ADR/format/diff scans and affected `run-all-scans`                                 | Test skipped: existing repository scanners are the executable verification surface.            |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** ARCH-1985 records a package-ownership, dependency, and migration decision only. It changes no
CLI, TUI, browser, or public SDK behavior itself; MCP-001, MCP-002, and MCP-2522 own the executable product
scenarios for configuration, HTTP use, and restored safe stdio execution.

## Tasks

- [x] `.agents/tasks/completed/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate with no predecessor; the document is
  in `.agents/spec-docs/draft/` and declares `status: draft`.
- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited
  `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: INFRA` is one of the 11 allowed
  values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem identifies competing MCP ownership,
  missing host integration, a parallel DAG client stack, and the Agreement prelude rejection that blocks
  MCP-001 from starting with an authorized architecture owner.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem specifies staging a new Agreement
  over the five existing MCP Tasks and running `scan-user-execution-plan-order.mjs --staged`, including
  the resulting requirement that every child resolve to one newly staged Task.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem has
  neither forbidden token and provides seven concrete sentences covering package, dependency, and gate
  conditions.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research`
  is present.
- GATE-WRITE — Prior Art Research is substantiated by a permitted source or a no-comparable-reference
  result: PASS — it cites the MCP architecture specification, official TypeScript SDK client guide,
  Claude Code MCP reference, repository issues, and the repository Agreement precedent.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the section is substantiated
  by permitted documentation sources, so the alternative waiver route is not required.
- GATE-WRITE — Research findings feed `Alternatives Considered` and `Decision`: PASS — MCP host/client
  lifecycle guidance, the SDK activation boundary, configuration precedent, issue ownership, and the
  Agreement invariant directly produce the lower-owner, side-effect, precedence, and ordinary-dependency
  choices in the alternatives and decision.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed checklist
  items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the
  checked entry names the related issues, existing Agreement and MCP Tasks, package/import surfaces,
  activation registry, DAG SDK client, and architecture maps inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — five numbered
  alternatives each state a concrete benefit and cost.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts an atomic
  package rename, breaking duplicate-contract cleanup, and temporary stdio degradation to obtain one
  dependency-safe owner while preserving stable Task identities and the Agreement invariant.
- GATE-WRITE — New-surface placement conditional: PASS — the reclassified `agent-mcp` surface names
  `agent-session` as the analogous lower lifecycle and neutral-port layer, depends only on shared core,
  and keeps CLI and DAG as sibling consumers rather than introducing a sibling-product dependency; the
  reverse-direction server adapter remains independent.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: PASS — all five criteria are prefixed
  `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the
  accepted ADR and direct contract decision; TC-02 the dependency graph; TC-03 unchanged AGREEMENT-014
  ownership and issue maps; TC-04 the complete product, DAG, stdio, server, precedence, redaction, and
  side-effect boundary; and TC-05 the lifecycle and repository verification gates.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every criterion requires
  inspectable status or content, exact dependency or diff results, authenticated issue read-back, or
  named commands with exit expectations.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`,
  `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five
  TC criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all
  five rows satisfy the required fields and contain no `TBD`.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual
  rows, so no manual-test justification is required.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the exact paired
  ARCH-1985 Task record.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical
  dry-run observed zero prior entries and no later-gate evidence.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md --lane L2 --dry-run` reported 20 PASS, 0 FAIL, and seven semantic PENDING-GUARDIAN criteria; the independent guardian judged all seven PASS above.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `5801343acb92e3807c6416912a928a7b8fbe36ac` · base `origin/develop@5801343acb92e3807c6416912a928a7b8fbe36ac` · document `.agents/spec-docs/draft/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `eff85964a0e75f6e802e669b16bcba86a3fc2684` (untracked before this evidence entry)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 4754c1cce1ab (review 44903ae5, type/tags bbd04dd5)

- GATE-APPROVAL — Ordering check: PASS — the first recorded GATE-WRITE result is PASS, the document
  declares `status: review-ready`, and it is located in `.agents/spec-docs/backlog/`, which is the
  required input state for this gate.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  the recorded instruction begins with “모두 승인하고” in direct response to the concrete recommendation
  covering the package rename, duplicate exported-contract removal without a compatibility facade,
  ADR-005, and the DAG/CLI/outer-integration boundary. ARCH-1985 records those same decisions without a
  material addition; the later administrative re-plan only replaces an invalid uncommitted Agreement
  wrapper with the independently endorsed non-parent prerequisite. The decision therefore does not rely
  on the instruction's future-looking clause to approve a new product or published-contract choice.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — the recorded route is
  DIRECT, so no delegated class is asserted or required.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (4754c1cce1ab) equals the document's current fingerprint
- GATE-APPROVAL — Independent architecture validation conditional: PASS — this Evidence Log records the
  independent `proposal-reviewer` product verdict `REVIEW VERDICT: ENDORSE` dated 2026-09-21. That review
  explicitly validated `agent-mcp` as the lower product-family owner mirroring `agent-session`, reuse at
  the shared `agent-core` contract level, the acyclic CLI/DAG sibling-consumer graph, and the independent
  reverse-direction server adapter. A separate independent planning-shape recheck also returned
  `REVIEW VERDICT: ENDORSE`, selected non-parent ARCH-1985 Option A, retained AGREEMENT-014 as relationship
  owner, and confirmed that the directly approved product decisions were unchanged.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5801343acb92` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/backlog/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `766507eb0241` (untracked)

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc .agents/spec-docs/backlog/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md --lane L2 --dry-run` reported six PASS, zero FAIL, and three semantic PENDING-GUARDIAN criteria; the independent guardian judged the direct-approval and architecture-validation criteria PASS and the Route CLASS boundary criterion N/A above.

**Semantic judged by:** independent `backlog-gate-guard` evaluator
**Semantic judged at:** HEAD `5801343acb92e3807c6416912a928a7b8fbe36ac` · base `origin/develop@5801343acb92e3807c6416912a928a7b8fbe36ac` · document pre-evidence blob `d7d3493152783ab0d4b8699c88cdf96709ccd166`

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 489 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md",
  "specPath": ".agents/spec-docs/todo/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md",
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
    ".agents/spec-docs/todo/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md",
    ".agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3e34773ca75b` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/todo/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `38e091097e2f` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `node scripts/harness/check-adr-completeness.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 5 ADR documents
ADR completeness scan passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `c96f44aee3f8` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `set -e; test "$(sed -n "s/^depends_on: //p" .agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md)" = "[ARCH-1985]"; test "$(sed -n "s/^depends_on: //p" .agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md)" = "[MCP-001]"; test "$(sed -n "s/^depends_on: //p" .agents/tasks/MCP-003-add-an-mcp-connection-and-capability-catalog-supervisor.md)" = "[MCP-002]"; test "$(sed -n "s/^depends_on: //p" .agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md)" = "[MCP-002, MCP-003]"; test "$(sed -n "s/^depends_on: //p" .agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md)" = "[MCP-002, CORE-040]"; printf "MCP-001 -> ARCH-1985; MCP-002 -> MCP-001; MCP-003 -> MCP-002; MCP-004 -> MCP-002,MCP-003; MCP-005 -> MCP-002,CORE-040; all reach ARCH-1985\n"`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
MCP-001 -> ARCH-1985; MCP-002 -> MCP-001; MCP-003 -> MCP-002; MCP-004 -> MCP-002,MCP-003; MCP-005 -> MCP-002,CORE-040; all reach ARCH-1985
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `f263ea5ff868` (modified)

### [GATE-COMPLETE: TC-03] — ❌ FAIL | 2026-09-21

**Command:** `set -e -o pipefail; git diff --quiet origin/develop -- .agents/tasks/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md .agents/spec-docs/active/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md; arch1985_issue1985=$(gh issue view 1985 --repo woojubb/robota --json body --jq .body); arch1985_issue2525=$(gh issue view 2525 --repo woojubb/robota --json body --jq .body); print -r -- "$arch1985_issue1985" | rg -Fq "ARCH-1985"; print -r -- "$arch1985_issue1985" | rg -Fq "AGREEMENT-014 remains the five-child relationship owner"; print -r -- "$arch1985_issue2525" | rg -Fq "architecture prerequisite `ARCH-1985`"; print -r -- "$arch1985_issue2525" | rg -Fq "existing client relationship stream `AGREEMENT-014`"; gh issue view 1985 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"; gh issue view 2525 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"`
**Exit:** 1
**Output:** (last 1 of 1 line(s))

```

```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `f1fe0b0b6e99` (modified)

### [GATE-COMPLETE: TC-03] — ❌ FAIL | 2026-09-21

**Command:** `set -e -o pipefail; git diff --quiet origin/develop -- .agents/tasks/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md .agents/spec-docs/active/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md; arch1985_issue1985=$(gh issue view 1985 --repo woojubb/robota --json body --jq .body); arch1985_issue2525=$(gh issue view 2525 --repo woojubb/robota --json body --jq .body); print -r -- "$arch1985_issue1985" | rg -Fq "ARCH-1985"; print -r -- "$arch1985_issue1985" | rg -Fq "AGREEMENT-014 remains the five-child relationship owner"; print -r -- "$arch1985_issue2525" | rg -Fq "Issue #1985 → architecture prerequisite"; print -r -- "$arch1985_issue2525" | rg -Fq "existing client relationship stream"; gh issue view 1985 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"; gh issue view 2525 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"`
**Exit:** 1
**Output:** (last 1 of 1 line(s))

```

```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `9ba3f6677207` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `set -e -o pipefail; git diff --quiet origin/develop -- .agents/tasks/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md .agents/spec-docs/active/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md; arch1985_issue1985=$(gh issue view 1985 --repo woojubb/robota --json body --jq .body); arch1985_issue2525=$(gh issue view 2525 --repo woojubb/robota --json body --jq .body); print -r -- "$arch1985_issue1985" | rg -Fq "ARCH-1985"; print -r -- "$arch1985_issue1985" | rg -Fq "remains the five-child relationship owner"; print -r -- "$arch1985_issue2525" | rg -Fq "Issue #1985 → architecture prerequisite"; print -r -- "$arch1985_issue2525" | rg -Fq "existing client relationship stream"; gh issue view 1985 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"; gh issue view 2525 --repo woojubb/robota --json url,updatedAt --jq "[.url,.updatedAt] | @tsv"`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
https://github.com/woojubb/robota/issues/1985	2026-09-21T03:35:17Z
https://github.com/woojubb/robota/issues/2525	2026-09-21T03:35:20Z
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `d35df78bf8fc` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-21

**Command:** `set -e; arch1985_docs=(.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md .agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md); rg -Fq "sole owner of MCP server definitions" $arch1985_docs; rg -Fq "IToolFactory.createMCPTool()" $arch1985_docs; rg -Fq "agent-framework" $arch1985_docs; rg -Fq "dag-node-mcp-tool" $arch1985_docs; rg -Fq "unsupported-pending-MCP-2522" $arch1985_docs; rg -Fq "MCP-2522 alone" $arch1985_docs; rg -Fq "agent-transport-mcp" $arch1985_docs; rg -Fq "managed > local > project > user > plugin" $arch1985_docs; rg -Fq "secret-free" $arch1985_docs; rg -Fq "never connect or spawn" $arch1985_docs; printf "10/10 architecture boundary assertions present across ADR-005 and ARCH-1985\n"`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
10/10 architecture boundary assertions present across ADR-005 and ARCH-1985
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `e1ea45b095ec` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-21

**Command:** `set -e; node scripts/harness/check-adr-completeness.mjs; node scripts/harness/scan-task-plan-items.mjs; node scripts/harness/scan-user-execution-plan-order.mjs; git diff --check; node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 10 of 147 line(s))

```
  }
}

Diagnostic report v1: 1 result(s), 1 non-clean.
ERROR harness.scan-finding.scan-c36-c2t-c2u-c2t-c36-c2t-c32-c2r-c2t-c19-c2z-c2x-c32-c2s-c19-c35-c39-c2p-c30-c2x-c2u-c2x-c2t-c2s [finding] scan:reference-kind-qualified
  evidence: Scan reference-kind-qualified exited with status 1.
  recommendation: Inspect the reference-kind-qualified scan output above.

44 scans passed, 1 skipped, 1 advisory failure(s) tolerated (pr context), 1 non-clean diagnostic result(s) reported (46 declared what they examined)
scan receipt NOT written: 1 advisory failure(s) were tolerated (reference-kind-qualified), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `ecf0815db82e` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-21

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Ordering check: PASS — the latest GATE-IMPLEMENT entry is PASS, the document declares
  `status: in-progress`, and it is located in `.agents/spec-docs/active/`.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete
  (`[x]`): PASS — the ARCH-1985 Task has five Plan items, TC-01 through TC-05, and all five are `[x]`;
  `node scripts/harness/scan-task-plan-items.mjs` examined 335 Task Plan sections and exited 0.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — the ARCH-1985 Plan contains no unchecked,
  blocked, or pending item, and the task-plan-items scan reported `task-plan-items scan passed.`
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS — the gate evaluator ran
  build-shaped command `pnpm build`, which exited 0; its two emitted ineffective-dynamic-import messages
  were warnings rather than failures.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS — the gate evaluator ran
  test-shaped command `pnpm test`, which exited 0; its captured tail shows `packages/agent-cli test: Done`.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-VERIFY --doc .agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md --lane L2 --verify-cmd "pnpm build" --verify-cmd "pnpm test"` reported three PASS, zero FAIL, and two PENDING-GUARDIAN criteria. The independent guardian inspected the exact Task Plan and the passing task-plan-items scan and judged both pending criteria PASS above.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `959cda45e8faf886f90dd157e71e0aaf8c959029` · base `origin/develop@5801343acb92e3807c6416912a928a7b8fbe36ac` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `547e8074d7679fd1457ddebe6ae75bd1228c215d` (modified)

GATE VERDICT: PASS

### [GATE-COMPLETE] — ✅ PASS | 2026-09-21

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-21; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `01ff7b328988` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-21

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-21; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `959cda45e8fa` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md` blob `99875c197b4c` (modified)
