# @robota-sdk/google

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
