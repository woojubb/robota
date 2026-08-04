---
title: 'HARNESS-073: the rules tree carries case narrative and repository specifics that belong elsewhere'
status: todo
issue: https://github.com/woojubb/robota/issues/1618
created: 2026-08-03
priority: high
urgency: next
area: .agents/rules
depends_on: []
---

# HARNESS-073: a rule that tells a story asks the reader to judge whether their case resembles it

## Problem

`.agents/rules/index.md` § "How a rule is written" states the form: a rule states an invariant,
universally and neutrally, and the incident that prompted it belongs in the record that owns it. The
tree does not yet meet that form. Roughly 160 lines across it are case narrative — task identifiers,
dates, pull-request numbers, retellings of how a failure was found — and a further 15 name this
repository's packages, products or site where a universal noun would carry the same constraint.

Two costs, and the second is the one that matters. Every line of a rule is loaded before any work
begins, so narrative is paid for on every task forever. And a rule justified by an incident invites
the reader to decide whether their situation resembles that incident — which is the discretion a rule
exists to remove.

## Evidence

Measured 2026-08-03 by four parallel read-only audits partitioning the tree. Each reported per-file
line counts, the passage-level classification, and whether removal would leave the rule ambiguous.

| Partition                                                                                                       | Lines   | Case narrative                | Also found                                          |
| --------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------- | --------------------------------------------------- |
| `common-mistakes.md`                                                                                            | 83 rows | 26 rows; 21.6% of entry prose | ~33% of prose removable with no loss of obeyability |
| git-branch, publish, release-operations, verification, testing-layering                                         | 851     | 44 lines (39 in git-branch)   | 5 cross-file duplications, one self-refuting        |
| backlog-execution, spec-workflow, tdd-and-planning, finding-depth, helper-limits, process                       | 1033    | 43 lines                      | 2 direct rule conflicts, 1 unresolvable identifier  |
| operational, code-quality, naming-style, documentation-sync, research, api-boundary, frontend, memory-mirroring | 447     | 49 lines                      | 15 lines of repository-specific naming              |

Findings worth carrying into the work:

- **Two files are already in the target form** — `tdd-and-planning.md` and `naming-style.md` carry no
  case material at all, and the first states the longest technical invariant in the tree without one.
  The form is achievable, not aspirational.
- **Concentration is not proportional to size.** The largest file has among the lowest density;
  `helper-limits.md` spends 14% of itself on two cases, and an 11-line pointer stub spends a line on
  refactor history.
- **Undated narrative is the harder class.** One file has zero identifier matches and the highest
  narrative count, because its history has lost its citation and now reads as invariant. A marker
  grep cannot find that; only a line-by-line pass can.
- **Some passages must stay and are not narrative.** A `Worked example:` path and a `Mechanized:`
  pointer with its suppression syntax are instruction. A format specimen needs an identifier slot. A
  failure MECHANISM stated universally — the reason a wrong command reports success — is the rule's
  force, not decoration.
- **The dominant defect in one partition was not narrative at all** but repository-specific naming: a
  rule that names a package or a product applies here and nowhere else.

Three defects found by the audits were contradictions rather than narrative, and are corrected
already rather than scheduled, because a rule contradicting a rule is not a gap to plan: two mandatory
rules named different homes for the same document and different timing for the same specification
update, and one rule cited an identifier resolving to nothing — the condition that rule itself
refuses.

## Why this is foundational (or not)

**FOUNDATIONAL to the rule set, LOCAL to each file.** Each file is independently correctable, and none
blocks another. It is filed rather than done inline because it rewrites most of a 2,900-line corpus
that every task loads, and because a sweep that large is exactly where an invariant gets dropped
alongside the story that illustrated it.

## Direction

Per file, per passage: keep the invariant, move the case to the record that owns it, and delete
nothing whose removal changes what a reader must do. The strict test is already written down — delete
every proper noun, number and date, then read what remains.

Order the work by density rather than by size, and take the two clean files as the reference form.
Where an audit found a passage load-bearing, treat that as a signal the invariant is
under-stated: write the invariant properly instead of keeping the story that stood in for it.

