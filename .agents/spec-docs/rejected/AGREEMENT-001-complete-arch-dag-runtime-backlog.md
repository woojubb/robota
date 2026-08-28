---
status: rejected
type: AGREEMENT
tags: [typescript, async, cli]
returned_to_issue: https://github.com/woojubb/robota/issues/2431#issuecomment-5454657040
---

# AGREEMENT-001: Complete the active ARCH, DAG, and RUNTIME task set

## Problem

The original twelve Task records under `.agents/tasks/` retained `todo` or `in-progress` status across the
ARCH, DAG, and RUNTIME areas. Several records describe partially landed stages, while others still
require contract, assembly, build, or verification work. The repository therefore advertises
foundational execution, cancellation, transport, DAG recovery, preset ownership, and headless-runtime
gaps even where part of the implementation has already shipped.

The reproduction condition is the current `origin/develop` tree on 2026-08-12: listing active
`ARCH-*.md`, `DAG-*.md`, and `RUNTIME-*.md` files yields twelve non-terminal records. Completion must
be judged against each record's own acceptance statements and current code, not by bulk-changing
frontmatter.

## Prior Art Research

Waived: this agreement consolidates execution of twelve existing, previously investigated Task
records and their recorded review findings. It introduces no new product direction; fresh market or
external-product research would not decide whether the repository's already-declared contracts are
implemented. Any individual Task whose premise proves stale returns to its recommendation gate
instead of inheriting a new design from this umbrella document.

## Architecture Review

### Affected Scope

- Preset and command-host ownership: `packages/agent-command`, `packages/agent-framework`,
  `packages/agent-cli`, `packages/agent-preset`, `packages/agent-product`,
  `packages/agent-transport-tui`.
- Execution-root and session contracts: `packages/agent-session`, `packages/agent-tools`,
  `packages/agent-executor`, `packages/agent-subagent-runner`, `packages/dag-core`,
  `packages/dag-nodes/*`.
- Transport contracts and adapters: `packages/agent-interface-transport`, `packages/agent-transport`,
  `packages/agent-transport-http`, `packages/agent-transport-mcp`, `packages/agent-transport-ws`,
  `packages/agent-transport-tui`, `packages/agent-transport-webrtc`,
  `packages/agent-transport-protocol`.
- DAG lifecycle and imports: `packages/dag-core`, `packages/dag-worker`, `packages/dag-runtime`,
  `packages/dag-framework`, `packages/dag-adapters-local`, `packages/dag-cli`,
  `packages/dag-orchestration-client`.
- Runtime identity, cancellation, and packaging: `packages/agent-core`, `packages/agent-session`,
  `packages/agent-framework`, `packages/agent-interface-transport`, `packages/agent-cli`,
  `apps/agent-app`, and the Bun distribution scripts used by those packages.
- Governing package SPEC files and relevant architecture-map documents for every changed contract.

### Alternatives Considered

1. Implement all twelve records as one undifferentiated patch. Pro: one final verification point.
   Con: hides dependency order, prevents meaningful red/green proof, and makes a failure impossible to
   attribute to one Task.
2. Execute dependency-ordered, reviewable slices while retaining this initiative-level completion
   audit. Pro: preserves each Task's contract and evidence while allowing shared DAG/runtime and
   transport/session changes to be sequenced. Con: requires repeated targeted verification and more
   explicit state tracking.
3. Close records whose notes say “complete” and defer all remaining implementation. Pro: quickly
   reduces the active count. Con: mistakes narrative progress for current-state proof and violates the
   done gate.

### Decision

Use alternative 2. First audit every Task against current code and reject stale premises. The ARCH-012
audit found two additional owner-level prerequisites: ARCH-019 corrects the sanctioned full session
factory before capability conformance is claimed, and ARCH-029 owns the distinct framework command-host
facade rather than hiding it inside the session-contract PR. Then execute
cohesive dependency-safe contract migrations, with shared contracts before consumers: session
capability before transport conformance; DAG execution context before DAG cancellation/root consumers;
turn identity before queue settlers. Slice boundaries follow ownership and the complete target design,
not diff size. Close a Task only after its engineering checks and user-execution scenario (when
applicable) produce concrete evidence. The recommendation is validated by tracing every affected
consumer named by TypeScript and by adversarial tests for missing identity, cancellation races,
process-global state leakage, stale task recovery, and absent containment roots.

