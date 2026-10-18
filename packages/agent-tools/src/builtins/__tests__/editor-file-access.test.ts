/**
 * Issue #3550 item 4 — an editor that has the workspace open carries `Read`/`Write`/`Edit`, after the
 * tool's own path guard; `Glob`/`Grep` keep the disk and say so; without an editor nothing changes.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEditTool } from '../edit-tool.js';
import { createGlobTool } from '../glob-tool.js';
import { createGrepTool } from '../grep-tool.js';
import { createReadTool, ReadByteLimitError } from '../read-tool.js';
import { createWriteTool } from '../write-tool.js';

import type { IEditorFileAccess } from '../editor-files.js';
import type { ISandboxClient } from '../../sandbox/types.js';
import type { IToolExecutionContext } from '@robota-sdk/agent-core';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-editor-files-')));
const root = join(scratch, 'root');
const outside = join(scratch, 'outside');
mkdirSync(root);
mkdirSync(outside);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface IInvocation {
  success: boolean;
  output: string;
  error?: string;
}

async function invoke(
  tool: { execute: (args: never, context?: IToolExecutionContext) => Promise<unknown> },
  args: object,
  context?: Partial<IToolExecutionContext>,
): Promise<IInvocation> {
  const result = (await tool.execute(args as never, context as IToolExecutionContext)) as {
    data: string;
  };
  return JSON.parse(result.data) as IInvocation;
}

/** An editor whose buffers differ from the disk, recording every request it receives. */
function editor(buffers: Record<string, string>, offer: { reads?: boolean; writes?: boolean } = {}) {
  const reads: { path: string; signal?: AbortSignal }[] = [];
  const writes: { path: string; content: string }[] = [];
  const access: IEditorFileAccess = {
    ...(offer.reads !== false
      ? {
          readTextFile: async (path: string, signal?: AbortSignal) => {
            reads.push({ path, ...(signal ? { signal } : {}) });
            const text = buffers[path];
            if (text === undefined) throw new Error(`no buffer for ${path}`);
            return text;
          },
        }
      : {}),
    ...(offer.writes !== false
      ? {
          writeTextFile: async (path: string, content: string) => {
            writes.push({ path, content });
            buffers[path] = content;
          },
        }
      : {}),
  };
  return { access, reads, writes, editorFiles: () => access };
}

const probe = join(root, 'probe.txt');
beforeEach(() => {
  writeFileSync(probe, 'DISK alpha\n');
  rmSync(join(root, 'new.txt'), { force: true });
});

describe('Read through the editor', () => {
  it("returns the editor's text for an admitted path, resolved against the root", async () => {
    const ed = editor({ [probe]: 'BUFFER alpha\nunsaved line\n' });
    const result = await invoke(createReadTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: 'probe.txt',
    });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toContain('BUFFER alpha');
    expect(result.output).toContain('unsaved line');
    expect(result.output).not.toContain('DISK');
    expect(ed.reads.map((r) => r.path)).toEqual([probe]);
  });

  it('applies offset and limit to the editor text as it does to the disk', async () => {
    const ed = editor({ [probe]: 'one\ntwo\nthree\n' });
    const result = await invoke(createReadTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: probe,
      offset: 2,
      limit: 1,
    });
    expect(result.output).toBe(`[File: ${probe} (lines 2-2 of 3)]\n2\ttwo`);
  });

  it('never asks the editor for a path outside the root', async () => {
    const secret = join(outside, 'secret.txt');
    writeFileSync(secret, 'SECRET');
    const ed = editor({ [secret]: 'SECRET' });
    const result = await invoke(createReadTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: secret,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
    expect(ed.reads).toEqual([]);
  });

  it('reads the disk when no editor is attached or it offers no reads', async () => {
    for (const editorFiles of [undefined, () => undefined, editor({}, { reads: false }).editorFiles]) {
      const result = await invoke(createReadTool({ cwd: root, ...(editorFiles ? { editorFiles } : {}) }), {
        filePath: probe,
      });
      expect(result.output).toContain('DISK alpha');
    }
  });

  it("surfaces the editor's failure as the tool's error", async () => {
    const ed = editor({});
    const result = await invoke(createReadTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: probe,
    });
    expect(result).toEqual({
      success: false,
      output: '',
      error: `The editor could not read ${probe}: no buffer for ${probe}`,
    });
  });

  it('keeps the binary refusal and the input budget for editor text', async () => {
    const binary = editor({ [probe]: 'a\0b' });
    const refused = await invoke(createReadTool({ cwd: root, editorFiles: binary.editorFiles }), {
      filePath: probe,
    });
    expect(refused.error).toBe(`Binary file not supported: ${probe}`);

    const huge = editor({ [probe]: 'x'.repeat(4 * 1024 * 1024 + 1) });
    await expect(
      createReadTool({ cwd: root, editorFiles: huge.editorFiles }).execute({ filePath: probe }),
    ).rejects.toBeInstanceOf(ReadByteLimitError);
  });

  it("hands the call's signal to the editor request", async () => {
    const ed = editor({ [probe]: 'BUFFER\n' });
    const controller = new AbortController();
    await invoke(
      createReadTool({ cwd: root, editorFiles: ed.editorFiles }),
      { filePath: probe },
      { signal: controller.signal },
    );
    expect(ed.reads[0]?.signal?.aborted).toBe(false);
    controller.abort();
    expect(ed.reads[0]?.signal?.aborted).toBe(true);
  });

  it('leaves a separate sandbox filesystem to the sandbox', async () => {
    const ed = editor({ [probe]: 'BUFFER' });
    const sandboxClient = {
      filesystem: 'separate',
      run: vi.fn(),
      readFile: vi.fn(async () => 'SANDBOX\n'),
      writeFile: vi.fn(),
    } as unknown as ISandboxClient;
    const result = await invoke(
      createReadTool({ cwd: root, sandboxClient, editorFiles: ed.editorFiles }),
      { filePath: probe },
    );
    expect(result.output).toContain('SANDBOX');
    expect(ed.reads).toEqual([]);
  });
});

