import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Resolve an ESM import from the CLI boundary, including under Vitest's transformed import.meta. */
export function resolveSdk(name: string): string {
  const result = spawnSync(process.execPath, [
    '--input-type=module', '--eval', 'process.stdout.write(import.meta.resolve(process.argv[1]))', name,
  ], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}
