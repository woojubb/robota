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
   Reuse recorded source checks; run only checks needed by changed source. Record the installed CLI's normal
   prompt and slash-command result with disposable HOME/product state before publication.
2. Merge the release PR. The version-bump workflow tags its exact main commit. Native binaries and desktop
   installers start independently from that tag. Neither waits for the Dev Container Feature.
3. Dispatch `publish.yml` on main with the exact release tag. Confirm its head SHA, the peeled tag and main
   agree, then approve that run's waiting `npm-publish` deployment. Preparation builds, packs and checks once,
   preserving the exact tarballs as an artifact. Publish uses npm trusted publishing with provenance.
4. After an understood partial failure, rerun only failed jobs in the same run. Successful preparation is
   reused; never repack an already published version or restart the entire workflow to resume publication.
   Existing versions must have matching integrity. Missing packages publish with bounded concurrency.
   Registry visibility is checked once; if it is transiently unavailable, resume the same retained artifact.
5. Successful npm completion starts the agent image. The Feature runs when both native and npm completion
   events have succeeded for the same commit, without polling. Confirm npm latest versions, durable receipts,
   native/desktop assets, Feature and multi-platform image delivery separately before calling release complete.

Keep tarball inspection, integrity, provenance, signing and real installed-artifact checks at the delivery
boundary. Do not repeat full package packing in PR CI or reconstruct past release diffs to authorize a release.
Use short timeouts based on observed work with a small margin. A missing prerequisite is a concrete failed or
pending state, never an unbounded runner wait.

Never overwrite published versions or tags. First publication of a new npm package requires owner OTP/setup;
do not guess or retain credentials. Source changes made after a tag belong to a new release.
