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

/**
 * A `TSessionStatus` naming a workspace root — attachments are resolved against `workspace.path`
 * (#3282 §4d, using the `ISessionStatusSnapshot.workspace` field #3289 §1 added).
 */
function statusWithWorkspace(sessionId: string, path: string): TSessionStatus {
  return {
    sessionId,
    model: 'm',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null,
    workspace: { name: path.split('/').pop() ?? path, path },
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
    render(<Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} pickFiles={pickFiles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(pickFiles).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('list', { name: 'attachments' })).toBeTruthy());
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('without a host picker, falls back to the plain HTML file input', () => {
    render(<Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} />);
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('a file chosen through the plain HTML input (no real path in a browser) shows the plain sentence', () => {
    const { container } = render(<Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} />);
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
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/src/a.ts'}
      />,
    );
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    drop(input, [new File(['hello'], 'a.ts', { type: 'text/typescript' })]);
    expect(screen.getByText('a.ts')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'look at this' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('look at this\n\n@./src/a.ts');
  });

  // Follow-up: a dotless filename (Makefile, Dockerfile, LICENSE, …) attaches and sends the same way
  // as any other file — the runtime parser only recognizes it as a reference because of the ./
  // prefix `buildPromptWithAttachments` always adds now (packages/agent-framework's
  // prompt-file-references.test.ts covers the real parser + resolver resolving it end to end).
  it('a dotless filename (Makefile) attaches and sends as an @./ reference', () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        {...baseProps()}
        onSubmit={onSubmit}
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/Makefile'}
      />,
    );
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    drop(input, [new File(['build:\n\techo hi\n'], 'Makefile')]);
    expect(screen.getByText('Makefile')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('@./Makefile');
  });

  it('a browser drop with no real path shows the plain sentence and adds no chip (rule 3)', () => {
    render(<Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} />);
    const input = screen.getByLabelText('message');
    drop(input, [new File(['hello'], 'photo.png', { type: 'image/png' })]);
    expect(screen.getByText('Only files inside this project folder can be attached.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'attachments' })).toBeNull();
  });

  it('a desktop drop of a file outside the workspace shows the same plain sentence (rule 3)', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithWorkspace('s1', '/repo')}
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
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/a.ts'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'a.ts')]);
    expect(screen.queryByText('a.ts')).toBeNull();
  });

  it('refuses an image outright — no chip, a plain sentence (#3282 §4 rule 4, corrected)', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/shot.png'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'shot.png', { type: 'image/png' })]);
    expect(screen.queryByText('shot.png')).toBeNull();
    expect(screen.queryByRole('list', { name: 'attachments' })).toBeNull();
    expect(screen.getByText("Images and other non-text files can't be attached yet.")).toBeTruthy();
  });

  it('refuses a known-binary extension the same way, even with no MIME type (a desktop drop)', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/archive.zip'}
      />,
    );
    const input = screen.getByLabelText('message');
    drop(input, [new File(['x'], 'archive.zip')]);
    expect(screen.queryByText('archive.zip')).toBeNull();
    expect(screen.getByText("Images and other non-text files can't be attached yet.")).toBeTruthy();
  });
});

describe('Composer — remove and persist attachments (#3282 §4d)', () => {
  afterEach(cleanup);

  it('Remove clears a chip, named after its file', () => {
    render(
      <Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} getPathForFile={() => '/repo/a.ts'} />,
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
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={() => '/repo/a.ts'}
      />,
    );
    drop(screen.getByLabelText('message'), [new File(['x'], 'a.ts')]);
    expect(screen.getByText('a.ts')).toBeTruthy();
    unmount();

    render(<Composer {...baseProps()} onSubmit={onSubmit} status={statusWithWorkspace('s1', '/repo')} />);
    expect(screen.getByText('a.ts')).toBeTruthy();

    // A message consisting only of an attachment (no typed text) still sends.
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('@./a.ts');
    expect(screen.queryByText('a.ts')).toBeNull();
    expect(window.localStorage.getItem('robota.draft.s1')).toBeNull();
  });

  // Cheap hardening: a stored draft is `localStorage`, not this component's own state — it can be
  // edited by hand, or left over from a future version with a different attachment shape. A
  // malformed entry (missing relativePath here) must be dropped, not shown as a broken chip or sent
  // as a broken/empty @-reference.
  it('drops a malformed stored attachment instead of showing a broken chip', () => {
    window.localStorage.setItem(
      'robota.draft.s1',
      JSON.stringify({
        text: '',
        attachments: [
          { id: '1', name: 'good.ts', relativePath: 'good.ts', size: 1 },
          { id: '2', name: 'bad.ts' }, // missing relativePath/size — malformed
          { name: 'no-id.ts', relativePath: 'no-id.ts', size: 1 }, // missing id — malformed
          'not even an object',
        ],
      }),
    );
    render(<Composer {...baseProps()} status={statusWithWorkspace('s1', '/repo')} />);
    expect(screen.getByText('good.ts')).toBeTruthy();
    expect(screen.queryByText('bad.ts')).toBeNull();
    expect(screen.queryByText('no-id.ts')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('Composer — attachment count limit (cheap hardening, #3282 §4d follow-up)', () => {
  afterEach(cleanup);

  it('a 9th file is refused with a plain message; the first 8 stay attached', () => {
    render(
      <Composer
        {...baseProps()}
        status={statusWithWorkspace('s1', '/repo')}
        getPathForFile={(file) => `/repo/${file.name}`}
      />,
    );
    const input = screen.getByLabelText('message');
    for (let index = 1; index <= 8; index += 1) {
      drop(input, [new File(['x'], `f${index}.ts`)]);
    }
    for (let index = 1; index <= 8; index += 1) {
      expect(screen.getByText(`f${index}.ts`)).toBeTruthy();
    }

    drop(input, [new File(['x'], 'f9.ts')]);
    expect(screen.queryByText('f9.ts')).toBeNull();
    expect(screen.getByText('You can attach up to 8 files to one message.')).toBeTruthy();
  });
});
