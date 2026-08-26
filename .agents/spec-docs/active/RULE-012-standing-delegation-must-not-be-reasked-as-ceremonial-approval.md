---
status: in-progress
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

- **CC-01** `gate-catalogue.md` § GATE-APPROVAL states both routes, and its example list no longer
  places a standing instruction under the direct-approval criterion.
- **CC-02** The delegated class and its registry are stated in exactly one document; a
  `conflict-markers`-style duplication check finds no second statement.
- **CC-03** The evidence form is stated once and is machine-parseable.
- **CC-04** The guard is registered in `run-all-scans.mjs` and fails closed on an unparseable entry.
- **CC-05** Every RULE-012 fixture direction has a case, and each FAIL fixture is proven red by
  mutation: reverting the guard's corresponding branch makes exactly that case pass.
- **CC-06** The corpus report exists with counts, and the disposition of failing entries is filed as a
  separate item, not decided here.

## Test Plan

- Fixture set, both directions, per RULE-012's enumeration.
- **Applied-check mutation** on each FAIL branch — a fixture that stays red when its guard branch is
  reverted is not testing that branch.
- Positive control: a document known to carry a _direct_ approval (`HARNESS-900`, whose standing
  verdict quotes `"승인하고 머지"`) must pass the direct route and must not be counted as class-based.
- Negative control: `ARCH-100`, whose own entry records a relayed provenance, must be classified by the
  guard rather than by reading its prose self-description.
- `pnpm harness:scan`, `pnpm harness:self-check`, full harness test tier.

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

**Route: DIRECT.** Recorded on the direct route deliberately. This document amends the definition of
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
