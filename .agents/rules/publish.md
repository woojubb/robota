# Publish Rules

Rules for package publishing safety and scope management.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Foundation Package Dependency Rule

- `agent-core` is the foundation package. It MUST NOT depend on any `@robota-sdk/agent-*` package.
- Before any publish, verify that `agent-core/package.json` has zero `@robota-sdk/agent-*` entries in `dependencies`.
- If agent-core needs functionality from another package, that functionality must be moved INTO agent-core or the dependency must be inverted.
- This rule also applies to any package that is a transitive dependency of agent-core.
- Violation of this rule blocks publishing — `npm install` will fail with 404 for unpublished upstream packages.

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
- When a package is published for the first time, search `content/` and `docs/` for "not yet published" references to that package and remove them. A newly published package with stale "not yet published" labels in documentation is a process violation.

### Publish Scope Approval

- The set of packages to publish MUST be explicitly confirmed by the user before any publish action.
- When packages are added, removed, renamed, or reorganized, the publish manifest MUST be updated in the release spec document (`.agents/tasks/` or `docs/`) before publishing.
- If no publish manifest exists for the current release, the agent MUST ask the user which packages to publish and record the answer in the release document.
- NEVER assume which packages to publish — always verify against the spec or ask the user.
- Each publishable package must be listed with: package name, version, and publish decision (yes/no/skip).
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.
