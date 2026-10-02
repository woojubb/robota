// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductIdentityProvider, type IWebProductIdentity } from '../../product-identity.js';
import { Composer } from '../Composer.js';
import { ProductWordmark } from '../Brand.js';

const a: IWebProductIdentity = { identity: { displayName: 'Product A', cliName: 'product-a' }, storage: { browserNamespace: 'product-a' } };
const b: IWebProductIdentity = { identity: { displayName: 'Product B', cliName: 'product-b' }, storage: { browserNamespace: 'product-b' } };
const props = { onSubmit: vi.fn(), onCommand: vi.fn(), catalog: null, status: null, running: false, onStop: vi.fn(), queued: null, onCancelQueue: vi.fn() };
afterEach(() => { cleanup(); localStorage.clear(); });

describe('public product identity', () => {
  it('renders independent names and restores only that product draft across A/B/A switches', () => {
    const view = (value: IWebProductIdentity) => <ProductIdentityProvider value={value}><ProductWordmark /><Composer {...props} /></ProductIdentityProvider>;
    const screen = render(view(a));
    expect(screen.getByText('Product A')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft for A' } });
    screen.rerender(view(b));
    expect(screen.getByText('Product B')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft for B' } });
    screen.rerender(view(a));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft for A');
    expect(JSON.parse(localStorage.getItem('product-b.draft')!).text).toBe('draft for B');
  });
});
