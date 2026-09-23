---
status: done
type: RULE
tags: [harness, approval, migration]
lane: L2
---

# RULE-2380: Dispose of the frozen legacy approval corpus

## Current disposition — 2026-09-23

Historical delivery is preserved at replacement child merge `720eb5e841ba7a5361ac667b9658e034212bb58e` in R `720eb5e841ba7a5361ac667b9658e034212bb58e`. The done status and original evidence below describe that delivery; importing this record does not restore its historical implementation. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. This record is historical evidence of a completed child, not an active instruction to recreate its gate, checkpoint, endorsement, or frozen-corpus enforcement machinery.

Paired with `.agents/tasks/completed/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`.
The historical source is [issue #2380](https://github.com/woojubb/robota/issues/2380); its unfinished
scope was transferred to the open execution owner [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

`scan-standing-delegation-evidence.mjs` currently reports 404 approved spec documents: 137 DIRECT,
49 CLASS, and 218 frozen approvals with no route. The frozen baseline prevents RULE-012 from making
the repository immediately red, but its own note says that exemption is not absolution and leaves the
records' disposition to an owner decision. No machine-readable artifact currently records that
decision per record, binds it to the historical bytes, or proves that every baseline member received
one disposition.

Retroactively writing `DIRECT` would invent a route field and provenance that were not recorded.
Retroactively writing `CLASS` is prohibited because the two registered classes postdate every frozen
approval. Seventeen records rely on relayed authority, which the current rule says is not an
instruction, and eleven assert standing authority without quoting it. Therefore “repairing” the old
approvals would turn uncertainty into fabricated evidence. Leaving the baseline alone would preserve
the uncertainty forever and allow a later shrink or rekey to look like completed disposition.

The current population is reproducible from the final standing verdict in each baseline member. A
reviewed evidence map assigns exactly one evidence-shape category per record:

| Evidence shape                  | Precedence rule over evidence references from the final standing verdict                                                                            | Count |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| `RELAYED_AUTHORITY_ONLY`        | the user approval/delegation itself is described as relayed, supplied, or attested by another session/orchestrator, or inherited from such a record |    17 |
| `HISTORICAL_QUOTED_CLASS_SHAPE` | non-relayed standing/class authorization quotes the user instruction and its application to the item                                                |    26 |
| `NO_QUOTED_AUTHORITY`           | non-relayed standing/class authorization is asserted without a verbatim user instruction                                                            |    11 |
| `HISTORICAL_DIRECT_SHAPE`       | the record carries direct item/batch approval evidence and none of the three higher-precedence shapes applies                                       |   164 |

The four counts total 218. Issue #2380's original 217-record measurement was 165/15/26/11 and grouped
only its standing-basis search. The guard fix in commit
`6a15807054e01f66fdee2cc837779d1ca2467a56` restored the previously invisible `SEC-015` record. The
complete semantic audit then applies relay precedence consistently: `RULE-013`, `SEC-015`, and
`SEC-016` relay the user authority; `ARCH-029` verifies its direct user answer at the source; and
`SCREEN-005` relays only a proposal-reviewer verdict, not user authority. The resulting current counts
are 164 direct-shaped, 17 relayed, 26 quoted-class-shaped, and 11 without quoted authority.

## Prior Art Research

- RULE-012's `standing-delegation-baseline.json` is the population owner and already establishes the
  no-growth/shrink-only legacy boundary. This item retains that boundary instead of creating a second
  approval population.
- RULE-2326's `recommendation-endorsement-baseline.json` and
  `recommendation-endorsement-persisted.mjs` demonstrate the repository's immutable-introduction
  pattern: an adoption revision precedes one unique add commit, and later bytes must equal the exact
  introduction bytes.
- `BACKLOG-ZERO-MIGRATION` demonstrates a finite manifest whose rows retain exact paths, evidence, and
  disposition while treating the manifest as immutable after approval. RULE-2380 applies that pattern
  to approval records, without using that delegated class as approval authority for this policy edit.
- Git object identity and a separate SHA-256 content digest answer different audit questions: the Git
  blob proves which repository object existed at adoption, while SHA-256 provides a stable explicit
  content checksum in the manifest. Git's official
  [`git-hash-object` documentation](https://git-scm.com/docs/git-hash-object) defines the object ID as
  a digest over an object's typed content, and the official
  [Git data model](https://git-scm.com/docs/gitdatamodel) states that Git objects are immutable after
  creation. Both identities are retained rather than treating one as a substitute for the other.
- [NIST SP 800-53 Rev. 5.1](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) AU-9 treats protection
  of audit information and its integrity as a distinct control. That supports retaining exact adopted
  bytes and refusing silent mutation rather than replacing historical evidence with a present-day
  interpretation.

These precedents converge on a central immutable manifest anchored to an adoption revision. None
supports retroactively changing an old approval into evidence that did not exist at the time.

## Architecture Review

### Affected Scope

- `scripts/harness/standing-delegation-dispositions.json` — new immutable 218-row disposition manifest.
- `scripts/harness/standing-delegation-disposition.mjs` — manifest parsing, canonical serialization,
  evidence-reference/category validation, adoption-tree lookup, and preservation checks.
- `scripts/harness/scan-standing-delegation-evidence.mjs` — retain prospective route enforcement and
  additionally require complete, valid disposition of the adopted frozen population.
- `scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` and focused disposition
  fixtures — classifier, manifest, tamper, replay, and migration coverage.
- RULE-2380 Task/spec plus parent AGREEMENT-2664 Task/spec projections.

No package, application, public API, runtime dependency, product behavior, or user-authored document
changes. The 218 historical spec documents are read-only inputs in this work unit.

### Alternatives Considered

1. Add `DIRECT` to the 164 direct-shaped records and register a class for the 26 quoted records.
   - Pro: reduces the frozen count immediately.
   - Con: invents route/provenance fields for DIRECT and violates the explicit no-retroactive-CLASS
     rule. It cannot recover the 17 relayed or 11 unquoted records.
2. Append one disposition entry to each of the 218 historical Evidence Logs.
   - Pro: disposition is visible beside each approval.
   - Con: performs a broad rewrite of sealed history, creates 218 mutation sites, and makes population
     conservation harder to audit than one canonical sorted manifest.
3. Keep the baseline unchanged and record only a single aggregate owner decision.
   - Pro: smallest diff.
   - Con: cannot prove that all 218 records were classified exactly once, cannot detect a missing or
     substituted member, and leaves the baseline's “not absolution” debt unresolved.
4. Create one immutable per-record manifest and preserve the historical documents unchanged.
   - Pro: records a complete owner disposition, binds every row to exact adopted bytes, keeps
     prospective DIRECT/CLASS rules intact, and makes omission, duplication, tampering, and silent
     population drift mechanically visible.
   - Con: adds a second artifact beside the existing baseline and requires careful adoption/current
     state handling so the baseline can still shrink after a genuine new approval.

### Decision

**Delivery mode:** `single`

Choose alternative 4. Every adopted record receives the sole disposition `PRESERVE_FROZEN`. That
means: retain the old approval only as a pre-RULE-012 historical exemption; do not claim that its
authority is valid; do not use it as DIRECT or CLASS evidence for new work. The evidence-shape field is
descriptive only and never changes this effect.

The manifest is introduced once and is immutable thereafter. Its `adoptionRevision` is the exact
planning checkpoint that precedes implementation and is an ancestor of the unique manifest-add commit.
The scanner reads the baseline and documents from that revision, not from an asserted count. Manifest
bytes in the working tree/index/HEAD must equal the bytes from the unique introduction commit.

Each row contains exactly:

- stable subject basename and adoption-time relative path;
- adoption-time Git blob object ID and SHA-256 of the complete document bytes;
- SHA-256 of the complete adoption-time Evidence Log and final standing GATE-APPROVAL verdict;
- one or more byte-bounded evidence references inside that verdict, each with a closed kind enum,
  start/end offsets, and SHA-256 of the selected bytes;
- one of the four evidence-shape values above;
- `PRESERVE_FROZEN` and its category-specific reason code.

Rows are sorted by subject and serialize canonically. The adopted baseline set and manifest row set
must be exactly equal and contain 218 unique subjects. Classification is frozen as reviewed evidence,
not re-inferred later from an open-ended natural-language keyword search. The validator derives the
category deterministically from the closed evidence-reference kinds: `USER_AUTHORITY_RELAYED` or
`RELAY_PROVENANCE_INHERITED` wins first; otherwise quoted standing/class evidence selects
`HISTORICAL_QUOTED_CLASS_SHAPE`; otherwise an unquoted standing-authority assertion selects
`NO_QUOTED_AUTHORITY`; otherwise exact direct item/batch evidence selects
`HISTORICAL_DIRECT_SHAPE`. Every referenced byte range and hash must resolve inside the adopted final
verdict. A row with missing, conflicting, out-of-range, or category-inconsistent references fails;
there is no fallback category.

The 17 relayed subjects are fixed explicitly: `ARCH-021`, `ARCH-100`, `ARCH-101`, `ARCH-103` through
`ARCH-108`, `HARNESS-116`, `HARNESS-117`, `RULE-013`, `SEC-015`, `SEC-016`, and `TRANS-005` through
`TRANS-007`. The manifest retains full filenames, so these shorthand IDs cannot create wildcard
membership.

The manifest remains the permanent 218-record audit ledger, while the current baseline keeps its
existing shrink-only behavior. A current baseline member must map to an adopted manifest subject and
retain the adoption-time Evidence Log bytes unchanged. A subject may leave the current baseline only
when its current final approval independently passes the ordinary DIRECT/CLASS classifier; its adopted
Evidence Log must remain an exact prefix of the current Evidence Log so a new append-only approval
cannot erase the historical record. Unknown baseline additions, missing manifest rows, duplicate
subjects, unexplained path substitutions, modified historical Evidence Log bytes, invalid new routes,
or manifest mutation fail closed.

The full-document blob and SHA-256 preserve the exact adoption snapshot for audit. They are verified
against `adoptionRevision`; they do not prohibit a later legitimate document lifecycle edit. The
Evidence Log prefix check is the invariant that protects historical approval bytes in the current
tree, while a new valid approval is the only route out of the frozen baseline.

The owner disposition is encoded in the immutable manifest and its scanner contract, not by amending
the delegated-approval rule. The existing rule already says the frozen baseline is not absolution,
forbids retroactive classes, rejects relayed authority, and assigns the historical disposition to an
owner decision filed as issue #2380. This work supplies that missing decision without changing what
delegation means. The grounded recommendation is authorized by the user's current instruction:
“승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로
승인합니다.”

### Architecture Review Checklist

- [x] Affected package/layer list complete — repository-private rule, manifest, scanner, tests, and
      lifecycle records only.
- [x] Sibling scan complete — RULE-012 baseline, RULE-2326 immutable adoption, and
      BACKLOG-ZERO-MIGRATION manifest patterns inspected; no existing artifact owns per-record frozen
      approval disposition.
- [x] At least 2 alternatives reviewed — four alternatives above.
- [x] Decision rationale documented — the selected design preserves evidence and population identity
      without fabricating authority.
- [x] New-surface placement: N/A — no package, app, interface, presentation, or product-family surface.

## Fallback & Degradation Declaration

None. An unreadable adoption revision, absent historical blob, malformed or mutable manifest, count or
set mismatch, ambiguous classification, digest mismatch, changed historical Evidence Log, invalid
baseline shrink, or unknown addition is a blocking finding. The scanner never converts such a failure
into a warning or inferred approval.

## Solution

1. Add the disposition module and immutable manifest generated from the exact planning-checkpoint
   baseline and document bytes, with 218 sorted rows, byte-bounded evidence references, and the four
   independently audited evidence shapes.
2. Extend the existing standing-delegation scan so the baseline remains the prospective exemption
   owner while the manifest owns historical disposition and adoption-byte evidence.
3. Add focused RED/GREEN fixtures for each category, exact adopted-set equality, malformed schemas,
   missing/duplicate/extra rows, changed blobs/digests/Evidence Logs, immutable-introduction mutation,
   a legitimate append-only new DIRECT/CLASS route, invalid baseline shrink, rekeyed subjects, and
   canonical idempotent serialization.
4. Update RULE-2380 and parent AGREEMENT-2664 lifecycle projections; do not reopen or rewrite closed
   issue #2380, whose residual scope is already owned by issue #2664.

## Affected Files

- `scripts/harness/standing-delegation-dispositions.json`
- `scripts/harness/standing-delegation-disposition.mjs`
- `scripts/harness/scan-standing-delegation-evidence.mjs`
- `scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`
- `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`
- `.agents/spec-docs/draft/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`
- `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`
- `.agents/spec-docs/active/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`

## Completion Criteria

- [x] TC-01: The immutable manifest contains exactly the 218 subjects in the adoption revision's
      frozen baseline, each exactly once, with verified document blob, complete-document SHA-256,
      Evidence Log SHA-256, standing-verdict SHA-256, byte-bounded evidence references, and exactly one
      of the four evidence shapes; measured counts are 164 direct / 26 quoted-class / 17 relayed / 11
      no-quoted-authority.
- [x] TC-02: The manifest schema, every row, and the paired Task/spec state that `PRESERVE_FROZEN`
      grants no DIRECT/CLASS authority; the user's current disposition instruction and the
      category-specific reason are recorded without changing any of the 218 historical spec documents
      or any delegated-approval rule document.
- [x] TC-03: Focused fixtures reject malformed manifests, mutation after introduction, missing,
      duplicate, extra, substituted, or ambiguously classified rows, wrong blobs or digests, modified
      historical Evidence Logs, unknown baseline growth, and baseline shrink without a current valid
      DIRECT/CLASS approval; a valid append-only new approval preserves the adopted log and passes.
- [x] TC-04: Canonical parse/serialize/read-back is byte-idempotent, two consecutive live scans report
      identical 218-row disposition counts with zero unclassified records, the historical spec path
      set has no worktree diff, and focused plus affected harness verification passes.
- [x] TC-05: Before terminalization, the RULE-2380 Task/spec and both parent AGREEMENT-2664 projections
      agree on RULE-2380's `in-progress` status and exact active paths. The terminal completion batch is
      required to move the pair to the exact done/completed paths, update both parent projections to
      seven terminal children, and retain issue #2664 as the open integration owner until the initiative
      lands on `develop`.

## Test Plan

| TC-ID | Test Type                     | Tool / Approach                                                                                                                         | Notes                                                                                      |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TC-01 | Unit / live inventory         | focused Vitest classifier cases plus live scanner exact counts and adopted-set equality                                                 | Proves all 218 are classified once; includes the SEC-015 217→218 correction.               |
| TC-02 | Contract / diff               | manifest/Task/spec schema assertions plus `git diff --name-only` exclusion of rule files and all 218 adopted paths                      | Prevents category names or metadata from becoming authority and prevents history rewrites. |
| TC-03 | Adversarial integration       | temporary Git repositories covering manifest introduction, tamper, set drift, digest drift, rekey, shrink, and append-only new approval | Every corrupt or unauthorized transition fails closed.                                     |
| TC-04 | Determinism / repository gate | canonical round-trip twice, live scanner twice, focused Vitest, and affected harness scan                                               | Proves idempotence, population conservation, and no unclassified row.                      |
| TC-05 | Lifecycle projection          | pre-terminal exact-path/status assertions plus post-PASS atomic completion and read-back                                                 | Proves the final child closes without prematurely closing the integration owner.           |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-private approval-history metadata and harness enforcement. It does
not change a Robota CLI, TUI, browser, public SDK, installed package, or other runnable product surface
that an end user can execute.

## Tasks

- [x] `.agents/tasks/completed/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` — done
- Planning checkpoint prepared after the approved state was committed.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: [reason]" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: [reason]`
- GATE-WRITE — OR an explicit `Waived: [reason]` line is present (opt-out the agent proposed or the user requested) — a bare : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: [reason]" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: [reason]`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `73cf4c7e721e` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `4438788748a9` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the draft gives incompatible live-population evidence: the verified scanner reports 218 frozen records; the evidence-shape table and Decision use 164 direct-shaped / 17 relayed / 26 quoted-class-shaped / 11 no-quoted-authority, while the preceding Problem text says 15 relayed records and alternative 1 says 166 direct-shaped / 15 relayed records. The reader therefore cannot trace one coherent measured research result into the alternatives and Decision.
  **Required action:** reconcile every population count and category claim with one verified live inventory, then re-run this gate.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: Solution step 5 requires updating the RULE-2380 and parent AGREEMENT-2664 lifecycle projections, but TC-01 through TC-04 and their Test Plan rows contain no observable criterion or verification for those projection updates.
  **Required action:** add a measurable completion criterion and matching Test Plan row for the stated lifecycle-projection scope, or remove that scope from the Solution before re-running this gate.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `73cf4c7e721e` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `34429152a41ad392ffd20ee1674410a28c0dc3d9` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the bounded correction reconciled alternative 1 and added TC-05, but the Problem still states that fifteen records rely on relayed authority. The live scanner reports 218 frozen records, and the reviewed evidence-shape table, Decision, and alternative 1 use 17 relayed records (164 direct-shaped / 26 quoted-class-shaped / 17 relayed / 11 no-quoted-authority). The document therefore still presents incompatible research inputs.
  **Required action:** replace the remaining stale 15-record claim with the verified current evidence-shape count, then re-run this gate.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `73cf4c7e721e` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `ae0efcc88dc4f2ce38b31cdd381ed2b15704cd5e` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate; the document declares `status: draft` in the `draft/` lifecycle folder.
- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — mechanical judge confirmed a delimited frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — mechanical judge confirmed `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — mechanical judge confirmed `type: RULE` is one of the 11 allowed types.
- GATE-WRITE — `tags:` contains at least one non-empty value: PASS — mechanical judge found three non-empty tags.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem identifies the named scanner's live result of 404 approved documents, including 218 frozen approvals without routes, and the missing per-record disposition/binding.
- GATE-WRITE — Contains a reproduction condition: PASS — running `node scripts/harness/scan-standing-delegation-evidence.mjs` on the current tree reproduced `404` approvals with `137` DIRECT, `49` CLASS, and `218` frozen without routes.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — mechanical judge found no prohibited placeholder and a 14-sentence Problem.
- GATE-WRITE — `## Prior Art Research` present: PASS — mechanical judge found the section.
- GATE-WRITE — Prior Art Research substantiation: PASS — the section cites official Git object/data-model documentation and NIST SP 800-53 AU-9; the mechanical research scan passed.
- GATE-WRITE — Waiver alternative: PASS — substantiated research satisfies the permitted alternative, so no waiver is required.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — the verified 218-record evidence map is internally consistent at 164 direct-shaped / 26 quoted-class-shaped / 17 relayed / 11 no-quoted-authority; Git/NIST integrity evidence and the repository's immutable-adoption precedents support rejecting retroactive authority and choosing the immutable manifest.
- GATE-WRITE — All Architecture Review checklist items checked: PASS — mechanical judge found all five displayed checklist items checked.
- GATE-WRITE — Sibling scan recorded: PASS — the checked item names RULE-012, RULE-2326, and BACKLOG-ZERO-MIGRATION and the absence of an existing per-record disposition owner.
- GATE-WRITE — Alternatives with Pro/Con: PASS — mechanical judge found four alternatives, each with both.
- GATE-WRITE — Decision trade-off: PASS — alternative 4 explicitly accepts an additional immutable manifest in exchange for exact population binding, history preservation, and fail-closed drift detection.
- GATE-WRITE — New-surface placement: N/A — this changes repository-private harness policy and records only; it adds no package, app, presentation/interface surface, or product-family/layer boundary.
- GATE-WRITE — Completion Criteria prefixes: PASS — mechanical judge found five `TC-NN` criteria.
- GATE-WRITE — Completion-criteria coverage: PASS — TC-01 through TC-04 cover the manifest, non-authorizing disposition policy, fail-closed scanner behavior, and deterministic replay; TC-05 covers the RULE-2380 and AGREEMENT-2664 lifecycle projections.
- GATE-WRITE — Completion-criteria form: PASS — each TC names observable set/count, byte, scan, rejection, or exact lifecycle/path/status behavior rather than an implementation assertion.
- GATE-WRITE — No forbidden vague criterion phrase: PASS — mechanical judge found none.
- GATE-WRITE — `## Test Plan` present: PASS — mechanical judge found the section.
- GATE-WRITE — Test Plan coverage: PASS — five Test Plan rows correspond exactly to TC-01 through TC-05.
- GATE-WRITE — Test Type and Tool/Approach: PASS — mechanical judge found non-empty values and no `TBD` in all five rows.
- GATE-WRITE — Manual-test notes: PASS — no row uses `manual`.
- GATE-WRITE — Tasks placeholder: PASS — mechanical judge found the paired RULE-2380 Task placeholder.
- GATE-WRITE — Evidence Log first-run structure: PASS — mechanical judge found three prior GATE-WRITE attempts and no entry from a later gate; this is the bounded re-run of the same entry gate.
- GATE-WRITE — No body `## Status` or `## Classification`: PASS — mechanical judge found neither.

**Judged by:** `backlog-gate-guard` semantic evaluator + `gate.mjs` mechanical evaluator
**Judged at:** HEAD `73cf4c7e721e` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `424768f46c640f10b2d9ec4abf0ecb9d6964be45` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "RULE-2380의 immutable-manifest와 `PRESERVE_FROZEN` 처분안을 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** a6364fceac96 (review b569d404, type/tags d243ac8b)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a6364fceac96) equals the document's current fingerprint
- GATE-APPROVAL — The current recommendation has one independent endorsement bound to its stable subject-plus-projection key, wi: latest independent recommendation observation matches RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md's current stable endorsement key and records ENDORSE with 0 findings

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7c499909b989` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `d3f1f2b696c3` (tracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "RULE-2380의 immutable-manifest와 `PRESERVE_FROZEN` 처분안을 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** a6364fceac96 (review b569d404, type/tags d243ac8b)

- GATE-APPROVAL — Ordering check: PASS — recorded GATE-WRITE PASS upgraded this document to `review-ready`; the declared `recorded-pass` rule applies and the current status remains `review-ready`.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS — the recorded DIRECT instruction is verbatim, dated, and tied to this conversation.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — it names RULE-2380 and approves its immutable-manifest and `PRESERVE_FROZEN` decision.
- GATE-APPROVAL — Named delegated class exists and predates approval: N/A — the recorded route is DIRECT, not CLASS.
- GATE-APPROVAL — Authorising instruction is recorded verbatim with date and session: N/A — the recorded route is DIRECT, not CLASS.
- GATE-APPROVAL — Class evidence condition is measured: N/A — the recorded route is DIRECT, not CLASS.
- GATE-APPROVAL — Item is inside the delegated class boundary: N/A — the recorded route is DIRECT, not CLASS.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — recorded fingerprint `a6364fceac96` equals the current review fingerprint.
- GATE-APPROVAL — Current recommendation has one independent endorsement bound to its stable subject-plus-projection key with `ENDORSE` and zero unresolved findings: PASS — canonical ledger run `r20260920142613`, round 3, contains exactly one matching expectation/observation for `RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`, key `ebfcd838ab3893f9adb0c97ec6bb6ee4fe367101ba6e8a447845cc5ae1d7e1ed`, verdict `ENDORSE`, findings `0`.
- GATE-APPROVAL — Independent architecture validation: N/A — the spec adds repository-private harness scripts and records only; it introduces no package, app, interface surface, or layer/product-family boundary.
- GATE-APPROVAL — Implementation-before-approval non-compliance trigger: not triggered — current changes are gate evidence/ledger records only, and no implementation-path commit exists for the stated solution files.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `7c499909b989` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `2e8602bc0921f0665fcf7b2dc6b9769314bdeb14` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 359 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md",
  "specPath": ".agents/spec-docs/todo/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md",
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
    ".agents/spec-docs/todo/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md",
    ".agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

### [RECOMMENDATION-REVIEW] — ✅ ENDORSE | 2026-09-21

- Canonical loop run: `r20260920152818`
- Projection digest: `6532794718d787d56d3250eab1db23bbb6a7a6c707b3203bb56798be2c914c5d`
- Independent `proposal-reviewer` verdict: `ENDORSE` with 0 unresolved findings.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fb0cd58ce516` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/todo/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `2fa768e32e67` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs -t 'frozen disposition categories|the guard on the live tree' && node scripts/harness/scan-standing-delegation-evidence.mjs`
**Exit:** 0
**Output:** (last 10 of 15 line(s))

```
   ✓ frozen disposition categories > accepts one staged introduction and rejects later byte mutation  337ms
   ✓ frozen disposition categories > keeps the immutable manifest enforced after the current baseline shrinks to zero  504ms
   ✓ the guard on the live tree > passes, and reports the population it examined  5975ms

 Test Files  1 passed (1)
      Tests  9 passed | 49 skipped (58)
   Start at  00:29:53
   Duration  7.12s (transform 53ms, setup 0ms, collect 74ms, tests 6.84s, environment 0ms, prepare 47ms)

::examined:: 405 approved spec document(s); 138 DIRECT, 49 CLASS, 218 frozen (218 of them with no route at all); 2 registered class(es); 218 PRESERVE_FROZEN disposition(s)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `8bb334440b95` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `jq schema/disposition/reason assertions; compare all manifest paths with git diff; git diff --quiet origin/integration/agreement-2664 -- .agents/rules; assert paired Task/spec no-authority statements`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
true
manifest rows: 218/218 (100%); historical spec changes: 0/218 (0%); rule changes: 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `cf011c6bc9b5` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-4

 ✓ scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs (58 tests) 6793ms
   ✓ frozen disposition categories > keeps the immutable manifest enforced after the current baseline shrinks to zero  504ms
   ✓ the guard on the live tree > passes, and reports the population it examined  5967ms

 Test Files  1 passed (1)
      Tests  58 passed (58)
   Start at  00:29:53
   Duration  7.07s (transform 49ms, setup 0ms, collect 73ms, tests 6.79s, environment 0ms, prepare 40ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `eb8ab10ecb6d` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-21

**Command:** `run scan-standing-delegation-evidence.mjs twice and cmp outputs; assert zero manifest-path diffs; HARNESS_BASE_REF=origin/integration/agreement-2664 node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 10 of 220 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c34-c36-c33-c2v-c36-c2t-c37-c37-c19-c36-c2t-c34-c33-c36-c38-c19-c35-c39-c2p-c32-c38-c2x-c2u-c2x-c2r-c2p-c38-c2x-c33-c32 [finding] scan:progress-report-quantification
  evidence: Scan progress-report-quantification exited with status 1.
  recommendation: Inspect the progress-report-quantification scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

62 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (65 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (progress-report-quantification, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `90ed8a5faf74` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-21

**Command:** `assert four in-progress frontmatters, two exact parent RULE-2380 rows, vacant terminal targets, and the atomic completion plus issue-retention contract`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
pre-terminal projections: 4/4 in-progress (100%); parent rows: 2/2 exact (100%); terminal targets vacant; atomic completion contract present
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `6385474ab9f2` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-21

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm harness:scan:task-plan-items && node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 1 (    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:116:5) ⏎  ⏎ Node.js v22.14.0); `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` → exit 1 ( ❯ scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs:836:50 ⏎  ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm harness:scan:task-plan-items && node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 1 (    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:116:5) ⏎  ⏎ Node.js v22.14.0); `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` → exit 1 ( ❯ scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs:836:50 ⏎  ⏎ ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯)
  **Required action:** make every verify command exit 0

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `f5ac74573952` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-21

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21; status `in-progress`
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`). The `## Plan` SECTI: 5/5 tasks `[x]` in .agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md
- GATE-VERIFY — No Plan item is blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm harness:scan:task-plan-items && node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 0 (::examined:: 334 Task Plan sections ⏎ task-plan-items scan passed. ⏎ ::examined:: 405 approved spec document(s); 138 DIRECT, 49 CLASS, 218 frozen (218 of them with no route at all); 2 registered class(es); 218 PRESERVE_FROZEN disposition(s)); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` → exit 0 (   Duration  11.60s (transform 70ms, setup 0ms, collect 105ms, tests 11.25s, environment 0ms, prepare 63ms) ⏎  ⏎ 12:48:44 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `f294bd113600` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-21

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-21; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `95337d2fc021` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md` blob `e917fea8db7d` (modified)
