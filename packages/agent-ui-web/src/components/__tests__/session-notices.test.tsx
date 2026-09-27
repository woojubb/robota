// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionNotices } from '../SessionSurfaceChrome.js';

import type { ISessionNotice } from '../../hooks/session-client-types.js';
import type { IWsSessionState } from '../../hooks/useSessionClient.js';

/**
 * #3289 §3: a provider error used to show its raw text verbatim (`Provider Error (anthropic):
 * Anthropic request failed: 401 {"type":"error",...}`). A `session-error` notice classified at the
 * wire boundary now shows one plain sentence with the next step, and the raw text behind "Details".
 * An unclassified notice (no `code`) keeps showing its message directly, exactly as before.
 */

function notice(overrides: Partial<ISessionNotice>): ISessionNotice {
  return { id: 'n1', kind: 'session-error', message: 'raw detail', ...overrides };
}

function renderNotices(
  notices: readonly ISessionNotice[],
  extra: Partial<IWsSessionState> = {},
): void {
  const state = {
    sessionNotices: notices,
    dismissSessionNotice: vi.fn(),
    ...extra,
  } as unknown as IWsSessionState;
  render(<SessionNotices state={state} />);
}

afterEach(cleanup);

describe('SessionNotices maps a coded provider error to a plain sentence', () => {
  it('auth: names the provider and says to check the key', () => {
    renderNotices([
      notice({ code: 'auth', provider: 'anthropic', message: 'Authentication Error: invalid key' }),
    ]);
    expect(
      screen.getByText('Anthropic rejected the API key. Check the key for this provider.'),
    ).toBeTruthy();
  });

  it('rate_limit: names the wait when retryAfterSeconds is given', () => {
    renderNotices([
      notice({ code: 'rate_limit', provider: 'openai', retryAfterSeconds: 30, message: 'raw' }),
    ]);
    expect(
      screen.getByText('OpenAI is limiting requests. Try again in 30 seconds.'),
    ).toBeTruthy();
  });

  it('rate_limit: says "a moment" without retryAfterSeconds', () => {
    renderNotices([notice({ code: 'rate_limit', provider: 'openai', message: 'raw' })]);
    expect(screen.getByText('OpenAI is limiting requests. Try again in a moment.')).toBeTruthy();
  });

  it('model_unavailable: names the current model from session status', () => {
    renderNotices(
      [notice({ code: 'model_unavailable', provider: 'anthropic', message: 'raw' })],
      { sessionStatus: { model: 'claude-x' } as never },
    );
    expect(screen.getByText('The model "claude-x" isn\'t available with this key.')).toBeTruthy();
  });

  it('model_unavailable: still shows a plain sentence with no current model known', () => {
    renderNotices([notice({ code: 'model_unavailable', provider: 'anthropic', message: 'raw' })]);
    expect(screen.getByText("The model isn't available with this key.")).toBeTruthy();
  });

  it('network: says the connection could not reach the provider', () => {
    renderNotices([notice({ code: 'network', provider: 'gemini', message: 'raw' })]);
    expect(screen.getByText("Can't reach Gemini. Check your connection.")).toBeTruthy();
  });

  it('provider (unclassified but provider-attributed): a short generic sentence', () => {
    renderNotices([notice({ code: 'provider', provider: 'deepseek', message: 'raw detail here' })]);
    expect(screen.getByText('DeepSeek returned an error.')).toBeTruthy();
  });

  it('puts the raw message behind a Details disclosure for a coded notice', () => {
    renderNotices([notice({ code: 'auth', provider: 'anthropic', message: 'raw JSON detail' })]);
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getByText('raw JSON detail')).toBeTruthy();
  });

  it('shows the raw message directly for an uncoded notice, unchanged', () => {
    renderNotices([
      { id: 'n2', kind: 'session-change-refused', message: 'Stop the running turn first.' },
    ]);
    expect(screen.getByText('Stop the running turn first.')).toBeTruthy();
    expect(screen.queryByText('Details')).toBeNull();
  });
});
