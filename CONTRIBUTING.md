# Contributing Guidelines

Thank you for contributing to the Robota project! This document provides guidelines on how to contribute to the project.

## Development Environment Setup

1. Clone the repository:

```bash
git clone https://github.com/woojubb/robota.git
cd robota
```

2. Install dependencies:

```bash
pnpm install
```

3. Run development server:

```bash
pnpm dev
```

## Project Structure

Robota is a pnpm monorepo. The main packages are:

- `packages/agent-core` — Core agent runtime, abstractions, and plugin system
- `packages/agent-framework` — Assembly layer: `InteractiveSession`, `createQuery()`, config/context loading
- `packages/agent-session` — Session lifecycle: permissions, hooks, context-window compaction
- `packages/agent-tools` — Tool infrastructure + 8 built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch)
- `packages/agent-provider` — Consolidated AI providers (Anthropic, OpenAI, Gemini, DeepSeek, Gemma, Qwen, ByteDance)
- `packages/agent-cli` — Interactive terminal AI coding assistant
- `packages/agent-command` — Slash command modules (/agent, /help, /provider, /skills, /plugin, …)
- `packages/agent-transport` — Transport adapters (TUI, headless, HTTP, WebSocket, MCP)
- `apps/docs` — VitePress documentation site
- `apps/www` — Marketing website
- `apps/agent-web` — Web playground

## Developing New Features

1. Create a new branch:

```bash
git checkout -b feature/your-feature-name
```

2. Write code and run tests:

```bash
pnpm test
```

3. Commit and push:

```bash
git add .
git commit -m "feat: your description"
git push origin feature/your-feature-name
```

4. Submit a Pull Request

## Commit Message Convention

Commit messages should follow this format:

- `feat`: Add new feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting, missing semicolons, etc. (no code changes)
- `refactor`: Code refactoring
- `test`: Test-related code
- `chore`: Build process or auxiliary tool changes

### Guidelines:

- Keep commit messages under 80 characters
- Use English for all commit messages
- Write in present tense (e.g., "add feature" not "added feature")
- Be concise but descriptive

Examples:

- ✅ `feat: add gpt-4o model support to OpenAI provider`
- ✅ `fix: resolve memory leak in cache manager`
- ❌ `feat: add gpt-4o model support to OpenAI provider with comprehensive error handling and validation` (too long)

## Pull Request Guidelines

1. Clear title and description
2. Link related issues
3. Include tests for changes
4. Update documentation (if necessary)

## Code Style

- The project uses ESLint and Prettier.
- Check code style before committing:

```bash
pnpm lint
pnpm format
```

## License

All contributions are provided under the project's MIT license.
