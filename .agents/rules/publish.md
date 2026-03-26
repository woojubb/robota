# Publish Rules

Rules for package publishing safety and scope management.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Foundation Package Dependency Rule

- `agent-core` is the foundation package. It MUST NOT depend on any `@robota-sdk/agent-*` package.
- Before any publish, verify that `agent-core/package.json` has zero `@robota-sdk/agent-*` entries in `dependencies`.
- If agent-core needs functionality from another package, that functionality must be moved INTO agent-core or the dependency must be inverted.
- This rule also applies to any package that is a transitive dependency of agent-core.
- Violation of this rule blocks publishing — `npm install` will fail with 404 for unpublished upstream packages.

### Publish Command (non-negotiable)

- **Always use `pnpm publish:beta`** — this is the ONLY allowed publish command.
- `pnpm publish:beta` runs `scripts/publish/publish-packages.sh` which handles everything: build, test, dry-run, publish with correct tag, and dist-tag sync.
- **NEVER** use any of these: `pnpm publish`, `pnpm run publish`, `pnpm changeset publish`, `npm publish`, or manual per-package `pnpm publish --filter`.
- The script prompts for OTP once and reuses it for all packages + dist-tag updates.
- After prerelease publish (beta/alpha/rc), both the prerelease tag AND `latest` must point to the new version. The script handles this automatically.

### pnpm publish only — npm publish is blocked (non-negotiable)

- All publish operations MUST go through `pnpm publish`. Never `npm publish`.
- `pnpm publish` resolves `workspace:*` dependencies to actual version numbers in the tarball. `npm publish` does NOT — it publishes `workspace:*` literally, which causes `ETARGET` install failures for consumers.
- Each package has `"prepublishOnly": "bash ../../scripts/check-pnpm-publish.sh"` which blocks `npm publish` at runtime. This is a safety net, not a replacement for following the rule.
- `npm dist-tag` commands are fine — they only modify metadata, not package contents.

### All packages must be published together (non-negotiable)

- When version is bumped, ALL non-private `@robota-sdk/*` packages must be published, not just the ones that changed code.
- `workspace:*` dependencies resolve to the exact version at publish time (e.g., `3.0.0-beta.44`). If package A@beta.44 depends on B@beta.44 but B was not published, `npm install A` fails with `ETARGET`.
- `pnpm publish:beta` handles this automatically — it discovers all non-private packages and publishes them all.
- Never cherry-pick which packages to publish. Changesets fixed group means all packages share the same version — they must all be published together.

### Publish Safety Gate

- `pnpm publish:beta` enforces gates internally (build → test → dry-run → confirm → publish → dist-tag sync).
- Additional gates that must pass BEFORE running `pnpm publish:beta`:
  1. `pnpm typecheck` — TypeScript strict mode verification
  2. `pnpm lint` — linting must pass
  3. `pnpm harness:scan` — harness consistency check (when available)
  4. **CI pipeline must pass** — all GitHub Actions checks (ci.yml) must be green.
- If ANY gate fails, publishing is BLOCKED until the issue is resolved.
- OTP must be requested from the user ONLY after all preparation is complete. Do NOT ask for OTP before dry-run succeeds — OTP expires in 30 seconds.
- MUST use `pnpm publish`, NEVER `npm publish`. pnpm resolves `workspace:*` dependencies to actual versions in the tarball. npm does not.
- When a package is published for the first time, search `content/` and `docs/` for "not yet published" references to that package and remove them.

### Publish Scope Approval

- The set of packages to publish MUST be explicitly confirmed by the user before any publish action.
- When packages are added, removed, renamed, or reorganized, the publish manifest MUST be updated in the release spec document (`.agents/tasks/` or `docs/`) before publishing.
- If no publish manifest exists for the current release, the agent MUST ask the user which packages to publish and record the answer in the release document.
- NEVER assume which packages to publish — always verify against the spec or ask the user.
- Each publishable package must be listed with: package name, version, and publish decision (yes/no/skip).
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.
