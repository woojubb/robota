import { describe, expect, it, vi } from 'vitest';
import { saveCommand } from '../commands/save.js';
import type { ISaveCommandOptions } from '../commands/save.js';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from 'node:fs/promises';

function createOptions(): ISaveCommandOptions & { readonly written: string[] } {
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

describe('saveCommand', () => {
  it('prints help with --help', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(['--help'], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toContain('dag save');
  });

  it('returns exit code 2 when --pipeline is missing', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(['--name', 'my-dag'], options);

    expect(exitCode).toBe(2);
    expect(getOutput(options)).toContain('--pipeline is required');
  });

  it('returns exit code 2 when --name is missing', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(['--pipeline', 'input | transform | text-output'], options);

    expect(exitCode).toBe(2);
    expect(getOutput(options)).toContain('--name is required');
  });

  it('returns exit code 2 when --name contains invalid characters', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(
      ['--pipeline', 'input | transform | text-output', '--name', 'my dag!'],
      options,
    );

    expect(exitCode).toBe(2);
    expect(getOutput(options)).toContain('letters, numbers');
  });

  it('returns exit code 2 for unknown flag', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(['--unknown'], options);

    expect(exitCode).toBe(2);
  });

  it('saves pipeline to .workflows/<name>.json', async () => {
    const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>;
    const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
    mockMkdir.mockClear();
    mockWriteFile.mockClear();

    const options = createOptions();

    const exitCode = await saveCommand(
      ['--pipeline', 'input | transform | text-output', '--name', 'my-pipeline'],
      options,
    );

    expect(exitCode).toBe(0);
    const output = getOutput(options);
    expect(output).toContain('Saved:');
    expect(output).toContain('my-pipeline.json');
    expect(output).toContain('dag catalog run my-pipeline');

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('workflows'),
      expect.objectContaining({ recursive: true }),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('my-pipeline.json'),
      expect.stringContaining('"dagId": "my-pipeline"'),
      'utf-8',
    );
  });

  it('applies --node-config overrides before saving', async () => {
    const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
    mockWriteFile.mockClear();

    const options = createOptions();

    const exitCode = await saveCommand(
      [
        '--pipeline',
        'input | transform | text-output',
        '--name',
        'prefixed',
        '--node-config',
        'transform.prefix=→ ',
      ],
      options,
    );

    expect(exitCode).toBe(0);
    const calls = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls;
    const savedJson = (calls[0] as [string, string, string])[1];
    expect(savedJson).toContain('"prefix": "→ "');
  });

  it('returns exit code 1 for unknown node type in pipeline', async () => {
    const options = createOptions();

    const exitCode = await saveCommand(
      ['--pipeline', 'input | totally-unknown-xyz | text-output', '--name', 'bad'],
      options,
    );

    expect(exitCode).toBe(1);
    expect(getOutput(options)).toContain('Unknown node type');
  });
});
