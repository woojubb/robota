# Publish & Release Rules

The release invariants: what must hold during a release-level merge, a version bump, CI triage, and an npm
publish — and **who owns each fact**.
Parent: [rules index](index.md) — absorbed `release-operations.md` (now a pointer stub).

Release work is an operation, not an exploratory coding task. It runs from an explicit state machine with
visible gates and stop conditions.

**The ordering is not here.** The release pipeline — which phase runs when, and what each outcome routes to
— is owned by [`release-orchestration`](../skills/release-orchestration/SKILL.md) and its three phase
skills ([`source-stabilization`](../skills/source-stabilization/SKILL.md),
[`version-bump`](../skills/version-bump/SKILL.md),
[`npm-otp-publish`](../skills/npm-otp-publish/SKILL.md), plus the shared
[`ci-gate-watch`](../skills/ci-gate-watch/SKILL.md)). The judgement of _why a gate is red_ is owned by the
[`ci-failure-triager`](../../.claude/agents/ci-failure-triager.md) agent, and _whether a merge landed_ by
`merge-verifier`. This document states only what must hold, wherever those run.

## Release Operations

### Release Control Plane

Before starting a release, main merge, version bump, or npm publish, an execution state MUST be written in
the user-visible update stream and kept current whenever the state changes.

The state MUST include:

- current SHA and branch
- target branch and PR number when a PR exists
- target version when a version bump or publish is involved
- exact gate currently running
- next action after the gate passes
- stop condition if the gate fails or stalls

Do not begin OTP-sensitive work while the release state is unclear. Do not keep a long-running watcher
active after the user interrupts the turn.

### Release-Run Artifact

For release or publish operations, a version-specific release-run file MUST exist under
`.agents/release-runs/`, created with:

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

The ordered pipeline is owned by [`release-orchestration`](../skills/release-orchestration/SKILL.md); its
phase boundaries and failure edges are defined there and are not restated here. The constraints that hold
regardless of how the pipeline is driven:

- Release operations run in the phase order that skill defines, unless the user explicitly changes the target.
- A release-level merge to a protected branch requires explicit approval ([git-branch.md](git-branch.md)).
- Create a release bump branch from the latest `origin/main`, never from a stale local branch.
- Never edit `pnpm-lock.yaml` manually. Run `pnpm install` when package manifests changed.
- The version bump PR MUST carry a regenerated changelog, produced by
  `node scripts/release/generate-release-notes.mjs --write-changelog` — never hand-written.
- Do not mix unrelated process fixes into a version bump PR. If a process defect is found during release,
  isolate it on a separate branch unless it directly blocks the current release gate.
- Wait for release-grade and compatibility CI on the **exact** SHA under merge; a green result on an
  earlier SHA has not verified the current one.

Version-bump mechanics (changesets, the fixed version group, semver classification, dist-tag expectations)
are owned by [`version-management`](../skills/version-management/SKILL.md).

### Promotion Body — Closing Keywords

GitHub acts on a closing keyword only on a pull request whose base is the DEFAULT branch. In a
feature → `develop` → `main` flow the promotion is therefore the only pull request whose keywords do
anything, and every keyword written on a feature pull request is prose.

- The promotion pull request body MUST carry a closing keyword for every open issue the pull requests
  it promotes declared they close.
- That block is DERIVED, never composed by hand: `node scripts/harness/promote.mjs` prints it, from
  the promotion's own commit subjects. Paste it as printed.
- A derivation that cannot complete FAILS LOUDLY and blocks. An underivable requirement is not an
  empty one — a short block is indistinguishable from a promotion that genuinely closes nothing.
- Only a `#N` that resolves to an OPEN issue is carried. A work-item identifier after a closing
  keyword is not an issue reference and is dropped.

