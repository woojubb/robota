import { describe, expect, it, vi, beforeEach } from 'vitest';
import { aliasCommand } from '../commands/alias.js';
import type { IAliasCommandOptions } from '../commands/alias.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { readFile, writeFile } from 'node:fs/promises';

function createOptions(): IAliasCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async () => {
        throw new Error('not used');
      },
      writeBinaryStream: async () => {
        // not used
      },
    },
    written,
  };
}

function getOutput(options: { readonly written: string[] }): string {
  return options.written.join('');
}

describe('aliasCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    (writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('prints help with no args', async () => {
    const options = createOptions();

    const exitCode = await aliasCommand([], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toContain('dag alias');
  });

  it('prints help with --help', async () => {
    const options = createOptions();

    const exitCode = await aliasCommand(['--help'], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toContain('dag alias');
  });

  it('returns exit code 2 for unknown subcommand', async () => {
    const options = createOptions();

    const exitCode = await aliasCommand(['unknown'], options);

    expect(exitCode).toBe(2);
    expect(getOutput(options)).toContain('Unknown alias subcommand');
  });

  describe('add', () => {
    it('adds alias and writes to file', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(
        ['add', 'summarize', 'input | transform | text-output'],
        options,
      );

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('@summarize');
      expect(writeFile as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
        expect.stringContaining('aliases.json'),
        expect.stringContaining('"summarize"'),
        'utf8',
      );
    });

    it('returns exit code 2 when name is missing', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['add'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('requires <name>');
    });

    it('returns exit code 2 when pipeline is missing', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['add', 'test'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('requires "<pipeline>"');
    });

    it('returns exit code 2 for invalid alias name', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['add', 'my alias!', 'input | text-output'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('letters, numbers');
    });
  });

  describe('list', () => {
    it('shows no-aliases message when file is empty', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['list'], options);

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('No aliases defined');
    });

    it('lists aliases from file', async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ summarize: 'input | transform | text-output' }),
      );
      const options = createOptions();

      const exitCode = await aliasCommand(['list'], options);

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('@summarize');
      expect(getOutput(options)).toContain('input | transform | text-output');
    });
  });

  describe('remove', () => {
    it('returns exit code 1 when alias does not exist', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['remove', 'nonexistent'], options);

      expect(exitCode).toBe(1);
      expect(getOutput(options)).toContain('not found');
    });

    it('removes existing alias', async () => {
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ summarize: 'input | transform | text-output' }),
      );
      const options = createOptions();

      const exitCode = await aliasCommand(['remove', 'summarize'], options);

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('removed');
      const savedArg = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(savedArg).not.toContain('summarize');
    });

    it('returns exit code 2 when name is missing', async () => {
      const options = createOptions();

      const exitCode = await aliasCommand(['remove'], options);

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('requires <name>');
    });
  });
});
