/**
 * Tests for prompt queue — submit during execution queues prompt,
 * auto-executes after completion, backspace cancels queue, ESC aborts.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';
import { describe, it, expect, vi } from 'vitest';

interface IQueueTestController {
  completeCurrent?: () => void;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  let lastError: Error | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  if (lastError) throw lastError;
  throw new Error('Timed out waiting for assertion');
}

/**
 * Minimal App that simulates the prompt queue behavior.
 */
function QueueTestApp({
  onExecute,
  onAbort,
  controller,
}: {
  onExecute: (prompt: string) => void;
  onAbort?: () => void;
  controller?: IQueueTestController;
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
      await new Promise<void>((resolve) => {
        if (controller) {
          controller.completeCurrent = () => {
            controller.completeCurrent = undefined;
            resolve();
          };
          return;
        }
        setTimeout(resolve, 300);
      });
      setIsThinking(false);
    },
    [controller, onExecute],
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
    const controller: IQueueTestController = {};
    const { stdin, lastFrame } = render(
      <QueueTestApp onExecute={onExecute} controller={controller} />,
    );

    stdin.write('s:first');
    await waitForAssertion(() => expect(lastFrame()!).toContain('thinking=true'));

    stdin.write('s:second');
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=second'));

    controller.completeCurrent?.();
    await waitForAssertion(() => expect(onExecute).toHaveBeenCalledWith('second'));

    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).toHaveBeenCalledWith('second');
  });

  it('only queues 1 prompt — last one wins', async () => {
    const onExecute = vi.fn();
    const controller: IQueueTestController = {};
    const { stdin, lastFrame } = render(
      <QueueTestApp onExecute={onExecute} controller={controller} />,
    );

    stdin.write('s:first');
    await waitForAssertion(() => expect(lastFrame()!).toContain('thinking=true'));

    stdin.write('s:second');
    await new Promise((r) => setTimeout(r, 5));
    stdin.write('s:third');
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=third'));

    controller.completeCurrent?.();
    await waitForAssertion(() => expect(onExecute).toHaveBeenCalledWith('third'));

    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).toHaveBeenCalledWith('third');
    expect(onExecute).not.toHaveBeenCalledWith('second');
  });

  it('ESC aborts execution and clears queue', async () => {
    const onExecute = vi.fn();
    const onAbort = vi.fn();
    const controller: IQueueTestController = {};
    const { stdin, lastFrame } = render(
      <QueueTestApp onExecute={onExecute} onAbort={onAbort} controller={controller} />,
    );

    stdin.write('s:first');
    await waitForAssertion(() => expect(lastFrame()!).toContain('thinking=true'));

    stdin.write('s:queued');
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=queued'));

    stdin.write('\x1B');
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=none'));

    expect(onAbort).toHaveBeenCalled();

    controller.completeCurrent?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecute).not.toHaveBeenCalledWith('queued');
  });

  it('Backspace cancels queue without aborting', async () => {
    const onExecute = vi.fn();
    const onAbort = vi.fn();
    const controller: IQueueTestController = {};
    const { stdin, lastFrame } = render(
      <QueueTestApp onExecute={onExecute} onAbort={onAbort} controller={controller} />,
    );

    stdin.write('s:first');
    await waitForAssertion(() => expect(lastFrame()!).toContain('thinking=true'));

    stdin.write('s:queued');
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=queued'));

    stdin.write('\x7F'); // backspace
    await waitForAssertion(() => expect(lastFrame()!).toContain('pending=none'));

    expect(lastFrame()!).toContain('queue-cleared');
    expect(onAbort).not.toHaveBeenCalled();

    // Execution continues normally
    controller.completeCurrent?.();
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecute).toHaveBeenCalledWith('first');
    expect(onExecute).not.toHaveBeenCalledWith('queued');
  });
});