Two constraints that are not negotiable in the rewrite:

- Entry numbering in `common-mistakes.md` is stable and gapless — a hook, a scan, another rule and a
  skill checklist reference entries by number, and one scan requires two entry texts to survive
  literally. Rewrite in place; never renumber or delete.
- Where a case is removed from a rule, it lands in the record that owns it in the SAME change, or the
  evidence for the rule is lost rather than relocated.

The cross-file duplications the audits found are the same defect one level up and are in scope here:
one invariant stated in two rule files is what diverges later.

## Progress — the floor is in, the sweep is not

`scan-rule-case-narrative.mjs` is registered and frozen. It measures the CITABLE class: a work-item
identifier, a pull-request or issue number, a calendar date, anywhere in a rule document. **128
citations across 17 of 24 documents** — the number the sweep now has to bring down, and the number
that makes a fall visible.

Three exemptions, each because it is not a case:

- **A resolving link.** `[SOME-123](../tasks/SOME-123-….md)` IS the relocation the form asks for <!-- allow-unresolved: an illustration of the shape, in a passage about how a citation must resolve --> — the
  invariant here, the incident in the record that owns it, and a way for the reader to get there. The
  target must exist, so this exemption doubles as the check for the unresolvable-identifier defect the
  audits found. A link counts once however many times the identifier appears inside it, since naming
  the record in both the text and the path is how a link is written.
- **A fenced block**, where an identifier is a slot in a format being shown.
- **`<!-- allow-citation: <reason> -->`**, and the reason has to be one: `allow-citation: -->` reads as
  a reason to a naive check, which is how an exception nobody had to justify spreads.

**What it cannot see, stated in its own output so the pass cannot be mistaken for completion:**
narrative whose citation has worn off. The audit found a file with zero identifier matches and the
highest narrative count. This item is NOT closed by the scan going green.

Two defects in the scan were found by its own cases before it was trusted: an unresolved link counted
twice, and the empty reason above. Both fixed, and the ratchet red-proved in both directions at the
command line — a citation added to a document in the target form exits 1 as `unfrozen`, and a lowered
count exits 1 as `fell` demanding a re-freeze.

Reference form confirmed mechanically rather than by reading: `tdd-and-planning.md` and
`naming-style.md` report zero, and a case pins that so the two documents cannot quietly drift out of
the form they are held up as.

### Sweep 1 — the thirteen low-density documents

**128 → 104**, and thirteen documents now report zero. Four remain: `common-mistakes.md` (52),
`git-branch.md` (27), `backlog-execution.md` (13), `enforcement-architecture.md` (12).

The audit's observation that concentration is not proportional to size held: most of what came out was
a single parenthesis. `(HARNESS-DIET-004)` in three pointer stubs, `(INFRA-056)` and `(REL-022)` and
`(HARNESS-032)` appended to instructions that were already complete, `(added at owner request, <date>)`
on a rule that stands without knowing who asked for it. In every one of those, the invariant is
unchanged by the deletion — which is the strict test the direction names.

Three needed the invariant written properly rather than the story deleted, and each is a case of the
audit's "load-bearing passage means the invariant is under-stated":

- **Where a root item lives** retold how two floors disagreed. The rule is that ONE document owns
  which place; the consequence — a writer and a verifier looking in different directories, so an item
  filed on the designed path fails the check that confirms it was filed — is now stated as the
  mechanism it is, and holds for any two consumers, not for the two it happened to.
- **The status-agreement exception** named a particular document and what it shipped. The rule is that
  a document whose correct status is not derivable without re-running the gate is a recorded exception
  under anti-rot, rather than a guess written into the tree.
- **The ID format** illustrated itself with five real identifiers, and the file-naming rule with a real
  path. The format is `{DOMAIN}-{NNN}`; it needs no examples of itself. The naming example is a
  specimen, so it is a fenced block — which is what the fence exemption is for, and it needs no
  suppression.

