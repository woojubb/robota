# Process Rules

Mandatory rules for development process, testing, and build verification.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Spec-First Development

- Any change touching a contract boundary (package imports, class dependencies, service connections, cross-package types) MUST update or create the governing spec BEFORE writing implementation code.
- Spec format follows the boundary type:
  - HTTP API → standardized API specification (e.g., OpenAPI)
  - Package public surface → `docs/SPEC.md`
  - Class/interface dependency → contract definition in the owning package
- Every spec change MUST include a verification test plan.
- Implementation code that does not conform to its governing spec is a bug.
- See [`spec-first-development`](../skills/spec-first-development/SKILL.md) skill for the procedural workflow.

### Spec-Code Conformance Verification

- Any SPEC.md or contract document change MUST be followed by a conformance verification loop before the change is considered complete.
- The spec is the source of truth. The loop compares every spec assertion against implementation code, lists all gaps, and fixes the **code** (not the spec) to match.
- Each code fix MUST include a corresponding contract test.
- The loop repeats until zero discrepancies remain, then regression tests for all affected packages MUST pass.
- A spec change without conformance verification is an incomplete change.
- See [`spec-code-conformance`](../skills/spec-code-conformance/SKILL.md) skill for the full procedure.

### Reverse Spec Verification (Code → Spec)

- Any refactoring that affects package boundaries (dependency changes, export additions/removals, class splits/moves) MUST be followed by a reverse verification of the affected package's SPEC.md.
- The verification checks that the SPEC still accurately describes the current code — not just that the code matches the spec.
- A refactoring without updated SPEC.md is an incomplete change, same as a spec change without conformance verification.

### Cross-Package SPEC Reference Policy

- SPEC.md MUST NOT hardcode counts, lists, or implementation details owned by another package (e.g., "6 built-in tools" when the tools are owned by a different package).
- When referencing another package's details, either reference the owning package's SPEC or describe only what is observable from the current package's own code.
- If cross-package details must be stated, annotate with the owning package name so staleness can be tracked (e.g., "8 built-in tools (per agent-tools)").

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Bug fixes start with a test that reproduces the bug.

### Planning Requirements

- Every development plan MUST include a **Test Strategy** section.
- The test strategy must specify: what to test, how to test (unit / integration / contract / E2E), and the verification commands to run.
- Plans without a test strategy are incomplete and must not be executed.
- For each task in the plan, test steps (write failing test → verify fail → implement → verify pass) must be explicit, not implied.
- When reviewing or approving a plan, verify the test strategy exists and covers the critical paths before proceeding.

### Plan Documentation Requirement

- Every implementation plan MUST be saved as a design document in `docs/plans/YYYY-MM-DD-<topic>-design.md` before execution begins.
- The document must include: goal, architecture, data flow, and affected files.
- Plans that exist only in conversation context are not considered finalized. The document is the SSOT for the plan.
- After implementation is complete, the relevant `packages/*/docs/SPEC.md` files MUST be updated to reflect the changes.
- A plan without a saved design document must not be executed. A completed implementation without updated SPEC.md is incomplete.

### Browser Verification Requirement

- After changes to web apps (apps/web, apps/dag-studio) or dag-designer UI components, you MUST verify in a browser before reporting completion.
- Use Playwright MCP to navigate to the app URL, take a screenshot, and verify the UI renders correctly.
- Check for: page loads without error, key elements visible, no console errors.
- If the dev server is not running, start it and wait for it to be ready before checking.
- This is non-negotiable — do NOT claim UI changes work without browser verification.

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

### Idea Capture Policy

- When the user mentions an idea, suggestion, or future task (e.g., "~하면 좋겠다", "나중에 ~하자", "~해야한다"), do NOT start implementation immediately.
- Instead, record it as a task file in `.agents/tasks/` with status `backlog` and acknowledge briefly ("기록했습니다").
- Continue the current work without interruption.
- Only start implementation when the user explicitly requests it (e.g., "이거 진행해", "할일 목록에서 X 해줘").
- When the user asks to see the backlog ("할일 목록 보여줘"), list all recorded tasks from `.agents/tasks/`.

### Prior Art Research Requirement

