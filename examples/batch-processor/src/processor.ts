import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

export interface IDocumentResult {
  filename: string;
  summary: string;
  keywords: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  processedAt: string;
}

interface IRawAnalysis {
  summary: string;
  keywords: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

function parseAnalysis(raw: string): IRawAnalysis {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Response did not contain a JSON object');
  }
  const parsed: unknown = JSON.parse(jsonMatch[0]);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['summary'] !== 'string' ||
    !Array.isArray((parsed as Record<string, unknown>)['keywords']) ||
    !['positive', 'neutral', 'negative'].includes(
      String((parsed as Record<string, unknown>)['sentiment']),
    )
  ) {
    throw new Error('Response JSON is missing required fields');
  }
  return parsed as IRawAnalysis;
}

export async function processDocument(filePath: string): Promise<IDocumentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  const content = await readFile(filePath, 'utf-8');

  const query = createQuery({
    provider: new AnthropicProvider({ apiKey }),
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
  });

  const prompt =
    `Analyze this document and respond with ONLY a JSON object with fields: ` +
    `summary (string), keywords (string[]), sentiment ('positive'|'neutral'|'negative'). ` +
    `Document:\n${content}`;

  const raw = await query(prompt);
  const analysis = parseAnalysis(raw);

  return {
    filename: basename(filePath),
    summary: analysis.summary,
    keywords: analysis.keywords,
    sentiment: analysis.sentiment,
    processedAt: new Date().toISOString(),
  };
}
