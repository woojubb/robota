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
function status(sessionId: string, path = '/fixture'): TSessionStatus {
  return {
    sessionId, model: 'm', permissionMode: 'default', effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null, workspace: { name: 'fixture', path },
  } as TSessionStatus;
}
function deferredPick(): {
  pickFiles: () => Promise<readonly IPickedFile[]>;
  resolve: (files: readonly IPickedFile[]) => void;
  reject: () => void;
} {
  let resolve: (files: readonly IPickedFile[]) => void = () => {};
  let reject = () => {};
  return {
    pickFiles: () => new Promise<readonly IPickedFile[]>((yes, no) => { resolve = yes; reject = () => no(new Error('picker failed')); }),
    resolve: (files) => resolve(files),
    reject: () => reject(),
  };
}
const file = (name: string): IPickedFile => ({ name, path: `/fixture/${name}`, size: 1 });
function openPicker(): void { fireEvent.click(screen.getByRole('button', { name: 'Attach files' })); }
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('Composer picker lifecycle', () => {
  it.each(['two', 'one'])('does not attach an old selection after one → two → %s', async (last) => {
    const selection = deferredPick();
    const view = render(<Composer {...props} status={status('one')} pickFiles={selection.pickFiles} />);
    openPicker();
    view.rerender(<Composer {...props} status={status('two')} pickFiles={selection.pickFiles} />);
    if (last === 'one') view.rerender(<Composer {...props} status={status('one')} pickFiles={selection.pickFiles} />);
    await act(async () => { selection.resolve([file('late.txt')]); });
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.two')).toBeNull();
  });

  it('keeps fallback text migration but discards a selection begun before the first session ID', async () => {
    const selection = deferredPick();
    const view = render(<Composer {...props} status={null} pickFiles={selection.pickFiles} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'fallback text' } });
    openPicker();
    view.rerender(<Composer {...props} status={status('one')} pickFiles={selection.pickFiles} />);
    await act(async () => { selection.resolve([file('late.txt')]); });
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('fallback text');
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).not.toContain('late.txt');
  });

  it('drops a stale picker result after a workspace changes under the same session ID', async () => {
    const selection = deferredPick();
    const view = render(<Composer {...props} status={status('one')} pickFiles={selection.pickFiles} />);
    openPicker();
    view.rerender(<Composer {...props} status={status('one', '/other')} pickFiles={selection.pickFiles} />);
    await act(async () => { selection.resolve([file('late.txt')]); });
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
  });

  it('drops a stale picker error after a workspace changes under the same session ID', async () => {
    const selection = deferredPick();
    const view = render(<Composer {...props} status={status('one')} pickFiles={selection.pickFiles} />);
    openPicker();
    view.rerender(<Composer {...props} status={status('one', '/other')} pickFiles={selection.pickFiles} />);
    await act(async () => { selection.reject(); });
    expect(screen.queryByText('Could not open the file picker. Try again.')).toBeNull();
  });

  it('does not refill a draft with a selection that completes after the prompt was sent', async () => {
    const selection = deferredPick();
    const onSubmit = vi.fn();
    render(<Composer {...props} onSubmit={onSubmit} status={status('one')} pickFiles={selection.pickFiles} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'send me' } });
    openPicker();
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Enter' });
    await act(async () => { selection.resolve([file('late.txt')]); });
    expect(onSubmit).toHaveBeenCalledWith('send me');
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
  });

  it('does not accept a browser file-input result from the previous session', () => {
    const view = render(<Composer {...props} status={status('one')} getPathForFile={() => '/fixture/late.txt'} />);
    const oldInput = view.container.querySelector('input[type="file"]');
    if (!(oldInput instanceof HTMLInputElement)) throw new Error('missing file input');
    openPicker();
    view.rerender(<Composer {...props} status={status('two')} getPathForFile={() => '/fixture/late.txt'} />);
    fireEvent.change(oldInput, { target: { files: [new File(['x'], 'late.txt')] } });
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.two')).toBeNull();
  });

  it.each(['first', 'second'])('checks the attachment count when %s selection finishes first', async (order) => {
    const first = deferredPick();
    const second = deferredPick();
    const pickFiles = vi.fn().mockImplementationOnce(first.pickFiles).mockImplementationOnce(second.pickFiles);
    render(<Composer {...props} status={status('one')} pickFiles={pickFiles} />);
    openPicker(); openPicker();
    const settleFirst = async () => { first.resolve(Array.from({ length: 5 }, (_, i) => file(`a${i}.txt`))); };
    const settleSecond = async () => { second.resolve(Array.from({ length: 5 }, (_, i) => file(`b${i}.txt`))); };
    await act(order === 'first' ? settleFirst : settleSecond);
    await act(order === 'first' ? settleSecond : settleFirst);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('You can attach up to 8 files to one message.')).toBeTruthy();
  });

  it('allows a later pending selection after an attachment has been removed', async () => {
    const first = deferredPick();
    const second = deferredPick();
    const pickFiles = vi.fn().mockImplementationOnce(first.pickFiles).mockImplementationOnce(second.pickFiles);
    render(<Composer {...props} status={status('one')} pickFiles={pickFiles} />);
    openPicker(); openPicker();
    await act(async () => { first.resolve(Array.from({ length: 8 }, (_, i) => file(`a${i}.txt`))); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a0.txt' }));
    await act(async () => { second.resolve([file('new.txt')]); });
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('new.txt')).toBeTruthy();
  });

  it('checks the byte limit against attachments from a previously completed picker', async () => {
    const first = deferredPick();
    const second = deferredPick();
    const pickFiles = vi.fn().mockImplementationOnce(first.pickFiles).mockImplementationOnce(second.pickFiles);
    render(<Composer {...props} status={status('one')} pickFiles={pickFiles} />);
    openPicker(); openPicker();
    const files = (prefix: string) => Array.from({ length: 3 }, (_, i) => ({ ...file(`${prefix}${i}.txt`), size: 60 * 1024 }));
    await act(async () => { first.resolve(files('a')); });
    await act(async () => { second.resolve(files('b')); });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Attachments cannot total more than 256 KB.')).toBeTruthy();
  });

  it('invalidates a pending selection before an immediate screen command', async () => {
    const selection = deferredPick();
    const onCommand = vi.fn();
    const catalog = { commands: [{ name: 'settings', description: 'Settings', modelInvocable: false, runner: 'runtime' as const }], skills: [] };
    render(<Composer {...props} catalog={catalog} onCommand={onCommand} status={status('one')} pickFiles={selection.pickFiles} />);
    openPicker();
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/settings' } });
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Enter' });
    await act(async () => { selection.resolve([file('late.txt')]); });
    expect(onCommand).toHaveBeenCalledWith('settings');
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
  });

  it('ignores a browser selection after send and permits a new dialog after cancellation', () => {
    const view = render(<Composer {...props} status={status('one')} getPathForFile={() => '/fixture/late.txt'} />);
    const oldInput = view.container.querySelector('input[type="file"]');
    if (!(oldInput instanceof HTMLInputElement)) throw new Error('missing file input');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    openPicker(); openPicker();
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent(oldInput, new Event('cancel'));
    openPicker();
    expect(click).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'send me' } });
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Enter' });
    fireEvent.change(oldInput, { target: { files: [new File(['x'], 'late.txt')] } });
    expect(screen.queryByText('late.txt')).toBeNull();
    expect(window.localStorage.getItem('test-product.draft.one')).toBeNull();
  });

});
