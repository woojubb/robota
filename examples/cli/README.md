# robota-example-cli

Node.js CLI script for running AI queries from a terminal or CI pipeline, powered by `@robota-sdk/agent-framework`.

## What this shows

- One-shot AI query with `createQuery`
- Streaming output directly to stdout
- Reading the prompt from argv, or from stdin when no argument is given (pipe-friendly)

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=your-key

# run directly with tsx (no build needed)
npm run dev -- "Summarise the contents of package.json"

# or build first
npm run build
node dist/index.js "Explain what this project's tsconfig.json enables"
```

The script reads `ANTHROPIC_API_KEY` from the environment and does not load `.env` itself. To keep the key in
a file, copy `.env.example` to `.env` and pass Node's `--env-file` flag:
`node --env-file=.env dist/index.js "..."`.

## What the agent may do

`createQuery` runs the agent with the default tool set in the current directory, in the `default` permission
mode and with no permission handler. Read-only tools (`Read`, `Glob`, `Grep`, read-only shell commands) run;
anything that would ask for approval — writing files, other shell commands — is denied. Pass a
`permissionHandler` (or another `permissionMode`) to `createQuery` in `src/index.ts` to change that.

## Pipe mode (CI/CD)

When no argument is given, the whole prompt is read from stdin. An argument takes precedence, and stdin is
then ignored — so put the instruction and the input on stdin together:

```bash
cat error.log | node dist/index.js
{ echo "Explain the errors in this log:"; cat error.log; } | node dist/index.js
```

## GitHub Actions example

Build the script first, and check out at least two commits (`fetch-depth: 2`) so `HEAD~1` exists:

```yaml
- name: AI code review
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    { echo "Review this diff for bugs and security issues. Be concise."; git diff HEAD~1; } \
      | node dist/index.js
```

## Swap provider

Install the provider package and return it from `resolveProvider()` in `src/index.ts`:

```bash
npm install @robota-sdk/agent-provider-openai
```

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

return new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
```
