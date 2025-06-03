---
title: Package Publishing Guide
description: How to publish Robota SDK packages to npm
lang: en-US
---

# Package Publishing Guide

This guide explains how to build and publish Robota SDK packages to npm.

## Overview

Robota SDK uses a monorepo structure with multiple packages:

- `@robota-sdk/core`: Core functionality
- `@robota-sdk/openai`: OpenAI provider
- `@robota-sdk/anthropic`: Anthropic provider
- `@robota-sdk/google`: Google AI provider  
- `@robota-sdk/tools`: Utility tools and function calling
- `@robota-sdk/sessions`: Session and chat management

All packages are published under the `@robota-sdk` scope on npm.

## Prerequisites

- Node.js 18 or newer
- PNPM 8.15.4 (exact version)
- npm account with access to the `@robota-sdk` organization

## ⚠️ Important Publishing Rules

### **ALWAYS use the official publishing command:**

```bash
pnpm run publish:packages
```

### **❌ DO NOT use direct pnpm publish commands:**

```bash
# DON'T USE THESE:
pnpm publish -r
pnpm publish -r --no-git-checks
```

**Why?** The `publish:packages` script includes essential pre-processing steps:
- README copying from docs to packages
- TypeDoc documentation generation
- Proper changeset version handling
- Git tag management
- Cleanup operations

## Publishing Process

The publishing process consists of these main steps:

1. Creating changesets
2. Building packages
3. Copying README files from docs directory
4. Publishing packages to npm
5. Pushing git tags
6. Cleaning up temporary files

### Step 1: Create a Changeset

Create a changeset to describe your changes and specify version bumps:

```bash
pnpm changeset
```

Follow the interactive prompts to:
1. Select packages to include
2. Choose version bump types (patch, minor, or major)
3. Write a summary of changes (keep it concise and descriptive)

### Step 2: Build and Test

Ensure all packages are built and tested:

```bash
pnpm build
pnpm typecheck
pnpm test
```

### Step 3: Official Publishing Command

**Use this command for all package publishing:**

```bash
pnpm run publish:packages
```

This command performs the following steps automatically:

1. **TypeDoc Generation**: Converts TypeScript docs to markdown
2. **README Copying**: Copies README files from `docs/packages/` to each package
3. **Version Update**: Applies changesets and updates package versions
4. **Dependency Install**: Ensures all dependencies are updated
5. **Package Publishing**: Publishes packages to npm with workspace dependency resolution
6. **Git Tag Pushing**: Pushes version tags to the repository
7. **Cleanup**: Removes temporary README files from packages

## README Management

README files are managed centrally in the `docs/packages/` directory:

```
docs/packages/
├── core/README.md
├── openai/README.md
├── anthropic/README.md
├── google/README.md
├── tools/README.md
└── sessions/README.md
```

### Automatic README Processing

During publishing:

1. **Copy Phase**: README files are copied from `docs/packages/` to `packages/`
2. **Publish Phase**: Packages are published with the copied README files
3. **Cleanup Phase**: Temporary README files are removed from `packages/`

This ensures:
- ✅ Consistent documentation between docs site and npm packages
- ✅ No manual README management in package directories
- ✅ Single source of truth for package documentation

## Workspace Dependencies

The project uses `workspace:*` dependencies which are automatically resolved:

```json
{
  "peerDependencies": {
    "@robota-sdk/core": "workspace:*",
    "@robota-sdk/tools": "workspace:*"
  }
}
```

**pnpm publish -r** automatically converts these to actual version numbers during publishing.

## Script Details

### Main Publishing Script (`pnpm run publish:packages`)

```bash
pnpm run typedoc:convert && 
pnpm readme:copy && 
pnpm changeset version && 
pnpm install && 
pnpm publish -r && 
pnpm git:push-tags && 
pnpm readme:cleanup
```

### README Management Scripts

**Copy READMEs:**
```bash
pnpm readme:copy
# Runs: node scripts/copy-readme.cjs copy
```

**Cleanup READMEs:**
```bash
pnpm readme:cleanup  
# Runs: node scripts/copy-readme.cjs cleanup
```

## Troubleshooting

### Authentication Issues

If you encounter authentication issues with npm:

```bash
npm login --scope=@robota-sdk
```

### Publish Failed

If publishing fails:

1. Check if you have the right permissions on npm
2. Verify that all changesets have been properly applied
3. Ensure git working directory is clean
4. Run `pnpm build` to ensure all packages compile
5. Check for workspace dependency issues

### Workspace Dependency Errors

If you see errors about workspace dependencies:

1. Ensure all `@robota-sdk` packages use `workspace:*` in peerDependencies
2. Use actual version ranges only for external dependencies
3. Run `pnpm install` to refresh workspace links

## Version Management

- **patch**: Bug fixes, documentation updates, dependency updates
- **minor**: New features, API additions (backward compatible)
- **major**: Breaking changes, API removals

Example changeset summary formats:
- `Fix workspace dependencies & update README docs for all packages`
- `Add new session management features to @robota-sdk/sessions`
- `Breaking: Update AIProvider interface with new streaming API`

## Best Practices

1. **Always test before publishing**: Run full build and test suite
2. **Write meaningful changeset summaries**: Describe what changed and why
3. **Use proper versioning**: Follow semantic versioning guidelines
4. **Keep changesets focused**: One changeset per logical change
5. **Update docs first**: Ensure README files are current before publishing

## Conclusion

Following this standardized process ensures consistent package publishing and versioning across the Robota SDK ecosystem. Always use `pnpm run publish:packages` for all package publishing to ensure proper preprocessing and cleanup. 