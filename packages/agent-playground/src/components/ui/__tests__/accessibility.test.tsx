import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Announcer,
  KeyboardNavigatable,
  LiveRegion,
  ScreenReaderOnly,
  SkipToContent,
} from '../accessibility';

describe('accessibility UI primitives', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders skip link with the stable main-content target', () => {
    render(<SkipToContent className="custom-skip-link" />);

    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toHaveAttribute('href', '#main-content');
    expect(link).toHaveClass('sr-only');
    expect(link).toHaveClass('custom-skip-link');
  });

  it('renders screen-reader-only and live-region content with expected aria attributes', () => {
    render(
      <>
        <ScreenReaderOnly className="custom-sr">Hidden label</ScreenReaderOnly>
        <LiveRegion politeness="assertive" className="custom-live">
          Live update
        </LiveRegion>
      </>,
    );

    expect(screen.getByText('Hidden label')).toHaveClass('sr-only');
    expect(screen.getByText('Hidden label')).toHaveClass('custom-sr');
    expect(screen.getByText('Live update')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Live update')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('Live update')).toHaveClass('custom-live');
  });

  it('moves focus through children with arrow, home, and end keys', () => {
    const { container } = render(
      <KeyboardNavigatable>
        <button type="button">First</button>
        <button type="button">Second</button>
        <button type="button">Third</button>
      </KeyboardNavigatable>,
    );

    const wrapper = container.firstElementChild;
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });
    const third = screen.getByRole('button', { name: 'Third' });

    expect(wrapper).not.toBeNull();
    first.focus();
    fireEvent.keyDown(wrapper as Element, { key: 'ArrowRight' });
    expect(second).toHaveFocus();

    fireEvent.keyDown(wrapper as Element, { key: 'End' });
    expect(third).toHaveFocus();

    fireEvent.keyDown(wrapper as Element, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('activates non-button focused items on enter and space', () => {
    const handleClick = vi.fn();
    render(
      <KeyboardNavigatable>
        <div role="button" tabIndex={0} onClick={handleClick}>
          Action
        </div>
      </KeyboardNavigatable>,
    );

    const action = screen.getByRole('button', { name: 'Action' });

    action.focus();
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.keyDown(action, { key: ' ' });

    expect(handleClick).toHaveBeenCalledTimes(2);
  });

  it('updates announcer text after the screen-reader delay', () => {
    vi.useFakeTimers();

    render(<Announcer message="Saved" politeness="assertive" />);

    const region = document.querySelector('[aria-live="assertive"]');
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent('');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(region).toHaveTextContent('Saved');
  });
});
