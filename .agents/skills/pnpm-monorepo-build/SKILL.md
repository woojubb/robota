---
name: pnpm-monorepo-build
description: pnpm workspace build gotchas — lifecycle-script (pre/post) silence and surgical lockfile edits for workspace dependencies. Use when a build step silently does not run or when adding/removing a workspace dependency.
---

# pnpm Monorepo Build

## Rule Anchor

- `AGENTS.md` > "Project Structure"
- `AGENTS.md` > "Build Requirements"

Build/filter commands are listed in the root `package.json` scripts (`pnpm run` to enumerate;
`pnpm --filter <pkg> build` to scope). This skill owns only the two learned gotchas below.

## Lifecycle Scripts (`pre`/`post`)

pnpm does **not** run npm-style `pre<script>`/`post<script>` hooks by default
(`enable-pre-post-scripts` is off). A `postbuild` will silently never run from `pnpm build`.

- Chain the step explicitly in the script instead: `"build": "next build && <step>"`.
- Make the step's tool a real `devDependency` (not an ambient/`npx`-fetched binary).
- Verify the produced artifact exists, not just a zero exit code — a missing pre/post step does
  not fail the build.

## Adding a Workspace Dependency (surgical lockfile edit)

When adding (or removing) a `workspace:*` dependency between packages, edit the lockfile
**surgically** — never regenerate it with a full `pnpm install` in a network-restricted/sandbox
environment.

1. Consumer `package.json`: add `"<scope>/<pkg>": "workspace:*"`.
2. Surgical `pnpm-lock.yaml` edit — add to that package's `dependencies:` block:
   `specifier: workspace:*` + `version: link:../<pkg>` (sibling package) or
   `link:../../packages/<pkg>` (app consuming a package).
3. Verify with `pnpm install --frozen-lockfile` — must succeed without rewriting the lockfile, and
   the lockfile diff must be limited to the intended block.

**NEVER** commit a lockfile a full `pnpm install` regenerated in a network-restricted env: offline
resolution prunes thousands of lines — a corrupting change, not a dependency update. If
`--frozen-lockfile` fails, fix the surgical edit; never regenerate the whole lockfile.
