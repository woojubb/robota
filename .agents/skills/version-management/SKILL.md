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
# Prompts for OTP after dry-run, publishes, syncs beta, and verifies beta + latest tags
```

### What `pnpm publish:beta` does

Runs `scripts/publish/publish-packages.sh`:

1. Reads version from `agent-core/package.json`
2. Runs `pnpm publish -r --dry-run` (all packages at once, ~4 seconds)
3. Prompts for OTP (after dry-run so it doesn't expire)
4. Runs `pnpm publish -r --otp <otp>` (all packages at once, ~4 seconds)
5. Syncs `beta` dist-tags for all published packages to the same version
6. Verifies both `latest` and `beta` dist-tags point to the published version

Key: uses `pnpm publish -r` (single command) not `--filter` per package (sequential, minutes).
No `--tag` flag on publish: npm automatically sets `latest` to the new version. The script explicitly syncs `beta` afterward.

### Release-Time Gotchas (observed in beta.76, 2026-06-14)

1. **`pnpm version` is NOT the bump command.** `pnpm version` runs the pnpm/npm builtin (prints
   node/package versions, performs no changeset bump). The bump is the repo script
   **`pnpm run version`** (= `changeset version`). Symptom of the footgun: the command "succeeds"
   but no `package.json` / `CHANGELOG.md` changes. **Verify the bump**: `git status` must show
   version + CHANGELOG diffs before committing.
2. **Every changed public package needs a changeset BEFORE the bump.** With the fixed group all
   packages bump together, but a package without a changeset gets an empty CHANGELOG entry. If only
   some packages had changesets, the bump produces an incomplete CHANGELOG — revert the bump, add
   the missing `.changeset/*.md`, and re-run `pnpm run version`. Checklist before bumping: every
   package touched since the last release tag is named in some changeset.
3. **OTP expiry mid-publish is recoverable.** OTPs are short-lived and `pnpm publish -r` across many
   packages can outlast one. `scripts/publish/publish-packages.sh` is idempotent — already-published
   packages are skipped — so on `EOTP`/`E401` simply re-run `pnpm publish:beta` with a fresh OTP.
4. **Registry propagation lag causes false dist-tag mismatches.** The publish script's final
   verification can report a stale tag (e.g. `beta=...older`) seconds after publish. Confirm
   directly per package before treating it as a failure:
   `npm dist-tag ls @robota-sdk/<pkg>` — both `latest` and `beta` should show the new version.
   (zsh footgun: `for p in $PKGS` does not word-split a string var — use an inline literal list or
   an array so the loop actually iterates.)

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
