---
name: doc-claim-verification
description: Verifies one architecture document's concrete structural claims against code reality, assigning each claim a HOLDS/DRIFT/VIOLATION/CONTRADICTION/STALE verdict with file:line evidence. Use as step 2 of architecture-conformance-audit, once per canonical document.
---

# Doc Claim Verification

Single-responsibility step: take one architecture document and the extracted ground truth, and assign
each checkable claim a verdict. Judgement only — it does not assign finding IDs, severities, or write
the report (that is `conformance-finding-report`).

## Rule Anchor

- `.agents/project-structure.md` + `packages/*/docs/SPEC.md` (the contracts being verified)
- `AGENTS.md` > Owner Knowledge Policy (each package owns its SPEC truth)

## Canonical Document Set

Verify every document in this set (one invocation per document, or batched across documents):

- `ARCHITECTURE.md`, `.agents/project-structure.md`, `.agents/specs/ARCHITECTURE-MAP.md`
- `.agents/specs/architecture-map/**/*.md` — **all subdocuments, recursively** (this includes nested
  subtrees such as `.agents/specs/architecture-map/agent-cli/*.md`; a non-recursive `*.md` glob misses
  them). Enumerate with `find .agents/specs/architecture-map -name '*.md'`, not a shell `*.md` glob.
- `packages/*/docs/SPEC.md` — **every package** (enumerate with `ls packages/*/docs/SPEC.md`; do not
  scope to only recently-changed packages).

## Verdict Vocabulary

| Verdict           | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| **HOLDS**         | Claim matches implementation (cite confirming evidence).  |
| **DRIFT**         | Directionally right but stale/incomplete.                 |
| **VIOLATION**     | Code / filesystem contradicts the claim.                  |
| **CONTRADICTION** | Two documents — or a doc and its own diagram — conflict.  |
| **STALE**         | References something that no longer / does not yet exist. |

## Steps

1. Extract the document's concrete, checkable structural claims (package counts, dependency edges,
   layer ownership, planned packages, zero-dep assertions, interface-types-only, cited paths, diagram
   nodes/edges). Ignore non-checkable prose.
2. For each claim, check against the extracted edge set (from `dependency-graph-extraction`) and the
   source tree (grep cited symbols/paths; confirm they resolve).
3. Assign a verdict and cite evidence as a `file:line`, an `import` statement, or a `package.json`
   dependency. Never assert a verdict without evidence.

## Output

A table per document: `| Claim | Verdict | Evidence (file:line) | Note |`. Hand these to
[conformance-finding-report](../conformance-finding-report/SKILL.md).

## What This Skill Does NOT Do

- Assign `AF-NN` IDs or severities → `conformance-finding-report`.
- Propose remediation → `improvement-proposal-authoring`.
- Edit the audited documents → verification is read-only.
