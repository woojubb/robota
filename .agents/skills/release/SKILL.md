---
name: release
description: Generate one release PR from develop to main, publish its retained npm tarballs, and report delivery artifacts.
---

# Release

An owner release request authorizes versioning, merging, tagging, publication and approval of that release's
npm environment. Use one release PR; do not create a separate version-bump PR or repeat review of unchanged source.

1. Fetch develop and main. Branch from current develop and include any version metadata already on main
   before running `pnpm run version`. Keep that integration on the release branch, not in an extra promotion PR.
   Generate versions with the repository command, never by hand. Open this branch's PR against main.
   Changesets may warn about the product's exact npm aliases; keep those pins until an explicit SDK upgrade.
   Reuse recorded source checks; run only checks needed by changed source. For a CLI release, record the
   installed CLI's normal prompt and slash-command result with disposable HOME/product state.
2. Merge the release PR. A CLI version bump tags its exact main commit and starts native and desktop builds.
   For each changed public SDK package, create `sdk-<package directory>-<configured release prefix><package version>`
   at that same main commit. If only the app version changed, create
   `app-<configured release prefix><app version>` at that commit; a concurrent CLI release already packages
   that app version. SDK and app tags do not start the standalone
   CLI native release. App tags run from their push; recover an app release by rerunning failed jobs in
   that same run, not by dispatching a new one. Publish changed SDK dependencies before dependents.
3. Dispatch `publish.yml` on main for each changed SDK package (`component=sdk`, `package=<directory>`) and,
   if changed, for the CLI (`component=cli`, empty `package`), with each exact tag. Confirm its head SHA, the peeled tag and main
   agree, then approve that run's waiting `npm-publish` deployment. Preparation builds, packs and checks once,
   preserving the exact tarball as an artifact. Publish uses npm trusted publishing with provenance.
4. After an understood partial failure, rerun only failed jobs in the same run. Successful preparation is
   reused; never repack an already published version or restart the entire workflow to resume publication.
   An existing version must have matching integrity.
   The publish job waits, within a 20-minute bound, for the registry to serve the published version and `latest`;
   if that bound passes, resume the same retained artifact.
5. Successful CLI npm completion starts the agent image. The Feature runs when both native and CLI npm
   completion events have succeeded for the same commit. Confirm npm latest versions and durable receipts;
   for CLI releases also confirm native/desktop assets, Feature, multi-platform image delivery and the
   repository's Latest release. Producers create GitHub releases with `--latest=false`; the macOS verification
   workflow marks the tag Latest after both producers are verified and never moves Latest backward. If its
   `mark-latest` job fails or is skipped, run `gh release edit <tag> --latest` once the release is complete.
   For an app-only release, confirm its desktop installers and the app-only macOS verification job.

Keep tarball inspection, integrity, provenance, signing and real installed-artifact checks at the delivery
boundary. Do not repeat full package packing in PR CI or reconstruct past release diffs to authorize a release.
Use short timeouts based on observed work with a small margin. A missing prerequisite is a concrete failed or
pending state, never an unbounded runner wait.

Never overwrite published versions or tags. First publication of a new npm package requires owner OTP/setup;
do not guess or retain credentials. Source changes made after a tag belong to a new release.
