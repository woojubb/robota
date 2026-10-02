---
name: release
description: Bump versions, promote develop to main, and publish the selected product's workspace packages to npm.
---

# Release

When the owner asks for a release, the agent carries out every step below, merging each PR itself once CI is
green on its head and every MUST/SHOULD from `pr-review-reviewer` is resolved.

1. **Verify and bump** on a branch from fresh `origin/develop`: personally run the actual source CLI with disposable HOME/product state, submit a normal prompt and a slash command, and require successful session initialization and completed responses.
   Record the exact commit, invocations, provider mode and results in the issue/PR; help/version output alone does not establish a working session. Before publication, repeat this check on the generated/installed CLI artifact intended for release.
   Make sure every changed package has a changeset, run `pnpm run version` (changesets; bare `pnpm version` is pnpm's own command), then `pnpm install` so the lockfile is regenerated — never hand-edit it.
   The bump PR contains the bump and nothing else. Merge it into `develop` through a normal PR.
2. **Promote** `develop` → `main` with a PR whose head is `develop`. On merge,
   `release-tag-on-version-bump.yml` tags the new version; the binary and desktop release workflows run
   from that tag.
3. **Publish** by running the _Publish to npm_ workflow on `main` (`gh workflow run publish.yml --ref main`).
   It waits on the `npm-publish` environment, whose one required reviewer is the owner's account — the one the
   agent's `gh` runs as — so the agent approves it. Approve only the run just dispatched: its `headSha` is
   `origin/main` and its status is `waiting`.

   ```bash
   gh run list --workflow publish.yml --branch main --limit 1 --json databaseId,headSha,status
   GH_REPO="$(node -e 'const u=new URL(process.env.PROJECT_REPOSITORY_URL); if(u.hostname!=="github.com") process.exit(1); let p=u.pathname.slice(1); if(p.endsWith(".git")) p=p.slice(0,-4); process.stdout.write(p)')"
   gh api -X POST "repos/$GH_REPO/actions/runs/<run-id>/pending_deployments" -f state=approved \
     -F "environment_ids[]=$(gh api "repos/$GH_REPO/environments/npm-publish" --jq .id)" -f comment='<release>'
   ```

   It publishes through npm trusted publishing: no token or OTP, provenance attached, and `changeset publish`
   skips versions already on npm, so rerunning after a partial failure is safe. A package npm has never seen
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
