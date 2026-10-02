import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createProductSubagentComposition } from '../subagent-composition.js';
import type { IHookInput, IHookTypeExecutor } from '@robota-sdk/agent-core';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'worker-hooks-'));
  roots.push(cwd);
  const input = { hook_event_name: 'PreToolUse', session_id: 'fixture', cwd } as IHookInput;
  const composition = createProductSubagentComposition(createTestProductRuntime());
  return { cwd, input, composition };
}
function executor(executors: IHookTypeExecutor[], type: 'command' | 'http') {
  return executors.find((candidate) => candidate.type === type)!;
}

describe('separate-worker hooks cannot execute on the host', () => {
  it.each(['separate', undefined] as const)(
    'refuses a command hook for filesystem %s before any host effect',
    async (filesystem) => {
      const { cwd, input, composition } = fixture();
      const file = join(cwd, 'host-effect');
      const hooks = composition.createHookTypeExecutors!({ cwd, sandboxClient: { filesystem } });
      const result = await executor(hooks, 'command').execute(
        { type: 'command', command: `printf escaped > '${file}'` },
        input,
      );
      expect(existsSync(file)).toBe(false);
      expect(result).toMatchObject({ outcome: 'error', source: 'command', kind: 'spawn-failure' });
      expect('reason' in result && result.reason).toMatch(/separate.*worker.*unsupported/i);
    },
  );

  it('refuses an HTTP hook before opening a host connection', async () => {
    const { cwd, input, composition } = fixture();
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const hooks = composition.createHookTypeExecutors!({ cwd, sandboxClient: {} });
      const result = await executor(hooks, 'http').execute(
        { type: 'http', url: `http://127.0.0.1:${port}/hook` },
        input,
      );
      expect(requests).toBe(0);
      expect(result).toMatchObject({ outcome: 'error', source: 'http', kind: 'spawn-failure' });
      const localHooks = composition.createHookTypeExecutors!({ cwd });
      await executor(localHooks, 'http').execute(
        { type: 'http', url: `http://127.0.0.1:${port}/control` },
        input,
      );
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each(['local', 'shared'] as const)(
    'retains %s command hooks as a positive control',
    async (mode) => {
      const { cwd, input, composition } = fixture();
      const hooks = composition.createHookTypeExecutors!({
        cwd,
        ...(mode === 'shared' ? { sandboxClient: { filesystem: 'shared' } } : {}),
      });
      const result = await executor(hooks, 'command').execute(
        { type: 'command', command: 'printf healthy' },
        input,
      );
      expect(result).toEqual({ outcome: 'allow', source: 'command', stdout: 'healthy' });
    },
  );
});
