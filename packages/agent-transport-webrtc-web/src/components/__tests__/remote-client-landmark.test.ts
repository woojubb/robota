import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';
/**
 * #3289 §3 review — `RemoteClient` owns the page's ONE `main` landmark in every state it can be in,
 * not just once `ConversationView` mounts and supplies its own. A host embedding it (e.g. `apps/
 * agent-web`'s `/remote` route) cannot be relied on to supply a landmark for the states before a
 * conversation starts — its root layout supplies none of its own, on the same reasoning this
 * component's error state (`remote-client-scope.test.ts`) already covers.
 */

import { toPairingUrl } from '@robota-sdk/agent-remote-pairing';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useRtcSession.js', () => ({
  useRtcSession: () => ({
    status: 'connecting',
    messages: [],
    activeTools: [],
    isThinking: false,
    streamingText: '',
    ownDriverId: null,
    pendingPrompts: [],
    answerPermission: () => undefined,
    answerAsk: () => undefined,
  }),
}));

import { RemoteClient } from '../RemoteClient.js';

/** A pairing link `parseRemoteClientLocation` accepts, so `RemoteClient` reaches its connected states. */
function pairedHref(): string {
  return toPairingUrl('https://remote.example/?relay=wss%3A%2F%2Frelay.test', {
    rendezvous: 'rv-abc',
    secret: 'sec-xyz',
  });
}

describe('RemoteClient owns exactly one main landmark before a conversation starts (#3289 §3 review)', () => {
  it('renders exactly one main while connecting, with no conversation yet', () => {
    const html = renderToStaticMarkup(React.createElement(RemoteClient, { product: { identity: { displayName: 'Test Product', cliName: 'test-product' }, storage: { browserNamespace: 'test-product' } }, cryptoContext: createIdentityContext('test-product'), credentialDatabase: 'test-product-credentials', href: pairedHref() }));
    expect(html.match(/<main[ >]/gu)?.length).toBe(1);
  });
});
