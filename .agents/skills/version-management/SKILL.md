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

## Workflow

### After implementation work:

```bash
# 1. Create a changeset describing what changed
pnpm changeset
# Select affected packages, choose bump type (patch/minor/major)
# Write summary

# 2. Apply version bump (all packages get same version)
pnpm changeset version

# 3. Build and test
pnpm build
pnpm test

# 4. Publish
pnpm changeset publish --tag beta
```

### Adding a new package:

1. Set version to current monorepo version in package.json
2. Add package name to `.changeset/config.json` fixed group
3. Publish at the same version as all other packages

## Anti-patterns

- ❌ `"version": "0.1.0"` for a new package (must match monorepo version)
- ❌ Manually editing version field in package.json
- ❌ Publishing one package at a different version than others
- ❌ `--otp` per package — use `pnpm changeset publish` which handles all at once
