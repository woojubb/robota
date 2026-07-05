import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { pipeCommand } from '../commands/pipe.js';
import type { IPipeCommandOptions } from '../commands/pipe.js';

function createOptions(): IPipeCommandOptions & { readonly written: string[] } {
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

function mockStdin(text: string): void {
  const readable = Readable.from([text]);
  Object.defineProperty(process, 'stdin', { value: readable, writable: true });
}

describe('pipeCommand', () => {
  let originalStdin: NodeJS.ReadStream;

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
  });

  it('prints help with --help', async () => {
    const options = createOptions();

    const exitCode = await pipeCommand(['--help'], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toContain('dag pipe');
  });

  it('returns exit code 2 for unknown flag', async () => {
    mockStdin('Hello');
    const options = createOptions();

    const exitCode = await pipeCommand(['--unknown'], options);

    expect(exitCode).toBe(2);
  });

  it('passes stdin text through transform node with prefix config', async () => {
    mockStdin('Hello');
    const options = createOptions();

    const exitCode = await pipeCommand(['transform[prefix=→ ]'], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toBe('→ Hello');
  });

  it('passes stdin text through default transform (no args)', async () => {
    mockStdin('Hello World');
    const options = createOptions();

    const exitCode = await pipeCommand([], options);

    expect(exitCode).toBe(0);
    expect(getOutput(options)).toBe('Hello World');
  });

  it('returns exit code 1 for empty stdin', async () => {
    mockStdin('');
    const options = createOptions();

    const exitCode = await pipeCommand(['transform'], options);

    expect(exitCode).toBe(1);
    expect(getOutput(options)).toContain('Error');
  });

  it('returns exit code 2 for unknown node type', async () => {
    mockStdin('Hello');
    const options = createOptions();

    const exitCode = await pipeCommand(['totally-unknown-node-xyz'], options);

    expect(exitCode).toBe(2);
    expect(getOutput(options)).toContain('Unknown node type');
  });
});
