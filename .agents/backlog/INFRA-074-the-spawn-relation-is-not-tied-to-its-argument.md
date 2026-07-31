---
title: 'INFRA-074: the spawn relation names a hook and spawns a shell, without tying one to the other'
status: todo
priority: high
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-31
depends_on: []
issue: https://github.com/woojubb/robota/issues/1540
---

# INFRA-074 — a grep-level relation that now decides a verdict

## Problem

`testExecutesHook` answers "does this test execute this hook?" with two independent checks: the
hook's basename appears in the comment-stripped text, AND the file spawns `bash` somewhere. Nothing
ties the spawn to the name.

So a test that names hook A in real code — a string it reads, a path it asserts on — while spawning
`bash` for hook B is counted as executing A.

## Why it matters more than it did

The relation was written for `hooks-have-execution-coverage`, an advisory floor whose worst outcome
was a message about a hook nobody runs. Its own docstring called it "structural rather than exact …
a grep-level floor by design", and that was a fair trade for what it decided.

INFRA-071 gave it a second job: for a `.claude/hooks` subject it now picks `decidingTests` — the
tests whose pass/fail sets `RED_PROOF_OK` or `ACCIDENTAL_GREEN`. A misclassified bystander can now
supply a verdict about a hook it never ran. The imprecision did not change; the consequence did.

## Why a narrower match is not the fix

Already tried and rejected on evidence: requiring the name inside a `path.join(...)` missed every
test that passes the basename to a helper which joins it (`run('some-hook.sh', …)`) — those tests
run the hook just as truly. Any pattern strict enough to tie name to spawn by text alone will keep
rediscovering that, because the binding is a value flowing through a call, not a lexical adjacency.

Doing it properly means reading the call graph: which argument reaches which spawn. That is a
different kind of analysis from what this file does today, which is why it is a decision rather than
a patch.

## Containment in force

The relation's docstring names this item and states the changed consequence. The gate is ADVISORY
(`REGRESSION_RED_PROOF_ENFORCE` unset), so a misclassification approves nothing today.

**Must be resolved before the gate is promoted to enforcing (INFRA-046)** — the same gate as
[INFRA-073](INFRA-073-one-verdict-for-an-aggregate.md), and for the same reason: at that point these
verdicts start deciding merges.

## Done when

- The relation ties a hook's name to the spawn that receives it, or states in the verdict that it
  could not and returns INCONCLUSIVE instead of guessing.
- A test naming one hook while spawning another is not counted as executing the first, proven by a
  case that fails on today's implementation.
