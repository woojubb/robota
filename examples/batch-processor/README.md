# batch-processor

Parallel batch document processor that uses AI to summarize, extract keywords, and determine sentiment for a set of Markdown files.

## Features

- Discovers all `.md` files in `sample-docs/` automatically
- Processes documents in parallel (max 3 concurrent) using `p-limit`
- Each document gets its own `createQuery` instance (`maxTurns: 1`)
- Writes `output/report.json` and `output/report.md` on completion

## Setup

```bash
cd examples/batch-processor
npm install          # or pnpm install

export ANTHROPIC_API_KEY=your-key
```

The script reads `ANTHROPIC_API_KEY` from the environment and does not load `.env` itself. To keep the key in
a file, copy `.env.example` to `.env` and run with Node's `--env-file` flag instead:
`npx tsx --env-file=.env src/index.ts`.

## Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Progress is printed as each document completes:

```
Found 3 document(s). Processing with concurrency=3…

[1/3] doc2.md — neutral
[2/3] doc1.md — positive
[3/3] doc3.md — neutral

Report written to output/report.json and output/report.md
```

`output/` is created in the directory you run the command from.

## Output

`output/report.json` — array of result objects:

```json
[
  {
    "filename": "doc1.md",
    "summary": "...",
    "keywords": ["TypeScript", "strict mode", "compiler"],
    "sentiment": "positive",
    "processedAt": "2026-05-25T10:00:00.000Z"
  }
]
```

`output/report.md` — human-readable Markdown report.

## Add your own documents

Drop any `.md` file into `sample-docs/` and re-run. The processor discovers all `.md` files in that directory automatically.
