# Verification Rules

Rules for build, browser, and harness verification gates.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build of the affected scope.
- Never commit code that does not build successfully.
- Mandatory loop: change -> build -> test -> fix -> re-verify.
- **After every commit that modifies `packages/*/src/`**, run `pnpm build` for the affected packages so the user can immediately test locally. Do NOT skip this step — the user always tests locally after changes.
- Subagents and executing-plans must also follow this rule: build after commit, not just before.

### Browser Verification Requirement

- After changes to web apps (apps/web, apps/dag-studio) or dag-designer UI components, you MUST verify in a browser before reporting completion.
- Use Playwright MCP to navigate to the app URL, take a screenshot, and verify the UI renders correctly.
- Check for: page loads without error, key elements visible, no console errors.
- If the dev server is not running, start it and wait for it to be ready before checking.
- This is non-negotiable — do NOT claim UI changes work without browser verification.

### Pre-Push Local Verification Requirement

- **NEVER push without first running CI checks locally.** Remote CI failure after a local-only fix is a preventable waste.
- Before any `git push`, run locally in order:
  1. `pnpm run typecheck` — zero type errors required
  2. `pnpm run lint` — zero lint errors required (warnings allowed)
  3. `pnpm run test` — all tests must pass
- If any step fails, fix it locally before pushing.
- The `.claude/hooks/pre-push-check.sh` hook enforces this automatically for Claude Code tool calls. Running `git push` directly in the terminal bypasses the hook — you are responsible for running the checks manually in that case.
- This rule exists because repeated CI-only failures waste CI minutes and slow down the feedback loop.

### Execution Safety

- All execution paths must be deterministic and termination-safe.
- Non-determinism (e.g., unbounded retries, silent fallbacks, race conditions) is prohibited.
- See [operational.md](operational.md) No Fallback Policy for details.

### Execution Caching

- Caching execution results is allowed only through an explicit, audited policy.
- Cache keys must be deterministic and content-addressed.
- Stale cache entries must never silently corrupt execution output.

### Harness Direction

- All harness changes (scan, verify, record, review scripts) must be backward-compatible with existing scenario records.
- Harness scripts must not destructively modify scenario records without an explicit `--force` or `--record` flag.
- Scenario ownership maps must be updated before the harness can verify a new scope.

### Harness Operating Model

- Harness is a verification tool, not a code generator.
- Harness results are advisory in development, blocking at release gates.
- Harness scan failures that pre-date a change are not blockers for that change's PR — but must be tracked and resolved.

### Harness Verification Requirement

- After completing a batch of changes (feature branch merge, major refactoring, release prep), a harness verification MUST be performed.
- Run the following in order:
  1. `pnpm build` — full monorepo build must pass
  2. `pnpm test` — all tests must pass with zero failures
  3. `pnpm harness:scan` — consistency, specs, docs structure check
  4. `pnpm typecheck` — TypeScript strict mode verification
- If any step fails, fix the issue before proceeding.
- The harness results must be reported with counts (total tests, failures, build status).
- This is a blocking gate — no merge to `main` or `release/*` without harness pass.
