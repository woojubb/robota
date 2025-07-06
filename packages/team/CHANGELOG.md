# @robota-sdk/team

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
