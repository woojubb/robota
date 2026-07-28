---
title: 'HARNESS-060: a ticked box or a "FILED" that names nothing resolvable must fail'
status: todo
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-28
depends_on: []
---

# HARNESS-060 — referential integrity for completion claims

## Problem

Status claims contradicted by the tree are one of the most-repeated classes here: **nine or more
occurrences**, six full reconciliation passes in seven days, five items moved back out of
`completed/`.

It recurred **after** the mechanism meant to stop it. `scan-unearned-done-claims`,
`check-task-archival`, `check-backlog-placement` and `scan-doc-folder-status-agreement` are all
registered and blocking — and they check **placement and the presence of evidence fields**, not
whether a claim is true. So:

- `INFRA-060` marked three findings **FILED** and **nothing had been filed** — discovered only when
  someone went looking, weeks later. Two of the three are now `INFRA-064` and `HARNESS-056`.
- I wrote `filed as HARNESS-055` into a scan's own output and a PR body before the file existed.
- `HARNESS-052` carried a `[x]` whose own text described the unfinished half.

Every one of those is mechanically detectable without judgement: a claim named an artifact, and the
artifact did not resolve.

## Proposed direction

A scan that fails when, in `.agents/**`:

- a `[x]` checkbox or a `FILED` / `filed as` / `tracked as` / `see <ID>` phrase names an ID or a
  path, and that ID or path does not resolve; or
- a checkbox is ticked while its own text contains an unfinished marker (`remaining`, `still open`,
  `is filed as`).

Purely referential — no judgement about whether work is genuinely done, which is what the existing
scans already attempt and where noise would come from. It asks only: does the thing you named exist?

Scope it to the live tree, not the archive: `completed/` and `done/` are historical records whose
citations may legitimately point at things since renamed. Failing on those would fire on correct
data, and a guard that does that gets suppressed.

## Done when

- A `FILED` naming a nonexistent ID fails, proven RED against the real `INFRA-060` text as it stood.
- A ticked box whose text says the work is not finished fails, proven RED against `HARNESS-052`'s
  as it stood.
- The current tree passes, proven GREEN — if it does not, the failures are findings and are fixed
  before this lands.
- Archived documents are exempt, and the exemption is stated rather than implicit.
