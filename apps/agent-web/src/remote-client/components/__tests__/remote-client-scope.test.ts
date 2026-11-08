/** @jest-environment node */
import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';
/**
 * The remote client is embedded by hosts with design tokens of their own (agent-web's Studio palette). Its
 * root carries the GUI surface's `agent-ui` scope, so the surface's tokens and type apply inside it and
 * the host's stay outside.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// agent-ui-web's CommonJS build requires these ESM-only packages, which Jest cannot load. No case here renders
// markdown, so a stub is enough.
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

import { RemoteClient } from '../RemoteClient';

describe('RemoteClient', () => {
  it('renders an unusable pairing link inside the agent-ui scope', () => {
    const html = renderToStaticMarkup(
      React.createElement(RemoteClient, { product: { identity: { displayName: 'Test Product', cliName: 'test-product' }, storage: { browserNamespace: 'test-product' } }, cryptoContext: createIdentityContext('test-product'), credentialDatabase: 'test-product-credentials', href: 'https://host.example/remote' }),
    );

    expect(html).toMatch(/^<main class="agent-ui[ "]/u);
    expect(html).toContain('Cannot pair');
  });

  it('REGRESSION: that unusable-pairing-link state is the page\'s one `main` landmark, since no host of this component can be relied on to supply it', () => {
    const html = renderToStaticMarkup(
      React.createElement(RemoteClient, { product: { identity: { displayName: 'Test Product', cliName: 'test-product' }, storage: { browserNamespace: 'test-product' } }, cryptoContext: createIdentityContext('test-product'), credentialDatabase: 'test-product-credentials', href: 'https://host.example/remote' }),
    );

    expect(html.match(/<main[ >]/gu)?.length).toBe(1);
  });
});
