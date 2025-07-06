# robota-examples

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
