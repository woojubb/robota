# Pre-Release Developer Readiness Audit

**Date:** 2026-05-25  
**Version audited:** 3.0.0-beta.67  
**Branch:** develop  
**Auditor:** Claude Code (automated)

---

## 1. Executive Summary

The SDK is **NOT READY** for general external adoption in its current state. Core mechanics work — build passes, all ~3,971 tests pass, typecheck is clean, and the primary `createQuery` / `InteractiveSession` / `AnthropicProvider` flow is correct. However, three blockers exist: (1) `OpenAPITool` is publicly exported from `@robota-sdk/agent-tools` and throws `Error('Not implemented')` when called; (2) `--system-prompt` CLI flag is documented and wired but silently ignored at runtime; (3) the root `README.md` and the Getting Started docs contain a wrong import (`query` instead of `createQuery`) that will cause the first `import` a new developer tries to fail with a module-not-found error.

---

## 2. Build & Package Status

### 2a. Per-package table (published packages only)

| Package                                         | Version       | Build artifacts                            | Types                  | Exports correct    |
| ----------------------------------------------- | ------------- | ------------------------------------------ | ---------------------- | ------------------ |
| `@robota-sdk/agent-core`                        | 3.0.0-beta.67 | `dist/node/`, `dist/browser/`              | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-framework`                   | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-provider`                    | 3.0.0-beta.67 | `dist/node/` + per-provider sub-dirs       | per-path `.d.ts`       | Yes (10 sub-paths) |
| `@robota-sdk/agent-tools`                       | 3.0.0-beta.67 | `dist/node/`, `dist/browser/`              | `dist/node/index.d.ts` | Yes — but see §4   |
| `@robota-sdk/agent-session`                     | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-cli`                         | 3.0.0-beta.67 | `dist/node/`, `bin/`                       | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-executor`                    | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-command`                     | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-interface-transport`         | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-interface-tui`               | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-plugin`                      | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-subagent-runner`             | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-transport`                   | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/agent-web-ui`                      | 3.0.0-beta.67 | `dist/node/`, `dist/browser/`, `dist/spa/` | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/plugin-github`                     | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |
| `@robota-sdk/plugin-{jira,linear,notion,slack}` | 3.0.0-beta.67 | `dist/node/`                               | `dist/node/index.d.ts` | Yes                |

- `pnpm typecheck` — **PASS** (zero errors across all packages and apps)
- `pnpm build` — **PASS** (clean)

### 2b. Publish-registry is significantly stale

`.agents/publish-registry.md` was written for the old split-provider architecture (`agent-provider-anthropic`, `agent-provider-openai`, etc., `agent-runtime`, `agent-sessions`, `agent-sdk`). None of those package directories exist. The actual published landscape is the consolidated monorepo listed above.

The registry also says packages like `agent-plugin`, `agent-executor`, `agent-interface-transport`, `agent-interface-tui`, `agent-subagent-runner`, `agent-transport`, `agent-web-ui`, and the `plugin-*` group should be `private: true`. They are not — they have `"private": null` (which pnpm treats as publishable). The `pnpm -r publish` command in `.github/workflows/release.yml` would publish all of them on the next release.

Packages confirmed private (will be skipped): `agent-playground`, `agent-remote-client`, `agent-tool-mcp`.

### 2c. Dependency bundling

`@robota-sdk/agent-provider` lists `@anthropic-ai/sdk`, `openai`, and `@google/genai` as direct `dependencies` (not `peerDependencies`). npm will install them transitively when a developer installs `agent-provider`. No `bundledDependencies` are declared, so the dist does not inline them — they travel as regular transitive deps. This is correct behavior.

---

## 3. Test Coverage

**All tests pass. Zero skipped or `.only` patterns found.**

