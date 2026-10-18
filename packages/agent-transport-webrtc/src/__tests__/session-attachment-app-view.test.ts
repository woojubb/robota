/**
 * A data channel carries a fraction of the inbound frame limit, and `channel.send` throws and closes
 * the channel on a frame it cannot carry. An app view or app tool result is the one reply a session
 * can make arbitrarily large, so the direct-handler path refuses one over a history page's worth
 * before it reaches the channel.
 */
import { HISTORY_PAGE_MAX_BYTES } from '@robota-sdk/agent-transport';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { attachSession } from '../session-attachment.js';

import type { IPairingChannel } from '../pairing-gate-options.js';

const view = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
};

function channel(): IPairingChannel & { sent: string[] } {
  const sent: string[] = [];
  return { sent, send: (data: string) => void sent.push(data), close: () => undefined };
}

function attachWith(readToolAppView: () => unknown) {
  const target = channel();
  const session = createTestInteractiveSession({
    readToolAppView: vi.fn(readToolAppView) as never,
  });
  const attached = attachSession({ channel: target, session }, false, () => undefined);
  return { target, attached };
}

describe('attachSession and the data channel frame limit', () => {
  it('refuses an app view larger than a history page instead of sending it to the channel', () => {
    const { target, attached } = attachWith(() => ({
      ...view,
      html: 'x'.repeat(HISTORY_PAGE_MAX_BYTES),
    }));

    attached.onSessionMessage(
      JSON.stringify({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' }),
    );

    expect(target.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'protocol_error', message: 'This app view is too large to send.', requestId: 'v1' },
    ]);
    attached.cleanup();
  });

  it('still sends an app view that fits', () => {
    const { target, attached } = attachWith(() => view);

    attached.onSessionMessage(
      JSON.stringify({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' }),
    );

    expect(target.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'app_view', requestId: 'v1', view },
    ]);
    attached.cleanup();
  });
});
