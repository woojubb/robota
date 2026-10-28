/**
 * Issue #3550 item 4 — the product's own tool surface under a real permission gate: an editor slot
 * makes Read, Write and Edit go through the editor only after the gate allowed the call, and a call
 * the gate refuses never reaches the editor.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PermissionEnforcer } from '@robota-sdk/agent-session';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createEditorFileSlot } from '../editor-file-slot.js';
import { createProductPackSet } from '../subagent-composition.js';

import type { IToolWithEventService, ITerminalOutput } from '@robota-sdk/agent-core';
import type { TPermissionHandler } from '@robota-sdk/agent-session';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cli-editor-files-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, 'probe.txt'), 'DISK alpha\n');

const terminal: ITerminalOutput = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

/** The product's tools for `root`, behind a permission gate whose answers the test gives. */
function gatedTools(answer: boolean, deny: string[] = []) {
  const events: string[] = [];
  const slot = createEditorFileSlot();
  slot.set({
    pathAuthority: 'stable-root',
    readTextFile: async (path) => {
      events.push(`editor read ${path}`);
      return 'BUFFER alpha\n';
    },
    writeTextFile: async (path, content) => {
      events.push(`editor write ${path} ${JSON.stringify(content)}`);
    },
  });
  const { packs } = createProductPackSet(root, createTestProductRuntime(), {
    editorFiles: slot.current,
  });
  const handler: TPermissionHandler = async (toolName) => {
    events.push(`asked ${toolName}`);
    return answer;
  };
  const enforcer = new PermissionEnforcer({
    sessionId: 'editor-files',
    cwd: root,
    getPermissionMode: () => 'default',
    config: { permissions: { allow: [], deny } },
    terminal,
    permissionHandler: handler,
  });
  const tools = enforcer.wrapTools(packs.flatMap((pack) => [...(pack.tools ?? [])]) as IToolWithEventService[]);
  const run = async (name: string, parameters: Record<string, unknown>) => {
    const tool = tools.find((candidate) => candidate.getName() === name)!;
    const result = await tool.execute(parameters as never, {
      toolName: name,
      parameters,
      executionId: `call-${name}`,
    } as never);
    return result;
  };
  return { events, run };
}

describe('editor delegation under the permission gate', () => {
  it('writes through the editor only after the gate allowed the Write', async () => {
    const { events, run } = gatedTools(true);
    await run('Write', { filePath: join(root, 'new.txt'), content: 'NEW' });
    expect(events).toEqual(['asked Write', `editor write ${join(root, 'new.txt')} "NEW"`]);
    expect(existsSync(join(root, 'new.txt'))).toBe(false);
  });

  it("edits the editor's text only after the gate allowed the Edit", async () => {
    const { events, run } = gatedTools(true);
    await run('Edit', { filePath: join(root, 'probe.txt'), oldString: 'BUFFER', newString: 'EDITED' });
    expect(events).toEqual([
      'asked Edit',
      `editor read ${join(root, 'probe.txt')}`,
      `editor write ${join(root, 'probe.txt')} "EDITED alpha\\n"`,
    ]);
  });

  it('a refused Write or Edit never reaches the editor', async () => {
    const { events, run } = gatedTools(false);
    await run('Write', { filePath: join(root, 'refused.txt'), content: 'NO' });
    await run('Edit', { filePath: join(root, 'probe.txt'), oldString: 'alpha', newString: 'beta' });
    expect(events).toEqual(['asked Write', 'asked Edit']);
    expect(existsSync(join(root, 'refused.txt'))).toBe(false);
  });

  it('a Read the rules deny never reaches the editor; an allowed one reads the buffer', async () => {
    const denied = gatedTools(true, ['Read']);
    await denied.run('Read', { filePath: join(root, 'probe.txt') });
    expect(denied.events.filter((event) => event.startsWith('editor'))).toEqual([]);

    const allowed = gatedTools(true);
    const result = await allowed.run('Read', { filePath: join(root, 'probe.txt') });
    expect(JSON.stringify(result)).toContain('BUFFER alpha');
    expect(allowed.events.filter((event) => event.startsWith('editor'))).toEqual([
      `editor read ${join(root, 'probe.txt')}`,
    ]);
  });

  it('a path outside the root never reaches the editor, even when the gate allows it', async () => {
    const { events, run } = gatedTools(true);
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'cli-editor-outside-')));
    try {
      await run('Write', { filePath: join(outside, 'x.txt'), content: 'x' });
      await run('Read', { filePath: join(outside, 'x.txt') });
      expect(events.filter((event) => event.startsWith('editor'))).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
