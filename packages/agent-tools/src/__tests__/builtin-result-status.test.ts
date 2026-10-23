import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createReadTool } from '../builtins/read-tool';
import { createWriteTool } from '../builtins/write-tool';
import { createEditTool } from '../builtins/edit-tool';
import { createGlobTool } from '../builtins/glob-tool';
import { createGrepTool } from '../builtins/grep-tool';
import { createShellTool, createBashTool } from '../builtins/shell-tool';
import { createWebFetchTool } from '../builtins/web-fetch-tool';
import { createWebSearchTool } from '../builtins/web-search-tool';
import { createAskUserQuestionTool } from '../builtins/ask-user-question-tool';
import { createToolSearchTool } from '../builtins/tool-search-tool';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { ISandboxClient } from '../sandbox/types';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'builtin-outcome-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, 'existing.txt'), '{"success":false,"error":"ordinary file content"}');

describe('declared builtin invocation outcomes', () => {
  const failures = [
    {
      name: 'Read',
      tool: () => createReadTool({ cwd: root }),
      args: { filePath: join(root, 'missing.txt') },
    },
    {
      name: 'Write',
      tool: () => createWriteTool({ cwd: root }),
      args: { filePath: join(root, '..', 'outside.txt'), content: 'must not write' },
    },
    {
      name: 'Edit',
      tool: () => createEditTool({ cwd: root }),
      args: { filePath: join(root, 'missing.txt'), oldString: 'a', newString: 'b' },
    },
    {
      name: 'Glob',
      tool: () => createGlobTool({ cwd: root }),
      args: { pattern: '*', path: join(root, '..') },
    },
    { name: 'Grep', tool: () => createGrepTool({ cwd: root }), args: { pattern: '[' } },
    {
      name: 'Shell',
      tool: () => createShellTool({ cwd: root }),
      args: { command: 'printf unused', workingDirectory: join(root, 'missing-directory') },
    },
    {
      name: 'Bash',
      tool: () => createBashTool({ cwd: root }),
      args: { command: 'printf unused', workingDirectory: join(root, 'missing-directory') },
    },
    { name: 'WebFetch', tool: () => createWebFetchTool(), args: { url: 'not-a-url' } },
    {
      name: 'WebSearch',
      tool: () =>
        createWebSearchTool({
          provider: {
            search: async () => {
              throw new Error('Search provider refused');
            },
          },
        }),
      args: { query: 'fixture' },
    },
  ];

  it.each(failures)(
    '$name reports its failure in the outer envelope and preserves the JSON payload',
    async ({ tool, args }) => {
      const result = await tool().execute(args);
      expect(result.success).toBe(false);
      expect(typeof result.data).toBe('string');
      const payload: unknown = JSON.parse(String(result.data));
      expect(payload).toMatchObject({ success: false });
      expect(payload).toHaveProperty('error', result.error);
      expect(result.error).toEqual(expect.any(String));
    },
  );

  it('keeps custom JSON values as successful domain data', async () => {
    const value = { success: false, output: '', error: 'ordinary domain payload' };
    const tool = createZodFunctionTool('Domain', 'Domain data', z.object({}), async () => value);
    expect(await tool.execute({})).toMatchObject({ success: true, data: JSON.stringify(value) });
  });

  it('keeps Zod defaults and residency in explicitly declared invocation mode', async () => {
    const schema = z.object({ level: z.string().default('info') });
    const tool = createZodFunctionTool(
      'Declared',
      'Declared invocation',
      schema,
      async ({ level }) => {
        expect(level).toBe('info');
        return ' { "success": false, "output": "retained", "error": "refused" } ';
      },
      { deferLoading: true, resultMode: 'invocation-json' },
    );
    expect(tool.schema.deferLoading).toBe(true);
    expect(await tool.execute({})).toMatchObject({
      success: false,
      error: 'refused',
      data: ' { "success": false, "output": "retained", "error": "refused" } ',
    });
  });

  it.each([
    'not JSON',
    '{"success":"false","output":"","error":"refused"}',
    '{"success":false,"output":""}',
    '{"success":false,"output":"","error":""}',
    '{"success":true}',
  ])('refuses malformed declared invocation output: %s', async (raw) => {
    const tool = createZodFunctionTool(
      'Invalid',
      'Invalid declared protocol',
      z.object({}),
      async () => raw,
      { resultMode: 'invocation-json' },
    );
    await expect(tool.execute({})).rejects.toThrow();
  });

  it('keeps successful Read of failure-looking file contents successful', async () => {
    const result = await createReadTool({ cwd: root }).execute({
      filePath: join(root, 'existing.txt'),
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.data))).toMatchObject({
      success: true,
      output: expect.stringContaining('"success":false'),
    });
  });

  it('keeps no-match searches successful', async () => {
    for (const [tool, args] of [
      [createGlobTool({ cwd: root }), { pattern: '*.absent' }],
      [createGrepTool({ cwd: root }), { pattern: 'no-such-needle' }],
    ] as const) {
      expect(await tool.execute(args)).toMatchObject({ success: true });
    }
  });

  it('keeps nonzero command exits as successful domain outcomes with an exit code', async () => {
    for (const tool of [createShellTool({ cwd: root }), createBashTool({ cwd: root })]) {
      const result = await tool.execute({ command: 'exit 7' });
      expect(result.success).toBe(true);
      expect(JSON.parse(String(result.data))).toMatchObject({ success: true, exitCode: 7 });
    }
  });

  it('keeps headless questions as successful unavailable responses', async () => {
    const result = await createAskUserQuestionTool().execute({
      questions: [{ question: 'Choose?', options: ['A', 'B'] }],
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(String(result.data))).toMatchObject({ success: true });
  });

  it('keeps ToolSearch missing-catalog refusal as a hard failure', async () => {
    await expect(createToolSearchTool().execute({ query: 'Read' })).rejects.toThrow();
  });

  it.each(['read', 'write', 'edit-read', 'edit-write'])(
    'propagates an offered filesystem %s failure without a disk fallback',
    async (action) => {
      const sandboxClient: ISandboxClient = {
        filesystem: 'separate',
        run: async () => ({ stdout: '', exitCode: 0 }),
        readFile: async () => {
          if (action === 'read' || action === 'edit-read')
            throw new Error('Filesystem read refused');
          return 'BUFFER alpha';
        },
        writeFile: async () => {
          throw new Error('Filesystem write refused');
        },
      };
      const options = { cwd: root, sandboxClient };
      const result =
        action === 'read'
          ? await createReadTool(options).execute({ filePath: 'missing-remote.txt' })
          : action === 'write'
            ? await createWriteTool(options).execute({
                filePath: 'missing-remote.txt',
                content: 'blocked',
              })
            : await createEditTool(options).execute({
                filePath: 'missing-remote.txt',
                oldString: 'alpha',
                newString: 'beta',
              });
      expect(result.success).toBe(false);
      expect(JSON.parse(String(result.data))).toMatchObject({
        success: false,
        error: result.error,
      });
    },
  );
});
