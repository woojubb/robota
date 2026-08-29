---
title: 'HARNESS-115: the record→issue link is produced but consumed by nothing, and the cross-source ID comparison it exists for is unbuilt'
status: skipped
created: 2026-08-22
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2322#issuecomment-5461292436
---

# HARNESS-115: nothing consumes the record→issue link

Registered as issue #1916 — this is the second half of it. The first half landed in PR #1960
(`scripts/harness/scan-work-item-id-collision.mjs`), which refuses two distinct records claiming one
ID. A concurrent change adds the record→issue link that makes the other comparison possible. **Nothing
reads it.**

## The gap

The three collisions that opened issue #1916 were between a record in one clone and an **issue title**
opened by another session. `work-item-id-collision` reads only the tracked tree, so it cannot see
them, and its own header says so. The comparison that would catch them — a record's ID against the
issue titles claiming that ID — needs the link on both sides, and until now the link existed on
neither.

The link is being produced. The consumer is this item.

## Measured 2026-08-22, and the blocker is smaller than issue #1916 believes

The issue thread records, on 2026-08-21, that 48 IDs are claimed by both a record and an issue title,
that **39** of those records carry no reference to the issue's number, and that a union scan would
therefore emit 39 false alarms today. That number counted the frontmatter `issue:` field only.
Counting the citation forms records actually use, the picture is different:

| measure                                                        | value  |
| -------------------------------------------------------------- | ------ |
| task records under `.agents/tasks/` (including `completed/`)   | 992    |
| records citing an issue in a form that unambiguously names one | 89     |
| issue titles claiming a work-item ID                           | 61     |
| IDs claimed by **both** a record and an issue title            | 48     |
| …where the record names that issue's number                    | **44** |
| …where it does not                                             | **4**  |

**Method.** Records walked from `.agents/tasks/`; issue titles from `gh issue list --state all
--limit 400`, ID taken from a leading `<PREFIX>-<n>` in the title. A citation counts only in a form
that names an issue — a `github.com/…/issues/N` URL, or `issue #N` / `issue: N` — because a bare `#N`
in a record is a pull request as often as an issue, and counting it would inflate this table in the
direction that flatters the conclusion.

**The four are enumerable, and every one is the same item written twice, not two items:**

| ID            | issue       | record                                                        |
| ------------- | ----------- | ------------------------------------------------------------- |
| `ARCH-039`    | issue #1828 | `ARCH-039-sdk-public-surface-scan-covers-one-package.md`      |
| `ARCH-037`    | issue #1805 | `ARCH-037-published-contract-hygiene-from-the-arch-audit.md`  |
| `HARNESS-074` | issue #1619 | `HARNESS-074-the-review-loop-duplicates-the-reviewer.md`      |
| `HARNESS-058` | issue #1571 | `HARNESS-058-verify-like-ci-cannot-go-green-in-a-worktree.md` |

Titles were compared by hand: issue #1619 and its record carry the identical title, and the other
three are rewordings of one problem. So the burn-down before this scan can run clean is **four
citation lines in four named files**, not a 39-case migration and not "wait until enough new records
carry the link".

**The four do not fail the same way, and the split is the more interesting half.** Measured
2026-08-22:

| record        | its title's issue | what the record actually cites                  |
| ------------- | ----------------- | ----------------------------------------------- |
| `ARCH-039`    | issue #1828       | **issue #1764** — a real issue, a different one |
| `ARCH-037`    | issue #1805       | **issue #1764** — the same different issue      |
| `HARNESS-074` | issue #1619       | PR #1615 only, so no issue at all               |
| `HARNESS-058` | issue #1571       | nothing                                         |

Two name nothing; **two carry a well-formed link pointing at the wrong issue**. The second pair is
the never-true shape with live instances: nothing went stale, the link was wrong when written, and it
reads as verified because it parses. That is the case item 2 below exists for, and it is why the
assertion has to be "the issue still claims this ID" rather than "the link resolves" — both of these
resolve.

`HARNESS-074` is also the reason a bare `#N` must not count as naming an issue: its only reference is
PR #1615. Counting bare `#N` would have moved it into the linked column on the strength of a pull
request.

## What it must assert

1. **A record's ID against the issue titles claiming it.** Linked and matching is one item. Claimed
   by both with no link is the case to report.
2. **The link resolves _and_ the issue it names still claims this record's ID.** This is the addition
   worth the most and it costs nearly nothing on top of item 1: the same comparison, turned on the
   record's own claim instead of only on collisions between records. It is what catches a link that
   was **never true** — written once by whoever filed the record, never confirmed, and reading as
   verified precisely because it is well-formed and machine-parseable. Issue #1980 is that shape with
   a measured four-week half-life: `.github/required-status-checks.json` was not stale, it was never
   true, and a well-formed declaration in the right file was believed until someone re-derived it.
