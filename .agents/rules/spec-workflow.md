# Spec Workflow Rules

Rules governing spec-first development, conformance verification, and spec maintenance.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Live Spec Policy

A `docs/SPEC.md` is a **living document**. It is never "done" — it grows with every change to its
package. The spec is the canonical description of what the package is _right now_, not what it was
when it was first written.

**Universal update mandate.** Every PR that introduces any of the following MUST update the
governing `docs/SPEC.md` in the same PR. **This table is the single owner of the mandate's triggers**;
[`spec-writing-standard`](../skills/spec-writing-standard/SKILL.md) applies it when authoring the edit
and does not carry its own copy of these rows.

| What changed                                                   | SPEC section to update                  |
| -------------------------------------------------------------- | --------------------------------------- |
| New or removed public export                                   | Public API Surface                      |
| New or changed type or interface                               | Type Ownership                          |
| New class or `implements`/`extends` relation                   | Class Contract Registry                 |
| New or changed error type or code                              | Error Taxonomy                          |
| New or changed lifecycle event                                 | State Lifecycle / Event Architecture    |
| New or changed **externally observable** behavior or semantics | Architecture Overview, relevant section |
| New extension point (abstract class, callback)                 | Extension Points                        |

A PR that changes package behavior without updating the SPEC is an **incomplete change** — treated
the same as a missing test or a build failure.

**Internal behavior is out of scope for this mandate.** A change no consumer outside the package can
observe belongs in the component's design document, not in the contract — see the consumer-impact test
owned by [`design-doc-authoring`](../skills/design-doc-authoring/SKILL.md) > "Placement criterion".
Routing it there is what keeps this mandate affordable enough to actually hold: when every internal
refactor obliged a SPEC edit, the mandate was skipped instead, and skipping it is what produced the
drift the policy below calls a process violation.

**Incremental evolution.** Only the sections affected by a change need to be updated. Never
rewrite the whole document for a localized change. Add, edit, or remove only the rows, paragraphs,
or tables that describe the changed behavior.

**Spec-first invariant.** Write the new SPEC section(s) before writing implementation code. The
spec is the design artifact. Implementation fills in what the spec already describes. Back-filling
the spec after implementation is a process violation — the spec must come first.

**Spec drift is a process violation.** If `docs/SPEC.md` no longer accurately describes the
current state of its package, every subsequent PR on that package is incomplete. When drift is
detected, schedule a SPEC catch-up as a dedicated backlog item before continuing normal work. That
catch-up is [`spec-writing-standard`](../skills/spec-writing-standard/SKILL.md) Mode C (drift
recovery) — **not** [`spec-code-conformance`](../skills/spec-code-conformance/SKILL.md), which fixes
code against a spec it treats as correct and explicitly disclaims correcting the spec.

### Spec-First Development

- Any change touching a contract boundary (package imports, class dependencies, service connections, cross-package types) MUST update or create the governing spec BEFORE writing implementation code.
- Spec format follows the boundary type:
  - HTTP API → standardized API specification (e.g., OpenAPI)
  - Package public surface → `docs/SPEC.md`
  - Class/interface dependency → contract definition in the owning package
- Every spec change MUST include a verification test plan.
- Implementation code that does not conform to its governing spec is a bug.
- See [`spec-first-development`](../skills/spec-first-development/SKILL.md) skill for the procedural workflow.
- For any new gap, fix, or improvement: write a spec document to `.agents/spec-docs/draft/` first using [`backlog-writer`](../skills/backlog-writer/SKILL.md), then run [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md).

### Validated Recommendation Before Approval (mandatory)

Before requesting design sign-off (GATE-APPROVAL, or any design-confirmation), the agent must present a
**validated recommendation** — not the first internally-coherent design. A design that merely looks
proper can still contain invalidating defects; presenting it for approval before verification wastes the
approval and risks shipping the defect.

For any change crossing a **contract boundary** or with **wide blast radius** (cross-package contract,
shared port, multi-consumer migration), the Architecture Review must explicitly verify the design
survives contact with the code — at minimum:

- **Reachability** — the chosen placement is reachable by every intended consumer, including
  dependent/planned items (see [code-quality.md](code-quality.md) Type System).
- **Capability preservation** — when replacing/unifying a contract, every capability of the replaced
  contract is preserved or consciously dropped with rationale; a presence/absence grep is not proof
  (see [common-mistakes.md](common-mistakes.md)).
