---
title: 'INFRA-109: flag attribution has two implementations, and the two enforcers disagree'
status: done
completed: 2026-08-21
created: 2026-08-19
priority: high
urgency: next
area: scripts/harness
issue: 'https://github.com/woojubb/robota/issues/1898'
depends_on: []
---

# INFRA-109: one flag-attribution predicate, two implementations, opposite verdicts

## Objective

`bulk-edit-guard.sh` and `scan-symlink-following-enumeration.mjs` are the two halves of one rule —
the hook judges a command as it is about to run, the scan judges the same spelling once it has become
a committed file. Both must answer one question: **is this hazardous flag being passed to THIS
command, in THIS shell statement?**

They answer it with two independent implementations, and only the hook's was ever corrected.

## The measurement

Driving the scan's exported `findingsIn` and the hook's real stdin protocol over the same commands:

| command                                                | hook    | scan                   |
| ------------------------------------------------------ | ------- | ---------------------- |
| `rg -l foo packages \| xargs grep -L bar`              | permits | flags as `rg --follow` |
| `find packages -L`                                     | refuses | clean                  |
| `find packages -name '*.ts' -L`                        | refuses | clean                  |
| `/usr/bin/find -L packages -name x`                    | permits | flags as `find -L`     |
| `sed -i … node_modules/…` vs `sed --in-place …` (hook) | refuses | permits                |
| two statements on two lines vs joined by `&&` (hook)   | refuses | permits                |

Six probed shapes, six disagreements. The last three were added by a later round, and are the reason
this item's scope is wider than the four enumerators it was first written against.

## Why it is here and not fixed in place

The hook has a tokenizer: `segments()` splits a command at `|`, `;`, `&&`, `||`, and `cmd_flag()`
attributes a flag to a command whose word stands earlier in the same segment. That machinery exists
because this exact conflation was reported twice in review of pull request #1886 — a wrapper's flag
argument taking the command-name slot, and an in-place-editor rule reading a conjunction out of a
coincidence.

The scan has no tokenizer and no notion of a separator. Each of its four `RULES` entries hand-rolls
its own bound on what may stand between a command and its flag, and the three that have one are all
different: `find` uses `(?:-[^\s-][^\s]*\s+)*`, `grep` uses `(?:-[a-z][a-z]*\s+)*`, `rg` uses
`(?:[^\s]+\s+)*?`. The last is lazy and unbounded, so it crosses `|`, `;` and `&&` alike.

Correcting the `rg` bound alone leaves `find`'s two false negatives standing and guarantees a fifth
ad-hoc bound the next time a spelling is added. The repository has already priced this shape once:
`scripts/harness/cited-paths.mjs` consolidated five copies of one rule under HARNESS-062, and states
the reason — a rule with three implementations is three rules.

## What a later round corrected in this item

The first version of this item assumed the hook's `segments()` was the good half, to be promoted to
both enforcers. It is not, and promoting it would carry three more defects into the scan:

- **A newline does not separate.** `hook_statement_all_words` emits `&&`, `|` and `;` as words and
  drops the line break, so two statements on two lines merge into one segment. Adding `"\n"` to
  `is_sep` is inert — the token never arrives. The library's `hook_statement_ranges` already splits
  it correctly; that is the reader `segments()` should have been built on.
- **The command word is compared exactly.** `/usr/bin/find -L packages …` is unattributed, and five
  sites are wrong at once. `invokesWith` in `scan-shell-portability.mjs` already answers this with
  `w.endsWith('/' + command)` — a third implementation of the same predicate.
- **The in-place-editor rule hand-rolls a second attribution inside the hook**, rather than using
  `cmd_flag`, and recognises only the short flag: `sed --in-place` into the store is permitted.

So the owner to consume is not a new one. `.claude/hooks/lib/command-scan.sh` owns statement
splitting (the INFRA-079 window), and `scan-shell-portability.mjs` owns walked long-form options and
the qualified-invocation test — and its header records that three successive review rounds of the
regex shape this scan's `RULES` still use each found another spelling it missed.

## Direction (not yet decided)

The shape of the fix is one attribution predicate both halves consume — statement splitting from
`command-scan.sh`, option walking and the qualified-invocation test from the portability scan's
proven form. Whether that owner is a small module the scan imports and the hook shells out to, or a
single judgement process both call, is the design question this item exists to answer.

## Completion criteria

- [x] TC-1: one implementation of flag attribution, consumed by both the hook and the scan — and by
      the hook's in-place-editor rule, which currently has its own.
      `.claude/hooks/lib/flag-attribution.sh`. The scan drives it through
      `.claude/hooks/lib/attribute-lines.sh` for the SHELL population; a non-shell file falls back to
      a generated pattern, which is the limit below.
