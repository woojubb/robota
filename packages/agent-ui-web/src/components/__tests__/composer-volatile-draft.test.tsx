// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../testing/product-provider.js';
import type { TSessionStatus } from '../../hooks/session-client-types.js';
import { Composer } from '../Composer.js';
import type { IPickedFile } from '../composer-attachments.js';

const props = {
  onSubmit: vi.fn(), onCommand: vi.fn(), catalog: null, running: false,
  onStop: vi.fn(), queued: null, onCancelQueue: vi.fn(),
};

function status(sessionId: string): TSessionStatus {
  return {
    sessionId, model: 'm', permissionMode: 'default', effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null, workspace: { name: 'fixture', path: '/fixture' },
  } as TSessionStatus;
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('Composer volatile draft boundary', () => {
  it('never reads or modifies an existing persistent draft and discards its own text on remount', () => {
    window.localStorage.setItem('test-product.draft.one', 'plain-draft-canary');
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const { unmount } = render(<Composer {...props} status={status('one')} draftMode="volatile" />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'volatile-text-canary' } });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    unmount();
    render(<Composer {...props} status={status('one')} draftMode="volatile" />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
    expect(window.localStorage.getItem('test-product.draft.one')).toBe('plain-draft-canary');
  });

  it('does not carry a persistent draft into a volatile composer when mode changes', () => {
    const { rerender } = render(<Composer {...props} status={status('one')} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'plain-canary' } });
    rerender(<Composer {...props} status={status('one')} draftMode="volatile" />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'volatile-canary' } });
    rerender(<Composer {...props} status={status('one')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('plain-canary');
  });

  it('does not persist a file selection that returns after a switch from persistent to volatile', async () => {
    let finish: (files: readonly IPickedFile[]) => void = () => {};
    const pickFiles = () => new Promise<readonly IPickedFile[]>((resolve) => { finish = resolve; });
    const { rerender } = render(<Composer {...props} status={status('one')} pickFiles={pickFiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    rerender(<Composer {...props} status={status('one')} draftMode="volatile" pickFiles={pickFiles} />);
    await act(async () => { finish([{ name: 'late.txt', path: '/fixture/late.txt', size: 4 }]); });
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
    expect(screen.queryByText('late.txt')).toBeNull();
  });

  it('keeps attachment metadata volatile and drops it on session switch', async () => {
    const pickFiles = async () => [{ name: 'sample.txt', path: '/fixture/sample.txt', size: 4 }];
    const { rerender } = render(<Composer {...props} status={status('one')} draftMode="volatile" pickFiles={pickFiles} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Attach files' })); });
    expect(screen.getByText('sample.txt')).toBeTruthy();
    expect(window.localStorage.length).toBe(0);
    rerender(<Composer {...props} status={status('two')} draftMode="volatile" pickFiles={pickFiles} />);
    expect(screen.queryByText('sample.txt')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('does not revive an earlier selection when a session id returns after a switch', async () => {
    let finish: (files: readonly IPickedFile[]) => void = () => {};
    const pickFiles = () => new Promise<readonly IPickedFile[]>((resolve) => { finish = resolve; });
    const { rerender } = render(<Composer {...props} status={status('one')} draftMode="volatile" pickFiles={pickFiles} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'old-session-canary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    rerender(<Composer {...props} status={null} draftMode="volatile" pickFiles={pickFiles} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
    rerender(<Composer {...props} status={status('one')} draftMode="volatile" pickFiles={pickFiles} />);
    await act(async () => { finish([{ name: 'old.txt', path: '/fixture/old.txt', size: 4 }]); });
    expect(screen.queryByText('old.txt')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('discards text and attachments on a session change and ignores a late file selection', async () => {
    let finish: (files: readonly IPickedFile[]) => void = () => {};
    const pickFiles = () => new Promise<readonly IPickedFile[]>((resolve) => { finish = resolve; });
    const { rerender } = render(<Composer {...props} status={status('one')} draftMode="volatile" pickFiles={pickFiles} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'session-one-canary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    rerender(<Composer {...props} status={status('two')} draftMode="volatile" pickFiles={pickFiles} />);
    await act(async () => { finish([{ name: 'sensitive.txt', path: '/fixture/sensitive.txt', size: 5 }]); });
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('sensitive.txt')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
