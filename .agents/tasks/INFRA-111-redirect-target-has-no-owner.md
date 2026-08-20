---
title: 'INFRA-111: "what does this redirect write to" has no owner, so each guard hand-rolls it'
status: todo
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

- [ ] TC-1: `command-scan.sh` exposes a redirect-target reader — the targets a command writes to.
- [ ] TC-2: `bulk-edit-guard.sh` and `branch-guard.sh` both consume it; neither keeps a private regex.
- [ ] TC-3: every row of both tables above receives the correct verdict.
- [ ] TC-4: a shared case table, so a spelling added to the grammar reaches both consumers at once.

## Contained by

The follow-up to pull request #1886 labels the `>&` family at the redirect rule
(`Contained — INFRA-111.`), under [finding-depth.md](../rules/finding-depth.md). `branch-guard.sh`'s
half is pre-existing on the integration branch and is not touched by either change.
