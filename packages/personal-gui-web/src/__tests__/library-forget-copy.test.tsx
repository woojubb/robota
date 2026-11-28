// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryView } from '../views/Library.js';

import type { IPersonalApi } from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const page = {
  id: 'home',
  title: 'Home',
  kind: 'matter',
  claims: [
    {
      id: 'c1',
      text: 'The cat is called Tofu',
      source: { origin: 'owner' as const, at: '2026-09-01T00:00:00.000Z' },
      validFrom: '2026-09-01T00:00:00.000Z',
    },
  ],
  links: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('the library asks before forgetting', () => {
  it('says what is removed and what stays, never that it is removed everywhere', async () => {
    const asked: string[] = [];
    vi.spyOn(window, 'confirm').mockImplementation((message) => {
      asked.push(String(message));
      return false;
    });
    const api = {
      listPages: async () => [{ id: 'home', title: 'Home', kind: 'matter', currentClaims: 1 }],
      getPage: async () => page,
    } as unknown as IPersonalApi;
    render(<LibraryView api={api} openPage="home" onOpenPage={() => undefined} />);
    await waitFor(() => screen.getByRole('button', { name: 'Forget' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget page' }));
    expect(asked).toHaveLength(2);
    for (const message of asked) {
      expect(message).not.toMatch(/everywhere/u);
      expect(message).toMatch(/saved conversations/u);
      expect(message).toMatch(/said differently/u);
      expect(message).toMatch(/feed and cases/u);
      expect(message).toMatch(/model provider/u);
      expect(message).toMatch(/cannot be restored/u);
    }
  });
});
