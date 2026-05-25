#!/usr/bin/env node
/**
 * Robota SDK — CLI script example
 *
 * Usage:
 *   node dist/index.js "your prompt here"
 *   echo "your prompt" | node dist/index.js
 *
 * Environment:
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   OPENAI_API_KEY      — OpenAI API key (if using OpenAI)
 */

import { createInterface } from 'node:readline';
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

function resolveProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  console.error('Error: set ANTHROPIC_API_KEY (or swap to OpenAIProvider with OPENAI_API_KEY)');
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const lines: string[] = [];
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join('\n').trim();
}

async function main(): Promise<void> {
  const argPrompt = process.argv.slice(2).join(' ').trim();
  const prompt = argPrompt.length > 0 ? argPrompt : process.stdin.isTTY ? '' : await readStdin();

  if (!prompt) {
    console.error('Usage: node dist/index.js "<prompt>"');
    console.error('   or: echo "<prompt>" | node dist/index.js');
    process.exit(1);
  }

  const query = createQuery({
    provider: resolveProvider(),
    onTextDelta: (delta) => process.stdout.write(delta),
  });

  await query(prompt);
  process.stdout.write('\n');
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nError: ${msg}\n`);
  process.exit(1);
});