- **Adversarial pass** — an independent critical/red-team review of the design's strongest failure modes,
  with each finding fixed, refuted, or recorded before approval.

Record the verification in the spec's Architecture Review (Alternatives/Decision) before GATE-APPROVAL.
Presenting an unvalidated design for approval — one a basic reachability/capability/adversarial check
would have invalidated — is a process violation.

### New-Surface Architecture Placement (mandatory)

When a change **introduces a new package, app, or presentation/interface surface**, or **reclassifies a
layer / product-family boundary** (a new module that could plausibly live in more than one place, or that
consumes or extends an existing product), the **architecture-placement decision is the single most
consequential and owner-visible decision in the spec** — it determines what the new thing _is_ and how it
relates to the rest of the system. It must be treated as a primary decision, not an incidental one:

1. **Mirror an analogous existing layer.** The Architecture Review MUST identify the closest existing
   structural analog — a surface/layer that plays the same role — and justify the new surface by mirroring
   that proven layering, or explicitly justify why it must differ. State the new surface's product-family /
   taxonomy classification (which "kind" of thing it is, alongside its siblings).
2. **Reuse at the shared-core/contract level, never as a skin on a sibling product.** A new surface must
   consume shared CONTRACT/CORE layers — not be built as a thin dependent of another PRODUCT that happens to
   render something similar. Coupling a new surface under an unrelated product's app/product package (instead
   of the shared core they should both consume) is the specific anti-pattern this rule prevents.
3. **Independent architecture validation — not a self-claim.** The placement MUST be validated by an
   independent architecture review (an architecture-audit / proposal-review agent — see
   [architecture-refresh](../skills/architecture-refresh/SKILL.md) and the `proposal-reviewer` plus
   `architecture-audit-fanout` structure channel), which explicitly checks (1) and (2). A bare "reviewed" assertion is
   insufficient; the review and its verdict must be recorded in the Evidence Log.
4. **Surface it to the owner FIRST.** When presenting the design for sign-off, lead with the placement
   decision — which layer it mirrors, its product-family, and the placement alternatives rejected — above
   styling, scope, or implementation detail. It is the decision the owner most needs to weigh and the one an
   owner is least able to reconstruct after the fact.

Record all four in the spec's Architecture Review before GATE-APPROVAL. Presenting a new surface for approval
without an explicit, independently-validated, owner-surfaced placement decision is a process violation.

### User Request Implementation Gate (mandatory, zero exceptions)

When the user sends any message requesting implementation, code changes, feature additions, fixes,
or modifications, the agent MUST follow this sequence regardless of how the request is phrased:

**Allowed before spec exists:**

- Read files, explore the codebase (`Read`, `grep`, `find`, `git log`, `Bash` with read-only commands)
- Ask clarifying questions
- Write spec documents (backlog draft, SPEC.md)

**Not allowed before spec exists:**

- `Write` or `Edit` to any `.ts`, `.tsx`, `.js`, `.mjs` file
- Creating new source code files
- Running code generation commands

**Sequence.** No implementation may begin before GATE-APPROVAL passes, and the draft must exist
before the gate can run. An L0 change (§ Lanes) has no spec document: its declared lane and its ground
on the pull request are the record that stands in for the draft, and the lane scan is its gate. The ordering itself — explore, draft, gate, implement — is owned by
[`user-request-gate`](../skills/user-request-gate/SKILL.md); this rule states only that it is
mandatory and that the gate is the boundary.

**No waiver.** "Skip the spec" or "just fix it now" is not a process exception to acknowledge in a
reply; it is a lane question, and the only instruction-driven shortening is the fast track in § Lanes
below — declared on the pull request, refused on an L2 path, never a default.

**Automated enforcement**: `.claude/hooks/spec-first-gate.sh` (UserPromptSubmit hook) injects
this reminder when implementation-intent keywords are detected in the user's prompt.

### HARD GATE: No Immediate Implementation

Any gap, improvement, or fix discovered during development MUST follow this sequence before writing a single line of code:

1. **Architecture review** — analyse the problem and affected scope.
2. **Spec document** — write to `.agents/spec-docs/draft/` using [`backlog-writer`](../skills/backlog-writer/SKILL.md). All required sections and frontmatter must be present.
3. **Gate pipeline** — run [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md) to advance through GATE-WRITE → GATE-APPROVAL before any implementation.
4. **User approval** — GATE-APPROVAL requires an explicit user sign-off quoted in the Evidence Log.
5. **Implement** — code only after GATE-APPROVAL passes, and GATE-IMPLEMENT, GATE-VERIFY and
   GATE-COMPLETE must each run on the document afterwards. Their criteria are the
   [gate catalogue](../specs/gate-catalogue.md); which one runs when is
   [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md).

