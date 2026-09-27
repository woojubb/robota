// @vitest-environment jsdom
/**
 * #3268 — in a folder not trusted yet the desktop app starts nothing and asks the person first: trust
 * the folder, start Restricted, or quit. A grant the CLI refuses keeps the question up with its reason.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost, IGuiTrustQuestion } from '../gui-host.js';

afterEach(cleanup);

const QUESTION: IGuiTrustQuestion = {
  folder: '/work/repo',
  loads: [
    '  [file] AGENTS.md — Agent instructions',
    '  [directory] .robota/skills — Project skills',
  ],
};

function desktopHost(overrides: Partial<IGuiHost> = {}): IGuiHost {
  return {
    kind: 'desktop',
    getEndpoint: vi.fn(() => new Promise<string | null>(() => {})),
    signalReady: () => {},
    onState: () => () => {},
    restartRuntime: async () => {},
    trustQuestion: vi.fn(async () => QUESTION),
    answerTrust: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe('the trust question', () => {
  it('names the folder and what trust would load, before asking for the endpoint', async () => {
    const host = desktopHost();
    render(<App host={host} />);
    const dialog = await screen.findByRole('dialog', { name: 'Do you trust this folder?' });
    expect(dialog.textContent).toContain('/work/repo');
    expect(screen.getByLabelText('What trust would load').textContent).toContain('AGENTS.md');
    expect(host.getEndpoint).not.toHaveBeenCalled();
  });

  it.each([
    ['Trust folder', 'trust'],
    ['Start Restricted', 'restricted'],
    ['Quit', 'quit'],
  ] as const)('%s answers %s and waits for the host', async (label, choice) => {
    const host = desktopHost({
      answerTrust: vi.fn(() => new Promise<{ error?: string }>(() => {})),
    });
    render(<App host={host} />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    expect(host.answerTrust).toHaveBeenCalledWith(choice);
    // One answer at a time: the host reloads the page once it has one.
    expect(
      (screen.getByRole('button', { name: 'Start Restricted' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps the question up with the reason when the grant is refused', async () => {
    const host = desktopHost({
      answerTrust: vi.fn(async () => ({ error: 'Workspace trust store is unavailable.' })),
    });
    render(<App host={host} />);
    const trust = await screen.findByRole('button', { name: 'Trust folder' });
    await act(async () => {
      fireEvent.click(trust);
    });
    expect(screen.getByRole('alert').textContent).toBe('Workspace trust store is unavailable.');
    expect(
      (screen.getByRole('button', { name: 'Start Restricted' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('asks nothing and connects when the host has no question', async () => {
    const host = desktopHost({ trustQuestion: vi.fn(async () => null) });
    render(<App host={host} />);
    await vi.waitFor(() => expect(host.getEndpoint).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Starting the agent…')).toBeTruthy();
  });

  it('#3282 §3: the load list is a collapsed Details, closed to a plain sentence', async () => {
    const host = desktopHost();
    render(<App host={host} />);
    const dialog = await screen.findByRole('dialog', { name: 'Do you trust this folder?' });
    expect(dialog.textContent).toContain(
      "Trusting this folder lets Robota use the project's own settings, hooks, skills and MCP servers.",
    );
    expect(screen.getByText('Details').closest('details')).toBeTruthy();
  });

  it('#3282 §3: no per-path noise — nothing known (e.g. non-Linux) shows no Details at all', async () => {
    const host = desktopHost({ trustQuestion: vi.fn(async () => ({ folder: '/work/repo', loads: [] })) });
    render(<App host={host} />);
    await screen.findByRole('dialog', { name: 'Do you trust this folder?' });
    expect(screen.queryByText('Details')).toBeNull();
    expect(screen.queryByLabelText('What trust would load')).toBeNull();
  });
});
