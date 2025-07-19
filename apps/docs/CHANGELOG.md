# robota-docs

## 1.0.25

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

## 1.0.24

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

## 1.0.23

### Patch Changes

- Browser compatibility improvements

  - feat: Implement SimpleLogger system to replace direct console usage for better browser compatibility
  - feat: Centralize SimpleLogger in @robota-sdk/agents package and export for other packages
  - feat: Add support for silent and stderr-only logging modes via SilentLogger and StderrLogger
  - refactor: Update all packages (@robota-sdk/openai, @robota-sdk/anthropic, etc.) to use centralized SimpleLogger
  - chore: Add ESLint rules to prevent direct console usage while allowing legitimate cases
  - fix: Remove unused AIProvider import from examples to clean up warnings

  These changes ensure the SDK works properly in browser environments by removing Node.js-specific console behavior while maintaining full backward compatibility.

## 1.0.22

### Patch Changes

- Add browser compatibility by removing Node.js dependencies

  - Replace NodeJS.Timeout with cross-platform TimerId type
  - Remove process.env dependency from logger configuration
  - Replace Node.js crypto module with jsSHA library for webhook signatures
  - Update OpenAI stream handlers to work in browser environments
  - Maintain 100% backward compatibility with existing Node.js applications

  This update enables Robota SDK to run seamlessly in both Node.js and browser environments without breaking changes.

## 1.0.21

### Patch Changes

- ## 🎯 TypeScript Declaration File Optimization

## 1.0.20

### Patch Changes

- 9f17ac6: Restore README.md files and prevent deletion during build process

## 1.0.19

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included

## 1.0.18

### Patch Changes

- Remove unused dependencies from agents and sessions packages

## 1.0.17

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template

## 1.0.16

### Patch Changes

- Complete examples restructure and enhanced provider architecture

## 1.0.15

### Patch Changes

- Refactor examples and improve resource management

  - Simplified examples from 18+ files to 4 core examples (basic conversation, tool calling, multi-providers, advanced features)
  - Added proper resource cleanup with `robota.close()` method to prevent hanging processes
  - Implemented `ToolProviderManager.close()` for proper tool provider cleanup
  - Added BaseAIProvider abstract class with common functionality for all AI providers
  - Updated package.json scripts and README documentation for better user experience
  - Removed duplicate and redundant example files
  - Added .env.example file for easier setup

## 1.0.14

### Patch Changes

- Fix facade pattern tests and conversation history message limits

## 1.0.13

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

## 1.0.12

### Patch Changes

- Update publishing docs with proper deployment guidelines

## 1.0.11

### Patch Changes

- Fix workspace dependencies & update README docs for all packages

## 1.0.10

### Patch Changes

- f77f18e: Add sessions package for multi-session & chat management in workspaces

## 1.0.9

### Patch Changes

- Fix type imports and external deps; update docs paths and build config

## 1.0.8

### Patch Changes

- e69ce1c: Enhance SEO and update URLs to robota.io domain

## 1.0.7

### Patch Changes

- Add README.md files to packages for better npm documentation.

## 1.0.6

### Patch Changes

- Add Google provider documentation and improve docs build process

  - Add comprehensive documentation for @robota-sdk/google package
  - Update sidebar and navigation to include Google provider
  - Integrate Google provider into automated API docs generation
  - Improve build scripts to auto-generate docs during build/publish

## 1.0.5

### Patch Changes

- Update README.md files across all packages:
  - Add npm package badges with direct links to npmjs.com
  - Remove outdated memory-related content from core package
  - Update API examples to match current implementation (provider-based architecture)
  - Fix function calling examples to use new toolProviders structure
  - Remove references to deleted MCP package

## 1.0.4

### Patch Changes

- 20fbf3c: Add Anthropic and Google packages to npm registry

  - Enable publishing for @robota-sdk/anthropic package (remove private flag)
  - Add @robota-sdk/google package to workspace and build configuration
  - Fix build scripts for Anthropic package
  - Synchronize package versions across all packages

## 1.0.3

### Patch Changes

- e896862: Update codebase and documentation to English

  - Update all comments and error messages to English across all packages
  - Standardize documentation to English-only for better international accessibility
  - Update VitePress configuration for English documentation site
  - Update package descriptions to English
  - Convert build script messages to English for consistency

## 1.0.2

### Patch Changes

- Initial release of Robota SDK - A comprehensive JavaScript/TypeScript library for building Agentic AI applications with ease. This release includes core functionality, provider integrations for OpenAI and Anthropic, essential tools, comprehensive documentation, and example implementations.

## 1.0.1

### Patch Changes

- be155aa: Repository URL change and package metadata update.

  Migrated from the previous repository to a new one and updated package metadata including descriptions, keywords, and license information. This change provides the correct repository links on the npm package page.
