---
title: 'INFRA-074: the spawn relation names a hook and spawns a shell, without tying one to the other'
status: done
priority: high
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-31
completed: 2026-08-01
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

## GATE-COMPLETE (2026-08-01)

Resolved by reading the call graph, in `scripts/harness/lib/spawn-call-graph.mjs`.

**Red first.** The misclassification case — a module that names `branch-guard.sh` in real code while
spawning `worktree-cwd-guard.sh` — was written and run against the pre-fix relation:

```
FAIL  check-regression-red-proof.test.mjs > a test that NAMES one hook while spawning another
AssertionError: a bystander that never ran this hook was counted as executing it:
expected true to be false
```

**What the relation does now.** It parses the module, finds the spawn calls by their `child_process`
IMPORT BINDING (so a `spawnSync('bash', …)` inside a string literal is not one), and resolves the
expression in ARGV SCRIPT POSITION back through the module's own bindings — literals, template and
`+` concatenation, `path.join`/`path.resolve` under either spelling, `const` initialisers, object and
array literals, `for…of` element bindings, destructuring, local function return values, and a
PARAMETER by unioning the arguments at every call site of its function. That last one is the case a
narrower text pattern could not reach: `run('some-hook.sh', …)` where `run` joins it.

**Three answers, never a guess.** A target that cannot be pinned — a path built from `readdirSync()`
— answers UNDETERMINED. The red-proof gate refuses to let an UNDETERMINED test decide and says so in
the verdict; the coverage floor counts only a resolved execution and names the unresolved files in
its message, because counting a directory sweep as coverage would satisfy that floor for every hook
at once.

**Measured over the whole tree** (120 harness test files × 12 hooks = 1440 pairs):

| | claimed `executes` | `undetermined` |
| --- | --- | --- |
| before | 28 | — (no such answer) |
| after | 27 | 32 |

The one dropped pair is the defect: `check-regression-red-proof.test.mjs` → `branch-guard.sh`, a file
that imports no `child_process` at all and whose every `spawnSync('bash'` sits inside a fixture
STRING. No true pair was lost — the other 27 are unchanged. The 32 new UNDETERMINED pairs are three
files that genuinely build their spawn target at runtime (`guards-fail-closed` sweeps the hooks
directory, `hook-command-parsing` runs `bash -n` over every shell file it finds,
`hook-reading-matches-bash` runs `bash -c` on a script it assembles). Every hook still has at least
one RESOLVED runner, so the coverage floor stays green while getting strictly stricter.

The containment note naming this item is removed from `testExecutesHook`. The gate remains ADVISORY;
promoting it is INFRA-046's decision, not this one's.
