import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import SessionPicker from '../SessionPicker.js';
import { shortSessionId } from '../short-session-id.js';

import type {
  IResumableSessionSummary,
  ISessionListingEntry,
} from '@robota-sdk/agent-interface-session';

function summary(id: string, name?: string): IResumableSessionSummary {
  return {
    id,
    cwd: '/w',
    updatedAt: '2026-09-26T10:00:00.000Z',
    messageCount: 2,
    preview: '',
    ...(name !== undefined ? { name } : {}),
  };
}

describe('session ids on screen', () => {
  it('shortens an id to the part that tells sessions apart, not the prefix they share', () => {
    expect(shortSessionId('session_07d291bc-4d43-4d26-9375-7d8ca0e60e6f')).toBe('07d291bc');
    expect(shortSessionId('session_1773862349776_rnecma5lu')).toBe('17738623');
    expect(shortSessionId('host-session-id')).toBe('host-ses');
    expect(shortSessionId('session_')).toBe('session_');
  });

  it('lists unnamed sessions by distinct ids, and named ones by name', () => {
    const view = render(
      <SessionPicker
        sessions={[
          summary('session_07d291bc-4d43-4d26-9375-7d8ca0e60e6f'),
          summary('session_15f05245-1f06-4375-8f29-db19e622afdd'),
          summary('session_aaaaaaaa-0000-0000-0000-000000000000', 'auth work'),
        ]}
        onSelect={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('07d291bc');
    expect(frame).toContain('15f05245');
    expect(frame).toContain('auth work');
    expect(frame).not.toMatch(/session_\s/);
    view.unmount();
  });
});

describe('live sessions in the picker (#3189)', () => {
  function entry(id: string, name: string, extra: Partial<ISessionListingEntry>): ISessionListingEntry {
    return { ...summary(id, name), ...extra };
  }

  it('marks a session the host runs now, and how many clients are on it', () => {
    const view = render(
      <SessionPicker
        sessions={[
          entry('session_a', 'busy one', { live: true, clients: 2 }),
          entry('session_b', 'solo one', { live: true, clients: 1 }),
          entry('session_c', 'stored one', { live: false, clients: 0 }),
        ]}
        onSelect={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const lines = (view.lastFrame() ?? '').split('\n');
    const lineOf = (name: string): string => lines.find((line) => line.includes(name)) ?? '';
    expect(lineOf('busy one')).toContain('● live · 2 clients');
    expect(lineOf('solo one')).toContain('● live · 1 client');
    expect(lineOf('solo one')).not.toContain('1 clients');
    expect(lineOf('stored one')).not.toContain('live');
    expect(lineOf('stored one')).not.toContain('client');
    view.unmount();
  });

  it('shows neither for an older host, which sends neither', () => {
    const view = render(
      <SessionPicker
        sessions={[summary('session_a', 'plain')]}
        onSelect={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).not.toContain('live');
    expect(frame).not.toContain('client');
    view.unmount();
  });
});
