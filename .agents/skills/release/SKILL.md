---
name: release
description: Bump versions, promote develop to main, and publish the selected product's workspace packages to npm.
---

# Release

When the owner asks for a release, the agent carries out every step below, merging each PR itself once CI is
green on its head and every MUST/SHOULD from `pr-review-reviewer` is resolved.
For each bump or promotion PR, fetch `origin/develop` and refresh the PR head SHA before selecting, waiting on,
or retrying CI. Use only required checks for that current SHA. A cancelled run on an older head is superseded,
not a failure to retry; wait for the new head's run instead. Retry an actionable failure only after confirming
that the run still matches the PR head and `origin/develop` where the promotion head is `develop`. Recheck the
head before merging.

Generated bump PRs run the release-artifact gate instead of repeating source checks only when CI regenerates
their complete diff byte-for-byte from the base. A `develop` → `main` promotion uses the fast path only when
every first-parent develop commit is a reviewed merge with successful `pr-validation` and `security`, and
every version-changing merge regenerates exactly; missing evidence falls back to the full gate. Release
workflows chain completed prerequisites by events and use the shortest measured timeout with a small margin;
they never occupy a runner polling for another workflow.

1. **Verify and bump** on a branch from fresh `origin/develop`: personally run the actual source CLI with disposable HOME/product state, submit a normal prompt and a slash command, and require successful session initialization and completed responses.
   Record the exact commit, invocations, provider mode and results in the issue/PR; help/version output alone does not establish a working session. Before publication, repeat this check on the generated/installed CLI artifact intended for release.
   Make sure every changed package has a changeset, then run `pnpm run version` (the repository's deterministic Changesets, lockfile and Feature generator; bare `pnpm version` is pnpm's own command). Never hand-edit its output.
   The bump PR contains the bump and nothing else. Merge it into `develop` through a normal PR.
2. **Promote** `develop` → `main` with a PR whose head is `develop`. On merge,
   `release-tag-on-version-bump.yml` tags the new version; the binary and desktop release workflows run
   from that tag, and `release-image.yml` waits for step 3's npm publish, then pushes the agent image.
3. **Publish** by resolving the release tag whose commit is exactly `origin/main`, then running the
   _Publish to npm_ workflow on `main` (`gh workflow run publish.yml --ref main -f tag=<tag>`).
   It waits on the `npm-publish` environment, whose one required reviewer is the owner's account — the one the
   agent's `gh` runs as — so the agent approves it. Approve only the run just dispatched: its `headSha`,
   the selected tag's peeled commit and `origin/main` are identical, and its status is `waiting`.

   ```bash
   gh run list --workflow publish.yml --branch main --limit 1 --json databaseId,headSha,status
   GH_REPO="$(node -e 'const u=new URL(process.env.PROJECT_REPOSITORY_URL); if(u.hostname!=="github.com") process.exit(1); let p=u.pathname.slice(1); if(p.endsWith(".git")) p=p.slice(0,-4); process.stdout.write(p)')"
   gh api -X POST "repos/$GH_REPO/actions/runs/<run-id>/pending_deployments" -f state=approved \
     -F "environment_ids[]=$(gh api "repos/$GH_REPO/environments/npm-publish" --jq .id)" -f comment='<release>'
   ```

   It publishes through npm trusted publishing: no token or OTP, provenance attached, and the exact tarballs
   already inspected by the release gate are uploaded. Existing versions are skipped, so an understood partial
   publication can be rerun safely without repacking. A package npm has never seen
   is refused by the workflow. Then the owner publishes that release
   from an up-to-date `main` with `pnpm publish:beta` instead (OTP; run `--dry-run` first) — it publishes
   every package of the release, without provenance — and registers the new package with
   `bash scripts/publish/configure-trusted-publishers.sh <package>` (2FA), so later releases use the
   workflow again.

4. Confirm on npm that every package's `latest` is the new version. There is no `beta` dist-tag: trusted
   publishing cannot move one.

Stop and ask the owner before: publishing a package for the first time, publishing from anything other than
`main`, or retrying after a partial publish failure you do not understand. Only the owner supplies an OTP or
2FA — never guess or reuse one.
