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

  it('returns the attach the user confirmed so the host can run it and come back', async () => {
    vi.mocked(render).mockClear();
    let exitView: () => void = () => undefined;
    vi.mocked(render).mockImplementationOnce(() => ({
      waitUntilExit: () => new Promise<void>((resolve) => { exitView = resolve; }),
      unmount: () => undefined,
    }) as never);
    const ended = renderSupervisedSessionView({ loadRows: async () => [], screenReader: false });
    const wrapper = vi.mocked(render).mock.calls[0]?.[0] as React.ReactElement<{
      children: React.ReactElement<{ onAttach?: (request: unknown) => void }>;
    }>;
    wrapper.props.children.props.onAttach?.({ id: 'x', generation: 'g', mode: 'observe' });
    exitView();
    expect(await ended).toEqual({ kind: 'attach', id: 'x', generation: 'g', mode: 'observe' });
  });
});
