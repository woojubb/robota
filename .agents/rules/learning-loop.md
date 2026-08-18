# Learning Loop Rules

Mandatory rules for turning repeated work lessons into durable repository safeguards.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Lesson Capture

- The procedural "how" for turning repeated lessons into enforced repo rules is the [lesson-to-harness](../skills/lesson-to-harness/SKILL.md) skill (mine → approve → normalize → wire every touchpoint → enforce → ship). Invoke it on **either** a repeated user correction / an explicit "from now on …" principle, **or** a recurring agent/technical failure class — the same _kind_ of failure hit 2×+ in a session even with no user correction (e.g. fixing the same category of CI/scan failure twice). A recurring agent mistake is a first-class lesson trigger, not only user corrections; when you find yourself fixing the same _class_ of failure a second time, invoke the loop.
- **Fixing an instance never closes a recurring mistake.** For any recurring failure, the only terminal state is a mechanical PREVENTION that stops the cause from recurring (steps 8–9 of the skill: mechanize, or infeasible-now + tracked backlog, then prove it fails pre-fix). Correcting the current occurrence without analyzing the cause and preventing recurrence leaves the lesson open.
- When a problem, review comment, CI failure, user correction, or debugging pattern repeats, do not leave it only in chat, PR notes, or a task file.
- Extract the general invariant behind the event. The rule must be domain-neutral unless the invariant belongs to a package SPEC.
- Record the invariant in the narrowest owner document:
  - `.agents/rules/` for repository-wide constraints;
  - `.agents/skills/` for procedural workflow;
  - `packages/*/docs/SPEC.md` for package contracts;
  - harness or hook code when the invariant can be checked mechanically.
- **The repo is the single source of truth for persistent lessons; memory-only recording is prohibited.** The full rule — what counts as durable, where the mirror lives, and that the repo write happens in the same change — is owned by [memory-mirroring.md](memory-mirroring.md) and is not restated here.

### Contradiction Between Rules

- **A contradiction between two rules is a defect of the rule set, and closing the instance does not
  close it.** When one document's normative claim negates another's, correct the losing text AND ask
  what let the pair diverge — usually one fact written in two places. Prefer deleting the restatement
  to keeping both and checking them.
- **A rule believed wrong is still in force until amended**, and a filed backlog item is the minimum
  evidence of an amendment attempt — [rules/index.md](index.md) § "Amendable by amendment" owns that
  bar. Recording a contradiction without filing anything leaves the rule set as contradictory as it
  was.
- **The precedence chain resolves a conflict for a reader; it does not license one.** Precedence says
  which side wins when two texts disagree. It is not a reason to leave them disagreeing: a rule a
  reader must override to obey another rule has failed at the only job a rule has.
- **When landing a rule, sweep for what it now contradicts** — skills, drafts, specs, registries and
  in-repo memory, not only the rules tree — and record the sweep and its result in the same change. A
  MUST is not in force while another document permits its negation.

### Mechanisms Land on a Cycle, Not on Every Lesson (owner decision)

**Between cycles, a lesson is RECORDED, not mechanized.** Correct the instance, write the invariant
where it belongs, and note the mechanism it would take. Building that mechanism waits for the next
harness cycle, when they are designed together instead of one at a time.

**Recorded means COUNTED, in [`.agents/evals/lessons/recurrence-ledger.md`](../evals/lessons/recurrence-ledger.md).**
One row per mistake CLASS, with a count that only rises. Find the class before adding a row — a new
row for something already listed hides the recurrence, which is the one thing the ledger exists to
prevent. The counts are what the next cycle prioritises by, so a class nobody incremented is a class
the cycle will not see.

**The count is never reset and the row is never deleted because a mechanism landed.** The row records
what was built and at what count, so a later increment is evidence that the mechanism did not work —
and that class goes back to the top of the next cycle, carrying how many times it has now survived a
fix. A ledger cleared when a mechanism ships can only say the mechanism was built; this one says
whether it worked.

**A class ages out instead.** Every entry carries its date, and a class not seen for 90 days is
RETIRED at the next cycle — moved to the ledger's `Retired` section with its count and dates intact.
Retirement is the claim that the class stopped happening, which is a different claim from a mechanism
having shipped; conflating them is how a mechanism that shipped and did not work disappears from the
record. A retired class that recurs comes back with its OLD count carried forward, because a class on
its third return has said three times that what was done about it was not enough.

**On a cycle, the recorded lessons are worked as a batch** — and the batch begins by auditing what
already exists, so new checks are added against a measured picture rather than on top of one.

Why, measured: over seven days, 72 of 87 commits were harness, hook or rule work, and the five
mechanisms added in a single session drew twenty review findings of their own. One-at-a-time is what
produced that: each lesson arrives mid-task, the mechanism is written beside the work that prompted
it, and nothing looks at the set. At this size the marginal mechanism prevents a narrow past mistake
while introducing a broader new one.

What an audit asks of every existing check, one question each: **can it be shown to fail?** A check
with no case asserting a non-empty finding has never been shown to do anything. One was found exactly
this way — its cases tested two helper functions and never called the finder, so both halves could be
right while the scan reported nothing.

The cadence is an owner decision and changes by owner decision. What it changes is WHEN a lesson
reaches a terminal state, never WHICH states are terminal — and that reconciliation is written into
§ "Enforcement Preference" below rather than asserted here. Review was right to refuse the assertion:
this file's own § "Contradiction Between Rules" says a MUST is not in force while another document
permits its negation, and "it does not weaken the rules below" is a claim about a contradiction, not
an amendment of one.

