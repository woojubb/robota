# robota-services

## 0.1.7

### Patch Changes

- Simplify team API, update docs, fix lint issues, add task coordinator template

## 0.1.6

### Patch Changes

- Complete examples restructure and enhanced provider architecture

## 0.1.5

### Patch Changes

- Refactor examples and improve resource management

  - Simplified examples from 18+ files to 4 core examples (basic conversation, tool calling, multi-providers, advanced features)
  - Added proper resource cleanup with `robota.close()` method to prevent hanging processes
  - Implemented `ToolProviderManager.close()` for proper tool provider cleanup
  - Added BaseAIProvider abstract class with common functionality for all AI providers
  - Updated package.json scripts and README documentation for better user experience
  - Removed duplicate and redundant example files
  - Added .env.example file for easier setup

## 0.1.4

### Patch Changes

- Fix facade pattern tests and conversation history message limits

## 0.1.3

### Patch Changes

- Update publishing docs with proper deployment guidelines

## 0.1.2

### Patch Changes

- Fix workspace dependencies & update README docs for all packages

## 0.1.1

### Patch Changes

- f77f18e: Add sessions package for multi-session & chat management in workspaces
