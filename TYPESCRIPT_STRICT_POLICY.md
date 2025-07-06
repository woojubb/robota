# 🚨 TypeScript Strict Type Safety Policy

## Policy Overview

This document outlines the **IMMUTABLE** TypeScript strict type safety policy for the Robota SDK project. All configurations and rules described here are **STRICTLY PROHIBITED** from modification without explicit architecture team approval.

## Policy Implementation

### 1. TypeScript Configuration (`tsconfig.base.json`)

```json
{
  "compilerOptions": {
    // ==========================================
    // CRITICAL POLICY: ANY/UNKNOWN TYPE PROHIBITION
    // ==========================================
    // 🚨 NEVER MODIFY THESE SETTINGS 🚨
    // These rules enforce zero tolerance for any/unknown types
    // Modification of these settings is STRICTLY PROHIBITED
    // Contact architecture team before any changes
    "strict": true,
    "noImplicitAny": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true
    // ==========================================
  }
}
```

### 2. ESLint Configuration (`.eslintrc.json`)

```json
{
  "rules": {
    // ==========================================
    // CRITICAL POLICY: ANY/UNKNOWN TYPE PROHIBITION
    // ==========================================
    // 🚨 NEVER MODIFY THESE SETTINGS 🚨
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/ban-types": [
      "error",
      {
        "types": {
          "unknown": "❌ PROHIBITED: Use of 'unknown' type is not allowed.",
          "any": "❌ PROHIBITED: Use of 'any' type is not allowed.",
          "{}": "❌ PROHIBITED: Use of '{}' type is not allowed."
        }
      }
    ]
    // ==========================================
  }
}
```

## Enforcement Mechanisms

### Build-Time Enforcement
- **TypeScript Compiler**: Strict mode enabled with zero tolerance for implicit any
- **ESLint**: Error-level rules for explicit any/unknown usage
- **CI/CD Pipeline**: Automatic type checking and linting on all commits

### Development-Time Enforcement
- **IDE Integration**: Real-time error highlighting for policy violations
- **Pre-commit Hooks**: Automatic type checking before commits
- **Code Review**: Manual review required for any type assertions

## Allowed Patterns

### ✅ Specific Interfaces
```typescript
interface UserData {
  name: string;
  age: number;
  email: string;
}
```

### ✅ Union Types
```typescript
type Status = 'pending' | 'completed' | 'failed';
type Value = string | number | boolean;
```

### ✅ Generic Constraints
```typescript
function processData<T extends Record<string, string>>(data: T): T {
  return data;
}
```

### ✅ Branded Types
```typescript
type UserId = string & { __brand: 'UserId' };
type ProductId = string & { __brand: 'ProductId' };
```

### ✅ Conditional Types
```typescript
type ApiResponse<T> = T extends string 
  ? { message: T } 
  : { data: T };
```

### ✅ Type Guards
```typescript
function isValidUser(data: unknown): data is UserData {
  return typeof data === 'object' && 
         data !== null &&
         'name' in data && 
         'age' in data;
}
```

## Prohibited Patterns

### ❌ Explicit Any Usage
```typescript
// PROHIBITED
const data: any = getData();
function process(input: any): any { }
```

### ❌ Unknown Type Usage
```typescript
// PROHIBITED
const result: unknown = apiCall();
function handle(data: unknown): void { }
```

### ❌ Empty Object Type
```typescript
// PROHIBITED
const config: {} = getConfig();
```

### ❌ Type Assertions with Any
```typescript
// PROHIBITED
const value = (response as any).data;
```

### ❌ TypeScript Ignore Comments
```typescript
// PROHIBITED
// @ts-ignore
// @ts-nocheck
```

## Limited Exceptions

### Test Files Only
- `**/*.test.ts` and `**/*.spec.ts` files have limited exceptions
- any/unknown types allowed ONLY for mocking and testing purposes
- This exception must NEVER be extended to production code

```typescript
// ALLOWED IN TEST FILES ONLY
const mockData: any = { /* mock data */ };
```

## Implementation Strategies

### Facade Pattern for Complex Types
```typescript
class TypeSafeWrapper {
  private data: ComplexInternalType;
  
  public getValue(): string {
    return this.processData(this.data);
  }
  
  private processData(data: ComplexInternalType): string {
    // Type-safe processing logic
    return data.toString();
  }
}
```

### Pure Functions for Type Conversion
```typescript
function convertToUserData(input: RawApiResponse): UserData {
  return {
    name: input.user_name,
    age: Number(input.user_age),
    email: input.user_email
  };
}
```

### Utility Types for Common Patterns
```typescript
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type NonNullable<T> = T extends null | undefined ? never : T;
```

## Policy Protection

### Configuration Immutability
- All configuration files contain protection comments
- Settings marked with 🚨 symbols are **STRICTLY PROHIBITED** from modification
- Architecture team approval required for any policy changes

### Code Review Requirements
- All PRs must pass strict type checking with zero errors
- Type assertions require explicit justification in PR description
- Facade patterns and utility functions preferred over type workarounds

### Violation Consequences
- **Build Failures**: Any/unknown usage causes immediate build failure
- **PR Rejection**: Type safety violations result in automatic PR rejection
- **Code Review Escalation**: Policy bypass attempts escalated to architecture team
- **Configuration Changes**: Senior architect approval mandatory

## Cursor Rules Integration

The following Cursor rules have been created to enforce this policy:

1. **typescript-strict-policy.mdc** - Main policy enforcement rule
2. **project-structure.mdc** - Project structure and configuration policies
3. **Additional Type Safety Rules** - Comprehensive type safety guidelines

## Contact Information

- **Type Safety Questions**: Architecture team
- **Policy Exceptions**: Lead developer approval required
- **Configuration Changes**: Senior architect approval mandatory

## Policy History

- **Version 1.0**: Initial policy implementation
- **Date**: Current implementation
- **Status**: ACTIVE and IMMUTABLE

---

**⚠️ WARNING: This policy is non-negotiable and applies to all production code. Any attempts to bypass or modify these settings without proper approval will result in immediate code review escalation.** 