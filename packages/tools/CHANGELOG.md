# @robota-sdk/tools

## 2.0.1

### Patch Changes

- Remove unused dependencies from agents and sessions packages

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

## 1.0.5

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template
- Updated dependencies
  - @robota-sdk/core@1.0.5

## 1.0.4

### Patch Changes

- Add multi-agent team collaboration with intelligent task delegation
- Updated dependencies
  - @robota-sdk/core@1.0.4

## 1.0.3

### Patch Changes

- Complete examples restructure and enhanced provider architecture
- Updated dependencies
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

## 1.0.1

### Patch Changes

- Fix facade pattern tests and conversation history message limits
- Updated dependencies
  - @robota-sdk/core@1.0.1

## 1.0.0

### Minor Changes

- feat: implement comprehensive performance optimization system

  - Add caching system with LRU + TTL algorithms
  - Implement lazy loading system for on-demand resource loading
  - Add resource manager for memory leak prevention
  - Implement real-time performance monitoring
  - Translate all Korean text to English for internationalization
  - Integrate performance monitoring into BaseToolProvider

### Patch Changes

- Updated dependencies
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
  - @robota-sdk/core@0.3.7

## 0.3.6

### Patch Changes

- Update publishing docs with proper deployment guidelines
- Updated dependencies
  - @robota-sdk/core@0.3.6

## 0.3.5

### Patch Changes

- Fix workspace dependencies & update README docs for all packages
- Updated dependencies
  - @robota-sdk/core@0.3.5

## 0.3.4

### Patch Changes

- f77f18e: Add sessions package for multi-session & chat management in workspaces
- Updated dependencies [f77f18e]
  - @robota-sdk/core@0.3.4

## 0.3.3

### Patch Changes

- Fix type imports and external deps; update docs paths and build config
- Updated dependencies
  - @robota-sdk/core@0.3.3

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

## 0.2.7

### Patch Changes

- e896862: Update codebase and documentation to English

  - Update all comments and error messages to English across all packages
  - Standardize documentation to English-only for better international accessibility
  - Update VitePress configuration for English documentation site
  - Update package descriptions to English
  - Convert build script messages to English for consistency

- Updated dependencies [e896862]
  - @robota-sdk/core@0.2.7

## 0.2.6

### Patch Changes

- Initial release of Robota SDK - A comprehensive JavaScript/TypeScript library for building Agentic AI applications with ease. This release includes core functionality, provider integrations for OpenAI and Anthropic, essential tools, comprehensive documentation, and example implementations.
- Updated dependencies
  - @robota-sdk/core@0.2.6

## 0.2.5

### Patch Changes

- be155aa: Repository URL change and package metadata update.

  Migrated from the previous repository to a new one and updated package metadata including descriptions, keywords, and license information. This change provides the correct repository links on the npm package page.

- Updated dependencies [be155aa]
  - @robota-sdk/core@0.2.5

## 0.2.4

### Patch Changes

- Changed package dependencies to workspace:\* and added external option in tsup config to optimize bundle size
- Updated dependencies
  - @robota-sdk/core@0.2.4

## 0.2.3

### Patch Changes

- Change package scope from `@robota/` to `@robota-sdk/` in all files: source code, JSDoc comments, documentation, and examples.
- Updated dependencies
  - @robota-sdk/core@0.2.3

## 0.2.2

### Patch Changes

- Standardize package versions and dependencies across all packages in the Robota SDK monorepo. This update:

  - Ensures consistent versioning across all packages
  - Updates internal dependencies to reference the new package names
  - Improves documentation with detailed README files for each package
  - Prepares packages for a unified release process

- Updated dependencies
  - @robota-sdk/core@0.2.2
