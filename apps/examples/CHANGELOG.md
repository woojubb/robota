# robota-examples

## 1.0.9

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
  - @robota-sdk/anthropic@2.0.9
  - @robota-sdk/agents@2.0.9
  - @robota-sdk/google@2.0.9
  - @robota-sdk/openai@2.0.9
  - @robota-sdk/team@2.0.9

## 1.0.8

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
  - @robota-sdk/anthropic@2.0.8
  - @robota-sdk/agents@2.0.8
  - @robota-sdk/google@2.0.8
  - @robota-sdk/openai@2.0.8
  - @robota-sdk/team@2.0.8

## 1.0.7

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
  - @robota-sdk/anthropic@2.0.7
  - @robota-sdk/agents@2.0.7
  - @robota-sdk/openai@2.0.7
  - @robota-sdk/google@2.0.7
  - @robota-sdk/team@2.0.7

## 1.0.6

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
  - @robota-sdk/anthropic@2.0.6
  - @robota-sdk/google@2.0.6
  - @robota-sdk/openai@2.0.6
  - @robota-sdk/team@2.0.6

## 1.0.5

### Patch Changes

- ## 🎯 TypeScript Declaration File Optimization
- Updated dependencies
  - @robota-sdk/anthropic@2.0.5
  - @robota-sdk/agents@2.0.5
  - @robota-sdk/google@2.0.5
  - @robota-sdk/openai@2.0.5
  - @robota-sdk/team@2.0.5

## 1.0.4

### Patch Changes

- 9f17ac6: Restore README.md files and prevent deletion during build process
- Updated dependencies [9f17ac6]
  - @robota-sdk/anthropic@2.0.4
  - @robota-sdk/agents@2.0.4
  - @robota-sdk/google@2.0.4
  - @robota-sdk/openai@2.0.4
  - @robota-sdk/team@2.0.4

## 1.0.3

### Patch Changes

- @robota-sdk/agents@2.0.3
- @robota-sdk/openai@2.0.3
- @robota-sdk/anthropic@2.0.3
- @robota-sdk/google@2.0.3
- @robota-sdk/team@2.0.3

## 1.0.2

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included
- Updated dependencies
  - @robota-sdk/agents@2.0.2
  - @robota-sdk/anthropic@2.0.2
  - @robota-sdk/google@2.0.2
  - @robota-sdk/openai@2.0.2
  - @robota-sdk/team@2.0.2

## 1.0.1

### Patch Changes

- Remove unused dependencies from agents and sessions packages
- Updated dependencies
  - @robota-sdk/agents@2.0.1
  - @robota-sdk/anthropic@2.0.1
  - @robota-sdk/google@2.0.1
  - @robota-sdk/openai@2.0.1
  - @robota-sdk/team@2.0.1

## 1.0.0

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
  - @robota-sdk/openai@2.0.0
  - @robota-sdk/anthropic@2.0.0
  - @robota-sdk/google@2.0.0
  - @robota-sdk/team@2.0.0

## 0.1.26

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template
- Updated dependencies
  - @robota-sdk/anthropic@1.0.5
  - @robota-sdk/sessions@1.0.5
  - @robota-sdk/openai@1.0.5
  - @robota-sdk/tools@1.0.5
  - @robota-sdk/core@1.0.5
  - @robota-sdk/team@1.0.5
  - @robota-sdk/google@1.0.5

## 0.1.25

### Patch Changes

- Updated dependencies
  - @robota-sdk/core@1.0.4
  - @robota-sdk/openai@1.0.4
  - @robota-sdk/anthropic@1.0.4
  - @robota-sdk/google@1.0.4
  - @robota-sdk/tools@1.0.4
  - @robota-sdk/sessions@1.0.4
  - @robota-sdk/team@1.0.4

## 0.1.24

### Patch Changes

- Complete examples restructure and enhanced provider architecture
- Updated dependencies
  - @robota-sdk/anthropic@1.0.3
  - @robota-sdk/sessions@1.0.3
  - @robota-sdk/google@1.0.3
  - @robota-sdk/openai@1.0.3
  - @robota-sdk/tools@1.0.3
  - @robota-sdk/core@1.0.3

## 0.1.23

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
  - @robota-sdk/anthropic@1.0.2
  - @robota-sdk/sessions@1.0.2
  - @robota-sdk/google@1.0.2
  - @robota-sdk/openai@1.0.2
  - @robota-sdk/core@1.0.2
  - @robota-sdk/tools@1.0.2
