---
name: conformance-finding-report
description: Turns per-document verdicts into a structured conformance audit report — assigns AF-NN IDs, P0/P1/P2 severities, per-document verdict summary, and a counts-by-severity table, in the INFRA-002 report schema. Use as step 3 of architecture-conformance-audit.
---

# Conformance Finding Report

Single-responsibility step: assemble the verdicts from `doc-claim-verification` and the baselines from
`dependency-graph-extraction` into the conformance audit report. Authoring + classification only; it
proposes no fixes.

## Rule Anchor

- `AGENTS.md` > Document Discovery Policy
- Reference schema: `.design/architecture-audit/2026-06-13/conformance-audit-report.md` (INFRA-002)

## Severity

| Severity | Definition                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------ |
| **P0**   | Rule violation or authority-doc contradiction that actively misleads about boundaries/contracts. |
| **P1**   | Real drift: phantom packages, broken links, undocumented contracts, broken diagrams.             |
| **P2**   | Cosmetic / minor naming / incompleteness.                                                        |

## Report Schema (must match)

1. **Method** — verdict vocabulary + severity definitions.
2. **Mechanical Conformance Baseline** — `harness:conformance` + `harness:scan` results; reconcile each
   reported issue into a finding or mark out-of-scope with a reason.
3. **Dependency Graph Ground Truth** — the verbatim edge set + violation count.
4. **Per-Document Verdict Summary** — one row per canonical document (authority / architecture-map /
   package SPEC), each with an overall verdict + finding IDs.
5. **Findings** — every finding gets `AF-NN`, a class, a `file:line` (or import / dep) evidence, and a
   one-line description. Group by severity.
6. **Counts by Severity** — a table summing P0/P1/P2 (+ process/info).
7. **Headline Conclusions.**

## Rules

- Every finding MUST carry `AF-NN` + severity + classification — no exceptions.
- Every non-`HOLDS` verdict in the summary MUST trace to a finding.
- The counts table MUST sum to the total finding count.

## Output

`.design/architecture-audit/<date>/conformance-audit-report.md`.

## What This Skill Does NOT Do

- Assign verdicts → that is `doc-claim-verification`.
- Propose remediation or follow-up backlogs → `improvement-proposal-authoring`.
- Decide the gate PASS/FAIL → `backlog-gate-guard`.
