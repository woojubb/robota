---
title: 'HARNESS-060: a ticked box or a "FILED" that names nothing resolvable must fail'
status: done
completed: 2026-08-04
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

## Measured — the size of the path half

Surfaced 2026-08-04 while resolving a review finding on an unrelated pull request: a file moved to
`completed/` and two links to it were not updated. Rather than fix the two and move on, the tree was
swept, and the two were the visible edge of a class this item already owns.

**216 broken relative links out of 1,104**, by the sweep below. The concentration says what they are:
`.agents/spec-docs/done/` and `.agents/tasks/completed/` dominate, and most point at directory names
that no longer exist — `../../backlog/…` from before the backlog tree became `tasks/`,
`../spec-docs/active/…` from before those documents reached `done/`. A rename moved the files and left
every reference behind.

That makes the path half of this item mechanical AND large: the check is easy, and the tree is red on
arrival, so it wants the same ratchet treatment the other arriving-red floors got rather than a flat
gate nobody can turn on.

```sh
python3 - <<'EOF'
import io, os, re
bad = checked = 0
for root, _, files in os.walk('.agents'):
    for f in (n for n in files if n.endswith('.md')):
        p = os.path.join(root, f)
        for m in re.finditer(r'\]\((?!https?:|mailto:|#)([^)\s#]+)', io.open(p, encoding='utf-8').read()):
            checked += 1
            if not os.path.exists(os.path.normpath(os.path.join(root, m.group(1)))):
                bad += 1
print(checked, 'checked,', bad, 'broken')
EOF
```

Two caveats the check will have to carry, both seen in that output: a fenced example may hold a
deliberately unresolvable path (`../tasks/SOME-123-….md` in a document ABOUT link resolution), and a
few "links" are regular expressions inside prose that happen to use bracket-paren syntax.

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

## Implementation (2026-08-04)

`scan-resolving-claims.mjs`, registered, and a FLAT GATE rather than a ratchet — because the live tree
was brought to zero first, which is the only honest way to install one.

**Three claim shapes, all purely referential.** A relative link naming no file; a `FILED` / `filed as`
/ `tracked as` / `see <ID>` naming an item the tree does not define; a ticked box whose own text says
the work is unfinished. It asks whether the thing you named exists and nothing about whether the work
behind it is done — that judgement is where noise comes from.

**Scoped to the live tree, and the exemption is stated.** `completed/`, `done/`, `rejected/` and the
archives are historical records whose citations describe a tree that has moved on; failing on them
would fire on correct data. Measured: **216 broken links across all of `.agents/`, 24 in the live
tree**. The 24 were repaired — every one was a rename left behind (`../backlog/…` from before the
tree became `tasks/`, `spec-docs/active/…` from before those documents reached `done/`) and every
target still existed.

**Four things are deliberately not defects**, each because the check would otherwise fire on a correct
state: a fenced specimen, a template slot (`<pkg>`, `*`), a glob written as a link — de-linked, since
it was never one — and a path a document is ABOUT, which declares itself with
`<!-- allow-unresolved: <reason> -->` and a required reason.

**Three false positives found by running it, and each taught the check something:**

- `ADR-002` was reported as naming nothing. It exists, in `.design/decisions/` — a directory the ID
  collector did not know. Decisions are work items too, and they do not live under `.agents`.
- `CLI-AUDIT-019` was reported as naming nothing. It is defined as a SECTION HEADING forty lines above
  the reference. A definition is a definition wherever the tree puts it; the collector reads headings
  now as well as filenames.
- A finished checklist item was reported as unfinished because a case-insensitive `TODO` matched the
  directory name `todo/` in its own path. Case-sensitive, and never before a slash.

**Done-when, each exercised:** a `FILED` naming a nonexistent ID fails and one naming a real ID
passes; a ticked box saying the work is filed elsewhere fails and a plain one passes; the current tree
passes at 346 documents; archived trees are exempt and the exemption is asserted by a case rather than
left to the reader.
