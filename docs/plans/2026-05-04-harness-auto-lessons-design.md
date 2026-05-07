# Harness Auto Lessons Pipeline Design

## Recommendation

Implement Phase C as a thin local-metrics pipeline instead of adding new runtime coupling:

- Keep the Phase B `PreToolUse` block hook as the owner for `blocks.jsonl`.
- Add a `UserPromptSubmit` hook for correction signals because Claude Code exposes the user prompt before model processing.
- Keep Stop-side work inside `eval-log-stop.sh`; it invokes revert detection first, writes session aggregate totals, then runs the digest command idempotently.
- Write generated lesson candidates only under `.agents/evals/lessons/`; `.agents/rules/common-mistakes.md` remains human-curated.

This matches Claude Code hook cadence: `PreToolUse` fires before tool execution and can block, `UserPromptSubmit` runs before prompt processing, and `Stop` runs after the assistant response. Claude Code also runs matching hooks in parallel, so the Stop hook must orchestrate revert detection before session aggregation instead of relying on ordering between separate Stop hook entries.

## Artifacts

- `.agents/evals/local-metrics/blocks.jsonl`
- `.agents/evals/local-metrics/corrections.jsonl`
- `.agents/evals/local-metrics/reverts.jsonl`
- `.agents/evals/local-metrics/sessions.jsonl`
- `.agents/evals/lessons/weekly-digest.md`
- `.agents/evals/lessons/auto-lessons.md`

## Data Flow

1. `check-forbidden-patterns.sh` appends blocked pattern records with session id, pattern, file, line, and escape state.
2. `correction-detect.sh` appends prompt correction records with keyword and previous assistant hash.
3. `eval-log-stop.sh` invokes `revert-detect.sh`, appends session totals, then runs `pnpm harness:lessons:digest`.
4. `lessons-digest.mjs` regenerates the weekly digest and upserts threshold-crossing auto-lessons by stable marker.

## Test Strategy

- Unit tests run digest generation twice and assert no duplicate auto-lesson entry appears.
- Hook fixture tests exercise block, correction, revert, and session aggregate records in a temporary project.
- `harness:self-check` runs the same hook fixtures so hook drift is caught outside unit test runs.

## References

- Claude Code hooks reference: <https://code.claude.com/docs/en/hooks>