- [x] TC-2: every row of the table above receives the same verdict from both halves.
      Re-measured first — the table was stale, see below.
- [x] TC-3: a statement separated by a newline separates, judged through `hook_statement_ranges`
      rather than a private word walk.
- [x] TC-4: a path-qualified invocation is attributed (`/usr/bin/find -L` reads as `find -L`).
      Already true when re-measured; kept as a case so it cannot regress.
- [x] TC-5: a long-form option is recognised wherever its short form is (`sed --in-place`,
      `grep --dereference-recursive`, `rg --follow`), by walking options rather than by pattern.
- [x] TC-6: a test asserts hook/scan agreement over a shared case table, so the next added spelling
      cannot land in one half only.
      `scripts/harness/__tests__/flag-attribution.one-owner.test.mjs`, 47 cases.
- [x] TC-7: adding a fifth hazardous spelling requires no new intermediate-token bound.
      One row in `scripts/harness/symlink-following-hazards.tsv`, and a case asserts every generated
      pattern has the same shape.

## Contained by

The follow-up to pull request #1886 labels the disagreement at the hook's `segments()`
(`Contained — INFRA-109.`), under [finding-depth.md](../rules/finding-depth.md). Pull request #1886
itself merged before the label was written, so the integration branch carries the defect unlabelled
until that follow-up lands.

## Progress

### 2026-08-21

**The measurement table in this item was STALE, and re-taking it changed the work.** Driving both
halves over the same commands on 2026-08-21:

| command                                   | hook    | scan                |
| ----------------------------------------- | ------- | ------------------- |
| `rg -l foo packages \| xargs grep -L bar` | permits | clean               |
| `find packages -L`                        | refuses | flags `find -L`     |
| `find packages -name '*.ts' -L`           | refuses | flags `find -L`     |
| `/usr/bin/find -L packages -name x`       | refuses | flags `find -L`     |
| `grep --dereference-recursive foo .`      | refuses | flags `grep -R`     |
| `rg --follow foo`                         | refuses | flags `rg --follow` |

Six of the item's rows, and the two halves now AGREE on all of them. The `rg` lazy bound and the
`find` trailing-flag cases had been corrected in the scan since this was filed. Only two divergences
were live:

- `sed --in-place s/a/b/ node_modules/x/y.ts` — hook **permitted**, because the in-place rule read
  `/^-[[:alnum:]]*i/` and no long form.
- two statements on two LINES — hook **refused**, because a newline never separated them.

The second is the worse direction. It refuses correct work, and a guard that does that is one whose
ack gets pasted by reflex.

**The scan really does consume the hook's attribution**, rather than the two being kept in step by a
test. `attribute-lines.sh` takes the candidate lines in ONE batch and returns what each attributes.
Cost measured before choosing the shape: 161 candidate lines across 27 shell scripts, ~1.1s batched;
a process per line would have been ~40s. The scan went from 239ms to ~3.2s, which is the price and is
recorded as a number rather than as a judgement.

**What is NOT covered, stated rather than left to be found.** 801 of the 962 candidate lines are in
`.mjs`, `.py` and `.yml` files, where shell tokenization of the line is not a reading of anything.
Those keep the generated pattern. Naming the language of a payload embedded in another language — an
`execSync` argument, a workflow `run:` block, a heredoc body — is [INFRA-123], and this is the limit
that item exists for.

That limit is not argued here, it is DEMONSTRATED: this change's own case table is a `.mjs` file, and
the pattern reported eleven of its rows — including `['find without -L', "find packages -name
'*.ts'", []]`, a row whose entire point is that it carries no hazardous flag, matched by reading
across the quotes into the expectation beside it. The shared reading returns nothing for every one of
them. The file is allowlisted, with that reasoning at the entry.

Red-proofed one at a time, each reverted before the next:

| mutation                                      | fails                                          |
| --------------------------------------------- | ---------------------------------------------- |
| segments from the private word walk again     | exactly 1 — a newline separates two statements |
| the in-place rule back to `/^-[[:alnum:]]*i/` | exactly 2 — both long-form spellings           |
| the scan ignoring the shared reading          | exactly 1 — the quoted-mention case            |

The third mutation is the one worth recording. The first version of that case used
`find "$ROOT" -type f -L` and claimed the pattern missed it; it does not, and disabling the shared
reading entirely left all 45 cases green. A QUOTED MENTION is the actual discriminator — the
tokenizer knows quoted content is data and a pattern over text cannot — and the case was rewritten to
assert the disagreement in both directions.

`npx vitest run scripts/harness/__tests__/` — 224 files, 4248 tests, all passed.
`pnpm harness:scan` — 129 passed, 2 skipped.
