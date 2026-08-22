---
title: 'INFRA-106: a bare #N does not say whether it is an issue or a pull request'
status: done
created: 2026-08-19
completed: 2026-08-20
priority: medium
urgency: next
area: .agents/rules, scripts/harness, commitlint.config.js
depends_on: []
---

# INFRA-106: every `#N` reference names its kind

## Objective

`#1884` and `#1886` look identical and are different things — one is an issue, the other is the pull
request that closed it. A reader cannot tell which without opening it, and the two are constantly
adjacent in this repository's records: a task cites the issue it came from and the pull request that
landed it, in the same paragraph, in the same shape.

Owner directive, 2026-08-19: a `#N` reference always states whether it is an issue or a pull request.

## The measurement that shapes the design

Counted over tracked markdown before anything was written:

|                                          | count     |
| ---------------------------------------- | --------- |
| `#N` occurrences                         | **2,500** |
| files carrying at least one              | **443**   |
| already qualified (`issue #N` / `PR #N`) | 552       |
| closing-keyword form (`Closes #N`)       | 8         |

A flat gate would be red on arrival across 443 files, and a check that is red on arrival gets
suppressed rather than obeyed — this repository has written that sentence into three separate scans.
So the check is a **per-file ratchet**: counts are frozen, may fall, must never rise, and a fall is
re-frozen in the same change.

## The form, and what is exempt

Required: a kind word immediately before the number — `issue #1884`, `PR #1886`, `pull request
#1886`. Case-insensitive.

Exempt, each for a reason a reader can check:

- **A closing keyword.** `Closes #1884` is parsed by GitHub, and INFRA-104 built the promotion
  machinery that depends on it. `Closes issue #1884` is not the documented form, so requiring the
  qualifier there would trade a readability gain for a broken automation.
- **A fenced block or an inline code span.** An identifier inside one is a specimen — a slot in a
  format being shown, not a claim about a particular thing.
- **A heading anchor or a URL fragment.** `[text](#section)` and `…/pull/1886#issuecomment-1` are
  not references to a numbered thing.

## Plan

- [x] TC-01: the scan reports a bare `#N` in tracked markdown and does not report `issue #N`,
      `PR #N`, or `pull request #N`.
- [x] TC-02: it does not report a closing-keyword reference, a fenced-block occurrence, an inline
      code span, or a link anchor.
- [x] TC-03: the ratchet fails when a file's count RISES above its frozen value, fails when it FALLS
      without being re-frozen, and fails on a file the baseline does not know.
- [x] TC-04: the counter it declares is exported and asserted at an exact value against a fixture,
      including after a second run.
- [x] TC-05: `commitlint` rejects a new commit message carrying a bare `#N`, and accepts the
      qualified form and a `Closes #N` footer.
- [x] TC-06: the rule section carries `Enforced by:` and names what the enforcement does NOT reach.
- [x] TC-07: `pnpm harness:scan` and the harness unit tier are green.

## Test Plan

Both directions for every rule: the bare form reported AND each qualified or exempt form left alone.
The ratchet is exercised in all three failure directions against a synthesised baseline rather than
against the tree, so the cases do not move when the tree does. The commitlint rule is driven through
the real binary with real messages, because a rule tested only through its own predicate has never
been shown to be reachable from the configuration.

## Stated limit

Neither check reaches a pull-request body or an issue comment — those are not in the tree and are not
linted. That half is the writer's obligation, and the rule says so rather than implying coverage the
mechanism does not have.

## Progress

### 2026-08-19

Two defects the first run exposed, both invisible from reading the code:

- **An unclosed fence closed on its own first line.** The terminator alternative was `$`, which under
  the `m` flag matches the end of every LINE, so with a lazy body the fence ended immediately and the
  REAL closing fence was then read as an opening one — hiding every reference after it. Measured on
  a three-line fixture that reported nothing. The fix is `(?![\s\S])`, end of input.
- **A count that fell to zero was reported as a deleted file.** `compare` was handed only the
  non-zero rows, so a file still in the tree whose count reached zero came back as "frozen, but no
  longer in the tree" — sending the reader to look for a deletion that never happened. Surfaced when
  the fence fix took four files to zero at once.

Registering the two custom commitlint rules as two plugin ENTRIES made commitlint load only the last
and refuse the whole config with `Found rules without implementation: claims-resolve`. One plugin
object carrying both rule bodies is the working form, and the coexistence is now pinned by a case —
it is a failure that could only appear once a second custom rule existed.

`named-artifact-resolves` and `rule-case-narrative` both refused the first draft, correctly: the
commitlint test cites a path that must NOT exist (declared at file level, as its sibling does), and
the rule text carried three case citations where a fenced format specimen was the right form.
