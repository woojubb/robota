# robota-docs

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
