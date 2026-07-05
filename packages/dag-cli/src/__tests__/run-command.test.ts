import { describe, expect, it, vi } from 'vitest';
import type { IDagDefinition, IDagRun, ITaskRun } from '@robota-sdk/dag-core';
import { runCommand, parsePortError } from '../commands/run.js';
import type { IRunCommandOptions } from '../commands/run.js';
import type { LocalDagRunner, ILocalRunResult } from '../local-runner/local-dag-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimalDefinition(): IDagDefinition {
  return {
    dagId: 'test-dag',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
  };
}

function createSuccessDagRun(): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'test-dag',
    version: 1,
    status: 'success',
    runKey: 'test-dag:manual:1',
    logicalDate: new Date().toISOString(),
    trigger: 'manual',
  };
}

function createTaskRun(nodeId: string, status: ITaskRun['status'] = 'success'): ITaskRun {
  return {
    taskRunId: `task-${nodeId}`,
    dagRunId: 'run-1',
    nodeId,
    status,
    attempt: 1,
  };
}

function createMockResult(overrides?: Partial<ILocalRunResult>): ILocalRunResult {
  return {
    dagRun: createSuccessDagRun(),
    taskRuns: [createTaskRun('node-a'), createTaskRun('node-b')],
    ...overrides,
  };
}

function createOptions(
  overrides: Partial<IRunCommandOptions> & {
    fileContents?: Record<string, string>;
    mockResult?: ILocalRunResult;
    runError?: Error;
  } = {},
): IRunCommandOptions & { readonly written: string[] } {
  const written: string[] = [];
  const fileContents: Record<string, string> = overrides.fileContents ?? {};
  const mockResult = overrides.mockResult ?? createMockResult();
  const runError = overrides.runError;

  const mockRunner = {
    run: runError ? vi.fn().mockRejectedValue(runError) : vi.fn().mockResolvedValue(mockResult),
    events: { subscribe: vi.fn() },
  } as unknown as LocalDagRunner;

  return {
    io: {
      write: (text) => {
        written.push(text);
      },
      writeError: (text) => {
        written.push(text);
      },
      readTextFile: async (filePath) => {
        const content = fileContents[filePath];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        }
        return content;
      },
      writeBinaryStream: async () => {
        // not used in run command
      },
    },
    createRunner: () => mockRunner,
    written,
  };
}