No case was lost rather than relocated: each removed citation was a pointer to a completed item whose
own record already holds the account, and none of the removed sentences was the only place a fact
lived.

**The two documents that carry two-thirds of what is left are next**, and they are a different job:
`common-mistakes.md` is entry-numbered and must be rewritten in place, and `git-branch.md`'s citations
are mostly attached to `**Why:**` clauses where the case IS the justification, so each needs the
invariant restated before the citation can go.

### Sweep 2 — `enforcement-architecture.md` and `backlog-execution.md`, then `git-branch.md`

**104 → 52**, and one document holds everything that is left: `common-mistakes.md`.

These three were the class the audit called load-bearing, and they came out the same way each time —
the citation was doing work the invariant should have been doing, so the invariant got written and the
citation stopped being needed:

- Three bullets naming three particular guards that were unreachable became three MECHANISMS: a guard
  anchored to the start of a command every caller prefixes; a guard gated on an environment variable
  exported by nothing but its own tests; an entry point that named itself the gate and was invoked by
  nothing. The names were this repository's; the shapes are anyone's, and the shapes are the warning.
- "A check that reported success without asking anything" kept its measurement — a hundred consecutive
  green runs of 13–21 seconds, reviewing nothing — and lost the identifier and the product name. The
  number is the force; the name of the action it happened to be is not.
- The deletion hazard was told as one branch's story. Restated as the condition it is: a branch name
  reused across several pull requests carries their merges, so a count of merged pull requests reads
  greater than zero while the CURRENT one is open — and the deletion proceeds and closes it.
- Two dated "measured on" openings became plain measurements. A finding does not become truer for
  having a date on it, and it does become easier to dismiss as belonging to a past that has moved on.

Refactor history came out wholesale: which document a section was relocated FROM is not a rule, and
three pointer stubs each spent a line on the identifier of the change that created them.

Baseline re-frozen at 52 in the same change.

**What remains is one document and one constraint.** `common-mistakes.md` is entry-numbered and its
numbering is referenced by a hook, a scan, another rule and a skill checklist — so every entry is
rewritten in place, never renumbered and never deleted, and that is a separate pass.

### Sweep 3 — `common-mistakes.md`, and the citable class reaches zero

**52 → 0.** The frozen baseline is now `{}`, which is what a ratchet becomes when it arrives: any
citation added to any rule document fails the scan unless it links to a record that exists, sits in a
fenced specimen, or declares its reason.

The file turned out to be the most uniform of the four rather than the hardest. Twenty-five entries
ended in a trailing `Incident: …` clause carrying the identifier and the date, and in every one the
invariant and the `Worked example:` / `Mechanized:` pointers sat in front of it, complete — the header
of that very file already said the incident does not belong there. Three carried a citation inside the
instruction itself, and those were restated: a phase note on a multi-phase item routinely keeps an
item open, which is the general form of the one that did; the blind spot a no-`needs` split creates is
the general form of the gate that had it.

**The numbering constraint was checked mechanically, not trusted.** The sequence of entry numbers
before and after the sweep is IDENTICAL — 83 rows, no duplicate, nothing missing from 1..83 — so every
external reference of the form "common-mistakes #N" still resolves. Rewriting in place was the whole
method: no row was reordered, merged or dropped.

The reference case that asserted the tree carries citations was replaced with one asserting it carries
none, which is what that case said should happen when the count reached zero rather than deleting it.

### The repository-specific class, classified

Measured over the rules tree: **35 mentions of a workspace package or app name**, and most of the
apparent hits are the words `docs`, `action`, `blog` and `www`, which are directory names that are
also ordinary English. The distinctive names — `agent-*`, `@robota-sdk/*` — fall into three kinds, and
only one of them is a defect:

- **A worked-example path** (`packages/<pkg>/src/__tests__/<file>.test.ts`). NOT a defect, and this
  item's own evidence says so: a worked example is instruction, and an example that points at no real
  file is not an example. These stay.
