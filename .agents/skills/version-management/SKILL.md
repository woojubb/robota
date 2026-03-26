---
name: version-management
description: All packages must have the same version. Use changesets for coordinated version bumps. Never version packages independently.
---

# Version Management

## Rules (non-negotiable)

1. **All @robota-sdk/\* packages have the same version** — no exceptions. New packages start at the current monorepo version, not 0.1.0 or 1.0.0.
2. **Use changesets for version bumps** — `pnpm changeset` to create, `pnpm changeset version` to apply.
3. **Never edit version in package.json manually** — changesets manages this.
4. **Fixed versioning group** — all packages are in the same `fixed` group in `.changeset/config.json`. When any package changes, all get the same version.
5. **Prerelease requires `pre enter`** — before `changeset version` in beta, run `pnpm changeset pre enter beta` (only once per pre mode session).
6. **Both dist-tags must be set** — after publish, both `beta` and `latest` dist-tags must point to the newly published version.

## Workflow

### Publish (automated)

```bash
# 1. Create a changeset
pnpm changeset
# Write the .changeset/<name>.md file with affected packages + summary

# 2. Enter prerelease mode (if not already active — check .changeset/pre.json)
pnpm changeset pre enter beta

# 3. Apply version bump
pnpm changeset version

# 4. Commit version changes
git add -A && git commit -m "chore: release <version>"

# 5. Publish all packages + sync dist-tags (single command)
pnpm publish:beta
# Prompts for OTP once, builds, tests, publishes, sets both beta + latest tags
```

### What `pnpm publish:beta` does

Runs `scripts/publish/publish-packages.sh`:

1. Reads version from `agent-core/package.json`
2. Detects prerelease tag (beta/alpha/rc) from version string
3. Builds all packages (`pnpm build`)
4. Runs all tests (`pnpm test`)
5. Dry-run publish for review
6. Publishes each non-private `@robota-sdk/*` package with `--tag <prerelease-tag>`
7. Sets `latest` dist-tag to the same version (so `npm install` gets current build)

### Adding a new package:

1. Set version to current monorepo version in package.json
2. Add package name to `.changeset/config.json` fixed group
3. Publish at the same version as all other packages

## Anti-patterns

- Never use `"version": "0.1.0"` for a new package (must match monorepo version)
- Never manually edit version field in package.json
- Never publish one package at a different version than others
- Never use `npm publish` — always `pnpm publish` (workspace:\* resolution)
- Never forget to set `latest` dist-tag after prerelease publish
- Never run `changeset version` without `pre enter beta` first (drops prerelease tag)
