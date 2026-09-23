/**
 * Issue #2429 — a relative `filePath` given to `Read`/`Write`/`Edit` anchors to the containment
 * root, not to `process.cwd()`, the way `resolveSearchRoot` already anchors `Glob`/`Grep`.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createEditTool } from '../edit-tool.js';
import { resolveHostPath } from '../path-guard.js';
import { createReadTool } from '../read-tool.js';
import { createWriteTool } from '../write-tool.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-2429-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface IInvocation {
  success: boolean;
  output: string;
  error?: string;
}

async function invoke(
  tool: { execute: (args: never) => Promise<unknown> },
  args: object,
): Promise<IInvocation> {
  const result = (await tool.execute(args as never)) as { data: string };
  return JSON.parse(result.data) as IInvocation;
}

describe('a relative filePath anchors to the containment root (issue #2429)', () => {
  it('resolveHostPath joins a relative path onto the root and keeps an absolute one', () => {
    expect(resolveHostPath('a/b.txt', '/root')).toBe('/root/a/b.txt');
    expect(resolveHostPath('/abs/b.txt', '/root')).toBe('/abs/b.txt');
    expect(resolveHostPath('a/b.txt', undefined)).toBe('a/b.txt');
  });

  it('Read opens <root>/<relative>, wherever the process runs', async () => {
    writeFileSync(join(root, 'probe.txt'), 'PROBE-2429\n');
    const read = createReadTool({ cwd: root });
    const result = await invoke(read, { filePath: 'probe.txt' });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toContain('PROBE-2429');
  });

  it('Write and Edit act on <root>/<relative>', async () => {
    const write = createWriteTool({ cwd: root });
    const written = await invoke(write, { filePath: 'out.txt', content: 'alpha\n' });
    expect(written.success, written.error).toBe(true);
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('alpha\n');

    const edit = createEditTool({ cwd: root });
    const edited = await invoke(edit, {
      filePath: 'out.txt',
      oldString: 'alpha',
      newString: 'beta',
    });
    expect(edited.success, edited.error).toBe(true);
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('beta\n');
  });

  it('a relative path that escapes the root is still refused', async () => {
    const read = createReadTool({ cwd: root });
    const result = await invoke(read, { filePath: '../../../../etc/hostname' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the working directory/);
  });
});
