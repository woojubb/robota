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
3. **Publish** from an up-to-date `main`: run `pnpm publish:beta`. It builds, verifies tarballs and runs a
   dry-run before asking for the OTP. **Only the owner supplies the OTP** — stop and ask; never guess or
   reuse one. If some packages already published, rerun the same command; it only targets packages at this
   release's version.
4. Confirm on npm that every package shows the new version under both `latest` and `beta`.

Stop and ask the owner before: publishing a package for the first time, publishing from anything other than
`main`, or retrying after a partial publish failure you do not understand.
