---
name: release
description: Bump versions, promote develop to main, and publish the @robota-sdk packages to npm.
---

# Release

1. **Bump** on a branch from fresh `origin/develop`: make sure every changed package has a changeset, run
   `pnpm run version` (changesets; bare `pnpm version` is pnpm's own command), then `pnpm install` so the
   lockfile is regenerated — never hand-edit it. The bump PR contains the bump and nothing else. Merge it
   into `develop` through a normal PR.
2. **Promote** `develop` → `main` with a PR whose head is `develop`. On merge,
   `release-tag-on-version-bump.yml` tags the new version; the binary and desktop release workflows run
   from that tag.
3. **Publish** by running the _Publish to npm_ workflow (`publish.yml`) on `main`; the owner approves the
   `npm-publish` environment. It publishes through npm trusted publishing: no token or OTP, provenance
   attached, and `changeset publish` skips versions already on npm, so rerunning after a partial failure is
   safe. A package npm has never seen is refused by the workflow. Then the owner publishes that release
   from an up-to-date `main` with `pnpm publish:beta` instead (OTP; run `--dry-run` first) — it publishes
   every package of the release, without provenance — and registers the new package with
   `bash scripts/publish/configure-trusted-publishers.sh <package>` (2FA), so later releases use the
   workflow again.
4. Confirm on npm that every package's `latest` is the new version. There is no `beta` dist-tag: trusted
   publishing cannot move one.

Stop and ask the owner before: publishing a package for the first time, publishing from anything other than
`main`, or retrying after a partial publish failure you do not understand. Only the owner supplies an OTP or
2FA — never guess or reuse one.
