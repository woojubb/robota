import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IDocumentResult } from './processor.js';

const OUTPUT_DIR = 'output';

function toMarkdown(results: IDocumentResult[]): string {
  const lines: string[] = [
    '# Batch Processing Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Documents processed: ${results.length}`,
    '',
    '---',
    '',
  ];

  for (const r of results) {
    lines.push(
      `## ${r.filename}`,
      '',
      `**Processed at:** ${r.processedAt}`,
      `**Sentiment:** ${r.sentiment}`,
      '',
      `**Summary:** ${r.summary}`,
      '',
      `**Keywords:** ${r.keywords.join(', ')}`,
      '',
      '---',
      '',
    );
  }

  return lines.join('\n');
}

export async function generateReport(results: IDocumentResult[]): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const jsonPath = join(OUTPUT_DIR, 'report.json');
  const mdPath = join(OUTPUT_DIR, 'report.md');

  await writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
  await writeFile(mdPath, toMarkdown(results), 'utf-8');

  console.log(`\nReport written to ${jsonPath} and ${mdPath}`);
}
