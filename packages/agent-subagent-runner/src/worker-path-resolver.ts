import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getDefaultSubagentWorkerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'child-process-subagent-worker.js');
}
