import { describe, expect, it, vi } from 'vitest';

import { runJobTurns } from '../in-process-job-turns.js';
import { InProcessJobLog, jobLogPage } from '../in-process-job-log.js';

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
  it('releases its plaintext and ignores late captures after closure', () => {
    const log = new InProcessJobLog();
    log.startTurn('private prompt');
    expect(log.page('job', undefined).lines.join()).toContain('private prompt');
    log.clear();
    log.startTurn('late prompt');
    log.capture([
      {
        id: 'a',
        role: 'assistant',
        content: 'late answer',
        state: 'complete',
        timestamp: new Date(),
      },
    ]);
    expect(log.page('job', undefined).lines).toEqual([]);
  });
  it('includes text-only and embedded resource parts without repeating mirrored content', () => {
    const history = [
      {
        role: 'tool' as const,
        id: 't',
        toolCallId: 'call',
        content: 'mirrored',
        timestamp: new Date(),
        state: 'complete' as const,
        parts: [
          { type: 'text' as const, text: 'mirrored' },
          { type: 'text' as const, text: 'description' },
          { type: 'resource_embedded' as const, uri: 'fixture://item', text: 'resource contents' },
        ],
      },
    ];
    const page = jobLogPage('job', history, 0, { offset: 0 });
    const rendered = page.lines.join('\n');
    expect(rendered.match(/mirrored/g)).toHaveLength(1);
    expect(rendered).toContain('description');
    expect(rendered).toContain('resource contents');
  });
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

  it.each(['\u0000', '😀'])('bounds serialized transcript pages containing %s', (character) => {
    const text = character.repeat(4096 * 201);
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
    const wire = JSON.stringify({
      type: 'execution_detail',
      requestId: 'request',
      page: {
        entryId: 'task:job',
        records: first.lines.map((line, index) => ({
          id: `task:job:0:${index}`,
          kind: 'progress',
          text: line,
        })),
      },
    });
    expect(new TextEncoder().encode(wire).byteLength).toBeLessThanOrEqual(512 * 1024);
    expect(first.nextCursor).toBeDefined();
  });
});
