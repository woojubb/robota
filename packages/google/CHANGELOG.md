# @robota-sdk/google

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
    model: "gpt-3.5-turbo",
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
  - @robota-sdk/agents@2.0.8

## 2.0.7

### Patch Changes

- Browser compatibility improvements

  - feat: Implement SimpleLogger system to replace direct console usage for better browser compatibility
  - feat: Centralize SimpleLogger in @robota-sdk/agents package and export for other packages
  - feat: Add support for silent and stderr-only logging modes via SilentLogger and StderrLogger
  - refactor: Update all packages (@robota-sdk/openai, @robota-sdk/anthropic, etc.) to use centralized SimpleLogger
  - chore: Add ESLint rules to prevent direct console usage while allowing legitimate cases
  - fix: Remove unused AIProvider import from examples to clean up warnings

  These changes ensure the SDK works properly in browser environments by removing Node.js-specific console behavior while maintaining full backward compatibility.

- Updated dependencies
  - @robota-sdk/agents@2.0.7

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
  - @robota-sdk/agents@2.0.6

## 2.0.5

### Patch Changes

- ## 🎯 TypeScript Declaration File Optimization
- Updated dependencies
  - @robota-sdk/agents@2.0.5

## 2.0.4

### Patch Changes

- 9f17ac6: Restore README.md files and prevent deletion during build process
- Updated dependencies [9f17ac6]
  - @robota-sdk/agents@2.0.4

## 2.0.3

### Patch Changes

- @robota-sdk/agents@2.0.3

## 2.0.2

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included
- Updated dependencies
  - @robota-sdk/agents@2.0.2

## 2.0.1

### Patch Changes

- Remove unused dependencies from agents and sessions packages
- Updated dependencies
  - @robota-sdk/agents@2.0.1

## 2.0.0

### Major Changes

- a3a464c: # Robota SDK v2.0.0-rc.1 - Unified Architecture

  ## 🚀 Major Changes

  ### New Unified Core

  - **@robota-sdk/agents**: New unified core package consolidating all functionality
  - **Zero `any` types**: Complete TypeScript type safety across all packages
  - **Provider-agnostic design**: Seamless switching between OpenAI, Anthropic, and Google

  ### Key Features

  - **Multi-Provider Support**: Dynamic provider switching with type safety
  - **Advanced Function Calling**: Type-safe tool system with Zod validation
  - **Real-time Streaming**: Improved streaming with proper error handling
  - **Team Collaboration**: Enhanced multi-agent coordination
  - **Plugin Architecture**: Comprehensive plugin system with facade pattern

  ### Breaking Changes

  - `@robota-sdk/core` functionality moved to `@robota-sdk/agents`
  - Redesigned provider interfaces with generic type parameters
  - Updated agent configuration format

  Complete architecture overhaul focused on type safety and developer experience.

### Patch Changes

- Updated dependencies [a3a464c]
  - @robota-sdk/agents@2.0.0

## 1.0.5

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template
- Updated dependencies
  - @robota-sdk/tools@1.0.5
  - @robota-sdk/core@1.0.5

## 1.0.4

### Patch Changes

- Add multi-agent team collaboration with intelligent task delegation
- Updated dependencies
  - @robota-sdk/core@1.0.4
  - @robota-sdk/tools@1.0.4

## 1.0.3

### Patch Changes

- Complete examples restructure and enhanced provider architecture
- Updated dependencies
  - @robota-sdk/tools@1.0.3
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
  - @robota-sdk/tools@1.0.2

## 1.0.1

### Patch Changes

- Fix facade pattern tests and conversation history message limits
- Updated dependencies
  - @robota-sdk/tools@1.0.1
  - @robota-sdk/core@1.0.1

## 1.0.0

### Patch Changes

- feat: implement comprehensive performance optimization system

  - Add caching system with LRU + TTL algorithms
  - Implement lazy loading system for on-demand resource loading
  - Add resource manager for memory leak prevention
  - Implement real-time performance monitoring
  - Translate all Korean text to English for internationalization
  - Integrate performance monitoring into BaseToolProvider

- Updated dependencies
  - @robota-sdk/tools@1.0.0
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
  - @robota-sdk/tools@0.3.7
  - @robota-sdk/core@0.3.7

## 0.3.6

### Patch Changes

- Update publishing docs with proper deployment guidelines
- Updated dependencies
  - @robota-sdk/tools@0.3.6
  - @robota-sdk/core@0.3.6

## 0.3.5

### Patch Changes

- Fix workspace dependencies & update README docs for all packages
- Updated dependencies
  - @robota-sdk/tools@0.3.5
  - @robota-sdk/core@0.3.5

## 0.3.4

### Patch Changes

- f77f18e: Add sessions package for multi-session & chat management in workspaces
- Updated dependencies [f77f18e]
  - @robota-sdk/tools@0.3.4
  - @robota-sdk/core@0.3.4

## 0.3.3

### Patch Changes

- Fix type imports and external deps; update docs paths and build config
- Updated dependencies
  - @robota-sdk/core@0.3.3
  - @robota-sdk/tools@0.3.3

## 0.3.2

### Patch Changes

- e69ce1c: Enhance SEO and update URLs to robota.io domain
- Updated dependencies [e69ce1c]
  - @robota-sdk/core@0.3.2

## 0.3.1

### Patch Changes

- Add README.md files to packages for better npm documentation.
- Updated dependencies
  - @robota-sdk/core@0.3.1

## 0.3.0

### Patch Changes

- Remove tools re-exports from core. Import from @robota-sdk/tools instead of @robota-sdk/core.
- Updated dependencies
  - @robota-sdk/core@0.3.0

## 0.2.10

### Patch Changes

- Add Google provider documentation and improve docs build process

  - Add comprehensive documentation for @robota-sdk/google package
  - Update sidebar and navigation to include Google provider
  - Integrate Google provider into automated API docs generation
  - Improve build scripts to auto-generate docs during build/publish

- Updated dependencies
  - @robota-sdk/core@0.2.10

## 0.2.9

### Patch Changes

- Update README.md files across all packages:
  - Add npm package badges with direct links to npmjs.com
  - Remove outdated memory-related content from core package
  - Update API examples to match current implementation (provider-based architecture)
  - Fix function calling examples to use new toolProviders structure
  - Remove references to deleted MCP package
- Updated dependencies
  - @robota-sdk/core@0.2.9

## 0.2.8

### Patch Changes

- 20fbf3c: Add Anthropic and Google packages to npm registry

  - Enable publishing for @robota-sdk/anthropic package (remove private flag)
  - Add @robota-sdk/google package to workspace and build configuration
  - Fix build scripts for Anthropic package
  - Synchronize package versions across all packages

- Updated dependencies [20fbf3c]
  - @robota-sdk/core@0.2.8
