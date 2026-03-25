/**
 * Tests for prompt queue — submit during execution queues prompt,
 * auto-executes after completion, backspace cancels queue, ESC aborts.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';
import { describe, it, expect, vi } from 'vitest';

/**
 * Minimal App that simulates the prompt queue behavior.
 */
function QueueTestApp({
  onExecute,
  onAbort,
}: {
  onExecute: (prompt: string) => void;
  onAbort?: () => void;
}): React.ReactElement {
  const [isThinking, setIsThinking] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const executePrompt = useCallback(
    async (input: string) => {
      setIsThinking(true);
      setLog((prev) => [...prev, `exec:${input}`]);
      onExecute(input);
      await new Promise((r) => setTimeout(r, 300));
      setIsThinking(false);
    },
    [onExecute],
  );

  const handleSubmit = useCallback(
    async (input: string) => {
      if (isThinking) {
        setPendingPrompt(input);
        pendingRef.current = input;
        setLog((prev) => [...prev, `queued:${input}`]);
        return;
      }
      await executePrompt(input);
    },
    [isThinking, executePrompt],
  );

  useInput((_input, key) => {
    // ESC always aborts + clears queue
    if (key.escape && isThinking) {
      setIsAborting(true);
      setPendingPrompt(null);
      pendingRef.current = null;
      onAbort?.();
    }
    // Backspace cancels queue only
    if ((key.backspace || key.delete) && pendingRef.current) {
      setPendingPrompt(null);
      pendingRef.current = null;
      setLog((prev) => [...prev, 'queue-cleared']);
    }
  });

  // Auto-execute queued prompt when thinking ends
  useEffect(() => {
    if (!isThinking) {
      setIsAborting(false);
      if (pendingRef.current) {
        const prompt = pendingRef.current;
        setPendingPrompt(null);
        pendingRef.current = null;
        setTimeout(() => executePrompt(prompt), 0);
      }
    }
  }, [isThinking, executePrompt]);

  return (
    <Box flexDirection="column">
      <Text>thinking={String(isThinking)}</Text>
      <Text>pending={pendingPrompt ?? 'none'}</Text>
      <Text>aborting={String(isAborting)}</Text>
      <Text>log={log.join(',')}</Text>
      <SubmitTrigger onSubmit={handleSubmit} />
    </Box>
  );
}

function SubmitTrigger({
  onSubmit,
}: {
  onSubmit: (input: string) => Promise<void>;
}): React.ReactElement {
  useInput((input) => {
    if (input.startsWith('s:')) {
      onSubmit(input.slice(2));
    }
  });
  return <></>;
}

describe('Prompt Queue', () => {
  it('executes prompt normally when not thinking', async () => {
    const onExecute = vi.fn();
    const { lastFrame } = render(<QueueTestApp onExecute={onExecute} />);

    lastFrame(); // trigger render
    // Simulate submit via stdin
    const { stdin } = render(<QueueTestApp onExecute={onExecute} />);
    stdin.write('s:hello');
    await new Promise((r) => setTimeout(r, 100));

    expect(onExecute).toHaveBeenCalledWith('hello');
  });

  it('queues prompt when thinking, auto-executes after completion', async () => {
    const onExecute = vi.fn();
    const { stdin, lastFrame } = render(<QueueTestApp onExecute={onExecute} />);

    stdin.write('s:first');
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()!).toContain('thinking=true');

    stdin.write('s:second');
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()!).toContain('pending=second');

    await new Promise((r) => setTimeout(r, 700));

    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).toHaveBeenCalledWith('second');
  });

  it('only queues 1 prompt — last one wins', async () => {
    const onExecute = vi.fn();
    const { stdin, lastFrame } = render(<QueueTestApp onExecute={onExecute} />);

    stdin.write('s:first');
    await new Promise((r) => setTimeout(r, 10));

    stdin.write('s:second');
    await new Promise((r) => setTimeout(r, 5));
    stdin.write('s:third');
    await new Promise((r) => setTimeout(r, 10));

    expect(lastFrame()!).toContain('pending=third');

    await new Promise((r) => setTimeout(r, 700));

    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).toHaveBeenCalledWith('third');
    expect(onExecute).not.toHaveBeenCalledWith('second');
  });

  it('ESC aborts execution and clears queue', async () => {
    const onExecute = vi.fn();
    const onAbort = vi.fn();
    const { stdin, lastFrame } = render(<QueueTestApp onExecute={onExecute} onAbort={onAbort} />);

    stdin.write('s:first');
    await new Promise((r) => setTimeout(r, 10));

    stdin.write('s:queued');
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()!).toContain('pending=queued');

    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 100));

    expect(lastFrame()!).toContain('pending=none');
    expect(onAbort).toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 700));
    expect(onExecute).not.toHaveBeenCalledWith('queued');
  });

  it('Backspace cancels queue without aborting', async () => {
    const onExecute = vi.fn();
    const onAbort = vi.fn();
    const { stdin, lastFrame } = render(<QueueTestApp onExecute={onExecute} onAbort={onAbort} />);

    stdin.write('s:first');
    await new Promise((r) => setTimeout(r, 10));

    stdin.write('s:queued');
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame()!).toContain('pending=queued');

    stdin.write('\x7F'); // backspace
    await new Promise((r) => setTimeout(r, 100));

    expect(lastFrame()!).toContain('pending=none');
    expect(lastFrame()!).toContain('queue-cleared');
    expect(onAbort).not.toHaveBeenCalled();

    // Execution continues normally
    await new Promise((r) => setTimeout(r, 700));
    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).not.toHaveBeenCalledWith('queued');
  });
});
