/**
 * Issue #2167 — the monitor entry's composition contracts, tested without a browser.
 *
 * `main.tsx` used to hold all three inline, which is why the package had no suite: nothing could be
 * imported without mounting. Each contract now lives in its own module and `main.tsx` only wires
 * them, so a wrong fallback host or a silently tolerated missing root fails here.
 */

import { describe, expect, it } from 'vitest';

import { ErrorBoundary } from '../error-boundary.js';
import { requireRootElement } from '../root-element.js';
import { readInjectedWsUrl, resolveWsUrl } from '../ws-url.js';

describe('WS URL selection', () => {
  it('prefers the injected <meta name="ws-url"> content', () => {
    expect(resolveWsUrl('ws://127.0.0.1:4321', 'localhost:8080')).toBe('ws://127.0.0.1:4321');
  });

  it('falls back to the page host when the meta tag is absent or empty', () => {
    expect(resolveWsUrl(null, 'localhost:8080')).toBe('ws://localhost:8080');
    expect(resolveWsUrl(undefined, 'localhost:8080')).toBe('ws://localhost:8080');
    expect(resolveWsUrl('   ', 'localhost:8080')).toBe('ws://localhost:8080');
  });

  it('reads the injected content off the document, and null when there is no tag', () => {
    const withTag = {
      querySelector: (selector: string) =>
        selector === 'meta[name="ws-url"]'
          ? ({ getAttribute: () => 'ws://injected' } as unknown as Element)
          : null,
    };
    expect(readInjectedWsUrl(withTag)).toBe('ws://injected');
    expect(readInjectedWsUrl({ querySelector: () => null })).toBeNull();
  });
});

describe('root-element admission', () => {
  it('refuses to start without #root rather than mounting somewhere invisible', () => {
    expect(() => requireRootElement({ getElementById: () => null })).toThrow('No #root element');
  });

  it('returns the #root element when present', () => {
    const root = { id: 'root' } as unknown as HTMLElement;
    expect(requireRootElement({ getElementById: (id) => (id === 'root' ? root : null) })).toBe(
      root,
    );
  });
});

describe('error boundary', () => {
  it('derives an error state from a thrown render error, so the failure is shown not blanked', () => {
    const error = new Error('render failed');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });
});
