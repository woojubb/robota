# @robota-sdk/core

## 0.3.2

### Patch Changes

- e69ce1c: Enhance SEO and update URLs to robota.io domain
- Updated dependencies [e69ce1c]
  - @robota-sdk/tools@0.3.2

## 0.3.1

### Patch Changes

- Add README.md files to packages for better npm documentation.
- Updated dependencies
  - @robota-sdk/tools@0.3.1

## 0.3.0

### Minor Changes

- Remove tools re-exports from core. Import from @robota-sdk/tools instead of @robota-sdk/core.

### Patch Changes

- Updated dependencies
  - @robota-sdk/tools@0.3.0

## 0.2.10

### Patch Changes

- Add Google provider documentation and improve docs build process

  - Add comprehensive documentation for @robota-sdk/google package
  - Update sidebar and navigation to include Google provider
  - Integrate Google provider into automated API docs generation
  - Improve build scripts to auto-generate docs during build/publish

- Updated dependencies
  - @robota-sdk/tools@0.2.10

## 0.2.9

### Patch Changes

- Update README.md files across all packages:
  - Add npm package badges with direct links to npmjs.com
  - Remove outdated memory-related content from core package
  - Update API examples to match current implementation (provider-based architecture)
  - Fix function calling examples to use new toolProviders structure
  - Remove references to deleted MCP package
- Updated dependencies
  - @robota-sdk/tools@0.2.9

## 0.2.8

### Patch Changes

- 20fbf3c: Add Anthropic and Google packages to npm registry

  - Enable publishing for @robota-sdk/anthropic package (remove private flag)
  - Add @robota-sdk/google package to workspace and build configuration
  - Fix build scripts for Anthropic package
  - Synchronize package versions across all packages

- Updated dependencies [20fbf3c]
  - @robota-sdk/tools@0.2.8

## 0.2.7

### Patch Changes

- e896862: Update codebase and documentation to English

  - Update all comments and error messages to English across all packages
  - Standardize documentation to English-only for better international accessibility
  - Update VitePress configuration for English documentation site
  - Update package descriptions to English
  - Convert build script messages to English for consistency

- Updated dependencies [e896862]
  - @robota-sdk/tools@0.2.7

## 0.2.6

### Patch Changes

- Initial release of Robota SDK - A comprehensive JavaScript/TypeScript library for building Agentic AI applications with ease. This release includes core functionality, provider integrations for OpenAI and Anthropic, essential tools, comprehensive documentation, and example implementations.
- Updated dependencies
  - @robota-sdk/tools@0.2.6

## 0.2.5

### Patch Changes

- be155aa: Repository URL change and package metadata update.

  Migrated from the previous repository to a new one and updated package metadata including descriptions, keywords, and license information. This change provides the correct repository links on the npm package page.

## 0.2.4

### Patch Changes

- Changed package dependencies to workspace:\* and added external option in tsup config to optimize bundle size

## 0.2.3

### Patch Changes

- Change package scope from `@robota/` to `@robota-sdk/` in all files: source code, JSDoc comments, documentation, and examples.

## 0.2.2

### Patch Changes

- Standardize package versions and dependencies across all packages in the Robota SDK monorepo. This update:

  - Ensures consistent versioning across all packages
  - Updates internal dependencies to reference the new package names
  - Improves documentation with detailed README files for each package
  - Prepares packages for a unified release process
