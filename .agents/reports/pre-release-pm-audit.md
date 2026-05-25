# Pre-Release Developer Experience Audit — Robota SDK

**Date:** 2026-05-25  
**Version audited:** 3.0.0-beta.67  
**Auditor role:** Product Manager, first-time developer perspective

---

## 1. Executive Summary

A motivated developer can install the CLI and get a response in under 5 minutes, and the core SDK embedding story is genuinely strong. However, three problems would block broad adoption today: **(1) The homepage never tells a new visitor this is beta software**, leaving them to discover API instability only after they've invested time; **(2) the CONTRIBUTING.md has completely stale package paths** (referencing `packages/core`, `packages/openai`, `packages/anthropic` that no longer exist), signaling to potential contributors that the project is poorly maintained; **(3) multiple broken links in the docs** — `/guide/providers`, `/compare/`, `./showcase/`, `./roadmap.md` — are referenced from prominent pages but either lead to pages that don't exist in the `content/` layer or to a separate Next.js app, creating dead-end navigation for users on the VitePress docs site. These three issues create immediate trust damage that outweighs the genuinely excellent SDK and documentation work.

---

## 2. First Impressions

### Root README.md

**Rating: Good.** The root `README.md` is concise and leads with the `npx` oneliner. The three-layer architecture diagram (CLI → SDK → Core) gives developers a mental model immediately. The packages table with npm links is useful.

**Problems:**

- No mention of beta status anywhere on the page.
- The architecture diagram at the top references `agent-framework` but the Quick Start shows `@robota-sdk/agent-provider/anthropic` sub-path imports — a reader has to mentally reconcile this.

### content/README.md (docs homepage)

**Rating: Strong concept, execution gaps.** The value proposition — "The open-source alternative to Claude Code" — is defensible and lands in the first line. The comparison table is the strongest asset on the page: it is specific, uses real competitor names, and acknowledges cases where competitors are equal or better. The three CTAs (CLI install, first agent, playground) are well-structured.

**Problems:**

- **No beta disclaimer anywhere on the homepage.** The npm badge will show `3.0.0-beta.67` but it is labeled `npm` not `beta`, so a casual reader will not register this is pre-release software. The only beta notice in the docs is on `content/getting-started/README.md`, one click away.
- The homepage links to `./showcase/`, `./roadmap.md`, and `/compare/` — none of which exist as files in the `content/` directory. They resolve in the separate `apps/www` Next.js marketing site, not in the VitePress docs. A user following these links from `robota.io/docs` will get 404s.
- The `createQuery` function shown in the Framework Quick Start example uses a different API form from the one in `content/quickstart.md` (`createAgentRuntime` + `createSession` vs `createQuery`). Both are correct but the inconsistency confuses first-time readers.

### CONTRIBUTING.md

**Rating: Broken.** The project structure section lists `packages/core`, `packages/openai`, `packages/anthropic`, and `packages/tools` — none of which exist. The actual packages are `packages/agent-core`, `packages/agent-provider`, `packages/agent-tools`, etc. Any developer who reads CONTRIBUTING.md before cloning will get confused before writing a single line of code.

### .github/ Community Files

