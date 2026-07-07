import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { describe, expect, it } from 'vitest';

import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from '../create-tools';

import type {
  IToolExecutionContext,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';

interface IToolJsonResult {
  success: boolean;
  output: string;
  error?: string;
}

async function runJsonTool(
  tool: IToolWithEventService,
  args: TToolParameters,
): Promise<IToolJsonResult> {
  const context: IToolExecutionContext = {
    toolName: tool.getName(),
    parameters: args,
  };
  const wrapper = await tool.execute(args, context);
  const data = wrapper.data;
  return (typeof data === 'string' ? JSON.parse(data) : data) as IToolJsonResult;
}

function getTool(tools: IToolWithEventService[], name: string): IToolWithEventService {
  const tool = tools.find((candidate) => candidate.getName() === name);
  expect(tool, `expected ${name} tool`).toBeDefined();
  return tool!;
}

describe('createDefaultTools', () => {
  it('assembles all default local tools and describes web tools as local tools', () => {
    expect(createDefaultTools().map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);

    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain(
      'WebSearch — search the internet through the configured local tool',
    );
  });

  it('accepts a sandbox client while preserving the default tool list', () => {
    const sandboxClient = new InMemorySandboxClient();

    expect(createDefaultTools({ sandboxClient }).map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);
  });

  it('binds Glob default searches to the session cwd', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'robota-glob-cwd-'));
    try {
      writeFileSync(join(workspace, 'robota-cwd-sentinel.txt'), 'inside\n');
      const glob = getTool(createDefaultTools({ cwd: workspace }), 'Glob');

      const result = await runJsonTool(glob, { pattern: 'robota-cwd-sentinel.txt' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('robota-cwd-sentinel.txt');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('blocks Glob paths outside the session cwd', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'robota-glob-workspace-'));
    const outside = mkdtempSync(join(tmpdir(), 'robota-glob-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'outside\n');
      const glob = getTool(createDefaultTools({ cwd: workspace }), 'Glob');

      const result = await runJsonTool(glob, {
        pattern: 'secret.txt',
        path: outside,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the working directory/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('binds Grep default searches to the session cwd', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'robota-grep-cwd-'));
    try {
      writeFileSync(join(workspace, 'inside.txt'), 'robota-grep-needle\n');
      const grep = getTool(createDefaultTools({ cwd: workspace }), 'Grep');

      const result = await runJsonTool(grep, { pattern: 'robota-grep-needle' });

      expect(result.success).toBe(true);
      expect(result.output).toContain(join(workspace, 'inside.txt'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('blocks Grep paths outside the session cwd', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'robota-grep-workspace-'));
    const outside = mkdtempSync(join(tmpdir(), 'robota-grep-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'robota-outside-secret\n');
      const grep = getTool(createDefaultTools({ cwd: workspace }), 'Grep');

      const result = await runJsonTool(grep, {
        pattern: 'robota-outside-secret',
        path: outside,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the working directory/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