3. **Two issue titles claiming one ID.** Nothing sees this today. It is live-only.

## What it must NOT claim

**Detectable at push time, not prevented.** Any mechanism reading the tracked tree sees committed
claims only. A record held in another clone's uncommitted working tree is outside the observable set
— not through lossiness or a parsing gap, but in principle. Two sessions still pick the same number
and both still file; the second merely becomes detectable, and only after someone pushes. If this
scan, its header, or `.agents/tasks/README.md` implies prevention, the next reader trusts it through
exactly the window where it does not hold.

That is not hypothetical here. Filing this record required asking three sessions whether they held
the work. All three answered correctly by three different methods — enumerating local branches,
walking branches and both stashes, reading the tree — and all three missed a fourth session's
uncommitted branch. The only signal was that session volunteering it.

**The examined line must count what it could not see.** It states the number of records lacking a
link alongside the number carrying one. A scan reporting "no collisions" over a population it could
not read is the defect issue #1916 is about, one layer up (HARNESS-057).

## Where it runs is a separate question from how it fails

Item 3, and the freshness half of item 2, need GitHub. The repository has already decided this shape
four times — `scan-action-references`, `scan-no-fallback`, `scan-main-required-checks`,
`scan-workflow-permissions`: the live half runs in CI on a pull request to `develop`, is off locally,
and is off when the base is `main`, because `harness:scan` is reached by the release-grade check on
`protect-main` and a live half there turns any github.com incident into a blocked promotion. The
standing example of a gate that fails closed on an unreachable API is issue #1849. Unreachable is a
finding, never a skip: "could not verify" and "verified clean" are different answers.

## The ID pattern both scans use sees 784 of 995 records

Found while reviewing the change that produces the link, and recorded here because the consumer would
inherit it. `workItemIdOf` and `isTaskRecord` are `/^[A-Z][A-Z0-9]*-\d+-/` on the basename, which
requires the digits immediately after the FIRST segment. Every multi-segment prefix in this tree fails
it — `ARCH-AUDIT-001`, `ARCH-CONF-001`, `ARCH-FIX-020`, `ARCH-REV-013`, `DQ-AUDIT-005`, `INFRA-BL-009`.

Measured 2026-08-22 over `git ls-files -- .agents/tasks/`: 995 tracked files, 179 excluded by the
pattern (178 of them real records), 32 skipped as phases, **784 examined**.

Three live collisions sit in the tree unreported because of it, each two distinct items:

| ID              | records                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `ARCH-CONF-007` | `…-code-conformance-to-arch-rev-rules.md`, `…-harness-mechanical-enforcement.md`        |
| `ARCH-FIX-020`  | `…-agent-cli-subagent-runner-layer-violation.md`, `…-isession-upward-dependency.md`     |
| `ARCH-FIX-021`  | `…-project-structure-command-settings-missing.md`, `…-provider-factory-logic-to-sdk.md` |

Titles compared by hand. `INFRA-BL-009-A` … `-F` also surfaces under a widened pattern and is NOT a
collision: it is one item split with letters, a second phase spelling the `-p<N>` regex does not
recognise. Widening the ID pattern without widening the phase regex reports it as a six-way
collision, so the two move together.

This is reported on the pull request that produces the link. Whichever change fixes it, this item
must not be built on the narrow pattern: a cross-source scan inheriting it would report "no
collisions" over a fifth of the tree it never read, which is the failure named above.

## Also found while allocating this ID

`INFRA-127` is claimed by six files under `scripts/harness/` and by no task record. An allocator that
reads `.agents/tasks/` alone would hand it out again, and `work-item-id-collision` cannot see it
because there is nothing in the tasks tree to see. Whatever this item builds has to decide whether a
claim in a source header or a commit message counts as a claim, or say plainly that it does not.

## Out of scope

- Deriving the ID from the issue number, which is the only option that removes the class rather than
  guarding it. That is option 3 in issue #1916 and a much larger change.
- Back-filling links into the 903 records that cite nothing. A wrong link is worse than none: the
  cross-source check would then read two items as one, which is the failure this exists to remove.
- Hand-allocated identifiers in other namespaces. Two sessions took entry `90` in
  `.agents/rules/common-mistakes.md` on 2026-08-21 and the later one renumbered to 91 and 92 — the
  same missing allocator, a rule ordinal rather than a work-item ID. Whether the convention scopes to
  work-item IDs or to any hand-allocated identifier is a decision this item should state, not inherit.

## Ordering

This cannot land before the link exists. It is filed now so the ordering is recorded rather than
rediscovered, and so the four-record burn-down above is not re-derived from scratch.
