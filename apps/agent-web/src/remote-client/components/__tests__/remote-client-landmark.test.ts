/** @jest-environment node */
import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';
/**
 * `RemoteClient` owns the page's ONE `main` landmark in every state it can be in,
 * not just once `ConversationView` mounts and supplies its own. A host embedding it (e.g. `apps/
 * agent-web`'s `/remote` route) cannot be relied on to supply a landmark for the states before a
 * conversation starts — its root layout supplies none of its own, on the same reasoning this
 * component's error state (`remote-client-scope.test.ts`) already covers.
 */

import { toPairingUrl } from '@robota-sdk/agent-remote-pairing';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../../hooks/useRtcSession', () => ({
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

// agent-ui-web's CommonJS build requires these ESM-only packages, which Jest cannot load. No case here renders
// markdown, so a stub is enough.
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

import { RemoteClient } from '../RemoteClient';

/** A pairing link `parseRemoteClientLocation` accepts, so `RemoteClient` reaches its connected states. */
function pairedHref(): string {
  return toPairingUrl('https://remote.example/?relay=wss%3A%2F%2Frelay.test', {
    rendezvous: 'rv-abc',
    secret: 'sec-xyz',
  });
}

describe('RemoteClient owns exactly one main landmark before a conversation starts', () => {
  it('renders exactly one main while connecting, with no conversation yet', () => {
    const html = renderToStaticMarkup(React.createElement(RemoteClient, { product: { identity: { displayName: 'Test Product', cliName: 'test-product' }, storage: { browserNamespace: 'test-product' } }, cryptoContext: createIdentityContext('test-product'), credentialDatabase: 'test-product-credentials', href: pairedHref() }));
    expect(html.match(/<main[ >]/gu)?.length).toBe(1);
  });
});
