import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pLimit from 'p-limit';
import { processDocument } from './processor.js';
import { generateReport } from './reporter.js';
import type { IDocumentResult } from './processor.js';

const SAMPLE_DOCS_DIR = resolve(import.meta.dirname, '..', 'sample-docs');
const CONCURRENCY = 3;

async function discoverDocuments(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(dir, e.name))
    .sort();
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const files = await discoverDocuments(SAMPLE_DOCS_DIR);
  if (files.length === 0) {
    console.error(`No .md files found in ${SAMPLE_DOCS_DIR}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} document(s). Processing with concurrency=${CONCURRENCY}…\n`);

  const limit = pLimit(CONCURRENCY);
  let completed = 0;

  const tasks = files.map((filePath) =>
    limit(async (): Promise<IDocumentResult> => {
      const result = await processDocument(filePath);
      completed++;
      console.log(`[${completed}/${files.length}] ${result.filename} — ${result.sentiment}`);
      return result;
    }),
  );

  const results = await Promise.all(tasks);

  await generateReport(results);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nError: ${msg}\n`);
  process.exit(1);
});
