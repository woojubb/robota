# A check that reads the file matches the prose that quotes the code

## STATUS: measured 2026-08-23 on SEC-019; the same root re-found independently the same day

In-repo mirror (memory-mirroring rule). Host mirror: `applied-check-must-read-the-code-line`.

## The shape

**Prose that explains an implementation satisfies the pattern that looks for that implementation.**
Files that document their own behaviour are where this bites, and it bites in both directions.

|                       | What matched                                     | Result                                                                                                                                             |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-019 applied-check | the docstring quoting its own regex alternatives | reported an applied mutation as `NOT APPLIED`, while 23 tests were red from it — the natural response is to "fix" an edit that was already correct |
| SEC-016 scan (axis 7) | a comment mentioning `` `hookResult.blocked` ``  | the whole `if (hookResult.blocked)` statement was deleted and the scan stayed **exit 0** — a deleted gate reported as present                      |

The second is the worse direction and **a single "does it still pass" probe finds only it.** The
comment doing the vouching had been added by the previous commit, whose entire purpose was to be
honest about that guard's reach.

## How to apply

- Confirming a mutation landed: assert on the exact line (`sed -n '<line>p'`) or diff against a
  pre-mutation copy. Never `grep` the file.
- Writing a scan that matches source: blank comments **and string and regex literals** before
  matching, preserving offsets if any consumer indexes into the same buffer.
- Auditing for this class: the priority corpus is files that document their own behaviour, and the
  scope is not only `scan-*.mjs` — the SEC-019 instance was a verification script.

Related: [[wiring-tests-assert-the-wrong-half]], [[enumerating-a-sink-is-not-covering-it]]. Issue #2258.
