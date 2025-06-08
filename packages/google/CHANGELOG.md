# @robota-sdk/google

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
