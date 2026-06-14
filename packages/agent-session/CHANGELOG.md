# @robota-sdk/agent-session

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `IContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- DQ-AUDIT-006 — error/observability hygiene: replace raw `throw new Error()` on core-service and provider hot paths with typed `RobotaError` subclasses (`ConfigurationError`/`ValidationError`) so error-handling can branch on category/recoverable; surface fire-and-forget hook failures via `logger.warn` instead of silent `.catch(() => {})`; wire the error-handling plugin's `totalRetries`/`successfulRecoveries` stats to real counters.
- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The Robota agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `Robota.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked Robota).
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62

## 3.0.0-beta.61

### Minor Changes

- 18fcc5b: Add provider-neutral sandbox snapshot hydration for interactive sessions. Snapshot-capable sandbox clients now persist `sandboxSnapshotId` on shutdown and restore it before saved message replay on non-fork resume, while the E2B structural adapter supports both `createSnapshot()`-style checkpoints and pause/resume sandbox references.

### Patch Changes

- 1c0d44c: Align context usage estimation across session display, auto-compaction, and core hard-capacity guards so mid-window sessions do not block prematurely.
- 36eb7a9: Add provider-owned native replay payload hooks, replay validation coverage, and a session log validation command.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [d97bdf2]
  - @robota-sdk/agent-core@3.0.0-beta.61

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- b80e51e: Add SDK-owned automatic project memory capture, approval review, bounded retrieval, and session-log provenance.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.
- 26a1718: Preserve and render Edit tool diff metadata in persisted CLI tool summaries.
- Updated dependencies [16c3b6f]
- Updated dependencies [f61e2cb]
  - @robota-sdk/agent-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47

## 3.0.0-beta.46

### Minor Changes

- feat: session continue/resume — persist, restore, and switch sessions
  - ISessionRecord.history field (required) for UI timeline restoration
  - Session.injectMessage() for AI context restoration on resume
  - InteractiveSession: sessionStore, resumeSessionId, forkSession, getName/setName
  - CLI: --continue, --resume, --fork-session, --name flags
  - TUI: /resume (session picker), /rename (session naming)
  - ListPicker generic component with viewport scrolling
  - Session name display: input border title, terminal title, StatusBar
  - Session picker: cwd filtering, date+time, response preview
  - React key remount for instant session switching

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- feat: IHistoryEntry universal history architecture + test quality cleanup
  - IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
  - Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
  - TuiStateManager pure TypeScript class for CLI rendering state
  - MessageList renders IHistoryEntry[] with Tool:/System:/You:/Robota: labels
  - Display order fixed: Tool → Robota (both streaming and abort)
  - Remove 25 tautological, duplicate, and hardcoded tests

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44

## 2.0.9

### Patch Changes

- Add environment-specific builds and conditional exports for optimal browser compatibility

  This update introduces major build optimizations for better browser performance:

  ## 🚀 Environment-Specific Builds
  - **Node.js builds**: `dist/node/` with full ESM and CJS support
  - **Browser builds**: `dist/browser/` with optimized ESM bundles
  - **Automatic selection**: Bundlers automatically choose the right build

  ## 📦 Bundle Size Optimizations
  - **team package**: 36% smaller browser bundles (37.52KB → 24.12KB)
  - **sessions package**: 48% smaller browser bundles (10.64KB → 5.55KB)
  - **Tree-shaking**: Eliminates Node.js-specific code from browser builds
  - **Production optimizations**: Removes console logs and debug code in browser builds

  ## 🔧 Conditional Exports

  All packages now support conditional exports for seamless environment detection:

  ```json
  {
    "exports": {
      "node": "./dist/node/index.js",
      "browser": "./dist/browser/index.js",
      "default": "./dist/node/index.js"
    }
  }
  ```

  ## 🌐 Enhanced Browser Support
  - **Zero breaking changes**: Existing code continues to work unchanged
  - **Better performance**: Optimized bundles for faster loading
  - **Smaller footprint**: Reduced JavaScript bundle sizes for web applications
  - **Universal API**: Same API works across all environments

  This update completes the browser compatibility optimization phase, making Robota SDK production-ready for web applications with optimal performance characteristics.

- Updated dependencies
  - @robota-sdk/agent-core@2.0.9

## 2.0.8

### Patch Changes

