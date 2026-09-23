---
name: documentation-refresh
description: Run a focused documentation audit and repair loop when docs need more than one edit.
loop: over=material-doc-findings; escape=no-progress
invocable: true
---

# Documentation Refresh

Use this skill for a real documentation sweep, not as an automatic tail for every code change.

1. Audit the requested document surface against the code and contracts it describes. Split only large,
   disjoint surfaces; a dedicated auditor is optional for a focused change.
2. Correct local stale or inaccurate claims in one coherent batch. If a finding exposes a materially
   broader product/design defect, link the best existing issue and contain or defer it explicitly.
3. Use `finding-depth-triager` only when local versus foundational ownership is genuinely ambiguous. Do
   not dispatch it for every finding or merely to conclude N/A.
4. Re-check changed claims and links. Repeat only while a meaningful repair delta exists; stop and report
   the exact residuals when the same finding set recurs.
5. Return one integrated result with the files checked, corrections made, unresolved risks, and actual
   verification performed.

The issue/request is the work record. Do not create a committed loop ledger, paired Task/spec, receipt-only
commit, or repeated clean review for this refresh.