Two conditional new-surface placements are part of that decision:

- **Session capability ports (TC-03)** mirror the existing `IInteractionChannel`,
  `ITerminalHandoff`, and `IPayloadChannelHost` pattern. They are additive members of the existing
  universal `agent-interface-transport` **contract-library family**, not a new product or presentation
  layer. `agent-framework` assembles or implements the shared contracts. The new session-facing
  capability modules in concrete `agent-transport-*` adapters consume the shared
  `agent-interface-transport` contract (and `agent-transport-protocol` where needed); this does not
  require unrelated TUI command, persistence, projection, or status-line code to stop using its
  legitimate framework contracts. The already contract-pure HTTP/MCP/WS/WebRTC packages remain
  contract-pure. No deployable sibling product (`agent-cli`, `agent-app`, or another product shell)
  owns or is imported to reuse these ports. Their test doubles remain on the contract package's
  `./testing` surface, following the existing conformant-double placement. The parallel
  `ICommandHostContext` capability decomposition stays in `agent-framework`, which owns the command
  host contract; ARCH-029 tracks that separate owner and it is not moved into the transport contract package.
- **Headless-only Bun entry (TC-07)** mirrors `agent-cli`'s existing process-entry → Node bundle → Bun
  compile distribution layer, while its runtime behavior reuses the already-landed
  `runServeMode` → `agent-framework.startRuntimeHost` seam. A CLI-owned, presentation-neutral
  **headless bootstrap/composition seam** becomes the single owner of the Robota product choices
  currently assembled above `runServeMode` (provider, store, subagent runner, command modules, host
  adapters, transport registry, preset, and memory options). Both the existing `--serve` dispatch and
  the new process entry call that seam, so assembly is not copied. Its product-family classification is a
  **Robota headless runtime-host deployment artifact / concrete local process-host adapter**, not a
  new app, SDK package, or presentation product. The entry imports the CLI-owned headless bootstrap,
  which delegates reusable lifecycle to `agent-framework.startRuntimeHost`; it must not import
  `cli.ts`, `bin.ts`, Ink/TUI rendering, or `agent-app`. `agent-app` continues to consume only the
  resulting executable resource, so it does not acquire a runtime dependency on a sibling product API.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — active Task families reviewed; TC-03 mirrors `IInteractionChannel`/`ITerminalHandoff`/`IPayloadChannelHost`, and TC-07 mirrors the existing agent-cli process-entry/Bun distribution layer plus shared `startRuntimeHost`
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Execute the twelve existing records without redefining their scope:

1. Reconcile each Task's claims with current code, accepted package SPECs, and already-landed tests.
2. Close DAG-001's durable recovery evidence; establish the trusted DAG execution context; establish
   one DAG advancement owner; then thread cancellation through that owner and node execution. Complete
   RUNTIME-006 after the turn-handle contract, complete ARCH-019 before ARCH-012, and complete ARCH-012
   before ARCH-011 and ARCH-029. Schedule the
   independent ARCH-009, ARCH-013, DAG-004, RUNTIME-002, and RUNTIME-005 migrations at dependency-safe
   points. Combine only steps that modify the same owner contract; each Task keeps independent
   acceptance and evidence.
3. Update governing SPECs before or with behavior/API changes, use red-green-refactor for every missing
   behavior, and run affected builds immediately after source changes.
4. Run each written user-execution scenario or record a justified not-applicable result. Static source
   inspection is not runtime evidence.
5. Run scoped harness verification during each slice and the CI-equivalent gate plus architecture
   conformance for the assembled initiative.
