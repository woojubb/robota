# Publish Rules

Rules for package publishing safety and scope management.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Foundation Package Dependency Rule

- `agent-core` is the foundation package. It MUST NOT depend on any `@robota-sdk/agent-*` package.
- Before any publish, verify that `agent-core/package.json` has zero `@robota-sdk/agent-*` entries in `dependencies`.
- If agent-core needs functionality from another package, that functionality must be moved INTO agent-core or the dependency must be inverted.
- This rule also applies to any package that is a transitive dependency of agent-core.
- Violation of this rule blocks publishing — `npm install` will fail with 404 for unpublished upstream packages.

### Publish Command (non-negotiable)

- **Always use `pnpm publish:beta`** — this is the ONLY allowed publish command.
- `pnpm publish:beta` runs `scripts/publish/publish-packages.sh` which:
  1. Detects version from agent-core/package.json
  2. Runs `pnpm publish -r --dry-run` (all packages at once, ~4 seconds)
  3. Prompts for OTP (AFTER dry-run so it doesn't expire before publish)
  4. Runs `pnpm publish -r --otp <otp>` (all packages at once, ~4 seconds)
  5. Syncs `beta` dist-tags for all published packages to the same version
  6. Verifies both `latest` and `beta` dist-tags point to the published version
- **NEVER** use any of these:
  - `pnpm publish --filter` (sequential per-package = minutes, OTP expires)
  - `pnpm publish` (without -r)
  - `pnpm changeset publish`
  - `npm publish`
- **No `--tag` flag on publish**: npm automatically sets `latest` to the newly published version. The publish script explicitly syncs and verifies `beta` afterward to prevent dist-tag drift.

### pnpm publish only — npm publish is blocked (non-negotiable)

- All publish operations MUST go through `pnpm publish`. Never `npm publish`.
- `pnpm publish` resolves `workspace:*` dependencies to actual version numbers in the tarball. `npm publish` does NOT — it publishes `workspace:*` literally, which causes `ETARGET` install failures for consumers.
- Each package has `"prepublishOnly": "bash ../../scripts/check-pnpm-publish.sh"` which blocks `npm publish` at runtime. This is a safety net, not a replacement for following the rule.

### All packages must be published together (non-negotiable)

- `pnpm publish -r` publishes ALL non-private packages in one command. This is why we use `-r` instead of `--filter`.
- `workspace:*` dependencies resolve to the exact version at publish time. If any package is missing, `npm install` fails with `ETARGET`.
- Never cherry-pick which packages to publish. Changesets fixed group means all packages share the same version.
- Any committed change under a package directory, including `README.md`, `docs/README.md`, `docs/SPEC.md`, examples, metadata, or other documentation, is a package change and MUST be represented by a changeset, coordinated version bump, and npm publish when the package is non-private.

### Publish Safety Gate

- Before entering the publish flow, follow [release-operations.md](release-operations.md): the Release Control Plane must identify the current SHA, target version, active gate, next action, and stop condition, and the matching release-run artifact must pass `pnpm harness:release:check -- --version <version> --publish`.
- Build must pass BEFORE running dry-run. The script does NOT run build internally — the agent must verify build first.
- MUST use `pnpm publish`, NEVER `npm publish`.
- When a package is published for the first time, search `content/` and `docs/` for "not yet published" references and remove them.

### OTP Protocol (non-negotiable — no exceptions)

**Claude Code's Bash tool is NOT an interactive TTY.** Running `pnpm publish:beta` without `--otp` causes `read -rp` to fail silently after dry-run and exit before any package is published. The user is left waiting for nothing.

**Mandatory sequence — every step must complete before the next:**

1. `pnpm changeset version` → version bump. Note the new version number.
2. `pnpm build` exits 0 → build confirmed
3. `pnpm harness:release:init -- --version <version>` → create release-run file if it does not exist
4. Update the release-run file: set `Gate status: passed`, `Publish ready: yes`, `NPM auth verified: yes`, `Dry run passed: yes`, `OTP requested: yes`
5. `pnpm harness:release:check -- --version <version> --publish` passes. **If this fails for any reason, fix it before step 6. Never ask for OTP while this is failing.**
6. `npm whoami --registry https://registry.npmjs.org/` → auth confirmed. If auth fails: tell the user to log in, wait for confirmation, rerun `npm whoami`, then continue.
7. `pnpm publish -r --no-git-checks --dry-run` → dry-run passes
8. **STOP. Ask the user:** "OTP를 입력해주세요 (authenticator 앱에서 확인)" — do NOT run any command yet
9. User provides OTP in their reply
10. Immediately run `pnpm publish:beta --otp=<otp> --tag-otp=<otp>` with the OTP from step 9

**Violations that are absolutely forbidden:**

- Asking for OTP before `pnpm harness:release:check` passes — any blocker discovered after OTP request wastes the user's OTP window
- Running `pnpm publish:beta` without `--otp` in any form
- Running `pnpm publish:beta` before receiving OTP from the user in the current turn
- Asking for OTP and then running a different command first (OTP expires in ~30 seconds)
- Asking the user to "type the OTP when prompted" — Claude Code cannot relay interactive prompts
- Running `npm whoami` as the first step of the flow (wastes time if auth is valid; user logs in when needed, not before)

If `pnpm publish:beta` exits after printing only the filtered dry-run package list, do not infer the cause from that filtered output. Immediately rerun `pnpm publish -r --no-git-checks --dry-run` with full unfiltered output in the same permission context to identify the real failure.

Treat sandbox, network, and npm cache errors as environment failures until confirmed otherwise. Re-run npm registry preflight and full dry-run outside the restricted sandbox when the first failure includes `ENOTFOUND`, registry fetch failures, npm cache permission errors, or missing npm log output.

### Publish Scope Approval

- `pnpm publish -r` publishes all non-private packages automatically. No cherry-picking needed.
- Packages marked as `private: true` in package.json are never published.
- New packages that have never been published require explicit user approval on their first publish.
