import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../button'

describe('Button Component', () => {
    it('renders with default props', () => {
        render(<Button>Test Button</Button>)
        const button = screen.getByRole('button', { name: /test button/i })
        expect(button).toBeInTheDocument()
    })

    it('renders with different variants', () => {
        render(<Button variant="secondary">Secondary Button</Button>)
        const button = screen.getByRole('button', { name: /secondary button/i })
        expect(button).toBeInTheDocument()
        expect(button).toHaveClass('bg-secondary')
    })

    it('renders with different sizes', () => {
        render(<Button size="sm">Small Button</Button>)
        const button = screen.getByRole('button', { name: /small button/i })
        expect(button).toBeInTheDocument()
        expect(button).toHaveClass('h-9')
    })

    it('handles click events', () => {
        const handleClick = jest.fn()
        render(<Button onClick={handleClick}>Clickable Button</Button>)

        const button = screen.getByRole('button', { name: /clickable button/i })
        fireEvent.click(button)

        expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('is disabled when disabled prop is true', () => {
        render(<Button disabled>Disabled Button</Button>)
        const button = screen.getByRole('button', { name: /disabled button/i })
        expect(button).toBeDisabled()
    })

    it('renders as a child component when asChild is true', () => {
        render(
            <Button asChild>
                <a href="/test">Link Button</a>
            </Button>
        )
        const link = screen.getByRole('link', { name: /link button/i })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute('href', '/test')
    })
}) 