6. Respect the owner's revised temporary commit boundary: after 2026-08-12 10:30 KST, do not create commits.
   Keep changes on `feat/arch-dag-runtime-completion` until the owner resumes commits. Formal Task
   status changes and archival remain paired in the eventual completion commit.

## Affected Files

- `.agents/tasks/ARCH-*.md`
- `.agents/tasks/DAG-*.md`
- `.agents/tasks/RUNTIME-*.md`
- Package SPECs and source/test files discovered from each Task's `area` field and current dependency
  graph
- Relevant `.agents/specs/architecture-map/*.md` files when ownership or package boundaries change
- Changesets required by public package contract changes

## Completion Criteria

- [x] TC-01: ARCH-009's `/preset` surface uses the assembled instance registry, and two products in one process expose isolated preset sets without module-global registration.
- [x] TC-02: ARCH-010 carries a required, trusted absolute execution root through the DAG node execution path as well as the already-landed session/tool path; missing, empty, or relative roots fail closed, and LLM-authored `config.cwd` may only narrow within that root and never widen it.
- [ ] TC-03: ARCH-019 first makes the sanctioned full session double honest about submission identity and its declared nested-session surface. ARCH-012 then decomposes `IInteractiveSession` into reachable capability-scoped contracts; real sessions and test doubles conform without unchecked partial casts, absent capability is distinct from a provided-empty result, and the direct `IInteractiveSession` cast ratchet reaches zero. ARCH-029 separately decomposes `ICommandHostContext` into framework-owned command-host capability ports and removes its direct casts. ARCH-011 defines and verifies typed service/runner lifecycle and completion outcomes, registry startup/rollback ownership, TUI presentation reclassification, and the exact six-subject shared conformance roster while leaving protocol-specific admission, cancellation, disconnect, and wire-error policy with their owning packages.
- [ ] TC-04: ARCH-013 gives every supported `IResolvedPresetOptions` and reachable `ICreateSessionOptions` field one explicit projection/consumption owner or removes the unsupported field; projects resolved language, prompts, temperature, output limits, trust, tool allow/deny, and interactive `--system-prompt`, `--append-system-prompt`, `--task-file`, and `--json-schema` consistently through interactive, headless, serve, startup, and live `/preset`; supplies or deliberately removes the guardrail-registry and retrieval-adapter composition roots; and documents the legitimate distinction between registered guardrail implementations and hook-selected guardrail names rather than treating them as conflicting shapes.
- [ ] TC-05: DAG-001's recovery behavior is proven through the in-memory and SQLite queue-adapter recovery matrix from persisted abandoned work to terminal run advancement, and its exact executable commands, fixtures, cleanup, output, and exit evidence live in a durable in-repo user-scenario artifact.
- [ ] TC-06: DAG-004 routes every external-definition import boundary in dag-cli (including the named command siblings, runner dispatch, and MCP helpers) through the canonical validated import adapter and rejects malformed definitions consistently; the stale “eight commands” count is not used as a boundary.
- [ ] TC-07: RUNTIME-002 adds a CLI-owned presentation-neutral headless bootstrap shared by existing `--serve` and a second tsdown/Bun process entry; the artifact graph contains no Ink/TUI path, its `--serve` behavior is byte-for-byte observably equivalent, its measured binary is smaller than the full CLI binary, every supported target is built, and `agent-app` packages this headless artifact instead of the full CLI artifact.
- [ ] TC-08: RUNTIME-003 retains the landed TurnClaim/turn-handle correlation proofs and establishes exactly one DAG advancement owner across `WorkerLoopDriver`, prompt backend, and local runtime; the shared queue has exclusive ownership, prompt-backend work is owned and awaited during stop, and failures cannot escape through floating promises.
- [ ] TC-09: RUNTIME-004 retains the landed compaction-cancellation/history-preservation proof and propagates cancellation through DAG orchestration, worker admission, local runtime loops, timeout execution, and node lifecycle without starting further queued work after cancellation; the HTTP provider either gains a real end-to-end cancel endpoint or preserves its explicit unsupported rejection.
- [ ] TC-10: RUNTIME-005 retains the abortable approval-wait regression and gives the interactive execution state a single token/claim owner so a foreground command cannot clear another live turn's state or consume/drop queued input.
- [x] TC-11: RUNTIME-006 requires turn identity on every queued/settlement path, removes silent undefined settlement, and prevents public callers from forging internal resume identity.
- [ ] TC-12: every declared child Task record contains current engineering and user-scenario evidence, reaches a valid terminal status, and moves atomically to `.agents/tasks/completed/`.
- [ ] TC-13: `pnpm harness:conformance` and `pnpm harness:verify-like-ci` exit 0 on the assembled initiative, with any environment-only exclusions reported rather than inferred green.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                                                                              | Notes                                                                                                           |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| TC-01 | Agreement / integration  | agent-command and agent-cli Vitest integration tests                                                                                         | Exercise the shipped command path with two registries.                                                          |
| TC-02 | Agreement / contract     | dag-core/dag-node type tests plus containment and child-process integration tests                                                            | Prove trusted absolute root validation and that config cannot widen containment.                                |
| TC-03 | Agreement / conformance  | ARCH-019 double tests, session/command type tests, zero-cast ratchets, subset/absence tests, and shared transport-adapter conformance suite  | Cover both separately owned capability axes plus every concrete transport.                                      |
| TC-04 | Agreement / integration  | reverse option-reachability scan plus assembly-equivalence and TUI/headless/serve/live-preset tests                                          | Assert every supported field has a producer and consumer; unsupported fields are removed explicitly.            |
| TC-05 | Agreement / recovery     | persisted local- and SQLite-adapter restart scenarios plus DAG worker tests                                                                  | Record exact commands and terminal run/task evidence in a durable scenario artifact.                            |
| TC-06 | Agreement / CLI          | dag-cli process/integration tests and a complete import-boundary sibling scan                                                                | Include malformed active-status and unknown-shape fixtures plus one valid fixture.                              |
| TC-07 | Agreement / packaging    | dual tsdown/Bun builds, metafile/import-graph inspection, binary-size comparison, serve black-box equivalence, and app bundled-runtime smoke | Prove all targets use the headless artifact with no TUI/Ink graph.                                              |
| TC-08 | Agreement / async        | TurnClaim/handle regression plus prompt-backend, worker-loop-driver, and local-provider ownership tests                                      | Assert one `processOnce` owner, owned stop, error propagation, and bounded races.                               |
| TC-09 | Agreement / cancellation | compaction regression plus orchestration/worker/runtime/timeout/node cancellation integration tests                                          | Assert no post-cancel admission and preserve honest unsupported HTTP behavior unless capability is implemented. |
| TC-10 | Agreement / async        | approval-abort integration plus interactive controller claim regression tests                                                                | Reproduce `/compact` during a live prompt and queued-input ordering.                                            |
| TC-11 | Agreement / typescript   | type-level contract tests and RUNTIME-003 regression suites                                                                                  | Undefined settle calls must fail typechecking.                                                                  |
| TC-12 | Agreement / governance   | task evidence audit and task-archival harness scan                                                                                           | Status and move occur in the same resumed commit.                                                               |
| TC-13 | Agreement / CI           | `pnpm harness:conformance` and `pnpm harness:verify-like-ci`                                                                                 | Final broad gate after all targeted checks.                                                                     |

