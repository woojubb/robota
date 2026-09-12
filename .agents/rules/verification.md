# Verification Rules

Rules for build, browser, and harness verification gates.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Build Requirements

- Source changes require an affected-scope build at the coherent implementation-batch boundary,
  following [execution-cadence.md](execution-cadence.md), not after each edit.
- Never commit code that does not build successfully.
- Batch changes, build, test, and repair failures together. Keep local build artifacts current for
  the user; a commit alone does not invalidate a successful build of identical source inputs.
- Workers and the integration owner share the verification boundary defined in execution-cadence;
  do not duplicate a pre-commit build with a post-commit build when its inputs are unchanged.

### Browser Verification Requirement

- After changes to a web app or any package whose output is rendered in a browser, you MUST verify in a browser before reporting completion.
- Drive a real browser against the running app. Whatever driver is configured, the obligation is
  the same and the evidence is the same: the page loaded, the elements the change concerns are
  present, and the console is clean. Name the driver you used in the report.
- If no browser driver is configured in this repository, that is a missing capability, not an
  exemption. File it and say plainly that the change is unverified — an unverified change reported
  as done is the failure this rule exists to prevent.
- If the dev server is not running, start it and wait for it to be ready before checking.
- This is non-negotiable — do NOT claim UI changes work without browser verification.

### Pre-Merge Code-Review Gate

- Every PR that changes code must pass a `/code-review` with all findings resolved **before** it is
  merged (including the agent's own admin merges to `develop`). This gate is owned by
  [git-branch.md → Pre-Merge Code-Review Gate](git-branch.md); see it for the exact sequence and scope.

### Pre-Push Local Verification Requirement

Before pushing, identify and execute focused tests for each changed behavior and build affected
product source at the batch boundary. Inspect the selected commands and fixtures before execution;
do not invoke a suite that violates the owner's working-directory constraints. The complete
repository-contract, hermetic and pristine scan suites remain CI's responsibility, not an automatic
local prerequisite. A local green command proves only its stated scope.

- The automatic `pnpm harness:pre-push` path checks the push subject, clean tree, lockfile, change
  plan and formatting. It does not run package/scenario suites or reproduce CI. Those local tests
  are intentionally selected by the implementation owner; the hook reports them as not executed.
- Pre-push resolves one comparison base. `HARNESS_BASE_REF` wins; otherwise an exact single-current-
  branch push to the matching `origin` destination may use the unique same-repository open PR's
  immutable base. Failed or ambiguous discovery reports its reason and uses the broader resolver.
- Explicit `pnpm harness:verify` and `pnpm harness:verify-like-ci` diagnostics remain available when
  their execution scope is appropriate. No full local mirror or full-mirror receipt is required.
- Do not repeat affected build/test results on unchanged inputs merely because a push follows.
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

- A worker's result covers only the commands and source state it actually verified, not the integrated
  branch. Inspect its evidence and preserve failures; never promote a partial result to full green.
- The integration owner verifies the final affected batch and checks the actual required remote
  results under [git-branch.md](git-branch.md), plus a frozen-lockfile install when the lockfile
  changed. Workers do focused verification; no actor must duplicate the complete remote scans job
  locally. Cadence and re-run triggers are owned by [execution-cadence.md](execution-cadence.md).

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
- A verification receipt is correctness evidence, not a fuzzy performance cache: reuse requires an
  exact clean-tree match for the pushed commit/tree, resolved base commit, verification profile and
  stage set, runtime/tool versions, lockfile, and verification-owner fingerprint.
- Only a complete successful gate may write a receipt. Partial, failed, malformed, stale, dirty,
  different-object, different-base, or weaker-profile receipts MUST miss and run the normal gate.
- Local diagnostics do not issue a full-CI receipt, and pre-push does not consume one. A cached
  local result must not substitute for the actual required remote verdict.

### Harness Direction

- All harness changes (scan, verify, record, review scripts) must be backward-compatible with existing scenario records.
- Harness scripts must not destructively modify scenario records without an explicit `--force` or `--record` flag.
- Scenario ownership maps must be updated before the harness can verify a new scope.

### Harness Operating Model

- Harness is a verification tool, not a code generator.
- Harness results are advisory in development, blocking at release gates.
- Harness scan failures that pre-date a change are not blockers for that change's PR — but must be tracked and resolved.

### Harness Verification Requirement

- Verify the affected batch before publishing and inspect its actual required remote checks before
  merging, under [git-branch.md](git-branch.md). A merge or branch deletion alone does not invalidate
  verification of identical inputs and does not require another local run.
- For release prep — a promotion to `main` — the protected PR's `release-grade verification`
  required check runs `pnpm harness:verify:release` as the sole automatic content-verification
  owner. The same root command remains available as an explicit local diagnostic; `promote.mjs`
  does not duplicate it before the PR.
- If any stage fails, fix the issue before proceeding.
- The harness results must be reported with counts (total tests, failures, build status).
- This is a blocking gate — no merge to `main` or `release/*` without harness pass.

### A Fixture Decides Nothing Until It Reproduces Reality

**A measurement made against something you wrote is a measurement of what you wrote.** Before a
probe, stub or fixture is allowed to settle a question about the real code, run it once against the
real subject and confirm it reproduces a state you already know. If it cannot, the fixture is the
thing under test, and its answer is about the fixture.

This is not a style preference. The ways a fixture lies are few and recognizable, and each reverses
a conclusion when trusted:

- a stub with no suspension point "proves" a race does not exist — when the real path opens with an
  `await`, the race is real and the stub cannot exhibit it;
- a stub that ignores a flag lets the check for the property that flag carries keep passing after
  the check has lost the property;
- a test run from the wrong directory "proves" its cases never ran — under the config that actually
  governs them, they all do;
- a probe built on an assumed argument grammar measures a different invocation than the one the
  interpreter actually performs.

In each shape the code is fine and the instrument is wrong — and the wrong answer is reported as a
property of the code.

**How to apply.** State, in the change, what the fixture was checked against. A fixture that cannot
be checked against reality is a reason to measure differently, not a reason to proceed.

Enforced by: nothing — whether a fixture was validated before it was trusted leaves no trace a
machine can read, and a check that claimed to decide it would be asserting the very thing it cannot
see.

### Prose Is Written Last, Against the Diff

**A comment, SPEC line, PR body or commit message is written after the code it describes, by reading
the finished diff.** Not from the intent that produced the change.

The dominant defect class in review is a claim that does not match the code — and it is produced by
writing both in one pass, where the sentence describes what the author meant to do and the code
records what they did. It appears in every artifact: a comment explaining a method the same change
deleted; a SPEC naming an export the same change moved; a PR body asserting a measurement that was
taken with the wrong instrument; a changeset advertising a member no code path produces.

**How to apply.** After the code is final, re-read every sentence the change adds or leaves behind
and ask what in the diff makes it true. Delete or correct what nothing supports. Prose about a
change is a claim, and a claim is checked against the diff — the same standard the commit-message
rule already applies to citations.

Enforced by: nothing — whether a sentence describes the code beneath it is not decidable by a
machine, and this repository's experience is that the checks which try end up asserting file
existence while the sentence stays wrong.
