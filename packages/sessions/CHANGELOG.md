# @robota-sdk/sessions

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
