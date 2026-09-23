# Execution Cadence

Parent: [AGENTS.md](../../AGENTS.md)

Commit coherent, reviewable work units that include implementation, tests, wiring, and documentation together. Preserve recoverable progress during long work, but do not require commits for planning, same-scope continuation, receipts, lifecycle moves, or closeout metadata.

A correction caused by a failed check or review normally stays in the same work unit. Re-run only verification affected by the correction; remote same-commit retries rerun failed jobs and their aggregators, not successful independent jobs.

Do not rewrite historical evidence to fit the current process.
