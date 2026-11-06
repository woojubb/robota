// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '../../testing/product-provider.js';
import { ExecutionDetailSheet } from '../ExecutionDetailSheet.js';

import type {
  IExecutionDetailRecord,
  IExecutionWorkspaceEntry,
} from '@robota-sdk/agent-interface-execution';

const entry: IExecutionWorkspaceEntry = {
  id: 'task:fork',
  sourceId: 'fork',
  kind: 'background_task',
  origin: { kind: 'tool_call', sessionId: 'parent' },
  status: 'running',
  state: 'working',
  title: 'Fork',
  resumeSessionId: 'fork-session',
  unread: false,
  attention: 'none',
  visibility: 'default',
  updatedAt: '2026-01-01T00:00:00Z',
  controls: ['select', 'attach', 'send'],
};
const records = (text: string): IExecutionDetailRecord[] => [{ id: 'r1', kind: 'message', text }];
const props = {
  entry,
  status: 'ready' as const,
  error: null,
  complete: true,
  onClose: vi.fn(),
  onLoadMore: vi.fn(),
  onShowEarlier: vi.fn(),
  onShowLive: vi.fn(),
};

function metrics(element: HTMLElement, top: number, height: number, viewport: number): void {
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: top });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: viewport });
}

describe('fork follow scrolling', () => {
  it('follows new output only while the reader is near the bottom', () => {
    const { rerender } = render(<ExecutionDetailSheet {...props} records={records('First')} />);
    const log = screen.getByRole('log', { name: 'Live fork output' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    metrics(log, 600, 800, 200);
    fireEvent.scroll(log);
    metrics(log, 600, 1000, 200);
    rerender(<ExecutionDetailSheet {...props} records={records('First and second')} />);
    expect(log.scrollTop).toBe(1000);
    metrics(log, 100, 1000, 200);
    fireEvent.scroll(log);
    metrics(log, 100, 1200, 200);
    rerender(<ExecutionDetailSheet {...props} records={records('First and more')} />);
    expect(log.scrollTop).toBe(100);
    metrics(log, 1000, 1200, 200);
    fireEvent.scroll(log);
    metrics(log, 1000, 1400, 200);
    rerender(<ExecutionDetailSheet {...props} records={records('Latest')} />);
    expect(log.scrollTop).toBe(1400);
  });

  it('does not move the reader or announce transcript pagination as live output', () => {
    const { rerender } = render(
      <ExecutionDetailSheet {...props} mode="transcript" records={records('Earlier')} />,
    );
    const region = screen.getByRole('region', { name: 'Earlier fork output' });
    metrics(region, 100, 800, 200);
    rerender(
      <ExecutionDetailSheet
        {...props}
        mode="transcript"
        records={[...records('Earlier'), { id: 'r2', kind: 'message', text: 'Next page' }]}
      />,
    );
    expect(region.scrollTop).toBe(100);
    expect(region.getAttribute('aria-live')).not.toBe('polite');
  });
});
