---
title: 'PROC-005: a documentation finding can be foundational, and doc-fixer has no correct local fix for one'
status: done
priority: medium
urgency: soon
type: PROC
area: .claude/agents
created: 2026-08-01
completed: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1545
---

# PROC-005 — the one caller of the depth verdict that needs a different answer

## Problem

`finding-depth-triager` is now dispatched from every place a finding is acted on — the PR review loop, the
architecture fixer and implementer, the CI triager, the human-invoked review, and the lesson loop — with one
deliberate omission: `doc-fixer`.

The omission is not an oversight, it is an unanswered question. A recurring documentation finding usually
means the CODE moved and the document is the symptom. `doc-fixer` edits documentation only, so for a
foundational doc finding there is **no correct local fix at all**: correcting the document makes it describe
a wrong design faithfully, which is the wrong design written down twice, and now with an accurate-looking
document defending it.

## Why it is not simply wired like the others

The other callers have somewhere to send a FOUNDATIONAL verdict — the fixer reports it unfixed, the
orchestrator routes it to a root item. `documentation-refresh` converges on `ACTIONABLE FINDINGS: 0`, so a
doc finding that is correctly left unfixed would keep the loop from converging unless the loop learns the
difference. That is a change to the orchestrator's convergence condition, not a clause in the worker.

## Answers

### 1. It converged on FIXED. It now converges on RESOLVED, and containment in a document is a visible note

`documentation-refresh` converged on "nothing left to edit", which is a stop condition only an edit can
reach. That is the pressure that produces the patch: with a foundational finding outstanding, the loop's own
convergence condition argues for correcting the document. It now converges on **resolved** — every material
finding has a disposition, one of corrected, contained under a filed root item, or recorded INVALID. The
signal stays `ACTIONABLE FINDINGS: <n>`; what changed is what counts as actionable, which keeps one
convergence vocabulary across the pipelines rather than adding a second count for every consumer to learn.

The document form of the containment label is a **containment note**: a blockquote placed immediately below
the claim it contains, opening `> **Contained — <ID>.**`, followed by what is wrong underneath. Owned by
[`finding-depth.md`](../../rules/finding-depth.md) so it is one convention rather than one per pipeline.

It is at the site (like the code comment, so the next audit round meets the answer where it raised the
finding) but **visible in the rendered document** (unlike the code comment). That difference is the whole
design question, and it turns on who the consumer is: a code comment is invisible to the running program and
visible to the maintainer, which is right there, because what the program's consumer consumes is behavior.
A reader IS the document's consumer. An HTML comment would be containment the people the document is written
for never learn about — a claim known to describe a wrong design, left standing with nobody told.

### 2. No — a doc finding whose cause is in the code is not always foundational

The cause of a documentation finding is nearly always in the code, so "the cause is elsewhere" would classify
every one of them foundational and empty the word. The test is the third depth question read on a document:
what would the CORRECTED sentence say?

- The code changed legitimately and the document lagged — a rename, a new flag, a moved path. The corrected
  sentence is one the design is glad to make. **LOCAL**; correct the document.
- The document can be made accurate only by writing down something the design should not be doing — an
  internal presented as public API, a workaround presented as the supported path, one fact with two owners,
  a layer boundary documented as the way through. **FOUNDATIONAL**; the corrected sentence would be true,
  and that is the problem.

### 3. The orchestrator routes; `backlog-writer` files; `doc-fixer` never does

`doc-fixer` edits docs and nothing else, so filing would breach its own declared boundary. The triager judges
only. The filing therefore sits where the PR loop already puts it: `documentation-refresh` routes a
FOUNDATIONAL verdict to `backlog-writer` for the root item and registers its GitHub issue, then chooses
re-plan or containment, and hands the filed ID back to `doc-fixer` if the note is to be written.

The architecture pipeline often does already own an item for the same code-side cause — so the orchestrator
searches the backlog first and cites that ID rather than opening a duplicate. What it must not do is assume:
"another pipeline may own it" is how a finding ends up owned by nobody, and the pipeline that found it is the
one holding the evidence.

## Alternatives considered

- **A separate known-drift ledger file.** Rejected: the label leaves the site, the reader of the document is
  not told, and `doc-auditor` would have to consult a second file that will drift from the tree.
- **An HTML comment, copying the code convention exactly.** Rejected for the consumer reason in answer 1.
- **A second signal, `CONTAINED FINDINGS: <n>`, with convergence still at `ACTIONABLE == 0`.** Rejected:
  it forks the convergence vocabulary, and every consumer of the count would have to learn a second one.
- **Leaving `doc-fixer` unwired and letting the architecture pipeline own all doc findings with code
  causes.** Rejected: `documentation-refresh` runs independently and would keep converging on a corrected
  document that describes a wrong design.

## Done when

- [x] `doc-fixer` takes a `DEPTH:` verdict and has a defined action for FOUNDATIONAL that is not "edit the
      doc" — it writes the containment note when handed a filed ID, and edits nothing when it is not.
- [x] `documentation-refresh` converges with such a finding outstanding, without either looping forever or
      silently counting it as fixed — `doc-auditor` returns a contained claim as `CONTAINED`, outside the
      `ACTIONABLE FINDINGS` count, and counts an unresolvable label as a blocker finding.

## Evidence

- `scripts/harness/__tests__/depth-verdict-reachable.test.mjs` — the mechanical floor, in three parts, each
  red-proved by re-introducing the defect it refuses:
  1. a worker instructed to take a `DEPTH:` verdict, carrying no `Agent` tool, must be named in some skill
     body alongside `finding-depth-triager` (removing the dispatch step from `documentation-refresh` fails
     it);
  2. every orchestration-map row whose worker takes a verdict must list the guardian (dropping it from the
     Documentation refresh row fails it);
  3. every containment note in the tracked markdown tree must name a filed backlog item, resolved through
     `record-local-review`'s own `resolveRootItems` (a note naming `NOSUCH-999` fails it).