## Tasks

- [x] ARCH-009 — done — `.agents/tasks/completed/ARCH-009-preset-registry-through-command-host.md`
- [x] ARCH-010 — done — `.agents/tasks/completed/ARCH-010-execution-root-carried-by-no-contract.md`
- [x] ARCH-011 — done — `.agents/tasks/completed/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`
- [x] ARCH-012 — done — `.agents/tasks/completed/ARCH-012-interactive-session-god-contract.md`
- [x] ARCH-013 — done — `.agents/tasks/completed/ARCH-013-preset-to-session-options-projection-has-no-owner.md`
- [x] ARCH-019 — done — `.agents/tasks/completed/ARCH-019-interactive-session-getSession-contract-understated.md`
- [x] ARCH-029 — done — `.agents/tasks/completed/ARCH-029-command-host-capability-contracts.md`
- [x] INFRA-098 — done — `.agents/tasks/completed/INFRA-098-review-every-integration-base-child-pr.md`
- [x] INFRA-099 — done — `.agents/tasks/completed/INFRA-099-pr-base-aware-pre-push-verification.md`
- [x] DAG-001 — done — `.agents/tasks/completed/DAG-001-running-is-a-terminal-trap.md`
- [ ] DAG-004 — todo — `.agents/tasks/DAG-004-eight-cli-commands-open-code-the-import-adapter.md`
- [ ] RUNTIME-002 — todo — `.agents/tasks/RUNTIME-002-headless-only-bun-runtime-entry.md`
- [x] RUNTIME-003 — done — `.agents/tasks/completed/RUNTIME-003-no-turn-or-run-identity.md`
- [ ] RUNTIME-004 — in-progress — `.agents/tasks/RUNTIME-004-cancellation-declared-at-four-layers-honoured-at-none.md`
- [x] RUNTIME-005 — done — `.agents/tasks/completed/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md`
- [x] RUNTIME-006 — done — `.agents/tasks/completed/RUNTIME-006-turn-identity-is-optional-in-four-places.md`

