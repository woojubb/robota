// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '../Composer.js';

import type { IPickedFile } from '../composer-attachments.js';
import type { TCommandCatalog, TSessionStatus } from '../../hooks/session-client-types.js';

/**
 * #3282 §4d: the composer's attach button, drag-and-drop, chip list and remove/persist behaviour.
 * The draft persists to `localStorage` — never leak one test's stored draft into another (same
 * convention as composer.test.tsx).
 */
afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

const catalog: TCommandCatalog = { commands: [], skills: [] };

function baseProps(): {
  onSubmit: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
  catalog: TCommandCatalog;
  status: null;
  running: boolean;
  onStop: ReturnType<typeof vi.fn>;
  queued: null;
  onCancelQueue: ReturnType<typeof vi.fn>;
} {
  return {
    onSubmit: vi.fn(),
    onCommand: vi.fn(),
    catalog,
    status: null,
    running: false,
    onStop: vi.fn(),
    queued: null,
    onCancelQueue: vi.fn(),
  };
}

/** A `TSessionStatus` naming a workspace root — attachments are resolved against `cwd` (#3282 §4d). */
function statusWithCwd(sessionId: string, cwd: string): TSessionStatus {
  return {
    sessionId,
    model: 'm',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null,
    cwd,
  } as TSessionStatus;
}

function drop(target: Element, files: File[]): void {
  fireEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });
}

describe('Composer — attach button (#3282 §4d)', () => {
  afterEach(cleanup);

  it('is present, with an accessible name, and disabled while not connected', () => {
    render(<Composer {...baseProps()} connected={false} />);
    const button = screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('on the desktop host, opens the native picker and adds a chip for a workspace file', async () => {
    const pickFiles = vi.fn(
      async (): Promise<IPickedFile[]> => [{ path: '/repo/src/a.ts', name: 'a.ts', size: 10 }],
    );
    render(<Composer {...baseProps()} status={statusWithCwd('s1', '/repo')} pickFiles={pickFiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(pickFiles).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('list', { name: 'attachments' })).toBeTruthy());
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('without a host picker, falls back to the plain HTML file input', () => {
    render(<Composer {...baseProps()} status={statusWithCwd('s1', '/repo')} />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('a file chosen through the plain HTML input (no real path in a browser) shows the plain sentence', () => {
    const { container } = render(<Composer {...baseProps()} status={statusWithCwd('s1', '/repo')} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('Only files inside this project folder can be attached.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'attachments' })).toBeNull();
  });
});

describe('Composer — drag-and-drop (#3282 §4d)', () => {
  afterEach(cleanup);

  it('announces the drop zone even before any drag happens (rule 7)', () => {
    render(<Composer {...baseProps()} />);
    expect(
      screen.getByText('Drag files here, or use Attach files, to add them to your message.'),
    ).toBeTruthy();
  });

  it('shows a highlighted drop status while dragging files over the composer, then clears it', () => {
    render(<Composer {...baseProps()} />);
    const input = screen.getByLabelText('message');
    fireEvent.dragEnter(input, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop to attach')).toBeTruthy();
    fireEvent.dragLeave(input);
    expect(screen.queryByText('Drop to attach')).toBeNull();
  });

  it('dropping a workspace file adds a chip; sending inserts the @-reference', () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        {...baseProps()}
        onSubmit={onSubmit}
        status={statusWithCwd('s1', '/repo')}
        getPathForFile={() => '/repo/src/a.ts'}
      />,
    );
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    drop(input, [new File(['hello'], 'a.ts', { type: 'text/typescript' })]);
    expect(screen.getByText('a.ts')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'look at this' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('look at this\n\n@src/a.ts');
  });

  it('a browser drop with no real path shows the plain sentence and adds no chip (rule 3)', () => {
    render(<Composer {...baseProps()} status={statusWithCwd('s1', '/repo')} />);
    const input = screen.getByLabelText('message');
    drop(input, [new File(['hello'], 'photo.png', { type: 'image/png' })]);
    expect(screen.getByText('Only files inside this project folder can be attached.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'attachments' })).toBeNull();
  });

  it('a desktop drop of a file outside the workspace shows the same plain sentence (rule 3)', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithCwd('s1', '/repo')}
        getPathForFile={() => '/etc/passwd'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'passwd')]);
    expect(screen.getByText('Only files inside this project folder can be attached.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'attachments' })).toBeNull();
  });

  it('does nothing while not connected', () => {
    render(
      <Composer
        {...baseProps()}
        connected={false}
        status={statusWithCwd('s1', '/repo')}
        getPathForFile={() => '/repo/a.ts'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'a.ts')]);
    expect(screen.queryByText('a.ts')).toBeNull();
  });

  it('flags an attached image with a caution note, but still attaches it as an @-reference (#3282 §4 rule 4)', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithCwd('s1', '/repo')}
        getPathForFile={() => '/repo/shot.png'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'shot.png', { type: 'image/png' })]);
    expect(screen.getByText('shot.png')).toBeTruthy();
    expect(
      screen.getByText('Binary files, including images, are sent as file references and may not read correctly.'),
    ).toBeTruthy();
  });
});

describe('Composer — remove and persist attachments (#3282 §4d)', () => {
  afterEach(cleanup);

  it('Remove clears a chip, named after its file', () => {
    render(
      <Composer {...baseProps()} status={statusWithCwd('s1', '/repo')} getPathForFile={() => '/repo/a.ts'} />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'a.ts')]);
    expect(screen.getByText('a.ts')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove a.ts' }));
    expect(screen.queryByText('a.ts')).toBeNull();
  });

  it('chips persist with the draft across an unmount/remount, and clear once sent', () => {
    const onSubmit = vi.fn();
    const { unmount } = render(
      <Composer
        {...baseProps()}
        onSubmit={onSubmit}
        status={statusWithCwd('s1', '/repo')}
        getPathForFile={() => '/repo/a.ts'}
      />,
    );
    drop(screen.getByLabelText('message'), [new File(['x'], 'a.ts')]);
    expect(screen.getByText('a.ts')).toBeTruthy();
    unmount();

    render(<Composer {...baseProps()} onSubmit={onSubmit} status={statusWithCwd('s1', '/repo')} />);
    expect(screen.getByText('a.ts')).toBeTruthy();

    // A message consisting only of an attachment (no typed text) still sends.
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('@a.ts');
    expect(screen.queryByText('a.ts')).toBeNull();
    expect(window.localStorage.getItem('robota.draft.s1')).toBeNull();
  });
});
