# Work-run receipts

This directory is the durable, reviewable side of repository work-run measurement. One run owns
immutable generation/revision receipts under `<run-id>/g<generation>-r<revision>.json`. The tracked
`cutover-v1.json` marker defines the adoption boundary and the complete server-observed open-PR registry
captured immediately before introduction.

Raw event streams and branch pointers remain local under `.agents/evals/local-metrics/work-runs/`.
Reports classify every durable record as included, superseded, excluded, invalid, or unavailable;
`state-lost` is invalid but push-permitted only when its surviving Git identity matches exactly.
