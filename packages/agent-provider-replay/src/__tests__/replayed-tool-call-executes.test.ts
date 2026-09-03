/**
 * Issue #2302 — a tool call carried by a replayed provider response IS dispatched and executed.
 *
 * The measurement behind the issue (`-p` print mode, a `Read` probe whose content never reached
 * stdout) could not tell three causes apart. This drives the real `Session` loop with a
 * `ReplayProvider` and a live tool, and settles it: the recorded call reaches the tool with its
 * recorded arguments, the tool RESULT goes back into the conversation for the next recorded round,
 * and the run's return value is the final recorded text. Print mode writes only that final text to
 * stdout, so a tool's result is invisible THERE by design — a reporting property, not an execution
 * defect. The replay substitutes the model, never the tools.
 */
import { FunctionTool, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-session';
import { describe, expect, it, vi } from 'vitest';

import { ReplayProvider } from '../replay-provider.js';

import type { ISessionLogEntry } from '@robota-sdk/agent-session';

function line(event: string, data: Record<string, unknown>): ISessionLogEntry {
  return {
    timestamp: '2026-06-28T00:00:00.000Z',
    sessionId: 's1',
    event,
    ...data,
  } as ISessionLogEntry;
}

const TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

// An `inspect` tool is auto-approved in `default` mode, so no approver is needed to reach `execute`.
registerToolPermissionProfile('Probe', { riskClass: 'inspect' });

describe('a replayed tool call executes against the live tool set (issue #2302)', () => {
  it('dispatches the recorded call, feeds its result back, and returns the final recorded text', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: 'PROBE-RESULT' });
    const probe = new FunctionTool(
      {
        name: 'Probe',
        description: 'records that it ran',
        parameters: { type: 'object', properties: { x: { type: 'number' } } },
      },
      execute,
    );
    const provider = new ReplayProvider({
      entries: [
        line('provider_response_normalized', {
          round: 0,
          response: {
            role: 'assistant',
            content: '',
            id: 'a1',
            timestamp: '2026-06-28T00:00:01.000Z',
            toolCalls: [
              { id: 't1', type: 'function', function: { name: 'Probe', arguments: '{"x":1}' } },
            ],
          },
        }),
        line('provider_response_normalized', {
          round: 1,
          response: {
            role: 'assistant',
            content: 'two',
            id: 'a2',
            timestamp: '2026-06-28T00:00:02.000Z',
          },
        }),
      ],
    });
    const chat = vi.spyOn(provider, 'chat');
    const session = new Session({
      tools: [probe] as never,
      provider,
      systemMessage: 'test',
      terminal: TERMINAL,
      cwd: '/tmp/replay-2302',
    } as never);

    const output = await session.run('go');

    expect(output).toBe('two');
    expect(execute, 'the recorded tool call never reached the tool').toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ x: 1 });
    // The second recorded round is asked for only after the tool result was appended.
    const secondCallMessages = chat.mock.calls[1]?.[0] as Array<{
      role: string;
      content?: unknown;
    }>;
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
    await session.shutdown();
  });
});