function getOutput(options: { readonly written: string[] }): string {
  return options.written.join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCommand', () => {
  describe('argument validation', () => {
    it('fails with exit code 2 when no file is provided', async () => {
      const options = createOptions();

      const exitCode = await runCommand([], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean; errors: { code: string }[] };
      expect(output.ok).toBe(false);
      expect(output.errors[0]?.code).toBe('DAG_CLI_USAGE_ERROR');
    });

    it('fails with exit code 2 when --output has an invalid value', async () => {
      const options = createOptions();

      const exitCode = await runCommand(['--output', 'xml', 'workflow.dag.json'], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean };
      expect(output.ok).toBe(false);
    });

    it('fails with exit code 2 when --input is missing the = separator', async () => {
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(createMinimalDefinition()) },
      });

      const exitCode = await runCommand(['workflow.dag.json', '--input', 'nodryrunkey'], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean };
      expect(output.ok).toBe(false);
    });
  });

  describe('file errors', () => {
    it('fails with exit code 2 when the DAG file does not exist', async () => {
      const options = createOptions(); // no fileContents → readTextFile throws

      const exitCode = await runCommand(['missing.dag.json'], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean; errors: { code: string }[] };
      expect(output.ok).toBe(false);
      expect(output.errors[0]?.code).toBe('DAG_CLI_USAGE_ERROR');
    });

    it('fails with exit code 2 when the file contains invalid JSON', async () => {
      const options = createOptions({
        fileContents: { 'bad.dag.json': 'not { valid json' },
      });

      const exitCode = await runCommand(['bad.dag.json'], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean };
      expect(output.ok).toBe(false);
    });

    it('fails with exit code 2 when the file contains a JSON array instead of an object', async () => {
      const options = createOptions({
        fileContents: { 'array.dag.json': '[]' },
      });

      const exitCode = await runCommand(['array.dag.json'], options);

      expect(exitCode).toBe(2);
      const output = JSON.parse(getOutput(options)) as { ok: boolean };
      expect(output.ok).toBe(false);
    });

    it('fails with exit code 2 when readTextFile throws a non-Error value (covers String(err) branch)', async () => {
      // Throw a non-Error string to exercise the String(error) branch in resolveErrorMessage
      const written: string[] = [];
      const mockRunner = {
        run: vi.fn(),
        events: { subscribe: vi.fn() },
      } as unknown as LocalDagRunner;
      const options: IRunCommandOptions & { readonly written: string[] } = {
        written,
        io: {
          write: (text) => {
            written.push(text);
          },
          writeError: (text) => {
            written.push(text);
          },
          readTextFile: async () => {
            throw 'non-error string thrown from readTextFile';
          },
          writeBinaryStream: async () => {
            // not used
          },
        },
        createRunner: () => mockRunner,
      };
      const exitCode = await runCommand(['missing.dag.json'], options);
      expect(exitCode).toBe(2);
      const output = JSON.parse(written.join('')) as { ok: boolean };
      expect(output.ok).toBe(false);
    });
  });

  describe('successful execution', () => {
    it('returns exit code 0 on a successful 2-node DAG run (pretty output)', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('Running: workflow.dag.json');
      expect(output).toContain('node-a');
      expect(output).toContain('node-b');
      expect(output).toContain('Completed in');
    });

    it('returns exit code 0 and JSON output when --output json is specified', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['workflow.dag.json', '--output', 'json'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        ok: boolean;
        dagRunId: string;
        durationMs: number;
        nodes: { nodeId: string; status: string }[];
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dagRunId).toBe('run-1');
      expect(typeof parsed.durationMs).toBe('number');
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.nodes[0]?.nodeId).toBe('node-a');
    });

    it('passes parsed --input flags as flat string payload to runner.run()', async () => {
      const definition = createMinimalDefinition();
      const mockResult = createMockResult();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult,
      });

      const mockRunner = options.createRunner!() as unknown as {
        run: ReturnType<typeof vi.fn>;
      };

      await runCommand(['workflow.dag.json', '--input', 'text=hello', '--input', 'lang=en'], {
        ...options,
        createRunner: () =>
          mockRunner as unknown as import('../local-runner/local-dag-runner.js').LocalDagRunner,
      });

      expect(mockRunner.run).toHaveBeenCalledWith(expect.objectContaining({ dagId: 'test-dag' }), {
        text: 'hello',
        lang: 'en',
      });
    });

    it('returns exit code 1 when the dag run status is "failed"', async () => {
      const definition = createMinimalDefinition();
      const failedResult = createMockResult({
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });

      const exitCode = await runCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(1);
    });

    it('returns exit code 1 and reports error when runner.run() throws', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        runError: new Error('startRun failed: DAG_NOT_FOUND'),
      });

      const exitCode = await runCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(1);
      expect(getOutput(options)).toContain('startRun failed');
    });
  });

  describe('--node-config', () => {
    it('applies --node-config override to a node in file-based run', async () => {
      const definition: IDagDefinition = {
        ...createMinimalDefinition(),
        nodes: [
          { nodeId: 'transform', nodeType: 'transform', dependsOn: [], config: { prefix: '' } },
        ],
        edges: [],
      };
      const mockResult = createMockResult({
        taskRuns: [createTaskRun('transform')],
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult,
      });

      const mockRunner = options.createRunner!() as unknown as {
        run: ReturnType<typeof vi.fn>;
      };

      await runCommand(
        ['workflow.dag.json', '--node-config', 'transform.prefix=HELLO: ', '--no-cost-warning'],
        {
          ...options,
          createRunner: () =>
            mockRunner as unknown as import('../local-runner/local-dag-runner.js').LocalDagRunner,
        },
      );

      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              nodeId: 'transform',
              config: expect.objectContaining({ prefix: 'HELLO: ' }),
            }),
          ]),
        }),
        expect.anything(),
      );
    });

    it('warns and skips when the node ID is not found in the DAG', async () => {
      const definition: IDagDefinition = {
        ...createMinimalDefinition(),
        nodes: [{ nodeId: 'transform', nodeType: 'transform', dependsOn: [], config: {} }],
        edges: [],
      };
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(
        ['workflow.dag.json', '--node-config', 'nonexistent.prefix=X', '--no-cost-warning'],
        options,
      );

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('node "nonexistent" not found');
    });

    it('fails with exit code 2 when --node-config format is invalid (no dot)', async () => {
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(createMinimalDefinition()) },
      });

      const exitCode = await runCommand(
        ['workflow.dag.json', '--node-config', 'badsyntax'],
        options,
      );

      expect(exitCode).toBe(2);
    });

    it('applies --node-config for pipeline run and passes updated config to runner', async () => {
      const mockResult = createMockResult({
        taskRuns: [
          createTaskRun('input'),
          createTaskRun('transform'),
          createTaskRun('text-output'),
        ],
      });
      const options = createOptions({ mockResult });

      const mockRunner = options.createRunner!() as unknown as {
        run: ReturnType<typeof vi.fn>;
      };

      const exitCode = await runCommand(
        [
          '--pipeline',
          'input | transform | text-output',
          '--node-config',
          'transform.prefix=HI: ',
          '--no-cost-warning',
          '--input',
          'text=hello',
        ],
        {
          ...options,
          createRunner: () =>
            mockRunner as unknown as import('../local-runner/local-dag-runner.js').LocalDagRunner,
        },
      );

      expect(exitCode).toBe(0);
      expect(mockRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              nodeId: 'transform',
              config: expect.objectContaining({ prefix: 'HI: ' }),
            }),
          ]),
        }),
        expect.anything(),
      );
    });
  });

  describe('--output-key', () => {
    it('extracts single key as plain text', async () => {
      const taskRun = createTaskRun('transform');
      const mockResult = createMockResult({
        taskRuns: [{ ...taskRun, outputSnapshot: JSON.stringify({ text: 'hello-out' }) }],
      });
      const options = createOptions({ mockResult });

      const exitCode = await runCommand(
        ['--pipeline', 'input | transform | text-output', '--output-key', 'transform.text'],
        options,
      );

      expect(exitCode).toBe(0);
      expect(getOutput(options)).toBe('hello-out');
    });

    it('extracts multiple keys as JSON', async () => {
      const taskRun = createTaskRun('transform');
      const mockResult = createMockResult({
        taskRuns: [{ ...taskRun, outputSnapshot: JSON.stringify({ text: 'A', data: { x: 1 } }) }],
      });
      const options = createOptions({ mockResult });

      const exitCode = await runCommand(
        [
          '--pipeline',
          'input | transform | text-output',
          '--output-key',
          'transform.text',
          '--output-key',
          'transform.data',
        ],
        options,
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as Record<string, unknown>;
      expect(parsed['transform.text']).toBe('A');
    });

    it('returns exit code 1 when key is not found', async () => {
      const mockResult = createMockResult({
        taskRuns: [createTaskRun('transform')],
      });
      const options = createOptions({ mockResult });

      const exitCode = await runCommand(
        ['--pipeline', 'input | transform | text-output', '--output-key', 'transform.missing'],
        options,
      );

      expect(exitCode).toBe(1);
      expect(getOutput(options)).toContain('not found');
    });

    it('returns exit code 2 when --output-key format is invalid (no dot)', async () => {
      const options = createOptions();

      const exitCode = await runCommand(
        ['--pipeline', 'input | transform | text-output', '--output-key', 'badsyntax'],
        options,
      );

      expect(exitCode).toBe(2);
    });
  });

  describe('port error hints', () => {
    it('prints error message and port hint when task fails with required port error', async () => {
      const definition: IDagDefinition = {
        ...createMinimalDefinition(),
        nodes: [{ nodeId: 'transform', nodeType: 'transform', dependsOn: [], config: {} }],
        edges: [],
      };
      const failedResult: ILocalRunResult = {
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
        taskRuns: [
          {
            ...createTaskRun('transform', 'failed'),
            errorMessage: 'Required input port "text" (string) is missing on node "transform"',
          },
        ],
      };
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });

      const exitCode = await runCommand(['workflow.dag.json'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Required input port');
      expect(output).toContain('→ transform expects:');
      expect(output).toContain('dag node info transform');
    });

    it('does not print port hint for unrelated error messages', async () => {
      const definition: IDagDefinition = {
        ...createMinimalDefinition(),
        nodes: [{ nodeId: 'transform', nodeType: 'transform', dependsOn: [], config: {} }],
        edges: [],
      };
      const failedResult: ILocalRunResult = {
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
        taskRuns: [
          {
            ...createTaskRun('transform', 'failed'),
            errorMessage: 'An unexpected internal error occurred',
          },
        ],
      };
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });

      await runCommand(['workflow.dag.json'], options);

      const output = getOutput(options);
      expect(output).toContain('An unexpected internal error occurred');
      expect(output).not.toContain('→ transform expects:');
    });
  });

  describe('parsePortError', () => {
    it('returns true for "Required input port" pattern', () => {
      expect(parsePortError('Required input port "text" is missing')).toBe(true);
    });

    it('returns true for "type mismatch" pattern', () => {
      expect(parsePortError('Type mismatch: expected string but got binary')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(parsePortError('An unexpected error occurred')).toBe(false);
      expect(parsePortError('Network timeout')).toBe(false);
    });
  });

  describe('dry-run', () => {
    it('returns exit code 0 and prints definition summary without executing', async () => {
      const definition: IDagDefinition = {
        ...createMinimalDefinition(),
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
      };
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['workflow.dag.json', '--dry-run'], options);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(getOutput(options)) as {
        ok: boolean;
        dryRun: boolean;
        dagId: string;
        nodeCount: number;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.dagId).toBe('test-dag');
      expect(parsed.nodeCount).toBe(2);
      // createRunner must NOT be called
      const mockRunner = options.createRunner!();
      expect(
        (mockRunner as unknown as { run: ReturnType<typeof vi.fn> }).run,
      ).not.toHaveBeenCalled();
    });
  });

  describe('--save-as', () => {
    it('returns exit code 2 for invalid save-as name', async () => {
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(createMinimalDefinition()) },
      });

      const exitCode = await runCommand(['workflow.dag.json', '--save-as', 'my name!'], options);

      expect(exitCode).toBe(2);
    });

    it('prints save confirmation on successful run with --save-as', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['workflow.dag.json', '--save-as', 'my-dag'], options);

      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('Saved as:');
      expect(output).toContain('my-dag.dag.json');
      expect(output).toContain('dag catalog run my-dag');
    });

    it('prints warning (does not save) when run fails without --save-as-draft', async () => {
      const definition = createMinimalDefinition();
      const failedResult = createMockResult({
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });

      const exitCode = await runCommand(['workflow.dag.json', '--save-as', 'my-dag'], options);

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Pipeline failed');
      expect(output).toContain('--save-as-draft');
      expect(output).not.toContain('Saved as:');
    });

    it('saves even on failure when --save-as-draft is provided', async () => {
      const definition = createMinimalDefinition();
      const failedResult = createMockResult({
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });

      const exitCode = await runCommand(
        ['workflow.dag.json', '--save-as', 'my-dag', '--save-as-draft'],
        options,
      );

      expect(exitCode).toBe(1);
      const output = getOutput(options);
      expect(output).toContain('Saved as:');
    });
  });

  describe('help flags', () => {
    it('prints help text with --help and returns 0', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--help'], options);
      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('dag run');
    });

    it('prints pipeline examples with --pipeline-examples and returns 0', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--pipeline-examples'], options);
      expect(exitCode).toBe(0);
      const output = getOutput(options);
      expect(output).toContain('pipeline');
    });
  });

  describe('--pipeline flag', () => {
    it('runs from inline pipeline spec', async () => {
      const options = createOptions({
        mockResult: createMockResult({
          taskRuns: [createTaskRun('input', 'success'), createTaskRun('text-output', 'success')],
        }),
      });

      const exitCode = await runCommand(['--pipeline', 'input | text-output'], options);

      expect(exitCode).toBe(0);
    });

    it('returns error when --pipeline has no value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--pipeline'], options);
      expect(exitCode).toBe(2);
    });
  });

  describe('--dry-run flag', () => {
    it('returns 0 and prints definition summary with --dry-run', async () => {
      const definition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({
        fileContents: { 'test.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['test.dag.json', '--dry-run'], options);
      expect(exitCode).toBe(0);
    });
  });

  describe('--no-progress flag', () => {
    it('runs without progress display', async () => {
      const definition = {
        dagId: 'test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: {} },
          { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
        ],
        edges: [],
      };
      const options = createOptions({
        fileContents: { 'test.dag.json': JSON.stringify(definition) },
      });

      const exitCode = await runCommand(['test.dag.json', '--no-progress'], options);
      expect(exitCode).toBe(0);
    });
  });

  describe('additional flag coverage', () => {
    it('accepts --stream flag without error', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--stream', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('--frozen returns exit 2 when lock file is missing', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--frozen', '--no-cost-warning'],
        options,
      );
      // --frozen fails when no dag.lock file exists
      expect(exitCode).toBe(2);
    });

    it('accepts --no-cta flag without error', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--no-cta', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('accepts --confirm-cost flag without error', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--confirm-cost', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('accepts --no-diff flag without error', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--no-diff', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('-p is accepted as alias for --pipeline', async () => {
      const options = createOptions({
        mockResult: createMockResult({
          taskRuns: [createTaskRun('input', 'success'), createTaskRun('text-output', 'success')],
        }),
      });
      const exitCode = await runCommand(
        ['-p', 'input | text-output', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('returns error when --watch and --dry-run are combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--watch', '--dry-run'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error when --stdin and --watch are combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--stdin', '--watch'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error when --stdin and --pipeline are combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--stdin', '--pipeline', 'input | text-output'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --max-cost-usd with invalid value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(
        ['workflow.dag.json', '--max-cost-usd', 'notanumber'],
        options,
      );
      expect(exitCode).toBe(2);
    });

    it('returns error for multiple positional arguments', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['file1.dag.json', 'file2.dag.json'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --report-file with no value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--report-file'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --output with no value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--output'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --result and --output json combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(
        ['workflow.dag.json', '--result', '--output', 'json'],
        options,
      );
      expect(exitCode).toBe(2);
    });

    it('returns error for --stream and --output json combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(
        ['workflow.dag.json', '--stream', '--output', 'json'],
        options,
      );
      expect(exitCode).toBe(2);
    });

    it('returns error for --timeout with no value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--timeout'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --timeout with invalid value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--timeout', 'bad'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --env-file with no value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--env-file'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --watch and --pipeline combined', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--watch', '--pipeline', 'input | text-output'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --max-cost-usd with negative value', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--max-cost-usd', '-5'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for --save-as error case (duplicate)', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--save-as', '--save-as'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error for unknown flags', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['workflow.dag.json', '--unknown-xyz-flag'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error when --stdin has extra positional args', async () => {
      const options = createOptions();
      const exitCode = await runCommand(['--stdin', 'extra.dag.json'], options);
      expect(exitCode).toBe(2);
    });

    it('returns error when --pipeline has extra positional args', async () => {
      const options = createOptions();
      const exitCode = await runCommand(
        ['--pipeline', 'input | text-output', 'extra.dag.json'],
        options,
      );
      expect(exitCode).toBe(2);
    });

    it('--aliases with a pipeline arg prints aliases info', async () => {
      // --aliases flag is handled in runCommand body (after parseRunArgv success)
      // so it needs a valid pipeline/file arg to pass the parser
      const options = createOptions();
      const exitCode = await runCommand(
        ['--pipeline', 'input | text-output', '--aliases'],
        options,
      );
      expect(exitCode).toBe(0);
      expect(getOutput(options)).toContain('aliases');
    });

    it('uses --result flag to get final output as plain text', async () => {
      const definition = createMinimalDefinition();
      const mockResult = createMockResult({
        taskRuns: [
          {
            ...createTaskRun('transform'),
            outputSnapshot: JSON.stringify({ text: 'final-answer' }),
          },
        ],
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult,
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--result', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('accepts --save-as-draft flag (covers saveAsDraft=true branch)', async () => {
      const definition = createMinimalDefinition();
      const failedResult = createMockResult({
        dagRun: { ...createSuccessDagRun(), status: 'failed' },
      });
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
        mockResult: failedResult,
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--save-as', 'my-draft', '--save-as-draft', '--no-cost-warning'],
        options,
      );
      // --save-as-draft allows saving even on failure
      expect([0, 1]).toContain(exitCode);
    });

    it('accepts --no-auto-nodes flag (covers noAutoNodes=true branch)', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--no-auto-nodes', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('accepts --tui flag (covers tuiMode=true branch)', async () => {
      const definition = createMinimalDefinition();
      const options = createOptions({
        fileContents: { 'workflow.dag.json': JSON.stringify(definition) },
      });
      const exitCode = await runCommand(
        ['workflow.dag.json', '--tui', '--no-cost-warning'],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('applies --node-config with boolean "true" value (inferConfigValue=true branch)', async () => {
      const options = createOptions({
        mockResult: createMockResult({
          taskRuns: [
            createTaskRun('input'),
            createTaskRun('transform'),
            createTaskRun('text-output'),
          ],
        }),
      });
      const exitCode = await runCommand(
        [
          '--pipeline',
          'input | transform | text-output',
          '--node-config',
          'transform.enabled=true',
          '--no-cost-warning',
        ],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('applies --node-config with boolean "false" value (inferConfigValue=false branch)', async () => {
      const options = createOptions({
        mockResult: createMockResult({
          taskRuns: [
            createTaskRun('input'),
            createTaskRun('transform'),
            createTaskRun('text-output'),
          ],
        }),
      });
      const exitCode = await runCommand(
        [
          '--pipeline',
          'input | transform | text-output',
          '--node-config',
          'transform.enabled=false',
          '--no-cost-warning',
        ],
        options,
      );
      expect(exitCode).toBe(0);
    });

    it('applies --node-config with numeric value (inferConfigValue number branch)', async () => {
      const options = createOptions({
        mockResult: createMockResult({
          taskRuns: [
            createTaskRun('input'),
            createTaskRun('transform'),
            createTaskRun('text-output'),
          ],
        }),
      });
      const exitCode = await runCommand(
        [
          '--pipeline',
          'input | transform | text-output',
          '--node-config',
          'transform.count=42',
          '--no-cost-warning',
        ],
        options,
      );
      expect(exitCode).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// extractFinalOutput — direct unit tests
// ---------------------------------------------------------------------------

describe('extractFinalOutput', () => {
  it('returns text from text-output node by preference', async () => {
    const { extractFinalOutput } = await import('../commands/run.js');
    const taskRuns = [
      {
        taskRunId: 't1',
        dagRunId: 'r1',
        nodeId: 'text-output',
        status: 'success' as const,
        attempt: 1,
        outputSnapshot: JSON.stringify({ text: 'the answer' }),
      },
    ];
    const nodes = [
      { nodeId: 'input', nodeType: 'input', dependsOn: [] as string[], config: {} },
      { nodeId: 'text-output', nodeType: 'text-output', dependsOn: [] as string[], config: {} },
    ];
    const result = extractFinalOutput(taskRuns, nodes);
    expect(result).toBe('the answer');
  });

  it('returns null when no task runs produce output', async () => {
    const { extractFinalOutput } = await import('../commands/run.js');
    const result = extractFinalOutput([], []);
    expect(result).toBeNull();
  });

  it('falls back to last successful node string output', async () => {
    const { extractFinalOutput } = await import('../commands/run.js');
    const taskRuns = [
      {
        taskRunId: 't1',
        dagRunId: 'r1',
        nodeId: 'transform',
        status: 'success' as const,
        attempt: 1,
        outputSnapshot: JSON.stringify({ result: 'transformed-text' }),
      },
    ];
    const nodes = [
      { nodeId: 'transform', nodeType: 'transform', dependsOn: [] as string[], config: {} },
    ];
    const result = extractFinalOutput(taskRuns, nodes);
    expect(result).toBe('transformed-text');
  });
});