- Bug report template: well structured — asks for OS, Node version, Robota version, provider. Good.
- Feature request template: minimal but functional.
- PR template: solid — checklist includes `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- CODEOWNERS: stale. References `packages/agents/` and `packages/core/` (both non-existent) and `apps/web/` (the directory is `apps/www/`).
- No Discord, Slack, or community forum link anywhere in root README, CONTRIBUTING.md, or docs homepage. There is no support channel visible to a new contributor.

---

## 3. Onboarding Funnel

### CLI Path (Target: 2 minutes)

The CLI install path is clean:

```bash
npx @robota-sdk/agent-cli   # works
npm install -g @robota-sdk/agent-cli && robota  # works
```

The `bin` field in `packages/agent-cli/package.json` correctly points to `./bin/robota.cjs`, which exists. The `npx` path is functional.

**Friction points:**

- The `packages/agent-cli/README.md` includes `![Demo](./docs/demo.gif)` but `docs/demo.gif` is a 1×1 pixel placeholder (41 bytes). Any developer who views the README on GitHub before installing sees a broken image where a compelling demo GIF should be.
- Node.js 22 requirement is stated clearly and the troubleshooting note about Korean IME + macOS Terminal is a genuine courtesy (clearly experienced in production).
- First-run interactive configuration is mentioned but not shown. A short "what to expect on first run" screenshot or text walkthrough is missing.

### SDK Embedding Path (Target: 10 minutes)

The `content/getting-started/README.md` has a well-structured five-step progression: simple agent → add tools → switch providers → InteractiveSession → CLI. The path is realistic and the code examples are self-contained.

**Friction points:**

- Step 2 installation: `npm install @robota-sdk/agent-core @robota-sdk/agent-provider/anthropic @anthropic-ai/sdk` — this is wrong. You cannot install a sub-path (`/anthropic`) as a separate npm package. The correct install is `npm install @robota-sdk/agent-provider`, and then you use the sub-path import in TypeScript. This will cause a confusing `npm ERR!` for a first-time user.
- `content/quickstart.md` uses `createAnthropicProvider` from `@robota-sdk/agent-provider` (root), while `content/README.md` and `content/getting-started/README.md` use `AnthropicProvider` from `@robota-sdk/agent-provider/anthropic`. Both forms work (the root re-exports via `export *`), but a developer copy-pasting from different pages will get inconsistent imports that look like a version discrepancy.
- `content/quickstart.md` references `apps/starter-nextjs` and instructs users to `git clone` the entire monorepo just to run the starter. The starter (`apps/starter-nextjs`) does exist and works, but cloning a large monorepo to try a starter template is poor DX. The starter should be a separate repository or a `create-robota-app` scaffolding command.

### No API Key Path (Local Model)

**Rating: Excellent.** The local LLM guide (`content/guide/local-llm.md`) is one of the best pieces of documentation in the project. It covers Ollama, LM Studio, and llama.cpp with concrete commands, a model recommendation table with real size/quality tradeoffs, and realistic troubleshooting notes. The "no API key required" positioning is surfaced on the homepage and getting-started page. This is a genuine competitive differentiator executed well.

---

## 4. Documentation Coverage

### What Exists

| Area                 | File                                                 | Quality                                            |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Getting Started      | `content/getting-started/README.md`                  | Good — clear paths, but install command error      |
| Architecture         | `content/guide/architecture.md`                      | Good — Mermaid diagram is accurate                 |
| Building Agents      | `content/guide/building-agents.md`                   | Good — config table with types is useful           |
| SDK Usage            | `content/guide/sdk.md`                               | Good — event table is valuable                     |
| Embedding            | `content/guide/embedding.md`                         | Excellent — realistic patterns, lifecycle guidance |
| CLI Reference        | `content/guide/cli.md`                               | Good — full flag table                             |
| Local LLM            | `content/guide/local-llm.md`                         | Excellent — best guide in the project              |
| Permissions & Hooks  | `content/guide/permissions-and-hooks.md`             | Present                                            |
| Context Management   | `content/guide/context-management.md`                | Present                                            |
| Plugins              | `content/guide/plugins.md`                           | Present                                            |
| Changelog            | `content/changelog/README.md`                        | Present — 3 entries covering recent betas          |
| API Reference        | `content/api-reference/agent-core/` and `agent-cli/` | Auto-generated, extensive                          |
| Examples (code docs) | `content/examples/` — 12 files                       | Mostly good                                        |
| Real code examples   | `examples/` — 9 directories                          | High quality, complete implementations             |

### What Is Missing

- **`/guide/providers`** — referenced in `content/quickstart.md` as "configure multi-provider setups" but does not exist in `content/guide/`.
- **`/guide/permissions`** — referenced in `content/quickstart.md` but the file is `permissions-and-hooks.md` (wrong link).
- **Migration guide** — CHANGELOG.md documents a massive 3.0.0 breaking change (type renames, class renames, removed packages). There is no `content/guide/migration.md` for users upgrading from v2. The only migration content is at `content/v2.0.0/development/migration-from-core-tools.md`, which is the v2-era internal guide.
- **Providers reference page** — there is no single page listing all providers with their configuration options, supported models, and known limitations.
- **Error handling guide** — no public-facing error taxonomy. The internal v2 development guide exists at `content/v2.0.0/development/error-handling-guidelines.md` but nothing in the current docs.
- **`/compare/`, `./showcase/`, `./roadmap.md`** — linked from the docs homepage but not in the `content/` docs layer.
- **Community/support page** — no Discord, forum, or community link anywhere.

**Documentation Coverage Score: 6.5/10**

The quality of what exists is genuinely good — the embedding guide in particular is production-grade. But the broken links, missing provider reference, and absent migration guide are gaps a developer would hit in the first 30 minutes.

---

## 5. SDK Embedding Experience

**Rating: Strong — this is the project's primary differentiator.**

The `content/guide/embedding.md` is the best documentation page in the repository. It identifies seven distinct use-case patterns (single-shot, streaming server, custom tools, bot with memory, serverless, batch, structured output) and provides a working code example for each. The lifecycle table (when to create/reuse/shutdown sessions) is exactly what a backend developer needs.

The `examples/` directory has nine complete, independently-runnable examples:

- `slack-bot/` — full Socket Mode setup with per-thread session resume
- `nextjs/` — SSE streaming in App Router
- `express/` — tool use with SSE
- `batch-processor/` — `p-limit` concurrency control
- `telegram-bot/`, `discord-bot/`, `github-pr-reviewer/`, `websocket-chat/`, `cli/`

These are realistic, well-scoped, and directly address the target personas (Slack bots, CI scripts, batch processors). The `batch-processor` and `github-pr-reviewer` examples are directly relevant to the "embed in your own app" audience.

**Gaps:**

- `content/guide/embedding.md` contains a comment `After CORE-002, additionalTools is available on createSession` — this is an internal ticket reference that leaked into the public documentation. It means nothing to a third-party developer.
- The `createStatelessRuntime` function shown in the serverless example needs verification — it is documented in `embedding.md` but not listed in the `agent-framework` README's feature set.
- `apps/starter-nextjs` exists and is functional but is only accessible by cloning the full monorepo. It should be a `create-robota-app` template or a standalone repo with a "Deploy with Vercel" button (which it has, but the Vercel deploy points to the monorepo path).

---

## 6. Multi-Provider Experience

**Rating: Good documentation, minor config UX concern.**

The comparison table on the homepage and the getting-started guide both clearly demonstrate provider switching with zero code changes beyond swapping the provider instance. The `agent.setModel()` mid-conversation example in `content/README.md` is the right "aha moment" for this feature.

**Ollama/LM Studio:** Covered in excellent detail in `content/guide/local-llm.md`. The recommendation table (model size vs. use case) is genuinely useful.

**Gaps and Concerns:**

- The provider configuration UI (`robota --configure`) routes local model users to select "Gemma / LM Studio" — this is confusing. Ollama is not Gemma, and LM Studio supports many model families. The provider option name in the TUI should reflect the underlying protocol ("OpenAI-compatible local server") rather than a specific model family name.
- There is no `content/guide/providers.md` page that lists all supported providers, their import paths, required peer dependencies, and supported model names. A developer adding DeepSeek or Qwen must discover this from the package-level README or the architecture guide.
- The root `README.md` packages table lists `@robota-sdk/agent-provider` as a "Consolidated AI providers (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance)" — Gemma and ByteDance are likely unfamiliar to most Western developers and the table gives no guidance on when to choose each.

---

## 7. Beta Communication

**Rating: Inconsistent — not communicated where it matters most.**

| Location                            | Beta Notice?                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `content/README.md` (docs homepage) | No — npm badge shows version but no explicit "beta" callout                   |
| Root `README.md`                    | No                                                                            |
| `content/getting-started/README.md` | Yes — prominent callout block at the top                                      |
| `packages/agent-cli/README.md`      | Yes — prominent callout block                                                 |
| `content/changelog/README.md`       | Implied by version numbers                                                    |
| npm package page (agent-cli)        | `dist-tags.latest` = `3.0.0-beta.67` — visible but requires reading carefully |

The most-visited pages (docs homepage, root README) do not say this is beta software. The npm badge shows the version string `3.0.0-beta.67` but if a developer glances quickly at the shield they read "latest" and proceed. Given the significant breaking changes between 2.x and 3.0 (documented in `CHANGELOG.md`) and the explicit 3.0.0-beta versioning, a first-time user who installs and builds without noticing the beta label may face unexpected churn.

There is no `BREAKING_CHANGES.md` or version migration guide linked from either README. The root `CHANGELOG.md` has a comprehensive breaking changes section for 3.0.0 but it is not linked from any getting-started path.

**The `dist-tags.latest` = beta issue:** Having `latest` point to a beta tag (`3.0.0-beta.67`) means `npm install @robota-sdk/agent-cli` (without `@beta`) installs the beta. This is an intentional choice but should be clearly disclosed on the homepage.

---

## 8. Competitive Positioning

### Strengths

The comparison table in `content/README.md` and the dedicated compare page in `apps/www` are honest and well-structured. The project correctly identifies that "Embeddable SDK" is its unique differentiator — no other tool in the comparison table offers this. Claude Code, Cursor, and Cline are closed products; Aider is Python-only. The embeddable SDK niche is defensible and real.

The local model angle is legitimately differentiated. The documentation treats it as a first-class feature with a dedicated guide, not an afterthought.

The "Claude Code compatible" positioning (reads `.claude/settings.json`, `CLAUDE.md`, `AGENTS.md`) is a strong acquisition hook for the most likely early adopters — developers who already use Claude Code and want provider flexibility.

### Weaknesses and Risks

- **"Claude Code alternative" framing has a trust problem at beta.67.** Claude Code is a polished, daily-driver tool. Positioning Robota as a drop-in alternative while still in beta creates a gap between expectation and experience. The messaging should be "extends Claude Code" or "runs alongside Claude Code" rather than "alternative."
- **The comparison table marks Claude Code as `❌` for BYOK.** This was accurate at some point but Claude Code now supports API key usage without a subscription. This should be verified and corrected if inaccurate, as incorrect claims erode trust.
- **No performance benchmarks.** "TypeScript-native, strict types" is not a differentiated capability. Aider and Cline both support TypeScript. The comparison table does not address response quality, latency, or reliability — metrics a developer would actually care about.
- **No showcase yet.** The `content/README.md` links to `./showcase/` and the compare page has a "try Robota now" CTA, but there are zero publicly listed projects built with Robota. Social proof is absent.

---

## 9. Missing for Production: Top 10 Gaps by Impact

### P0 — Blocks first-day use

1. **Broken install instruction** (`content/getting-started/README.md`): `npm install @robota-sdk/agent-core @robota-sdk/agent-provider/anthropic` is not valid npm syntax. Sub-paths cannot be npm install targets. This is the first code block a new SDK developer copies. It will fail.

2. **CONTRIBUTING.md has entirely wrong package paths.** Every contributor who opens this file first sees `packages/core`, `packages/openai`, `packages/anthropic` — none of which exist. This is the highest-visibility trust signal for "is this project maintained?"

### P1 — Blocks sustained use or adoption

3. **No migration guide for 3.0.0.** The `CHANGELOG.md` documents 20+ breaking type renames, class renames, and removed packages. Any developer upgrading from 2.x has no documented path. Given the project is still pre-1.0 with active churn, this will hit early adopters repeatedly.

4. **No beta disclaimer on the docs homepage.** `content/README.md` presents Robota as production-ready. A developer who installs it, builds on it, and then hits an API break in beta.68 will feel misled. A single banner or badge is needed.

5. **Broken links from the docs homepage.** `/compare/`, `./showcase/`, `./roadmap.md` are linked from `content/README.md` but don't exist as docs content. A developer exploring the site hits dead ends immediately.

6. **Internal ticket reference in public docs.** `content/guide/embedding.md` contains "After CORE-002, `additionalTools` is available." This is an internal backlog reference that means nothing to external developers and signals the docs are working notes, not finished documentation.

### P2 — Blocks confident production deployment

7. **No providers reference page.** There is no single place listing all providers, their install commands, configuration options, supported model names, and known limitations. A developer using DeepSeek or Qwen must piece this together from scattered sources.

8. **Missing demo GIF.** `packages/agent-cli/docs/demo.gif` is a 1×1 pixel placeholder. The GitHub README shows a broken image. For a CLI product, a compelling terminal demo recording is the single highest-value marketing asset. Its absence is conspicuous.

9. **No keywords on `@robota-sdk/agent-cli` or `@robota-sdk/agent-framework` npm packages.** `agent-cli` has zero keywords and `agent-framework` has zero keywords. These packages are invisible to developers searching npm for "ai coding assistant" or "agent sdk typescript." `agent-core` has 27 keywords; the consumer-facing packages have none.

10. **CODEOWNERS is stale.** References `packages/agents/`, `packages/core/`, `apps/web/` — none of which exist. This means PRs to the actual packages will not automatically request review from the right owner. For an open-source project inviting contributions, this is a meaningful operational gap.

### P3 — Limits long-term growth

- No community channel (Discord, GitHub Discussions) linked from any entry point.
- The `robota-sdk/action` GitHub Action is documented in `content/integrations/github-action.md` but the repository (`github.com/robota-sdk/action`) returns 404. The integration guide documents a product that does not exist yet.
- No error handling guide. The `AuthenticationError`, `ConfigurationError`, and other error classes are documented via auto-generated API reference but there is no guide explaining what each error means and how to handle it.

---

## 10. Verdict

**SOFT LAUNCH READY** — with blocking fixes required first.

The technical foundation is production-grade. The embedding story, local model support, and multi-provider architecture are genuinely differentiated and well-implemented. The `examples/` directory is impressive and realistic. The SDK itself is ready for motivated early adopters who are comfortable with beta software.

**However, before any public announcement or wider promotion, the following three items must be fixed:**

1. **Fix the invalid install command** in `content/getting-started/README.md` — change `npm install @robota-sdk/agent-provider/anthropic` to `npm install @robota-sdk/agent-provider`. This is the first code block a new developer copies and it will produce an npm error.

2. **Add a beta disclaimer to the docs homepage** (`content/README.md`) — one callout block at the top is sufficient. Copy the pattern already used in `content/getting-started/README.md`.

3. **Update CONTRIBUTING.md** to reflect the real package structure (`packages/agent-core`, `packages/agent-provider`, etc.). This is the highest-visibility trust signal for open-source health.

After these three fixes, the project is ready for a soft launch targeting: (a) Claude Code users who want multi-provider support, and (b) TypeScript developers who want to embed an agent runtime in their own app. The documentation, examples, and SDK API are all strong enough to support these two personas today.

**Not ready for broad public launch until:** (1) The demo GIF is recorded, (2) npm keywords are added to `agent-cli` and `agent-framework`, (3) a migration guide for 3.0.0 is written, and (4) the broken doc links are resolved.
