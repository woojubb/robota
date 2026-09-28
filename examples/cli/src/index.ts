#!/usr/bin/env node
/**
 * Robota SDK — CLI script example
 *
 * Usage:
 *   node dist/index.js "your prompt here"
 *   echo "your prompt" | node dist/index.js
 *   git diff | node dist/index.js "review this diff"   (the piped text follows the prompt)
 *
 * Environment:
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   OPENAI_API_KEY      — OpenAI API key (if using OpenAI)
 */

import './load-env.js';
import { fstatSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

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

/** A shell pipe or a redirected file ends; a parent process's open stdin socket may never. */
function stdinIsPipedData(): boolean {
  const stat = fstatSync(0);
  return stat.isFIFO() || stat.isFile();
}

async function main(): Promise<void> {
  const argPrompt = process.argv.slice(2).join(' ').trim();
  // Piped text follows the prompt argument. With an argument, stdin is read only when it is a pipe
  // or a file, so a parent that spawns this with an open stdin does not hang it.
  const readsStdin = !process.stdin.isTTY && (argPrompt === '' || stdinIsPipedData());
  const piped = readsStdin ? await readStdin() : '';
  const prompt = [argPrompt, piped].filter((part) => part.length > 0).join('\n\n');

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