- # Model Configuration Refactoring

  ## 🚀 **Breaking Changes**

  ### **Provider Interface Simplification**
  - **OpenAI Provider**: Removed `model`, `temperature`, `maxTokens`, `topP` from provider options
  - **Anthropic Provider**: Removed `model`, `temperature`, `maxTokens` from provider options
  - **Google Provider**: Removed `model`, `temperature`, `maxTokens` from provider options
  - **All Providers**: `client` is now optional, automatically created from `apiKey`

  ### **Centralized Model Configuration**
  - Model configuration is now exclusively handled through `defaultModel` in Robota constructor
  - Providers are simplified to handle only connection-related settings
  - Runtime model switching via `setModel()` method is now the recommended approach

  ## ✨ **Improvements**

  ### **Simplified Provider Creation**

  ```typescript
  // Before
  const provider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo',
  });

  // After
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
  });
  ```

  ### **Enhanced Validation**
  - Added strict validation for required model configuration
  - Removed default model fallbacks to prevent ambiguous behavior
  - Clear error messages when model is not specified

  ### **Documentation Updates**
  - Updated all README files with new usage patterns
  - Regenerated API documentation
  - Updated all example files (11 examples)

  ## 🔧 **Migration Guide**
  1. **Remove model settings from Provider constructors**
  2. **Use `apiKey` instead of `client` injection (recommended)**
  3. **Ensure `defaultModel` is properly configured in Robota constructor**
  4. **Update any hardcoded model references to use runtime switching**

  ## 🎯 **Benefits**
  - **Eliminates configuration confusion** - Single source of truth for models
  - **Simplifies provider setup** - Just provide API credentials
  - **Enables better runtime control** - Centralized model management
  - **Improves consistency** - All providers follow same pattern

- Updated dependencies
  - @robota-sdk/agent-core@2.0.8

## 2.0.7

### Patch Changes

- Browser compatibility improvements
  - feat: Implement SimpleLogger system to replace direct console usage for better browser compatibility
  - feat: Centralize SimpleLogger in @robota-sdk/agent-core package and export for other packages
  - feat: Add support for silent and stderr-only logging modes via SilentLogger and StderrLogger
  - refactor: Update all packages (@robota-sdk/agent-provider-openai, @robota-sdk/agent-provider-anthropic, etc.) to use centralized SimpleLogger
  - chore: Add ESLint rules to prevent direct console usage while allowing legitimate cases
  - fix: Remove unused AIProvider import from examples to clean up warnings

  These changes ensure the SDK works properly in browser environments by removing Node.js-specific console behavior while maintaining full backward compatibility.

- Updated dependencies
  - @robota-sdk/agent-core@2.0.7

## 2.0.6

### Patch Changes

- Add browser compatibility by removing Node.js dependencies
  - Replace NodeJS.Timeout with cross-platform TimerId type
  - Remove process.env dependency from logger configuration
  - Replace Node.js crypto module with jsSHA library for webhook signatures
  - Update OpenAI stream handlers to work in browser environments
  - Maintain 100% backward compatibility with existing Node.js applications

  This update enables Robota SDK to run seamlessly in both Node.js and browser environments without breaking changes.

- Updated dependencies
  - @robota-sdk/agent-core@2.0.6

## 2.0.5

### Patch Changes

- ## 🎯 TypeScript Declaration File Optimization
- Updated dependencies
  - @robota-sdk/agent-core@2.0.5

## 2.0.4

### Patch Changes

- 9f17ac6: Restore README.md files and prevent deletion during build process
- Updated dependencies [9f17ac6]
  - @robota-sdk/agent-core@2.0.4

## 2.1.0

### Minor Changes

- **Production-Ready Architecture**: Complete refactoring from experimental to production-ready state
  - **Purpose Redefinition**: Focused on managing multiple independent AI agents in isolated workspaces
  - **Removed Message Editing**: Eliminated message editing/deletion functionality to focus on core purpose
  - **Simplified Architecture**: ChatInstance now wraps Robota agents with clean delegation
  - **SessionManager Implementation**: Complete multi-session management with workspace isolation
  - **Template Integration**: Integrated with agents package AgentFactory and AgentTemplates
  - **File Cleanup**: Removed duplicate implementations that existed in agents package
  - **Type System Simplification**: Streamlined interfaces and removed complex EnhancedConversationHistory
  - **Comprehensive Testing**: Added full test coverage and working examples
  - **Documentation Overhaul**: Complete README rewrite with architecture diagrams and API reference

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@2.1.0

## 2.0.3

### Patch Changes

- @robota-sdk/agent-core@2.0.3

## 2.0.2

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included
- Updated dependencies
  - @robota-sdk/agent-core@2.0.2

## 2.0.1

