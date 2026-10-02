import { render as renderComponent, renderHook as renderHookWithOptions, type RenderResult, type RenderOptions } from '@testing-library/react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { ProductIdentityProvider, type IWebProductIdentity } from '../product-identity.js';

export const testProduct: IWebProductIdentity = {
  identity: { displayName: 'Test Product', cliName: 'test-product' },
  storage: { browserNamespace: 'test-product' },
};
export function TestProductProvider({ children }: { children?: ReactNode }): React.ReactElement {
  return <ProductIdentityProvider value={testProduct}>{children}</ProductIdentityProvider>;
}
export function render(ui: ReactNode, options?: RenderOptions): RenderResult { return renderComponent(ui, { wrapper: TestProductProvider, ...options }); }
export const renderHook: typeof renderHookWithOptions = (callback, options) => renderHookWithOptions(callback, { wrapper: TestProductProvider, ...options });
export function renderToStaticMarkup(node: ReactNode): string {
  return renderMarkup(<TestProductProvider>{node}</TestProductProvider>);
}
