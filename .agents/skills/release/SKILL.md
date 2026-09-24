---
name: release
description: Bump versions, promote develop to main, and publish the @robota-sdk packages to npm.
---

# Release

1. **Bump** on a branch from fresh `origin/develop`: make sure every changed package has a changeset, run
   `pnpm version` (changesets), then `pnpm install` so the lockfile is regenerated — never hand-edit it.
   The bump PR contains the bump and nothing else. Merge it into `develop` through a normal PR.
2. **Promote** `develop` → `main` with a PR whose head is `develop`. On merge,
   `release-tag-on-version-bump.yml` tags the new version; the binary and desktop release workflows run
   from that tag.
3. **Publish** from an up-to-date `main`: first run `pnpm publish:beta --dry-run` (builds, runs the release
   checks, packs every public package and verifies each tarball contains its declared files). Then run
   `pnpm publish:beta`: the same steps, then `changeset publish` publishes every public package whose version
   is not on npm yet, and the `beta` dist-tag is synced. **Only the owner supplies the OTP** — stop and ask;
   never guess or reuse one. After a partial failure, rerun the same command; versions already on npm are
   skipped.
4. Confirm on npm that every package shows the new version under both `latest` and `beta`.

Stop and ask the owner before: publishing a package for the first time, publishing from anything other than
`main`, or retrying after a partial publish failure you do not understand.
