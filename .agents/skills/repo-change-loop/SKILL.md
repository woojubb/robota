---
name: repo-change-loop
description: Runs the standard Robota change loop by identifying impact, building affected scope, running targeted verification, and summarizing residual risk. Use when making or reviewing repository changes that should end in an explicit verification result.
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
3. If `packages/*/src/` changed, run the affected package build immediately.
4. Run the most relevant targeted checks:
   - package build
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

- The affected package does not build.
- A targeted test fails.
- A scenario or example verification flow fails.
- Logs include strict-policy or contract-violation signals that indicate the path is invalid.

## Checklist

- [ ] Changed scope is identified before running commands.
- [ ] Affected package build is run for package source changes.
- [ ] Targeted tests or smoke checks are run for changed behavior.
- [ ] CLI/transport/session behavior includes a headless verification path when applicable.
- [ ] Scenario or execution verification is run when relevant.
- [ ] No already-passing gate is repeated without new file changes.
- [ ] Final summary distinguishes verified vs unverified areas.

## Focused Examples

```bash
pnpm --filter @robota-sdk/agent-core build
pnpm --filter @robota-sdk/agent-core test
pnpm --filter @robota-sdk/agent-core lint
pnpm --filter @robota-sdk/agent-core exec tsc -p tsconfig.json --noEmit
```

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## Anti-Patterns

- Editing package source and skipping the build step.
- Running the full workspace by habit when the affected scope is narrow and known.
- Re-running package checks after branch deletion, squash-merge cleanup, or other no-content Git operations.
- Running `pnpm typecheck`, `pnpm lint`, and `pnpm test` manually immediately before `pnpm harness:pre-push` when the harness will execute the same final scoped checks.
- Reporting success without saying what was actually verified.
- Treating documentation reading as equivalent to verification.
- Treating TUI-only checks as sufficient for behavior also reachable through headless CLI mode.

## Related Harness Commands

- Current: `pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios]`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`
- Current review support: `pnpm harness:review -- --scope <packages/foo|apps/bar>`
