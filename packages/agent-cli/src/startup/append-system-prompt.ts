import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IParsedCliArgs } from '../utils/cli-args.js';

function readTaskFilePrompt(cwd: string, taskFile: string): string {
  const taskPath = resolve(cwd, taskFile);
  const content = readFileSync(taskPath, 'utf8').trim();
  if (content.length === 0) {
    throw new Error(`Task file is empty: ${taskFile}`);
  }
  return `Task file (${taskFile}):\n${content}`;
}

export function buildAppendSystemPrompt(cwd: string, args: IParsedCliArgs): string | undefined {
  const appendParts: string[] = [];
  if (args.appendSystemPrompt) appendParts.push(args.appendSystemPrompt);
  if (args.taskFile) {
    try {
      appendParts.push(readTaskFilePrompt(cwd, args.taskFile));
    } catch (error) {
      // allow-fallback: terminal failure — task file read failure exits process
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
  if (args.jsonSchema)
    appendParts.push(
      `Respond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`,
    );
  return appendParts.length > 0 ? appendParts.join('\n\n') : undefined;
}
