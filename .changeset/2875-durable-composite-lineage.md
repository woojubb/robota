---
'@robota-sdk/dag-core': patch
'@robota-sdk/dag-runtime': patch
'@robota-sdk/dag-worker': patch
'@robota-sdk/dag-adapters-sqlite': patch
'@robota-sdk/dag-framework': patch
---

Persist composite child run lineage (`IDagRun.lineage`) across restarts (#2875), so a restarted
worker enforces composite depth/ancestry from the persisted run rather than an in-process default.

- `dag-adapters-sqlite` adds migration v3 (`dag_runs.lineage_json`) and reads it back unvalidated —
  a corrupted or hand-edited value is handed through to the caller's decode step rather than
  thrown out of a plain `getDagRun`/`listDagRuns` read.
- `dag-worker` decodes the persisted lineage before entering the executor and fails the task
  deterministically with `DAG_VALIDATION_RUN_LINEAGE_INVALID` on an undecodable value, leaving the
  worker loop free to keep processing other messages instead of crashing over one corrupted run.
- `dag-runtime`'s run-key idempotency now also compares lineage: a duplicate run key whose
  requested composite lineage differs from the existing run's persisted lineage is rejected with
  `DAG_VALIDATION_RUN_KEY_LINEAGE_MISMATCH` instead of silently handing back the existing run.
