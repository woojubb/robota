// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownText } from '../MarkdownText.js';

afterEach(cleanup);

describe('MarkdownText', () => {
  it('shows an agent report as formatted text, not as Markdown source', () => {
    const { container } = render(
      <MarkdownText>{'**Now:** 11 °C\n\n- Today: high 16\n- Rain: none'}</MarkdownText>,
    );
    expect(screen.getByText('Now:').tagName).toBe('STRONG');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).not.toContain('**');
  });

  it('opens a link in a new tab without handing the page its opener', () => {
    render(<MarkdownText>{'[forecast](https://example.com/seoul)'}</MarkdownText>);
    const link = screen.getByRole('link', { name: 'forecast' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not run markup an agent copied from a page', () => {
    const { container } = render(
      <MarkdownText>{'<img src=x onerror="alert(1)"> hi'}</MarkdownText>,
    );
    expect(container.querySelector('img')).toBeNull();
  });
});