Which of these steps a change takes is not argued case by case: it is the change's **lane**, derived
from the diff and refused by machine when under-declared — § Lanes below. Every lane keeps the record:
an issue, a declared lane, and a ground on the artifact.
A spec update is also required for any change touching a contract boundary (see Spec-First Development).

### Lanes

A change's lane is the ceremony its risk buys, and it is a **lower bound derived from the diff**, not a
judgement made at a gate. Three lanes:

- **L0** — a diff with no non-comment change under any `src/` and nothing on an L2 path: comments,
  documentation, tests, and tooling configuration outside the L2 rows below.
- **L1** — a non-comment change under `src/` that touches no L2 path.
- **L2** — any change on an L2 path: the triggers of the SPEC-update table in § Live Spec Policy, the
  classes [backlog-execution.md](backlog-execution.md) § Standing authorization keeps outside every
  delegation, and the documents that define the gates themselves. The rows below point at those owners
  and copy none of them.

**The lane is declared, and refused — never argued.** A change declares `Lane: L0|L1|L2` in three
places: as `lane:` in the spec document's frontmatter when one exists, as a `Lane:` git trailer on
the branch's commits, and as a `Lane:` line in the pull-request body. The declaration is compared with
the floor the diff's paths derive from the table below: a declaration **below** the floor is refused,
one at or above it is accepted, and a missing one is refused. No gate, guardian, or reviewer accepts an
argument that a change "is really L0" — the diff decides, and a change that wants a lower lane changes
its paths, not its story. The first excluded class, product direction, is not path-shaped and is judged
at the gate as before; the floor is a bound beneath that judgement, not a replacement for it.

Enforced by: `scan-lane-declaration` (`scripts/harness/scan-lane-declaration.mjs`) in
`pnpm harness:scan` and in `pnpm harness:pre-push` — it derives the floor from the table below and
refuses a declaration under it, or none.

#### Lane floors

The floor a path implies; a diff's floor is the highest floor any of its paths reaches. Patterns are
repository-relative globs, and a bare filename is anchored at the repository root.

| Floor | Path pattern                               | Why                                                                                                                                                                              |
| ----- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L2    | `.github/workflows/**`                     | CI workflows — a repository-wide policy file, outside every delegation                                                                                                           |
| L2    | `.claude/hooks/**`                         | Git hooks — a repository-wide policy file                                                                                                                                        |
| L2    | `.husky/**`                                | Git hooks — a repository-wide policy file                                                                                                                                        |
| L2    | `.eslintrc*`                               | Lint configuration — a repository-wide policy file                                                                                                                               |
| L2    | `pnpm-workspace.yaml`                      | Workspace topology                                                                                                                                                               |
| L2    | `package.json`                             | The root manifest — workspace topology and toolchain versions; a package's own manifest under `packages/*/` is not this row                                                      |
| L2    | `.agents/rules/spec-workflow.md`           | Defines the gates and the lanes — a delegated class may not approve a change to what delegation means                                                                            |
| L2    | `.agents/rules/backlog-execution.md`       | Defines the done gate and the delegated-class registry                                                                                                                           |
| L2    | `.agents/specs/gate-catalogue.md`          | Defines every gate's criteria                                                                                                                                                    |
| L2    | `.design/**`                               | User-authored documents                                                                                                                                                          |
| L2    | `packages/*/docs/SPEC.md#trigger-sections` | The sections named in the second column of the SPEC-update table in § Live Spec Policy — a published contract. That table is the owner; this row points at it and copies nothing |
| L1    | `scripts/**`                               | Harness and tooling scripts — behaviour without a package contract; a non-comment change is L1, a comment-only change is L0                                                      |
| L1    | `**/src/**`                                | A non-comment change under `src` that touches no L2 pattern                                                                                                                      |
| L0    | everything else                            | Comments, documentation, tests, and tooling configuration outside the L2 rows                                                                                                    |

Enforced by: `scan-lane-declaration` — it reads this table as its criteria rather than carrying a copy.

#### Fast track

