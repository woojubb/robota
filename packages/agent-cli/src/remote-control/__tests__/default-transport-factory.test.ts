/**
 * The resume bridge the remote-control controller builds serves a WebRTC data channel, which
 * carries a fraction of the inbound frame limit and buffers each frame before sending it. An app
 * view over a history page's worth must be refused before it is buffered, not after `send` throws.
 */
import { HISTORY_PAGE_MAX_BYTES } from '@robota-sdk/agent-transport';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { defaultCreateResumeBridge } from '../default-transport-factory.js';

const view = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
};

function frames(sent: string[]): Array<{ type: string }> {
  return sent.map((data) => JSON.parse(data) as { type: string });
}

describe('the default resume bridge for the remote-control transport', () => {
  it('refuses an app view larger than a history page, and sends one that fits', () => {
    let current: unknown = { ...view, html: 'x'.repeat(HISTORY_PAGE_MAX_BYTES) };
    const session = createTestInteractiveSession({
      readToolAppView: vi.fn(() => current) as never,
    });
    const bridge = defaultCreateResumeBridge(session);
    const sent: string[] = [];
    bridge.attach((data) => void sent.push(data), { onDeliveryError: vi.fn() });
    const read = JSON.stringify({ type: 'read-app-view', requestId: 'v1', viewId: 'view-1' });

    bridge.onClientMessage(read);
    expect(frames(sent).map((frame) => frame.type)).toEqual(['protocol_error']);

    current = view;
    bridge.onClientMessage(read);
    expect(frames(sent).map((frame) => frame.type)).toEqual(['protocol_error', 'app_view']);
    bridge.dispose();
  });
});