describe('Write through the editor', () => {
  it('hands the content to the editor and leaves the disk alone', async () => {
    const ed = editor({});
    const target = join(root, 'new.txt');
    const result = await invoke(createWriteTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: 'new.txt',
      content: 'héllo\n',
    });
    expect(result).toEqual({ success: true, output: `Written 7 bytes to ${target}` });
    expect(ed.writes).toEqual([{ path: target, content: 'héllo\n' }]);
    expect(existsSync(target)).toBe(false);
  });

  it('never hands the editor a path outside the root', async () => {
    const ed = editor({});
    const result = await invoke(createWriteTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: join(outside, 'escape.txt'),
      content: 'x',
    });
    expect(result.success).toBe(false);
    expect(ed.writes).toEqual([]);
    expect(existsSync(join(outside, 'escape.txt'))).toBe(false);
  });

  it("surfaces the editor's failure as the tool's error", async () => {
    const editorFiles = () => ({
      writeTextFile: async () => {
        throw new Error('Internal error: read-only buffer');
      },
    });
    const result = await invoke(createWriteTool({ cwd: root, editorFiles }), {
      filePath: probe,
      content: 'x',
    });
    expect(result).toEqual({
      success: false,
      output: '',
      error: `The editor could not write ${probe}: Internal error: read-only buffer`,
    });
    expect(readFileSync(probe, 'utf8')).toBe('DISK alpha\n');
  });

  it('writes the disk when the editor offers no writes', async () => {
    const ed = editor({}, { writes: false });
    const target = join(root, 'new.txt');
    await invoke(createWriteTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: target,
      content: 'on disk\n',
    });
    expect(readFileSync(target, 'utf8')).toBe('on disk\n');
  });
});

describe('Edit through the editor', () => {
  it("edits the editor's text and writes it back through the editor", async () => {
    const ed = editor({ [probe]: 'BUFFER alpha\nunsaved\n' });
    const result = await invoke(createEditTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: probe,
      oldString: 'unsaved',
      newString: 'edited',
    });
    expect(result.success, result.error).toBe(true);
    expect(ed.writes).toEqual([{ path: probe, content: 'BUFFER alpha\nedited\n' }]);
    expect(readFileSync(probe, 'utf8')).toBe('DISK alpha\n');
  });

  it('edits the disk text when the editor offers only writes, and writes through the editor', async () => {
    const ed = editor({}, { reads: false });
    const result = await invoke(createEditTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: probe,
      oldString: 'DISK',
      newString: 'EDITED',
    });
    expect(result.success, result.error).toBe(true);
    expect(ed.writes).toEqual([{ path: probe, content: 'EDITED alpha\n' }]);
  });

  it('never asks the editor about a path outside the root', async () => {
    const ed = editor({});
    const result = await invoke(createEditTool({ cwd: root, editorFiles: ed.editorFiles }), {
      filePath: join(outside, 'secret.txt'),
      oldString: 'a',
      newString: 'b',
    });
    expect(result.success).toBe(false);
    expect(ed.reads).toEqual([]);
    expect(ed.writes).toEqual([]);
  });

  it("surfaces the editor's read and write failures as the tool's error", async () => {
    const unreadable = editor({});
    const read = await invoke(createEditTool({ cwd: root, editorFiles: unreadable.editorFiles }), {
      filePath: probe,
      oldString: 'a',
      newString: 'b',
    });
    expect(read.error).toBe(`The editor could not read ${probe}: no buffer for ${probe}`);

    const editorFiles = () => ({
      readTextFile: async () => 'alpha',
      writeTextFile: async () => {
        throw new Error('closed');
      },
    });
    const write = await invoke(createEditTool({ cwd: root, editorFiles }), {
      filePath: probe,
      oldString: 'alpha',
      newString: 'beta',
    });
    expect(write.error).toBe(`The editor could not write ${probe}: closed`);
  });
});

describe('Glob and Grep with an editor attached', () => {
  const notice =
    '[Searched the files on disk. The editor may hold changes to them that are not saved yet, which this search does not see.';

  it('search the disk and say so', async () => {
    const ed = editor({ [probe]: 'nothing here' });
    const grep = await invoke(createGrepTool({ cwd: root, editorFiles: ed.editorFiles }), {
      pattern: 'DISK',
    });
    expect(grep.output).toBe(
      `${probe}\n\n${notice} Read returns a file as the editor has it.]`,
    );
    const glob = await invoke(createGlobTool({ cwd: root, editorFiles: ed.editorFiles }), {
      pattern: '*.txt',
    });
    expect(glob.output).toContain('probe.txt');
    expect(glob.output).toContain(notice);
    expect(ed.reads).toEqual([]);
  });

  it('do not claim Read sees the editor when the editor offers only writes', async () => {
    const ed = editor({}, { reads: false });
    const grep = await invoke(createGrepTool({ cwd: root, editorFiles: ed.editorFiles }), {
      pattern: 'DISK',
    });
    expect(grep.output).toBe(`${probe}\n\n${notice}]`);
  });

  it('carry no notice without an editor', async () => {
    const grep = await invoke(createGrepTool({ cwd: root, editorFiles: () => undefined }), {
      pattern: 'DISK',
    });
    expect(grep.output).toBe(probe);
  });
});
