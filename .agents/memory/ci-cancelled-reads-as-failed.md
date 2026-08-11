# A cancelled CI job reads as a failed one

Editing a PR **body** retriggers this repo's CI — the `pull_request` trigger includes `edited`, not
only `synchronize` — and the concurrency group cancels the in-flight run.

Measured on #1588 (2026-08-02): five jobs came back through `gh pr checks` as **`fail`**, with
plausible durations (1m35s–2m3s). None had failed. `gh run view <id> --json jobs` showed
`conclusion: cancelled` and zero failed steps for each.

Two things follow, and both are the same class as
[`check-validity-two-axes.md`](check-validity-two-axes.md) — a status that reads as a verdict it is
not:

- **A cancelled job renders as failed.** Before diagnosing a red check, ask for the job conclusion:

  ```sh
  gh run view <run-id> --json jobs \
    --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped")
          | "\(.name): \(.conclusion) | failed-steps: \([.steps[] | select(.conclusion=="failure") | .name] | join(", "))"'
  ```

- **A settle-watch keyed on `gh pr checks` can read as settled early**, because the superseded run's
  cancelled entries are no longer pending while the new run has not started reporting.

**How to apply:** finish the PR description before the final push. A body edit after the last push
costs a full CI cycle — the same avoidable round
[`run-the-gate-before-you-reach-it.md`](run-the-gate-before-you-reach-it.md) is about.
