# A claim true when written, not re-derived when the facts under it moved

Four of the five review rounds on ARCH-025's recommendation gate (2026-08-16) turned on **one** failure
mode, and one round of ARCH-030's turned on it too. Each instance was individually small. Together they are
a pattern about how a recommendation is produced, not about any of the items.

## The five instances

| Instance       | What was claimed                                                                                                                                   | What was true                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ARCH-025 rev 1 | `worktreePath`/`branchName` are caller fields the projection drops, and `worktree-subagent-runner.ts:117-122` is a downstream workaround to delete | Those lines are the **only producer**. The worktree does not exist at spawn time. Deleting them would have severed the branch guarding a measured containment breach                                         |
| ARCH-025 rev 2 | Carrying `usage` through `wait()` "is what makes a subagent's tokens reach `/cost`"                                                                | `/cost` is fed by the `background_task_completed` event path and already works. `wait()` feeds a field nothing reads — **and the item's recorded scenario would therefore have passed against unfixed code** |
| ARCH-025 rev 3 | "Typecheck asserts `agent-framework` consumes the exported owner" is the proof                                                                     | It passes with the second re-declaration untouched, because the shape is structurally identical. The check could not fail on the condition it named                                                          |
| ARCH-025 rev 4 | A sentence concluding `NOT-APPLICABLE`, written when that was true                                                                                 | Survived the revision that made it false, so the document instructed phase 2 twice, contradictorily, **stale instruction first**, with a named downstream consumer                                           |
| ARCH-030       | The scenario's `latchThrew` observable "pins the latch"                                                                                            | It read a property the carrier cleanup had already nulled, so it pushed nothing and was unconditionally `null`. It measured nothing while the task file and a gate entry both claimed it measured the latch  |

## Why it recurs

Not carelessness about facts — every one of these was checked **once**, when written. The failure is that the
claim was not re-derived after something underneath it changed: a later section, a later revision, a fix
that moved the property being read. Confidence carries forward from the first check; the fact does not.

Two make it worse than untidy prose:

- **A verification that cannot fail on the condition it names is worse than no verification** — it converts
  "unverified" into "verified", which is the state nobody re-examines.
- **A stale claim with a named downstream consumer is a wrong instruction**, not just a wrong sentence. The
  N/A conclusion would have been read by `user-execution-scenario-author`.

## How to apply

- Before submitting a recommendation, spec, or evidence claim, re-read every **assertion of consequence** —
  "this is user-visible", "this proves X", "this is N/A", "these lines are a workaround" — and ask what it
  would take to be false, then check that, not the claim.
- When a revision changes a fact, grep the document for every sentence that depended on it. A revision that
  edits one section and leaves its conclusion standing elsewhere is the specific shape here.
- For any proposed check, state what would make it **fail**. If you cannot name a realistic input that turns
  it red, it is not a floor. See [[run-the-gate-before-you-reach-it]] and
  [[harness-041-accidental-green-floor]].
- For any observable in a user-execution scenario, prove it flips: measure it against the unfixed code
  before writing the expected value. A green that was already green is the HARNESS-052 class.

Related: [[claimed-without-reading-back]] — that one is about citing a measurement taken against a different
setup; this one is about a measurement that was right and then went stale underneath the claim.
