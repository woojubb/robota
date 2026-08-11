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

Robota is a pnpm monorepo. The package and app listing lives in
[`.agents/project-structure.md`](.agents/project-structure.md), which owns it — see that document for
the current set and the dependency-direction rules.

A second copy used to live here and had already drifted, naming a package that does not exist; it was
removed rather than re-synchronised, because one owner beats two copies a scan has to keep agreeing.
The reasoning is recorded in `.agents/tasks/completed/HARNESS-068-the-one-owner-rule-has-a-blind-spot.md`.

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
pnpm lint:fix
```

## License

All contributions are provided under the project's dual license (AGPL-3.0 / Commercial); see LICENSING.md.
