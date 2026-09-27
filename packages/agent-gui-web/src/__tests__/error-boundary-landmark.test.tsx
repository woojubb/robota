// @vitest-environment jsdom
/**
 * #3289 §3 — the error screen `ErrorBoundary` shows in place of everything below it renders exactly
 * one `main` landmark, same as every other pre-session/fatal screen this issue covers. Nothing above
 * `ErrorBoundary` (agent-gui-web's `main.tsx`, the desktop app) supplies one.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../error-boundary.js';

afterEach(cleanup);

function Bomb(): React.ReactElement {
  throw new Error('boom');
}

describe('ErrorBoundary renders exactly one main landmark on the error screen (#3289 §3)', () => {
  it('once a render error below it is caught', () => {
    // React logs the error to the console as part of catching it; the assertion is on the landmark,
    // not the console, so a spy just keeps the test's own output quiet.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    spy.mockRestore();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.textContent).toContain('boom');
  });
});
