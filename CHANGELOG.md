# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.1] - 2025-01-06

### 🚨 Breaking Changes

#### Architecture Overhaul
- **Plugin-Module Separation**: Complete separation of plugin and module systems for better modularity
- **Provider Implementation**: All AI providers now must extend `BaseAIProvider` from `@robota-sdk/agents`
- **Type System**: Strict TypeScript enforcement with zero tolerance for `any`/`unknown` types
- **Import Paths**: Updated import paths for all public APIs

#### Deprecated Packages
- `@robota-sdk/core` - Functionality moved to `@robota-sdk/agents`
- `@robota-sdk/tools` - Integrated into `@robota-sdk/agents`

### ✨ Added

#### Core Features
- **BaseAIProvider**: New abstract base class for all AI provider implementations
- **Type-Safe Architecture**: Complete type safety across all packages
- **Plugin System**: Enhanced plugin architecture with lifecycle hooks
- **Module Registry**: New module registration and management system
- **Event System**: Comprehensive event emitter for all agent operations

#### Documentation
- **API Reference**: Auto-generated TypeDoc documentation for all packages
- **Migration Guide**: Comprehensive guide for upgrading from v1.x
- **Provider Guidelines**: Clear implementation guidelines for AI providers

#### Development
- **Cursor Rules**: Added development rules for consistent coding practices
- **TypeScript Policy**: Documented strict TypeScript policies
- **Research Documentation**: Guidelines for documenting API-specific behaviors

### 🐛 Fixed

#### Provider Issues
- **OpenAI**: Fixed content handling for tool calls (null vs empty string)
- **Anthropic**: Corrected API-specific content requirements
- **Google**: Resolved Gemini API type compatibility issues

#### Type Safety
- Eliminated all `any` and `unknown` types across the codebase
- Fixed type inference issues in generic implementations
- Resolved circular dependency type errors

#### Build System
- Fixed ESM/CJS dual package exports
- Corrected TypeScript configuration for test files
- Resolved workspace dependency resolution issues

### 🔧 Changed

#### Package Structure
- Reorganized package exports for better tree-shaking
- Updated build configuration for optimal bundle sizes
- Improved TypeScript declaration file generation

#### API Improvements
- Standardized error handling across all providers
- Unified message format handling
- Consistent metadata structure

#### Testing
- Enhanced test coverage for all packages
- Added provider-specific integration tests
- Improved test file organization

### 📦 Dependencies

#### Updated
- `@anthropic-ai/sdk`: Latest version
- `@google/generative-ai`: Latest version
- `openai`: Latest version
- TypeScript: 5.3.3

#### Security
- Addressed development dependency vulnerabilities
- No production security issues

### 📝 Documentation

- Complete API reference documentation
- Updated README files for all packages
- Enhanced inline code documentation
- Added provider-specific implementation notes

### 🏗️ Infrastructure

- GitHub Actions workflow improvements
- Documentation build automation
- Release process standardization
- Monorepo structure optimization

## Migration Guide

### From v1.x to v2.0.0-rc.1

1. **Update Imports**:
   ```typescript
   // Old
   import { Agent } from '@robota-sdk/core';
   
   // New
   import { Robota } from '@robota-sdk/agents';
   ```

2. **Provider Implementation**:
   ```typescript
   // All providers must now extend BaseAIProvider
   export class MyProvider extends BaseAIProvider {
     // Implementation
   }
   ```

3. **Deprecated Packages**:
   - Replace `@robota-sdk/core` with `@robota-sdk/agents`
   - Replace `@robota-sdk/tools` with tool functionality in `@robota-sdk/agents`

4. **Type Updates**:
   - Remove all `any` types and replace with specific types
   - Update `unknown` types to proper type definitions

For detailed migration instructions, see the [Migration Guide](./docs/migration-guide.md).

---

[2.0.0-rc.1]: https://github.com/woojubb/robota/releases/tag/v2.0.0-rc.1 