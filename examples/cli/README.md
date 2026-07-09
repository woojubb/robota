# robota-example-cli

Node.js CLI script for running AI queries from a terminal or CI pipeline, powered by `@robota-sdk/agent-framework`.

## What this shows

- One-shot AI query with `createQuery`
- Streaming output directly to stdout
- Reading the prompt from argv or stdin (pipe-friendly)

## Quick start

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY

npm install

# run directly with tsx (no build needed)
npx tsx src/index.ts "List all environment variables that start with NODE"

# or build first
npm run build
node dist/index.js "Summarise the contents of package.json"
```

## Pipe mode (CI/CD)

```bash
cat error.log | node dist/index.js
echo "Generate a changelog entry for today" | node dist/index.js
```

## GitHub Actions example

```yaml
- name: AI code review
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    git diff HEAD~1 | node dist/index.js \
      "Review this diff for bugs and security issues. Be concise."
```

## Swap provider

In `src/index.ts`, replace `AnthropicProvider`:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
return new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
```
