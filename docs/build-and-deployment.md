# Build and Deployment Guidelines

This document provides guidelines for build configuration and deployment processes.

## Build System Rules

### Test File Separation

- **Production Build**: Test files should be excluded from production builds
- **TypeScript Configuration**: Include test files in `exclude` in `tsconfig.json`
- **Test Configuration**: Use separate `tsconfig.test.json` to include test files only during test execution

```json
// tsconfig.json - For production build
{
  "exclude": [
    "src/**/__tests__/**/*",
    "src/**/*.test.ts",
    "src/**/*.test.tsx", 
    "src/**/*.spec.ts",
    "src/**/*.spec.tsx"
  ]
}

// tsconfig.test.json - For testing
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*"],
  "exclude": []
}
```

### Type System Management

- **Type Location**: Define types in the most appropriate location to prevent circular dependencies
- **Type Reuse**: Export common types from appropriate modules for reuse
- **Naming Conflict Prevention**: Avoid naming conflicts between `.d.ts` and `.ts` files

### Build Tool Configuration

- **vitest Configuration**: Specify TypeScript configuration file for testing
- **Build Cache**: Clear cache and retry when build issues occur
- **Type Check**: Pre-validate type errors with `tsc --noEmit`

## Runtime and Execution Environment

### TypeScript Execution

- **Use bun**: Use bun instead of ts-node for TypeScript code execution
- **Example**: Execute scripts in `bun run script.ts` format
- Use the same runtime throughout the project for performance and consistency

### Development Environment Setup

- Manage development dependencies using bun
- Use bun for script execution and testing
- Recommend using bun for production builds as well

## Deployment and Release Rules

### Package Publishing Requirements

- **Mandatory Deployment Script**: Always use the `publish-packages` script for npm deployments
  ```bash
  pnpm publish-packages
  ```
- **Never use direct changeset publish**: Do not use `pnpm changeset publish` directly
- **Required Pre-deployment Steps**: The `publish-packages` script ensures:
  - Documentation generation (`docs:generate`)
  - README file copying (`copy-readme`) 
  - Proper npm publishing (`changeset publish`)
  - Git tag pushing (`push-tags`)
  - Cleanup of temporary files (`cleanup-readme`)

### Deployment Workflow

```bash
# ✅ Correct deployment process
pnpm changeset                    # Create changeset
pnpm publish-packages            # Complete deployment

# ❌ Incorrect - missing steps
pnpm changeset publish           # Direct publish (missing README, docs, etc.)
```

### Version Management

- Use semantic versioning (semver) principles
- Breaking changes require minor version bumps for pre-1.0 releases
- Patch releases for bug fixes and non-breaking improvements
- Always create changesets with clear, concise descriptions

## Commit and Changeset Message Guidelines

### Message Length Requirements

- **Maximum 80 characters**: All commit messages and changeset descriptions must be 80 characters or less
- **Concise and clear**: Focus on essential information only
- **No detailed explanations**: Save detailed explanations for PR descriptions or documentation

### Good Examples

```bash
# ✅ Good commit messages (under 80 chars)
"Remove tools re-exports from core package"
"Add README files to packages for npm"
"Fix circular dependency in tools"
"Update build scripts for proper deployment"

# ✅ Good changeset descriptions
"Remove tools re-exports from core. Import from @robota-sdk/tools instead."
"Add README.md files to packages for better npm documentation."
"Fix circular dependency between core and tools packages."
```

### Bad Examples

```bash
# ❌ Too long and verbose
"Remove re-export functionality from @robota-sdk/core package because it was creating confusion and circular dependencies with @robota-sdk/tools package, which violates our architectural principles"

# ❌ Too detailed for changeset
"This commit fixes the architectural issue where @robota-sdk/core was incorrectly re-exporting functionality from @robota-sdk/tools, creating confusion and circular dependencies. The change improves module separation and follows development guidelines."
```

### Changeset Creation Guidelines

1. **Be specific but brief**: Mention what changed, not why
2. **Use imperative mood**: "Add", "Remove", "Fix", "Update"
3. **Focus on user impact**: What users need to know or do
4. **One line preferred**: Avoid multi-line descriptions unless absolutely necessary

### Commit Message Format

```bash
# Format: <action>: <brief description>
git commit -m "feat: add README files to npm packages"
git commit -m "fix: remove circular dependency in tools"
git commit -m "refactor: simplify deployment workflow"
``` 