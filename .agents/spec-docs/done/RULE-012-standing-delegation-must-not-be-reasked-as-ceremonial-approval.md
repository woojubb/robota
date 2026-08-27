---
status: done
type: RULE
tags: [harness, governance]
---

# RULE-012: a standing delegation is recognised as GATE-APPROVAL only for a class registered in advance

## Problem

`gate-catalogue.md` § GATE-APPROVAL states two criteria that read as facts about the user:

```
- [ ] User has provided explicit approval in the current conversation
- [ ] Approval is a direct, unambiguous statement directed at this spec document
```

The same section then lists what counts as explicit approval, and the list includes
`"끝까지 책임지고 작업해"` — an instruction that is standing by construction and cannot be _"in the
current conversation"_ for the second item it authorises. **The gate's own criterion and the gate's own
examples disagree.** Nothing resolves that, so each session resolves it privately.

### Symptom 1 — the crack is load-bearing, and nobody agrees how wide it is

Three sessions counted the spec documents whose GATE-APPROVAL rests on a standing basis and produced
three different numbers, from the same tree, on the same day:

| Session   | Count | Buckets (relayed / quoted / bare) |
| --------- | ----: | --------------------------------- |
| earlier   |    27 | no derivation retained            |
| robota-20 |    43 | 6 / 29 / 8                        |
| robota-3  |    51 | 15 / 17 / 19                      |

Reproduction of the third, and of why the disagreement is _not_ an extraction bug:

Measured by splitting each document into its individual `### [GATE-APPROVAL]` entries and testing
only the verdict that stands — the last `✅ PASS` not marked withdrawn — for a standing-basis phrase
(`상시|standing|위임|delegat|끝까지 책임`):

```
docs with a GATE-APPROVAL entry        : 298
docs with >1 GATE-APPROVAL entry       :  23
standing basis, ANY entry              :  52
standing basis, FIRST entry only       :  48
standing basis, STANDING verdict only  :  51
```

Restricting to the verdict that actually stands moves the number by one. Taking only the first entry —
the extraction defect robota-20 found in their own instrument, where a _withdrawn_ verdict is read as
the document's basis — moves it by three. **The 27/43/51 spread is not explained by extraction. It is
explained by three different private definitions of "standing basis", because no definition exists.**

### Symptom 2 — the recorded evidence has no fixed form, so it cannot be audited

Of the 51, sampled by hand:

- `ARCH-100` records the delegation verbatim in a three-part form, and adds a
  **"Provenance limit, stated because it bounds this entry's strength"** — the delegation reached that
  session _by relay from another session_, which the entry itself says "is not squarely either" a PASS
  or a FAIL under the form it is citing.
- `HARNESS-117` cites ARCH-100 by path and does not restate the limit.
- `FLOW-004` quotes a real user sentence (`"모든 FLOW-* 전부 순차 진행해줘"`) in a bullet list.
- 19 assert a standing basis with **no quoted instruction at all**.

### Symptom 3 — the form being cited as normative was never made normative

Twelve documents cite RULE-012 by name; eleven cite _"the three-part form RULE-012 § Proposed
Direction requires"_. That form lives in a task record at `status: todo`, filed 2026-08-15, never
implemented:

```
$ find .agents -name '*RULE-012*'
.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md

$ grep -rn 'RULE-012' .agents/rules/ .agents/specs/ AGENTS.md
(no output)
```

**A proposal's Proposed Direction is being cited as the authority that admits the approvals.** The rule
was never amended; the documents behave as though it had been.

Five of them go further. `ARCH-104` … `ARCH-108` corroborate their approval against
`.agents/tasks/completed/RULE-012-…md` — **a path that does not exist**:

```
$ ls .agents/tasks/completed/RULE-012*
zsh: no matches found

$ ls .agents/tasks/RULE-012*; grep -m1 '^status:' .agents/tasks/RULE-012*
.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md
status: todo
```

Each of those five approvals rests on a _completed_ version of the rule that would authorise it, and
that completion never happened. The citation is unfollowable in the sense `claims-resolve` already
guards against elsewhere: a reference the next reader cannot open is not evidence, whatever it asserts.

### Reproduction condition

Any spec document reaching GATE-APPROVAL while the authorising instruction was given for a _class_ of
items rather than for that document. This occurs on every batch or delegated run, which is the normal
operating mode of this repository.

## Prior Art Research

