---
name: architecture-refresh
description: Run a justified broad architecture audit and remediation loop to one integrated conclusion.
loop: over=material-findings; escape=no-progress; bound=3 rounds
invocable: true
---

# Architecture Refresh

Use for a broad architecture audit or cross-package remediation, not as an automatic tail for ordinary
work. The current issue/request remains the authoritative work record.

## Flow

1. Run `architecture-audit-fanout` when four-dimensional coverage is justified. Run doc↔code conformance
   separately only when claims or contracts changed.
2. Synthesize duplicate reports into one material finding set. Keep source evidence and reject unsupported
   claims.
3. Independently verify each blocker/high finding that would materially expand the change. Medium or lower
   findings may be handled directly when their evidence is clear.
4. The responsible author applies local fixes in one coherent batch. Use a depth specialist or registry
   reconciler only for a genuinely foundational or ambiguous finding; they are not mandatory links in the
   normal chain.
5. Re-audit only affected cells and meaningful repair deltas. Stop on zero material findings, unchanged
   findings, or the three-round bound.
6. Return one integrated result with remaining risks and the commands/checks that actually ran.

Do not create a committed run ledger, planning-only commit, N/A guardian dispatch, or repeated clean review.
Runtime results and errors remain visible in their execution surface.