This section is the lifecycle projection of the initiative Task's `children` declaration. Completion
Criteria above remain independent initiative evidence and are not inferred from these checkboxes.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-12

**Status remains:** draft
**Failed criteria:**

- New-surface placement (conditional): TC-03 introduces capability-scoped session interface surfaces and TC-07 introduces a headless-only Bun runtime entry, but the Sibling scan and Decision do not name the analogous existing layer each surface mirrors, do not state its product-family classification, and do not demonstrate that reuse remains at the shared contract/core level rather than depending on a sibling PRODUCT.
  **Required action:** Update the Sibling scan or Decision to identify the analogous existing layer and product-family classification for each new surface and show that reuse occurs through shared contract/core ownership without a sibling PRODUCT dependency.

### [GATE-WRITE] — ✅ PASS | 2026-08-12

**Status upgrade:** draft → review-ready
Frontmatter: valid opening YAML block contains `status: draft`, allowed single `type: AGREEMENT`, and a present `tags` field.
Problem: identifies the concrete wrong state of twelve non-terminal ARCH/DAG/RUNTIME records and reproduces it by listing the named Task families on the dated `origin/develop` tree; no TBD, TODO, or vague single-sentence description is present.
Prior Art Research: carries an explicit reasoned waiver because this agreement consolidates already-researched Task records, and that premise feeds the alternatives and the decision to reconcile current code before dependency-ordered execution.
Architecture Review Checklist: all four items are checked; the sibling scan records the reviewed Task families and the analogous surfaces; three alternatives each state a pro and con; the Decision selects alternative 2 based on dependency ordering, attribution, and verification trade-offs.
New-surface placement: TC-03 is classified as an additive universal contract-library surface mirroring existing interaction capability ports, with reuse owned by shared contracts and no sibling product import; TC-07 is classified as a headless runtime-host deployment artifact mirroring the existing process-entry/Bun distribution layer, reusing `startRuntimeHost` and explicitly excluding CLI/TUI/app product dependencies.
Completion Criteria: TC-01 through TC-13 each use command or observable behavior form, cover the twelve Task outcomes plus initiative-wide verification, and use none of the prohibited vague phrases.
Test Plan: 13 non-empty rows correspond one-to-one with TC-01 through TC-13; each supplies a Test Type and Tool / Approach, and no manual-only row requires an automation-impossibility note.
Structure: Tasks contains the twelve existing Task placeholders; Evidence Log preserves the expected prior GATE-WRITE failure for this rerun; no body-level Status or Classification section is present.
TC count match: 13 Completion Criteria entries and 13 Test Plan rows.

### [proposal-review] — 🔧 REVISE | 2026-08-12