| Package                 | Test files     | Tests                              |
| ----------------------- | -------------- | ---------------------------------- |
| `agent-core`            | 46             | (vitest — counted in approx total) |
| `agent-framework`       | 82             | (vitest)                           |
| `agent-provider`        | 42             | (vitest)                           |
| `agent-transport`       | 48             | (vitest)                           |
| `agent-playground`      | 32             | (vitest)                           |
| `agent-plugin`          | 17             | (vitest)                           |
| `agent-command`         | 22             | (vitest)                           |
| `agent-executor`        | 9              | (vitest)                           |
| `agent-session`         | 10             | (vitest)                           |
| `agent-tools`           | 10             | (vitest)                           |
| `agent-remote-client`   | 7              | (vitest)                           |
| `agent-subagent-runner` | 1              | (vitest)                           |
| `agent-cli`             | 5              | (vitest)                           |
| `apps/agent-web`        | 1              | (jest, 8 tests)                    |
| `apps/action`           | 1              | (vitest)                           |
| `plugin-*`              | 5 × 1          | (vitest)                           |
| **Approximate total**   | **~340 files** | **~3,971 tests**                   |

CI runs tests on PRs targeting both `develop` and `main`. Coverage threshold: 80% line coverage enforced on all packages except `agent-cli`.

---

## 4. Public API Gaps

### BLOCKER — `OpenAPITool.execute()` throws at runtime

**File:** `packages/agent-tools/src/implementations/openapi-tool.ts:171`  
**Export path:** `@robota-sdk/agent-tools` → `createOpenAPITool` (line 40 of index.ts)

```
throw new Error('Not implemented: actual API execution is not yet available');
```

`OpenAPITool` is fully exported, fully typed, and the constructor accepts a valid OpenAPI spec. Calling `tool.execute()` on any operation throws unconditionally. Any developer who imports `createOpenAPITool` and calls it will get a runtime crash. This is a shipped public API stub.

### BLOCKER — Root README imports `query` which does not exist

**File:** `README.md:25`

```typescript
import { query } from '@robota-sdk/agent-framework';
```

The actual export name is `createQuery`. `query` does not exist as a named export. This will produce a `TypeError: query is not a function` (or a module import error in strict ESM) on the first code sample a developer copies from the README.

### Non-breaking — `MarketplaceClient` URL source throws

**File:** `packages/agent-framework/src/plugins/marketplace-client.ts:271`

```
throw new Error('URL marketplace source is not yet supported');
```

`MarketplaceClient` is exported from `agent-framework` (line 365 of index.ts). The `url` source type throws. The `git` and `local` types work. Since this is an advanced feature and the error message is descriptive, this is non-blocking but should be documented or type-narrowed.

### Minor — `createQuery` return type

`createQuery()` returns `(prompt: string) => Promise<string>`. This is a plain function type, not a named interface. The return value is `result.response` from `IExecutionResult`. This is correct but the type is anonymous — external developers cannot reference it in their own code. Consider exporting a `TQueryFunction` type alias.

---

## 5. Error Handling

**Overall: adequate for standard paths; gaps in edge cases.**

### Strengths

- All providers validate API key at construction: `throw new Error('Either Anthropic client, apiKey, or executor is required')` — consistent pattern across Anthropic, OpenAI, DeepSeek, Gemini, Gemma, Qwen providers.
- `RateLimitError`, `AuthenticationError`, `ProviderError`, `NetworkError`, `ToolExecutionError`, `ModelNotAvailableError` are all defined in `packages/agent-core/src/utils/errors.ts` and exported through `export * from './utils'` in `packages/agent-core/src/index.ts`. External consumers can `instanceof`-check them.
- `InteractiveSession` emits `'error'` events, so unhandled provider errors surface to the consumer rather than crashing silently.
- `maxSameToolInputs` is fully wired: defined in `IAgentConfig`, forwarded through `execution-round.ts:261`, checked in `execution-round-tools.ts:36`.
- `responseFormat` is fully wired: `IResponseFormatConfig` in `interfaces/agent.ts:257`, passed to provider in both `execution-stream.ts:121` and `execution-round-provider.ts:59`.

### Gaps

