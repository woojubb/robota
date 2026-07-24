# Publish & Release Rules

The single release runbook: release-level merges, version bumps, CI triage, publish safety, and npm publishing.
Parent: [rules index](index.md) — absorbed `release-operations.md` (now a pointer stub).

Release work is an operation, not an exploratory coding task. It must be run from an explicit state machine with visible gates and stop conditions.

## Release Operations

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

### Release-Run Artifact

For release or publish operations, create and keep a version-specific release-run file under
`.agents/release-runs/`:

```bash
pnpm harness:release:init -- --version <version>
```

The release-run file is the executable state artifact for the Release Control Plane. It records the
current SHA, branch, PR, target version, active gate, gate status, next action, stop condition,
watcher cleanup status, CI triage notes, and final report fields.

Before publish, the matching artifact MUST pass:

```bash
pnpm harness:release:check -- --version <version> --publish
```

CI-fix work during release MUST append a structured note before code changes:

```bash
pnpm harness:release:triage -- --version <version> --pr <number> --check <check-name>
```

Final release reports SHOULD be generated from the artifact with:

```bash
pnpm harness:release:report -- --version <version>
```

### Release State Machine

Run release operations in this order unless the user explicitly changes the target:

1. Stabilize the source branch first. Fix CI blockers on task branches and merge them back to the source branch.
2. Open or update the source-to-main PR. Wait for release-grade CI and compatibility CI on the exact source SHA.
3. Merge source-to-main only after the release PR is green and release-level merge approval exists.
4. Create a release bump branch from latest `origin/main`, not from a stale local branch.
5. Apply the version bump with changesets, then run `pnpm install` if package manifests changed. Never edit `pnpm-lock.yaml` manually.
6. Regenerate the changelog in the version bump PR: `node scripts/release/generate-release-notes.mjs --write-changelog` (refreshes the generated `Unreleased` section in root `CHANGELOG.md`).
7. Run local release preparation checks: `pnpm build`, `pnpm harness:scan:publish`, and diff hygiene.
8. Open a release bump PR to `main`. Wait for the release PR CI on the exact release bump SHA.
9. Merge the release bump PR only after the release CI is green.
10. Pull latest `main`, confirm the release version is not already fully published, then run `pnpm publish:beta`.
11. Ask for OTP only after npm auth and dry-run have succeeded and the publish command is ready for the OTP.

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

## Publish Rules

### Foundation Package Dependency Rule

- `agent-core` is the foundation package. It MUST NOT depend on any `@robota-sdk/agent-*` package.
- Before any publish, verify that `agent-core/package.json` has zero `@robota-sdk/agent-*` entries in `dependencies`.
- If agent-core needs functionality from another package, that functionality must be moved INTO agent-core or the dependency must be inverted.
- This rule also applies to any package that is a transitive dependency of agent-core.
- Violation of this rule blocks publishing — `npm install` will fail with 404 for unpublished upstream packages.

### Publish Command (non-negotiable)

- **Always use `pnpm publish:beta`** — this is the ONLY allowed publish command.
- `pnpm publish:beta` runs `scripts/publish/publish-packages.sh` which:
  1. Detects version from agent-core/package.json
  2. Runs `pnpm publish -r --dry-run` (all packages at once, ~4 seconds)
  3. Prompts for OTP in an interactive TTY (AFTER dry-run so it doesn't expire before publish). In a non-TTY context (Claude Code's Bash tool) this prompt cannot be answered — `--otp`/`--tag-otp` MUST be passed explicitly; see the OTP Protocol below.
  4. Runs `pnpm publish -r --otp <otp>` (all packages at once, ~4 seconds)
  5. Syncs `beta` dist-tags for all published packages to the same version
  6. Verifies both `latest` and `beta` dist-tags point to the published version
- **NEVER** use any of these:
  - `pnpm publish --filter` (sequential per-package = minutes, OTP expires)
  - `pnpm publish` (without -r)
  - `pnpm changeset publish`
  - `npm publish`
- **No `--tag` flag on publish**: npm automatically sets `latest` to the newly published version. The publish script explicitly syncs and verifies `beta` afterward to prevent dist-tag drift.

### pnpm publish only — npm publish is blocked (non-negotiable)

- All publish operations MUST go through `pnpm publish`. Never `npm publish`.
- `pnpm publish` resolves `workspace:*` dependencies to actual version numbers in the tarball. `npm publish` does NOT — it publishes `workspace:*` literally, which causes `ETARGET` install failures for consumers.
- Each package has `"prepublishOnly": "bash ../../scripts/check-pnpm-publish.sh"` which blocks `npm publish` at runtime. This is a safety net, not a replacement for following the rule.

### All packages must be published together (non-negotiable)

