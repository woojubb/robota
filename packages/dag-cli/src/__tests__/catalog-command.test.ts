import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReaddir, mockReadFile } = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
}));

const HELLO_DAG = JSON.stringify({
  dagId: 'hello',
  version: 1,
  status: 'published',
  meta: { description: 'Hello world workflow', tags: ['demo'] },
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [],
});

const SUMMARIZE_DAG = JSON.stringify({
  dagId: 'summarize',
  version: 1,
  status: 'published',
  meta: { description: 'Summarize documents', tags: ['text', 'summary'] },
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [],
});

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      events: { subscribe: vi.fn(() => () => {}), publish: vi.fn() },
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-1', status: 'success' },
        taskRuns: [],
      }),
    })),
  };
});

import { catalogCommand } from '../commands/catalog.js';
import type { IDagCliIo } from '../types.js';

function makeIo(): { io: IDagCliIo; lines: string[] } {
  const lines: string[] = [];
  const io: IDagCliIo = {
    write: (t) => lines.push(t),
    writeError: (t) => lines.push(t),
    // Delegate to the same mockReadFile so catalog run can re-read the file
    readTextFile: (path) => mockReadFile(path, 'utf8') as Promise<string>,
    writeBinaryStream: vi.fn(),
  };
  return { io, lines };
}

function setupCatalog(files: Record<string, string>): void {
  const fileNames = Object.keys(files).map((p) => p.split('/').pop() ?? p);
  mockReaddir.mockImplementation((dir: string) => {
    if (Object.keys(files).some((f) => f.startsWith(dir))) {
      return Promise.resolve(fileNames);
    }
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
  mockReadFile.mockImplementation((filePath: string) => {
    const content = files[filePath];
    if (content !== undefined) return Promise.resolve(content);
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

describe('catalogCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCatalog({
      '.workflows/hello.json': HELLO_DAG,
      '.workflows/summarize.json': SUMMARIZE_DAG,
    });
  });

  it('returns 2 for missing subcommand', async () => {
    const { io } = makeIo();
    expect(await catalogCommand([], { io })).toBe(2);
  });

  it('returns 2 for unknown subcommand', async () => {
    const { io } = makeIo();
    expect(await catalogCommand(['oops'], { io })).toBe(2);
  });

  describe('list', () => {
    it('lists workflows from catalog dir', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(['list', '--catalog', '.workflows'], { io });
      expect(code).toBe(0);
      const out = lines.join('');
      expect(out).toContain('hello');
      expect(out).toContain('summarize');
    });

    it('shows empty message when readdir fails', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const { io, lines } = makeIo();
      const code = await catalogCommand(['list', '--catalog', '.dag/empty'], { io });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('No workflows found');
    });

    it('uses global catalog dir with --global flag', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const { io, lines } = makeIo();
      const code = await catalogCommand(['list', '--global'], { io });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('No workflows found');
    });

    it('uses all catalog dirs with --all flag', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const { io, lines } = makeIo();
      const code = await catalogCommand(['list', '--all'], { io });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('No workflows found');
    });
  });

  describe('info', () => {
    it('shows info for a known workflow', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(['info', 'hello', '--catalog', '.workflows'], { io });
      expect(code).toBe(0);
      const out = lines.join('');
      expect(out).toContain('hello');
      expect(out).toContain('Hello world workflow');
    });

    it('returns 1 for unknown id', async () => {
      const { io } = makeIo();
      expect(
        await catalogCommand(['info', 'does-not-exist', '--catalog', '.workflows'], { io }),
      ).toBe(1);
    });

    it('returns json format when --output json', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(
        ['info', 'hello', '--catalog', '.workflows', '--output', 'json'],
        { io },
      );
      expect(code).toBe(0);
      const parsed = JSON.parse(lines.join('')) as { id: string };
      expect(parsed.id).toBe('hello');
    });
  });

  describe('search', () => {
    it('returns matching workflows by id', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(['search', 'summarize', '--catalog', '.workflows'], {
        io,
      });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('summarize');
    });

    it('returns matching by tag', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(['search', 'demo', '--catalog', '.workflows'], { io });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('hello');
    });

    it('returns 0 with no matches', async () => {
      const { io, lines } = makeIo();
      const code = await catalogCommand(['search', 'zzz-no-match', '--catalog', '.workflows'], {
        io,
      });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('No workflows matched');
    });

    it('returns 2 for missing query', async () => {
      const { io } = makeIo();
      expect(await catalogCommand(['search', '--catalog', '.workflows'], { io })).toBe(2);
    });
  });

  describe('history', () => {
    it('shows empty message when no history file exists', async () => {
      mockReadFile.mockImplementation((filePath: string) => {
        // history file doesn't exist
        if ((filePath as string).includes('.run-history.json')) {
          return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
        }
        const content = {
          '.workflows/hello.json': HELLO_DAG,
          '.workflows/summarize.json': SUMMARIZE_DAG,
        }[filePath as string];
        if (content !== undefined) return Promise.resolve(content);
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      const { io, lines } = makeIo();
      const code = await catalogCommand(['history'], { io });
      expect(code).toBe(0);
      expect(lines.join('')).toContain('기록이 없');
    });

    it('lists run history entries when history file exists', async () => {
      const history = JSON.stringify([
        {
          file: '.workflows/hello.json',
          date: '2026-05-20T10:00:00.000Z',
          status: 'success',
        },
        {
          file: '.workflows/summarize.json',
          date: '2026-05-21T08:30:00.000Z',
          status: 'failed',
        },
      ]);
      mockReadFile.mockImplementation((filePath: string) => {
        if ((filePath as string).includes('.run-history.json')) {
          return Promise.resolve(history);
        }
        const content = {
          '.workflows/hello.json': HELLO_DAG,
          '.workflows/summarize.json': SUMMARIZE_DAG,
        }[filePath as string];
        if (content !== undefined) return Promise.resolve(content);
        return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      });
      const { io, lines } = makeIo();
      const code = await catalogCommand(['history'], { io });
      expect(code).toBe(0);
      const out = lines.join('');
      expect(out).toContain('hello.json');
    });
  });

  describe('run', () => {
    it('runs a workflow by id and returns 0', async () => {
      const { io } = makeIo();
      const mockRun = vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-1', status: 'success' },
        taskRuns: [],
      });
      const mockRunner = {
        events: { subscribe: vi.fn(() => () => {}), publish: vi.fn() },
        run: mockRun,
      };
      const code = await catalogCommand(
        ['run', 'hello', '--catalog', '.workflows', '--output', 'json'],
        { io, createRunner: () => mockRunner as never },
      );
      expect(code).toBe(0);
      expect(mockRun).toHaveBeenCalledOnce();
    });

    it('returns 1 for unknown id', async () => {
      const { io } = makeIo();
      expect(
        await catalogCommand(['run', 'does-not-exist', '--catalog', '.workflows'], { io }),
      ).toBe(1);
    });

    it('returns 2 for missing id', async () => {
      const { io } = makeIo();
      expect(await catalogCommand(['run', '--catalog', '.workflows'], { io })).toBe(2);
    });
  });
});
