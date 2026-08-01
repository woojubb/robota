# Content Docs Beta 59 Sync

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: docs/content-beta-59-sync
- **Scope**: content docs, website documentation source

## Objective

Audit robota.io source documents under `content/` against the current `3.0.0-beta.59` repository state, then update stale handwritten content so the next main deployment publishes accurate documentation.

## Constraints

- Do not edit `content/api-reference/**` directly. It is generated from JSDoc and generator inputs.
- Do not edit `content/v2.0.0/**`. It is legacy frozen content.
- Do not edit generated outputs under `apps/docs/.temp/**` or `apps/docs/.vitepress/dist/**`.
- If API reference content is stale, update source JSDoc or generator inputs in a separate scoped step.

## Checklist

### Baseline and Source Map

- [x] Confirm branch and working tree state.
- [x] Identify latest release/version state from `package.json`, npm tags, and merged PRs.
- [x] List handwritten `content/` files that are in scope.
- [x] List generated/frozen content paths that must remain read-only.

### Home and Navigation

- [x] Audit `content/README.md` for package list, installation commands, feature summary, and release note links.
- [x] Update `content/README.md` where stale.
- [x] Audit `content/getting-started/README.md` for install/setup/API examples.
- [x] Update `content/getting-started/README.md` where stale.
- [x] Audit `content/guide/README.md` navigation and release-note summary.
- [x] Update `content/guide/README.md` where stale.

### Guide Pages

- [x] Audit `content/guide/building-agents.md`.
- [x] Update `content/guide/building-agents.md` where stale.
- [x] Audit `content/guide/sdk.md`.
- [x] Update `content/guide/sdk.md` where stale.
- [x] Audit `content/guide/cli.md`.
- [x] Update `content/guide/cli.md` where stale.
- [x] Audit `content/guide/architecture.md`.
- [x] Update `content/guide/architecture.md` where stale.
- [x] Audit `content/guide/permissions-and-hooks.md`.
- [x] Update `content/guide/permissions-and-hooks.md` where stale.
- [x] Audit `content/guide/context-management.md`.
- [x] Update `content/guide/context-management.md` where stale.
- [x] Audit `content/guide/release-2026-05-02.md`.
- [x] Update `content/guide/release-2026-05-02.md` for beta.58/beta.59, CI/deploy, publish, and dist-tag state.

### Examples

- [x] Audit `content/examples/README.md`.
- [x] Update `content/examples/README.md` where stale.
- [x] Audit `content/examples/basic-conversation.md`.
- [x] Update `content/examples/basic-conversation.md` where stale.
- [x] Audit `content/examples/streaming.md`.
- [x] Update `content/examples/streaming.md` where stale.
- [x] Audit `content/examples/tool-calling.md`.
- [x] Update `content/examples/tool-calling.md` where stale.
- [x] Audit `content/examples/session-management.md`.
- [x] Update `content/examples/session-management.md` where stale.
- [x] Audit `content/examples/multi-provider.md`.
- [x] Update `content/examples/multi-provider.md` where stale.
- [x] Audit `content/examples/one-shot-query.md`.
- [x] Update `content/examples/one-shot-query.md` where stale.
- [x] Audit `content/examples/print-mode.md`.
- [x] Update `content/examples/print-mode.md` where stale.
- [x] Audit `content/examples/interactive-mode.md`.
- [x] Update `content/examples/interactive-mode.md` where stale.
- [x] Audit `content/examples/http-transport.md`.
- [x] Update `content/examples/http-transport.md` where stale.
- [x] Audit `content/examples/ws-transport.md`.
- [x] Update `content/examples/ws-transport.md` where stale.
- [x] Audit `content/examples/mcp-transport.md`.
- [x] Update `content/examples/mcp-transport.md` where stale.

### Generated and Frozen Content

- [x] Confirm `content/api-reference/**` was not manually edited.
- [x] Confirm `content/v2.0.0/**` was not edited.
- [x] If generated API reference is stale, record source/JSDoc follow-up instead of editing generated files.

### Verification

- [x] Run docs structure validation.
- [x] Run docs build.
- [x] Run formatting/check commands needed for changed markdown.
- [x] Review final diff for accidental generated/frozen edits.
- [x] Summarize remaining risks and deployment path.

## Progress

### 2026-05-03

- Created the task checklist before auditing or editing content.
- Created `docs/content-beta-59-sync` from `develop`.
- Confirmed latest coordinated publishable package version is `3.0.0-beta.59`; 18 `@robota-sdk/*` packages are publishable.
- Identified 23 handwritten in-scope content markdown files.
- Marked `content/api-reference/**` and `content/v2.0.0/**` read-only for this task.
- Updated home, getting-started, guide, development, and example pages for beta.59 package/public API state.
- Replaced stale `createSession`/internal SDK examples with public `InteractiveSession` and `createQuery` usage.
- Replaced stale object-style `createZodFunctionTool` examples with the current positional API.
- Refreshed release notes through the 2026-05-03 02:09 KST main promotion and confirmed npm `latest`/`beta` tags for all 18 publishable packages.
- Audited unchanged example/guide pages and left them unchanged where they still matched the current API.
- Passed `pnpm docs:validate-structure`.
- Passed `pnpm docs:build`.
- Passed Prettier check and `git diff --check`.
- Confirmed no diff under `content/api-reference/**`, `content/v2.0.0/**`, `apps/docs/.temp/**`, or `apps/docs/.vitepress/dist/**`.

## Decisions

- Treat `content/api-reference/**` as generated JSDoc output and read-only.
- Treat `content/v2.0.0/**` as frozen legacy content and read-only.
- Use `2ccaecd8e` (PR #148 docs refresh) through current `develop` as the stale-doc comparison range.
- No generated API reference source/JSDoc follow-up was opened because this task found stale content only in handwritten pages.

## Blockers

- None.

## Test Plan

- Run `pnpm docs:validate-structure` to verify package documentation structure after the content sync.
- Run `pnpm docs:build` to verify the robota.io source pages copy into the docs app and build successfully with VitePress.
- Run Prettier checks and `git diff --check` to confirm markdown formatting and whitespace are clean.
- Confirm `content/api-reference/**`, `content/v2.0.0/**`, `apps/docs/.temp/**`, and `apps/docs/.vitepress/dist/**` have no final diff.

## Result

Completed. Handwritten `content/` docs are updated for the `3.0.0-beta.59` state, and verification passed. The changed docs are ready to merge through the normal PR path; after merge to `main`, the docs site deployment path can publish the regenerated site output. No generated API reference or frozen v2.0.0 content was edited.
