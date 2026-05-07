import { render } from '@testing-library/react';
import { Logo } from '../logo';

describe('Logo Component', () => {
  it('renders the icon with the configured violet background', () => {
    const { container } = render(<Logo variant="icon" />);

    const icon = container.querySelector('svg')?.parentElement;

    expect(icon).toHaveClass('bg-violet-400');
  });
});
