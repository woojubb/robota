---
title: 'INFRA-111: "what does this redirect write to" has no owner, so each guard hand-rolls it'
status: done
completed: 2026-08-21
created: 2026-08-20
priority: high
urgency: next
area: .claude/hooks
issue: 'https://github.com/woojubb/robota/issues/1903'
depends_on: []
---

# INFRA-111: two hooks hand-roll a redirection grammar the library already encodes

## Objective

Two guards ask the same question — **does this command redirect output into a path I protect?** —
and each answers it with its own regex over redirection spellings. Neither consumes
`.claude/hooks/lib/command-scan.sh`, which already encodes the redirection grammar and exposes none
of it.

## The measurement

`bulk-edit-guard.sh`, driven over its real payload protocol:

| command                     | exit  |
| --------------------------- | ----- |
| `echo x > node_modules/y`   | 2     |
| `echo x >> node_modules/y`  | 2     |
| `echo x >\| node_modules/y` | 2     |
| `echo x &> node_modules/y`  | 2     |
| `echo x 2> node_modules/y`  | 2     |
| `echo x >& node_modules/y`  | **0** |
| `echo x >&node_modules/y`   | **0** |
| `echo x 2>& node_modules/y` | **0** |
| `echo x >&"node_modules/y"` | **0** |
| `echo x >>& node_modules/y` | **0** |

`branch-guard.sh:1149` asks the same question of `.husky/` with a different regex, and its holes are
a DIFFERENT set:

| command                      | branch-guard |
| ---------------------------- | ------------ |
| `echo x > .husky/pre-push`   | matches      |
| `echo x &> .husky/pre-push`  | matches      |
| `echo x >& .husky/pre-push`  | **misses**   |
| `echo x >\| .husky/pre-push` | **misses**   |

That second row is a live walk-through of a gate whose own refusal says "Zero exceptions".

## Why it is here and not fixed in place

This is the third cut of one regex. The first shipped it; the second added `>|` and its commit
claimed that was "the only miss across eight probed spellings"; the third measures five more. A
hand-enumeration that certifies its own exhaustiveness and is wrong the following round is the
evidence that enumeration is the wrong shape.

The grammar is already written. `command-scan.sh` (INFRA-085) parses redirections, and its own
comment records the identical tuition:

> `2>&1` and `>&2` put the ampersand AFTER the arrow; `&>` and `&>>` put it BEFORE. Reading only the
> character in front caught the first pair and missed the second.

So the library has already paid for the exact `>&`/`&>` asymmetry that cost this hook a round — and
kept the lesson private.

This is NOT [INFRA-109](INFRA-109-flag-attribution-has-two-implementations.md): that item's subject
is which command received a FLAG, and landing it in full leaves `>& node_modules/x` permitted.

## Completion criteria

- [x] TC-1: `command-scan.sh` exposes a redirect-target reader — the targets a command writes to.
      `hook_redirect_targets`, a `redirs` mode on the tokenizer that already had to locate
      redirections to keep an `&` from splitting a statement.
- [x] TC-2: `bulk-edit-guard.sh` and `branch-guard.sh` both consume it; neither keeps a private regex.
- [x] TC-3: every row of both tables above receives the correct verdict — see the correction below,
      which moved two rows.
- [x] TC-4: a shared case table, so a spelling added to the grammar reaches both consumers at once.
      `scripts/harness/__tests__/redirect-target-has-one-owner.test.mjs`: one `WRITES` table drives
      the reader, the reader through a statement window, and each guard against the path IT protects.
      77 cases.

## Contained by

The follow-up to pull request #1886 labelled the `>&` family at the redirect rule
(`Contained — INFRA-111.`), under [finding-depth.md](../rules/finding-depth.md). That containment is
DISCHARGED here: the label is gone because the rule it labelled is gone, replaced by a call to the
shared reader. `branch-guard.sh`'s half was pre-existing on the integration branch and untouched by
either change; it is fixed here too, because leaving it would have left the two halves of one
question with two answers again.

## Progress

### 2026-08-21

Closed. `hook_redirect_targets` owns the grammar; both guards call it and neither keeps a regex.

**The operator set was measured against bash, and it moved two rows of the table above.** Running
`echo x <SPELLING> FILE` and then looking for FILE:

| spelling                                          | what bash does                           |
| ------------------------------------------------- | ---------------------------------------- |
| `>` `>>` `>\|` `&>` `&>>` `2>` `>&` `>&NAME` `<>` | create or write the file                 |
| `2>& NAME`                                        | **ambiguous redirect — writes nothing**  |
| `>>& NAME`                                        | **syntax error — writes nothing**        |
| `2>&1` `>&2` `1>&2` `>&-`                         | duplicate or close a descriptor; no file |

So two of the spellings this item filed as holes are commands bash itself refuses. They are still
reported, deliberately: the reader decides by shape, and over-reporting a command bash rejects costs
a refusal of something that cannot run, while under-reporting one it accepts is a bypass. `<>` is the
opposite finding — it was in NEITHER guard's regex and it does create the file.

**A second defect, in the statement splitter, found by the work rather than by the item.** `>|` is
one clobbering-redirection operator, and `hook_statement_ranges` treated its `|` as a pipe. The
operator landed in one statement and its target in the next, so `branch-guard.sh` — which reads per
statement — got no target from either half. That is the same defect the `&` case one line above it
already carried a comment about (`2>&1` split in two), one metacharacter over.

It was invisible until the reader was driven THROUGH a statement window. The whole-command reading
was correct, the guard still refused the case, and the test row went green — for a different reason
than the one it names. Fixed in the splitter, and the test now reads the table both ways.

**A third, in this file's own test.** The rows for `2>&1`, `>&2`, `1>&2` and `>&-` asserted "does not
report the protected path". They cannot fail on that: `2>&1` yields the target `1`, which is not
`node_modules/...` either way. Deleting the descriptor rule outright left all 77 cases green.
Measured, then rewritten to assert what the rule actually claims — that those spellings name no file
at all — after which the same deletion fails exactly five.

Red-proofed one at a time, each mutation reverted before the next:

| mutation                                | fails                                             |
| --------------------------------------- | ------------------------------------------------- |
| `bulk-edit-guard` back to its regex     | exactly 5 — the `>&` family into the store        |
| `branch-guard` back to its regex        | exactly 4 — the `>&` family into `.husky/`        |
| the `>\|` split fix removed             | exactly 1 — the clobbering redirect per statement |
| the descriptor-duplication skip removed | exactly 5 — every `NAMES_NO_FILE` descriptor row  |

`npx vitest run scripts/harness/__tests__/` — 222 files, 4164 tests, all passed.
