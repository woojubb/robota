---
title: 'ARCH-026: executor command runners do not share one executable-aware shell resolution contract — scheduled tasks hard-code `sh -c`, while managed tasks can pair an explicit executable with the wrong argument family'
status: done
created: 2026-08-13
completed: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-core
depends_on: []
---

# ARCH-026: executor runners split shell executable and argument-family resolution

## Problem

agent-core declares `resolvePlatformShell` the zero-dependency SSOT for "which shell to spawn, and
how", but executor has no one contract that resolves an executable together with the matching argument
family. The scheduled-task runner bypasses the resolver entirely with `sh -c`. The managed-process
runner calls the resolver, then replaces only its executable with `request.shell` while retaining the
host-default argument family. An explicit `cmd.exe`, PowerShell, `sh`, or `bash` override can therefore be
paired with the wrong arguments even in the sibling that appears to consume the SSOT.

The root defect is not one missed import. Executable identity and command argument syntax are two halves
of one value, but current callers can select them independently. Copying the managed runner's helper into
the scheduled runner would preserve that split and reproduce the next mismatch.

## Evidence

- `packages/agent-core/docs/SPEC.md:416-419` — `resolvePlatformShell` is the "Zero-dependency SSOT
  (TERM-008) for 'which shell to spawn, and how' … Consumed by every shell-running site" (the
  enumerated consumer list omits both executor runners).
- `packages/agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts:3` — correctly
  imports `resolvePlatformShell`, but `resolveShell()` replaces `platformShell.command` with
  `request.shell` and still calls `platformShell.commandArgs(...)`. On win32, an explicit `cmd.exe`
  therefore receives PowerShell arguments; an explicit POSIX shell receives the host-default family.
- `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts:171-172` — hand-rolled
  POSIX-only resolution: `const shell = state.request.shell ?? 'sh'; spawn(shell, ['-c', command], …)`
  — `sh` + `-c` breaks on win32, where the SSOT resolves PowerShell with `-Command`-style args.
- `packages/agent-core/src/utils/platform-shell.ts` resolves its environment override and platform
  default as one `IPlatformShell`, but exposes no explicit-executable input that both executor runners can
  use without separating the command from its family.

## Direction

Extend the agent-core shell resolver with an explicit-executable input whose precedence is request
override > `ROBOTA_SHELL` > `$SHELL`/platform default. Classify basenames across `/` and `\\`, case, and
optional `.exe` for `sh`, `bash`, PowerShell/`pwsh`, and `cmd`; preserve the actual host platform in the
returned metadata even for cross-family overrides. Add one pure executor request-to-shell adapter over
that owner and make both managed and scheduled command runners consume the returned executable and
`commandArgs()` together; neither runner may replace the executable after family resolution. A blank
request override is treated as absent. A non-blank explicit executable whose basename is outside the
recognized families fails closed with a typed unsupported-shell error before either runner spawns; the
resolver must not guess an argument family for an unknown executable.

Add both executor runners to the core SPEC's consumer list and document the explicit-executable contract
so the "consumed by every shell-running site" claim is true. This remains distinct from TERM-007, whose
area excludes executor.

## Recommendation Gate

- 2026-08-16 — the first depth review found the symptom scope foundational; after the Task absorbed the
  missing executable-aware resolver and shared runner-adapter cause, the revised verdict is `DEPTH: LOCAL`.
- 2026-08-16 — independent final review endorsed resolver precedence, closed shell-family classification,
  typed fail-closed unknown-shell behavior, shared runner consumption, and required real-Windows evidence.

REVIEW VERDICT: ENDORSE

## Test Plan

- Red-first: the same pure resolver matrix is exercised by both runner adapters on simulated platforms;
  POSIX/Windows defaults plus Windows `sh`/`bash`, POSIX PowerShell/`pwsh`, `cmd.exe`, path-qualified and
  mixed-case executables, and blank overrides select matching executable/family pairs. Both runners'
  spawned executable and args are asserted. The current scheduled `sh -c` and managed
  `cmd.exe`+PowerShell-args cases must fail before the fix.
- An unrecognized explicit executable produces the typed unsupported-shell error in both runner paths
  and records zero spawn attempts.
- The Windows CI job executes real default-PowerShell managed and scheduled commands; simulated-win32
  assertions do not substitute for that product-path evidence.
- Core SPEC's `resolvePlatformShell` consumer list includes both executor runners.
- Agent-core and agent-executor SPECs and beta-line changeset describe the extended resolver contract;
  `pnpm harness:verify -- --scope packages/agent-executor` is green.

## User Execution Test Scenarios

### Scenario: both public executor runners use the real Windows default PowerShell

