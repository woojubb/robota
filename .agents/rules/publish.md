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
- `pnpm publish:beta` runs `scripts/publish/publish-packages.sh` which:
  1. Detects version from agent-core/package.json
  2. Runs `pnpm publish -r --dry-run` (all packages at once, ~4 seconds)
  3. Prompts for OTP (AFTER dry-run so it doesn't expire)
  4. Runs `pnpm publish -r --otp <otp>` (all packages at once, ~4 seconds)
- **NEVER** use any of these:
  - `pnpm publish --filter` (sequential per-package = minutes, OTP expires)
  - `pnpm publish` (without -r)
  - `pnpm changeset publish`
  - `npm publish`
- **No `--tag` flag**: npm automatically sets `latest` to the newly published version. No manual dist-tag sync needed. This eliminates the dist-tag drift problem entirely.

### pnpm publish only — npm publish is blocked (non-negotiable)

- All publish operations MUST go through `pnpm publish`. Never `npm publish`.
- `pnpm publish` resolves `workspace:*` dependencies to actual version numbers in the tarball. `npm publish` does NOT — it publishes `workspace:*` literally, which causes `ETARGET` install failures for consumers.
- Each package has `"prepublishOnly": "bash ../../scripts/check-pnpm-publish.sh"` which blocks `npm publish` at runtime. This is a safety net, not a replacement for following the rule.

### All packages must be published together (non-negotiable)

- `pnpm publish -r` publishes ALL non-private packages in one command. This is why we use `-r` instead of `--filter`.
- `workspace:*` dependencies resolve to the exact version at publish time. If any package is missing, `npm install` fails with `ETARGET`.
- Never cherry-pick which packages to publish. Changesets fixed group means all packages share the same version.

### Publish Safety Gate

- Build and test must pass BEFORE running `pnpm publish:beta`. The script does NOT run build/test internally — the agent must verify these before asking for OTP.
- OTP must be requested ONLY after dry-run succeeds. OTP expires in 30 seconds.
- MUST use `pnpm publish`, NEVER `npm publish`.
- When a package is published for the first time, search `content/` and `docs/` for "not yet published" references and remove them.

### Publish Scope Approval

- `pnpm publish -r` publishes all non-private packages automatically. No cherry-picking needed.
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.
