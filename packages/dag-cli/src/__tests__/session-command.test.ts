import { describe, it, expect } from 'vitest';
import { sessionCommand } from '../commands/session.js';
import type { IDagCliIo } from '../types.js';

function makeIo(): { io: IDagCliIo; output: string[] } {
  const output: string[] = [];
  const io: IDagCliIo = {
    write: (s) => {
      output.push(s);
    },
    writeError: (s) => {
      output.push(s);
    },
    readTextFile: async () => '',
    writeBinaryStream: async () => {},
  };
  return { io, output };
}

function getOutput(output: string[]): string {
  return output.join('');
}

describe('sessionCommand', () => {
  describe('help', () => {
    it('prints help with no args', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand([], { io });
      expect(code).toBe(0);
      expect(getOutput(output)).toContain('dag session');
    });

    it('prints help with --help', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['--help'], { io });
      expect(code).toBe(0);
      expect(getOutput(output)).toContain('create');
    });

    it('returns error for unknown subcommand', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['delete'], { io });
      expect(code).toBe(2);
      expect(getOutput(output)).toContain('unknown session subcommand');
    });
  });

  describe('session create', () => {
    it('creates a session with no restrictions', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['create'], { io });
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('Session ID:');
      expect(text).toContain('DAG_SESSION_PERMISSIONS=');
      expect(text).toContain('(all)');
      expect(text).toContain('(unlimited)');
    });

    it('creates a session with --max-cost', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['create', '--max-cost', '1.50'], { io });
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('$1.50');
      expect(text).toContain('"maxCostUsd":1.5');
    });

    it('creates a session with --allowed-nodes', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(
        ['create', '--allowed-nodes', 'input,llm-text-anthropic,text-output'],
        { io },
      );
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('allowedNodeTypes');
      expect(text).toContain('llm-text-anthropic');
      expect(text).toContain('"allowedNodeTypes"');
    });

    it('creates a session with --denied-nodes', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['create', '--denied-nodes', 'llm-text-openai'], { io });
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('deniedNodeTypes');
      expect(text).toContain('llm-text-openai');
    });

    it('creates a session with --no-instant-nodes', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(['create', '--no-instant-nodes'], { io });
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('canCreateInstantNodes: false');
      expect(text).toContain('"canCreateInstantNodes":false');
    });

    it('creates a session with multiple constraints', async () => {
      const { io, output } = makeIo();
      const code = await sessionCommand(
        [
          'create',
          '--max-cost',
          '0.50',
          '--allowed-nodes',
          'input,text-output',
          '--no-instant-nodes',
        ],
        { io },
      );
      expect(code).toBe(0);
      const text = getOutput(output);
      expect(text).toContain('$0.50');
      expect(text).toContain('input, text-output');
      expect(text).toContain('canCreateInstantNodes: false');
    });

    it('returns error for --max-cost with no value', async () => {
      const { io } = makeIo();
      const code = await sessionCommand(['create', '--max-cost'], { io });
      expect(code).toBe(2);
    });

    it('returns error for --max-cost with invalid value', async () => {
      const { io } = makeIo();
      const code = await sessionCommand(['create', '--max-cost', 'abc'], { io });
      expect(code).toBe(2);
    });

    it('returns error for unexpected argument', async () => {
      const { io } = makeIo();
      const code = await sessionCommand(['create', '--unknown-flag'], { io });
      expect(code).toBe(2);
    });

    it('env var JSON is parseable', async () => {
      const { io, output } = makeIo();
      await sessionCommand(
        ['create', '--max-cost', '2.00', '--allowed-nodes', 'input,text-output'],
        { io },
      );
      const text = getOutput(output);
      const match = text.match(/DAG_SESSION_PERMISSIONS='([^']+)'/);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]) as Record<string, unknown>;
      expect(parsed.maxCostUsd).toBe(2.0);
      expect(Array.isArray(parsed.allowedNodeTypes)).toBe(true);
    });
  });
});
