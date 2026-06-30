import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { runMigrateCommand } from '../commands/migrate.js';
import type { IDagCliIo } from '../types.js';

const LEGACY_DAG = JSON.stringify({
  dagId: 'test',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [{ from: 'in', to: 'out', bindings: [] }],
});

function makeMockIo(): IDagCliIo & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((msg: string) => {
      written.push(msg);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn(),
  };
}

describe('runMigrateCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no file arg is given', async () => {
    const io = makeMockIo();
    const code = await runMigrateCommand([], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('migrate requires');
  });

  it('returns error for unknown option', async () => {
    const io = makeMockIo();
    const code = await runMigrateCommand(['--unknown'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Unknown option');
  });

  it('returns error when file cannot be read', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    const io = makeMockIo();
    const code = await runMigrateCommand(['missing.dag.json'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Cannot read');
  });

  it('returns error when file contains invalid JSON', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('not-json' as unknown as string);
    const io = makeMockIo();
    const code = await runMigrateCommand(['bad.dag.json'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('Cannot parse JSON');
  });

  it('informs user when file is already in workflow format', async () => {
    // isWorkflowFileFormat requires: nodes[], links[], version (number), and no dagId
    const workflowFile = JSON.stringify({
      version: 1,
      nodes: [],
      links: [],
    });
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(workflowFile as unknown as string);
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('already in workflow file format');
  });

  it('returns error when file is not a recognized DAG format', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify({ random: 'object' }) as unknown as string,
    );
    const io = makeMockIo();
    const code = await runMigrateCommand(['random.dag.json'], { io });
    expect(code).not.toBe(0);
    expect(io.written.join('')).toContain('not a recognized DAG file format');
  });

  it('performs dry-run without writing files', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(LEGACY_DAG as unknown as string);
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json', '--dry-run'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('[dry-run]');
    expect(fsModule.writeFile).not.toHaveBeenCalled();
  });

  it('migrates legacy DAG and writes files', async () => {
    const fsModule = await import('node:fs/promises');
    const fsSync = await import('node:fs');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(LEGACY_DAG as unknown as string);
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json'], { io });
    expect(code).toBe(0);
    expect(fsModule.writeFile).toHaveBeenCalledTimes(2); // workflow + companion
    expect(io.written.join('')).toContain('Migration complete');
  });

  it('creates backup when --backup flag is used', async () => {
    const fsModule = await import('node:fs/promises');
    const fsSync = await import('node:fs');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(LEGACY_DAG as unknown as string);
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json', '--backup'], { io });
    expect(code).toBe(0);
    expect(fsModule.rename).toHaveBeenCalled();
    expect(io.written.join('')).toContain('Backup written');
  });

  it('creates backup with -b shorthand', async () => {
    const fsModule = await import('node:fs/promises');
    const fsSync = await import('node:fs');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(LEGACY_DAG as unknown as string);
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json', '-b'], { io });
    expect(code).toBe(0);
    expect(fsModule.rename).toHaveBeenCalled();
  });

  it('skips companion write when companion file already exists', async () => {
    const fsModule = await import('node:fs/promises');
    const fsSync = await import('node:fs');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(LEGACY_DAG as unknown as string);
    vi.mocked(fsSync.existsSync).mockReturnValue(true); // companion exists
    const io = makeMockIo();
    const code = await runMigrateCommand(['workflow.dag.json'], { io });
    expect(code).toBe(0);
    expect(fsModule.writeFile).toHaveBeenCalledTimes(1); // only workflow file
    expect(io.written.join('')).toContain('already exists');
  });
});