A fast track shortens a lane's ceremony on the user's instruction, and only there. It is a
`Fast-track: <reason>` line in the pull-request body whose reason is the user's instruction **quoted
verbatim** — a ground is recorded on the artifact it justifies
([grounds are recorded where the work is](../spec-docs/backlog/RULE-015-grounds-are-recorded-where-the-work-is.md)),
so the pull request is its record, not a chat transcript or a session summary. It is never accepted on a
path whose floor is L2, and it is never a default: a change with no such instruction takes its lane's
full path. A fast track does not lower the declared lane — the lane is still the diff's — it records why
the lane's record is shorter than usual.

Enforced by: `scan-lane-declaration` — a `Fast-track:` line on a diff whose floor is L2 is refused.

#### Gates per lane

The lane decides which gates run and who judges them. **Which gates compose each lane, and which
criterion is `mechanical` (a script decides it from the document, the tree and git alone) or
`semantic` (needs judgement), are the [gate catalogue](../specs/gate-catalogue.md)'s facts** — see its
"Gates per lane" section; this rule does not restate that table. In one line each: L0 has no spec
document and is judged by CI, the reviewer verdict and the merge gate; L1 has one spec document on the
standard schema and two gates, PLAN and DONE, run by `node scripts/harness/gate.mjs`, with
`backlog-gate-guard` dispatched only on a non-PASS; L2 runs the five spec-document gates and the two
done-gate stages unchanged, `gate.mjs` judging the mechanical set and the guardian the semantic set.

Enforced by: `scan-lane-declaration` for the lane itself; the gate composition is enforced where the
catalogue's criteria are — `gate.mjs` and `backlog-gate-guard`.

### Spec-Document Status and Lifecycle Folders

The status vocabulary and the folder each status lives in are **facts this rule owns**. A pipeline
reads the mapping to decide where a document belongs; it does not redefine it.

| `status:` (frontmatter) | Folder                        | Meaning                                   |
| ----------------------- | ----------------------------- | ----------------------------------------- |
| `draft`                 | `.agents/spec-docs/draft/`    | Written, not yet through GATE-WRITE       |
| `review-ready`          | `.agents/spec-docs/backlog/`  | GATE-WRITE passed, awaiting approval      |
| `approved`              | `.agents/spec-docs/todo/`     | GATE-APPROVAL passed, not yet started     |
| `in-progress`           | `.agents/spec-docs/active/`   | GATE-IMPLEMENT passed, work under way     |
| `verifying`             | `.agents/spec-docs/active/`   | GATE-VERIFY passed — **no folder change** |
| `done`                  | `.agents/spec-docs/done/`     | GATE-COMPLETE passed                      |
| `rejected`              | `.agents/spec-docs/rejected/` | Closed deliberately; not a gate FAIL      |

A gate PASS that changes the status and the folder does both or neither: a document left in the wrong
folder for its status is treated as NON-COMPLIANCE **on its next gate run**. A document that has
already reached `done/` has no next gate run, which is why that force alone was never enough;
`scripts/harness/scan-doc-folder-status-agreement.mjs` checks the agreement over the whole tree
instead, deriving this table as its criteria rather than copying it, and it runs in
`pnpm harness:scan`. A document whose correct status is not derivable without re-running the gate
itself is a recorded exception in the scan, under anti-rot, rather than a guess written into the
tree. Each status transition is a gate, and every gate must leave an
Evidence Log entry (PASS / FAIL / NON-COMPLIANCE) in the format the
[gate catalogue](../specs/gate-catalogue.md) defines.

This vocabulary governs **spec documents** under `.agents/spec-docs/`. Backlog items under
`.agents/tasks/` use a different one — see
[backlog-execution.md](backlog-execution.md) > Status Invariants. The two share tokens
(`in-progress`, `done`) but not meaning, and neither overrides the other.

### Spec-Code Conformance Verification

- Any SPEC.md or contract document change MUST be followed by a conformance verification loop before the change is considered complete — bounded like every auto-re-drive loop, per [enforcement-architecture.md](enforcement-architecture.md).
- The spec is the source of truth. The loop compares every spec assertion against implementation code, lists all gaps, and fixes the **code** (not the spec) to match.
- Each code fix MUST include a corresponding contract test.
- The loop repeats until zero discrepancies remain, then regression tests for all affected packages MUST pass. Like every auto-re-drive loop it escapes on no-progress detection — if the same discrepancy set recurs unchanged, stop and escalate to the user rather than spin ([enforcement-architecture.md](enforcement-architecture.md)).
- A spec change without conformance verification is an incomplete change.
- **Any code change MUST be preceded by a spec update.** Update the SPEC first to describe the intended state, then modify code to conform. Never modify code without updating or verifying the governing spec.
- See [`spec-code-conformance`](../skills/spec-code-conformance/SKILL.md) skill for the full procedure.