- **Agent executability:** `agent-executable` through the repository's existing real-Windows execution
  environment. The agent opens the batch draft PR, waits for `.github/workflows/ci.yml` job
  `windows-shell`, and downloads its artifact with the repository-authenticated GitHub CLI. `gh auth
status` is an explicit preflight; missing repository authentication is a reported blocker, never
  described as credential-free. No manual desktop or TTY is required. A simulated `win32` run is not an
  execution substitute.
- **Prerequisites:** the `windows-shell` job runs on `windows-latest` with Node.js 22 and workspace
  dependencies installed. This work authors the maintained public-SDK example
  `packages/agent-executor/examples/verify-windows-shell-runners.ts` and package script
  `scenario:verify:windows-shell` (`pnpm exec tsx --conditions=source
examples/verify-windows-shell-runners.ts`). It also adds the cross-platform deterministic owner example
  `examples/verify-shell-resolution-contract.ts`, aggregate `scenario:verify`, canonical-owner
  `scenario:record`, and authoritative record
  `examples/scenarios/shell-resolution-contract.record.json`; the aggregate/canonical pair covers the
  pure resolver/runner-adapter matrix, while the Windows-only script is the real spawn evidence. The
  Windows example snapshots and removes `ROBOTA_SHELL` and `SHELL` for the default cases, then restores
  them in `finally`. It resolves installed `sh`, `bash`, Windows PowerShell, `pwsh`, and `cmd.exe` paths
  before exercising explicit overrides.
- **Workflow decision boundary:** the user's standing instruction authorizes completing ARCH-014–028,
  autonomous evidence-based approvals, direct branch pushes, and direct PR merges. That authorization
  covers adding this required Stage-2 product-path step and artifact upload to
  `.github/workflows/ci.yml`. The edit is limited to the existing `windows-shell` job; it does not change
  workflow triggers, branch targets, required-check names, or branch-protection policy.
- **Exact workflow/job command:** job `windows-shell` adds a step named
  `Verify executor runners use default PowerShell` with this PowerShell body:

  ```powershell
  $env:ROBOTA_SCENARIO_OUTPUT = "$env:RUNNER_TEMP\arch-026-windows-shell.json"
  pnpm --dir packages/agent-executor run scenario:verify:windows-shell
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  ```

  A following `actions/upload-artifact@v4` step named `Upload ARCH-026 Windows scenario evidence` uploads
  `$env:RUNNER_TEMP\arch-026-windows-shell.json` as artifact
  `arch-026-windows-shell-${{ github.run_id }}` and uses `if-no-files-found: error`.

- **Trigger/wait/download commands:** after implementation is committed, execute exactly:

  ```bash
  gh auth status
  git push -u origin feat/arch-architecture-batch-3
  gh pr create --draft --base develop --head feat/arch-architecture-batch-3 --title "feat: complete architecture batch 3" --body "Draft opened for ARCH-026 Stage-2 Windows evidence; review-ready only after the downloaded scenario artifact passes."
  arch026_head_sha="$(git rev-parse HEAD)"
  arch026_run_id="$(gh run list --workflow CI --branch feat/arch-architecture-batch-3 --commit "$arch026_head_sha" --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId')"
  test -n "$arch026_run_id"
  gh run watch "$arch026_run_id" --exit-status
  arch026_artifact_dir="$(mktemp -d)"
  gh run download "$arch026_run_id" -n "arch-026-windows-shell-$arch026_run_id" -D "$arch026_artifact_dir"
  node packages/agent-executor/scripts/assert-windows-shell-scenario.mjs "$arch026_artifact_dir/arch-026-windows-shell.json"
  ```

  This work authors the fail-closed assertion script named by the final command. Run selection is pinned
  to the current local HEAD, workflow, branch, event, and one newest matching run. Stage 2 validates the
  downloaded JSON before the draft PR is marked review-ready; it does not wait until PR close-out.

- **Expected observable:** the command exits `0`, prints one deterministic JSON object, and writes the
  identical object to the artifact path. It reports a `default` PowerShell row and explicit `sh`, `bash`,
  `powershell`, `pwsh`, and `cmd` rows. Every row contains both `managed` and `scheduled` results with the
  expected family-specific sentinel, successful exit/fire outcome, and the exact executable basename;
  the scheduled result records exactly one fire. A summary reports `runnerCases: 12`,
  `unknownShellZeroSpawns: true`, and cleanup with every scheduled handle cancelled plus environment
  restored. This directly exercises the previous managed executable/argument mismatch as well as the
  scheduled hard-coded shell. Missing executables/output, a second fire, wrong family, an unknown-shell
  spawn, or cleanup failure exits non-zero. The green job alone is not evidence; the downloaded JSON is
  the required product-surface observable.
- **Cleanup:** in `finally`, cancel the scheduled handle, await cancellation, remove any temporary files,
  restore both shell environment variables, and fail if cancellation or restoration cannot be confirmed.
