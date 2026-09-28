// @vitest-environment jsdom
/**
 * #3289 §3 review — `SessionMonitor` renders exactly one `main` landmark whether or not it is
 * connected. Nothing above it supplies one, so its own disconnected/connecting/error placeholder
 * must carry the landmark itself, same as the connected branch's `ConversationView` already does.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useSessionClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useSessionClient.js')>()),
  useWsSession: () => ({
    status: 'connecting',
    messages: [],
    activeTools: [],
    streamingText: '',
    isThinking: false,
    executionWorkspace: null,
    ownDriverId: null,
    send: () => {},
  }),
}));

import { SessionMonitor } from '../SessionMonitor.js';

afterEach(cleanup);

describe('SessionMonitor renders exactly one main landmark before it connects (#3289 §3 review)', () => {
  it('while connecting, with no session yet', () => {
    const { container } = render(<SessionMonitor wsUrl="ws://localhost:7070" />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