### Enforcement Preference

- **A prose rule alone does not close a lesson.** Every institutionalized lesson MUST reach one of exactly
  two terminal states: (a) **mechanized** — a harness scan FAIL, a hook check, a unit/scenario test, or a
  package-local contract test that trips on the violation; or (b) **infeasible-now** — a written, concrete
  reason mechanization is not yet practical PLUS a tracked backlog/task item to add it. "Will be careful,"
  "documented in the rule," "when practical," and untracked follow-ups are NOT terminal states.
- **A lesson RECORDED between cycles is OPEN, not closed, and the two terminal states above are what
  closing it means.** This is the reconciliation with § "Mechanisms Land on a Cycle" above, and it is
  written here because that section changes WHEN a lesson closes and this one owns WHAT closing is.
  A ledger row is not a third terminal state — it is the tracked item that keeps an open lesson
  visible until the cycle reaches it, which is what (b) already requires of anything not yet
  mechanized. What the cadence removes is the obligation to build the mechanism in the SAME CHANGE
  as the lesson; what it does not remove is the obligation to build one.
- Mechanize **by default**: reach for a check whenever the violation is detectable with reasonable signal.
  The burden is to justify NOT mechanizing (a specific obstacle), never to justify mechanizing — and
  "the next cycle owns it, and the class is counted in the ledger" IS that specific obstacle, for as
  long as the cycle is the owner's chosen cadence. It is not a standing excuse: a class whose count
  keeps rising past a cycle that did not reach it is the case § "Mechanisms Land on a Cycle" sends
  back to the top of the next one.
- **Say which state was reached, in the rule itself.** A rule declares ``Enforced by: `<check>` `` or
  `Enforced by: nothing — <why a machine cannot decide this>`. Both are answers; silence is not, and
  silence is precisely what a reader cannot tell from enforcement. This paragraph was already the
  rule and nothing checked it, so the step was skippable — and a rule did land here as three
  paragraphs with no mechanism, no filed item, and no admission that it had neither.
  Enforced by: `new-rule-declares-enforcement`, which reads the change's own diff: a `###` section
  added under `.agents/rules/` must carry one of the two declarations.
- **Prove the loop.** The clause below is the sibling of "Prove the check", and it exists because the
  asymmetry ran the wrong way: a wrong scan exits 1 locally and someone reads the message, while a wrong
  orchestration fails by DISPATCHING — it spends a fan-out before anyone learns the routing was wrong. A
  new loop-driving skill must have been driven END TO END to a terminal signal at least once before it is
  registered, and the proof is the ARTIFACT of that run — a closed entry in its `.agents/loop-runs/`
  ledger — not an assertion that it was tried. Where a real run is genuinely not obtainable, declare
  `proof: none — <why>` in the skill's frontmatter; both are answers, and silence is what a reader cannot
  tell from proof. This establishes that a terminal signal was reached once; it does not establish that
  the run exercised the loop's hard path, and it does not claim to.
  Enforced by: `scripts/harness/scan-loop-proof.mjs`, registered as `loop-proof`, which reads the skills
  tree, the ledgers and a shrink-only frozen baseline of the skills that predate the floor.
- **Fix the class, not the instance.** When a lesson comes from a concrete defect, name the invariant
  (the class), enumerate every current instance of it in the repo, fix them all in the same change, and
  make the mechanism catch the whole class so a future sibling instance fails. Fixing only the triggering
  instance leaves the lesson open.
- **Prove the check.** A new check must demonstrably FAIL on the triggering incident (or a fixture that
  reproduces it) and PASS after the fix; a check that would not have caught the original event is not
  enforcement. Record the before/after result.
- Any new mechanical enforcement must include its own test coverage and must not broaden checks beyond the
  changed or owned scope without a documented reason.
- A recurring auto-lesson candidate (e.g. in `.agents/evals/lessons/`) that keeps accruing frequency with
  no mechanism is an **open** lesson — promote it to a mechanism or record why it cannot be, do not let it
  sit as a perpetual candidate. The recurrence ledger is where "keeps accruing" is now MEASURED rather
  than felt, so this bullet has a number behind it for the first time.

### Pattern Generalization

- Do not add user-specific, prompt-specific, branch-specific, or incident-specific examples as rules.
- Convert incidents into reusable language: trigger, invariant, correct behavior, and verification method.
- If the same correction has occurred more than once, treat it as a candidate for `common-mistakes.md` or automated harness enforcement.
- When fixing a repeated failure, update the governing rule or check in the same PR whenever feasible.

### Contract Before Automation

- Before building a generator pipeline, a validation gate, or a skill on top of an artifact type, that type MUST publish a precise **required-contents contract**: required sections, a machine-checkable completeness definition, source integrity, and ownership. No contract → no automation.
- Why: a generator produces toward a target and a gate validates against one. With no defined contract, both are arbitrary and drift; the contract is the single source the pipeline and the gate share.
- How to apply: when an artifact type lacks a contract, define the contract first, then derive the pipeline/gate/skill from it. For document artifacts, the per-type contracts and their router live in the [document-standards index](../specs/document-standards/index.md). Hand-making a few instances without a contract is a shortcut — the contract is what makes the output repeatable and enforceable.