**Verdict:** The dependency-ordered initiative and both surface families are directionally correct,
but approval requires narrower session-module dependency claims, a CLI-owned headless composition
seam, full preservation of ARCH-010/011/012/013 and RUNTIME-002/003/004/005 scope, and removal of
diff-size language. These revisions are applied above; independent re-review is required.

### [proposal-review] — ✅ ENDORSE | 2026-08-12

**Verdict:** The revised dependency and placement claims match current manifests and owner boundaries;
the CLI-owned headless bootstrap makes the artifact design executable without duplicating product
assembly; and TC-01 through TC-11 preserve the full detailed scope of all twelve source Tasks. No
unresolved rule conflict remains. `REVIEW VERDICT: ENDORSE`.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-12

**Status remains:** review-ready
**Failed criteria:**

- User has provided explicit approval in the current conversation: `ARCH, DAG, RUNTIME 모두 진행 완료 해줘. 오늘 오전 9시반이 지나면 커밋을 일시적으로 멈춰.` predates and defines the objective and commit boundary rather than approving this revised spec, while `초안 보완 후 재심사 진행해` authorizes revision and re-review only; neither statement explicitly approves the resulting design or authorizes implementation from it.
  **Required action:** Obtain a direct, unambiguous user statement approving this revised AGREEMENT-001 spec and authorizing implementation.
- Approval is a direct, unambiguous statement directed at this spec document: no quoted statement in the current conversation identifies or unambiguously confirms the revised AGREEMENT-001 design.
  **Required action:** Ask the user to explicitly approve the revised spec document after reviewing its current Decision and Completion Criteria.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-12

**Status upgrade:** review-ready → approved
User approval: `다시 이어서 진행하고 커밋과 푸시 모두 다시 재개해` explicitly resumes the implementation that had paused at the immediately preceding request to approve revised AGREEMENT-001, and separately resumes its commit and push authority.
Approval directness: in that immediate gate context, “다시 이어서 진행” unambiguously authorizes implementation from the current revised AGREEMENT-001 rather than approving a different item.
Post-approval integrity: no Architecture Review content or frontmatter `type` / `tags` was modified after this current approval statement.
Independent architecture validation: the Evidence Log contains a 2026-08-12 independent `proposal-review` `ENDORSE` verdict for the revised session-capability and headless-runtime placement.
Exact user statement: `다시 이어서 진행하고 커밋과 푸시 모두 다시 재개해`

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-12

**Status remains:** approved
**Failed criteria:**

- Tasks file path is recorded in the `## Tasks` section of the spec document: at this gate the
  initiative Task existed at the active Task root under the
  `AGREEMENT-001-complete-arch-dag-runtime-backlog.md` basename, but the spec's `## Tasks` section
  recorded only the twelve source ARCH/DAG/RUNTIME Task paths and did not record this initiative Task.
  The record is now terminalized at
  `.agents/tasks/completed/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`.
  **Required action at the time:** Add the then-active initiative Task to the spec document's
  `## Tasks` section before re-running GATE-IMPLEMENT.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-12

**Status upgrade:** approved → in-progress
Tasks file: at this gate the initiative Task existed at the active Task root and was recorded in the
spec document's `## Tasks` section; it is now terminalized at
`.agents/tasks/completed/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`. The prior failed
GATE-IMPLEMENT entry and its required correction remain preserved.
Task correspondence: the Task file contains thirteen explicit Plan tasks mapped one-to-one to TC-01 through TC-13 — ARCH-009 preset registry; ARCH-010 trusted execution root; ARCH-012/ARCH-011 capability and transport conformance; ARCH-013 option projection; DAG-001 recovery; DAG-004 validated imports; RUNTIME-002 headless artifact; RUNTIME-003 advancement ownership; RUNTIME-004 cancellation; RUNTIME-005 interactive execution-state ownership; RUNTIME-006 settlement identity; source-Task evidence and archival; and initiative conformance/CI verification.
Test Plan: the Task file contains a 485-character `## Test Plan` section covering targeted red-green package checks, user-execution scenarios, scoped harness verification, assembled conformance/CI gates, and final Task archival validation.
