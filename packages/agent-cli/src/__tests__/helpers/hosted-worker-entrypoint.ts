import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { hostedWorkerCliFixture } from './hosted-worker-cli.js';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));

/** Operator-owned pinned template composition; the runtime keeps its installed executor. */
export function pinHostedWorkerCli(
  fixture: Awaited<ReturnType<typeof hostedWorkerCliFixture>>,
  source: string,
): void {
  const entry = join(fixture.worker, 'operator-cli.mts');
  writeFileSync(entry, source);
  const executionPath = join(fixture.f.directory, 'execution.json');
  const config = JSON.parse(readFileSync(executionPath, 'utf8')) as {
    entrypoint: { path: string; digest: string };
  };
  const artifact = readFileSync(config.entrypoint.path, 'utf8').replace(
    JSON.stringify(join(root, 'packages/agent-cli/src/bin.ts')),
    JSON.stringify(entry),
  );
  writeFileSync(config.entrypoint.path, artifact);
  config.entrypoint.digest = createHash('sha256').update(artifact).digest('hex');
  writeFileSync(executionPath, JSON.stringify(config));
}
