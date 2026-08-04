---
title: 'INFRA-075: restoring a command-substitution span un-masks the quotes inside it'
status: done
completed: 2026-07-31
priority: high
urgency: now
type: INFRA
area: .claude/hooks
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1542
---

# INFRA-075 — the masker restores a span wholesale, including what it had just masked

## Reproduction (measured 2026-08-01, on `develop`)

```
command:  out=$(printf 'x git commit -m y' | bash h.sh); echo done
verdict:  [branch-guard] Blocked: cannot git commit on protected branch 'develop'.
exit:     2
```

Nothing in that command commits anything. `git commit` appears inside a single-quoted argument to
`printf`, which is exactly the case the masker exists to neutralise — and it does neutralise it when
the same text is not nested:

```
command:  printf 'x git commit -m y' | bash h.sh      → exit 0   (correctly ignored)
command:  out=$(printf 'x git commit -m y' | …)       → exit 2   (falsely refused)
```

## Cause

`lib/command-scan.sh`'s masking runs in two passes. The first masks quoted regions. The second
restores command-substitution spans, because a substitution runs whatever the quoting around it:

```awk
if (substr(s, i, 2) == "$(") {
  … find the matching ")" …
  for (k = i; k <= stop; k++) { m[k] = substr(s, k, 1) }   # ← restores the WHOLE span
}
```

The restore copies every character of the span back from the original — including the quoted text
the first pass had just masked. So a quoted mention nested inside a substitution is un-masked, and
every command hook then reads it as a real invocation.

## Why this is not repaired in place

The second pass is structurally the wrong shape, not a line with a bug in it. A substitution's
content is **itself a command**, so it must be masked by the same rules rather than restored raw —
that is recursion, and the current pass has no way to express it. Restoring a narrower span (only
the unquoted characters) is wrong in the other direction: `"$(git commit)"` inside double quotes
really does run, and expansion inside double quotes is exactly why the restore exists.

This file is the repository's highest-churn guard: **26 commits in 5 days**, and a four-day audit
found seven distinct instances of one class — "command text interpreted by an approximation of the
shell rather than by the shell's own rules". Every one was found by a person hitting a new spelling.
Two of them refused the creation of the branch their own fix lived on. Another patch to the same
pass buys the next spelling, not the class.

## Direction

A tokenizer that models the shell's own grammar for the constructs the guards care about — quoting,
escapes, comments, heredocs, redirections, line continuations, substitutions **nested to any depth**
— with a differential corpus test: for a generated set of spellings, every hook's decision must
match the decision on the same command canonicalised by that tokenizer. The corpus is the
deliverable; the assertion needs no oracle beyond the tokenizer itself.

## Containment in force

None is possible at the call site: the defect is a false REFUSAL, so there is nothing to label in
the path that would otherwise run. What is recorded instead is the reproduction above, so the next
person who is blocked by a quoted mention knows in one search that it is known and why it is not a
one-line fix.

`BRANCH_GUARD_ALLOW_*` overrides remain the operator's way past it, and they announce themselves.

## Resolved (2026-08-01) — the first half

The restore pass now keeps a quote that OPENED INSIDE the span. The first pass already masked such a
region correctly; the second pass was taking it back wholesale. Recording the index where each
enclosing quote opened is enough to tell the two cases apart:

- a quote opened BEFORE the span was context the substitution overrides → restore it;
- a quote opened INSIDE the span belongs to the substitution → it stands.

Measured, both directions:

```
out=$(printf 'x git commit -m y' | bash h.sh); echo done   → exit 0   (was BLOCKED)
git commit -m real            (on develop)                 → exit 2   (unchanged)
out="$(git commit -m x)"                                    → still seen as a commit
```

The differential corpus removed its own exemption for this case, because the exemption was pinned as
a DISAGREEMENT — closing it turned the case red until the exemption was deleted. That is the property
that keeps an exemption from outliving its reason.

**Still open: the second half.** `echo \"git push\"` — an escaped quote is a literal character, so the
verb survives as bare words in an ARGUMENT list, and the masker has no notion of command position.
That needs the tokenizer this item asks for; masking cannot reach it. The corpus still pins it.

## Done when

- The reproduction above returns exit 0.
- Nesting is covered to arbitrary depth, both ways round: a real command inside a quoted string
  inside a substitution is still SEEN, and a quoted mention inside a substitution inside a quoted
  string is still ignored.
- The differential corpus runs in `pnpm harness:scan` or the harness suite, so the next spelling is
  found by the machine rather than by someone being blocked.

## Completion (2026-07-31)

Resolved by PR #1565. The two-pass mask/restore is replaced by a stack-based tokenizer over explicit contexts (SQ / ANSI / TOK / HD / PARAM / ARITH / DQ / CMD), with a differential corpus executed against real bash as the oracle.

Reconciled 2026-08-04: the work had landed and the issue was closed with its evidence, but the Task
file was never moved. Verified against the tree before moving, not taken from the closed issue.
