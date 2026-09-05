import { writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { buildCommand } from '../commands/build.js';
import type { IBuildCommandOptions } from '../commands/build.js';

function createOptions(): IBuildCommandOptions & { readonly written: string[] } {
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
        throw new Error('readTextFile not used');
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

const VALID_SPEC = JSON.stringify({
  nodes: [{ type: 'transform', config: { prefix: '→ ' } }],
  edges: [],
});

const SPEC_WITH_UNKNOWN_KEY = JSON.stringify({
  nodes: [{ type: 'transform', config: { prefix: '→ ', suffix: ' ←' } }],
  edges: [],
});

describe('buildCommand', () => {
  describe('config key validation', () => {
    it('succeeds without warning when config keys are valid', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(['--dagId', 'test', '--spec', VALID_SPEC], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).not.toContain('⚠');
    });

    it('prints warning for unknown config key', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', SPEC_WITH_UNKNOWN_KEY],
        options,
      );

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('⚠');
      expect(output).toContain('suffix');
      expect(output).toContain('ignored at runtime');
    });

    it('returns exit code 1 with --strict when unknown config key found', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', SPEC_WITH_UNKNOWN_KEY, '--strict'],
        options,
      );

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('suffix');
    });

    it('returns exit code 0 with --strict when all config keys are valid', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', VALID_SPEC, '--strict'],
        options,
      );

      expect(exitCode).toBe(0);
    });

    it('returns exit code 2 for unknown flag', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', VALID_SPEC, '--unknown-flag'],
        options,
      );

      expect(exitCode).toBe(2);
    });
  });

  describe('--run', () => {
    it('returns exit code 2 when --result is used without --run', async () => {
      const options = createOptions();

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', VALID_SPEC, '--result'],
        options,
      );

      expect(exitCode).toBe(2);
      expect(getOutput(options)).toContain('--result requires --run');
    });

    it('executes the DAG in-process when --run is provided', async () => {
      const options = createOptions();
      const spec = JSON.stringify({
        nodes: [
          { type: 'input' },
          { type: 'transform', config: { prefix: 'HI: ' } },
          { type: 'text-output' },
        ],
        edges: ['input→transform', 'transform→text-output'],
      });

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', spec, '--run', '--input', 'text=World'],
        options,
      );

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('Run completed');
    });

    it('outputs final text with --run --result', async () => {
      const options = createOptions();
      const spec = JSON.stringify({
        nodes: [
          { type: 'input' },
          { type: 'transform', config: { prefix: '' } },
          { type: 'text-output' },
        ],
        edges: ['input→transform', 'transform→text-output'],
      });

      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', spec, '--run', '--result', '--input', 'text=Hello'],
        options,
      );

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toBe('Hello');
    });
  });

  describe('--spec with file path', () => {
    // SEC-003: spec fixtures live in an OS-chosen 0700 dir, never at a guessable
    // path directly under the world-writable OS temp dir.
    const tmpDirs: string[] = [];

    async function specDir(): Promise<string> {
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'dag-build-spec-')));
      tmpDirs.push(dir);
      return dir;
    }

    afterEach(async () => {
      for (const d of tmpDirs) {
        await rm(d, { recursive: true, force: true }).catch(() => undefined);
      }
      tmpDirs.length = 0;
    });

    it('reads spec from a .json file path', async () => {
      const specPath = join(await specDir(), 'test-spec.json');
      await writeFile(
        specPath,
        JSON.stringify({
          nodes: [{ type: 'input' }, { type: 'text-output' }],
          edges: ['input→text-output'],
        }),
      );

      const options = createOptions();
      const exitCode = await buildCommand(
        ['--dagId', 'file-spec-test', '--spec', specPath],
        options,
      );
      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('"dagId": "file-spec-test"');
    });

    it('reads spec from a .spec file path', async () => {
      const specPath = join(await specDir(), 'test-spec.spec');
      await writeFile(
        specPath,
        JSON.stringify({
          nodes: [{ type: 'input' }, { type: 'text-output' }],
          edges: [],
        }),
      );

      const options = createOptions();
      const exitCode = await buildCommand(
        ['--dagId', 'spec-ext-test', '--spec', specPath],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('returns exit code 1 when spec file does not exist', async () => {
      const options = createOptions();
      const exitCode = await buildCommand(
        ['--dagId', 'test', '--spec', '/nonexistent/path/spec.json'],
        options,
      );
      expect(exitCode).toBe(1);
      expect(getOutput(options)).toContain('Could not read spec file');
    });
  });
});
