---
name: one-table-two-regex-engines
description: "A pattern table read by both a JS scan and a grep hook means two different things — grep interprets neither \\t nor \\n and matches one line at a time"
metadata:
  node_type: memory
  type: reference
  originSessionId: 22469e82-14ef-4e23-9aea-9e5bd3295700
---

`scripts/harness/payload-language-hazards.tsv` is compiled by the scan with `new RegExp` and matched
by `.claude/hooks/bulk-edit-guard.sh` with `grep -E`. The two do not read it the same way, and the
divergence is silent — the hook simply passed what the scan reported (issue #1957).

- `grep -E` interprets **neither `\t` nor `\n`**. Inside a bracket they are the two characters `\`
  and `t`, so `[ \t]` never matched a tab on the hook side.
- grep matches **one line at a time**, and a real newline cannot go in the pattern either: grep reads
  a newline in a pattern as a **separator between alternative patterns**, so a class holding one
  becomes two patterns and the first has an unmatched `[` (`grep: Unmatched [`).

The fix that makes them agree: expand `\t`/`\n` in the pattern, and fold the newline out of BOTH the
pattern and the payload onto one sentinel (`tr '\n' '\001'`). Folding also makes `^` anchor to the
payload start, which is what JS `new RegExp` without the `m` flag already means by it.

**Verify a regex claim in bash, not zsh.** I "confirmed" a match that did not exist: zsh expanded the
backslash escapes in the variable, so the pattern I tested was not the pattern the hook uses. The
hook runs under bash — test there.

Session-memory mirror of the same fact. Related: [[wiring-tests-assert-the-wrong-half]] — the same
session, the same shape of a check that cannot fail on the defect.
