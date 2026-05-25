# Pre-Release Readiness Report — Robota SDK 3.0.0-beta.67

**Date:** 2026-05-25  
**Auditors:** Senior Developer Perspective + Product Manager Perspective (parallel audit)  
**Source reports:**

- `.agents/reports/pre-release-dev-audit.md` — technical/code audit
- `.agents/reports/pre-release-pm-audit.md` — developer experience/product audit

---

## Overall Verdict

| Dimension        | Verdict          | Summary                                                                     |
| ---------------- | ---------------- | --------------------------------------------------------------------------- |
| **Code quality** | ✅ READY         | 3,971 tests pass, typecheck clean, build green                              |
| **API surface**  | ⚠️ NEEDS WORK    | 4 technical blockers: stub export, wrong import, 2 CLI doc lies             |
| **DX / Docs**    | ⚠️ NEEDS WORK    | 3 trust-destroying issues: broken CONTRIBUTING, no beta callout, dead links |
| **Overall**      | ❌ NOT READY NOW | Fix 7 blockers → ✅ SOFT LAUNCH READY                                       |

The SDK's core mechanics are solid. All tests pass, the embedding story is genuinely differentiated, the local model support is first-class, and the examples directory is impressive. The blockers are all **fixable within a few days** — they are documentation errors and two code stubs, not architectural problems.

---

## Critical Blockers (must fix before ANY public promotion)

These 7 issues will cause a new developer to fail within the first 30 minutes.

### B1 — Wrong export name in root README (1 line fix)

**File:** `README.md:25`  
`import { query }` → should be `import { createQuery }`  
The Quick Start snippet causes an immediate `TypeError: query is not a function`.

### B2 — Invalid npm install command in docs (1 line fix)

**Files:** `content/getting-started/README.md:58,64`  
`npm install @robota-sdk/agent-provider/anthropic` is not valid npm syntax.  
Sub-path exports (`/anthropic`) are TypeScript import paths, not npm install targets.  
Correct: `npm install @robota-sdk/agent-provider`

### B3 — `OpenAPITool.execute()` throws unconditionally (code change)

**File:** `packages/agent-tools/src/implementations/openapi-tool.ts:171`  
`createOpenAPITool` is fully exported from `@robota-sdk/agent-tools`. Calling `.execute()` on any operation throws `Error('Not implemented')`. This is a shipped public stub.  
**Fix:** Remove from public exports and add `@internal` annotation, or implement it.

### B4 — `--system-prompt` CLI flag is documented but silently ignored (code or doc fix)

**Files:** `content/guide/cli.md:28`, `packages/agent-cli/src/modes/print-mode.ts:42`  
The flag is documented as functional. At runtime it prints a stderr warning and does nothing.  
**Fix:** Either wire it to `IInteractiveSessionStandardOptions.systemPrompt`, or remove it from the docs and help text.

### B5 — CONTRIBUTING.md has entirely wrong package paths (5-min doc fix)

**File:** `CONTRIBUTING.md` (project structure section)  
Lists `packages/core`, `packages/openai`, `packages/anthropic`, `packages/tools` — none exist.  
Actual paths: `packages/agent-core`, `packages/agent-provider`, `packages/agent-tools`.  
This is the highest-visibility trust signal for open-source health. Every potential contributor sees this first.

### B6 — No beta disclaimer on the docs homepage (5-min doc fix)

**File:** `content/README.md`  
The docs homepage presents Robota as production-ready. The npm badge shows `3.0.0-beta.67` but reads "latest," which most developers won't parse as "beta."  
Copy the callout block already used in `content/getting-started/README.md`.  
Also add to root `README.md`.

### B7 — Publish registry stale — release workflow would over-publish (audit + fix)

**Files:** `.agents/publish-registry.md`, `.github/workflows/release.yml`  
The registry describes the old split-provider architecture (non-existent packages).  
`pnpm -r publish` in the release workflow would publish 16 packages that should be `private: true` (e.g., `agent-web-ui`, `agent-interface-tui`, `plugin-github`, `agent-executor`).  
Must audit which packages are intentionally public before next release.

---

## High Priority (fix before soft launch announcement)

### H1 — Broken links from docs homepage

**File:** `content/README.md`  
Links to `./showcase/`, `./roadmap.md`, `/compare/` lead to dead ends on the VitePress docs site (they exist in `apps/www`, not `content/`). Remove or redirect.

### H2 — Internal ticket reference leaked into public docs

**File:** `content/guide/embedding.md`  
Contains `"After CORE-002, additionalTools is available on createSession"` — an internal backlog reference that means nothing to external developers. Remove this line.

### H3 — `agent-framework/README.md` references non-existent packages

**File:** `packages/agent-framework/README.md` lines 5, 69–85  
Architecture section references `agent-sessions`, `agent-provider-anthropic` (neither exists).  
Correct: `agent-session`, `agent-provider`.

### H4 — CODEOWNERS stale paths

**File:** `.github/CODEOWNERS`  
References `packages/agents/`, `packages/core/`, `apps/web/` — none exist.  
PRs to actual packages get no automatic reviewer assignment.

---

## Medium Priority (fix before stable/1.0 release)

### M1 — No 3.0.0 migration guide