- **An illustrative name inside a universal invariant** — the anti-pattern is general and the name is
  there to show its shape. Genericised: the whole-package mock illustration now names a neutral scope,
  and "web apps such as `apps/agent-web` or `packages/agent-playground`" is now "a web app or any
  package whose output is rendered in a browser", which carries the same constraint and applies to a
  surface added tomorrow.
- **Genuinely repository-specific POLICY** — entry 13's dependency direction (`agent-core` must not
  depend on `agent-*`), and `testing-layering.md`, which is entirely about which package proves what.
  These are not illustrations that can be genericised; they are rules about THIS repository's layout,
  and the fix is a MOVE, not a rewrite. `AGENTS.md` already names
  [`.agents/project-structure.md`](../project-structure.md) as the owner of the dependency-direction
  rules, so entry 13 is also the cross-file duplication this item lists separately.

**The move is left for a decision rather than made here.** Relocating policy between governing
documents changes which document a reader is bound by, and doing it silently at the end of an
unrelated sweep is the opposite of how this repository handles ownership. It is also coupled to the
third leftover below.

### The policy move — decided by the owner, split by kind (2026-08-04)

The classification above left one thing open, because relocating policy between governing documents
changes which document binds a reader and that is not an agent's call to make quietly. The owner chose
**split by kind** over moving wholesale or leaving it.

**`testing-layering.md` keeps the rule and loses the names.** Its six rules now read "a surface owns no
feature logic", "feature behaviour MUST have a functional test at the owning layer" — statements that
bind any repository. The map of which package is the surface, which is the owning layer, and which
modules provide the harness and the scripted provider moved to
[`project-structure.md`](../project-structure.md) § Testing Layers, under a heading that says the rule
lives elsewhere and this is the map.

**Entry 13 is rewritten in place, never renumbered.** It states the universal form — the lowest layer
every consumer can reach depends on nothing above it, and a dependency from the foundation to a
package built on it is a cycle through the foundation — and points at the document that owns which
package that is. The entry sequence is unchanged: 83 rows, identical before and after.

**The evidence for the destination was already in the destination.**
`project-structure.md` § Implementation Owner Boundaries records that it was itself relocated out of a
rules file "which is not the owner of package ownership". Same reasoning, same direction, second time.

**Measured: 44 → 37 distinctive package references in the rules tree.** What remains is not the class:
`agent-run` and `agent-conduct` are ordinary words that happen to look like packages, one is a scope
pattern (`@robota-sdk/*`), one is a subpath-export precedent cited as an example, and one is a
one-line summary of the layer diagram in the file that says it owns nothing but the invariant.

**And the change broke this item's own rule on the first run**, which both new floors caught: the
sentence explaining the split cited `HARNESS-073` by number, inside a rule document — the exact
citable narrative this item exists to remove. The rules cannot carry the reason for their own
cleanup; the reason lives here.

## What is NOT done

The citable class is closed and held. Two classes named in the evidence above are not, and this item
stays open for them:

- **Undated narrative.** Out of the checker's reach by construction — a paragraph retelling an
  incident with every proper noun removed reads as an invariant. The audit measured one file with zero
  identifier matches and the highest narrative count. Only a line-by-line pass finds these, and this
  sweep did not do one; it followed the citations.
- **Repository-specific naming.** DONE. The illustrative kind was genericised, the worked-example kind
  is correct as it stands, and the two pieces of genuinely repository-specific policy moved to the
  document that owns that kind of rule, by owner decision. 44 → 37 references, and the remainder is
  not the class.
- **The cross-file duplications** the audits found: one invariant stated in two rule files is what
  diverges later, and they are still stated twice.

## Test Plan

- **Required red-first regression:** a mechanical check that a rule document contains no case
  narrative — identifiers, dates, pull-request numbers — with the documented exceptions (format
  specimens, mechanized-check names, worked-example paths). Proven to FAIL against the tree as it
  stands before it is trusted, and to PASS on the two files already in the form.
- The check reports how many documents it examined, so a pass over nothing is not a pass.
- Undated narrative is out of a checker's reach by construction; the check bounds the citable class
  only, and the item is not closed by the check alone.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process documents and their guard; no user-facing surface.
