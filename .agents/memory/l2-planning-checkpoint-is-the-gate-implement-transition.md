# The L2 planning checkpoint is the GATE-IMPLEMENT transition, not GATE-APPROVAL

## STATUS: learned 2026-09-21 landing MANIFEST-2664's planning checkpoint (PR #2792)

In-repo mirror (memory-mirroring rule). Host mirror: `l2-planning-checkpoint-is-the-gate-implement-transition`.

What `scan-user-execution-plan-order` recognises as an L2 unit's planning checkpoint, and the hook
refusals met on the way there:

- The checkpoint is the **GATE-IMPLEMENT** transition — `gate.mjs judge --gate GATE-IMPLEMENT` then
  `gate.mjs advance`: spec under `.agents/spec-docs/active/` with `status: in-progress`, Task
  `in-progress`. GATE-APPROVAL (`todo/`, `approved`) is not it; a non-planning path staged after
  approval but before that transition is refused with "staged implementation has no planning
  checkpoint ancestor".
- Before the checkpoint every commit must be planning-only. Refused as implementation: a scan-baseline
  JSON edit, and a rewrite of an already-committed OPEN ledger record (`loop-run.mjs round/close` on a
  run committed as OPEN). Park such edits as a patch in the scratchpad and apply them after the
  checkpoint commit.
- The GATE-IMPLEMENT entry's `worktreePaths` must name only the paired Task/spec and the PLAN ledger.
  Hook-regenerated `.agents/evals/lessons/*` present at judgement time get recorded and then fail the
  checkpoint binding — restore them (`git checkout -- .agents/evals/lessons/`) and re-run
  `gate.mjs judge` on a clean tree.
- An unbound OPEN orchestrator run (`loop-run.mjs open` without `--ref`) cannot be committed
  (issue #2504): void it and reopen with `--ref <Task basename>`.
- `PR_MERGE_DECISION` must be the marker line followed only by `FIELD: value` lines; a trailing prose
  paragraph makes `post-findings-authorization.mjs` drop it silently.
- Prettier mangles nested backticks inside an Evidence Log bullet; reword before committing.

Sequence that works: GATE-WRITE → GATE-APPROVAL (owner phrase) → user-execution-scenario PLAN →
GATE-IMPLEMENT → `advance` → one checkpoint commit → then implementation-class housekeeping.

Related: [`split-uncertain-work-into-a-certain-first-bundle.md`](split-uncertain-work-into-a-certain-first-bundle.md).