- Before implementing any new feature or capability, research whether equivalent solutions already exist in established products (e.g., Claude Code, VS Code, Cursor, Warp, etc.).
- The research MUST be completed BEFORE writing implementation code or finalizing a spec.
- Research deliverables:
  1. **Identify prior art** — which products have this feature, how they implement it.
  2. **Document findings** — save to `.agents/backlog/<item>.md` or the task file under a `## Prior Art Research` section.
  3. **Extract spec decisions** — use research to inform parameter names, UX patterns, edge cases, and defaults.
- If no prior art is found, document that fact explicitly ("No known prior art found").
- A feature implementation that skips prior art research when equivalent solutions obviously exist is a process violation.
- This applies to CLI features, SDK APIs, tool behaviors, and UX patterns — not to internal refactoring or bug fixes.

### Feature Documentation Requirement

- When a new feature is implemented (new tool, new API, new command, new capability), documentation MUST be updated in the same commit or PR.
- Required documentation updates:
  1. **SPEC.md** of the affected package — add or update the feature description.
  2. **README.md** of the affected package — add usage examples if the package is published.
  3. **Backlog/task cleanup** — move completed backlog items to `completed/`.
  4. **Stale content** — any existing documentation that contradicts the new feature MUST be corrected.
- A feature without documentation updates is an incomplete feature.
- This rule is enforced by `harness:scan:specs` which checks that SPEC.md exists and is non-empty for all published packages.

### Foundation Package Dependency Rule

- `agent-core` is the foundation package. It MUST NOT depend on any `@robota-sdk/agent-*` package.
- Before any publish, verify that `agent-core/package.json` has zero `@robota-sdk/agent-*` entries in `dependencies`.
- If agent-core needs functionality from another package, that functionality must be moved INTO agent-core or the dependency must be inverted.
- This rule also applies to any package that is a transitive dependency of agent-core.
- Violation of this rule blocks publishing — `npm install` will fail with 404 for unpublished upstream packages.

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build of the affected scope.
- Never commit code that does not build successfully.
- Mandatory loop: change -> build -> test -> fix -> re-verify.

### Publish Safety Gate

- NEVER run `npm publish` or `pnpm publish` without passing ALL gates first.
- Required sequence before any publish:
  1. `pnpm build` — full monorepo build must pass
  2. `pnpm test` — all tests must pass with zero failures
  3. `pnpm typecheck` — TypeScript strict mode verification
  4. `pnpm lint` — linting must pass
  5. `pnpm harness:scan` — harness consistency check
  6. **CI pipeline must pass** — all GitHub Actions checks (ci.yml) must be green. Do NOT publish from a commit with failing CI.
  7. `pnpm --filter <package> publish --dry-run` — must complete with zero errors
- If ANY gate fails, publishing is BLOCKED until the issue is resolved.
- This rule applies to all packages — no exceptions for "small changes" or "docs only".
- When publishing multiple packages, each must pass its own dry-run independently.
- A publish without prior gate success is a process violation.
- Publishing from a branch other than `main` or `release/*` is prohibited unless explicitly approved.
- OTP must be requested from the user ONLY after all preparation is complete (build, test, typecheck, dry-run all passed). Do NOT ask for OTP before dry-run succeeds — OTP expires in 30 seconds.
- MUST use `pnpm publish`, NEVER `npm publish`. pnpm resolves `workspace:*` dependencies to actual versions in the tarball. npm does not — it publishes `workspace:*` literally, breaking consumers.
- `pnpm pre-publish:check` runs `scripts/pre-publish-docs-check.sh` which validates all publishable packages have: README.md (10+ lines), docs/SPEC.md, package.json description, license, and usage documentation. This is automatically run as part of `pnpm publish:packages`.

### Publish Scope Approval

- The set of packages to publish MUST be explicitly confirmed by the user before any publish action.
- When packages are added, removed, renamed, or reorganized, the publish manifest MUST be updated in the release spec document (`.agents/tasks/` or `docs/`) before publishing.
- If no publish manifest exists for the current release, the agent MUST ask the user which packages to publish and record the answer in the release document.
- NEVER assume which packages to publish — always verify against the spec or ask the user.
- Each publishable package must be listed with: package name, version, and publish decision (yes/no/skip).
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.
