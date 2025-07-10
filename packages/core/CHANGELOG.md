# @robota-sdk/core

## 2.0.3

### Patch Changes

- Final deprecated release with clear migration guidance

  This is the final release of the deprecated packages @robota-sdk/core and @robota-sdk/tools. These packages are now officially deprecated and will no longer receive updates.

  **Key Changes:**

  - Added comprehensive README.md with migration guidance
  - Updated package.json with deprecated flag
  - Version bumped to 1.0.6 for final release
  - Clear instructions for migrating to @robota-sdk/agents

  **Migration Path:**

  - @robota-sdk/core → @robota-sdk/agents
  - @robota-sdk/tools → @robota-sdk/agents (tools integrated)

  **After this release, these packages will be removed from the build process and will not receive any further updates.**

  Users should migrate to @robota-sdk/agents for continued support and new features.

## 2.0.2

### Patch Changes

- Fix npm package documentation by ensuring README.md files are included

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
