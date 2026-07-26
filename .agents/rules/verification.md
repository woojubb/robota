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

- After changes to web apps such as `apps/agent-web` or `packages/agent-playground`, you MUST verify in a browser before reporting completion.
- Use Playwright MCP to navigate to the app URL, take a screenshot, and verify the UI renders correctly.
- Check for: page loads without error, key elements visible, no console errors.
- If the dev server is not running, start it and wait for it to be ready before checking.
- This is non-negotiable — do NOT claim UI changes work without browser verification.

### Pre-Merge Code-Review Gate

- Every PR that changes code must pass a `/code-review` with all findings resolved **before** it is
  merged (including the agent's own admin merges to `develop`). This gate is owned by
  [git-branch.md → Pre-Merge Code-Review Gate](git-branch.md); see it for the exact sequence and scope.

### Pre-Push Local Verification Requirement

- **NEVER push new repository content without first running the affected local checks.** Remote CI failure after a local-only fix is a preventable waste.
- The default fast local gate is `pnpm harness:pre-push`, which resolves the branch base and runs the scoped package checks for content that is actually being pushed.
- Default pre-push MUST verify directly changed scopes and repository checks only. Dependent scope expansion is intentionally opt-in through `HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push` or explicit `pnpm harness:verify -- --base-ref <ref>` so local push latency stays bounded.
- Do not duplicate a stronger gate with a weaker one. The CI-equivalent verification entry point is a strict SUPERSET of the pre-push hook — it runs the same `harness:verify` over the affected scopes, plus the build, the scan suite, the e2e suites and commitlint (INFRA-056). If it, `pnpm harness:verify -- --base-ref <ref> --skip-record-check`, or release-grade verification has already passed for the final diff, the pre-push hook is the final safety net, not a separate manual command — and re-running the build by hand after it is wasted minutes.
- Delete-only pushes, branch cleanup after a squash-merged PR, and tree-equivalent pushes MUST NOT re-run package build/test/lint/typecheck. The pre-push hook must skip these mechanically.
- Tree-equivalent skip is valid only when the working tree is clean. Dirty working tree changes must still be planned and verified when `pnpm harness:pre-push` is run manually.
- If the hook skips because no repository content is being published, do not run full checks by habit.
- If any scoped check fails, fix it locally before pushing.
- This rule exists because both CI-only failures and repeated no-op local verification waste minutes and slow down the feedback loop.

### Behavioral Verification Before Push

- Generic build, typecheck, lint, and unit tests are not sufficient when the changed behavior is runtime-observable.
- Before pushing a runtime behavior change, verify the exact user-visible path affected by the change after the final code/doc diff is complete.
- For LLM-driven tool calling, background work, streaming, session persistence, or resume behavior, verification must inspect structured runtime evidence such as tool-call records, background-job events, terminal states, persisted session data, or a headless scenario result. Assistant prose or markup does not count as execution proof.
- A pre-push hook is a final safety net, not a substitute for intentional verification. Do not rely on push-time checks to discover whether the work is valid.
- If feature-specific verification cannot be run locally, stop before pushing and report the blocker and residual risk to the user.
- **Defect-fix regression tests must be proven RED before push.** When a change fixes a bug/leak/race and adds
  or changes a test to guard it, that test does not count as verification until it is demonstrated to FAIL
  against the pre-fix state (revert the fix / run against the merge-base / defect-reproducing fixture), then
  PASS on the fix. A test that passes on both the buggy and fixed code is accidental-green and guards nothing.
  Owner rule + procedure: [tdd-and-planning.md](tdd-and-planning.md) "Prove the regression test RED".

### Delegated Verification Claims

- A "green" you did not observe is a **hypothesis, not a fact**. A verification result reported by a
  delegated worker (a subagent, a script, a summary of a run you did not watch) does not satisfy any gate
  in this file until the actor who will act on it has independently reproduced it.
- Before staging, committing, pushing, or reporting delegated work as done, re-run the affected gates in
  your own context — at minimum the CI-equivalent verification entry point named in
  [git-branch.md](git-branch.md) → Clean Working Tree Before Every Commit and Push, plus
  `pnpm install --frozen-lockfile` when the lockfile was touched.
- This binds whoever consumes the claim, not only whoever invoked a delegation procedure. The pipeline
  that applies it to one delegated mechanical change is
  [delegated-refactor-green-gate](../skills/delegated-refactor-green-gate/SKILL.md).

### Headless CLI Verification Requirement

- Any change that affects CLI execution, transport adapters, `InteractiveSession` behavior used by the CLI, slash/built-in commands, model-invocable commands, tool-call routing, provider setup, session persistence, streaming output, or permission mode behavior MUST include or run a headless verification path.
- Headless verification means a non-interactive `-p`/headless transport scenario or an automated integration test using an injected provider fixture. It must not require a real provider API key.
- For model-routed behavior, the test must prove structured execution occurred, such as tool-call schemas, tool result messages, command/skill activation events, persisted session records, or JSON/stream-json output. Text that merely resembles command output is not proof.
- If the affected behavior is visible in both TUI and headless mode, verify both paths before reporting completion.
- If no suitable headless fixture exists, add one in the owning package before pushing.

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
- Run the CI-equivalent verification entry point named in [git-branch.md](git-branch.md) → Clean
  Working Tree Before Every Commit and Push. It runs the build, the affected packages' tests, the
  scan suite and typecheck as ordered stages, and reports which required contexts it could not run.
  Do not substitute a hand-written list of those commands: a second list is what drifts (INFRA-056).
- For release prep — a promotion to `main` — run `pnpm harness:verify:release`, which is what the
  `release-grade verification` required check executes.
- If any stage fails, fix the issue before proceeding.
- The harness results must be reported with counts (total tests, failures, build status).
- This is a blocking gate — no merge to `main` or `release/*` without harness pass.
