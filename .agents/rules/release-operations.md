# Release Operations Rules

Rules for release-level merges, version bumps, CI triage, and npm publishing.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

Release work is an operation, not an exploratory coding task. It must be run from an explicit state machine with visible gates and stop conditions.

### Release Control Plane

Before starting a release, main merge, version bump, or npm publish, write a short execution state in the user-visible update stream. Keep it current whenever the state changes.

The state MUST include:

- current SHA and branch
- target branch and PR number when a PR exists
- target version when a version bump or publish is involved
- exact gate currently running
- next action after the gate passes
- stop condition if the gate fails or stalls

Do not begin OTP-sensitive work while the release state is unclear. Do not keep a long-running watcher active after the user interrupts the turn.

### Release State Machine

Run release operations in this order unless the user explicitly changes the target:

1. Stabilize the source branch first. Fix CI blockers on task branches and merge them back to the source branch.
2. Open or update the source-to-main PR. Wait for release-grade CI and compatibility CI on the exact source SHA.
3. Merge source-to-main only after the release PR is green and release-level merge approval exists.
4. Create a release bump branch from latest `origin/main`, not from a stale local branch.
5. Apply the version bump with changesets, then run `pnpm install` if package manifests changed. Never edit `pnpm-lock.yaml` manually.
6. Run local release preparation checks: `pnpm build`, `pnpm harness:scan:publish`, and diff hygiene.
7. Open a release bump PR to `main`. Wait for the release PR CI on the exact release bump SHA.
8. Merge the release bump PR only after the release CI is green.
9. Pull latest `main`, confirm the release version is not already fully published, then run `pnpm publish:beta`.
10. Ask for OTP only after npm auth and dry-run have succeeded and the publish command is ready for the OTP.

Do not mix unrelated process fixes into a version bump PR. If a process defect is found during release, isolate it on a separate branch unless it directly blocks the current release gate.

### CI Failure Triage

Before changing code to fix a failing release or CI gate, record the failure class and the planned validation path.

Use one of these failure classes:

- product defect
- test race or flake
- CI harness infrastructure
- dependency or lockfile sync
- external environment or service

The triage note MUST include:

- failure signature from the log
- local reproduction status
- owning layer or file
- minimal fix recommendation
- validation command or CI gate that proves the fix

Do not patch by inspection alone when logs are available. Do not treat a pending check as failed without checking the run status and current step.

### Long-Running Gates

Every wait must have a reason. For release CI, publish dry-runs, and npm publishes:

- inspect the current CI job step when a check remains pending beyond a normal short wait
- report whether the process is queued, building, testing, publishing, or stalled
- avoid repeating the same status without adding the current step or next decision
- stop and triage if a gate exceeds the expected behavior for its current step

Long-running release gates should be observed, not hidden behind indefinite `--watch` commands. If a watcher is used, terminate it before switching tasks or after user interruption.

### Dist Artifact Invariant

CI quality jobs that run with `--skip-build` depend on package build output. If the planned checks include `build`, `test`, or `typecheck`, the CI build job MUST run the root monorepo build once and pass package `dist` artifacts to the quality job.

Never reintroduce per-package CI builds for a monorepo release path. Build once at the root and reuse artifacts.

### Publish Boundary

`pnpm publish:beta` is the publish boundary. Build, release-grade CI, and publish safety checks happen before this boundary. OTP belongs only after dry-run success inside this boundary.

If publish fails, first classify the failure with the CI Failure Triage rules. Retry only the missing packages through the existing publish script behavior; do not manually publish individual packages.

### Stop Conditions

Stop the release operation and report state when:

- source-to-main CI fails and the failure has not been triaged
- the release bump PR is not green
- package manifests changed but `pnpm install` was not run
- npm auth or dry-run fails
- the target version is already partially published and the publish script cannot reconcile it
- the working tree is dirty with changes unrelated to the current release state

The final release report MUST list merged PRs, the published version, validation gates, and any skipped or deferred checks.
