import { render } from 'ink';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderSupervisedSessionView } from '../SupervisedSessionView.js';

vi.mock('ink', async (importOriginal) => ({
  ...await importOriginal<typeof import('ink')>(),
  render: vi.fn(() => ({ waitUntilExit: async () => undefined, unmount: () => undefined })),
}));

describe('production supervised view renderer', () => {
  it('forwards the PR open action and filter state into the live view', async () => {
    const onOpenPr = vi.fn(async () => undefined);
    await renderSupervisedSessionView({
      loadRows: async () => [], onOpenPr, filteredByPr: true, screenReader: false,
    });
    const wrapper = vi.mocked(render).mock.calls[0]?.[0] as React.ReactElement<{
      children: React.ReactElement<{ onOpenPr?: typeof onOpenPr; filteredByPr?: boolean }>;
    }>;
    expect(wrapper.props.children.props.onOpenPr).toBe(onOpenPr);
    expect(wrapper.props.children.props.filteredByPr).toBe(true);
  });
});