Two documented mechanisms solve exactly this problem — standing authorization for a class of actions —
and both reach the same structural conclusion.

**1. ITIL 4 change enablement — the "standard change".** A standard change is
_"low-risk, repeatable, and pre-authorized… no individual authorisation is required per instance
because the procedure itself has been pre-authorised"_
([itsm.tools](https://itsm.tools/change-enablement/),
[IT Process Wiki](https://wiki.en.it-processmaps.com/index.php/Change_Management)). The load-bearing
detail is _what_ carries the authorization: a **change model registered in advance** — a documented
procedure. The authority attaches to the registered procedure, never to an implementer's claim after
the fact that this instance resembled a low-risk one. An unregistered change is a _normal_ change and
takes the full authorization path, however low-risk it looks.

**2. AWS IAM permissions boundaries.** A permissions boundary
_"defines the maximum permissions that the identity-based policies can grant to an entity, **but does
not grant permissions**"_, and the entity _"can perform only the actions that are allowed by both its
identity-based policies and its permissions boundaries"_
([AWS IAM User Guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)).
The canonical use is delegation: an administrator delegates user-creation to a delegate who _"can then
create new users with any permissions needed, but must assign them the permissions boundary policy"_.
The delegation is a **ceiling evaluated by the system**, not a grant the delegate argues about, and the
delegate cannot widen it by reasoning.

**What both say about this amendment.** A standing delegation is legitimate, and both fields treat it
as ordinary rather than exceptional. But in both, the class is **declared before the instance and read
by the mechanism**. Neither lets the party exercising the authority also be the party that decides the
instance is inside it. RULE-012's Proposed Direction asks the agent to _"show the item remains inside
that delegated class"_ — an argument the agent makes at approval time, which is the half neither prior
art permits to stand alone.

**No comparable reference was found** for a system that recognises a standing authorization _asserted
retroactively against an unregistered class_, which is the current de facto behaviour.

## Architecture Review

### Affected Scope

**Rule and gate documents:**

- `.agents/specs/gate-catalogue.md` — § GATE-APPROVAL criteria 1 and 2 (the owner of the contradiction)
- `.agents/rules/backlog-execution.md` — § Agent Decision Authority; the delegated-class definition and
  the registry pointer live here
- `.agents/rules/index.md` — routing entry if a new rule section is added

**Harness scripts:**

- `scripts/harness/scan-standing-delegation-evidence.mjs` (new) — the guard
- `scripts/harness/run-all-scans.mjs` — registration
- `scripts/harness/__tests__/` — the fixture set, both directions

**Corpus, read-only in this item:**

- `.agents/spec-docs/**` — 298 documents carrying a GATE-APPROVAL entry, 51 on a standing basis

### Alternatives Considered

**A1 — Prose amendment only (RULE-012's stated minimum).** Amend `gate-catalogue.md` criterion 1 to
admit a standing delegation in the three-part form; add the class definition to `backlog-execution.md`.

- Pro: smallest change; resolves the stated contradiction; no new scan to maintain.
- Con: **draws a boundary no mechanism reads.** Nothing would check that a document claiming a standing
  instruction is inside the class, which is the defect shape this repository files issues about. It
  also leaves the 51 existing records unsorted, since nothing can measure them.

**A2 — Reuse the four conditions in `backlog-execution.md` § Agent Decision Authority.** State the
existing agent-authority conditions as the approval class.

- Pro: no new vocabulary; the conditions are already written, already read, already cited.
- Con: they are written for **deciding during** work, not for **approving** a plan, and two of the four
  do not survive the move. _"The decision is reversible or has a low blast radius (e.g. internal
  cleanup, dead code removal, path constant extraction, naming fix)"_ — a spec document that reaches
  GATE-APPROVAL is an implementation plan, so by construction almost none qualify, and reading the
  condition loosely enough to admit them empties it. The set also omits **"novel repository practice"**,
  which RULE-012 expressly reserves; adopting it would silently widen the class past the filed proposal.

**A3 — Registered class + guard that reads the registry (chosen).** The delegated classes are
enumerated in one normative registry. A GATE-APPROVAL entry passing on a standing basis must name a
registry entry that existed before its own date, quote the instruction verbatim, and state the evidence
condition. A scan parses the entries and fails closed on any of the three.

- Pro: matches both prior arts — authority attaches to a pre-registered class, and the mechanism, not
  the applicant, decides membership. Makes the population **countable**, which is the only way the
  27/43/51 disagreement gets settled. Fails closed.
- Con: the largest change of the four; introduces a registry that must be maintained; a parser over
  prose evidence entries is inherently approximate and will need a documented acknowledgment path for
  entries it reads wrong.

**A4 — Reject the amendment; keep criterion 1 as written.** Rule that a standing instruction never
counts and every spec document needs a direct approval.

- Pro: no new machinery; the strictest reading; unambiguous.
- Con: leaves `gate-catalogue.md` self-contradictory, since its own example list admits
  `"끝까지 책임지고 작업해"`. Invalidates 51 recorded approvals with no sorting step, and makes the
  ceremonial re-ask that RULE-012 was filed against mandatory. The owner has ruled against this
  reading (2026-08-26).

### Decision

**A3.** The trade-off that drove it is the one A1 loses on: the amendment's entire purpose is to
replace a private per-session judgement with a shared one, and a boundary that no mechanism reads
leaves the judgement exactly as private as it is today. The three-number disagreement in Symptom 1 is
the proof — three careful sessions, one tree, one day, three answers. **The guard is not an add-on to
this amendment; it is the only part that changes the outcome.**

A2 is rejected on measurement rather than taste: its "reversible or low blast radius" condition
excludes the very documents the class must cover, and its omission of "novel repository practice"
would widen the class beyond what RULE-012 filed.

**The amendment sorts the existing 51; it does not absolve them.** A registered class cannot have
existed before a document that predates the registry, so no existing entry is retroactively validated
by construction. The guard reports them; what happens to the ones that fail is an owner decision and is
explicitly out of this item's scope — a rule edit is not the place to dispose of 51 records.

### Architecture Review Checklist

- [x] Affected package/layer list complete — 3 rule/gate documents, 3 harness script paths, 1 read-only
      corpus of 298 documents
- [x] Sibling scan complete — `N/A for new-surface placement`: this adds no package, app, presentation
      or interface surface and reclassifies no layer or product-family boundary. Sibling _gate_ guards
      checked: `backlog-placement` (terminal status ↔ `completed:` date), `task-archival` (the
      half-finished move), `user-execution-plan-order` (checkpoint ancestry). None of the three reads
      GATE-APPROVAL evidence, so the new scan duplicates no existing check.
- [x] At least 2 alternatives reviewed — A1–A4, four
- [x] Decision rationale documented — the A1 trade-off (unenforced boundary), the A2 measurement
      (two of four conditions do not survive the move), and the explicit non-goal of retroactive
      validation

## Fallback & Degradation Declaration

None. The guard fails closed: an evidence entry it cannot parse is a FAIL, not a pass. The
acknowledgment path for a misread entry is the ledger form already used by
`progress-report-quantification`, which records a `false-positive` kind with its reason rather than
suppressing the finding class.

## Solution

### Phase 1 — Resolve the contradiction in the gate's own text

`gate-catalogue.md` § GATE-APPROVAL criterion 1 becomes two mutually exclusive routes — a **direct**
approval, or a **class** approval — with the example list split so that
`"끝까지 책임지고 작업해"` sits under the route it actually belongs to.

### Phase 2 — Define the class and its registry

`backlog-execution.md` gains the delegated-class definition and the registry. The registry is the SSOT;
`gate-catalogue.md` points at it and does not restate it.

### Phase 3 — Fix one evidence form

One form, so that class-based and direct passes are distinguishable at a glance and countable by
machine. Four required fields: route, registry entry named, instruction verbatim, evidence condition.

### Phase 4 — The guard

`scan-standing-delegation-evidence.mjs`, with RULE-012's fixture set in both directions: PASS for a
registered class + verbatim instruction + proven condition; FAIL for no delegation, a delegation from
an unregistered class, an unmet condition, and a user-reserved decision outside the class.

### Phase 5 — Report the corpus, decide nothing

Run the guard over the 298 and report the sorted counts. **File the disposition question; do not answer
it inside this item.**

## Affected Files

| File                                                    | Change                                     |
| ------------------------------------------------------- | ------------------------------------------ |
| `.agents/specs/gate-catalogue.md`                       | GATE-APPROVAL criteria 1–2 split by route  |
| `.agents/rules/backlog-execution.md`                    | Delegated-class definition + registry SSOT |
| `.agents/rules/index.md`                                | Routing entry if a section is added        |
| `scripts/harness/scan-standing-delegation-evidence.mjs` | New guard                                  |
| `scripts/harness/run-all-scans.mjs`                     | Registration                               |
| `scripts/harness/__tests__/…`                           | Fixture set, both directions               |
| `.agents/tasks/RULE-012-…md`                            | Status transition                          |

## Completion Criteria

Labelled `CC-N` at GATE-IMPLEMENT and renamed to the catalogue's `TC-N` vocabulary at GATE-COMPLETE.
The mapping is identity — CC-01 is TC-01 — and no criterion was added, dropped or reworded.

- [x] **TC-01** `gate-catalogue.md` § GATE-APPROVAL states both routes, and its example list no longer
      places a standing instruction under the direct-approval criterion.
- [x] **TC-02** The delegated class and its registry are stated in exactly one document; no second
      statement exists.
- [x] **TC-03** The evidence form is stated once and is machine-parseable.
- [x] **TC-04** The guard is registered in `run-all-scans.mjs` and fails closed on an unparseable entry.
- [x] **TC-05** Every RULE-012 fixture direction has a case, and each FAIL fixture is proven red by
      mutation: reverting the guard's corresponding branch makes exactly that case pass.
- [x] **TC-06** The corpus report exists with counts, and the disposition of failing entries is filed as
      a separate item, not decided here.

## Test Plan

All cases live in `scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`.

| TC    | Kind              | Reference                                                                                                                                                                                                                                                               |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Rule-text         | `the rule states criteria this guard can read > reads the form field labels out of the rule rather than restating them`                                                                                                                                                 |
| TC-02 | Rule-text         | `the rule states criteria this guard can read > reads a registry table, and an empty registry is valid rather than a parse failure`                                                                                                                                     |
| TC-03 | Unit (falsifying) | `the rule states criteria this guard can read > pins the exact labels, so a silent form change cannot carry the fixtures with it`                                                                                                                                       |
| TC-04 | Integration       | `the guard on the live tree > passes, and reports the population it examined`, plus the `MANDATORY_TREE_GUARDS` entry in `scan-guard-scope-fail-closed.mjs` that executes it against a root without its governed tree                                                   |
| TC-05 | Unit, both ways   | `PASS fixtures` (2 cases) and `FAIL fixtures` (5 cases), each FAIL branch proven by applied-check mutation                                                                                                                                                              |
| TC-06 | Skipped — reason  | The guard prints the corpus counts on every run and the disposition is issue #2380. **Deliberately not automated:** an assertion that a decision was _not_ taken is not a test, and pinning today's counts would fail on every legitimate future routing of a document. |

Beyond the TC rows:

- Positive control: a document carrying a _direct_ approval must pass the direct route and must not be
  counted as class-based — covered by `the verdict that counts is the last one that stands`.
- Negative control: `ARCH-100`'s relayed provenance must be classified by the guard rather than by its
  prose self-description — covered by `a citation the next reader cannot open is not evidence`.
- Counter provenance: an exact count against a fixture of known size, asserted again after a second run
  of the finder — `the declared size is a counter a test reads, not self-reported prose`.
- `pnpm harness:scan` and the full harness test tier.

## Corpus Report (Phase 5)

Produced by the guard over the frozen set, so the number is reproducible rather than argued. This is
the answer to the 27/43/52 disagreement: none of the three, because all three were answering a question
with no definition.

```
218 approved spec document(s); 1 DIRECT, 0 CLASS,
217 frozen (217 of them with no route at all); 0 registered class(es)

FROZEN SET: 217
  no standing basis (direct-shaped)  : 165
  standing + a quoted instruction    :  26
  standing via a relayed delegation  :  15
  standing asserted, no quote at all :  11
```

**52 rest on a standing basis** — and they do not sort into one disposition, which is why this item does
not take one:

- The **165** show no standing basis at all. Adding `**Approval route:** DIRECT` and the instruction
  they already quote would route most of them; the work is clerical, not a judgement.
- The **26** quoted their instruction and, in the better cases, measured the evidence condition.
  `INFRA-100` is the model: it quotes _"내가 승인하는게 아니라 근거가 타당하면 너가 알아서 승인하고
  넘어가야지"_ verbatim and then reproduces seven specific failures to satisfy the condition. It had
  everything the CLASS route asks for except a registered class to point at — which did not exist.
- The **15** chain to `ARCH-100`'s delegation, which reached that session **by relay**. `ARCH-100` says
  so itself, in a paragraph headed _"Provenance limit, stated because it bounds this entry's strength"_.
  RULE-012's own FAIL enumeration lists "delegation from unrelated context", so these sit on the
  fixture rather than beside it. Five of them (`ARCH-104`…`ARCH-108`) additionally corroborate against
  `.agents/tasks/completed/RULE-012-…md`, a path that has never existed.
- The **11** assert a standing basis and quote nothing. No form recovers these; only a person can say
  what the instruction was.

**The disposition is not decided here, and the reason is the rule this item is writing.** Re-approving
52 documents, or voiding them, is a decision about repository policy with a wide blast radius — it is
outside every delegated class by the exclusions this amendment itself sets, so an agent taking it
inside a rule edit would be the exact move the rule forbids. Filed as a separate item with these
counts attached.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable** to this item. It delivers no user-facing product
behaviour: it amends two harness governance documents and adds one repository verification scan. No
package, app, CLI command, TUI surface or published API changes, so there is no command a user of the
product could run to observe a difference. The verification surface is the harness gate — the
both-direction fixture set, the applied-check mutation over every FAIL branch, and `pnpm harness:scan`.
This matches the surface `HARNESS-117` recorded for the same shape of change.

## Tasks

Bound task record: `.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`

1. Phase 1 — gate-catalogue split
2. Phase 2 — class + registry in backlog-execution
3. Phase 3 — evidence form
4. Phase 4 — guard + fixtures + mutation proof
5. Phase 5 — corpus report + file the disposition item

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-26

**Status upgrade:** draft → review-ready

**Frontmatter.** `---` block present; `status: draft`; `type: RULE` (in the 11-prefix list);
`tags: [harness, governance]`.

**Problem.** Concrete symptom: the gate's criterion 1 and its own example list disagree, quoted from
`gate-catalogue.md`. Three measured symptoms with commands and outputs — the 27/43/51 count spread,
the four evidence forms, the unimplemented RULE-012 citation and its five phantom `completed/` paths.
Reproduction condition stated as its own subsection. No "TBD"/"TODO"/single-sentence descriptions.

**Prior Art Research.** Two documentation sources, both product/practice documentation rather than
third-party source: ITIL 4 change enablement (standard change / pre-authorised change model) and the
AWS IAM User Guide (permissions boundaries as delegation). Both feed `Alternatives Considered` and
`Decision` — A3 is chosen _because_ both prior arts register the class in advance and let the
mechanism decide membership, which is the half A1 omits. The gap is stated explicitly: no comparable
reference was found for retroactive assertion against an unregistered class.

**Architecture Review Checklist.** All 4 items `[x]`. Sibling scan `[x]` with an explicit
`N/A for new-surface placement` reason plus the three sibling gate guards checked for duplication.
Alternatives Considered has 4 entries, each with pro and con. Decision names the driving trade-off
(A1's unenforced boundary) and the measurement that rejects A2.

**Mechanical verification:**

```
$ node scripts/harness/check-spec-doc-frontmatter.mjs
::examined:: 314 spec documents
spec-doc frontmatter scan passed.   EXIT=0

$ node scripts/harness/check-backlog-placement.mjs
backlog-placement scan passed.      EXIT=0
```

### [GATE-APPROVAL] — ✅ PASS | 2026-08-26

**Status upgrade:** review-ready → approved

**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인, 가드 포함해서 진행 (권장)"
**Given:** 2026-08-26, this conversation

Recorded on the direct route deliberately. This document amends the definition of
the class route; approving it _on_ the class route would be self-justifying, and the registry the
class route depends on does not exist until this item builds it. **This amendment does not bootstrap
itself.**

**1 — Explicit approval in the current conversation.** The owner was asked in this session, in a
question that stated the circularity in full, named issue #2371, and offered rejection as an option.
Verbatim selection, 2026-08-26:

> 승인, 가드 포함해서 진행 (권장)

The selected option read: the reported delegated-class decision is recognised as real and as approval
of this item; the amendment is to be written; and the one thing not to be traded away is the
mechanical guard that reads the class boundary.

**2 — Directed at this spec document.** The question named issue #2371 and the amendment as its
subject, and offered "개정 거부, 규칙 유지" as an alternative the owner did not take. It is not
approval of a different item in the same conversation: no other item was under discussion at the time
of the question.

**Provenance, stated because this item is about provenance.** A peer session (`robota-20`) reported
that the owner had made a related decision in a _different_ session, phrased "위임된 부류로 인정
(규칙 개정)". **That report is not the basis of this entry and was not acted on.** A peer's paraphrase
of a user decision is not criterion 1 under any reading, and on this item of all items an approval
laundered through a relay would prove nothing. The approval above was obtained directly, here, after
that report and independently of it.

**3 — No Architecture Review or frontmatter type/tags modified after approval.** `type: RULE`,
`tags: [harness, governance]` unchanged from GATE-WRITE.

**4 — Independent architecture validation: N/A.** This introduces no package, app, presentation or
interface surface and reclassifies no layer or product-family boundary. It adds harness rule text and
one repository verification scan — the same shape as `HARNESS-117`, which passed on that basis.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-26

**Status upgrade:** approved → in-progress

**Tasks file path.** `.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`,
bound from this document's `## Tasks` section. Paired spec:
`.agents/spec-docs/active/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`

**Tasks created**, one per Completion Criterion:

1. Phase 1 — gate-catalogue route split (CC-01)
2. Phase 2 — delegated class + registry, stated once (CC-02)
3. Phase 3 — one machine-parseable evidence form (CC-03)
4. Phase 4 — the guard, registered and failing closed (CC-04), with every RULE-012 fixture direction
   covered and each FAIL branch proven by applied-check mutation (CC-05)
5. Phase 5 — corpus report, disposition filed rather than decided (CC-06)

**Test Plan.** Present in the bound task record, and extended in this document's `## Test Plan` with
the applied-check mutation requirement, a positive control (`HARNESS-900`, a direct-route approval
that must not be counted as class-based) and a negative control (`ARCH-100`, whose relayed provenance
must be classified by the guard rather than by its own prose).

**Exact PLAN outcome.** `SCENARIO DRAFTED: not-applicable | 0` — recorded in the bound task's
`## User Execution Test Scenarios`, with its reason: the item delivers no user-facing product
behaviour, so the verification surface is the harness gate.

**Whole-worktree path inventory.** The whole-worktree contains exactly the paired planning artifacts
and nothing else:

```
M  .agents/tasks/RULE-012-…-ceremonial-approval.md          (todo → in-progress, PLAN added)
A  .agents/spec-docs/active/RULE-012-…-ceremonial-approval.md
D  .agents/spec-docs/todo/RULE-012-…-ceremonial-approval.md
```

No implementation path is staged, unstaged, untracked, renamed or deleted. Implementation begins in
the commit after this checkpoint.

### [GATE-VERIFY] — ✅ PASS | 2026-08-27

**Status upgrade:** in-progress → verifying

Recorded after the state was reached, not to reach it. Every command below was run against the
committed tree, after the last commit, and the outputs are quoted rather than summarised.

**Tasks.** All five Phase tasks in the bound task record are complete; none is blocked or pending.
The record carries no unchecked `- [ ]` item.

**Build.** No package is affected — the change is harness scripts and governance documents:

```
$ git diff --name-only origin/develop...HEAD | grep -c '^packages/'
0
```

**Tests.**

```
$ npx vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs
Tests  18 passed (18)

$ node scripts/harness/harness-test-tiers.mjs --tier all
Test Files  252 passed (252)
Tests       5064 passed (5064)
HARNESS_TIER_EXIT=0
```

The tier's stdout contains `✗ functional-coverage` and a `spec-research scan: FINDINGS` line. **Both
were checked rather than read past**, because an exit code over a printed `✗` is exactly what
"silence is not success" refuses:

```
$ ls .agents/spec-docs/draft/SPEC-004-d.md
No such file or directory                 <- a fixture, not a document in this tree
$ node scripts/harness/check-functional-coverage.mjs   EXIT=0
$ node scripts/harness/scan-spec-research.mjs          EXIT=0
```

They are fixture output from cases that exercise those scans' failure paths.

**Scans.**

```
$ node scripts/harness/run-all-scans.mjs
147 scans passed (97 declared what they examined)      EXIT=0
✓ standing-delegation-evidence
::examined:: 218 approved spec document(s); 1 DIRECT, 0 CLASS,
             217 frozen (217 of them with no route at all); 0 registered class(es)

$ node scripts/harness/scan-user-execution-plan-order.mjs
::examined:: 4 topic commit(s)                          EXIT=0
```

**Two defects found and fixed during verification, both the same shape and worth naming.** A fenced
example that reproduces a `### …` heading is still a line beginning with `###`.
`new-rule-declares-enforcement` read the form's fenced `### [GATE-APPROVAL]` line as a **new rule
section** and demanded it declare its enforcement — a phantom rule created by writing down an example.
This scan's own `parseRegistrySection` had the mirror image: it ended the section at that same fenced
line, so the form it documents read as absent and the guard failed closed for the one reason a guard
must not — its criteria being present and unread. Both fixed; the fences no longer carry a `###` line,
and the section parser tracks fences.

**CC-05, the mutation proof.** Reverting each FAIL branch and re-running:

```
verbatim-instruction branch   -> 1 case flips
class-id branch               -> 1 case flips
registry-membership branch    -> 1 case flips
retroactive-date branch       -> 1 case flips
route branch                  -> 3 cases flip
restored                      -> 18 passed
```

The route branch killing three is recorded as measured, not claimed as one-to-one: route is the first
gate, so three cases depend on reaching it.

**CC-06 filed, not decided.** Issue #2380 carries the corpus counts and the disposition question.
Re-approving or voiding 52 records is repository policy with a wide blast radius, and this amendment's
own exclusions put it outside every delegated class — including the one it adds, that a class may not
approve a change to what delegation means.

**Test Plan item checked explicitly:** `INFRA-100`'s recorded approval remains valid. It is in the
frozen set, so the amendment does not disturb it; on inspection it is the model a CLASS entry should
look like — the instruction quoted verbatim and the evidence condition satisfied by reproducing seven
specific failures. It lacked only a registered class to point at, which did not exist.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-27

**Command:** `grep -c 'Route DIRECT\|Route CLASS' .agents/specs/gate-catalogue.md`
**Output:** `4` (two route headings, two references) — exit 0.

§ GATE-APPROVAL now opens with "Approval reaches this gate by exactly one of two routes" and states
each route's criteria separately. The example list is split: `"끝까지 책임지고 작업해"` moved out of the
direct-approval list into **What counts — Route CLASS**, with the reason stated inline — it is standing
by construction and cannot be in the current conversation for the second item it authorizes.
**Test reference:** TC-01 row in `## Test Plan`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-27

**Command:** `grep -rc 'Delegated Approval Classes' .agents/rules/*.md .agents/specs/*.md`
**Output:** `backlog-execution.md:1`, `gate-catalogue.md:2` — exit 0.

The class and registry are **stated** once, in `backlog-execution.md`. The two occurrences in
`gate-catalogue.md` were checked to be pointers rather than a second statement:

```
$ grep -nE 'Class ID|Registered\b|Never inside any class|registry ships empty' .agents/specs/gate-catalogue.md
(no output)
```

No registry row, no class boundary, and no exclusion is restated there. **Test reference:** TC-02 row.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-27

The form is stated once, in the same section, and is parsed by `parseEvidenceForm` — the labels are
read out of the rule rather than hard-coded, so the scan cannot confirm its own assumption.

**Falsification, run rather than argued:**

```
$ sed -i 's/\*\*Approval route:\*\*/**Approval path:**/g' .agents/rules/backlog-execution.md
× pins the exact labels, so a silent form change cannot carry the fixtures with it
× reads the form field labels out of the rule rather than restating them
× accepts a DIRECT approval quoting the instruction
  (… and every case that depends on the parsed form)
$ # restored
Tests  18 passed (18)
```

**Test reference:** TC-03 row.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-27

**Command:** `grep -c standing-delegation-evidence scripts/harness/run-all-scans.mjs`
**Output:** `2` (the name and its command) — exit 0. Confirmed running in the aggregate:
`✓ standing-delegation-evidence` in a `147 scans passed` run.

**Fails closed, measured against a root without its governed tree:**

```
$ findEvidenceFindings('<temp root with the rule but no spec-docs tree>')
FAILS CLOSED: standing-delegation-evidence: .agents/spec-docs/done missing from /tmp/…
```

Classified in `MANDATORY_TREE_GUARDS`, so the behaviour is executed on every run rather than asserted
here once. **Test reference:** TC-04 row.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-27

**Command:** `npx vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`
**Output:** `Tests  18 passed (18)` — exit 0.

Both directions are covered: 2 PASS fixtures, 5 FAIL fixtures. Every FAIL branch was reverted in turn
and the suite re-run:

```
verbatim-instruction branch   -> 1 case flips
class-id branch               -> 1 case flips
registry-membership branch    -> 1 case flips
retroactive-date branch       -> 1 case flips
route branch                  -> 3 cases flip
restored                      -> Tests  18 passed (18)
```

The route branch killing three is recorded as measured, **not claimed as one-to-one**: route is the
first gate, so three cases must reach it before their own branch. **Test reference:** TC-05 row.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-27

**Command:** `node scripts/harness/scan-standing-delegation-evidence.mjs`
**Output:**

```
::examined:: 218 approved spec document(s); 1 DIRECT, 0 CLASS,
             217 frozen (217 of them with no route at all); 0 registered class(es)
```

exit 0. The `## Corpus Report` section carries the four-way sort. The disposition is **issue #2380**,
filed with the counts and not decided here.

**Test: skipped, with reason.** An assertion that a decision was _not_ taken is not a test, and pinning
today's counts would fail on every legitimate future routing of a document. The counts are printed by
the guard on every run instead, which is the durable form. **Test reference:** TC-06 row states the
same skip reason.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-27

**Status upgrade:** verifying → done

All six TC-N are `[x]` with a matching Evidence entry above; each carries the command, the observed
output, and an exit code where one applies. Every TC-N in `## Test Plan` has a test reference, except
TC-06 which carries an explicit skip reason. None is silently unaddressed.

`## Tasks` names the exact active task path
`.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`; that record
exists, has no unchecked, pending or blocked item, and is completion-ready.

**What this item did not do, stated because the omission is deliberate.** It registered no delegated
class. The registry ships empty, so on merge every spec document still takes Route DIRECT — the
behaviour before this rule. **The amendment grants its author no authority it did not already have**,
which is the only shape in which an agent should land a change to what approval means.

### [GATE-VERIFY] — ✅ PASS | 2026-08-27 (re-run after the pre-push review)

**Status unchanged:** done. This entry records what the mandatory local review found in this item's
OWN guard, and what it cost. Recorded because the alternative — a review that finds nothing in 313
lines it just wrote — is the finding.

**Three defects, all the same shape: a property read off the whole entry instead of the one line that
states it.**

1. **`/withdraw/i` tested the entry's own text.** A withdrawal is not written on the entry it retires;
   the corpus records it as a separate `🔴 NON-COMPLIANCE` entry naming the pass above it. Measured on
   the live tree:

   ```
   files mentioning withdraw: 11 | misclassified: 2
   DROPPED ALL PASSES: .agents/spec-docs/done/SEC-015-hook-outcome-contract.md
   NOT THE LAST PASS:  .agents/spec-docs/active/HARNESS-900-….md
   ```

   `HARNESS-900`'s standing pass _explains_ that an earlier one stays withdrawn, so the valid verdict
   carried the word. `SEC-015` used it in prose about the document's own earlier claim, and **every
   pass was dropped — the document vanished from the population unjudged.** That is the worse of the
   two and the reason this was rewritten rather than patched: a guard that silently stops reading a
   document has not found nothing, and its count says otherwise.

2. **The verdict KIND was read off the whole entry.** A NON-COMPLIANCE entry quotes the
   `✅ PASS` it withdraws, so the withdrawal itself was detected as a pass. Found because the fixture
   written for defect 1 failed against correct code.

3. **The later-withdrawal branch had no case at all.** `M7 → 0 cases killed`: the code was written and
   nothing proved it worked. In an item about checks that cannot fail, an unfalsifiable branch of the
   guard is the defect, not a gap in coverage.

**All three now falsifiable:**

```
M6  first-instead-of-last pass      -> 2 cases killed
M7  later-withdrawal check disabled -> 1 case killed
M8  kind read off the whole entry   -> 1 case killed
restored                            -> Tests 21 passed (21)
```

**Corpus delta, checked rather than regenerated blind.** The baseline moved 217 → 218 and the exact
delta was printed before writing it:

```
ADDED to baseline  : 1
   + done/SEC-015-hook-outcome-contract.md
REMOVED (key moved): 0
```

One addition — the document that had been invisible. Nothing entered silently.

**Re-verified:**

```
$ node scripts/harness/run-all-scans.mjs
147 scans passed (97 declared what they examined)      EXIT=0
$ node scripts/harness/scan-standing-delegation-evidence.mjs
::examined:: 219 approved spec document(s); 1 DIRECT, 0 CLASS,
             218 frozen (218 of them with no route at all); 0 registered class(es)
```

TC-05's mutation record above is superseded by M6–M8 for the verdict-selection branches; the five
classification branches it lists are unchanged and were re-run green.
