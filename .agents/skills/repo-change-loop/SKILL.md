---
name: repo-change-loop
description: Verify a repository change with focused local evidence while leaving clean builds to PR CI.
---

# Repository Change Loop

## Rule Anchor

- `.agents/rules/verification.md` > "Build Requirements"
- `.agents/rules/verification.md` > "Behavioral Verification Before Push"
- `.agents/rules/verification.md` > "Headless CLI Verification Requirement"
- `.agents/rules/verification.md` > "Harness Direction"

## Use This Skill When

- Modifying code under `packages/*/src/` or `apps/*/src/`.
- Changing execution paths, examples, or verification-related behavior.
- Reviewing a change and deciding what must be built or verified.

## Preconditions

- Identify the changed files.
- Identify the affected package or app scope.
- Determine whether the change touches execution paths, scenarios, examples, or public contracts.

## Execution Steps

1. Classify the change scope:
   - code path
   - type surface
   - scenario or example behavior
   - documentation only
2. Determine the affected packages or apps from the changed paths.
3. Build locally only when a selected executable, reproducer, or check reads generated output. If
   needed, build at the coherent batch boundary defined in
   [execution-cadence.md](../../rules/execution-cadence.md), not after each edit. PR CI owns the
   normal clean affected build.
4. Run the most relevant targeted checks:
   - a package build only when step 3 requires it
   - targeted tests
   - targeted lint or typecheck when the change affects contracts or boundaries
5. If the change affects CLI execution, transports, `InteractiveSession`, commands, model-routed tools, permissions, streaming, provider setup, or session persistence, run or add a headless verification path with structured runtime evidence.
6. If the change affects execution behavior, examples, or scenarios, run the relevant verification flow.
7. Do not repeat an already-passing stronger gate with a weaker duplicate. For example, after a final scoped harness verification or release-grade verification, do not manually re-run the same package checks unless files changed again.
8. Skip verification for Git operations that publish no repository content, such as deleting a merged remote feature branch.
9. Stop immediately on strict-policy failures, contract failures, or non-zero verification exits.
10. Summarize:

- what was verified
- what failed
- what was not verified
- any residual risks

## Stop Conditions

- A required local build fails, or PR CI's clean affected build fails.
- A targeted test fails.
- A scenario or example verification flow fails.
- Logs include strict-policy or contract-violation signals that indicate the path is invalid.

## Checklist

- [ ] Changed scope is identified before running commands.
- [ ] Any build required by a selected local executable or check is run; otherwise PR CI owns it.
- [ ] Targeted tests or smoke checks are run for changed behavior.
- [ ] CLI/transport/session behavior includes a headless verification path when applicable.
- [ ] Scenario or execution verification is run when relevant.
- [ ] No already-passing gate is repeated without new file changes.
- [ ] Final summary distinguishes verified vs unverified areas.

## Focused Examples

```bash
pnpm --filter @robota-sdk/agent-core test
pnpm --filter @robota-sdk/agent-core lint
pnpm --filter @robota-sdk/agent-core exec tsc -p tsconfig.json --noEmit
```

```bash
pnpm --filter @robota-sdk/agent-core build
# Run only when the selected local executable or check consumes this package's built output.
```

## Anti-Patterns

- Running a local build for every package-source edit even when no selected local check consumes it.
- Running the full workspace by habit when the affected scope is narrow and known.
- Re-running package checks after branch deletion, squash-merge cleanup, or other no-content Git operations.
- Assuming `pnpm harness:pre-push` executes product checks. It only prints the changed-input plan and
  reuses commit-hook results.
- Treating dependent package typechecks as mandatory for every local push. Use explicit
  `pnpm harness:verify -- --base-ref <ref>` or focused affected commands when the change risk warrants
  broader validation; `HARNESS_PRE_PUSH_MODE=full` expands only the plan.
- Reporting success without saying what was actually verified.
- Treating documentation reading as equivalent to verification.
- Treating TUI-only checks as sufficient for behavior also reachable through headless CLI mode.

## Related Harness Commands

- Current: `pnpm harness:pre-push`, `HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push`, `pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios]`, and focused package `test`, `lint`, or `typecheck` commands. Use a package build only when its output is a selected local input.
- Current review support: `pnpm harness:review -- --scope <packages/foo|apps/bar>`
