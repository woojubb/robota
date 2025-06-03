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
- `@robota-sdk/mcp`: Model Context Protocol provider
- `@robota-sdk/tools`: Utility tools

All packages are published under the `@robota-sdk` scope on npm.

## Prerequisites

- Node.js 18 or newer
- PNPM 8.0.0 or newer
- npm account with access to the `@robota-sdk` organization

## Publishing Process

The publishing process consists of these main steps:

1. Building packages
2. Copying README files from the docs directory
3. Publishing packages with changesets
4. Pushing git tags
5. Cleaning up temporary README files

### Build Packages

Before publishing, ensure all packages are built:

```bash
pnpm build
```

### Creating a Changeset

Create a changeset to describe your changes and specify version bumps:

```bash
pnpm changeset
```

Follow the interactive prompts to:
1. Select packages to include
2. Choose version bump types (patch, minor, or major)
3. Write a summary of changes

### Version Packages

Update package versions based on changesets:

```bash
pnpm changeset version
```

This command will:
1. Update package.json versions
2. Update dependencies between packages
3. Update CHANGELOG.md files
4. Remove consumed changeset files

### Publish Packages

We've simplified the publishing process with a single command:

```bash
pnpm publish-packages
```

This command performs the following steps:

1. Copies README files from the docs directory to each package directory
2. Publishes the packages to npm using changesets
3. Pushes git tags to the remote repository
4. Cleans up temporary README files

## README Management

The README files are managed centrally in the `apps/docs/docs/packages` directory. During publishing:

1. README files are copied to package directories
2. Packages are published with the README files
3. Temporary README files are removed from package directories

This approach ensures consistency between documentation and npm package README files.

## Script Implementation

The publishing process is implemented with two main scripts:

### copy-readme.js

Copies README files from the docs directory to package directories.

### cleanup-readme.js

Removes temporary README files from package directories after publishing.

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

## Conclusion

Following this standardized process ensures consistent package publishing and versioning across the Robota SDK ecosystem. 