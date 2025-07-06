# Build and Deployment Process

This document outlines the build configuration and deployment processes for the Robota project.

## Build System

### TypeScript Configuration

The project uses separate TypeScript configurations for production builds and testing:

- `tsconfig.json` - Excludes test files for production builds
- `tsconfig.test.json` - Includes all files for testing

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

### Build Tools

- **Runtime**: Use bun for TypeScript execution and script running
- **Testing**: vitest with TypeScript configuration support
- **Type Checking**: Use `tsc --noEmit` for type validation
- **Caching**: Clear build cache when encountering issues

## Deployment Process

### Package Publishing Workflow

The deployment process follows these steps:

```bash
# 1. Create changeset describing changes
pnpm changeset

# 2. Use the complete publishing script (includes all necessary steps)
pnpm publish-packages
```

The `publish-packages` script handles:
- Documentation generation
- README file copying from docs to packages
- Version updates and dependency resolution
- npm publishing with workspace dependency conversion
- Git tag creation and pushing
- Cleanup of temporary files

### Version Management

- **Semantic Versioning**: Follow semver principles
- **Pre-1.0 Releases**: Breaking changes bump minor version
- **Changesets**: Create clear, concise changeset descriptions
- **Release Notes**: Update CHANGELOG.md for user-facing changes

## Message Guidelines

### Commit Messages

Use conventional commit format:
```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug in component"
git commit -m "docs: update API documentation"
```

### Changeset Descriptions

- Keep under 80 characters
- Use imperative mood ("Add", "Fix", "Update")
- Focus on user impact
- Be specific but concise

Good examples:
- "Add README files to packages for better npm documentation"
- "Fix circular dependency between core and tools packages"
- "Update TypeScript to v5.3 for better performance"

## Development Environment

### Dependencies and Tools

- **Package Manager**: pnpm with workspace configuration
- **Runtime**: bun for development and script execution
- **Build System**: TypeScript with strict configuration
- **Testing**: vitest with comprehensive coverage

### Workspace Dependencies

Internal packages use `workspace:*` in peerDependencies, which are automatically converted to actual version numbers during publishing. 