### Patch Changes

- Remove unused dependencies from agents and sessions packages
- Updated dependencies
  - @robota-sdk/agent-core@2.0.1

## 2.0.0

### Major Changes

- a3a464c: # Robota SDK v2.0.0-rc.1 - Unified Architecture

  ## 🚀 Major Changes

  ### New Unified Core
  - **@robota-sdk/agent-core**: New unified core package consolidating all functionality
  - **Zero `any` types**: Complete TypeScript type safety across all packages
  - **Provider-agnostic design**: Seamless switching between OpenAI, Anthropic, and Google

  ### Key Features
  - **Multi-Provider Support**: Dynamic provider switching with type safety
  - **Advanced Function Calling**: Type-safe tool system with Zod validation
  - **Real-time Streaming**: Improved streaming with proper error handling
  - **Task Delegation**: Improved delegated workflow support
  - **Plugin Architecture**: Comprehensive plugin system with facade pattern

  ### Breaking Changes
  - `@robota-sdk/core` functionality moved to `@robota-sdk/agent-core`
  - Redesigned provider interfaces with generic type parameters
  - Updated agent configuration format

  Complete architecture overhaul focused on type safety and developer experience.

### Patch Changes

- Updated dependencies [a3a464c]
  - @robota-sdk/agent-core@2.0.0

## 1.0.5

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template
- Updated dependencies
  - @robota-sdk/agent-tools@1.0.5
  - @robota-sdk/core@1.0.5

## 1.0.4

### Patch Changes

- Add task delegation tooling with assignTask MCP tools
- Updated dependencies
  - @robota-sdk/core@1.0.4
  - @robota-sdk/agent-tools@1.0.4

## 1.0.3

### Patch Changes

- Complete examples restructure and enhanced provider architecture
- Updated dependencies
  - @robota-sdk/agent-tools@1.0.3
  - @robota-sdk/core@1.0.3

## 1.0.2

### Patch Changes

- Refactor examples and improve resource management
  - Simplified examples from 18+ files to 4 core examples (basic conversation, tool calling, multi-providers, advanced features)
  - Added proper resource cleanup with `robota.close()` method to prevent hanging processes
  - Implemented `ToolProviderManager.close()` for proper tool provider cleanup
  - Added BaseAIProvider abstract class with common functionality for all AI providers
  - Updated package.json scripts and README documentation for better user experience
  - Removed duplicate and redundant example files
  - Added .env.example file for easier setup

- Updated dependencies
  - @robota-sdk/core@1.0.2
  - @robota-sdk/agent-tools@1.0.2

## 1.0.1

### Patch Changes

- Fix facade pattern tests and conversation history message limits
- Updated dependencies
  - @robota-sdk/agent-tools@1.0.1
  - @robota-sdk/core@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-tools@1.0.0
  - @robota-sdk/core@1.0.0

## 0.3.7

### Patch Changes

- Major code quality improvements and architectural refactoring:
  - **Facade Pattern Implementation**: Simplified Robota class interface with manager-based architecture (ai, system, functions, analytics, tools, limits, conversation)
  - **Deprecated Methods Removal**: Removed 20+ deprecated methods, replaced with clean option-based constructor
  - **File Modularization**: Split large files into focused modules (function.ts → 4 modules, conversation-history refactoring)
  - **State Management Enhancement**: Implemented state machine pattern for sessions with improved error handling
  - **Pure Function Optimization**: Reduced complexity with pure functions and better separation of concerns
  - **TypeScript Improvements**: Fixed all compilation errors and improved type safety
  - **Example Updates**: Updated examples to use new API patterns

  Breaking changes are minimal as the core functionality remains the same, but the internal architecture is significantly cleaner and more maintainable.

- Updated dependencies
  - @robota-sdk/agent-tools@0.3.7
  - @robota-sdk/core@0.3.7

## 0.3.6

### Patch Changes

- Update publishing docs with proper deployment guidelines
- Updated dependencies
  - @robota-sdk/agent-tools@0.3.6
  - @robota-sdk/core@0.3.6

## 0.3.5

### Patch Changes

- Fix workspace dependencies & update README docs for all packages
- Updated dependencies
  - @robota-sdk/agent-tools@0.3.5
  - @robota-sdk/core@0.3.5

## 0.3.4

### Patch Changes

- f77f18e: Add sessions package for multi-session & chat management in workspaces
- Updated dependencies [f77f18e]
  - @robota-sdk/agent-tools@0.3.4
  - @robota-sdk/core@0.3.4