- `pnpm publish -r` publishes ALL non-private packages in one command. This is why we use `-r` instead of `--filter`.
- `workspace:*` dependencies resolve to the exact version at publish time. If any package is missing, `npm install` fails with `ETARGET`.
- Never cherry-pick which packages to publish. Changesets fixed group means all packages share the same version.
- Any committed change under a package directory, including `README.md`, `docs/README.md`, `docs/SPEC.md`, examples, metadata, or other documentation, is a package change and MUST be represented by a changeset, coordinated version bump, and npm publish when the package is non-private.

### Publish Safety Gate

- Before entering the publish flow, the Release Control Plane (above) must identify the current SHA, target version, active gate, next action, and stop condition, and the matching release-run artifact must pass `pnpm harness:release:check -- --version <version> --publish`.
- Build must pass BEFORE running dry-run. The script does NOT run build internally — the agent must verify build first.
- MUST use `pnpm publish`, NEVER `npm publish`.
- When a package is published for the first time, search `content/` and `docs/` for "not yet published" references and remove them.

### OTP Protocol (non-negotiable — no exceptions)

**Claude Code's Bash tool is NOT an interactive TTY.** Running `pnpm publish:beta` without `--otp` causes `read -rp` to fail silently after dry-run and exit before any package is published. The user is left waiting for nothing.

**Mandatory sequence — every step must complete before the next:**

1. `pnpm run version` → version bump (the repo script; runs `changeset version`). NOT `pnpm version` (the builtin — performs no changeset bump). Verify the bump produced version + CHANGELOG diffs, then note the new version number.
2. `pnpm build` exits 0 → build confirmed
3. `pnpm harness:release:init -- --version <version>` → create release-run file if it does not exist
4. Update the release-run file: set `Gate status: passed`, `Publish ready: yes`, `NPM auth verified: yes`, `Dry run passed: yes`, `OTP requested: yes`
5. `pnpm harness:release:check -- --version <version> --publish` passes. **If this fails for any reason, fix it before step 6. Never ask for OTP while this is failing.**
6. `npm whoami --registry https://registry.npmjs.org/` → auth confirmed. If auth fails: tell the user to log in, wait for confirmation, rerun `npm whoami`, then continue.
7. `pnpm publish -r --no-git-checks --dry-run` → dry-run passes
8. **STOP. Ask the user:** "OTP를 입력해주세요 (authenticator 앱에서 확인)" — do NOT run any command yet
9. User provides OTP in their reply
10. Immediately run `pnpm publish:beta --otp=<otp> --tag-otp=<otp>` with the OTP from step 9

**Violations that are absolutely forbidden:**

- Asking for OTP before `pnpm harness:release:check` passes — any blocker discovered after OTP request wastes the user's OTP window
- Running `pnpm publish:beta` without `--otp` in any form
- Running `pnpm publish:beta` before receiving OTP from the user in the current turn
- Asking for OTP and then running a different command first (OTP expires in ~30 seconds)
- Asking the user to "type the OTP when prompted" — Claude Code cannot relay interactive prompts
- Running `npm whoami` as the first step of the flow (wastes time if auth is valid; user logs in when needed, not before)

If `pnpm publish:beta` exits after printing only the filtered dry-run package list, do not infer the cause from that filtered output. Immediately rerun `pnpm publish -r --no-git-checks --dry-run` with full unfiltered output in the same permission context to identify the real failure.

Treat sandbox, network, and npm cache errors as environment failures until confirmed otherwise. Re-run npm registry preflight and full dry-run outside the restricted sandbox when the first failure includes `ENOTFOUND`, registry fetch failures, npm cache permission errors, or missing npm log output.

### Publish Boundary

`pnpm publish:beta` is the publish boundary. Build, release-grade CI, and publish safety checks happen before this boundary. OTP belongs only after dry-run success inside this boundary.

The publish script validates the release-run state for the package version before npm auth, dry-run,
or OTP prompts. If the release-run is missing, pending, failed, or has uncleared watchers, publishing
must stop before asking for OTP.

If publish fails, first classify the failure with the CI Failure Triage rules. Retry only the missing packages through the existing publish script behavior; do not manually publish individual packages.

### Publish Scope Approval

- `pnpm publish -r` publishes all non-private packages automatically. No cherry-picking needed.
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.

### Stop Conditions

Stop the release operation and report state when:

- source-to-main CI fails and the failure has not been triaged
- the release bump PR is not green
- package manifests changed but `pnpm install` was not run
- npm auth or dry-run fails
- the target version is already partially published and the publish script cannot reconcile it
- the working tree is dirty with changes unrelated to the current release state

The final release report MUST list merged PRs, the published version, validation gates, and any skipped or deferred checks.
