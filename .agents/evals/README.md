# Eval Datasets

에이전트 품질과 자율성을 측정하는 평가 체계.

## Structure

```
evals/
├── README.md           # This file
├── metrics.md          # Autonomy metrics definition (targets & measurement)
├── local-metrics/      # Local-only generated eval metrics (gitignored)
│   ├── sessions.jsonl      # Per-session metrics and lesson signal totals
│   ├── blocks.jsonl        # Hook block events
│   ├── corrections.jsonl   # User correction prompt signals
│   └── reverts.jsonl       # Rework/revert signals
├── lessons/            # Generated lesson candidates for human review
│   ├── weekly-digest.md
│   └── auto-lessons.md
└── scenarios/          # Task-specific eval scenarios
    ├── build-and-test.md          # TDD cycle compliance
    ├── multi-package-change.md    # Dependency direction compliance
    └── permission-boundary.md     # Branch protection compliance
```

## Metrics

See [metrics.md](metrics.md) for full definitions. Key targets:

| Metric                  | Target |
| ----------------------- | ------ |
| One-Shot CI Pass Rate   | ≥ 80%  |
| Human Intervention Rate | < 20%  |
| Tool Diversity Score    | ≥ 50%  |
| Build Verification Rate | 100%   |

## Local Metrics

The `eval-log-stop.sh` hook runs on every session Stop and appends to `local-metrics/sessions.jsonl`:

```json
{
  "timestamp": "2026-03-19T12:00:00Z",
  "branch": "release/v3.0.0",
  "commits": 3,
  "testFilesChanged": 2,
  "blocks_total": 0,
  "corrections_total": 0,
  "reverts_total": 0
}
```

`local-metrics/` is generated local telemetry for evaluating agent behavior. It is not Robota runtime session history and is not used for `/resume`.

Run `pnpm harness:lessons:digest` to regenerate `lessons/weekly-digest.md` and upsert threshold-crossing candidates into `lessons/auto-lessons.md`. Automated scripts must never write `.agents/rules/common-mistakes.md`; promotion from auto-lessons to common mistakes requires human review.

## Scenarios

Each scenario defines:

- **Input**: what the agent receives
- **Expected behavior**: step-by-step
- **Success criteria**: checkboxes
- **Failure indicators**: anti-patterns to detect
