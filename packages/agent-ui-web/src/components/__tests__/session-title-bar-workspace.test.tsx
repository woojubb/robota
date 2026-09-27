// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionTitleBar } from '../SessionSurfaceChrome.js';

/**
 * #3289 §1 — the folder a session works in shows beside its title, and names the browser tab / the
 * desktop window (which follows the page's `document.title`; see `apps/agent-app/electron/main.ts`).
 */

afterEach(cleanup);

const noop = (): void => undefined;

describe('SessionTitleBar workspace (#3289 §1)', () => {
  it('shows the folder name as muted text next to the session title, full path in a tooltip', () => {
    render(
      <SessionTitleBar
        status="connected"
        title="My task"
        workspace={{ name: 'task-tracker', path: '/Users/me/projects/task-tracker' }}
        showBrand={false}
        view="chat"
        onView={noop}
        personalUsageEnabled={false}
      />,
    );
    const folder = screen.getByText('task-tracker');
    expect(folder.getAttribute('title')).toBe('/Users/me/projects/task-tracker');
    expect(screen.getByText('My task')).toBeTruthy();
  });

  it('shows nothing for the workspace when the host has not said', () => {
    render(
      <SessionTitleBar
        status="connected"
        title="My task"
        showBrand={false}
        view="chat"
        onView={noop}
        personalUsageEnabled={false}
      />,
    );
    expect(screen.queryByTitle(/\//)).toBeNull();
  });

  it('sets document.title to "<folder> — Robota"', () => {
    render(
      <SessionTitleBar
        status="connected"
        title="My task"
        workspace={{ name: 'task-tracker', path: '/work/task-tracker' }}
        showBrand={false}
        view="chat"
        onView={noop}
        personalUsageEnabled={false}
      />,
    );
    expect(document.title).toBe('task-tracker — Robota');
  });

  it('leaves document.title alone when the workspace is not yet known', () => {
    document.title = 'Robota';
    render(
      <SessionTitleBar
        status="connecting"
        showBrand
        view="chat"
        onView={noop}
        personalUsageEnabled={false}
      />,
    );
    expect(document.title).toBe('Robota');
  });
});