### ABSOLUTE RULE: Verification does not modify SPEC to match code

- During SPEC-Code verification, if a mismatch is found, **ALWAYS fix the code to match the SPEC**. NEVER modify the SPEC to match the code as a verification fix.
- The SPEC is the source of truth during verification. Modifying the SPEC to match code during verification **invalidates the entire verification process**.
- If the code was intentionally changed and the SPEC is now outdated, this is a **process violation** — the SPEC should have been updated BEFORE or TOGETHER WITH the code change, not during the verification step.
- **Exception: SPEC itself is wrong.** If the SPEC contains errors, contradictions, or inaccuracies, it is valid to correct the SPEC — but this must be done as a **separate deliberate action** before code verification:
  1. Stop code verification
  2. Validate and correct the SPEC (separate step, clearly intentional)
  3. Confirm the SPEC is accurate
  4. Restart code verification from scratch against the corrected SPEC
- The key distinction: fixing a genuinely wrong SPEC is acceptable. Changing a correct SPEC to avoid fixing code is not.
- **Where the correction itself happens.** The four steps above are the rule's; the procedure for the
  correction is [`spec-writing-standard`](../skills/spec-writing-standard/SKILL.md) Mode C (drift
  recovery), which runs as its own dedicated PR — never inside a conformance loop. Mode C is the only
  context in which a SPEC may be edited to describe existing code, and it exists because this rule
  requires the correction to be a separate deliberate action.

### Reverse Spec Verification (Code → Spec)

- Any refactoring that affects package boundaries (dependency changes, export additions/removals, class splits/moves) MUST be followed by a reverse verification of the affected package's SPEC.md.
- The verification checks that the SPEC still accurately describes the current code — not just that the code matches the spec.
- A refactoring without updated SPEC.md is an incomplete change, same as a spec change without conformance verification.

### Document Authority and Content Placement

Architecture documents, design documents, and package SPEC files have different authority. A change
is incomplete when durable content is left only in the wrong document class.

| Document class                                                                                                                               | Authority                                                                                  | Must contain                                                                                                                                               | Must not contain                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Architecture documents: `.agents/specs/ARCHITECTURE-MAP.md`, `.agents/specs/architecture-map/*.md`, package-local `docs/ARCHITECTURE-MAP.md` | Stable structural boundaries, owner placement, dependency direction, layer rules, topology | Package ownership, allowed/forbidden dependency edges, product-shell boundaries, cross-package topology, update requirements                               | Package-local public API detail, implementation plans, option analysis, transient backlog, marketing prose     |
| Design / LLD documents: `packages/*/docs/design/**/*.md` ([RULE-009](../spec-docs/done/RULE-009-design-doc-type.md))                         | A component's internal realization — the whitebox behind the contract                      | Internal structure and module decomposition, key flows, the motivation for the decomposition, local trade-offs, internal state transitions, test approach  | Anything a consumer outside the package depends on — that is the owning SPEC's, per the placement criterion    |
| Planning documents: `.design/**/*.md` (except `.design/decisions/`), `docs/plans/*-design.md`, `docs/superpowers/**/*design*.md`             | Planning and decision rationale before the accepted contract is updated                    | Problem statement, alternatives, recommendation, tradeoffs, research notes, implementation phases, affected files, test strategy                           | Final package contract truth, stable dependency rules, API source of truth after implementation                |
| Package/app SPEC files: `packages/*/docs/SPEC.md`, `apps/*/docs/SPEC.md` where present                                                       | Owner contract for one package or app                                                      | Scope, owned responsibilities, non-goals, public API, class/interface contracts, lifecycle/events, persistence/protocol details, verification requirements | Cross-repository topology owned by the architecture map, implementation diary, details owned by other packages |
| Cross-cutting specs under `.agents/specs/*.md`                                                                                               | Shared contract truth when no single package owns the whole contract                       | Protocols, shared lifecycle models, command/background/verification contracts, reusable policy spanning packages                                           | Package-local API inventories that belong in package SPEC files                                                |
| Public docs and READMEs                                                                                                                      | User-facing explanation and usage guidance                                                 | Supported behavior, setup instructions, examples, migration notes, package overview                                                                        | Hidden contracts that are not represented in SPEC/API/architecture docs                                        |

