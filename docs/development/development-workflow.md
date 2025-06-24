# Development Workflow

This document outlines the development workflow and processes for the Robota project.

## Code Quality Process

### Pragmatic Lint Strategy

- **Iterative Improvement**: Fix lint issues progressively, not all at once
- **Context-aware Decisions**: Some lint rules may be overridden with good reason
- **Team Consistency**: Maintain consistent code style across the project
- **Tool-assisted**: Use automated tools where possible, manual review where needed

### Lint Workflow Best Practices

1. **Development Phase**: 
   - Fix critical errors immediately (syntax, type errors)
   - Address warnings that affect functionality
   - Defer style-only warnings to review phase
   - Use `// eslint-disable-next-line` sparingly with comments explaining why

2. **Review Phase**: 
   - Run `pnpm run lint:fix` to auto-fix issues
   - Address remaining warnings with context consideration
   - Document any intentional rule overrides

3. **Pre-commit Phase**: 
   - Ensure no critical errors remain
   - All auto-fixable issues should be resolved
   - Document any remaining warnings in PR description

### Available Lint Commands

```bash
# Check lint issues across all packages
pnpm run lint

# Fix auto-fixable lint issues across all packages
pnpm run lint:fix

# Package-specific linting
pnpm --filter @robota-sdk/agents run lint:fix
pnpm --filter @robota-sdk/core run lint:fix
pnpm --filter @robota-sdk/openai run lint:fix

# Examples and apps
pnpm --filter robota-examples run lint:fix
```

### Lint Rule Categories

#### Critical Issues (Fix Immediately)
- **Syntax Errors**: Break compilation/runtime
- **Type Errors**: Cause runtime failures
- **Security Issues**: Potential vulnerabilities
- **Logic Errors**: Incorrect program behavior

#### Important Issues (Address in Review)
- **Unused Variables**: May indicate incomplete code
- **Missing Error Handling**: Potential runtime issues
- **Performance Issues**: Inefficient patterns
- **Accessibility Issues**: User experience impacts

#### Style Issues (Batch Fix)
- **Import Ordering**: Can be auto-fixed
- **Formatting**: Should be handled by prettier
- **Naming Conventions**: Consistency improvements
- **Comment Style**: Documentation improvements

## Legacy Code Management

### Pragmatic Legacy Handling

- **Deprecation with Purpose**: Deprecate when there's a clear better alternative
- **Migration Support**: Provide migration tools and documentation
- **Compatibility Windows**: Support deprecated features for reasonable time periods
- **User Communication**: Clear communication about deprecations and timelines

### Refactoring Strategy

- **Incremental Changes**: Large refactors should be broken into smaller, reviewable changes
- **Backward Compatibility**: Maintain API compatibility during refactoring
- **Feature Flags**: Use feature flags for major changes
- **Testing**: Comprehensive testing during refactoring

### Technical Debt Management

- **Documentation**: Document known technical debt and its impact
- **Prioritization**: Address technical debt based on user impact and development velocity
- **Boy Scout Rule**: Leave code better than you found it
- **Regular Reviews**: Periodic technical debt assessment and planning

## IDE Configuration

### VSCode Recommendations

```json
// VSCode settings.json example
{
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": true,
        "source.organizeImports": true
    },
    "editor.formatOnSave": true,
    "typescript.preferences.importModuleSpecifier": "relative"
}
```

## Acceptable Code Overrides

### Temporary Lint Overrides

```typescript
// Acceptable: External library without types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const externalLibResult: any = untypedLibrary.method();

// Acceptable: Intentional any for generic utility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepClone<T = any>(obj: T): T {
    // Implementation needs any for JSON serialization
}

// NOT acceptable: Lazy typing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processData(data: any): any { // Should define proper types
```

## Package-Specific Guidelines

### @robota-sdk/agents Package

- Must not depend on @robota-sdk/core or @robota-sdk/tools
- Should be the primary entry point for new users
- Implement all functionality independently
- Maintain compatibility with existing provider packages

### Provider Packages (@robota-sdk/openai, anthropic, google)

- Should remain lightweight and focused
- Implement only provider-specific logic
- Maintain backward compatibility
- Support both core and agents packages

### Deprecation Strategy

- **Gradual Migration**: Provide clear migration paths for deprecated features
- **Timing**: Maintain deprecated features for at least 2 major versions
- **Documentation**: Clear deprecation warnings with replacement suggestions
- **Breaking Changes**: Only in major version releases 