- **Evidence (2026-08-16):** exact-head CI run
  `https://github.com/woojubb/robota/actions/runs/31902814337` completed its `windows-shell` job
  (`95056073552`) successfully. The `Verify executor runners use default PowerShell` and
  `Upload ARCH-026 Windows scenario evidence` steps both passed. Artifact
  `arch-026-windows-shell-31902814337` was downloaded and the exact assertion command exited `0` with:

  ```json
  {
    "rows": [
      {
        "name": "default",
        "requestedExecutableBasename": "powershell.exe",
        "managed": {
          "success": true,
          "executableBasename": "powershell.exe",
          "output": "arch026-default"
        },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "powershell.exe",
          "output": "arch026-default"
        }
      },
      {
        "name": "sh",
        "requestedExecutableBasename": "sh.exe",
        "managed": { "success": true, "executableBasename": "bash.exe", "output": "arch026-sh" },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "bash.exe",
          "output": "arch026-sh"
        }
      },
      {
        "name": "bash",
        "requestedExecutableBasename": "bash.exe",
        "managed": { "success": true, "executableBasename": "bash.exe", "output": "arch026-bash" },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "bash.exe",
          "output": "arch026-bash"
        }
      },
      {
        "name": "powershell",
        "requestedExecutableBasename": "powershell.exe",
        "managed": {
          "success": true,
          "executableBasename": "powershell.exe",
          "output": "arch026-powershell"
        },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "powershell.exe",
          "output": "arch026-powershell"
        }
      },
      {
        "name": "pwsh",
        "requestedExecutableBasename": "pwsh.exe",
        "managed": { "success": true, "executableBasename": "pwsh.exe", "output": "arch026-pwsh" },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "pwsh.exe",
          "output": "arch026-pwsh"
        }
      },
      {
        "name": "cmd",
        "requestedExecutableBasename": "cmd.exe",
        "managed": { "success": true, "executableBasename": "cmd.exe", "output": "arch026-cmd" },
        "scheduled": {
          "success": true,
          "fires": 1,
          "executableBasename": "cmd.exe",
          "output": "arch026-cmd"
        }
      }
    ],
    "summary": {
      "runnerCases": 12,
      "unknownShellZeroSpawns": true,
      "unknownShellSpawnAttempts": 0,
      "scheduledHandlesCancelled": true,
      "environmentRestored": true
    }
  }
  ```

  Durable executables are `packages/agent-executor/examples/verify-windows-shell-runners.ts` and
  `packages/agent-executor/scripts/assert-windows-shell-scenario.mjs`. The downloaded temporary artifact
  directory was removed after validation.

## Scenario Plan Gate

- 2026-08-16 — revised after guardian review: the Windows-only scenario now specifies authenticated draft
  PR triggering, run discovery/wait, artifact download, and pre-review Stage-2 validation. Its real-Windows
  matrix covers default PowerShell plus explicit sh/bash/PowerShell/pwsh/cmd and unknown-shell zero-spawn
  through both managed and scheduled paths. Invocation probing reached `packages/agent-executor` and failed
  closed with `ERR_PNPM_NO_SCRIPT`; the missing example/script and CI step/artifact are explicit scope for
  this work unit.
- 2026-08-16 — final PLAN correction adds the package aggregate/canonical scenario owner, exact
  authenticated push/draft-PR/current-head run/watch/download/assert commands, and the user's explicit
  authorization boundary for the narrowly scoped existing-job workflow edit.

SCENARIO DRAFTED: automatable | 1

- 2026-08-16 — independent PLAN guardian returned PASS for `both public executor runners use the real
Windows default PowerShell`: the scenario has explicit external-service/auth prerequisites, authorized
  workflow scope, exact trigger/wait/download/assert commands, complete cross-family runner observables,
  cleanup, and package-owned durable scenario evidence.

DONE-GATE-STAGE-1: PASS

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** scenario-written → scenario-verified

- **Direct execution:** exact-head pull-request run `31902814337` executed the real Windows scenario;
  `windows-shell` job `95056073552`, the runner verification step, and artifact upload all succeeded.
- **Expected observable:** the independently downloaded artifact proved six requested shell families and
  twelve managed/scheduled runs, including `sh.exe` requesting the Git-for-Windows `bash.exe` process,
  exact sentinels, one scheduled fire, zero unknown-shell spawn attempts, handle cancellation, and
  environment restoration.
- **Fail-closed comparison:** the repository assertion script exited `0`; it rejects any missing,
  reordered, or mismatched row, basename, sentinel, fire count, or summary value. The independent
  guardian downloaded artifact id `9251559101` again, obtained the same result, and removed its temp dir.
- **Durable evidence:** `packages/agent-executor/examples/verify-windows-shell-runners.ts`,
  `packages/agent-executor/scripts/assert-windows-shell-scenario.mjs`, and
  `packages/agent-executor/examples/scenarios/shell-resolution-contract.record.json` exist.
- **Guardian verdict:** `GATE VERDICT: PASS`.
