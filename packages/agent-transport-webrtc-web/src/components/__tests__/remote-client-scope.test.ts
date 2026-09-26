/**
 * The remote client is embedded by hosts with design tokens of their own (agent-web's playground). Its
 * root carries the GUI surface's `robota-ui` scope, so the surface's tokens and type apply inside it and
 * the host's stay outside.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RemoteClient } from '../RemoteClient.js';

describe('RemoteClient', () => {
  it('renders an unusable pairing link inside the robota-ui scope', () => {
    const html = renderToStaticMarkup(
      React.createElement(RemoteClient, { href: 'https://host.example/remote' }),
    );

    expect(html).toMatch(/^<div class="robota-ui[ "]/u);
    expect(html).toContain('Cannot pair');
  });
});
