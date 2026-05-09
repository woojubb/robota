import { executeUserLocalDirectCommand } from '@robota-sdk/agent-command-user-local';
import type { IParsedCliArgs } from './utils/cli-args.js';

export async function runUserLocalDirectCommandIfRequested(
  args: IParsedCliArgs,
  cwd: string,
): Promise<boolean> {
  if (args.positional[0] !== 'user-local') {
    return false;
  }

  const result = await executeUserLocalDirectCommand({
    cwd,
    argv: args.positional.slice(1),
    format: args.format,
    summary: args.summary,
    source: args.source,
  });
  const output = result.message.endsWith('\n') ? result.message : `${result.message}\n`;
  if (!result.success) {
    process.stderr.write(output);
    process.exit(1);
  }
  process.stdout.write(output);
  return true;
}