- **Rate limit errors from Anthropic/OpenAI are not mapped to `RateLimitError`**. `message-helpers.ts:198` detects rate limit by string matching (`error.message.includes('rate limit')`) but only for a specific internal path. Anthropic provider does not `catch` HTTP 429 and rethrow as `new RateLimitError(...)` — it passes the raw SDK error through. External developers catching `RateLimitError` will miss Anthropic 429s.
- **`InteractiveSession` submit error path**: errors from `session.submit()` caught at `interactive-session.ts:400` emit `'error'` with a raw `Error` object. If the consumer calls `session.submit()` without listening for `'error'`, Node.js will throw an unhandled event emitter error. This is documented behavior for Node EventEmitter but is a DX footgun worth noting in docs.

---

## 6. Documentation

### Root README — Issues

| Issue                                                                                                           | Severity    | Location          |
| --------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- |
| `import { query }` — non-existent export                                                                        | **BLOCKER** | `README.md:25`    |
| Architecture diagram lists `agent-sdk`, `agent-sessions`, `agent-providers` — none of these package names exist | High        | `README.md:54-58` |
| Packages table is accurate (uses real package names)                                                            | OK          | `README.md:71`    |

### `packages/agent-framework/README.md` — Issues

Assembly layer description at line 5 says it "composes `agent-core`, `agent-tools`, `agent-sessions`, `agent-provider-anthropic`". Neither `agent-sessions` nor `agent-provider-anthropic` exist as package names. This text was not updated when the architecture consolidated.

The architecture diagram at lines 69–85 also references `agent-sessions` and `agent-provider-anthropic`.

### `content/getting-started/README.md` — Issues

Installation instructions at lines 58 and 64:

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider/anthropic @anthropic-ai/sdk
```

`@robota-sdk/agent-provider/anthropic` is a **package sub-path export**, not a separate npm package. You cannot `npm install` a sub-path. The correct command is:

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider
```

(`@anthropic-ai/sdk` is a direct dependency of `agent-provider` and will be installed transitively — the developer does not need to install it separately unless they import Anthropic SDK types directly.)

### `content/guide/cli.md` — `--system-prompt` documented as functional

`cli.md:28` documents `--system-prompt <text>` as "Override the system prompt for this session". In reality, `packages/agent-cli/src/modes/print-mode.ts:42–44` explicitly warns at runtime that this flag is **not yet functional**:

```typescript
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
if (args.systemPrompt) {
  process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
}
```

Any developer who relies on `--system-prompt` for prompt isolation will have silent failures.

### `content/getting-started/README.md` — Exists and is usable

The file exists (`content/getting-started/README.md`), is well-structured, and provides CLI, SDK, and "no API key" paths. Quality is good.

### `content/guide/embedding.md` — Complete and accurate

Uses `createQuery` correctly throughout. Examples are accurate against the current API. The API selection table is comprehensive.

### `content/examples/` — Generally accurate

Spot-checked: `one-shot-query.md` and `streaming.md` both use the correct APIs (`createQuery`, `InteractiveSession`, `session.on('text_delta', ...)`). The `streaming.md` example with `provider.onTextDelta =` is valid — `AnthropicProvider` exposes this property.

---

## 7. Breaking Issues (First-Integration Failures)

These are issues a developer will hit within the first 30 minutes of following the documentation.

1. **`import { query }` in root README fails** (`README.md:25`) — The named export is `createQuery`, not `query`. A developer who copies the Quick Start snippet gets an immediate import/runtime error.

2. **`npm install @robota-sdk/agent-provider/anthropic` fails** (`content/getting-started/README.md:58,64`) — Sub-path exports cannot be npm-installed as separate packages. This command fails or installs nothing useful. Correct: `npm install @robota-sdk/agent-provider`.

3. **`OpenAPITool` throws unconditionally** (`packages/agent-tools/src/implementations/openapi-tool.ts:171`) — A public API that is fully exported and documented but crashes on every real call.

4. **`--system-prompt` CLI flag is silently no-op** (`packages/agent-cli/src/modes/print-mode.ts:42`) — Documented in `cli.md` as if it works. At runtime, only a stderr warning is printed and the flag is ignored. A developer building a script that overrides the system prompt will get wrong behavior with no obvious explanation.

---

