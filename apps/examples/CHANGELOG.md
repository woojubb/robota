# robota-examples

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