Enforced by: `scripts/harness/scan-promotion-closes.mjs`, run as the `promotion closes` job in
`.github/workflows/ci.yml` and required on `protect-main`. It re-derives the requirement from the
live pull request and blocks a body that omits any of it. Record:
[INFRA-104](../tasks/completed/INFRA-104-promotion-carries-closing-keywords-to-main.md).

### CI Failure Triage

Before changing code to fix a failing release or CI gate, the failure class and the planned validation path
MUST be recorded. The classification criteria — the closed class vocabulary and how to choose between
classes — are owned by the [`ci-failure-triager`](../../.claude/agents/ci-failure-triager.md) agent; do not
restate them here.

The triage note MUST include:

- failure signature from the log
- local reproduction status
- owning layer or file
- minimal fix recommendation
- validation command or CI gate that proves the fix

Do not patch by inspection alone when logs are available. Do not treat a pending check as failed without
checking the run status and current step.

### Long-Running Gates

Every wait must have a reason. Stop and triage if a gate exceeds the expected behavior for its current
step. Report whether the process is queued, building, testing, publishing, or stalled, rather than
repeating the same status without adding the current step or next decision.

Long-running release gates are observed, not hidden behind indefinite `--watch` commands. If a watcher is
used, it MUST be terminated before switching tasks and after user interruption. The observation loop that
enforces this is [`ci-gate-watch`](../skills/ci-gate-watch/SKILL.md).

### Dist Artifact Invariant

CI quality jobs that run with `--skip-build` depend on package build output. If the planned checks include
`build`, `test`, or `typecheck`, the CI build job MUST run the root monorepo build once and pass package
`dist` artifacts to the quality job.

Never reintroduce per-package CI builds for a monorepo release path. Build once at the root and reuse artifacts.

## Publish Rules

### Foundation Package Dependency Consequence

The dependency-direction rule itself — which package is the foundation and what it may depend on — is owned
by [`.agents/project-structure.md`](../project-structure.md) ("Layered Assembly Architecture") and
mechanically enforced by `scripts/harness/check-dependency-direction.mjs`. Do not restate it here.

The publish-specific consequence, which that document does not carry:

- **A dependency-direction violation blocks publishing.** `npm install` fails with 404 for unpublished
  upstream packages, so the violation surfaces to consumers rather than to CI.
- Before any publish, `pnpm harness:scan:publish` (`check-publish-safety.mjs`) MUST confirm the foundation
  package has zero `@robota-sdk/agent-*` entries in `dependencies`. This is a publish gate, not advice.

### Publish Command (non-negotiable)

- **Always use `pnpm publish:beta`** — this is the ONLY allowed publish command. What the script does
  internally is documented once, in [`version-management`](../skills/version-management/SKILL.md).
- **In a non-TTY context** (Claude Code's Bash tool) the script's interactive OTP prompt cannot be
  answered — `--otp`/`--tag-otp` MUST be passed explicitly. See the OTP Protocol below.
- **NEVER** use any of these:
  - `pnpm publish --filter` (sequential per-package = minutes, OTP expires)
  - `pnpm publish` (without -r)
  - `pnpm changeset publish`
  - `npm publish`
- **No `--tag` flag on publish**: npm automatically sets `latest` to the newly published version. The
  publish script explicitly syncs and verifies `beta` afterward to prevent dist-tag drift.

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

**Claude Code's Bash tool is NOT an interactive TTY.** Running `pnpm publish:beta` without `--otp` causes
`read -rp` to fail silently after dry-run and exit before any package is published. The user is left
waiting for nothing.

The ordered sequence — preflight, the hard halt for the user, and the publish that must immediately follow
it — is owned by [`npm-otp-publish`](../skills/npm-otp-publish/SKILL.md). Every step of that sequence MUST
complete before the next begins. The prohibitions below hold however it is driven.

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

Each condition above is a terminate edge of
[`release-orchestration`](../skills/release-orchestration/SKILL.md); the routing lives there, the
conditions live here.

The final release report MUST list merged PRs, the published version, validation gates, and any skipped or deferred checks.
