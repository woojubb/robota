# Eval Datasets

This directory holds evaluation datasets for measuring agent quality and autonomy.

## Structure

```
evals/
├── README.md           # This file
├── harness-log/        # Session log evaluations (rulebased-harness:eval-log)
└── scenarios/          # Task-specific eval scenarios
```

## Usage

- `rulebased-harness:eval-log` skill evaluates conversation logs against harness compliance.
- Add `.jsonl` or `.md` files here to track eval cases over time.
