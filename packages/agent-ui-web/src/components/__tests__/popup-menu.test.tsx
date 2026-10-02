// @vitest-environment jsdom
/**
 * #3282 §2 (part 2) — `PopupMenu`, the shared HIG pop-up menu primitive behind the model, mode and
 * effort controls: `role="menu"` with `menuitemradio` entries carrying `aria-checked`, optional
 * labelled sections, and full keyboard support (arrows move focus, Enter/Space activates, Esc closes
 * and returns focus to the trigger that opened it).
 */
import { render } from '../../testing/product-provider.js';
import { useRef, useState } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PopupMenu } from '../PopupMenu.js';

afterEach(cleanup);

function Harness({
  sections,
  onClose,
}: {
  sections: React.ComponentProps<typeof PopupMenu>['sections'];
  onClose?: () => void;
}): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button ref={triggerRef} type="button">
        Trigger
      </button>
      {open && (
        <PopupMenu
          label="Test menu"
          sections={sections}
          triggerRef={triggerRef}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
    </div>
  );
}

function radioSections(onSelectA: () => void, onSelectB: () => void) {
  return [
    {
      heading: 'Group',
      items: [
        { key: 'a', label: 'Option A', checked: true, onSelect: onSelectA },
        { key: 'b', label: 'Option B', description: 'the second one', checked: false, onSelect: onSelectB },
      ],
    },
  ];
}

describe('PopupMenu — structure and ARIA', () => {
  it('renders role="menu" with the given label, and items as menuitemradio with aria-checked', () => {
    render(<Harness sections={radioSections(vi.fn(), vi.fn())} />);

    const menu = screen.getByRole('menu', { name: 'Test menu' });
    expect(menu).toBeTruthy();
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    expect(items[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('shows a section heading and an item\'s description', () => {
    render(<Harness sections={radioSections(vi.fn(), vi.fn())} />);

    expect(screen.getByText('Group')).toBeTruthy();
    expect(screen.getByText('the second one')).toBeTruthy();
  });

  it('renders a plain action item as role="menuitem", not menuitemradio, with no checkmark state', () => {
    const onSelect = vi.fn();
    render(
      <Harness
        sections={[
          { items: [{ key: 'manage', label: 'Manage providers…', kind: 'action', onSelect }] },
        ]}
      />,
    );

    const item = screen.getByRole('menuitem', { name: 'Manage providers…' });
    expect(item.getAttribute('aria-checked')).toBeNull();
  });
});

describe('PopupMenu — selection', () => {
  it('clicking an item calls onSelect and closes the menu', () => {
    const onSelectA = vi.fn();
    render(<Harness sections={radioSections(onSelectA, vi.fn())} />);

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Option A' }));

    expect(onSelectA).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('PopupMenu — keyboard', () => {
  it('opens with the checked item focused', () => {
    render(<Harness sections={radioSections(vi.fn(), vi.fn())} />);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Option A' }));
  });

  it('ArrowDown/ArrowUp move focus, wrapping at the ends', () => {
    render(<Harness sections={radioSections(vi.fn(), vi.fn())} />);
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Option B' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Option A' }));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Option B' }));
  });

  it('Enter activates the focused item', () => {
    const onSelectB = vi.fn();
    render(<Harness sections={radioSections(vi.fn(), onSelectB)} />);
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });

    expect(onSelectB).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the menu and returns focus to the trigger', () => {
    render(<Harness sections={radioSections(vi.fn(), vi.fn())} />);
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
  });

  it('a click outside the menu closes it', () => {
    render(
      <div>
        <div data-testid="outside" />
        <Harness sections={radioSections(vi.fn(), vi.fn())} />
      </div>,
    );

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
