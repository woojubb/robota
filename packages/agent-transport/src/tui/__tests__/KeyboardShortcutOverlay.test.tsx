import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import KeyboardShortcutOverlay from '../KeyboardShortcutOverlay.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('KeyboardShortcutOverlay', () => {
  it('renders the title', () => {
    const { lastFrame } = render(<KeyboardShortcutOverlay onClose={() => {}} />);
    expect(lastFrame()).toContain('Keyboard Shortcuts');
  });

  it('renders all shortcut entries', () => {
    const { lastFrame } = render(<KeyboardShortcutOverlay onClose={() => {}} />);
    const frame = lastFrame()!;
    expect(frame).toContain('Enter');
    expect(frame).toContain('ESC');
    expect(frame).toContain('Ctrl+C');
    expect(frame).toContain('Ctrl+B');
    expect(frame).toContain('/compact');
    expect(frame).toContain('/help');
  });

  it('calls onClose when ? is pressed', () => {
    const onClose = vi.fn();
    const { stdin } = render(<KeyboardShortcutOverlay onClose={onClose} />);
    stdin.write('?');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when ESC is pressed', async () => {
    const onClose = vi.fn();
    const { stdin } = render(<KeyboardShortcutOverlay onClose={onClose} />);
    stdin.write('\x1B');
    await delay(50);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