`CHANGELOG.md` documents 20+ breaking changes (type renames, class renames, removed packages). No `content/guide/migration.md` exists. Any developer upgrading from 2.x is stranded.

### M2 — No providers reference page

No single page listing all supported providers, their import paths, configuration options, and supported model names. Referenced from `content/quickstart.md` (`/guide/providers`) but doesn't exist.

### M3 — Missing demo GIF

**File:** `packages/agent-cli/README.md` → `./docs/demo.gif` is a 1×1 pixel placeholder (41 bytes).  
For a CLI product, a compelling terminal demo recording is the highest-value marketing asset.

### M4 — Zero npm keywords on consumer-facing packages

`@robota-sdk/agent-cli` and `@robota-sdk/agent-framework` have zero npm keywords.  
`@robota-sdk/agent-core` has 27 keywords. The packages a developer actually installs are invisible to npm search for "ai coding assistant" or "agent sdk typescript."

### M5 — `RateLimitError` not thrown by Anthropic/OpenAI providers

The `RateLimitError` class is exported from `agent-core` but Anthropic and OpenAI providers do not catch HTTP 429 and rethrow as `new RateLimitError(...)`. Only the Bytedance HTTP client maps it. Developers who write `catch (e) { if (e instanceof RateLimitError) ... }` for Anthropic calls will never catch anything.

### M6 — No exported `TQueryFunction` type alias

`createQuery()` returns `(prompt: string) => Promise<string>`. External consumers cannot annotate their own code with the return type.

### M7 — `MarketplaceClient` URL source throws without type narrowing

`createOpenAPITool` URL source type throws unconditionally. Type should be narrowed to exclude `'url'` until implemented, preventing TypeScript callers from ever passing it.

### M8 — GitHub Action documented but repo doesn't exist

**File:** `content/integrations/github-action.md`  
Documents `robota-sdk/action@v1` GitHub Action. The repo returns 404. Either create the Action or remove the integration guide.

---

## Low Priority (post-soft-launch improvements)

| ID  | Issue                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- |
| L1  | No community channel (Discord/GitHub Discussions) linked from any entry point                                 |
| L2  | No error handling guide (what `AuthenticationError`, `RateLimitError` etc. mean)                              |
| L3  | Provider TUI config shows "Gemma / LM Studio" — confusing (should be "OpenAI-compatible local server")        |
| L4  | "Claude Code BYOK = ❌" in comparison table may be outdated — Claude Code now supports API keys               |
| L5  | No showcase / social proof — `./showcase/` link dead                                                          |
| L6  | `apps/starter-nextjs` only accessible by cloning full monorepo — needs standalone repo or `create-robota-app` |
| L7  | `peerDependencies` gaps — `agent-core` not declared as peer dep in `agent-framework` and `agent-provider`     |

---

## What Is Genuinely Strong

The following are production-grade and should be highlighted in launch messaging:

- **Embedding story**: `content/guide/embedding.md` covers 7 distinct deployment patterns with realistic working code. This is best-in-class documentation.
- **Local model support**: `content/guide/local-llm.md` is comprehensive, with a model recommendation table and real troubleshooting notes. Genuine competitive differentiator.
- **Examples directory**: 9 complete, runnable examples (Slack, Discord, Telegram, batch processor, GitHub PR reviewer, WebSocket, Next.js, Express, CLI). Realistic and directly adoptable.
- **Test coverage**: 3,971 tests across 340+ files, zero skips, 80% line coverage gate enforced. Excellent for a pre-1.0 SDK.
- **Multi-provider UX**: Provider switching with zero code change beyond swapping one class is genuinely differentiated. No other tool in the comparison set offers this + local models.
- **"Claude Code compatible" positioning**: Reading `.claude/settings.json` and `CLAUDE.md` is a strong acquisition hook for the most likely early adopters.

---

## Launch Readiness Gates

### Soft Launch Gate (target: fix all B items + H items)

| Gate | Item                                                   | Status |
| ---- | ------------------------------------------------------ | ------ |
| B1   | Fix `query` → `createQuery` in README.md               | ❌     |
| B2   | Fix npm install command in getting-started             | ❌     |
| B3   | Remove/implement OpenAPITool                           | ❌     |
| B4   | Wire or remove `--system-prompt` flag                  | ❌     |
| B5   | Update CONTRIBUTING.md package paths                   | ❌     |
| B6   | Add beta disclaimer to docs homepage + root README     | ❌     |
| B7   | Audit publish registry, set private packages correctly | ❌     |
| H1   | Fix broken links in content/README.md                  | ❌     |
| H2   | Remove CORE-002 reference from embedding.md            | ❌     |
| H3   | Update agent-framework README architecture section     | ❌     |
| H4   | Fix CODEOWNERS stale paths                             | ❌     |

### Stable Launch Gate (before 1.0.0 release)

All soft launch gates + M1–M8 resolved.

---

## Recommended Release Sequence

1. **This week**: Fix B1–B7, H1–H4 (all are text/doc fixes + 2 code changes for B3/B4)
2. **Before announcement**: Record demo GIF (M3), add npm keywords (M4)
3. **Beta.68**: Fix M1–M8 code issues (RateLimitError mapping, TQueryFunction export, etc.)
4. **Stable**: Migration guide (M1), providers reference page (M2), community setup (L1)
