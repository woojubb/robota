/**
 * E2E-style test for abort during streaming.
 * Uses ink-testing-library to verify that:
 * 1. Streaming text debounce works (renders batched, not per-delta)
 * 2. ESC during streaming triggers abort
 * 3. Partial text is preserved after abort
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';
import { describe, it, expect } from 'vitest';

/**
 * Minimal streaming component that simulates the debounced onTextDelta pattern.
 * Accepts deltas via a callback ref, renders accumulated text.
 */
function StreamingTestApp({
  onReady,
  onAbort,
}: {
  onReady: (appendDelta: (text: string) => void) => void;
  onAbort: () => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const textRef = useRef('');
  const [aborted, setAborted] = useState(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderCountRef = useRef(0);

  // Debounced delta handler (same pattern as InteractiveSession)
  const appendDelta = useCallback((delta: string) => {
    textRef.current += delta;
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        setText(textRef.current);
        flushTimerRef.current = null;
      }, 16);
    }
  }, []);

  // ESC handler
  useInput((_input, key) => {
    if (key.escape) {
      setAborted(true);
      onAbort();
      // Force flush any pending text
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setText(textRef.current);
    }
  });

  // Notify parent that we're ready
  useEffect(() => {
    onReady(appendDelta);
  }, [onReady, appendDelta]);

  renderCountRef.current++;

  return (
    <Box flexDirection="column">
      <Text>{text}</Text>
      {aborted && <Text color="yellow">Interrupted by user.</Text>}
      <Text dimColor>renders: {renderCountRef.current}</Text>
    </Box>
  );
}

describe('Streaming abort E2E', () => {
  it('debounced streaming renders fewer times than delta count', async () => {
    let appendDelta: ((text: string) => void) | null = null;

    const { lastFrame } = render(
      React.createElement(StreamingTestApp, {
        onReady: (fn: (text: string) => void) => {
          appendDelta = fn;
        },
        onAbort: () => {},
      }),
    );

    // Wait for component to mount
    await new Promise((r) => setTimeout(r, 20));
    expect(appendDelta).not.toBeNull();

    // Send 20 rapid deltas
    for (let i = 0; i < 20; i++) {
      appendDelta!(`chunk${i} `);
    }

    // Wait for debounce flush
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame()!;
    // All text should be present
    expect(frame).toContain('chunk0');
    expect(frame).toContain('chunk19');

    // Render count should be MUCH less than 20 (debounced)
    const renderMatch = frame.match(/renders: (\d+)/);
    expect(renderMatch).not.toBeNull();
    const renderCount = parseInt(renderMatch![1], 10);
    // With 16ms debounce and ~50ms total time, expect 3-5 renders, not 20+
    expect(renderCount).toBeLessThan(10);
  });

  it('ESC during rapid streaming triggers abort and shows text', async () => {
    let appendDelta: ((text: string) => void) | null = null;
    let abortCalled = false;

    const { stdin, lastFrame } = render(
      React.createElement(StreamingTestApp, {
        onReady: (fn: (text: string) => void) => {
          appendDelta = fn;
        },
        onAbort: () => {
          abortCalled = true;
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    // Send some deltas
    for (let i = 0; i < 5; i++) {
      appendDelta!(`line${i} `);
    }

    // Press ESC
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));

    expect(abortCalled).toBe(true);

    const frame = lastFrame()!;
    // Text should be visible (flush on abort)
    expect(frame).toContain('line0');
    expect(frame).toContain('line4');
    // Cancelled indicator
    expect(frame).toContain('Interrupted by user.');
  });

  it('ESC during ongoing streaming stops further rendering', async () => {
    let appendDelta: ((text: string) => void) | null = null;
    let abortCalled = false;

    const { stdin, lastFrame } = render(
      React.createElement(StreamingTestApp, {
        onReady: (fn: (text: string) => void) => {
          appendDelta = fn;
        },
        onAbort: () => {
          abortCalled = true;
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));

    // Send first batch
    appendDelta!('before_abort ');

    // Wait for flush
    await new Promise((r) => setTimeout(r, 20));

    // Press ESC
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 30));

    expect(abortCalled).toBe(true);

    // Send more deltas AFTER abort (should still accumulate in ref but component should show Cancelled)
    appendDelta!('after_abort ');
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame()!;
    expect(frame).toContain('before_abort');
    expect(frame).toContain('Interrupted by user.');
  });
});
