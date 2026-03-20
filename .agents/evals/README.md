# Eval Datasets

에이전트 품질과 자율성을 측정하는 평가 체계.

## Structure

```
evals/
├── README.md           # This file
├── metrics.md          # Autonomy metrics definition (targets & measurement)
├── harness-log/        # Session log evaluations (auto-collected by Stop hook)
│   └── sessions.jsonl  # Per-session metrics (commits, test files, branch)
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

## Session Logging

The `eval-log-stop.sh` hook runs on every session Stop and appends to `harness-log/sessions.jsonl`:

```json
{
  "timestamp": "2026-03-19T12:00:00Z",
  "branch": "release/v3.0.0",
  "commits": 3,
  "testFilesChanged": 2
}
```

## Scenarios

Each scenario defines:

- **Input**: what the agent receives
- **Expected behavior**: step-by-step
- **Success criteria**: checkboxes
- **Failure indicators**: anti-patterns to detect
