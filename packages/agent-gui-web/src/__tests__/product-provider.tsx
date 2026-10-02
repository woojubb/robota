import { ProductIdentityProvider } from '@robota-sdk/agent-ui-web/client';
import { render as testingRender, type RenderResult, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { testProduct } from './product-fixture.js';
function Wrapper({ children }: { children: ReactNode }) { return <ProductIdentityProvider value={testProduct}>{children}</ProductIdentityProvider>; }
export function render(ui: ReactElement, options?: RenderOptions): RenderResult { return testingRender(ui, { wrapper: Wrapper, ...options }); }
