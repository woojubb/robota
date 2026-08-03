# Review rounds run until a round returns zero

Owner directive, 2026-08-03, verbatim: **"라운드는 계속 돌려. 앞으로도"** — keep running the rounds, from
now on too. Said in response to my pausing after review round 5 of PR #1615 to ask whether to run
another round or merge.

## The rule

After applying a review round's findings, dispatch the next independent review round on the new HEAD
**without asking**. The stopping condition is `ACTIONABLE FINDINGS: 0`, not the reviewer running out
of obvious things and not my own confidence that the diff is clean.

Asking "another round or merge?" hands back a judgement the owner has already made, and it hands it
back at exactly the moment the diff is least reviewed: the newest commit — the one applying the last
round's findings — has been seen by nobody.

## Why, measured

On PR #1615 (HARNESS-066/068/069) every round through five found something real, and the rate did not
decay:

| round | heaviest finding                                                                                                            |
| ----- | --------------------------------------------------------------------------------------------------------------------------- |
| 1     | `release-runs` labelled RETIRED while `publish.md` mandates it and the publish script calls it every release                |
| 2     | three of four `grep` call sites converted, with "every grep call site" written into three documents                         |
| 3     | a green case named "links to the owner instead of copying the list" running over a README that copies the list              |
| 4     | a limit stated too narrowly ("bare names inside a fenced diagram") that steered the round-3 hand-fix past a second instance |
| 5     | a corrected measurement shipped inside the very commit that widened the detector and made it wrong                          |

Every one of those was introduced or left behind by the round that fixed the previous one. That is
the argument for the rule: **the fix for round N is the most likely place to find round N+1's
finding**, and it is the one part of the diff no reviewer has seen.

## How to run a round

- Tell the reviewer what the previous round raised **and what was done about each item**, so it
  verifies the fix instead of re-deriving the finding.
- Ask it explicitly to hunt in the text **added by the last round**.
- Record each round's outcome in the Task file, not only in the commit message. A pushed commit
  message cannot be corrected, and a later round will find something wrong in one — it did on #1615,
  where a commit named the wrong pre-fix state for its own red-proof. The Task file is where the next
  reader looks; see [`claimed-without-reading-back.md`](claimed-without-reading-back.md).

Related: [`comment-asserted-invariants.md`](comment-asserted-invariants.md) — nearly every round's
heaviest finding here was a comment, docstring or record asserting a property the code did not have.
