import { describe, expect, it, vi } from 'vitest';

import { runJobTurns } from '../in-process-job-turns.js';
import { jobLogPage } from '../in-process-job-log.js';

describe('accepted in-process follow-ups', () => {
  it('runs queued input after a turn fails and reports the failure', async () => {
    let failFirst!: (error: Error) => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            failFirst = reject;
          }),
      )
      .mockResolvedValueOnce('second completed');
    const job = runJobTurns({ run }, 'first', 'job');
    const result = expect(job.result).rejects.toThrow('first failed');
    await job.send('second');
    failFirst(new Error('first failed'));
    await result;
    expect(run.mock.calls.map(([prompt]) => prompt)).toEqual(['first', 'second']);
  });
});

describe('in-process job log', () => {
  it('retains all of a long message and tool arguments', () => {
    const text = 'x'.repeat(5000);
    const argumentsText = 'y'.repeat(5000);
    const history = [
      {
        role: 'assistant' as const,
        content: text,
        id: 'a',
        timestamp: new Date(),
        state: 'complete' as const,
        toolCalls: [
          {
            id: 't',
            type: 'function' as const,
            function: { name: 'Read', arguments: argumentsText },
          },
        ],
      },
    ];
    const page = jobLogPage('job', history, 0, { offset: 0 });
    expect(page.lines.join('')).toContain(text);
    expect(page.lines.join('')).toContain(argumentsText);
  });

  it('continues within a message longer than one page without splitting emoji', () => {
    const text = `${'x'.repeat(4090)}😀${'z'.repeat(4096 * 201)}`;
    const history = [
      {
        role: 'assistant' as const,
        content: text,
        id: 'a',
        timestamp: new Date(),
        state: 'complete' as const,
      },
    ];
    const first = jobLogPage('job', history, 0, { offset: 0 });
    expect(first.nextCursor).toBeDefined();
    const second = jobLogPage('job', history, 0, first.nextCursor);
    expect([...first.lines, ...second.lines].join('')).toBe(`assistant: ${text}`);
    expect([...first.lines, ...second.lines].every((line) => !/[\ud800-\udbff]$/u.test(line))).toBe(
      true,
    );
  });
});
