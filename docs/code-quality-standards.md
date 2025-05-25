# Code Quality Standards

This document defines code quality standards and linting practices for the Robota project.

## Console Output and Logging Rules

- **Prohibit Direct console.log Usage**: Direct calls to `console.log` are not allowed in all TypeScript (.ts) files within `./packages/`.
- **Use logger Utility**: When logging is needed, you must use the provided `logger` utility (`info`, `warn`, `error` methods).
- **Exception Paths**: `console.log` usage is allowed in code within `./apps/examples/` and `./scripts/` paths.
- **Documentation and Examples**: Code that violates the above rules must be fixed during PR review, and all logs except examples and scripts must be output through the logger.
- **logger Examples**:

```typescript
import { logger } from '@robota-sdk/core/src/utils';
logger.info('Information message');
logger.warn('Warning message');
logger.error('Error message');
```

## Code Quality and Linting Rules

### Lint Execution Strategy

- **Focus on Development First**: During active development and code writing, focus on implementing functionality and logic rather than fixing lint warnings
- **Batch Lint Fixes**: Fix lint issues in batches after completing a logical code section or feature implementation
- **Pre-commit Linting**: Always run `pnpm run lint:fix` before committing code to ensure code quality standards
- **End-of-Session Cleanup**: At the end of each development session, run lint:fix to clean up accumulated warnings

### Lint Workflow Best Practices

1. **Development Phase**: 
   - Write code without interrupting flow for minor lint warnings
   - Focus on logic, functionality, and architecture
   - Ignore non-critical lint warnings during active coding

2. **Review Phase**: 
   - Run `pnpm run lint:fix` when ready to review your work
   - Fix remaining lint issues that couldn't be auto-fixed
   - Address any critical warnings or errors

3. **Pre-commit Phase**: 
   - Always run `pnpm run lint:fix` before final commit
   - Ensure all auto-fixable issues are resolved
   - Review and address any remaining warnings

### Available Lint Commands

```bash
# Check lint issues across all packages
pnpm run lint

# Fix auto-fixable lint issues across all packages
pnpm run lint:fix

# Fix lint issues in specific package
pnpm --filter @robota-sdk/core run lint:fix
pnpm --filter @robota-sdk/openai run lint:fix
pnpm --filter @robota-sdk/tools run lint:fix

# Fix lint issues in examples
pnpm --filter robota-examples run lint:fix
```

### Acceptable Lint Warnings During Development

- **Type-related warnings**: `@typescript-eslint/no-explicit-any` warnings can be addressed later
- **Unused variable warnings**: Variables that will be used later in development
- **Import order warnings**: Can be auto-fixed during cleanup phase

### Lint Warnings That Should Be Addressed Immediately

- **Syntax errors**: Fix immediately as they break functionality
- **Type errors**: Critical type mismatches that affect functionality
- **Security-related warnings**: Address immediately for security reasons

### IDE Configuration Recommendations

- Configure your IDE to show lint warnings without disrupting development flow
- Use lint auto-fix on save for critical issues only
- Set up pre-commit hooks to run `lint:fix` automatically

## Legacy Code Management Rules

- **No legacy compatibility unless explicitly requested**: Do not maintain legacy code for backward compatibility unless specifically requested by users
- **Clean refactoring preferred**: When refactoring code, prefer clean implementation over maintaining old interfaces
- **Clear deprecation path**: If legacy code must be maintained, provide clear deprecation warnings and migration paths
- **Remove deprecated code**: Regularly remove deprecated code that has been superseded by better implementations 