## 8. Non-Blocking Issues (Polish Items)

1. **`.agents/publish-registry.md` is stale** — Describes the old architecture (separate `agent-provider-*` packages, `agent-runtime`, `agent-sessions`, `agent-sdk`). None of these directories exist. The registry also lists `agent-plugin-* (11 pkgs)` but there is only one `agent-plugin`. This confusion could cause a mis-publish on next release since multiple packages that should be private (`agent-executor`, `agent-transport`, `agent-web-ui`, `plugin-*`, etc.) have `"private": null` and would all be published by `pnpm -r publish`.

2. **Release workflow would over-publish** (`.github/workflows/release.yml:43`) — `pnpm -r publish --access public --no-git-checks` publishes all 19 `private:null` packages. Many of these (e.g., `agent-web-ui`, `agent-interface-tui`, `plugin-github`) appear to be internal implementation packages or beta-only features. This likely reflects intentional design but the registry is inconsistent with the actual state.

3. **`MarketplaceClient` URL source throws** — Exported from `agent-framework`, URL-type plugin source is unimplemented. Error message is clear. Consider narrowing the type to exclude `'url'` until implemented.

4. **`RateLimitError` not thrown by Anthropic/OpenAI providers** — The error class exists and is exported, but the Anthropic and OpenAI providers do not catch HTTP 429 and remap to `new RateLimitError(...)`. Only the Bytedance HTTP client does (`bytedance/http-client.ts:139`). External consumers cannot reliably `instanceof` check rate limit errors for Anthropic or OpenAI.

5. **`createQuery` return type is anonymous** — No exported `TQueryFunction` type alias. External developers cannot annotate their own code.

6. **`agent-session` README constructor example omits `terminal`** — The example shows `{ tools, provider, systemMessage, terminal, permissions }` which is correct, but doesn't explain where to get an `ITerminalOutput` instance. This is a friction point for non-CLI consumers.

7. **`agent-framework/README.md` architecture section is stale** — References `agent-sessions` and `agent-provider-anthropic` (line 5, lines 69–85). Should reference `agent-session` and `agent-provider`.

8. **`content/quickstart.md`** uses `createAnthropicProvider` from `'@robota-sdk/agent-provider'` (root import, not sub-path). This is valid — the root re-exports everything from `anthropic/index.ts` via `export * from './anthropic/index.js'`. However, it's inconsistent with other docs that use the sub-path form. Not a bug but creates confusion.

9. **16 TODO comments in production source** — All in non-critical paths (performance tracking stubs, webhook transformer notes, schema caching note). None block core functionality. Highest-visibility: `agent-cli/src/modes/print-mode.ts:42` (the `--system-prompt` TODO, already listed as blocker above).

10. **No `peerDependencies` on `agent-core`, `agent-framework`, `agent-provider`** — These packages have bundled their deps as direct dependencies. For an SDK, this means users cannot control which version of `@anthropic-ai/sdk` or `openai` is installed — version conflicts are possible if users also directly import these SDKs. `agent-tools` correctly declares `agent-core` as a peerDependency; the others should follow this pattern for `agent-core`.

---

## 9. Verdict

**NOT READY** for public developer adoption.

### Gate criteria to reach NEEDS WORK → READY

| #   | Criterion                                                                                                        | Status |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| G1  | Fix `import { query }` → `import { createQuery }` in `README.md:25`                                              | FAIL   |
| G2  | Fix install instructions in `content/getting-started/README.md:58,64`                                            | FAIL   |
| G3  | Fix or hide `OpenAPITool`: either implement `execute()` or remove from public exports and add a deprecation note | FAIL   |
| G4  | Fix CLI `--system-prompt` flag: either wire it or remove it from `cli.md` docs and help text                     | FAIL   |
| G5  | Zero typecheck errors                                                                                            | PASS   |
| G6  | All tests pass                                                                                                   | PASS   |
| G7  | Build artifacts present for all published packages                                                               | PASS   |

Gates G1–G4 must all pass before this SDK is safe for an external developer to use without hitting a misleading error in the first session.
