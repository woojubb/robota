/**
 * Test: ESC abort after permission prompt was shown and dismissed.
 * Verifies that useInput re-registers properly after isActive toggles.
 */

import React, { useState, useCallback } from 'react';
import { render } from 'ink-testing-library';
import { Box, Text, useInput } from 'ink';
import { describe, it, expect } from 'vitest';

/**
 * Simulates App's useInput pattern with permission prompt toggle.
 * 1. Start with "thinking" active
 * 2. Permission prompt appears (useInput disabled)
 * 3. Permission resolved (useInput re-enabled)
 * 4. ESC should trigger abort
 */
function AbortAfterPermissionApp({
  onAbort,
  onPermissionReady,
}: {
  onAbort: () => void;
  onPermissionReady: (grantPermission: () => void) => void;
}): React.ReactElement {
  const [isThinking, setIsThinking] = useState(true);
  const [permissionRequest, setPermissionRequest] = useState<{
    resolve: () => void;
  } | null>(null);
  const [aborted, setAborted] = useState(false);

  // Simulate permission prompt appearing after mount
  const showPermission = useCallback(() => {
    setPermissionRequest({
      resolve: () => {
        setPermissionRequest(null);
      },
    });
  }, []);

  // Give parent a way to grant permission
  React.useEffect(() => {
    // Show permission prompt immediately
    const pr = {
      resolve: () => setPermissionRequest(null),
    };
    setPermissionRequest(pr);
    onPermissionReady(() => pr.resolve());
  }, [onPermissionReady]);

  // App's ESC handler — same pattern as real App.tsx
  useInput(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape && isThinking) {
        setAborted(true);
        onAbort();
      }
    },
    { isActive: !permissionRequest },
  );

  // Permission prompt's own useInput (when active)
  useInput(
    (_input: string, key: { return: boolean }) => {
      if (key.return && permissionRequest) {
        permissionRequest.resolve();
      }
    },
    { isActive: !!permissionRequest },
  );

  return (
    <Box flexDirection="column">
      {permissionRequest && <Text color="yellow">[Permission Required]</Text>}
      {!permissionRequest && isThinking && <Text color="cyan">Streaming...</Text>}
      {aborted && <Text color="red">Aborted!</Text>}
      <Text dimColor>
        thinking={String(isThinking)} permission={String(!!permissionRequest)} aborted=
        {String(aborted)}
      </Text>
    </Box>
  );
}

describe('ESC abort after permission prompt', () => {
  it('ESC works when no permission prompt was shown', async () => {
    let abortCalled = false;
    const grantHolder: { fn: (() => void) | null } = { fn: null };

    const { stdin, lastFrame } = render(
      <AbortAfterPermissionApp
        onAbort={() => {
          abortCalled = true;
        }}
        onPermissionReady={(fn) => {
          grantHolder.fn = fn;
        }}
      />,
    );

    // Wait for mount
    await new Promise((r) => setTimeout(r, 20));

    // Grant permission immediately
    grantHolder.fn?.();
    await new Promise((r) => setTimeout(r, 50));

    // Now ESC should work
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));

    expect(abortCalled).toBe(true);
    expect(lastFrame()!).toContain('Aborted!');
  });

  it('ESC works AFTER permission prompt was shown and dismissed', async () => {
    let abortCalled = false;
    const grantHolder: { fn: (() => void) | null } = { fn: null };

    const { stdin, lastFrame } = render(
      <AbortAfterPermissionApp
        onAbort={() => {
          abortCalled = true;
        }}
        onPermissionReady={(fn) => {
          grantHolder.fn = fn;
        }}
      />,
    );

    // Wait for permission prompt to appear
    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()!).toContain('[Permission Required]');

    // Grant permission (dismiss prompt)
    grantHolder.fn?.();
    await new Promise((r) => setTimeout(r, 50));

    // Permission dismissed, streaming should show
    expect(lastFrame()!).toContain('Streaming...');
    expect(lastFrame()!).not.toContain('[Permission Required]');

    // Now press ESC — should trigger abort
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));

    expect(abortCalled).toBe(true);
    expect(lastFrame()!).toContain('Aborted!');
  });

  it('ESC does NOT work during permission prompt', async () => {
    let abortCalled = false;

    const { stdin, lastFrame } = render(
      <AbortAfterPermissionApp
        onAbort={() => {
          abortCalled = true;
        }}
        onPermissionReady={() => {}}
      />,
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(lastFrame()!).toContain('[Permission Required]');

    // ESC during permission prompt should NOT trigger abort
    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 50));

    expect(abortCalled).toBe(false);
    expect(lastFrame()!).not.toContain('Aborted!');
  });
});
