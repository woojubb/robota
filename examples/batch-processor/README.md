# batch-processor

Parallel batch document processor that uses AI to summarize, extract keywords, and determine sentiment for a set of Markdown files.

## Features

- Discovers all `.md` files in `sample-docs/` automatically
- Processes documents in parallel (max 3 concurrent) using `p-limit`
- Each document gets its own `createQuery` instance
- Writes `output/report.json` and `output/report.md` on completion

## Setup

```bash
cd examples/batch-processor
npm install          # or pnpm install

cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

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