Document authority is determined by path and role, not by a broad word in the filename. For
example, `content/guide/architecture.md` is public user documentation, while
`.agents/specs/architecture-map/*.md` is architecture authority.

Authority order by question:

- Package-local behavior, public API, lifecycle, events, persistence, and class/interface contracts
  are owned by the package/app SPEC.
- Cross-package ownership, dependency direction, product-shell boundaries, and deployment topology
  are owned by architecture documents.
- HTTP/API wire contracts are owned by the relevant API specification.
- A cross-cutting design document under `.agents/specs/` is governed by the _Cross-cutting specs_ row
  below, not by the Design / LLD row — that glob has one owner, and naming it in two rows with
  opposite "must contain" columns is the contradiction this table exists to prevent.
- The split between a package SPEC and its `docs/design/` documents is decided by the consumer-impact
  test in [`design-doc-authoring`](../skills/design-doc-authoring/SKILL.md) > "Placement criterion",
  which owns that fact. It is linked, never copied — a second copy is the drift this table exists to
  prevent.
- Design documents, task files, backlog files, PR notes, and chat history do not override accepted
  SPEC, API, or architecture documents.

Content promotion rules:

- When a design decision becomes accepted, promote the durable contract into the owner SPEC, API
  spec, or architecture document in the same PR.
- Keep rationale, rejected alternatives, research notes, and phased implementation plans in design,
  task, or backlog documents.
- Do not duplicate package-local API details in architecture maps; link the owning SPEC instead.
- Do not keep cross-package ownership rules only in a package SPEC; update the relevant architecture
  map subdocument.
- Do not use README, website content, task files, or backlog files as the only source of contract
  truth.

### Structural Architecture Documentation

- Any change that creates, removes, renames, or reassigns responsibilities across workspace packages MUST update the architecture documents that describe the structure in the same PR.
- Required structural docs include `.agents/project-structure.md` for package inventory/dependency direction, `.agents/specs/ARCHITECTURE-MAP.md` as the architecture-map router, and the relevant `.agents/specs/architecture-map/*.md` subdocument for cross-cutting architecture that spans packages.
- Package `docs/SPEC.md` files remain required for owner-level contracts; architecture docs do not replace package specs.
- If a package has a package-local architecture map such as `docs/ARCHITECTURE-MAP.md`, changes to package composition, import edges, execution modes, or class/interface ownership MUST update that map in the same PR.
- Do not append subsystem details to the architecture-map router when a focused subdocument owns that area.
- A structural architecture change without updated structure/spec architecture documents is incomplete.

### GATE-CONFORMANCE (architecture conformance gate)

- **Purpose:** verify that the canonical architecture documents still match code reality (the
  doc-vs-code drift that the per-spec `Architecture Review` section self-asserts but does not validate).
- **Mechanical core (deterministic, non-prose):** `pnpm harness:conformance` — an alias for
  `check-dependency-direction.mjs --conformance-json` (the dependency rules incl. the
  workspace-package-name guard) — emits a machine-readable JSON summary.
  Exit 0 = conformant, 1 = violations.
- **Analytic layer:** the [`architecture-refresh`](../skills/architecture-refresh/SKILL.md) agent
  pipeline (four-dimensional `architecture-audit-fanout` plus the separate
  `architecture-conformance-auditor` → synthesis/depth → fixer/implementer) produces
  the findings report + remediation; the
  [`architecture-conformance-audit`](../skills/architecture-conformance-audit/SKILL.md) skill is the
  thin router into it.
- **Trigger:** the dependency rules run in the blocking `harness:scan` aggregate (the `deps` scan in
  `run-all-scans.mjs`), so they gate every PR and release. JSON summary on demand via
  `pnpm harness:conformance`.
- **PASS/FAIL:** PASS when `harness:conformance` exits 0 and no unresolved P0 finding remains; FAIL
  otherwise. Judged by the [`backlog-gate-guard`](../../.claude/agents/backlog-gate-guard.md) agent
  against the [gate catalogue](../specs/gate-catalogue.md).

### Cross-Package SPEC Reference Policy

- SPEC.md MUST NOT hardcode counts, lists, or implementation details owned by another package (e.g., "6 built-in tools" when the tools are owned by a different package).
- When referencing another package's details, either reference the owning package's SPEC or describe only what is observable from the current package's own code.
- If cross-package details must be stated, annotate with the owning package name so staleness can be tracked (e.g., "8 built-in tools (per agent-tools)").
